#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use, unreachable_pub)]
// AUTOGEN: mod declarations only — real exports added in B-1.

pub mod result;
pub mod tty;
pub mod util;
pub mod Global;
pub mod heap;

pub mod env;
pub mod wtf;
#[cfg(windows)]
pub mod windows_sys;

/// Port of Zig's `std.os.environ` global (`[][*:0]u8`). On Windows the
/// startup path `bun_sys::windows::env::convert_env_to_wtf8` overwrites this
/// with a WTF-8-encoded envp slice; `getenvZ` and `bun_main` then read it via
/// `os_environ_ptr()`. POSIX builds leave it empty and use libc's `environ`.
#[cfg(windows)]
pub mod os {
    use core::ffi::c_char;

    // Stored as raw (ptr, len) — NOT `&'static mut [_]` — so `environ()` (which
    // hands out a shared `&[_]`) never aliases a live `&mut`. Zig's
    // `std.os.environ` is a plain slice global with no exclusivity guarantee;
    // mirroring that with `&'static mut` would be UB the moment a reader
    // borrows while a writer holds the swapped-out `&mut`.
    static mut ENVIRON: (*mut *mut c_char, usize) = (core::ptr::null_mut(), 0);

    /// Swap in a new envp slice; returns the previous (ptr, len) pair (Zig:
    /// `orig_environ = std.os.environ; std.os.environ = new`).
    /// SAFETY: single-threaded startup only.
    pub unsafe fn take_environ() -> (*mut *mut c_char, usize) {
        // `&raw mut` (no intermediate `&mut`) — `static_mut_refs` is hard-denied
        // under rust_2024_compatibility, and we never need a borrow here.
        unsafe { core::ptr::replace(&raw mut ENVIRON, (core::ptr::null_mut(), 0)) }
    }
    /// SAFETY: single-threaded startup only; `ptr` must be valid for `len`
    /// elements for the process lifetime (leaked allocation).
    pub unsafe fn set_environ(ptr: *mut *mut c_char, len: usize) {
        unsafe { core::ptr::write(&raw mut ENVIRON, (ptr, len)); }
    }
    /// Borrowed view of the current envp slice (read side of `std.os.environ`).
    /// SAFETY: caller must not race with `set_environ`.
    pub unsafe fn environ() -> &'static [*mut c_char] {
        unsafe {
            let (p, n) = core::ptr::read(&raw const ENVIRON);
            if p.is_null() { &[] } else { core::slice::from_raw_parts(p, n) }
        }
    }
}

/// `bun.os_environ_ptr()` — pointer to the first element of `std.os.environ`
/// (or null if empty). Windows-only; POSIX uses libc's `environ` symbol.
#[cfg(windows)]
#[inline]
pub fn os_environ_ptr() -> *const *mut core::ffi::c_char {
    // SAFETY: read of a process-global written once at startup.
    let e = unsafe { os::environ() };
    if e.is_empty() { core::ptr::null() } else { e.as_ptr() }
}
pub mod feature_flags;
pub mod env_var;
pub mod deprecated;
// ── B-2 gate ── remaining heavy modules ────────────────────────────────────
#[path = "Progress.rs"] pub mod Progress;
pub mod fmt;
#[path = "output.rs"]
pub mod output;

/// Compile-time `<tag>` → ANSI rewrite (proc-macro). Re-exported at crate root
/// so `$crate::pretty_fmt!` resolves from the wrapper macros in `output.rs`.
pub use bun_core_macros::pretty_fmt;

/// Stand-in for Zig's `@import("build_options")`. Real values are emitted by
/// `build.rs` via `env!()` in Phase C (link). Placeholder values let env.rs
/// const-evaluate cleanly.
pub mod build_options {
    /// `option_env!` with a fallback literal — same shape as Zig's
    /// `b.option(...) orelse default` in build.zig.
    macro_rules! build_opt {
        ($name:literal, $default:expr) => {
            match option_env!($name) {
                Some(v) => v,
                None => $default,
            }
        };
    }
    macro_rules! build_opt_bool {
        ($name:literal, $default:expr) => {
            match option_env!($name) {
                Some(v) => matches!(v.as_bytes(), b"true" | b"1"),
                None => $default,
            }
        };
    }

    /// `true` for the `release-assertions` profile (Zig: ReleaseSafe).
    pub const RELEASE_SAFE: bool = build_opt_bool!("BUN_RELEASE_SAFE", false);
    pub const REPORTED_NODEJS_VERSION: &str = build_opt!("BUN_REPORTED_NODEJS_VERSION", "24.0.0");
    pub const BASELINE: bool = build_opt_bool!("BUN_BASELINE", false);
    pub const SHA: &str = build_opt!("BUN_GIT_SHA", "0000000000000000000000000000000000000000");
    pub const IS_CANARY: bool = build_opt_bool!("BUN_IS_CANARY", false);
    pub const CANARY_REVISION: &str = build_opt!("BUN_CANARY_REVISION", "0");
    /// Repo root. Zig's build.zig passes `b.pathFromRoot(".")`; here we derive
    /// it from this crate's manifest dir (`<repo>/src/bun_core`) so debug
    /// `runtime_embed_file!` can find on-disk sources without an extra env var.
    pub const BASE_PATH: &[u8] = match option_env!("BUN_BASE_PATH") {
        Some(v) => v.as_bytes(),
        None => concat!(env!("CARGO_MANIFEST_DIR"), "/../..").as_bytes(),
    };
    pub const ENABLE_LOGS: bool = cfg!(debug_assertions);
    pub const ENABLE_ASAN: bool = cfg!(bun_asan);
    pub const ENABLE_FUZZILLI: bool = false;
    /// Whether `libtcc.a` is built and linked. Mirrors `cfg.tinycc` in
    /// `scripts/build/config.ts`: TinyCC is disabled on Windows/aarch64
    /// (TinyCC has no aarch64-pe-coff backend), Android, and FreeBSD (the
    /// vendored fork doesn't support those targets and the dep is skipped).
    /// Has to be a *compile-time* `false` on those targets — `ffi_body.rs`
    /// gates its `bun_tcc_sys::*` calls behind `if !ENABLE_TINYCC { return }`,
    /// and rustc only DCEs the `tcc_*` extern refs when the const folds; a
    /// runtime check would still leave undefined symbols at link.
    pub const ENABLE_TINYCC: bool = !cfg!(any(
        all(windows, target_arch = "aarch64"),
        target_os = "android",
        target_os = "freebsd",
    ));
    /// `<build>/codegen`. `scripts/build/rust.ts` exports `BUN_CODEGEN_DIR` to
    /// every crate's rustc env; fall back to the default debug profile path.
    pub const CODEGEN_PATH: &[u8] = match option_env!("BUN_CODEGEN_DIR") {
        Some(v) => v.as_bytes(),
        None => concat!(env!("CARGO_MANIFEST_DIR"), "/../../build/debug/codegen").as_bytes(),
    };
    pub const CODEGEN_EMBED: bool = true;
    /// `cfg.version` from package.json, split by `scripts/build/rust.ts`.
    pub const VERSION: crate::Version = {
        // const-parse a "u32" string — `str::parse` isn't const.
        const fn p(s: &str) -> u32 {
            let b = s.as_bytes();
            let mut i = 0;
            let mut n: u32 = 0;
            while i < b.len() {
                n = n * 10 + (b[i] - b'0') as u32;
                i += 1;
            }
            n
        }
        crate::Version {
            major: p(build_opt!("BUN_VERSION_MAJOR", "1")),
            minor: p(build_opt!("BUN_VERSION_MINOR", "3")),
            patch: p(build_opt!("BUN_VERSION_PATCH", "0")),
        }
    };
    /// Zig: `build_options.fallback_html_version` — hex-string hash of the
    /// fallback HTML bundle, injected by the build system. Placeholder until
    /// Phase C wires the real value via `env!()` in `build.rs`.
    pub const FALLBACK_HTML_VERSION: &str = match option_env!("BUN_FALLBACK_HTML_VERSION") {
        Some(v) => v,
        None => "0000000000000000",
    };
}

