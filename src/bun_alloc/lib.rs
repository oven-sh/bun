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

use core::mem::{MaybeUninit, size_of};
use core::ptr::{NonNull, addr_of_mut};
use core::sync::atomic::{AtomicU16, AtomicU32, Ordering};
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

// ── RAII Mutex ────────────────────────────────────────────────────────────
// The BSS containers below need to hold the lock across `&mut self` method calls, so
// the returned [`MutexGuard`] deliberately erases its borrow of `self` — it
// stores the `std::sync::MutexGuard` lifetime-extended to `'static` (lifetimes
// are erased at codegen, so this is a layout no-op). This is sound because
// every `Mutex` here lives inside a `'static` BSS singleton (see `instance()`
// below), so the pointee always outlives the guard.
//
// LAYERING: `bun_alloc` is below `bun_threading` in the crate graph, so the
// futex-backed `bun_threading::Mutex` is unavailable here; `std::sync` (itself
// futex-backed since Rust 1.62) is the dependency-free stand-in.
pub struct Mutex(std::sync::Mutex<()>);
impl Mutex {
    pub const fn new() -> Self {
        Self(std::sync::Mutex::new(()))
    }
    #[inline]
    pub(crate) fn lock(&self) -> MutexGuard {
        let g = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // SAFETY: lifetime extension only — `std::sync::MutexGuard<'a, ()>` and
        // `<'static, ()>` have identical layout. Every `bun_alloc::Mutex` lives
        // in a `'static` BSS singleton, so the inner `&Mutex` the guard holds
        // is in fact valid for `'static`.
        let _guard = unsafe {
            core::mem::transmute::<std::sync::MutexGuard<'_, ()>, std::sync::MutexGuard<'static, ()>>(
                g,
            )
        };
        MutexGuard { _guard }
    }
}

/// Unlocks the paired [`Mutex`] on drop. See the type-level comment on
/// [`Mutex`] for why this erases the guard lifetime rather than borrowing.
#[must_use = "if unused the Mutex will immediately unlock"]
pub(crate) struct MutexGuard {
    _guard: std::sync::MutexGuard<'static, ()>,
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
        mimalloc::mi_malloc_auto_align(layout.size(), layout.align()).cast()
    }

    #[inline]
    unsafe fn alloc_zeroed(&self, layout: core::alloc::Layout) -> *mut u8 {
        mimalloc::mi_zalloc_auto_align(layout.size(), layout.align()).cast()
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
                mimalloc::mi_realloc(ptr.cast(), new_size)
            } else {
                mimalloc::mi_realloc_aligned(ptr.cast(), new_size, layout.align())
            }
        }
        .cast()
    }
}

