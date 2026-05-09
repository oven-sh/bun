//! Port of `src/bun_alloc/MimallocArena.zig`.
//!
//! A per-heap mimalloc allocator. Unlike `bumpalo::Bump`, every allocation
//! made through this arena is individually freeable (via `mi_free`) and
//! resizable (via `mi_heap_realloc_aligned`), so `Vec<T, &MimallocArena>`
//! does **not** leak the old buffer on grow. `Drop`/`reset()` bulk-free the
//! whole heap with `mi_heap_destroy`, matching Zig's `deinit`.
//!
//! The bumpalo-compatible convenience methods (`alloc`, `alloc_slice_copy`,
//! `alloc_slice_fill_*`, `alloc_str`, `alloc_layout`) are provided so that
//! the `pub type Arena = MimallocArena` swap is mostly source-compatible
//! with the previous `Arena = bumpalo::Bump` alias.

use core::alloc::{AllocError, Allocator, Layout};
use core::ffi::c_void;
use core::mem::{self, MaybeUninit};
use core::ptr::{self, NonNull};
#[cfg(debug_assertions)]
use core::sync::atomic::{AtomicU64, Ordering};

use crate::mimalloc;

// ── Debug-only mi_heap accounting ─────────────────────────────────────────
//
// Tracks `mi_heap_new`/`mi_heap_destroy` calls so leak tests can assert the
// live-heap count is bounded. Gated on `debug_assertions` (zero cost in
// release). The runtime exposes `bun_alloc::live_arena_heaps()` for ad-hoc
// probes; nothing reads these counters in production.
#[cfg(debug_assertions)]
pub static HEAP_NEW_COUNT: core::sync::atomic::AtomicUsize =
    core::sync::atomic::AtomicUsize::new(0);
#[cfg(debug_assertions)]
pub static HEAP_DESTROY_COUNT: core::sync::atomic::AtomicUsize =
    core::sync::atomic::AtomicUsize::new(0);

/// Debug-only: number of live `MimallocArena` heaps (`mi_heap_new` minus
/// `mi_heap_destroy`). Returns 0 in release builds.
#[inline]
pub fn live_arena_heaps() -> usize {
    #[cfg(debug_assertions)]
    {
        HEAP_NEW_COUNT
            .load(core::sync::atomic::Ordering::Relaxed)
            .saturating_sub(HEAP_DESTROY_COUNT.load(core::sync::atomic::Ordering::Relaxed))
    }
    #[cfg(not(debug_assertions))]
    {
        0
    }
}

// ── Debug-only thread-ownership guard (Zig: `bun.safety.ThreadLock`) ──────
//
// `bun_alloc` sits below `bun_core` in the crate graph, so we cannot reuse
// `bun_core::ThreadLock`. This is the minimal subset needed to mirror Zig's
// `ci_assert` same-thread check on the `mi_heap_*` allocation paths: a per-
// thread monotone id stamped at `MimallocArena::new()` and asserted on every
// alloc/realloc. `mi_free` is documented thread-safe and is left unchecked.

#[cfg(debug_assertions)]
#[inline]
fn debug_thread_stamp() -> u64 {
    // Intentionally NOT `bun_threading::current_thread_id()` /
    // `bun_safety::thread_id::current()`: `bun_alloc` is tier-0 and sits below
    // both in the crate graph (they depend on us), so routing there would
    // create a cycle. The contract here is only "any nonzero per-thread-unique
    // u64 for an ownership debug-assert", which a counter satisfies.
    //
    // Portable thread-unique id without `ThreadId::as_u64` (unstable) or
    // platform syscalls: each thread takes a fresh nonzero counter value the
    // first time it asks.
    static NEXT: AtomicU64 = AtomicU64::new(1);
    std::thread_local!(static ID: u64 = NEXT.fetch_add(1, Ordering::Relaxed));
    ID.with(|id| *id)
}

/// A mimalloc heap. Owns a `mi_heap_t`; all allocations are bulk-freed on
/// `Drop` (Zig: `MimallocArena.deinit` → `mi_heap_destroy`).
///
/// Implements [`core::alloc::Allocator`] for `&MimallocArena`, so it can back
/// `Vec<T, &MimallocArena>` / `Box<T, &MimallocArena>` with real per-allocation
/// free + realloc — the thing `bumpalo::Bump` cannot do.
pub struct MimallocArena {
    heap: NonNull<mimalloc::Heap>,
    /// Zig: `thread_lock: bun.safety.ThreadLock` (debug-only). Stamped on
    /// `new()`/`reset()`; asserted on every `mi_heap_*` alloc/realloc path.
    /// Compiles out in release so the struct stays one pointer wide.
    #[cfg(debug_assertions)]
    owning_thread: AtomicU64,
}

