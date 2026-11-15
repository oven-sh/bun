//! The bundler-side worker pool that
//! wraps `bun_threading::thread_pool::ThreadPool` and owns the per-thread
//! [`Worker`] state (mimalloc arena, per-thread `Transpiler` clone, AST store).
//!
//! `Worker::new` builds the per-worker
//! `Transpiler` via `Transpiler::for_worker` (per-field deep clone — no
//! bitwise struct copy).

use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena as ThreadLocalArena;
use bun_collections::ArrayHashMap;
use bun_core::{self, output as Output};
use bun_ptr::{AliasableBox, BackRef};
use bun_threading::{WaitGroup, io_thread_pool, thread_pool as ThreadPoolLib};

use crate::cache::Entry as CacheEntry;
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
type ThreadId = u64;

pub struct ThreadPool {
    /// macOS holds an IORWLock on every file open.
    /// This causes massive contention after about 4 threads as of macOS 15.2
    /// On Windows, this seemed to be a small performance improvement.
    /// On Linux, this was a performance regression.
    /// In some benchmarks on macOS, this yielded up to a 60% performance improvement in microbenchmarks that load ~10,000 files.
    // `None` when `!uses_io_pool()`.
    pub(crate) io_pool: Option<&'static ThreadPoolLib::ThreadPool>,
    /// Tracks the `io_pool` tasks whose callbacks haven't returned. A callback's
    /// last step schedules a parse on `worker_pool`, and that parse can finish
    /// before the callback returns.
    io_tasks_in_flight: WaitGroup,
    worker_pool: WorkerPool,
    // Per PORTING.md §Concurrency ("Mutex<T> owns T"), the lock is folded into
    // the field so `get_worker` can take `&self` — `Worker::get` is entered
    // concurrently from arbitrary worker-pool threads, and a `&mut self` here
    // would alias `&mut ThreadPool` across threads (UB before the lock is even
    // reached).
    workers_assignments: bun_threading::Guarded<ArrayHashMap<ThreadId, AliasableBox<Worker>>>,
    /// Monotonic per-pool stamp for the [`TLS_WORKER`] fast-path key. Pointer
    /// identity is unsound across `Bun.build()` calls (mimalloc reuses the
    /// freed slot), so each pool draws a fresh `u64` from [`POOL_GENERATION`].
    pub(crate) generation: u64,
}

enum WorkerPool {
    Owned(AliasableBox<ThreadPoolLib::ThreadPool>),
    Lent(BackRef<ThreadPoolLib::ThreadPool>),
}

// SAFETY: `ThreadPool` is shared across worker threads; the only mutated
// field (`workers_assignments`) is guarded by its `bun_threading::Guarded`, and
// the pointer fields are set during init, before the pool is shared with
// worker threads, and only read thereafter.
unsafe impl Send for ThreadPool {}
// SAFETY: `&ThreadPool` is read concurrently from worker-pool threads via
// `get_worker(&self)`; the only field mutated under `&self` is
// `workers_assignments` (through its `bun_threading::Guarded` lock), and the
// pointers' target (`ThreadPoolLib::ThreadPool`) is `Sync`.
unsafe impl Sync for ThreadPool {}

impl ThreadPool {
    /// Inherent associated type so call sites that wrote
    /// `ThreadPool::Worker::get(ctx)`
    /// resolve without a separate module path.
    pub type Worker = Worker;

    pub(crate) fn init(worker_pool: Option<NonNull<ThreadPoolLib::ThreadPool>>) -> ThreadPool {
        let worker_pool = match worker_pool {
            Some(lent) => WorkerPool::Lent(BackRef::from(lent)),
            None => {
                let cpu_count = bun_core::get_thread_count();
                bun_core::scoped_log!(ThreadPool, "{} workers", cpu_count);
                WorkerPool::Owned(AliasableBox::new(ThreadPoolLib::ThreadPool::init(
                    ThreadPoolLib::Config {
                        max_threads: u32::from(cpu_count),
                        ..Default::default()
                    },
                )))
            }
        };
        ThreadPool {
            worker_pool,
            io_pool: Self::uses_io_pool().then(io_thread_pool::get),
            io_tasks_in_flight: WaitGroup::init(),
            workers_assignments: bun_threading::Guarded::new(ArrayHashMap::default()),
            generation: POOL_GENERATION.fetch_add(1, Ordering::Relaxed),
        }
    }

