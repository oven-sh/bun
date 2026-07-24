//! Arena allocator for AST-interior `Vec`s and node payloads.
//!
//! [`AstArena`] owns one AST-allocation scope's storage: a `MimallocArena` for
//! node payloads and a 16 KB inline bump chunk for the tiny `AstVec`s the
//! parser builds by the thousand. It hands out [`AstAlloc`] handles (a `Copy`
//! pointer into its pinned interior) which implement `core::alloc::Allocator`
//! for `Vec<T, AstAlloc>` / `Box<T, AstAlloc>`.
//!
//! `AstAlloc::deallocate` is a **no-op**: everything allocated through a
//! handle is bulk-freed when the owning `AstArena` is `reset()` or dropped.
//! This preserves the `Expr::Data::clone_in` invariant
//! (`src/js_parser/ast/Expr.rs:2178`): payloads are `core::ptr::read`-copied
//! under the assumption "no `Drop`, no owned heap state". Two
//! `Vec<_, AstAlloc>` headers may therefore alias the same buffer; neither
//! ever frees it.
//!
//! The arena is a **passed value** (not ambient thread-local state): whoever
//! owns the parse owns an `AstArena`, threads its `AstAlloc` handle into the
//! parser/visitor/builder, and later moves the `AstArena` together with the
//! AST it backs (e.g. into `parse_task::Success`) so the bundler's
//! cross-thread handoff is a compiler-checked move.
//!
//! Placed in `bun_alloc` (not `js_parser`) so that `bun_ast::ExprNodeList` and
//! `bun_collections::VecExt` — both below `js_parser` in the crate graph — can
//! name `Vec<T, AstAlloc>`.

use core::alloc::{AllocError, Allocator, Layout};
use core::cell::{Cell, UnsafeCell};
use core::marker::PhantomPinned;
use core::mem::MaybeUninit;
use core::pin::Pin;
use core::ptr::NonNull;

use crate::{MimallocArena, mimalloc};

/// Largest allocation served from the inline bump chunk; above this, requests
/// go straight to the spill heap.
const BUMP_MAX: usize = 512;

/// Inline bump chunk size. No refill: once full, small allocations fall
/// through to the spill heap.
const BUMP_CHUNK: usize = 16 * 1024;

/// Per-arena allocation state for [`AstAlloc`]: the inline bump chunk for
/// small `AstVec`s plus a pointer to the spill `mi_heap_t` (the owning
/// [`AstArena`]'s `MimallocArena`).
struct AstAllocState {
    /// Offset of the next free byte in `bump_chunk`.
    bump_cursor: usize,
    /// Spill target for allocations the chunk can't serve. Points at the
    /// sibling `AstArenaInner::arena`'s heap; both live in the same pinned
    /// box, so this is always valid while the arena exists.
    spill: *mut mimalloc::Heap,
    /// Inline small-allocation buffer.
    bump_chunk: [MaybeUninit<u8>; BUMP_CHUNK],
}

impl AstAllocState {
    /// Carve `size` bytes at `align` (a power of two `<= MI_MAX_ALIGN_SIZE`)
    /// from the inline chunk. `None` when it doesn't fit; there is no refill,
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
}

// ── AstArena ────────────────────────────────────────────────────────────────

/// Pinned interior of an [`AstArena`]. [`AstAlloc`] is `NonNull<Self>`.
pub struct AstArenaInner {
    /// `UnsafeCell`: `Allocator::allocate` takes `&self` but must advance
    /// `bump_cursor`. Single-threaded contract (see `assert_owning_thread`).
    state: UnsafeCell<AstAllocState>,
    /// Node-payload storage. The `state.spill` pointer targets this heap.
    arena: MimallocArena,
    _pin: PhantomPinned,
}

/// Owns one AST-allocation scope's storage. See the module doc.
///
/// `Option` so `Drop` can move the inner into the thread pool; it is `Some`
/// everywhere else (`inner()`/`inner_mut()` unwrap unconditionally).
pub struct AstArena(Option<Pin<Box<AstArenaInner>>>);

const _: () = assert!(
    core::mem::size_of::<AstArena>() == core::mem::size_of::<usize>(),
    "Option<Pin<Box<_>>> niche"
);

