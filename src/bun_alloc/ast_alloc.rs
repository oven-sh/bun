//! Thread-local arena allocator for AST-interior `Vec`s.
//!
//! Strategy B for the require-cache ESM leak (docs/BABYLIST_REPLACEMENT.md):
//! `G::DeclList` / `G::PropertyList` / `ExprNodeList` / `ClassStaticBlock::stmts`
//! were ported from Zig `BabyList<T>` to global-heap `Vec<T>`. The AST *nodes*
//! that embed those `Vec` headers live in `ASTMemoryAllocator`'s `MimallocArena`
//! and are bulk-freed (no `Drop`) on `enter()` → `arena.reset()`, so the global
//! buffers leak — one full AST's worth of `Vec` backing storage per imported
//! module in `RuntimeTranspilerStore`.
//!
//! `AstAlloc` is a ZST `core::alloc::Allocator` that routes `allocate`/`grow`
//! to the *same* `mi_heap_t` the AST nodes live in (read from a thread-local
//! set by `ASTMemoryAllocator::push`/`Scope::enter`), and makes `deallocate` a
//! **no-op**. The buffer is reclaimed by `mi_heap_destroy` on the next
//! `arena.reset()`, alongside the node that owns it. When no thread-local heap
//! is set the allocator falls back to global mimalloc (`mi_malloc`), matching
//! the pre-Strategy-B behaviour for the bundler / `Stmt.Data.Store` block-store
//! path.
//!
//! `deallocate` being a no-op preserves the `Expr::Data::clone_in` invariant
//! (`src/js_parser/ast/Expr.rs:2178`): payloads are `core::ptr::read`-copied
//! under the assumption "no `Drop`, no owned heap state". Two `Vec<_, AstAlloc>`
//! headers may therefore alias the same buffer — neither ever has `Drop` run
//! (both live in arena slots), but if one *did*, the no-op `deallocate` keeps
//! the bitwise copy sound.
//!
//! Placed in `bun_alloc` (not `js_parser`) so that `bun_ast::
//! ExprNodeList` and `bun_collections::VecExt` — both below `js_parser` in the
//! crate graph — can name `Vec<T, AstAlloc>`.

use core::alloc::{AllocError, Allocator, Layout};
use core::cell::Cell;
use core::ptr::NonNull;

use crate::mimalloc;

/// Raw `mi_heap_t*` of the active `ASTMemoryAllocator`'s `MimallocArena`,
/// or null when no AST scope is entered. Set/cleared by
/// `bun_ast::ASTMemoryAllocator::{push,pop}` and
/// `ASTMemoryAllocator::Scope::{enter,exit}` (alongside the existing
/// `Stmt/Expr.Data.Store.MEMORY_ALLOCATOR` and
/// `bun_ast::data_store_override` thread-locals).
///
/// `#[thread_local]` (not `thread_local!`) so this is a bare `__thread` slot
/// like Zig's `threadlocal var`: every `AstAlloc` allocation reads this, and
/// the macro form's `LocalKey::__getit` wrapper showed up under
/// `pthread_getspecific` in next-lint profiles. `Cell<*mut _>` has no
/// destructor and a const initializer, so no dtor registration is needed.
#[thread_local]
static AST_HEAP: Cell<*mut mimalloc::Heap> = Cell::new(core::ptr::null_mut());

/// Install `heap` as the thread's AST heap. Pass `null` to clear.
/// Intended caller: `ASTMemoryAllocator` (push/pop/Scope) only.
//
// PERF NOTE: a previous iteration cached the resolved `mi_theap_t*` and
// layered a bump-chunk allocator here to skip mimalloc's per-call
// `heap → theap` TLS lookup. Reverted: `mi_theap_t*` is per-OS-thread while
// `mi_heap_t*` is `Send`, so caching the former on a struct that may move
// threads is a corruption footgun (and the bump layer caused #53599's UAF
// when mimalloc recycled a destroyed `mi_heap_t*` slot). Zig does not use
// `mi_theap_*` either. If `_mi_heap_theap` thrash resurfaces in profiles, the
// intended fix is `mi_heap_set_default(heap)` for the parse scope (mimalloc's
// supported API for "make this heap the cached one"), not manual theap caching.
#[inline]
pub fn set_thread_heap(heap: *mut mimalloc::Heap) {
    AST_HEAP.set(heap);
}

