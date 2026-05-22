use crate::once::Once;
use crate::racy_cell::RacyCell;
use crate::zstr::{ZBox, ZStr};

// ── argv ──────────────────────────────────────────────────────────────────
// `bun.argv` — process argv as a slice of NUL-terminated byte strings.
// Zig: `pub var argv: [][:0]const u8`. The owned `ZBox` backing for the
// initial OS argv lives in `ARGV_STORAGE`; `ARGV` is the mutable *view*
// slice that call sites read (and that `set_argv` swaps for the
// `--compile` exec-argv splicing path in `cli.zig`). Exposed via a tiny
// `Argv` wrapper so call sites can use it both as a slice (`.get(0)`,
// `.iter()`, `.len()`, `.as_slice()`) and as an `IntoIterator<Item = &[u8]>`
// for `for arg in argv()`.
static ARGV_STORAGE: Once<Vec<ZBox>> = Once::new();
static ARGV_VIEW: Once<Vec<&'static ZStr>> = Once::new();
static ARGV: RacyCell<&'static [&'static ZStr]> = RacyCell::new(&[]);
static ARGV_INIT: std::sync::Once = std::sync::Once::new();

/// Raw `(argc, argv)` as passed to `main` by the C runtime. Captured by
/// [`init_argv`] before any other code runs. On glibc / macOS / Windows,
/// libstd captures argv independently via a `.init_array` constructor /
/// `_NSGetArgv` / `GetCommandLineW`, so `std::env::args_os()` works without
/// this; on **musl-static** the `.init_array` constructor is invoked with no
/// arguments (musl's `__libc_start_main` does not forward `(argc,argv,envp)`
/// to constructors), so `std::env::args_os()` returns empty and we must read
/// the kernel-provided block ourselves. Zig's `_start` writes `std.os.argv`
/// directly from the stack — this is the equivalent for a clang-linked
/// `extern "C" fn main`.
static OS_ARGC: core::sync::atomic::AtomicUsize = core::sync::atomic::AtomicUsize::new(0);
static OS_ARGV: core::sync::atomic::AtomicPtr<*const core::ffi::c_char> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

/// Capture the raw `argc`/`argv` passed to `main` by the C runtime. Must be
/// the very first call in `main`, before the crash handler (whose panic path
/// dumps the command line) or anything else that might call [`argv()`].
///
/// Matches Zig `bun.initArgv` which on POSIX wraps `std.os.argv` (set by
/// Zig's own `_start` from the kernel-provided argv block).
///
/// # Safety
/// `argv` must point to `argc` valid NUL-terminated C strings that live for
/// the entire process (the kernel/crt argv block does). Calling this after
/// [`argv()`] has been observed is a logic error — the `Once` slot will
/// already have been populated from the fallback path.
pub unsafe fn init_argv(argc: core::ffi::c_int, argv: *const *const core::ffi::c_char) {
    OS_ARGC.store(argc.max(0) as usize, core::sync::atomic::Ordering::Relaxed);
    OS_ARGV.store(argv.cast_mut(), core::sync::atomic::Ordering::Relaxed);
}

/// Kernel-provided argv slice if [`init_argv`] was called, else `None`.
#[inline]
#[cfg(not(windows))]
fn raw_os_argv() -> Option<&'static [*const core::ffi::c_char]> {
    let p = OS_ARGV.load(core::sync::atomic::Ordering::Relaxed);
    if p.is_null() {
        return None;
    }
    let n = OS_ARGC.load(core::sync::atomic::Ordering::Relaxed);
    // SAFETY: `init_argv` contract — `p` points to `n` C-string pointers that
    // live for the process lifetime.
    Some(unsafe { core::slice::from_raw_parts(p, n) })
}