// ── re-exports (the tier-0 surface downstream crates need) ────────────────
pub use bun_alloc::{
    is_slice_in_buffer, is_slice_in_buffer_t, out_of_memory, range_of_slice_in_buffer, AllocError,
    Alignment, Allocator, page_size, ZigString,
};
pub use util::*;
pub use result::*;
pub use Global::*;
pub use tty::Winsize;

// ── intrusive-container parent recovery ───────────────────────────────────
//
// Port of Zig's parent-from-field intrinsic. Intrusive data structures (task
// queues, timer heaps, linked lists) hand callbacks a `*mut Field` and expect
// the callee to walk back to the owning `*mut Parent`. Phase-A open-coded this
// at ~150 sites as `ptr.cast::<u8>().sub(offset_of!(P, f)).cast::<P>()`; the
// helpers below are the single canonical spelling. Re-exported from `bun_ptr`.

/// Recover `*mut P` from a pointer to one of its fields.
///
/// Accepts `*const F` so both `*mut` and `*const` field pointers coerce in;
/// returns `*mut P` (which itself coerces to `*const P` at the binding site)
/// so callers pick mutability at the use, not here.
///
/// Prefer the [`from_field_ptr!`] macro, which computes `offset` via
/// `core::mem::offset_of!` so the field name is type-checked.
///
/// # Safety
/// - `field` must have been derived from a live `P` via
///   `addr_of!((*p).field)` / `addr_of_mut!` (or equivalent), so its
///   provenance covers the entire `P` allocation — a `&mut field` reborrow
///   does **not** suffice.
/// - `offset` must equal `offset_of!(P, <that field>)`.
#[inline(always)]
pub const unsafe fn container_of<P, F>(field: *const F, offset: usize) -> *mut P {
    // SAFETY: per fn contract — `field` is interior to a `P`; `byte_sub`
    // preserves provenance and yields the allocation base.
    unsafe { field.byte_sub(offset).cast::<P>().cast_mut() }
}

/// `*const`-out variant of [`container_of`]. Same safety contract.
#[inline(always)]
pub const unsafe fn container_of_const<P, F>(field: *const F, offset: usize) -> *const P {
    // SAFETY: per fn contract.
    unsafe { field.byte_sub(offset).cast::<P>() }
}

/// `from_field_ptr!(Parent, field, ptr)` → `*mut Parent`.
///
/// Type-checked wrapper over [`container_of`]: expands to
/// `container_of::<Parent, _>(ptr, offset_of!(Parent, field))`. The call is
/// `unsafe` (caller asserts `ptr` points at `Parent.field` with whole-`Parent`
/// provenance) and must appear inside an `unsafe` block.
#[macro_export]
macro_rules! from_field_ptr {
    ($Parent:ty, $field:ident, $ptr:expr $(,)?) => {
        $crate::container_of::<$Parent, _>(
            $ptr,
            ::core::mem::offset_of!($Parent, $field),
        )
    };
}

/// `bun_core::OOM` per PORTING.md type map (`OOM!T` → `Result<T, OOM>`).
pub type OOM = AllocError;

/// Zig `bun.concat(u8, buf, &.{ a, b, ... })` — write `parts` consecutively
/// into `buf` and return the prefix slice. Panics on overflow (matches Zig
/// `@memcpy` length assert).
#[inline]
pub fn concat<'b>(buf: &'b mut [u8], parts: &[&[u8]]) -> &'b [u8] {
    let mut off = 0;
    for p in parts {
        buf[off..off + p.len()].copy_from_slice(p);
        off += p.len();
    }
    &buf[..off]
}

/// Zig `bun.assertf(cond, fmt, args)` — debug-only formatted assert.
#[macro_export]
macro_rules! assertf {
    ($cond:expr, $($arg:tt)*) => { ::core::debug_assert!($cond, $($arg)*) };
}

/// Zig: `bun.handleOom(expr)` — unwrap a `Result`, calling `outOfMemory()` on
/// `Err`. The full multi-arm version (which narrows mixed error sets) lives in
/// `bun_crash_handler::handle_oom`; that crate sits *above* `bun_core` in the
/// dep graph, so this tier-0 alias is the OOM-only arm — sufficient for the
/// `Result<T, AllocError>` / `Result<T, Error>` callers in `js_parser`,
/// `bake/DevServer`, etc. that spell it `bun_core::handle_oom`.
#[inline]
#[track_caller]
pub fn handle_oom<T, E>(r: core::result::Result<T, E>) -> T {
    match r {
        Ok(v) => v,
        Err(_) => out_of_memory(),
    }
}

/// Zig: `bun.handleErrorReturnTrace(err, @errorReturnTrace())` — captures the
/// Zig error-return trace for crash reporting. Rust has no `@errorReturnTrace()`
/// builtin (panics already carry a backtrace), so this tier-0 shim is a no-op
/// that keeps call-site shape; the real reporter lives above in
/// `bun_crash_handler::handle_error_return_trace`.
#[inline(always)]
pub fn handle_error_return_trace<E>(_err: E) {
}

