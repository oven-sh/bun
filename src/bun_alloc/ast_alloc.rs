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

// ── Per-thread small-allocation bump arena ───────────────────────────────────
//
// The parser builds thousands of tiny `AstVec`s (`ExprNodeList`, `G::DeclList`,
// `G::PropertyList`, `ClassStaticBlock::stmts`, …). Without this, every fresh
// list and every growth reallocation is a `mi_heap_malloc` / `mi_heap_realloc`
// on the AST heap — and the *first* allocation for a not-yet-seen size class
// drops into mimalloc's `_mi_malloc_generic` slow path (visible in next-lint
// profiles). Zig's parser keeps these short lists in pooled / stack-seeded
// buffers so the small case never touches the allocator; this matches that by
// carving allocations `<= BUMP_MAX` from a large chunk owned by the active AST
// `mi_heap_t`. The chunk is allocated *once* (per refill), so N tiny lists cost
// one `mi_heap_malloc` instead of N.
//
// Lifetime / safety: the chunk is allocated from `AST_HEAP` and is *never* freed
// individually (consistent with `AstAlloc::deallocate` being a no-op) — it is
// reclaimed by `mi_heap_destroy` on `MimallocArena::reset()`, alongside the AST
// nodes whose `Vec` headers point into it. The bump cursor is invalidated
// ([`bump_reset`]) on every [`set_thread_heap`], so it never outlives the heap
// that owns its chunk: any `mi_heap_destroy` affecting `AST_HEAP` in a
// well-formed call sequence is bracketed by a `set_thread_heap` (otherwise
// `heap_alloc` itself would already use-after-free the stale `*mut mi_heap_t`).
// This is the discipline the earlier reverted bump layer lacked — it cached the
// `mi_heap_t*` across heap swaps, so a recycled slot (#53599) aliased a
// destroyed heap. Here the cursor is dropped, not the heap pointer cached, so an
// ABA on the `mi_heap_t*` value can only happen *through* a `set_thread_heap`,
// which clears the cursor first.
//
// `grow` must not pass a bump-carved interior pointer to `mi_expand` (it would
// corrupt that chunk's mimalloc bookkeeping without ever moving our cursor), so
// the `mi_expand` fast path there is gated to `old.size() > BUMP_MAX` — a block
// of that size necessarily came straight from `mi_heap_malloc`.

/// Largest allocation served from the bump chunk; above this, requests go
/// straight to `mi_heap_malloc`. Covers the first few growth steps of the AST
/// list types (e.g. a `Vec<Expr>` passes 96 / 192 / 384 bytes before mimalloc
/// takes over) and `with_capacity` / `from_slice` for short lists.
const BUMP_MAX: usize = 512;

/// Backing chunk size — comparable to a `new_store!` AST-node block; large
/// enough that a typical module needs only a handful, all freed with the arena.
const BUMP_CHUNK: usize = 16 * 1024;

/// Next free byte of the active bump chunk, or null when none is active.
#[thread_local]
static BUMP_CUR: Cell<*mut u8> = Cell::new(core::ptr::null_mut());
/// One-past-the-end of the active bump chunk.
#[thread_local]
static BUMP_END: Cell<*mut u8> = Cell::new(core::ptr::null_mut());

/// Drop the bump cursor (the chunk itself is owned by `AST_HEAP` and reclaimed
/// by `mi_heap_destroy`). Called on every [`set_thread_heap`] so a cursor never
/// outlives the heap that backs its chunk.
#[inline]
fn bump_reset() {
    BUMP_CUR.set(core::ptr::null_mut());
    BUMP_END.set(core::ptr::null_mut());
}

/// Carve `size` bytes at `align` (a power of two `<= MI_MAX_ALIGN_SIZE`) from
/// the thread's bump chunk for `heap`, refilling with a fresh `mi_heap_malloc`
/// chunk when the current one is exhausted. `None` only on allocation failure
/// (the caller then falls back to `mi_heap_malloc` directly).
#[inline]
fn bump_alloc(heap: *mut mimalloc::Heap, size: usize, align: usize) -> Option<*mut u8> {
    debug_assert!(size != 0 && size <= BUMP_MAX && align.is_power_of_two());
    debug_assert!(align <= mimalloc::MI_MAX_ALIGN_SIZE);
    let cur = BUMP_CUR.get();
    if !cur.is_null() {
        // Bytes left in the active chunk; `BUMP_END >= BUMP_CUR` is the cursor
        // invariant (set together in `bump_refill`, only ever advanced here).
        let remaining = (BUMP_END.get() as usize).wrapping_sub(cur as usize);
        let pad = cur.align_offset(align);
        if pad <= remaining && size <= remaining - pad {
            // SAFETY: `pad + size <= remaining`, so `cur + pad` and
            // `cur + pad + size` stay within `[BUMP_CUR, BUMP_END]` — i.e. in
            // bounds of the chunk allocation (one-past-the-end at most).
            let aligned = unsafe { cur.add(pad) };
            BUMP_CUR.set(unsafe { aligned.add(size) });
            return Some(aligned);
        }
    }
    bump_refill(heap, size)
}

