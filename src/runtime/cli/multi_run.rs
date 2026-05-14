use core::ffi::{c_char, c_void};
use core::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use bun_collections::{StringArrayHashMap, VecExt};
use bun_core::strings;
use bun_core::{self as bun, Error, Global, Output, err};
use bun_event_loop::EventLoopHandle;
use bun_event_loop::MiniEventLoop::MiniEventLoop;
use bun_io::{BufferedReader, ReadState};
use bun_paths::{self as path, PathBuffer};
use bun_resolver::package_json::{IncludeDependencies, IncludeScripts};

use crate::Command;
use crate::filter_arg as FilterArg;
use crate::run_command::RunCommand;

// `bun.spawn` (Process/Status/SpawnOptions/Rusage/spawnProcess) —
// lives under src/runtime/api/bun/process.zig → crate::api::bun::process.
use crate::api::bun::process::{
    self as spawn, Process, Rusage, SpawnOptions, SpawnProcessResult, SpawnResultExt as _, Status,
    event_loop_handle_to_ctx,
};
// TODO(port): crate path for `bun.DotEnv.Loader`
use bun_dotenv::Loader as DotEnvLoader;
// TODO(port): crate path for `bun.io` BufferedReader/ReadState — assumed `bun_io`
// TODO(port): crate path for Output writer type
type OutputWriter = bun_core::io::Writer;

/// Value type for package.json `scripts` map. Mirrors
/// `bun_resolver::package_json::ScriptsMap` (`StringArrayHashMap<&'static [u8]>`).
type ScriptsMap = StringArrayHashMap<&'static [u8]>;

struct ScriptConfig {
    label: Box<[u8]>,
    // TODO(port): was `[:0]const u8` — NUL-terminated, used directly as argv element
    command: Box<[u8]>,
    cwd: Box<[u8]>,
    /// PATH env var value for this script
    path: Box<[u8]>,
}

/// Wraps a BufferedReader and tracks whether it represents stdout or stderr,
/// so output can be routed to the correct parent stream.
struct PipeReader<'a> {
    reader: BufferedReader,
    handle: *const ProcessHandle<'a>, // set in ProcessHandle::start()
    is_stderr: bool,
    line_buffer: Vec<u8>,
}

impl<'a> PipeReader<'a> {
    fn new(is_stderr: bool) -> Self {
        Self {
            // BufferedReader::init(This) — Zig passes the parent type for vtable.
            reader: BufferedReader::init::<Self>(),
            handle: ptr::null(),
            is_stderr,
            line_buffer: Vec::new(),
        }
    }

    fn event_loop_ptr(&self) -> *mut MiniEventLoop<'static> {
        // SAFETY: handle is a backref set in ProcessHandle::start() before any read; State
        // outlives all handles (lives on `run`'s stack frame for the whole event loop).
        unsafe { (*(*self.handle).state).event_loop }
    }
}

// Callbacks here touch only `line_buffer` / `handle` / the State backref,
// never `reader`. Backrefs set in `ProcessHandle::start()`; `State` outlives
// all handles (lives on `run`'s stack frame for the whole event loop).
bun_io::impl_buffered_reader_parent! {
    MultiRunPipeReader for PipeReader<'a>;
    has_on_read_chunk = true;
    on_read_chunk = |this, chunk, _has_more| {
        let state = &mut *((*(*this).handle).state as *mut State);
        let _ = state.read_chunk(&mut *this, chunk);
        true
    };
    on_reader_done  = |_this| {};
    on_reader_error = |_this, _err| {};
    loop_           = |this| bun_io::uws_to_native((*(*this).event_loop_ptr()).loop_);
    event_loop      = |this| (*(*(*this).handle).state).event_loop_handle.as_event_loop_ctx();
}

struct ProcessSlot {
    /// Intrusively ref-counted; allocated via `heap::alloc` in
    /// `PosixSpawnResult::to_process`. Freed via `Process::deref`.
    ptr: *mut Process,
    status: Status,
}

pub struct ProcessHandle<'a> {
    config: &'a ScriptConfig,
    state: *const State<'a>,
    color_idx: usize,

    stdout_reader: PipeReader<'a>,
    stderr_reader: PipeReader<'a>,

    process: Option<ProcessSlot>,
    options: SpawnOptions,

    start_time: Option<Instant>,
    end_time: Option<Instant>,

    remaining_dependencies: usize,
    /// Dependents within the same script group (pre->main->post chain).
    /// These are NOT started if this handle fails, even with --no-exit-on-error.
    group_dependents: Vec<*mut ProcessHandle<'a>>,
    /// Dependents across sequential groups (group N -> group N+1).
    /// These ARE started even if this handle fails when --no-exit-on-error is set.
    next_dependents: Vec<*mut ProcessHandle<'a>>,
}