    /// Blocks until every IO callback has returned.
    pub(crate) fn wait_for_io_tasks(&self) {
        self.io_tasks_in_flight.wait();
    }

    /// Marks one IO task as finished. `io_task_callback` calls this last.
    ///
    /// # Safety
    /// `this` must have scheduled the task. `this` may be freed as soon as this
    /// call unblocks [`Self::wait_for_io_tasks`].
    pub(crate) unsafe fn finish_io_task(this: *const Self) {
        // SAFETY: caller contract.
        unsafe { WaitGroup::finish_raw(&raw const (*this).io_tasks_in_flight) };
    }

    #[inline]
    pub(crate) fn worker_pool(&self) -> &ThreadPoolLib::ThreadPool {
        match &self.worker_pool {
            WorkerPool::Owned(pool) => pool,
            WorkerPool::Lent(pool) => pool,
        }
    }

    /// Sends every thread that may hold a [`Worker`] through its idle queue.
    pub(crate) fn wake_for_idle_events(&self) {
        self.worker_pool().wake_for_idle_events();
        if let Some(io) = self.io_pool {
            io.wake_for_idle_events();
        }
    }

    pub(crate) fn start(&self) {
        self.worker_pool().warm(8);
        if let Some(io) = self.io_pool {
            io.warm(1);
        }
    }

    pub(crate) fn uses_io_pool() -> bool {
        io_thread_pool::uses_io_pool()
    }

    fn schedule_with(
        &self,
        mut parse_task: Box<ParseTask<'_>>,
        schedule_fn: fn(&ThreadPoolLib::ThreadPool, ThreadPoolLib::Batch),
    ) {
        if let ContentsOrFd::Contents(contents) = parse_task.contents_or_fd {
            parse_task.stage = ParseTaskStage::NeedsParse(CacheEntry {
                contents,
                file: None,
            });
        }
        let io_pool = self
            .io_pool
            .filter(|_| matches!(parse_task.stage, ParseTaskStage::NeedsSourceCode));

        let parse_task = bun_core::heap::into_raw(parse_task);
        let (pool, task) = match io_pool {
            Some(io) => {
                self.io_tasks_in_flight.add_one();
                // SAFETY: a field of the box above, which the task's callback takes back.
                (io, unsafe { &raw mut (*parse_task).io_task })
            }
            // SAFETY: as above.
            None => (self.worker_pool(), unsafe { &raw mut (*parse_task).task }),
        };
        schedule_fn(pool, ThreadPoolLib::Batch::from(task));
    }

    pub(crate) fn schedule(&self, parse_task: Box<ParseTask<'_>>) {
        self.schedule_with(parse_task, ThreadPoolLib::ThreadPool::schedule);
    }

    pub(crate) fn schedule_inside_thread_pool(&self, parse_task: Box<ParseTask<'_>>) {
        self.schedule_with(
            parse_task,
            ThreadPoolLib::ThreadPool::schedule_inside_thread_pool,
        );
    }

