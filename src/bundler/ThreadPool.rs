//! The bundler-side worker pool that wraps
//! `bun_threading::thread_pool::ThreadPool` and owns the per-thread
//! [`Worker`] state (mimalloc arena, per-thread `Transpiler` clone, AST store).
//!
//! `Worker::new` builds the per-worker `Transpiler` via
//! `Transpiler::for_worker` (per-field deep clone of the pool's seed); the
//! self-referential `linker` backrefs are wired by
//! `Transpiler::wire_after_move` once the value is at its final address.

use core::mem::ManuallyDrop;
use std::sync::OnceLock;

use bun_alloc::Arena as ThreadLocalArena;
use bun_core::{self, env_var, output as Output};
use bun_sys::Fd;
use bun_threading::thread_pool as ThreadPoolLib;

use crate::cache::{Contents, Entry as CacheEntry};
use crate::defines::Define;

/// What a transpiler's files are parsed against; the ASTs borrow from it, so
/// the [`BundleHeap`] keeps it (see [`BundleHeap::keep_parse_config`]).
pub struct ParseConfig {
    pub define: std::sync::Arc<Define>,
    pub allow_unresolved: crate::options::AllowUnresolved,
}
use crate::linker_context_mod::StmtList;
use crate::options_impl::Target;
use crate::parse_task::{ContentsOrFd, ParseTask, ParseTaskStage};
use crate::transpiler::Transpiler;
use bun_js_parser as js_ast;

bun_core::declare_scope!(ThreadPool, visible);

pub struct ThreadPool<'a> {
    /// macOS holds an IORWLock on every file open.
    /// This causes massive contention after about 4 threads as of macOS 15.2
    /// On Windows, this seemed to be a small performance improvement.
    /// On Linux, this was a performance regression.
    /// In some benchmarks on macOS, this yielded up to a 60% performance improvement in microbenchmarks that load ~10,000 files.
    io_pool: Option<&'static ThreadPoolLib::ThreadPool>,
    worker_pool: WorkerPool,
    /// One [`Worker`] per thread that runs this bundle's tasks (pool threads
    /// and the bundle thread itself).
    workers: bun_threading::ThreadSlots<Worker<'a>>,
    /// One [`IoReader`] per IO-pool thread (when the read stage runs there).
    readers: bun_threading::ThreadSlots<IoReader<'a>>,
    heap: &'a BundleHeap,
    /// What a [`Worker`] clones its transpilers from: the transpiler the
    /// bundle was started with (lent by whoever drives the bundle). Workers
    /// read its options and resolver configuration only — the parts the
    /// bundle thread leaves alone while it resolves through it.
    seed: bun_ptr::Lent<Transpiler<'a>>,
    /// Set (once) when the bundle first needs a browser transpiler.
    client_seed: OnceLock<(bun_ptr::Lent<Transpiler<'a>>, &'a ParseConfig)>,
    /// The defines files are parsed against (their ASTs borrow from them);
    /// kept by the [`BundleHeap`].
    define: &'a ParseConfig,
    /// Every [`ParseTask`] / `ServerComponentParseTask` handed to a pool;
    /// joined by [`deinit`](Self::deinit) before the workers go.
    parse_tasks: bun_threading::TaskGroup,
    deinited: bool,
}

// SAFETY: what other threads reach through `&ThreadPool` is `workers` (each
// thread its own slot), the pools (thread-safe), `parse_tasks` (a counter),
// and the seeds — read-only after construction (`client_seed` is a
// `OnceLock`), and only read to clone a per-thread transpiler from.
unsafe impl Sync for ThreadPool<'_> {}
// SAFETY: owned by the bundle; moving it moves the seeds and the joined-out
// workers, all of which `deinit`/drop on the bundle thread.
unsafe impl Send for ThreadPool<'_> {}

enum WorkerPool {
    Owned(Box<ThreadPoolLib::ThreadPool>),
    Shared(&'static ThreadPoolLib::ThreadPool),
    /// After [`ThreadPool::deinit`].
    Gone,
}

mod io_thread_pool {
    use super::*;

