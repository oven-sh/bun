use core::cell::{Cell, OnceCell, RefCell};
use core::ffi::{CStr, c_void};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use crate::Error;
use bun_collections::{StringArrayHashMap, VecExt};
use bun_core::strings;
use bun_core::{self as bun, Global, Output, UnwrapOrOom, ZStr};
use bun_event_loop::MiniEventLoop::GlobalMiniEventLoop;
use bun_install::package_manager::workspace_selection;
use bun_io::BufferedReader;
use bun_paths as path;
use bun_ptr::{BackRef, JsCell, OwnedThis, ThisPtr};

use crate::Command;
use crate::filter_arg as FilterArg;
use crate::run_command::{ConfigureEnvOptions, RunCommand};

// `bun.spawn` (Process/Status/SpawnOptions/Rusage/spawnProcess) —
// lives under crate::api::bun::process.
#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
use crate::api::bun::process::{
    self as spawn, Rusage, SpawnEnv, SpawnOptions, SpawnProcessResult, Status,
};
use bun_collections::index_sort;
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
    command: Box<[u8]>,
    cwd: Box<[u8]>,
    /// PATH env var value for this script
    path: Box<[u8]>,
}

/// Wraps a BufferedReader and tracks whether it represents stdout or stderr,
/// so output can be routed to the correct parent stream. Embedded in a
/// `ProcessHandle` and re-entered through `ThisPtr` from the reader callbacks,
/// so its state is `Cell`-based.
pub struct PipeReader {
    reader: JsCell<BufferedReader>,
    /// The `State` on `run`'s stack, which owns every handle and outlives the
    /// run loop.
    state: BackRef<State>,
    /// Index of the owning handle in `State::handles`.
    handle_index: usize,
    is_stderr: bool,
    /// Reached EOF or errored; no more chunks will arrive.
    ended: Cell<bool>,
    line_buffer: RefCell<Vec<u8>>,
}

impl PipeReader {
    fn new(state: BackRef<State>, handle_index: usize, is_stderr: bool) -> Self {
        Self {
            // BufferedReader::init(This) — the parent type fills the vtable.
            reader: JsCell::new(BufferedReader::init::<Self>()),
            state,
            handle_index,
            is_stderr,
            ended: Cell::new(false),
            line_buffer: RefCell::new(Vec::new()),
        }
    }

    fn handle(&self) -> &ProcessHandle {
        &self.state.get().handles()[self.handle_index]
    }

    fn on_reader_end(&self) {
        self.ended.set(true);
        let _ = self.state.get().maybe_finish(self.handle());
    }
}

// Callbacks here touch only `line_buffer` / `ended` and the State backref,
// never `reader`. `State` outlives all handles (lives on `run`'s stack frame
// for the whole event loop).
bun_io::impl_buffered_reader_parent! {
    MultiRunPipeReader for PipeReader;
    borrow = this;
    has_on_read_chunk = true;
    on_read_chunk = |this, chunk, _has_more| {
        let _ = this.state.get().read_chunk(this.get(), &chunk);
        true
    };
    on_reader_done  = |this| this.on_reader_end();
    on_reader_error = |this, _err| this.on_reader_end();
    loop_           = |this| bun_io::uws_to_native(this.state.event_loop.loop_ptr());
    event_loop      = |this| this.state.event_loop.event_loop_ctx();
}

struct ProcessSlot {
    process: spawn::ProcessHandle,
    status: RefCell<Status>,
    start_time: Instant,
    /// Set together with `status` when the exit arrives.
    end_time: Cell<Option<Instant>>,
}

/// One script run. Lives in `State::handles` for the whole run loop (heap
/// allocated, never moved or freed), and is re-entered through `ThisPtr` from
/// the process-exit callback and through its pipe readers, so all state is
/// `Cell`-based.
pub(crate) struct ProcessHandle {
    /// Position in `State::handles`.
    index: usize,
    config: ScriptConfig,
    /// The child's environment: the shared one with this script's $PATH.
    envp: bun_dotenv::NullDelimitedEnvMap,
    state: BackRef<State>,
    color_idx: usize,

    stdout_reader: PipeReader,
    stderr_reader: PipeReader,

    /// Set once by `start`.
    process: OnceCell<ProcessSlot>,
    options: SpawnOptions,

