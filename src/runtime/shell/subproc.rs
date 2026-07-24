use core::ffi::{c_char, c_void};
use std::sync::Arc;

#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
use crate::api::bun::process::{
    self as bun_process, Process, Rusage, SignalCodeExt, SpawnOptions, Status,
};
#[cfg(windows)]
use crate::api::bun::process::{WindowsOptions, WindowsStdioResult};
use crate::api::bun::subprocess as JscSubprocess;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{self, IOWriter};
use crate::shell::states::cmd::Cmd as ShellCmd;
use crate::shell::{self as sh, Yield};
use crate::webcore::{self, FileSink, blob};
use bun_alloc::Arena;
use bun_collections::VecExt;
use bun_io::Loop as AsyncLoop;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{BufferedReader, ReadState};
use bun_jsc::{self as jsc, EventLoopHandle};
use bun_ptr::RefPtr;
use bun_sys::{self, Fd, FdExt, SystemError};
use enumset::EnumSet;

use crate::api::bun_spawn::stdio::{self, Stdio};
use crate::shell::util::OutKind;

/// Local helper: `OutKind` → tag-name string for logs.
#[inline]
fn out_kind_str(k: OutKind) -> &'static str {
    match k {
        OutKind::Stdout => "stdout",
        OutKind::Stderr => "stderr",
    }
}

/// Raw `*mut T` into an `Arc<T>` payload.
///
/// Returns a **raw pointer**, not `&mut T`: an `(&Arc<T>) -> &mut T` accessor
/// is unsound by construction — it lets two `&mut T` (or a `&mut T` and a
/// sibling-clone `Arc::deref` `&T`) coexist, which the compiler treats as
/// `noalias`. Callers must materialise `&mut *p` only for a scope that does
/// **not** re-enter code that derefs another `Arc<PipeReader>` to the same
/// allocation (e.g. `Cmd::buffered_output_close` reading `pipe.slice()`).
///
/// **Thread-confinement (no data race):** `PipeReader` holds raw
/// `*mut ShellSubprocess` / `*mut Interpreter` fields and is therefore
/// auto-`!Send + !Sync`; consequently `Arc<PipeReader>` is `!Send + !Sync`
/// too and cannot escape the JS thread. See the `static_assertions` below.
///
/// **Provenance:** `Arc::as_ptr` projects from the `NonNull<ArcInner<T>>`
/// stored by value (originating from `Box::into_raw`), so the returned
/// pointer carries the allocation's write permission — `cast_mut` is not a
/// shared-ref→mut laundering.
///
/// # Safety
/// - The `Arc` must be live for every use of the returned pointer.
/// - Any `&mut *result` borrow must not overlap a `&T` reached via another
///   `Arc` clone / `Arc::deref` of the same allocation.
#[inline]
fn arc_as_mut_ptr<T>(a: &Arc<T>) -> *mut T {
    Arc::as_ptr(a).cast_mut()
}

// Compile-time thread-confinement proof: `PipeReader`'s raw-pointer fields
// make it (and hence `Arc<PipeReader>`) `!Send + !Sync`, so the "Arc clone
// reaches another thread" data-race is structurally impossible. Stable Rust
// has no negative trait bounds, so this is the auto-trait-ambiguity trick:
// if `Arc<PipeReader>` ever gains `Send`/`Sync`, both blanket impls apply
// and `_NOT_SEND`/`_NOT_SYNC` fail to compile with "conflicting impls".
mod __pipe_reader_thread_confined {
    use super::{Arc, PipeReader};
    trait _NotSendCheck<A> {
        const OK: () = ();
    }
    impl<T: ?Sized> _NotSendCheck<()> for T {}
    impl<T: ?Sized + Send> _NotSendCheck<u8> for T {}
    trait _NotSyncCheck<A> {
        const OK: () = ();
    }
    impl<T: ?Sized> _NotSyncCheck<()> for T {}
    impl<T: ?Sized + Sync> _NotSyncCheck<u8> for T {}
    const _NOT_SEND: () = <Arc<PipeReader> as _NotSendCheck<_>>::OK;
    const _NOT_SYNC: () = <Arc<PipeReader> as _NotSyncCheck<_>>::OK;
}

/// Mutably borrow a `RefPtr<StaticPipeWriter>` payload.
///
/// `RefPtr` only exposes `&T` via `Deref`; the shell is single-threaded.
/// Localises the `(*buffer.as_ptr()).method()` pattern at the five
/// `Writable::Buffer` callsites.
///
/// # Safety
/// Caller must ensure no other `&`/`&mut StaticPipeWriter` to the same
/// payload is live for the returned borrow. The `(&RefPtr<T>) -> &mut T`
/// shape cannot encode this; `unsafe fn` keeps the obligation at the callsite.
#[inline]
#[allow(clippy::mut_from_ref)]
unsafe fn buffer_mut(buf: &RefPtr<StaticPipeWriter>) -> &mut StaticPipeWriter {
    // SAFETY: caller contract — single-threaded shell; `RefPtr` data is live
    // while the handle exists.
    unsafe { &mut *buf.as_ptr() }
}

/// Local helper: `ReadState` → tag-name string for logs.
#[inline]
fn read_state_str(s: ReadState) -> &'static str {
    match s {
        ReadState::Progress => "progress",
        ReadState::Eof => "eof",
        _ => "drained",
    }
}

pub use JscSubprocess::StdioKind;

use crate::shell::ShellErr;

#[cfg(windows)]
pub type StdioResult = WindowsStdioResult;
#[cfg(not(windows))]
pub type StdioResult = Option<Fd>;

/// RAII handle owning one intrusive ref on a heap `FileSink`. `FileSink`
/// carries its own `#[derive(CellRefCounted)]` refcount and is allocated via
/// `Box::into_raw` in `FileSink::create*`, so it cannot live behind an `Arc`.
/// Drop derefs (and frees on last ref) on teardown.
pub struct FileSinkPtr(core::ptr::NonNull<FileSink>);

impl FileSinkPtr {
    /// Adopt the +1 ref returned by `FileSink::create*`.
    ///
    /// # Safety
    /// `ptr` is non-null, points to a live `FileSink` from
    /// `FileSink::create*`, and the caller transfers its single owned ref to
    /// this handle.
    #[cfg(windows)]
    #[inline]
    unsafe fn adopt(ptr: *mut FileSink) -> Self {
        // SAFETY: caller contract — `ptr` is non-null.
        Self(unsafe { core::ptr::NonNull::new_unchecked(ptr) })
    }
}

impl core::ops::Deref for FileSinkPtr {
    type Target = FileSink;
    #[inline]
    fn deref(&self) -> &FileSink {
        // SAFETY: `adopt` contract — `self.0` is a live `FileSink` from
        // `FileSink::create*`; the held intrusive ref keeps it alive for `'_`.
        unsafe { self.0.as_ref() }
    }
}

impl core::ops::DerefMut for FileSinkPtr {
    #[inline]
    fn deref_mut(&mut self) -> &mut FileSink {
        // SAFETY: `adopt` contract — `self.0` is live; `&mut self` is exclusive
        // on this owning handle (FileSinkPtr is non-`Copy`, single-threaded
        // shell), so no other `&`/`&mut` to the `FileSink` overlaps.
        unsafe { self.0.as_mut() }
    }
}

impl Drop for FileSinkPtr {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `adopt` contract — `self.0` is live with one owned intrusive
        // ref; `FileSink::deref` (CellRefCounted derive) frees on zero.
        unsafe { FileSink::deref(self.0.as_ptr()) };
    }
}

bun_output::define_scoped_log!(log, SHELL_SUBPROC, visible);

/// Used for captured writer
#[derive(Default)]
pub struct ShellIO {
    pub stdout: Option<Arc<IOWriter>>,
    pub stderr: Option<Arc<IOWriter>>,
}

// Note: with `Arc<IOWriter>` the only correct way to
// retain is to *clone the Arc and keep it*; a freestanding `ref()` that
// discards the clone is a no-op. Callers hold their own `Arc` clones and
// `ShellIO`'s `Drop` releases them — no explicit ref/deref methods.

// ───────────────────────────────────────────────────────────────────────────
// ShellSubprocess
// ───────────────────────────────────────────────────────────────────────────

pub type Subprocess = ShellSubprocess;

pub const DEFAULT_MAX_BUFFER_SIZE: u32 = 1024 * 1024 * 4;

/// Backref from a heap-allocated [`ShellSubprocess`] to its owning `Cmd`.
///
/// Spec stores `cmd_parent: *ShellCmd` directly. In the NodeId-arena port the
/// `Cmd` lives **inline** in `Interpreter::nodes: Vec<Node>`, so a raw `*mut
/// Cmd` taken at spawn time dangles the moment a later `alloc_node` grows the
/// `Vec` (long pipelines hit this — every piped command pushes new Expansion /
/// Cmd nodes while earlier subprocesses' PipeReaders are still registered in
/// epoll). Store `(interp, NodeId)` instead and resolve through the arena at
/// each use site.
#[derive(Clone, Copy)]
pub struct CmdHandle {
    pub interp: bun_ptr::ParentRef<Interpreter>,
    pub id: NodeId,
}

impl CmdHandle {
    /// Resolve to the live `Cmd` slot. Single-threaded; the caller must not
    /// hold another `&Interpreter` across this borrow.
    ///
    /// # Safety
    /// `interp` must be live and `id` must still index a `Node::Cmd` slot
    /// (i.e. the Cmd has not yet been `free_node`d). Both hold for every call
    /// site: the subprocess / PipeReader callbacks fire strictly before
    /// `Cmd::deinit` recycles the slot.
    #[inline]
    pub unsafe fn cmd_mut(self) -> &'static mut ShellCmd {
        // SAFETY: per fn contract — `interp` constructed via `from_raw_mut`
        // (write provenance), single-threaded, no overlapping `&mut`.
        // `&'static mut T` forge — `bun_ptr::Interned` is read-only by
        // construction so does NOT cover this; tracked under the sibling
        // `static-widen-mut` pattern. Routed through `detach_lifetime_mut` so
        // the widen is centralised in `bun_ptr` and grep-able. The `'static` is
        // a lie scoped to the (3) callers, all of which drop the borrow before
        // `free_node` recycles the slot.
        unsafe { bun_ptr::detach_lifetime_mut(self.interp.assume_mut().as_cmd_mut(self.id)) }
    }
}

pub struct ShellSubprocess {
    pub cmd_parent: CmdHandle,

