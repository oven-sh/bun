use core::cell::Cell;
#[cfg(unix)]
use core::ffi::c_void;
use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
use crate::api::bun::process::{self as spawn, Rusage, SpawnOptions, Status};
use crate::cli::Command;
use crate::cli::filter_arg as FilterArg;
use crate::cli::run_command::{ConfigureEnvOptions, RunCommand};
use bun_collections::StringHashMap;
use bun_core::{Global, Output};
use bun_core::{ZStr, strings};
use bun_event_loop::EventLoopHandle;
use bun_event_loop::MiniEventLoop::{self as MiniEventLoopMod, MiniEventLoop};
use bun_install::lifecycle_script_runner::ScriptArgv;
use bun_io::max_buf::Kind;
use bun_io::{BufferedReader, IoEvent, Owner, PollTag};

// The string fields below are owned boxes, except `combined` which is interned
// in the process-lifetime CLI arena.
struct ScriptConfig {
    package_json_path: Box<[u8]>,
    package_name: Box<[u8]>,
    script_name: Box<[u8]>,
    script_content: Box<[u8]>,
    combined: &'static ZStr, // interned via `cli_dupe` into the process-lifetime CLI arena
    // Owned dep names; `DependencyMap.source_buf` would dangle once the
    // parsed `PackageJSON` (which owns the file bytes) drops.
    deps: Vec<Box<[u8]>>,

    // $PATH must be set per script because it contains
    // node_modules/.bin
    // ../node_modules/.bin
    // ../../node_modules/.bin
    // and so forth, in addition to the user's $PATH.
    #[allow(non_snake_case)]
    PATH: Box<[u8]>,
    elide_count: Option<usize>,
}

struct ProcessInfo {
    process: spawn::ProcessHandle,
    status: Status,
    start_time: Instant,
    /// Set together with `status` when the exit arrives.
    end_time: Option<Instant>,
}

/// What the callbacks of every script need.
struct Shared {
    event_loop: &'static MiniEventLoop,
    pretty_output: bool,
    /// Buffer for batched output, unless `pretty_output`.
    print_buf: Cell<Vec<u8>>,
    /// There is output that `State::redraw` has not drawn.
    needs_redraw: Cell<bool>,
    /// A process has exited since `State::finish_exited` last looked.
    has_exits: Cell<bool>,
}

impl Shared {
    /// `buf` was taken out of `print_buf`.
    fn print(&self, mut buf: Vec<u8>) {
        write_to_stdout(&buf);
        buf.clear();
        self.print_buf.set(buf);
    }
}

fn write_to_stdout(bytes: &[u8]) {
    let _ = bun_sys::File::borrow(&bun_sys::Fd::stdout()).write_all(bytes);
}

/// Where both readers of a script deliver.
struct ScriptOutput<'a> {
    shared: &'a Shared,
    config: &'a ScriptConfig,
    buffer: Vec<u8>,
}

impl ScriptOutput<'_> {
    fn read_chunk(&mut self, chunk: &[u8]) -> crate::Result<()> {
        if self.shared.pretty_output {
            self.buffer.extend_from_slice(chunk);
            self.shared.needs_redraw.set(true);
            return Ok(());
        }
        let mut buf = self.shared.print_buf.take();
        let mut content = chunk;
        while let Some(i) = strings::index_of_char_usize(content, b'\n') {
            let mut line;
            (line, content) = content.split_at(i + 1);
            if !self.buffer.is_empty() {
                self.buffer.extend_from_slice(line);
                line = &self.buffer;
            }
            write!(
                buf,
                "{} {}: {}",
                bun_core::fmt::escape_control_chars(&self.config.package_name),
                bun_core::fmt::escape_control_chars(&self.config.script_name),
                bstr::BStr::new(line),
            )?;
            self.buffer.clear();
        }
        self.buffer.extend_from_slice(content);
        self.shared.print(buf);
        Ok(())
    }
}

pub(crate) struct ProcessHandle<'a> {
    stdout: BufferedReader,
    stderr: BufferedReader,
    output: ScriptOutput<'a>,
    /// Counted out of `remaining_scripts`, or skipped.
    finished: bool,

    process: Option<ProcessInfo>,
    options: SpawnOptions<'static>,

    remaining_dependencies: usize,
    /// Indices into `State::handles`.
    dependents: Vec<usize>,
    visit_state: Cell<VisitState>,
    /// True if the previous handle is the script that runs right before this one in the same
    /// package's `pre`/main/`post` chain.
    follows_previous: bool,
    /// True if the previous script in the chain failed or was skipped, so this one never runs.
    skipped: bool,
}

