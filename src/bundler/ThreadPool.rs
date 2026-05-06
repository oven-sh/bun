//! Port of `src/bundler/ThreadPool.zig` — the bundler-side worker pool that
//! wraps `bun_threading::thread_pool::ThreadPool` and owns the per-thread
//! [`Worker`] state (mimalloc arena, per-thread `Transpiler` clone, AST store).
//!
//! Un-gated B-2: structural surface (struct fields, schedule, IO pool, worker
//! map) is real so `ParseTask` / `bundle_v2` / `Graph` can name and drive it.
//! `Worker::create` / `initialize_transpiler` are live via
//! `Transpiler::{clone_for_worker, set_log, set_allocator}`; the
//! `linker.resolver` backref stays a PORT NOTE while `crate::Linker` is the
//! unit stub (wired by `configure_linker`).

use core::mem::{ManuallyDrop, MaybeUninit};
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena as ThreadLocalArena; // Zig: bun.allocators.MimallocArena → bumpalo::Bump
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
    /// Placeholder so `bundle_v2` can `allocator().alloc(ThreadPool::default())`
    /// before overwriting with [`ThreadPool::init`]. Mirrors Zig's
    /// `allocator.create(ThreadPool)` which yields uninit memory.
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

    static mut THREAD_POOL: MaybeUninit<ThreadPoolLib::ThreadPool> = MaybeUninit::uninit();
    /// Protects initialization and deinitialization of the IO thread pool.
    static MUTEX: Mutex = {
        // PORT NOTE: `Mutex` derives `Default` but `Default::default()` isn't
        // `const`. The Zig source used `bun.threading.Mutex{}` (zero-init);
        // an all-zero `Mutex` is the documented unlocked state on every impl.
        // SAFETY: `Mutex` is `repr(Rust)` over an atomic / Futex word; zero is
        // the valid initial value (matches `#[derive(Default)]`).
        unsafe { core::mem::zeroed() }
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
                        NonNull::new_unchecked((&raw mut THREAD_POOL).cast::<ThreadPoolLib::ThreadPool>())
                    };
                }
                Err(actual) => count = actual,
            }
        }

        MUTEX.lock();
        let _guard = scopeguard::guard((), |_| MUTEX.unlock());

        // Relaxed because the store we care about (the one that stores 1 to
        // indicate the thread pool is initialized) is guarded by the mutex.
        if REF_COUNT.load(Ordering::Relaxed) == 0 {
            // SAFETY: we hold MUTEX and REF_COUNT == 0, so no other thread is reading THREAD_POOL.
            // `&raw mut` avoids the edition-2024 `static_mut_refs` hard error.
            unsafe {
                (*(&raw mut THREAD_POOL)).write(ThreadPoolLib::ThreadPool::init(ThreadPoolLib::Config {
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
        unsafe { NonNull::new_unchecked((&raw mut THREAD_POOL).cast::<ThreadPoolLib::ThreadPool>()) }
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
        // SAFETY: we hold MUTEX, REF_COUNT == 0, and we previously CAS'd from 1 ⇒ initialized.
        // `&raw mut` avoids the edition-2024 `static_mut_refs` hard error.
        unsafe {
            (*(&raw mut THREAD_POOL)).assume_init_drop();
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
    // `BundleV2` definitions (the canonical one + `__phase_a_draft::BundleV2`)
    // during the phased port, and both call `ThreadPool::init`. The backref is
    // stored as a type-erased raw pointer (`.cast()`) regardless, so the
    // monomorphised body is identical. Collapses to `&BundleV2<'_>` once the
    // draft module is dropped.
    pub fn init<V2>(
        v2: &V2,
        worker_pool: Option<&mut ThreadPoolLib::ThreadPool>,
    ) -> Result<ThreadPool, bun_alloc::AllocError> {
        // PORT NOTE: Spec ThreadPool.zig:85 allocated via the bundle arena
        // (`v2.allocator().create`), so the `false` ownership flag was
        // harmless — the arena reclaimed it. Here we `Box::into_raw` (global
        // heap), so `deinit()` must `Box::from_raw` it back; record ownership.
        let owned = worker_pool.is_none();
        let pool: *mut ThreadPoolLib::ThreadPool = match worker_pool {
            Some(p) => p as *mut _,
            None => {
                let cpu_count = bun_core::get_thread_count();
                // PERF(port): was `v2.allocator().create(ThreadPoolLib)` —
                // using Box::into_raw (global mimalloc).
                let pool = Box::into_raw(Box::new(ThreadPoolLib::ThreadPool::init(
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
            v2: (v2 as *const V2).cast(),
            worker_pool_is_owned: false,
            workers_assignments: parking_lot::Mutex::new(ArrayHashMap::default()),
        }
    }

    /// Explicit teardown — Zig callers spell `pool.deinit()` (no Drop on
    /// `ThreadPool` because `Graph.pool` is `NonNull<ThreadPool>` and the arena
    /// owns the storage).
    pub fn deinit(&mut self) {
        if self.worker_pool_is_owned {
            // SAFETY: worker_pool was Box::into_raw'd in `init()` when owned.
            unsafe { drop(Box::from_raw(self.worker_pool)) };
            self.worker_pool = ptr::null_mut();
        }
        if Self::uses_io_pool() {
            io_thread_pool::release();
        }
    }

    pub fn start(&self) {
        // SAFETY: worker_pool is valid for the lifetime of self (set in init/init_with_pool).
        unsafe { (*self.worker_pool).warm(8) };
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
                    // SAFETY: worker_pool valid for lifetime of self.
                    schedule_fn(unsafe { &*self.worker_pool }, ThreadPoolLib::Batch::from(&mut parse_task.task));
                }
                ParseTaskStage::NeedsSourceCode => {
                    // SAFETY: io_pool is Some when uses_io_pool(); points to live static.
                    let io = unsafe { self.io_pool.unwrap_unchecked().as_ref() };
                    schedule_fn(io, ThreadPoolLib::Batch::from(&mut parse_task.io_task));
                }
            }
        } else {
            // SAFETY: worker_pool valid for lifetime of self.
            schedule_fn(unsafe { &*self.worker_pool }, ThreadPoolLib::Batch::from(&mut parse_task.task));
        }
    }

    // PORT NOTE: takes `*mut` (Zig: `*ParseTask`) so callers can pass either a
    // raw heap pointer (e.g. `load.parse_task`) or a `&mut` (auto-coerces).
    pub fn schedule(&self, parse_task: *mut ParseTask) {
        // SAFETY: caller passes a live, exclusively-owned ParseTask (Box::leak'd
        // or arena-allocated); see call sites in bundle_v2.rs.
        self.schedule_with_options(unsafe { &mut *parse_task }, false);
    }

    pub fn schedule_inside_thread_pool(&self, parse_task: *mut ParseTask) {
        // SAFETY: see `schedule` above.
        self.schedule_with_options(unsafe { &mut *parse_task }, true);
    }

    // PORT NOTE: returns `&'static mut` — the `Worker` is `Box::into_raw`'d
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
                    // SAFETY: map only stores live Box::into_raw'd Workers (inserted below).
                    return unsafe { &mut *w };
                }
                MapEntry::Vacant(v) => {
                    // SAFETY: every field is fully written below before any read.
                    // Zig wrote a struct literal with `undefined` for the
                    // late-init fields; mirrored with `MaybeUninit` slots.
                    worker = Box::into_raw(unsafe { Box::<Worker>::new_uninit().assume_init() });
                    v.insert(worker);
                }
            }
        }

        // SAFETY: `worker` is freshly Box::into_raw'd and exclusive on this
        // thread until published via the map (already inserted above, but no
        // other thread looks it up under a different `id`).
        unsafe {
            worker.write(Worker {
                ctx: self.v2,
                heap: MaybeUninit::uninit(),
                allocator: ptr::null(),
                thread: ThreadPoolLib::Thread::current(),
                data: MaybeUninit::uninit(),
                quit: false,
                ast_memory_allocator: ManuallyDrop::new(js_ast::ASTMemoryAllocator::default()),
                has_created: false,
                deinit_task: ThreadPoolLib::Task {
                    node: ThreadPoolLib::Node::default(),
                    callback: Worker::deinit_callback,
                },
                temporary_arena: MaybeUninit::uninit(),
                stmt_list: MaybeUninit::uninit(),
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
/// `deinit_task`/`allocator` fields are self-referential); never moved after
/// `get_worker` boxes it.
pub struct Worker {
    /// Thread-local arena. `MaybeUninit` because Zig writes `undefined` until
    /// [`Worker::create`] runs; reading it before `has_created` is UB.
    pub heap: MaybeUninit<ThreadLocalArena>,

    /// Thread-local memory allocator
    /// All allocations are freed in `deinit` at the very end of bundling.
    // PORT NOTE: self-referential borrow of `heap` — kept as a raw pointer so
    // it can be reseated in `create()` without a self-borrow. Zig stored the
    // `std.mem.Allocator` vtable; here it's just `&heap`.
    pub allocator: *const ThreadLocalArena,

    pub ctx: *const BundleV2<'static>,

    pub data: MaybeUninit<WorkerData>,
    pub quit: bool,

    pub ast_memory_allocator: ManuallyDrop<js_ast::ASTMemoryAllocator>,
    pub has_created: bool,
    /// `ThreadPoolLib.Thread.current` — null when called off a pool thread.
    pub thread: *mut ThreadPoolLib::Thread,

    pub deinit_task: ThreadPoolLib::Task,

    pub temporary_arena: MaybeUninit<bun_alloc::Arena>,
    pub stmt_list: MaybeUninit<StmtList>,
}

pub struct WorkerData {
    // TODO(port): lifetime — TSV class ARENA (`&'arena mut Logger::Log`); kept
    // raw because the arena is the sibling field `Worker.heap`.
    pub log: *mut Logger::Log,
    pub estimated_input_lines_of_code: usize,
    // PORT NOTE: lifetime erased to `'static` behind `MaybeUninit` — the inner
    // `&'a Arena` borrows `Worker.heap`, which Rust can't express on a sibling
    // field. Zig used `transpiler: Transpiler` with a copied `std.mem.Allocator`.
    pub transpiler: MaybeUninit<Transpiler<'static>>,
    // PORT NOTE: `MaybeUninit` wrapper so `Drop` never runs on the bitwise-copied
    // `Transpiler` (see `Transpiler::clone_for_worker` safety contract — it
    // aliases the `BundleV2`-owned transpiler's heap allocations). Zig's
    // `Worker.deinit` only frees the arena, never the per-worker transpiler.
    pub other_transpiler: Option<Box<MaybeUninit<Transpiler<'static>>>>,
}

impl Worker {
    /// SAFETY: `task` must be the `deinit_task` field of a live boxed `Worker`.
    pub unsafe fn deinit_callback(task: *mut ThreadPoolLib::Task) {
        bun_core::scoped_log!(ThreadPool, "Worker.deinit()");
        // SAFETY: task points to Worker.deinit_task; offset_of recovers the parent.
        let this: *mut Worker = unsafe {
            (task as *mut u8)
                .sub(core::mem::offset_of!(Worker, deinit_task))
                .cast::<Worker>()
        };
        // SAFETY: deinit_callback is only scheduled via `deinit_soon` on a live
        // Box::into_raw'd Worker; we hold exclusive ownership on this idle task.
        unsafe { Self::deinit(this) };
    }

    pub fn deinit_soon(&mut self) {
        if let Some(thread) = unsafe { self.thread.as_ref() } {
            thread.push_idle_task(&mut self.deinit_task);
        }
    }

    /// Takes ownership of the heap allocation and frees it.
    ///
    /// # Safety
    /// `this` must have come from `Box::into_raw` in [`ThreadPool::get_worker`].
    pub unsafe fn deinit(this: *mut Worker) {
        // SAFETY: caller contract.
        let worker = unsafe { &mut *this };
        if worker.has_created {
            // SAFETY: `has_created` ⇒ `create()` ran ⇒ these fields are init.
            unsafe {
                worker.heap.assume_init_drop();
                worker.temporary_arena.assume_init_drop();
                worker.stmt_list.assume_init_drop();
                ptr::drop_in_place(worker.data.assume_init_mut());
                ManuallyDrop::drop(&mut worker.ast_memory_allocator);
            }
        }
        // SAFETY: caller contract — `this` was Box::into_raw'd. Reclaim the
        // allocation without running field destructors (handled above).
        drop(unsafe { Box::<MaybeUninit<Worker>>::from_raw(this.cast()) });
    }

    // PORT NOTE: returns `&'static mut` (detached) — the `Worker` is
    // heap-pinned (Box::into_raw in `get_worker`) and outlives any `ctx`
    // borrow; Zig returned `*Worker`. Tying it to `ctx`'s lifetime would
    // forbid the `worker` ↔ `ctx` re-borrows in `ParseTask::run_*`.
    pub fn get(ctx: &BundleV2<'_>) -> &'static mut Worker {
        // SAFETY: `ctx` is a BACKREF; `graph.pool` is a `NonNull<ThreadPool>`
        // pointing at the bundle-owned pool that outlives every worker. We only
        // need a shared `&ThreadPool` — `get_worker` takes `&self` and serializes
        // map mutation via the internal `parking_lot::Mutex`, so concurrent
        // entry from multiple worker threads is sound.
        let pool: &ThreadPool = unsafe { ctx.graph.pool.as_ref() };
        let worker = pool.get_worker(bun_threading::current_thread_id());
        if !worker.has_created {
            worker.create(ctx);
        }

        worker.ast_memory_allocator.push();

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

        self.ast_memory_allocator.pop();
    }

    pub fn init(&mut self, v2: &BundleV2<'_>) {
        self.ctx = (v2 as *const BundleV2<'_>).cast();
    }

    fn create(&mut self, ctx: &BundleV2<'_>) {
        // PORT NOTE: `bun_perf::trace` takes a generated `PerfEvent` enum, and
        // the generator hasn't emitted `Bundler.Worker.create` yet (only
        // `_Stub`). Dropped to avoid mis-attributing the span.
        // let _trace = bun_perf::trace("Bundler.Worker.create");

        self.has_created = true;
        Output::Source::configure_thread();
        self.heap.write(ThreadLocalArena::new());
        // Self-referential — `allocator` borrows `self.heap`.
        // SAFETY: heap was just initialized on the line above.
        self.allocator = unsafe { self.heap.assume_init_ref() } as *const ThreadLocalArena;

        let allocator = self.allocator;

        // Zig: `.{ .allocator = this.allocator }` then `reset()`. The Rust
        // ASTMemoryAllocator owns its bump arena internally and ignores the
        // passed fallback (see ASTMemoryAllocator::new doc).
        // SAFETY: allocator points to the just-initialized self.heap.
        *self.ast_memory_allocator =
            js_ast::ASTMemoryAllocator::new(unsafe { &*allocator });
        self.ast_memory_allocator.reset();

        // SAFETY: allocator points to self.heap which outlives self.data.
        let log: *mut Logger::Log = unsafe { (*allocator).alloc(Logger::Log::init()) };
        self.data.write(WorkerData {
            log,
            estimated_input_lines_of_code: 0,
            // Filled by `initialize_transpiler` immediately below.
            transpiler: MaybeUninit::uninit(),
            other_transpiler: None,
        });
        self.ctx = (ctx as *const BundleV2<'_>).cast();
        // PERF(port): was `bun.ArenaAllocator.init(this.allocator)` — using a
        // fresh Bump (no nested-arena type yet).
        self.temporary_arena.write(bun_alloc::Arena::new());
        self.stmt_list.write(StmtList::init());
        // SAFETY: self.data was just written above.
        let data = unsafe { self.data.assume_init_mut() };
        Self::initialize_transpiler(data.log, &mut data.transpiler, ctx.transpiler(), allocator);

        bun_core::scoped_log!(ThreadPool, "Worker.create()");
    }

    /// Clone `from` into `transpiler` and rewire its log/allocator/resolver.
    ///
    /// PORT NOTE: reshaped for borrowck — associated fn (no `&mut self`) so
    /// callers can borrow `self.data.transpiler` and `self.data.log` disjointly.
    fn initialize_transpiler(
        log: *mut Logger::Log,
        transpiler: &mut MaybeUninit<Transpiler<'static>>,
        from: &Transpiler<'_>,
        allocator: *const ThreadLocalArena,
    ) {
        // Zig: `transpiler.* = from.*;`
        // SAFETY: `from` is the `BundleV2`-owned transpiler which outlives every
        // worker; the slot is `MaybeUninit` so `Drop` never runs on the bitwise
        // copy (`clone_for_worker` contract). Written in-place so no owned
        // aliased `Transpiler` ever exists on the stack across an unwind point.
        unsafe { Transpiler::<'static>::clone_for_worker(from, transpiler) };
        // SAFETY: written on the line above.
        let t = unsafe { transpiler.assume_init_mut() };
        t.set_log(log);
        // PORT NOTE: reseat `resolver.fs` from the raw `t.fs` so each per-worker
        // clone holds its own `&mut FileSystem` borrow — the bitwise
        // `clone_for_worker` above duplicated the parent's live `&mut` (aliased
        // unique reference, UB under Stacked Borrows). `set_log` already does
        // this for `resolver.log`; this mirrors it for `fs`.
        // TODO(port): proper fix is `Resolver.{fs,log}: *mut _` (matching
        // `Transpiler.{fs,log}` which are already raw for exactly this reason
        // — see transpiler.rs:54-66). Out of scope here (resolver/lib.rs).
        // SAFETY: `t.fs` points at the process-lifetime `Fs::FileSystem`
        // singleton (transpiler.rs `Transpiler::init`); outlives every worker.
        t.resolver.fs = unsafe { &mut *t.fs };
        // SAFETY: `allocator` points at `Worker.heap` (initialized in `create`)
        // which outlives `WorkerData`; lifetime erased to `'static` to match the
        // slot's erased `Transpiler<'static>`.
        t.set_allocator(unsafe { &*allocator });
        // PORT NOTE: `transpiler.linker.resolver = &transpiler.resolver` —
        // `crate::Linker` is still the unit stub `Linker(())` (lib.rs:158); the
        // self-referential resolver backref is wired by `configure_linker` once
        // the real `linker::Linker` lands in the `Transpiler` struct.
        // PORT NOTE: `js_ast::Macro::MacroContext::init` at this tier only
        // carries `javascript_object` (the resolver/env/remap backrefs live in
        // `bun_js_parser_jsc`); `Default` is structurally identical to `init(t)`
        // here. Swap to `init(t)` once `bun_js_parser_jsc` owns the full type.
        t.macro_context = Some(js_ast::Macro::MacroContext::default());
        // PORT NOTE: `Resolver.caches` is `bun_resolver::cache::Set` (the
        // MOVE_DOWN copy that broke the bundler→resolver cycle), not this
        // crate's `cache::Set` aliased above as `CacheSet`.
        t.resolver.caches = bun_resolver::cache::Set::init();
    }

    pub fn transpiler_for_target(&mut self, target: Target) -> &mut Transpiler<'static> {
        // SAFETY: callers only invoke this after `Worker::get` → `create()`.
        let data = unsafe { self.data.assume_init_mut() };
        // SAFETY: `create()` wrote `data.transpiler` via `initialize_transpiler`.
        let primary = unsafe { data.transpiler.assume_init_mut() };
        if target == Target::Browser && primary.options.target != target {
            if data.other_transpiler.is_none() {
                // PORT NOTE: Zig wrote `undefined` into the Option payload then
                // borrowed it; mirror with an uninit Box.
                let mut slot: Box<MaybeUninit<Transpiler<'static>>> = Box::new_uninit();
                // SAFETY: `ctx` is a valid backref; `client_transpiler` must be
                // Some in this branch per Zig `.?`.
                let client: &Transpiler<'_> =
                    unsafe { (*self.ctx).client_transpiler.unwrap_unchecked().as_ref() };
                Self::initialize_transpiler(data.log, &mut slot, client, self.allocator);
                data.other_transpiler = Some(slot);
            }
            // SAFETY: `initialize_transpiler` fully wrote the slot above (or on
            // a prior call); the `MaybeUninit` wrapper exists only to suppress
            // `Drop` on the bitwise-copied `Transpiler` (see `clone_for_worker`
            // safety contract).
            let other = unsafe {
                data.other_transpiler
                    .as_deref_mut()
                    .unwrap_unchecked()
                    .assume_init_mut()
            };
            debug_assert!(other.options.target == target);
            return other;
        }

        primary
    }

    pub fn run(&mut self, ctx: &BundleV2<'_>) {
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
//   blocked_on: crate::Linker.resolver (unit stub — see initialize_transpiler PORT NOTE);
//               bun_alloc::MimallocArena (help_catch_memory_issues);
//               bun_perf PerfEvent codegen (Bundler.Worker.create)
//   notes:      Heavy `undefined`-init + self-referential allocator field →
//               MaybeUninit/ManuallyDrop on Worker. io_thread_pool::shutdown()
//               Zig source missing trailing return; io_thread_pool::acquire()
//               Zig source skips ref-count bump on the lock-race path (mirrored).
// ──────────────────────────────────────────────────────────────────────────
