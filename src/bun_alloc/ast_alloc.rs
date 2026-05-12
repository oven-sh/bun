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

/// Pre-resolved `mi_theap_t*` for [`AST_HEAP`] on this thread, or null when
/// no AST scope is entered.
///
/// `mi_heap_malloc(heap, …)` resolves `heap → theap` on **every** call via
/// `_mi_heap_theap` (TLS read of `__mi_theap_cached` + heap-tag compare,
/// falling back to `_mi_heap_theap_get_or_init` → `_mi_theap_cached_set`
/// when the AST heap is not the cached default — which it never is, since the
/// parser-scratch arena and the global allocator both interleave on the same
/// thread). That lookup showed up as 63 self samples under `AstAlloc::
/// allocate` in build/create-vue and lint/create-vite profiles.
///
/// Caching the resolved `mi_theap_t*` here lets [`AstAlloc::allocate`] call
/// `mi_theap_malloc[_aligned]` directly, bypassing `_mi_heap_theap` entirely
/// for the hot AST-interior `Vec` path and leaving mimalloc's internal
/// `__mi_theap_cached` slot warm for whichever allocator (parser scratch /
/// global) last touched it.
#[thread_local]
static AST_THEAP: Cell<*mut mimalloc::THeap> = Cell::new(core::ptr::null_mut());

// ── Bump-allocator layer over `AST_HEAP` ─────────────────────────────────
//
// Zig backs the AST allocator with `std.heap.ArenaAllocator` — a chained-buffer
// bump allocator — so each `Vec` grow / scope-map insert / node-list push is a
// pointer add. The Rust port replaced that with a raw `mi_heap_t`, so every
// `Vec<_, AstAlloc>` allocation hit mimalloc's full alloc path: on `next lint`
// (create-vite), perf-diff vs Zig showed +473 main-thread self samples in
// mimalloc symbols, +104 in `__memset` (fresh-page bitmap zeroing inside
// `mi_theap_malloc_zero_aligned_at_overalloc`), +63 in `_mi_theap_cached_set`,
// and +2629 minor faults — while `bun_js_parser` + `bun_ast` self-time was
// *identical* to Zig. The whole `Bun__transpileFile` delta was allocator
// overhead.
//
// These three TLS slots restore the bump layer: [`AstAlloc::allocate`] bumps
// within `[CUR, END)`; on miss it refills with a geometrically-grown chunk
// from `mi_theap_malloc` (via the cached [`AST_THEAP`], so the TLS heap-swap
// is paid once per chunk, not once per alloc). Chunks are bulk-freed by
// `mi_heap_destroy` on `MimallocArena::reset()`, exactly like the AST nodes
// they back. This collapses ~10⁵ `mi_heap_malloc` calls per `next lint` run to
// ~10² chunk refills, matching Zig.
//
// State is keyed to `AST_HEAP`: [`set_thread_heap`] clears it whenever the
// heap pointer *changes* (different arena, destroyed-and-recreated heap, or
// cleared to null) and leaves it intact when re-installing the *same* heap (so
// `Scope::exit` returning to `store_ast_alloc_heap`'s unchanged heap keeps the
// warm chunk).

/// Next-free byte within the current bump chunk. Null ⇒ no chunk yet.
#[thread_local]
static AST_BUMP_CUR: Cell<*mut u8> = Cell::new(core::ptr::null_mut());
/// One-past-end of the current bump chunk.
#[thread_local]
static AST_BUMP_END: Cell<*mut u8> = Cell::new(core::ptr::null_mut());
/// Size of the *next* chunk to request. Starts at [`BUMP_CHUNK_INIT`] and
/// doubles per refill up to [`BUMP_CHUNK_MAX`], matching
/// `std.heap.ArenaAllocator`'s geometric node growth.
#[thread_local]
static AST_BUMP_NEXT: Cell<usize> = Cell::new(BUMP_CHUNK_INIT);

const BUMP_CHUNK_INIT: usize = 64 * 1024;
const BUMP_CHUNK_MAX: usize = 8 * 1024 * 1024;