impl<'a> ProcessHandle<'a> {
    fn start(&mut self) -> Result<(), Error> {
        // SAFETY: state is a backref into the `State` on `run`'s stack; lives for the whole loop.
        let state = unsafe { &mut *self.state.cast_mut() };
        state.remaining_scripts += 1;

        // TODO(port): argv as null-terminated array of `?[*:0]const u8` — exact ABI for
        // spawnProcess. Using *const c_char placeholders.
        let argv: [*const c_char; 4] = [
            state.shell_bin.as_ptr().cast::<c_char>(),
            (if cfg!(unix) {
                b"-c\0".as_ptr()
            } else {
                b"exec\0".as_ptr()
            })
            .cast::<c_char>(),
            self.config.command.as_ptr().cast::<c_char>(),
            ptr::null(),
        ];

        self.start_time = Instant::now().into();
        // TODO(port): narrow error set
        // PERF(port): was arena bulk-free — envp built into a temporary arena freed at scope
        // end. Phase A uses heap; profile in Phase B.
        let envp;
        let env_ptr = state.env;
        // `mut` needed on Windows where `WindowsSpawnResult::to_process` takes `&mut self`;
        // on POSIX `to_process` consumes `self` by value.
        #[allow(unused_mut)]
        let mut spawned: SpawnProcessResult = {
            // SAFETY: state.env points at the process-lifetime DotEnv loader.
            let env = unsafe { &mut *env_ptr };
            let original_path: Box<[u8]> = env.map.get(b"PATH").map(Box::from).unwrap_or_default();
            let _ = env.map.put(b"PATH", &self.config.path);
            let _restore = scopeguard::guard(original_path, move |original_path| {
                // SAFETY: env_ptr is the process-lifetime loader; outlives this scope.
                let _ = unsafe { (*env_ptr).map.put(b"PATH", &original_path) };
            });
            // SAFETY: same loader; the `_restore` guard's closure has not fired yet.
            envp = unsafe { (*env_ptr).map.create_null_delimited_env_map()? };
            spawn::spawn_process(
                &self.options,
                argv.as_ptr(),
                envp.as_ptr().cast::<*const c_char>(),
            )?
            .map_err(|e| Error::from(e))?
        };
        // POSIX-only: pipe FDs are read before `to_process` consumes `spawned`.
        // On Windows the readers are wired via `Source::Pipe` taken from
        // `spawned.stdout/stderr` below, and `WindowsStdioResult` is not `Copy`.
        #[cfg(unix)]
        let stdout_fd = spawned.stdout;
        #[cfg(unix)]
        let stderr_fd = spawned.stderr;
        let process = spawned.to_process(EventLoopHandle::init_mini(state.event_loop), false);

        self.stdout_reader.handle = std::ptr::from_ref(self);
        self.stderr_reader.handle = std::ptr::from_ref(self);
        // PORT NOTE: compute parent ptrs before calling `set_parent` to avoid
        // borrowck seeing two simultaneous &mut borrows of the same field.
        let stdout_parent = (&raw mut self.stdout_reader).cast::<c_void>();
        self.stdout_reader.reader.set_parent(stdout_parent);
        let stderr_parent = (&raw mut self.stderr_reader).cast::<c_void>();
        self.stderr_reader.reader.set_parent(stderr_parent);

        #[cfg(windows)]
        {
            // Zig: `this.stdout_reader.reader.source = .{ .pipe = this.options.stdout.buffer }`.
            // In the Rust port `spawn_process_windows` has *already* reclaimed
            // sole ownership of that heap pipe into
            // `WindowsStdioResult::Buffer(Box<uv::Pipe>)` (see
            // src/spawn/process.rs WindowsStdio::Buffer doc). Reconstructing a
            // second Box from `self.options.stdout` here would alias the same
            // allocation and double-free when `spawned` drops. Instead, move
            // the Box out of the spawn *result* — `WindowsStdioResult::take()`
            // leaves `Unavailable` behind so `spawned`'s drop is a no-op.
            if let spawn::WindowsStdioResult::Buffer(pipe) = spawned.stdout.take() {
                self.stdout_reader.reader.source = Some(bun_io::Source::Pipe(pipe));
            }
            if let spawn::WindowsStdioResult::Buffer(pipe) = spawned.stderr.take() {
                self.stderr_reader.reader.source = Some(bun_io::Source::Pipe(pipe));
            }
        }

        #[cfg(unix)]
        {
            if let Some(stdout_fd) = stdout_fd {
                let _ = bun_sys::set_nonblocking(stdout_fd);
                self.stdout_reader
                    .reader
                    .start(stdout_fd, true)
                    .map_err(Error::from)?;
            }
            if let Some(stderr_fd) = stderr_fd {
                let _ = bun_sys::set_nonblocking(stderr_fd);
                self.stderr_reader
                    .reader
                    .start(stderr_fd, true)
                    .map_err(Error::from)?;
            }
        }
        #[cfg(not(unix))]
        {
            self.stdout_reader
                .reader
                .start_with_current_pipe()
                .map_err(Error::from)?;
            self.stderr_reader
                .reader
                .start_with_current_pipe()
                .map_err(Error::from)?;
        }

        self.process = Some(ProcessSlot {
            ptr: process,
            status: Status::Running,
        });
        // SAFETY: `process` was just allocated by `to_process` (heap::alloc);
        // owner backref set before any reap callback can fire.
        let process = unsafe { &mut *process };
        // SAFETY: `self` is the live `ProcessHandle` slot in `State.handles`;
        // it lives for the whole event loop and outlives `process`.
        process.set_exit_handler(unsafe {
            bun_spawn::ProcessExit::new(
                bun_spawn::ProcessExitKind::MultiRunHandle,
                std::ptr::from_mut::<Self>(self),
            )
        });

        match process.watch_or_reap() {
            Ok(_) => {}
            Err(err) => {
                if !process.has_exited() {
                    // SAFETY: all-zero is a valid Rusage (POD C struct)
                    let rusage = bun_core::ffi::zeroed::<Rusage>();
                    process.on_exit(Status::Err(err), &rusage);
                }
            }
        }

        Ok(())
    }
}

