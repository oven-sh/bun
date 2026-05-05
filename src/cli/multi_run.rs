use core::ffi::{c_char, c_void};
use core::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use bun_alloc::AllocError;
use bun_collections::StringArrayHashMap;
use bun_core::{self as bun, err, Error, Global, Output};
use bun_io::{BufferedReader, ReadState};
use bun_jsc::{EventLoopHandle};
use bun_paths::{self as path, PathBuffer};
use bun_str::{strings, ZStr};

use crate::filter_arg as FilterArg;
use crate::run_command::RunCommand;
use crate::Command;

// TODO(port): crate path for `bun.spawn` (Process/Status/SpawnOptions/Rusage/spawnProcess) —
// lives under src/runtime/api/bun/process.zig; using `bun_runtime::spawn` as placeholder.
use bun_runtime::spawn::{self, Process, Rusage, SpawnOptions, SpawnProcessResult, Status};
// TODO(port): crate path for `bun.DotEnv.Loader`
use bun_dotenv::Loader as DotEnvLoader;
// TODO(port): crate path for `bun.io` BufferedReader/ReadState — assumed `bun_io`
// TODO(port): crate path for Output writer type
type OutputWriter = bun_core::output::Writer;

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
struct PipeReader {
    reader: BufferedReader,
    handle: *const ProcessHandle, // set in ProcessHandle::start()
    is_stderr: bool,
    line_buffer: Vec<u8>,
}

impl PipeReader {
    fn new(is_stderr: bool) -> Self {
        Self {
            // TODO(port): BufferedReader::init(This) — Zig passes the parent type for vtable;
            // Rust BufferedReader likely takes a trait object or callback set.
            reader: BufferedReader::init::<PipeReader>(),
            handle: ptr::null(),
            is_stderr,
            line_buffer: Vec::new(),
        }
    }

    pub fn on_read_chunk(&mut self, chunk: &[u8], _has_more: ReadState) -> bool {
        // SAFETY: handle is a backref set in ProcessHandle::start() before any read; State
        // outlives all handles (lives on `run`'s stack frame for the whole event loop).
        let state = unsafe { &mut *((*self.handle).state as *mut State) };
        let _ = state.read_chunk(self, chunk);
        true
    }

    pub fn on_reader_done(&mut self) {}

    pub fn on_reader_error(&mut self, _err: bun_sys::Error) {}

    pub fn event_loop(&self) -> &'static MiniEventLoop {
        // SAFETY: backref; see on_read_chunk
        unsafe { (*(*self.handle).state).event_loop }
    }

    pub fn r#loop(&self) -> &bun_aio::Loop {
        #[cfg(windows)]
        {
            // SAFETY: backref; see on_read_chunk
            unsafe { (*(*self.handle).state).event_loop.loop_.uv_loop }
        }
        #[cfg(not(windows))]
        {
            // SAFETY: backref; see on_read_chunk
            unsafe { (*(*self.handle).state).event_loop.loop_ }
        }
    }
}

struct ProcessSlot {
    ptr: Arc<Process>,
    status: Status,
}

