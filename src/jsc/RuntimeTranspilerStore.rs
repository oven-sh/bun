use core::cell::Cell;
use core::ffi::c_void;
use core::mem::offset_of;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_aio::KeepAlive;
use bun_alloc::Arena;
use bun_bundler::analyze_transpiled_module;
use bun_bundler::options::{self, Loader, ModuleType};
use bun_bundler::Transpiler;
use bun_collections::{HiveArray, UnboundedQueue};
use bun_core::{self as bun, feature_flag, Output};
use bun_js_parser::ast as js_ast;
use bun_js_printer as js_printer;
use bun_logger as logger;
use bun_paths::{self, PathBuffer};
use bun_resolve_builtins::HardcodedModule;
use bun_resolver::fs as Fs;
use bun_resolver::node_fallbacks;
use bun_resolver::package_json::{MacroMap as MacroRemap, PackageJSON};
use bun_str::{strings, String};
use bun_sys::Fd;
use bun_threading::{WorkPool, WorkPoolTask};

use crate::async_module::AsyncModule;
use crate::{
    ConcurrentTask, EventLoop, JSGlobalObject, JSInternalPromise, JSValue, JsResult,
    ResolvedSource, RuntimeTranspilerCache, Strong, VirtualMachine,
};

bun_output::declare_scope!(RuntimeTranspilerStore, hidden);

// ──────────────────────────────────────────────────────────────────────────
// Debug source dumping
// ──────────────────────────────────────────────────────────────────────────

pub fn dump_source<P>(vm: &VirtualMachine, specifier: &[u8], printer: &P)
where
    // TODO(port): `printer: anytype` — body only uses `printer.ctx.getWritten()`
    P: js_printer::HasBufferWriterCtx,
{
    dump_source_string(vm, specifier, printer.ctx().get_written());
}

pub fn dump_source_string(vm: &VirtualMachine, specifier: &[u8], written: &[u8]) {
    if let Err(e) = dump_source_string_failiable(vm, specifier, written) {
        Output::debug_warn(format_args!("Failed to dump source string: {}", e.name()));
    }
}