bun_spawn::link_impl_ProcessExit! {
    MultiRunHandle for ProcessHandle<'static> => |this| {
        on_process_exit(_process, status, _rusage) => {
            (*this).process.as_mut().unwrap().status = status;
            (*this).end_time = Instant::now().into();
            let state = &mut *(*this).state.cast_mut();
            let _ = state.process_exit(&mut *this);
        },
    }
}

use bun_core::output::ansi;
const COLORS: [&[u8]; 6] = [
    ansi::CYAN.as_bytes(),
    ansi::YELLOW.as_bytes(),
    ansi::MAGENTA.as_bytes(),
    ansi::GREEN.as_bytes(),
    ansi::BLUE.as_bytes(),
    ansi::RED.as_bytes(),
];
const RESET: &[u8] = ansi::RESET.as_bytes();

struct State<'a> {
    handles: Box<[ProcessHandle<'a>]>,
    event_loop: *mut MiniEventLoop<'static>,
    /// Typed enum mirror of `event_loop` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    event_loop_handle: EventLoopHandle,
    remaining_scripts: usize,
    max_label_len: usize,
    // NUL-terminated (last byte is 0) for argv[0].
    shell_bin: Box<[u8]>,
    aborted: bool,
    no_exit_on_error: bool,
    env: *mut DotEnvLoader<'static>,
    use_colors: bool,
}

impl<'a> State<'a> {
    pub fn is_done(&self) -> bool {
        self.remaining_scripts == 0
    }

    // TODO(port): narrow error set — was `(std.Io.Writer.Error || bun.OOM)!void`
    fn read_chunk(&mut self, pipe: &mut PipeReader<'a>, chunk: &[u8]) -> Result<(), Error> {
        pipe.line_buffer.extend_from_slice(chunk);

        // Route to correct parent stream: child stdout -> parent stdout, child stderr -> parent stderr
        let writer = if pipe.is_stderr {
            Output::error_writer()
        } else {
            Output::writer()
        };

        // Process complete lines
        while let Some(newline_pos) = pipe.line_buffer.iter().position(|&b| b == b'\n') {
            let line = &pipe.line_buffer[0..newline_pos + 1];
            // SAFETY: pipe.handle backref set in ProcessHandle::start()
            let handle = unsafe { &*pipe.handle };
            self.write_line_with_prefix(handle, line, writer)?;
            // Remove processed line from buffer
            pipe.line_buffer.drain_front(newline_pos + 1);
        }
        Ok(())
    }

    // TODO(port): narrow error set — was `std.Io.Writer.Error!void`
    fn write_line_with_prefix(
        &self,
        handle: &ProcessHandle,
        line: &[u8],
        writer: &mut OutputWriter,
    ) -> Result<(), Error> {
        self.write_prefix(handle, writer)?;
        writer.write_all(line)?;
        Ok(())
    }

    // TODO(port): narrow error set — was `std.Io.Writer.Error!void`
    fn write_prefix(&self, handle: &ProcessHandle, writer: &mut OutputWriter) -> Result<(), Error> {
        if self.use_colors {
            writer.write_all(COLORS[handle.color_idx % COLORS.len()])?;
        }

        writer.write_all(&handle.config.label)?;
        let padding = self.max_label_len.saturating_sub(handle.config.label.len());
        for _ in 0..padding {
            writer.write_all(b" ")?;
        }

        if self.use_colors {
            writer.write_all(RESET)?;
        }

        writer.write_all(b" | ")?;
        Ok(())
    }

    // TODO(port): narrow error set — was `std.Io.Writer.Error!void`
    fn flush_pipe_buffer(
        &self,
        handle: &ProcessHandle<'a>,
        pipe: &mut PipeReader<'a>,
    ) -> Result<(), Error> {
        if !pipe.line_buffer.is_empty() {
            let line = &pipe.line_buffer[..];
            let needs_newline = !line.is_empty() && line[line.len() - 1] != b'\n';
            let writer = if pipe.is_stderr {
                Output::error_writer()
            } else {
                Output::writer()
            };
            self.write_line_with_prefix(handle, line, writer)?;
            if needs_newline {
                let _ = writer.write_all(b"\n");
            }
            pipe.line_buffer.clear();
        }
        Ok(())
    }

