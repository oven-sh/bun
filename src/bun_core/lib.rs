#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

pub mod result;
pub mod tty;
pub mod util;
pub mod Global;

// ── B-1 gate ───────────────────────────────────────────────────────────────
// Heavy modules with many cross-refs; bodies preserved, compiled in B-2.
#[cfg(any())] pub mod feature_flags;
#[cfg(any())] pub mod Progress;
#[cfg(any())] pub mod deprecated;
#[cfg(any())] pub mod env;
#[cfg(any())] pub mod env_var;
#[cfg(any())] pub mod fmt;
#[cfg(any())] pub mod output;

// ── re-exports (the tier-0 surface downstream crates need) ────────────────
pub use bun_alloc::{out_of_memory, AllocError, Alignment, Allocator, page_size, ZigString};
pub use util::*;
pub use result::*;
pub use Global::*;

/// `bun_core::OOM` per PORTING.md type map (`OOM!T` → `Result<T, OOM>`).
pub type OOM = AllocError;

// ── stub macros (real impls in output.rs, gated above) ────────────────────
#[macro_export] macro_rules! declare_scope { ($($t:tt)*) => {}; }
#[macro_export] macro_rules! scoped_log { ($($t:tt)*) => {}; }
#[macro_export] macro_rules! pretty_fmt { ($fmt:literal, $colors:expr) => { $fmt }; }
#[macro_export] macro_rules! pretty { ($($t:tt)*) => {}; }
#[macro_export] macro_rules! prettyln { ($($t:tt)*) => {}; }
#[macro_export] macro_rules! pretty_error { ($($t:tt)*) => {}; }
#[macro_export] macro_rules! pretty_errorln { ($($t:tt)*) => {}; }
#[macro_export] macro_rules! err_generic { ($($t:tt)*) => {}; }
#[macro_export] macro_rules! warn { ($($t:tt)*) => {}; }
#[macro_export] macro_rules! note { ($($t:tt)*) => {}; }
// `err!(Name)` / `err!("Name")` — Phase-A drafts use both forms.
// Real impl: NonZeroU16 interning table populated at link time. B-1 stub
// returns a placeholder so type-checking passes; actual codes wired in B-2.
#[macro_export] macro_rules! err {
    ($name:ident) => { $crate::Error::TODO };
    ($name:literal) => { $crate::Error::TODO };
}
// `mark_binding!` and `zstr!` are defined in Global.rs / util.rs respectively.

// ── env stubs (real module gated above) ──
pub mod env {
    pub const version_string: &str = env!("CARGO_PKG_VERSION");
    pub const is_debug: bool = cfg!(debug_assertions);
    pub const is_release: bool = !cfg!(debug_assertions);
    pub const is_windows: bool = cfg!(windows);
    pub const is_posix: bool = !cfg!(windows);
    pub const is_mac: bool = cfg!(target_os = "macos");
    pub const is_linux: bool = cfg!(target_os = "linux");
    pub const is_ci: bool = false;
    pub const enable_asan: bool = false;
    pub const ENABLE_ASAN: bool = false;
    pub const allow_assert: bool = cfg!(debug_assertions);
    // Build-time stamps (real values come from build.rs in B-2)
    pub const IS_CANARY: bool = false;
    pub const CANARY_REVISION: u32 = 0;
    pub const GIT_SHA: &str = "0000000000000000000000000000000000000000";
    pub const GIT_SHA_SHORT: &str = "0000000";
    pub const BASELINE: bool = false;
    #[derive(Clone, Copy)]
    pub struct Os;
    impl Os {
        pub const fn name_string(self) -> &'static str {
            if cfg!(target_os = "macos") { "darwin" }
            else if cfg!(target_os = "linux") { "linux" }
            else if cfg!(windows) { "windows" }
            else { "unknown" }
        }
        pub const fn display_string(self) -> &'static str {
            if cfg!(target_os = "macos") { "macOS" }
            else if cfg!(target_os = "linux") { "Linux" }
            else if cfg!(windows) { "Windows" }
            else { "Unknown" }
        }
    }
    pub const OS: Os = Os;
}
pub use env as Environment;
#[inline] pub fn start_time() -> i128 { 0 } // TODO(port): wire to a global set at main()

/// Stub for `bun.Output` namespace (gated; real impl in output.rs).
pub mod output {
    pub fn flush() {}
    pub fn enable_buffering() {}
    pub fn disable_buffering() {}
    pub fn panic(_: &str, _: core::fmt::Arguments<'_>) -> ! { std::process::abort() }
    pub mod source { pub mod stdio { pub fn restore() {} } }
    pub struct Source;
    pub enum Destination { Stdout, Stderr }
}
pub use output as Output;

/// Minimal `bun.strings` subset (full SIMD impl in bun_str via highway FFI).
pub mod strings {
    #[inline] pub fn includes(h: &[u8], n: &[u8]) -> bool { ::bstr::ByteSlice::find(h, n).is_some() }
    #[inline] pub fn contains(h: &[u8], n: &[u8]) -> bool { includes(h, n) }
    #[inline] pub fn index_of_char(h: &[u8], c: u8) -> Option<usize> { h.iter().position(|&b| b == c) }
    #[inline] pub fn starts_with(h: &[u8], p: &[u8]) -> bool { h.starts_with(p) }
    #[inline] pub fn ends_with(h: &[u8], p: &[u8]) -> bool { h.ends_with(p) }
    #[inline] pub fn eql(a: &[u8], b: &[u8]) -> bool { a == b }
    #[inline] pub fn trim_right<'a>(s: &'a [u8], chars: &[u8]) -> &'a [u8] {
        let mut e = s.len();
        while e > 0 && chars.contains(&s[e - 1]) { e -= 1; }
        &s[..e]
    }
}

// bun_alloc stubs Global.rs expects (real consts deferred to B-2 ungate of bun_alloc::basic)
pub const USE_MIMALLOC: bool = true;
pub mod debug_allocator_data { #[inline] pub fn deinit_ok() -> bool { true } }

/// ASAN poison/unpoison stubs (real impl wraps __asan_* intrinsics).
/// Feature-flag stubs (real impl in env_var.rs / feature_flags.rs, gated).
pub mod feature_flags {
    pub const fn get(_: &str) -> bool { false }
    pub const fn enabled(_: &str) -> bool { false }
}
pub use feature_flags as feature_flag;
#[inline] pub fn linux_kernel_version() -> Version { Version { major: 0, minor: 0, patch: 0 } }

pub mod asan {
    #[inline] pub unsafe fn poison(_: *const u8, _: usize) {}
    #[inline] pub unsafe fn unpoison(_: *const u8, _: usize) {}
    #[inline] pub fn poison_slice<T>(_: &[T]) {}
    #[inline] pub fn unpoison_slice<T>(_: &[T]) {}
    pub const ENABLED: bool = false;
}
