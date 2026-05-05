//! This file contains Bun's crash handler. In debug builds, we are able to
//! print backtraces that are mapped to source code. In release builds, we do
//! not have debug symbols in the binary. Bun's solution to this is called
//! a "trace string", a url with compressed encoding of the captured
//! backtrace. Version 1 trace strings contain the following information:
//!
//! - What version and commit of Bun captured the backtrace.
//! - The platform the backtrace was captured on.
//! - The list of addresses with ASLR removed, ready to be remapped.
//! - If panicking, the message that was panicked with.
//!
//! These can be demangled using Bun's remapping API, which has cached
//! versions of all debug symbols for all versions of Bun. Hosting this keeps
//! users from having to download symbols, which can be very large.
//!
//! The remapper is open source: https://github.com/oven-sh/bun.report
//!
//! A lot of this handler is based on the Zig Standard Library implementation
//! for std.debug.panicImpl and their code for gathering backtraces.

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_long, c_void};
use core::fmt;
use core::sync::atomic::{AtomicU8, AtomicU32, Ordering};

use bun_core::{Environment, Global, Output, env_var, fmt as bun_fmt};
use bun_collections::BoundedArray;
use bun_base64::VLQ; // MOVE_DOWN(b0): was bun_sourcemap::VLQ
use bun_str::strings;
use bun_threading::Mutex;

mod cpu_features;
use cpu_features::CPUFeatures;

// TODO(b0): `Cli` arrives from move-in (MOVE_DOWN bun_cli::Cli → crash_handler).
// Only the two bits the crash handler needs — main-thread check and the
// one-byte command tag for the trace URL — land here as plain globals that
// `bun_runtime` populates at startup.
pub mod cli_state {
    use core::sync::atomic::{AtomicU8, AtomicUsize, Ordering};

    static MAIN_THREAD_ID: AtomicUsize = AtomicUsize::new(0);
    /// 0 = unset → encoded as `_` in the trace string.
    static CMD_CHAR: AtomicU8 = AtomicU8::new(0);

    pub fn set_main_thread_id(id: usize) { MAIN_THREAD_ID.store(id, Ordering::Relaxed); }
    pub fn set_cmd_char(c: u8) { CMD_CHAR.store(c, Ordering::Relaxed); }

    pub fn is_main_thread() -> bool {
        MAIN_THREAD_ID.load(Ordering::Relaxed) == bun_threading::current_thread_id()
    }
    pub fn cmd_char() -> Option<u8> {
        match CMD_CHAR.load(Ordering::Relaxed) { 0 => None, c => Some(c) }
    }
}

// TODO(port): std.builtin.StackTrace, std.debug.SelfInfo, std.debug.SourceLocation,
// std.io.tty.Config have no direct Rust equivalents — these are placeholder types
// that Phase B must wire to a Rust debug-info crate (or strip down to libc backtrace).
use bun_debug::{self as debug, SelfInfo, SourceLocation, StackTrace, TtyConfig};

/// Set this to false if you want to disable all uses of this panic handler.
/// This is useful for testing as a crash in here will not 'panicked during a panic'.
pub const ENABLE: bool = true;

/// Overridable with BUN_CRASH_REPORT_URL environment variable.
const DEFAULT_REPORT_BASE_URL: &str = "https://bun.report";

/// Only print the `Bun has crashed` message once. Once this is true, control
/// flow is not returned to the main application.
static mut HAS_PRINTED_MESSAGE: bool = false;

/// Non-zero whenever the program triggered a panic.
/// The counter is incremented/decremented atomically.
static PANICKING: AtomicU8 = AtomicU8::new(0);

// Locked to avoid interleaving panic messages from multiple threads.
// TODO: I don't think it's safe to lock/unlock a mutex inside a signal handler.
static PANIC_MUTEX: Mutex = Mutex::new();

thread_local! {
    /// Counts how many times the panic handler is invoked by this thread.
    /// This is used to catch and handle panics triggered by the panic handler.
    static PANIC_STAGE: Cell<usize> = const { Cell::new(0) };

    static INSIDE_NATIVE_PLUGIN: Cell<Option<*const c_char>> = const { Cell::new(None) };
    static UNSUPPORTED_UV_FUNCTION: Cell<Option<*const c_char>> = const { Cell::new(None) };

    /// This can be set by various parts of the codebase to indicate a broader
    /// action being taken. It is printed when a crash happens, which can help
    /// narrow down what the bug is. Example: "Crashed while parsing /path/to/file.js"
    ///
    /// Some of these are enabled in release builds, which may encourage users to
    /// attach the affected files to crash report. Others, which may have low crash
    /// rate or only crash due to assertion failures, are debug-only. See `Action`.
    pub static CURRENT_ACTION: Cell<Option<Action>> = const { Cell::new(None) };
}

// TODO(port): Vec is heap-allocated; matches std.ArrayListUnmanaged. Guarded by BEFORE_CRASH_HANDLERS_MUTEX.
static mut BEFORE_CRASH_HANDLERS_LIST: Vec<(*mut c_void, OnBeforeCrash)> = Vec::new();
static BEFORE_CRASH_HANDLERS_MUTEX: Mutex = Mutex::new();

/// Prevents crash reports from being uploaded to any server. Reports will still be printed and
/// abort the process. Overrides BUN_CRASH_REPORT_URL, BUN_ENABLE_CRASH_REPORTING, and all other
/// things that affect crash reporting. See suppressReporting() for intended usage.
static mut SUPPRESS_REPORTING: bool = false;

/// This structure and formatter must be kept in sync with `bun.report`'s decoder implementation.
#[derive(Clone, Copy)]
pub enum CrashReason {
    /// From @panic()
    Panic(&'static [u8]),
    // TODO(port): lifetime — Zig holds a borrowed []const u8; using &'static here for Phase A.

    /// "reached unreachable code"
    Unreachable,

    SegmentationFault(usize),
    IllegalInstruction(usize),

    /// Posix-only
    BusError(usize),
    /// Posix-only
    FloatingPointError(usize),
    /// Windows-only
    DatatypeMisalignment,
    /// Windows-only
    StackOverflow,

    /// Either `main` returned an error, or somewhere else in the code a trace string is printed.
    ZigError(bun_core::Error),

    OutOfMemory,
}

impl fmt::Display for CrashReason {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CrashReason::Panic(message) => write!(writer, "{}", bstr::BStr::new(message)),
            CrashReason::Unreachable => writer.write_str("reached unreachable code"),
            CrashReason::SegmentationFault(addr) => write!(writer, "Segmentation fault at address 0x{:X}", addr),
            CrashReason::IllegalInstruction(addr) => write!(writer, "Illegal instruction at address 0x{:X}", addr),
            CrashReason::BusError(addr) => write!(writer, "Bus error at address 0x{:X}", addr),
            CrashReason::FloatingPointError(addr) => write!(writer, "Floating point error at address 0x{:X}", addr),
            CrashReason::DatatypeMisalignment => writer.write_str("Unaligned memory access"),
            CrashReason::StackOverflow => writer.write_str("Stack overflow"),
            CrashReason::ZigError(err) => write!(writer, "error.{}", err.name()),
            CrashReason::OutOfMemory => writer.write_str("Bun ran out of memory"),
        }
    }
}

/// bun.bundle_v2.LinkerContext.generateCompileResultForJSChunk
///
/// Cycle-break (b0): the bundler types (`LinkerContext` / `Chunk` / `PartRange`)
/// live in a higher-tier crate, so this struct holds erased pointers and a
/// vtable supplied by `bun_bundler`. The bundler constructs this with
/// `bun_bundler::BUNDLE_GENERATE_CHUNK_VTABLE` (added by the move-in pass).
// PERF(port): was inline switch — cold path (crash trace only).
#[cfg(feature = "show_crash_trace")]
#[derive(Clone, Copy)]
pub struct BundleGenerateChunk {
    /// SAFETY: erased `&bun_bundler::LinkerContext`
    pub context: *const (),
    /// SAFETY: erased `&bun_bundler::Chunk`
    pub chunk: *const (),
    /// SAFETY: erased `&bun_bundler::PartRange`
    pub part_range: *const (),
    pub vtable: &'static BundleGenerateChunkVTable,
}

#[cfg(feature = "show_crash_trace")]
pub struct BundleGenerateChunkVTable {
    /// Format the chunk context into `writer` (called from `Action::fmt`).
    pub fmt: unsafe fn(
        context: *const (),
        chunk: *const (),
        part_range: *const (),
        writer: &mut fmt::Formatter<'_>,
    ) -> fmt::Result,
}

#[cfg(feature = "show_crash_trace")]
#[derive(Clone, Copy)]
pub struct ResolverAction {
    pub source_dir: &'static [u8],
    pub import_path: &'static [u8],
    pub kind: bun_options_types::ImportKind,
}

#[derive(Clone, Copy)]
pub enum Action {
    Parse(&'static [u8]),
    Visit(&'static [u8]),
    Print(&'static [u8]),
    // TODO(port): lifetime — these slices borrow caller-owned paths; &'static is a Phase A placeholder.

    #[cfg(feature = "show_crash_trace")]
    BundleGenerateChunk(BundleGenerateChunk),
    #[cfg(not(feature = "show_crash_trace"))]
    BundleGenerateChunk(()),

    #[cfg(feature = "show_crash_trace")]
    Resolver(ResolverAction),
    #[cfg(not(feature = "show_crash_trace"))]
    Resolver(()),

    Dlopen(&'static [u8]),
}

impl fmt::Display for Action {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Action::Parse(path) => write!(writer, "parsing {}", bstr::BStr::new(path)),
            Action::Visit(path) => write!(writer, "visiting {}", bstr::BStr::new(path)),
            Action::Print(path) => write!(writer, "printing {}", bstr::BStr::new(path)),
            #[cfg(feature = "show_crash_trace")]
            Action::BundleGenerateChunk(data) => {
                // SAFETY: `data` was constructed by bun_bundler with matching
                // erased pointer types; vtable.fmt casts them back.
                unsafe { (data.vtable.fmt)(data.context, data.chunk, data.part_range, writer) }
            }
            #[cfg(not(feature = "show_crash_trace"))]
            Action::BundleGenerateChunk(()) => Ok(()),
            #[cfg(feature = "show_crash_trace")]
            Action::Resolver(res) => {
                write!(
                    writer,
                    "resolving {} from {} ({})",
                    bstr::BStr::new(res.import_path),
                    bstr::BStr::new(res.source_dir),
                    res.kind.label(),
                )
            }
            #[cfg(not(feature = "show_crash_trace"))]
            Action::Resolver(()) => Ok(()),
            Action::Dlopen(path) => write!(writer, "loading native module: {}", bstr::BStr::new(path)),
        }
    }
}

#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn capture_libc_backtrace(begin_addr: usize, stack_trace: &mut StackTrace) {
    unsafe extern "C" {
        fn backtrace(buffer: *mut *mut c_void, size: c_int) -> c_int;
    }

    let addrs = stack_trace.instruction_addresses_mut();
    // SAFETY: addrs is a valid mutable slice of usize, which is layout-compatible with *mut c_void
    let count = unsafe { backtrace(addrs.as_mut_ptr().cast(), i32::try_from(addrs.len()).unwrap()) };
    stack_trace.index = usize::try_from(count).unwrap();

    // Skip frames until we find begin_addr (or close to it)
    // backtrace() captures everything including crash handler frames
    const TOLERANCE: usize = 128;
    let skip: usize = 'search: {
        for (i, &addr) in addrs[0..stack_trace.index].iter().enumerate() {
            // Check if this address is close to begin_addr (within tolerance)
            let delta = if addr >= begin_addr {
                addr - begin_addr
            } else {
                begin_addr - addr
            };
            if delta <= TOLERANCE {
                break 'search i;
            }
            // Give up searching after 8 frames
            if i >= 8 {
                break 'search 0;
            }
        }
        0
    };

    // Shift the addresses to skip crash handler frames
    // If begin_addr was not found, use the complete backtrace
    if skip > 0 {
        addrs.copy_within(skip..stack_trace.index, 0);
        stack_trace.index -= skip;
    }
}