/// Resize a mimalloc-owned buffer, taking a raw pointer for callers that
/// cannot soundly materialize a `&mut [u8]` over their buffer (e.g. it contains
/// uninitialized or padding bytes). Returns the new base pointer;
/// `min(old_size, new_size)` prefix bytes are preserved.
///
/// # Safety
/// `ptr` must be a live allocation from the default (mimalloc) allocator with
/// alignment ≤ `MI_MAX_ALIGN_SIZE`. After return, `ptr` is invalidated.
pub unsafe fn realloc_raw(
    ptr: *mut u8,
    new_size: usize,
) -> core::result::Result<*mut u8, AllocError> {
    // SAFETY: caller guarantees `ptr` is a mimalloc-owned block.
    let new_ptr = unsafe { mimalloc::mi_realloc(ptr.cast(), new_size) };
    if new_ptr.is_null() {
        return Err(AllocError);
    }
    Ok(new_ptr.cast::<u8>())
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
    /// Inline port of `WTF::StringImpl::ref()` (StringImpl.h:1181).
    ///
    /// Cross-language LTO does not inline the `Bun__WTFStringImpl__ref` C++
    /// shim into Rust callers (2151 out-of-line `callq` sites in the release
    /// binary), so the one-instruction body is reimplemented here.
    /// `Relaxed` matches WebKit's
    /// `m_refCount.fetch_add(s_refCountIncrement, std::memory_order_relaxed)`.
    #[inline]
    pub fn r#ref(&self) {
        let old = self
            .ref_count_atomic()
            .fetch_add(Self::S_REF_COUNT_INCREMENT, Ordering::Relaxed);
        debug_assert!(old > 0); // hasAtLeastOneRef — also true for static (flag bit set)
        debug_assert!(
            old.wrapping_add(Self::S_REF_COUNT_INCREMENT) / Self::S_REF_COUNT_INCREMENT
                > old / Self::S_REF_COUNT_INCREMENT
                || old & Self::S_REF_COUNT_FLAG_IS_STATIC_STRING != 0
        );
        let _ = old;
    }
    /// Inline port of `WTF::StringImpl::deref()` (StringImpl.h:1193).
    ///
    /// Hot path is a single `lock xadd`; only the last-ref branch crosses FFI
    /// to `StringImpl::destroy`. `Relaxed` matches WebKit's
    /// `m_refCount.fetch_sub(s_refCountIncrement, std::memory_order_relaxed)`;
    /// WTF relies on the static-string flag bit (0x1) to keep static strings'
    /// counters from ever equalling `s_refCountIncrement`, so no separate
    /// `isStatic()` check is needed.
    #[inline]
    pub fn deref(&self) {
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

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct IndexType(u32);

impl IndexType {
    #[inline]
    pub const fn new(index: u32, is_overflow: bool) -> Self {
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
    #[inline]
    pub(crate) fn set_index(&mut self, index: u32) {
        self.0 = (self.0 & 0x8000_0000) | (index & 0x7FFF_FFFF);
    }
    #[inline]
    pub(crate) fn set_is_overflow(&mut self, v: bool) {
        self.0 = (self.0 & 0x7FFF_FFFF) | ((v as u32) << 31);
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
// BSSList / BSSStringList / BSSMapInner — real method bodies follow below.
// Per-monomorphization statics are emitted at the declare site via the
// `bss_list!` / `bss_string_list!` / `bss_map_inner!` macros
// (`SyncUnsafeCell<MaybeUninit<Self>>` + `Once` + `init_at`). `init()` is a
// thin heap-allocating wrapper for callers that manage their own once-guard.
// ──────────────────────────────────────────────────────────────────────────

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
//   // → static STORAGE: SyncUnsafeCell<MaybeUninit<BSSStringList<4096,129>>>
//   //   pub fn dirname_store() -> *mut BSSStringList<4096,129>
//
// The accessor lazily field-initializes via `init_at` under `std::sync::Once`.
// Returning `&'static mut` means callers must not hold overlapping unique
// borrows.
// ──────────────────────────────────────────────────────────────────────────

/// Emit a process-lifetime singleton accessor for any type with an
/// `unsafe fn init_at(*mut Self)` in-place initializer. Storage is a single
/// `AtomicPtr` (8 bytes) per declare site; the value itself is heap-allocated
/// on first call.
#[macro_export]
macro_rules! bss_singleton {
    ($(#[$m:meta])* $vis:vis fn $name:ident() -> $ty:ty) => {
        $(#[$m])*
        #[inline(always)]
        $vis fn $name() -> *mut $ty {
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
            let p = STORAGE.load(::core::sync::atomic::Ordering::Acquire);
            if !p.is_null() {
                return p;
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
                // (≤ one per declare site, which in practice is single-threaded
                // — `FileSystem::init` runs once on the main thread). The CAS
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
            slow()
        }
    };
}

/// Heap-allocate a fresh `T` via mimalloc and run its in-place `init_at` initializer.
///
/// Shared body of the `BSSStringList`/`BSSMapInner` `init()` shims.
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
    // 32 KiB `[Option<Box<_>>; 4096]` array — `None` is the null niche).
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
/// `hash_map_instance` 229,440 B + slice/key buffers); 4 MiB leaves ~2×
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
    #[cfg(any(target_os = "linux", target_os = "android"))]
    const MAP_FLAGS: libc::c_int = libc::MAP_PRIVATE | libc::MAP_ANONYMOUS | libc::MAP_NORESERVE;
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
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
    #[cfg(any(target_os = "linux", target_os = "android"))]
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
}

// ──────────────────────────────────────────────────────────────────────────
// OverflowGroup<Block>
// ──────────────────────────────────────────────────────────────────────────

/// Required interface for the `Block` parameter of `OverflowGroup`/`OverflowList`.
pub trait OverflowBlock {
    /// In-place initialize the `used` counter on possibly-uninitialized storage.
    /// SAFETY: `this` must point to writable, properly-aligned storage of `Self`.
    unsafe fn zero(this: *mut Self);
    fn is_full(&self) -> bool;
    fn used_mut(&mut self) -> &mut u32;
}

const OVERFLOW_GROUP_MAX: usize = 4095;
const OVERFLOW_GROUP_SLOTS: usize = OVERFLOW_GROUP_MAX + 1;
type OverflowUsedSize = u16;

struct OverflowGroup<Block> {
    // 16 million files should be good enough for anyone
    // ...right?
    pub(crate) used: OverflowUsedSize,
    pub(crate) allocated: OverflowUsedSize,
    pub(crate) ptrs: [Option<Box<Block>>; OVERFLOW_GROUP_SLOTS],
}

impl<Block: OverflowBlock> OverflowGroup<Block> {
    pub(crate) fn tail(&mut self) -> core::result::Result<&mut Block, AllocError> {
        if self.used as usize + 1 >= OVERFLOW_GROUP_SLOTS
            && self.ptrs[self.used as usize]
                .as_ref()
                .expect("alloc")
                .is_full()
        {
            return Err(AllocError);
        }

        if self.allocated > 0
            && self.ptrs[self.used as usize]
                .as_ref()
                .expect("alloc")
                .is_full()
        {
            self.used = self.used.wrapping_add(1);
            if self.allocated > self.used {
                *self.ptrs[self.used as usize]
                    .as_mut()
                    .expect("alloc")
                    .used_mut() = 0;
            }
        }

        if self.allocated <= self.used {
            debug_assert!((self.allocated as usize) < OVERFLOW_GROUP_SLOTS);
            // SAFETY: Box<MaybeUninit> → zero() initializes the `used` counter; payload array
            // is `[MaybeUninit<T>; N]` and intentionally stays uninit.
            let mut b: Box<core::mem::MaybeUninit<Block>> = Box::new_uninit();
            // SAFETY: `b.as_mut_ptr()` is a valid, exclusive, aligned `*mut Block`.
            unsafe { Block::zero(b.as_mut_ptr()) };
            // SAFETY: after `zero`, all non-`MaybeUninit` fields of `Block` are initialized.
            self.ptrs[self.allocated as usize] = Some(unsafe { b.assume_init() });
            self.allocated = self.allocated.wrapping_add(1);
        }

        Ok(self.ptrs[self.used as usize].as_mut().expect("alloc"))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// OverflowList<ValueType, COUNT>
// ──────────────────────────────────────────────────────────────────────────

// Const-generic arithmetic (deriving COUNT from another const param) requires
// `feature(generic_const_exprs)` on stable Rust, so COUNT is pinned per instantiation site.

struct OverflowListBlock<ValueType, const COUNT: usize> {
    pub(crate) used: u32,
    // Only `[0..used]` is initialized; writes are raw (no drop glue).
    pub items: [MaybeUninit<ValueType>; COUNT],
}

impl<ValueType, const COUNT: usize> OverflowListBlock<ValueType, COUNT> {
    pub(crate) fn append(&mut self, value: ValueType) -> &mut ValueType {
        debug_assert!((self.used as usize) < COUNT);
        let index = self.used as usize;
        // Raw write — slot may be uninit; no drop glue runs.
        self.items[index].write(value);
        self.used = self.used.wrapping_add(1);
        // SAFETY: just initialized on the line above.
        unsafe { self.items[index].assume_init_mut() }
    }
}

impl<ValueType, const COUNT: usize> OverflowBlock for OverflowListBlock<ValueType, COUNT> {
    unsafe fn zero(this: *mut Self) {
        // SAFETY: caller contract — `this` is a valid, aligned `*mut Self`.
        unsafe { addr_of_mut!((*this).used).write(0) };
    }
    fn is_full(&self) -> bool {
        (self.used as usize) >= COUNT
    }
    fn used_mut(&mut self) -> &mut u32 {
        &mut self.used
    }
}

pub struct OverflowList<ValueType, const COUNT: usize> {
    pub(crate) list: OverflowGroup<OverflowListBlock<ValueType, COUNT>>,
    pub count: u32,
}

impl<ValueType, const COUNT: usize> OverflowList<ValueType, COUNT> {
    /// In-place init of just the three scalar counters (`list.used`,
    /// `list.allocated`, `count`) into storage that is already all-zeros.
    ///
    /// `list.ptrs: [Option<Box<_>>; 4096]` is ~32 KiB; the all-zeros bit
    /// pattern is `[None; 4096]` via the null-pointer niche, so when `slot`
    /// lives in a fresh `bss_lazy_bytes`/`bss_heap_init` mapping (always
    /// zero-on-read) we touch one cache line instead of faulting eight pages.
    ///
    /// SAFETY: `slot` must be a valid, exclusive, aligned `*mut Self` whose
    /// `list.ptrs` bytes are already zero (i.e. obtained from
    /// `bss_heap_init`/`bss_lazy_bytes`, NOT `mi_malloc`/stack `MaybeUninit`).
    #[inline]
    pub(crate) unsafe fn init_counters_at(slot: *mut Self) {
        // SAFETY: caller contract.
        unsafe {
            addr_of_mut!((*slot).list.used).write(0);
            addr_of_mut!((*slot).list.allocated).write(0);
            addr_of_mut!((*slot).count).write(0);
        }
    }

    #[inline]
    fn len(&self) -> u32 {
        self.count
    }

    #[inline]
    pub(crate) fn append(
        &mut self,
        value: ValueType,
    ) -> core::result::Result<&mut ValueType, AllocError> {
        let block = self.list.tail()?;
        self.count += 1;
        Ok(block.append(value))
    }

    #[inline]
    pub fn at_index_mut(&mut self, index: IndexType) -> &mut ValueType {
        let idx = index.index() as usize;
        let block_id = if idx > 0 { idx / COUNT } else { 0 };

        debug_assert!(index.is_overflow());
        debug_assert!(self.list.used as usize >= block_id);
        debug_assert!(
            self.list.ptrs[block_id].as_ref().expect("alloc").used as usize > (idx % COUNT)
        );

        // SAFETY: `block_id <= used` ⇒ `append` allocated `ptrs[block_id]`;
        // `idx % COUNT < used` ⇒ slot was initialized by `append`.
        unsafe {
            self.list
                .ptrs
                .get_unchecked_mut(block_id)
                .as_mut()
                .unwrap_unchecked()
                .items
                .get_unchecked_mut(idx % COUNT)
                .assume_init_mut()
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
/// `#[repr(C)]` with the small mutated scalars (`mutex`, `head`, `used`,
/// `tail`'s header) laid out *before* the giant `backing_buf` array. Storage
/// comes from [`bss_lazy_bytes`] (anonymous mmap, demand-zero), so each page
/// faults only on first write. With default repr rustc placed `used: u32`
/// *after* `backing_buf` (~1.2 MB into the largest instantiation), so
/// `init_at`'s startup writes faulted tail pages needlessly. With this
/// layout every startup write lands in page 0 of the mapping; subsequent pages
/// fault only as `append` actually fills them.
#[repr(C)]
pub struct BSSList<ValueType, const COUNT: usize /* = _COUNT * 2 */> {
    pub(crate) mutex: Mutex,
    // LIFETIMES.tsv: dual semantics — points at sibling `tail` OR a heap alloc.
    // Kept as a raw NonNull: self-referential when `head == &self.tail`, so a safe
    // borrow cannot express it.
    pub(crate) head: Option<NonNull<BSSListOverflowBlock<ValueType>>>,
    pub(crate) used: u32,
    pub(crate) tail: BSSListOverflowBlock<ValueType>,
    // Only `[0..used]` is initialized.
    pub(crate) backing_buf: [MaybeUninit<ValueType>; COUNT],
}

// SAFETY: `head` is a self-referential `NonNull` into `self.tail` or a heap block owned by
// `self`; all mutation goes through `self.mutex`. The raw pointer is the only `!Sync` field;
// the type is logically a mutex-guarded global singleton.
unsafe impl<ValueType: Send, const COUNT: usize> Send for BSSList<ValueType, COUNT> {}
// SAFETY: see the `Send` impl directly above — all access is mutex-serialized.
unsafe impl<ValueType: Send, const COUNT: usize> Sync for BSSList<ValueType, COUNT> {}

const BSS_LIST_CHUNK_SIZE: usize = 256;

/// The per-store overflow-block size is `count / 4`; this shared constant must
/// be >= the largest store's, i.e. the filename store's `8192 / 4`.
const BSS_OVERFLOW_BLOCK_SIZE: usize = 2048;

/// `#[repr(C)]` with `prev` before `data` so the inline `BSSList::tail` block's
/// scalar fields cluster at the front of the singleton mapping (see the layout
/// note on [`BSSList`]). Heap-allocated overflow blocks don't care about page
/// locality; the constraint is on the inline-tail instance.
#[repr(C)]
struct BSSListOverflowBlock<ValueType> {
    pub(crate) used: AtomicU16,
    pub(crate) prev: Option<Box<BSSListOverflowBlock<ValueType>>>,
    // Only `[0..used]` is initialized.
    pub data: [MaybeUninit<ValueType>; BSS_LIST_CHUNK_SIZE],
}

impl<ValueType> BSSListOverflowBlock<ValueType> {
    /// In-place initialize `used` and `prev` on possibly-uninitialized storage.
    /// SAFETY: `this` must point to writable, properly-aligned storage of `Self`.
    #[inline]
    pub(crate) unsafe fn zero(this: *mut Self) {
        // SAFETY: caller guarantees `this` points to writable, aligned storage of
        // `Self`. Raw `ptr::write` because `*this` may be uninit — assignment
        // would run drop glue on garbage (`prev: Option<Box<..>>`).
        unsafe {
            addr_of_mut!((*this).used).write(AtomicU16::new(0));
            addr_of_mut!((*this).prev).write(None);
        }
    }

    /// Reserve a slot and return its uninitialized storage. Caller MUST
    /// initialize the slot before any other access.
    #[inline(always)]
    pub(crate) fn append_uninit(
        &mut self,
    ) -> core::result::Result<*mut MaybeUninit<ValueType>, AllocError> {
        let index = self.used.fetch_add(1, Ordering::AcqRel);
        if index as usize >= BSS_LIST_CHUNK_SIZE {
            return Err(AllocError);
        }
        // SAFETY: `index < BSS_LIST_CHUNK_SIZE` checked above.
        Ok(unsafe { self.data.as_mut_ptr().add(index as usize) })
    }
}

// `deinit` for OverflowBlock: walks `prev` and frees each. With `prev: Option<Box<..>>`,
// `Drop` handles the chain automatically — no explicit impl needed.

impl<ValueType, const COUNT: usize> BSSList<ValueType, COUNT> {
    const MAX_INDEX: usize = COUNT - 1;

    // Rust cannot define generic statics, so the per-monomorphization storage is
    // emitted at the *declare site* via `bss_list! { name: T, N }` (see macro
    // below), which owns a `SyncUnsafeCell<MaybeUninit<Self>>` + `Once` and
    // calls `init_at` on first access.

    /// In-place field initialization into demand-zero storage.
    ///
    /// SAFETY: `slot` must point to writable, properly-aligned, **all-zeros**
    /// storage of `size_of::<Self>()` bytes that lives for `'static` — i.e. it
    /// came from [`bss_heap_init`] / [`bss_lazy_bytes`]. `used`, `tail.used`,
    /// and `tail.prev` (`None` is the null niche) are already bit-zero in that
    /// storage, so the only required writes are `mutex` (`std::sync::Mutex` is
    /// not guaranteed all-zeros-init, unlike the previous `parking_lot::RawMutex`)
    /// and the non-zero self-referential `head = &tail`. Both fields lead the
    /// `#[repr(C)]` layout, so every startup write stays within page 0 of the
    /// singleton mapping (see the layout note on [`BSSList`]). `backing_buf`
    /// and `tail.data` are intentionally left uninitialized; only `[0..used]`
    /// is read.
    pub unsafe fn init_at(slot: *mut Self) {
        // SAFETY: caller contract — `slot` is a valid, exclusive, aligned,
        // all-zeros `*mut Self`.
        unsafe {
            addr_of_mut!((*slot).mutex).write(Mutex::new());
            // Self-referential `head = &tail`; raw NonNull.
            let tail_ptr = addr_of_mut!((*slot).tail);
            addr_of_mut!((*slot).head).write(Some(NonNull::new_unchecked(tail_ptr)));
        }
    }

    // Singleton teardown belongs to the `bss_list!` singleton wrapper;
    // Drop only frees the heap-allocated head chain.

    /// Reserve an overflow slot and return its uninitialized storage. Mutex is
    /// held by the caller (`append_uninit`). Cold path — only hit after the
    /// `COUNT`-sized backing buffer fills.
    #[cold]
    fn append_overflow_uninit(
        &mut self,
    ) -> core::result::Result<*mut MaybeUninit<ValueType>, AllocError> {
        self.used += 1;
        // SAFETY: head is always non-null after init_at() (points at self.tail or heap block).
        let mut head_ptr = self.head.unwrap();
        // Check capacity first, allocate the new block if
        // needed, then reserve exactly one slot. Safe under `self.mutex`.
        // SAFETY: `head_ptr` is a valid exclusive ref (mutex held).
        let head_full = unsafe {
            (*head_ptr.as_ptr()).used.load(Ordering::Acquire) as usize >= BSS_LIST_CHUNK_SIZE
        };
        if head_full {
            let mut new_block: Box<core::mem::MaybeUninit<BSSListOverflowBlock<ValueType>>> =
                Box::new_uninit();
            // SAFETY: `as_mut_ptr()` is a valid, exclusive, aligned `*mut`; zero() initializes
            // `used` and `prev` via raw writes; `data` is `[MaybeUninit; N]` (always valid).
            unsafe { BSSListOverflowBlock::zero(new_block.as_mut_ptr()) };
            // SAFETY: all non-`MaybeUninit` fields are now initialized.
            let mut new_block = unsafe { new_block.assume_init() };
            // Preserve the chain (`new_block.prev` = old head). The inline `self.tail`
            // is not Boxed, so represent it as `prev = None`; heap heads were
            // `Box::into_raw`'d by an earlier call here and are reclaimed as `Box`.
            let tail_ptr: *const BSSListOverflowBlock<ValueType> = core::ptr::addr_of!(self.tail);
            new_block.prev = if core::ptr::eq(head_ptr.as_ptr().cast_const(), tail_ptr) {
                None
            } else {
                // SAFETY: the previous head was `Box::into_raw`'d by an earlier
                // `append_overflow_uninit` and is exclusively owned via `self.head`.
                Some(unsafe { Box::from_raw(head_ptr.as_ptr()) })
            };
            let raw = Box::into_raw(new_block);
            // SAFETY: raw came from Box::into_raw on the line above; non-null and exclusively owned.
            head_ptr = unsafe { NonNull::new_unchecked(raw) };
            self.head = Some(head_ptr);
        }
        // SAFETY: `head_ptr` is the (possibly freshly-allocated) head block with
        // free capacity; no other alias exists (mutex held).
        unsafe { (*head_ptr.as_ptr()).append_uninit() }
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
    ///
    /// Takes `*mut Self` (not `&mut self`) so callers can pass the raw
    /// `bss_list!` singleton pointer directly without first materializing a
    /// `&mut Self` — which would be aliased UB if two threads did so
    /// concurrently *before* reaching the inner `self.mutex.lock()`. The
    /// inner mutex is the sole
    /// serialization point, so no caller-side outer lock is needed.
    ///
    /// SAFETY: `this` must point to a live, initialized `BSSList` (typically
    /// the `bss_list!` singleton). Concurrent callers are allowed.
    #[inline(always)]
    pub unsafe fn append_uninit(
        this: *mut Self,
    ) -> core::result::Result<*mut MaybeUninit<ValueType>, AllocError> {
        // SAFETY: `this` is live; `Mutex: Sync` so concurrent `&Mutex` formation
        // is sound. `MutexGuard` stores a raw pointer (see its doc), so the
        // `&mut *this` formed below does not alias a live guard borrow.
        let _guard = unsafe { (*this).mutex.lock() };
        // SAFETY: the inner mutex is held, so this call has exclusive access
        // to `*this` (the receiver is raw precisely so nothing exclusive is
        // formed before the lock); `index <= MAX_INDEX < COUNT` is checked.
        unsafe {
            if (*this).used as usize > Self::MAX_INDEX {
                (*this).append_overflow_uninit()
            } else {
                let index = (*this).used as usize;
                (*this).used += 1;
                Ok((*this).backing_buf.as_mut_ptr().add(index))
            }
        }
    }
}

impl<ValueType, const COUNT: usize> Drop for BSSList<ValueType, COUNT> {
    fn drop(&mut self) {
        // Free the heap-allocated head chain.
        // The inline `self.tail` is not Boxed and must not be Box-dropped; the
        // `prev: Option<Box<..>>` chain stops at `None` before reaching it
        // (see `append_overflow_uninit`). Singleton teardown belongs to the
        // `bss_list!` singleton wrapper, not here.
        if let Some(head) = self.head.take() {
            let tail_ptr: *const BSSListOverflowBlock<ValueType> = core::ptr::addr_of!(self.tail);
            if !core::ptr::eq(head.as_ptr().cast_const(), tail_ptr) {
                // SAFETY: `head` was `Box::into_raw`'d by `append_overflow_uninit` and is
                // exclusively owned by this struct. Dropping the Box recursively
                // drops `prev`, freeing the whole heap chain.
                drop(unsafe { Box::from_raw(head.as_ptr()) });
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BSSStringList<_COUNT, _ITEM_LENGTH>
// ──────────────────────────────────────────────────────────────────────────

/// Append-only list.
/// Stores an initial count in .bss section of the object file.
/// Overflows to heap when count is exceeded.
///
/// Same const-generic-arithmetic and per-type-static caveats as `BSSList`.
pub struct BSSStringList<
    const COUNT: usize,       /* = _COUNT * 2 */
    const ITEM_LENGTH: usize, /* = _ITEM_LENGTH + 1 */
> {
    // Inline arrays would live in the same demand-faulted allocation
    // as the rest of the singleton with `init()` writing only the four scalar
    // fields — pages are committed lazily as `append` writes bytes. Stable
    // Rust can't spell `[u8; COUNT*ITEM_LENGTH]` without `generic_const_exprs`,
    // so we store fat pointers to *separate* `bss_lazy_bytes` mappings instead.
    // Same laziness guarantee (MAP_NORESERVE), same lifetime (process-static,
    // never freed), no eager memset.
    //
    // `MaybeUninit` because both arrays are logically uninitialized; only
    // `[..backing_buf_used]` / `[..slice_buf_used]` are ever read.
    pub(crate) backing_buf: NonNull<[MaybeUninit<u8>]>, // len == COUNT * ITEM_LENGTH
    pub(crate) backing_buf_used: u64,
    pub(crate) overflow_list: OverflowList<&'static [u8], BSS_OVERFLOW_BLOCK_SIZE>,
    pub(crate) slice_buf: NonNull<[MaybeUninit<&'static [u8]>]>, // len == COUNT
    pub(crate) slice_buf_used: u16,
    pub(crate) mutex: Mutex,
}

#[derive(Default, Clone, Copy)]
struct EmptyType {
    len: usize,
}

/// Byte sources accepted by the `append*` methods.
pub trait BSSAppendable {
    /// Total byte length (excluding sentinel).
    fn total_len(&self) -> usize;
    /// Copy bytes into `dst[..total_len()]`. No-op for `EmptyType`.
    fn copy_into(&self, dst: &mut [u8]);
}

impl BSSAppendable for EmptyType {
    fn total_len(&self) -> usize {
        self.len
    }
    fn copy_into(&self, _dst: &mut [u8]) {}
}
impl BSSAppendable for &[u8] {
    fn total_len(&self) -> usize {
        self.len()
    }
    fn copy_into(&self, dst: &mut [u8]) {
        dst[..self.len()].copy_from_slice(self);
    }
}
impl<const N: usize> BSSAppendable for [&[u8]; N] {
    fn total_len(&self) -> usize {
        self.iter().map(|s| s.len()).sum()
    }
    fn copy_into(&self, dst: &mut [u8]) {
        let mut remainder = dst;
        for val in self {
            remainder[..val.len()].copy_from_slice(val);
            remainder = &mut remainder[val.len()..];
        }
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

impl<const COUNT: usize, const ITEM_LENGTH: usize> BSSStringList<COUNT, ITEM_LENGTH> {
    const MAX_INDEX: usize = COUNT - 1;

    /// In-place field initialization into uninitialized storage.
    ///
    /// SAFETY: `slot` must point to writable, properly-aligned, uninitialized
    /// storage of `size_of::<Self>()` bytes that lives for `'static`.
    pub unsafe fn init_at(slot: *mut Self) {
        // `backing_buf`/`slice_buf` are left uninitialized so the
        // ~1.4 MiB of array storage stays unfaulted until `append` writes a byte:
        // lazy-map the arrays, write the four scalars, and
        // zero only the three OverflowList counters (its 32 KiB `ptrs` array is
        // already `[None; 4096]` because `slot` came from `bss_heap_init`).
        // SAFETY: caller contract — `slot` is a valid, exclusive, aligned
        // `*mut Self` in all-zeros storage from `bss_heap_init`.
        unsafe {
            addr_of_mut!((*slot).mutex).write(Mutex::new());
            addr_of_mut!((*slot).backing_buf).write(bss_lazy_slice::<u8>(COUNT * ITEM_LENGTH));
            addr_of_mut!((*slot).backing_buf_used).write(0);
            addr_of_mut!((*slot).slice_buf).write(bss_lazy_slice::<&'static [u8]>(COUNT));
            addr_of_mut!((*slot).slice_buf_used).write(0);
            OverflowList::init_counters_at(addr_of_mut!((*slot).overflow_list));
        }
    }

    /// Heap-allocate and initialize a fresh instance. Once-guard is the caller's
    /// responsibility — use `bss_string_list!` for the canonical singleton.
    pub fn init() -> NonNull<Self> {
        bss_heap_init(Self::init_at)
    }

    // Singleton is process-lifetime; never freed.

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
        // `&mut` into the buffer (`append_mutable`, crate-private) covers freshly
        // reserved bytes and ends before `append`/`print` return them shared.
        Some(unsafe { core::slice::from_raw_parts(value.as_ptr(), value.len()) })
    }

    /// Append `value` and return a mutable slice over the freshly-reserved bytes.
    ///
    /// Takes `*mut Self` (not `&mut self`) so callers can pass the raw
    /// `bss_string_list!` singleton pointer directly without first
    /// materializing a `&mut Self` — which would be aliased UB if two threads
    /// did so concurrently *before* reaching the inner `self.mutex.lock()`.
    /// The inner mutex is the sole
    /// serialization point, so no caller-side outer lock is needed.
    ///
    /// SAFETY: `this` must point to a live, initialized `BSSStringList`
    /// (typically the `bss_string_list!` singleton). Concurrent callers are
    /// allowed.
    pub(crate) unsafe fn append_mutable<'a, A: BSSAppendable>(
        this: *mut Self,
        value: &A,
    ) -> core::result::Result<&'a mut [u8], AllocError> {
        // SAFETY: `this` is live; `Mutex: Sync` so concurrent `&Mutex` formation
        // is sound. `MutexGuard` stores a raw pointer (see its doc), so the
        // `&mut *this` formed below does not alias a live guard borrow.
        let _guard = unsafe { (*this).mutex.lock() };
        // SAFETY: inner mutex held ⇒ this thread has exclusive access.
        let (ptr, len) = unsafe { (*this).do_append(value)? };
        // SAFETY: `ptr` came from `out.as_mut_ptr()` inside `do_append` (write provenance)
        // and points into storage owned by `*this` (backing_buf or a process-lifetime
        // mimalloc region); the slot was freshly reserved under the mutex so no other
        // live borrow of that region exists.
        Ok(unsafe { core::slice::from_raw_parts_mut(ptr, len) })
    }

    /// SAFETY: see [`append_mutable`].
    pub(crate) unsafe fn print_with_type<'a>(
        this: *mut Self,
        args: core::fmt::Arguments<'_>,
    ) -> core::result::Result<&'a [u8], AllocError> {
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
            // SAFETY: forwarded — see `append`.
            return unsafe { Self::append(this, &written) };
        }

        // Overflow (> STACK bytes — rare): count exactly, reserve, re-format.
        let len = crate::fmt_count(args);
        // SAFETY: forwarded — see `append_mutable`.
        let buf = unsafe { Self::append_mutable(this, &EmptyType { len: len + 1 })? };
        let buf_len = buf.len();
        buf[buf_len - 1] = 0;
        let written = crate::buf_print_len(&mut buf[..buf_len - 1], args).expect("counted length");
        Ok(&buf[..written])
    }

    /// SAFETY: see [`append_mutable`].
    pub unsafe fn print<'a>(
        this: *mut Self,
        args: core::fmt::Arguments<'_>,
    ) -> core::result::Result<&'a [u8], AllocError> {
        // SAFETY: forwarded — see `append_mutable`.
        unsafe { Self::print_with_type(this, args) }
    }

    /// Append `value`, returning a stable `&[u8]` over the freshly-reserved bytes.
    ///
    /// Takes `*mut Self` (not `&mut self`) so callers can pass the raw
    /// `bss_string_list!` singleton pointer directly without first
    /// materializing a `&mut Self` — see [`append_mutable`] for the full
    /// rationale. The inner mutex is the sole serialization point.
    ///
    /// SAFETY: `this` must point to a live, initialized `BSSStringList`
    /// (typically the `bss_string_list!` singleton). Concurrent callers are
    /// allowed.
    #[inline]
    pub unsafe fn append<'a, A: BSSAppendable>(
        this: *mut Self,
        value: &A,
    ) -> core::result::Result<&'a [u8], AllocError> {
        // SAFETY: `this` is live; `Mutex: Sync` so concurrent `&Mutex` formation
        // is sound. `MutexGuard` stores a raw pointer (see its doc), so the
        // `&mut *this` formed below does not alias a live guard borrow.
        let _guard = unsafe { (*this).mutex.lock() };
        // SAFETY: inner mutex held ⇒ this thread has exclusive access.
        let (ptr, len) = unsafe { (*this).do_append(value)? };
        // SAFETY: `ptr` points into storage owned by `*this` (backing_buf or a
        // process-lifetime mimalloc region); the slot was freshly reserved under
        // the mutex so no other writer aliases it, and reborrowing as shared is
        // always sound.
        Ok(unsafe { core::slice::from_raw_parts(ptr, len) })
    }

    /// Append `value` lowercased ASCII-wise.
    ///
    /// The previous port routed the lowercase scratch through a
    /// `thread_local! { RefCell<Box<[u8; 4096]>> }`, which (a) heap-allocs 4 KiB
    /// on first use per thread and (b) pays a `RefCell` flag check per call.
    /// Filenames are overwhelmingly <256 bytes, so a stack scratch suffices for
    /// the hot path; longer inputs (rare — full paths) fall through to a
    /// one-shot heap temp. No TLS, no Box-on-first-use, no `RefCell`.
    ///
    /// SAFETY: see [`append`].
    pub unsafe fn append_lower_case<'a>(
        this: *mut Self,
        value: &[u8],
    ) -> core::result::Result<&'a [u8], AllocError> {
        // SAFETY: see `append`.
        let _guard = unsafe { (*this).mutex.lock() };

        // `do_append` only reads `slice` via `BSSAppendable::copy_into` (copies
        // into `self.backing_buf` / a fresh heap alloc) and returns raw parts
        // pointing at that owned storage, not at `slice` — so the scratch
        // buffer's borrow does not escape.
        let (ptr, len) = if value.len() <= 256 {
            let mut scratch = [0u8; 256];
            // SAFETY: inner mutex held ⇒ this thread has exclusive access.
            unsafe {
                (*this).do_append(&crate::copy_lowercase(value, &mut scratch[..value.len()]))?
            }
        } else {
            // Slow path: input >256 bytes (rare). Use a one-shot heap temp via
            // mimalloc directly (PORTING.md forbids `Vec` in hot allocators).
            let p = mimalloc::mi_malloc(value.len()).cast::<u8>();
            if p.is_null() {
                return Err(AllocError);
            }
            // SAFETY: `p` is a fresh allocation of `value.len()` bytes; sole owner.
            let tmp = unsafe { core::slice::from_raw_parts_mut(p, value.len()) };
            // SAFETY: inner mutex held ⇒ this thread has exclusive access.
            let r = unsafe { (*this).do_append(&crate::copy_lowercase(value, tmp)) };
            // SAFETY: `p` was allocated by `mi_malloc` above.
            unsafe { mimalloc::mi_free(p.cast()) };
            r?
        };
        // SAFETY: see `append`.
        Ok(unsafe { core::slice::from_raw_parts(ptr, len) })
    }

    /// Returns `(ptr, len)` of the freshly-appended payload (excluding the trailing NUL),
    /// where `ptr` carries write provenance (`out.as_mut_ptr()`). Callers reconstruct a
    /// `&[u8]` (`append`) or `&mut [u8]` (`append_mutable`) from it; returning raw parts
    /// avoids the `&self.backing_buf` ↔ `&mut self.slice_buf` borrowck conflict and
    /// `&[u8] → &mut [u8]` provenance laundering.
    #[inline]
    fn do_append<A: BSSAppendable>(
        &mut self,
        value: &A,
    ) -> core::result::Result<(*mut u8, usize), AllocError> {
        let value_len: usize = value.total_len() + 1;

        let (out_ptr, out_len): (*mut u8, usize);
        let mut from_heap = false;
        if value_len + (self.backing_buf_used as usize) < self.backing_buf.len() - 1 {
            let start = self.backing_buf_used as usize;
            self.backing_buf_used += value_len as u64;
            let end = self.backing_buf_used as usize;

            // SAFETY: `backing_buf` is a process-lifetime mapping of
            // `COUNT*ITEM_LENGTH` writable bytes owned by this singleton; we
            // hold `&mut self` so no other live borrow of the region exists.
            // Forming `&mut [u8]` only over `[start..end]` — these bytes are
            // about to be fully written (payload + trailing NUL), so no uninit
            // byte is exposed through the reference.
            let dst: &mut [u8] = unsafe {
                core::slice::from_raw_parts_mut(
                    self.backing_buf.as_ptr().cast::<u8>().add(start),
                    end - start,
                )
            };
            value.copy_into(&mut dst[..value_len - 1]);
            dst[value_len - 1] = 0;

            (out_ptr, out_len) = (dst.as_mut_ptr(), value_len - 1);
        } else {
            // Propagate OOM.
            let ptr = default_alloc::malloc(value_len).cast::<u8>();
            if ptr.is_null() {
                return Err(AllocError);
            }
            from_heap = true;
            // SAFETY: `ptr` is a fresh allocation of `value_len` bytes with no other alias.
            let value_buf = unsafe { core::slice::from_raw_parts_mut(ptr, value_len) };
            value.copy_into(&mut value_buf[..value_len - 1]);
            value_buf[value_len - 1] = 0;
            let out = &mut value_buf[..value_len - 1];
            (out_ptr, out_len) = (out.as_mut_ptr(), out.len());
        }

        let mut result = IndexType::new(
            u32::MAX >> 1,
            self.slice_buf_used as usize > Self::MAX_INDEX,
        );

        if result.is_overflow() {
            result.set_index(self.overflow_list.len());
        } else {
            result.set_index(self.slice_buf_used as u32);
            self.slice_buf_used += 1;
        }

        // SAFETY: `out_ptr` addresses self.backing_buf or a process-lifetime alloc, both
        // outliving 'static (singleton).
        let stored: &'static [u8] = unsafe { core::slice::from_raw_parts(out_ptr, out_len) };

        if result.is_overflow() {
            if self.overflow_list.len() == result.index() {
                if let Err(e) = self.overflow_list.append(stored) {
                    if from_heap {
                        // SAFETY: `out_ptr` is the `default_alloc::malloc` above, unreferenced now.
                        unsafe { default_alloc::free(out_ptr.cast()) };
                    }
                    return Err(e);
                }
            } else {
                *self.overflow_list.at_index_mut(result) = stored;
            }
        } else {
            // SAFETY: `slice_buf` is a process-lifetime mapping of `COUNT`
            // `&[u8]`-sized slots owned by this singleton; `result.index() <
            // slice_buf_used <= COUNT`; we hold `&mut self`. Raw write — slot
            // may be uninit.
            unsafe {
                self.slice_buf
                    .as_ptr()
                    .cast::<MaybeUninit<&'static [u8]>>()
                    .add(result.index() as usize)
                    .write(MaybeUninit::new(stored));
            }
        }
        Ok((out_ptr, out_len))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES>
// ──────────────────────────────────────────────────────────────────────────

pub struct BSSMapInner<ValueType, const COUNT: usize, const REMOVE_TRAILING_SLASHES: bool> {
    pub(crate) index: IndexMap,
    pub overflow_list: OverflowList<ValueType, BSS_OVERFLOW_BLOCK_SIZE>,
    pub(crate) mutex: Mutex,
    // Only `[0..backing_buf_used]` is initialized.
    pub backing_buf: [MaybeUninit<ValueType>; COUNT],
    pub backing_buf_used: u16,
}

impl<ValueType, const COUNT: usize, const REMOVE_TRAILING_SLASHES: bool>
    BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES>
{
    const MAX_INDEX: usize = COUNT - 1;

    /// In-place field initialization into uninitialized storage.
    ///
    /// SAFETY: `slot` must point to writable, properly-aligned, uninitialized
    /// storage of `size_of::<Self>()` bytes that lives for `'static`.
    /// `backing_buf` is intentionally left uninitialized; only `[0..used]` is read.
    pub unsafe fn init_at(slot: *mut Self) {
        // SAFETY: caller contract — `slot` is a valid, exclusive, aligned
        // `*mut Self` in all-zeros storage from `bss_heap_init`. The 32 KiB
        // `overflow_list.list.ptrs` array is already `[None; 4096]` (null
        // niche), so write only the three counters; `backing_buf` is
        // intentionally left uninitialized.
        unsafe {
            addr_of_mut!((*slot).mutex).write(Mutex::new());
            addr_of_mut!((*slot).index).write(IndexMap::default());
            addr_of_mut!((*slot).backing_buf_used).write(0);
            OverflowList::init_counters_at(addr_of_mut!((*slot).overflow_list));
        }
    }

    /// Heap-allocate and initialize a fresh instance. Once-guard is the caller's
    /// responsibility — use `bss_map_inner!` for the canonical singleton.
    pub fn init() -> NonNull<Self> {
        bss_heap_init(Self::init_at)
    }

    // With `IndexMap = HashMap`, Drop frees it; singleton Box drop frees instance.

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

    pub fn get_or_put(
        &mut self,
        denormalized_key: &[u8],
    ) -> core::result::Result<Result, AllocError> {
        let _key = Self::key_hash(denormalized_key);

        let _guard = self.mutex.lock();
        match self.index.entry(_key) {
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

    pub fn get(&mut self, denormalized_key: &[u8]) -> Option<&mut ValueType> {
        let _key = Self::key_hash(denormalized_key);
        // Hold the lock across `at_index` —
        // a concurrent `put()` could otherwise mutate `overflow_list`/`backing_buf` while
        // we dereference `index`. `MutexGuard` holds a raw pointer (see [`Mutex`] docs),
        // so it does not conflict with the `&mut self` borrow in `at_index`.
        let _guard = self.mutex.lock();
        let index = self.index.get(&_key).copied()?;
        self.at_index(index)
    }

    pub fn mark_not_found(&mut self, result: Result) {
        let _guard = self.mutex.lock();
        self.index.insert(result.hash, NOT_FOUND);
    }

    pub fn at_index(&mut self, index: IndexType) -> Option<&mut ValueType> {
        if index.index() == NOT_FOUND.index() || index.index() == UNASSIGNED.index() {
            return None;
        }

        if index.is_overflow() {
            Some(self.overflow_list.at_index_mut(index))
        } else {
            // SAFETY: a non-sentinel, non-overflow index was assigned by `put`, which
            // initialized this slot via `.write()`.
            Some(unsafe { self.backing_buf[index.index() as usize].assume_init_mut() })
        }
    }

    pub fn put(
        &mut self,
        result: &mut Result,
        value: ValueType,
    ) -> core::result::Result<&mut ValueType, AllocError> {
        let _guard = self.mutex.lock();

        if result.index.index() == NOT_FOUND.index() || result.index.index() == UNASSIGNED.index() {
            result
                .index
                .set_is_overflow(self.backing_buf_used as usize > Self::MAX_INDEX);
            if result.index.is_overflow() {
                result.index.set_index(self.overflow_list.len());
            } else {
                result.index.set_index(self.backing_buf_used as u32);
                self.backing_buf_used += 1;
            }
        }

        // Insert into `index` only after the slot is materialized below, so a
        // failed (fallible) `append` can't leave a dangling hash -> index entry.
        let ret = if result.index.is_overflow() {
            if self.overflow_list.len() == result.index.index() {
                self.overflow_list.append(value)?
            } else {
                let ptr = self.overflow_list.at_index_mut(result.index);
                *ptr = value;
                ptr
            }
        } else {
            let idx = result.index.index() as usize;
            // Raw write — fresh slots are uninit; no drop glue runs.
            self.backing_buf[idx].write(value);
            // SAFETY: just initialized on the line above.
            unsafe { self.backing_buf[idx].assume_init_mut() }
        };
        self.index.insert(result.hash, result.index);
        Ok(ret)
    }

    /// Returns true if the entry was removed.
    pub fn remove(&mut self, denormalized_key: &[u8]) -> bool {
        let _guard = self.mutex.lock();
        let _key = Self::key_hash(denormalized_key);
        self.index.remove(&_key).is_some()
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
