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

// ──────────────────────────────────────────────────────────────────────────
// B-2 UN-GATE
// Phase-A draft compiles as `mod draft` and is re-exported. Function bodies
// that depend on T0/T1 surface not yet available are individually re-gated
// with `` and a `// TODO(b2-blocked): bun_X::Y` marker.
// ──────────────────────────────────────────────────────────────────────────
#![feature(core_intrinsics)]
#![allow(internal_features)]
#![allow(unused, nonstandard_style, static_mut_refs, unexpected_cfgs, clippy::all)]
#![warn(unused_must_use)]

#![warn(unreachable_pub)]
#[path = "CPUFeatures.rs"]
pub mod cpu_features;

#[path = "handle_oom.rs"]
pub mod handle_oom;

/// `bun.outOfMemory()` — callable from `handle_oom` and the crash path.
pub use bun_alloc::out_of_memory;

pub use draft::*;

// ──────────────────────────────────────────────────────────────────────────
// Local shim for `bun_debug` (no such crate exists yet). These are
// std.debug.* placeholders the Zig side leaned on; the Rust port will replace
// them with a real debug-info backend in a later pass.
// TODO(b2-blocked): bun_debug::SelfInfo / SourceLocation / TtyConfig / capture_stack_trace
// ──────────────────────────────────────────────────────────────────────────
pub mod debug {
    use super::draft::StackTrace;

    /// `@returnAddress()` — Rust has no stable equivalent; 0 means "capture from here".
    /// TODO(port): wire to `core::intrinsics::caller_location` or a C++ helper.
    #[inline(always)]
    pub fn return_address() -> usize { 0 }

    /// Zig: `std.debug.captureStackTrace`. Uses the same C++ helper bun_core does.
    /// Writes captured return addresses into `addrs` and returns the count written.
    /// Callers construct the (immutable-slice) `StackTrace` *after* this returns —
    /// the previous signature round-tripped through `StackTrace.instruction_addresses:
    /// &[usize]` and wrote via a `*mut` cast of a shared-ref-derived pointer (UB).
    pub fn capture_stack_trace(begin: usize, addrs: &mut [usize]) -> usize {
        unsafe extern "C" {
            fn Bun__captureStackTrace(begin: usize, out: *mut usize, cap: usize) -> usize;
        }
        // SAFETY: `addrs` is a valid mutable slice for `addrs.len()` entries; the
        // C++ side writes at most `cap` words and returns the count written.
        unsafe { Bun__captureStackTrace(begin, addrs.as_mut_ptr(), addrs.len()) }
    }

    /// Zig: `std.debug.panicImpl` fallback when ENABLE == false.
    pub fn panic_impl(_ert: Option<&StackTrace<'_>>, _begin: Option<usize>, msg: &[u8]) -> ! {
        panic!("{}", bstr::BStr::new(msg))
    }

    pub const HAVE_ERROR_RETURN_TRACING: bool = false;
    pub const STRIP_DEBUG_INFO: bool = !cfg!(debug_assertions);

    // ── stub types: no debug-info backend yet ─────────────────────────────
    // TODO(b2-blocked): bun_debug::SelfInfo — these stubs always answer
    // `MissingDebugInfo`; the real DWARF/PDB reader lands with the bun_debug
    // crate. Shape mirrors `std.debug.SelfInfo` so callers compile unchanged.
    pub struct SelfInfo;
    impl SelfInfo {
        pub fn get_module_for_address(&mut self, _address: usize) -> Result<Module, bun_core::Error> {
            Err(bun_core::err!("MissingDebugInfo"))
        }
        pub fn get_module_name_for_address(&mut self, _address: usize) -> Option<Box<[u8]>> {
            None
        }
    }
    pub struct Module;
    impl Module {
        pub fn get_symbol_at_address(&self, _address: usize) -> Result<SymbolInfo, bun_core::Error> {
            Err(bun_core::err!("MissingDebugInfo"))
        }
    }
    pub struct SymbolInfo {
        pub source_location: Option<SourceLocation>,
        pub name: Box<[u8]>,
        pub compile_unit_name: Box<[u8]>,
    }
    /// Zig: `debug.getSelfDebugInfo()`. No backend yet — always errors.
    pub fn get_self_debug_info() -> Result<&'static mut SelfInfo, bun_core::Error> {
        Err(bun_core::err!("MissingDebugInfo"))
    }
    /// Zig: `std.io.tty.detectConfig(std.io.getStdErr())`.
    pub fn detect_tty_config_stderr() -> TtyConfig {
        if bun_core::Output::ENABLE_ANSI_COLORS_STDERR.load(core::sync::atomic::Ordering::Relaxed) {
            TtyConfig::EscapeCodes
        } else {
            TtyConfig::NoColor
        }
    }
    #[derive(Clone)]
    pub struct SourceLocation {
        pub file_name: Box<[u8]>,
        pub line: u32,
        pub column: u32,
    }
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum TtyConfig { NoColor, EscapeCodes }
    impl TtyConfig {
        pub const BOLD: u8 = 1;
        pub const RESET: u8 = 0;
        pub const DIM: u8 = 2;
        pub const RED: u8 = 31;
        pub const YELLOW: u8 = 33;
        pub const BRIGHT_CYAN: u8 = 96;
        pub fn set_color<W>(self, _w: &mut W, _c: u8) -> Result<(), bun_core::Error> { Ok(()) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Local byte-writer trait. `bun_io::Write` does not exist yet; the crash
// handler only needs `write_all` / `write_byte` / `write!` over a few sinks.
// TODO(b2-blocked): bun_io::Write
// ──────────────────────────────────────────────────────────────────────────
pub trait Write: core::fmt::Write {
    fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error>;
    fn write_byte(&mut self, b: u8) -> Result<(), bun_core::Error> { self.write_all(&[b]) }
    fn write_byte_n(&mut self, b: u8, n: usize) -> Result<(), bun_core::Error> {
        for _ in 0..n { self.write_all(&[b])?; }
        Ok(())
    }
}

/// Raw, unbuffered stderr writer for the crash path. Stand-in for
/// `bun_sys::stderr_writer()` (not yet exposed by T1).
pub struct StderrWriter;
pub fn stderr_writer() -> StderrWriter { StderrWriter }
impl core::fmt::Write for StderrWriter {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        // SAFETY: fd 2 is always open; libc::write is async-signal-safe.
        unsafe { libc::write(2, s.as_ptr().cast(), s.len()); }
        Ok(())
    }
}
impl Write for StderrWriter {
    fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
        // SAFETY: fd 2 is always open; libc::write is async-signal-safe.
        unsafe { libc::write(2, bytes.as_ptr().cast(), bytes.len()); }
        Ok(())
    }
}
impl<const N: usize> Write for bun_collections::BoundedArray<u8, N> {
    fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
        self.append_slice(bytes).map_err(|_| bun_core::err!("NoSpaceLeft"))
    }
}
/// Adapter: route a `core::fmt::Formatter` through the byte-writer trait.
pub struct FmtAdapter<'a, 'b>(pub &'a mut core::fmt::Formatter<'b>);
impl core::fmt::Write for FmtAdapter<'_, '_> {
    fn write_str(&mut self, s: &str) -> core::fmt::Result { self.0.write_str(s) }
}
impl Write for FmtAdapter<'_, '_> {
    fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
        use core::fmt::Write as _;
        self.0.write_str(&String::from_utf8_lossy(bytes)).map_err(|_| bun_core::err!("WriteZero"))
    }
}

// ──────────────────────────────────────────────────────────────────────────
mod draft {

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_long, c_void};
use core::fmt;
use core::fmt::Write as _;
use core::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering};

use bun_core::{Environment, Global, Output, env_var, fmt as bun_fmt};
use bun_collections::BoundedArray;
use bun_base64::VLQ; // MOVE_DOWN(b0): was bun_sourcemap::VLQ
use bun_core::strings;

use super::{debug, Write, FmtAdapter, stderr_writer};

/// Map a `core::fmt::Error` (from `write!` on a `fmt::Write`) into the
/// `bun_core::Error` domain. The crash-path writers never actually fail —
/// `StderrWriter::write_str` always returns `Ok` — so the value is irrelevant,
/// but the type must line up for `?`.
#[inline(always)]
fn fmt_err(_: core::fmt::Error) -> bun_core::Error { bun_core::err!("WriteZero") }

/// Zig: `Output.enable_ansi_colors_stderr` — runtime flag, exposed in Rust as an
/// `AtomicBool` static. Wrapped here so call sites read like the Zig.
#[inline(always)]
fn enable_ansi_colors_stderr() -> bool {
    Output::ENABLE_ANSI_COLORS_STDERR.load(Ordering::Relaxed)
}

/// Zig: `std.posix.abort()`. `bun_sys::posix` does not re-export it; route
/// through libc directly (async-signal-safe).
#[inline(always)]
fn abort() -> ! {
    // SAFETY: libc::abort has no preconditions; never returns.
    unsafe { libc::abort() }
}
use super::debug::{SelfInfo, SourceLocation, TtyConfig};
use super::cpu_features::CPUFeatures;

/// Zig: `bun.fmt.fmtArgv` — print an argv vector as a shell-ish line.
/// crash_handler.zig:1024 calls this when the addr2line spawn fails.
fn fmt_argv<W: core::fmt::Write>(w: &mut W, argv: &[Vec<u8>]) -> core::fmt::Result {
    for (i, a) in argv.iter().enumerate() {
        if i > 0 { w.write_char(' ')?; }
        // Best-effort lossy print — argv came from this process so it's UTF-8
        // by construction, but the stderr sink is `core::fmt::Write`.
        match core::str::from_utf8(a) {
            Ok(s) => w.write_str(s)?,
            Err(_) => {
                for &b in a {
                    w.write_char(b as char)?;
                }
            }
        }
    }
    Ok(())
}

/// Zig: `bun.strings.indexOf`. bun_core::strings has no `index_of` yet.
#[inline]
fn index_of(h: &[u8], n: &[u8]) -> Option<usize> {
    bstr::ByteSlice::find(h, n)
}

