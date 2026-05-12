//! Port of `src/bun_alloc/MimallocArena.zig`.
//!
//! A per-heap mimalloc allocator with a **bump-chunk front layer**: each
//! `MimallocArena` owns a `mi_heap_t` *and* a current `[bump_start, bump_end)`
//! chunk carved from that heap. [`aligned_alloc`](MimallocArena::aligned_alloc)
//! (and therefore `alloc()` / `Vec<T, &MimallocArena>` / `ArenaVec` / `BumpVec`)
//! is a pointer-add within the chunk; only when the chunk is exhausted does it
//! call `mi_theap_malloc` for a geometrically-grown refill. This restores the
//! Zig `std.heap.ArenaAllocator` cost model the parser was ported from — one
//! mimalloc call per ~10⁵ allocations instead of one per allocation — without
//! giving up `mi_heap_destroy` bulk-free on `Drop`/`reset()`.
//!
//! Because allocations are interior to a bump chunk, `Allocator::deallocate`
//! is a **no-op** for owned arenas (the chunk is bulk-freed by
//! `mi_heap_destroy`), and `grow` does last-alloc in-place extend or
//! carve-and-copy (matching `std.heap.ArenaAllocator.resize`). The
//! [`borrowing_default`](MimallocArena::borrowing_default) shape (no owned
//! heap, no bulk-free) bypasses the bump layer entirely and keeps the original
//! per-allocation `mi_malloc`/`mi_free`/`mi_realloc` behaviour.
//!
//! The bumpalo-compatible convenience methods (`alloc`, `alloc_slice_copy`,
//! `alloc_slice_fill_*`, `alloc_str`, `alloc_layout`) are provided so that
//! the `pub type Arena = MimallocArena` swap is mostly source-compatible
//! with the previous `Arena = bumpalo::Bump` alias.