/// This function is invoked when a crash happens. A crash is classified in `CrashReason`.
#[cold]
pub fn crash_handler(
    reason: CrashReason,
    // TODO: if both of these are specified, what is supposed to happen?
    error_return_trace: Option<&StackTrace>,
    begin_addr: Option<usize>,
) -> ! {
    if cfg!(debug_assertions) {
        Output::disable_scoped_debug_writer();
    }

    let mut trace_str_buf = BoundedArray::<u8, 1024>::new();

    match PANIC_STAGE.with(|s| s.get()) {
        0 => {
            bun_core::maybe_handle_panic_during_process_reload();

            PANIC_STAGE.with(|s| s.set(1));
            let _ = PANICKING.fetch_add(1, Ordering::SeqCst);

            if BEFORE_CRASH_HANDLERS_MUTEX.try_lock() {
                // SAFETY: guarded by BEFORE_CRASH_HANDLERS_MUTEX
                for &(ptr, cb) in unsafe { BEFORE_CRASH_HANDLERS_LIST.iter() } {
                    cb(ptr);
                }
            }

            {
                PANIC_MUTEX.lock();
                let _guard = scopeguard::guard((), |_| PANIC_MUTEX.unlock());

                // Use an raw unbuffered writer to stderr to avoid losing information on
                // panic in a panic. There is also a possibility that `Output` related code
                // is not configured correctly, so that would also mask the message.
                //
                // Output.errorWriter() is not used here because it may not be configured
                // if the program crashes immediately at startup.
                // TODO(port): std.fs.File.stderr().writerStreaming — using bun_sys raw stderr writer
                let writer = &mut bun_sys::stderr_writer();

                // The format of the panic trace is slightly different in debug
                // builds. Mainly, we demangle the backtrace immediately instead
                // of using a trace string.
                //
                // To make the release-mode behavior easier to demo, debug mode
                // checks for this CLI flag.
                let debug_trace = Environment::SHOW_CRASH_TRACE && 'check_flag: {
                    for arg in bun_core::argv() {
                        if arg == b"--debug-crash-handler-use-trace-string" {
                            break 'check_flag false;
                        }
                    }
                    // Act like release build when explicitly enabling reporting
                    if is_reporting_enabled() {
                        break 'check_flag false;
                    }
                    true
                };

                // SAFETY: single-threaded mutation under panic_mutex
                if unsafe { !HAS_PRINTED_MESSAGE } {
                    Output::flush();
                    Output::source::Stdio::restore();

                    if writer.write_all(concat!("============================================================", "\n").as_bytes()).is_err() { bun_sys::posix::abort(); }
                    if print_metadata(writer).is_err() { bun_sys::posix::abort(); }

                    if let Some(name) = INSIDE_NATIVE_PLUGIN.with(|c| c.get()) {
                        // SAFETY: name was set from a valid NUL-terminated C string
                        let native_plugin_name = unsafe { core::ffi::CStr::from_ptr(name) }.to_bytes();
                        let fmt = "\nBun has encountered a crash while running the <red><d>\"{s}\"<r> native plugin.\n\nThis indicates either a bug in the native plugin or in Bun.\n";
                        if write!(writer, "{}", Output::pretty_fmt_args(fmt, true, format_args!("{}", bstr::BStr::new(native_plugin_name)))).is_err() { bun_sys::posix::abort(); }
                    } else if bun_analytics::Features::unsupported_uv_function() > 0 {
                        let name: &[u8] = UNSUPPORTED_UV_FUNCTION.with(|c| c.get())
                            .map(|p| {
                                // SAFETY: p was set from a valid NUL-terminated C string via CrashHandler__unsupportedUVFunction
                                unsafe { core::ffi::CStr::from_ptr(p) }.to_bytes()
                            })
                            .unwrap_or(b"<unknown>");
                        let fmt = "Bun encountered a crash when running a NAPI module that tried to call\nthe <red>{s}<r> libuv function.\n\nBun is actively working on supporting all libuv functions for POSIX\nsystems, please see this issue to track our progress:\n\n<cyan>https://github.com/oven-sh/bun/issues/18546<r>\n\n";
                        if write!(writer, "{}", Output::pretty_fmt_args(fmt, true, format_args!("{}", bstr::BStr::new(name)))).is_err() { bun_sys::posix::abort(); }
                        // SAFETY: single-threaded mutation under panic_mutex
                        unsafe { HAS_PRINTED_MESSAGE = true; }
                    }
                } else {
                    if Output::enable_ansi_colors_stderr() {
                        if writer.write_all(Output::pretty_fmt("<red>", true)).is_err() { bun_sys::posix::abort(); }
                    }
                    if writer.write_all(b"oh no").is_err() { bun_sys::posix::abort(); }
                    if Output::enable_ansi_colors_stderr() {
                        if writer.write_all(Output::pretty_fmt("<r><d>: multiple threads are crashing<r>\n", true)).is_err() { bun_sys::posix::abort(); }
                    } else {
                        if writer.write_all(Output::pretty_fmt(": multiple threads are crashing\n", true)).is_err() { bun_sys::posix::abort(); }
                    }
                }

                if !matches!(reason, CrashReason::OutOfMemory) || debug_trace {
                    if Output::enable_ansi_colors_stderr() {
                        if writer.write_all(Output::pretty_fmt("<red>", true)).is_err() { bun_sys::posix::abort(); }
                    }

                    if writer.write_all(b"panic").is_err() { bun_sys::posix::abort(); }

                    if Output::enable_ansi_colors_stderr() {
                        if writer.write_all(Output::pretty_fmt("<r><d>", true)).is_err() { bun_sys::posix::abort(); }
                    }

                    if cli_state::is_main_thread() {
                        if writer.write_all(b"(main thread)").is_err() { bun_sys::posix::abort(); }
                    } else {
                        #[cfg(windows)]
                        {
                            let mut name: bun_sys::windows::PWSTR = core::ptr::null_mut();
                            // SAFETY: GetCurrentThread/GetThreadDescription are valid Win32 calls
                            let result = unsafe {
                                bun_sys::windows::GetThreadDescription(bun_sys::windows::GetCurrentThread(), &mut name)
                            };
                            // SAFETY: `name` is the PWSTR out-param written by GetThreadDescription; deref is guarded by the S_OK check via `&&` short-circuit
                            if bun_sys::windows::HRESULT_CODE(result) == bun_sys::windows::S_OK && unsafe { *name } != 0 {
                                // SAFETY: name is a valid NUL-terminated wide string
                                let span = unsafe { bun_str::WStr::from_ptr(name) };
                                if write!(writer, "({})", bun_fmt::utf16(span)).is_err() { bun_sys::posix::abort(); }
                            } else {
                                // SAFETY: GetCurrentThreadId is an infallible Win32 call with no pointer/precondition requirements
                                if write!(writer, "(thread {})", unsafe { bun_sys::c::GetCurrentThreadId() }).is_err() { bun_sys::posix::abort(); }
                            }
                        }
                        #[cfg(any(target_os = "macos", target_os = "linux", target_os = "freebsd"))]
                        { /* no-op */ }
                        // TODO(port): wasm @compileError("TODO")
                    }

                    if writer.write_all(b": ").is_err() { bun_sys::posix::abort(); }
                    if Output::enable_ansi_colors_stderr() {
                        if writer.write_all(Output::pretty_fmt("<r>", true)).is_err() { bun_sys::posix::abort(); }
                    }
                    if write!(writer, "{}\n", reason).is_err() { bun_sys::posix::abort(); }
                }

                if let Some(action) = CURRENT_ACTION.with(|c| c.get()) {
                    if write!(writer, "Crashed while {}\n", action).is_err() { bun_sys::posix::abort(); }
                }

                let mut addr_buf: [usize; 20] = [0; 20];
                let mut trace_buf: StackTrace;

                // If a trace was not provided, compute one now
                let trace: &StackTrace = 'blk: {
                    if let Some(ert) = error_return_trace {
                        if ert.index > 0 {
                            break 'blk ert;
                        }
                    }
                    trace_buf = StackTrace {
                        index: 0,
                        instruction_addresses: &mut addr_buf,
                    };
                    let desired_begin_addr = begin_addr.unwrap_or_else(|| bun_debug::return_address());
                    debug::capture_stack_trace(desired_begin_addr, &mut trace_buf);

                    #[cfg(all(target_os = "linux", target_env = "gnu"))]
                    {
                        let mut addr_buf_libc: [usize; 20] = [0; 20];
                        let mut trace_buf_libc = StackTrace {
                            index: 0,
                            instruction_addresses: &mut addr_buf_libc,
                        };
                        capture_libc_backtrace(desired_begin_addr, &mut trace_buf_libc);
                        // Use stack trace from glibc's backtrace() if it has more frames
                        if trace_buf_libc.index > trace_buf.index {
                            addr_buf = addr_buf_libc;
                            trace_buf.index = trace_buf_libc.index;
                        }
                    }
                    break 'blk &trace_buf;
                };

                if debug_trace {
                    unsafe { HAS_PRINTED_MESSAGE = true; }

                    dump_stack_trace(trace, WriteStackTraceLimits::default());

                    if write!(trace_str_buf.writer(), "{}", TraceString {
                        trace,
                        reason,
                        action: TraceStringAction::ViewTrace,
                    }).is_err() { bun_sys::posix::abort(); }
                } else {
                    if unsafe { !HAS_PRINTED_MESSAGE } {
                        unsafe { HAS_PRINTED_MESSAGE = true; }
                        if writer.write_all(b"oh no").is_err() { bun_sys::posix::abort(); }
                        if Output::enable_ansi_colors_stderr() {
                            if writer.write_all(Output::pretty_fmt("<r><d>:<r> ", true)).is_err() { bun_sys::posix::abort(); }
                        } else {
                            if writer.write_all(Output::pretty_fmt(": ", true)).is_err() { bun_sys::posix::abort(); }
                        }
                        if let Some(name) = INSIDE_NATIVE_PLUGIN.with(|c| c.get()) {
                            // SAFETY: name was set from a valid NUL-terminated C string
                            let native_plugin_name = unsafe { core::ffi::CStr::from_ptr(name) }.to_bytes();
                            if write!(writer, "{}", Output::pretty_fmt_args(
                                "Bun has encountered a crash while running the <red><d>\"{s}\"<r> native plugin.\n\nTo send a redacted crash report to Bun's team,\nplease file a GitHub issue using the link below:\n\n",
                                true,
                                format_args!("{}", bstr::BStr::new(native_plugin_name)),
                            )).is_err() { bun_sys::posix::abort(); }
                        } else if bun_analytics::Features::unsupported_uv_function() > 0 {
                            let name: &[u8] = UNSUPPORTED_UV_FUNCTION.with(|c| c.get())
                                .map(|p| {
                                    // SAFETY: p was set from a valid NUL-terminated C string via CrashHandler__unsupportedUVFunction
                                    unsafe { core::ffi::CStr::from_ptr(p) }.to_bytes()
                                })
                                .unwrap_or(b"<unknown>");
                            let fmt = "Bun encountered a crash when running a NAPI module that tried to call\nthe <red>{s}<r> libuv function.\n\nBun is actively working on supporting all libuv functions for POSIX\nsystems, please see this issue to track our progress:\n\n<cyan>https://github.com/oven-sh/bun/issues/18546<r>\n\n";
                            if write!(writer, "{}", Output::pretty_fmt_args(fmt, true, format_args!("{}", bstr::BStr::new(name)))).is_err() { bun_sys::posix::abort(); }
                        } else if matches!(reason, CrashReason::OutOfMemory) {
                            if writer.write_all(
                                b"Bun has run out of memory.\n\nTo send a redacted crash report to Bun's team,\nplease file a GitHub issue using the link below:\n\n",
                            ).is_err() { bun_sys::posix::abort(); }
                        } else {
                            if writer.write_all(
                                b"Bun has crashed. This indicates a bug in Bun, not your code.\n\nTo send a redacted crash report to Bun's team,\nplease file a GitHub issue using the link below:\n\n",
                            ).is_err() { bun_sys::posix::abort(); }
                        }
                    }

                    if Output::enable_ansi_colors_stderr() {
                        if writer.write_all(Output::pretty_fmt("<cyan>", true)).is_err() { bun_sys::posix::abort(); }
                    }

                    if writer.write_all(b" ").is_err() { bun_sys::posix::abort(); }

                    if write!(trace_str_buf.writer(), "{}", TraceString {
                        trace,
                        reason,
                        action: TraceStringAction::OpenIssue,
                    }).is_err() { bun_sys::posix::abort(); }

                    if writer.write_all(trace_str_buf.slice()).is_err() { bun_sys::posix::abort(); }

                    if writer.write_all(b"\n").is_err() { bun_sys::posix::abort(); }
                }

                if Output::enable_ansi_colors_stderr() {
                    if writer.write_all(Output::pretty_fmt("<r>\n", true)).is_err() { bun_sys::posix::abort(); }
                } else {
                    if writer.write_all(b"\n").is_err() { bun_sys::posix::abort(); }
                }
            }

            // Be aware that this function only lets one thread return from it.
            // This is important so that we do not try to run the following reload logic twice.
            wait_for_other_thread_to_finish_panicking();

            report(trace_str_buf.slice());

            // At this point, the crash handler has performed it's job. Reset the segfault handler
            // so that a crash will actually crash. We need this because we want the process to
            // exit with a signal, and allow tools to be able to gather core dumps.
            //
            // This is done so late (in comparison to the Zig Standard Library's panic handler)
            // because if multiple threads segfault (more often the case on Windows), we don't
            // want another thread to interrupt the crashing of the first one.
            reset_segfault_handler();

            if bun_core::auto_reload_on_crash()
                // Do not reload if the panic arose FROM the reload function.
                && !bun_core::is_process_reload_in_progress_on_another_thread()
            {
                // attempt to prevent a double panic
                bun_core::set_auto_reload_on_crash(false);

                Output::pretty_errorln(
                    "<d>--- Bun is auto-restarting due to crash <d>[time: <b>{}<r><d>] ---<r>",
                    format_args!("{}", bun_core::time::milli_timestamp().max(0)),
                );
                Output::flush();

                // TODO(port): comptime assert void == @TypeOf(bun.reloadProcess(...))
                bun_core::reload_process(false, true);
            }
        }
        t @ (1 | 2) => {
            if t == 1 {
                PANIC_STAGE.with(|s| s.set(2));

                reset_segfault_handler();
                Output::flush();
            }
            PANIC_STAGE.with(|s| s.set(3));

            // A panic happened while trying to print a previous panic message,
            // we're still holding the mutex but that's fine as we're going to
            // call abort()
            let stderr = &mut bun_sys::stderr_writer();
            if write!(stderr, "\npanic: {}\n", reason).is_err() { bun_sys::posix::abort(); }
            if write!(stderr, "panicked during a panic. Aborting.\n").is_err() { bun_sys::posix::abort(); }
        }
        3 => {
            // Panicked while printing "Panicked during a panic."
            PANIC_STAGE.with(|s| s.set(4));
        }
        _ => {
            // Panicked or otherwise looped into the panic handler while trying to exit.
            bun_sys::posix::abort();
        }
    }

    crash();
}

