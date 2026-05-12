//! Port of `src/bundler/linker_context/scanImportsAndExports.zig`.
//
// PORT NOTE: the Zig body takes ~20 simultaneous mutable column slices
// (`this.graph.ast.items(.field)`) and freely interleaves them with
// `&mut LinkerContext` method calls. Rust's borrowck forbids both holding
// overlapping `&mut [T]` columns from the same `MultiArrayList` and holding
// any `&mut` column across a `&mut self` call into `this.graph`. The columns
// are physically disjoint (SoA layout) and the underlying `MultiArrayList`
// never reallocates inside this function, so this port caches the column
// base pointers once via `Slice::items_raw` and dereferences them at each
// use site through `*mut [T]`. This is the documented escape hatch in
// `bun_collections::multi_array_list::Slice::items_raw`.

use crate::mal_prelude::*;
use bun_alloc::AllocError;
use bun_ast::Source;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, import_record};
use bun_collections::{HashMap, MultiArrayList, VecExt};
use bun_core::FeatureFlags;

use crate::bundled_ast::{self, NamedExports, NamedImports};
use crate::options::{self, Format, Loader};
use crate::ungate_support::perf;
use crate::{
    EntryPoint, ExportData, ImportData, ImportTracker, Index, IndexInt, JSMeta, LinkerContext,
    Part, RefImportData, ResolvedExports, WrapKind, js_meta,
};
use bun_ast::symbol::{self, Kind as SymbolKind};
use bun_ast::{Dependency, ExportsKind, PartList, Ref};
use bun_js_parser as js_ast;

use crate::linker_context_mod::LinkerCtx;

type AstFlags = bundled_ast::Flags;
type ImportRecordList = import_record::List;

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ScanImportsAndExportsError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("import resolution failed")]
    ImportResolutionFailed,
}
bun_core::oom_from_alloc!(ScanImportsAndExportsError);
impl From<ScanImportsAndExportsError> for crate::linker_context_mod::LinkError {
    fn from(e: ScanImportsAndExportsError) -> Self {
        use crate::linker_context_mod::LinkError;
        match e {
            ScanImportsAndExportsError::OutOfMemory => LinkError::OutOfMemory,
            ScanImportsAndExportsError::ImportResolutionFailed => LinkError::ImportResolutionFailed,
        }
    }
}
bun_core::named_error_set!(ScanImportsAndExportsError);

/// Short-lived `&mut [T]` deref of a `split_raw()` column pointer at a single
/// use site.
///
/// SoA columns are physically disjoint (`COLUMN_OFFSET_PER_CAP`); the backing
/// buffer is never reallocated inside this function (only column *element*
/// contents grow, e.g. `Vec<Part>::append`). The pointers come from
/// `split_raw()`, which derives them by raw `add` on the heap buffer base —
/// root/SharedRW provenance, no `&mut` intermediate — so they survive the
/// interleaved `&mut LinkerContext` method calls in steps 3-5 under Stacked
/// Borrows. (Decaying `split_mut()`'s `&mut [T]` to raw would *not*: the child
/// Unique tag is popped the first time another column accessor runs.)
macro_rules! col {
    ($p:expr) => {
        // SAFETY: see module-level note. Caller ensures no aliasing `&mut` to
        // the *same* column is live across this deref.
        unsafe { &mut *$p }
    };
}

/// Short-lived `&[T]` deref of a `split_raw()` column pointer.
macro_rules! col_ref {
    ($p:expr) => {
        // SAFETY: see `col!`.
        unsafe { &*$p }
    };
}

