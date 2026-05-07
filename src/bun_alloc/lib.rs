//! Port of `src/bun_alloc/bun_alloc.zig`.
#![feature(sync_unsafe_cell)]
#![feature(arbitrary_self_types_pointers)]
#![feature(allocator_api)]

use core::fmt::Write as _;
use core::mem::{size_of, MaybeUninit};
use core::ptr::{addr_of_mut, NonNull};
use core::sync::atomic::{AtomicU16, Ordering};
use std::collections::HashMap;

// ──────────────────────────────────────────────────────────────────────────
// Re-exports (thin — match Zig `pub const X = @import(...)` lines)
// ──────────────────────────────────────────────────────────────────────────

pub use bun_mimalloc_sys::mimalloc;

// ── Allocator vtable (mirrors std.mem.Allocator) ──────────────────────────
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Alignment(pub u8); // log2 of byte alignment, like std.mem.Alignment
impl Alignment {
    #[inline] pub const fn of<T>() -> Self { Self(core::mem::align_of::<T>().trailing_zeros() as u8) }
    #[inline] pub const fn to_byte_units(self) -> usize { 1usize << self.0 }
    #[inline] pub const fn from_byte_units(b: usize) -> Self { Self(b.trailing_zeros() as u8) }
}

pub struct AllocatorVTable {
    pub alloc: unsafe fn(*mut core::ffi::c_void, usize, Alignment, usize) -> *mut u8,
    pub resize: unsafe fn(*mut core::ffi::c_void, &mut [u8], Alignment, usize, usize) -> bool,
    pub remap: unsafe fn(*mut core::ffi::c_void, &mut [u8], Alignment, usize, usize) -> *mut u8,
    pub free: unsafe fn(*mut core::ffi::c_void, &mut [u8], Alignment, usize),
}
impl AllocatorVTable {
    pub const NO_RESIZE: unsafe fn(*mut core::ffi::c_void, &mut [u8], Alignment, usize, usize) -> bool =
        |_, _, _, _, _| false;
    pub const NO_REMAP: unsafe fn(*mut core::ffi::c_void, &mut [u8], Alignment, usize, usize) -> *mut u8 =
        |_, _, _, _, _| core::ptr::null_mut();
}

/// `std.mem.Allocator` — fat (ptr + vtable). Distinct from the `Allocator` trait below.
#[derive(Clone, Copy)]
pub struct StdAllocator {
    pub ptr: *mut core::ffi::c_void,
    pub vtable: &'static AllocatorVTable,
}
/// Legacy alias — Phase-A drafts spell it `crate::VTable`.
pub type VTable = AllocatorVTable;

// SAFETY: `ptr` is an opaque tag/context handle (Zig: `*anyopaque`); the
// vtable is `&'static`. Thread-safety of dispatch is the implementor's
// concern (mimalloc is thread-safe; FixedBufferAllocator is not — same as Zig).
unsafe impl Send for StdAllocator {}
unsafe impl Sync for StdAllocator {}

impl Default for StdAllocator {
    /// Zig: `bun.memory.initDefault(std.mem.Allocator)` → `bun.default_allocator`
    /// (mimalloc-backed `c_allocator`). Lets `AllocationScopeIn<StdAllocator>`
    /// satisfy its `A: Default` bound for `init_default()`.
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
    pub fn raw_resize(&self, buf: &mut [u8], alignment: Alignment, new_len: usize, ra: usize) -> bool {
        // SAFETY: see `raw_alloc`.
        unsafe { (self.vtable.resize)(self.ptr, buf, alignment, new_len, ra) }
    }
    /// Zig: `Allocator.rawRemap`.
    #[inline]
    pub fn raw_remap(&self, buf: &mut [u8], alignment: Alignment, new_len: usize, ra: usize) -> Option<*mut u8> {
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
        if bytes.is_empty() { return; }
        // SAFETY: `bytes` is reborrowed mutably only for the vtable signature; the
        // callee treats it as opaque (Zig passes `[]u8`).
        let buf = unsafe {
            core::slice::from_raw_parts_mut(bytes.as_ptr().cast_mut(), bytes.len())
        };
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
    pub fn init(buffer: &'a mut [u8]) -> Self { Self { end: 0, buffer } }
    #[inline]
    pub fn reset(&mut self) { self.end = 0; }
    #[inline]
    pub fn owns_ptr(&self, p: *const u8) -> bool {
        let base = self.buffer.as_ptr() as usize;
        let q = p as usize;
        q >= base && q < base + self.buffer.len()
    }
    pub fn alloc(&mut self, len: usize, alignment: Alignment, _ra: usize) -> Option<*mut u8> {
        let base = self.buffer.as_mut_ptr() as usize;
        let aligned = (base + self.end + alignment.to_byte_units() - 1)
            & !(alignment.to_byte_units() - 1);
        let new_end = (aligned - base).checked_add(len)?;
        if new_end > self.buffer.len() { return None; }
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
        if new_end > self.buffer.len() { return false; }
        self.end = new_end;
        true
    }
    #[inline]
    pub fn remap(&mut self, buf: &mut [u8], a: Alignment, new_len: usize, ra: usize) -> Option<*mut u8> {
        if self.resize(buf, a, new_len, ra) { Some(buf.as_mut_ptr()) } else { None }
    }
    #[inline]
    pub fn free(&mut self, buf: &mut [u8], _a: Alignment, _ra: usize) {
        // Only the last allocation can be freed.
        let buf_end = buf.as_ptr() as usize - self.buffer.as_ptr() as usize + buf.len();
        if buf_end == self.end { self.end -= buf.len(); }
    }
}

// PORTING.md §Allocators: AST crates thread an `Arena`; non-AST use Vec/Box
// (global mimalloc). `Arena` is now the real per-heap `MimallocArena` (matching
// Zig's `bun.allocators.MimallocArena`) — unlike `bumpalo::Bump`, it supports
// per-allocation free + realloc, so `ArenaVec` no longer leaks on grow.
//
// `bumpalo::Bump` is kept as `Bump` for genuinely bump-only scratch (parser
// node stores that are never resized and where the no-op `deallocate` is the
// point).
pub use mimalloc_arena::MimallocArena;
pub type Arena = MimallocArena;
/// `bumpalo::Bump` — kept for genuinely bump-only scratch that's never resized.
pub type Bump = bumpalo::Bump;
/// Arena-backed `Vec` — `Vec<T, &'a MimallocArena>`. Real `deallocate`/`grow`
/// via `mi_free`/`mi_heap_realloc_aligned`; reclaimed on arena `reset`/`Drop`.
pub type ArenaVec<'a, T> = Vec<T, &'a MimallocArena>;
pub use mimalloc_arena::{vec_from_iter_in, ArenaString, ArenaVecExt};

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
/// `typed_arena::Arena<T>` — typed slab with stable addresses (AST node Store).
pub type TypedArena<T> = typed_arena::Arena<T>;

/// `bun.use_mimalloc` — always true in Rust (mimalloc is the global allocator).
pub const USE_MIMALLOC: bool = true;

// ── Allocator-vtable modules: per-module disposition (PORTING.md §Allocators) ──
//
// These modelled Zig's `std.mem.Allocator` vtable. With `#[global_allocator]`
// + `Arena = bumpalo::Bump`, most callers should drop the allocator param
// PORTING.md §Forbidden) so the .zig↔.rs diff pass has a real body to compare;
// callers are migrated incrementally.
//
//   MimallocArena            → prefer `bun_alloc::Arena` (= bumpalo::Bump)
//   NullableAllocator        → prefer `Option<&Arena>` or drop the param
//   MaxHeapAllocator         → debug-only cap (single-allocation arena)
//   BufferFallbackAllocator  → PORTING.md "StackFallbackAllocator → just use the heap"
//   fallback                 → libc-malloc + zeroing wrapper (Zig std.heap.c_allocator)
//   maybe_owned              → prefer `std::borrow::Cow` / `bun_ptr::Owned`
//   heap_breakdown           → macOS malloc_zone_* per-tag heaps (debug builds)
//   basic                    → `impl GlobalAlloc for Mimalloc` above is the canonical impl
//
//   allocation_scope, LinuxMemFdAllocator, MimallocArena (the vtable impl)
//   import bun_core/sys/runtime/collections and so live in
//   `bun_runtime::allocators` (CYCLEBREAK §bun_alloc); callers import from
//   there directly.
//
 #[path = "NullableAllocator.rs"]       pub mod nullable_allocator;
                                        pub mod maybe_owned;
 #[path = "MaxHeapAllocator.rs"]        pub mod max_heap_allocator;
 #[path = "BufferFallbackAllocator.rs"] pub mod buffer_fallback_allocator;
                                        pub mod fallback;

pub use nullable_allocator::NullableAllocator;
pub use max_heap_allocator::MaxHeapAllocator;
pub use buffer_fallback_allocator::BufferFallbackAllocator;
pub use maybe_owned::MaybeOwned;

#[path = "MimallocArena.rs"]
pub mod mimalloc_arena;

// ── tier-0 local primitives ───────────────────────────────────────────────
// Real, self-contained helpers used by the BSS containers below. The wider
// `bun_paths::SEP_STR` / `bun_core::strings::trim_right` live in higher tiers
// (which depend on this crate), so the minimal definitions are duplicated here
// rather than importing upward.

/// Zig: `std.fs.path.sep_str` — `"\\"` on Windows, `"/"` elsewhere.
const SEP_STR: &[u8] = if cfg!(windows) { b"\\" } else { b"/" };

/// Zig: `std.mem.trimRight(u8, s, chars)`.
#[inline]
fn trim_right<'a>(s: &'a [u8], chars: &[u8]) -> &'a [u8] {
    let mut end = s.len();
    while end > 0 && chars.contains(&s[end - 1]) {
        end -= 1;
    }
    &s[..end]
}