pub struct ProcessHandle<'a> {
    config: &'a ScriptConfig,
    state: *const State<'a>,
    color_idx: usize,

    stdout_reader: PipeReader,
    stderr_reader: PipeReader,

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
        let state = unsafe { &mut *(self.state as *mut State) };
        state.remaining_scripts += 1;

        // TODO(port): argv as null-terminated array of `?[*:0]const u8` — exact ABI for
        // spawnProcess. Using *const c_char placeholders.
        let mut argv: [*const c_char; 4] = [
            state.shell_bin.as_ptr() as *const c_char,
            if cfg!(unix) { b"-c\0".as_ptr() } else { b"exec\0".as_ptr() } as *const c_char,
            self.config.command.as_ptr() as *const c_char,
            ptr::null(),
        ];

        self.start_time = Instant::now().into();
        // TODO(port): narrow error set
        let spawned: SpawnProcessResult = 'brk: {
            // PERF(port): was arena bulk-free — envp built into a temporary arena freed at scope
            // end. Phase A uses heap; profile in Phase B.
            let original_path: Box<[u8]> = state
                .env
                .map
                .get(b"PATH")
                .map(Box::from)
                .unwrap_or_default();
            state.env.map.put(b"PATH", &self.config.path);
            let _restore = scopeguard::guard((), |_| {
                // SAFETY: backref; see above
                let state = unsafe { &mut *(self.state as *mut State) };
                state.env.map.put(b"PATH", &original_path);
            });
            // TODO(port): createNullDelimitedEnvMap signature/ownership
            let envp = state.env.map.create_null_delimited_env_map()?;
            break 'brk spawn::spawn_process(&mut self.options, &mut argv[..], envp)?.unwrap()?;
        };
        let process = spawned.to_process(state.event_loop, false);

        self.stdout_reader.handle = self as *const _;
        self.stderr_reader.handle = self as *const _;
        self.stdout_reader
            .reader
            .set_parent(&mut self.stdout_reader as *mut _);
        self.stderr_reader
            .reader
            .set_parent(&mut self.stderr_reader as *mut _);

        #[cfg(windows)]
        {
            // TODO(port): SpawnOptions stdout/stderr `.buffer` payload type on Windows (libuv Pipe)
            self.stdout_reader.reader.source = bun_io::Source::Pipe(self.options.stdout.buffer);
            self.stderr_reader.reader.source = bun_io::Source::Pipe(self.options.stderr.buffer);
        }

        #[cfg(unix)]
        {
            if let Some(stdout_fd) = spawned.stdout {
                let _ = bun_sys::set_nonblocking(stdout_fd);
                self.stdout_reader.reader.start(stdout_fd, true).unwrap()?;
            }
            if let Some(stderr_fd) = spawned.stderr {
                let _ = bun_sys::set_nonblocking(stderr_fd);
                self.stderr_reader.reader.start(stderr_fd, true).unwrap()?;
            }
        }
        #[cfg(not(unix))]
        {
            self.stdout_reader.reader.start_with_current_pipe().unwrap()?;
            self.stderr_reader.reader.start_with_current_pipe().unwrap()?;
        }

        self.process = Some(ProcessSlot {
            ptr: process.clone(),
            status: Status::Running,
        });
        process.set_exit_handler(self);

        match process.watch_or_reap() {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(err) => {
                if !process.has_exited() {
                    // SAFETY: all-zero is a valid Rusage (POD C struct)
                    let rusage = unsafe { core::mem::zeroed::<Rusage>() };
                    process.on_exit(Status::Err(err), &rusage);
                }
            }
        }

        Ok(())
    }

    pub fn on_process_exit(&mut self, _proc: &Process, status: Status, _rusage: &Rusage) {
        self.process.as_mut().unwrap().status = status;
        self.end_time = Instant::now().into();
        // SAFETY: state backref; see start()
        let state = unsafe { &mut *(self.state as *mut State) };
        let _ = state.process_exit(self);
    }

    pub fn event_loop(&self) -> &'static MiniEventLoop {
        // SAFETY: state backref
        unsafe { (*self.state).event_loop }
    }

    pub fn r#loop(&self) -> &bun_aio::Loop {
        #[cfg(windows)]
        {
            // SAFETY: state backref
            unsafe { (*self.state).event_loop.loop_.uv_loop }
        }
        #[cfg(not(windows))]
        {
            // SAFETY: state backref
            unsafe { (*self.state).event_loop.loop_ }
        }
    }
}

const COLORS: [&[u8]; 6] = [
    b"\x1b[36m", // cyan
    b"\x1b[33m", // yellow
    b"\x1b[35m", // magenta
    b"\x1b[32m", // green
    b"\x1b[34m", // blue
    b"\x1b[31m", // red
];
const RESET: &[u8] = b"\x1b[0m";

struct State<'a> {
    handles: Box<[ProcessHandle<'a>]>,
    event_loop: &'static MiniEventLoop,
    remaining_scripts: usize,
    max_label_len: usize,
    // TODO(port): was `[:0]const u8`; needs NUL-terminated for argv[0]
    shell_bin: Box<[u8]>,
    aborted: bool,
    no_exit_on_error: bool,
    env: &'a DotEnvLoader,
    use_colors: bool,
}

impl<'a> State<'a> {
    pub fn is_done(&self) -> bool {
        self.remaining_scripts == 0
    }

