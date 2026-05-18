//! Port of `src/bun_alloc/MimallocArena.zig`.
//!
//! A per-heap mimalloc allocator. Unlike `bumpalo::Bump`, every allocation
//! made through this arena is individually freeable (via `mi_free`) and
//! resizable (via `mi_heap_realloc_aligned`), so `Vec<T, &MimallocArena>`
//! does **not** leak the old buffer on grow. `Drop`/`reset()` bulk-free the
//! whole heap with `mi_heap_destroy`, matching Zig's `deinit`.
//
// PERF NOTE: a previous iteration layered a bump-chunk allocator and a cached
// `mi_theap_t*` here. Reverted: the theap is per-OS-thread while
// `MimallocArena: Send`, and the bump layer caused #53599's UAF when mimalloc
// recycled a destroyed `mi_heap_t*` slot. Zig parity is plain `mi_heap_malloc`.
// If `_mi_heap_theap` thrash resurfaces in profiles, the supported fix is
// `mi_heap_set_default(heap)` for the parse scope, not manual theap caching.
//!
//! The bumpalo-compatible convenience methods (`alloc`, `alloc_slice_copy`,
//! `alloc_slice_fill_*`, `alloc_str`, `alloc_layout`) are provided so that
//! the `pub type Arena = MimallocArena` swap is mostly source-compatible
//! with the previous `Arena = bumpalo::Bump` alias.

