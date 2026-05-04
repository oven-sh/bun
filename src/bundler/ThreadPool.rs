use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena as ThreadLocalArena; // MimallocArena → bumpalo::Bump in AST crates
use bun_collections::ArrayHashMap;
use bun_core::{feature_flag, perf, FeatureFlags, Output};
use bun_logger as Logger;
use bun_threading::{Mutex, ThreadId, ThreadPool as ThreadPoolLib};

use crate::cache as CacheSet;
use crate::options::Target;
use crate::{BundleV2, LinkerContext, ParseTask, Transpiler};
use bun_js_parser as js_ast;

bun_output::declare_scope!(ThreadPool, visible);

pub struct ThreadPool {
    /// macOS holds an IORWLock on every file open.
    /// This causes massive contention after about 4 threads as of macOS 15.2
    /// On Windows, this seemed to be a small performance improvement.
    /// On Linux, this was a performance regression.
    /// In some benchmarks on macOS, this yielded up to a 60% performance improvement in microbenchmarks that load ~10,000 files.
    // TODO(port): TSV says &'static ThreadPoolLib; wrapped in Option because Zig assigns `undefined` when !uses_io_pool()
    pub io_pool: Option<&'static ThreadPoolLib>,
    // TODO(port): lifetime — TSV class UNKNOWN (rust_type `&'a mut ThreadPoolLib`); conditionally owned via worker_pool_is_owned, kept raw for Phase A
    pub worker_pool: *mut ThreadPoolLib,
    pub worker_pool_is_owned: bool,
    pub workers_assignments: ArrayHashMap<ThreadId, *mut Worker>,
    pub workers_assignments_lock: Mutex,
    pub v2: *const BundleV2,
}

mod io_thread_pool {
    use super::*;

    static mut THREAD_POOL: MaybeUninit<ThreadPoolLib> = MaybeUninit::uninit();
    // Protects initialization and deinitialization of the IO thread pool.
    static MUTEX: Mutex = Mutex::new();
    // 0 means not initialized. 1 means initialized but not used.
    // N > 1 means N-1 `ThreadPool`s are using the IO thread pool.
    static REF_COUNT: AtomicUsize = AtomicUsize::new(0);

    pub fn acquire() -> &'static ThreadPoolLib {
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
                // SAFETY: REF_COUNT != 0 means THREAD_POOL is initialized (set under MUTEX below).
                Ok(_) => return unsafe { THREAD_POOL.assume_init_ref() },
                Err(actual) => count = actual,
            }
        }

        MUTEX.lock();
        let _guard = scopeguard::guard((), |_| MUTEX.unlock());

        // Relaxed because the store we care about (the one that stores 1 to
        // indicate the thread pool is initialized) is guarded by the mutex.
        if REF_COUNT.load(Ordering::Relaxed) != 0 {
            // SAFETY: non-zero ref count under mutex → initialized.
            return unsafe { THREAD_POOL.assume_init_ref() };
        }
        // SAFETY: we hold MUTEX and REF_COUNT == 0, so no other thread is reading THREAD_POOL.
        unsafe {
            THREAD_POOL.write(ThreadPoolLib::init(ThreadPoolLib::Options {
                max_threads: bun_core::get_thread_count().min(4).max(2),
                // Use a much smaller stack size for the IO thread pool
                stack_size: 512 * 1024,
                ..Default::default()
            }));
        }
        // 2 means initialized and referenced by one `ThreadPool`.
        REF_COUNT.store(2, Ordering::Release);
        // SAFETY: just initialized above.
        unsafe { THREAD_POOL.assume_init_ref() }
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

        MUTEX.lock();
        let _guard = scopeguard::guard((), |_| MUTEX.unlock());

        // Relaxed is okay because the only store that could happen at this point
        // is guarded by the mutex.
        if REF_COUNT.load(Ordering::Relaxed) != 0 {
            return false;
        }
        // SAFETY: we hold MUTEX, REF_COUNT == 0, and we previously CAS'd from 1 → initialized.
        unsafe {
            THREAD_POOL.assume_init_drop();
        }
        // TODO(port): Zig source falls off end of `bool`-returning fn here; assuming `true`.
        true
    }
}

impl ThreadPool {
    pub fn init(v2: &BundleV2, worker_pool: Option<&mut ThreadPoolLib>) -> Result<ThreadPool, bun_alloc::AllocError> {
        let pool: &mut ThreadPoolLib = match worker_pool {
            Some(p) => p,
            None => {
                let cpu_count = bun_core::get_thread_count();
                // PERF(port): was arena allocator.create — using Box::into_raw (global mimalloc)
                let pool = Box::into_raw(Box::new(ThreadPoolLib::init(ThreadPoolLib::Options {
                    max_threads: cpu_count,
                    ..Default::default()
                })));
                bun_output::scoped_log!(ThreadPool, "{} workers", cpu_count);
                // SAFETY: just Box::into_raw'd above; exclusive.
                unsafe { &mut *pool }
            }
        };
        let mut this = Self::init_with_pool(v2, pool);
        this.worker_pool_is_owned = false;
        Ok(this)
    }

