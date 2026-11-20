use core::cell::Cell;
#[cfg(unix)]
use core::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use crate::Error;
use bun_collections::{StringArrayHashMap, VecExt};
use bun_core::strings;
use bun_core::{self as bun, Global, Output, UnwrapOrOom, ZStr};
use bun_event_loop::EventLoopHandle;
use bun_event_loop::MiniEventLoop::MiniEventLoop;
use bun_install::lifecycle_script_runner::ScriptArgv;
use bun_install::package_manager::workspace_selection;
use bun_io::{BufferedReader, IoEvent, Owner, PollTag};
use bun_paths as path;

use crate::Command;
use crate::filter_arg as FilterArg;
use crate::run_command::{ConfigureEnvOptions, RunCommand};

// `bun.spawn` (Process/Status/SpawnOptions/Rusage/spawnProcess) —
// lives under crate::api::bun::process.
#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
use crate::api::bun::process::{
    self as spawn, Rusage, SpawnOptions, SpawnProcessResult, Status, event_loop_handle_to_ctx,
};
use bun_collections::index_sort;
use bun_dotenv::Loader as DotEnvLoader;
type OutputWriter = bun_core::io::Writer;

/// Value type for package.json `scripts` map. Mirrors
/// `bun_resolver::package_json::ScriptsMap` (`StringArrayHashMap<&'static [u8]>`).
/// Its `&'static [u8]` values borrow the owning `PackageJSON.source_contents`.
type ScriptsMap = StringArrayHashMap<&'static [u8]>;

/// Owned variant of `ScriptsMap`: both keys and values are owned `Box<[u8]>`, so
/// it can outlive the `PackageJSON` the bytes were parsed from (see `MatchedPackage`).
type OwnedScriptsMap = StringArrayHashMap<Box<[u8]>>;

struct ScriptConfig {
    label: Box<[u8]>,
    /// Of the script in package.json. Empty: it is not one.
    name: Box<[u8]>,
    command: Box<[u8]>,
    cwd: Box<[u8]>,
    /// PATH env var value for this script
    path: Box<[u8]>,
    /// Index of its group: pre, main and post scripts run in turn and share a color.
    group: usize,
}

/// What the callbacks of every script need.
struct Shared {
    event_loop: &'static MiniEventLoop,
    max_label_len: usize,
    use_colors: bool,
    /// A process has exited since `State::finish_exited` last looked.
    has_exits: Cell<bool>,
    has_failure: Cell<bool>,
}

impl Shared {
    fn write_prefix(&self, config: &ScriptConfig, writer: &OutputWriter) -> Result<(), Error> {
        if self.use_colors {
            writer.write_all(COLORS[config.group % COLORS.len()])?;
        }

        writer.write_all(&config.label)?;
        let padding = self.max_label_len.saturating_sub(config.label.len());
        for _ in 0..padding {
            writer.write_all(b" ")?;
        }

        if self.use_colors {
            writer.write_all(RESET)?;
        }

        writer.write_all(b" | ")?;
        Ok(())
    }
}

/// Prints what a script writes to stdout or to stderr, line by line.
struct ScriptOutput<'a> {
    shared: &'a Shared,
    config: &'a ScriptConfig,
    is_stderr: bool,
    line_buffer: Vec<u8>,
}

impl ScriptOutput<'_> {
    /// Child stdout -> parent stdout, child stderr -> parent stderr
    fn writer(&self) -> &'static OutputWriter {
        if self.is_stderr {
            Output::error_writer()
        } else {
            Output::writer()
        }
    }

    fn read_chunk(&mut self, chunk: &[u8]) -> Result<(), Error> {
        self.line_buffer.extend_from_slice(chunk);
        let writer = self.writer();

        // Process complete lines
        while let Some(newline_pos) = strings::index_of_char_usize(&self.line_buffer, b'\n') {
            self.shared.write_prefix(self.config, writer)?;
            writer.write_all(&self.line_buffer[0..newline_pos + 1])?;
            // Remove processed line from buffer
            self.line_buffer.drain_front(newline_pos + 1);
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<(), Error> {
        if let Some(&last) = self.line_buffer.last() {
            let writer = self.writer();
            self.shared.write_prefix(self.config, writer)?;
            writer.write_all(&self.line_buffer)?;
            if last != b'\n' {
                let _ = writer.write_all(b"\n");
            }
            self.line_buffer.clear();
        }
        Ok(())
    }
}

pub(crate) struct PipeReader<'a> {
    reader: BufferedReader,
    output: ScriptOutput<'a>,
}

