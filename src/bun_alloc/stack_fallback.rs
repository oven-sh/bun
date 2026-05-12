//! `BumpWithFallback<N, A>` — port of Zig `std.heap.StackFallbackAllocator(N)`.
//!
//! An inline `[u8; N]` bump buffer with a fallback [`Allocator`]. Allocations
//! that fit in the remaining inline buffer are served by a pointer bump (no
//! FFI call); on overflow they forward to `A`. [`BumpWithFallback::reset`]
//! zeroes the cursor — equivalent to Zig overwriting the whole SFA on every
//! `ASTMemoryAllocator::enter()`.
//!
//! Intended consumer: `ASTMemoryAllocator::append`. The 8 KiB front absorbs
//! the first few hundred AST-node allocations of each parse without touching
//! `mi_heap_malloc`, which on every call rewrites mimalloc's thread-local
//! `theap` (see `vendor/mimalloc/src/alloc.c:212`) and so thrashes the
//! page-free-list cache when the parser interleaves arena and global allocs.
//! Once the inline buffer fills the cost is identical to allocating directly
//! on `A`.
//!
//! `deallocate` of an inline pointer is a no-op (bump semantics); `grow` of an
//! inline pointer copies the prefix into a fresh `A` allocation. This makes
//! `BumpWithFallback` safe to back a `Vec`, though the AST `append` path never
//! grows.

use core::alloc::{AllocError, Allocator, Layout};
use core::cell::{Cell, UnsafeCell};
use core::mem::MaybeUninit;
use core::ptr::{self, NonNull};

use crate::{mimalloc, MimallocArena};

/// Inline bump buffer + fallback allocator. See module doc.
///
/// `N` is the inline buffer size in bytes (Zig: `@min(8192,
/// std.heap.page_size_min)`). The buffer is stored by value, so this struct
/// is `N + size_of::<A>() + word` bytes — keep it behind a `Box`/arena slot
/// or as a stack local that is **not moved after the first allocate**:
/// inline-buffer pointers are interior pointers into `self.buf`.
#[repr(C)]
pub struct BumpWithFallback<const N: usize, A: Allocator> {
    /// Next free byte index into `buf`. `Cell` because `Allocator::allocate`
    /// takes `&self`. Rewound by [`Self::reset`].
    cursor: Cell<usize>,
    /// Overflow allocator. Owned by value so a borrowed-heap fallback
    /// ([`MimallocHeapRef`]) costs one pointer.
    fallback: A,
    /// Inline storage. `UnsafeCell` so `&self.allocate` may hand out interior
    /// `*mut u8` without violating the shared borrow.
    buf: UnsafeCell<[MaybeUninit<u8>; N]>,
}

impl<const N: usize, A: Allocator> BumpWithFallback<N, A> {
    /// Construct with `fallback` as the overflow allocator. The inline buffer
    /// starts empty (cursor = 0).
    #[inline]
    pub const fn new(fallback: A) -> Self {
        Self {
            cursor: Cell::new(0),
            fallback,
            // SAFETY-adjacent: `MaybeUninit::<u8>::uninit()` is `Copy`, so the
            // array-repeat is const-evaluable.
            buf: UnsafeCell::new([MaybeUninit::uninit(); N]),
        }
    }

    /// Rewind the inline-buffer cursor. Any inline pointers handed out since
    /// the last `reset()` are invalidated. Does **not** touch `fallback` — Zig
    /// SFA `reset()` only rewinds the fixed buffer; the backing arena is reset
    /// by its owner (e.g. `ModuleLoader::reset_arena`).
    #[inline]
    pub fn reset(&self) {
        self.cursor.set(0);
    }

    /// Borrow the fallback allocator.
    #[inline]
    pub fn fallback(&self) -> &A {
        &self.fallback
    }

    /// Mutably borrow the fallback allocator (e.g. to rebind a heap pointer
    /// after the backing `MimallocArena::reset` swapped it).
    #[inline]
    pub fn fallback_mut(&mut self) -> &mut A {
        &mut self.fallback
    }