/// This is called when `main` returns a Zig error.
/// We don't want to treat it as a crash under certain error codes.
pub fn handle_root_error(err: bun_core::Error, error_return_trace: Option<&StackTrace>) -> ! {
    let mut show_trace = Environment::SHOW_CRASH_TRACE;

    // Match against interned error consts (see PORTING.md §Idiom map: catch |e| switch (e))
    if err == bun_core::err!("OutOfMemory") {
        bun_core::out_of_memory();
    } else if err == bun_core::err!("InvalidArgument")
        || err == bun_core::err!("Invalid Bunfig")
        || err == bun_core::err!("InstallFailed")
    {
        if !show_trace {
            Global::exit(1);
        }
    } else if err == bun_core::err!("SyntaxError") {
        Output::err("SyntaxError", "An error occurred while parsing code", format_args!(""));
    } else if err == bun_core::err!("CurrentWorkingDirectoryUnlinked") {
        Output::err_generic(
            "The current working directory was deleted, so that command didn't work. Please cd into a different directory and try again.",
            format_args!(""),
        );
    } else if err == bun_core::err!("SystemFdQuotaExceeded") {
        #[cfg(unix)]
        {
            let limit = bun_sys::posix::getrlimit(bun_sys::posix::RLIMIT_NOFILE).ok().map(|l| l.cur);
            #[cfg(target_os = "macos")]
            {
                Output::pretty_error(
                    "<r><red>error<r>: Your computer ran out of file descriptors <d>(<red>SystemFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>sudo launchctl limit maxfiles 2147483646<r>\n  <cyan>ulimit -n 2147483646<r>\n\nThat will only work until you reboot.\n",
                    format_args!("{}", bun_fmt::nullable_fallback(limit, "<unknown>")),
                );
            }
            #[cfg(target_os = "freebsd")]
            {
                Output::pretty_error(
                    "\n<r><red>error<r>: Your computer ran out of file descriptors <d>(<red>SystemFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>sudo sysctl kern.maxfiles=2147483646 kern.maxfilesperproc=2147483646<r>\n  <cyan>ulimit -n 2147483646<r>\n\nTo persist across reboots, add to /etc/sysctl.conf and edit /etc/login.conf.\n",
                    format_args!("{}", bun_fmt::nullable_fallback(limit, "<unknown>")),
                );
            }
            #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
            {
                Output::pretty_error(
                    "\n<r><red>error<r>: Your computer ran out of file descriptors <d>(<red>SystemFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>sudo echo -e \"\\nfs.file-max=2147483646\\n\" >> /etc/sysctl.conf<r>\n  <cyan>sudo sysctl -p<r>\n  <cyan>ulimit -n 2147483646<r>\n",
                    format_args!("{}", bun_fmt::nullable_fallback(limit, "<unknown>")),
                );

                if let Some(user) = env_var::USER::get() {
                    if !user.is_empty() {
                        Output::pretty_error(
                            "\nIf that still doesn't work, you may need to add these lines to /etc/security/limits.conf:\n\n <cyan>{} soft nofile 2147483646<r>\n <cyan>{} hard nofile 2147483646<r>\n",
                            format_args!("{0} {0}", bstr::BStr::new(user)),
                            // TODO(port): Zig prints `user` twice with separate {s} substitutions
                        );
                    }
                }
            }
        }
        #[cfg(not(unix))]
        {
            Output::pretty_error(
                "<r><red>error<r>: Your computer ran out of file descriptors <d>(<red>SystemFdQuotaExceeded<r><d>)<r>",
                format_args!(""),
            );
        }
    } else if err == bun_core::err!("ProcessFdQuotaExceeded") {
        #[cfg(unix)]
        {
            let limit = bun_sys::posix::getrlimit(bun_sys::posix::RLIMIT_NOFILE).ok().map(|l| l.cur);
            #[cfg(target_os = "macos")]
            {
                Output::pretty_error(
                    "\n<r><red>error<r>: bun ran out of file descriptors <d>(<red>ProcessFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>ulimit -n 2147483646<r>\n\nYou may also need to run:\n\n  <cyan>sudo launchctl limit maxfiles 2147483646<r>\n",
                    format_args!("{}", bun_fmt::nullable_fallback(limit, "<unknown>")),
                );
            }
            #[cfg(target_os = "freebsd")]
            {
                Output::pretty_error(
                    "\n<r><red>error<r>: bun ran out of file descriptors <d>(<red>ProcessFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>ulimit -n 2147483646<r>\n  <cyan>sudo sysctl kern.maxfilesperproc=2147483646<r>\n",
                    format_args!("{}", bun_fmt::nullable_fallback(limit, "<unknown>")),
                );
            }
            #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
            {
                Output::pretty_error(
                    "\n<r><red>error<r>: bun ran out of file descriptors <d>(<red>ProcessFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>ulimit -n 2147483646<r>\n\nThat will only work for the current shell. To fix this for the entire system, run:\n\n  <cyan>sudo echo -e \"\\nfs.file-max=2147483646\\n\" >> /etc/sysctl.conf<r>\n  <cyan>sudo sysctl -p<r>\n",
                    format_args!("{}", bun_fmt::nullable_fallback(limit, "<unknown>")),
                );

                if let Some(user) = env_var::USER::get() {
                    if !user.is_empty() {
                        Output::pretty_error(
                            "\nIf that still doesn't work, you may need to add these lines to /etc/security/limits.conf:\n\n <cyan>{} soft nofile 2147483646<r>\n <cyan>{} hard nofile 2147483646<r>\n",
                            format_args!("{0} {0}", bstr::BStr::new(user)),
                        );
                    }
                }
            }
        }
        #[cfg(not(unix))]
        {
            Output::pretty_errorln(
                "<r><red>error<r>: bun ran out of file descriptors <d>(<red>ProcessFdQuotaExceeded<r><d>)<r>",
                format_args!(""),
            );
        }
    } else if err == bun_core::err!("NotOpenForReading") || err == bun_core::err!("Unexpected") {
        // The usage of `unreachable` in Zig's std.posix may cause the file descriptor problem to show up as other errors
        #[cfg(unix)]
        {
            let limit = bun_sys::posix::getrlimit(bun_sys::posix::RLIMIT_NOFILE)
                .unwrap_or(unsafe { core::mem::zeroed() });
            // SAFETY: all-zero is a valid rlimit (POD struct of integers)

            if limit.cur > 0 && limit.cur < (8192 * 2) {
                Output::pretty_error(
                    "\n<r><red>error<r>: An unknown error occurred, possibly due to low max file descriptors <d>(<red>Unexpected<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>ulimit -n 2147483646<r>\n",
                    format_args!("{}", limit.cur),
                );

                #[cfg(target_os = "linux")]
                {
                    if let Some(user) = env_var::USER::get() {
                        if !user.is_empty() {
                            Output::pretty_error(
                                "\nIf that still doesn't work, you may need to add these lines to /etc/security/limits.conf:\n\n <cyan>{} soft nofile 2147483646<r>\n <cyan>{} hard nofile 2147483646<r>\n",
                                format_args!("{0} {0}", bstr::BStr::new(user)),
                            );
                        }
                    }
                }
                #[cfg(target_os = "macos")]
                {
                    Output::pretty_error(
                        "\nIf that still doesn't work, you may need to run:\n\n  <cyan>sudo launchctl limit maxfiles 2147483646<r>\n",
                        format_args!(""),
                    );
                }
            } else {
                Output::err_generic(
                    "An unknown error occurred <d>(<red>{}<r><d>)<r>",
                    format_args!("{}", err.name()),
                );
                show_trace = true;
            }
        }
        #[cfg(not(unix))]
        {
            Output::err_generic(
                "An unknown error occurred <d>(<red>{}<r><d>)<r>",
                format_args!("{}", err.name()),
            );
            show_trace = true;
        }
    } else if err == bun_core::err!("ENOENT") || err == bun_core::err!("FileNotFound") {
        Output::err(
            "ENOENT",
            "Bun could not find a file, and the code that produces this error is missing a better error.",
            format_args!(""),
        );
    } else if err == bun_core::err!("MissingPackageJSON") {
        Output::err_generic(
            "Bun could not find a package.json file to install from",
            format_args!(""),
        );
        Output::note("Run \"bun init\" to initialize a project", format_args!(""));
    } else {
        Output::err_generic(
            if Environment::SHOW_CRASH_TRACE {
                "'main' returned <red>error.{}<r>"
            } else {
                "An internal error occurred (<red>{}<r>)"
            },
            format_args!("{}", err.name()),
        );
        show_trace = true;
    }

    if show_trace {
        // SAFETY: single-threaded write on the crash/exit path; VERBOSE_ERROR_TRACE is only read on the same thread before process exit
        unsafe { VERBOSE_ERROR_TRACE = show_trace; }
        handle_error_return_trace_extra::<true>(err, error_return_trace);
    }

    Global::exit(1);
}

#[cold]
pub fn panic_impl(msg: &[u8], error_return_trace: Option<&StackTrace>, begin_addr: Option<usize>) -> ! {
    crash_handler(
        if msg == b"reached unreachable code" {
            CrashReason::Unreachable
        } else {
            // TODO(port): lifetime — Zig borrows msg; we transmute to &'static for the noreturn path.
            // SAFETY: process is about to abort; the borrow is never invalidated.
            CrashReason::Panic(unsafe { core::mem::transmute::<&[u8], &'static [u8]>(msg) })
        },
        error_return_trace,
        Some(begin_addr.unwrap_or_else(|| bun_debug::return_address())),
    );
}

fn panic_builtin(msg: &[u8], error_return_trace: Option<&StackTrace>, begin_addr: Option<usize>) -> ! {
    // TODO(port): std.debug.panicImpl — fall back to Rust's std panic machinery
    debug::panic_impl(error_return_trace, begin_addr, msg);
}

pub const PANIC: fn(&[u8], Option<&StackTrace>, Option<usize>) -> ! = if ENABLE { panic_impl } else { panic_builtin };

pub fn report_base_url() -> &'static [u8] {
    static mut BASE_URL: Option<&'static [u8]> = None;
    // SAFETY: racy init is benign — worst case computes the same value twice
    unsafe {
        BASE_URL.unwrap_or_else(|| {
            let computed: &'static [u8] = 'computed: {
                if let Some(url) = env_var::BUN_CRASH_REPORT_URL::get() {
                    break 'computed strings::without_trailing_slash(url);
                }
                DEFAULT_REPORT_BASE_URL.as_bytes()
            };
            BASE_URL = Some(computed);
            computed
        })
    }
}

const ARCH_DISPLAY_STRING: &str = if cfg!(target_arch = "aarch64") {
    if cfg!(target_os = "macos") { "Silicon" } else { "arm64" }
} else {
    "x64"
};

// TODO(port): std.fmt.comptimePrint — use const_format::formatcp! in Phase B
const METADATA_VERSION_LINE: &str = const_format::formatcp!(
    "Bun {}v{} {} {}{}\n",
    if cfg!(debug_assertions) { "Debug " } else if Environment::IS_CANARY { "Canary " } else { "" },
    Global::PACKAGE_JSON_VERSION_WITH_SHA,
    Environment::OS_DISPLAY_STRING,
    ARCH_DISPLAY_STRING,
    if Environment::BASELINE { " (baseline)" } else { "" },
);

#[cfg(unix)]
extern "C" fn handle_segfault_posix(sig: i32, info: *const bun_sys::posix::siginfo_t, _: *const c_void) {
    // SAFETY: kernel provides a valid siginfo_t
    let addr: usize = unsafe {
        #[cfg(target_os = "linux")]
        { (*info).fields.sigfault.addr as usize }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        { (*info).addr as usize }
    };

    crash_handler(
        match sig {
            bun_sys::posix::SIGSEGV => CrashReason::SegmentationFault(addr),
            bun_sys::posix::SIGILL => CrashReason::IllegalInstruction(addr),
            bun_sys::posix::SIGBUS => CrashReason::BusError(addr),
            bun_sys::posix::SIGFPE => CrashReason::FloatingPointError(addr),
            // we do not register this handler for other signals
            _ => unreachable!(),
        },
        None,
        Some(bun_debug::return_address()),
    );
}

#[cfg(unix)]
static mut DID_REGISTER_SIGALTSTACK: bool = false;
#[cfg(unix)]
static mut SIGALTSTACK: [u8; 512 * 1024] = [0; 512 * 1024];

#[cfg(unix)]
fn update_posix_segfault_handler(act: Option<&mut bun_sys::posix::Sigaction>) -> Result<(), bun_core::Error> {
    if let Some(act_) = act.as_deref_mut() {
        // SAFETY: single global; only mutated during signal-handler setup
        if unsafe { !DID_REGISTER_SIGALTSTACK } {
            let stack = bun_sys::c::stack_t {
                flags: 0,
                // SAFETY: SIGALTSTACK is a process-lifetime static byte buffer; taking its len requires only a shared ref to a `static mut`
                size: unsafe { SIGALTSTACK.len() },
                // SAFETY: SIGALTSTACK is a process-lifetime static byte buffer; the kernel only writes to it during signal delivery (no Rust aliasing)
                sp: unsafe { SIGALTSTACK.as_mut_ptr().cast() },
            };

            // SAFETY: stack points to a valid static buffer
            if unsafe { bun_sys::c::sigaltstack(&stack, core::ptr::null_mut()) } == 0 {
                act_.flags |= bun_sys::posix::SA_ONSTACK;
                unsafe { DID_REGISTER_SIGALTSTACK = true; }
            }
        }
    }

    let act_ptr = act.map(|a| a as *const _).unwrap_or(core::ptr::null());
    // SAFETY: valid Sigaction pointer or null
    unsafe {
        bun_sys::posix::sigaction(bun_sys::posix::SIGSEGV, act_ptr, core::ptr::null_mut());
        bun_sys::posix::sigaction(bun_sys::posix::SIGILL, act_ptr, core::ptr::null_mut());
        bun_sys::posix::sigaction(bun_sys::posix::SIGBUS, act_ptr, core::ptr::null_mut());
        bun_sys::posix::sigaction(bun_sys::posix::SIGFPE, act_ptr, core::ptr::null_mut());
    }
    Ok(())
}

#[cfg(windows)]
static mut WINDOWS_SEGFAULT_HANDLE: Option<bun_sys::windows::HANDLE> = None;

#[cfg(unix)]
pub fn reset_on_posix() {
    if Environment::ENABLE_ASAN {
        return;
    }
    let mut act = bun_sys::posix::Sigaction {
        handler: bun_sys::posix::SigactionHandler::Sigaction(handle_segfault_posix),
        mask: bun_sys::posix::sigemptyset(),
        flags: bun_sys::posix::SA_SIGINFO | bun_sys::posix::SA_RESTART | bun_sys::posix::SA_RESETHAND,
    };
    let _ = update_posix_segfault_handler(Some(&mut act));
}

pub fn init() {
    if !ENABLE {
        return;
    }
    #[cfg(windows)]
    {
        // SAFETY: AddVectoredExceptionHandler is a valid Win32 call
        unsafe {
            WINDOWS_SEGFAULT_HANDLE = Some(bun_sys::windows::kernel32::AddVectoredExceptionHandler(0, handle_segfault_windows));
        }
    }
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "freebsd"))]
    {
        reset_on_posix();
    }
    // TODO(port): wasm @compileError("TODO")
}

