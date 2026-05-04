// const IPC = @import("../jsc/ipc.zig");

use core::ffi::{c_char, c_void};
use core::mem::offset_of;
use std::sync::Arc;

use bun_alloc::Arena;
use bun_aio::Loop as AsyncLoop;
use bun_collections::ByteList;
use bun_core::Output;
use bun_dotenv::Map as DotEnvMap;
use bun_io::{BufferedReader, ReadState};
use bun_jsc::{
    self as jsc, ArrayBuffer, Codegen, EventLoopHandle, JSGlobalObject, JSValue, MarkedArrayBuffer,
    SystemError,
};
use bun_runtime::api::bun::Subprocess as JscSubprocess;
use bun_runtime::webcore::{self, Blob, FileSink, ReadableStream};
use bun_shell::interpreter::Cmd as ShellCmd;
use bun_shell::{self as sh, EnvMap, IOWriter, Yield};
use bun_spawn::{self, Process, Rusage, SpawnOptions, Status, WindowsSpawnOptions, WindowsSpawnResult};
use bun_sys::{self, Fd};
use enumset::{EnumSet, EnumSetType};
use strum::IntoStaticStr;

use crate::util::{self, OutKind, Stdio};

pub use util::Stdio as StdioReexport;
// pub const ShellSubprocess = NewShellSubprocess(.js);
// pub const ShellSubprocessMini = NewShellSubprocess(.mini);

#[cfg(windows)]
pub type StdioResult = WindowsSpawnResult::StdioResult;
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

