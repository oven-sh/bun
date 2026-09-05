#![allow(clippy::needless_return)]
#![warn(unused_must_use)]

use core::cell::Cell;
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_alloc::Arena;
use bun_ast::Loader;
use bun_ast::{ASTMemoryAllocator, ExportsKind};
use bun_ast::{ImportRecord, ImportRecordFlags};
use bun_bundler::analyze_transpiled_module;
use bun_bundler::options::ModuleType;
use bun_bundler::transpiler::{self as transpiler, AlreadyBundled, JobTranspiler, ParseOptions};
use bun_core::{MutableString, String, strings};
use bun_js_printer::{self as js_printer, BufferPrinter, BufferWriter};
use bun_paths;
use bun_ptr::BackRef;
use bun_resolve_builtins::{Alias as HardcodedAlias, Cfg as HardcodedAliasCfg};
use bun_resolver::fs as Fs;
use bun_resolver::node_fallbacks;
use bun_resolver::package_json::{MacroMap as MacroRemap, PackageJSON};
use bun_sys::{self, Dir, Fd, FdExt as _, File, OpenDirOptions};
use bun_threading::Guarded;
use bun_watcher::Watcher;

use crate::async_module::AsyncModule;
use crate::hot_reloader::ImportWatcher;
use crate::job::{Completion, Job, JobContext, JsThread};
use crate::resolved_source_tag::ResolvedSourceTag;
use crate::runtime_transpiler_cache::{
    ModuleType as CacheModuleType, RuntimeTranspilerCache as JscRuntimeTranspilerCache,
};
use crate::saved_source_map::SavedSourceMap;
use crate::strong::Optional as StrongOptional;
use crate::virtual_machine::{SourceMapHandlerGetter, VirtualMachine};
use crate::{JSGlobalObject, JSInternalPromise, JSValue, JsResult, ResolvedSource};

// LAYERING: `ParseOptions.runtime_transpiler_cache` carries the canonical
// lower-tier type from `bun_js_parser` (re-exported via `bun_bundler`). The
// JSC-tier disk-backed `Entry` is round-tripped through it type-erased via
// `JSC_PARSER_CACHE_VTABLE` (see RuntimeTranspilerCache.rs).
use bun_ast::RuntimeTranspilerCache;

bun_core::declare_scope!(RuntimeTranspilerStore, hidden);

// ──────────────────────────────────────────────────────────────────────────
// Debug source dumping (debug-only helpers; no-ops in release)
// ──────────────────────────────────────────────────────────────────────────

// Called from the transpiler worker thread while the JS thread is concurrently
// live on the same VM, so these take the VM's (internally locked)
// `SavedSourceMap` rather than the VM.
fn dump_source(source_mappings: &SavedSourceMap, specifier: &[u8], printer: &BufferPrinter) {
    dump_source_string(source_mappings, specifier, printer.ctx.get_written());
}

pub(crate) fn dump_source_string(
    source_mappings: &SavedSourceMap,
    specifier: &[u8],
    written: &[u8],
) {
    if let Err(e) = dump_source_string_failiable(source_mappings, specifier, written) {
        bun_core::debug_warn!("Failed to dump source string: {}", e.name());
    }
}

// PORTING.md §Global mutable state: lazily-opened debug-dump dir, guarded by a
// mutex. `Guarded` fuses the lock and the payload so the per-access body is
// safe code (replaces the prior split `Mutex` + `RacyCell` pair).
static BUN_DEBUG_HOLDER: Guarded<Option<Dir>> = Guarded::new(None);

