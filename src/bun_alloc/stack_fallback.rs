//! `StackFallback<N, A>` — port of Zig `std.heap.StackFallbackAllocator(N)`
//! (vendor/zig/lib/std/heap.zig:376-481), inlining `FixedBufferAllocator`
//! (vendor/zig/lib/std/heap/FixedBufferAllocator.zig). The `&mut [u8]` self-ref
//! Zig keeps in `fixed_buffer_allocator.buffer` is replaced by computing
//! `buf.get().cast::<u8>()` on demand, so the Rust struct is **not**
//! self-referential and may be moved freely until the first `allocate`.
//!
//! ### Relationship to `AstAlloc`
//! `StackFallback` is a **standalone** [`Allocator`]; it is **not** composed
//! under [`crate::ast_alloc::AstAlloc`] / `AST_HEAP`. In Zig, `stackFallback`
//! and `ASTMemoryAllocator` are orthogonal — none of the 20 `stackFallback`
//! callsites route AST-node allocation through it (the two `js_parser` uses
//! pass `bun.default_allocator` as fallback, not the AST arena). A bump
//! front-end on `AST_HEAP` was previously shipped and reverted (#53599 UAF;
//! see the `PERF NOTE` on [`crate::ast_alloc::set_thread_heap`]). Under this
//! standalone design `AstVec<T>` stays 24 B; only vecs that explicitly want
//! stack-first storage become `Vec<T, &StackFallback<N, A>>` (32 B).
//!
//! ### Callsite shape
//! ```ignore
//! // Zig:  var sf = std.heap.stackFallback(4096, bun.default_allocator);
//! //       var list = std.ArrayList(u8).initCapacity(sf.get(), 256);
//! let sf = StackFallback::<4096>::with_global();
//! let mut list: Vec<u8, _> = Vec::with_capacity_in(256, sf.get());
//! // `&sf` borrows ⇒ `sf` is pinned for `list`'s lifetime; `Vec` is 32 B.
//! ```

use core::alloc::{AllocError, Allocator, Layout};
use core::cell::{Cell, UnsafeCell};
use core::mem::MaybeUninit;
use core::ptr::{self, NonNull};

use crate::{MimallocArena, alloc_result, mimalloc};

/// `std.heap.StackFallbackAllocator(N)` — bump-allocate from an inline
/// `[u8; N]` stack buffer; spill to `fallback` when it doesn't fit.
/// `deallocate`/`grow` dispatch by address-range check ([`Self::owns`]).
///
/// Lives on the caller's stack frame; single-threaded by construction
/// (`Cell` ⇒ `!Sync`, so `&StackFallback: !Send` — a `Vec<_, &Self>` cannot
/// cross threads with a stack pointer inside it).
///
/// `N` guidance: default to **1024** for "format a small string / build a
/// short list" (modal Zig choice; well under the 8 KB Windows `__chkstk`
/// threshold). **4096** for path-ish buffers. Cap at **16 KB** — anything
/// larger should go straight to `MimallocArena`/`Global`.
#[repr(C)] // keep `buf` at a fixed offset; `align_of::<Self>() == align_of::<A>().max(word)`
pub struct StackFallback<const N: usize, A: Allocator = std::alloc::Global> {
    /// Bump cursor into `buf`. `Cell` so `Allocator::allocate(&self)` can advance it.
    cur: Cell<usize>,
    /// `get_called` debug guard (Zig heap.zig:398) — trips on second `get()`
    /// without an intervening `reset()`, catching the "two Vecs share one
    /// buffer" footgun.
    #[cfg(debug_assertions)]
    got: Cell<bool>,
    fallback: A,
    /// Inline buffer. `UnsafeCell` because `allocate(&self)` hands out `*mut u8`
    /// into it. `MaybeUninit` because contents are never read as `[u8; N]`.
    buf: UnsafeCell<[MaybeUninit<u8>; N]>,
}

/// Back-compat alias for the previous name; prefer [`StackFallback`].
pub type BumpWithFallback<const N: usize, A> = StackFallback<N, A>;

impl<const N: usize, A: Allocator> StackFallback<N, A> {
    /// Zig: `std.heap.stackFallback(N, fallback)`. `const` — `MaybeUninit<u8>:
    /// Copy`, so `[MaybeUninit::uninit(); N]` needs no inline-const;
    /// `Cell::new`/`UnsafeCell::new` are `const fn`.
    #[inline]
    pub const fn new(fallback: A) -> Self {
        Self {
            cur: Cell::new(0),
            #[cfg(debug_assertions)]
            got: Cell::new(false),
            fallback,
            buf: UnsafeCell::new([MaybeUninit::uninit(); N]),
        }
    }

