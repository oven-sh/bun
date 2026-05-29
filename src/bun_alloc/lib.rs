//! Port of `src/bun_alloc/bun_alloc.zig`.
// bun_alloc is the T0 foundation crate that bun_threading and bun_collections
// depend on; importing either to satisfy the disallowed-types lint would create
// a dependency cycle.
#![allow(clippy::disallowed_types)]
#![feature(arbitrary_self_types_pointers)]
#![feature(allocator_api)]
#![feature(thread_local)]

use core::fmt::Write as _;
use core::mem::{MaybeUninit, size_of};
use core::ptr::{NonNull, addr_of_mut};
use core::sync::atomic::{AtomicU16, AtomicU32, Ordering};
use std::collections::HashMap;

// ──────────────────────────────────────────────────────────────────────────
// Re-exports (thin — match Zig `pub const X = @import(...)` lines)
// ──────────────────────────────────────────────────────────────────────────

pub use bun_mimalloc_sys::mimalloc;
pub mod c_thunks;

// ── Allocator vtable (mirrors std.mem.Allocator) ──────────────────────────
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Alignment(pub u8); // log2 of byte alignment, like std.mem.Alignment
impl Alignment {
    #[inline]
    pub const fn of<T>() -> Self {
        Self(core::mem::align_of::<T>().trailing_zeros() as u8)
    }
    #[inline]
    pub const fn to_byte_units(self) -> usize {
        1usize << self.0
    }
    #[inline]
    pub const fn from_byte_units(b: usize) -> Self {
        Self(b.trailing_zeros() as u8)
    }
}

#[cfg(windows)]
#[repr(C)]
struct MaxAlignT {
    _f: f64,
    _i: i64,
    _p: *const (),
}
#[cfg(windows)]
pub const MAX_ALIGN_T: usize = core::mem::align_of::<MaxAlignT>();
#[cfg(all(target_os = "freebsd", target_arch = "aarch64"))]
pub const MAX_ALIGN_T: usize = 16;
#[cfg(not(any(windows, all(target_os = "freebsd", target_arch = "aarch64"))))]
pub const MAX_ALIGN_T: usize = core::mem::align_of::<libc::max_align_t>();

pub struct AllocatorVTable {
    pub alloc: unsafe fn(*mut core::ffi::c_void, usize, Alignment, usize) -> *mut u8,
    pub resize: unsafe fn(*mut core::ffi::c_void, &mut [u8], Alignment, usize, usize) -> bool,
    pub remap: unsafe fn(*mut core::ffi::c_void, &mut [u8], Alignment, usize, usize) -> *mut u8,
    pub free: unsafe fn(*mut core::ffi::c_void, &mut [u8], Alignment, usize),
}
impl AllocatorVTable {
    pub const NO_ALLOC: unsafe fn(*mut core::ffi::c_void, usize, Alignment, usize) -> *mut u8 =
        |_, _, _, _| core::ptr::null_mut();
    pub const NO_RESIZE: unsafe fn(
        *mut core::ffi::c_void,
        &mut [u8],
        Alignment,
        usize,
        usize,
    ) -> bool = |_, _, _, _, _| false;
    pub const NO_REMAP: unsafe fn(
        *mut core::ffi::c_void,
        &mut [u8],
        Alignment,
        usize,
        usize,
    ) -> *mut u8 = |_, _, _, _, _| core::ptr::null_mut();

    /// Build a "free-only" vtable: `alloc`/`resize`/`remap` all no-op/fail and
    /// only `free` is meaningful. Each call site still gets its own `static`
    /// (vtable address is an identity tag for `is_instance`).
    pub const fn free_only(
        free: unsafe fn(*mut core::ffi::c_void, &mut [u8], Alignment, usize),
    ) -> Self {
        Self {
            alloc: Self::NO_ALLOC,
            resize: Self::NO_RESIZE,
            remap: Self::NO_REMAP,
            free,
        }
    }
}

/// `std.mem.Allocator` — fat (ptr + vtable). Distinct from the `Allocator` trait below.
#[derive(Clone, Copy)]
pub struct StdAllocator {
    pub ptr: *mut core::ffi::c_void,
    pub vtable: &'static AllocatorVTable,
}
/// Legacy alias for `AllocatorVTable`.
pub type VTable = AllocatorVTable;

// SAFETY: `ptr` is an opaque tag/context handle (Zig: `*anyopaque`); the
// vtable is `&'static`. Thread-safety of dispatch is the implementor's
// concern (mimalloc is thread-safe; FixedBufferAllocator is not — same as Zig).
unsafe impl Send for StdAllocator {}
// SAFETY: see the `Send` impl directly above.
unsafe impl Sync for StdAllocator {}

impl Default for StdAllocator {
    /// Zig: `bun.memory.initDefault(std.mem.Allocator)` → `bun.default_allocator`
    /// (mimalloc-backed `c_allocator`).
    #[inline]
    fn default() -> Self {
        basic::C_ALLOCATOR
    }
}

impl StdAllocator {
    /// Zig: `Allocator.rawAlloc`.
    #[inline]
    pub fn raw_alloc(&self, len: usize, alignment: Alignment, ra: usize) -> Option<*mut u8> {
        // SAFETY: vtable invariant — `alloc` callee respects (ptr, len, alignment, ra) contract.
        let p = unsafe { (self.vtable.alloc)(self.ptr, len, alignment, ra) };
        if p.is_null() { None } else { Some(p) }
    }
    /// Zig: `Allocator.rawResize`.
    #[inline]
    pub fn raw_resize(
        &self,
        buf: &mut [u8],
        alignment: Alignment,
        new_len: usize,
        ra: usize,
    ) -> bool {
        // SAFETY: see `raw_alloc`.
        unsafe { (self.vtable.resize)(self.ptr, buf, alignment, new_len, ra) }
    }
    /// Zig: `Allocator.rawRemap`.
    #[inline]
    pub fn raw_remap(
        &self,
        buf: &mut [u8],
        alignment: Alignment,
        new_len: usize,
        ra: usize,
    ) -> Option<*mut u8> {
        // SAFETY: see `raw_alloc`.
        let p = unsafe { (self.vtable.remap)(self.ptr, buf, alignment, new_len, ra) };
        if p.is_null() { None } else { Some(p) }
    }
    /// Zig: `Allocator.rawFree`.
    #[inline]
    pub fn raw_free(&self, buf: &mut [u8], alignment: Alignment, ra: usize) {
        // SAFETY: see `raw_alloc`.
        unsafe { (self.vtable.free)(self.ptr, buf, alignment, ra) }
    }
    /// Zig: `Allocator.free` — `rawFree` with `ret_addr = 0`, byte-aligned.
    #[inline]
    pub fn free(&self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        // SAFETY: `bytes` is reborrowed mutably only for the vtable signature; the
        // callee treats it as opaque (Zig passes `[]u8`).
        let buf =
            unsafe { core::slice::from_raw_parts_mut(bytes.as_ptr().cast_mut(), bytes.len()) };
        self.raw_free(buf, Alignment::from_byte_units(1), 0);
    }
}

/// `std.heap.FixedBufferAllocator` — bump allocator over a caller-owned buffer.
pub struct FixedBufferAllocator<'a> {
    end: usize,
    buffer: &'a mut [u8],
}
impl<'a> FixedBufferAllocator<'a> {
    #[inline]
    pub fn init(buffer: &'a mut [u8]) -> Self {
        Self { end: 0, buffer }
    }
    #[inline]
    pub fn reset(&mut self) {
        self.end = 0;
    }
    #[inline]
    pub fn owns_ptr(&self, p: *const u8) -> bool {
        let base = self.buffer.as_ptr() as usize;
        let q = p as usize;
        q >= base && q < base + self.buffer.len()
    }
    pub fn alloc(&mut self, len: usize, alignment: Alignment, _ra: usize) -> Option<*mut u8> {
        let base = self.buffer.as_mut_ptr() as usize;
        let aligned =
            (base + self.end + alignment.to_byte_units() - 1) & !(alignment.to_byte_units() - 1);
        let new_end = (aligned - base).checked_add(len)?;
        if new_end > self.buffer.len() {
            return None;
        }
        self.end = new_end;
        Some(aligned as *mut u8)
    }
    pub fn resize(&mut self, buf: &mut [u8], _a: Alignment, new_len: usize, _ra: usize) -> bool {
        // Only the last allocation can grow; shrinks always succeed.
        let buf_end = buf.as_ptr() as usize - self.buffer.as_ptr() as usize + buf.len();
        if buf_end != self.end {
            return new_len <= buf.len();
        }
        let new_end = buf_end - buf.len() + new_len;
        if new_end > self.buffer.len() {
            return false;
        }
        self.end = new_end;
        true
    }
    #[inline]
    pub fn remap(
        &mut self,
        buf: &mut [u8],
        a: Alignment,
        new_len: usize,
        ra: usize,
    ) -> Option<*mut u8> {
        if self.resize(buf, a, new_len, ra) {
            Some(buf.as_mut_ptr())
        } else {
            None
        }
    }
    #[inline]
    pub fn free(&mut self, buf: &mut [u8], _a: Alignment, _ra: usize) {
        // Only the last allocation can be freed.
        let buf_end = buf.as_ptr() as usize - self.buffer.as_ptr() as usize + buf.len();
        if buf_end == self.end {
            self.end -= buf.len();
        }
    }
}

pub use mimalloc_arena::MimallocArena;
pub type Arena = MimallocArena;
/// `bumpalo::Bump` — kept for genuinely bump-only scratch that's never resized.
pub type Bump = bumpalo::Bump;
mod baby_vec;
pub use baby_vec::BabyVec;
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