// SAFETY: the interior is accessed single-threadedly (asserted by
// `MimallocArena::assert_owning_thread` on every allocation), and `AstArena`
// is moved across threads only together with the AST it backs, before any
// reader touches it. The raw `spill` pointer targets the sibling `arena`
// field inside the same pinned box.
unsafe impl Send for AstArena {}

// ── Per-thread arena pool ───────────────────────────────────────────────────
// Recycle one `AstArenaInner` per thread so a per-module `AstArena::new()` /
// `drop` pair doesn't pay a fresh `mi_heap_new` + first-segment page faults
// every file. Touched only on `new`/`drop`, never on the allocation hot path.
// `thread_local!` (not bare `#[thread_local]`) so the destructor frees a
// parked box at thread exit.
std::thread_local! {
    static POOL: Cell<Option<Pin<Box<AstArenaInner>>>> = const { Cell::new(None) };
}

impl AstArenaInner {
    /// Allocate a clean inner without materialising 16 KB on the stack.
    fn new_pinned() -> Pin<Box<Self>> {
        let mut boxed = Box::<Self>::new_uninit();
        let p = boxed.as_mut_ptr();
        // SAFETY: the header fields are written before `assume_init`;
        // `bump_chunk` is `MaybeUninit` and may stay uninitialised.
        let inner = unsafe {
            (&raw mut (*p).arena).write(MimallocArena::new());
            let state = UnsafeCell::raw_get(&raw const (*p).state);
            (&raw mut (*state).bump_cursor).write(0);
            (&raw mut (*state).spill).write((*p).arena.heap_ptr());
            (&raw mut (*p)._pin).write(PhantomPinned);
            boxed.assume_init()
        };
        Box::into_pin(inner)
    }

    /// Bulk-free everything allocated through any `AstAlloc` into this arena
    /// and rewind the bump chunk. Every such pointer is invalidated.
    fn reset(self: Pin<&mut Self>) {
        // SAFETY: neither field is structurally pinned; we hold `&mut`.
        let this = unsafe { self.get_unchecked_mut() };
        this.arena.reset();
        let state = this.state.get_mut();
        state.bump_cursor = 0;
        state.spill = this.arena.heap_ptr();
    }
}

impl AstArena {
    /// Take a recycled arena from this thread's pool, or allocate a fresh one.
    pub fn new() -> Self {
        Self(Some(
            POOL.try_with(Cell::take)
                .ok()
                .flatten()
                .unwrap_or_else(AstArenaInner::new_pinned),
        ))
    }

    #[inline]
    fn inner(&self) -> &AstArenaInner {
        // SAFETY: `Some` everywhere outside `Drop`.
        unsafe { self.0.as_deref().unwrap_unchecked() }
    }

    #[inline]
    fn inner_mut(&mut self) -> Pin<&mut AstArenaInner> {
        // SAFETY: `Some` everywhere outside `Drop`.
        unsafe { self.0.as_mut().unwrap_unchecked().as_mut() }
    }

    /// The [`AstAlloc`] handle that routes allocations into this arena. `Copy`;
    /// valid until `self` is dropped or [`Self::reset`] is called.
    #[inline]
    pub fn alloc(&self) -> AstAlloc {
        AstAlloc(NonNull::from(self.inner()))
    }

    /// Bulk-free everything allocated through any `AstAlloc` from this arena
    /// (node payloads and `AstVec` buffers alike). Every live `AstAlloc`
    /// handle and every pointer they returned is invalidated.
    pub fn reset(&mut self) {
        self.inner_mut().reset();
    }

    /// The backing `MimallocArena` for node payloads (`StoreRef<T>` targets).
    #[inline]
    pub fn arena(&self) -> &MimallocArena {
        &self.inner().arena
    }
}

