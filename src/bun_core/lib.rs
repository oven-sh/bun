#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use, unreachable_pub)]
// AUTOGEN: mod declarations only — real exports added in B-1.

pub mod result;
pub mod tty;
pub mod util;
pub mod Global;

/// Shared state-machine tag for the streaming (de)compressors in
/// `bun_brotli` / `bun_zlib` / `bun_zstd`. Mirrors the identical
/// `pub const State = enum { Uninitialized, Inflating, End, Error }`
/// nested in each Zig reader/compressor struct.
pub mod compress {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum State {
        Uninitialized,
        Inflating,
        End,
        Error,
    }
}
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

// ─── libm shims ───────────────────────────────────────────────────────────────
// Canonical extern for libm's `powf`/`pow` (Zig: `bun.zig` `pub extern "c" fn
// powf`). Hot CSS color-space conversion paths (gam_srgb, lab, prophoto) call
// the safe wrapper below; keep `#[inline]` so cross-crate use stays a direct
// libm call.
unsafe extern "C" {
    // safe: all args by-value; libm `powf` is defined for all f32 inputs.
    #[link_name = "powf"]
    safe fn libm_powf(x: f32, y: f32) -> f32;
    // safe: all args by-value; libm `pow` is defined for all f64 inputs.
    #[link_name = "pow"]
    safe fn libm_pow(x: f64, y: f64) -> f64;
}

#[inline]
pub fn powf(x: f32, y: f32) -> f32 {
    libm_powf(x, y)
}

#[inline]
pub fn pow(x: f64, y: f64) -> f64 {
    libm_pow(x, y)
}

/// Safe `Vec` growth helpers — consolidate the
/// `reserve(n); spare_capacity_mut(); MaybeUninit::write…; unsafe set_len(n)`
/// pattern (S025) so the single `unsafe { set_len }` lives here behind a
/// locally-proven invariant instead of being open-coded at every fill site.
pub mod vec {
    /// Extend `v` by `n` elements, each produced by `f(i)` for `i in 0..n`.
    ///
    /// Equivalent to `for i in 0..n { v.push(f(i)) }` but reserves once and
    /// writes through `spare_capacity_mut()` so no per-element capacity check
    /// or length bump occurs in the hot loop. Replaces the Zig-ported
    /// `reserve; ptr::write…; set_len` blocks where the fill is a pure
    /// per-index function (constant, default, or `i`-derived).
    ///
    /// Panic-safety: if `f` panics at index `k`, `v.len()` is left at its
    /// original value plus `k` — every exposed element is initialized, and the
    /// partially-written tail stays in spare capacity (never dropped).
    #[inline]
    pub fn extend_from_fn<T>(v: &mut Vec<T>, n: usize, mut f: impl FnMut(usize) -> T) {
        v.reserve(n);
        let prev = v.len();
        let spare = v.spare_capacity_mut();
        debug_assert!(spare.len() >= n);
        for (i, slot) in spare[..n].iter_mut().enumerate() {
            // `MaybeUninit::write` never drops the (uninitialized) prior
            // contents — it is a raw `ptr::write`.
            slot.write(f(i));
        }
        // SAFETY:
        // - `reserve(n)` guarantees `capacity >= prev + n`.
        // - Every slot in `spare[..n]` (i.e. `v[prev .. prev+n]`) was just
        //   initialized via `MaybeUninit::write` in the loop above, so the
        //   newly-exposed range contains only valid `T`.
        // Panic note: if `f` panics mid-loop, `len` is still `prev`, so the
        // already-written prefix stays in spare capacity and is *leaked* (not
        // dropped) — sound, and acceptable for the constant/`Default`/index
        // fills this helper targets.
        unsafe { v.set_len(prev + n) };
    }

    /// Extend `v` by `n` `T::default()` elements and return a mutable slice
    /// of the newly-appended tail (`&mut v[prev_len .. prev_len + n]`).
    ///
    /// Replaces the Zig-ported `reserve(n); set_len(len+n); &mut v[len..]`
    /// pattern (S022) where the tail is immediately overwritten by a clone/
    /// fill loop — the default-fill keeps every exposed `T` valid even if the
    /// caller bails partway through writing.
    #[inline]
    pub fn grow_default<T: Default>(v: &mut Vec<T>, n: usize) -> &mut [T] {
        let prev = v.len();
        extend_from_fn(v, n, |_| T::default());
        &mut v[prev..]
    }
}

// ── B-2 gate ── remaining heavy modules ────────────────────────────────────
#[path = "Progress.rs"] pub mod Progress;
pub mod fmt;
#[path = "output.rs"]
pub mod output;

// `bun_core` (T0) cannot name `bun_sys` I/O primitives. Single-variant
// link-interface (owner is unused / null); `bun_sys` provides the `Sys` arm.
bun_dispatch::link_interface! {
    pub OutputSink[Sys] {
        fn stderr() -> output::File;
        fn make_path(cwd: Fd, dir: &[u8]) -> core::result::Result<(), Error>;
        fn create_file(cwd: Fd, path: &[u8]) -> core::result::Result<Fd, Error>;
        fn quiet_writer_from_fd(fd: Fd) -> output::QuietWriter;
        fn quiet_writer_adapt(qw: output::QuietWriter, buf: *mut u8, len: usize) -> output::QuietWriterAdapter;
        fn quiet_writer_flush(qw: &mut output::QuietWriter);
        fn quiet_writer_write_all(qw: &mut output::QuietWriter, bytes: &[u8]) -> bool;
        fn quiet_writer_fd(qw: &output::QuietWriter) -> Fd;
        fn tty_winsize(fd: Fd) -> Option<Winsize>;
        fn is_terminal(fd: Fd) -> bool;
        fn read(fd: Fd, buf: &mut [u8]) -> core::result::Result<usize, Error>;
    }
}

