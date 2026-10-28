// bun_alloc is the T0 foundation crate that bun_threading and bun_collections
// depend on; importing either to satisfy the disallowed-types lint would create
// a dependency cycle.
#![allow(clippy::disallowed_types)]
#![feature(arbitrary_self_types_pointers)]
#![feature(allocator_api)]
// `#[thread_local]` (vs the `thread_local!` macro) compiles to a bare
// `__thread` slot — single `mov reg, fs:[OFFSET]` access, no `LocalKey`
// `__getit()` wrapper, no lazy-init flag check, no dtor-registration probe.
// Used for the per-allocation hot-path TLS in `ast_alloc::AST_ALLOC`.
#![feature(thread_local)]

use core::cell::UnsafeCell;
use core::mem::{MaybeUninit, size_of};
use core::ptr::{NonNull, addr_of_mut};
use core::sync::atomic::{AtomicPtr, AtomicU32, Ordering};
use std::collections::HashMap;

// ──────────────────────────────────────────────────────────────────────────
// Re-exports
// ──────────────────────────────────────────────────────────────────────────

pub use bun_mimalloc_sys::mimalloc;
pub mod c_thunks;

// ── Allocator vtable ───────────────────────────────────────────────────────
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Alignment(pub u8); // log2 of byte alignment
impl Alignment {
    #[inline]
    pub(crate) const fn from_byte_units(b: usize) -> Self {
        Self(b.trailing_zeros() as u8)
    }
}

// ── `max_align_t` alignment ────────────────────────────────────────────────
// The `libc` crate does not expose `max_align_t` on every target Bun ships
// (missing on Windows MSVC and on FreeBSD aarch64), so those targets carry a
// local mirror of `max_align_t`. Remaining non-Windows targets keep
// `libc::max_align_t` (which carries `long double`, align 16 on x86_64/aarch64;
// the {f64,i64,*const ()} fallback would silently downgrade to 8).
#[cfg(windows)]
#[repr(C)]
struct MaxAlignT {
    _f: f64,
    _i: i64,
    _p: *const (),
}
#[cfg(windows)]
pub(crate) const MAX_ALIGN_T: usize = core::mem::align_of::<MaxAlignT>();
// On AArch64
// AAPCS64 `long double` is IEEE binary128, 16-byte aligned. The `libc` crate
// only defines `max_align_t` for FreeBSD on x86_64, so hardcode the ABI value
// for the aarch64 port.
#[cfg(all(target_os = "freebsd", target_arch = "aarch64"))]
pub(crate) const MAX_ALIGN_T: usize = 16;
#[cfg(not(any(windows, all(target_os = "freebsd", target_arch = "aarch64"))))]
pub(crate) const MAX_ALIGN_T: usize = core::mem::align_of::<libc::max_align_t>();

pub struct AllocatorVTable {
    pub free: unsafe fn(*mut core::ffi::c_void, &mut [u8], Alignment, usize),
}
impl AllocatorVTable {
    /// Each call site keeps its own `static`: the vtable address is the `is_instance` tag.
    pub const fn free_only(
        free: unsafe fn(*mut core::ffi::c_void, &mut [u8], Alignment, usize),
    ) -> Self {
        Self { free }
    }
}

/// Fat allocator handle (ptr + vtable). Distinct from the `Allocator` trait below.
#[derive(Clone, Copy)]
pub struct StdAllocator {
    pub ptr: *mut core::ffi::c_void,
    pub vtable: &'static AllocatorVTable,
}

// SAFETY: `ptr` is an opaque tag/context handle; the vtable is `&'static`.
// Thread-safety of dispatch is the implementor's concern (mimalloc is
// thread-safe).
unsafe impl Send for StdAllocator {}
// SAFETY: see the `Send` impl directly above.
unsafe impl Sync for StdAllocator {}

impl Default for StdAllocator {
    /// The mimalloc-backed `c_allocator`.
    #[inline]
    fn default() -> Self {
        basic::C_ALLOCATOR
    }
}

impl StdAllocator {
    #[inline]
    pub(crate) fn raw_free(&self, buf: &mut [u8], alignment: Alignment, ra: usize) {
        // SAFETY: vtable invariant — `free` callee respects the (ptr, buf, alignment, ra) contract.
        unsafe { (self.vtable.free)(self.ptr, buf, alignment, ra) }
    }
    /// `raw_free` with `ret_addr = 0`, byte-aligned.
    #[inline]
    pub fn free(&self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        // SAFETY: `bytes` is reborrowed mutably only for the vtable signature; the
        // callee treats it as opaque.
        let buf =
            unsafe { core::slice::from_raw_parts_mut(bytes.as_ptr().cast_mut(), bytes.len()) };
        self.raw_free(buf, Alignment::from_byte_units(1), 0);
    }
}

// PORTING.md §Allocators: AST crates thread an `Arena`; non-AST use Vec/Box
// (global mimalloc). `Arena` is the real per-heap `MimallocArena` — unlike
// `bumpalo::Bump`, it supports per-allocation free + realloc, so `ArenaVec`
// no longer leaks on grow.
pub use mimalloc_arena::MimallocArena;
pub type Arena = MimallocArena;
mod baby_vec;
pub use baby_vec::BabyVec;
mod arena_box;
pub use arena_box::ArenaBox;
/// Arena-backed `Vec` with `u32` length/capacity.
/// 24 B (vs 32 B for `Vec<T, &'a MimallocArena>`); the
/// allocator handle is kept inline for lifetime checking. Growth/free route
/// through `<&MimallocArena as Allocator>` (= `mi_heap_realloc_aligned` /
/// `mi_free`); reclaimed on arena `reset`/`Drop`.
pub type ArenaVec<'a, T> = BabyVec<'a, T>;
pub use mimalloc_arena::{ArenaString, ArenaVecExt};

/// `bumpalo::collections::Vec::from_iter_in` parity for [`ArenaVec`].
#[inline]
pub fn vec_from_iter_in<'a, T, I>(iter: I, arena: &'a MimallocArena) -> ArenaVec<'a, T>
where
    I: IntoIterator<Item = T>,
{
    let iter = iter.into_iter();
    let (lo, _) = iter.size_hint();
    let mut v = ArenaVec::with_capacity_in(lo, arena);
    v.extend(iter);
    v
}

/// Re-tag an [`ArenaVec`]'s allocator handle to `dst` without copying data.
///
/// Sound because `<&MimallocArena as Allocator>` is heap-agnostic on the
/// existing buffer:
/// - `deallocate` → `mi_free(ptr)`: looks up the owning heap from the pointer's
///   page metadata; works from any thread on any heap's allocation.
/// - `grow`/`shrink` → `mi_heap_realloc_aligned(dst, ptr, ..)`: returns `ptr`
///   in-place if it fits (read-only `mi_usable_size`), else allocs on `dst`,
///   `memcpy`s, then `mi_free(ptr)`.
///
/// The original arena is never `mi_heap_malloc`-ed from again via this `Vec`,
/// so the [`MimallocArena`] single-thread-alloc contract is preserved.
#[inline]
pub fn transfer_arena<'a, T>(v: &mut ArenaVec<'a, T>, dst: &'a MimallocArena) {
    v.set_allocator(dst);
}

/// `bumpalo::format!` parity — `arena_format!(in arena, "...", ..)` →
/// [`ArenaString`].
#[macro_export]
macro_rules! arena_format {
    (in $arena:expr, $($arg:tt)*) => {{
        let mut __s = $crate::ArenaString::new_in($arena);
        ::core::fmt::Write::write_fmt(&mut __s, ::core::format_args!($($arg)*))
            .expect("ArenaString::write_fmt is infallible");
        __s
    }};
}

/// `bun.use_mimalloc` — false under ASAN, where the global allocator is `std::alloc::System`.
pub const USE_MIMALLOC: bool = cfg!(not(bun_asan));

// ── Allocator-vtable modules: per-module disposition (PORTING.md §Allocators) ──
//
//   MimallocArena            → prefer `bun_alloc::Arena` (= bumpalo::Bump)
//   MaxHeapAllocator         → debug-only cap (single-allocation arena)
//   heap_breakdown           → macOS malloc_zone_* per-tag heaps (debug builds)
//   basic                    → `impl GlobalAlloc for Mimalloc` above is the canonical impl
//
//   LinuxMemFdAllocator, MimallocArena (the vtable impl)
//   import bun_core/sys/runtime/collections and so live in
//   `bun_runtime::allocators`; callers import from
//   there directly.
//
#[path = "MaxHeapAllocator.rs"]
pub mod max_heap_allocator;
pub mod stack_fallback;

/// Raw alloc/free matching the `#[global_allocator]` (`mi_*` normally, libc under ASAN).
pub mod default_alloc {
    use core::ffi::c_void;

    #[inline]
    pub fn malloc(size: usize) -> *mut c_void {
        if cfg!(bun_asan) {
            // SAFETY: `libc::malloc` has no input preconditions; null on failure.
            unsafe { libc::malloc(size) }
        } else {
            crate::mimalloc::mi_malloc(size)
        }
    }

    /// # Safety
    /// `ptr` must be null or a live allocation from the default allocator.
    #[inline]
    pub unsafe fn realloc(ptr: *mut c_void, new_size: usize) -> *mut c_void {
        if cfg!(bun_asan) {
            // SAFETY: caller guarantees `ptr` is null or a live libc allocation
            // (the default allocator under ASAN).
            unsafe { libc::realloc(ptr, new_size) }
        } else {
            // SAFETY: caller guarantees `ptr` is null or a live mimalloc allocation.
            unsafe { crate::mimalloc::mi_realloc(ptr, new_size) }
        }
    }

    /// # Safety
    /// `ptr` must be null or a live allocation from the default allocator.
    #[inline]
    pub unsafe fn free(ptr: *mut c_void) {
        if cfg!(bun_asan) {
            // SAFETY: caller guarantees `ptr` is null or a live libc allocation
            // (the default allocator under ASAN).
            unsafe { libc::free(ptr) }
        } else {
            // SAFETY: caller guarantees `ptr` is null or a live mimalloc allocation.
            unsafe { crate::mimalloc::mi_free(ptr) }
        }
    }

    /// # Safety
    /// `ptr` must be null or a live allocation from the default allocator.
    #[inline]
    pub unsafe fn usable_size(ptr: *const c_void) -> usize {
        if ptr.is_null() {
            return 0;
        }
        // Under `bun_asan` the global allocator is `std::alloc::System`, so the
        // size must come from libc, not mimalloc — and the symbol differs per
        // OS (`malloc_usable_size` on Linux, `malloc_size` on macOS). `bun_asan`
        // is only ever set on Linux or macOS, so the catch-all (non-asan, every
        // `check-all` target including Windows) stays on mimalloc.
        #[cfg(all(bun_asan, target_os = "linux"))]
        return unsafe { libc::malloc_usable_size(ptr.cast_mut()) };
        #[cfg(all(bun_asan, target_os = "macos"))]
        return unsafe { libc::malloc_size(ptr) };
        // SAFETY: caller guarantees `ptr` is a live mimalloc allocation (the
        // non-null check above already handled null).
        #[cfg(not(any(all(bun_asan, target_os = "linux"), all(bun_asan, target_os = "macos"))))]
        return unsafe { crate::mimalloc::mi_usable_size(ptr) };
    }
}

