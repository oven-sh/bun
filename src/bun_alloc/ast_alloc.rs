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
//! Placed in `bun_alloc` (not `js_parser`) so that `bun_logger::js_ast::
//! ExprNodeList` and `bun_collections::VecExt` — both below `js_parser` in the
//! crate graph — can name `Vec<T, AstAlloc>`.

use core::alloc::{AllocError, Allocator, Layout};
use core::cell::Cell;
use core::ptr::NonNull;

use crate::mimalloc;

thread_local! {
    /// Raw `mi_heap_t*` of the active `ASTMemoryAllocator`'s `MimallocArena`,
    /// or null when no AST scope is entered. Set/cleared by
    /// `js_parser::ast::ASTMemoryAllocator::{push,pop}` and
    /// `ASTMemoryAllocator::Scope::{enter,exit}` (alongside the existing
    /// `Stmt/Expr.Data.Store.MEMORY_ALLOCATOR` and
    /// `bun_logger::js_ast::data_store_override` thread-locals).
    static AST_HEAP: Cell<*mut mimalloc::Heap> = const { Cell::new(core::ptr::null_mut()) };
}

/// Install `heap` as the thread's AST heap. Pass `null` to clear.
/// Intended caller: `ASTMemoryAllocator` (push/pop/Scope) only.
#[inline]
pub fn set_thread_heap(heap: *mut mimalloc::Heap) {
    AST_HEAP.with(|c| c.set(heap));
}

/// Current thread's AST heap, or null if no `ASTMemoryAllocator` scope is
/// active.
#[inline]
pub fn thread_heap() -> *mut mimalloc::Heap {
    AST_HEAP.with(|c| c.get())
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

#[inline(always)]
fn alloc_result(p: *mut u8, size: usize) -> Result<NonNull<[u8]>, AllocError> {
    NonNull::new(p)
        .map(|p| NonNull::slice_from_raw_parts(p, size))
        .ok_or(AllocError)
}

// SAFETY:
// - `allocate` returns a block from `mi_heap_malloc[_aligned]` (TL heap) or
//   `mi_malloc[_aligned]` (global), each yielding ≥`layout.size()` bytes
//   aligned to `layout.align()`. mimalloc tolerates `size == 0` (returns a
//   unique non-null aligned pointer), so no zero-size special-casing.
// - `deallocate` is a no-op. This is permitted: the trait only requires that
//   the memory *may* be reclaimed, not that it is. Reclamation happens via
//   `mi_heap_destroy` on `MimallocArena::reset()` (TL path) or never (global
//   fallback — see module doc / risks).
// - `grow`/`shrink` use `mi_heap_realloc_aligned` / `mi_realloc_aligned`,
//   which preserve the `min(old, new)` prefix as required. mimalloc's realloc
//   accepts pointers from *any* mimalloc heap (see `MimallocArena::remap`
//   SAFETY note), so a buffer allocated under one TL heap and grown under
//   another (or under the global fallback) is well-defined; the new block
//   lands in whichever heap services the realloc.
// - `AstAlloc` is a ZST: every instance is trivially "the same allocator", so
//   the "pointers may be freed by any clone" requirement is satisfied.
// - `Send + Sync` (auto-derived for a fieldless ZST) is sound: each call reads
//   the *calling* thread's `AST_HEAP`, and `mi_heap_*` allocation is gated to
//   that thread by `ASTMemoryAllocator`'s single-threaded contract (mirrored
//   from Zig's `ThreadLock`; see `MimallocArena::assert_owning_thread`). The
//   no-op `deallocate` removes the only cross-thread hazard a `Vec<_,A>: Send`
//   would otherwise introduce.
unsafe impl Allocator for AstAlloc {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        let heap = thread_heap();
        // SAFETY: `heap` is either null (→ global path, no preconditions) or a
        // live `mi_heap_t*` owned by this thread's `ASTMemoryAllocator` (set by
        // `push`/`Scope::enter`, torn down only by `pop`/`exit` on this same
        // thread, and `reset()` is never called while the scope is active).
        let p = unsafe {
            if heap.is_null() {
                if mimalloc::must_use_aligned_alloc(layout.align()) {
                    mimalloc::mi_malloc_aligned(layout.size(), layout.align())
                } else {
                    mimalloc::mi_malloc(layout.size())
                }
            } else if mimalloc::must_use_aligned_alloc(layout.align()) {
                mimalloc::mi_heap_malloc_aligned(heap, layout.size(), layout.align())
            } else {
                mimalloc::mi_heap_malloc(heap, layout.size())
            }
        };
        alloc_result(p.cast(), layout.size())
    }

    #[inline]
    unsafe fn deallocate(&self, _ptr: NonNull<u8>, _layout: Layout) {
        // Intentionally a no-op. Arena-heap buffers are bulk-freed by
        // `mi_heap_destroy` on `MimallocArena::reset()`; global-fallback
        // buffers leak until process exit (status quo ante — see module doc).
        // This is what makes `Expr::Data::clone_in`'s `ptr::read` bitwise copy
        // of `Vec<_, AstAlloc>` headers sound even if a copy is later dropped.
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        _old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        let heap = thread_heap();
        // SAFETY: `ptr` was returned by `allocate`/`grow` on some mimalloc
        // heap; `mi_[heap_]realloc_aligned` accepts cross-heap pointers and
        // frees the old block internally. `heap` liveness — see `allocate`.
        let p = unsafe {
            if heap.is_null() {
                mimalloc::mi_realloc_aligned(ptr.as_ptr().cast(), new.size(), new.align())
            } else {
                mimalloc::mi_heap_realloc_aligned(
                    heap,
                    ptr.as_ptr().cast(),
                    new.size(),
                    new.align(),
                )
            }
        };
        alloc_result(p.cast(), new.size())
    }

    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // Same realloc path as `grow`.
        // SAFETY: see `grow`.
        unsafe { self.grow(ptr, old, new) }
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
