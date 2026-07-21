//! The bundler-side worker pool that
//! wraps `bun_threading::thread_pool::ThreadPool` and owns the per-thread
//! [`Worker`] state (mimalloc arena, per-thread `Transpiler` clone, AST store).
//!
//! `Worker::create` / `initialize_transpiler` build the per-worker
//! `Transpiler` via `Transpiler::for_worker` (per-field deep clone — no
//! bitwise struct copy); the `linker.resolver` backref is wired by
//! `Transpiler::wire_after_move` once the value is at its final address.

use core::mem::{ManuallyDrop, MaybeUninit};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena as ThreadLocalArena;
use bun_collections::{ArrayHashMap, MapEntry};
use bun_core::{self, env_var, output as Output};
use bun_sys::Fd;
use bun_threading::{Mutex, thread_pool as ThreadPoolLib};

use crate::cache::{Contents, Entry as CacheEntry};
use crate::linker_context_mod::StmtList;
// `crate::options::Target` is the lower-tier `bun_options_types`
// enum (re-exported for downstream crates); `BundleOptions.target` is the
// file-backed `options_impl::Target`. Compare against the latter so
// `primary.options.target == target` type-checks. (The two enums could be
// collapsed into one; see lib.rs `pub mod options` shadow note.)
use crate::BundleV2;
use crate::options_impl::Target;
use crate::parse_task::{ContentsOrFd, ParseTask, ParseTaskStage};
use crate::transpiler::Transpiler;
use bun_js_parser as js_ast;

bun_core::declare_scope!(ThreadPool, visible);

/// `std.Thread.Id` — `bun_threading::current_thread_id()` returns `u64` on
/// every platform (`gettid`/`pthread_threadid_np`/`GetCurrentThreadId`).
pub(crate) type ThreadId = u64;

pub struct ThreadPool {
    /// macOS holds an IORWLock on every file open.
    /// This causes massive contention after about 4 threads as of macOS 15.2
    /// On Windows, this seemed to be a small performance improvement.
    /// On Linux, this was a performance regression.
    /// In some benchmarks on macOS, this yielded up to a 60% performance improvement in microbenchmarks that load ~10,000 files.
    // `None` when `!uses_io_pool()`.
    // `ParentRef` (not raw `NonNull`) because the pointee is the
    // module-static `io_thread_pool::THREAD_POOL`, live while `ref_count > 0`,
    // and all `ThreadPoolLib` driver methods (`schedule`, `warm`,
    // `wake_for_idle_events`) take `&self` — so the safe `Deref` projection is
    // sufficient and the per-read `unsafe { p.as_ref() }` disappears.
    pub io_pool: Option<bun_ptr::ParentRef<ThreadPoolLib::ThreadPool>>,
    // Conditionally owned via `worker_pool_is_owned`; kept raw so callers
    // (bundle_v2.rs) can dereference for `wake_for_idle_events()` without a
    // borrow on `ThreadPool`.
    pub worker_pool: *mut ThreadPoolLib::ThreadPool,
    pub worker_pool_is_owned: bool,
    // Per PORTING.md §Concurrency ("Mutex<T> owns T"), the lock is folded into
    // the field so `get_worker` can take `&self` — `Worker::get` is entered
    // concurrently from arbitrary worker-pool threads, and a `&mut self` here
    // would alias `&mut ThreadPool` across threads (UB before the lock is even
    // reached).
    pub workers_assignments: bun_threading::Guarded<ArrayHashMap<ThreadId, *mut Worker>>,
    /// Monotonic per-pool stamp for the [`TLS_WORKER`] fast-path key. Pointer
    /// identity is unsound across `Bun.build()` calls (mimalloc reuses the
    /// freed slot), so each pool draws a fresh `u64` from [`POOL_GENERATION`].
    pub generation: u64,
    // BACKREF (LIFETIMES.tsv row 170: ThreadPool.v2). `BundleV2` is generic
    // over `'a`; erase to `'static` behind the raw pointer like ParseTask.ctx.
    pub v2: *const BundleV2<'static>,
}