    /// Set by the `maybe_finish` that counts this script out of
    /// `remaining_scripts`, so a later pipe/exit event or the abort sweep
    /// cannot finish it twice.
    finished: Cell<bool>,

    remaining_dependencies: Cell<usize>,
    /// Dependents within the same script group (pre->main->post chain), as
    /// indices into `State::handles`.
    /// These are NOT started if this handle fails, even with --no-exit-on-error.
    group_dependents: Vec<usize>,
    /// Dependents across sequential groups (group N -> group N+1).
    /// These ARE started even if this handle fails when --no-exit-on-error is set.
    next_dependents: Vec<usize>,
}

impl ProcessHandle {
    fn start(this: ThisPtr<Self>) -> Result<(), Error> {
        let handle = this.get();
        let state = handle.state.get();
        state
            .remaining_scripts
            .set(state.remaining_scripts.get() + 1);

        let argv: [&CStr; 3] = [
            state.shell_bin.as_cstr(),
            if cfg!(unix) { c"-c" } else { c"exec" },
            CStr::from_bytes_until_nul(&handle.config.command).expect("built NUL-terminated"),
        ];

        let start_time = Instant::now();
        let spawned: SpawnProcessResult = {
            let envp: Vec<&CStr> = handle.envp.iter().collect();
            spawn::spawn_process_cstr(&handle.options, &argv, SpawnEnv::Strings(&envp))?
                .map_err(Error::from)?
        };
        // `mut` needed on Windows where `WindowsSpawnResult::to_process` takes `&mut self`
        // and the stdout/stderr pipes are `.take()`n below; on POSIX `to_process` consumes
        // `self` by value.
        #[cfg(windows)]
        let mut spawned = spawned;
        // POSIX-only: pipe FDs are read before `to_process` consumes `spawned`.
        // On Windows the readers are wired via `Source::Pipe` taken from
        // `spawned.stdout/stderr` below, and `WindowsStdioResult` is not `Copy`.
        #[cfg(unix)]
        let stdout_fd = spawned.stdout;
        #[cfg(unix)]
        let stderr_fd = spawned.stderr;
        let process = spawned.to_process_handle(state.event_loop.handle());

        // The readers' parents are the embedded `PipeReader`s (root provenance).
        let this_ptr = this.as_ptr();
        let stdout_parent = this_ptr.wrapping_byte_add(core::mem::offset_of!(Self, stdout_reader));
        let stderr_parent = this_ptr.wrapping_byte_add(core::mem::offset_of!(Self, stderr_reader));
        handle
            .stdout_reader
            .reader
            .with_mut(|r| r.set_parent(stdout_parent.cast::<c_void>()));
        handle
            .stderr_reader
            .reader
            .with_mut(|r| r.set_parent(stderr_parent.cast::<c_void>()));

        #[cfg(windows)]
        {
            // `spawn_process_windows` has *already* reclaimed
            // sole ownership of that heap pipe into
            // `WindowsStdioResult::Buffer(Box<uv::Pipe>)` (see
            // src/spawn/process.rs WindowsStdio::Buffer doc). Reconstructing a
            // second Box from `self.options.stdout` here would alias the same
            // allocation and double-free when `spawned` drops. Instead, move
            // the Box out of the spawn *result* — `WindowsStdioResult::take()`
            // leaves `Unavailable` behind so `spawned`'s drop is a no-op.
            if let spawn::WindowsStdioResult::Buffer(pipe) = spawned.stdout.take() {
                handle
                    .stdout_reader
                    .reader
                    .with_mut(|r| r.set_source(bun_io::Source::Pipe(pipe)));
            }
            if let spawn::WindowsStdioResult::Buffer(pipe) = spawned.stderr.take() {
                handle
                    .stderr_reader
                    .reader
                    .with_mut(|r| r.set_source(bun_io::Source::Pipe(pipe)));
            }
        }

        #[cfg(unix)]
        {
            if let Some(stdout_fd) = stdout_fd {
                let _ = bun_sys::set_nonblocking(stdout_fd);
                handle
                    .stdout_reader
                    .reader
                    .with_mut(|r| r.start(stdout_fd, true))
                    .map_err(Error::from)?;
            }
            if let Some(stderr_fd) = stderr_fd {
                let _ = bun_sys::set_nonblocking(stderr_fd);
                handle
                    .stderr_reader
                    .reader
                    .with_mut(|r| r.start(stderr_fd, true))
                    .map_err(Error::from)?;
            }
        }
        #[cfg(not(unix))]
        {
            handle
                .stdout_reader
                .reader
                .with_mut(|r| r.start_with_current_pipe())
                .map_err(Error::from)?;
            handle
                .stderr_reader
                .reader
                .with_mut(|r| r.start_with_current_pipe())
                .map_err(Error::from)?;
        }

        let slot = ProcessSlot {
            process,
            status: RefCell::new(Status::Running),
            start_time,
            end_time: Cell::new(None),
        };
        if handle.process.set(slot).is_err() {
            unreachable!("each script is started once");
        }
        let slot = handle.process.get().expect("set above");
        slot.process.set_exit_handler(this);

        match slot.process.watch_or_reap() {
            Ok(_) => {}
            Err(err) => {
                if !slot.process.has_exited() {
                    // SAFETY: all-zero is a valid Rusage (POD C struct)
                    let rusage = bun_core::ffi::zeroed::<Rusage>();
                    slot.process.on_exit(Status::Err(err), &rusage);
                }
            }
        }

        Ok(())
    }