// SAFETY: mimalloc heaps are not generally thread-safe for allocation from
// multiple threads, but `mi_free` may be called from any thread, and the
// Zig original guards same-thread use via `ThreadLock` in debug. We expose
// `Send` so an arena can be moved into a worker thread (matching Zig's
// `MimallocArena` being passed to thread-pool workers); concurrent `&self`
// allocation across threads is the caller's responsibility, same as Zig.
unsafe impl Send for MimallocArena {}
// SAFETY: `Sync` is required because the bundler embeds `&MimallocArena` in
// `Send + Sync` contexts (worker tasks hold a shared ref for `mi_free` /
// `owns_ptr`), but `mi_heap_malloc*`/`mi_heap_realloc*` are NOT safe under
// concurrent `&self`. The contract — enforced by `assert_owning_thread()` in
// debug builds, mirroring Zig's `ci_assert` `ThreadLock` — is that only the
// thread that constructed (or last `reset()`) the arena may allocate from it.
// Cross-thread `deallocate` is permitted (mimalloc `mi_free` is thread-safe).
unsafe impl Sync for MimallocArena {}

impl Default for MimallocArena {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl MimallocArena {
    /// Zig: `MimallocArena.init()` — `mi_heap_new() orelse bun.outOfMemory()`.
    #[inline]
    pub fn new() -> Self {
        #[cfg(debug_assertions)]
        HEAP_NEW_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: FFI call with no preconditions.
        let heap = unsafe { mimalloc::mi_heap_new() };
        let heap = NonNull::new(heap).unwrap_or_else(|| crate::out_of_memory());
        Self {
            heap,
            #[cfg(debug_assertions)]
            owning_thread: AtomicU64::new(debug_thread_stamp()),
        }
    }

    /// Zig: `Borrowed.assertThreadLock()` — debug-only check that the calling
    /// thread is the one that constructed (or last `reset()`) this arena.
    /// Guards every `mi_heap_*` allocation path so the over-broad `Sync` impl
    /// cannot silently corrupt mimalloc's per-heap free lists.
    #[inline(always)]
    fn assert_owning_thread(&self) {
        #[cfg(debug_assertions)]
        {
            let owner = self.owning_thread.load(Ordering::Relaxed);
            let cur = debug_thread_stamp();
            debug_assert_eq!(
                owner, cur,
                "MimallocArena: mi_heap_* allocation on thread {cur}, \
                 but heap is owned by thread {owner} (mi_heap is not Sync for alloc)"
            );
        }
    }

    /// Alias for [`Self::new`] — matches the Zig spelling.
    #[inline]
    pub fn init() -> Self {
        Self::new()
    }

    /// Raw `mi_heap_t*` (Zig: `Borrowed.getMimallocHeap`).
    ///
    /// This is the sole accessor for the `heap` field. A `&Heap`-returning
    /// accessor is intentionally **not** provided: `mimalloc::Heap` is an
    /// opaque C handle whose internal state is mutated by every `mi_heap_*`
    /// FFI call (alloc/realloc/free/collect), so holding a `&Heap` across any
    /// such call would alias a mutated pointee. All access goes through the
    /// raw pointer instead.
    ///
    /// SAFETY (invariant): `self.heap` is always a live heap obtained from
    /// `mi_heap_new()` — non-null by `NonNull`, and destroyed exactly once in
    /// `Drop`/`reset()`.
    #[inline]
    pub fn heap_ptr(&self) -> *mut mimalloc::Heap {
        self.heap.as_ptr()
    }

    /// Destroy the current heap (bulk-freeing all live allocations) and
    /// allocate a fresh one. Mirrors `bumpalo::Bump::reset` semantics for
    /// callers that reuse one arena per work item.
    ///
    /// Any pointers previously returned by this arena are invalidated.
    pub fn reset(&mut self) {
        #[cfg(debug_assertions)]
        {
            HEAP_DESTROY_COUNT.fetch_add(1, Ordering::Relaxed);
            HEAP_NEW_COUNT.fetch_add(1, Ordering::Relaxed);
        }
        // SAFETY: `self.heap` was obtained from `mi_heap_new` and has not been
        // destroyed (we own it). After this call all outstanding allocations
        // are freed; replacing `self.heap` with a fresh heap restores the
        // invariant.
        unsafe { mimalloc::mi_heap_destroy(self.heap_ptr()) };
        let heap = unsafe { mimalloc::mi_heap_new() };
        self.heap = NonNull::new(heap).unwrap_or_else(|| crate::out_of_memory());
        // `&mut self` proves exclusive access; re-stamp the debug thread-lock
        // so an arena `Send`-moved to a worker and then reset there may
        // allocate on that worker (Zig has no equivalent because its
        // `MimallocArena` is not moved post-init).
        #[cfg(debug_assertions)]
        self.owning_thread.store(debug_thread_stamp(), Ordering::Relaxed);
    }

