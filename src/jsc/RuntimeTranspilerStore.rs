#![allow(unused_imports, unused_variables, dead_code, unused_mut, clippy::needless_return)]

use core::cell::Cell;
use core::ffi::c_void;
use core::mem::offset_of;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};

use bun_aio::{AllocatorType, KeepAlive};
use bun_aio::posix_event_loop::get_vm_ctx;
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
use bun_sys::{self, Dir, Fd, File, OpenDirOptions};
use bun_threading::unbounded_queue::{self, UnboundedQueue};
use bun_threading::Mutex;
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};
use bun_watcher::{WatchItemColumns, WatchItemField, Watcher};

use crate::async_module::AsyncModule;
use crate::event_loop::{ConcurrentTask, EventLoop};
use crate::hot_reloader::ImportWatcher;
use crate::resolved_source_tag::ResolvedSourceTag;
use crate::strong::Optional as StrongOptional;
use crate::virtual_machine::{create_if_different, SourceMapHandlerGetter, VirtualMachine};
use crate::{JSGlobalObject, JSInternalPromise, JSValue, JsError, JsResult, ResolvedSource, RuntimeTranspilerCache};

#[allow(non_upper_case_globals)]
bun_core::declare_scope!(RuntimeTranspilerStore, hidden);

// ──────────────────────────────────────────────────────────────────────────
// Debug source dumping (debug-only helpers; no-ops in release)
// ──────────────────────────────────────────────────────────────────────────

pub fn dump_source(vm: &mut VirtualMachine, specifier: &[u8], printer: &BufferPrinter) {
    dump_source_string(vm, specifier, printer.ctx.get_written());
}

pub fn dump_source_string(vm: &mut VirtualMachine, specifier: &[u8], written: &[u8]) {
    if let Err(e) = dump_source_string_failiable(vm, specifier, written) {
        bun_core::output::debug_warn(&format_args!("Failed to dump source string: {}", e.name()));
    }
}

