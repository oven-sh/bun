#![allow(unused_imports, unused_variables, dead_code, unused_mut, clippy::needless_return)]
#![warn(unused_must_use)]

use bun_collections::{VecExt, ByteVecExt};
use core::cell::Cell;
use core::ffi::c_void;
use core::mem::offset_of;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};

use bun_io::{AllocatorType, KeepAlive};
use bun_io::posix_event_loop::get_vm_ctx;
use bun_alloc::Arena;
use bun_bundler::analyze_transpiled_module;
use bun_bundler::options::{self, Loader, ModuleType};
use bun_bundler::transpiler::{
    self as transpiler, AlreadyBundled, ParseOptions, ParseResult, Transpiler,
};
use bun_collections::HiveArrayFallback;
use bun_event_loop::{task_tag, TaskTag, Taskable};
use bun_js_parser::ast::{self as js_ast, ASTMemoryAllocator, ExportsKind};
use bun_js_printer::{self as js_printer, BufferPrinter, BufferWriter};
use bun_logger as logger;
use bun_options_types::{ImportRecord, ImportRecordFlags};
use bun_paths;
use bun_resolve_builtins::{Alias as HardcodedAlias, Cfg as HardcodedAliasCfg};
use bun_resolver::fs as Fs;
use bun_resolver::node_fallbacks;
use bun_resolver::package_json::{MacroMap as MacroRemap, PackageJSON};
use bun_string::{strings, MutableString, String};
use bun_sys::{self, Dir, Fd, FdExt as _, File, OpenDirOptions};
use bun_threading::unbounded_queue::{self, UnboundedQueue};
use bun_threading::Mutex;
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};
use bun_watcher::{WatchItemColumns, Watcher};

use crate::async_module::AsyncModule;
use crate::event_loop::{ConcurrentTask, EventLoop};
use crate::hot_reloader::ImportWatcher;
use crate::resolved_source_tag::ResolvedSourceTag;
use crate::runtime_transpiler_cache::{
    Entry as CacheEntry, ModuleType as CacheModuleType, OutputCode,
    RuntimeTranspilerCache as JscRuntimeTranspilerCache,
};
use crate::strong::Optional as StrongOptional;
use crate::virtual_machine::{create_if_different, SourceMapHandlerGetter, VirtualMachine};
use crate::{JSGlobalObject, JSInternalPromise, JSValue, JsError, JsResult, ResolvedSource};

// LAYERING: `ParseOptions.runtime_transpiler_cache` carries the canonical
// lower-tier type from `bun_js_parser` (re-exported via `bun_bundler`). The
// JSC-tier disk-backed `Entry` is round-tripped through it type-erased via
// `JSC_PARSER_CACHE_VTABLE` (see RuntimeTranspilerCache.rs).
use bun_bundler::RuntimeTranspilerCache;

bun_core::declare_scope!(RuntimeTranspilerStore, hidden);

// ──────────────────────────────────────────────────────────────────────────
// Debug source dumping (debug-only helpers; no-ops in release)
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: takes `*mut VirtualMachine` (not `&mut`) — these are called from
// the transpiler worker thread while the JS thread is concurrently live on the
// same VM, so a `&mut VirtualMachine` would be a data race AND would alias the
// caller's `&mut TranspilerJob` (which is stored inside `vm.transpiler_store`).
// Only the `source_mappings` leaf field is touched, under its own internal lock.
pub fn dump_source(vm: *mut VirtualMachine, specifier: &[u8], printer: &BufferPrinter) {
    dump_source_string(vm, specifier, printer.ctx.get_written());
}

pub fn dump_source_string(vm: *mut VirtualMachine, specifier: &[u8], written: &[u8]) {
    if let Err(e) = dump_source_string_failiable(vm, specifier, written) {
        bun_core::output::debug_warn(&format_args!("Failed to dump source string: {}", e.name()));
    }
}

// Zig: local `struct { pub var dir; pub var lock; }` — module statics in Rust.
struct BunDebugHolder {
    dir: Option<Dir>,
}
static BUN_DEBUG_HOLDER_LOCK: Mutex = Mutex::new();
// PORTING.md §Global mutable state: every access guarded by
// `BUN_DEBUG_HOLDER_LOCK` → RacyCell (the mutex is the synchronization).
static BUN_DEBUG_HOLDER: bun_core::RacyCell<BunDebugHolder> =
    bun_core::RacyCell::new(BunDebugHolder { dir: None });