pub fn reset_segfault_handler() {
    if !ENABLE {
        return;
    }
    if Environment::ENABLE_ASAN {
        return;
    }

    #[cfg(windows)]
    {
        // SAFETY: WINDOWS_SEGFAULT_HANDLE is only mutated on the crash path
        if let Some(handle) = unsafe { WINDOWS_SEGFAULT_HANDLE } {
            let rc = unsafe { bun_sys::windows::kernel32::RemoveVectoredExceptionHandler(handle) };
            unsafe { WINDOWS_SEGFAULT_HANDLE = None; }
            debug_assert!(rc != 0);
        }
        return;
    }

    #[cfg(unix)]
    {
        let mut act = bun_sys::posix::Sigaction {
            handler: bun_sys::posix::SigactionHandler::Handler(bun_sys::posix::SIG_DFL),
            mask: bun_sys::posix::sigemptyset(),
            flags: 0,
        };
        // To avoid a double-panic, do nothing if an error happens here.
        let _ = update_posix_segfault_handler(Some(&mut act));
    }
}

#[cfg(windows)]
pub extern "system" fn handle_segfault_windows(info: *mut bun_sys::windows::EXCEPTION_POINTERS) -> c_long {
    // SAFETY: kernel provides a valid EXCEPTION_POINTERS
    let info = unsafe { &*info };
    let reason = match unsafe { (*info.ExceptionRecord).ExceptionCode } {
        bun_sys::windows::EXCEPTION_DATATYPE_MISALIGNMENT => CrashReason::DatatypeMisalignment,
        bun_sys::windows::EXCEPTION_ACCESS_VIOLATION => {
            CrashReason::SegmentationFault(unsafe { (*info.ExceptionRecord).ExceptionInformation[1] })
        }
        bun_sys::windows::EXCEPTION_ILLEGAL_INSTRUCTION => {
            CrashReason::IllegalInstruction(unsafe { (*info.ContextRecord).get_regs().ip })
        }
        bun_sys::windows::EXCEPTION_STACK_OVERFLOW => CrashReason::StackOverflow,

        // exception used for thread naming
        // https://learn.microsoft.com/en-us/previous-versions/visualstudio/visual-studio-2017/debugger/how-to-set-a-thread-name-in-native-code?view=vs-2017#set-a-thread-name-by-throwing-an-exception
        // related commit
        // https://github.com/go-delve/delve/pull/1384
        bun_sys::windows::MS_VC_EXCEPTION => return bun_sys::windows::EXCEPTION_CONTINUE_EXECUTION,

        _ => return bun_sys::windows::EXCEPTION_CONTINUE_SEARCH,
    };
    crash_handler(
        reason,
        None,
        Some(unsafe { (*info.ExceptionRecord).ExceptionAddress } as usize),
    );
}

#[cfg(all(target_os = "linux", target_env = "gnu"))]
unsafe extern "C" {
    fn gnu_get_libc_version() -> *const c_char;
}

// Only populated after JSC::VM::tryCreate
#[unsafe(no_mangle)]
pub static mut Bun__reported_memory_size: usize = 0;

pub fn print_metadata(writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
    #[cfg(debug_assertions)]
    {
        if Output::is_ai_agent() {
            return Ok(());
        }
    }

    if Output::enable_ansi_colors_stderr() {
        writer.write_all(Output::pretty_fmt("<r><d>", true))?;
    }

    let mut is_ancient_cpu = false;

    writer.write_all(METADATA_VERSION_LINE.as_bytes())?;
    {
        let platform = bun_analytics::GenerateHeader::GeneratePlatform::for_os();
        let cpu_features = CPUFeatures::get();
        #[cfg(all(target_os = "linux", target_env = "gnu"))]
        {
            // SAFETY: gnu_get_libc_version returns a static NUL-terminated string or null
            let version = unsafe { gnu_get_libc_version() };
            let version_bytes: &[u8] = if version.is_null() {
                b""
            } else {
                unsafe { core::ffi::CStr::from_ptr(version) }.to_bytes()
            };
            let kernel_version = bun_analytics::GenerateHeader::GeneratePlatform::kernel_version();
            if platform.os == bun_analytics::PlatformOs::Wsl {
                write!(writer, "WSL Kernel v{}.{}.{} | glibc v{}\n", kernel_version.major, kernel_version.minor, kernel_version.patch, bstr::BStr::new(version_bytes))?;
            } else {
                write!(writer, "Linux Kernel v{}.{}.{} | glibc v{}\n", kernel_version.major, kernel_version.minor, kernel_version.patch, bstr::BStr::new(version_bytes))?;
            }
        }
        #[cfg(all(target_os = "linux", target_env = "musl"))]
        {
            let kernel_version = bun_analytics::GenerateHeader::GeneratePlatform::kernel_version();
            write!(writer, "Linux Kernel v{}.{}.{} | musl\n", kernel_version.major, kernel_version.minor, kernel_version.patch)?;
        }
        #[cfg(target_os = "android")]
        {
            let kernel_version = bun_analytics::GenerateHeader::GeneratePlatform::kernel_version();
            write!(writer, "Android Kernel v{}.{}.{} | bionic\n", kernel_version.major, kernel_version.minor, kernel_version.patch)?;
        }
        #[cfg(target_os = "freebsd")]
        {
            write!(writer, "FreeBSD Kernel v{}\n", bstr::BStr::new(&platform.version))?;
        }
        #[cfg(target_os = "macos")]
        {
            write!(writer, "macOS v{}\n", bstr::BStr::new(&platform.version))?;
        }
        #[cfg(windows)]
        {
            // TODO(port): std.zig.system.windows.detectRuntimeVersion()
            write!(writer, "Windows v{}\n", bun_sys::windows::detect_runtime_version())?;
        }

        #[cfg(target_arch = "x86_64")]
        {
            is_ancient_cpu = !cpu_features.has_any_avx();
        }

        if !cpu_features.is_empty() {
            write!(writer, "CPU: {}\n", cpu_features)?;
        }

        write!(writer, "Args: ")?;
        let mut arg_chars_left: usize = if cfg!(debug_assertions) { 4096 } else { 196 };
        for (i, arg) in bun_core::argv().iter().enumerate() {
            if i != 0 {
                writer.write_all(b" ")?;
            }
            bun_fmt::quoted_writer(writer, &arg[0..arg.len().min(arg_chars_left)])?;
            arg_chars_left = arg_chars_left.saturating_sub(arg.len());
            if arg_chars_left == 0 {
                writer.write_all(b"...")?;
                break;
            }
        }
    }
    write!(writer, "\n{}", bun_analytics::Features::formatter())?;

    if bun_core::USE_MIMALLOC {
        let mut elapsed_msecs: usize = 0;
        let mut user_msecs: usize = 0;
        let mut system_msecs: usize = 0;
        let mut current_rss: usize = 0;
        let mut peak_rss: usize = 0;
        let mut current_commit: usize = 0;
        let mut peak_commit: usize = 0;
        let mut page_faults: usize = 0;
        // SAFETY: all out-pointers are valid
        unsafe {
            bun_alloc::mimalloc::mi_process_info(
                &mut elapsed_msecs,
                &mut user_msecs,
                &mut system_msecs,
                &mut current_rss,
                &mut peak_rss,
                &mut current_commit,
                &mut peak_commit,
                &mut page_faults,
            );
        }
        write!(writer, "Elapsed: {}ms | User: {}ms | Sys: {}ms\n", elapsed_msecs, user_msecs, system_msecs)?;

        // TODO(port): {B:<3.2} byte-size formatting — use bun_fmt::bytes()
        write!(
            writer,
            "RSS: {} | Peak: {} | Commit: {} | Faults: {}",
            bun_fmt::bytes(current_rss),
            bun_fmt::bytes(peak_rss),
            bun_fmt::bytes(current_commit),
            page_faults,
        )?;

        // SAFETY: read-only access to exported global
        if unsafe { Bun__reported_memory_size } > 0 {
            write!(writer, " | Machine: {}", bun_fmt::bytes(unsafe { Bun__reported_memory_size }))?;
        }

        writer.write_all(b"\n")?;
    }

    if Output::enable_ansi_colors_stderr() {
        writer.write_all(Output::pretty_fmt("<r>", true))?;
    }
    writer.write_all(b"\n")?;

    #[cfg(target_arch = "x86_64")]
    {
        if is_ancient_cpu {
            writer.write_all(b"CPU lacks AVX support. Please consider upgrading to a newer CPU.\n")?;
        }
    }
    let _ = is_ancient_cpu;
    Ok(())
}

fn wait_for_other_thread_to_finish_panicking() {
    if PANICKING.fetch_sub(1, Ordering::SeqCst) != 1 {
        // Another thread is panicking, wait for the last one to finish
        // and call abort()
        // TODO(port): builtin.single_threaded → unreachable

        // Sleep forever without hammering the CPU
        let futex = AtomicU32::new(0);
        loop {
            bun_threading::Futex::wait_forever(&futex, 0);
        }
    }
}

/// This is to be called by any thread that is attempting to exit the process.
/// If another thread is panicking, this will sleep this thread forever, under
/// the assumption that the crash handler will terminate the program.
///
/// There have been situations in the past where a bundler thread starts
/// panicking, but the main thread ends up marking a test as passing and then
/// exiting with code zero before the crash handler can finish the crash.
pub fn sleep_forever_if_another_thread_is_crashing() {
    if PANICKING.load(Ordering::Acquire) > 0 {
        // Sleep forever without hammering the CPU
        let futex = AtomicU32::new(0);
        loop {
            bun_threading::Futex::wait_forever(&futex, 0);
        }
    }
}

/// Each platform is encoded as a single character. It is placed right after the
/// slash after the version, so someone just reading the trace string can tell
/// what platform it came from. L, M, and W are for Linux, macOS, and Windows,
/// with capital letters indicating aarch64, lowercase indicating x86_64.
///
/// eg: 'https://bun.report/1.1.3/we04c...
///                               ^ this tells you it is windows x86_64
///
/// Baseline gets a weirder encoding of a mix of b and e.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Platform {
    LinuxX8664 = b'l',
    LinuxX8664Baseline = b'B',
    LinuxAarch64 = b'L',

    MacX8664Baseline = b'b',
    MacX8664 = b'm',
    MacAarch64 = b'M',

    WindowsX8664 = b'w',
    WindowsX8664Baseline = b'e',
    WindowsAarch64 = b'W',

    FreebsdX8664 = b'f',
    FreebsdX8664Baseline = b'g',
    FreebsdAarch64 = b'F',
}

