//! Port of `src/bundler/ThreadPool.zig` — the bundler-side worker pool that
//! wraps `bun_threading::thread_pool::ThreadPool` and owns the per-thread
//! [`Worker`] state (mimalloc arena, per-thread `Transpiler` clone, AST store).
//!
//! Un-gated B-2: structural surface (struct fields, schedule, IO pool, worker
//! map) is real so `ParseTask` / `bundle_v2` / `Graph` can name and drive it.
//! `Worker::create` / `initialize_transpiler` build the per-worker
//! `Transpiler` via `Transpiler::for_worker` (per-field deep clone — no
//! bitwise struct copy); the `linker.resolver` backref is wired by
//! `Transpiler::wire_after_move` once the value is at its final address.

use core::mem::{ManuallyDrop, MaybeUninit};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena as ThreadLocalArena; // Zig: bun.allocators.MimallocArena → bumpalo::Bump
use bun_collections::VecExt;
use bun_collections::{ArrayHashMap, MapEntry};
use bun_core::{self, env_var, FeatureFlags, output as Output};
use bun_logger as Logger;
use bun_sys::Fd;
use bun_threading::{thread_pool as ThreadPoolLib, Mutex};

#[allow(unused_imports)]
use crate::cache::{self as CacheSet, Contents, Entry as CacheEntry, ExternalFreeFunction};
use crate::linker_context_mod::StmtList;
// PORT NOTE: `crate::options::Target` is the lower-tier `bun_options_types`
// enum (re-exported for downstream crates); `BundleOptions.target` is the
// file-backed `options_impl::Target`. Compare against the latter so
// `primary.options.target == target` type-checks. The two enums collapse in
// Phase B-3 (see lib.rs `pub mod options` shadow note).
use crate::options_impl::Target;
use crate::parse_task::{ContentsOrFd, ParseTask, ParseTaskStage};
use crate::transpiler::Transpiler;
use crate::BundleV2;
use bun_js_parser as js_ast;

bun_core::declare_scope!(ThreadPool, visible);

/// `std.Thread.Id` — `bun_threading::current_thread_id()` returns `u64` on
/// every platform (`gettid`/`pthread_threadid_np`/`GetCurrentThreadId`).
pub type ThreadId = u64;

pub struct ThreadPool {
    /// macOS holds an IORWLock on every file open.
    /// This causes massive contention after about 4 threads as of macOS 15.2
    /// On Windows, this seemed to be a small performance improvement.
    /// On Linux, this was a performance regression.
    /// In some benchmarks on macOS, this yielded up to a 60% performance improvement in microbenchmarks that load ~10,000 files.
    // PORT NOTE: Zig left this `undefined` when `!uses_io_pool()`; `Option` makes
    // that explicit. Stored as a raw pointer because all `ThreadPoolLib` driver
    // methods (`schedule`, `warm`, `wake_for_idle_events`) take `&self`.
    pub io_pool: Option<NonNull<ThreadPoolLib::ThreadPool>>,
    // TODO(port): lifetime — TSV class UNKNOWN. Conditionally owned via
    // `worker_pool_is_owned`; kept raw so callers (bundle_v2.rs draft) can
    // dereference for `wake_for_idle_events()` without a borrow on `ThreadPool`.
    pub worker_pool: *mut ThreadPoolLib::ThreadPool,
    pub worker_pool_is_owned: bool,
    // PORT NOTE: Zig had `workers_assignments` + sibling `workers_assignments_lock`.
    // Per PORTING.md §Concurrency ("Mutex<T> owns T"), the lock is folded into
    // the field so `get_worker` can take `&self` — `Worker::get` is entered
    // concurrently from arbitrary worker-pool threads, and a `&mut self` here
    // would alias `&mut ThreadPool` across threads (UB before the lock is even
    // reached).
    pub workers_assignments: parking_lot::Mutex<ArrayHashMap<ThreadId, *mut Worker>>,
    // BACKREF (LIFETIMES.tsv row 170: ThreadPool.v2). `BundleV2` is generic
    // over `'a`; erase to `'static` behind the raw pointer like ParseTask.ctx.
    pub v2: *const BundleV2<'static>,
}