pub use max_heap_allocator::MaxHeapAllocator;
pub use stack_fallback::ArenaPtr;

#[path = "MimallocArena.rs"]
pub mod mimalloc_arena;

pub mod ast_alloc;
pub use ast_alloc::{AstAlloc, AstBox, AstVec, ast_box};
mod hashbrown_bridge;
/// Re-export so `bun_collections` can name the polyfill trait in
/// `StringHashMap`'s `A` bound without taking its own direct dep on
/// `allocator-api2`.
pub use allocator_api2::alloc::Allocator as HashbrownAllocator;

// ── tier-0 local primitives ───────────────────────────────────────────────
// Real, self-contained helpers used by the BSS containers below. These are the
// canonical tier-0 definitions, re-exported by higher tiers (`bun_paths::SEP_STR`,
// `bun_core::strings::trim_right`, `bun_core::strings::trim_right`).

/// `"\\"` on Windows, `"/"` elsewhere.
/// Canonical tier-0 definition; re-exported by `bun_paths::SEP_STR`.
pub const SEP_STR: &str = if cfg!(windows) { "\\" } else { "/" };

/// `b'\\'` on Windows, `b'/'` elsewhere.
/// Canonical tier-0 definition; re-exported by `bun_paths::SEP` / `bun_core::SEP`.
pub const SEP: u8 = if cfg!(windows) { b'\\' } else { b'/' };

/// Canonical tier-0 definition; re-exported by `bun_core::strings::trim_right`.
#[inline]
pub fn trim_right<'a>(s: &'a [u8], chars: &[u8]) -> &'a [u8] {
    let mut end = s.len();
    while end > 0 && chars.contains(&s[end - 1]) {
        end -= 1;
    }
    &s[..end]
}

/// Canonical tier-0 definition; re-exported by `bun_core::strings::trim_left`.
#[inline]
pub fn trim_left<'a>(s: &'a [u8], chars: &[u8]) -> &'a [u8] {
    let mut begin = 0usize;
    while begin < s.len() && chars.contains(&s[begin]) {
        begin += 1;
    }
    &s[begin..]
}

/// Strip `chars` from both ends.
/// Canonical tier-0 definition; re-exported by `bun_core::strings::trim`.
#[inline]
pub fn trim<'a>(s: &'a [u8], chars: &[u8]) -> &'a [u8] {
    trim_right(trim_left(s, chars), chars)
}

// ─── ascii-lowercase helpers ──────────────────────────────────────────────
// Sunk from bun_core::strings so bun_alloc::BSSList::append_lower_case can call
// them without a dep cycle (bun_core → bun_alloc, not the reverse).
// `bun_core::strings` re-exports `copy_lowercase` and `ascii_lowercase_buf`.

/// ASCII-lowercase
/// `in_` into `out` (which must be at least `in_.len()`), returning the
/// written prefix. Memcpy-runs + per-uppercase-byte fixup; identical output
/// to a byte-at-a-time `to_ascii_lowercase` zip.
pub fn copy_lowercase<'a>(in_: &[u8], out: &'a mut [u8]) -> &'a [u8] {
    let mut in_slice = in_;
    // Reshaped for borrowck — track output offset instead of reslicing &mut.
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

/// Lowercase `input` into a fresh `[u8; N]` stack buffer, returning
/// `Some((buf, input.len()))` or `None` if `input.len() > N`. The unused tail
/// of `buf` is zero-filled. Covers the ubiquitous "lowercase a short key into
/// a stack buffer, then look it up in a length-gated map" pattern.
#[inline]
pub fn ascii_lowercase_buf<const N: usize>(input: &[u8]) -> Option<([u8; N], usize)> {
    if input.len() > N {
        return None;
    }
    let mut buf = [0u8; N];
    copy_lowercase(input, &mut buf[..input.len()]);
    Some((buf, input.len()))
}

/// Wrap a raw allocator pointer in the `Result<NonNull<[u8]>, AllocError>`
/// shape `core::alloc::Allocator` wants. Null → `Err(AllocError)`. Generic
/// over the pointee so mimalloc's `*mut c_void` returns pass straight in.
#[inline(always)]
pub(crate) fn alloc_result<T>(
    p: *mut T,
    size: usize,
) -> core::result::Result<NonNull<[u8]>, core::alloc::AllocError> {
    NonNull::new(p.cast::<u8>())
        .map(|p| NonNull::slice_from_raw_parts(p, size))
        .ok_or(core::alloc::AllocError)
}

/// Number of bytes the formatted args would produce.
///
/// Drives a discarding `fmt::Write` that only sums `s.len()` — no allocation,
/// no UTF-8 validation beyond what the formatter already did. Lives here in
/// T0 so higher tiers (`bun_core::fmt::count` re-exports this) and `bun_alloc`
/// itself can share the single implementation.
#[inline]
pub fn fmt_count(args: core::fmt::Arguments<'_>) -> usize {
    struct Discarding(usize);
    impl core::fmt::Write for Discarding {
        #[inline]
        fn write_str(&mut self, s: &str) -> core::fmt::Result {
            self.0 += s.len();
            Ok(())
        }
    }
    let mut w = Discarding(0);
    // Infallible: our `write_str` never errors.
    let _ = core::fmt::write(&mut w, args);
    w.0
}

/// `core::fmt::Write` adapter over a borrowed `&mut [u8]` — the engine behind
/// [`buf_print`] / [`buf_print_len`] (and `bun_core::fmt::buf_print_z`).
///
/// Lives at T0 so `bun_alloc` itself can use it (`BSSStringList::print`); T1
/// `bun_core::fmt` re-exports it and adds an `io::Write` impl for write-only
/// sites.
pub struct SliceCursor<'a> {
    pub buf: &'a mut [u8],
    pub at: usize,
}
impl<'a> SliceCursor<'a> {
    #[inline]
    pub fn new(buf: &'a mut [u8]) -> Self {
        Self { buf, at: 0 }
    }
}
impl core::fmt::Write for SliceCursor<'_> {
    #[inline]
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        let bytes = s.as_bytes();
        let end = self.at + bytes.len();
        if end > self.buf.len() {
            return Err(core::fmt::Error);
        }
        self.buf[self.at..end].copy_from_slice(bytes);
        self.at = end;
        Ok(())
    }
}

/// Render the formatted args into `buf`, returning the written sub-slice.
/// Fails (`fmt::Error`) when `buf` is too short.
pub fn buf_print<'a>(
    buf: &'a mut [u8],
    args: core::fmt::Arguments<'_>,
) -> core::result::Result<&'a [u8], core::fmt::Error> {
    let mut c = SliceCursor { buf, at: 0 };
    core::fmt::write(&mut c, args)?;
    let len = c.at;
    Ok(&c.buf[..len])
}

/// [`buf_print`] returning only the byte count.
#[inline]
pub fn buf_print_len(
    buf: &mut [u8],
    args: core::fmt::Arguments<'_>,
) -> core::result::Result<usize, core::fmt::Error> {
    let mut c = SliceCursor { buf, at: 0 };
    core::fmt::write(&mut c, args)?;
    Ok(c.at)
}

// LAYERING: `bun_alloc` is below `bun_threading` in the crate graph, so the
// futex-backed `bun_threading::Mutex` is unavailable here; `std::sync` (itself
// futex-backed since Rust 1.62) is the dependency-free stand-in.
#[inline]
fn lock_state<T>(state: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

// Per PORTING.md type map: `OOM!T` / `error{OutOfMemory}!T` → `Result<T, bun_alloc::AllocError>`.
// This is the crate root, so define it here. Re-exported as `bun_core::OOM`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AllocError;

impl core::fmt::Display for AllocError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("OutOfMemory")
    }
}
impl core::error::Error for AllocError {}

/// Stamp out `impl From<AllocError> for $t { → $t::OutOfMemory }` for one or
/// more local error enums. Expansion is byte-identical to the hand-written
/// 3-line impls this replaces.
#[macro_export]
macro_rules! oom_from_alloc {
    ($($t:ty),+ $(,)?) => { $(
        impl ::core::convert::From<$crate::AllocError> for $t {
            #[inline]
            fn from(_: $crate::AllocError) -> Self { <$t>::OutOfMemory }
        }
    )+ };
}

/// The mimalloc-backed `#[global_allocator]` payload.
///
/// Per PORTING.md "Prereq for every crate":
/// `#[global_allocator] static ALLOC: bun_alloc::Mimalloc = bun_alloc::Mimalloc;`
/// must be set at the binary root before any `Box`/`Rc`/`Arc`/`Vec` mapping is valid.
///
/// Uses mimalloc's
/// `MI_MAX_ALIGN_SIZE` (16) fast-path: alignments ≤16 go through `mi_malloc`,
/// larger through `mi_malloc_aligned`. `mi_free` handles both.
///
/// `GlobalAlloc` cannot say which requests can fail, and most callers end the process on
/// null, so every request goes through mimalloc's `must` entry points.
pub struct Mimalloc;

use mimalloc::MI_MAX_ALIGN_SIZE;

// SAFETY: mimalloc's allocator contract matches GlobalAlloc's:
//   - `mi_malloc`/`mi_malloc_aligned` return null on failure or a ptr to ≥size
//     bytes aligned to ≥layout.align() (when align > MI_MAX_ALIGN_SIZE we use
//     the explicit aligned variant).
//   - `mi_free` accepts any ptr returned by either alloc fn (mimalloc tracks
//     alignment internally via the page metadata).
//   - `mi_zalloc*` zero-fills.
//   - `mi_realloc_aligned` preserves min(old_size, new_size) bytes.
unsafe impl core::alloc::GlobalAlloc for Mimalloc {
    #[inline]
    unsafe fn alloc(&self, layout: core::alloc::Layout) -> *mut u8 {
        mimalloc::mi_must_malloc_auto_align(layout.size(), layout.align()).cast()
    }

    #[inline]
    unsafe fn alloc_zeroed(&self, layout: core::alloc::Layout) -> *mut u8 {
        mimalloc::mi_must_zalloc_auto_align(layout.size(), layout.align()).cast()
    }

    #[inline]
    unsafe fn dealloc(&self, ptr: *mut u8, _layout: core::alloc::Layout) {
        // SAFETY: `GlobalAlloc::dealloc` contract — `ptr` was returned by one of
        // the mimalloc alloc paths above; `mi_free` reads size/align from page metadata.
        unsafe { mimalloc::mi_free(ptr.cast()) }
    }

