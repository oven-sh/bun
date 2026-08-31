use crate::mal_prelude::*;

use crate::Error as BunError;
use crate::bake_types as bake;
use bun_alloc::{AllocError, Arena as Bump};
use bun_ast::{Data, Loc, Log, Range, Source};
use bun_ast::{ImportKind, ImportRecord};
use bun_collections::{ArrayHashMap, AutoBitSet, HashMap, MultiArrayList, VecExt, index_sort};
use bun_core::{self as bun, FeatureFlags, Output};
use bun_core::{MutableString, string_joiner::StringJoiner, strings};
use bun_sourcemap::{
    self as SourceMap, DebugIDFormatter, LineOffsetTable, SourceMapPieces, SourceMapState,
};

use crate::BundledAst as JSAst;
use bun_ast::{
    Binding, DeclaredSymbol, Dependency, ExportsKind, Expr, NamedImport, Part, Ref, Stmt, TlaCheck,
};
// Note: `crate::Index` (= `bun_ast::Index`) — the
// bundler's source-index newtype. `bun_ast::Index` is layout-identical
// but a distinct type; LinkerGraph/JSMeta/etc. are typed against the crate
// re-export, so use that here.
use crate::Index;
use bun_ast::{E, G, S};
use bun_js_parser::lexer as lex;
use bun_js_printer::{self as js_printer, renamer};

use crate::bun_node_fallbacks as NodeFallbackModules;
use bun_ast::SideEffects;

use crate::Graph::Graph;
use crate::options::{CompileMode, Format, Loader, SourceMapOption, Target};
use crate::transpiler::Transpiler;
use crate::{
    AdditionalFile, Chunk, CompileResultForSourceMap, ContentHasher, ImportTracker, LinkerGraph,
    MangledProps, PartRange, StableRef, WrapKind,
};

bun_core::declare_scope!(LinkerCtx, visible);
bun_core::declare_scope!(TreeShake, hidden);

// Scoped-log wrappers; re-exported so `linker_context/*` submodules import directly.
bun_core::define_scoped_log!(debug, crate::linker_context_mod::LinkerCtx);
pub(crate) use debug;
bun_core::define_scoped_log!(debug_tree_shake, crate::linker_context_mod::TreeShake);

// Re-exports from sibling modules in `linker_context/`.
// Module declarations live in `lib.rs::linker_context`.
pub(crate) use crate::linker_context::scan_imports_and_exports::scan_imports_and_exports;

pub(crate) use crate::linker_context::compute_chunks::compute_chunks;
pub use crate::linker_context::metafile_builder as MetafileBuilder;
// do_step5 / create_exports_for_file are inherent methods on LinkerContext (see
// `linker_context/doStep5.rs`), not free functions — no item re-export.
pub(crate) use crate::linker_context::compute_cross_chunk_dependencies::compute_cross_chunk_dependencies;
pub(crate) use crate::linker_context::generate_chunks_in_parallel::{
    compile_chunks, finalize_chunks,
};
pub(crate) use crate::linker_context::post_process_css_chunk::post_process_css_chunk;
pub(crate) use crate::linker_context::post_process_html_chunk::post_process_html_chunk;
pub(crate) use crate::linker_context::post_process_js_chunk::post_process_js_chunk;
pub(crate) use crate::linker_context::rename_symbols_in_chunk::rename_symbols_in_chunk;

pub struct LinkerContext<'a> {
    pub graph: LinkerGraph<'a>,
    /// Diagnostics from the link phase; appended to the bundle's log by
    /// [`Self::flush_log`].
    pub(crate) log: Log,

    pub(crate) cycle_detector: Vec<ImportTracker>,

    /// We may need to refer to the "__esm" and/or "__commonJS" runtime symbols
    pub(crate) cjs_runtime_ref: Ref,
    pub(crate) esm_runtime_ref: Ref,

    /// We may need to refer to the CommonJS "module" symbol for exports
    pub(crate) unbound_module_ref: Ref,

    /// We may need to refer to the "__promiseAll" runtime symbol
    pub(crate) promise_all_runtime_ref: Ref,

    pub(crate) options: LinkerOptions,

    /// string buffer containing prefix for each unique keys
    pub(crate) unique_key_prefix: Box<[u8]>,

    pub(crate) has_any_css_locals: bool,

    /// Used by Bake to extract []CompileResult before it is joined.
    /// CYCLEBREAK GENUINE: erased bake::DevServer (see bundle_v2::dispatch).
    pub dev_server: Option<crate::dispatch::DevServerHandle>,
    /// When Bun Bake is used, the resolved framework.
    pub framework: Option<bake::Framework>,

    pub(crate) mangled_props: MangledProps,

    /// One name per binding that crosses a chunk boundary, shared by the
    /// chunk that exports it and every chunk that imports it
    /// (`assign_cross_chunk_names`). Values live in the linker arena.
    pub(crate) cross_chunk_names: bun_collections::HashMap<bun_ast::Ref, bun_ast::StoreStr>,
}

impl<'a> Default for LinkerContext<'a> {
    fn default() -> Self {
        Self {
            graph: Default::default(),
            log: Log::init(),
            cycle_detector: Vec::new(),
            cjs_runtime_ref: Ref::NONE,
            esm_runtime_ref: Ref::NONE,
            unbound_module_ref: Ref::NONE,
            promise_all_runtime_ref: Ref::NONE,
            options: Default::default(),
            unique_key_prefix: Box::default(),
            has_any_css_locals: false,
            dev_server: None,
            framework: None,
            mangled_props: Default::default(),
            cross_chunk_names: Default::default(),
        }
    }
}

/// What the link step reads of the bundle besides its own [`LinkerContext`].
#[derive(Clone, Copy)]
pub struct LinkInputs<'r, 'a> {
    pub pg: &'r Graph<'a>,
    pub pool: &'r crate::ThreadPool<'a>,
    /// Some parsed file is a CSS module with local names.
    pub has_any_css_locals: bool,
    /// The bundle thread's transpilers, for their options.
    pub transpiler: &'r Transpiler<'a>,
    pub client_transpiler: Option<&'r Transpiler<'a>>,
    pub unique_key: u64,
}

// SAFETY: handed to the source-map jobs (`SourceMapJob`), which only read
// `pg`'s sources/loaders — immutable for the link step — and use `pool`,
// which is built for cross-thread use; the batch is joined before the link
// step ends.
unsafe impl Sync for LinkInputs<'_, '_> {}

/// What the link phase's worker tasks share, read-only, while the bundle
/// thread waits for them (`each*` / `JobBatch`).
#[derive(Clone, Copy)]
pub struct LinkShared<'r, 'a> {
    pub(crate) c: &'r LinkerContext<'a>,
    pub(crate) graph: &'r Graph<'a>,
    pub(crate) pool: &'r crate::ThreadPool<'a>,
    /// Every chunk — empty while a phase hands chunks out `&mut`.
    pub(crate) chunks: &'r [Chunk],
    /// `chunks[i].unique_key`, for phases that hand chunks out `&mut`.
    pub(crate) chunk_unique_keys: &'r [&'static [u8]],
}

// SAFETY: a `LinkShared` is handed to pool tasks while the bundle thread is
// blocked joining them; the tasks only read through `c`/`graph` (their
// per-chunk output goes to the `&mut` element each is handed separately),
// and `pool` is built for cross-thread use.
unsafe impl Sync for LinkShared<'_, '_> {}
// SAFETY: as above.
unsafe impl Send for LinkShared<'_, '_> {}

impl<'r, 'a> LinkShared<'r, 'a> {
    /// The calling thread's worker (its arenas and AST store).
    #[inline]
    pub(crate) fn worker(&self) -> crate::thread_pool::WorkerGuard<'r, 'a> {
        self.pool.get_worker()
    }
}

impl<'a> LinkerContext<'a> {
    /// Move the link phase's diagnostics into `log` (the bundle's).
    pub(crate) fn flush_log(&mut self, log: &mut Log) {
        if !self.log.msgs.is_empty() {
            let mut taken = Log::init();
            taken.level = self.log.level;
            taken.clone_line_text = self.log.clone_line_text;
            core::mem::replace(&mut self.log, taken).append_to_with_recycled(log, true);
        }
    }

    /// An `import()` — or a split `require()` — whose target is a
    /// chunk entry point: the record is resolved at runtime against the
    /// target's chunk instead of binding to a wrapper.
    pub(crate) fn is_external_dynamic_import(
        &self,
        record: &ImportRecord,
        source_index: u32,
    ) -> bool {
        use crate::linker_graph::FileColumns as _;
        if !self.graph.code_splitting || record.source_index.get() == source_index {
            return false;
        }
        let crosses_chunk = match record.kind {
            ImportKind::Dynamic => true,
            ImportKind::Require => record
                .flags
                .contains(bun_ast::ImportRecordFlags::CROSS_CHUNK_REQUIRE),
            _ => false,
        };
        crosses_chunk
            && self.graph.files.items_entry_point_kind()[record.source_index.get() as usize]
                .is_entry_point()
    }

    /// `"sideEffects": false` (or the resolver's equivalent), unless
    /// `--ignore-dce-annotations` says not to trust it.
    pub(crate) fn file_has_no_side_effects(&self, pg: &Graph<'a>, source_index: u32) -> bool {
        pg.input_files.items_side_effects()[source_index as usize] != SideEffects::HasSideEffects
            && !self.options.ignore_dce_annotations
    }

    /// Note: this should call a `MimallocArena` debug hook
    /// (`helpCatchMemoryIssues`), but `Graph.heap` is currently
    /// `bun_alloc::Arena = bumpalo::Bump`, which has no such hook, so this is a
    /// no-op until the arena type is swapped to the real `MimallocArena`. The
    /// call sites are already gated on `FeatureFlags::HELP_CATCH_MEMORY_ISSUES`.
    #[inline]
    pub(crate) fn check_for_memory_corruption(&self) {
        // For this to work, you need mimalloc's debug build enabled.
        //    make mimalloc-debug
    }
}

// Local re-exports for the tree-shaking impl below. `EntryPoint::Kind`
// and `SideEffects` live in sibling modules. Re-export so `EntryPoint::Kind` here is the
// *same type* `items_entry_point_kind()` returns.
#[allow(non_snake_case)]
pub mod EntryPoint {
    pub(crate) use crate::entry_point::Kind;
}
use crate::bundled_ast::Flags as AstFlags;
use crate::generic_path_with_pretty_initialized;
type DeclaredSymbolList = bun_ast::DeclaredSymbolList;

impl<'a> LinkerContext<'a> {
    pub(crate) fn arena(&self) -> &Bump {
        // LinkerGraph owns (a backref to) the bundle arena; see `LinkerGraph::arena`.
        self.graph.arena()
    }