// SAFETY: `ThreadPool` is shared across worker threads; the only mutated
// field (`workers_assignments`) is guarded by its `bun_threading::Guarded`, and
// the raw-pointer fields are set during init, before the pool is shared with
// worker threads, and only read thereafter (mutation in `deinit` happens on the
// owning thread after the workers are done).
unsafe impl Send for ThreadPool {}
// SAFETY: `&ThreadPool` is read concurrently from worker-pool threads via
// `get_worker(&self)`; the only field mutated under `&self` is
// `workers_assignments` (through its `bun_threading::Guarded` lock), and the
// raw-pointer targets (`ThreadPoolLib::ThreadPool`, `BundleV2`) are `Sync`.
unsafe impl Sync for ThreadPool {}

mod io_thread_pool {
    use super::*;

    // PORTING.md §Global mutable state: init/drop guarded by `MUTEX` +
    // `REF_COUNT`. RacyCell so accessors stay in raw-ptr land; the mutex
    // provides synchronization.
    static THREAD_POOL: bun_core::RacyCell<MaybeUninit<ThreadPoolLib::ThreadPool>> =
        bun_core::RacyCell::new(MaybeUninit::uninit());
    /// Protects initialization and deinitialization of the IO thread pool.
    static MUTEX: Mutex = {
        // `Mutex` derives `Default` but `Default::default()` isn't
        // `const`. An all-zero `Mutex` is the documented unlocked state on
        // every impl.
        // SAFETY: `Mutex` is `repr(Rust)` over an atomic / Futex word; zero is
        // the valid initial value (matches `#[derive(Default)]`).
        unsafe { bun_core::ffi::zeroed_unchecked() }
    };
    /// 0 means not initialized. 1 means initialized but not used.
    /// N > 1 means N-1 `ThreadPool`s are using the IO thread pool.
    static REF_COUNT: AtomicUsize = AtomicUsize::new(0);

    pub(super) fn acquire() -> NonNull<ThreadPoolLib::ThreadPool> {
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
                    // REF_COUNT != 0 ⇒ THREAD_POOL is initialized (set under MUTEX below).
                    // `UnsafeCell::get` never returns null.
                    return NonNull::new(THREAD_POOL.get().cast::<ThreadPoolLib::ThreadPool>())
                        .expect("UnsafeCell::get is non-null");
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
                (*THREAD_POOL.get()).write(ThreadPoolLib::ThreadPool::init(
                    ThreadPoolLib::Config {
                        max_threads: u32::from(bun_core::get_thread_count().clamp(2, 4)),
                        // Use a much smaller stack size for the IO thread pool
                        stack_size: 512 * 1024,
                    },
                ));
            }
            // 2 means initialized and referenced by one `ThreadPool`.
            REF_COUNT.store(2, Ordering::Release);
        } else {
            // NOTE: a racing acquirer that reaches here does not bump the ref
            // count — a latent under-count, preserved intentionally.
        }
        // Just initialized (or observed initialized) above. `UnsafeCell::get` never returns null.
        NonNull::new(THREAD_POOL.get().cast::<ThreadPoolLib::ThreadPool>())
            .expect("UnsafeCell::get is non-null")
    }

    pub(super) fn release() {
        let old = REF_COUNT.fetch_sub(1, Ordering::Release);
        debug_assert!(old > 1, "IOThreadPool: too many calls to release()");
    }

    pub(super) fn shutdown() -> bool {
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
        true
    }
}

impl ThreadPool {
    /// Inherent associated type so call sites that wrote
    /// `ThreadPool::Worker::get(ctx)`
    /// resolve without a separate module path.
    pub type Worker = Worker;

    pub fn init(
        v2: &BundleV2<'_>,
        // `Option<NonNull<_>>` (not `Option<&mut _>`): callers pass the
        // process-wide `WorkPool` singleton (`OnceLock`-backed, shared across
        // worker threads). Materializing `&mut` from that provenance is UB
        // under Stacked Borrows even if the body never writes through it; the
        // pool is stored as `*mut` in the struct anyway, so keep it raw
        // end-to-end.
        worker_pool: Option<NonNull<ThreadPoolLib::ThreadPool>>,
    ) -> Result<ThreadPool, bun_alloc::AllocError> {
        // The pool is `heap::alloc`'d (global
        // heap), so `deinit()` must `heap::take` it back; record ownership.
        let owned = worker_pool.is_none();
        let pool: *mut ThreadPoolLib::ThreadPool = match worker_pool {
            Some(p) => p.as_ptr(),
            None => {
                let cpu_count = bun_core::get_thread_count();
                let pool = bun_core::heap::into_raw(Box::new(ThreadPoolLib::ThreadPool::init(
                    ThreadPoolLib::Config {
                        max_threads: u32::from(cpu_count),
                        ..Default::default()
                    },
                )));
                bun_core::scoped_log!(ThreadPool, "{} workers", cpu_count);
                pool
            }
        };
        let mut this = Self::init_with_pool(v2, pool);
        this.worker_pool_is_owned = owned;
        Ok(this)
    }

