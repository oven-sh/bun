#[cfg(not(windows))]
use core::cell::Cell;
use core::ffi::{c_char, c_void};
use std::rc::Rc;

#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
#[cfg(windows)]
use crate::api::bun::process::WindowsOptions;
use crate::api::bun::process::{self as bun_process, Process, SpawnOptions, Status};
use crate::api::bun::subprocess as JscSubprocess;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{self, IOWriter};
use crate::shell::{self as sh, Yield};
use crate::webcore::{self, FileSink};
use bun_alloc::Arena;
use bun_collections::VecExt;
use bun_core::{CStrList, CStrRef};
use bun_io::{BufferedReader, IoEvent, Owner, PollTag, ReadResult, ReadState};
use bun_jsc::{self as jsc, EventLoopHandle};
use bun_ptr::RefPtr;
use bun_spawn::subprocess::PipeState;
use bun_sys::{self, SystemError};
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

/// Raw `*mut T` into an `Rc<T>` payload.
///
/// Returns a **raw pointer**, not `&mut T`: an `(&Rc<T>) -> &mut T` accessor
/// is unsound by construction — it lets two `&mut T` (or a `&mut T` and a
/// sibling-clone `Rc::deref` `&T`) coexist, which the compiler treats as
/// `noalias`. Callers must materialise `&mut *p` only for a scope that does
/// **not** re-enter code that derefs another `Rc<PipeReader>` to the same
/// allocation (e.g. `Cmd::buffered_output_close` reading `pipe.slice()`).
///
/// **Thread-confinement (no data race):** `Rc` is `!Send + !Sync`, so no other
/// thread can reach the payload.
///
/// **Provenance:** `Rc::as_ptr` projects from the `NonNull<RcInner<T>>`
/// stored by value (originating from `Box::into_raw`), so the returned
/// pointer carries the allocation's write permission — `cast_mut` is not a
/// shared-ref→mut laundering.
///
/// # Safety
/// - The `Rc` must be live for every use of the returned pointer.
/// - Any `&mut *result` borrow must not overlap a `&T` reached via another
///   `Rc` clone / `Rc::deref` of the same allocation.
#[inline]
fn rc_as_mut_ptr<T>(a: &Rc<T>) -> *mut T {
    Rc::as_ptr(a).cast_mut()
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

use JscSubprocess::StaticPipeWriter;
pub(crate) use JscSubprocess::StdioKind;

use crate::shell::ShellErr;

pub(crate) use JscSubprocess::StdioResult;

bun_output::define_scoped_log!(log, SHELL_SUBPROC, visible);

/// Used for captured writer
#[derive(Default)]
pub(crate) struct ShellIO {
    pub(crate) stdout: Option<Rc<IOWriter>>,
    pub(crate) stderr: Option<Rc<IOWriter>>,
}

// Note: with `Rc<IOWriter>` the only correct way to
// retain is to *clone the Rc and keep it*; a freestanding `ref()` that
// discards the clone is a no-op. Callers hold their own `Rc` clones and
// `ShellIO`'s `Drop` releases them — no explicit ref/deref methods.

// ───────────────────────────────────────────────────────────────────────────
// ShellSubprocess
// ───────────────────────────────────────────────────────────────────────────

pub(crate) type Subprocess = ShellSubprocess;

pub(crate) const DEFAULT_MAX_BUFFER_SIZE: u32 = 1024 * 1024 * 4;

/// Backref from a heap-allocated [`ShellSubprocess`] to its owning `Cmd`.
/// Spec stores `cmd_parent: *ShellCmd` directly. In the NodeId-arena port the
/// `Cmd` lives **inline** in `Interpreter::nodes: Vec<Node>`, so a raw `*mut
/// Cmd` taken at spawn time dangles the moment a later `alloc_node` grows the
/// `Vec` (long pipelines hit this — every piped command pushes new Expansion /
/// Cmd nodes while earlier subprocesses' PipeReaders are still registered in
/// epoll). Store `(interp, NodeId)` instead and resolve through the arena at
/// each use site.
#[derive(Clone, Copy)]
pub(crate) struct CmdHandle {
    pub(crate) interp: bun_ptr::ParentRef<Interpreter>,
    pub(crate) id: NodeId,
}

impl CmdHandle {
    /// The `< ${buffer}` stdin writer closed. May free the subprocess.
    pub(crate) fn on_stdin_writer_close(self) {
        log!("onStdinWriterClose(cmd={})", self.id);
        // The `&mut Cmd` ends before the Yield runs.
        let y = self.interp.as_cmd_mut(self.id).buffered_input_close();
        y.run(&self.interp);
    }
}

pub(crate) struct ShellSubprocess {
    pub(crate) cmd_parent: CmdHandle,

    /// `None` once closed.
    pub(crate) process: Option<bun_process::ProcessHandle>,

    pub(crate) stdin: Writable,
    pub(crate) stdout: Readable,
    pub(crate) stderr: Readable,

    pub closed: EnumSet<StdioKind>,

    ctrl_c_child: Option<bun_spawn::ctrl_c::Child>,

    /// A child a `Bun.ModuleGraph`'s script started with `Bun.$` is killed with the graph.
    abort_handle: jsc::AbortHandle,
}

jsc::impl_abort_handle_owner!(ShellSubprocess, abort_handle, |this, cause| {
    // A child outlives the VM that spawned it, as one `Bun.spawn` started does.
    if !matches!(
        cause,
        jsc::AbortCause::ContextStopped(jsc::StopReason::VmTeardown)
    ) {
        // SAFETY: trait contract — `this` is live.
        let _ = unsafe { (*this).try_kill(SignalCode::SIGKILL as i32) };
    }
});

pub(crate) type SignalCode = bun_core::SignalCode;

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

bun_spawn::link_impl_ProcessExit! {
    Shell for ShellSubprocess => |this| {
        // Forwarded raw, not autoref'd: the callee may free `*this`.
        on_process_exit(status, _rusage) =>
            ShellSubprocess::on_process_exit(this, &status),
    }
}

impl ShellSubprocess {
    /// The shell is single-threaded; `process` is set for the lifetime of
    /// `ShellSubprocess` until `close_process`.
    #[inline]
    pub(crate) fn proc(&self) -> &bun_process::ProcessHandle {
        self.process.as_ref().expect("process closed")
    }

    /// Returns the `Cmd` to call `on_stdin_writer_close` on.
    #[must_use]
    pub(crate) fn on_stdin_io(&mut self, event: IoEvent) -> Option<CmdHandle> {
        let Writable::Buffer(buffer) = &self.stdin else {
            return None;
        };
        self.on_stdin_state(buffer.on_io(event))
    }

    #[must_use]
    fn on_stdin_state(&mut self, state: PipeState) -> Option<CmdHandle> {
        if state == PipeState::Open {
            return None;
        }
        self.stdin = Writable::Ignore;
        Some(self.cmd_parent)
    }

    pub(crate) fn has_exited(&self) -> bool {
        self.proc().has_exited()
    }

    pub(crate) fn r#ref(&mut self) {
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
    pub(crate) fn unref<const _DEREF: bool>(&mut self) {
        self.proc().disable_keeping_event_loop_alive();

        self.stdout.unref();

        self.stderr.unref();
    }

    pub(crate) fn try_kill(&mut self, sig: i32) -> bun_sys::Result<()> {
        if self.has_exited() {
            return Ok(());
        }

        self.proc().kill(u8::try_from(sig).expect("int cast"))
    }

    fn close_process(&mut self) {
        self.process = None;
    }

    pub(crate) fn close_io(&mut self, io: StdioKind) {
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
    pub(crate) fn finalize_sync(&mut self) {
        self.close_process();

        self.close_io(StdioKind::Stdin);
        self.close_io(StdioKind::Stdout);
        self.close_io(StdioKind::Stderr);
    }

    /// A stdout/stderr `PipeReader` finished: swap it out of its slot for its
    /// buffered bytes.
    pub(crate) fn on_close_io(&mut self, kind: StdioKind) {
        let out: &mut Readable = match kind {
            StdioKind::Stdout => &mut self.stdout,
            StdioKind::Stderr => &mut self.stderr,
            StdioKind::Stdin => unreachable!("stdin closes through on_stdin_state"),
        };
        if let Readable::Pipe(pipe) = core::mem::replace(out, Readable::Ignore) {
            let pp = Rc::as_ptr(&pipe).cast_mut();
            // SAFETY: `pp` projects from the Rc allocation's NonNull;
            // raw place read of the discriminant + raw-ptr write
            // through `take_done_buffer` (see its doc).
            let buf = unsafe {
                if matches!(&(*pp).state, PipeReaderState::Done(_)) {
                    Some(PipeReader::take_done_buffer(pp))
                } else {
                    None
                }
            };
            *out = if buf.is_some() {
                Readable::Buffer
            } else {
                Readable::Ignore
            };
            drop(pipe); // deref
        }
    }

    /// Tear down a subprocess whose stdin writer start() failed. Ends the child, marks pending pipe
    /// readers as errored so PipeReader.deinit's done-assert passes, drops the exit handler so
    /// a later onProcessExit doesn't touch the freed Subprocess, then deinits.
    ///
    /// Windows: leaks the subprocess, because dropping a `PipeReader` asserts that it has closed.
    fn abort_after_failed_start(this: *mut Self) {
        #[cfg(windows)]
        {
            // SAFETY: `this` is the live allocation; it is deliberately leaked below,
            // so release the Ctrl+C accounting by hand.
            unsafe {
                let _ = (*this).try_kill(SignalCode::SIGKILL as i32);
                (*this).ctrl_c_child = None;
            }
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
                    // so the `Rc` is expected to be uniquely held. Write
                    // unconditionally rather than via
                    // `Rc::get_mut`, which would silently skip the state
                    // transition if a future change bumped the strong count.
                    debug_assert_eq!(Rc::strong_count(pipe), 1);
                    let p = rc_as_mut_ptr(pipe);
                    // SAFETY: see `rc_as_mut_ptr` — single-threaded shell; no
                    // other borrow live. Accesses scoped to this statement.
                    unsafe {
                        if matches!((*p).state, PipeReaderState::Pending) {
                            (*p).state = PipeReaderState::Err(None);
                        }
                    }
                }
            }
            // Nothing reports its exit from here on, so nothing would reap it either.
            let _ = Process::kill_and_reap(
                subproc.proc().this_ptr(),
                &mut bun_core::ffi::zeroed::<bun_spawn::Rusage>(),
            );
            subproc.proc().set_exit_handler_default();
            // Dropping `subproc` runs `ShellSubprocess::drop` → `finalize_sync`.
        }
    }

    /// Stop stdio still active because the `Cmd` is deinited mid-flight (VM
    /// shutdown); a no-op after a normal close. Readers stop without firing
    /// `on_reader_done`, queued capture chunks are cancelled (the `IOWriter`
    /// queue holds a raw pointer into the freed `PipeReader`). POSIX-only, same tradeoff as
    /// [`Self::abort_after_failed_start`].
    #[cfg(not(windows))]
    pub(crate) fn deinit_in_flight_io(&mut self) {
        for slot in [&self.stdout, &self.stderr] {
            let pipe: *mut PipeReader = match slot {
                Readable::Pipe(pipe) => rc_as_mut_ptr(pipe),
                _ => continue,
            };
            // SAFETY: see `rc_as_mut_ptr` — single-threaded shell, no other
            // borrow of the `PipeReader` is live; neither `reader.deinit()`
            // nor `cancel_chunks` fires a callback.
            unsafe {
                if matches!((*pipe).state, PipeReaderState::Pending) {
                    // Deregisters the poll and closes the fd without
                    // `on_reader_done`; `Err` satisfies the drop's done-assert.
                    (*pipe).reader.deinit();
                    (*pipe).state = PipeReaderState::Err(None);
                }
                let captured: *mut CapturedWriter = &raw mut (*pipe).captured_writer;
                if let Some(writer) = (*captured).writer.take() {
                    writer.cancel_chunks(io_writer::ChildPtr::subproc_capture(
                        captured.cast::<c_void>(),
                    ));
                    (*captured).dead = true;
                }
            }
        }
    }

    /// `Heap::lastChanceToFinalize` deletes the `JSC::ArrayBuffer` impls
    /// before the sweep that reaches us, so dropping the redirect target's
    /// [`PinnedArrayBuffer`](jsc::PinnedArrayBuffer) would write to a
    /// freed impl; defuse it.
    ///
    /// VM-shutdown finalizer only (on a live heap this would leak the pin and
    /// GC root).
    #[cfg(not(windows))]
    pub(crate) fn defuse_array_buffer_unpins(&mut self) {
        for slot in [&self.stdout, &self.stderr] {
            let pipe: *mut PipeReader = match slot {
                Readable::Pipe(pipe) => rc_as_mut_ptr(pipe),
                _ => continue,
            };
            // SAFETY: see `rc_as_mut_ptr` — single-threaded shell, no other
            // borrow of the `PipeReader` is live.
            unsafe {
                if let BufferedOutput::ArrayBuffer { buf, .. } = &mut (*pipe).buffered_output {
                    buf.defuse();
                }
            }
        }
    }

    // `sh::Result`'s `ShellErr` is a shared shell-wide error type defined in
    // `shell_body.rs`; boxing it here would change `pub fn` signatures across
    // every `?`-propagating shell caller.
    #[allow(clippy::result_large_err)]
    pub(crate) fn spawn_async(
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
        #[cfg(unix)]
        let no_sigpipe = if let Some(iowriter) = &shellio.stdout {
            !iowriter.is_socket()
        } else {
            true
        };

        let mut spawn_option = |i: usize| match spawn_args.stdio[i].as_spawn_option(i as i32) {
            stdio::ResultT::Result(opt) => Ok(opt),
            stdio::ResultT::Err(e) => Err(ShellErr::Custom(Box::<[u8]>::from(e.to_str()))),
        };

        let spawn_options = SpawnOptions {
            stdin: spawn_option(0)?,
            stdout: spawn_option(1)?,
            stderr: spawn_option(2)?,
            cwd: spawn_args.cwd.into(),
            #[cfg(unix)]
            no_sigpipe,
            #[cfg(windows)]
            windows: WindowsOptions {
                hide_window: true,
                loop_: event_loop,
                ..Default::default()
            },
            ..Default::default()
        };

        // Backref so PipeReader callbacks can drive `Yield::run` from async I/O
        // completion.
        let interp = cmd_parent.interp;
        let argv = CStrList::from_unterminated(&mut spawn_args.argv);
        let envp = CStrList::from_unterminated(&mut spawn_args.env_array);

        let foreground = !interp.in_background(cmd_parent.id);
        let ctrl_c_child = foreground.then(bun_spawn::ctrl_c::Child::enter);
        crate::node::fs::note_process_start();
        let mut spawn_result = match bun_process::spawn_process(&spawn_options, argv, Some(envp)) {
            Err(err) => {
                let mut msg = Vec::<u8>::new();
                use std::io::Write;
                let _ = write!(&mut msg, "Failed to spawn process: {}", err.name());
                return Err(ShellErr::Custom(msg.into_boxed_slice()));
            }
            Ok(Err(err)) => return Err(ShellErr::Sys(err.to_shell_system_error())),
            Ok(Ok(result)) => result,
        };

        let stdio0 = core::mem::replace(&mut spawn_args.stdio[0], Stdio::Ignore);

        // `to_process` consumes the result for pid/pidfd; pull the fd handles out first.
        let spawn_stdin = spawn_result.stdin.take();
        let spawn_stdout = spawn_result.stdout.take();
        let spawn_stderr = spawn_result.stderr.take();

        // Two-phase init: allocate the Subprocess slot first so the stable
        // `*mut Subprocess` is available to `Writable::init` / `Readable::init`
        // (as the owner of the StaticPipeWriter, and a backref of the PipeReader). Freed via
        // `heap::take` in `abort_after_failed_start` (POSIX) / Cmd teardown.
        let subprocess: *mut Subprocess =
            bun_core::heap::into_raw(Box::<Subprocess>::new_uninit()).cast();
        // SAFETY: `out_subproc` points at the `SubprocExec.child` slot inside
        // the heap-stable `Box<SubprocExec>` staged by the caller before this
        // call; no `&` to that slot is live (the caller's `&mut Cmd` borrow
        // ended before the call). Written *before* any callback below
        // (`watch`/`start`/`read_all`) so re-entrant `Cmd` callbacks see a
        // populated `exec.subproc.child`.
        unsafe { *out_subproc = subprocess };

        // SAFETY: written to `subprocess` below.
        let stdin = unsafe {
            Writable::init(
                stdio0,
                #[cfg(windows)]
                event_loop,
                subprocess,
                spawn_stdin,
            )
        };
        let stdout = Readable::init(
            OutKind::Stdout,
            &spawn_args.stdio[1],
            spawn_args.redirect_stdout.take(),
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
            &spawn_args.stdio[2],
            spawn_args.redirect_stderr.take(),
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
                process: Some(spawn_result.to_process_handle(event_loop)),
                stdin,
                stdout,
                stderr,
                cmd_parent,
                closed: EnumSet::empty(),
                ctrl_c_child,
                abort_handle: jsc::AbortHandle::for_owner::<ShellSubprocess>(),
            });
        }
        // SAFETY: `subprocess` is the just-allocated `ShellSubprocess`; the
        // owning `Cmd` outlives the `Process` exit callback. All accesses
        // below are scoped so no borrow of the Subprocess spans the
        // re-entrant `watch`/`start`/`read_all` calls.
        unsafe {
            Process::set_exit_handler(
                (*subprocess).proc(),
                bun_spawn::ProcessExit::new(bun_spawn::ProcessExitKind::Shell, subprocess),
            );
        }
        if let Some(id) = cmd_parent.interp.context.get() {
            // Freed already (the graph was collected): `interrupted()` ends the script.
            if let Some(context) = jsc::virtual_machine::VirtualMachine::get().graph_context(id) {
                // SAFETY: `subprocess` is the live heap allocation; its handle is disarmed on drop.
                unsafe { jsc::AbortHandle::arm_owner(subprocess, context) };
            }
        }

        // Wire the FileSink's close-signal back to the enclosing `Writable` so
        // `Writable::on_close` (drops the `RefPtr<FileSink>`) runs when the sink
        // finishes. `stdin` lives inside the Box-allocated `Subprocess` at a
        // stable address, so the self-referential raw pointer is sound for the
        // life of the subprocess. Only reachable on Windows (POSIX
        // `Writable::init` never returns `Pipe` for shell stdio).
        {
            // Derive `stdin_ptr` from the raw heap pointer (`subprocess`), not
            // the local `subproc: &mut` reborrow — the pointer is stored
            // long-term in `FileSink::source` and dereferenced from
            // `Writable::on_close` after this frame returns. Under Stacked
            // Borrows a child of `subproc`'s tag would be invalidated when
            // that borrow ends; rooting in the allocation's provenance keeps
            // it valid for the box's lifetime.
            // SAFETY: `subprocess` is the live, fully-initialised heap alloc.
            let stdin_ptr: *mut Writable = unsafe { &raw mut (*subprocess).stdin };
            // SAFETY: reborrow as a child of `stdin_ptr` so it does not
            // invalidate the sibling we store in `source`.
            if let Writable::Pipe(pipe) = unsafe { &mut *stdin_ptr } {
                // SAFETY: shell is single-threaded; the FileSink allocation is
                // disjoint from `*stdin_ptr`. `stdin_ptr` outlives the sink —
                // the Subprocess owns both and `Writable::on_close` is the only
                // path that drops it.
                pipe.source
                    .set(webcore::streams::SourceHandle::ShellWritable(
                        // SAFETY: `stdin_ptr` is the live `&raw mut` writable (write provenance).
                        unsafe { bun_ptr::BackRef::from_raw_mut(stdin_ptr) },
                    ));
            }
        }

        // SAFETY: scoped access; `watch` does not re-enter the subprocess.
        match unsafe { (*subprocess).proc().watch() } {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(_) => {
                *notify_caller_process_already_exited = true;
                spawn_args.lazy = false;
            }
        }

        // SAFETY: borrow of the stdin slot scoped to this match; single-threaded.
        let stdin_started = match unsafe { &(*subprocess).stdin } {
            Writable::Buffer(buffer) => buffer.start(event_loop),
            _ => Ok(PipeState::Open),
        };
        match stdin_started {
            Ok(state) => {
                // SAFETY: `subprocess` is live, and the borrow ends with the call.
                if let Some(cmd) = unsafe { (*subprocess).on_stdin_state(state) } {
                    cmd.on_stdin_writer_close();
                }
            }
            Err(err) => {
                let sys_err = err.to_shell_system_error();
                Self::abort_after_failed_start(subprocess);
                return Err(ShellErr::Sys(sys_err));
            }
        }

        // SAFETY: `subprocess` is live; the slot is passed raw because the
        // reader can complete synchronously and overwrite it via `on_close_io`.
        unsafe {
            Readable::start_pipe_reader(&raw mut (*subprocess).stdout, !spawn_args.lazy);
        }

        // SAFETY: as for stdout above.
        unsafe {
            Readable::start_pipe_reader(&raw mut (*subprocess).stderr, !spawn_args.lazy);
        }

        log!("returning");

        Ok(())
    }

    /// # Safety
    /// `this` must be live and unborrowed; the Yield run here may free it.
    unsafe fn on_process_exit(this: *mut Self, status: &Status) {
        log!("onProcessExit({:x})", this as usize);
        // SAFETY: caller contract; the borrow ends at the `;`.
        let interrupted = unsafe { (*this).ctrl_c_child.take() }.is_some()
            && bun_spawn::ctrl_c::child_died_of_it(status);
        let exit_code: Option<u8> = 'brk: {
            if let Status::Exited(exited) = &status {
                #[cfg(windows)]
                if exited.raw == bun_sys::windows::STATUS_CONTROL_C_EXIT {
                    break 'brk Some(bun_sys::SignalCode::SIGINT.to_exit_code());
                }
                break 'brk Some(exited.code);
            }

            // How it ended is not known. The command has to finish all the same.
            if matches!(status, Status::Err(_)) {
                break 'brk Some(1);
            }

            if let Some(code) = status.signal().map(|signal| signal.to_exit_code()) {
                break 'brk Some(code);
            }

            break 'brk None;
        };

        let Some(code) = exit_code else { return };
        // SAFETY: caller contract; `CmdHandle` is `Copy`, no borrow is kept.
        let handle = unsafe { (*this).cmd_parent };
        // The `&mut Cmd` ends before the Yield runs.
        let cmd = handle.interp.as_cmd_mut(handle.id);
        cmd.base.interrupted |= interrupted;
        let y = cmd.on_exit(code.into());
        // May free `*this`.
        y.run(&handle.interp);
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Writable
// ───────────────────────────────────────────────────────────────────────────

