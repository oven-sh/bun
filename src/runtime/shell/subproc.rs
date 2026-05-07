// const IPC = @import("../jsc/ipc.zig");

use core::ffi::{c_char, c_void};
use core::mem::offset_of;
use std::sync::Arc;

use bun_alloc::Arena;
use bun_aio::Loop as AsyncLoop;
use bun_collections::ByteList;
use bun_core::Output;
use bun_io::{BufferedReader, ReadState};
use bun_jsc::{
    self as jsc, ArrayBuffer, Codegen, EventLoopHandle, JSGlobalObject, JSValue, MarkedArrayBuffer,
};
use bun_ptr::RefPtr;
use crate::api::bun::subprocess as JscSubprocess;
use crate::webcore::{self, blob, Blob, FileSink, ReadableStream};
use crate::shell::states::cmd::Cmd as ShellCmd;
use crate::shell::io_writer::{self, IOWriter};
use crate::shell::{self as sh, EnvMap, Yield};
use crate::api::bun::process::{
    self as bun_process, Process, Rusage, SignalCodeExt, SpawnOptions, Status,
};
#[cfg(windows)]
use crate::api::bun::process::{WindowsSpawnOptions, WindowsSpawnResult, WindowsStdioResult, WindowsOptions};
use bun_sys::{self, Fd, FdExt, SystemError};
use enumset::{EnumSet, EnumSetType};
use strum::IntoStaticStr;

use crate::shell::util::{self, OutKind};
use crate::api::bun_spawn::stdio::{self, Stdio};

/// Local helper: `OutKind` → tag-name string for logs (Zig `@tagName`).
#[inline]
fn out_kind_str(k: OutKind) -> &'static str {
    match k {
        OutKind::Stdout => "stdout",
        OutKind::Stderr => "stderr",
    }
}

/// Mutably borrow through an `Arc<T>` allocation. Shell is single-threaded;
/// mirrors Zig's intrusive `*PipeReader` mutation through any alias.
/// SAFETY: caller must ensure no overlapping `&`/`&mut` to `T` is live.
#[inline]
unsafe fn arc_mut<T>(a: &Arc<T>) -> &mut T {
    // SAFETY: caller contract.
    unsafe { &mut *(Arc::as_ptr(a) as *mut T) }
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

pub use crate::api::bun_spawn::stdio::Stdio as StdioReexport;
pub use JscSubprocess::StdioKind;

use crate::shell::ShellErr;
// pub const ShellSubprocess = NewShellSubprocess(.js);
// pub const ShellSubprocessMini = NewShellSubprocess(.mini);

#[cfg(windows)]
pub type StdioResult = WindowsStdioResult;
#[cfg(not(windows))]
pub type StdioResult = Option<Fd>;

bun_output::declare_scope!(SHELL_SUBPROC, visible);

macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(SHELL_SUBPROC, $($arg)*) };
}

/// Used for captured writer
#[derive(Default)]
pub struct ShellIO {
    pub stdout: Option<Arc<IOWriter>>,
    pub stderr: Option<Arc<IOWriter>>,
}

// PORT NOTE: Zig's `ShellIO.ref/deref` bumped intrusive IOWriter refcounts
// without producing a handle. With `Arc<IOWriter>` the only correct way to
// retain is to *clone the Arc and keep it*; a freestanding `ref()` that
// discards the clone is a no-op. Callers hold their own `Arc` clones and
// `ShellIO`'s `Drop` releases them — no explicit ref/deref methods.

// ───────────────────────────────────────────────────────────────────────────
// ShellSubprocess
// ───────────────────────────────────────────────────────────────────────────

pub type Subprocess = ShellSubprocess;

pub const DEFAULT_MAX_BUFFER_SIZE: u32 = 1024 * 1024 * 4;

pub struct ShellSubprocess {
    pub cmd_parent: *mut ShellCmd,

    /// Intrusively ref-counted process (`bun_ptr::ThreadSafeRefCount`).
    /// Stored raw because `Process` methods take `&mut self` and `RefPtr`
    /// only implements `Deref`; the shell is single-threaded so raw mutable
    /// access mirrors the Zig `*Process` pattern.
    pub process: *mut Process,

    pub stdin: Writable,
    pub stdout: Readable,
    pub stderr: Readable,

    pub event_loop: EventLoopHandle,

    pub closed: EnumSet<StdioKind>,
    // TODO(port): this_jsvalue was always .zero in Zig (never assigned) — dropped.
    // A bare JSValue field on a Box-allocated struct is a UAF per PORTING.md §JSC.

    pub flags: Flags,
}

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Default, Clone, Copy)]
    pub struct Flags: u8 {
        const IS_SYNC                = 1 << 0;
        const KILLED                 = 1 << 1;
        const WAITING_FOR_ONEXIT     = 1 << 2;
        // remaining 5 bits unused (matches Zig `_: u5 = 0`)
    }
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
    unsafe fn on_close_io(this: *mut Self, kind: StdioKind) {
        // SAFETY: caller (StaticPipeWriter) guarantees `this` is live.
        unsafe { (*this).on_close_io(kind) }
    }
}

pub type WatchFd = Fd;

// PORT NOTE: ProcessExitOwner trait does not exist; the vtable pattern uses
// a free fn registered in ProcessExitVTable. This adapter is referenced by
// `SHELL_EXIT_VTABLE` and wired via `Process::set_exit_handler` below.
static SHELL_EXIT_VTABLE: bun_process::ProcessExitVTable = bun_process::ProcessExitVTable {
    on_process_exit: shell_on_process_exit_thunk,
};

unsafe fn shell_on_process_exit_thunk(
    owner: *mut (),
    process: *mut Process,
    status: bun_process::Status,
    rusage: *const Rusage,
) {
    // SAFETY: `owner` was registered as `*mut ShellSubprocess` via
    // `set_exit_handler` and the owning Cmd outlives the Process exit callback.
    // `process`/`rusage` are live for the duration of the callback.
    let this = unsafe { &mut *(owner as *mut ShellSubprocess) };
    let process_ref: &Process = unsafe { &*process };
    let rusage_ref: &Rusage = unsafe { &*rusage };
    this.on_process_exit(process_ref, status, rusage_ref);
}

impl ShellSubprocess {
    pub const DEFAULT_MAX_BUFFER_SIZE: u32 = DEFAULT_MAX_BUFFER_SIZE;

    /// Borrow the intrusively ref-counted Process mutably.
    /// SAFETY-internal: shell is single-threaded; `self.process` is non-null
    /// for the lifetime of `ShellSubprocess` (set in `spawn_maybe_sync_impl`).
    #[inline]
    fn proc(&self) -> &mut Process {
        // SAFETY: see doc comment.
        unsafe { &mut *self.process }
    }

    pub fn on_static_pipe_writer_done(&mut self) {
        log!(
            "Subproc(0x{:x}) onStaticPipeWriterDone(cmd=0x{:x}))",
            self as *mut _ as usize,
            self.cmd_parent as usize
        );
        // SAFETY: cmd_parent is a backref to the owning Cmd which outlives the subprocess.
        unsafe { (*self.cmd_parent).buffered_input_close() };
    }