impl Platform {
    // TODO(port): Zig builds this via @tagName(os) ++ "_" ++ @tagName(arch) ++ baseline.
    // Rust cannot concat ident names at const time without a proc-macro; spell out the cfg matrix.
    const CURRENT: Platform = {
        #[cfg(all(target_os = "linux", target_arch = "x86_64", not(feature = "baseline")))]
        { Platform::LinuxX8664 }
        #[cfg(all(target_os = "linux", target_arch = "x86_64", feature = "baseline"))]
        { Platform::LinuxX8664Baseline }
        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
        { Platform::LinuxAarch64 }
        #[cfg(all(target_os = "macos", target_arch = "x86_64", not(feature = "baseline")))]
        { Platform::MacX8664 }
        #[cfg(all(target_os = "macos", target_arch = "x86_64", feature = "baseline"))]
        { Platform::MacX8664Baseline }
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        { Platform::MacAarch64 }
        #[cfg(all(windows, target_arch = "x86_64", not(feature = "baseline")))]
        { Platform::WindowsX8664 }
        #[cfg(all(windows, target_arch = "x86_64", feature = "baseline"))]
        { Platform::WindowsX8664Baseline }
        #[cfg(all(windows, target_arch = "aarch64"))]
        { Platform::WindowsAarch64 }
        #[cfg(all(target_os = "freebsd", target_arch = "x86_64", not(feature = "baseline")))]
        { Platform::FreebsdX8664 }
        #[cfg(all(target_os = "freebsd", target_arch = "x86_64", feature = "baseline"))]
        { Platform::FreebsdX8664Baseline }
        #[cfg(all(target_os = "freebsd", target_arch = "aarch64"))]
        { Platform::FreebsdAarch64 }
    };
}

/// Note to the decoder on how to process this string. This ensures backwards
/// compatibility with older versions of the tracestring.
///
/// '1' - original. uses 7 char hash with VLQ encoded stack-frames
/// '2' - same as '1' but this build is known to be a canary build
const VERSION_CHAR: &str = if Environment::IS_CANARY { "2" } else { "1" };

const GIT_SHA: &str = if Environment::GIT_SHA.len() > 0 {
    // TODO(port): const slice [0..7] — use const_format or a build-time const
    const_format::str_index!(Environment::GIT_SHA, ..7)
} else {
    "unknown"
};

struct StackLine {
    address: i32,
    // None -> from bun.exe
    object: Option<Box<[u8]>>,
    // TODO(port): Zig stores a borrowed slice into caller's `name_bytes`; using Box<[u8]> here
    // since the only caller writes into a stack buffer and the value is consumed immediately.
}

impl StackLine {
    /// `None` implies the trace is not known.
    pub fn from_address(addr: usize, name_bytes: &mut [u8]) -> Option<StackLine> {
        #[cfg(windows)]
        {
            let module = bun_sys::windows::get_module_handle_from_address(addr)?;

            let base_address = module as usize;

            let mut temp: [u16; 512] = [0; 512];
            let name = bun_sys::windows::get_module_name_w(module, &mut temp)?;

            let image_path = bun_sys::windows::exe_path_w();

            return Some(StackLine {
                // To remap this, `pdb-addr2line --exe bun.pdb 0x123456`
                address: i32::try_from(addr - base_address).unwrap(),

                object: if name != image_path {
                    let basename_start = name.iter().rposition(|&c| c == b'\\' as u16 || c == b'/' as u16)
                        // skip the last slash
                        .map(|i| i + 1)
                        .unwrap_or(0);
                    let basename = &name[basename_start..];
                    strings::convert_utf16_to_utf8_in_buffer(name_bytes, basename)
                        .ok()
                        .map(|s| Box::<[u8]>::from(s))
                } else {
                    None
                },
            });
        }
        #[cfg(target_os = "macos")]
        {
            // This code is slightly modified from std.debug.DebugInfo.lookupModuleNameDyld
            // https://github.com/ziglang/zig/blob/215de3ee67f75e2405c177b262cb5c1cd8c8e343/lib/std/debug.zig#L1783
            let address = if addr == 0 { 0 } else { addr - 1 };

            // SAFETY: dyld APIs are safe to call
            let image_count = unsafe { bun_sys::c::_dyld_image_count() };

            let mut i: u32 = 0;
            while i < image_count {
                let header = unsafe { bun_sys::c::_dyld_get_image_header(i) };
                if header.is_null() { i += 1; continue; }
                let base_address = header as usize;
                if address < base_address { i += 1; continue; }
                // This 'slide' is the ASLR offset. Subtract from `address` to get a stable address
                let vmaddr_slide = unsafe { bun_sys::c::_dyld_get_image_vmaddr_slide(i) } as usize;

                // SAFETY: header points to a valid mach_header_64
                let header_ref = unsafe { &*header };
                let mut it = bun_sys::macho::LoadCommandIterator {
                    ncmds: header_ref.ncmds,
                    // SAFETY: load commands follow the mach header in memory
                    buffer: unsafe {
                        core::slice::from_raw_parts(
                            (header as *const u8).add(core::mem::size_of::<bun_sys::macho::mach_header_64>()),
                            header_ref.sizeofcmds as usize,
                        )
                    },
                };

                while let Some(cmd) = it.next() {
                    match cmd.cmd() {
                        bun_sys::macho::LC_SEGMENT_64 => {
                            let segment_cmd = cmd.cast::<bun_sys::macho::segment_command_64>().unwrap();
                            if segment_cmd.seg_name() != b"__TEXT" { continue; }

                            let original_address = address - vmaddr_slide;
                            let seg_start = segment_cmd.vmaddr as usize;
                            let seg_end = seg_start + segment_cmd.vmsize as usize;
                            if original_address >= seg_start && original_address < seg_end {
                                // Subtract ASLR value for stable address
                                let stable_address: usize = address - vmaddr_slide;

                                if i == 0 {
                                    let image_relative_address = stable_address - seg_start;
                                    if image_relative_address > i32::MAX as usize {
                                        return None;
                                    }

                                    // To remap this, you have to add the offset (which is going to be 0x100000000),
                                    // and then you can run it through `llvm-symbolizer --obj bun-with-symbols 0x123456`
                                    // The reason we are subtracting this known offset is mostly just so that we can
                                    // fit it within a signed 32-bit integer. The VLQs will be shorter too.
                                    return Some(StackLine {
                                        object: None,
                                        address: i32::try_from(image_relative_address).unwrap(),
                                    });
                                } else {
                                    // these libraries are not interesting, mark as unknown
                                    return None;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                i += 1;
            }

            let _ = name_bytes;
            return None;
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            // This code is slightly modified from std.debug.DebugInfo.lookupModuleDl
            // https://github.com/ziglang/zig/blob/215de3ee67f75e2405c177b262cb5c1cd8c8e343/lib/std/debug.zig#L2024
            struct Ctx {
                // Input
                address: usize,
                i: usize,
                // Output
                result: Option<StackLine>,
            }
            let mut ctx = Ctx { address: addr.saturating_sub(1), i: 0, result: None };

            extern "C" fn callback(info: *const bun_sys::posix::dl_phdr_info, _size: usize, context: *mut c_void) -> c_int {
                // SAFETY: dl_iterate_phdr passes a valid info pointer; context is &mut Ctx
                let context = unsafe { &mut *(context as *mut Ctx) };
                let info = unsafe { &*info };
                let _guard = scopeguard::guard((), |_| context.i += 1);
                // PORT NOTE: reshaped for borrowck — defer context.i += 1

                if context.address < info.addr as usize { return 0; }
                // SAFETY: phdr points to phnum entries
                let phdrs = unsafe { core::slice::from_raw_parts(info.phdr, info.phnum as usize) };
                for phdr in phdrs {
                    if phdr.p_type != bun_sys::elf::PT_LOAD { continue; }

                    // Overflowing addition is used to handle the case of VSDOs
                    // having a p_vaddr = 0xffffffffff700000
                    let seg_start = (info.addr as usize).wrapping_add(phdr.p_vaddr as usize);
                    let seg_end = seg_start + phdr.p_memsz as usize;
                    if context.address >= seg_start && context.address < seg_end {
                        // const name = bun.sliceTo(info.name, 0) orelse "";
                        context.result = Some(StackLine {
                            address: i32::try_from(context.address - info.addr as usize).unwrap(),
                            object: None,
                        });
                        return 1; // error.Found → stop iteration
                    }
                }
                0
            }

            // SAFETY: ctx outlives the dl_iterate_phdr call
            unsafe {
                bun_sys::posix::dl_iterate_phdr(callback, &mut ctx as *mut Ctx as *mut c_void);
            }

            let _ = name_bytes;
            return ctx.result;
        }
    }

    pub fn write_encoded(self_: Option<&StackLine>, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        let Some(known) = self_ else {
            writer.write_all(b"_")?;
            return Ok(());
        };

        if let Some(object) = &known.object {
            VLQ::encode(1).write_to(writer)?;
            VLQ::encode(i32::try_from(object.len()).unwrap()).write_to(writer)?;
            writer.write_all(object)?;
        }

        VLQ::encode(known.address).write_to(writer)?;
        Ok(())
    }

    pub fn write_decoded(self_: Option<&StackLine>, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        let Some(known) = self_ else {
            write!(writer, "???")?;
            return Ok(());
        };
        write!(writer, "{}", known)?;
        Ok(())
    }
}

impl fmt::Display for StackLine {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let addr_display: u64 = if cfg!(target_os = "macos") {
            self.address as u64 + 0x100000000
        } else {
            self.address as u64
        };
        write!(
            writer,
            "0x{:x}{}{}",
            addr_display,
            if self.object.is_some() { " @ " } else { "" },
            self.object.as_deref().map(bstr::BStr::new).unwrap_or(bstr::BStr::new(b"")),
        )
    }
}

struct TraceString<'a> {
    trace: &'a StackTrace,
    reason: CrashReason,
    action: TraceStringAction,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TraceStringAction {
    /// Open a pre-filled GitHub issue with the expanded trace
    OpenIssue,
    /// View the trace with nothing else
    ViewTrace,
}

impl<'a> fmt::Display for TraceString<'a> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        // TODO(port): encode_trace_string takes a byte writer; bridge fmt::Formatter via adapter
        let _ = encode_trace_string(self, &mut bun_io::FmtAdapter(writer));
        Ok(())
    }
}

fn encode_trace_string(opts: &TraceString<'_>, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
    writer.write_all(report_base_url())?;
    writer.write_all(b"/")?;
    writer.write_all(Environment::VERSION_STRING.as_bytes())?;
    writer.write_all(b"/")?;
    writer.write_all(&[Platform::CURRENT as u8])?;
    writer.write_byte(cli_state::cmd_char().unwrap_or(b'_'))?;

    writer.write_all(VERSION_CHAR.as_bytes())?;
    writer.write_all(GIT_SHA.as_bytes())?;

    let packed_features = bun_analytics::packed_features();
    // SAFETY: PackedFeatures is a packed struct(u64) → bitcast to u64
    write_u64_as_two_vlqs(writer, unsafe { core::mem::transmute::<_, u64>(packed_features) } as usize)?;

    let mut name_bytes: [u8; 1024] = [0; 1024];

    for &addr in &opts.trace.instruction_addresses()[0..opts.trace.index] {
        let line = StackLine::from_address(addr, &mut name_bytes);
        StackLine::write_encoded(line.as_ref(), writer)?;
    }

    writer.write_all(VLQ::ZERO.slice())?;

    // The following switch must be kept in sync with `bun.report`'s decoder implementation.
    match opts.reason {
        CrashReason::Panic(message) => {
            writer.write_byte(b'0')?;

            let mut compressed_bytes: [u8; 2048] = [0; 2048];
            let mut len: bun_zlib::uLong = compressed_bytes.len() as bun_zlib::uLong;
            // SAFETY: buffers and lengths are valid
            let ret: bun_zlib::ReturnCode = unsafe {
                core::mem::transmute(bun_zlib::compress2(
                    compressed_bytes.as_mut_ptr(),
                    &mut len,
                    message.as_ptr(),
                    u32::try_from(message.len()).unwrap() as bun_zlib::uLong,
                    9,
                ))
            };
            let compressed = match ret {
                bun_zlib::ReturnCode::Ok => &compressed_bytes[0..usize::try_from(len).unwrap()],
                // Insufficient memory.
                bun_zlib::ReturnCode::MemError => return Err(bun_core::err!("OutOfMemory")),
                // The buffer dest was not large enough to hold the compressed data.
                bun_zlib::ReturnCode::BufError => return Err(bun_core::err!("NoSpaceLeft")),
                // The level was not Z_DEFAULT_LEVEL, or was not between 0 and 9.
                // This is technically possible but impossible because we pass 9.
                bun_zlib::ReturnCode::StreamError => return Err(bun_core::err!("Unexpected")),
                _ => return Err(bun_core::err!("Unexpected")),
            };

            let mut b64_bytes: [u8; 2048] = [0; 2048];
            if bun_base64::encode_len(compressed) > b64_bytes.len() {
                return Err(bun_core::err!("NoSpaceLeft"));
            }
            let b64_len = bun_base64::encode(&mut b64_bytes, compressed);

            writer.write_all(bun_str::strings::trim_right(&b64_bytes[0..b64_len], b"="))?;
        }

        CrashReason::Unreachable => writer.write_byte(b'1')?,

        CrashReason::SegmentationFault(addr) => {
            writer.write_byte(b'2')?;
            write_u64_as_two_vlqs(writer, addr)?;
        }
        CrashReason::IllegalInstruction(addr) => {
            writer.write_byte(b'3')?;
            write_u64_as_two_vlqs(writer, addr)?;
        }
        CrashReason::BusError(addr) => {
            writer.write_byte(b'4')?;
            write_u64_as_two_vlqs(writer, addr)?;
        }
        CrashReason::FloatingPointError(addr) => {
            writer.write_byte(b'5')?;
            write_u64_as_two_vlqs(writer, addr)?;
        }

        CrashReason::DatatypeMisalignment => writer.write_byte(b'6')?,
        CrashReason::StackOverflow => writer.write_byte(b'7')?,

        CrashReason::ZigError(err) => {
            writer.write_byte(b'8')?;
            writer.write_all(err.name().as_bytes())?;
        }

        CrashReason::OutOfMemory => writer.write_byte(b'9')?,
    }

    if opts.action == TraceStringAction::ViewTrace {
        writer.write_all(b"/view")?;
    }
    Ok(())
}

pub fn write_u64_as_two_vlqs(writer: &mut impl bun_io::Write, addr: usize) -> Result<(), bun_core::Error> {
    // @bitCast(@as(u32, ...)) → reinterpret u32 as i32
    let first = VLQ::encode((((addr as u64) & 0xFFFFFFFF00000000) >> 32) as u32 as i32);
    let second = VLQ::encode(((addr as u64) & 0xFFFFFFFF) as u32 as i32);
    first.write_to(writer)?;
    second.write_to(writer)?;
    Ok(())
}

fn is_reporting_enabled() -> bool {
    // SAFETY: SUPPRESS_REPORTING is only mutated via suppress_reporting() before crash
    if unsafe { SUPPRESS_REPORTING } {
        return false;
    }

    // If trying to test the crash handler backend, implicitly enable reporting
    if let Some(value) = env_var::BUN_CRASH_REPORT_URL::get() {
        return !value.is_empty();
    }

    // Environment variable to specifically enable or disable reporting
    if let Some(enable_crash_reporting) = env_var::BUN_ENABLE_CRASH_REPORTING::get() {
        return enable_crash_reporting;
    }

    // Debug builds shouldn't report to the default url by default
    if cfg!(debug_assertions) {
        return false;
    }

    if Environment::ENABLE_ASAN {
        return false;
    }

    // Honor DO_NOT_TRACK
    if !bun_analytics::is_enabled() {
        return false;
    }

    if Environment::IS_CANARY {
        return true;
    }

    // Change in v1.1.10: enable crash reporter auto upload on macOS and Windows.
    if cfg!(target_os = "macos") || cfg!(windows) {
        return true;
    }

    false
}

/// Bun automatically reports crashes on Windows and macOS
///
/// These URLs contain no source code or personally-identifiable
/// information (PII). The stackframes point to Bun's open-source native code
/// (not user code), and are safe to share publicly and with the Bun team.
fn report(url: &[u8]) {
    if !is_reporting_enabled() {
        return;
    }

    #[cfg(windows)]
    {
        use bun_sys::windows;
        // SAFETY: all-zero is a valid PROCESS_INFORMATION (#[repr(C)] POD, no NonNull/NonZero fields)
        let mut process: windows::PROCESS_INFORMATION = unsafe { core::mem::zeroed() };
        let mut startup_info = windows::STARTUPINFOW {
            cb: core::mem::size_of::<windows::STARTUPINFOW>() as u32,
            lpReserved: core::ptr::null_mut(),
            lpDesktop: core::ptr::null_mut(),
            lpTitle: core::ptr::null_mut(),
            dwX: 0,
            dwY: 0,
            dwXSize: 0,
            dwYSize: 0,
            dwXCountChars: 0,
            dwYCountChars: 0,
            dwFillAttribute: 0,
            dwFlags: 0,
            wShowWindow: 0,
            cbReserved2: 0,
            lpReserved2: core::ptr::null_mut(),
            hStdInput: core::ptr::null_mut(),
            hStdOutput: core::ptr::null_mut(),
            hStdError: core::ptr::null_mut(),
            // .hStdInput = bun.FD.stdin().native(),
            // .hStdOutput = bun.FD.stdout().native(),
            // .hStdError = bun.FD.stderr().native(),
        };
        let mut cmd_line = BoundedArray::<u16, 4096>::new();
        cmd_line.append_slice_assume_capacity(bun_str::w!("powershell -ExecutionPolicy Bypass -Command \"try{Invoke-RestMethod -Uri '"));
        // PERF(port): was assume_capacity
        {
            let encoded = strings::convert_utf8_to_utf16_in_buffer(cmd_line.unused_capacity_slice_mut(), url);
            cmd_line.len += u32::try_from(encoded.len()).unwrap();
        }
        if cmd_line.append_slice(bun_str::w!("/ack'|out-null}catch{}\"")).is_err() { return; }
        if cmd_line.append(0).is_err() { return; }
        // SAFETY: we just wrote a NUL terminator at len-1
        let cmd_line_slice = &mut cmd_line.buffer_mut()[0..(cmd_line.len as usize - 1)];
        // TODO(port): need [:0] sentinel slice — pass raw pointer
        // SAFETY: all pointer args are either null or point to stack-local buffers/structs valid for the duration of the call; cmd_line is NUL-terminated above
        let spawn_result = unsafe {
            windows::kernel32::CreateProcessW(
                core::ptr::null(),
                cmd_line_slice.as_mut_ptr(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                1, // true
                0,
                core::ptr::null_mut(),
                core::ptr::null(),
                &mut startup_info,
                &mut process,
            )
        };

        // we don't care what happens with the process
        let _ = spawn_result;
    }
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "freebsd"))]
    {
        let mut buf = bun_paths::PathBuffer::uninit();
        let mut buf2 = bun_paths::PathBuffer::uninit();
        let Some(path_env) = env_var::PATH::get() else { return; };
        let Ok(cwd) = bun_core::getcwd(&mut buf2) else { return; };
        let Some(curl) = bun_core::which(&mut buf, path_env, cwd, b"curl") else { return; };
        let mut cmd_line = BoundedArray::<u8, 4096>::new();
        if cmd_line.append_slice(url).is_err() { return; }
        if cmd_line.append_slice(b"/ack").is_err() { return; }
        if cmd_line.append(0).is_err() { return; }

        let argv: [*const c_char; 4] = [
            curl.as_ptr().cast(),
            b"-fsSL\0".as_ptr().cast(),
            cmd_line.buffer().as_ptr().cast(),
            core::ptr::null(),
        ];
        // SAFETY: fork is async-signal-safe; we're already in the crash path
        let result = unsafe { bun_sys::c::fork() };
        match result {
            // child
            0 => {
                for i in 0..2 {
                    // SAFETY: closing stdin/stdout in child
                    unsafe { bun_sys::c::close(i); }
                }
                // SAFETY: argv is NUL-terminated array of NUL-terminated strings
                unsafe { bun_sys::c::execve(argv[0], argv.as_ptr(), bun_sys::c::environ()); }
                unsafe { bun_sys::c::exit(0); }
            }
            // success and failure cases: ignore the result
            _ => return,
        }
    }
    // TODO(port): wasm @compileError("Not implemented")
}