    /// Zig: `MimallocArena.gc()` → `mi_heap_collect(heap, false)`.
    #[inline]
    pub fn gc(&self) {
        // SAFETY: `self.heap` is a live heap.
        unsafe { mimalloc::mi_heap_collect(self.heap_ptr(), false) };
    }

    /// Zig: `MimallocArena.helpCatchMemoryIssues()` — debug-only collect of
    /// both this heap and the global mimalloc state to surface UAF early.
    #[inline]
    pub fn help_catch_memory_issues(&self) {
        #[cfg(debug_assertions)]
        {
            self.gc();
            // SAFETY: FFI call with no preconditions.
            unsafe { mimalloc::mi_collect(false) };
        }
    }

    /// `bumpalo::Bump::allocated_bytes` parity — total bytes currently in use
    /// in this heap. Walks the heap's areas (not its individual blocks); cost
    /// is O(areas), which is cheap. Intended for GC `estimatedSize` reporting.
    pub fn allocated_bytes(&self) -> usize {
        extern "C" fn visit(
            _heap: *const mimalloc::Heap,
            area: *const mimalloc::mi_heap_area_t,
            _block: *mut c_void,
            _block_size: usize,
            arg: *mut c_void,
        ) -> bool {
            // SAFETY: mimalloc passes a valid `area` for each heap area when
            // `visit_all_blocks == false`; `arg` is the `&mut usize` we passed.
            unsafe {
                let total = &mut *arg.cast::<usize>();
                *total += (*area).used.saturating_mul((*area).full_block_size);
            }
            true
        }
        let mut total: usize = 0;
        // SAFETY: `self.heap` is live; `visit` upholds the callback contract.
        unsafe {
            mimalloc::mi_heap_visit_blocks(
                self.heap_ptr(),
                false,
                Some(visit),
                (&raw mut total).cast(),
            );
        }
        total
    }

    /// Zig: `MimallocArena.ownsPtr()` → `mi_heap_contains(heap, p)`.
    #[inline]
    pub fn owns_ptr(&self, p: *const c_void) -> bool {
        // SAFETY: `self.heap` is a live heap; `p` may be any pointer.
        unsafe { mimalloc::mi_heap_contains(self.heap_ptr(), p) }
    }

    // ── Zig vtable parity (alloc / resize / remap / free) ────────────────

    /// Zig: `Borrowed.alignedAlloc` — uses `mi_heap_malloc_aligned` only when
    /// `alignment > MI_MAX_ALIGN_SIZE`, otherwise the cheaper `mi_heap_malloc`.
    #[inline]
    fn aligned_alloc(&self, len: usize, align: usize) -> *mut u8 {
        self.assert_owning_thread();
        let heap = self.heap_ptr();
        // SAFETY: `heap` is live.
        let p = unsafe {
            if mimalloc::must_use_aligned_alloc(align) {
                mimalloc::mi_heap_malloc_aligned(heap, len, align)
            } else {
                mimalloc::mi_heap_malloc(heap, len)
            }
        };
        #[cfg(debug_assertions)]
        if !p.is_null() {
            // SAFETY: `p` was just returned by mimalloc.
            let usable = unsafe { mimalloc::mi_malloc_usable_size(p) };
            debug_assert!(
                usable >= len,
                "mimalloc: allocated size is too small: {usable} < {len}"
            );
        }
        p.cast()
    }

    /// Zig: `vtable_resize` — in-place expand/shrink, no relocation.
    /// Returns `true` if the block now has at least `new_len` bytes.
    #[inline]
    pub fn resize_in_place(&self, ptr: NonNull<u8>, new_len: usize) -> bool {
        // SAFETY: `ptr` was allocated by mimalloc (caller contract).
        unsafe { !mimalloc::mi_expand(ptr.as_ptr().cast(), new_len).is_null() }
    }