    pub fn get_io(&mut self, out_kind: OutKind) -> &mut Readable {
        match out_kind {
            OutKind::Stdout => &mut self.stdout,
            OutKind::Stderr => &mut self.stderr,
        }
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

    pub fn has_killed(&self) -> bool {
        self.proc().has_killed()
    }

    pub fn try_kill(&mut self, sig: i32) -> bun_sys::Result<()> {
        if self.has_exited() {
            return Ok(());
        }

        self.proc().kill(u8::try_from(sig).unwrap())
    }

    // fn has_called_getter(self: &Subprocess, comptime getter: @Type(.enum_literal)) -> bool {
    //     return self.observable_getters.contains(getter);
    // }

    fn close_process(&mut self) {
        let process = core::mem::replace(&mut self.process, core::ptr::null_mut());
        if process.is_null() {
            return;
        }
        // SAFETY: `process` was produced by `to_process` (Box::into_raw) and is
        // live until the deref below drops the last strong ref.
        unsafe {
            (*process).set_exit_handler_default();
            (*process).close();
            // Spec: `this.process.deref()` — release the intrusive ref taken
            // by `spawn_result.toProcess`. `*mut Process` has no Drop, so this
            // must be explicit.
            bun_ptr::ThreadSafeRefCount::<Process>::deref(process);
        }
    }

    pub fn disconnect(&mut self) {
        let _ = self;
        // if (self.ipc_mode == .none) return;
        // self.ipc.socket.close(0, null);
        // self.ipc_mode = .none;
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
        // } else {
        // @field(self, @tagName(io)).close();
        // }
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
                    // SAFETY: Arc<FileSink> is single-thread; raw mut access mirrors Zig.
                    unsafe { (*(Arc::as_ptr(pipe) as *mut FileSink)).signal.clear() };
                    // drop Arc<FileSink>
                    self.stdin = Writable::Ignore;
                }
                Writable::Buffer(_) => {
                    self.on_static_pipe_writer_done();
                    // PORT NOTE: reshaped for borrowck — re-match after the &mut self call above.
                    if let Writable::Buffer(buffer) = &mut self.stdin {
                        // SAFETY: RefPtr<StaticPipeWriter> data is live.
                        unsafe { (*buffer.data.as_ptr()).source.detach() };
                    }
                    self.stdin = Writable::Ignore;
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
                    // raw place read of the discriminant only.
                    let is_done = matches!(unsafe { &(*pp).state }, PipeReaderState::Done(_));
                    if is_done {
                        // SAFETY: raw-ptr write through the Arc allocation; see
                        // `PipeReader::take_done_buffer`.
                        let buf = unsafe { PipeReader::take_done_buffer(pp) };
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
            return;
        }
        #[cfg(not(windows))]
        {
            // SAFETY: caller guarantees `this` is live and uniquely owned here.
            let subproc = unsafe { &mut *this };
            for r in [&mut subproc.stdout, &mut subproc.stderr] {
                if let Readable::Pipe(pipe) = r {
                    if matches!(pipe.state, PipeReaderState::Pending) {
                        // TODO(port): Arc<PipeReader> interior mutability.
                        // SAFETY: raw-ptr write through the Arc allocation; see
                        // PipeReader::set_state. start() failed before any reader
                        // callback could alias this pipe.
                        unsafe {
                            PipeReader::set_state(
                                Arc::as_ptr(pipe).cast_mut(),
                                PipeReaderState::Err(None),
                            )
                        };
                    }
                }
            }
            subproc.proc().set_exit_handler_default();
            // SAFETY: `this` was created via Box::into_raw in spawn and is uniquely owned here.
            drop(unsafe { Box::from_raw(this) });
        }
    }

    pub fn spawn_async(
        event_loop: EventLoopHandle,
        shellio: &mut ShellIO,
        spawn_args_: SpawnArgs<'_>,
        // We have to use an out pointer because this function may invoke callbacks that expect a
        // fully initialized parent object. Writing to this out pointer may be the last step needed
        // to initialize the object.
        out: &mut *mut Self,
        notify_caller_process_already_exited: &mut bool,
    ) -> sh::Result<()> {
        let mut spawn_args = spawn_args_;

        match Self::spawn_maybe_sync_impl(
            event_loop,
            &mut spawn_args,
            shellio,
            out,
            notify_caller_process_already_exited,
        ) {
            Ok(()) => Ok(()),
            Err(err) => Err(err),
        }
    }

    fn spawn_maybe_sync_impl(
        event_loop: EventLoopHandle,
        spawn_args: &mut SpawnArgs<'_>,
        shellio: &mut ShellIO,
        // We have to use an out pointer because this function may invoke callbacks that expect a
        // fully initialized parent object. Writing to this out pointer may be the last step needed
        // to initialize the object.
        out_subproc: &mut *mut Self,
        notify_caller_process_already_exited: &mut bool,
    ) -> sh::Result<()> {
        const IS_SYNC: bool = false;

        // Owns the `K=V\0` storage when inheriting the parent env. Zig used the
        // spawn-local arena freed at function exit; here the struct keeps the
        // buffers alive until after `spawn_process` returns (the raw pointers
        // pushed into `env_array` borrow `inherited_env_storage.storage`).
        let inherited_env_storage: Option<bun_dotenv::NullDelimitedEnvMap> =
            if !spawn_args.override_env && spawn_args.env_array.is_empty() {
                // spawn_args.env_array.items = jsc_vm.transpiler.env.map.createNullDelimitedEnvMap(allocator);
                let envmap = bun_core::handle_oom(event_loop.create_null_delimited_env_map());
                // PORT NOTE: `as_slice()` *includes* the trailing `None`; strip it —
                // the common tail below re-appends one null terminator.
                let entries = envmap.as_slice();
                spawn_args.env_array.extend(
                    entries[..entries.len().saturating_sub(1)]
                        .iter()
                        .map(|opt| opt.unwrap_or(core::ptr::null())),
                );
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

        let no_sigpipe = if let Some(iowriter) = &shellio.stdout {
            !iowriter.is_socket()
        } else {
            true
        };

        // Hoist asSpawnOption results so a later one failing doesn't strand an earlier
        // Windows *uv.Pipe in an unbound temporary inside the struct initializer.
        let stdin_opt = match stdio_guard[0].as_spawn_option(0) {
            stdio::ResultT::Result(opt) => opt,
            stdio::ResultT::Err(e) => {
                return Err(ShellErr::Custom(Box::<[u8]>::from(e.to_str())));
            }
        };
        let stdout_opt = match stdio_guard[1].as_spawn_option(1) {
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
            },
            ..Default::default()
        };
        #[cfg(unix)]
        {
            spawn_options.no_sigpipe = no_sigpipe;
        }

        // Backref so PipeReader callbacks can drive `Yield::run` from async I/O
        // completion. Zig threads this implicitly via `Base.interpreter`; the
        // NodeId-arena port plumbs it explicitly through `SpawnArgs`.
        let interp = spawn_args.interp;
        let cmd_parent = &mut *spawn_args.cmd_parent;
        // Build the `[*:null]?[*:0]const u8` argv view for spawnProcess. Zig's
        // `Cmd.args` is `ArrayList(?[*:0]const u8)` so it just appends `null`;
        // the Rust port stores `Vec<Vec<u8>>`, so materialise a contiguous
        // pointer array here. Each entry must be NUL-terminated — Expansion
        // produces them that way (mirrors Zig's `[:0]const u8`), but assert in
        // debug and patch defensively in release.
        let mut argv: Vec<*const c_char> = Vec::with_capacity(cmd_parent.args.len() + 1);
        for arg in &mut cmd_parent.args {
            if arg.last() != Some(&0) {
                debug_assert!(false, "Cmd.args entry missing NUL terminator");
                arg.push(0);
            }
            argv.push(arg.as_ptr() as *const c_char);
        }
        argv.push(core::ptr::null());

        spawn_args.env_array.push(core::ptr::null());

        let spawn_result = match bun_process::spawn_process(
            &spawn_options,
            argv.as_ptr(),
            spawn_args.env_array.as_ptr(),
        ) {
            Err(err) => {
                drop(spawn_options);
                let mut msg = Vec::<u8>::new();
                use std::io::Write;
                let _ = write!(&mut msg, "Failed to spawn process: {}", err.name());
                return Err(ShellErr::Custom(msg.into_boxed_slice()));
            }
            Ok(r) => match r {
                bun_sys::Result::Err(err) => {
                    drop(spawn_options);
                    return Err(ShellErr::Sys(err.to_shell_system_error()));
                }
                bun_sys::Result::Ok(result) => result,
            },
        };

        let mut spawn_result = spawn_result;

        // PORT NOTE: Stdio impls Drop, so move out via mem::replace instead of clone.
        let stdio0 = core::mem::replace(&mut stdio_guard[0], Stdio::Ignore);
        let stdio1 = core::mem::replace(&mut stdio_guard[1], Stdio::Ignore);
        let stdio2 = core::mem::replace(&mut stdio_guard[2], Stdio::Ignore);

        // `to_process` consumes the result for pid/pidfd; pull the fd handles out first.
        let spawn_stdin = spawn_result.stdin.take();
        let spawn_stdout = spawn_result.stdout.take();
        let spawn_stderr = spawn_result.stderr.take();

        // Two-phase init: allocate the Subprocess slot first so the stable
        // `*mut Subprocess` is available to `Writable::init` / `Readable::init`
        // (they store it on StaticPipeWriter / PipeReader as a backref). Zig
        // does `allocator.create()` then assigns the struct literal in place.
        let mut slot = Box::<Subprocess>::new_uninit();
        let subprocess: *mut Subprocess = slot.as_mut_ptr();
        *out_subproc = subprocess;

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
                event_loop,
                process: spawn_result.to_process(event_loop, IS_SYNC),
                stdin,
                stdout,
                stderr,
                flags: if IS_SYNC { Flags::IS_SYNC } else { Flags::empty() },
                cmd_parent: spawn_args.cmd_parent,
                closed: EnumSet::empty(),
            });
        }
        // Ownership of the now-initialised Box is released as a raw pointer
        // (freed via `Box::from_raw` in `abort_after_failed_start` / Cmd
        // teardown). `MaybeUninit<T>` and `T` share layout, so the cast is
        // sound.
        // SAFETY: fully initialised by the `write` above.
        let _ = Box::into_raw(unsafe { slot.assume_init() });
        // SAFETY: subprocess was just allocated and is uniquely owned here.
        let subproc = unsafe { &mut *subprocess };
        subproc.proc().set_exit_handler(subprocess as *mut (), &SHELL_EXIT_VTABLE);
        let _ = scopeguard::ScopeGuard::into_inner(stdio_guard);

        if let Writable::Pipe(_pipe) = &mut subproc.stdin {
            // TODO(port): self-referential signal init — `Signal::init` needs a
            // `SignalHandler` impl for `Writable` and a raw-ptr API. Shell never
            // creates `.pipe` stdin (see `Writable::init`), so this is dead.
        }

        match subproc.proc().watch() {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(_) => {
                *notify_caller_process_already_exited = true;
                spawn_args.lazy = false;
            }
        }

        if let Writable::Buffer(buffer) = &mut subproc.stdin {
            // SAFETY: RefPtr<StaticPipeWriter> data is live; mut access mirrors Zig.
            if let Err(err) = unsafe { (*buffer.data.as_ptr()).start() } {
                let sys_err = err.to_shell_system_error();
                let _ = subproc.try_kill(SignalCode::SIGTERM as i32);
                Self::abort_after_failed_start(subprocess);
                return Err(ShellErr::Sys(sys_err));
            }
        }

        if let Readable::Pipe(pipe) = &mut subproc.stdout {
            // SAFETY: see `arc_mut` doc; uniquely held during start.
            if let Err(err) = unsafe { arc_mut(pipe) }.start(subprocess, event_loop) {
                let sys_err = err.to_shell_system_error();
                // PORT NOTE: reshaped for borrowck
                // SAFETY: subprocess was allocated above and is uniquely owned here.
                let _ = unsafe { &mut *subprocess }.try_kill(SignalCode::SIGTERM as i32);
                Self::abort_after_failed_start(subprocess);
                return Err(ShellErr::Sys(sys_err));
            }
            if !spawn_args.lazy {
                if let Readable::Pipe(pipe) = &mut subproc.stdout {
                    // SAFETY: see `arc_mut` doc.
                    unsafe { arc_mut(pipe) }.read_all();
                }
            }
        }

        if let Readable::Pipe(pipe) = &mut subproc.stderr {
            // SAFETY: see `arc_mut` doc; uniquely held during start.
            if let Err(err) = unsafe { arc_mut(pipe) }.start(subprocess, event_loop) {
                let sys_err = err.to_shell_system_error();
                // PORT NOTE: reshaped for borrowck
                // SAFETY: subprocess was allocated above and is uniquely owned here.
                let _ = unsafe { &mut *subprocess }.try_kill(SignalCode::SIGTERM as i32);
                Self::abort_after_failed_start(subprocess);
                return Err(ShellErr::Sys(sys_err));
            }

            if !spawn_args.lazy {
                if let Readable::Pipe(pipe) = &mut subproc.stderr {
                    // SAFETY: see `arc_mut` doc.
                    unsafe { arc_mut(pipe) }.read_all();
                }
            }
        }

        log!("returning");

        Ok(())
    }

    pub fn wait(&mut self, sync: bool) {
        self.proc().wait(sync)
    }

    pub fn on_process_exit(&mut self, _: &Process, status: Status, _: &Rusage) {
        log!("onProcessExit({:x})", self as *mut _ as usize);
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
            // SAFETY: cmd_parent backref outlives subprocess.
            let cmd = unsafe { &mut *self.cmd_parent };
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
    Pipe(Arc<FileSink>),
    Fd(Fd),
    Buffer(RefPtr<StaticPipeWriter>),
    Memfd(Fd),
    Inherit,
    Ignore,
}