/// Current thread's AST heap, or null if no `ASTMemoryAllocator` scope is
/// active.
#[inline]
pub fn thread_heap() -> *mut mimalloc::Heap {
    AST_HEAP.get()
}

/// RAII guard: for its lifetime, [`AstAlloc`] allocates on **global** mimalloc
/// instead of the per-parse [`thread_heap`]. Use when constructing
/// `AstVec`/`StoreRef` data that must outlive the current parse arena
/// (e.g. `Expr::deep_clone` for `WorkspacePackageJSONCache`). Without this,
/// the next `ASTMemoryAllocator::reset()` frees buffers the cache still holds.
///
/// Restores the prior heap on drop, so it nests correctly inside an
/// `ASTMemoryAllocator` scope.
pub struct DetachAstHeap(*mut mimalloc::Heap);
impl DetachAstHeap {
    #[inline]
    pub fn new() -> Self {
        let prev = thread_heap();
        set_thread_heap(core::ptr::null_mut());
        Self(prev)
    }
}
impl Drop for DetachAstHeap {
    #[inline]
    fn drop(&mut self) {
        set_thread_heap(self.0);
    }
}

/// Zero-sized `Allocator` that routes to [`thread_heap`] when set, else to
/// global mimalloc. `deallocate` is a no-op (arena reclaims on `reset()`).
///
/// Use as `Vec<T, AstAlloc>` (see [`AstVec`]). The ZST means the `Vec` stays
/// 24 bytes — same size as `Vec<T>` — so AST node layouts are unchanged.
#[derive(Clone, Copy, Default)]
pub struct AstAlloc;

/// `Vec` whose backing buffer lives in the thread-local AST `mi_heap_t`.
pub type AstVec<T> = Vec<T, AstAlloc>;

use crate::alloc_result;

#[inline(always)]
fn heap_alloc(layout: Layout) -> *mut u8 {
    let heap = AST_HEAP.get();
    if heap.is_null() {
        // Global fallback (no AST scope active). `mi_malloc` tolerates
        // `size == 0` (unique non-null pointer), so no special-casing.
        mimalloc::mi_malloc_auto_align(layout.size(), layout.align()).cast()
    } else {
        // SAFETY: `heap` is the live `mi_heap_t*` of this thread's
        // `ASTMemoryAllocator` arena (the documented contract of
        // `set_thread_heap`); the scope guarantees it is not `reset()` while
        // active.
        unsafe { mimalloc::mi_heap_malloc_auto_align(heap, layout.size(), layout.align()).cast() }
    }
}

// SAFETY:
// - `allocate`/`grow` return blocks from `mi_heap_malloc[_aligned]` (or global
//   `mi_malloc[_aligned]` when no TL heap is set), which satisfy `layout` and
//   are owned by `AST_HEAP` (or the global heap). Under a TL heap they are
//   bulk-freed by `mi_heap_destroy` on `MimallocArena::reset()`.
// - `deallocate` is a no-op (permitted: the trait only requires that memory
//   *may* be reclaimed). This preserves the `Expr::Data::clone_in` invariant
//   (two `Vec` headers may alias one buffer; neither frees it). Under the
//   global fallback the buffer leaks until process exit — the documented
//   pre-Strategy-B status quo.
// - `grow` allocates a fresh block + `memcpy` rather than `mi_realloc`: when
//   the TL heap is *null* we cannot tell whether `ptr` is a global-fallback
//   `mi_malloc` block head or a heap block from a since-exited AST scope on
//   another thread (`BundleV2::clone_ast` does exactly this), so passing it to
//   `mi_realloc` would be unsound. The old block is abandoned (same leak
//   semantics as `deallocate`).
// - `AstAlloc` is a ZST: every instance is trivially "the same allocator", so
//   the "pointers may be freed by any clone" requirement is satisfied.
// - `Send + Sync` (auto-derived for a fieldless ZST) is sound: each call reads
//   the *calling* thread's `AST_HEAP`, and allocation is gated to that thread
//   by `ASTMemoryAllocator`'s single-threaded contract (mirrored from Zig's
//   `ThreadLock`; see `MimallocArena::assert_owning_thread`). The no-op
//   `deallocate` removes the only cross-thread hazard a `Vec<_,A>: Send` would
//   otherwise introduce.
unsafe impl Allocator for AstAlloc {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        alloc_result(heap_alloc(layout), layout.size())
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        // Unconditional no-op — see SAFETY block above and the module doc's
        // `Expr::Data::clone_in` invariant. Under a TL heap the block is
        // reclaimed by `mi_heap_destroy` on the next `MimallocArena::reset()`;
        // under the global fallback it leaks (cannot prove `ptr`'s provenance).
        let _ = (ptr, layout);
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // Allocate-new + copy + abandon-old. Not `mi_realloc`: `ptr`'s
        // provenance is unknown when the TL heap is null (see SAFETY above),
        // and under a TL heap the old block is reclaimed by `mi_heap_destroy`
        // anyway, so the leak is bounded by the arena lifetime.
        let p = NonNull::new(heap_alloc(new)).ok_or(AllocError)?;
        // SAFETY: `p` is a fresh `new.size()`-byte block disjoint from `ptr`;
        // `old.size()` bytes at `ptr` are initialized per the `grow` contract;
        // `old.size() <= new.size()`.
        unsafe { core::ptr::copy_nonoverlapping(ptr.as_ptr(), p.as_ptr(), old.size()) };
        Ok(NonNull::slice_from_raw_parts(p, new.size()))
    }

    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // Keep the existing slot — it already holds ≥ `new.size()` bytes at ≥
        // `old.align()` alignment, and `new.size() <= old.size()` per the
        // `Allocator::shrink` contract. No `mi_realloc`: see `grow` note.
        debug_assert!(new.align() <= old.align());
        let _ = old;
        Ok(NonNull::slice_from_raw_parts(ptr, new.size()))
    }
}