pub fn dump_source_string_failiable(
    vm: *mut VirtualMachine,
    specifier: &[u8],
    written: &[u8],
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        return Ok(());
    }
    if bun_core::env_var::feature_flag::BUN_DEBUG_NO_DUMP.get().unwrap_or(false) {
        return Ok(());
    }

    let _lock = BUN_DEBUG_HOLDER_LOCK.lock_guard();
    // SAFETY: every access to BUN_DEBUG_HOLDER is guarded by BUN_DEBUG_HOLDER_LOCK.
    let holder = unsafe { &mut *BUN_DEBUG_HOLDER.get() };

    let mut path_buf = bun_paths::PathBuffer::default();

    let dir = match holder.dir {
        Some(d) => d,
        None => {
            let base_name: &[u8] = if cfg!(windows) {
                // Spec: bun.fs.FileSystem.RealFS.platformTempDir() ++ "\\bun-debug-src"
                let temp = Fs::RealFS::platform_temp_dir();
                let suffix = b"\\bun-debug-src";
                path_buf.0[..temp.len()].copy_from_slice(temp);
                path_buf.0[temp.len()..temp.len() + suffix.len()].copy_from_slice(suffix);
                &path_buf.0[..temp.len() + suffix.len()]
            } else if bun_core::env::IS_ANDROID {
                b"/data/local/tmp/bun-debug-src/"
            } else {
                b"/tmp/bun-debug-src/"
            };
            let d = Dir::cwd().make_open_path(base_name, OpenDirOptions::default())?;
            holder.dir = Some(d);
            d
        }
    };

    if let Some(dir_path) = bun_paths::dirname(specifier) {
        let root_len = if cfg!(windows) {
            bun_paths::resolve_path::windows_filesystem_root(dir_path).len()
        } else {
            b"/".len()
        };
        let parent = dir.make_open_path(&dir_path[root_len..], OpenDirOptions::default())?;
        let _close_parent = scopeguard::guard(parent, |p| p.close());

        let base = bun_paths::basename(specifier);
        let base_z = bun_paths::resolve_path::z(base, &mut path_buf);
        if let Err(e) = File::write_file(parent.fd, base_z, written) {
            bun_core::output::debug_warn(&format_args!(
                "Failed to dump source string: writeFile {}",
                bun_core::Error::from(e).name()
            ));
            return Ok(());
        }

        // SAFETY: `vm` outlives this debug-only call (BACKREF — VM owns the
        // transpiler store); only the `source_mappings` leaf field is borrowed,
        // and `SavedSourceMap::get` takes its own internal mutex.
        if let Some(mappings) = unsafe { (*vm).source_mappings.get(specifier) } {
            // `defer mappings.deref()` → Arc::drop.
            let mut map_path = Vec::with_capacity(base.len() + b".map".len());
            map_path.extend_from_slice(base);
            map_path.extend_from_slice(b".map");
            let map_path_z = bun_paths::resolve_path::z(&map_path, &mut path_buf);
            let file = parent.create_file_z(map_path_z, bun_sys::CreateFlags { truncate: true, read: false })?;
            let _close_file = scopeguard::guard(file.handle, |fd| { let _ = bun_sys::close(fd); });

            // `parent.readFileAlloc(allocator, specifier, maxInt) catch ""`
            let source_file = File::read_from(parent.fd, specifier).unwrap_or_default();

            use core::fmt::Write as _;
            let mut out = std::string::String::new();
            // PORT NOTE: closures can't unify input/output lifetimes for the
            // `JSONFormatterUTF8<'_>` borrow — local fn item works.
            fn json(s: &[u8]) -> bun_core::fmt::JSONFormatterUTF8<'_> {
                bun_core::fmt::format_json_string_utf8(
                    s,
                    bun_core::fmt::JSONFormatterUTF8Options::default(),
                )
            }
            // PORT NOTE: Zig used a 4 KiB buffered writer streaming to the fd;
            // building the whole document in memory then `write_all` is
            // observationally identical for this debug-only dump.
            write!(
                out,
                "{{\n  \"version\": 3,\n  \"file\": {},\n  \"sourceRoot\": \"\",\n  \"sources\": [{}],\n  \"sourcesContent\": [{}],\n  \"names\": [],\n  \"mappings\": \"{}\"\n}}",
                json(base),
                json(specifier),
                json(&source_file),
                mappings.format_vlqs(),
            )
            .map_err(|_| bun_core::err!("WriteError"))?;
            file.write_all(out.as_bytes())?;
        }
    } else {
        let base = bun_paths::basename(specifier);
        let base_z = bun_paths::resolve_path::z(base, &mut path_buf);
        // Zig: `dir.writeFile(...) catch return;`
        let _ = File::write_file(dir.fd, base_z, written);
    }

    Ok(())
}

pub fn set_break_point_on_first_line() -> bool {
    static SET_BREAK_POINT: AtomicBool = AtomicBool::new(true);
    SET_BREAK_POINT.swap(false, Ordering::SeqCst)
}

// ──────────────────────────────────────────────────────────────────────────
// RuntimeTranspilerStore
// ──────────────────────────────────────────────────────────────────────────

pub struct RuntimeTranspilerStore {
    pub generation_number: AtomicU32,
    pub store: TranspilerJobStore,
    pub enabled: bool,
    pub queue: Queue,
}

pub type Queue = UnboundedQueue<TranspilerJob>;

impl Default for RuntimeTranspilerStore {
    fn default() -> Self {
        Self {
            generation_number: AtomicU32::new(0),
            store: TranspilerJobStore::init(),
            enabled: true,
            queue: Queue::new(),
        }
    }
}

impl Taskable for RuntimeTranspilerStore {
    const TAG: TaskTag = task_tag::RuntimeTranspilerStore;
}

impl RuntimeTranspilerStore {
    pub fn init() -> RuntimeTranspilerStore {
        // PORT NOTE: Zig passed `bun.typedAllocator(TranspilerJob)` to
        // `Store.init`; the Rust HiveArrayFallback uses the global mimalloc
        // (PORTING.md §Allocators), so the allocator arg drops.
        Self::default()
    }

    pub fn run_from_js_thread(
        &mut self,
        event_loop: *mut EventLoop,
        global: &JSGlobalObject,
        vm: *mut VirtualMachine,
    ) {
        let mut batch = self.queue.pop_batch();
        // SAFETY: `vm` is the live owning VM (caller is the JS-thread tick loop).
        let jsc_vm = unsafe { (*vm).jsc_vm };
        let mut iter = batch.iterator();
        let first = iter.next();
        if first.is_null() {
            return;
        }
        // we run just one job first to see if there are more
        // SAFETY: `first` is a live job popped from the intrusive queue.
        if let Err(err) = unsafe { (*first).run_from_js_thread() } {
            global.report_uncaught_exception_from_error(err);
        }
        loop {
            let job = iter.next();
            if job.is_null() {
                break;
            }
            // if there are more, we need to drain the microtasks from the previous run
            // SAFETY: `event_loop` is the VM's live event-loop self-pointer.
            if unsafe { (*event_loop).drain_microtasks_with_global(global, jsc_vm) }.is_err() {
                return;
            }
            // SAFETY: `job` is a live job popped from the intrusive queue.
            if let Err(err) = unsafe { (*job).run_from_js_thread() } {
                global.report_uncaught_exception_from_error(err);
            }
        }

        // immediately after this is called, the microtasks will be drained again.
    }