    // TODO(port): narrow error set — was `std.Io.Writer.Error!void`
    fn process_exit(&mut self, handle: &mut ProcessHandle<'a>) -> Result<(), Error> {
        self.remaining_scripts -= 1;

        // Flush remaining buffers (stdout first, then stderr)
        // PORT NOTE: reshaped for borrowck — `flush_pipe_buffer` would need both
        // `&ProcessHandle` and `&mut handle.stdout_reader` which overlap. Route
        // through a raw ptr (the State/handle backref pattern is already
        // raw-ptr-based throughout this file).
        let handle_ptr = std::ptr::from_mut::<ProcessHandle>(handle);
        // SAFETY: handle_ptr is live for this call; flush_pipe_buffer reads only
        // `config`/`color_idx` from `handle` and writes only `pipe.line_buffer`.
        unsafe {
            self.flush_pipe_buffer(&*handle_ptr, &mut (*handle_ptr).stdout_reader)?;
            self.flush_pipe_buffer(&*handle_ptr, &mut (*handle_ptr).stderr_reader)?;
        }

        // Print exit status to stderr (status messages always go to stderr)
        let writer = Output::error_writer();
        self.write_prefix(handle, writer)?;

        match &handle.process.as_ref().unwrap().status {
            Status::Exited(exited) => {
                if exited.code != 0 {
                    write!(writer, "Exited with code {}\n", exited.code)?;
                } else {
                    if let (Some(start), Some(end)) = (handle.start_time, handle.end_time) {
                        let duration = end.duration_since(start);
                        let ms = duration.as_nanos() as f64 / 1_000_000.0;
                        if ms > 1000.0 {
                            write!(writer, "Done in {:.2}s\n", ms / 1000.0)?;
                        } else {
                            write!(writer, "Done in {:.0}ms\n", ms)?;
                        }
                    } else {
                        writer.write_all(b"Done\n")?;
                    }
                }
            }
            Status::Signaled(signal) => {
                let name = bun_sys::SignalCode(*signal).name().unwrap_or("unknown");
                write!(writer, "Signaled: {}\n", name)?;
            }
            _ => {
                writer.write_all(b"Error\n")?;
            }
        }

        // Check if we should abort on error
        let failed = match &handle.process.as_ref().unwrap().status {
            Status::Exited(exited) => exited.code != 0,
            Status::Signaled(_) => true,
            _ => true,
        };

        if failed && !self.no_exit_on_error {
            self.abort();
            return Ok(());
        }

        if failed {
            // Pre->main->post chain is broken -- skip group dependents.
            // PORT NOTE: reshaped for borrowck — clone the dependent ptr slices to avoid
            // borrowing `handle` while iterating self.handles via the raw ptrs.
            let group = handle.group_dependents.clone();
            let next = handle.next_dependents.clone();
            self.skip_dependents(&group);
            // But cascade to next-group dependents (sequential --no-exit-on-error).
            if !self.aborted {
                Self::start_dependents(&next);
            }
            return Ok(());
        }

        // Success: cascade to all dependents
        if !self.aborted {
            let group = handle.group_dependents.clone();
            let next = handle.next_dependents.clone();
            Self::start_dependents(&group);
            Self::start_dependents(&next);
        }
        Ok(())
    }

    fn start_dependents(dependents: &[*mut ProcessHandle]) {
        for &dependent in dependents {
            // SAFETY: dependent points into State.handles which outlives this call
            let dependent = unsafe { &mut *dependent };
            dependent.remaining_dependencies -= 1;
            if dependent.remaining_dependencies == 0 {
                if dependent.start().is_err() {
                    Output::pretty_errorln("<r><red>error<r>: Failed to start process");
                    Global::exit(1);
                }
            }
        }
    }

    /// Skip group dependents that will never start because their predecessor
    /// failed. Recursively skip their group dependents too.
    fn skip_dependents(&mut self, dependents: &[*mut ProcessHandle]) {
        for &dependent in dependents {
            // SAFETY: dependent points into State.handles which outlives this call
            let dependent = unsafe { &mut *dependent };
            dependent.remaining_dependencies -= 1;
            if dependent.remaining_dependencies == 0 {
                let group = dependent.group_dependents.clone();
                let next = dependent.next_dependents.clone();
                self.skip_dependents(&group);
                // Still cascade next_dependents so sequential chains continue
                if !self.aborted {
                    Self::start_dependents(&next);
                }
            }
        }
    }

    pub fn abort(&mut self) {
        self.aborted = true;
        for handle in self.handles.iter_mut() {
            if let Some(proc) = &mut handle.process {
                if matches!(proc.status, Status::Running) {
                    // SAFETY: proc.ptr is a live intrusively-ref-counted Process
                    // allocated in `ProcessHandle::start`.
                    let _ = unsafe { (*proc.ptr).kill(bun_sys::SignalCode::SIGINT.0) };
                }
            }
        }
    }

    pub fn finalize(&self) -> u8 {
        for handle in self.handles.iter() {
            if let Some(proc) = &handle.process {
                match &proc.status {
                    Status::Exited(exited) => {
                        if exited.code != 0 {
                            return exited.code;
                        }
                    }
                    Status::Signaled(signal) => {
                        return bun_sys::SignalCode(*signal).to_exit_code().unwrap_or(1);
                    }
                    _ => return 1,
                }
            }
        }
        0
    }
}

struct AbortHandler;

static SHOULD_ABORT: AtomicBool = AtomicBool::new(false);

impl AbortHandler {
    #[cfg(unix)]
    extern "C" fn posix_signal_handler(
        _sig: i32,
        _info: *const bun_sys::posix::siginfo_t,
        _: *const c_void,
    ) {
        SHOULD_ABORT.store(true, Ordering::SeqCst);
    }

    #[cfg(windows)]
    extern "system" fn windows_ctrl_handler(
        dw_ctrl_type: bun_sys::windows::DWORD,
    ) -> bun_sys::windows::BOOL {
        if dw_ctrl_type == bun_sys::windows::CTRL_C_EVENT {
            SHOULD_ABORT.store(true, Ordering::SeqCst);
            return bun_sys::windows::TRUE;
        }
        bun_sys::windows::FALSE
    }

