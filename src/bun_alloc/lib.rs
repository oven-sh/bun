// bun_threading depends on this crate, so importing its `Mutex` would create a dependency cycle.
#![allow(clippy::disallowed_types)]
#![feature(arbitrary_self_types_pointers)]
#![feature(allocator_api)]
#![feature(core_io, core_io_borrowed_buf)]
// `#[thread_local]` (vs the `thread_local!` macro) compiles to a bare
// `__thread` slot — single `mov reg, fs:[OFFSET]` access, no `LocalKey`
// `__getit()` wrapper, no lazy-init flag check, no dtor-registration probe.
#![feature(thread_local)]

use core::io::{BorrowedBuf, BorrowedCursor};
use core::mem::MaybeUninit;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports
// ──────────────────────────────────────────────────────────────────────────

pub use bun_mimalloc_sys::mimalloc;
pub mod c_thunks;

// PORTING.md §Allocators: AST crates thread an `Arena`; non-AST use Vec/Box
// (global mimalloc). `Arena` is the real per-heap `MimallocArena` — unlike
// `bumpalo::Bump`, it supports per-allocation free + realloc, so `ArenaVec`
// no longer leaks on grow.
pub use mimalloc_arena::{BlockChunk, FreeInProgress, MimallocArena};
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

// ── Allocator modules: per-module disposition (PORTING.md §Allocators) ──
//
//   MimallocArena            → prefer `bun_alloc::Arena` (= bumpalo::Bump)
//   heap_breakdown           → macOS malloc_zone_* per-tag heaps (debug builds)
//   basic                    → `impl GlobalAlloc for Mimalloc` above is the canonical impl
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

pub use stack_fallback::ArenaPtr;

#[path = "MimallocArena.rs"]
pub mod mimalloc_arena;

mod hashbrown_bridge;
/// Re-export so `bun_collections` can name the polyfill trait in
/// `HashIndex`'s `A` bound.
pub use allocator_api2::alloc::Allocator as HashbrownAllocator;