impl<'a> PipeReader<'a> {
    fn new(shared: &'a Shared, config: &'a ScriptConfig, is_stderr: bool) -> Self {
        Self {
            reader: BufferedReader::init(),
            output: ScriptOutput {
                shared,
                config,
                is_stderr,
                line_buffer: Vec::new(),
            },
        }
    }

    pub(crate) fn read(&mut self, event: Option<IoEvent>) {
        let event_loop = self.output.shared.event_loop.as_event_loop_ctx();
        // Ignored: `on_process_exit` ends the script.
        let _ = self.reader.read_chunks(event_loop, event, |chunk, _| {
            let _ = self.output.read_chunk(&chunk);
            true
        });
    }

    /// After the exit: a leftover child may hold the pipe open, so its EOF may never come.
    fn drain_and_close(&mut self) {
        // Windows has no synchronous drain.
        #[cfg(unix)]
        if !self.reader.is_done() && self.reader.get_fd() != bun_sys::Fd::INVALID {
            self.read(None);
        }
        if !self.reader.is_done() {
            self.reader.deinit();
        }
    }
}

struct ProcessSlot {
    process: spawn::ProcessHandle,
    status: Status,
    start_time: Instant,
    /// Set together with `status` when the exit arrives.
    end_time: Option<Instant>,
}

pub(crate) struct ProcessHandle<'a> {
    config: &'a ScriptConfig,
    shared: &'a Shared,

    stdout_reader: PipeReader<'a>,
    stderr_reader: PipeReader<'a>,

    process: Option<ProcessSlot>,
    options: SpawnOptions<'static>,

    /// Counted out of `remaining_scripts`.
    finished: bool,
}

impl<'a> ProcessHandle<'a> {
    fn start(
        &mut self,
        shell_bin: Option<&'static ZStr>,
        env: &mut DotEnvLoader,
    ) -> Result<(), Error> {
        let argv = ScriptArgv::new(shell_bin, ZStr::from_slice_with_nul(&self.config.command))?;

        let start_time = Instant::now();
        let envp;
        let mut spawned: SpawnProcessResult = {
            let original_path: Box<[u8]> = env.map.get(b"PATH").map(Box::from).unwrap_or_default();
            let _ = env.map.put(b"PATH", &self.config.path);
            let mut env = scopeguard::guard(env, move |env| {
                let _ = env.map.put(b"PATH", &original_path);
            });
            envp = crate::cli::script_or_command::with_package_script(
                &mut env,
                &self.config.name,
                &self.config.cwd,
                |env| env.map.to_envp(),
            );
            spawn::spawn_process(&self.options, argv.as_list(), Some(envp.as_list()))?
                .map_err(Error::from)?
        };
        let (stdout_pipe, stderr_pipe) = (spawned.stdout.take(), spawned.stderr.take());
        let process = spawned.to_process_handle(EventLoopHandle::init_mini(self.shared.event_loop));

        for pipe in [&mut self.stdout_reader, &mut self.stderr_reader] {
            let owner = Owner::new(PollTag::MultiRunPipeReader, std::ptr::from_mut(pipe).cast());
            // SAFETY: `owner` points to the value that holds this reader, whose slot in `State.handles` does not move.
            unsafe { pipe.reader.set_owner(owner) };
        }

        #[cfg(windows)]
        {
            if let spawn::WindowsStdioResult::Buffer(pipe) = stdout_pipe {
                self.stdout_reader
                    .reader
                    .set_source(bun_io::Source::Pipe(pipe));
            }
            if let spawn::WindowsStdioResult::Buffer(pipe) = stderr_pipe {
                self.stderr_reader
                    .reader
                    .set_source(bun_io::Source::Pipe(pipe));
            }
        }

        #[cfg(unix)]
        for (pipe, file) in [
            (&self.stdout_reader, stdout_pipe),
            (&self.stderr_reader, stderr_pipe),
        ] {
            if let Some(fd) = file.map(bun_sys::File::into_raw) {
                let _ = bun_sys::set_nonblocking(fd);
                let event_loop = self.shared.event_loop.as_event_loop_ctx();
                let _ = pipe.reader.start(event_loop, fd, true)?;
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
            process,
            status: Status::Running,
            start_time,
            end_time: None,
        });
        let self_ptr = std::ptr::from_mut::<Self>(self);
        // Not a borrow of the slot, which the exit handler borrows again.
        let process = self.process.as_ref().unwrap().process.this_ptr();
        // SAFETY: `self` is the live `ProcessHandle` slot in `State.handles`;
        // it lives for the whole event loop and outlives `process`.
        process.set_exit_handler(unsafe {
            bun_spawn::ProcessExit::new(bun_spawn::ProcessExitKind::MultiRunHandle, self_ptr)
        });

        match spawn::Process::watch_or_reap(process) {
            Ok(_) => {}
            Err(err) => {
                if !process.has_exited() {
                    // SAFETY: all-zero is a valid Rusage (POD C struct)
                    let rusage = bun_core::ffi::zeroed::<Rusage>();
                    spawn::Process::on_exit(process, Status::Err(err), &rusage);
                }
            }
        }

        Ok(())
    }
}

