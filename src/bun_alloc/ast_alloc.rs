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
//! to the thread's active [`AstAllocState`] (installed by
//! `ASTMemoryAllocator::push`/`Scope::enter` and friends), and makes
//! `deallocate` a **no-op**. Everything allocated through a state is bulk-freed
//! when its owner resets or releases it. When no state is installed the
//! allocator falls back to global mimalloc (`mi_malloc`), matching the
//! pre-Strategy-B behaviour for the bundler / `Stmt.Data.Store` block-store
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
use core::mem::MaybeUninit;
use core::ptr::NonNull;

use crate::{MimallocArena, mimalloc};

// ── AstAllocState ────────────────────────────────────────────────────────────
//
// The parser builds thousands of tiny `AstVec`s (`ExprNodeList`, `G::DeclList`,
// `G::PropertyList`, `ClassStaticBlock::stmts`, …). Without the bump chunk,
// every fresh list and every growth reallocation is a `mi_heap_malloc` /
// `mi_heap_realloc` — and the *first* allocation for a not-yet-seen size class
// drops into mimalloc's `_mi_malloc_generic` slow path (visible in next-lint
// profiles). Zig's parser keeps these short lists in a
// `StackFallbackAllocator`'s inline buffer so the small case never touches the
// allocator; this matches that by carving allocations `<= BUMP_MAX` from a
// 16 KB buffer stored *inline* in the state.
//
// Lifetime / safety: the bump cursor is a field of the same struct as the
// buffer it indexes, so it cannot outlive it. The spill heap is owned by the
// same struct, so a block handed out by `heap_alloc` cannot outlive the state
// either. The previous design kept the cursor in bare `#[thread_local]` statics
// pointing into a chunk owned by a destroyable `mi_heap_t`; keeping that cursor
// valid across heap destruction required a manual `bump_invalidate_heap()` call
// before every `mi_heap_destroy` — a protocol that already shipped one
// use-after-free (#53599) and was the prime suspect in the elysia
// `bracket-pair-range` worker-heap corruption.

/// Largest allocation served from the inline bump chunk; above this, requests
/// go straight to the state's spill heap. Covers the first few growth steps of
/// the AST list types (e.g. a `Vec<Expr>` passes 96 / 192 / 384 bytes before
/// mimalloc takes over) and `with_capacity` / `from_slice` for short lists.
const BUMP_MAX: usize = 512;

/// Inline bump chunk size. Once exhausted there is no refill — every
/// subsequent small allocation falls through to the spill heap (matching Zig's
/// `StackFallbackAllocator` semantics).
const BUMP_CHUNK: usize = 16 * 1024;

/// Per-scope allocation state for [`AstAlloc`].
///
/// Owned by whichever component opened the AST allocation scope
/// (`ASTMemoryAllocator`, the `store_ast_alloc_heap` side module, a
/// [`ScopedAstAlloc`] guard) and moved into the [`AST_ALLOC`] thread-local
/// while the scope is active. The owner decides when the contents are
/// bulk-freed ([`Self::reset`] / [`release_state`]) — exactly where the
/// backing `MimallocArena` was reset or dropped before this type existed.
pub struct AstAllocState {
    /// Offset of the next free byte in `bump_chunk`.
    bump_cursor: usize,
    /// Spill heap, lazily created on the first allocation that cannot be
    /// served from `bump_chunk` (size > [`BUMP_MAX`], over-aligned, zeroed, or
    /// the chunk is full). Scopes that never overflow the chunk never pay
    /// `mi_heap_new`/`mi_heap_destroy` at all.
    heap: Option<MimallocArena>,
    /// Inline small-allocation buffer. Never initialised eagerly; carved
    /// ranges are written by the `Vec`s that own them.
    bump_chunk: [MaybeUninit<u8>; BUMP_CHUNK],
}

impl AstAllocState {
    /// Allocate a clean state without materialising 16 KB on the stack.
    fn new_boxed() -> Box<Self> {
        let mut boxed = Box::<Self>::new_uninit();
        let p = boxed.as_mut_ptr();
        // SAFETY: `p` points to a live uninitialised `Self`; the two header
        // fields are written before `assume_init`, and `bump_chunk` is
        // `MaybeUninit` so it is allowed to stay uninitialised.
        unsafe {
            (&raw mut (*p).bump_cursor).write(0);
            (&raw mut (*p).heap).write(None);
            boxed.assume_init()
        }
    }

    /// Bulk-free everything allocated through this state: destroy the spill
    /// heap and rewind the bump cursor. Any pointer previously returned by
    /// [`AstAlloc`] under this state is invalidated.
    #[inline]
    pub fn reset(&mut self) {
        self.bump_cursor = 0;
        // `MimallocArena::Drop` → `mi_heap_destroy` (bulk-free).
        self.heap = None;
    }