// ── tier-0 local primitives ───────────────────────────────────────────────
// Real, self-contained helpers. These are the
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
/// `bun_core::fmt` re-exports it and adds an `io::Write` impl for write-only sites.
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
// LAYERING: `bun_alloc` is below `bun_threading` in the crate graph, so the
// futex-backed `bun_threading::Mutex` is unavailable here; `std::sync` (itself
// futex-backed since Rust 1.62) is the dependency-free stand-in.
pub(crate) struct Mutex<T>(std::sync::Mutex<T>);
impl<T> Mutex<T> {
    pub(crate) const fn new(value: T) -> Self {
        Self(std::sync::Mutex::new(value))
    }
    #[inline]
    pub(crate) fn lock(&self) -> std::sync::MutexGuard<'_, T> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
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
        // `mi_realloc` leaves a block where it is while it stays half full, and a list that grew by doubling is always more than half
        // full: `shrink_to_fit` and `into_boxed_slice` gave nothing back. Whoever shrinks a block keeps it, so it moves to a block of its
        // size. Of a large block the end was never touched and takes no memory.
        const LARGEST_BLOCK_MOVED: usize = 64 << 10;
        if new_size < layout.size()
            && new_size > 0
            && layout.size() <= LARGEST_BLOCK_MOVED
            && layout.align() <= MI_MAX_ALIGN_SIZE
            // SAFETY: `ptr` is a live mimalloc allocation.
            && mimalloc::mi_good_size(new_size) < unsafe { mimalloc::mi_usable_size(ptr.cast()) }
        {
            let moved: *mut u8 = mimalloc::mi_malloc(new_size).cast();
            if !moved.is_null() {
                // SAFETY: both blocks hold `new_size` bytes and are distinct, and `ptr` is not used again.
                unsafe {
                    core::ptr::copy_nonoverlapping(ptr, moved, new_size);
                    mimalloc::mi_free(ptr.cast());
                }
                return moved;
            }
        }
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
/// `m_ref_count` and `m_hash_and_flags` are interior-mutable: Rust, C++ and other threads write them behind a `&Self`.
#[repr(C)]
pub struct WTFStringImplStruct {
    /// `std::atomic<uint32_t> m_refCount` (StringImpl.h:162).
    pub(crate) m_ref_count: AtomicU32,
    pub(crate) m_length: u32,
    /// `m_data8` or `m_data16`.
    m_ptr: NonNull<u8>,
    pub(crate) m_hash_and_flags: core::cell::Cell<u32>,
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
        self.m_ref_count.load(Ordering::Relaxed) / Self::S_REF_COUNT_INCREMENT
    }
    #[inline(always)]
    fn is_static(&self) -> bool {
        let count = self.m_ref_count.load(Ordering::Relaxed);
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
            .m_ref_count
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
    ///
    /// # Safety
    /// The caller owns a ref on `this` and gives it up.
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: the caller's ref keeps `this` alive until the count is decremented.
        let old = unsafe {
            if (*this).is_static() {
                return;
            }
            (*this)
                .m_ref_count
                .fetch_sub(Self::S_REF_COUNT_INCREMENT, Ordering::Relaxed)
        };
        debug_assert!(old > 0); // hasAtLeastOneRef
        if old != Self::S_REF_COUNT_INCREMENT {
            return;
        }
        // Cold path: last reference dropped — hand the impl to C++ for
        // destruction (handles substring/symbol/external buffer ownership).
        // SAFETY: `old == s_refCountIncrement` ⇒ count is now 0 and we held
        // the sole ref; `this` is not touched again after this call.
        unsafe { Bun__WTFStringImpl__destroy(this) };
    }
    /// The address of the character buffer.
    #[inline]
    pub fn as_ptr(&self) -> *const u8 {
        self.m_ptr.as_ptr()
    }
    #[inline]
    pub fn byte_slice(&self) -> &[u8] {
        // SAFETY: the character buffer has that many bytes, and lives as long as `self`.
        unsafe { core::slice::from_raw_parts(self.as_ptr(), self.byte_length()) }
    }
    #[inline]
    pub fn latin1_slice(&self) -> &[u8] {
        debug_assert!(self.is_8bit());
        // SAFETY: as in `byte_slice`; `m_length` is at most `byte_length()`.
        unsafe { core::slice::from_raw_parts(self.as_ptr(), self.m_length as usize) }
    }
    #[inline]
    pub fn as_utf16(&self) -> Option<&[u16]> {
        if self.is_8bit() {
            return None;
        }
        // SAFETY: WebKit guarantees `m_ptr` valid for `m_length` u16s when !8-bit.
        Some(unsafe {
            core::slice::from_raw_parts(self.m_ptr.cast().as_ptr(), self.m_length as usize)
        })
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
    // `m_ref_count` / `m_hash_and_flags`, both interior-mutable, so writes through
    // a `&`-derived pointer are sound. The type encodes the only validity
    // precondition, so `safe fn` discharges the link-time proof.
    // `ref`/`deref` are inlined in Rust above; only the cold last-ref
    // `destroy` path crosses FFI. `*const` + `unsafe`: it frees the
    // allocation backing the pointer.
    fn Bun__WTFStringImpl__destroy(this: *const WTFStringImplStruct);
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
/// `bytes` in a way the optimizer cannot elide. `fill` on bytes is a bulk
/// `write_bytes` (lowers to `memset`) instead of a per-byte volatile loop so
/// debug builds don't pay O(len) iteration overhead — the SSLConfig leak test
/// secure-zeros ~300 MiB of cert material across 1200 iterations and the
/// per-byte loop alone took ~3 s in debug. `black_box` on the pointer after
/// the memset forces the compiler to assume the zeroed region is observed,
/// preventing dead-store elimination in release builds.
#[inline]
pub fn secure_zero(bytes: &mut [u8]) {
    bytes.fill(0);
    // Treat the pointer as escaped so the preceding stores cannot be eliminated.
    core::hint::black_box(bytes.as_mut_ptr());
    core::sync::atomic::compiler_fence(core::sync::atomic::Ordering::SeqCst);
}

/// Memory is typically not decommitted immediately when freed. Sensitive
/// information kept in memory can be read until the OS decommits it or the
/// allocator reuses it. Zero it before dropping.
///
/// Uses [`secure_zero`] so the zeroing cannot be elided by the optimizer.
pub fn free_sensitive(mut slice: Box<[u8]>) {
    secure_zero(&mut slice);
    drop(slice);
}

/// Reserve `size` bytes of process-lifetime storage.
///
/// On unix this carves a sub-range out of a single process-wide
/// `mmap(MAP_PRIVATE|MAP_ANONYMOUS|MAP_NORESERVE)` arena: pages are not
/// committed until first written to, so a 532 KiB `BSSStringList` backing
/// buffer that only ever sees a handful of filenames touches one or two pages
/// instead of all 130. On Windows this falls back to `mi_malloc_aligned`.
///
/// The mapping is **never freed** — these are `.bss`-semantics
/// singletons. Do not call from code paths that need to release the storage.
///
/// **Coalesced arena.** An earlier version
/// `mmap`ed each one separately, costing 6 `mmap` syscalls + 6 VMAs on the
/// `bun run <npm-script>` path (≈2 MiB in total) before any user code
/// runs. We instead bump-allocate every request out of one lazily-mapped
/// [`BSS_ARENA_SIZE`] region, restoring the single-VMA `.bss` locality and
/// dropping the syscall count to 1. Requests that overflow the arena (none
/// today) fall through to a dedicated `mmap`.
///
/// Returned pointer is `align`-aligned (`align ≤ 4096`).
#[inline]
fn bss_lazy_bytes(size: usize, align: usize) -> NonNull<u8> {
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
        // so the simpler eager allocation is kept.
        mimalloc::mi_malloc_aligned(size, align).cast::<u8>()
    };
    NonNull::new(ptr).expect("OOM")
}

/// Size of the demand-zero arena behind [`bss_lazy_bytes`] on unix, whose callers take
/// ≈2.3 MiB. `MAP_NORESERVE` means the unused tail costs only address space.
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
    // committed memory).
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
    // SAFETY: anonymous private mapping — fd/offset ignored, `len` is non-zero; failure handled below.
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
    // whose owning pointer lives inside a `BSSList` is reported as a leak — which then
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
fn bss_lazy_slice<T>(count: usize) -> &'static mut [MaybeUninit<T>] {
    const { assert!(align_of::<T>() <= 4096) };
    // Miri has no `MAP_NORESERVE` or `madvise`.
    if cfg!(miri) {
        return Box::leak(Box::new_uninit_slice(count));
    }
    let layout = core::alloc::Layout::array::<T>(count).unwrap_or_else(|_| crate::out_of_memory());
    let p = bss_lazy_bytes(layout.size(), layout.align());
    // SAFETY: `p` is aligned storage for `count` values, given to this call alone and never freed.
    unsafe { core::slice::from_raw_parts_mut(p.as_ptr().cast(), count) }
}