    /// Intrusively ref-counted process (`bun_ptr::ThreadSafeRefCount`).
    /// Stored raw because `Process` methods take `&mut self` and `RefPtr`
    /// only implements `Deref`; the shell is single-threaded so raw mutable
    /// access is sound.
    pub process: *mut Process,

    pub stdin: Writable,
    pub stdout: Readable,
    pub stderr: Readable,

    pub closed: EnumSet<StdioKind>,
}

pub type SignalCode = bun_core::SignalCode;

impl Drop for ShellSubprocess {
    fn drop(&mut self) {
        self.finalize_sync();
        log!("Deinit");
    }
}

// pub const Pipe = struct {
//     writer: Writer = Writer{},
//     parent: *Subprocess,
//     src: WriterSrc,
//
//     writer: ?CapturedBufferedWriter = null,
//
//     status: Status = .{
//         .pending = {},
//     },
// };

pub type StaticPipeWriter = JscSubprocess::NewStaticPipeWriter<ShellSubprocess>;

impl JscSubprocess::static_pipe_writer::StaticPipeWriterProcess for ShellSubprocess {
    const POLL_OWNER_TAG: bun_io::PollTag =
        bun_io::posix_event_loop::poll_tag::SHELL_STATIC_PIPE_WRITER;
    unsafe fn on_close_io(this: *mut Self, kind: StdioKind) {
        // SAFETY: caller (StaticPipeWriter) guarantees `this` is live.
        unsafe { (*this).on_close_io(kind) }
    }
}

bun_spawn::link_impl_ProcessExit! {
    Shell for ShellSubprocess => |this| {
        on_process_exit(process, status, rusage) =>
            (*this).on_process_exit(&*process, &status, rusage),
    }
}

