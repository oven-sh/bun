//! Port of src/bundler/LinkerContext.zig

use core::sync::atomic::{AtomicU32, Ordering};
use core::mem::offset_of;

use bun_core::{self as bun, Output, Environment, FeatureFlags, Error as BunError};
use bun_alloc::{Arena as Bump, AllocError};
use bun_collections::{BabyList, MultiArrayList, AutoBitSet, ArrayHashMap, HashMap};
use bun_logger as Logger;
use bun_logger::{Loc, Range, Data, Source, Log};
use bun_str::{strings, MutableString, StringJoiner};
use bun_sourcemap::{self as SourceMap, LineOffsetTable, SourceMapState, SourceMapPieces, SourceMapShifts, DebugIDFormatter};
use bun_threading::{self as sync, ThreadPool as ThreadPoolLib, WaitGroup};
use bun_options_types::{ImportRecord, ImportKind};
// TODO(b0): bake_types arrives from move-in (TYPE_ONLY → bundler)
use crate::bake_types as bake;
use bun_css as css;

use bun_js_parser::{self as js_ast, Ref, Index, Expr, Stmt, Part, Symbol, Binding, Dependency, NamedImport, TlaCheck, DeclaredSymbol, ExportsKind, BundledAst as JSAst};
use bun_js_parser::{E, S, B, G};
use bun_js_parser::printer as js_printer;
use bun_js_parser::lexer as lex;
use bun_js_parser::renamer;

use bun_resolver::{self as _resolver, Resolver};
use bun_options_types::SideEffects;
use bun_fs as Fs;
use bun_node_fallbacks as NodeFallbackModules;

use crate::options::{self, Loader, Format, Target, SourceMapOption};
use crate::{
    AdditionalFile, BundleV2, Chunk, CompileResult, CompileResultForSourceMap, ContentHasher,
    EntryPoint, ExportData, Graph, ImportTracker, JSMeta, LinkerGraph, MangledProps, PartRange,
    RefImportData, ServerComponentBoundary, StableRef, WrapKind, ThreadPool,
    generic_path_with_pretty_initialized, log_part_dependency_tree,
};

bun_output::declare_scope!(LinkerCtx, visible);
bun_output::declare_scope!(TreeShake, hidden);

macro_rules! debug {
    ($($arg:tt)*) => { bun_output::scoped_log!(LinkerCtx, $($arg)*) };
}
macro_rules! debug_tree_shake {
    ($($arg:tt)*) => { bun_output::scoped_log!(TreeShake, $($arg)*) };
}

// Re-exports from sibling modules
pub use crate::linker_context::output_file_list_builder as OutputFileListBuilder;
pub use crate::linker_context::static_route_visitor as StaticRouteVisitor;
pub use crate::linker_context::metafile_builder as MetafileBuilder;

pub use crate::linker_context::compute_chunks::compute_chunks;
pub use crate::linker_context::find_all_imported_parts_in_js_order::{find_all_imported_parts_in_js_order, find_imported_parts_in_js_order};
pub use crate::linker_context::find_imported_files_in_css_order::find_imported_files_in_css_order;
pub use crate::linker_context::find_imported_css_files_in_js_order::find_imported_css_files_in_js_order;
pub use crate::linker_context::generate_code_for_lazy_export::generate_code_for_lazy_export;
pub use crate::linker_context::scan_imports_and_exports::scan_imports_and_exports;
pub use crate::linker_context::do_step5::{do_step5, create_exports_for_file};
pub use crate::linker_context::compute_cross_chunk_dependencies::compute_cross_chunk_dependencies;
pub use crate::linker_context::post_process_js_chunk::post_process_js_chunk;
pub use crate::linker_context::post_process_css_chunk::post_process_css_chunk;
pub use crate::linker_context::post_process_html_chunk::post_process_html_chunk;
pub use crate::linker_context::rename_symbols_in_chunk::rename_symbols_in_chunk;
pub use crate::linker_context::generate_chunks_in_parallel::generate_chunks_in_parallel;
pub use crate::linker_context::generate_compile_result_for_js_chunk::generate_compile_result_for_js_chunk;
pub use crate::linker_context::generate_compile_result_for_css_chunk::generate_compile_result_for_css_chunk;
pub use crate::linker_context::generate_compile_result_for_html_chunk::generate_compile_result_for_html_chunk;
pub use crate::linker_context::prepare_css_asts_for_chunk::{prepare_css_asts_for_chunk, PrepareCssAstTask};
pub use crate::linker_context::convert_stmts_for_chunk::convert_stmts_for_chunk;
pub use crate::linker_context::convert_stmts_for_chunk_for_dev_server::convert_stmts_for_chunk_for_dev_server;
pub use crate::linker_context::generate_code_for_file_in_chunk_js::generate_code_for_file_in_chunk_js;
pub use crate::linker_context::write_output_files_to_disk::write_output_files_to_disk;

// TODO(port): DeferredBatchTask, ParseTask re-exports — Zig re-exports from bundle_v2
pub use crate::DeferredBatchTask;
pub use crate::ParseTask;

pub struct LinkerContext<'a> {
    pub parse_graph: *mut Graph,
    pub graph: LinkerGraph,
    pub log: &'a mut Log,

    pub resolver: *mut Resolver,
    pub cycle_detector: Vec<ImportTracker>,

    /// We may need to refer to the "__esm" and/or "__commonJS" runtime symbols
    pub cjs_runtime_ref: Ref,
    pub esm_runtime_ref: Ref,

    /// We may need to refer to the CommonJS "module" symbol for exports
    pub unbound_module_ref: Ref,

    /// We may need to refer to the "__promiseAll" runtime symbol
    pub promise_all_runtime_ref: Ref,

    pub options: LinkerOptions,

    pub r#loop: EventLoop,

    /// string buffer containing pre-formatted unique keys
    pub unique_key_buf: Box<[u8]>,

    /// string buffer containing prefix for each unique keys
    pub unique_key_prefix: Box<[u8]>,

    pub source_maps: SourceMapData,

    /// This will eventually be used for reference-counting LinkerContext
    /// to know whether or not we can free it safely.
    pub pending_task_count: AtomicU32,

    ///
    pub has_any_css_locals: AtomicU32,

    /// Used by Bake to extract []CompileResult before it is joined.
    /// CYCLEBREAK GENUINE: erased bake::DevServer (see bundle_v2::dispatch).
    pub dev_server: Option<crate::dispatch::DevServerHandle>,
    pub framework: Option<*const bake::Framework>,

    pub mangled_props: MangledProps,
}

impl<'a> LinkerContext<'a> {
    pub fn allocator(&self) -> &Bump {
        // TODO(port): bundler is an AST crate; LinkerGraph owns the arena
        self.graph.allocator()
    }

    pub fn path_with_pretty_initialized(&mut self, path: Fs::Path) -> Result<Fs::Path, BunError> {
        // SAFETY: resolver is a backref into BundleV2.transpiler.resolver, valid for self's lifetime
        let resolver = unsafe { &*self.resolver };
        generic_path_with_pretty_initialized(path, self.options.target, resolver.fs.top_level_dir, self.allocator())
    }

    pub fn is_external_dynamic_import(&self, record: &ImportRecord, source_index: u32) -> bool {
        self.graph.code_splitting
            && record.kind == ImportKind::Dynamic
            && self.graph.files.items_entry_point_kind()[record.source_index.get() as usize].is_entry_point()
            && record.source_index.get() != source_index
    }

    pub fn should_include_part(&self, source_index: Index::Int, part: &Part) -> bool {
        // As an optimization, ignore parts containing a single import statement to
        // an internal non-wrapped file. These will be ignored anyway and it's a
        // performance hit to include the part only to discover it's unnecessary later.
        if part.stmts.len() == 1 {
            if let Stmt::SImport(s_import) = &part.stmts[0].data {
                let record = self.graph.ast.items_import_records()[source_index as usize].at(s_import.import_record_index);
                if record.source_index.is_valid()
                    && self.graph.meta.items_flags()[record.source_index.get() as usize].wrap == WrapKind::None
                {
                    return false;
                }
            }
        }

        true
    }

    pub fn load(
        &mut self,
        bundle: &mut BundleV2,
        entry_points: &mut [Index],
        server_component_boundaries: ServerComponentBoundary::List,
        reachable: &mut [Index],
    ) -> Result<(), BunError> {
        let _trace = bun::perf::trace("Bundler.CloneLinkerGraph");
        self.parse_graph = &mut bundle.graph;

        self.graph.code_splitting = bundle.transpiler.options.code_splitting;
        // TODO(port): lifetime — log is &'a mut Log; reassigning here mirrors Zig's pointer assignment
        self.log = bundle.transpiler.log;

        self.resolver = &mut bundle.transpiler.resolver;
        self.cycle_detector = Vec::new();

        self.graph.reachable_files = reachable;

        // SAFETY: parse_graph is valid backref just assigned above
        let sources: &[Source] = unsafe { (*self.parse_graph).input_files.items_source() };

        self.graph.load(
            entry_points,
            sources,
            server_component_boundaries,
            bundle.dynamic_import_entry_points.keys(),
            // SAFETY: parse_graph backref
            unsafe { &mut (*self.parse_graph).entry_point_original_names },
        )?;
        bundle.dynamic_import_entry_points.deinit();

        let runtime_named_exports = &mut self.graph.ast.items_named_exports_mut()[Index::runtime().get() as usize];

        self.esm_runtime_ref = runtime_named_exports.get(b"__esm").unwrap().r#ref;
        self.cjs_runtime_ref = runtime_named_exports.get(b"__commonJS").unwrap().r#ref;
        self.promise_all_runtime_ref = runtime_named_exports.get(b"__promiseAll").unwrap().r#ref;

        if self.options.output_format == Format::Cjs {
            self.unbound_module_ref = self.graph.generate_new_symbol(Index::runtime().get(), Symbol::Kind::Unbound, b"module");
        }

        if self.options.output_format == Format::Cjs || self.options.output_format == Format::Iife {
            // PORT NOTE: reshaped for borrowck — fetch slices once
            let exports_kind = self.graph.ast.items_exports_kind_mut();
            let ast_flags_list = self.graph.ast.items_flags_mut();
            let meta_flags_list = self.graph.meta.items_flags_mut();

            for entry_point in entry_points.iter() {
                let mut ast_flags: js_ast::BundledAst::Flags = ast_flags_list[entry_point.get() as usize];

                // Loaders default to CommonJS when they are the entry point and the output
                // format is not ESM-compatible since that avoids generating the ESM-to-CJS
                // machinery.
                if ast_flags.has_lazy_export {
                    exports_kind[entry_point.get() as usize] = ExportsKind::Cjs;
                }

                // Entry points with ES6 exports must generate an exports object when
                // targeting non-ES6 formats. Note that the IIFE format only needs this
                // when the global name is present, since that's the only way the exports
                // can actually be observed externally.
                if ast_flags.uses_export_keyword {
                    ast_flags.uses_exports_ref = true;
                    ast_flags_list[entry_point.get() as usize] = ast_flags;
                    meta_flags_list[entry_point.get() as usize].force_include_exports_for_entry_point = true;
                }
            }
        }

        Ok(())
    }

    pub fn compute_data_for_source_map(&mut self, reachable: &[Index::Int]) {
        debug_assert!(self.options.source_maps != SourceMapOption::None);
        self.source_maps.line_offset_wait_group = WaitGroup::init_with_count(reachable.len());
        self.source_maps.quoted_contents_wait_group = WaitGroup::init_with_count(reachable.len());
        // TODO(port): arena alloc of task arrays
        self.source_maps.line_offset_tasks = vec![SourceMapDataTask::default(); reachable.len()].into_boxed_slice();
        self.source_maps.quoted_contents_tasks = vec![SourceMapDataTask::default(); reachable.len()].into_boxed_slice();

        let mut batch = ThreadPoolLib::Batch::default();
        let mut second_batch = ThreadPoolLib::Batch::default();
        debug_assert_eq!(reachable.len(), self.source_maps.line_offset_tasks.len());
        debug_assert_eq!(reachable.len(), self.source_maps.quoted_contents_tasks.len());
        for ((source_index, line_offset), quoted) in reachable
            .iter()
            .zip(self.source_maps.line_offset_tasks.iter_mut())
            .zip(self.source_maps.quoted_contents_tasks.iter_mut())
        {
            *line_offset = SourceMapDataTask {
                ctx: self,
                source_index: *source_index,
                thread_task: ThreadPoolLib::Task { callback: SourceMapDataTask::run_line_offset },
            };
            *quoted = SourceMapDataTask {
                ctx: self,
                source_index: *source_index,
                thread_task: ThreadPoolLib::Task { callback: SourceMapDataTask::run_quoted_source_contents },
            };
            batch.push(ThreadPoolLib::Batch::from(&mut line_offset.thread_task));
            second_batch.push(ThreadPoolLib::Batch::from(&mut quoted.thread_task));
        }

        // line offsets block sooner and are faster to compute, so we should schedule those first
        batch.push(second_batch);

        self.schedule_tasks(batch);
    }

    pub fn schedule_tasks(&self, batch: ThreadPoolLib::Batch) {
        let _ = self.pending_task_count.fetch_add(u32::try_from(batch.len).unwrap(), Ordering::Relaxed);
        // SAFETY: parse_graph backref valid for self lifetime
        unsafe { (*self.parse_graph).pool.worker_pool.schedule(batch) };
    }

    pub fn mark_pending_task_done(&self) {
        let _ = self.pending_task_count.fetch_sub(1, Ordering::Relaxed);
    }

    fn process_html_import_files(&mut self) {
        // SAFETY: parse_graph backref valid for self lifetime
        let parse_graph = unsafe { &mut *self.parse_graph };
        let server_source_indices = &parse_graph.html_imports.server_source_indices;
        let html_source_indices = &mut parse_graph.html_imports.html_source_indices;
        if server_source_indices.len > 0 {
            let input_files: &[Source] = parse_graph.input_files.items_source();
            let map = parse_graph.path_to_source_index_map(Target::Browser);
            let parts: &[BabyList<js_ast::Part>] = self.graph.ast.items_parts();
            let actual_ref = self.graph.runtime_function(b"__jsonParse");

            for &html_import in server_source_indices.slice() {
                let source = &input_files[html_import as usize];
                let source_index = map.get(&source.path.text).unwrap_or_else(|| {
                    panic!("Assertion failed: HTML import file not found in pathToSourceIndexMap");
                });

                html_source_indices.append(self.allocator(), *source_index).expect("OOM");

                // S.LazyExport is a call to __jsonParse.
                // TODO(port): this deep field-chain pattern matching may need restructuring
                let original_ref = parts[html_import as usize]
                    .at(1)
                    .stmts[0]
                    .data
                    .s_lazy_export()
                    .e_call()
                    .target
                    .data
                    .e_import_identifier()
                    .r#ref;

                // Make the __jsonParse in that file point to the __jsonParse in the runtime chunk.
                self.graph.symbols.get_mut(original_ref).unwrap().link = actual_ref;

                // When --splitting is enabled, we have to make sure we import the __jsonParse function.
                self.graph.generate_symbol_import_and_use(
                    html_import,
                    Index::part(1).get(),
                    actual_ref,
                    1,
                    Index::runtime(),
                ).expect("OOM");
            }
        }
    }

