use crate::mal_prelude::*;
use bun_ast::Source;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, import_record};
use bun_collections::{HashMap, VecExt};
use bun_core::FeatureFlags;

use crate::bundled_ast;
use crate::options::{self, Format, Loader};
use crate::perf;
use crate::{
    EntryPoint, ExportData, ImportData, ImportTracker, Index, IndexInt, LinkerContext, LinkerGraph,
    Part, WrapKind, js_meta,
};
use bun_ast::symbol::{self, Kind as SymbolKind};
use bun_ast::{Dependency, ExportsKind, Ref};

use crate::linker_context_mod::LinkerCtx;
use crate::linker_graph::{
    SymbolUseColumns, add_part_to_file, is_external_dynamic_import, top_level_symbol_to_parts,
};

type AstFlags = bundled_ast::Flags;
type ImportRecordList<'a> = import_record::List<'a>;

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

pub(crate) fn scan_imports_and_exports(
    this: &mut LinkerContext,
    log: &mut bun_ast::Log,
) -> Result<(), ScanImportsAndExportsError> {
    let _outer_trace = perf::trace("Bundler.scanImportsAndExports");
    let output_format = this.options.output_format;

    // `reachable_files` is borrowed out of `this.graph` while the
    // body also calls `&mut this.graph` methods. Snapshot the indices.
    let reachable: Vec<Index> = this.graph.reachable_files.slice().to_vec();

    let input_files: &[Source] = this.parse_graph().input_files.items_source();
    let loaders: &[Loader] = this.parse_graph().input_files.items_loader();

    {
        let css_asts = &this.parse_graph().css_asts;
        let ast = this.graph.ast.split_mut();
        let meta = this.graph.meta.split_mut();
        let dyn_ref_aliases = meta.dynamic_import_referenced_aliases;
        let entry_point_kinds = this.graph.files.items_entry_point_kind();
        let code_splitting = this.graph.code_splitting;

        // Step 1: Figure out what modules must be CommonJS
        for source_index_ in &reachable {
            let _trace = perf::trace("Bundler.FigureOutCommonJS");
            let id = source_index_.get() as usize;

            // does it have a JS AST?
            if !(id < ast.import_records.len()) {
                continue;
            }

            // Is it CSS?
            if css_asts[id].is_some() {
                // Inline URLs for non-CSS files into the CSS file
                let _ = LinkerContext::scan_css_imports(
                    id as u32,
                    ast.import_records[id].as_slice(),
                    css_asts,
                    input_files,
                    loaders,
                    log,
                );

                // Validate cross-file "composes: ... from" named imports and
                // composes-from property collisions.
                __css_validation::validate_css_import_composes(
                    &this.graph.symbols,
                    log,
                    id,
                    css_asts,
                    ast.import_records,
                    input_files,
                );

                continue;
            }

            // Named static imports contribute exactly their aliases to the
            // importee's observable-export set (see below); `* as ns` and
            // `export * from` make everything observable.
            for (import_ref, ni) in ast.named_imports[id]
                .keys()
                .iter()
                .zip(ast.named_imports[id].values())
            {
                let Some(record) = ast.import_records[id]
                    .as_slice()
                    .get(ni.import_record_index as usize)
                else {
                    continue;
                };
                if record.kind != ImportKind::Stmt || !record.source_index.is_valid() {
                    continue;
                }
                let other = record.source_index.get() as usize;
                if other >= ast.exports_kind.len() {
                    continue;
                }
                // `Object.freeze`, `defineProperty` and `delete` on a held default import need the real `module.exports`.
                if ast.flags[other].contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
                    && !ni.alias_is_star
                    && ni.alias.is_some_and(|alias| alias.slice() == b"default")
                    && this
                        .graph
                        .symbols
                        .get_const(*import_ref)
                        .is_some_and(|symbol| {
                            // `ns.default` can be the module's own `default` export, which only step 3 resolves.
                            symbol.import_item_status != bun_ast::ImportItemStatus::Generated
                                && (ni.is_exported || symbol.import_used_as_value())
                        })
                {
                    ast.exports_kind[other] = ExportsKind::Cjs;
                    meta.flags[other].wrap = WrapKind::Cjs;
                }
                if ast.exports_kind[other] != ExportsKind::Esm {
                    continue;
                }
                // The default import of a lifted CommonJS module is its namespace.
                if ni.alias_is_star
                    || (ast.flags[other].contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
                        && ni.alias.is_some_and(|alias| alias.slice() == b"default"))
                {
                    dyn_ref_aliases[other].merge_all();
                } else if let Some(alias) = ni.alias {
                    dyn_ref_aliases[other].insert(alias.slice());
                }
            }
            for &star in ast.export_star_import_records[id].iter() {
                if let Some(record) = ast.import_records[id].as_slice().get(star as usize)
                    && record.source_index.is_valid()
                {
                    dyn_ref_aliases[record.source_index.get() as usize].merge_all();
                }
            }

            for (import_record_index, record) in
                ast.import_records[id].as_slice().iter().enumerate()
            {
                if !record.source_index.is_valid() {
                    continue;
                }

                let other_file = record.source_index.get() as usize;
                let other_flags = ast.flags[other_file];
                // other file is empty
                if other_file >= ast.exports_kind.len() {
                    continue;
                }
                let other_kind = ast.exports_kind[other_file];

                // Union, per importee, of the export names its importers can
                // observe: named static imports contribute their aliases, a
                // tracked `import()` / `require()` its recorded ones, anything
                // else (`import *`, `export *`, an untracked namespace) all of
                // them. Step 5 narrows a lazily loaded ES module's export object
                // (or its chunk's exports when splitting) to this set. CJS
                // importees synthesize `default` from the filtered list itself,
                // so they always keep everything.
                if other_kind != ExportsKind::Esm {
                    dyn_ref_aliases[other_file].merge_all();
                } else {
                    match record.kind {
                        // Named / bare static imports were accounted for above.
                        ImportKind::Stmt
                            if !record
                                .flags
                                .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR) => {}
                        ImportKind::Dynamic | ImportKind::Require => {
                            match ast.dynamic_import_aliases[id].get(&(import_record_index as u32))
                            {
                                None => dyn_ref_aliases[other_file].merge_all(),
                                // `default` of a lifted CommonJS module is its namespace.
                                Some(dynamic_use)
                                    if record.kind == ImportKind::Dynamic
                                        && other_flags
                                            .contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
                                        && dynamic_use
                                            .aliases
                                            .slice()
                                            .iter()
                                            .any(|alias| alias.slice() == b"default") =>
                                {
                                    dyn_ref_aliases[other_file].merge_all()
                                }
                                Some(dynamic_use) => {
                                    dyn_ref_aliases[other_file]
                                        .merge_partial(dynamic_use.aliases.slice());
                                    // Observed without being named: `await import()`
                                    // resolves through a `then` export, and `require()`
                                    // of an ES module returns its `module.exports`
                                    // export when it has one.
                                    dyn_ref_aliases[other_file].insert(
                                        if record.kind == ImportKind::Require {
                                            b"module.exports"
                                        } else {
                                            b"then"
                                        },
                                    );
                                }
                            }
                        }
                        _ => dyn_ref_aliases[other_file].merge_all(),
                    }
                }

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
                            && ast.exports_kind[other_file] == ExportsKind::None
                        {
                            ast.exports_kind[other_file] = ExportsKind::Cjs;
                            meta.flags[other_file].wrap = WrapKind::Cjs;
                        }

                        // A default import of a lifted CommonJS module binds to its
                        // namespace (`advance_import_tracker`) unless `__esModule`
                        // has to be checked at run time.
                        if record
                            .flags
                            .contains(ImportRecordFlags::CONTAINS_DEFAULT_ALIAS)
                            && other_flags.contains(AstFlags::FORCE_CJS_TO_ESM)
                            && (!other_flags.contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
                                || LinkerContext::lifted_default_import_needs_wrapper(
                                    ast.module_type[id],
                                    &ast.named_exports[other_file],
                                ))
                        {
                            ast.exports_kind[other_file] = ExportsKind::Cjs;
                            meta.flags[other_file].wrap = WrapKind::Cjs;
                        }
                    }
                    ImportKind::Require =>
                    // Files that are imported with require() must be CommonJS modules,
                    // unless a split `require()` loads the file at runtime as its own
                    // chunk (no wrapper, the same as a cross-chunk `import()` below).
                    {
                        if !is_external_dynamic_import(
                            code_splitting,
                            entry_point_kinds,
                            record,
                            id as u32,
                        ) {
                            if other_kind == ExportsKind::Esm {
                                meta.flags[other_file].wrap = WrapKind::Esm;
                            } else {
                                // TODO: introduce a NamedRequire for require("./foo").Bar AST nodes to support tree-shaking those.
                                meta.flags[other_file].wrap = WrapKind::Cjs;
                                ast.exports_kind[other_file] = ExportsKind::Cjs;
                            }
                        }
                    }
                    ImportKind::Dynamic => {
                        if !code_splitting {
                            // If we're not splitting, then import() is just a require() that
                            // returns a promise, so the imported file must be a CommonJS module
                            if ast.exports_kind[other_file] == ExportsKind::Esm {
                                meta.flags[other_file].wrap = WrapKind::Esm;
                            } else {
                                // TODO: introduce a NamedRequire for require("./foo").Bar AST nodes to support tree-shaking those.
                                meta.flags[other_file].wrap = WrapKind::Cjs;
                                ast.exports_kind[other_file] = ExportsKind::Cjs;
                            }
                        } else if other_flags.contains(AstFlags::FORCE_CJS_TO_ESM)
                            && is_external_dynamic_import(
                                code_splitting,
                                entry_point_kinds,
                                record,
                                id as u32,
                            )
                        {
                            let exports = &ast.named_exports[other_file];
                            let user_entry =
                                entry_point_kinds[other_file] == EntryPoint::Kind::UserSpecified;
                            // `__esModule` makes `exports.default` the `default`, as in `bun run`.
                            let default_is_module_exports = !exports.contains(b"default")
                                || (other_flags.contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
                                    && !user_entry
                                    && !exports.contains(b"__esModule"));
                            let default_is_read = user_entry
                                || ast.dynamic_import_aliases[id]
                                    .get(&(import_record_index as u32))
                                    .is_none_or(|dynamic_use| {
                                        dynamic_use
                                            .aliases
                                            .slice()
                                            .iter()
                                            .any(|alias| alias.slice() == b"default")
                                    });
                            if default_is_module_exports && default_is_read {
                                meta.flags[other_file].needs_synthetic_default_export = true;
                            }
                        }
                    }
                    _ => {}
                }
            }

            let kind = ast.exports_kind[id];

            // If the output format doesn't have an implicit CommonJS wrapper, any file
            // that uses CommonJS features will need to be wrapped, even though the
            // resulting wrapper won't be invoked by other files. An exception is
            // made for entry point files in CommonJS format (or when in pass-through mode).
            if kind == ExportsKind::Cjs
                && (!entry_point_kinds[id].is_entry_point()
                    || output_format == Format::Iife
                    || output_format == Format::Esm)
            {
                meta.flags[id].wrap = WrapKind::Cjs;
            }
        }

        // Step 2: Propagate dynamic export status for export star statements that
        // are re-exports from a module whose exports are not statically analyzable.
        // In this case the export star must be evaluated at run time instead of at
        // bundle time.
        {
            let _trace = perf::trace("Bundler.WrapDependencies");
            let mut dependency_wrapper = DependencyWrapper {
                flags: meta.flags,
                import_records: ast.import_records,
                exports_kind: ast.exports_kind,
                entry_point_kinds,
                export_star_map: HashMap::default(),
                export_star_records: ast.export_star_import_records,
                output_format,
                wrap_stack: Vec::new(),
                export_star_stack: Vec::new(),
            };
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
                    let has_dynamic_exports =
                        dependency_wrapper.has_dynamic_exports_due_to_export_star(source_index);

                    // A lifted file's export star was `module.exports = require("./b")`. With no
                    // static exports in "./b", keep the wrapper (see `convert_stmts_for_chunk`).
                    if has_dynamic_exports
                        && dependency_wrapper.exports_kind[id] != ExportsKind::Cjs
                        && ast.flags[id].contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
                    {
                        dependency_wrapper.exports_kind[id] = ExportsKind::Cjs;
                        dependency_wrapper.flags[id].wrap = WrapKind::Cjs;
                        dependency_wrapper.wrap(source_index);
                    }
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
                for record in import_records[id].as_slice() {
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
            for source_index_ in &reachable {
                let source_index = source_index_.get();
                let id = source_index as usize;
                let exports_ref = this.graph.ast.items_exports_ref()[id];
                let has_export_stars =
                    this.graph.ast.items_export_star_import_records()[id].len() > 0;

                // Expression-style loaders defer code generation until linking. Code
                // generation is done here because at this point we know that the
                // "ExportsKind" field has its final value and will not be changed.
                if this.graph.ast.items_flags()[id].contains(AstFlags::HAS_LAZY_EXPORT) {
                    this.generate_code_for_lazy_export(log, id as u32)?;
                }

                // Propagate exports for export star statements
                if has_export_stars {
                    if export_star_ctx.is_none() {
                        export_star_ctx = Some(ExportStarContext {
                            stack: Vec::with_capacity(32),
                            on_stack: bun_collections::AutoBitSet::init_empty(
                                this.graph.ast.items_named_exports().len(),
                            )?,
                        });
                    }
                    export_star_ctx
                        .as_mut()
                        .unwrap()
                        .add_exports(&mut this.graph, source_index);
                }

                // Also add a special export so import stars can bind to it. This must be
                // done in this step because it must come after CommonJS module discovery
                // but before matching imports with exports.
                this.graph.meta.items_resolved_export_star_mut()[id] = ExportData {
                    data: ImportTracker {
                        source_index: Index::source(source_index),
                        import_ref: exports_ref,
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
            let mut cycle_detector: Vec<ImportTracker> = Vec::new();
            let _trace = perf::trace("Bundler.MatchImportsWithExports");
            let mut member_resolutions =
                crate::linker_context_mod::ImportMemberResolutions::default();
            for source_index_ in &reachable {
                let source_index = source_index_.get() as usize;

                // not a JS ast or empty
                if source_index >= this.graph.ast.items_named_imports().len() {
                    continue;
                }

                let export_kind = this.graph.ast.items_exports_kind()[source_index];
                let is_lifted_commonjs = this.graph.ast.items_flags()[source_index]
                    .contains(AstFlags::COMMONJS_LIFTED_TO_ESM);
                let wrapped_ref = this.graph.ast.items_wrapper_ref()[source_index];

                if this.graph.ast.items_named_imports()[source_index].count() > 0 {
                    this.match_imports_with_exports_for_file(
                        log,
                        &mut cycle_detector,
                        source_index_.get(),
                        &mut member_resolutions,
                    );

                    if log.errors > 0 {
                        return Err(ScanImportsAndExportsError::ImportResolutionFailed);
                    }
                }
                let mut flag = this.graph.meta.items_flags()[source_index];
                // If we're exporting as CommonJS and this file was originally CommonJS,
                // then we'll be using the actual CommonJS "exports" and/or "module"
                // symbols. In that case make sure to mark them as such so they don't
                // get minified.
                if (output_format == Format::Cjs)
                    && this.graph.files.items_entry_point_kind()[source_index].is_entry_point()
                    && export_kind == ExportsKind::Cjs
                    && flag.wrap == WrapKind::None
                {
                    let exports_ref = this
                        .graph
                        .symbols
                        .follow(this.graph.ast.items_exports_ref()[source_index]);
                    let module_ref = this
                        .graph
                        .symbols
                        .follow(this.graph.ast.items_module_ref()[source_index]);
                    this.graph.symbols.get_mut(exports_ref).unwrap().kind = SymbolKind::Unbound;
                    this.graph.symbols.get_mut(module_ref).unwrap().kind = SymbolKind::Unbound;
                } else if flag.force_include_exports_for_entry_point
                    || export_kind != ExportsKind::Cjs
                {
                    flag.needs_exports_variable = true;
                    this.graph.meta.items_flags_mut()[source_index] = flag;
                }

                if is_lifted_commonjs && flag.wrap == WrapKind::Cjs {
                    // The wrapper prints `exports.x = ...` again, so it takes `exports`.
                    this.graph.ast.items_flags_mut()[source_index]
                        .insert(AstFlags::USES_EXPORTS_REF);
                } else if is_lifted_commonjs && export_kind != ExportsKind::Cjs {
                    // Step 5 runs in parallel, so the export setters' parameter is made here.
                    let param = this.graph.generate_new_symbol(
                        source_index_.get(),
                        SymbolKind::Other,
                        b"value",
                    );
                    this.graph.meta.items_lifted_setter_param_mut()[source_index] = param;
                }

                // Create the wrapper part for wrapped files. This is needed by a later step.
                this.create_wrapper_for_file(
                    flag.wrap,
                    // if this one is null, the AST does not need to be wrapped.
                    wrapped_ref,
                    source_index_.get(),
                );
            }
        }

        // Step 5: Create namespace exports for every file. This is always necessary
        // for CommonJS files, and is also necessary for other files if they are
        // imported using an import star statement.
        // Note: `do` will wait for all to finish before moving forward
        //
        // `do_step5` only touches distinct SoA rows per `source_index` (the
        // columns are pre-sized and never reallocate during this step).
        // The tasks share one `&LinkerContext`; the callee uses it
        // for reads and writes per-row cells via raw `split_raw()` pointers.
        {
            let ctx: &LinkerContext<'_, '_> = this;
            let worker_pool = this.worker_pool();
            worker_pool.each(
                ctx,
                |ctx: &&LinkerContext<'_, '_>, source_index: Index, i: usize| {
                    // SAFETY: `reachable` names each file once, so each call has its own rows.
                    unsafe { ctx.do_step5(source_index, i) };
                },
                &reachable,
            );
        }

        // No post-fan-out ownership transfer is needed: `do_step5` only grows
        // global-allocator `Vec`s (`part.dependencies`, `declared_symbols`),
        // which are thread-safe to grow per-row, and never pushes to the
        // arena-backed `PartList`/import-record columns.
    }

    if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
        this.check_for_memory_corruption();
    }

    // An `import()` / `require()` of a wrapped ES module whose every read step
    // 4 bound to an export needs no value: nothing depends on the namespace
    // object through it, so tree shaking can drop that object.
    let ast = this.graph.ast.split_mut();
    let meta = this.graph.meta.split_mut();
    for source_index_ in &reachable {
        let id = source_index_.get() as usize;
        let uses = &ast.dynamic_import_aliases[id];
        for (&record_index, dynamic_use) in uses.keys().iter().zip(uses.values()) {
            let record = &ast.import_records[id].as_slice()[record_index as usize];
            if dynamic_use.needs_namespace_object
                || !record.source_index.is_valid()
                || meta.flags[record.source_index.get() as usize].wrap != WrapKind::Esm
                || ast.exports_kind[record.source_index.get() as usize] != ExportsKind::Esm
            {
                continue;
            }
            let bound = &meta.imports_to_bind[id];
            // `ns.a` of a name the importee does not export prints `undefined`.
            // A pattern would read it off `{}`, which has a prototype.
            let satisfied = |item: &bun_ast::ast_result::DynamicImportItem| {
                bound.contains(&item.local)
                    || this
                        .graph
                        .symbols
                        .get_const(item.local)
                        .is_some_and(|symbol| {
                            symbol.import_item_status == bun_ast::ImportItemStatus::Missing
                                && symbol.namespace_alias.is_some()
                        })
            };
            if dynamic_use.items.slice().iter().all(satisfied) {
                ast.import_records[id].as_mut_slice()[record_index as usize]
                    .flags
                    .insert(ImportRecordFlags::NAMESPACE_UNUSED);
            }
        }
    }

    // Step 6: Bind imports to exports. This adds non-local dependencies on the
    // parts that declare the export to all parts that use the import. Also
    // generate wrapper parts for wrapped files.
    {
        let _trace = perf::trace("Bundler.BindImportsToExports");
        // const needs_export_symbol_from_runtime: []const bool = this.graph.meta.items().needs_export_symbol_from_runtime;

        let mut runtime_export_symbol_ref: Ref = Ref::NONE;
        let mut runtime_export_cjs_symbol_ref: Ref = Ref::NONE;
        let mut ident_scratch: Vec<u8> = Vec::new();
        let module_preload = this.module_preload();
        let export_runtime_function = this.export_runtime_function();
        let (arena, code_splitting) = (this.graph.arena(), this.graph.code_splitting);
        this.entry_point_part_indices = vec![u32::MAX; this.graph.ast.len()];

        let ast = this.graph.ast.split_mut();
        let meta = this.graph.meta.split_mut();
        let entry_point_kinds = this.graph.files.items_entry_point_kind();
        let (exports_refs, module_refs) = (&*ast.exports_ref, &*ast.module_ref);
        let mut uses = SymbolUseColumns {
            parts: ast.parts,
            ast_flags: ast.flags,
            exports_ref: exports_refs,
            module_ref: module_refs,
            named_exports: ast.named_exports,
            top_level_symbols_to_parts: ast.top_level_symbols_to_parts,
            top_level_symbol_to_parts_overlay: meta.top_level_symbol_to_parts_overlay,
            imports_to_bind: meta.imports_to_bind,
        };

        for source_index_ in &reachable {
            let source_index = source_index_.get();
            let id = source_index as usize;

            let is_entry_point = entry_point_kinds[id].is_entry_point();
            let aliases = &meta.sorted_and_filtered_export_aliases[id];
            let flag = meta.flags[id];
            let wrap = flag.wrap;
            let export_kind = ast.exports_kind[id];
            let source: &Source = &input_files[id];

            let exports_ref = exports_refs[id];
            let module_ref = module_refs[id];

            // Format the source identifier once into a reusable scratch so the
            // per-file `init_/exports_/module_` writes below are plain memcpys
            // instead of three trips through `core::fmt::write`.
            let ident: &[u8] = if !source.identifier_name.is_empty() {
                &source.identifier_name[..]
            } else {
                ident_scratch.clear();
                core::fmt::Write::write_fmt(
                    &mut bun_core::fmt::VecWriter(&mut ident_scratch),
                    format_args!("{}", source.fmt_identifier()),
                )
                .expect("infallible: VecWriter never errors");
                &ident_scratch[..]
            };

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

                let ident_fmt_len = ident.len();

                if wrap == WrapKind::Esm && ast.wrapper_ref[id].is_valid() {
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
            // reclaimed when the link pass ends.
            // The slices handed out below are stored in `Symbol.original_name: *const [u8]`,
            // which is arena-lifetime by construction.
            let string_buffer: &mut [u8] = arena.alloc_slice_fill_default::<u8>(string_buffer_len);
            // `StringBuilder::drop` reconstructs a `Box<[u8]>` from
            // `ptr`/`cap` and frees it via the global arena. Here the
            // backing buffer is arena-owned (bumpalo), so dropping would hand
            // mimalloc a pointer it never allocated. Wrap in `ManuallyDrop` —
            // the arena reclaims the storage on reset.
            let mut builder = core::mem::ManuallyDrop::new(bun_core::StringBuilder {
                len: 0,
                cap: string_buffer.len(),
                ptr: core::ptr::NonNull::new(string_buffer.as_mut_ptr()),
            });

            // Pre-generate symbols for re-exports CommonJS symbols in case they
            // are necessary later. This is done now because the symbols map cannot be
            // mutated later due to parallelism.
            if is_entry_point && output_format == Format::Esm {
                let mut copies: bun_alloc::AstVec<Ref> =
                    bun_alloc::AstAlloc::vec_with_capacity(aliases.len());
                copies.resize(aliases.len(), Ref::NONE);

                debug_assert_eq!(aliases.len(), copies.len());
                for (alias, copy) in aliases.iter().zip(copies.iter_mut()) {
                    let original_name = builder.fmt(format_args!(
                        "export_{}",
                        bun_core::fmt::fmt_identifier(alias)
                    ));
                    *copy = crate::linker_graph::generate_new_symbol(
                        &mut this.graph.symbols,
                        ast.module_scope,
                        source_index,
                        SymbolKind::Other,
                        original_name,
                    );
                }
                meta.cjs_export_copies[id] = copies;
            }

            // Use "init_*" for ESM wrappers instead of "require_*"
            if wrap == WrapKind::Esm {
                let r#ref = ast.wrapper_ref[id];
                if r#ref.is_valid() {
                    let start = builder.len;
                    builder.append(b"init_");
                    builder.append(ident);
                    let end = builder.len;
                    let original_name = &builder.allocated_slice()[start..end];
                    this.graph.symbols.get_mut(r#ref).unwrap().original_name =
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
                let start = builder.len;
                builder.append(b"exports_");
                builder.append(ident);
                let end = builder.len;
                let exports_name = bun_ast::StoreStr::new(&builder.allocated_slice()[start..end]);
                let start = builder.len;
                builder.append(b"module_");
                builder.append(ident);
                let end = builder.len;
                let module_name = bun_ast::StoreStr::new(&builder.allocated_slice()[start..end]);

                if exports_ref.is_valid() {
                    if let Some(s) = this.graph.symbols.get_mut(exports_ref) {
                        s.original_name = exports_name;
                    }
                }
                if module_ref.is_valid() {
                    if let Some(s) = this.graph.symbols.get_mut(module_ref) {
                        s.original_name = module_name;
                    }
                }
            }

            // End-of-scope assert; relies on there being no
            // early returns inside this block.
            debug_assert!(builder.len == builder.cap);

            // Include the "__export" symbol from the runtime if it was used in the
            // previous step. The previous step can't do this because it's running in
            // parallel and can't safely mutate the "importsToBind" map of another file.
            if flag.needs_export_symbol_from_runtime {
                let export_symbol_ref = if meta.lifted_setter_param[id].is_valid() {
                    if !runtime_export_cjs_symbol_ref.is_valid() {
                        runtime_export_cjs_symbol_ref = uses.runtime_function(b"__exportCjs");
                    }
                    runtime_export_cjs_symbol_ref
                } else {
                    if !runtime_export_symbol_ref.is_valid() {
                        runtime_export_symbol_ref = uses.runtime_function(export_runtime_function);
                    }
                    runtime_export_symbol_ref
                };

                debug_assert!(export_symbol_ref.is_valid());

                uses.generate_symbol_import_and_use(
                    source_index,
                    bun_ast::NAMESPACE_EXPORT_PART_INDEX,
                    export_symbol_ref,
                    1,
                    Index::RUNTIME,
                )?;
            }

            {
                let imports_to_bind = &uses.imports_to_bind[id];
                debug_assert_eq!(imports_to_bind.keys().len(), imports_to_bind.values().len());
                for (&r#ref, import) in imports_to_bind.keys().iter().zip(imports_to_bind.values())
                {
                    let import_source_index = import.data.source_index.get();
                    let import_ref = import.data.import_ref;
                    let re_exports: &[Dependency] = import.re_exports.slice();

                    if let Some(named_import) = ast.named_imports[id].get(&r#ref) {
                        let parts_declaring_symbol = top_level_symbol_to_parts(
                            uses.top_level_symbol_to_parts_overlay,
                            uses.top_level_symbols_to_parts,
                            import_source_index,
                            import_ref,
                        );
                        for &part_index in named_import.local_parts_with_uses.slice() {
                            let part: &mut Part =
                                &mut uses.parts[id].as_mut_slice()[part_index as usize];
                            let total_len = parts_declaring_symbol.len()
                                + re_exports.len()
                                + part.dependencies.len() as usize;
                            part.dependencies.ensure_total_capacity(total_len);

                            // Depend on the file containing the imported symbol
                            for &resolved_part_index in parts_declaring_symbol {
                                part.dependencies.append_assume_capacity(Dependency {
                                    source_index: bun_ast::Index::source(
                                        import_source_index as usize,
                                    ),
                                    part_index: resolved_part_index,
                                });
                            }

                            // Also depend on any files that re-exported this symbol in between the
                            // file containing the import and the file containing the imported symbol
                            part.dependencies.append_slice_assume_capacity(re_exports);
                        }
                    }

                    let _ = this.graph.symbols.merge(r#ref, import_ref);
                }
            }

            // If this is an entry point, depend on all exports so they are included
            if is_entry_point {
                let force_include_exports = flag.force_include_exports_for_entry_point;
                let include_namespace = force_include_exports
                    || LinkerContext::chunk_default_export_is_namespace(flag, uses.ast_flags[id]);
                let add_wrapper = wrap != WrapKind::None;

                let extra_count = (include_namespace as usize) + (add_wrapper as usize);

                let mut dependencies =
                    bun_ast::DependencyList::with_capacity_in(extra_count, bun_alloc::AstAlloc);

                for alias in meta.sorted_and_filtered_export_aliases[id].iter() {
                    let exp = meta.resolved_exports[id].get(alias).unwrap();
                    let mut target_source_index = exp.data.source_index;
                    let mut target_ref = exp.data.import_ref;

                    // If this is an import, then target what the import points to
                    if let Some(import_data) =
                        uses.imports_to_bind[target_source_index.get() as usize].get(&target_ref)
                    {
                        target_source_index = import_data.data.source_index;
                        target_ref = import_data.data.import_ref;

                        for dep in import_data.re_exports.slice() {
                            dependencies.push(*dep);
                        }
                    }

                    // Pull in all declarations of this symbol
                    let top_to_parts = top_level_symbol_to_parts(
                        uses.top_level_symbol_to_parts_overlay,
                        uses.top_level_symbols_to_parts,
                        target_source_index.get(),
                        target_ref,
                    );
                    dependencies.reserve(top_to_parts.len());
                    for part_index in top_to_parts {
                        dependencies.push(Dependency {
                            // `crate::Index` ↔ `bun_ast::Index` are both
                            // `#[repr(transparent)] u32` newtypes;
                            // bridge by `.value` until B-3
                            // collapses them to a single re-export.
                            source_index: bun_ast::Index(target_source_index.get()),
                            part_index: *part_index,
                        });
                    }
                }

                dependencies.reserve(extra_count);

                // Ensure "exports" is included if the current output format needs it
                if include_namespace {
                    dependencies.push(Dependency {
                        source_index: bun_ast::Index::source(source_index as usize),
                        part_index: bun_ast::NAMESPACE_EXPORT_PART_INDEX,
                    });
                }

                // Include the wrapper if present
                if add_wrapper {
                    dependencies.push(Dependency {
                        source_index: bun_ast::Index::source(source_index as usize),
                        part_index: meta.wrapper_part_index[id].get(),
                    });
                }

                // Represent these constraints with a dummy part
                let entry_point_part_index = add_part_to_file(
                    uses.parts,
                    uses.top_level_symbol_to_parts_overlay,
                    uses.top_level_symbols_to_parts,
                    source_index,
                    Part {
                        dependencies,
                        can_be_removed_if_unused: false,
                        ..Default::default()
                    },
                )?;

                // Pull in the "__toCommonJS" symbol if we need it due to being an entry point
                if force_include_exports && output_format != Format::InternalBakeDev {
                    uses.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(entry_point_part_index),
                        b"__toCommonJS",
                        1,
                    )?;
                }

                this.entry_point_part_indices[id] = entry_point_part_index;
            }

            // Encode import-specific constraints in the dependency graph
            bun_core::scoped_log!(
                LinkerCtx,
                "Binding {} imports for file {} (#{})",
                ast.import_records[id].len(),
                bstr::BStr::new(&source.path.text),
                id
            );

            let parts_len = uses.parts[id].len() as usize;
            for part_index in 0..parts_len {
                let mut to_esm_uses: u32 = 0;
                let mut to_common_js_uses: u32 = 0;
                let mut runtime_require_uses: u32 = 0;
                let mut preload_uses: u32 = 0;

                // Imports of wrapped files must depend on the wrapper
                // By index, because the body writes to `uses.parts`.
                let import_record_indices_len = uses.parts[id].as_slice()[part_index]
                    .import_record_indices
                    .len() as usize;
                for iri in 0..import_record_indices_len {
                    let import_record_index = uses.parts[id].as_slice()[part_index]
                        .import_record_indices
                        .slice()[iri];
                    let (kind, rec_source_index, rec_flags) = {
                        let record =
                            &ast.import_records[id].as_slice()[import_record_index as usize];
                        (record.kind, record.source_index, record.flags)
                    };
                    let other_id = rec_source_index.value() as usize;

                    // Don't follow external imports (this includes import() expressions)
                    // Short-circuit: `is_external_dynamic_import` indexes by
                    // `record.source_index`, so it must only run when that index is valid.
                    let is_external_dyn = rec_source_index.is_valid() && {
                        let record =
                            &ast.import_records[id].as_slice()[import_record_index as usize];
                        is_external_dynamic_import(
                            code_splitting,
                            entry_point_kinds,
                            record,
                            source_index,
                        )
                    };
                    if !rec_source_index.is_valid() || is_external_dyn {
                        if output_format == Format::InternalBakeDev {
                            continue;
                        }
                        if module_preload && is_external_dyn && kind == ImportKind::Dynamic {
                            preload_uses += 1;
                        }

                        // This is an external import. Check if it will be a "require()" call.
                        if kind == ImportKind::Require
                            || !output_format.keep_es6_import_export_syntax()
                            || kind == ImportKind::Dynamic
                        {
                            // We should use "__require" instead of "require" if we're not
                            // generating a CommonJS output file, since it won't exist otherwise.
                            // An `import()` is printed as-is and never becomes `__require()`,
                            // nor does a split `require()` (`import.meta.require`).
                            if kind != ImportKind::Dynamic
                                && !is_external_dyn
                                && should_call_runtime_require(output_format)
                            {
                                runtime_require_uses += 1;
                            }

                            // A split `require()` whose target is CommonJS at link
                            // time (for example a lifted `module.exports = require()`
                            // file the linker wrapped again): the chunk exports only
                            // `default: module.exports`, so the printed call reads
                            // `.default` to return `module.exports`, the same value
                            // an unsplit `require()` returns.
                            if kind == ImportKind::Require
                                && is_external_dyn
                                && rec_source_index.is_valid()
                                && ast.exports_kind[rec_source_index.get() as usize]
                                    == ExportsKind::Cjs
                            {
                                ast.import_records[id].as_mut_slice()[import_record_index as usize]
                                    .flags
                                    .insert(ImportRecordFlags::CROSS_CHUNK_REQUIRE_DEFAULT);
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
                                    || rec_flags.contains(ImportRecordFlags::CONTAINS_IMPORT_STAR)
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
                                    && ast.exports_kind[rec_source_index.get() as usize]
                                        == ExportsKind::Cjs
                                {
                                    // Cross-chunk dynamic import to CJS - needs special handling in printer
                                    ast.import_records[id].as_mut_slice()
                                        [import_record_index as usize]
                                        .flags
                                        .insert(ImportRecordFlags::WRAP_WITH_TO_ESM);
                                    to_esm_uses += 1;
                                } else if kind != ImportKind::Dynamic {
                                    // Static imports to external CJS modules need __toESM wrapping
                                    ast.import_records[id].as_mut_slice()
                                        [import_record_index as usize]
                                        .flags
                                        .insert(ImportRecordFlags::WRAP_WITH_TO_ESM);
                                    to_esm_uses += 1;
                                }
                                // Dynamic imports of an ES module chunk or a truly external module: no wrapping
                            }
                        }
                        continue;
                    }

                    debug_assert!(other_id < meta.flags.len());
                    let other_flags = meta.flags[other_id];
                    let other_export_kind = ast.exports_kind[other_id];
                    let other_source_index = other_id as u32;

                    if other_flags.wrap != WrapKind::None {
                        // Depend on the automatically-generated require wrapper symbol
                        let wrapper_ref = ast.wrapper_ref[other_id];
                        if wrapper_ref.is_valid() {
                            uses.generate_symbol_import_and_use(
                                source_index,
                                part_index as u32,
                                wrapper_ref,
                                1,
                                Index::source(other_source_index),
                            )?;
                        }

                        // This is an ES6 import of a CommonJS module, so it needs the
                        // "__toESM" wrapper as long as it's not a bare "require()".
                        // A same-chunk `import()` of a lifted CommonJS module needs it
                        // too, so that `default` is `module.exports` (the namespace).
                        if kind != ImportKind::Require
                            && (other_export_kind == ExportsKind::Cjs
                                || (kind == ImportKind::Dynamic
                                    && other_flags.wrap == WrapKind::Esm
                                    && uses.ast_flags[other_id]
                                        .contains(AstFlags::COMMONJS_LIFTED_TO_ESM)))
                            && output_format != Format::InternalBakeDev
                        {
                            ast.import_records[id].as_mut_slice()[import_record_index as usize]
                                .flags
                                .insert(ImportRecordFlags::WRAP_WITH_TO_ESM);
                            to_esm_uses += 1;
                        }

                        // If this is an ESM wrapper, also depend on the exports object
                        // since the final code will contain an inline reference to it.
                        // This must be done for "require()" and "import()" expressions
                        // but does not need to be done for "import" statements since
                        // those just cause us to reference the exports directly.
                        if other_flags.wrap == WrapKind::Esm
                            && kind != ImportKind::Stmt
                            && !rec_flags.contains(ImportRecordFlags::NAMESPACE_UNUSED)
                        {
                            uses.generate_symbol_import_and_use(
                                source_index,
                                part_index as u32,
                                exports_refs[other_id],
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
                                ast.import_records[id].as_mut_slice()[import_record_index as usize]
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
                        uses.generate_symbol_import_and_use(
                            source_index,
                            part_index as u32,
                            exports_refs[other_id],
                            1,
                            Index::source(other_source_index),
                        )?;
                    }
                }

                // If there's an ES6 export star statement of a non-ES6 module, then we're
                // going to need the "__reExport" symbol from the runtime
                let mut re_export_uses: u32 = 0;

                for &import_record_index in ast.export_star_import_records[id].iter() {
                    let rec_source_index = ast.import_records[id].as_slice()
                        [import_record_index as usize]
                        .source_index;

                    // `convert_stmts_for_chunk` prints a wrapped lifted file's export star as
                    // `module.exports = <value>`: the part needs `module` and that value.
                    if wrap == WrapKind::Cjs
                        && uses.ast_flags[id].contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
                        && !(rec_source_index.is_valid() && rec_source_index.get() == source_index)
                    {
                        if rec_source_index.is_valid() {
                            let other_id = rec_source_index.get() as usize;
                            if ast.exports_kind[other_id] != ExportsKind::Cjs {
                                uses.generate_symbol_import_and_use(
                                    source_index,
                                    part_index as u32,
                                    exports_refs[other_id],
                                    1,
                                    Index::source(rec_source_index.get()),
                                )?;
                            }
                        } else if output_format.keep_es6_import_export_syntax() {
                            ast.import_records[id].as_mut_slice()[import_record_index as usize]
                                .flags
                                .insert(ImportRecordFlags::CONTAINS_IMPORT_STAR);
                        }
                        uses.generate_symbol_import_and_use(
                            source_index,
                            part_index as u32,
                            module_refs[id],
                            1,
                            Index::source(source_index),
                        )?;
                        continue;
                    }

                    let mut happens_at_runtime = rec_source_index.is_invalid()
                        && (!is_entry_point || !output_format.keep_es6_import_export_syntax());
                    if rec_source_index.is_valid() {
                        let other_source_index = rec_source_index.get();
                        let other_id = other_source_index as usize;
                        debug_assert!(other_id < meta.flags.len());
                        let other_export_kind = ast.exports_kind[other_id];
                        if other_source_index != source_index && other_export_kind.is_dynamic() {
                            happens_at_runtime = true;
                        }

                        if other_export_kind.is_esm_with_dynamic_fallback() {
                            // This looks like "__reExport(exports_a, exports_b)". Make sure to
                            // pull in the "exports_b" symbol into this export star. This matters
                            // in code splitting situations where the "export_b" symbol might live
                            // in a different chunk than this export star.
                            uses.generate_symbol_import_and_use(
                                source_index,
                                part_index as u32,
                                exports_refs[other_id],
                                1,
                                Index::source(other_source_index),
                            )?;
                        }
                    }

                    if happens_at_runtime {
                        // Depend on this file's "exports" object for the first argument to "__reExport"
                        uses.generate_symbol_import_and_use(
                            source_index,
                            part_index as u32,
                            exports_refs[id],
                            1,
                            Index::source(source_index),
                        )?;
                        uses.ast_flags[id].insert(AstFlags::USES_EXPORTS_REF);
                        ast.import_records[id].as_mut_slice()[import_record_index as usize]
                            .flags
                            .insert(ImportRecordFlags::CALLS_RUNTIME_RE_EXPORT_FN);
                        re_export_uses += 1;
                    }
                }

                if output_format != Format::InternalBakeDev {
                    // If there's an ES6 import of a CommonJS module, then we're going to need the
                    // "__toESM" symbol from the runtime to wrap the result of "require()"
                    uses.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(part_index as u32),
                        b"__toESM",
                        to_esm_uses,
                    )?;

                    // If there's a CommonJS require of an ES6 module, then we're going to need the
                    // "__toCommonJS" symbol from the runtime to wrap the exports object
                    uses.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(part_index as u32),
                        b"__toCommonJS",
                        to_common_js_uses,
                    )?;

                    // If there are unbundled calls to "require()" and we're not generating
                    // code for node, then substitute a "__require" wrapper for "require".
                    uses.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(part_index as u32),
                        b"__require",
                        runtime_require_uses,
                    )?;

                    uses.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(part_index as u32),
                        b"__reExport",
                        re_export_uses,
                    )?;

                    uses.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(part_index as u32),
                        b"__preload",
                        preload_uses,
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
// DependencyWrapper
// ──────────────────────────────────────────────────────────────────────────
struct DependencyWrapper<'a> {
    flags: &'a mut [js_meta::Flags],
    exports_kind: &'a mut [ExportsKind],
    import_records: &'a [ImportRecordList<'a>],
    export_star_map: HashMap<IndexInt, ()>,
    entry_point_kinds: &'a [EntryPoint::Kind],
    export_star_records: &'a [bun_alloc::AstVec<u32>],
    output_format: options::Format,
    wrap_stack: Vec<IndexInt>,
    export_star_stack: Vec<ExportStarFrame>,
}

/// A file in an `export *` traversal and the index of its next export star record.
struct ExportStarFrame {
    source_index: IndexInt,
    next_record: usize,
}

enum ExportStarEntry {
    /// The file already has dynamic exports.
    Dynamic,
    /// The file was already visited from this root.
    Visited,
    /// The file is on the stack and its export stars need to be followed.
    Pushed,
}

impl DependencyWrapper<'_> {
    /// Marks `source_index` as `EsmWithDynamicFallback` if it transitively
    /// `export *`s from a file whose exports are not statically analyzable
    /// (CommonJS, or an unresolved external `export *`), along with every file
    /// on the `export *` path to that file. Returns true if `source_index` has
    /// dynamic exports.
    fn has_dynamic_exports_due_to_export_star(&mut self, source_index: IndexInt) -> bool {
        debug_assert!(self.export_star_stack.is_empty());
        match self.enter_export_star(source_index) {
            ExportStarEntry::Dynamic => return true,
            ExportStarEntry::Visited => return false,
            ExportStarEntry::Pushed => {}
        }

        while let Some(frame) = self.export_star_stack.last_mut() {
            let source_index = frame.source_index;
            let Some(&id) = self.export_star_records[source_index as usize].get(frame.next_record)
            else {
                self.export_star_stack.pop();
                continue;
            };
            frame.next_record += 1;

            // This file has dynamic exports if the exported imports are from a file
            // that either has dynamic exports directly or transitively by itself
            // having an export star from a file with dynamic exports.
            let kind = self.entry_point_kinds[source_index as usize];
            let rec_source_index =
                self.import_records[source_index as usize].as_slice()[id as usize].source_index;
            let found_dynamic = if rec_source_index.is_invalid() {
                !kind.is_entry_point() || !self.output_format.keep_es6_import_export_syntax()
            } else if rec_source_index.get() != source_index {
                matches!(
                    self.enter_export_star(rec_source_index.get()),
                    ExportStarEntry::Dynamic
                )
            } else {
                false
            };
            if found_dynamic {
                for frame in self.export_star_stack.drain(..) {
                    self.exports_kind[frame.source_index as usize] =
                        ExportsKind::EsmWithDynamicFallback;
                }
                return true;
            }
        }

        false
    }

    fn enter_export_star(&mut self, source_index: IndexInt) -> ExportStarEntry {
        // Terminate the traversal now if this file already has dynamic exports
        match self.exports_kind[source_index as usize] {
            ExportsKind::Cjs | ExportsKind::EsmWithDynamicFallback => {
                return ExportStarEntry::Dynamic;
            }
            _ => {}
        }

        // Avoid infinite loops due to cycles in the export star graph
        let has_visited = self
            .export_star_map
            .get_or_put(source_index)
            .expect("unreachable");
        if has_visited.found_existing {
            return ExportStarEntry::Visited;
        }

        self.export_star_stack.push(ExportStarFrame {
            source_index,
            next_record: 0,
        });
        ExportStarEntry::Pushed
    }

    fn wrap(&mut self, source_index: IndexInt) {
        // Explicit worklist (was per-edge recursive). Only flag bits are
        // written and never re-read to decide later iterations, so
        // processing order is irrelevant.
        debug_assert!(self.wrap_stack.is_empty());
        self.wrap_stack.push(source_index);

        while let Some(source_index) = self.wrap_stack.pop() {
            let flag = &mut self.flags[source_index as usize];

            if flag.did_wrap_dependencies {
                continue;
            }
            flag.did_wrap_dependencies = true;

            // Never wrap the runtime file since it always comes first
            if source_index == Index::RUNTIME.get() {
                continue;
            }

            // This module must be wrapped
            if flag.wrap == WrapKind::None {
                flag.wrap = match self.exports_kind[source_index as usize] {
                    ExportsKind::Cjs => WrapKind::Cjs,
                    _ => WrapKind::Esm,
                };
            }

            for record in self.import_records[source_index as usize].as_slice() {
                if record.source_index.is_valid()
                    && !self.flags[record.source_index.get() as usize].did_wrap_dependencies
                {
                    self.wrap_stack.push(record.source_index.get());
                }
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ExportStarContext
// ──────────────────────────────────────────────────────────────────────────
struct ExportStarContext {
    stack: Vec<ExportStarFrame>,
    /// Has a bit set for each source index on `stack`.
    on_stack: bun_collections::AutoBitSet,
}

impl ExportStarContext {
    /// Merges the re-exports reachable through `source_index`'s `export *`
    /// statements into its `resolved_exports`. `stack` is the
    /// `export *` path from `source_index` to the file being merged.
    fn add_exports(&mut self, graph: &mut LinkerGraph, source_index: IndexInt) {
        let export_star_records = graph.ast.items_export_star_import_records();
        let import_records_list = graph.ast.items_import_records();
        let named_exports = graph.ast.items_named_exports();
        let exports_kind = graph.ast.items_exports_kind();
        let ast_flags = graph.ast.items_flags();
        let meta = graph.meta.split_mut();
        let resolved_exports = &mut meta.resolved_exports[source_index as usize];

        debug_assert!(self.stack.is_empty());
        self.push(source_index);

        while let Some(frame) = self.stack.last_mut() {
            let source_index = frame.source_index;
            let Some(&import_id) =
                export_star_records[source_index as usize].get(frame.next_record)
            else {
                self.stack.pop();
                self.on_stack.unset(source_index as usize);
                continue;
            };
            frame.next_record += 1;

            // A lifted file's export star was `module.exports = ns`, so it re-exports `default` too.
            let reexports_default = self.stack.iter().all(|frame| {
                ast_flags[frame.source_index as usize].contains(AstFlags::COMMONJS_LIFTED_TO_ESM)
            });

            let other_source_index = import_records_list[source_index as usize].as_slice()
                [import_id as usize]
                .source_index
                .get();

            let other_id = other_source_index as usize;
            if other_id >= named_exports.len() {
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
            if exports_kind[other_id] == ExportsKind::Cjs {
                continue;
            }

            let exports = &named_exports[other_id];
            'next_export: for (alias, &name) in exports.keys().iter().zip(exports.values()) {
                // ES6 export star statements ignore exports named "default"
                let alias_slice: &[u8] = alias.as_ref();
                if alias_slice == b"default" && !reexports_default {
                    continue;
                }

                // This export star is shadowed if any file in the stack has a matching real named export
                for prev in self.stack.iter() {
                    if named_exports[prev.source_index as usize].contains(alias_slice) {
                        continue 'next_export;
                    }
                }

                let gop = resolved_exports.get_or_put(alias_slice).expect("oom");
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
                    meta.imports_to_bind[source_index as usize]
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
                }
            }

            // Search further through this file's export stars, unless it's
            // already on the stack (a cycle)
            if !self.on_stack.is_set(other_id) {
                self.push(other_source_index);
            }
        }
    }

    fn push(&mut self, source_index: IndexInt) {
        self.on_stack.set(source_index as usize);
        self.stack.push(ExportStarFrame {
            source_index,
            next_record: 0,
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CSS "composes:" validation. The body reaches into
// `bun_css::BundlerStyleSheet.{composes,local_scope,local_properties}`.
// ──────────────────────────────────────────────────────────────────────────
mod __css_validation {
    use super::*;
    use crate::Graph::CssAsts;
    use crate::bun_css::css_properties::css_modules::Specifier;
    use crate::bun_css::{BundlerStyleSheet, PropertyIdTag};
    use bun_ast::Log;
    use bun_collections::{ArrayHashMap, StringArrayHashMap};
    use strum::VariantArray as _;

    pub(super) fn validate_css_import_composes<'bump>(
        symbols: &symbol::Map,
        log: &mut Log,
        id: usize,
        css_asts: &CssAsts<'bump>,
        import_records_list: &[ImportRecordList<'bump>],
        input_files: &[Source],
    ) {
        // `css_asts[id]` checked Some by caller. We only *read* the AST here;
        // `other_css_ast` below may alias the same allocation when a file
        // composes from itself, so bind as shared.
        let css_ast: &BundlerStyleSheet = css_asts[id].as_deref().unwrap();
        let import_records: &[ImportRecord] = import_records_list[id].as_slice();

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
                let Some(other_css_ast) = css_asts[record.source_index.get() as usize].as_deref()
                else {
                    continue;
                };
                for name in compose.names.slice() {
                    let name_v = name.v;
                    if !other_css_ast.local_scope.contains(name_v) {
                        let _ = log.add_error_fmt(
                            &input_files[record.source_index.get() as usize],
                            compose.loc,
                            format_args!(
                                "The name \"{}\" never appears in \"{}\" as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                bstr::BStr::new(name_v),
                                bstr::BStr::new(
                                    &input_files[record.source_index.get() as usize]
                                        .path
                                        .pretty
                                ),
                            ),
                        );
                    }
                }
            }
        }
        validate_composes_from_properties(
            symbols,
            log,
            id as u32,
            css_ast,
            import_records_list,
            css_asts,
            input_files,
        );
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
    fn validate_composes_from_properties<'bump>(
        all_symbols: &symbol::Map,
        log: &mut Log,
        index: IndexInt,
        root_css_ast: &BundlerStyleSheet,
        all_import_records: &[ImportRecordList<'bump>],
        all_css_asts: &CssAsts<'bump>,
        all_sources: &[Source],
    ) {
        #[derive(Default)]
        struct PropertyInFile {
            source_index: IndexInt,
            range: bun_ast::Range,
        }

        /// A traversal step for the class `Ref` in the CSS file `IndexInt`.
        #[derive(Clone, Copy)]
        enum Frame {
            Enter(IndexInt, bun_ast::Ref),
            Leave(IndexInt, bun_ast::Ref),
        }

        struct Visitor<'a, 'bump> {
            visited: ArrayHashMap<bun_ast::Ref, ()>,
            properties: StringArrayHashMap<PropertyInFile>,
            stack: Vec<Frame>,
            all_import_records: &'a [ImportRecordList<'bump>],
            all_css_asts: &'a CssAsts<'bump>,
            all_symbols: &'a symbol::Map,
            all_sources: &'a [Source<'a>],
            log: &'a mut Log,
        }

        impl<'a, 'bump: 'a> Visitor<'a, 'bump> {
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
                        Some(&self.all_sources[source_index as usize]),
                        range,
                        bun_ast::alloc_print!(
                            "<r>The value of <b>{}<r> in the class <b>{}<r> is undefined.",
                            bstr::BStr::new(property_name),
                            bstr::BStr::new(local_original_name),
                        ),
                    ),
                    notes: Box::<[bun_ast::Data]>::from(
                        &[
                            bun_ast::range_data(
                                Some(
                                    &self.all_sources
                                        [entry.value_ptr.source_index as usize],
                                ),
                                entry.value_ptr.range,
                                bun_ast::alloc_print!(
                                    "The first definition of {} is in this style rule:",
                                    bstr::BStr::new(property_name)
                                ),
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
                // Don't warn more than once
                entry.value_ptr.source_index = Index::INVALID.get();
            }

            fn clear_retaining_capacity(&mut self) {
                self.visited.clear_retaining_capacity();
                self.properties.clear_retaining_capacity();
            }

            /// Frames only reference classes found in a CSS AST, so `idx` always has one.
            fn css_ast(&self, idx: IndexInt) -> &'a BundlerStyleSheet<'bump> {
                self.all_css_asts[idx as usize]
                    .as_deref()
                    .expect("composes walk only reaches files with a CSS AST")
            }

            /// Records the properties of `root` and everything it transitively
            /// composes, and warns when two files set the same property. Visits
            /// in postorder, so a class's properties are recorded after those of
            /// the classes it composes.
            fn visit(&mut self, idx: IndexInt, root: bun_ast::Ref) {
                debug_assert!(self.stack.is_empty());
                self.stack.push(Frame::Enter(idx, root));

                while let Some(frame) = self.stack.pop() {
                    let (idx, r#ref) = match frame {
                        Frame::Leave(idx, r#ref) => {
                            self.record_properties(idx, r#ref);
                            continue;
                        }
                        Frame::Enter(idx, r#ref) => (idx, r#ref),
                    };

                    if self.visited.contains(&r#ref) {
                        continue;
                    }
                    self.visited.put(r#ref, ()).expect("unreachable");

                    let ast = self.css_ast(idx);
                    let mark = self.stack.len();
                    // This local name was in a style rule that
                    if let Some(composes) = ast.composes.get(&r#ref) {
                        for compose in composes.composes.slice_const() {
                            // is an import
                            if let Some(from) = compose.from.as_ref() {
                                if let Specifier::ImportRecordIndex(import_record_idx) = from {
                                    let record = &self.all_import_records[idx as usize].as_slice()
                                        [*import_record_idx as usize];
                                    if record.source_index.is_invalid() {
                                        continue;
                                    }
                                    let other_idx = record.source_index.get();
                                    let Some(other_ast) =
                                        self.all_css_asts[other_idx as usize].as_deref()
                                    else {
                                        continue;
                                    };
                                    for name in compose.names.slice() {
                                        let name_v = name.v;
                                        let Some(other_name) = other_ast.local_scope.get(name_v)
                                        else {
                                            continue;
                                        };
                                        self.stack.push(Frame::Enter(
                                            other_idx,
                                            other_name.ref_.to_real_ref(other_idx),
                                        ));
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
                                    let name_v = name.v;
                                    let Some(name_entry) = ast.local_scope.get(name_v) else {
                                        continue;
                                    };
                                    self.stack
                                        .push(Frame::Enter(idx, name_entry.ref_.to_real_ref(idx)));
                                }
                            }
                        }
                    }
                    self.stack.push(Frame::Leave(idx, r#ref));
                    self.stack[mark..].reverse();
                }
            }

            fn record_properties(&mut self, idx: IndexInt, r#ref: bun_ast::Ref) {
                let ast = self.css_ast(idx);
                let Some(property_usage) = ast.local_properties.get(&r#ref) else {
                    return;
                };
                // Warn about cross-file composition with the same CSS properties
                let mut iter = property_usage.bitset.iter_set();
                while let Some(property_tag) = iter.next() {
                    let property_id_tag = PropertyIdTag::VARIANTS[property_tag];
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

        let mut visitor = Visitor {
            visited: ArrayHashMap::<bun_ast::Ref, ()>::default(),
            properties: StringArrayHashMap::<PropertyInFile>::default(),
            stack: Vec::new(),
            all_import_records,
            all_css_asts,
            all_symbols,
            all_sources,
            log,
        };
        for local in root_css_ast.local_scope.values() {
            visitor.clear_retaining_capacity();
            visitor.visit(index, local.ref_.to_real_ref(index));
        }
    }
}