#[derive(Clone, Copy)]
enum VisitState {
    Unvisited,
    Visiting,
    Visited,
}

impl<'a> ProcessHandle<'a> {
    fn start(
        &mut self,
        shell_bin: Option<&'static ZStr>,
        env: &mut bun_dotenv::Loader,
    ) -> crate::Result<()> {
        let handle = self;

        let argv = ScriptArgv::new(shell_bin, handle.output.config.combined)?;
        let start_time = Instant::now();
        let mut spawned: spawn::SpawnProcessResult = 'brk: {
            // Get the envp with the PATH configured
            // There's probably a more optimal way to do this where you have a Vec shared
            // instead of creating a new one for each process
            // Copy to owned — `original_path` borrows env.map which is
            // mutated by put() below.
            let original_path: Box<[u8]> = env.map.get(b"PATH").unwrap_or(b"").into();
            let _ = env.map.put(b"PATH", &handle.output.config.PATH);
            // Restores PATH unconditionally at block exit (success OR error).
            // Keep the guard armed for the whole block so `?` early-returns also
            // restore.
            let mut env = scopeguard::guard(env, |env| {
                let _ = env.map.put(b"PATH", &original_path);
            });
            let envp = crate::cli::script_or_command::with_package_script(
                &mut env,
                &handle.output.config.script_name,
                bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                    &handle.output.config.package_json_path,
                ),
                |env| env.map.to_envp(),
            );
            break 'brk spawn::spawn_process(
                &handle.options,
                argv.as_list(),
                Some(envp.as_list()),
            )??;
            // `env` drops here (or on `?` above), restoring PATH.
        };
        let (stdout_pipe, stderr_pipe) = (spawned.stdout.take(), spawned.stderr.take());
        let process =
            spawned.to_process_handle(EventLoopHandle::init_mini(handle.output.shared.event_loop));

        let ptr = std::ptr::from_mut(handle).cast();
        for kind in [Kind::Stdout, Kind::Stderr] {
            let owner = Owner::with_kind(PollTag::FilterRunHandle, kind, ptr);
            // SAFETY: `owner` points to the slot in `State.handles` that holds this reader, which does not move.
            unsafe { handle.reader(kind).set_owner(owner) };
        }

        #[cfg(windows)]
        {
            if let spawn::WindowsStdioResult::Buffer(pipe) = stdout_pipe {
                handle.stdout.set_source(bun_io::Source::Pipe(pipe));
            }
            if let spawn::WindowsStdioResult::Buffer(pipe) = stderr_pipe {
                handle.stderr.set_source(bun_io::Source::Pipe(pipe));
            }
        }

        #[cfg(unix)]
        for (reader, pipe) in [(&handle.stdout, stdout_pipe), (&handle.stderr, stderr_pipe)] {
            if let Some(pipe) = pipe {
                let _ = bun_sys::set_nonblocking(pipe.fd());
                let event_loop = handle.output.shared.event_loop.as_event_loop_ctx();
                let _ = reader.start(event_loop, pipe.into(), true)?;
            }
        }
        #[cfg(not(unix))]
        {
            handle.stdout.start_with_current_pipe()?;
            handle.stderr.start_with_current_pipe()?;
        }

        handle.process = Some(ProcessInfo {
            process,
            status: Status::Running,
            start_time,
            end_time: None,
        });
        let handle_ptr = std::ptr::from_mut::<ProcessHandle<'a>>(handle);
        // Not a borrow of the slot, which the exit handler borrows again.
        let process = handle.process.as_ref().unwrap().process.this_ptr();
        // SAFETY: `handle` is the live `ProcessHandle` slot in `State.handles`;
        // it owns `process` and outlives it.
        process.set_exit_handler(unsafe {
            bun_spawn::ProcessExit::new(bun_spawn::ProcessExitKind::FilterRunHandle, handle_ptr)
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

    fn reader(&self, kind: Kind) -> &BufferedReader {
        match kind {
            Kind::Stdout => &self.stdout,
            Kind::Stderr => &self.stderr,
        }
    }

    pub(crate) fn read(&mut self, kind: Kind, event: Option<IoEvent>) {
        let reader = match kind {
            Kind::Stdout => &self.stdout,
            Kind::Stderr => &self.stderr,
        };
        let event_loop = self.output.shared.event_loop.as_event_loop_ctx();
        // Ignored: `on_process_exit` ends the script.
        let _ = reader.read_chunks(event_loop, event, |chunk, _| {
            let _ = self.output.read_chunk(&chunk);
            true
        });
    }

    /// After the exit: a leftover child may hold the pipes open, so their EOF may never come.
    fn drain_and_close_pipes(&mut self) {
        for kind in [Kind::Stdout, Kind::Stderr] {
            // Windows has no synchronous drain.
            #[cfg(unix)]
            if !self.reader(kind).is_done() && self.reader(kind).get_fd() != bun_sys::Fd::INVALID {
                self.read(kind, None);
            }
            if !self.reader(kind).is_done() {
                self.reader(kind).deinit();
            }
        }
    }
}

bun_spawn::link_impl_ProcessExit! {
    FilterRunHandle for ProcessHandle<'static> => |this| {
        // The Process is never freed; the program exits when all scripts finish.
        on_process_exit(status, _rusage) => {
            let info = (*this).process.as_mut().unwrap();
            info.status = status;
            info.end_time = Some(Instant::now());
            (*this).output.shared.has_exits.set(true);
        },
    }
}