// ── AstVec construction helpers ──────────────────────────────────────────
// `Vec<T, A>` has no `Default` / `From<&[T]>` for non-`Global` `A`, so the
// 81 `DeclList::default()` / `::from_slice()` etc. call sites need these.
// Kept as free fns (not a trait) so `bun_collections::VecExt` can add a
// blanket `impl<T> VecExt<T> for Vec<T, AstAlloc>` that forwards here without
// a `bun_alloc → bun_collections` cycle.

impl AstAlloc {
    /// `Vec::new()` parity. `const` so it is usable in `Default` impls.
    #[inline]
    pub const fn vec<T>() -> AstVec<T> {
        Vec::new_in(AstAlloc)
    }

    /// `Vec::with_capacity` parity.
    #[inline]
    pub fn vec_with_capacity<T>(cap: usize) -> AstVec<T> {
        Vec::with_capacity_in(cap, AstAlloc)
    }

    /// `<[T]>::to_vec` parity (Zig: `BabyList.fromSlice`).
    #[inline]
    pub fn vec_from_slice<T: Clone>(items: &[T]) -> AstVec<T> {
        let mut v = Vec::with_capacity_in(items.len(), AstAlloc);
        v.extend_from_slice(items);
        v
    }

    /// Move `items` element-wise into a fresh AST-heap allocation. Replaces
    /// both `VecExt::from_owned_slice` (`Box<[T]>` → `Vec`) and
    /// `VecExt::from_bump_slice` (leaked `&mut [T]` → `Vec`): in either case
    /// the source storage is on the wrong heap, so a copy is unavoidable.
    #[inline]
    pub fn vec_from_iter<T, I: IntoIterator<Item = T>>(iter: I) -> AstVec<T> {
        let iter = iter.into_iter();
        let (lo, _) = iter.size_hint();
        let mut v = Vec::with_capacity_in(lo, AstAlloc);
        v.extend(iter);
        v
    }
}

// NOTE: `impl<T> Default for Vec<T, AstAlloc>` is rejected by orphan rules
// (`T` is an uncovered type param appearing before the local `AstAlloc` in
// `Vec`'s parameter list). `core::mem::take` therefore cannot be used on
// `AstVec<T>`; call [`AstAlloc::take`] instead.
impl AstAlloc {
    /// `core::mem::take` for [`AstVec`] (whose `Default` impl is blocked by
    /// orphan rules). Replaces `*v` with an empty vec and returns the old
    /// contents.
    #[inline]
    pub fn take<T>(v: &mut AstVec<T>) -> AstVec<T> {
        core::mem::replace(v, Vec::new_in(AstAlloc))
    }
}