impl Writable {
    pub fn has_pending_activity(&self) -> bool {
        match self {
            // we mark them as .ignore when they are closed, so this must be true
            Writable::Pipe(_) => true,
            Writable::Buffer(_) => true,
            _ => false,
        }
    }

    pub fn r#ref(&mut self) {
        match self {
            Writable::Pipe(pipe) => {
                // SAFETY: single-thread; raw mut access mirrors Zig.
                unsafe { (*(Arc::as_ptr(pipe) as *mut FileSink)).update_ref(true) };
            }
            Writable::Buffer(buffer) => {
                // SAFETY: RefPtr data is live.
                unsafe { (*buffer.data.as_ptr()).update_ref(true) };
            }
            _ => {}
        }
    }

    pub fn unref(&mut self) {
        match self {
            Writable::Pipe(pipe) => {
                // SAFETY: single-thread; raw mut access mirrors Zig.
                unsafe { (*(Arc::as_ptr(pipe) as *mut FileSink)).update_ref(false) };
            }
            Writable::Buffer(buffer) => {
                // SAFETY: RefPtr data is live.
                unsafe { (*buffer.data.as_ptr()).update_ref(false) };
            }
            _ => {}
        }
    }

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
        assert_stdio_result(result);

        // PORT NOTE: `Stdio` impls Drop, so we cannot partially move out via
        // match (E0509). Dispatch on `&mut` and `mem::take` / ManuallyDrop the
        // non-Copy payloads.
        let mut stdio = stdio;
        #[cfg(windows)]
        {
            match &mut stdio {
                Stdio::Pipe | Stdio::ReadableStream(_) => {
                    if matches!(result, StdioResult::Buffer(_)) {
                        let pipe = FileSink::create_with_pipe(event_loop, result.buffer());

                        match pipe.writer.start_with_current_pipe() {
                            bun_sys::Result::Ok(()) => {}
                            bun_sys::Result::Err(_err) => {
                                drop(pipe); // deref
                                return Err(WritableInitError::UnexpectedCreatingStdin);
                            }
                        }

                        // TODO: uncoment this when is ready, commented because was not compiling
                        // subprocess.weak_file_sink_stdin_ptr = pipe;
                        // subprocess.flags.has_stdin_destructor_called = false;

                        return Ok(Writable::Pipe(pipe));
                    }
                    return Ok(Writable::Inherit);
                }

                Stdio::Blob(_) => {
                    // E0509: `Stdio` impls `Drop`, so the payload cannot be
                    // destructure-moved out. Take ownership via ManuallyDrop +
                    // ptr::read; the wrapper suppresses the Stdio destructor so
                    // the blob is moved exactly once.
                    let old = core::mem::ManuallyDrop::new(core::mem::replace(
                        &mut stdio,
                        Stdio::Ignore,
                    ));
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
                        JscSubprocess::Source::Blob(blob),
                    )));
                }
                Stdio::ArrayBuffer(array_buffer) => {
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        JscSubprocess::Source::ArrayBuffer(core::mem::take(array_buffer)),
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
                    let old = core::mem::ManuallyDrop::new(core::mem::replace(
                        &mut stdio,
                        Stdio::Ignore,
                    ));
                    // SAFETY: `old` is Blob (matched above) and ManuallyDrop
                    // prevents its Drop from running, so this is the sole move.
                    let blob = match &*old {
                        Stdio::Blob(b) => unsafe { core::ptr::read(b) },
                        _ => unreachable!(),
                    };
                    Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        JscSubprocess::Source::Blob(blob),
                    )))
                }
                Stdio::ArrayBuffer(array_buffer) => {
                    Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        JscSubprocess::Source::ArrayBuffer(core::mem::take(array_buffer)),
                    )))
                }
                Stdio::Memfd(memfd) => {
                    debug_assert!(memfd.is_valid());
                    let fd = *memfd;
                    // Ownership of the fd transfers to `Writable::Memfd` (Zig
                    // sets `stdio_consumed = true` to suppress `Stdio.deinit`).
                    // Swap in `Ignore` and suppress the old value's destructor
                    // so `Stdio::Drop` doesn't close the fd we just took
                    // (`stdio = Stdio::Ignore` alone would drop+close the old
                    // `Stdio::Memfd`).
                    let _ = core::mem::ManuallyDrop::new(core::mem::replace(
                        &mut stdio,
                        Stdio::Ignore,
                    ));
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
            }
        }
    }

    // PORT NOTE: `Writable::toJS` from the Zig spec is intentionally **not**
    // ported. It references `subprocess.flags.has_stdin_destructor_called` and
    // `subprocess.weak_file_sink_stdin_ptr`, neither of which exist on
    // `ShellSubprocess` — the function is dead under Zig's lazy compilation
    // (copy-pasted from the JSC `Subprocess`, never instantiated). The shell
    // never exposes its stdin Writable to JS.

    pub fn finalize(&mut self) {
        // PORT NOTE: Zig recovered `*Subprocess` via @fieldParentPtr to gate on
        // `subprocess.this_jsvalue != .zero`. That field is never assigned on
        // ShellSubprocess (dead code path under Zig lazy compilation) and was
        // dropped from the port, so the parent-pointer recovery is unnecessary.
        // Computing it would also require materialising a `&Subprocess` while
        // `&mut self` (== `&mut subprocess.stdin`) is live — an aliasing
        // violation under Stacked Borrows even if never read.

        match self {
            Writable::Pipe(_) => {
                // deref via drop-on-reassign
                *self = Writable::Ignore;
            }
            Writable::Buffer(buffer) => {
                // SAFETY: RefPtr data is live.
                unsafe { (*buffer.data.as_ptr()).update_ref(false) };
                // Spec: `this.buffer.deref()` but does NOT reassign `this.*` —
                // the variant tag is left as `.buffer`. RefPtr's Drop (on
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

    pub fn close(&mut self) {
        match self {
            Writable::Pipe(pipe) => {
                // SAFETY: single-thread; raw mut access mirrors Zig.
                let _ = unsafe { (*(Arc::as_ptr(pipe) as *mut FileSink)).end(None) };
            }
            Writable::Memfd(fd) | Writable::Fd(fd) => {
                fd.close();
                *self = Writable::Ignore;
            }
            Writable::Buffer(buffer) => {
                // SAFETY: RefPtr data is live.
                unsafe { (*buffer.data.as_ptr()).close() };
            }
            Writable::Ignore => {}
            Writable::Inherit => {}
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
    pub fn r#ref(&mut self) {
        if let Readable::Pipe(pipe) = self {
            pipe.update_ref(true);
        }
    }

    pub fn unref(&mut self) {
        if let Readable::Pipe(pipe) = self {
            pipe.update_ref(false);
        }
    }

    // PORT NOTE: `Readable::toSlice` from the Zig spec is intentionally **not**
    // ported. Its `.pipe` arm writes `this.pipe.buffer.fifo.close_on_empty_read`,
    // a field that does not exist on `PipeReader` (pre-BufferedReader-rewrite
    // leftover) — the function is dead under Zig's lazy compilation and has no
    // callers. Subprocess output is read via `PipeReader::buffered_output`.

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
        assert_stdio_result(result);

        #[cfg(windows)]
        {
            return match stdio {
                Stdio::Inherit => Readable::Inherit,
                Stdio::Ipc | Stdio::Dup2(_) | Stdio::Ignore => Readable::Ignore,
                Stdio::Path(_) => Readable::Ignore,
                Stdio::Fd(fd) => Readable::Fd(fd),
                // blobs are immutable, so we should only ever get the case
                // where the user passed in a Blob with an fd
                Stdio::Blob(_) => Readable::Ignore,
                Stdio::Memfd(_) => Readable::Ignore,
                Stdio::Pipe => Readable::Pipe(PipeReader::create(
                    event_loop, process, result, None, out_type, interp,
                )),
                Stdio::ArrayBuffer(array_buffer) => {
                    let readable = Readable::Pipe(PipeReader::create(
                        event_loop, process, result, None, out_type, interp,
                    ));
                    if let Readable::Pipe(pipe) = &readable {
                        // TODO(port): Arc interior mutability for buffered_output.
                        // SAFETY: raw-ptr write through the Arc allocation; see
                        // PipeReader::set_buffered_output. The Arc was just created by
                        // PipeReader::create and is uniquely held here.
                        unsafe {
                            PipeReader::set_buffered_output(
                                Arc::as_ptr(pipe).cast_mut(),
                                BufferedOutput::ArrayBuffer {
                                    buf: array_buffer,
                                    i: 0,
                                },
                            )
                        };
                    }
                    readable
                }
                Stdio::Capture(_) => Readable::Pipe(PipeReader::create(
                    event_loop, process, result, shellio, out_type, interp,
                )),
                Stdio::ReadableStream(_) => Readable::Ignore, // Shell doesn't use readable_stream
            };
        }

        #[cfg(not(windows))]
        {
        // PORT NOTE: `Stdio` impls Drop, so dispatch on `&mut` and `mem::take`
        // Default-able payloads instead of partial moves.
        let mut stdio = stdio;
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
                // Ownership of the fd transfers to `Readable::Memfd` (Zig sets
                // `stdio_consumed = true` to suppress `Stdio.deinit`). Swap in
                // `Ignore` and suppress the old value's destructor so
                // `Stdio::Drop` doesn't close the fd we just took.
                let _ = core::mem::ManuallyDrop::new(core::mem::replace(
                    &mut stdio,
                    Stdio::Ignore,
                ));
                Readable::Memfd(fd)
            }
            Stdio::Pipe => Readable::Pipe(PipeReader::create(
                event_loop, process, result, None, out_type, interp,
            )),
            Stdio::ArrayBuffer(array_buffer) => {
                let readable = Readable::Pipe(PipeReader::create(
                    event_loop, process, result, None, out_type, interp,
                ));
                if let Readable::Pipe(pipe) = &readable {
                    // TODO(port): Arc interior mutability for buffered_output.
                    // SAFETY: raw-ptr write through the Arc allocation; see
                    // PipeReader::set_buffered_output. The Arc was just created by
                    // PipeReader::create and is uniquely held here.
                    unsafe {
                        PipeReader::set_buffered_output(
                            Arc::as_ptr(pipe).cast_mut(),
                            BufferedOutput::ArrayBuffer {
                                buf: core::mem::take(array_buffer),
                                i: 0,
                            },
                        )
                    };
                }
                readable
            }
            Stdio::Capture(_) => Readable::Pipe(PipeReader::create(
                event_loop, process, result, shellio, out_type, interp,
            )),
            Stdio::ReadableStream(_) => Readable::Ignore, // Shell doesn't use readable_stream
        }
        }
    }

    pub fn close(&mut self) {
        match self {
            Readable::Memfd(fd) => {
                let fd = *fd;
                *self = Readable::Closed;
                fd.close();
            }
            // .fd is borrowed from the shell's IOWriter (see IO.OutKind.to_subproc_stdio) or
            // a CowFd redirect; the owner closes it.
            Readable::Fd(_) => {
                *self = Readable::Closed;
            }
            Readable::Pipe(pipe) => {
                // SAFETY: see `arc_mut` doc.
                unsafe { arc_mut(pipe) }.close();
            }
            _ => {}
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
    pub arena: &'a mut Arena,
    pub cmd_parent: &'a mut ShellCmd,
    /// Backref so [`PipeReader`] async-I/O callbacks can drive
    /// [`Yield::run`]. Zig threaded the interpreter implicitly via
    /// `Base.interpreter`; the NodeId-arena port drops that field, so the
    /// spawning `Cmd` passes it explicitly here and it is plumbed through
    /// `Readable::init` → `PipeReader::create`.
    pub interp: *mut crate::shell::interpreter::Interpreter,

    pub override_env: bool,
    pub env_array: Vec<*const c_char>,
    pub cwd: &'a [u8],
    pub stdio: [Stdio; 3],
    pub lazy: bool,
    pub path: &'a [u8],
    pub detached: bool,
    // ipc_mode: IPCMode,
    // ipc_callback: JSValue,
}

pub struct EnvMapIter<'a> {
    pub map: &'a bun_dotenv::Map,
    pub iter: core::iter::Zip<
        core::slice::Iter<'a, Box<[u8]>>,
        core::slice::Iter<'a, bun_dotenv::HashTableValue>,
    >,
    // alloc param dropped — global allocator
}

pub struct EnvMapIterEntry<'a> {
    pub key: EnvMapIterKey<'a>,
    pub value: EnvMapIterValue,
}