// TODO(b0): `Cli` arrives from move-in (MOVE_DOWN bun_runtime::cli::Cli → crash_handler).
// Only the two bits the crash handler needs — main-thread check and the
// one-byte command tag for the trace URL — land here as plain globals that
// `bun_runtime` populates at startup.
pub mod cli_state {
    use core::sync::atomic::{AtomicU8, AtomicU64, Ordering};

    static MAIN_THREAD_ID: AtomicU64 = AtomicU64::new(0);
    /// 0 = unset → encoded as `_` in the trace string.
    static CMD_CHAR: AtomicU8 = AtomicU8::new(0);

    pub fn set_main_thread_id(id: u64) { MAIN_THREAD_ID.store(id, Ordering::Relaxed); }
    pub fn set_cmd_char(c: u8) { CMD_CHAR.store(c, Ordering::Relaxed); }

    pub fn is_main_thread() -> bool {
        MAIN_THREAD_ID.load(Ordering::Relaxed) == bun_threading::current_thread_id()
    }
    pub fn cmd_char() -> Option<u8> {
        match CMD_CHAR.load(Ordering::Relaxed) { 0 => None, c => Some(c) }
    }
}

// std.builtin.StackTrace lives in bun_core (T0); the debug-info types are local
// shims (see `super::debug`) until a real bun_debug crate exists.
pub use bun_core::StackTrace;

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
/// PORT NOTE: shared with bun_core::PANICKING so T0 callers see the same state.
use bun_core::PANICKING;

// Locked to avoid interleaving panic messages from multiple threads.
// TODO: I don't think it's safe to lock/unlock a mutex inside a signal handler.
// PORTING.md §Concurrency: parking_lot::Mutex<()> for a bare critical section.
static PANIC_MUTEX: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

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

// PORTING.md §Concurrency: parking_lot::Mutex<Vec<..>> instead of bare Mutex + static mut Vec.
// Stores a boxed type-erased closure (not a bare fn pointer) so that
// `append_pre_crash_handler` can monomorphize a wrapper that actually invokes the
// caller's typed handler — mirroring Zig's `comptime handler` trampoline.
struct CrashHandlerEntry(*mut c_void, Box<dyn Fn(*mut c_void) + Send>);
// SAFETY: only accessed under the mutex; the opaque ptr is never dereferenced
// except by the registered callback on the crash thread.
unsafe impl Send for CrashHandlerEntry {}
static BEFORE_CRASH_HANDLERS: parking_lot::Mutex<Vec<CrashHandlerEntry>> =
    parking_lot::Mutex::new(Vec::new());

/// Prevents crash reports from being uploaded to any server. Reports will still be printed and
/// abort the process. Overrides BUN_CRASH_REPORT_URL, BUN_ENABLE_CRASH_REPORTING, and all other
/// things that affect crash reporting. See suppressReporting() for intended usage.
static SUPPRESS_REPORTING: AtomicBool = AtomicBool::new(false);

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
            CrashReason::ZigError(err) => write!(writer, "error.{}", bstr::BStr::new(err.name())),
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

/// Snapshot the thread-local `CURRENT_ACTION` for save/restore around a scoped
/// operation (e.g. `js_printer::print_with_writer_and_platform`).
#[inline]
pub fn current_action() -> Option<Action> {
    CURRENT_ACTION.with(|c| c.get())
}

/// Set (or clear) the thread-local `CURRENT_ACTION`. Paired with
/// [`current_action`] for scoped restore via `scopeguard`.
#[inline]
pub fn set_current_action(action: Option<Action>) {
    CURRENT_ACTION.with(|c| c.set(action));
}

/// RAII guard returned by [`scoped_action`] / [`set_current_action_resolver`].
/// Restores the previous `CURRENT_ACTION` on drop (Zig: `defer current_action = old`).
pub struct ActionGuard(Option<Action>);
impl Drop for ActionGuard {
    #[inline]
    fn drop(&mut self) {
        set_current_action(self.0);
    }
}

/// Scoped `CURRENT_ACTION = action`. Snapshots the previous value, installs
/// `action`, and returns an [`ActionGuard`] that restores the previous value
/// on drop. Zig: `const old = current_action; defer current_action = old;
/// current_action = ...;`.
#[inline]
#[must_use]
pub fn scoped_action(action: Action) -> ActionGuard {
    let prev = current_action();
    set_current_action(Some(action));
    ActionGuard(prev)
}

/// Scoped `CURRENT_ACTION = .resolver{...}`. Zig (resolver.zig:672-679) sets
/// this only under `Environment.show_crash_trace` because module resolution is
/// extremely hot and has a low crash rate; the cfg-gate here mirrors that.
///
/// `source_dir`/`import_path` are caller-interned (DirnameStore / source text)
/// and outlive the guard; the `&'static` lifetime erasure matches the existing
/// `Action::Parse`/`Visit`/`Print` slice fields (see TODO(port) above).
#[inline]
pub fn set_current_action_resolver(
    source_dir: &[u8],
    import_path: &[u8],
    kind: bun_options_types::ImportKind,
) -> ActionGuard {
    let prev = current_action();
    #[cfg(feature = "show_crash_trace")]
    {
        // SAFETY: caller-interned slices outlive the guard; see fn docs.
        let source_dir: &'static [u8] = unsafe { &*(source_dir as *const [u8]) };
        let import_path: &'static [u8] = unsafe { &*(import_path as *const [u8]) };
        set_current_action(Some(Action::Resolver(ResolverAction {
            source_dir,
            import_path,
            kind,
        })));
    }
    #[cfg(not(feature = "show_crash_trace"))]
    {
        let _ = (source_dir, import_path, kind);
        set_current_action(Some(Action::Resolver(())));
    }
    ActionGuard(prev)
}