    static THREAD_POOL: OnceLock<ThreadPoolLib::ThreadPool> = OnceLock::new();

    pub(super) fn max_threads() -> u16 {
        bun_core::get_thread_count().clamp(2, 4)
    }

    pub(super) fn get() -> &'static ThreadPoolLib::ThreadPool {
        THREAD_POOL.get_or_init(|| {
            ThreadPoolLib::ThreadPool::init(ThreadPoolLib::Config {
                max_threads: u32::from(max_threads()),
                // Use a much smaller stack size for the IO thread pool
                stack_size: 512 * 1024,
            })
        })
    }
}

// SAFETY: a `Worker` is created and used only on the thread that claimed its
// `ThreadSlots` slot; `ThreadPool::deinit` moves it out after every task has
// finished, hands its thread-affine parts back to that thread
// (`WorkerTeardown`) and drops the transpilers, whose storage is
// global-allocator memory.
unsafe impl Send for Worker<'_> {}

/// The arenas a bundle allocates into: the bundle thread's own, and one per
/// thread that parses for it (created lazily, on that thread). Owned by
/// whoever drives the bundle and outlives the [`BundleV2`] that borrows it, so
/// everything parsed into a worker arena (`Graph::ast`) carries its lifetime.
/// Derefs to the bundle thread's arena.
pub struct BundleHeap {
    main: ThreadLocalArena,
    workers: Box<[OnceLock<ThreadLocalArena>]>,
    /// File contents read on the IO pool land here (one per IO thread).
    readers: Box<[OnceLock<ThreadLocalArena>]>,
    /// Per-bundle values the graph's ASTs borrow from (see
    /// [`keep_parse_config`](Self::keep_parse_config)).
    parse_configs: bun_threading::KeepAlive<ParseConfig>,
    file_maps: bun_threading::KeepAlive<crate::bundle_v2::FileMap>,
}

impl Default for BundleHeap {
    fn default() -> Self {
        Self::new()
    }
}

impl BundleHeap {
    pub fn new() -> Self {
        // Every thread that may ask for a worker: the parse pool (sized to
        // the machine, owned or the shared `WorkPool`), the IO pool when it
        // is used, and the thread driving the bundle.
        let io = if ThreadPool::uses_io_pool() {
            usize::from(io_thread_pool::max_threads())
        } else {
            0
        };
        let threads = usize::from(bun_core::get_thread_count()) + 1;
        Self {
            main: ThreadLocalArena::new(),
            workers: (0..threads).map(|_| OnceLock::new()).collect(),
            readers: (0..io).map(|_| OnceLock::new()).collect(),
            parse_configs: bun_threading::KeepAlive::new(),
            file_maps: bun_threading::KeepAlive::new(),
        }
    }

    /// A copy of what `options`' files are parsed against that lives as long
    /// as the heap: parsed ASTs reference it.
    pub(crate) fn keep_parse_config(
        &self,
        options: &crate::options::BundleOptions<'_>,
    ) -> &ParseConfig {
        self.parse_configs.keep(Box::new(ParseConfig {
            define: std::sync::Arc::clone(&options.define),
            allow_unresolved: options.allow_unresolved.clone(),
        }))
    }

    /// `Bun.build({ files })`: sources resolved from the map borrow its bytes,
    /// so it lives as long as the heap.
    pub fn keep_file_map(&self, files: crate::bundle_v2::FileMap) -> &crate::bundle_v2::FileMap {
        self.file_maps.keep(Box::new(files))
    }

    /// The calling thread's worker arena for slot `index`, created on first use.
    fn worker(&self, index: usize) -> &ThreadLocalArena {
        self.workers[index].get_or_init(ThreadLocalArena::new)
    }

    /// The calling IO thread's arena for slot `index`, created on first use.
    fn reader(&self, index: usize) -> &ThreadLocalArena {
        self.readers[index].get_or_init(ThreadLocalArena::new)
    }
}