    // TODO(port): narrow error set — was `(std.Io.Writer.Error || bun.OOM)!void`
    fn read_chunk(&mut self, pipe: &mut PipeReader, chunk: &[u8]) -> Result<(), Error> {
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
            let remaining_len = pipe.line_buffer.len() - (newline_pos + 1);
            pipe.line_buffer.copy_within(newline_pos + 1.., 0);
            pipe.line_buffer.truncate(remaining_len);
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
        handle: &ProcessHandle,
        pipe: &mut PipeReader,
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
    fn process_exit(&mut self, handle: &mut ProcessHandle) -> Result<(), Error> {
        self.remaining_scripts -= 1;

        // Flush remaining buffers (stdout first, then stderr)
        // PORT NOTE: reshaped for borrowck — pass handle by & while borrowing handle.stdout_reader
        // mutably; original Zig passed both as separate pointers.
        // TODO(port): borrowck — `handle` and `handle.stdout_reader` overlap; may need raw ptr or
        // restructure flush_pipe_buffer to take only the fields it needs.
        self.flush_pipe_buffer(handle, &mut handle.stdout_reader)?;
        self.flush_pipe_buffer(handle, &mut handle.stderr_reader)?;

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
                write!(writer, "Signaled: {}\n", <&'static str>::from(*signal))?;
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
                    Output::pretty_errorln("<r><red>error<r>: Failed to start process", ());
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
                    // TODO(port): SIGINT constant location
                    let _ = proc.ptr.kill(bun_sys::posix::SIG_INT);
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
                    Status::Signaled(signal) => return signal.to_exit_code().unwrap_or(1),
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
    extern "system" fn windows_ctrl_handler(dw_ctrl_type: bun_sys::windows::DWORD) -> bun_sys::windows::BOOL {
        if dw_ctrl_type == bun_sys::windows::CTRL_C_EVENT {
            SHOULD_ABORT.store(true, Ordering::SeqCst);
            return bun_sys::windows::TRUE;
        }
        bun_sys::windows::FALSE
    }

    pub fn install() {
        #[cfg(unix)]
        {
            // TODO(port): exact Sigaction layout / sigemptyset / SA_* flags via bun_sys
            let action = bun_sys::posix::Sigaction {
                handler: bun_sys::posix::SigHandler::SigAction(Self::posix_signal_handler),
                mask: bun_sys::posix::sigemptyset(),
                flags: bun_sys::posix::SA_SIGINFO
                    | bun_sys::posix::SA_RESTART
                    | bun_sys::posix::SA_RESETHAND,
            };
            bun_sys::posix::sigaction(bun_sys::posix::SIG_INT, &action, None);
        }
        #[cfg(not(unix))]
        {
            // TODO(port): move to <area>_sys
            // SAFETY: handler is extern "system" with matching signature; FFI call has no
            // preconditions beyond a valid fn pointer.
            let res = unsafe {
                bun_sys::windows::SetConsoleCtrlHandler(
                    Some(Self::windows_ctrl_handler),
                    bun_sys::windows::TRUE,
                )
            };
            if res == 0 {
                if cfg!(debug_assertions) {
                    Output::warn("Failed to set abort handler\n", ());
                }
            }
        }
    }

    pub fn uninstall() {
        #[cfg(windows)]
        {
            // SAFETY: passing None/FALSE removes the previously-installed handler; no invariants.
            unsafe {
                let _ = bun_sys::windows::SetConsoleCtrlHandler(None, bun_sys::windows::FALSE);
            }
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
    // TODO(port): value type — TSV says `String`; Zig is `[]const u8`
    scripts_map: Option<&StringArrayHashMap<String>>,
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
            RunCommand::replace_package_manager_run(&mut cmd_buf, pc.as_bytes())?;
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
            RunCommand::replace_package_manager_run(&mut cmd_buf, content.as_bytes())?;
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
            RunCommand::replace_package_manager_run(&mut cmd_buf, pc.as_bytes())?;
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
            let bun_path = bun::self_exe_path().unwrap_or_else(|_| b"bun".as_slice().into());
            // Quote the bun path so that backslashes on Windows are not
            // interpreted as escape characters by `bun exec` (Bun's shell).
            let mut v = Vec::with_capacity(bun_path.len() + raw_name.len() + 4);
            v.push(b'"');
            v.extend_from_slice(bun_path.as_ref());
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
pub fn run(ctx: &mut Command::Context) -> Result<core::convert::Infallible, Error> {
    // Validate flags
    if ctx.parallel && ctx.sequential {
        Output::pretty_errorln(
            "<r><red>error<r>: --parallel and --sequential cannot be used together",
            (),
        );
        Global::exit(1);
    }

    // Collect script names from positionals + passthrough
    // For RunCommand: positionals[0] is "run", skip it. For AutoCommand: no "run" prefix.
    let mut script_names: Vec<&[u8]> = Vec::new();

    let mut positionals: &[&[u8]] = &ctx.positionals;
    if !positionals.is_empty()
        && (positionals[0] == b"run" || positionals[0] == b"r")
    {
        positionals = &positionals[1..];
    }
    for pos in positionals {
        if !pos.is_empty() {
            script_names.push(pos);
        }
    }
    for pt in &ctx.passthrough {
        if !pt.is_empty() {
            script_names.push(pt);
        }
    }

    if script_names.is_empty() {
        Output::pretty_errorln(
            "<r><red>error<r>: --parallel/--sequential requires at least one script name",
            (),
        );
        Global::exit(1);
    }

    // Set up the transpiler/environment
    let fsinstance = bun_fs::FileSystem::init(None)?;
    // TODO(port): out-param init pattern — Zig writes into `var this_transpiler: Transpiler = undefined;`
    let mut this_transpiler: bun_bundler::Transpiler =
        RunCommand::configure_env_for_run(ctx, None, true, false)?;
    let cwd: &[u8] = fsinstance.top_level_dir;

    let event_loop = MiniEventLoop::init_global(this_transpiler.env, None);
    // --no-orphans: register the macOS kqueue parent watch on this MiniEventLoop
    // (the VirtualMachine.init path is never reached for --parallel). Linux is
    // already covered by prctl in enable() + linux_pdeathsig on each spawn.
    // TODO(port): crate path for ParentDeathWatchdog
    bun::ParentDeathWatchdog::install_on_event_loop(EventLoopHandle::init(event_loop));
    // TODO(port): shell_bin must be NUL-terminated ([:0]const u8) for argv use
    let shell_bin: Box<[u8]> = if cfg!(unix) {
        RunCommand::find_shell(this_transpiler.env.get(b"PATH").unwrap_or(b""), cwd)
            .ok_or(err!("MissingShell"))?
            .into()
    } else {
        bun::self_exe_path().map_err(|_| err!("MissingShell"))?.into()
    };

    // Build ScriptConfigs and ProcessHandles
    // Each script name can produce up to 3 handles (pre, main, post)
    let mut configs: Vec<ScriptConfig> = Vec::new();
    let mut group_infos: Vec<GroupInfo> = Vec::new();

    if !ctx.filters.is_empty() || ctx.workspaces {
        // Workspace-aware mode: iterate over matching workspace packages
        let filters_to_use: &[&[u8]] = if ctx.workspaces {
            &[b"*"]
        } else {
            &ctx.filters
        };

        let mut filter_instance = FilterArg::FilterSet::init(filters_to_use, cwd)?;
        let mut patterns: Vec<Box<[u8]>> = Vec::new();

        let mut root_buf = PathBuffer::uninit();
        let resolve_root =
            FilterArg::get_candidate_package_patterns(&ctx.log, &mut patterns, cwd, &mut root_buf)?;

        let mut package_json_iter =
            FilterArg::PackageFilterIterator::init(&patterns, resolve_root)?;
        // Drop handles deinit

        // Phase 1: Collect matching packages (filesystem order is nondeterministic)
        struct MatchedPackage<'a> {
            name: Box<[u8]>,
            dirpath: Box<[u8]>,
            scripts: &'a StringArrayHashMap<String>,
            path: Box<[u8]>,
        }
        let mut matched_packages: Vec<MatchedPackage> = Vec::new();

        while let Some(package_json_path) = package_json_iter.next()? {
            let dirpath: Box<[u8]> = Box::from(
                path::dirname(package_json_path).unwrap_or_else(|| Global::crash()),
            );
            let pkg_path = strings::without_trailing_slash(&dirpath);

            // When using --workspaces, skip the root package to prevent recursion
            if ctx.workspaces && pkg_path == resolve_root {
                continue;
            }

            // TODO(port): bun.PackageJSON.parse signature & enum args (.invalid, .include_scripts, .main)
            let Some(pkgjson) = bun_resolver::PackageJSON::parse(
                &mut this_transpiler.resolver,
                &dirpath,
                bun_resolver::HashKind::Invalid,
                None,
                bun_resolver::ScriptsOption::IncludeScripts,
                bun_resolver::MainField::Main,
            ) else {
                continue;
            };

            if !filter_instance.matches(pkg_path, pkgjson.name) {
                continue;
            }

            let Some(pkg_scripts) = pkgjson.scripts else {
                continue;
            };
            let pkg_path_env = RunCommand::configure_path_for_run_with_package_json_dir(
                ctx,
                &dirpath,
                &mut this_transpiler,
                None,
                &dirpath,
                ctx.debug.run_in_bun,
            )?;
            let pkg_name: Box<[u8]> = if !pkgjson.name.is_empty() {
                Box::from(pkgjson.name)
            } else {
                // Fallback: use relative path from workspace root
                Box::from(path::relative_platform(
                    resolve_root,
                    pkg_path,
                    path::Platform::Posix,
                    false,
                ))
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
                        if matches_glob(raw_name, key.as_bytes()) {
                            matches.push(key.as_bytes());
                        }
                    }
                    matches.sort();
                    for matched_name in &matches {
                        add_script_configs(
                            &mut configs,
                            &mut group_infos,
                            matched_name,
                            Some(pkg.scripts),
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
                            Some(pkg.scripts),
                            &pkg.dirpath,
                            &pkg.path,
                            Some(&pkg.name),
                        )?;
                    } else if ctx.workspaces && !ctx.if_present {
                        Output::pretty_errorln(
                            "<r><red>error<r>: Missing \"{s}\" script in package \"{s}\"",
                            (
                                bstr::BStr::new(raw_name),
                                bstr::BStr::new(&pkg.name),
                            ),
                        );
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
                    (),
                );
            } else {
                Output::pretty_errorln(
                    "<r><red>error<r>: No packages matched the filter",
                    (),
                );
            }
            Global::exit(1);
        }
    } else {
        // Single-package mode: use the root package.json
        let path_env = RunCommand::configure_path_for_run_with_package_json_dir(
            ctx,
            b"",
            &mut this_transpiler,
            None,
            cwd,
            ctx.debug.run_in_bun,
        )?;

        // Load package.json scripts
        let root_dir_info = match this_transpiler.resolver.read_dir_info(cwd) {
            Ok(Some(info)) => info,
            Ok(None) | Err(_) => {
                Output::pretty_errorln("<r><red>error<r>: Failed to read directory", ());
                Global::exit(1);
            }
        };

        let package_json = root_dir_info.enclosing_package_json;
        let scripts_map: Option<&StringArrayHashMap<String>> =
            package_json.and_then(|pkg| pkg.scripts);

        for raw_name in &script_names {
            // Check if this is a glob pattern
            if raw_name.iter().any(|&b| b == b'*') {
                if let Some(sm) = scripts_map {
                    // Collect matching script names
                    let mut matches: Vec<&[u8]> = Vec::new();
                    for key in sm.keys() {
                        if matches_glob(raw_name, key.as_bytes()) {
                            matches.push(key.as_bytes());
                        }
                    }

                    // Sort alphabetically
                    matches.sort();

                    if matches.is_empty() {
                        Output::pretty_errorln(
                            "<r><red>error<r>: No scripts match pattern \"{s}\"",
                            (bstr::BStr::new(raw_name),),
                        );
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
                    Output::pretty_errorln(
                        "<r><red>error<r>: Cannot use glob pattern \"{s}\" without package.json scripts",
                        (bstr::BStr::new(raw_name),),
                    );
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
        Output::pretty_errorln("<r><red>error<r>: No scripts to run", ());
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
        remaining_scripts: 0,
        max_label_len,
        shell_bin,
        aborted: false,
        no_exit_on_error: ctx.no_exit_on_error,
        env: this_transpiler.env,
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
            state: &state as *const _,
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
                stdout: spawn::Stdio::Buffer(Box::into_raw(Box::new(
                    // SAFETY: all-zero is a valid libuv Pipe (POD C struct)
                    unsafe { core::mem::zeroed::<bun_sys::windows::libuv::Pipe>() },
                ))),
                #[cfg(unix)]
                stderr: spawn::Stdio::Buffer,
                #[cfg(not(unix))]
                stderr: spawn::Stdio::Buffer(Box::into_raw(Box::new(
                    // SAFETY: all-zero is a valid libuv Pipe (POD C struct)
                    unsafe { core::mem::zeroed::<bun_sys::windows::libuv::Pipe>() },
                ))),
                cwd: config.cwd.clone(),
                #[cfg(windows)]
                windows: spawn::WindowsOptions {
                    loop_: EventLoopHandle::init(event_loop),
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
                let dep = &mut state.handles[j + 1] as *mut ProcessHandle;
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
            let dep = &mut state.handles[first_in_next] as *mut ProcessHandle;
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
                Output::pretty_errorln("<r><red>error<r>: Failed to start process", ());
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
        event_loop.tick_once(&state);
    }

    let status = state.finalize();
    Global::exit(status);
}

fn has_runnable_extension(name: &[u8]) -> bool {
    let ext = path::extension(name);
    let Some(loader) = bun_bundler::options::default_loaders().get(ext) else {
        return false;
    };
    loader.can_be_run_by_bun()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/multi_run.zig (845 lines)
//   confidence: medium
//   todos:      28
//   notes:      Heavy raw-ptr backrefs (State<->ProcessHandle<->PipeReader); spawn/Output/signal crate paths guessed; ScriptConfig command/shell_bin need NUL-terminated owned type; borrowck reshaping in process_exit/flush_pipe_buffer.
// ──────────────────────────────────────────────────────────────────────────