pub struct EnvMapIterKey<'a> {
    pub val: &'a [u8],
}

impl core::fmt::Display for EnvMapIterKey<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", bstr::BStr::new(self.val))
    }
}

impl EnvMapIterKey<'_> {
    pub fn eql_comptime(&self, str: &'static [u8]) -> bool {
        self.val == str
    }
}

pub struct EnvMapIterValue {
    /// Zig stores `[:0]const u8` allocated from the spawn arena. Port owns the
    /// NUL-terminated copy directly — `ZBox` is the `allocator.dupeZ` analogue.
    // PERF(port): arena allocSentinel — profile in Phase B
    pub val: bun_core::ZBox,
}

impl core::fmt::Display for EnvMapIterValue {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", bstr::BStr::new(self.val.as_bytes()))
    }
}

impl<'a> EnvMapIter<'a> {
    pub fn init(map: &'a bun_dotenv::Map) -> EnvMapIter<'a> {
        EnvMapIter {
            map,
            iter: map.iter(),
        }
    }

    pub fn len(&self) -> usize {
        self.map.count()
    }

    pub fn next(&mut self) -> Result<Option<EnvMapIterEntry<'a>>, bun_alloc::AllocError> {
        let Some((key, value)) = self.iter.next() else {
            return Ok(None);
        };
        Ok(Some(EnvMapIterEntry {
            key: EnvMapIterKey { val: &key[..] },
            value: EnvMapIterValue {
                val: bun_core::ZBox::from_bytes(&value.value),
            },
        }))
    }
}