#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn capture_libc_backtrace(begin_addr: usize, addrs: &mut [usize], stack_trace: &mut StackTrace<'_>) {
    unsafe extern "C" {
        fn backtrace(buffer: *mut *mut c_void, size: c_int) -> c_int;
    }

    // SAFETY: addrs is a valid mutable slice of usize, which is layout-compatible with *mut c_void
    let count = unsafe { backtrace(addrs.as_mut_ptr().cast(), i32::try_from(addrs.len()).expect("int cast")) };
    stack_trace.index = usize::try_from(count).expect("int cast");

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

    let mut trace_str_buf = BoundedArray::<u8, 1024>::default();

    match PANIC_STAGE.with(|s| s.get()) {
        0 => {
            bun_core::maybe_handle_panic_during_process_reload();

            PANIC_STAGE.with(|s| s.set(1));
            let _ = PANICKING.fetch_add(1, Ordering::SeqCst);

            if let Some(handlers) = BEFORE_CRASH_HANDLERS.try_lock() {
                for CrashHandlerEntry(ptr, cb) in handlers.iter() {
                    cb(*ptr);
                }
            }

            {
                let _panic_guard = PANIC_MUTEX.lock();

                // Use an raw unbuffered writer to stderr to avoid losing information on
                // panic in a panic. There is also a possibility that `Output` related code
                // is not configured correctly, so that would also mask the message.
                //
                // Output.errorWriter() is not used here because it may not be configured
                // if the program crashes immediately at startup.
                // TODO(port): std.fs.File.stderr().writerStreaming — local raw StderrWriter (bun_sys
                //             FileWriter only impls std::io::Write, not the local byte-Write trait)
                let writer = &mut stderr_writer();

                // The format of the panic trace is slightly different in debug
                // builds. Mainly, we demangle the backtrace immediately instead
                // of using a trace string.
                //
                // To make the release-mode behavior easier to demo, debug mode
                // checks for this CLI flag.
                let debug_trace = Environment::SHOW_CRASH_TRACE && 'check_flag: {
                    for arg in bun_core::argv() {
                        if arg == &b"--debug-crash-handler-use-trace-string"[..] {
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
                    Output::source::stdio::restore();

                    if writer.write_all(concat!("============================================================", "\n").as_bytes()).is_err() { abort(); }
                    if print_metadata(writer).is_err() { abort(); }

                    if let Some(name) = INSIDE_NATIVE_PLUGIN.with(|c| c.get()) {
                        // SAFETY: name was set from a valid NUL-terminated C string
                        let native_plugin_name = unsafe { core::ffi::CStr::from_ptr(name) }.to_bytes();
                        let fmt = "\nBun has encountered a crash while running the <red><d>\"{s}\"<r> native plugin.\n\nThis indicates either a bug in the native plugin or in Bun.\n";
                        if write!(writer, "{}", Output::pretty_fmt_args(fmt, true, format_args!("{}", bstr::BStr::new(native_plugin_name)))).is_err() { abort(); }
                    } else if UNSUPPORTED_UV_FUNCTION.with(|c| c.get()).is_some() {
                        // TODO(b2-blocked): bun_analytics::Features::unsupported_uv_function — using
                        // the threadlocal as a stand-in for the global counter check.
                        let name: &[u8] = UNSUPPORTED_UV_FUNCTION.with(|c| c.get())
                            .map(|p| {
                                // SAFETY: p was set from a valid NUL-terminated C string via CrashHandler__unsupportedUVFunction
                                unsafe { core::ffi::CStr::from_ptr(p) }.to_bytes()
                            })
                            .unwrap_or(b"<unknown>");
                        let fmt = "Bun encountered a crash when running a NAPI module that tried to call\nthe <red>{s}<r> libuv function.\n\nBun is actively working on supporting all libuv functions for POSIX\nsystems, please see this issue to track our progress:\n\n<cyan>https://github.com/oven-sh/bun/issues/18546<r>\n\n";
                        if write!(writer, "{}", Output::pretty_fmt_args(fmt, true, format_args!("{}", bstr::BStr::new(name)))).is_err() { abort(); }
                        // SAFETY: single-threaded mutation under panic_mutex
                        unsafe { HAS_PRINTED_MESSAGE = true; }
                    }
                } else {
                    if enable_ansi_colors_stderr() {
                        if writer.write_all(&Output::pretty_fmt::<true>("<red>")).is_err() { abort(); }
                    }
                    if writer.write_all(b"oh no").is_err() { abort(); }
                    if enable_ansi_colors_stderr() {
                        if writer.write_all(&Output::pretty_fmt::<true>("<r><d>: multiple threads are crashing<r>\n")).is_err() { abort(); }
                    } else {
                        if writer.write_all(&Output::pretty_fmt::<true>(": multiple threads are crashing\n")).is_err() { abort(); }
                    }
                }

                if !matches!(reason, CrashReason::OutOfMemory) || debug_trace {
                    if enable_ansi_colors_stderr() {
                        if writer.write_all(&Output::pretty_fmt::<true>("<red>")).is_err() { abort(); }
                    }

                    if writer.write_all(b"panic").is_err() { abort(); }

                    if enable_ansi_colors_stderr() {
                        if writer.write_all(&Output::pretty_fmt::<true>("<r><d>")).is_err() { abort(); }
                    }

                    if cli_state::is_main_thread() {
                        if writer.write_all(b"(main thread)").is_err() { abort(); }
                    } else {
                        #[cfg(windows)]
                        {
                            // TODO(b2-blocked): bun_sys::windows::GetThreadDescription / PWSTR / HRESULT_CODE
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
                                if write!(writer, "({})", bun_fmt::utf16(span)).is_err() { abort(); }
                            } else {
                                // SAFETY: GetCurrentThreadId is an infallible Win32 call with no pointer/precondition requirements
                                if write!(writer, "(thread {})", unsafe { bun_sys::c::GetCurrentThreadId() }).is_err() { abort(); }
                            }
                            }
                        }
                        #[cfg(any(target_os = "macos", target_os = "linux", target_os = "freebsd"))]
                        { /* no-op */ }
                        // TODO(port): wasm @compileError("TODO")
                    }

                    if writer.write_all(b": ").is_err() { abort(); }
                    if enable_ansi_colors_stderr() {
                        if writer.write_all(&Output::pretty_fmt::<true>("<r>")).is_err() { abort(); }
                    }
                    if write!(writer, "{}\n", reason).is_err() { abort(); }
                }

                if let Some(action) = CURRENT_ACTION.with(|c| c.get()) {
                    if write!(writer, "Crashed while {}\n", action).is_err() { abort(); }
                }

                let mut addr_buf: [usize; 20] = [0; 20];
                let trace_buf: StackTrace;

                // If a trace was not provided, compute one now
                // PORT NOTE: reshaped for borrowck — Zig held a StackTrace
                // borrowing addr_buf while overwriting addr_buf; here we capture
                // the index into a scalar, drop the borrow, mutate, then rebuild.
                let trace: &StackTrace = 'blk: {
                    if let Some(ert) = error_return_trace {
                        if ert.index > 0 {
                            break 'blk ert;
                        }
                    }
                    let desired_begin_addr = begin_addr.unwrap_or_else(|| debug::return_address());
                    let mut idx: usize = debug::capture_stack_trace(desired_begin_addr, &mut addr_buf);

                    #[cfg(all(target_os = "linux", target_env = "gnu"))]
                    {
                        let mut addr_buf_libc: [usize; 20] = [0; 20];
                        // capture_libc_backtrace only writes `.index` on the StackTrace and
                        // writes frames into `addrs`; pass an empty-slice trace for the index.
                        let mut idx_holder = StackTrace { index: 0, instruction_addresses: &[] };
                        capture_libc_backtrace(desired_begin_addr, &mut addr_buf_libc, &mut idx_holder);
                        // Use stack trace from glibc's backtrace() if it has more frames
                        if idx_holder.index > idx {
                            addr_buf = addr_buf_libc;
                            idx = idx_holder.index;
                        }
                    }
                    trace_buf = StackTrace { index: idx, instruction_addresses: &addr_buf };
                    break 'blk &trace_buf;
                };

                if debug_trace {
                    // SAFETY: single-threaded mutation under panic_mutex
                    unsafe { HAS_PRINTED_MESSAGE = true; }

                    dump_stack_trace(trace, WriteStackTraceLimits::default());

                    if write!(trace_str_buf.writer(), "{}", TraceString {
                        trace,
                        reason,
                        action: TraceStringAction::ViewTrace,
                    }).is_err() { abort(); }
                } else {
                    // SAFETY: single-threaded read under panic_mutex
                    if unsafe { !HAS_PRINTED_MESSAGE } {
                        // SAFETY: single-threaded mutation under panic_mutex
                        unsafe { HAS_PRINTED_MESSAGE = true; }
                        if writer.write_all(b"oh no").is_err() { abort(); }
                        if enable_ansi_colors_stderr() {
                            if writer.write_all(&Output::pretty_fmt::<true>("<r><d>:<r> ")).is_err() { abort(); }
                        } else {
                            if writer.write_all(&Output::pretty_fmt::<true>(": ")).is_err() { abort(); }
                        }
                        if let Some(name) = INSIDE_NATIVE_PLUGIN.with(|c| c.get()) {
                            // SAFETY: name was set from a valid NUL-terminated C string
                            let native_plugin_name = unsafe { core::ffi::CStr::from_ptr(name) }.to_bytes();
                            if write!(writer, "{}", Output::pretty_fmt_args(
                                "Bun has encountered a crash while running the <red><d>\"{s}\"<r> native plugin.\n\nTo send a redacted crash report to Bun's team,\nplease file a GitHub issue using the link below:\n\n",
                                true,
                                format_args!("{}", bstr::BStr::new(native_plugin_name)),
                            )).is_err() { abort(); }
                        } else if UNSUPPORTED_UV_FUNCTION.with(|c| c.get()).is_some() {
                            // TODO(b2-blocked): bun_analytics::Features::unsupported_uv_function
                            let name: &[u8] = UNSUPPORTED_UV_FUNCTION.with(|c| c.get())
                                .map(|p| {
                                    // SAFETY: p was set from a valid NUL-terminated C string via CrashHandler__unsupportedUVFunction
                                    unsafe { core::ffi::CStr::from_ptr(p) }.to_bytes()
                                })
                                .unwrap_or(b"<unknown>");
                            let fmt = "Bun encountered a crash when running a NAPI module that tried to call\nthe <red>{s}<r> libuv function.\n\nBun is actively working on supporting all libuv functions for POSIX\nsystems, please see this issue to track our progress:\n\n<cyan>https://github.com/oven-sh/bun/issues/18546<r>\n\n";
                            if write!(writer, "{}", Output::pretty_fmt_args(fmt, true, format_args!("{}", bstr::BStr::new(name)))).is_err() { abort(); }
                        } else if matches!(reason, CrashReason::OutOfMemory) {
                            if writer.write_all(
                                b"Bun has run out of memory.\n\nTo send a redacted crash report to Bun's team,\nplease file a GitHub issue using the link below:\n\n",
                            ).is_err() { abort(); }
                        } else {
                            if writer.write_all(
                                b"Bun has crashed. This indicates a bug in Bun, not your code.\n\nTo send a redacted crash report to Bun's team,\nplease file a GitHub issue using the link below:\n\n",
                            ).is_err() { abort(); }
                        }
                    }

                    if enable_ansi_colors_stderr() {
                        if writer.write_all(&Output::pretty_fmt::<true>("<cyan>")).is_err() { abort(); }
                    }

                    if writer.write_all(b" ").is_err() { abort(); }

                    if write!(trace_str_buf.writer(), "{}", TraceString {
                        trace,
                        reason,
                        action: TraceStringAction::OpenIssue,
                    }).is_err() { abort(); }

                    if writer.write_all(trace_str_buf.const_slice()).is_err() { abort(); }

                    if writer.write_all(b"\n").is_err() { abort(); }
                }

                if enable_ansi_colors_stderr() {
                    if writer.write_all(&Output::pretty_fmt::<true>("<r>\n")).is_err() { abort(); }
                } else {
                    if writer.write_all(b"\n").is_err() { abort(); }
                }
            }

            // Be aware that this function only lets one thread return from it.
            // This is important so that we do not try to run the following reload logic twice.
            wait_for_other_thread_to_finish_panicking();

            report(trace_str_buf.const_slice());

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

                // TODO(port): pretty_fmt! color tags — runtime rewrite via pretty_fmt_args
                Output::pretty_errorln(&format_args!(
                    "<d>--- Bun is auto-restarting due to crash <d>[time: <b>{}<r><d>] ---<r>",
                    bun_core::time::milli_timestamp().max(0),
                ));
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
            let stderr = &mut stderr_writer();
            if write!(stderr, "\npanic: {}\n", reason).is_err() { abort(); }
            if write!(stderr, "panicked during a panic. Aborting.\n").is_err() { abort(); }
        }
        3 => {
            // Panicked while printing "Panicked during a panic."
            PANIC_STAGE.with(|s| s.set(4));
        }
        _ => {
            // Panicked or otherwise looped into the panic handler while trying to exit.
            abort();
        }
    }

    crash();
}