pub(crate) fn argv_storage() -> &'static [ZBox] {
    ARGV_STORAGE.get_or_init(|| {
        // Windows: the CRT-provided `char** argv` captured by `init_argv` is
        // ANSI-encoded (CP_ACP) — `WideCharToMultiByte` lossy-converts the
        // UTF-16 command line, replacing unrepresentable code points with `?`.
        // Zig's `initArgv` (bun.zig) goes straight to `GetCommandLineW` +
        // `CommandLineToArgvW` and converts each UTF-16 arg to WTF-8 itself;
        // do the same here so non-ASCII argv (e.g. `bun -e "🌊 测试"`)
        // round-trips. See https://github.com/oven-sh/bun/issues/11610.
        #[cfg(windows)]
        {
            use bun_windows_sys::externs::{CommandLineToArgvW, GetCommandLineW};
            let mut argc: core::ffi::c_int = 0;
            // SAFETY: `GetCommandLineW` returns a process-static buffer;
            // `CommandLineToArgvW` allocates its own array (lifetime managed
            // by the system per Zig spec — intentionally not `LocalFree`d, the
            // argv strings are referenced for the process lifetime).
            let argvw = unsafe { CommandLineToArgvW(GetCommandLineW(), &mut argc) };
            if !argvw.is_null() {
                let argc = argc.max(0) as usize;
                // SAFETY: `CommandLineToArgvW` returned `argc` valid `LPWSTR`s.
                let argvw = unsafe { core::slice::from_raw_parts(argvw, argc) };
                return argvw
                    .iter()
                    .map(|&p| {
                        // SAFETY: each entry is a NUL-terminated UTF-16 string
                        // owned by the `CommandLineToArgvW` allocation.
                        let arg = unsafe { crate::ffi::wstr_units(p) };
                        ZBox::from_vec(crate::strings::to_utf8_alloc(arg))
                    })
                    .collect();
            }
            // Fall through to `args_os` if `CommandLineToArgvW` failed (OOM /
            // INVAL) — Zig returns an error there; we degrade to libstd's
            // own `GetCommandLineW`-backed parser instead of aborting.
        }
        #[cfg(not(windows))]
        if let Some(raw) = raw_os_argv() {
            return raw
                .iter()
                .map(|&p| {
                    // SAFETY: kernel argv entries are NUL-terminated and live
                    // for the process; `init_argv` guarantees `p` is valid.
                    let s = unsafe { core::ffi::CStr::from_ptr(p) };
                    ZBox::from_bytes(s.to_bytes())
                })
                .collect();
        }
        // Fallback for entry points that don't go through `extern "C" fn main`
        // (e.g. `cargo test` harness, Rust `fn main()` via `lang_start`). On
        // glibc/macOS/Windows this also works for the real binary — only
        // musl-static needs the `raw_os_argv` path above.
        std::env::args_os()
            .map(|a| ZBox::from_vec_with_nul(a.into_encoded_bytes()))
            .collect()
    })
}

#[cold]
#[inline(never)]
fn argv_view_init() {
    let storage: &'static [ZBox] = argv_storage();
    // ARGV_STORAGE is process-static via `Once`; `as_zstr` borrows for `'static`.
    let mut view: Vec<&'static ZStr> = storage.iter().map(ZBox::as_zstr).collect();
    // Zig `initArgv`: splice BUN_OPTIONS tokens after argv[0].
    if let Some(opts) = crate::env_var::BUN_OPTIONS.get() {
        let original_len = view.len();
        append_options_env::<&'static ZStr>(opts, &mut view);
        set_bun_options_argc(view.len() - original_len);
    }
    let view: &'static [&'static ZStr] = ARGV_VIEW.get_or_init(move || view);
    // SAFETY: single-threaded lazy init guarded by Once.
    unsafe { ARGV.write(view) };
}

#[inline]
fn argv_view() -> &'static [&'static ZStr] {
    ARGV_INIT.call_once(argv_view_init);
    // SAFETY: ARGV is a Copy fat-pointer; only mutated via `set_argv` during
    // single-threaded startup or by the Once above.
    unsafe { ARGV.read() }
}

#[derive(Clone, Copy)]
pub struct Argv(&'static [&'static ZStr]);
impl Argv {
    #[inline]
    pub fn len(&self) -> usize {
        self.0.len()
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    #[inline]
    pub fn get(&self, i: usize) -> Option<&'static ZStr> {
        self.0.get(i).copied()
    }
    #[inline]
    pub fn iter(&self) -> ArgvIter {
        ArgvIter {
            inner: self.0,
            i: 0,
        }
    }
    /// Borrow the underlying `[&ZStr]` view (Zig: `bun.argv[..]`).
    #[inline]
    pub fn as_slice(&self) -> &'static [&'static ZStr] {
        self.0
    }
    /// Owned `Vec` copy of the view — used by call sites that need to append
    /// (e.g. `--compile` exec-argv splicing) before leaking + `set_argv`.
    #[inline]
    pub fn to_vec(&self) -> Vec<&'static ZStr> {
        self.0.to_vec()
    }
}
impl IntoIterator for Argv {
    type Item = &'static [u8];
    type IntoIter = ArgvIter;
    #[inline]
    fn into_iter(self) -> ArgvIter {
        self.iter()
    }
}
pub struct ArgvIter {
    inner: &'static [&'static ZStr],
    i: usize,
}
impl Iterator for ArgvIter {
    type Item = &'static [u8];
    #[inline]
    fn next(&mut self) -> Option<&'static [u8]> {
        let z = *self.inner.get(self.i)?;
        self.i += 1;
        Some(z.as_bytes())
    }
}