    /// Zig: `vtable_remap` — `mi_heap_realloc_aligned`.
    #[inline]
    pub fn remap(&self, ptr: NonNull<u8>, new_len: usize, align: usize) -> *mut u8 {
        self.assert_owning_thread();
        // SAFETY: `self.heap` is live; `ptr` was allocated by this heap (or by
        // any mimalloc heap — `mi_free`/realloc accept cross-heap pointers).
        unsafe {
            mimalloc::mi_heap_realloc_aligned(self.heap_ptr(), ptr.as_ptr().cast(), new_len, align)
                .cast()
        }
    }

    // ── bumpalo-compatible surface ───────────────────────────────────────
    // These exist so `pub type Arena = MimallocArena` is source-compatible
    // with the previous `Arena = bumpalo::Bump` alias. They allocate from
    // this heap and hand back `&'arena mut` borrows; memory is reclaimed on
    // `reset()`/`Drop` (or earlier via the `Allocator` impl's `deallocate`).

    /// `bumpalo::Bump::alloc_layout` parity.
    #[inline]
    pub fn alloc_layout(&self, layout: Layout) -> NonNull<u8> {
        let p = self.aligned_alloc(layout.size(), layout.align());
        NonNull::new(p).unwrap_or_else(|| crate::out_of_memory())
    }

    /// `bumpalo::Bump::alloc` parity — move `val` into the arena.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn alloc<T>(&self, val: T) -> &mut T {
        let p = self.alloc_layout(Layout::new::<T>()).cast::<T>();
        // SAFETY: `p` is non-null, properly aligned, and points to at least
        // `size_of::<T>()` uninitialized bytes owned by this arena.
        unsafe {
            p.as_ptr().write(val);
            &mut *p.as_ptr()
        }
    }

    /// `bumpalo::Bump::alloc_str` parity.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn alloc_str(&self, s: &str) -> &mut str {
        let bytes = self.alloc_slice_copy(s.as_bytes());
        // SAFETY: copied from valid UTF-8.
        unsafe { core::str::from_utf8_unchecked_mut(bytes) }
    }

    /// `bumpalo::Bump::alloc_slice_copy` parity.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn alloc_slice_copy<T: Copy>(&self, src: &[T]) -> &mut [T] {
        let layout = Layout::for_value(src);
        let dst = self.alloc_layout(layout).cast::<T>();
        // SAFETY: `dst` is freshly allocated, aligned for `T`, sized for
        // `src.len()` elements; ranges do not overlap.
        unsafe {
            ptr::copy_nonoverlapping(src.as_ptr(), dst.as_ptr(), src.len());
            core::slice::from_raw_parts_mut(dst.as_ptr(), src.len())
        }
    }

    /// `bumpalo::Bump::alloc_slice_clone` parity.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn alloc_slice_clone<T: Clone>(&self, src: &[T]) -> &mut [T] {
        self.alloc_slice_fill_iter(src.iter().cloned())
    }

    /// `bumpalo::Bump::alloc_slice_fill_default` parity.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn alloc_slice_fill_default<T: Default>(&self, len: usize) -> &mut [T] {
        self.alloc_slice_fill_with(len, |_| T::default())
    }

    /// `bumpalo::Bump::alloc_slice_fill_copy` parity.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn alloc_slice_fill_copy<T: Copy>(&self, len: usize, value: T) -> &mut [T] {
        self.alloc_slice_fill_with(len, |_| value)
    }

    /// `bumpalo::Bump::alloc_slice_fill_with` parity.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn alloc_slice_fill_with<T, F>(&self, len: usize, mut f: F) -> &mut [T]
    where
        F: FnMut(usize) -> T,
    {
        let layout = Layout::array::<T>(len).unwrap_or_else(|_| crate::out_of_memory());
        let dst = self.alloc_layout(layout).cast::<T>();
        // SAFETY: `dst` is aligned for `T` and sized for `len` elements. We
        // initialize every slot before forming the slice. If `f` panics the
        // partially-initialized prefix leaks into the arena (reclaimed on
        // `reset`/`Drop`) — same behavior as bumpalo.
        unsafe {
            for i in 0..len {
                dst.as_ptr().add(i).write(f(i));
            }
            core::slice::from_raw_parts_mut(dst.as_ptr(), len)
        }
    }

    /// `bumpalo::Bump::alloc_slice_fill_iter` parity.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn alloc_slice_fill_iter<T, I>(&self, iter: I) -> &mut [T]
    where
        I: IntoIterator<Item = T>,
        I::IntoIter: ExactSizeIterator,
    {
        let mut iter = iter.into_iter();
        let len = iter.len();
        self.alloc_slice_fill_with(len, |_| {
            iter.next().expect("ExactSizeIterator under-reported length")
        })
    }

    /// Allocate an uninitialized `[MaybeUninit<T>; len]` slice.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn alloc_uninit_slice<T>(&self, len: usize) -> &mut [MaybeUninit<T>] {
        let layout = Layout::array::<T>(len).unwrap_or_else(|_| crate::out_of_memory());
        let dst = self.alloc_layout(layout).cast::<MaybeUninit<T>>();
        // SAFETY: `MaybeUninit<T>` has the same layout as `T` and imposes no
        // initialization invariant.
        unsafe { core::slice::from_raw_parts_mut(dst.as_ptr(), len) }
    }

    // ── StdAllocator vtable bridge (Zig: `heap_allocator_vtable`) ────────

    /// Zig: `MimallocArena.arena()` — erase to the fat `{ptr, vtable}`
    /// `StdAllocator` so this arena can flow through code that still threads
    /// the Zig-style allocator handle.
    #[inline]
    pub fn std_allocator(&self) -> crate::StdAllocator {
        crate::StdAllocator {
            ptr: self.heap_ptr().cast(),
            vtable: &HEAP_ALLOCATOR_VTABLE,
        }
    }

    /// Zig: `MimallocArena.isInstance` — does `alloc` dispatch through one of
    /// this module's vtables (per-heap or process-global mimalloc)?
    #[inline]
    pub fn is_instance(alloc: &crate::StdAllocator) -> bool {
        core::ptr::eq(alloc.vtable, &raw const HEAP_ALLOCATOR_VTABLE)
            || core::ptr::eq(alloc.vtable, &raw const GLOBAL_MIMALLOC_VTABLE)
    }

    /// Zig: `MimallocArena.getThreadLocalDefault()` — a `StdAllocator` that
    /// routes through the process-wide `mi_malloc`/`mi_free` (no per-heap ctx).
    /// In mimalloc v3 these are already thread-local-fast, so there is no
    /// separate per-thread default heap to cache.
    #[inline]
    pub fn get_thread_local_default() -> crate::StdAllocator {
        crate::StdAllocator { ptr: core::ptr::null_mut(), vtable: &GLOBAL_MIMALLOC_VTABLE }
    }
}