/// This is called when `main` returns a Zig error.
/// We don't want to treat it as a crash under certain error codes.
pub fn handle_root_error(err: bun_core::Error, error_return_trace: Option<&StackTrace>) -> ! {
    use bun_core::{err_generic, note, pretty_error, pretty_errorln};

    /// Zig: `std.posix.getrlimit(.NOFILE)`. bun_sys::posix has no rlimit yet —
    /// thin libc wrapper (POD out-param, never fails on supported targets).
    #[cfg(unix)]
    fn getrlimit_nofile() -> Option<libc::rlimit> {
        // SAFETY: zeroed rlimit is valid POD; getrlimit only writes to it.
        let mut lim: libc::rlimit = unsafe { core::mem::zeroed() };
        // SAFETY: &mut lim is a valid out-pointer.
        if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut lim) } == 0 { Some(lim) } else { None }
    }

    let mut show_trace = Environment::SHOW_CRASH_TRACE;

    // Match against interned error consts (see PORTING.md §Idiom map: catch |e| switch (e))
    if err == bun_core::err!("OutOfMemory") {
        super::out_of_memory();
    } else if err == bun_core::err!("InvalidArgument")
        || err == bun_core::err!("Invalid Bunfig")
        || err == bun_core::err!("InstallFailed")
    {
        if !show_trace {
            Global::exit(1);
        }
    } else if err == bun_core::err!("SyntaxError") {
        Output::err("SyntaxError", "An error occurred while parsing code", ());
    } else if err == bun_core::err!("CurrentWorkingDirectoryUnlinked") {
        err_generic!(
            "The current working directory was deleted, so that command didn't work. Please cd into a different directory and try again.",
        );
    } else if err == bun_core::err!("SystemFdQuotaExceeded") {
        #[cfg(unix)]
        {
            let limit = getrlimit_nofile().map(|l| l.rlim_cur);
            #[cfg(target_os = "macos")]
            {
                pretty_error!(
                    "<r><red>error<r>: Your computer ran out of file descriptors <d>(<red>SystemFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>sudo launchctl limit maxfiles 2147483646<r>\n  <cyan>ulimit -n 2147483646<r>\n\nThat will only work until you reboot.\n",
                    bun_fmt::nullable_fallback(limit, b"<unknown>"),
                );
            }
            #[cfg(target_os = "freebsd")]
            {
                pretty_error!(
                    "\n<r><red>error<r>: Your computer ran out of file descriptors <d>(<red>SystemFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>sudo sysctl kern.maxfiles=2147483646 kern.maxfilesperproc=2147483646<r>\n  <cyan>ulimit -n 2147483646<r>\n\nTo persist across reboots, add to /etc/sysctl.conf and edit /etc/login.conf.\n",
                    bun_fmt::nullable_fallback(limit, b"<unknown>"),
                );
            }
            #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
            {
                pretty_error!(
                    "\n<r><red>error<r>: Your computer ran out of file descriptors <d>(<red>SystemFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>sudo echo -e \"\\nfs.file-max=2147483646\\n\" >> /etc/sysctl.conf<r>\n  <cyan>sudo sysctl -p<r>\n  <cyan>ulimit -n 2147483646<r>\n",
                    bun_fmt::nullable_fallback(limit, b"<unknown>"),
                );

                if let Some(user) = env_var::USER::get() {
                    if !user.is_empty() {
                        let user = bstr::BStr::new(user);
                        pretty_error!(
                            "\nIf that still doesn't work, you may need to add these lines to /etc/security/limits.conf:\n\n <cyan>{} soft nofile 2147483646<r>\n <cyan>{} hard nofile 2147483646<r>\n",
                            user, user,
                        );
                    }
                }
            }
        }
        #[cfg(not(unix))]
        {
            pretty_error!(
                "<r><red>error<r>: Your computer ran out of file descriptors <d>(<red>SystemFdQuotaExceeded<r><d>)<r>",
            );
        }
    } else if err == bun_core::err!("ProcessFdQuotaExceeded") {
        #[cfg(unix)]
        {
            let limit = getrlimit_nofile().map(|l| l.rlim_cur);
            #[cfg(target_os = "macos")]
            {
                pretty_error!(
                    "\n<r><red>error<r>: bun ran out of file descriptors <d>(<red>ProcessFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>ulimit -n 2147483646<r>\n\nYou may also need to run:\n\n  <cyan>sudo launchctl limit maxfiles 2147483646<r>\n",
                    bun_fmt::nullable_fallback(limit, b"<unknown>"),
                );
            }
            #[cfg(target_os = "freebsd")]
            {
                pretty_error!(
                    "\n<r><red>error<r>: bun ran out of file descriptors <d>(<red>ProcessFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>ulimit -n 2147483646<r>\n  <cyan>sudo sysctl kern.maxfilesperproc=2147483646<r>\n",
                    bun_fmt::nullable_fallback(limit, b"<unknown>"),
                );
            }
            #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
            {
                pretty_error!(
                    "\n<r><red>error<r>: bun ran out of file descriptors <d>(<red>ProcessFdQuotaExceeded<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>ulimit -n 2147483646<r>\n\nThat will only work for the current shell. To fix this for the entire system, run:\n\n  <cyan>sudo echo -e \"\\nfs.file-max=2147483646\\n\" >> /etc/sysctl.conf<r>\n  <cyan>sudo sysctl -p<r>\n",
                    bun_fmt::nullable_fallback(limit, b"<unknown>"),
                );

                if let Some(user) = env_var::USER::get() {
                    if !user.is_empty() {
                        let user = bstr::BStr::new(user);
                        pretty_error!(
                            "\nIf that still doesn't work, you may need to add these lines to /etc/security/limits.conf:\n\n <cyan>{} soft nofile 2147483646<r>\n <cyan>{} hard nofile 2147483646<r>\n",
                            user, user,
                        );
                    }
                }
            }
        }
        #[cfg(not(unix))]
        {
            pretty_errorln!(
                "<r><red>error<r>: bun ran out of file descriptors <d>(<red>ProcessFdQuotaExceeded<r><d>)<r>",
            );
        }
    } else if err == bun_core::err!("NotOpenForReading") || err == bun_core::err!("Unexpected") {
        // The usage of `unreachable` in Zig's std.posix may cause the file descriptor problem to show up as other errors
        #[cfg(unix)]
        {
            // SAFETY: zeroed rlimit is valid POD (integers).
            let limit = getrlimit_nofile().unwrap_or(unsafe { core::mem::zeroed() });

            if limit.rlim_cur > 0 && limit.rlim_cur < (8192 * 2) {
                pretty_error!(
                    "\n<r><red>error<r>: An unknown error occurred, possibly due to low max file descriptors <d>(<red>Unexpected<r><d>)<r>\n\n<d>Current limit: {}<r>\n\nTo fix this, try running:\n\n  <cyan>ulimit -n 2147483646<r>\n",
                    limit.rlim_cur,
                );

                #[cfg(target_os = "linux")]
                {
                    if let Some(user) = env_var::USER::get() {
                        if !user.is_empty() {
                            let user = bstr::BStr::new(user);
                            pretty_error!(
                                "\nIf that still doesn't work, you may need to add these lines to /etc/security/limits.conf:\n\n <cyan>{} soft nofile 2147483646<r>\n <cyan>{} hard nofile 2147483646<r>\n",
                                user, user,
                            );
                        }
                    }
                }
                #[cfg(target_os = "macos")]
                {
                    pretty_error!(
                        "\nIf that still doesn't work, you may need to run:\n\n  <cyan>sudo launchctl limit maxfiles 2147483646<r>\n",
                    );
                }
            } else {
                err_generic!(
                    "An unknown error occurred <d>(<red>{}<r><d>)<r>",
                    bstr::BStr::new(err.name()),
                );
                show_trace = true;
            }
        }
        #[cfg(not(unix))]
        {
            err_generic!(
                "An unknown error occurred <d>(<red>{}<r><d>)<r>",
                bstr::BStr::new(err.name()),
            );
            show_trace = true;
        }
    } else if err == bun_core::err!("ENOENT") || err == bun_core::err!("FileNotFound") {
        Output::err(
            "ENOENT",
            "Bun could not find a file, and the code that produces this error is missing a better error.",
            (),
        );
    } else if err == bun_core::err!("MissingPackageJSON") {
        err_generic!("Bun could not find a package.json file to install from");
        Output::note("Run \"bun init\" to initialize a project");
    } else {
        // PORT NOTE: Zig picked the format string at comptime; the macros need
        // `:literal`, so branch on the const and call separately.
        if Environment::SHOW_CRASH_TRACE {
            err_generic!("'main' returned <red>error.{}<r>", bstr::BStr::new(err.name()));
        } else {
            err_generic!("An internal error occurred (<red>{}<r>)", bstr::BStr::new(err.name()));
        }
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
        Some(begin_addr.unwrap_or_else(|| debug::return_address())),
    );
}

fn panic_builtin(msg: &[u8], error_return_trace: Option<&StackTrace>, begin_addr: Option<usize>) -> ! {
    // TODO(port): std.debug.panicImpl — fall back to Rust's std panic machinery
    debug::panic_impl(error_return_trace, begin_addr, msg);
}

pub const PANIC: fn(&[u8], Option<&StackTrace>, Option<usize>) -> ! = if ENABLE { panic_impl } else { panic_builtin };

pub fn report_base_url() -> &'static [u8] {
    // PORTING.md §Concurrency: OnceLock for lazy global init (was static mut Option).
    static BASE_URL: std::sync::OnceLock<&'static [u8]> = std::sync::OnceLock::new();
    *BASE_URL.get_or_init(|| {
        if let Some(url) = env_var::BUN_CRASH_REPORT_URL::get() {
            return strings::without_trailing_slash(url);
        }
        DEFAULT_REPORT_BASE_URL.as_bytes()
    })
}

const ARCH_DISPLAY_STRING: &str = if cfg!(target_arch = "aarch64") {
    if cfg!(target_os = "macos") { "Silicon" } else { "arm64" }
} else {
    "x64"
};

// TODO(port): std.fmt.comptimePrint — use const_format::formatcp!
const METADATA_VERSION_LINE: &str = const_format::formatcp!(
    "Bun {}v{} {} {}{}\n",
    if cfg!(debug_assertions) { "Debug " } else if Environment::IS_CANARY { "Canary " } else { "" },
    bun_core::package_json_version_with_sha,
    bun_core::os_display,
    ARCH_DISPLAY_STRING,
    if Environment::BASELINE { " (baseline)" } else { "" },
);

#[cfg(unix)]
extern "C" fn handle_segfault_posix(sig: c_int, info: *mut libc::siginfo_t, _: *mut c_void) {
    // SAFETY: kernel provides a valid siginfo_t; `si_addr` reads the per-platform
    // sigfault address field (Zig: `info.fields.sigfault.addr` / `info.addr`).
    let addr: usize = unsafe { (*info).si_addr() as usize };

    crash_handler(
        match sig {
            libc::SIGSEGV => CrashReason::SegmentationFault(addr),
            libc::SIGILL => CrashReason::IllegalInstruction(addr),
            libc::SIGBUS => CrashReason::BusError(addr),
            libc::SIGFPE => CrashReason::FloatingPointError(addr),
            // we do not register this handler for other signals
            _ => unreachable!(),
        },
        None,
        Some(debug::return_address()),
    );
}