/// `bun.argv` accessor.
#[inline]
pub fn argv() -> Argv {
    Argv(argv_view())
}

// ─── BUN_OPTIONS argv injection (bun.zig: bun_options_argc / appendOptionsEnv) ──
/// Number of arguments injected into `argv` by the `BUN_OPTIONS` environment
/// variable. Set once during single-threaded startup (`init_argv`).
static BUN_OPTIONS_ARGC: core::sync::atomic::AtomicUsize = core::sync::atomic::AtomicUsize::new(0);

/// Zig: `bun.bun_options_argc` — read accessor.
///
/// Forces the lazy `argv_view()` init before reading: in Zig `initArgv()`
/// runs eagerly in `main()` so `bun.bun_options_argc` is always populated by
/// the time `cli.zig` reads it; here `argv()` is lazy, so a caller that reads
/// `bun_options_argc()` *before* `argv()` (e.g. the standalone-executable
/// path in `Command::start`) would otherwise see 0 and miscount the
/// BUN_OPTIONS-injected args when computing the passthrough offset.
#[inline]
pub fn bun_options_argc() -> usize {
    let _ = argv_view();
    BUN_OPTIONS_ARGC.load(core::sync::atomic::Ordering::Relaxed)
}
/// Zig: `bun.bun_options_argc = n` — write accessor (single-threaded startup).
#[inline]
pub fn set_bun_options_argc(n: usize) {
    BUN_OPTIONS_ARGC.store(n, core::sync::atomic::Ordering::Relaxed);
}

/// Trait for arg types accepted by [`append_options_env`] (replaces Zig
/// `comptime ArgType` in `bun.appendOptionsEnv`). Impl'd for `bun_core::String`
/// and `Box<ZStr>` in their owning crates.
pub trait OptionsEnvArg {
    fn from_slice(s: &[u8]) -> Self;
    fn from_buf(buf: Vec<u8>) -> Self;
}

/// Zig `[:0]const u8` arm of `appendOptionsEnv`: `default_allocator.allocSentinel`
/// + never freed (process-lifetime argv storage). The leaked allocation matches
/// the Zig alloc/free pairing exactly — argv entries live for the process.
impl OptionsEnvArg for &'static ZStr {
    fn from_slice(s: &[u8]) -> Self {
        let mut v = Vec::with_capacity(s.len() + 1);
        v.extend_from_slice(s);
        v.push(0);
        let z: &'static [u8] = v.leak();
        ZStr::from_slice_with_nul(z)
    }
    fn from_buf(mut buf: Vec<u8>) -> Self {
        buf.push(0);
        let z: &'static [u8] = buf.leak();
        ZStr::from_slice_with_nul(z)
    }
}

/// Owned `Box<ZStr>` arm of `appendOptionsEnv` — used by `bun::init_argv`'s
/// BUN_OPTIONS splice path, which stores argv entries as `Box<ZStr>`.
impl OptionsEnvArg for Box<ZStr> {
    fn from_slice(s: &[u8]) -> Self {
        ZStr::boxed(s)
    }
    fn from_buf(mut buf: Vec<u8>) -> Self {
        buf.push(0);
        let b: Box<[u8]> = buf.into_boxed_slice();
        // SAFETY: `ZStr` is `#[repr(transparent)]` over `[u8]`; the fat-pointer
        // metadata (len includes the trailing NUL) is preserved by the cast —
        // identical to `ZStr::boxed` but consuming the Vec without re-copying.
        unsafe { crate::heap::take(crate::heap::into_raw(b) as *mut ZStr) }
    }
}