// SAFETY: `ThreadPool` is shared across worker threads; the only mutated
// field (`workers_assignments`) is guarded by its `parking_lot::Mutex`, and
// the raw-pointer fields are externally synchronized exactly as in the Zig
// source.
unsafe impl Send for ThreadPool {}
unsafe impl Sync for ThreadPool {}

impl Default for ThreadPool {
    /// Placeholder so `bundle_v2` can `arena().alloc(ThreadPool::default())`
    /// before overwriting with [`ThreadPool::init`]. Mirrors Zig's
    /// `arena.create(ThreadPool)` which yields uninit memory.
    fn default() -> Self {
        Self {
            io_pool: None,
            worker_pool: ptr::null_mut(),
            worker_pool_is_owned: false,
            workers_assignments: parking_lot::Mutex::new(ArrayHashMap::default()),
            v2: ptr::null(),
        }
    }
}

mod io_thread_pool {
    use super::*;

    // PORTING.md §Global mutable state: init/drop guarded by `MUTEX` +
    // `REF_COUNT`. RacyCell so accessors stay in raw-ptr land; the mutex
    // provides synchronization.
    static THREAD_POOL: bun_core::RacyCell<MaybeUninit<ThreadPoolLib::ThreadPool>> =
        bun_core::RacyCell::new(MaybeUninit::uninit());
    /// Protects initialization and deinitialization of the IO thread pool.
    static MUTEX: Mutex = {
        // PORT NOTE: `Mutex` derives `Default` but `Default::default()` isn't
        // `const`. The Zig source used `bun.threading.Mutex{}` (zero-init);
        // an all-zero `Mutex` is the documented unlocked state on every impl.
        // SAFETY: `Mutex` is `repr(Rust)` over an atomic / Futex word; zero is
        // the valid initial value (matches `#[derive(Default)]`).
        unsafe { bun_core::ffi::zeroed_unchecked() }
    };
    /// 0 means not initialized. 1 means initialized but not used.
    /// N > 1 means N-1 `ThreadPool`s are using the IO thread pool.
    static REF_COUNT: AtomicUsize = AtomicUsize::new(0);

    pub fn acquire() -> NonNull<ThreadPoolLib::ThreadPool> {
        let mut count = REF_COUNT.load(Ordering::Acquire);
        loop {
            if count == 0 {
                break;
            }
            // Relaxed is okay because we already loaded this value with Acquire,
            // and we don't need the store to be Release because the only store that
            // matters is the one that goes from 0 to 1, and that one is Release.
            match REF_COUNT.compare_exchange_weak(
                count,
                count + 1,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => {
                    // SAFETY: REF_COUNT != 0 ⇒ THREAD_POOL is initialized (set under MUTEX below).
                    return unsafe {
                        NonNull::new_unchecked(THREAD_POOL.get().cast::<ThreadPoolLib::ThreadPool>())
                    };
                }
                Err(actual) => count = actual,
            }
        }

        let _guard = MUTEX.lock_guard();

        // Relaxed because the store we care about (the one that stores 1 to
        // indicate the thread pool is initialized) is guarded by the mutex.
        if REF_COUNT.load(Ordering::Relaxed) == 0 {
            // SAFETY: we hold MUTEX and REF_COUNT == 0, so no other thread is reading THREAD_POOL.
            unsafe {
                (*THREAD_POOL.get()).write(ThreadPoolLib::ThreadPool::init(ThreadPoolLib::Config {
                    max_threads: u32::from(bun_core::get_thread_count().min(4).max(2)),
                    // Use a much smaller stack size for the IO thread pool
                    stack_size: 512 * 1024,
                }));
            }
            // 2 means initialized and referenced by one `ThreadPool`.
            REF_COUNT.store(2, Ordering::Release);
        } else {
            // PORT NOTE: Zig fell through to `return &thread_pool` without
            // bumping the ref count here, which is a latent bug in the source
            // (the racing acquirer's reference isn't counted). Mirrored.
        }
        // SAFETY: just initialized (or observed initialized) above.
        unsafe { NonNull::new_unchecked(THREAD_POOL.get().cast::<ThreadPoolLib::ThreadPool>()) }
    }