#[cfg(unix)]
static mut DID_REGISTER_SIGALTSTACK: bool = false;
#[cfg(unix)]
static mut SIGALTSTACK: [u8; 512 * 1024] = [0; 512 * 1024];

#[cfg(unix)]
fn update_posix_segfault_handler(mut act: Option<&mut libc::sigaction>) -> Result<(), bun_core::Error> {
    if let Some(act_) = act.as_deref_mut() {
        // SAFETY: single global; only mutated during signal-handler setup
        if unsafe { !DID_REGISTER_SIGALTSTACK } {
            let stack = libc::stack_t {
                ss_flags: 0,
                // SAFETY: SIGALTSTACK is a process-lifetime static byte buffer; taking its len requires only a shared ref to a `static mut`
                ss_size: unsafe { SIGALTSTACK.len() },
                // SAFETY: SIGALTSTACK is a process-lifetime static byte buffer; the kernel only writes to it during signal delivery (no Rust aliasing)
                ss_sp: unsafe { SIGALTSTACK.as_mut_ptr().cast() },
            };

            // SAFETY: stack points to a valid static buffer
            if unsafe { libc::sigaltstack(&stack, core::ptr::null_mut()) } == 0 {
                act_.sa_flags |= libc::SA_ONSTACK;
                // SAFETY: single global; only mutated during signal-handler setup
                unsafe { DID_REGISTER_SIGALTSTACK = true; }
            }
        }
    }

    let act_ptr: *const libc::sigaction = act.map(|a| a as *const _).unwrap_or(core::ptr::null());
    // SAFETY: valid sigaction pointer or null; null oldact is permitted.
    unsafe {
        libc::sigaction(libc::SIGSEGV, act_ptr, core::ptr::null_mut());
        libc::sigaction(libc::SIGILL, act_ptr, core::ptr::null_mut());
        libc::sigaction(libc::SIGBUS, act_ptr, core::ptr::null_mut());
        libc::sigaction(libc::SIGFPE, act_ptr, core::ptr::null_mut());
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
    // Zig: std.posix.Sigaction{ .handler = .{ .sigaction = handleSegfaultPosix }, ... }.
    // SAFETY: zeroed sigaction is valid POD; we overwrite the fields we need.
    let mut act: libc::sigaction = unsafe { core::mem::zeroed() };
    act.sa_sigaction = handle_segfault_posix as *const () as usize;
    act.sa_flags = libc::SA_SIGINFO | libc::SA_RESTART | libc::SA_RESETHAND;
    // SAFETY: sa_mask is a valid out-pointer.
    unsafe { libc::sigemptyset(&mut act.sa_mask); }
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

    install_hooks();
}

/// One-shot hook registration into lower-tier crates (CYCLEBREAK §Debug-hook).
///
/// `bun_core` cannot depend on `crash_handler` (T0 → T3 would cycle), so it
/// exposes `Global::RESET_SEGV: AtomicPtr<()>` and calls through it as a
/// no-op-if-null thunk. We populate it here at startup. The remaining
/// `DUMP_STACK` hooks (`bun_safety` / `bun_ptr` / `bun_sys`) are written by
/// `bun_runtime::init()` using the `dump_stack_hook_for_*` shims below — those
/// crates sit beside or above us in the tier graph, so the registrant lives at
/// T6.
pub fn install_hooks() {
    Global::RESET_SEGV.store(
        reset_segfault_handler as fn() as *mut (),
        Ordering::Relaxed,
    );
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
        // SAFETY: zeroed sigaction is valid POD; handler = SIG_DFL (= 0), flags = 0.
        let mut act: libc::sigaction = unsafe { core::mem::zeroed() };
        act.sa_sigaction = libc::SIG_DFL;
        // SAFETY: sa_mask is a valid out-pointer.
        unsafe { libc::sigemptyset(&mut act.sa_mask); }
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

pub fn print_metadata(writer: &mut impl Write) -> Result<(), bun_core::Error> {
    #[cfg(debug_assertions)]
    {
        if Output::is_ai_agent() {
            return Ok(());
        }
    }

    if enable_ansi_colors_stderr() {
        writer.write_all(&Output::pretty_fmt::<true>("<r><d>"))?;
    }

    let mut is_ancient_cpu = false;

    writer.write_all(METADATA_VERSION_LINE.as_bytes())?;
    {
        let cpu_features = CPUFeatures::get();
        
        // TODO(b2-blocked): bun_analytics::GenerateHeader::GeneratePlatform
        {
        let platform = bun_analytics::GenerateHeader::generate_platform::for_os();
        #[cfg(all(target_os = "linux", target_env = "gnu"))]
        {
            // SAFETY: gnu_get_libc_version returns a static NUL-terminated string or null
            let version = unsafe { gnu_get_libc_version() };
            let version_bytes: &[u8] = if version.is_null() {
                b""
            } else {
                // SAFETY: non-null branch — gnu_get_libc_version returned a valid C string.
                unsafe { core::ffi::CStr::from_ptr(version) }.to_bytes()
            };
            let kernel_version = bun_analytics::GenerateHeader::generate_platform::kernel_version();
            if platform.os == bun_analytics::schema::analytics::OperatingSystem::wsl {
                write!(writer, "WSL Kernel v{}.{}.{} | glibc v{}\n", kernel_version.major, kernel_version.minor, kernel_version.patch, bstr::BStr::new(version_bytes)).map_err(fmt_err)?;
            } else {
                write!(writer, "Linux Kernel v{}.{}.{} | glibc v{}\n", kernel_version.major, kernel_version.minor, kernel_version.patch, bstr::BStr::new(version_bytes)).map_err(fmt_err)?;
            }
        }
        #[cfg(all(target_os = "linux", target_env = "musl"))]
        {
            let kernel_version = generate_platform::kernel_version();
            write!(writer, "Linux Kernel v{}.{}.{} | musl\n", kernel_version.major, kernel_version.minor, kernel_version.patch).map_err(fmt_err)?;
        }
        #[cfg(target_os = "android")]
        {
            let kernel_version = generate_platform::kernel_version();
            write!(writer, "Android Kernel v{}.{}.{} | bionic\n", kernel_version.major, kernel_version.minor, kernel_version.patch).map_err(fmt_err)?;
        }
        #[cfg(target_os = "freebsd")]
        {
            write!(writer, "FreeBSD Kernel v{}\n", bstr::BStr::new(platform.version)).map_err(fmt_err)?;
        }
        #[cfg(target_os = "macos")]
        {
            write!(writer, "macOS v{}\n", bstr::BStr::new(platform.version)).map_err(fmt_err)?;
        }
        #[cfg(windows)]
        {
            // TODO(port): std.zig.system.windows.detectRuntimeVersion()
            write!(writer, "Windows v{}\n", bun_sys::windows::detect_runtime_version()).map_err(fmt_err)?;
        }
        } // end  — bun_analytics platform block

        #[cfg(target_arch = "x86_64")]
        {
            is_ancient_cpu = !cpu_features.has_any_avx();
        }

        if !cpu_features.is_empty() {
            write!(writer, "CPU: {}\n", cpu_features).map_err(fmt_err)?;
        }

        write!(writer, "Args: ").map_err(fmt_err)?;
        let mut arg_chars_left: usize = if cfg!(debug_assertions) { 4096 } else { 196 };
        for (i, arg) in bun_core::argv().iter().enumerate() {
            if i != 0 {
                writer.write_all(b" ")?;
            }
            bun_fmt::quoted_writer(writer, &arg[0..arg.len().min(arg_chars_left)]).map_err(fmt_err)?;
            arg_chars_left = arg_chars_left.saturating_sub(arg.len());
            if arg_chars_left == 0 {
                writer.write_all(b"...")?;
                break;
            }
        }
    }
    
    // TODO(b2-blocked): bun_analytics::Features::formatter
    { write!(writer, "\n{}", bun_analytics::features::formatter()).map_err(fmt_err)?; }
    writer.write_all(b"\n")?;

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
        write!(writer, "Elapsed: {}ms | User: {}ms | Sys: {}ms\n", elapsed_msecs, user_msecs, system_msecs).map_err(fmt_err)?;

        // TODO(port): {B:<3.2} byte-size formatting — bun_fmt::bytes() doesn't take width/prec yet
        write!(
            writer,
            "RSS: {} | Peak: {} | Commit: {} | Faults: {}",
            bun_fmt::bytes(current_rss),
            bun_fmt::bytes(peak_rss),
            bun_fmt::bytes(current_commit),
            page_faults,
        ).map_err(fmt_err)?;

        // SAFETY: read-only access to exported global
        if unsafe { Bun__reported_memory_size } > 0 {
            write!(writer, " | Machine: {}", bun_fmt::bytes(unsafe { Bun__reported_memory_size })).map_err(fmt_err)?;
        }

        writer.write_all(b"\n")?;
    }

    if enable_ansi_colors_stderr() {
        writer.write_all(&Output::pretty_fmt::<true>("<r>"))?;
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

// Zig: `if (git_sha.len > 0) git_sha[0..7] else "unknown"` — the v1/v2 trace-string
// format encodes exactly 7 hex chars. `Environment::GIT_SHA_SHORT` is 9 chars and would
// shift every following VLQ byte, making bun.report unable to decode the URL.
const GIT_SHA: &str = {
    const fn sha7(s: &'static str) -> &'static str {
        let bytes = s.as_bytes();
        // SAFETY: GIT_SHA is ASCII hex; the first 7 bytes are a valid UTF-8 prefix
        // and `bytes` is at least 7 long when non-empty (full 40-char commit hash).
        unsafe {
            core::str::from_utf8_unchecked(core::slice::from_raw_parts(bytes.as_ptr(), 7))
        }
    }
    if !Environment::GIT_SHA.is_empty() { sha7(Environment::GIT_SHA) } else { "unknown" }
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
    pub(crate) fn from_address(addr: usize, name_bytes: &mut [u8]) -> Option<StackLine> {
        #[cfg(windows)]
        {
            let module = bun_sys::windows::get_module_handle_from_address(addr)?;

            let base_address = module as usize;

            let mut temp: [u16; 512] = [0; 512];
            let name = bun_sys::windows::get_module_name_w(module, &mut temp)?;

            let image_path = bun_sys::windows::exe_path_w();

            return Some(StackLine {
                // To remap this, `pdb-addr2line --exe bun.pdb 0x123456`
                address: i32::try_from(addr - base_address).expect("int cast"),

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
                                        address: i32::try_from(image_relative_address).expect("int cast"),
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

            unsafe extern "C" fn callback(info: *mut libc::dl_phdr_info, _size: libc::size_t, context: *mut c_void) -> c_int {
                // SAFETY: dl_iterate_phdr passes a valid info pointer; context is &mut Ctx
                let context = unsafe { &mut *(context as *mut Ctx) };
                // SAFETY: dl_iterate_phdr passes a valid info pointer.
                let info = unsafe { &*info };
                // PORT NOTE: Zig `defer context.i += 1` reshaped — bump on every return.
                let i = context.i;
                context.i += 1;

                if context.address < info.dlpi_addr as usize { return 0; }
                // SAFETY: dlpi_phdr points to dlpi_phnum entries.
                let phdrs = unsafe { core::slice::from_raw_parts(info.dlpi_phdr, info.dlpi_phnum as usize) };
                for phdr in phdrs {
                    if phdr.p_type != libc::PT_LOAD { continue; }

                    // Overflowing addition is used to handle the case of VSDOs
                    // having a p_vaddr = 0xffffffffff700000
                    let seg_start = (info.dlpi_addr as usize).wrapping_add(phdr.p_vaddr as usize);
                    let seg_end = seg_start + phdr.p_memsz as usize;
                    if context.address >= seg_start && context.address < seg_end {
                        // const name = bun.sliceTo(info.name, 0) orelse "";
                        let _ = i;
                        context.result = Some(StackLine {
                            address: i32::try_from(context.address - info.dlpi_addr as usize).expect("int cast"),
                            object: None,
                        });
                        return 1; // error.Found → stop iteration
                    }
                }
                0
            }

            // SAFETY: ctx outlives the dl_iterate_phdr call; callback signature matches libc's contract.
            unsafe {
                libc::dl_iterate_phdr(Some(callback), &mut ctx as *mut Ctx as *mut c_void);
            }

            let _ = name_bytes;
            return ctx.result;
        }
    }

    pub(crate) fn write_encoded(self_: Option<&StackLine>, writer: &mut impl Write) -> Result<(), bun_core::Error> {
        let Some(known) = self_ else {
            writer.write_all(b"_")?;
            return Ok(());
        };

        if let Some(object) = &known.object {
            writer.write_all(VLQ::encode(1).slice())?;
            writer.write_all(VLQ::encode(i32::try_from(object.len()).expect("int cast")).slice())?;
            writer.write_all(object)?;
        }

        writer.write_all(VLQ::encode(known.address).slice())?;
        Ok(())
    }

    pub(crate) fn write_decoded(self_: Option<&StackLine>, writer: &mut impl Write) -> Result<(), bun_core::Error> {
        let Some(known) = self_ else {
            return writer.write_all(b"???");
        };
        let _ = write!(writer, "{}", known);
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
    trace: &'a StackTrace<'a>,
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
        // encode_trace_string takes a byte writer; bridge fmt::Formatter via adapter
        let _ = encode_trace_string(self, &mut FmtAdapter(writer));
        Ok(())
    }
}

fn encode_trace_string(opts: &TraceString<'_>, writer: &mut impl Write) -> Result<(), bun_core::Error> {
    writer.write_all(report_base_url())?;
    writer.write_all(b"/")?;
    writer.write_all(Environment::VERSION_STRING.as_bytes())?;
    writer.write_all(b"/")?;
    writer.write_all(&[Platform::CURRENT as u8])?;
    writer.write_byte(cli_state::cmd_char().unwrap_or(b'_'))?;

    writer.write_all(VERSION_CHAR.as_bytes())?;
    writer.write_all(GIT_SHA.as_bytes())?;

    // TODO(b2-blocked): bun_analytics::packed_features
    let packed_features: u64 = 0;
    write_u64_as_two_vlqs(writer, packed_features as usize)?;

    let mut name_bytes: [u8; 1024] = [0; 1024];

    for &addr in &opts.trace.instruction_addresses[0..opts.trace.index] {
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
                    u32::try_from(message.len()).expect("int cast") as bun_zlib::uLong,
                    9,
                ))
            };
            let compressed = match ret {
                bun_zlib::ReturnCode::Ok => &compressed_bytes[0..usize::try_from(len).expect("int cast")],
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

            writer.write_all(strings::trim_right(&b64_bytes[0..b64_len], b"="))?;
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

pub fn write_u64_as_two_vlqs(writer: &mut impl Write, addr: usize) -> Result<(), bun_core::Error> {
    // @bitCast(@as(u32, ...)) → reinterpret u32 as i32
    let first = VLQ::encode((((addr as u64) & 0xFFFFFFFF00000000) >> 32) as u32 as i32);
    let second = VLQ::encode(((addr as u64) & 0xFFFFFFFF) as u32 as i32);
    writer.write_all(first.slice())?;
    writer.write_all(second.slice())?;
    Ok(())
}

fn is_reporting_enabled() -> bool {
    if SUPPRESS_REPORTING.load(Ordering::Relaxed) {
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
    // TODO(b2-blocked): bun_analytics::is_enabled
    if env_var::DO_NOT_TRACK::get() == Some(true) {
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
        // TODO(b2-blocked): bun_sys::windows::PROCESS_INFORMATION / STARTUPINFOW / CreateProcessW
        // TODO(b2-blocked): bun_str::w! / strings::convert_utf8_to_utf16_in_buffer
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
            cmd_line.len += u32::try_from(encoded.len()).expect("int cast");
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
        let _ = url;
    }
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "freebsd"))]
    {
        let mut buf = bun_core::PathBuffer::default();
        let mut buf2 = bun_core::PathBuffer::default();
        let Some(path_env) = env_var::PATH::get() else { return; };
        let Ok(cwd) = bun_core::getcwd(&mut buf2) else { return; };
        // PORT NOTE: reshaped for borrowck — capture cwd bytes by value (it
        // borrows buf2, not buf, so no actual overlap; copy len for clarity).
        let cwd_bytes = cwd.as_bytes();
        let Some(curl) = bun_core::which(&mut buf, path_env, cwd_bytes, b"curl") else { return; };
        let mut cmd_line = BoundedArray::<u8, 4096>::default();
        if cmd_line.append_slice(url).is_err() { return; }
        if cmd_line.append_slice(b"/ack").is_err() { return; }
        if cmd_line.append(0).is_err() { return; }

        let argv: [*const c_char; 4] = [
            curl.as_ptr(),
            b"-fsSL\0".as_ptr().cast(),
            cmd_line.const_slice().as_ptr().cast(),
            core::ptr::null(),
        ];
        // SAFETY: fork is async-signal-safe; we're already in the crash path
        let result = unsafe { libc::fork() };
        match result {
            // child
            0 => {
                for i in 0..2 {
                    // SAFETY: closing stdin/stdout in child
                    unsafe { libc::close(i); }
                }
                unsafe extern "C" { static environ: *const *const c_char; }
                // SAFETY: argv is NUL-terminated array of NUL-terminated strings; environ is the
                // process environment block
                unsafe { libc::execve(argv[0], argv.as_ptr(), environ); }
                // SAFETY: _exit is async-signal-safe in the forked child
                unsafe { libc::_exit(0); }
            }
            // success and failure cases: ignore the result
            _ => return,
        }
    }
    // TODO(port): wasm @compileError("Not implemented")
    let _ = url;
}

/// Crash. Make sure segfault handlers are off so that this doesnt trigger the crash handler.
/// This causes a segfault on posix systems to try to get a core dump.
fn crash() -> ! {
    #[cfg(not(windows))]
    {
        // Install default handler so that the tkill below will terminate.
        // Zig: std.posix.Sigaction{ .handler = SIG.DFL, .mask = sigemptyset(), .flags = 0 }.
        // bun_sys::posix has no Sigaction yet — use libc directly (async-signal-safe).
        // SAFETY: all-zero is a valid sigaction (handler = SIG_DFL = 0, flags = 0).
        let mut sigact: libc::sigaction = unsafe { core::mem::zeroed() };
        sigact.sa_sigaction = libc::SIG_DFL;
        // SAFETY: sa_mask is a valid out-pointer into a zeroed struct.
        unsafe { libc::sigemptyset(&mut sigact.sa_mask); }
        for sig in [
            libc::SIGSEGV,
            libc::SIGILL,
            libc::SIGBUS,
            libc::SIGABRT,
            libc::SIGFPE,
            libc::SIGHUP,
            libc::SIGTERM,
        ] {
            // SAFETY: &sigact is a valid sigaction; null oldact is permitted.
            unsafe { libc::sigaction(sig, &sigact, core::ptr::null_mut()); }
        }
        // Zig: `@trap()` — emits ud2 (x86_64 → SIGILL) / brk (aarch64 → SIGTRAP).
        // `core::intrinsics::abort()` lowers to the same trap instruction, preserving
        // the Zig exit signal. Do NOT use `libc::abort()` here — that raises SIGABRT
        // (exit 134), which is the *Windows* path's behaviour.
        core::intrinsics::abort();
    }
    #[cfg(windows)]
    {
        // Node.js exits with code 134 (128 + SIGABRT) instead. We use abort() as it
        // includes a breakpoint which makes crashes easier to debug.
        // SAFETY: intentionally aborting to terminate the process.
        unsafe { libc::abort() }
    }
}

pub static mut VERBOSE_ERROR_TRACE: bool = false;

#[cold]
#[inline(never)]
fn cold_handle_error_return_trace<const IS_ROOT: bool>(
    err_int_workaround_for_zig_ccall_bug: u16,
    trace: &StackTrace,
) {
    // TODO(port): std.meta.Int(.unsigned, @bitSizeOf(anyerror)) — bun_core::Error is errno-based
    let err = bun_core::Error::from_errno(err_int_workaround_for_zig_ccall_bug as i32);

    // The format of the panic trace is slightly different in debug
    // builds Mainly, we demangle the backtrace immediately instead
    // of using a trace string.
    //
    // To make the release-mode behavior easier to demo, debug mode
    // checks for this CLI flag.
    let is_debug = cfg!(debug_assertions) && 'check_flag: {
        for arg in Output::argv() {
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
                Output::note("Release build will not have this trace by default:");
            }
        } else {
            bun_core::pretty_errorln!("<blue>note<r><d>:<r> caught error.{}:", bstr::BStr::new(err.name()));
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
            bun_core::pretty_errorln!(
                "\nTo send a redacted crash report to Bun's team,\nplease file a GitHub issue using the link below:\n\n <cyan>{}<r>\n",
                ts,
            );
        } else {
            bun_core::pretty_errorln!(
                "<cyan>trace<r>: error.{}: <d>{}<r>",
                bstr::BStr::new(err.name()), ts,
            );
        }
    }
}

#[inline]
fn handle_error_return_trace_extra<const IS_ROOT: bool>(err: bun_core::Error, maybe_trace: Option<&StackTrace>) {
    // TODO(port): builtin.have_error_return_tracing — Rust has no error-return tracing.
    // Phase B should decide whether to keep this entire mechanism or strip it.
    if !debug::HAVE_ERROR_RETURN_TRACING {
        return;
    }
    // SAFETY: read-only access
    if unsafe { !VERBOSE_ERROR_TRACE } && !IS_ROOT {
        return;
    }

    if let Some(trace) = maybe_trace {
        cold_handle_error_return_trace::<IS_ROOT>(err.as_u16(), trace);
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

/// `bun_core::__bun_dump_stack_trace` body — declared `extern "Rust"` in
/// `bun_core::Global` so T0 callers reach the symbolicating dumper without a
/// crate-dep cycle. The two `*Limits` structs are layout-twins; copy fields
/// rather than transmuting so a future divergence is a compile error here.
#[unsafe(no_mangle)]
pub fn __bun_dump_stack_trace(
    trace: &StackTrace<'_>,
    limits: &bun_core::DumpStackTraceOptions,
) {
    dump_stack_trace(
        trace,
        WriteStackTraceLimits {
            frame_count: limits.frame_count,
            stop_at_jsc_llint: limits.stop_at_jsc_llint,
            skip_stdlib: limits.skip_stdlib,
            skip_file_patterns: limits.skip_file_patterns,
            skip_function_patterns: limits.skip_function_patterns,
        },
    );
}

/// Version of the standard library dumpStackTrace that has some fallbacks for
/// cases where such logic fails to run.
pub fn dump_stack_trace(trace: &StackTrace, limits: WriteStackTraceLimits) {
    Output::flush();
    let stderr = &mut stderr_writer();
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
                let _ = write!(stderr, "Unable to dump stack trace: Unable to open debug info: {}\nFallback trace:\n", bstr::BStr::new(err.name()));
                break 'attempt_dump;
            }
        };
        match write_stack_trace(trace, stderr, debug_info, debug::detect_tty_config_stderr(), &limits) {
            Ok(()) => return,
            Err(err) => {
                let _ = write!(stderr, "Unable to dump stack trace: {}\nFallback trace:\n", bstr::BStr::new(err.name()));
                break 'attempt_dump;
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        // In non-debug builds, use WTF's stack trace printer and return early
        if !cfg!(debug_assertions) {
            // SAFETY: trace.instruction_addresses is a valid slice of `index` entries
            unsafe { WTF__DumpStackTrace(trace.instruction_addresses.as_ptr(), trace.index); }
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
                let _ = write!(stderr, "Unable to dump stack trace: Unable to open debug info: {}\n", bstr::BStr::new(err.name()));
                return;
            }
        };
        match write_stack_trace(trace, stderr, debug_info, debug::detect_tty_config_stderr(), &limits) {
            Ok(()) => return,
            Err(err) => {
                let _ = write!(stderr, "Unable to dump stack trace: {}", bstr::BStr::new(err.name()));
                return;
            }
        }
    }

    let programs: &[&bun_core::ZStr] = if cfg!(windows) {
        &[bun_core::zstr!("pdb-addr2line")]
    } else {
        // if `llvm-symbolizer` doesn't work, also try `llvm-symbolizer-21`
        &[bun_core::zstr!("llvm-symbolizer"), bun_core::zstr!("llvm-symbolizer-21")]
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
    let _ = limits;
    // Fallback: hand the raw addresses to WTF (always linked).
    // SAFETY: trace.instruction_addresses is a valid slice of `index` entries
    unsafe { WTF__DumpStackTrace(trace.instruction_addresses.as_ptr(), trace.index); }
}

fn spawn_symbolizer(program: &bun_core::ZStr, trace: &StackTrace) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let mut argv: Vec<Vec<u8>> = Vec::new();
    argv.push(program.as_bytes().to_vec());
    argv.push(b"--exe".to_vec());
    argv.push({
        #[cfg(windows)]
        {
            // TODO(port): bun_sys::windows::exe_path_w + strings::to_utf8_alloc
            let image_path = strings::to_utf8_alloc(bun_sys::windows::exe_path_w())?;
            let mut s = image_path[0..image_path.len() - 3].to_vec();
            s.extend_from_slice(b"pdb");
            s
        }
        #[cfg(not(windows))]
        {
            bun_core::self_exe_path()?.as_bytes().to_vec()
        }
    });

    let mut name_bytes: [u8; 1024] = [0; 1024];
    for &addr in &trace.instruction_addresses[0..trace.index] {
        let Some(line) = StackLine::from_address(addr, &mut name_bytes) else { continue; };
        argv.push(format!("0x{:X}", line.address).into_bytes());
    }

    // PORTING.md: no std::process — routed through bun_core::spawn_sync_inherit (posix_spawn).
    let stderr = &mut stderr_writer();
    let result = bun_core::spawn_sync_inherit(&argv).map_err(|err| {
        let _ = stderr.write_all(b"Failed to invoke command: ");
        let _ = fmt_argv(stderr, &argv);
        let _ = stderr.write_all(b"\n");
        if cfg!(windows) {
            let _ = stderr.write_all(b"(You can compile pdb-addr2line from https://github.com/oven-sh/bun.report, cd pdb-addr2line && cargo build)\n");
        }
        err
    })?;

    if !result.is_ok() {
        let _ = stderr.write_all(b"Failed to invoke command: ");
        let _ = fmt_argv(stderr, &argv);
        let _ = stderr.write_all(b"\n");
    }
    Ok(())
}

pub fn dump_current_stack_trace(first_address: Option<usize>, limits: WriteStackTraceLimits) {
    let mut addrs: [usize; 32] = [0; 32];
    let n = debug::capture_stack_trace(first_address.unwrap_or_else(|| debug::return_address()), &mut addrs);
    let stack = StackTrace { index: n, instruction_addresses: &addrs };
    dump_stack_trace(&stack, limits);
}

// ──────────────────────────────────────────────────────────────────────────
// Hook-provider shims (CYCLEBREAK §Debug-hook). `bun_runtime::init()` stores
// these fn-ptrs into the lower-tier `DUMP_STACK` AtomicPtr slots; the lower
// tiers transmute back to the exact signatures below and call through.
// PERF(port): was direct call — one indirect call on a cold debug/diagnostic
// path is acceptable.
// ──────────────────────────────────────────────────────────────────────────

/// Provider for `bun_sys::DUMP_STACK`.
/// Erased signature: `unsafe fn(Option<usize>, u32, bool)`.
pub unsafe fn dump_stack_hook_for_sys(
    return_address: Option<usize>,
    frame_count: u32,
    stop_at_jsc_llint: bool,
) {
    dump_current_stack_trace(return_address, WriteStackTraceLimits {
        frame_count: frame_count as usize,
        stop_at_jsc_llint,
        ..WriteStackTraceLimits::default()
    });
}

/// Provider for `bun_safety::DUMP_STACK`.
/// Erased signature: `unsafe fn(&bun_core::StoredTrace)`.
/// Uses the fixed limits the allocator-safety call sites want
/// (`frame_count = 10`, `stop_at_jsc_llint = true`).
pub unsafe fn dump_stack_hook_for_safety(stored: &bun_core::StoredTrace) {
    let addrs = stored.data;
    let stack = StackTrace { index: stored.index, instruction_addresses: &addrs };
    dump_stack_trace(&stack, WriteStackTraceLimits {
        frame_count: 10,
        stop_at_jsc_llint: true,
        ..WriteStackTraceLimits::default()
    });
}

/// Provider for `bun_ptr::DUMP_STACK`.
/// Erased signature: `unsafe fn(*const bun_core::StoredTrace, usize)`.
/// `stored == null` ⇒ capture the live stack starting at `ret_addr`.
pub unsafe fn dump_stack_hook_for_ptr(stored: *const bun_core::StoredTrace, ret_addr: usize) {
    if stored.is_null() {
        dump_current_stack_trace(
            if ret_addr == 0 { None } else { Some(ret_addr) },
            WriteStackTraceLimits::default(),
        );
    } else {
        // SAFETY: `bun_ptr::dump_stack_hook` passes a live `StoredTrace`.
        let stored = unsafe { &*stored };
        let addrs = stored.data;
        let stack = StackTrace { index: stored.index, instruction_addresses: &addrs };
        dump_stack_trace(&stack, WriteStackTraceLimits::default());
    }
}

/// If POSIX, and the existing soft limit for core dumps (ulimit -Sc) is nonzero, change it to zero.
/// Used in places where we intentionally crash for testing purposes so that we don't clutter CI
/// with core dumps.
pub fn suppress_core_dumps_if_necessary() {
    #[cfg(unix)]
    {
        // Zig: std.posix.getrlimit / setrlimit. bun_sys::posix has no rlimit
        // surface yet — go straight to libc (already a dep, async-signal-safe).
        // SAFETY: all-zero rlimit is valid POD; getrlimit/setrlimit only read/write the struct.
        let mut existing_limit: libc::rlimit = unsafe { core::mem::zeroed() };
        // SAFETY: &mut existing_limit is a valid out-pointer.
        if unsafe { libc::getrlimit(libc::RLIMIT_CORE, &mut existing_limit) } != 0 {
            return;
        }
        if existing_limit.rlim_cur > 0 || existing_limit.rlim_cur == libc::RLIM_INFINITY {
            existing_limit.rlim_cur = 0;
            // SAFETY: &existing_limit is a valid in-pointer.
            unsafe { libc::setrlimit(libc::RLIMIT_CORE, &existing_limit); }
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
    SUPPRESS_REPORTING.store(true, Ordering::Relaxed);
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

    pub fn trace(&self) -> StackTrace<'_> {
        StackTrace {
            index: self.index,
            instruction_addresses: &self.data,
        }
    }

    pub fn capture(begin: Option<usize>) -> StoredTrace {
        let mut stored = StoredTrace::EMPTY;
        stored.index = debug::capture_stack_trace(begin.unwrap_or_else(|| debug::return_address()), &mut stored.data);
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
            let items = stack.instruction_addresses.len().min(31);
            data[0..items].copy_from_slice(&stack.instruction_addresses[0..items]);
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
pub fn append_pre_crash_handler<T: 'static>(
    ptr: *mut T,
    handler: fn(&mut T) -> Result<(), bun_core::Error>,
) -> Result<(), bun_alloc::AllocError> {
    // Zig monomorphizes a `wrap.onCrash` that casts the opaque ptr back to *T and calls
    // `handler`. Rust can't capture `handler` in a bare `fn` item, so box a closure that
    // performs the same cast+call. Errors are intentionally swallowed (best-effort dump).
    let on_crash = Box::new(move |opaque_ptr: *mut c_void| {
        // SAFETY: `opaque_ptr` is the `ptr.cast()` stored below; it was a valid *mut T
        // when registered and remove_pre_crash_handler() unregisters it before drop.
        let this = unsafe { &mut *opaque_ptr.cast::<T>() };
        let _ = handler(this);
    });

    BEFORE_CRASH_HANDLERS.lock().push(CrashHandlerEntry(ptr.cast(), on_crash));
    Ok(())
}

pub fn remove_pre_crash_handler(ptr: *mut c_void) {
    let mut list = BEFORE_CRASH_HANDLERS.lock();
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
    out_stream: &mut impl Write,
    debug_info: &mut SelfInfo,
    tty_config: TtyConfig,
    limits: &WriteStackTraceLimits,
) -> Result<(), bun_core::Error> {
    if debug::STRIP_DEBUG_INFO {
        return Err(bun_core::err!("MissingDebugInfo"));
    }
    let mut frame_index: usize = 0;
    let mut frames_left: usize = stack_trace.index.min(stack_trace.instruction_addresses.len());

    // PORT NOTE: Zig's `while (...) : ({ frames_left -= 1; frame_index = ... })` continue-expression
    // is inlined at every `continue` site and at end-of-loop below.
    while frames_left != 0 {
        if frame_index >= limits.frame_count {
            break;
        }
        let return_address = stack_trace.instruction_addresses[frame_index];
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
                frame_index = (frame_index + 1) % stack_trace.instruction_addresses.len();
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
            frame_index = (frame_index + 1) % stack_trace.instruction_addresses.len();
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
        frame_index = (frame_index + 1) % stack_trace.instruction_addresses.len();
    }

    if stack_trace.index > stack_trace.instruction_addresses.len() {
        let dropped_frames = stack_trace.index - stack_trace.instruction_addresses.len();

        let _ = tty_config.set_color(out_stream, TtyConfig::BOLD);
        write!(out_stream, "({} additional stack frames not recorded...)\n", dropped_frames).map_err(fmt_err)?;
        let _ = tty_config.set_color(out_stream, TtyConfig::RESET);
    } else if frames_left != 0 {
        let _ = tty_config.set_color(out_stream, TtyConfig::BOLD);
        write!(out_stream, "({} additional stack frames skipped...)\n", frames_left).map_err(fmt_err)?;
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
    out_stream: &mut impl Write,
    source_location: Option<&SourceLocation>,
    address: usize,
    symbol_name: &[u8],
    compile_unit_name: &[u8],
    tty_config: TtyConfig,
) -> Result<(), bun_core::Error> {
    // Zig: `Environment.base_path ++ std.fs.path.sep_str` (comptime concat).
    // `Environment::BASE_PATH` is `&[u8]`, which `const_format::concatcp!` cannot
    // ingest. The constant is tiny and this path is debug-only — build it once
    // at runtime in a stack BoundedArray (no heap, async-signal-safe).
    let mut base_path_buf = BoundedArray::<u8, { bun_paths::MAX_PATH_BYTES }>::default();
    let _ = base_path_buf.append_slice(Environment::BASE_PATH);
    let _ = base_path_buf.append_slice(bun_paths::SEP_STR.as_bytes());
    let base_path: &[u8] = base_path_buf.const_slice();
    {
        if let Some(sl) = source_location {
            if sl.file_name.starts_with(base_path) {
                tty_config.set_color(out_stream, TtyConfig::DIM)?;
                out_stream.write_all(base_path)?;
                tty_config.set_color(out_stream, TtyConfig::RESET)?;
                tty_config.set_color(out_stream, TtyConfig::BOLD)?;
                write!(out_stream, "{}", bstr::BStr::new(&sl.file_name[base_path.len()..])).map_err(fmt_err)?;
            } else {
                tty_config.set_color(out_stream, TtyConfig::BOLD)?;
                write!(out_stream, "{}", bstr::BStr::new(&sl.file_name)).map_err(fmt_err)?;
            }
            write!(out_stream, ":{}:{}", sl.line, sl.column).map_err(fmt_err)?;
        } else {
            tty_config.set_color(out_stream, TtyConfig::BOLD)?;
            out_stream.write_all(b"???:?:?")?;
        }

        tty_config.set_color(out_stream, TtyConfig::RESET)?;
        out_stream.write_all(b": ")?;
        tty_config.set_color(out_stream, TtyConfig::DIM)?;
        write!(out_stream, "0x{:x} in", address).map_err(fmt_err)?;
        tty_config.set_color(out_stream, TtyConfig::RESET)?;
        tty_config.set_color(out_stream, TtyConfig::YELLOW)?;
        write!(out_stream, " {}", bstr::BStr::new(symbol_name)).map_err(fmt_err)?;
        tty_config.set_color(out_stream, TtyConfig::RESET)?;
        tty_config.set_color(out_stream, TtyConfig::DIM)?;
        write!(out_stream, " ({})", bstr::BStr::new(compile_unit_name)).map_err(fmt_err)?;
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
    out_stream: &mut impl Write,
    tty_config: TtyConfig,
    source_location: &SourceLocation,
) -> Result<(), bun_core::Error> {
    // Need this to always block even in async I/O mode, because this could potentially
    // be called from e.g. the event loop code crashing.
    // PORT NOTE: `File::open_at` wants `&ZStr` but `source_location.file_name`
    // is a `Box<[u8]>` (no NUL guarantee from the debug-info backend), so route
    // through the byte-slice `openat_a` and wrap the fd.
    let fd = bun_sys::openat_a(bun_sys::Fd::cwd(), &source_location.file_name, bun_sys::O::RDONLY, 0)
        .map_err(bun_core::Error::from)?;
    let f = bun_sys::File::from_fd(fd);
    // TODO(port): errdefer — f closed on all paths via guard
    let f = scopeguard::guard(f, |f| { let _ = f.close(); });

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
                    if pos == slice.len() - 1 {
                        amt_read = f.read(&mut buf[..])?;
                        current_line_start = 0;
                    } else {
                        current_line_start += pos + 1;
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
            let line = &mut slice[0..pos];
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
                    let line = &mut buf[0..pos];
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
    let line_without_newline = strings::trim_right(&line_buf[..fbs_len], b"\n");
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
    if let Some(pos) = index_of(after_before_comment, b"//") {
        comment = &after_before_comment[pos..];
        after_before_comment = &after_before_comment[0..pos];
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
    // TODO(b2-blocked): bun_analytics::Features::increment_unsupported_uv_function
    UNSUPPORTED_UV_FUNCTION.with(|c| c.set(if name.is_null() { None } else { Some(name) }));
    if env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_ON_UV_STUB::get() == Some(true) {
        suppress_reporting();
    }
    // SAFETY: name is non-null (Zig dereferences it unconditionally with `.?`)
    let name_bytes = unsafe { core::ffi::CStr::from_ptr(name) }.to_bytes();
    // PORTING.md §Forbidden: no Box::leak. We're on the noreturn path, so a stack
    // buffer suffices — `panic_impl` transmutes to &'static for the abort path.
    let mut msg = BoundedArray::<u8, 256>::default();
    let _ = write!(msg.writer(), "unsupported uv function: {}", bstr::BStr::new(name_bytes));
    panic_impl(msg.slice(), None, None);
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__crashHandler(message_ptr: *const u8, message_len: usize) -> ! {
    // SAFETY: caller passes a valid (ptr, len) byte slice
    let msg = unsafe { core::slice::from_raw_parts(message_ptr, message_len) };
    crash_handler(
        // SAFETY: noreturn — see panic_impl note
        CrashReason::Panic(unsafe { core::mem::transmute::<&[u8], &'static [u8]>(msg) }),
        None,
        Some(debug::return_address()),
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

} // end mod draft

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/crash_handler/crash_handler.zig (2263 lines)
//   confidence: low
//   todos:      35
//   notes:      Heavy std.debug/std.posix/std.process coupling — needs bun_debug shim crate (StackTrace, SelfInfo, return_address) and bun_sys::posix signal API. Output::pretty_fmt_args, append_pre_crash_handler trampoline, and spawn_symbolizer need real impls in Phase B.
// ──────────────────────────────────────────────────────────────────────────
