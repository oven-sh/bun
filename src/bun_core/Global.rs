#![allow(non_upper_case_globals, non_snake_case)]

use core::ffi::{c_char, c_int, c_void};
#[allow(unused_imports)]
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicUsize, Ordering};

use const_format::{concatcp, formatcp};

use crate::env; // @import("./env.zig")
use crate::env::version_string;
use crate::output as Output; // @import("./output.zig")

use bun_alloc as alloc;
use crate::{USE_MIMALLOC, debug_allocator_data}; // B-1 stubs (real consts ungate in B-2)
// MOVE_DOWN: bun_str::ZStr → bun_core (move-in pass).
use crate::ZStr;

// ──────────────────────────────────────────────────────────────────────────
// Process-wide top-level directory (cwd at startup). Storage lives at T0 so
// `bun_sys::File::read_from_user_input` reads it directly; the resolver's
// `FileSystem::init` writes it once via `set_top_level_dir`.
// ──────────────────────────────────────────────────────────────────────────

// Stored behind a `RwLock<&'static [u8]>` rather than a split (AtomicPtr,
// AtomicUsize) pair: `install::PackageManager` calls `fs.set_top_level_dir()`
// during workspace discovery (potentially after worker threads exist), so a
// reader could otherwise observe an OLD len with a NEW ptr (or vice-versa) and
// build an out-of-bounds `from_raw_parts`. The read path is cold (display /
// path-relative formatting) so one uncontended read-lock is cheaper than a UB
// window; writes are rare and serial.
static TOP_LEVEL_DIR: parking_lot::RwLock<&'static [u8]> = parking_lot::RwLock::new(b".");

/// Record the top-level directory (interned `'static` slice). Idempotent;
/// later calls overwrite. Called from `FileSystem::init` / `set_top_level_dir`.
#[inline]
pub fn set_top_level_dir(dir: &'static [u8]) {
    *TOP_LEVEL_DIR.write() = dir;
}

/// Top-level directory recorded at startup (defaults to `"."`).
#[inline]
pub fn top_level_dir() -> &'static [u8] {
    *TOP_LEVEL_DIR.read()
}

/// Set by `bun_crash_handler::init()` once it has installed its segfault
/// handlers. `raise_ignoring_panic_handler` consults this to decide whether
/// the crash signals need resetting to `SIG_DFL` before re-raising.
pub static CRASH_HANDLER_INSTALLED: AtomicBool = AtomicBool::new(false);

/// VEH handle returned by `AddVectoredExceptionHandler`, written by
/// `bun_crash_handler::init()` on Windows. `raise_ignoring_panic_handler`
/// removes it before re-raising so the signal goes to the OS default.
#[cfg(windows)]
pub static WINDOWS_SEGFAULT_HANDLE: core::sync::atomic::AtomicPtr<c_void> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

// ──────────────────────────────────────────────────────────────────────────
// crash_handler primitives (moved from ptr/safety/collections/sys)
// StoredTrace + dump_stack_trace + panicking state are pure data + libc; the
// platform-specific symbolication / SEH bits stay in bun_crash_handler (T>core).
// ──────────────────────────────────────────────────────────────────────────

/// Zig: `std.builtin.StackTrace` — slice of return addresses + cursor.
#[derive(Clone, Copy)]
pub struct StackTrace<'a> {
    pub index: usize,
    pub instruction_addresses: &'a [usize],
}

/// Zig: src/crash_handler/crash_handler.zig::StoredTrace — fixed 31-frame buffer.
#[derive(Clone, Copy)]
pub struct StoredTrace {
    pub data: [usize; 31],
    pub index: usize,
}
impl StoredTrace {
    pub const fn empty() -> Self {
        Self { data: [0; 31], index: 0 }
    }
}
impl StoredTrace {
    pub const EMPTY: StoredTrace = StoredTrace { data: [0; 31], index: 0 };