#[cold]
#[inline(never)]
fn bump_refill(heap: *mut mimalloc::Heap, size: usize) -> Option<*mut u8> {
    // SAFETY: `heap` is the live AST heap — `bump_alloc`'s only caller is
    // `heap_alloc`, which passes `AST_HEAP.get()` after a non-null check, and
    // `set_thread_heap` keeps the bump cursor consistent with `AST_HEAP`.
    let chunk = unsafe { mimalloc::mi_heap_malloc(heap, BUMP_CHUNK).cast::<u8>() };
    if chunk.is_null() {
        return None;
    }
    // `chunk` is `>= MI_MAX_ALIGN_SIZE`-aligned (mimalloc guarantee) and the
    // caller's `align <= MI_MAX_ALIGN_SIZE`, so carving from the front already
    // satisfies the request's alignment. `size <= BUMP_MAX < BUMP_CHUNK`, so
    // both `add`s are in bounds.
    BUMP_CUR.set(unsafe { chunk.add(size) });
    BUMP_END.set(unsafe { chunk.add(BUMP_CHUNK) });
    Some(chunk)
}

/// Install `heap` as the thread's AST heap. Pass `null` to clear.
/// Intended caller: `ASTMemoryAllocator` (push/pop/Scope) only.
//
// Also drops the small-allocation bump cursor ([`bump_reset`]): its chunk is
// owned by the *outgoing* heap, so it must not be reused under the incoming one.
//
// PERF NOTE: a previous iteration also cached the resolved `mi_theap_t*` here to
// skip mimalloc's per-call `heap → theap` TLS lookup. Reverted: `mi_theap_t*` is
// per-OS-thread while `mi_heap_t*` is `Send`, so caching the former on a struct
// that may move threads is a corruption footgun, and that layer also cached the
// `mi_heap_t*` across heap swaps — a recycled slot (#53599) then aliased a
// destroyed heap. The bump arena above avoids both: nothing per-OS-thread is
// cached, and the cursor (not the heap pointer) is what survives, dropped on
// every swap. Zig does not use `mi_theap_*` either. If `_mi_heap_theap` thrash
// resurfaces in profiles, the intended fix is `mi_heap_set_default(heap)` for
// the parse scope (mimalloc's supported "make this heap the cached one" API),
// not manual theap caching.
#[inline]
pub fn set_thread_heap(heap: *mut mimalloc::Heap) {
    AST_HEAP.set(heap);
    bump_reset();
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
        return mimalloc::mi_malloc_auto_align(layout.size(), layout.align()).cast();
    }
    // Small, normally-aligned requests: bump-carve from a chunk owned by `heap`
    // so a burst of tiny `AstVec`s costs one `mi_heap_malloc` instead of one
    // per list (and stays out of `_mi_malloc_generic`). See the bump-arena doc
    // above for the lifetime / `mi_expand` argument. Zero-size layouts and
    // over-aligned ones (no AST list type needs `> MI_MAX_ALIGN_SIZE`) fall
    // through to mimalloc, which handles both.
    if layout.size() != 0
        && layout.size() <= BUMP_MAX
        && layout.align() <= mimalloc::MI_MAX_ALIGN_SIZE
    {
        if let Some(p) = bump_alloc(heap, layout.size(), layout.align()) {
            return p;
        }
    }
    // SAFETY: `heap` is the live `mi_heap_t*` of this thread's
    // `ASTMemoryAllocator` arena (the documented contract of `set_thread_heap`);
    // the scope guarantees it is not `reset()` while active.
    unsafe { mimalloc::mi_heap_malloc_auto_align(heap, layout.size(), layout.align()).cast() }
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
// - `grow` tries `mi_expand` (extend the existing block in place — never moves
//   it, so it stays in whatever heap owns it) *only when `old.size() > BUMP_MAX`*:
//   a smaller block may be a bump-arena interior pointer (see `heap_alloc`), on
//   which `mi_expand` would corrupt the chunk's bookkeeping. A `> BUMP_MAX`
//   block always came straight from `mi_heap_malloc[_aligned]`, so it is sound.
//   Otherwise (and on `mi_expand` failure) `grow` allocates a fresh block +
//   `memcpy` rather than `mi_realloc`: when the TL heap is *null* we cannot tell
//   whether `ptr` is a global-fallback `mi_malloc` block head or a heap block
//   from a since-exited AST scope on another thread (`BundleV2::clone_ast` does
//   exactly this), so passing it to `mi_realloc` would be unsound. The old block
//   is abandoned (same leak semantics as `deallocate` — and under a TL heap it,
//   like every other block, is reclaimed by `mi_heap_destroy` on `reset()`).
// - `allocate_zeroed` is `mi_*zalloc` (skips the redundant `memset` mimalloc
//   would otherwise need over already-zero OS pages); same lifetime as
//   `allocate`.
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
    fn allocate_zeroed(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        // `mi_*zalloc` lets mimalloc skip the `memset` for blocks carved from
        // freshly-`mmap`ed (already-zero) OS pages, which the default
        // `allocate` + `ptr::write_bytes(0)` cannot. Same lifetime semantics as
        // `heap_alloc` (the block is reclaimed by `mi_heap_destroy` on
        // `MimallocArena::reset()`, or leaks under the global fallback). Mirrors
        // `MimallocArena::allocate_zeroed`.
        let heap = AST_HEAP.get();
        let p: *mut u8 = if heap.is_null() {
            mimalloc::mi_zalloc_auto_align(layout.size(), layout.align()).cast()
        } else {
            // SAFETY: `heap` is the live `mi_heap_t*` of this thread's AST
            // arena (the `set_thread_heap` contract); see `heap_alloc`.
            unsafe {
                mimalloc::mi_heap_zalloc_auto_align(heap, layout.size(), layout.align()).cast()
            }
        };
        alloc_result(p, layout.size())
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
        // Fast path: mimalloc rounds every allocation up to a size class, so the
        // block behind `ptr` frequently already has room for `new.size()`.
        // `mi_expand` reports that (and fixes up mimalloc's own padding
        // bookkeeping) *without* moving the block — so it stays in whatever heap
        // owns it and never thrashes the `heap → theap` TLS lookup. When it
        // succeeds there is no allocation, no `memcpy`, and no abandoned block,
        // matching `MimallocArena`'s `resize_in_place` (Zig's arena `remap` is
        // `mi_expand`-then-`mi_realloc`).
        //
        // Gated on:
        //  - `old.size() > BUMP_MAX`: smaller blocks may be bump-arena interior
        //    pointers (see `heap_alloc`), and `mi_expand` on those would treat
        //    the *whole chunk* as the block — corrupting both its bookkeeping
        //    and our cursor. A `> BUMP_MAX` block always came straight from
        //    `mi_heap_malloc[_aligned]`, so this is the only safe slice to use it.
        //  - `new.align() <= old.align()`: the block was aligned for `old`,
        //    `mi_expand` cannot raise that, and for `Vec<T>` (the only `AstVec`
        //    shape) the alignment never changes across grows.
        if old.size() > BUMP_MAX && new.align() <= old.align() {
            // SAFETY: `ptr` is a live block from this allocator (the `grow`
            // contract) and — given `old.size() > BUMP_MAX` — a real mimalloc
            // block head, the precondition `mi_expand` requires. It returns
            // `ptr` unchanged on success or null when the block cannot hold
            // `new.size()`.
            if let Some(p) = NonNull::new(unsafe {
                mimalloc::mi_expand(ptr.as_ptr().cast(), new.size()).cast::<u8>()
            }) {
                return Ok(NonNull::slice_from_raw_parts(p, new.size()));
            }
        }
        // Slow path: allocate-new (possibly bump-carved) + copy + abandon-old.
        // Not `mi_realloc`: `ptr`'s provenance is unknown when the TL heap is
        // null (see SAFETY above), and under a TL heap the old block is reclaimed
        // by `mi_heap_destroy` anyway, so the leak is bounded by the arena.
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