    pub fn init_with_pool(
        v2: &BundleV2<'_>,
        worker_pool: *mut ThreadPoolLib::ThreadPool,
    ) -> ThreadPool {
        ThreadPool {
            worker_pool,
            io_pool: if Self::uses_io_pool() {
                Some(io_thread_pool::acquire().into())
            } else {
                None
            },
            // BACKREF: lifetime erased behind the raw pointer.
            v2: std::ptr::from_ref(v2).cast::<BundleV2<'static>>(),
            worker_pool_is_owned: false,
            workers_assignments: bun_threading::Guarded::new(ArrayHashMap::default()),
            generation: POOL_GENERATION.fetch_add(1, Ordering::Relaxed),
        }
    }

    /// Explicit teardown (no Drop on
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

    /// Safe accessor for the IO pool. `Some` only when `uses_io_pool()`; the
    /// pointee is the module-static `io_thread_pool::THREAD_POOL`, live while
    /// `ref_count > 0` (i.e. while any bundler `ThreadPool` exists).
    #[inline]
    pub fn io_pool_ref(&self) -> Option<&ThreadPoolLib::ThreadPool> {
        self.io_pool.as_deref()
    }

    pub fn start(&self) {
        self.worker_pool().warm(8);
        if let Some(io) = self.io_pool_ref() {
            io.warm(1);
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

        // 4 was the sweet spot on macOS. Didn't check the sweet spot on Windows.
        #[cfg(any(target_os = "macos", windows))]
        return bun_core::get_thread_count() > 3;
        #[cfg(not(any(target_os = "macos", windows)))]
        return false;
    }

    /// Shut down the IO pool, if and only if no `ThreadPool`s exist right now.
    /// If a `ThreadPool` exists, this function is a no-op and returns false.
    /// Blocks until the IO pool is shut down.
    pub fn shutdown_io_pool() -> bool {
        if Self::uses_io_pool() {
            io_thread_pool::shutdown()
        } else {
            true
        }
    }

    fn schedule_with_options(&self, parse_task: *mut ParseTask, is_inside_thread_pool: bool) {
        // SAFETY: callers (`schedule`/`schedule_inside_thread_pool`) pass a
        // live, exclusively-owned ParseTask (heap- or arena-allocated raw
        // pointer); see call sites in bundle_v2.rs.
        let parse_task = unsafe { &mut *parse_task };
        if matches!(parse_task.contents_or_fd, ContentsOrFd::Contents(_))
            && matches!(parse_task.stage, ParseTaskStage::NeedsSourceCode)
        {
            let ContentsOrFd::Contents(contents) = parse_task.contents_or_fd else {
                unreachable!()
            };
            // `cache::Contents` has no borrowed-slice variant; the
            // contract (see ParseTask.rs `run_with_source_code` defer) is that
            // `entry.deinit()` is *skipped* when `contents_or_fd == .contents`,
            // so an `External` provenance tag (no-op deinit) is the correct
            // mapping for these unowned bytes.
            parse_task.stage = ParseTaskStage::NeedsParse(CacheEntry {
                contents: if contents.is_empty() {
                    Contents::Empty
                } else {
                    Contents::External {
                        ptr: contents.as_ptr(),
                        len: contents.len(),
                    }
                },
                fd: Fd::INVALID,
            });
        }

        let schedule_fn: fn(&ThreadPoolLib::ThreadPool, ThreadPoolLib::Batch) =
            if is_inside_thread_pool {
                ThreadPoolLib::ThreadPool::schedule_inside_thread_pool
            } else {
                ThreadPoolLib::ThreadPool::schedule
            };

        if Self::uses_io_pool() {
            match parse_task.stage {
                ParseTaskStage::NeedsParse(_) => {
                    schedule_fn(
                        self.worker_pool(),
                        ThreadPoolLib::Batch::from(&raw mut parse_task.task),
                    );
                }
                ParseTaskStage::NeedsSourceCode => {
                    // io_pool is Some when uses_io_pool().
                    let io = self.io_pool_ref().unwrap();
                    schedule_fn(io, ThreadPoolLib::Batch::from(&raw mut parse_task.io_task));
                }
            }
        } else {
            schedule_fn(
                self.worker_pool(),
                ThreadPoolLib::Batch::from(&raw mut parse_task.task),
            );
        }
    }

    // takes `*mut` so callers can pass either a
    // raw heap pointer (e.g. `load.parse_task`) or a `&mut` (auto-coerces).
    pub fn schedule(&self, parse_task: *mut ParseTask) {
        self.schedule_with_options(parse_task, false);
    }

    pub fn schedule_inside_thread_pool(&self, parse_task: *mut ParseTask) {
        self.schedule_with_options(parse_task, true);
    }

    // returns `&'static mut` — the `Worker` is `heap::alloc`'d
    // below and lives until `Worker::deinit`; detaching from `&self` lets
    // callers re-borrow `ThreadPool` while holding the worker.
    // Takes `&self` (not `&mut`) because this is called concurrently from
    // worker-pool threads via `Worker::get`; mutation goes through the
    // `bun_threading::Guarded` on `workers_assignments`.
    //
    // Fast path is a per-thread `(pool, worker)` cache: the map lookup is a
    // pure `current_thread_id() → *mut Worker` re-read after first touch, so
    // every subsequent call from the same thread for the same pool is a TLS
    // load + pointer compare. The lock is only taken on first touch per
    // `(thread, pool)` pair. Taking the lock on every
    // call would mean ~100 K contended acquisitions on a 19 K-module build —
    // ~97 % of the build's futex traffic per perf.
    #[inline]
    pub fn get_worker(&self, id: ThreadId) -> &'static mut Worker {
        let (generation, worker) = TLS_WORKER.get();
        if generation == self.generation {
            // SAFETY: cached by `get_worker_slow` on this thread; the Worker is
            // heap-pinned (boxed in the slow path) and live while
            // `self.generation` is — `deinit_soon` runs before the pool is
            // dropped, and a new pool at the same address has a fresh
            // generation, so a stale TLS entry never matches here.
            return unsafe { &mut *worker };
        }
        self.get_worker_slow(id)
    }