pub fn scan_imports_and_exports(
    this: &mut LinkerContext,
) -> Result<(), ScanImportsAndExportsError> {
    let _outer_trace = perf::trace("Bundler.scanImportsAndExports");
    let output_format = this.options.output_format;

    // PORT NOTE: `reachable_files` is borrowed out of `this.graph` while the
    // body also calls `&mut this.graph` methods. Snapshot the indices.
    // PERF(port): was zero-copy slice; profile.
    let mut reachable: Vec<Index> = this.graph.reachable_files.slice().to_vec();

    // ── cache SoA column base pointers ────────────────────────────────────
    // `MultiArrayList` never reallocates inside this function (only column
    // *element* contents grow, e.g. `Vec<Part>::append`). So these raw
    // column pointers are valid for the whole body. `split_raw()` derives
    // each `*mut [T]` directly from the buffer base (root provenance) — see
    // the `col!` doc-comment for why `split_mut()` is not used here.
    let ast = this.graph.ast.split_raw();
    let meta = this.graph.meta.split_raw();
    let files = this.graph.files.split_raw();
    // SAFETY: `parse_graph` is a backref into `BundleV2.graph`, valid for the
    // lifetime of the link step. Read-only — this function never writes to it.
    let input = this.parse_graph().input_files.split_raw();

    use crate::bundled_ast::CssCol;
    let import_records_list: *mut [ImportRecordList] = ast.import_records;
    let exports_kind: *mut [ExportsKind] = ast.exports_kind;
    let entry_point_kinds: *mut [EntryPoint::Kind] = files.entry_point_kind;
    let named_imports: *mut [NamedImports] = ast.named_imports;
    let named_exports: *mut [NamedExports] = ast.named_exports;
    let flags: *mut [js_meta::Flags] = meta.flags;
    let ast_flags_list: *mut [AstFlags] = ast.flags;
    let export_star_import_records: *mut [Box<[u32]>] = ast.export_star_import_records;
    let exports_refs: *mut [Ref] = ast.exports_ref;
    let module_refs: *mut [Ref] = ast.module_ref;
    let wrapper_refs: *mut [Ref] = ast.wrapper_ref;
    let parts_list: *mut [PartList] = ast.parts;
    // Zig: `[]?*bun.css.BundlerStyleSheet` — element is a *mutable* nullable
    // pointer (matches `BundledAst.css: Option<*mut BundlerStyleSheet>`).
    let css_asts: *mut [CssCol] = ast.css;

    let input_files: *mut [Source] = input.source;
    let loaders: *mut [Loader] = input.loader;

    let resolved_exports: *mut [ResolvedExports] = meta.resolved_exports;
    let resolved_export_stars: *mut [ExportData] = meta.resolved_export_star;
    let imports_to_bind_list: *mut [RefImportData] = meta.imports_to_bind;
    let wrapper_part_indices: *mut [Index] = meta.wrapper_part_index;
    let sorted_aliases: *mut [Box<[Box<[u8]>]>] = meta.sorted_and_filtered_export_aliases;
    let cjs_export_copies: *mut [Box<[Ref]>] = meta.cjs_export_copies;
    let entry_point_part_indices: *mut [Index] = meta.entry_point_part_index;

    // PORT NOTE: Zig copies `symbols` to a local and `defer`-writes it back.
    // In Rust `this.graph.symbols` is the same storage, so no copy-back needed.

    {
        // Step 1: Figure out what modules must be CommonJS
        for source_index_ in &reachable {
            let _trace = perf::trace("Bundler.FigureOutCommonJS");
            let id = source_index_.get() as usize;

            // does it have a JS AST?
            if !(id < col_ref!(import_records_list).len()) {
                continue;
            }

            // Is it CSS?
            if col_ref!(css_asts)[id].is_some() {
                // Inline URLs for non-CSS files into the CSS file
                let _ = LinkerContext::scan_css_imports(
                    id as u32,
                    col_ref!(import_records_list)[id].slice(),
                    css_asts,
                    col_ref!(input_files),
                    col_ref!(loaders),
                    // `log_disjoint`: split-borrow with the SoA column refs above.
                    this.log_disjoint(),
                );

                // Validate cross-file "composes: ... from" named imports and
                // composes-from property collisions.
                __css_validation::validate_css_import_composes(
                    this,
                    id,
                    css_asts,
                    import_records_list,
                    input_files,
                );

                continue;
            }

            for record in col_ref!(import_records_list)[id].slice() {
                if !record.source_index.is_valid() {
                    continue;
                }

                let other_file = record.source_index.get() as usize;
                let other_flags = col_ref!(ast_flags_list)[other_file];
                // other file is empty
                if other_file >= col_ref!(exports_kind).len() {
                    continue;
                }
                let other_kind = col_ref!(exports_kind)[other_file];

                match record.kind {
                    ImportKind::Stmt => {
                        // Importing using ES6 syntax from a file without any ES6 syntax
                        // causes that module to be considered CommonJS-style, even if it
                        // doesn't have any CommonJS exports.
                        //
                        // That means the ES6 imports will become undefined instead of
                        // causing errors. This is for compatibility with older CommonJS-
                        // style bundlers.
                        //
                        // We emit a warning in this case but try to avoid turning the module
                        // into a CommonJS module if possible. This is possible with named
                        // imports (the module stays an ECMAScript module but the imports are
                        // rewritten with undefined) but is not possible with star or default
                        // imports:
                        //
                        //   import * as ns from './empty-file'
                        //   import defVal from './empty-file'
                        //   console.log(ns, defVal)
                        //
                        // In that case the module *is* considered a CommonJS module because
                        // the namespace object must be created.
                        if (record
                            .flags
                            .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR)
                            || record
                                .flags
                                .contains(ImportRecordFlags::CONTAINS_DEFAULT_ALIAS))
                            && !other_flags.contains(AstFlags::HAS_LAZY_EXPORT)
                            && !other_flags.contains(AstFlags::FORCE_CJS_TO_ESM)
                            && col_ref!(exports_kind)[other_file] == ExportsKind::None
                        {
                            col!(exports_kind)[other_file] = ExportsKind::Cjs;
                            col!(flags)[other_file].wrap = WrapKind::Cjs;
                        }

                        if record
                            .flags
                            .contains(ImportRecordFlags::CONTAINS_DEFAULT_ALIAS)
                            && other_flags.contains(AstFlags::FORCE_CJS_TO_ESM)
                        {
                            col!(exports_kind)[other_file] = ExportsKind::Cjs;
                            col!(flags)[other_file].wrap = WrapKind::Cjs;
                        }
                    }
                    ImportKind::Require =>
                    // Files that are imported with require() must be CommonJS modules
                    {
                        if other_kind == ExportsKind::Esm {
                            col!(flags)[other_file].wrap = WrapKind::Esm;
                        } else {
                            // TODO: introduce a NamedRequire for require("./foo").Bar AST nodes to support tree-shaking those.
                            col!(flags)[other_file].wrap = WrapKind::Cjs;
                            col!(exports_kind)[other_file] = ExportsKind::Cjs;
                        }
                    }
                    ImportKind::Dynamic => {
                        if !this.graph.code_splitting {
                            // If we're not splitting, then import() is just a require() that
                            // returns a promise, so the imported file must be a CommonJS module
                            if col_ref!(exports_kind)[other_file] == ExportsKind::Esm {
                                col!(flags)[other_file].wrap = WrapKind::Esm;
                            } else {
                                // TODO: introduce a NamedRequire for require("./foo").Bar AST nodes to support tree-shaking those.
                                col!(flags)[other_file].wrap = WrapKind::Cjs;
                                col!(exports_kind)[other_file] = ExportsKind::Cjs;
                            }
                        }
                    }
                    _ => {}
                }
            }

            let kind = col_ref!(exports_kind)[id];

            // If the output format doesn't have an implicit CommonJS wrapper, any file
            // that uses CommonJS features will need to be wrapped, even though the
            // resulting wrapper won't be invoked by other files. An exception is
            // made for entry point files in CommonJS format (or when in pass-through mode).
            if kind == ExportsKind::Cjs
                && (!col_ref!(entry_point_kinds)[id].is_entry_point()
                    || output_format == Format::Iife
                    || output_format == Format::Esm)
            {
                col!(flags)[id].wrap = WrapKind::Cjs;
            }
        }

        if cfg!(feature = "debug_logs") {
            let mut cjs_count: usize = 0;
            let mut esm_count: usize = 0;
            let mut wrap_cjs_count: usize = 0;
            let mut wrap_esm_count: usize = 0;
            for kind in col_ref!(exports_kind).iter() {
                cjs_count += (*kind == ExportsKind::Cjs) as usize;
                esm_count += (*kind == ExportsKind::Esm) as usize;
            }
            for flag in col_ref!(flags).iter() {
                wrap_cjs_count += (flag.wrap == WrapKind::Cjs) as usize;
                wrap_esm_count += (flag.wrap == WrapKind::Esm) as usize;
            }
            bun_core::scoped_log!(
                LinkerCtx,
                "Step 1: {} CommonJS modules (+ {} wrapped), {} ES modules (+ {} wrapped)",
                cjs_count,
                wrap_cjs_count,
                esm_count,
                wrap_esm_count,
            );
        }

        // Step 2: Propagate dynamic export status for export star statements that
        // are re-exports from a module whose exports are not statically analyzable.
        // In this case the export star must be evaluated at run time instead of at
        // bundle time.
        {
            let _trace = perf::trace("Bundler.WrapDependencies");
            // SAFETY: `split_raw()`-derived column ptrs carry root provenance
            // from the `MultiArrayList` heap buffer; this block holds no other
            // borrow into ast/meta/files and makes no `&mut this` calls, so
            // the reborrows are exclusive for the block. All five derefs share
            // the same invariant, so they are grouped under one `unsafe`.
            let mut dependency_wrapper = unsafe {
                DependencyWrapper {
                    flags: &mut *flags,
                    import_records: &*import_records_list,
                    exports_kind: &mut *exports_kind,
                    entry_point_kinds: &*entry_point_kinds,
                    export_star_map: HashMap::default(),
                    export_star_records: &*export_star_import_records,
                    output_format,
                }
            };
            // PORT NOTE: `defer dependency_wrapper.export_star_map.deinit()` → Drop handles it.

            for source_index_ in &reachable {
                let source_index = source_index_.get();
                let id = source_index as usize;

                // does it have a JS AST?
                if !(id < dependency_wrapper.import_records.len()) {
                    continue;
                }

                if dependency_wrapper.flags[id].wrap != WrapKind::None {
                    dependency_wrapper.wrap(source_index);
                }

                if dependency_wrapper.export_star_records[id].len() > 0 {
                    dependency_wrapper.export_star_map.clear();
                    let _ = dependency_wrapper.has_dynamic_exports_due_to_export_star(source_index);
                }

                // Even if the output file is CommonJS-like, we may still need to wrap
                // CommonJS-style files. Any file that imports a CommonJS-style file will
                // cause that file to need to be wrapped. This is because the import
                // method, whatever it is, will need to invoke the wrapper. Note that
                // this can include entry points (e.g. an entry point that imports a file
                // that imports that entry point).
                // `import_records` is a `&'a [_]` (Copy) field — copy it out so
                // the loop borrow does not overlap `&mut dependency_wrapper`.
                let import_records = dependency_wrapper.import_records;
                for record in import_records[id].slice() {
                    if record.source_index.is_valid() {
                        let si = record.source_index.get();
                        if dependency_wrapper.exports_kind[si as usize] == ExportsKind::Cjs {
                            dependency_wrapper.wrap(si);
                        }
                    }
                }
            }
        }

        // Step 3: Resolve "export * from" statements. This must be done after we
        // discover all modules that can have dynamic exports because export stars
        // are ignored for those modules.
        {
            let mut export_star_ctx: Option<ExportStarContext> = None;
            let _trace = perf::trace("Bundler.ResolveExportStarStatements");
            // PORT NOTE: `defer { if (export_star_ctx) |*export_ctx| export_ctx.source_index_stack.deinit(); }`
            // → Drop on `export_star_ctx` handles freeing `source_index_stack: Vec<u32>`.

            for source_index_ in &reachable {
                let source_index = source_index_.get();
                let id = source_index as usize;

                // Expression-style loaders defer code generation until linking. Code
                // generation is done here because at this point we know that the
                // "ExportsKind" field has its final value and will not be changed.
                if col_ref!(ast_flags_list)[id].contains(AstFlags::HAS_LAZY_EXPORT) {
                    this.generate_code_for_lazy_export(id as u32)?;
                }

                // Propagate exports for export star statements
                if col_ref!(export_star_import_records)[id].len() > 0 {
                    if export_star_ctx.is_none() {
                        export_star_ctx = Some(ExportStarContext {
                            import_records_list,
                            export_star_records: export_star_import_records,
                            imports_to_bind: imports_to_bind_list,
                            source_index_stack: Vec::with_capacity(32),
                            exports_kind,
                            named_exports,
                        });
                    }
                    export_star_ctx.as_mut().unwrap().add_exports(
                        resolved_exports,
                        id,
                        source_index,
                    );
                }

                // Also add a special export so import stars can bind to it. This must be
                // done in this step because it must come after CommonJS module discovery
                // but before matching imports with exports.
                col!(resolved_export_stars)[id] = ExportData {
                    data: ImportTracker {
                        source_index: Index::source(source_index),
                        import_ref: col_ref!(exports_refs)[id],
                        ..Default::default()
                    },
                    ..Default::default()
                };
            }
        }

        if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
            this.check_for_memory_corruption();
        }

        // Step 4: Match imports with exports. This must be done after we process all
        // export stars because imports can bind to export star re-exports.
        {
            this.cycle_detector.clear();
            let _trace = perf::trace("Bundler.MatchImportsWithExports");
            for source_index_ in &reachable {
                let source_index = source_index_.get() as usize;

                // not a JS ast or empty
                if source_index >= col_ref!(named_imports).len() {
                    continue;
                }

                if col_ref!(named_imports)[source_index].count() > 0 {
                    this.match_imports_with_exports_for_file(
                        // SAFETY: `named_imports` is a raw column ptr;
                        // pass the element by raw `*const` so no `&mut`
                        // protector spans the `&mut this` call (the callee
                        // re-reads this same column via `self.graph.ast`).
                        unsafe { core::ptr::addr_of!((*named_imports)[source_index]) },
                        &mut col!(imports_to_bind_list)[source_index],
                        source_index_.get(),
                    );

                    if this.log().errors > 0 {
                        return Err(ScanImportsAndExportsError::ImportResolutionFailed);
                    }
                }
                let export_kind = col_ref!(exports_kind)[source_index];
                let mut flag = col_ref!(flags)[source_index];
                // If we're exporting as CommonJS and this file was originally CommonJS,
                // then we'll be using the actual CommonJS "exports" and/or "module"
                // symbols. In that case make sure to mark them as such so they don't
                // get minified.
                if (output_format == Format::Cjs)
                    && col_ref!(entry_point_kinds)[source_index].is_entry_point()
                    && export_kind == ExportsKind::Cjs
                    && flag.wrap == WrapKind::None
                {
                    let exports_ref = this
                        .graph
                        .symbols
                        .follow(col_ref!(exports_refs)[source_index]);
                    let module_ref = this
                        .graph
                        .symbols
                        .follow(col_ref!(module_refs)[source_index]);
                    unsafe { this.graph.symbol_mut(exports_ref) }.kind = SymbolKind::Unbound;
                    unsafe { this.graph.symbol_mut(module_ref) }.kind = SymbolKind::Unbound;
                } else if flag.force_include_exports_for_entry_point
                    || export_kind != ExportsKind::Cjs
                {
                    flag.needs_exports_variable = true;
                    col!(flags)[source_index] = flag;
                }

                let wrapped_ref = col_ref!(wrapper_refs)[source_index];

                // Create the wrapper part for wrapped files. This is needed by a later step.
                this.create_wrapper_for_file(
                    flag.wrap,
                    // if this one is null, the AST does not need to be wrapped.
                    wrapped_ref,
                    &mut col!(wrapper_part_indices)[source_index],
                    source_index_.get(),
                );
            }
        }

        // Step 5: Create namespace exports for every file. This is always necessary
        // for CommonJS files, and is also necessary for other files if they are
        // imported using an import star statement.
        // Note: `do` will wait for all to finish before moving forward
        //
        // PORT NOTE: Zig dispatched via `worker_pool.each(arena, this,
        // doStep5, reachable_files)` (parallel fan-out, blocks until done).
        // `do_step5` only touches distinct SoA rows per `source_index` (the
        // columns are pre-sized and never reallocate during this step),
        // matching the Zig invariant. We pass `*mut LinkerContext` through a
        // `Sync` wrapper; the callee derefs it to `&LinkerContext` (shared)
        // for reads and writes per-row cells via raw `split_raw()` pointers —
        // mirroring `GenerateChunkCtx` (`generate_js_renamer` likewise never
        // forms `&mut LinkerContext`).
        {
            #[repr(transparent)]
            struct Step5Ctx<'a>(*mut LinkerContext<'a>);
            // SAFETY: the pointer is only dereferenced to `&LinkerContext` for
            // reads plus raw `*mut` per-row SoA cells for disjoint-row writes
            // (see `do_step5` doc); lifetime is bounded by the blocking
            // `each()` call below. The `ThreadPool::Worker` it acquires is
            // per-OS-thread.
            unsafe impl core::marker::Sync for Step5Ctx<'_> {}

            let ctx = Step5Ctx(core::ptr::from_mut::<LinkerContext<'_>>(this));
            // SAFETY: `parse_graph` is the `BundleV2.graph` backref (valid for
            // the link step); `pool` is the arena-allocated bundler ThreadPool
            // set in `BundleV2::init`.
            let worker_pool = this.worker_pool();
            // `each` requires `&mut [V]`; `reachable` is a private snapshot Vec
            // so reborrow it mutably (not actually mutated by the by-value
            // variant). Step 6 reuses it afterwards.
            worker_pool.each(
                ctx,
                |ctx: &Step5Ctx<'_>, source_index: Index, i: usize| {
                    // SAFETY: see `Step5Ctx` Sync justification above.
                    unsafe { LinkerContext::do_step5(ctx.0, source_index, i) };
                },
                &mut reachable[..],
            );
        }

        // Some parts of the AST may now be owned by worker allocators. Transfer ownership back
        // to the graph arena.
        this.graph.take_ast_ownership();
    }

    if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
        this.check_for_memory_corruption();
    }

    // Step 6: Bind imports to exports. This adds non-local dependencies on the
    // parts that declare the export to all parts that use the import. Also
    // generate wrapper parts for wrapped files.
    {
        let _trace = perf::trace("Bundler.BindImportsToExports");
        // const needs_export_symbol_from_runtime: []const bool = this.graph.meta.items().needs_export_symbol_from_runtime;

        let mut runtime_export_symbol_ref: Ref = Ref::NONE;

        for source_index_ in &reachable {
            let source_index = source_index_.get();
            let id = source_index as usize;

            let is_entry_point = col_ref!(entry_point_kinds)[id].is_entry_point();
            let aliases: &[Box<[u8]>] = &col_ref!(sorted_aliases)[id];
            let flag = col_ref!(flags)[id];
            let wrap = flag.wrap;
            let export_kind = col_ref!(exports_kind)[id];
            let source: &Source = &col_ref!(input_files)[id];

            let exports_ref = col_ref!(exports_refs)[id];
            let module_ref = col_ref!(module_refs)[id];

            let string_buffer_len: usize = 'brk: {
                let mut count: usize = 0;
                if is_entry_point && output_format == Format::Esm {
                    for alias in aliases.iter() {
                        count += bun_core::fmt::count(format_args!(
                            "export_{}",
                            bun_core::fmt::fmt_identifier(alias)
                        ));
                    }
                }

                let ident_fmt_len: usize = if source.identifier_name.len() > 0 {
                    source.identifier_name.len()
                } else {
                    bun_core::fmt::count(format_args!("{}", source.fmt_identifier()))
                };

                if wrap == WrapKind::Esm && col_ref!(wrapper_refs)[id].is_valid() {
                    count += "init_".len() + ident_fmt_len;
                }

                if wrap != WrapKind::Cjs
                    && export_kind != ExportsKind::Cjs
                    && output_format != Format::InternalBakeDev
                {
                    count += "exports_".len() + ident_fmt_len;
                    count += "module_".len() + ident_fmt_len;
                }

                break 'brk count;
            };

            // Allocate the identifier-name buffer from the linker arena so it is
            // reclaimed when the link pass ends (Zig: `this.arena().alloc(u8, ...)`).
            // The slices handed out below are stored in `Symbol.original_name: *const [u8]`,
            // which is arena-lifetime by construction.
            let string_buffer: &mut [u8] = this
                .graph
                .arena()
                .alloc_slice_fill_default::<u8>(string_buffer_len);
            // PORT NOTE: `StringBuilder::drop` reconstructs a `Box<[u8]>` from
            // `ptr`/`cap` and frees it via the global arena. Here the
            // backing buffer is arena-owned (bumpalo), so dropping would hand
            // mimalloc a pointer it never allocated. Wrap in `ManuallyDrop` —
            // the arena reclaims the storage on reset, matching Zig's implicit
            // no-destructor semantics.
            let mut builder = core::mem::ManuallyDrop::new(bun_core::StringBuilder {
                len: 0,
                cap: string_buffer.len(),
                ptr: core::ptr::NonNull::new(string_buffer.as_mut_ptr()),
            });

            // Pre-generate symbols for re-exports CommonJS symbols in case they
            // are necessary later. This is done now because the symbols map cannot be
            // mutated later due to parallelism.
            if is_entry_point && output_format == Format::Esm {
                let mut copies = vec![Ref::NONE; aliases.len()].into_boxed_slice();

                debug_assert_eq!(aliases.len(), copies.len());
                for (alias, copy) in aliases.iter().zip(copies.iter_mut()) {
                    let original_name = builder.fmt(format_args!(
                        "export_{}",
                        bun_core::fmt::fmt_identifier(alias)
                    ));
                    *copy = this.graph.generate_new_symbol(
                        source_index,
                        SymbolKind::Other,
                        original_name,
                    );
                }
                col!(cjs_export_copies)[id] = copies;
            }

            // Use "init_*" for ESM wrappers instead of "require_*"
            if wrap == WrapKind::Esm {
                let r#ref = col_ref!(wrapper_refs)[id];
                if r#ref.is_valid() {
                    let original_name =
                        builder.fmt(format_args!("init_{}", source.fmt_identifier()));
                    unsafe { this.graph.symbol_mut(r#ref) }.original_name =
                        bun_ast::StoreStr::new(original_name);
                }
            }

            // If this isn't CommonJS, then rename the unused "exports" and "module"
            // variables to avoid them causing the identically-named variables in
            // actual CommonJS files from being renamed. This is purely about
            // aesthetics and is not about correctness. This is done here because by
            // this point, we know the CommonJS status will not change further.
            if wrap != WrapKind::Cjs
                && export_kind != ExportsKind::Cjs
                && output_format != Format::InternalBakeDev
            {
                let exports_name = bun_ast::StoreStr::new(
                    builder.fmt(format_args!("exports_{}", source.fmt_identifier())),
                );
                let module_name = bun_ast::StoreStr::new(
                    builder.fmt(format_args!("module_{}", source.fmt_identifier())),
                );

                // Note: it's possible for the symbols table to be resized
                // so we cannot call .get() above this scope.
                if exports_ref.is_valid() {
                    if let Some(s) = this.graph.symbols.get(exports_ref) {
                        // SAFETY: `Map::get` returns a stable `*mut Symbol`.
                        unsafe { (*s).original_name = exports_name };
                    }
                }
                if module_ref.is_valid() {
                    if let Some(s) = this.graph.symbols.get(module_ref) {
                        // SAFETY: `Map::get` returns a stable `*mut Symbol`.
                        unsafe { (*s).original_name = module_name };
                    }
                }
            }

            // PORT NOTE: Zig `defer bun.assert(builder.len == builder.cap)` —
            // moved to end-of-scope assert (no early returns inside this block).
            debug_assert!(builder.len == builder.cap);

            // Include the "__export" symbol from the runtime if it was used in the
            // previous step. The previous step can't do this because it's running in
            // parallel and can't safely mutate the "importsToBind" map of another file.
            if flag.needs_export_symbol_from_runtime {
                if !runtime_export_symbol_ref.is_valid() {
                    runtime_export_symbol_ref = this.runtime_function(b"__export");
                }

                debug_assert!(runtime_export_symbol_ref.is_valid());

                this.graph.generate_symbol_import_and_use(
                    source_index,
                    bun_ast::NAMESPACE_EXPORT_PART_INDEX,
                    runtime_export_symbol_ref,
                    1,
                    Index::RUNTIME,
                )?;
            }

            {
                let imports_to_bind = &col_ref!(imports_to_bind_list)[id];
                debug_assert_eq!(imports_to_bind.keys().len(), imports_to_bind.values().len());
                // PORT NOTE: reshaped for borrowck — iterate by index so we can
                // re-borrow `parts` after each `top_level_symbol_to_parts` call.
                for itb_i in 0..imports_to_bind.keys().len() {
                    let r#ref: Ref = col_ref!(imports_to_bind_list)[id].keys()[itb_i];
                    let import_source_index;
                    let import_ref;
                    // `BackRef<[Dependency]>` — points into the `imports_to_bind`
                    // value column, which is not mutated for the rest of this
                    // loop body; the backref invariant (pointee outlives holder)
                    // lets the inner-loop reads go through safe `Deref`.
                    let re_exports_ptr: bun_ptr::BackRef<[Dependency]>;
                    {
                        let import: &ImportData =
                            &col_ref!(imports_to_bind_list)[id].values()[itb_i];
                        import_source_index = import.data.source_index.get();
                        import_ref = import.data.import_ref;
                        re_exports_ptr = bun_ptr::BackRef::new(import.re_exports.slice());
                    }

                    if let Some(named_import) = col_ref!(named_imports)[id].get(&r#ref) {
                        // PERF(port): clone to avoid holding column borrow across `&mut this.graph`.
                        let local_parts: Vec<u32> =
                            named_import.local_parts_with_uses.slice().to_vec();
                        for part_index in local_parts {
                            let parts_declaring_symbol: Vec<u32> = this
                                .graph
                                .top_level_symbol_to_parts(import_source_index, import_ref)
                                .to_vec();
                            // PERF(port): was zero-copy slice borrow; profile.

                            let part: &mut Part =
                                &mut col!(parts_list)[id].slice_mut()[part_index as usize];
                            let re_exports: &[Dependency] = &re_exports_ptr;
                            let total_len = parts_declaring_symbol.len()
                                + re_exports.len()
                                + part.dependencies.len() as usize;
                            // PORT NOTE: bun.handleOom dropped — Vec growth aborts on OOM.
                            part.dependencies.ensure_total_capacity(total_len);

                            // Depend on the file containing the imported symbol
                            for resolved_part_index in parts_declaring_symbol {
                                // PERF(port): was appendAssumeCapacity
                                part.dependencies.push(Dependency {
                                    source_index: bun_ast::Index::source(
                                        import_source_index as usize,
                                    ),
                                    part_index: resolved_part_index,
                                });
                            }

                            // Also depend on any files that re-exported this symbol in between the
                            // file containing the import and the file containing the imported symbol
                            // PERF(port): was appendSliceAssumeCapacity
                            for dep in re_exports {
                                part.dependencies.push(*dep);
                            }
                        }
                    }

                    let _ = this.graph.symbols.merge(r#ref, import_ref);
                }
            }

            // If this is an entry point, depend on all exports so they are included
            if is_entry_point {
                let force_include_exports = flag.force_include_exports_for_entry_point;
                let add_wrapper = wrap != WrapKind::None;

                let extra_count = (force_include_exports as usize) + (add_wrapper as usize);

                let mut dependencies: Vec<Dependency> = Vec::with_capacity(extra_count);

                for alias in col_ref!(sorted_aliases)[id].iter() {
                    let exp = col_ref!(resolved_exports)[id].get(alias).unwrap();
                    let mut target_source_index = exp.data.source_index;
                    let mut target_ref = exp.data.import_ref;

                    // If this is an import, then target what the import points to
                    if let Some(import_data) = col_ref!(imports_to_bind_list)
                        [target_source_index.get() as usize]
                        .get(&target_ref)
                    {
                        target_source_index = import_data.data.source_index;
                        target_ref = import_data.data.import_ref;

                        for dep in import_data.re_exports.slice() {
                            dependencies.push(*dep);
                        }
                    }

                    // Pull in all declarations of this symbol
                    let top_to_parts =
                        this.top_level_symbols_to_parts(target_source_index.get(), target_ref);
                    dependencies.reserve(top_to_parts.len());
                    for part_index in top_to_parts {
                        // PERF(port): was appendAssumeCapacity
                        dependencies.push(Dependency {
                            // PORT NOTE: `crate::Index` ↔ `bun_ast::Index` are both
                            // `#[repr(transparent)] u32` newtypes ported from the
                            // same Zig `ast.Index`; bridge by `.value` until B-3
                            // collapses them to a single re-export.
                            source_index: bun_ast::Index(target_source_index.get()),
                            part_index: *part_index,
                        });
                    }
                }

                dependencies.reserve(extra_count);

                // Ensure "exports" is included if the current output format needs it
                if force_include_exports {
                    // PERF(port): was appendAssumeCapacity
                    dependencies.push(Dependency {
                        source_index: bun_ast::Index::source(source_index as usize),
                        part_index: bun_ast::NAMESPACE_EXPORT_PART_INDEX,
                    });
                }

                // Include the wrapper if present
                if add_wrapper {
                    // PERF(port): was appendAssumeCapacity
                    dependencies.push(Dependency {
                        source_index: bun_ast::Index::source(source_index as usize),
                        part_index: col_ref!(wrapper_part_indices)[id].get(),
                    });
                }

                // Represent these constraints with a dummy part
                let entry_point_part_index = this.graph.add_part_to_file(
                    source_index,
                    Part {
                        dependencies: Vec::<Dependency>::move_from_list(dependencies),
                        can_be_removed_if_unused: false,
                        ..Default::default()
                    },
                )?;
                // PORT NOTE: `catch |err| bun.handleOom(err)` dropped — `?` propagates OOM.

                col!(entry_point_part_indices)[id] = Index::part(entry_point_part_index);

                // Pull in the "__toCommonJS" symbol if we need it due to being an entry point
                if force_include_exports && output_format != Format::InternalBakeDev {
                    this.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(entry_point_part_index),
                        b"__toCommonJS",
                        1,
                    )?;
                }
            }

            // Encode import-specific constraints in the dependency graph
            bun_core::scoped_log!(
                LinkerCtx,
                "Binding {} imports for file {} (#{})",
                col_ref!(import_records_list)[id].len(),
                bstr::BStr::new(&source.path.text),
                id
            );

            let parts_len = col_ref!(parts_list)[id].len() as usize;
            for part_index in 0..parts_len {
                let mut to_esm_uses: u32 = 0;
                let mut to_common_js_uses: u32 = 0;
                let mut runtime_require_uses: u32 = 0;

                // Imports of wrapped files must depend on the wrapper
                // PORT NOTE: iterate by index so each iteration re-borrows
                // `import_records` (the body calls `&mut this.graph` methods).
                let import_record_indices_len = col_ref!(parts_list)[id].slice()[part_index]
                    .import_record_indices
                    .len() as usize;
                for iri in 0..import_record_indices_len {
                    let import_record_index = col_ref!(parts_list)[id].slice()[part_index]
                        .import_record_indices
                        .slice()[iri];
                    let (kind, rec_source_index, rec_flags) = {
                        let record = &col_ref!(import_records_list)[id].slice()
                            [import_record_index as usize];
                        (record.kind, record.source_index, record.flags)
                    };
                    let other_id = rec_source_index.value() as usize;

                    // Don't follow external imports (this includes import() expressions)
                    // PORT NOTE: short-circuit — `is_external_dynamic_import` indexes by
                    // `record.source_index`, so it must only run when that index is valid.
                    let is_external_dyn = rec_source_index.is_valid() && {
                        let record = &col_ref!(import_records_list)[id].slice()
                            [import_record_index as usize];
                        this.is_external_dynamic_import(record, source_index)
                    };
                    if !rec_source_index.is_valid() || is_external_dyn {
                        if output_format == Format::InternalBakeDev {
                            continue;
                        }

                        // This is an external import. Check if it will be a "require()" call.
                        if kind == ImportKind::Require
                            || !output_format.keep_es6_import_export_syntax()
                            || kind == ImportKind::Dynamic
                        {
                            if rec_source_index.is_valid()
                                && kind == ImportKind::Dynamic
                                && col_ref!(ast_flags_list)[other_id]
                                    .contains(AstFlags::FORCE_CJS_TO_ESM)
                            {
                                // If the CommonJS module was converted to ESM
                                // and the developer `import("cjs_module")`, then
                                // they may have code that expects the default export to return the CommonJS module.exports object
                                // That module.exports object does not exist.
                                // We create a default object with getters for each statically-known export
                                // This is kind of similar to what Node.js does
                                // Once we track usages of the dynamic import, we can remove this.
                                if !col_ref!(named_exports)[other_id].contains(b"default") {
                                    col!(flags)[other_id].needs_synthetic_default_export = true;
                                }

                                continue;
                            } else {
                                // We should use "__require" instead of "require" if we're not
                                // generating a CommonJS output file, since it won't exist otherwise.
                                if should_call_runtime_require(output_format) {
                                    runtime_require_uses += 1;
                                }

                                // If this wasn't originally a "require()" call, then we may need
                                // to wrap this in a call to the "__toESM" wrapper to convert from
                                // CommonJS semantics to ESM semantics.
                                //
                                // Unfortunately this adds some additional code since the conversion
                                // is somewhat complex. As an optimization, we can avoid this if the
                                // following things are true:
                                //
                                // - The import is an ES module statement (e.g. not an "import()" expression)
                                // - The ES module namespace object must not be captured
                                // - The "default" and "__esModule" exports must not be accessed
                                //
                                if kind != ImportKind::Require
                                    && (kind != ImportKind::Stmt
                                        || rec_flags
                                            .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR)
                                        || rec_flags
                                            .contains(ImportRecordFlags::CONTAINS_DEFAULT_ALIAS)
                                        || rec_flags
                                            .contains(ImportRecordFlags::CONTAINS_ES_MODULE_ALIAS))
                                {
                                    // For dynamic imports to cross-chunk CJS modules, we need extra
                                    // unwrapping in js_printer (.then((m)=>__toESM(m.default))).
                                    // For other cases (static imports, truly external), use standard wrapping.
                                    if rec_source_index.is_valid()
                                        && is_external_dyn
                                        && col_ref!(exports_kind)[rec_source_index.get() as usize]
                                            == ExportsKind::Cjs
                                    {
                                        // Cross-chunk dynamic import to CJS - needs special handling in printer
                                        col!(import_records_list)[id].slice_mut()
                                            [import_record_index as usize]
                                            .flags
                                            .insert(ImportRecordFlags::WRAP_WITH_TO_ESM);
                                        to_esm_uses += 1;
                                    } else if kind != ImportKind::Dynamic {
                                        // Static imports to external CJS modules need __toESM wrapping
                                        col!(import_records_list)[id].slice_mut()
                                            [import_record_index as usize]
                                            .flags
                                            .insert(ImportRecordFlags::WRAP_WITH_TO_ESM);
                                        to_esm_uses += 1;
                                    }
                                    // Dynamic imports to truly external modules: no wrapping (preserve native format)
                                }
                            }
                        }
                        continue;
                    }

                    debug_assert!(other_id < this.graph.meta.len());
                    let other_flags = col_ref!(flags)[other_id];
                    let other_export_kind = col_ref!(exports_kind)[other_id];
                    let other_source_index = other_id as u32;

                    if other_flags.wrap != WrapKind::None {
                        // Depend on the automatically-generated require wrapper symbol
                        let wrapper_ref = col_ref!(wrapper_refs)[other_id];
                        if wrapper_ref.is_valid() {
                            this.graph.generate_symbol_import_and_use(
                                source_index,
                                part_index as u32,
                                wrapper_ref,
                                1,
                                Index::source(other_source_index),
                            )?;
                        }

                        // This is an ES6 import of a CommonJS module, so it needs the
                        // "__toESM" wrapper as long as it's not a bare "require()"
                        if kind != ImportKind::Require
                            && other_export_kind == ExportsKind::Cjs
                            && output_format != Format::InternalBakeDev
                        {
                            col!(import_records_list)[id].slice_mut()[import_record_index as usize]
                                .flags
                                .insert(ImportRecordFlags::WRAP_WITH_TO_ESM);
                            to_esm_uses += 1;
                        }

                        // If this is an ESM wrapper, also depend on the exports object
                        // since the final code will contain an inline reference to it.
                        // This must be done for "require()" and "import()" expressions
                        // but does not need to be done for "import" statements since
                        // those just cause us to reference the exports directly.
                        if other_flags.wrap == WrapKind::Esm && kind != ImportKind::Stmt {
                            this.graph.generate_symbol_import_and_use(
                                source_index,
                                part_index as u32,
                                col_ref!(exports_refs)[other_id],
                                1,
                                Index::source(other_source_index),
                            )?;

                            // If this is a "require()" call, then we should add the
                            // "__esModule" marker to behave as if the module was converted
                            // from ESM to CommonJS. This is done via a wrapper instead of
                            // by modifying the exports object itself because the same ES
                            // module may be simultaneously imported and required, and the
                            // importing code should not see "__esModule" while the requiring
                            // code should see "__esModule". This is an extremely complex
                            // and subtle set of transpiler interop issues. See for example
                            // https://github.com/evanw/esbuild/issues/1591.
                            if kind == ImportKind::Require {
                                col!(import_records_list)[id].slice_mut()
                                    [import_record_index as usize]
                                    .flags
                                    .insert(ImportRecordFlags::WRAP_WITH_TO_COMMONJS);
                                to_common_js_uses += 1;
                            }
                        }
                    } else if kind == ImportKind::Stmt
                        && export_kind == ExportsKind::EsmWithDynamicFallback
                    {
                        // This is an import of a module that has a dynamic export fallback
                        // object. In that case we need to depend on that object in case
                        // something ends up needing to use it later. This could potentially
                        // be omitted in some cases with more advanced analysis if this
                        // dynamic export fallback object doesn't end up being needed.
                        this.graph.generate_symbol_import_and_use(
                            source_index,
                            part_index as u32,
                            col_ref!(exports_refs)[other_id],
                            1,
                            Index::source(other_source_index),
                        )?;
                    }
                }

                // If there's an ES6 export star statement of a non-ES6 module, then we're
                // going to need the "__reExport" symbol from the runtime
                let mut re_export_uses: u32 = 0;

                for import_record_index in col_ref!(export_star_import_records)[id].iter() {
                    let (rec_source_index,) = {
                        let record = &col_ref!(import_records_list)[id].slice()
                            [*import_record_index as usize];
                        (record.source_index,)
                    };

                    let mut happens_at_runtime = rec_source_index.is_invalid()
                        && (!is_entry_point || !output_format.keep_es6_import_export_syntax());
                    if rec_source_index.is_valid() {
                        let other_source_index = rec_source_index.get();
                        let other_id = other_source_index as usize;
                        debug_assert!(other_id < this.graph.meta.len());
                        let other_export_kind = col_ref!(exports_kind)[other_id];
                        if other_source_index != source_index && other_export_kind.is_dynamic() {
                            happens_at_runtime = true;
                        }

                        if other_export_kind.is_esm_with_dynamic_fallback() {
                            // This looks like "__reExport(exports_a, exports_b)". Make sure to
                            // pull in the "exports_b" symbol into this export star. This matters
                            // in code splitting situations where the "export_b" symbol might live
                            // in a different chunk than this export star.
                            this.graph.generate_symbol_import_and_use(
                                source_index,
                                part_index as u32,
                                col_ref!(exports_refs)[other_id],
                                1,
                                Index::source(other_source_index),
                            )?;
                        }
                    }

                    if happens_at_runtime {
                        // Depend on this file's "exports" object for the first argument to "__reExport"
                        this.graph.generate_symbol_import_and_use(
                            source_index,
                            part_index as u32,
                            col_ref!(exports_refs)[id],
                            1,
                            Index::source(source_index),
                        )?;
                        col!(ast_flags_list)[id].insert(AstFlags::USES_EXPORTS_REF);
                        col!(import_records_list)[id].slice_mut()[*import_record_index as usize]
                            .flags
                            .insert(ImportRecordFlags::CALLS_RUNTIME_RE_EXPORT_FN);
                        re_export_uses += 1;
                    }
                }

                if output_format != Format::InternalBakeDev {
                    // If there's an ES6 import of a CommonJS module, then we're going to need the
                    // "__toESM" symbol from the runtime to wrap the result of "require()"
                    this.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(part_index as u32),
                        b"__toESM",
                        to_esm_uses,
                    )?;

                    // If there's a CommonJS require of an ES6 module, then we're going to need the
                    // "__toCommonJS" symbol from the runtime to wrap the exports object
                    this.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(part_index as u32),
                        b"__toCommonJS",
                        to_common_js_uses,
                    )?;

                    // If there are unbundled calls to "require()" and we're not generating
                    // code for node, then substitute a "__require" wrapper for "require".
                    this.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(part_index as u32),
                        b"__require",
                        runtime_require_uses,
                    )?;

                    this.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(part_index as u32),
                        b"__reExport",
                        re_export_uses,
                    )?;
                }
            }
        }
    }

    Ok(())
}