impl<'a> SpawnArgs<'a> {
    pub fn default<const IS_SYNC: bool>(
        arena: &'a mut Arena,
        cmd_parent: &'a mut ShellCmd,
        interp: *mut crate::shell::interpreter::Interpreter,
        event_loop: EventLoopHandle,
    ) -> SpawnArgs<'a> {
        let mut out = SpawnArgs {
            arena,
            interp,

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
            // owned by the VM; valid for the lifetime of the spawn args.
            path: if let Some(p) = unsafe { &*event_loop.env() }.get(b"PATH") {
                p
            } else if cfg!(unix) {
                // SAFETY: BUN_DEFAULT_PATH_FOR_SPAWN is a NUL-terminated C string constant.
                unsafe { core::ffi::CStr::from_ptr(BUN_DEFAULT_PATH_FOR_SPAWN) }.to_bytes()
            } else {
                b""
            },
            detached: false,
            cmd_parent,
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
        // PORT NOTE: `bun_collections::array_hash_map::Iter` doesn't impl
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

            // Spec: `std.fmt.allocPrintSentinel(arena, "{s}={s}", .{key, value}, 0)`.
            // Bumpalo owns the bytes; freed when the spawn arena is reset.
            let len = key.len() + 1 + value.len();
            let line: &mut [u8] = self.arena.alloc_slice_fill_default(len + 1);
            line[..key.len()].copy_from_slice(key);
            line[key.len()] = b'=';
            line[key.len() + 1..len].copy_from_slice(value);
            line[len] = 0;
            // SAFETY: `self.arena: &'a Arena` outlives `'a`; bumpalo allocations
            // are address-stable until the arena is reset (after spawn returns).
            // Reborrow to `'a` so `self.path` (which is `&'a [u8]`) can alias it.
            let line: &'a [u8] =
                unsafe { core::slice::from_raw_parts(line.as_ptr(), line.len()) };

            if key == b"PATH" {
                self.path = &line[b"PATH=".len()..len];
            }

            self.env_array.push(line.as_ptr() as *const c_char);
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PipeReader
// ───────────────────────────────────────────────────────────────────────────

pub type IOReader = BufferedReader;
pub type Poll = IOReader;

pub enum PipeReaderState {
    Pending,
    Done(Box<[u8]>),
    Err(Option<SystemError>),
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
    // ref_count: handled by Arc<PipeReader> per LIFETIMES.tsv.
    // TODO(port): Zig uses intrusive bun.ptr.RefCount and recovers *PipeReader via
    // @fieldParentPtr from CapturedWriter — incompatible with Arc's header layout.
    // Phase B should switch to bun_ptr::IntrusiveRc<PipeReader> + Cell<u32> ref_count
    // and update Readable::Pipe accordingly.
}

pub enum BufferedOutput {
    Bytelist(ByteList),
    ArrayBuffer {
        buf: jsc::array_buffer::ArrayBufferStrong,
        i: u32,
    },
}

impl Default for BufferedOutput {
    fn default() -> Self {
        BufferedOutput::Bytelist(ByteList::default())
    }
}

impl BufferedOutput {
    #[inline]
    pub fn len(&self) -> usize {
        match self {
            BufferedOutput::Bytelist(b) => b.len as usize,
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
                b.append_slice(bytes);
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
                *i += u32::try_from(length).unwrap();
            }
        }
    }
}

impl Drop for BufferedOutput {
    fn drop(&mut self) {
        match self {
            BufferedOutput::Bytelist(_b) => {
                // ByteList drops its own storage.
            }
            BufferedOutput::ArrayBuffer { buf: _buf, .. } => {
                // FIXME: SHOULD THIS BE HERE?
                // ArrayBuffer.Strong drops itself.
            }
        }
    }
}

pub struct CapturedWriter {
    pub dead: bool,
    /// `None` iff `dead == true` (Zig leaves the field undefined when dead).
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

impl CapturedWriter {
    pub fn do_write(&mut self, chunk: &[u8]) {
        if self.dead || self.err.is_some() {
            return;
        }

        log!(
            "CapturedWriter(0x{:x}, {}) doWrite len={} parent_amount={}",
            self as *mut _ as usize,
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
        let child = io_writer::ChildPtr::subproc_capture(self as *mut _ as *mut c_void);
        let y = writer.enqueue(child, None, chunk);
        // SAFETY: `self` borrow ends before `run_yield` reborrows the parent
        // PipeReader; field-parent recovery is sound (single-threaded shell).
        let parent = unsafe {
            &*(self as *mut _ as *mut u8)
                .sub(offset_of!(PipeReader, captured_writer))
                .cast::<PipeReader>()
        };
        parent.run_yield(y);
    }

    pub fn get_buffer(&self) -> &[u8] {
        let p = self.parent();
        if self.written >= p.reader._buffer.len() {
            return b"";
        }
        &p.reader._buffer[self.written..]
    }

    pub fn r#loop(&self) -> *mut AsyncLoop {
        #[cfg(windows)]
        {
            self.parent().event_loop.r#loop().uv_loop
        }
        #[cfg(not(windows))]
        {
            self.parent().event_loop.r#loop()
        }
    }