    #[inline]
    pub fn trace(&self) -> StackTrace<'_> {
        StackTrace { index: self.index, instruction_addresses: &self.data }
    }

    /// Capture the current call stack starting at `begin` (or the caller's return addr).
    pub fn capture(begin: Option<usize>) -> StoredTrace {
        let mut stored = StoredTrace::EMPTY;
        // TODO(port): Zig used std.debug.captureStackTrace. Use the C++ helper
        // (also used by the WTF fallback path) so we don't pull in `backtrace` crate.
        unsafe extern "C" {
            fn Bun__captureStackTrace(begin: usize, out: *mut usize, cap: usize) -> usize;
        }
        let n = unsafe {
            Bun__captureStackTrace(begin.unwrap_or(0), stored.data.as_mut_ptr(), stored.data.len())
        };
        stored.index = n;
        // Trim trailing nulls (matches Zig loop).
        for (i, &addr) in stored.data[..n].iter().enumerate() {
            if addr == 0 { stored.index = i; break; }
        }
        stored
    }

    pub fn from(stack_trace: Option<&StackTrace<'_>>) -> StoredTrace {
        match stack_trace {
            None => StoredTrace::EMPTY,
            Some(stack) => {
                let mut data = [0usize; 31];
                let items = core::cmp::min(stack.instruction_addresses.len(), 31);
                data[..items].copy_from_slice(&stack.instruction_addresses[..items]);
                StoredTrace { data, index: core::cmp::min(items, stack.index) }
            }
        }
    }
}

/// Zig: `WriteStackTraceLimits`. Aliased as `DumpOptions` for safety/sys callers.
#[derive(Clone, Debug)]
pub struct DumpStackTraceOptions {
    pub frame_count: usize,
    pub stop_at_jsc_llint: bool,
    pub skip_stdlib: bool,
    pub skip_file_patterns: &'static [&'static [u8]],
    pub skip_function_patterns: &'static [&'static [u8]],
}
impl Default for DumpStackTraceOptions {
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
pub type DumpOptions = DumpStackTraceOptions;

/// Zig: `crash_handler.dumpStackTrace`. T0 fallback prints raw return
/// addresses — **no symbolication** (the `backtrace` crate is not a T0 dep,
/// and `std::backtrace` cannot resolve a stored address list). This is a
/// deliberate debug-UX downgrade vs the Zig spec for the *stored*-trace path
/// (ref_count leak reports); the *current*-stack path below
/// uses `std::backtrace` and stays symbolicated. Crash-report paths that need
/// llvm-symbolizer / pdb-addr2line call `bun_crash_handler::dump_stack_trace`
/// directly — that crate sits above us so it owns the rich impl without a hook.
///
/// `limits.stop_at_jsc_llint` / `skip_stdlib` / `skip_*_patterns` are accepted
/// for signature parity but **ignored** here (they require symbol names to
/// match against). Only `frame_count` is honoured.
pub fn dump_stack_trace(trace: &StackTrace<'_>, limits: DumpStackTraceOptions) {
    crate::output::flush();
    let n = trace.index.min(trace.instruction_addresses.len()).min(limits.frame_count);
    for &addr in &trace.instruction_addresses[..n] {
        if addr == 0 { break; }
        eprintln!("    at 0x{addr:x}");
    }
}

/// Capture and dump the current call stack. Uses `std::backtrace` so T0
/// callers (ThreadLock-panic, FD-debug) still get symbolicated frames without
/// reaching up to `bun_crash_handler`. `limits` is accepted for signature
/// parity with `bun_crash_handler::dump_current_stack_trace` but **ignored**
/// (see body); the rich llvm-symbolizer / frame-filtered path lives in
/// `bun_crash_handler` for crash reports specifically.
pub fn dump_current_stack_trace(first_address: Option<usize>, limits: DumpStackTraceOptions) {
    // `std::backtrace` cannot seed capture from a return address, so the Zig
    // behaviour of skipping frames above `first_address` (e.g. ref_count
    // passing `return_address()` so the dump starts at the user's ref/deref
    // site) is not reproduced here — the dump helper + a couple of internal
    // frames appear as leading noise. Debug-only; the parameter is kept so the
    // signature matches `bun_crash_handler::dump_current_stack_trace` (which
    // *does* honour it via `StoredTrace::capture`).
    let _ = first_address;
    // `frame_count` truncation is dropped to avoid the intermediate
    // `format!` heap allocation on a path that may run during panic/OOM
    // (`force_capture` already allocates internally, so this only removes the
    // *extra* alloc — debug-only output, the few extra trailing frames are
    // acceptable noise).
    let _ = limits;
    crate::output::flush();
    let bt = std::backtrace::Backtrace::force_capture();
    eprintln!("{bt}");
}

// ─── panicking state (from bun_crash_handler) ─────────────────────────────
// Zig: `var panicking = std.atomic.Value(u8).init(0)`. Owned here so the
// crash handler crate writes to `bun_core::PANICKING` (forward dep, allowed).
pub static PANICKING: core::sync::atomic::AtomicU8 = core::sync::atomic::AtomicU8::new(0);

#[inline]
pub fn is_panicking() -> bool {
    PANICKING.load(Ordering::Relaxed) > 0
}

/// Zig: crash_handler.sleepForeverIfAnotherThreadIsCrashing.
pub fn sleep_forever_if_another_thread_is_crashing() {
    if PANICKING.load(Ordering::Acquire) > 0 {
        // Sleep forever without hammering the CPU. Zig used `bun.Futex.waitForever`;
        // parking_lot's `park()` is the moral equivalent (never unparked).
        loop {
            std::thread::park();
        }
    }
}

// ─── SignalCode (from bun_sys, TYPE_ONLY) ─────────────────────────────────
// Zig: src/sys/SignalCode.zig — enum(u8) with POSIX numbering. Only the
// discriminant is needed at this tier (raise_ignoring_panic_handler casts to c_int).
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[allow(clippy::upper_case_acronyms)]
pub enum SignalCode {
    SIGHUP = 1, SIGINT = 2, SIGQUIT = 3, SIGILL = 4, SIGTRAP = 5, SIGABRT = 6,
    SIGBUS = 7, SIGFPE = 8, SIGKILL = 9, SIGUSR1 = 10, SIGSEGV = 11, SIGUSR2 = 12,
    SIGPIPE = 13, SIGALRM = 14, SIGTERM = 15, SIG16 = 16, SIGCHLD = 17, SIGCONT = 18,
    SIGSTOP = 19, SIGTSTP = 20, SIGTTIN = 21, SIGTTOU = 22, SIGURG = 23, SIGXCPU = 24,
    SIGXFSZ = 25, SIGVTALRM = 26, SIGPROF = 27, SIGWINCH = 28, SIGIO = 29, SIGPWR = 30,
    SIGSYS = 31,
}
impl SignalCode {
    pub const DEFAULT: SignalCode = SignalCode::SIGTERM;

