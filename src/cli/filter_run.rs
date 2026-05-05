use core::ffi::{c_char, c_void};
use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use bun_cli::filter_arg as FilterArg;
use bun_cli::run_command::RunCommand;
use bun_cli::Command;
use bun_collections::StringHashMap;
use bun_core::{Global, Output};
use bun_io::{BufferedReader, ReadState};
use bun_jsc::{EventLoopHandle};
use bun_resolver::package_json::DependencyMap;
use bun_spawn::{self as spawn, Process, Rusage, SpawnOptions, Status};
use bun_str::{strings, ZStr};
use bun_sys as sys;

// TODO(port): several `[]const u8` fields below are leaked in Zig (program exits). In Zig,
// `script_content` and `combined` alias the same `copy_script` buffer; here they are split
// into separate owned boxes for Phase A. Revisit ownership in Phase B.
struct ScriptConfig {
    package_json_path: Box<[u8]>,
    package_name: Box<[u8]>,
    script_name: Box<[u8]>,
    script_content: Box<[u8]>,
    combined: ZStr<'static>, // TODO(port): lifetime — points into leaked copy_script buffer
    deps: DependencyMap,

    // $PATH must be set per script because it contains
    // node_modules/.bin
    // ../node_modules/.bin
    // ../../node_modules/.bin
    // and so forth, in addition to the user's $PATH.
    #[allow(non_snake_case)]
    PATH: Box<[u8]>,
    elide_count: Option<usize>,
}

impl ScriptConfig {
    fn cmp(_: (), a: &Self, b: &Self) -> bool {
        strings::cmp_strings_asc((), &a.package_name, &b.package_name)
    }
}

// Anonymous struct in Zig: `process: ?struct { ptr, status }`
struct ProcessInfo {
    ptr: std::sync::Arc<Process>,
    status: Status,
}

// PORT NOTE: `state` is a backref into the owning `State` (which holds `handles: []ProcessHandle`),
// and `dependents` holds raw pointers into that same `handles` slice. This is self-referential in
// Zig; kept as raw pointers per LIFETIMES.tsv (BACKREF).
pub struct ProcessHandle<'a> {
    config: &'a ScriptConfig,
    state: *const State<'a>,

    stdout: BufferedReader,
    stderr: BufferedReader,
    buffer: Vec<u8>,

    process: Option<ProcessInfo>,
    options: SpawnOptions,

    start_time: Option<Instant>,
    end_time: Option<Instant>,

    remaining_dependencies: usize,
    dependents: Vec<*mut ProcessHandle<'a>>,
    visited: bool,
    visiting: bool,
}