    #[inline(never)]
    pub fn link(
        &mut self,
        bundle: &mut BundleV2,
        entry_points: &mut [Index],
        server_component_boundaries: ServerComponentBoundary::List,
        reachable: &mut [Index],
    ) -> Result<Box<[Chunk]>, LinkError> {
        self.load(bundle, entry_points, server_component_boundaries, reachable)?;

        if self.options.source_maps != SourceMapOption::None {
            // SAFETY: Index is repr(transparent) u32 wrapper; reinterpret slice
            let reachable_ints: &[Index::Int] = unsafe {
                core::slice::from_raw_parts(reachable.as_ptr().cast(), reachable.len())
            };
            self.compute_data_for_source_map(reachable_ints);
        }

        self.process_html_import_files();

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        // Validate top-level await for all files first.
        if bundle.has_any_top_level_await_modules {
            // SAFETY: parse_graph backref
            let parse_graph = unsafe { &mut *self.parse_graph };
            let import_records_list: &[ImportRecord::List] = self.graph.ast.items_import_records();
            let tla_keywords = parse_graph.ast.items_top_level_await_keyword();
            let tla_checks = parse_graph.ast.items_tla_check_mut();
            let input_files = parse_graph.input_files.items_source();
            let flags: &mut [JSMeta::Flags] = self.graph.meta.items_flags_mut();
            let css_asts: &[Option<*mut css::BundlerStyleSheet>] = self.graph.ast.items_css();

            // Process all files in source index order, like esbuild does
            let mut source_index: u32 = 0;
            while (source_index as usize) < self.graph.files.len() {
                let advance = || source_index += 1;
                // Skip runtime
                if source_index == Index::runtime().get() {
                    source_index += 1;
                    continue;
                }

                // Skip if not a JavaScript AST
                if source_index as usize >= import_records_list.len() {
                    source_index += 1;
                    continue;
                }

                // Skip CSS files
                if css_asts[source_index as usize].is_some() {
                    source_index += 1;
                    continue;
                }

                let import_records = import_records_list[source_index as usize].slice();

                let _ = self.validate_tla(source_index, tla_keywords, tla_checks, input_files, import_records, flags, import_records_list)?;

                source_index += 1;
                let _ = advance; // PORT NOTE: reshaped for borrowck — Zig used `defer source_index += 1` semantics via while-postfix
            }

            // after validation propagate async through all importers.
            self.graph.propagate_async_dependencies()?;
        }

        self.scan_imports_and_exports()?;

        // Stop now if there were errors
        if self.log.has_errors() {
            return Err(LinkError::BuildFailed);
        }

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        self.tree_shaking_and_code_splitting()?;

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        let chunks = self.compute_chunks(bundle.unique_key)?;

        if self.log.has_errors() {
            return Err(LinkError::BuildFailed);
        }

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        self.compute_cross_chunk_dependencies(&chunks)?;

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        self.graph.symbols.follow_all();

        Ok(chunks)
    }

    pub fn check_for_memory_corruption(&self) {
        // For this to work, you need mimalloc's debug build enabled.
        //    make mimalloc-debug
        // SAFETY: parse_graph backref
        unsafe { (*self.parse_graph).heap.help_catch_memory_issues() };
    }