/// Crash. Make sure segfault handlers are off so that this doesnt trigger the crash handler.
/// This causes a segfault on posix systems to try to get a core dump.
fn crash() -> ! {
    #[cfg(windows)]
    {
        // Node.js exits with code 134 (128 + SIGABRT) instead. We use abort() as it includes a
        // breakpoint which makes crashes easier to debug.
        bun_sys::posix::abort();
    }
    #[cfg(not(windows))]
    {
        // Install default handler so that the tkill below will terminate.
        let sigact = bun_sys::posix::Sigaction {
            handler: bun_sys::posix::SigactionHandler::Handler(bun_sys::posix::SIG_DFL),
            mask: bun_sys::posix::sigemptyset(),
            flags: 0,
        };
        for sig in [
            bun_sys::posix::SIGSEGV,
            bun_sys::posix::SIGILL,
            bun_sys::posix::SIGBUS,
            bun_sys::posix::SIGABRT,
            bun_sys::posix::SIGFPE,
            bun_sys::posix::SIGHUP,
            bun_sys::posix::SIGTERM,
        ] {
            // SAFETY: valid Sigaction
            unsafe { bun_sys::posix::sigaction(sig, &sigact, core::ptr::null_mut()); }
        }

        // @trap()
        // SAFETY: intentionally trapping to terminate with a core dump
        unsafe { core::intrinsics::abort(); }
        // TODO(port): @trap() → use core::arch::asm!("ud2") on x86_64 / "brk #0" on aarch64,
        // or stable `std::process::abort()`. core::intrinsics::abort is unstable.
    }
}

pub static mut VERBOSE_ERROR_TRACE: bool = false;

#[cold]
#[inline(never)]
fn cold_handle_error_return_trace<const IS_ROOT: bool>(
    err_int_workaround_for_zig_ccall_bug: u16,
    trace: &StackTrace,
) {
    // TODO(port): std.meta.Int(.unsigned, @bitSizeOf(anyerror)) — bun_core::Error is NonZeroU16
    let err = bun_core::Error::from_raw(err_int_workaround_for_zig_ccall_bug);

    // The format of the panic trace is slightly different in debug
    // builds Mainly, we demangle the backtrace immediately instead
    // of using a trace string.
    //
    // To make the release-mode behavior easier to demo, debug mode
    // checks for this CLI flag.
    let is_debug = cfg!(debug_assertions) && 'check_flag: {
        for arg in bun_core::argv() {
            if arg == b"--debug-crash-handler-use-trace-string" {
                break 'check_flag false;
            }
        }
        true
    };

    if is_debug {
        if IS_ROOT {
            // SAFETY: read-only access
            if unsafe { VERBOSE_ERROR_TRACE } {
                Output::note("Release build will not have this trace by default:", format_args!(""));
            }
        } else {
            Output::note("caught error.{}:", format_args!("{}", err.name()));
        }
        Output::flush();
        dump_stack_trace(trace, WriteStackTraceLimits::default());
    } else {
        let ts = TraceString {
            trace,
            reason: CrashReason::ZigError(err),
            action: TraceStringAction::ViewTrace,
        };
        if IS_ROOT {
            Output::pretty_errorln(
                "\nTo send a redacted crash report to Bun's team,\nplease file a GitHub issue using the link below:\n\n <cyan>{}<r>\n",
                format_args!("{}", ts),
            );
        } else {
            Output::pretty_errorln(
                "<cyan>trace<r>: error.{}: <d>{}<r>",
                format_args!("{} {}", err.name(), ts),
                // TODO(port): Zig prints `@errorName(err)` and `ts` as separate substitutions
            );
        }
    }
}

#[inline]
fn handle_error_return_trace_extra<const IS_ROOT: bool>(err: bun_core::Error, maybe_trace: Option<&StackTrace>) {
    // TODO(port): builtin.have_error_return_tracing — Rust has no error-return tracing.
    // Phase B should decide whether to keep this entire mechanism or strip it.
    if !bun_debug::HAVE_ERROR_RETURN_TRACING {
        return;
    }
    // SAFETY: read-only access
    if unsafe { !VERBOSE_ERROR_TRACE } && !IS_ROOT {
        return;
    }

    if let Some(trace) = maybe_trace {
        cold_handle_error_return_trace::<IS_ROOT>(err.to_raw(), trace);
    }
}

/// In many places we catch errors, the trace for them is absorbed and only a
/// single line (the error name) is printed. When this is set, we will print
/// trace strings for those errors (or full stacks in debug builds).
///
/// This can be enabled by passing `--verbose-error-trace` to the CLI.
/// In release builds with error return tracing enabled, this is also exposed.
/// You can test if this feature is available by checking `bun --help` for the flag.
#[inline]
pub fn handle_error_return_trace(err: bun_core::Error, maybe_trace: Option<&StackTrace>) {
    handle_error_return_trace_extra::<false>(err, maybe_trace);
}

unsafe extern "C" {
    fn WTF__DumpStackTrace(ptr: *const usize, count: usize);
}