    /// Zig: `SignalCode.name(self) ?[]const u8` — maps a signal to its
    /// canonical `"SIGxxx"` name. The bun_core enum is exhaustive (1..=31),
    /// so every variant has a name; the `Option` in bun_sys exists only for
    /// the open-ended `enum(u8) { _, }` newtype port.
    pub fn name(self) -> &'static str {
        match self {
            Self::SIGHUP => "SIGHUP",
            Self::SIGINT => "SIGINT",
            Self::SIGQUIT => "SIGQUIT",
            Self::SIGILL => "SIGILL",
            Self::SIGTRAP => "SIGTRAP",
            Self::SIGABRT => "SIGABRT",
            Self::SIGBUS => "SIGBUS",
            Self::SIGFPE => "SIGFPE",
            Self::SIGKILL => "SIGKILL",
            Self::SIGUSR1 => "SIGUSR1",
            Self::SIGSEGV => "SIGSEGV",
            Self::SIGUSR2 => "SIGUSR2",
            Self::SIGPIPE => "SIGPIPE",
            Self::SIGALRM => "SIGALRM",
            Self::SIGTERM => "SIGTERM",
            Self::SIG16 => "SIG16",
            Self::SIGCHLD => "SIGCHLD",
            Self::SIGCONT => "SIGCONT",
            Self::SIGSTOP => "SIGSTOP",
            Self::SIGTSTP => "SIGTSTP",
            Self::SIGTTIN => "SIGTTIN",
            Self::SIGTTOU => "SIGTTOU",
            Self::SIGURG => "SIGURG",
            Self::SIGXCPU => "SIGXCPU",
            Self::SIGXFSZ => "SIGXFSZ",
            Self::SIGVTALRM => "SIGVTALRM",
            Self::SIGPROF => "SIGPROF",
            Self::SIGWINCH => "SIGWINCH",
            Self::SIGIO => "SIGIO",
            Self::SIGPWR => "SIGPWR",
            Self::SIGSYS => "SIGSYS",
        }
    }
}