    pub fn generate_named_export_in_file(
        &mut self,
        source_index: Index::Int,
        module_ref: Ref,
        name: &[u8],
        alias: &[u8],
    ) -> Result<(Ref, u32), AllocError> {
        let r#ref = self.graph.generate_new_symbol(source_index, Symbol::Kind::Other, name);
        let part_index = self.graph.add_part_to_file(source_index, Part {
            declared_symbols: js_ast::DeclaredSymbol::List::from_slice(
                self.allocator(),
                &[js_ast::DeclaredSymbol { r#ref, is_top_level: true }],
            )?,
            can_be_removed_if_unused: true,
            ..Default::default()
        })?;

        self.graph.generate_symbol_import_and_use(source_index, part_index, module_ref, 1, Index::init(source_index))?;
        let top_level = &mut self.graph.meta.items_top_level_symbol_to_parts_overlay_mut()[source_index as usize];
        // TODO(port): arena allocation of single-element slice
        let mut parts_list = self.allocator().alloc_slice_copy(&[part_index]);

        top_level.put(self.allocator(), r#ref, BabyList::<u32>::from_owned_slice(parts_list))?;

        let resolved_exports = &mut self.graph.meta.items_resolved_exports_mut()[source_index as usize];
        resolved_exports.put(self.allocator(), alias, ExportData {
            data: ImportTracker {
                source_index: Index::init(source_index),
                import_ref: r#ref,
                ..Default::default()
            },
            ..Default::default()
        })?;
        Ok((r#ref, part_index))
    }

    pub fn scan_css_imports(
        &self,
        file_source_index: u32,
        file_import_records: &mut [ImportRecord],
        // slices from Graph
        css_asts: &[Option<*mut css::BundlerStyleSheet>],
        sources: &[Source],
        loaders: &[Loader],
        log: &mut Log,
    ) -> ScanCssImportsResult {
        for record in file_import_records.iter_mut() {
            if record.source_index.is_valid() {
                // Other file is not CSS
                if css_asts[record.source_index.get() as usize].is_none() {
                    let source = &sources[file_source_index as usize];
                    let loader = loaders[record.source_index.get() as usize];

                    match loader {
                        Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx | Loader::Napi
                        | Loader::Sqlite | Loader::Json | Loader::Jsonc | Loader::Json5
                        | Loader::Yaml | Loader::Html | Loader::SqliteEmbedded | Loader::Md => {
                            log.add_error_fmt(
                                source,
                                record.range.loc,
                                self.allocator(),
                                format_args!(
                                    "Cannot import a \".{}\" file into a CSS file",
                                    <&'static str>::from(loader),
                                ),
                            ).expect("OOM");
                        }
                        Loader::Css | Loader::File | Loader::Toml | Loader::Wasm
                        | Loader::Base64 | Loader::Dataurl | Loader::Text | Loader::Bunsh => {}
                    }
                }
            }
        }
        if log.errors > 0 { ScanCssImportsResult::Errors } else { ScanCssImportsResult::Ok }
    }

    pub fn get_source(&self, index: usize) -> &Source {
        // SAFETY: parse_graph backref
        unsafe { &(*self.parse_graph).input_files.items_source()[index] }
    }

    pub fn tree_shaking_and_code_splitting(&mut self) -> Result<(), AllocError> {
        let _trace = bun::perf::trace("Bundler.treeShakingAndCodeSplitting");

        // PORT NOTE: reshaped for borrowck — these slices alias into self.graph; Zig held them
        // simultaneously. In Rust we may need to refetch per-call or use raw pointers.
        let parts = self.graph.ast.items_parts_mut();
        let import_records = self.graph.ast.items_import_records();
        let css_reprs = self.graph.ast.items_css();
        // SAFETY: parse_graph backref
        let side_effects = unsafe { (*self.parse_graph).input_files.items_side_effects() };
        let entry_point_kinds = self.graph.files.items_entry_point_kind();
        let entry_points = self.graph.entry_points.items_source_index();
        let distances = self.graph.files.items_distance_from_entry_point_mut();

        {
            let _trace2 = bun::perf::trace("Bundler.markFileLiveForTreeShaking");

            // Tree shaking: Each entry point marks all files reachable from itself
            for &entry_point in entry_points {
                self.mark_file_live_for_tree_shaking(
                    entry_point,
                    side_effects,
                    parts,
                    import_records,
                    entry_point_kinds,
                    css_reprs,
                );
            }
        }

        {
            let _trace2 = bun::perf::trace("Bundler.markFileReachableForCodeSplitting");

            let file_entry_bits: &mut [AutoBitSet] = self.graph.files.items_entry_bits_mut();
            // AutoBitSet needs to be initialized if it is dynamic
            if AutoBitSet::needs_dynamic(entry_points.len()) {
                for bits in file_entry_bits.iter_mut() {
                    *bits = AutoBitSet::init_empty(self.allocator(), entry_points.len())?;
                }
            } else if !file_entry_bits.is_empty() {
                // assert that the tag is correct
                debug_assert!(matches!(file_entry_bits[0], AutoBitSet::Static(_)));
            }

            // Code splitting: Determine which entry points can reach which files. This
            // has to happen after tree shaking because there is an implicit dependency
            // between live parts within the same file. All liveness has to be computed
            // first before determining which entry points can reach which files.
            for (i, &entry_point) in entry_points.iter().enumerate() {
                self.mark_file_reachable_for_code_splitting(
                    entry_point,
                    i,
                    distances,
                    0,
                    parts,
                    import_records,
                    file_entry_bits,
                    css_reprs,
                );
            }
        }

        Ok(())
    }

    pub fn generate_chunk(ctx: GenerateChunkCtx, chunk: &mut Chunk, chunk_index: usize) {
        // SAFETY: ctx.c points into BundleV2.linker; container_of pattern
        let bundle = unsafe {
            &mut *((ctx.c as *mut LinkerContext as *mut u8)
                .sub(offset_of!(BundleV2, linker))
                .cast::<BundleV2>())
        };
        let worker = ThreadPool::Worker::get(bundle);
        let _guard = scopeguard::guard((), |_| worker.unget());
        match &chunk.content {
            Chunk::Content::Javascript(_) => {
                if let Err(err) = post_process_js_chunk(ctx, worker, chunk, chunk_index) {
                    Output::panic(format_args!("TODO: handle error: {}", err.name()));
                }
            }
            Chunk::Content::Css(_) => {
                if let Err(err) = post_process_css_chunk(ctx, worker, chunk) {
                    Output::panic(format_args!("TODO: handle error: {}", err.name()));
                }
            }
            Chunk::Content::Html(_) => {
                if let Err(err) = post_process_html_chunk(ctx, worker, chunk) {
                    Output::panic(format_args!("TODO: handle error: {}", err.name()));
                }
            }
        }
    }

    pub fn generate_js_renamer(ctx: GenerateChunkCtx, chunk: &mut Chunk, chunk_index: usize) {
        // SAFETY: container_of pattern, ctx.c is &mut BundleV2.linker
        let bundle = unsafe {
            &mut *((ctx.c as *mut LinkerContext as *mut u8)
                .sub(offset_of!(BundleV2, linker))
                .cast::<BundleV2>())
        };
        let worker = ThreadPool::Worker::get(bundle);
        let _guard = scopeguard::guard((), |_| worker.unget());
        match &chunk.content {
            Chunk::Content::Javascript(_) => Self::generate_js_renamer_(ctx, worker, chunk, chunk_index),
            Chunk::Content::Css(_) => {}
            Chunk::Content::Html(_) => {}
        }
    }

    fn generate_js_renamer_(ctx: GenerateChunkCtx, worker: &mut ThreadPool::Worker, chunk: &mut Chunk, chunk_index: usize) {
        let _ = chunk_index;
        chunk.renamer = ctx.c.rename_symbols_in_chunk(
            worker.allocator,
            chunk,
            &chunk.content.javascript().files_in_chunk_order,
        ).expect("TODO: handle error");
    }

    pub fn generate_source_map_for_chunk(
        &mut self,
        isolated_hash: u64,
        worker: &mut ThreadPool::Worker,
        results: MultiArrayList<CompileResultForSourceMap>,
        chunk_abs_dir: &[u8],
        can_have_shifts: bool,
    ) -> Result<SourceMapPieces, BunError> {
        let _trace = bun::perf::trace("Bundler.generateSourceMapForChunk");

        let mut j = StringJoiner { allocator: worker.allocator, ..Default::default() };

        // SAFETY: parse_graph backref
        let sources = unsafe { (*self.parse_graph).input_files.items_source() };
        let quoted_source_map_contents = self.graph.files.items_quoted_source_contents();

        // Entries in `results` do not 1:1 map to source files, the mapping
        // is actually many to one, where a source file can have multiple chunks
        // in the sourcemap.
        //
        // This hashmap is going to map:
        //    `source_index` (per compilation) in a chunk
        //   -->
        //    Which source index in the generated sourcemap, referred to
        //    as the "mapping source index" within this function to be distinct.
        let mut source_id_map: ArrayHashMap<u32, i32> = ArrayHashMap::new();
        // PERF(port): was arena bulk-free — source_id_map drops at scope exit

        let source_indices = results.items_source_index();

        j.push_static(b"{\n  \"version\": 3,\n  \"sources\": [");
        if !source_indices.is_empty() {
            {
                let index = source_indices[0];
                let mut path = sources[index as usize].path.clone();
                source_id_map.put_no_clobber(index, 0)?;

                if path.is_file() {
                    let rel_path = bun_paths::relative_alloc(worker.allocator, chunk_abs_dir, &path.text)?;
                    path.pretty = rel_path;
                }

                let mut quote_buf = MutableString::init(worker.allocator, path.pretty.len() + 2)?;
                js_printer::quote_for_json(&path.pretty, &mut quote_buf, false)?;
                j.push_static(quote_buf.slice()); // freed by arena
            }

            let mut next_mapping_source_index: i32 = 1;
            for &index in &source_indices[1..] {
                let gop = source_id_map.get_or_put(index)?;
                if gop.found_existing {
                    continue;
                }

                *gop.value_ptr = next_mapping_source_index;
                next_mapping_source_index += 1;

                let mut path = sources[index as usize].path.clone();

                if path.is_file() {
                    let rel_path = bun_paths::relative_alloc(worker.allocator, chunk_abs_dir, &path.text)?;
                    path.pretty = rel_path;
                }

                let mut quote_buf = MutableString::init(worker.allocator, path.pretty.len() + ", ".len() + 2)?;
                quote_buf.append_assume_capacity(b", "); // PERF(port): was assume_capacity
                js_printer::quote_for_json(&path.pretty, &mut quote_buf, false)?;
                j.push_static(quote_buf.slice()); // freed by arena
            }
        }

        j.push_static(b"],\n  \"sourcesContent\": [");

        let source_indices_for_contents = source_id_map.keys();
        if !source_indices_for_contents.is_empty() {
            j.push_static(b"\n    ");
            j.push_static(
                quoted_source_map_contents[source_indices_for_contents[0] as usize].get().unwrap_or(b""),
            );

            for &index in &source_indices_for_contents[1..] {
                j.push_static(b",\n    ");
                j.push_static(quoted_source_map_contents[index as usize].get().unwrap_or(b""));
            }
        }
        j.push_static(b"\n  ],\n  \"mappings\": \"");

        let mapping_start = j.len;
        let mut prev_end_state = SourceMapState::default();
        let mut prev_column_offset: i32 = 0;
        let source_map_chunks = results.items_source_map_chunk();
        let offsets = results.items_generated_offset();
        debug_assert_eq!(source_map_chunks.len(), offsets.len());
        debug_assert_eq!(source_map_chunks.len(), source_indices.len());
        for ((chunk, offset), &current_source_index) in source_map_chunks.iter().zip(offsets.iter()).zip(source_indices.iter()) {
            let mapping_source_index = *source_id_map.get(&current_source_index)
                .expect("unreachable"); // the pass above during printing of "sources" must add the index

            let mut start_state = SourceMapState {
                source_index: mapping_source_index,
                generated_line: offset.lines.zero_based(),
                generated_column: offset.columns.zero_based(),
                ..Default::default()
            };

            if offset.lines.zero_based() == 0 {
                start_state.generated_column += prev_column_offset;
            }

            SourceMap::append_source_map_chunk(&mut j, worker.allocator, prev_end_state, start_state, &chunk.buffer.list)?;

            prev_end_state = chunk.end_state;
            prev_end_state.source_index = mapping_source_index;
            prev_column_offset = chunk.final_generated_column;

            if prev_end_state.generated_line == 0 {
                prev_end_state.generated_column += start_state.generated_column;
                prev_column_offset += start_state.generated_column;
            }
        }
        let mapping_end = j.len;

        if FeatureFlags::SOURCE_MAP_DEBUG_ID {
            j.push_static(b"\",\n  \"debugId\": \"");
            // TODO(port): allocPrint into arena — using Vec<u8> + write!
            let mut buf = Vec::new();
            use std::io::Write;
            write!(&mut buf, "{}", DebugIDFormatter { id: isolated_hash }).unwrap();
            j.push(worker.allocator.alloc_slice_copy(&buf), worker.allocator);
            j.push_static(b"\",\n  \"names\": []\n}");
        } else {
            j.push_static(b"\",\n  \"names\": []\n}");
        }

        let done = j.done(worker.allocator)?;
        debug_assert!(done[0] == b'{');

        let mut pieces = SourceMapPieces::init(worker.allocator);
        if can_have_shifts {
            pieces.prefix.extend_from_slice(&done[0..mapping_start]);
            pieces.mappings.extend_from_slice(&done[mapping_start..mapping_end]);
            pieces.suffix.extend_from_slice(&done[mapping_end..]);
        } else {
            pieces.prefix.extend_from_slice(&done);
        }

        Ok(pieces)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ScanCssImportsResult {
    Ok,
    Errors,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum LinkError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("build failed")]
    BuildFailed,
    #[error("import resolution failed")]
    ImportResolutionFailed,
}

impl From<AllocError> for LinkError {
    fn from(_: AllocError) -> Self { LinkError::OutOfMemory }
}
impl From<BunError> for LinkError {
    fn from(_: BunError) -> Self {
        // TODO(port): narrow error set — Zig's `try this.load()` is `!void` (anyerror)
        LinkError::BuildFailed
    }
}
impl From<LinkError> for BunError {
    fn from(e: LinkError) -> Self { BunError::from_name(<&'static str>::from(e)) }
}

pub struct LinkerOptions {
    pub generate_bytecode_cache: bool,
    pub output_format: Format,
    pub ignore_dce_annotations: bool,
    pub emit_dce_annotations: bool,
    pub tree_shaking: bool,
    pub minify_whitespace: bool,
    pub minify_syntax: bool,
    pub minify_identifiers: bool,
    pub banner: &'static [u8],
    pub footer: &'static [u8],
    pub css_chunking: bool,
    pub compile_to_standalone_html: bool,
    pub source_maps: SourceMapOption,
    pub target: Target,
    pub compile: bool,
    pub metafile: bool,
    /// Path to write JSON metafile (for Bun.build API)
    pub metafile_json_path: &'static [u8],
    /// Path to write markdown metafile (for Bun.build API)
    pub metafile_markdown_path: &'static [u8],

    pub mode: LinkerOptionsMode,

    pub public_path: &'static [u8],
}

impl Default for LinkerOptions {
    fn default() -> Self {
        Self {
            generate_bytecode_cache: false,
            output_format: Format::Esm,
            ignore_dce_annotations: false,
            emit_dce_annotations: true,
            tree_shaking: true,
            minify_whitespace: false,
            minify_syntax: false,
            minify_identifiers: false,
            banner: b"",
            footer: b"",
            css_chunking: false,
            compile_to_standalone_html: false,
            source_maps: SourceMapOption::None,
            target: Target::Browser,
            compile: false,
            metafile: false,
            metafile_json_path: b"",
            metafile_markdown_path: b"",
            mode: LinkerOptionsMode::Bundle,
            public_path: b"",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LinkerOptionsMode {
    Passthrough,
    Bundle,
}

#[derive(Default)]
pub struct SourceMapData {
    pub line_offset_wait_group: WaitGroup,
    pub line_offset_tasks: Box<[SourceMapDataTask]>,

    pub quoted_contents_wait_group: WaitGroup,
    pub quoted_contents_tasks: Box<[SourceMapDataTask]>,
}

pub struct SourceMapDataTask {
    pub ctx: *mut LinkerContext<'static>, // BACKREF — task stored in ctx.source_maps.*_tasks
    pub source_index: Index::Int,
    pub thread_task: ThreadPoolLib::Task,
}

impl Default for SourceMapDataTask {
    fn default() -> Self {
        Self {
            ctx: core::ptr::null_mut(),
            source_index: 0,
            thread_task: ThreadPoolLib::Task { callback: Self::run_line_offset },
        }
    }
}

impl SourceMapDataTask {
    pub fn run_line_offset(thread_task: *mut ThreadPoolLib::Task) {
        // SAFETY: thread_task points to SourceMapDataTask.thread_task
        let task: &mut SourceMapDataTask = unsafe {
            &mut *((thread_task as *mut u8)
                .sub(offset_of!(SourceMapDataTask, thread_task))
                .cast::<SourceMapDataTask>())
        };
        let _guard = scopeguard::guard((), |_| {
            // SAFETY: ctx backref valid for task lifetime
            unsafe {
                (*task.ctx).mark_pending_task_done();
                (*task.ctx).source_maps.line_offset_wait_group.finish();
            }
        });

        // SAFETY: ctx is &mut BundleV2.linker; container_of
        let bundle = unsafe {
            &mut *((task.ctx as *mut u8).sub(offset_of!(BundleV2, linker)).cast::<BundleV2>())
        };
        let worker = ThreadPool::Worker::get(bundle);
        let _wguard = scopeguard::guard((), |_| worker.unget());
        // SAFETY: ctx backref
        SourceMapData::compute_line_offsets(unsafe { &mut *task.ctx }, worker.allocator, task.source_index);
    }

    pub fn run_quoted_source_contents(thread_task: *mut ThreadPoolLib::Task) {
        // SAFETY: thread_task points to SourceMapDataTask.thread_task
        let task: &mut SourceMapDataTask = unsafe {
            &mut *((thread_task as *mut u8)
                .sub(offset_of!(SourceMapDataTask, thread_task))
                .cast::<SourceMapDataTask>())
        };
        let _guard = scopeguard::guard((), |_| {
            // SAFETY: ctx backref
            unsafe {
                (*task.ctx).mark_pending_task_done();
                (*task.ctx).source_maps.quoted_contents_wait_group.finish();
            }
        });

        // SAFETY: container_of
        let bundle = unsafe {
            &mut *((task.ctx as *mut u8).sub(offset_of!(BundleV2, linker)).cast::<BundleV2>())
        };
        let worker = ThreadPool::Worker::get(bundle);
        let _wguard = scopeguard::guard((), |_| worker.unget());

        // Use the default allocator when using DevServer and the file
        // was generated. This will be preserved so that remapping
        // stack traces can show the source code, even after incremental
        // rebuilds occur.
        let alloc = if let Some(dev) = worker.ctx.transpiler.options.dev_server.as_ref() {
            dev.allocator()
        } else {
            worker.allocator
        };

        // SAFETY: ctx backref
        SourceMapData::compute_quoted_source_contents(unsafe { &mut *task.ctx }, alloc, task.source_index);
    }
}

impl SourceMapData {
    pub fn compute_line_offsets(this: &mut LinkerContext, alloc: &Bump, source_index: Index::Int) {
        debug!("Computing LineOffsetTable: {}", source_index);
        let line_offset_table: &mut LineOffsetTable::List =
            &mut this.graph.files.items_line_offset_table_mut()[source_index as usize];

        // SAFETY: parse_graph backref
        let parse_graph = unsafe { &*this.parse_graph };
        let source: &Source = &parse_graph.input_files.items_source()[source_index as usize];
        let loader: Loader = parse_graph.input_files.items_loader()[source_index as usize];

        if !loader.can_have_source_map() {
            // This is not a file which we support generating source maps for
            *line_offset_table = Default::default();
            return;
        }

        let approximate_line_count = this.graph.ast.items_approximate_newline_count()[source_index as usize];

        *line_offset_table = LineOffsetTable::generate(
            alloc,
            &source.contents,
            // We don't support sourcemaps for source files with more than 2^31 lines
            (approximate_line_count as u32 & 0x7FFF_FFFF) as i32, // @intCast(@truncate to u31)
        );
    }

    pub fn compute_quoted_source_contents(this: &mut LinkerContext, _alloc: &Bump, source_index: Index::Int) {
        debug!("Computing Quoted Source Contents: {}", source_index);
        let quoted_source_contents = &mut this.graph.files.items_quoted_source_contents_mut()[source_index as usize];
        quoted_source_contents.reset();

        // SAFETY: parse_graph backref
        let parse_graph = unsafe { &*this.parse_graph };
        let loader: Loader = parse_graph.input_files.items_loader()[source_index as usize];
        if !loader.can_have_source_map() {
            return;
        }

        let source: &Source = &parse_graph.input_files.items_source()[source_index as usize];
        let mut mutable = MutableString::init_empty();
        js_printer::quote_for_json(&source.contents, &mut mutable, false).expect("OOM");
        let mutable_owned = mutable.to_default_owned();
        *quoted_source_contents = mutable_owned.to_optional();
    }
}

#[derive(Clone)]
struct MatchImport {
    alias: *const [u8], // TODO(port): lifetime — Zig string borrowed from AST arena
    kind: MatchImportKind,
    namespace_ref: Ref,
    source_index: u32,
    name_loc: Loc, // Optional, goes with sourceIndex, ignore if zero,
    other_source_index: u32,
    other_name_loc: Loc, // Optional, goes with otherSourceIndex, ignore if zero,
    r#ref: Ref,
}

impl Default for MatchImport {
    fn default() -> Self {
        Self {
            alias: b"" as *const [u8],
            kind: MatchImportKind::default(),
            namespace_ref: Ref::default(),
            source_index: 0,
            name_loc: Loc::default(),
            other_source_index: 0,
            other_name_loc: Loc::default(),
            r#ref: Ref::default(),
        }
    }
}

#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum MatchImportKind {
    /// The import is either external or undefined
    #[default]
    Ignore,
    /// "sourceIndex" and "ref" are in use
    Normal,
    /// "namespaceRef" and "alias" are in use
    Namespace,
    /// Both "normal" and "namespace"
    NormalAndNamespace,
    /// The import could not be evaluated due to a cycle
    Cycle,
    /// The import is missing but came from a TypeScript file
    ProbablyTypescriptType,
    /// The import resolved to multiple symbols via "export * from"
    Ambiguous,
}

pub struct ChunkMeta {
    pub imports: ChunkMetaMap,
    pub exports: ChunkMetaMap,
    pub dynamic_imports: ArrayHashMap<Index::Int, ()>,
}

pub type ChunkMetaMap = ArrayHashMap<Ref, ()>;

pub struct GenerateChunkCtx<'a> {
    pub c: &'a mut LinkerContext<'a>,
    pub chunks: &'a mut [Chunk],
    pub chunk: &'a mut Chunk,
}

pub struct PendingPartRange<'a> {
    pub part_range: PartRange,
    pub task: ThreadPoolLib::Task,
    pub ctx: &'a GenerateChunkCtx<'a>,
    pub i: u32,
}

struct SubstituteChunkFinalPathResult {
    j: StringJoiner,
    shifts: Box<[SourceMapShifts]>,
}

impl<'a> LinkerContext<'a> {
    pub fn generate_isolated_hash(&mut self, chunk: &Chunk) -> u64 {
        let _trace = bun::perf::trace("Bundler.generateIsolatedHash");

        let mut hasher = ContentHasher::default();

        // Mix the file names and part ranges of all of the files in this chunk into
        // the hash. Objects that appear identical but that live in separate files or
        // that live in separate parts in the same file must not be merged. This only
        // needs to be done for JavaScript files, not CSS files.
        if let Chunk::Content::Javascript(js) = &chunk.content {
            // SAFETY: parse_graph backref
            let sources = unsafe { (*self.parse_graph).input_files.items_source_mut() };
            for part_range in js.parts_in_chunk_in_order.iter() {
                let source: &mut Source = &mut sources[part_range.source_index.get() as usize];

                let file_path: &[u8] = 'brk: {
                    if source.path.is_file() {
                        // Use the pretty path as the file name since it should be platform-
                        // independent (relative paths and the "/" path separator)
                        if source.path.text.as_ptr() == source.path.pretty.as_ptr() {
                            source.path = self.path_with_pretty_initialized(source.path.clone()).expect("OOM");
                        }
                        source.path.assert_pretty_is_valid();

                        break 'brk &source.path.pretty;
                    } else {
                        // If this isn't in the "file" namespace, just use the full path text
                        // verbatim. This could be a source of cross-platform differences if
                        // plugins are storing platform-specific information in here, but then
                        // that problem isn't caused by esbuild itself.
                        break 'brk &source.path.text;
                    }
                };

                // Include the path namespace in the hash
                hasher.write(&source.path.namespace);

                // Then include the file path
                hasher.write(file_path);

                // Then include the part range
                hasher.write_ints(&[
                    part_range.part_index_begin,
                    part_range.part_index_end,
                ]);
            }
        }

        // Hash the output path template as part of the content hash because we want
        // any import to be considered different if the import's output path has changed.
        hasher.write(&chunk.template.data);

        let public_path: &[u8] = if chunk.flags.is_browser_chunk_from_server_build {
            // SAFETY: self is BundleV2.linker; container_of
            let bundle = unsafe {
                &mut *((self as *mut LinkerContext as *mut u8)
                    .sub(offset_of!(BundleV2, linker))
                    .cast::<BundleV2>())
            };
            &bundle.transpiler_for_target(Target::Browser).options.public_path
        } else {
            &self.options.public_path
        };

        // Also hash the public path. If provided, this is used whenever files
        // reference each other such as cross-chunk imports, asset file references,
        // and source map comments. We always include the hash in all chunks instead
        // of trying to figure out which chunks will include the public path for
        // simplicity and for robustness to code changes in the future.
        if !public_path.is_empty() {
            hasher.write(public_path);
        }

        // Include the generated output content in the hash. This excludes the
        // randomly-generated import paths (the unique keys) and only includes the
        // data in the spans between them.
        if let Chunk::IntermediateOutput::Pieces(pieces) = &chunk.intermediate_output {
            for piece in pieces.slice() {
                hasher.write(piece.data());
            }
        } else {
            let mut el = chunk.intermediate_output.joiner().head;
            while let Some(e) = el {
                hasher.write(&e.slice);
                el = e.next;
            }
        }

        // Also include the source map data in the hash. The source map is named the
        // same name as the chunk name for ease of discovery. So we want the hash to
        // change if the source map data changes even if the chunk data doesn't change.
        // Otherwise the output path for the source map wouldn't change and the source
        // map wouldn't end up being updated.
        //
        // Note that this means the contents of all input files are included in the
        // hash because of "sourcesContent", so changing a comment in an input file
        // can now change the hash of the output file. This only happens when you
        // have source maps enabled (and "sourcesContent", which is on by default).
        //
        // The generated positions in the mappings here are in the output content
        // *before* the final paths have been substituted. This may seem weird.
        // However, I think this shouldn't cause issues because a) the unique key
        // values are all always the same length so the offsets are deterministic
        // and b) the final paths will be folded into the final hash later.
        hasher.write(&chunk.output_source_map.prefix);
        hasher.write(&chunk.output_source_map.mappings);
        hasher.write(&chunk.output_source_map.suffix);

        hasher.digest()
    }

    pub fn validate_tla(
        &mut self,
        source_index: Index::Int,
        tla_keywords: &[Range],
        tla_checks: &mut [TlaCheck],
        input_files: &[Source],
        import_records: &[ImportRecord],
        meta_flags: &mut [JSMeta::Flags],
        ast_import_records: &[BabyList<ImportRecord>],
    ) -> Result<TlaCheck, AllocError> {
        // PORT NOTE: reshaped for borrowck — Zig held &mut tla_checks[source_index] across recursive
        // calls that also mutate tla_checks. We re-index after each recursion.
        if tla_checks[source_index as usize].depth == 0 {
            tla_checks[source_index as usize].depth = 1;
            if tla_keywords[source_index as usize].len > 0 {
                tla_checks[source_index as usize].parent = source_index;
            }

            for (import_record_index, record) in import_records.iter().enumerate() {
                if Index::is_valid(record.source_index) && (record.kind == ImportKind::Require || record.kind == ImportKind::Stmt) {
                    let parent = self.validate_tla(
                        record.source_index.get(),
                        tla_keywords,
                        tla_checks,
                        input_files,
                        ast_import_records[record.source_index.get() as usize].slice(),
                        meta_flags,
                        ast_import_records,
                    )?;
                    if Index::is_invalid(Index::init(parent.parent)) {
                        continue;
                    }

                    let result_tla_check = &mut tla_checks[source_index as usize];

                    // Follow any import chains
                    if record.kind == ImportKind::Stmt
                        && (Index::is_invalid(Index::init(result_tla_check.parent)) || parent.depth < result_tla_check.depth)
                    {
                        result_tla_check.depth = parent.depth + 1;
                        result_tla_check.parent = record.source_index.get();
                        result_tla_check.import_record_index = u32::try_from(import_record_index).unwrap();
                        continue;
                    }

                    // Require of a top-level await chain is forbidden
                    if record.kind == ImportKind::Require {
                        let mut notes: Vec<Data> = Vec::new();

                        let mut tla_pretty_path: &[u8] = b"";
                        let mut other_source_index = record.source_index.get();

                        // Build up a chain of notes for all of the imports
                        loop {
                            let parent_result_tla_keyword = tla_keywords[other_source_index as usize];
                            let parent_tla_check = tla_checks[other_source_index as usize];
                            let parent_source_index = other_source_index;

                            if parent_result_tla_keyword.len > 0 {
                                let source = &input_files[other_source_index as usize];
                                tla_pretty_path = &source.path.pretty;
                                let mut text = Vec::new();
                                use std::io::Write;
                                write!(&mut text, "The top-level await in {} is here:", bstr::BStr::new(tla_pretty_path)).unwrap();
                                notes.push(Data {
                                    text: text.into_boxed_slice(),
                                    location: Logger::Location::init_or_null(source, parent_result_tla_keyword),
                                    ..Default::default()
                                });
                                break;
                            }

                            if !Index::is_valid(Index::init(parent_tla_check.parent)) {
                                notes.push(Data {
                                    text: b"unexpected invalid index".to_vec().into_boxed_slice(),
                                    ..Default::default()
                                });
                                break;
                            }

                            other_source_index = parent_tla_check.parent;

                            let mut text = Vec::new();
                            use std::io::Write;
                            write!(
                                &mut text,
                                "The file {} imports the file {} here:",
                                bstr::BStr::new(&input_files[parent_source_index as usize].path.pretty),
                                bstr::BStr::new(&input_files[other_source_index as usize].path.pretty),
                            ).unwrap();
                            notes.push(Data {
                                text: text.into_boxed_slice(),
                                location: Logger::Location::init_or_null(
                                    &input_files[parent_source_index as usize],
                                    ast_import_records[parent_source_index as usize].slice()
                                        [tla_checks[parent_source_index as usize].import_record_index as usize]
                                        .range,
                                ),
                                ..Default::default()
                            });
                        }

                        let source: &Source = &input_files[source_index as usize];
                        let imported_pretty_path = &source.path.pretty;
                        let mut text = Vec::new();
                        use std::io::Write;
                        if imported_pretty_path[..] == tla_pretty_path[..] {
                            write!(&mut text, "This require call is not allowed because the imported file \"{}\" contains a top-level await", bstr::BStr::new(imported_pretty_path)).unwrap();
                        } else {
                            write!(&mut text, "This require call is not allowed because the transitive dependency \"{}\" contains a top-level await", bstr::BStr::new(tla_pretty_path)).unwrap();
                        }

                        self.log.add_range_error_with_notes(source, record.range, text.into_boxed_slice(), notes)?;
                    }
                }
            }

            // Make sure that if we wrap this module in a closure, the closure is also
            // async. This happens when you call "import()" on this module and code
            // splitting is off.
            if Index::is_valid(Index::init(tla_checks[source_index as usize].parent)) {
                meta_flags[source_index as usize].is_async_or_has_async_dependency = true;
            }
        }

        Ok(tla_checks[source_index as usize])
    }

    pub fn should_remove_import_export_stmt(
        &mut self,
        stmts: &mut StmtList,
        loc: Loc,
        namespace_ref: Ref,
        import_record_index: u32,
        alloc: &Bump,
        ast: &JSAst,
    ) -> Result<bool, BunError> {
        let record = ast.import_records.at(import_record_index);
        // Barrel optimization: deferred import records should be dropped
        if record.flags.is_unused {
            return Ok(true);
        }
        // Is this an external import?
        if !record.source_index.is_valid() {
            // Keep the "import" statement if import statements are supported
            if self.options.output_format.keep_es6_import_export_syntax() {
                return Ok(false);
            }

            // Otherwise, replace this statement with a call to "require()"
            stmts.inside_wrapper_prefix.append_non_dependency(
                Stmt::alloc(
                    S::Local {
                        decls: G::Decl::List::from_slice(
                            alloc,
                            &[G::Decl {
                                binding: Binding::alloc(alloc, B::Identifier { r#ref: namespace_ref }, loc),
                                value: Some(Expr::init(
                                    E::RequireString { import_record_index },
                                    loc,
                                )),
                            }],
                        ).expect("unreachable"),
                        ..Default::default()
                    },
                    record.range.loc,
                ),
            ).expect("unreachable");
            return Ok(true);
        }

        // We don't need a call to "require()" if this is a self-import inside a
        // CommonJS-style module, since we can just reference the exports directly.
        if ast.exports_kind == ExportsKind::Cjs && self.graph.symbols.follow(namespace_ref).eql(ast.exports_ref) {
            return Ok(true);
        }

        let other_flags = self.graph.meta.items_flags()[record.source_index.get() as usize];
        match other_flags.wrap {
            WrapKind::None => {}
            WrapKind::Cjs => {
                // Replace the statement with a call to "require()" since the other module is CJS-wrapped
                stmts.inside_wrapper_prefix.append_non_dependency(
                    Stmt::alloc(
                        S::Local {
                            decls: G::Decl::List::from_slice(
                                alloc,
                                &[G::Decl {
                                    binding: Binding::alloc(alloc, B::Identifier { r#ref: namespace_ref }, loc),
                                    value: Some(Expr::init(E::RequireString { import_record_index }, loc)),
                                }],
                            )?,
                            ..Default::default()
                        },
                        loc,
                    ),
                )?;
            }
            WrapKind::Esm => {
                // Ignore this file if it's not included in the bundle. This can happen for
                // wrapped ESM files but not for wrapped CommonJS files because we allow
                // tree shaking inside wrapped ESM files.
                if !self.graph.files_live.is_set(record.source_index.get() as usize) {
                    return Ok(true);
                }

                let wrapper_ref = self.graph.ast.items_wrapper_ref()[record.source_index.get() as usize];
                if wrapper_ref.is_empty() {
                    return Ok(true);
                }

                // Replace the statement with a call to "init()"
                let init_call = Expr::init(
                    E::Call {
                        target: Expr::init_identifier(wrapper_ref, loc),
                        ..Default::default()
                    },
                    loc,
                );

                if other_flags.is_async_or_has_async_dependency {
                    stmts.inside_wrapper_prefix.append_async_dependency(init_call, self.promise_all_runtime_ref)?;
                } else {
                    stmts.inside_wrapper_prefix.append_sync_dependency(init_call)?;
                }
            }
        }

        Ok(true)
    }

    pub fn runtime_function(&self, name: &[u8]) -> Ref {
        self.graph.runtime_function(name)
    }

    pub fn print_code_for_file_in_chunk_js(
        &mut self,
        r: renamer::Renamer,
        alloc: &Bump,
        writer: &mut js_printer::BufferWriter,
        out_stmts: &mut [Stmt],
        ast: &JSAst,
        flags: JSMeta::Flags,
        to_esm_ref: Ref,
        to_commonjs_ref: Ref,
        runtime_require_ref: Option<Ref>,
        source_index: Index,
        source: &Source,
    ) -> js_printer::PrintResult {
        let parts_to_print = &[Part { stmts: out_stmts.into(), ..Default::default() }];

        // SAFETY: parse_graph backref
        let parse_graph = unsafe { &*self.parse_graph };

        let print_options = js_printer::Options {
            bundling: true,
            // TODO: IIFE
            indent: Default::default(),
            commonjs_named_exports: ast.commonjs_named_exports.clone(),
            commonjs_named_exports_ref: ast.exports_ref,
            commonjs_module_ref: if ast.flags.uses_module_ref { ast.module_ref } else { Ref::NONE },
            commonjs_named_exports_deoptimized: flags.wrap == WrapKind::Cjs,
            commonjs_module_exports_assigned_deoptimized: ast.flags.commonjs_module_exports_assigned_deoptimized,
            // .const_values = c.graph.const_values,
            ts_enums: self.graph.ts_enums.clone(),

            minify_whitespace: self.options.minify_whitespace,
            minify_syntax: self.options.minify_syntax,
            input_module_type: ast.exports_kind.to_module_type(),
            module_type: self.options.output_format,
            print_dce_annotations: self.options.emit_dce_annotations,
            has_run_symbol_renamer: true,

            allocator: alloc,
            source_map_allocator: if self.dev_server.is_some()
                && parse_graph.input_files.items_loader()[source_index.get() as usize].is_javascript_like()
            {
                // The loader check avoids globally allocating asset source maps
                writer.buffer.allocator
            } else {
                alloc
            },
            to_esm_ref,
            to_commonjs_ref,
            require_ref: match self.options.output_format {
                Format::Cjs => None, // use unbounded global
                _ => runtime_require_ref,
            },
            require_or_import_meta_for_source_callback: js_printer::RequireOrImportMetaForSourceCallback::init(
                Self::require_or_import_meta_for_source,
                self,
            ),
            line_offset_tables: self.graph.files.items_line_offset_table()[source_index.get() as usize].clone(),
            target: self.options.target,

            hmr_ref: if self.options.output_format == Format::InternalBakeDev {
                ast.wrapper_ref
            } else {
                Ref::NONE
            },

            input_files_for_dev_server: if self.options.output_format == Format::InternalBakeDev {
                Some(parse_graph.input_files.items_source())
            } else {
                None
            },
            mangled_props: &self.mangled_props,
            ..Default::default()
        };

        writer.buffer.reset();
        let mut printer = js_printer::BufferPrinter::init(writer.clone());
        let _guard = scopeguard::guard((), |_| *writer = printer.ctx.clone());
        // TODO(port): the defer above writes printer.ctx back into *writer; scopeguard captures by move

        let enable_source_maps = self.options.source_maps != SourceMapOption::None && !source_index.is_runtime();
        // PERF(port): was comptime bool dispatch — profile in Phase B
        if enable_source_maps {
            js_printer::print_with_writer::<js_printer::BufferPrinter, true>(
                &mut printer,
                ast.target,
                ast.to_ast(),
                source,
                print_options,
                ast.import_records.slice(),
                parts_to_print,
                r,
            )
        } else {
            js_printer::print_with_writer::<js_printer::BufferPrinter, false>(
                &mut printer,
                ast.target,
                ast.to_ast(),
                source,
                print_options,
                ast.import_records.slice(),
                parts_to_print,
                r,
            )
        }
    }

    pub fn require_or_import_meta_for_source(
        &self,
        source_index: Index::Int,
        was_unwrapped_require: bool,
    ) -> js_printer::RequireOrImportMeta {
        let flags = self.graph.meta.items_flags()[source_index as usize];
        js_printer::RequireOrImportMeta {
            exports_ref: if flags.wrap == WrapKind::Esm
                || (was_unwrapped_require && self.graph.ast.items_flags()[source_index as usize].force_cjs_to_esm)
            {
                self.graph.ast.items_exports_ref()[source_index as usize]
            } else {
                Ref::NONE
            },
            is_wrapper_async: flags.is_async_or_has_async_dependency,
            wrapper_ref: self.graph.ast.items_wrapper_ref()[source_index as usize],

            was_unwrapped_require: was_unwrapped_require
                && self.graph.ast.items_flags()[source_index as usize].force_cjs_to_esm,
        }
    }

    pub fn mangle_local_css(&mut self) {
        if self.has_any_css_locals.load(Ordering::Relaxed) == 0 {
            return;
        }

        let all_css_asts: &[Option<*mut css::BundlerStyleSheet>] = self.graph.ast.items_css();
        let all_symbols: &[Symbol::List] = self.graph.ast.items_symbols();
        // SAFETY: parse_graph backref
        let all_sources: &[Source] = unsafe { (*self.parse_graph).input_files.items_source() };

        // Collect all local css names
        // PERF(port): was stack-fallback alloc
        let mut local_css_names: HashMap<Ref, ()> = HashMap::new();

        for (source_index, maybe_css_ast) in all_css_asts.iter().enumerate() {
            if let Some(css_ast_ptr) = maybe_css_ast {
                // SAFETY: css_ast pointer owned by graph arena
                let css_ast = unsafe { &**css_ast_ptr };
                if css_ast.local_scope.count() == 0 {
                    continue;
                }
                let symbols = &all_symbols[source_index];
                for (inner_index, symbol_) in symbols.slice_const().iter().enumerate() {
                    let mut symbol = symbol_;
                    if symbol.kind == Symbol::Kind::LocalCss {
                        let r#ref = 'ref: {
                            let mut r#ref = Ref::init(
                                u32::try_from(inner_index).unwrap(),
                                u32::try_from(source_index).unwrap(),
                                false,
                            );
                            r#ref.tag = Ref::Tag::Symbol;
                            while symbol.has_link() {
                                r#ref = symbol.link;
                                symbol = all_symbols[r#ref.source_index as usize].at(r#ref.inner_index);
                            }
                            break 'ref r#ref;
                        };

                        let entry = local_css_names.get_or_put(r#ref).expect("OOM");
                        if entry.found_existing {
                            continue;
                        }

                        let source = &all_sources[r#ref.source_index as usize];

                        let original_name = &symbol.original_name;
                        let path_hash = css::css_modules::hash(
                            self.allocator(),
                            // use path relative to cwd for determinism
                            format_args!("{}", bstr::BStr::new(&source.path.pretty)),
                            false,
                        );

                        let mut final_generated_name = Vec::new();
                        use std::io::Write;
                        write!(&mut final_generated_name, "{}_{}", bstr::BStr::new(original_name), bstr::BStr::new(&path_hash)).unwrap();
                        // TODO(port): allocator() is arena; mangled_props key/value lifetime
                        self.mangled_props.put(self.allocator(), r#ref, final_generated_name.into_boxed_slice()).expect("OOM");
                    }
                }
            }
        }
    }

    pub fn append_isolated_hashes_for_imported_chunks(
        &self,
        hash: &mut ContentHasher,
        chunks: &mut [Chunk],
        index: u32,
        chunk_visit_map: &mut AutoBitSet,
    ) {
        // Only visit each chunk at most once. This is important because there may be
        // cycles in the chunk import graph. If there's a cycle, we want to include
        // the hash of every chunk involved in the cycle (along with all of their
        // dependencies). This depth-first traversal will naturally do that.
        if chunk_visit_map.is_set(index as usize) {
            return;
        }
        chunk_visit_map.set(index as usize);

        // Visit the other chunks that this chunk imports before visiting this chunk
        // PORT NOTE: reshaped for borrowck — collect imports first to avoid aliasing &chunks[index] with recursive &mut chunks
        let cross_chunk_imports: Vec<u32> = chunks[index as usize]
            .cross_chunk_imports
            .slice()
            .iter()
            .map(|import| import.chunk_index)
            .collect();
        for chunk_index in cross_chunk_imports {
            self.append_isolated_hashes_for_imported_chunks(hash, chunks, chunk_index, chunk_visit_map);
        }

        let chunk = &chunks[index as usize];

        // Mix in hashes for content referenced via output pieces. JS chunks
        // express cross-chunk dependencies via `cross_chunk_imports` above, but
        // HTML (and CSS) chunks only reference other chunks through pieces, so
        // recurse on those too.
        // PORT NOTE: reshaped for borrowck — collect piece queries first
        let piece_queries: Vec<(Chunk::OutputPiece::Query::Kind, u32)> =
            if let Chunk::IntermediateOutput::Pieces(pieces) = &chunk.intermediate_output {
                pieces.slice().iter().map(|p| (p.query.kind, p.query.index)).collect()
            } else {
                Vec::new()
            };
        let final_rel_path = chunk.final_rel_path.clone();

        for (kind, piece_index) in piece_queries {
            match kind {
                Chunk::OutputPiece::Query::Kind::Asset => {
                    let mut from_chunk_dir = bun_paths::dirname_posix(&final_rel_path).unwrap_or(b"");
                    if from_chunk_dir == b"." {
                        from_chunk_dir = b"";
                    }

                    let source_index = piece_index;
                    // SAFETY: parse_graph backref
                    let parse_graph = unsafe { &*self.parse_graph };
                    let additional_files: &[AdditionalFile] =
                        parse_graph.input_files.items_additional_files()[source_index as usize].slice();
                    debug_assert!(!additional_files.is_empty());
                    match &additional_files[0] {
                        AdditionalFile::OutputFile(output_file_id) => {
                            let path = &parse_graph.additional_output_files[*output_file_id as usize].dest_path;
                            hash.write(bun_paths::relative_platform(from_chunk_dir, path, bun_paths::Platform::Posix, false));
                        }
                        AdditionalFile::SourceIndex(_) => {}
                    }
                }
                Chunk::OutputPiece::Query::Kind::Chunk => {
                    self.append_isolated_hashes_for_imported_chunks(hash, chunks, piece_index, chunk_visit_map);
                }
                Chunk::OutputPiece::Query::Kind::Scb => {
                    self.append_isolated_hashes_for_imported_chunks(
                        hash,
                        chunks,
                        self.graph.files.items_entry_point_chunk_index()[piece_index as usize],
                        chunk_visit_map,
                    );
                }
                Chunk::OutputPiece::Query::Kind::None | Chunk::OutputPiece::Query::Kind::HtmlImport => {}
            }
        }

        // Mix in the hash for this chunk
        let chunk = &chunks[index as usize];
        hash.write(bytemuck::bytes_of(&chunk.isolated_hash));
        // TODO(port): std.mem.asBytes — using bytemuck; verify endianness invariant
    }

    // Sort cross-chunk exports by chunk name for determinism
    pub fn sorted_cross_chunk_export_items(
        &self,
        export_refs: &ChunkMetaMap,
        list: &mut Vec<StableRef>,
    ) {
        list.clear();
        list.reserve(export_refs.count());
        // PORT NOTE: Zig set .items.len = count() then indexed; Rust pushes
        for &export_ref in export_refs.keys() {
            #[cfg(debug_assertions)]
            {
                debug_tree_shake!(
                    "Export name: {} (in {})",
                    bstr::BStr::new(&self.graph.symbols.get(export_ref).unwrap().original_name),
                    bstr::BStr::new(unsafe {
                        // SAFETY: parse_graph is a BACKREF into BundleV2 (LIFETIMES.tsv)
                        &(*self.parse_graph).input_files.get(export_ref.source_index()).source.path.text
                    }),
                );
            }
            list.push(StableRef {
                stable_source_index: self.graph.stable_source_indices[export_ref.source_index() as usize],
                r#ref: export_ref,
            });
        }
        list.sort_by(StableRef::is_less_than);
    }

    pub fn mark_file_reachable_for_code_splitting(
        &mut self,
        source_index: Index::Int,
        entry_points_count: usize,
        distances: &mut [u32],
        distance: u32,
        parts: &mut [BabyList<Part>],
        import_records: &[BabyList<ImportRecord>],
        file_entry_bits: &mut [AutoBitSet],
        css_reprs: &[Option<*mut css::BundlerStyleSheet>],
    ) {
        if !self.graph.files_live.is_set(source_index as usize) {
            return;
        }

        let cur_dist = distances[source_index as usize];
        let traverse_again = distance < cur_dist;
        if traverse_again {
            distances[source_index as usize] = distance;
        }
        let out_dist = distance + 1;

        let bits = &mut file_entry_bits[source_index as usize];

        // Don't mark this file more than once
        if bits.is_set(entry_points_count) && !traverse_again {
            return;
        }

        bits.set(entry_points_count);

        #[cfg(feature = "debug_logs")]
        {
            // SAFETY: parse_graph backref
            let parse_graph = unsafe { &*self.parse_graph };
            debug_tree_shake!(
                "markFileReachableForCodeSplitting(entry: {}): {} {} ({})",
                entry_points_count,
                bstr::BStr::new(&parse_graph.input_files.items_source()[source_index as usize].path.pretty),
                <&'static str>::from(parse_graph.ast.items_target()[source_index as usize].bake_graph()),
                out_dist,
            );
        }

        if css_reprs[source_index as usize].is_some() {
            for record in import_records[source_index as usize].slice() {
                if record.source_index.is_valid() && !self.is_external_dynamic_import(record, source_index) {
                    self.mark_file_reachable_for_code_splitting(
                        record.source_index.get(),
                        entry_points_count,
                        distances,
                        out_dist,
                        parts,
                        import_records,
                        file_entry_bits,
                        css_reprs,
                    );
                }
            }
            return;
        }

        for record in import_records[source_index as usize].slice() {
            if record.source_index.is_valid() && !self.is_external_dynamic_import(record, source_index) {
                self.mark_file_reachable_for_code_splitting(
                    record.source_index.get(),
                    entry_points_count,
                    distances,
                    out_dist,
                    parts,
                    import_records,
                    file_entry_bits,
                    css_reprs,
                );
            }
        }

        let parts_in_file = parts[source_index as usize].slice();
        for part in parts_in_file {
            for dependency in part.dependencies.slice() {
                if dependency.source_index.get() != source_index {
                    self.mark_file_reachable_for_code_splitting(
                        dependency.source_index.get(),
                        entry_points_count,
                        distances,
                        out_dist,
                        parts,
                        import_records,
                        file_entry_bits,
                        css_reprs,
                    );
                }
            }
        }
    }

    pub fn mark_file_live_for_tree_shaking(
        &mut self,
        source_index: Index::Int,
        side_effects: &[SideEffects],
        parts: &mut [BabyList<Part>],
        import_records: &[BabyList<ImportRecord>],
        entry_point_kinds: &[EntryPoint::Kind],
        css_reprs: &[Option<*mut css::BundlerStyleSheet>],
    ) {
        #[cfg(debug_assertions)]
        {
            // SAFETY: parse_graph backref
            let parse_graph = unsafe { &*self.parse_graph };
            debug_tree_shake!(
                "markFileLiveForTreeShaking({}, {} {}) = {}",
                source_index,
                bstr::BStr::new(&parse_graph.input_files.get(source_index).source.path.pretty),
                <&'static str>::from(parse_graph.ast.items_target()[source_index as usize].bake_graph()),
                if self.graph.files_live.is_set(source_index as usize) { "already seen" } else { "first seen" },
            );
        }

        let _guard = scopeguard::guard((), |_| {
            #[cfg(debug_assertions)]
            debug_tree_shake!("end()");
        });

        if self.graph.files_live.is_set(source_index as usize) {
            return;
        }
        self.graph.files_live.set(source_index as usize);

        if source_index as usize >= self.graph.ast.len() {
            debug_assert!(false);
            return;
        }

        if css_reprs[source_index as usize].is_some() {
            for record in import_records[source_index as usize].slice() {
                let other_source_index = record.source_index.get();
                if record.source_index.is_valid() {
                    self.mark_file_live_for_tree_shaking(
                        other_source_index,
                        side_effects,
                        parts,
                        import_records,
                        entry_point_kinds,
                        css_reprs,
                    );
                }
            }
            return;
        }

        // HTML files can reference non-JS/CSS assets (favicons, images, etc.)
        // via .url kind import records. Follow all import records for HTML files
        // so these assets are marked live and included in the manifest.
        // SAFETY: parse_graph backref
        if unsafe { (*self.parse_graph).input_files.items_loader()[source_index as usize] } == Loader::Html {
            for record in import_records[source_index as usize].slice() {
                if record.source_index.is_valid() {
                    self.mark_file_live_for_tree_shaking(
                        record.source_index.get(),
                        side_effects,
                        parts,
                        import_records,
                        entry_point_kinds,
                        css_reprs,
                    );
                }
            }
            return;
        }

        let part_count = parts[source_index as usize].slice().len();
        for part_index in 0..part_count {
            // PORT NOTE: reshaped for borrowck — re-borrow part each iteration since recursion mutates `parts`
            let part = &parts[source_index as usize].slice()[part_index];
            let mut can_be_removed_if_unused = part.can_be_removed_if_unused;

            if can_be_removed_if_unused && part.tag == Part::Tag::CommonjsNamedExport {
                if self.graph.meta.items_flags()[source_index as usize].wrap == WrapKind::Cjs {
                    can_be_removed_if_unused = false;
                }
            }

            // Also include any statement-level imports
            // PORT NOTE: clone indices to avoid holding borrow across recursive call
            let import_indices: Vec<u32> = part.import_record_indices.slice().to_vec();
            for import_index in import_indices {
                let record = import_records[source_index as usize].at(import_index);
                if record.kind != ImportKind::Stmt {
                    continue;
                }

                if record.source_index.is_valid() {
                    let other_source_index = record.source_index.get();

                    // Don't include this module for its side effects if it can be
                    // considered to have no side effects
                    let se = side_effects[other_source_index as usize];

                    if se != SideEffects::HasSideEffects && !self.options.ignore_dce_annotations {
                        continue;
                    }

                    // Otherwise, include this module for its side effects
                    self.mark_file_live_for_tree_shaking(
                        other_source_index,
                        side_effects,
                        parts,
                        import_records,
                        entry_point_kinds,
                        css_reprs,
                    );
                } else if record.flags.is_external_without_side_effects {
                    // This can be removed if it's unused
                    continue;
                }

                // If we get here then the import was included for its side effects, so
                // we must also keep this part
                can_be_removed_if_unused = false;
            }

            // Include all parts in this file with side effects, or just include
            // everything if tree-shaking is disabled. Note that we still want to
            // perform tree-shaking on the runtime even if tree-shaking is disabled.
            let force_tree_shaking = parts[source_index as usize].slice()[part_index].force_tree_shaking;
            if !can_be_removed_if_unused
                || (!force_tree_shaking
                    && !self.options.tree_shaking
                    && entry_point_kinds[source_index as usize].is_entry_point())
            {
                self.mark_part_live_for_tree_shaking(
                    u32::try_from(part_index).unwrap(),
                    source_index,
                    side_effects,
                    parts,
                    import_records,
                    entry_point_kinds,
                    css_reprs,
                );
            }
        }
    }

    pub fn mark_part_live_for_tree_shaking(
        &mut self,
        part_index: Index::Int,
        source_index: Index::Int,
        side_effects: &[SideEffects],
        parts: &mut [BabyList<Part>],
        import_records: &[BabyList<ImportRecord>],
        entry_point_kinds: &[EntryPoint::Kind],
        css_reprs: &[Option<*mut css::BundlerStyleSheet>],
    ) {
        let part: &mut Part = &mut parts[source_index as usize].slice_mut()[part_index as usize];

        // only once
        if part.is_live {
            return;
        }
        part.is_live = true;

        #[cfg(debug_assertions)]
        {
            // SAFETY: parse_graph backref
            let parse_graph = unsafe { &*self.parse_graph };
            debug_tree_shake!(
                "markPartLiveForTreeShaking({}): {}:{} = {}, {}",
                source_index,
                bstr::BStr::new(&parse_graph.input_files.get(source_index).source.path.pretty),
                part_index,
                if !part.stmts.is_empty() { part.stmts[0].loc.start } else { Loc::EMPTY.start },
                if !part.stmts.is_empty() { <&'static str>::from(&part.stmts[0].data) } else { <&'static str>::from(&Stmt::empty().data) },
            );
        }

        let _guard = scopeguard::guard((), |_| {
            #[cfg(debug_assertions)]
            debug_tree_shake!("end()");
        });

        // PORT NOTE: reshaped for borrowck — clone dependencies before recursing (recursion mutates `parts`)
        let dependencies: Vec<Dependency> = part.dependencies.slice().to_vec();

        // Include the file containing this part
        self.mark_file_live_for_tree_shaking(
            source_index,
            side_effects,
            parts,
            import_records,
            entry_point_kinds,
            css_reprs,
        );

        #[cfg(feature = "debug_logs")]
        if dependencies.is_empty() {
            log_part_dependency_tree!("markPartLiveForTreeShaking {}:{} | EMPTY", source_index, part_index);
        }

        for dependency in &dependencies {
            #[cfg(feature = "debug_logs")]
            if source_index != 0 && dependency.source_index.get() != 0 {
                log_part_dependency_tree!(
                    "markPartLiveForTreeShaking: {}:{} --> {}:{}\n",
                    source_index, part_index, dependency.source_index.get(), dependency.part_index,
                );
            }

            self.mark_part_live_for_tree_shaking(
                dependency.part_index,
                dependency.source_index.get(),
                side_effects,
                parts,
                import_records,
                entry_point_kinds,
                css_reprs,
            );
        }
    }

    pub fn match_import_with_export(
        &mut self,
        init_tracker: ImportTracker,
        re_exports: &mut Vec<Dependency>,
    ) -> MatchImport {
        let cycle_detector_top = self.cycle_detector.len();
        let _guard = scopeguard::guard(&mut self.cycle_detector as *mut Vec<ImportTracker>, |cd| {
            // SAFETY: cd points to self.cycle_detector which outlives this scope
            unsafe { (*cd).truncate(cycle_detector_top) };
        });
        // TODO(port): scopeguard captures &mut self.cycle_detector via raw ptr to avoid borrowck conflict

        let mut tracker = init_tracker;
        let mut ambiguous_results: Vec<MatchImport> = Vec::new();

        let mut result: MatchImport = MatchImport::default();
        let named_imports = self.graph.ast.items_named_imports();

        'loop_: loop {
            // Make sure we avoid infinite loops trying to resolve cycles:
            //
            //   // foo.js
            //   export {a as b} from './foo.js'
            //   export {b as c} from './foo.js'
            //   export {c as a} from './foo.js'
            //
            // This uses a O(n^2) array scan instead of a O(n) map because the vast
            // majority of cases have one or two elements
            for prev_tracker in &self.cycle_detector[cycle_detector_top..] {
                if tracker == *prev_tracker {
                    result = MatchImport { kind: MatchImportKind::Cycle, ..Default::default() };
                    break 'loop_;
                }
            }

            if tracker.source_index.is_invalid() {
                // External
                break;
            }

            let prev_source_index = tracker.source_index.get();
            self.cycle_detector.push(tracker);

            // Resolve the import by one step
            let advanced = self.advance_import_tracker(&tracker);
            let next_tracker = advanced.value;
            let status = advanced.status;
            let potentially_ambiguous_export_star_refs = advanced.import_data;

            match status {
                ImportTracker::Status::Cjs
                | ImportTracker::Status::CjsWithoutExports
                | ImportTracker::Status::Disabled
                | ImportTracker::Status::External => {
                    if status == ImportTracker::Status::External
                        && self.options.output_format.keep_es6_import_export_syntax()
                    {
                        // Imports from external modules should not be converted to CommonJS
                        // if the output format preserves the original ES6 import statements
                        break;
                    }

                    // If it's a CommonJS or external file, rewrite the import to a
                    // property access. Don't do this if the namespace reference is invalid
                    // though. This is the case for star imports, where the import is the
                    // namespace.
                    let named_import: NamedImport = named_imports[prev_source_index as usize].get(&tracker.import_ref).unwrap().clone();

                    if named_import.namespace_ref.is_some() && named_import.namespace_ref.unwrap().is_valid() {
                        if result.kind == MatchImportKind::Normal {
                            result.kind = MatchImportKind::NormalAndNamespace;
                            result.namespace_ref = named_import.namespace_ref.unwrap();
                            result.alias = named_import.alias.unwrap();
                        } else {
                            result = MatchImport {
                                kind: MatchImportKind::Namespace,
                                namespace_ref: named_import.namespace_ref.unwrap(),
                                alias: named_import.alias.unwrap(),
                                ..Default::default()
                            };
                        }
                    }

                    // Warn about importing from a file that is known to not have any exports
                    if status == ImportTracker::Status::CjsWithoutExports {
                        let source = self.get_source(tracker.source_index.get() as usize);
                        self.log.add_range_warning_fmt(
                            source,
                            source.range_of_identifier(named_import.alias_loc.unwrap()),
                            self.allocator(),
                            format_args!(
                                "Import \"{}\" will always be undefined because the file \"{}\" has no exports",
                                bstr::BStr::new(named_import.alias.unwrap()),
                                bstr::BStr::new(&source.path.pretty),
                            ),
                        ).expect("unreachable");
                    }
                }

                ImportTracker::Status::DynamicFallbackInteropDefault => {
                    // if the file was rewritten from CommonJS into ESM
                    // and the developer imported an export that doesn't exist
                    // We don't do a runtime error since that CJS would have returned undefined.
                    let named_import: NamedImport = named_imports[prev_source_index as usize].get(&tracker.import_ref).unwrap().clone();

                    if named_import.namespace_ref.is_some() && named_import.namespace_ref.unwrap().is_valid() {
                        let symbol = self.graph.symbols.get_mut(tracker.import_ref).unwrap();
                        symbol.import_item_status = Symbol::ImportItemStatus::Missing;
                        result.kind = MatchImportKind::NormalAndNamespace;
                        result.namespace_ref = tracker.import_ref;
                        result.alias = named_import.alias.unwrap();
                        result.name_loc = named_import.alias_loc.unwrap_or(Loc::EMPTY);
                    }
                }

                ImportTracker::Status::DynamicFallback => {
                    // If it's a file with dynamic export fallback, rewrite the import to a property access
                    let named_import: NamedImport = named_imports[prev_source_index as usize].get(&tracker.import_ref).unwrap().clone();
                    if named_import.namespace_ref.is_some() && named_import.namespace_ref.unwrap().is_valid() {
                        if result.kind == MatchImportKind::Normal {
                            result.kind = MatchImportKind::NormalAndNamespace;
                            result.namespace_ref = next_tracker.import_ref;
                            result.alias = named_import.alias.unwrap();
                        } else {
                            result = MatchImport {
                                kind: MatchImportKind::Namespace,
                                namespace_ref: next_tracker.import_ref,
                                alias: named_import.alias.unwrap(),
                                ..Default::default()
                            };
                        }
                    }
                }
                ImportTracker::Status::NoMatch => {
                    // Report mismatched imports and exports
                    let symbol = self.graph.symbols.get_mut(tracker.import_ref).unwrap();
                    let named_import: NamedImport = named_imports[prev_source_index as usize].get(&tracker.import_ref).unwrap().clone();
                    let source = self.get_source(prev_source_index as usize);

                    let next_source = self.get_source(next_tracker.source_index.get() as usize);
                    let r = source.range_of_identifier(named_import.alias_loc.unwrap());

                    // Report mismatched imports and exports
                    if symbol.import_item_status == Symbol::ImportItemStatus::Generated {
                        // This is a debug message instead of an error because although it
                        // appears to be a named import, it's actually an automatically-
                        // generated named import that was originally a property access on an
                        // import star namespace object. Normally this property access would
                        // just resolve to undefined at run-time instead of failing at binding-
                        // time, so we emit a debug message and rewrite the value to the literal
                        // "undefined" instead of emitting an error.
                        symbol.import_item_status = Symbol::ImportItemStatus::Missing;

                        // SAFETY: resolver backref
                        let resolver = unsafe { &*self.resolver };
                        if resolver.opts.target == Target::Browser
                            && bun_resolve_builtins::HardcodedModule::Alias::has(&next_source.path.pretty, bun_resolve_builtins::RuntimeTarget::Bun, Default::default())
                        {
                            self.log.add_range_warning_fmt_with_note(
                                source, r, self.allocator(),
                                format_args!(
                                    "Browser polyfill for module \"{}\" doesn't have a matching export named \"{}\"",
                                    bstr::BStr::new(&next_source.path.pretty),
                                    bstr::BStr::new(named_import.alias.unwrap()),
                                ),
                                format_args!("Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options."),
                                r,
                            ).expect("unreachable");
                        } else {
                            self.log.add_range_warning_fmt(
                                source, r, self.allocator(),
                                format_args!(
                                    "Import \"{}\" will always be undefined because there is no matching export in \"{}\"",
                                    bstr::BStr::new(named_import.alias.unwrap()),
                                    bstr::BStr::new(&next_source.path.pretty),
                                ),
                            ).expect("unreachable");
                        }
                    } else if unsafe {
                        // SAFETY: resolver is a BACKREF into BundleV2.transpiler.resolver (LIFETIMES.tsv)
                        (*self.resolver).opts.target
                    } == Target::Browser
                        && next_source.path.text.starts_with(NodeFallbackModules::IMPORT_PATH)
                    {
                        self.log.add_range_error_fmt_with_note(
                            source, r, self.allocator(),
                            format_args!(
                                "Browser polyfill for module \"{}\" doesn't have a matching export named \"{}\"",
                                bstr::BStr::new(&next_source.path.pretty),
                                bstr::BStr::new(named_import.alias.unwrap()),
                            ),
                            format_args!("Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options."),
                            r,
                        ).expect("unreachable");
                    } else {
                        self.log.add_range_error_fmt(
                            source, r, self.allocator(),
                            format_args!(
                                "No matching export in \"{}\" for import \"{}\"",
                                bstr::BStr::new(&next_source.path.pretty),
                                bstr::BStr::new(named_import.alias.unwrap()),
                            ),
                        ).expect("unreachable");
                    }
                }
                ImportTracker::Status::ProbablyTypescriptType => {
                    // Omit this import from any namespace export code we generate for
                    // import star statements (i.e. "import * as ns from 'path'")
                    result = MatchImport { kind: MatchImportKind::ProbablyTypescriptType, ..Default::default() };
                }
                ImportTracker::Status::Found => {
                    // If there are multiple ambiguous results due to use of "export * from"
                    // statements, trace them all to see if they point to different things.
                    for ambiguous_tracker in potentially_ambiguous_export_star_refs {
                        // If this is a re-export of another import, follow the import
                        if named_imports[ambiguous_tracker.data.source_index.get() as usize]
                            .contains(&ambiguous_tracker.data.import_ref)
                        {
                            let ambig = self.match_import_with_export(ambiguous_tracker.data, re_exports);
                            ambiguous_results.push(ambig);
                        } else {
                            ambiguous_results.push(MatchImport {
                                kind: MatchImportKind::Normal,
                                source_index: ambiguous_tracker.data.source_index.get(),
                                r#ref: ambiguous_tracker.data.import_ref,
                                name_loc: ambiguous_tracker.data.name_loc,
                                ..Default::default()
                            });
                        }
                    }

                    // Defer the actual binding of this import until after we generate
                    // namespace export code for all files. This has to be done for all
                    // import-to-export matches, not just the initial import to the final
                    // export, since all imports and re-exports must be merged together
                    // for correctness.
                    result = MatchImport {
                        kind: MatchImportKind::Normal,
                        source_index: next_tracker.source_index.get(),
                        r#ref: next_tracker.import_ref,
                        name_loc: next_tracker.name_loc,
                        ..Default::default()
                    };

                    // Depend on the statement(s) that declared this import symbol in the
                    // original file
                    {
                        let deps = self.top_level_symbols_to_parts(prev_source_index, tracker.import_ref);
                        re_exports.reserve(deps.len());
                        for &dep in deps {
                            re_exports.push(Dependency {
                                part_index: dep,
                                source_index: tracker.source_index,
                            });
                            // PERF(port): was assume_capacity
                        }
                    }

                    // If this is a re-export of another import, continue for another
                    // iteration of the loop to resolve that import as well
                    let next_id = next_tracker.source_index.get();
                    if named_imports[next_id as usize].contains(&next_tracker.import_ref) {
                        tracker = next_tracker;
                        continue 'loop_;
                    }
                }
            }

            break 'loop_;
        }

        // If there is a potential ambiguity, all results must be the same
        for ambig in &ambiguous_results {
            if *ambig != result {
                if result.kind == ambig.kind
                    && ambig.kind == MatchImportKind::Normal
                    && ambig.name_loc.start != 0
                    && result.name_loc.start != 0
                {
                    return MatchImport {
                        kind: MatchImportKind::Ambiguous,
                        source_index: result.source_index,
                        name_loc: result.name_loc,
                        other_source_index: ambig.source_index,
                        other_name_loc: ambig.name_loc,
                        ..Default::default()
                    };
                }

                return MatchImport { kind: MatchImportKind::Ambiguous, ..Default::default() };
            }
        }

        result
    }

    pub fn top_level_symbols_to_parts(&self, id: u32, r#ref: Ref) -> &[u32] {
        self.graph.top_level_symbol_to_parts(id, r#ref)
    }

    pub fn top_level_symbols_to_parts_for_runtime(&self, r#ref: Ref) -> &[u32] {
        self.top_level_symbols_to_parts(Index::runtime().get(), r#ref)
    }

    pub fn create_wrapper_for_file(
        &mut self,
        wrap: WrapKind,
        wrapper_ref: Ref,
        wrapper_part_index: &mut Index,
        source_index: Index::Int,
    ) {
        match wrap {
            // If this is a CommonJS file, we're going to need to generate a wrapper
            // for the CommonJS closure. That will end up looking something like this:
            //
            //   var require_foo = __commonJS((exports, module) => {
            //     ...
            //   });
            //
            // However, that generation is special-cased for various reasons and is
            // done later on. Still, we're going to need to ensure that this file
            // both depends on the "__commonJS" symbol and declares the "require_foo"
            // symbol. Instead of special-casing this during the reachability analysis
            // below, we just append a dummy part to the end of the file with these
            // dependencies and let the general-purpose reachability analysis take care
            // of it.
            WrapKind::Cjs => {
                let common_js_parts = self.top_level_symbols_to_parts_for_runtime(self.cjs_runtime_ref);

                for &part_id in common_js_parts {
                    let runtime_parts = self.graph.ast.items_parts()[Index::runtime().get() as usize].slice();
                    let part: &Part = &runtime_parts[part_id as usize];
                    let symbol_refs = part.symbol_uses.keys();
                    for r#ref in symbol_refs {
                        if r#ref.eql(self.cjs_runtime_ref) {
                            continue;
                        }
                    }
                }

                // Generate a dummy part that depends on the "__commonJS" symbol.
                let dependencies: Box<[Dependency]> = if self.options.output_format != Format::InternalBakeDev {
                    let mut dependencies = vec![Dependency::default(); common_js_parts.len()].into_boxed_slice();
                    debug_assert_eq!(common_js_parts.len(), dependencies.len());
                    for (part, cjs) in common_js_parts.iter().zip(dependencies.iter_mut()) {
                        *cjs = Dependency {
                            part_index: *part,
                            source_index: Index::runtime(),
                        };
                    }
                    dependencies
                } else {
                    Box::default()
                };
                let mut symbol_uses: Part::SymbolUseMap = Default::default();
                symbol_uses.put(self.allocator(), wrapper_ref, Part::SymbolUse { count_estimate: 1 }).expect("OOM");
                let part_index = self.graph.add_part_to_file(
                    source_index,
                    Part {
                        stmts: Default::default(),
                        symbol_uses,
                        declared_symbols: DeclaredSymbol::List::from_slice(
                            self.allocator(),
                            &[
                                DeclaredSymbol { r#ref: self.graph.ast.items_exports_ref()[source_index as usize], is_top_level: true },
                                DeclaredSymbol { r#ref: self.graph.ast.items_module_ref()[source_index as usize], is_top_level: true },
                                DeclaredSymbol { r#ref: self.graph.ast.items_wrapper_ref()[source_index as usize], is_top_level: true },
                            ],
                        ).expect("unreachable"),
                        dependencies: Dependency::List::from_owned_slice(dependencies),
                        ..Default::default()
                    },
                ).expect("unreachable");
                debug_assert!(part_index != js_ast::NAMESPACE_EXPORT_PART_INDEX);
                *wrapper_part_index = Index::part(part_index);

                // Bake uses a wrapping approach that does not use __commonJS
                if self.options.output_format != Format::InternalBakeDev {
                    self.graph.generate_symbol_import_and_use(
                        source_index,
                        part_index,
                        self.cjs_runtime_ref,
                        1,
                        Index::runtime(),
                    ).expect("unreachable");
                }
            }

            WrapKind::Esm => {
                // If this is a lazily-initialized ESM file, we're going to need to
                // generate a wrapper for the ESM closure. That will end up looking
                // something like this:
                //
                //   var init_foo = __esm(() => {
                //     ...
                //   });
                //
                // This depends on the "__esm" symbol and declares the "init_foo" symbol
                // for similar reasons to the CommonJS closure above.

                // Count async dependencies to determine if we need __promiseAll
                let mut async_import_count: usize = 0;
                let import_records = self.graph.ast.items_import_records()[source_index as usize].slice();
                let meta_flags = self.graph.meta.items_flags();

                for record in import_records {
                    if !record.source_index.is_valid() {
                        continue;
                    }
                    let other_flags = meta_flags[record.source_index.get() as usize];
                    if other_flags.is_async_or_has_async_dependency {
                        async_import_count += 1;
                        if async_import_count >= 2 {
                            break;
                        }
                    }
                }

                let needs_promise_all = async_import_count >= 2;

                let esm_parts: &[u32] = if wrapper_ref.is_valid() && self.options.output_format != Format::InternalBakeDev {
                    self.top_level_symbols_to_parts_for_runtime(self.esm_runtime_ref)
                } else {
                    &[]
                };

                let promise_all_parts: &[u32] = if needs_promise_all && wrapper_ref.is_valid() && self.options.output_format != Format::InternalBakeDev {
                    self.top_level_symbols_to_parts_for_runtime(self.promise_all_runtime_ref)
                } else {
                    &[]
                };

                // generate a dummy part that depends on the "__esm" and optionally "__promiseAll" symbols
                let mut dependencies = vec![Dependency::default(); esm_parts.len() + promise_all_parts.len()].into_boxed_slice();
                let mut dep_index: usize = 0;
                for &part in esm_parts {
                    dependencies[dep_index] = Dependency { part_index: part, source_index: Index::runtime() };
                    dep_index += 1;
                }
                for &part in promise_all_parts {
                    dependencies[dep_index] = Dependency { part_index: part, source_index: Index::runtime() };
                    dep_index += 1;
                }

                let mut symbol_uses: Part::SymbolUseMap = Default::default();
                symbol_uses.put(self.allocator(), wrapper_ref, Part::SymbolUse { count_estimate: 1 }).expect("OOM");
                let part_index = self.graph.add_part_to_file(
                    source_index,
                    Part {
                        symbol_uses,
                        declared_symbols: DeclaredSymbol::List::from_slice(
                            self.allocator(),
                            &[DeclaredSymbol { r#ref: wrapper_ref, is_top_level: true }],
                        ).expect("unreachable"),
                        dependencies: Dependency::List::from_owned_slice(dependencies),
                        ..Default::default()
                    },
                ).expect("unreachable");
                debug_assert!(part_index != js_ast::NAMESPACE_EXPORT_PART_INDEX);
                *wrapper_part_index = Index::part(part_index);
                if wrapper_ref.is_valid() && self.options.output_format != Format::InternalBakeDev {
                    self.graph.generate_symbol_import_and_use(
                        source_index,
                        part_index,
                        self.esm_runtime_ref,
                        1,
                        Index::runtime(),
                    ).expect("OOM");

                    // Only mark __promiseAll as used if we have multiple async dependencies
                    if needs_promise_all {
                        self.graph.generate_symbol_import_and_use(
                            source_index,
                            part_index,
                            self.promise_all_runtime_ref,
                            1,
                            Index::runtime(),
                        ).expect("OOM");
                    }
                }
            }
            _ => {}
        }
    }

    pub fn advance_import_tracker(&mut self, tracker: &ImportTracker) -> ImportTracker::Iterator {
        let id = tracker.source_index.get();
        let named_imports: &mut JSAst::NamedImports = &mut self.graph.ast.items_named_imports_mut()[id as usize];
        let import_records = &self.graph.ast.items_import_records()[id as usize];
        let exports_kind: &[ExportsKind] = self.graph.ast.items_exports_kind();
        let ast_flags = self.graph.ast.items_flags();

        let Some(named_import) = named_imports.get(&tracker.import_ref).cloned() else {
            // TODO: investigate if this is a bug
            // It implies there are imports being added without being resolved
            return ImportTracker::Iterator {
                value: Default::default(),
                status: ImportTracker::Status::External,
                ..Default::default()
            };
        };

        // Is this an external file?
        let record: &ImportRecord = import_records.at(named_import.import_record_index);
        if !record.source_index.is_valid() {
            return ImportTracker::Iterator {
                value: Default::default(),
                status: ImportTracker::Status::External,
                ..Default::default()
            };
        }

        // Barrel optimization: deferred import records point to empty ASTs
        if record.flags.is_unused {
            return ImportTracker::Iterator {
                value: Default::default(),
                status: ImportTracker::Status::External,
                ..Default::default()
            };
        }

        // Is this a disabled file?
        let other_source_index = record.source_index.get();
        let other_id = other_source_index;

        // SAFETY: parse_graph backref
        if other_id as usize > self.graph.ast.len()
            || unsafe { (*self.parse_graph).input_files.items_source()[other_source_index as usize].path.is_disabled }
        {
            return ImportTracker::Iterator {
                value: ImportTracker { source_index: record.source_index, ..Default::default() },
                status: ImportTracker::Status::Disabled,
                ..Default::default()
            };
        }

        let flags = ast_flags[other_id as usize];

        // Is this a named import of a file without any exports?
        if !named_import.alias_is_star
            && flags.has_lazy_export
            // ESM exports
            && !flags.uses_export_keyword
            && named_import.alias.map(|a| a != b"default").unwrap_or(true)
            // CommonJS exports
            && !flags.uses_exports_ref
            && !flags.uses_module_ref
        {
            // Just warn about it and replace the import with "undefined"
            return ImportTracker::Iterator {
                value: ImportTracker {
                    source_index: Index::source(other_source_index),
                    import_ref: Ref::NONE,
                    ..Default::default()
                },
                status: ImportTracker::Status::CjsWithoutExports,
                ..Default::default()
            };
        }
        let other_kind = exports_kind[other_id as usize];
        // Is this a CommonJS file?
        if other_kind == ExportsKind::Cjs {
            return ImportTracker::Iterator {
                value: ImportTracker {
                    source_index: Index::source(other_source_index),
                    import_ref: Ref::NONE,
                    ..Default::default()
                },
                status: ImportTracker::Status::Cjs,
                ..Default::default()
            };
        }

        // Match this import star with an export star from the imported file
        if named_import.alias_is_star {
            let matching_export = &self.graph.meta.items_resolved_export_star()[other_id as usize];
            if matching_export.data.import_ref.is_valid() {
                // Check to see if this is a re-export of another import
                return ImportTracker::Iterator {
                    value: matching_export.data,
                    status: ImportTracker::Status::Found,
                    import_data: matching_export.potentially_ambiguous_export_star_refs.slice(),
                };
            }
        }

        // Match this import up with an export from the imported file
        if let Some(matching_export) = self.graph.meta.items_resolved_exports()[other_id as usize].get(named_import.alias.unwrap()) {
            // Check to see if this is a re-export of another import
            return ImportTracker::Iterator {
                value: ImportTracker {
                    source_index: matching_export.data.source_index,
                    import_ref: matching_export.data.import_ref,
                    name_loc: matching_export.data.name_loc,
                },
                status: ImportTracker::Status::Found,
                import_data: matching_export.potentially_ambiguous_export_star_refs.slice(),
            };
        }

        // Is this a file with dynamic exports?
        let is_commonjs_to_esm = flags.force_cjs_to_esm;
        if other_kind.is_esm_with_dynamic_fallback() || is_commonjs_to_esm {
            return ImportTracker::Iterator {
                value: ImportTracker {
                    source_index: Index::source(other_source_index),
                    import_ref: self.graph.ast.items_exports_ref()[other_id as usize],
                    ..Default::default()
                },
                status: if is_commonjs_to_esm {
                    ImportTracker::Status::DynamicFallbackInteropDefault
                } else {
                    ImportTracker::Status::DynamicFallback
                },
                ..Default::default()
            };
        }

        // Missing re-exports in TypeScript files are indistinguishable from types
        // SAFETY: parse_graph backref
        let other_loader = unsafe { (*self.parse_graph).input_files.items_loader()[other_id as usize] };
        if named_import.is_exported && other_loader.is_typescript() {
            return ImportTracker::Iterator {
                value: Default::default(),
                status: ImportTracker::Status::ProbablyTypescriptType,
                ..Default::default()
            };
        }

        ImportTracker::Iterator {
            value: ImportTracker {
                source_index: Index::source(other_source_index),
                ..Default::default()
            },
            status: ImportTracker::Status::NoMatch,
            ..Default::default()
        }
    }

    pub fn match_imports_with_exports_for_file(
        &mut self,
        named_imports_ptr: &mut JSAst::NamedImports,
        imports_to_bind: &mut RefImportData,
        source_index: Index::Int,
    ) {
        let mut named_imports = named_imports_ptr.clone(self.allocator()).expect("OOM");
        // PORT NOTE: Zig `defer named_imports_ptr.* = named_imports;` — write-back at end
        let _writeback = scopeguard::guard(
            (named_imports_ptr as *mut JSAst::NamedImports, &mut named_imports as *mut JSAst::NamedImports),
            // SAFETY: dst/src point at locals (`named_imports_ptr`, `named_imports`) that outlive
            // the guard and do not overlap.
            |(dst, src)| unsafe { core::ptr::swap(dst, src) },
        );
        // TODO(port): defer write-back via raw pointers; revisit in Phase B

        struct Sorter<'a> {
            imports: &'a JSAst::NamedImports,
        }
        impl<'a> Sorter<'a> {
            fn less_than(&self, a_index: usize, b_index: usize) -> bool {
                let a_ref = self.imports.keys()[a_index];
                let b_ref = self.imports.keys()[b_index];
                a_ref.inner_index().cmp(&b_ref.inner_index()) == core::cmp::Ordering::Less
            }
        }
        let sorter = Sorter { imports: &named_imports };
        named_imports.sort(|a, b| sorter.less_than(a, b));

        for (r#ref, named_import) in named_imports.keys().iter().zip(named_imports.values().iter()) {
            // Re-use memory for the cycle detector
            self.cycle_detector.clear();

            let import_ref = *r#ref;

            let mut re_exports: Vec<Dependency> = Vec::new();
            let result = self.match_import_with_export(
                ImportTracker {
                    source_index: Index::source(source_index),
                    import_ref,
                    ..Default::default()
                },
                &mut re_exports,
            );

            match result.kind {
                MatchImportKind::Normal => {
                    imports_to_bind.put(
                        self.allocator(),
                        import_ref,
                        crate::ImportData {
                            re_exports: BabyList::<Dependency>::from_owned_slice(re_exports.into_boxed_slice()),
                            data: ImportTracker {
                                source_index: Index::source(result.source_index),
                                import_ref: result.r#ref,
                                ..Default::default()
                            },
                            ..Default::default()
                        },
                    ).expect("unreachable");
                }
                MatchImportKind::Namespace => {
                    self.graph.symbols.get_mut(import_ref).unwrap().namespace_alias = Some(G::NamespaceAlias {
                        namespace_ref: result.namespace_ref,
                        alias: result.alias,
                    });
                }
                MatchImportKind::NormalAndNamespace => {
                    imports_to_bind.put(
                        self.allocator(),
                        import_ref,
                        crate::ImportData {
                            re_exports: BabyList::<Dependency>::from_owned_slice(re_exports.into_boxed_slice()),
                            data: ImportTracker {
                                source_index: Index::source(result.source_index),
                                import_ref: result.r#ref,
                                ..Default::default()
                            },
                            ..Default::default()
                        },
                    ).expect("unreachable");

                    self.graph.symbols.get_mut(import_ref).unwrap().namespace_alias = Some(G::NamespaceAlias {
                        namespace_ref: result.namespace_ref,
                        alias: result.alias,
                    });
                }
                MatchImportKind::Cycle => {
                    // SAFETY: parse_graph backref
                    let source = unsafe { &(*self.parse_graph).input_files.items_source()[source_index as usize] };
                    let r = lex::range_of_identifier(source, named_import.alias_loc.unwrap_or(Loc::default()));
                    self.log.add_range_error_fmt(
                        source, r, self.allocator(),
                        format_args!(
                            "Detected cycle while resolving import \"{}\"",
                            bstr::BStr::new(named_import.alias.unwrap()),
                        ),
                    ).expect("unreachable");
                }
                MatchImportKind::ProbablyTypescriptType => {
                    self.graph.meta.items_probably_typescript_type_mut()[source_index as usize]
                        .put(self.allocator(), import_ref, ())
                        .expect("unreachable");
                }
                MatchImportKind::Ambiguous => {
                    // SAFETY: parse_graph backref
                    let source = unsafe { &(*self.parse_graph).input_files.items_source()[source_index as usize] };

                    let r = lex::range_of_identifier(source, named_import.alias_loc.unwrap_or(Loc::default()));

                    // TODO: log locations of the ambiguous exports

                    let symbol: &mut Symbol = self.graph.symbols.get_mut(import_ref).unwrap();
                    if symbol.import_item_status == Symbol::ImportItemStatus::Generated {
                        symbol.import_item_status = Symbol::ImportItemStatus::Missing;
                        self.log.add_range_warning_fmt(
                            source, r, self.allocator(),
                            format_args!(
                                "Import \"{}\" will always be undefined because there are multiple matching exports",
                                bstr::BStr::new(named_import.alias.unwrap()),
                            ),
                        ).expect("unreachable");
                    } else {
                        self.log.add_range_error_fmt(
                            source, r, self.allocator(),
                            format_args!(
                                "Ambiguous import \"{}\" has multiple matching exports",
                                bstr::BStr::new(named_import.alias.unwrap()),
                            ),
                        ).expect("unreachable");
                    }
                }
                MatchImportKind::Ignore => {}
            }
        }
    }

    pub fn break_output_into_pieces(
        &self,
        alloc: &Bump,
        j: &mut StringJoiner,
        count: u32,
    ) -> Result<Chunk::IntermediateOutput, BunError> {
        let _trace = bun::perf::trace("Bundler.breakOutputIntoPieces");

        type OutputPiece = Chunk::OutputPiece;

        if !j.contains(&self.unique_key_prefix) {
            // There are like several cases that prohibit this from being checked more trivially, example:
            // 1. dynamic imports
            // 2. require()
            // 3. require.resolve()
            // 4. externals
            return Ok(Chunk::IntermediateOutput::Joiner(core::mem::take(j)));
        }

        // PORT NOTE: Zig had `errdefer j.deinit()` around the initCapacity — Drop handles it.
        let mut pieces: Vec<OutputPiece> = Vec::with_capacity(count as usize);
        // errdefer pieces.deinit() — Drop handles it
        let complete_output = j.done(alloc)?;
        let mut output: &[u8] = &complete_output;

        let prefix = &self.unique_key_prefix;

        'outer: loop {
            // Scan for the next piece boundary
            let Some(boundary) = strings::index_of(output, prefix) else {
                break;
            };

            // Try to parse the piece boundary
            let start = boundary + prefix.len();
            if start + 9 > output.len() {
                // Not enough bytes to parse the piece index
                break;
            }

            let kind: Chunk::OutputPiece::Query::Kind = match output[start] {
                b'A' => Chunk::OutputPiece::Query::Kind::Asset,
                b'C' => Chunk::OutputPiece::Query::Kind::Chunk,
                b'S' => Chunk::OutputPiece::Query::Kind::Scb,
                b'H' => Chunk::OutputPiece::Query::Kind::HtmlImport,
                _ => {
                    if cfg!(debug_assertions) {
                        Output::debug_warn(format_args!("Invalid output piece boundary"));
                    }
                    break;
                }
            };

            let mut index: usize = 0;
            // SAFETY: bounds checked above (start + 9 <= output.len())
            let digits: [u8; 8] = output[start + 1..start + 9].try_into().unwrap();
            for char in digits {
                if char < b'0' || char > b'9' {
                    if cfg!(debug_assertions) {
                        Output::debug_warn(format_args!("Invalid output piece boundary"));
                    }
                    break 'outer;
                }

                index = (index * 10) + ((char as usize) - (b'0' as usize));
            }

            // Validate the boundary
            match kind {
                Chunk::OutputPiece::Query::Kind::Asset | Chunk::OutputPiece::Query::Kind::Scb => {
                    if index >= self.graph.files.len() {
                        if cfg!(debug_assertions) {
                            Output::debug_warn(format_args!("Invalid output piece boundary"));
                        }
                        break;
                    }
                }
                Chunk::OutputPiece::Query::Kind::Chunk => {
                    if index >= count as usize {
                        if cfg!(debug_assertions) {
                            Output::debug_warn(format_args!("Invalid output piece boundary"));
                        }
                        break;
                    }
                }
                Chunk::OutputPiece::Query::Kind::HtmlImport => {
                    // SAFETY: parse_graph backref
                    if index >= unsafe { (*self.parse_graph).html_imports.server_source_indices.len } as usize {
                        if cfg!(debug_assertions) {
                            Output::debug_warn(format_args!("Invalid output piece boundary"));
                        }
                        break;
                    }
                }
                _ => unreachable!(),
            }

            pieces.push(OutputPiece::init(&output[0..boundary], Chunk::OutputPiece::Query {
                kind,
                index: u32::try_from(index).unwrap(),
            }));
            output = &output[boundary + prefix.len() + 9..];
        }

        pieces.push(OutputPiece::init(output, Chunk::OutputPiece::Query::NONE));

        Ok(Chunk::IntermediateOutput::Pieces(
            BabyList::<OutputPiece>::from_owned_slice(pieces.into_boxed_slice()),
        ))
    }
}

// PartialEq for MatchImport (needed for std.meta.eql in match_import_with_export)
impl PartialEq for MatchImport {
    fn eq(&self, other: &Self) -> bool {
        self.alias == other.alias
            && self.kind == other.kind
            && self.namespace_ref == other.namespace_ref
            && self.source_index == other.source_index
            && self.name_loc == other.name_loc
            && self.other_source_index == other.other_source_index
            && self.other_name_loc == other.other_name_loc
            && self.r#ref == other.r#ref
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StmtList
// ──────────────────────────────────────────────────────────────────────────

pub struct StmtList {
    // TODO(port): allocator field dropped — Vec uses global mimalloc; bundler is AST crate but
    // these are temporary scratch buffers, not arena-backed in the original (uses generic allocator param)
    pub inside_wrapper_prefix: InsideWrapperPrefix,
    pub outside_wrapper_prefix: Vec<Stmt>,
    pub inside_wrapper_suffix: Vec<Stmt>,
    pub all_stmts: Vec<Stmt>,
}

pub struct InsideWrapperPrefix {
    pub stmts: Vec<Stmt>,
    pub sync_dependencies_end: usize,
    // if true it will exist at `sync_dependencies_end`
    pub has_async_dependency: bool,
}

impl InsideWrapperPrefix {
    pub fn init() -> Self {
        Self { stmts: Vec::new(), sync_dependencies_end: 0, has_async_dependency: false }
    }

    // deinit → Drop (Vec frees automatically); reset is explicit

    pub fn reset(&mut self) {
        self.stmts.clear();
        self.sync_dependencies_end = 0;
        self.has_async_dependency = false;
    }

    pub fn append_non_dependency(&mut self, stmt: Stmt) -> Result<(), AllocError> {
        self.stmts.push(stmt);
        Ok(())
    }

    pub fn append_non_dependency_slice(&mut self, stmts: &[Stmt]) -> Result<(), AllocError> {
        self.stmts.extend_from_slice(stmts);
        Ok(())
    }

    pub fn append_sync_dependency(&mut self, call_expr: Expr) -> Result<(), AllocError> {
        self.stmts.insert(
            self.sync_dependencies_end,
            Stmt::alloc(S::SExpr { value: call_expr, ..Default::default() }, call_expr.loc),
        );
        self.sync_dependencies_end += 1;
        Ok(())
    }

    pub fn append_async_dependency(&mut self, call_expr: Expr, promise_all_ref: Ref) -> Result<(), AllocError> {
        if !self.has_async_dependency {
            self.has_async_dependency = true;
            self.stmts.insert(
                self.sync_dependencies_end,
                Stmt::alloc(
                    S::SExpr {
                        value: Expr::init(E::Await { value: call_expr }, Loc::EMPTY),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ),
            );
            return Ok(());
        }

        // TODO(port): deep AST mutation chain — these accessors assume payload-variant getters on Stmt/Expr data
        let first_dep_call_expr = self.stmts[self.sync_dependencies_end]
            .data.s_expr_mut().value.data.e_await_mut().value;
        let call = first_dep_call_expr.data.e_call_mut();

        if call.target.data.e_identifier().r#ref.eql(promise_all_ref) {
            // `await __promiseAll` already in place, append to the array argument
            call.args.at_mut(0).data.e_array_mut().items.push(call_expr);
            // TODO(port): BabyList::append(allocator, ..) — using push; verify allocator threading in Phase B
        } else {
            // convert single `await init_` to `await __promiseAll([init_1(), init_2()])`

            let promise_all = Expr::init(E::Identifier { r#ref: promise_all_ref, ..Default::default() }, Loc::EMPTY);

            let mut items: BabyList<Expr> = BabyList::with_capacity(2);
            items.append_slice_assume_capacity(&[first_dep_call_expr, call_expr]);
            // PERF(port): was assume_capacity

            let mut args: BabyList<Expr> = BabyList::with_capacity(1);
            args.append_assume_capacity(Expr::init(E::Array { items, ..Default::default() }, Loc::EMPTY));
            // PERF(port): was assume_capacity

            let promise_all_call = Expr::init(E::Call { target: promise_all, args, ..Default::default() }, Loc::EMPTY);

            // replace the `await init_` expr with `await __promiseAll`
            self.stmts[self.sync_dependencies_end] = Stmt::alloc(
                S::SExpr {
                    value: Expr::init(E::Await { value: promise_all_call }, Loc::EMPTY),
                    ..Default::default()
                },
                Loc::EMPTY,
            );
        }
        Ok(())
    }
}

impl StmtList {
    pub fn reset(&mut self) {
        self.inside_wrapper_prefix.reset();
        self.outside_wrapper_prefix.clear();
        self.inside_wrapper_suffix.clear();
        self.all_stmts.clear();
    }

    // deinit → Drop (Vec fields free automatically)

    pub fn init() -> Self {
        Self {
            inside_wrapper_prefix: InsideWrapperPrefix::init(),
            outside_wrapper_prefix: Vec::new(),
            inside_wrapper_suffix: Vec::new(),
            all_stmts: Vec::new(),
        }
    }

    pub fn append_slice(&mut self, list: StmtListWhich, stmts: &[Stmt]) -> Result<(), AllocError> {
        match list {
            StmtListWhich::OutsideWrapperPrefix => self.outside_wrapper_prefix.extend_from_slice(stmts),
            StmtListWhich::InsideWrapperSuffix => self.inside_wrapper_suffix.extend_from_slice(stmts),
            StmtListWhich::AllStmts => self.all_stmts.extend_from_slice(stmts),
        }
        Ok(())
    }

    pub fn append(&mut self, list: StmtListWhich, stmt: Stmt) -> Result<(), AllocError> {
        match list {
            StmtListWhich::OutsideWrapperPrefix => self.outside_wrapper_prefix.push(stmt),
            StmtListWhich::InsideWrapperSuffix => self.inside_wrapper_suffix.push(stmt),
            StmtListWhich::AllStmts => self.all_stmts.push(stmt),
        }
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StmtListWhich {
    OutsideWrapperPrefix,
    InsideWrapperSuffix,
    AllStmts,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/LinkerContext.zig (2782 lines)
//   confidence: low
//   todos:      17
//   notes:      Heavy borrowck reshaping around recursive tree-shaking & MultiArrayList column slices; raw *mut backrefs (parse_graph/resolver) per LIFETIMES.tsv; many container_of! patterns for BundleV2.linker; allocator threading (arena vs global) needs Phase B audit; MatchImport.alias is arena-owned raw `*const [u8]`.
// ──────────────────────────────────────────────────────────────────────────