    /// Carve `size` bytes at `align` (a power of two `<= MI_MAX_ALIGN_SIZE`)
    /// from the inline chunk. `None` when it doesn't fit — there is no refill;
    /// the caller falls through to the spill heap.
    #[inline]
    fn bump_alloc(&mut self, size: usize, align: usize) -> Option<*mut u8> {
        debug_assert!(size != 0 && size <= BUMP_MAX && align.is_power_of_two());
        debug_assert!(align <= mimalloc::MI_MAX_ALIGN_SIZE);
        debug_assert!(self.bump_cursor <= BUMP_CHUNK);
        // SAFETY: `bump_cursor <= BUMP_CHUNK` (invariant: only advanced below
        // after the bounds check), so `add` is at most one-past-the-end.
        let cur = unsafe {
            self.bump_chunk
                .as_mut_ptr()
                .cast::<u8>()
                .add(self.bump_cursor)
        };
        let remaining = BUMP_CHUNK - self.bump_cursor;
        let pad = cur.align_offset(align);
        if pad <= remaining && size <= remaining - pad {
            // SAFETY: `pad + size <= remaining`, so `cur + pad` and
            // `cur + pad + size` stay within `bump_chunk` (one-past-the-end at
            // most).
            unsafe {
                let aligned = cur.add(pad);
                self.bump_cursor += pad + size;
                Some(aligned)
            }
        } else {
            None
        }
    }

    /// The state's spill `mi_heap_t`, created on first use.
    #[inline]
    fn heap_ptr(&mut self) -> *mut mimalloc::Heap {
        match &self.heap {
            Some(heap) => heap.heap_ptr(),
            None => self.heap.insert(MimallocArena::new()).heap_ptr(),
        }
    }
}

// ── Thread-local active state ────────────────────────────────────────────────

/// The active [`AstAllocState`], or `None` when no AST scope is installed
/// (allocations then fall back to global mimalloc).
///
/// `#[thread_local]` (not `thread_local!`) so this is a bare `__thread` slot
/// like Zig's `threadlocal var`: every `AstAlloc` allocation reads this, and
/// the macro form's `LocalKey::__getit` wrapper showed up under
/// `pthread_getspecific` in next-lint profiles. `#[thread_local]` statics run
/// no destructor, but scopes are balanced, so this slot is `None` by the time
/// a thread exits — except for process-lifetime installs (the package
/// manager's `MiniStore`, the main thread's `store_ast_alloc_heap`), whose
/// threads live until process exit anyway.
#[thread_local]
static AST_ALLOC: Cell<Option<Box<AstAllocState>>> = Cell::new(None);

// One-slot recycler so a per-job `acquire_state`/`release_state` pair doesn't
// pay a 16 KB global malloc each time. Holds a clean state (cursor 0, no
// heap) — an idle worker thread therefore retains 16 KB of buffer and **zero**
// live `mi_heap_t`s between jobs.
//
// Unlike `AST_ALLOC` this is the `thread_local!` macro, which registers a
// destructor: the parked box is a global-heap allocation (only the 8-byte
// pointer lives in TLS), so without a destructor every exiting thread that
// ever parsed JS — e.g. a terminated Web Worker — would leak ~16 KB. The
// `LocalKey` access overhead doesn't matter here: the slot is only touched on
// scope entry/exit, never on the per-allocation hot path. The destructor is
// just a `free` of the box (a released state never holds a spill heap), so it
// is safe at any point during thread teardown.
std::thread_local! {
    static AST_ALLOC_SPARE: Cell<Option<Box<AstAllocState>>> = const { Cell::new(None) };
}

/// Mutable access to the installed state without moving the box out of the
/// thread-local.
///
/// The unbounded lifetime is constrained by the callers: the reference is used
/// for the duration of a single carve / `mi_heap_malloc` and is never held
/// across [`swap_state`] / [`release_state`] / a nested `AstAlloc` call.
#[inline(always)]
fn active_state<'a>() -> Option<&'a mut AstAllocState> {
    // SAFETY: `AST_ALLOC` is thread-local and this module never re-enters
    // itself while a reference returned here is live (mimalloc FFI calls do
    // not call back into Rust), so this is the only reference to the boxed
    // state for its lifetime.
    unsafe { (*AST_ALLOC.as_ptr()).as_deref_mut() }
}

/// Take the recycled spare state for this thread, or allocate a fresh one.
/// The returned state is clean: cursor 0, no spill heap.
#[inline]
pub fn acquire_state() -> Box<AstAllocState> {
    AST_ALLOC_SPARE
        .try_with(Cell::take)
        .ok()
        .flatten()
        .unwrap_or_else(AstAllocState::new_boxed)
}