use core::alloc::{AllocError, Allocator, Layout};
use core::cell::Cell;
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
    /// Cached `mi_theap_t*` for `heap` on the owning thread, or null until the
    /// first allocation resolves it via [`mimalloc::mi_heap_theap`]. Every
    /// `mi_heap_malloc*` entry point internally re-resolves `heap → theap` via
    /// `_mi_heap_theap` (TLS read of `__mi_theap_cached` + tag compare,
    /// falling back to `_mi_heap_theap_get_or_init` when the cached theap
    /// belongs to a *different* heap). The runtime-transpile arena interleaves
    /// allocations with the AST `mi_heap` and the global default heap, so the
    /// one-slot mimalloc cache thrashes — perf showed `_mi_theap_cached_set`
    /// hitting its slow path ~134 k times on `bun build create-vue`. Caching
    /// the theap here lets [`aligned_alloc`] call `mi_theap_malloc[_aligned]`
    /// directly and skip the per-call lookup entirely.
    ///
    /// A `mi_theap_t` is per-(heap, OS-thread); the arena's allocation contract
    /// is already single-thread (debug-asserted by [`assert_owning_thread`]),
    /// so the cached value is stable for the arena's lifetime. Cleared in
    /// [`reset`] (heap destroyed → theap dangling) and never populated for
    /// [`borrowing_default`] (`mi_heap_main()` allocates on any thread, so a
    /// per-thread theap cache would be wrong there — those calls fall back to
    /// the `mi_heap_*` path that resolves the theap each time).
    theap: Cell<*mut mimalloc::THeap>,
    // ── Bump-chunk front layer ───────────────────────────────────────────
    // Zig backs the parser arena with `std.heap.ArenaAllocator` — a chained-
    // buffer bump allocator — so each `arena.alloc(Scope{..})` /
    // `BumpVec::push` / scope-map insert is a pointer add. The original Rust
    // port called raw `mi_theap_malloc` once per allocation here, which on
    // `next lint` / `bun build create-vite` showed up as the entire
    // `Bun__transpileFile` delta vs Zig: perf-diff (5-run main-thread agg)
    // `_mi_malloc_generic` 62 vs 12, `mi_theap_malloc_zero_aligned_at_overalloc`
    // 16 vs 0, `__memset_avx512` +47 (fresh-page bitmap zeroing),
    // `do_anonymous_page` +24, `__madvise` +16; strace +73 madvise / +500
    // minor faults. Top mimalloc-slow-path callers were `Parser::__parse`,
    // `P::push_scope_for_parse_pass`, and `Stmt/Expr::Data::Store::append` —
    // all of which go through `aligned_alloc` below.
    //
    // These four `Cell`s restore the bump layer at the *arena* level (the
    // `AstAlloc` ZST already had a TLS bump for `Vec<_, AstAlloc>`; this
    // covers every other `arena.alloc()` / `ArenaVec` / `BumpVec` caller).
    // `aligned_alloc` carves from `[bump_cur, bump_end)`; on miss,
    // [`bump_refill`](Self::bump_refill) requests a geometrically-grown chunk
    // via the cached `theap` and installs it. Chunks are never individually
    // freed — `mi_heap_destroy` reclaims them on `reset()`/`Drop`.
    //
    // For `borrowing_default()` arenas (`owns == false`) these stay null for
    // the arena's lifetime and `aligned_alloc` falls through to the per-call
    // `mi_heap_*` path, so allocations there remain individually
    // `mi_free`-able (no bulk-free is available without an owned heap).
    /// Start of the current bump chunk (a real `mi_theap_malloc` block head).
    /// Retained so [`reset_retain_with_limit`](Self::reset_retain_with_limit)
    /// can rewind `bump_cur` without a `mi_*` call when under the limit.
    bump_start: Cell<*mut u8>,
    /// Next-free byte within `[bump_start, bump_end)`. Null ⇒ no chunk yet.
    bump_cur: Cell<*mut u8>,
    /// One-past-end of the current bump chunk.
    bump_end: Cell<*mut u8>,
    /// Size of the *next* chunk to request from mimalloc. Starts at
    /// [`BUMP_CHUNK_INIT`] and doubles per refill up to [`BUMP_CHUNK_MAX`],
    /// matching `std.heap.ArenaAllocator`'s geometric node growth.
    bump_next: Cell<usize>,
    /// `true` when `heap` came from `mi_heap_new()` and must be
    /// `mi_heap_destroy`ed on `Drop`/`reset()`. `false` when borrowing the
    /// process-wide `mi_heap_main()` (see [`Self::borrowing_default`]) — Drop
    /// is then a no-op and allocations live for the process lifetime, matching
    /// Zig's `default_allocator` shape for callers that just need an `&Arena`
    /// without paying `mi_heap_new` + `mi_heap_destroy`.
    owns: bool,
    /// Approximate bytes requested from this heap since the last
    /// `reset()`/`mi_heap_destroy`. Tracked so [`Self::reset_retain_with_limit`]
    /// can match Zig's `std.heap.ArenaAllocator.reset(.{.retain_with_limit = N})`
    /// (keep up to N bytes of capacity warm; only pay the `mi_heap_destroy` +
    /// `mi_heap_new` round-trip when accumulated garbage exceeds the limit).
    /// `Cell` because the `Allocator` trait takes `&self`; the per-alloc cost
    /// is one non-atomic load+add+store on the same cache line as `heap`.
    /// Counts *requested* `Layout::size`, not mimalloc's rounded-up usable
    /// size, so this is a lower bound on the heap's actual footprint — fine
    /// for a soft retain limit.
    bytes_since_reset: Cell<usize>,
    /// Zig: `thread_lock: bun.safety.ThreadLock` (debug-only). Stamped on
    /// `new()`/`reset()`; asserted on every `mi_heap_*` alloc/realloc path.
    /// Compiles out in release so the struct stays one pointer wide.
    #[cfg(debug_assertions)]
    owning_thread: AtomicU64,
}