// ── RAII Mutex ────────────────────────────────────────────────────────────
// Zig's `bun.Mutex` exposes bare `lock()`/`unlock()` (no guard). The BSS
// containers below need to hold the lock across `&mut self` method calls, so
// the returned `MutexGuard` deliberately captures a *raw* pointer to the
// `RawMutex` instead of a borrow — the guard therefore has no lifetime tie to
// `self` and won't conflict with subsequent `&mut self` borrows. This is sound
// because every `Mutex` here lives inside a `'static` BSS singleton (see
// `instance()` below), so the pointee always outlives the guard.
pub struct Mutex(parking_lot::RawMutex);
impl Mutex {
    pub const fn new() -> Self {
        Self(<parking_lot::RawMutex as parking_lot::lock_api::RawMutex>::INIT)
    }
    #[inline]
    pub fn lock(&self) -> MutexGuard {
        parking_lot::lock_api::RawMutex::lock(&self.0);
        MutexGuard(core::ptr::addr_of!(self.0))
    }
}

/// Unlocks the paired [`Mutex`] on drop. See the type-level comment on
/// [`Mutex`] for why this holds a raw pointer rather than a reference.
#[must_use = "if unused the Mutex will immediately unlock"]
pub struct MutexGuard(*const parking_lot::RawMutex);
impl Drop for MutexGuard {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `self.0` was obtained from a live `Mutex` in `lock()`; the
        // BSS singletons that own these mutexes are `'static`, so the pointee
        // outlives this guard. `lock()` acquired the raw mutex exactly once
        // and this is the paired release.
        unsafe { parking_lot::lock_api::RawMutex::unlock(&*self.0) };
    }
}
impl Default for Mutex {
    fn default() -> Self { Self::new() }
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

/// The mimalloc-backed `#[global_allocator]` payload.
///
/// Per PORTING.md "Prereq for every crate":
/// `#[global_allocator] static ALLOC: bun_alloc::Mimalloc = bun_alloc::Mimalloc;`
/// must be set at the binary root before any `Box`/`Rc`/`Arc`/`Vec` mapping is valid.
///
/// Mirrors `src/bun_alloc/basic.zig` `c_allocator` vtable, using mimalloc's
/// `MI_MAX_ALIGN_SIZE` (16) fast-path: alignments ≤16 go through `mi_malloc`,
/// larger through `mi_malloc_aligned`. `mi_free` handles both.
pub struct Mimalloc;

/// `#define MI_MAX_ALIGN_SIZE 16` — max alignment guaranteed by `mi_malloc`.
const MI_MAX_ALIGN_SIZE: usize = 16;

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
        // PERF(port): mirrors basic.zig `must_use_aligned_alloc` branch.
        unsafe {
            if layout.align() <= MI_MAX_ALIGN_SIZE {
                mimalloc::mi_malloc(layout.size())
            } else {
                mimalloc::mi_malloc_aligned(layout.size(), layout.align())
            }
        }
        .cast()
    }

    #[inline]
    unsafe fn alloc_zeroed(&self, layout: core::alloc::Layout) -> *mut u8 {
        unsafe {
            if layout.align() <= MI_MAX_ALIGN_SIZE {
                mimalloc::mi_zalloc(layout.size())
            } else {
                mimalloc::mi_zalloc_aligned(layout.size(), layout.align())
            }
        }
        .cast()
    }

    #[inline]
    unsafe fn dealloc(&self, ptr: *mut u8, _layout: core::alloc::Layout) {
        // mimalloc tracks size+alignment in page metadata; `mi_free` is universal.
        unsafe { mimalloc::mi_free(ptr.cast()) }
    }

    #[inline]
    unsafe fn realloc(&self, ptr: *mut u8, layout: core::alloc::Layout, new_size: usize) -> *mut u8 {
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
// MOVE-IN: cycle-break landings (CYCLEBREAK.md §→alloc)
//   Symbols hoisted DOWN into T0 so higher tiers can re-import without cycles.
// ──────────────────────────────────────────────────────────────────────────

// ── out_of_memory ─────────────────────────────────────────────────────────
// Source: src/bun.zig `outOfMemory()` → `crash_handler.crashHandler(.out_of_memory, ..)`.
//
// PORTING.md §Forbidden: no fn-ptr hooks to break dep cycles. `bun_alloc` is
// T0 and must not call up into `bun_crash_handler`, so the OOM path here is a
// direct abort (Zig's `bun.outOfMemory()` is `noreturn` either way). The rich
// crash report is produced by the platform's signal/SEH handler installed by
// `bun_crash_handler` at process startup; aborting here triggers it.

#[cold]
#[inline(never)]
pub fn out_of_memory() -> ! {
    // Best-effort diagnostic before the abort handler takes over.
    let _ = std::io::Write::write_all(&mut std::io::stderr(), b"bun: out of memory\n");
    std::process::abort()
}

// ── page_size ─────────────────────────────────────────────────────────────
// Source: Zig `std.heap.pageSize()` (used by LinuxMemFdAllocator / standalone_graph).
// Cached via OnceLock per PORTING.md §Concurrency (was lazy-init in std).

static PAGE_SIZE: std::sync::OnceLock<usize> = std::sync::OnceLock::new();

#[inline]
pub fn page_size() -> usize {
    *PAGE_SIZE.get_or_init(|| {
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        // SAFETY: `sysconf(_SC_PAGESIZE)` is infallible and side-effect-free.
        unsafe {
            libc::sysconf(libc::_SC_PAGESIZE) as usize
        }
        #[cfg(windows)]
        // SAFETY: `GetSystemInfo` writes a fully-initialized SYSTEM_INFO.
        unsafe {
            let mut info = core::mem::zeroed::<windows_sys::Win32::System::SystemInformation::SYSTEM_INFO>();
            windows_sys::Win32::System::SystemInformation::GetSystemInfo(&mut info);
            info.dwPageSize as usize
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
        {
            4096
        }
    })
}

// ── wtf (FastMalloc thread-cache release) ─────────────────────────────────
// Source: src/jsc/WTF.zig `releaseFastMallocFreeMemoryForThisThread`.
// MOVE_DOWN from bun_jsc so bun_threading (T2) can call it without a T6 dep.
pub mod wtf {
    unsafe extern "C" {
        // Defined in WebKit's WTF (linked into the final binary).
        fn WTF__releaseFastMallocFreeMemoryForThisThread();
    }

    #[inline]
    pub fn release_fast_malloc_free_memory_for_this_thread() {
        // Zig: jsc.markBinding(@src()) — debug-only binding marker, dropped at T0.
        // SAFETY: FFI call is thread-safe and takes no arguments.
        unsafe { WTF__releaseFastMallocFreeMemoryForThisThread() }
    }
}

// ── String (bun.String) — TYPE_ONLY landing ───────────────────────────────
// Source: src/string/string.zig + src/jsc/ZigString.zig + src/string/wtf.zig.
// Layout-only (#[repr(C)]) so T0/T1 crates can name the type; rich methods
// (toJS, toUTF8, WTF refcounting) remain in bun_str via extension traits.
// PORTING.md: "#[repr(C)] struct { tag: u8, value: StringValue } — NOT a Rust
// enum (C++ mutates tag and value independently across FFI)."

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

/// Port of `jsc.ZigString` — extern struct `{ ptr: [*]const u8, len: usize }`
/// where `ptr` carries tag bits in the high byte (bit 63 = UTF-16, 62 = global,
/// 61 = UTF-8, 60 = static). Untagging masks to the low 53 bits.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ZigString {
    /// Tagged pointer — never dereference directly; use `untagged()`.
    pub _unsafe_ptr_do_not_use: *const u8,
    pub len: usize,
}

impl ZigString {
    pub const EMPTY: ZigString = ZigString { _unsafe_ptr_do_not_use: b"".as_ptr(), len: 0 };

    #[inline]
    pub const fn init(slice: &[u8]) -> ZigString {
        ZigString { _unsafe_ptr_do_not_use: slice.as_ptr(), len: slice.len() }
    }

    #[inline]
    pub fn init_utf16(items: &[u16]) -> ZigString {
        let mut out = ZigString { _unsafe_ptr_do_not_use: items.as_ptr().cast(), len: items.len() };
        out.mark_utf16();
        out
    }

    #[inline] pub const fn length(&self) -> usize { self.len }
    #[inline] pub const fn is_empty(&self) -> bool { self.len == 0 }

    #[inline]
    pub fn is_16bit(&self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & (1usize << 63) != 0
    }
    #[inline]
    pub fn is_utf8(&self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & (1usize << 61) != 0
    }
    #[inline]
    pub fn is_globally_allocated(&self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & (1usize << 62) != 0
    }
    #[inline]
    pub fn mark_utf16(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | (1usize << 63)) as *const u8;
    }
    #[inline]
    pub fn mark_utf8(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | (1usize << 61)) as *const u8;
    }

    /// Zig `untagged`: `@ptrFromInt(@as(u53, @truncate(@intFromPtr(ptr))))`.
    #[inline]
    pub fn untagged(ptr: *const u8) -> *const u8 {
        ((ptr as usize) & ((1usize << 53) - 1)) as *const u8
    }

    /// 8-bit byte view (latin1 or utf8). Caller must ensure `!is_16bit()`.
    #[inline]
    pub fn slice(&self) -> &[u8] {
        debug_assert!(self.len == 0 || !self.is_16bit());
        // SAFETY: ptr is valid for `len` bytes when not 16-bit; len capped to u32::MAX as in Zig.
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
        debug_assert!(self.len == 0 || self.is_16bit());
        // SAFETY: ptr is valid for `len` u16 units when 16-bit-tagged.
        unsafe {
            core::slice::from_raw_parts(
                Self::untagged(self._unsafe_ptr_do_not_use).cast::<u16>(),
                self.len,
            )
        }
    }
}

/// Port of `WTFStringImplStruct` — must match WebKit's `WTF::StringImpl` layout.
#[repr(C)]
pub struct WTFStringImplStruct {
    pub m_ref_count: u32,
    pub m_length: u32,
    pub m_ptr: WTFStringImplPtr,
    pub m_hash_and_flags: u32,
}

#[repr(C)]
pub union WTFStringImplPtr {
    pub latin1: *const u8,
    pub utf16: *const u16,
}