fn dump_source_string_failiable(
    source_mappings: &SavedSourceMap,
    specifier: &[u8],
    written: &[u8],
) -> crate::CrateResult<()> {
    if !cfg!(debug_assertions) {
        return Ok(());
    }
    if bun_core::env_var::feature_flag::BUN_DEBUG_NO_DUMP
        .get()
        .unwrap_or(false)
    {
        return Ok(());
    }

    let mut holder = BUN_DEBUG_HOLDER.lock();

    let mut path_buf = bun_paths::PathBuffer::default();

    if holder.is_none() {
        let base_name: &[u8] = if cfg!(windows) {
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
        *holder = Some(Dir::cwd().make_open_path(base_name, OpenDirOptions::default())?);
    }
    // `Dir` is `!Copy`; the singleton stays owned by `BUN_DEBUG_HOLDER` for
    // process lifetime — borrow it for the duration of this dump.
    let dir = holder.as_ref().expect("just initialized above");

    if let Some(dir_path) = bun_paths::dirname(specifier) {
        let root_len = if cfg!(windows) {
            bun_paths::resolve_path::windows_filesystem_root(dir_path).len()
        } else {
            b"/".len()
        };
        let parent = dir.make_open_path(&dir_path[root_len..], OpenDirOptions::default())?;

        let base = bun_paths::basename(specifier);
        let base_z = bun_paths::resolve_path::z(base, &mut path_buf);
        if let Err(e) = File::write_file(parent.fd, base_z, written) {
            bun_core::debug_warn!(
                "Failed to dump source string: writeFile {}",
                crate::CrateError::from(e).name()
            );
            return Ok(());
        }

        if let Some(mappings) = source_mappings.get(specifier) {
            // `defer mappings.deref()` → Arc::drop.
            let mut map_path = Vec::with_capacity(base.len() + b".map".len());
            map_path.extend_from_slice(base);
            map_path.extend_from_slice(b".map");
            let map_path_z = bun_paths::resolve_path::z(&map_path, &mut path_buf);
            let file = parent.create_file_z(
                map_path_z,
                bun_sys::CreateFlags {
                    truncate: true,
                    read: false,
                },
            )?;

            // `parent.readFileAlloc(allocator, specifier, maxInt) catch ""`
            let source_file = File::read_from(parent.fd, specifier).unwrap_or_default();

            use core::fmt::Write as _;
            let mut out = std::string::String::new();
            // Note: closures can't unify input/output lifetimes for the
            // `JSONFormatterUTF8<'_>` borrow — local fn item works.
            fn json(s: &[u8]) -> bun_core::fmt::JSONFormatterUTF8<'_> {
                bun_core::fmt::format_json_string_utf8(
                    s,
                    bun_core::fmt::JSONFormatterUTF8Options::default(),
                )
            }
            // Building the whole document in memory then `write_all` is
            // fine for this debug-only dump.
            write!(
                out,
                "{{\n  \"version\": 3,\n  \"file\": {},\n  \"sourceRoot\": \"\",\n  \"sources\": [{}],\n  \"sourcesContent\": [{}],\n  \"names\": [],\n  \"mappings\": \"{}\"\n}}",
                json(base),
                json(specifier),
                json(&source_file),
                mappings.format_vlqs(),
            )
            .map_err(|_| crate::CrateError::WriteError)?;
            file.write_all(out.as_bytes())?;
        }
    } else {
        let base = bun_paths::basename(specifier);
        let base_z = bun_paths::resolve_path::z(base, &mut path_buf);
        let _ = File::write_file(dir.fd, base_z, written);
    }

    Ok(())
}

// `pub`: also consumed cross-crate by bun_runtime's ModuleLoader transpile path
// (runtime/jsc_hooks.rs). The one-shot AtomicBool
// must stay shared between that path and this store — whichever transpiles the
// main module first consumes it.
pub fn set_break_point_on_first_line() -> bool {
    static SET_BREAK_POINT: AtomicBool = AtomicBool::new(true);
    SET_BREAK_POINT.swap(false, Ordering::SeqCst)
}

// ──────────────────────────────────────────────────────────────────────────
// RuntimeTranspilerStore
// ──────────────────────────────────────────────────────────────────────────

/// Off-thread module transpilation for `import`: each module is a
/// [`Job<TranspileJob>`] that parses and prints on the work pool and fulfils
/// the module's promise back on the JS thread.
pub struct RuntimeTranspilerStore {
    /// Bumped when a hot reload invalidates in-flight transpiles; a job whose
    /// generation no longer matches when it reaches the pool fails with
    /// `TranspilerJobGenerationMismatch` instead of transpiling stale input.
    pub(crate) generation_number: AtomicU32,
    pub enabled: bool,
}

impl Default for RuntimeTranspilerStore {
    fn default() -> Self {
        Self {
            generation_number: AtomicU32::new(0),
            enabled: true,
        }
    }
}

impl RuntimeTranspilerStore {
    pub(crate) fn init() -> RuntimeTranspilerStore {
        Self::default()
    }