/// Compile-time ANSI-tag expansion.
macro_rules! fmt {
    ($s:literal) => {
        bun_core::Output::pretty_fmt!($s, true)
    };
}

struct State<'a> {
    handles: Box<[ProcessHandle<'a>]>,
    shared: &'a Shared,
    remaining_scripts: usize,
    // buffer for the frame that `redraw` draws
    draw_buf: Vec<u8>,
    last_lines_written: usize,
    /// The POSIX shell that the scripts run under. `None` on Windows (see `ScriptArgv`).
    shell_bin: Option<&'static ZStr>,
    aborted: bool,
    // Raw `*mut` — process-lifetime singleton owned
    // by Transpiler; ProcessHandle::start mutates `env.map` (PATH swap) so a
    // shared borrow won't do, and `&'a mut` would conflict with the Transpiler's
    // own raw-ptr field. Reborrow `&mut *env` at use sites.
    env: *mut bun_dotenv::Loader,
}

struct ElideResult<'b> {
    content: &'b [u8],
    elided_count: usize,
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
            if self.shared.needs_redraw.get() {
                let _ = self.redraw(false);
            }
            bun_core::pretty_errorln!("<r><red>error<r>: Failed to start process");
            Global::exit(1);
        }
    }

    /// Marks a script as finished and starts the scripts that were waiting only on it. If it failed
    /// or was skipped, the next script in its `pre`/main/`post` chain is skipped too, like
    /// `bun run` without `--filter`. Scripts in other packages that were waiting on it still run.
    fn finish(&mut self, index: usize) {
        let handle = &mut self.handles[index];
        handle.finished = true;
        if self.aborted {
            return;
        }
        let succeeded = matches!(
            &handle.process,
            Some(ProcessInfo { status: Status::Exited(exited), .. }) if exited.code == 0
        );
        for dependent_index in core::mem::take(&mut handle.dependents) {
            let is_next = dependent_index == index + 1;
            let dependent = &mut self.handles[dependent_index];
            dependent.remaining_dependencies -= 1;
            dependent.skipped |= !succeeded && is_next && dependent.follows_previous;
            if dependent.remaining_dependencies != 0 {
                continue;
            }
            if dependent.skipped {
                if !self.shared.pretty_output {
                    let mut buf = self.shared.print_buf.take();
                    let _ = writeln!(
                        buf,
                        "{} {}: Skipped",
                        bun_core::fmt::escape_control_chars(&dependent.output.config.package_name),
                        bun_core::fmt::escape_control_chars(&dependent.output.config.script_name),
                    );
                    self.shared.print(buf);
                }
                self.finish(dependent_index);
            } else {
                self.start(dependent_index);
            }
        }
    }

    fn finish_exited(&mut self) {
        // A script that is started here can have exited by the time it is watched.
        while self.shared.has_exits.take() {
            for index in 0..self.handles.len() {
                let _ = self.maybe_finish(index);
            }
        }
    }

    fn maybe_finish(&mut self, index: usize) -> crate::Result<()> {
        let handle = &mut self.handles[index];
        let exited = matches!(&handle.process, Some(p) if !matches!(p.status, Status::Running));
        if handle.finished || !exited {
            return Ok(());
        }
        // Aborted runs finish on exit alone; their pending output is dropped.
        if !self.aborted {
            handle.drain_and_close_pipes();
        }
        if !self.shared.pretty_output {
            let mut buf = self.shared.print_buf.take();
            // flush any remaining buffer
            if !handle.output.buffer.is_empty() {
                writeln!(
                    buf,
                    "{}: {}",
                    bun_core::fmt::escape_control_chars(&handle.output.config.package_name),
                    bstr::BStr::new(&handle.output.buffer),
                )?;
                handle.output.buffer.clear();
            }
            // print exit status
            match &handle.process.as_ref().unwrap().status {
                Status::Exited(exited) => {
                    writeln!(
                        buf,
                        "{} {}: Exited with code {}",
                        bun_core::fmt::escape_control_chars(&handle.output.config.package_name),
                        bun_core::fmt::escape_control_chars(&handle.output.config.script_name),
                        exited.code,
                    )?;
                }
                Status::Signaled(signal) => {
                    writeln!(
                        buf,
                        "{} {}: Signaled with code {}",
                        bun_core::fmt::escape_control_chars(&handle.output.config.package_name),
                        bun_core::fmt::escape_control_chars(&handle.output.config.script_name),
                        bun_sys::SignalCode(*signal).name().unwrap_or("UNKNOWN"),
                    )?;
                }
                _ => {}
            }
            self.shared.print(buf);
        }
        // `start` incremented this. Skipped scripts never start, so `finish` doesn't decrement it.
        self.remaining_scripts -= 1;
        self.finish(index);
        // On abort, `finalize` draws the last frame. Drawing it here too would print everything
        // twice once it no longer fits on the screen.
        if self.shared.pretty_output && !self.aborted {
            let _ = self.redraw(false);
        }
        Ok(())
    }

    fn elide(data_: &[u8], max_lines: Option<usize>) -> ElideResult<'_> {
        let mut data = data_;
        if data.is_empty() {
            return ElideResult {
                content: &[],
                elided_count: 0,
            };
        }
        if data[data.len() - 1] == b'\n' {
            data = &data[0..data.len() - 1];
        }
        let Some(max_lines_val) = max_lines else {
            return ElideResult {
                content: data,
                elided_count: 0,
            };
        };
        if max_lines_val == 0 {
            return ElideResult {
                content: data,
                elided_count: 0,
            };
        }
        let mut i: usize = data.len();
        let mut lines: usize = 0;
        while i > 0 {
            if data[i - 1] == b'\n' {
                lines += 1;
                if lines >= max_lines_val {
                    break;
                }
            }
            i -= 1;
        }
        let content: &[u8] = if i >= data.len() { &[] } else { &data[i..] };
        let mut elided: usize = 0;
        while i > 0 {
            if data[i - 1] == b'\n' {
                elided += 1;
            }
            i -= 1;
        }
        ElideResult {
            content,
            elided_count: elided,
        }
    }

    fn redraw(&mut self, is_abort: bool) -> crate::Result<()> {
        if !self.shared.pretty_output {
            return Ok(());
        }
        self.shared.needs_redraw.set(false);
        self.draw_buf.clear();
        self.draw_buf
            .extend_from_slice(Output::SYNCHRONIZED_START.as_bytes());
        if self.last_lines_written > 0 {
            // move cursor to the beginning of the line and clear it
            self.draw_buf.extend_from_slice(b"\x1b[0G\x1b[K");
            for _ in 0..self.last_lines_written {
                // move cursor up and clear the line
                self.draw_buf.extend_from_slice(b"\x1b[1A\x1b[K");
            }
        }
        // While scripts are running new output redraws the whole frame, so cap
        // it to the terminal: each script shows the tail of its output. The
        // final frame (and abort, to aid debugging) prints everything unless
        // --elide-lines says otherwise.
        let final_frame = is_abort || self.is_done();
        let rows = bun_core::output::File::from(bun_core::Fd::stdout())
            .winsize()
            .filter(|w| w.row > 0)
            .map_or(24, |w| w.row as usize);
        let per_script_cap = (rows.saturating_sub(1) / self.handles.len().max(1))
            .saturating_sub(3)
            .max(1);
        // Reshaped for borrowck — iterating handles by index since draw_buf is also &mut self.
        for idx in 0..self.handles.len() {
            let handle = &self.handles[idx];
            let user_cap = handle.output.config.elide_count.filter(|&n| n > 0);
            let elide_lines = if is_abort {
                None
            } else if final_frame {
                user_cap
            } else {
                Some(user_cap.map_or(per_script_cap, |n| n.min(per_script_cap)))
            };
            let e = Self::elide(&handle.output.buffer, elide_lines);

            write!(
                &mut self.draw_buf,
                fmt!("<b>{s}<r> {s} $ <d>{s}<r>\n"),
                bun_core::fmt::escape_control_chars(&handle.output.config.package_name),
                bun_core::fmt::escape_control_chars(&handle.output.config.script_name),
                bun_core::fmt::escape_control_chars(&handle.output.config.script_content),
            )?;
            if e.elided_count > 0 {
                write!(
                    &mut self.draw_buf,
                    fmt!("<cyan>│<r> <d>[{d} lines elided]<r>\n"),
                    e.elided_count,
                )?;
            }
            let mut content = e.content;
            while let Some(i) = strings::index_of_char(content, b'\n') {
                let i = i as usize;
                let line = &content[0..i + 1];
                self.draw_buf
                    .extend_from_slice(fmt!("<cyan>│<r> ").as_bytes());
                self.draw_buf.extend_from_slice(line);
                content = &content[i + 1..];
            }
            if !content.is_empty() {
                self.draw_buf
                    .extend_from_slice(fmt!("<cyan>│<r> ").as_bytes());
                self.draw_buf.extend_from_slice(content);
                self.draw_buf.push(b'\n');
            }
            self.draw_buf
                .extend_from_slice(fmt!("<cyan>└─<r> ").as_bytes());
            if let Some(proc) = &handle.process {
                match &proc.status {
                    Status::Running => {
                        self.draw_buf
                            .extend_from_slice(fmt!("<cyan>Running...<r>\n").as_bytes());
                    }
                    Status::Exited(exited) => {
                        if exited.code == 0 {
                            if let Some(end) = proc.end_time {
                                let duration = end.duration_since(proc.start_time);
                                let ms = duration.as_nanos() as f64 / 1_000_000.0;
                                if ms > 1000.0 {
                                    write!(
                                        &mut self.draw_buf,
                                        fmt!("<cyan>Done in {:.2} s<r>\n"),
                                        ms / 1_000.0,
                                    )?;
                                } else {
                                    write!(
                                        &mut self.draw_buf,
                                        fmt!("<cyan>Done in {:.0} ms<r>\n"),
                                        ms,
                                    )?;
                                }
                            } else {
                                self.draw_buf
                                    .extend_from_slice(fmt!("<cyan>Done<r>\n").as_bytes());
                            }
                        } else {
                            write!(
                                &mut self.draw_buf,
                                fmt!("<red>Exited with code {d}<r>\n"),
                                exited.code,
                            )?;
                        }
                    }
                    Status::Signaled(code) => {
                        if *code == bun_sys::SignalCode::SIGINT.0 {
                            write!(&mut self.draw_buf, fmt!("<red>Interrupted<r>\n"))?;
                        } else {
                            write!(
                                &mut self.draw_buf,
                                fmt!("<red>Signaled with code {s}<r>\n"),
                                bun_sys::SignalCode(*code).name().unwrap_or("UNKNOWN"),
                            )?;
                        }
                    }
                    Status::Err(_) => {
                        self.draw_buf
                            .extend_from_slice(fmt!("<red>Error<r>\n").as_bytes());
                    }
                }
            } else if handle.skipped {
                self.draw_buf
                    .extend_from_slice(fmt!("<d>Skipped<r>\n").as_bytes());
            } else {
                write!(
                    &mut self.draw_buf,
                    fmt!("<cyan><d>Waiting for {d} other script(s)<r>\n"),
                    handle.remaining_dependencies,
                )?;
            }
        }
        self.draw_buf
            .extend_from_slice(Output::SYNCHRONIZED_END.as_bytes());
        self.last_lines_written = 0;
        for &c in &self.draw_buf {
            if c == b'\n' {
                self.last_lines_written += 1;
            }
        }
        write_to_stdout(&self.draw_buf);
        Ok(())
    }

    fn abort(&mut self) {
        if self.aborted {
            return;
        }
        // we perform an abort by sending SIGINT to all processes
        self.aborted = true;
        for proc in self.handles.iter().filter_map(|h| h.process.as_ref()) {
            // if we get an error here we simply ignore it
            let _ = proc.process.kill(bun_sys::SignalCode::SIGINT.0);
        }
    }

    fn finalize(&mut self) -> u8 {
        if self.aborted {
            let _ = self.redraw(true);
        }
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
// Atomic because it is set from a signal handler.

impl AbortHandler {
    #[cfg(unix)]
    extern "C" fn posix_signal_handler(
        sig: i32,
        info: *const bun_sys::posix::siginfo_t,
        _: *const c_void,
    ) {
        let _ = sig;
        let _ = info;
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
            // SAFETY: libc::sigaction is #[repr(C)] POD; all-zero is a valid value (fields overwritten below).
            let mut act: libc::sigaction = bun_core::ffi::zeroed();
            act.sa_sigaction = Self::posix_signal_handler as *const () as usize;
            act.sa_flags = libc::SA_SIGINFO | libc::SA_RESTART | libc::SA_RESETHAND;
            // SAFETY: sa_mask is a valid out-pointer; act is on the stack.
            unsafe {
                libc::sigemptyset(&raw mut act.sa_mask);
                libc::sigaction(libc::SIGINT, &raw const act, core::ptr::null_mut());
            }
        }
        #[cfg(not(unix))]
        {
            let res = bun_sys::c::SetConsoleCtrlHandler(
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
        // only necessary on Windows, as on posix we pass the SA_RESETHAND flag
        #[cfg(windows)]
        {
            // (None, FALSE) clears the ignore attribute; it does NOT unregister
            // a handler routine — pass the address.
            let _ = bun_sys::c::SetConsoleCtrlHandler(
                Some(Self::windows_ctrl_handler),
                bun_sys::windows::FALSE,
            );
        }
    }
}

#[cfg(windows)]
fn windows_is_terminal() -> bool {
    let res = bun_sys::windows::GetFileType(bun_sys::Fd::stdout().native());
    res == bun_sys::windows::FILE_TYPE_CHAR
}

pub(crate) fn run_scripts_with_filter(
    ctx: Command::Context,
) -> crate::Result<core::convert::Infallible> {
    // Never returns normally; Result<Infallible, _> keeps `?` support.
    // Own the slice — `ctx` is reborrowed `&mut` for
    // `configure_env_for_run` below while `script_name` is still live.
    let script_name_owned: Box<[u8]> = if ctx.positionals.len() > 1 {
        ctx.positionals[1].clone()
    } else if ctx.positionals.len() > 0 {
        ctx.positionals[0].clone()
    } else {
        bun_core::pretty_errorln!("<r><red>error<r>: No script name provided");
        Global::exit(1);
    };
    let script_name: &[u8] = &script_name_owned;
    let mut pre_script_name = vec![0u8; script_name.len() + 3].into_boxed_slice();
    pre_script_name[0..3].copy_from_slice(b"pre");
    pre_script_name[3..].copy_from_slice(script_name);

    let mut post_script_name = vec![0u8; script_name.len() + 4].into_boxed_slice();
    post_script_name[0..4].copy_from_slice(b"post");
    post_script_name[4..].copy_from_slice(script_name);

    let _ = bun_resolver::fs::FileSystem::init(None)?;
    let fsinstance = bun_resolver::fs::FileSystem::get();

    let mut transpiler_slot = None;
    let (this_transpiler, _) = RunCommand::configure_env_for_run(
        &mut *ctx,
        &mut transpiler_slot,
        None,
        ConfigureEnvOptions {
            log_errors: true,
            store_root_fd: false,
        },
    )?;

    let selected = FilterArg::select_packages(
        &*ctx,
        &mut this_transpiler.resolver,
        fsinstance.top_level_dir(),
    )?;

    let mut scripts: Vec<ScriptConfig> = Vec::new();
    for package in &selected.packages {
        let path: &[u8] = &package.dir;
        let Some(pkgscripts) = &package.json.scripts else {
            continue;
        };

        let run_in_bun = ctx.debug.run_in_bun;
        let path_var: Vec<u8> =
            RunCommand::path_for_run(this_transpiler.env_mut(), path, None, path, run_in_bun)?;

        for (i, name) in [&pre_script_name[..], script_name, &post_script_name[..]]
            .iter()
            .enumerate()
        {
            let Some(original_content) = pkgscripts.get(*name) else {
                if i == 1 && ctx.workspaces && !ctx.if_present {
                    Output::err_generic(
                        "Missing '{s}' script at '{s}'",
                        (bstr::BStr::new(script_name), bstr::BStr::new(path)),
                    );
                    Global::exit(1);
                }
                continue;
            };

            let mut copy_script_capacity: usize = original_content.len();
            for part in &ctx.passthrough {
                copy_script_capacity += 1 + part.len();
            }
            // we leak this
            let mut copy_script: Vec<u8> = Vec::with_capacity(copy_script_capacity);

            RunCommand::replace_package_manager_run(&mut copy_script, original_content)?;
            let len_command_only = copy_script.len();

            for part in &ctx.passthrough {
                copy_script.push(b' ');
                if crate::shell::needs_escape_utf8_ascii_latin1(part) {
                    crate::shell::escape_8bit::<true, false>(part, &mut copy_script)?;
                } else {
                    copy_script.extend_from_slice(part);
                }
            }
            copy_script.push(0);

            // Route through the process-lifetime CLI arena
            // and derive the `ZStr` from the arena slice.
            let interned: &'static [u8] = crate::cli::cli_dupe(&copy_script);
            let combined = ZStr::from_slice_with_nul(interned);

            let dep_source_buf: &[u8] = &package.json.dependencies.source_buf;
            let deps: Vec<Box<[u8]>> = package
                .json
                .dependencies
                .map
                .keys()
                .iter()
                .map(|k| Box::<[u8]>::from(k.slice(dep_source_buf)))
                .collect();

            scripts.push(ScriptConfig {
                package_json_path: package.package_json_path.clone(),
                package_name: Box::<[u8]>::from(&package.json.name[..]),
                script_name: Box::<[u8]>::from(*name),
                script_content: Box::<[u8]>::from(&interned[0..len_command_only]),
                combined,
                deps,
                PATH: Box::<[u8]>::from(&path_var[..]),
                elide_count: ctx.bundler_options.elide_lines,
            });
        }
    }

    if scripts.is_empty() {
        if ctx.if_present {
            // Exit silently with success when --if-present is set
            Global::exit(0);
        }
        let quoted =
            bun_install::package_manager::workspace_selection::quote_patterns(&[script_name]);
        selected.error_script_not_found(&*ctx, &quoted);
    }

    // SAFETY: Transpiler::init always sets `env` to the process-lifetime singleton.
    let env_ptr: *mut bun_dotenv::Loader = this_transpiler.env;
    let event_loop = MiniEventLoopMod::init_global(
        // SAFETY: see above; `&'static mut` reborrow of the singleton for first-init only.
        Some(unsafe { &mut *env_ptr }),
    );
    // Windows: recursive kill-on-close Job so cmd.exe/.cmd-shim grandchildren
    // (which escape libuv's SILENT_BREAKAWAY job) die with us. POSIX: no-op.
    bun_io::ParentDeathWatchdog::ensure_kill_on_close_job();
    // --no-orphans: register the macOS kqueue parent watch on this MiniEventLoop
    // (the VirtualMachine.init path is never reached for --filter). Linux is
    // already covered by prctl in enable() + linux_pdeathsig on each spawn.
    bun_io::ParentDeathWatchdog::install_on_event_loop(event_loop.as_event_loop_ctx());
    let shell_bin: Option<&'static ZStr> = if cfg!(unix) {
        // SAFETY: env_ptr is the live process-lifetime DotEnv loader.
        let path = unsafe { (*env_ptr).get(b"PATH") }.unwrap_or(b"");
        let top_level_dir = fsinstance.top_level_dir();
        Some(RunCommand::find_shell(path, top_level_dir).ok_or(crate::Error::MissingShell)?)
    } else {
        None
    };

    let shared = Shared {
        event_loop,
        pretty_output: {
            #[cfg(windows)]
            {
                windows_is_terminal() && Output::enable_ansi_colors_stdout()
            }
            #[cfg(not(windows))]
            {
                Output::enable_ansi_colors_stdout()
            }
        },
        print_buf: Cell::default(),
        needs_redraw: Cell::new(false),
        has_exits: Cell::new(false),
    };

    // initialize the handles
    let mut handles: Vec<ProcessHandle> = Vec::with_capacity(scripts.len());
    let mut map: StringHashMap<Vec<usize>> = StringHashMap::default();
    for script in scripts.iter() {
        handles.push(ProcessHandle {
            stdout: BufferedReader::init(),
            stderr: BufferedReader::init(),
            output: ScriptOutput {
                shared: &shared,
                config: script,
                buffer: Vec::new(),
            },
            finished: false,
            process: None,
            options: SpawnOptions {
                stdin: spawn::Stdio::Ignore,
                stdout: spawn::Stdio::Buffer,
                stderr: spawn::Stdio::Buffer,
                cwd: bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                    &script.package_json_path,
                )
                .into(),
                #[cfg(windows)]
                windows: spawn::WindowsOptions {
                    loop_: EventLoopHandle::init_mini(event_loop),
                    ..Default::default()
                },
                stream: true,
                ..Default::default()
            },
            remaining_dependencies: 0,
            dependents: Vec::new(),
            visit_state: Cell::new(VisitState::Unvisited),
            follows_previous: false,
            skipped: false,
        });
    }
    let mut state = State {
        handles: handles.into_boxed_slice(),
        shared: &shared,
        remaining_scripts: 0,
        draw_buf: Vec::new(),
        last_lines_written: 0,
        shell_bin,
        aborted: false,
        env: env_ptr,
    };
    for (i, script) in scripts.iter().enumerate() {
        map.get_or_put(&script.package_name)?.value_ptr.push(i);
    }
    // compute dependencies (TODO: maybe we should do this only in a workspace?)
    for (i, script) in scripts.iter().enumerate() {
        for name in &script.deps {
            // is it a workspace dependency?
            if let Some(pkgs) = map.get(&**name) {
                for &dep in pkgs {
                    state.handles[dep].dependents.push(i);
                }
                state.handles[i].remaining_dependencies += pkgs.len();
            }
        }
    }

    // check if there is a dependency cycle
    let has_cycle_flag = (state.handles.iter()).any(|handle| has_cycle(&state.handles, handle));
    // if there is, we ignore dependency order completely
    if has_cycle_flag {
        for handle in state.handles.iter_mut() {
            handle.dependents.clear();
            handle.remaining_dependencies = 0;
        }
    }

    // set up dependencies between pre/post scripts
    // this is done after the cycle check because we don't want these to be removed if there is a cycle
    for (i, [script, next]) in scripts.array_windows().enumerate() {
        if script.package_name == next.package_name {
            state.handles[i].dependents.push(i + 1);
            state.handles[i + 1].remaining_dependencies += 1;
            // Compare paths, because package names can be missing or duplicated.
            state.handles[i + 1].follows_previous =
                script.package_json_path == next.package_json_path;
        }
    }

    for i in 0..state.handles.len() {
        if state.handles[i].remaining_dependencies == 0 {
            state.start(i);
        }
    }

    AbortHandler::install();

    loop {
        if shared.needs_redraw.get() {
            let _ = state.redraw(false);
        }
        state.finish_exited();
        if state.is_done() {
            break;
        }
        if SHOULD_ABORT.load(Ordering::SeqCst) && !state.aborted {
            // We uninstall the custom abort handler so that if the user presses Ctrl+C again,
            // the process is aborted immediately and doesn't wait for the event loop to tick.
            // This can be useful if one of the processes is stuck and doesn't react to SIGINT.
            AbortHandler::uninstall();
            state.abort();
        }
        event_loop.tick_once(core::ptr::null_mut());
    }

    let status = state.finalize();

    Global::exit(status as u32);
}

fn has_cycle(handles: &[ProcessHandle], current: &ProcessHandle) -> bool {
    current.visit_state.set(VisitState::Visiting);
    for &dep in &current.dependents {
        let dep = &handles[dep];
        match dep.visit_state.get() {
            VisitState::Visiting => return true,
            VisitState::Unvisited => {
                if has_cycle(handles, dep) {
                    return true;
                }
            }
            VisitState::Visited => {}
        }
    }
    current.visit_state.set(VisitState::Visited);
    false
}