    pub fn release() {
        let old = REF_COUNT.fetch_sub(1, Ordering::Release);
        debug_assert!(old > 1, "IOThreadPool: too many calls to release()");
    }

    pub fn shutdown() -> bool {
        // Acquire instead of AcqRel is okay because we only need to ensure that other
        // threads are done using the IO pool if we read 1 from the ref count.
        //
        // Relaxed is okay because this function is only guaranteed to succeed when we
        // can ensure that no `ThreadPool`s exist.
        if REF_COUNT
            .compare_exchange(1, 0, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            // At least one `ThreadPool` still exists.
            return false;
        }

        let _guard = MUTEX.lock_guard();

        // Relaxed is okay because the only store that could happen at this point
        // is guarded by the mutex.
        if REF_COUNT.load(Ordering::Relaxed) != 0 {
            return false;
        }
        // SAFETY: we hold MUTEX, REF_COUNT == 0, and we previously CAS'd from 1 ⇒ initialized.
        unsafe {
            (*THREAD_POOL.get()).assume_init_drop();
        }
        // PORT NOTE: Zig source falls off the end of a `bool`-returning fn here
        // (`thread_pool = undefined;` is the last statement). Assuming `true`.
        true
    }
}

impl ThreadPool {
    /// Inherent associated type so call sites that wrote
    /// `ThreadPool::Worker::get(ctx)` (matching Zig's `ThreadPool.Worker`)
    /// resolve without a separate module path.
    pub type Worker = Worker;

    // PORT NOTE: generic over `V2` because `bundle_v2.rs` currently carries two
    // `BundleV2` definitions (the canonical one + `_the gated draft block (now dissolved)::BundleV2`)
    // during the phased port, and both call `ThreadPool::init`. The backref is
    // stored as a type-erased raw pointer (`.cast()`) regardless, so the
    // monomorphised body is identical. Collapses to `&BundleV2<'_>` once the
    // draft module is dropped.
    pub fn init<V2>(
        v2: &V2,
        // `Option<NonNull<_>>` (not `Option<&mut _>`): callers pass the
        // process-wide `WorkPool` singleton (`OnceLock`-backed, shared across
        // worker threads). Materializing `&mut` from that provenance is UB
        // under Stacked Borrows even if the body never writes through it; the
        // pool is stored as `*mut` in the struct anyway, so keep it raw
        // end-to-end.
        worker_pool: Option<NonNull<ThreadPoolLib::ThreadPool>>,
    ) -> Result<ThreadPool, bun_alloc::AllocError> {
        // PORT NOTE: Spec ThreadPool.zig:85 allocated via the bundle arena
        // (`v2.arena().create`), so the `false` ownership flag was
        // harmless — the arena reclaimed it. Here we `heap::alloc` (global
        // heap), so `deinit()` must `heap::take` it back; record ownership.
        let owned = worker_pool.is_none();
        let pool: *mut ThreadPoolLib::ThreadPool = match worker_pool {
            Some(p) => p.as_ptr(),
            None => {
                let cpu_count = bun_core::get_thread_count();
                // PERF(port): was `v2.arena().create(ThreadPoolLib)` —
                // using heap::alloc (global mimalloc).
                let pool = bun_core::heap::into_raw(Box::new(ThreadPoolLib::ThreadPool::init(
                    ThreadPoolLib::Config { max_threads: u32::from(cpu_count), ..Default::default() },
                )));
                bun_core::scoped_log!(ThreadPool, "{} workers", cpu_count);
                pool
            }
        };
        let mut this = Self::init_with_pool(v2, pool);
        this.worker_pool_is_owned = owned;
        Ok(this)
    }