    pub fn init_with_pool(v2: &BundleV2, worker_pool: &mut ThreadPoolLib) -> ThreadPool {
        ThreadPool {
            worker_pool: worker_pool as *mut ThreadPoolLib,
            io_pool: if Self::uses_io_pool() { Some(io_thread_pool::acquire()) } else { None },
            v2: v2 as *const BundleV2,
            worker_pool_is_owned: false,
            workers_assignments: ArrayHashMap::default(),
            workers_assignments_lock: Mutex::new(),
        }
    }

    pub fn start(&mut self) {
        // SAFETY: worker_pool is valid for the lifetime of self (set in init/init_with_pool).
        unsafe { (*self.worker_pool).warm(8) };
        if Self::uses_io_pool() {
            // TODO(port): &'static ref but ThreadPoolLib::warm likely needs &mut; cast away const matching Zig *ThreadPoolLib semantics
            // SAFETY: io_pool points to module static THREAD_POOL, valid while ref_count > 0.
            unsafe {
                (*(self.io_pool.unwrap() as *const ThreadPoolLib as *mut ThreadPoolLib)).warm(1);
            }
        }
    }

    pub fn uses_io_pool() -> bool {
        if feature_flag::BUN_FEATURE_FLAG_FORCE_IO_POOL.get() {
            // For testing.
            return true;
        }

        if feature_flag::BUN_FEATURE_FLAG_DISABLE_IO_POOL.get() {
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

    pub fn schedule_with_options(&mut self, parse_task: &mut ParseTask, is_inside_thread_pool: bool) {
        if matches!(parse_task.contents_or_fd, ParseTask::ContentsOrFd::Contents(_))
            && matches!(parse_task.stage, ParseTask::Stage::NeedsSourceCode)
        {
            // TODO(port): exact ParseTask::Stage / ContentsOrFd shape lives in crate::ParseTask
            let contents = match &parse_task.contents_or_fd {
                ParseTask::ContentsOrFd::Contents(c) => c.clone(),
                _ => unreachable!(),
            };
            parse_task.stage = ParseTask::Stage::NeedsParse {
                contents,
                fd: bun_sys::Fd::INVALID,
            };
        }

        let schedule_fn: fn(&mut ThreadPoolLib, ThreadPoolLib::Batch) = if is_inside_thread_pool {
            ThreadPoolLib::schedule_inside_thread_pool
        } else {
            ThreadPoolLib::schedule
        };

        if Self::uses_io_pool() {
            match parse_task.stage {
                ParseTask::Stage::NeedsParse { .. } => {
                    // SAFETY: worker_pool valid for lifetime of self.
                    schedule_fn(unsafe { &mut *self.worker_pool }, ThreadPoolLib::Batch::from(&mut parse_task.task));
                }
                ParseTask::Stage::NeedsSourceCode => {
                    // SAFETY: io_pool is Some when uses_io_pool(); points to live static.
                    let io = unsafe { &mut *(self.io_pool.unwrap() as *const _ as *mut ThreadPoolLib) };
                    schedule_fn(io, ThreadPoolLib::Batch::from(&mut parse_task.io_task));
                }
            }
        } else {
            // SAFETY: worker_pool valid for lifetime of self.
            schedule_fn(unsafe { &mut *self.worker_pool }, ThreadPoolLib::Batch::from(&mut parse_task.task));
        }
    }

    pub fn schedule(&mut self, parse_task: &mut ParseTask) {
        self.schedule_with_options(parse_task, false);
    }

    pub fn schedule_inside_thread_pool(&mut self, parse_task: &mut ParseTask) {
        self.schedule_with_options(parse_task, true);
    }

    pub fn get_worker(&mut self, id: ThreadId) -> &mut Worker {
        let worker: *mut Worker;
        {
            self.workers_assignments_lock.lock();
            let _guard = scopeguard::guard(&mut self.workers_assignments_lock, |l| l.unlock());
            let entry = self.workers_assignments.get_or_put(id).expect("unreachable");
            if entry.found_existing {
                // SAFETY: map only stores live Box::into_raw'd Workers (inserted below).
                return unsafe { &mut **entry.value_ptr };
            }

            // SAFETY: fully initialized via `worker.write(...)` immediately below before any read.
            worker = Box::into_raw(Box::new(MaybeUninit::<Worker>::uninit())).cast::<Worker>();
            // TODO(port): Zig writes uninit Worker* into map then fills it after unlock; mirrored with MaybeUninit
            *entry.value_ptr = worker;
        }

        // SAFETY: worker was just Box::into_raw'd above; exclusive access on this thread.
        unsafe {
            worker.write(Worker {
                ctx: self.v2,
                heap: MaybeUninit::uninit().assume_init(), // TODO(port): undefined until create()
                allocator: core::ptr::null(),              // TODO(port): self-referential &heap, set in create()
                thread: ThreadPoolLib::Thread::current(),
                data: MaybeUninit::uninit().assume_init(), // TODO(port): undefined until create()
                quit: false,
                ast_memory_allocator: Default::default(),
                has_created: false,
                deinit_task: ThreadPoolLib::Task { callback: Worker::deinit_callback },
                temporary_arena: MaybeUninit::uninit().assume_init(), // TODO(port): undefined until create()
                stmt_list: MaybeUninit::uninit().assume_init(),       // TODO(port): undefined until create()
            });
            (*worker).init(&*self.v2);
            &mut *worker
        }
    }
}

impl Drop for ThreadPool {
    fn drop(&mut self) {
        if self.worker_pool_is_owned {
            // SAFETY: worker_pool was Box::into_raw'd in init() when owned.
            unsafe { drop(Box::from_raw(self.worker_pool)) };
        }
        if Self::uses_io_pool() {
            io_thread_pool::release();
        }
    }
}

pub struct Worker {
    pub heap: ThreadLocalArena,

    /// Thread-local memory allocator
    /// All allocations are freed in `deinit` at the very end of bundling.
    // TODO(port): self-referential borrow of `heap`; AST-crate convention is `&'bump Bump` but cannot name lifetime of own field
    pub allocator: *const ThreadLocalArena,

    pub ctx: *const BundleV2,

    pub data: WorkerData,
    pub quit: bool,

    pub ast_memory_allocator: js_ast::ASTMemoryAllocator,
    pub has_created: bool,
    pub thread: Option<&'static ThreadPoolLib::Thread>,

    pub deinit_task: ThreadPoolLib::Task,

    pub temporary_arena: bun_alloc::Arena,
    pub stmt_list: LinkerContext::StmtList,
}

pub struct WorkerData {
    // TODO(port): TSV class ARENA (`&'arena mut Logger::Log`); kept raw because arena is sibling field `Worker.heap`
    pub log: *mut Logger::Log,
    pub estimated_input_lines_of_code: usize,
    pub transpiler: Transpiler,
    pub other_transpiler: Option<Transpiler>,
}

impl Default for WorkerData {
    fn default() -> Self {
        Self {
            log: core::ptr::null_mut(),
            estimated_input_lines_of_code: 0,
            transpiler: Transpiler::default(), // TODO(port): Zig leaves undefined
            other_transpiler: None,
        }
    }
}

impl Worker {
    pub fn deinit_callback(task: *mut ThreadPoolLib::Task) {
        bun_output::scoped_log!(ThreadPool, "Worker.deinit()");
        // SAFETY: task points to Worker.deinit_task; offset_of recovers the parent.
        let this: *mut Worker = unsafe {
            (task as *mut u8)
                .sub(core::mem::offset_of!(Worker, deinit_task))
                .cast::<Worker>()
        };
        // SAFETY: deinit_callback is only scheduled via deinit_soon on a live boxed Worker.
        unsafe { Self::deinit(this) };
    }

    pub fn deinit_soon(&mut self) {
        if let Some(thread) = self.thread {
            // TODO(port): ThreadPoolLib::Thread::push_idle_task likely needs &mut; matching Zig *Thread semantics
            // SAFETY: thread is &'static to a threadlocal ThreadPoolLib::Thread.
            unsafe {
                (*(thread as *const _ as *mut ThreadPoolLib::Thread)).push_idle_task(&mut self.deinit_task);
            }
        }
    }

    /// Takes ownership of the heap allocation and frees it.
    // SAFETY: `this` must have come from Box::into_raw in ThreadPool::get_worker.
    pub unsafe fn deinit(this: *mut Worker) {
        // has_created gate: heap is only valid if create() ran.
        if unsafe { (*this).has_created } {
            // heap dropped by Box::from_raw below
        } else {
            // TODO(port): heap/data/temporary_arena/stmt_list are uninit; must not run their Drop.
            // Phase B: wrap those fields in MaybeUninit or ManuallyDrop and drop conditionally here.
        }
        // SAFETY: caller contract — this was Box::into_raw'd.
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn get(ctx: &BundleV2) -> &mut Worker {
        // SAFETY: ctx is a BACKREF; graph.pool needs &mut but BundleV2 owns it uniquely on the JS thread.
        // PORT NOTE: reshaped for borrowck — cast through raw ptr to reach &mut pool from shared backref
        let worker = unsafe { (*(ctx as *const BundleV2 as *mut BundleV2)).graph.pool.get_worker(bun_threading::current_thread_id()) };
        if !worker.has_created {
            worker.create(ctx);
        }

        worker.ast_memory_allocator.push();

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            worker.heap.help_catch_memory_issues();
        }

        worker
    }

    pub fn unget(&mut self) {
        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.heap.help_catch_memory_issues();
        }

        self.ast_memory_allocator.pop();
    }

    pub fn init(&mut self, v2: &BundleV2) {
        self.ctx = v2 as *const BundleV2;
    }

    fn create(&mut self, ctx: &BundleV2) {
        let _trace = perf::trace("Bundler.Worker.create");

        self.has_created = true;
        Output::Source::configure_thread();
        self.heap = ThreadLocalArena::new();
        // TODO(port): self-referential — allocator borrows self.heap
        self.allocator = &self.heap as *const ThreadLocalArena;

        let allocator = self.allocator;

        self.ast_memory_allocator = js_ast::ASTMemoryAllocator { allocator, ..Default::default() };
        self.ast_memory_allocator.reset();

        // SAFETY: allocator points to self.heap which was just initialized and outlives self.data.
        let log = unsafe { (*allocator).alloc(Logger::Log::init(&*allocator)) } as *mut Logger::Log;
        self.data = WorkerData {
            log,
            estimated_input_lines_of_code: 0,
            // TODO(port): Zig writes `undefined` then initialize_transpiler fills it; needs MaybeUninit in Phase B
            transpiler: unsafe { MaybeUninit::uninit().assume_init() },
            other_transpiler: None,
        };
        self.ctx = ctx as *const BundleV2;
        // PERF(port): was bun.ArenaAllocator backed by self.allocator — using fresh Bump
        self.temporary_arena = bun_alloc::Arena::new();
        self.stmt_list = LinkerContext::StmtList::init(allocator);
        // PORT NOTE: reshaped for borrowck — capture log scalar, drop &mut self, re-borrow disjoint field
        let data_log = self.data.log;
        Self::initialize_transpiler(data_log, &mut self.data.transpiler, ctx.transpiler(), allocator);

        bun_output::scoped_log!(ThreadPool, "Worker.create()");
    }

    // PORT NOTE: reshaped for borrowck — associated fn (no &mut self) so callers can borrow self.data.transpiler disjointly
    fn initialize_transpiler(
        log: *mut Logger::Log,
        transpiler: &mut Transpiler,
        from: &Transpiler,
        allocator: *const ThreadLocalArena,
    ) {
        *transpiler = from.clone();
        transpiler.set_log(log);
        transpiler.set_allocator(allocator);
        transpiler.linker.resolver = &mut transpiler.resolver;
        transpiler.macro_context = Some(js_ast::Macro::MacroContext::init(transpiler));
        transpiler.resolver.caches = CacheSet::Set::init(allocator);
    }

    pub fn transpiler_for_target(&mut self, target: Target) -> &mut Transpiler {
        if target == Target::Browser && self.data.transpiler.options.target != target {
            if self.data.other_transpiler.is_none() {
                // TODO(port): Zig writes `undefined` into Option payload then borrows it; using MaybeUninit pattern
                self.data.other_transpiler = Some(unsafe { MaybeUninit::uninit().assume_init() });
                // PORT NOTE: reshaped for borrowck — capture scalars before borrowing self.data.other_transpiler
                let data_log = self.data.log;
                let allocator = self.allocator;
                // SAFETY: ctx is a valid backref; client_transpiler must be Some in this branch per Zig `.?`.
                let client: &Transpiler = unsafe { (*self.ctx).client_transpiler.as_ref().unwrap() };
                Self::initialize_transpiler(data_log, self.data.other_transpiler.as_mut().unwrap(), client, allocator);
            }
            let other_transpiler = self.data.other_transpiler.as_mut().unwrap();
            debug_assert!(other_transpiler.options.target == target);
            return other_transpiler;
        }

        &mut self.data.transpiler
    }

    pub fn run(&mut self, ctx: &BundleV2) {
        if !self.has_created {
            self.create(ctx);
        }
    }
}

pub use bun_js_parser::Ref;
pub use bun_js_parser::Index;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/ThreadPool.zig (364 lines)
//   confidence: medium
//   todos:      19
//   notes:      Heavy `undefined`-init + self-referential allocator field; Phase B needs MaybeUninit/ManuallyDrop on Worker fields and a decision on worker_pool ownership (TSV UNKNOWN). io_thread_pool::shutdown() Zig source missing trailing return.
// ──────────────────────────────────────────────────────────────────────────