    /// `arena` must be the arena owned by the thread making this call — on
    /// worker threads (chunk post-processing) that is `worker.arena()`, NOT
    /// `self.arena()` (the bundle-thread graph arena). `generic_path_with_pretty_initialized`
    /// allocates the duped display path from it, and `MimallocArena` asserts
    /// single-thread ownership, so passing the wrong arena is a cross-thread
    /// allocation (debug panic / release heap corruption).
    pub(crate) fn path_with_pretty_initialized(
        &self,
        path: &bun_paths::fs::Path<'static>,
        arena: &Bump,
    ) -> Result<bun_paths::fs::Path<'static>, BunError> {
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
        generic_path_with_pretty_initialized(path, self.options.target, top_level_dir, arena)
    }

    pub(crate) fn should_include_part(&self, source_index: crate::IndexInt, part: &Part) -> bool {
        // As an optimization, ignore parts containing a single import statement to
        // an internal non-wrapped file. These will be ignored anyway and it's a
        // performance hit to include the part only to discover it's unnecessary later.
        let stmts: &[Stmt] = part.stmts.slice();
        if stmts.len() == 1 {
            if let Some(s_import) = stmts[0].data.s_import() {
                let record = &self.graph.ast.items_import_records()[source_index as usize]
                    [s_import.import_record_index as usize];
                if record.source_index.is_valid()
                    && self.graph.meta.items_flags()[record.source_index.get() as usize].wrap
                        == WrapKind::None
                {
                    return false;
                }
            }
        }

        true
    }

    /// Clone the parse graph into the linker graph and set the link phase
    /// up. `dyn_entry_points` is consumed.
    pub(crate) fn load(
        &mut self,
        inputs: &LinkInputs<'_, 'a>,
        dyn_entry_points: &mut bun_collections::ArrayHashMap<crate::IndexInt, ()>,
        reachable: &[Index],
    ) -> Result<(), BunError> {
        let LinkInputs {
            pg,
            transpiler,
            has_any_css_locals,
            ..
        } = *inputs;
        let _trace = bun::perf::trace("Bundler.CloneLinkerGraph");
        self.has_any_css_locals = has_any_css_locals;
        let entry_points: &[Index] = pg.entry_points.as_slice();
        let server_component_boundaries = &pg.server_component_boundaries;

        self.graph.code_splitting = transpiler.options.code_splitting;
        self.options
            .output_dir
            .clone_from(&transpiler.resolver.opts.output_dir);
        self.options
            .root_dir
            .clone_from(&transpiler.resolver.opts.root_dir);
        self.options.supports_multiple_outputs = transpiler.resolver.opts.supports_multiple_outputs;
        self.options.compile = transpiler.resolver.opts.compile;
        self.options
            .entry_naming
            .clone_from(&transpiler.options.entry_naming);
        self.options
            .chunk_naming
            .clone_from(&transpiler.options.chunk_naming);
        if let Some(client) = inputs.client_transpiler {
            self.options.browser_public_path = Some(client.options.public_path.clone());
            self.options.browser_entry_naming = Some(client.options.entry_naming.clone());
            self.options.browser_chunk_naming = Some(client.options.chunk_naming.clone());
        }
        self.cycle_detector = Vec::new();

        self.graph.reachable_files = reachable.to_vec();

        let sources: &[Source] = pg.input_files.items_source();

        self.graph.load(
            entry_points,
            sources,
            server_component_boundaries,
            dyn_entry_points.keys(),
            &pg.entry_point_original_names,
        )?;
        dyn_entry_points.clear_retaining_capacity();

        let runtime_named_exports =
            &self.graph.ast.items_named_exports()[Index::RUNTIME.get() as usize];

        self.esm_runtime_ref = runtime_named_exports
            .get(b"__esm")
            .expect("infallible: runtime export")
            .ref_;
        self.cjs_runtime_ref = runtime_named_exports
            .get(b"__commonJS")
            .expect("infallible: runtime export")
            .ref_;
        self.promise_all_runtime_ref = runtime_named_exports
            .get(b"__promiseAll")
            .expect("infallible: runtime export")
            .ref_;

        if self.options.output_format == Format::Cjs {
            self.unbound_module_ref = self.graph.generate_new_symbol(
                Index::RUNTIME.get(),
                bun_ast::symbol::Kind::Unbound,
                b"module",
            );
        }

        if self.options.output_format == Format::Cjs || self.options.output_format == Format::Iife {
            // Note: reshaped for borrowck — `Slice<T>` is a value-type
            // snapshot of column pointers (does not borrow `self.graph.ast`),
            // so `split_mut()` on the local can coexist with the
            // `self.graph.meta` borrow below. The slab does not reallocate for
            // the duration of this loop.
            let mut ast_slice = self.graph.ast.slice();
            let ast_cols = ast_slice.split_mut();
            let exports_kind: &mut [ExportsKind] = ast_cols.exports_kind;
            let ast_flags_list: &mut [AstFlags] = ast_cols.flags;
            let meta_flags_list = self.graph.meta.items_flags_mut();

            for entry_point in entry_points.iter() {
                let ast_flags: AstFlags = ast_flags_list[entry_point.get() as usize];

                // Loaders default to CommonJS when they are the entry point and the output
                // format is not ESM-compatible since that avoids generating the ESM-to-CJS
                // machinery.
                if ast_flags.contains(AstFlags::HAS_LAZY_EXPORT) {
                    exports_kind[entry_point.get() as usize] = ExportsKind::Cjs;
                }

                // Entry points with ES6 exports must generate an exports object when
                // targeting non-ES6 formats. Note that the IIFE format only needs this
                // when the global name is present, since that's the only way the exports
                // can actually be observed externally.
                if ast_flags.contains(AstFlags::USES_EXPORT_KEYWORD) {
                    ast_flags_list[entry_point.get() as usize].insert(AstFlags::USES_EXPORTS_REF);
                    meta_flags_list[entry_point.get() as usize]
                        .force_include_exports_for_entry_point = true;
                }
            }
        }

        Ok(())
    }

    /// Start computing line-offset tables and quoted contents for every
    /// reachable file on the pool; [`SourceMapJobs`] hands them over once
    /// joined.
    pub(crate) fn compute_data_for_source_map<'r>(
        &self,
        inputs: &'r LinkInputs<'r, 'a>,
        reachable: &[Index],
    ) -> SourceMapJobs<'r, 'a> {
        debug_assert!(self.options.source_maps != SourceMapOption::None);
        let newline_counts = self.graph.ast.items_approximate_newline_count();
        let job = |quoted: bool| {
            move |source_index: &Index| SourceMapJob {
                source_index: source_index.get(),
                approximate_newline_count: newline_counts[source_index.get() as usize] as u32,
                line_offsets: None,
                quoted_contents: if quoted { Some(None) } else { None },
            }
        };
        let mut line_offsets =
            bun_threading::JobBatch::new(inputs, reachable.iter().map(job(false)));
        let mut quoted = bun_threading::JobBatch::new(inputs, reachable.iter().map(job(true)));
        let mut batch = line_offsets.as_batch();
        // line offsets block sooner and are faster to compute, so we should schedule those first
        batch.push(quoted.as_batch());
        inputs.pool.worker_pool().schedule(batch);
        SourceMapJobs {
            line_offsets: Some(line_offsets),
            quoted: Some(quoted),
        }
    }

    fn process_html_import_files(&mut self, pg: &Graph<'a>) {
        let server_len = pg.html_imports.server_source_indices.len();
        debug_assert_eq!(server_len, pg.html_imports.html_source_indices.len());
        if server_len > 0 {
            let actual_ref = self.graph.runtime_function(b"__jsonParse");

            for i in 0..server_len as usize {
                let html_import: u32 = pg.html_imports.server_source_indices.slice()[i];

                // S.LazyExport is a call to __jsonParse. Each accessor returns
                // `Option`; `.unwrap()` panics on shape mismatch.
                let original_ref = (*self.graph.ast.items_parts()[html_import as usize][1].stmts)
                    [0]
                .data
                .s_lazy_export()
                .unwrap()
                .e_call()
                .unwrap()
                .target
                .data
                .e_import_identifier()
                .unwrap()
                .ref_;

                // Make the __jsonParse in that file point to the __jsonParse in the runtime chunk.
                self.graph
                    .symbols
                    .get_mut(original_ref)
                    .expect("infallible: ref in symbol table")
                    .link
                    .set(actual_ref);

                // When --splitting is enabled, we have to make sure we import the __jsonParse function.
                self.graph
                    .generate_symbol_import_and_use(
                        html_import,
                        Index::part(1u32).get(),
                        actual_ref,
                        1,
                        Index::RUNTIME,
                    )
                    .expect("OOM");
            }
        }
    }

    /// The link step proper: everything from cloning the graph to computing
    /// chunks and their cross-chunk dependencies. `pg.html_imports.
    /// html_source_indices` is already filled in. Diagnostics go to
    /// `self.log`; the caller flushes it.
    #[inline(never)]
    pub(crate) fn link<'r>(
        &mut self,
        inputs: &'r LinkInputs<'r, 'a>,
        dyn_entry_points: &mut bun_collections::ArrayHashMap<crate::IndexInt, ()>,
        has_any_top_level_await_modules: bool,
        reachable: &[Index],
    ) -> Result<(Box<[Chunk]>, SourceMapJobs<'r, 'a>), LinkError> {
        let LinkInputs {
            pg,
            pool,
            transpiler,
            unique_key,
            ..
        } = *inputs;
        self.load(inputs, dyn_entry_points, reachable)?;

        let mut source_map_jobs = SourceMapJobs::default();
        if self.options.source_maps != SourceMapOption::None {
            source_map_jobs = self.compute_data_for_source_map(inputs, reachable);
        }

        self.process_html_import_files(pg);

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        // Validate top-level await for all files first.
        if has_any_top_level_await_modules {
            let input_files = pg.input_files.items_source();
            let mut ast = self.graph.ast.slice();
            let ast_cols = ast.split_mut();
            let import_records_list: &[bun_ast::import_record::List<'a>] = ast_cols.import_records;
            let css_asts: &[crate::bundled_ast::CssCol] = ast_cols.css;
            let tla_keywords: &[Range] = ast_cols.top_level_await_keyword;
            let tla_checks: &mut [TlaCheck] = ast_cols.tla_check;
            let flags = self.graph.meta.items_flags_mut();
            let files_len = self.graph.files.len();
            let import_records_len = import_records_list.len();

            // Process all files in source index order, like esbuild does
            let mut source_index: u32 = 0;
            while (source_index as usize) < files_len {
                // Skip runtime
                if source_index == Index::RUNTIME.get() {
                    source_index += 1;
                    continue;
                }

                // Skip if not a JavaScript AST
                if source_index as usize >= import_records_len {
                    source_index += 1;
                    continue;
                }

                // Skip CSS files
                if css_asts[source_index as usize].is_some() {
                    source_index += 1;
                    continue;
                }

                Self::validate_tla(
                    &mut self.log,
                    source_index,
                    tla_keywords,
                    tla_checks,
                    input_files,
                    flags,
                    import_records_list,
                );

                source_index += 1;
            }

            // after validation propagate async through all importers.
            self.graph.propagate_async_dependencies()?;
        }

        scan_imports_and_exports(self, pg, pool)?;

        // Stop now if there were errors
        if self.log.has_errors() || transpiler.log().has_errors() {
            return Err(LinkError::BuildFailed);
        }

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        self.tree_shaking_and_code_splitting(pg)?;

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        let mut chunks = compute_chunks(
            self,
            pg,
            pool,
            &pg.html_imports.html_source_indices,
            unique_key,
        )?;

        if self.log.has_errors() || transpiler.log().has_errors() {
            return Err(LinkError::BuildFailed);
        }

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        compute_cross_chunk_dependencies(self, pg, &mut chunks)?;

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            self.check_for_memory_corruption();
        }

        self.graph.symbols.follow_all();

        Ok((chunks, source_map_jobs))
    }

    pub(crate) fn tree_shaking_and_code_splitting(
        &mut self,
        pg: &Graph<'a>,
    ) -> Result<(), AllocError> {
        let _trace = bun::perf::trace("Bundler.treeShakingAndCodeSplitting");

        // Size the per-file part-liveness bitsets now that `scan_imports_and_exports`
        // has finished pushing wrapper / entry-point parts.
        {
            let loaders = pg.input_files.items_loader();
            let parts_col = self.graph.ast.items_parts();
            let mut parts_live: Vec<bun_collections::AutoBitSet> =
                Vec::with_capacity(parts_col.len());
            for (i, parts) in parts_col.iter().enumerate() {
                let mut bits = bun_collections::AutoBitSet::init_empty(parts.len())?;
                // The HTML loader's `ParseTask` builds its synthetic part 1 already
                // live (so the JS-chunk visitor follows every embedded import record).
                // `mark_file_live_for_tree_shaking` short-circuits for HTML and never
                // walks its parts, so seed the bit here to preserve the old
                // `Part::is_live = true` initializer.
                if loaders.get(i).is_some_and(|l| *l == Loader::Html) && parts.len() > 1 {
                    bits.set(1);
                }
                parts_live.push(bits);
            }
            self.graph.parts_live = parts_live;
        }

        // Every column the passes below touch, split out of `self.graph` so
        // the worklist steps can take `files_live` alongside.
        let LinkerGraph {
            ast,
            parts_live,
            files,
            entry_points,
            files_live,
            meta,
            code_splitting,
            ..
        } = &mut self.graph;
        let ast = ast.slice();
        let parts: &[bun_ast::PartList<'a>] = ast.items_parts();
        let import_records: &[bun_ast::import_record::List<'a>] = ast.items_import_records();
        let css_reprs: &[crate::bundled_ast::CssCol] = ast.items_css();
        let parts_live: &mut [bun_collections::AutoBitSet] = parts_live.as_mut_slice();
        let side_effects: &[SideEffects] = pg.input_files.items_side_effects();
        let loaders: &[Loader] = pg.input_files.items_loader();
        let entry_points: &[crate::IndexInt] = entry_points.items_source_index();
        let mut files = files.slice();
        let file_cols = files.split_mut();
        let entry_point_kinds: &[EntryPoint::Kind] = file_cols.entry_point_kind;
        let distances: &mut [u32] = file_cols.distance_from_entry_point;
        let file_entry_bits: &mut [AutoBitSet] = file_cols.entry_bits;
        let meta_flags: &[crate::js_meta::Flags] = meta.items_flags();
        let mut shake = TreeShaker {
            options: &self.options,
            files_live,
            code_splitting: *code_splitting,
            entry_point_kinds,
            ast_len: parts.len(),
        };
        let entry_points_len = entry_points.len();

        {
            let _trace2 = bun::perf::trace("Bundler.markFileLiveForTreeShaking");

            let mut ctx = TreeShakeCtx {
                side_effects,
                loaders,
                meta_flags,
                #[cfg(debug_assertions)]
                sources: pg.input_files.items_source(),
                #[cfg(debug_assertions)]
                targets: pg.ast.items_target(),
                parts,
                parts_live: &mut *parts_live,
                import_records,
                entry_point_kinds,
                css_reprs,
                worklist: Vec::new(),
            };

            // Tree shaking: Each entry point marks all files reachable from itself.
            // `import()` targets are marked live from the live part that holds
            // the `import()` instead (see `mark_part_live_step`).
            let root_dynamic_imports = !self.options.tree_shaking;
            for i in 0..entry_points_len {
                let entry_point = entry_points[i];
                if !root_dynamic_imports
                    && entry_point_kinds[entry_point as usize] == EntryPoint::Kind::DynamicImport
                {
                    continue;
                }
                shake.mark_file_live_for_tree_shaking(&mut ctx, entry_point);
            }
        }

        {
            let _trace2 = bun::perf::trace("Bundler.markFileReachableForCodeSplitting");

            // AutoBitSet needs to be initialized if it is dynamic
            if AutoBitSet::needs_dynamic(entry_points_len) {
                for bits in file_entry_bits.iter_mut() {
                    *bits = AutoBitSet::init_empty(entry_points_len)?;
                }
            } else if !file_entry_bits.is_empty() {
                // assert that the tag is correct
                debug_assert!(matches!(&file_entry_bits[0], AutoBitSet::Static(_)));
            }

            let mut ctx = CodeSplitCtx {
                distances,
                parts,
                import_records,
                file_entry_bits,
                css_reprs,
                queue: std::collections::VecDeque::new(),
            };

            // Code splitting: Determine which entry points can reach which files. This
            // has to happen after tree shaking because there is an implicit dependency
            // between live parts within the same file. All liveness has to be computed
            // first before determining which entry points can reach which files.
            for i in 0..entry_points_len {
                let entry_point = entry_points[i];
                shake.mark_file_reachable_for_code_splitting(&mut ctx, entry_point, i, 0);
            }
        }

        Ok(())
    }

    /// `each_mut` callback (worker threads, one per chunk): post-process
    /// `chunk` into its intermediate output.
    pub(crate) fn generate_chunk(ctx: &LinkShared<'_, 'a>, chunk: &mut Chunk, chunk_index: usize) {
        let mut worker = ctx.worker();
        let result = match chunk.content {
            crate::chunk::Content::Javascript(_) => {
                post_process_js_chunk(*ctx, &mut worker, chunk, chunk_index)
            }
            crate::chunk::Content::Css(_) => post_process_css_chunk(*ctx, &mut worker, chunk),
            crate::chunk::Content::Html => post_process_html_chunk(*ctx, &mut worker, chunk),
        };
        if let Err(err) = result {
            Output::panic(format_args!("TODO: handle error: {}", err.name()));
        }
    }

    /// `each_mut` callback (worker threads, one per chunk): compute the
    /// chunk's symbol renamer.
    /// Second half of the minifying renamer under code splitting: names every
    /// slot `assign_cross_chunk_names` did not pin. Writes `chunk.renamer` only.
    pub(crate) fn finish_js_renamer(_ctx: &LinkShared<'_, 'a>, chunk: &mut Chunk, _: usize) {
        if let crate::bun_renamer::ChunkRenamer::Minify(r) = &mut chunk.renamer {
            // Only allocation can fail here.
            bun_core::handle_oom(r.finish());
        }
    }

    pub(crate) fn generate_js_renamer(
        ctx: &LinkShared<'_, 'a>,
        chunk: &mut Chunk,
        chunk_index: usize,
    ) {
        let _ = chunk_index;
        let _worker = ctx.worker();
        if let crate::chunk::Content::Javascript(js) = &chunk.content {
            let renamer = rename_symbols_in_chunk(ctx.c, &*chunk, &js.files_in_chunk_order)
                .expect("TODO: handle error");
            chunk.renamer = renamer;
        }
    }

    /// The relative path from the chunk directory to a file source, as written
    /// into the source map's `sources` array. `sources` entries are URLs, so the
    /// host separator is normalized to `/` (the invariant `Path::pretty` holds).
    fn source_map_relative_path(
        chunk_abs_dir: &[u8],
        source_abs_path: &[u8],
    ) -> Result<Box<[u8]>, AllocError> {
        let mut rel = bun_paths::resolve_path::relative_alloc(chunk_abs_dir, source_abs_path)?;
        bun_paths::resolve_path::platform_to_posix_in_place::<u8>(&mut rel);
        Ok(rel)
    }

    pub(crate) fn generate_source_map_for_chunk(
        &self,
        pg: &Graph<'a>,
        isolated_hash: u64,
        results: &MultiArrayList<CompileResultForSourceMap>,
        chunk_abs_dir: &[u8],
        can_have_shifts: bool,
    ) -> Result<SourceMapPieces, BunError> {
        let _trace = bun::perf::trace("Bundler.generateSourceMapForChunk");

        let mut j = StringJoiner::default();

        let sources = pg.input_files.items_source();
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

        let source_indices = results.items_source_index();

        j.push_static(b"{\n  \"version\": 3,\n  \"sources\": [");
        if !source_indices.is_empty() {
            {
                let index = source_indices[0];
                let path = &sources[index as usize].path;
                source_id_map.put_no_clobber(index, 0)?;

                // Note: the relative path lives in a local owned buffer
                // (drops at scope exit).
                let rel_path_storage;
                let pretty: &[u8] = if path.is_file() {
                    rel_path_storage = Self::source_map_relative_path(chunk_abs_dir, path.text)?;
                    &rel_path_storage
                } else {
                    path.pretty
                };

                let mut quote_buf = MutableString::init(pretty.len() + 2)?;
                js_printer::quote_for_json(pretty, &mut quote_buf, false)?;
                // `to_default_owned` moves the buffer into the joiner
                // (joiner owns it until `done`).
                j.push_owned(quote_buf.to_default_owned());
            }

            let mut next_mapping_source_index: i32 = 1;
            for &index in &source_indices[1..] {
                let gop = source_id_map.get_or_put(index)?;
                if gop.found_existing {
                    continue;
                }

                *gop.value_ptr = next_mapping_source_index;
                next_mapping_source_index += 1;

                let path = &sources[index as usize].path;

                let rel_path_storage;
                let pretty: &[u8] = if path.is_file() {
                    rel_path_storage = Self::source_map_relative_path(chunk_abs_dir, path.text)?;
                    &rel_path_storage
                } else {
                    path.pretty
                };

                let mut quote_buf = MutableString::init(pretty.len() + ", ".len() + 2)?;
                quote_buf.append_assume_capacity(b", ");
                js_printer::quote_for_json(pretty, &mut quote_buf, false)?;
                j.push_owned(quote_buf.to_default_owned());
            }
        }

        j.push_static(b"],\n  \"sourcesContent\": [");

        let source_indices_for_contents = source_id_map.keys();
        if !source_indices_for_contents.is_empty() {
            j.push_static(b"\n    ");
            j.push_static(
                quoted_source_map_contents[source_indices_for_contents[0] as usize]
                    .as_deref()
                    .unwrap_or(b""),
            );

            for &index in &source_indices_for_contents[1..] {
                j.push_static(b",\n    ");
                j.push_static(
                    quoted_source_map_contents[index as usize]
                        .as_deref()
                        .unwrap_or(b""),
                );
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
        for ((chunk, offset), &current_source_index) in source_map_chunks
            .iter()
            .zip(offsets.iter())
            .zip(source_indices.iter())
        {
            let mapping_source_index = *source_id_map
                .get(&current_source_index)
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

            SourceMap::append_source_map_chunk(
                &mut j,
                prev_end_state,
                start_state,
                &chunk.buffer.list,
            )?;

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
            let mut buf = Vec::<u8>::new();
            use std::io::Write;
            write!(&mut buf, "{}", DebugIDFormatter { id: isolated_hash })
                .expect("infallible: in-memory write");
            j.push_owned(buf.into_boxed_slice());
            j.push_static(b"\",\n  \"names\": []\n}");
        } else {
            j.push_static(b"\",\n  \"names\": []\n}");
        }

        let done = j.done()?;
        debug_assert!(done[0] == b'{');

        let mut pieces = SourceMapPieces::init();
        if can_have_shifts {
            pieces.prefix.extend_from_slice(&done[0..mapping_start]);
            pieces
                .mappings
                .extend_from_slice(&done[mapping_start..mapping_end]);
            pieces.suffix.extend_from_slice(&done[mapping_end..]);
        } else {
            // No shifts → `finalize()` returns `prefix` verbatim. Move the
            // joined buffer instead of allocating a fresh `Vec` and memcpying
            // it; for the bundled three.js x100 case the source map JSON is
            // ~300 MB, so this alloc+copy was ~20% of the build.
            pieces.prefix = done.into_vec();
        }

        Ok(pieces)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScanCssImportsResult {
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

bun_core::oom_from_alloc!(LinkError);
impl From<BunError> for LinkError {
    fn from(e: BunError) -> Self {
        // OOM keeps its identity through
        // `load()`, so OOMs travelling as `crate::Error` must not be
        // misreported as build failures. Everything else collapses to
        // `BuildFailed`; user-facing diagnostics flow through the bundler `Log`,
        // not this variant.
        if matches!(e, BunError::Alloc(_)) {
            LinkError::OutOfMemory
        } else {
            LinkError::BuildFailed
        }
    }
}

pub struct LinkerOptions {
    pub(crate) generate_bytecode_cache: bool,
    pub(crate) generate_internal_module_bytecode: bool,
    /// See `CompileTargetBuiltins::Target`.
    pub(crate) target_builtins: Option<std::sync::Arc<[u8]>>,
    pub(crate) bytecode_depth: u32,
    pub(crate) output_format: Format,
    pub(crate) ignore_dce_annotations: bool,
    pub(crate) emit_dce_annotations: bool,
    pub(crate) tree_shaking: bool,
    pub(crate) minify_whitespace: bool,
    pub(crate) minify_syntax: bool,
    pub(crate) minify_identifiers: bool,
    pub(crate) banner: std::borrow::Cow<'static, [u8]>,
    pub(crate) footer: std::borrow::Cow<'static, [u8]>,
    pub(crate) css_chunking: bool,
    /// Code splitting: side-effect-free chunks whose summed source size is
    /// below this also fold into a chunk more entry points load (0 = off).
    /// See `merge_small_chunks`.
    pub(crate) min_chunk_size: u64,
    pub(crate) source_maps: SourceMapOption,
    pub(crate) target: Target,
    pub(crate) compile_mode: CompileMode,
    pub(crate) metafile: bool,
    /// Path to write JSON metafile (for Bun.build API)
    pub(crate) metafile_json_path: Box<[u8]>,
    /// Path to write markdown metafile (for Bun.build API)
    pub(crate) metafile_markdown_path: Box<[u8]>,

    pub(crate) mode: LinkerOptionsMode,

    pub(crate) public_path: Box<[u8]>,
    /// The client transpiler's `public_path`, for browser chunks of a
    /// server build (set once that transpiler exists).
    pub(crate) browser_public_path: Option<Box<[u8]>>,
    /// `resolver.opts.*` of the bundle's transpiler.
    pub(crate) compile: bool,
    pub(crate) entry_naming: Box<[u8]>,
    pub(crate) chunk_naming: Box<[u8]>,
    /// The client transpiler's, for browser chunks of a server build.
    pub(crate) browser_entry_naming: Option<Box<[u8]>>,
    pub(crate) browser_chunk_naming: Option<Box<[u8]>>,
    pub(crate) output_dir: Box<[u8]>,
    pub(crate) root_dir: Box<[u8]>,
    pub(crate) supports_multiple_outputs: bool,
}

impl LinkerOptions {
    /// ESM bytecode in a `--compile` build: JSC does not parse the chunk, so
    /// its `JSModuleRecord` is built from a `ModuleInfo` the linker records
    /// while printing (see `post_process_js_chunk`).
    pub(crate) fn generates_module_info(&self) -> bool {
        self.generate_bytecode_cache
            && self.output_format == Format::Esm
            && self.compile_mode.is_executable()
    }
}

impl Default for LinkerOptions {
    fn default() -> Self {
        Self {
            generate_bytecode_cache: false,
            generate_internal_module_bytecode: false,
            target_builtins: None,
            bytecode_depth: u32::MAX,
            output_format: Format::Esm,
            ignore_dce_annotations: false,
            emit_dce_annotations: true,
            tree_shaking: true,
            minify_whitespace: false,
            minify_syntax: false,
            minify_identifiers: false,
            banner: std::borrow::Cow::Borrowed(b""),
            footer: std::borrow::Cow::Borrowed(b""),
            css_chunking: false,
            min_chunk_size: 0,
            source_maps: SourceMapOption::None,
            target: Target::Browser,
            compile_mode: CompileMode::None,
            metafile: false,
            metafile_json_path: Box::default(),
            metafile_markdown_path: Box::default(),
            mode: LinkerOptionsMode::Bundle,
            public_path: Box::default(),
            browser_public_path: None,
            compile: false,
            entry_naming: Box::default(),
            chunk_naming: Box::default(),
            browser_entry_naming: None,
            browser_chunk_naming: None,
            output_dir: Box::default(),
            root_dir: Box::default(),
            supports_multiple_outputs: true,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LinkerOptionsMode {
    Passthrough,
    Bundle,
}

/// The source-map precomputations started by
/// [`LinkerContext::compute_data_for_source_map`], running on the pool while
/// the link step continues. Dropping this waits for them.
#[derive(Default)]
pub struct SourceMapJobs<'r, 'a> {
    line_offsets: Option<bun_threading::JobBatch<'r, LinkInputs<'r, 'a>, SourceMapJob>>,
    quoted: Option<bun_threading::JobBatch<'r, LinkInputs<'r, 'a>, SourceMapJob>>,
}

impl<'r, 'a> SourceMapJobs<'r, 'a> {
    /// Join the line-offset jobs and store their tables in `graph.files`.
    pub(crate) fn finish_line_offsets(&mut self, graph: &mut LinkerGraph<'a>) {
        let Some(jobs) = self.line_offsets.take() else {
            return;
        };
        debug!(" START {} source maps (line offset)", jobs.len());
        let tables = graph.files.items_line_offset_table_mut();
        for mut job in jobs.finish() {
            if let Some(table) = job.line_offsets.take() {
                tables[job.source_index as usize] = table;
            }
        }
        debug!("  DONE source maps (line offset)");
    }

    /// Join the quoted-contents jobs and store their output in `graph.files`.
    pub(crate) fn finish_quoted_contents(&mut self, graph: &mut LinkerGraph<'a>) {
        let Some(jobs) = self.quoted.take() else {
            return;
        };
        debug!(" START {} source maps (quoted contents)", jobs.len());
        let column = graph.files.items_quoted_source_contents_mut();
        for mut job in jobs.finish() {
            column[job.source_index as usize] = job.quoted_contents.take().flatten();
        }
        debug!("  DONE source maps (quoted contents)");
    }
}

/// One file's line-offset table (`quoted_contents == None`) or quoted
/// source contents (`quoted_contents == Some(_)`), computed on a worker.
pub(crate) struct SourceMapJob {
    source_index: crate::IndexInt,
    approximate_newline_count: u32,
    line_offsets: Option<SourceMap::line_offset_table::List<bun_alloc::AstAlloc>>,
    quoted_contents: Option<Option<bun_alloc::AstVec<u8>>>,
}

impl<'r, 'a> bun_threading::BatchJob<LinkInputs<'r, 'a>> for SourceMapJob {
    fn run(&mut self, inputs: &LinkInputs<'r, 'a>) {
        // The worker's AST store is where the `AstAlloc` output below lands
        // (bulk-freed on `pool.deinit()`).
        let _worker = inputs.pool.get_worker();
        let source: &Source = &inputs.pg.input_files.items_source()[self.source_index as usize];
        let loader: Loader = inputs.pg.input_files.items_loader()[self.source_index as usize];
        if self.quoted_contents.is_some() {
            debug!("Computing Quoted Source Contents: {}", self.source_index);
            if !loader.can_have_source_map() {
                return;
            }
            // ~12.5% escape-expansion slack matches `quote_for_json`'s heuristic
            // so the writer rarely reallocs. The slack is dropped with the arena
            // at bundle end, and `StringJoiner` only borrows a `&[u8]` view
            // downstream.
            let contents: &[u8] = &source.contents;
            let mut buf = bun_alloc::AstAlloc::vec_with_capacity::<u8>(
                contents.len() + (contents.len() >> 3) + 8,
            );
            buf.push(b'"');
            js_printer::write_pre_quoted_string_inner::<_, { js_printer::Encoding::Utf8 }>(
                contents, &mut buf, b'"', false, true,
            )
            .expect("OOM");
            buf.push(b'"');
            self.quoted_contents = Some(Some(buf));
        } else {
            debug!("Computing LineOffsetTable: {}", self.source_index);
            if !loader.can_have_source_map() {
                // This is not a file which we support generating source maps for
                self.line_offsets = Some(SourceMap::line_offset_table::List::new_in(
                    bun_alloc::AstAlloc,
                ));
                return;
            }
            self.line_offsets = Some(
                LineOffsetTable::generate_in::<bun_alloc::AstAlloc>(
                    &source.contents,
                    // We don't support sourcemaps for source files with more than 2^31 lines
                    (self.approximate_newline_count & 0x7FFF_FFFF) as i32,
                )
                .expect("OOM"),
            );
        }
    }
}

// Clone: bitwise OK — `alias` borrows from the AST arena (non-owning); all
// other fields are POD.
#[derive(Clone, Default)]
pub struct MatchImport {
    alias: bun_ast::StoreStr, // string borrowed from AST arena
    kind: MatchImportKind,
    namespace_ref: Ref,
    source_index: u32,
    name_loc: Loc, // Optional, goes with sourceIndex, ignore if zero,
    other_source_index: u32,
    other_name_loc: Loc, // Optional, goes with otherSourceIndex, ignore if zero,
    r#ref: Ref,
}

#[derive(Default, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MatchImportKind {
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
    pub(crate) imports: ChunkMetaMap,
    pub(crate) exports: ChunkMetaMap,
    pub(crate) dynamic_imports: ArrayHashMap<crate::IndexInt, ()>,
    /// Split `require()` targets, kept apart from `dynamic_imports`
    /// only so the metafile labels them `require-call`.
    pub(crate) require_imports: ArrayHashMap<crate::IndexInt, ()>,
}

pub(crate) type ChunkMetaMap = ArrayHashMap<Ref, ()>;

/// One part range (JS), one import (CSS) or the one HTML file of a chunk,
/// compiled on a worker; `compile_chunks` collects `result`s in chunk order.
pub struct CompileJob {
    pub(crate) chunk_index: u32,
    pub(crate) part_range: PartRange,
    pub(crate) i: u32,
    pub(crate) result: Option<crate::CompileResult>,
}

impl CompileJob {
    /// Pool-thread body: compile this job's part of `ctx.chunks[chunk_index]`.
    pub(crate) fn run(&mut self, ctx: &LinkShared<'_, '_>) {
        use crate::linker_context::{
            generate_compile_result_for_css_chunk::generate_compile_result_for_css_chunk,
            generate_compile_result_for_html_chunk::generate_compile_result_for_html_chunk,
            generate_compile_result_for_js_chunk::generate_compile_result_for_js_chunk,
        };
        let chunk = &ctx.chunks[self.chunk_index as usize];
        self.result = Some(match chunk.content {
            crate::chunk::Content::Javascript(_) => {
                generate_compile_result_for_js_chunk(ctx, chunk, &self.part_range)
            }
            crate::chunk::Content::Css(_) => {
                generate_compile_result_for_css_chunk(ctx, chunk, self.i)
            }
            crate::chunk::Content::Html => generate_compile_result_for_html_chunk(ctx, chunk),
        });
    }
}

impl<'a> LinkerContext<'a> {
    /// Give every source in a JS chunk a `pretty` path distinct from its
    /// `text` (see [`generate_isolated_hash`](Self::generate_isolated_hash)).
    /// Bundle thread, before chunks are post-processed in parallel.
    pub(crate) fn prepare_paths_for_isolated_hash(&self, pg: &mut Graph<'a>, chunks: &[Chunk]) {
        let arena: &Bump = pg.heap;
        let sources = pg.input_files.items_source_mut();
        for chunk in chunks {
            if let crate::chunk::Content::Javascript(js) = &chunk.content {
                for part_range in js.parts_in_chunk_in_order.iter() {
                    let source: &mut Source = &mut sources[part_range.source_index.get() as usize];
                    if source.path.is_file()
                        && source.path.text.as_ptr() == source.path.pretty.as_ptr()
                    {
                        source.path = self
                            .path_with_pretty_initialized(&source.path, arena)
                            .expect("OOM");
                    }
                }
            }
        }
    }

    pub(crate) fn generate_isolated_hash(&self, pg: &Graph<'a>, chunk: &Chunk) -> u64 {
        let _trace = bun::perf::trace("Bundler.generateIsolatedHash");

        let mut hasher = ContentHasher::default();

        // Mix the file names and part ranges of all of the files in this chunk into
        // the hash. Objects that appear identical but that live in separate files or
        // that live in separate parts in the same file must not be merged. This only
        // needs to be done for JavaScript files, not CSS files.
        if let crate::chunk::Content::Javascript(js) = &chunk.content {
            let sources = pg.input_files.items_source();
            for part_range in js.parts_in_chunk_in_order.iter() {
                let source: &Source = &sources[part_range.source_index.get() as usize];

                let file_path: &[u8] = 'brk: {
                    if source.path.is_file() {
                        // Use the pretty path as the file name since it should be platform-
                        // independent (relative paths and the "/" path separator);
                        // `prepare_paths_for_isolated_hash` made it so.
                        debug_assert!(source.path.text.as_ptr() != source.path.pretty.as_ptr());

                        break 'brk source.path.pretty;
                    } else {
                        // If this isn't in the "file" namespace, just use the full path text
                        // verbatim. This could be a source of cross-platform differences if
                        // plugins are storing platform-specific information in here, but then
                        // that problem isn't caused by esbuild itself.
                        break 'brk source.path.text;
                    }
                };

                // Include the path namespace in the hash
                hasher.write(source.path.namespace);

                // Then include the file path
                hasher.write(file_path);

                // Then include the part range
                hasher.write_ints(&[part_range.part_index_begin, part_range.part_index_end]);
            }
        }

        // Hash the output path template as part of the content hash because we want
        // any import to be considered different if the import's output path has changed.
        hasher.write(&chunk.template.data);

        let public_path: &[u8] = if chunk
            .flags
            .contains(crate::chunk::Flags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD)
        {
            self.options
                .browser_public_path
                .as_deref()
                .unwrap_or(&self.options.public_path)
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
        match &chunk.intermediate_output {
            crate::chunk::IntermediateOutput::Pieces(pieces) => {
                for piece in pieces.slice() {
                    hasher.write(piece.data());
                }
            }
            crate::chunk::IntermediateOutput::Joiner(joiner) => {
                for slice in joiner.node_slices() {
                    hasher.write(slice);
                }
            }
            crate::chunk::IntermediateOutput::Empty => {}
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

    pub(crate) fn validate_tla(
        log: &mut Log,
        source_index: crate::IndexInt,
        tla_keywords: &[Range],
        tla_checks: &mut [TlaCheck],
        input_files: &[Source],
        meta_flags: &mut [crate::js_meta::Flags],
        ast_import_records: &[bun_ast::import_record::List<'a>],
    ) {
        // Explicit-stack postorder DFS (was per-edge recursive). `Enter`
        // seeds a file and queues each followed import paired with an
        // `AfterChild` resume point; that resume reads the child's completed
        // `tla_checks` entry. `Leave` sets the async flag once all children
        // are settled. Successors are pushed in pop order then the tail is
        // reversed so LIFO pop reproduces the original recursion order.
        #[derive(Copy, Clone)]
        enum Frame {
            Enter(crate::IndexInt),
            AfterChild {
                source_index: crate::IndexInt,
                import_record_index: u32,
            },
            Leave(crate::IndexInt),
        }

        if tla_checks[source_index as usize].depth != 0 {
            return;
        }

        let mut stack: Vec<Frame> = vec![Frame::Enter(source_index)];

        while let Some(frame) = stack.pop() {
            match frame {
                Frame::Enter(source_index) => {
                    if tla_checks[source_index as usize].depth != 0 {
                        continue;
                    }
                    tla_checks[source_index as usize].depth = 1;
                    if tla_keywords[source_index as usize].len > 0 {
                        tla_checks[source_index as usize].parent = source_index;
                    }

                    let mark = stack.len();
                    for (import_record_index, record) in ast_import_records[source_index as usize]
                        .as_slice()
                        .iter()
                        .enumerate()
                    {
                        if Index::is_valid(record.source_index)
                            && (record.kind == ImportKind::Require
                                || record.kind == ImportKind::Stmt)
                        {
                            stack.push(Frame::Enter(record.source_index.get()));
                            stack.push(Frame::AfterChild {
                                source_index,
                                import_record_index: u32::try_from(import_record_index)
                                    .expect("int cast"),
                            });
                        }
                    }
                    stack.push(Frame::Leave(source_index));
                    stack[mark..].reverse();
                }
                Frame::Leave(source_index) => {
                    // Make sure that if we wrap this module in a closure, the closure is also
                    // async. This happens when you call "import()" on this module and code
                    // splitting is off.
                    if Index::is_valid(Index::init(tla_checks[source_index as usize].parent)) {
                        meta_flags[source_index as usize].is_async_or_has_async_dependency = true;
                    }
                }
                Frame::AfterChild {
                    source_index,
                    import_record_index,
                } => {
                    let record = &ast_import_records[source_index as usize].as_slice()
                        [import_record_index as usize];
                    let parent = tla_checks[record.source_index.get() as usize];
                    if Index::is_invalid(Index::init(parent.parent)) {
                        continue;
                    }

                    let result_tla_check = &mut tla_checks[source_index as usize];

                    // Follow any import chains
                    if record.kind == ImportKind::Stmt
                        && (Index::is_invalid(Index::init(result_tla_check.parent))
                            || parent.depth < result_tla_check.depth)
                    {
                        result_tla_check.depth = parent.depth + 1;
                        result_tla_check.parent = record.source_index.get();
                        result_tla_check.import_record_index = import_record_index;
                        continue;
                    }

                    // Require of a top-level await chain is forbidden
                    if record.kind == ImportKind::Require {
                        let mut notes: Vec<Data> = Vec::new();

                        let mut tla_pretty_path: &[u8] = b"";
                        let mut other_source_index = record.source_index.get();

                        // Build up a chain of notes for all of the imports
                        loop {
                            let parent_result_tla_keyword =
                                tla_keywords[other_source_index as usize];
                            let parent_tla_check = tla_checks[other_source_index as usize];
                            let parent_source_index = other_source_index;

                            if parent_result_tla_keyword.len > 0 {
                                let source = &input_files[other_source_index as usize];
                                tla_pretty_path = source.path.pretty;
                                let mut text = Vec::new();
                                use std::io::Write;
                                write!(
                                    &mut text,
                                    "The top-level await in {} is here:",
                                    bstr::BStr::new(tla_pretty_path)
                                )
                                .expect("infallible: in-memory write");
                                notes.push(Data {
                                    text: text.into(),
                                    location: bun_ast::Location::init_or_null(
                                        Some(source),
                                        parent_result_tla_keyword,
                                    ),
                                    ..Default::default()
                                });
                                break;
                            }

                            if !Index::is_valid(Index::init(parent_tla_check.parent)) {
                                notes.push(Data {
                                    text: b"unexpected invalid index"[..].into(),
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
                                bstr::BStr::new(
                                    &input_files[parent_source_index as usize].path.pretty
                                ),
                                bstr::BStr::new(
                                    &input_files[other_source_index as usize].path.pretty
                                ),
                            )
                            .unwrap();
                            notes.push(Data {
                                text: text.into(),
                                location: bun_ast::Location::init_or_null(
                                    Some(&input_files[parent_source_index as usize]),
                                    ast_import_records[parent_source_index as usize].as_slice()
                                        [tla_checks[parent_source_index as usize]
                                            .import_record_index
                                            as usize]
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
                            write!(&mut text, "This require call is not allowed because the imported file \"{}\" contains a top-level await", bstr::BStr::new(imported_pretty_path)).expect("infallible: in-memory write");
                        } else {
                            write!(&mut text, "This require call is not allowed because the transitive dependency \"{}\" contains a top-level await", bstr::BStr::new(tla_pretty_path)).expect("infallible: in-memory write");
                        }

                        log.add_range_error_with_notes(
                            Some(source),
                            record.range,
                            text,
                            notes.into_boxed_slice(),
                        );
                    }
                }
            }
        }
    }

    pub(crate) fn should_remove_import_export_stmt(
        &self,
        stmts: &mut StmtList,
        loc: Loc,
        namespace_ref: Ref,
        import_record_index: u32,
        alloc: &Bump,
        ast: &JSAst<'_>,
    ) -> Result<bool, BunError> {
        let record = &ast.import_records[import_record_index as usize];
        // Barrel optimization: deferred import records should be dropped
        if record.flags.contains(bun_ast::ImportRecordFlags::IS_UNUSED) {
            return Ok(true);
        }
        // Is this an external import?
        if !record.source_index.is_valid() {
            // Keep the "import" statement if import statements are supported
            if self.options.output_format.keep_es6_import_export_syntax() {
                return Ok(false);
            }

            // Otherwise, replace this statement with a call to "require()"
            stmts
                .inside_wrapper_prefix
                .append_non_dependency(Stmt::alloc(
                    S::Local {
                        decls: G::DeclList::from_slice(&[G::Decl {
                            binding: Binding::alloc(
                                alloc,
                                bun_ast::b::Identifier {
                                    r#ref: namespace_ref,
                                },
                                loc,
                            ),
                            value: Some(Expr::init(
                                E::RequireString {
                                    import_record_index,
                                    ..Default::default()
                                },
                                loc,
                            )),
                        }]),
                        ..Default::default()
                    },
                    record.range.loc,
                ))
                .expect("unreachable");
            return Ok(true);
        }

        // We don't need a call to "require()" if this is a self-import inside a
        // CommonJS-style module, since we can just reference the exports directly.
        if ast.exports_kind == ExportsKind::Cjs
            && self
                .graph
                .symbols
                .follow(namespace_ref)
                .eql(ast.exports_ref)
        {
            return Ok(true);
        }

        let other_flags = self.graph.meta.items_flags()[record.source_index.get() as usize];
        match other_flags.wrap {
            WrapKind::None => {}
            WrapKind::Cjs => {
                // Replace the statement with a call to "require()" since the other module is CJS-wrapped
                stmts
                    .inside_wrapper_prefix
                    .append_non_dependency(Stmt::alloc(
                        S::Local {
                            decls: G::DeclList::from_slice(&[G::Decl {
                                binding: Binding::alloc(
                                    alloc,
                                    bun_ast::b::Identifier {
                                        r#ref: namespace_ref,
                                    },
                                    loc,
                                ),
                                value: Some(Expr::init(
                                    E::RequireString {
                                        import_record_index,
                                        ..Default::default()
                                    },
                                    loc,
                                )),
                            }]),
                            ..Default::default()
                        },
                        loc,
                    ))?;
            }
            WrapKind::Esm => {
                // Ignore this file if it's not included in the bundle. This can happen for
                // wrapped ESM files but not for wrapped CommonJS files because we allow
                // tree shaking inside wrapped ESM files.
                if !self
                    .graph
                    .files_live
                    .is_set(record.source_index.get() as usize)
                {
                    return Ok(true);
                }

                let wrapper_ref =
                    self.graph.ast.items_wrapper_ref()[record.source_index.get() as usize];
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
                    stmts
                        .inside_wrapper_prefix
                        .append_async_dependency(init_call, self.promise_all_runtime_ref)?;
                } else {
                    stmts
                        .inside_wrapper_prefix
                        .append_sync_dependency(init_call)?;
                }
            }
        }

        Ok(true)
    }

    pub(crate) fn print_code_for_file_in_chunk_js(
        &self,
        pg: &Graph<'a>,
        r: renamer::Renamer<'_, '_>,
        alloc: &Bump,
        writer: &mut js_printer::BufferWriter,
        out_stmts: &mut [Stmt],
        ast: &JSAst<'_>,
        flags: crate::js_meta::Flags,
        to_esm_ref: Ref,
        to_commonjs_ref: Ref,
        runtime_require_ref: Option<Ref>,
        source_index: Index,
        source: &Source,
        module_info: Option<&mut crate::analyze_transpiled_module::ModuleInfo>,
    ) -> js_printer::PrintResult {
        let parts_to_print = &[Part {
            stmts: bun_ast::StoreSlice::new_mut(out_stmts),
            ..Default::default()
        }];

        let ts_enums: &bun_ast::ast_result::TsEnumsMap = &self.graph.ts_enums;
        let line_offset_table: &bun_sourcemap::line_offset_table::List<bun_alloc::AstAlloc> =
            &self.graph.files.items_line_offset_table()[source_index.get() as usize];
        let mangled_props: &MangledProps = &self.mangled_props;

        let print_options = js_printer::Options {
            bundling: true,
            // TODO: IIFE
            indent: Default::default(),
            commonjs_named_exports: Some(&ast.commonjs_named_exports),
            commonjs_named_exports_ref: ast.exports_ref,
            commonjs_module_ref: if ast.flags.contains(AstFlags::USES_MODULE_REF) {
                ast.module_ref
            } else {
                Ref::NONE
            },
            commonjs_named_exports_deoptimized: flags.wrap == WrapKind::Cjs,
            commonjs_module_exports_assigned_deoptimized: ast
                .flags
                .contains(AstFlags::COMMONJS_MODULE_EXPORTS_ASSIGNED_DEOPTIMIZED),
            // .const_values = c.graph.const_values,
            ts_enums: Some(ts_enums),

            minify_whitespace: self.options.minify_whitespace,
            minify_syntax: self.options.minify_syntax,
            input_module_type: ast.exports_kind.into(),
            module_type: self.options.output_format,
            print_dce_annotations: self.options.emit_dce_annotations,
            has_run_symbol_renamer: true,

            to_esm_ref,
            to_commonjs_ref,
            require_ref: match self.options.output_format {
                Format::Cjs => None, // use unbounded global
                _ => runtime_require_ref,
            },
            require_or_import_meta_for_source_callback:
                js_printer::RequireOrImportMetaCallback::init(self),
            line_offset_tables: Some(line_offset_table),
            target: self.options.target,

            hmr_ref: if self.options.output_format == Format::InternalBakeDev {
                ast.wrapper_ref
            } else {
                Ref::NONE
            },

            input_files_for_dev_server: if self.options.output_format == Format::InternalBakeDev {
                Some(pg.input_files.items_source())
            } else {
                None
            },
            mangled_props: Some(mangled_props),
            module_info,
            ..Default::default()
        };

        writer.buffer.reset();
        // Note: `BufferWriter` isn't `Clone`/`Default`; move it through
        // `mem::replace` with a freshly-initialized writer.
        let mut printer = js_printer::BufferPrinter::init(core::mem::replace(
            writer,
            js_printer::BufferWriter::init(),
        ));

        let printer_ast = ast.printer_view();

        let enable_source_maps =
            self.options.source_maps != SourceMapOption::None && !source_index.is_runtime();
        let result = if enable_source_maps {
            js_printer::print_with_writer::<&mut js_printer::BufferPrinter, true>(
                &mut printer,
                alloc,
                ast.target,
                printer_ast,
                source,
                print_options,
                ast.import_records.as_slice(),
                parts_to_print,
                r,
            )
        } else {
            js_printer::print_with_writer::<&mut js_printer::BufferPrinter, false>(
                &mut printer,
                alloc,
                ast.target,
                printer_ast,
                source,
                print_options,
                ast.import_records.as_slice(),
                parts_to_print,
                r,
            )
        };

        // `defer writer.* = printer.ctx;`
        *writer = printer.ctx;
        result
    }

    pub(crate) fn require_or_import_meta_for_source(
        &self,
        source_index: crate::IndexInt,
        was_unwrapped_require: bool,
    ) -> js_printer::RequireOrImportMeta {
        let flags = self.graph.meta.items_flags()[source_index as usize];
        js_printer::RequireOrImportMeta {
            exports_ref: if flags.wrap == WrapKind::Esm
                || (was_unwrapped_require
                    && self.graph.ast.items_flags()[source_index as usize]
                        .contains(AstFlags::FORCE_CJS_TO_ESM))
            {
                self.graph.ast.items_exports_ref()[source_index as usize]
            } else {
                Ref::NONE
            },
            is_wrapper_async: flags.is_async_or_has_async_dependency,
            wrapper_ref: self.graph.ast.items_wrapper_ref()[source_index as usize],

            was_unwrapped_require: was_unwrapped_require
                && self.graph.ast.items_flags()[source_index as usize]
                    .contains(AstFlags::FORCE_CJS_TO_ESM),
        }
    }

    pub(crate) fn mangle_local_css(&mut self, pg: &Graph<'a>) {
        if !self.has_any_css_locals {
            return;
        }

        let all_css_asts = self.graph.ast.items_css();
        let all_symbols: &[bun_ast::symbol::List<'a>] = self.graph.ast.items_symbols();
        let all_sources: &[Source] = pg.input_files.items_source();

        // Collect all local css names
        let mut local_css_names: HashMap<Ref, ()> = HashMap::new();

        for (source_index, maybe_css_ast) in all_css_asts.iter().enumerate() {
            if let Some(css_ast) = maybe_css_ast.as_deref() {
                if css_ast.local_scope.count() == 0 {
                    continue;
                }
                let symbols = &all_symbols[source_index];
                for (inner_index, symbol_) in symbols.as_slice().iter().enumerate() {
                    let mut symbol = symbol_;
                    if symbol.kind == bun_ast::symbol::Kind::LocalCss {
                        let r#ref = 'follow: {
                            let mut r#ref = Ref::new(
                                u32::try_from(inner_index).expect("int cast"),
                                u32::try_from(source_index).expect("int cast"),
                                bun_ast::RefTag::Symbol,
                            );
                            while symbol.has_link() {
                                r#ref = symbol.link.get();
                                symbol = &all_symbols[r#ref.source_index() as usize]
                                    [r#ref.inner_index() as usize];
                            }
                            break 'follow r#ref;
                        };

                        let entry = local_css_names.get_or_put(r#ref).expect("OOM");
                        if entry.found_existing {
                            continue;
                        }

                        let source = &all_sources[r#ref.source_index() as usize];

                        let original_name: &[u8] = symbol.original_name.slice();
                        // The hash itself is short-lived; use a scratch bump.
                        let scratch = ::bun_alloc::Arena::new();
                        let path_hash = ::bun_base64::wyhash_url_safe(
                            &scratch,
                            // use path relative to cwd for determinism
                            format_args!("{}", bstr::BStr::new(&source.path.pretty)),
                            false,
                        );

                        let mut final_generated_name = Vec::<u8>::new();
                        use std::io::Write;
                        write!(
                            &mut final_generated_name,
                            "{}_{}",
                            bstr::BStr::new(original_name),
                            bstr::BStr::new(path_hash)
                        )
                        .expect("infallible: in-memory write");
                        // The map owns its boxed values (freed with `mangled_props`).
                        self.mangled_props
                            .put(r#ref, final_generated_name.into_boxed_slice())
                            .expect("OOM");
                    }
                }
            }
        }
    }

    /// Each chunk's final content hash: its own isolated hash (plus the
    /// asset paths its output pieces reference) and that of every chunk it
    /// transitively reaches through cross-chunk imports or output pieces, so a
    /// change anywhere below a chunk renames it. Cycles are fine: reachability
    /// is a fixpoint over bitsets, and each chunk digests its own hash first,
    /// then the rest of its closure in chunk order (so two chunks that reach
    /// each other still differ).
    pub(crate) fn final_chunk_hashes(
        &self,
        pg: &Graph<'a>,
        chunks: &[Chunk],
    ) -> Result<Vec<u64>, AllocError> {
        let n = chunks.len();
        let mut own: Vec<u64> = Vec::with_capacity(n);
        let mut edges: Vec<Vec<u32>> = Vec::with_capacity(n);
        for chunk in chunks {
            let mut hash = ContentHasher::default();
            let mut out: Vec<u32> = chunk
                .cross_chunk_imports
                .slice()
                .iter()
                .map(|import| import.chunk_index)
                .collect();
            if let crate::chunk::IntermediateOutput::Pieces(pieces) = &chunk.intermediate_output {
                for piece in pieces.slice() {
                    match piece.query.kind() {
                        crate::chunk::QueryKind::Asset => {
                            let mut from_chunk_dir =
                                bun_paths::resolve_path::dirname::<
                                    bun_paths::resolve_path::platform::Posix,
                                >(&chunk.final_rel_path);
                            if from_chunk_dir == b"." {
                                from_chunk_dir = b"";
                            }
                            let additional_files: &[AdditionalFile] =
                                pg.input_files.items_additional_files()
                                    [piece.query.index() as usize]
                                    .slice();
                            debug_assert!(!additional_files.is_empty());
                            if let AdditionalFile::OutputFile(output_file_id) = &additional_files[0]
                            {
                                let path =
                                    &pg.additional_output_files[*output_file_id as usize].dest_path;
                                hash.write(bun_paths::resolve_path::relative_platform::<
                                    bun_paths::resolve_path::platform::Posix,
                                    false,
                                >(from_chunk_dir, path));
                            }
                        }
                        crate::chunk::QueryKind::Chunk => out.push(piece.query.index()),
                        crate::chunk::QueryKind::Scb => {
                            let chunk_index = self.graph.files.items_entry_point_chunk_index()
                                [piece.query.index() as usize];
                            if chunk_index != u32::MAX {
                                out.push(chunk_index);
                            }
                        }
                        crate::chunk::QueryKind::None | crate::chunk::QueryKind::HtmlImport => {}
                    }
                }
            }
            hash.write(&chunk.isolated_hash.to_ne_bytes());
            own.push(hash.digest());
            edges.push(out);
        }

        let mut reach: Vec<AutoBitSet> = Vec::with_capacity(n);
        for i in 0..n {
            let mut bits = AutoBitSet::init_empty(n)?;
            bits.set(i);
            reach.push(bits);
        }
        loop {
            let mut changed = false;
            for i in 0..n {
                for &j in &edges[i] {
                    let j = j as usize;
                    if j == i || reach[j].subset_of(&reach[i]) {
                        continue;
                    }
                    let other = reach[j].clone()?;
                    reach[i].set_union(&other);
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }

        Ok(reach
            .iter()
            .enumerate()
            .map(|(i, bits)| {
                let mut hash = ContentHasher::default();
                hash.write(&own[i].to_ne_bytes());
                let mut iter = bits.iterator::<true, true>();
                while let Some(j) = iter.next() {
                    if j != i {
                        hash.write(&own[j].to_ne_bytes());
                    }
                }
                hash.digest()
            })
            .collect())
    }

    // Sort cross-chunk exports by chunk name for determinism
    pub(crate) fn sorted_cross_chunk_export_items(
        &self,
        export_refs: &ChunkMetaMap,
        list: &mut Vec<StableRef>,
    ) {
        list.clear();
        list.reserve(export_refs.count());
        for &export_ref in export_refs.keys() {
            #[cfg(debug_assertions)]
            {
                let sym = self.graph.symbol(export_ref);
                debug_tree_shake!(
                    "Export name: {} (source {})",
                    bstr::BStr::new(sym.original_name.slice()),
                    export_ref.source_index(),
                );
            }
            list.push(StableRef {
                stable_source_index: *self
                    .graph
                    .stable_source_indices
                    .at(export_ref.source_index() as usize),
                r#ref: export_ref,
            });
        }
        index_sort::sort_slice_by(list, |a, b| {
            if StableRef::is_less_than((), *a, *b) {
                core::cmp::Ordering::Less
            } else {
                core::cmp::Ordering::Greater
            }
        });
    }
} // end — split: tree-shaking trio below

/// `js_printer::RequireOrImportMetaSource` — manual-vtable shim so the printer
/// can call back into `LinkerContext::require_or_import_meta_for_source`.
impl<'a> js_printer::RequireOrImportMetaSource for LinkerContext<'a> {
    #[inline]
    fn require_or_import_meta_for_source(
        &self,
        id: u32,
        was_unwrapped_require: bool,
    ) -> js_printer::RequireOrImportMeta {
        LinkerContext::require_or_import_meta_for_source(self, id, was_unwrapped_require)
    }
}

// ══════════════════════════════════════════════════════════════════════════
// Tree-shaking primitives. These reach into `LinkerGraph` SoA columns
// (`files_live`, `meta.items_flags()`) and the `Graph::InputFileColumns`
// accessors.
// ══════════════════════════════════════════════════════════════════════════

// The liveness pass visits every (file, part) at most once. Processing order is
// irrelevant to the final bitset state, so the former mutual recursion is
// driven off an explicit worklist (LIFO, so traversal order matches the old
// DFS). Packing the slices into a borrowed context struct keeps each step at
// 3-4 register-sized arguments.
pub(crate) struct TreeShakeCtx<'a, 'r> {
    pub(crate) side_effects: &'r [SideEffects],
    pub(crate) loaders: &'r [Loader],
    pub(crate) meta_flags: &'r [crate::js_meta::Flags],
    /// For the debug trace.
    #[cfg(debug_assertions)]
    pub(crate) sources: &'r [Source],
    #[cfg(debug_assertions)]
    pub(crate) targets: &'r [Target],
    pub(crate) parts: &'r [bun_ast::PartList<'a>],
    pub(crate) parts_live: &'r mut [bun_collections::AutoBitSet],
    pub(crate) import_records: &'r [bun_ast::import_record::List<'a>],
    pub(crate) entry_point_kinds: &'r [EntryPoint::Kind],
    pub(crate) css_reprs: &'r [crate::bundled_ast::CssCol],
    pub(crate) worklist: Vec<TreeShakeWork>,
}

#[derive(Clone, Copy)]
pub enum TreeShakeWork {
    File(crate::IndexInt),
    Part {
        part_index: crate::IndexInt,
        source_index: crate::IndexInt,
    },
}

pub(crate) struct CodeSplitCtx<'a, 'r> {
    pub(crate) distances: &'r mut [u32],
    pub(crate) parts: &'r [bun_ast::PartList<'a>],
    pub(crate) import_records: &'r [bun_ast::import_record::List<'a>],
    pub(crate) file_entry_bits: &'r mut [AutoBitSet],
    pub(crate) css_reprs: &'r [crate::bundled_ast::CssCol],
    pub(crate) queue: std::collections::VecDeque<(crate::IndexInt, u32)>,
}

/// The tree-shaking / code-splitting passes' view of the linker: what they
/// read besides their [`TreeShakeCtx`] / [`CodeSplitCtx`] columns, plus the
/// `files_live` set they fill in.
pub(crate) struct TreeShaker<'r> {
    options: &'r LinkerOptions,
    files_live: &'r mut bun_collections::DynamicBitSetUnmanaged,
    code_splitting: bool,
    entry_point_kinds: &'r [EntryPoint::Kind],
    ast_len: usize,
}

impl<'r> TreeShaker<'r> {
    /// [`LinkerContext::is_external_dynamic_import`] over the split columns.
    #[inline]
    fn is_external_dynamic_import(&self, record: &ImportRecord, source_index: u32) -> bool {
        if !self.code_splitting || record.source_index.get() == source_index {
            return false;
        }
        let crosses_chunk = match record.kind {
            ImportKind::Dynamic => true,
            ImportKind::Require => record
                .flags
                .contains(bun_ast::ImportRecordFlags::CROSS_CHUNK_REQUIRE),
            _ => false,
        };
        crosses_chunk && self.entry_point_kinds[record.source_index.get() as usize].is_entry_point()
    }

    pub(crate) fn mark_file_reachable_for_code_splitting(
        &mut self,
        ctx: &mut CodeSplitCtx<'_, '_>,
        source_index: crate::IndexInt,
        entry_points_count: usize,
        distance: u32,
    ) {
        // BFS over the import graph from one entry point. Every edge has unit
        // weight, so FIFO order makes the first dequeue of a file carry its
        // shortest distance from this entry point, and re-enqueued already-
        // visited files can be skipped on their entry bit alone. That keeps
        // the work at O(V+E). esbuild (and the earlier recursive port here)
        // runs the same fixpoint as LIFO DFS with a `traverseAgain`
        // relaxation, which reaches the same `distances` / entry bits but
        // does O(V*E) work when shorter paths are discovered late on
        // diamond-shaped DAGs.
        debug_assert!(ctx.queue.is_empty());
        ctx.queue.push_back((source_index, distance));

        while let Some((source_index, distance)) = ctx.queue.pop_front() {
            if !self.files_live.is_set(source_index as usize) {
                continue;
            }

            let bits = &mut ctx.file_entry_bits[source_index as usize];

            // Don't mark this file more than once
            if bits.is_set(entry_points_count) {
                continue;
            }
            bits.set(entry_points_count);

            // Track the minimum distance to an entry point
            if distance < ctx.distances[source_index as usize] {
                ctx.distances[source_index as usize] = distance;
            }
            let out_dist = distance + 1;

            for record in ctx.import_records[source_index as usize].iter() {
                if record.source_index.is_valid()
                    && !self.is_external_dynamic_import(record, source_index)
                    && !ctx.file_entry_bits[record.source_index.get() as usize]
                        .is_set(entry_points_count)
                {
                    ctx.queue.push_back((record.source_index.get(), out_dist));
                }
            }

            // CSS files only follow their import records.
            if ctx.css_reprs[source_index as usize].is_some() {
                continue;
            }

            for part in ctx.parts[source_index as usize].as_slice() {
                for dependency in part.dependencies.iter() {
                    let dep = dependency.source_index.get();
                    if dep != source_index
                        && !ctx.file_entry_bits[dep as usize].is_set(entry_points_count)
                    {
                        ctx.queue.push_back((dep, out_dist));
                    }
                }
            }
        }
    }

    pub(crate) fn mark_file_live_for_tree_shaking(
        &mut self,
        ctx: &mut TreeShakeCtx<'_, '_>,
        source_index: crate::IndexInt,
    ) {
        debug_assert!(ctx.worklist.is_empty());
        ctx.worklist.push(TreeShakeWork::File(source_index));
        while let Some(work) = ctx.worklist.pop() {
            match work {
                TreeShakeWork::File(src) => self.mark_file_live_step(ctx, src),
                TreeShakeWork::Part {
                    part_index,
                    source_index,
                } => self.mark_part_live_step(ctx, part_index, source_index),
            }
        }
    }

    fn mark_file_live_step(
        &mut self,
        ctx: &mut TreeShakeCtx<'_, '_>,
        source_index: crate::IndexInt,
    ) {
        #[cfg(debug_assertions)]
        {
            debug_tree_shake!(
                "markFileLiveForTreeShaking({}, {} {}) = {}",
                source_index,
                bstr::BStr::new(&ctx.sources[source_index as usize].path.pretty),
                // Note: `bake_graph()` lives in `bun_bake` (tier-6 — would back-edge).
                // The debug log only needs a stable label, so print the `Target`
                // tag directly via its `IntoStaticStr` derive.
                <&'static str>::from(ctx.targets[source_index as usize]),
                if self.files_live.is_set(source_index as usize) {
                    "already seen"
                } else {
                    "first seen"
                },
            );
        }

        if self.files_live.is_set(source_index as usize) {
            return;
        }
        self.files_live.set(source_index as usize);

        if source_index as usize >= self.ast_len {
            debug_assert!(false);
            return;
        }

        if ctx.css_reprs[source_index as usize].is_some() {
            for record in ctx.import_records[source_index as usize].iter() {
                if record.source_index.is_valid() {
                    let other = record.source_index.get();
                    if !self.files_live.is_set(other as usize) {
                        ctx.worklist.push(TreeShakeWork::File(other));
                    }
                }
            }
            return;
        }

        // HTML files can reference non-JS/CSS assets (favicons, images, etc.)
        // via .url kind import records. Follow all import records for HTML files
        // so these assets are marked live and included in the manifest.
        if ctx.loaders[source_index as usize] == Loader::Html {
            for record in ctx.import_records[source_index as usize].iter() {
                if record.source_index.is_valid() {
                    let other = record.source_index.get();
                    if !self.files_live.is_set(other as usize) {
                        ctx.worklist.push(TreeShakeWork::File(other));
                    }
                }
            }
            return;
        }

        let parts = ctx.parts[source_index as usize].as_slice();
        for (part_index, part) in parts.iter().enumerate() {
            let mut can_be_removed_if_unused = part.can_be_removed_if_unused;

            if can_be_removed_if_unused && part.tag == bun_ast::PartTag::CommonjsNamedExport {
                if ctx.meta_flags[source_index as usize].wrap == WrapKind::Cjs {
                    can_be_removed_if_unused = false;
                }
            }

            // The automatic JSX runtime import is synthesized by the parser; it
            // exists only so lowered JSX can reference `jsx`/`jsxDEV`/etc. If no
            // live part references those symbols the import must not be kept
            // "for its side effects": the user never wrote it, and keeping it
            // would bundle (or externally import) React for JSX that was
            // entirely dead code. Liveness of the JSX import source, when it is
            // actually needed, is established via part.dependencies (step 6
            // wires the wrapper_ref/__toESM dependency onto this part), so
            // skipping the side-effect scan here is safe.
            if part.tag == bun_ast::PartTag::JsxImport {
                if !can_be_removed_if_unused
                    || (!part.force_tree_shaking
                        && !self.options.tree_shaking
                        && ctx.entry_point_kinds[source_index as usize].is_entry_point())
                {
                    let part_index = u32::try_from(part_index).expect("int cast");
                    if !ctx.parts_live[source_index as usize].is_set(part_index as usize) {
                        ctx.worklist.push(TreeShakeWork::Part {
                            part_index,
                            source_index,
                        });
                    }
                }
                continue;
            }

            // Also include any statement-level imports
            for &import_index in part.import_record_indices.iter() {
                let record = &ctx.import_records[source_index as usize][import_index as usize];
                if record.kind != ImportKind::Stmt {
                    continue;
                }
                let record_source_index = record.source_index;
                let is_external_without_side_effects = record
                    .flags
                    .contains(bun_ast::ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);

                if record_source_index.is_valid() {
                    let other_source_index = record_source_index.get();

                    // Don't include this module for its side effects if it can be
                    // considered to have no side effects
                    let se = ctx.side_effects[other_source_index as usize];
                    if se != SideEffects::HasSideEffects && !self.options.ignore_dce_annotations {
                        continue;
                    }

                    // Otherwise, include this module for its side effects
                    if !self.files_live.is_set(other_source_index as usize) {
                        ctx.worklist.push(TreeShakeWork::File(other_source_index));
                    }
                } else if is_external_without_side_effects {
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
            if !can_be_removed_if_unused
                || (!part.force_tree_shaking
                    && !self.options.tree_shaking
                    && ctx.entry_point_kinds[source_index as usize].is_entry_point())
            {
                let part_index = u32::try_from(part_index).expect("int cast");
                if !ctx.parts_live[source_index as usize].is_set(part_index as usize) {
                    ctx.worklist.push(TreeShakeWork::Part {
                        part_index,
                        source_index,
                    });
                }
            }
        }
    }

    fn mark_part_live_step(
        &mut self,
        ctx: &mut TreeShakeCtx<'_, '_>,
        part_index: crate::IndexInt,
        source_index: crate::IndexInt,
    ) {
        // only once — check the sidecar bitset first so the fast-path early
        // return does not have to load the 272-byte `Part`.
        {
            let bits = &mut ctx.parts_live[source_index as usize];
            if bits.is_set(part_index as usize) {
                return;
            }
            bits.set(part_index as usize);
        }

        #[cfg(debug_assertions)]
        {
            let part: &Part = &ctx.parts[source_index as usize].as_slice()[part_index as usize];
            let stmts: &[Stmt] = part.stmts.slice();
            debug_tree_shake!(
                "markPartLiveForTreeShaking({}): {}:{} = {}, {}",
                source_index,
                bstr::BStr::new(&ctx.sources[source_index as usize].path.pretty),
                part_index,
                if !stmts.is_empty() {
                    stmts[0].loc.start
                } else {
                    Loc::EMPTY.start
                },
                if !stmts.is_empty() {
                    <&'static str>::from(stmts[0].data.tag())
                } else {
                    "s_empty"
                },
            );
        }

        // Include the file containing this part
        if !self.files_live.is_set(source_index as usize) {
            ctx.worklist.push(TreeShakeWork::File(source_index));
        }

        let part = &ctx.parts[source_index as usize].as_slice()[part_index as usize];

        for dependency in part.dependencies.iter() {
            let dep_source = dependency.source_index.get();
            let dep_part = dependency.part_index;
            if !ctx.parts_live[dep_source as usize].is_set(dep_part as usize) {
                ctx.worklist.push(TreeShakeWork::Part {
                    part_index: dep_part,
                    source_index: dep_source,
                });
            }
        }

        // `scan_imports_and_exports` adds no wrapper dependency for external `import()`.
        if self.code_splitting {
            let records = &ctx.import_records[source_index as usize];
            for &import_index in part.import_record_indices.iter() {
                let record = &records[import_index as usize];
                if record.source_index.is_valid()
                    && self.is_external_dynamic_import(record, source_index)
                {
                    let other = record.source_index.get();
                    if !self.files_live.is_set(other as usize) {
                        ctx.worklist.push(TreeShakeWork::File(other));
                    }
                }
            }
        }
    }
} // end tree-shaking impl

// ══════════════════════════════════════════════════════════════════════════
// `scanImportsAndExports.rs` callees.
//
// `linker_context/scanImportsAndExports.rs` calls these `LinkerContext`
// methods inherently.
// ══════════════════════════════════════════════════════════════════════════

// Local imports. `AstFlags` / `DeclaredSymbolList`
// already imported at the top of the file.
use bun_ast::symbol::Use as SymbolUse;
use bun_ast::{DependencyList, ImportItemStatus, PartSymbolUseMap};

// `ImportTracker::{Status,Iterator}`'s canonical definition lives
// in `bundle_v2.rs`. Re-exported here so the 30+
// unqualified uses in `advance_import_tracker` / `match_import_with_export`
// below resolve unchanged.
pub(crate) use crate::bundle_v2::{ImportTrackerIterator, ImportTrackerStatus};

/// Field-wise eq for `ImportTracker`.
#[inline]
fn import_tracker_eq(a: &ImportTracker, b: &ImportTracker) -> bool {
    a.source_index.get() == b.source_index.get()
        && a.import_ref == b.import_ref
        && a.name_loc.start == b.name_loc.start
}

impl<'a> LinkerContext<'a> {
    /// Looks up the symbol `Ref` for a named export of the runtime module.
    #[inline]
    pub(crate) fn runtime_function(&self, name: &[u8]) -> Ref {
        self.graph.runtime_function(name)
    }

    /// Returns the part indices within file `id` that declare the
    /// top-level symbol `ref`.
    #[inline]
    pub(crate) fn top_level_symbols_to_parts(&self, id: u32, r#ref: Ref) -> &[u32] {
        self.graph.top_level_symbol_to_parts(id, r#ref)
    }

    /// Returns the part indices in the runtime module that declare the
    /// top-level symbol `ref`.
    #[inline]
    pub(crate) fn top_level_symbols_to_parts_for_runtime(&self, r#ref: Ref) -> &[u32] {
        self.top_level_symbols_to_parts(Index::RUNTIME.get(), r#ref)
    }

    #[inline]
    pub(crate) fn get_source<'g, I: TryInto<usize>>(pg: &'g Graph<'a>, index: I) -> &'g Source {
        let index: usize = match index.try_into() {
            Ok(i) => i,
            Err(_) => unreachable!(),
        };
        &pg.input_files.items_source()[index]
    }

    /// `log` is an explicit parameter (not `self.log`) because the dev-server
    /// caller (`finish_from_bake_dev_server`) runs this *before* `load()` has
    /// initialized `self.log`, passing a stack-local `Log` instead.
    pub(crate) fn scan_css_imports(
        file_source_index: u32,
        file_import_records: &[ImportRecord],
        css_asts: &[crate::bundled_ast::CssCol],
        sources: &[Source],
        loaders: &[Loader],
        log: &mut Log,
    ) -> ScanCssImportsResult {
        for record in file_import_records.iter() {
            if record.source_index.is_valid() {
                // Other file is not CSS
                if css_asts[record.source_index.get() as usize].is_none() {
                    let source = &sources[file_source_index as usize];
                    let loader = loaders[record.source_index.get() as usize];

                    match loader {
                        Loader::Jsx
                        | Loader::Js
                        | Loader::Ts
                        | Loader::Tsx
                        | Loader::Napi
                        | Loader::Sqlite
                        | Loader::Json
                        | Loader::Jsonc
                        | Loader::Json5
                        | Loader::Xml
                        | Loader::Yaml
                        | Loader::Html
                        | Loader::SqliteEmbedded
                        | Loader::Md => {
                            log.add_error_fmt(
                                Some(source),
                                record.range.loc,
                                format_args!(
                                    "Cannot import a \".{}\" file into a CSS file",
                                    <&'static str>::from(loader),
                                ),
                            );
                        }
                        Loader::Css
                        | Loader::File
                        | Loader::Toml
                        | Loader::Wasm
                        | Loader::Base64
                        | Loader::Dataurl
                        | Loader::Text
                        | Loader::Bunsh => {}
                    }
                }
            }
        }
        if log.errors > 0 {
            ScanCssImportsResult::Errors
        } else {
            ScanCssImportsResult::Ok
        }
    }

    /// Creates the synthetic wrapper part (CommonJS or ESM) for a wrapped
    /// file and records its part index in `wrapper_part_index`.
    pub(crate) fn create_wrapper_for_file(
        &mut self,
        wrap: WrapKind,
        wrapper_ref: Ref,
        // Note: `crate::Index` (`bun_ast::Index`),
        // not `bun_ast::Index` — the SoA `wrapper_part_index` column is
        // typed via the crate-root re-export.
        wrapper_part_index: &mut crate::Index,
        source_index: crate::IndexInt,
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
                let common_js_parts =
                    self.top_level_symbols_to_parts_for_runtime(self.cjs_runtime_ref);

                // Note: the inner loop is intentionally a no-op
                // (`if r#ref.eql(...) continue;` only).
                for &part_id in common_js_parts {
                    let runtime_parts =
                        self.graph.ast.items_parts()[Index::RUNTIME.get() as usize].as_slice();
                    let part: &Part = &runtime_parts[part_id as usize];
                    let symbol_refs = part.symbol_uses.keys();
                    for r#ref in symbol_refs {
                        if *r#ref == self.cjs_runtime_ref {
                            continue;
                        }
                    }
                }

                // generate a dummy part that depends on the "__commonJS" symbol.
                let dependencies: DependencyList =
                    if self.options.output_format != Format::InternalBakeDev {
                        let mut deps = DependencyList::init_capacity(common_js_parts.len());
                        for &part in common_js_parts {
                            deps.append_assume_capacity(Dependency {
                                part_index: part,
                                source_index: bun_ast::Index::RUNTIME,
                            });
                        }
                        deps
                    } else {
                        DependencyList::new_in(bun_alloc::AstAlloc)
                    };
                let mut symbol_uses = PartSymbolUseMap::default();
                symbol_uses
                    .put(wrapper_ref, SymbolUse { count_estimate: 1 })
                    .expect("OOM");
                let exports_ref = self.graph.ast.items_exports_ref()[source_index as usize];
                let module_ref = self.graph.ast.items_module_ref()[source_index as usize];
                let wrap_ref = self.graph.ast.items_wrapper_ref()[source_index as usize];
                let part_index = self
                    .graph
                    .add_part_to_file(
                        source_index,
                        Part {
                            symbol_uses,
                            declared_symbols: DeclaredSymbolList::from_slice(&[
                                DeclaredSymbol {
                                    ref_: exports_ref,
                                    is_top_level: true,
                                },
                                DeclaredSymbol {
                                    ref_: module_ref,
                                    is_top_level: true,
                                },
                                DeclaredSymbol {
                                    ref_: wrap_ref,
                                    is_top_level: true,
                                },
                            ])
                            .expect("unreachable"),
                            dependencies,
                            ..Default::default()
                        },
                    )
                    .expect("unreachable");
                debug_assert!(part_index != bun_ast::NAMESPACE_EXPORT_PART_INDEX);
                *wrapper_part_index = crate::Index::part(part_index);

                // Bake uses a wrapping approach that does not use __commonJS
                if self.options.output_format != Format::InternalBakeDev {
                    self.graph
                        .generate_symbol_import_and_use(
                            source_index,
                            part_index,
                            self.cjs_runtime_ref,
                            1,
                            crate::Index::RUNTIME,
                        )
                        .expect("unreachable");
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
                {
                    let import_records =
                        self.graph.ast.items_import_records()[source_index as usize].as_slice();
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
                }

                let needs_promise_all = async_import_count >= 2;

                let esm_parts: &[u32] = if wrapper_ref.is_valid()
                    && self.options.output_format != Format::InternalBakeDev
                {
                    self.top_level_symbols_to_parts_for_runtime(self.esm_runtime_ref)
                } else {
                    &[]
                };

                let promise_all_parts: &[u32] = if needs_promise_all
                    && wrapper_ref.is_valid()
                    && self.options.output_format != Format::InternalBakeDev
                {
                    self.top_level_symbols_to_parts_for_runtime(self.promise_all_runtime_ref)
                } else {
                    &[]
                };

                // generate a dummy part that depends on the "__esm" and optionally "__promiseAll" symbols
                let mut dependencies =
                    DependencyList::init_capacity(esm_parts.len() + promise_all_parts.len());
                for &part in esm_parts {
                    dependencies.append_assume_capacity(Dependency {
                        part_index: part,
                        source_index: bun_ast::Index::RUNTIME,
                    });
                }
                for &part in promise_all_parts {
                    dependencies.append_assume_capacity(Dependency {
                        part_index: part,
                        source_index: bun_ast::Index::RUNTIME,
                    });
                }

                let mut symbol_uses = PartSymbolUseMap::default();
                symbol_uses
                    .put(wrapper_ref, SymbolUse { count_estimate: 1 })
                    .expect("OOM");
                let part_index = self
                    .graph
                    .add_part_to_file(
                        source_index,
                        Part {
                            symbol_uses,
                            declared_symbols: DeclaredSymbolList::from_slice(&[DeclaredSymbol {
                                ref_: wrapper_ref,
                                is_top_level: true,
                            }])
                            .expect("unreachable"),
                            dependencies,
                            ..Default::default()
                        },
                    )
                    .expect("unreachable");
                debug_assert!(part_index != bun_ast::NAMESPACE_EXPORT_PART_INDEX);
                *wrapper_part_index = crate::Index::part(part_index);
                if wrapper_ref.is_valid() && self.options.output_format != Format::InternalBakeDev {
                    self.graph
                        .generate_symbol_import_and_use(
                            source_index,
                            part_index,
                            self.esm_runtime_ref,
                            1,
                            crate::Index::RUNTIME,
                        )
                        .expect("OOM");

                    // Only mark __promiseAll as used if we have multiple async dependencies
                    if needs_promise_all {
                        self.graph
                            .generate_symbol_import_and_use(
                                source_index,
                                part_index,
                                self.promise_all_runtime_ref,
                                1,
                                crate::Index::RUNTIME,
                            )
                            .expect("OOM");
                    }
                }
            }
            WrapKind::None => {}
        }
    }

    /// Follows one step of an import chain: resolves what `tracker`'s import
    /// points to in the target file and reports the match status.
    pub(crate) fn advance_import_tracker(
        &self,
        pg: &Graph<'a>,
        tracker: &ImportTracker,
    ) -> ImportTrackerIterator {
        let id = tracker.source_index.get();
        // Note: read `named_import` out first, then borrow the rest.
        let named_import: &NamedImport =
            match self.graph.ast.items_named_imports()[id as usize].get(&tracker.import_ref) {
                Some(ni) => ni,
                None => {
                    // TODO: investigate if this is a bug
                    // It implies there are imports being added without being resolved
                    return ImportTrackerIterator {
                        value: Default::default(),
                        status: ImportTrackerStatus::External,
                        ..Default::default()
                    };
                }
            };
        let import_records = &self.graph.ast.items_import_records()[id as usize];
        let exports_kind: &[ExportsKind] = self.graph.ast.items_exports_kind();
        let ast_flags = self.graph.ast.items_flags();

        // Is this an external file?
        let record: &ImportRecord = &import_records[named_import.import_record_index as usize];
        if !record.source_index.is_valid() {
            return ImportTrackerIterator {
                value: Default::default(),
                status: ImportTrackerStatus::External,
                ..Default::default()
            };
        }

        // Barrel optimization: deferred import records point to empty ASTs
        if record.flags.contains(bun_ast::ImportRecordFlags::IS_UNUSED) {
            return ImportTrackerIterator {
                value: Default::default(),
                status: ImportTrackerStatus::External,
                ..Default::default()
            };
        }

        // Is this a disabled file?
        let other_source_index = record.source_index.get();
        let other_id = other_source_index;

        if other_id as usize > self.graph.ast.len()
            || pg.input_files.items_source()[other_source_index as usize]
                .path
                .is_disabled
        {
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: record.source_index,
                    ..Default::default()
                },
                status: ImportTrackerStatus::Disabled,
                ..Default::default()
            };
        }

        let flags = ast_flags[other_id as usize];

        // Is this a named import of a file without any exports?
        if !named_import.alias_is_star
            && flags.contains(AstFlags::HAS_LAZY_EXPORT)
            // ESM exports
            && !flags.contains(AstFlags::USES_EXPORT_KEYWORD)
            && named_import.alias.map(|a| a.slice() != b"default").unwrap_or(true)
            // CommonJS exports
            && !flags.contains(AstFlags::USES_EXPORTS_REF)
            && !flags.contains(AstFlags::USES_MODULE_REF)
        {
            // Just warn about it and replace the import with "undefined"
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: crate::Index::init(other_source_index),
                    import_ref: Ref::NONE,
                    ..Default::default()
                },
                status: ImportTrackerStatus::CjsWithoutExports,
                ..Default::default()
            };
        }
        let other_kind = exports_kind[other_id as usize];
        // Is this a CommonJS file?
        if other_kind == ExportsKind::Cjs {
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: crate::Index::init(other_source_index),
                    import_ref: Ref::NONE,
                    ..Default::default()
                },
                status: ImportTrackerStatus::Cjs,
                ..Default::default()
            };
        }

        // Match this import star with an export star from the imported file
        if named_import.alias_is_star {
            let matching_export = &self.graph.meta.items_resolved_export_star()[other_id as usize];
            if matching_export.data.import_ref.is_valid() {
                // Check to see if this is a re-export of another import
                return ImportTrackerIterator {
                    value: matching_export.data,
                    status: ImportTrackerStatus::Found,
                    import_data: bun_ptr::BackRef::new(
                        matching_export
                            .potentially_ambiguous_export_star_refs
                            .slice(),
                    ),
                };
            }
        }

        // Match this import up with an export from the imported file
        if let Some(matching_export) = self.graph.meta.items_resolved_exports()[other_id as usize]
            .get(
                named_import
                    .alias
                    .expect("infallible: alias present")
                    .slice(),
            )
        {
            // Check to see if this is a re-export of another import
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: matching_export.data.source_index,
                    import_ref: matching_export.data.import_ref,
                    name_loc: matching_export.data.name_loc,
                },
                status: ImportTrackerStatus::Found,
                import_data: bun_ptr::BackRef::new(
                    matching_export
                        .potentially_ambiguous_export_star_refs
                        .slice(),
                ),
            };
        }

        // Is this a file with dynamic exports?
        let is_commonjs_to_esm = flags.contains(AstFlags::FORCE_CJS_TO_ESM);
        if other_kind.is_esm_with_dynamic_fallback() || is_commonjs_to_esm {
            return ImportTrackerIterator {
                value: ImportTracker {
                    source_index: crate::Index::init(other_source_index),
                    import_ref: self.graph.ast.items_exports_ref()[other_id as usize],
                    ..Default::default()
                },
                status: if is_commonjs_to_esm {
                    ImportTrackerStatus::DynamicFallbackInteropDefault
                } else {
                    ImportTrackerStatus::DynamicFallback
                },
                ..Default::default()
            };
        }

        // Missing re-exports in TypeScript files are indistinguishable from types
        let other_loader = pg.input_files.items_loader()[other_id as usize];
        if named_import.is_exported && other_loader.is_typescript() {
            return ImportTrackerIterator {
                value: Default::default(),
                status: ImportTrackerStatus::ProbablyTypescriptType,
                ..Default::default()
            };
        }

        ImportTrackerIterator {
            value: ImportTracker {
                source_index: crate::Index::init(other_source_index),
                ..Default::default()
            },
            status: ImportTrackerStatus::NoMatch,
            ..Default::default()
        }
    }

    /// Walks an import chain (through re-exports) to its final target and
    /// returns how the import should be bound, collecting any re-export
    /// dependencies along the way.
    pub(crate) fn match_import_with_export(
        &mut self,
        pg: &Graph<'a>,
        init_tracker: ImportTracker,
        re_exports: &mut bun_alloc::AstVec<Dependency>,
    ) -> MatchImport {
        let cycle_detector_top = self.cycle_detector.len();
        // Note: `cycle_detector` is restored by an explicit
        // `truncate` after the `'loop_` below — the only
        // exits are the three `return`s that follow it, so a single post-loop
        // truncate covers every path. A scopeguard holding a raw `*mut` into
        // `self.cycle_detector` would be invalidated by the `&mut self`
        // reborrows inside the loop (Stacked Borrows), so we don't use one.

        let mut tracker = init_tracker;
        let mut ambiguous_results: Vec<MatchImport> = Vec::new();
        let mut result: MatchImport = MatchImport::default();

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
                if import_tracker_eq(&tracker, prev_tracker) {
                    result = MatchImport {
                        kind: MatchImportKind::Cycle,
                        ..Default::default()
                    };
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
            let advanced = self.advance_import_tracker(pg, &tracker);
            let next_tracker = advanced.value;
            let status = advanced.status;
            // `advanced.import_data` borrows
            // `graph.meta[..].resolved_exports[..].potentially_ambiguous_export_star_refs`;
            // that storage is never reallocated while this loop runs (only
            // `cycle_detector`, `log`, and `graph.symbols` are mutated below).
            let potentially_ambiguous_export_star_refs: &[crate::ImportData] =
                advanced.import_data.get();

            match status {
                ImportTrackerStatus::Cjs
                | ImportTrackerStatus::CjsWithoutExports
                | ImportTrackerStatus::Disabled
                | ImportTrackerStatus::External => {
                    if status == ImportTrackerStatus::External
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
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()
                        [prev_source_index as usize]
                        .get(&tracker.import_ref)
                        .unwrap();

                    if named_import.namespace_ref.is_valid() {
                        if result.kind == MatchImportKind::Normal {
                            result.kind = MatchImportKind::NormalAndNamespace;
                            result.namespace_ref = named_import.namespace_ref;
                            result.alias = named_import.alias.expect("infallible: alias present");
                        } else {
                            result = MatchImport {
                                kind: MatchImportKind::Namespace,
                                namespace_ref: named_import.namespace_ref,
                                alias: named_import.alias.expect("infallible: alias present"),
                                ..Default::default()
                            };
                        }
                    }

                    // Warn about importing from a file that is known to not have any exports
                    if status == ImportTrackerStatus::CjsWithoutExports {
                        let source = Self::get_source(pg, tracker.source_index.get());
                        let alias = named_import
                            .alias
                            .expect("infallible: alias present")
                            .slice();
                        self.log.add_range_warning_fmt(
                            Some(source),
                            source.range_of_identifier(named_import.alias_loc),
                            format_args!(
                                "Import \"{}\" will always be undefined because the file \"{}\" has no exports",
                                bstr::BStr::new(alias),
                                bstr::BStr::new(&source.path.pretty),
                            ),
                        );
                    }
                }

                ImportTrackerStatus::DynamicFallbackInteropDefault => {
                    // if the file was rewritten from CommonJS into ESM
                    // and the developer imported an export that doesn't exist
                    // We don't do a runtime error since that CJS would have returned undefined.
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()
                        [prev_source_index as usize]
                        .get(&tracker.import_ref)
                        .unwrap();

                    if named_import.namespace_ref.is_valid() {
                        result.kind = MatchImportKind::NormalAndNamespace;
                        result.namespace_ref = tracker.import_ref;
                        result.alias = named_import.alias.expect("infallible: alias present");
                        result.name_loc = named_import.alias_loc;
                        self.graph
                            .symbols
                            .get_mut(tracker.import_ref)
                            .expect("infallible: ref in symbol table")
                            .import_item_status = ImportItemStatus::Missing;
                    }
                }

                ImportTrackerStatus::DynamicFallback => {
                    // If it's a file with dynamic export fallback, rewrite the import to a property access
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()
                        [prev_source_index as usize]
                        .get(&tracker.import_ref)
                        .unwrap();
                    if named_import.namespace_ref.is_valid() {
                        if result.kind == MatchImportKind::Normal {
                            result.kind = MatchImportKind::NormalAndNamespace;
                            result.namespace_ref = next_tracker.import_ref;
                            result.alias = named_import.alias.expect("infallible: alias present");
                        } else {
                            result = MatchImport {
                                kind: MatchImportKind::Namespace,
                                namespace_ref: next_tracker.import_ref,
                                alias: named_import.alias.expect("infallible: alias present"),
                                ..Default::default()
                            };
                        }
                    }
                }
                ImportTrackerStatus::NoMatch => {
                    // Report mismatched imports and exports
                    let named_import: &NamedImport = self.graph.ast.items_named_imports()
                        [prev_source_index as usize]
                        .get(&tracker.import_ref)
                        .unwrap();
                    let source = Self::get_source(pg, prev_source_index);

                    let next_source = Self::get_source(pg, next_tracker.source_index.get());
                    let r = source.range_of_identifier(named_import.alias_loc);
                    let alias = named_import
                        .alias
                        .expect("infallible: alias present")
                        .slice();
                    let symbol = self
                        .graph
                        .symbols
                        .get_mut(tracker.import_ref)
                        .expect("infallible: ref in symbol table");

                    // Report mismatched imports and exports
                    if symbol.import_item_status == ImportItemStatus::Generated {
                        // This is a debug message instead of an error because although it
                        // appears to be a named import, it's actually an automatically-
                        // generated named import that was originally a property access on an
                        // import star namespace object. Normally this property access would
                        // just resolve to undefined at run-time instead of failing at binding-
                        // time, so we emit a debug message and rewrite the value to the literal
                        // "undefined" instead of emitting an error.
                        symbol.import_item_status = ImportItemStatus::Missing;

                        if self.options.target == Target::Browser
                            && bun_resolve_builtins::Alias::has(
                                next_source.path.pretty,
                                Target::Bun,
                                bun_resolve_builtins::Cfg::default(),
                            )
                        {
                            self.log.add_range_warning_fmt_with_note(
                                Some(source), r,
                                format_args!(
                                    "Browser polyfill for module \"{}\" doesn't have a matching export named \"{}\"",
                                    bstr::BStr::new(&next_source.path.pretty),
                                    bstr::BStr::new(alias),
                                ),
                                format_args!("Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options."),
                                r,
                            );
                        } else {
                            self.log.add_range_warning_fmt(
                                Some(source), r,
                                format_args!(
                                    "Import \"{}\" will always be undefined because there is no matching export in \"{}\"",
                                    bstr::BStr::new(alias),
                                    bstr::BStr::new(&next_source.path.pretty),
                                ),
                            );
                        }
                    } else if self.options.target == Target::Browser
                        && next_source
                            .path
                            .text
                            .starts_with(NodeFallbackModules::IMPORT_PATH)
                    {
                        self.log.add_range_error_fmt_with_note(
                            Some(source), r,
                            format_args!(
                                "Browser polyfill for module \"{}\" doesn't have a matching export named \"{}\"",
                                bstr::BStr::new(&next_source.path.pretty),
                                bstr::BStr::new(alias),
                            ),
                            format_args!("Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options."),
                            r,
                        );
                    } else {
                        self.log.add_range_error_fmt(
                            Some(source),
                            r,
                            format_args!(
                                "No matching export in \"{}\" for import \"{}\"",
                                bstr::BStr::new(&next_source.path.pretty),
                                bstr::BStr::new(alias),
                            ),
                        );
                    }
                }
                ImportTrackerStatus::ProbablyTypescriptType => {
                    // Omit this import from any namespace export code we generate for
                    // import star statements (i.e. "import * as ns from 'path'")
                    result = MatchImport {
                        kind: MatchImportKind::ProbablyTypescriptType,
                        ..Default::default()
                    };
                }
                ImportTrackerStatus::Found => {
                    // If there are multiple ambiguous results due to use of "export * from"
                    // statements, trace them all to see if they point to different things.
                    for ambiguous_tracker in potentially_ambiguous_export_star_refs.iter() {
                        // If this is a re-export of another import, follow the import
                        if self.graph.ast.items_named_imports()
                            [ambiguous_tracker.data.source_index.get() as usize]
                            .contains(&ambiguous_tracker.data.import_ref)
                        {
                            let ambig = self.match_import_with_export(
                                pg,
                                ambiguous_tracker.data,
                                re_exports,
                            );
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
                        let deps =
                            self.top_level_symbols_to_parts(prev_source_index, tracker.import_ref);
                        re_exports.reserve(deps.len());
                        for &dep in deps {
                            re_exports.push(Dependency {
                                part_index: dep,
                                source_index: bun_ast::Index::init(tracker.source_index.get()),
                            });
                        }
                    }

                    // If this is a re-export of another import, continue for another
                    // iteration of the loop to resolve that import as well
                    let next_id = next_tracker.source_index.get();
                    if self.graph.ast.items_named_imports()[next_id as usize]
                        .contains(&next_tracker.import_ref)
                    {
                        tracker = next_tracker;
                        continue 'loop_;
                    }
                }
            }

            break 'loop_;
        }

        // Spec `defer`: restore cycle_detector to its entry length now that the
        // loop is done. All remaining exit paths are below this point.
        self.cycle_detector.truncate(cycle_detector_top);

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

                return MatchImport {
                    kind: MatchImportKind::Ambiguous,
                    ..Default::default()
                };
            }
        }

        result
    }

    /// Resolves every named import in one file to its matching export,
    /// recording the bindings in `imports_to_bind`.
    pub(crate) fn match_imports_with_exports_for_file(
        &mut self,
        pg: &Graph<'a>,
        source_index: crate::IndexInt,
    ) {
        // The bindings go to `meta.imports_to_bind[source_index]`, taken out
        // for the duration so `self` stays free.
        let mut imports_to_bind_row = core::mem::take(
            &mut self.graph.meta.items_imports_to_bind_mut()[source_index as usize],
        );
        let imports_to_bind = &mut imports_to_bind_row;
        // `NamedImport` is non-Clone (owns a `Vec`), and `match_import_with_export`
        // re-reads the column through `self`, so iterate a sorted copy of the
        // keys (ascending `inner_index`) and look entries up again where needed.
        let mut refs: Vec<Ref> = self.graph.ast.items_named_imports()[source_index as usize]
            .keys()
            .to_vec();
        refs.sort_unstable_by_key(|r| r.inner_index());

        for import_ref in refs {
            let named_import = |this: &Self| -> (Loc, bun_ast::StoreStr) {
                let ni = this.graph.ast.items_named_imports()[source_index as usize]
                    .get(&import_ref)
                    .expect("infallible: key from this map");
                (ni.alias_loc, ni.alias.expect("infallible: alias present"))
            };

            // Re-use memory for the cycle detector
            self.cycle_detector.clear();

            let mut re_exports: bun_alloc::AstVec<Dependency> = bun_alloc::AstAlloc::vec();
            let result = self.match_import_with_export(
                pg,
                ImportTracker {
                    source_index: crate::Index::init(source_index),
                    import_ref,
                    ..Default::default()
                },
                &mut re_exports,
            );

            match result.kind {
                MatchImportKind::Normal => {
                    imports_to_bind
                        .put(
                            import_ref,
                            crate::ImportData {
                                re_exports,
                                data: ImportTracker {
                                    source_index: crate::Index::init(result.source_index),
                                    import_ref: result.r#ref,
                                    ..Default::default()
                                },
                            },
                        )
                        .expect("unreachable");
                }
                MatchImportKind::Namespace => {
                    self.graph
                        .symbols
                        .get_mut(import_ref)
                        .expect("infallible: ref in symbol table")
                        .namespace_alias = Some(bun_alloc::ast_box(G::NamespaceAlias {
                        namespace_ref: result.namespace_ref,
                        alias: result.alias,
                        ..Default::default()
                    }));
                }
                MatchImportKind::NormalAndNamespace => {
                    imports_to_bind
                        .put(
                            import_ref,
                            crate::ImportData {
                                re_exports,
                                data: ImportTracker {
                                    source_index: crate::Index::init(result.source_index),
                                    import_ref: result.r#ref,
                                    ..Default::default()
                                },
                            },
                        )
                        .expect("unreachable");

                    self.graph
                        .symbols
                        .get_mut(import_ref)
                        .expect("infallible: ref in symbol table")
                        .namespace_alias = Some(bun_alloc::ast_box(G::NamespaceAlias {
                        namespace_ref: result.namespace_ref,
                        alias: result.alias,
                        ..Default::default()
                    }));
                }
                MatchImportKind::Cycle => {
                    let source = Self::get_source(pg, source_index);
                    let (alias_loc, alias) = named_import(self);
                    let r = lex::range_of_identifier(source, alias_loc);
                    let alias = alias.slice();
                    self.log.add_range_error_fmt(
                        Some(source),
                        r,
                        format_args!(
                            "Detected cycle while resolving import \"{}\"",
                            bstr::BStr::new(alias),
                        ),
                    );
                }
                MatchImportKind::ProbablyTypescriptType => {
                    self.graph.meta.items_probably_typescript_type_mut()[source_index as usize]
                        .put(import_ref, ())
                        .expect("unreachable");
                }
                MatchImportKind::Ambiguous => {
                    let source = Self::get_source(pg, source_index);
                    let (alias_loc, alias) = named_import(self);
                    let r = lex::range_of_identifier(source, alias_loc);

                    // TODO: log locations of the ambiguous exports

                    let alias = alias.slice();
                    let symbol = self
                        .graph
                        .symbols
                        .get_mut(import_ref)
                        .expect("infallible: ref in symbol table");
                    if symbol.import_item_status == ImportItemStatus::Generated {
                        symbol.import_item_status = ImportItemStatus::Missing;
                        self.log.add_range_warning_fmt(
                            Some(source), r,
                            format_args!(
                                "Import \"{}\" will always be undefined because there are multiple matching exports",
                                bstr::BStr::new(alias),
                            ),
                        );
                    } else {
                        self.log.add_range_error_fmt(
                            Some(source),
                            r,
                            format_args!(
                                "Ambiguous import \"{}\" has multiple matching exports",
                                bstr::BStr::new(alias),
                            ),
                        );
                    }
                }
                MatchImportKind::Ignore => {}
            }
        }
        self.graph.meta.items_imports_to_bind_mut()[source_index as usize] = imports_to_bind_row;
    }

    pub(crate) fn generate_named_export_in_file(
        &mut self,
        source_index: crate::IndexInt,
        module_ref: Ref,
        name: &[u8],
        alias: &[u8],
    ) -> Result<(Ref, u32), AllocError> {
        let r#ref =
            self.graph
                .generate_new_symbol(source_index, bun_ast::symbol::Kind::Other, name);
        let part_index = self.graph.add_part_to_file(
            source_index,
            Part {
                declared_symbols: DeclaredSymbolList::from_slice(&[DeclaredSymbol {
                    ref_: r#ref,
                    is_top_level: true,
                }])?,
                can_be_removed_if_unused: true,
                ..Default::default()
            },
        )?;

        self.graph.generate_symbol_import_and_use(
            source_index,
            part_index,
            module_ref,
            1,
            crate::Index::init(source_index),
        )?;
        let top_level = &mut self
            .graph
            .meta
            .items_top_level_symbol_to_parts_overlay_mut()[source_index as usize];
        top_level.put(r#ref, bun_alloc::AstAlloc::vec_from_slice(&[part_index]))?;

        let resolved_exports =
            &mut self.graph.meta.items_resolved_exports_mut()[source_index as usize];
        resolved_exports.put(
            alias,
            crate::ExportData {
                data: ImportTracker {
                    source_index: crate::Index::init(source_index),
                    import_ref: r#ref,
                    ..Default::default()
                },
                ..Default::default()
            },
        )?;
        Ok((r#ref, part_index))
    }

    pub(crate) fn break_output_into_pieces(
        &self,
        pg: &Graph<'a>,
        j: &mut StringJoiner<'static>,
        count: u32,
    ) -> Result<crate::chunk::IntermediateOutput, BunError> {
        let _trace = bun::perf::trace("Bundler.breakOutputIntoPieces");

        type OutputPiece = crate::chunk::OutputPiece;

        if !j.contains(&self.unique_key_prefix) {
            // There are like several cases that prohibit this from being checked more trivially, example:
            // 1. dynamic imports
            // 2. require()
            // 3. require.resolve()
            // 4. externals
            return Ok(crate::chunk::IntermediateOutput::Joiner(core::mem::take(j)));
        }

        let mut pieces: Vec<OutputPiece> = Vec::with_capacity(count as usize);
        // Note: `StringJoiner::done()`
        // returns a `Box<[u8]>`; we must keep it alive alongside the pieces
        // (each `OutputPiece` stores a raw `*const u8` into it). It is moved
        // into the returned `OutputPieces` below.
        let complete_output: Box<[u8]> = j.done()?;
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

            let Some(kind) = crate::chunk::QueryKind::from_letter(output[start]) else {
                if cfg!(debug_assertions) {
                    bun_core::debug_warn!("Invalid output piece boundary");
                }
                break;
            };

            let mut index: usize = 0;
            // SAFETY: bounds checked above (start + 9 <= output.len())
            let digits: [u8; 8] = output[start + 1..start + 9]
                .try_into()
                .expect("infallible: size matches");
            for char in digits {
                if char < b'0' || char > b'9' {
                    if cfg!(debug_assertions) {
                        bun_core::debug_warn!("Invalid output piece boundary");
                    }
                    break 'outer;
                }

                index = (index * 10) + ((char as usize) - (b'0' as usize));
            }

            // Validate the boundary
            match kind {
                crate::chunk::QueryKind::Asset | crate::chunk::QueryKind::Scb => {
                    if index >= self.graph.files.len() {
                        if cfg!(debug_assertions) {
                            bun_core::debug_warn!("Invalid output piece boundary");
                        }
                        break;
                    }
                }
                crate::chunk::QueryKind::Chunk => {
                    if index >= count as usize {
                        if cfg!(debug_assertions) {
                            bun_core::debug_warn!("Invalid output piece boundary");
                        }
                        break;
                    }
                }
                crate::chunk::QueryKind::HtmlImport => {
                    if index >= pg.html_imports.server_source_indices.len() as usize {
                        if cfg!(debug_assertions) {
                            bun_core::debug_warn!("Invalid output piece boundary");
                        }
                        break;
                    }
                }
                _ => unreachable!(),
            }

            // Note: `Query` is a packed `u32` (`index: u29`, `kind: u3`);
            // construct via `new` rather than field-init.
            pieces.push(OutputPiece::init(
                &output[0..boundary],
                crate::chunk::Query::new(u32::try_from(index).expect("int cast"), kind),
            ));
            output = &output[boundary + prefix.len() + 9..];
        }

        pieces.push(OutputPiece::init(output, crate::chunk::Query::NONE));

        Ok(crate::chunk::IntermediateOutput::Pieces(
            crate::chunk::OutputPieces::new(pieces, complete_output),
        ))
    }
}

// PartialEq for MatchImport (used by match_import_with_export)
impl PartialEq for MatchImport {
    fn eq(&self, other: &Self) -> bool {
        // Note: intentionally compares the raw fat pointer
        // (address + length metadata), not contents.
        std::ptr::eq(self.alias.as_raw(), other.alias.as_raw())
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
    // Temporary scratch buffers: plain `Vec`s on the global allocator
    // (cleared/reused per chunk, freed by Drop).
    pub(crate) inside_wrapper_prefix: InsideWrapperPrefix,
    pub(crate) outside_wrapper_prefix: Vec<Stmt>,
    pub(crate) inside_wrapper_suffix: Vec<Stmt>,
    pub(crate) all_stmts: Vec<Stmt>,
}

pub struct InsideWrapperPrefix {
    pub(crate) stmts: Vec<Stmt>,
    pub(crate) sync_dependencies_end: usize,
    // if true it will exist at `sync_dependencies_end`
    pub(crate) has_async_dependency: bool,
}

impl InsideWrapperPrefix {
    fn init() -> Self {
        Self {
            stmts: Vec::new(),
            sync_dependencies_end: 0,
            has_async_dependency: false,
        }
    }

    // deinit → Drop (Vec frees automatically); reset is explicit

    pub(crate) fn reset(&mut self) {
        self.stmts.clear();
        self.sync_dependencies_end = 0;
        self.has_async_dependency = false;
    }
}

impl InsideWrapperPrefix {
    pub(crate) fn append_non_dependency(&mut self, stmt: Stmt) -> Result<(), AllocError> {
        self.stmts.push(stmt);
        Ok(())
    }

    pub(crate) fn append_non_dependency_slice(&mut self, stmts: &[Stmt]) -> Result<(), AllocError> {
        self.stmts.extend_from_slice(stmts);
        Ok(())
    }

    fn append_sync_dependency(&mut self, call_expr: Expr) -> Result<(), AllocError> {
        self.stmts.insert(
            self.sync_dependencies_end,
            Stmt::alloc(
                S::SExpr {
                    value: call_expr,
                    ..Default::default()
                },
                call_expr.loc,
            ),
        );
        self.sync_dependencies_end += 1;
        Ok(())
    }

    fn append_async_dependency(
        &mut self,
        call_expr: Expr,
        promise_all_ref: Ref,
    ) -> Result<(), AllocError> {
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

        // Note: deep AST mutation chain — `s_expr_mut`/`e_await_mut`/
        // `e_call_mut`/`e_array_mut` return `Option`; `.unwrap()` panics on
        // shape mismatch.
        let mut first_dep_call_expr = self.stmts[self.sync_dependencies_end]
            .data
            .s_expr_mut()
            .unwrap()
            .value
            .data
            .e_await_mut()
            .expect("infallible: variant checked")
            .value;
        let call = first_dep_call_expr
            .data
            .e_call_mut()
            .expect("infallible: variant checked");

        if call
            .target
            .data
            .e_identifier()
            .expect("infallible: variant checked")
            .ref_
            .eql(promise_all_ref)
        {
            // `await __promiseAll` already in place, append to the array argument
            call.args
                .mut_(0)
                .data
                .e_array_mut()
                .expect("infallible: variant checked")
                .items
                .push(call_expr);
        } else {
            // convert single `await init_` to `await __promiseAll([init_1(), init_2()])`

            let promise_all = Expr::init(
                E::Identifier {
                    ref_: promise_all_ref,
                    ..Default::default()
                },
                Loc::EMPTY,
            );

            let mut items = bun_ast::ExprNodeList::init_capacity(2);
            items.append_slice_assume_capacity(&[first_dep_call_expr, call_expr]);

            let mut args = bun_ast::ExprNodeList::init_capacity(1);
            args.append_assume_capacity(Expr::init(
                E::Array {
                    items,
                    ..Default::default()
                },
                Loc::EMPTY,
            ));

            let promise_all_call = Expr::init(
                E::Call {
                    target: promise_all,
                    args,
                    ..Default::default()
                },
                Loc::EMPTY,
            );

            // replace the `await init_` expr with `await __promiseAll`
            self.stmts[self.sync_dependencies_end] = Stmt::alloc(
                S::SExpr {
                    value: Expr::init(
                        E::Await {
                            value: promise_all_call,
                        },
                        Loc::EMPTY,
                    ),
                    ..Default::default()
                },
                Loc::EMPTY,
            );
        }
        Ok(())
    }
}

impl StmtList {
    pub(crate) fn reset(&mut self) {
        self.inside_wrapper_prefix.reset();
        self.outside_wrapper_prefix.clear();
        self.inside_wrapper_suffix.clear();
        self.all_stmts.clear();
    }

    // deinit → Drop (Vec fields free automatically)

    pub(crate) fn init() -> Self {
        Self {
            inside_wrapper_prefix: InsideWrapperPrefix::init(),
            outside_wrapper_prefix: Vec::new(),
            inside_wrapper_suffix: Vec::new(),
            all_stmts: Vec::new(),
        }
    }

    pub(crate) fn append_slice(&mut self, list: StmtListWhich, stmts: &[Stmt]) {
        match list {
            StmtListWhich::OutsideWrapperPrefix => {
                self.outside_wrapper_prefix.extend_from_slice(stmts)
            }
            StmtListWhich::InsideWrapperSuffix => {
                self.inside_wrapper_suffix.extend_from_slice(stmts)
            }
            StmtListWhich::AllStmts => self.all_stmts.extend_from_slice(stmts),
        }
    }

    pub(crate) fn append(&mut self, list: StmtListWhich, stmt: Stmt) {
        match list {
            StmtListWhich::OutsideWrapperPrefix => self.outside_wrapper_prefix.push(stmt),
            StmtListWhich::InsideWrapperSuffix => self.inside_wrapper_suffix.push(stmt),
            StmtListWhich::AllStmts => self.all_stmts.push(stmt),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StmtListWhich {
    OutsideWrapperPrefix,
    InsideWrapperSuffix,
    AllStmts,
}