/// Bulk-free `state`'s allocations ([`AstAllocState::reset`]) and park the
/// clean box in the one-slot recycler for the next [`acquire_state`] on this
/// thread. If the slot is already occupied (or the thread is tearing down and
/// the recycler's destructor has already run) the box is freed instead.
#[inline]
pub fn release_state(mut state: Box<AstAllocState>) {
    state.reset();
    let displaced = AST_ALLOC_SPARE.try_with(|slot| slot.replace(Some(state)));
    // `Err` ⇒ the TLS destructor already ran; `state` was not moved into the
    // slot and is dropped here. `Ok(Some(_))` ⇒ the previous occupant is
    // dropped here.
    drop(displaced);
}

/// Replace the active allocation state, returning the previous occupant.
///
/// `Some(state)` installs `state`; the caller must keep the returned previous
/// occupant and pass it back through `swap_state` when its scope exits (the
/// `prev` chain lives on the call stack, so nested scopes restore correctly).
/// `None` detaches to the global-mimalloc fallback.
#[inline]
pub fn swap_state(state: Option<Box<AstAllocState>>) -> Option<Box<AstAllocState>> {
    AST_ALLOC.replace(state)
}

/// Address of the active state (null when none is installed). For debug
/// assertions that a scope is uninstalling the state it installed; never
/// dereferenced.
#[inline]
pub fn active_state_id() -> *const AstAllocState {
    // SAFETY: see `active_state` — shared read of the thread-local slot.
    unsafe { (*AST_ALLOC.as_ptr()).as_deref() }.map_or(core::ptr::null(), core::ptr::from_ref)
}

/// Bulk-free the *installed* state in place. For owners that keep their state
/// installed across resets (the package manager's `MiniStore`, the main-thread
/// `store_ast_alloc_heap` side module) — they cannot reach the box through
/// their own field while it lives in the thread-local. No-op when no state is
/// installed; the caller is responsible for ensuring the installed state is
/// the one it owns (see [`active_state_id`]).
#[inline]
pub fn reset_active_state() {
    if let Some(state) = active_state() {
        state.reset();
    }
}

/// RAII guard: for its lifetime, [`AstAlloc`] allocates on **global** mimalloc
/// instead of the active per-parse state. Use when constructing
/// `AstVec`/`StoreRef` data that must outlive the current parse arena
/// (e.g. `Expr::deep_clone` for `WorkspacePackageJSONCache`). Without this,
/// the next `ASTMemoryAllocator::reset()` frees buffers the cache still holds.
///
/// Restores the prior state on drop, so it nests correctly inside an
/// `ASTMemoryAllocator` scope.
pub struct DetachAstHeap(Option<Box<AstAllocState>>);
impl DetachAstHeap {
    #[inline]
    pub fn new() -> Self {
        Self(swap_state(None))
    }
}
impl Drop for DetachAstHeap {
    #[inline]
    fn drop(&mut self) {
        let displaced = swap_state(self.0.take());
        debug_assert!(
            displaced.is_none(),
            "AstAlloc scope installed during a DetachAstHeap window was not uninstalled"
        );
    }
}

/// RAII scope that installs a fresh (or recycled) [`AstAllocState`] for its
/// lifetime and bulk-frees everything allocated through it on drop. For
/// callers that want arena-lifetime `AstVec`s without an `ASTMemoryAllocator`
/// (the synchronous module-loader transpile path).
pub struct ScopedAstAlloc {
    prev: Option<Box<AstAllocState>>,
}
impl ScopedAstAlloc {
    #[inline]
    pub fn new() -> Self {
        Self {
            prev: swap_state(Some(acquire_state())),
        }
    }
}
impl Default for ScopedAstAlloc {
    fn default() -> Self {
        Self::new()
    }
}
impl Drop for ScopedAstAlloc {
    #[inline]
    fn drop(&mut self) {
        match swap_state(self.prev.take()) {
            Some(state) => release_state(state),
            None => debug_assert!(
                false,
                "ScopedAstAlloc state was uninstalled by someone else"
            ),
        }
    }
}

/// Zero-sized `Allocator` that routes to the active [`AstAllocState`] when one
/// is installed, else to global mimalloc. `deallocate` is a no-op (the state's
/// owner reclaims everything in bulk).
///
/// Use as `Vec<T, AstAlloc>` (see [`AstVec`]). The ZST means the `Vec` stays
/// 24 bytes — same size as `Vec<T>` — so AST node layouts are unchanged.
#[derive(Clone, Copy, Default)]
pub struct AstAlloc;

/// `Vec` whose backing buffer lives in the thread-local AST allocation state.
pub type AstVec<T> = Vec<T, AstAlloc>;

use crate::alloc_result;