/// First bump-chunk size. 64 KiB covers `P::init`'s ~dozen allocations and the
/// first few hundred scope/stmt nodes of a small module without a refill.
const BUMP_CHUNK_INIT: usize = 64 * 1024;
/// Cap on geometric chunk growth — one mimalloc segment; matches the spec's
/// `ModuleLoader.zig` `retain_with_limit = 8M`.
const BUMP_CHUNK_MAX: usize = 8 * 1024 * 1024;

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
            // Resolved lazily on first alloc — `mi_heap_new` may be called on
            // a setup thread and the arena `Send`-moved before first use.
            theap: Cell::new(core::ptr::null_mut()),
            // Bump chunk lazily allocated on first `aligned_alloc` miss.
            bump_start: Cell::new(core::ptr::null_mut()),
            bump_cur: Cell::new(core::ptr::null_mut()),
            bump_end: Cell::new(core::ptr::null_mut()),
            bump_next: Cell::new(BUMP_CHUNK_INIT),
            owns: true,
            bytes_since_reset: Cell::new(0),
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
            // Intentionally never populated — `mi_heap_main()` is allocated
            // from on any thread, so a cached per-thread theap would be wrong.
            // The null sentinel makes `aligned_alloc` fall back to the
            // `mi_heap_*` path that resolves the correct theap each call.
            theap: Cell::new(core::ptr::null_mut()),
            // Bump layer disabled for borrowed-default: there is no
            // `mi_heap_destroy` to bulk-reclaim chunks, so allocations must
            // stay individually `mi_free`-able. Null cur/end makes every
            // `aligned_alloc` fall through to `aligned_alloc_slow`, which
            // checks `!owns` and goes straight to `mi_heap_malloc`.
            bump_start: Cell::new(core::ptr::null_mut()),
            bump_cur: Cell::new(core::ptr::null_mut()),
            bump_end: Cell::new(core::ptr::null_mut()),
            bump_next: Cell::new(0),
            owns: false,
            // Unused for borrowed-default — `reset_retain_with_limit` debug-
            // asserts `owns` like `reset()` does.
            bytes_since_reset: Cell::new(0),
            #[cfg(debug_assertions)]
            // `mi_heap_main()` is safe to allocate from on any thread (each
            // thread gets its own `theap`), so the owning-thread assert is
            // disabled by stamping 0 — see `assert_owning_thread`.
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
            // 0 = `borrowing_default()`: `mi_heap_main()` alloc is thread-safe
            // (per-thread `theap` underneath), so skip the same-thread check.
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
        // Old theap belonged to the destroyed heap; force re-resolve on next
        // alloc (also picks up the new owning thread if `Send`-moved).
        self.theap.set(core::ptr::null_mut());
        // Bump chunk(s) lived in the destroyed heap and are now dangling.
        self.bump_start.set(core::ptr::null_mut());
        self.bump_cur.set(core::ptr::null_mut());
        self.bump_end.set(core::ptr::null_mut());
        self.bump_next.set(BUMP_CHUNK_INIT);
        self.bytes_since_reset.set(0);
        // `&mut self` proves exclusive access; re-stamp the debug thread-lock
        // so an arena `Send`-moved to a worker and then reset there may
        // allocate on that worker (Zig has no equivalent because its
        // `MimallocArena` is not moved post-init).
        #[cfg(debug_assertions)]
        self.owning_thread.store(debug_thread_stamp(), Ordering::Relaxed);
    }


    /// Zig: `std.heap.ArenaAllocator.reset(.{.retain_with_limit = limit})` for
    /// the per-module transpile arena (`ModuleLoader.transpile_source_code_arena`).
    ///
    /// With the bump-chunk front layer, this now matches Zig's semantics
    /// directly: when the heap's committed footprint is ≤ `limit`, **rewind**
    /// `bump_cur` to the start of the current (warm) chunk — no `mi_*` call,
    /// no page faults, next parse's allocations reuse hot pages immediately.
    /// All previously-returned pointers are invalidated (they alias the
    /// rewound region), exactly as in Zig.
    ///
    /// When the footprint exceeds `limit`, fall through to a full
    /// `mi_heap_destroy` + `mi_heap_new`, then **eagerly prime** one
    /// [`BUMP_CHUNK_INIT`] chunk so the next `P::init`'s first allocations
    /// don't each walk the cold `_mi_malloc_generic → mi_page_queue_find_free_ex
    /// → mi_arenas_page_alloc_fresh` path (perf showed that chain rooted at
    /// `Parser::__parse` as the single largest mimalloc-slow-path caller).
    ///
    /// `bytes_since_reset` is kept as a cheap fast-positive; the authoritative
    /// check is [`heap_committed_exceeds`](Self::heap_committed_exceeds), which
    /// also sees `AstAlloc`'s direct-to-heap bump chunks (those bypass
    /// `track_alloc` entirely).
    ///
    /// Returns whether a full destroy+new (vs. a warm rewind) happened.
    pub fn reset_retain_with_limit(&mut self, limit: usize) -> bool {
        debug_assert!(
            self.owns,
            "MimallocArena::reset_retain_with_limit() on a borrowing_default() arena"
        );
        // Match `reset()`'s thread-stamp behaviour so a `Send`-moved arena can
        // allocate on the new thread regardless of which branch is taken.
        #[cfg(debug_assertions)]
        self.owning_thread.store(debug_thread_stamp(), Ordering::Relaxed);

        if self.bytes_since_reset.get() > limit || self.heap_committed_exceeds(limit) {
            self.reset();
            // Prime the fresh heap with one warm chunk so the next parse's
            // first allocation is a pointer-add, not a cold
            // `mi_arenas_page_alloc_fresh`. `reset()` cleared `theap`; resolve
            // it here so `bump_refill` has it (and so subsequent refills on
            // the same thread skip the lookup).
            let theap = self.resolve_theap();
            // `bump_next` was reset to `BUMP_CHUNK_INIT` by `reset()`; a
            // single 64 KiB chunk covers `P::init`'s ~dozen up-front allocs
            // and the first few hundred nodes. Geometric growth resumes from
            // there if the module is larger.
            self.bump_refill(theap, Layout::from_size_align(0, 1).unwrap());
            true
        } else {
            // Warm rewind: `[bump_start, bump_end)` is a live chunk in the
            // (un-destroyed) heap. Rewinding `cur` makes the whole chunk
            // available again; earlier (smaller) chunks from prior refills
            // stay committed in the heap and count toward
            // `heap_committed_exceeds` on the *next* call, so they are
            // eventually reclaimed by the over-limit branch. `bump_next` is
            // intentionally left at its grown value so a steady-state workload
            // refills at the right size immediately.
            self.bump_cur.set(self.bump_start.get());
            self.bytes_since_reset.set(0);
            false
        }
    }

    /// Returns whether the heap's committed memory exceeds `limit`, by walking
    /// `mi_heap_area_t`s (one per mimalloc page) and summing `committed`. The
    /// walk early-exits once the sum crosses `limit`, so the cost is bounded
    /// by `limit / 64 KiB` callbacks (≈128 for the 8 MiB module-arena limit) —
    /// negligible per-module compared to parse cost. Under-limit heaps walk
    /// every page they own (≪128 for small modules).
    ///
    /// Unlike [`Self::bytes_since_reset`], this sees all allocations made on
    /// `self.heap` regardless of which Rust-side wrapper issued them.
    fn heap_committed_exceeds(&self, limit: usize) -> bool {
        #[repr(C)]
        struct State {
            sum: usize,
            limit: usize,
        }
        extern "C" fn visit(
            _heap: *const mimalloc::Heap,
            area: *const mimalloc::mi_heap_area_t,
            _block: *mut c_void,
            _block_size: usize,
            arg: *mut c_void,
        ) -> bool {
            // SAFETY: mimalloc passes a valid `mi_heap_area_t*` per page when
            // `visit_blocks=false`, and `arg` is the `&mut State` we supplied.
            let st = unsafe { &mut *arg.cast::<State>() };
            let committed = unsafe { (*area).committed };
            st.sum = st.sum.saturating_add(committed);
            // `false` stops the walk early.
            st.sum <= st.limit
        }
        let mut st = State { sum: 0, limit };
        // SAFETY: `self.heap` is a live heap; `visit` matches the
        // `mi_block_visit_fun` signature; `&mut st` is valid for the call.
        unsafe {
            mimalloc::mi_heap_visit_blocks(
                self.heap_ptr(),
                false,
                Some(visit),
                (&raw mut st).cast(),
            );
        }
        st.sum > limit
    }

    #[inline(always)]
    fn track_alloc(&self, len: usize) {
        // Non-atomic: alloc paths already require the owning thread (asserted
        // by `assert_owning_thread`), and `Cell` is `!Sync` so the only other
        // reader is `reset_retain_with_limit` which takes `&mut self`.
        // Saturating because this is a soft-limit hint, not accounting.
        // Kept as a fast-positive for `reset_retain_with_limit`; the
        // authoritative check is `heap_committed_exceeds`.
        self.bytes_since_reset
            .set(self.bytes_since_reset.get().saturating_add(len));
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

    // ── Bump-chunk allocation core ───────────────────────────────────────

    /// Resolve and cache this thread's `mi_theap_t*` for `self.heap`. Only
    /// called for `owns == true` arenas (single-thread alloc contract); the
    /// `borrowing_default()` path leaves `theap` null and never reaches here.
    #[cold]
    fn resolve_theap(&self) -> *mut mimalloc::THeap {
        debug_assert!(self.owns);
        // SAFETY: `self.heap` is a live `mi_heap_t*`; `mi_heap_theap` resolves
        // (creating if necessary) the calling thread's theap for it.
        let theap = unsafe { mimalloc::mi_heap_theap(self.heap_ptr()) };
        self.theap.set(theap);
        theap
    }

    /// Bump fast path: align `bump_cur` up to `align`, carve `len` bytes if
    /// they fit before `bump_end`, else null. Address arithmetic only — `cur`
    /// and `end` are within (or one-past) the same `mi_theap_malloc` block, so
    /// the `add`s stay in-bounds of that allocation.
    ///
    /// `cur`/`end` may be null (no chunk yet, or `borrowing_default`); the
    /// arithmetic then degenerates to `0`/`0` and the capacity check fails for
    /// any nonzero `len`, so the caller falls through to the slow path. For
    /// `len == 0` with null `cur` it returns null too (caught by the caller's
    /// null check → slow path → real non-null pointer).
    #[inline(always)]
    fn bump_carve(&self, len: usize, align: usize) -> *mut u8 {
        let cur = self.bump_cur.get();
        let end = self.bump_end.get();
        let cur_addr = cur as usize;
        // `align` is a power of two (Layout invariant).
        let pad = cur_addr.wrapping_neg() & (align - 1);
        // `Layout` invariant: `size + (align - 1) <= isize::MAX`; `pad < align`,
        // so `pad + len` cannot overflow.
        let need = pad + len;
        if (end as usize).wrapping_sub(cur_addr) < need {
            return core::ptr::null_mut();
        }
        // SAFETY: `cur + pad + len <= end`, all within the live chunk allocation.
        let aligned = unsafe { cur.add(pad) };
        self.bump_cur.set(unsafe { aligned.add(len) });
        aligned
    }

    /// Slow path: current chunk exhausted (or none yet). Allocate a fresh chunk
    /// of `max(bump_next, padded(layout))` from the arena's heap via the cached
    /// `theap`, install it as the new bump region, and carve `layout` from it.
    /// The previous chunk (if any) is abandoned in the heap — reclaimed by
    /// `mi_heap_destroy` on `reset()`/`Drop`.
    #[cold]
    fn bump_refill(&self, theap: *mut mimalloc::THeap, layout: Layout) -> *mut u8 {
        let align = layout.align();
        // Chunk size: at least the geometric `next`, and at least enough for
        // this request including worst-case alignment padding (mimalloc returns
        // 16-aligned blocks; anything stricter is padded inside the chunk).
        let next = self.bump_next.get();
        let want = layout.size().saturating_add(align.saturating_sub(1));
        let chunk_len = next.max(want);
        // SAFETY: `theap` is the live `mi_theap_t*` for this thread's
        // `self.heap` (resolved by `resolve_theap`; the single-thread alloc
        // contract guarantees the heap is not `reset()` concurrently).
        // `mi_theap_malloc` returns a fresh ≥16-aligned block of `chunk_len`
        // bytes or null on OOM.
        let chunk = unsafe { mimalloc::mi_theap_malloc(theap, chunk_len) }.cast::<u8>();
        if chunk.is_null() {
            return core::ptr::null_mut();
        }
        // Geometric growth for the *next* refill, clamped so a single huge
        // request does not permanently inflate the increment.
        self.bump_next.set((next * 2).min(BUMP_CHUNK_MAX));
        // SAFETY: `chunk .. chunk + chunk_len` is the just-allocated block.
        let end = unsafe { chunk.add(chunk_len) };
        self.bump_start.set(chunk);
        self.bump_cur.set(chunk);
        self.bump_end.set(end);
        // The fresh chunk is sized to fit; this cannot return null.
        let p = self.bump_carve(layout.size(), align);
        debug_assert!(!p.is_null());
        p
    }

    /// Hot allocation path. For owned arenas this is a pointer-add within the
    /// current bump chunk (Zig `std.heap.ArenaAllocator` parity); only on chunk
    /// exhaustion does it touch mimalloc. For `borrowing_default()` arenas the
    /// bump region is permanently empty and every call falls through to
    /// [`aligned_alloc_slow`](Self::aligned_alloc_slow) → `mi_heap_malloc`.
    #[inline]
    fn aligned_alloc(&self, len: usize, align: usize) -> *mut u8 {
        self.assert_owning_thread();
        self.track_alloc(len);
        let p = self.bump_carve(len, align);
        if !p.is_null() {
            return p;
        }
        self.aligned_alloc_slow(len, align)
    }

    /// Out-of-line miss path for [`aligned_alloc`](Self::aligned_alloc): either
    /// refill the bump chunk (owned arena) or call straight into mimalloc
    /// (`borrowing_default()` — bump layer disabled).
    #[cold]
    fn aligned_alloc_slow(&self, len: usize, align: usize) -> *mut u8 {
        if !self.owns {
            // `borrowing_default()` — any-thread alloc; no bump, no theap
            // cache. Allocations are real mimalloc block heads so the
            // `Allocator::deallocate` `mi_free` branch is sound.
            // SAFETY: `self.heap_ptr()` is live (`mi_heap_main()`).
            return unsafe { heap_alloc_maybe_aligned(self.heap_ptr(), len, align) };
        }
        let mut theap = self.theap.get();
        if theap.is_null() {
            theap = self.resolve_theap();
        }
        // `Layout` reconstruction cannot fail: `align` is a power of two and
        // `len` came from a valid `Layout` at the call site.
        self.bump_refill(theap, unsafe { Layout::from_size_align_unchecked(len, align) })
    }

    /// Zig: `vtable_resize` — in-place expand/shrink, no relocation.
    /// Returns `true` if the block now has at least `new_len` bytes.
    ///
    /// For owned arenas `ptr` is interior to a bump chunk, so `mi_expand` is
    /// not applicable; instead this succeeds iff `ptr` is the *last* carve and
    /// the chunk has room (matching `std.heap.ArenaAllocator.resize`).
    #[inline]
    pub fn resize_in_place(&self, ptr: NonNull<u8>, old_len: usize, new_len: usize) -> bool {
        if self.owns {
            // SAFETY: `ptr + old_len` is in-bounds of the chunk per the
            // `Allocator` contract on `ptr`.
            let old_end = unsafe { ptr.as_ptr().add(old_len) };
            if old_end == self.bump_cur.get()
                && (self.bump_end.get() as usize).wrapping_sub(ptr.as_ptr() as usize) >= new_len
            {
                // SAFETY: `ptr + new_len <= bump_end`, within the live chunk.
                self.bump_cur.set(unsafe { ptr.as_ptr().add(new_len) });
                return true;
            }
            // Not the last carve, or out of room: cannot grow in place. Shrink
            // always "succeeds" (the slot already holds ≥ `new_len` bytes).
            return new_len <= old_len;
        }
        // `borrowing_default()` — `ptr` is a real mimalloc block head.
        // SAFETY: `ptr` was allocated by mimalloc (caller contract).
        unsafe { !mimalloc::mi_expand(ptr.as_ptr().cast(), new_len).is_null() }
    }

    /// Bump-aware grow/shrink: last-alloc in-place extend, else carve a fresh
    /// slot and `memcpy` the `min(old, new)` prefix. The old slot is abandoned
    /// in the chunk (bump-arena semantics; reclaimed on `mi_heap_destroy`).
    /// Matches `std.heap.ArenaAllocator`'s remap.
    ///
    /// For `borrowing_default()` arenas, falls through to
    /// `mi_heap_realloc_aligned` (pointers there are real block heads).
    #[inline]
    fn remap(&self, ptr: NonNull<u8>, old_len: usize, new_len: usize, align: usize) -> *mut u8 {
        self.assert_owning_thread();
        if !self.owns {
            self.track_alloc(new_len);
            // SAFETY: `self.heap` is live; `ptr` is a real mimalloc block head
            // (the `borrowing_default` path never produces bump-interior
            // pointers). `mi_heap_realloc_aligned` preserves the prefix.
            return unsafe {
                mimalloc::mi_heap_realloc_aligned(
                    self.heap_ptr(),
                    ptr.as_ptr().cast(),
                    new_len,
                    align,
                )
                .cast()
            };
        }
        // Try in-place extend first: if `ptr` is the last carve and already
        // satisfies `align`, just move `bump_cur`. (Covers shrink too: `new_len
        // < old_len` rewinds `cur`, recovering the tail for the next carve.)
        // SAFETY: `ptr + old_len` is in-bounds per the `Allocator` contract.
        let old_end = unsafe { ptr.as_ptr().add(old_len) };
        if old_end == self.bump_cur.get()
            && (ptr.as_ptr() as usize) & (align - 1) == 0
            && (self.bump_end.get() as usize).wrapping_sub(ptr.as_ptr() as usize) >= new_len
        {
            self.track_alloc(new_len.saturating_sub(old_len));
            // SAFETY: `ptr + new_len <= bump_end`, within the live chunk.
            self.bump_cur.set(unsafe { ptr.as_ptr().add(new_len) });
            return ptr.as_ptr();
        }
        if new_len <= old_len {
            // Shrink of a non-last carve: keep the slot. No rewind — the bytes
            // are abandoned until `reset()` (bump-arena semantics).
            return ptr.as_ptr();
        }
        // Carve a fresh slot and copy. `aligned_alloc` handles track/refill.
        let p = self.aligned_alloc(new_len, align);
        if p.is_null() {
            return core::ptr::null_mut();
        }
        // SAFETY: `p` is a fresh `new_len`-byte slot disjoint from `ptr`
        // (different bump offset, or different chunk); `old_len` bytes at
        // `ptr` are initialized per the grow contract; `old_len < new_len`.
        unsafe { core::ptr::copy_nonoverlapping(ptr.as_ptr(), p, old_len) };
        p
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
        // `ctx` is `*const MimallocArena` (not the inner `*mut Heap`) so the
        // vtable thunks can reach `bytes_since_reset` for retain-with-limit
        // accounting. The thunks load `heap_ptr()` from it on every call;
        // this is one extra indirection vs Zig (`ctx == heap`), but it lets
        // the parser's Zig-compat `StdAllocator` path participate in
        // `reset_retain_with_limit`. The only consumer of `ctx` is this
        // vtable; `is_instance()` compares the *vtable* pointer, not `ctx`.
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
        crate::StdAllocator { ptr: core::ptr::null_mut(), vtable: &GLOBAL_MIMALLOC_VTABLE }
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
// - Owned-arena path (`owns == true`): `allocate` returns a sub-slice of a
//   `mi_theap_malloc` bump chunk of ≥`layout.size()` bytes aligned to
//   `layout.align()`. The chunk — and therefore every sub-slice — is owned by
//   `self.heap` and bulk-freed by `mi_heap_destroy` on `reset()`/`Drop`.
//   `deallocate` is a no-op (permitted: the trait only requires that memory
//   *may* be reclaimed). `grow`/`shrink` either extend the last carve in place
//   or carve a fresh slot and `memcpy` the prefix, preserving `min(old, new)`
//   bytes as required.
// - `borrowing_default()` path (`owns == false`): the bump region is never
//   populated, so `allocate` falls through to `mi_heap_malloc[_aligned]`,
//   `deallocate` to `mi_free`, and `grow`/`shrink` to
//   `mi_heap_realloc_aligned`, with the standard mimalloc contracts. The two
//   paths are mutually exclusive per arena instance, so a pointer is never
//   passed to the wrong free routine.
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
        let p = self.aligned_alloc(layout.size(), layout.align());
        let p = NonNull::new(p).ok_or(AllocError)?;
        // SAFETY: `p` points to `layout.size()` writable bytes just carved
        // from the bump chunk (or returned by `mi_heap_malloc` for
        // `borrowing_default`).
        unsafe { ptr::write_bytes(p.as_ptr(), 0, layout.size()) };
        Ok(NonNull::slice_from_raw_parts(p, layout.size()))
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        if self.owns {
            // Bump-interior pointer — strict no-op. NOT a last-alloc rewind:
            // `ArenaVec::into_bump_slice` (`.leak()`) and the parser's
            // `arena.alloc()`-then-forget pattern mean two live slices may
            // alias adjacent carves; the bytes are recovered by
            // `mi_heap_destroy` on `reset()`/`Drop`. This is the cost of Zig
            // `std.heap.ArenaAllocator` parity.
            let _ = (ptr, layout);
            return;
        }
        // `borrowing_default()` — `ptr` is a real mimalloc block head.
        // SAFETY: caller contract — `ptr` came from this allocator's
        // `mi_heap_malloc` branch.
        unsafe { crate::basic::mi_free_checked(ptr.as_ptr().cast(), layout.size(), layout.align()) }
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        alloc_result(self.remap(ptr, old.size(), new.size(), new.align()), new.size())
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
        alloc_result(self.remap(ptr, old.size(), new.size(), new.align()), new.size())
    }
}