impl ShellSubprocess {
    /// Borrow the intrusively ref-counted Process mutably.
    /// SAFETY-internal: shell is single-threaded; `self.process` is non-null
    /// for the lifetime of `ShellSubprocess` (set in `spawn_maybe_sync_impl`).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn proc(&self) -> &mut Process {
        // SAFETY: see doc comment.
        unsafe { &mut *self.process }
    }

    pub fn on_static_pipe_writer_done(&mut self) {
        log!(
            "Subproc(0x{:x}) onStaticPipeWriterDone(cmd={})",
            std::ptr::from_mut(self) as usize,
            self.cmd_parent.id
        );
        // SAFETY: cmd_parent backref resolves to the owning Cmd which outlives
        // the subprocess (freed only in `Cmd::deinit` after all stdio closes).
        unsafe { self.cmd_parent.cmd_mut() }.buffered_input_close();
    }

    pub fn has_exited(&self) -> bool {
        self.proc().has_exited()
    }

    pub fn r#ref(&mut self) {
        self.proc().enable_keeping_event_loop_alive();

        // self.stdin.ref();
        // }

        // if (!self.hasCalledGetter(.stdout)) {
        self.stdout.r#ref();
        // }

        // if (!self.hasCalledGetter(.stderr)) {
        self.stderr.r#ref();
        // }
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub fn unref<const _DEREF: bool>(&mut self) {
        self.proc().disable_keeping_event_loop_alive();

        self.stdout.unref();

        self.stderr.unref();
    }

    pub fn try_kill(&mut self, sig: i32) -> bun_sys::Result<()> {
        if self.has_exited() {
            return Ok(());
        }

        self.proc().kill(u8::try_from(sig).expect("int cast"))
    }

    fn close_process(&mut self) {
        let process = core::mem::replace(&mut self.process, core::ptr::null_mut());
        if process.is_null() {
            return;
        }
        // SAFETY: `process` was produced by `to_process` (heap::alloc) and is
        // live until the deref below drops the last strong ref.
        unsafe {
            (*process).set_exit_handler_default();
            (*process).close();
            // Release the intrusive ref taken by `to_process`. `*mut Process`
            // has no Drop, so this must be explicit.
            bun_ptr::ThreadSafeRefCount::<Process>::deref(process);
        }
    }

    pub fn close_io(&mut self, io: StdioKind) {
        if self.closed.contains(io) {
            return;
        }
        log!("close IO {}", <&'static str>::from(io));
        self.closed.insert(io);

        // If you never referenced stdout/stderr, they won't be garbage collected.
        //
        // That means:
        //   1. We need to stop watching them
        //   2. We need to free the memory
        //   3. We need to halt any pending reads (1)
        // if (!self.hasCalledGetter(io)) {
        match io {
            StdioKind::Stdin => self.stdin.finalize(),
            StdioKind::Stdout => self.stdout.finalize(),
            StdioKind::Stderr => self.stderr.finalize(),
        }
    }

    // This must only be run once per Subprocess
    pub fn finalize_sync(&mut self) {
        self.close_process();

        self.close_io(StdioKind::Stdin);
        self.close_io(StdioKind::Stdout);
        self.close_io(StdioKind::Stderr);
    }

    pub fn on_close_io(&mut self, kind: StdioKind) {
        match kind {
            StdioKind::Stdin => match &mut self.stdin {
                Writable::Pipe(pipe) => {
                    // DerefMut on the owning `&mut FileSinkPtr` encapsulates
                    // the access.
                    pipe.signal.with_mut(|s| s.clear());
                    // FileSinkPtr::drop derefs.
                    self.stdin = Writable::Ignore;
                }
                Writable::Buffer(_) => {
                    self.on_static_pipe_writer_done();
                    // RefPtr has no Drop — move it out before reassigning so the
                    // create ref is actually released.
                    if let Writable::Buffer(buffer) =
                        core::mem::replace(&mut self.stdin, Writable::Ignore)
                    {
                        // SAFETY: single-threaded; sole borrow of the payload.
                        unsafe { buffer_mut(&buffer) }.source.detach();
                        buffer.deref();
                    }
                }
                _ => {}
            },
            StdioKind::Stdout | StdioKind::Stderr => {
                let out: &mut Readable = match kind {
                    StdioKind::Stdout => &mut self.stdout,
                    StdioKind::Stderr => &mut self.stderr,
                    StdioKind::Stdin => unreachable!(),
                };
                if let Readable::Pipe(pipe) = core::mem::replace(out, Readable::Ignore) {
                    // The only callers reach here from inside
                    // `PipeReader::on_reader_done`/`on_reader_error`, which still
                    // hold a raw `*mut PipeReader` to this same allocation.
                    // Route every read/write through `Arc::as_ptr` (no `Deref`)
                    // so we never materialise a `&PipeReader` that would alias
                    // those callers' access; see `PipeReader::take_done_buffer`.
                    let pp = Arc::as_ptr(&pipe).cast_mut();
                    // SAFETY: `pp` projects from the Arc allocation's NonNull;
                    // raw place read of the discriminant + raw-ptr write
                    // through `take_done_buffer` (see its doc).
                    let buf = unsafe {
                        if matches!(&(*pp).state, PipeReaderState::Done(_)) {
                            Some(PipeReader::take_done_buffer(pp))
                        } else {
                            None
                        }
                    };
                    if let Some(buf) = buf {
                        *out = Readable::Buffer(buf);
                    } else {
                        *out = Readable::Ignore;
                    }
                    drop(pipe); // deref
                }
            }
        }
    }

    /// Tear down a subprocess whose stdio start() failed. Marks pending pipe readers as
    /// errored so PipeReader.deinit's done-assert passes, drops the exit handler so a
    /// later onProcessExit doesn't touch the freed Subprocess, then deinits.
    ///
    /// Windows: PipeReader.deinit asserts the libuv source is closed. Whether the source
    /// is uv-initialized depends on how far startWithCurrentPipe got, so a blind close or
    /// destroy is unsafe. Fall back to leaking the Subprocess (pre-existing behavior)
    /// rather than risk closing an uninitialized handle.
    fn abort_after_failed_start(this: *mut Self) {
        #[cfg(windows)]
        {
            let _ = this;
            return;
        }
        #[cfg(not(windows))]
        {
            // SAFETY: `this` was created via `heap::alloc` in `spawn` and is
            // uniquely owned here; reclaim and tear down.
            let mut subproc = unsafe { bun_core::heap::take(this) };
            for r in [&mut subproc.stdout, &mut subproc.stderr] {
                if let Readable::Pipe(pipe) = r {
                    // `start()` failed before any reader callback registered,
                    // so the `Arc` is expected to be uniquely held. Write
                    // unconditionally rather than via
                    // `Arc::get_mut`, which would silently skip the state
                    // transition if a future change bumped the strong count.
                    debug_assert_eq!(Arc::strong_count(pipe), 1);
                    // SAFETY: single-threaded shell; no other borrow live.
                    let p = unsafe { &mut *Arc::as_ptr(pipe).cast_mut() };
                    if matches!(p.state, PipeReaderState::Pending) {
                        p.state = PipeReaderState::Err(None);
                    }
                }
            }
            subproc.proc().set_exit_handler_default();
            // Dropping `subproc` runs `ShellSubprocess::drop` → `finalize_sync`.
        }
    }

    // `sh::Result`'s `ShellErr` is a shared shell-wide error type defined in
    // `shell_body.rs`; boxing it here would change `pub fn` signatures across
    // every `?`-propagating shell caller.
    #[allow(clippy::result_large_err)]
    pub fn spawn_async(
        event_loop: EventLoopHandle,
        shellio: &mut ShellIO,
        spawn_args_: SpawnArgs<'_>,
        cmd_parent: CmdHandle,
        // We have to use an out pointer because this function may invoke callbacks that expect a
        // fully initialized parent object. Writing to this out pointer may be the last step needed
        // to initialize the object. Raw (not `&mut`) so the caller can pass an
        // address inside the `Cmd` arena slot without holding a `&mut` borrow
        // across this re-entrant call.
        out: *mut *mut Self,
        notify_caller_process_already_exited: &mut bool,
    ) -> sh::Result<()> {
        let mut spawn_args = spawn_args_;

        match Self::spawn_maybe_sync_impl(
            event_loop,
            &mut spawn_args,
            shellio,
            cmd_parent,
            out,
            notify_caller_process_already_exited,
        ) {
            Ok(()) => Ok(()),
            Err(err) => Err(err),
        }
    }

    // See `spawn_async`: `sh::Result`'s `ShellErr` is shared shell-wide; not
    // boxable from this file.
    #[allow(clippy::result_large_err)]
    fn spawn_maybe_sync_impl(
        event_loop: EventLoopHandle,
        spawn_args: &mut SpawnArgs<'_>,
        shellio: &mut ShellIO,
        cmd_parent: CmdHandle,
        // We have to use an out pointer because this function may invoke callbacks that expect a
        // fully initialized parent object. Writing to this out pointer may be the last step needed
        // to initialize the object.
        out_subproc: *mut *mut Self,
        notify_caller_process_already_exited: &mut bool,
    ) -> sh::Result<()> {
        const IS_SYNC: bool = false;

        // Owns the `K=V\0` storage when inheriting the parent env. The struct
        // keeps the buffers alive until after `spawn_process` returns (the raw
        // pointers pushed into `env_array` borrow `inherited_env_storage.storage`).
        let inherited_env_storage: Option<bun_dotenv::NullDelimitedEnvMap> =
            if !spawn_args.override_env && spawn_args.env_array.is_empty() {
                let envmap = bun_core::handle_oom(event_loop.create_null_delimited_env_map());
                // Note: `as_slice()` *includes* the trailing null; strip it —
                // the common tail below re-appends one null terminator.
                let entries = envmap.as_slice();
                spawn_args
                    .env_array
                    .extend_from_slice(&entries[..entries.len().saturating_sub(1)]);
                Some(envmap)
            } else {
                None
            };
        let _ = &inherited_env_storage;

        // Until ownership transfers into Writable/Readable, deinit any caller-provided
        // stdio resources (memfd, ArrayBuffer.Strong, Blob) on early return so they
        // aren't leaked. Defused via `ScopeGuard::into_inner` once consumed.
        let mut stdio_guard = scopeguard::guard(&mut spawn_args.stdio, |stdio| {
            for s in stdio.iter_mut() {
                // Stdio's Drop impl handles resource teardown.
                *s = Stdio::Ignore;
            }
        });

        #[cfg(unix)]
        let no_sigpipe = if let Some(iowriter) = &shellio.stdout {
            !iowriter.is_socket()
        } else {
            true
        };

        // Hoist asSpawnOption results so a later one failing doesn't strand an earlier
        // Windows *uv.Pipe in an unbound temporary inside the struct initializer.
        // `mut` only for the Windows-only `.deinit()` rollback below.
        #[cfg_attr(not(windows), allow(unused_mut))]
        let mut stdin_opt = match stdio_guard[0].as_spawn_option(0) {
            stdio::ResultT::Result(opt) => opt,
            stdio::ResultT::Err(e) => {
                return Err(ShellErr::Custom(Box::<[u8]>::from(e.to_str())));
            }
        };
        #[cfg_attr(not(windows), allow(unused_mut))]
        let mut stdout_opt = match stdio_guard[1].as_spawn_option(1) {
            stdio::ResultT::Result(opt) => opt,
            stdio::ResultT::Err(e) => {
                #[cfg(windows)]
                stdin_opt.deinit();
                return Err(ShellErr::Custom(Box::<[u8]>::from(e.to_str())));
            }
        };
        let stderr_opt = match stdio_guard[2].as_spawn_option(2) {
            stdio::ResultT::Result(opt) => opt,
            stdio::ResultT::Err(e) => {
                #[cfg(windows)]
                {
                    stdin_opt.deinit();
                    stdout_opt.deinit();
                }
                return Err(ShellErr::Custom(Box::<[u8]>::from(e.to_str())));
            }
        };

        let mut spawn_options = SpawnOptions {
            cwd: spawn_args.cwd.into(),
            stdin: stdin_opt,
            stdout: stdout_opt,
            stderr: stderr_opt,
            #[cfg(windows)]
            windows: WindowsOptions {
                hide_window: true,
                loop_: event_loop,
                ..Default::default()
            },
            ..Default::default()
        };
        #[cfg(unix)]
        {
            spawn_options.no_sigpipe = no_sigpipe;
        }

        // Backref so PipeReader callbacks can drive `Yield::run` from async I/O
        // completion; plumbed explicitly through `SpawnArgs`.
        let interp = spawn_args.interp;
        // argv is built by the caller (Cmd::transition_to_exec) from
        // `Cmd.args`, NUL-terminated and null-sentinel-terminated, so this
        // function never needs to borrow the `Cmd` arena slot.
        debug_assert!(matches!(spawn_args.argv.last(), Some(p) if p.is_null()));

        spawn_args.env_array.push(core::ptr::null());

        // SAFETY: `spawn_args.argv` / `env_array` are local null-terminated
        // C-string arrays with argv[0] non-null; valid for this call.
        let spawn_result = match unsafe {
            bun_process::spawn_process(
                &spawn_options,
                spawn_args.argv.as_ptr(),
                spawn_args.env_array.as_ptr(),
            )
        } {
            Err(err) => {
                // WindowsSpawnOptions has no Drop
                // (its Stdio::Buffer/Ipc carry FFI-owned `*mut uv::Pipe` already
                // `uv_pipe_init`ed by spawn_process_windows before uv_spawn fails),
                // so an implicit `drop(spawn_options)` is a no-op and leaks the
                // pipe handles open in the uv loop. POSIX deinit is a no-op.
                #[cfg(windows)]
                {
                    spawn_options.stdin.deinit();
                    spawn_options.stdout.deinit();
                    spawn_options.stderr.deinit();
                    for extra in spawn_options.extra_fds.iter_mut() {
                        extra.deinit();
                    }
                }
                drop(spawn_options);
                let mut msg = Vec::<u8>::new();
                use std::io::Write;
                let _ = write!(&mut msg, "Failed to spawn process: {}", err.name());
                return Err(ShellErr::Custom(msg.into_boxed_slice()));
            }
            Ok(r) => match r {
                bun_sys::Result::Err(err) => {
                    #[cfg(windows)]
                    {
                        spawn_options.stdin.deinit();
                        spawn_options.stdout.deinit();
                        spawn_options.stderr.deinit();
                        for extra in spawn_options.extra_fds.iter_mut() {
                            extra.deinit();
                        }
                    }
                    drop(spawn_options);
                    return Err(ShellErr::Sys(err.to_shell_system_error()));
                }
                bun_sys::Result::Ok(result) => result,
            },
        };

        let mut spawn_result = spawn_result;

        // Note: Stdio impls Drop, so move out via mem::replace instead of clone.
        let stdio0 = core::mem::replace(&mut stdio_guard[0], Stdio::Ignore);
        let stdio1 = core::mem::replace(&mut stdio_guard[1], Stdio::Ignore);
        let stdio2 = core::mem::replace(&mut stdio_guard[2], Stdio::Ignore);

        // `to_process` consumes the result for pid/pidfd; pull the fd handles out first.
        let spawn_stdin = spawn_result.stdin.take();
        let spawn_stdout = spawn_result.stdout.take();
        let spawn_stderr = spawn_result.stderr.take();

        // Two-phase init: allocate the Subprocess slot first so the stable
        // `*mut Subprocess` is available to `Writable::init` / `Readable::init`
        // (they store it on StaticPipeWriter / PipeReader as a backref).
        let mut slot = Box::<Subprocess>::new_uninit();
        let subprocess: *mut Subprocess = slot.as_mut_ptr();
        // SAFETY: `out_subproc` points at the `SubprocExec.child` slot inside
        // the heap-stable `Box<SubprocExec>` staged by the caller before this
        // call; no `&` to that slot is live (the caller's `&mut Cmd` borrow
        // ended before the call). Written *before* any callback below
        // (`watch`/`start`/`read_all`) so re-entrant `Cmd` callbacks see a
        // populated `exec.subproc.child`.
        unsafe { *out_subproc = subprocess };

        let stdin = match Writable::init(stdio0, event_loop, subprocess, spawn_stdin) {
            Ok(w) => w,
            Err(WritableInitError::UnexpectedCreatingStdin) => {
                panic!("unexpected error while creating stdin");
            }
        };
        let stdout = Readable::init(
            OutKind::Stdout,
            stdio1,
            shellio.stdout.clone(),
            event_loop,
            subprocess,
            spawn_stdout,
            interp,
            DEFAULT_MAX_BUFFER_SIZE,
            true,
        );
        let stderr = Readable::init(
            OutKind::Stderr,
            stdio2,
            shellio.stderr.clone(),
            event_loop,
            subprocess,
            spawn_stderr,
            interp,
            DEFAULT_MAX_BUFFER_SIZE,
            true,
        );

        // SAFETY: `subprocess` points to uninitialised memory of the right
        // size/align (Box::new_uninit). `ptr::write` populates it without
        // dropping garbage.
        unsafe {
            subprocess.write(Subprocess {
                process: spawn_result.to_process(event_loop, IS_SYNC),
                stdin,
                stdout,
                stderr,
                cmd_parent,
                closed: EnumSet::empty(),
            });
        }
        // Ownership of the now-initialised Box is released as a raw pointer
        // (freed via `heap::take` in `abort_after_failed_start` / Cmd
        // teardown). `MaybeUninit<T>` and `T` share layout, so the cast is
        // sound.
        // SAFETY: fully initialised by the `write` above.
        let _ = bun_core::heap::into_raw(unsafe { slot.assume_init() });
        // SAFETY: subprocess was just allocated and is uniquely owned here.
        let subproc = unsafe { &mut *subprocess };
        // SAFETY: `subprocess` is the just-allocated `ShellSubprocess`; the
        // owning `Cmd` outlives the `Process` exit callback.
        subproc.proc().set_exit_handler(unsafe {
            bun_spawn::ProcessExit::new(bun_spawn::ProcessExitKind::Shell, subprocess)
        });
        let _ = scopeguard::ScopeGuard::into_inner(stdio_guard);

        // Wire the FileSink's close-signal back to the enclosing `Writable` so
        // `Writable::on_close` (drops the `Arc<FileSink>`) runs when the sink
        // finishes. `stdin` lives inside the Box-allocated `Subprocess` at a
        // stable address, so the self-referential raw pointer is sound for the
        // life of the subprocess. Only reachable on Windows (POSIX
        // `Writable::init` never returns `Pipe` for shell stdio).
        {
            // Derive `stdin_ptr` from the raw heap pointer (`subprocess`), not
            // the local `subproc: &mut` reborrow — the pointer is stored
            // long-term in `FileSink::signal` and dereferenced from
            // `Writable::on_close` after this frame returns. Under Stacked
            // Borrows a child of `subproc`'s tag would be invalidated when
            // that borrow ends; rooting in the allocation's provenance keeps
            // it valid for the box's lifetime.
            // SAFETY: `subprocess` is the live, fully-initialised heap alloc.
            let stdin_ptr: *mut Writable = unsafe { &raw mut (*subprocess).stdin };
            // SAFETY: reborrow as a child of `stdin_ptr` so it does not
            // invalidate the sibling we store in `signal`.
            if let Writable::Pipe(pipe) = unsafe { &mut *stdin_ptr } {
                // SAFETY: shell is single-threaded; the FileSink allocation is
                // disjoint from `*stdin_ptr`. `stdin_ptr` outlives the sink —
                // the Subprocess owns both and `Writable::on_close` is the only
                // path that drops the FileSinkPtr. `init_with_type` is
                // `unsafe fn` (caller asserts the handler outlives the
                // `Signal`).
                pipe.signal.set(unsafe {
                    webcore::streams::Signal::init_with_type::<Writable>(stdin_ptr)
                });
            }
        }

        match subproc.proc().watch() {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(_) => {
                *notify_caller_process_already_exited = true;
                spawn_args.lazy = false;
            }
        }

        if let Writable::Buffer(buffer) = &mut subproc.stdin {
            // SAFETY: single-threaded; `subproc` uniquely owned here.
            if let Err(err) = unsafe { buffer_mut(buffer) }.start() {
                let sys_err = err.to_shell_system_error();
                let _ = subproc.try_kill(SignalCode::SIGTERM as i32);
                Self::abort_after_failed_start(subprocess);
                return Err(ShellErr::Sys(sys_err));
            }
        }

        if let Err(err) = subproc
            .stdout
            .start_pipe_reader(subprocess, event_loop, !spawn_args.lazy)
        {
            let sys_err = err.to_shell_system_error();
            let _ = subproc.try_kill(SignalCode::SIGTERM as i32);
            Self::abort_after_failed_start(subprocess);
            return Err(ShellErr::Sys(sys_err));
        }

        if let Err(err) = subproc
            .stderr
            .start_pipe_reader(subprocess, event_loop, !spawn_args.lazy)
        {
            let sys_err = err.to_shell_system_error();
            let _ = subproc.try_kill(SignalCode::SIGTERM as i32);
            Self::abort_after_failed_start(subprocess);
            return Err(ShellErr::Sys(sys_err));
        }

        log!("returning");

        Ok(())
    }

    pub fn on_process_exit(&mut self, _: &Process, status: &Status, _: &Rusage) {
        log!("onProcessExit({:x})", std::ptr::from_mut(self) as usize);
        let exit_code: Option<u8> = 'brk: {
            if let Status::Exited(exited) = &status {
                break 'brk Some(exited.code);
            }

            if matches!(status, Status::Err(_)) {
                // TODO: handle error
            }

            if matches!(status, Status::Signaled(_)) {
                if let Some(code) = status.signal_code() {
                    break 'brk Some(code.to_exit_code().unwrap());
                }
            }

            break 'brk None;
        };

        if let Some(code) = exit_code {
            let handle = self.cmd_parent;
            // SAFETY: cmd_parent backref outlives subprocess; resolved
            // through the node arena so it survives `Vec<Node>` reallocation.
            // `&mut self` is dead by NLL before `on_exit` re-enters interp.
            let cmd = unsafe { handle.cmd_mut() };
            if cmd.exit_code.is_none() {
                cmd.on_exit(code.into());
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Writable
// ───────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum WritableInitError {
    #[error("UnexpectedCreatingStdin")]
    UnexpectedCreatingStdin,
}

pub enum Writable {
    Pipe(FileSinkPtr),
    Fd(Fd),
    Buffer(RefPtr<StaticPipeWriter>),
    Memfd(Fd),
    Inherit,
    Ignore,
}

impl Writable {
    // When the stream has closed we need to be notified to prevent a use-after-free
    // We can test for this use-after-free by enabling hot module reloading on a file and then saving it twice
    pub fn on_close(&mut self, _: Option<bun_sys::Error>) {
        match self {
            Writable::Buffer(_) | Writable::Pipe(_) => {
                // Dropping the Arc on reassignment below derefs.
            }
            _ => {}
        }
        *self = Writable::Ignore;
    }
    pub fn on_ready(&mut self, _: Option<blob::SizeType>, _: Option<blob::SizeType>) {}
    pub fn on_start(&mut self) {}
}

impl webcore::streams::SignalHandler for Writable {
    fn on_close(&mut self, err: Option<bun_sys::Error>) {
        Writable::on_close(self, err)
    }
    fn on_ready(&mut self, amount: Option<blob::SizeType>, offset: Option<blob::SizeType>) {
        Writable::on_ready(self, amount, offset)
    }
    fn on_start(&mut self) {
        Writable::on_start(self)
    }
}

impl Writable {
    pub fn init(
        stdio: Stdio,
        event_loop: EventLoopHandle,
        subprocess: *mut Subprocess,
        result: StdioResult,
    ) -> Result<Writable, WritableInitError> {
        assert_stdio_result!(result);

        // Note: `Stdio` impls Drop, so we cannot partially move out via
        // match (E0509). Dispatch on `&mut` and `mem::take` / ManuallyDrop the
        // non-Copy payloads.
        let mut stdio = stdio;
        #[cfg(windows)]
        {
            match &mut stdio {
                Stdio::Pipe | Stdio::ReadableStream(_) => {
                    if let StdioResult::Buffer(buf) = result {
                        // Ownership of the `Box<uv::Pipe>` transfers into the
                        // FileSink's writer.
                        let uv_pipe: *mut _ = bun_core::heap::into_raw(buf);
                        let pipe_ptr = FileSink::create_with_pipe(event_loop, uv_pipe);

                        // SAFETY: `create_with_pipe` returns a freshly-boxed
                        // non-null FileSink with refcount 1; sole reference.
                        match unsafe {
                            (*pipe_ptr).writer.with_mut(|w| w.start_with_current_pipe())
                        } {
                            bun_sys::Result::Ok(()) => {}
                            bun_sys::Result::Err(_err) => {
                                // SAFETY: pipe_ptr is live with refcount 1;
                                // deref frees it.
                                unsafe { FileSink::deref(pipe_ptr) };
                                return Err(WritableInitError::UnexpectedCreatingStdin);
                            }
                        }

                        // TODO: uncoment this when is ready, commented because was not compiling
                        // subprocess.weak_file_sink_stdin_ptr = pipe;
                        // subprocess.flags.has_stdin_destructor_called = false;

                        // SAFETY: `create_with_pipe` returns non-null with one
                        // owned ref; `adopt` takes it over.
                        return Ok(Writable::Pipe(unsafe { FileSinkPtr::adopt(pipe_ptr) }));
                    }
                    return Ok(Writable::Inherit);
                }

                Stdio::Blob(_) => {
                    // E0509: `Stdio` impls `Drop`, so the payload cannot be
                    // destructure-moved out. Take ownership via ManuallyDrop +
                    // ptr::read; the wrapper suppresses the Stdio destructor so
                    // the blob is moved exactly once.
                    let old =
                        core::mem::ManuallyDrop::new(core::mem::replace(&mut stdio, Stdio::Ignore));
                    // SAFETY: `old` is Blob (matched above) and ManuallyDrop
                    // prevents its Drop from running, so this is the sole move.
                    let blob = match &*old {
                        Stdio::Blob(b) => unsafe { core::ptr::read(b) },
                        _ => unreachable!(),
                    };
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        JscSubprocess::source_from_blob(blob),
                    )));
                }
                Stdio::ArrayBuffer(array_buffer) => {
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        JscSubprocess::source_from_array_buffer(core::mem::take(array_buffer)),
                    )));
                }
                Stdio::Fd(fd) => {
                    return Ok(Writable::Fd(*fd));
                }
                Stdio::Dup2(dup2) => {
                    return Ok(Writable::Fd(dup2.to.to_fd()));
                }
                Stdio::Inherit => {
                    return Ok(Writable::Inherit);
                }
                Stdio::Memfd(_) | Stdio::Path(_) | Stdio::Ignore => {
                    return Ok(Writable::Ignore);
                }
                Stdio::Ipc | Stdio::Capture(_) => {
                    return Ok(Writable::Ignore);
                }
                Stdio::SocketFd => {
                    // The shell never uses this; rejected at i < 3 anyway.
                    panic!("Unimplemented stdin socket-fd");
                }
            }
        }
        #[cfg(not(windows))]
        {
            match &mut stdio {
                Stdio::Dup2(_) => {
                    // The shell never uses this
                    panic!("Unimplemented stdin dup2");
                }
                Stdio::Pipe => {
                    // The shell never uses this
                    panic!("Unimplemented stdin pipe");
                }

                Stdio::Blob(_) => {
                    // E0509: `Stdio` impls `Drop`, so the payload cannot be
                    // destructure-moved out. Take ownership via ManuallyDrop +
                    // ptr::read; the wrapper suppresses the Stdio destructor so
                    // the blob is moved exactly once.
                    let old =
                        core::mem::ManuallyDrop::new(core::mem::replace(&mut stdio, Stdio::Ignore));
                    let blob = match &*old {
                        // SAFETY: `old` is Blob (matched above) and ManuallyDrop
                        // prevents its Drop from running, so this is the sole move.
                        Stdio::Blob(b) => unsafe { core::ptr::read(b) },
                        _ => unreachable!(),
                    };
                    Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        JscSubprocess::source_from_blob(blob),
                    )))
                }
                Stdio::ArrayBuffer(array_buffer) => Ok(Writable::Buffer(StaticPipeWriter::create(
                    event_loop,
                    subprocess,
                    result,
                    JscSubprocess::source_from_array_buffer(core::mem::take(array_buffer)),
                ))),
                Stdio::Memfd(memfd) => {
                    debug_assert!(memfd.is_valid());
                    let fd = *memfd;
                    // Ownership of the fd transfers to `Writable::Memfd`.
                    // Swap in `Ignore` and suppress the old value's destructor
                    // so `Stdio::Drop` doesn't close the fd we just took
                    // (`stdio = Stdio::Ignore` alone would drop+close the old
                    // `Stdio::Memfd`).
                    let _ =
                        core::mem::ManuallyDrop::new(core::mem::replace(&mut stdio, Stdio::Ignore));
                    Ok(Writable::Memfd(fd))
                }
                Stdio::Fd(_) => Ok(Writable::Fd(result.unwrap())),
                Stdio::Inherit => Ok(Writable::Inherit),
                Stdio::Path(_) | Stdio::Ignore => Ok(Writable::Ignore),
                Stdio::Ipc | Stdio::Capture(_) => Ok(Writable::Ignore),
                Stdio::ReadableStream(_) => {
                    // The shell never uses this
                    panic!("Unimplemented stdin readable_stream");
                }
                Stdio::SocketFd => {
                    // The shell never uses this; rejected at i < 3 anyway.
                    panic!("Unimplemented stdin socket-fd");
                }
            }
        }
    }

    // Note: there is intentionally no `Writable::toJS` here — the shell never
    // exposes its stdin Writable to JS.

    pub fn finalize(&mut self) {
        match self {
            Writable::Pipe(_) => {
                // deref via drop-on-reassign
                *self = Writable::Ignore;
            }
            Writable::Buffer(buffer) => {
                // SAFETY: single-threaded; temporary `&mut` for the call only.
                unsafe { buffer_mut(buffer) }.update_ref(false);
                // Intentionally does NOT reassign `*self` — the variant tag is
                // left as `Writable::Buffer`. RefPtr's Drop (on
                // Subprocess teardown) handles the final deref.
            }
            Writable::Memfd(fd) => {
                fd.close();
                *self = Writable::Ignore;
            }
            Writable::Ignore => {}
            Writable::Fd(_) | Writable::Inherit => {}
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Readable
// ───────────────────────────────────────────────────────────────────────────

pub enum Readable {
    Fd(Fd),
    Memfd(Fd),
    Pipe(Arc<PipeReader>),
    Inherit,
    Ignore,
    Closed,
    Buffer(Box<[u8]>),
}

impl Readable {
    /// If this is a `Pipe`, start its `BufferedReader` against `process` and
    /// (when `eager`) immediately drain it. Factors out the per-stream
    /// stdout/stderr start blocks in `spawn_maybe_sync_impl` so the
    /// `arc_as_mut_ptr` invariant is localised once.
    fn start_pipe_reader(
        &mut self,
        process: *mut ShellSubprocess,
        event_loop: EventLoopHandle,
        eager: bool,
    ) -> bun_sys::Result<()> {
        // `start` (poll registration failing) and `read_all` (the eager read
        // erroring) can both complete the reader synchronously, which runs
        // `close_io` → `Readable::finalize` and drops this slot's `Arc`.
        // Clone it so the `PipeReader` outlives both re-entrant calls.
        let keepalive = match self {
            Readable::Pipe(pipe) => Arc::clone(pipe),
            _ => return Ok(()),
        };
        let p = arc_as_mut_ptr(&keepalive);
        // SAFETY: see `arc_as_mut_ptr` — single-threaded shell; the
        // re-entrant reader callbacks only hold raw `*mut PipeReader`, so no
        // other `&PipeReader` can exist for this scope.
        let p = unsafe { &mut *p };
        p.start(process, event_loop)?;
        if eager {
            p.read_all();
        }
        Ok(())
    }

    pub fn r#ref(&mut self) {
        if let Readable::Pipe(pipe) = self {
            // SAFETY: see `arc_as_mut_ptr` — single-threaded shell; Windows
            // `BufferedReader::update_ref` needs `&mut` to touch the libuv
            // `Source` ref/unref. `update_ref` does not re-enter shell code.
            unsafe { &mut *arc_as_mut_ptr(pipe) }.update_ref(true);
        }
    }

    pub fn unref(&mut self) {
        if let Readable::Pipe(pipe) = self {
            // SAFETY: see `arc_as_mut_ptr` — single-threaded shell;
            // `update_ref` does not re-enter shell code.
            unsafe { &mut *arc_as_mut_ptr(pipe) }.update_ref(false);
        }
    }

    // Note: there is intentionally no `Readable::toSlice` here — subprocess
    // output is read via `PipeReader::buffered_output`.

    #[allow(clippy::too_many_arguments)]
    pub fn init(
        out_type: OutKind,
        stdio: Stdio,
        shellio: Option<Arc<IOWriter>>,
        event_loop: EventLoopHandle,
        process: *mut ShellSubprocess,
        result: StdioResult,
        interp: *mut crate::shell::interpreter::Interpreter,
        _max_size: u32,
        _is_sync: bool,
    ) -> Readable {
        assert_stdio_result!(result);

        // Note: `Stdio` impls Drop, so dispatch on `&mut` and `mem::take`
        // Default-able payloads instead of partial moves (E0509).
        let mut stdio = stdio;
        #[cfg(windows)]
        {
            return match &mut stdio {
                Stdio::Inherit => Readable::Inherit,
                Stdio::Ipc | Stdio::Dup2(_) | Stdio::Ignore => Readable::Ignore,
                Stdio::Path(_) => Readable::Ignore,
                Stdio::Fd(fd) => Readable::Fd(*fd),
                // blobs are immutable, so we should only ever get the case
                // where the user passed in a Blob with an fd
                Stdio::Blob(_) => Readable::Ignore,
                Stdio::Memfd(_) => Readable::Ignore,
                Stdio::Pipe => Readable::Pipe(PipeReader::create(
                    event_loop, process, result, None, out_type, interp,
                )),
                Stdio::ArrayBuffer(array_buffer) => {
                    let mut pipe =
                        PipeReader::create(event_loop, process, result, None, out_type, interp);
                    // The Arc was just created by `PipeReader::create` and is
                    // uniquely held (strong=1, weak=0) — `get_mut` is the
                    // safe route to set `buffered_output` before it's shared.
                    Arc::get_mut(&mut pipe)
                        .expect("fresh PipeReader Arc")
                        .buffered_output = BufferedOutput::ArrayBuffer {
                        buf: core::mem::take(array_buffer),
                        i: 0,
                    };
                    Readable::Pipe(pipe)
                }
                Stdio::Capture(_) => Readable::Pipe(PipeReader::create(
                    event_loop, process, result, shellio, out_type, interp,
                )),
                Stdio::ReadableStream(_) => Readable::Ignore, // Shell doesn't use readable_stream
                // The shell never uses this; rejected at i < 3 anyway.
                Stdio::SocketFd => Readable::Ignore,
            };
        }

        #[cfg(not(windows))]
        {
            match &mut stdio {
                Stdio::Inherit => Readable::Inherit,
                Stdio::Ipc | Stdio::Dup2(_) | Stdio::Ignore => Readable::Ignore,
                Stdio::Path(_) => Readable::Ignore,
                Stdio::Fd(_) => Readable::Fd(result.unwrap()),
                // blobs are immutable, so we should only ever get the case
                // where the user passed in a Blob with an fd
                Stdio::Blob(_) => Readable::Ignore,
                Stdio::Memfd(memfd) => {
                    let fd = *memfd;
                    // Ownership of the fd transfers to `Readable::Memfd`. Swap in
                    // `Ignore` and suppress the old value's destructor so
                    // `Stdio::Drop` doesn't close the fd we just took.
                    let _ =
                        core::mem::ManuallyDrop::new(core::mem::replace(&mut stdio, Stdio::Ignore));
                    Readable::Memfd(fd)
                }
                Stdio::Pipe => Readable::Pipe(PipeReader::create(
                    event_loop, process, result, None, out_type, interp,
                )),
                Stdio::ArrayBuffer(array_buffer) => {
                    let mut pipe =
                        PipeReader::create(event_loop, process, result, None, out_type, interp);
                    // The Arc was just created by `PipeReader::create` and is
                    // uniquely held (strong=1, weak=0) — `get_mut` is the safe
                    // route to set `buffered_output` before it's shared.
                    Arc::get_mut(&mut pipe)
                        .expect("fresh PipeReader Arc")
                        .buffered_output = BufferedOutput::ArrayBuffer {
                        buf: core::mem::take(array_buffer),
                        i: 0,
                    };
                    Readable::Pipe(pipe)
                }
                Stdio::Capture(_) => Readable::Pipe(PipeReader::create(
                    event_loop, process, result, shellio, out_type, interp,
                )),
                Stdio::ReadableStream(_) => Readable::Ignore, // Shell doesn't use readable_stream
                // The shell never uses this; rejected at i < 3 anyway.
                Stdio::SocketFd => Readable::Ignore,
            }
        }
    }

    pub fn finalize(&mut self) {
        match core::mem::replace(self, Readable::Closed) {
            Readable::Memfd(fd) => {
                *self = Readable::Closed;
                fd.close();
            }
            // .fd is borrowed from the shell's IOWriter (see IO.OutKind.to_subproc_stdio) or
            // a CowFd redirect; the owner closes it.
            Readable::Fd(_) => {
                *self = Readable::Closed;
            }
            Readable::Pipe(pipe) => {
                *self = Readable::Closed;
                pipe.detach();
            }
            other => {
                *self = other;
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// SpawnArgs
// ───────────────────────────────────────────────────────────────────────────

pub struct SpawnArgs<'a> {
    /// Shared borrow: arena alloc methods take `&self`, and a `&'a Arena`
    /// (being `Copy`) lets `fill_env` hand back `&'a [u8]` slices without
    /// the unsafe pointer round-trip the `&'a mut Arena` reborrow forced.
    pub arena: &'a Arena,
    /// `[*:null]?[*:0]const u8` argv view for `spawn_process`. Built by the
    /// caller from `Cmd.args` (each `Vec<u8>` NUL-terminated) so this struct
    /// never needs to borrow the `Cmd` arena slot — passing the whole `Cmd`
    /// would alias the `out_subproc` write into `cmd.exec.subproc.child`.
    /// Must include the trailing null sentinel.
    pub argv: Vec<*const c_char>,
    /// Backref so [`PipeReader`] async-I/O callbacks can drive
    /// [`Yield::run`]. The spawning `Cmd` passes it explicitly here and it is
    /// plumbed through `Readable::init` → `PipeReader::create`.
    pub interp: *mut crate::shell::interpreter::Interpreter,

    pub override_env: bool,
    pub env_array: Vec<*const c_char>,
    pub cwd: &'a [u8],
    pub stdio: [Stdio; 3],
    pub lazy: bool,
    pub path: &'a [u8],
    // ipc_mode: IPCMode,
    // ipc_callback: JSValue,
}

impl<'a> SpawnArgs<'a> {
    pub fn default<const IS_SYNC: bool>(
        arena: &'a Arena,
        interp: *mut crate::shell::interpreter::Interpreter,
        event_loop: EventLoopHandle,
    ) -> SpawnArgs<'a> {
        let mut out = SpawnArgs {
            arena,
            interp,
            argv: Vec::new(),

            override_env: false,
            env_array: Vec::new(),
            cwd: event_loop.top_level_dir(),
            stdio: [Stdio::Ignore, Stdio::Pipe, Stdio::Inherit],
            lazy: false,
            // PATH unset → fall back to _PATH_DEFPATH on POSIX (Android often
            // has no PATH). PATH="" (explicit empty) is preserved — that's a
            // deliberate "search nothing" and substituting a default would
            // change argv[0] resolution on existing platforms.
            // SAFETY: `event_loop.env()` returns the long-lived `*mut Loader`
            // owned by the VM (valid for the lifetime of the spawn args), and
            // `BUN_DEFAULT_PATH_FOR_SPAWN` is a NUL-terminated C-string constant.
            path: unsafe {
                if let Some(p) = (*event_loop.env()).get(b"PATH") {
                    p
                } else if cfg!(unix) {
                    core::ffi::CStr::from_ptr(BUN_DEFAULT_PATH_FOR_SPAWN).to_bytes()
                } else {
                    b""
                }
            },
            // .ipc_mode = IPCMode.none,
            // .ipc_callback = .zero,
        };

        if IS_SYNC {
            out.stdio[1] = Stdio::Pipe;
            out.stdio[2] = Stdio::Pipe;
        }
        out
    }

    /// `object_iter` should be a some type with the following fields:
    /// - `next() bool`
    pub fn fill_env<const DISABLE_PATH_LOOKUP_FOR_ARV0: bool>(
        &mut self,
        env_iter: &mut crate::shell::env_map::Iterator<'_>,
    ) {
        self.override_env = true;
        // Note: `bun_collections::array_hash_map::Iter` doesn't impl
        // `ExactSizeIterator`; use `size_hint` for the reservation.
        self.env_array
            .reserve_exact(env_iter.size_hint().0.saturating_sub(self.env_array.len()));

        if DISABLE_PATH_LOOKUP_FOR_ARV0 {
            // If the env object does not include a $PATH, it must disable path lookup for argv[0]
            self.path = b"";
        }

        while let Some(entry) = env_iter.next() {
            let key = entry.key_ptr.slice();
            let value = entry.value_ptr.slice();

            // Build a NUL-terminated `key=value` string in the spawn arena.
            // Bumpalo owns the bytes; freed when the spawn arena is reset.
            let len = key.len() + 1 + value.len();
            // `self.arena: &'a Arena` is `Copy`, so binding it yields the full
            // `'a` lifetime independent of the `&mut self` reborrow — the
            // returned slice is naturally `&'a mut [u8]`.
            let arena: &'a Arena = self.arena;
            let line: &'a mut [u8] = arena.alloc_slice_fill_default(len + 1);
            line[..key.len()].copy_from_slice(key);
            line[key.len()] = b'=';
            line[key.len() + 1..len].copy_from_slice(value);
            line[len] = 0;
            let line: &'a [u8] = line;

            if key == b"PATH" {
                self.path = &line[b"PATH=".len()..len];
            }

            self.env_array.push(line.as_ptr().cast::<c_char>());
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PipeReader
// ───────────────────────────────────────────────────────────────────────────

pub type IOReader = BufferedReader;

pub enum PipeReaderState {
    Pending,
    Done(Box<[u8]>),
    Err(Option<Box<SystemError>>),
}

pub struct PipeReader {
    pub reader: IOReader,
    pub process: Option<*mut ShellSubprocess>,
    pub event_loop: EventLoopHandle,
    pub state: PipeReaderState,
    pub stdio_result: StdioResult,
    pub out_type: OutKind,
    pub captured_writer: CapturedWriter,
    pub buffered_output: BufferedOutput,
    /// Backref so async read/write callbacks can drive `Yield::run`. See
    /// `IOWriter::interp` / `IOReader::interp` for the same pattern. Wired
    /// from `Cmd::interp` at `PipeReader::create` time.
    pub interp: *mut crate::shell::interpreter::Interpreter,
    // ref_count: handled by Arc<PipeReader>; mutation through shared handles
    // goes via the `arc_as_mut_ptr` interior-mutability helper below.
}

pub enum BufferedOutput {
    Bytelist(Vec<u8>),
    ArrayBuffer {
        buf: jsc::array_buffer::ArrayBufferStrong,
        i: u32,
    },
}

impl Default for BufferedOutput {
    fn default() -> Self {
        BufferedOutput::Bytelist(Vec::<u8>::default())
    }
}

impl BufferedOutput {
    #[inline]
    pub fn len(&self) -> usize {
        match self {
            BufferedOutput::Bytelist(b) => b.len() as usize,
            BufferedOutput::ArrayBuffer { i, .. } => *i as usize,
        }
    }

    pub fn slice(&self) -> &[u8] {
        match self {
            BufferedOutput::Bytelist(b) => b.slice(),
            BufferedOutput::ArrayBuffer { buf, .. } => buf.slice(),
        }
    }

    pub fn append(&mut self, bytes: &[u8]) {
        match self {
            BufferedOutput::Bytelist(b) => {
                let _ = b.append_slice(bytes); // OOM/capacity: fire-and-forget
            }
            BufferedOutput::ArrayBuffer { buf, i } => {
                let array_buf_slice = buf.slice_mut();
                let idx = *i as usize;
                // TODO: We should probably throw error here?
                if idx >= array_buf_slice.len() {
                    return;
                }
                let length = (array_buf_slice.len() - idx).min(bytes.len());
                array_buf_slice[idx..idx + length].copy_from_slice(&bytes[..length]);
                *i += u32::try_from(length).expect("int cast");
            }
        }
    }
}

impl Drop for BufferedOutput {
    fn drop(&mut self) {
        match self {
            BufferedOutput::Bytelist(_b) => {
                // Vec<u8> drops its own storage.
            }
            BufferedOutput::ArrayBuffer { buf, .. } => {
                if !buf.array_buffer.value.is_empty() {
                    buf.array_buffer.unpin();
                }
            }
        }
    }
}

pub struct CapturedWriter {
    pub dead: bool,
    /// `None` iff `dead == true`.
    pub writer: Option<Arc<IOWriter>>,
    pub written: usize,
    pub err: Option<SystemError>,
}

impl Default for CapturedWriter {
    fn default() -> Self {
        CapturedWriter {
            dead: true,
            writer: None,
            written: 0,
            err: None,
        }
    }
}

bun_core::impl_field_parent! { CapturedWriter => PipeReader.captured_writer; pub fn parent; fn parent_mut; }

impl CapturedWriter {
    pub fn do_write(&mut self, chunk: &[u8]) {
        if self.dead || self.err.is_some() {
            return;
        }

        log!(
            "CapturedWriter(0x{:x}, {}) doWrite len={} parent_amount={}",
            std::ptr::from_mut(self) as usize,
            out_kind_str(self.parent().out_type),
            chunk.len(),
            self.parent().buffered_output.len()
        );
        // `dead == false` ⇒ writer.is_some() (set in PipeReader::create).
        let writer = self
            .writer
            .clone()
            .expect("CapturedWriter live without writer");
        // The CapturedWriter lives outside the NodeId arena (embedded in a
        // heap-allocated PipeReader), so dispatch is by raw pointer — see
        // `io_writer::ChildPtr::subproc_capture` / `WriterTag::Subproc`.
        let child = io_writer::ChildPtr::subproc_capture(std::ptr::from_mut(self).cast::<c_void>());
        let y = writer.enqueue(child, None, chunk);
        // `parent()` recovers the enclosing `PipeReader` via the same
        // `from_field_ptr!` projection (encapsulated once there). The `&mut
        // self` access above is finished, so the shared `&PipeReader` is fine.
        self.parent().run_yield(y);
    }

    pub fn is_done(&self, just_written: usize) -> bool {
        log!(
            "CapturedWriter(0x{:x}, {}) isDone(has_err={}, parent_state={}, written={}, parent_amount={})",
            std::ptr::from_ref(self) as usize,
            out_kind_str(self.parent().out_type),
            self.err.is_some(),
            <&'static str>::from(&self.parent().state),
            self.written,
            self.parent().buffered_output.len()
        );
        if self.dead || self.err.is_some() {
            return true;
        }
        let p = self.parent();
        if matches!(p.state, PipeReaderState::Pending) {
            return false;
        }
        self.written + just_written >= self.parent().buffered_output.len()
    }

    pub fn on_iowriter_chunk(&mut self, amount: usize, err: Option<SystemError>) -> Yield {
        log!(
            "CapturedWriter({:x}, {}) onWrite({}, has_err={}) total_written={} total_to_write={}",
            std::ptr::from_mut(self) as usize,
            out_kind_str(self.parent().out_type),
            amount,
            err.is_some(),
            self.written + amount,
            self.parent().buffered_output.len()
        );
        self.written += amount;
        if let Some(e) = err {
            log!(
                "CapturedWriter(0x{:x}, {}) onWrite errno={} errmsg={} errfd={} syscall={}",
                std::ptr::from_mut(self) as usize,
                out_kind_str(self.parent().out_type),
                e.errno,
                e.message,
                e.fd,
                e.syscall
            );
            self.err = Some(e);
            // SAFETY: `parent_mut` recovers the embedding `PipeReader` via
            // `container_of`; raw-ptr form per `try_signal_done_to_cmd`
            // contract (no `&mut PipeReader` held across the Cmd re-entry).
            return unsafe { PipeReader::try_signal_done_to_cmd(self.parent_mut()) };
        } else if self.written >= self.parent().buffered_output.len()
            && !matches!(self.parent().state, PipeReaderState::Pending)
        {
            // SAFETY: as above.
            return unsafe { PipeReader::try_signal_done_to_cmd(self.parent_mut()) };
        }
        Yield::Suspended
    }
}

impl Drop for CapturedWriter {
    fn drop(&mut self) {
        // `bun_sys::SystemError` strings drop themselves.
        let _ = self.err.take();
        // self.writer Arc drops automatically.
    }
}

impl PipeReader {
    pub fn detach(self: Arc<Self>) {
        log!(
            "PipeReader(0x{:x}, {}) detach()",
            Arc::as_ptr(&self) as usize,
            out_kind_str(self.out_type)
        );
        // Clear the backref so any
        // late `on_reader_done`/`on_reader_error` after the Subprocess is freed
        // can't follow it. Arc only yields `&Self`; write through the
        // allocation pointer (single-threaded shell, no live `&`/`&mut` here).
        // SAFETY: see `arc_as_mut_ptr` rationale; field is a plain `Option<*mut _>`.
        unsafe { (*arc_as_mut_ptr(&self)).process = None };
        // Dropping `self` releases the strong ref.
    }

    pub fn is_done(&self) -> bool {
        log!(
            "PipeReader(0x{:x}, {}) isDone() state={} captured_writer_done={}",
            std::ptr::from_ref(self) as usize,
            out_kind_str(self.out_type),
            <&'static str>::from(&self.state),
            self.captured_writer.is_done(0)
        );
        if matches!(self.state, PipeReaderState::Pending) {
            return false;
        }
        self.captured_writer.is_done(0)
    }

    /// Drive a `Yield` from inside an async I/O callback. Mirrors
    /// `IOWriter::run_yield` / `IOReader::run_yield`. `interp` is wired at
    /// `create` time from the spawning `Cmd`; the null guard is a defensive
    /// debug-assert for tests that construct a PipeReader without a Cmd.
    pub(crate) fn run_yield(&self, y: Yield) {
        Self::run_yield_with(self.interp, y);
    }

    /// Free-function form of [`run_yield`] for callers that must not hold any
    /// `&PipeReader` borrow across the interpreter trampoline (which can
    /// re-derive `&PipeReader` via the `Readable::Pipe` `Arc`).
    pub(crate) fn run_yield_with(interp: *mut crate::shell::interpreter::Interpreter, y: Yield) {
        if interp.is_null() {
            debug_assert!(
                matches!(y, Yield::Done | Yield::Suspended | Yield::Failed),
                "PipeReader async callback fired without interp backref"
            );
            return;
        }
        // SAFETY: interp outlives every PipeReader (it owns the Cmd that
        // spawned the subprocess holding this reader). Single-threaded.
        y.run(unsafe { &*interp });
    }

    pub fn create(
        event_loop: EventLoopHandle,
        process: *mut ShellSubprocess,
        result: StdioResult,
        capture: Option<Arc<IOWriter>>,
        out_type: OutKind,
        interp: *mut crate::shell::interpreter::Interpreter,
    ) -> Arc<PipeReader> {
        // Allocate directly into the Arc so the address is stable BEFORE we
        // hand it to `reader.set_parent` / `container_of` consumers.
        // `Arc::from(Box<T>)` would reallocate into a new ArcInner and leave
        // every BufferedReader callback with a dangling parent pointer.
        //
        // `PipeReader` is deliberately `!Send + !Sync` (raw `*mut Interpreter`
        // / `*mut ShellSubprocess` fields); thread confinement is enforced at
        // compile time by `__pipe_reader_thread_confined`, so the `Arc` is a
        // refcount, not a cross-thread handle. `Rc` would
        // change the `pub fn create -> Arc<PipeReader>` ABI.
        #[allow(clippy::arc_with_non_send_sync)]
        let arc = Arc::new(PipeReader {
            process: Some(process),
            reader: IOReader::init::<PipeReader>(),
            event_loop,
            stdio_result: result,
            out_type,
            state: PipeReaderState::Pending,
            captured_writer: CapturedWriter::default(),
            buffered_output: BufferedOutput::default(),
            interp,
        });
        let this_ptr: *mut PipeReader = Arc::as_ptr(&arc).cast_mut();
        // SAFETY: `arc` is uniquely held; no other `&`/`&mut` to the payload
        // exists. Single-threaded shell.
        let this = unsafe { &mut *this_ptr };
        log!(
            "PipeReader(0x{:x}, {}) create()",
            this_ptr as usize,
            out_kind_str(this.out_type)
        );

        if let Some(cap) = capture {
            this.captured_writer.writer = Some(cap); // dupeRef → Arc clone already happened on pass-in
            this.captured_writer.dead = false;
        }

        #[cfg(windows)]
        {
            // With `Box<uv::Pipe>` the pipe cannot be aliased, so ownership
            // transfers to `reader.source` (`stdio_result` is never read again
            // on Windows — `start()` goes through `start_with_current_pipe`).
            this.reader.source = match core::mem::take(&mut this.stdio_result) {
                StdioResult::Buffer(buf) => Some(bun_io::Source::Pipe(buf)),
                StdioResult::BufferFd(fd) => {
                    // `Fd` is Copy; restore so `stdio_result` keeps reflecting
                    // the spawn outcome.
                    this.stdio_result = StdioResult::BufferFd(fd);
                    Some(bun_io::Source::File(bun_io::Source::open_file(fd)))
                }
                StdioResult::Unavailable => panic!("Shouldn't happen."),
            };
        }
        this.reader.set_parent(this_ptr.cast::<c_void>());

        arc
    }

    pub fn read_all(&mut self) {
        if matches!(self.state, PipeReaderState::Pending) {
            self.reader.read();
        }
    }

    pub fn start(
        &mut self,
        process: *mut ShellSubprocess,
        event_loop: EventLoopHandle,
    ) -> bun_sys::Result<()> {
        // self.ref();
        self.process = Some(process);
        self.event_loop = event_loop;
        #[cfg(windows)]
        {
            return self.reader.start_with_current_pipe();
        }

        #[cfg(not(windows))]
        match self.reader.start(self.stdio_result.unwrap(), true) {
            bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
            bun_sys::Result::Ok(()) => {
                // `reader.start` reports a poll-registration failure through
                // `on_reader_error` (not its return value), so the reader may
                // already be errored/torn down here; same guard as
                // `SubprocessPipeReader::start`.
                if matches!(self.state, PipeReaderState::Err(_)) {
                    return Ok(());
                }
                #[cfg(unix)]
                {
                    // TODO: are these flags correct
                    if let Some(poll) = self.reader.handle.get_poll() {
                        poll.set_flag(bun_io::FilePollFlag::Socket);
                    }
                    self.reader
                        .flags
                        .insert(bun_io::pipe_reader::PosixFlags::SOCKET);
                }

                Ok(())
            }
        }
    }

    /// `BufferedReaderParent::on_read_chunk` adapter — invoked with the
    /// `PipeReader` registered via `reader.set_parent(self)`.
    pub fn on_read_chunk(&mut self, chunk: &[u8], has_more: ReadState) -> bool {
        self.buffered_output.append(chunk);
        log!(
            "PipeReader(0x{:x}, {}) onReadChunk(chunk_len={}, has_more={})",
            std::ptr::from_mut(self) as usize,
            out_kind_str(self.out_type),
            chunk.len(),
            read_state_str(has_more)
        );

        self.captured_writer.do_write(chunk);

        // No explicit re-arm here (`register_poll()` on POSIX /
        // `start_with_current_pipe()` on Windows). This callback runs from
        // inside the bun_io read loop, which still holds `&mut self.reader`
        // on its stack and re-registers the poll itself based on the bool we
        // return (`IOReader::on_read_chunk_cb` and
        // `WindowsBufferedReader::on_read` document the same contract).
        //
        // Re-arming from here also violates `BufferedReaderParent`'s
        // requirement that `on_read_chunk` never frees the reader:
        // `register_poll()`'s failure path dispatches `on_reader_error`,
        // which drops the last `Arc<PipeReader>` and frees the
        // `PosixBufferedReader` the loop is still reading through.
        has_more != ReadState::Eof
    }

    /// Reconstruct an owning `Arc<Self>` from the raw parent pointer the
    /// `BufferedReader` stored at `set_parent` time. Keepalive for
    /// `on_reader_done` / `on_reader_error`:
    /// the returned guard keeps the allocation alive across
    /// `run_yield` (which may free the owning `Cmd`) and `on_close_io` (which
    /// drops the `Readable::Pipe` strong ref). Dropping the guard is the
    /// matching deref and may free `self`.
    ///
    /// # Safety
    /// `this` must point into a live `Arc<PipeReader>` allocation.
    #[inline]
    unsafe fn guard_from_raw(this: *mut Self) -> Arc<Self> {
        // SAFETY: caller contract.
        unsafe {
            Arc::increment_strong_count(this.cast_const());
            Arc::from_raw(this.cast_const())
        }
    }

    /// Tail shared by [`on_reader_done`] / [`on_reader_error`]: signal the
    /// owning `Cmd`, drive its `Yield`, then notify the `ShellSubprocess` to
    /// drop its `Readable::Pipe` handle. `guard` keeps `self` alive across
    /// the latter. No `&`/`&mut PipeReader` is held across the re-entrant
    /// `try_signal_done_to_cmd` / `run_yield_with` calls — both reach back
    /// into this same allocation via the `Readable::Pipe` `Arc` clone.
    ///
    /// NOTE: this does **not** gate on `is_done()` — the error path runs
    /// unconditionally. The `is_done()` early-return is `on_reader_done`-only
    /// and lives in [`on_reader_done`].
    fn finish_after_state_set(guard: &Arc<Self>) {
        let me = arc_as_mut_ptr(guard);
        // Snapshot `interp` *before* the Cmd call: `try_signal_done_to_cmd`
        // → `Cmd::buffered_output_close` → `close_io` may overwrite the
        // `Readable::Pipe` slot, and the trampoline must not re-read `*me`.
        // SAFETY: see `arc_as_mut_ptr`; raw read, no borrow held.
        let interp = unsafe { (*me).interp };
        // SAFETY: see `arc_as_mut_ptr` + `try_signal_done_to_cmd` contract —
        // raw `*mut`, no `&mut PipeReader` protector across the Cmd re-entry.
        let y = unsafe { Self::try_signal_done_to_cmd(me) };
        Self::run_yield_with(interp, y);
        if let Some(process) = guard.process {
            // SAFETY: `process` is the heap-allocated `ShellSubprocess` (stable
            // address), freed only by `Cmd::deinit` after every PipeReader has
            // signalled done (this call). `on_close_io` drops the
            // `Readable::Pipe` Arc — `guard` keeps `self` live past that.
            let proc = unsafe { &mut *process };
            let kind = guard.kind(proc);
            proc.on_close_io(kind);
        }
    }

    /// # Safety
    /// `this` must point into a live `Arc<PipeReader>` allocation (the pointer
    /// registered via `reader.set_parent`). Takes a raw pointer rather than
    /// `&mut self` because `on_close_io` below drops the `Readable::Pipe`
    /// `Arc` — holding a `&mut self` across that drop would dangle, and the
    /// `Arc::deref` inside `on_close_io` would alias it.
    pub unsafe fn on_reader_done(this: *mut Self) {
        // SAFETY: caller contract.
        let guard = unsafe { Self::guard_from_raw(this) };
        log!(
            "onReaderDone(0x{:x}, {})",
            this as usize,
            out_kind_str(guard.out_type)
        );
        {
            // SAFETY: see `arc_as_mut_ptr`; short-lived `&mut` for the
            // `state` write ends before `finish_after_state_set` re-enters.
            let me = unsafe { &mut *arc_as_mut_ptr(&guard) };
            let owned = me.to_owned_slice();
            me.state = PipeReaderState::Done(owned);
            // `on_reader_done` (only) waits for the
            // captured-writer tee to drain before signalling.
            if !me.is_done() {
                return;
            }
        }
        Self::finish_after_state_set(&guard);
        // Dropping `guard` is the matching `deref()`; may free `this`.
    }

    /// Spec `signalDoneToCmd`. Takes `*mut Self` (not `&mut self`) because
    /// the tail call into `Cmd::buffered_output_close` re-derives a
    /// `&PipeReader` to *this same allocation* via the `Readable::Pipe`
    /// `Arc` (for `pipe.slice()` and `close_io`). With a `&mut self`
    /// argument the Stacked-Borrows function-argument protector would make
    /// that re-derive UB; the raw pointer carries no protector, so all
    /// `&mut *this` borrows below are explicitly ended before the Cmd call.
    ///
    /// # Safety
    /// `this` must point to a live `PipeReader` inside its `Arc` allocation
    /// (single JS-thread; see [`arc_as_mut_ptr`]). No `&`/`&mut PipeReader`
    /// to the same object may be live across this call.
    pub unsafe fn try_signal_done_to_cmd(this: *mut Self) -> Yield {
        let (done, out_type, process) = {
            // SAFETY: caller contract — short-lived shared borrow for the
            // read-only `is_done()` / log; no Cmd re-entry yet.
            let me = unsafe { &*this };
            (me.is_done(), me.out_type, me.process)
        };
        if !done {
            return Yield::Suspended;
        }
        log!(
            "signalDoneToCmd ({:x}: {}) isDone={}",
            this as usize,
            out_kind_str(out_type),
            done
        );
        // `process` is `None` once `detach()` (via `close_io`) has run, i.e. this
        // reader already signalled its Cmd. The reader can still deliver terminal
        // callbacks after that (see `read_with_fn`'s EAGAIN arm), so no-op here.
        if let Some(proc) = process {
            // SAFETY: `proc` is the heap-allocated `ShellSubprocess` (stable
            // address) freed only by `Cmd::deinit`, which runs strictly after
            // every PipeReader has signalled done. `cmd_mut` resolves through
            // the node arena (see `CmdHandle`).
            let cmd = unsafe { (*proc).cmd_parent.cmd_mut() };
            let e: Option<SystemError> = {
                // SAFETY: caller contract — `&mut *this` for the field rewrites;
                // ends at the closing brace, *before* the `cmd` call below.
                let me = unsafe { &mut *this };
                if let Some(e) = me.captured_writer.err.take() {
                    // Transfer ownership of the error out of captured_writer so
                    // PipeReader.deinit doesn't deref the same SystemError twice.
                    match core::mem::replace(&mut me.state, PipeReaderState::Pending) {
                        PipeReaderState::Done(buf) => {
                            drop(buf);
                            me.state = PipeReaderState::Err(Some(Box::new(e)));
                        }
                        old @ PipeReaderState::Err(_) => {
                            me.state = old;
                        }
                        PipeReaderState::Pending => {
                            // unreachable after is_done() guard.
                            me.state = PipeReaderState::Err(Some(Box::new(e)));
                        }
                    }
                }
                // `bun_sys::SystemError` isn't ref-counted nor `Clone`.
                // Move it out (the only reader of
                // `state.Err` after this point is `Drop`, which tolerates `None`).
                if let PipeReaderState::Err(slot) = &mut me.state {
                    slot.take().map(|b| *b)
                } else {
                    None
                }
            };
            // No `&`/`&mut PipeReader` is live here; `buffered_output_close`
            // is free to deref the sibling `Arc<PipeReader>` in
            // `Readable::Pipe` for `pipe.slice()` / `close_io`.
            return cmd.buffered_output_close(out_type, e);
        }
        Yield::Suspended
    }

    pub fn kind(&self, process: &ShellSubprocess) -> StdioKind {
        if let Readable::Pipe(p) = &process.stdout {
            if Arc::as_ptr(p).cast() == std::ptr::from_ref(self) {
                return StdioKind::Stdout;
            }
        }

        if let Readable::Pipe(p) = &process.stderr {
            if Arc::as_ptr(p).cast() == std::ptr::from_ref(self) {
                return StdioKind::Stderr;
            }
        }

        panic!("We should be either stdout or stderr");
    }

    pub fn take_buffer(&mut self) -> Vec<u8> {
        self.reader.take_buffer()
    }

    pub fn slice(&self) -> &[u8] {
        self.buffered_output.slice()
    }

    pub fn to_owned_slice(&mut self) -> Box<[u8]> {
        if let PipeReaderState::Done(buf) = &mut self.state {
            return core::mem::take(buf);
        }
        // we do not use .toOwnedSlice() because we don't want to reallocate memory.
        let out = core::mem::take(&mut self.reader._buffer);

        if out.capacity() > 0 && out.is_empty() {
            drop(out);
            return Box::default();
        }
        out.into_boxed_slice()
        // PERF: into_boxed_slice may realloc to shrink. Profile if hot.
    }

    pub fn update_ref(&mut self, add: bool) {
        self.reader.update_ref(add);
    }

    /// # Safety
    /// See [`Self::on_reader_done`].
    pub unsafe fn on_reader_error(this: *mut Self, err: &bun_sys::Error) {
        log!("PipeReader(0x{:x}) onReaderError {:?}", this as usize, err);
        // SAFETY: caller contract.
        let guard = unsafe { Self::guard_from_raw(this) };
        {
            // SAFETY: see `arc_as_mut_ptr`; short-lived `&mut` for the
            // `state` write ends before `finish_after_state_set` re-enters.
            let me = unsafe { &mut *arc_as_mut_ptr(&guard) };
            if let PipeReaderState::Done(buf) =
                core::mem::replace(&mut me.state, PipeReaderState::Err(None))
            {
                drop(buf);
            }
            me.state = PipeReaderState::Err(Some(Box::new(err.to_system_error())));
        }
        Self::finish_after_state_set(&guard);
        // Dropping `guard` is the matching `deref()`; may free `this`.
    }

    pub fn r#loop(&self) -> *mut AsyncLoop {
        #[cfg(windows)]
        {
            self.event_loop.uv_loop()
        }
        #[cfg(not(windows))]
        {
            self.event_loop.r#loop()
        }
    }

    // Helper accessor used above to paper over Arc<PipeReader> interior mutability.
    //
    // Takes `*mut Self` (not `&self`) because `Arc<PipeReader>` only yields
    // `&Self`, and casting `&Self as *const Self as *mut Self` to write through is
    // immediate UB — shared-ref provenance is read-only. Callers obtain the pointer
    // via `Arc::as_ptr(&arc).cast_mut()`, which projects from the Arc allocation's
    // original `NonNull` without materializing a `&Self`.
    // The JS-thread single-mutator invariant means no live `&`/`&mut` to these
    // fields exists when this runs.
    unsafe fn take_done_buffer(this: *mut Self) -> Box<[u8]> {
        // SAFETY: see block comment above. Swaps the done buffer out, leaving
        // an empty one in its place.
        // `ptr::replace` reads/writes through the raw field pointer without
        // materializing a `&mut Self` (on_reader_done may still hold one on the
        // caller's stack via the BufferedReader parent backref).
        let old = unsafe {
            core::ptr::replace(
                core::ptr::addr_of_mut!((*this).state),
                PipeReaderState::Done(Box::default()),
            )
        };
        if let PipeReaderState::Done(buf) = old {
            return buf;
        }
        Box::default()
    }
}

impl Drop for PipeReader {
    fn drop(&mut self) {
        log!(
            "PipeReader(0x{:x}, {}) deinit()",
            std::ptr::from_mut(self) as usize,
            out_kind_str(self.out_type)
        );
        #[cfg(unix)]
        {
            debug_assert!(self.reader.is_done() || matches!(self.state, PipeReaderState::Err(_)));
        }

        #[cfg(windows)]
        {
            debug_assert!(
                self.reader.source.is_none() || self.reader.source.as_ref().unwrap().is_closed()
            );
        }

        // PipeReaderState::Done(Box<[u8]>) drops its buffer automatically.

        if !self.captured_writer.dead {
            // CapturedWriter::drop handles err.deref() and writer Arc drop.
        }

        if let PipeReaderState::Err(slot) = &mut self.state {
            *slot = None;
        }

        // buffered_output drops automatically.
        // reader drops automatically.
        // Box dealloc handled by Arc.
    }
}

// `on_reader_done`/`on_reader_error` forward the raw `*mut Self` (NOT
// autoref) — see their doc-comments: the body builds an `Arc` keepalive that
// may free `this` on drop, so a `&mut self` protector would be UB.
bun_io::impl_buffered_reader_parent! {
    ShellPipeReader for PipeReader;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| (*this).on_read_chunk(chunk, has_more);
    on_reader_done  = |this| PipeReader::on_reader_done(this);
    on_reader_error = |this, err| PipeReader::on_reader_error(this, &err);
    loop_           = |this| (*this).r#loop();
    event_loop      = |this| (*this).event_loop.as_event_loop_ctx();
}

// ───────────────────────────────────────────────────────────────────────────
// StdioKind & helpers
// ───────────────────────────────────────────────────────────────────────────

// `StdioKind` is re-exported from `crate::api::bun_subprocess` at the top of
// this file so the `StaticPipeWriterProcess` trait impl uses the exact same
// enum the trait was declared with.

// `StdioResult` is `Option<Fd>` (8-byte Copy) on unix but a non-Copy enum
// (`Buffer(Box<uv::Pipe>)`) on windows; a fn would have to pick by-value
// (moves on windows) or by-ref (clippy::trivially_copy_pass_by_ref on unix).
macro_rules! assert_stdio_result {
    ($result:expr) => {{
        #[cfg(all(debug_assertions, unix))]
        if let Some(fd) = &$result {
            debug_assert!(fd.is_valid());
        }
    }};
}
pub(crate) use assert_stdio_result;

unsafe extern "C" {
    // `_PATH_DEFPATH` string literal emitted from C; immutable, load-time
    // initialized, never null. Reading the pointer value has no precondition.
    pub safe static BUN_DEFAULT_PATH_FOR_SPAWN: *const c_char;
}

// IntoStaticStr for PipeReaderState (used in logs as the variant name).
impl From<&PipeReaderState> for &'static str {
    fn from(s: &PipeReaderState) -> &'static str {
        match s {
            PipeReaderState::Pending => "pending",
            PipeReaderState::Done(_) => "done",
            PipeReaderState::Err(_) => "err",
        }
    }
}