impl Drop for MimallocArena {
    #[inline]
    fn drop(&mut self) {
        #[cfg(debug_assertions)]
        HEAP_DESTROY_COUNT.fetch_add(1, Ordering::Relaxed);
        // Zig: `deinit` → `mi_heap_destroy`. Destroys the heap and bulk-frees
        // every block still allocated in it without running per-block free.
        // SAFETY: `self.heap` is a live heap obtained from `mi_heap_new` and
        // is destroyed exactly once here.
        unsafe { mimalloc::mi_heap_destroy(self.heap_ptr()) };
    }
}

// ── core::alloc::Allocator ────────────────────────────────────────────────
//
// Implemented on `&MimallocArena` (not the owned value) so that
// `Vec<T, &'a MimallocArena>` borrows the arena for `'a` — matching
// `bumpalo`'s `&'bump Bump: Allocator` shape and the `ArenaVec<'a, T>` alias.

// SAFETY: every pointer returned by `allocate` comes from
// `mi_heap_malloc[_aligned]` on `self.heap`, which yields a block of at least
// `layout.size()` bytes aligned to `layout.align()`. `deallocate` forwards to
// `mi_free`, which accepts any mimalloc-owned pointer regardless of which heap
// allocated it (Zig's `vtable_free` relies on the same property). `grow`/
// `shrink` use `mi_heap_realloc_aligned`, which preserves the
// `min(old, new)` prefix. Cloned `&MimallocArena` handles refer to the same
// heap, satisfying the "any clone may free" requirement.
unsafe impl Allocator for &MimallocArena {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        // mimalloc tolerates size==0 (returns a unique non-null pointer), so
        // no special-casing needed.
        let p = self.aligned_alloc(layout.size(), layout.align());
        match NonNull::new(p) {
            Some(p) => Ok(NonNull::slice_from_raw_parts(p, layout.size())),
            None => Err(AllocError),
        }
    }

    #[inline]
    fn allocate_zeroed(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        self.assert_owning_thread();
        let heap = self.heap_ptr();
        // SAFETY: `heap` is live.
        let p = unsafe {
            if mimalloc::must_use_aligned_alloc(layout.align()) {
                mimalloc::mi_heap_zalloc_aligned(heap, layout.size(), layout.align())
            } else {
                mimalloc::mi_heap_zalloc(heap, layout.size())
            }
        };
        match NonNull::new(p.cast::<u8>()) {
            Some(p) => Ok(NonNull::slice_from_raw_parts(p, layout.size())),
            None => Err(AllocError),
        }
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, _layout: Layout) {
        // Zig: `vtable_free` → `mi_free` (debug builds assert
        // `mi_is_in_heap_region` + sized free; release just `mi_free`).
        #[cfg(debug_assertions)]
        // SAFETY: caller contract — `ptr` came from this allocator.
        unsafe {
            debug_assert!(mimalloc::mi_is_in_heap_region(ptr.as_ptr().cast()));
            if mimalloc::must_use_aligned_alloc(_layout.align()) {
                mimalloc::mi_free_size_aligned(ptr.as_ptr().cast(), _layout.size(), _layout.align());
            } else {
                mimalloc::mi_free_size(ptr.as_ptr().cast(), _layout.size());
            }
        }
        #[cfg(not(debug_assertions))]
        // SAFETY: caller contract — `ptr` came from this allocator.
        unsafe {
            mimalloc::mi_free(ptr.as_ptr().cast());
        }
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        _old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        self.assert_owning_thread();
        // SAFETY: caller contract — `ptr` was allocated by this allocator with
        // `_old`; `new.size() >= _old.size()`.
        let p = unsafe {
            mimalloc::mi_heap_realloc_aligned(
                self.heap_ptr(),
                ptr.as_ptr().cast(),
                new.size(),
                new.align(),
            )
        };
        match NonNull::new(p.cast::<u8>()) {
            Some(p) => Ok(NonNull::slice_from_raw_parts(p, new.size())),
            None => Err(AllocError),
        }
    }

    #[inline]
    unsafe fn grow_zeroed(
        &self,
        ptr: NonNull<u8>,
        _old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        self.assert_owning_thread();
        // SAFETY: see `grow`.
        let p = unsafe {
            mimalloc::mi_heap_rezalloc_aligned(
                self.heap_ptr(),
                ptr.as_ptr().cast(),
                new.size(),
                new.align(),
            )
        };
        match NonNull::new(p.cast::<u8>()) {
            Some(p) => Ok(NonNull::slice_from_raw_parts(p, new.size())),
            None => Err(AllocError),
        }
    }

    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        _old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        self.assert_owning_thread();
        // SAFETY: see `grow`; `new.size() <= _old.size()`.
        let p = unsafe {
            mimalloc::mi_heap_realloc_aligned(
                self.heap_ptr(),
                ptr.as_ptr().cast(),
                new.size(),
                new.align(),
            )
        };
        match NonNull::new(p.cast::<u8>()) {
            Some(p) => Ok(NonNull::slice_from_raw_parts(p, new.size())),
            None => Err(AllocError),
        }
    }
}