    #[cold]
    fn get_worker_slow(&self, id: ThreadId) -> &'static mut Worker {
        let worker: *mut Worker;
        {
            let mut map = self.workers_assignments.lock();
            match map.entry(id) {
                MapEntry::Occupied(o) => {
                    let w = *o.into_mut();
                    drop(map);
                    TLS_WORKER.set((self.generation, w));
                    // SAFETY: map only stores live heap-allocated Workers (inserted below).
                    return unsafe { &mut *w };
                }
                MapEntry::Vacant(v) => {
                    // Allocate raw uninitialized storage; fully written via
                    // `worker.write(...)` below before any read. Keep it as
                    // `*mut MaybeUninit<Worker>` → `.cast()` instead of
                    // `assume_init()` so we never materialize a `Box<Worker>`
                    // whose payload violates `Worker`'s validity invariants
                    // (niche-optimized `Option<_>` discriminants, the non-null
                    // fn-pointer in `deinit_task.callback`, `bool` fields).
                    worker = bun_core::heap::into_raw(Box::<Worker>::new_uninit()).cast::<Worker>();
                    v.insert(worker);
                }
            }
        }

        // SAFETY: `worker` is freshly heap-allocated and exclusive on this
        // thread until published via the map (already inserted above, but no
        // other thread looks it up under a different `id`).
        unsafe {
            worker.write(Worker {
                // Placeholder — overwritten by `init()` immediately below.
                ctx: bun_ptr::BackRef::from(NonNull::<BundleV2<'static>>::dangling()),
                heap: None,
                arena: bun_ptr::BackRef::from(NonNull::<ThreadLocalArena>::dangling()),
                thread: NonNull::new(ThreadPoolLib::Thread::current())
                    .map(bun_ptr::ParentRef::from),
                data: None,
                quit: false,
                ast_memory_store: ManuallyDrop::new(bun_ast::ASTMemoryAllocator::default()),
                has_created: false,
                deinit_task: ThreadPoolLib::Task {
                    node: ThreadPoolLib::Node::default(),
                    callback: Worker::deinit_callback,
                },
                temporary_arena: None,
                stmt_list: None,
            });
            (*worker).init(&*self.v2);
            TLS_WORKER.set((self.generation, worker));
            &mut *worker
        }
    }
}