/// `*WTFStringImplStruct` — always non-null when `tag == WTFStringImpl`.
pub type WTFStringImpl = *mut WTFStringImplStruct;

impl WTFStringImplStruct {
    const S_HASH_FLAG_8BIT_BUFFER: u32 = 1 << 2;
    /// The bottom bit in the ref count indicates a static (immortal) string.
    const S_REF_COUNT_FLAG_IS_STATIC_STRING: u32 = 0x1;
    /// This allows us to ref / deref without disturbing the static string flag.
    const S_REF_COUNT_INCREMENT: u32 = 0x2;

    #[inline] pub fn length(&self) -> u32 { self.m_length }
    #[inline]
    pub fn is_8bit(&self) -> bool {
        (self.m_hash_and_flags & Self::S_HASH_FLAG_8BIT_BUFFER) != 0
    }
    #[inline]
    pub fn byte_length(&self) -> usize {
        if self.is_8bit() { self.m_length as usize } else { (self.m_length as usize) * 2 }
    }
    #[inline]
    pub fn ref_count(&self) -> u32 { self.m_ref_count / Self::S_REF_COUNT_INCREMENT }
    #[inline]
    pub fn is_static(&self) -> bool {
        self.m_ref_count & Self::S_REF_COUNT_FLAG_IS_STATIC_STRING != 0
    }
    #[inline]
    pub fn has_at_least_one_ref(&self) -> bool {
        // WTF::StringImpl::hasAtLeastOneRef
        self.m_ref_count > 0
    }
    #[inline]
    /// # Safety
    /// `self` must point to a live `WTFStringImpl` with refcount ≥ 1.
    pub unsafe fn ref_(self: *mut Self) {
        debug_assert!(unsafe { (*self).has_at_least_one_ref() });
        // SAFETY: FFI — `Bun__WTFStringImpl__ref` increments the WTF refcount.
        unsafe { Bun__WTFStringImpl__ref(self) }
    }
    #[inline]
    /// # Safety
    /// `self` must point to a live `WTFStringImpl` with refcount ≥ 1. May free `*self`.
    pub unsafe fn deref(self: *mut Self) {
        debug_assert!(unsafe { (*self).has_at_least_one_ref() });
        // SAFETY: FFI — `Bun__WTFStringImpl__deref` decrements (and may free) the WTF impl.
        unsafe { Bun__WTFStringImpl__deref(self) }
    }
    #[inline]
    pub fn ref_count_allocator(self: *mut Self) -> StdAllocator {
        StdAllocator { ptr: self.cast(), vtable: StringImplAllocator::VTABLE_PTR }
    }
    #[inline]
    pub fn latin1_slice(&self) -> &[u8] {
        debug_assert!(self.is_8bit());
        // SAFETY: WebKit guarantees m_ptr.latin1 valid for m_length bytes when 8-bit.
        unsafe { core::slice::from_raw_parts(self.m_ptr.latin1, self.m_length as usize) }
    }
    #[inline]
    pub fn utf16_slice(&self) -> &[u16] {
        debug_assert!(!self.is_8bit());
        // SAFETY: WebKit guarantees m_ptr.utf16 valid for m_length u16s when !8-bit.
        unsafe { core::slice::from_raw_parts(self.m_ptr.utf16, self.m_length as usize) }
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
    fn Bun__WTFStringImpl__ref(this: WTFStringImpl);
    fn Bun__WTFStringImpl__deref(this: WTFStringImpl);
}

/// Port of `bun.String.StringImplAllocator` (src/string/wtf.zig).
///
/// A `std.mem.Allocator` vtable whose `ptr` is a `WTFStringImpl`; `alloc` bumps
/// the refcount, `free` derefs. Hoisted into `bun_alloc` (which already owns
/// `AllocatorVTable` and the `WTFStringImplStruct` layout) so the
/// `is_wtf_allocator` vtable-identity check is a local pointer compare — no
/// upward dependency on `bun_string` and no runtime fn-ptr hook.
#[allow(non_snake_case)] // Zig namespace `bun.String.StringImplAllocator`
pub mod StringImplAllocator {
    use super::{Alignment, AllocatorVTable, WTFStringImpl, WTFStringImplStruct};

    unsafe fn alloc(ptr: *mut core::ffi::c_void, len: usize, _: Alignment, _: usize) -> *mut u8 {
        let this: WTFStringImpl = ptr.cast();
        // SAFETY: vtable contract — `ptr` is the `WTFStringImpl` passed to
        // `ref_count_allocator`.
        let len_ = unsafe { (*this).byte_length() };
        if len_ != len {
            // we don't actually allocate, we just reference count
            return core::ptr::null_mut();
        }
        // SAFETY: vtable contract — `this` is a live WTFStringImpl with refcount ≥ 1.
        unsafe { WTFStringImplStruct::ref_(this) };
        // we should never actually allocate
        // SAFETY: m_ptr.latin1 valid for byte_length bytes.
        unsafe { (*this).m_ptr.latin1.cast_mut() }
    }

    unsafe fn free(ptr: *mut core::ffi::c_void, buf: &mut [u8], _: Alignment, _: usize) {
        let this: WTFStringImpl = ptr.cast();
        // SAFETY: see `alloc`.
        debug_assert!(unsafe { (*this).m_ptr.latin1 } == buf.as_ptr());
        // Zig: `bun.assert(this.latin1Slice().len == buf.len)` — `latin1Slice().len` is
        // `byteLength()` (i.e. `m_length * 2` for UTF-16), not the code-unit count.
        debug_assert!(unsafe { (*this).byte_length() } == buf.len());
        // SAFETY: vtable contract — `this` is a live WTFStringImpl with refcount ≥ 1.
        unsafe { WTFStringImplStruct::deref(this) };
    }

    pub static VTABLE: AllocatorVTable = AllocatorVTable {
        alloc,
        resize: AllocatorVTable::NO_RESIZE,
        remap: AllocatorVTable::NO_REMAP,
        free,
    };

    pub const VTABLE_PTR: &'static AllocatorVTable = &VTABLE;
}

/// Port of `bun.String.StringImpl` — `extern union`.
#[repr(C)]
pub union StringImpl {
    pub zig_string: ZigString,
    pub wtf_string_impl: WTFStringImpl,
    // .StaticZigString aliases .zig_string; .Dead/.Empty are zero-width.
}

/// Port of `bun.String` (a.k.a. `BunString` in C++).
///
/// 5-variant tagged union over WTF-backed and Zig-slice-backed strings. NOT a
/// Rust `enum` because C++ mutates `tag` and `value` independently across FFI.
#[repr(C)]
pub struct String {
    pub tag: Tag,
    pub value: StringImpl,
}

impl String {
    pub const NAME: &'static str = "BunString";

    /// Port of `bun.String.isWTFAllocator` — vtable-identity check against
    /// [`StringImplAllocator::VTABLE`].
    #[inline]
    pub fn is_wtf_allocator(allocator: StdAllocator) -> bool {
        core::ptr::eq(allocator.vtable, StringImplAllocator::VTABLE_PTR)
    }

    pub const EMPTY: String = String {
        tag: Tag::Empty,
        value: StringImpl { zig_string: ZigString::EMPTY },
    };
    pub const DEAD: String = String {
        tag: Tag::Dead,
        value: StringImpl { zig_string: ZigString::EMPTY },
    };

    #[inline]
    pub fn to_zig_string(&self) -> ZigString {
        match self.tag {
            Tag::StaticZigString | Tag::ZigString => unsafe { self.value.zig_string },
            Tag::WTFStringImpl => unsafe { (*self.value.wtf_string_impl).to_zig_string() },
            _ => ZigString::EMPTY,
        }
    }

    #[inline]
    pub fn length(&self) -> usize {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag == WTFStringImpl ⇒ non-null.
            unsafe { (*self.value.wtf_string_impl).length() as usize }
        } else {
            self.to_zig_string().length()
        }
    }

    #[inline] pub fn is_empty(&self) -> bool { self.length() == 0 }