#[inline(always)]
fn heap_alloc(layout: Layout) -> *mut u8 {
    let Some(state) = active_state() else {
        // Global fallback (no AST scope active). `mi_malloc` tolerates
        // `size == 0` (unique non-null pointer), so no special-casing.
        return mimalloc::mi_malloc_auto_align(layout.size(), layout.align()).cast();
    };
    // Small, normally-aligned requests: carve from the state's inline chunk so
    // a burst of tiny `AstVec`s costs zero mallocs (and stays out of
    // `_mi_malloc_generic`). Zero-size layouts and over-aligned ones (no AST
    // list type needs `> MI_MAX_ALIGN_SIZE`) fall through to mimalloc, which
    // handles both.
    if layout.size() != 0
        && layout.size() <= BUMP_MAX
        && layout.align() <= mimalloc::MI_MAX_ALIGN_SIZE
    {
        if let Some(p) = state.bump_alloc(layout.size(), layout.align()) {
            return p;
        }
    }
    // SAFETY: `heap_ptr` returns the live spill heap owned by `state`, which
    // is owned by the thread-local for the duration of this call.
    unsafe {
        mimalloc::mi_heap_malloc_auto_align(state.heap_ptr(), layout.size(), layout.align()).cast()
    }
}

// SAFETY:
// - `allocate`/`grow` return blocks carved from the active state's inline
//   chunk, from `mi_heap_malloc[_aligned]` on its spill heap, or from global
//   `mi_malloc[_aligned]` when no state is installed; all satisfy `layout`.
//   State-owned blocks are bulk-freed when the owner resets/releases the
//   state.
// - `deallocate` is a no-op (permitted: the trait only requires that memory
//   *may* be reclaimed). This preserves the `Expr::Data::clone_in` invariant
//   (two `Vec` headers may alias one buffer; neither frees it). Under the
//   global fallback the buffer leaks until process exit — the documented
//   pre-Strategy-B status quo.
// - `grow` tries `mi_expand` (extend the existing block in place — never moves
//   it, so it stays in whatever heap owns it) *only when `old.size() > BUMP_MAX`*:
//   a smaller block may be a bump-chunk interior pointer (see `heap_alloc`), on
//   which `mi_expand` would corrupt the chunk's bookkeeping. A `> BUMP_MAX`
//   block always came straight from `mi_[heap_]malloc[_aligned]`, so it is
//   sound. Otherwise (and on `mi_expand` failure) `grow` allocates a fresh
//   block + `memcpy` rather than `mi_realloc`: when no state is installed we
//   cannot tell whether `ptr` is a global-fallback `mi_malloc` block head or a
//   bump-chunk interior pointer from a since-exited AST scope on another
//   thread (`BundleV2::clone_ast` does exactly this), so passing it to
//   `mi_realloc` would be unsound. The old block is abandoned (same leak
//   semantics as `deallocate` — and under a state it, like every other block,
//   is reclaimed when the owner resets the state).
// - `allocate_zeroed` is `mi_*zalloc` (skips the redundant `memset` mimalloc
//   would otherwise need over already-zero OS pages); same lifetime as
//   `allocate`.
// - `AstAlloc` is a ZST: every instance is trivially "the same allocator", so
//   the "pointers may be freed by any clone" requirement is satisfied.
// - `Send + Sync` (auto-derived for a fieldless ZST) is sound: each call reads
//   the *calling* thread's `AST_ALLOC`, and allocation is gated to that thread
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
        // `allocate` + `ptr::write_bytes(0)` cannot. Never bump-carved (the
        // chunk is uninitialised); same lifetime semantics as `heap_alloc`.
        // Mirrors `MimallocArena::allocate_zeroed`.
        let p: *mut u8 = match active_state() {
            None => mimalloc::mi_zalloc_auto_align(layout.size(), layout.align()).cast(),
            // SAFETY: `heap_ptr` returns the live spill heap owned by the
            // installed state; see `heap_alloc`.
            Some(state) => unsafe {
                mimalloc::mi_heap_zalloc_auto_align(state.heap_ptr(), layout.size(), layout.align())
                    .cast()
            },
        };
        alloc_result(p, layout.size())
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        // Unconditional no-op — see SAFETY block above and the module doc's
        // `Expr::Data::clone_in` invariant. Under an installed state the block
        // is reclaimed when the owner resets/releases the state; under the
        // global fallback it leaks (cannot prove `ptr`'s provenance).
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
        //  - `old.size() > BUMP_MAX`: smaller blocks may be bump-chunk interior
        //    pointers (see `heap_alloc`), and `mi_expand` on those would treat
        //    the *whole chunk* as the block — corrupting its bookkeeping. A
        //    `> BUMP_MAX` block always came straight from
        //    `mi_[heap_]malloc[_aligned]`, so this is the only safe slice to
        //    use it.
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
        // Not `mi_realloc`: `ptr` may be a bump-chunk interior pointer or a
        // block from another scope's heap (see SAFETY above); the old block is
        // reclaimed when its owning state is reset.
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