    pub fn install() {
        #[cfg(unix)]
        {
            // bun_sys::posix::Sigaction is a re-export of libc::sigaction; construct
            // via zeroed() (POD C struct) and populate sa_sigaction/sa_mask/sa_flags.
            // SAFETY: all-zero is a valid `libc::sigaction`; sigemptyset/sigaction are
            // FFI calls with no extra preconditions beyond valid pointers.
            unsafe {
                let mut action: bun_sys::posix::Sigaction = bun_core::ffi::zeroed();
                action.sa_sigaction = Self::posix_signal_handler as *const () as usize;
                libc::sigemptyset(&raw mut action.sa_mask);
                action.sa_flags = (libc::SA_SIGINFO | libc::SA_RESTART | libc::SA_RESETHAND) as _;
                bun_sys::posix::sigaction(libc::SIGINT, &raw const action, core::ptr::null_mut());
            }
        }
        #[cfg(not(unix))]
        {
            // TODO(port): move to <area>_sys
            let res = bun_sys::windows::SetConsoleCtrlHandler(
                Some(Self::windows_ctrl_handler),
                bun_sys::windows::TRUE,
            );
            if res == 0 {
                if cfg!(debug_assertions) {
                    Output::warn("Failed to set abort handler\n");
                }
            }
        }
    }

    pub fn uninstall() {
        #[cfg(windows)]
        {
            let _ = bun_sys::windows::SetConsoleCtrlHandler(None, bun_sys::windows::FALSE);
        }
    }
}

/// Simple glob matching: `*` matches any sequence of characters.
fn matches_glob(pattern: &[u8], name: &[u8]) -> bool {
    let mut pi: usize = 0;
    let mut ni: usize = 0;
    let mut star_pi: usize = 0;
    let mut star_ni: usize = 0;
    let mut have_star = false;

    while ni < name.len() || pi < pattern.len() {
        if pi < pattern.len() && pattern[pi] == b'*' {
            have_star = true;
            star_pi = pi;
            star_ni = ni;
            pi += 1;
        } else if pi < pattern.len() && ni < name.len() && pattern[pi] == name[ni] {
            pi += 1;
            ni += 1;
        } else if have_star {
            pi = star_pi + 1;
            star_ni += 1;
            ni = star_ni;
            if ni > name.len() {
                return false;
            }
        } else {
            return false;
        }
    }
    true
}

struct GroupInfo {
    start: usize,
    count: usize,
}

/// Add configs for a single script name (with pre/post handling).
/// When `label_prefix` is non-null, labels become "{prefix}:{name}" (for workspace runs).
fn add_script_configs(
    configs: &mut Vec<ScriptConfig>,
    group_infos: &mut Vec<GroupInfo>,
    raw_name: &[u8],
    scripts_map: Option<&ScriptsMap>,
    cwd: &[u8],
    path: &[u8],
    label_prefix: Option<&[u8]>,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    let group_start = configs.len();

    let label: Box<[u8]> = if let Some(prefix) = label_prefix {
        let mut v = Vec::with_capacity(prefix.len() + 1 + raw_name.len());
        v.extend_from_slice(prefix);
        v.push(b':');
        v.extend_from_slice(raw_name);
        v.into_boxed_slice()
    } else {
        Box::from(raw_name)
    };

    let script_content = scripts_map.and_then(|sm| sm.get(raw_name));

    if let Some(content) = script_content {
        // It's a package.json script - check for pre/post
        let pre_name = {
            let mut v = Vec::with_capacity(3 + raw_name.len());
            v.extend_from_slice(b"pre");
            v.extend_from_slice(raw_name);
            v
        };
        let post_name = {
            let mut v = Vec::with_capacity(4 + raw_name.len());
            v.extend_from_slice(b"post");
            v.extend_from_slice(raw_name);
            v
        };

        let pre_content = scripts_map.and_then(|sm| sm.get(&pre_name[..]));
        let post_content = scripts_map.and_then(|sm| sm.get(&post_name[..]));

        if let Some(pc) = pre_content {
            let mut cmd_buf: Vec<u8> = Vec::with_capacity(pc.len() + 1);
            RunCommand::replace_package_manager_run(&mut cmd_buf, pc)?;
            cmd_buf.push(0);
            configs.push(ScriptConfig {
                label: label.clone(),
                command: cmd_buf.into_boxed_slice(),
                cwd: Box::from(cwd),
                path: Box::from(path),
            });
        }

        // Main script
        {
            let mut cmd_buf: Vec<u8> = Vec::with_capacity(content.len() + 1);
            RunCommand::replace_package_manager_run(&mut cmd_buf, content)?;
            cmd_buf.push(0);
            configs.push(ScriptConfig {
                label: label.clone(),
                command: cmd_buf.into_boxed_slice(),
                cwd: Box::from(cwd),
                path: Box::from(path),
            });
        }

        if let Some(pc) = post_content {
            let mut cmd_buf: Vec<u8> = Vec::with_capacity(pc.len() + 1);
            RunCommand::replace_package_manager_run(&mut cmd_buf, pc)?;
            cmd_buf.push(0);
            configs.push(ScriptConfig {
                label,
                command: cmd_buf.into_boxed_slice(),
                cwd: Box::from(cwd),
                path: Box::from(path),
            });
        }
    } else {
        // Not a package.json script - run as a raw command
        // If it looks like a file path, prefix with bun executable
        let is_file = !raw_name.is_empty()
            && (raw_name[0] == b'.'
                || raw_name[0] == b'/'
                || (cfg!(windows) && raw_name[0] == b'\\')
                || has_runnable_extension(raw_name));
        let command_z: Box<[u8]> = if is_file {
            let bun_path: &[u8] = bun::self_exe_path().map(|z| z.as_bytes()).unwrap_or(b"bun");
            // Quote the bun path so that backslashes on Windows are not
            // interpreted as escape characters by `bun exec` (Bun's shell).
            let mut v = Vec::with_capacity(bun_path.len() + raw_name.len() + 4);
            v.push(b'"');
            v.extend_from_slice(bun_path);
            v.extend_from_slice(b"\" ");
            v.extend_from_slice(raw_name);
            v.push(0);
            v.into_boxed_slice()
        } else {
            // allocator.dupeZ
            let mut v = Vec::with_capacity(raw_name.len() + 1);
            v.extend_from_slice(raw_name);
            v.push(0);
            v.into_boxed_slice()
        };
        configs.push(ScriptConfig {
            label,
            command: command_z,
            cwd: Box::from(cwd),
            path: Box::from(path),
        });
    }

    group_infos.push(GroupInfo {
        start: group_start,
        count: configs.len() - group_start,
    });
    Ok(())
}