    /// Zig: `StackFallbackAllocator.get()` — reset the bump region and return
    /// the allocator handle. Debug-asserts single call (heap.zig:404). In Rust
    /// the "handle" is just `&self` (blanket `impl Allocator for &Self` below),
    /// so callers may equivalently write `Vec::new_in(&sf)` directly and skip
    /// this.
    #[inline]
    pub fn get(&self) -> &Self {
        #[cfg(debug_assertions)]
        {
            assert!(!self.got.replace(true), "StackFallback::get called twice");
        }
        self.cur.set(0);
        self
    }

    /// Zig: `fixed_buffer_allocator.reset()` (FixedBufferAllocator.zig:145).
    /// `&mut self` proves no live borrows into `buf`.
    #[inline]
    pub fn reset(&mut self) {
        self.cur.set(0);
        #[cfg(debug_assertions)]
        self.got.set(false);
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

    #[inline(always)]
    fn buf_base(&self) -> *mut u8 {
        self.buf.get().cast::<u8>()
    }

    /// Zig: `FixedBufferAllocator.ownsPtr` (FixedBufferAllocator.zig:46).
    /// Integer-address compare (NOT `offset_from` — `p` may belong to
    /// `fallback`, a different allocation).
    #[inline]
    pub fn owns(&self, p: *const u8) -> bool {
        let base = self.buf_base().addr();
        let q = p.addr();
        q >= base && q < base.wrapping_add(N)
    }

    /// Zig: `FixedBufferAllocator.isLastAllocation` (FixedBufferAllocator.zig:58).
    #[inline(always)]
    fn is_last(&self, p: *const u8, len: usize) -> bool {
        p.addr().wrapping_add(len) == self.buf_base().addr().wrapping_add(self.cur.get())
    }

    /// Zig: `FixedBufferAllocator.alloc` (FixedBufferAllocator.zig:62) — align
    /// `cur` up, carve `len` bytes, or `None` if it doesn't fit.
    #[inline]
    fn bump(&self, layout: Layout) -> Option<NonNull<u8>> {
        let base = self.buf_base().addr();
        let align = layout.align();
        // Align against the *absolute* address: `buf` is only guaranteed
        // `align_of::<Self>()`-aligned, so an over-aligned `T` needs the
        // padding computed at runtime.
        let adjusted = base.wrapping_add(self.cur.get()).checked_add(align - 1)? & !(align - 1);
        let start = adjusted.wrapping_sub(base);
        let end = start.checked_add(layout.size())?;
        if end > N {
            return None;
        }
        self.cur.set(end);
        // SAFETY: `start <= end <= N` ⇒ in-bounds of `buf` (one-past-the-end
        // when `size == 0`, which `NonNull` still accepts and the caller
        // treats as a zero-length slice). `buf_base` is non-null (field of
        // `self`). `UnsafeCell` permits deriving a `*mut` from `&self`.
        Some(unsafe { NonNull::new_unchecked(self.buf_base().add(start)) })
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

impl<const N: usize> StackFallback<N, std::alloc::Global> {
    /// `std.heap.stackFallback(N, bun.default_allocator)` — the 90 % case
    /// (15 of 20 Zig callsites pass `default_allocator`/`bun.default_allocator`).
    #[inline]
    pub const fn with_global() -> Self {
        Self::new(std::alloc::Global)
    }
}

// Implemented on `&Self` (NOT `Self`) so the buffer cannot be moved into an
// owning container by value (`Box::new_in(x, sf)` would dangle). Mirrors
// `unsafe impl Allocator for &MimallocArena` (MimallocArena.rs:652) and Zig's
// `get()`-returns-borrowing-vtable shape.
//
// SAFETY:
// - `allocate`: returns either (a) a slice of `self.buf` aligned to
//   `layout.align()` with `layout.size()` bytes available (proved by `bump`'s
//   `end <= N` check), or (b) a block from `fallback.allocate(layout)`. Both
//   satisfy the `Layout` contract.
// - `deallocate`: for (a), rewinds `cur` only if last (matches FBA `free`;
//   non-last is a no-op leak bounded by `N` and reclaimed on drop). For (b),
//   forwards to `fallback.deallocate` with the same `layout` it was allocated
//   with.
// - "Any clone may free": `&T: Copy`; all clones are the same `&self`.
// - `grow`/`shrink`: see per-method notes; old block is always either left
//   valid (returned same ptr) or fully copied-then-deallocated before return.
// `StackFallback` is `!Sync` (via `Cell`/`UnsafeCell`), enforcing single-
// thread use of the cursor — same constraint as Zig's SFA.
unsafe impl<const N: usize, A: Allocator> Allocator for &StackFallback<N, A> {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        // Zig heap.zig:432 — try fixed buffer, else fallback.
        if let Some(p) = self.bump(layout) {
            return Ok(NonNull::slice_from_raw_parts(p, layout.size()));
        }
        self.fallback.allocate(layout)
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        if self.owns(ptr.as_ptr()) {
            // Zig FixedBufferAllocator.free:125 — rewind only the last alloc.
            if self.is_last(ptr.as_ptr(), layout.size()) {
                self.cur.set(self.cur.get() - layout.size());
            }
        } else {
            // SAFETY: `!owns` ⇒ `ptr` came from `fallback.allocate` (only other source).
            unsafe { self.fallback.deallocate(ptr, layout) }
        }
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        if self.owns(ptr.as_ptr()) {
            // Zig FixedBufferAllocator.resize:86-101 — last-alloc bump-in-place.
            if self.is_last(ptr.as_ptr(), old.size()) {
                let add = new.size() - old.size();
                if self.cur.get() + add <= N {
                    self.cur.set(self.cur.get() + add);
                    return Ok(NonNull::slice_from_raw_parts(ptr, new.size()));
                }
            }
            // Spill: alloc new (stack-or-fallback), memcpy, free old.
            // Mirrors Zig `Allocator.realloc` slow path after `remap` returns null.
            let newp = self.allocate(new)?;
            // SAFETY: `newp` is fresh ≥`new.size()` bytes; `old.size()` bytes at
            // `ptr` are init per `grow` contract; `old.size() <= new.size()`. If
            // `newp` came from `bump`, `is_last(ptr,..)` was false ⇒
            // `ptr+old.size() ≤ prev_cur < newp` ⇒ disjoint. If `newp` came from
            // `fallback`, disjoint by allocation.
            unsafe {
                ptr::copy_nonoverlapping(ptr.as_ptr(), newp.as_ptr().cast::<u8>(), old.size());
                self.deallocate(ptr, old);
            }
            Ok(newp)
        } else {
            // SAFETY: `!owns` ⇒ `ptr` is a `fallback` block.
            unsafe { self.fallback.grow(ptr, old, new) }
        }
    }

    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        if self.owns(ptr.as_ptr()) {
            // FixedBufferAllocator.resize:86-94 — last-alloc shrink rewinds
            // `cur`; non-last shrink keeps the slot (already holds ≥new bytes
            // at ≥old.align()).
            if self.is_last(ptr.as_ptr(), old.size()) {
                self.cur.set(self.cur.get() - (old.size() - new.size()));
            }
            Ok(NonNull::slice_from_raw_parts(ptr, new.size()))
        } else {
            // SAFETY: `!owns` ⇒ `ptr` is a `fallback` block.
            unsafe { self.fallback.shrink(ptr, old, new) }
        }
    }
}

// ── ArenaPtr ─────────────────────────────────────────────────────────────────
//
// `*const MimallocArena` as an [`Allocator`]. Exists so `StackFallback` can
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
    /// Shared borrow of the wrapped arena, or `None` for the global path.
    ///
    /// Single backref-deref site for the `arena: *const MimallocArena` field;
    /// the [`Allocator`] impl below branches on the result instead of
    /// open-coding the null-check + raw-pointer deref at every method.
    #[inline]
    fn arena_ref(&self) -> Option<&MimallocArena> {
        // SAFETY: `arena` is either null (→ `None`) or, per [`ArenaPtr::new`]'s
        // contract, a live `MimallocArena` that is not moved/reset/dropped
        // while any allocation made through this ref is live — i.e. it
        // outlives `&self`. Backref invariant: pointee outlives holder.
        unsafe { self.arena.as_ref() }
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
        match self.arena_ref() {
            Some(a) => a.allocate(layout),
            None => {
                let p = mimalloc::mi_malloc_auto_align(layout.size(), layout.align());
                alloc_result(p, layout.size())
            }
        }
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        // SAFETY: `ptr` was returned by this allocator's `allocate`/`grow`
        // (caller contract). Both arms forward it to the matching mimalloc
        // free path; `&MimallocArena::deallocate` is `mi_free` (heap-agnostic),
        // so the `Some` arm is correct even if `ptr` was allocated under a
        // different arena and later grown here.
        unsafe {
            match self.arena_ref() {
                Some(a) => a.deallocate(ptr, layout),
                None => mimalloc::mi_free(ptr.as_ptr().cast()),
            }
        }
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // SAFETY: `ptr` is a live mimalloc block returned by this allocator
        // (caller contract); both arms forward it to the matching realloc.
        unsafe {
            match self.arena_ref() {
                Some(a) => a.grow(ptr, old, new),
                None => alloc_result(
                    mimalloc::mi_realloc_aligned(ptr.as_ptr().cast(), new.size(), new.align()),
                    new.size(),
                ),
            }
        }
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
        Self {
            heap: ptr::null_mut(),
        }
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

// ported from: vendor/zig/lib/std/heap.zig (stackFallback / StackFallbackAllocator)
// ported from: vendor/zig/lib/std/heap/FixedBufferAllocator.zig (inlined)

#[cfg(test)]
mod tests {
    use super::*;
    use std::alloc::Global;

    /// Fallback that counts every call so tests can prove which path was taken.
    struct Counting {
        allocs: Cell<usize>,
        deallocs: Cell<usize>,
    }
    impl Counting {
        const fn new() -> Self {
            Self { allocs: Cell::new(0), deallocs: Cell::new(0) }
        }
    }
    // SAFETY: thin forwarder to `Global`.
    unsafe impl Allocator for Counting {
        fn allocate(&self, l: Layout) -> Result<NonNull<[u8]>, AllocError> {
            self.allocs.set(self.allocs.get() + 1);
            Global.allocate(l)
        }
        unsafe fn deallocate(&self, p: NonNull<u8>, l: Layout) {
            self.deallocs.set(self.deallocs.get() + 1);
            unsafe { Global.deallocate(p, l) }
        }
    }

    #[test]
    fn alloc_within_stack() {
        let sf = StackFallback::<64, _>::new(Counting::new());
        let a = &sf;
        let p = a.allocate(Layout::from_size_align(16, 1).unwrap()).unwrap();
        assert_eq!(p.len(), 16);
        assert!(sf.owns(p.cast::<u8>().as_ptr()));
        assert_eq!(sf.fallback().allocs.get(), 0);
        // second alloc still fits
        let q = a.allocate(Layout::from_size_align(32, 1).unwrap()).unwrap();
        assert!(sf.owns(q.cast::<u8>().as_ptr()));
        assert_eq!(sf.fallback().allocs.get(), 0);
    }

    #[test]
    fn overflow_to_fallback() {
        let sf = StackFallback::<32, _>::new(Counting::new());
        let a = &sf;
        // exhaust the inline buffer
        let _p = a.allocate(Layout::from_size_align(24, 1).unwrap()).unwrap();
        assert_eq!(sf.fallback().allocs.get(), 0);
        // 16 doesn't fit in remaining 8 → fallback
        let q = a.allocate(Layout::from_size_align(16, 1).unwrap()).unwrap();
        assert!(!sf.owns(q.cast::<u8>().as_ptr()));
        assert_eq!(sf.fallback().allocs.get(), 1);
        unsafe { a.deallocate(q.cast(), Layout::from_size_align(16, 1).unwrap()) };
        assert_eq!(sf.fallback().deallocs.get(), 1);
    }

    #[test]
    fn dealloc_range_check() {
        let sf = StackFallback::<64, _>::new(Counting::new());
        let a = &sf;
        let l8 = Layout::from_size_align(8, 1).unwrap();
        let p = a.allocate(l8).unwrap().cast::<u8>();
        let q = a.allocate(l8).unwrap().cast::<u8>();
        assert_eq!(sf.cur.get(), 16);
        // freeing `p` (non-last) is a no-op leak bounded by N
        unsafe { a.deallocate(p, l8) };
        assert_eq!(sf.cur.get(), 16);
        // freeing `q` (last) rewinds
        unsafe { a.deallocate(q, l8) };
        assert_eq!(sf.cur.get(), 8);
        // neither touched the fallback
        assert_eq!(sf.fallback().deallocs.get(), 0);
    }

    #[test]
    fn grow_in_place() {
        let sf = StackFallback::<64, _>::new(Counting::new());
        let a = &sf;
        let old = Layout::from_size_align(8, 1).unwrap();
        let new = Layout::from_size_align(24, 1).unwrap();
        let p = a.allocate(old).unwrap().cast::<u8>();
        let g = unsafe { a.grow(p, old, new) }.unwrap();
        // last alloc → grew in place: same address, cursor advanced
        assert_eq!(g.cast::<u8>().as_ptr(), p.as_ptr());
        assert_eq!(sf.cur.get(), 24);
        assert_eq!(sf.fallback().allocs.get(), 0);
    }

    #[test]
    fn grow_spills_to_fallback() {
        let sf = StackFallback::<32, _>::new(Counting::new());
        let a = &sf;
        let old = Layout::from_size_align(16, 1).unwrap();
        let new = Layout::from_size_align(48, 1).unwrap();
        let p = a.allocate(old).unwrap().cast::<u8>();
        // write a pattern so we can verify the prefix copy
        unsafe { ptr::write_bytes(p.as_ptr(), 0xAB, 16) };
        let g = unsafe { a.grow(p, old, new) }.unwrap();
        assert!(!sf.owns(g.cast::<u8>().as_ptr()));
        assert_eq!(sf.fallback().allocs.get(), 1);
        let bytes = unsafe { core::slice::from_raw_parts(g.cast::<u8>().as_ptr(), 16) };
        assert!(bytes.iter().all(|&b| b == 0xAB));
        unsafe { a.deallocate(g.cast(), new) };
    }

    #[test]
    fn alignment() {
        let sf = StackFallback::<128, _>::new(Counting::new());
        let a = &sf;
        // 1-byte alloc to misalign the cursor
        let _ = a.allocate(Layout::from_size_align(1, 1).unwrap()).unwrap();
        // 16-aligned request must round up
        let p = a
            .allocate(Layout::from_size_align(8, 16).unwrap())
            .unwrap()
            .cast::<u8>();
        assert_eq!(p.as_ptr().addr() % 16, 0);
        assert!(sf.owns(p.as_ptr()));
        // over-aligned request that can't fit the padding → fallback
        let q = a
            .allocate(Layout::from_size_align(8, 256).unwrap())
            .unwrap()
            .cast::<u8>();
        assert_eq!(q.as_ptr().addr() % 256, 0);
        assert!(!sf.owns(q.as_ptr()));
        unsafe { a.deallocate(q, Layout::from_size_align(8, 256).unwrap()) };
    }

    #[test]
    fn shrink_rewinds_last() {
        let sf = StackFallback::<64, _>::new(Counting::new());
        let a = &sf;
        let old = Layout::from_size_align(32, 1).unwrap();
        let new = Layout::from_size_align(8, 1).unwrap();
        let p = a.allocate(old).unwrap().cast::<u8>();
        assert_eq!(sf.cur.get(), 32);
        let s = unsafe { a.shrink(p, old, new) }.unwrap();
        assert_eq!(s.cast::<u8>().as_ptr(), p.as_ptr());
        assert_eq!(sf.cur.get(), 8);
    }

    #[test]
    fn vec_roundtrip() {
        let sf = StackFallback::<256>::with_global();
        let mut v: Vec<u32, _> = Vec::new_in(&sf);
        for i in 0..8 {
            v.push(i);
        }
        assert!(sf.owns(v.as_ptr().cast()));
        // force a grow that spills
        for i in 8..200 {
            v.push(i);
        }
        assert!(!sf.owns(v.as_ptr().cast()));
        assert_eq!(v.iter().copied().sum::<u32>(), (0..200).sum());
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic(expected = "StackFallback::get called twice")]
    fn get_twice_panics() {
        let sf = StackFallback::<16>::with_global();
        let _ = sf.get();
        let _ = sf.get();
    }

    #[test]
    fn reset_clears_guard() {
        let mut sf = StackFallback::<16>::with_global();
        {
            let a = sf.get();
            let _ = a.allocate(Layout::from_size_align(8, 1).unwrap()).unwrap();
        }
        sf.reset();
        let _ = sf.get(); // does not panic
        assert_eq!(sf.cur.get(), 0);
    }
}