    /// On process exit, read what the pipes already hold, then force-end any
    /// pipe a leftover child still keeps open: its EOF may never come and
    /// must not stall the finish. Windows has no synchronous drain, so only
    /// the force-end applies there. The reader callbacks re-enter
    /// `State::maybe_finish` for this handle while this runs.
    fn drain_and_close_pipes(&self) {
        for pipe in [&self.stdout_reader, &self.stderr_reader] {
            #[cfg(unix)]
            if !pipe.ended.get() && pipe.reader.get().get_fd() != bun_sys::Fd::INVALID {
                // EOF here dispatches `on_reader_done`, setting `ended`.
                BufferedReader::read_cell(&pipe.reader);
            }
            if !pipe.ended.get() {
                pipe.ended.set(true);
                // `deinit` fires no callback; `ended` is the accounting.
                pipe.reader.with_mut(|r| r.deinit());
            }
        }
    }

    fn on_process_exit(this: ThisPtr<Self>, status: Status) {
        let slot = this.process.get().expect("exit of a started process");
        *slot.status.borrow_mut() = status;
        slot.end_time.set(Some(Instant::now()));
        let state = this.state.get();
        // Aborted runs finish on exit alone; their pending output is dropped.
        if !state.aborted.get() {
            this.drain_and_close_pipes();
        }
        let _ = state.maybe_finish(this.get());
    }
}