    pub fn init_with_pool<V2>(v2: &V2, worker_pool: *mut ThreadPoolLib::ThreadPool) -> ThreadPool {
        ThreadPool {
            worker_pool,
            io_pool: if Self::uses_io_pool() { Some(io_thread_pool::acquire()) } else { None },
            // BACKREF: lifetime erased behind the raw pointer.
            v2: std::ptr::from_ref::<V2>(v2).cast(),
            worker_pool_is_owned: false,
            workers_assignments: parking_lot::Mutex::new(ArrayHashMap::default()),
        }
    }

    /// Explicit teardown — Zig callers spell `pool.deinit()` (no Drop on
    /// `ThreadPool` because `Graph.pool` is `NonNull<ThreadPool>` and the arena
    /// owns the storage).
    pub fn deinit(&mut self) {
        if self.worker_pool_is_owned {
            // SAFETY: worker_pool was heap-allocated in `init()` when owned.
            unsafe { drop(bun_core::heap::take(self.worker_pool)) };
            self.worker_pool = ptr::null_mut();
        }
        if Self::uses_io_pool() {
            io_thread_pool::release();
        }
    }

    /// Safe accessor for the underlying `bun_threading::ThreadPool`. The
    /// pointer is set in `init`/`init_with_pool` and never null while `self`
    /// is observable; encapsulating the deref keeps callers out of `unsafe`.
    #[inline]
    pub fn worker_pool(&self) -> &ThreadPoolLib::ThreadPool {
        debug_assert!(!self.worker_pool.is_null());
        // SAFETY: `worker_pool` is initialized before any caller can observe
        // `self` and lives until `deinit_v2`; all driver methods take `&self`.
        unsafe { &*self.worker_pool }
    }

    pub fn start(&self) {
        self.worker_pool().warm(8);
        if let Some(io) = self.io_pool {
            // SAFETY: io points to the module-static THREAD_POOL, live while ref_count > 0.
            unsafe { io.as_ref().warm(1) };
        }
    }

    pub fn uses_io_pool() -> bool {
        if env_var::feature_flag::BUN_FEATURE_FLAG_FORCE_IO_POOL.get() == Some(true) {
            // For testing.
            return true;
        }

        if env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_IO_POOL.get() == Some(true) {
            // For testing.
            return false;
        }

        #[cfg(any(target_os = "macos", windows))]
        {
            // 4 was the sweet spot on macOS. Didn't check the sweet spot on Windows.
            return bun_core::get_thread_count() > 3;
        }

        #[allow(unreachable_code)]
        false
    }

    /// Shut down the IO pool, if and only if no `ThreadPool`s exist right now.
    /// If a `ThreadPool` exists, this function is a no-op and returns false.
    /// Blocks until the IO pool is shut down.
    pub fn shutdown_io_pool() -> bool {
        if Self::uses_io_pool() { io_thread_pool::shutdown() } else { true }
    }

    pub fn schedule_with_options(&self, parse_task: &mut ParseTask, is_inside_thread_pool: bool) {
        if matches!(parse_task.contents_or_fd, ContentsOrFd::Contents(_))
            && matches!(parse_task.stage, ParseTaskStage::NeedsSourceCode)
        {
            let ContentsOrFd::Contents(contents) = parse_task.contents_or_fd else {
                unreachable!()
            };
            // PORT NOTE: Zig moved the `[]const u8` slice into the cache entry
            // by value. `cache::Contents` has no borrowed-slice variant; the
            // contract (see ParseTask.rs `run_with_source_code` defer) is that
            // `entry.deinit()` is *skipped* when `contents_or_fd == .contents`,
            // so an `External` provenance tag (no-op deinit) is the correct
            // mapping for these unowned bytes.
            parse_task.stage = ParseTaskStage::NeedsParse(CacheEntry {
                contents: if contents.is_empty() {
                    Contents::Empty
                } else {
                    Contents::External { ptr: contents.as_ptr(), len: contents.len() }
                },
                fd: Fd::INVALID,
                external_free_function: ExternalFreeFunction::NONE,
            });
        }

        let schedule_fn: fn(&ThreadPoolLib::ThreadPool, ThreadPoolLib::Batch) = if is_inside_thread_pool {
            ThreadPoolLib::ThreadPool::schedule_inside_thread_pool
        } else {
            ThreadPoolLib::ThreadPool::schedule
        };

        if Self::uses_io_pool() {
            match parse_task.stage {
                ParseTaskStage::NeedsParse(_) => {
                    schedule_fn(self.worker_pool(), ThreadPoolLib::Batch::from(&raw mut parse_task.task));
                }
                ParseTaskStage::NeedsSourceCode => {
                    // SAFETY: io_pool is Some when uses_io_pool(); points to live static.
                    let io = unsafe { self.io_pool.unwrap_unchecked().as_ref() };
                    schedule_fn(io, ThreadPoolLib::Batch::from(&raw mut parse_task.io_task));
                }
            }
        } else {
            schedule_fn(self.worker_pool(), ThreadPoolLib::Batch::from(&raw mut parse_task.task));
        }
    }

