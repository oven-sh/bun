//! Arena allocator for AST-interior `Vec`s and node payloads.
//!
//! [`AstArena`] owns one AST-allocation scope's storage: a `MimallocArena` for
//! node payloads and a 16 KB inline bump chunk for the tiny `AstVec`s the
//! parser builds by the thousand. It is installed into the thread-local
//! [`ACTIVE`] slot via [`AstArena::enter`], which returns an [`AstScope`]
//! RAII guard; for the guard's lifetime the zero-sized [`AstAlloc`] routes
//! `allocate`/`grow` to that arena.
//!
//! `AstAlloc::deallocate` is a **no-op**: everything allocated through it is
//! bulk-freed when the owning `AstArena` is `reset()` or dropped. This
//! preserves the `Expr::Data::clone_in` invariant
//! (`src/js_parser/ast/Expr.rs:2178`): payloads are `core::ptr::read`-copied
//! under the assumption "no `Drop`, no owned heap state". Two
//! `Vec<_, AstAlloc>` headers may therefore alias the same buffer; neither
//! ever frees it.
//!
//! Placed in `bun_alloc` (not `js_parser`) so that `bun_ast::ExprNodeList` and
//! `bun_collections::VecExt` — both below `js_parser` in the crate graph — can
//! name `Vec<T, AstAlloc>`.

use core::alloc::{AllocError, Allocator, Layout};
use core::cell::{Cell, UnsafeCell};
use core::marker::{PhantomData, PhantomPinned};
use core::mem::MaybeUninit;
use core::pin::Pin;
use core::ptr::{self, NonNull};

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

/// Pinned interior of an [`AstArena`]. [`ACTIVE`] holds a `*const Self`.
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

    /// As [`Self::reset`], but retains the warm `mi_heap` when its footprint is
    /// under `limit` (see [`MimallocArena::reset_retain_with_limit`]). The bump
    /// chunk is always rewound.
    fn reset_retain_with_limit(self: Pin<&mut Self>, limit: usize) {
        // SAFETY: neither field is structurally pinned; we hold `&mut`.
        let this = unsafe { self.get_unchecked_mut() };
        this.arena.reset_retain_with_limit(limit);
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

    /// Install this arena as the thread's active AST allocator for the
    /// returned guard's lifetime. The guard mutably borrows `self`, so the
    /// arena cannot be reset/dropped/re-entered while it is installed, and
    /// restores the previously-installed arena on drop (scopes nest).
    #[inline]
    pub fn enter(&mut self) -> AstScope<'_> {
        let prev = ACTIVE.replace(ptr::from_ref(self.inner()));
        AstScope {
            prev,
            _arena: PhantomData,
        }
    }

    /// A zero-sized [`AstAlloc`] handle. Allocates into whichever arena is
    /// installed in the calling thread's [`ACTIVE`] slot (see
    /// [`Self::enter`]); the value itself carries no state.
    #[inline]
    pub fn alloc(&self) -> AstAlloc {
        AstAlloc
    }

    /// Bulk-free everything allocated through any `AstAlloc` from this arena
    /// (node payloads and `AstVec` buffers alike). Every live `AstAlloc`
    /// handle and every pointer they returned is invalidated.
    pub fn reset(&mut self) {
        self.inner_mut().reset();
    }

    /// As [`Self::reset`], but keeps the backing `mi_heap` warm while its
    /// footprint is within `limit` bytes — see
    /// [`MimallocArena::reset_retain_with_limit`] for the cap semantics. All
    /// outstanding `AstAlloc` pointers are invalidated either way.
    pub fn reset_retain_with_limit(&mut self, limit: usize) {
        self.inner_mut().reset_retain_with_limit(limit);
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
        // Clean, then park for the next `AstArena::new()` on this thread. Any
        // previous occupant of the slot is dropped (`mi_heap_destroy`); if the
        // thread is tearing down (`try_with` fails), `inner` is dropped.
        inner.as_mut().reset();
        let _ = POOL.try_with(|slot| {
            slot.set(Some(inner));
        });
    }
}

// ── Thread-local active arena ───────────────────────────────────────────────