#[path = "BufferFallbackAllocator.rs"]
pub mod buffer_fallback_allocator;
pub mod fallback;
#[path = "MaxHeapAllocator.rs"]
pub mod max_heap_allocator;
pub mod maybe_owned;
#[path = "NullableAllocator.rs"]
pub mod nullable_allocator;
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

    #[inline]
    pub fn zalloc(size: usize) -> *mut c_void {
        if cfg!(bun_asan) {
            // SAFETY: `libc::calloc` has no input preconditions; null on failure.
            unsafe { libc::calloc(1, size) }
        } else {
            crate::mimalloc::mi_zalloc(size)
        }
    }

    #[inline]
    pub fn calloc(count: usize, size: usize) -> *mut c_void {
        if cfg!(bun_asan) {
            // SAFETY: `libc::calloc` has no input preconditions; null on failure.
            unsafe { libc::calloc(count, size) }
        } else {
            crate::mimalloc::mi_calloc(count, size)
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
        #[cfg(all(bun_asan, target_os = "linux"))]
        return unsafe { libc::malloc_usable_size(ptr.cast_mut()) };
        #[cfg(all(bun_asan, target_os = "macos"))]
        return unsafe { libc::malloc_size(ptr) };
        // SAFETY: caller guarantees `ptr` is a live mimalloc allocation (the
        // non-null check above already handled null).
        #[cfg(not(any(all(bun_asan, target_os = "linux"), all(bun_asan, target_os = "macos"))))]
        return unsafe { crate::mimalloc::mi_usable_size(ptr) };
    }

    // The aligned variants are `#[cfg]`-split (not `if cfg!()`) because the
    // posix_memalign/malloc_usable_size symbols don't exist on Windows.

    #[cfg(not(bun_asan))]
    #[inline]
    pub fn malloc_aligned(size: usize, align: usize) -> *mut c_void {
        crate::mimalloc::mi_malloc_auto_align(size, align)
    }

    #[cfg(bun_asan)]
    #[inline]
    pub fn malloc_aligned(size: usize, align: usize) -> *mut c_void {
        if align <= crate::MAX_ALIGN_T {
            return unsafe { libc::malloc(size) };
        }
        let mut p: *mut c_void = core::ptr::null_mut();
        let align = align.max(core::mem::size_of::<*mut c_void>());
        if unsafe { libc::posix_memalign(&mut p, align, size) } != 0 {
            return core::ptr::null_mut();
        }
        p
    }

    #[cfg(not(bun_asan))]
    #[inline]
    pub fn zalloc_aligned(size: usize, align: usize) -> *mut c_void {
        crate::mimalloc::mi_zalloc_auto_align(size, align)
    }

    #[cfg(bun_asan)]
    #[inline]
    pub fn zalloc_aligned(size: usize, align: usize) -> *mut c_void {
        if align <= crate::MAX_ALIGN_T {
            return unsafe { libc::calloc(1, size) };
        }
        let p = malloc_aligned(size, align);
        if !p.is_null() {
            unsafe { core::ptr::write_bytes(p.cast::<u8>(), 0, size) };
        }
        p
    }

    /// # Safety
    /// `ptr` must be null or a live allocation from the default allocator with the given `align`.
    #[cfg(not(bun_asan))]
    #[inline]
    pub unsafe fn realloc_aligned(ptr: *mut c_void, new_size: usize, align: usize) -> *mut c_void {
        // SAFETY: caller guarantees `ptr` is null or a live mimalloc allocation
        // with alignment `align`.
        unsafe { crate::mimalloc::mi_realloc_aligned(ptr, new_size, align) }
    }

    /// # Safety
    /// `ptr` must be null or a live allocation from the default allocator with the given `align`.
    #[cfg(bun_asan)]
    #[inline]
    pub unsafe fn realloc_aligned(ptr: *mut c_void, new_size: usize, align: usize) -> *mut c_void {
        if align <= crate::MAX_ALIGN_T {
            return unsafe { libc::realloc(ptr, new_size) };
        }
        let new_ptr = malloc_aligned(new_size, align);
        if new_ptr.is_null() {
            return core::ptr::null_mut();
        }
        if !ptr.is_null() {
            unsafe {
                let copy = usable_size(ptr).min(new_size);
                core::ptr::copy_nonoverlapping(ptr.cast::<u8>(), new_ptr.cast::<u8>(), copy);
                libc::free(ptr);
            }
        }
        new_ptr
    }
}

pub use buffer_fallback_allocator::BufferFallbackAllocator;
pub use max_heap_allocator::MaxHeapAllocator;
pub use maybe_owned::MaybeOwned;
pub use nullable_allocator::NullableAllocator;
pub use stack_fallback::{ArenaPtr, StackFallback};

#[path = "MimallocArena.rs"]
pub mod mimalloc_arena;

pub mod ast_alloc;
pub use ast_alloc::{AstAlloc, AstVec};
mod hashbrown_bridge;
/// Re-export so `bun_collections` can name the polyfill trait in
/// `StringHashMap`'s `A` bound without taking its own direct dep on
/// `allocator-api2`.
pub use allocator_api2::alloc::Allocator as HashbrownAllocator;

/// Zig: `std.fs.path.sep_str` — `"\\"` on Windows, `"/"` elsewhere.
/// Canonical tier-0 definition; re-exported by `bun_paths::SEP_STR`.
pub const SEP_STR: &str = if cfg!(windows) { "\\" } else { "/" };

/// Zig: `std.fs.path.sep` — `b'\\'` on Windows, `b'/'` elsewhere.
/// Canonical tier-0 definition; re-exported by `bun_paths::SEP` / `bun_core::SEP`.
pub const SEP: u8 = if cfg!(windows) { b'\\' } else { b'/' };

/// Zig: `std.mem.trimRight(u8, s, chars)`.
/// Canonical tier-0 definition; re-exported by `bun_core::strings::trim_right`.
#[inline]
pub fn trim_right<'a>(s: &'a [u8], chars: &[u8]) -> &'a [u8] {
    let mut end = s.len();
    while end > 0 && chars.contains(&s[end - 1]) {
        end -= 1;
    }
    &s[..end]
}

/// Zig: `std.mem.trimLeft(u8, s, chars)`.
/// Canonical tier-0 definition; re-exported by `bun_core::strings::trim_left`.
#[inline]
pub fn trim_left<'a>(s: &'a [u8], chars: &[u8]) -> &'a [u8] {
    let mut begin = 0usize;
    while begin < s.len() && chars.contains(&s[begin]) {
        begin += 1;
    }
    &s[begin..]
}

/// Zig: `std.mem.trim(u8, s, chars)` — strip `chars` from both ends.
/// Canonical tier-0 definition; re-exported by `bun_core::strings::trim`.
#[inline]
pub fn trim<'a>(s: &'a [u8], chars: &[u8]) -> &'a [u8] {
    trim_right(trim_left(s, chars), chars)
}

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

pub fn copy_lowercase_if_needed<'a>(in_: &'a [u8], out: &'a mut [u8]) -> &'a [u8] {
    if in_.iter().any(u8::is_ascii_uppercase) {
        copy_lowercase(in_, out)
    } else {
        in_
    }
}

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
    // Infallible: our `write_str` never errors, mirroring Zig's
    // `error.WriteFailed => unreachable`.
    let _ = core::fmt::write(&mut w, args);
    w.0
}

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

/// Port of `std.fmt.bufPrint` — render into `buf`, return the written sub-slice.
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

/// [`buf_print`] returning only the byte count — `std.fmt.bufPrint(..).len`.
#[inline]
pub fn buf_print_len(
    buf: &mut [u8],
    args: core::fmt::Arguments<'_>,
) -> core::result::Result<usize, core::fmt::Error> {
    let mut c = SliceCursor { buf, at: 0 };
    core::fmt::write(&mut c, args)?;
    Ok(c.at)
}