impl<'a> ProcessHandle<'a> {
    fn start(&mut self) -> Result<(), bun_core::Error> {
        // SAFETY: state backref is valid for the lifetime of the run loop (State outlives all handles).
        let state = unsafe { &mut *(self.state as *mut State<'a>) };
        state.remaining_scripts += 1;
        let handle = self;

        let argv: [*const c_char; 4] = [
            state.shell_bin.as_ptr().cast(),
            if cfg!(unix) { b"-c\0".as_ptr().cast() } else { b"exec\0".as_ptr().cast() },
            handle.config.combined.as_ptr().cast(),
            core::ptr::null(),
        ];
        // TODO(port): Zig uses `[_:null]?[*:0]const u8` (null-terminated array of nullable C strings).

        handle.start_time = Some(Instant::now());
        let mut spawned: spawn::process::SpawnProcessResult = 'brk: {
            // Get the envp with the PATH configured
            // There's probably a more optimal way to do this where you have a Vec shared
            // instead of creating a new one for each process
            // PERF(port): was arena bulk-free (std.heap.ArenaAllocator) — profile in Phase B
            let original_path = state.env.map.get(b"PATH").unwrap_or(b"");
            state.env.map.put(b"PATH", &handle.config.PATH);
            // Zig: `defer { ... env.map.put("PATH", original_path); }` — restores PATH
            // unconditionally at block exit (success OR error). Keep the guard armed for the
            // whole block so `?` early-returns also restore.
            let _guard = scopeguard::guard((), |_| {
                state.env.map.put(b"PATH", original_path);
            });
            // TODO(port): scopeguard closure captures &mut state.env across the calls below;
            // borrowck will require reshaping in Phase B (raw ptr capture or split borrow).
            let envp = state.env.map.create_null_delimited_env_map()?;
            break 'brk spawn::spawn_process(&handle.options, &argv, &envp)?.unwrap()?;
            // `_guard` drops here (or on `?` above), restoring PATH — matches Zig `defer`.
        };
        let process = spawned.to_process(state.event_loop, false);

        handle.stdout.set_parent(handle);
        handle.stderr.set_parent(handle);

        #[cfg(windows)]
        {
            handle.stdout.source = bun_io::Source::Pipe(handle.options.stdout.buffer);
            handle.stderr.source = bun_io::Source::Pipe(handle.options.stderr.buffer);
        }

        #[cfg(unix)]
        {
            if let Some(stdout) = spawned.stdout {
                let _ = sys::set_nonblocking(stdout);
                handle.stdout.start(stdout, true).unwrap()?;
            }
            if let Some(stderr) = spawned.stderr {
                let _ = sys::set_nonblocking(stderr);
                handle.stderr.start(stderr, true).unwrap()?;
            }
        }
        #[cfg(not(unix))]
        {
            handle.stdout.start_with_current_pipe().unwrap()?;
            handle.stderr.start_with_current_pipe().unwrap()?;
        }

        handle.process = Some(ProcessInfo { ptr: process.clone(), status: Status::Running });
        process.set_exit_handler(handle);

        match process.watch_or_reap() {
            sys::Result::Ok(()) => {}
            sys::Result::Err(err) => {
                if !process.has_exited() {
                    // SAFETY: all-zero is a valid Rusage (POD C struct)
                    let rusage = unsafe { core::mem::zeroed::<Rusage>() };
                    process.on_exit(Status::Err(err), &rusage);
                }
            }
        }
        Ok(())
    }

    pub fn on_read_chunk(&mut self, chunk: &[u8], has_more: ReadState) -> bool {
        let _ = has_more;
        // SAFETY: state backref valid (see start()).
        let state = unsafe { &mut *(self.state as *mut State<'a>) };
        let _ = state.read_chunk(self, chunk);
        true
    }

    pub fn on_reader_done(&mut self) {}

    pub fn on_reader_error(&mut self, err: sys::Error) {
        let _ = err;
    }

    pub fn on_process_exit(&mut self, proc: &mut Process, status: Status, _: &Rusage) {
        self.process.as_mut().unwrap().status = status;
        self.end_time = Some(Instant::now());
        // We just leak the process because we're going to exit anyway after all processes are done
        let _ = proc;
        // SAFETY: state backref valid (see start()).
        let state = unsafe { &mut *(self.state as *mut State<'a>) };
        let _ = state.process_exit(self);
    }

    pub fn event_loop(&self) -> &'static MiniEventLoop {
        // SAFETY: state backref valid.
        unsafe { (*self.state).event_loop }
    }

    pub fn loop_(&self) -> &bun_aio::Loop {
        #[cfg(windows)]
        {
            // SAFETY: state backref valid.
            return unsafe { (*self.state).event_loop.loop_.uv_loop };
        }
        #[cfg(not(windows))]
        {
            // SAFETY: state backref valid.
            return unsafe { (*self.state).event_loop.loop_ };
        }
    }
}

/// `Output.prettyFmt(str, true)` — comptime ANSI-tag expansion in Zig.
// TODO(port): `pretty_fmt` is comptime string processing in Zig; needs a `const fn` or macro
// in `bun_core::Output`. Using a thin wrapper macro for now.
macro_rules! fmt {
    ($s:literal) => {
        bun_core::Output::pretty_fmt!($s, true)
    };
}

struct State<'a> {
    handles: Box<[ProcessHandle<'a>]>,
    event_loop: &'static MiniEventLoop,
    remaining_scripts: usize,
    // buffer for batched output
    draw_buf: Vec<u8>,
    last_lines_written: usize,
    pretty_output: bool,
    shell_bin: ZStr<'static>, // TODO(port): lifetime — leaked in Zig (findShell/selfExePath)
    aborted: bool,
    // TODO(port): lifetime — LIFETIMES.tsv says BORROW_PARAM (`&'a`), but Zig field is
    // `*bun.DotEnv.Loader` and ProcessHandle::start mutates `env.map` (PATH swap). Needs `&mut`;
    // file a correction to LIFETIMES.tsv.
    env: &'a mut bun_dotenv::Loader,
}

struct ElideResult<'b> {
    content: &'b [u8],
    elided_count: usize,
}

impl<'a> State<'a> {
    pub fn is_done(&self) -> bool {
        self.remaining_scripts == 0
    }

    fn read_chunk(
        &mut self,
        handle: &mut ProcessHandle<'a>,
        chunk: &[u8],
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
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

    fn process_exit(&mut self, handle: &mut ProcessHandle<'a>) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.remaining_scripts -= 1;
        if !self.aborted {
            for &dependent in &handle.dependents {
                // SAFETY: dependent points into self.handles, valid for the run loop lifetime.
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
        if self.pretty_output {
            let _ = self.redraw(false);
        } else {
            self.draw_buf.clear();
            // flush any remaining buffer
            if !handle.buffer.is_empty() {
                write!(
                    &mut self.draw_buf,
                    "{}: {}\n",
                    bstr::BStr::new(&handle.config.package_name),
                    bstr::BStr::new(&handle.buffer),
                )?;
                handle.buffer.clear();
            }
            // print exit status
            match handle.process.as_ref().unwrap().status {
                Status::Exited(exited) => {
                    write!(
                        &mut self.draw_buf,
                        "{} {}: Exited with code {}\n",
                        bstr::BStr::new(&handle.config.package_name),
                        bstr::BStr::new(&handle.config.script_name),
                        exited.code,
                    )?;
                }
                Status::Signaled(signal) => {
                    write!(
                        &mut self.draw_buf,
                        "{} {}: Signaled with code {}\n",
                        bstr::BStr::new(&handle.config.package_name),
                        bstr::BStr::new(&handle.config.script_name),
                        <&'static str>::from(signal),
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
            return ElideResult { content: &[], elided_count: 0 };
        }
        if data[data.len() - 1] == b'\n' {
            data = &data[0..data.len() - 1];
        }
        let Some(max_lines_val) = max_lines else {
            return ElideResult { content: data, elided_count: 0 };
        };
        if max_lines_val == 0 {
            return ElideResult { content: data, elided_count: 0 };
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
        ElideResult { content, elided_count: elided }
    }

    fn redraw(&mut self, is_abort: bool) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if !self.pretty_output {
            return Ok(());
        }
        self.draw_buf.clear();
        self.draw_buf.extend_from_slice(Output::SYNCHRONIZED_START);
        if self.last_lines_written > 0 {
            // move cursor to the beginning of the line and clear it
            self.draw_buf.extend_from_slice(b"\x1b[0G\x1b[K");
            for _ in 0..self.last_lines_written {
                // move cursor up and clear the line
                self.draw_buf.extend_from_slice(b"\x1b[1A\x1b[K");
            }
        }
        // PORT NOTE: reshaped for borrowck — iterating handles by index since draw_buf is also &mut self.
        for idx in 0..self.handles.len() {
            // SAFETY: idx in bounds; we need disjoint access to handles[idx] and draw_buf.
            let handle = unsafe { &*(&self.handles[idx] as *const ProcessHandle<'a>) };
            // TODO(port): borrowck — self.handles[idx] borrowed while self.draw_buf is &mut.
            // normally we truncate the output to 10 lines, but on abort we print everything to aid debugging
            let elide_lines = if is_abort { None } else { Some(handle.config.elide_count.unwrap_or(10)) };
            let e = Self::elide(&handle.buffer, elide_lines);

            write!(
                &mut self.draw_buf,
                fmt!("<b>{s}<r> {s} $ <d>{s}<r>\n"),
                bstr::BStr::new(&handle.config.package_name),
                bstr::BStr::new(&handle.config.script_name),
                bstr::BStr::new(&handle.config.script_content),
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
                self.draw_buf.extend_from_slice(fmt!("<cyan>│<r> ").as_bytes());
                self.draw_buf.extend_from_slice(line);
                content = &content[i + 1..];
            }
            if !content.is_empty() {
                self.draw_buf.extend_from_slice(fmt!("<cyan>│<r> ").as_bytes());
                self.draw_buf.extend_from_slice(content);
                self.draw_buf.push(b'\n');
            }
            self.draw_buf.extend_from_slice(fmt!("<cyan>└─<r> ").as_bytes());
            if let Some(proc) = &handle.process {
                match proc.status {
                    Status::Running => {
                        self.draw_buf.extend_from_slice(fmt!("<cyan>Running...<r>\n").as_bytes());
                    }
                    Status::Exited(exited) => {
                        if exited.code == 0 {
                            if let (Some(start), Some(end)) = (handle.start_time, handle.end_time) {
                                let duration = end.duration_since(start);
                                let ms = duration.as_nanos() as f64 / 1_000_000.0;
                                if ms > 1000.0 {
                                    write!(
                                        &mut self.draw_buf,
                                        fmt!("<cyan>Done in {d:.2} s<r>\n"),
                                        ms / 1_000.0,
                                    )?;
                                } else {
                                    write!(
                                        &mut self.draw_buf,
                                        fmt!("<cyan>Done in {d:.0} ms<r>\n"),
                                        ms,
                                    )?;
                                }
                            } else {
                                self.draw_buf.extend_from_slice(fmt!("<cyan>Done<r>\n").as_bytes());
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
                        if code == spawn::Signal::SIGINT {
                            write!(&mut self.draw_buf, fmt!("<red>Interrupted<r>\n"))?;
                        } else {
                            write!(
                                &mut self.draw_buf,
                                fmt!("<red>Signaled with code {s}<r>\n"),
                                <&'static str>::from(code),
                            )?;
                        }
                    }
                    Status::Err(_) => {
                        self.draw_buf.extend_from_slice(fmt!("<red>Error<r>\n").as_bytes());
                    }
                }
            } else {
                write!(
                    &mut self.draw_buf,
                    fmt!("<cyan><d>Waiting for {d} other script(s)<r>\n"),
                    handle.remaining_dependencies,
                )?;
            }
        }
        self.draw_buf.extend_from_slice(Output::SYNCHRONIZED_END);
        self.last_lines_written = 0;
        for &c in &self.draw_buf {
            if c == b'\n' {
                self.last_lines_written += 1;
            }
        }
        self.flush_draw_buf();
        Ok(())
    }

    fn flush_draw_buf(&self) {
        // TODO(port): std::fs::File::stdout() banned — use bun_sys stdout write.
        let _ = bun_sys::File::stdout().write_all(&self.draw_buf);
    }

    pub fn abort(&mut self) {
        // we perform an abort by sending SIGINT to all processes
        self.aborted = true;
        for handle in self.handles.iter_mut() {
            if let Some(proc) = &mut handle.process {
                // if we get an error here we simply ignore it
                let _ = proc.ptr.kill(bun_sys::posix::SIG::INT);
                // TODO(port): SIGINT constant location (bun_sys vs libc)
            }
        }
    }

    pub fn finalize(&mut self) -> u8 {
        if self.aborted {
            let _ = self.redraw(true);
        }
        for handle in self.handles.iter() {
            if let Some(proc) = &handle.process {
                match proc.status {
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
// PORT NOTE: Zig used a non-atomic `var should_abort = false` set from a signal handler;
// Rust requires atomics for signal-handler-safe access.

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
            // TODO(port): std.posix.Sigaction → use bun_sys::posix wrapper or libc directly.
            let action = bun_sys::posix::Sigaction {
                handler: bun_sys::posix::SigHandler::SigAction(Self::posix_signal_handler),
                mask: bun_sys::posix::sigemptyset(),
                flags: bun_sys::posix::SA::SIGINFO
                    | bun_sys::posix::SA::RESTART
                    | bun_sys::posix::SA::RESETHAND,
            };
            bun_sys::posix::sigaction(bun_sys::posix::SIG::INT, &action, None);
        }
        #[cfg(not(unix))]
        {
            // TODO(port): move to <area>_sys
            // SAFETY: FFI call; `windows_ctrl_handler` is `extern "system"` with the
            // `PHANDLER_ROUTINE` signature and has 'static lifetime (free fn).
            let res = unsafe { bun_sys::c::SetConsoleCtrlHandler(Some(Self::windows_ctrl_handler), bun_sys::windows::TRUE) };
            if res == 0 {
                if cfg!(debug_assertions) {
                    Output::warn("Failed to set abort handler\n", ());
                }
            }
        }
    }

    pub fn uninstall() {
        // only necessary on Windows, as on posix we pass the SA_RESETHAND flag
        #[cfg(windows)]
        {
            // restores default Ctrl+C behavior
            // SAFETY: FFI call; passing NULL handler with FALSE restores default per Win32 docs.
            let _ = unsafe { bun_sys::c::SetConsoleCtrlHandler(None, bun_sys::windows::FALSE) };
        }
    }
}

#[cfg(windows)]
fn windows_is_terminal() -> bool {
    let res = bun_sys::windows::GetFileType(bun_sys::Fd::stdout().native());
    res == bun_sys::windows::FILE_TYPE_CHAR
}

pub fn run_scripts_with_filter(ctx: Command::Context) -> Result<core::convert::Infallible, bun_core::Error> {
    // TODO(port): Zig return type is `!noreturn`; using Result<Infallible, _> for `?` support.
    let script_name: &[u8] = if ctx.positionals.len() > 1 {
        &ctx.positionals[1]
    } else if ctx.positionals.len() > 0 {
        &ctx.positionals[0]
    } else {
        Output::pretty_errorln("<r><red>error<r>: No script name provided", ());
        Global::exit(1);
    };
    let mut pre_script_name = vec![0u8; script_name.len() + 3].into_boxed_slice();
    pre_script_name[0..3].copy_from_slice(b"pre");
    pre_script_name[3..].copy_from_slice(script_name);

    let mut post_script_name = vec![0u8; script_name.len() + 4].into_boxed_slice();
    post_script_name[0..4].copy_from_slice(b"post");
    post_script_name[4..].copy_from_slice(script_name);

    let fsinstance = bun_fs::FileSystem::init(None)?;

    // these things are leaked because we are going to exit
    // When --workspaces is set, we want to match all workspace packages
    // Otherwise use the provided filters
    let mut filters_to_use = ctx.filters;
    if ctx.workspaces {
        // Use "*" as filter to match all packages in the workspace
        filters_to_use = &[b"*"];
        // TODO(port): slice-of-slices type for filters
    }

    let mut filter_instance =
        FilterArg::FilterSet::init(filters_to_use, fsinstance.top_level_dir)?;
    let mut patterns: Vec<Box<[u8]>> = Vec::new();

    // Find package.json at workspace root
    let mut root_buf = bun_paths::PathBuffer::uninit();
    let resolve_root = FilterArg::get_candidate_package_patterns(
        &ctx.log,
        &mut patterns,
        fsinstance.top_level_dir,
        &mut root_buf,
    )?;

    // TODO(port): out-param init — Zig used `var this_transpiler: Transpiler = undefined` and
    // `configureEnvForRun` writes through it. Per PORTING.md this should be reshaped to
    // `RunCommand::configure_env_for_run(...) -> Result<Transpiler, _>` in Phase B; until then
    // pass `&mut MaybeUninit<Transpiler>` (zeroed() is invalid: Transpiler is not #[repr(C)] POD).
    let mut this_transpiler = core::mem::MaybeUninit::<bun_bundler::Transpiler>::uninit();
    let _ = RunCommand::configure_env_for_run(&ctx, &mut this_transpiler, None, true, false)?;
    // SAFETY: configure_env_for_run fully initializes the out-param on Ok.
    let mut this_transpiler = unsafe { this_transpiler.assume_init() };

    let mut package_json_iter =
        FilterArg::PackageFilterIterator::init(&patterns, resolve_root)?;
    // defer package_json_iter.deinit() — handled by Drop

    // Get list of packages that match the configuration
    let mut scripts: Vec<ScriptConfig> = Vec::new();
    // var scripts = std.ArrayHashMap([]const u8, ScriptConfig).init(ctx.allocator);
    while let Some(package_json_path) = package_json_iter.next()? {
        let dirpath = bun_paths::dirname(package_json_path, bun_paths::Platform::Auto)
            .unwrap_or_else(|| Global::crash());
        let path = strings::without_trailing_slash(dirpath);

        // When using --workspaces, skip the root package to prevent recursion
        if ctx.workspaces && path == resolve_root {
            continue;
        }

        let Some(pkgjson) = bun_resolver::PackageJSON::parse(
            &mut this_transpiler.resolver,
            dirpath,
            bun_resolver::Invalid,
            None,
            bun_resolver::IncludeScripts,
            bun_resolver::Main,
        ) else {
            Output::warn("Failed to read package.json\n", ());
            continue;
        };
        // TODO(port): PackageJSON::parse signature — enum args are placeholders.

        let Some(pkgscripts) = &pkgjson.scripts else { continue };

        if !filter_instance.matches(path, &pkgjson.name) {
            continue;
        }

        let path_var = RunCommand::configure_path_for_run_with_package_json_dir(
            &ctx,
            dirpath,
            &mut this_transpiler,
            None,
            dirpath,
            ctx.debug.run_in_bun,
        )?;

        for (i, name) in [&pre_script_name[..], script_name, &post_script_name[..]].iter().enumerate() {
            let Some(original_content) = pkgscripts.get(*name) else {
                if i == 1 && ctx.workspaces && !ctx.if_present {
                    Output::err_generic(
                        format_args!("Missing '{}' script at '{}'", bstr::BStr::new(script_name), bstr::BStr::new(path)),
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
                if bun_shell::needs_escape_utf8_ascii_latin1(part) {
                    bun_shell::escape_8bit(part, &mut copy_script, true)?;
                } else {
                    copy_script.extend_from_slice(part);
                }
            }
            copy_script.push(0);

            // TODO(port): in Zig, `script_content` and `combined` both alias `copy_script.items`.
            // Here we leak `copy_script` and derive raw slices; revisit ownership in Phase B.
            let leaked = Box::leak(copy_script.into_boxed_slice());
            let combined_len = leaked.len() - 1;
            // SAFETY: leaked[combined_len] == 0 written above
            let combined = unsafe { ZStr::from_raw(leaked.as_ptr(), combined_len) };

            scripts.push(ScriptConfig {
                package_json_path: Box::<[u8]>::from(package_json_path),
                package_name: Box::<[u8]>::from(&pkgjson.name[..]),
                script_name: Box::<[u8]>::from(*name),
                script_content: Box::<[u8]>::from(&leaked[0..len_command_only]),
                combined,
                deps: pkgjson.dependencies.clone(),
                // TODO(port): DependencyMap clone — Zig copied by value (shallow).
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
        if ctx.workspaces {
            Output::err_generic(format_args!(
                "No workspace packages have script \"{}\"",
                bstr::BStr::new(script_name)
            ));
        } else {
            Output::err_generic(format_args!("No packages matched the filter"));
        }
        Global::exit(1);
    }

    let event_loop = MiniEventLoop::init_global(this_transpiler.env, None);
    // --no-orphans: register the macOS kqueue parent watch on this MiniEventLoop
    // (the VirtualMachine.init path is never reached for --filter). Linux is
    // already covered by prctl in enable() + linux_pdeathsig on each spawn.
    bun_core::ParentDeathWatchdog::install_on_event_loop(EventLoopHandle::init(event_loop));
    // TODO(port): ParentDeathWatchdog crate location.
    let shell_bin: ZStr<'static> = {
        #[cfg(unix)]
        {
            RunCommand::find_shell(
                this_transpiler.env.get(b"PATH").unwrap_or(b""),
                fsinstance.top_level_dir,
            )
            .ok_or(bun_core::err!("MissingShell"))?
        }
        #[cfg(not(unix))]
        {
            bun_core::self_exe_path().map_err(|_| bun_core::err!("MissingShell"))?
        }
    };

    let mut handles: Box<[ProcessHandle]> =
        // TODO(port): Box::new_uninit_slice — handles initialized in loop below.
        Vec::with_capacity(scripts.len()).into();
    // PORT NOTE: reshaped for borrowck — Zig allocates uninit slice then writes each element.
    // We build into a Vec first, but need stable addresses for `&state` backref and `&mut handles[i]`
    // pointers stored in `map`. This is self-referential; raw pointers used below.

    let mut state = State {
        handles, // placeholder; reassigned after init below
        event_loop,
        remaining_scripts: 0,
        draw_buf: Vec::new(),
        last_lines_written: 0,
        pretty_output: {
            #[cfg(windows)]
            { windows_is_terminal() && Output::enable_ansi_colors_stdout() }
            #[cfg(not(windows))]
            { Output::enable_ansi_colors_stdout() }
        },
        shell_bin,
        aborted: false,
        env: this_transpiler.env,
    };

    // initialize the handles
    // TODO(port): self-referential init — `state.handles[i].state = &state` and `map` stores
    // `*mut ProcessHandle` into state.handles. Phase B must pin `state` or restructure.
    let mut handles_vec: Vec<ProcessHandle> = Vec::with_capacity(scripts.len());
    let state_ptr: *const State = &state;
    let mut map: StringHashMap<Vec<*mut ProcessHandle>> = StringHashMap::default();
    for (i, script) in scripts.iter().enumerate() {
        handles_vec.push(ProcessHandle {
            state: state_ptr,
            config: script,
            stdout: BufferedReader::init::<ProcessHandle>(),
            stderr: BufferedReader::init::<ProcessHandle>(),
            buffer: Vec::new(),
            process: None,
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
                cwd: bun_paths::dirname(&script.package_json_path, bun_paths::Platform::Auto)
                    .unwrap_or(b""),
                #[cfg(windows)]
                windows: spawn::WindowsOptions { loop_: EventLoopHandle::init(event_loop) },
                stream: true,
                ..Default::default()
                // TODO(port): SpawnOptions remaining fields
            },
            start_time: None,
            end_time: None,
            remaining_dependencies: 0,
            dependents: Vec::new(),
            visited: false,
            visiting: false,
        });
        let _ = i;
    }
    state.handles = handles_vec.into_boxed_slice();
    for (i, script) in scripts.iter().enumerate() {
        let handle_ptr: *mut ProcessHandle = &mut state.handles[i];
        let res = map.get_or_put(&script.package_name);
        if res.found_existing {
            res.value_ptr.push(handle_ptr);
            // Output.prettyErrorln("<r><red>error<r>: Duplicate package name: {s}", .{script.package_name});
            // Global.exit(1);
        } else {
            *res.value_ptr = Vec::new();
            res.value_ptr.push(handle_ptr);
            // &state.handles[i];
        }
        // TODO(port): StringHashMap::get_or_put API shape.
    }
    // compute dependencies (TODO: maybe we should do this only in a workspace?)
    for handle in state.handles.iter_mut() {
        let source_buf = &handle.config.deps.source_buf;
        let mut iter = handle.config.deps.map.iterator();
        while let Some(entry) = iter.next() {
            let name = entry.key_ptr.slice(source_buf);
            // is it a workspace dependency?
            if let Some(pkgs) = map.get(name) {
                for &dep in pkgs {
                    // SAFETY: dep points into state.handles which is stable for the run.
                    unsafe { (*dep).dependents.push(handle as *mut _) };
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
            let next_ptr: *mut ProcessHandle = &mut state.handles[i + 1];
            state.handles[i].dependents.push(next_ptr);
            state.handles[i + 1].remaining_dependencies += 1;
        }
    }

    // start inital scripts
    for handle in state.handles.iter_mut() {
        if handle.remaining_dependencies == 0 {
            if handle.start().is_err() {
                // todo this should probably happen in "start"
                Output::pretty_errorln("<r><red>error<r>: Failed to start process", ());
                Global::exit(1);
            }
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
        }
        event_loop.tick_once(&state);
    }

    let status = state.finalize();

    Global::exit(status);
}

fn has_cycle(current: &mut ProcessHandle) -> bool {
    current.visited = true;
    current.visiting = true;
    for &dep in &current.dependents {
        // SAFETY: dep points into state.handles, valid for the run loop lifetime.
        let dep = unsafe { &mut *dep };
        if dep.visiting {
            return true;
        } else if !dep.visited {
            if has_cycle(dep) {
                return true;
            }
        }
    }
    current.visiting = false;
    false
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/filter_run.zig (682 lines)
//   confidence: medium
//   todos:      26
//   notes:      Self-referential State<->ProcessHandle (raw ptr backrefs); fmt!() needs comptime pretty_fmt macro; ScriptConfig slice ownership leaked in Zig — Phase B should pin State and revisit Stdio/SpawnOptions/sigaction shapes.
// ──────────────────────────────────────────────────────────────────────────