impl Default for AstArena {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for AstArena {
    fn drop(&mut self) {
        let Some(mut inner) = self.0.take() else {
            return;
        };
        // Clean, then park for the next `AstArena::new()` on this thread. If
        // the slot is already occupied (nested scopes) or the thread is
        // tearing down, the box is dropped here (`mi_heap_destroy`).
        inner.as_mut().reset();
        let _ = POOL.try_with(|slot| {
            if slot.take().is_none() {
                slot.set(Some(inner));
            }
        });
    }
}

// ── AstAlloc ────────────────────────────────────────────────────────────────

/// `Copy` handle into an [`AstArena`]'s pinned interior. Implements
/// `core::alloc::Allocator`; `deallocate` is a no-op (the owning arena
/// bulk-frees on `reset`/drop).
///
/// Use as `Vec<T, AstAlloc>` (see [`AstVec`]). Carries one pointer, so the
/// `Vec` is 32 bytes.
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct AstAlloc(NonNull<AstArenaInner>);

// SAFETY: `AstAlloc` is a raw pointer into a pinned box. `Send`/`Sync` let an
// `AstVec` sit in a `Send` AST that moves with its owning `AstArena`; the
// no-op `deallocate` removes the only cross-thread hazard a `Vec<_,A>: Send`
// would otherwise introduce, and allocation is gated to one thread by
// `MimallocArena::assert_owning_thread`.
unsafe impl Send for AstAlloc {}
// SAFETY: see the `Send` impl.
unsafe impl Sync for AstAlloc {}

/// `Vec` whose backing buffer lives in an [`AstArena`].
pub type AstVec<T> = Vec<T, AstAlloc>;

/// Arena-owned box. `AstAlloc::deallocate` is a no-op, so storing the 8-byte
/// allocator handle alongside the pointer (as `Box<T, AstAlloc>` would) buys
/// nothing: a bare `NonNull<T>` is behaviourally identical and keeps
/// size-sensitive embedders (`Symbol.namespace_alias`) at one word. As with
/// any arena-backed value, **`T::drop` is not guaranteed to run**: a `T` that
/// owns a global-heap allocation, refcount, or fd will leak it.
#[repr(transparent)]
pub struct AstBox<T: ?Sized>(NonNull<T>);

const _: () = assert!(core::mem::size_of::<Option<AstBox<u8>>>() == core::mem::size_of::<usize>());

// SAFETY: same contract as `StoreRef` (arena-backed raw pointer; moved only
// together with the owning `AstArena`).
unsafe impl<T: ?Sized + Send> Send for AstBox<T> {}
// SAFETY: see the `Send` impl.
unsafe impl<T: ?Sized + Sync> Sync for AstBox<T> {}

impl<T: ?Sized> core::ops::Deref for AstBox<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: points into a live `AstArena` for the box's documented
        // lifetime (arena ownership; see the type doc).
        unsafe { self.0.as_ref() }
    }
}
impl<T: ?Sized> core::ops::DerefMut for AstBox<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: exclusive access to the arena slot for the borrow's
        // duration (single-threaded AST visitor contract).
        unsafe { self.0.as_mut() }
    }
}
impl<T: ?Sized> AstBox<T> {
    #[inline]
    pub fn as_ptr(&self) -> *mut T {
        self.0.as_ptr()
    }
}

impl AstAlloc {
    /// Mutable access to the arena's allocation state.
    ///
    /// SAFETY: single-threaded contract (one parse thread mutates its arena).
    /// Callers must not hold the returned `&mut` across any other call that
    /// reaches this same state (no re-entrancy inside this module).
    #[inline(always)]
    unsafe fn state(self) -> *mut AstAllocState {
        // SAFETY: `self.0` points into a live pinned `AstArenaInner` for the
        // handle's documented lifetime.
        unsafe { UnsafeCell::raw_get(&raw const (*self.0.as_ptr()).state) }
    }

    #[inline(always)]
    fn heap_alloc(self, layout: Layout) -> *mut u8 {
        // SAFETY: see `state`; no re-entrancy below.
        let state = unsafe { &mut *self.state() };
        // Small, normally-aligned requests: carve from the inline chunk so a
        // burst of tiny `AstVec`s costs zero mallocs. Zero-size and
        // over-aligned layouts fall through to mimalloc, which handles both.
        if layout.size() != 0
            && layout.size() <= BUMP_MAX
            && layout.align() <= mimalloc::MI_MAX_ALIGN_SIZE
        {
            if let Some(p) = state.bump_alloc(layout.size(), layout.align()) {
                return p;
            }
        }
        // SAFETY: `spill` points at the sibling `MimallocArena`'s live heap
        // (set in `AstArenaInner::{new_pinned, reset}`).
        unsafe {
            mimalloc::mi_heap_malloc_auto_align(state.spill, layout.size(), layout.align()).cast()
        }
    }