pub struct Mutex(std::sync::Mutex<()>);
impl Mutex {
    pub const fn new() -> Self {
        Self(std::sync::Mutex::new(()))
    }
    #[inline]
    pub fn lock(&self) -> MutexGuard {
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
pub struct MutexGuard {
    _guard: std::sync::MutexGuard<'static, ()>,
}
impl Default for Mutex {
    fn default() -> Self {
        Self::new()
    }
}

// Per PORTING.md type map: `OOM!T` / `error{OutOfMemory}!T` → `Result<T, bun_alloc::AllocError>`.
// This is the crate root, so define it here. Re-exported as `bun_core::OOM`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AllocError;

impl AllocError {
    /// Port of Zig `@errorName(error.OutOfMemory)`.
    #[inline]
    pub const fn name(self) -> &'static str {
        "OutOfMemory"
    }
}

/// Stamp out `impl From<AllocError> for $t { → $t::OutOfMemory }` for one or
/// more local error enums. Expansion is byte-identical to the hand-written
/// 3-line impls this replaces (PORTING.md: Zig `error{OutOfMemory,…}` sets).
#[macro_export]
macro_rules! oom_from_alloc {
    ($($t:ty),+ $(,)?) => { $(
        impl ::core::convert::From<$crate::AllocError> for $t {
            #[inline]
            fn from(_: $crate::AllocError) -> Self { <$t>::OutOfMemory }
        }
    )+ };
}

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

/// `bun.default_allocator.realloc(slice, new_size)` — resize a mimalloc-owned
/// byte allocation in place when possible, returning the (possibly moved) slice.
///
/// # Safety
/// `slice` must be backed by a live allocation from the default (mimalloc)
/// allocator with byte alignment ≤ `MI_MAX_ALIGN_SIZE`. After return, the old
/// `slice` reference is invalidated; only the returned slice is valid.
pub unsafe fn realloc_slice(
    slice: &mut [u8],
    new_size: usize,
) -> core::result::Result<&mut [u8], AllocError> {
    // SAFETY: caller guarantees `slice.as_mut_ptr()` is a mimalloc-owned block.
    let new_ptr = unsafe { mimalloc::mi_realloc(slice.as_mut_ptr().cast(), new_size) };
    if new_ptr.is_null() {
        return Err(AllocError);
    }
    // SAFETY: `mi_realloc` returns at least `new_size` bytes, aligned per
    // `MI_MAX_ALIGN_SIZE`, with the prefix preserved up to `min(old, new)`.
    Ok(unsafe { core::slice::from_raw_parts_mut(new_ptr.cast::<u8>(), new_size) })
}

/// Raw-pointer variant of [`realloc_slice`] for callers that cannot soundly
/// materialize a `&mut [u8]` over their buffer (e.g. it contains uninitialized
/// or padding bytes). Returns the new base pointer; `min(old_size, new_size)`
/// prefix bytes are preserved.
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

/// `mi_usable_size` — actual allocated size for a mimalloc-owned ptr.
#[inline]
pub fn usable_size(ptr: *const u8) -> usize {
    // SAFETY: `mi_usable_size` is null-safe (returns 0).
    unsafe { mimalloc::mi_usable_size(ptr.cast()) }
}

// ──────────────────────────────────────────────────────────────────────────
// Symbols hoisted DOWN into T0 so higher tiers can re-import without cycles.
// ──────────────────────────────────────────────────────────────────────────

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
// Source: Zig `std.heap.pageSize()` (used by LinuxMemFdAllocator / standalone_graph).
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
            #[repr(C)]
            struct SystemInfo {
                _w_processor_architecture: u16,
                _w_reserved: u16,
                dw_page_size: u32,
                _tail: [*mut core::ffi::c_void; 3],
                _ints: [u32; 5],
            }
            unsafe extern "system" {
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

// ── wtf (FastMalloc thread-cache release) ─────────────────────────────────
// Source: src/jsc/WTF.zig `releaseFastMallocFreeMemoryForThisThread`.
// MOVE_DOWN from bun_jsc so bun_threading (T2) can call it without a T6 dep.
pub mod wtf {
    unsafe extern "C" {
        // Defined in WebKit's WTF (linked into the final binary).
        // No preconditions; thread-safe.
        safe fn WTF__releaseFastMallocFreeMemoryForThisThread();
    }

    #[inline]
    pub fn release_fast_malloc_free_memory_for_this_thread() {
        // Zig: jsc.markBinding(@src()) — debug-only binding marker, dropped at T0.
        WTF__releaseFastMallocFreeMemoryForThisThread()
    }
}

/// Port of `bun.String.Tag`.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tag {
    Dead = 0,
    WTFStringImpl = 1,
    ZigString = 2,
    StaticZigString = 3,
    Empty = 4,
}

// `ZigString` pointer-tag scheme (ZigString.zig:629) — single source of truth.
// Flag bits live in the POINTER's high byte; untagging truncates to 53 bits.
pub const ZS_STATIC_BIT: usize = 1usize << 60;
pub const ZS_UTF8_BIT: usize = 1usize << 61;
pub const ZS_GLOBAL_BIT: usize = 1usize << 62;
pub const ZS_16BIT_BIT: usize = 1usize << 63;
pub const ZS_UNTAG_MASK: usize = (1usize << 53) - 1;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ZigString {
    /// Tagged pointer — never dereference directly; use `untagged()`.
    pub _unsafe_ptr_do_not_use: *const u8,
    pub len: usize,
}

impl ZigString {
    pub const EMPTY: ZigString = ZigString {
        _unsafe_ptr_do_not_use: b"".as_ptr(),
        len: 0,
    };

    #[inline]
    pub const fn init(slice: &[u8]) -> ZigString {
        ZigString {
            _unsafe_ptr_do_not_use: slice.as_ptr(),
            len: slice.len(),
        }
    }

    /// Construct from an already-tagged pointer + length. `ptr` is stored
    /// verbatim — tag bits are not touched.
    #[inline]
    pub const fn from_tagged_ptr(ptr: *const u8, len: usize) -> ZigString {
        ZigString {
            _unsafe_ptr_do_not_use: ptr,
            len,
        }
    }

    /// Raw tagged pointer (top-bit flags intact). Pair with
    /// [`from_tagged_ptr`]; do **not** dereference without [`untagged`].
    #[inline]
    pub const fn tagged_ptr(&self) -> *const u8 {
        self._unsafe_ptr_do_not_use
    }

    #[inline]
    pub fn init_utf16(items: &[u16]) -> ZigString {
        let mut out = ZigString {
            _unsafe_ptr_do_not_use: items.as_ptr().cast(),
            len: items.len(),
        };
        out.mark_utf16();
        out
    }

    #[inline]
    pub const fn length(&self) -> usize {
        self.len
    }
    #[inline]
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline]
    pub fn is_16bit(&self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & ZS_16BIT_BIT != 0
    }
    #[inline]
    pub fn is_utf8(&self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & ZS_UTF8_BIT != 0
    }
    #[inline]
    pub fn is_globally_allocated(&self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & ZS_GLOBAL_BIT != 0
    }
    #[inline]
    pub fn is_static(&self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & ZS_STATIC_BIT != 0
    }
    #[inline]
    pub fn mark_utf16(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | ZS_16BIT_BIT) as *const u8;
    }
    #[inline]
    pub fn mark_utf8(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | ZS_UTF8_BIT) as *const u8;
    }
    #[inline]
    pub fn mark_global(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | ZS_GLOBAL_BIT) as *const u8;
    }
    #[inline]
    pub fn mark_static(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | ZS_STATIC_BIT) as *const u8;
    }

    /// Zig `untagged`: `@ptrFromInt(@as(u53, @truncate(@intFromPtr(ptr))))`.
    #[inline]
    pub fn untagged(ptr: *const u8) -> *const u8 {
        ((ptr as usize) & ZS_UNTAG_MASK) as *const u8
    }

    /// 8-bit byte view (latin1 or utf8). Caller must ensure `!is_16bit()`.
    #[inline]
    pub fn slice(&self) -> &[u8] {
        if self.len == 0 {
            return &[];
        }
        // ZigString.zig:637 — only panics when `len > 0 and is16Bit()`.
        debug_assert!(
            !self.is_16bit(),
            "ZigString::slice() on UTF-16 string; use to_slice()"
        );
        // SAFETY: constructor stored a valid ptr/len; flag bits stripped. Zig
        // caps at u32::MAX (ZigString.zig:642).
        unsafe {
            core::slice::from_raw_parts(
                Self::untagged(self._unsafe_ptr_do_not_use),
                core::cmp::min(self.len, u32::MAX as usize),
            )
        }
    }

    /// UTF-16 code-unit view. Caller must ensure `is_16bit()`.
    #[inline]
    pub fn utf16_slice_aligned(&self) -> &[u16] {
        if self.len == 0 {
            return &[];
        }
        // ZigString.zig:436 — only panics when `len > 0 and !is16Bit()`.
        debug_assert!(self.is_16bit());
        // SAFETY: 16-bit-tagged constructor stored a 2-byte-aligned ptr valid
        // for `self.len` u16 units; flag bits stripped via `ZS_UNTAG_MASK`
        // (inlined `untagged()` so the cast goes `usize → *const u16` directly).
        unsafe {
            core::slice::from_raw_parts(
                ((self._unsafe_ptr_do_not_use as usize) & ZS_UNTAG_MASK) as *const u16,
                self.len,
            )
        }
    }
}

#[repr(C)]
pub struct WTFStringImplStruct {
    pub m_ref_count: core::cell::Cell<u32>,
    pub m_length: u32,
    pub m_ptr: WTFStringImplPtr,
    pub m_hash_and_flags: core::cell::Cell<u32>,
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
    pub const MAX: u32 = u32::MAX;

    // ---------------------------------------------------------------------
    // These details must stay in sync with WTFStringImpl.h in WebKit!
    // ---------------------------------------------------------------------
    pub const S_HASH_FLAG_8BIT_BUFFER: u32 = 1 << 2;
    /// The bottom bit in the ref count indicates a static (immortal) string.
    pub const S_REF_COUNT_FLAG_IS_STATIC_STRING: u32 = 0x1;
    /// This allows us to ref / deref without disturbing the static string flag.
    pub const S_REF_COUNT_INCREMENT: u32 = 0x2;

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
    #[inline]
    pub fn is_static(&self) -> bool {
        self.m_ref_count.get() & Self::S_REF_COUNT_FLAG_IS_STATIC_STRING != 0
    }
    #[inline]
    pub fn has_at_least_one_ref(&self) -> bool {
        // WTF::StringImpl::hasAtLeastOneRef
        self.m_ref_count.get() > 0
    }
    #[inline(always)]
    fn ref_count_atomic(&self) -> &AtomicU32 {
        // SAFETY: layout-compatible reborrow of `UnsafeCell<u32>` as
        // `AtomicU32`; see doc comment above.
        unsafe { AtomicU32::from_ptr(self.m_ref_count.as_ptr()) }
    }
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
    #[inline]
    pub fn ref_count_allocator(self: *mut Self) -> StdAllocator {
        StdAllocator {
            ptr: self.cast(),
            vtable: StringImplAllocator::VTABLE_PTR,
        }
    }
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
    pub fn latin1_byte_length(&self) -> usize {
        // Not all UTF-16 characters fit are representable in latin1.
        // Those get truncated?
        self.m_length as usize
    }
    #[inline]
    pub fn is_thread_safe(&self) -> bool {
        WTFStringImpl__isThreadSafe(self)
    }
    /// Compute the hash() if necessary
    #[inline]
    pub fn ensure_hash(&self) {
        Bun__WTFStringImpl__ensureHash(self);
    }
    #[inline]
    pub fn has_prefix(&self, text: &[u8]) -> bool {
        // SAFETY: `self` is a valid WTF::StringImpl; text.ptr/len describe a valid slice.
        unsafe { Bun__WTFStringImpl__hasPrefix(self, text.as_ptr(), text.len()) }
    }
    #[inline]
    pub fn to_zig_string(&self) -> ZigString {
        if self.is_8bit() {
            ZigString::init(self.latin1_slice())
        } else {
            ZigString::init_utf16(self.utf16_slice())
        }
    }
}

