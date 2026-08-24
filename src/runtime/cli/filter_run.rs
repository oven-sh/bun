use core::cell::{Cell, OnceCell, RefCell};
use core::ffi::{CStr, c_void};
use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
use crate::api::bun::process::{self as spawn, Rusage, SpawnEnv, SpawnOptions, Status};
use crate::cli::Command;
use crate::cli::filter_arg as FilterArg;
use crate::cli::run_command::{ConfigureEnvOptions, RunCommand};
use bun_collections::StringHashMap;
use bun_core::{Global, Output};
use bun_core::{ZStr, strings};
use bun_event_loop::MiniEventLoop::GlobalMiniEventLoop;
use bun_io::{BufferedReader, ReadState};
use bun_ptr::{BackRef, JsCell, OwnedThis, ThisPtr};
use bun_sys as sys;

// The string fields below are owned boxes, except `combined` which is interned
// in the process-lifetime CLI arena.
struct ScriptConfig {
    package_name: Box<[u8]>,
    script_name: Box<[u8]>,
    script_content: Box<[u8]>,
    combined: &'static ZStr, // interned via `cli_dupe` into the process-lifetime CLI arena

    // The environment block is per script because $PATH must contain
    // node_modules/.bin
    // ../node_modules/.bin
    // ../../node_modules/.bin
    // and so forth, in addition to the user's $PATH.
    envp: bun_dotenv::NullDelimitedEnvMap,
    elide_count: Option<usize>,
}

struct ProcessInfo {
    process: spawn::ProcessHandle,
    status: RefCell<Status>,
    start_time: Instant,
    /// Set together with `status` when the exit arrives.
    end_time: Cell<Option<Instant>>,
}

/// One script run. Lives in `State::handles` for the whole run loop (heap
/// allocated, never moved or freed), and is re-entered through `ThisPtr` from
/// the pipe-reader and process-exit callbacks, so all state is `Cell`-based.
pub(crate) struct ProcessHandle {
    /// Position in `State::handles`.
    index: usize,
    config: ScriptConfig,
    /// The `State` on `run_scripts_with_filter`'s stack, which owns every
    /// handle and outlives the run loop.
    state: BackRef<State>,

    stdout: JsCell<BufferedReader>,
    stderr: JsCell<BufferedReader>,
    /// Pipes started and not yet at EOF/error; a script is finished only when
    /// its process has exited and this is 0 (see `State::maybe_finish`).
    remaining_fds: Cell<i8>,
    /// Set by the `maybe_finish` that counts this script out of
    /// `remaining_scripts`, so a later pipe/exit event or the abort sweep
    /// cannot finish it twice.
    finished: Cell<bool>,
    buffer: RefCell<Vec<u8>>,

    /// Set once by `start`.
    process: OnceCell<ProcessInfo>,
    options: SpawnOptions,

    remaining_dependencies: Cell<usize>,
    /// Indices into `State::handles`.
    dependents: Vec<usize>,
}

#[derive(Clone, Copy)]
enum VisitState {
    Unvisited,
    Visiting,
    Visited,
}