// Real `declare_scope!`/`scoped_log!`/`pretty*!`/`warn!`/`note!` are
// `#[macro_export]`ed from output.rs.

/// Zig: `bun.todoPanic(@src(), fmt, args)`. Intentional *runtime* "feature not
/// yet implemented" path that the Zig source ships with — distinct from a
/// porting placeholder. Captures file/line via `file!()`/`line!()` (the
/// `@src()` equivalent) and routes through `Output::panic`.
// TODO(port): wire `bun_analytics::Features::todo_panic` once the analytics
// crate is reachable from bun_core without a dep cycle.
#[macro_export] macro_rules! todo_panic {
    ($($arg:tt)*) => {{
        $crate::output::panic(::core::format_args!(
            "TODO: {} ({}:{})",
            ::core::format_args!($($arg)*),
            ::core::file!(),
            ::core::line!(),
        ))
    }};
}

// `err!(Name)` / `err!("Name")` — Zig `error.Name` literal.
//
// Expands to a per-site `OnceLock<Error>` that interns the stringified name
// on first hit, then hands back the cached `NonZeroU16` forever after. Two
// `err!(Foo)` at different sites resolve to the *same* code (the table is
// process-global), so `e == err!(Foo)` is a plain u16 compare — the property
// h2 `error_code_for`, install retry loops, etc. were blocked on.
#[macro_export] macro_rules! err {
    ($name:ident) => {{
        static __E: ::std::sync::OnceLock<$crate::Error> = ::std::sync::OnceLock::new();
        *__E.get_or_init(|| $crate::Error::intern(::core::stringify!($name)))
    }};
    ($name:literal) => {{
        static __E: ::std::sync::OnceLock<$crate::Error> = ::std::sync::OnceLock::new();
        *__E.get_or_init(|| $crate::Error::intern($name))
    }};
    // `err!(from e)` — convert a strum::IntoStaticStr enum error to bun_core::Error.
    (from $e:expr) => { $crate::Error::intern(<&'static str>::from(&$e)) };
}
// `mark_binding!` and `zstr!` are defined in Global.rs / util.rs respectively.

pub use env as Environment;
/// Zig: `pub const FeatureFlags = @import("./bun_core/feature_flags.zig")`.
pub use feature_flags as FeatureFlags;
/// Process start time in nanoseconds. Written once during single-threaded
/// startup (`main`/`Cli::start`) and read freely thereafter. `i128` has no
/// atomic; `RacyCell` is sound because the write happens before any thread
/// spawn.
static START_TIME: util::RacyCell<i128> = util::RacyCell::new(0);
#[inline]
pub fn start_time() -> i128 {
    // SAFETY: written once during single-threaded startup.
    unsafe { START_TIME.read() }
}
#[inline]
pub fn set_start_time(ns: i128) {
    // SAFETY: called once from `main` before any thread spawn.
    unsafe { START_TIME.write(ns) }
}

/// `bun.Timer` / `std.time.Timer` — minimal monotonic stopwatch. Mirrors Zig's
/// `std.time.Timer.{start,read}` so callers ported verbatim (e.g.
/// `Lockfile::clean_with_logger`, `LifecycleScriptSubprocess`) compile against
/// the tier-0 surface without pulling in `bun_perf`.
pub mod time {
    pub const NS_PER_MS: u64 = 1_000_000;

    // `std.time.{nanoTimestamp,milliTimestamp,timestamp}` — full impls live in
    // `util::time`; re-export here so `bun_core::time::*` resolves uniformly.
    pub use crate::util::time::{
        nano_timestamp, milli_timestamp, timestamp, MS_PER_DAY, MS_PER_S, NS_PER_S, NS_PER_US,
        S_PER_DAY, US_PER_MS, US_PER_S,
    };

    #[derive(Clone, Copy)]
    pub struct Timer { started: std::time::Instant }
    impl Timer {
        #[inline]
        pub fn start() -> core::result::Result<Self, crate::Error> {
            Ok(Self { started: std::time::Instant::now() })
        }
        #[inline]
        pub fn read(&self) -> u64 {
            self.started.elapsed().as_nanos() as u64
        }
    }
}

/// `bun.schema` — `src/options_types/schema.zig`. The full generated API
/// types live in `bun_api` (tier-2); tier-0 only needs the namespace to
/// exist so `bun_core::schema::api::StringPointer` etc. resolve as re-exports
/// once that crate un-gates. For now expose the one type tier-0 itself owns.
pub mod schema {
    pub mod api {
        pub use crate::util::StringPointer;
        // Remaining schema types re-exported from bun_api in Phase B-2.
    }
}

pub use output as Output;

// `crate::js_lexer` / `crate::js_printer` resolve to fmt.rs's local subsets.
pub use fmt::{js_lexer, js_printer};

/// Minimal `bun.strings` subset (full SIMD impl in bun_str via highway FFI).
pub mod strings {
    pub use crate::fmt::strings::*; // pulls in fmt.rs's larger subset
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
    /// Zig: `strings.containsCaseInsensitiveASCII` — naive O(n·m) windowed
    /// case-insensitive ASCII substring search (matches the Zig scalar impl;
    /// callers are cold path-lookup on macOS/Windows where the FS is
    /// case-insensitive).
    #[inline]
    pub fn contains_case_insensitive_ascii(haystack: &[u8], needle: &[u8]) -> bool {
        if needle.len() > haystack.len() { return false; }
        let mut start = 0usize;
        while start + needle.len() <= haystack.len() {
            if eql_case_insensitive_ascii(&haystack[start..start + needle.len()], needle, false) {
                return true;
            }
            start += 1;
        }
        false
    }
    /// `bun.strings.isWindowsAbsolutePathMissingDriveLetter` (immutable/paths.zig)
    /// — true for `\foo`-style absolute paths that lack a `C:` / `\\?\` /
    /// `\\server\` prefix and therefore need the cwd's drive prepended.
    /// Generic over `u8`/`u16` to mirror the Zig comptime `T: type` param.
    pub fn is_windows_absolute_path_missing_drive_letter<T>(chars: &[T]) -> bool
    where T: Copy + PartialEq + From<u8> {
        // Zig asserts non-empty + windows-absolute; release-mode callers may
        // still pass `""`, so bail instead of indexing OOB.
        debug_assert!(!chars.is_empty());
        if chars.is_empty() { return false; }
        let sep = |c: T| c == T::from(b'/') || c == T::from(b'\\');

        // 'C:\hello' -> false — most common case, check first.
        if !sep(chars[0]) {
            debug_assert!(chars.len() > 2);
            debug_assert!(chars[1] == T::from(b':'));
            return false;
        }

        if chars.len() > 4 {
            // '\??\hello' -> false (NT object prefix)
            if chars[1] == T::from(b'?')
                && chars[2] == T::from(b'?')
                && sep(chars[3])
            {
                return false;
            }
            // '\\?\hello' -> false (other NT object prefix)
            // '\\.\hello' -> false (NT device prefix)
            if sep(chars[1])
                && (chars[2] == T::from(b'?') || chars[2] == T::from(b'.'))
                && sep(chars[3])
            {
                return false;
            }
        }

        // Zig: `bun.path.windowsFilesystemRootT(T, chars).len == 1`. With
        // `chars[0]` already known to be a separator, that fn returns len > 1
        // only via its UNC/device branch (`len >= 5 && sep[0] && sep[1] &&
        // !sep[2]`); every other separator-led path resolves to a single-char
        // root. Inlined here because `bun_paths` would be a tier-0 cycle.
        //
        // '\\Server\Share'  -> false (UNC)
        // '\\Server\\Share' -> true  (extra separator — not UNC)
        // '\Server\Share'   -> true  (posix-style)
        !(chars.len() >= 5 && sep(chars[1]) && !sep(chars[2]))
    }
    /// `strings.eqlComptimeIgnoreLen` — caller has already checked `a.len() ==
    /// b.len()` (the "ignore len" means "don't re-check"). PERF(port): the Zig
    /// version generates length-specialized SWAR loads at comptime; this scalar
    /// fallback is fine for the only T0/T1 caller (ComptimeStringMap, where
    /// `b` is a small static).
    #[inline]
    pub fn eql_comptime_ignore_len(a: &[u8], b: &'static [u8]) -> bool {
        debug_assert_eq!(a.len(), b.len());
        a == b
    }

    // ──────────────────────────────────────────────────────────────────────
    // Transcoding (from src/string/immutable/unicode.zig). Lives in T0 so
    // collections::Vec<u8> can call it without depending on bun_string.
    // Allocator params dropped per PORTING.md §Allocators.
    // ──────────────────────────────────────────────────────────────────────
    use bun_simdutf_sys::simdutf;

    #[inline]
    pub fn is_all_ascii(slice: &[u8]) -> bool {
        // SAFETY: FFI reads exactly slice.len() bytes.
        unsafe { simdutf::simdutf__validate_ascii(slice.as_ptr(), slice.len()) }
    }

    /// Index of first non-ASCII byte, or None if all-ASCII. simdutf-backed.
    #[inline]
    pub fn first_non_ascii(slice: &[u8]) -> Option<usize> {
        // SAFETY: FFI reads exactly slice.len() bytes.
        let r = unsafe { simdutf::simdutf__validate_ascii_with_errors(slice.as_ptr(), slice.len()) };
        if r.status == simdutf::Status::SUCCESS { None } else { Some(r.count) }
    }

    /// Encode a code point as WTF-8 (UTF-8 that permits unpaired surrogates).
    /// Returns bytes written (1..=4). Port of `encodeWTF8Rune`.
    #[inline]
    pub fn encode_wtf8_rune(out: &mut [u8; 4], cp: u32) -> usize {
        if cp < 0x80 {
            out[0] = cp as u8;
            1
        } else if cp < 0x800 {
            out[0] = 0xC0 | (cp >> 6) as u8;
            out[1] = 0x80 | (cp & 0x3F) as u8;
            2
        } else if cp < 0x10000 {
            out[0] = 0xE0 | (cp >> 12) as u8;
            out[1] = 0x80 | ((cp >> 6) & 0x3F) as u8;
            out[2] = 0x80 | (cp & 0x3F) as u8;
            3
        } else {
            out[0] = 0xF0 | (cp >> 18) as u8;
            out[1] = 0x80 | ((cp >> 12) & 0x3F) as u8;
            out[2] = 0x80 | ((cp >> 6) & 0x3F) as u8;
            out[3] = 0x80 | (cp & 0x3F) as u8;
            4
        }
    }

    #[inline]
    pub fn latin1_to_codepoint_bytes_assume_not_ascii(c: u8) -> [u8; 2] {
        debug_assert!(c >= 0x80);
        let cp = c as u32;
        [0xC0 | (cp >> 6) as u8, 0x80 | (cp & 0x3F) as u8]
    }

    /// Port of `allocateLatin1IntoUTF8WithList`.
    /// PERF(port): Zig hand-rolls a SWAR/@Vector ASCII-span scanner; here we use
    /// `first_non_ascii` (simdutf SIMD) for the span scan — equivalent throughput.
    pub fn allocate_latin1_into_utf8_with_list(
        mut list: Vec<u8>,
        offset_into_list: usize,
        latin1: &[u8],
    ) -> Vec<u8> {
        list.truncate(offset_into_list);
        list.reserve(latin1.len());
        let mut rest = latin1;
        while !rest.is_empty() {
            match first_non_ascii(rest) {
                None => {
                    list.extend_from_slice(rest);
                    break;
                }
                Some(i) => {
                    list.extend_from_slice(&rest[..i]);
                    rest = &rest[i..];
                    while let Some(&c) = rest.first() {
                        if c < 0x80 { break; }
                        list.reserve(2);
                        let [a, b] = latin1_to_codepoint_bytes_assume_not_ascii(c);
                        list.push(a);
                        list.push(b);
                        rest = &rest[1..];
                    }
                }
            }
        }
        list
    }

    /// Port of `toUTF8FromLatin1` — None if input is already ASCII.
    pub fn to_utf8_from_latin1(latin1: &[u8]) -> Option<Vec<u8>> {
        if is_all_ascii(latin1) {
            return None;
        }
        Some(allocate_latin1_into_utf8_with_list(Vec::with_capacity(latin1.len()), 0, latin1))
    }

    /// Slow-path fallback for unpaired surrogates (port of `toUTF8ListWithTypeBun` core loop).
    /// Unpaired surrogates are replaced with U+FFFD, matching `utf16CodepointWithFFFDAndFirstInputChar`.
    fn append_wtf8_from_utf16(list: &mut Vec<u8>, utf16: &[u16]) {
        let mut i = 0usize;
        let mut buf = [0u8; 4];
        while i < utf16.len() {
            let unit = utf16[i] as u32;
            let cp;
            if (0xD800..=0xDBFF).contains(&unit) {
                if i + 1 < utf16.len() {
                    let lo = utf16[i + 1] as u32;
                    if (0xDC00..=0xDFFF).contains(&lo) {
                        cp = 0x10000 + ((unit - 0xD800) << 10) + (lo - 0xDC00);
                        i += 2;
                    } else { cp = 0xFFFD; i += 1; }
                } else { cp = 0xFFFD; i += 1; }
            } else if (0xDC00..=0xDFFF).contains(&unit) {
                cp = 0xFFFD;
                i += 1;
            } else { cp = unit; i += 1; }
            let n = encode_wtf8_rune(&mut buf, cp);
            list.extend_from_slice(&buf[..n]);
        }
    }

    /// Port of `convertUTF16ToUTF8Append`. Caller must reserve
    /// `simdutf::length::utf8::from::utf16::le(utf16)` spare bytes for the fast path.
    pub fn convert_utf16_to_utf8_append(list: &mut Vec<u8>, utf16: &[u16]) {
        let spare = list.spare_capacity_mut();
        // SAFETY: simdutf writes only initialized bytes; we set_len by reported count.
        let r = unsafe {
            simdutf::simdutf__convert_utf16le_to_utf8_with_errors(
                utf16.as_ptr(),
                utf16.len(),
                spare.as_mut_ptr().cast::<u8>(),
            )
        };
        if r.status == simdutf::Status::SURROGATE {
            append_wtf8_from_utf16(list, utf16);
            return;
        }
        // SAFETY: simdutf wrote `r.count` bytes into spare capacity.
        unsafe { list.set_len(list.len() + r.count) };
    }

    pub fn convert_utf16_to_utf8(mut list: Vec<u8>, utf16: &[u16]) -> Vec<u8> {
        let need = simdutf::length::utf8::from::utf16::le(utf16);
        list.reserve(need + 16);
        convert_utf16_to_utf8_append(&mut list, utf16);
        list
    }

    #[inline]
    pub fn to_utf8_alloc(utf16: &[u16]) -> Vec<u8> {
        convert_utf16_to_utf8(Vec::new(), utf16)
    }

    pub fn to_utf8_append_to_list(list: &mut Vec<u8>, utf16: &[u16]) {
        let need = simdutf::length::utf8::from::utf16::le(utf16);
        list.reserve(need + 16);
        convert_utf16_to_utf8_append(list, utf16);
    }

    /// Result of an encode-into-fixed-buffer operation. Port of `EncodeIntoResult`.
    #[derive(Clone, Copy, Default, Debug)]
    pub struct EncodeIntoResult {
        pub read: u32,
        pub written: u32,
    }

    /// Port of `elementLengthUTF16IntoUTF8` — exact UTF-8 byte length of a UTF-16
    /// (LE) input. simdutf-backed; falls back to scalar would be in unicode_draft.
    #[inline]
    pub fn element_length_utf16_into_utf8(utf16: &[u16]) -> usize {
        simdutf::length::utf8::from::utf16::le(utf16)
    }

    /// Port of `elementLengthLatin1IntoUTF8`.
    pub fn element_length_latin1_into_utf8(latin1: &[u8]) -> usize {
        let mut len = latin1.len();
        let mut rest = latin1;
        while let Some(i) = first_non_ascii(rest) {
            rest = &rest[i..];
            while let Some(&c) = rest.first() {
                if c < 0x80 { break; }
                len += 1; // each high-latin1 byte → 2 utf8 bytes
                rest = &rest[1..];
            }
        }
        len
    }

    /// Port of `copyUTF16IntoUTF8` — encode UTF-16 into a fixed-size UTF-8 buffer.
    /// Unpaired surrogates are replaced with U+FFFD (matches `utf16CodepointWithFFFD`).
    /// Returns units read / bytes written. Caller is responsible for sizing `buf`.
    pub fn copy_utf16_into_utf8(buf: &mut [u8], utf16: &[u16]) -> EncodeIntoResult {
        if utf16.is_empty() || buf.is_empty() {
            return EncodeIntoResult::default();
        }
        // Fast path: if buf can definitely hold the whole conversion, try simdutf.
        let need = simdutf::length::utf8::from::utf16::le(utf16);
        if need > 0 && need <= buf.len() {
            // SAFETY: buf has `need` writable bytes; simdutf reads exactly utf16.len() u16.
            let r = unsafe {
                simdutf::simdutf__convert_utf16le_to_utf8_with_errors(
                    utf16.as_ptr(),
                    utf16.len(),
                    buf.as_mut_ptr(),
                )
            };
            if r.status == simdutf::Status::SUCCESS {
                return EncodeIntoResult { read: utf16.len() as u32, written: r.count as u32 };
            }
        }
        // Scalar path (handles unpaired surrogates + partial-buffer fill).
        let mut read = 0usize;
        let mut written = 0usize;
        let mut tmp = [0u8; 4];
        while read < utf16.len() {
            let unit = utf16[read] as u32;
            let (cp, adv) = if (0xD800..=0xDBFF).contains(&unit) {
                if read + 1 < utf16.len() {
                    let lo = utf16[read + 1] as u32;
                    if (0xDC00..=0xDFFF).contains(&lo) {
                        (0x10000 + ((unit - 0xD800) << 10) + (lo - 0xDC00), 2)
                    } else { (0xFFFD, 1) }
                } else { (0xFFFD, 1) }
            } else if (0xDC00..=0xDFFF).contains(&unit) {
                (0xFFFD, 1)
            } else { (unit, 1) };
            let n = encode_wtf8_rune(&mut tmp, cp);
            if written + n > buf.len() { break; }
            buf[written..written + n].copy_from_slice(&tmp[..n]);
            written += n;
            read += adv;
        }
        EncodeIntoResult { read: read as u32, written: written as u32 }
    }

    /// Port of `copyLatin1IntoUTF8` — encode Latin-1 into a fixed-size UTF-8 buffer.
    pub fn copy_latin1_into_utf8(buf: &mut [u8], latin1: &[u8]) -> EncodeIntoResult {
        let mut read = 0usize;
        let mut written = 0usize;
        while read < latin1.len() {
            let c = latin1[read];
            if c < 0x80 {
                if written >= buf.len() { break; }
                buf[written] = c;
                written += 1;
                read += 1;
            } else {
                if written + 2 > buf.len() { break; }
                let [a, b] = latin1_to_codepoint_bytes_assume_not_ascii(c);
                buf[written] = a;
                buf[written + 1] = b;
                written += 2;
                read += 1;
            }
        }
        // PERF(port): Zig fast-paths ASCII spans via SWAR; could re-add via first_non_ascii.
        EncodeIntoResult { read: read as u32, written: written as u32 }
    }

    /// Null-terminated variant of `to_utf8_from_latin1`. Returns `ZBox` so
    /// `.len()` excludes the sentinel (Zig `[:0]u8` semantics).
    pub fn to_utf8_from_latin1_z(latin1: &[u8]) -> Option<crate::ZBox> {
        let v = to_utf8_from_latin1(latin1)?;
        Some(crate::ZBox::from_vec_with_nul(v))
    }

    /// Null-terminated variant of `to_utf8_alloc`. Returns `ZBox` so `.len()`
    /// excludes the sentinel.
    pub fn to_utf8_alloc_z(utf16: &[u16]) -> crate::ZBox {
        crate::ZBox::from_vec_with_nul(to_utf8_alloc(utf16))
    }

    /// Port of `firstNonASCII16`.
    #[inline]
    pub fn first_non_ascii16(utf16: &[u16]) -> Option<usize> {
        utf16.iter().position(|&u| u >= 0x80)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Generic-T helpers used by bun_paths (must live at T0).
    // ──────────────────────────────────────────────────────────────────────

    #[inline]
    pub fn index_of_any_t<T: Copy + Eq>(s: &[T], chars: &[T]) -> Option<usize> {
        s.iter().position(|c| chars.contains(c))
    }

    #[inline]
    pub fn has_prefix_t<T: Eq>(s: &[T], prefix: &[T]) -> bool {
        s.len() >= prefix.len() && &s[..prefix.len()] == prefix
    }

    #[inline]
    pub fn last_index_of_char<T: Copy + Eq>(s: &[T], c: T) -> Option<usize> {
        s.iter().rposition(|&x| x == c)
    }
    #[inline]
    pub fn last_index_of_char_t<T: Copy + Eq>(s: &[T], c: T) -> Option<usize> {
        last_index_of_char(s, c)
    }

    #[inline]
    pub fn eql_long(a: &[u8], b: &[u8]) -> bool { a == b }

    #[inline]
    pub fn eql_case_insensitive_ascii_check_length(a: &[u8], b: &[u8]) -> bool {
        eql_case_insensitive_ascii(a, b, true)
    }

    /// Port of `convertUTF8ToUTF16InBuffer`. Writes WTF-16 into `out`; returns
    /// the slice written. Caller must size `out` ≥ utf8.len() (worst case 1:1).
    /// `strings.convertUTF16ToUTF8InBuffer` — write WTF-8 into `out`, return
    /// the written sub-slice. Uses simdutf for valid input; falls back to a
    /// `Vec`-backed scalar path on surrogate errors.
    pub fn convert_utf16_to_utf8_in_buffer<'a>(out: &'a mut [u8], utf16: &[u16]) -> Result<&'a mut [u8], EncodeIntoResult> {
        // Fast path: simdutf in-place. `utf8::from::utf16::le` returns the
        // byte length needed; convert writes that many.
        let need = simdutf::length::utf8::from::utf16::le(utf16);
        if need <= out.len() {
            let r = simdutf::convert::utf16::to::utf8::with_errors::le(utf16, out);
            if r.status == simdutf::Status::SUCCESS {
                return Ok(&mut out[..r.count]);
            }
        }
        // Fallback: append into a Vec (handles unpaired surrogates as WTF-8),
        // then copy. PERF(port): Zig writes directly into `out`; revisit.
        let mut v = Vec::with_capacity(need.max(utf16.len()));
        convert_utf16_to_utf8_append(&mut v, utf16);
        if v.len() > out.len() {
            return Err(EncodeIntoResult { read: 0, written: 0 });
        }
        out[..v.len()].copy_from_slice(&v);
        Ok(&mut out[..v.len()])
    }
    /// `bun.strings.basename` — pass-through to the path-module impl. Lives
    /// here so T1 `bun_paths` (which can't depend on `bun_string`) can call it
    /// via `bun_core::strings`.
    #[inline]
    pub fn basename(path: &[u8]) -> &[u8] {
        // PORT NOTE: matches std.fs.path.basenamePosix — last component after
        // stripping trailing separators; "/" → "".
        let mut end = path.len();
        while end > 0 && (path[end - 1] == b'/' || path[end - 1] == b'\\') { end -= 1; }
        if end == 0 { return b""; }
        let mut start = end;
        while start > 0 && path[start - 1] != b'/' && path[start - 1] != b'\\' { start -= 1; }
        &path[start..end]
    }
    /// `bun.strings.withoutTrailingSlash`
    #[inline]
    pub fn without_trailing_slash(s: &[u8]) -> &[u8] {
        let mut e = s.len();
        while e > 1 && (s[e - 1] == b'/' || s[e - 1] == b'\\') { e -= 1; }
        &s[..e]
    }
    pub fn convert_utf8_to_utf16_in_buffer<'a>(out: &'a mut [u16], utf8: &[u8]) -> &'a mut [u16] {
        // SAFETY: simdutf reads utf8.len() bytes, writes ≤ utf8.len() u16.
        let r = unsafe {
            simdutf::simdutf__convert_utf8_to_utf16le_with_errors(
                utf8.as_ptr(),
                utf8.len(),
                out.as_mut_ptr(),
            )
        };
        if r.status == simdutf::Status::SUCCESS {
            return &mut out[..r.count];
        }
        // WTF-8 fallback (passes through invalid bytes / unpaired surrogates).
        // PERF(port): scalar loop; Zig had similar fallback.
        let mut written = 0usize;
        let mut i = 0usize;
        while i < utf8.len() {
            let b = utf8[i];
            if b < 0x80 {
                out[written] = b as u16;
                written += 1;
                i += 1;
            } else {
                // Decode one WTF-8 sequence; invalid → U+FFFD.
                let (cp, adv) = decode_wtf8_one(&utf8[i..]);
                if cp <= 0xFFFF {
                    out[written] = cp as u16;
                    written += 1;
                } else {
                    let cp = cp - 0x10000;
                    out[written] = 0xD800 | ((cp >> 10) as u16);
                    out[written + 1] = 0xDC00 | ((cp & 0x3FF) as u16);
                    written += 2;
                }
                i += adv;
            }
        }
        &mut out[..written]
    }

    fn decode_wtf8_one(s: &[u8]) -> (u32, usize) {
        let b0 = s[0] as u32;
        if b0 < 0x80 { return (b0, 1); }
        if b0 < 0xC0 || s.len() < 2 { return (0xFFFD, 1); }
        let b1 = s[1] as u32;
        if b0 < 0xE0 { return (((b0 & 0x1F) << 6) | (b1 & 0x3F), 2); }
        if s.len() < 3 { return (0xFFFD, 1); }
        let b2 = s[2] as u32;
        if b0 < 0xF0 { return (((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F), 3); }
        if s.len() < 4 { return (0xFFFD, 1); }
        let b3 = s[3] as u32;
        (
            ((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F),
            4,
        )
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

/// Port of `bun.assertWithLocation` (src/bun_core/bun.zig) — `bun.assert` plus
/// the caller's source location for the failure message. In release builds the
/// Zig version logs and continues; here it panics under `debug_assertions` and
/// is a no-op otherwise (matching `bun.assert`'s release-safe behaviour).
#[track_caller]
#[inline]
pub fn assert_with_location(cond: bool, loc: &'static core::panic::Location<'static>) {
    if cfg!(debug_assertions) && !cond {
        panic!("assertion failed at {}:{}", loc.file(), loc.line());
    }
}

/// FFI panic barrier used by `#[uws_callback]` (see `bun_jsc_macros`).
///
/// Unwinding out of an `extern "C"` callback into a C++ uWS / uSockets frame
/// is UB (the C++ side has no landing pads, and with `panic=unwind` rustc's
/// implicit abort shim fires *after* the foreign frame has been corrupted on
/// some targets). Every macro-generated thunk routes its body through
/// `catch_unwind_ffi`, which catches the panic, prints the payload, and
/// hard-aborts — same end state as Zig `@panic` → `bun.crash_handler`, but
/// without the UB window.
///
/// `AssertUnwindSafe` is sound here for the same reason as in
/// `bun_jsc::host_fn::catch_panic`: the closure only borrows the
/// caller-supplied `&mut Self` and FFI scalars; a torn `Self` is no worse than
/// the Zig path (process is about to abort anyway), and the alternative — UB —
/// is strictly worse.
pub mod ffi {
    /// Borrow a NUL-terminated C string from an FFI pointer.
    ///
    /// Single audited wrapper over `CStr::from_ptr` so the ~180 raw call
    /// sites in the tree funnel through one `unsafe` block. Adds a
    /// `debug_assert!(!p.is_null())` — `CStr::from_ptr(null)` is instant UB
    /// and the Zig originals (`bun.span`, `std.mem.span`) likewise assume a
    /// valid sentinel pointer, so a null here is always a caller bug.
    ///
    /// # Safety
    /// `p` must be non-null, point to a valid NUL-terminated byte sequence,
    /// and the returned borrow must not outlive that allocation. The caller
    /// chooses `'a` — keep it as tight as the source buffer's lifetime.
    #[inline(always)]
    pub unsafe fn cstr<'a>(p: *const core::ffi::c_char) -> &'a core::ffi::CStr {
        debug_assert!(!p.is_null(), "ffi::cstr: null pointer");
        // SAFETY: caller contract above — non-null, NUL-terminated, valid for 'a.
        unsafe { core::ffi::CStr::from_ptr(p) }
    }

    /// Convenience: `cstr(p).to_bytes()`. Dominant shape at call sites
    /// (Zig `bun.span(p)` / `std.mem.span(p)` port).
    ///
    /// # Safety
    /// Same contract as [`cstr`].
    #[inline(always)]
    pub unsafe fn cstr_bytes<'a>(p: *const core::ffi::c_char) -> &'a [u8] {
        // SAFETY: forwarded to `cstr`.
        unsafe { cstr(p) }.to_bytes()
    }

    /// All-bits-zero value of `T` for `#[repr(C)]` FFI structs.
    ///
    /// Single audited wrapper over `core::mem::zeroed()` so libc/uv/c-ares
    /// out-param init sites (`let mut x: libc::sigaction = zeroed();`) don't
    /// each open-code an `unsafe` block. This is the Rust spelling of Zig's
    /// `std.mem.zeroes(T)` / `= .{}` for `extern struct`.
    ///
    /// Prefer `T::default()` when `T` implements (or can derive) `Default` —
    /// reserve this for foreign POD where the orphan rule blocks a `Default`
    /// impl (libc, bindgen output) or where `Default` would be wrong but
    /// zero-init matches the C API contract.
    ///
    /// # Safety
    /// `T` must be inhabited at the all-zero bit pattern: no non-nullable
    /// pointers (`&T`, `Box<T>`, `NonNull<T>`, fn ptrs), no `bool`/`char`
    /// outside their valid range, no uninhabited enums. `#[repr(C)]` structs
    /// of integers, raw pointers, and nested POD satisfy this.
    #[inline(always)]
    pub const unsafe fn zeroed<T>() -> T {
        // SAFETY: caller guarantees T is valid at the all-zero bit pattern.
        unsafe { core::mem::zeroed() }
    }

    /// Assemble `&[T]` from a raw `(ptr, len)` pair handed across the FFI
    /// boundary (C++ out-params, `extern "C"` callback args, `#[repr(C)]`
    /// struct fields). Unlike a bare `from_raw_parts`, tolerates the C
    /// convention of `(null, 0)` for an empty slice (Rust requires a
    /// non-null, aligned pointer even at `len == 0`).
    ///
    /// Prefer bare `core::slice::from_raw_parts` at hot sites where `ptr` is
    /// provably non-null (pointer-arith from `&self`, `NonNull::as_ptr()`).
    ///
    /// # Safety
    /// Callers must still wrap the call in `unsafe` and uphold the
    /// `from_raw_parts` contract: when `len > 0`, `ptr` must be non-null,
    /// aligned, and point to `len` initialized `T` valid for `'a`. `ptr` may
    /// be null only when `len == 0`.
    #[inline(always)]
    pub const unsafe fn slice<'a, T>(ptr: *const T, len: usize) -> &'a [T] {
        if ptr.is_null() {
            // Hard assert: a `(null, N>0)` pair was UB under bare
            // `from_raw_parts`; silently returning `&[]` here would mask the
            // contract violation in release and let callers iterate 0 times
            // when they expect N. Fail loudly instead.
            assert!(len == 0, "ffi::slice: null ptr with non-zero len");
            // SAFETY: dangling is non-null + aligned; len 0 needs no backing.
            unsafe { core::slice::from_raw_parts(core::ptr::NonNull::dangling().as_ptr(), 0) }
        } else {
            // SAFETY: caller contract above.
            unsafe { core::slice::from_raw_parts(ptr, len) }
        }
    }

    /// Mutable counterpart of [`slice`]. Same null-at-zero tolerance.
    ///
    /// # Safety
    /// Same as [`slice`], plus the caller must guarantee no other `&`/`&mut`
    /// to the range is live for `'a`.
    #[inline(always)]
    pub const unsafe fn slice_mut<'a, T>(ptr: *mut T, len: usize) -> &'a mut [T] {
        if ptr.is_null() {
            assert!(len == 0, "ffi::slice_mut: null ptr with non-zero len");
            // SAFETY: dangling is non-null + aligned; len 0 needs no backing.
            unsafe { core::slice::from_raw_parts_mut(core::ptr::NonNull::dangling().as_ptr(), 0) }
        } else {
            // SAFETY: caller contract above.
            unsafe { core::slice::from_raw_parts_mut(ptr, len) }
        }
    }

    #[inline]
    pub fn catch_unwind_ffi<R>(f: impl FnOnce() -> R) -> R {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
            Ok(v) => v,
            Err(payload) => abort_on_panic(payload),
        }
    }

    #[cold]
    #[inline(never)]
    pub fn abort_on_panic(
        payload: std::boxed::Box<dyn core::any::Any + Send + 'static>,
    ) -> ! {
        let msg: &str = if let Some(s) = payload.downcast_ref::<&'static str>() {
            s
        } else if let Some(s) = payload.downcast_ref::<std::string::String>() {
            s.as_str()
        } else {
            "<non-string panic payload>"
        };
        // Best-effort write to stderr; ignore errors (we're about to abort).
        let _ = std::io::Write::write_all(
            &mut std::io::stderr(),
            format!("panic in extern \"C\" callback (aborting): {msg}\n").as_bytes(),
        );
        std::process::abort()
    }
}

pub mod asan {
    #[inline] pub unsafe fn poison(_: *const u8, _: usize) {}
    #[inline] pub unsafe fn unpoison(_: *const u8, _: usize) {}
    #[inline] pub fn poison_slice<T>(_: &[T]) {}
    #[inline] pub fn unpoison_slice<T>(_: &[T]) {}
    #[inline] pub fn assert_unpoisoned<T>(_: *const T) {}
    /// LSAN root-region registration. No-op stub until the sanitizer shim lands;
    /// callers (e.g. `Listener.group`) register mimalloc-backed regions so LSAN
    /// can trace into uSockets-owned `us_socket_t` chains.
    #[inline] pub fn register_root_region(_: *const core::ffi::c_void, _: usize) {}
    #[inline] pub fn unregister_root_region(_: *const core::ffi::c_void, _: usize) {}
    pub const ENABLED: bool = false;
}

// ────────────────────────────────────────────────────────────────────────────
// PHASE-C: glibc-compat / link wraps. Zig: src/workaround_missing_symbols.zig.
// build.ninja links with `-Wl,--wrap=gettid` so libc/std references land here.
// ────────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "linux")]
#[unsafe(no_mangle)]
pub extern "C" fn __wrap_gettid() -> libc::pid_t {
    // SAFETY: SYS_gettid takes no arguments and never fails.
    unsafe { libc::syscall(libc::SYS_gettid) as libc::pid_t }
}

/// `bun.getTotalMemorySize()` (bun.zig:3498) — process-wide RAM budget,
/// cgroup/jetsam-aware. Backed by the linked C++ `Bun__ramSize()`
/// (src/jsc/bindings/c-bindings.cpp). Lives in `bun_core` so both
/// `bun_runtime` (node:fs preallocation guard) and the binary root can
/// call it without re-declaring the C ABI.
pub fn get_total_memory_size() -> usize {
    unsafe extern "C" { fn Bun__ramSize() -> usize; }
    // SAFETY: pure FFI into Bun's C++ bindings; no invariants required.
    unsafe { Bun__ramSize() }
}

/// PHASE-C: stack capture for `Global::StoredTrace` / `bun_crash_handler`.
/// Zig used `std.debug.captureStackTrace`; route through libc `backtrace()`.
///
/// Only platforms whose libc actually exports `backtrace()` go through it:
/// glibc, macOS, the BSDs. musl and Android's bionic don't have `<execinfo.h>`
/// (the `libc` crate doesn't expose `backtrace` for them at all), so those
/// targets — and Windows — fall back to reporting an empty trace. The crash
/// handler already tolerates a 0-frame capture (it prints what it has), and
/// the symbolizer path is glibc/macOS-only anyway.
#[cfg(any(
    all(target_os = "linux", target_env = "gnu"),
    target_os = "macos",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    target_os = "openbsd",
))]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__captureStackTrace(begin: usize, out: *mut usize, cap: usize) -> usize {
    if out.is_null() || cap == 0 {
        return 0;
    }
    unsafe {
        // FreeBSD's libexecinfo backtrace() takes/returns size_t; glibc/macOS use int.
        #[cfg(any(target_os = "freebsd", target_os = "dragonfly", target_os = "netbsd", target_os = "openbsd"))]
        let n = libc::backtrace(out.cast::<*mut core::ffi::c_void>(), cap) as usize;
        #[cfg(not(any(target_os = "freebsd", target_os = "dragonfly", target_os = "netbsd", target_os = "openbsd")))]
        let n = libc::backtrace(out.cast::<*mut core::ffi::c_void>(), cap as core::ffi::c_int);
        #[cfg(not(any(target_os = "freebsd", target_os = "dragonfly", target_os = "netbsd", target_os = "openbsd")))]
        let n = if n < 0 { 0 } else { n as usize };
        if begin > 0 && begin < n {
            core::ptr::copy(out.add(begin), out, n - begin);
            return n - begin;
        }
        n
    }
}

/// Fallback for targets without `libc::backtrace` (musl, Android, Windows, …).
/// Returns 0 frames so callers degrade to a frame-less crash report instead of
/// failing to compile.
#[cfg(not(any(
    all(target_os = "linux", target_env = "gnu"),
    target_os = "macos",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    target_os = "openbsd",
)))]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__captureStackTrace(begin: usize, out: *mut usize, cap: usize) -> usize {
    let _ = (begin, out, cap);
    0
}