/// Install `heap` as the thread's AST heap. Pass `null` to clear.
/// Intended caller: `ASTMemoryAllocator` (push/pop/Scope) only.
///
/// Also eagerly resolves and caches this thread's `mi_theap_t*` for `heap`
/// (one `mi_heap_theap` call per scope entry instead of one `_mi_heap_theap`
/// per allocation), and discards the bump-chunk state when `heap` differs from
/// the previously-installed one — the old chunk belongs to the old heap and
/// may be about to be `mi_heap_destroy`ed.
#[inline]
pub fn set_thread_heap(heap: *mut mimalloc::Heap) {
    if AST_HEAP.replace(heap) != heap {
        AST_BUMP_CUR.set(core::ptr::null_mut());
        AST_BUMP_END.set(core::ptr::null_mut());
        AST_BUMP_NEXT.set(BUMP_CHUNK_INIT);
    }
    AST_THEAP.set(if heap.is_null() {
        core::ptr::null_mut()
    } else {
        // SAFETY: `heap` is a live `mi_heap_t*` owned by this thread's
        // `ASTMemoryAllocator` / `store_ast_alloc_heap` arena (the documented
        // contract of this fn). `mi_heap_theap` creates the per-thread
        // `mi_theap_t` on first use and is idempotent thereafter.
        unsafe { mimalloc::mi_heap_theap(heap) }
    });
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

#[inline(always)]
fn alloc_result(p: *mut u8, size: usize) -> Result<NonNull<[u8]>, AllocError> {
    NonNull::new(p)
        .map(|p| NonNull::slice_from_raw_parts(p, size))
        .ok_or(AllocError)
}

/// Bump fast path: align `cur` up to `layout.align()`, carve `layout.size()`
/// bytes if they fit before `end`, else null. Address arithmetic only — `cur`
/// and `end` are within (or one-past) the same `mi_theap_malloc` block, so the
/// `add`s stay in-bounds of that allocation.
///
/// `cur`/`end` may be null on the first call after `set_thread_heap`; the
/// arithmetic degenerates to `0` and the capacity check fails (for any nonzero
/// `size`), so the caller falls through to `bump_refill`.
#[inline(always)]
fn bump_try(cur: *mut u8, end: *mut u8, layout: Layout) -> *mut u8 {
    let cur_addr = cur as usize;
    let pad = cur_addr.wrapping_neg() & (layout.align() - 1);
    // `Layout` invariant: `size + (align - 1) <= isize::MAX`; `pad < align`,
    // so `pad + size` cannot overflow.
    let need = pad + layout.size();
    if (end as usize).wrapping_sub(cur_addr) < need {
        return core::ptr::null_mut();
    }
    // SAFETY: `cur + pad + size <= end`, all within the live chunk allocation.
    let aligned = unsafe { cur.add(pad) };
    AST_BUMP_CUR.set(unsafe { aligned.add(layout.size()) });
    aligned
}

/// Slow path: current chunk exhausted (or none yet). Allocate a fresh chunk of
/// `max(next_size, padded(layout))` from the AST heap via the cached `theap`,
/// install it as the new bump region, and carve `layout` from it.
#[cold]
fn bump_refill(theap: *mut mimalloc::THeap, layout: Layout) -> *mut u8 {
    let align = layout.align();
    // Chunk size: at least the geometric `next`, and at least enough for this
    // request including worst-case alignment padding (mimalloc returns
    // 16-aligned blocks; anything stricter is padded inside the chunk).
    let next = AST_BUMP_NEXT.get();
    let want = layout.size().saturating_add(align.saturating_sub(1));
    let chunk_len = next.max(want);
    // SAFETY: `theap` is the live `mi_theap_t*` for this thread's AST heap
    // (resolved by `set_thread_heap`; the scope guarantees the heap is not
    // `reset()` while active). `mi_theap_malloc` returns a fresh ≥16-aligned
    // block of `chunk_len` bytes or null on OOM.
    let chunk = unsafe { mimalloc::mi_theap_malloc(theap, chunk_len) }.cast::<u8>();
    if chunk.is_null() {
        return core::ptr::null_mut();
    }
    // Geometric growth for the *next* refill, clamped so a single huge request
    // does not permanently inflate the increment.
    AST_BUMP_NEXT.set((next * 2).min(BUMP_CHUNK_MAX));
    // SAFETY: `chunk .. chunk + chunk_len` is the just-allocated block.
    let end = unsafe { chunk.add(chunk_len) };
    AST_BUMP_END.set(end);
    // The fresh chunk is sized to fit; this cannot return null.
    let p = bump_try(chunk, end, layout);
    debug_assert!(!p.is_null());
    p
}

// SAFETY:
// - TL-heap path: `allocate` returns a sub-slice of a `mi_theap_malloc` block
//   (the bump chunk) of ≥`layout.size()` bytes aligned to `layout.align()`.
//   The chunk — and therefore every sub-slice — is owned by `AST_HEAP` and
//   bulk-freed by `mi_heap_destroy` on `MimallocArena::reset()`. `deallocate`
//   is a no-op under a TL heap (permitted: the trait only requires that memory
//   *may* be reclaimed). `grow`/`shrink` either extend the last bump in place
//   or carve a fresh sub-slice and `memcpy` the prefix, preserving
//   `min(old, new)` bytes as required.
// - Global-fallback path (TL heap null): `allocate`/`grow`/`shrink` forward to
//   `mi_malloc[_aligned]` / `mi_realloc_aligned`, and `deallocate` to
//   `mi_free`, with the standard mimalloc contracts. The fallback path never
//   produces bump-interior pointers, so `mi_free`/`mi_realloc` see only real
//   block heads. The pre-existing assumption — that an `AstVec` allocated
//   under an active AST scope is not later freed/grown after the scope exits
//   — is unchanged (such buffers are bulk-freed by the arena reset; the
//   caller never owns them past `pop`/`exit`).
// - `AstAlloc` is a ZST: every instance is trivially "the same allocator", so
//   the "pointers may be freed by any clone" requirement is satisfied.
// - `Send + Sync` (auto-derived for a fieldless ZST) is sound: each call reads
//   the *calling* thread's `AST_HEAP`/bump TLS, and allocation is gated to
//   that thread by `ASTMemoryAllocator`'s single-threaded contract (mirrored
//   from Zig's `ThreadLock`; see `MimallocArena::assert_owning_thread`). The
//   no-op `deallocate` removes the only cross-thread hazard a `Vec<_,A>: Send`
//   would otherwise introduce.
unsafe impl Allocator for AstAlloc {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        let theap = AST_THEAP.get();
        if theap.is_null() {
            // Global fallback (no AST scope active). `mi_malloc` tolerates
            // `size == 0` (unique non-null pointer), so no special-casing.
            let p = if mimalloc::must_use_aligned_alloc(layout.align()) {
                mimalloc::mi_malloc_aligned(layout.size(), layout.align())
            } else {
                mimalloc::mi_malloc(layout.size())
            };
            return alloc_result(p.cast(), layout.size());
        }
        // Bump fast path. `cur`/`end` start null after `set_thread_heap`; the
        // capacity check then fails and we fall through to `bump_refill`.
        let cur = AST_BUMP_CUR.get();
        let end = AST_BUMP_END.get();
        let mut p = bump_try(cur, end, layout);
        if p.is_null() {
            p = bump_refill(theap, layout);
        }
        alloc_result(p, layout.size())
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        // Only free when no AST scope is active. While a TL heap is set the
        // pointer is interior to a bump chunk owned by that heap, reclaimed by
        // `mi_heap_destroy` on the next `MimallocArena::reset()`; the no-op
        // here is what keeps `Expr::Data::clone_in`'s `ptr::read` bitwise copy
        // of `Vec` headers sound (two headers may alias one buffer; neither
        // ever frees it).
        //
        // When the TL heap is *null* the buffer was allocated on the global
        // mimalloc heap (bundler block-store path / any parse outside an
        // `ASTMemoryAllocator` scope) and there is no arena reset to reclaim
        // it. Before AstAlloc this was a `Vec<T, Global>` whose `Drop` *did*
        // free; an unconditional no-op would regress that path. `mi_free` is
        // heap-agnostic and thread-safe, so freeing here is correct for the
        // global-fallback case. The `clone_in` invariant is unaffected:
        // `clone_in` only runs under an active AST scope, so this branch is
        // never taken there.
        if thread_heap().is_null() {
            // SAFETY: heap-null ⇒ `ptr` came from `mi_malloc*` /
            // `mi_realloc_aligned` (the global-fallback branches of
            // `allocate`/`grow`), never from the bump path. `mi_free` accepts
            // any mimalloc block head.
            unsafe { mimalloc::mi_free(ptr.as_ptr().cast()) };
        }
        // TL heap set → strict no-op. NOT a last-alloc rewind: two
        // `Vec<_, AstAlloc>` headers may alias one buffer (the `clone_in`
        // invariant above), so reclaiming on drop of one would corrupt the
        // other. The bytes are recovered by `mi_heap_destroy` on
        // `MimallocArena::reset()`.
        let _ = (ptr, layout);
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        let theap = AST_THEAP.get();
        if theap.is_null() {
            // SAFETY: heap-null ⇒ `ptr` is a real mimalloc block head from the
            // global-fallback `allocate`/`grow` (see `deallocate` note).
            // `mi_realloc_aligned` accepts cross-heap pointers and preserves
            // the prefix.
            let p = unsafe {
                mimalloc::mi_realloc_aligned(ptr.as_ptr().cast(), new.size(), new.align())
            };
            return alloc_result(p.cast(), new.size());
        }
        // Bump path. Try in-place extend first: if `ptr` is the last bump and
        // already satisfies the new alignment, just move `cur` forward.
        // Matches `std.heap.ArenaAllocator.resize`.
        let cur = AST_BUMP_CUR.get();
        let end = AST_BUMP_END.get();
        // SAFETY: `ptr + old.size()` is in-bounds per the `Allocator` contract.
        let old_end = unsafe { ptr.as_ptr().add(old.size()) };
        if old_end == cur
            && (ptr.as_ptr() as usize) & (new.align() - 1) == 0
            && (end as usize).wrapping_sub(ptr.as_ptr() as usize) >= new.size()
        {
            // SAFETY: `ptr + new.size() <= end`, within the live chunk.
            AST_BUMP_CUR.set(unsafe { ptr.as_ptr().add(new.size()) });
            return Ok(NonNull::slice_from_raw_parts(ptr, new.size()));
        }
        // Otherwise carve a fresh slot and copy. The old slot is abandoned in
        // the chunk (bump-arena semantics; reclaimed on `mi_heap_destroy`).
        // `ptr` may also be a real mimalloc block head (allocated under
        // heap-null then grown after a scope was entered) — copying is
        // correct there too; the old block is reclaimed by `mi_free` if it
        // was global, or by `mi_heap_destroy` if it was a prior arena's, per
        // the same lifecycle assumption as `deallocate`.
        let mut p = bump_try(cur, end, new);
        if p.is_null() {
            p = bump_refill(theap, new);
        }
        let p = NonNull::new(p).ok_or(AllocError)?;
        // SAFETY: `p` is a fresh `new.size()`-byte slot disjoint from `ptr`
        // (different bump offset, or different chunk); `old.size()` bytes at
        // `ptr` are initialized per the `grow` contract; `old.size() <=
        // new.size()`.
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
        if AST_THEAP.get().is_null() {
            // SAFETY: see `grow` heap-null branch.
            let p = unsafe {
                mimalloc::mi_realloc_aligned(ptr.as_ptr().cast(), new.size(), new.align())
            };
            return alloc_result(p.cast(), new.size());
        }
        // Bump path: keep the existing slot — it already holds ≥ `new.size()`
        // bytes at ≥ `old.align()` alignment, and the `Allocator::shrink`
        // contract guarantees `new.size() <= old.size()`. No last-alloc rewind
        // (see `deallocate`: aliased headers via `clone_in`).
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