/// Direct-to-mimalloc allocation for the `borrowing_default()` (bump-disabled)
/// path. Zig's `Borrowed.alignedAlloc` body — pick `mi_heap_malloc_aligned`
/// only when `align > MI_MAX_ALIGN_SIZE`, otherwise the cheaper
/// `mi_heap_malloc`, then debug-assert the returned block's usable size covers
/// `len`. Owned arenas never reach this; they go through `bump_carve`/
/// `bump_refill` instead.
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
    // Route through the bump-aware `remap` so interior pointers are handled.
    arena.remap(
        // SAFETY: `buf` is a live arena allocation per the vtable contract.
        unsafe { NonNull::new_unchecked(buf.as_mut_ptr()) },
        buf.len(),
        new_len,
        a.to_byte_units(),
    )
}

unsafe fn vtable_free(ctx: *mut c_void, buf: &mut [u8], a: crate::Alignment, _ra: usize) {
    // SAFETY: see `vtable_alloc`.
    let arena = unsafe { &*ctx.cast::<MimallocArena>() };
    if arena.owns {
        // Bump-interior pointer — no-op (reclaimed by `mi_heap_destroy`).
        return;
    }
    // `borrowing_default()` — real mimalloc block head.
    // SAFETY: vtable contract — `buf` was allocated by this arena's
    // `mi_heap_malloc` branch.
    unsafe { crate::basic::mi_free_checked(buf.as_mut_ptr().cast(), buf.len(), a.to_byte_units()) }
}

/// Zig: `heap_allocator_vtable` — per-arena thunks; `ctx` is the
/// `*const MimallocArena` stashed by `std_allocator()`. All four slots are
/// arena-aware because owned-arena pointers are interior to a bump chunk and
/// must NOT be passed to `mi_expand`/`mi_free`.
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