    #[inline]
    unsafe fn realloc(
        &self,
        ptr: *mut u8,
        layout: core::alloc::Layout,
        new_size: usize,
    ) -> *mut u8 {
        // SAFETY: `GlobalAlloc::realloc` contract — `ptr` is a live mimalloc
        // allocation with `layout`; `mi_realloc*` preserves the `min(old, new)` prefix.
        unsafe {
            if layout.align() <= MI_MAX_ALIGN_SIZE {
                mimalloc::mi_must_realloc(ptr.cast(), new_size)
            } else {
                mimalloc::mi_must_realloc_aligned(ptr.cast(), new_size, layout.align())
            }
        }
        .cast()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Symbols hoisted DOWN into T0 so higher tiers can re-import without cycles.
// ──────────────────────────────────────────────────────────────────────────

// ── out_of_memory ─────────────────────────────────────────────────────────
// `bun_alloc` is T0 and cannot depend on `bun_crash_handler`, so the upward
// call is routed through a link-time `extern "Rust"` symbol defined by
// `bun_crash_handler`. Resolved at link time → the target lives in read-only
// `.text`, so memory corruption cannot redirect it (the previous `AtomicPtr`
// slot was writable). Under `cfg(test)` (this crate's standalone test binary
// does not link `bun_crash_handler`) the fallback is a direct abort.

#[cold]
#[inline(never)]
pub fn out_of_memory() -> ! {
    #[cfg(not(test))]
    {
        unsafe extern "Rust" {
            // Defined `#[no_mangle] extern "Rust"` in `bun_crash_handler` and
            // linked into every binary that depends on this crate; no args, no
            // preconditions — `safe fn` discharges the link-time proof here.
            safe fn __bun_crash_handler_out_of_memory() -> !;
        }
        __bun_crash_handler_out_of_memory()
    }
    #[cfg(test)]
    {
        let _ = std::io::Write::write_all(&mut std::io::stderr(), b"bun: out of memory\n");
        std::process::abort()
    }
}

// ── page_size ─────────────────────────────────────────────────────────────
// Used by LinuxMemFdAllocator / standalone_graph.
// Cached via OnceLock per PORTING.md §Concurrency (was lazy-init in std).

static PAGE_SIZE: std::sync::OnceLock<usize> = std::sync::OnceLock::new();

#[inline]
pub fn page_size() -> usize {
    *PAGE_SIZE.get_or_init(|| {
        #[cfg(unix)]
        {
            // By-value `c_int` in / `c_long` out; POSIX `sysconf` has no
            // memory-safety preconditions (unknown `name` returns -1/EINVAL),
            // so `safe fn` discharges the link-time proof.
            unsafe extern "C" {
                safe fn sysconf(name: core::ffi::c_int) -> core::ffi::c_long;
            }
            sysconf(libc::_SC_PAGESIZE) as usize
        }
        #[cfg(windows)]
        {
            // Local `#[repr(C)]` mirror so this crate stays leaf (no
            // `windows-sys` dep — see PORTING.md §Crate map). Only
            // `dwPageSize` is read; the rest is opaque padding sized to
            // `sizeof(SYSTEM_INFO)` (48 bytes on both x86 and x64).
            #[repr(C)]
            struct SystemInfo {
                _w_processor_architecture: u16,
                _w_reserved: u16,
                dw_page_size: u32,
                _tail: [*mut core::ffi::c_void; 3],
                _ints: [u32; 5],
            }
            unsafe extern "system" {
                // `&mut SystemInfo` is ABI-identical to `LPSYSTEM_INFO` (thin
                // non-null pointer to a `#[repr(C)]` struct); kernel32 fully
                // initialises every field. No other preconditions, so `safe fn`
                // discharges the link-time proof and the caller needs no `unsafe`.
                safe fn GetSystemInfo(lpSystemInfo: &mut SystemInfo);
            }
            let mut info = SystemInfo {
                _w_processor_architecture: 0,
                _w_reserved: 0,
                dw_page_size: 0,
                _tail: [core::ptr::null_mut(); 3],
                _ints: [0; 5],
            };
            GetSystemInfo(&mut info);
            info.dw_page_size as usize
        }
    })
}

/// Port of `WTFStringImplStruct` — must match WebKit's `WTF::StringImpl` layout.
///
/// `m_ref_count` / `m_hash_and_flags` are `Cell<u32>` (not bare `u32`) because
/// `r#ref`/`deref`/`ensure_hash` hand a `*const Self` derived from `&self` to
/// C++ FFI that **writes** those fields. Without `UnsafeCell` the struct is
/// `Freeze`, the `&self` borrow asserts the whole pointee is read-only, and
/// the FFI write is a Stacked-Borrows violation (LLVM may also CSE the
/// pre-/post-FFI `ref_count()` loads). `Cell<u32>` is `repr(transparent)` over
/// `UnsafeCell<u32>`, so the C ABI layout is unchanged.
#[repr(C)]
pub struct WTFStringImplStruct {
    pub(crate) m_ref_count: core::cell::Cell<u32>,
    pub(crate) m_length: u32,
    pub m_ptr: WTFStringImplPtr,
    pub(crate) m_hash_and_flags: core::cell::Cell<u32>,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union WTFStringImplPtr {
    pub latin1: *const u8,
    pub utf16: *const u16,
}

/// `*WTFStringImplStruct` — always non-null when `tag == WTFStringImpl`.
pub type WTFStringImpl = *mut WTFStringImplStruct;

impl WTFStringImplStruct {
    // ---------------------------------------------------------------------
    // These details must stay in sync with WTFStringImpl.h in WebKit!
    // ---------------------------------------------------------------------
    pub(crate) const S_HASH_FLAG_8BIT_BUFFER: u32 = 1 << 2;
    pub(crate) const S_HASH_FLAG_STRING_KIND_IS_ATOM: u32 = 1 << 4;
    pub(crate) const S_HASH_FLAG_STRING_KIND_IS_SYMBOL: u32 = 1 << 5;
    /// The bottom bit in the ref count indicates a static (immortal) string.
    pub(crate) const S_REF_COUNT_FLAG_IS_STATIC_STRING: u32 = 0x1;
    /// This allows us to ref / deref without disturbing the static string flag.
    pub(crate) const S_REF_COUNT_INCREMENT: u32 = 0x2;

    #[inline]
    pub fn length(&self) -> u32 {
        self.m_length
    }
    #[inline]
    pub fn is_8bit(&self) -> bool {
        (self.m_hash_and_flags.get() & Self::S_HASH_FLAG_8BIT_BUFFER) != 0
    }
    #[inline]
    pub fn byte_length(&self) -> usize {
        if self.is_8bit() {
            self.m_length as usize
        } else {
            (self.m_length as usize) * 2
        }
    }
    #[inline]
    pub fn memory_cost(&self) -> usize {
        self.byte_length()
    }
    #[inline]
    pub fn ref_count(&self) -> u32 {
        self.m_ref_count.get() / Self::S_REF_COUNT_INCREMENT
    }
    /// Atomic view of `m_ref_count`. The C++ field is
    /// `std::atomic<uint32_t> m_refCount` (StringImpl.h:163); we model it as
    /// `Cell<u32>` for the read-only accessors above but `ref`/`deref` must
    /// issue real atomic RMWs to match `WTF::StringImpl::ref`/`deref` exactly.
    /// `Cell<u32>` is `repr(transparent)` over `UnsafeCell<u32>` and
    /// `AtomicU32` is `repr(C, align(4))` over `UnsafeCell<u32>`: same size,
    /// same alignment (`m_ref_count` is the first field of a `#[repr(C)]`
    /// struct so it is 4-aligned), so the in-place reborrow is sound.
    #[inline(always)]
    fn ref_count_atomic(&self) -> &AtomicU32 {
        // SAFETY: layout-compatible reborrow of `UnsafeCell<u32>` as
        // `AtomicU32`; see doc comment above.
        unsafe { AtomicU32::from_ptr(self.m_ref_count.as_ptr()) }
    }
    #[inline(always)]
    fn is_static(&self) -> bool {
        let count = self.ref_count_atomic().load(Ordering::Relaxed);
        count & Self::S_REF_COUNT_FLAG_IS_STATIC_STRING != 0
    }
    /// Inline port of `WTF::StringImpl::ref()` (StringImpl.h:1181).
    ///
    /// Cross-language LTO does not inline the `Bun__WTFStringImpl__ref` C++
    /// shim into Rust callers (2151 out-of-line `callq` sites in the release
    /// binary), so the one-instruction body is reimplemented here.
    /// `Relaxed` matches WebKit's
    /// `m_refCount.fetch_add(s_refCountIncrement, std::memory_order_relaxed)`.
    /// A static string can be in read-only memory, so its count is never written.
    #[inline]
    pub fn r#ref(&self) {
        if self.is_static() {
            return;
        }
        let old = self
            .ref_count_atomic()
            .fetch_add(Self::S_REF_COUNT_INCREMENT, Ordering::Relaxed);
        debug_assert!(old > 0); // hasAtLeastOneRef — also true for static (flag bit set)
        debug_assert!(
            old.wrapping_add(Self::S_REF_COUNT_INCREMENT) / Self::S_REF_COUNT_INCREMENT
                > old / Self::S_REF_COUNT_INCREMENT
                || old & Self::S_REF_COUNT_FLAG_IS_STATIC_STRING != 0
        );
    }
    /// Inline port of `WTF::StringImpl::deref()` (StringImpl.h:1193).
    ///
    /// Hot path is a single `lock xadd`; only the last-ref branch crosses FFI
    /// to `StringImpl::destroy`. `Relaxed` matches WebKit's
    /// `m_refCount.fetch_sub(s_refCountIncrement, std::memory_order_relaxed)`.
    #[inline]
    pub fn deref(&self) {
        if self.is_static() {
            return;
        }
        let old = self
            .ref_count_atomic()
            .fetch_sub(Self::S_REF_COUNT_INCREMENT, Ordering::Relaxed);
        debug_assert!(old > 0); // hasAtLeastOneRef
        if old != Self::S_REF_COUNT_INCREMENT {
            return;
        }
        // Cold path: last reference dropped — hand the impl to C++ for
        // destruction (handles substring/symbol/external buffer ownership).
        // SAFETY: `old == s_refCountIncrement` ⇒ count is now 0 and we held
        // the sole ref; `self` is not touched again after this call.
        unsafe { Bun__WTFStringImpl__destroy(self) };
    }
    /// Borrow `len` raw bytes from `m_ptr`. The `latin1` arm of the `repr(C)`
    /// union is a valid byte pointer regardless of encoding (both arms share
    /// the same offset). Centralises the `from_raw_parts(m_ptr.latin1, …)` used
    /// by `byte_slice` / `latin1_slice` / `utf8_slice`.
    #[inline(always)]
    pub fn raw_bytes(&self, len: usize) -> &[u8] {
        // SAFETY: `m_ptr.latin1` points at the impl's character buffer for the
        // lifetime of `self`; every caller passes `len ≤ byte_length()`.
        unsafe { core::slice::from_raw_parts(self.m_ptr.latin1, len) }
    }
    #[inline]
    pub fn byte_slice(&self) -> &[u8] {
        self.raw_bytes(self.byte_length())
    }
    #[inline]
    pub fn latin1_slice(&self) -> &[u8] {
        debug_assert!(self.is_8bit());
        self.raw_bytes(self.m_length as usize)
    }
    #[inline]
    pub fn utf16_slice(&self) -> &[u16] {
        debug_assert!(!self.is_8bit());
        // SAFETY: WebKit guarantees m_ptr.utf16 valid for m_length u16s when !8-bit.
        unsafe { core::slice::from_raw_parts(self.m_ptr.utf16, self.m_length as usize) }
    }
    #[inline]
    pub fn utf16_byte_length(&self) -> usize {
        if self.is_8bit() {
            self.m_length as usize * 2
        } else {
            self.m_length as usize
        }
    }
    #[inline]
    pub fn is_atom(&self) -> bool {
        (self.m_hash_and_flags.get() & Self::S_HASH_FLAG_STRING_KIND_IS_ATOM) != 0
    }
    #[inline]
    pub fn is_symbol(&self) -> bool {
        (self.m_hash_and_flags.get() & Self::S_HASH_FLAG_STRING_KIND_IS_SYMBOL) != 0
    }
    #[inline]
    pub fn is_thread_isolated(&self) -> bool {
        WTFStringImpl__isThreadIsolated(self)
    }
    #[inline]
    pub fn is_thread_shareable(&self) -> bool {
        WTFStringImpl__isThreadShareable(self)
    }
    /// Compute the hash() if necessary
    #[inline]
    pub fn ensure_hash(&self) {
        Bun__WTFStringImpl__ensureHash(self);
    }
}

unsafe extern "C" {
    // `&WTFStringImplStruct` is ABI-identical to the C++ `StringImpl*` (thin
    // non-null pointer to a `#[repr(C)]` struct). C++-side mutation lands in
    // `m_ref_count` / `m_hash_and_flags`, both `Cell<u32>`, so writes through
    // a `&`-derived pointer are sound. The type encodes the only validity
    // precondition, so `safe fn` discharges the link-time proof.
    // `ref`/`deref` are inlined in Rust above; only the cold last-ref
    // `destroy` path crosses FFI. `*const` + `unsafe`: it frees the
    // allocation backing the pointer.
    pub fn Bun__WTFStringImpl__destroy(this: *const WTFStringImplStruct);
    safe fn WTFStringImpl__isThreadIsolated(this: &WTFStringImplStruct) -> bool;
    safe fn WTFStringImpl__isThreadShareable(this: &WTFStringImplStruct) -> bool;
    safe fn Bun__WTFStringImpl__ensureHash(this: &WTFStringImplStruct);
}

// ──────────────────────────────────────────────────────────────────────────
// Slice-in-buffer helpers
// ──────────────────────────────────────────────────────────────────────────

pub fn is_slice_in_buffer_t<T>(slice: &[T], buffer: &[T]) -> bool {
    let slice_ptr = slice.as_ptr() as usize;
    let buffer_ptr = buffer.as_ptr() as usize;
    buffer_ptr <= slice_ptr
        && (slice_ptr + std::mem::size_of_val(slice))
            <= (buffer_ptr + std::mem::size_of_val(buffer))
}

/// Checks if a slice's pointer is contained within another slice.
/// If you need to make this generic, use `is_slice_in_buffer_t`.
pub fn is_slice_in_buffer(slice: &[u8], buffer: &[u8]) -> bool {
    is_slice_in_buffer_t::<u8>(slice, buffer)
}

/// Returns `[offset, len]` if `slice` lies within `buffer`, else `None`.
pub fn range_of_slice_in_buffer(slice: &[u8], buffer: &[u8]) -> Option<[u32; 2]> {
    if !is_slice_in_buffer(slice, buffer) {
        return None;
    }
    let r = [
        (slice.as_ptr() as usize).saturating_sub(buffer.as_ptr() as usize) as u32,
        slice.len() as u32,
    ];
    debug_assert_eq!(slice, &buffer[r[0] as usize..][..r[1] as usize]);
    Some(r)
}

/// Zeros
/// `len` bytes at `p` in a way the optimizer cannot elide. Uses bulk
/// `write_bytes` (lowers to `memset`) instead of a per-byte volatile loop so
/// debug builds don't pay O(len) iteration overhead — the SSLConfig leak test
/// secure-zeros ~300 MiB of cert material across 1200 iterations and the
/// per-byte loop alone took ~3 s in debug. `black_box` on the pointer after
/// the memset forces the compiler to assume the zeroed region is observed,
/// preventing dead-store elimination in release builds.
///
/// # Safety
/// `p` must be valid for writes of `len` bytes.
#[inline]
pub unsafe fn secure_zero(p: *mut u8, len: usize) {
    // SAFETY: caller contract.
    unsafe { core::ptr::write_bytes(p, 0, len) };
    // Treat `p` as escaped so the preceding stores cannot be eliminated.
    core::hint::black_box(p);
    core::sync::atomic::compiler_fence(core::sync::atomic::Ordering::SeqCst);
}

/// Memory is typically not decommitted immediately when freed. Sensitive
/// information kept in memory can be read until the OS decommits it or the
/// allocator reuses it. Zero it before dropping.
///
/// Uses [`secure_zero`] so the zeroing cannot be elided by the optimizer.
pub fn free_sensitive<T: Copy>(mut slice: Box<[T]>) {
    // SAFETY: `slice` is exclusively owned; writing `size_of_val` zero bytes
    // over its storage is sound for `T: Copy` (no drop glue, no invariants on
    // the bit pattern we're discarding).
    unsafe {
        let len = core::mem::size_of_val::<[T]>(&slice);
        secure_zero(slice.as_mut_ptr().cast::<u8>(), len);
    }
    drop(slice);
}

/// [`free_sensitive`] for the C-string
/// case used by http SSLConfig. Zeros the allocation before freeing
/// (defence-in-depth for keys/passphrases).
///
/// # Safety
/// `p` must be null or a NUL-terminated allocation from `dupe_z` (i.e.
/// `default_alloc::malloc`).
pub unsafe fn free_sensitive_cstr(p: *const core::ffi::c_char) {
    if p.is_null() {
        return;
    }
    // SAFETY: p is a NUL-terminated `default_alloc::malloc`'d buffer per
    // `dupe_z` contract. An interior NUL truncating `strlen` only shortens the
    // zero pass — the free is still exact (`mi_free`/`libc::free` are
    // size-agnostic).
    unsafe {
        let len = libc::strlen(p);
        secure_zero(p.cast::<u8>().cast_mut(), len);
        crate::default_alloc::free(p.cast::<core::ffi::c_void>().cast_mut());
    }
}

// ──────────────────────────────────────────────────────────────────────────
// IndexType — `packed struct(u32) { index: u31, is_overflow: bool = false }`
// Bits 0..=30 = index, bit 31 = is_overflow.
// ──────────────────────────────────────────────────────────────────────────

/// Only a BSS store makes one, so a value is a sentinel or names a slot that a store assigned.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct IndexType(u32);

impl IndexType {
    #[inline]
    pub(crate) const fn new(index: u32, is_overflow: bool) -> Self {
        Self((index & 0x7FFF_FFFF) | ((is_overflow as u32) << 31))
    }
    #[inline]
    pub const fn index(self) -> u32 {
        self.0 & 0x7FFF_FFFF
    }
    #[inline]
    pub const fn is_overflow(self) -> bool {
        (self.0 >> 31) != 0
    }
}

pub const NOT_FOUND: IndexType = IndexType::new(u32::MAX >> 1, false); // maxInt(u31)
pub const UNASSIGNED: IndexType = IndexType::new((u32::MAX >> 1) - 1, false); // maxInt(u31) - 1

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ItemStatus {
    Unknown,
    Exists,
    NotFound,
}

// ──────────────────────────────────────────────────────────────────────────
// `allocators` namespace shim
//
// Downstream crates use the `bun_alloc::allocators` path
// (`use bun_alloc::allocators;`). Re-export the crate root
// so `allocators::IndexType`, `allocators::BSSMapInner`, etc. resolve without
// rewriting every callsite.
// ──────────────────────────────────────────────────────────────────────────
pub mod allocators {
    pub use super::*;
}

// ──────────────────────────────────────────────────────────────────────────
// Per-monomorphization singleton macros
//
// Each instantiation needs its own singleton. Rust forbids
// generic statics, so the storage is emitted at the *declare site* instead:
//
//   bss_string_list! { pub dirname_store: 4096, 129 }
//   // → pub fn dirname_store() -> &'static BSSStringList<4096,129>, over a private `AtomicPtr`
//
// The accessor lazily field-initializes via `init_at` on the first call.
// ──────────────────────────────────────────────────────────────────────────

/// Emit a process-lifetime singleton accessor for any type with an
/// `unsafe fn init_at(*mut Self)` in-place initializer. Storage is a single
/// `AtomicPtr` (8 bytes) per declare site; the value itself is heap-allocated
/// on first call.
/// The accessor returns `&'static`, so a store method that takes `&mut self` does not compile at a call site.
#[macro_export]
macro_rules! bss_singleton {
    ($(#[$m:meta])* $vis:vis fn $name:ident() -> $ty:ty) => {
        $(#[$m])*
        #[inline(always)]
        $vis fn $name() -> &'static $ty {
            // Every thread can call the accessor.
            const _: fn() = || {
                fn assert_sync<T: ::core::marker::Sync>() {}
                assert_sync::<$ty>();
            };
            // Store an 8-byte heap pointer and allocate on first call
            // (heap, process-lifetime).
            //
            // Hot path: this accessor is hit per-append/get from the resolver
            // (`DirnameStore::append`, `EntriesMap::get`, …). The previous
            // `Once::call_once` fast-path
            // is an Acquire load + cmp + branch + Relaxed load that *cannot*
            // inline across crates (it's a call into `std::sys::sync::once`).
            // Open-code the double-checked-init so the post-init path is one
            // Acquire load + null-test inlined into every caller.
            static STORAGE: ::core::sync::atomic::AtomicPtr<$ty> =
                ::core::sync::atomic::AtomicPtr::new(::core::ptr::null_mut());
            let mut p = STORAGE.load(::core::sync::atomic::Ordering::Acquire);
            if p.is_null() {
                p = slow();
            }
            // Cold path: first access. `#[cold]` + `#[inline(never)]` keeps
            // the mmap/init code out of the hot icache line and lets lld
            // group it with this module rather than `std::sys::sync`.
            #[cold]
            #[inline(never)]
            fn slow() -> *mut $ty {
                let p = $crate::bss_heap_init::<$ty>(<$ty>::init_at).as_ptr();
                // Race: two threads may both reach here. The mmap'd region is
                // process-lifetime and never freed, so the loser is leaked
                // (≤ one per declare site). The CAS
                // is the publication barrier.
                match STORAGE.compare_exchange(
                    ::core::ptr::null_mut(),
                    p,
                    ::core::sync::atomic::Ordering::AcqRel,
                    ::core::sync::atomic::Ordering::Acquire,
                ) {
                    Ok(_) => p,
                    Err(winner) => winner,
                }
            }
            // SAFETY: `slow` published a store that `init_at` initialized and that nothing frees.
            unsafe { &*p }
        }
    };
}

/// Take zeroed process-lifetime storage for a `T` from `bss_lazy_bytes` and run its in-place `init_at` initializer.
///
/// Shared body of `BSSMapInner::init()` and of the `bss_singleton!` accessors.
/// The once-guard is the *caller's* responsibility; use the `bss_*!` macros
/// for the canonical per-monomorphization singleton.
#[doc(hidden)] // Public only for the `bss_singleton!` macro expansion in dependent crates.
#[inline]
pub fn bss_heap_init<T>(init_at: unsafe fn(*mut T)) -> NonNull<T> {
    let ptr = bss_lazy_bytes(size_of::<T>(), core::mem::align_of::<T>()).cast::<T>();
    // SAFETY: ptr is a fresh, exclusively-owned, properly-aligned, all-zeros-on-read
    // allocation; lives for process lifetime (singleton; never freed/unmapped).
    // `init_at` is therefore free to skip writing any field whose
    // all-zeros bit pattern is already a valid initial value (e.g. `OverflowList`'s
    // 32 KiB `[AtomicPtr<_>; 4096]` array — null is "no block").
    unsafe { init_at(ptr.as_ptr()) };
    ptr
}

/// Reserve `size` bytes of demand-zero-faulted, process-lifetime storage.
///
/// On unix this carves a sub-range out of a single process-wide
/// `mmap(MAP_PRIVATE|MAP_ANONYMOUS|MAP_NORESERVE)` arena: pages are not
/// committed until first written to, so a 532 KiB `BSSStringList` backing
/// buffer that only ever sees a handful of filenames touches one or two pages
/// instead of all 130. On Windows this falls back to `mi_zalloc_aligned`
/// (eager commit, but still all-zeros so callers may rely on that uniformly).
///
/// The mapping is **never freed** — these are `.bss`-semantics
/// singletons. Do not call from code paths that need to release the storage.
///
/// **Coalesced arena.** An earlier version
/// `mmap`ed each one separately, costing 6 `mmap` syscalls + 6 VMAs on the
/// `bun run <npm-script>` path (≈2 MiB total across `entry_store_backing`,
/// `dirname_store_backing`, `hash_map_instance`, …) before any user code
/// runs. We instead bump-allocate every request out of one lazily-mapped
/// [`BSS_ARENA_SIZE`] region, restoring the single-VMA `.bss` locality and
/// dropping the syscall count to 1. Requests that overflow the arena (none
/// today; the headroom is ~2×) fall through to a dedicated `mmap`.
///
/// Returned pointer is `align`-aligned (`align ≤ 4096`).
#[doc(hidden)]
#[inline]
pub(crate) fn bss_lazy_bytes(size: usize, align: usize) -> NonNull<u8> {
    debug_assert!(size > 0);
    #[cfg(unix)]
    let ptr = {
        debug_assert!(align <= 4096 && align.is_power_of_two());
        bss_arena_bump(size, align)
    };
    #[cfg(not(unix))]
    let ptr = {
        // Windows: `VirtualAlloc(MEM_RESERVE)`-only would require commit-on-touch
        // plumbing through a guard-page handler. The largest singleton is ~1.3 MiB
        // and Windows already faults `.bss` eagerly per-page on first write anyway,
        // so the simpler eager allocation is kept. Use `mi_zalloc_aligned` (not
        // `mi_malloc`) so callers can uniformly rely on all-zeros — `init_at`
        // bodies skip writing zero-valued fields.
        mimalloc::mi_zalloc_aligned(size, align).cast::<u8>()
    };
    NonNull::new(ptr).expect("OOM")
}

/// Size of the shared demand-zero arena backing every `bss_*!` singleton on
/// unix. Sum of all live monomorphizations on the `bun run` path is ≈2 MiB
/// (`entry_store_backing` 1,216,560 B + `dirname_store_backing` 528,384 B +
/// `hash_map_instance` 229,440 B + the other stores); 4 MiB leaves ~2×
/// headroom. `MAP_NORESERVE` means the unused tail costs only address space.
#[cfg(unix)]
const BSS_ARENA_SIZE: usize = 4 * 1024 * 1024;

/// Bump-allocate `size` bytes at `align` out of the process-wide `.bss` arena,
/// mapping it on first call. Returns a pointer into a `MAP_ANONYMOUS|MAP_NORESERVE`
/// region (zero-on-read, demand-faulted). Falls back to a dedicated `mmap` if
/// the arena is exhausted. Never returns null.
#[cfg(unix)]
fn bss_arena_bump(size: usize, align: usize) -> *mut u8 {
    use core::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};

    static BASE: AtomicPtr<u8> = AtomicPtr::new(core::ptr::null_mut());
    static CURSOR: AtomicUsize = AtomicUsize::new(0);

    // Resolve the arena base. Fast path is one Acquire load; the cold path
    // maps the 4 MiB region once and publishes via CAS. A losing racer's
    // mapping is leaked (≤ one per process; `MAP_NORESERVE` so it costs no
    // committed memory) — same race policy as `bss_singleton!`.
    let mut base = BASE.load(Ordering::Acquire);
    if base.is_null() {
        #[cold]
        #[inline(never)]
        fn map_arena() -> *mut u8 {
            bss_mmap_noreserve(BSS_ARENA_SIZE)
        }
        let fresh = map_arena();
        base = match BASE.compare_exchange(
            core::ptr::null_mut(),
            fresh,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => fresh,
            Err(winner) => winner, // leak `fresh` (untouched MAP_NORESERVE)
        };
    }

    // Bump the cursor: round up to `align`, reserve `size`. CAS loop because
    // alignment padding makes the increment input-dependent. Contention is
    // ~nil (called a handful of times from `Transpiler::init` on the main
    // thread); the loop is for correctness, not throughput.
    let mut cur = CURSOR.load(Ordering::Relaxed);
    loop {
        let aligned = (cur + align - 1) & !(align - 1);
        let next = aligned + size;
        if next > BSS_ARENA_SIZE {
            // Overflow — shouldn't happen with today's singletons (see
            // `BSS_ARENA_SIZE`); satisfy with a dedicated mapping so the
            // caller's lazy-fault contract still holds.
            return bss_mmap_noreserve(size);
        }
        match CURSOR.compare_exchange_weak(cur, next, Ordering::AcqRel, Ordering::Relaxed) {
            // SAFETY: `aligned + size <= BSS_ARENA_SIZE`; `base` spans
            // `[0, BSS_ARENA_SIZE)` from a single `mmap`, so the offset is
            // in-bounds of that allocation.
            Ok(_) => return unsafe { base.add(aligned) },
            Err(observed) => cur = observed,
        }
    }
}

/// One `mmap(MAP_PRIVATE|MAP_ANONYMOUS|MAP_NORESERVE)` of `len` RW bytes.
/// Aborts on `MAP_FAILED`. Returned pointer is page-aligned and the region
/// reads as all-zeros until written.
#[cfg(unix)]
#[inline]
fn bss_mmap_noreserve(len: usize) -> *mut u8 {
    // SAFETY: `MAP_ANONYMOUS` ignores fd/offset; `len` is non-zero; on success
    // the region is owned exclusively by this process and zero-filled on first
    // touch.
    // `MAP_NORESERVE` is Linux-specific (skip swap reservation for overcommit).
    // macOS has no equivalent (always overcommits); FreeBSD removed the flag
    // in 11 (it was always a no-op there). Only set it where it exists.
    // Miri has no `MAP_NORESERVE` and no `madvise`, so the tests run without them.
    #[cfg(all(any(target_os = "linux", target_os = "android"), not(miri)))]
    const MAP_FLAGS: libc::c_int = libc::MAP_PRIVATE | libc::MAP_ANONYMOUS | libc::MAP_NORESERVE;
    #[cfg(not(all(any(target_os = "linux", target_os = "android"), not(miri))))]
    const MAP_FLAGS: libc::c_int = libc::MAP_PRIVATE | libc::MAP_ANONYMOUS;
    // SAFETY: anonymous private mapping — fd/offset ignored, `len` is non-zero
    // (callers pass `size_of` of a non-ZST); failure handled below.
    let p = unsafe {
        libc::mmap(
            core::ptr::null_mut(),
            len,
            libc::PROT_READ | libc::PROT_WRITE,
            MAP_FLAGS,
            -1,
            0,
        )
    };
    if p == libc::MAP_FAILED {
        crate::out_of_memory();
    }
    // Under THP `enabled=always` the first write to each 2 MiB stretch would
    // fault a whole huge page, turning this demand-faulted arena into ~4 MiB of
    // RSS. Per-VMA opt-out (not `PR_SET_THP_DISABLE`, which children inherit).
    // SAFETY: `p..p+len` is the mapping created above.
    #[cfg(all(any(target_os = "linux", target_os = "android"), not(miri)))]
    unsafe {
        libc::madvise(p, len, libc::MADV_NOHUGEPAGE);
    }
    // LSan only scans data/BSS, stacks, and malloc-tracked heap for live
    // pointers. This anonymous mapping is none of those, so any `Box`/`Vec`
    // whose owning pointer lives inside a `bss_*!` singleton (e.g. the
    // resolver's `EntriesOption` cache) is reported as a leak — which then
    // forces every subprocess to spend ~5s in llvm-symbolizer matching the
    // suppression. Register the mapping as a root region so LSan walks it.
    #[cfg(bun_asan)]
    {
        unsafe extern "C" {
            safe fn __lsan_register_root_region(ptr: *const core::ffi::c_void, size: usize);
        }
        __lsan_register_root_region(p.cast(), len);
    }
    p.cast::<u8>()
}

/// Reserve `count` elements of `T` as a lazy-faulted slice. See [`bss_lazy_bytes`].
///
/// Returns `NonNull<[MaybeUninit<T>]>`: bytes are zero-on-read but treated as
/// logically uninitialized — callers must gate reads on a separate `used`
/// counter — never read past `used`.
#[doc(hidden)]
#[inline]
pub(crate) fn bss_lazy_slice<T>(count: usize) -> NonNull<[MaybeUninit<T>]> {
    let p =
        bss_lazy_bytes(count * size_of::<T>(), core::mem::align_of::<T>()).cast::<MaybeUninit<T>>();
    NonNull::slice_from_raw_parts(p, count)
}

/// Declare a `BSSList<T, COUNT>` singleton accessor.
#[macro_export]
macro_rules! bss_list {
    ($(#[$m:meta])* $vis:vis $name:ident : $value_ty:ty, $count:expr) => {
        $crate::bss_singleton!($(#[$m])* $vis fn $name() -> $crate::BSSList<$value_ty, { $count }>);
    };
}

/// Declare a `BSSStringList<COUNT, ITEM_LENGTH>` singleton accessor.
#[macro_export]
macro_rules! bss_string_list {
    ($(#[$m:meta])* $vis:vis $name:ident : $count:expr, $item_len:expr) => {
        $crate::bss_singleton!($(#[$m])* $vis fn $name() -> $crate::BSSStringList<{ $count }, { $item_len }>);
    };
}

/// Declare a `BSSMapInner<T, COUNT, RM_SLASH>` singleton accessor.
#[macro_export]
macro_rules! bss_map_inner {
    ($(#[$m:meta])* $vis:vis $name:ident : $value_ty:ty, $count:expr, $rm_slash:expr) => {
        $crate::bss_singleton!($(#[$m])* $vis fn $name() -> $crate::BSSMapInner<$value_ty, { $count }, { $rm_slash }>);
    };
}

// Compile-time smoke test for the declare-site macros (no runtime cost; the
// statics live in BSS and the accessors are dead-stripped if unused).
mod __bss_macro_smoke {
    crate::bss_list! { _l  : u32, 4 }
    crate::bss_string_list! { _sl : 4, 8 }
    crate::bss_map_inner! { _mi : u32, 4, true }
}

// ──────────────────────────────────────────────────────────────────────────
// heap_breakdown — macOS `malloc_zone_*` per-tag heaps (debug-only)
//
// Full port lives in `heap_breakdown.rs`. It compiles on all targets: on
// non-macOS the FFI surface is `unreachable!()` behind `ENABLED == false`.
// ──────────────────────────────────────────────────────────────────────────

#[path = "heap_breakdown.rs"]
pub mod heap_breakdown;

/// Comptime-literal form of `heap_breakdown::get_zone` — expands a per-name `OnceLock`.
#[macro_export]
macro_rules! get_zone {
    ($name:literal) => {{
        static ZONE: ::std::sync::OnceLock<&'static $crate::heap_breakdown::Zone> =
            ::std::sync::OnceLock::new();
        *ZONE.get_or_init(|| {
            // SAFETY: concat!($name, "\0") is a valid NUL-terminated string
            // literal in static memory — valid for process lifetime.
            unsafe {
                $crate::heap_breakdown::Zone::init(
                    concat!($name, "\0").as_ptr().cast::<::core::ffi::c_char>(),
                )
            }
        })
    }};
}

// ──────────────────────────────────────────────────────────────────────────
// IndexMap / Result
// (`IndexType`, `ItemStatus`, `NOT_FOUND`, `UNASSIGNED` defined above.)
// ──────────────────────────────────────────────────────────────────────────

type HashKeyType = u64;

/// Identity hash on a u64 key. Keys here are already
/// `bun_wyhash` outputs, so rehashing with std's SipHash just costs cycles.
#[derive(Default, Clone, Copy)]
pub struct IdentityU64Hasher(u64);
impl core::hash::Hasher for IdentityU64Hasher {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        self.0 = bun_wyhash::hash_with_seed(self.0, bytes);
    }
    #[inline]
    fn write_u64(&mut self, n: u64) {
        self.0 = n;
    }
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
}
type IndexMapHasher = core::hash::BuildHasherDefault<IdentityU64Hasher>;

pub type IndexMap = HashMap<HashKeyType, IndexType, IndexMapHasher>;

#[derive(Clone, Copy)]
pub struct Result {
    pub hash: HashKeyType,
    pub index: IndexType,
    pub status: ItemStatus,
}

impl Result {
    pub fn has_checked_if_exists(&self) -> bool {
        self.index.index() != UNASSIGNED.index()
    }

    /// Whether a store assigned a slot to this result.
    pub fn has_slot(&self) -> bool {
        self.index.index() != NOT_FOUND.index() && self.index.index() != UNASSIGNED.index()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// OverflowList<ValueType, COUNT>
// ──────────────────────────────────────────────────────────────────────────

const OVERFLOW_GROUP_MAX: usize = 4095;
const OVERFLOW_GROUP_SLOTS: usize = OVERFLOW_GROUP_MAX + 1;

/// The counters of an [`OverflowList`]. The lock of the owning store guards them.
#[derive(Default)]
struct OverflowCounts {
    count: u32,
    // 16 million files should be good enough for anyone
    // ...right?
    blocks: u16,
    /// Free slots in the last block. Every earlier block is full.
    tail_free: u32,
}

// Const-generic arithmetic (deriving COUNT from another const param) requires
// `feature(generic_const_exprs)` on stable Rust, so COUNT is pinned per instantiation site.

type OverflowListBlock<ValueType, const COUNT: usize> = [MaybeUninit<ValueType>; COUNT];

/// Blocks of `COUNT` slots. Only `[0..count]` is initialized; writes are raw (no drop glue).
struct OverflowList<ValueType, const COUNT: usize> {
    /// Null is "no block". `grow` stores each element once. No reference to a block is ever formed.
    ptrs: [AtomicPtr<OverflowListBlock<ValueType, COUNT>>; OVERFLOW_GROUP_SLOTS],
    /// `ptrs` owns the values, so `Send` and `Sync` follow `ValueType`.
    _owns: core::marker::PhantomData<ValueType>,
}

impl<ValueType, const COUNT: usize> OverflowList<ValueType, COUNT> {
    /// Appends `value`. The slot pointer stays valid across every later call on the list.
    #[inline]
    fn append(
        &self,
        counts: &mut OverflowCounts,
        value: ValueType,
    ) -> core::result::Result<NonNull<ValueType>, AllocError> {
        if counts.tail_free == 0 {
            self.grow(counts)?;
        }
        // `Relaxed`: `&mut counts` orders this load after the `grow` that stored the element.
        let block = self.ptrs[usize::from(counts.blocks) - 1].load(Ordering::Relaxed);
        let block = NonNull::new(block).expect("alloc");
        let index = COUNT - counts.tail_free as usize;
        assert!(index < COUNT);
        // SAFETY: `index < COUNT`, so the slot is in bounds of the block.
        // Raw write — slot may be uninit; no drop glue runs.
        let slot = unsafe {
            let slot = block.cast::<ValueType>().add(index);
            slot.write(value);
            slot
        };
        counts.tail_free -= 1;
        counts.count += 1;
        Ok(slot)
    }

    /// Adds a block. `append` calls it when the last block is full.
    #[cold]
    fn grow(&self, counts: &mut OverflowCounts) -> core::result::Result<(), AllocError> {
        const { assert!(COUNT > 0, "an overflow block must hold at least one item") };
        let blocks = usize::from(counts.blocks);
        if blocks >= OVERFLOW_GROUP_SLOTS {
            return Err(AllocError);
        }
        let block = Box::into_raw(Box::<OverflowListBlock<ValueType, COUNT>>::new_uninit());
        // `Relaxed`: `&mut counts` orders the appenders, and the contract of `slot_ptr` orders each reader after its `append`.
        self.ptrs[blocks].store(block.cast(), Ordering::Relaxed);
        counts.blocks += 1;
        counts.tail_free = COUNT as u32;
        Ok(())
    }

    /// The slot of `index`. Does not read the counters, so it needs no lock.
    ///
    /// SAFETY: `append` on this list must have assigned the overflow `index`,
    /// and that `append` must happen-before this call.
    #[inline]
    unsafe fn slot_ptr(&self, index: IndexType) -> NonNull<ValueType> {
        let idx = index.index() as usize;
        let block_id = if idx > 0 { idx / COUNT } else { 0 };

        debug_assert!(index.is_overflow());

        // SAFETY: `append` assigned `index`, so `grow` stored `ptrs[block_id]`
        // before `index` existed, and nothing stores that element again. This
        // call is ordered after that `append` (caller contract), so a `Relaxed`
        // load reads the block. `idx % COUNT < COUNT` ⇒ the slot is in bounds.
        unsafe {
            let block = self.ptrs.get_unchecked(block_id).load(Ordering::Relaxed);
            debug_assert!(!block.is_null());
            NonNull::new_unchecked(block.cast::<ValueType>().add(idx % COUNT))
        }
    }
}

impl<ValueType, const COUNT: usize> Drop for OverflowList<ValueType, COUNT> {
    fn drop(&mut self) {
        for block in &mut self.ptrs {
            let block = *block.get_mut();
            if !block.is_null() {
                // SAFETY: `append` leaked this block from a `Box`, and nothing else frees it.
                drop(unsafe { Box::from_raw(block) });
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BSSList<ValueType, _COUNT>
// ──────────────────────────────────────────────────────────────────────────

/// "Formerly-BSSList"
/// It's not actually BSS anymore.
///
/// We do keep a pointer to it globally, but because the data is not zero-initialized, it ends up
/// taking space in the object file. We don't want to spend 1-2 MB on these structs.
///
/// Const-generic arithmetic (`COUNT = _COUNT * 2`) and a per-monomorphization
/// raw mutable INSTANCE static are not expressible on stable Rust; callers
/// pin concrete `COUNT` constants per use-site.
///
/// `#[repr(C)]` with the lock-guarded `state` laid out *before* the giant `backing_buf` array. Storage
/// comes from [`bss_lazy_bytes`] (anonymous mmap, demand-zero), so each page
/// faults only on first write. With default repr rustc placed `used: u32`
/// *after* `backing_buf` (~1.2 MB into the largest instantiation), so
/// `init_at`'s startup writes faulted tail pages needlessly. With this
/// layout every startup write lands in page 0 of the mapping; subsequent pages
/// fault only as `append` actually fills them.
#[repr(C)]
pub struct BSSList<ValueType, const COUNT: usize /* = _COUNT * 2 */> {
    state: std::sync::Mutex<BSSListState<ValueType>>,
    tail: BSSListOverflowBlock<ValueType>,
    // Only `[0..used]` is initialized.
    backing_buf: UnsafeCell<[MaybeUninit<ValueType>; COUNT]>,
}

/// What the lock of a [`BSSList`] guards.
struct BSSListState<ValueType> {
    /// The block that overflow slots come from: the inline `tail`, then heap blocks.
    head: *mut BSSListOverflowBlock<ValueType>,
    /// Slots handed out of `head`.
    head_used: u16,
    /// Slots handed out of the list.
    used: u32,
}

// SAFETY: `state` is behind its lock. The slot buffers are the only other
// shared-mutable fields: the list hands each slot out once, as a raw pointer,
// and never reads or writes a slot itself.
unsafe impl<ValueType: Send, const COUNT: usize> Sync for BSSList<ValueType, COUNT> {}

const BSS_LIST_CHUNK_SIZE: usize = 256;

/// Slots per overflow block of a [`BSSMapInner`] that names no other size.
const BSS_OVERFLOW_BLOCK_SIZE: usize = 2048;

/// A chunk of overflow slots of a [`BSSList`]: the inline `tail`, or a heap block.
struct BSSListOverflowBlock<ValueType> {
    /// The block that was `head` before this heap block. The inline `tail` does not use it.
    prev: *mut BSSListOverflowBlock<ValueType>,
    // Only the slots that `append_overflow_uninit` handed out are initialized.
    data: UnsafeCell<[MaybeUninit<ValueType>; BSS_LIST_CHUNK_SIZE]>,
}

impl<ValueType, const COUNT: usize> BSSList<ValueType, COUNT> {
    const MAX_INDEX: usize = COUNT - 1;

    /// In-place field initialization into demand-zero storage.
    ///
    /// SAFETY: `slot` must be valid for writes of `Self`, aligned, exclusive and
    /// zeroed, as [`bss_heap_init`] gives it. It does not have to be `'static`,
    /// but the list must stay at `slot` until it is dropped: `head` points into it.
    pub unsafe fn init_at(slot: *mut Self) {
        // `state` is the only field that `init_at` writes, so it leads the layout.
        const { assert!(core::mem::offset_of!(Self, state) == 0) };
        // SAFETY: caller contract. `head` starts at the inline `tail`, taken from the raw `slot`.
        unsafe {
            addr_of_mut!((*slot).state).write(std::sync::Mutex::new(BSSListState {
                head: addr_of_mut!((*slot).tail),
                head_used: 0,
                used: 0,
            }));
        }
    }

    /// Reserves a slot of the `head` block, which a new heap block replaces when it is full.
    #[cold]
    fn append_overflow_uninit(
        state: &mut BSSListState<ValueType>,
    ) -> core::result::Result<*mut MaybeUninit<ValueType>, AllocError> {
        state.used += 1;
        if usize::from(state.head_used) >= BSS_LIST_CHUNK_SIZE {
            let block = Box::into_raw(Box::<BSSListOverflowBlock<ValueType>>::new_uninit())
                .cast::<BSSListOverflowBlock<ValueType>>();
            // SAFETY: `block` is a fresh, exclusive, aligned allocation. `data` stays uninit.
            unsafe { addr_of_mut!((*block).prev).write(state.head) };
            state.head = block;
            state.head_used = 0;
        }
        let index = usize::from(state.head_used);
        state.head_used += 1;
        // SAFETY: `head` is the inline `tail` or a live heap block, and
        // `index < BSS_LIST_CHUNK_SIZE`. `raw_get` forms no reference to the block.
        Ok(unsafe {
            UnsafeCell::raw_get(&raw const (*state.head).data)
                .cast::<MaybeUninit<ValueType>>()
                .add(index)
        })
    }

    /// Reserve a slot and return its uninitialized storage. Caller MUST
    /// `ptr::write` the slot before any other access; the slot index is already
    /// accounted in `used`, so leaving it uninitialized is UB on later read.
    ///
    /// This is the slot-reservation primitive: it lets large `ValueType`s be
    /// constructed directly in the destination (result-location
    /// semantics). The by-value `append` below forces a stack temporary +
    /// memcpy into the slot which Rust does not reliably NRVO across a
    /// non-inlined call boundary; `append_uninit` exposes the slot pointer so
    /// the caller's struct literal lowers straight into it.
    #[inline(always)]
    pub fn append_uninit(&self) -> core::result::Result<*mut MaybeUninit<ValueType>, AllocError> {
        let mut state = lock_state(&self.state);
        let index = state.used as usize;
        if index > Self::MAX_INDEX {
            Self::append_overflow_uninit(&mut state)
        } else {
            state.used += 1;
            let backing_buf = self.backing_buf.get().cast::<MaybeUninit<ValueType>>();
            // SAFETY: `index <= MAX_INDEX < COUNT` is checked.
            Ok(unsafe { backing_buf.add(index) })
        }
    }
}

impl<ValueType, const COUNT: usize> Drop for BSSList<ValueType, COUNT> {
    fn drop(&mut self) {
        // Free the heap-allocated head chain.
        // The inline `self.tail` is not Boxed and must not be Box-dropped; the
        // `prev` chain ends at it (see `append_overflow_uninit`).
        let tail_ptr: *mut BSSListOverflowBlock<ValueType> = &raw mut self.tail;
        let state = self
            .state
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut block = state.head;
        while !core::ptr::eq(block, tail_ptr) {
            // SAFETY: `block` was `Box::into_raw`'d by `append_overflow_uninit` and is
            // exclusively owned by this struct.
            let owned = unsafe { Box::from_raw(block) };
            block = owned.prev;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BSSStringList<_COUNT, _ITEM_LENGTH>
// ──────────────────────────────────────────────────────────────────────────

/// Append-only list.
/// Strings go into a lazily mapped buffer of `COUNT * ITEM_LENGTH` bytes, and onto the heap when it is full. Nothing is freed, also when a store is dropped.
///
/// Same const-generic-arithmetic and per-type-static caveats as `BSSList`.
pub struct BSSStringList<
    const COUNT: usize,       /* = _COUNT * 2 */
    const ITEM_LENGTH: usize, /* = _ITEM_LENGTH + 1 */
> {
    // A separate `bss_lazy_bytes` mapping, because stable Rust cannot spell `[u8; COUNT * ITEM_LENGTH]`.
    backing_buf: NonNull<[MaybeUninit<u8>]>, // len == COUNT * ITEM_LENGTH
    /// Bytes of `backing_buf` that are handed out. Only those are initialized.
    backing_buf_used: std::sync::Mutex<usize>,
}

// SAFETY: `backing_buf` is set once, in `init_at`. Each append reserves its own
// bytes under the lock, and only that append and the slice it returns reach them.
unsafe impl<const COUNT: usize, const ITEM_LENGTH: usize> Sync
    for BSSStringList<COUNT, ITEM_LENGTH>
{
}

/// Byte sources accepted by the `append*` methods. Sealed: `append` relies on every impl to write all of `dst`.
pub trait BSSAppendable: sealed::Sealed {
    /// Total byte length (excluding sentinel).
    fn total_len(&self) -> usize;
    /// Copy bytes into `dst[..total_len()]`.
    fn copy_into(&self, dst: &mut [u8]);
}

mod sealed {
    pub trait Sealed {}
    impl Sealed for &[u8] {}
    impl Sealed for &[&[u8]] {}
    impl Sealed for super::LowerCase<'_> {}
}

impl BSSAppendable for &[u8] {
    fn total_len(&self) -> usize {
        self.len()
    }
    fn copy_into(&self, dst: &mut [u8]) {
        dst[..self.len()].copy_from_slice(self);
    }
}
impl BSSAppendable for &[&[u8]] {
    fn total_len(&self) -> usize {
        self.iter().map(|s| s.len()).sum()
    }
    fn copy_into(&self, dst: &mut [u8]) {
        let mut remainder = dst;
        for val in *self {
            remainder[..val.len()].copy_from_slice(val);
            remainder = &mut remainder[val.len()..];
        }
    }
}

/// The bytes, ASCII-lowercased as they are copied.
struct LowerCase<'a>(&'a [u8]);

impl BSSAppendable for LowerCase<'_> {
    fn total_len(&self) -> usize {
        self.0.len()
    }
    fn copy_into(&self, dst: &mut [u8]) {
        copy_lowercase(self.0, dst);
    }
}

impl<const COUNT: usize, const ITEM_LENGTH: usize> BSSStringList<COUNT, ITEM_LENGTH> {
    /// In-place field initialization into zeroed storage.
    ///
    /// SAFETY: `slot` must be valid for writes of `Self`, aligned, exclusive and
    /// zeroed, as [`bss_heap_init`] gives it. It does not have to be `'static`.
    pub unsafe fn init_at(slot: *mut Self) {
        // SAFETY: caller contract. `backing_buf` stays unfaulted until `append` writes a byte.
        unsafe {
            addr_of_mut!((*slot).backing_buf).write(bss_lazy_slice::<u8>(COUNT * ITEM_LENGTH));
            addr_of_mut!((*slot).backing_buf_used).write(std::sync::Mutex::new(0));
        }
    }

    pub fn exists(&self, value: &[u8]) -> bool {
        // Pointer-range check against the backing storage. Done with addresses
        // rather than forming a `&[u8]` over `MaybeUninit<u8>` storage (which
        // would assert byte-validity of the unwritten tail).
        let base = self.backing_buf.as_ptr().cast::<u8>() as usize;
        let end = base + self.backing_buf.len();
        let p = value.as_ptr() as usize;
        base <= p && p + value.len() <= end
    }

    /// `value` with the store's lifetime, if it already points into the store.
    pub fn as_interned(&'static self, value: &[u8]) -> Option<&'static [u8]> {
        if !self.exists(value) {
            return None;
        }
        // SAFETY: `exists` proved `value` lies inside `backing_buf`, which is
        // never freed or moved (process-lifetime singleton). The caller already
        // holds these bytes as a `&[u8]`, so they are past construction: the only
        // `&mut` into the buffer (`do_append`, `print`) covers freshly
        // reserved bytes and ends before `append`/`print` return them shared.
        Some(unsafe { core::slice::from_raw_parts(value.as_ptr(), value.len()) })
    }

    /// Format `args` into the store.
    pub fn print(&self, args: core::fmt::Arguments<'_>) -> core::result::Result<&[u8], AllocError> {
        // `core::fmt::write` drives a `dyn fmt::Write` vtable per
        // argument piece, so a count-then-write double pass pays that dispatch *twice* — the
        // dominant cost in `extract_tarball::build_url`, which is called once
        // per lockfile package with 6+ args.
        //
        // Single-pass instead: format into a stack scratch (one `core::fmt`
        // drive), then memcpy the exact bytes into the store via `append`
        // (which adds the trailing NUL itself, matching the original `len + 1`
        // reservation). 512 B covers every current caller (npm tarball URLs,
        // interned dirnames); longer outputs fall through to the original
        // count-then-reserve path below.
        const STACK: usize = 512;
        let mut scratch = [MaybeUninit::<u8>::uninit(); STACK];
        // SAFETY: `SliceCursor::write_str` only *writes* into `buf[at..end]`
        // via `copy_from_slice` and never reads it, so forming `&mut [u8]` over
        // uninit bytes is sound here — every byte in `[..c.at]` is initialized
        // before being observed below. Same pattern as `do_append`'s
        // `backing_buf` slice formation.
        let mut c = crate::SliceCursor::new(unsafe {
            core::slice::from_raw_parts_mut(scratch.as_mut_ptr().cast::<u8>(), STACK)
        });
        if core::fmt::write(&mut c, args).is_ok() {
            let written: &[u8] = &c.buf[..c.at];
            return self.append(&written);
        }

        // Overflow (> STACK bytes — rare): count exactly, reserve, re-format.
        let len = crate::fmt_count(args);
        let ptr = self.reserve(len + 2)?;
        // SAFETY: `reserve` returned `len + 2` writable bytes that no other call can
        // reach. The two NUL stores and `buf_print_len` only write them, and only
        // the bytes that `buf_print_len` wrote are returned.
        let buf = unsafe { core::slice::from_raw_parts_mut(ptr.as_ptr(), len + 2) };
        buf[len] = 0;
        buf[len + 1] = 0;
        let written = crate::buf_print_len(&mut buf[..len], args).expect("counted length");
        Ok(&buf[..written])
    }

    /// Append `value`, returning a stable `&[u8]` over the freshly-reserved bytes.
    #[inline]
    pub fn append<A: BSSAppendable>(&self, value: &A) -> core::result::Result<&[u8], AllocError> {
        let copy = self.do_append(value)?;
        // SAFETY: `do_append` reserved `copy` for this call alone, and every `BSSAppendable` writes all of it. Nothing writes it again.
        Ok(unsafe { copy.as_ref() })
    }

    /// Append `value` lowercased ASCII-wise.
    pub fn append_lower_case(&self, value: &[u8]) -> core::result::Result<&[u8], AllocError> {
        self.append(&LowerCase(value))
    }

    /// Copies `value` and a NUL into bytes that it reserves. Returns the copy of `value`, with write provenance.
    #[inline(never)] // Inlined, it costs the resolver 6 instructions per cached resolve and 5.6 KB of code.
    fn do_append<A: BSSAppendable>(
        &self,
        value: &A,
    ) -> core::result::Result<NonNull<[u8]>, AllocError> {
        let value_len: usize = value.total_len() + 1;
        let ptr = self.reserve(value_len)?;
        // SAFETY: `reserve` returned `value_len` writable bytes that no other call
        // can reach. Forming `&mut [u8]` over them — these bytes are about to be
        // written (payload + trailing NUL), so no uninit byte is read through the
        // reference.
        let dst: &mut [u8] = unsafe { core::slice::from_raw_parts_mut(ptr.as_ptr(), value_len) };
        value.copy_into(&mut dst[..value_len - 1]);
        dst[value_len - 1] = 0;
        Ok(NonNull::from(&mut dst[..value_len - 1]))
    }

    /// Reserves `len` bytes: a range of `backing_buf`, or a heap allocation when it is full. Neither is freed.
    #[inline]
    fn reserve(&self, len: usize) -> core::result::Result<NonNull<u8>, AllocError> {
        {
            let mut used = lock_state(&self.backing_buf_used);
            if len + *used < self.backing_buf.len() - 1 {
                let start = *used;
                *used += len;
                // SAFETY: `start + len < backing_buf.len()`, so the range is in bounds of the mapping.
                return Ok(unsafe { self.backing_buf.cast::<u8>().add(start) });
            }
        }
        // Propagate OOM.
        let layout = core::alloc::Layout::array::<u8>(len).map_err(|_| AllocError)?;
        // SAFETY: `len` is not zero: it counts the NUL of the append.
        let ptr = NonNull::new(unsafe { std::alloc::alloc(layout) }).ok_or(AllocError)?;
        // The string is never freed, so a leak checker must not report it when the caller drops the slice.
        #[cfg(bun_asan)]
        {
            unsafe extern "C" {
                safe fn __lsan_ignore_object(ptr: *const core::ffi::c_void);
            }
            __lsan_ignore_object(ptr.as_ptr().cast_const().cast());
        }
        #[cfg(miri)]
        {
            unsafe extern "Rust" {
                safe fn miri_static_root(ptr: *const u8);
            }
            miri_static_root(ptr.as_ptr());
        }
        Ok(ptr)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES>
// ──────────────────────────────────────────────────────────────────────────

/// What the lock of a [`BSSMapInner`] guards.
struct BSSMapState {
    index: IndexMap,
    overflow_counts: OverflowCounts,
    backing_buf_used: u16,
}

/// Every method takes `&self` and none reads a slot, so a slot pointer stays valid across every later call on the map.
#[repr(C)]
pub struct BSSMapInner<
    ValueType,
    const COUNT: usize,
    const REMOVE_TRAILING_SLASHES: bool,
    const OVERFLOW_BLOCK_SIZE: usize = BSS_OVERFLOW_BLOCK_SIZE,
> {
    state: std::sync::Mutex<BSSMapState>,
    overflow_list: OverflowList<ValueType, OVERFLOW_BLOCK_SIZE>,
    // Only `[0..backing_buf_used]` is initialized.
    backing_buf: UnsafeCell<[MaybeUninit<ValueType>; COUNT]>,
}

// SAFETY: everything but the slots and the block table is in `state`, behind
// its lock. The map never reads a slot. `put` writes a slot once, under that
// lock and before the table has the index. Every later write of a slot is the
// caller's: through the pointer, or through `replace`, which is `unsafe` for
// that reason. `put` stores each element of the block table
// (`overflow_list.ptrs`) once, under the lock. `at_index` loads it without
// the lock (see `OverflowList::slot_ptr`).
unsafe impl<
    ValueType: Send,
    const COUNT: usize,
    const REMOVE_TRAILING_SLASHES: bool,
    const OVERFLOW_BLOCK_SIZE: usize,
> Sync for BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES, OVERFLOW_BLOCK_SIZE>
{
}

impl<
    ValueType,
    const COUNT: usize,
    const REMOVE_TRAILING_SLASHES: bool,
    const OVERFLOW_BLOCK_SIZE: usize,
> BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES, OVERFLOW_BLOCK_SIZE>
{
    const MAX_INDEX: usize = COUNT - 1;

    /// In-place field initialization into zeroed storage.
    ///
    /// SAFETY: `slot` must be valid for writes of `Self`, aligned, exclusive and
    /// zeroed, as [`bss_heap_init`] gives it. It does not have to be `'static`.
    /// `backing_buf` is intentionally left uninitialized; only `[0..used]` is read.
    pub unsafe fn init_at(slot: *mut Self) {
        // `state` is the only field that `init_at` writes, so it leads the layout.
        const { assert!(core::mem::offset_of!(Self, state) == 0) };
        // SAFETY: caller contract — `slot` is a valid, exclusive, aligned `*mut Self`
        // in all-zeros storage. The 32 KiB `overflow_list.ptrs`
        // array is already all null ("no block"), so write only `state`;
        // `backing_buf` is intentionally left uninitialized.
        unsafe {
            addr_of_mut!((*slot).state).write(std::sync::Mutex::new(BSSMapState {
                index: IndexMap::default(),
                overflow_counts: OverflowCounts::default(),
                backing_buf_used: 0,
            }));
        }
    }

    /// Heap-allocate and initialize a fresh instance. Once-guard is the caller's
    /// responsibility — use `bss_map_inner!` for the canonical singleton.
    pub fn init() -> NonNull<Self> {
        bss_heap_init(Self::init_at)
    }

    /// Normalize `denormalized_key` per `REMOVE_TRAILING_SLASHES` and hash it.
    /// Shared prelude of `get_or_put` / `get` / `remove`; the trimmed slice itself
    /// is never needed by callers, only the hash. `#[inline(always)]` + the
    /// const-generic branch fold to identical codegen at each monomorphization.
    #[inline(always)]
    fn key_hash(denormalized_key: &[u8]) -> u64 {
        let key = if REMOVE_TRAILING_SLASHES {
            trim_right(denormalized_key, SEP_STR.as_bytes())
        } else {
            denormalized_key
        };
        bun_wyhash::hash(key)
    }

    pub fn get_or_put(&self, denormalized_key: &[u8]) -> core::result::Result<Result, AllocError> {
        let _key = Self::key_hash(denormalized_key);

        match lock_state(&self.state).index.entry(_key) {
            std::collections::hash_map::Entry::Occupied(e) => {
                let v = *e.get();
                Ok(Result {
                    hash: _key,
                    index: v,
                    status: match v.index() {
                        i if i == NOT_FOUND.index() => ItemStatus::NotFound,
                        i if i == UNASSIGNED.index() => ItemStatus::Unknown,
                        _ => ItemStatus::Exists,
                    },
                })
            }
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(UNASSIGNED);
                Ok(Result {
                    hash: _key,
                    index: UNASSIGNED,
                    status: ItemStatus::Unknown,
                })
            }
        }
    }

    pub fn get(&self, denormalized_key: &[u8]) -> Option<NonNull<ValueType>> {
        let _key = Self::key_hash(denormalized_key);
        let index = lock_state(&self.state).index.get(&_key).copied()?;
        // SAFETY: `index` comes from the table, under the lock, so it is a sentinel
        // or a `put` that is complete assigned it.
        unsafe { self.at_index(index) }
    }

    pub fn mark_not_found(&self, result: Result) {
        lock_state(&self.state).index.insert(result.hash, NOT_FOUND);
    }

    /// The slot of `index`, or `None` for a sentinel. Does not take the lock.
    ///
    /// SAFETY: `index` must be a sentinel, or an index that `put` on this map
    /// assigned, and that `put` must happen-before this call. The lock gives that
    /// order to a caller that reads the index from the table (`get_or_put`).
    pub unsafe fn at_index(&self, index: IndexType) -> Option<NonNull<ValueType>> {
        if index.index() == NOT_FOUND.index() || index.index() == UNASSIGNED.index() {
            return None;
        }

        if index.is_overflow() {
            // SAFETY: caller contract.
            Some(unsafe { self.overflow_list.slot_ptr(index) })
        } else {
            Some(self.inline_slot(index.index() as usize))
        }
    }

    /// Slot `index` of `backing_buf`. Panics when `index` is out of bounds.
    #[inline]
    fn inline_slot(&self, index: usize) -> NonNull<ValueType> {
        assert!(index < COUNT);
        // SAFETY: `index < COUNT`, so the slot is in bounds of `backing_buf` and not null.
        unsafe { NonNull::new_unchecked(self.backing_buf.get().cast::<ValueType>().add(index)) }
    }

    /// Assigns a slot to `result`, writes `value` to it, and puts the index in the table. Panics when `result` already has a slot: [`Self::replace`] overwrites one.
    pub fn put(
        &self,
        result: &mut Result,
        value: ValueType,
    ) -> core::result::Result<NonNull<ValueType>, AllocError> {
        assert!(!result.has_slot());
        let mut state = lock_state(&self.state);
        let state = &mut *state;

        // Insert into `index` only after the slot is materialized below, so a
        // failed (fallible) `append` can't leave a dangling hash -> index entry.
        let (index, slot) = if state.backing_buf_used as usize > Self::MAX_INDEX {
            let index = IndexType::new(state.overflow_counts.count, true);
            let slot = self
                .overflow_list
                .append(&mut state.overflow_counts, value)?;
            (index, slot)
        } else {
            let index = IndexType::new(u32::from(state.backing_buf_used), false);
            let slot = self.inline_slot(index.index() as usize);
            // SAFETY: raw write — fresh slots are uninit; no drop glue runs.
            unsafe { slot.write(value) };
            state.backing_buf_used += 1;
            (index, slot)
        };
        state.index.insert(result.hash, index);
        result.index = index;
        Ok(slot)
    }

    /// Overwrites the slot that `put` assigned to `result`, and puts the index back in the table.
    ///
    /// SAFETY: `put` on this map must have assigned `result.index`. During the
    /// call no other thread may read, write or borrow that slot. The lock of
    /// the map does not give that: the map hands slot pointers out.
    pub unsafe fn replace(&self, result: &Result, value: ValueType) -> NonNull<ValueType> {
        // SAFETY: caller contract. The slot holds a value, and the assignment drops it.
        let slot = unsafe {
            let slot = self.at_index(result.index).expect("assigned index");
            *slot.as_ptr() = value;
            slot
        };
        lock_state(&self.state)
            .index
            .insert(result.hash, result.index);
        slot
    }

    /// Returns true if the entry was removed.
    pub fn remove(&self, denormalized_key: &[u8]) -> bool {
        let mut state = lock_state(&self.state);
        let _key = Self::key_hash(denormalized_key);
        state.index.remove(&_key).is_some()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Allocator-trait surface — OBSOLETE per PORTING.md §Allocators
// ──────────────────────────────────────────────────────────────────────────
//
// The legacy allocator interface threaded an allocator
// param through every fn. Rust has a global allocator
// (`#[global_allocator] = Mimalloc` above), so per PORTING.md:
//
//   - Non-AST crates: DELETE the `allocator` param. `Box`/`Vec`/`String` use
//     global mimalloc.
//   - AST crates: thread `&'bump bumpalo::Bump` (= `Arena`) directly.
//
// The trait below is kept ONLY as an empty marker so downstream code that
// still says `&dyn bun_alloc::Allocator` continues to parse. Do not implement
// it; do not add methods. Callers should be rewritten to drop the param
// entirely.

/// Legacy allocator marker trait. See module note.
pub trait Allocator: 'static {}

/// Legacy default-allocator ZST. With `#[global_allocator]` set,
/// this is just a unit marker.
#[derive(Clone, Copy, Default)]
pub struct DefaultAlloc;
impl Allocator for DefaultAlloc {}

// `GenericAllocator` / `Borrowed<A>` / `Nullable<A>` are dropped — they modelled
// an allocator-borrowing discipline (avoid double-free), which Rust's
// ownership already enforces.

// ──────────────────────────────────────────────────────────────────────────
// `basic` module selection
// ──────────────────────────────────────────────────────────────────────────

// The real impl is `impl GlobalAlloc for Mimalloc` above.
#[path = "basic.rs"]
pub mod basic;

#[cfg(test)]
#[path = "bss_tests.rs"]
mod bss_tests;