// ── StdAllocator vtable (Zig: `heap_allocator_vtable`) ───────────────────

unsafe fn vtable_alloc(ctx: *mut c_void, len: usize, a: crate::Alignment, _ra: usize) -> *mut u8 {
    let heap = ctx.cast::<mimalloc::Heap>();
    // SAFETY: `ctx` is the `mi_heap_t*` stashed by `std_allocator()`.
    unsafe {
        if mimalloc::must_use_aligned_alloc(a.to_byte_units()) {
            mimalloc::mi_heap_malloc_aligned(heap, len, a.to_byte_units()).cast()
        } else {
            mimalloc::mi_heap_malloc(heap, len).cast()
        }
    }
}

unsafe fn vtable_resize(
    _ctx: *mut c_void,
    buf: &mut [u8],
    _a: crate::Alignment,
    new_len: usize,
    _ra: usize,
) -> bool {
    // SAFETY: `buf` was allocated by mimalloc (caller contract).
    unsafe { !mimalloc::mi_expand(buf.as_mut_ptr().cast(), new_len).is_null() }
}

unsafe fn vtable_remap(
    ctx: *mut c_void,
    buf: &mut [u8],
    a: crate::Alignment,
    new_len: usize,
    _ra: usize,
) -> *mut u8 {
    let heap = ctx.cast::<mimalloc::Heap>();
    // SAFETY: see `vtable_alloc`.
    unsafe {
        mimalloc::mi_heap_realloc_aligned(heap, buf.as_mut_ptr().cast(), new_len, a.to_byte_units())
            .cast()
    }
}