/// Version of the standard library dumpStackTrace that has some fallbacks for
/// cases where such logic fails to run.
pub fn dump_stack_trace(trace: &StackTrace, limits: WriteStackTraceLimits) {
    Output::flush();
    let stderr = &mut bun_sys::stderr_writer();
    if !Environment::SHOW_CRASH_TRACE {
        // debug symbols aren't available, lets print a tracestring
        let _ = write!(stderr, "View Debug Trace: {}\n", TraceString {
            action: TraceStringAction::ViewTrace,
            reason: CrashReason::ZigError(bun_core::err!("DumpStackTrace")),
            trace,
        });
        return;
    }

    #[cfg(windows)]
    'attempt_dump: {
        // Windows has issues with opening the PDB file sometimes.
        let debug_info = match debug::get_self_debug_info() {
            Ok(d) => d,
            Err(err) => {
                let _ = write!(stderr, "Unable to dump stack trace: Unable to open debug info: {}\nFallback trace:\n", err.name());
                break 'attempt_dump;
            }
        };
        match write_stack_trace(trace, stderr, debug_info, debug::detect_tty_config_stderr(), &limits) {
            Ok(()) => return,
            Err(err) => {
                let _ = write!(stderr, "Unable to dump stack trace: {}\nFallback trace:\n", err.name());
                break 'attempt_dump;
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        // In non-debug builds, use WTF's stack trace printer and return early
        if !cfg!(debug_assertions) {
            // SAFETY: trace.instruction_addresses is a valid slice of `index` entries
            unsafe { WTF__DumpStackTrace(trace.instruction_addresses().as_ptr(), trace.index); }
            return;
        }
        // Otherwise fall through to llvm-symbolizer for debug builds
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        // Assume debug symbol tooling is reliable.
        let debug_info = match debug::get_self_debug_info() {
            Ok(d) => d,
            Err(err) => {
                let _ = write!(stderr, "Unable to dump stack trace: Unable to open debug info: {}\n", err.name());
                return;
            }
        };
        match write_stack_trace(trace, stderr, debug_info, debug::detect_tty_config_stderr(), &limits) {
            Ok(()) => return,
            Err(err) => {
                let _ = write!(stderr, "Unable to dump stack trace: {}", err.name());
                return;
            }
        }
    }

    let programs: &[&bun_str::ZStr] = if cfg!(windows) {
        &[bun_str::zstr!("pdb-addr2line")]
    } else {
        // if `llvm-symbolizer` doesn't work, also try `llvm-symbolizer-21`
        &[bun_str::zstr!("llvm-symbolizer"), bun_str::zstr!("llvm-symbolizer-21")]
    };
    for &program in programs {
        // PERF(port): was arena bulk-free + StackFallbackAllocator — using global allocator in Phase A
        match spawn_symbolizer(program, trace) {
            // try next program if this one wasn't found
            Err(e) if e == bun_core::err!("FileNotFound") => continue,
            Err(_) => {}
            Ok(()) => {}
        }
        return;
    }
}

fn spawn_symbolizer(program: &bun_str::ZStr, trace: &StackTrace) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let mut argv: Vec<Vec<u8>> = Vec::new();
    argv.push(program.as_bytes().to_vec());
    argv.push(b"--exe".to_vec());
    argv.push({
        #[cfg(windows)]
        {
            let image_path = strings::to_utf8_alloc(bun_sys::windows::exe_path_w())?;
            let mut s = image_path[0..image_path.len() - 3].to_vec();
            s.extend_from_slice(b"pdb");
            s
        }
        #[cfg(not(windows))]
        {
            bun_core::self_exe_path()?.to_vec()
        }
    });

    let mut name_bytes: [u8; 1024] = [0; 1024];
    for &addr in &trace.instruction_addresses()[0..trace.index] {
        let Some(line) = StackLine::from_address(addr, &mut name_bytes) else { continue; };
        let mut buf = Vec::new();
        use std::io::Write as _;
        write!(&mut buf, "0x{:X}", line.address).expect("unreachable");
        argv.push(buf);
    }

    // TODO(port): std.process.Child — banned per PORTING.md (no std::process). Phase B should
    // route this through bun_core::spawn_sync or a raw posix_spawn. Preserving logic shape only.
    let stderr = &mut bun_sys::stderr_writer();
    let result = bun_core::spawn_sync_inherit(&argv).map_err(|err| {
        let _ = write!(stderr, "Failed to invoke command: {}\n", bun_fmt::fmt_slice(&argv, " "));
        if cfg!(windows) {
            let _ = write!(stderr, "(You can compile pdb-addr2line from https://github.com/oven-sh/bun.report, cd pdb-addr2line && cargo build)\n");
        }
        err
    })?;

    if !result.is_ok() {
        let _ = write!(stderr, "Failed to invoke command: {}\n", bun_fmt::fmt_slice(&argv, " "));
    }
    Ok(())
}

pub fn dump_current_stack_trace(first_address: Option<usize>, limits: WriteStackTraceLimits) {
    let mut addrs: [usize; 32] = [0; 32];
    let mut stack = StackTrace { index: 0, instruction_addresses: &mut addrs };
    debug::capture_stack_trace(first_address.unwrap_or_else(|| bun_debug::return_address()), &mut stack);
    dump_stack_trace(&stack, limits);
}

/// If POSIX, and the existing soft limit for core dumps (ulimit -Sc) is nonzero, change it to zero.
/// Used in places where we intentionally crash for testing purposes so that we don't clutter CI
/// with core dumps.
pub fn suppress_core_dumps_if_necessary() {
    #[cfg(unix)]
    {
        let Ok(mut existing_limit) = bun_sys::posix::getrlimit(bun_sys::posix::RLIMIT_CORE) else { return; };
        if existing_limit.cur > 0 || existing_limit.cur == bun_sys::posix::RLIM_INFINITY {
            existing_limit.cur = 0;
            let _ = bun_sys::posix::setrlimit(bun_sys::posix::RLIMIT_CORE, existing_limit);
        }
    }
}

/// From now on, prevent crashes from being reported to bun.report or the URL overridden in
/// BUN_CRASH_REPORT_URL. Should only be used for tests that are going to intentionally crash,
/// so that they do not fail CI due to having a crash reported. And those cases should guard behind
/// a feature flag and call right before the crash, in order to make sure that crashes other than
/// the expected one are not suppressed.
pub fn suppress_reporting() {
    suppress_core_dumps_if_necessary();
    // SAFETY: only called on the crash path / test setup
    unsafe { SUPPRESS_REPORTING = true; }
}

/// A variant of `std.builtin.StackTrace` that stores its data within itself
/// instead of being a pointer. This allows storing captured stack traces
/// for later printing.
#[derive(Clone, Copy)]
pub struct StoredTrace {
    pub data: [usize; 31],
    pub index: usize,
}

impl StoredTrace {
    pub const EMPTY: StoredTrace = StoredTrace {
        data: [0; 31],
        index: 0,
    };

    pub fn trace(&mut self) -> StackTrace {
        StackTrace {
            index: self.index,
            instruction_addresses: &mut self.data,
        }
    }

    pub fn capture(begin: Option<usize>) -> StoredTrace {
        let mut stored = StoredTrace::EMPTY;
        let mut frame = stored.trace();
        debug::capture_stack_trace(begin.unwrap_or_else(|| bun_debug::return_address()), &mut frame);
        stored.index = frame.index;
        for (i, &addr) in stored.data[0..stored.index].iter().enumerate() {
            if addr == 0 {
                stored.index = i;
                break;
            }
        }
        stored
    }

    pub fn from(stack_trace: Option<&StackTrace>) -> StoredTrace {
        if let Some(stack) = stack_trace {
            let mut data: [usize; 31] = [0; 31];
            let items = stack.instruction_addresses().len().min(31);
            data[0..items].copy_from_slice(&stack.instruction_addresses()[0..items]);
            StoredTrace {
                data,
                index: items.min(stack.index),
            }
        } else {
            StoredTrace::EMPTY
        }
    }
}

// TODO(port): move to *_jsc — `pub const js_bindings = @import("../runtime/api/crash_handler_jsc.zig").js_bindings;`
// Per PORTING.md this *_jsc alias is deleted; the bindings live as an extension trait in bun_runtime.

type OnBeforeCrash = fn(opaque_ptr: *mut c_void);

/// For large codebases such as bun.bake.DevServer, it may be helpful
/// to dump a large amount of state to a file to aid debugging a crash.
///
/// Pre-crash handlers are likely, but not guaranteed to call. Errors are ignored.
pub fn append_pre_crash_handler<T>(
    ptr: *mut T,
    handler: fn(&mut T) -> Result<(), bun_core::Error>,
) -> Result<(), bun_alloc::AllocError> {
    // TODO(port): Zig used `comptime handler` to monomorphize a wrapper closure that erases T.
    // Rust cannot capture a non-const fn pointer in an `extern "C" fn`; store a thin trampoline
    // by boxing the closure or by requiring `handler` to already accept *mut c_void in Phase B.
    fn on_crash_erased(_opaque_ptr: *mut c_void) {
        // TODO(port): cannot recover the typed `handler` here without per-T monomorphization.
        // Phase B: replace with `Box<dyn Fn(*mut c_void)>` storage in BEFORE_CRASH_HANDLERS_LIST.
    }
    let _ = handler;

    BEFORE_CRASH_HANDLERS_MUTEX.lock();
    let _guard = scopeguard::guard((), |_| BEFORE_CRASH_HANDLERS_MUTEX.unlock());
    // SAFETY: guarded by BEFORE_CRASH_HANDLERS_MUTEX
    unsafe { BEFORE_CRASH_HANDLERS_LIST.push((ptr.cast(), on_crash_erased)); }
    Ok(())
}

pub fn remove_pre_crash_handler(ptr: *mut c_void) {
    BEFORE_CRASH_HANDLERS_MUTEX.lock();
    let _guard = scopeguard::guard((), |_| BEFORE_CRASH_HANDLERS_MUTEX.unlock());
    // SAFETY: guarded by BEFORE_CRASH_HANDLERS_MUTEX
    let list = unsafe { &mut BEFORE_CRASH_HANDLERS_LIST };
    let index = 'find: {
        for (i, item) in list.iter().enumerate() {
            if item.0 == ptr {
                break 'find i;
            }
        }
        return;
    };
    let _ = list.remove(index);
}

pub fn is_panicking() -> bool {
    PANICKING.load(Ordering::Relaxed) > 0
}

pub struct SourceAtAddress {
    pub source_location: Option<SourceLocation>,
    pub symbol_name: Box<[u8]>,
    pub compile_unit_name: Box<[u8]>,
    // TODO(port): Zig stores borrowed slices owned by debug_info; using Box<[u8]> for Phase A.
}

// PORT NOTE: Zig's `SourceAtAddress.deinit` only freed `source_location.file_name`;
// `Option<SourceLocation>` owns it as `Box<[u8]>` so Drop handles it — no explicit deinit.

#[derive(Clone)]
pub struct WriteStackTraceLimits {
    pub frame_count: usize,
    pub stop_at_jsc_llint: bool,
    pub skip_stdlib: bool,
    pub skip_file_patterns: &'static [&'static [u8]],
    pub skip_function_patterns: &'static [&'static [u8]],
}

impl Default for WriteStackTraceLimits {
    fn default() -> Self {
        Self {
            frame_count: usize::MAX,
            stop_at_jsc_llint: false,
            skip_stdlib: false,
            skip_file_patterns: &[],
            skip_function_patterns: &[],
        }
    }
}

/// Clone of `debug.writeStackTrace`, but can be configured to stop at either a
/// frame count, or when hitting jsc LLInt Additionally, the printing function
/// does not print the `^`, instead it highlights the word at the column. This
/// Makes each frame take up two lines instead of three.
pub fn write_stack_trace(
    stack_trace: &StackTrace,
    out_stream: &mut impl bun_io::Write,
    debug_info: &mut SelfInfo,
    tty_config: TtyConfig,
    limits: &WriteStackTraceLimits,
) -> Result<(), bun_core::Error> {
    if bun_debug::STRIP_DEBUG_INFO {
        return Err(bun_core::err!("MissingDebugInfo"));
    }
    let mut frame_index: usize = 0;
    let mut frames_left: usize = stack_trace.index.min(stack_trace.instruction_addresses().len());

    // PORT NOTE: Zig's `while (...) : ({ frames_left -= 1; frame_index = ... })` continue-expression
    // is inlined at every `continue` site and at end-of-loop below.
    while frames_left != 0 {
        if frame_index >= limits.frame_count {
            break;
        }
        let return_address = stack_trace.instruction_addresses()[frame_index];
        let source = match get_source_at_address(debug_info, return_address - 1)? {
            Some(s) => s,
            None => {
                let module_name = debug_info.get_module_name_for_address(return_address - 1);
                print_line_info(
                    out_stream,
                    None,
                    return_address - 1,
                    b"???",
                    module_name.as_deref().unwrap_or(b"???"),
                    tty_config,
                )?;
                frames_left -= 1;
                frame_index = (frame_index + 1) % stack_trace.instruction_addresses().len();
                continue;
            }
        };

        let mut should_continue = false;
        if limits.skip_stdlib {
            if let Some(sl) = &source.source_location {
                if strings::includes(&sl.file_name, b"lib/std") {
                    should_continue = true;
                }
            }
        }
        for &pattern in limits.skip_file_patterns {
            if let Some(sl) = &source.source_location {
                if strings::includes(&sl.file_name, pattern) {
                    should_continue = true;
                }
            }
        }
        for &pattern in limits.skip_function_patterns {
            if strings::includes(&source.symbol_name, pattern) {
                should_continue = true;
            }
        }
        if should_continue {
            frames_left -= 1;
            frame_index = (frame_index + 1) % stack_trace.instruction_addresses().len();
            continue;
        }
        if limits.stop_at_jsc_llint && strings::includes(&source.symbol_name, b"_llint_") {
            break;
        }

        print_line_info(
            out_stream,
            source.source_location.as_ref(),
            return_address - 1,
            &source.symbol_name,
            &source.compile_unit_name,
            tty_config,
        )?;

        frames_left -= 1;
        frame_index = (frame_index + 1) % stack_trace.instruction_addresses().len();
    }

    if stack_trace.index > stack_trace.instruction_addresses().len() {
        let dropped_frames = stack_trace.index - stack_trace.instruction_addresses().len();

        let _ = tty_config.set_color(out_stream, TtyConfig::BOLD);
        write!(out_stream, "({} additional stack frames not recorded...)\n", dropped_frames)?;
        let _ = tty_config.set_color(out_stream, TtyConfig::RESET);
    } else if frames_left != 0 {
        let _ = tty_config.set_color(out_stream, TtyConfig::BOLD);
        write!(out_stream, "({} additional stack frames skipped...)\n", frames_left)?;
        let _ = tty_config.set_color(out_stream, TtyConfig::RESET);
    }
    let _ = out_stream.write_all(b"\n");
    Ok(())
}