bun_spawn::link_impl_ProcessExit! {
    MultiRunHandle for ProcessHandle<'static> => |this| {
        on_process_exit(status, _rusage) => {
            let (shared, slot) = ((*this).shared, (*this).process.as_mut().unwrap());
            if !status.is_ok() {
                shared.has_failure.set(true);
            }
            shared.has_exits.set(true);
            slot.status = status;
            slot.end_time = Some(Instant::now());
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
    shared: &'a Shared,
    remaining_scripts: usize,
    /// The POSIX shell that the scripts run under. `None` on Windows (see `ScriptArgv`).
    shell_bin: Option<&'static ZStr>,
    aborted: bool,
    no_exit_on_error: bool,
    sequential: bool,
    env: *mut DotEnvLoader,
}

impl<'a> State<'a> {
    fn is_done(&self) -> bool {
        self.remaining_scripts == 0
    }

    fn start(&mut self, index: usize) {
        self.remaining_scripts += 1;
        // SAFETY: the process-lifetime DotEnv loader; nothing else reaches it during `start`.
        let env = unsafe { &mut *self.env };
        if self.handles[index].start(self.shell_bin, env).is_err() {
            bun_core::pretty_errorln!("<r><red>error<r>: Failed to start process");
            Global::exit(1);
        }
    }

    fn finish_exited(&mut self) {
        // A script that is started here can have exited by the time it is watched.
        while self.shared.has_exits.take() {
            for index in 0..self.handles.len() {
                let _ = self.maybe_finish(index);
            }
            if self.must_abort() {
                self.abort();
            }
        }
    }

    fn must_abort(&self) -> bool {
        self.shared.has_failure.get() && !self.no_exit_on_error
    }

    fn maybe_finish(&mut self, index: usize) -> Result<(), Error> {
        let handle = &mut self.handles[index];
        let exited = matches!(&handle.process, Some(p) if !matches!(p.status, Status::Running));
        if handle.finished || !exited {
            return Ok(());
        }
        handle.finished = true;
        self.remaining_scripts -= 1;

        // Aborted runs finish on exit alone; their pending output is dropped.
        if !self.aborted {
            handle.stdout_reader.drain_and_close();
            handle.stderr_reader.drain_and_close();
        }

        // Flush remaining buffers (stdout first, then stderr)
        handle.stdout_reader.output.flush()?;
        handle.stderr_reader.output.flush()?;

        // Print exit status to stderr (status messages always go to stderr)
        let writer = Output::error_writer();
        self.shared.write_prefix(handle.config, writer)?;

        let slot = handle.process.as_ref().unwrap();
        match &slot.status {
            Status::Exited(exited) => {
                if exited.code != 0 {
                    writeln!(writer, "Exited with code {}", exited.code)?;
                } else {
                    if let Some(end) = slot.end_time {
                        let duration = end.duration_since(slot.start_time);
                        let ms = duration.as_nanos() as f64 / 1_000_000.0;
                        if ms > 1000.0 {
                            writeln!(writer, "Done in {:.2}s", ms / 1000.0)?;
                        } else {
                            writeln!(writer, "Done in {:.0}ms", ms)?;
                        }
                    } else {
                        writer.write_all(b"Done\n")?;
                    }
                }
            }
            Status::Signaled(signal) => {
                let name = bun_sys::SignalCode(*signal).name().unwrap_or("unknown");
                writeln!(writer, "Signaled: {}", name)?;
            }
            _ => {
                writer.write_all(b"Error\n")?;
            }
        }

        let failed = !slot.status.is_ok();
        if !self.aborted && !self.must_abort() {
            self.start_next(index, failed);
        }
        Ok(())
    }

    /// Starts the script that waits for the one at `index`.
    fn start_next(&mut self, index: usize, failed: bool) {
        let group = self.handles[index].config.group;
        let in_group = |handle: &ProcessHandle| handle.config.group == group;
        let rest = &self.handles[index + 1..];
        // A failure ends the pre->main->post chain, even with --no-exit-on-error.
        let skipped = if failed {
            rest.iter().take_while(|h| in_group(h)).count()
        } else {
            0
        };
        if (rest.get(skipped)).is_some_and(|next| self.sequential || in_group(next)) {
            self.start(index + 1 + skipped);
        }
    }

    fn abort(&mut self) {
        if self.aborted {
            return;
        }
        self.aborted = true;
        for proc in self.handles.iter().filter_map(|h| h.process.as_ref()) {
            if matches!(proc.status, Status::Running) {
                let _ = proc.process.kill(bun_sys::SignalCode::SIGINT.0);
            }
        }
    }

    fn finalize(&self) -> u8 {
        for handle in self.handles.iter() {
            if let Some(proc) = &handle.process {
                match &proc.status {
                    Status::Exited(exited) => {
                        if exited.code != 0 {
                            return exited.code;
                        }
                    }
                    Status::Signaled(signal) => {
                        return bun_sys::SignalCode(*signal).to_exit_code();
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

    fn install() {
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
            let res = bun_sys::windows::SetConsoleCtrlHandler(
                Some(Self::windows_ctrl_handler),
                bun_sys::windows::TRUE,
            );
            if res == 0 {
                if bun_core::env::IS_DEBUG {
                    bun_core::warn!("Failed to set abort handler\n");
                }
            }
        }
    }

    fn uninstall() {
        #[cfg(windows)]
        {
            let _ = bun_sys::windows::SetConsoleCtrlHandler(
                Some(Self::windows_ctrl_handler),
                bun_sys::windows::FALSE,
            );
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

/// Add configs for a single script name (with pre/post handling).
/// When `label_prefix` is non-null, labels become "{prefix}:{name}" (for workspace runs).
///
/// Generic over the scripts map value type so both the single-package path
/// (values borrow the process-lifetime DirInfo-cached package.json) and the
/// workspace path (values are owned `Box<[u8]>` copies, see `MatchedPackage`)
/// can share this code. The script bytes are only ever read here, never stored.
fn add_script_configs<V: core::ops::Deref<Target = [u8]>>(
    configs: &mut Vec<ScriptConfig>,
    raw_name: &[u8],
    scripts_map: Option<&StringArrayHashMap<V>>,
    cwd: &[u8],
    path: &[u8],
    label_prefix: Option<&[u8]>,
) -> Result<(), Error> {
    let group = configs.last().map_or(0, |last| last.group + 1);

    let label: Box<[u8]> = if let Some(prefix) = label_prefix {
        let mut v = Vec::with_capacity(prefix.len() + 1 + raw_name.len());
        v.extend_from_slice(prefix);
        v.push(b':');
        v.extend_from_slice(raw_name);
        v.into_boxed_slice()
    } else {
        Box::from(raw_name)
    };
    // The label is only ever printed, never used to look up a script, so escaping it is safe.
    let label: Box<[u8]> = bun_core::fmt::escape_control_chars(&label)
        .to_string()
        .into_bytes()
        .into();

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
                name: pre_name.into_boxed_slice(),
                command: cmd_buf.into_boxed_slice(),
                cwd: Box::from(cwd),
                path: Box::from(path),
                group,
            });
        }

        // Main script
        {
            let mut cmd_buf: Vec<u8> = Vec::with_capacity(content.len() + 1);
            RunCommand::replace_package_manager_run(&mut cmd_buf, content)?;
            cmd_buf.push(0);
            configs.push(ScriptConfig {
                label: label.clone(),
                name: Box::from(raw_name),
                command: cmd_buf.into_boxed_slice(),
                cwd: Box::from(cwd),
                path: Box::from(path),
                group,
            });
        }

        if let Some(pc) = post_content {
            let mut cmd_buf: Vec<u8> = Vec::with_capacity(pc.len() + 1);
            RunCommand::replace_package_manager_run(&mut cmd_buf, pc)?;
            cmd_buf.push(0);
            configs.push(ScriptConfig {
                label,
                name: post_name.into_boxed_slice(),
                command: cmd_buf.into_boxed_slice(),
                cwd: Box::from(cwd),
                path: Box::from(path),
                group,
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
            name: Box::default(),
            command: command_z,
            cwd: Box::from(cwd),
            path: Box::from(path),
            group,
        });
    }

    Ok(())
}

// Returns either an error or diverges:
// `Result<Infallible, Error>` so callers can `?` it; all Ok paths call Global::exit.
pub(crate) fn run(ctx: &mut Command::ContextData) -> Result<core::convert::Infallible, Error> {
    // Validate flags
    if ctx.parallel && ctx.sequential {
        bun_core::pretty_errorln!(
            "<r><red>error<r>: --parallel and --sequential cannot be used together"
        );
        Global::exit(1);
    }

    // Collect script names from positionals + passthrough
    // For RunCommand: positionals[0] is "run", skip it. For AutoCommand: no "run" prefix.
    // Cloned to owned so the &mut ctx borrow below doesn't conflict.
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
        bun_core::pretty_errorln!(
            "<r><red>error<r>: --parallel/--sequential requires at least one script name"
        );
        Global::exit(1);
    }

    // Set up the transpiler/environment
    let _ = bun_resolver::fs::FileSystem::init(None)?;
    let mut this_transpiler_slot = None;
    let (this_transpiler, _) = RunCommand::configure_env_for_run(
        ctx,
        &mut this_transpiler_slot,
        None,
        ConfigureEnvOptions {
            log_errors: true,
            store_root_fd: false,
        },
    )?;
    let cwd: &[u8] = bun_resolver::fs::FileSystem::get().top_level_dir();

    // SAFETY: transpiler.env is a process-lifetime *mut Loader set in init.
    let env_ptr: *mut DotEnvLoader = this_transpiler.env;
    let event_loop = bun_event_loop::MiniEventLoop::init_global(
        // SAFETY: env_ptr is the process-lifetime DotEnv loader; no other borrow of it is live yet.
        Some(unsafe { &mut *env_ptr }),
    );
    // Windows: recursive kill-on-close Job so cmd.exe/.cmd-shim grandchildren
    // (which escape libuv's SILENT_BREAKAWAY job) die with us. POSIX: no-op.
    bun_io::ParentDeathWatchdog::ensure_kill_on_close_job();
    // --no-orphans: register the macOS kqueue parent watch on this MiniEventLoop
    // (the VirtualMachine.init path is never reached for --parallel). Linux is
    // already covered by prctl in enable() + linux_pdeathsig on each spawn.
    bun_io::ParentDeathWatchdog::install_on_event_loop(event_loop_handle_to_ctx(
        EventLoopHandle::init_mini(event_loop),
    ));
    let shell_bin: Option<&'static ZStr> = if cfg!(unix) {
        // SAFETY: env_ptr is the process-lifetime DotEnv loader; the &mut borrow passed to
        // init_global above has been released, so this read does not alias a live &mut.
        let path_env = unsafe { (*env_ptr).get(b"PATH") }.unwrap_or(b"");
        Some(RunCommand::find_shell(path_env, cwd).ok_or(crate::Error::MissingShell)?)
    } else {
        None
    };

    // Build ScriptConfigs and ProcessHandles
    // Each script name can produce up to 3 handles (pre, main, post)
    let mut configs: Vec<ScriptConfig> = Vec::new();

    if !ctx.filters.is_empty() || ctx.workspaces {
        // Workspace-aware mode: iterate over matching workspace packages
        let selected = FilterArg::select_packages(&*ctx, &mut this_transpiler.resolver, cwd)?;
        let resolve_root: &[u8] = &selected.root_dir;

        // Phase 1: collect packages; `scripts` is deep-copied so MatchedPackage sorts independently of `selected`.
        struct MatchedPackage {
            name: Box<[u8]>,
            dirpath: Box<[u8]>,
            scripts: OwnedScriptsMap,
            path: Box<[u8]>,
        }
        let mut matched_packages: Vec<MatchedPackage> = Vec::new();

        for package in &selected.packages {
            let Some(pkg_scripts) = &package.json.scripts else {
                continue;
            };
            let mut owned_scripts = OwnedScriptsMap::with_capacity(pkg_scripts.count());
            for (key, value) in pkg_scripts.iter() {
                owned_scripts
                    .put(&key[..], Box::<[u8]>::from(&value[..]))
                    .unwrap_or_oom();
            }

            let run_in_bun = ctx.debug.run_in_bun;
            let pkg_path_env = RunCommand::path_for_run(
                this_transpiler.env_mut(),
                &package.dir,
                None,
                &package.dir,
                run_in_bun,
            )?;
            let pkg_name = package.display_name(resolve_root);

            matched_packages.push(MatchedPackage {
                name: pkg_name,
                dirpath: package.dir.clone(),
                scripts: owned_scripts,
                path: pkg_path_env.into(),
            });
        }

        // Phase 2: Sort by package name, then by path as tiebreaker for deterministic ordering
        index_sort::sort_slice_by(&mut matched_packages, |a, b| {
            let name_order = a.name.cmp(&b.name);
            if name_order != core::cmp::Ordering::Equal {
                return name_order;
            }
            a.dirpath.cmp(&b.dirpath)
        });

        // Phase 3: Build configs from sorted packages
        for pkg in &matched_packages {
            for raw_name in &script_names {
                if strings::contains_char(raw_name, b'*') {
                    // Glob: expand against this package's scripts
                    let mut matches: Vec<&[u8]> = Vec::new();
                    for key in pkg.scripts.keys() {
                        if matches_glob(raw_name, key) {
                            matches.push(key);
                        }
                    }
                    index_sort::sort_slice_by(&mut matches, |a, b| a.cmp(b));
                    for matched_name in &matches {
                        add_script_configs(
                            &mut configs,
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
                            raw_name,
                            Some(&pkg.scripts),
                            &pkg.dirpath,
                            &pkg.path,
                            Some(&pkg.name),
                        )?;
                    } else if ctx.workspaces && !ctx.if_present {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: Missing \"{}\" script in package \"{}\"",
                            bstr::BStr::new(raw_name),
                            bstr::BStr::new(&pkg.name),
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
            let names: Vec<&[u8]> = script_names.iter().map(|n| &**n).collect();
            selected.error_script_not_found(ctx, &workspace_selection::quote_patterns(&names));
        }
    } else {
        // Single-package mode: use the root package.json
        let run_in_bun = ctx.debug.run_in_bun;
        let path_env =
            RunCommand::path_for_run(this_transpiler.env_mut(), b"", None, cwd, run_in_bun)?;

        // Load package.json scripts
        let root_dir_info = match this_transpiler.resolver.read_dir_info(cwd) {
            Ok(Some(info)) => info,
            Ok(None) | Err(_) => {
                bun_core::pretty_errorln!("<r><red>error<r>: Failed to read directory");
                Global::exit(1);
            }
        };

        let package_json = (*root_dir_info).enclosing_package_json;
        let scripts_map: Option<&ScriptsMap> = package_json.and_then(|pkg| pkg.scripts.as_deref());

        for raw_name in &script_names {
            // Check if this is a glob pattern
            if strings::contains_char(raw_name, b'*') {
                if let Some(sm) = scripts_map {
                    // Collect matching script names
                    let mut matches: Vec<&[u8]> = Vec::new();
                    for key in sm.keys() {
                        if matches_glob(raw_name, key) {
                            matches.push(key);
                        }
                    }

                    // Sort alphabetically
                    index_sort::sort_slice_by(&mut matches, |a, b| a.cmp(b));

                    if matches.is_empty() {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: No scripts match pattern \"{}\"",
                            bstr::BStr::new(raw_name),
                        );
                        Global::exit(1);
                    }

                    for matched_name in &matches {
                        add_script_configs(
                            &mut configs,
                            matched_name,
                            scripts_map,
                            cwd,
                            &path_env,
                            None,
                        )?;
                    }
                } else {
                    bun_core::pretty_errorln!(
                        "<r><red>error<r>: Cannot use glob pattern \"{}\" without package.json scripts",
                        bstr::BStr::new(raw_name),
                    );
                    Global::exit(1);
                }
            } else {
                add_script_configs(&mut configs, raw_name, scripts_map, cwd, &path_env, None)?;
            }
        }
    }

    if configs.is_empty() {
        bun_core::pretty_errorln!("<r><red>error<r>: No scripts to run");
        Global::exit(1);
    }

    // Compute max label width
    let mut max_label_len: usize = 0;
    for config in &configs {
        if config.label.len() > max_label_len {
            max_label_len = config.label.len();
        }
    }

    let shared = Shared {
        event_loop,
        max_label_len,
        use_colors: Output::enable_ansi_colors_stderr(),
        has_exits: Cell::new(false),
        has_failure: Cell::new(false),
    };

    // Initialize handles
    let mut handles: Vec<ProcessHandle> = Vec::with_capacity(configs.len());
    for config in &configs {
        handles.push(ProcessHandle {
            shared: &shared,
            config,
            stdout_reader: PipeReader::new(&shared, config, false),
            stderr_reader: PipeReader::new(&shared, config, true),
            process: None,
            finished: false,
            options: SpawnOptions {
                stdin: spawn::Stdio::Ignore,
                stdout: spawn::Stdio::Buffer,
                stderr: spawn::Stdio::Buffer,
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
    let mut state = State {
        handles: handles.into_boxed_slice(),
        shared: &shared,
        remaining_scripts: 0,
        shell_bin,
        aborted: false,
        no_exit_on_error: ctx.no_exit_on_error,
        sequential: ctx.sequential,
        env: env_ptr,
    };

    state.start(0);
    if !ctx.sequential {
        for index in 1..configs.len() {
            if configs[index].group != configs[index - 1].group {
                state.start(index);
            }
        }
    }

    AbortHandler::install();

    loop {
        state.finish_exited();
        if state.is_done() {
            break;
        }
        if SHOULD_ABORT.load(Ordering::SeqCst) && !state.aborted {
            AbortHandler::uninstall();
            state.abort();
        }
        event_loop.tick_once(core::ptr::null_mut());
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