    #[inline]
    pub fn is_8bit(&self) -> bool {
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf_string_impl).is_8bit() },
            Tag::ZigString => unsafe { !self.value.zig_string.is_16bit() },
            _ => true,
        }
    }

    /// Zig `eqlComptime` — compare against a (typically literal) byte slice.
    /// PERF(port): Zig dispatched to SIMD `bun.strings.eqlComptime*`; this T0
    /// version uses scalar `==` / widening compare. Phase B re-routes to
    /// `bun_str::strings` via inlining once tier ordering settles.
    pub fn eql_comptime(&self, other: &[u8]) -> bool {
        let zs = self.to_zig_string();
        if zs.is_16bit() {
            let u16s = zs.utf16_slice_aligned();
            if u16s.len() != other.len() {
                return false;
            }
            u16s.iter().copied().zip(other.iter().copied()).all(|(a, b)| a == b as u16)
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
        && (slice_ptr + slice.len() * size_of::<T>()) <= (buffer_ptr + buffer.len() * size_of::<T>())
}

/// Checks if a slice's pointer is contained within another slice.
/// If you need to make this generic, use `is_slice_in_buffer_t`.
pub fn is_slice_in_buffer(slice: &[u8], buffer: &[u8]) -> bool {
    is_slice_in_buffer_t::<u8>(slice, buffer)
}

pub fn slice_range(slice: &[u8], buffer: &[u8]) -> Option<[u32; 2]> {
    let slice_ptr = slice.as_ptr() as usize;
    let buffer_ptr = buffer.as_ptr() as usize;
    if buffer_ptr <= slice_ptr && (slice_ptr + slice.len()) <= (buffer_ptr + buffer.len()) {
        Some([
            (slice_ptr - buffer_ptr) as u32, // @truncate
            slice.len() as u32,              // @truncate
        ])
    } else {
        None
    }
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

/// Zig: `bun.default_allocator.dupe(u8, src)` for raw `[]u8` not owned by a
/// `Vec`/`Box` — symmetric with [`default_free`]. Returns a `&'static [u8]`
/// view onto a fresh mimalloc allocation; caller is responsible for pairing
/// with `default_free(ptr, len)`.
///
/// Empty input borrows the static empty slice (no allocation; `default_free`
/// no-ops on `len == 0`).
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

/// Memory is typically not decommitted immediately when freed. Sensitive
/// information kept in memory can be read until the OS decommits it or the
/// allocator reuses it. Zero it before dropping.
///
/// Zig used `std.crypto.secureZero` then `allocator.free`; Rust drops the
/// allocator param (global mimalloc) and uses volatile writes so the zeroing
/// cannot be elided by the optimizer.
pub fn free_sensitive<T: Copy>(mut slice: Box<[T]>) {
    // SAFETY: `slice` is exclusively owned; writing `size_of_val` zero bytes
    // over its storage is sound for `T: Copy` (no drop glue, no invariants on
    // the bit pattern we're discarding). Volatile writes match
    // `std.crypto.secureZero` and cannot be dead-store-eliminated.
    unsafe {
        let len = core::mem::size_of_val::<[T]>(&slice);
        let ptr = slice.as_mut_ptr().cast::<u8>();
        let mut i = 0usize;
        while i < len {
            core::ptr::write_volatile(ptr.add(i), 0u8);
            i += 1;
        }
        core::sync::atomic::compiler_fence(core::sync::atomic::Ordering::SeqCst);
    }
    drop(slice);
}

// ──────────────────────────────────────────────────────────────────────────
// IndexType — `packed struct(u32) { index: u31, is_overflow: bool = false }`
// Zig packed-struct fields are LSB-first: bits 0..=30 = index, bit 31 = is_overflow.
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

// ──────────────────────────────────────────────────────────────────────────
// BSSList / BSSStringList / BSSMapInner — real method bodies follow below.
// Per-monomorphization statics are emitted at the declare site via the
// `bss_list!` / `bss_string_list!` / `bss_map_inner!` / `bss_map!` macros
// (`SyncUnsafeCell<MaybeUninit<Self>>` + `Once` + `init_at`). `init()` is a
// thin heap-allocating wrapper for callers that manage their own once-guard.
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// `bun.allocators` namespace shim
//
// Zig exposed this file as `bun.allocators.*`; downstream crates were ported
// against that path (`use bun_alloc::allocators;`). Re-export the crate root
// so `allocators::IndexType`, `allocators::BSSMapInner`, etc. resolve without
// rewriting every callsite.
// ──────────────────────────────────────────────────────────────────────────
pub mod allocators {
    pub use super::*;
}

// ──────────────────────────────────────────────────────────────────────────
// Per-monomorphization singleton macros
//
// Zig defines `pub var instance: *Self = undefined; pub var loaded = false;`
// *inside* the generic type, giving one static per instantiation. Rust forbids
// generic statics, so the storage is emitted at the *declare site* instead:
//
//   bss_string_list! { pub dirname_store: 4096, 129 }
//   // → static STORAGE: SyncUnsafeCell<MaybeUninit<BSSStringList<4096,129>>>
//   //   pub fn dirname_store() -> &'static mut BSSStringList<4096,129>
//
// The accessor lazily field-initializes via `init_at` under `std::sync::Once`.
// Returning `&'static mut` is the same aliasing contract as Zig's global
// `instance` pointer — callers must not hold overlapping unique borrows.
// ──────────────────────────────────────────────────────────────────────────

/// Emit a `'static`-storage singleton accessor for any type with an
/// `unsafe fn init_at(*mut Self)` in-place initializer.
#[macro_export]
macro_rules! bss_singleton {
    ($(#[$m:meta])* $vis:vis fn $name:ident() -> $ty:ty) => {
        $(#[$m])*
        $vis fn $name() -> *mut $ty {
            static STORAGE: ::core::cell::SyncUnsafeCell<::core::mem::MaybeUninit<$ty>> =
                ::core::cell::SyncUnsafeCell::new(::core::mem::MaybeUninit::uninit());
            static ONCE: ::std::sync::Once = ::std::sync::Once::new();
            // SAFETY: STORAGE is private to this fn; ONCE ensures single init before any
            // read; matches Zig's `var instance / var loaded` lazy-singleton pattern.
            // Returns a raw `*mut` (same contract as Zig's `*Self`) — fabricating
            // `&'static mut` here would alias on every call (forbidden).
            unsafe {
                let slot = (*STORAGE.get()).as_mut_ptr();
                ONCE.call_once(|| <$ty>::init_at(slot));
                slot
            }
        }
    };
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
#[allow(dead_code)]
mod __bss_macro_smoke {
    crate::bss_list!        { _l  : u32, 4 }
    crate::bss_string_list! { _sl : 4, 8 }
    crate::bss_map_inner!   { _mi : u32, 4, true }
    crate::bss_map!         { _m  : u32, 4, 8, false }
}

// ──────────────────────────────────────────────────────────────────────────
// heap_breakdown — macOS `malloc_zone_*` per-tag heaps (debug-only)
//
// Full draft lives in `heap_breakdown.rs` (macOS-only; depends on a richer
// `Allocator` surface + a string-keyed map). This inline module exposes the
// symbols dependents reference (`ENABLED`, `Zone`, `get_zone`,
// `malloc_zone_{calloc,free,malloc}`) and compiles on all targets — on
// non-macOS the FFI surface is `unreachable!()` behind `ENABLED == false`.
// ──────────────────────────────────────────────────────────────────────────

pub mod heap_breakdown {
    use core::cell::UnsafeCell;
    #[allow(unused_imports)]
    use core::ffi::{c_char, c_uint, c_void};
    use core::marker::{PhantomData, PhantomPinned};

    /// `Environment.allow_assert and Environment.isMac and !Environment.enable_asan`
    // TODO(port): `enable_asan` → cargo feature; wire in Phase B.
    pub const ENABLED: bool = cfg!(debug_assertions) && cfg!(target_os = "macos");

    /// Opaque FFI handle for a macOS `malloc_zone_t`.
    //
    // `_p` is `UnsafeCell` so the type is `!Freeze`: libmalloc mutates the
    // zone's internal state on every `malloc_zone_*` call, and we hand out
    // `&'static Zone` across threads. Without interior mutability, deriving a
    // `*mut Zone` from `&Zone` and writing through it is UB under Stacked
    // Borrows. Zig spec uses `*Zone` (freely-aliasing mutable); `UnsafeCell`
    // is the Rust encoding of that intent.
    #[repr(C)]
    pub struct Zone {
        _p: UnsafeCell<[u8; 0]>,
        _m: PhantomData<(*mut u8, PhantomPinned)>,
    }

    // SAFETY: `malloc_zone_t` is internally synchronized by libmalloc; sharing a
    // `*const Zone` across threads is the documented usage.
    unsafe impl Sync for Zone {}
    unsafe impl Send for Zone {}

    impl Zone {
        /// Zig: `Zone.init(comptime name)` — creates and names a malloc zone.
        ///
        /// # Safety
        /// `name` must point to a NUL-terminated C string that remains valid
        /// for the entire process lifetime — `malloc_set_zone_name` stores the
        /// pointer (does not copy).
        #[cfg(target_os = "macos")]
        pub unsafe fn init(name: *const c_char) -> &'static Zone {
            // SAFETY: `malloc_create_zone(0, 0)` returns a process-lifetime zone;
            // caller guarantees `name` outlives the process.
            unsafe {
                let zone = malloc_create_zone(0, 0);
                malloc_set_zone_name(zone, name);
                &*zone
            }
        }
        #[cfg(not(target_os = "macos"))]
        #[allow(clippy::missing_safety_doc)]
        pub unsafe fn init(_name: *const c_char) -> &'static Zone {
            unreachable!("heap_breakdown is macOS-only; guard call sites on ENABLED")
        }

        /// Zig: `Zone.isInstance(allocator)` — vtable-identity check.
        // Zig compared `allocator.vtable == &Zone.vtable`; the Rust trait
        // exposes a `type_id()` hook so identity is checked by concrete type.
        pub fn is_instance(alloc: &dyn crate::Allocator) -> bool {
            crate::Allocator::type_id(alloc) == core::any::TypeId::of::<Zone>()
        }

        /// Raw `*mut malloc_zone_t` for the FFI surface.
        ///
        /// `Zone` is `#[repr(C)]` with `_p: UnsafeCell<[u8; 0]>` at offset 0,
        /// so `_p.get()` yields a pointer at the struct's base address that
        /// carries interior-mut provenance — no `*const → *mut` cast from a
        /// shared ref. libmalloc handles its own synchronization.
        #[inline]
        pub fn as_mut_ptr(&self) -> *mut Zone {
            self._p.get().cast()
        }

        #[inline]
        pub fn malloc_zone_malloc(&self, size: usize) -> Option<*mut c_void> {
            // SAFETY: `self` is a live `malloc_zone_t`; `as_mut_ptr` derives a
            // write-capable pointer through `UnsafeCell`.
            let p = unsafe { malloc_zone_malloc(self.as_mut_ptr(), size) };
            if p.is_null() { None } else { Some(p) }
        }

        #[inline]
        pub fn malloc_zone_calloc(&self, num_items: usize, size: usize) -> Option<*mut c_void> {
            // SAFETY: `self` is a live `malloc_zone_t`; `as_mut_ptr` derives a
            // write-capable pointer through `UnsafeCell`.
            let p = unsafe { malloc_zone_calloc(self.as_mut_ptr(), num_items, size) };
            if p.is_null() { None } else { Some(p) }
        }

        /// # Safety
        /// `ptr` must have been allocated by this zone (via `malloc_zone_malloc`
        /// / `malloc_zone_calloc`) and not already freed.
        #[inline]
        pub unsafe fn malloc_zone_free(&self, ptr: *mut c_void) {
            // SAFETY: caller contract above; `self` is a live `malloc_zone_t`.
            unsafe { malloc_zone_free(self.as_mut_ptr(), ptr) }
        }
    }

    /// Runtime `getZone(name)` — looks up (or creates) the per-name zone.
    ///
    /// Zig used a comptime-monomorphized `static` per literal; the macro
    /// `get_zone!` below is the zero-cost form. This runtime path keys a
    /// process-global map for callers that pass a non-literal name.
    #[allow(clippy::assertions_on_constants)]
    pub fn get_zone(name: &[u8]) -> &'static Zone {
        debug_assert!(ENABLED, "heap_breakdown::get_zone called with ENABLED=false");
        // Map key = `name` (no NUL) so lookups match inserts. The NUL-terminated
        // label handed to `malloc_set_zone_name` is stored as the map *value*
        // (alongside the zone) to keep its allocation alive for 'static.
        static ZONES: std::sync::OnceLock<
            parking_lot::Mutex<std::collections::HashMap<Vec<u8>, (Vec<u8>, &'static Zone)>>,
        > = std::sync::OnceLock::new();
        let map = ZONES.get_or_init(Default::default);
        let mut map = map.lock();
        if let Some((_, z)) = map.get(name) {
            return *z;
        }
        // Zone names live forever (zones are never destroyed); allocate the
        // NUL-terminated label once, hand the OS a raw pointer into its heap
        // buffer, then move the owning `Vec` into the 'static map so the buffer
        // outlives the process. PORTING.md §Forbidden: no `&*(p as *const _)`
        // lifetime extension — ownership is encoded in the map, not faked.
        let mut owned = Vec::with_capacity(name.len() + 1);
        owned.extend_from_slice(name);
        owned.push(0);
        // `Vec`'s heap buffer address is stable when the `Vec` struct is moved
        // (only the {ptr,len,cap} header moves), and the map never removes or
        // mutates this entry, so `raw` remains valid for process lifetime.
        let raw = owned.as_ptr().cast::<c_char>();
        // SAFETY: `raw` points into a NUL-terminated buffer that is moved into
        // the 'static `ZONES` map immediately below and never freed.
        let zone = unsafe { Zone::init(raw) };
        map.insert(name.to_vec(), (owned, zone));
        zone
    }

    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        pub fn malloc_create_zone(start_size: usize, flags: c_uint) -> *mut Zone;
        pub fn malloc_set_zone_name(zone: *mut Zone, name: *const c_char);
        pub fn malloc_zone_malloc(zone: *mut Zone, size: usize) -> *mut c_void;
        pub fn malloc_zone_calloc(zone: *mut Zone, num_items: usize, size: usize) -> *mut c_void;
        pub fn malloc_zone_free(zone: *mut Zone, ptr: *mut c_void);
        pub fn malloc_zone_memalign(zone: *mut Zone, alignment: usize, size: usize) -> *mut c_void;
    }

    // Non-macOS stubs so cross-platform call sites guarded by `if ENABLED { … }`
    // (where `ENABLED` is a `const false`) still type-check. Never executed.
    #[cfg(not(target_os = "macos"))]
    #[allow(clippy::missing_safety_doc)]
    mod stubs {
        use super::*;
        pub unsafe fn malloc_zone_malloc(_: *mut Zone, _: usize) -> *mut c_void { unreachable!() }
        pub unsafe fn malloc_zone_calloc(_: *mut Zone, _: usize, _: usize) -> *mut c_void { unreachable!() }
        pub unsafe fn malloc_zone_free(_: *mut Zone, _: *mut c_void) { unreachable!() }
    }
    #[cfg(not(target_os = "macos"))]
    pub use stubs::{malloc_zone_calloc, malloc_zone_free, malloc_zone_malloc};

    // `Zone` participates in `&dyn Allocator` identity checks (`is_instance`).
    impl crate::Allocator for Zone {}
}

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
                    concat!($name, "\0").as_ptr() as *const ::core::ffi::c_char,
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

// Zig `IndexMapContext` is the identity hash on a u64 key.
// TODO(port): `bun_collections::HashMap` needs an identity-hash builder; using std default for now.
pub type IndexMap = HashMap<HashKeyType, IndexType>;
pub type IndexMapManaged = HashMap<HashKeyType, IndexType>;

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
            && self.ptrs[self.used as usize].as_ref().expect("alloc").is_full()
        {
            self.used = self.used.wrapping_add(1);
            if self.allocated > self.used {
                *self.ptrs[self.used as usize].as_mut().expect("alloc").used_mut() = 0;
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
// `feature(generic_const_exprs)` on stable Rust. Phase B may pin COUNT per instantiation site
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
    fn is_full(&self) -> bool { (self.used as usize) >= COUNT }
    fn used_mut(&mut self) -> &mut u32 { &mut self.used }
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

        // SAFETY: `idx % COUNT < used` (asserted above) ⇒ slot was initialized by `append`.
        unsafe { self.list.ptrs[block_id].as_ref().expect("alloc").items[idx % COUNT].assume_init_ref() }
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

        // SAFETY: `idx % COUNT < used` (asserted above) ⇒ slot was initialized by `append`.
        unsafe { self.list.ptrs[block_id].as_mut().expect("alloc").items[idx % COUNT].assume_init_mut() }
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
/// TODO(port): const-generic arithmetic (`COUNT = _COUNT * 2`) and per-monomorphization
/// `static mut INSTANCE` are not expressible on stable Rust. Phase B: instantiate per use-site
/// via `macro_rules!` or pin concrete `COUNT` constants.
pub struct BSSList<ValueType, const COUNT: usize /* = _COUNT * 2 */> {
    pub mutex: Mutex,
    // LIFETIMES.tsv: dual semantics — points at sibling `tail` OR a heap alloc.
    // TODO(port): lifetime — keep raw NonNull; self-referential when `head == &self.tail`.
    pub head: Option<NonNull<BSSListOverflowBlock<ValueType>>>,
    pub tail: BSSListOverflowBlock<ValueType>,
    // Zig leaves `backing_buf` undefined; only `[0..used]` is initialized.
    pub backing_buf: [MaybeUninit<ValueType>; COUNT],
    pub used: u32,
}

// SAFETY: `head` is a self-referential `NonNull` into `self.tail` or a heap block owned by
// `self`; all mutation goes through `self.mutex`. The raw pointer is the only `!Sync` field;
// the type is logically a mutex-guarded global (matches Zig's threadsafe singleton).
unsafe impl<ValueType: Send, const COUNT: usize> Send for BSSList<ValueType, COUNT> {}
unsafe impl<ValueType: Send, const COUNT: usize> Sync for BSSList<ValueType, COUNT> {}

const BSS_LIST_CHUNK_SIZE: usize = 256;

/// Fixed overflow-block capacity for `BSSStringList` / `BSSMapInner`.
/// Zig uses `count / 4`; stable Rust cannot express const-generic arithmetic
/// (`generic_const_exprs`), so use a nonzero stand-in until Phase B threads the
/// per-instantiation value through. A value of 0 here would make
/// `OverflowListBlock::is_full` always true and `at_index`'s `idx % COUNT` panic.
pub const BSS_OVERFLOW_BLOCK_SIZE: usize = 64;

pub struct BSSListOverflowBlock<ValueType> {
    pub used: AtomicU16,
    // Zig leaves `data` undefined; only `[0..used]` is initialized.
    pub data: [MaybeUninit<ValueType>; BSS_LIST_CHUNK_SIZE],
    pub prev: Option<Box<BSSListOverflowBlock<ValueType>>>,
}

impl<ValueType> BSSListOverflowBlock<ValueType> {
    /// In-place initialize `used` and `prev` on possibly-uninitialized storage.
    /// SAFETY: `this` must point to writable, properly-aligned storage of `Self`.
    #[inline]
    pub unsafe fn zero(this: *mut Self) {
        // Avoid struct initialization syntax.
        // This makes Bun start about 1ms faster.
        // https://github.com/ziglang/zig/issues/24313
        // Raw `ptr::write` — `*this` may be uninit; assignment would run drop glue
        // on garbage (UAF for `prev: Option<Box<..>>`).
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
}

// `deinit` for OverflowBlock: walks `prev` and frees each. With `prev: Option<Box<..>>`,
// `Drop` handles the chain automatically — no explicit impl needed.

impl<ValueType, const COUNT: usize> BSSList<ValueType, COUNT> {
    pub const CHUNK_SIZE: usize = BSS_LIST_CHUNK_SIZE;
    const MAX_INDEX: usize = COUNT - 1;

    // Zig: `pub var instance: *Self = undefined; pub var loaded = false;`
    // Rust cannot define generic statics, so the per-monomorphization storage is
    // emitted at the *declare site* via `bss_list! { name: T, N }` (see macro
    // below), which owns a `SyncUnsafeCell<MaybeUninit<Self>>` + `Once` and
    // calls `init_at` on first access. `init()` is kept for callers that manage
    // their own once-guard (e.g. `dir_info::hash_map_instance`); it heap-allocs
    // a fresh instance each call.

    #[inline]
    pub fn block_index(index: u32 /* u31 */) -> usize {
        index as usize / BSS_LIST_CHUNK_SIZE
    }

    /// In-place field initialization into uninitialized storage.
    ///
    /// SAFETY: `slot` must point to writable, properly-aligned, uninitialized
    /// (or droppable-as-uninit) storage of `size_of::<Self>()` bytes that lives
    /// for `'static`. `backing_buf` and `tail.data` are intentionally left
    /// uninitialized (Zig leaves them `undefined`); only `[0..used]` is read.
    pub unsafe fn init_at(slot: *mut Self) {
        // SAFETY: caller contract — `slot` is a valid, exclusive, aligned `*mut Self`.
        unsafe {
            addr_of_mut!((*slot).mutex).write(Mutex::new());
            addr_of_mut!((*slot).used).write(0);
            addr_of_mut!((*slot).tail.used).write(AtomicU16::new(0));
            addr_of_mut!((*slot).tail.prev).write(None);
            // Zig: `instance.head = &instance.tail` — self-referential; raw NonNull.
            let tail_ptr = addr_of_mut!((*slot).tail);
            addr_of_mut!((*slot).head).write(Some(NonNull::new_unchecked(tail_ptr)));
        }
    }

    /// Heap-allocate and initialize a fresh instance. The once-guard (Zig's
    /// `loaded` flag) is the *caller's* responsibility — use `bss_list!` for
    /// the canonical per-monomorphization singleton.
    pub fn init() -> &'static mut Self {
        // Zig: `default_allocator.create(Self)` — route through mimalloc.
        // SAFETY: FFI — mi_malloc returns null on OOM or a writable, suitably-aligned region.
        let ptr = unsafe { mimalloc::mi_malloc_aligned(size_of::<Self>(), core::mem::align_of::<Self>()) }.cast::<Self>();
        assert!(!ptr.is_null(), "OOM");
        // SAFETY: ptr is a fresh, exclusively-owned, properly-aligned allocation; lives for
        // process lifetime (singleton; never freed, matching Zig).
        unsafe { Self::init_at(ptr); &mut *ptr }
    }

    // Zig `deinit` → `impl Drop for BSSList` below (PORTING.md: never expose `pub fn deinit`).
    // The `instance.destroy()` + `loaded = false` half is singleton teardown — Phase B static
    // wrapper owns that; Drop only frees the heap-allocated head chain.

    pub fn is_overflowing(instance: &Self) -> bool {
        instance.used as usize >= COUNT
    }

    pub fn exists(&self, value: &[u8]) -> bool {
        // Zig: `isSliceInBuffer(value, &instance.backing_buf)` — pointer-range check
        // against the backing storage as raw bytes.
        // SAFETY: reading the byte range of `backing_buf` for a pointer-containment check
        // (no dereference of element data). `MaybeUninit<T>` storage is always validly addressable.
        let buf = unsafe {
            core::slice::from_raw_parts(
                self.backing_buf.as_ptr().cast::<u8>(),
                core::mem::size_of_val(&self.backing_buf),
            )
        };
        is_slice_in_buffer(value, buf)
    }

    fn append_overflow(
        &mut self,
        value: ValueType,
    ) -> core::result::Result<&mut ValueType, AllocError> {
        self.used += 1;
        // SAFETY: head is always non-null after init() (points at self.tail or heap block).
        let mut head_ptr = self.head.unwrap();
        // Zig: `self.head.append(value) catch { allocate new block; retry }`.
        // Restructured to avoid consuming `value` twice (no `Clone` bound, per
        // PORTING.md §Forbidden): check capacity first, allocate the new block
        // if needed, then `append(value)` exactly once. Safe under `self.mutex`.
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
                // `append_overflow` and is exclusively owned via `self.head`.
                Some(unsafe { Box::from_raw(head_ptr.as_ptr()) })
            };
            let raw = Box::into_raw(new_block);
            // SAFETY: raw came from Box::into_raw on the line above; non-null and exclusively owned.
            head_ptr = unsafe { NonNull::new_unchecked(raw) };
            self.head = Some(head_ptr);
        }
        // SAFETY: `head_ptr` is the (possibly freshly-allocated) head block with
        // free capacity; no other alias exists (mutex held).
        unsafe { (*head_ptr.as_ptr()).append(value) }
    }

    pub fn append(
        &mut self,
        value: ValueType,
    ) -> core::result::Result<&mut ValueType, AllocError> {
        let _guard = self.mutex.lock();
        // TODO(port): Zig reads `instance.*` here even though `self == instance`; kept as `self`.
        if self.used as usize > Self::MAX_INDEX {
            self.append_overflow(value)
        } else {
            let index = self.used as usize;
            // Raw write — slot is uninit; Zig assignment has no drop glue.
            self.backing_buf[index].write(value);
            self.used += 1;
            // SAFETY: just initialized on the line above.
            Ok(unsafe { self.backing_buf[index].assume_init_mut() })
        }
    }

    // Zig: `pub const Pair = struct { index: IndexType, value: *ValueType };`
    // LIFETIMES.tsv: ARENA → *const ValueType. Type appears unused.
}

impl<ValueType, const COUNT: usize> Drop for BSSList<ValueType, COUNT> {
    fn drop(&mut self) {
        // Zig `deinit`: `self.head.deinit()` walks `prev` and frees each heap block.
        // The inline `self.tail` is not Boxed and must not be Box-dropped; the
        // `prev: Option<Box<..>>` chain stops at `None` before reaching it
        // (see `append_overflow`). Singleton `loaded = false` reset belongs to the
        // Phase-B static wrapper, not here.
        if let Some(head) = self.head.take() {
            let tail_ptr: *const BSSListOverflowBlock<ValueType> = core::ptr::addr_of!(self.tail);
            if !core::ptr::eq(head.as_ptr().cast_const(), tail_ptr) {
                // SAFETY: `head` was `Box::into_raw`'d by `append_overflow` and is
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

/// Append-only list.
/// Stores an initial count in .bss section of the object file.
/// Overflows to heap when count is exceeded.
///
/// TODO(port): same const-generic-arithmetic and per-type-static caveats as `BSSList`.
pub struct BSSStringList<const COUNT: usize /* = _COUNT * 2 */, const ITEM_LENGTH: usize /* = _ITEM_LENGTH + 1 */> {
    // TODO(port): backing_buf len = COUNT * ITEM_LENGTH (generic_const_exprs).
    pub backing_buf: Box<[u8]>, // logically [u8; COUNT * ITEM_LENGTH]
    pub backing_buf_used: u64,
    // TODO(port): Overflow = OverflowList<&'static [u8], COUNT / 4> (generic_const_exprs).
    // Fixed nonzero block size until generic_const_exprs lands; 0 would div-by-zero in at_index.
    pub overflow_list: OverflowList<&'static [u8], BSS_OVERFLOW_BLOCK_SIZE>,
    pub slice_buf: Box<[&'static [u8]]>, // logically [&[u8]; COUNT]
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
    fn total_len(&self) -> usize { self.len }
    fn copy_into(&self, _dst: &mut [u8]) {}
}
impl BSSAppendable for &[u8] {
    fn total_len(&self) -> usize { self.len() }
    fn copy_into(&self, dst: &mut [u8]) { dst[..self.len()].copy_from_slice(self); }
}
impl<const N: usize> BSSAppendable for [&[u8]; N] {
    fn total_len(&self) -> usize { self.iter().map(|s| s.len()).sum() }
    fn copy_into(&self, dst: &mut [u8]) {
        let mut remainder = dst;
        for val in self {
            remainder[..val.len()].copy_from_slice(val);
            remainder = &mut remainder[val.len()..];
        }
    }
}
impl BSSAppendable for &[&[u8]] {
    fn total_len(&self) -> usize { self.iter().map(|s| s.len()).sum() }
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
        // SAFETY: caller contract — `slot` is a valid, exclusive, aligned `*mut Self`.
        unsafe {
            addr_of_mut!((*slot).mutex).write(Mutex::new());
            addr_of_mut!((*slot).backing_buf).write(vec![0u8; COUNT * ITEM_LENGTH].into_boxed_slice());
            addr_of_mut!((*slot).backing_buf_used).write(0);
            addr_of_mut!((*slot).slice_buf).write(vec![&[][..]; COUNT].into_boxed_slice());
            addr_of_mut!((*slot).slice_buf_used).write(0);
            // SAFETY: `OverflowList` is `{ count: u32, list: { used,allocated: u16, ptrs: [Option<Box<_>>; N] } }`.
            // `Option<Box<_>>` is null-niche-optimized → all-zeros is `[None; N]`; integers zero is valid.
            core::ptr::write_bytes(addr_of_mut!((*slot).overflow_list), 0u8, 1);
        }
    }

    /// Heap-allocate and initialize a fresh instance. Once-guard is the caller's
    /// responsibility — use `bss_string_list!` for the canonical singleton.
    pub fn init() -> &'static mut Self {
        // SAFETY: FFI — mi_malloc_aligned returns null on OOM or a writable, suitably-aligned region.
        let ptr = unsafe { mimalloc::mi_malloc_aligned(size_of::<Self>(), core::mem::align_of::<Self>()) }.cast::<Self>();
        assert!(!ptr.is_null(), "OOM");
        // SAFETY: ptr is a fresh, exclusively-owned, properly-aligned allocation; lives for
        // process lifetime (singleton; never freed, matching Zig).
        unsafe { Self::init_at(ptr); &mut *ptr }
    }

    // Zig `deinit`: just frees `instance`. Handled by dropping the singleton Box in Phase B.

    #[inline]
    pub fn is_overflowing(instance: &Self) -> bool {
        instance.slice_buf_used as usize >= COUNT
    }

    pub fn exists(&self, value: &[u8]) -> bool {
        is_slice_in_buffer(value, &self.backing_buf)
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
        unsafe { core::slice::from_raw_parts_mut(ptr, len) }
    }

    pub fn append_mutable<A: BSSAppendable>(
        &mut self,
        value: A,
    ) -> core::result::Result<&mut [u8], AllocError> {
        let _guard = self.mutex.lock();
        let (ptr, len) = self.do_append(value)?;
        // SAFETY: `ptr` came from `out.as_mut_ptr()` inside `do_append` (write provenance)
        // and points into storage owned by `*self` (backing_buf or a process-lifetime
        // mimalloc region); we hold `&mut self` so no other live borrow of that region
        // exists.
        Ok(unsafe { core::slice::from_raw_parts_mut(ptr, len) })
    }

    pub fn get_mutable(&mut self, len: usize) -> core::result::Result<&mut [u8], AllocError> {
        self.append_mutable(EmptyType { len })
    }

    pub fn print_with_type(
        &mut self,
        args: core::fmt::Arguments<'_>,
    ) -> core::result::Result<&[u8], AllocError> {
        // ── std.fmt.count: drive a discarding `fmt::Write` that only sums byte lengths.
        // (Inlined here because bun_alloc sits below bun_core in T0; cannot pull
        // `bun_core::fmt::count`.)
        struct Discarding(usize);
        impl core::fmt::Write for Discarding {
            #[inline]
            fn write_str(&mut self, s: &str) -> core::fmt::Result {
                self.0 += s.len();
                Ok(())
            }
        }
        let mut counter = Discarding(0);
        // Infallible: our `write_str` never errors (Zig: `error.WriteFailed => unreachable`).
        let _ = core::fmt::write(&mut counter, args);
        let len = counter.0;

        // var buf = try self.appendMutable(EmptyType, .{ .len = count + 1 });
        let buf = self.append_mutable(EmptyType { len: len + 1 })?;
        let buf_len = buf.len();
        // buf[buf.len - 1] = 0;
        buf[buf_len - 1] = 0;

        // ── std.fmt.bufPrint(buf[0..len-1], fmt, args) catch unreachable
        struct SliceCursor<'a> {
            buf: &'a mut [u8],
            pos: usize,
        }
        impl<'a> core::fmt::Write for SliceCursor<'a> {
            fn write_str(&mut self, s: &str) -> core::fmt::Result {
                let bytes = s.as_bytes();
                let end = self.pos + bytes.len();
                if end > self.buf.len() {
                    return Err(core::fmt::Error);
                }
                self.buf[self.pos..end].copy_from_slice(bytes);
                self.pos = end;
                Ok(())
            }
        }
        let written = {
            let mut cursor = SliceCursor { buf: &mut buf[..buf_len - 1], pos: 0 };
            // `catch unreachable`: we counted the exact length above.
            core::fmt::write(&mut cursor, args).expect("counted length");
            cursor.pos
        };
        Ok(&buf[..written])
    }

    pub fn print(
        &mut self,
        args: core::fmt::Arguments<'_>,
    ) -> core::result::Result<&[u8], AllocError> {
        self.print_with_type(args)
    }

    pub fn append<A: BSSAppendable>(
        &mut self,
        value: A,
    ) -> core::result::Result<&[u8], AllocError> {
        let _guard = self.mutex.lock();
        let (ptr, len) = self.do_append(value)?;
        // SAFETY: `ptr` points into storage owned by `*self` (backing_buf or a
        // process-lifetime mimalloc region); we hold `&mut self` so it's exclusive,
        // and reborrowing as shared is always sound.
        Ok(unsafe { core::slice::from_raw_parts(ptr, len) })
    }

    pub fn append_lower_case(
        &mut self,
        value: &[u8],
    ) -> core::result::Result<&[u8], AllocError> {
        let _guard = self.mutex.lock();

        // Zig: `threadlocal var lowercase_buf: bun.PathBuffer = undefined;`
        // (`bun.PathBuffer` = `[MAX_PATH_BYTES]u8` = `[4096]u8`.)
        thread_local! {
            static LOWERCASE_BUF: core::cell::RefCell<[u8; 4096]> =
                const { core::cell::RefCell::new([0u8; 4096]) };
        }
        let (ptr, len) = LOWERCASE_BUF.with_borrow_mut(|buf| {
            for (i, &c) in value.iter().enumerate() {
                buf[i] = c.to_ascii_lowercase();
            }
            // `do_append` only reads `slice` via `BSSAppendable::copy_into`
            // (copies into `self.backing_buf` / a fresh heap alloc) and returns
            // raw parts pointing at that owned storage, not at `slice` — so the
            // thread-local borrow does not escape the closure.
            let slice: &[u8] = &buf[..value.len()];
            self.do_append(slice)
        })?;
        // SAFETY: see `append`.
        Ok(unsafe { core::slice::from_raw_parts(ptr, len) })
    }

    /// Returns `(ptr, len)` of the freshly-appended payload (excluding the trailing NUL),
    /// where `ptr` carries write provenance (`out.as_mut_ptr()`). Callers reconstruct a
    /// `&[u8]` (`append`) or `&mut [u8]` (`append_mutable`) from it; returning raw parts
    /// avoids the `&self.backing_buf` ↔ `&mut self.slice_buf` borrowck conflict and the
    /// `&[u8] → &mut [u8]` provenance laundering Zig's `@constCast` would imply.
    #[inline]
    fn do_append<A: BSSAppendable>(
        &mut self,
        value: A,
    ) -> core::result::Result<(*mut u8, usize), AllocError> {
        let value_len: usize = value.total_len() + 1;

        let (out_ptr, out_len): (*mut u8, usize);
        if value_len + (self.backing_buf_used as usize) < self.backing_buf.len() - 1 {
            let start = self.backing_buf_used as usize;
            self.backing_buf_used += value_len as u64;
            let end = self.backing_buf_used as usize;

            value.copy_into(&mut self.backing_buf[start..end - 1]);
            self.backing_buf[end - 1] = 0;

            let out = &mut self.backing_buf[start..end - 1];
            (out_ptr, out_len) = (out.as_mut_ptr(), out.len());
        } else {
            // Zig: `var value_buf = try self.allocator.alloc(u8, value_len);` — propagate OOM.
            // Route through mimalloc directly (PORTING.md forbids `Box::leak`). BSSStringList
            // never frees overflow allocations (matches Zig); the singleton lives for
            // process lifetime.
            // SAFETY: FFI — mi_malloc returns null on OOM or a writable region of ≥value_len bytes.
            let ptr = unsafe { mimalloc::mi_malloc(value_len) }.cast::<u8>();
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

        let mut result = IndexType::new(u32::MAX >> 1, self.slice_buf_used as usize > Self::MAX_INDEX);

        if result.is_overflow() {
            result.set_index(self.overflow_list.len());
        } else {
            result.set_index(self.slice_buf_used as u32);
            self.slice_buf_used += 1;
        }

        // SAFETY: `out_ptr` addresses self.backing_buf or a process-lifetime alloc, both
        // outliving 'static (singleton). Zig stores it as `[]const u8` with no lifetime
        // tracking.
        let stored: &'static [u8] =
            unsafe { core::slice::from_raw_parts(out_ptr, out_len) };

        if result.is_overflow() {
            if self.overflow_list.len() == result.index() {
                let _ = self.overflow_list.append(stored);
            } else {
                *self.overflow_list.at_index_mut(result) = stored;
            }
        } else {
            self.slice_buf[result.index() as usize] = stored;
        }
        Ok((out_ptr, out_len))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BSSMap<ValueType, COUNT, STORE_KEYS, ESTIMATED_KEY_LENGTH, REMOVE_TRAILING_SLASHES>
// ──────────────────────────────────────────────────────────────────────────

// Zig returns one of two *different* struct types depending on `comptime store_keys: bool`.
// Rust cannot return different types from one generic; we expose both:
//   - `BSSMapInner<V, COUNT, RM_SLASH>` (the `store_keys = false` shape)
//   - `BSSMap<V, COUNT, EST_KEY_LEN, RM_SLASH>` (the `store_keys = true` wrapper)
// TODO(port): callers that passed `store_keys=false` should name `BSSMapInner` directly.

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
        // SAFETY: caller contract — `slot` is a valid, exclusive, aligned `*mut Self`.
        unsafe {
            addr_of_mut!((*slot).mutex).write(Mutex::new());
            addr_of_mut!((*slot).index).write(IndexMap::default());
            addr_of_mut!((*slot).backing_buf_used).write(0);
            // SAFETY: `OverflowList` is all-zeros-valid (see BSSStringList::init_at note).
            core::ptr::write_bytes(addr_of_mut!((*slot).overflow_list), 0u8, 1);
        }
    }

    /// Heap-allocate and initialize a fresh instance. Once-guard is the caller's
    /// responsibility — use `bss_map_inner!` for the canonical singleton.
    pub fn init() -> &'static mut Self {
        // SAFETY: FFI — mi_malloc_aligned returns null on OOM or a writable, suitably-aligned region.
        let ptr = unsafe { mimalloc::mi_malloc_aligned(size_of::<Self>(), core::mem::align_of::<Self>()) }.cast::<Self>();
        assert!(!ptr.is_null(), "OOM");
        // SAFETY: ptr is a fresh, exclusively-owned, properly-aligned allocation; lives for
        // process lifetime (singleton; never freed, matching Zig).
        unsafe { Self::init_at(ptr); &mut *ptr }
    }

    // Zig `deinit`: `self.index.deinit(allocator)` then free instance.
    // With `IndexMap = HashMap`, Drop frees it; singleton Box drop frees instance.

    pub fn is_overflowing(instance: &Self) -> bool {
        instance.backing_buf_used as usize >= COUNT
    }

    pub fn get_or_put(
        &mut self,
        denormalized_key: &[u8],
    ) -> core::result::Result<Result, AllocError> {
        let key = if REMOVE_TRAILING_SLASHES {
            trim_right(denormalized_key, SEP_STR)
        } else {
            denormalized_key
        };
        let _key = bun_wyhash::hash(key);

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
        let key = if REMOVE_TRAILING_SLASHES {
            trim_right(denormalized_key, SEP_STR)
        } else {
            denormalized_key
        };
        let _key = bun_wyhash::hash(key);
        // Hold the lock across `at_index` (Zig: `defer self.mutex.unlock()` at fn scope) —
        // a concurrent `put()` could otherwise mutate `overflow_list`/`backing_buf` while
        // we dereference `index`. `MutexGuard` holds a raw pointer (see [`Mutex`] docs),
        // so it does not conflict with the `&mut self` borrow in `at_index`.
        let _guard = self.mutex.lock();
        let index = match self.index.get(&_key).copied() {
            Some(i) => i,
            None => return None,
        };
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
        let key = if REMOVE_TRAILING_SLASHES {
            trim_right(denormalized_key, SEP_STR)
        } else {
            denormalized_key
        };
        let _key = bun_wyhash::hash(key);
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
    pub map: Box<BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES>>,
    // TODO(port): len = COUNT * ESTIMATED_KEY_LENGTH (generic_const_exprs).
    pub key_list_buffer: Box<[u8]>,
    pub key_list_buffer_used: usize,
    // TODO(port): len = COUNT (generic_const_exprs); element type is `&'static mut [u8]`-ish.
    pub key_list_slices: Box<[&'static [u8]]>,
    // TODO(port): Zig declares this as `OverflowList([]u8, count / 4)` but then calls
    // `.items[...]` and `.append(allocator, slice)` on it — those are `std.ArrayListUnmanaged`
    // methods, NOT `OverflowList` methods. Likely dead code or a latent bug upstream.
    // Port as `Vec<&'static [u8]>` to match the *called* API; revisit in Phase B.
    pub key_list_overflow: Vec<&'static [u8]>,
}

impl<ValueType, const COUNT: usize, const ESTIMATED_KEY_LENGTH: usize, const REMOVE_TRAILING_SLASHES: bool>
    BSSMap<ValueType, COUNT, ESTIMATED_KEY_LENGTH, REMOVE_TRAILING_SLASHES>
{
    /// In-place field initialization into uninitialized storage.
    ///
    /// SAFETY: `slot` must point to writable, properly-aligned, uninitialized
    /// storage of `size_of::<Self>()` bytes that lives for `'static`.
    pub unsafe fn init_at(slot: *mut Self) {
        // SAFETY: caller contract — `slot` is a valid, exclusive, aligned `*mut Self`.
        unsafe {
            // Inner map: heap via Box<MaybeUninit> + init_at (backing_buf left uninit).
            let mut inner: Box<MaybeUninit<BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES>>> =
                Box::new_uninit();
            BSSMapInner::init_at(inner.as_mut_ptr());
            addr_of_mut!((*slot).map).write(inner.assume_init());
            addr_of_mut!((*slot).key_list_buffer)
                .write(vec![0u8; COUNT * ESTIMATED_KEY_LENGTH].into_boxed_slice());
            addr_of_mut!((*slot).key_list_buffer_used).write(0);
            addr_of_mut!((*slot).key_list_slices).write(vec![&[][..]; COUNT].into_boxed_slice());
            addr_of_mut!((*slot).key_list_overflow).write(Vec::new());
        }
    }

    /// Heap-allocate and initialize a fresh instance. Once-guard is the caller's
    /// responsibility — use `bss_map!` for the canonical singleton.
    pub fn init() -> &'static mut Self {
        // SAFETY: FFI — mi_malloc_aligned returns null on OOM or a writable, suitably-aligned region.
        let ptr = unsafe { mimalloc::mi_malloc_aligned(size_of::<Self>(), core::mem::align_of::<Self>()) }.cast::<Self>();
        assert!(!ptr.is_null(), "OOM");
        // SAFETY: ptr is a fresh, exclusively-owned, properly-aligned allocation; lives for
        // process lifetime (singleton; never freed, matching Zig).
        unsafe { Self::init_at(ptr); &mut *ptr }
    }

    // Zig `deinit`: `self.map.deinit()` then free instance — both handled by Drop.

    pub fn is_overflowing(instance: &Self) -> bool {
        instance.map.backing_buf_used as usize >= COUNT
    }

    pub fn get_or_put(&mut self, key: &[u8]) -> core::result::Result<Result, AllocError> {
        self.map.get_or_put(key)
    }

    pub fn get(&mut self, key: &[u8]) -> Option<&mut ValueType> {
        // PERF(port): Zig uses @call(bun.callmod_inline, ...) — profile in Phase B
        self.map.get(key)
    }

    pub fn at_index(&mut self, index: IndexType) -> Option<&mut ValueType> {
        // PERF(port): Zig uses @call(bun.callmod_inline, ...) — profile in Phase B
        self.map.at_index(index)
    }

    pub fn key_at_index(&self, index: IndexType) -> Option<&[u8]> {
        match index.index() {
            i if i == UNASSIGNED.index() || i == NOT_FOUND.index() => None,
            _ => {
                if !index.is_overflow() {
                    Some(self.key_list_slices[index.index() as usize])
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
        let ptr: *mut ValueType = self.map.put(result, value)?;
        if STORE_KEY {
            self.put_key(key, result)?;
        }
        // SAFETY: ptr points into self.map.backing_buf / overflow_list, which are owned by
        // `self` and not reallocated by put_key (put_key only touches key_list_* fields).
        // We still hold the unique &mut self borrow, so no other alias exists.
        Ok(unsafe { &mut *ptr })
    }

    pub fn is_key_statically_allocated(&self, key: &[u8]) -> bool {
        is_slice_in_buffer(key, &self.key_list_buffer)
    }

    // There's two parts to this.
    // 1. Storing the underlying string.
    // 2. Making the key accessible at the index.
    pub fn put_key(&mut self, key: &[u8], result: &mut Result) -> core::result::Result<(), AllocError> {
        let _guard = self.map.mutex.lock();

        let slice: &'static [u8];

        // Is this actually a slice into the map? Don't free it.
        if self.is_key_statically_allocated(key) {
            // SAFETY: key points into self.key_list_buffer which lives for the singleton's life.
            slice = unsafe { core::slice::from_raw_parts(key.as_ptr(), key.len()) };
        } else if self.key_list_buffer_used + key.len() < self.key_list_buffer.len() {
            let start = self.key_list_buffer_used;
            self.key_list_buffer_used += key.len();
            let dst = &mut self.key_list_buffer[start..self.key_list_buffer_used];
            dst.copy_from_slice(key);
            // SAFETY: points into self.key_list_buffer (singleton-static lifetime).
            slice = unsafe { core::slice::from_raw_parts(dst.as_ptr(), dst.len()) };
        } else {
            // Zig: `slice = try self.map.allocator.dupe(u8, key);` — propagate OOM. Route
            // through mimalloc directly (PORTING.md forbids `Box::leak`) so the
            // size-agnostic `mi_free` below stays valid even after `trim_right` shortens
            // the stored slice.
            // SAFETY: FFI — mi_malloc returns null on OOM or a writable region of ≥key.len() bytes.
            let ptr = unsafe { mimalloc::mi_malloc(key.len().max(1)) }.cast::<u8>();
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
            self.key_list_slices[result.index.index() as usize] = slice;
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
                    unsafe { mimalloc::mi_free(existing_slice.as_ptr() as *mut core::ffi::c_void) };
                }
                self.key_list_overflow[idx] = slice;
            } else {
                self.key_list_overflow.push(slice);
            }
        }

        Ok(())
    }

    pub fn mark_not_found(&mut self, result: Result) {
        self.map.mark_not_found(result);
    }

    /// This does not free the keys.
    /// Returns `true` if an entry had previously existed.
    pub fn remove(&mut self, key: &[u8]) -> bool {
        self.map.remove(key)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Allocator-trait surface — OBSOLETE per PORTING.md §Allocators
// ──────────────────────────────────────────────────────────────────────────
//
// Zig's `std.mem.Allocator` / `GenericAllocator` interface threaded an allocator
// param through every fn because Zig has no global allocator. Rust does
// (`#[global_allocator] = Mimalloc` above), so per PORTING.md:
//
//   - Non-AST crates: DELETE the `allocator` param. `Box`/`Vec`/`String` use
//     global mimalloc.
//   - AST crates: thread `&'bump bumpalo::Bump` (= `Arena`) directly.
//
// The trait below is kept ONLY as an empty marker so downstream gated drafts
// that say `&dyn bun_alloc::Allocator` still parse. Do not implement it; do not
// add methods. Callers should be rewritten to drop the param entirely.

/// Marker trait standing in for Zig `std.mem.Allocator`. See module note.
///
/// Provides a `type_id()` hook so `is_instance`-style checks (Zig:
/// `allocator.vtable == &vtable`) can be expressed as concrete-type identity
/// on the trait object — every implementor gets a default `type_id()` that
/// returns its monomorphized `TypeId`.
pub trait Allocator: 'static {
    #[inline]
    fn type_id(&self) -> core::any::TypeId {
        core::any::TypeId::of::<Self>()
    }
}

/// Checks whether `allocator` is the default allocator.
///
/// Zig: `return allocator.vtable == c_allocator.vtable;` — compare identity
/// against the global mimalloc-backed allocator. With `#[global_allocator] =
/// Mimalloc`, the Rust default is `DefaultAlloc`; vtable-identity becomes a
/// `TypeId` comparison.
#[inline]
pub fn is_default(allocator: &dyn Allocator) -> bool {
    Allocator::type_id(allocator) == core::any::TypeId::of::<DefaultAlloc>()
}

/// Legacy ZST naming `bun.default_allocator`. With `#[global_allocator]` set,
/// this is just a unit marker.
#[derive(Clone, Copy, Default)]
pub struct DefaultAlloc;
impl Allocator for DefaultAlloc {}

static DEFAULT_ALLOC: DefaultAlloc = DefaultAlloc;

/// Zig: `bun.default_allocator` — global mimalloc-backed allocator. With
/// `#[global_allocator] = Mimalloc`, this is a marker handle; callers that
/// thread it should be rewritten to use `Box`/`Vec` directly. Kept so ported
/// call sites that still pass an `&dyn Allocator` resolve.
#[inline]
pub fn default_allocator() -> &'static dyn Allocator {
    &DEFAULT_ALLOC
}

// `GenericAllocator` / `Borrowed<A>` / `Nullable<A>` are dropped — they modelled
// Zig's allocator-borrowing discipline (avoid double-deinit), which Rust's
// ownership already enforces. Drafts that referenced them are gated under
// `` and will be rewritten to drop the param when un-gated.

// ──────────────────────────────────────────────────────────────────────────
// `basic` module selection
// ──────────────────────────────────────────────────────────────────────────

// `basic.zig` ported as `impl GlobalAlloc for Mimalloc` above (the real impl).
// Draft kept for diff-pass only.
 #[path = "basic.rs"] pub mod basic;
// Full `heap_breakdown` port is macOS-only (every fn is a `malloc_zone_*`
// libSystem call); the cross-platform surface is the inline `heap_breakdown`
// module above. Legitimate platform gate — NOT `cfg(any())`.
#[cfg(target_os = "macos")]
 #[path = "heap_breakdown.rs"] mod heap_breakdown_full;
pub mod memory;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/bun_alloc.zig (937 lines)
//   confidence: low
//   todos:      32
//   notes:      per-monomorphization statics solved via declare-site `bss_*!` macros (SyncUnsafeCell<MaybeUninit> + Once + init_at); BSSMap key_list_overflow calls non-existent OverflowList API in upstream Zig (likely dead code); parking_lot::Mutex needs RAII guard; BSSList.head dual-semantics (sibling-ref vs heap) needs enum split.
// ──────────────────────────────────────────────────────────────────────────