unsafe fn vtable_free(_ctx: *mut c_void, buf: &mut [u8], _a: crate::Alignment, _ra: usize) {
    // Zig: `vtable_free` — `mi_free_size` internally just asserts the size, so
    // it's faster in release if we don't pass it through, but the assertion is
    // worth having in debug.
    // SAFETY: `buf` was allocated by mimalloc with the recorded len/alignment
    // (Allocator vtable invariant); `mi_is_in_heap_region` accepts any pointer.
    #[cfg(debug_assertions)]
    unsafe {
        debug_assert!(mimalloc::mi_is_in_heap_region(buf.as_ptr().cast()));
        if mimalloc::must_use_aligned_alloc(_a.to_byte_units()) {
            mimalloc::mi_free_size_aligned(buf.as_mut_ptr().cast(), buf.len(), _a.to_byte_units());
        } else {
            mimalloc::mi_free_size(buf.as_mut_ptr().cast(), buf.len());
        }
    }
    #[cfg(not(debug_assertions))]
    unsafe {
        mimalloc::mi_free(buf.as_mut_ptr().cast());
    }
}

/// Zig: `heap_allocator_vtable` — per-heap (`mi_heap_*`) thunks; ctx is the
/// `mi_heap_t*` stashed by `std_allocator()`.
pub static HEAP_ALLOCATOR_VTABLE: crate::AllocatorVTable = crate::AllocatorVTable {
    alloc: vtable_alloc,
    resize: vtable_resize,
    remap: vtable_remap,
    free: vtable_free,
};

// ── Global-mimalloc vtable (Zig: `global_mimalloc_vtable`) ───────────────
// Process-wide `mi_malloc`/`mi_free` — no heap ctx. Used by
// `get_thread_local_default()` / `Default::allocator()`.

unsafe fn global_vtable_alloc(
    _ctx: *mut c_void,
    len: usize,
    a: crate::Alignment,
    _ra: usize,
) -> *mut u8 {
    // SAFETY: FFI — len/alignment passed by value; mimalloc returns null on OOM.
    unsafe {
        if mimalloc::must_use_aligned_alloc(a.to_byte_units()) {
            mimalloc::mi_malloc_aligned(len, a.to_byte_units()).cast()
        } else {
            mimalloc::mi_malloc(len).cast()
        }
    }
}

unsafe fn global_vtable_resize(
    _ctx: *mut c_void,
    buf: &mut [u8],
    _a: crate::Alignment,
    new_len: usize,
    _ra: usize,
) -> bool {
    // SAFETY: `buf` was allocated by mimalloc (caller contract).
    unsafe { !mimalloc::mi_expand(buf.as_mut_ptr().cast(), new_len).is_null() }
}

unsafe fn global_vtable_remap(
    _ctx: *mut c_void,
    buf: &mut [u8],
    a: crate::Alignment,
    new_len: usize,
    _ra: usize,
) -> *mut u8 {
    // SAFETY: `buf` was allocated by mimalloc (caller contract).
    unsafe {
        mimalloc::mi_realloc_aligned(buf.as_mut_ptr().cast(), new_len, a.to_byte_units()).cast()
    }
}

/// Zig: `global_mimalloc_vtable`.
pub static GLOBAL_MIMALLOC_VTABLE: crate::AllocatorVTable = crate::AllocatorVTable {
    alloc: global_vtable_alloc,
    resize: global_vtable_resize,
    remap: global_vtable_remap,
    free: vtable_free,
};

/// Both vtable addresses this module hands out, for
/// `bun_safety::register_alloc_vtable` (so `has_ptr` recognises either form;
/// see `is_instance` above which checks both).
#[inline]
pub fn std_vtables() -> [&'static crate::AllocatorVTable; 2] {
    [&HEAP_ALLOCATOR_VTABLE, &GLOBAL_MIMALLOC_VTABLE]
}

// ── ArenaVec helpers ─────────────────────────────────────────────────────
// `std::vec::Vec<T, A>` lacks `from_iter_in` / `into_bump_slice*`; provide
// thin shims so call sites that used `bumpalo::collections::Vec` keep working.

/// `bumpalo::collections::Vec::from_iter_in` parity for `Vec<T, &MimallocArena>`.
#[inline]
pub fn vec_from_iter_in<'a, T, I>(iter: I, arena: &'a MimallocArena) -> Vec<T, &'a MimallocArena>
where
    I: IntoIterator<Item = T>,
{
    let iter = iter.into_iter();
    let (lo, _) = iter.size_hint();
    let mut v = Vec::with_capacity_in(lo, arena);
    v.extend(iter);
    v
}