// ─── analytics::features (MOVE_DOWN from bun_analytics) ───────────────────
// Zig: src/analytics/analytics.zig::Features — bag of `pub var X: usize`.
// Port as atomic counters so cross-thread `.fetch_add` is sound. Only the
// counters are tier-0; `builtin_modules` (EnumSet over jsc HardcodedModule)
// stays in bun_analytics (depends on tier-6).
pub mod features {
    use core::sync::atomic::AtomicUsize;
    macro_rules! feat { ($($name:ident),* $(,)?) => { $(pub static $name: AtomicUsize = AtomicUsize::new(0);)* } }
    feat! {
        BUN_STDERR, BUN_STDIN, BUN_STDOUT, WEBSOCKET, ABORT_SIGNAL, BINLINKS, BUNFIG,
        DEFINE, DOTENV, DEBUGGER, EXTERNAL, EXTRACTED_PACKAGES, FETCH, GIT_DEPENDENCIES,
        HTML_REWRITER, TCP_SERVER, TLS_SERVER, HTTP_SERVER, HTTPS_SERVER, HTTP_CLIENT_PROXY,
        JSC, DEV_SERVER, LIFECYCLE_SCRIPTS, LOADERS, LOCKFILE_MIGRATION_FROM_PACKAGE_LOCK,
        TEXT_LOCKFILE, ISOLATED_BUN_INSTALL, HOISTED_BUN_INSTALL, MACROS, NO_AVX2, NO_AVX,
        SHELL, SPAWN, STANDALONE_EXECUTABLE, STANDALONE_SHELL, TODO_PANIC, TRANSPILER_CACHE,
        TSCONFIG, TSCONFIG_PATHS, VIRTUAL_MODULES, WORKERS_SPAWNED, WORKERS_TERMINATED,
        NAPI_MODULE_REGISTER, EXITED, YAML_PARSE, YARN_MIGRATION, PNPM_MIGRATION,
        VALKEY,
    }
    /// dotenv crate calls `bun_core::analytics::Features::dotenv_inc()`.
    #[inline] pub fn dotenv_inc() { DOTENV.fetch_add(1, core::sync::atomic::Ordering::Relaxed); }
    /// install crate calls `bun_core::analytics::Features::binlinks_inc()`.
    #[inline] pub fn binlinks_inc() { BINLINKS.fetch_add(1, core::sync::atomic::Ordering::Relaxed); }
    /// install crate calls `bun_core::analytics::Features::extracted_packages_inc()`.
    #[inline] pub fn extracted_packages_inc() { EXTRACTED_PACKAGES.fetch_add(1, core::sync::atomic::Ordering::Relaxed); }
    /// yaml crate calls `bun_core::analytics::Features::yaml_parse_inc()`.
    #[inline] pub fn yaml_parse_inc() { YAML_PARSE.fetch_add(1, core::sync::atomic::Ordering::Relaxed); }
    /// install crate calls `bun_core::analytics::Features::lifecycle_scripts_inc(1)`.
    #[inline] pub fn lifecycle_scripts_inc(n: usize) { LIFECYCLE_SCRIPTS.fetch_add(n, core::sync::atomic::Ordering::Relaxed); }
    /// install/yarn crate calls `bun_core::analytics::Features::yarn_migration_inc(1)`.
    #[inline] pub fn yarn_migration_inc(n: usize) { YARN_MIGRATION.fetch_add(n, core::sync::atomic::Ordering::Relaxed); }
    /// install/pnpm crate calls `bun_core::analytics::Features::pnpm_migration_inc(1)`.
    #[inline] pub fn pnpm_migration_inc(n: usize) { PNPM_MIGRATION.fetch_add(n, core::sync::atomic::Ordering::Relaxed); }
    /// install crate calls `bun_core::analytics::Features::text_lockfile_inc()`.
    #[inline] pub fn text_lockfile_inc() { TEXT_LOCKFILE.fetch_add(1, core::sync::atomic::Ordering::Relaxed); }
    /// install/migration crate calls `bun_core::analytics::Features::lockfile_migration_from_package_lock_inc()`.
    #[inline] pub fn lockfile_migration_from_package_lock_inc() { LOCKFILE_MIGRATION_FROM_PACKAGE_LOCK.fetch_add(1, core::sync::atomic::Ordering::Relaxed); }
    /// jsc crate calls `bun_core::analytics::Features::jsc_inc()` from
    /// `initialize()` (spec jsc.zig:251 `bun.analytics.Features.jsc += 1`).
    #[inline] pub fn jsc_inc() { JSC.fetch_add(1, core::sync::atomic::Ordering::Relaxed); }
}
/// Re-export under the `analytics` name so `bun_core::analytics::Features::*` resolves
/// (per movein-skipped [dotenv] entry).
pub mod analytics {
    pub use super::features as Features;
    pub use super::features;
}