/// Heap storage, never freed, for a store whose `bss_lazy_slice` is used up.
#[cold]
fn bss_overflow_slice<T>(
    count: usize,
) -> core::result::Result<&'static mut [MaybeUninit<T>], AllocError> {
    let slice = Box::leak(Box::try_new_uninit_slice(count).map_err(|_| AllocError)?);
    #[cfg(bun_asan)]
    {
        unsafe extern "C" {
            safe fn __lsan_ignore_object(ptr: *const core::ffi::c_void);
        }
        __lsan_ignore_object(slice.as_ptr().cast());
    }
    Ok(slice)
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
        *ZONE.get_or_init(|| $crate::heap_breakdown::Zone::init($name))
    }};
}

// ──────────────────────────────────────────────────────────────────────────
// BSSList / BSSStringList
// ──────────────────────────────────────────────────────────────────────────

/// Hands out slots that live as long as the process.
pub struct BSSList<T: 'static, const OVERFLOW_COUNT: usize> {
    unused: &'static mut [MaybeUninit<T>],
}

impl<T, const OVERFLOW_COUNT: usize> BSSList<T, OVERFLOW_COUNT> {
    pub fn new(count: usize) -> Self {
        Self {
            unused: bss_lazy_slice(count),
        }
    }

    #[inline(always)]
    pub fn append_uninit(&mut self) -> &'static mut MaybeUninit<T> {
        if self.unused.is_empty() {
            self.unused =
                bss_overflow_slice(OVERFLOW_COUNT).unwrap_or_else(|_| crate::out_of_memory());
        }
        self.unused.split_off_first_mut().expect("not empty")
    }
}