    /// Does `p` lie inside the inline buffer? Routes `deallocate`/`grow`.
    #[inline]
    fn owns_inline(&self, p: *const u8) -> bool {
        let base = self.buf.get().cast::<u8>();
        // Wrapping sub so an arbitrary heap pointer (which may be below
        // `base`) doesn't UB on the subtraction; the `< N` check rejects it.
        (p as usize).wrapping_sub(base as usize) < N
    }

    /// Bump-allocate `layout` from the inline buffer. `None` on overflow
    /// (caller forwards to `fallback`).
    #[inline]
    fn try_bump(&self, layout: Layout) -> Option<NonNull<u8>> {
        let base = self.buf.get().cast::<u8>();
        let cur = self.cursor.get();
        // Align against the *absolute* address: `buf` is only guaranteed
        // `align_of::<Self>()`-aligned, so an over-aligned `T` needs the
        // padding computed at runtime.
        let addr = (base as usize).wrapping_add(cur);
        let aligned = addr.checked_add(layout.align() - 1)? & !(layout.align() - 1);
        let start = aligned.wrapping_sub(base as usize);
        let end = start.checked_add(layout.size())?;
        if end > N {
            return None;
        }
        self.cursor.set(end);
        // SAFETY: `start <= end <= N`, so `base.add(start)` is within `buf`'s
        // allocation (one-past-the-end when `size == 0`, which `NonNull::new`
        // still accepts and the caller treats as a zero-length slice).
        // `UnsafeCell` permits deriving a `*mut` from `&self`.
        NonNull::new(unsafe { base.add(start) })
    }

    /// `bumpalo::Bump::alloc` parity — move `val` into the bump front (or the
    /// fallback on overflow). Aborts on OOM, matching Zig's `catch unreachable`.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn alloc<T>(&self, val: T) -> &mut T {
        let p = (&self)
            .allocate(Layout::new::<T>())
            .unwrap_or_else(|_| crate::out_of_memory())
            .cast::<T>();
        // SAFETY: `p` is non-null, aligned for `T`, and points to ≥`size_of<T>`
        // uninitialized bytes owned either by `self.buf` or by `fallback`.
        unsafe {
            p.as_ptr().write(val);
            &mut *p.as_ptr()
        }
    }
}

// SAFETY:
// - `allocate` returns either an inline pointer (within `buf`, aligned per
//   `try_bump`, ≥`layout.size()` bytes) or whatever `A::allocate` returns.
// - `deallocate` of an inline pointer is a no-op (reclaimed by `reset()`/
//   drop); fallback pointers forward to `A::deallocate`. The trait permits
//   no-op deallocation.
// - `grow` of an inline pointer allocates fresh on `A` and copies the
//   `old.size()` prefix, satisfying prefix-preservation; the inline slot is
//   leaked into `buf` until `reset()`. Fallback pointers forward to `A::grow`.
// - `shrink` of an inline pointer returns the same address with the smaller
//   length (bump cannot give bytes back); fallback pointers forward to `A`.
// - Cloned `&BumpWithFallback` handles refer to the same `self`, so the "any
//   clone may free" rule holds.
// `BumpWithFallback` is `!Sync` (via `Cell`/`UnsafeCell`), enforcing single-
// thread use of the cursor — same constraint as Zig's SFA.
unsafe impl<const N: usize, A: Allocator> Allocator for &BumpWithFallback<N, A> {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        if let Some(p) = self.try_bump(layout) {
            return Ok(NonNull::slice_from_raw_parts(p, layout.size()));
        }
        self.fallback.allocate(layout)
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        if self.owns_inline(ptr.as_ptr()) {
            // Bump buffer — reclaimed on `reset()`.
            return;
        }
        // SAFETY: not inline → was returned by `fallback.allocate`/`grow`.
        unsafe { self.fallback.deallocate(ptr, layout) }
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        if self.owns_inline(ptr.as_ptr()) {
            // Copy out of the inline buffer into the fallback; the inline slot
            // leaks until `reset()` (Zig SFA does the same).
            let dst = self.fallback.allocate(new)?;
            // SAFETY: `ptr` is valid for `old.size()` bytes (caller contract);
            // `dst` is fresh, ≥`new.size()` ≥ `old.size()`; ranges cannot
            // overlap (inline buffer vs. fallback heap).
            unsafe {
                ptr::copy_nonoverlapping(ptr.as_ptr(), dst.cast::<u8>().as_ptr(), old.size());
            }
            return Ok(dst);
        }
        // SAFETY: not inline → was returned by `fallback`.
        unsafe { self.fallback.grow(ptr, old, new) }
    }

    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        if self.owns_inline(ptr.as_ptr()) {
            // In-place: same address, smaller logical size.
            return Ok(NonNull::slice_from_raw_parts(ptr, new.size()));
        }
        // SAFETY: not inline → was returned by `fallback`.
        unsafe { self.fallback.shrink(ptr, old, new) }
    }
}