// TODO(port): `!noreturn` — Zig returns either an error or diverges. Using
// `Result<Infallible, Error>` so callers can `?` it; all Ok paths call Global::exit.
pub fn run(ctx: &mut Command::ContextData) -> Result<core::convert::Infallible, Error> {
    // Validate flags
    if ctx.parallel && ctx.sequential {
        Output::pretty_errorln(
            "<r><red>error<r>: --parallel and --sequential cannot be used together",
        );
        Global::exit(1);
    }

    // Collect script names from positionals + passthrough
    // For RunCommand: positionals[0] is "run", skip it. For AutoCommand: no "run" prefix.
    // PORT NOTE: cloned to owned so the &mut ctx borrow below doesn't conflict.
    let mut script_names: Vec<Box<[u8]>> = Vec::new();

    let mut positionals: &[Box<[u8]>] = &ctx.positionals;
    if !positionals.is_empty() && (&*positionals[0] == b"run" || &*positionals[0] == b"r") {
        positionals = &positionals[1..];
    }
    for pos in positionals {
        if !pos.is_empty() {
            script_names.push(pos.clone());
        }
    }
    for pt in &ctx.passthrough {
        if !pt.is_empty() {
            script_names.push(pt.clone());
        }
    }

    if script_names.is_empty() {
        Output::pretty_errorln(
            "<r><red>error<r>: --parallel/--sequential requires at least one script name",
        );
        Global::exit(1);
    }

    // Set up the transpiler/environment
    let _ = bun_resolver::fs::FileSystem::init(None)?;
    // Out-param init pattern — Zig writes into `var this_transpiler: Transpiler = undefined;`
    let mut this_transpiler_slot =
        ::core::mem::MaybeUninit::<bun_bundler::Transpiler<'static>>::uninit();
    let _ = RunCommand::configure_env_for_run(ctx, &mut this_transpiler_slot, None, true, false)?;
    // SAFETY: `configure_env_for_run` fully writes the slot on the success path.
    let this_transpiler = unsafe { this_transpiler_slot.assume_init_mut() };
    let cwd: &[u8] = bun_resolver::fs::FileSystem::get().top_level_dir;

    // SAFETY: transpiler.env is a process-lifetime *mut Loader set in init.
    let env_ptr: *mut DotEnvLoader<'static> = this_transpiler.env;
    let event_loop =
        bun_event_loop::MiniEventLoop::init_global(Some(unsafe { &mut *env_ptr }), None);
    // --no-orphans: register the macOS kqueue parent watch on this MiniEventLoop
    // (the VirtualMachine.init path is never reached for --parallel). Linux is
    // already covered by prctl in enable() + linux_pdeathsig on each spawn.
    bun_io::ParentDeathWatchdog::install_on_event_loop(event_loop_handle_to_ctx(
        EventLoopHandle::init_mini(event_loop),
    ));
    // shell_bin is NUL-terminated ([:0]const u8) for argv use.
    let shell_bin: Box<[u8]> = if cfg!(unix) {
        let path_env = unsafe { (*env_ptr).get(b"PATH") }.unwrap_or(b"");
        Box::from(
            RunCommand::find_shell(path_env, cwd)
                .ok_or(err!("MissingShell"))?
                .as_bytes_with_nul(),
        )
    } else {
        Box::from(
            bun::self_exe_path()
                .map_err(|_| err!("MissingShell"))?
                .as_bytes_with_nul(),
        )
    };

    // Build ScriptConfigs and ProcessHandles
    // Each script name can produce up to 3 handles (pre, main, post)
    let mut configs: Vec<ScriptConfig> = Vec::new();
    let mut group_infos: Vec<GroupInfo> = Vec::new();

    if !ctx.filters.is_empty() || ctx.workspaces {
        // Workspace-aware mode: iterate over matching workspace packages
        let filter_instance = if ctx.workspaces {
            FilterArg::FilterSet::init::<&[u8]>(&[b"*"], cwd)?
        } else {
            FilterArg::FilterSet::init(&ctx.filters, cwd)?
        };
        let mut patterns: Vec<Box<[u8]>> = Vec::new();

        let mut root_buf = PathBuffer::uninit();
        let resolve_root = FilterArg::get_candidate_package_patterns(
            unsafe { ctx.log_mut() },
            &mut patterns,
            cwd,
            &mut root_buf,
        )?;

        let mut package_json_iter =
            FilterArg::PackageFilterIterator::init(&patterns, resolve_root)?;
        // Drop handles deinit

        // Phase 1: Collect matching packages (filesystem order is nondeterministic)
        struct MatchedPackage {
            name: Box<[u8]>,
            dirpath: Box<[u8]>,
            scripts: Box<ScriptsMap>,
            path: Box<[u8]>,
        }
        let mut matched_packages: Vec<MatchedPackage> = Vec::new();

        while let Some(package_json_path) = package_json_iter.next()? {
            let dirpath: Box<[u8]> =
                Box::from(bun_core::dirname(&package_json_path).unwrap_or_else(|| Global::crash()));
            let pkg_path = strings::without_trailing_slash(&dirpath);

            // When using --workspaces, skip the root package to prevent recursion
            if ctx.workspaces && pkg_path == resolve_root {
                continue;
            }

            let Some(pkgjson) = bun_resolver::PackageJSON::parse::<{ IncludeDependencies::Main }>(
                &mut this_transpiler.resolver,
                &dirpath,
                bun_sys::Fd::INVALID,
                None,
                IncludeScripts::IncludeScripts,
            ) else {
                continue;
            };

            if !filter_instance.matches(pkg_path, &pkgjson.name) {
                continue;
            }

            let Some(pkg_scripts) = pkgjson.scripts else {
                continue;
            };
            let run_in_bun = ctx.debug.run_in_bun;
            let pkg_path_env = RunCommand::configure_path_for_run_with_package_json_dir(
                ctx,
                &dirpath,
                this_transpiler,
                None,
                &dirpath,
                run_in_bun,
            )?;
            let pkg_name: Box<[u8]> = if !pkgjson.name.is_empty() {
                pkgjson.name
            } else {
                // Fallback: use relative path from workspace root
                Box::from(bun_paths::resolve_path::relative_platform::<
                    bun_paths::resolve_path::platform::Posix,
                    false,
                >(resolve_root, pkg_path))
            };

            matched_packages.push(MatchedPackage {
                name: pkg_name,
                dirpath,
                scripts: pkg_scripts,
                path: pkg_path_env.into(),
            });
        }

        // Phase 2: Sort by package name, then by path as tiebreaker for deterministic ordering
        matched_packages.sort_by(|a, b| {
            let name_order = a.name.cmp(&b.name);
            if name_order != core::cmp::Ordering::Equal {
                return name_order;
            }
            a.dirpath.cmp(&b.dirpath)
        });

        // Phase 3: Build configs from sorted packages
        for pkg in &matched_packages {
            for raw_name in &script_names {
                if raw_name.iter().any(|&b| b == b'*') {
                    // Glob: expand against this package's scripts
                    let mut matches: Vec<&[u8]> = Vec::new();
                    for key in pkg.scripts.keys() {
                        if matches_glob(raw_name, key) {
                            matches.push(key);
                        }
                    }
                    matches.as_mut_slice().sort();
                    for matched_name in &matches {
                        add_script_configs(
                            &mut configs,
                            &mut group_infos,
                            matched_name,
                            Some(&pkg.scripts),
                            &pkg.dirpath,
                            &pkg.path,
                            Some(&pkg.name),
                        )?;
                    }
                } else {
                    if pkg.scripts.get(raw_name).is_some() {
                        add_script_configs(
                            &mut configs,
                            &mut group_infos,
                            raw_name,
                            Some(&pkg.scripts),
                            &pkg.dirpath,
                            &pkg.path,
                            Some(&pkg.name),
                        )?;
                    } else if ctx.workspaces && !ctx.if_present {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r>: Missing \"{}\" script in package \"{}\"",
                            bstr::BStr::new(raw_name),
                            bstr::BStr::new(&pkg.name),
                        ));
                        Global::exit(1);
                    }
                }
            }
        }

        if configs.is_empty() {
            if ctx.if_present {
                Global::exit(0);
            }
            if ctx.workspaces {
                Output::pretty_errorln(
                    "<r><red>error<r>: No workspace packages have matching scripts",
                );
            } else {
                Output::pretty_errorln("<r><red>error<r>: No packages matched the filter");
            }
            Global::exit(1);
        }
    } else {
        // Single-package mode: use the root package.json
        let run_in_bun = ctx.debug.run_in_bun;
        let path_env = RunCommand::configure_path_for_run_with_package_json_dir(
            ctx,
            b"",
            this_transpiler,
            None,
            cwd,
            run_in_bun,
        )?;

        // Load package.json scripts
        let root_dir_info = match this_transpiler.resolver.read_dir_info(cwd) {
            Ok(Some(info)) => info,
            Ok(None) | Err(_) => {
                Output::pretty_errorln("<r><red>error<r>: Failed to read directory");
                Global::exit(1);
            }
        };

        // SAFETY: read_dir_info returns a borrow into the resolver's directory cache
        // (process-lifetime).
        let package_json = unsafe { (*root_dir_info).enclosing_package_json };
        let scripts_map: Option<&ScriptsMap> = package_json.and_then(|pkg| pkg.scripts.as_deref());

        for raw_name in &script_names {
            // Check if this is a glob pattern
            if raw_name.iter().any(|&b| b == b'*') {
                if let Some(sm) = scripts_map {
                    // Collect matching script names
                    let mut matches: Vec<&[u8]> = Vec::new();
                    for key in sm.keys() {
                        if matches_glob(raw_name, key) {
                            matches.push(key);
                        }
                    }

                    // Sort alphabetically
                    matches.as_mut_slice().sort();

                    if matches.is_empty() {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r>: No scripts match pattern \"{}\"",
                            bstr::BStr::new(raw_name),
                        ));
                        Global::exit(1);
                    }

                    for matched_name in &matches {
                        add_script_configs(
                            &mut configs,
                            &mut group_infos,
                            matched_name,
                            scripts_map,
                            cwd,
                            &path_env,
                            None,
                        )?;
                    }
                } else {
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r>: Cannot use glob pattern \"{}\" without package.json scripts",
                        bstr::BStr::new(raw_name),
                    ));
                    Global::exit(1);
                }
            } else {
                add_script_configs(
                    &mut configs,
                    &mut group_infos,
                    raw_name,
                    scripts_map,
                    cwd,
                    &path_env,
                    None,
                )?;
            }
        }
    }

    if configs.is_empty() {
        Output::pretty_errorln("<r><red>error<r>: No scripts to run");
        Global::exit(1);
    }

    // Compute max label width
    let mut max_label_len: usize = 0;
    for config in &configs {
        if config.label.len() > max_label_len {
            max_label_len = config.label.len();
        }
    }

    let use_colors = Output::enable_ansi_colors_stderr();

    let mut state = State {
        // TODO(port): allocate handles slice; Zig used uninitialized alloc + per-index assign.
        // Using Vec then into_boxed_slice after init loop below to avoid MaybeUninit gymnastics.
        handles: Box::default(),
        event_loop,
        event_loop_handle: EventLoopHandle::init_mini(event_loop),
        remaining_scripts: 0,
        max_label_len,
        shell_bin,
        aborted: false,
        no_exit_on_error: ctx.no_exit_on_error,
        env: env_ptr,
        use_colors,
    };

    // Initialize handles
    let mut handles: Vec<ProcessHandle> = Vec::with_capacity(configs.len());
    for (i, config) in configs.iter().enumerate() {
        // Find which group this belongs to, for color assignment
        let mut color_idx: usize = 0;
        for (gi, group) in group_infos.iter().enumerate() {
            if i >= group.start && i < group.start + group.count {
                color_idx = gi;
                break;
            }
        }

        handles.push(ProcessHandle {
            state: &raw const state,
            config,
            color_idx,
            stdout_reader: PipeReader::new(false),
            stderr_reader: PipeReader::new(true),
            process: None,
            start_time: None,
            end_time: None,
            remaining_dependencies: 0,
            group_dependents: Vec::new(),
            next_dependents: Vec::new(),
            options: SpawnOptions {
                stdin: spawn::Stdio::Ignore,
                #[cfg(unix)]
                stdout: spawn::Stdio::Buffer,
                #[cfg(not(unix))]
                stdout: spawn::Stdio::Buffer(bun_core::heap::into_raw(Box::new(
                    bun_core::ffi::zeroed::<bun_sys::windows::libuv::Pipe>(),
                ))),
                #[cfg(unix)]
                stderr: spawn::Stdio::Buffer,
                #[cfg(not(unix))]
                stderr: spawn::Stdio::Buffer(bun_core::heap::into_raw(Box::new(
                    bun_core::ffi::zeroed::<bun_sys::windows::libuv::Pipe>(),
                ))),
                cwd: config.cwd.clone(),
                #[cfg(windows)]
                windows: spawn::WindowsOptions {
                    loop_: EventLoopHandle::init_mini(event_loop),
                    ..Default::default()
                },
                stream: true,
                ..Default::default()
            },
        });
    }
    state.handles = handles.into_boxed_slice();
    // PORT NOTE: `state` field of each handle was set above as a raw ptr before `state.handles`
    // was assigned — the address of `state` does not change, so the backref remains valid.

    // Set up pre->main->post chaining within each group
    for group in &group_infos {
        if group.count > 1 {
            let mut j = group.start;
            while j < group.start + group.count - 1 {
                let dep = &raw mut state.handles[j + 1];
                state.handles[j].group_dependents.push(dep);
                // SAFETY: dep points into state.handles; distinct index from j
                unsafe { (*dep).remaining_dependencies += 1 };
                j += 1;
            }
        }
    }

    // For sequential mode, chain groups together
    if ctx.sequential {
        let mut gi: usize = 0;
        while gi < group_infos.len() - 1 {
            let current_group = &group_infos[gi];
            let next_group = &group_infos[gi + 1];
            // Last handle of current group -> first handle of next group
            let last_in_current = current_group.start + current_group.count - 1;
            let first_in_next = next_group.start;
            let dep = &raw mut state.handles[first_in_next];
            state.handles[last_in_current].next_dependents.push(dep);
            // SAFETY: dep points into state.handles; distinct index from last_in_current
            unsafe { (*dep).remaining_dependencies += 1 };
            gi += 1;
        }
    }

    // Start handles with no dependencies
    for handle in state.handles.iter_mut() {
        if handle.remaining_dependencies == 0 {
            if handle.start().is_err() {
                Output::pretty_errorln("<r><red>error<r>: Failed to start process");
                Global::exit(1);
            }
        }
    }

    AbortHandler::install();

    while !state.is_done() {
        if SHOULD_ABORT.load(Ordering::SeqCst) && !state.aborted {
            AbortHandler::uninstall();
            state.abort();
        }
        // SAFETY: event_loop points at the thread-lifetime MiniEventLoop singleton.
        unsafe { (*event_loop).tick_once((&raw const state).cast_mut().cast::<c_void>()) };
    }

    let status = state.finalize();
    Global::exit(status as u32);
}

fn has_runnable_extension(name: &[u8]) -> bool {
    let ext = path::extension(name);
    let Some(loader) = bun_bundler::options::DEFAULT_LOADERS.get(ext) else {
        return false;
    };
    loader.can_be_run_by_bun()
}

// ported from: src/cli/multi_run.zig
