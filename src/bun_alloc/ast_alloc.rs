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

/// Largest allocation served from the inline bump chunk; above this, requests
/// go straight to the spill heap.
const BUMP_MAX: usize = 512;

/// Inline bump chunk size. No refill — once full, small allocations fall
/// through to the spill heap.
const BUMP_CHUNK: usize = 16 * 1024;

pub struct AstAllocState {
    /// Offset of the next free byte in `bump_chunk`.
    bump_cursor: usize,
    spill: *mut mimalloc::Heap,
    /// Backing storage for `spill` when no borrowed target was provided.
    owned_spill: Option<MimallocArena>,
    /// Inline small-allocation buffer.
    bump_chunk: [MaybeUninit<u8>; BUMP_CHUNK],
}

impl AstAllocState {
    /// Allocate a clean state without materialising 16 KB on the stack.
    fn new_boxed() -> Box<Self> {
        let mut boxed = Box::<Self>::new_uninit();
        let p = boxed.as_mut_ptr();
        // SAFETY: the header fields are written before `assume_init`;
        // `bump_chunk` is `MaybeUninit` and may stay uninitialised.
        unsafe {
            (&raw mut (*p).bump_cursor).write(0);
            (&raw mut (*p).spill).write(core::ptr::null_mut());
            (&raw mut (*p).owned_spill).write(None);
            boxed.assume_init()
        }
    }

    /// Bulk-free everything allocated through this state. Any pointer
    /// previously returned by [`AstAlloc`] under this state is invalidated.
    #[inline]
    pub fn reset(&mut self) {
        self.bump_cursor = 0;
        self.spill = core::ptr::null_mut();
        self.owned_spill = None;
    }

    /// Point spill allocations at `heap` (the installing scope's arena), which
    /// must outlive the installed window. Called on every install so an arena
    /// reset between installs is picked up.
    #[inline]
    pub fn set_spill_heap(&mut self, heap: *mut mimalloc::Heap) {
        debug_assert!(
            self.owned_spill.is_none(),
            "AstAllocState: switching an owned spill heap to a borrowed one would strand its contents"
        );
        self.spill = heap;
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

    /// The state's spill `mi_heap_t`: the borrowed target installed by
    /// [`Self::set_spill_heap`], or a lazily created owned heap when none was
    /// provided.
    #[inline]
    fn heap_ptr(&mut self) -> *mut mimalloc::Heap {
        if !self.spill.is_null() {
            return self.spill;
        }
        let heap = self.owned_spill.insert(MimallocArena::new()).heap_ptr();
        self.spill = heap;
        heap
    }
}

// ── Thread-local active state ────────────────────────────────────────────────

#[thread_local]
static AST_ALLOC: Cell<Option<Box<AstAllocState>>> = Cell::new(None);

std::thread_local! {
    static AST_ALLOC_SPARE: Cell<Option<Box<AstAllocState>>> = const { Cell::new(None) };
}

/// Mutable access to the installed state without moving the box out of the
/// thread-local.
#[inline(always)]
fn active_state<'a>() -> Option<&'a mut AstAllocState> {
    // SAFETY: `AST_ALLOC` is thread-local and this module never re-enters
    // itself while the returned reference is live, so this is the only
    // reference to the boxed state for its lifetime.
    unsafe { (*AST_ALLOC.as_ptr()).as_deref_mut() }
}

/// Take the recycled spare state for this thread, or allocate a fresh one.
#[inline]
pub fn acquire_state() -> Box<AstAllocState> {
    AST_ALLOC_SPARE
        .try_with(Cell::take)
        .ok()
        .flatten()
        .unwrap_or_else(AstAllocState::new_boxed)
}

/// Bulk-free `state`'s allocations and park the clean box in the recycler.
/// If the slot is occupied (or the thread is tearing down) the box is freed.
#[inline]
pub fn release_state(mut state: Box<AstAllocState>) {
    state.reset();
    drop(AST_ALLOC_SPARE.try_with(|slot| slot.replace(Some(state))));
}

/// Replace the active allocation state, returning the previous occupant. The
/// caller passes the previous occupant back when its scope exits; `None`
/// detaches to the global-mimalloc fallback.
#[inline]
pub fn swap_state(state: Option<Box<AstAllocState>>) -> Option<Box<AstAllocState>> {
    AST_ALLOC.replace(state)
}

/// Address of the active state (null when none is installed). Identity checks
/// only; never dereferenced.
#[inline]
pub fn active_state_id() -> *const AstAllocState {
    // SAFETY: see `active_state` — shared read of the thread-local slot.
    unsafe { (*AST_ALLOC.as_ptr()).as_deref() }.map_or(core::ptr::null(), core::ptr::from_ref)
}

/// Bulk-free the *installed* state in place. For owners that keep their state
/// installed across resets and so cannot reach the box through their own
/// field. No-op when no state is installed.
#[inline]
pub fn reset_active_state() {
    if let Some(state) = active_state() {
        state.reset();
    }
}

/// [`AstAllocState::set_spill_heap`] on the *installed* state. No-op when no
/// state is installed.
#[inline]
pub fn set_active_spill_heap(heap: *mut mimalloc::Heap) {
    if let Some(state) = active_state() {
        state.set_spill_heap(heap);
    }
}

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
/// callers that want arena-lifetime `AstVec`s without an `ASTMemoryAllocator`.
pub struct ScopedAstAlloc {
    prev: Option<Box<AstAllocState>>,
}
impl ScopedAstAlloc {
    /// Install a state whose spill allocations land in `spill_heap`, which
    /// must stay live (and not be reset) for the guard's entire lifetime.
    #[inline]
    pub fn with_spill(spill_heap: *mut mimalloc::Heap) -> Self {
        let mut state = acquire_state();
        state.set_spill_heap(spill_heap);
        Self {
            prev: swap_state(Some(state)),
        }
    }

    /// Install a state with a lazily created owned spill heap.
    #[inline]
    pub fn new() -> Self {
        Self {
            prev: swap_state(Some(acquire_state())),
        }
    }

    #[inline]
    pub fn take_state(self) -> Option<Box<AstAllocState>> {
        let mut this = core::mem::ManuallyDrop::new(self);
        let installed = swap_state(this.prev.take());
        debug_assert!(
            installed.is_some(),
            "ScopedAstAlloc state was uninstalled by someone else"
        );
        installed
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

    #[inline]
    pub fn vec_from_iter<T, I: IntoIterator<Item = T>>(iter: I) -> AstVec<T> {
        let iter = iter.into_iter();
        let (lo, _) = iter.size_hint();
        let mut v = Vec::with_capacity_in(lo, AstAlloc);
        v.extend(iter);
        v
    }
}

impl AstAlloc {
    /// `core::mem::take` for [`AstVec`] (whose `Default` impl is blocked by
    /// orphan rules). Replaces `*v` with an empty vec and returns the old
    /// contents.
    #[inline]
    pub fn take<T>(v: &mut AstVec<T>) -> AstVec<T> {
        core::mem::replace(v, Vec::new_in(AstAlloc))
    }
}