use core::alloc::{AllocError, Allocator, Layout};
use core::ffi::c_void;
use core::mem::MaybeUninit;
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
    /// `true` when `heap` came from `mi_heap_new()` and must be
    /// `mi_heap_destroy`ed on `Drop`/`reset()`. `false` when borrowing the
    /// process-wide `mi_heap_main()` (see [`Self::borrowing_default`]) — Drop
    /// is then a no-op and allocations live for the process lifetime, matching
    /// Zig's `default_allocator` shape for callers that just need an `&Arena`
    /// without paying `mi_heap_new` + `mi_heap_destroy`.
    owns: bool,
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
            owns: true,
            #[cfg(debug_assertions)]
            owning_thread: AtomicU64::new(debug_thread_stamp()),
        }
    }

    /// Borrow the process-wide default mimalloc heap (`mi_heap_main()`) instead
    /// of creating a fresh one. `Drop` is a no-op; `reset()` is forbidden.
    /// Allocations made through this arena are equivalent to global
    /// `mi_malloc`/`mi_free` and live until individually freed (or process
    /// exit for `into_bump_slice`-style leaks).
    ///
    /// Use this where Zig threads `bun.default_allocator` through an
    /// `Allocator`-shaped parameter and the Rust port needs an `&Arena` but
    /// the `mi_heap_new` + `mi_heap_destroy` pair is measurable overhead on a
    /// hot, short-lived path (e.g. `Bunfig::parse` on `bun -e ''` startup).
    #[inline]
    pub fn borrowing_default() -> Self {
        // SAFETY: FFI call with no preconditions; `mi_heap_main()` returns the
        // always-live process main heap (never null after mimalloc init).
        let heap = unsafe { mimalloc::mi_heap_main() };
        let heap = NonNull::new(heap).unwrap_or_else(|| crate::out_of_memory());
        Self {
            heap,
            owns: false,
            #[cfg(debug_assertions)]
            // `mi_heap_main()` is safe to allocate from on any thread, so the
            // owning-thread assert is disabled by stamping 0 — see
            // `assert_owning_thread`.
            owning_thread: AtomicU64::new(0),
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
            // 0 = `borrowing_default()`: `mi_heap_main()` alloc is thread-safe,
            // so skip the same-thread check.
            if owner == 0 {
                return;
            }
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
    ///
    /// `#[cold]` + `#[inline(never)]`: `mi_heap_destroy` does per-page
    /// free-list/bitmap teardown (and, when mimalloc's stats are compiled in,
    /// an `_mi_stats_merge_from` walk over `mi_stats_t`), so this is the slow
    /// path. The hot path is `reset_retain_with_limit`'s retain branch — keep
    /// that lean by not letting this body inline up into it.
    #[cold]
    #[inline(never)]
    pub fn reset(&mut self) {
        debug_assert!(
            self.owns,
            "MimallocArena::reset() on a borrowing_default() arena — would destroy mi_heap_main()"
        );
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
        self.owning_thread
            .store(debug_thread_stamp(), Ordering::Relaxed);
    }

    /// Zig: `std.heap.ArenaAllocator.reset(.{.retain_with_limit = limit})`.
    ///
    /// Retains the warm heap while its in-use footprint is `<= limit`, and
    /// only then falls back to a full [`Self::reset`] (`mi_heap_destroy` +
    /// `mi_heap_new`). Returns `true` when the heap was retained, `false` when
    /// it was recycled — mirroring `ArenaAllocator.reset`'s "reuse succeeded"
    /// boolean.
    ///
    /// **Why this isn't a no-op-or-full-reset.** Zig's `std.heap.ArenaAllocator`
    /// is a bump allocator: `.retain_with_limit` rewinds the bump cursor to
    /// offset 0 (logically freeing every allocation) but keeps up to `limit`
    /// bytes of *backing buffer* committed, so the next cycle's allocations
    /// reuse those warm pages instead of faulting in (and zeroing) fresh ones.
    /// A `mi_heap_t` has no "free all blocks but keep the pages" primitive —
    /// the only bulk-free is `mi_heap_destroy`, which also hands the pages back
    /// to mimalloc (which may purge/decommit them). So the faithful mapping is
    /// "keep the *whole* heap — blocks and all — while it is still small;
    /// recycle it once it grows past `limit`". The retained blocks are dead
    /// (arena callers never `mi_free`; `AstAlloc::deallocate` is a no-op by
    /// design), so they *are* garbage — but `limit` bounds that garbage, and
    /// in exchange the per-cycle `mi_heap_destroy` + `mi_heap_new` (and the
    /// re-commit + memset its first allocation pays when mimalloc has since
    /// purged the arena page) is amortised away for the common case of many
    /// small cycles. `limit` is the RSS/CPU knob: a tighter cap trades warm
    /// pages for lower steady-state RSS; a looser one does the reverse.
    ///
    /// (An earlier port made this an unconditional `reset()` on the theory
    /// that mimalloc's per-thread segment cache already keeps pages warm
    /// across `mi_heap_destroy`/`mi_heap_new`. In practice, with a lower RSS
    /// ceiling and mimalloc's purge timer, the recycled page is often already
    /// decommitted by the time the next cycle touches it, so the round-trip
    /// re-commits and re-zeroes it — exactly the cost `.retain_with_limit`
    /// exists to avoid. Hence the cap-gated retain.)
    ///
    /// **Why `mi_heap_collect` is not an alternative to the cap.** When the
    /// caller's allocations are individually freed before the cycle ends (most
    /// `Vec<T, &MimallocArena>` users — the bundler, renamer, installer), the
    /// heap footprint is already near zero at this point, so the limit is never
    /// hit and the heap is retained for free. The one caller where the limit
    /// *does* fire is the transpiler's per-module AST arena (`jsc_hooks`): it
    /// also backs `AstAlloc`, whose `deallocate` is a deliberate no-op (the AST
    /// graph is abandoned, not freed), so that heap's footprint only ever
    /// grows. `mi_heap_collect(force=true)` cannot reclaim it — it returns only
    /// *empty* pages, and the dead AST blocks pin every page. The only bulk
    /// reclaim is `mi_heap_destroy` (the `reset()` path). So for that caller the
    /// `limit` is purely a "how much dead AST do we tolerate before paying a
    /// `mi_heap_destroy`" knob; raising it trades steady-state RSS for fewer
    /// destroys per transpile batch.
    #[inline]
    pub fn reset_retain_with_limit(&mut self, limit: usize) -> bool {
        // `borrowing_default()` arenas (`!owns`) wrap `mi_heap_main()`, whose
        // footprint is the whole process — they always fall through to
        // `reset()`, which debug-asserts `owns` (recycling the main heap is a
        // bug). `allocated_bytes()` walks heap *areas* (O(areas)), so the
        // check is cheap.
        if self.owns && self.allocated_bytes() <= limit {
            // `&mut self` proves exclusive access; re-stamp the debug
            // thread-lock so an arena `Send`-moved to a worker and then
            // retain-reset there may keep allocating on that worker — same as
            // the full-reset path below (`reset()` re-stamps after
            // `mi_heap_new`).
            #[cfg(debug_assertions)]
            self.owning_thread
                .store(debug_thread_stamp(), Ordering::Relaxed);
            return true;
        }
        self.reset();
        false
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
            mimalloc::mi_collect(false);
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

    /// Zig: `Borrowed.alignedAlloc` — `mi_heap_malloc[_aligned]` on this
    /// arena's heap.
    #[inline]
    fn aligned_alloc(&self, len: usize, align: usize) -> *mut u8 {
        self.assert_owning_thread();
        // SAFETY: `self.heap_ptr()` is live (`mi_heap_new()` or
        // `mi_heap_main()`, see struct invariant).
        unsafe { heap_alloc_maybe_aligned(self.heap_ptr(), len, align) }
    }

    /// Zig: `vtable_resize` — in-place expand/shrink, no relocation.
    /// Returns `true` if the block now has at least `new_len` bytes.
    #[inline]
    pub fn resize_in_place(&self, ptr: NonNull<u8>, _old_len: usize, new_len: usize) -> bool {
        // SAFETY: `ptr` was allocated by this arena (caller contract), and is
        // therefore a real mimalloc block head.
        unsafe { !mimalloc::mi_expand(ptr.as_ptr().cast(), new_len).is_null() }
    }

    /// `mi_heap_realloc_aligned` on this arena's heap.
    #[inline]
    fn remap(&self, ptr: NonNull<u8>, _old_len: usize, new_len: usize, align: usize) -> *mut u8 {
        self.assert_owning_thread();
        // SAFETY: `self.heap` is live; `ptr` is a real mimalloc block head
        // allocated by this arena (caller contract). `mi_heap_realloc_aligned`
        // preserves the `min(old, new)` prefix.
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
            iter.next()
                .expect("ExactSizeIterator under-reported length")
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
        // `ctx` is `*const MimallocArena` (not the inner `*mut Heap`) so the
        // vtable thunks can reach `assert_owning_thread()`. They load
        // `heap_ptr()` from it on every call; this is one extra indirection vs
        // Zig (`ctx == heap`). The only consumer of `ctx` is this vtable;
        // `is_instance()` compares the *vtable* pointer, not `ctx`.
        crate::StdAllocator {
            ptr: ptr::from_ref(self).cast_mut().cast(),
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
        crate::StdAllocator {
            ptr: core::ptr::null_mut(),
            vtable: &GLOBAL_MIMALLOC_VTABLE,
        }
    }
}

impl Drop for MimallocArena {
    #[inline]
    fn drop(&mut self) {
        if !self.owns {
            // `borrowing_default()` — `mi_heap_main()` is process-lifetime;
            // destroying it would tear down the global allocator.
            return;
        }
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

/// Wrap a raw mimalloc pointer in the `Result<NonNull<[u8]>, AllocError>` shape
/// the `Allocator` trait wants. `#[inline(always)]` keeps codegen identical to
/// the open-coded `match` this replaced (hot path).
#[inline(always)]
fn alloc_result(p: *mut u8, size: usize) -> Result<NonNull<[u8]>, AllocError> {
    NonNull::new(p)
        .map(|p| NonNull::slice_from_raw_parts(p, size))
        .ok_or(AllocError)
}

// SAFETY:
// - `allocate` returns a `mi_heap_malloc[_aligned]` block of ≥`layout.size()`
//   bytes aligned to `layout.align()`, owned by `self.heap`. `deallocate` is
//   `mi_free`; `grow`/`shrink` are `mi_heap_realloc_aligned`, which preserves
//   the `min(old, new)` prefix. Standard mimalloc contracts.
// - For owned arenas (`owns == true`), `mi_heap_destroy` on `reset()`/`Drop`
//   additionally bulk-frees any blocks the caller leaked (`into_bump_slice`,
//   `arena.alloc()`-then-forget).
// - Cloned `&MimallocArena` handles refer to the same instance, satisfying the
//   "any clone may free" requirement.
unsafe impl Allocator for &MimallocArena {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        let p = self.aligned_alloc(layout.size(), layout.align());
        alloc_result(p, layout.size())
    }

    #[inline]
    fn allocate_zeroed(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        self.assert_owning_thread();
        // SAFETY: `self.heap_ptr()` is live (struct invariant).
        let p = unsafe {
            mimalloc::mi_heap_zalloc_auto_align(self.heap_ptr(), layout.size(), layout.align())
        };
        alloc_result(p.cast(), layout.size())
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        // SAFETY: caller contract — `ptr` came from this allocator's
        // `mi_heap_malloc[_aligned]`. `mi_free` is thread-safe.
        unsafe { crate::basic::mi_free_checked(ptr.as_ptr().cast(), layout.size(), layout.align()) }
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        alloc_result(
            self.remap(ptr, old.size(), new.size(), new.align()),
            new.size(),
        )
    }

    #[inline]
    unsafe fn grow_zeroed(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        let p = self.remap(ptr, old.size(), new.size(), new.align());
        let p = NonNull::new(p).ok_or(AllocError)?;
        // SAFETY: `p` holds `new.size()` bytes; the `[old.size(), new.size())`
        // tail is uninitialized (either freshly carved or `mi_realloc`ed).
        unsafe { ptr::write_bytes(p.as_ptr().add(old.size()), 0, new.size() - old.size()) };
        Ok(NonNull::slice_from_raw_parts(p, new.size()))
    }

    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        alloc_result(
            self.remap(ptr, old.size(), new.size(), new.align()),
            new.size(),
        )
    }
}

/// Zig's `Borrowed.alignedAlloc` body — pick `mi_heap_malloc_aligned` only
/// when `align > MI_MAX_ALIGN_SIZE`, otherwise the cheaper `mi_heap_malloc`,
/// then debug-assert the returned block's usable size covers `len`.
///
/// SAFETY: `heap` must be a live `mi_heap_t*`.
#[inline]
unsafe fn heap_alloc_maybe_aligned(heap: *mut mimalloc::Heap, len: usize, align: usize) -> *mut u8 {
    // SAFETY: caller guarantees `heap` is live.
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

// ── StdAllocator vtable (Zig: `heap_allocator_vtable`) ───────────────────

unsafe fn vtable_alloc(ctx: *mut c_void, len: usize, a: crate::Alignment, _ra: usize) -> *mut u8 {
    // SAFETY: `ctx` is the `*const MimallocArena` stashed by
    // `std_allocator()`; the `StdAllocator` borrow it was built from is
    // still live (Zig contract: an `Allocator` does not outlive its backing).
    let arena = unsafe { &*ctx.cast::<MimallocArena>() };
    arena.aligned_alloc(len, a.to_byte_units())
}

unsafe fn vtable_resize(
    ctx: *mut c_void,
    buf: &mut [u8],
    _a: crate::Alignment,
    new_len: usize,
    _ra: usize,
) -> bool {
    // SAFETY: see `vtable_alloc`.
    let arena = unsafe { &*ctx.cast::<MimallocArena>() };
    arena.resize_in_place(
        // SAFETY: `buf` is a live arena allocation per the vtable contract.
        unsafe { NonNull::new_unchecked(buf.as_mut_ptr()) },
        buf.len(),
        new_len,
    )
}

unsafe fn vtable_remap(
    ctx: *mut c_void,
    buf: &mut [u8],
    a: crate::Alignment,
    new_len: usize,
    _ra: usize,
) -> *mut u8 {
    // SAFETY: see `vtable_alloc`.
    let arena = unsafe { &*ctx.cast::<MimallocArena>() };
    arena.remap(
        // SAFETY: `buf` is a live arena allocation per the vtable contract.
        unsafe { NonNull::new_unchecked(buf.as_mut_ptr()) },
        buf.len(),
        new_len,
        a.to_byte_units(),
    )
}

unsafe fn vtable_free(_ctx: *mut c_void, buf: &mut [u8], a: crate::Alignment, _ra: usize) {
    // SAFETY: vtable contract — `buf` was allocated by this arena's
    // `mi_heap_malloc[_aligned]`. `mi_free` is thread-safe.
    unsafe { crate::basic::mi_free_checked(buf.as_mut_ptr().cast(), buf.len(), a.to_byte_units()) }
}

/// Zig: `heap_allocator_vtable` — per-arena thunks; `ctx` is the
/// `*const MimallocArena` stashed by `std_allocator()`.
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
    // `mi_malloc[_aligned]` are declared `safe fn` in the extern block (no input
    // preconditions — any len/alignment is valid; returns null on OOM), so no
    // `unsafe { }` is required here.
    if mimalloc::must_use_aligned_alloc(a.to_byte_units()) {
        mimalloc::mi_malloc_aligned(len, a.to_byte_units()).cast()
    } else {
        mimalloc::mi_malloc(len).cast()
    }
}

/// Zig: `global_mimalloc_vtable`.
pub static GLOBAL_MIMALLOC_VTABLE: crate::AllocatorVTable = crate::AllocatorVTable {
    alloc: global_vtable_alloc,
    resize: crate::basic::MimallocAllocator::resize_with_default_allocator,
    remap: crate::basic::MimallocAllocator::remap_with_default_allocator,
    free: crate::basic::mimalloc_free,
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
        Self {
            buf: Vec::new_in(arena),
        }
    }
    #[inline]
    pub fn with_capacity_in(cap: usize, arena: &'a MimallocArena) -> Self {
        Self {
            buf: Vec::with_capacity_in(cap, arena),
        }
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
        // Storage is owned by the arena and lives for `'a`; `Vec::leak` forgoes
        // the `Vec` drop so the arena reclaims it on `reset`/`Drop`.
        &*self.leak()
    }
    #[inline]
    fn into_bump_slice_mut(self) -> &'a mut [T] {
        self.leak()
    }
    #[inline]
    fn bump(&self) -> &'a MimallocArena {
        *self.allocator()
    }
}

// ported from: src/bun_alloc/MimallocArena.zig