#[inline]
fn should_call_runtime_require(format: options::Format) -> bool {
    format != Format::Cjs
}

// ──────────────────────────────────────────────────────────────────────────
// DependencyWrapper — port of the inner Zig struct.
// ──────────────────────────────────────────────────────────────────────────
struct DependencyWrapper<'a> {
    flags: &'a mut [js_meta::Flags],
    exports_kind: &'a mut [ExportsKind],
    import_records: &'a [ImportRecordList],
    export_star_map: HashMap<IndexInt, ()>,
    entry_point_kinds: &'a [EntryPoint::Kind],
    export_star_records: &'a [Box<[u32]>],
    output_format: options::Format,
}

impl DependencyWrapper<'_> {
    fn has_dynamic_exports_due_to_export_star(&mut self, source_index: IndexInt) -> bool {
        // Terminate the traversal now if this file already has dynamic exports
        let export_kind = self.exports_kind[source_index as usize];
        match export_kind {
            ExportsKind::Cjs | ExportsKind::EsmWithDynamicFallback => return true,
            _ => {}
        }

        // Avoid infinite loops due to cycles in the export star graph
        let has_visited = self
            .export_star_map
            .get_or_put(source_index)
            .expect("unreachable");
        if has_visited.found_existing {
            return false;
        }

        for id in self.export_star_records[source_index as usize].iter() {
            // This file has dynamic exports if the exported imports are from a file
            // that either has dynamic exports directly or transitively by itself
            // having an export star from a file with dynamic exports.
            let kind = self.entry_point_kinds[source_index as usize];
            let rec_source_index =
                self.import_records[source_index as usize].slice()[*id as usize].source_index;
            if (rec_source_index.is_invalid()
                && (!kind.is_entry_point() || !self.output_format.keep_es6_import_export_syntax()))
                || (rec_source_index.is_valid()
                    && rec_source_index.get() != source_index
                    && self.has_dynamic_exports_due_to_export_star(rec_source_index.get()))
            {
                self.exports_kind[source_index as usize] = ExportsKind::EsmWithDynamicFallback;
                return true;
            }
        }

        false
    }

    fn wrap(&mut self, source_index: IndexInt) {
        let mut flag = self.flags[source_index as usize];

        if flag.did_wrap_dependencies {
            return;
        }
        flag.did_wrap_dependencies = true;

        // Never wrap the runtime file since it always comes first
        if source_index == Index::RUNTIME.get() {
            return;
        }

        // This module must be wrapped
        if flag.wrap == WrapKind::None {
            flag.wrap = match self.exports_kind[source_index as usize] {
                ExportsKind::Cjs => WrapKind::Cjs,
                _ => WrapKind::Esm,
            };
        }
        self.flags[source_index as usize] = flag;

        // `import_records` is a `&'a [_]` (Copy) field — copy it out so the
        // recursive `&mut self` call does not overlap the iterator borrow.
        let records = self.import_records;
        for record in records[source_index as usize].slice() {
            if !record.source_index.is_valid() {
                continue;
            }
            self.wrap(record.source_index.get());
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ExportStarContext — port of the inner Zig struct. Holds raw column ptrs.
// ──────────────────────────────────────────────────────────────────────────
struct ExportStarContext {
    import_records_list: *mut [ImportRecordList],
    source_index_stack: Vec<IndexInt>,
    exports_kind: *mut [ExportsKind],
    named_exports: *mut [NamedExports],
    imports_to_bind: *mut [RefImportData],
    export_star_records: *mut [Box<[u32]>],
}

impl ExportStarContext {
    /// Recursively merge re-exports from `source_index` into
    /// `resolved_exports[target_id]`.
    fn add_exports(
        &mut self,
        resolved_exports: *mut [ResolvedExports],
        target_id: usize,
        source_index: IndexInt,
    ) {
        // Avoid infinite loops due to cycles in the export star graph
        for i in self.source_index_stack.iter() {
            if *i == source_index {
                return;
            }
        }
        self.source_index_stack.push(source_index);
        let stack_end_pos = self.source_index_stack.len();

        for import_id in col_ref!(self.export_star_records)[source_index as usize].iter() {
            let other_source_index = col_ref!(self.import_records_list)[source_index as usize]
                .slice()[*import_id as usize]
                .source_index
                .get();

            let other_id = other_source_index as usize;
            if other_id >= col_ref!(self.named_exports).len() {
                // this AST was empty or it wasn't a JS AST
                continue;
            }

            // Export stars from a CommonJS module don't work because they can't be
            // statically discovered. Just silently ignore them in this case.
            //
            // We could attempt to check whether the imported file still has ES6
            // exports even though it still uses CommonJS features. However, when
            // doing this we'd also have to rewrite any imports of these export star
            // re-exports as property accesses off of a generated require() call.
            if col_ref!(self.exports_kind)[other_id] == ExportsKind::Cjs {
                continue;
            }

            // PORT NOTE: reshaped for borrowck — collect (alias, name) pairs so the
            // loop body can mutably borrow `resolved_exports` / `imports_to_bind`.
            // PERF(port): was zero-copy `iter()` over StringArrayHashMap; profile.
            let exports_len = col_ref!(self.named_exports)[other_id].keys().len();
            'next_export: for ne_i in 0..exports_len {
                // `BackRef<[u8]>` — points into the `named_exports` key
                // storage, which is not mutated in this loop; the backref
                // invariant lets reads go through safe `Deref`.
                let alias: bun_ptr::BackRef<[u8]> = bun_ptr::BackRef::new(
                    col_ref!(self.named_exports)[other_id].keys()[ne_i].as_ref(),
                );
                let name = col_ref!(self.named_exports)[other_id].values()[ne_i];

                // ES6 export star statements ignore exports named "default"
                let alias_slice: &[u8] = &alias;
                if alias_slice == b"default" {
                    continue;
                }

                // This export star is shadowed if any file in the stack has a matching real named export
                for prev in &self.source_index_stack[0..stack_end_pos] {
                    if col_ref!(self.named_exports)[*prev as usize].contains(alias_slice) {
                        continue 'next_export;
                    }
                }

                let gop = col!(resolved_exports)[target_id]
                    .get_or_put(alias_slice)
                    .expect("oom");
                if !gop.found_existing {
                    // Initialize the re-export
                    *gop.value_ptr = ExportData {
                        data: ImportTracker {
                            import_ref: name.ref_,
                            source_index: Index::source(other_source_index),
                            name_loc: name.alias_loc,
                        },
                        ..Default::default()
                    };

                    // Make sure the symbol is marked as imported so that code splitting
                    // imports it correctly if it ends up being shared with another chunk
                    col!(self.imports_to_bind)[source_index as usize]
                        .put(
                            name.ref_,
                            ImportData {
                                data: ImportTracker {
                                    import_ref: name.ref_,
                                    source_index: Index::source(other_source_index),
                                    ..Default::default()
                                },
                                ..Default::default()
                            },
                        )
                        .expect("oom");
                    // PORT NOTE: `catch |err| bun.handleOom(err)` dropped — aborts on OOM.
                } else if gop.value_ptr.data.source_index.get() != other_source_index {
                    // Two different re-exports colliding makes it potentially ambiguous
                    gop.value_ptr
                        .potentially_ambiguous_export_star_refs
                        .push(ImportData {
                            data: ImportTracker {
                                source_index: Index::source(other_source_index),
                                import_ref: name.ref_,
                                name_loc: name.alias_loc,
                            },
                            ..Default::default()
                        });
                    // PORT NOTE: `catch |err| bun.handleOom(err)` dropped — aborts on OOM.
                }
            }

            // Search further through this file's export stars
            self.add_exports(resolved_exports, target_id, other_source_index);
        }

        // PORT NOTE: Zig `defer this.source_index_stack.shrinkRetainingCapacity(stack_end_pos - 1)`
        // — inlined at scope end (no early returns after the push).
        self.source_index_stack.truncate(stack_end_pos - 1);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CSS "composes:" validation. The body reaches into
// `bun_css::BundlerStyleSheet.{composes,local_scope,local_properties}`.
// ──────────────────────────────────────────────────────────────────────────
mod __css_validation {
    use super::*;
    use crate::bun_css::css_properties::css_modules::Specifier;
    use crate::bun_css::{BundlerStyleSheet, PropertyIdTag};
    use bun_ast::Log;
    use bun_collections::{ArrayHashMap, StringArrayHashMap};

    // Zig: `?*bun.css.BundlerStyleSheet` — keep the column element as a raw
    // `*mut` (matches `BundledAst.css`), so we never launder a `&T` into `&mut T`.
    use crate::bundled_ast::CssCol;

    /// `ArrayHashAdapter` so `LocalScope` (`ArrayHashMap<Box<[u8]>, LocalEntry>`)
    /// can be queried by borrowed `&[u8]` (CSS idents are arena `*const [u8]`).
    struct SliceBoxAdapter;
    impl bun_collections::array_hash_map::ArrayHashAdapter<[u8], Box<[u8]>> for SliceBoxAdapter {
        fn hash(&self, key: &[u8]) -> u32 {
            // Match `LocalScope`'s default `AutoContext` hashing for `Box<[u8]>`
            // (std `Hash` over the byte slice → wyhash truncated to u32).
            use bun_collections::array_hash_map::{ArrayHashContext, AutoContext};
            AutoContext::default().hash(key)
        }
        fn eql(&self, a: &[u8], b: &Box<[u8]>, _i: usize) -> bool {
            a == &**b
        }
    }

    pub(super) fn validate_css_import_composes(
        this: &mut LinkerContext,
        id: usize,
        css_asts: *mut [CssCol],
        import_records_list: *mut [ImportRecordList],
        input_files: *mut [Source],
    ) {
        // `css_asts[id]` checked Some by caller. We only *read* the AST here;
        // `other_css_ast` below may alias the same allocation when a file
        // composes from itself, so bind as shared.
        let css_ast: &BundlerStyleSheet = col_ref!(css_asts)[id].as_deref().unwrap();
        let import_records: &[ImportRecord] = col_ref!(import_records_list)[id].slice();

        // Validate cross-file "composes: ... from" named imports
        for composes in css_ast.composes.values() {
            for compose in composes.composes.slice() {
                let Some(Specifier::ImportRecordIndex(import_record_idx)) = compose.from.as_ref()
                else {
                    continue;
                };
                let record = &import_records[*import_record_idx as usize];
                if !record.source_index.is_valid() {
                    continue;
                }
                // Read-only; may alias `css_ast` if a file composes from
                // itself (both `&`).
                let Some(other_css_ast) =
                    col_ref!(css_asts)[record.source_index.get() as usize].as_deref()
                else {
                    continue;
                };
                for name in compose.names.slice() {
                    let name_v = name.v();
                    if !other_css_ast
                        .local_scope
                        .contains_adapted(name_v, SliceBoxAdapter)
                    {
                        // Split-borrow — see `LinkerContext::log_disjoint`.
                        let _ = this.log_disjoint().add_error_fmt(
                            &col_ref!(input_files)[record.source_index.get() as usize],
                            compose.loc,
                            format_args!(
                                "The name \"{}\" never appears in \"{}\" as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                bstr::BStr::new(name_v),
                                bstr::BStr::new(
                                    &col_ref!(input_files)[record.source_index.get() as usize]
                                        .path
                                        .pretty
                                ),
                            ),
                        );
                    }
                }
            }
        }
        validate_composes_from_properties(this, id as u32, css_ast, import_records_list, css_asts);
    }

    /// CSS modules spec says that the following is undefined behavior:
    ///
    /// ```css
    /// .foo {
    ///     composes: bar;
    ///     color: red;
    /// }
    ///
    /// .bar {
    ///     color: blue;
    /// }
    /// ```
    ///
    /// Specfically, composing two classes that both define the same property is undefined behavior.
    ///
    /// We check this by recording, at parse time, properties that classes use in the `PropertyUsage` struct.
    /// Then here, we compare the properties of the two classes to ensure that there are no conflicts.
    ///
    /// There is one case we skip, which is checking the properties of composing from the global scope (`composes: X from global`).
    ///
    /// The reason we skip this is because it would require tracking _every_ property of _every_ class (not just CSS module local classes).
    /// This sucks because:
    /// 1. It introduces a performance hit even if the user did not use CSS modules
    /// 2. Composing from the global scope is pretty rare
    ///
    /// We should find a way to do this without incurring performance penalties to the common cases.
    fn validate_composes_from_properties(
        this: &mut LinkerContext,
        index: IndexInt,
        root_css_ast: &BundlerStyleSheet,
        import_records_list: *mut [ImportRecordList],
        all_css_asts: *mut [CssCol],
    ) {
        #[derive(Default)]
        struct PropertyInFile {
            source_index: IndexInt,
            range: bun_ast::Range,
        }

        struct Visitor<'a> {
            visited: ArrayHashMap<bun_ast::Ref, ()>,
            properties: StringArrayHashMap<PropertyInFile>,
            all_import_records: *mut [ImportRecordList],
            all_css_asts: *mut [CssCol],
            all_symbols: &'a symbol::Map,
            all_sources: *mut [Source],
            log: &'a mut Log,
        }

        // PORT NOTE: `pub fn deinit` → Drop on `visited` / `properties` handles cleanup.

        impl<'a> Visitor<'a> {
            fn add_property_or_warn(
                &mut self,
                local: bun_ast::Ref,
                property_name: &[u8],
                source_index: IndexInt,
                range: bun_ast::Range,
            ) {
                let entry = self.properties.get_or_put(property_name).expect("oom");

                if !entry.found_existing {
                    *entry.value_ptr = PropertyInFile {
                        source_index,
                        range,
                    };
                    return;
                }

                if entry.value_ptr.source_index == source_index
                    || entry.value_ptr.source_index == Index::INVALID.get()
                {
                    return;
                }

                let local_original_name: &[u8] = self
                    .all_symbols
                    .get_const(local)
                    .unwrap()
                    .original_name
                    .slice();

                let _ = self.log.add_msg(bun_ast::Msg {
                    kind: bun_ast::Kind::Err,
                    data: bun_ast::range_data(
                        Some(&col_ref!(self.all_sources)[source_index as usize]),
                        range,
                        bun_ast::alloc_print(format_args!(
                            "<r>The value of <b>{}<r> in the class <b>{}<r> is undefined.",
                            bstr::BStr::new(property_name),
                            bstr::BStr::new(local_original_name),
                        )),
                    )
                    .clone_line_text(self.log.clone_line_text),
                    notes: Box::<[bun_ast::Data]>::from(
                        &[
                            bun_ast::range_data(
                                Some(
                                    &col_ref!(self.all_sources)
                                        [entry.value_ptr.source_index as usize],
                                ),
                                entry.value_ptr.range,
                                bun_ast::alloc_print(format_args!(
                                    "The first definition of {} is in this style rule:",
                                    bstr::BStr::new(property_name)
                                )),
                            ),
                            bun_ast::Data {
                                text: {
                                    use std::io::Write;
                                    let mut v = Vec::new();
                                    let _ = write!(
                                        &mut v,
                                        "The specification of \"composes\" does not define an order when class declarations from separate files are composed together. \
                                         The value of the {} property for {} may change unpredictably as the code is edited. \
                                         Make sure that all definitions of {} for {} are in a single file.",
                                        bun_core::fmt::quote(property_name),
                                        bun_core::fmt::quote(local_original_name),
                                        bun_core::fmt::quote(property_name),
                                        bun_core::fmt::quote(local_original_name),
                                    );
                                    std::borrow::Cow::Owned(v)
                                },
                                ..Default::default()
                            },
                        ][..],
                    ),
                    ..Default::default()
                });
                // PORT NOTE: nested `catch |err| bun.handleOom(err)` chain dropped — aborts on OOM.

                // Don't warn more than once
                entry.value_ptr.source_index = Index::INVALID.get();
            }

            fn clear_retaining_capacity(&mut self) {
                self.visited.clear_retaining_capacity();
                self.properties.clear_retaining_capacity();
            }

            fn visit(&mut self, idx: IndexInt, ast: &BundlerStyleSheet, r#ref: bun_ast::Ref) {
                if self.visited.contains(&r#ref) {
                    return;
                }
                self.visited.put(r#ref, ()).expect("unreachable");

                // This local name was in a style rule that
                if let Some(composes) = ast.composes.get(&r#ref) {
                    for compose in composes.composes.slice_const() {
                        // is an import
                        if let Some(from) = compose.from.as_ref() {
                            if let Specifier::ImportRecordIndex(import_record_idx) = from {
                                let record = &col_ref!(self.all_import_records)[idx as usize]
                                    .slice()[*import_record_idx as usize];
                                if record.source_index.is_invalid() {
                                    continue;
                                }
                                // Read-only deref — recursion may revisit the
                                // same allocation as `ast`, so bind shared.
                                let Some(other_ast) = col_ref!(self.all_css_asts)
                                    [record.source_index.get() as usize]
                                    .as_deref()
                                else {
                                    continue;
                                };
                                for name in compose.names.slice() {
                                    let name_v = name.v();
                                    let Some(other_name) =
                                        other_ast.local_scope.get_adapted(name_v, SliceBoxAdapter)
                                    else {
                                        continue;
                                    };
                                    let other_name_ref =
                                        other_name.ref_.to_real_ref(record.source_index.get());
                                    self.visit(
                                        record.source_index.get(),
                                        other_ast,
                                        other_name_ref,
                                    );
                                }
                            } else {
                                debug_assert!(matches!(from, Specifier::Global));
                                // Otherwise it is composed from the global scope.
                                //
                                // See comment above for why we are skipping checking this for now.
                            }
                        } else {
                            // inside this file
                            for name in compose.names.slice() {
                                let name_v = name.v();
                                let Some(name_entry) =
                                    ast.local_scope.get_adapted(name_v, SliceBoxAdapter)
                                else {
                                    continue;
                                };
                                self.visit(idx, ast, name_entry.ref_.to_real_ref(idx));
                            }
                        }
                    }
                }

                let Some(property_usage) = ast.local_properties.get(&r#ref) else {
                    return;
                };
                // Warn about cross-file composition with the same CSS properties
                let mut iter = property_usage.bitset.iter_set();
                while let Some(property_tag) = iter.next() {
                    let property_id_tag: PropertyIdTag =
                        // SAFETY: `PropertyBitset` is only ever populated via
                        // `bitset.set(tag as u16 as usize)` where `tag: PropertyIdTag`
                        // (see `bun_css::fill_property_bit_set`), so every set index is a
                        // valid `#[repr(u16)]` discriminant. `PropertyIdTag` lives in
                        // `bun_css` (generated) and exposes no `from_repr`; once it does,
                        // replace this transmute with that accessor.
                        unsafe {
                            core::mem::transmute::<u16, PropertyIdTag>(
                                u16::try_from(property_tag).expect("int cast"),
                            )
                        };
                    debug_assert!(property_id_tag != PropertyIdTag::Custom);
                    debug_assert!(property_id_tag != PropertyIdTag::Unparsed);
                    self.add_property_or_warn(
                        r#ref,
                        property_id_tag.name(),
                        idx,
                        property_usage.range,
                    );
                }

                for property in property_usage.custom_properties.iter() {
                    self.add_property_or_warn(r#ref, property, idx, property_usage.range);
                }
            }
        }

        // PERF(port): was stack-fallback arena (1024 bytes) — profile.
        // SAFETY: parse_graph backref valid for link step. Read-only.
        let input = this.parse_graph().input_files.split_raw();
        let mut visitor = Visitor {
            visited: ArrayHashMap::<bun_ast::Ref, ()>::default(),
            properties: StringArrayHashMap::<PropertyInFile>::default(),
            all_import_records: import_records_list,
            all_css_asts,
            all_symbols: &this.graph.symbols,
            all_sources: input.source,
            // Split-borrow with `&this.graph.symbols` above —
            // `log_disjoint` returns the disjoint `Transpiler.log` backref.
            log: this.log_disjoint(),
        };
        for local in root_css_ast.local_scope.values() {
            visitor.clear_retaining_capacity();
            visitor.visit(index, root_css_ast, local.ref_.to_real_ref(index));
        }
    }
}

// ported from: src/bundler/linker_context/scanImportsAndExports.zig