impl ShellIO {
    pub fn r#ref(&mut self) {
        // TODO(port): IOWriter uses intrusive refcount in Zig; with Arc the
        // "ref without producing a handle" operation has no direct equivalent.
        // Callers should clone() the Arc instead.
        if let Some(io) = &self.stdout {
            let _ = Arc::clone(io);
        }
        if let Some(io) = &self.stderr {
            let _ = Arc::clone(io);
        }
    }

    pub fn deref(&mut self) {
        // Dropping the Option releases our Arc strong count.
        self.stdout.take();
        self.stderr.take();
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ShellSubprocess
// ───────────────────────────────────────────────────────────────────────────

pub type Subprocess = ShellSubprocess;

pub const DEFAULT_MAX_BUFFER_SIZE: u32 = 1024 * 1024 * 4;

pub struct ShellSubprocess {
    pub cmd_parent: *mut ShellCmd,

    pub process: Arc<Process>,

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

pub type WatchFd = Fd;

impl ShellSubprocess {
    pub const DEFAULT_MAX_BUFFER_SIZE: u32 = DEFAULT_MAX_BUFFER_SIZE;

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
        self.process.has_exited()
    }

    pub fn r#ref(&mut self) {
        self.process.enable_keeping_event_loop_alive();

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
        self.process.disable_keeping_event_loop_alive();

        self.stdout.unref();

        self.stderr.unref();
    }

    pub fn has_killed(&self) -> bool {
        self.process.has_killed()
    }

    pub fn try_kill(&mut self, sig: i32) -> bun_sys::Result<()> {
        if self.has_exited() {
            return bun_sys::Result::success();
        }

        self.process.kill(u8::try_from(sig).unwrap())
    }

    // fn has_called_getter(self: &Subprocess, comptime getter: @Type(.enum_literal)) -> bool {
    //     return self.observable_getters.contains(getter);
    // }

    fn close_process(&mut self) {
        // TODO(port): Arc<Process> requires interior mutability for exit_handler/close.
        self.process.set_exit_handler_default();
        self.process.close();
        // Drop our strong ref. Replace with a sentinel so we don't double-drop.
        // TODO(port): in Zig this was an explicit deref(); with Arc the field
        // drop in deinit handles it. Left as-is to mirror call ordering.
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
                    pipe.signal.clear();
                    // drop Arc<FileSink>
                    self.stdin = Writable::Ignore;
                }
                Writable::Buffer(_) => {
                    self.on_static_pipe_writer_done();
                    // PORT NOTE: reshaped for borrowck — re-match after the &mut self call above.
                    if let Writable::Buffer(buffer) = &mut self.stdin {
                        buffer.source.detach();
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
                    if matches!(pipe.state, PipeReaderState::Done(_)) {
                        // Move the done buffer out of the pipe state.
                        // TODO(port): Arc<PipeReader> needs interior mutability to take state.
                        let buf = pipe.take_done_buffer();
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
                        pipe.set_state(PipeReaderState::Err(None));
                    }
                }
            }
            subproc.process.set_exit_handler_default();
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
            sh::Result::Ok(()) => sh::Result::success(),
            sh::Result::Err(err) => sh::Result::Err(err),
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

        if !spawn_args.override_env && spawn_args.env_array.is_empty() {
            // spawn_args.env_array.items = jsc_vm.transpiler.env.map.createNullDelimitedEnvMap(allocator);
            spawn_args.env_array = event_loop.create_null_delimited_env_map();
            // capacity == len after assignment
        }

        // Until ownership transfers into Writable/Readable, deinit any caller-provided
        // stdio resources (memfd, ArrayBuffer.Strong, Blob) on early return so they
        // aren't leaked.
        let mut stdio_consumed = false;
        let stdio_guard = scopeguard::guard(&mut spawn_args.stdio, |stdio| {
            if !stdio_consumed {
                for s in stdio.iter_mut() {
                    s.deinit();
                }
            }
        });
        // TODO(port): errdefer — scopeguard captures &mut stdio + &stdio_consumed; revisit borrows.

        let no_sigpipe = if let Some(iowriter) = &shellio.stdout {
            !iowriter.flags.is_socket
        } else {
            true
        };

        // Hoist asSpawnOption results so a later one failing doesn't strand an earlier
        // Windows *uv.Pipe in an unbound temporary inside the struct initializer.
        let stdin_opt = match stdio_guard[0].as_spawn_option(0) {
            Ok(opt) => opt,
            Err(e) => {
                return sh::Result::Err(sh::Error::Custom(Box::<[u8]>::from(e.to_str())));
            }
        };
        let stdout_opt = match stdio_guard[1].as_spawn_option(1) {
            Ok(opt) => opt,
            Err(e) => {
                #[cfg(windows)]
                stdin_opt.deinit();
                return sh::Result::Err(sh::Error::Custom(Box::<[u8]>::from(e.to_str())));
            }
        };
        let stderr_opt = match stdio_guard[2].as_spawn_option(2) {
            Ok(opt) => opt,
            Err(e) => {
                #[cfg(windows)]
                {
                    stdin_opt.deinit();
                    stdout_opt.deinit();
                }
                return sh::Result::Err(sh::Error::Custom(Box::<[u8]>::from(e.to_str())));
            }
        };

        let mut spawn_options = SpawnOptions {
            cwd: spawn_args.cwd,
            stdin: stdin_opt,
            stdout: stdout_opt,
            stderr: stderr_opt,
            #[cfg(windows)]
            windows: WindowsSpawnOptions::WindowsOptions {
                hide_window: true,
                loop_: event_loop,
            },
            ..Default::default()
        };
        #[cfg(unix)]
        {
            spawn_options.no_sigpipe = no_sigpipe;
        }

        // SAFETY: cmd_parent backref is valid for the lifetime of the spawn call.
        let cmd_parent = unsafe { &mut *spawn_args.cmd_parent };
        if cmd_parent.args.try_push(core::ptr::null()).is_err() {
            spawn_options.deinit();
            return sh::Result::Err(sh::Error::Custom(Box::<[u8]>::from(
                b"out of memory" as &[u8],
            )));
        }

        if spawn_args.env_array.try_push(core::ptr::null()).is_err() {
            // TODO(port): Vec::push cannot fail without try_reserve; mirror Zig OOM path.
            spawn_options.deinit();
            return sh::Result::Err(sh::Error::Custom(Box::<[u8]>::from(
                b"out of memory" as &[u8],
            )));
        }

        let spawn_result = match bun_spawn::spawn_process(
            &spawn_options,
            cmd_parent.args.as_ptr() as *const *const c_char,
            spawn_args.env_array.as_ptr() as *const *const c_char,
        ) {
            Err(err) => {
                spawn_options.deinit();
                let mut msg = Vec::<u8>::new();
                use std::io::Write;
                let _ = write!(&mut msg, "Failed to spawn process: {}", err.name());
                return sh::Result::Err(sh::Error::Custom(msg.into_boxed_slice()));
            }
            Ok(r) => match r {
                bun_sys::Result::Err(err) => {
                    spawn_options.deinit();
                    return sh::Result::Err(sh::Error::Sys(err.to_shell_system_error()));
                }
                bun_sys::Result::Ok(result) => result,
            },
        };

        let mut spawn_result = spawn_result;

        let subprocess: *mut Subprocess = Box::into_raw(Box::new(Subprocess {
            event_loop,
            process: spawn_result.to_process(event_loop, IS_SYNC),
            stdin: match Writable::init(
                stdio_guard[0].clone(),
                event_loop,
                core::ptr::null_mut(), // filled below; see TODO
                spawn_result.stdin,
            ) {
                Ok(w) => w,
                Err(WritableInitError::UnexpectedCreatingStdin) => {
                    panic!("unexpected error while creating stdin");
                }
            },
            stdout: Readable::init(
                OutKind::Stdout,
                stdio_guard[1].clone(),
                shellio.stdout.clone(),
                event_loop,
                core::ptr::null_mut(),
                spawn_result.stdout,
                DEFAULT_MAX_BUFFER_SIZE,
                true,
            ),
            stderr: Readable::init(
                OutKind::Stderr,
                stdio_guard[2].clone(),
                shellio.stderr.clone(),
                event_loop,
                core::ptr::null_mut(),
                spawn_result.stderr,
                DEFAULT_MAX_BUFFER_SIZE,
                true,
            ),
            flags: if IS_SYNC { Flags::IS_SYNC } else { Flags::empty() },
            cmd_parent: spawn_args.cmd_parent,
            closed: EnumSet::empty(),
        }));
        // TODO(port): Zig passes `subprocess` into Writable/Readable::init while
        // constructing the struct (self-referential). Rust cannot express this in a
        // single struct literal — Phase B should split allocation from field init
        // (Box::new_uninit) so the raw `*mut Subprocess` is available before the
        // stdin/stdout/stderr constructors run.
        *out_subproc = subprocess;
        // SAFETY: subprocess was just allocated and is uniquely owned here.
        let subproc = unsafe { &mut *subprocess };
        subproc.process.set_exit_handler(subprocess);
        stdio_consumed = true;
        let _ = scopeguard::ScopeGuard::into_inner(stdio_guard);

        if let Writable::Pipe(pipe) = &mut subproc.stdin {
            pipe.signal = webcore::streams::Signal::init(&mut subproc.stdin);
            // TODO(port): self-referential signal init; needs raw-ptr API.
        }

        match subproc.process.watch() {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(_) => {
                *notify_caller_process_already_exited = true;
                spawn_args.lazy = false;
            }
        }

        if let Writable::Buffer(buffer) = &mut subproc.stdin {
            if let Some(err) = buffer.start().as_err() {
                let sys_err = err.to_shell_system_error();
                let _ = subproc.try_kill(SignalCode::SIGTERM as i32);
                Self::abort_after_failed_start(subprocess);
                return sh::Result::Err(sh::Error::Sys(sys_err));
            }
        }

        if let Readable::Pipe(pipe) = &mut subproc.stdout {
            if let Some(err) = pipe.start(subprocess, event_loop).as_err() {
                let sys_err = err.to_shell_system_error();
                // PORT NOTE: reshaped for borrowck
                // SAFETY: subprocess was allocated above and is uniquely owned here.
                let _ = unsafe { &mut *subprocess }.try_kill(SignalCode::SIGTERM as i32);
                Self::abort_after_failed_start(subprocess);
                return sh::Result::Err(sh::Error::Sys(sys_err));
            }
            if !spawn_args.lazy {
                if let Readable::Pipe(pipe) = &mut subproc.stdout {
                    pipe.read_all();
                }
            }
        }

        if let Readable::Pipe(pipe) = &mut subproc.stderr {
            if let Some(err) = pipe.start(subprocess, event_loop).as_err() {
                let sys_err = err.to_shell_system_error();
                // PORT NOTE: reshaped for borrowck
                // SAFETY: subprocess was allocated above and is uniquely owned here.
                let _ = unsafe { &mut *subprocess }.try_kill(SignalCode::SIGTERM as i32);
                Self::abort_after_failed_start(subprocess);
                return sh::Result::Err(sh::Error::Sys(sys_err));
            }

            if !spawn_args.lazy {
                if let Readable::Pipe(pipe) = &mut subproc.stderr {
                    pipe.read_all();
                }
            }
        }

        log!("returning");

        sh::Result::Ok(())
    }

    pub fn wait(&mut self, sync: bool) {
        self.process.wait(sync)
    }

    pub fn on_process_exit(&mut self, _: &Process, status: Status, _: &Rusage) {
        log!("onProcessExit({:x}, {:?})", self as *mut _ as usize, status);
        let exit_code: Option<u8> = 'brk: {
            if let Status::Exited { code, .. } = status {
                break 'brk Some(code);
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
                cmd.on_exit(code);
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
    Buffer(Arc<StaticPipeWriter>),
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
                pipe.update_ref(true);
            }
            Writable::Buffer(buffer) => {
                buffer.update_ref(true);
            }
            _ => {}
        }
    }

    pub fn unref(&mut self) {
        match self {
            Writable::Pipe(pipe) => {
                pipe.update_ref(false);
            }
            Writable::Buffer(buffer) => {
                buffer.update_ref(false);
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
    pub fn on_ready(&mut self, _: Option<Blob::SizeType>, _: Option<Blob::SizeType>) {}
    pub fn on_start(&mut self) {}

    pub fn init(
        stdio: Stdio,
        event_loop: EventLoopHandle,
        subprocess: *mut Subprocess,
        result: StdioResult,
    ) -> Result<Writable, WritableInitError> {
        assert_stdio_result(result);

        #[cfg(windows)]
        {
            match stdio {
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

                Stdio::Blob(blob) => {
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        StaticPipeWriter::Source::Blob(blob),
                    )));
                }
                Stdio::ArrayBuffer(array_buffer) => {
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        StaticPipeWriter::Source::ArrayBuffer(array_buffer),
                    )));
                }
                Stdio::Fd(fd) => {
                    return Ok(Writable::Fd(fd));
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
                Stdio::Ipc(_) | Stdio::Capture(_) => {
                    return Ok(Writable::Ignore);
                }
            }
        }
        #[cfg(not(windows))]
        match stdio {
            Stdio::Dup2(_) => {
                // The shell never uses this
                panic!("Unimplemented stdin dup2");
            }
            Stdio::Pipe => {
                // The shell never uses this
                panic!("Unimplemented stdin pipe");
            }

            Stdio::Blob(blob) => Ok(Writable::Buffer(StaticPipeWriter::create(
                event_loop,
                subprocess,
                result,
                StaticPipeWriter::Source::Blob(blob),
            ))),
            Stdio::ArrayBuffer(array_buffer) => Ok(Writable::Buffer(StaticPipeWriter::create(
                event_loop,
                subprocess,
                result,
                StaticPipeWriter::Source::ArrayBuffer(array_buffer),
            ))),
            Stdio::Memfd(memfd) => {
                debug_assert!(memfd != bun_sys::INVALID_FD);
                Ok(Writable::Memfd(memfd))
            }
            Stdio::Fd(_) => Ok(Writable::Fd(result.unwrap())),
            Stdio::Inherit => Ok(Writable::Inherit),
            Stdio::Path(_) | Stdio::Ignore => Ok(Writable::Ignore),
            Stdio::Ipc(_) | Stdio::Capture(_) => Ok(Writable::Ignore),
            Stdio::ReadableStream(_) => {
                // The shell never uses this
                panic!("Unimplemented stdin readable_stream");
            }
        }
    }

    // TODO(port): move to shell_jsc
    pub fn to_js(&mut self, global_this: &JSGlobalObject, subprocess: &mut Subprocess) -> JSValue {
        match core::mem::replace(self, Writable::Ignore) {
            Writable::Fd(fd) => {
                *self = Writable::Fd(fd);
                JSValue::js_number(fd)
            }
            Writable::Memfd(fd) => {
                *self = Writable::Memfd(fd);
                JSValue::UNDEFINED
            }
            Writable::Ignore => JSValue::UNDEFINED,
            Writable::Buffer(b) => {
                *self = Writable::Buffer(b);
                JSValue::UNDEFINED
            }
            Writable::Inherit => {
                *self = Writable::Inherit;
                JSValue::UNDEFINED
            }
            Writable::Pipe(pipe) => {
                *self = Writable::Ignore;
                // TODO(port): `has_stdin_destructor_called` and `weak_file_sink_stdin_ptr`
                // are referenced in the Zig but do NOT exist on ShellSubprocess (dead code
                // path under Zig's lazy compilation). Mirrored here as TODOs.
                if subprocess.process.has_exited()
                /* && !subprocess.flags.has_stdin_destructor_called */
                {
                    pipe.on_attached_process_exit(&subprocess.process.status);
                    pipe.to_js(global_this)
                } else {
                    // subprocess.flags.has_stdin_destructor_called = false;
                    // subprocess.weak_file_sink_stdin_ptr = pipe;
                    pipe.to_js_with_destructor(
                        global_this,
                        webcore::sink_destructor::Ptr::init(subprocess),
                    )
                }
            }
        }
    }

    pub fn finalize(&mut self) {
        // SAFETY: `self` points to ShellSubprocess.stdin (always — see Zig @fieldParentPtr).
        let subprocess: *mut Subprocess = unsafe {
            (self as *mut _ as *mut u8)
                .sub(offset_of!(Subprocess, stdin))
                .cast::<Subprocess>()
        };
        // SAFETY: subprocess derived from valid &mut self field.
        let _subproc = unsafe { &*subprocess };
        // TODO(port): Zig checked `subprocess.this_jsvalue != .zero` here, but the field
        // is never assigned (always .zero) — dead code path under Zig lazy compilation.
        // Dropped along with the `this_jsvalue` field.

        match core::mem::replace(self, Writable::Ignore) {
            Writable::Pipe(pipe) => {
                drop(pipe); // deref
                *self = Writable::Ignore;
            }
            Writable::Buffer(buffer) => {
                buffer.update_ref(false);
                drop(buffer); // deref
            }
            Writable::Memfd(fd) => {
                fd.close();
                *self = Writable::Ignore;
            }
            Writable::Ignore => {}
            // PORT NOTE: reshaped — Zig left .fd/.inherit/.buffer in place after finalize.
            Writable::Fd(_) | Writable::Inherit => {}
        }
    }

    pub fn close(&mut self) {
        match self {
            Writable::Pipe(pipe) => {
                let _ = pipe.end(None);
            }
            Writable::Memfd(fd) | Writable::Fd(fd) => {
                fd.close();
                *self = Writable::Ignore;
            }
            Writable::Buffer(buffer) => {
                buffer.close();
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

    pub fn to_slice(&mut self) -> Option<&[u8]> {
        match self {
            Readable::Fd(_) => None,
            Readable::Pipe(pipe) => {
                // TODO(port): Arc<PipeReader> interior mutability for buffer/fifo/read_all.
                let buf = pipe.reader.buffer();
                pipe.buffer.fifo.close_on_empty_read = true;
                pipe.read_all();

                let bytes = &buf[..];
                // self.pipe.buffer.internal_buffer = .{};

                if !bytes.is_empty() {
                    return Some(bytes);
                }

                Some(b"")
            }
            Readable::Buffer(buf) => Some(buf),
            Readable::Memfd(_) => panic!("TODO"),
            _ => None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn init(
        out_type: OutKind,
        stdio: Stdio,
        shellio: Option<Arc<IOWriter>>,
        event_loop: EventLoopHandle,
        process: *mut ShellSubprocess,
        result: StdioResult,
        _max_size: u32,
        _is_sync: bool,
    ) -> Readable {
        assert_stdio_result(result);

        #[cfg(windows)]
        {
            return match stdio {
                Stdio::Inherit => Readable::Inherit,
                Stdio::Ipc(_) | Stdio::Dup2(_) | Stdio::Ignore => Readable::Ignore,
                Stdio::Path(_) => Readable::Ignore,
                Stdio::Fd(fd) => Readable::Fd(fd),
                // blobs are immutable, so we should only ever get the case
                // where the user passed in a Blob with an fd
                Stdio::Blob(_) => Readable::Ignore,
                Stdio::Memfd(_) => Readable::Ignore,
                Stdio::Pipe => {
                    Readable::Pipe(PipeReader::create(event_loop, process, result, None, out_type))
                }
                Stdio::ArrayBuffer(array_buffer) => {
                    let readable = Readable::Pipe(PipeReader::create(
                        event_loop, process, result, None, out_type,
                    ));
                    if let Readable::Pipe(pipe) = &readable {
                        // TODO(port): Arc interior mutability for buffered_output.
                        pipe.set_buffered_output(BufferedOutput::ArrayBuffer {
                            buf: array_buffer,
                            i: 0,
                        });
                    }
                    readable
                }
                Stdio::Capture(_) => Readable::Pipe(PipeReader::create(
                    event_loop, process, result, shellio, out_type,
                )),
                Stdio::ReadableStream(_) => Readable::Ignore, // Shell doesn't use readable_stream
            };
        }

        #[cfg(not(windows))]
        match stdio {
            Stdio::Inherit => Readable::Inherit,
            Stdio::Ipc(_) | Stdio::Dup2(_) | Stdio::Ignore => Readable::Ignore,
            Stdio::Path(_) => Readable::Ignore,
            Stdio::Fd(_) => Readable::Fd(result.unwrap()),
            // blobs are immutable, so we should only ever get the case
            // where the user passed in a Blob with an fd
            Stdio::Blob(_) => Readable::Ignore,
            Stdio::Memfd(memfd) => Readable::Memfd(memfd),
            Stdio::Pipe => {
                Readable::Pipe(PipeReader::create(event_loop, process, result, None, out_type))
            }
            Stdio::ArrayBuffer(array_buffer) => {
                let readable = Readable::Pipe(PipeReader::create(
                    event_loop, process, result, None, out_type,
                ));
                if let Readable::Pipe(pipe) = &readable {
                    // TODO(port): Arc interior mutability for buffered_output.
                    pipe.set_buffered_output(BufferedOutput::ArrayBuffer {
                        buf: array_buffer,
                        i: 0,
                    });
                }
                readable
            }
            Stdio::Capture(_) => Readable::Pipe(PipeReader::create(
                event_loop, process, result, shellio, out_type,
            )),
            Stdio::ReadableStream(_) => Readable::Ignore, // Shell doesn't use readable_stream
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
                pipe.close();
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
    pub map: &'a DotEnvMap,
    pub iter: <DotEnvMap as bun_dotenv::HashTable>::Iterator<'a>,
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
    pub val: Box<bun_str::ZStr<'static>>,
    // TODO(port): Zig stores `[:0]const u8` allocated from arena; using owned ZStr here.
}

impl core::fmt::Display for EnvMapIterValue {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", bstr::BStr::new(self.val.as_bytes()))
    }
}

impl<'a> EnvMapIter<'a> {
    pub fn init(map: &'a DotEnvMap) -> EnvMapIter<'a> {
        EnvMapIter {
            map,
            iter: map.iter(),
        }
    }

    pub fn len(&self) -> usize {
        self.map.map.unmanaged.entries.len()
        // TODO(port): map.map.unmanaged.entries — depends on bun_dotenv internals.
    }

    pub fn next(&mut self) -> Result<Option<EnvMapIterEntry<'a>>, bun_alloc::AllocError> {
        let Some(entry) = self.iter.next() else {
            return Ok(None);
        };
        let value_bytes = entry.value_ptr.value.as_slice();
        let mut value = vec![0u8; value_bytes.len() + 1];
        value[..value_bytes.len()].copy_from_slice(value_bytes);
        value[value_bytes.len()] = 0;
        // SAFETY: NUL-terminated above.
        let zstr = unsafe { bun_str::ZStr::from_raw(value.leak().as_ptr(), value_bytes.len()) };
        // TODO(port): leaked Vec — Zig used arena alloc; revisit ownership.
        Ok(Some(EnvMapIterEntry {
            key: EnvMapIterKey {
                val: entry.key_ptr.as_slice(),
            },
            value: EnvMapIterValue {
                val: Box::new(zstr),
            },
        }))
    }
}

impl<'a> SpawnArgs<'a> {
    pub fn default<const IS_SYNC: bool>(
        arena: &'a mut Arena,
        cmd_parent: &'a mut ShellCmd,
        event_loop: EventLoopHandle,
    ) -> SpawnArgs<'a> {
        let mut out = SpawnArgs {
            arena,

            override_env: false,
            env_array: Vec::new(),
            cwd: event_loop.top_level_dir(),
            stdio: [Stdio::Ignore, Stdio::Pipe, Stdio::Inherit],
            lazy: false,
            // PATH unset → fall back to _PATH_DEFPATH on POSIX (Android often
            // has no PATH). PATH="" (explicit empty) is preserved — that's a
            // deliberate "search nothing" and substituting a default would
            // change argv[0] resolution on existing platforms.
            path: if let Some(p) = event_loop.env().get(b"PATH") {
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

    pub fn fill_env_from_process(&mut self, global_this: &JSGlobalObject) {
        let mut env_iter = EnvMapIter::init(global_this.bun_vm().transpiler.env.map);
        // TODO(port): Zig calls self.fill_env(globalThis, &env_iter, false) but fill_env
        // takes *bun.shell.EnvMap.Iterator, not EnvMapIter — type mismatch in original Zig
        // (dead code under lazy compilation). Mirrored as TODO.
        let _ = (&mut env_iter, global_this);
    }

    /// `object_iter` should be a some type with the following fields:
    /// - `next() bool`
    pub fn fill_env<const DISABLE_PATH_LOOKUP_FOR_ARV0: bool>(
        &mut self,
        env_iter: &mut EnvMap::Iterator,
    ) {
        self.override_env = true;
        self.env_array
            .reserve_exact(env_iter.len().saturating_sub(self.env_array.len()));

        if DISABLE_PATH_LOOKUP_FOR_ARV0 {
            // If the env object does not include a $PATH, it must disable path lookup for argv[0]
            self.path = b"";
        }

        while let Some(entry) = env_iter.next() {
            let key = entry.key_ptr.slice();
            let value = entry.value_ptr.slice();

            let mut line = Vec::<u8>::with_capacity(key.len() + 1 + value.len() + 1);
            use std::io::Write;
            let _ = write!(&mut line, "{}={}", bstr::BStr::new(key), bstr::BStr::new(value));
            line.push(0);
            // PERF(port): was arena allocPrintSentinel — profile in Phase B
            let line = line.leak();
            // TODO(port): leaked — Zig used arena bulk-free.

            if key == b"PATH" {
                self.path = &line[b"PATH=".len()..line.len() - 1];
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
    // ref_count: handled by Arc<PipeReader> per LIFETIMES.tsv.
    // TODO(port): Zig uses intrusive bun.ptr.RefCount and recovers *PipeReader via
    // @fieldParentPtr from CapturedWriter — incompatible with Arc's header layout.
    // Phase B should switch to bun_ptr::IntrusiveRc<PipeReader> + Cell<u32> ref_count
    // and update Readable::Pipe accordingly.
}

pub enum BufferedOutput {
    Bytelist(ByteList),
    ArrayBuffer {
        buf: ArrayBuffer::Strong,
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
            BufferedOutput::Bytelist(b) => usize::from(b.len),
            BufferedOutput::ArrayBuffer { i, .. } => usize::from(*i),
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
                // TODO: We should probably throw error here?
                if usize::from(*i) >= array_buf_slice.len() {
                    return;
                }
                let length = (array_buf_slice.len() - usize::from(*i)).min(bytes.len());
                array_buf_slice[usize::from(*i)..usize::from(*i) + length]
                    .copy_from_slice(&bytes[..length]);
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
    pub writer: Arc<IOWriter>,
    pub written: usize,
    pub err: Option<SystemError>,
}

impl Default for CapturedWriter {
    fn default() -> Self {
        CapturedWriter {
            dead: true,
            // TODO(port): Zig leaves `writer` undefined when dead=true; Arc has no
            // "undefined" state. Phase B should make this Option<Arc<IOWriter>>.
            writer: Arc::new(IOWriter::placeholder()),
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
            <&'static str>::from(self.parent().out_type),
            chunk.len(),
            self.parent().buffered_output.len()
        );
        self.writer.enqueue(self, None, chunk).run();
    }

    pub fn get_buffer(&self) -> &[u8] {
        let p = self.parent();
        if self.written >= p.reader.buffer().len() {
            return b"";
        }
        &p.reader.buffer()[self.written..]
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
            <&'static str>::from(self.parent().out_type),
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
            <&'static str>::from(self.parent().out_type),
            amount,
            err.is_some(),
            self.written + amount,
            self.parent().buffered_output.len()
        );
        self.written += amount;
        if let Some(e) = err {
            log!(
                "CapturedWriter(0x{:x}, {}) onWrite errno={} errmsg={:?} errfd={:?} syscall={:?}",
                self as *mut _ as usize,
                <&'static str>::from(self.parent().out_type),
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
            <&'static str>::from(self.parent().out_type)
        );
        self.parent_mut().on_captured_writer_done();
    }
}

impl Drop for CapturedWriter {
    fn drop(&mut self) {
        if let Some(e) = self.err.take() {
            e.deref();
        }
        // self.writer Arc drops automatically.
    }
}

impl PipeReader {
    pub fn detach(self: &Arc<Self>) {
        // TODO(port): Arc interior mutability — Zig clears self.process then derefs.
        log!(
            "PipeReader(0x{:x}, {}) detach()",
            Arc::as_ptr(self) as usize,
            <&'static str>::from(self.out_type)
        );
        // self.process = None;  // needs Cell<Option<*mut _>>
        // drop(self) — caller drops the Arc.
    }

    pub fn is_done(&self) -> bool {
        log!(
            "PipeReader(0x{:x}, {}) isDone() state={} captured_writer_done={}",
            self as *const _ as usize,
            <&'static str>::from(self.out_type),
            <&'static str>::from(&self.state),
            self.captured_writer.is_done(0)
        );
        if matches!(self.state, PipeReaderState::Pending) {
            return false;
        }
        self.captured_writer.is_done(0)
    }

    pub fn on_captured_writer_done(&mut self) {
        self.try_signal_done_to_cmd().run();
    }

    pub fn create(
        event_loop: EventLoopHandle,
        process: *mut ShellSubprocess,
        result: StdioResult,
        capture: Option<Arc<IOWriter>>,
        out_type: OutKind,
    ) -> Arc<PipeReader> {
        let mut this = Box::new(PipeReader {
            process: Some(process),
            reader: IOReader::init::<PipeReader>(),
            event_loop,
            stdio_result: result,
            out_type,
            state: PipeReaderState::Pending,
            captured_writer: CapturedWriter::default(),
            buffered_output: BufferedOutput::default(),
        });
        log!(
            "PipeReader(0x{:x}, {}) create()",
            &*this as *const _ as usize,
            <&'static str>::from(this.out_type)
        );

        if let Some(cap) = capture {
            this.captured_writer.writer = cap; // dupeRef → Arc clone already happened on pass-in
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
        let this_ptr: *mut PipeReader = &mut *this;
        this.reader.set_parent(this_ptr.cast::<c_void>());

        // TODO(port): converting Box → Arc here; @fieldParentPtr from CapturedWriter
        // requires the PipeReader address to be stable post-Arc::from. Arc::from(Box)
        // reallocates — Phase B must switch to IntrusiveRc to preserve the address
        // captured by reader.set_parent().
        Arc::from(this)
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
                    let poll = &mut self.reader.handle.poll;
                    poll.flags.insert(bun_aio::FilePollFlags::SOCKET);
                    self.reader.flags.socket = true;
                }

                bun_sys::Result::success()
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
            <&'static str>::from(this.out_type),
            chunk.len(),
            <&'static str>::from(has_more)
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

    pub fn on_reader_done(&mut self) {
        log!(
            "onReaderDone(0x{:x}, {})",
            self as *mut _ as usize,
            <&'static str>::from(self.out_type)
        );
        let owned = self.to_owned_slice();
        self.state = PipeReaderState::Done(owned);
        if !self.is_done() {
            return;
        }
        // we need to ref because the process might be done and deref inside signalDoneToCmd and we wanna to keep it alive to check this.process
        // TODO(port): explicit ref/deref pair — with Arc the caller holds the strong ref;
        // intrusive refcount semantics differ. Revisit in Phase B.
        self.try_signal_done_to_cmd().run();

        if let Some(process) = self.process {
            // self.process = None;
            // SAFETY: process backref is valid while PipeReader is alive.
            let kind = self.kind(unsafe { &*process });
            unsafe { (*process).on_close_io(kind) };
            // self.deref(); — handled by Arc drop in on_close_io.
        }
    }

    pub fn try_signal_done_to_cmd(&mut self) -> Yield {
        if !self.is_done() {
            return Yield::Suspended;
        }
        log!(
            "signalDoneToCmd ({:x}: {}) isDone={}",
            self as *mut _ as usize,
            <&'static str>::from(self.out_type),
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
                        e.deref();
                    }
                    PipeReaderState::Pending => {
                        // unreachable after is_done() guard; mirror Zig.
                        self.state = PipeReaderState::Err(Some(e));
                    }
                }
            }
            let e: Option<SystemError> = 'brk: {
                if let PipeReaderState::Err(Some(e)) = &self.state {
                    e.r#ref();
                    break 'brk Some(e.clone());
                }
                break 'brk None;
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
                let stream = ReadableStream::from_pipe(global_object, self, &mut self.reader);
                self.state = PipeReaderState::Done(Box::default());
                Ok(stream)
            }
            PipeReaderState::Done(bytes) => {
                self.state = PipeReaderState::Done(Box::default());
                Ok(ReadableStream::from_owned_slice(global_object, bytes, 0))
            }
            PipeReaderState::Err(_err) => {
                let empty = ReadableStream::empty(global_object)?;
                ReadableStream::cancel(
                    &ReadableStream::from_js(empty, global_object).unwrap(),
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
                let bytes = core::mem::take(bytes);
                MarkedArrayBuffer::from_bytes(bytes, jsc::TypedArrayType::Uint8Array)
                    .to_node_buffer(global_this)
            }
            _ => JSValue::UNDEFINED,
        }
    }

    pub fn on_reader_error(&mut self, err: bun_sys::Error) {
        log!(
            "PipeReader(0x{:x}) onReaderError {:?}",
            self as *mut _ as usize,
            err
        );
        if let PipeReaderState::Done(buf) =
            core::mem::replace(&mut self.state, PipeReaderState::Err(None))
        {
            drop(buf);
        }
        self.state = PipeReaderState::Err(Some(err.to_system_error()));
        // we need to ref because the process might be done and deref inside signalDoneToCmd and we wanna to keep it alive to check this.process
        // TODO(port): intrusive ref/deref pair — see on_reader_done.
        self.try_signal_done_to_cmd().run();
        if let Some(process) = self.process {
            // self.process = None;
            // SAFETY: backref valid while PipeReader alive.
            let kind = self.kind(unsafe { &*process });
            unsafe { (*process).on_close_io(kind) };
            // self.deref();
        }
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
    // TODO(port): remove once IntrusiveRc + Cell-wrapped fields land.
    fn set_state(&self, _state: PipeReaderState) {
        unimplemented!("TODO(port): Arc interior mutability")
    }
    fn set_buffered_output(&self, _bo: BufferedOutput) {
        unimplemented!("TODO(port): Arc interior mutability")
    }
    fn take_done_buffer(&self) -> Box<[u8]> {
        unimplemented!("TODO(port): Arc interior mutability")
    }
}

impl Drop for PipeReader {
    fn drop(&mut self) {
        log!(
            "PipeReader(0x{:x}, {}) deinit()",
            self as *mut _ as usize,
            <&'static str>::from(self.out_type)
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

        if let PipeReaderState::Err(Some(e)) = &mut self.state {
            e.deref();
            self.state = PipeReaderState::Err(None);
        }

        // buffered_output drops automatically.
        // reader drops automatically.
        // Box dealloc handled by Arc.
    }
}

// ───────────────────────────────────────────────────────────────────────────
// StdioKind & helpers
// ───────────────────────────────────────────────────────────────────────────

#[derive(EnumSetType, Debug, IntoStaticStr)]
pub enum StdioKind {
    #[strum(serialize = "stdin")]
    Stdin,
    #[strum(serialize = "stdout")]
    Stdout,
    #[strum(serialize = "stderr")]
    Stderr,
}

#[inline]
pub fn assert_stdio_result(result: StdioResult) {
    if cfg!(debug_assertions) {
        #[cfg(unix)]
        {
            if let Some(fd) = result {
                debug_assert!(fd != bun_sys::INVALID_FD);
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
//   confidence: low
//   todos:      37
//   notes:      LIFETIMES.tsv mandates Arc<PipeReader>/Arc<IOWriter> but Zig uses intrusive RefCount + @fieldParentPtr; spawn struct-literal is self-referential (needs Box::new_uninit split); several Zig paths reference nonexistent fields (lazy-compiled dead code) — flagged inline.
// ──────────────────────────────────────────────────────────────────────────