unsafe extern "C" {
    pub fn Bun__WTFStringImpl__destroy(this: *const WTFStringImplStruct);
    // Kept for Zig callers (`src/string/wtf.zig`); Rust no longer calls these.
    pub safe fn Bun__WTFStringImpl__ref(this: &WTFStringImplStruct);
    pub fn Bun__WTFStringImpl__deref(this: *const WTFStringImplStruct);
    safe fn WTFStringImpl__isThreadSafe(this: &WTFStringImplStruct) -> bool;
    safe fn Bun__WTFStringImpl__ensureHash(this: &WTFStringImplStruct);
    fn Bun__WTFStringImpl__hasPrefix(
        this: *const WTFStringImplStruct,
        text_ptr: *const u8,
        text_len: usize,
    ) -> bool;
}

#[allow(non_snake_case)] // Zig namespace `bun.String.StringImplAllocator`
pub mod StringImplAllocator {
    use super::{Alignment, AllocatorVTable, WTFStringImplStruct};

    unsafe fn alloc(ptr: *mut core::ffi::c_void, len: usize, _: Alignment, _: usize) -> *mut u8 {
        // SAFETY: vtable contract — `ptr` is the non-null `WTFStringImpl` passed
        // to `ref_count_allocator`, live with refcount ≥ 1 for this call. Single
        // deref site (nonnull-asref reduction) — `byte_length`/`r#ref` are safe
        // `&self` methods.
        let this = unsafe { &*ptr.cast::<WTFStringImplStruct>() };
        if this.byte_length() != len {
            // we don't actually allocate, we just reference count
            return core::ptr::null_mut();
        }
        this.r#ref();
        // we should never actually allocate
        // SAFETY: `m_ptr.latin1` is the byte-view union arm (both arms share
        // offset 0); valid for `byte_length()` bytes.
        unsafe { this.m_ptr.latin1 }.cast_mut()
    }

    unsafe fn free(ptr: *mut core::ffi::c_void, buf: &mut [u8], _: Alignment, _: usize) {
        // SAFETY: see `alloc` — single deref site for the vtable's `WTFStringImpl`
        // ctx pointer; `byte_slice`/`byte_length`/`deref` are safe `&self` methods.
        let this = unsafe { &*ptr.cast::<WTFStringImplStruct>() };
        debug_assert!(this.byte_slice().as_ptr() == buf.as_ptr());
        // Zig: `bun.assert(this.latin1Slice().len == buf.len)` — `latin1Slice().len` is
        // `byteLength()` (i.e. `m_length * 2` for UTF-16), not the code-unit count.
        debug_assert!(this.byte_length() == buf.len());
        this.deref();
    }

    pub static VTABLE: AllocatorVTable = AllocatorVTable {
        alloc,
        resize: AllocatorVTable::NO_RESIZE,
        remap: AllocatorVTable::NO_REMAP,
        free,
    };

    pub const VTABLE_PTR: &AllocatorVTable = &VTABLE;
}

/// Port of `bun.String.StringImpl` — `extern union`.
#[repr(C)]
#[derive(Clone, Copy)]
pub union StringImpl {
    pub zig_string: ZigString,
    pub wtf_string_impl: WTFStringImpl,
    // .StaticZigString aliases .zig_string; .Dead/.Empty are zero-width.
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct String {
    pub tag: Tag,
    pub value: StringImpl,
}

impl String {
    pub const NAME: &'static str = "BunString";

    /// Port of `bun.String.isWTFAllocator` — vtable-identity check against
    /// [`StringImplAllocator::VTABLE`].
    #[inline]
    pub fn is_wtf_allocator(alloc: StdAllocator) -> bool {
        core::ptr::eq(alloc.vtable, StringImplAllocator::VTABLE_PTR)
    }

    pub const EMPTY: String = String {
        tag: Tag::Empty,
        value: StringImpl {
            zig_string: ZigString::EMPTY,
        },
    };
    pub const DEAD: String = String {
        tag: Tag::Dead,
        value: StringImpl {
            zig_string: ZigString::EMPTY,
        },
    };

    #[inline(always)]
    fn wtf_impl(&self) -> &WTFStringImplStruct {
        debug_assert_eq!(self.tag, Tag::WTFStringImpl);
        // SAFETY: `tag == WTFStringImpl` ⇒ `wtf_string_impl` is the active
        // union field and a non-null, live `*mut WTFStringImplStruct`
        // (refcount ≥ 1 for the `String`'s lifetime).
        unsafe { &*self.value.wtf_string_impl }
    }

    #[inline]
    pub fn to_zig_string(&self) -> ZigString {
        match self.tag {
            Tag::StaticZigString | Tag::ZigString => {
                // SAFETY: `tag` is `ZigString`/`StaticZigString` ⇒ `zig_string`
                // is the active union field.
                unsafe { self.value.zig_string }
            }
            Tag::WTFStringImpl => self.wtf_impl().to_zig_string(),
            _ => ZigString::EMPTY,
        }
    }

    #[inline]
    pub fn length(&self) -> usize {
        if self.tag == Tag::WTFStringImpl {
            self.wtf_impl().length() as usize
        } else {
            self.to_zig_string().length()
        }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.length() == 0
    }

    #[inline]
    pub fn is_8bit(&self) -> bool {
        match self.tag {
            Tag::WTFStringImpl => self.wtf_impl().is_8bit(),
            Tag::StaticZigString | Tag::ZigString => {
                // SAFETY: `tag` is `ZigString`/`StaticZigString` ⇒ `zig_string`
                // is the active union field.
                unsafe { !self.value.zig_string.is_16bit() }
            }
            _ => true,
        }
    }

    pub fn eql_comptime(&self, other: &[u8]) -> bool {
        let zs = self.to_zig_string();
        if zs.is_16bit() {
            let u16s = zs.utf16_slice_aligned();
            if u16s.len() != other.len() {
                return false;
            }
            u16s.iter()
                .copied()
                .zip(other.iter().copied())
                .all(|(a, b)| a == b as u16)
        } else {
            zs.slice() == other
        }
    }
}

impl core::fmt::Display for String {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Port of `ZigString.format`: utf8 → write bytes; utf16 → transcode;
        // latin1 → widen each byte to a Unicode scalar.
        // PERF(port): was `bun.fmt.formatUTF16Type` / `formatLatin1` (SIMD).
        let zs = self.to_zig_string();
        if zs.len == 0 {
            return Ok(());
        }
        if zs.is_16bit() {
            for c in core::char::decode_utf16(zs.utf16_slice_aligned().iter().copied()) {
                f.write_char(c.unwrap_or(core::char::REPLACEMENT_CHARACTER))?;
            }
            Ok(())
        } else if zs.is_utf8() {
            // Zig wrote raw bytes; mirror that via lossy decode for Formatter.
            f.write_str(&std::string::String::from_utf8_lossy(zs.slice()))
        } else {
            for &b in zs.slice() {
                // Latin-1 byte → Unicode codepoint of the same value.
                f.write_char(b as char)?;
            }
            Ok(())
        }
    }
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

/// Zig: `bun.rangeOfSliceInBuffer` (`src/bun.zig`).
/// Returns `[offset, len]` if `slice` lies within `buffer`, else `None`.
pub fn range_of_slice_in_buffer(slice: &[u8], buffer: &[u8]) -> Option<[u32; 2]> {
    if !is_slice_in_buffer(slice, buffer) {
        return None;
    }
    let r = [
        // Zig: `@truncate(@intFromPtr(slice.ptr) -| @intFromPtr(buffer.ptr))`
        (slice.as_ptr() as usize).saturating_sub(buffer.as_ptr() as usize) as u32,
        slice.len() as u32,
    ];
    debug_assert_eq!(slice, &buffer[r[0] as usize..][..r[1] as usize]);
    Some(r)
}

/// Zig: `bun.freeSensitive` (`src/bun.zig`).
///
/// Zig: `bun.default_allocator.free(slice)` for raw `[]u8` not owned by a
/// `Vec`/`Box` (e.g. duped via `mi_malloc` on the C side, or via
/// [`StdAllocator::free`] on the Zig side). With `#[global_allocator] =
/// Mimalloc` this is `mi_free`; the `len` is accepted for size-asserting
/// builds and to mirror the Zig signature.
///
/// # Safety
/// `ptr` must be null or point to a live allocation of `len` bytes obtained
/// from the default (mimalloc-backed) allocator. Freed exactly once.
#[inline]
pub unsafe fn default_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    // SAFETY: caller contract — `ptr[..len]` is a live mimalloc allocation.
    let buf = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
    basic::C_ALLOCATOR.raw_free(buf, Alignment::from_byte_units(1), 0);
}

pub fn default_dupe(src: &[u8]) -> &'static [u8] {
    if src.is_empty() {
        return b"";
    }
    let ptr = basic::C_ALLOCATOR
        .raw_alloc(src.len(), Alignment::from_byte_units(1), 0)
        .unwrap_or_else(|| crate::out_of_memory());
    // SAFETY: `raw_alloc` returned a fresh, writable allocation of `src.len()`
    // bytes, byte-aligned; non-overlapping with `src`. The returned slice's
    // lifetime is tied to the matching `default_free` call (caller contract),
    // hence `'static` at the type level.
    unsafe {
        core::ptr::copy_nonoverlapping(src.as_ptr(), ptr, src.len());
        core::slice::from_raw_parts(ptr, src.len())
    }
}

/// Port of `std.crypto.secureZero` — `@memset(@volatileCast(s), 0)`. Zeros
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

/// Port of `bun.freeSensitive(bun.default_allocator, slice)` for the C-string
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
        secure_zero(p as *mut u8, len);
        crate::default_alloc::free(p as *mut core::ffi::c_void);
    }
}

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
    pub fn set_index(&mut self, index: u32) {
        self.0 = (self.0 & 0x8000_0000) | (index & 0x7FFF_FFFF);
    }
    #[inline]
    pub fn set_is_overflow(&mut self, v: bool) {
        self.0 = (self.0 & 0x7FFF_FFFF) | ((v as u32) << 31);
    }
    #[inline]
    pub const fn raw(self) -> u32 {
        self.0
    }
}