    /// The `MimallocArena` node-payload storage this handle routes to.
    #[inline]
    pub fn arena(self) -> &'static MimallocArena {
        // SAFETY: `self.0` points into a live pinned `AstArenaInner`; the
        // `'static` is the same lifetime erasure `StoreRef` uses (valid until
        // the owning `AstArena` is dropped/reset).
        unsafe { &(*self.0.as_ptr()).arena }
    }

    /// Allocate `value` in the node-payload arena and return a stable `&mut`
    /// into it (what `Expr`/`Stmt` payloads wrap in a `StoreRef`).
    #[inline]
    pub fn store<T>(self, value: T) -> &'static mut T {
        // SAFETY: `arena()` is live for the handle's lifetime; `alloc` returns
        // a fresh `&mut T` in it. `'static` per the `StoreRef` convention.
        unsafe { &mut *core::ptr::from_mut(self.arena().alloc(value)) }
    }

    /// Copy `bytes` into this arena so the slice shares the AST's lifetime.
    #[inline]
    pub fn dupe_str(self, bytes: &[u8]) -> &'static [u8] {
        let mut v = self.vec_with_capacity::<u8>(bytes.len());
        v.extend_from_slice(bytes);
        v.leak()
    }
}

use crate::alloc_result;

// SAFETY:
// - `allocate`/`grow` return blocks carved from the arena's inline chunk or
//   from `mi_heap_malloc[_aligned]` on its spill heap; all satisfy `layout`
//   and are bulk-freed when the owning `AstArena` is reset/dropped.
// - `deallocate` is a no-op (permitted: the trait only requires that memory
//   *may* be reclaimed). This preserves the `Expr::Data::clone_in` invariant
//   (two `Vec` headers may alias one buffer; neither frees it).
// - `grow` tries `mi_expand` (extend the existing block in place; never moves
//   it, so it stays in whatever heap owns it) *only when
//   `old.size() > BUMP_MAX`*: a smaller block may be a bump-chunk interior
//   pointer, on which `mi_expand` would corrupt the chunk's bookkeeping.
//   Otherwise `grow` allocates a fresh block + `memcpy`; the old block is
//   abandoned (reclaimed on arena reset).
// - `allocate_zeroed` is `mi_heap_zalloc` (skips the redundant `memset` over
//   already-zero OS pages); same lifetime as `allocate`.
// - Every `AstAlloc` with the same `NonNull` is "the same allocator", so the
//   "pointers may be freed by any clone" requirement is satisfied.
unsafe impl Allocator for AstAlloc {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        alloc_result(self.heap_alloc(layout), layout.size())
    }

    #[inline]
    fn allocate_zeroed(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        // Never bump-carved (the chunk is uninitialised).
        // SAFETY: see `heap_alloc`.
        let state = unsafe { &mut *self.state() };
        // SAFETY: `spill` is the live sibling `MimallocArena` heap.
        let p: *mut u8 = unsafe {
            mimalloc::mi_heap_zalloc_auto_align(state.spill, layout.size(), layout.align()).cast()
        };
        alloc_result(p, layout.size())
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        let _ = (ptr, layout);
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // Fast path: mimalloc rounds every allocation up to a size class, so
        // the block behind `ptr` frequently already has room for `new.size()`.
        // `mi_expand` reports that without moving the block.
        //
        // Gated on `old.size() > BUMP_MAX` (smaller blocks may be bump-chunk
        // interior pointers; `mi_expand` on those would corrupt the chunk) and
        // `new.align() <= old.align()` (the block was aligned for `old`;
        // `mi_expand` cannot raise that, and `Vec<T>` never changes alignment
        // across grows).
        if old.size() > BUMP_MAX && new.align() <= old.align() {
            // SAFETY: `ptr` is a live block from this allocator (the `grow`
            // contract) and, given `old.size() > BUMP_MAX`, a real mimalloc
            // block head.
            if let Some(p) = NonNull::new(unsafe {
                mimalloc::mi_expand(ptr.as_ptr().cast(), new.size()).cast::<u8>()
            }) {
                return Ok(NonNull::slice_from_raw_parts(p, new.size()));
            }
        }
        // Slow path: allocate-new (possibly bump-carved) + copy + abandon-old.
        let p = NonNull::new(self.heap_alloc(new)).ok_or(AllocError)?;
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
        // Keep the existing slot: it already holds `>= new.size()` bytes at
        // `>= old.align()` alignment.
        debug_assert!(new.align() <= old.align());
        let _ = old;
        Ok(NonNull::slice_from_raw_parts(ptr, new.size()))
    }
}