/// Zig: `bun.appendOptionsEnv` — parse a `BUN_OPTIONS`-style string
/// (`--flag=value --flag2 "quoted value" bare`) and insert each token into
/// `args` starting at index 1 (Zig callers prepend a placeholder at [0]).
pub fn append_options_env<A: OptionsEnvArg>(env: &[u8], args: &mut Vec<A>) {
    let mut i: usize = 0;
    let mut offset_in_args: usize = 1;
    while i < env.len() {
        // skip whitespace
        while i < env.len() && env[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= env.len() {
            break;
        }

        // Handle all command-line arguments with quotes preserved
        let start = i;
        let mut j = i;

        // Check if this is an option (starts with --)
        let is_option = j + 2 <= env.len() && env[j] == b'-' && env[j + 1] == b'-';

        if is_option {
            // Find the end of the option flag (--flag)
            while j < env.len() && !env[j].is_ascii_whitespace() && env[j] != b'=' {
                j += 1;
            }

            let end_of_flag = j;
            let mut found_equals = false;

            // Check for equals sign
            if j < env.len() && env[j] == b'=' {
                found_equals = true;
                j += 1; // Move past the equals sign
            } else if j < env.len() && env[j].is_ascii_whitespace() {
                j += 1; // Move past the space
                while j < env.len() && env[j].is_ascii_whitespace() {
                    j += 1;
                }
            }

            // Handle quoted values
            if j < env.len() && (env[j] == b'\'' || env[j] == b'"') {
                let quote_char = env[j];
                j += 1; // Move past opening quote
                while j < env.len() && env[j] != quote_char {
                    j += 1;
                }
                if j < env.len() {
                    j += 1; // Move past closing quote
                }
            } else if found_equals {
                // If we had --flag=value (no quotes), find next whitespace
                while j < env.len() && !env[j].is_ascii_whitespace() {
                    j += 1;
                }
            } else {
                // No value found after flag (e.g., `--flag1 --flag2`).
                j = end_of_flag;
            }

            // Copy the entire argument including quotes
            args.insert(offset_in_args, A::from_slice(&env[start..j]));
            offset_in_args += 1;

            i = j;
            continue;
        }

        // Non-option arguments or standalone values
        let mut buf: Vec<u8> = Vec::new();

        let mut in_single = false;
        let mut in_double = false;
        let mut escape = false;
        while i < env.len() {
            let ch = env[i];
            if escape {
                buf.push(ch);
                escape = false;
                i += 1;
                continue;
            }
            if ch == b'\\' {
                escape = true;
                i += 1;
                continue;
            }
            if in_single {
                if ch == b'\'' {
                    in_single = false;
                } else {
                    buf.push(ch);
                }
                i += 1;
                continue;
            }
            if in_double {
                if ch == b'"' {
                    in_double = false;
                } else {
                    buf.push(ch);
                }
                i += 1;
                continue;
            }
            if ch == b'\'' {
                in_single = true;
            } else if ch == b'"' {
                in_double = true;
            } else if ch.is_ascii_whitespace() {
                break;
            } else {
                buf.push(ch);
            }
            i += 1;
        }

        args.insert(offset_in_args, A::from_buf(buf));
        offset_in_args += 1;
    }
}

/// `bun.argv = slice` — swap the global argv view. Zig assigns the slice
/// directly (`bun.argv = full_argv[0..n]`); call sites are single-threaded
/// startup (CLI parsing in the `--compile` path), so this writes the static
/// without synchronization.
///
/// # Safety
/// Caller must ensure no concurrent reads of `argv()` are in flight.
#[inline]
pub unsafe fn set_argv(v: &'static [&'static ZStr]) {
    // Prevent the lazy OS-argv init from later clobbering a manually-set view.
    ARGV_INIT.call_once(|| {});
    // SAFETY: see fn doc — single-threaded startup.
    unsafe { ARGV.write(v) };
}

/// Park an owned argv `Vec` in process-static storage and return the
/// now-`'static` slice. Used by the `--compile` exec-argv splice path
/// (`cli_body.rs`) which needs to extend argv beyond the original
/// OS-provided storage and then hand sub-slices to [`set_argv`]. Single-shot:
/// the slot is a `Once`, so a second call drops `v` and returns the
/// first-stored slice.
pub fn intern_argv(v: Vec<&'static ZStr>) -> &'static [&'static ZStr] {
    static SLOT: Once<Box<[&'static ZStr]>> = Once::new();
    SLOT.get_or_init(move || v.into_boxed_slice())
}
