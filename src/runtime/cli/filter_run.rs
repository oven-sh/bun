use core::ffi::{c_char, c_void};
use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
use crate::api::bun::process::{self as spawn, Rusage, SpawnOptions, Status};
use crate::cli::Command;
use crate::cli::filter_arg as FilterArg;
use crate::cli::label_color::LabelColor;
use crate::cli::run_command::{ConfigureEnvOptions, RunCommand};
use bun_collections::StringHashMap;
use bun_core::{Global, Output};
use bun_core::{ZStr, strings};
use bun_event_loop::EventLoopHandle;
use bun_event_loop::MiniEventLoop::{self as MiniEventLoopMod, MiniEventLoop};
use bun_io::{BufferedReader, ReadState};
use bun_sys as sys;

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
    color: LabelColor,
}

struct ProcessInfo {
    process: spawn::ProcessHandle,
    status: Status,
    start_time: Instant,
    /// Set together with `status` when the exit arrives.
    end_time: Option<Instant>,
}

// `state` is a backref into the owning `State` (which holds `handles: []ProcessHandle`),
// and `dependents` holds raw pointers into that same `handles` slice. This is
// self-referential; kept as raw pointers per LIFETIMES.tsv (BACKREF).
pub(crate) struct ProcessHandle<'a> {
    config: &'a ScriptConfig,
    state: bun_ptr::BackRef<State<'a>, bun_ptr::Mut>,

    stdout: BufferedReader,
    stderr: BufferedReader,
    /// Pipes started and not yet at EOF/error; a script is finished only when
    /// its process has exited and this is 0 (see `State::maybe_finish`).
    remaining_fds: i8,
    /// Set by the `maybe_finish` that counts this script out of
    /// `remaining_scripts`, so a later pipe/exit event or the abort sweep
    /// cannot finish it twice.
    finished: bool,
    /// Pretty mode: the final block has been written above the live region.
    flushed: bool,
    buffer: Vec<u8>,

    process: Option<ProcessInfo>,
    options: SpawnOptions,

    remaining_dependencies: usize,
    dependents: Vec<*mut ProcessHandle<'a>>,
    visit_state: VisitState,
}

#[derive(Clone, Copy)]
enum VisitState {
    Unvisited,
    Visiting,
    Visited,
}

impl<'a> ProcessHandle<'a> {
    fn start(&mut self) -> crate::Result<()> {
        // Copy the BackRef out so the `&mut State` borrow is detached from `self`.
        let mut state_ref = self.state;
        // SAFETY: state backref is valid for the lifetime of the run loop (State outlives all handles).
        let state = unsafe { state_ref.get_mut() };
        state.remaining_scripts += 1;
        let handle = self;

        let argv: [*const c_char; 4] = [
            state.shell_bin.as_ptr().cast(),
            if cfg!(unix) {
                c"-c".as_ptr()
            } else {
                c"exec".as_ptr()
            },
            handle.config.combined.as_ptr().cast(),
            core::ptr::null(),
        ];
        let start_time = Instant::now();
        let spawned: spawn::SpawnProcessResult = 'brk: {
            // Get the envp with the PATH configured
            // There's probably a more optimal way to do this where you have a Vec shared
            // instead of creating a new one for each process
            let env_ptr = state.env;
            // SAFETY: state.env is the process-lifetime DotEnv loader (Transpiler::env).
            let env = unsafe { &mut *env_ptr };
            // Copy to owned — `original_path` borrows env.map which is
            // mutated by put() below.
            let original_path: Box<[u8]> = env.map.get(b"PATH").unwrap_or(b"").into();
            let _ = env.map.put(b"PATH", &handle.config.PATH);
            // Restores PATH unconditionally at block exit (success OR error).
            // Keep the guard armed for the whole block so `?` early-returns also
            // restore.
            scopeguard::defer! {
                // SAFETY: env_ptr valid for the run loop lifetime (see above).
                let _ = unsafe { (*env_ptr).map.put(b"PATH", &original_path) };
            }
            // SAFETY: see above; reborrow through raw ptr to avoid overlapping &mut with guard.
            let envp = unsafe { (*env_ptr).map.create_null_delimited_env_map()? };
            // SAFETY: `argv`/`envp` are local null-terminated C-string arrays
            // with argv[0] non-null; valid for this call.
            break 'brk unsafe {
                spawn::spawn_process(
                    &handle.options,
                    argv.as_ptr(),
                    envp.as_ptr().cast::<*const c_char>(),
                )
            }??;
            // `_guard` drops here (or on `?` above), restoring PATH.
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
        let process = spawned.to_process_handle(EventLoopHandle::init_mini(state.event_loop));