    pub fn transpile(
        &mut self,
        vm: *mut VirtualMachine,
        global_object: &JSGlobalObject,
        input_specifier: String,
        path: Fs::Path<'_>,
        referrer: String,
        loader: Loader,
        package_json: Option<&PackageJSON>,
    ) -> *mut c_void {
        let job: *mut TranspilerJob = self.store.get();
        // The path text is heap-duplicated here and freed in `reset_for_pool` via
        // heap::take on `path.text`.
        let owned_text: *mut [u8] = bun_core::heap::into_raw(Box::<[u8]>::from(path.text));
        // SAFETY: owned_text was just allocated via heap::alloc and lives until
        // `reset_for_pool` reconstructs and drops the Box. The unbounded
        // lifetime from raw-ptr deref coerces to `'static` for `logger::fs::Path`.
        let owned_path = logger::fs::Path::init(unsafe { &*owned_text.cast_const() });
        let promise: *mut JSInternalPromise = JSInternalPromise::create(global_object);

        // NOTE: DirInfo should already be cached since module loading happens
        // after module resolution, so this should be cheap
        let mut resolved_source = ResolvedSource::default();
        if let Some(pkg) = package_json {
            match pkg.module_type {
                ModuleType::Cjs => {
                    resolved_source.tag = ResolvedSourceTag::PackageJsonTypeCommonjs;
                    resolved_source.is_commonjs_module = true;
                }
                ModuleType::Esm => resolved_source.tag = ResolvedSourceTag::PackageJsonTypeModule,
                ModuleType::Unknown => {}
            }
        }

        // SAFETY: `job` points to an uninitialized slot returned by HiveArrayFallback::get();
        // we are the sole writer until schedule() hands it to the work pool.
        unsafe {
            job.write(TranspilerJob {
                non_threadsafe_input_specifier: input_specifier,
                path: owned_path,
                global_this: std::ptr::from_ref(global_object).cast_mut(),
                non_threadsafe_referrer: referrer,
                vm,
                log: logger::Log::init(),
                loader,
                promise: StrongOptional::create(JSValue::from_cell(promise), global_object),
                poll_ref: KeepAlive::default(),
                fetcher: Fetcher::File,
                resolved_source,
                generation_number: self.generation_number.load(Ordering::SeqCst),
                parse_error: None,
                work_task: WorkPoolTask {
                    node: Default::default(),
                    callback: TranspilerJob::run_from_worker_thread,
                },
                next: AtomicPtr::new(ptr::null_mut()),
            });
        }
        if cfg!(debug_assertions) {
            bun_core::scoped_log!(
                RuntimeTranspilerStore,
                "transpile({}, {}, async)",
                bstr::BStr::new(path.text),
                // SAFETY: job fully initialized above
                <&'static str>::from(unsafe { (*job).loader })
            );
        }
        // SAFETY: job fully initialized above
        unsafe { (*job).schedule() };
        promise.cast::<c_void>()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TranspilerJob
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: bun.heap_breakdown.enabled gate on inline capacity — the Rust
// `bun_alloc::heap_breakdown` is a no-op outside macOS Instruments builds, so
// the 64-slot hive is unconditional here.
const TRANSPILER_JOB_HIVE_CAP: usize = 64;

pub type TranspilerJobStore = HiveArrayFallback<TranspilerJob, TRANSPILER_JOB_HIVE_CAP>;

pub struct TranspilerJob {
    // PORT NOTE: stored as the lower-tier `bun_logger::fs::Path` (the type
    // `ParseOptions.path` / `logger::Source.path` use). The slices borrow the
    // Box'd buffer allocated in `transpile()` and freed in `reset_for_pool()`.
    pub path: logger::fs::Path,
    pub non_threadsafe_input_specifier: String,
    pub non_threadsafe_referrer: String,
    pub loader: Loader,
    pub promise: StrongOptional,
    // PORT NOTE: struct is stored in a HiveArray and crosses to a worker thread;
    // Zig used `*VirtualMachine` / `*JSGlobalObject` (BACKREF — VM owns the
    // store and outlives every job). Stored as raw mutable pointers.
    pub vm: *mut VirtualMachine,
    pub global_this: *mut JSGlobalObject,
    pub fetcher: Fetcher,
    pub poll_ref: KeepAlive,
    pub generation_number: u32,
    pub log: logger::Log,
    pub parse_error: Option<bun_core::Error>,
    pub resolved_source: ResolvedSource,
    pub work_task: WorkPoolTask,
    /// INTRUSIVE — `UnboundedQueue<TranspilerJob>` link.
    pub next: AtomicPtr<TranspilerJob>,
}

// SAFETY: the four accessors operate on the same `next: AtomicPtr<Self>` field;
// `UnboundedQueue` only ever passes valid, properly-aligned `*mut TranspilerJob`.
unsafe impl unbounded_queue::Node for TranspilerJob {
    #[inline]
    unsafe fn get_next(item: *mut Self) -> *mut Self {
        unsafe { (*item).next.load(Ordering::Relaxed) }
    }
    #[inline]
    unsafe fn set_next(item: *mut Self, ptr: *mut Self) {
        unsafe { (*item).next.store(ptr, Ordering::Relaxed) }
    }
    #[inline]
    unsafe fn atomic_load_next(item: *mut Self, ordering: Ordering) -> *mut Self {
        unsafe { (*item).next.load(ordering) }
    }
    #[inline]
    unsafe fn atomic_store_next(item: *mut Self, ptr: *mut Self, ordering: Ordering) {
        unsafe { (*item).next.store(ptr, ordering) }
    }
}

pub enum Fetcher {
    VirtualModule(String),
    File,
}

// PORT NOTE: Zig `Fetcher.deinit` called `.deref()` on the contained `bun.String`.
// In the Rust port `bun_string::String` is `Copy` with manual `.deref()`; matching
// Zig, decrement explicitly when replacing the enum value.
impl Fetcher {
    fn deinit(&mut self) {
        if let Fetcher::VirtualModule(s) = self {
            s.deref();
        }
    }
}

thread_local! {
    /// Per-worker parse arena (Zig: `var arena = bun.ArenaAllocator.init(...)`
    /// stack-local per call). Hoisted to a thread-local leaked `Box` so the
    /// `&'static Arena` handed to `Transpiler::set_arena` is genuinely
    /// `'static` instead of a stack-lifetime erasure. `run()` `reset()`s it on
    /// reuse to bulk-free the previous iteration's parse/print allocations.
    static PARSE_ARENA: Cell<Option<NonNull<Arena>>> =
        const { Cell::new(None) };
    static AST_MEMORY_STORE: Cell<Option<NonNull<ASTMemoryAllocator>>> =
        const { Cell::new(None) };
    static SOURCE_CODE_PRINTER: Cell<Option<NonNull<BufferPrinter>>> =
        const { Cell::new(None) };
}

impl TranspilerJob {
    /// Zig `deinit` — kept as a private inherent fn (not `impl Drop`) because the slot
    /// is recycled into the HiveArray via `store.put(this)` rather than dropped, and
    /// several fields are reset to sentinel values for reuse. Only caller is
    /// `run_from_js_thread`.
    fn reset_for_pool(&mut self) {
        // bun.default_allocator.free(this.path.text) — `path.text` was Box-duplicated in
        // `transpile()`; reconstruct the Box and drop it.
        let old_path = core::mem::take(&mut self.path);
        if !old_path.text.is_empty() {
            // SAFETY: `text` is exactly the slice returned by `heap::alloc` in
            // `transpile()`; len matches, and this is the unique owner.
            drop(unsafe {
                Box::<[u8]>::from_raw(ptr::slice_from_raw_parts_mut(
                    old_path.text.as_ptr().cast_mut(),
                    old_path.text.len(),
                ))
            });
        }

        self.poll_ref.disable();
        self.fetcher.deinit();
        self.fetcher = Fetcher::File;
        self.loader = Loader::File;
        // bun_string::String is Copy with manual refcount; decrement and clear.
        core::mem::replace(&mut self.non_threadsafe_input_specifier, String::empty()).deref();
        core::mem::replace(&mut self.non_threadsafe_referrer, String::empty()).deref();
        // self.log.deinit() → Drop via take
        drop(core::mem::take(&mut self.log));
        // self.promise.deinit() → Drop via replace
        drop(core::mem::replace(&mut self.promise, StrongOptional::empty()));
        // self.globalThis = undefined; — no-op in Rust
    }

    pub fn dispatch_to_main_thread(&mut self) {
        let vm = self.vm;
        // SAFETY: vm outlives the job (BACKREF — VM owns the store).
        let transpiler_store: *mut RuntimeTranspilerStore =
            unsafe { ptr::addr_of_mut!((*vm).transpiler_store) };
        // SAFETY: queue is concurrent-safe (UnboundedQueue uses atomics).
        unsafe { (*transpiler_store).queue.push(std::ptr::from_mut::<TranspilerJob>(self)) };
        // Another thread may free `self` at any time after .push, so we cannot use it any more.
        // SAFETY: vm outlives the job; event_loop() returns the live self-pointer.
        unsafe {
            (*(*vm).event_loop()).enqueue_task_concurrent(ConcurrentTask::create_from(transpiler_store));
        }
    }

    pub fn run_from_js_thread(&mut self) -> JsResult<()> {
        let vm = self.vm;
        let promise = self.promise.swap();
        // SAFETY: vm/global_this outlive the job (BACKREF).
        let global_this = unsafe { &*self.global_this };
        // PORT NOTE: Zig `poll_ref.unref(vm)` — the Rust KeepAlive takes an `EventLoopCtx`
        // vtable; resolve it via the `get_vm_ctx` hook (registered by `bun_runtime::init`).
        self.poll_ref.unref(get_vm_ctx(AllocatorType::Js));

        let referrer = core::mem::replace(&mut self.non_threadsafe_referrer, String::empty());
        let mut log = core::mem::replace(&mut self.log, logger::Log::init());
        let mut resolved_source = self.resolved_source;
        let specifier = 'brk: {
            if self.parse_error.is_some() {
                break 'brk String::clone_utf8(self.path.text);
            }

            let out =
                core::mem::replace(&mut self.non_threadsafe_input_specifier, String::empty());

            debug_assert!(resolved_source.source_url.is_empty());
            debug_assert!(resolved_source.specifier.is_empty());
            resolved_source.source_url = create_if_different(&out, self.path.text);
            resolved_source.specifier = out.dupe_ref();
            break 'brk out;
        };

        let parse_error = self.parse_error;

        self.promise.deinit();
        self.reset_for_pool();

        // SAFETY: vm outlives the job; transpiler_store.store.put recycles the slot.
        unsafe { (*vm).transpiler_store.store.put(std::ptr::from_mut::<TranspilerJob>(self)) };

        AsyncModule::fulfill(
            global_this,
            promise,
            &mut resolved_source,
            parse_error,
            specifier,
            referrer,
            &mut log,
        )
    }

    pub fn schedule(&mut self) {
        // PORT NOTE: Zig `poll_ref.ref(this.vm)` — the Rust KeepAlive takes an
        // `EventLoopCtx` vtable; resolve it via the `get_vm_ctx` hook (registered by
        // `bun_runtime::init`).
        self.poll_ref.ref_(get_vm_ctx(AllocatorType::Js));
        WorkPool::schedule(&raw mut self.work_task);
    }

    pub unsafe fn run_from_worker_thread(work_task: *mut WorkPoolTask) {
        // SAFETY: work_task points to TranspilerJob.work_task; recover parent via offset_of!
        let this = unsafe {
            &mut *bun_core::from_field_ptr!(TranspilerJob, work_task, work_task)
        };
        this.run();
    }

    pub fn run(&mut self) {
        // PERF(port): Zig used `bun.ArenaAllocator` (= `std.heap.ArenaAllocator`,
        // a cheap page-list bump allocator with no `mi_heap`) per call. The
        // Rust `Arena = MimallocArena`, so this is one `mi_heap_new()` +
        // `mi_heap_destroy()` per dynamic `import()`; both are paired (verified
        // via `bun_alloc::live_arena_heaps()` — stable at +0 across iterations).
        // Hoisted to the `PARSE_ARENA` thread-local so the `&'static Arena`
        // handed to `Transpiler::set_arena` below is genuinely `'static` (the
        // `Box<Arena>` is leaked for the worker thread's lifetime), matching
        // the `AST_MEMORY_STORE`/`SOURCE_CODE_PRINTER` pattern. Note:
        // `MimallocArena::reset()` is `mi_heap_destroy` + `mi_heap_new`, so the
        // per-iteration `mi_heap_new` count is unchanged vs. a stack-local
        // `Arena::new()`+`Drop` — the hoist is for lifetime soundness, not to
        // reduce heap churn (only a non-mimalloc arena type could do that).
        let arena_ptr: NonNull<Arena> = PARSE_ARENA.with(|cell| match cell.get() {
            Some(p) => {
                // SAFETY: thread-local owns the leaked Box; only this thread
                // touches it, and no `&Arena` from a prior `run()` survives
                // (every borrow taken below is scoped to that call's stack
                // frame). `reset()` re-stamps the debug owning-thread id, so a
                // pool worker that picked this up after a different worker
                // first populated the slot would still pass the thread-lock
                // assert — though `thread_local!` already guarantees same-
                // thread here.
                unsafe { (*p.as_ptr()).reset() };
                p
            }
            None => {
                // SAFETY: heap::alloc never null.
                let p = unsafe {
                    NonNull::new_unchecked(bun_core::heap::into_raw(Box::new(Arena::new())))
                };
                cell.set(Some(p));
                p
            }
        });
        // SAFETY: `Transpiler<'static>` (the `vm.transpiler` value-copy below)
        // requires `&'static Arena` for `set_arena`. The leaked `Box<Arena>`
        // backing `PARSE_ARENA` lives for the worker thread's lifetime, so this
        // reference is genuinely `'static`. Stacked-Borrows: Shared tag from a
        // raw pointer; no `&mut Arena` is formed for the rest of this call.
        let arena_ref: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(arena_ptr.as_ref()) };

        // `defer this.dispatchToMainThread()` — fires on every return path.
        let this_ptr: *mut TranspilerJob = self;
        scopeguard::defer! {
            // SAFETY: `self` outlives this guard (guard drops before fn return);
            // no other &mut alias is live at drop time.
            unsafe { (*this_ptr).dispatch_to_main_thread() };
        }

        // SAFETY contract: `vm` outlives the job (BACKREF — VM owns the store).
        // PORT NOTE: kept as a raw pointer — never form `&mut VirtualMachine`
        // here. (a) the JS thread is concurrently live on the same VM, so a
        // `&mut` would be a data race; (b) `self` is stored *inside*
        // `(*vm).transpiler_store.store` (HiveArray inline slot), so a
        // `&mut VirtualMachine` would retag `self`'s memory and every
        // subsequent `self.* = …` write would be Stacked-Borrows UB. All
        // accesses below dereference per-field via `(*vm).field` (place
        // expressions / leaf-field borrows) only.
        let vm: *mut VirtualMachine = self.vm;

        if self.generation_number
            != unsafe { (*vm).transpiler_store.generation_number.load(Ordering::Relaxed) }
        {
            self.parse_error = Some(bun_core::err!("TranspilerJobGenerationMismatch"));
            return;
        }

        let mut ast_store_ptr = AST_MEMORY_STORE.with(|cell| {
            if cell.get().is_none() {
                let boxed = Box::new(ASTMemoryAllocator::new(arena_ref));
                // SAFETY: heap::alloc never null
                cell.set(Some(unsafe { NonNull::new_unchecked(bun_core::heap::into_raw(boxed)) }));
            }
            cell.get().unwrap()
        });
        // SAFETY: thread-local owns the leaked Box; only this thread touches it.
        let ast_memory_store = unsafe { ast_store_ptr.as_mut() };
        // Zig: `var ast_scope = ast_memory_store.?.enter(allocator); defer ast_scope.exit();`
        // PORT NOTE: Zig passed `allocator` to `enter()`; Rust signature folds the arena
        // into `ASTMemoryAllocator::new`. `Scope` restores the previous
        // `Expr/Stmt.Data.Store.memory_allocator` on Drop (see ASTMemoryAllocator.rs
        // `impl Drop for Scope`).
        let _ast_scope = ast_memory_store.enter();

        let path = self.path.clone();
        let specifier = self.path.text;
        let loader = self.loader;
        let this_tag = self.resolved_source.tag;

        // PORT NOTE: Zig threaded the arena into `output_code_allocator`; the Rust port of
        // RuntimeTranspilerCache dropped the per-allocator fields (Box<[u8]> + global mimalloc).
        // LAYERING: this is the canonical `bun_js_parser::RuntimeTranspilerCache`
        // wired with the JSC vtable so the parser's `cache.get()` reaches the
        // disk-backed `Entry` loader; on a hit `cache.entry` holds a type-erased
        // `*mut CacheEntry` which is unboxed below.
        let mut cache = RuntimeTranspilerCache {
            r#impl: Some(bun_js_parser::TranspilerCacheImplKind::Jsc),
            ..Default::default()
        };

        let mut log = logger::Log::init();
        // `defer { this.log = ...; log.cloneToWithRecycled(&this.log, true) }`
        let _log_clone_guard = scopeguard::guard(
            (
                ptr::addr_of_mut!(self.log),
                ptr::addr_of_mut!(log),
            ),
            |(dst, src)| {
                // SAFETY: dst/src point at locals that outlive this guard; no aliases at drop.
                unsafe {
                    *dst = logger::Log::init();
                    bun_core::handle_oom((*src).clone_to_with_recycled(&mut *dst, true));
                }
            },
        );

        // PORT NOTE: Zig copies the whole Transpiler by value (`transpiler = vm.transpiler`).
        // `Transpiler<'static>` is not `Clone` (it holds raw self-referential pointers); we do
        // a bytewise copy mirroring the Zig value-copy. SAFETY: `vm.transpiler` is read via
        // `addr_of!` (no `&VirtualMachine` formed); every internal raw pointer in the copy
        // still targets memory owned by `vm.transpiler` (resolver caches, define, env) which
        // outlives this stack frame; `vm.transpiler` is not concurrently mutated.
        // Zig did not `deinit` the by-value copy; `ManuallyDrop` suppresses Drop so owned
        // fields aren't double-freed against `vm.transpiler`.
        let mut transpiler_storage = core::mem::ManuallyDrop::new(unsafe {
            ptr::read(ptr::addr_of!((*vm).transpiler))
        });
        // SAFETY (lifetime erasure): `Transpiler<'a>`'s `'a` only constrains the
        // `allocator` field (and resolver opts that share it), which we
        // immediately overwrite below via `set_arena(arena_ref)` to the
        // thread-local `PARSE_ARENA` (`'static`). The bytewise copy is never
        // dropped (ManuallyDrop), so no borrow tied to the shortened `'a`
        // outlives the arena.
        let transpiler: &mut Transpiler<'_> = unsafe {
            &mut *(&raw mut *transpiler_storage).cast::<Transpiler<'_>>()
        };
        transpiler.set_arena(arena_ref);
        transpiler.set_log(&raw mut log);
        // PORT NOTE: reshaped for borrowck — Zig: transpiler.resolver.opts = transpiler.options
        // (BundleOptions value copy). The Rust resolver already shares opts with the parent
        // Transpiler via raw pointer; set_arena/set_log keep them in sync.
        transpiler.macro_context = None;
        // PORT NOTE: Zig's `MacroContext.init` is a value-type with no heap
        // allocation, so re-creating it per-iteration (as `parse_maybe` does
        // when `macro_context.is_none()`) is free. The Rust port boxes a
        // higher-tier `MacroContext` via `__bun_macro_context_init`; that Box
        // is intentionally leaked for the long-lived `vm.transpiler`, but here
        // we operate on a per-iteration `ManuallyDrop` bytewise copy, so we
        // MUST free what `parse_maybe` allocates or every dynamic `import()`
        // leaks one `Box<MacroContext>` (require-cache.test.ts "files
        // transpiled and loaded don't leak file paths > via import()" OOMs at
        // ~0.5 GB after 100k iterations). The owned `MimallocArena` inside is
        // now lazy (`bump: Option<Arena>`, init on first `.call()`), so the
        // per-iteration `mi_heap_new()` is gone; this guard just reclaims the
        // small `Box`.
        let _macro_ctx_guard = scopeguard::guard(
            ptr::addr_of_mut!(transpiler.macro_context),
            |slot| {
                // SAFETY: `slot` points into `transpiler_storage`, which is
                // declared before this guard and so outlives it; no other
                // borrow of `macro_context` is live at drop time (the parser's
                // `&mut MacroContext` is scoped to the `parse` call).
                if let Some(ctx) = unsafe { (*slot).take() } {
                    ctx.deinit();
                }
            },
        );
        // Zig: `transpiler.linker.resolver = &transpiler.resolver` — the bytewise copy left
        // `linker.resolver` pointing at `vm.transpiler.resolver` (wrong allocator/log); rewire
        // it at the local copy so `print_with_source_map` resolves through the arena-backed
        // resolver.
        transpiler.linker.resolver = ptr::addr_of_mut!(transpiler.resolver);

