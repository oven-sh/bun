#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

pub mod result;
pub mod tty;
pub mod util;
pub mod Global;

pub mod env;
pub mod feature_flags;
pub mod env_var;
pub mod deprecated;
// ── B-2 gate ── remaining heavy modules ────────────────────────────────────
// TODO(b2-large): Progress (750L, depends on output::File vtable + tty ioctl);
// fmt (2728L, 22 errors — depends on js_lexer/js_printer subset modules,
// bun_simdutf base64/utf32, and ~7 strings:: SIMD scanners). Both need their
// in-file `strings`/`js_*` move-in stubs completed before un-gating.
#[cfg(any())] pub mod Progress;
#[cfg(any())] pub mod fmt;
/// Placeholder so `crate::fmt::*` paths resolve until the real module un-gates.
pub mod fmt_stub {
    pub struct QuotedFormatter<'a>(pub &'a [u8]);
}
#[path = "output.rs"]
pub mod output;

/// Stand-in for Zig's `@import("build_options")`. Real values are emitted by
/// `build.rs` via `env!()` in Phase C (link). Placeholder values let env.rs
/// const-evaluate cleanly.
pub mod build_options {
    pub const RELEASE_SAFE: bool = false;
    pub const OVERRIDE_NO_EXPORT_CPP_APIS: bool = false;
    pub const OUTPUT_MODE_OBJ: bool = true;
    pub const ZIG_SELF_HOSTED_BACKEND: bool = false;
    pub const REPORTED_NODEJS_VERSION: &str = "24.0.0";
    pub const BASELINE: bool = false;
    pub const SHA: &str = "0000000000000000000000000000000000000000";
    pub const IS_CANARY: bool = false;
    pub const CANARY_REVISION: &str = "0";
    pub const BASE_PATH: &[u8] = b"";
    pub const ENABLE_LOGS: bool = cfg!(debug_assertions);
    pub const ENABLE_ASAN: bool = false;
    pub const ENABLE_FUZZILLI: bool = false;
    pub const ENABLE_TINYCC: bool = true;
    pub const CODEGEN_PATH: &[u8] = b"";
    pub const CODEGEN_EMBED: bool = true;
    pub const VERSION: crate::Version = crate::Version { major: 1, minor: 3, patch: 0 };
}

// ── re-exports (the tier-0 surface downstream crates need) ────────────────
pub use bun_alloc::{out_of_memory, AllocError, Alignment, Allocator, page_size, ZigString};
pub use util::*;
pub use result::*;
pub use Global::*;
pub use tty::Winsize;

/// `bun_core::OOM` per PORTING.md type map (`OOM!T` → `Result<T, OOM>`).
pub type OOM = AllocError;

// Real `declare_scope!`/`scoped_log!`/`pretty*!`/`warn!`/`note!` are
// `#[macro_export]`ed from output.rs.
// `err!(Name)` / `err!("Name")` — Phase-A drafts use both forms.
// Real impl: NonZeroU16 interning table populated at link time. B-1 stub
// returns a placeholder so type-checking passes; actual codes wired in B-2.
#[macro_export] macro_rules! err {
    ($name:ident) => { $crate::Error::TODO };
    ($name:literal) => { $crate::Error::TODO };
}
// `mark_binding!` and `zstr!` are defined in Global.rs / util.rs respectively.

pub use env as Environment;
#[inline] pub fn start_time() -> i128 { 0 } // TODO(port): wire to a global set at main()

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
    /// Allocating replace-all (cold debug-log path). Not the SIMD `bun.strings`
    /// version — that lives in `bun_str`.
    pub fn replace_owned(haystack: &[u8], needle: &[u8], replacement: &[u8]) -> Vec<u8> {
        if needle.is_empty() {
            return haystack.to_vec();
        }
        let mut out = Vec::with_capacity(haystack.len());
        let mut i = 0;
        while let Some(pos) = ::bstr::ByteSlice::find(&haystack[i..], needle) {
            out.extend_from_slice(&haystack[i..i + pos]);
            out.extend_from_slice(replacement);
            i += pos + needle.len();
        }
        out.extend_from_slice(&haystack[i..]);
        out
    }
    #[inline]
    pub fn eql_case_insensitive_ascii(a: &[u8], b: &[u8], check_len: bool) -> bool {
        if check_len && a.len() != b.len() { return false; }
        a.iter().zip(b).all(|(x, y)| x.eq_ignore_ascii_case(y))
    }
}

// bun_alloc stubs Global.rs expects (real consts deferred to B-2 ungate of bun_alloc::basic)
pub const USE_MIMALLOC: bool = true;
pub mod debug_allocator_data { #[inline] pub fn deinit_ok() -> bool { true } }

/// `bun.feature_flag.*` runtime env-var getters (real impl in env_var.rs, still gated).
/// feature_flags.rs (compile-time consts) is now real; this stub provides the
/// `.get()` accessor surface that env_var.rs will replace.
pub mod feature_flag {
    macro_rules! flag { ($($name:ident),* $(,)?) => { $(
        #[allow(non_camel_case_types)] pub struct $name;
        impl $name { #[inline] pub fn get(&self) -> bool { false } }
    )* } }
    flag!(BUN_FEATURE_FLAG_NO_LIBDEFLATE, BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE);
}
#[inline] pub fn linux_kernel_version() -> Version { Version { major: 0, minor: 0, patch: 0 } }

pub mod asan {
    #[inline] pub unsafe fn poison(_: *const u8, _: usize) {}
    #[inline] pub unsafe fn unpoison(_: *const u8, _: usize) {}
    #[inline] pub fn poison_slice<T>(_: &[T]) {}
    #[inline] pub fn unpoison_slice<T>(_: &[T]) {}
    pub const ENABLED: bool = false;
}
