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
#![allow(
    unused,
    nonstandard_style,
    static_mut_refs,
    unexpected_cfgs,
    clippy::all
)]
#![warn(unused_must_use)]
#![warn(unreachable_pub)]
#[path = "CPUFeatures.rs"]
pub mod cpu_features;

#[path = "handle_oom.rs"]
pub mod handle_oom;

/// Link-time target for `bun_alloc::out_of_memory()` — declared
/// `extern "Rust"` in `bun_alloc` (which is below this crate in the dep graph)
/// and defined here. Mirrors `src/bun.zig:outOfMemory()` →
/// `crash_handler.crashHandler(.out_of_memory, null, @returnAddress())`.
/// `pub(crate)` so external callers route through the T0 `bun_alloc` entry
/// rather than bypassing it.
#[cold]
#[inline(never)]
pub(crate) fn out_of_memory() -> ! {
    draft::crash_handler(draft::CrashReason::OutOfMemory, None, None)
}

/// `extern "Rust"` symbol resolved by `bun_alloc::out_of_memory()` at link
/// time. Lives in `.text` (read-only) so memory corruption cannot redirect it.
#[doc(hidden)]
#[unsafe(no_mangle)]
pub extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    out_of_memory()
}

/// `extern "Rust"` symbol resolved by `bun_core::dump_current_stack_trace()`
/// at link time. Lives in `.text` (read-only).
#[doc(hidden)]
#[unsafe(no_mangle)]
pub extern "Rust" fn __bun_crash_handler_dump_stack_trace(
    first_address: Option<usize>,
    limits: bun_core::DumpStackTraceOptions,
) {
    draft::dump_current_stack_trace_from_core(first_address, limits)
}

pub use draft::*;

// ──────────────────────────────────────────────────────────────────────────
// Local shim for `bun_debug` (no such crate exists yet). These are
// std.debug.* placeholders the Zig side leaned on; the Rust port will replace
// them with a real debug-info backend in a later pass.
// TODO(b2-blocked): bun_debug::SelfInfo / SourceLocation / TtyConfig / capture_stack_trace
// ──────────────────────────────────────────────────────────────────────────
pub mod debug {
    use super::draft::StackTrace;

    /// `@returnAddress()` — forwards to the canonical stub in bun_core so that
    /// when it's wired to a real intrinsic, all callers (incl. the canonical
    /// `StoredTrace::capture`) pick it up together.
    #[inline(always)]
    pub fn return_address() -> usize {
        bun_core::return_address()
    }

    /// Zig: `std.debug.captureStackTrace`. Thin re-export of the canonical safe
    /// wrapper in bun_core so this crate's internal callers don't churn.
    #[inline]
    pub fn capture_stack_trace(begin: usize, addrs: &mut [usize]) -> usize {
        bun_core::capture_stack_trace(begin, addrs)
    }

    /// Zig: `std.debug.panicImpl` fallback when ENABLE == false.
    pub fn panic_impl(_ert: Option<&StackTrace<'_>>, _begin: Option<usize>, msg: &[u8]) -> ! {
        panic!("{}", bstr::BStr::new(msg))
    }

    pub const HAVE_ERROR_RETURN_TRACING: bool = false;
    pub const STRIP_DEBUG_INFO: bool = !cfg!(debug_assertions);

    // ── SelfInfo (vendor/zig/lib/std/debug/SelfInfo.zig) ─────────────────
    // D104: canonical home for the dladdr-backed `std.debug.SelfInfo` shim.
    // Previously lived in `bun_jsc::btjs::zig_std_debug`; relocated here so the
    // crash handler (lower-tier crate) gets real symbol names in debug builds
    // and `btjs` re-exports from this module.
    use bun_core::{Error, err};
    #[allow(unused_imports)]
    use core::ffi::{c_int, c_void};
    use std::collections::HashMap;

    pub use bun_core::debug::{SourceLocation, SymbolInfo};

    pub struct SelfInfo {
        address_map: HashMap<usize, Box<Module>>,
    }

    /// Port of `SelfInfo.Module`. On Linux Zig uses `Dwarf.ElfModule`; on Darwin a
    /// MachO symbol table reader. Both ultimately resolve `address → {name, CU,
    /// source_location}`. The DWARF/MachO parsers are not ported; `dladdr(3)`
    /// provides the symbol-name half (which is what `btjs` actually consumes for
    /// its `__`/`_llint_call_javascript` prefix checks). `source_location` is left
    /// `None`, which `print_line_info` already handles.
    // PORT NOTE: full `readElfDebugInfo`/`readMachODebugInfo` (~2k LOC of DWARF) not
    // ported — `dladdr` is the libc-level equivalent for symbol-name resolution.
    pub struct Module {
        base_address: usize,
        name: Box<[u8]>,
    }