        let mut fd: Option<Fd> = None;
        let mut package_json: Option<&'static bun_watcher::PackageJSON> = None;
        let hash = Watcher::get_hash(path.text);

        // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set during VM init (BACKREF).
        let import_watcher: *mut ImportWatcher = unsafe { (*vm).bun_watcher }.cast();
        if !import_watcher.is_null() {
            // SAFETY: import_watcher is live; only the JS thread mutates the watchlist
            // shape — the worker thread reads SoA columns by index.
            let iw = unsafe { &*import_watcher };
            if matches!(iw, ImportWatcher::Hot(_) | ImportWatcher::Watch(_)) {
                if let Some(index) = iw.index_of(hash) {
                    if let Some(watchlist) = iw.watchlist() {
                        let watcher_fd = watchlist.items_fd()[index as usize];
                        // On Linux, `addFileByPathSlow` inserts watchlist
                        // entries with `fd = invalid_fd` (only kqueue needs
                        // the descriptor). Treat invalid as "no cached fd"
                        // so `readFileWithAllocator` opens the file instead
                        // of calling `seekTo` on a bogus handle.
                        fd = if watcher_fd.is_valid() && watcher_fd.stdio_tag().is_none() {
                            Some(watcher_fd)
                        } else {
                            None
                        };
                        // column `PackageJson` is `Option<&'static PackageJSON>` per WatchItem layout.
                        package_json =
                            watchlist.items::<"package_json", Option<&'static bun_watcher::PackageJSON>>()[index as usize];
                    }
                }
            }
        }

        // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
        let is_node_override = strings::has_prefix_comptime(specifier, node_fallbacks::IMPORT_PATH);

        // SAFETY: leaf scalar field reads on `*vm`; see `vm` PORT NOTE above.
        let macro_remappings = if unsafe { (*vm).macro_mode }
            || !unsafe { (*vm).has_any_macro_remappings }
            || is_node_override
        {
            MacroRemap::default()
        } else {
            // PORT NOTE: `MacroRemap` (StringArrayHashMap of StringArrayHashMap)
            // has no nested `Clone` impl (the inherent `clone()` requires
            // `V: Clone`); the Zig copied it by value. Re-key shallowly here
            // matching the build-command conversion (transpiler.rs:2616).
            // Spec (Zig l.363) is an infallible value-copy, so OOM during the
            // inner `clone()` must abort — never silently drop a remapping.
            let mut m = MacroRemap::default();
            for (k, v) in transpiler.options.macro_remap.iter() {
                m.insert(k, bun_core::handle_oom(v.clone()));
            }
            m
        };

        // Zig: `var fallback_source: logger.Source = undefined;` — only
        // initialised on the `is_node_override` branch and only read through
        // `parse_options.virtual_source` (raw-ptr borrow). `MaybeUninit` mirrors
        // the `= undefined` exactly; the write is `Cow::Borrowed`/borrowed-path
        // only, so skipping `Drop` is sound.
        let mut fallback_source = core::mem::MaybeUninit::<logger::Source>::uninit();