pub enum Writable {
    Pipe(RefPtr<FileSink>),
    Fd,
    Buffer(StaticPipeWriter),
    Inherit,
    Ignore,
}

impl Writable {
    // When the stream has closed we need to be notified to prevent a use-after-free
    // We can test for this use-after-free by enabling hot module reloading on a file and then saving it twice
    pub fn on_close(&mut self, _: Option<bun_sys::Error>) {
        *self = Writable::Ignore;
    }
}

impl Writable {
    /// # Safety
    /// The result becomes the `stdin` of `subprocess`.
    unsafe fn init(
        stdio: Stdio,
        #[cfg(windows)] event_loop: EventLoopHandle,
        subprocess: *mut Subprocess,
        result: StdioResult,
    ) -> Writable {
        let owner = Owner::new(PollTag::ShellStdinWriter, subprocess.cast());
        // SAFETY: fn contract.
        let create_writer = |result, blob| unsafe { StaticPipeWriter::create(owner, result, blob) };
        #[cfg(windows)]
        {
            match stdio {
                Stdio::Pipe | Stdio::ReadableStream(_) => {
                    if let StdioResult::Buffer(buf) = result {
                        let pipe = FileSink::create_with_pipe(event_loop, buf);

                        // TODO: uncoment this when is ready, commented because was not compiling
                        // subprocess.weak_file_sink_stdin_ptr = pipe;
                        // subprocess.flags.has_stdin_destructor_called = false;

                        return Writable::Pipe(pipe);
                    }
                    return Writable::Inherit;
                }

                Stdio::Blob(blob) => {
                    return Writable::Buffer(create_writer(result, blob));
                }
                Stdio::Fd(_) | Stdio::Dup2(_) => {
                    return Writable::Fd;
                }
                Stdio::Inherit => {
                    return Writable::Inherit;
                }
                Stdio::Path(_) | Stdio::Ignore => {
                    return Writable::Ignore;
                }
                Stdio::Ipc | Stdio::Capture => {
                    return Writable::Ignore;
                }
                Stdio::SocketFd => {
                    // The shell never uses this; rejected at i < 3 anyway.
                    panic!("Unimplemented stdin socket-fd");
                }
            }
        }
        #[cfg(not(windows))]
        {
            match stdio {
                Stdio::Dup2(_) => {
                    // The shell never uses this
                    panic!("Unimplemented stdin dup2");
                }
                Stdio::Pipe => {
                    // The shell never uses this
                    panic!("Unimplemented stdin pipe");
                }

                Stdio::Blob(blob) => Writable::Buffer(create_writer(result, blob)),
                #[cfg(any(target_os = "linux", target_os = "android"))]
                Stdio::Memfd(_) => unreachable!("the shell makes no memfd"),
                Stdio::Fd(_) => Writable::Fd,
                Stdio::Inherit => Writable::Inherit,
                Stdio::Path(_) | Stdio::Ignore => Writable::Ignore,
                Stdio::Ipc | Stdio::Capture => Writable::Ignore,
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
            Writable::Pipe(_) | Writable::Buffer(_) => *self = Writable::Ignore,
            Writable::Ignore => {}
            Writable::Fd | Writable::Inherit => {}
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Readable
// ───────────────────────────────────────────────────────────────────────────

pub(crate) enum Readable {
    Fd,
    Pipe(Rc<PipeReader>),
    Inherit,
    Ignore,
    Closed,
    Buffer,
}

impl Readable {
    /// If the slot is a `Pipe`, start its `BufferedReader` and (when `eager`) immediately drain it.
    ///
    /// # Safety
    /// `slot` must point to a live `Readable`. Raw because `start`
    /// can complete the reader synchronously, which runs `close_io` →
    /// `Readable::finalize` and overwrites the slot — no reference to it may
    /// span that call.
    unsafe fn start_pipe_reader(slot: *mut Readable, eager: bool) {
        // The call below may drop this slot's `Rc`.
        // SAFETY: caller contract; borrow scoped to the clone.
        let keepalive = match unsafe { &*slot } {
            Readable::Pipe(pipe) => Rc::clone(pipe),
            _ => return,
        };
        keepalive.start(eager);
    }

    pub(crate) fn r#ref(&mut self) {
        if let Readable::Pipe(pipe) = self {
            pipe.reader.update_ref(true);
        }
    }

    pub(crate) fn unref(&mut self) {
        if let Readable::Pipe(pipe) = self {
            pipe.reader.update_ref(false);
        }
    }

    // Note: there is intentionally no `Readable::toSlice` here — subprocess
    // output is read via `PipeReader::buffered_output`.

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn init(
        out_type: OutKind,
        stdio: &Stdio,
        redirect_buf: Option<jsc::PinnedArrayBuffer>,
        shellio: Option<Rc<IOWriter>>,
        event_loop: EventLoopHandle,
        process: *mut ShellSubprocess,
        result: StdioResult,
        interp: bun_ptr::ParentRef<Interpreter>,
        _max_size: u32,
        _is_sync: bool,
    ) -> Readable {
        debug_assert!(redirect_buf.is_none() || matches!(stdio, Stdio::Pipe | Stdio::Capture));
        let buffered_output = match redirect_buf {
            Some(buf) => BufferedOutput::ArrayBuffer { buf, i: 0 },
            None => BufferedOutput::default(),
        };
        #[cfg(windows)]
        {
            return match stdio {
                Stdio::Inherit => Readable::Inherit,
                Stdio::Ipc | Stdio::Dup2(_) | Stdio::Ignore => Readable::Ignore,
                Stdio::Path(_) => Readable::Ignore,
                Stdio::Fd(_) => Readable::Fd,
                // blobs are immutable, so we should only ever get the case
                // where the user passed in a Blob with an fd
                Stdio::Blob(_) => Readable::Ignore,
                Stdio::Pipe => Readable::Pipe(PipeReader::create(
                    event_loop,
                    process,
                    result,
                    None,
                    buffered_output,
                    out_type,
                    interp,
                )),
                Stdio::Capture => Readable::Pipe(PipeReader::create(
                    event_loop,
                    process,
                    result,
                    shellio,
                    buffered_output,
                    out_type,
                    interp,
                )),
                Stdio::ReadableStream(_) => Readable::Ignore, // Shell doesn't use readable_stream
                // The shell never uses this; rejected at i < 3 anyway.
                Stdio::SocketFd => Readable::Ignore,
            };
        }

        #[cfg(not(windows))]
        {
            match stdio {
                Stdio::Inherit => Readable::Inherit,
                Stdio::Ipc | Stdio::Dup2(_) | Stdio::Ignore => Readable::Ignore,
                Stdio::Path(_) => Readable::Ignore,
                Stdio::Fd(_) => Readable::Fd,
                // blobs are immutable, so we should only ever get the case
                // where the user passed in a Blob with an fd
                Stdio::Blob(_) => Readable::Ignore,
                #[cfg(any(target_os = "linux", target_os = "android"))]
                Stdio::Memfd(_) => unreachable!("the shell makes no memfd"),
                Stdio::Pipe => Readable::Pipe(PipeReader::create(
                    event_loop,
                    process,
                    result,
                    None,
                    buffered_output,
                    out_type,
                    interp,
                )),
                Stdio::Capture => Readable::Pipe(PipeReader::create(
                    event_loop,
                    process,
                    result,
                    shellio,
                    buffered_output,
                    out_type,
                    interp,
                )),
                Stdio::ReadableStream(_) => Readable::Ignore, // Shell doesn't use readable_stream
                // The shell never uses this; rejected at i < 3 anyway.
                Stdio::SocketFd => Readable::Ignore,
            }
        }
    }

    pub(crate) fn finalize(&mut self) {
        match core::mem::replace(self, Readable::Closed) {
            Readable::Fd => {
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

pub(crate) struct SpawnArgs<'a> {
    /// Shared borrow: arena alloc methods take `&self`, and a `&'a Arena`
    /// (being `Copy`) lets `fill_env` hand back `&'a [u8]` slices without
    /// the unsafe pointer round-trip the `&'a mut Arena` reborrow forced.
    pub(crate) arena: &'a Arena,
    /// The argv for `spawn_process`, without its terminator. Built by the
    /// caller from `Cmd.args` (each `Vec<u8>` NUL-terminated) so this struct
    /// never needs to borrow the `Cmd` arena slot — passing the whole `Cmd`
    /// would alias the `out_subproc` write into `cmd.exec.subproc.child`.
    pub(crate) argv: Vec<Option<CStrRef<'a>>>,

    pub(crate) env_array: Vec<Option<CStrRef<'a>>>,
    pub(crate) cwd: &'a [u8],
    pub(crate) stdio: [Stdio; 3],
    /// `> ${arraybuffer}` redirect targets; the matching `stdio` slot is `Pipe`.
    pub(crate) redirect_stdout: Option<jsc::PinnedArrayBuffer>,
    pub(crate) redirect_stderr: Option<jsc::PinnedArrayBuffer>,
    pub(crate) lazy: bool,
    pub path: &'a [u8],
    // ipc_mode: IPCMode,
    // ipc_callback: JSValue,
}

impl<'a> SpawnArgs<'a> {
    pub(crate) fn default<const IS_SYNC: bool>(
        arena: &'a Arena,
        event_loop: EventLoopHandle,
    ) -> SpawnArgs<'a> {
        let mut out = SpawnArgs {
            arena,
            argv: Vec::new(),

            env_array: Vec::new(),
            cwd: b"",
            stdio: [Stdio::Ignore, Stdio::Pipe, Stdio::Inherit],
            redirect_stdout: None,
            redirect_stderr: None,
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
    pub(crate) fn fill_env<const DISABLE_PATH_LOOKUP_FOR_ARV0: bool>(
        &mut self,
        env_iter: &mut crate::shell::env_map::Iterator<'_>,
    ) {
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

            (self.env_array).push(Some(CStrRef::from_slice_with_nul(line)));
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PipeReader
// ───────────────────────────────────────────────────────────────────────────

pub enum PipeReaderState {
    Pending,
    Done(Box<[u8]>),
    Err(Option<Box<SystemError>>),
}

pub(crate) struct PipeReader {
    pub(crate) reader: BufferedReader,
    pub(crate) process: Option<*mut ShellSubprocess>,
    pub(crate) event_loop: EventLoopHandle,
    pub(crate) state: PipeReaderState,
    #[cfg(not(windows))]
    stdio_result: Cell<StdioResult>,
    pub(crate) out_type: OutKind,
    pub(crate) captured_writer: CapturedWriter,
    pub(crate) buffered_output: BufferedOutput,
    /// Backref so async read/write callbacks can drive `Yield::run`. See
    /// `IOWriter::interp` / `IOReader::interp` for the same pattern. Wired
    /// from `CmdHandle::interp` at `PipeReader::create` time.
    pub(crate) interp: bun_ptr::ParentRef<Interpreter>,
    // ref_count: handled by Rc<PipeReader>; mutation through shared handles
    // goes via the `rc_as_mut_ptr` interior-mutability helper below.
}

pub(crate) enum BufferedOutput {
    Bytelist(Vec<u8>),
    ArrayBuffer { buf: jsc::PinnedArrayBuffer, i: u32 },
}

impl Default for BufferedOutput {
    fn default() -> Self {
        BufferedOutput::Bytelist(Vec::<u8>::default())
    }
}

impl BufferedOutput {
    #[inline]
    pub(crate) fn len(&self) -> usize {
        match self {
            BufferedOutput::Bytelist(b) => b.len() as usize,
            BufferedOutput::ArrayBuffer { i, .. } => *i as usize,
        }
    }

    /// Returns the bytes the command has written so far. With `2>&1 ${buf}`, the tee reads them from the `ArrayBuffer`.
    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            BufferedOutput::Bytelist(b) => b.slice(),
            BufferedOutput::ArrayBuffer { buf, i } => {
                let live = buf.live_slice();
                &live[..(*i as usize).min(live.len())]
            }
        }
    }

    pub(crate) fn append(&mut self, bytes: &[u8]) {
        match self {
            BufferedOutput::Bytelist(b) => {
                let _ = b.append_slice(bytes); // OOM/capacity: fire-and-forget
            }
            BufferedOutput::ArrayBuffer { buf, i } => {
                // JS can resize the buffer between chunks.
                let array_buf_slice = buf.live_slice_mut();
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

pub(crate) struct CapturedWriter {
    pub(crate) dead: bool,
    /// `None` iff `dead == true`.
    pub(crate) writer: Option<Rc<IOWriter>>,
    pub(crate) written: usize,
    pub(crate) err: Option<SystemError>,
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

bun_core::impl_field_parent! { CapturedWriter => PipeReader.captured_writer; fn parent; fn mut parent_mut; }

impl CapturedWriter {
    pub(crate) fn do_write(&mut self, chunk: &[u8]) {
        if self.dead || self.err.is_some() {
            return;
        }

        let addr = std::ptr::from_mut(self) as usize;
        let parent = self.parent();
        log!(
            "CapturedWriter(0x{:x}, {}) doWrite len={} parent_amount={}",
            addr,
            out_kind_str(parent.out_type),
            chunk.len(),
            parent.buffered_output.len()
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
        self.parent().run_yield(y);
    }

    pub(crate) fn on_iowriter_chunk(&mut self, amount: usize, err: Option<SystemError>) -> Yield {
        let addr = std::ptr::from_mut(self) as usize;
        let written = self.written + amount;
        let parent = self.parent();
        log!(
            "CapturedWriter({:x}, {}) onWrite({}, has_err={}) total_written={} total_to_write={}",
            addr,
            out_kind_str(parent.out_type),
            amount,
            err.is_some(),
            written,
            parent.buffered_output.len()
        );
        let all_written = written >= parent.buffered_output.len()
            && !matches!(parent.state, PipeReaderState::Pending);
        self.written = written;
        if let Some(e) = err {
            log!(
                "CapturedWriter(0x{:x}, {}) onWrite errno={} errmsg={} errfd={:?} syscall={}",
                addr,
                out_kind_str(self.parent().out_type),
                e.errno,
                e.message,
                e.fd,
                e.syscall
            );
            self.err = Some(e);
            // The Cmd signaled below can free this PipeReader, so the chunks still queued must not call back.
            if let Some(writer) = self.writer.clone() {
                let child = std::ptr::from_mut(self).cast::<c_void>();
                writer.cancel_chunks(io_writer::ChildPtr::subproc_capture(child));
            }
        } else if !all_written {
            return Yield::Suspended;
        }
        // SAFETY: `parent_mut` recovers the embedding `PipeReader`; raw-ptr
        // form per `try_signal_done_to_cmd` contract (no `&mut PipeReader`
        // held across the Cmd re-entry).
        unsafe { PipeReader::try_signal_done_to_cmd(self.parent_mut()) }
    }
}

impl PipeReader {
    fn captured_writer_done(&self, just_written: usize) -> bool {
        let cw = &self.captured_writer;
        log!(
            "CapturedWriter(0x{:x}, {}) isDone(has_err={}, parent_state={}, written={}, parent_amount={})",
            std::ptr::from_ref(cw) as usize,
            out_kind_str(self.out_type),
            cw.err.is_some(),
            <&'static str>::from(&self.state),
            cw.written,
            self.buffered_output.len()
        );
        if cw.dead || cw.err.is_some() {
            return true;
        }
        if matches!(self.state, PipeReaderState::Pending) {
            return false;
        }
        cw.written + just_written >= self.buffered_output.len()
    }
}

impl PipeReader {
    pub(crate) fn detach(self: Rc<Self>) {
        log!(
            "PipeReader(0x{:x}, {}) detach()",
            Rc::as_ptr(&self) as usize,
            out_kind_str(self.out_type)
        );
        // Clear the backref so any
        // late `on_reader_done`/`on_reader_error` after the Subprocess is freed
        // can't follow it. Rc only yields `&Self`; write through the
        // allocation pointer (single-threaded shell, no live `&`/`&mut` here).
        // SAFETY: see `rc_as_mut_ptr` rationale; field is a plain `Option<*mut _>`.
        unsafe { (*rc_as_mut_ptr(&self)).process = None };
        // Dropping `self` releases the strong ref.
    }

    pub(crate) fn is_done(&self) -> bool {
        log!(
            "PipeReader(0x{:x}, {}) isDone() state={} captured_writer_done={}",
            std::ptr::from_ref(self) as usize,
            out_kind_str(self.out_type),
            <&'static str>::from(&self.state),
            self.captured_writer_done(0)
        );
        if matches!(self.state, PipeReaderState::Pending) {
            return false;
        }
        self.captured_writer_done(0)
    }

    /// Drive a `Yield` from inside an async I/O callback. Mirrors
    /// `IOWriter::run_yield` / `IOReader::run_yield`. `interp` is wired at
    /// `create` time from the spawning `Cmd`.
    fn run_yield(&self, y: Yield) {
        Self::run_yield_with(self.interp, y);
    }

    /// Free-function form of [`run_yield`] for callers that must not hold any
    /// `&PipeReader` borrow across the interpreter trampoline (which can
    /// re-derive `&PipeReader` via the `Readable::Pipe` `Rc`).
    fn run_yield_with(interp: bun_ptr::ParentRef<Interpreter>, y: Yield) {
        y.run(&interp);
    }

    pub(crate) fn create(
        event_loop: EventLoopHandle,
        process: *mut ShellSubprocess,
        result: StdioResult,
        capture: Option<Rc<IOWriter>>,
        buffered_output: BufferedOutput,
        out_type: OutKind,
        interp: bun_ptr::ParentRef<Interpreter>,
    ) -> Rc<PipeReader> {
        let mut captured_writer = CapturedWriter::default();
        if let Some(cap) = capture {
            captured_writer.writer = Some(cap); // dupeRef → Rc clone already happened on pass-in
            captured_writer.dead = false;
        }

        let rc = Rc::new(PipeReader {
            process: Some(process),
            reader: BufferedReader::init(),
            event_loop,
            #[cfg(not(windows))]
            stdio_result: Cell::new(result),
            out_type,
            state: PipeReaderState::Pending,
            captured_writer,
            buffered_output,
            interp,
        });
        let this_ptr: *mut PipeReader = Rc::as_ptr(&rc).cast_mut();
        log!(
            "PipeReader(0x{:x}, {}) create()",
            this_ptr as usize,
            out_kind_str(out_type)
        );
        let owner = Owner::new(PollTag::ShellPipeReader, this_ptr.cast());
        // SAFETY: `owner` points to the heap allocation that holds this reader.
        unsafe { rc.reader.set_owner(owner) };
        // `start()` goes through `start_with_current_pipe`.
        #[cfg(windows)]
        rc.reader.set_source(match result {
            StdioResult::Buffer(buf) => bun_io::Source::Pipe(buf),
            StdioResult::BufferFd(fd) => {
                let file = bun_sys::File::from_fd(fd).into();
                bun_io::Source::File(bun_io::Source::open_file(event_loop.loop_(), file))
            }
            StdioResult::UnownedFd(_) | StdioResult::Unavailable => panic!("Shouldn't happen."),
        });

        rc
    }

    fn start(self: &Rc<Self>, eager: bool) {
        #[cfg(windows)]
        let started = self
            .reader
            .start_with_current_pipe()
            .map(|()| ReadResult::Pending);
        #[cfg(not(windows))]
        let started = self.reader.start(
            self.event_loop.as_event_loop_ctx(),
            self.stdio_result.take().unwrap().into(),
            true,
        );
        match started {
            Ok(ReadResult::Pending) => {}
            Ok(result) => return self.on_read_result(result),
            // Windows only. A read error, so that the `Cmd` is still alive when the child exits.
            Err(err) => {
                self.reader.deinit();
                return self.on_reader_error(&err);
            }
        }
        // TODO: are these flags correct
        #[cfg(unix)]
        self.reader
            .update_flags(|f| f.insert(bun_io::PosixFlags::SOCKET));
        if eager {
            self.read(None);
        }
    }

    /// The `Cmd` may drop every other `Rc`.
    pub(crate) fn read(self: &Rc<Self>, event: Option<IoEvent>) {
        let event_loop = self.event_loop.as_event_loop_ctx();
        let result = self.reader.read_chunks(event_loop, event, |chunk, state| {
            self.on_read_chunk(&chunk, state)
        });
        self.on_read_result(result);
    }

    fn on_read_result(self: &Rc<Self>, result: ReadResult) {
        match result {
            ReadResult::Pending => {}
            ReadResult::Done => self.on_reader_done(),
            ReadResult::Err(err) => self.on_reader_error(&err),
        }
    }

    fn on_read_chunk(self: &Rc<Self>, chunk: &[u8], has_more: ReadState) -> bool {
        let me = rc_as_mut_ptr(self);
        // SAFETY: see `rc_as_mut_ptr`; one field, for this call.
        unsafe { (*me).buffered_output.append(chunk) };
        log!(
            "PipeReader(0x{:x}, {}) onReadChunk(chunk_len={}, has_more={})",
            me as usize,
            out_kind_str(self.out_type),
            chunk.len(),
            read_state_str(has_more)
        );

        // SAFETY: as above.
        unsafe { (*me).captured_writer.do_write(chunk) };

        // The read loop re-registers the poll itself based on the bool we return.
        has_more != ReadState::Eof
    }

    /// Tail shared by [`on_reader_done`] / [`on_reader_error`]: signal the
    /// owning `Cmd`, drive its `Yield`, then notify the `ShellSubprocess` to
    /// drop its `Readable::Pipe` handle. `guard` keeps `self` alive across
    /// the latter. No `&`/`&mut PipeReader` is held across the re-entrant
    /// `try_signal_done_to_cmd` / `run_yield_with` calls — both reach back
    /// into this same allocation via the `Readable::Pipe` `Rc` clone.
    /// Callers gate on `is_done()` first so the captured-writer tee has
    /// drained before `on_close_io` drops the `Readable::Pipe` Rc.
    fn finish_after_state_set(guard: &Rc<Self>) {
        let me = rc_as_mut_ptr(guard);
        // Snapshot `interp` *before* the Cmd call: `try_signal_done_to_cmd`
        // → `Cmd::buffered_output_close` → `close_io` may overwrite the
        // `Readable::Pipe` slot, and the trampoline must not re-read `*me`.
        // SAFETY: see `rc_as_mut_ptr`; raw read, no borrow held.
        let interp = unsafe { (*me).interp };
        // SAFETY: see `rc_as_mut_ptr` + `try_signal_done_to_cmd` contract —
        // raw `*mut`, no `&mut PipeReader` protector across the Cmd re-entry.
        let y = unsafe { Self::try_signal_done_to_cmd(me) };
        // Once the Cmd has taken the output it detaches this reader (`process`
        // is `None`) and nothing reads `buffered_output` again. Drop it now
        // rather than with `guard`: `y` can settle the shell promise, and its
        // microtask checkpoint must not see a `> ${arraybuffer}` target that
        // is still pinned.
        // SAFETY: see `rc_as_mut_ptr`; raw accesses, no borrow held.
        unsafe {
            if (*me).process.is_none() {
                (*me).buffered_output = BufferedOutput::default();
            }
        }
        Self::run_yield_with(interp, y);
        if let Some(process) = guard.process {
            // SAFETY: `process` is the heap-allocated `ShellSubprocess` (stable
            // address), freed only by `Cmd::deinit` after every PipeReader has
            // signalled done (this call). Shared borrow scoped to `kind`.
            let kind = guard.kind(unsafe { &*process });
            // SAFETY: as above; `&mut` scoped to this call. `on_close_io`
            // drops the `Readable::Pipe` Rc — `guard` keeps `self` live past
            // that.
            unsafe { (*process).on_close_io(kind) };
        }
    }

    fn on_reader_done(self: &Rc<Self>) {
        let me = rc_as_mut_ptr(self);
        log!(
            "onReaderDone(0x{:x}, {})",
            me as usize,
            out_kind_str(self.out_type)
        );
        // SAFETY: see `rc_as_mut_ptr`; each access is scoped, and none
        // survive into `finish_after_state_set`'s re-entry below.
        unsafe {
            let owned = (*me).to_owned_slice();
            (*me).state = PipeReaderState::Done(owned);
        }
        if self.is_done() {
            Self::finish_after_state_set(self);
        }
    }

    /// Spec `signalDoneToCmd`. Takes `*mut Self` (not `&mut self`) because
    /// the tail call into `Cmd::buffered_output_close` re-derives a
    /// `&PipeReader` to *this same allocation* via the `Readable::Pipe`
    /// `Rc` (for `pipe.slice()` and `close_io`). With a `&mut self`
    /// argument the Stacked-Borrows function-argument protector would make
    /// that re-derive UB; the raw pointer carries no protector, so all
    /// `&mut *this` borrows below are explicitly ended before the Cmd call.
    ///
    /// # Safety
    /// `this` must point to a live `PipeReader` inside its `Rc` allocation
    /// (single JS-thread; see [`rc_as_mut_ptr`]). No `&`/`&mut PipeReader`
    /// to the same object may be live across this call.
    pub(crate) unsafe fn try_signal_done_to_cmd(this: *mut Self) -> Yield {
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
            // every PipeReader has signalled done. `CmdHandle` is `Copy`, no
            // borrow is kept.
            let handle = unsafe { (*proc).cmd_parent };
            let cmd = handle.interp.as_cmd_mut(handle.id);
            // SAFETY: caller contract — the `&mut` is scoped to this call and
            // ends *before* the `cmd` call below.
            let e: Option<SystemError> = unsafe { (*this).take_captured_error() };
            // No `&`/`&mut PipeReader` is live here; `buffered_output_close`
            // is free to deref the sibling `Rc<PipeReader>` in
            // `Readable::Pipe` for `pipe.slice()` / `close_io`.
            return cmd.buffered_output_close(out_type, e);
        }
        Yield::Suspended
    }

    fn take_captured_error(&mut self) -> Option<SystemError> {
        if let Some(e) = self.captured_writer.err.take() {
            match core::mem::replace(&mut self.state, PipeReaderState::Pending) {
                PipeReaderState::Done(buf) => {
                    drop(buf);
                    self.state = PipeReaderState::Err(Some(Box::new(e)));
                }
                old @ PipeReaderState::Err(_) => {
                    self.state = old;
                }
                PipeReaderState::Pending => {
                    self.state = PipeReaderState::Err(Some(Box::new(e)));
                }
            }
        }
        // `bun_sys::SystemError` isn't ref-counted nor `Clone`.
        // Move it out (the only reader of
        // `state.Err` after this point is `Drop`, which tolerates `None`).
        if let PipeReaderState::Err(slot) = &mut self.state {
            slot.take().map(|b| *b)
        } else {
            None
        }
    }

    pub(crate) fn kind(&self, process: &ShellSubprocess) -> StdioKind {
        if let Readable::Pipe(p) = &process.stdout {
            if Rc::as_ptr(p).cast() == std::ptr::from_ref(self) {
                return StdioKind::Stdout;
            }
        }

        if let Readable::Pipe(p) = &process.stderr {
            if Rc::as_ptr(p).cast() == std::ptr::from_ref(self) {
                return StdioKind::Stderr;
            }
        }

        panic!("We should be either stdout or stderr");
    }

    pub(crate) fn slice(&self) -> &[u8] {
        self.buffered_output.slice()
    }

    pub(crate) fn to_owned_slice(&mut self) -> Box<[u8]> {
        if let PipeReaderState::Done(buf) = &mut self.state {
            return core::mem::take(buf);
        }
        // we do not use .toOwnedSlice() because we don't want to reallocate memory.
        let out = self.reader.take_buffer();

        if out.capacity() > 0 && out.is_empty() {
            drop(out);
            return Box::default();
        }
        out.into_boxed_slice()
        // PERF: into_boxed_slice may realloc to shrink. Profile if hot.
    }

    fn on_reader_error(self: &Rc<Self>, err: &bun_sys::Error) {
        let me = rc_as_mut_ptr(self);
        log!("PipeReader(0x{:x}) onReaderError {:?}", me as usize, err);
        // SAFETY: see `rc_as_mut_ptr`; scoped to the `state`
        // write, ending before `finish_after_state_set` re-enters.
        unsafe { (*me).state = PipeReaderState::Err(Some(Box::new(err.to_system_error()))) };
        if self.is_done() {
            Self::finish_after_state_set(self);
        }
    }

    // Helper accessor used above to paper over Rc<PipeReader> interior mutability.
    //
    // Takes `*mut Self` (not `&self`) because `Rc<PipeReader>` only yields
    // `&Self`, and casting `&Self as *const Self as *mut Self` to write through is
    // immediate UB — shared-ref provenance is read-only. Callers obtain the pointer
    // via `Rc::as_ptr(&rc).cast_mut()`, which projects from the Rc allocation's
    // original `NonNull` without materializing a `&Self`.
    // The JS-thread single-mutator invariant means no live `&`/`&mut` to these
    // fields exists when this runs.
    unsafe fn take_done_buffer(this: *mut Self) -> Box<[u8]> {
        // SAFETY: see block comment above. Swaps the done buffer out, leaving
        // an empty one in its place.
        // `ptr::replace` reads/writes through the raw field pointer without
        // materializing a `&mut Self`.
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
        debug_assert!(self.reader.is_done() || matches!(self.state, PipeReaderState::Err(_)));

        #[cfg(windows)]
        debug_assert!(!self.reader.has_open_source());

        // PipeReaderState::Done(Box<[u8]>) drops its buffer automatically.

        if !self.captured_writer.dead {
            // CapturedWriter::drop handles err.deref() and writer Rc drop.
        }

        if let PipeReaderState::Err(slot) = &mut self.state {
            *slot = None;
        }

        // buffered_output drops automatically.
        // reader drops automatically.
        // Box dealloc handled by Rc.
    }
}

// ───────────────────────────────────────────────────────────────────────────
// StdioKind & helpers
// ───────────────────────────────────────────────────────────────────────────

unsafe extern "C" {
    // `_PATH_DEFPATH` string literal emitted from C; immutable, load-time
    // initialized, never null. Reading the pointer value has no precondition.
    pub(crate) safe static BUN_DEFAULT_PATH_FOR_SPAWN: *const c_char;
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