/// Clone of `debug.printSourceAtAddress` but it returns the metadata as well.
pub fn get_source_at_address(debug_info: &mut SelfInfo, address: usize) -> Result<Option<SourceAtAddress>, bun_core::Error> {
    let module = match debug_info.get_module_for_address(address) {
        Ok(m) => m,
        Err(e) if e == bun_core::err!("MissingDebugInfo") || e == bun_core::err!("InvalidDebugInfo") => return Ok(None),
        Err(e) => return Err(e),
    };

    let symbol_info = match module.get_symbol_at_address(address) {
        Ok(s) => s,
        Err(e) if e == bun_core::err!("MissingDebugInfo") || e == bun_core::err!("InvalidDebugInfo") => return Ok(None),
        Err(e) => return Err(e),
    };

    Ok(Some(SourceAtAddress {
        source_location: symbol_info.source_location,
        symbol_name: symbol_info.name,
        compile_unit_name: symbol_info.compile_unit_name,
    }))
}

/// Clone of `debug.printLineInfo` as it is private.
fn print_line_info(
    out_stream: &mut impl bun_io::Write,
    source_location: Option<&SourceLocation>,
    address: usize,
    symbol_name: &[u8],
    compile_unit_name: &[u8],
    tty_config: TtyConfig,
) -> Result<(), bun_core::Error> {
    // TODO(port): bun.Environment.base_path ++ sep_str — const_format::concatcp!
    let base_path = const_format::concatcp!(Environment::BASE_PATH, bun_paths::SEP_STR);
    {
        if let Some(sl) = source_location {
            if sl.file_name.starts_with(base_path.as_bytes()) {
                tty_config.set_color(out_stream, TtyConfig::DIM)?;
                write!(out_stream, "{}", base_path)?;
                tty_config.set_color(out_stream, TtyConfig::RESET)?;
                tty_config.set_color(out_stream, TtyConfig::BOLD)?;
                write!(out_stream, "{}", bstr::BStr::new(&sl.file_name[base_path.len()..]))?;
            } else {
                tty_config.set_color(out_stream, TtyConfig::BOLD)?;
                write!(out_stream, "{}", bstr::BStr::new(&sl.file_name))?;
            }
            write!(out_stream, ":{}:{}", sl.line, sl.column)?;
        } else {
            tty_config.set_color(out_stream, TtyConfig::BOLD)?;
            out_stream.write_all(b"???:?:?")?;
        }

        tty_config.set_color(out_stream, TtyConfig::RESET)?;
        out_stream.write_all(b": ")?;
        tty_config.set_color(out_stream, TtyConfig::DIM)?;
        write!(out_stream, "0x{:x} in", address)?;
        tty_config.set_color(out_stream, TtyConfig::RESET)?;
        tty_config.set_color(out_stream, TtyConfig::YELLOW)?;
        write!(out_stream, " {}", bstr::BStr::new(symbol_name))?;
        tty_config.set_color(out_stream, TtyConfig::RESET)?;
        tty_config.set_color(out_stream, TtyConfig::DIM)?;
        write!(out_stream, " ({})", bstr::BStr::new(compile_unit_name))?;
        tty_config.set_color(out_stream, TtyConfig::RESET)?;
        out_stream.write_all(b"\n")?;

        // Show the matching source code line if possible
        if let Some(sl) = source_location {
            match print_line_from_file_any_os(out_stream, tty_config, sl) {
                Ok(()) => {
                    if sl.column > 0 && tty_config == TtyConfig::NoColor {
                        // The caret already takes one char
                        let space_needed = (sl.column - 1) as usize;
                        out_stream.write_byte_n(b' ', space_needed)?;
                        out_stream.write_all(b"^\n")?;
                    }
                }
                Err(e) if e == bun_core::err!("EndOfFile")
                    || e == bun_core::err!("FileNotFound")
                    || e == bun_core::err!("BadPathName")
                    || e == bun_core::err!("AccessDenied") => {}
                Err(e) => return Err(e),
            }
        }
    }
    Ok(())
}

/// Modified version of `debug.printLineFromFileAnyOs` that uses two passes.
/// - Record the whole slice into a buffer
/// - Locate the column, expand a highlight to one word.
/// - Print the line, with the highlight.
fn print_line_from_file_any_os(
    out_stream: &mut impl bun_io::Write,
    tty_config: TtyConfig,
    source_location: &SourceLocation,
) -> Result<(), bun_core::Error> {
    // Need this to always block even in async I/O mode, because this could potentially
    // be called from e.g. the event loop code crashing.
    // TODO(port): std.fs.cwd().openFile — banned. Use bun_sys::File::open in Phase B.
    let mut f = bun_sys::File::open_at(bun_sys::Fd::cwd(), &source_location.file_name, bun_sys::O::RDONLY, 0)
        .map_err(bun_core::Error::from)?;
    let _close = scopeguard::guard((), |_| { let _ = f.close(); });
    // TODO(port): errdefer — f closed on all paths via guard

    let mut line_buf: [u8; 4096] = [0; 4096];
    let mut fbs_len: usize = 0;
    'read_line: {
        let mut buf: [u8; 4096] = [0; 4096];
        let mut amt_read = f.read(&mut buf[..])?;
        let line_start: usize = 'seek: {
            let mut current_line_start: usize = 0;
            let mut next_line: usize = 1;
            while next_line != source_location.line as usize {
                let slice = &buf[current_line_start..amt_read];
                if let Some(pos) = strings::index_of_char(slice, b'\n') {
                    next_line += 1;
                    if pos as usize == slice.len() - 1 {
                        amt_read = f.read(&mut buf[..])?;
                        current_line_start = 0;
                    } else {
                        current_line_start += pos as usize + 1;
                    }
                } else if amt_read < buf.len() {
                    return Err(bun_core::err!("EndOfFile"));
                } else {
                    amt_read = f.read(&mut buf[..])?;
                    current_line_start = 0;
                }
            }
            break 'seek current_line_start;
        };
        let slice = &mut buf[line_start..amt_read];
        if let Some(pos) = strings::index_of_char(slice, b'\n') {
            let line = &mut slice[0..pos as usize];
            for b in line.iter_mut() { if *b == b'\t' { *b = b' '; } }
            let n = line.len().min(line_buf.len() - fbs_len);
            line_buf[fbs_len..fbs_len + n].copy_from_slice(&line[..n]);
            fbs_len += n;
            break 'read_line;
        } else {
            // Line is the last inside the buffer, and requires another read to find delimiter. Alternatively the file ends.
            for b in slice.iter_mut() { if *b == b'\t' { *b = b' '; } }
            let n = slice.len().min(line_buf.len() - fbs_len);
            line_buf[fbs_len..fbs_len + n].copy_from_slice(&slice[..n]);
            fbs_len += n;
            if n < slice.len() { break 'read_line; }
            while amt_read == buf.len() {
                amt_read = f.read(&mut buf[..])?;
                if let Some(pos) = strings::index_of_char(&buf[0..amt_read], b'\n') {
                    let line = &mut buf[0..pos as usize];
                    for b in line.iter_mut() { if *b == b'\t' { *b = b' '; } }
                    let n2 = line.len().min(line_buf.len() - fbs_len);
                    line_buf[fbs_len..fbs_len + n2].copy_from_slice(&line[..n2]);
                    fbs_len += n2;
                    break 'read_line;
                } else {
                    let line = &mut buf[0..amt_read];
                    for b in line.iter_mut() { if *b == b'\t' { *b = b' '; } }
                    let n2 = line.len().min(line_buf.len() - fbs_len);
                    line_buf[fbs_len..fbs_len + n2].copy_from_slice(&line[..n2]);
                    fbs_len += n2;
                    if n2 < line.len() { break 'read_line; }
                }
            }
            break 'read_line;
        }
        // unreachable in Zig (`return;` after the if/else above)
    }
    let line_without_newline = bun_str::strings::trim_right(&line_buf[..fbs_len], b"\n");
    if source_location.column as usize > line_without_newline.len() {
        out_stream.write_all(line_without_newline)?;
        out_stream.write_byte(b'\n')?;
        return Ok(());
    }
    // expand the highlight to one word
    let mut left = (source_location.column as usize).saturating_sub(1);
    let mut right = left + 1;
    while left > 0 {
        match line_without_newline[left] {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b' ' | b'\t' => break,
            _ => left -= 1,
        }
    }
    while left > 0 {
        match line_without_newline[left] {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' => left -= 1,
            _ => break,
        }
    }
    while right < line_without_newline.len() {
        match line_without_newline[right - 1] {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' => right += 1,
            _ => break,
        }
    }
    let before = &line_without_newline[0..left];
    let highlight = &line_without_newline[left..right];
    let mut after_before_comment = &line_without_newline[right..];
    let mut comment: &[u8] = b"";
    if let Some(pos) = strings::index_of(after_before_comment, b"//") {
        comment = &after_before_comment[pos as usize..];
        after_before_comment = &after_before_comment[0..pos as usize];
    }
    tty_config.set_color(out_stream, TtyConfig::RED)?;
    tty_config.set_color(out_stream, TtyConfig::DIM)?;
    out_stream.write_all(before)?;
    tty_config.set_color(out_stream, TtyConfig::RESET)?;
    tty_config.set_color(out_stream, TtyConfig::RED)?;
    out_stream.write_all(highlight)?;
    tty_config.set_color(out_stream, TtyConfig::DIM)?;
    out_stream.write_all(after_before_comment)?;
    if !comment.is_empty() {
        tty_config.set_color(out_stream, TtyConfig::RESET)?;
        tty_config.set_color(out_stream, TtyConfig::BRIGHT_CYAN)?;
        out_stream.write_all(comment)?;
    }
    tty_config.set_color(out_stream, TtyConfig::RESET)?;
    out_stream.write_byte(b'\n')?;
    Ok(())
}

#[unsafe(no_mangle)]
pub extern "C" fn CrashHandler__setInsideNativePlugin(name: *const c_char) {
    INSIDE_NATIVE_PLUGIN.with(|c| c.set(if name.is_null() { None } else { Some(name) }));
}

#[unsafe(no_mangle)]
pub extern "C" fn CrashHandler__unsupportedUVFunction(name: *const c_char) {
    bun_analytics::Features::increment_unsupported_uv_function();
    UNSUPPORTED_UV_FUNCTION.with(|c| c.set(if name.is_null() { None } else { Some(name) }));
    if bun_core::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_ON_UV_STUB::get() {
        suppress_reporting();
    }
    // SAFETY: name is non-null (Zig dereferences it unconditionally with `.?`)
    let name_bytes = unsafe { core::ffi::CStr::from_ptr(name) }.to_bytes();
    // TODO(port): std.debug.panic — route through Rust panic_impl
    let mut msg: Vec<u8> = Vec::new();
    {
        use std::io::Write as _;
        let _ = write!(&mut msg, "unsupported uv function: {}", bstr::BStr::new(name_bytes));
    }
    panic_impl(
        // PERF(port): Zig used std.debug.panic stack formatting — leaking on the noreturn path is fine
        Box::leak(msg.into_boxed_slice()),
        None,
        None,
    );
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__crashHandler(message_ptr: *const u8, message_len: usize) -> ! {
    // SAFETY: caller passes a valid (ptr, len) byte slice
    let msg = unsafe { core::slice::from_raw_parts(message_ptr, message_len) };
    crash_handler(
        // SAFETY: noreturn — see panic_impl note
        CrashReason::Panic(unsafe { core::mem::transmute::<&[u8], &'static [u8]>(msg) }),
        None,
        Some(bun_debug::return_address()),
    );
}

#[unsafe(no_mangle)]
pub extern "C" fn CrashHandler__setDlOpenAction(action: *const c_char) {
    if !action.is_null() {
        debug_assert!(CURRENT_ACTION.with(|c| c.get()).is_none());
        // SAFETY: action is a valid NUL-terminated C string for the duration of the dlopen call
        let s = unsafe { core::ffi::CStr::from_ptr(action) }.to_bytes();
        // SAFETY: noreturn-on-crash usage; the C string outlives the action via caller contract
        CURRENT_ACTION.with(|c| c.set(Some(Action::Dlopen(unsafe {
            core::mem::transmute::<&[u8], &'static [u8]>(s)
        }))));
    } else {
        debug_assert!(matches!(CURRENT_ACTION.with(|c| c.get()), Some(Action::Dlopen(_))));
        CURRENT_ACTION.with(|c| c.set(None));
    }
}

pub fn fix_dead_code_elimination() {
    core::hint::black_box(CrashHandler__unsupportedUVFunction as extern "C" fn(*const c_char));
}
// In Zig: comptime { _ = &Bun__crashHandler; ... } — Rust links #[no_mangle] symbols unconditionally.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/crash_handler/crash_handler.zig (2263 lines)
//   confidence: low
//   todos:      35
//   notes:      Heavy std.debug/std.posix/std.process coupling — needs bun_debug shim crate (StackTrace, SelfInfo, return_address) and bun_sys::posix signal API. Output::pretty_fmt_args, append_pre_crash_handler trampoline, and spawn_symbolizer need real impls in Phase B.
// ──────────────────────────────────────────────────────────────────────────