// ─── mark_binding! (MOVE_DOWN from bun_jsc, for aio/event_loop/http_jsc) ──
// Zig: jsc.zig::markBinding(@src()) → scoped_log!(JSC, "{fn} ({file}:{line})").
// Pure logging; no jsc dep. Declares the JSC scope on first use.
crate::declare_scope!(JSC, hidden);
#[macro_export]
macro_rules! mark_binding {
    () => {
        $crate::mark_binding!(::core::panic::Location::caller().file())
    };
    ($fn_name:expr) => {
        // Zig: `Output.scoped(.JSC, .hidden)` (jsc.zig:169) — opt-in via
        // BUN_DEBUG_JSC=1. The `JSC` scope is owned by bun_core. Gate on
        // `debug_assertions` (== `Environment::ENABLE_LOGS`) — never on a Cargo
        // feature, since `cfg!(feature = ..)` is resolved against the *calling*
        // crate and would warn (or silently no-op) in crates without it.
        if cfg!(debug_assertions) && $crate::Global::JSC_SCOPE.is_visible() {
            $crate::Global::JSC_SCOPE.log(
                ::core::format_args!("[JSC] {} ({}:{})\n", $fn_name, ::core::file!(), ::core::line!()),
            );
        }
    };
}
/// Shared `bun.Output.scoped(.JSC, .hidden)` logger for `mark_binding!`.
pub static JSC_SCOPE: crate::output::ScopedLogger =
    crate::output::ScopedLogger::new("JSC", crate::output::Visibility::Hidden);

// ─── debug_flags (MOVE_DOWN from bun_cli, for bun_resolver) ───────────────
// Zig: src/cli/cli.zig::debug_flags — debug-build-only breakpoint matchers.
pub mod debug_flags {
    #[cfg(debug_assertions)]
    pub static RESOLVE_BREAKPOINTS: crate::RacyCell<&[&[u8]]> = crate::RacyCell::new(&[]);
    #[cfg(debug_assertions)]
    pub static PRINT_BREAKPOINTS: crate::RacyCell<&[&[u8]]> = crate::RacyCell::new(&[]);