    // PORT NOTE: takes `*mut` (Zig: `*ParseTask`) so callers can pass either a
    // raw heap pointer (e.g. `load.parse_task`) or a `&mut` (auto-coerces).
    pub fn schedule(&self, parse_task: *mut ParseTask) {
        // SAFETY: caller passes a live, exclusively-owned ParseTask (heap- or
        // arena-allocated raw pointer); see call sites in bundle_v2.rs.
        self.schedule_with_options(unsafe { &mut *parse_task }, false);
    }

    pub fn schedule_inside_thread_pool(&self, parse_task: *mut ParseTask) {
        // SAFETY: see `schedule` above.
        self.schedule_with_options(unsafe { &mut *parse_task }, true);
    }

    // PORT NOTE: returns `&'static mut` — the `Worker` is `heap::alloc`'d
    // below and lives until `Worker::deinit`; detaching from `&self` lets
    // callers re-borrow `ThreadPool` while holding the worker (Zig: `*Worker`).
    // Takes `&self` (not `&mut`) because this is called concurrently from
    // worker-pool threads via `Worker::get`; mutation goes through the
    // `parking_lot::Mutex` on `workers_assignments`.
    pub fn get_worker(&self, id: ThreadId) -> &'static mut Worker {
        let worker: *mut Worker;
        {
            let mut map = self.workers_assignments.lock();
            match map.entry(id) {
                MapEntry::Occupied(o) => {
                    let w = *o.into_mut();
                    drop(map);
                    // SAFETY: map only stores live heap-allocated Workers (inserted below).
                    return unsafe { &mut *w };
                }
                MapEntry::Vacant(v) => {
                    // SAFETY: every field is fully written below before any read.
                    // Zig wrote a struct literal with `undefined` for the
                    // late-init fields; mirrored with `Option` slots.
                    worker = bun_core::heap::into_raw(unsafe { Box::<Worker>::new_uninit().assume_init() });
                    v.insert(worker);
                }
            }
        }