// ── ArenaPtr ─────────────────────────────────────────────────────────────────
//
// `*const MimallocArena` as an [`Allocator`]. Exists so `BumpWithFallback` can
// borrow a caller-owned `MimallocArena` without a lifetime parameter:
// `ASTMemoryAllocator` is published into raw thread-locals and may outlive any
// nameable `'a`, so `&'a MimallocArena` (which already implements `Allocator`)
// cannot be used directly. The caller guarantees the pointee outlives every
// allocation — same invariant `ast_alloc::set_thread_arena` already requires.
//
// `arena == null` routes to global `mi_malloc`/`mi_free`, matching
// [`crate::ast_alloc::AstAlloc`] when no AST scope is active.

/// Borrowed `*const MimallocArena` as an [`Allocator`]. See section doc above.
#[derive(Clone, Copy)]
pub struct ArenaPtr {
    arena: *const MimallocArena,
}

impl ArenaPtr {
    /// Wrap a live `MimallocArena`. The caller guarantees `arena` is not moved,
    /// `reset()`, or dropped while any allocation made through this ref is
    /// live.
    #[inline]
    pub const fn new(arena: *const MimallocArena) -> Self {
        Self { arena }
    }
    /// Null arena → process-global `mi_malloc`/`mi_free`.
    #[inline]
    pub const fn global() -> Self {
        Self { arena: ptr::null() }
    }
    /// The wrapped arena pointer (null when global).
    #[inline]
    pub fn arena(&self) -> *const MimallocArena {
        self.arena
    }
    /// Rebind (e.g. to attach a borrowed arena to a previously-global ref).
    #[inline]
    pub fn set_arena(&mut self, arena: *const MimallocArena) {
        self.arena = arena;
    }
}

// SAFETY: when `arena` is non-null this forwards to `&MimallocArena: Allocator`
// (whose contract is documented on that impl); when null it is the global
// mimalloc path (`mi_malloc`/`mi_free`/`mi_realloc_aligned`), identical to
// `BunAllocator` / `AstAlloc`'s null branch. The caller upholds the
// non-dangling invariant on `arena` (see [`ArenaPtr::new`]).
unsafe impl Allocator for ArenaPtr {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        if self.arena.is_null() {
            let p = mimalloc::mi_malloc_auto_align(layout.size(), layout.align());
            return alloc_result(p, layout.size());
        }
        // SAFETY: non-null + caller contract → live `MimallocArena`.
        unsafe { &*self.arena }.allocate(layout)
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        if self.arena.is_null() {
            // SAFETY: `ptr` came from `mi_malloc*` per the null `allocate` arm.
            unsafe { mimalloc::mi_free(ptr.as_ptr().cast()) };
            return;
        }
        // SAFETY: non-null + caller contract; `&MimallocArena::deallocate` is
        // `mi_free` (heap-agnostic), so this is correct even if `ptr` was
        // allocated under a different arena and later grown here.
        unsafe { (&*self.arena).deallocate(ptr, layout) }
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        if self.arena.is_null() {
            // SAFETY: `ptr` is a live mimalloc block per caller contract.
            let p = unsafe {
                mimalloc::mi_realloc_aligned(ptr.as_ptr().cast(), new.size(), new.align())
            };
            return alloc_result(p, new.size());
        }
        // SAFETY: non-null + caller contract.
        unsafe { (&*self.arena).grow(ptr, old, new) }
    }

    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // SAFETY: same paths as `grow`.
        unsafe { self.grow(ptr, old, new) }
    }
}

