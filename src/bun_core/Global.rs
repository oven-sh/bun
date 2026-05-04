#![allow(non_upper_case_globals, non_snake_case)]

use core::ffi::{c_char, c_int, c_void};
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use const_format::{concatcp, formatcp};

use crate::env; // @import("./env.zig")
use crate::env::version_string;
use crate::output as Output; // @import("./output.zig")

use bun_alloc::{self as alloc, USE_MIMALLOC};
use bun_str::ZStr;

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
// TODO(port): move to bun_sys::windows
unsafe extern "system" {
    fn SetThreadDescription(
        thread: bun_sys::windows::HANDLE,
        name: *const u16,
    ) -> bun_sys::windows::HRESULT;
}

pub fn set_thread_name(name: &ZStr) {
    #[cfg(target_os = "linux")]
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
            let _ = libc::pthread_setname_np(name.as_ptr() as *const c_char);
        }
    }
    #[cfg(target_os = "freebsd")]
    {
        // SAFETY: FreeBSD signature is (pthread_t, const char*).
        unsafe {
            libc::pthread_set_name_np(libc::pthread_self(), name.as_ptr() as *const c_char);
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

// PORT NOTE: Zig used an unsynchronized global `ArrayListUnmanaged`. We mirror
// that with `static mut` to preserve behavior; callers are expected to be
// single-threaded around exit. Phase B may want a `Mutex<Vec<_>>` if races
// surface.
static mut ON_EXIT_CALLBACKS: Vec<ExitFn> = Vec::new();

#[unsafe(no_mangle)]
pub extern "C" fn Bun__atexit(function: ExitFn) {
    // SAFETY: matches unsynchronized Zig global; see PORT NOTE above.
    unsafe {
        let cbs = &mut *core::ptr::addr_of_mut!(ON_EXIT_CALLBACKS);
        if !cbs.iter().any(|f| *f as usize == function as usize) {
            cbs.push(function);
        }
    }
}

pub fn add_exit_callback(function: ExitFn) {
    Bun__atexit(function);
}

pub fn run_exit_callbacks() {
    // SAFETY: matches unsynchronized Zig global; called once during process exit.
    unsafe {
        let cbs = &mut *core::ptr::addr_of_mut!(ON_EXIT_CALLBACKS);
        for callback in cbs.iter() {
            callback();
        }
        cbs.clear();
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
    bun_analytics::features::EXITED.fetch_add(1, Ordering::Relaxed);
    // TODO(port): verify `bun_analytics::features::EXITED: AtomicUsize` exists.

    // If we are crashing, allow the crash handler to finish it's work.
    bun_crash_handler::sleep_forever_if_another_thread_is_crashing();

    #[cfg(debug_assertions)]
    {
        // TODO(port): Zig asserts the debug allocator deinit() == .ok and nulls
        // the backing. Map to `bun_alloc::debug_allocator_data` once ported.
        debug_assert!(bun_alloc::debug_allocator_data::deinit_ok());
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
        unsafe { bun_sys::windows::kernel32::ExitProcess(code) }
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
        unsafe { bun_sys::c::quick_exit(code as i32) };
        // SAFETY: abort is noreturn; unreachable fallback if quick_exit returns.
        #[allow(unreachable_code)]
        unsafe {
            libc::abort()
        };
    }
}

pub fn raise_ignoring_panic_handler(sig: crate::SignalCode) -> ! {
    Output::flush();
    Output::source::stdio::restore();

    // clear segfault handler
    bun_crash_handler::reset_segfault_handler();

    // clear signal handler
    #[cfg(not(windows))]
    {
        // SAFETY: zeroed sigset + SIG_DFL handler is a valid Sigaction.
        unsafe {
            let mut sa: libc::sigaction = core::mem::zeroed();
            sa.sa_sigaction = libc::SIG_DFL;
            libc::sigemptyset(&mut sa.sa_mask);
            sa.sa_flags = libc::SA_RESETHAND;
            let _ = libc::sigaction(sig as c_int, &sa, core::ptr::null_mut());
        }
    }

    // kill self
    // SAFETY: raise + abort are well-defined; abort is the noreturn fallback.
    unsafe {
        let _ = libc::raise(sig as c_int);
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
    Output::panic("Not implemented yet!!!!!", core::format_args!(""));
    // TODO(port): Output.panic takes (fmt, args) in Zig; map to
    // `Output::panic(format_args!("Not implemented yet!!!!!"))`.
}

// Make sure we always print any leftover
#[cold]
pub fn crash() -> ! {
    exit(1);
}

pub struct BunInfo {
    pub bun_version: &'static [u8],
    pub platform: bun_analytics::generate_header::generate_platform::Platform,
}

impl BunInfo {
    pub fn generate<Bundler>(_: Bundler) -> Result<bun_js_parser::Expr, crate::Error> {
        // TODO(port): narrow error set
        let info = BunInfo {
            bun_version: package_json_version.as_bytes(),
            platform: bun_analytics::generate_header::generate_platform::for_os(),
        };

        // TODO(port): `bun.json.toAST(allocator, BunInfo, info)` relies on
        // comptime field reflection. Phase B: implement a `ToAst` trait and
        // derive it for `BunInfo`, or hand-write the two-field object.
        bun_json::to_ast(info)
    }
}

pub const user_agent: &str = concatcp!("Bun/", package_json_version);

// TODO(port): `*const c_char` is `!Sync`; Phase B should wrap this in a
// `#[repr(transparent)]` Sync newtype or export via a `#[used]` static byte
// array. Kept as-is to mirror the Zig `export const`.
#[unsafe(no_mangle)]
pub static Bun__userAgent: *const c_char =
    concatcp!(user_agent, "\0").as_ptr() as *const c_char;

#[unsafe(no_mangle)]
pub extern "C" fn Bun__onExit() {
    // TODO(port): `bun.jsc.Node.FSEvents.closeAndWait()` — bun_core must not
    // depend on bun_jsc (cycle). Phase B: register this via `add_exit_callback`
    // from the runtime crate instead of calling it directly here.
    bun_jsc::node::fs_events::close_and_wait();

    run_exit_callbacks();
    Output::flush();
    core::hint::black_box(Bun__atexit as unsafe extern "C" fn(ExitFn));

    Output::source::stdio::restore();
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_core/Global.zig (243 lines)
//   confidence: medium
//   todos:      9
//   notes:      const-string version block leans on const_format + env consts; bun_jsc call in Bun__onExit is a crate-cycle hazard; static mut + !Sync export need Phase B attention
// ──────────────────────────────────────────────────────────────────────────