impl OutputSink {
    pub const SYS: Self = Self { kind: OutputSinkKind::Sys, owner: core::ptr::null_mut() };
}

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
    /// Repo root. Zig's build.zig passes `b.pathFromRoot(".")` (already
    /// normalized, native separators) — there is *no* fallback in the spec.
    /// `scripts/build/rust.ts` exports `BUN_BASE_PATH` for every build.
    ///
    /// The POSIX fallback derives it from this crate's manifest dir
    /// (`<repo>/src/bun_core`) so a bare `cargo check` still works for
    /// `runtime_embed_file!` (which goes through `PathBuf`, so the OS resolves
    /// `..`). On Windows that fallback is *wrong*: `CARGO_MANIFEST_DIR` is
    /// backslash-separated and concatenating `/../..` yields a mixed-separator,
    /// unnormalized path that crash_handler's byte-wise `starts_with` (which
    /// appends `SEP_STR` and compares against debug-info file paths) can never
    /// match — so require the env var there, matching the Zig contract.
    pub const BASE_PATH: &[u8] = match option_env!("BUN_BASE_PATH") {
        Some(v) => v.as_bytes(),
        // The fallback is correct on POSIX. On Windows it is mixed-separator
        // + unnormalized and crash_handler's byte-wise `starts_with` will
        // never match it — but real Windows builds always go through
        // `scripts/build/rust.ts` (which sets the env var). Kept so that bare
        // `cargo check --target *-windows-*` from a non-Windows host compiles.
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
    /// every crate's rustc env. POSIX fallback for bare `cargo check`; on
    /// Windows the `/../../` fallback is mixed-separator + unnormalized (see
    /// `BASE_PATH` above), so require the env var there.
    pub const CODEGEN_PATH: &[u8] = match option_env!("BUN_CODEGEN_DIR") {
        Some(v) => v.as_bytes(),
        // See BASE_PATH note re: Windows fallback being mixed-separator. Real
        // Windows builds set the env var; this only fires for cross-target
        // `cargo check`.
        None => concat!(env!("CARGO_MANIFEST_DIR"), "/../../build/debug/codegen").as_bytes(),
    };
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
pub use bun_alloc::oom_from_alloc;
pub use util::*;
pub use result::*;
pub use Global::*;
pub use tty::Winsize;
pub use ffi::{Zeroable, boxed_zeroed, boxed_zeroed_unchecked};

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

/// Recover a typed `&mut T` from a C-callback's opaque user-data pointer.
///
/// This is the canonical spelling for the ubiquitous trampoline pattern where
/// a C library (libarchive, c-ares, uWS, libuv, lol-html, BoringSSL, …) round-
/// trips a Rust object through a `void *user_data` slot and hands it back to
/// an `extern "C" fn` thunk. Phase-A open-coded this as
/// `unsafe { &mut *ctx.cast::<T>() }` at every site; centralising it here
/// makes the pattern grep-able, attaches a uniform safety contract, and
/// debug-asserts the non-null precondition the C side guarantees.
///
/// Re-exported from `bun_ptr` so callers can spell `bun_ptr::callback_ctx`.
///
/// # Safety
/// - `ctx` must be non-null, properly aligned, and point to a live, fully
///   initialised `T` for the entire returned lifetime `'a` (i.e. the body of
///   the callback). The C library round-tripped the exact `*mut T` the Rust
///   side registered, so type and provenance are correct by construction.
/// - No other `&mut T` (or `&T` overlapping a mutated field) may be live for
///   `'a`. C-callback user-data satisfies this on the runtime's single-
///   threaded event loop: the callback is the unique re-entry point for `*ctx`
///   while it runs. **Do not** use this for arbitrary pointer reinterpretation
///   (struct-layout punning, lifetime laundering) — that is not the contract.
#[inline(always)]
#[track_caller]
pub unsafe fn callback_ctx<'a, T>(ctx: *mut core::ffi::c_void) -> &'a mut T {
    debug_assert!(!ctx.is_null(), "callback_ctx: null user-data pointer");
    // SAFETY: per fn contract — `ctx` is the `*mut T` the caller registered as
    // C user-data, non-null, live, and exclusively accessed for `'a`.
    unsafe { &mut *ctx.cast::<T>() }
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

/// `bun.JSError` — the canonical JS error union (`error{JSError, OutOfMemory, JSTerminated}`
/// in Zig). Tier-0 so every layer of the runtime can name it directly; `bun_jsc` re-exports
/// it as `bun_jsc::JsError` and `bun_event_loop` re-exports it as `ErasedJsError` for
/// historical call sites.
///
/// `#[repr(u8)]` with explicit discriminants: `AnyTask` stores
/// `fn(*mut c_void) -> Result<(), JsError>` and the dispatcher relies on the 1-byte layout
/// surviving the type-erased round-trip.
#[repr(u8)]
#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum JsError {
    /// A JavaScript exception is pending in the VM's exception scope.
    Thrown = 0,
    /// Allocation failure; caller must throw an `OutOfMemoryError`.
    OutOfMemory = 1,
    /// The VM is terminating (worker shutdown / `process.exit`).
    Terminated = 2,
}

bun_alloc::oom_from_alloc!(JsError);

impl From<crate::Error> for JsError {
    fn from(_: crate::Error) -> Self {
        // PORT NOTE: Zig coerces arbitrary `anyerror` into the JS error union by
        // throwing a generic Error; the throw happens at the call site. Mapping
        // to `Thrown` here lets `?` propagate while the actual throw is handled
        // by the host-fn wrapper.
        JsError::Thrown
    }
}

impl From<JsError> for crate::Error {
    /// Widen a `bun.JSError` value back into the `anyerror` newtype. Preserves
    /// the exact Zig tag (`@errorName`) so call sites that round-trip through
    /// `bun_core::Error` (e.g. the `bun_bundler::dispatch::DevServerVTable`
    /// boundary) keep `error.OutOfMemory` distinguishable from `error.JSError`.
    #[inline]
    fn from(e: JsError) -> Self {
        match e {
            JsError::OutOfMemory => crate::err!("OutOfMemory"),
            // `Terminated` is a Rust-port addition (worker shutdown); it has no
            // distinct Zig `error.` tag, so collapse into `JSError` like every
            // other thrown JS exception.
            JsError::Thrown | JsError::Terminated => crate::err!("JSError"),
        }
    }
}

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
/// startup (`main`/`Cli::start`) and read freely thereafter.
static START_TIME: std::sync::OnceLock<i128> = std::sync::OnceLock::new();
#[inline]
pub fn start_time() -> i128 {
    START_TIME.get().copied().unwrap_or(0)
}
#[inline]
pub fn set_start_time(ns: i128) {
    let _ = START_TIME.set(ns);
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
    #[inline] pub fn includes(h: &[u8], n: &[u8]) -> bool { ::bstr::ByteSlice::find(h, n).is_some() }
    #[inline] pub fn contains(h: &[u8], n: &[u8]) -> bool { includes(h, n) }
    #[inline] pub fn index_of_char(h: &[u8], c: u8) -> Option<usize> { h.iter().position(|&b| b == c) }
    #[inline] pub fn starts_with(h: &[u8], p: &[u8]) -> bool { h.starts_with(p) }
    #[inline] pub fn ends_with(h: &[u8], p: &[u8]) -> bool { h.ends_with(p) }
    #[inline] pub fn eql(a: &[u8], b: &[u8]) -> bool { a == b }
    pub use ::bun_alloc::trim_right;
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
    /// Zig: `strings.copyLowercase` (src/string/immutable.zig). ASCII-lowercase
    /// `in_` into `out` (which must be at least `in_.len()`), returning the
    /// written prefix. Memcpy-runs + per-uppercase-byte fixup; identical output
    /// to a byte-at-a-time `to_ascii_lowercase` zip.
    pub fn copy_lowercase<'a>(in_: &[u8], out: &'a mut [u8]) -> &'a [u8] {
        let mut in_slice = in_;
        // PORT NOTE: reshaped for borrowck — track output offset instead of reslicing &mut.
        let mut out_off: usize = 0;

        'begin: loop {
            for (i, &c) in in_slice.iter().enumerate() {
                if let b'A'..=b'Z' = c {
                    out[out_off..out_off + i].copy_from_slice(&in_slice[0..i]);
                    out[out_off + i] = c.to_ascii_lowercase();
                    let end = i + 1;
                    in_slice = &in_slice[end..];
                    out_off += end;
                    continue 'begin;
                }
            }

            out[out_off..out_off + in_slice.len()].copy_from_slice(in_slice);
            break;
        }

        &out[0..in_.len()]
    }
    /// Zig: `strings.eqlCaseInsensitiveASCII` (src/string/immutable.zig).
    /// Spec-faithful port: defers to libc `strncasecmp`/`_strnicmp` for the
    /// hot path (CSS parser, HTTP header matching). When `check_len` is false
    /// the caller guarantees `a.len() <= b.len()` and both are non-empty
    /// (matches Zig's `bun.unsafeAssert`).
    #[inline]
    pub fn eql_case_insensitive_ascii(a: &[u8], b: &[u8], check_len: bool) -> bool {
        if check_len {
            if a.len() != b.len() {
                return false;
            }
            if a.is_empty() {
                return true;
            }
        }

        debug_assert!(!b.is_empty());
        debug_assert!(!a.is_empty());

        // SAFETY: a and b are non-empty; strncasecmp reads up to a.len() bytes from each.
        #[cfg(not(windows))]
        unsafe { libc::strncasecmp(a.as_ptr().cast(), b.as_ptr().cast(), a.len()) == 0 }
        // Windows MSVC libc has no `strncasecmp`; `_strnicmp` is the equivalent.
        #[cfg(windows)]
        unsafe {
            unsafe extern "C" {
                fn _strnicmp(a: *const core::ffi::c_char, b: *const core::ffi::c_char, n: usize) -> core::ffi::c_int;
            }
            _strnicmp(a.as_ptr().cast(), b.as_ptr().cast(), a.len()) == 0
        }
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
    #[inline]
    pub fn copy_latin1_into_utf8(buf: &mut [u8], latin1: &[u8]) -> EncodeIntoResult {
        copy_latin1_into_utf8_stop_on_non_ascii::<false>(buf, latin1)
    }

    /// Port of `copyLatin1IntoUTF8StopOnNonASCII`. SWAR fast-path for ASCII spans
    /// (moved down from `bun_string::immutable::unicode` so the canonical T0 copy
    /// is the spec-faithful one — TextEncoder.encodeInto / WebSocket frame encode
    /// hit this in tight loops).
    pub fn copy_latin1_into_utf8_stop_on_non_ascii<const STOP: bool>(
        buf_: &mut [u8],
        latin1_: &[u8],
    ) -> EncodeIntoResult {
        const ASCII_VECTOR_SIZE: usize = 16;
        let buf_total = buf_.len();
        let latin1_total = latin1_.len();
        let mut buf: &mut [u8] = buf_;
        let mut latin1: &[u8] = latin1_;

        while !buf.is_empty() && !latin1.is_empty() {
            'inner: {
                // PERF(port): Zig used @Vector(ascii_vector_size, u8) + @reduce(.Max). We emulate
                // with a scalar high-bit scan over 16-byte chunks, then SWAR via u64 mask below.
                let mut remaining_runs = buf.len().min(latin1.len()) / ASCII_VECTOR_SIZE;
                while remaining_runs > 0 {
                    remaining_runs -= 1;
                    let chunk = &latin1[..ASCII_VECTOR_SIZE];
                    let mut has_high = false;
                    for &b in chunk {
                        if b > 127 {
                            has_high = true;
                            break;
                        }
                    }

                    if has_high {
                        if STOP {
                            return EncodeIntoResult { written: u32::MAX, read: u32::MAX };
                        }

                        // zig or LLVM doesn't do @ctz nicely with SIMD
                        if ASCII_VECTOR_SIZE >= 8 {
                            const SIZE: usize = core::mem::size_of::<u64>();

                            {
                                let bytes = u64::from_ne_bytes(latin1[..SIZE].try_into().expect("infallible: size matches"));
                                // https://dotat.at/@/2022-06-27-tolower-swar.html
                                let mask = bytes & 0x8080808080808080;

                                buf[..SIZE].copy_from_slice(&bytes.to_ne_bytes());

                                if mask > 0 {
                                    let first_set_byte = (mask.trailing_zeros() / 8) as usize;
                                    debug_assert!(latin1[first_set_byte] >= 127);

                                    buf = &mut buf[first_set_byte..];
                                    latin1 = &latin1[first_set_byte..];
                                    break 'inner;
                                }

                                latin1 = &latin1[SIZE..];
                                buf = &mut buf[SIZE..];
                            }

                            if ASCII_VECTOR_SIZE >= 16 {
                                let bytes = u64::from_ne_bytes(latin1[..SIZE].try_into().expect("infallible: size matches"));
                                // https://dotat.at/@/2022-06-27-tolower-swar.html
                                let mask = bytes & 0x8080808080808080;

                                buf[..SIZE].copy_from_slice(&bytes.to_ne_bytes());

                                debug_assert!(mask > 0);
                                let first_set_byte = (mask.trailing_zeros() / 8) as usize;
                                debug_assert!(latin1[first_set_byte] >= 127);

                                buf = &mut buf[first_set_byte..];
                                latin1 = &latin1[first_set_byte..];
                                break 'inner;
                            }
                        }
                        unreachable!();
                    }

                    buf[..ASCII_VECTOR_SIZE].copy_from_slice(chunk);
                    latin1 = &latin1[ASCII_VECTOR_SIZE..];
                    buf = &mut buf[ASCII_VECTOR_SIZE..];
                }

                {
                    const SIZE: usize = core::mem::size_of::<u64>();
                    while buf.len().min(latin1.len()) >= SIZE {
                        let bytes = u64::from_ne_bytes(latin1[..SIZE].try_into().expect("infallible: size matches"));
                        buf[..SIZE].copy_from_slice(&bytes.to_ne_bytes());

                        // https://dotat.at/@/2022-06-27-tolower-swar.html

                        let mask = bytes & 0x8080808080808080;

                        if mask > 0 {
                            let first_set_byte = (mask.trailing_zeros() / 8) as usize;
                            if STOP {
                                return EncodeIntoResult { written: u32::MAX, read: u32::MAX };
                            }
                            debug_assert!(latin1[first_set_byte] >= 127);

                            buf = &mut buf[first_set_byte..];
                            latin1 = &latin1[first_set_byte..];

                            break 'inner;
                        }

                        latin1 = &latin1[SIZE..];
                        buf = &mut buf[SIZE..];
                    }
                }

                {
                    // PORT NOTE: reshaped for borrowck — Zig advanced raw `.ptr`/`.len` independently.
                    let limit = buf.len().min(latin1.len());
                    debug_assert!(limit < 8);
                    let mut k = 0usize;
                    while k < limit && latin1[k] <= 127 {
                        buf[k] = latin1[k];
                        k += 1;
                    }
                    buf = &mut buf[k..];
                    latin1 = &latin1[k..];
                }
            }

            if !latin1.is_empty() {
                if buf.len() >= 2 {
                    if STOP {
                        return EncodeIntoResult { written: u32::MAX, read: u32::MAX };
                    }

                    let two = latin1_to_codepoint_bytes_assume_not_ascii(latin1[0]);
                    buf[..2].copy_from_slice(&two);
                    latin1 = &latin1[1..];
                    buf = &mut buf[2..];
                } else {
                    break;
                }
            }
        }

        EncodeIntoResult {
            written: u32::try_from(buf_total - buf.len()).unwrap(),
            read: u32::try_from(latin1_total - latin1.len()).unwrap(),
        }
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

    // ──────────────────────────────────────────────────────────────────────
    // Scanners / sniffers used by fmt.rs (URL redaction, path quoting, etc.).
    // Formerly a duplicate `mod strings` in fmt.rs; merged here so the crate
    // has a single `bun_core::strings` and fmt.rs picks up the simdutf-backed
    // `first_non_ascii`/`is_all_ascii` instead of scalar shims.
    // ──────────────────────────────────────────────────────────────────────

    #[inline]
    pub fn index_of_any(s: &[u8], chars: &[u8]) -> Option<usize> {
        s.iter().position(|b| chars.contains(b))
    }

    /// Zig: `bun.strings.isIPV6Address` — heuristic (contains ':', not parseable as v4).
    #[inline]
    pub fn is_ipv6_address(s: &[u8]) -> bool {
        index_of_char(s, b':').is_some()
    }

    pub fn starts_with_uuid(s: &[u8]) -> bool {
        // 8-4-4-4-12 hex with dashes
        if s.len() < 36 { return false; }
        for (i, &b) in s[..36].iter().enumerate() {
            let ok = match i { 8 | 13 | 18 | 23 => b == b'-', _ => b.is_ascii_hexdigit() };
            if !ok { return false; }
        }
        true
    }
    #[inline]
    pub fn is_uuid(s: &[u8]) -> bool {
        s.len() == 36 && starts_with_uuid(s)
    }
    pub fn starts_with_npm_secret(s: &[u8]) -> usize {
        // Port of bun.strings.startsWithNpmSecret (immutable.zig): case-insensitive
        // `npm`, then `_` or `s_`/`S_`, then 36..=48 alnum. Returns consumed length or 0.
        if s.len() < 3 { return 0; }
        if !(s[0] == b'n' || s[0] == b'N') { return 0; }
        if !(s[1] == b'p' || s[1] == b'P') { return 0; }
        if !(s[2] == b'm' || s[2] == b'M') { return 0; }
        let mut i = 3usize;
        if i < s.len() && (s[i] == b's' || s[i] == b'S') { i += 1; }
        if i >= s.len() || s[i] != b'_' { return 0; }
        i += 1;
        let prefix_len = i;
        while i < s.len() && (i - prefix_len) < 48 && s[i].is_ascii_alphanumeric() {
            i += 1;
        }
        if i - prefix_len < 36 { return 0; }
        i
    }
    fn starts_with_redacted_item(text: &[u8], item: &'static [u8]) -> Option<(usize, usize)> {
        if text.len() < item.len() || &text[..item.len()] != item {
            return None;
        }

        let mut whitespace = false;
        let mut offset = item.len();
        while offset < text.len() && text[offset].is_ascii_whitespace() {
            offset += 1;
            whitespace = true;
        }
        if offset == text.len() {
            return None;
        }
        let cont = crate::js_lexer::is_identifier_continue(text[offset] as i32);

        // must be another identifier
        if !whitespace && cont {
            return None;
        }

        // `null` is not returned after this point. Redact to the next
        // newline if anything is unexpected
        if cont {
            let rest = &text[offset..];
            return Some((offset, index_of_char(rest, b'\n').unwrap_or(rest.len())));
        }
        offset += 1;

        let mut end = offset;
        while end < text.len() && text[end].is_ascii_whitespace() {
            end += 1;
        }

        if end == text.len() {
            return Some((offset, text.len() - offset));
        }

        match text[end] {
            q @ (b'\'' | b'"' | b'`') => {
                // attempt to find closing
                let opening = end;
                end += 1;
                while end < text.len() {
                    match text[end] {
                        b'\\' => {
                            // skip
                            end += 1;
                            end += 1;
                        }
                        c if c == q => {
                            // closing
                            return Some((opening + 1, (end - 1) - opening));
                        }
                        _ => end += 1,
                    }
                }

                let rest = &text[offset..];
                Some((offset, index_of_char(rest, b'\n').unwrap_or(rest.len())))
            }
            _ => {
                let rest = &text[offset..];
                Some((offset, index_of_char(rest, b'\n').unwrap_or(rest.len())))
            }
        }
    }

    /// Returns offset and length of first secret found.
    pub fn starts_with_secret(str: &[u8]) -> Option<(usize, usize)> {
        if let Some(r) = starts_with_redacted_item(str, b"_auth") {
            return Some(r);
        }
        if let Some(r) = starts_with_redacted_item(str, b"_authToken") {
            return Some(r);
        }
        if let Some(r) = starts_with_redacted_item(str, b"email") {
            return Some(r);
        }
        if let Some(r) = starts_with_redacted_item(str, b"_password") {
            return Some(r);
        }
        if let Some(r) = starts_with_redacted_item(str, b"token") {
            return Some(r);
        }

        if starts_with_uuid(str) {
            return Some((0, 36));
        }

        let npm_secret_len = starts_with_npm_secret(str);
        if npm_secret_len > 0 {
            return Some((0, npm_secret_len));
        }

        if let Some(r) = find_url_password(str) {
            return Some(r);
        }

        None
    }

    /// Port of `bun.fmt.URLFormatter.findUrlPassword` — returns
    /// `(offset, len)` of the password segment, or None.
    /// Zig only matches http:// and https:// schemes and rejects empty pw.
    pub fn find_url_password(s: &[u8]) -> Option<(usize, usize)> {
        // Zig uses case-sensitive `hasPrefixComptime` and truncates the search
        // region at the first '\n' before scanning for '@'/':'.
        let scheme_end = if s.starts_with(b"http://") {
            7
        } else if s.starts_with(b"https://") {
            8
        } else {
            return None;
        };
        let mut rest = &s[scheme_end..];
        if let Some(nl) = rest.iter().position(|&b| b == b'\n') {
            rest = &rest[..nl];
        }
        let at = rest.iter().position(|&b| b == b'@')?;
        let userinfo = &rest[..at];
        let colon = userinfo.iter().position(|&b| b == b':')?;
        // Reject empty password (`user:@host`).
        if colon == at - 1 {
            return None;
        }
        Some((scheme_end + colon + 1, at - colon - 1))
    }

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum Encoding { Ascii, Latin1, Utf8, Utf16 }

    /// Port of `bun.strings.wtf8ByteSequenceLength`.
    #[inline]
    pub const fn wtf8_byte_sequence_length(b: u8) -> u8 {
        if b < 0x80 { 1 }
        else if b & 0xE0 == 0xC0 { 2 }
        else if b & 0xF0 == 0xE0 { 3 }
        else if b & 0xF8 == 0xF0 { 4 }
        else { 1 } // invalid lead → treat as 1 (replacement)
    }

    /// Zig: aliases `indexOfNewlineOrNonASCII`, which matches any control byte
    /// or non-ASCII (`< 0x20 || > 0x7F`). Scalar fallback; highway override
    /// via bun_string when linked.
    pub fn index_of_newline_or_non_ascii_or_ansi(s: &[u8]) -> Option<usize> {
        s.iter().position(|&b| b < 0x20 || b > 0x7F)
    }

    /// Zig delegates to highway: `b < 0x20 || b > 127 || b == '"'`
    /// (highway_strings.cpp:438). Do NOT match `'` or `` ` ``.
    pub fn contains_newline_or_non_ascii_or_quote(s: &[u8]) -> bool {
        s.iter().any(|&b| b < 0x20 || b > 0x7F || b == b'"')
    }

    // ─── CodepointIterator (fmt.rs identifier formatter) ──────────────────
    #[derive(Default, Clone, Copy)]
    pub struct CodepointIteratorCursor { pub i: usize, pub c: i32, pub width: u8 }
    pub struct CodepointIterator<'a> { bytes: &'a [u8] }
    impl<'a> CodepointIterator<'a> {
        #[inline] pub fn init(bytes: &'a [u8]) -> Self { Self { bytes } }
        pub fn next(&self, cursor: &mut CodepointIteratorCursor) -> bool {
            let i = cursor.i + cursor.width as usize;
            if i >= self.bytes.len() { return false; }
            let b = self.bytes[i];
            // TODO(port): full UTF-8 decode — bun_str owns the table-driven impl.
            let (cp, w) = if b < 0x80 { (b as i32, 1u8) } else { (b as i32, 1u8) };
            cursor.i = i; cursor.c = cp; cursor.width = w;
            true
        }
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
    ///
    /// PORT NOTE: Zig's `bun.strings.basename` comptime-dispatches to
    /// `basenameWindows` on Windows (treats `':'` at index 1 as a root
    /// delimiter: `"C:"` → `""`, `"C:foo"` → `"foo"`, `"C:\\"` → `""`) and
    /// `basenamePosix` elsewhere. Mirror that split exactly.
    #[cfg(windows)]
    #[inline]
    pub fn basename(path: &[u8]) -> &[u8] {
        // std.fs.path.basenameWindows — see src/string/immutable/paths.zig.
        if path.is_empty() { return b""; }
        let mut end = path.len() - 1;
        loop {
            let byte = path[end];
            if byte == b'/' || byte == b'\\' {
                if end == 0 { return b""; }
                end -= 1;
                continue;
            }
            if byte == b':' && end == 1 {
                return b"";
            }
            break;
        }
        let mut start = end;
        end += 1;
        while path[start] != b'/' && path[start] != b'\\' && !(path[start] == b':' && start == 1) {
            if start == 0 { return &path[0..end]; }
            start -= 1;
        }
        &path[start + 1..end]
    }
    #[cfg(not(windows))]
    #[inline]
    pub fn basename(path: &[u8]) -> &[u8] {
        // std.fs.path.basenamePosix — last component after stripping trailing
        // '/' separators; "/" → "".
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
/// Port of `bun.linuxKernelVersion()` (src/bun.zig) → `analytics.GeneratePlatform.kernelVersion()`.
/// Lives in T1 because `bun_sys` calls it from feature probes (copy_file_range,
/// ioctl_ficlone, RWF_NONBLOCK) and cannot depend on `bun_analytics`. Parses
/// `uname(2).release` major.minor.patch directly; the full Semver parse with
/// pre/build tags stays in `bun_analytics`.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub fn linux_kernel_version() -> Version {
    use core::sync::atomic::{AtomicU32, Ordering};
    // Packed u32: u32::MAX = uninit, otherwise (major<<20)|(minor<<10)|patch.
    // (Using MAX, not 0, as the sentinel so a parse that yields {0,0,0} caches
    // as 0 and round-trips to {0,0,0} on every call — the previous 0-sentinel
    // stored 1 in that case, returning {0,0,1} on subsequent calls.)
    static CACHE: AtomicU32 = AtomicU32::new(u32::MAX);
    let packed = CACHE.load(Ordering::Relaxed);
    if packed != u32::MAX {
        return Version {
            major: (packed >> 20) & 0x3ff,
            minor: (packed >> 10) & 0x3ff,
            patch: packed & 0x3ff,
        };
    }
    let uts = crate::ffi::uname();
    let release = crate::ffi::c_field_bytes(&uts.release);
    // Parse leading "MAJOR.MINOR.PATCH"; stop at first non-digit per component.
    let mut nums = [0u32; 3];
    let mut idx = 0usize;
    let mut i = 0usize;
    while idx < 3 {
        let start = i;
        while i < release.len() && release[i].is_ascii_digit() {
            nums[idx] = nums[idx].wrapping_mul(10).wrapping_add((release[i] - b'0') as u32);
            i += 1;
        }
        if i == start { break }
        idx += 1;
        if i < release.len() && release[i] == b'.' { i += 1 } else { break }
    }
    let v = Version { major: nums[0], minor: nums[1], patch: nums[2] };
    // Cache; clamp components to 10 bits (kernel versions fit comfortably).
    let p = ((v.major & 0x3ff) << 20) | ((v.minor & 0x3ff) << 10) | (v.patch & 0x3ff);
    CACHE.store(p, Ordering::Relaxed);
    v
}
#[cfg(not(any(target_os = "linux", target_os = "android")))]
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

    #[cfg(unix)]
    static UTSNAME: std::sync::OnceLock<libc::utsname> = std::sync::OnceLock::new();

    /// Process-lifetime cached `uname(2)` result. Several callers
    /// (analytics version probe, crash-handler, kernel-version checks) read
    /// the same struct; cache so the binary issues exactly one syscall.
    #[cfg(unix)]
    #[inline]
    pub fn cached_uname() -> &'static libc::utsname {
        UTSNAME.get_or_init(uname)
    }

    /// Slice up to (excluding) the first NUL byte. Port of Zig `bun.sliceTo(b, 0)`;
    /// re-exported as `bun_string::slice_to_nul`.
    #[inline]
    pub fn slice_to_nul(buf: &[u8]) -> &[u8] {
        &buf[..buf.iter().position(|&b| b == 0).unwrap_or(buf.len())]
    }

    /// Mutable variant of [`slice_to_nul`].
    #[inline]
    pub fn slice_to_nul_mut(buf: &mut [u8]) -> &mut [u8] {
        let n = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        &mut buf[..n]
    }

    /// Heap-allocate a `T` filled with zero bytes. Safe by virtue of the
    /// [`Zeroable`] bound (the all-zero bit pattern is a valid `T`).
    #[inline]
    pub fn boxed_zeroed<T: Zeroable>() -> Box<T> {
        // SAFETY: `T: Zeroable` asserts the all-zero bit pattern is a valid `T`.
        unsafe { Box::<T>::new_zeroed().assume_init() }
    }

    /// Heap-allocate a `T` filled with zero bytes without the [`Zeroable`]
    /// bound. Prefer [`boxed_zeroed`]; this is for orphan-rule cases where the
    /// caller cannot `unsafe impl Zeroable` for a foreign type.
    ///
    /// # Safety
    /// `T` must be valid at the all-zero bit pattern.
    #[inline]
    pub unsafe fn boxed_zeroed_unchecked<T>() -> Box<T> {
        // SAFETY: caller guarantees T is valid at the all-zero bit pattern.
        unsafe { Box::<T>::new_zeroed().assume_init() }
    }

    /// Safe `uname(2)` wrapper: zero-init a `utsname`, call `libc::uname`, return
    /// it by value. On the (theoretical) error path the struct stays all-zero,
    /// so every `c_char[]` field reads as an empty NUL-terminated string.
    #[cfg(unix)]
    #[inline]
    pub fn uname() -> libc::utsname {
        let mut u: libc::utsname = zeroed();
        // SAFETY: `u` is a valid, exclusive pointer to a fully-initialised
        // `utsname`; uname(2) only writes within `sizeof(utsname)`.
        let _ = unsafe { libc::uname(&mut u) };
        u
    }

    /// Borrow a fixed-size `[c_char; N]` C-struct field as `&[u8]`, truncated at
    /// the first NUL (or full length if none). This is the `&[c_char]` analogue
    /// of [`cstr_bytes`] for inline arrays like `utsname::release`.
    #[inline]
    pub fn c_field_bytes(s: &[core::ffi::c_char]) -> &[u8] {
        // SAFETY: `c_char` is `i8`/`u8`; both are byte-sized and every bit
        // pattern is a valid `u8`. Same length, same provenance.
        let b = unsafe { core::slice::from_raw_parts(s.as_ptr().cast::<u8>(), s.len()) };
        &b[..b.iter().position(|&c| c == 0).unwrap_or(b.len())]
    }

    /// All-bits-zero value of `T` for `#[repr(C)]` FFI structs.
    ///
    /// Single audited wrapper over `core::mem::zeroed()` so libc/uv/c-ares
    /// out-param init sites (`let mut x: libc::sigaction = zeroed();`) don't
    /// each open-code an `unsafe` block. This is the Rust spelling of Zig's
    /// `std.mem.zeroes(T)` / `= .{}` for `extern struct`.
    ///
    /// The `T: Zeroable` bound discharges the `mem::zeroed` safety obligation
    /// once per type (at the `unsafe impl`), so callers need no `unsafe`
    /// block. Prefer `T::default()` when `T` implements (or can derive)
    /// `Default` — reserve this for foreign POD where the orphan rule blocks a
    /// `Default` impl (libc, bindgen output) or where `Default` would be wrong
    /// but zero-init matches the C API contract.
    #[inline(always)]
    pub const fn zeroed<T: Zeroable>() -> T {
        // SAFETY: `T: Zeroable` is exactly the assertion that the all-zero bit
        // pattern is a valid `T` (no `NonNull`/`NonZero`/ref/fn-ptr fields, no
        // niche enums). `core::mem::zeroed` is therefore sound for `T`.
        unsafe { core::mem::zeroed() }
    }

    /// Marker: the all-zero bit pattern is a valid value of `Self`.
    ///
    /// Local re-spelling of `bytemuck::Zeroable` so we can blanket-`impl` it
    /// for foreign `libc` POD (orphan rule blocks impl-ing the upstream trait
    /// on `libc::sigaction` et al.). Once a type carries this marker,
    /// [`zeroed`] is a *safe* call — the audit happens once at the `unsafe
    /// impl`, not at every out-param init site.
    ///
    /// # Safety
    /// `Self` must be inhabited at the all-zero bit pattern: no non-nullable
    /// pointers (`&T`, `Box<T>`, `NonNull<T>`, fn ptrs), no `bool`/`char`
    /// outside their valid range, no niche-optimised enums. `#[repr(C)]`
    /// structs of integers, raw pointers, and nested `Zeroable` POD satisfy
    /// this. Padding bytes are fine (zero is a valid padding value).
    pub unsafe trait Zeroable: Sized {}

    /// Unchecked all-bits-zero — escape hatch for types not yet proven
    /// [`Zeroable`] (libuv handles, bindgen structs in `_sys` crates that
    /// don't depend on `bun_core`, generic `T` where the bound can't be
    /// threaded). Prefer [`zeroed`] + an `unsafe impl Zeroable` whenever the
    /// type is reachable.
    ///
    /// # Safety
    /// `T` must be inhabited at the all-zero bit pattern (same contract as
    /// [`Zeroable`], but asserted per-call instead of per-type).
    #[inline(always)]
    pub const unsafe fn zeroed_unchecked<T>() -> T {
        // SAFETY: caller guarantees T is valid at the all-zero bit pattern.
        unsafe { core::mem::zeroed() }
    }

    // ── Zeroable impls ──────────────────────────────────────────────────────
    // Primitives, raw pointers, arrays — match `bytemuck::Zeroable` blankets.
    macro_rules! zeroable_prim {
        ($($t:ty),* $(,)?) => { $( unsafe impl Zeroable for $t {} )* };
    }
    zeroable_prim!(
        (), u8, u16, u32, u64, u128, usize,
        i8, i16, i32, i64, i128, isize, f32, f64,
    );
    // SAFETY: null is a valid raw pointer.
    unsafe impl<T: ?Sized> Zeroable for *const T {}
    // SAFETY: null is a valid raw pointer.
    unsafe impl<T: ?Sized> Zeroable for *mut T {}
    // SAFETY: array of zero-valid elements is zero-valid.
    unsafe impl<T: Zeroable, const N: usize> Zeroable for [T; N] {}

    // libc POD — every field is an integer / raw pointer / nested C POD; the
    // C API contract for each is "zero-init before the kernel/libc fills it".
    // SAFETY: each `unsafe impl` below was audited against the libc crate's
    // struct definition for that target; none contain `NonNull`/`NonZero`/
    // references/fn-ptrs (bare `extern fn` fields in `sigaction` are stored as
    // `usize` sighandler_t on every libc target).
    #[cfg(unix)] unsafe impl Zeroable for libc::sigaction {}
    // `sigset_t` is a `u32` typedef on Darwin (covered by the primitive
    // blanket → E0119 if re-impl'd) but a real struct on Linux/Android
    // (`__val: [c_ulong; 16]`) and FreeBSD (`__bits: [u32; 4]`). Gate the
    // explicit impl to everywhere it's NOT already a primitive.
    #[cfg(all(unix, not(target_vendor = "apple")))]
    unsafe impl Zeroable for libc::sigset_t {}
    #[cfg(unix)] unsafe impl Zeroable for libc::utsname {}
    #[cfg(unix)] unsafe impl Zeroable for libc::winsize {}
    #[cfg(unix)] unsafe impl Zeroable for libc::rlimit {}
    #[cfg(unix)] unsafe impl Zeroable for libc::passwd {}
    #[cfg(unix)] unsafe impl Zeroable for libc::stat {}
    #[cfg(unix)] unsafe impl Zeroable for libc::rusage {}
    #[cfg(unix)] unsafe impl Zeroable for libc::timespec {}
    #[cfg(unix)] unsafe impl Zeroable for libc::timeval {}
    #[cfg(unix)] unsafe impl Zeroable for libc::pollfd {}
    #[cfg(unix)] unsafe impl Zeroable for libc::Dl_info {}
    #[cfg(unix)] unsafe impl Zeroable for libc::sockaddr {}
    #[cfg(unix)] unsafe impl Zeroable for libc::sockaddr_in {}
    #[cfg(unix)] unsafe impl Zeroable for libc::sockaddr_in6 {}
    #[cfg(unix)] unsafe impl Zeroable for libc::sockaddr_storage {}
    #[cfg(unix)] unsafe impl Zeroable for libc::addrinfo {}
    #[cfg(any(target_os = "linux", target_os = "android"))]
    unsafe impl Zeroable for libc::sysinfo {}
    #[cfg(any(target_os = "linux", target_os = "android"))]
    unsafe impl Zeroable for libc::epoll_event {}
    #[cfg(any(target_os = "linux", target_os = "android"))]
    unsafe impl Zeroable for libc::signalfd_siginfo {}
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos", target_os = "freebsd"))]
    unsafe impl Zeroable for libc::statfs {}
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd", target_os = "openbsd", target_os = "netbsd"))]
    unsafe impl Zeroable for libc::kevent {}
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    unsafe impl Zeroable for libc::kevent64_s {}
    #[cfg(target_os = "freebsd")]
    unsafe impl Zeroable for libc::_umtx_time {}

    // Windows POD — `bun_windows_sys` `#[repr(C)]` out-param structs that are
    // zero-init before the kernel fills them. All fields are integers / raw
    // pointers / nested POD; audited against the Win32 SDK headers (S016).
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::IO_STATUS_BLOCK {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::FILE_BASIC_INFORMATION {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::BY_HANDLE_FILE_INFORMATION {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::WIN32_FILE_ATTRIBUTE_DATA {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::OBJECT_ATTRIBUTES {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::UNICODE_STRING {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::SECURITY_ATTRIBUTES {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::FILETIME {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::ws2_32::WSADATA {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::ws2_32::sockaddr_storage {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::ws2_32::sockaddr_in {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::ws2_32::sockaddr_in6 {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::ws2_32::addrinfo {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::IO_COUNTERS {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::JOBOBJECT_BASIC_LIMIT_INFORMATION {}
    #[cfg(windows)] unsafe impl Zeroable for bun_windows_sys::externs::JOBOBJECT_EXTENDED_LIMIT_INFORMATION {}

    /// Conjure a value of a zero-sized type without `unsafe` at the call site.
    ///
    /// This is the monomorphised-ZST-handler trick: a fn item or capture-less
    /// closure has `size_of == 0`, so the empty bit-pattern is its only
    /// (trivially valid) value. The size constraint is a `const { assert! }`,
    /// so passing a non-ZST `H` is a *compile* error at the monomorphisation
    /// site rather than runtime UB — which is what makes this fn safe (S016).
    ///
    /// Replaces the `// SAFETY: H is a ZST → mem::zeroed()` comment repeated
    /// at every callback trampoline that smuggles a generic `H: Fn*` through C
    /// (`uws_sys::thunk`, `sql_jsc::IntoJSHostFn`, `server_body::route_thunk`).
    #[inline(always)]
    pub fn conjure_zst<H>() -> H {
        const {
            assert!(
                core::mem::size_of::<H>() == 0,
                "conjure_zst: H must be a ZST (fn item or capture-less closure)"
            )
        };
        // SAFETY: `size_of::<H>() == 0` (compile-time asserted above), so the
        // value occupies no bytes and `zeroed()` writes nothing. Every call
        // site bounds `H: Fn*` (fn items / capture-less closures), and those
        // are always inhabited — uninhabited ZSTs (`!`, `Infallible`) do not
        // implement the `Fn` traits and so cannot reach a real instantiation.
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

    /// Pointer to the calling thread's libc `errno` (Zig: `std.c._errno()`).
    ///
    /// Single audited cfg-ladder over the per-libc TLS accessor symbol so the
    /// tree has ONE place that knows glibc/musl spell it `__errno_location()`,
    /// bionic spells it `__errno()`, Darwin/BSD spell it `__error()`, and the
    /// Windows CRT spells it `_errno()`. Every higher-tier crate routes through
    /// this — `bun_errno::posix::errno`, `bun_sys::last_errno`,
    /// `bun_sys::c::errno_location`, `bun_platform::linux` — instead of each
    /// re-deriving the same target_os→symbol mapping.
    ///
    /// # Safety
    /// The returned pointer is valid for the calling thread's lifetime; reads
    /// and writes are sound but the caller must not send it across threads.
    #[inline(always)]
    pub unsafe fn errno_ptr() -> *mut core::ffi::c_int {
        #[cfg(target_os = "linux")]
        return unsafe { libc::__errno_location() };
        #[cfg(target_os = "android")]
        return unsafe { libc::__errno() };
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        return unsafe { libc::__error() };
        #[cfg(any(target_os = "freebsd", target_os = "dragonfly"))]
        return unsafe { libc::__error() };
        #[cfg(all(
            unix,
            not(any(
                target_os = "linux",
                target_os = "android",
                target_os = "macos",
                target_os = "ios",
                target_os = "freebsd",
                target_os = "dragonfly"
            ))
        ))]
        return unsafe { libc::__errno_location() };
        #[cfg(windows)]
        {
            // Windows CRT: `int *_errno(void)` — thread-local errno for the
            // C runtime (distinct from Win32 `GetLastError()`).
            unsafe extern "C" { fn _errno() -> *mut core::ffi::c_int; }
            return unsafe { _errno() };
        }
    }

    /// Read the calling thread's libc `errno` (Zig: `std.c._errno().*`).
    /// Safe wrapper over `*errno_ptr()`.
    #[inline(always)]
    pub fn errno() -> core::ffi::c_int {
        // SAFETY: `errno_ptr()` returns a valid thread-local int* for the
        // calling thread's lifetime on every supported target.
        unsafe { *errno_ptr() }
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
    //! Low-tier mirror of `src/safety/asan.zig`. `bun_safety` depends on
    //! `bun_core`, so the implementation lives here and `bun_safety::asan`
    //! re-uses the same `cfg(bun_asan)` gate. Callers in `bun_jsc`,
    //! `bun_runtime`, and `bun_collections` reach the real LSAN/ASAN runtime
    //! through this module — it must NOT be a no-op stub or LSAN root-region
    //! registration (`VirtualMachine::rare_data`, `Listener.group`) silently
    //! does nothing and every malloc-backed `us_socket_t` reachable only via a
    //! mimalloc page is reported as a leak.
    use core::ffi::c_void;

    pub const ENABLED: bool = cfg!(bun_asan);

    #[cfg(bun_asan)]
    unsafe extern "C" {
        fn __asan_poison_memory_region(ptr: *const c_void, size: usize);
        fn __asan_unpoison_memory_region(ptr: *const c_void, size: usize);
        fn __asan_address_is_poisoned(ptr: *const c_void) -> bool;
        fn __asan_describe_address(ptr: *const c_void);
        fn __lsan_register_root_region(ptr: *const c_void, size: usize);
        fn __lsan_unregister_root_region(ptr: *const c_void, size: usize);
    }

    #[inline]
    pub unsafe fn poison(ptr: *const u8, size: usize) {
        #[cfg(bun_asan)]
        {
            // SAFETY: ASAN runtime is linked when this cfg is active; ptr/size
            // describe a region owned by the caller.
            unsafe { __asan_poison_memory_region(ptr.cast(), size) };
        }
        #[cfg(not(bun_asan))]
        let _ = (ptr, size);
    }
    #[inline]
    pub unsafe fn unpoison(ptr: *const u8, size: usize) {
        #[cfg(bun_asan)]
        {
            // SAFETY: see `poison`.
            unsafe { __asan_unpoison_memory_region(ptr.cast(), size) };
        }
        #[cfg(not(bun_asan))]
        let _ = (ptr, size);
    }
    #[inline]
    pub fn poison_slice<T>(s: &[T]) {
        // SAFETY: `s` describes a live region the caller owns.
        unsafe { poison(s.as_ptr().cast(), core::mem::size_of_val(s)) }
    }
    #[inline]
    pub fn unpoison_slice<T>(s: &[T]) {
        // SAFETY: `s` describes a live region the caller owns.
        unsafe { unpoison(s.as_ptr().cast(), core::mem::size_of_val(s)) }
    }
    #[inline]
    pub fn assert_unpoisoned<T>(ptr: *const T) {
        #[cfg(bun_asan)]
        {
            // SAFETY: ASAN runtime is linked; reads shadow memory only.
            if unsafe { __asan_address_is_poisoned(ptr.cast()) } {
                // SAFETY: diagnostic-only, prints to stderr.
                unsafe { __asan_describe_address(ptr.cast()) };
                panic!("Address is poisoned");
            }
        }
        #[cfg(not(bun_asan))]
        let _ = ptr;
    }
    /// Tell LSAN to scan `[ptr, ptr+size)` for live pointers during leak
    /// checking. Needed when a malloc-backed object is reachable only through
    /// a pointer that itself lives inside a mimalloc page (which LSAN does not
    /// scan).
    #[inline]
    pub fn register_root_region(ptr: *const c_void, size: usize) {
        #[cfg(bun_asan)]
        {
            // SAFETY: LSAN runtime is linked alongside ASAN.
            unsafe { __lsan_register_root_region(ptr, size) };
        }
        #[cfg(not(bun_asan))]
        let _ = (ptr, size);
    }
    /// Undo a prior `register_root_region(ptr, size)` with identical arguments.
    #[inline]
    pub fn unregister_root_region(ptr: *const c_void, size: usize) {
        #[cfg(bun_asan)]
        {
            // SAFETY: must match a prior register_root_region (caller invariant).
            unsafe { __lsan_unregister_root_region(ptr, size) };
        }
        #[cfg(not(bun_asan))]
        let _ = (ptr, size);
    }
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
    unsafe extern "C" {
        // Pure FFI into Bun's C++ bindings; no arguments, no invariants.
        safe fn Bun__ramSize() -> usize;
    }
    Bun__ramSize()
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

/// Safe wrapper over the cfg-gated `Bun__captureStackTrace` definitions above.
/// Single canonical entry point — `StoredTrace::capture` and
/// `bun_crash_handler::debug::capture_stack_trace` both route through this so
/// no caller re-declares the `extern "C"` import.
#[inline]
pub fn capture_stack_trace(begin: usize, addrs: &mut [usize]) -> usize {
    // Direct Rust call into the same-crate `extern "C" fn` above (not an FFI
    // import), so no `unsafe` needed; the impl writes at most `addrs.len()` words.
    Bun__captureStackTrace(begin, addrs.as_mut_ptr(), addrs.len())
}

/// Zig `@returnAddress()` placeholder. Rust has no stable equivalent; `0` tells
/// `capture_stack_trace` "start from here". Lives in bun_core so the canonical
/// `StoredTrace::capture` can call it; once wired to a real intrinsic, every
/// caller (incl. `bun_crash_handler::debug::return_address`) picks it up.
#[inline(always)]
pub fn return_address() -> usize { 0 }

/// Ports of `std.debug.{SourceLocation,SymbolInfo}` — pure data structs shared by
/// crash_handler's stub `debug` mod and btjs's `zig_std_debug`. Neither of those
/// crates can depend on the other, so the canonical home is here (alongside
/// `capture_stack_trace`/`return_address`) pending a dedicated `bun_debug` crate.
pub mod debug {
    /// Zig: `std.debug.SourceLocation`.
    #[derive(Clone)]
    pub struct SourceLocation {
        pub file_name: Box<[u8]>,
        pub line: u32,
        pub column: u32,
    }

    /// Zig: `std.debug.SymbolInfo`.
    pub struct SymbolInfo {
        pub name: Box<[u8]>,
        pub compile_unit_name: Box<[u8]>,
        pub source_location: Option<SourceLocation>,
    }
}