    #[inline]
    pub fn has_resolve_breakpoint(str_: &[u8]) -> bool {
        #[cfg(debug_assertions)]
        // SAFETY: written once during single-threaded CLI startup.
        for bp in unsafe { RESOLVE_BREAKPOINTS.read() } {
            if crate::strings::includes(str_, bp) { return true; }
        }
        false
    }
    #[inline]
    pub fn has_print_breakpoint(pretty: &[u8], text: &[u8]) -> bool {
        #[cfg(debug_assertions)]
        // SAFETY: written once during single-threaded CLI startup.
        for bp in unsafe { PRINT_BREAKPOINTS.read() } {
            if crate::strings::includes(pretty, bp) || crate::strings::includes(text, bp) {
                return true;
            }
        }
        let _ = (pretty, text);
        false
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Version strings
// ──────────────────────────────────────────────────────────────────────────

/// Does not have the canary tag, because it is exposed in `Bun.version`
/// "1.0.0" or "1.0.0-debug"
pub const package_json_version: &str = if cfg!(debug_assertions) {
    concatcp!(version_string, "-debug")
} else {
    version_string
};

/// This is used for `bun` without any arguments, it `package_json_version` but with canary if it is a canary build.
/// like "1.0.0-canary.12"
pub const package_json_version_with_canary: &str = if cfg!(debug_assertions) {
    concatcp!(version_string, "-debug")
} else if env::IS_CANARY {
    formatcp!("{}-canary.{}", version_string, env::CANARY_REVISION)
} else {
    version_string
};

// PORT NOTE: Zig sliced `git_sha[0..@min(len, 8)]` inline; we use the
// pre-computed `GIT_SHA_SHORT` (same value) since const slicing of a const
// `&str` by a runtime-ish min() is awkward in stable Rust.
/// The version and a short hash in parenthesis.
pub const package_json_version_with_sha: &str = if env::GIT_SHA.is_empty() {
    package_json_version
} else if cfg!(debug_assertions) {
    formatcp!("{} ({})", version_string, env::GIT_SHA_SHORT)
} else if env::IS_CANARY {
    formatcp!(
        "{}-canary.{} ({})",
        version_string,
        env::CANARY_REVISION,
        env::GIT_SHA_SHORT
    )
} else {
    formatcp!("{} ({})", version_string, env::GIT_SHA_SHORT)
};

/// What is printed by `bun --revision`
/// "1.0.0+abcdefghi" or "1.0.0-canary.12+abcdefghi"
pub const package_json_version_with_revision: &str = if env::GIT_SHA.is_empty() {
    package_json_version
} else if cfg!(debug_assertions) {
    formatcp!("{}-debug+{}", version_string, env::GIT_SHA_SHORT)
} else if env::IS_CANARY {
    formatcp!(
        "{}-canary.{}+{}",
        version_string,
        env::CANARY_REVISION,
        env::GIT_SHA_SHORT
    )
} else {
    formatcp!("{}+{}", version_string, env::GIT_SHA_SHORT)
};

// Node-style platform string. Distinct from Environment.os.nameString() on
// Android: the kernel-level OS enum stays .linux (so syscall switches keep
// working), but user-facing strings — npm user-agent, process.platform —
// must be "android" so native-addon postinstalls don't fetch glibc binaries.
pub const os_name: &str = if cfg!(target_os = "android") {
    "android"
} else {
    env::OS.name_string()
};
pub const os_display: &str = if cfg!(target_os = "android") {
    "Android"
} else {
    env::OS.display_string()
};

// Bun v1.0.0 (Linux x64 baseline)
// Bun v1.0.0-debug (Linux x64)
// Bun v1.0.0-canary.0+44e09bb7f (Linux x64)
pub const unhandled_error_bun_version_string: &str = concatcp!(
    "Bun v",
    if env::IS_CANARY {
        package_json_version_with_revision
    } else {
        package_json_version
    },
    " (",
    os_display,
    " ",
    arch_name,
    if env::BASELINE { " baseline)" } else { ")" },
);

pub const arch_name: &str = if cfg!(target_arch = "x86_64") {
    "x64"
} else if cfg!(target_arch = "x86") {
    "x86"
} else if cfg!(target_arch = "aarch64") {
    "arm64"
} else {
    "unknown"
};

#[inline]
pub fn get_start_time() -> i128 {
    crate::start_time()
    // TODO(port): Zig reads `bun.start_time` (a global i128). Expose as
    // `bun_core::start_time()` or a `static AtomicI128`-equivalent.
}

// ──────────────────────────────────────────────────────────────────────────
// Thread naming
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
// MOVE_DOWN: bun_sys::windows → crate::windows_sys (T0 leaf shim).
unsafe extern "system" {
    fn SetThreadDescription(
        thread: crate::windows_sys::HANDLE,
        name: *const u16,
    ) -> crate::windows_sys::HRESULT;
}

pub fn set_thread_name(name: &ZStr) {
    // Zig `Environment.isLinux` is true on Android (linux OS + android ABI);
    // Rust's `target_os = "linux"` is not, so include android explicitly.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        // SAFETY: PR_SET_NAME takes a NUL-terminated byte string; `name` is `[:0]const u8`.
        unsafe {
            let _ = libc::prctl(libc::PR_SET_NAME, name.as_ptr() as usize);
        }
    }
    #[cfg(target_os = "macos")]
    {
        // SAFETY: macOS pthread_setname_np takes the current thread implicitly.
        unsafe {
            let _ = libc::pthread_setname_np(name.as_ptr().cast::<c_char>());
        }
    }
    #[cfg(target_os = "freebsd")]
    {
        // SAFETY: FreeBSD signature is (pthread_t, const char*).
        unsafe {
            libc::pthread_set_name_np(libc::pthread_self(), name.as_ptr().cast::<c_char>());
        }
    }
    #[cfg(windows)]
    {
        let _ = name;
        // TODO: use SetThreadDescription or NtSetInformationThread with 0x26 (ThreadNameInformation)
        // without causing exit code 0xC0000409 (stack buffer overrun) in child process
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Exit callbacks
// ──────────────────────────────────────────────────────────────────────────

pub type ExitFn = unsafe extern "C" fn();

// PORT NOTE: Zig used an unsynchronized global `ArrayListUnmanaged`. Registration
// can happen from any thread (FFI `Bun__atexit`), so guard with a Mutex.
static ON_EXIT_CALLBACKS: parking_lot::Mutex<Vec<ExitFn>> = parking_lot::Mutex::new(Vec::new());

#[unsafe(no_mangle)]
pub extern "C" fn Bun__atexit(function: ExitFn) {
    let mut cbs = ON_EXIT_CALLBACKS.lock();
    if !cbs.iter().any(|f| *f as usize == function as usize) {
        cbs.push(function);
    }
}

pub fn add_exit_callback(function: ExitFn) {
    Bun__atexit(function);
}

/// Callbacks `Bun__onExit` runs BEFORE `run_exit_callbacks()`. Spec
/// `Global.zig:220` hard-codes `bun.jsc.Node.FSEvents.closeAndWait()` ahead of
/// `runExitCallbacks()`; that crate sits above us, so it pushes its callback
/// here at first-loop creation (data moved down — same `Vec<ExitFn>` shape as
/// `ON_EXIT_CALLBACKS`, no fn-ptr type-erase).
static PRE_EXIT_CALLBACKS: parking_lot::Mutex<Vec<ExitFn>> = parking_lot::Mutex::new(Vec::new());

pub fn add_pre_exit_callback(function: ExitFn) {
    let mut cbs = PRE_EXIT_CALLBACKS.lock();
    if !cbs.iter().any(|f| *f as usize == function as usize) {
        cbs.push(function);
    }
}

pub fn run_exit_callbacks() {
    // Drain under lock, run outside it (callbacks may call `Bun__atexit`).
    let cbs: Vec<ExitFn> = core::mem::take(&mut *ON_EXIT_CALLBACKS.lock());
    for callback in &cbs {
        // SAFETY: callbacks are `unsafe extern "C" fn()`; called once at exit.
        unsafe { callback() };
    }
}

static IS_EXITING: AtomicBool = AtomicBool::new(false);

#[unsafe(no_mangle)]
pub extern "C" fn bun_is_exiting() -> c_int {
    is_exiting() as c_int
}

pub fn is_exiting() -> bool {
    IS_EXITING.load(Ordering::Relaxed)
}

/// Flushes stdout and stderr (in exit/quick_exit callback) and exits with the given code.
pub fn exit(code: u32) -> ! {
    IS_EXITING.store(true, Ordering::Relaxed);
    // _ = @atomicRmw(usize, &bun.analytics.Features.exited, .Add, 1, .monotonic);
    // MOVE_DOWN: bun_analytics::features → bun_core (move-in pass).
    crate::features::EXITED.fetch_add(1, Ordering::Relaxed);

    // If we are crashing, allow the crash handler to finish it's work.
    // MOVE_DOWN: bun_crash_handler::sleep_forever_if_another_thread_is_crashing → bun_core.
    crate::sleep_forever_if_another_thread_is_crashing();

    #[cfg(debug_assertions)]
    {
        // TODO(port): Zig asserts the debug allocator deinit() == .ok and nulls
        // the backing. Map to `bun_alloc::debug_allocator_data` once ported.
        debug_assert!(debug_allocator_data::deinit_ok());
    }

    // Flush output before exiting to ensure all messages are visible
    Output::flush();

    #[cfg(target_os = "macos")]
    {
        // SAFETY: libc exit is noreturn.
        unsafe { libc::exit(code as i32) }
    }
    #[cfg(windows)]
    {
        Bun__onExit();
        // SAFETY: ExitProcess never returns.
        unsafe { crate::windows_sys::kernel32::ExitProcess(code) }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        if env::ENABLE_ASAN {
            // SAFETY: libc exit is noreturn.
            unsafe { libc::exit(code as i32) };
            // SAFETY: abort is noreturn; unreachable fallback if exit returns.
            #[allow(unreachable_code)]
            unsafe {
                libc::abort()
            };
        }
        // SAFETY: quick_exit is noreturn.
        unsafe extern "C" {
            fn quick_exit(code: c_int) -> !;
        }
        unsafe { quick_exit(code as c_int) };
        // SAFETY: abort is noreturn; unreachable fallback if quick_exit returns.
        #[allow(unreachable_code)]
        unsafe {
            libc::abort()
        };
    }
}

pub fn raise_ignoring_panic_handler(sig: crate::SignalCode) -> ! {
    raise_ignoring_panic_handler_raw(sig as c_int)
}

/// Re-raise `sig` (raw `c_int`) after restoring TTY/crash state. Zig's
/// `SignalCode` is a *non-exhaustive* `enum(u8)`, so callers may forward any
/// signal byte (incl. Linux RT signals 32..=64) that has no `crate::SignalCode`
/// discriminant. Mirrors `raiseIgnoringPanicHandler(@enumFromInt(sig))`.
pub fn raise_ignoring_panic_handler_raw(sig: c_int) -> ! {
    Output::flush();
    Output::source::stdio::restore();

    // Clear the crash handler's segfault hooks so the re-raised signal goes to
    // SIG_DFL instead of recursing into the panic handler. Storage moved down
    // from `bun_crash_handler` — it sets `CRASH_HANDLER_INSTALLED` on init and
    // we do the libc reset ourselves (no fn-ptr hook). Mirrors
    // `crash_handler.zig::resetSegfaultHandler`: skip when ASAN owns the
    // signals (we never installed over them); on Windows remove the VEH.
    #[cfg(unix)]
    if CRASH_HANDLER_INSTALLED.load(Ordering::Relaxed) && !crate::env::ENABLE_ASAN {
        // SAFETY: zeroed sigaction with SIG_DFL is a valid disposition.
        unsafe {
            let mut act: libc::sigaction = crate::ffi::zeroed();
            act.sa_sigaction = libc::SIG_DFL;
            libc::sigemptyset(&raw mut act.sa_mask);
            for &s in &[libc::SIGSEGV, libc::SIGBUS, libc::SIGILL, libc::SIGFPE] {
                let _ = libc::sigaction(s, &raw const act, core::ptr::null_mut());
            }
        }
    }
    #[cfg(windows)]
    if CRASH_HANDLER_INSTALLED.load(Ordering::Relaxed) && !crate::env::ENABLE_ASAN {
        let handle = WINDOWS_SEGFAULT_HANDLE.swap(core::ptr::null_mut(), Ordering::Relaxed);
        if !handle.is_null() {
            unsafe extern "system" {
                fn RemoveVectoredExceptionHandler(handle: *mut c_void) -> u32;
            }
            // SAFETY: `handle` came from `AddVectoredExceptionHandler`.
            let _ = unsafe { RemoveVectoredExceptionHandler(handle) };
        }
    }

    // clear signal handler
    #[cfg(not(windows))]
    {
        // SAFETY: zeroed sigset + SIG_DFL handler is a valid Sigaction.
        unsafe {
            let mut sa: libc::sigaction = crate::ffi::zeroed();
            sa.sa_sigaction = libc::SIG_DFL;
            libc::sigemptyset(&raw mut sa.sa_mask);
            sa.sa_flags = libc::SA_RESETHAND;
            let _ = libc::sigaction(sig, &raw const sa, core::ptr::null_mut());
        }
    }

    // kill self
    // SAFETY: raise + abort are well-defined; abort is the noreturn fallback.
    unsafe {
        let _ = libc::raise(sig);
        libc::abort();
    }
}

#[derive(Default)]
pub struct AllocatorConfiguration {
    pub verbose: bool,
    pub long_running: bool,
}

#[inline]
pub fn mimalloc_cleanup(force: bool) {
    if USE_MIMALLOC {
        // SAFETY: mi_collect is safe to call at any time.
        unsafe { bun_alloc::mimalloc::mi_collect(force) };
    }
}
// Versions are now handled by build-generated header (bun_dependency_versions.h)

// Enabling huge pages slows down bun by 8x or so
// Keeping this code for:
// 1. documentation that an attempt was made
// 2. if I want to configure allocator later
#[inline]
pub fn configure_allocator(_: AllocatorConfiguration) {}

#[cold]
pub fn notimpl() -> ! {
    Output::panic(core::format_args!("Not implemented yet!!!!!"));
}

// Make sure we always print any leftover
#[cold]
pub fn crash() -> ! {
    exit(1);
}

// `BunInfo` (struct + `generate()`) lives at `bun_runtime::server::BunInfo`
// because it depends on analytics/js_parser/interchange — all higher-tier. Only the version constants below
// are needed at this tier.

pub const user_agent: &str = concatcp!("Bun/", package_json_version);

// TODO(port): `*const c_char` is `!Sync`; Phase B should wrap this in a
// `#[repr(transparent)]` Sync newtype or export via a `#[used]` static byte
// array. Kept as-is to mirror the Zig `export const`.
#[repr(transparent)]
pub struct SyncCStr(pub *const c_char);
// SAFETY: points into a `'static` string literal; the pointer is never mutated.
unsafe impl Sync for SyncCStr {}
#[unsafe(no_mangle)]
pub static Bun__userAgent: SyncCStr =
    SyncCStr(concatcp!(user_agent, "\0").as_ptr().cast::<c_char>());

#[unsafe(no_mangle)]
pub extern "C" fn Bun__onExit() {
    // `bun.jsc.Node.FSEvents.closeAndWait()` (spec `Global.zig:220`) — runs
    // BEFORE the generic exit-callback list, matching Zig ordering. fs_events
    // pushes into `PRE_EXIT_CALLBACKS` on first loop create.
    let pre: Vec<ExitFn> = core::mem::take(&mut *PRE_EXIT_CALLBACKS.lock());
    for callback in &pre {
        // SAFETY: callbacks are `unsafe extern "C" fn()`; called once at exit.
        unsafe { callback() };
    }
    run_exit_callbacks();
    Output::flush();
    core::hint::black_box(Bun__atexit as unsafe extern "C" fn(ExitFn));

    Output::source::stdio::restore();
}

// ported from: src/bun_core/Global.zig