pub const NOT_FOUND: IndexType = IndexType::new(u32::MAX >> 1, false); // maxInt(u31)
pub const UNASSIGNED: IndexType = IndexType::new((u32::MAX >> 1) - 1, false); // maxInt(u31) - 1

#[repr(u8)] // Zig: enum(u3)
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ItemStatus {
    Unknown,
    Exists,
    NotFound,
}

pub mod allocators {
    pub use super::*;
}

#[macro_export]
macro_rules! bss_singleton {
    ($(#[$m:meta])* $vis:vis fn $name:ident() -> $ty:ty) => {
        $(#[$m])*
        #[inline(always)]
        $vis fn $name() -> *mut $ty {
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

#[doc(hidden)] // Public only for the `bss_singleton!` macro expansion in dependent crates.
#[inline]
pub fn bss_heap_init<T>(init_at: unsafe fn(*mut T)) -> NonNull<T> {
    let ptr = bss_lazy_bytes(size_of::<T>(), core::mem::align_of::<T>()).cast::<T>();
    // SAFETY: ptr is a fresh, exclusively-owned, properly-aligned, all-zeros-on-read
    // allocation; lives for process lifetime (singleton; never freed/unmapped,
    // matching Zig). `init_at` is therefore free to skip writing any field whose
    // all-zeros bit pattern is already a valid initial value (e.g. `OverflowList`'s
    // 32 KiB `[Option<Box<_>>; 4095]` array — `None` is the null niche).
    unsafe { init_at(ptr.as_ptr()) };
    ptr
}

#[doc(hidden)]
#[inline]
pub fn bss_lazy_bytes(size: usize, align: usize) -> NonNull<u8> {
    debug_assert!(size > 0);
    #[cfg(unix)]
    let ptr = {
        debug_assert!(align <= 4096 && align.is_power_of_two());
        bss_arena_bump(size, align)
    };
    #[cfg(not(unix))]
    let ptr = { mimalloc::mi_zalloc_aligned(size, align).cast::<u8>() };
    NonNull::new(ptr).expect("OOM")
}

#[cfg(unix)]
const BSS_ARENA_SIZE: usize = 4 * 1024 * 1024;

#[cfg(unix)]
fn bss_arena_bump(size: usize, align: usize) -> *mut u8 {
    use core::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};

    static BASE: AtomicPtr<u8> = AtomicPtr::new(core::ptr::null_mut());
    static CURSOR: AtomicUsize = AtomicUsize::new(0);

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
    #[cfg(bun_asan)]
    {
        unsafe extern "C" {
            safe fn __lsan_register_root_region(ptr: *const core::ffi::c_void, size: usize);
        }
        __lsan_register_root_region(p.cast(), len);
    }
    p.cast::<u8>()
}

#[doc(hidden)]
#[inline]
pub fn bss_lazy_slice<T>(count: usize) -> NonNull<[MaybeUninit<T>]> {
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

/// Declare a `BSSMapInner<T, COUNT, RM_SLASH>` (`store_keys=false`) singleton accessor.
#[macro_export]
macro_rules! bss_map_inner {
    ($(#[$m:meta])* $vis:vis $name:ident : $value_ty:ty, $count:expr, $rm_slash:expr) => {
        $crate::bss_singleton!($(#[$m])* $vis fn $name() -> $crate::BSSMapInner<$value_ty, { $count }, { $rm_slash }>);
    };
}

/// Declare a `BSSMap<T, COUNT, EST_KEY_LEN, RM_SLASH>` (`store_keys=true`) singleton accessor.
#[macro_export]
macro_rules! bss_map {
    ($(#[$m:meta])* $vis:vis $name:ident : $value_ty:ty, $count:expr, $est_key_len:expr, $rm_slash:expr) => {
        $crate::bss_singleton!($(#[$m])* $vis fn $name() -> $crate::BSSMap<$value_ty, { $count }, { $est_key_len }, { $rm_slash }>);
    };
}

// Compile-time smoke test for the declare-site macros (no runtime cost; the
// statics live in BSS and the accessors are dead-stripped if unused).
mod __bss_macro_smoke {
    crate::bss_list! { _l  : u32, 4 }
    crate::bss_string_list! { _sl : 4, 8 }
    crate::bss_map_inner! { _mi : u32, 4, true }
    crate::bss_map! { _m  : u32, 4, 8, false }
}

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

type HashKeyType = u64;

/// Zig `IndexMapContext` — identity hash on a u64 key. Keys here are already
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
pub type IndexMapManaged = HashMap<HashKeyType, IndexType, IndexMapHasher>;

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

    pub fn is_overflowing<const COUNT: usize>(&self) -> bool {
        // TODO(port): Zig compares the whole packed struct against a usize here
        // (`r.index >= count`); reproduce by comparing the raw u32.
        self.index.raw() as usize >= COUNT
    }
}

// ──────────────────────────────────────────────────────────────────────────
// OverflowGroup<Block>
// ──────────────────────────────────────────────────────────────────────────

/// Required interface for the `Block` parameter of `OverflowGroup`/`OverflowList`.
/// TODO(port): Zig used structural duck-typing; this trait names the methods the body calls.
pub trait OverflowBlock {
    /// In-place initialize the `used` counter on possibly-uninitialized storage.
    /// SAFETY: `this` must point to writable, properly-aligned storage of `Self`.
    unsafe fn zero(this: *mut Self);
    fn is_full(&self) -> bool;
    fn used_mut(&mut self) -> &mut u32;
}

const OVERFLOW_GROUP_MAX: usize = 4095;
// Zig: `UsedSize = std.math.IntFittingRange(0, max + 1)` → u13. Rust has no u13; use u16.
type OverflowUsedSize = u16;

pub struct OverflowGroup<Block> {
    // 16 million files should be good enough for anyone
    // ...right?
    pub used: OverflowUsedSize,
    pub allocated: OverflowUsedSize,
    pub ptrs: [Option<Box<Block>>; OVERFLOW_GROUP_MAX],
}

impl<Block: OverflowBlock> OverflowGroup<Block> {
    #[inline]
    pub fn zero(&mut self) {
        self.used = 0;
        self.allocated = 0;
    }

    pub fn tail(&mut self) -> &mut Block {
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
            // Zig: default_allocator.create(Block) catch unreachable
            // SAFETY: Box<MaybeUninit> → zero() initializes the `used` counter; payload array
            // is `[MaybeUninit<T>; N]` and stays uninit exactly as Zig does.
            let mut b: Box<core::mem::MaybeUninit<Block>> = Box::new_uninit();
            // SAFETY: `b.as_mut_ptr()` is a valid, exclusive, aligned `*mut Block`.
            unsafe { Block::zero(b.as_mut_ptr()) };
            // SAFETY: after `zero`, all non-`MaybeUninit` fields of `Block` are initialized.
            self.ptrs[self.allocated as usize] = Some(unsafe { b.assume_init() });
            self.allocated = self.allocated.wrapping_add(1);
        }

        self.ptrs[self.used as usize].as_mut().expect("alloc")
    }

    #[inline]
    pub fn slice(&mut self) -> &mut [Option<Box<Block>>] {
        &mut self.ptrs[0..self.used as usize]
    }
}

// ──────────────────────────────────────────────────────────────────────────
// OverflowList<ValueType, COUNT>
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): const-generic arithmetic (`[ValueType; COUNT]` inside a generic struct) requires
// `feature(generic_const_exprs)` on stable Rust. Pin COUNT per instantiation site
// or use a heap `Box<[ValueType]>` with debug_assert on len.

pub struct OverflowListBlock<ValueType, const COUNT: usize> {
    // Zig: `SizeType = std.math.IntFittingRange(0, count)`; use u32 here.
    pub used: u32,
    // Zig leaves `items` undefined and overwrites by raw memcpy (no drop).
    pub items: [MaybeUninit<ValueType>; COUNT],
}

impl<ValueType, const COUNT: usize> OverflowListBlock<ValueType, COUNT> {
    #[inline]
    pub fn is_full(&self) -> bool {
        self.used as usize >= COUNT
    }

    pub fn append(&mut self, value: ValueType) -> &mut ValueType {
        debug_assert!((self.used as usize) < COUNT);
        let index = self.used as usize;
        // Raw write — slot may be uninit; Zig assignment has no drop glue.
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
    pub list: OverflowGroup<OverflowListBlock<ValueType, COUNT>>,
    pub count: u32, // Zig: u31
}

impl<ValueType, const COUNT: usize> OverflowList<ValueType, COUNT> {
    #[inline]
    pub fn zero(&mut self) {
        self.list.zero();
        self.count = 0;
    }

    /// In-place init of just the three scalar counters (`list.used`,
    /// `list.allocated`, `count`) into storage that is already all-zeros.
    ///
    /// `list.ptrs: [Option<Box<_>>; 4095]` is ~32 KiB; the all-zeros bit
    /// pattern is `[None; 4095]` via the null-pointer niche, so when `slot`
    /// lives in a fresh `bss_lazy_bytes`/`bss_heap_init` mapping (always
    /// zero-on-read) we touch one cache line instead of faulting eight pages.
    ///
    /// SAFETY: `slot` must be a valid, exclusive, aligned `*mut Self` whose
    /// `list.ptrs` bytes are already zero (i.e. obtained from
    /// `bss_heap_init`/`bss_lazy_bytes`, NOT `mi_malloc`/stack `MaybeUninit`).
    #[inline]
    pub unsafe fn init_counters_at(slot: *mut Self) {
        // SAFETY: caller contract.
        unsafe {
            addr_of_mut!((*slot).list.used).write(0);
            addr_of_mut!((*slot).list.allocated).write(0);
            addr_of_mut!((*slot).count).write(0);
        }
    }

    #[inline]
    pub fn len(&self) -> u32 {
        self.count
    }

    #[inline]
    pub fn append(&mut self, value: ValueType) -> &mut ValueType {
        self.count += 1;
        self.list.tail().append(value)
    }

    pub fn reset(&mut self) {
        for block in self.list.slice() {
            block.as_mut().expect("alloc").used = 0;
        }
        self.list.used = 0;
    }

    #[inline]
    pub fn at_index(&self, index: IndexType) -> &ValueType {
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
                .get_unchecked(block_id)
                .as_ref()
                .unwrap_unchecked()
                .items
                .get_unchecked(idx % COUNT)
                .assume_init_ref()
        }
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

#[repr(C)]
pub struct BSSList<ValueType, const COUNT: usize /* = _COUNT * 2 */> {
    pub mutex: Mutex,
    // LIFETIMES.tsv: dual semantics — points at sibling `tail` OR a heap alloc.
    // TODO(port): lifetime — keep raw NonNull; self-referential when `head == &self.tail`.
    pub head: Option<NonNull<BSSListOverflowBlock<ValueType>>>,
    pub used: u32,
    pub tail: BSSListOverflowBlock<ValueType>,
    // Zig leaves `backing_buf` undefined; only `[0..used]` is initialized.
    pub backing_buf: [MaybeUninit<ValueType>; COUNT],
}

// SAFETY: `head` is a self-referential `NonNull` into `self.tail` or a heap block owned by
// `self`; all mutation goes through `self.mutex`. The raw pointer is the only `!Sync` field;
// the type is logically a mutex-guarded global (matches Zig's threadsafe singleton).
unsafe impl<ValueType: Send, const COUNT: usize> Send for BSSList<ValueType, COUNT> {}
// SAFETY: see the `Send` impl directly above — all access is mutex-serialized.
unsafe impl<ValueType: Send, const COUNT: usize> Sync for BSSList<ValueType, COUNT> {}

const BSS_LIST_CHUNK_SIZE: usize = 256;

pub const BSS_OVERFLOW_BLOCK_SIZE: usize = 64;

#[repr(C)]
pub struct BSSListOverflowBlock<ValueType> {
    pub used: AtomicU16,
    pub prev: Option<Box<BSSListOverflowBlock<ValueType>>>,
    // Zig leaves `data` undefined; only `[0..used]` is initialized.
    pub data: [MaybeUninit<ValueType>; BSS_LIST_CHUNK_SIZE],
}

impl<ValueType> BSSListOverflowBlock<ValueType> {
    /// In-place initialize `used` and `prev` on possibly-uninitialized storage.
    /// SAFETY: `this` must point to writable, properly-aligned storage of `Self`.
    #[inline]
    pub unsafe fn zero(this: *mut Self) {
        // Avoid struct initialization syntax.
        // This makes Bun start about 1ms faster.
        // https://github.com/ziglang/zig/issues/24313
        // SAFETY: caller guarantees `this` points to writable, aligned storage of
        // `Self`. Raw `ptr::write` because `*this` may be uninit — assignment
        // would run drop glue on garbage (`prev: Option<Box<..>>`).
        unsafe {
            addr_of_mut!((*this).used).write(AtomicU16::new(0));
            addr_of_mut!((*this).prev).write(None);
        }
    }

    pub fn append(&mut self, item: ValueType) -> core::result::Result<&mut ValueType, AllocError> {
        let index = self.used.fetch_add(1, Ordering::AcqRel);
        if index as usize >= BSS_LIST_CHUNK_SIZE {
            return Err(AllocError);
        }
        // Raw write — slot may be uninit; Zig assignment has no drop glue.
        self.data[index as usize].write(item);
        // SAFETY: just initialized on the line above.
        Ok(unsafe { self.data[index as usize].assume_init_mut() })
    }

    /// Reserve a slot and return its uninitialized storage. Caller MUST
    /// initialize the slot before any other access.
    #[inline(always)]
    pub fn append_uninit(
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
    pub const CHUNK_SIZE: usize = BSS_LIST_CHUNK_SIZE;
    const MAX_INDEX: usize = COUNT - 1;

    #[inline]
    pub fn block_index(index: u32 /* u31 */) -> usize {
        index as usize / BSS_LIST_CHUNK_SIZE
    }

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
    /// and `tail.data` are intentionally left uninitialized (Zig leaves them
    /// `undefined`); only `[0..used]` is read.
    pub unsafe fn init_at(slot: *mut Self) {
        // SAFETY: caller contract — `slot` is a valid, exclusive, aligned,
        // all-zeros `*mut Self`.
        unsafe {
            addr_of_mut!((*slot).mutex).write(Mutex::new());
            // Zig: `instance.head = &instance.tail` — self-referential; raw NonNull.
            let tail_ptr = addr_of_mut!((*slot).tail);
            addr_of_mut!((*slot).head).write(Some(NonNull::new_unchecked(tail_ptr)));
        }
    }

    /// Heap-allocate and initialize a fresh instance. The once-guard (Zig's
    /// `loaded` flag) is the *caller's* responsibility — use `bss_list!` for
    /// the canonical per-monomorphization singleton.
    pub fn init() -> NonNull<Self> {
        bss_heap_init(Self::init_at)
    }

    // Zig `deinit` → `impl Drop for BSSList` below (PORTING.md: never expose `pub fn deinit`).
    // The `instance.destroy()` + `loaded = false` half is singleton teardown — the
    // `bss_list!` singleton wrapper owns that; Drop only frees the heap-allocated head chain.

    pub fn is_overflowing(instance: &Self) -> bool {
        instance.used as usize >= COUNT
    }

    pub fn exists(&self, value: &[u8]) -> bool {
        let base = self.backing_buf.as_ptr() as usize;
        let end = base + core::mem::size_of_val(&self.backing_buf);
        let p = value.as_ptr() as usize;
        base <= p && p + value.len() <= end
    }

    /// Reserve an overflow slot and return its uninitialized storage. Mutex is
    /// held by the caller (`append_uninit`). Cold path — only hit after the
    /// `COUNT`-sized backing buffer fills.
    #[cold]
    fn append_overflow_uninit(
        &mut self,
    ) -> core::result::Result<*mut MaybeUninit<ValueType>, AllocError> {
        self.used += 1;
        // SAFETY: head is always non-null after init() (points at self.tail or heap block).
        let mut head_ptr = self.head.unwrap();
        // Zig: `self.head.append(value) catch { allocate new block; retry }`.
        // Restructured to check capacity first, allocate the new block if
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
            // Preserve the chain (Zig: `new_block.prev = self.head`). The inline `self.tail`
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
    /// constructed directly in the destination, matching Zig's result-location
    /// semantics. The by-value `append` below forces a stack temporary +
    /// memcpy into the slot which Rust does not reliably NRVO across a
    /// non-inlined call boundary; `append_uninit` exposes the slot pointer so
    /// the caller's struct literal lowers straight into it.
    ///
    /// Takes `*mut Self` (not `&mut self`) so callers can pass the raw
    /// `bss_list!` singleton pointer directly without first materializing a
    /// `&mut Self` — which would be aliased UB if two threads did so
    /// concurrently *before* reaching the inner `self.mutex.lock()`. This
    /// matches Zig's `*Self` receiver: the inner mutex is the sole
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
        // SAFETY: inner mutex held ⇒ this thread has exclusive access.
        let this = unsafe { &mut *this };
        if this.used as usize > Self::MAX_INDEX {
            this.append_overflow_uninit()
        } else {
            let index = this.used as usize;
            this.used += 1;
            // SAFETY: `index <= MAX_INDEX < COUNT` checked above.
            Ok(unsafe { this.backing_buf.as_mut_ptr().add(index) })
        }
    }

    /// Append `value`, returning a stable `*mut` to its slot.
    ///
    /// Thin wrapper over `append_uninit` for callers with a small/already-built
    /// value. For large `ValueType`s constructed at the call site, prefer
    /// `append_uninit` + in-place write to avoid the by-value stack copy.
    ///
    /// SAFETY: `this` must point to a live, initialized `BSSList` (typically
    /// the `bss_list!` singleton). Concurrent callers are allowed.
    #[inline]
    pub unsafe fn append(
        this: *mut Self,
        value: ValueType,
    ) -> core::result::Result<*mut ValueType, AllocError> {
        // SAFETY: forwarded — see `append_uninit`.
        let slot = unsafe { Self::append_uninit(this)? };
        // SAFETY: `slot` is a freshly-reserved uninit cell exclusively owned by
        // this thread (index already bumped under the mutex).
        unsafe { Ok(core::ptr::from_mut((*slot).write(value))) }
    }

    // Zig: `pub const Pair = struct { index: IndexType, value: *ValueType };`
    // LIFETIMES.tsv: ARENA → *const ValueType. Type appears unused.
}

impl<ValueType, const COUNT: usize> Drop for BSSList<ValueType, COUNT> {
    fn drop(&mut self) {
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

pub struct BSSListPair<ValueType> {
    pub index: IndexType,
    pub value: *const ValueType,
}

// ──────────────────────────────────────────────────────────────────────────
// BSSStringList<_COUNT, _ITEM_LENGTH>
// ──────────────────────────────────────────────────────────────────────────

pub struct BSSStringList<
    const COUNT: usize,       /* = _COUNT * 2 */
    const ITEM_LENGTH: usize, /* = _ITEM_LENGTH + 1 */
> {
    pub backing_buf: NonNull<[MaybeUninit<u8>]>, // len == COUNT * ITEM_LENGTH
    pub backing_buf_used: u64,
    // TODO(port): Overflow = OverflowList<&'static [u8], COUNT / 4> (generic_const_exprs).
    // Fixed nonzero block size until generic_const_exprs lands; 0 would div-by-zero in at_index.
    pub overflow_list: OverflowList<&'static [u8], BSS_OVERFLOW_BLOCK_SIZE>,
    pub slice_buf: NonNull<[MaybeUninit<&'static [u8]>]>, // len == COUNT
    pub slice_buf_used: u16,
    pub mutex: Mutex,
}

#[derive(Default, Clone, Copy)]
struct EmptyType {
    len: usize,
}

/// Trait modeling Zig's `comptime AppendType` switch in `doAppend`.
/// TODO(port): Zig dispatches on the *type* (EmptyType / single slice / iterable-of-slices).
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
        // Zig (`bun_alloc.zig` BSSStringList.init): writes ONLY `allocator`,
        // `backing_buf_used = 0`, `slice_buf_used = 0`, `overflow_list.zero()`,
        // `mutex = .{}` — `backing_buf`/`slice_buf` are left `undefined` so the
        // ~1.4 MiB of array storage stays unfaulted until `append` writes a byte.
        // Match that exactly: lazy-map the arrays, write the four scalars, and
        // zero only the three OverflowList counters (its 32 KiB `ptrs` array is
        // already `[None; 4095]` because `slot` came from `bss_heap_init`).
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

    // Zig `deinit`: just frees `instance`. Singleton is process-lifetime; never freed.

    #[inline]
    pub fn is_overflowing(instance: &Self) -> bool {
        instance.slice_buf_used as usize >= COUNT
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

    /// Zig `editableSlice(slice: []const u8) []u8 { return @constCast(slice); }`.
    ///
    /// Rust cannot soundly express `&[u8] -> &mut [u8]` (instant UB under stacked borrows),
    /// so this takes raw parts instead. Callers that held a `&[u8]` must drop that borrow
    /// before calling and pass `(ptr, len)` derived from a `&mut`-provenance pointer.
    ///
    /// # Safety
    /// `(ptr, len)` must describe a region returned from `append*` on this instance, point
    /// into our owned mutable backing storage, and have no other live borrow.
    pub unsafe fn editable_slice<'a>(ptr: *mut u8, len: usize) -> &'a mut [u8] {
        // SAFETY: caller upholds the `# Safety` contract — `(ptr, len)` is an
        // exclusively-owned region in this instance's backing storage.
        unsafe { core::slice::from_raw_parts_mut(ptr, len) }
    }

    /// Append `value` and return a mutable slice over the freshly-reserved bytes.
    ///
    /// Takes `*mut Self` (not `&mut self`) so callers can pass the raw
    /// `bss_string_list!` singleton pointer directly without first
    /// materializing a `&mut Self` — which would be aliased UB if two threads
    /// did so concurrently *before* reaching the inner `self.mutex.lock()`.
    /// Matches Zig's `*Self` receiver: the inner mutex is the sole
    /// serialization point, so no caller-side outer lock is needed.
    ///
    /// SAFETY: `this` must point to a live, initialized `BSSStringList`
    /// (typically the `bss_string_list!` singleton). Concurrent callers are
    /// allowed.
    pub unsafe fn append_mutable<'a, A: BSSAppendable>(
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
    pub unsafe fn get_mutable<'a>(
        this: *mut Self,
        len: usize,
    ) -> core::result::Result<&'a mut [u8], AllocError> {
        // SAFETY: forwarded — see `append_mutable`.
        unsafe { Self::append_mutable(this, &EmptyType { len }) }
    }

    /// SAFETY: see [`append_mutable`].
    pub unsafe fn print_with_type<'a>(
        this: *mut Self,
        args: core::fmt::Arguments<'_>,
    ) -> core::result::Result<&'a [u8], AllocError> {
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
        // SAFETY: inner mutex held ⇒ this thread has exclusive access.
        let this_ref = unsafe { &mut *this };

        let (ptr, len) = if value.len() <= 256 {
            let mut scratch = [0u8; 256];
            this_ref.do_append(&crate::copy_lowercase(value, &mut scratch[..value.len()]))?
        } else {
            // Slow path: input >256 bytes (rare). Use a one-shot heap temp via
            // mimalloc directly (PORTING.md forbids `Vec` in hot allocators).
            let p = mimalloc::mi_malloc(value.len()).cast::<u8>();
            if p.is_null() {
                return Err(AllocError);
            }
            // SAFETY: `p` is a fresh allocation of `value.len()` bytes; sole owner.
            let tmp = unsafe { core::slice::from_raw_parts_mut(p, value.len()) };
            let r = this_ref.do_append(&crate::copy_lowercase(value, tmp));
            // SAFETY: `p` was allocated by `mi_malloc` above.
            unsafe { mimalloc::mi_free(p.cast()) };
            r?
        };
        // SAFETY: see `append`.
        Ok(unsafe { core::slice::from_raw_parts(ptr, len) })
    }

    #[inline]
    fn do_append<A: BSSAppendable>(
        &mut self,
        value: &A,
    ) -> core::result::Result<(*mut u8, usize), AllocError> {
        let value_len: usize = value.total_len() + 1;

        let (out_ptr, out_len): (*mut u8, usize);
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
            let ptr = mimalloc::mi_malloc(value_len).cast::<u8>();
            if ptr.is_null() {
                return Err(AllocError);
            }
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
        // outliving 'static (singleton). Zig stores it as `[]const u8` with no lifetime
        // tracking.
        let stored: &'static [u8] = unsafe { core::slice::from_raw_parts(out_ptr, out_len) };

        if result.is_overflow() {
            if self.overflow_list.len() == result.index() {
                let _ = self.overflow_list.append(stored);
            } else {
                *self.overflow_list.at_index_mut(result) = stored;
            }
        } else {
            // SAFETY: `slice_buf` is a process-lifetime mapping of `COUNT`
            // `&[u8]`-sized slots owned by this singleton; `result.index() <
            // slice_buf_used <= COUNT`; we hold `&mut self`. Raw write — slot
            // may be uninit (Zig leaves it `undefined`).
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
// BSSMap<ValueType, COUNT, STORE_KEYS, ESTIMATED_KEY_LENGTH, REMOVE_TRAILING_SLASHES>
// ──────────────────────────────────────────────────────────────────────────

pub struct BSSMapInner<ValueType, const COUNT: usize, const REMOVE_TRAILING_SLASHES: bool> {
    pub index: IndexMap,
    // TODO(port): Overflow = OverflowList<ValueType, COUNT / 4> (generic_const_exprs).
    // Fixed nonzero block size until generic_const_exprs lands; 0 would div-by-zero in at_index.
    pub overflow_list: OverflowList<ValueType, BSS_OVERFLOW_BLOCK_SIZE>,
    pub mutex: Mutex,
    // Zig leaves `backing_buf` undefined; only `[0..backing_buf_used]` is initialized.
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
        // `overflow_list.list.ptrs` array is already `[None; 4095]` (null
        // niche), so write only the three counters; `backing_buf` is
        // intentionally left uninitialized (Zig: `undefined`).
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

    // Zig `deinit`: `self.index.deinit(allocator)` then free instance.
    // With `IndexMap = HashMap`, Drop frees it; singleton Box drop frees instance.

    pub fn is_overflowing(instance: &Self) -> bool {
        instance.backing_buf_used as usize >= COUNT
    }

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
        // TODO(port): narrow error set — IndexMap::get_or_put can only OOM.
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

        self.index.insert(result.hash, result.index);

        let ret = if result.index.is_overflow() {
            if self.overflow_list.len() == result.index.index() {
                self.overflow_list.append(value)
            } else {
                let ptr = self.overflow_list.at_index_mut(result.index);
                *ptr = value;
                ptr
            }
        } else {
            let idx = result.index.index() as usize;
            // Raw write — fresh slots are uninit; Zig assignment has no drop glue.
            self.backing_buf[idx].write(value);
            // SAFETY: just initialized on the line above.
            unsafe { self.backing_buf[idx].assume_init_mut() }
        };
        Ok(ret)
    }

    /// Returns true if the entry was removed.
    pub fn remove(&mut self, denormalized_key: &[u8]) -> bool {
        let _guard = self.mutex.lock();
        let _key = Self::key_hash(denormalized_key);
        self.index.remove(&_key).is_some()
        // (Zig has commented-out per-slot deinit code here; intentionally not ported.)
    }

    pub fn values(&mut self) -> &mut [ValueType] {
        // SAFETY: `backing_buf[0..backing_buf_used]` was initialized by `put`;
        // `MaybeUninit<T>` is `#[repr(transparent)]` so the slice cast is layout-sound.
        unsafe {
            core::slice::from_raw_parts_mut(
                self.backing_buf.as_mut_ptr().cast::<ValueType>(),
                self.backing_buf_used as usize,
            )
        }
    }
}

/// `store_keys = true` wrapper.
pub struct BSSMap<
    ValueType,
    const COUNT: usize,
    const ESTIMATED_KEY_LENGTH: usize,
    const REMOVE_TRAILING_SLASHES: bool,
> {
    map: NonNull<BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES>>,
    // Same lazy-fault treatment as `BSSStringList::backing_buf` — see the
    // struct-level comment there. Zig keeps these inline; we map separately
    // because `[u8; COUNT*ESTIMATED_KEY_LENGTH]` needs `generic_const_exprs`.
    pub key_list_buffer: NonNull<[MaybeUninit<u8>]>, // len == COUNT * ESTIMATED_KEY_LENGTH
    pub key_list_buffer_used: usize,
    pub key_list_slices: NonNull<[MaybeUninit<&'static [u8]>]>, // len == COUNT
    pub key_list_overflow: Vec<&'static [u8]>,
}

impl<
    ValueType,
    const COUNT: usize,
    const ESTIMATED_KEY_LENGTH: usize,
    const REMOVE_TRAILING_SLASHES: bool,
> BSSMap<ValueType, COUNT, ESTIMATED_KEY_LENGTH, REMOVE_TRAILING_SLASHES>
{
    /// In-place field initialization into uninitialized storage.
    ///
    /// SAFETY: `slot` must point to writable, properly-aligned, uninitialized
    /// storage of `size_of::<Self>()` bytes that lives for `'static`.
    pub unsafe fn init_at(slot: *mut Self) {
        // SAFETY: caller contract — `slot` is a valid, exclusive, aligned `*mut Self`.
        unsafe {
            // Inner map in its own lazy mapping so its inline backing_buf +
            // overflow ptrs fault on demand.
            addr_of_mut!((*slot).map).write(bss_heap_init(BSSMapInner::init_at));
            addr_of_mut!((*slot).key_list_buffer)
                .write(bss_lazy_slice::<u8>(COUNT * ESTIMATED_KEY_LENGTH));
            addr_of_mut!((*slot).key_list_buffer_used).write(0);
            addr_of_mut!((*slot).key_list_slices).write(bss_lazy_slice::<&'static [u8]>(COUNT));
            addr_of_mut!((*slot).key_list_overflow).write(Vec::new());
        }
    }

    /// Heap-allocate and initialize a fresh instance. Once-guard is the caller's
    /// responsibility — use `bss_map!` for the canonical singleton.
    pub fn init() -> NonNull<Self> {
        bss_heap_init(Self::init_at)
    }

    /// Borrow the inner map. The mapping is process-lifetime; reborrow lifetime
    /// is tied to `&self`/`&mut self` so the usual aliasing rules apply.
    #[inline(always)]
    pub fn map(&self) -> &BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES> {
        // SAFETY: `map` was set in `init_at` to a fresh `bss_heap_init` mapping
        // that lives for process lifetime and is exclusively owned by `*self`.
        unsafe { self.map.as_ref() }
    }
    #[inline(always)]
    pub fn map_mut(&mut self) -> &mut BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES> {
        // SAFETY: see `map()`; `&mut self` guarantees exclusive access.
        unsafe { self.map.as_mut() }
    }

    // Zig `deinit`: `self.map.deinit()` then free instance — process-lifetime; never freed.

    pub fn is_overflowing(instance: &Self) -> bool {
        instance.map().backing_buf_used as usize >= COUNT
    }

    pub fn get_or_put(&mut self, key: &[u8]) -> core::result::Result<Result, AllocError> {
        self.map_mut().get_or_put(key)
    }

    pub fn get(&mut self, key: &[u8]) -> Option<&mut ValueType> {
        // PERF(port): Zig uses @call(bun.callmod_inline, ...) — profile if hot.
        self.map_mut().get(key)
    }

    pub fn at_index(&mut self, index: IndexType) -> Option<&mut ValueType> {
        // PERF(port): Zig uses @call(bun.callmod_inline, ...) — profile if hot.
        self.map_mut().at_index(index)
    }

    pub fn key_at_index(&self, index: IndexType) -> Option<&[u8]> {
        match index.index() {
            i if i == UNASSIGNED.index() || i == NOT_FOUND.index() => None,
            _ => {
                if !index.is_overflow() {
                    let i = index.index() as usize;
                    debug_assert!(i < COUNT);
                    // SAFETY: a non-sentinel non-overflow index was assigned by
                    // `put` (which bumps `backing_buf_used`) and its key stored
                    // by `put_key` at this slot before any reader could observe
                    // the index — the slot is initialized. `key_list_slices` is
                    // a process-lifetime mapping of `COUNT` slots.
                    Some(unsafe { *self.key_list_slices.cast::<&'static [u8]>().as_ptr().add(i) })
                } else {
                    // TODO(port): see key_list_overflow note — Zig indexes `.items` here.
                    Some(self.key_list_overflow[index.index() as usize])
                }
            }
        }
    }

    pub fn put<const STORE_KEY: bool>(
        &mut self,
        key: &[u8],
        result: &mut Result,
        value: ValueType,
    ) -> core::result::Result<&mut ValueType, AllocError> {
        // PORT NOTE: reshaped for borrowck — Zig returns `ptr` from map.put then calls put_key;
        // Rust can't hold &mut ValueType across &mut self.put_key. Stash as raw, re-borrow after.
        let ptr: *mut ValueType = self.map_mut().put(result, value)?;
        if STORE_KEY {
            self.put_key(key, result)?;
        }
        // SAFETY: ptr points into self.map.backing_buf / overflow_list, which are owned by
        // `self` and not reallocated by put_key (put_key only touches key_list_* fields).
        // We still hold the unique &mut self borrow, so no other alias exists.
        Ok(unsafe { &mut *ptr })
    }

    pub fn is_key_statically_allocated(&self, key: &[u8]) -> bool {
        // Pointer-range check; addresses only (no `&[u8]` over uninit tail).
        let base = self.key_list_buffer.as_ptr().cast::<u8>() as usize;
        let end = base + self.key_list_buffer.len();
        let p = key.as_ptr() as usize;
        base <= p && p + key.len() <= end
    }

    // There's two parts to this.
    // 1. Storing the underlying string.
    // 2. Making the key accessible at the index.
    pub fn put_key(
        &mut self,
        key: &[u8],
        result: &mut Result,
    ) -> core::result::Result<(), AllocError> {
        let _guard = self.map().mutex.lock();

        let slice: &'static [u8];

        // Is this actually a slice into the map? Don't free it.
        if self.is_key_statically_allocated(key) {
            // SAFETY: key points into self.key_list_buffer which lives for the singleton's life.
            slice = unsafe { core::slice::from_raw_parts(key.as_ptr(), key.len()) };
        } else if self.key_list_buffer_used + key.len() < self.key_list_buffer.len() {
            let start = self.key_list_buffer_used;
            self.key_list_buffer_used += key.len();
            // SAFETY: `key_list_buffer` is a process-lifetime mapping of
            // `COUNT*ESTIMATED_KEY_LENGTH` writable bytes owned by this
            // singleton; `[start..start+key.len()]` is in-bounds (just checked)
            // and about to be fully written; we hold `&mut self`.
            let dst: &mut [u8] = unsafe {
                core::slice::from_raw_parts_mut(
                    self.key_list_buffer.as_ptr().cast::<u8>().add(start),
                    key.len(),
                )
            };
            dst.copy_from_slice(key);
            // SAFETY: points into self.key_list_buffer (singleton-static lifetime).
            slice = unsafe { core::slice::from_raw_parts(dst.as_ptr(), dst.len()) };
        } else {
            let ptr = mimalloc::mi_malloc(key.len().max(1)).cast::<u8>();
            if ptr.is_null() {
                return Err(AllocError);
            }
            // SAFETY: `ptr` is a fresh allocation of `key.len()` bytes with no other alias.
            unsafe { core::ptr::copy_nonoverlapping(key.as_ptr(), ptr, key.len()) };
            // SAFETY: allocation is owned by this singleton for process lifetime (or until
            // freed below on overwrite).
            slice = unsafe { core::slice::from_raw_parts(ptr, key.len()) };
        }

        let slice = if REMOVE_TRAILING_SLASHES {
            trim_right(slice, b"/")
        } else {
            slice
        };

        if !result.index.is_overflow() {
            let i = result.index.index() as usize;
            debug_assert!(i < COUNT);
            // SAFETY: `key_list_slices` is a process-lifetime mapping of
            // `COUNT` slots; `i < COUNT`; we hold `&mut self`. Raw write —
            // slot may be uninit (Zig leaves it `undefined`).
            unsafe {
                self.key_list_slices
                    .as_ptr()
                    .cast::<MaybeUninit<&'static [u8]>>()
                    .add(i)
                    .write(MaybeUninit::new(slice));
            }
        } else {
            // TODO(port): see key_list_overflow note above re: `.items` / `.append(alloc, _)`.
            let idx = result.index.index() as usize;
            if self.key_list_overflow.len() > idx {
                let existing_slice = self.key_list_overflow[idx];
                if !self.is_key_statically_allocated(existing_slice) {
                    // Zig: self.map.allocator.free(existing_slice). `mi_free` is
                    // size-agnostic, so a trimmed (shorter) stored slice is fine.
                    // SAFETY: existing_slice was `mi_malloc`'d by a prior put_key call
                    // (the only non-static-buffer source above) and not yet freed.
                    unsafe {
                        mimalloc::mi_free(
                            existing_slice
                                .as_ptr()
                                .cast_mut()
                                .cast::<core::ffi::c_void>(),
                        )
                    };
                }
                self.key_list_overflow[idx] = slice;
            } else {
                self.key_list_overflow.push(slice);
            }
        }

        Ok(())
    }

    pub fn mark_not_found(&mut self, result: Result) {
        self.map_mut().mark_not_found(result);
    }

    /// This does not free the keys.
    /// Returns `true` if an entry had previously existed.
    pub fn remove(&mut self, key: &[u8]) -> bool {
        self.map_mut().remove(key)
    }
}

pub trait Allocator: 'static {
    #[inline]
    fn type_id(&self) -> core::any::TypeId {
        core::any::TypeId::of::<Self>()
    }
}

impl dyn Allocator {
    #[inline]
    pub fn is<T: Allocator>(&self) -> bool {
        Allocator::type_id(self) == core::any::TypeId::of::<T>()
    }
}

#[inline]
pub fn is_default(alloc: &dyn Allocator) -> bool {
    alloc.is::<DefaultAlloc>()
}

/// Legacy ZST naming `bun.default_allocator`. With `#[global_allocator]` set,
/// this is just a unit marker.
#[derive(Clone, Copy, Default)]
pub struct DefaultAlloc;
impl Allocator for DefaultAlloc {}

static DEFAULT_ALLOC: DefaultAlloc = DefaultAlloc;

#[inline]
pub fn default_allocator() -> &'static dyn Allocator {
    &DEFAULT_ALLOC
}

// ──────────────────────────────────────────────────────────────────────────
// `basic` module selection
// ──────────────────────────────────────────────────────────────────────────

// `basic.zig` ported as `impl GlobalAlloc for Mimalloc` above (the real impl).
// Draft kept for diff-pass only.
#[path = "basic.rs"]
pub mod basic;
pub mod memory;

// ported from: src/bun_alloc/bun_alloc.zig