impl core::ops::Deref for BundleHeap {
    type Target = ThreadLocalArena;
    #[inline]
    fn deref(&self) -> &ThreadLocalArena {
        &self.main
    }
}

impl<'a> ThreadPool<'a> {
    /// `worker_pool`: the process-wide `WorkPool` to share, or `None` to spin
    /// up (and own) a pool sized to the machine. `seed`: what workers clone
    /// their transpilers from.
    pub(crate) fn init(
        heap: &'a BundleHeap,
        worker_pool: Option<&'static ThreadPoolLib::ThreadPool>,
        seed: bun_ptr::Lent<Transpiler<'a>>,
        define: &'a ParseConfig,
        client_seed: Option<(bun_ptr::Lent<Transpiler<'a>>, &'a ParseConfig)>,
    ) -> ThreadPool<'a> {
        let worker_pool = match worker_pool {
            Some(p) => WorkerPool::Shared(p),
            None => {
                let cpu_count = bun_core::get_thread_count();
                let pool = Box::new(ThreadPoolLib::ThreadPool::init(ThreadPoolLib::Config {
                    max_threads: u32::from(cpu_count),
                    ..Default::default()
                }));
                bun_core::scoped_log!(ThreadPool, "{} workers", cpu_count);
                WorkerPool::Owned(pool)
            }
        };
        let io_pool = if Self::uses_io_pool() {
            Some(io_thread_pool::get())
        } else {
            None
        };
        let client_seed_lock = OnceLock::new();
        if let Some(client) = client_seed {
            let _ = client_seed_lock.set(client);
        }
        ThreadPool {
            worker_pool,
            io_pool,
            heap,
            workers: bun_threading::ThreadSlots::new(heap.workers.len()),
            readers: bun_threading::ThreadSlots::new(heap.readers.len()),
            seed,
            define,
            client_seed: client_seed_lock,
            parse_tasks: bun_threading::TaskGroup::new(),
            deinited: false,
        }
    }

    /// Block until every task handed to `schedule*` so far has run (and so
    /// dropped what it held of the bundle).
    pub(crate) fn wait_for_all(&self) {
        self.parse_tasks.wait();
    }

    /// Wait for every scheduled task, tear the workers down (each on its own
    /// thread) and release the pools.
    pub(crate) fn deinit(&mut self) {
        if self.deinited {
            return;
        }
        self.deinited = true;
        // Joins every task handed to `schedule*`; nothing runs on a worker after this.
        drop(core::mem::take(&mut self.parse_tasks));
        let mut any = false;
        for worker in self.workers.take_all() {
            any = true;
            Worker::deinit_soon(worker);
        }
        drop(self.readers.take_all());
        if any {
            self.worker_pool().wake_for_idle_events();
            if let Some(io) = self.io_pool {
                io.wake_for_idle_events();
            }
        }
        // An owned pool is shut down and joined here (its threads run their
        // idle queues on the way out).
        self.worker_pool = WorkerPool::Gone;
    }

    #[inline]
    pub(crate) fn worker_pool(&self) -> &ThreadPoolLib::ThreadPool {
        self.worker_pool.get()
    }

    pub(crate) fn start(&self) {
        self.worker_pool().warm(8);
        if let Some(io) = self.io_pool {
            io.warm(1);
        }
    }

    pub(crate) fn uses_io_pool() -> bool {
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

    /// The seed for browser files of a server-side build; set by the bundle
    /// thread the first time it creates its client transpiler.
    pub(crate) fn set_client_seed(
        &self,
        client: bun_ptr::Lent<Transpiler<'a>>,
        define: &'a ParseConfig,
    ) {
        let _ = self.client_seed.set((client, define));
    }

    #[inline]
    pub(crate) fn seed(&self) -> &Transpiler<'a> {
        &self.seed
    }

    #[inline]
    pub(crate) fn client_seed(&self) -> Option<&Transpiler<'a>> {
        self.client_seed.get().map(|(b, _)| &**b)
    }

    fn schedule_with_options(
        &self,
        mut parse_task: Box<ParseTask<'a>>,
        is_inside_thread_pool: bool,
    ) {
        if matches!(parse_task.stage, ParseTaskStage::NeedsSourceCode) {
            if let ContentsOrFd::Contents(contents) = parse_task.contents_or_fd {
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
        }

        let pool = match (self.io_pool, &parse_task.stage) {
            (Some(io), ParseTaskStage::NeedsSourceCode) => io,
            _ => self.worker_pool(),
        };
        if is_inside_thread_pool {
            self.parse_tasks
                .schedule_inside_thread_pool(pool, parse_task);
        } else {
            self.parse_tasks.schedule(pool, parse_task);
        }
    }

    pub(crate) fn schedule(&self, parse_task: Box<ParseTask<'a>>) {
        self.schedule_with_options(parse_task, false);
    }

    pub(crate) fn schedule_inside_thread_pool(&self, parse_task: Box<ParseTask<'a>>) {
        self.schedule_with_options(parse_task, true);
    }

    /// Queue any other [`GroupTask`](bun_threading::GroupTask) of this bundle
    /// on the parse pool.
    pub(crate) fn schedule_task<T: bun_threading::GroupTask>(&self, task: Box<T>) {
        self.parse_tasks.schedule(self.worker_pool(), task);
    }

    /// The calling IO-pool thread's [`IoReader`], created on first use.
    #[inline]
    pub(crate) fn get_io_reader(&self) -> bun_threading::SlotGuard<'_, IoReader<'a>> {
        let heap = self.heap;
        self.readers.get_or_init(|index| IoReader {
            heap: heap.reader(index),
            fs_cache: Default::default(),
        })
    }

    /// The calling thread's [`Worker`], created on first use, with its AST
    /// store pushed for the guard's lifetime.
    #[inline]
    pub(crate) fn get_worker(&self) -> WorkerGuard<'_, 'a> {
        let heap = self.heap;
        let mut worker = self
            .workers
            .get_or_init(|index| Worker::new(&self.seed, heap.worker(index)));
        worker.ast_memory_store.push();
        WorkerGuard {
            worker,
            client: self.client_seed(),
            define: self.define,
            client_define: self.client_seed.get().map(|(_, d)| *d),
        }
    }
}