        let handle_ptr = std::ptr::from_mut::<ProcessHandle<'a>>(handle).cast::<c_void>();
        handle.stdout.set_parent(handle_ptr);
        handle.stderr.set_parent(handle_ptr);

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
        {
            if let Some(stdout) = stdout_fd {
                let _ = sys::set_nonblocking(stdout);
                handle.remaining_fds += 1;
                handle.stdout.start(stdout, true)?;
            }
            if let Some(stderr) = stderr_fd {
                let _ = sys::set_nonblocking(stderr);
                handle.remaining_fds += 1;
                handle.stderr.start(stderr, true)?;
            }
        }
        #[cfg(not(unix))]
        {
            handle.remaining_fds += 1;
            handle.stdout.start_with_current_pipe()?;
            handle.remaining_fds += 1;
            handle.stderr.start_with_current_pipe()?;
        }

        handle.process = Some(ProcessInfo {
            process,
            status: Status::Running,
            start_time,
            end_time: None,
        });
        let handle_ptr = std::ptr::from_mut::<ProcessHandle<'a>>(handle);
        // The exit handler re-borrows `handle.process`, so go through the
        // `Process` allocation itself rather than a borrow of the slot.
        // SAFETY: just spawned; the slot's handle keeps it live.
        let process = unsafe { &mut *handle.process.as_ref().unwrap().process.as_ptr() };
        // SAFETY: `handle` is the live `ProcessHandle` slot in `State.handles`;
        // it owns `process` and outlives it.
        process.set_exit_handler(unsafe {
            bun_spawn::ProcessExit::new(bun_spawn::ProcessExitKind::FilterRunHandle, handle_ptr)
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

    /// On process exit, read what the pipes already hold, then force-end any
    /// pipe a leftover child still keeps open: its EOF may never come and
    /// must not stall the finish. Windows has no synchronous drain, so only
    /// the force-end applies there.
    ///
    /// # Safety
    /// `this` is the live handle; the reader callbacks re-enter
    /// `State::maybe_finish` with their own exclusive reborrow of it, so no
    /// receiver borrow may be live across these calls.
    unsafe fn drain_and_close_pipes(this: *mut Self) {
        // SAFETY: caller contract; raw-ptr reborrows end before each dispatch.
        unsafe {
            for reader in [&raw mut (*this).stdout, &raw mut (*this).stderr] {
                // `is_done()` = EOF already counted out of `remaining_fds`.
                #[cfg(unix)]
                if !(*reader).is_done() && (*reader).get_fd() != sys::Fd::INVALID {
                    BufferedReader::read(reader);
                }
                if !(*reader).is_done() {
                    (*reader).deinit();
                }
            }
            // `deinit` fires no callback; all pipes are over, record it here.
            (*this).remaining_fds = 0;
        }
    }

    fn on_read_chunk(&mut self, chunk: &[u8], has_more: ReadState) -> bool {
        let _ = has_more;
        let mut state_ref = self.state;
        // SAFETY: state backref valid (see start()).
        let state = unsafe { state_ref.get_mut() };
        let _ = state.read_chunk(self, chunk);
        true
    }

    fn on_reader_done(&mut self) {
        debug_assert!(self.remaining_fds > 0);
        self.remaining_fds -= 1;
        let mut state_ref = self.state;
        // SAFETY: state backref valid (see start()).
        let state = unsafe { state_ref.get_mut() };
        let _ = state.maybe_finish(self);
    }

    fn on_reader_error(&mut self, err: &sys::Error) {
        let _ = err;
        debug_assert!(self.remaining_fds > 0);
        self.remaining_fds -= 1;
        let mut state_ref = self.state;
        // SAFETY: state backref valid (see start()).
        let state = unsafe { state_ref.get_mut() };
        let _ = state.maybe_finish(self);
    }
}

bun_spawn::link_impl_ProcessExit! {
    FilterRunHandle for ProcessHandle<'static> => |this| {
        // The Process is never freed; the program exits when all scripts finish.
        on_process_exit(_process, status, _rusage) => {
            let info = (*this).process.as_mut().unwrap();
            info.status = status;
            info.end_time = Some(Instant::now());
            // Aborted runs finish on exit alone; their pending output is dropped.
            if !(*(*this).state.as_ptr()).aborted {
                ProcessHandle::drain_and_close_pipes(this);
            }
            let mut state_ref = (*this).state;
            let state = state_ref.get_mut();
            let _ = state.maybe_finish(&mut *this);
        },
    }
}

impl<'a> ProcessHandle<'a> {
    fn loop_(&self) -> *mut bun_io::Loop {
        // SAFETY: state backref valid; event_loop is the live MiniEventLoop singleton.
        bun_io::uws_to_native(unsafe { (*self.state.event_loop).loop_ })
    }
}

// The reader holds no `&mut ProcessHandle` across the callback (it only holds a
// `&mut` to the embedded `BufferedReader` field, which is disjoint from the
// fields touched here). `state` backref valid for the lifetime of the run loop.
bun_io::impl_buffered_reader_parent! {
    FilterRunHandle for ProcessHandle<'a>;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| (*this).on_read_chunk(&chunk, has_more);
    on_reader_done  = |this| (*this).on_reader_done();
    on_reader_error = |this, err| (*this).on_reader_error(&err);
    loop_           = |this| (*this).loop_();
    event_loop      = |this| (*(*this).state.as_ptr()).event_loop_handle.as_event_loop_ctx();
}

/// Compile-time ANSI-tag expansion.
macro_rules! fmt {
    ($s:literal) => {
        bun_core::Output::pretty_fmt!($s, true)
    };
}

struct State<'a> {
    handles: Box<[ProcessHandle<'a>]>,
    // Raw `*mut` — `init_global` returns the
    // thread-local singleton pointer; aliasing &mut would be UB.
    event_loop: *mut MiniEventLoop,
    /// Typed enum mirror of `event_loop` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    event_loop_handle: EventLoopHandle,
    remaining_scripts: usize,
    // buffer for batched output
    draw_buf: Vec<u8>,
    /// Lines currently on screen below the flushed output, erased on each redraw.
    live_lines: usize,
    pretty_output: bool,
    shell_bin: &'static ZStr, // intentionally leaked (process exits)
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

    fn read_chunk(&mut self, handle: &mut ProcessHandle<'a>, chunk: &[u8]) -> crate::Result<()> {
        if self.pretty_output {
            handle.buffer.extend_from_slice(chunk);
            let _ = self.redraw(false);
        } else {
            let mut content = chunk;
            self.draw_buf.clear();
            if !handle.buffer.is_empty() {
                if let Some(i) = strings::index_of_char(content, b'\n') {
                    let i = i as usize;
                    handle.buffer.extend_from_slice(&content[0..i + 1]);
                    content = &content[i + 1..];
                    write!(
                        &mut self.draw_buf,
                        "{} {}: {}",
                        bstr::BStr::new(&handle.config.package_name),
                        bstr::BStr::new(&handle.config.script_name),
                        bstr::BStr::new(&handle.buffer),
                    )?;
                    handle.buffer.clear();
                } else {
                    handle.buffer.extend_from_slice(content);
                    return Ok(());
                }
            }
            while let Some(i) = strings::index_of_char(content, b'\n') {
                let i = i as usize;
                let line = &content[0..i + 1];
                write!(
                    &mut self.draw_buf,
                    "{} {}: {}",
                    bstr::BStr::new(&handle.config.package_name),
                    bstr::BStr::new(&handle.config.script_name),
                    bstr::BStr::new(line),
                )?;
                content = &content[i + 1..];
            }
            if !content.is_empty() {
                handle.buffer.extend_from_slice(content);
            }
            self.flush_draw_buf();
        }
        Ok(())
    }

    /// A script is finished once its process has exited *and* both pipes have
    /// ended; finishing on exit alone can drop output the exit notification
    /// beat. The exit path force-ends pipes a leftover child holds open
    /// (`drain_and_close_pipes`); on abort, exit alone suffices.
    fn maybe_finish(&mut self, handle: &mut ProcessHandle<'a>) -> crate::Result<()> {
        let exited = matches!(&handle.process, Some(p) if !matches!(p.status, Status::Running));
        if handle.finished || !exited || (handle.remaining_fds != 0 && !self.aborted) {
            return Ok(());
        }
        handle.finished = true;
        self.remaining_scripts -= 1;
        if !self.aborted {
            for &dependent in &handle.dependents {
                // SAFETY: dependent points into self.handles, valid for the run loop lifetime.
                let dependent = unsafe { &mut *dependent };
                dependent.remaining_dependencies -= 1;
                if dependent.remaining_dependencies == 0 {
                    if dependent.start().is_err() {
                        bun_core::pretty_errorln!("<r><red>error<r>: Failed to start process");
                        Global::exit(1);
                    }
                }
            }
        }
        if self.pretty_output {
            let _ = self.redraw(false);
        } else {
            self.draw_buf.clear();
            // flush any remaining buffer
            if !handle.buffer.is_empty() {
                writeln!(
                    &mut self.draw_buf,
                    "{}: {}",
                    bstr::BStr::new(&handle.config.package_name),
                    bstr::BStr::new(&handle.buffer),
                )?;
                handle.buffer.clear();
            }
            // print exit status
            match &handle.process.as_ref().unwrap().status {
                Status::Exited(exited) => {
                    writeln!(
                        &mut self.draw_buf,
                        "{} {}: Exited with code {}",
                        bstr::BStr::new(&handle.config.package_name),
                        bstr::BStr::new(&handle.config.script_name),
                        exited.code,
                    )?;
                }
                Status::Signaled(signal) => {
                    writeln!(
                        &mut self.draw_buf,
                        "{} {}: Signaled with code {}",
                        bstr::BStr::new(&handle.config.package_name),
                        bstr::BStr::new(&handle.config.script_name),
                        bun_sys::SignalCode(*signal).name().unwrap_or("UNKNOWN"),
                    )?;
                }
                _ => {}
            }
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

    /// Upper bound on the redrawn region; everything else is append-only.
    const MAX_LIVE_LINES: usize = 50;

    fn write_header(out: &mut Vec<u8>, config: &ScriptConfig) -> crate::Result<()> {
        config.color.label(out, &config.package_name);
        write!(
            out,
            fmt!(" {s} <d>$ {s}<r>  "),
            bstr::BStr::new(&config.script_name),
            bstr::BStr::new(&config.script_content),
        )?;
        Ok(())
    }

    fn line_count(buf: &[u8]) -> usize {
        strings::count_char(buf, b'\n') + (!buf.is_empty() && !buf.ends_with(b"\n")) as usize
    }

    fn write_lines(out: &mut Vec<u8>, color: LabelColor, mut content: &[u8]) {
        while !content.is_empty() {
            let (line, rest) = match strings::index_of_char(content, b'\n') {
                Some(i) => content.split_at(i as usize + 1),
                None => (content, &b""[..]),
            };
            color.gutter(out);
            out.extend_from_slice(fmt!("│<r> ").as_bytes());
            out.extend_from_slice(line);
            if !line.ends_with(b"\n") {
                out.push(b'\n');
            }
            content = rest;
        }
    }

    /// A script's permanent block: header with its final status, then its output.
    fn write_final(
        out: &mut Vec<u8>,
        handle: &ProcessHandle<'a>,
        is_abort: bool,
    ) -> crate::Result<()> {
        Self::write_header(out, handle.config)?;
        match handle.process.as_ref().map(|p| (&p.status, p)) {
            None => out.extend_from_slice(fmt!("<d>[not started]<r>\n").as_bytes()),
            Some((Status::Running, _)) => {
                out.extend_from_slice(fmt!("<red>[interrupted]<r>\n").as_bytes())
            }
            Some((Status::Exited(exited), p)) if exited.code == 0 => match p.end_time {
                Some(end) => {
                    let ms = end.duration_since(p.start_time).as_secs_f64() * 1000.0;
                    if ms > 1000.0 {
                        write!(out, fmt!("<d>[{:.2} s]<r>\n"), ms / 1000.0)?;
                    } else {
                        write!(out, fmt!("<d>[{:.0} ms]<r>\n"), ms)?;
                    }
                }
                None => out.extend_from_slice(fmt!("<d>[done]<r>\n").as_bytes()),
            },
            Some((Status::Exited(exited), _)) => {
                write!(out, fmt!("<red>[exit {d}]<r>\n"), exited.code)?;
            }
            Some((Status::Signaled(code), _)) => {
                if *code == bun_sys::SignalCode::SIGINT.0 {
                    out.extend_from_slice(fmt!("<red>[interrupted]<r>\n").as_bytes());
                } else {
                    write!(
                        out,
                        fmt!("<red>[{s}]<r>\n"),
                        bun_sys::SignalCode(*code).name().unwrap_or("UNKNOWN"),
                    )?;
                }
            }
            Some((Status::Err(_), _)) => {
                out.extend_from_slice(fmt!("<red>[failed to start]<r>\n").as_bytes());
            }
        }
        // on abort we print everything to aid debugging
        let max = if is_abort {
            None
        } else {
            handle.config.elide_count.filter(|&n| n > 0)
        };
        let e = Self::elide(&handle.buffer, max);
        if e.elided_count > 0 {
            handle.config.color.gutter(out);
            write!(out, fmt!("│<r> <d>[{d} lines elided]<r>\n"), e.elided_count)?;
        }
        Self::write_lines(out, handle.config.color, e.content);
        Ok(())
    }

    /// Finished scripts are written once, in completion order, and never
    /// touched again; below them a bounded region (running scripts with the
    /// tail of their output, then what is still waiting) is erased and redrawn.
    fn redraw(&mut self, is_abort: bool) -> crate::Result<()> {
        if !self.pretty_output {
            return Ok(());
        }
        self.draw_buf.clear();
        self.draw_buf
            .extend_from_slice(Output::SYNCHRONIZED_START.as_bytes());
        for _ in 0..self.live_lines {
            // cursor up one line, clear it
            self.draw_buf.extend_from_slice(b"\x1b[1A\x1b[2K");
        }
        self.draw_buf.extend_from_slice(b"\x1b[0G");

        for idx in 0..self.handles.len() {
            let handle = &self.handles[idx];
            if handle.flushed || !(handle.finished || is_abort) {
                continue;
            }
            if is_abort && handle.process.is_none() {
                continue;
            }
            // Reshaped for borrowck: draw_buf and handles are both fields of self.
            let mut out = core::mem::take(&mut self.draw_buf);
            Self::write_final(&mut out, &self.handles[idx], is_abort)?;
            self.draw_buf = out;
            self.handles[idx].flushed = true;
        }

        let winsize = bun_core::output::File::from(bun_core::Fd::stdout()).winsize();
        let rows = winsize.map_or(24, |w| w.row as usize);
        let budget = Self::MAX_LIVE_LINES.min(rows.saturating_sub(1));
        let running = self
            .handles
            .iter()
            .filter(|h| !h.flushed && h.process.is_some())
            .count();
        let waiting = self
            .handles
            .iter()
            .filter(|h| !h.flushed && h.process.is_none())
            .count();
        let waiting_lines = waiting
            .min(budget.saturating_sub(running * 2))
            .max((waiting > 0) as usize);
        let tail_each = if running == 0 {
            0
        } else {
            budget.saturating_sub(running + waiting_lines) / running
        };

        // Lines here are clipped, not wrapped, so `live_lines` is exact.
        self.draw_buf.extend_from_slice(b"\x1b[?7l");
        let mut live_lines = 0usize;
        for handle in self.handles.iter() {
            if handle.flushed || handle.process.is_none() || live_lines >= budget {
                continue;
            }
            Self::write_header(&mut self.draw_buf, handle.config)?;
            handle.config.color.gutter(&mut self.draw_buf);
            self.draw_buf.extend_from_slice("…".as_bytes());
            let max = match handle.config.elide_count {
                Some(n) if n > 0 => n.min(tail_each),
                _ => tail_each,
            };
            let e = if max == 0 {
                ElideResult {
                    content: &[],
                    elided_count: Self::line_count(&handle.buffer),
                }
            } else {
                Self::elide(&handle.buffer, Some(max))
            };
            if e.elided_count > 0 {
                write!(
                    &mut self.draw_buf,
                    fmt!("<r> <d>({d} lines)<r>"),
                    e.elided_count + Self::line_count(e.content),
                )?;
            }
            self.draw_buf.extend_from_slice(fmt!("<r>\n").as_bytes());
            live_lines += 1;
            let before = self.draw_buf.len();
            Self::write_lines(&mut self.draw_buf, handle.config.color, e.content);
            live_lines += strings::count_char(&self.draw_buf[before..], b'\n');
        }
        if waiting > 0 {
            let shown = if waiting_lines < waiting {
                waiting_lines - 1
            } else {
                waiting
            };
            let mut n = 0;
            for handle in self.handles.iter() {
                if handle.flushed || handle.process.is_some() {
                    continue;
                }
                if n == shown {
                    break;
                }
                Self::write_header(&mut self.draw_buf, handle.config)?;
                self.draw_buf
                    .extend_from_slice(fmt!("<d>[waiting]<r>\n").as_bytes());
                n += 1;
            }
            if shown < waiting {
                write!(
                    &mut self.draw_buf,
                    fmt!("<d>[{d} more waiting]<r>\n"),
                    waiting - shown
                )?;
                n += 1;
            }
            live_lines += n;
        }
        self.draw_buf.extend_from_slice(b"\x1b[?7h");
        self.live_lines = live_lines;
        self.draw_buf
            .extend_from_slice(Output::SYNCHRONIZED_END.as_bytes());
        self.flush_draw_buf();
        Ok(())
    }

    fn flush_draw_buf(&self) {
        let _ = bun_sys::File::stdout().write_all(&self.draw_buf);
    }

    fn abort(&mut self) {
        if self.aborted {
            return;
        }
        // we perform an abort by sending SIGINT to all processes
        self.aborted = true;
        // Raw ptrs so `self.maybe_finish` can be called while walking (the
        // file-wide State/handle backref pattern).
        let handles: Vec<*mut ProcessHandle<'a>> =
            self.handles.iter_mut().map(std::ptr::from_mut).collect();
        for handle in handles {
            // SAFETY: points into `self.handles`, live for the whole run loop.
            if let Some(proc) = unsafe { (*handle).process.as_ref() } {
                // if we get an error here we simply ignore it
                let _ = proc.process.kill(bun_sys::SignalCode::SIGINT.0);
            }
            // An already-exited handle may be waiting on pipes a grandchild
            // still holds; with `aborted` set this finishes it now. Killed
            // handles finish when their exit arrives.
            // SAFETY: same `self.handles` element as above; the exclusive
            // reborrow is confined to this call.
            let _ = self.maybe_finish(unsafe { &mut *handle });
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

    // TODO(refactor): out-param init — `configureEnvForRun` writes through the
    // out-param. Per PORTING.md this should be reshaped to
    // `RunCommand::configure_env_for_run(...) -> Result<Transpiler, _>`; until then
    // pass `&mut MaybeUninit<Transpiler>` (zeroed() is invalid: Transpiler is not #[repr(C)] POD).
    let mut this_transpiler = core::mem::MaybeUninit::<bun_bundler::Transpiler<'static>>::uninit();
    let _ = RunCommand::configure_env_for_run(
        &mut *ctx,
        &mut this_transpiler,
        None,
        ConfigureEnvOptions {
            log_errors: true,
            store_root_fd: false,
        },
    )?;
    // SAFETY: configure_env_for_run fully initializes the out-param on Ok.
    let mut this_transpiler = unsafe { this_transpiler.assume_init() };

    let selected = FilterArg::select_packages(
        &*ctx,
        &mut this_transpiler.resolver,
        fsinstance.top_level_dir,
    )?;

    let mut scripts: Vec<ScriptConfig> = Vec::new();
    for (package_idx, package) in selected.packages.iter().enumerate() {
        let path: &[u8] = &package.dir;
        let Some(pkgscripts) = &package.json.scripts else {
            continue;
        };
        let package_name: Box<[u8]> = if package.json.name.is_empty() {
            Box::from(bun_paths::resolve_path::relative_platform::<
                bun_paths::resolve_path::platform::Posix,
                false,
            >(&selected.root_dir, path))
        } else {
            Box::from(&package.json.name[..])
        };

        let run_in_bun = ctx.debug.run_in_bun;
        let path_var: Vec<u8> = RunCommand::configure_path_for_run_with_package_json_dir(
            &mut *ctx,
            path,
            &mut this_transpiler,
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
            // SAFETY: interned[combined_len] == 0 (copied from `copy_script`).
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

            scripts.push(ScriptConfig {
                package_json_path: package.package_json_path.clone(),
                package_name: package_name.clone(),
                script_name: Box::<[u8]>::from(*name),
                script_content: Box::<[u8]>::from(&interned[0..len_command_only]),
                combined,
                deps,
                PATH: Box::<[u8]>::from(&path_var[..]),
                elide_count: ctx.bundler_options.elide_lines,
                color: LabelColor::for_label(&package_name, package_idx),
            });
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
                "No workspace packages matching {} have script \"{}\"",
                (
                    bstr::BStr::new(
                        &bun_install::package_manager::workspace_selection::quote_patterns(
                            &patterns,
                        ),
                    ),
                    bstr::BStr::new(script_name),
                ),
            );
        }
        Global::exit(1);
    }

    // SAFETY: Transpiler::init always sets `env` to the process-lifetime singleton.
    let env_ptr: *mut bun_dotenv::Loader = this_transpiler.env;
    let event_loop = MiniEventLoopMod::init_global(
        // SAFETY: see above; `&'static mut` reborrow of the singleton for first-init only.
        Some(unsafe { &mut *env_ptr }),
        None,
    );
    // Windows: recursive kill-on-close Job so cmd.exe/.cmd-shim grandchildren
    // (which escape libuv's SILENT_BREAKAWAY job) die with us. POSIX: no-op.
    bun_io::ParentDeathWatchdog::ensure_kill_on_close_job();
    // --no-orphans: register the macOS kqueue parent watch on this MiniEventLoop
    // (the VirtualMachine.init path is never reached for --filter). Linux is
    // already covered by prctl in enable() + linux_pdeathsig on each spawn.
    // SAFETY: `event_loop` is the live per-thread `MiniEventLoop` (init'd above);
    // `as_event_loop_ctx` only stores it as a tagged backref.
    bun_io::ParentDeathWatchdog::install_on_event_loop(MiniEventLoop::as_event_loop_ctx(unsafe {
        &mut *event_loop
    }));
    let shell_bin: &'static ZStr = {
        #[cfg(unix)]
        {
            RunCommand::find_shell(
                // SAFETY: env_ptr is the live process-lifetime DotEnv loader.
                unsafe { (*env_ptr).get(b"PATH") }.unwrap_or(b""),
                fsinstance.top_level_dir,
            )
            .ok_or(crate::Error::MissingShell)?
        }
        #[cfg(not(unix))]
        {
            bun_core::self_exe_path().map_err(|_| crate::Error::MissingShell)?
        }
    };

    let handles: Box<[ProcessHandle]> = Vec::with_capacity(scripts.len()).into();
    // We build into a Vec first, but need stable addresses for `&state` backref and `&mut handles[i]`
    // pointers stored in `map`. This is self-referential; raw pointers used below.

    let mut state = State {
        handles, // placeholder; reassigned after init below
        event_loop,
        event_loop_handle: EventLoopHandle::init_mini(event_loop),
        remaining_scripts: 0,
        draw_buf: Vec::new(),
        live_lines: 0,
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
        aborted: false,
        env: env_ptr,
    };

    // initialize the handles
    // Self-referential — each `state.handles[i].state` points back at
    // `state`, and `map` stores `*mut ProcessHandle` into `state.handles`. Derive
    // the backref with mutable provenance (`addr_of_mut!`) so writes through it
    // in `ProcessHandle::start` / `State::process_exit` are sound under Stacked
    // Borrows; `state` is not moved after this point.
    let mut handles_vec: Vec<ProcessHandle> = Vec::with_capacity(scripts.len());
    // SAFETY: `state` is not moved after this point; outlives every `ProcessHandle`.
    let state_ptr: bun_ptr::BackRef<State, bun_ptr::Mut> =
        unsafe { bun_ptr::BackRef::from_raw_mut(core::ptr::addr_of_mut!(state)) };
    let mut map: StringHashMap<Vec<*mut ProcessHandle>> = StringHashMap::default();
    for script in scripts.iter() {
        handles_vec.push(ProcessHandle {
            state: state_ptr,
            config: script,
            stdout: BufferedReader::init::<ProcessHandle>(),
            stderr: BufferedReader::init::<ProcessHandle>(),
            buffer: Vec::new(),
            remaining_fds: 0,
            finished: false,
            flushed: false,
            process: None,
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
            visit_state: VisitState::Unvisited,
        });
    }
    state.handles = handles_vec.into_boxed_slice();
    for (i, script) in scripts.iter().enumerate() {
        let handle_ptr: *mut ProcessHandle = &raw mut state.handles[i];
        let res = map.get_or_put(&script.package_name)?;
        if res.found_existing {
            res.value_ptr.push(handle_ptr);
            // Output.prettyErrorln("<r><red>error<r>: Duplicate package name: {s}", .{script.package_name});
            // Global.exit(1);
        } else {
            *res.value_ptr = Vec::new();
            res.value_ptr.push(handle_ptr);
            // &state.handles[i];
        }
    }
    // compute dependencies (TODO: maybe we should do this only in a workspace?)
    for handle in state.handles.iter_mut() {
        let config = handle.config;
        for name in &config.deps {
            // is it a workspace dependency?
            if let Some(pkgs) = map.get(&**name) {
                for &dep in pkgs {
                    // SAFETY: dep points into state.handles which is stable for the run.
                    unsafe { (*dep).dependents.push(std::ptr::from_mut(handle)) };
                    handle.remaining_dependencies += 1;
                }
            }
        }
    }

    // check if there is a dependency cycle
    let mut has_cycle_flag = false;
    for handle in state.handles.iter_mut() {
        if has_cycle(handle) {
            has_cycle_flag = true;
            break;
        }
    }
    // if there is, we ignore dependency order completely
    if has_cycle_flag {
        for handle in state.handles.iter_mut() {
            handle.dependents.clear();
            handle.remaining_dependencies = 0;
        }
    }

    // set up dependencies between pre/post scripts
    // this is done after the cycle check because we don't want these to be removed if there is a cycle
    for i in 0..state.handles.len() - 1 {
        if state.handles[i].config.package_name == state.handles[i + 1].config.package_name {
            let next_ptr: *mut ProcessHandle = &raw mut state.handles[i + 1];
            state.handles[i].dependents.push(next_ptr);
            state.handles[i + 1].remaining_dependencies += 1;
        }
    }

    // Collect the roots before starting any: a script that has already exited
    // when `start()` watches it can finish (and cascade) inside `start()`,
    // which zeroes `remaining_dependencies` of later handles it started.
    let roots: Vec<*mut ProcessHandle> = state
        .handles
        .iter_mut()
        .filter(|handle| handle.remaining_dependencies == 0)
        .map(std::ptr::from_mut)
        .collect();
    for handle in roots {
        // SAFETY: points into `state.handles`, which lives for the whole loop.
        if unsafe { (*handle).start() }.is_err() {
            bun_core::pretty_errorln!("<r><red>error<r>: Failed to start process");
            Global::exit(1);
        }
    }

    AbortHandler::install();

    while !state.is_done() {
        if SHOULD_ABORT.load(Ordering::SeqCst) && !state.aborted {
            // We uninstall the custom abort handler so that if the user presses Ctrl+C again,
            // the process is aborted immediately and doesn't wait for the event loop to tick.
            // This can be useful if one of the processes is stuck and doesn't react to SIGINT.
            AbortHandler::uninstall();
            state.abort();
            // The abort sweep may have finished the last script; re-check
            // before blocking in a tick no event may ever wake.
            continue;
        }
        // SAFETY: event_loop is the live thread-local MiniEventLoop singleton.
        unsafe { (*event_loop).tick_once(&raw const state as *mut c_void) };
    }

    let status = state.finalize();

    Global::exit(status as u32);
}

fn has_cycle(current: &mut ProcessHandle) -> bool {
    current.visit_state = VisitState::Visiting;
    for &dep in &current.dependents {
        // SAFETY: dep points into state.handles, valid for the run loop lifetime.
        let dep = unsafe { &mut *dep };
        match dep.visit_state {
            VisitState::Visiting => return true,
            VisitState::Unvisited => {
                if has_cycle(dep) {
                    return true;
                }
            }
            VisitState::Visited => {}
        }
    }
    current.visit_state = VisitState::Visited;
    false
}