/// The [`AstArenaInner`] currently installed on this thread, or null when no
/// `AstScope` is active (allocations then fall back to global mimalloc).
///
/// `#[thread_local]` (not `thread_local!`): read on every `AstAlloc`
/// allocation, so it must stay a bare `__thread` slot — one `mov` off `fs:`,
/// no lazy-init/dtor probe.
#[thread_local]
static ACTIVE: Cell<*const AstArenaInner> = Cell::new(ptr::null());

/// RAII guard returned by [`AstArena::enter`]. Restores the thread's
/// previously-installed arena on drop. Mutably borrows the `AstArena` it
/// installed, so the borrow checker enforces that the arena outlives the
/// scope and is not reset or re-entered while installed.
pub struct AstScope<'a> {
    prev: *const AstArenaInner,
    _arena: PhantomData<&'a mut AstArena>,
}

impl Drop for AstScope<'_> {
    #[inline]
    fn drop(&mut self) {
        ACTIVE.set(self.prev);
    }
}

/// Mutable access to the installed arena's allocation state.
///
/// SAFETY: single-threaded contract (one parse thread mutates its arena).
/// Callers must not hold the returned `&mut` across any other call that
/// reaches this same state (no re-entrancy inside this module). `None` when
/// no `AstScope` is active.
#[inline(always)]
fn active_state<'a>() -> Option<&'a mut AstAllocState> {
    let inner = ACTIVE.get();
    if inner.is_null() {
        return None;
    }
    // SAFETY: `inner` points into a pinned `AstArenaInner` whose `AstScope`
    // holds a live `&mut AstArena`; the `UnsafeCell` is mutated only here.
    Some(unsafe { &mut *UnsafeCell::raw_get(&raw const (*inner).state) })
}

/// Release-build fallback for [`AstAlloc::arena`] when no [`AstScope`] is
/// active: wraps `mi_heap_main()` (see [`MimallocArena::borrowing_default`]),
/// so node payloads allocate via global mimalloc and leak at process exit
/// instead of null-derefing. Debug builds still assert.
static FALLBACK_ARENA: std::sync::OnceLock<MimallocArena> = std::sync::OnceLock::new();

/// The installed arena's node-payload heap, or the process-global
/// [`FALLBACK_ARENA`] when no [`AstScope`] is active (release-build leak
/// instead of UB; debug builds assert).
#[inline(always)]
fn active_arena<'a>() -> &'a MimallocArena {
    let inner = ACTIVE.get();
    if inner.is_null() {
        debug_assert!(
            false,
            "AstAlloc used with no AstScope active (call AstArena::enter first)"
        );
        return FALLBACK_ARENA.get_or_init(MimallocArena::borrowing_default);
    }
    // SAFETY: non-null ⇒ a live `AstScope` holds `&mut AstArena`, whose pinned
    // interior `inner` points at.
    unsafe { &(*inner).arena }
}

// ── AstAlloc ────────────────────────────────────────────────────────────────

/// Zero-sized `Allocator` that routes to the thread's installed [`AstArena`]
/// (see [`AstArena::enter`]). `deallocate` is a no-op (the owning arena
/// bulk-frees on `reset`/drop).
///
/// Use as `Vec<T, AstAlloc>` (see [`AstVec`]). The ZST means the `Vec` stays
/// 24 bytes — same size as `Vec<T>` — so AST node layouts are unchanged.
#[derive(Clone, Copy, Default)]
pub struct AstAlloc;

/// `Vec` whose backing buffer lives in the thread's installed [`AstArena`].
pub type AstVec<T> = Vec<T, AstAlloc>;

const _: () = assert!(core::mem::size_of::<AstVec<u8>>() == 24);