    pub fn parent(&self) -> &PipeReader {
        // SAFETY: self points to PipeReader.captured_writer (embedded field).
        unsafe {
            &*(self as *const _ as *const u8)
                .sub(offset_of!(PipeReader, captured_writer))
                .cast::<PipeReader>()
        }
    }

    fn parent_mut(&mut self) -> &mut PipeReader {
        // SAFETY: self points to PipeReader.captured_writer (embedded field).
        unsafe {
            &mut *(self as *mut _ as *mut u8)
                .sub(offset_of!(PipeReader, captured_writer))
                .cast::<PipeReader>()
        }
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        self.parent().event_loop()
    }

    pub fn is_done(&self, just_written: usize) -> bool {
        log!(
            "CapturedWriter(0x{:x}, {}) isDone(has_err={}, parent_state={}, written={}, parent_amount={})",
            self as *const _ as usize,
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
            self as *mut _ as usize,
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
                self as *mut _ as usize,
                out_kind_str(self.parent().out_type),
                e.errno,
                e.message,
                e.fd,
                e.syscall
            );
            self.err = Some(e);
            return self.parent_mut().try_signal_done_to_cmd();
        } else if self.written >= self.parent().buffered_output.len()
            && !matches!(self.parent().state, PipeReaderState::Pending)
        {
            return self.parent_mut().try_signal_done_to_cmd();
        }
        Yield::Suspended
    }

    pub fn on_error(&mut self, err: bun_sys::Error) {
        // TODO(port): Zig assigns bun.sys.Error to ?jsc.SystemError field — type mismatch
        // in original (dead code under lazy compilation).
        self.err = Some(err.to_system_error());
    }

    pub fn on_close(&mut self) {
        log!(
            "CapturedWriter({:x}, {}) onClose()",
            self as *mut _ as usize,
            out_kind_str(self.parent().out_type)
        );
        self.parent_mut().on_captured_writer_done();
    }
}

impl Drop for CapturedWriter {
    fn drop(&mut self) {
        // PORT NOTE: Zig called `e.deref()` on the SystemError; in Rust the
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
        // Spec: `this.process = null; this.deref();` — clear the backref so any
        // late `on_reader_done`/`on_reader_error` after the Subprocess is freed
        // can't follow it. Arc only yields `&Self`; write through the
        // allocation pointer (single-threaded shell, no live `&`/`&mut` here).
        // SAFETY: see `arc_mut` rationale; field is a plain `Option<*mut _>`.
        unsafe { (*(Arc::as_ptr(&self) as *mut PipeReader)).process = None };
        // Dropping `self` releases the strong ref (Zig `this.deref()`).
    }

    pub fn is_done(&self) -> bool {
        log!(
            "PipeReader(0x{:x}, {}) isDone() state={} captured_writer_done={}",
            self as *const _ as usize,
            out_kind_str(self.out_type),
            <&'static str>::from(&self.state),
            self.captured_writer.is_done(0)
        );
        if matches!(self.state, PipeReaderState::Pending) {
            return false;
        }
        self.captured_writer.is_done(0)
    }

    pub fn on_captured_writer_done(&mut self) {
        let y = self.try_signal_done_to_cmd();
        self.run_yield(y);
    }