        // Usually, we want to close the input file automatically.
        //
        // If we're re-using the file descriptor from the fs watcher
        // Do not close it because that will break the kqueue-based watcher
        //
        // PORT NOTE: stored in a `Cell` so the scopeguard closure can capture
        // `&Cell<bool>` and the post-parse writes are visible to it without
        // raw-pointer laundering (which the unused-assignment lint can't see).
        let should_close_input_file_fd = Cell::new(fd.is_none());

        let mut input_file_fd: Fd = Fd::INVALID;

        // SAFETY: leaf scalar field reads on `*vm`; see `vm` PORT NOTE above.
        let (vm_main, vm_main_hash) = unsafe { ((*vm).main(), (*vm).main_hash) };
        let is_main = vm_main.len() == path.text.len()
            && vm_main_hash == hash
            && strings::eql_long(vm_main, path.text, false);

        let module_type: ModuleType = match this_tag {
            ResolvedSourceTag::PackageJsonTypeCommonjs => ModuleType::Cjs,
            ResolvedSourceTag::PackageJsonTypeModule => ModuleType::Esm,
            _ => ModuleType::Unknown,
        };

        let mut parse_options = ParseOptions {
            arena: arena_ref,
            path: path.clone(),
            loader,
            dirname_fd: Fd::INVALID,
            file_descriptor: fd,
            file_fd_ptr: Some(unsafe { &mut *ptr::addr_of_mut!(input_file_fd) }),
            file_hash: Some(hash),
            macro_remappings,
            macro_js_ctx: transpiler::default_macro_js_value(),
            jsx: transpiler.options.jsx.clone(),
            emit_decorator_metadata: transpiler.options.emit_decorator_metadata,
            experimental_decorators: transpiler.options.experimental_decorators,
            virtual_source: None,
            replace_exports: Default::default(),
            dont_bundle_twice: true,
            allow_commonjs: true,
            inject_jest_globals: transpiler.options.rewrite_jest_for_tests,
            // SAFETY: leaf-field `&` borrow on `*vm.debugger`; see `vm` PORT NOTE above.
            set_breakpoint_on_first_line: unsafe { &(*vm).debugger }
                .as_ref()
                .map(|d| d.set_breakpoint_on_first_line)
                .unwrap_or(false)
                && is_main
                && set_break_point_on_first_line(),
            runtime_transpiler_cache: if !JscRuntimeTranspilerCache::is_disabled() {
                Some(unsafe { &mut *ptr::addr_of_mut!(cache) })
            } else {
                None
            },
            // SAFETY: leaf-field read on `*vm.module_loader`; see `vm` PORT NOTE above.
            remove_cjs_module_wrapper: is_main
                && unsafe { (*vm).module_loader.eval_source.is_some() },
            module_type,
            keep_json_and_toml_as_one_statement: false,
            allow_bytecode_cache: true,
        };