impl Drop for ThreadPool<'_> {
    fn drop(&mut self) {
        self.deinit();
    }
}

impl WorkerPool {
    #[inline]
    fn get(&self) -> &ThreadPoolLib::ThreadPool {
        match self {
            WorkerPool::Owned(p) => p,
            WorkerPool::Shared(p) => p,
            WorkerPool::Gone => unreachable!("bundler ThreadPool used after deinit"),
        }
    }
}

/// What the read stage of a [`ParseTask`] needs on an IO-pool thread: an
/// arena for the file's bytes (they live as long as the bundle) and the
/// file-reading scratch state — no transpiler.
pub struct IoReader<'a> {
    pub(crate) heap: &'a ThreadLocalArena,
    pub(crate) fs_cache: bun_resolver::cache::Fs,
}

/// The calling thread's [`Worker`]; pops its AST store on drop.
pub struct WorkerGuard<'p, 'a> {
    worker: bun_threading::SlotGuard<'p, Worker<'a>>,
    client: Option<&'p Transpiler<'a>>,
    /// What the primary / browser transpiler parse against.
    pub(crate) define: &'a ParseConfig,
    pub(crate) client_define: Option<&'a ParseConfig>,
}

impl<'p, 'a> WorkerGuard<'p, 'a> {
    /// See [`Worker::transpilers_for_target`].
    #[inline]
    pub(crate) fn transpilers_for_target(&mut self, target: Target) -> TargetTranspilers<'_, 'a> {
        let client = self.client;
        self.worker.transpilers_for_target(client, target)
    }
}

impl<'a> core::ops::Deref for WorkerGuard<'_, 'a> {
    type Target = Worker<'a>;
    #[inline]
    fn deref(&self) -> &Worker<'a> {
        &self.worker
    }
}