    impl SelfInfo {
        /// Port of `SelfInfo.open`.
        pub fn open() -> Result<SelfInfo, Error> {
            // `if (builtin.strip_debug_info) return error.MissingDebugInfo;`
            if !cfg!(debug_assertions) {
                return Err(err!("MissingDebugInfo"));
            }
            #[cfg(any(
                target_os = "linux",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "dragonfly",
                target_os = "openbsd",
                target_os = "macos",
                target_os = "solaris",
                target_os = "illumos",
                windows,
            ))]
            {
                // SelfInfo.init — non-Windows path is just an empty address_map.
                return Ok(SelfInfo {
                    address_map: HashMap::new(),
                });
            }
            #[allow(unreachable_code)]
            Err(err!("UnsupportedOperatingSystem"))
        }

        /// Port of `SelfInfo.getModuleForAddress`.
        pub fn get_module_for_address(&mut self, address: usize) -> Result<&mut Module, Error> {
            #[cfg(target_vendor = "apple")]
            {
                return self.lookup_module_dyld(address);
            }
            #[cfg(windows)]
            {
                let _ = address;
                return Err(err!("MissingDebugInfo"));
            }
            #[cfg(not(any(target_vendor = "apple", windows)))]
            {
                return self.lookup_module_dl(address);
            }
        }

        /// Port of `SelfInfo.getModuleNameForAddress`. Returns the basename of the
        /// shared object containing `address`, or `None` if not found.
        pub fn get_module_name_for_address(&mut self, address: usize) -> Option<Box<[u8]>> {
            #[cfg(target_vendor = "apple")]
            {
                return lookup_module_name_dyld(address);
            }
            #[cfg(windows)]
            {
                let _ = address;
                return None;
            }
            #[cfg(not(any(target_vendor = "apple", windows)))]
            {
                return lookup_module_name_dl(address);
            }
        }

        #[cfg(not(any(target_vendor = "apple", windows)))]
        fn lookup_module_dl(&mut self, address: usize) -> Result<&mut Module, Error> {
            let m = bun_sys::elf::find_loaded_module(address)
                .ok_or_else(|| err!("MissingDebugInfo"))?;
            if !self.address_map.contains_key(&m.base_address) {
                let obj_di = Box::new(Module {
                    base_address: m.base_address,
                    name: m.name,
                });
                self.address_map.insert(m.base_address, obj_di);
            }
            Ok(self.address_map.get_mut(&m.base_address).unwrap())
        }

        #[cfg(target_vendor = "apple")]
        fn lookup_module_dyld(&mut self, address: usize) -> Result<&mut Module, Error> {
            // PORT NOTE: Zig walks `_dyld_get_image_header` + LoadCommandIterator. `dladdr`
            // gives the same `{base_address, fname}` pair on Darwin without the MachO walk.
            // SAFETY: dladdr only reads; out-param is a valid Dl_info.
            let mut info: libc::Dl_info = bun_core::ffi::zeroed();
            let rc = unsafe { libc::dladdr(address as *const c_void, &mut info) };
            if rc == 0 {
                return Err(err!("MissingDebugInfo"));
            }
            let base_address = info.dli_fbase as usize;
            if !self.address_map.contains_key(&base_address) {
                let name = if info.dli_fname.is_null() {
                    Box::default()
                } else {
                    // SAFETY: dli_fname is a valid NUL-terminated C string when non-null.
                    unsafe { bun_core::ffi::cstr(info.dli_fname) }
                        .to_bytes()
                        .to_vec()
                        .into_boxed_slice()
                };
                self.address_map
                    .insert(base_address, Box::new(Module { base_address, name }));
            }
            Ok(self.address_map.get_mut(&base_address).unwrap())
        }
    }

    impl Module {
        /// Port of `Module.getSymbolAtAddress`.
        #[cfg(windows)]
        pub fn get_symbol_at_address(&mut self, address: usize) -> Result<SymbolInfo, Error> {
            // TODO(port-windows): SPEC DIVERGENCE — Zig's `std.debug.SelfInfo`
            // resolves symbols on Windows via the loaded PE's PDB
            // (`dbghelp.dll` `SymFromAddr`). That path is not yet ported, so
            // every Windows backtrace currently prints bare addresses even
            // when a PDB is shipped. This is NOT equivalent to the Zig spec
            // for symbol-bearing builds; return the default-initialized
            // `Symbol` (`name = "???"`) so the caller still prints the
            // address line, but the dbghelp lookup must be implemented
            // before Windows crash reports are usable.
            let _ = (address, self.base_address);
            Ok(SymbolInfo {
                name: b"???".to_vec().into_boxed_slice(),
                compile_unit_name: bun_paths::basename(&self.name).to_vec().into_boxed_slice(),
                source_location: None,
            })
        }
        /// Port of `Module.getSymbolAtAddress`.
        #[cfg(not(windows))]
        pub fn get_symbol_at_address(&mut self, address: usize) -> Result<SymbolInfo, Error> {
            let _ = self.base_address;
            // SAFETY: dladdr only reads; out-param is a valid Dl_info.
            let mut info: libc::Dl_info = bun_core::ffi::zeroed();
            let rc = unsafe { libc::dladdr(address as *const c_void, &raw mut info) };
            if rc == 0 || info.dli_sname.is_null() {
                // Zig returns a default-initialized `Symbol` (`.{}` — name "???") here
                // rather than erroring, so the caller still prints the address line.
                return Ok(SymbolInfo {
                    name: b"???".to_vec().into_boxed_slice(),
                    compile_unit_name: bun_paths::basename(&self.name).to_vec().into_boxed_slice(),
                    source_location: None,
                });
            }
            // SAFETY: dli_sname is a valid NUL-terminated C string when non-null.
            let name = unsafe { bun_core::ffi::cstr(info.dli_sname) }
                .to_bytes()
                .to_vec()
                .into_boxed_slice();
            let compile_unit_name = if info.dli_fname.is_null() {
                bun_paths::basename(&self.name).to_vec().into_boxed_slice()
            } else {
                // SAFETY: dli_fname is a valid NUL-terminated C string when non-null.
                bun_paths::basename(unsafe { bun_core::ffi::cstr(info.dli_fname) }.to_bytes())
                    .to_vec()
                    .into_boxed_slice()
            };
            Ok(SymbolInfo {
                name,
                compile_unit_name,
                // PORT NOTE: DWARF line-table lookup not ported; dladdr does not provide
                // file:line. `print_line_info` handles `None` by printing `???:?:?`.
                source_location: None,
            })
        }
    }

    #[cfg(not(any(target_vendor = "apple", windows)))]
    fn lookup_module_name_dl(address: usize) -> Option<Box<[u8]>> {
        bun_sys::elf::find_loaded_module(address)
            .map(|m| bun_paths::basename(&m.name).to_vec().into_boxed_slice())
    }

    #[cfg(target_vendor = "apple")]
    fn lookup_module_name_dyld(address: usize) -> Option<Box<[u8]>> {
        // SAFETY: dladdr only reads; out-param is a valid Dl_info.
        let mut info: libc::Dl_info = bun_core::ffi::zeroed();
        let rc = unsafe { libc::dladdr(address as *const c_void, &mut info) };
        if rc == 0 || info.dli_fname.is_null() {
            return None;
        }
        // SAFETY: dli_fname is a valid NUL-terminated C string when non-null.
        let name = unsafe { bun_core::ffi::cstr(info.dli_fname) }.to_bytes();
        Some(bun_paths::basename(name).to_vec().into_boxed_slice())
    }

    // ── std.debug.getSelfDebugInfo ───────────────────────────────────────
    // PORTING.md §Global mutable state: lazy debug-only singleton. RacyCell —
    // only called from a stopped/crashing process (lldb or the crash handler
    // after `panicking` has serialized), so no concurrent access; callers
    // reborrow the returned `*mut` per-access.
    static SELF_DEBUG_INFO: bun_core::RacyCell<Option<SelfInfo>> = bun_core::RacyCell::new(None);

    /// Port of `std.debug.getSelfDebugInfo`. NOT thread-safe (the Zig original
    /// has the same `TODO multithreaded awareness` caveat).
    pub fn get_self_debug_info() -> Result<*mut SelfInfo, Error> {
        // SAFETY: Zig's `var self_debug_info: ?SelfInfo = null` is also a plain
        // mutable global; this is debug-only and invoked from a stopped process.
        unsafe {
            let slot = &mut *SELF_DEBUG_INFO.get();
            if let Some(info) = slot {
                return Ok(info as *mut _);
            }
            *slot = Some(SelfInfo::open()?);
            Ok(slot.as_mut().unwrap() as *mut _)
        }
    }
    /// Zig: `std.io.tty.detectConfig(std.io.getStdErr())`.
    pub fn detect_tty_config_stderr() -> TtyConfig {
        if bun_core::Output::ENABLE_ANSI_COLORS_STDERR.load(core::sync::atomic::Ordering::Relaxed) {
            TtyConfig::EscapeCodes
        } else {
            TtyConfig::NoColor
        }
    }
    /// Port of `std.io.tty.Config` (vendor/zig/lib/std/Io/tty.zig). The
    /// `windows_api` variant is omitted: every consumer here writes into an
    /// in-memory buffer or raw fd 2, never the live `CONSOLE_SCREEN_BUFFER`, so
    /// `SetConsoleTextAttribute` would colour the wrong stream.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum TtyConfig {
        NoColor,
        EscapeCodes,
    }
    /// Port of `std.io.tty.Color` — only the variants Bun actually emits.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Color {
        Bold,
        Reset,
        Dim,
        Red,
        Yellow,
        Green,
        BrightCyan,
    }
    impl TtyConfig {
        /// Port of `std.io.tty.Config.setColor`.
        pub fn set_color<W: bun_io::Write + ?Sized>(
            self,
            w: &mut W,
            c: Color,
        ) -> Result<(), bun_core::Error> {
            match self {
                TtyConfig::NoColor => Ok(()),
                TtyConfig::EscapeCodes => w.write_all(match c {
                    Color::Bold => b"\x1b[1m",
                    Color::Reset => b"\x1b[0m",
                    Color::Dim => b"\x1b[2m",
                    Color::Red => b"\x1b[31m",
                    Color::Yellow => b"\x1b[33m",
                    Color::Green => b"\x1b[32m",
                    Color::BrightCyan => b"\x1b[96m",
                }),
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Byte-writer trait — D101: deduped to canonical `bun_io::Write`.
// The local stub (TODO(b2-blocked)) predated `bun_io` compiling; it carried a
// `core::fmt::Write` supertrait so `write!(…)` returned `fmt::Result`. The
// canonical trait instead provides its own `write_fmt` returning
// `Result<(), bun_core::Error>`, so `write!` on `impl Write` now yields the
// crate-native error directly (the `fmt_err` shim below became identity).
// `BoundedArray<u8,N>` and `FmtAdapter` impls live in `bun_io` (orphan rules).
// ──────────────────────────────────────────────────────────────────────────
pub use bun_io::{FmtAdapter, Write};

/// Raw, unbuffered stderr writer for the crash path. Stand-in for
/// `bun_sys::stderr_writer()` (not yet exposed by T1).
/// Only impls `bun_io::Write` — `write!` resolves to `bun_io::Write::write_fmt`
/// (alloc-free stack `Bridge`, async-signal-safe).
pub struct StderrWriter;
pub fn stderr_writer() -> StderrWriter {
    StderrWriter
}
impl Write for StderrWriter {
    fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
        #[cfg(windows)]
        {
            // Zig spec: `std.fs.File.stderr().writerStreaming(&.{})` — on
            // Windows that is `GetStdHandle(STD_ERROR_HANDLE)` + kernel32
            // `WriteFile`, NOT the CRT. Routing through MSVCRT `_write(2,…)`
            // would (1) text-mode-translate `\n`→`\r\n` and (2) take the CRT
            // per-fd lock, which can self-deadlock when the VEH crash handler
            // fires on a thread that faulted *inside* CRT stdio. WriteFile is
            // lock-free at the kernel32 layer.
            // `WriteFile` is declared locally because `bun_windows_sys::
            // kernel32` does not (yet) export it (cf. src/sys/lib.rs).
            #[link(name = "kernel32")]
            unsafe extern "system" {
                fn WriteFile(
                    hFile: bun_sys::windows::HANDLE,
                    lpBuffer: *const u8,
                    nNumberOfBytesToWrite: u32,
                    lpNumberOfBytesWritten: *mut u32,
                    lpOverlapped: *mut core::ffi::c_void,
                ) -> i32;
            }
            let h = bun_sys::windows::kernel32::GetStdHandle(bun_sys::windows::STD_ERROR_HANDLE);
            let mut written: u32 = 0;
            // SAFETY: `h` is the cached stderr HANDLE (or INVALID_HANDLE_VALUE,
            // in which case WriteFile fails harmlessly); `bytes` is valid for
            // reads of `len`; `written` is a valid out-pointer; lpOverlapped
            // is null for synchronous I/O.
            unsafe {
                WriteFile(
                    h,
                    bytes.as_ptr(),
                    bytes.len() as u32,
                    &mut written,
                    core::ptr::null_mut(),
                );
            }
        }
        #[cfg(not(windows))]
        {
            // SAFETY: fd 2 is always open; libc::write is async-signal-safe.
            unsafe {
                libc::write(2, bytes.as_ptr().cast(), bytes.len() as _);
            }
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
mod draft {

    use core::cell::Cell;
    use core::ffi::{c_char, c_int, c_long, c_void};
    use core::fmt;
    // D101: `core::fmt::Write` intentionally NOT in scope here — `bun_io::Write`
    // (via `super::Write`) supplies `write_fmt` for `BoundedArray<u8,N>`; importing
    // both makes `write!` ambiguous (E0034).
    use core::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicUsize, Ordering};

    use bun_base64::VLQ;
    use bun_collections::BoundedArray;
    use bun_core::strings;
    use bun_core::{Environment, Global, Output, env_var, fmt as bun_fmt};

    use super::{FmtAdapter, Write, debug, stderr_writer};

    /// D101: now identity. Pre-dedup `Write` had a `core::fmt::Write` supertrait so
    /// `write!` returned `fmt::Result` and needed remapping. With canonical
    /// `bun_io::Write::write_fmt` the error type is already `bun_core::Error`; this
    /// stays as a no-op so the ~22 `.map_err(fmt_err)?` sites don't churn.
    #[inline(always)]
    fn fmt_err(e: bun_core::Error) -> bun_core::Error {
        e
    }

    /// Zig: `Output.enable_ansi_colors_stderr` — runtime flag, exposed in Rust as an
    /// `AtomicBool` static. Re-exported here so call sites read like the Zig.
    use bun_core::output::enable_ansi_colors_stderr;

    /// Zig: `std.posix.abort()`. On POSIX this is `libc::abort()` (async-signal-safe).
    /// On Windows, Zig's `std.posix.abort()` is *not* MSVCRT `abort()` — it is
    /// `if (Debug) @breakpoint(); kernel32.ExitProcess(3);`. UCRT `abort()` would
    /// raise SIGABRT, may print `R6010 - abort() has been called` to stderr, and
    /// can pop a Watson/WER dialog — none of which the Zig spec does.
    #[inline(always)]
    fn abort() -> ! {
        #[cfg(windows)]
        {
            #[cfg(debug_assertions)]
            core::intrinsics::breakpoint();
            // SAFETY: ExitProcess never returns.
            unsafe { bun_sys::windows::kernel32::ExitProcess(3) }
        }
        #[cfg(not(windows))]
        // SAFETY: libc::abort has no preconditions; never returns.
        unsafe {
            libc::abort()
        }
    }
    use super::cpu_features::CPUFeatures;
    use super::debug::{Color, SelfInfo, SourceLocation, TtyConfig};

    /// Zig: `bun.fmt.fmtArgv` — print an argv vector as a shell-ish line.
    /// crash_handler.zig:1024 calls this when the addr2line spawn fails.
    fn fmt_argv<W: super::Write>(w: &mut W, argv: &[Vec<u8>]) -> Result<(), bun_core::Error> {
        for (i, a) in argv.iter().enumerate() {
            if i > 0 {
                w.write_byte(b' ')?;
            }
            // argv came from this process so it's UTF-8 by construction; raw bytes
            // are fine for the stderr crash-path sink either way.
            w.write_all(a)?;
        }
        Ok(())
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

        pub fn set_main_thread_id(id: u64) {
            MAIN_THREAD_ID.store(id, Ordering::Relaxed);
        }
        pub fn set_cmd_char(c: u8) {
            CMD_CHAR.store(c, Ordering::Relaxed);
        }

        pub fn is_main_thread() -> bool {
            MAIN_THREAD_ID.load(Ordering::Relaxed) == bun_threading::current_thread_id()
        }
        pub fn cmd_char() -> Option<u8> {
            match CMD_CHAR.load(Ordering::Relaxed) {
                0 => None,
                c => Some(c),
            }
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
    static HAS_PRINTED_MESSAGE: AtomicBool = AtomicBool::new(false);

    /// Non-zero whenever the program triggered a panic.
    /// The counter is incremented/decremented atomically.
    /// PORT NOTE: shared with bun_core::PANICKING so T0 callers see the same state.
    use bun_core::PANICKING;
    // D131: dedup — these read the shared `PANICKING` atomic and were byte-identical
    // to the bun_core (T0) copies. Re-export so `bun_crash_handler::{is_panicking,
    // sleep_forever_if_another_thread_is_crashing}` keeps resolving for any
    // out-of-tree callers. `dump_current_stack_trace` is intentionally NOT deduped:
    // the bun_core version is an `extern "Rust"` dispatch shim, this crate's is the
    // real impl (linked via `__bun_crash_handler_dump_stack_trace`).
    pub use bun_core::{is_panicking, sleep_forever_if_another_thread_is_crashing};

    // Locked to avoid interleaving panic messages from multiple threads.
    // TODO: I don't think it's safe to lock/unlock a mutex inside a signal handler.
    // PORTING.md §Concurrency: `bun_threading::Guarded<()>` for a bare critical section.
    static PANIC_MUTEX: bun_threading::Guarded<()> = bun_threading::Guarded::new(());

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

    // PORTING.md §Concurrency: `bun_threading::Guarded<Vec<..>>` instead of bare Mutex + global Vec.
    // Stores a boxed type-erased closure (not a bare fn pointer) so that
    // `append_pre_crash_handler` can monomorphize a wrapper that actually invokes the
    // caller's typed handler — mirroring Zig's `comptime handler` trampoline.
    struct CrashHandlerEntry(*mut c_void, Box<dyn Fn(*mut c_void) + Send>);
    // SAFETY: only accessed under the mutex; the opaque ptr is never dereferenced
    // except by the registered callback on the crash thread.
    unsafe impl Send for CrashHandlerEntry {}
    static BEFORE_CRASH_HANDLERS: bun_threading::Guarded<Vec<CrashHandlerEntry>> =
        bun_threading::Guarded::new(Vec::new());

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
                CrashReason::SegmentationFault(addr) => {
                    write!(writer, "Segmentation fault at address 0x{:X}", addr)
                }
                CrashReason::IllegalInstruction(addr) => {
                    write!(writer, "Illegal instruction at address 0x{:X}", addr)
                }
                CrashReason::BusError(addr) => write!(writer, "Bus error at address 0x{:X}", addr),
                CrashReason::FloatingPointError(addr) => {
                    write!(writer, "Floating point error at address 0x{:X}", addr)
                }
                CrashReason::DatatypeMisalignment => writer.write_str("Unaligned memory access"),
                CrashReason::StackOverflow => writer.write_str("Stack overflow"),
                CrashReason::ZigError(err) => {
                    write!(writer, "error.{}", bstr::BStr::new(err.name()))
                }
                CrashReason::OutOfMemory => writer.write_str("Bun ran out of memory"),
            }
        }
    }

    /// bun.bundle_v2.LinkerContext.generateCompileResultForJSChunk
    ///
    /// The bundler types (`LinkerContext` / `Chunk` / `PartRange`) live in a
    /// higher-tier crate; `chunk`/`part_range` stay erased and are reinterpreted by
    /// the `Linker` impl in `bun_bundler::LinkerContext`.
    #[cfg(feature = "show_crash_trace")]
    #[derive(Clone, Copy)]
    pub struct BundleGenerateChunk {
        pub ctx: BundleGenerateChunkCtx,
        /// SAFETY: erased `&bun_bundler::Chunk`
        pub chunk: *const (),
        /// SAFETY: erased `&bun_bundler::PartRange`
        pub part_range: *const (),
    }

    #[cfg(feature = "show_crash_trace")]
    bun_dispatch::link_interface! {
        pub BundleGenerateChunkCtx[Linker] {
            fn fmt(chunk: *const (), part_range: *const (), writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result;
        }
    }

    #[cfg(feature = "show_crash_trace")]
    #[derive(Clone, Copy)]
    pub struct ResolverAction {
        pub source_dir: &'static [u8],
        pub import_path: &'static [u8],
        pub kind: bun_ast::ImportKind,
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
                    data.ctx.fmt(data.chunk, data.part_range, writer)
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
                        bstr::BStr::new(res.kind.label()),
                    )
                }
                #[cfg(not(feature = "show_crash_trace"))]
                Action::Resolver(()) => Ok(()),
                Action::Dlopen(path) => {
                    write!(writer, "loading native module: {}", bstr::BStr::new(path))
                }
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
        kind: bun_ast::ImportKind,
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
    fn capture_libc_backtrace(
        begin_addr: usize,
        addrs: &mut [usize],
        stack_trace: &mut StackTrace<'_>,
    ) {
        unsafe extern "C" {
            fn backtrace(buffer: *mut *mut c_void, size: c_int) -> c_int;
        }

        // SAFETY: addrs is a valid mutable slice of usize, which is layout-compatible with *mut c_void
        let count = unsafe {
            backtrace(
                addrs.as_mut_ptr().cast(),
                i32::try_from(addrs.len()).expect("int cast"),
            )
        };
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
                    let debug_trace = Environment::SHOW_CRASH_TRACE
                        && 'check_flag: {
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
                    if !HAS_PRINTED_MESSAGE.load(Ordering::Relaxed) {
                        Output::flush();
                        Output::source::stdio::restore();

                        if writer
                            .write_all(
                                concat!(
                                    "============================================================",
                                    "\n"
                                )
                                .as_bytes(),
                            )
                            .is_err()
                        {
                            abort();
                        }
                        if print_metadata(writer).is_err() {
                            abort();
                        }

                        if let Some(name) = INSIDE_NATIVE_PLUGIN.with(|c| c.get()) {
                            // SAFETY: name was set from a valid NUL-terminated C string
                            let native_plugin_name =
                                unsafe { bun_core::ffi::cstr(name) }.to_bytes();
                            let fmt = "\nBun has encountered a crash while running the <red><d>\"{s}\"<r> native plugin.\n\nThis indicates either a bug in the native plugin or in Bun.\n";
                            if write!(
                                writer,
                                "{}",
                                Output::pretty_fmt_args(
                                    fmt,
                                    true,
                                    format_args!("{}", bstr::BStr::new(native_plugin_name))
                                )
                            )
                            .is_err()
                            {
                                abort();
                            }
                        } else if UNSUPPORTED_UV_FUNCTION.with(|c| c.get()).is_some() {
                            // TODO(b2-blocked): bun_analytics::Features::unsupported_uv_function — using
                            // the threadlocal as a stand-in for the global counter check.
                            let name: &[u8] = UNSUPPORTED_UV_FUNCTION
                                .with(|c| c.get())
                                .map(|p| {
                                    // SAFETY: p was set from a valid NUL-terminated C string via CrashHandler__unsupportedUVFunction
                                    unsafe { bun_core::ffi::cstr(p) }.to_bytes()
                                })
                                .unwrap_or(b"<unknown>");
                            let fmt = "Bun encountered a crash when running a NAPI module that tried to call\nthe <red>{s}<r> libuv function.\n\nBun is actively working on supporting all libuv functions for POSIX\nsystems, please see this issue to track our progress:\n\n<cyan>https://github.com/oven-sh/bun/issues/18546<r>\n\n";
                            if write!(
                                writer,
                                "{}",
                                Output::pretty_fmt_args(
                                    fmt,
                                    true,
                                    format_args!("{}", bstr::BStr::new(name))
                                )
                            )
                            .is_err()
                            {
                                abort();
                            }
                            // SAFETY: single-threaded mutation under panic_mutex
                            HAS_PRINTED_MESSAGE.store(true, Ordering::Relaxed);
                        }
                    } else {
                        if enable_ansi_colors_stderr() {
                            if writer
                                .write_all(&Output::pretty_fmt::<true>("<red>"))
                                .is_err()
                            {
                                abort();
                            }
                        }
                        if writer.write_all(b"oh no").is_err() {
                            abort();
                        }
                        if enable_ansi_colors_stderr() {
                            if writer
                                .write_all(&Output::pretty_fmt::<true>(
                                    "<r><d>: multiple threads are crashing<r>\n",
                                ))
                                .is_err()
                            {
                                abort();
                            }
                        } else {
                            if writer
                                .write_all(&Output::pretty_fmt::<true>(
                                    ": multiple threads are crashing\n",
                                ))
                                .is_err()
                            {
                                abort();
                            }
                        }
                    }

                    if !matches!(reason, CrashReason::OutOfMemory) || debug_trace {
                        if enable_ansi_colors_stderr() {
                            if writer
                                .write_all(&Output::pretty_fmt::<true>("<red>"))
                                .is_err()
                            {
                                abort();
                            }
                        }

                        if writer.write_all(b"panic").is_err() {
                            abort();
                        }

                        if enable_ansi_colors_stderr() {
                            if writer
                                .write_all(&Output::pretty_fmt::<true>("<r><d>"))
                                .is_err()
                            {
                                abort();
                            }
                        }

                        if cli_state::is_main_thread() {
                            if writer.write_all(b"(main thread)").is_err() {
                                abort();
                            }
                        } else {
                            #[cfg(windows)]
                            {
                                // TODO(b2-blocked): bun_sys::windows::GetThreadDescription / PWSTR / HRESULT_CODE
                                {
                                    let mut name: bun_sys::windows::PWSTR = core::ptr::null_mut();
                                    // SAFETY: GetCurrentThread/GetThreadDescription are valid Win32 calls
                                    let result = unsafe {
                                        bun_sys::windows::GetThreadDescription(
                                            bun_sys::windows::GetCurrentThread(),
                                            &mut name,
                                        )
                                    };
                                    // SAFETY: `name` is the PWSTR out-param written by GetThreadDescription; deref is guarded by the S_OK check via `&&` short-circuit
                                    if bun_sys::windows::HRESULT_CODE(result)
                                        == bun_sys::windows::S_OK
                                        && unsafe { *name } != 0
                                    {
                                        // SAFETY: `name` is a valid NUL-terminated wide string
                                        // (PWSTR out-param from GetThreadDescription).
                                        let span = unsafe { bun_core::ffi::wstr_units(name) };
                                        if write!(writer, "({})", bun_fmt::utf16(span)).is_err() {
                                            abort();
                                        }
                                        // NOTE: `GetThreadDescription` heap-allocates `name` and the
                                        // caller is meant to `LocalFree` it. The Zig spec leaks it
                                        // identically (crash_handler.zig:316-322) — this runs on a
                                        // `noreturn` crash path immediately before `ExitProcess(3)`,
                                        // so the leak is intentional.
                                    } else {
                                        // SAFETY: GetCurrentThreadId is an infallible Win32 call with no pointer/precondition requirements
                                        if write!(writer, "(thread {})", unsafe {
                                            bun_sys::windows::kernel32::GetCurrentThreadId()
                                        })
                                        .is_err()
                                        {
                                            abort();
                                        }
                                    }
                                }
                            }
                            #[cfg(any(
                                target_os = "macos",
                                target_os = "linux",
                                target_os = "freebsd"
                            ))]
                            { /* no-op */ }
                            // TODO(port): wasm @compileError("TODO")
                        }

                        if writer.write_all(b": ").is_err() {
                            abort();
                        }
                        if enable_ansi_colors_stderr() {
                            if writer
                                .write_all(&Output::pretty_fmt::<true>("<r>"))
                                .is_err()
                            {
                                abort();
                            }
                        }
                        if write!(writer, "{}\n", reason).is_err() {
                            abort();
                        }
                    }

                    if let Some(action) = CURRENT_ACTION.with(|c| c.get()) {
                        if write!(writer, "Crashed while {}\n", action).is_err() {
                            abort();
                        }
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
                        let desired_begin_addr =
                            begin_addr.unwrap_or_else(|| debug::return_address());
                        let mut idx: usize =
                            debug::capture_stack_trace(desired_begin_addr, &mut addr_buf);

                        #[cfg(all(target_os = "linux", target_env = "gnu"))]
                        {
                            let mut addr_buf_libc: [usize; 20] = [0; 20];
                            // capture_libc_backtrace only writes `.index` on the StackTrace and
                            // writes frames into `addrs`; pass an empty-slice trace for the index.
                            let mut idx_holder = StackTrace {
                                index: 0,
                                instruction_addresses: &[],
                            };
                            capture_libc_backtrace(
                                desired_begin_addr,
                                &mut addr_buf_libc,
                                &mut idx_holder,
                            );
                            // Use stack trace from glibc's backtrace() if it has more frames
                            if idx_holder.index > idx {
                                addr_buf = addr_buf_libc;
                                idx = idx_holder.index;
                            }
                        }
                        trace_buf = StackTrace {
                            index: idx,
                            instruction_addresses: &addr_buf,
                        };
                        break 'blk &trace_buf;
                    };

                    if debug_trace {
                        // SAFETY: single-threaded mutation under panic_mutex
                        HAS_PRINTED_MESSAGE.store(true, Ordering::Relaxed);

                        dump_stack_trace(trace, WriteStackTraceLimits::default());

                        if write!(
                            trace_str_buf.writer(),
                            "{}",
                            TraceString {
                                trace,
                                reason,
                                action: TraceStringAction::ViewTrace,
                            }
                        )
                        .is_err()
                        {
                            abort();
                        }
                    } else {
                        // SAFETY: single-threaded read under panic_mutex
                        if !HAS_PRINTED_MESSAGE.load(Ordering::Relaxed) {
                            // SAFETY: single-threaded mutation under panic_mutex
                            HAS_PRINTED_MESSAGE.store(true, Ordering::Relaxed);
                            if writer.write_all(b"oh no").is_err() {
                                abort();
                            }
                            if enable_ansi_colors_stderr() {
                                if writer
                                    .write_all(&Output::pretty_fmt::<true>("<r><d>:<r> "))
                                    .is_err()
                                {
                                    abort();
                                }
                            } else {
                                if writer.write_all(&Output::pretty_fmt::<true>(": ")).is_err() {
                                    abort();
                                }
                            }
                            if let Some(name) = INSIDE_NATIVE_PLUGIN.with(|c| c.get()) {
                                // SAFETY: name was set from a valid NUL-terminated C string
                                let native_plugin_name =
                                    unsafe { bun_core::ffi::cstr(name) }.to_bytes();
                                if write!(writer, "{}", Output::pretty_fmt_args(
                                "Bun has encountered a crash while running the <red><d>\"{s}\"<r> native plugin.\n\nTo send a redacted crash report to Bun's team,\nplease file a GitHub issue using the link below:\n\n",
                                true,
                                format_args!("{}", bstr::BStr::new(native_plugin_name)),
                            )).is_err() { abort(); }
                            } else if UNSUPPORTED_UV_FUNCTION.with(|c| c.get()).is_some() {
                                // TODO(b2-blocked): bun_analytics::Features::unsupported_uv_function
                                let name: &[u8] = UNSUPPORTED_UV_FUNCTION
                                    .with(|c| c.get())
                                    .map(|p| {
                                        // SAFETY: p was set from a valid NUL-terminated C string via CrashHandler__unsupportedUVFunction
                                        unsafe { bun_core::ffi::cstr(p) }.to_bytes()
                                    })
                                    .unwrap_or(b"<unknown>");
                                let fmt = "Bun encountered a crash when running a NAPI module that tried to call\nthe <red>{s}<r> libuv function.\n\nBun is actively working on supporting all libuv functions for POSIX\nsystems, please see this issue to track our progress:\n\n<cyan>https://github.com/oven-sh/bun/issues/18546<r>\n\n";
                                if write!(
                                    writer,
                                    "{}",
                                    Output::pretty_fmt_args(
                                        fmt,
                                        true,
                                        format_args!("{}", bstr::BStr::new(name))
                                    )
                                )
                                .is_err()
                                {
                                    abort();
                                }
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
                            if writer
                                .write_all(&Output::pretty_fmt::<true>("<cyan>"))
                                .is_err()
                            {
                                abort();
                            }
                        }

                        if writer.write_all(b" ").is_err() {
                            abort();
                        }

                        if write!(
                            trace_str_buf.writer(),
                            "{}",
                            TraceString {
                                trace,
                                reason,
                                action: TraceStringAction::OpenIssue,
                            }
                        )
                        .is_err()
                        {
                            abort();
                        }

                        if writer.write_all(trace_str_buf.const_slice()).is_err() {
                            abort();
                        }

                        if writer.write_all(b"\n").is_err() {
                            abort();
                        }
                    }

                    if enable_ansi_colors_stderr() {
                        if writer
                            .write_all(&Output::pretty_fmt::<true>("<r>\n"))
                            .is_err()
                        {
                            abort();
                        }
                    } else {
                        if writer.write_all(b"\n").is_err() {
                            abort();
                        }
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
                if write!(stderr, "\npanic: {}\n", reason).is_err() {
                    abort();
                }
                if write!(stderr, "panicked during a panic. Aborting.\n").is_err() {
                    abort();
                }
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
            let mut lim: libc::rlimit = bun_core::ffi::zeroed();
            // SAFETY: &mut lim is a valid out-pointer.
            if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &raw mut lim) } == 0 {
                Some(lim)
            } else {
                None
            }
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
                                user,
                                user,
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
                                user,
                                user,
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
        } else if err == bun_core::err!("NotOpenForReading") || err == bun_core::err!("Unexpected")
        {
            // The usage of `unreachable` in Zig's std.posix may cause the file descriptor problem to show up as other errors
            #[cfg(unix)]
            {
                // SAFETY: zeroed rlimit is valid POD (integers).
                let limit = getrlimit_nofile().unwrap_or(bun_core::ffi::zeroed());

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
                                    user,
                                    user,
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
                err_generic!(
                    "'main' returned <red>error.{}<r>",
                    bstr::BStr::new(err.name())
                );
            } else {
                err_generic!(
                    "An internal error occurred (<red>{}<r>)",
                    bstr::BStr::new(err.name())
                );
            }
            show_trace = true;
        }

        if show_trace {
            VERBOSE_ERROR_TRACE.store(show_trace, Ordering::Relaxed);
            handle_error_return_trace_extra::<true>(err, error_return_trace);
        }

        Global::exit(1);
    }

    #[cold]
    pub fn panic_impl(
        msg: &[u8],
        error_return_trace: Option<&StackTrace>,
        begin_addr: Option<usize>,
    ) -> ! {
        crash_handler(
            if msg == b"reached unreachable code" {
                CrashReason::Unreachable
            } else {
                // TODO(port): lifetime — Zig borrows msg; erased to &'static for the noreturn path.
                // SAFETY: process is about to abort; the borrow is never invalidated.
                CrashReason::Panic(unsafe { bun_collections::detach_lifetime(msg) })
            },
            error_return_trace,
            Some(begin_addr.unwrap_or_else(|| debug::return_address())),
        );
    }

    fn panic_builtin(
        msg: &[u8],
        error_return_trace: Option<&StackTrace>,
        begin_addr: Option<usize>,
    ) -> ! {
        // TODO(port): std.debug.panicImpl — fall back to Rust's std panic machinery
        debug::panic_impl(error_return_trace, begin_addr, msg);
    }

    pub const PANIC: fn(&[u8], Option<&StackTrace>, Option<usize>) -> ! =
        if ENABLE { panic_impl } else { panic_builtin };

    pub fn report_base_url() -> &'static [u8] {
        // PORTING.md §Concurrency: OnceLock for lazy global init (was a raw mutable global Option).
        static BASE_URL: std::sync::OnceLock<&'static [u8]> = std::sync::OnceLock::new();
        *BASE_URL.get_or_init(|| {
            if let Some(url) = env_var::BUN_CRASH_REPORT_URL::get() {
                return strings::without_trailing_slash(url);
            }
            DEFAULT_REPORT_BASE_URL.as_bytes()
        })
    }

    const ARCH_DISPLAY_STRING: &str = if cfg!(target_arch = "aarch64") {
        if cfg!(target_os = "macos") {
            "Silicon"
        } else {
            "arm64"
        }
    } else {
        "x64"
    };

    // TODO(port): std.fmt.comptimePrint — use const_format::formatcp!
    const METADATA_VERSION_LINE: &str = const_format::formatcp!(
        "Bun {}v{} {} {}{}\n",
        if cfg!(debug_assertions) {
            "Debug "
        } else if Environment::IS_CANARY {
            "Canary "
        } else {
            ""
        },
        bun_core::package_json_version_with_sha,
        bun_core::os_display,
        ARCH_DISPLAY_STRING,
        if Environment::BASELINE {
            " (baseline)"
        } else {
            ""
        },
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
    static DID_REGISTER_SIGALTSTACK: AtomicBool = AtomicBool::new(false);
    /// 512K alternate signal stack. The kernel writes here during signal delivery;
    /// Rust never reads/writes the bytes, so `RacyCell` only needs to provide a
    /// stable `*mut u8` for `sigaltstack(2)`.
    #[cfg(unix)]
    static SIGALTSTACK: bun_core::RacyCell<[u8; 512 * 1024]> =
        bun_core::RacyCell::new([0; 512 * 1024]);

    #[cfg(unix)]
    fn update_posix_segfault_handler(
        mut act: Option<&mut libc::sigaction>,
    ) -> Result<(), bun_core::Error> {
        if let Some(act_) = act.as_deref_mut() {
            // SAFETY: single global; only mutated during signal-handler setup
            if !DID_REGISTER_SIGALTSTACK.load(Ordering::Relaxed) {
                let stack = libc::stack_t {
                    ss_flags: 0,
                    ss_size: 512 * 1024,
                    // SAFETY: SIGALTSTACK is a process-lifetime static byte buffer; the kernel only writes to it during signal delivery (no Rust aliasing)
                    ss_sp: SIGALTSTACK.get().cast(),
                };

                // SAFETY: stack points to a valid static buffer
                if unsafe { libc::sigaltstack(&raw const stack, core::ptr::null_mut()) } == 0 {
                    act_.sa_flags |= libc::SA_ONSTACK;
                    // SAFETY: single global; only mutated during signal-handler setup
                    DID_REGISTER_SIGALTSTACK.store(true, Ordering::Relaxed);
                }
            }
        }

        let act_ptr: *const libc::sigaction = act
            .map(|a| std::ptr::from_ref(a))
            .unwrap_or(core::ptr::null());
        // SAFETY: valid sigaction pointer or null; null oldact is permitted.
        unsafe {
            libc::sigaction(libc::SIGSEGV, act_ptr, core::ptr::null_mut());
            libc::sigaction(libc::SIGILL, act_ptr, core::ptr::null_mut());
            libc::sigaction(libc::SIGBUS, act_ptr, core::ptr::null_mut());
            libc::sigaction(libc::SIGFPE, act_ptr, core::ptr::null_mut());
        }
        Ok(())
    }

    // Windows VEH handle storage lives at T0 (`bun_core::WINDOWS_SEGFAULT_HANDLE`,
    // `AtomicPtr<c_void>`) so `bun_core::raise_ignoring_panic_handler` can remove
    // it before re-raising without an upward dep. Single source of truth — this
    // crate reads/writes/swaps that same atomic; no local mirror (a second copy
    // would go stale after T0's swap-to-null and trip the `debug_assert!(rc != 0)`
    // in `reset_segfault_handler` on a double-remove).

    #[cfg(unix)]
    pub fn reset_on_posix() {
        if Environment::ENABLE_ASAN {
            return;
        }
        // Zig: std.posix.Sigaction{ .handler = .{ .sigaction = handleSegfaultPosix }, ... }.
        // SAFETY: zeroed sigaction is valid POD; we overwrite the fields we need.
        let mut act: libc::sigaction = bun_core::ffi::zeroed();
        act.sa_sigaction = handle_segfault_posix as *const () as usize;
        act.sa_flags = libc::SA_SIGINFO | libc::SA_RESTART | libc::SA_RESETHAND;
        // SAFETY: sa_mask is a valid out-pointer.
        unsafe {
            libc::sigemptyset(&raw mut act.sa_mask);
        }
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
                // SAFETY: ABI-identical `extern "system" fn(*mut _) -> i32` —
                // `*mut EXCEPTION_POINTERS` vs the type-erased `*mut c_void` in
                // the kernel32 binding, `c_long` == `i32` on Win64.
                let handle = bun_sys::windows::kernel32::AddVectoredExceptionHandler(
                    0,
                    bun_ptr::cast_fn_ptr::<
                        extern "system" fn(*mut bun_sys::windows::EXCEPTION_POINTERS) -> c_long,
                        unsafe extern "system" fn(*mut core::ffi::c_void) -> i32,
                    >(handle_segfault_windows),
                );
                // Publish to T0 storage (single source of truth — see note above
                // `reset_on_posix`). `HANDLE` is `*mut c_void`; cast is identity.
                bun_core::WINDOWS_SEGFAULT_HANDLE
                    .store(handle as *mut core::ffi::c_void, Ordering::Relaxed);
            }
        }
        #[cfg(any(target_os = "macos", target_os = "linux", target_os = "freebsd"))]
        {
            reset_on_posix();
        }
        // TODO(port): wasm @compileError("TODO")

        install_hooks();
    }

    /// One-shot state registration into lower-tier crates. Storage moved down:
    /// `bun_core::CRASH_HANDLER_INSTALLED` is a plain `AtomicBool`; T0's
    /// `raise_ignoring_panic_handler` does the SIG_DFL reset itself with libc.
    pub fn install_hooks() {
        bun_core::CRASH_HANDLER_INSTALLED.store(true, Ordering::Relaxed);
        // T0 `bun_alloc::out_of_memory()` and `bun_core::dump_current_stack_trace()`
        // reach this crate via link-time `extern "Rust"` symbols
        // (`__bun_crash_handler_out_of_memory` / `__bun_crash_handler_dump_stack_trace`)
        // — no runtime registration needed.
        //
        // Route Rust `panic!()` through the trace-string + report path. Zig wires
        // `pub const panic = bun.crash_handler.panic` at the root so every
        // `@panic()` reports; the Rust port's bare `panic!` was printing the std
        // default hook + unwinding with no trace string and no upload.
        std::panic::set_hook(Box::new(rust_panic_hook));
    }

    /// `std::panic` hook: emit the same trace-string + auto-report as the fatal
    /// `crash_handler()` path, then **abort** (matches Zig's `noreturn` panic).
    /// With `panic = "abort"` no unwind starts after this hook returns, so there
    /// are no `catch_unwind` boundaries to reach.
    #[cold]
    #[inline(never)]
    fn rust_panic_hook(info: &std::panic::PanicHookInfo<'_>) {
        // Re-entry guard: if the hook itself panics (formatter, write, …), the
        // recursive entry sees stage>0, prints a one-liner, and returns so the
        // inner unwind tears the process down rather than looping.
        let stage = PANIC_STAGE.with(|s| s.get());
        if stage != 0 {
            PANIC_STAGE.with(|s| s.set(stage + 1));
            let stderr = &mut stderr_writer();
            let _ = write!(
                stderr,
                "\npanic: {info}\npanicked during a panic. Aborting.\n"
            );
            return;
        }
        PANIC_STAGE.with(|s| s.set(1));

        // Build "msg (file:line:col)" into a stack buffer so `CrashReason::Panic`
        // can borrow it — matches Zig `@panic(msg)` payload shape.
        let mut msg_buf = BoundedArray::<u8, 1024>::default();
        {
            let payload = info.payload();
            let msg: &str = if let Some(s) = payload.downcast_ref::<&'static str>() {
                s
            } else if let Some(s) = payload.downcast_ref::<std::string::String>() {
                s.as_str()
            } else {
                "<non-string panic payload>"
            };
            let _ = match info.location() {
                Some(loc) => write!(
                    msg_buf.writer(),
                    "{} ({}:{}:{})",
                    msg,
                    loc.file(),
                    loc.line(),
                    loc.column()
                ),
                None => write!(msg_buf.writer(), "{msg}"),
            };
        }
        // SAFETY: `CrashReason::Panic` stores `&'static [u8]` (it was designed for
        // the `-> !` path). `msg_buf` outlives every read of `reason` below — the
        // borrow is fully consumed by the `Display`/`TraceString` writes inside
        // this frame and never escapes.
        let reason =
            CrashReason::Panic(unsafe { bun_collections::detach_lifetime(msg_buf.const_slice()) });

        let mut trace_str_buf = BoundedArray::<u8, 1024>::default();
        {
            let _panic_guard = PANIC_MUTEX.lock();
            let writer = &mut stderr_writer();

            let debug_trace = Environment::SHOW_CRASH_TRACE
                && 'check_flag: {
                    for arg in bun_core::argv() {
                        if arg == &b"--debug-crash-handler-use-trace-string"[..] {
                            break 'check_flag false;
                        }
                    }
                    if is_reporting_enabled() {
                        break 'check_flag false;
                    }
                    true
                };

            Output::flush();
            let _ =
                writer.write_all(b"============================================================\n");
            let _ = print_metadata(writer);

            if enable_ansi_colors_stderr() {
                let _ = writer.write_all(&Output::pretty_fmt::<true>("<red>"));
            }
            let _ = writer.write_all(b"panic");
            if enable_ansi_colors_stderr() {
                let _ = writer.write_all(&Output::pretty_fmt::<true>("<r>"));
            }
            let _ = write!(writer, ": {}\n", reason);

            if let Some(action) = CURRENT_ACTION.with(|c| c.get()) {
                let _ = write!(writer, "Crashed while {}\n", action);
            }

            let mut addr_buf: [usize; 20] = [0; 20];
            let idx = debug::capture_stack_trace(debug::return_address(), &mut addr_buf);
            let trace = StackTrace {
                index: idx,
                instruction_addresses: &addr_buf,
            };

            if debug_trace {
                dump_stack_trace(&trace, WriteStackTraceLimits::default());
                let _ = write!(
                    trace_str_buf.writer(),
                    "{}",
                    TraceString {
                        trace: &trace,
                        reason,
                        action: TraceStringAction::ViewTrace,
                    }
                );
            } else {
                let _ = writer.write_all(b"oh no");
                if enable_ansi_colors_stderr() {
                    let _ = writer.write_all(&Output::pretty_fmt::<true>("<r><d>:<r> "));
                } else {
                    let _ = writer.write_all(b": ");
                }
                let _ = writer.write_all(
                    b"Bun has crashed. This indicates a bug in Bun, not your code.\n\n\
                  To send a redacted crash report to Bun's team,\n\
                  please file a GitHub issue using the link below:\n\n ",
                );
                if enable_ansi_colors_stderr() {
                    let _ = writer.write_all(&Output::pretty_fmt::<true>("<cyan>"));
                }
                let _ = write!(
                    trace_str_buf.writer(),
                    "{}",
                    TraceString {
                        trace: &trace,
                        reason,
                        action: TraceStringAction::OpenIssue,
                    }
                );
                let _ = writer.write_all(trace_str_buf.const_slice());
                let _ = writer.write_all(b"\n");
            }
            if enable_ansi_colors_stderr() {
                let _ = writer.write_all(&Output::pretty_fmt::<true>("<r>\n"));
            } else {
                let _ = writer.write_all(b"\n");
            }
        }

        report(trace_str_buf.const_slice());

        // A Rust `panic!` is a bug. The process must not continue — with
        // `panic = "abort"` no unwind starts, so `catch_unwind` boundaries are
        // unreachable for Rust panics. This matches Zig's
        // `pub const panic = bun.crash_handler.panic` (which is `noreturn`).
        crash();
    }

    /// Adapter for non-fatal `bun_core::dump_current_stack_trace` callers
    /// (fd.rs EBADF debug-warn, ref_count leak reports). Zig routes these through
    /// `dumpStackTrace` which on Linux debug spawns `llvm-symbolizer` — but the
    /// Rust debug binary's .debug_info is large enough that the symbolizer parse
    /// alone costs ~5s, which is unacceptable on a hot non-fatal path
    /// (`closeSync(EBADF)` was timing out fs.test.ts at the 5s budget). For these
    /// advisory dumps we honour `frame_count` and use WTF's dladdr-based printer
    /// (sub-ms, function names only). The full `dump_stack_trace` (with
    /// llvm-symbolizer source lines) is kept for actual crash/panic paths, which
    /// call it directly.
    pub(crate) fn dump_current_stack_trace_from_core(
        first_address: Option<usize>,
        limits: bun_core::DumpStackTraceOptions,
    ) {
        Output::flush();
        let mut addrs: [usize; 32] = [0; 32];
        let n = debug::capture_stack_trace(
            first_address.unwrap_or_else(debug::return_address),
            &mut addrs,
        );
        let n = n.min(limits.frame_count);
        if !Environment::SHOW_CRASH_TRACE {
            // debug symbols aren't available, lets print a tracestring
            let stderr = &mut stderr_writer();
            let stack = StackTrace {
                index: n,
                instruction_addresses: &addrs,
            };
            let _ = write!(
                stderr,
                "View Debug Trace: {}\n",
                TraceString {
                    action: TraceStringAction::ViewTrace,
                    reason: CrashReason::ZigError(bun_core::err!("DumpStackTrace")),
                    trace: &stack,
                }
            );
            return;
        }
        // SAFETY: `addrs[..n]` is a valid slice of captured return addresses.
        unsafe {
            WTF__DumpStackTrace(addrs.as_ptr(), n);
        }
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
            // Swap-to-null so a concurrent/reentrant reset (or T0's
            // `raise_ignoring_panic_handler`) can't double-remove the same handle.
            let handle =
                bun_core::WINDOWS_SEGFAULT_HANDLE.swap(core::ptr::null_mut(), Ordering::Relaxed);
            if !handle.is_null() {
                // SAFETY: handle was returned by AddVectoredExceptionHandler and
                // not yet removed (atomically claimed via the swap above).
                let rc =
                    unsafe { bun_sys::windows::kernel32::RemoveVectoredExceptionHandler(handle) };
                debug_assert!(rc != 0);
            }
            return;
        }

        #[cfg(unix)]
        {
            // SAFETY: zeroed sigaction is valid POD; handler = SIG_DFL (= 0), flags = 0.
            let mut act: libc::sigaction = bun_core::ffi::zeroed();
            act.sa_sigaction = libc::SIG_DFL;
            // SAFETY: sa_mask is a valid out-pointer.
            unsafe {
                libc::sigemptyset(&raw mut act.sa_mask);
            }
            // To avoid a double-panic, do nothing if an error happens here.
            let _ = update_posix_segfault_handler(Some(&mut act));
        }
    }

    #[cfg(windows)]
    pub extern "system" fn handle_segfault_windows(
        info: *mut bun_sys::windows::EXCEPTION_POINTERS,
    ) -> c_long {
        // SAFETY: kernel provides a valid EXCEPTION_POINTERS
        let info = unsafe { &*info };
        let reason = match unsafe { (*info.ExceptionRecord).ExceptionCode } {
            bun_sys::windows::EXCEPTION_DATATYPE_MISALIGNMENT => CrashReason::DatatypeMisalignment,
            bun_sys::windows::EXCEPTION_ACCESS_VIOLATION => {
                CrashReason::SegmentationFault(unsafe {
                    (*info.ExceptionRecord).ExceptionInformation[1]
                })
            }
            bun_sys::windows::EXCEPTION_ILLEGAL_INSTRUCTION => {
                // `ExceptionAddress` is the faulting RIP for `STATUS_ILLEGAL_
                // INSTRUCTION` (winnt.h); avoids depending on the arch-specific
                // `CONTEXT` layout (Zig reached `ContextRecord.Rip` directly).
                CrashReason::IllegalInstruction(
                    unsafe { (*info.ExceptionRecord).ExceptionAddress } as usize
                )
            }
            bun_sys::windows::EXCEPTION_STACK_OVERFLOW => CrashReason::StackOverflow,

            // exception used for thread naming
            // https://learn.microsoft.com/en-us/previous-versions/visualstudio/visual-studio-2017/debugger/how-to-set-a-thread-name-in-native-code?view=vs-2017#set-a-thread-name-by-throwing-an-exception
            // related commit
            // https://github.com/go-delve/delve/pull/1384
            bun_sys::windows::MS_VC_EXCEPTION => {
                return bun_sys::windows::EXCEPTION_CONTINUE_EXECUTION;
            }

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

    // Only populated after JSC::VM::tryCreate. C++ writes this as a plain
    // `size_t`; `AtomicUsize` has the same size/alignment as `usize` so the
    // symbol layout is unchanged, and the Rust side reads it race-free.
    #[unsafe(no_mangle)]
    pub static Bun__reported_memory_size: AtomicUsize = AtomicUsize::new(0);

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
                        unsafe { bun_core::ffi::cstr(version) }.to_bytes()
                    };
                    let kernel_version =
                        bun_analytics::GenerateHeader::generate_platform::kernel_version();
                    if platform.os == bun_analytics::schema::analytics::OperatingSystem::wsl {
                        write!(
                            writer,
                            "WSL Kernel v{}.{}.{} | glibc v{}\n",
                            kernel_version.major,
                            kernel_version.minor,
                            kernel_version.patch,
                            bstr::BStr::new(version_bytes)
                        )
                        .map_err(fmt_err)?;
                    } else {
                        write!(
                            writer,
                            "Linux Kernel v{}.{}.{} | glibc v{}\n",
                            kernel_version.major,
                            kernel_version.minor,
                            kernel_version.patch,
                            bstr::BStr::new(version_bytes)
                        )
                        .map_err(fmt_err)?;
                    }
                }
                #[cfg(all(target_os = "linux", target_env = "musl"))]
                {
                    let kernel_version =
                        bun_analytics::GenerateHeader::generate_platform::kernel_version();
                    write!(
                        writer,
                        "Linux Kernel v{}.{}.{} | musl\n",
                        kernel_version.major, kernel_version.minor, kernel_version.patch
                    )
                    .map_err(fmt_err)?;
                }
                #[cfg(target_os = "android")]
                {
                    let kernel_version =
                        bun_analytics::GenerateHeader::generate_platform::kernel_version();
                    write!(
                        writer,
                        "Android Kernel v{}.{}.{} | bionic\n",
                        kernel_version.major, kernel_version.minor, kernel_version.patch
                    )
                    .map_err(fmt_err)?;
                }
                #[cfg(target_os = "freebsd")]
                {
                    write!(
                        writer,
                        "FreeBSD Kernel v{}\n",
                        bstr::BStr::new(platform.version)
                    )
                    .map_err(fmt_err)?;
                }
                #[cfg(target_os = "macos")]
                {
                    write!(writer, "macOS v{}\n", bstr::BStr::new(platform.version))
                        .map_err(fmt_err)?;
                }
                #[cfg(windows)]
                {
                    // TODO(port): std.zig.system.windows.detectRuntimeVersion()
                    write!(
                        writer,
                        "Windows v{}\n",
                        bun_sys::windows::detect_runtime_version()
                    )
                    .map_err(fmt_err)?;
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
                write!(
                    writer,
                    "{}",
                    bun_fmt::QuotedFormatter {
                        text: &arg[0..arg.len().min(arg_chars_left)]
                    }
                )
                .map_err(fmt_err)?;
                arg_chars_left = arg_chars_left.saturating_sub(arg.len());
                if arg_chars_left == 0 {
                    writer.write_all(b"...")?;
                    break;
                }
            }
        }

        // TODO(b2-blocked): bun_analytics::Features::formatter
        {
            write!(writer, "\n{}", bun_analytics::features::formatter()).map_err(fmt_err)?;
        }
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
                    &raw mut elapsed_msecs,
                    &raw mut user_msecs,
                    &raw mut system_msecs,
                    &raw mut current_rss,
                    &raw mut peak_rss,
                    &raw mut current_commit,
                    &raw mut peak_commit,
                    &raw mut page_faults,
                );
            }
            write!(
                writer,
                "Elapsed: {}ms | User: {}ms | Sys: {}ms\n",
                elapsed_msecs, user_msecs, system_msecs
            )
            .map_err(fmt_err)?;

            // TODO(port): {B:<3.2} byte-size formatting — bun_fmt::bytes() doesn't take width/prec yet
            write!(
                writer,
                "RSS: {} | Peak: {} | Commit: {} | Faults: {}",
                bun_fmt::bytes(current_rss),
                bun_fmt::bytes(peak_rss),
                bun_fmt::bytes(current_commit),
                page_faults,
            )
            .map_err(fmt_err)?;

            // SAFETY: read-only access to exported global
            let reported = Bun__reported_memory_size.load(Ordering::Relaxed);
            if reported > 0 {
                write!(writer, " | Machine: {}", bun_fmt::bytes(reported)).map_err(fmt_err)?;
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
                writer.write_all(
                    b"CPU lacks AVX support. Please consider upgrading to a newer CPU.\n",
                )?;
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
            // Android folds into the Linux variants — Zig's `@tagName(Environment.os)`
            // (crash_handler.zig:1153) yields `"linux"` for Android because Zig keeps
            // it under `os.tag == .linux`. bun.report decodes the same single-char
            // codes; introducing new ones would break older decoders.
            #[cfg(all(
                any(target_os = "linux", target_os = "android"),
                target_arch = "x86_64",
                not(feature = "baseline")
            ))]
            {
                Platform::LinuxX8664
            }
            #[cfg(all(
                any(target_os = "linux", target_os = "android"),
                target_arch = "x86_64",
                feature = "baseline"
            ))]
            {
                Platform::LinuxX8664Baseline
            }
            #[cfg(all(
                any(target_os = "linux", target_os = "android"),
                target_arch = "aarch64"
            ))]
            {
                Platform::LinuxAarch64
            }
            #[cfg(all(target_os = "macos", target_arch = "x86_64", not(feature = "baseline")))]
            {
                Platform::MacX8664
            }
            #[cfg(all(target_os = "macos", target_arch = "x86_64", feature = "baseline"))]
            {
                Platform::MacX8664Baseline
            }
            #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
            {
                Platform::MacAarch64
            }
            #[cfg(all(windows, target_arch = "x86_64", not(feature = "baseline")))]
            {
                Platform::WindowsX8664
            }
            #[cfg(all(windows, target_arch = "x86_64", feature = "baseline"))]
            {
                Platform::WindowsX8664Baseline
            }
            #[cfg(all(windows, target_arch = "aarch64"))]
            {
                Platform::WindowsAarch64
            }
            #[cfg(all(
                target_os = "freebsd",
                target_arch = "x86_64",
                not(feature = "baseline")
            ))]
            {
                Platform::FreebsdX8664
            }
            #[cfg(all(target_os = "freebsd", target_arch = "x86_64", feature = "baseline"))]
            {
                Platform::FreebsdX8664Baseline
            }
            #[cfg(all(target_os = "freebsd", target_arch = "aarch64"))]
            {
                Platform::FreebsdAarch64
            }
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
            let (head, _) = s.as_bytes().split_at(7);
            // SAFETY: GIT_SHA is ASCII hex; the first 7 bytes are a valid UTF-8
            // prefix. `split_at` const-panics if the input is shorter than 7.
            unsafe { core::str::from_utf8_unchecked(head) }
        }
        if !Environment::GIT_SHA.is_empty() {
            sha7(Environment::GIT_SHA)
        } else {
            "unknown"
        }
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
                    // Zig: `@intCast(addr - base_address)` — unchecked in ReleaseFast.
                    // Use a wrapping cast so an oversize/underflowed module offset
                    // produces a junk frame instead of panicking *inside* the crash
                    // handler (which would escalate to a double-panic and lose the
                    // entire report).
                    address: addr.wrapping_sub(base_address) as i32,

                    object: if name != image_path.as_slice() {
                        // GetModuleFileNameW output never has a trailing separator
                        // or bare drive prefix, so the std.fs.path.basenameWindows
                        // stripping is a no-op on this domain.
                        let basename = bun_paths::basename_windows(name);
                        Some(Box::<[u8]>::from(
                            &*strings::convert_utf16_to_utf8_in_buffer(name_bytes, basename),
                        ))
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
                    if header.is_null() {
                        i += 1;
                        continue;
                    }
                    let base_address = header as usize;
                    if address < base_address {
                        i += 1;
                        continue;
                    }
                    // This 'slide' is the ASLR offset. Subtract from `address` to get a stable address
                    let vmaddr_slide =
                        unsafe { bun_sys::c::_dyld_get_image_vmaddr_slide(i) } as usize;

                    // SAFETY: header points to a valid mach_header_64
                    let header_ref = unsafe { &*header };
                    // SAFETY: load commands follow the mach header in memory; the
                    // dyld-mapped image stays live for the process lifetime, so the
                    // iterator's no-realloc/no-free contract is trivially upheld.
                    let mut it =
                        bun_sys::macho::LoadCommandIterator::new(header_ref.ncmds, unsafe {
                            core::slice::from_raw_parts(
                                header
                                    .cast::<u8>()
                                    .add(core::mem::size_of::<bun_sys::macho::mach_header_64>()),
                                header_ref.sizeofcmds as usize,
                            )
                        });

                    while let Some(cmd) = it.next() {
                        match cmd.cmd() {
                            bun_sys::macho::LC_SEGMENT_64 => {
                                let segment_cmd =
                                    cmd.cast::<bun_sys::macho::segment_command_64>().unwrap();
                                if segment_cmd.seg_name() != b"__TEXT" {
                                    continue;
                                }

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
                                            address: i32::try_from(image_relative_address)
                                                .expect("int cast"),
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
                let _ = name_bytes;
                let address = addr.saturating_sub(1);
                let m = bun_sys::elf::find_loaded_module(address)?;
                return Some(StackLine {
                    address: i32::try_from(address - m.base_address).expect("int cast"),
                    object: None,
                });
            }
        }

        pub(crate) fn write_encoded(
            self_: Option<&StackLine>,
            writer: &mut impl Write,
        ) -> Result<(), bun_core::Error> {
            let Some(known) = self_ else {
                writer.write_all(b"_")?;
                return Ok(());
            };

            if let Some(object) = &known.object {
                writer.write_all(VLQ::encode(1).slice())?;
                writer.write_all(
                    VLQ::encode(i32::try_from(object.len()).expect("int cast")).slice(),
                )?;
                writer.write_all(object)?;
            }

            writer.write_all(VLQ::encode(known.address).slice())?;
            Ok(())
        }

        pub(crate) fn write_decoded(
            self_: Option<&StackLine>,
            writer: &mut impl Write,
        ) -> Result<(), bun_core::Error> {
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
                self.object
                    .as_deref()
                    .map(bstr::BStr::new)
                    .unwrap_or(bstr::BStr::new(b"")),
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
            let _ = encode_trace_string(self, &mut FmtAdapter::new(writer));
            Ok(())
        }
    }

    fn encode_trace_string(
        opts: &TraceString<'_>,
        writer: &mut impl Write,
    ) -> Result<(), bun_core::Error> {
        writer.write_all(report_base_url())?;
        writer.write_all(b"/")?;
        writer.write_all(Environment::VERSION_STRING.as_bytes())?;
        writer.write_all(b"/")?;
        writer.write_all(&[Platform::CURRENT as u8])?;
        writer.write_byte(cli_state::cmd_char().unwrap_or(b'_'))?;

        writer.write_all(VERSION_CHAR.as_bytes())?;
        writer.write_all(GIT_SHA.as_bytes())?;

        let packed_features: u64 = bun_analytics::packed_features().bits();
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
                let ret = unsafe {
                    bun_zlib::compress2(
                        compressed_bytes.as_mut_ptr(),
                        &raw mut len,
                        message.as_ptr(),
                        u32::try_from(message.len()).expect("int cast") as bun_zlib::uLong,
                        9,
                    )
                };
                // Match on the raw zlib return code so this stays ABI-correct
                // regardless of whether the platform `compress2` binding returns
                // `c_int` (posix) or the `ReturnCode` enum (win32).
                let compressed = match ret as i32 {
                    r if r == bun_zlib::ReturnCode::Ok as i32 => {
                        &compressed_bytes[0..usize::try_from(len).expect("int cast")]
                    }
                    // Insufficient memory.
                    r if r == bun_zlib::ReturnCode::MemError as i32 => {
                        return Err(bun_core::err!("OutOfMemory"));
                    }
                    // The buffer dest was not large enough to hold the compressed data.
                    r if r == bun_zlib::ReturnCode::BufError as i32 => {
                        return Err(bun_core::err!("NoSpaceLeft"));
                    }
                    // The level was not Z_DEFAULT_LEVEL, or was not between 0 and 9.
                    // This is technically possible but impossible because we pass 9.
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

    pub fn write_u64_as_two_vlqs(
        writer: &mut impl Write,
        addr: usize,
    ) -> Result<(), bun_core::Error> {
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
            // TODO(b2-blocked): bun_core::w! / strings::convert_utf8_to_utf16_in_buffer
            use bun_sys::windows;
            let mut process: windows::PROCESS_INFORMATION = bun_core::ffi::zeroed();
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
            let mut cmd_line = BoundedArray::<u16, 4096>::default();
            cmd_line.append_slice_assume_capacity(bun_core::w!(
                "powershell -ExecutionPolicy Bypass -Command \"try{Invoke-RestMethod -Uri '"
            ));
            // PERF(port): was assume_capacity
            {
                // `unused_capacity_slice` is `&mut [MaybeUninit<u16>]`;
                // `from_raw_parts_mut::<u16>` over that storage would assert the
                // bytes are already initialized (library-UB even though
                // `convert_utf8_to_utf16_in_buffer` only writes). Zero-fill the
                // spare slots first so the `&mut [u16]` we hand to simdutf is over
                // initialized memory. Cold crash-reporter path — the extra memset
                // is irrelevant.
                let spare = cmd_line.unused_capacity_slice();
                for slot in spare.iter_mut() {
                    slot.write(0);
                }
                let cap = spare.len();
                // SAFETY: every `MaybeUninit<u16>` in `spare` was just written
                // above; `dst..dst+cap` is now `cap` initialized `u16`s inside one
                // allocation.
                let init = unsafe {
                    core::slice::from_raw_parts_mut(spare.as_mut_ptr().cast::<u16>(), cap)
                };
                let encoded_len = strings::convert_utf8_to_utf16_in_buffer(init, url).len();
                let _ = cmd_line.resize(cmd_line.len() + encoded_len);
            }
            if cmd_line
                .append_slice(bun_core::w!("/ack'|out-null}catch{}\""))
                .is_err()
            {
                return;
            }
            if cmd_line.append(0).is_err() {
                return;
            }
            // SAFETY: we just wrote a NUL terminator at len-1
            let end = cmd_line.len() - 1;
            let cmd_line_slice = &mut cmd_line.slice()[0..end];
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
            // NOTE: on success `CreateProcessW` returns two open kernel handles in
            // `process.hProcess` / `process.hThread` that the caller is meant to
            // `CloseHandle`. The Zig spec leaks them identically (crash_handler.zig:
            // 1545-1546 `_ = spawn_result;`); `report()` runs immediately before
            // `crash()` → `ExitProcess(3)`, so the kernel reclaims them anyway.
            let _ = spawn_result;
            let _ = url;
        }
        #[cfg(any(target_os = "macos", target_os = "linux", target_os = "freebsd"))]
        {
            let mut buf = bun_core::PathBuffer::default();
            let mut buf2 = bun_core::PathBuffer::default();
            let Some(path_env) = env_var::PATH::get() else {
                return;
            };
            let Ok(cwd) = bun_core::getcwd(&mut buf2) else {
                return;
            };
            // PORT NOTE: reshaped for borrowck — capture cwd bytes by value (it
            // borrows buf2, not buf, so no actual overlap; copy len for clarity).
            let cwd_bytes = cwd.as_bytes();
            let Some(curl) = bun_which::which(&mut buf, path_env, cwd_bytes, b"curl") else {
                return;
            };
            let mut cmd_line = BoundedArray::<u8, 4096>::default();
            if cmd_line.append_slice(url).is_err() {
                return;
            }
            if cmd_line.append_slice(b"/ack").is_err() {
                return;
            }
            if cmd_line.append(0).is_err() {
                return;
            }

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
                        unsafe {
                            libc::close(i);
                        }
                    }
                    // SAFETY: argv is NUL-terminated array of NUL-terminated strings; environ is the
                    // process environment block
                    unsafe {
                        libc::execve(argv[0], argv.as_ptr(), bun_core::c_environ());
                    }
                    // SAFETY: _exit is async-signal-safe in the forked child
                    unsafe {
                        libc::_exit(0);
                    }
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
            let mut sigact: libc::sigaction = bun_core::ffi::zeroed();
            sigact.sa_sigaction = libc::SIG_DFL;
            // SAFETY: sa_mask is a valid out-pointer into a zeroed struct.
            unsafe {
                libc::sigemptyset(&raw mut sigact.sa_mask);
            }
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
                unsafe {
                    libc::sigaction(sig, &raw const sigact, core::ptr::null_mut());
                }
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
            //
            // Zig spec (crash_handler.zig:1592): the `.windows` arm is literally
            // `std.posix.abort();` — i.e. our same-module `abort()` helper, which on
            // Windows is `@breakpoint()` (Debug only) then `kernel32.ExitProcess(3)`.
            // Do NOT call MSVCRT `libc::abort()` here — that raises SIGABRT, may print
            // the CRT `abort() has been called` message, and can invoke WER.
            abort()
        }
    }

    pub static VERBOSE_ERROR_TRACE: AtomicBool = AtomicBool::new(false);

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
        let is_debug = cfg!(debug_assertions)
            && 'check_flag: {
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
                if VERBOSE_ERROR_TRACE.load(Ordering::Relaxed) {
                    Output::note("Release build will not have this trace by default:");
                }
            } else {
                bun_core::pretty_errorln!(
                    "<blue>note<r><d>:<r> caught error.{}:",
                    bstr::BStr::new(err.name())
                );
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
                    bstr::BStr::new(err.name()),
                    ts,
                );
            }
        }
    }

    #[inline]
    fn handle_error_return_trace_extra<const IS_ROOT: bool>(
        err: bun_core::Error,
        maybe_trace: Option<&StackTrace>,
    ) {
        // TODO(port): builtin.have_error_return_tracing — Rust has no error-return tracing.
        // Phase B should decide whether to keep this entire mechanism or strip it.
        if !debug::HAVE_ERROR_RETURN_TRACING {
            return;
        }
        // SAFETY: read-only access
        if !VERBOSE_ERROR_TRACE.load(Ordering::Relaxed) && !IS_ROOT {
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

    /// Version of the standard library dumpStackTrace that has some fallbacks for
    /// cases where such logic fails to run.
    pub fn dump_stack_trace(trace: &StackTrace, limits: WriteStackTraceLimits) {
        Output::flush();
        let stderr = &mut stderr_writer();
        if !Environment::SHOW_CRASH_TRACE {
            // debug symbols aren't available, lets print a tracestring
            let _ = write!(
                stderr,
                "View Debug Trace: {}\n",
                TraceString {
                    action: TraceStringAction::ViewTrace,
                    reason: CrashReason::ZigError(bun_core::err!("DumpStackTrace")),
                    trace,
                }
            );
            return;
        }

        #[cfg(windows)]
        'attempt_dump: {
            // Windows has issues with opening the PDB file sometimes.
            let debug_info = match debug::get_self_debug_info() {
                // SAFETY: lazy debug-only singleton; sole `&mut` for the dump below.
                Ok(d) => unsafe { &mut *d },
                Err(err) => {
                    // Zig: `stderr.print(..) catch return;` — if stderr write fails
                    // (e.g. broken pipe), bail out entirely; don't fall through.
                    if write!(stderr, "Unable to dump stack trace: Unable to open debug info: {}\nFallback trace:\n", bstr::BStr::new(err.name())).is_err() { return; }
                    break 'attempt_dump;
                }
            };
            match write_stack_trace(
                trace,
                stderr,
                debug_info,
                debug::detect_tty_config_stderr(),
                &limits,
            ) {
                Ok(()) => return,
                Err(err) => {
                    if write!(
                        stderr,
                        "Unable to dump stack trace: {}\nFallback trace:\n",
                        bstr::BStr::new(err.name())
                    )
                    .is_err()
                    {
                        return;
                    }
                    break 'attempt_dump;
                }
            }
        }
        #[cfg(target_os = "linux")]
        {
            // In non-debug builds, use WTF's stack trace printer and return early
            if !cfg!(debug_assertions) {
                // SAFETY: trace.instruction_addresses is a valid slice of `index` entries
                unsafe {
                    WTF__DumpStackTrace(trace.instruction_addresses.as_ptr(), trace.index);
                }
                return;
            }
            // Otherwise fall through to llvm-symbolizer for debug builds
        }
        #[cfg(not(any(windows, target_os = "linux")))]
        {
            // Assume debug symbol tooling is reliable.
            let debug_info = match debug::get_self_debug_info() {
                // SAFETY: lazy debug-only singleton; sole `&mut` for the dump below.
                Ok(d) => unsafe { &mut *d },
                Err(err) => {
                    let _ = write!(
                        stderr,
                        "Unable to dump stack trace: Unable to open debug info: {}\n",
                        bstr::BStr::new(err.name())
                    );
                    return;
                }
            };
            match write_stack_trace(
                trace,
                stderr,
                debug_info,
                debug::detect_tty_config_stderr(),
                &limits,
            ) {
                Ok(()) => return,
                Err(err) => {
                    let _ = write!(
                        stderr,
                        "Unable to dump stack trace: {}",
                        bstr::BStr::new(err.name())
                    );
                    return;
                }
            }
        }

        let programs: &[&bun_core::ZStr] = if cfg!(windows) {
            &[bun_core::zstr!("pdb-addr2line")]
        } else {
            // if `llvm-symbolizer` doesn't work, also try `llvm-symbolizer-21`
            &[
                bun_core::zstr!("llvm-symbolizer"),
                bun_core::zstr!("llvm-symbolizer-21"),
            ]
        };
        for &program in programs {
            // PERF(port): was arena bulk-free + StackFallbackAllocator — using global allocator in Phase A
            match spawn_symbolizer(program, trace) {
                // try next program if this one wasn't found
                Err(e) if e == bun_core::err!("FileNotFound") => continue,
                // Windows: `bun_core::spawn_sync_inherit` is currently a `#[cfg(not(unix))]`
                // stub returning `Unexpected`. Zig's `std.process.Child` *does* work on
                // Windows, so until the stub is filled in, treat the sentinel like
                // FileNotFound and fall through to the WTF fallback below instead of
                // returning with no trace at all.
                #[cfg(windows)]
                Err(e) if e == bun_core::err!("Unexpected") => continue,
                Err(_) => {}
                Ok(()) => {}
            }
            return;
        }
        let _ = limits;
        // INTENTIONAL DIVERGENCE from Zig spec (crash_handler.zig:1749-1760 falls
        // off the end of the `for (programs)` loop with no further fallback). On
        // Windows, `spawn_sync_inherit` is stubbed and `pdb-addr2line` is rarely
        // installed, so without this the user would get *only* "Fallback trace:"
        // and nothing else. Hand the raw addresses to WTF (always linked) so there
        // is at least some trace. Windows crash-trace snapshot tests must account
        // for this extra output.
        // SAFETY: trace.instruction_addresses is a valid slice of `index` entries
        unsafe {
            WTF__DumpStackTrace(trace.instruction_addresses.as_ptr(), trace.index);
        }
    }

    fn spawn_symbolizer(
        program: &bun_core::ZStr,
        trace: &StackTrace,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut argv: Vec<Vec<u8>> = Vec::new();
        argv.push(program.as_bytes().to_vec());
        argv.push(b"--exe".to_vec());
        argv.push({
            #[cfg(windows)]
            {
                // `to_utf8_alloc` is infallible (Vec<u8>); the Zig version returned
                // `![]u8` only for OOM, which Rust handles via abort.
                let image_path = strings::to_utf8_alloc(bun_sys::windows::exe_path_w());
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
            let Some(line) = StackLine::from_address(addr, &mut name_bytes) else {
                continue;
            };
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
        let n = debug::capture_stack_trace(
            first_address.unwrap_or_else(|| debug::return_address()),
            &mut addrs,
        );
        let stack = StackTrace {
            index: n,
            instruction_addresses: &addrs,
        };
        dump_stack_trace(&stack, limits);
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
            let mut existing_limit: libc::rlimit = bun_core::ffi::zeroed();
            // SAFETY: &mut existing_limit is a valid out-pointer.
            if unsafe { libc::getrlimit(libc::RLIMIT_CORE, &raw mut existing_limit) } != 0 {
                return;
            }
            if existing_limit.rlim_cur > 0 || existing_limit.rlim_cur == libc::RLIM_INFINITY {
                existing_limit.rlim_cur = 0;
                // SAFETY: &existing_limit is a valid in-pointer.
                unsafe {
                    libc::setrlimit(libc::RLIMIT_CORE, &raw const existing_limit);
                }
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

    // src/ptr/ref_count.rs:16). Re-export so `bun_crash_handler::StoredTrace` paths
    // keep compiling. NOTE: if `debug::return_address()` is ever wired to a real
    // `@returnAddress()` intrinsic, apply that improvement in bun_core's
    // `StoredTrace::capture()` instead — this crate no longer owns the type.
    pub use bun_core::StoredTrace;

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
            let this = unsafe { bun_ptr::callback_ctx::<T>(opaque_ptr) };
            let _ = handler(this);
        });

        BEFORE_CRASH_HANDLERS
            .lock()
            .push(CrashHandlerEntry(ptr.cast(), on_crash));
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

    pub struct SourceAtAddress {
        pub source_location: Option<SourceLocation>,
        pub symbol_name: Box<[u8]>,
        pub compile_unit_name: Box<[u8]>,
        // TODO(port): Zig stores borrowed slices owned by debug_info; using Box<[u8]> for Phase A.
    }

    // PORT NOTE: Zig's `SourceAtAddress.deinit` only freed `source_location.file_name`;
    // `Option<SourceLocation>` owns it as `Box<[u8]>` so Drop handles it — no explicit deinit.

    // D130: deduped — canonical def lives in bun_core (T0). Re-export under the
    // Zig-spec name so internal use-sites and any downstream
    // `bun_crash_handler::WriteStackTraceLimits` importers keep compiling.
    pub use bun_core::DumpStackTraceOptions as WriteStackTraceLimits;

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
        let mut frames_left: usize = stack_trace
            .index
            .min(stack_trace.instruction_addresses.len());

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

            let _ = tty_config.set_color(out_stream, Color::Bold);
            write!(
                out_stream,
                "({} additional stack frames not recorded...)\n",
                dropped_frames
            )
            .map_err(fmt_err)?;
            let _ = tty_config.set_color(out_stream, Color::Reset);
        } else if frames_left != 0 {
            let _ = tty_config.set_color(out_stream, Color::Bold);
            write!(
                out_stream,
                "({} additional stack frames skipped...)\n",
                frames_left
            )
            .map_err(fmt_err)?;
            let _ = tty_config.set_color(out_stream, Color::Reset);
        }
        let _ = out_stream.write_all(b"\n");
        Ok(())
    }

    /// Clone of `debug.printSourceAtAddress` but it returns the metadata as well.
    pub fn get_source_at_address(
        debug_info: &mut SelfInfo,
        address: usize,
    ) -> Result<Option<SourceAtAddress>, bun_core::Error> {
        let module = match debug_info.get_module_for_address(address) {
            Ok(m) => m,
            Err(e)
                if e == bun_core::err!("MissingDebugInfo")
                    || e == bun_core::err!("InvalidDebugInfo") =>
            {
                return Ok(None);
            }
            Err(e) => return Err(e),
        };

        let symbol_info = match module.get_symbol_at_address(address) {
            Ok(s) => s,
            Err(e)
                if e == bun_core::err!("MissingDebugInfo")
                    || e == bun_core::err!("InvalidDebugInfo") =>
            {
                return Ok(None);
            }
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
                    tty_config.set_color(out_stream, Color::Dim)?;
                    out_stream.write_all(base_path)?;
                    tty_config.set_color(out_stream, Color::Reset)?;
                    tty_config.set_color(out_stream, Color::Bold)?;
                    write!(
                        out_stream,
                        "{}",
                        bstr::BStr::new(&sl.file_name[base_path.len()..])
                    )
                    .map_err(fmt_err)?;
                } else {
                    tty_config.set_color(out_stream, Color::Bold)?;
                    write!(out_stream, "{}", bstr::BStr::new(&sl.file_name)).map_err(fmt_err)?;
                }
                write!(out_stream, ":{}:{}", sl.line, sl.column).map_err(fmt_err)?;
            } else {
                tty_config.set_color(out_stream, Color::Bold)?;
                out_stream.write_all(b"???:?:?")?;
            }

            tty_config.set_color(out_stream, Color::Reset)?;
            out_stream.write_all(b": ")?;
            tty_config.set_color(out_stream, Color::Dim)?;
            write!(out_stream, "0x{:x} in", address).map_err(fmt_err)?;
            tty_config.set_color(out_stream, Color::Reset)?;
            tty_config.set_color(out_stream, Color::Yellow)?;
            write!(out_stream, " {}", bstr::BStr::new(symbol_name)).map_err(fmt_err)?;
            tty_config.set_color(out_stream, Color::Reset)?;
            tty_config.set_color(out_stream, Color::Dim)?;
            write!(out_stream, " ({})", bstr::BStr::new(compile_unit_name)).map_err(fmt_err)?;
            tty_config.set_color(out_stream, Color::Reset)?;
            out_stream.write_all(b"\n")?;

            // Show the matching source code line if possible
            if let Some(sl) = source_location {
                match print_line_from_file_any_os(out_stream, tty_config, sl) {
                    Ok(()) => {
                        if sl.column > 0 && tty_config == TtyConfig::NoColor {
                            // The caret already takes one char
                            let space_needed = (sl.column - 1) as usize;
                            out_stream.splat_byte_all(b' ', space_needed)?;
                            out_stream.write_all(b"^\n")?;
                        }
                    }
                    Err(e)
                        if e == bun_core::err!("EndOfFile")
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
        let f = bun_sys::File::openat(
            bun_sys::Fd::cwd(),
            &source_location.file_name,
            bun_sys::O::RDONLY,
            0,
        )
        .map_err(bun_core::Error::from)?;
        let _close_f = bun_sys::CloseOnDrop::file(&f);

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
                    if let Some(pos) = bun_core::index_of_char(slice, b'\n') {
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
            if let Some(pos) = bun_core::index_of_char(slice, b'\n') {
                let line = &mut slice[0..pos];
                for b in line.iter_mut() {
                    if *b == b'\t' {
                        *b = b' ';
                    }
                }
                let n = line.len().min(line_buf.len() - fbs_len);
                line_buf[fbs_len..fbs_len + n].copy_from_slice(&line[..n]);
                fbs_len += n;
                break 'read_line;
            } else {
                // Line is the last inside the buffer, and requires another read to find delimiter. Alternatively the file ends.
                for b in slice.iter_mut() {
                    if *b == b'\t' {
                        *b = b' ';
                    }
                }
                let n = slice.len().min(line_buf.len() - fbs_len);
                line_buf[fbs_len..fbs_len + n].copy_from_slice(&slice[..n]);
                fbs_len += n;
                if n < slice.len() {
                    break 'read_line;
                }
                while amt_read == buf.len() {
                    amt_read = f.read(&mut buf[..])?;
                    if let Some(pos) = bun_core::index_of_char(&buf[0..amt_read], b'\n') {
                        let line = &mut buf[0..pos];
                        for b in line.iter_mut() {
                            if *b == b'\t' {
                                *b = b' ';
                            }
                        }
                        let n2 = line.len().min(line_buf.len() - fbs_len);
                        line_buf[fbs_len..fbs_len + n2].copy_from_slice(&line[..n2]);
                        fbs_len += n2;
                        break 'read_line;
                    } else {
                        let line = &mut buf[0..amt_read];
                        for b in line.iter_mut() {
                            if *b == b'\t' {
                                *b = b' ';
                            }
                        }
                        let n2 = line.len().min(line_buf.len() - fbs_len);
                        line_buf[fbs_len..fbs_len + n2].copy_from_slice(&line[..n2]);
                        fbs_len += n2;
                        if n2 < line.len() {
                            break 'read_line;
                        }
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
        if let Some(pos) = bun_core::index_of(after_before_comment, b"//") {
            comment = &after_before_comment[pos..];
            after_before_comment = &after_before_comment[0..pos];
        }
        tty_config.set_color(out_stream, Color::Red)?;
        tty_config.set_color(out_stream, Color::Dim)?;
        out_stream.write_all(before)?;
        tty_config.set_color(out_stream, Color::Reset)?;
        tty_config.set_color(out_stream, Color::Red)?;
        out_stream.write_all(highlight)?;
        tty_config.set_color(out_stream, Color::Dim)?;
        out_stream.write_all(after_before_comment)?;
        if !comment.is_empty() {
            tty_config.set_color(out_stream, Color::Reset)?;
            tty_config.set_color(out_stream, Color::BrightCyan)?;
            out_stream.write_all(comment)?;
        }
        tty_config.set_color(out_stream, Color::Reset)?;
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
        let name_bytes = unsafe { bun_core::ffi::cstr(name) }.to_bytes();
        // PORTING.md §Forbidden: no Box::leak. We're on the noreturn path, so a stack
        // buffer suffices — `panic_impl` erases to &'static for the abort path.
        let mut msg = BoundedArray::<u8, 256>::default();
        let _ = write!(
            msg.writer(),
            "unsupported uv function: {}",
            bstr::BStr::new(name_bytes)
        );
        panic_impl(msg.slice(), None, None);
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__crashHandler(message_ptr: *const u8, message_len: usize) -> ! {
        // SAFETY: caller passes a valid (ptr, len) byte slice
        let msg = unsafe { core::slice::from_raw_parts(message_ptr, message_len) };
        crash_handler(
            // SAFETY: noreturn — see panic_impl note
            CrashReason::Panic(unsafe { bun_collections::detach_lifetime(msg) }),
            None,
            Some(debug::return_address()),
        );
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn CrashHandler__setDlOpenAction(action: *const c_char) {
        if !action.is_null() {
            debug_assert!(CURRENT_ACTION.with(|c| c.get()).is_none());
            // SAFETY: action is a valid NUL-terminated C string for the duration of the dlopen call
            let s = unsafe { bun_core::ffi::cstr(action) }.to_bytes();
            // SAFETY: noreturn-on-crash usage; the C string outlives the action via caller contract
            CURRENT_ACTION.with(|c| {
                c.set(Some(Action::Dlopen(unsafe {
                    bun_collections::detach_lifetime(s)
                })))
            });
        } else {
            debug_assert!(matches!(
                CURRENT_ACTION.with(|c| c.get()),
                Some(Action::Dlopen(_))
            ));
            CURRENT_ACTION.with(|c| c.set(None));
        }
    }

    pub fn fix_dead_code_elimination() {
        bun_core::keep_symbols!(CrashHandler__unsupportedUVFunction);
    }
    // In Zig: comptime { _ = &Bun__crashHandler; ... } — Rust links #[no_mangle] symbols unconditionally.
} // end mod draft

// ported from: src/crash_handler/crash_handler.zig