/// Per-thread cache for [`ThreadPool::get_worker`]. Keyed on
/// [`ThreadPool::generation`] (not the pool pointer — `Bun.build()` reuse makes
/// pointer identity ABA). `0` never matches a live pool.
#[thread_local]
static TLS_WORKER: core::cell::Cell<(u64, *mut Worker)> =
    core::cell::Cell::new((0, core::ptr::null_mut()));

static POOL_GENERATION: core::sync::atomic::AtomicU64 = core::sync::atomic::AtomicU64::new(1);

// ───────────────────────────────────────────────────────────────────────────
// Worker
// ───────────────────────────────────────────────────────────────────────────

/// Per-OS-thread bundler state. Heap-allocated and pinned (the
/// `deinit_task`/`arena` fields are self-referential); never moved after
/// `get_worker` boxes it.
pub struct Worker {
    /// Thread-local arena. `None` until [`Worker::create`] runs;
    /// every read site is post-`has_created`.
    pub heap: Option<ThreadLocalArena>,

    /// Thread-local memory arena
    /// All allocations are freed in `deinit` at the very end of bundling.
    // self-referential borrow of `heap` — `BackRef` (not a real
    // `&'self ThreadLocalArena`) so it can be reseated in `create()` without a
    // self-borrow and so call sites read it via safe `Deref` instead of
    // open-coding a raw deref. Dangling until `create()` runs; every read site is
    // post-`has_created`.
    pub arena: bun_ptr::BackRef<ThreadLocalArena>,

    /// BACKREF (LIFETIMES.tsv): the owning `BundleV2` strictly outlives every
    /// `Worker` it creates (workers are torn down in `deinit_without_freeing_arena`
    /// before the bundle is dropped). `BackRef` so call sites read
    /// `worker.ctx.field` via safe `Deref` instead of open-coding a raw deref.
    pub ctx: bun_ptr::BackRef<BundleV2<'static>>,

    /// `None` until [`Worker::create`] populates it; every read site is
    /// post-`has_created`.
    pub data: Option<WorkerData>,
    pub quit: bool,

    pub ast_memory_store: ManuallyDrop<bun_ast::ASTMemoryAllocator>,
    pub has_created: bool,
    /// `ThreadPoolLib.Thread.current` — `None` when called off a pool thread.
    /// `ParentRef` (not raw `*mut`) because the pool-owned `Thread` strictly
    /// outlives the per-thread `Worker` it created, and the only access is
    /// `push_idle_task(&self)` — so the safe `Deref` projection suffices.
    pub thread: Option<bun_ptr::ParentRef<ThreadPoolLib::Thread>>,

    pub deinit_task: ThreadPoolLib::Task,

    pub temporary_arena: Option<bun_alloc::Arena>,
    pub stmt_list: Option<StmtList>,
}

impl Worker {
    /// Reborrow the self-referential `arena` (= `&self.heap`) as a shared
    /// reference. `BackRef` field, so the deref is encapsulated in
    /// [`bun_ptr::BackRef::get`]; see note on the field.
    ///
    /// `arena` is set to `&self.heap` in [`Worker::create`] before any caller
    /// can observe the `Worker`, and is never dangling after that point. The
    /// pointee is the worker's own `heap` field, which is pinned for the
    /// worker's lifetime.
    /// The worker-owned bump arena. Returns `&'static` because the arena is
    /// pinned for the worker's lifetime and `Worker::get` already hands out a
    /// `&'static mut Worker`; centralising the erasure here avoids per-call-site
    /// `detach_lifetime_ref` (the previous pattern at `ParseTask::run`).
    #[inline]
    pub fn arena(&self) -> &'static ThreadLocalArena {
        // SAFETY: `self.arena` is a `BackRef` to `self.heap`, set in
        // `Worker::create` and never reassigned. `Worker::get` already returns
        // `&'static mut Worker`; callers are task callbacks that complete
        // before `deinit_soon` tears the worker down, so the arena outlives
        // every reference handed out here.
        unsafe { bun_ptr::detach_lifetime_ref(self.arena.get()) }
    }
}