    /// JS thread: start transpiling `path` (process-lifetime text, see
    /// `jsc_hooks::intern_path`) on the work pool and return the promise the
    /// module loader waits on.
    pub fn transpile(
        vm: &VirtualMachine,
        global_object: &JSGlobalObject,
        input_specifier: String,
        path: Fs::Path<'static>,
        referrer: String,
        loader: Loader,
        package_json: Option<&PackageJSON>,
    ) -> *mut JSInternalPromise {
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

        let hash = Watcher::get_hash(path.text);
        let is_main = vm.main().len() == path.text.len()
            && vm.main_hash == hash
            && strings::eql_long(vm.main(), path.text, false);

        if cfg!(debug_assertions) {
            bun_core::scoped_log!(
                RuntimeTranspilerStore,
                "transpile({}, {}, async)",
                bstr::BStr::new(path.text),
                <&'static str>::from(loader)
            );
        }

        let work = TranspileWork {
            input: TranspileInput {
                path,
                hash,
                loader,
                tag: resolved_source.tag,
                // Each `BackRef` below: the VM (and the process-lifetime import
                // watcher) outlive the job, which holds the VM's ticket.
                source_mappings: BackRef::new(&vm.source_mappings),
                import_watcher: ptr::NonNull::new(vm.bun_watcher_ptr()).map(BackRef::from),
                is_main,
                use_macro_remap: !vm.macro_mode && vm.has_any_macro_remappings,
                debugger_breaks_on_first_line: vm
                    .debugger
                    .as_ref()
                    .map(|d| d.set_breakpoint_on_first_line)
                    .unwrap_or(false),
                has_eval_source: vm.module_loader.eval_source.is_some(),
                use_isolation_source_provider_cache: vm.use_isolation_source_provider_cache(),
                inline_source_map: vm.inline_source_map_enabled(),
                smol: vm.smol,
            },
            transpiler: BackRef::new(&vm.transpiler),
            store_generation: BackRef::new(&vm.transpiler_store.generation_number),
            generation_number: vm.transpiler_store.generation_number.load(Ordering::SeqCst),
            log: bun_ast::Log::init(),
            parse_error: None,
            resolved_source,
        };
        let js = TranspileJs {
            promise: StrongOptional::create(JSValue::from_cell(promise), global_object),
            global_this: BackRef::new(global_object),
            input_specifier,
            referrer,
        };
        Job::<TranspileJob>::schedule(&global_object.js_thread(), work, js);
        promise
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TranspileJob
// ──────────────────────────────────────────────────────────────────────────

/// The [`JobContext`] of one off-thread module transpile.
pub struct TranspileJob;

/// What the work pool gets: the module to transpile plus the VM state the
/// transpile reads (snapshotted on the JS thread), the VM's transpiler (whose
/// configuration the pool thread copies for the job), and the result slots
/// [`TranspileJob::then`] reads back on the JS thread.
pub struct TranspileWork {
    input: TranspileInput,
    /// The VM (which holds it) outlives the job, which holds the VM's ticket.
    transpiler: BackRef<bun_bundler::Transpiler<'static>>,
    store_generation: BackRef<AtomicU32>,
    generation_number: u32,
    log: bun_ast::Log,
    parse_error: Option<crate::CrateError>,
    /// Moved out by `then`; dropped with the job otherwise.
    resolved_source: ResolvedSource,
}

/// The read-only inputs of a transpile, as captured on the JS thread in
/// [`RuntimeTranspilerStore::transpile`], and the two VM structures it writes
/// into from the pool (each under its own lock).
#[derive(Clone, Copy)]
struct TranspileInput {
    path: Fs::Path<'static>,
    hash: bun_watcher::HashType,
    loader: Loader,
    tag: ResolvedSourceTag,
    source_mappings: BackRef<SavedSourceMap>,
    /// The VM's hot-reload watcher (process-lifetime once installed), if any;
    /// files transpiled here are added to it under its mutex.
    import_watcher: Option<BackRef<ImportWatcher>>,
    is_main: bool,
    use_macro_remap: bool,
    debugger_breaks_on_first_line: bool,
    has_eval_source: bool,
    use_isolation_source_provider_cache: bool,
    inline_source_map: bool,
    smol: bool,
}

// SAFETY: moved to a work-pool thread by `Job`, which holds the VM's ticket
// for the trip: the `BackRef`s and the import watcher all point at VM-owned
// (or process-lifetime) state that the ticket keeps alive and that is only
// touched under its own lock (source maps, watcher) or read (the transpiler's
// configuration, fixed once modules load); the strings / resolved source are
// plain heap data handed from the pool thread to the JS thread, never shared.
unsafe impl Send for TranspileWork {}

/// What stays on the JS thread: the module promise and the strings its
/// fulfilment needs.
#[derive(bun_jsc_macros::JsAffine)]
pub struct TranspileJs {
    promise: StrongOptional,
    global_this: BackRef<JSGlobalObject>,
    input_specifier: String,
    referrer: String,
}

impl JobContext for TranspileJob {
    type OffThread = TranspileWork;
    type Js = TranspileJs;

    /// Pool thread. Transpile only while the VM still runs script; either way
    /// the job goes straight back to the JS thread, which completes or
    /// releases it.
    fn run(work: &mut TranspileWork, done: Completion<Self>) -> Option<Completion<Self>> {
        if done.ticket().script_allowed() {
            work.run();
        }
        Some(done)
    }

    /// JS thread: fulfil the module promise with the transpiled source (or the
    /// parse error).
    fn then(work: TranspileWork, js: TranspileJs, _cx: &JsThread<'_>) -> JsResult<()> {
        let path = work.input.path;
        let TranspileWork {
            mut log,
            parse_error,
            resolved_source,
            ..
        } = work;
        let TranspileJs {
            mut promise,
            global_this,
            input_specifier,
            referrer,
        } = js;
        let promise_value = promise.swap();
        let (specifier, result) = match parse_error {
            Some(e) => (String::clone_utf8(path.text), Err(e)),
            None => {
                let mut resolved_source = resolved_source;
                debug_assert!(resolved_source.source_url.is_empty());
                resolved_source.source_url = input_specifier.create_if_different(path.text);
                (input_specifier, Ok(resolved_source))
            }
        };
        drop(promise);

        AsyncModule::fulfill(
            &global_this,
            promise_value,
            result,
            &specifier,
            &referrer,
            &mut log,
        )
    }
}

/// Per-worker output buffer. The printer is the **only** state retained across
/// `run()` calls — its backing `Vec<u8>` is genuinely worth reusing (capped at
/// 512 K / 2 M below). The parse arena and AST memory store, by contrast, are
/// stack-local per call and bulk-freed on return; see the RSS-regression note
/// in `run()`.
//
// `#[thread_local]` not `thread_local!`: the macro's `LocalKey::__getit`
// wrapper showed up on the async-import hot path. Const-init, never dropped
// (the box leaks with the worker thread).
#[thread_local]
static SOURCE_CODE_PRINTER: Cell<Option<Box<BufferPrinter>>> = Cell::new(None);

fn fresh_source_code_printer() -> BufferPrinter {
    let mut printer = BufferPrinter::init(BufferWriter::init());
    printer.ctx.append_null_byte = false;
    printer
}

/// This worker's [`SOURCE_CODE_PRINTER`], taken out of the thread-local for
/// one `run()` and put back — so its buffer is reused — when dropped.
struct WorkerPrinter(Option<Box<BufferPrinter>>);

impl WorkerPrinter {
    fn take() -> Self {
        Self(Some(
            SOURCE_CODE_PRINTER
                .take()
                .unwrap_or_else(|| Box::new(fresh_source_code_printer())),
        ))
    }
}

impl core::ops::Deref for WorkerPrinter {
    type Target = BufferPrinter;
    fn deref(&self) -> &BufferPrinter {
        self.0.as_deref().expect("live until drop")
    }
}

impl core::ops::DerefMut for WorkerPrinter {
    fn deref_mut(&mut self) -> &mut BufferPrinter {
        self.0.as_deref_mut().expect("live until drop")
    }
}

impl Drop for WorkerPrinter {
    fn drop(&mut self) {
        SOURCE_CODE_PRINTER.set(self.0.take());
    }
}

/// The transpile's input file: closed on drop unless the watcher adopted it.
struct InputFd(Fd);

impl Drop for InputFd {
    fn drop(&mut self) {
        if self.0.is_valid() {
            self.0.close();
            self.0 = Fd::INVALID;
        }
    }
}

impl TranspileInput {
    /// Hand `fd` (the just-parsed input file) to the hot-reload watcher if
    /// this module should be watched; `fd` stays open only if the watcher
    /// adopted it.
    fn maybe_watch(
        &self,
        fd: &mut InputFd,
        is_node_override: bool,
        package_json: Option<&'static bun_watcher::PackageJSON>,
    ) {
        let Some(iw) = self.import_watcher else {
            return;
        };
        // `vm.isWatcherEnabled()` ⇔ watcher present. A non-null pointer may
        // still hold `ImportWatcher::None`; both must be ruled out or we'd
        // skip closing `fd` without a watcher to adopt it. Only the JS thread
        // mutates the variant.
        if matches!(&*iw, ImportWatcher::None)
            || !fd.0.is_valid()
            || is_node_override
            || !bun_paths::is_absolute(self.path.text)
            || strings::contains(self.path.text, b"node_modules")
        {
            return;
        }
        // SAFETY: the watcher is process-lifetime once installed (see
        // `import_watcher`); `add_file` serialises with the watcher thread and
        // other transpiler threads through the watcher's own mutex, and no
        // `&ImportWatcher` is live across this call on this thread.
        let iw = unsafe { &mut *iw.as_const_ptr().cast_mut() };
        let added = iw.add_file::<true>(fd.0, self.path.text, self.hash, Fd::INVALID, package_json);
        if matches!(added, Ok(bun_watcher::FdOwnership::Watcher)) {
            fd.0 = Fd::INVALID;
        }
    }

    /// The transpile proper: parse `self.path` through `transpiler` (already
    /// aimed at this call's arena and log) and print it, storing the source
    /// map in the VM. `Ok` is what the module promise is fulfilled with.
    fn parse_and_print<'a>(
        &self,
        transpiler: &mut bun_bundler::Transpiler<'a>,
        arena: &'a Arena,
    ) -> Result<ResolvedSource, crate::CrateError> {
        let Self {
            path,
            hash,
            loader,
            tag: this_tag,
            is_main,
            use_isolation_source_provider_cache,
            ..
        } = *self;
        let specifier = path.text;
        let source_mappings: &SavedSourceMap = self.source_mappings.get();

        // LAYERING: this is the canonical `bun_ast::RuntimeTranspilerCache`
        // wired with the JSC vtable so the parser's `cache.get()` reaches the
        // disk-backed `Entry` loader; a hit is unboxed by `take_entry` below.
        let mut cache = RuntimeTranspilerCache {
            r#impl: Some(bun_ast::TranspilerCacheImplKind::Jsc),
            ..Default::default()
        };

        let mut package_json: Option<&'static bun_watcher::PackageJSON> = None;
        if let Some(iw) = self.import_watcher {
            // Never read through the watchlist's stored fd; see
            // `ImportWatcher::snapshot_package_json`.
            package_json = iw.snapshot_package_json(hash);
        }

        // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
        let is_node_override = strings::has_prefix_comptime(specifier, node_fallbacks::IMPORT_PATH);

        let macro_remappings = if !self.use_macro_remap || is_node_override {
            MacroRemap::default()
        } else {
            // Note: `MacroRemap` (StringArrayHashMap of StringArrayHashMap)
            // has no nested `Clone` impl (the inherent `clone()` requires
            // `V: Clone`). Re-key shallowly here
            // matching the build-command conversion (transpiler.rs:2616).
            // OOM during the
            // inner `clone()` must abort — never silently drop a remapping.
            let mut m = MacroRemap::default();
            for (k, v) in transpiler.options.macro_remap.iter() {
                m.insert(k, bun_core::handle_oom(v.clone()));
            }
            m
        };

        // Only initialised on the `is_node_override` branch and only read
        // through `parse_options.virtual_source`.
        let fallback_source;

        let mut input_fd = InputFd(Fd::INVALID);

        let module_type: ModuleType = match this_tag {
            ResolvedSourceTag::PackageJsonTypeCommonjs => ModuleType::Cjs,
            ResolvedSourceTag::PackageJsonTypeModule => ModuleType::Esm,
            _ => ModuleType::Unknown,
        };

        let mut parse_options = ParseOptions {
            arena,
            path,
            loader,
            dirname_fd: Fd::INVALID,
            file_descriptor: None,
            file_fd_ptr: Some(&mut input_fd.0),
            macro_remappings,
            macro_js_ctx: transpiler::default_macro_js_value(),
            jsx: transpiler.options.jsx.clone(),
            emit_decorator_metadata: transpiler.options.emit_decorator_metadata,
            experimental_decorators: transpiler.options.experimental_decorators,
            use_define_for_class_fields: transpiler.options.use_define_for_class_fields,
            virtual_source: None,
            replace_exports: Default::default(),
            dont_bundle_twice: true,
            allow_commonjs: true,
            inject_jest_globals: transpiler.options.rewrite_jest_for_tests,
            set_breakpoint_on_first_line: self.debugger_breaks_on_first_line
                && is_main
                && set_break_point_on_first_line(),
            runtime_transpiler_cache: if !JscRuntimeTranspilerCache::is_disabled() {
                Some(&mut cache)
            } else {
                None
            },
            remove_cjs_module_wrapper: is_main && self.has_eval_source,
            module_type,
            keep_json_and_toml_as_one_statement: false,
            allow_bytecode_cache: true,
        };

        if is_node_override {
            if let Some(code) = node_fallbacks::contents_from_path(specifier) {
                let fallback_path = bun_paths::fs::Path::init_with_namespace(specifier, b"node");
                fallback_source = bun_ast::Source {
                    path: fallback_path,
                    contents: std::borrow::Cow::Borrowed(code),
                    ..Default::default()
                };
                parse_options.virtual_source = Some(&fallback_source);
            }
        }

        let Some(mut parse_result) = transpiler
            .parse_maybe_return_file_only_allow_shared_buffer::<false, false>(parse_options, None)
        else {
            self.maybe_watch(&mut input_fd, is_node_override, package_json);
            return Err(crate::CrateError::ParseError);
        };

        self.maybe_watch(&mut input_fd, is_node_override, package_json);

        if let Some(mut entry) = crate::runtime_transpiler_cache::take_entry(&mut cache) {
            let _ = source_mappings.put_mappings(
                &parse_result.source,
                MutableString {
                    list: core::mem::take(&mut entry.sourcemap).into_vec(),
                },
            );

            if bun_core::env::DUMP_SOURCE {
                dump_source_string(source_mappings, specifier, entry.output_code.byte_slice());
            }

            let module_info = if use_isolation_source_provider_cache
                && entry.metadata.module_type != CacheModuleType::Cjs
                && !entry.esm_record.is_empty()
            {
                analyze_transpiled_module::ModuleInfoDeserialized::create_from_cached_record(
                    &entry.esm_record,
                )
            } else {
                None
            };

            return Ok(ResolvedSource {
                source_code: core::mem::take(&mut entry.output_code),
                is_commonjs_module: entry.metadata.module_type == CacheModuleType::Cjs,
                module_info,
                tag: this_tag,
                ..Default::default()
            });
        }

        if !matches!(parse_result.already_bundled, AlreadyBundled::None) {
            let already_bundled = core::mem::take(&mut parse_result.already_bundled);
            let is_commonjs_module = already_bundled.is_common_js();
            let bytecode_cache =
                crate::resolved_source::Bytecode::owned(already_bundled.into_bytecode());
            let resolved_source = ResolvedSource {
                source_code: String::clone_latin1(&parse_result.source.contents),
                already_bundled: true,
                bytecode_cache,
                is_commonjs_module,
                tag: this_tag,
                ..Default::default()
            };
            resolved_source.source_code.ensure_hash();
            return Ok(resolved_source);
        }

        for import_record in parse_result.ast.import_records.as_mut_slice() {
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

        let mut printer = WorkerPrinter::take();
        printer.ctx.reset();

        // Cap buffer size to prevent unbounded growth
        const MAX_BUFFER_CAP: usize = 512 * 1024;
        if printer.ctx.buffer.list.capacity() > MAX_BUFFER_CAP {
            *printer = fresh_source_code_printer();
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
        // Propagate top-level-await to the cached
        // module record. Without this, modules cached via the isolation source
        // provider (used under --isolate / --parallel) are reported to JSC as
        // having no TLA, so the module's evaluation promise resolves before the
        // top-level-await actually completes — causing the caller's
        // `wait_for_promise` on the preload to return early.
        if let Some(mi) = module_info.as_deref_mut() {
            mi.flags.has_tla = !parse_result.ast.top_level_await_keyword.is_empty();
        }
        // Derive `*mut` from a `&mut` borrow. The `&mut` borrow ends when the
        // closure returns; the raw pointer stays valid until `module_info` is
        // moved/touched again (after `print_with_source_map`).
        let module_info_ptr: Option<*mut analyze_transpiled_module::ModuleInfo> =
            module_info.as_deref_mut().map(core::ptr::from_mut);

        {
            let mut mapper = SourceMapHandlerGetter::new(source_mappings, self.inline_source_map);
            transpiler
                .print_with_source_map(
                    // Same per-call `arena` the transpiler and
                    // `parse_options.arena` used to build `parse_result.ast`.
                    arena,
                    parse_result,
                    &mut printer,
                    js_printer::Format::EsmAscii,
                    mapper.get(),
                    module_info_ptr,
                )
                .map_err(crate::CrateError::from)?;
            mapper
                .write_inline_trailer(&mut printer)
                .map_err(|e| crate::CrateError::from(bun_bundler::Error::from(e)))?;
        }

        if bun_core::env::DUMP_SOURCE {
            dump_source(source_mappings, specifier, &printer);
        }

        let source_code = 'brk: {
            let written = printer.ctx.get_written();

            // The `Jsc` vtable bridge `put()` does not write
            // `cache.output_code` (only the `r#impl == None` fallback does,
            // and `r#impl` is `Some(Jsc)` here), so it is always `None`.
            debug_assert!(cache.output_code.is_none());
            let result = String::clone_latin1(written);

            if written.len() > 1024 * 1024 * 2 || self.smol {
                // Release the large / --smol print buffer now instead of
                // holding it until the next transpile on this worker.
                *printer = fresh_source_code_printer();
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
        Ok(ResolvedSource {
            source_code,
            is_commonjs_module,
            module_info: module_info.map(|mi| {
                use analyze_transpiled_module::ModuleInfoExt;
                mi.into_deserialized()
            }),
            tag: this_tag,
            ..Default::default()
        })
    }
}

impl TranspileWork {
    fn run(&mut self) {
        // Stack-local per call, bulk-freed on return. An earlier version hoisted
        // this to a per-worker-thread leaked `Box<MimallocArena>` (and a second
        // one inside a leaked `ASTMemoryAllocator`) and only `reset()` it at
        // the *start* of the next call. On a 64-core box ~40 thread-pool
        // workers each parse one or two modules then go idle, leaving ~80
        // undestroyed `mi_heap_t`s holding ~7 MB requested / ~10–11 MB
        // committed of dead AST between calls — the +12 % RSS regression seen
        // on `server/elysia`. `MimallocArena::Drop` = `mi_heap_destroy`, so the
        // per-call heap-churn is identical to a start-of-call `reset()` but the
        // worker holds **zero** retained pages between calls.
        let arena = Arena::new();

        if self.generation_number != self.store_generation.load(Ordering::Relaxed) {
            self.parse_error = Some(crate::CrateError::TranspilerJobGenerationMismatch);
            return;
        }

        // `borrowing()`: the AST node store and the
        // `AstVec` spill share `arena`'s heap and are bulk-freed when `arena`
        // drops at the end of `run()`.
        let mut ast_memory_store = ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_store.enter();

        // SAFETY: see `transpiler`; the copy only parses and prints, and is
        // dropped (freeing the macro context a parse lazily creates through
        // this thread's per-thread state) before this returns.
        let mut transpiler = unsafe { JobTranspiler::new(self.transpiler.get()) };

        // Parsed into a fresh log; whatever it collects is recycled into
        // `self.log` (what `then` reports from) on every way out.
        let mut log = bun_ast::Log::init();
        let result = {
            let mut transpiler = transpiler.for_call(&arena, &mut log);
            self.input.parse_and_print(&mut transpiler, &arena)
        };
        drop(transpiler);
        self.log = bun_ast::Log::init();
        log.clone_to_with_recycled(&mut self.log, true);
        match result {
            Ok(resolved_source) => self.resolved_source = resolved_source,
            Err(err) => self.parse_error = Some(err),
        }

        // `arena` and `ast_memory_store` drop here (after `_ast_scope` restores
        // the thread-local AST heap pointer), `mi_heap_destroy`ing every parse
        // / AST allocation made by this call. Nothing references them past
        // this point — `source_code` is a fresh WTF::String copy.
    }
}