    // returns `&'static mut` — the `Worker` lives until `ThreadPool::drop`; detaching from `&self` lets
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
    fn get_worker(&self, ctx: &BundleV2<'_>) -> &'static mut Worker {
        let (generation, worker) = TLS_WORKER.get();
        if generation == self.generation {
            // SAFETY: cached by `get_worker_slow` on this thread; the Worker is
            // heap-pinned (boxed in the slow path) and live while
            // `self.generation` is, and a new pool at the same address has a fresh
            // generation, so a stale TLS entry never matches here.
            return unsafe { &mut *worker };
        }
        self.get_worker_slow(ctx)
    }

    #[cold]
    fn get_worker_slow(&self, ctx: &BundleV2<'_>) -> &'static mut Worker {
        let id = bun_threading::current_thread_id();
        let assigned = (self.workers_assignments.lock().get(&id)).map(AliasableBox::as_ptr);
        let worker = assigned.unwrap_or_else(|| {
            let worker = Worker::new(ctx);
            let ptr = worker.as_ptr();
            bun_core::handle_oom(self.workers_assignments.lock().put(id, worker));
            ptr
        });
        TLS_WORKER.set((self.generation, worker));
        // SAFETY: no other thread looks up `id`. Dropping the `BundleV2` takes every entry, so it
        // must not happen while a task has its worker. It waits for the source map tasks itself.
        // Its callers `wait_for_parse` first, except when `enqueue_entry_points_*` returns an
        // error, which only a failed allocation makes it do.
        unsafe { &mut *worker }
    }
}

/// Call [`ThreadPool::wait_for_io_tasks`] first.
impl Drop for ThreadPool {
    fn drop(&mut self) {
        let (_, workers) = core::mem::take(self.workers_assignments.get_mut()).into_entries();
        if workers.is_empty() {
            return;
        }
        for worker in workers {
            // One without a pool thread drops here: this thread made it, or one that has been joined.
            if let Some(thread) = worker.thread {
                let worker = worker.into_raw();
                // SAFETY: a field of the box above, which the task's callback takes back.
                thread.push_idle_task(unsafe { &raw mut (*worker).drop_task });
            }
        }
        self.wake_for_idle_events();
    }
}

/// Per-thread cache for [`ThreadPool::get_worker`]. Keyed on
/// [`ThreadPool::generation`] (not the pool pointer — `Bun.build()` reuse makes
/// pointer identity ABA). `0` never matches a live pool.
#[thread_local]
static TLS_WORKER: core::cell::Cell<(u64, *mut Worker)> =
    core::cell::Cell::new((0, core::ptr::null_mut()));

static POOL_GENERATION: core::sync::atomic::AtomicU64 = core::sync::atomic::AtomicU64::new(1);

/// `Worker`s whose `Drop::drop` has not returned, across every pool in the process.
/// Read by `bun:internal-for-testing`.
pub static WORKER_LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

// ───────────────────────────────────────────────────────────────────────────
// Worker
// ───────────────────────────────────────────────────────────────────────────

/// Per-OS-thread bundler state. Never moved after [`Worker::new`] boxes it.
pub struct Worker {
    /// BACKREF (LIFETIMES.tsv): the owning `BundleV2` strictly outlives every
    /// task that runs on a `Worker` it creates. `BackRef` so call sites read
    /// `worker.ctx.field` via safe `Deref` instead of open-coding a raw deref.
    pub(crate) ctx: bun_ptr::BackRef<BundleV2<'static>>,

    /// `'static` stands for the borrow of `heap`.
    pub(crate) transpiler: Transpiler<'static>,
    other_transpiler: Option<Box<Transpiler<'static>>>,
    pub(crate) macro_load_states: js_ast::Macro::MacroLoadStates,

    pub(crate) temporary_arena: bun_alloc::Arena,
    pub(crate) stmt_list: StmtList,
    ast_memory_store: bun_ast::ASTMemoryAllocator,

    /// `ThreadPoolLib.Thread.current` — `None` when called off a pool thread.
    /// `ParentRef` (not raw `*mut`) because the pool-owned `Thread` strictly
    /// outlives the per-thread `Worker` it created, and the only access is
    /// `push_idle_task(&self)` — so the safe `Deref` projection suffices.
    thread: Option<bun_ptr::ParentRef<ThreadPoolLib::Thread>>,
    drop_task: ThreadPoolLib::Task,

    /// Last: the fields above borrow it.
    heap: AliasableBox<ThreadLocalArena>,
}

impl Worker {
    /// What is allocated here lives until the very end of bundling.
    #[inline]
    pub(crate) fn arena(&self) -> &'static ThreadLocalArena {
        // SAFETY: callers are task callbacks, which complete before `ThreadPool::drop` releases
        // the worker. What they return goes to the bundle, which owns that pool.
        unsafe { &*self.heap.as_ptr() }
    }
}

/// This thread's [`Worker`], whose AST store is the active one until the drop.
pub(crate) struct WorkerGuard(&'static mut Worker);

impl Deref for WorkerGuard {
    type Target = Worker;
    fn deref(&self) -> &Worker {
        self.0
    }
}

impl DerefMut for WorkerGuard {
    fn deref_mut(&mut self) -> &mut Worker {
        self.0
    }
}

impl Drop for WorkerGuard {
    fn drop(&mut self) {
        self.0.ast_memory_store.pop();
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        bun_core::scoped_log!(ThreadPool, "Worker.drop()");
        js_ast::Macro::collect_vm_garbage();
        WORKER_LIVE_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Worker {
    /// Runs on the worker's own thread.
    fn drop_callback(task: *mut ThreadPoolLib::Task) {
        // SAFETY: `task` is the `drop_task` field of the box that `ThreadPool::drop` gave up.
        unsafe { bun_core::heap::destroy(bun_core::from_field_ptr!(Worker, drop_task, task)) };
    }

    // holds `&'static mut` (detached) — the `Worker` is
    // heap-pinned (boxed in `new`) and outlives any `ctx`
    // borrow. Tying it to `ctx`'s lifetime would
    // forbid the `worker` ↔ `ctx` re-borrows in `ParseTask::run_*`.
    pub(crate) fn get(ctx: &BundleV2<'_>) -> WorkerGuard {
        let worker = ctx.graph.pool().get_worker(ctx);

        worker.ast_memory_store.push();

        WorkerGuard(worker)
    }

    fn new(ctx: &BundleV2<'_>) -> AliasableBox<Worker> {
        WORKER_LIVE_COUNT.fetch_add(1, Ordering::SeqCst);
        Output::Source::configure_thread();
        let heap = AliasableBox::new(ThreadLocalArena::new());
        // SAFETY: `heap` is the last field to drop.
        let arena: &'static ThreadLocalArena = unsafe { &*heap.as_ptr() };
        let log: *mut bun_ast::Log = arena.alloc(bun_ast::Log::init());
        // `'static` stands for the bundle's lifetime, here and in the transpilers made from `ctx`.
        let ctx = bun_ptr::BackRef::from(NonNull::from(ctx).cast::<BundleV2<'static>>());

        let worker = AliasableBox::new(Worker {
            ctx,
            transpiler: Transpiler::for_worker(ctx.transpiler(), arena, log),
            other_transpiler: None,
            macro_load_states: Default::default(),
            temporary_arena: bun_alloc::Arena::new(),
            stmt_list: StmtList::init(),
            // Shares `heap` with the parser: mimalloc caches only the last heap a thread touched.
            ast_memory_store: bun_ast::ASTMemoryAllocator::borrowing(arena),
            thread: NonNull::new(ThreadPoolLib::Thread::current()).map(bun_ptr::ParentRef::from),
            drop_task: ThreadPoolLib::Task {
                node: ThreadPoolLib::Node::default(),
                callback: Worker::drop_callback,
            },
            heap,
        });

        bun_core::scoped_log!(ThreadPool, "Worker.new()");
        worker
    }

    pub(crate) fn transpiler_for_target(&mut self, target: Target) -> &mut Transpiler<'static> {
        if target == Target::Browser && self.transpiler.options.target != target {
            let (arena, log) = (self.arena(), self.transpiler.log);
            let other = self.other_transpiler.get_or_insert_with(|| {
                let client = self.ctx.client_transpiler_ref().unwrap();
                Box::new(Transpiler::for_worker(client, arena, log))
            });
            debug_assert!(other.options.target == target);
            return other;
        }

        &mut self.transpiler
    }
}