impl ProcessHandle {
    fn start(this: ThisPtr<Self>) -> crate::Result<()> {
        let handle = this.get();
        let state = handle.state.get();
        state
            .remaining_scripts
            .set(state.remaining_scripts.get() + 1);

        let argv: [&CStr; 3] = [
            state.shell_bin.as_cstr(),
            if cfg!(unix) { c"-c" } else { c"exec" },
            CStr::from_bytes_until_nul(handle.config.combined.as_bytes_with_nul())
                .expect("built NUL-terminated"),
        ];
        let start_time = Instant::now();
        let spawned: spawn::SpawnProcessResult = {
            let envp: Vec<&CStr> = handle.config.envp.iter().collect();
            spawn::spawn_process_cstr(&handle.options, &argv, SpawnEnv::Strings(&envp))??
        };
        #[cfg(unix)]
        let (stdout_fd, stderr_fd) = (spawned.stdout, spawned.stderr);
        // Windows: `spawn_process_windows` has already moved the heap pipe out of
        // `options.stdout/stderr` (via `heap::take`) into `spawned.stdout/stderr`
        // as `WindowsStdioResult::Buffer(Box<Pipe>)`. The raw `*mut Pipe` left in
        // `options` is dangling-by-design — re-`heap::take`ing it here would be a
        // double `Box::from_raw` (UAF + double-free). Take the Box from the
        // *result* instead, before `to_process` consumes `spawned`.
        #[cfg(windows)]
        let mut spawned = spawned;
        #[cfg(windows)]
        let (stdout_pipe, stderr_pipe) = (spawned.stdout.take(), spawned.stderr.take());
        let process = spawned.to_process_handle(state.event_loop.handle());

        let parent: *mut c_void = this.as_ptr().cast();
        handle.stdout.with_mut(|r| r.set_parent(parent));
        handle.stderr.with_mut(|r| r.set_parent(parent));

        #[cfg(windows)]
        {
            if let spawn::WindowsStdioResult::Buffer(pipe) = stdout_pipe {
                handle
                    .stdout
                    .with_mut(|r| r.set_source(bun_io::Source::Pipe(pipe)));
            }
            if let spawn::WindowsStdioResult::Buffer(pipe) = stderr_pipe {
                handle
                    .stderr
                    .with_mut(|r| r.set_source(bun_io::Source::Pipe(pipe)));
            }
        }

        #[cfg(unix)]
        {
            if let Some(stdout) = stdout_fd {
                let _ = sys::set_nonblocking(stdout);
                handle.remaining_fds.set(handle.remaining_fds.get() + 1);
                handle.stdout.with_mut(|r| r.start(stdout, true))?;
            }
            if let Some(stderr) = stderr_fd {
                let _ = sys::set_nonblocking(stderr);
                handle.remaining_fds.set(handle.remaining_fds.get() + 1);
                handle.stderr.with_mut(|r| r.start(stderr, true))?;
            }
        }
        #[cfg(not(unix))]
        {
            handle.remaining_fds.set(handle.remaining_fds.get() + 1);
            handle.stdout.with_mut(|r| r.start_with_current_pipe())?;
            handle.remaining_fds.set(handle.remaining_fds.get() + 1);
            handle.stderr.with_mut(|r| r.start_with_current_pipe())?;
        }

        let info = ProcessInfo {
            process,
            status: RefCell::new(Status::Running),
            start_time,
            end_time: Cell::new(None),
        };
        if handle.process.set(info).is_err() {
            unreachable!("each script is started once");
        }
        let info = handle.process.get().expect("set above");
        info.process.set_exit_handler(this);

        match info.process.watch_or_reap() {
            Ok(_) => {}
            Err(err) => {
                if !info.process.has_exited() {
                    // SAFETY: all-zero is a valid Rusage (POD C struct)
                    let rusage = bun_core::ffi::zeroed::<Rusage>();
                    info.process.on_exit(Status::Err(err), &rusage);
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
        for reader in [&self.stdout, &self.stderr] {
            // `is_done()` = EOF already counted out of `remaining_fds`.
            #[cfg(unix)]
            if !reader.get().is_done() && reader.get().get_fd() != sys::Fd::INVALID {
                BufferedReader::read_cell(reader);
            }
            if !reader.get().is_done() {
                reader.with_mut(|r| r.deinit());
            }
        }
        // `deinit` fires no callback; all pipes are over, record it here.
        self.remaining_fds.set(0);
    }

    fn on_process_exit(this: ThisPtr<Self>, status: Status) {
        // The Process is never freed; the program exits when all scripts finish.
        let info = this.process.get().expect("exit of a started process");
        *info.status.borrow_mut() = status;
        info.end_time.set(Some(Instant::now()));
        let state = this.state.get();
        // Aborted runs finish on exit alone; their pending output is dropped.
        if !state.aborted.get() {
            this.drain_and_close_pipes();
        }
        let _ = state.maybe_finish(this.get());
    }

    fn on_read_chunk(&self, chunk: &[u8], has_more: ReadState) -> bool {
        let _ = has_more;
        let _ = self.state.get().read_chunk(self, chunk);
        true
    }

    fn on_reader_done(&self) {
        debug_assert!(self.remaining_fds.get() > 0);
        self.remaining_fds.set(self.remaining_fds.get() - 1);
        let _ = self.state.get().maybe_finish(self);
    }

    fn on_reader_error(&self, err: &sys::Error) {
        let _ = err;
        debug_assert!(self.remaining_fds.get() > 0);
        self.remaining_fds.set(self.remaining_fds.get() - 1);
        let _ = self.state.get().maybe_finish(self);
    }

    fn loop_(&self) -> *mut bun_io::Loop {
        bun_io::uws_to_native(self.state.event_loop.loop_ptr())
    }
}

bun_spawn::link_impl_ProcessExit! {
    FilterRunHandle for ProcessHandle => |this| {
        on_process_exit(_process, status, _rusage) =>
            ProcessHandle::on_process_exit(ThisPtr::new(this), status),
    }
}

// The reader only holds a `&mut` to its own `JsCell`'s contents across the
// callback; the handle is otherwise `Cell`-based.
bun_io::impl_buffered_reader_parent! {
    FilterRunHandle for ProcessHandle;
    borrow = this;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| this.on_read_chunk(&chunk, has_more);
    on_reader_done  = |this| this.on_reader_done();
    on_reader_error = |this, err| this.on_reader_error(&err);
    loop_           = |this| this.loop_();
    event_loop      = |this| this.state.event_loop.event_loop_ctx();
}

/// Compile-time ANSI-tag expansion.
macro_rules! fmt {
    ($s:literal) => {
        bun_core::Output::pretty_fmt!($s, true)
    };
}

struct State {
    /// Set once every handle has been constructed (each holds a `BackRef` to
    /// this `State`).
    handles: OnceCell<Box<[OwnedThis<ProcessHandle>]>>,
    event_loop: GlobalMiniEventLoop,
    remaining_scripts: Cell<usize>,
    // buffer for batched output
    draw_buf: RefCell<Vec<u8>>,
    last_lines_written: Cell<usize>,
    pretty_output: bool,
    shell_bin: &'static ZStr, // intentionally leaked (process exits)
    aborted: Cell<bool>,
}

struct ElideResult<'b> {
    content: &'b [u8],
    elided_count: usize,
}

impl State {
    fn handles(&self) -> &[OwnedThis<ProcessHandle>] {
        self.handles.get().map(|h| &h[..]).unwrap_or(&[])
    }

    fn is_done(&self) -> bool {
        self.remaining_scripts.get() == 0
    }

    fn read_chunk(&self, handle: &ProcessHandle, chunk: &[u8]) -> crate::Result<()> {
        if self.pretty_output {
            handle.buffer.borrow_mut().extend_from_slice(chunk);
            let _ = self.redraw(false);
        } else {
            let mut content = chunk;
            let mut draw_buf = self.draw_buf.borrow_mut();
            let mut buffer = handle.buffer.borrow_mut();
            draw_buf.clear();
            if !buffer.is_empty() {
                if let Some(i) = strings::index_of_char(content, b'\n') {
                    let i = i as usize;
                    buffer.extend_from_slice(&content[0..i + 1]);
                    content = &content[i + 1..];
                    write!(
                        draw_buf,
                        "{} {}: {}",
                        bstr::BStr::new(&handle.config.package_name),
                        bstr::BStr::new(&handle.config.script_name),
                        bstr::BStr::new(&*buffer),
                    )?;
                    buffer.clear();
                } else {
                    buffer.extend_from_slice(content);
                    return Ok(());
                }
            }
            while let Some(i) = strings::index_of_char(content, b'\n') {
                let i = i as usize;
                let line = &content[0..i + 1];
                write!(
                    draw_buf,
                    "{} {}: {}",
                    bstr::BStr::new(&handle.config.package_name),
                    bstr::BStr::new(&handle.config.script_name),
                    bstr::BStr::new(line),
                )?;
                content = &content[i + 1..];
            }
            if !content.is_empty() {
                buffer.extend_from_slice(content);
            }
            drop(draw_buf);
            self.flush_draw_buf();
        }
        Ok(())
    }

    /// A script is finished once its process has exited *and* both pipes have
    /// ended; finishing on exit alone can drop output the exit notification
    /// beat. The exit path force-ends pipes a leftover child holds open
    /// (`drain_and_close_pipes`); on abort, exit alone suffices.
    fn maybe_finish(&self, handle: &ProcessHandle) -> crate::Result<()> {
        let exited = matches!(handle.process.get(), Some(p) if !matches!(*p.status.borrow(), Status::Running));
        if handle.finished.get()
            || !exited
            || (handle.remaining_fds.get() != 0 && !self.aborted.get())
        {
            return Ok(());
        }
        handle.finished.set(true);
        self.remaining_scripts.set(self.remaining_scripts.get() - 1);
        if !self.aborted.get() {
            for &dependent in &handle.dependents {
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
        if self.pretty_output {
            let _ = self.redraw(false);
        } else {
            let mut draw_buf = self.draw_buf.borrow_mut();
            draw_buf.clear();
            // flush any remaining buffer
            {
                let mut buffer = handle.buffer.borrow_mut();
                if !buffer.is_empty() {
                    writeln!(
                        draw_buf,
                        "{}: {}",
                        bstr::BStr::new(&handle.config.package_name),
                        bstr::BStr::new(&*buffer),
                    )?;
                    buffer.clear();
                }
            }
            // print exit status
            let info = handle.process.get().expect("exited");
            match &*info.status.borrow() {
                Status::Exited(exited) => {
                    writeln!(
                        draw_buf,
                        "{} {}: Exited with code {}",
                        bstr::BStr::new(&handle.config.package_name),
                        bstr::BStr::new(&handle.config.script_name),
                        exited.code,
                    )?;
                }
                Status::Signaled(signal) => {
                    writeln!(
                        draw_buf,
                        "{} {}: Signaled with code {}",
                        bstr::BStr::new(&handle.config.package_name),
                        bstr::BStr::new(&handle.config.script_name),
                        bun_sys::SignalCode(*signal).name().unwrap_or("UNKNOWN"),
                    )?;
                }
                _ => {}
            }
            drop(draw_buf);
            self.flush_draw_buf();
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

    fn redraw(&self, is_abort: bool) -> crate::Result<()> {
        if !self.pretty_output {
            return Ok(());
        }
        let mut draw_buf = self.draw_buf.borrow_mut();
        draw_buf.clear();
        draw_buf.extend_from_slice(Output::SYNCHRONIZED_START.as_bytes());
        if self.last_lines_written.get() > 0 {
            // move cursor to the beginning of the line and clear it
            draw_buf.extend_from_slice(b"\x1b[0G\x1b[K");
            for _ in 0..self.last_lines_written.get() {
                // move cursor up and clear the line
                draw_buf.extend_from_slice(b"\x1b[1A\x1b[K");
            }
        }
        for handle in self.handles() {
            let handle: &ProcessHandle = handle;
            // normally we truncate the output to 10 lines, but on abort we print everything to aid debugging
            let elide_lines = if is_abort {
                None
            } else {
                Some(handle.config.elide_count.unwrap_or(10))
            };
            let buffer = handle.buffer.borrow();
            let e = Self::elide(&buffer, elide_lines);

            write!(
                draw_buf,
                fmt!("<b>{s}<r> {s} $ <d>{s}<r>\n"),
                bstr::BStr::new(&handle.config.package_name),
                bstr::BStr::new(&handle.config.script_name),
                bstr::BStr::new(&handle.config.script_content),
            )?;
            if e.elided_count > 0 {
                write!(
                    draw_buf,
                    fmt!("<cyan>│<r> <d>[{d} lines elided]<r>\n"),
                    e.elided_count,
                )?;
            }
            let mut content = e.content;
            while let Some(i) = strings::index_of_char(content, b'\n') {
                let i = i as usize;
                let line = &content[0..i + 1];
                draw_buf.extend_from_slice(fmt!("<cyan>│<r> ").as_bytes());
                draw_buf.extend_from_slice(line);
                content = &content[i + 1..];
            }
            if !content.is_empty() {
                draw_buf.extend_from_slice(fmt!("<cyan>│<r> ").as_bytes());
                draw_buf.extend_from_slice(content);
                draw_buf.push(b'\n');
            }
            draw_buf.extend_from_slice(fmt!("<cyan>└─<r> ").as_bytes());
            if let Some(proc) = handle.process.get() {
                match &*proc.status.borrow() {
                    Status::Running => {
                        draw_buf.extend_from_slice(fmt!("<cyan>Running...<r>\n").as_bytes());
                    }
                    Status::Exited(exited) => {
                        if exited.code == 0 {
                            if let Some(end) = proc.end_time.get() {
                                let duration = end.duration_since(proc.start_time);
                                let ms = duration.as_nanos() as f64 / 1_000_000.0;
                                if ms > 1000.0 {
                                    write!(
                                        draw_buf,
                                        fmt!("<cyan>Done in {:.2} s<r>\n"),
                                        ms / 1_000.0,
                                    )?;
                                } else {
                                    write!(draw_buf, fmt!("<cyan>Done in {:.0} ms<r>\n"), ms,)?;
                                }
                            } else {
                                draw_buf.extend_from_slice(fmt!("<cyan>Done<r>\n").as_bytes());
                            }
                        } else {
                            write!(
                                draw_buf,
                                fmt!("<red>Exited with code {d}<r>\n"),
                                exited.code,
                            )?;
                        }
                    }
                    Status::Signaled(code) => {
                        if *code == bun_sys::SignalCode::SIGINT.0 {
                            write!(draw_buf, fmt!("<red>Interrupted<r>\n"))?;
                        } else {
                            write!(
                                draw_buf,
                                fmt!("<red>Signaled with code {s}<r>\n"),
                                bun_sys::SignalCode(*code).name().unwrap_or("UNKNOWN"),
                            )?;
                        }
                    }
                    Status::Err(_) => {
                        draw_buf.extend_from_slice(fmt!("<red>Error<r>\n").as_bytes());
                    }
                }
            } else {
                write!(
                    draw_buf,
                    fmt!("<cyan><d>Waiting for {d} other script(s)<r>\n"),
                    handle.remaining_dependencies.get(),
                )?;
            }
        }
        draw_buf.extend_from_slice(Output::SYNCHRONIZED_END.as_bytes());
        let mut last_lines_written = 0;
        for &c in draw_buf.iter() {
            if c == b'\n' {
                last_lines_written += 1;
            }
        }
        self.last_lines_written.set(last_lines_written);
        drop(draw_buf);
        self.flush_draw_buf();
        Ok(())
    }

    fn flush_draw_buf(&self) {
        let _ = bun_sys::File::stdout().write_all(&self.draw_buf.borrow());
    }

    fn abort(&self) {
        if self.aborted.get() {
            return;
        }
        // we perform an abort by sending SIGINT to all processes
        self.aborted.set(true);
        for handle in self.handles() {
            if let Some(proc) = handle.process.get() {
                // if we get an error here we simply ignore it
                let _ = proc.process.kill(bun_sys::SignalCode::SIGINT.0);
            }
            // An already-exited handle may be waiting on pipes a grandchild
            // still holds; with `aborted` set this finishes it now. Killed
            // handles finish when their exit arrives.
            let _ = self.maybe_finish(handle);
        }
    }

    fn finalize(&self) -> u8 {
        if self.aborted.get() {
            let _ = self.redraw(true);
        }
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

    let mut transpiler_slot = core::mem::MaybeUninit::<bun_bundler::Transpiler<'static>>::uninit();
    let (this_transpiler, _) = RunCommand::configure_env_for_run(
        &mut *ctx,
        &mut transpiler_slot,
        None,
        ConfigureEnvOptions {
            log_errors: true,
            store_root_fd: false,
        },
    )?;

    let selected =
        FilterArg::select_packages(ctx, &mut this_transpiler.resolver, fsinstance.top_level_dir)?;

    // (config, workspace dependency names, cwd) — the latter two are consumed
    // when the handles are built.
    let mut scripts: Vec<(ScriptConfig, Vec<Box<[u8]>>, Box<[u8]>)> = Vec::new();
    for package in &selected.packages {
        let path: &[u8] = &package.dir;
        let Some(pkgscripts) = &package.json.scripts else {
            continue;
        };

        let run_in_bun = ctx.debug.run_in_bun;
        let path_var: Vec<u8> = RunCommand::configure_path_for_run_with_package_json_dir(
            &mut *ctx,
            path,
            this_transpiler,
            None,
            path,
            run_in_bun,
        )?;

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
            let combined_len = interned.len() - 1;
            // interned[combined_len] == 0 (copied from `copy_script`).
            let combined = ZStr::from_buf(interned, combined_len);

            let dep_source_buf = package.json.dependencies.source_buf;
            let deps: Vec<Box<[u8]>> = package
                .json
                .dependencies
                .map
                .keys()
                .iter()
                .map(|k| Box::<[u8]>::from(k.slice(dep_source_buf)))
                .collect();

            // The child's environment: the shared one with this script's $PATH.
            let envp = {
                let env = this_transpiler.env_mut();
                let original_path: Box<[u8]> = env.map.get(b"PATH").unwrap_or(b"").into();
                let _ = env.map.put(b"PATH", &path_var);
                let envp = env.map.create_null_delimited_env_map();
                let _ = env.map.put(b"PATH", &original_path);
                envp?
            };

            let cwd: Box<[u8]> = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                &package.package_json_path,
            )
            .into();
            scripts.push((
                ScriptConfig {
                    package_name: Box::<[u8]>::from(&package.json.name[..]),
                    script_name: Box::<[u8]>::from(*name),
                    script_content: Box::<[u8]>::from(&interned[0..len_command_only]),
                    combined,
                    envp,
                    elide_count: ctx.bundler_options.elide_lines,
                },
                deps,
                cwd,
            ));
        }
    }

    if scripts.is_empty() {
        if ctx.if_present {
            // Exit silently with success when --if-present is set
            Global::exit(0);
        }
        if ctx.workspaces {
            Output::err_generic(
                "No workspace packages have script \"{s}\"",
                (bstr::BStr::new(script_name),),
            );
        } else {
            let patterns: Vec<&[u8]> = ctx.filters.iter().map(|f| &**f).collect();
            Output::err_generic(
                "{}",
                (bstr::BStr::new(
                    &bun_install::package_manager::workspace_selection::unmatched_message(
                        &patterns,
                    ),
                ),),
            );
        }
        Global::exit(1);
    }

    // `Transpiler::init` set `env` to the process-lifetime loader singleton.
    let event_loop =
        GlobalMiniEventLoop::init(Some(BackRef::new_mut(this_transpiler.env_mut())), None);
    // Windows: recursive kill-on-close Job so cmd.exe/.cmd-shim grandchildren
    // (which escape libuv's SILENT_BREAKAWAY job) die with us. POSIX: no-op.
    bun_io::ParentDeathWatchdog::ensure_kill_on_close_job();
    // --no-orphans: register the macOS kqueue parent watch on this MiniEventLoop
    // (the VirtualMachine.init path is never reached for --filter). Linux is
    // already covered by prctl in enable() + linux_pdeathsig on each spawn.
    bun_io::ParentDeathWatchdog::install_on_event_loop(event_loop.event_loop_ctx());
    let shell_bin: &'static ZStr = {
        #[cfg(unix)]
        {
            RunCommand::find_shell(
                this_transpiler.env().get(b"PATH").unwrap_or(b""),
                fsinstance.top_level_dir,
            )
            .ok_or(crate::Error::MissingShell)?
        }
        #[cfg(not(unix))]
        {
            bun_core::self_exe_path().map_err(|_| crate::Error::MissingShell)?
        }
    };

    // compute dependencies (TODO: maybe we should do this only in a workspace?)
    // `dependents[i]` are indices into `scripts` (== `state.handles`).
    let mut dependents: Vec<Vec<usize>> = scripts.iter().map(|_| Vec::new()).collect();
    let mut remaining_dependencies: Vec<usize> = vec![0; scripts.len()];
    {
        let mut map: StringHashMap<Vec<usize>> = StringHashMap::default();
        for (i, (script, ..)) in scripts.iter().enumerate() {
            let res = map.get_or_put(&script.package_name)?;
            if res.found_existing {
                res.value_ptr.push(i);
                // Output.prettyErrorln("<r><red>error<r>: Duplicate package name: {s}", .{script.package_name});
                // Global.exit(1);
            } else {
                *res.value_ptr = vec![i];
            }
        }
        for (i, (_, deps, _)) in scripts.iter().enumerate() {
            for name in deps {
                // is it a workspace dependency?
                if let Some(pkgs) = map.get(&**name) {
                    for &dep in pkgs {
                        dependents[dep].push(i);
                        remaining_dependencies[i] += 1;
                    }
                }
            }
        }
    }

    // check if there is a dependency cycle
    let mut visit_state = vec![VisitState::Unvisited; scripts.len()];
    let mut has_cycle_flag = false;
    for i in 0..scripts.len() {
        if has_cycle(&dependents, &mut visit_state, i) {
            has_cycle_flag = true;
            break;
        }
    }
    // if there is, we ignore dependency order completely
    if has_cycle_flag {
        for i in 0..scripts.len() {
            dependents[i].clear();
            remaining_dependencies[i] = 0;
        }
    }

    // set up dependencies between pre/post scripts
    // this is done after the cycle check because we don't want these to be removed if there is a cycle
    for i in 0..scripts.len() - 1 {
        if scripts[i].0.package_name == scripts[i + 1].0.package_name {
            dependents[i].push(i + 1);
            remaining_dependencies[i + 1] += 1;
        }
    }

    let state = State {
        handles: OnceCell::new(),
        event_loop,
        remaining_scripts: Cell::new(0),
        draw_buf: RefCell::new(Vec::new()),
        last_lines_written: Cell::new(0),
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
        shell_bin,
        aborted: Cell::new(false),
    };

    // initialize the handles; each points back at `state`, which stays on this
    // (never-returning) frame.
    let handles: Box<[OwnedThis<ProcessHandle>]> = scripts
        .into_iter()
        .zip(dependents)
        .zip(remaining_dependencies)
        .enumerate()
        .map(
            |(index, (((config, _, cwd), dependents), remaining_dependencies))| {
                OwnedThis::new(ProcessHandle {
                    index,
                    config,
                    state: BackRef::new(&state),
                    stdout: JsCell::new(BufferedReader::init::<ProcessHandle>()),
                    stderr: JsCell::new(BufferedReader::init::<ProcessHandle>()),
                    buffer: RefCell::new(Vec::new()),
                    remaining_fds: Cell::new(0),
                    finished: Cell::new(false),
                    process: OnceCell::new(),
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
                    remaining_dependencies: Cell::new(remaining_dependencies),
                    dependents,
                })
            },
        )
        .collect();
    if state.handles.set(handles).is_err() {
        unreachable!();
    }

    // Collect the roots before starting any: a script that has already exited
    // when `start()` watches it can finish (and cascade) inside `start()`,
    // which zeroes `remaining_dependencies` of later handles it started.
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
            // We uninstall the custom abort handler so that if the user presses Ctrl+C again,
            // the process is aborted immediately and doesn't wait for the event loop to tick.
            // This can be useful if one of the processes is stuck and doesn't react to SIGINT.
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

fn has_cycle(dependents: &[Vec<usize>], visit_state: &mut [VisitState], current: usize) -> bool {
    visit_state[current] = VisitState::Visiting;
    for &dep in &dependents[current] {
        match visit_state[dep] {
            VisitState::Visiting => return true,
            VisitState::Unvisited => {
                if has_cycle(dependents, visit_state, dep) {
                    return true;
                }
            }
            VisitState::Visited => {}
        }
    }
    visit_state[current] = VisitState::Visited;
    false
}