// ── AstVec / AstBox construction ─────────────────────────────────────────────

impl AstAlloc {
    /// `Vec::new_in(self)`.
    #[inline]
    pub const fn vec<T>(self) -> AstVec<T> {
        Vec::new_in(self)
    }

    /// `Vec::with_capacity_in(cap, self)`.
    #[inline]
    pub fn vec_with_capacity<T>(self, cap: usize) -> AstVec<T> {
        Vec::with_capacity_in(cap, self)
    }

    /// `<[T]>::to_vec` into this arena.
    #[inline]
    pub fn vec_from_slice<T: Clone>(self, items: &[T]) -> AstVec<T> {
        let mut v = Vec::with_capacity_in(items.len(), self);
        v.extend_from_slice(items);
        v
    }

    /// Collect `iter` into an `AstVec`.
    #[inline]
    pub fn vec_from_iter<T, I: IntoIterator<Item = T>>(self, iter: I) -> AstVec<T> {
        let iter = iter.into_iter();
        let (lo, _) = iter.size_hint();
        let mut v = Vec::with_capacity_in(lo, self);
        v.extend(iter);
        v
    }

    /// `core::mem::take` for [`AstVec`] (whose `Default` impl is blocked by
    /// orphan rules). Replaces `*v` with an empty vec backed by `self` and
    /// returns the old contents.
    #[inline]
    pub fn take<T>(self, v: &mut AstVec<T>) -> AstVec<T> {
        core::mem::replace(v, Vec::new_in(self))
    }

    /// Re-point `v`'s allocator to `self` so subsequent growth allocates into
    /// this arena instead of the one `v` was created in. The existing buffer
    /// stays in place; `deallocate` is a no-op, so nothing is freed, and
    /// `grow`'s copy-then-abandon path moves the data into `self` on the next
    /// reallocation.
    ///
    /// Used when a vec created on one thread's arena must be grown on another
    /// (e.g. the bundler's parallel `do_step5` growing parser-built
    /// `part.dependencies`): routing growth through the calling thread's
    /// arena avoids a data race on the original arena's `bump_cursor`.
    #[inline]
    pub fn adopt_vec<T>(self, v: &mut AstVec<T>) {
        let old = core::mem::ManuallyDrop::new(core::mem::replace(v, Vec::new_in(self)));
        // SAFETY: `ptr/len/cap` are the live header just taken from `*v`.
        // `AstAlloc::deallocate` is a no-op, so handing the buffer to a
        // different `AstAlloc` cannot double-free it; `grow` either
        // `mi_expand`s the block in place (heap-agnostic) or allocates fresh
        // in `self` and abandons the old block.
        *v = unsafe {
            Vec::from_raw_parts_in(old.as_ptr().cast_mut(), old.len(), old.capacity(), self)
        };
    }

    /// See [`AstBox`] for the drop-safety contract.
    #[inline]
    pub fn boxed<T>(self, value: T) -> AstBox<T> {
        AstBox(NonNull::from(self.arena().alloc(value)))
    }
}

/// Free-function form of [`AstAlloc::boxed`].
#[inline]
pub fn ast_box<T>(alloc: AstAlloc, value: T) -> AstBox<T> {
    alloc.boxed(value)
}