        // `defer { if should_close && input_file_fd.isValid() { close } }`
        let _close_fd_guard = scopeguard::guard(
            (&should_close_input_file_fd, ptr::addr_of_mut!(input_file_fd)),
            |(should, fd_ptr)| {
                // SAFETY: `input_file_fd` outlives this guard (declared earlier
                // in fn scope); no `&mut` alias is live at drop time.
                unsafe {
                    if should.get() && (*fd_ptr).is_valid() {
                        (*fd_ptr).close();
                        *fd_ptr = Fd::INVALID;
                    }
                }
            },
        );

        if is_node_override {
            if let Some(code) = node_fallbacks::contents_from_path(specifier) {
                let fallback_path = logger::fs::Path::init_with_namespace(specifier, b"node");
                let src = fallback_source.write(logger::Source {
                    path: fallback_path,
                    contents: std::borrow::Cow::Borrowed(code),
                    ..Default::default()
                });
                // SAFETY: `fallback_source` outlives `parse_options` (declared
                // earlier in fn scope); raw-ptr borrow avoids tying
                // `parse_options`'s `'static` source lifetime to this stack slot.
                parse_options.virtual_source = Some(unsafe { &*std::ptr::from_ref::<logger::Source>(src) });
            }
        }

        // Zig spec: `vm.isWatcherEnabled()` ⇔ `vm.bun_watcher != .none`. The
        // Rust field is a type-erased `*mut ImportWatcher`, so a non-null
        // pointer may still hold `ImportWatcher::None`; both must be ruled out
        // or we'd skip closing `input_file_fd` without a watcher to adopt it.
        // SAFETY: discriminant read on the BACKREF pointer captured above; only
        // the JS thread mutates the variant.
        let is_watcher_enabled = !import_watcher.is_null()
            && !matches!(unsafe { &*import_watcher }, ImportWatcher::None);

        let Some(mut parse_result) = transpiler
            .parse_maybe_return_file_only_allow_shared_buffer::<false, false>(parse_options, None)
        else {
            if is_watcher_enabled && input_file_fd.is_valid() {
                if !is_node_override
                    && bun_paths::is_absolute(path.text)
                    && !strings::contains(path.text, b"node_modules")
                {
                    should_close_input_file_fd.set(false);
                    if !import_watcher.is_null() {
                        // SAFETY: import_watcher is live; add_file is thread-safe via watcher mutex.
                        let _ = unsafe { &mut *import_watcher }.add_file::<true>(
                            input_file_fd,
                            path.text,
                            hash,
                            loader,
                            Fd::INVALID,
                            package_json,
                        );
                    }
                }
            }

            self.parse_error = Some(bun_core::err!("ParseError"));
            return;
        };

        if is_watcher_enabled && input_file_fd.is_valid() {
            if !is_node_override
                && bun_paths::is_absolute(path.text)
                && !strings::contains(path.text, b"node_modules")
            {
                should_close_input_file_fd.set(false);
                if !import_watcher.is_null() {
                    // SAFETY: import_watcher is live; add_file is thread-safe via watcher mutex.
                    let _ = unsafe { &mut *import_watcher }.add_file::<true>(
                        input_file_fd,
                        path.text,
                        hash,
                        loader,
                        Fd::INVALID,
                        package_json,
                    );
                }
            }
        }

        // SAFETY: leaf scalar field read; see `vm` PORT NOTE above. Inlined
        // `VirtualMachine::use_isolation_source_provider_cache` to avoid forming
        // `&VirtualMachine`.
        let use_isolation_source_provider_cache = unsafe { (*vm).test_isolation_enabled }
            && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE::get()
                .unwrap_or(false);

        if let Some(entry_ptr) = cache.entry.take() {
            // SAFETY: `entry` was boxed by `JSC_PARSER_CACHE_VTABLE.get` from a
            // concrete `crate::runtime_transpiler_cache::Entry`; sole owner.
            let mut entry: Box<CacheEntry> =
                unsafe { bun_core::heap::take(entry_ptr.cast::<CacheEntry>()) };

            // SAFETY: leaf-field `&mut` borrow on `*vm.source_mappings`;
            // `SavedSourceMap` takes its own internal mutex.
            let _ = unsafe { &mut (*vm).source_mappings }.put_mappings(
                &parse_result.source,
                MutableString { list: core::mem::take(&mut entry.sourcemap).into_vec() },
            );

            if bun_core::env::DUMP_SOURCE {
                dump_source_string(vm, specifier, entry.output_code.byte_slice());
            }

            let module_info: *mut c_void = if use_isolation_source_provider_cache
                && entry.metadata.module_type != CacheModuleType::Cjs
                && !entry.esm_record.is_empty()
            {
                analyze_transpiled_module::ModuleInfoDeserialized::create_from_cached_record(
                    &entry.esm_record,
                )
                .map(|b| bun_core::heap::into_raw(b).cast())
                .unwrap_or(ptr::null_mut())
            } else {
                ptr::null_mut()
            };

            self.resolved_source = ResolvedSource {
                source_code: match &mut entry.output_code {
                    OutputCode::String(s) => *s,
                    OutputCode::Utf8(utf8) => {
                        let result = String::clone_utf8(utf8);
                        *utf8 = Box::default();
                        result
                    }
                },
                is_commonjs_module: entry.metadata.module_type == CacheModuleType::Cjs,
                module_info,
                tag: this_tag,
                ..Default::default()
            };

            return;
        }

        if !matches!(parse_result.already_bundled, AlreadyBundled::None) {
            let bytecode_slice = parse_result.already_bundled.bytecode_slice();
            self.resolved_source = ResolvedSource {
                source_code: String::clone_latin1(&parse_result.source.contents),
                already_bundled: true,
                bytecode_cache: if !bytecode_slice.is_empty() {
                    bytecode_slice.as_ptr().cast_mut()
                } else {
                    ptr::null_mut()
                },
                bytecode_cache_size: bytecode_slice.len(),
                is_commonjs_module: parse_result.already_bundled.is_common_js(),
                tag: this_tag,
                ..Default::default()
            };
            self.resolved_source.source_code.ensure_hash();
            return;
        }