impl<'a> core::ops::DerefMut for WorkerGuard<'_, 'a> {
    #[inline]
    fn deref_mut(&mut self) -> &mut Worker<'a> {
        &mut self.worker
    }
}

impl Drop for WorkerGuard<'_, '_> {
    #[inline]
    fn drop(&mut self) {
        self.worker.ast_memory_store.pop();
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Worker
// ───────────────────────────────────────────────────────────────────────────

/// Per-OS-thread bundler state; lives boxed in [`ThreadPool::workers`].
pub struct Worker<'a> {
    /// This thread's arena in the [`BundleHeap`], for everything it parses.
    pub(crate) heap: &'a ThreadLocalArena,

    pub(crate) data: WorkerData<'a>,

    pub(crate) ast_memory_store: ManuallyDrop<bun_ast::ASTMemoryAllocator>,
    /// The pool thread this worker belongs to, for running its teardown
    /// there; `None` when created off a pool thread. The pool's threads outlive
    /// the bundle's workers (the pool is joined, or never shut down).
    thread: Option<bun_threading::ThreadRef>,

    pub(crate) temporary_arena: bun_alloc::Arena,
    pub(crate) stmt_list: StmtList,
}

pub struct WorkerData<'a> {
    /// The log `transpiler`/`other_transpiler` (and their resolvers) write to.
    pub(crate) log: Box<bun_ast::Log>,
    pub(crate) transpiler: Box<Transpiler<'a>>,
    pub(crate) other_transpiler: Option<Box<Transpiler<'a>>>,
}

/// The parts of a [`Worker`] that must be torn down on the thread that
/// created them.
struct WorkerTeardown {
    task: ThreadPoolLib::Task,
    ast_memory_store: bun_ast::ASTMemoryAllocator,
    temporary_arena: bun_alloc::Arena,
    macro_contexts: [Option<js_ast::Macro::MacroContext>; 2],
}

bun_threading::owned_task!(WorkerTeardown, task);

impl WorkerTeardown {
    #[allow(clippy::boxed_local)] // `OwnedTask`s are handed over boxed
    fn run_owned(self: Box<Self>) {
        bun_core::scoped_log!(ThreadPool, "Worker.deinit()");
        let this = *self;
        // `wire_after_move` boxed a `bun_js_parser_jsc::Macro::MacroContext`
        // behind `macro_context.data` (raw `*mut`, no `Drop` glue). The box
        // only owns a `MacroMap` and a lazy `bun_alloc::Arena`, no JSC handles.
        for ctx in this.macro_contexts.into_iter().flatten() {
            ctx.deinit();
        }
        js_ast::Macro::collect_vm_garbage();
        drop(this.temporary_arena);
        drop(this.ast_memory_store);
    }
}

impl<'a> Worker<'a> {
    fn new(seed: &Transpiler<'a>, heap: &'a ThreadLocalArena) -> Worker<'a> {
        Output::Source::configure_thread();

        // The ASTMemoryAllocator owns its bump arena internally and ignores the
        // passed fallback (see ASTMemoryAllocator::new doc).
        let mut ast_memory_store = ManuallyDrop::new(bun_ast::ASTMemoryAllocator::new(heap));
        ast_memory_store.reset();

        let mut log = Box::new(bun_ast::Log::init());
        let log_ptr: *mut bun_ast::Log = &raw mut *log;
        let mut transpiler = Box::new(Transpiler::for_worker(seed, heap, log_ptr));
        // Wire self-referential `linker`/`macro_context` now that `transpiler`
        // is at its final (heap) address.
        transpiler.wire_after_move();

