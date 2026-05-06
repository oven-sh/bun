use core::ffi::{c_char, c_void};
use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use crate::cli::filter_arg as FilterArg;
use crate::cli::run_command::RunCommand;
use crate::cli::Command;
use bun_collections::StringHashMap;
use bun_core::{Global, Output};
use bun_io::{BufferedReader, ReadState};
use bun_event_loop::EventLoopHandle;
use bun_event_loop::MiniEventLoop::{self as MiniEventLoopMod, MiniEventLoop};
use bun_resolver::package_json::{DependencyMap, IncludeDependencies, IncludeScripts};
use crate::api::bun::process::{self as spawn, Process, ProcessExitVTable, Rusage, SpawnOptions, Status};
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
    combined: &'static ZStr, // TODO(port): lifetime — points into leaked copy_script buffer
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
        strings::cmp_strings_asc(&(), &a.package_name, &b.package_name)
    }
}

// Anonymous struct in Zig: `process: ?struct { ptr, status }`
struct ProcessInfo {
    // Intrusive ref-counted (`ThreadSafeRefCount<Process>`); raw `*mut` matches
    // `to_process()` and `set_exit_handler` callers (Zig: `*Process`).
    ptr: *mut Process,
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
        #[allow(unused_mut)]
        let mut spawned: spawn::SpawnProcessResult = 'brk: {
            // Get the envp with the PATH configured
            // There's probably a more optimal way to do this where you have a Vec shared
            // instead of creating a new one for each process
            // PERF(port): was arena bulk-free (std.heap.ArenaAllocator) — profile in Phase B
            let env_ptr = state.env;
            // SAFETY: state.env is the process-lifetime DotEnv loader (Transpiler::env).
            let env = unsafe { &mut *env_ptr };
            // PORT NOTE: copy to owned — `original_path` borrows env.map which is
            // mutated by put() below (Zig aliased freely).
            let original_path: Box<[u8]> = env.map.get(b"PATH").unwrap_or(b"").into();
            let _ = env.map.put(b"PATH", &handle.config.PATH);
            // Zig: `defer { ... env.map.put("PATH", original_path); }` — restores PATH
            // unconditionally at block exit (success OR error). Keep the guard armed for the
            // whole block so `?` early-returns also restore.
            let _guard = scopeguard::guard((), move |_| {
                // SAFETY: env_ptr valid for the run loop lifetime (see above).
                let _ = unsafe { (*env_ptr).map.put(b"PATH", &original_path) };
            });
            // SAFETY: see above; reborrow through raw ptr to avoid overlapping &mut with guard.
            let envp = unsafe { (*env_ptr).map.create_null_delimited_env_map()? };
            break 'brk spawn::spawn_process(
                &handle.options,
                argv.as_ptr(),
                envp.as_ptr() as *const *const c_char,
            )??;
            // `_guard` drops here (or on `?` above), restoring PATH — matches Zig `defer`.
        };
        #[cfg(unix)]
        let (stdout_fd, stderr_fd) = (spawned.stdout, spawned.stderr);
        let process = spawned.to_process(EventLoopHandle::init_mini(state.event_loop), false);

        let handle_ptr = handle as *mut ProcessHandle<'a> as *mut c_void;
        handle.stdout.set_parent(handle_ptr);
        handle.stderr.set_parent(handle_ptr);

        #[cfg(windows)]
        {
            handle.stdout.source = bun_io::Source::Pipe(handle.options.stdout.buffer);
            handle.stderr.source = bun_io::Source::Pipe(handle.options.stderr.buffer);
        }

        #[cfg(unix)]
        {
            if let Some(stdout) = stdout_fd {
                let _ = sys::set_nonblocking(stdout);
                handle.stdout.start(stdout, true)?;
            }
            if let Some(stderr) = stderr_fd {
                let _ = sys::set_nonblocking(stderr);
                handle.stderr.start(stderr, true)?;
            }
        }
        #[cfg(not(unix))]
        {
            handle.stdout.start_with_current_pipe()?;
            handle.stderr.start_with_current_pipe()?;
        }

        handle.process = Some(ProcessInfo { ptr: process, status: Status::Running });
        // SAFETY: `process` was just allocated by `to_process` (Box::into_raw);
        // sole owner until reaped, owner backref set before reap callback can fire.
        let process = unsafe { &mut *process };
        process.set_exit_handler(
            (handle as *mut ProcessHandle<'a>).cast::<()>(),
            &PROCESS_HANDLE_EXIT_VTABLE,
        );

        match process.watch_or_reap() {
            Ok(_) => {}
            Err(err) => {
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

}

/// `ProcessExitHandler` vtable for [`ProcessHandle`]. Mirrors the Zig
/// `TaggedPointerUnion` arm `ProcessHandle => onProcessExit(...)`.
static PROCESS_HANDLE_EXIT_VTABLE: ProcessExitVTable = ProcessExitVTable {
    on_process_exit: process_handle_on_process_exit,
};

unsafe fn process_handle_on_process_exit(
    owner: *mut (),
    process: *mut Process,
    status: Status,
    rusage: *const Rusage,
) {
    // SAFETY: `owner` is the `*mut ProcessHandle` registered via
    // `set_exit_handler`; it outlives the Process.
    unsafe {
        (*(owner as *mut ProcessHandle<'static>))
            .on_process_exit(&mut *process, status, &*rusage)
    };
}

impl<'a> ProcessHandle<'a> {
    pub fn on_process_exit(&mut self, proc: &mut Process, status: Status, _: &Rusage) {
        self.process.as_mut().unwrap().status = status;
        self.end_time = Some(Instant::now());
        // We just leak the process because we're going to exit anyway after all processes are done
        let _ = proc;
        // SAFETY: state backref valid (see start()).
        let state = unsafe { &mut *(self.state as *mut State<'a>) };
        let _ = state.process_exit(self);
    }

    pub fn event_loop(&self) -> *mut MiniEventLoop<'static> {
        // SAFETY: state backref valid.
        unsafe { (*self.state).event_loop }
    }

    pub fn loop_(&self) -> *mut bun_aio::Loop {
        #[cfg(windows)]
        {
            // SAFETY: state backref valid; event_loop is the live MiniEventLoop singleton.
            return unsafe { (*(*self.state).event_loop).loop_.uv_loop };
        }
        #[cfg(not(windows))]
        {
            // SAFETY: state backref valid; event_loop is the live MiniEventLoop singleton.
            return unsafe { (*(*self.state).event_loop).loop_ };
        }
    }
}

// SAFETY: `this` is the `*mut ProcessHandle` registered via `set_parent`; the
// reader holds no `&mut ProcessHandle` across the callback (it only holds a
// `&mut` to the embedded `BufferedReader` field, which is disjoint from the
// fields touched here per the `BufferedReaderParent` aliasing contract).
impl<'a> bun_io::pipe_reader::BufferedReaderParent for ProcessHandle<'a> {
    const HAS_ON_READ_CHUNK: bool = true;

    unsafe fn on_read_chunk(this: *mut Self, chunk: &[u8], has_more: ReadState) -> bool {
        unsafe { (*this).on_read_chunk(chunk, has_more) }
    }
    unsafe fn on_reader_done(this: *mut Self) {
        unsafe { (*this).on_reader_done() }
    }
    unsafe fn on_reader_error(this: *mut Self, err: sys::Error) {
        unsafe { (*this).on_reader_error(err) }
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_aio::Loop {
        unsafe { (*this).loop_() }
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        // CYCLEBREAK: bun_io::EventLoopHandle is an opaque `*mut c_void`; hand it
        // the MiniEventLoop pointer (consumers reinterpret per io/lib.rs note).
        // TODO(port): once bun_io::EventLoopHandle gains a typed init for the
        // mini arm, route through it instead of the raw cast.
        bun_io::EventLoopHandle(unsafe { (*this).event_loop() } as *mut c_void)
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
    // Raw `*mut` (Zig: `*MiniEventLoop`) — `init_global` returns the
    // thread-local singleton pointer; aliasing &mut would be UB.
    event_loop: *mut MiniEventLoop<'static>,
    remaining_scripts: usize,
    // buffer for batched output
    draw_buf: Vec<u8>,
    last_lines_written: usize,
    pretty_output: bool,
    shell_bin: &'static ZStr, // TODO(port): lifetime — leaked in Zig (findShell/selfExePath)
    aborted: bool,
    // Raw `*mut` (Zig: `*bun.DotEnv.Loader`) — process-lifetime singleton owned
    // by Transpiler; ProcessHandle::start mutates `env.map` (PATH swap) so a
    // shared borrow won't do, and `&'a mut` would conflict with the Transpiler's
    // own raw-ptr field. Reborrow `&mut *env` at use sites.
    env: *mut bun_dotenv::Loader<'static>,
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
                        Output::pretty_errorln("<r><red>error<r>: Failed to start process");
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
            match &handle.process.as_ref().unwrap().status {
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
        self.draw_buf.extend_from_slice(Output::SYNCHRONIZED_START.as_bytes());
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
                match &proc.status {
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
        self.draw_buf.extend_from_slice(Output::SYNCHRONIZED_END.as_bytes());
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
                // SAFETY: proc.ptr is a live `*mut Process` (set in start(); leaked
                // until program exit per on_process_exit note).
                let _ = unsafe { (*proc.ptr).kill(bun_sys::SignalCode::SIGINT.0) };
            }
        }
    }

    pub fn finalize(&mut self) -> u8 {
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
            // SAFETY: libc::sigaction is #[repr(C)] POD; all-zero is a valid value (fields overwritten below).
            let mut act: libc::sigaction = unsafe { core::mem::zeroed() };
            act.sa_sigaction = Self::posix_signal_handler as *const () as usize;
            act.sa_flags = libc::SA_SIGINFO | libc::SA_RESTART | libc::SA_RESETHAND;
            // SAFETY: sa_mask is a valid out-pointer; act is on the stack.
            unsafe {
                libc::sigemptyset(&mut act.sa_mask);
                libc::sigaction(libc::SIGINT, &act, core::ptr::null_mut());
            }
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
        Output::pretty_errorln("<r><red>error<r>: No script name provided");
        Global::exit(1);
    };
    let mut pre_script_name = vec![0u8; script_name.len() + 3].into_boxed_slice();
    pre_script_name[0..3].copy_from_slice(b"pre");
    pre_script_name[3..].copy_from_slice(script_name);

    let mut post_script_name = vec![0u8; script_name.len() + 4].into_boxed_slice();
    post_script_name[0..4].copy_from_slice(b"post");
    post_script_name[4..].copy_from_slice(script_name);

    // SAFETY: FileSystem::init returns the process-global singleton; valid for 'static.
    let fsinstance = unsafe { &*bun_resolver::fs::FileSystem::init(None)? };

    // these things are leaked because we are going to exit
    // When --workspaces is set, we want to match all workspace packages
    // Otherwise use the provided filters
    // PORT NOTE: `FilterSet::init` takes `&[&[u8]]`; ctx.filters is
    // `Vec<Box<[u8]>>` so build a borrowed-slice view.
    let filters_to_use: Vec<&[u8]> = if ctx.workspaces {
        // Use "*" as filter to match all packages in the workspace
        vec![b"*".as_slice()]
    } else {
        ctx.filters.iter().map(|f| f.as_ref()).collect()
    };

    let filter_instance =
        FilterArg::FilterSet::init(&filters_to_use, fsinstance.top_level_dir)?;
    let mut patterns: Vec<Box<[u8]>> = Vec::new();

    // Find package.json at workspace root
    let mut root_buf = bun_paths::PathBuffer::uninit();
    let resolve_root = FilterArg::get_candidate_package_patterns(
        // SAFETY: `ctx.log` is the process-global Log; non-null and live for 'static.
        unsafe { &mut *ctx.log },
        &mut patterns,
        fsinstance.top_level_dir,
        &mut root_buf,
    )?;

    // TODO(port): out-param init — Zig used `var this_transpiler: Transpiler = undefined` and
    // `configureEnvForRun` writes through it. Per PORTING.md this should be reshaped to
    // `RunCommand::configure_env_for_run(...) -> Result<Transpiler, _>` in Phase B; until then
    // pass `&mut MaybeUninit<Transpiler>` (zeroed() is invalid: Transpiler is not #[repr(C)] POD).
    let mut this_transpiler = core::mem::MaybeUninit::<bun_bundler::Transpiler<'static>>::uninit();
    let _ = RunCommand::configure_env_for_run(&mut *ctx, &mut this_transpiler, None, true, false)?;
    // SAFETY: configure_env_for_run fully initializes the out-param on Ok.
    let mut this_transpiler = unsafe { this_transpiler.assume_init() };

    let pattern_refs: Vec<&[u8]> = patterns.iter().map(|p| p.as_ref()).collect();
    let mut package_json_iter =
        FilterArg::PackageFilterIterator::init(&pattern_refs, resolve_root)?;
    // defer package_json_iter.deinit() — handled by Drop

    // Get list of packages that match the configuration
    let mut scripts: Vec<ScriptConfig> = Vec::new();
    // var scripts = std.ArrayHashMap([]const u8, ScriptConfig).init(ctx.allocator);
    while let Some(package_json_path) = package_json_iter.next()? {
        let dirpath = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(&package_json_path);
        let path = strings::without_trailing_slash(dirpath);

        // When using --workspaces, skip the root package to prevent recursion
        if ctx.workspaces && path == resolve_root {
            continue;
        }

        let Some(pkgjson) = bun_resolver::PackageJSON::parse::<{ IncludeDependencies::Main }>(
            &mut this_transpiler.resolver,
            dirpath,
            bun_sys::Fd::invalid(),
            None,
            IncludeScripts::IncludeScripts,
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
                if crate::shell::needs_escape_utf8_ascii_latin1(part) {
                    crate::shell::escape_8bit(part, &mut copy_script, true)?;
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
    bun_aio::ParentDeathWatchdog::install_on_event_loop(EventLoopHandle::init(event_loop));
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
                cwd: bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(&script.package_json_path),
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