// ── MimallocHeapRef ──────────────────────────────────────────────────────────
//
// Thin `Allocator` over a raw `*mut mi_heap_t`. Unlike [`ArenaPtr`] this
// addresses the C-heap-resident `mi_heap_t` directly (stable across moves of
// the `MimallocArena` wrapper struct), at the cost of bypassing
// `MimallocArena::track_alloc`. Kept for callers that only have a heap handle.
//
// `heap == null` routes to global `mi_malloc`/`mi_free`, matching
// [`crate::ast_alloc::AstAlloc`] when no AST scope is active.

/// Borrowed `mi_heap_t*` as an [`Allocator`]. See section doc above.
#[derive(Clone, Copy)]
pub struct MimallocHeapRef {
    heap: *mut mimalloc::Heap,
}

impl MimallocHeapRef {
    /// Wrap a live `mi_heap_t*`. The caller guarantees `heap` outlives every
    /// allocation made through this ref (i.e. the owning `MimallocArena` is not
    /// `reset()`/dropped while this ref is in use).
    #[inline]
    pub const fn new(heap: *mut mimalloc::Heap) -> Self {
        Self { heap }
    }
    /// Null heap → process-global `mi_malloc`/`mi_free`.
    #[inline]
    pub const fn global() -> Self {
        Self { heap: ptr::null_mut() }
    }
    /// The wrapped heap pointer (null when global).
    #[inline]
    pub fn heap(&self) -> *mut mimalloc::Heap {
        self.heap
    }
    /// Rebind to a new heap (e.g. after `MimallocArena::reset` rebuilt it).
    #[inline]
    pub fn set_heap(&mut self, heap: *mut mimalloc::Heap) {
        self.heap = heap;
    }
}

use crate::alloc_result;

// SAFETY: identical contract to `&MimallocArena` / `AstAlloc` —
// `mi_[heap_]malloc[_aligned]` yields ≥`size` bytes aligned to `align`;
// `mi_free` accepts any mimalloc-owned pointer regardless of origin heap;
// `mi_[heap_]realloc_aligned` preserves the `min(old,new)` prefix and frees
// the old block. `heap` must be null or a live `mi_heap_t*` for this ref's
// lifetime (caller contract — see [`MimallocHeapRef::new`]).
unsafe impl Allocator for MimallocHeapRef {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        let h = self.heap;
        let p = if h.is_null() {
            mimalloc::mi_malloc_auto_align(layout.size(), layout.align())
        } else {
            // SAFETY: `h` is live per the caller contract on `new`.
            unsafe { mimalloc::mi_heap_malloc_auto_align(h, layout.size(), layout.align()) }
        };
        alloc_result(p, layout.size())
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, _layout: Layout) {
        // SAFETY: `ptr` came from `mi_[heap_]malloc*` per `allocate`/`grow`;
        // `mi_free` is heap-agnostic and thread-safe.
        unsafe { mimalloc::mi_free(ptr.as_ptr().cast()) }
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        _old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        let h = self.heap;
        // SAFETY: see `allocate`; realloc accepts cross-heap pointers.
        let p = unsafe {
            if h.is_null() {
                mimalloc::mi_realloc_aligned(ptr.as_ptr().cast(), new.size(), new.align())
            } else {
                mimalloc::mi_heap_realloc_aligned(h, ptr.as_ptr().cast(), new.size(), new.align())
            }
        };
        alloc_result(p, new.size())
    }

    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // SAFETY: same realloc path as `grow`.
        unsafe { self.grow(ptr, old, new) }
    }
}

// ported from: vendor/zig/lib/std/heap/stack_fallback_allocator.zig (concept)