/// Arena-owned box. `AstAlloc::deallocate` is a no-op, so storing the
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
    /// The `MimallocArena` node-payload storage of the installed arena.
    #[inline]
    pub fn arena(self) -> &'static MimallocArena {
        // SAFETY: the `'static` is the same lifetime erasure `StoreRef` uses
        // (valid until the owning `AstArena` is dropped/reset).
        unsafe { &*ptr::from_ref(active_arena()) }
    }

    /// Allocate `value` in the node-payload arena and return a stable `&mut`
    /// into it (what `Expr`/`Stmt` payloads wrap in a `StoreRef`).
    #[inline]
    pub fn store<T>(self, value: T) -> &'static mut T {
        // SAFETY: `arena()` is live for the scope's lifetime; `alloc` returns
        // a fresh `&mut T` in it. `'static` per the `StoreRef` convention.
        unsafe { &mut *ptr::from_mut(self.arena().alloc(value)) }
    }

    /// Copy `bytes` into the installed arena so the slice shares the AST's
    /// lifetime.
    #[inline]
    pub fn dupe_str(self, bytes: &[u8]) -> &'static [u8] {
        let mut v = Self::vec_with_capacity::<u8>(bytes.len());
        v.extend_from_slice(bytes);
        v.leak()
    }

    /// See [`AstBox`] for the drop-safety contract.
    #[inline]
    pub fn boxed<T>(self, value: T) -> AstBox<T> {
        AstBox(NonNull::from(self.arena().alloc(value)))
    }
}

use crate::alloc_result;

#[inline(always)]
fn heap_alloc(layout: Layout) -> *mut u8 {
    let Some(state) = active_state() else {
        // No `AstScope` active: fall back to global mimalloc. The block leaks
        // at process exit (`deallocate` is a no-op).
        return mimalloc::mi_malloc_auto_align(layout.size(), layout.align()).cast();
    };
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

// SAFETY:
// - `allocate`/`grow` return blocks carved from the installed arena's inline
//   chunk or from `mi_heap_malloc[_aligned]` on its spill heap (or from
//   global `mi_malloc` under the no-scope fallback); all satisfy `layout`
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
// - `allocate_zeroed` is `mi_*zalloc` (skips the redundant `memset` over
//   already-zero OS pages); same lifetime as `allocate`.
// - `AstAlloc` is a ZST: every instance is trivially "the same allocator", so
//   the "pointers may be freed by any clone" requirement is satisfied.
// - `Send + Sync` (auto-derived for a fieldless ZST) is sound: each call reads
//   the *calling* thread's `ACTIVE` slot, and allocation is gated to that
//   thread by `MimallocArena::assert_owning_thread`. The no-op `deallocate`
//   removes the only cross-thread hazard a `Vec<_,A>: Send` would otherwise
//   introduce.
unsafe impl Allocator for AstAlloc {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        alloc_result(heap_alloc(layout), layout.size())
    }

    #[inline]
    fn allocate_zeroed(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        // Never bump-carved (the chunk is uninitialised).
        let p: *mut u8 = match active_state() {
            None => mimalloc::mi_zalloc_auto_align(layout.size(), layout.align()).cast(),
            // SAFETY: `spill` is the live sibling `MimallocArena` heap.
            Some(state) => unsafe {
                mimalloc::mi_heap_zalloc_auto_align(state.spill, layout.size(), layout.align())
                    .cast()
            },
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
        // Keep the existing slot: it already holds `>= new.size()` bytes at
        // `>= old.align()` alignment.
        debug_assert!(new.align() <= old.align());
        let _ = old;
        Ok(NonNull::slice_from_raw_parts(ptr, new.size()))
    }
}

// ── AstVec / AstBox construction ─────────────────────────────────────────────

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

    /// `<[T]>::to_vec` parity.
    #[inline]
    pub fn vec_from_slice<T: Clone>(items: &[T]) -> AstVec<T> {
        let mut v = Vec::with_capacity_in(items.len(), AstAlloc);
        v.extend_from_slice(items);
        v
    }

    /// Collect `iter` into an `AstVec`.
    #[inline]
    pub fn vec_from_iter<T, I: IntoIterator<Item = T>>(iter: I) -> AstVec<T> {
        let iter = iter.into_iter();
        let (lo, _) = iter.size_hint();
        let mut v = Vec::with_capacity_in(lo, AstAlloc);
        v.extend(iter);
        v
    }

    /// `core::mem::take` for [`AstVec`] (whose `Default` impl is blocked by
    /// orphan rules). Replaces `*v` with an empty vec and returns the old
    /// contents.
    #[inline]
    pub fn take<T>(v: &mut AstVec<T>) -> AstVec<T> {
        core::mem::replace(v, Vec::new_in(AstAlloc))
    }
}

/// See [`AstBox`] for the drop-safety contract.
#[inline]
pub fn ast_box<T>(value: T) -> AstBox<T> {
    AstAlloc.boxed(value)
}