pub struct WorkerData {
    // Kept raw because the pointee's arena
    // is the sibling field `Worker.heap`, which Rust cannot express as a borrow.
    pub log: *mut bun_ast::Log,
    pub estimated_input_lines_of_code: usize,
    // lifetime erased to `'static` — the inner `&'a Arena` borrows
    // `Worker.heap`, which Rust can't express on a sibling field.
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
    /// Thread-pool idle-task callback (safe fn — coerces to the
    /// `Task.callback` field type at the struct-init site). `task` is the
    /// `deinit_task` field of a live boxed `Worker` — guaranteed by
    /// [`Self::deinit_soon`], the sole scheduler of this callback.
    fn deinit_callback(task: *mut ThreadPoolLib::Task) {
        bun_core::scoped_log!(ThreadPool, "Worker.deinit()");
        // SAFETY: `task` points to `Worker.deinit_task` (intrusive field) —
        // only ever invoked by the thread pool against a `Worker` enqueued via
        // `deinit_soon`, so provenance covers the full `Worker` allocation.
        let this: *mut Worker = unsafe { bun_core::from_field_ptr!(Worker, deinit_task, task) };
        // SAFETY: `deinit_soon` schedules this exactly once on a live
        // heap-allocated `Worker`; the idle-task fires on the worker's own OS
        // thread with no other live borrow, so we hold exclusive ownership.
        unsafe { Self::deinit(this) };
    }

    pub fn deinit_soon(&mut self) {
        if let Some(thread) = self.thread {
            thread.push_idle_task(&raw mut self.deinit_task);
        } else {
            // `thread` is `ThreadPoolLib::Thread::current()` captured at
            // creation. When null, the Worker was created on a non-pool thread
            // (the bundler thread running an inline parse). `deinit_soon` is
            // also called from the bundler thread (`deinit_without_freeing_arena`
            // iterates `workers_assignments`), so we are on the owning thread
            // and can tear down synchronously. Skipping teardown here would
            // leak the Worker — including its
            // `ast_memory_store` mi_heap (every `AstAlloc` buffer the inline
            // parse produced) and `data.transpiler` per `Bun.build()` call.
            //
            // SAFETY: `self` is the heap-allocated Worker; sole owner now that
            // the caller is about to `clear_retaining_capacity()` the
            // `workers_assignments` map.
            unsafe { Self::deinit(std::ptr::from_mut::<Self>(self)) };
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
            // `wire_after_move` boxed a `bun_js_parser_jsc::Macro::MacroContext`
            // behind `macro_context.data` (raw `*mut`, no `Drop` glue);
            // `Transpiler` has no `Drop` impl, so `worker.data = None` below
            // would strand it. Free both transpilers' boxes explicitly — the
            // box only owns a `MacroMap` and a lazy `bun_alloc::Arena`, no JSC
            // handles, so the worker thread tearing it down is safe.
            if let Some(data) = worker.data.as_mut() {
                if let Some(ctx) = data.transpiler.macro_context.take() {
                    ctx.deinit();
                }
                if let Some(other) = data.other_transpiler.as_deref_mut() {
                    if let Some(ctx) = other.macro_context.take() {
                        ctx.deinit();
                    }
                }
                js_ast::Macro::collect_vm_garbage();
            }
            // Drop order: `data` (whose `transpiler.arena` borrows `heap`)
            // first, then the arenas it references.
            worker.data = None;
            worker.temporary_arena = None;
            worker.stmt_list = None;
        }
        // SAFETY: `ast_memory_store` is always a valid `ManuallyDrop` —
        // `get_worker` unconditionally writes `ASTMemoryAllocator::default()`,
        // and `create()` may overwrite it
        // via `*ast_memory_store = ...`. Dropped exactly once here, *outside*
        // the `has_created` guard so the default-constructed arena is freed
        // even when `create()` never ran.
        // Ordered before `heap = None` in case `ASTMemoryAllocator::new`
        // ever threads `arena_ref` (= `&self.heap`) through.
        unsafe { ManuallyDrop::drop(&mut worker.ast_memory_store) };
        if worker.has_created {
            worker.heap = None;
        }
        // SAFETY: caller contract — `this` was heap-allocated via `get_worker`.
        // Runs full field drop glue: remaining `Option` fields are `None`
        // (no-op), `ast_memory_store` is `ManuallyDrop` (no auto-drop), so no
        // double-free; defends against future `Drop`-carrying fields.
        unsafe { bun_core::heap::destroy(this) };
    }