        for import_record in parse_result.ast.import_records.slice_mut() {
            let import_record: &mut ImportRecord = import_record;

            if let Some(replacement) = HardcodedAlias::get(
                import_record.path.text,
                transpiler.options.target,
                HardcodedAliasCfg {
                    rewrite_jest_for_tests: transpiler.options.rewrite_jest_for_tests,
                },
            ) {
                import_record.path.text = replacement.path.as_bytes();
                import_record.tag = replacement.tag;
                import_record
                    .flags
                    .insert(ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
                continue;
            }

            if strings::has_prefix_comptime(import_record.path.text, b"bun:") {
                import_record.path =
                    bun_paths::fs::Path::init(&import_record.path.text[b"bun:".len()..]);
                import_record.path.namespace = b"bun";
                import_record
                    .flags
                    .insert(ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
            }
        }

        let mut printer_ptr = SOURCE_CODE_PRINTER.with(|cell| {
            if cell.get().is_none() {
                let writer = BufferWriter::init();
                let mut bp = Box::new(BufferPrinter::init(writer));
                bp.ctx.append_null_byte = false;
                // SAFETY: heap::alloc never null
                cell.set(Some(unsafe { NonNull::new_unchecked(bun_core::heap::into_raw(bp)) }));
            }
            cell.get().unwrap()
        });
        // SAFETY: thread-local owns the leaked Box; only this thread touches it.
        let source_code_printer = unsafe { printer_ptr.as_mut() };

        // PORT NOTE: Zig copies BufferPrinter by value here (`var printer = source_code_printer.?.*`)
        // and writes it back later. We swap the buffer out instead and write it back via the
        // _writeback guard — same observable effect (the thread-local's buffer is reused).
        let mut printer = core::mem::replace(
            source_code_printer,
            BufferPrinter::init(BufferWriter::init()),
        );
        printer.ctx.reset();

        // Cap buffer size to prevent unbounded growth
        const MAX_BUFFER_CAP: usize = 512 * 1024;
        if printer.ctx.buffer.list.capacity() > MAX_BUFFER_CAP {
            // printer.ctx.buffer.deinit() → Drop
            let writer = BufferWriter::init();
            *source_code_printer = BufferPrinter::init(writer);
            source_code_printer.ctx.append_null_byte = false;
            printer = core::mem::replace(
                source_code_printer,
                BufferPrinter::init(BufferWriter::init()),
            );
        }

        let is_commonjs_module = parse_result.ast.has_commonjs_export_names
            || parse_result.ast.exports_kind == ExportsKind::Cjs;
        let mut module_info: Option<Box<analyze_transpiled_module::ModuleInfo>> =
            if use_isolation_source_provider_cache
                && !is_commonjs_module
                && loader.is_java_script_like()
            {
                Some(analyze_transpiled_module::ModuleInfo::create(
                    loader.is_type_script(),
                ))
            } else {
                None
            };
        // PORT NOTE: derive `*mut` from a `&mut` borrow (not `&x as *const _ as
        // *mut _`, which is Stacked-Borrows UB). The `&mut` borrow ends when the
        // closure returns; the raw pointer stays valid until `module_info` is
        // moved/touched again (after `print_with_source_map`).
        let module_info_ptr: Option<*mut analyze_transpiled_module::ModuleInfo> =
            module_info.as_deref_mut().map(|m| std::ptr::from_mut(m));

        let print_result = {
            // SAFETY: see `vm` PORT NOTE above — `from_raw` stores `vm` as a raw
            // pointer and only borrows leaf fields (`source_mappings`, `debugger`)
            // inside `get()`. No `&mut VirtualMachine` is ever formed.
            let mut mapper = unsafe {
                SourceMapHandlerGetter::from_raw(vm, &raw mut printer)
            };
            let _writeback = scopeguard::guard(
                (
                    std::ptr::from_mut::<BufferPrinter>(source_code_printer),
                    ptr::addr_of_mut!(printer),
                ),
                |(dst, src)| {
                    // SAFETY: both pointees outlive this scope; no aliases at drop.
                    unsafe {
                        *dst = core::mem::replace(&mut *src, BufferPrinter::init(BufferWriter::init()))
                    };
                },
            );
            transpiler.print_with_source_map(
                parse_result,
                &mut printer,
                js_printer::Format::EsmAscii,
                mapper.get(),
                module_info_ptr,
            )
        };
        if let Err(err) = print_result {
            if let Some(mi) = module_info {
                mi.destroy();
            }
            self.parse_error = Some(err);
            return;
        }

        if bun_core::env::DUMP_SOURCE {
            dump_source(vm, specifier, source_code_printer);
        }

        let source_code = 'brk: {
            let written = source_code_printer.ctx.get_written();

            // PORT NOTE: lower-tier `cache.output_code` is `Option<Box<[u8]>>`
            // (Zig `?bun.String`). `RuntimeTranspilerCacheExt::put()` stores
            // the printer bytes there; convert to a WTF `bun.String` for JSC.
            let result = cache
                .output_code
                .take()
                .map(|b| String::clone_latin1(&b))
                .unwrap_or_else(|| String::clone_latin1(written));

            // SAFETY: leaf scalar field read on `*vm`; see `vm` PORT NOTE above.
            if written.len() > 1024 * 1024 * 2 || unsafe { (*vm).smol } {
                // printer.ctx.buffer.deinit() → Drop
                let writer = BufferWriter::init();
                *source_code_printer = BufferPrinter::init(writer);
                source_code_printer.ctx.append_null_byte = false;
            }
            // else: writeback guard already restored `printer` into the thread-local.

            // In a benchmarking loading @babel/standalone 100 times:
            //
            // After ensureHash:
            // 354.00 ms    4.2%    354.00 ms           WTF::StringImpl::hashSlowCase() const
            //
            // Before ensureHash:
            // 506.00 ms    6.1%    506.00 ms           WTF::StringImpl::hashSlowCase() const
            //
            result.ensure_hash();

            break 'brk result;
        };
        self.resolved_source = ResolvedSource {
            source_code,
            is_commonjs_module,
            module_info: module_info
                .map(|mi| {
                    use analyze_transpiled_module::ModuleInfoExt;
                    bun_core::heap::into_raw(mi.into_deserialized()).cast()
                })
                .unwrap_or(ptr::null_mut()),
            tag: this_tag,
            ..Default::default()
        };

        // PARSE_ARENA allocations stay live until the next `run()`'s `reset()`
        // (worker-thread-local; nothing references them past this point).
    }
}

// ported from: src/jsc/RuntimeTranspilerStore.zig