pub fn dump_source_string_failiable(
    vm: &VirtualMachine,
    specifier: &[u8],
    written: &[u8],
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        return Ok(());
    }
    if feature_flag::BUN_DEBUG_NO_DUMP.get() {
        return Ok(());
    }

    // Zig: local `struct { pub var dir; pub var lock; }` — module statics in Rust.
    // TODO(port): bun_sys::Dir handle type; using raw fd-backed dir placeholder.
    static BUN_DEBUG_DIR: bun_threading::Mutex<Option<bun_sys::Dir>> =
        bun_threading::Mutex::new(None);

    let mut guard = BUN_DEBUG_DIR.lock();

    let dir = match &*guard {
        Some(d) => d.clone(), // TODO(port): Dir clone/dup semantics
        None => 'dir: {
            #[cfg(not(windows))]
            let base_name: &[u8] = if cfg!(target_os = "android") {
                b"/data/local/tmp/bun-debug-src/"
            } else {
                b"/tmp/bun-debug-src/"
            };
            #[cfg(windows)]
            let base_name: &bun_str::ZStr = {
                let temp = bun_fs::FileSystem::RealFS::platform_temp_dir();
                // TODO(port): thread_local PathBuffer for win_temp_buffer; Zig used a stack buffer
                // and returned a ZStr view into it across the break — lifetime hazard in Rust.
                // Phase B: build into a static OnceLock<Box<[u8]>>.
                let mut win_temp_buffer = PathBuffer::uninit();
                win_temp_buffer[..temp.len()].copy_from_slice(temp);
                let suffix = b"\\bun-debug-src";
                win_temp_buffer[temp.len()..temp.len() + suffix.len()].copy_from_slice(suffix);
                win_temp_buffer[temp.len() + suffix.len()] = 0;
                // SAFETY: NUL written at temp.len() + suffix.len() above
                unsafe { bun_str::ZStr::from_raw(win_temp_buffer.as_ptr(), temp.len() + suffix.len()) }
                // TODO(port): win_temp_buffer drops here; base_name dangles. See note above.
            };

            // TODO(port): std.fs.cwd().makeOpenPath → bun_sys::Dir::make_open_path
            let dir = bun_sys::Dir::cwd().make_open_path(base_name)?;
            *guard = Some(dir.clone());
            break 'dir dir;
        }
    };

    if let Some(dir_path) = bun_paths::dirname(specifier) {
        #[cfg(not(windows))]
        let root_len = b"/".len();
        #[cfg(windows)]
        let root_len = bun_paths::windows_filesystem_root(dir_path).len();

        let mut parent = dir.make_open_path(&dir_path[root_len..])?;
        // `defer parent.close()` → Drop on bun_sys::Dir
        match parent.write_file(bun_paths::basename(specifier), written) {
            Ok(()) => {}
            Err(e) => {
                Output::debug_warn(format_args!(
                    "Failed to dump source string: writeFile {}",
                    e.name()
                ));
                return Ok(());
            }
        }
        if let Some(mappings) = vm.source_mappings.get(specifier) {
            // `defer mappings.deref()` → Drop on the returned guard/Rc
            let map_path: Vec<u8> = {
                let base = bun_paths::basename(specifier);
                let mut v = Vec::with_capacity(base.len() + 4);
                v.extend_from_slice(base);
                v.extend_from_slice(b".map");
                v
            };
            let file = parent.create_file(&map_path)?;
            // `defer file.close()` → Drop

            let source_file: Vec<u8> = parent
                .read_file_alloc(specifier, u64::MAX)
                .unwrap_or_else(|_| Vec::new());

            // TODO(port): std.Io.Writer streaming → bun_io::BufWriter over bun_sys::File
            let mut bufw = bun_io::BufWriter::with_capacity(4096, file);
            use core::fmt::Write as _;
            // TODO(port): bun.fmt.formatJSONStringUTF8 → bun_core::fmt::JsonStringUtf8 Display wrapper
            write!(
                bufw,
                "{{\n  \"version\": 3,\n  \"file\": {},\n  \"sourceRoot\": \"\",\n  \"sources\": [{}],\n  \"sourcesContent\": [{}],\n  \"names\": [],\n  \"mappings\": \"{}\"\n}}",
                bun_core::fmt::format_json_string_utf8(bun_paths::basename(specifier)),
                bun_core::fmt::format_json_string_utf8(specifier),
                bun_core::fmt::format_json_string_utf8(&source_file),
                mappings.format_vlqs(),
            )
            .map_err(|_| bun_core::err!("WriteFailed"))?;
            bufw.flush().map_err(|_| bun_core::err!("WriteFailed"))?;
        }
    } else {
        let _ = dir.write_file(bun_paths::basename(specifier), written);
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

pub type Queue = UnboundedQueue<TranspilerJob, { offset_of!(TranspilerJob, next) }>;
// TODO(port): UnboundedQueue API in Rust — Zig takes (T, .field_name); using offset_of! const.

impl Default for RuntimeTranspilerStore {
    fn default() -> Self {
        Self {
            generation_number: AtomicU32::new(0),
            store: TranspilerJobStore::default(),
            enabled: true,
            queue: Queue::default(),
        }
    }
}

impl RuntimeTranspilerStore {
    pub fn init() -> RuntimeTranspilerStore {
        RuntimeTranspilerStore {
            generation_number: AtomicU32::new(0),
            // Zig: TranspilerJob.Store.init(bun.typedAllocator(TranspilerJob))
            // typedAllocator → global mimalloc; drop allocator param.
            store: TranspilerJobStore::init(),
            enabled: true,
            queue: Queue::default(),
        }
    }

    pub fn run_from_js_thread(
        &mut self,
        event_loop: &mut EventLoop,
        global: &JSGlobalObject,
        vm: &mut VirtualMachine,
    ) {
        let mut batch = self.queue.pop_batch();
        let jsc_vm = vm.jsc_vm;
        let mut iter = batch.iterator();
        if let Some(job) = iter.next() {
            // we run just one job first to see if there are more
            if let Err(err) = job.run_from_js_thread() {
                global.report_uncaught_exception_from_error(err);
            }
        } else {
            return;
        }
        while let Some(job) = iter.next() {
            // if there are more, we need to drain the microtasks from the previous run
            if event_loop.drain_microtasks_with_global(global, jsc_vm).is_err() {
                return;
            }
            if let Err(err) = job.run_from_js_thread() {
                global.report_uncaught_exception_from_error(err);
            }
        }

        // immediately after this is called, the microtasks will be drained again.
    }

    pub fn transpile(
        &mut self,
        vm: &VirtualMachine,
        global_object: &JSGlobalObject,
        input_specifier: String,
        path: Fs::Path,
        referrer: String,
        loader: Loader,
        package_json: Option<&PackageJSON>,
    ) -> *mut c_void {
        let job: *mut TranspilerJob = self.store.get();
        let owned_path = Fs::Path::init(Box::<[u8]>::from(path.text));
        let promise = JSInternalPromise::create(global_object);

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

        // SAFETY: job points to a slot returned by HiveArray::Fallback::get(); we are the
        // sole writer until schedule() hands it to the work pool.
        unsafe {
            job.write(TranspilerJob {
                non_threadsafe_input_specifier: input_specifier,
                path: owned_path,
                global_this: global_object,
                non_threadsafe_referrer: referrer,
                vm,
                log: logger::Log::init(),
                loader,
                promise: Strong::create(JSValue::from_cell(promise), global_object),
                poll_ref: KeepAlive::default(),
                fetcher: Fetcher::File,
                resolved_source,
                generation_number: self.generation_number.load(Ordering::SeqCst),
                parse_error: None,
                work_task: WorkPoolTask {
                    callback: TranspilerJob::run_from_worker_thread,
                },
                next: core::ptr::null_mut(),
            });
        }
        #[cfg(debug_assertions)]
        bun_output::scoped_log!(
            RuntimeTranspilerStore,
            "transpile({}, {}, async)",
            bstr::BStr::new(path.text),
            // SAFETY: job fully initialized above
            <&'static str>::from(unsafe { (*job).loader })
        );
        // SAFETY: job fully initialized above
        unsafe { (*job).schedule() };
        promise as *mut c_void
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TranspilerJob
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): bun.heap_breakdown.enabled gate on the inline capacity
#[cfg(feature = "heap_breakdown")]
const TRANSPILER_JOB_HIVE_CAP: usize = 0;
#[cfg(not(feature = "heap_breakdown"))]
const TRANSPILER_JOB_HIVE_CAP: usize = 64;

pub type TranspilerJobStore =
    <HiveArray<TranspilerJob, TRANSPILER_JOB_HIVE_CAP> as bun_collections::HiveArrayExt>::Fallback;
// TODO(port): exact spelling of HiveArray<T, N>::Fallback in bun_collections

pub struct TranspilerJob {
    pub path: Fs::Path,
    pub non_threadsafe_input_specifier: String,
    pub non_threadsafe_referrer: String,
    pub loader: Loader,
    pub promise: Strong, // Strong.Optional → bun_jsc::Strong (default empty)
    // LIFETIMES.tsv: JSC_BORROW → `&VirtualMachine` / `&JSGlobalObject` verbatim.
    // TODO(port): lifetime — struct is stored in HiveArray and crosses to worker thread;
    // Phase B may need *const VirtualMachine / *const JSGlobalObject instead of borrows.
    pub vm: &VirtualMachine,
    pub global_this: &JSGlobalObject,
    pub fetcher: Fetcher,
    pub poll_ref: KeepAlive,
    pub generation_number: u32,
    pub log: logger::Log,
    pub parse_error: Option<bun_core::Error>,
    pub resolved_source: ResolvedSource,
    pub work_task: WorkPoolTask,
    // LIFETIMES.tsv: INTRUSIVE
    pub next: *mut TranspilerJob,
}

pub enum Fetcher {
    VirtualModule(String),
    File,
}

impl Drop for Fetcher {
    fn drop(&mut self) {
        if let Fetcher::VirtualModule(s) = self {
            s.deref_();
        }
    }
}

thread_local! {
    static AST_MEMORY_STORE: Cell<Option<NonNull<js_ast::ASTMemoryAllocator>>> =
        const { Cell::new(None) };
    static SOURCE_CODE_PRINTER: Cell<Option<NonNull<js_printer::BufferPrinter>>> =
        const { Cell::new(None) };
}

impl TranspilerJob {
    /// Zig `deinit` — kept as a private inherent fn (not `impl Drop`) because the slot is
    /// recycled into `HiveArray::Fallback` via `store.put(this)` rather than dropped, and
    /// several fields are reset to sentinel values for reuse. Not exposed as `pub fn deinit`
    /// per PORTING.md; only caller is `run_from_js_thread`.
    fn reset_for_pool(&mut self) {
        // bun.default_allocator.free(this.path.text) → path.text is Box<[u8]> in owned_path;
        // dropping the Fs::Path frees it.
        // TODO(port): Fs::Path ownership of .text — verify in bun_resolver::fs
        drop(core::mem::replace(&mut self.path, Fs::Path::empty()));

        self.poll_ref.disable();
        // self.fetcher.deinit() → Drop via replace
        self.fetcher = Fetcher::File;
        self.loader = Loader::File;
        self.non_threadsafe_input_specifier.deref_();
        self.non_threadsafe_referrer.deref_();
        // self.log.deinit() → Drop via replace
        drop(core::mem::take(&mut self.log));
        // self.promise.deinit() → Drop via replace
        drop(core::mem::replace(&mut self.promise, Strong::empty()));
        // self.globalThis = undefined; — no-op in Rust
    }

    pub fn dispatch_to_main_thread(&mut self) {
        let vm = self.vm;
        let transpiler_store = &vm.transpiler_store;
        transpiler_store.queue.push(self);
        // Another thread may free `self` at any time after .push, so we cannot use it any more.
        vm.event_loop()
            .enqueue_task_concurrent(ConcurrentTask::create_from(transpiler_store));
    }

    pub fn run_from_js_thread(&mut self) -> JsResult<()> {
        let vm = self.vm;
        let promise = self.promise.swap();
        let global_this = self.global_this;
        self.poll_ref.unref(vm);

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
            resolved_source.source_url = out.create_if_different(self.path.text);
            resolved_source.specifier = out.dupe_ref();
            break 'brk out;
        };

        let parse_error = self.parse_error;

        drop(core::mem::replace(&mut self.promise, Strong::empty()));
        self.reset_for_pool();

        let _ = vm.transpiler_store.store.put(self as *mut TranspilerJob);

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
        self.poll_ref.ref_(self.vm);
        WorkPool::schedule(&mut self.work_task);
    }

    pub extern "C" fn run_from_worker_thread(work_task: *mut WorkPoolTask) {
        // SAFETY: work_task points to TranspilerJob.work_task; recover parent via offset_of!
        let this = unsafe {
            &mut *(work_task as *mut u8)
                .sub(offset_of!(TranspilerJob, work_task))
                .cast::<TranspilerJob>()
        };
        this.run();
    }

    pub fn run(&mut self) {
        // PERF(port): was ArenaAllocator bulk-free feeding transpiler/AST — kept as Bump.
        let mut arena = Arena::new();
        let bump = &arena;

        // `defer this.dispatchToMainThread()` — use scopeguard so it fires on every return path.
        let this_ptr: *mut TranspilerJob = self;
        let _dispatch_guard = scopeguard::guard((), move |_| {
            // SAFETY: `self` outlives this guard (guard drops before `arena` and before fn return);
            // no other &mut alias is live at drop time.
            unsafe { (*this_ptr).dispatch_to_main_thread() };
        });

        if self.generation_number
            != self
                .vm
                .transpiler_store
                .generation_number
                .load(Ordering::Relaxed)
        {
            self.parse_error = Some(bun_core::err!("TranspilerJobGenerationMismatch"));
            return;
        }

        let ast_store_ptr = AST_MEMORY_STORE.with(|cell| {
            if cell.get().is_none() {
                let boxed = Box::new(js_ast::ASTMemoryAllocator {
                    allocator: bump, // TODO(port): ASTMemoryAllocator field type for arena
                    previous: None,
                });
                // SAFETY: Box::into_raw never null
                cell.set(Some(unsafe { NonNull::new_unchecked(Box::into_raw(boxed)) }));
            }
            cell.get().unwrap()
        });
        // SAFETY: thread-local owns the leaked Box; only this thread touches it.
        let ast_store = unsafe { ast_store_ptr.as_mut() };
        let ast_scope = ast_store.enter(bump);
        // `defer ast_scope.exit()` → Drop on the scope guard returned by enter()
        let _ast_scope = ast_scope;

        let path = self.path.clone(); // TODO(port): Fs::Path copy/clone semantics
        let specifier = self.path.text;
        let loader = self.loader;

        let mut cache = RuntimeTranspilerCache {
            output_code_allocator: bump,
            // sourcemap_allocator / esm_record_allocator: bun.default_allocator → drop param
            ..Default::default()
        };
        // TODO(port): RuntimeTranspilerCache allocator fields shape

        let mut log = logger::Log::init_in(bump);
        // TODO(port): logger::Log arena-backed init
        let _log_clone_guard = scopeguard::guard((&mut self.log) as *mut logger::Log, |dst| {
            // SAFETY: dst is &mut self.log; no alias live at drop
            unsafe {
                *dst = logger::Log::init();
                log.clone_to_with_recycled(&mut *dst, true);
            }
        });
        // TODO(port): errdefer — captures &mut self.log and &mut log; scopeguard borrow gymnastics

        let vm = self.vm;
        // PORT NOTE: Zig copies the whole Transpiler by value (`transpiler = vm.transpiler`).
        let mut transpiler: Transpiler = vm.transpiler.clone();
        transpiler.set_allocator(bump);
        transpiler.set_log(&mut log);
        // PORT NOTE: reshaped for borrowck — Zig: transpiler.resolver.opts = transpiler.options
        let opts = transpiler.options.clone();
        transpiler.resolver.opts = opts;
        transpiler.macro_context = None;
        // TODO(port): self-referential: transpiler.linker.resolver = &transpiler.resolver
        transpiler.linker.resolver = &mut transpiler.resolver as *mut _;

        let mut fd: Option<Fd> = None;
        let mut package_json: Option<*mut PackageJSON> = None;
        let hash = bun_watcher::Watcher::get_hash(path.text);

        match vm.bun_watcher {
            BunWatcher::Hot(_) | BunWatcher::Watch(_) => {
                if let Some(index) = vm.bun_watcher.index_of(hash) {
                    let watcher_fd = vm.bun_watcher.watchlist().items_fd()[index];
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
                    package_json = vm.bun_watcher.watchlist().items_package_json()[index];
                }
            }
            _ => {}
        }
        // TODO(port): vm.bun_watcher tagged-union shape (BunWatcher enum placeholder)

        // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
        let is_node_override = specifier.starts_with(node_fallbacks::IMPORT_PATH);

        let macro_remappings = if vm.macro_mode || !vm.has_any_macro_remappings || is_node_override
        {
            MacroRemap::default()
        } else {
            transpiler.options.macro_remap.clone()
        };

        let mut fallback_source: logger::Source = logger::Source::default();
        // TODO(port): Zig left this `undefined`; using Default

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

        let module_type: ModuleType = match self.resolved_source.tag {
            ResolvedSourceTag::PackageJsonTypeCommonjs => ModuleType::Cjs,
            ResolvedSourceTag::PackageJsonTypeModule => ModuleType::Esm,
            _ => ModuleType::Unknown,
        };

        let mut parse_options = Transpiler::ParseOptions {
            allocator: bump,
            path,
            loader,
            dirname_fd: Fd::INVALID,
            file_descriptor: fd,
            file_fd_ptr: &mut input_file_fd,
            file_hash: hash,
            macro_remappings,
            jsx: transpiler.options.jsx,
            emit_decorator_metadata: transpiler.options.emit_decorator_metadata,
            experimental_decorators: transpiler.options.experimental_decorators,
            virtual_source: None,
            dont_bundle_twice: true,
            allow_commonjs: true,
            inject_jest_globals: transpiler.options.rewrite_jest_for_tests,
            set_breakpoint_on_first_line: vm.debugger.is_some()
                && vm.debugger.as_ref().unwrap().set_breakpoint_on_first_line
                && is_main
                && set_break_point_on_first_line(),
            runtime_transpiler_cache: if !RuntimeTranspilerCache::is_disabled() {
                Some(&mut cache)
            } else {
                None
            },
            remove_cjs_module_wrapper: is_main && vm.module_loader.eval_source.is_some(),
            module_type,
            allow_bytecode_cache: true,
        };

        let _close_fd_guard = scopeguard::guard(
            (&mut should_close_input_file_fd as *mut bool, &mut input_file_fd as *mut Fd),
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
        // TODO(port): defer with two captured &mut locals — raw-ptr scopeguard

        if is_node_override {
            if let Some(code) = node_fallbacks::contents_from_path(specifier) {
                let fallback_path = Fs::Path::init_with_namespace(specifier, b"node");
                fallback_source = logger::Source {
                    path: fallback_path,
                    contents: code,
                    ..Default::default()
                };
                parse_options.virtual_source = Some(&fallback_source);
            }
        }

        let Some(mut parse_result) = transpiler.parse_maybe_return_file_only_allow_shared_buffer(
            parse_options,
            None,
            false,
            false,
        ) else {
            if vm.is_watcher_enabled() {
                if input_file_fd.is_valid() {
                    if !is_node_override
                        && bun_paths::is_absolute(path.text)
                        && !strings::contains(path.text, b"node_modules")
                    {
                        should_close_input_file_fd = false;
                        let _ = vm.bun_watcher.add_file(
                            input_file_fd,
                            path.text,
                            hash,
                            loader,
                            Fd::INVALID,
                            package_json,
                            true,
                        );
                    }
                }
            }

            self.parse_error = Some(bun_core::err!("ParseError"));
            return;
        };

        if vm.is_watcher_enabled() {
            if input_file_fd.is_valid() {
                if !is_node_override
                    && bun_paths::is_absolute(path.text)
                    && !strings::contains(path.text, b"node_modules")
                {
                    should_close_input_file_fd = false;
                    let _ = vm.bun_watcher.add_file(
                        input_file_fd,
                        path.text,
                        hash,
                        loader,
                        Fd::INVALID,
                        package_json,
                        true,
                    );
                }
            }
        }

        if let Some(entry) = cache.entry.as_mut() {
            let _ = vm.source_mappings.put_mappings(
                &parse_result.source,
                // TODO(port): Zig builds an ArrayList view over entry.sourcemap with cap=len.
                // Rust side should accept a Vec<u8> / Box<[u8]> directly.
                entry.sourcemap.clone(),
            );

            #[cfg(feature = "dump_source")]
            dump_source_string(vm, specifier, entry.output_code.byte_slice());
            // TODO(port): Environment.dump_source → cfg feature

            let module_info: Option<*mut analyze_transpiled_module::ModuleInfoDeserialized> =
                if vm.use_isolation_source_provider_cache()
                    && entry.metadata.module_type != ModuleType::Cjs
                    && !entry.esm_record.is_empty()
                {
                    analyze_transpiled_module::ModuleInfoDeserialized::create_from_cached_record(
                        &entry.esm_record,
                    )
                } else {
                    None
                };

            self.resolved_source = ResolvedSource {
                allocator: None,
                source_code: match &mut entry.output_code {
                    OutputCode::String(s) => *s,
                    OutputCode::Utf8(utf8) => 'brk: {
                        let result = String::clone_utf8(utf8);
                        // cache.output_code_allocator.free(...) — arena-owned; drop is no-op
                        *utf8 = &[];
                        break 'brk result;
                    }
                },
                is_commonjs_module: entry.metadata.module_type == ModuleType::Cjs,
                module_info,
                tag: self.resolved_source.tag,
                ..Default::default()
            };
            // TODO(port): OutputCode enum shape in RuntimeTranspilerCache

            return;
        }

        if parse_result.already_bundled != AlreadyBundled::None {
            let bytecode_slice = parse_result.already_bundled.bytecode_slice();
            self.resolved_source = ResolvedSource {
                allocator: None,
                source_code: String::clone_latin1(parse_result.source.contents),
                already_bundled: true,
                bytecode_cache: if !bytecode_slice.is_empty() {
                    Some(bytecode_slice.as_ptr())
                } else {
                    None
                },
                bytecode_cache_size: bytecode_slice.len(),
                is_commonjs_module: parse_result.already_bundled.is_common_js(),
                tag: self.resolved_source.tag,
                ..Default::default()
            };
            self.resolved_source.source_code.ensure_hash();
            return;
        }
        // TODO(port): AlreadyBundled enum shape in bun_bundler

        for import_record in parse_result.ast.import_records.slice_mut() {
            let import_record: &mut bun_options_types::ImportRecord = import_record;

            if let Some(replacement) = HardcodedModule::Alias::get(
                import_record.path.text,
                transpiler.options.target,
                HardcodedModule::AliasOptions {
                    rewrite_jest_for_tests: transpiler.options.rewrite_jest_for_tests,
                },
            ) {
                import_record.path.text = replacement.path;
                import_record.tag = replacement.tag;
                import_record.flags.set(
                    bun_options_types::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS,
                    true,
                );
                continue;
            }

            if import_record.path.text.starts_with(b"bun:") {
                import_record.path = Fs::Path::init(&import_record.path.text[b"bun:".len()..]);
                import_record.path.namespace = b"bun";
                import_record.flags.set(
                    bun_options_types::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS,
                    true,
                );
            }
        }

        let printer_ptr = SOURCE_CODE_PRINTER.with(|cell| {
            if cell.get().is_none() {
                let writer = js_printer::BufferWriter::init();
                let mut bp = Box::new(js_printer::BufferPrinter::init(writer));
                bp.ctx.append_null_byte = false;
                // SAFETY: Box::into_raw never null
                cell.set(Some(unsafe { NonNull::new_unchecked(Box::into_raw(bp)) }));
            }
            cell.get().unwrap()
        });
        // SAFETY: thread-local owns the leaked Box; only this thread touches it.
        let source_code_printer = unsafe { printer_ptr.as_mut() };

        // PORT NOTE: Zig copies BufferPrinter by value here (`var printer = source_code_printer.?.*`)
        // and writes it back later. We mirror with clone() to preserve the same buffer-reuse dance.
        let mut printer = source_code_printer.clone();
        printer.ctx.reset();

        // Cap buffer size to prevent unbounded growth
        const MAX_BUFFER_CAP: usize = 512 * 1024;
        if printer.ctx.buffer.capacity() > MAX_BUFFER_CAP {
            // printer.ctx.buffer.deinit() → Drop
            let writer = js_printer::BufferWriter::init();
            *source_code_printer = js_printer::BufferPrinter::init(writer);
            source_code_printer.ctx.append_null_byte = false;
            printer = source_code_printer.clone();
        }

        let is_commonjs_module = parse_result.ast.has_commonjs_export_names
            || parse_result.ast.exports_kind == js_ast::ExportsKind::Cjs;
        let module_info: Option<*mut analyze_transpiled_module::ModuleInfo> =
            if vm.use_isolation_source_provider_cache()
                && !is_commonjs_module
                && loader.is_java_script_like()
            {
                analyze_transpiled_module::ModuleInfo::create(loader.is_type_script()).ok()
            } else {
                None
            };

        {
            let mut mapper = vm.source_map_handler(&mut printer);
            let _writeback = scopeguard::guard(
                (source_code_printer as *mut js_printer::BufferPrinter, &mut printer as *mut _),
                |(dst, src)| {
                    // SAFETY: both pointees outlive this scope; no aliases at drop
                    unsafe { *dst = (*src).clone() };
                },
            );
            match transpiler.print_with_source_map(
                parse_result,
                &mut printer,
                js_printer::Format::EsmAscii,
                mapper.get(),
                module_info,
            ) {
                Ok(_) => {}
                Err(err) => {
                    if let Some(mi) = module_info {
                        // SAFETY: mi was returned by ModuleInfo::create above
                        unsafe { analyze_transpiled_module::ModuleInfo::destroy(mi) };
                    }
                    self.parse_error = Some(err);
                    return;
                }
            }
        }

        #[cfg(feature = "dump_source")]
        dump_source(self.vm, specifier, &printer);

        let source_code = 'brk: {
            let written = printer.ctx.get_written();

            let result = cache
                .output_code
                .take()
                .unwrap_or_else(|| String::clone_latin1(written));

            if written.len() > 1024 * 1024 * 2 || vm.smol {
                // printer.ctx.buffer.deinit() → Drop
                let writer = js_printer::BufferWriter::init();
                *source_code_printer = js_printer::BufferPrinter::init(writer);
                source_code_printer.ctx.append_null_byte = false;
            } else {
                *source_code_printer = printer;
            }

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
            allocator: None,
            source_code,
            is_commonjs_module,
            module_info: module_info.map(|mi| {
                // SAFETY: mi valid; @ptrCast to ModuleInfoDeserialized*
                unsafe { (*mi).as_deserialized() as *mut _ }
            }),
            tag: self.resolved_source.tag,
            ..Default::default()
        };

        // arena drops here (bulk-free)
        let _ = arena;
    }
}

// TODO(port): placeholder re-exports for types referenced by tag matching above; Phase B
// resolves these against their real crates.
use crate::resolved_source::Tag as ResolvedSourceTag;
use bun_bundler::parse_result::AlreadyBundled;
use bun_jsc::runtime_transpiler_cache::OutputCode;
use crate::virtual_machine::BunWatcher;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/RuntimeTranspilerStore.zig (655 lines)
//   confidence: medium
//   todos:      28
//   notes:      run() has heavy defer/scopeguard + by-value Transpiler/BufferPrinter copies; vm/global_this fields use TSV-verbatim JSC_BORROW (`&T`) but struct crosses threads — Phase B may need raw ptrs; debug dump fn uses std.fs (stubbed to bun_sys).
// ──────────────────────────────────────────────────────────────────────────