bun_spawn::link_impl_ProcessExit! {
    MultiRunHandle for ProcessHandle => |this| {
        on_process_exit(_process, status, _rusage) =>
            ProcessHandle::on_process_exit(ThisPtr::new(this), status),
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

struct State {
    /// Set once every handle has been constructed (each holds a `BackRef` to
    /// this `State`).
    handles: OnceCell<Box<[OwnedThis<ProcessHandle>]>>,
    event_loop: GlobalMiniEventLoop,
    remaining_scripts: Cell<usize>,
    max_label_len: usize,
    shell_bin: &'static ZStr,
    aborted: Cell<bool>,
    no_exit_on_error: bool,
    use_colors: bool,
}

impl State {
    fn handles(&self) -> &[OwnedThis<ProcessHandle>] {
        self.handles.get().map(|h| &h[..]).unwrap_or(&[])
    }

    fn is_done(&self) -> bool {
        self.remaining_scripts.get() == 0
    }

    fn read_chunk(&self, pipe: &PipeReader, chunk: &[u8]) -> Result<(), Error> {
        let mut line_buffer = pipe.line_buffer.borrow_mut();
        line_buffer.extend_from_slice(chunk);

        // Route to correct parent stream: child stdout -> parent stdout, child stderr -> parent stderr
        let writer = if pipe.is_stderr {
            Output::error_writer()
        } else {
            Output::writer()
        };

        // Process complete lines
        let handle = pipe.handle();
        while let Some(newline_pos) = strings::index_of_char_usize(&line_buffer, b'\n') {
            let line = &line_buffer[0..newline_pos + 1];
            self.write_line_with_prefix(handle, line, writer)?;
            // Remove processed line from buffer
            line_buffer.drain_front(newline_pos + 1);
        }
        Ok(())
    }

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

    fn flush_pipe_buffer(&self, handle: &ProcessHandle, pipe: &PipeReader) -> Result<(), Error> {
        let mut line_buffer = pipe.line_buffer.borrow_mut();
        if !line_buffer.is_empty() {
            let line = &line_buffer[..];
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
            line_buffer.clear();
        }
        Ok(())
    }

    /// A script is finished once its process has exited *and* both pipes have
    /// ended; finishing on exit alone can drop output the exit notification
    /// beat. The exit path force-ends pipes a leftover child holds open
    /// (`drain_and_close_pipes`); on abort, exit alone suffices.
    fn maybe_finish(&self, handle: &ProcessHandle) -> Result<(), Error> {
        let exited = matches!(handle.process.get(), Some(p) if !matches!(*p.status.borrow(), Status::Running));
        let pipes_open = !handle.stdout_reader.ended.get() || !handle.stderr_reader.ended.get();
        if handle.finished.get() || !exited || (pipes_open && !self.aborted.get()) {
            return Ok(());
        }
        handle.finished.set(true);
        self.remaining_scripts.set(self.remaining_scripts.get() - 1);

        // Flush remaining buffers (stdout first, then stderr)
        self.flush_pipe_buffer(handle, &handle.stdout_reader)?;
        self.flush_pipe_buffer(handle, &handle.stderr_reader)?;

        // Print exit status to stderr (status messages always go to stderr)
        let writer = Output::error_writer();
        self.write_prefix(handle, writer)?;

        let slot = handle.process.get().expect("exited");
        let failed = {
            let status = slot.status.borrow();
            match &*status {
                Status::Exited(exited) => {
                    if exited.code != 0 {
                        writeln!(writer, "Exited with code {}", exited.code)?;
                    } else {
                        if let Some(end) = slot.end_time.get() {
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

            // Check if we should abort on error
            match &*status {
                Status::Exited(exited) => exited.code != 0,
                Status::Signaled(_) => true,
                _ => true,
            }
        };

        if failed && !self.no_exit_on_error {
            self.abort();
            return Ok(());
        }

        if failed {
            // Pre->main->post chain is broken -- skip group dependents.
            self.skip_dependents(&handle.group_dependents);
            // But cascade to next-group dependents (sequential --no-exit-on-error).
            if !self.aborted.get() {
                self.start_dependents(&handle.next_dependents);
            }
            return Ok(());
        }

        // Success: cascade to all dependents
        if !self.aborted.get() {
            self.start_dependents(&handle.group_dependents);
            self.start_dependents(&handle.next_dependents);
        }
        Ok(())
    }

    fn start_dependents(&self, dependents: &[usize]) {
        for &dependent in dependents {
            let dependent = &self.handles()[dependent];
            dependent
                .remaining_dependencies
                .set(dependent.remaining_dependencies.get() - 1);
            if dependent.remaining_dependencies.get() == 0 {
                if ProcessHandle::start(dependent.this_ptr()).is_err() {
                    bun_core::pretty_errorln!("<r><red>error<r>: Failed to start process");
                    Global::exit(1);
                }
            }
        }
    }

    /// Skip group dependents that will never start because their predecessor
    /// failed. Recursively skip their group dependents too.
    fn skip_dependents(&self, dependents: &[usize]) {
        for &dependent in dependents {
            let dependent = &self.handles()[dependent];
            dependent
                .remaining_dependencies
                .set(dependent.remaining_dependencies.get() - 1);
            if dependent.remaining_dependencies.get() == 0 {
                self.skip_dependents(&dependent.group_dependents);
                // Still cascade next_dependents so sequential chains continue
                if !self.aborted.get() {
                    self.start_dependents(&dependent.next_dependents);
                }
            }
        }
    }

    fn abort(&self) {
        if self.aborted.get() {
            return;
        }
        self.aborted.set(true);
        for handle in self.handles() {
            if let Some(proc) = handle.process.get() {
                if matches!(*proc.status.borrow(), Status::Running) {
                    let _ = proc.process.kill(bun_sys::SignalCode::SIGINT.0);
                }
            }
            // An already-exited handle may be waiting on pipes a grandchild
            // still holds; with `aborted` set this finishes it now. Killed
            // handles finish when their exit arrives.
            let _ = self.maybe_finish(handle);
        }
    }

    fn finalize(&self) -> u8 {
        for handle in self.handles() {
            if let Some(proc) = handle.process.get() {
                match &*proc.status.borrow() {
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

// Set from the Ctrl+C handler.
static SHOULD_ABORT: AtomicBool = AtomicBool::new(false);

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
///
/// Generic over the scripts map value type so both the single-package path
/// (values borrow the process-lifetime DirInfo-cached package.json) and the
/// workspace path (values are owned `Box<[u8]>` copies, see `MatchedPackage`)
/// can share this code. The script bytes are only ever read here, never stored.
fn add_script_configs<V: core::ops::Deref<Target = [u8]>>(
    configs: &mut Vec<ScriptConfig>,
    group_infos: &mut Vec<GroupInfo>,
    raw_name: &[u8],
    scripts_map: Option<&StringArrayHashMap<V>>,
    cwd: &[u8],
    path: &[u8],
    label_prefix: Option<&[u8]>,
) -> Result<(), Error> {
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
    let mut this_transpiler_slot =
        ::core::mem::MaybeUninit::<bun_bundler::Transpiler<'static>>::uninit();
    let (this_transpiler, _) = RunCommand::configure_env_for_run(
        ctx,
        &mut this_transpiler_slot,
        None,
        ConfigureEnvOptions {
            log_errors: true,
            store_root_fd: false,
        },
    )?;
    let cwd: &[u8] = bun_resolver::fs::FileSystem::get().top_level_dir;

    // `Transpiler::init` set `env` to the process-lifetime loader singleton.
    let event_loop =
        GlobalMiniEventLoop::init(Some(BackRef::new_mut(this_transpiler.env_mut())), None);
    // Windows: recursive kill-on-close Job so cmd.exe/.cmd-shim grandchildren
    // (which escape libuv's SILENT_BREAKAWAY job) die with us. POSIX: no-op.
    bun_io::ParentDeathWatchdog::ensure_kill_on_close_job();
    // --no-orphans: register the macOS kqueue parent watch on this MiniEventLoop
    // (the VirtualMachine.init path is never reached for --parallel). Linux is
    // already covered by prctl in enable() + linux_pdeathsig on each spawn.
    bun_io::ParentDeathWatchdog::install_on_event_loop(event_loop.event_loop_ctx());
    let shell_bin: &'static ZStr = if cfg!(unix) {
        let path_env = this_transpiler.env().get(b"PATH").unwrap_or(b"");
        RunCommand::find_shell(path_env, cwd).ok_or(crate::Error::MissingShell)?
    } else {
        bun::self_exe_path().map_err(|_| crate::Error::MissingShell)?
    };

    // Build ScriptConfigs and ProcessHandles
    // Each script name can produce up to 3 handles (pre, main, post)
    let mut configs: Vec<ScriptConfig> = Vec::new();
    let mut group_infos: Vec<GroupInfo> = Vec::new();

    if !ctx.filters.is_empty() || ctx.workspaces {
        // Workspace-aware mode: iterate over matching workspace packages
        let selected = FilterArg::select_packages(ctx, &mut this_transpiler.resolver, cwd)?;
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
            let pkg_path_env = RunCommand::configure_path_for_run_with_package_json_dir(
                ctx,
                &package.dir,
                this_transpiler,
                None,
                &package.dir,
                run_in_bun,
            )?;
            let pkg_name: Box<[u8]> = if !package.json.name.is_empty() {
                Box::<[u8]>::from(&package.json.name[..])
            } else {
                // Fallback: use relative path from workspace root
                Box::from(bun_paths::resolve_path::relative_platform::<
                    bun_paths::resolve_path::platform::Posix,
                    false,
                >(resolve_root, &package.dir))
            };

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
            if ctx.workspaces {
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: No workspace packages have matching scripts"
                );
            } else {
                let patterns: Vec<&[u8]> = ctx.filters.iter().map(|f| &**f).collect();
                Output::err_generic(
                    "{}",
                    (bstr::BStr::new(&workspace_selection::unmatched_message(
                        &patterns,
                    )),),
                );
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
                            &mut group_infos,
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

    let use_colors = Output::enable_ansi_colors_stderr();

    // Dependencies, as indices into `configs` (== `state.handles`).
    let mut group_dependents: Vec<Vec<usize>> = configs.iter().map(|_| Vec::new()).collect();
    let mut next_dependents: Vec<Vec<usize>> = configs.iter().map(|_| Vec::new()).collect();
    let mut remaining_dependencies: Vec<usize> = vec![0; configs.len()];
    let mut color_idxs: Vec<usize> = vec![0; configs.len()];

    for (gi, group) in group_infos.iter().enumerate() {
        for i in group.start..group.start + group.count {
            color_idxs[i] = gi;
        }
        // Set up pre->main->post chaining within each group
        if group.count > 1 {
            let mut j = group.start;
            while j < group.start + group.count - 1 {
                group_dependents[j].push(j + 1);
                remaining_dependencies[j + 1] += 1;
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
            next_dependents[last_in_current].push(first_in_next);
            remaining_dependencies[first_in_next] += 1;
            gi += 1;
        }
    }

    let state = State {
        handles: OnceCell::new(),
        event_loop,
        remaining_scripts: Cell::new(0),
        max_label_len,
        shell_bin,
        aborted: Cell::new(false),
        no_exit_on_error: ctx.no_exit_on_error,
        use_colors,
    };

    // Initialize handles; each points back at `state`, which stays on this
    // (never-returning) frame.
    let mut handles: Vec<OwnedThis<ProcessHandle>> = Vec::with_capacity(configs.len());
    for (index, config) in configs.into_iter().enumerate() {
        // The child's environment: the shared one with this script's $PATH.
        let envp = {
            let env = this_transpiler.env_mut();
            let original_path: Box<[u8]> = env.map.get(b"PATH").map(Box::from).unwrap_or_default();
            let _ = env.map.put(b"PATH", &config.path);
            let envp = env.map.create_null_delimited_env_map();
            let _ = env.map.put(b"PATH", &original_path);
            envp?
        };
        let cwd = config.cwd.clone();
        handles.push(OwnedThis::new(ProcessHandle {
            index,
            config,
            envp,
            state: BackRef::new(&state),
            color_idx: color_idxs[index],
            stdout_reader: PipeReader::new(BackRef::new(&state), index, false),
            stderr_reader: PipeReader::new(BackRef::new(&state), index, true),
            process: OnceCell::new(),
            finished: Cell::new(false),
            remaining_dependencies: Cell::new(remaining_dependencies[index]),
            group_dependents: core::mem::take(&mut group_dependents[index]),
            next_dependents: core::mem::take(&mut next_dependents[index]),
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
                cwd,
                #[cfg(windows)]
                windows: spawn::WindowsOptions {
                    loop_: event_loop.handle(),
                    ..Default::default()
                },
                stream: true,
                ..Default::default()
            },
        }));
    }
    if state.handles.set(handles.into_boxed_slice()).is_err() {
        unreachable!();
    }

    // Collect the roots before starting any: a script that has already exited
    // when `start()` watches it can finish (and cascade) inside `start()`, which
    // zeroes `remaining_dependencies` of later handles it started or skipped.
    let roots: Vec<usize> = state
        .handles()
        .iter()
        .filter(|handle| handle.remaining_dependencies.get() == 0)
        .map(|handle| handle.index)
        .collect();
    for index in roots {
        if ProcessHandle::start(state.handles()[index].this_ptr()).is_err() {
            bun_core::pretty_errorln!("<r><red>error<r>: Failed to start process");
            Global::exit(1);
        }
    }

    if !bun_sys::ctrl_c::set_flag_once(&SHOULD_ABORT) && bun_core::env::IS_DEBUG {
        bun_core::warn!("Failed to set abort handler\n");
    }

    while !state.is_done() {
        if SHOULD_ABORT.load(Ordering::SeqCst) && !state.aborted.get() {
            bun_sys::ctrl_c::restore_default();
            state.abort();
            // The abort sweep may have finished the last script; re-check
            // before blocking in a tick no event may ever wake.
            continue;
        }
        event_loop.tick_once(core::ptr::from_ref(&state).cast_mut().cast::<c_void>());
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