    /// Drive a `Yield` from inside an async I/O callback. Mirrors
    /// `IOWriter::run_yield` / `IOReader::run_yield`. `interp` is wired at
    /// `create` time from the spawning `Cmd`; the null guard is a defensive
    /// debug-assert for tests that construct a PipeReader without a Cmd.
    pub(crate) fn run_yield(&self, y: Yield) {
        let interp = self.interp;
        if interp.is_null() {
            debug_assert!(
                matches!(y, Yield::Done | Yield::Suspended | Yield::Failed),
                "PipeReader async callback fired without interp backref"
            );
            return;
        }
        // SAFETY: interp outlives every PipeReader (it owns the Cmd that
        // spawned the subprocess holding this reader). Single-threaded.
        y.run(unsafe { &mut *interp });
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
        // hand it to `reader.set_parent` / @fieldParentPtr consumers.
        // `Arc::from(Box<T>)` would reallocate into a new ArcInner and leave
        // every BufferedReader callback with a dangling parent pointer.
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
            this.reader.source = match result {
                StdioResult::Buffer(buf) => Some(bun_io::Source::Pipe(buf)),
                StdioResult::BufferFd(fd) => Some(bun_io::Source::File(bun_io::Source::open_file(fd))),
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
                #[cfg(unix)]
                {
                    // TODO: are these flags correct
                    // Spec: `poll.flags.insert(.socket); reader.flags.socket = true`.
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

    // TODO(port): move to shell_jsc
    pub const TO_JS: fn(&mut Self, &JSGlobalObject) -> jsc::JsResult<JSValue> =
        Self::to_readable_stream;

    pub fn on_read_chunk(ptr: *mut c_void, chunk: &[u8], has_more: ReadState) -> bool {
        // SAFETY: ptr was registered via reader.set_parent(self).
        let this: &mut PipeReader = unsafe { &mut *ptr.cast::<PipeReader>() };
        this.buffered_output.append(chunk);
        log!(
            "PipeReader(0x{:x}, {}) onReadChunk(chunk_len={}, has_more={})",
            this as *mut _ as usize,
            out_kind_str(this.out_type),
            chunk.len(),
            read_state_str(has_more)
        );

        this.captured_writer.do_write(chunk);

        let should_continue = has_more != ReadState::Eof;

        if should_continue {
            #[cfg(unix)]
            {
                this.reader.register_poll();
            }
            #[cfg(not(unix))]
            match this.reader.start_with_current_pipe() {
                bun_sys::Result::Err(e) => {
                    Output::panic(format_args!(
                        "TODO: implement error handling in Bun Shell PipeReader.onReadChunk\n{:?}",
                        e
                    ));
                }
                _ => {}
            }
        }

        should_continue
    }

    /// # Safety
    /// `this` must point into a live `Arc<PipeReader>` allocation (the pointer
    /// registered via `reader.set_parent`). Takes a raw pointer rather than
    /// `&mut self` because `on_close_io` below drops the `Readable::Pipe`
    /// `Arc` — holding a `&mut self` across that drop would dangle, and the
    /// `Arc::deref` inside `on_close_io` would alias it.
    pub unsafe fn on_reader_done(this: *mut Self) {
        log!(
            "onReaderDone(0x{:x}, {})",
            this as usize,
            // SAFETY: caller contract.
            out_kind_str(unsafe { (*this).out_type })
        );
        // SAFETY: caller contract; short-lived `&mut` ends before any re-entry.
        let owned = unsafe { (*this).to_owned_slice() };
        // SAFETY: caller contract.
        unsafe { (*this).state = PipeReaderState::Done(owned) };
        // SAFETY: caller contract.
        if !unsafe { (*this).is_done() } {
            return;
        }
        // we need to ref because the process might be done and deref inside signalDoneToCmd and we wanna to keep it alive to check this.process
        // Spec: `this.ref(); defer this.deref();` — keep the Arc allocation
        // alive across `run_yield` (which may free the owning Cmd) and
        // `on_close_io` (which drops the `Readable::Pipe` strong ref).
        // SAFETY: `this` points into an `Arc<PipeReader>` allocation per caller
        // contract; bumping/dropping the strong count is the Arc analogue of
        // the intrusive ref/deref pair.
        unsafe { Arc::increment_strong_count(this as *const Self) };

        // SAFETY: caller contract; protective ref above keeps `this` live.
        let y = unsafe { (*this).try_signal_done_to_cmd() };
        // SAFETY: as above.
        unsafe { (*this).run_yield(y) };

        // SAFETY: as above.
        if let Some(process) = unsafe { (*this).process } {
            // self.process = None;
            // SAFETY: process backref is valid while PipeReader is alive.
            let kind = unsafe { (*this).kind(&*process) };
            // SAFETY: process backref valid; this drops the `Readable::Pipe`
            // Arc (Zig: explicit `this.deref()` after `onCloseIO`, since Zig's
            // union overwrite doesn't run a destructor).
            unsafe { (*process).on_close_io(kind) };
        }

        // SAFETY: matches the `increment_strong_count` above. May run `Drop`
        // and free the allocation — `this` must not be touched afterwards.
        unsafe { Arc::decrement_strong_count(this as *const Self) };
    }

    pub fn try_signal_done_to_cmd(&mut self) -> Yield {
        if !self.is_done() {
            return Yield::Suspended;
        }
        log!(
            "signalDoneToCmd ({:x}: {}) isDone={}",
            self as *mut _ as usize,
            out_kind_str(self.out_type),
            self.is_done()
        );
        if cfg!(debug_assertions) {
            debug_assert!(self.process.is_some());
        }
        if let Some(proc) = self.process {
            // SAFETY: backref valid while PipeReader alive.
            let cmd = unsafe { (*proc).cmd_parent };
            if let Some(e) = self.captured_writer.err.take() {
                // Transfer ownership of the error out of captured_writer so
                // PipeReader.deinit doesn't deref the same SystemError twice.
                match core::mem::replace(&mut self.state, PipeReaderState::Pending) {
                    PipeReaderState::Done(buf) => {
                        drop(buf);
                        self.state = PipeReaderState::Err(Some(e));
                    }
                    old @ PipeReaderState::Err(_) => {
                        self.state = old;
                        // PORT NOTE: Zig `e.deref()`; Rust drops the duplicate.
                        drop(e);
                    }
                    PipeReaderState::Pending => {
                        // unreachable after is_done() guard; mirror Zig.
                        self.state = PipeReaderState::Err(Some(e));
                    }
                }
            }
            // PORT NOTE: Zig ref'd + cloned the SystemError; `bun_sys::SystemError`
            // isn't ref-counted nor `Clone`. Move it out (the only reader of
            // `state.Err` after this point is `Drop`, which tolerates `None`).
            let e: Option<SystemError> = if let PipeReaderState::Err(slot) = &mut self.state {
                slot.take()
            } else {
                None
            };
            // SAFETY: cmd backref valid.
            return unsafe { (*cmd).buffered_output_close(self.out_type, e) };
        }
        Yield::Suspended
    }

    pub fn kind(&self, process: &ShellSubprocess) -> StdioKind {
        if let Readable::Pipe(p) = &process.stdout {
            if Arc::as_ptr(p) as *const _ == self as *const _ {
                return StdioKind::Stdout;
            }
        }

        if let Readable::Pipe(p) = &process.stderr {
            if Arc::as_ptr(p) as *const _ == self as *const _ {
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
        if let PipeReaderState::Done(buf) =
            core::mem::replace(&mut self.state, PipeReaderState::Done(Box::default()))
        {
            return buf;
        }
        // we do not use .toOwnedSlice() because we don't want to reallocate memory.
        let out = core::mem::take(&mut self.reader._buffer);

        if out.capacity() > 0 && out.is_empty() {
            drop(out);
            return Box::default();
        }
        out.into_boxed_slice()
        // PERF(port): Zig returned out.items (len < cap) without shrinking; into_boxed_slice
        // may realloc to shrink. Profile in Phase B.
    }

    pub fn update_ref(&self, add: bool) {
        self.reader.update_ref(add);
    }

    pub fn watch(&mut self) {
        if !self.reader.is_done() {
            self.reader.watch();
        }
    }

    // TODO(port): move to shell_jsc
    pub fn to_readable_stream(
        &mut self,
        global_object: &JSGlobalObject,
    ) -> jsc::JsResult<JSValue> {
        // TODO(port): `defer self.deinit()` — with Arc this is the last-strong-ref drop.
        // Cannot express on &mut self; Phase B should take Arc<Self> by value.

        match core::mem::replace(&mut self.state, PipeReaderState::Done(Box::default())) {
            PipeReaderState::Pending => {
                let stream = ReadableStream::from_pipe(global_object, self as *mut Self, &mut self.reader)?;
                self.state = PipeReaderState::Done(Box::default());
                Ok(stream)
            }
            PipeReaderState::Done(bytes) => {
                self.state = PipeReaderState::Done(Box::default());
                ReadableStream::from_owned_slice(global_object, bytes.into_vec(), 0)
            }
            PipeReaderState::Err(_err) => {
                let empty = ReadableStream::empty(global_object)?;
                ReadableStream::cancel(
                    &ReadableStream::from_js(empty, global_object).unwrap().unwrap(),
                    global_object,
                );
                Ok(empty)
            }
        }
    }

    // TODO(port): move to shell_jsc
    pub fn to_buffer(&mut self, global_this: &JSGlobalObject) -> JSValue {
        match &mut self.state {
            PipeReaderState::Done(bytes) => {
                // `MarkedArrayBuffer::from_bytes` adopts the allocation (freed
                // by the JSC ArrayBuffer destructor). Transfer ownership via
                // `Box::into_raw` — this is an FFI hand-off, not a leak.
                let owned = core::mem::take(bytes);
                let len = owned.len();
                let ptr = Box::into_raw(owned) as *mut u8;
                // SAFETY: `ptr`/`len` come from `Box::into_raw` of the slice
                // just taken; ownership moves into the MarkedArrayBuffer.
                let slice = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
                MarkedArrayBuffer::from_bytes(slice, jsc::JSType::Uint8Array)
                    .to_node_buffer(global_this)
            }
            _ => JSValue::UNDEFINED,
        }
    }

    /// # Safety
    /// See [`Self::on_reader_done`].
    pub unsafe fn on_reader_error(this: *mut Self, err: bun_sys::Error) {
        log!(
            "PipeReader(0x{:x}) onReaderError {:?}",
            this as usize,
            err
        );
        // SAFETY: caller contract; short-lived `&mut` ends before any re-entry.
        if let PipeReaderState::Done(buf) =
            core::mem::replace(unsafe { &mut (*this).state }, PipeReaderState::Err(None))
        {
            drop(buf);
        }
        // SAFETY: caller contract.
        unsafe { (*this).state = PipeReaderState::Err(Some(err.to_system_error())) };
        // we need to ref because the process might be done and deref inside signalDoneToCmd and we wanna to keep it alive to check this.process
        // Spec: `this.ref(); defer this.deref();` — see `on_reader_done`.
        // SAFETY: `this` points into an `Arc<PipeReader>` allocation.
        unsafe { Arc::increment_strong_count(this as *const Self) };

        // SAFETY: caller contract; protective ref above keeps `this` live.
        let y = unsafe { (*this).try_signal_done_to_cmd() };
        // SAFETY: as above.
        unsafe { (*this).run_yield(y) };

        // SAFETY: as above.
        if let Some(process) = unsafe { (*this).process } {
            // self.process = None;
            // SAFETY: backref valid while PipeReader alive.
            let kind = unsafe { (*this).kind(&*process) };
            // SAFETY: process backref valid; drops the `Readable::Pipe` Arc.
            unsafe { (*process).on_close_io(kind) };
        }

        // SAFETY: matches the `increment_strong_count` above. May free `this`.
        unsafe { Arc::decrement_strong_count(this as *const Self) };
    }

    pub fn close(&mut self) {
        match self.state {
            PipeReaderState::Pending => {
                self.reader.close();
            }
            PipeReaderState::Done(_) => {}
            PipeReaderState::Err(_) => {}
        }
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        self.event_loop
    }

    pub fn r#loop(&self) -> *mut AsyncLoop {
        #[cfg(windows)]
        {
            self.event_loop.r#loop().uv_loop
        }
        #[cfg(not(windows))]
        {
            self.event_loop.r#loop()
        }
    }

    // Helper accessors used above to paper over Arc<PipeReader> interior mutability.
    // TODO(port): remove once IntrusiveRc + Cell-wrapped fields land (Phase B).
    //
    // These take `*mut Self` (not `&self`) because `Arc<PipeReader>` only yields
    // `&Self`, and casting `&Self as *const Self as *mut Self` to write through is
    // immediate UB — shared-ref provenance is read-only. Callers obtain the pointer
    // via `Arc::as_ptr(&arc).cast_mut()`, which projects from the Arc allocation's
    // original `NonNull` without materializing a `&Self`, mirroring Zig's intrusive
    // `*PipeReader` (bun.ptr.RefCount) which is freely mutated through any alias.
    // The JS-thread single-mutator invariant means no live `&`/`&mut` to these
    // fields exists when these run.
    unsafe fn set_state(this: *mut Self, state: PipeReaderState) {
        // SAFETY: see block comment above. Mirrors `r.pipe.state = .{ ... }`.
        // Raw place assignment drops the old value; no `&mut Self` is materialized.
        unsafe { (*this).state = state };
    }
    unsafe fn set_buffered_output(this: *mut Self, bo: BufferedOutput) {
        // SAFETY: see block comment above. Mirrors `readable.pipe.buffered_output = .{ ... }`
        // in Readable.init — called immediately after `PipeReader.create` while the Arc is
        // uniquely held.
        unsafe { (*this).buffered_output = bo };
    }
    unsafe fn take_done_buffer(this: *mut Self) -> Box<[u8]> {
        // SAFETY: see block comment above. Mirrors onCloseIO:
        //   out.* = .{ .buffer = pipe.state.done }; pipe.state = .{ .done = &.{} };
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
            self as *mut _ as usize,
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
            // PORT NOTE: Zig `e.deref()`; Rust drops via take().
            *slot = None;
        }

        // buffered_output drops automatically.
        // reader drops automatically.
        // Box dealloc handled by Arc.
    }
}

impl bun_io::pipe_reader::BufferedReaderParent for PipeReader {
    unsafe fn on_read_chunk(this: *mut Self, chunk: &[u8], has_more: ReadState) -> bool {
        PipeReader::on_read_chunk(this.cast::<c_void>(), chunk, has_more)
    }
    unsafe fn on_reader_done(this: *mut Self) {
        // SAFETY: see trait contract.
        unsafe { PipeReader::on_reader_done(this) }
    }
    unsafe fn on_reader_error(this: *mut Self, err: bun_sys::Error) {
        // SAFETY: see trait contract.
        unsafe { PipeReader::on_reader_error(this, err) }
    }
    unsafe fn loop_(this: *mut Self) -> *mut AsyncLoop {
        // SAFETY: see trait contract.
        unsafe { (*this).r#loop() }
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        // SAFETY: see trait contract.
        // CYCLEBREAK: `bun_io::EventLoopHandle` is an opaque `*mut c_void`; pass
        // the address of the stored `bun_jsc::EventLoopHandle` so the
        // (runtime-registered) FilePoll vtable can recover it.
        bun_io::EventLoopHandle(unsafe { &raw const (*this).event_loop } as *mut c_void)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// StdioKind & helpers
// ───────────────────────────────────────────────────────────────────────────

// `StdioKind` is re-exported from `crate::api::bun_subprocess` at the top of
// this file so the `StaticPipeWriterProcess` trait impl uses the exact same
// enum the trait was declared with.

#[inline]
pub fn assert_stdio_result(result: StdioResult) {
    if cfg!(debug_assertions) {
        #[cfg(unix)]
        {
            if let Some(fd) = result {
                debug_assert!(fd.is_valid());
            }
        }
        #[cfg(not(unix))]
        {
            let _ = result;
        }
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub static BUN_DEFAULT_PATH_FOR_SPAWN: *const c_char;
}

// IntoStaticStr for PipeReaderState (used in logs as @tagName).
impl From<&PipeReaderState> for &'static str {
    fn from(s: &PipeReaderState) -> &'static str {
        match s {
            PipeReaderState::Pending => "pending",
            PipeReaderState::Done(_) => "done",
            PipeReaderState::Err(_) => "err",
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/subproc.zig (1475 lines)
//   confidence: medium
//   todos:      18
//   notes:      Arc<PipeReader>/Arc<IOWriter> used for intrusive-refcount types; spawn does two-phase Box::new_uninit init so backrefs are valid; ShellErr unified via crate::shell re-export; several Zig paths reference nonexistent fields (lazy-compiled dead code) — flagged inline.
// ──────────────────────────────────────────────────────────────────────────