/// `bumpalo::collections::String` parity — a UTF-8 buffer backed by the arena.
/// Thin newtype over `Vec<u8, &'a MimallocArena>` so `write!` works and
/// `into_bump_str()` leaks into the arena.
pub struct ArenaString<'a> {
    buf: Vec<u8, &'a MimallocArena>,
}

impl<'a> ArenaString<'a> {
    #[inline]
    pub fn new_in(arena: &'a MimallocArena) -> Self {
        Self { buf: Vec::new_in(arena) }
    }
    #[inline]
    pub fn with_capacity_in(cap: usize, arena: &'a MimallocArena) -> Self {
        Self { buf: Vec::with_capacity_in(cap, arena) }
    }
    #[inline]
    pub fn from_str_in(s: &str, arena: &'a MimallocArena) -> Self {
        let mut buf = Vec::with_capacity_in(s.len(), arena);
        buf.extend_from_slice(s.as_bytes());
        Self { buf }
    }
    #[inline]
    pub fn push_str(&mut self, s: &str) {
        self.buf.extend_from_slice(s.as_bytes());
    }
    #[inline]
    pub fn as_str(&self) -> &str {
        // SAFETY: `buf` is only ever extended via `push_str`/`write_str`, both
        // of which append UTF-8.
        unsafe { core::str::from_utf8_unchecked(&self.buf) }
    }
    #[inline]
    pub fn as_bytes(&self) -> &[u8] {
        &self.buf
    }
    #[inline]
    pub fn len(&self) -> usize {
        self.buf.len()
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }
    /// `bumpalo::collections::String::into_bump_str` parity.
    #[inline]
    pub fn into_bump_str(self) -> &'a str {
        let bytes = self.buf.into_bump_slice();
        // SAFETY: see `as_str`.
        unsafe { core::str::from_utf8_unchecked(bytes) }
    }
}

impl core::fmt::Write for ArenaString<'_> {
    #[inline]
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        self.buf.extend_from_slice(s.as_bytes());
        Ok(())
    }
}

impl core::ops::Deref for ArenaString<'_> {
    type Target = str;
    #[inline]
    fn deref(&self) -> &str {
        self.as_str()
    }
}

/// Extension methods on `Vec<T, &MimallocArena>` to cover the
/// `bumpalo::collections::Vec` API gaps.
pub trait ArenaVecExt<'a, T> {
    /// `bumpalo::collections::Vec::from_iter_in` parity.
    fn from_iter_in<I: IntoIterator<Item = T>>(iter: I, arena: &'a MimallocArena) -> Self;
    /// `bumpalo::collections::Vec::into_bump_slice` parity — leaks into the
    /// arena (reclaimed on `reset`/`Drop`).
    fn into_bump_slice(self) -> &'a [T];
    /// `bumpalo::collections::Vec::into_bump_slice_mut` parity.
    fn into_bump_slice_mut(self) -> &'a mut [T];
    /// `bumpalo::collections::Vec::bump` parity — recover the backing arena.
    fn bump(&self) -> &'a MimallocArena;
}

impl<'a, T> ArenaVecExt<'a, T> for Vec<T, &'a MimallocArena> {
    #[inline]
    fn from_iter_in<I: IntoIterator<Item = T>>(iter: I, arena: &'a MimallocArena) -> Self {
        vec_from_iter_in(iter, arena)
    }
    #[inline]
    fn into_bump_slice(self) -> &'a [T] {
        let mut me = mem::ManuallyDrop::new(self);
        let len = me.len();
        let ptr = me.as_mut_ptr();
        // SAFETY: storage is owned by the arena and lives for `'a`; we forgo
        // `Vec`'s drop so the arena reclaims it on `reset`/`Drop`.
        unsafe { core::slice::from_raw_parts(ptr, len) }
    }
    #[inline]
    fn into_bump_slice_mut(self) -> &'a mut [T] {
        let mut me = mem::ManuallyDrop::new(self);
        let len = me.len();
        let ptr = me.as_mut_ptr();
        // SAFETY: see `into_bump_slice`.
        unsafe { core::slice::from_raw_parts_mut(ptr, len) }
    }
    #[inline]
    fn bump(&self) -> &'a MimallocArena {
        *self.allocator()
    }
}

// ported from: src/bun_alloc/MimallocArena.zig