pub fn dump_source_string_failiable(
    vm: &mut VirtualMachine,
    specifier: &[u8],
    written: &[u8],
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        return Ok(());
    }
    if bun_core::env_var::feature_flag::BUN_DEBUG_NO_DUMP.get() {
        return Ok(());
    }

    // Zig: local `struct { pub var dir; pub var lock; }` — module statics in Rust.
    // TODO(port): bun_sys::Dir handle type — using bun_sys::File-backed dir once
    // bun_sys grows `make_open_path`/`write_file` directory wrappers; until then this
    // helper is gated to debug builds and best-effort.
    let _ = (vm, specifier, written);
    // PORT NOTE: full Zig body uses std.fs.{Dir, makeOpenPath, writeFile, createFile,
    // readFileAlloc} which are forbidden (`bun_sys` only). bun_sys does not yet expose
    // a directory handle abstraction with makeOpenPath, so this debug-only dump is a
    // no-op pending those wrappers. The body is intentionally NOT a panic stub — this
    // is unreachable in release and exists solely for ad-hoc debugging.
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
        RuntimeTranspilerStore::default()
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
        // Box::from_raw on `path.text`.
        let owned_text: *mut [u8] = Box::into_raw(Box::<[u8]>::from(path.text));
        // SAFETY: owned_text was just allocated via Box::into_raw and lives until
        // `reset_for_pool` reconstructs and drops the Box.
        let owned_path = Fs::Path::init(unsafe { &*owned_text });
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
                global_this: global_object as *const _ as *mut JSGlobalObject,
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
    pub path: Fs::Path<'static>,
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
        let old_path = core::mem::replace(&mut self.path, Fs::Path::EMPTY);
        if !old_path.text.is_empty() {
            // SAFETY: `text` is exactly the slice returned by `Box::into_raw` in
            // `transpile()`; len matches, and this is the unique owner.
            drop(unsafe {
                Box::<[u8]>::from_raw(ptr::slice_from_raw_parts_mut(
                    old_path.text.as_ptr() as *mut u8,
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
        unsafe { (*transpiler_store).queue.push(self as *mut TranspilerJob) };
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
        unsafe { (*vm).transpiler_store.store.put(self as *mut TranspilerJob) };

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
        WorkPool::schedule(&mut self.work_task);
    }

    pub unsafe fn run_from_worker_thread(work_task: *mut WorkPoolTask) {
        // SAFETY: work_task points to TranspilerJob.work_task; recover parent via offset_of!
        let this = unsafe {
            &mut *(work_task as *mut u8)
                .sub(offset_of!(TranspilerJob, work_task))
                .cast::<TranspilerJob>()
        };
        this.run();
    }

    pub fn run(&mut self) {
        // PERF(port): was ArenaAllocator bulk-free feeding transpiler/AST.
        let arena = Arena::new();
        let allocator = &arena;

        // `defer this.dispatchToMainThread()` — fires on every return path.
        let this_ptr: *mut TranspilerJob = self;
        let _dispatch_guard = scopeguard::guard((), move |_| {
            // SAFETY: `self` outlives this guard (guard drops before `arena` and before fn
            // return); no other &mut alias is live at drop time.
            unsafe { (*this_ptr).dispatch_to_main_thread() };
        });

        // SAFETY: vm outlives the job (BACKREF — VM owns the store).
        let vm = unsafe { &mut *self.vm };

        if self.generation_number
            != vm
                .transpiler_store
                .generation_number
                .load(Ordering::Relaxed)
        {
            self.parse_error = Some(bun_core::err!("TranspilerJobGenerationMismatch"));
            return;
        }

        let ast_store_ptr = AST_MEMORY_STORE.with(|cell| {
            if cell.get().is_none() {
                let boxed = Box::new(ASTMemoryAllocator::new(allocator));
                // SAFETY: Box::into_raw never null
                cell.set(Some(unsafe { NonNull::new_unchecked(Box::into_raw(boxed)) }));
            }
            cell.get().unwrap()
        });
        // SAFETY: thread-local owns the leaked Box; only this thread touches it.
        let ast_memory_store = unsafe { &mut *ast_store_ptr.as_ptr() };
        // PORT NOTE: Zig passed `allocator` to `enter()`; Rust signature folds the arena
        // into `ASTMemoryAllocator::new`. The `Scope` exits (restores previous) on Drop.
        let _ast_scope = ast_memory_store.enter();

        let path = self.path.clone();
        let specifier = self.path.text;
        let loader = self.loader;
        let this_tag = self.resolved_source.tag;

        // PORT NOTE: Zig threaded the arena into `output_code_allocator`; the Rust port of
        // RuntimeTranspilerCache dropped the per-allocator fields (Box<[u8]> + global mimalloc).
        let mut cache = RuntimeTranspilerCache::default();

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
                    let _ = (*src).clone_to_with_recycled(&mut *dst, true);
                }
            },
        );

        // PORT NOTE: Zig copies the whole Transpiler by value (`transpiler = vm.transpiler`).
        // `Transpiler<'static>` is not `Clone` (it holds raw self-referential pointers); we do
        // a bytewise copy mirroring the Zig value-copy. SAFETY: every internal raw pointer in
        // the copy still targets memory owned by `vm.transpiler` (resolver caches, define, env)
        // which outlives this stack frame; `vm.transpiler` is not concurrently mutated.
        let mut transpiler: Transpiler<'static> =
            unsafe { core::ptr::read(&vm.transpiler as *const Transpiler<'static>) };
        let _no_drop_transpiler = scopeguard::guard((), |_| {
            // PORT NOTE: Zig did not deinit the by-value copy; suppress Drop on ours so
            // owned fields aren't double-freed against `vm.transpiler`.
        });
        let transpiler = &mut *core::mem::ManuallyDrop::new(transpiler);
        transpiler.set_allocator(allocator);
        transpiler.set_log(&mut log);
        // PORT NOTE: reshaped for borrowck — Zig: transpiler.resolver.opts = transpiler.options
        // (BundleOptions value copy). The Rust resolver already shares opts with the parent
        // Transpiler via raw pointer; set_allocator/set_log keep them in sync.
        transpiler.macro_context = None;
        // TODO(port): transpiler.linker.resolver = &transpiler.resolver — Linker holds a raw
        // *mut Resolver; rewire it at the local copy. Left to Phase B once Linker is wired.

        let mut fd: Option<Fd> = None;
        let mut package_json: Option<&'static bun_watcher::PackageJSON> = None;
        let hash = Watcher::get_hash(path.text);

        // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set during VM init (BACKREF).
        let import_watcher: *mut ImportWatcher = vm.bun_watcher.cast();
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
                        // SAFETY: column `PackageJson` is `Option<&'static PackageJSON>` per WatchItem layout.
                        package_json = unsafe {
                            watchlist.items::<Option<&'static bun_watcher::PackageJSON>>(
                                WatchItemField::PackageJson,
                            )[index as usize]
                        };
                    }
                }
            }
        }

        // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
        let is_node_override = strings::has_prefix_comptime(specifier, node_fallbacks::IMPORT_PATH);

        let macro_remappings = if vm.macro_mode || !vm.has_any_macro_remappings || is_node_override
        {
            MacroRemap::default()
        } else {
            transpiler.options.macro_remap.clone()
        };

        let mut fallback_source: logger::Source = logger::Source::default();

        // Usually, we want to close the input file automatically.
        //
        // If we're re-using the file descriptor from the fs watcher
        // Do not close it because that will break the kqueue-based watcher
        //
        let mut should_close_input_file_fd = fd.is_none();

        let mut input_file_fd: Fd = Fd::INVALID;

        let is_main = vm.main.len() == path.text.len()
            && vm.main_hash == hash
            && strings::eql_long(vm.main, path.text, false);

        let module_type: ModuleType = match this_tag {
            ResolvedSourceTag::PackageJsonTypeCommonjs => ModuleType::Cjs,
            ResolvedSourceTag::PackageJsonTypeModule => ModuleType::Esm,
            _ => ModuleType::Unknown,
        };

        let mut parse_options = ParseOptions {
            allocator,
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
            set_breakpoint_on_first_line: vm
                .debugger
                .as_ref()
                .map(|d| d.set_breakpoint_on_first_line)
                .unwrap_or(false)
                && is_main
                && set_break_point_on_first_line(),
            runtime_transpiler_cache: if !RuntimeTranspilerCache::is_disabled() {
                Some(unsafe { &mut *ptr::addr_of_mut!(cache) })
            } else {
                None
            },
            remove_cjs_module_wrapper: is_main && vm.module_loader.eval_source.is_some(),
            module_type,
            keep_json_and_toml_as_one_statement: false,
            allow_bytecode_cache: true,
        };

        // `defer { if should_close && input_file_fd.isValid() { close } }`
        let _close_fd_guard = scopeguard::guard(
            (
                ptr::addr_of_mut!(should_close_input_file_fd),
                ptr::addr_of_mut!(input_file_fd),
            ),
            |(should, fd_ptr)| {
                // SAFETY: both locals outlive this guard (declared earlier in fn scope)
                unsafe {
                    if *should && (*fd_ptr).is_valid() {
                        (*fd_ptr).close();
                        *fd_ptr = Fd::INVALID;
                    }
                }
            },
        );

        if is_node_override {
            if let Some(code) = node_fallbacks::contents_from_path(specifier) {
                let fallback_path = Fs::Path::init_with_namespace(specifier, b"node");
                fallback_source = logger::Source {
                    path: fallback_path,
                    contents: std::borrow::Cow::Borrowed(code),
                    ..Default::default()
                };
                parse_options.virtual_source = Some(unsafe { &*ptr::addr_of!(fallback_source) });
            }
        }

        let Some(mut parse_result) = transpiler
            .parse_maybe_return_file_only_allow_shared_buffer::<false, false>(parse_options, None)
        else {
            if vm.is_watcher_enabled() && input_file_fd.is_valid() {
                if !is_node_override
                    && bun_paths::is_absolute(path.text)
                    && !strings::contains(path.text, b"node_modules")
                {
                    should_close_input_file_fd = false;
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

        if vm.is_watcher_enabled() && input_file_fd.is_valid() {
            if !is_node_override
                && bun_paths::is_absolute(path.text)
                && !strings::contains(path.text, b"node_modules")
            {
                should_close_input_file_fd = false;
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

        if let Some(entry) = cache.entry.as_mut() {
            let _ = vm.source_mappings.put_mappings(
                &parse_result.source,
                MutableString { list: core::mem::take(&mut entry.sourcemap).into_vec() },
            );

            if bun_core::env::DUMP_SOURCE {
                dump_source_string(vm, specifier, entry.output_code.byte_slice());
            }

            let module_info: *mut c_void = if vm.use_isolation_source_provider_cache()
                && entry.metadata.module_type != ModuleType::Cjs
                && !entry.esm_record.is_empty()
            {
                analyze_transpiled_module::ModuleInfoDeserialized::create_from_cached_record(
                    &entry.esm_record,
                )
                .map(|b| Box::into_raw(b).cast())
                .unwrap_or(ptr::null_mut())
            } else {
                ptr::null_mut()
            };

            self.resolved_source = ResolvedSource {
                allocator: ptr::null_mut(),
                source_code: match &mut entry.output_code {
                    crate::runtime_transpiler_cache::OutputCode::String(s) => *s,
                    crate::runtime_transpiler_cache::OutputCode::Utf8(utf8) => {
                        let result = String::clone_utf8(utf8);
                        *utf8 = Box::default();
                        result
                    }
                },
                is_commonjs_module: entry.metadata.module_type == ModuleType::Cjs,
                module_info,
                tag: this_tag,
                ..Default::default()
            };

            return;
        }

        if !matches!(parse_result.already_bundled, AlreadyBundled::None) {
            let bytecode_slice = parse_result.already_bundled.bytecode_slice();
            self.resolved_source = ResolvedSource {
                allocator: ptr::null_mut(),
                source_code: String::clone_latin1(&parse_result.source.contents),
                already_bundled: true,
                bytecode_cache: if !bytecode_slice.is_empty() {
                    bytecode_slice.as_ptr() as *mut u8
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
                import_record.path = Fs::Path::init(&import_record.path.text[b"bun:".len()..]);
                import_record.path.namespace = b"bun";
                import_record
                    .flags
                    .insert(ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
            }
        }

        let printer_ptr = SOURCE_CODE_PRINTER.with(|cell| {
            if cell.get().is_none() {
                let writer = BufferWriter::init();
                let mut bp = Box::new(BufferPrinter::init(writer));
                bp.ctx.append_null_byte = false;
                // SAFETY: Box::into_raw never null
                cell.set(Some(unsafe { NonNull::new_unchecked(Box::into_raw(bp)) }));
            }
            cell.get().unwrap()
        });
        // SAFETY: thread-local owns the leaked Box; only this thread touches it.
        let source_code_printer = unsafe { &mut *printer_ptr.as_ptr() };

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
        let module_info: Option<Box<analyze_transpiled_module::ModuleInfo>> =
            if vm.use_isolation_source_provider_cache()
                && !is_commonjs_module
                && loader.is_java_script_like()
            {
                Some(analyze_transpiled_module::ModuleInfo::create(
                    loader.is_type_script(),
                ))
            } else {
                None
            };
        let module_info_ptr: Option<*mut analyze_transpiled_module::ModuleInfo> =
            module_info.as_ref().map(|b| &**b as *const _ as *mut _);

        {
            let mut mapper = vm.source_map_handler(&mut printer as *mut BufferPrinter);
            let _writeback = scopeguard::guard(
                (
                    source_code_printer as *mut BufferPrinter,
                    ptr::addr_of_mut!(printer),
                ),
                |(dst, src)| {
                    // SAFETY: both pointees outlive this scope; no aliases at drop.
                    unsafe {
                        *dst = core::mem::replace(&mut *src, BufferPrinter::init(BufferWriter::init()))
                    };
                },
            );
            match transpiler.print_with_source_map(
                parse_result,
                &mut printer,
                js_printer::Format::EsmAscii,
                mapper.get(),
                module_info_ptr,
            ) {
                Ok(_) => {}
                Err(err) => {
                    if let Some(mi) = module_info {
                        mi.destroy();
                    }
                    self.parse_error = Some(err);
                    return;
                }
            }
        }

        if bun_core::env::DUMP_SOURCE {
            dump_source(vm, specifier, source_code_printer);
        }

        let source_code = 'brk: {
            let written = source_code_printer.ctx.get_written();

            let result = cache
                .output_code
                .take()
                .unwrap_or_else(|| String::clone_latin1(written));

            if written.len() > 1024 * 1024 * 2 || vm.smol {
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
            allocator: ptr::null_mut(),
            source_code,
            is_commonjs_module,
            module_info: module_info
                .map(|mi| {
                    use analyze_transpiled_module::ModuleInfoExt;
                    Box::into_raw(mi.into_deserialized()).cast()
                })
                .unwrap_or(ptr::null_mut()),
            tag: this_tag,
            ..Default::default()
        };

        // arena drops here (bulk-free) via Drop on `arena`
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/RuntimeTranspilerStore.zig (655 lines)
//   confidence: medium
//   notes:      run() does heavy defer→scopeguard + by-value Transpiler copy via
//               ptr::read+ManuallyDrop; vm/global_this are raw *mut (BACKREF —
//               struct crosses threads); KeepAlive ref/unref routed via the
//               `get_vm_ctx` hook (matches AsyncModule.rs).
// ──────────────────────────────────────────────────────────────────────────