    // returns `&'static mut` (detached) — the `Worker` is
    // heap-pinned (heap::alloc in `get_worker`) and outlives any `ctx`
    // borrow. Tying it to `ctx`'s lifetime would
    // forbid the `worker` ↔ `ctx` re-borrows in `ParseTask::run_*`.
    pub fn get(ctx: &BundleV2<'_>) -> &'static mut Worker {
        // SAFETY: `ctx` is a BACKREF; `graph.pool` is a `NonNull<ThreadPool>`
        // pointing at the bundle-owned pool that outlives every worker. We only
        // need a shared `&ThreadPool` — `get_worker` takes `&self` and serializes
        // map mutation via the internal `bun_threading::Guarded`, so concurrent
        // entry from multiple worker threads is sound.
        let pool: &ThreadPool = ctx.graph.pool();
        let worker = pool.get_worker(bun_threading::current_thread_id());
        if !worker.has_created {
            worker.create(ctx);
        }

        worker.ast_memory_store.push();

        worker
    }

    pub fn unget(&mut self) {
        self.ast_memory_store.pop();
    }

    pub fn init(&mut self, v2: &BundleV2<'_>) {
        // Lifetime-erase `'_` → `'static` via `NonNull::cast` (BACKREF: the
        // bundle outlives every worker).
        self.ctx = bun_ptr::BackRef::from(NonNull::from(v2).cast::<BundleV2<'static>>());
    }

    fn create(&mut self, ctx: &BundleV2<'_>) {
        // `bun_perf::trace` takes a generated `PerfEvent` enum, and
        // the generator hasn't emitted `Bundler.Worker.create` yet (only
        // `_Stub`). Dropped to avoid mis-attributing the span.
        // let _trace = bun_perf::trace("Bundler.Worker.create");

        self.has_created = true;
        Output::Source::configure_thread();
        // Self-referential — `arena` borrows `self.heap`. `Option::insert`
        // returns the stable address of the in-place payload (Worker is
        // heap-pinned, so this never moves).
        self.arena = bun_ptr::BackRef::new(self.heap.insert(ThreadLocalArena::new()));

        // SAFETY: self-referential — `self.arena` was just set to `&self.heap`
        // (Worker is heap-pinned, address stable). `'static` is sound for the
        // erased `Transpiler<'static>` slot below; the arena outlives
        // `WorkerData`. Single detach for the three uses that follow.
        let arena_ref: &'static ThreadLocalArena =
            unsafe { bun_ptr::detach_lifetime_ref(self.arena.get()) };

        // The
        // ASTMemoryAllocator owns its bump arena internally and ignores the
        // passed fallback (see ASTMemoryAllocator::new doc).
        *self.ast_memory_store = bun_ast::ASTMemoryAllocator::new(arena_ref);
        self.ast_memory_store.reset();

        let log: *mut bun_ast::Log = arena_ref.alloc(bun_ast::Log::init());
        self.ctx = bun_ptr::BackRef::from(NonNull::from(ctx).cast::<BundleV2<'static>>());
        // Use a fresh Bump (no nested-arena type yet).
        self.temporary_arena = Some(bun_alloc::Arena::new());
        self.stmt_list = Some(StmtList::init());
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

    /// Build a per-worker `Transpiler` from `from`.
    ///
    /// reshaped for borrowck — associated fn (no `&mut self`) so
    /// callers can borrow `self.data.log` disjointly. The returned value is a
    /// fully-owned `Transpiler` whose `Drop` is sound; `wire_after_move` must
    /// be called once it is at its final address.
    fn initialize_transpiler(
        log: *mut bun_ast::Log,
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
                // `ctx` is a `BackRef` (set in `create()`); the `BundleV2`
                // outlives every worker — safe `Deref`.
                let client: &Transpiler<'_> = self.ctx.client_transpiler_ref().unwrap();
                // SAFETY: `self.arena` points at `self.heap` (set in `create()`),
                // pinned for the worker's lifetime; detach to `'static` for the
                // erased `Transpiler<'static>` slot.
                let arena_ref: &'static ThreadLocalArena =
                    unsafe { bun_ptr::detach_lifetime_ref(self.arena.get()) };
                let mut boxed = Box::new(Self::initialize_transpiler(data.log, client, arena_ref));
                // Wire self-refs after the value reached its final (heap) address.
                boxed.wire_after_move();
                data.other_transpiler = Some(boxed);
            }
            // Just populated above (or on a prior call) — `expect` is
            // unreachable. No `unsafe` needed for a set-once `Option<Box<_>>`.
            let other = data
                .other_transpiler
                .as_deref_mut()
                .expect("other_transpiler set above");
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