/// Keeps NUL-terminated copies of strings for as long as the process lives.
pub struct BSSStringList {
    addresses: core::ops::Range<usize>,
    unused: Mutex<&'static mut [MaybeUninit<u8>]>,
}

struct CursorWriter<'a>(BorrowedCursor<'a, u8>);

impl core::fmt::Write for CursorWriter<'_> {
    #[inline]
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        if s.len() > self.0.capacity() {
            return Err(core::fmt::Error);
        }
        self.0.append(s.as_bytes());
        Ok(())
    }
}

impl BSSStringList {
    pub fn new(capacity: usize) -> Self {
        let unused = bss_lazy_slice(capacity);
        let start = unused.as_ptr().addr();
        Self {
            addresses: start..start + capacity,
            unused: Mutex::new(unused),
        }
    }

    /// `value` with the store's lifetime, if it points into the store's first `capacity` bytes.
    pub fn as_interned(&self, value: &[u8]) -> Option<&'static [u8]> {
        let p = value.as_ptr().addr();
        if p < self.addresses.start || self.addresses.end < p + value.len() {
            return None;
        }
        // SAFETY: `value` lies in storage that is never freed. The store gives out only shared
        // `'static` slices of it, and does not write to them afterwards.
        Some(unsafe { core::slice::from_raw_parts(value.as_ptr(), value.len()) })
    }

    /// Keeps what `fill` writes, which is at most `len` bytes.
    #[inline]
    fn append_with(
        &self,
        len: usize,
        fill: impl FnOnce(BorrowedCursor<'_, u8>),
    ) -> core::result::Result<&'static mut [u8], AllocError> {
        let reserved = self.unused.lock().split_off_mut(..=len);
        let mut buf = BorrowedBuf::from(match reserved {
            Some(reserved) => reserved,
            None => bss_overflow_slice(len + 1)?,
        });
        fill(buf.unfilled());
        let len = buf.len();
        buf.unfilled().append(&[0]);
        Ok(&mut buf.into_filled_mut()[..len])
    }

    #[inline]
    pub fn append(&self, value: &[u8]) -> core::result::Result<&'static [u8], AllocError> {
        Ok(self.append_with(value.len(), |mut cursor| cursor.append(value))?)
    }

    pub fn append_parts(&self, parts: &[&[u8]]) -> core::result::Result<&'static [u8], AllocError> {
        let len = parts.iter().map(|part| part.len()).sum();
        Ok(self.append_with(len, |mut cursor| {
            parts.iter().for_each(|part| cursor.append(part))
        })?)
    }

    pub fn append_lower_case(
        &self,
        value: &[u8],
    ) -> core::result::Result<&'static [u8], AllocError> {
        let stored = self.append_with(value.len(), |mut cursor| cursor.append(value))?;
        stored.make_ascii_lowercase();
        Ok(stored)
    }

    pub fn print(
        &self,
        args: core::fmt::Arguments<'_>,
    ) -> core::result::Result<&'static [u8], AllocError> {
        // What fits on the stack is formatted once instead of being counted first.
        let mut scratch = [MaybeUninit::uninit(); 512];
        let mut scratch = BorrowedBuf::from(&mut scratch[..]);
        if core::fmt::write(&mut CursorWriter(scratch.unfilled()), args).is_ok() {
            return self.append(scratch.filled());
        }
        Ok(self.append_with(fmt_count(args), |cursor| {
            core::fmt::write(&mut CursorWriter(cursor), args).expect("counted length")
        })?)
    }
}

/// Legacy default-allocator ZST. With `#[global_allocator]` set,
/// this is just a unit marker.
#[derive(Clone, Copy, Default)]
pub struct DefaultAlloc;

// `GenericAllocator` / `Borrowed<A>` / `Nullable<A>` are dropped — they modelled
// an allocator-borrowing discipline (avoid double-free), which Rust's
// ownership already enforces.

// ──────────────────────────────────────────────────────────────────────────
// `basic` module selection
// ──────────────────────────────────────────────────────────────────────────

// The real impl is `impl GlobalAlloc for Mimalloc` above.
#[path = "basic.rs"]
pub mod basic;