        bun_core::scoped_log!(ThreadPool, "Worker.create()");
        Worker {
            heap,
            data: WorkerData {
                log,
                transpiler,
                other_transpiler: None,
            },
            ast_memory_store,
            thread: ThreadPoolLib::Thread::current_ref(),
            temporary_arena: bun_alloc::Arena::new(),
            stmt_list: StmtList::init(),
        }
    }

    /// This thread's arena in the [`BundleHeap`].
    #[inline]
    pub(crate) fn arena(&self) -> &'a ThreadLocalArena {
        self.heap
    }

    /// Hand the thread-affine parts back to the worker's own thread for
    /// teardown (or tear down here if it has none); drop the rest now.
    #[allow(clippy::boxed_local)] // as `ThreadSlots` hands it back
    fn deinit_soon(worker: Box<Worker<'a>>) {
        let Worker {
            heap: _,
            mut data,
            ast_memory_store,
            thread,
            temporary_arena,
            stmt_list,
        } = *worker;
        let teardown = Box::new(WorkerTeardown {
            task: ThreadPoolLib::Task::default(),
            ast_memory_store: ManuallyDrop::into_inner(ast_memory_store),
            temporary_arena,
            macro_contexts: [
                data.transpiler.macro_context.take(),
                data.other_transpiler
                    .as_deref_mut()
                    .and_then(|t| t.macro_context.take()),
            ],
        });
        drop(stmt_list);
        drop(data);
        match thread {
            Some(thread) => thread.push_idle_owned(teardown),
            None => teardown.run_owned(),
        }
    }

    /// The transpiler for `target`, plus (lazily) the browser transpiler for
    /// when the file turns out to be client-side.
    pub(crate) fn transpilers_for_target<'w>(
        &'w mut self,
        client: Option<&'w Transpiler<'a>>,
        target: Target,
    ) -> TargetTranspilers<'w, 'a> {
        let heap = self.heap;
        let data = &mut self.data;
        if data.transpiler.options.target == Target::Browser {
            return TargetTranspilers {
                primary: &mut data.transpiler,
                browser: BrowserSlot::IsPrimary,
                primary_is_client: false,
            };
        }
        let browser = BrowserSlot::Other {
            slot: &mut data.other_transpiler,
            log: &mut data.log,
            client,
            heap,
        };
        if target == Target::Browser {
            TargetTranspilers {
                primary: browser
                    .into_transpiler()
                    .expect("BrowserSlot::Other yields a transpiler"),
                browser: BrowserSlot::IsPrimary,
                primary_is_client: true,
            }
        } else {
            TargetTranspilers {
                primary: &mut data.transpiler,
                browser,
                primary_is_client: false,
            }
        }
    }
}

pub(crate) struct TargetTranspilers<'w, 'a> {
    pub primary: &'w mut Transpiler<'a>,
    pub browser: BrowserSlot<'w, 'a>,
    /// `primary` is the worker's clone of the bundle's client transpiler
    /// (a browser file of a server-side build): parse against the client
    /// [`ParseConfig`].
    pub primary_is_client: bool,
}

/// A worker's browser-target transpiler, relative to
/// [`TargetTranspilers::primary`].
pub(crate) enum BrowserSlot<'w, 'a> {
    /// `primary` already targets the browser.
    IsPrimary,
    /// A separate per-worker clone of the pool's client seed (`client`),
    /// created on first use in this worker's arena (`heap`).
    Other {
        slot: &'w mut Option<Box<Transpiler<'a>>>,
        log: &'w mut Box<bun_ast::Log>,
        client: Option<&'w Transpiler<'a>>,
        heap: &'a ThreadLocalArena,
    },
}

impl<'w, 'a> BrowserSlot<'w, 'a> {
    /// The browser transpiler if it is not `primary`.
    pub(crate) fn into_transpiler(self) -> Option<&'w mut Transpiler<'a>> {
        match self {
            BrowserSlot::IsPrimary => None,
            BrowserSlot::Other {
                slot,
                log,
                client,
                heap,
            } => {
                let other: &mut Transpiler<'a> = slot.get_or_insert_with(|| {
                    let client: &Transpiler<'a> =
                        client.expect("BundleV2 has a client transpiler for browser files");
                    let log_ptr: *mut bun_ast::Log = &raw mut **log;
                    let mut boxed = Box::new(Transpiler::for_worker(client, heap, log_ptr));
                    boxed.wire_after_move();
                    boxed
                });
                debug_assert!(other.options.target == Target::Browser);
                Some(other)
            }
        }
    }
}