        // SAFETY: `worker` is freshly heap-allocated and exclusive on this
        // thread until published via the map (already inserted above, but no
        // other thread looks it up under a different `id`).
        unsafe {
            worker.write(Worker {
                ctx: self.v2,
                heap: None,
                arena: ptr::null(),
                thread: ThreadPoolLib::Thread::current(),
                data: None,
                quit: false,
                ast_memory_store: ManuallyDrop::new(js_ast::ASTMemoryAllocator::default()),
                has_created: false,
                deinit_task: ThreadPoolLib::Task {
                    node: ThreadPoolLib::Node::default(),
                    callback: Worker::deinit_callback,
                },
                temporary_arena: None,
                stmt_list: None,
            });
            (*worker).init(&*self.v2);
            &mut *worker
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Worker
// ───────────────────────────────────────────────────────────────────────────

/// Per-OS-thread bundler state. Heap-allocated and pinned (the
/// `deinit_task`/`arena` fields are self-referential); never moved after
/// `get_worker` boxes it.
pub struct Worker {
    /// Thread-local arena. `None` until [`Worker::create`] runs (Zig wrote
    /// `undefined`); every read site is post-`has_created`.
    pub heap: Option<ThreadLocalArena>,

    /// Thread-local memory arena
    /// All allocations are freed in `deinit` at the very end of bundling.
    // PORT NOTE: self-referential borrow of `heap` — kept as a raw pointer so
    // it can be reseated in `create()` without a self-borrow. Zig stored the
    // `std.mem.Allocator` vtable; here it's just `&heap`.
    pub arena: *const ThreadLocalArena,

    pub ctx: *const BundleV2<'static>,

    /// `None` until [`Worker::create`] populates it; every read site is
    /// post-`has_created`.
    pub data: Option<WorkerData>,
    pub quit: bool,

    pub ast_memory_store: ManuallyDrop<js_ast::ASTMemoryAllocator>,
    pub has_created: bool,
    /// `ThreadPoolLib.Thread.current` — null when called off a pool thread.
    pub thread: *mut ThreadPoolLib::Thread,

    pub deinit_task: ThreadPoolLib::Task,

    pub temporary_arena: Option<bun_alloc::Arena>,
    pub stmt_list: Option<StmtList>,
}

impl Worker {
    /// Reborrow the self-referential `arena` (= `&self.heap`) as a shared
    /// reference. Centralises the per-call-site `unsafe { &*worker.arena }`
    /// into one accessor; see PORT NOTE on the field.
    ///
    /// SAFETY (encapsulated): `arena` is set to `&self.heap` in
    /// [`Worker::create`] before any caller can observe the `Worker`, and is
    /// never null or dangling after that point. The pointee is the worker's
    /// own `heap` field, which is pinned for the worker's lifetime.
    #[inline]
    pub fn arena(&self) -> &ThreadLocalArena {
        debug_assert!(!self.arena.is_null(), "Worker.arena read before create()");
        // SAFETY: see fn doc — self-referential, set in create(), never null.
        unsafe { &*self.arena }
    }
}

pub struct WorkerData {
    // TODO(port): lifetime — TSV class ARENA (`&'arena mut Logger::Log`); kept
    // raw because the arena is the sibling field `Worker.heap`.
    pub log: *mut Logger::Log,
    pub estimated_input_lines_of_code: usize,
    // PORT NOTE: lifetime erased to `'static` — the inner `&'a Arena` borrows
    // `Worker.heap`, which Rust can't express on a sibling field. Zig used
    // `transpiler: Transpiler` with a copied `std.mem.Allocator`.
    //
    // Owned (no `MaybeUninit`): `Transpiler::for_worker` deep-clones every
    // `Drop`-carrying field, so `WorkerData`'s drop (via
    // `ptr::drop_in_place(data)` in `Worker::deinit`) is sound and frees the
    // per-worker `options`/`resolver.caches`/etc. without touching the parent.
    pub transpiler: Transpiler<'static>,
    pub other_transpiler: Option<Box<Transpiler<'static>>>,
}

impl Worker {
    // CONCURRENCY: thread-pool callback — runs on the worker's own OS thread
    // during pool drain (scheduled via `deinit_soon`). Writes: own `Worker`
    // fields only (`heap`, `data`, `ast_memory_store` teardown). The `Worker`
    // is per-OS-thread (`Thread::current()`-keyed), so `&mut *this` is unique.
    // `Worker` is `Send` because its arena/backref pointers are
    // owned-heap or per-thread; the `unsafe impl Send for ThreadPool` (the
    // bundler pool that owns the workers vec) covers the cross-thread move.
    /// SAFETY: `task` must be the `deinit_task` field of a live boxed `Worker`.
    pub unsafe fn deinit_callback(task: *mut ThreadPoolLib::Task) {
        bun_core::scoped_log!(ThreadPool, "Worker.deinit()");
        // SAFETY: task points to Worker.deinit_task; offset_of recovers the parent.
        let this: *mut Worker = unsafe {
            bun_core::from_field_ptr!(Worker, deinit_task, task)
        };
        // SAFETY: deinit_callback is only scheduled via `deinit_soon` on a live
        // heap-allocated Worker; we hold exclusive ownership on this idle task.
        unsafe { Self::deinit(this) };
    }

    pub fn deinit_soon(&mut self) {
        if let Some(thread) = unsafe { self.thread.as_ref() } {
            thread.push_idle_task(&raw mut self.deinit_task);
        }
    }

    /// Takes ownership of the heap allocation and frees it.
    ///
    /// # Safety
    /// `this` must have come from `heap::alloc` in [`ThreadPool::get_worker`].
    pub unsafe fn deinit(this: *mut Worker) {
        // SAFETY: caller contract.
        let worker = unsafe { &mut *this };
        if worker.has_created {
            // Drop order: `data` (whose `transpiler.arena` borrows `heap`) and
            // `ast_memory_store` first, then the arenas they reference.
            worker.data = None;
            // SAFETY: `ast_memory_store` is always a valid `ManuallyDrop` (written
            // in `get_worker`, reset in `create()`); dropped exactly once here.
            unsafe { ManuallyDrop::drop(&mut worker.ast_memory_store) };
            worker.temporary_arena = None;
            worker.stmt_list = None;
            worker.heap = None;
        }
        // SAFETY: caller contract — `this` was heap-allocated. Reclaim the
        // allocation without running field destructors (handled above).
        unsafe { bun_core::heap::destroy(this.cast::<MaybeUninit<Worker>>()) };
    }

    // PORT NOTE: returns `&'static mut` (detached) — the `Worker` is
    // heap-pinned (heap::alloc in `get_worker`) and outlives any `ctx`
    // borrow; Zig returned `*Worker`. Tying it to `ctx`'s lifetime would
    // forbid the `worker` ↔ `ctx` re-borrows in `ParseTask::run_*`.
    pub fn get(ctx: &BundleV2<'_>) -> &'static mut Worker {
        // SAFETY: `ctx` is a BACKREF; `graph.pool` is a `NonNull<ThreadPool>`
        // pointing at the bundle-owned pool that outlives every worker. We only
        // need a shared `&ThreadPool` — `get_worker` takes `&self` and serializes
        // map mutation via the internal `parking_lot::Mutex`, so concurrent
        // entry from multiple worker threads is sound.
        let pool: &ThreadPool = ctx.graph.pool();
        let worker = pool.get_worker(bun_threading::current_thread_id());
        if !worker.has_created {
            worker.create(ctx);
        }

        worker.ast_memory_store.push();

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            // PORT NOTE: `MimallocArena::help_catch_memory_issues` collected
            // mimalloc's deferred frees + zero-filled freed pages. The Rust
            // arena is `bumpalo::Bump`, which has no equivalent — calls
            // dropped, gated on the real `MimallocArena` un-gate
            // (`bun_alloc/MimallocArena.rs` is ``).
        }

        worker
    }

    pub fn unget(&mut self) {
        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            // See `get()` — `help_catch_memory_issues` no-op while heap = Bump.
        }

        self.ast_memory_store.pop();
    }

    pub fn init(&mut self, v2: &BundleV2<'_>) {
        self.ctx = std::ptr::from_ref::<BundleV2<'_>>(v2).cast();
    }

    fn create(&mut self, ctx: &BundleV2<'_>) {
        // PORT NOTE: `bun_perf::trace` takes a generated `PerfEvent` enum, and
        // the generator hasn't emitted `Bundler.Worker.create` yet (only
        // `_Stub`). Dropped to avoid mis-attributing the span.
        // let _trace = bun_perf::trace("Bundler.Worker.create");

        self.has_created = true;
        Output::Source::configure_thread();
        // Self-referential — `arena` borrows `self.heap`. `Option::insert`
        // returns the stable address of the in-place payload (Worker is
        // heap-pinned, so this never moves).
        self.arena = std::ptr::from_ref::<ThreadLocalArena>(
            self.heap.insert(ThreadLocalArena::new()),
        );

        let arena = self.arena;

        // Zig: `.{ .arena = this.arena }` then `reset()`. The Rust
        // ASTMemoryAllocator owns its bump arena internally and ignores the
        // passed fallback (see ASTMemoryAllocator::new doc).
        // SAFETY: arena points to the just-initialized self.heap.
        *self.ast_memory_store =
            js_ast::ASTMemoryAllocator::new(unsafe { &*arena });
        self.ast_memory_store.reset();

        // SAFETY: arena points to self.heap which outlives self.data.
        let log: *mut Logger::Log = unsafe { (*arena).alloc(Logger::Log::init()) };
        self.ctx = std::ptr::from_ref::<BundleV2<'_>>(ctx).cast();
        // PERF(port): was `bun.ArenaAllocator.init(this.arena)` — using a
        // fresh Bump (no nested-arena type yet).
        self.temporary_arena = Some(bun_alloc::Arena::new());
        self.stmt_list = Some(StmtList::init());
        // SAFETY: `arena` points at `self.heap` (initialized above), which is
        // heap-pinned and outlives `WorkerData`; lifetime erased to `'static`
        // to match the slot's erased `Transpiler<'static>`.
        let arena_ref: &'static ThreadLocalArena = unsafe { &*arena };
        let data = self.data.insert(WorkerData {
            log,
            estimated_input_lines_of_code: 0,
            transpiler: Self::initialize_transpiler(log, ctx.transpiler(), arena_ref),
            other_transpiler: None,
        });
        // Wire self-referential `linker`/`macro_context` now that `transpiler`
        // is at its final address inside `WorkerData`.
        data.transpiler.wire_after_move();

        bun_core::scoped_log!(ThreadPool, "Worker.create()");
    }

    /// Build a per-worker `Transpiler` from `from` (Zig: `transpiler.* = from.*`).
    ///
    /// PORT NOTE: reshaped for borrowck — associated fn (no `&mut self`) so
    /// callers can borrow `self.data.log` disjointly. The returned value is a
    /// fully-owned `Transpiler` whose `Drop` is sound; `wire_after_move` must
    /// be called once it is at its final address.
    fn initialize_transpiler(
        log: *mut Logger::Log,
        from: &Transpiler<'_>,
        arena: &'static ThreadLocalArena,
    ) -> Transpiler<'static> {
        // SAFETY: `from` is the `BundleV2`-owned transpiler (or its
        // `client_transpiler`), which outlives every worker; the
        // `&'a`-carrying fields inside reference process-lifetime data.
        unsafe { Transpiler::<'static>::for_worker(from, arena, log) }
    }

    pub fn transpiler_for_target(&mut self, target: Target) -> &mut Transpiler<'static> {
        // Callers only invoke this after `Worker::get` → `create()`.
        let data = self.data.as_mut().expect("Worker.data set in create()");
        if target == Target::Browser && data.transpiler.options.target != target {
            if data.other_transpiler.is_none() {
                // SAFETY: `ctx` is a valid backref; `client_transpiler` must be
                // Some in this branch per Zig `.?`.
                let client: &Transpiler<'_> =
                    unsafe { (*self.ctx).client_transpiler.unwrap_unchecked().as_ref() };
                // SAFETY: `self.arena` points at `self.heap` (set in `create()`),
                // pinned for the worker's lifetime.
                let arena_ref: &'static ThreadLocalArena = unsafe { &*self.arena };
                let mut boxed =
                    Box::new(Self::initialize_transpiler(data.log, client, arena_ref));
                // Wire self-refs after the value reached its final (heap) address.
                boxed.wire_after_move();
                data.other_transpiler = Some(boxed);
            }
            // SAFETY: just populated above (or on a prior call).
            let other = unsafe { data.other_transpiler.as_deref_mut().unwrap_unchecked() };
            debug_assert!(other.options.target == target);
            return other;
        }

        &mut data.transpiler
    }

    pub fn run(&mut self, ctx: &BundleV2<'_>) {
        if !self.has_created {
            self.create(ctx);
        }
    }
}

pub use bun_js_parser::Ref;
pub use bun_js_parser::Index;

// ported from: src/bundler/ThreadPool.zig
