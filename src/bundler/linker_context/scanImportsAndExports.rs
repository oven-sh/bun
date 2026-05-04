use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, HashMap, StringArrayHashMap};
use bun_core::{fmt as bun_fmt, perf, FeatureFlags};
use bun_logger as logger;
use bun_logger::Log;
use bun_options_types::ImportRecord;
use bun_str::strings;

use bun_bundler::options::{self, Format, Loader};
use bun_bundler::{
    EntryPoint, ExportData, ImportData, Index, JSMeta, LinkerContext, Part, RefImportData,
    ResolvedExports, Symbol,
};
use bun_css::{BundlerStyleSheet, PropertyIdTag};
use bun_js_parser as js_ast;
use bun_js_parser::{Ast, Dependency, ExportsKind, Ref};

use super::debug; // LinkerContext::debug
type SymbolMap = bun_js_parser::symbol::Map;

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ScanImportsAndExportsError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("import resolution failed")]
    ImportResolutionFailed,
}
impl From<AllocError> for ScanImportsAndExportsError {
    fn from(_: AllocError) -> Self {
        ScanImportsAndExportsError::OutOfMemory
    }
}
impl From<ScanImportsAndExportsError> for bun_core::Error {
    fn from(e: ScanImportsAndExportsError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

pub fn scan_imports_and_exports(
    this: &mut LinkerContext,
) -> Result<(), ScanImportsAndExportsError> {
    let _outer_trace = perf::trace("Bundler.scanImportsAndExports");
    let reachable = this.graph.reachable_files.as_slice();
    let output_format = this.options.output_format;
    {
        let import_records_list: &mut [ImportRecord::List] =
            this.graph.ast.items_mut(.import_records);

        // var parts_list: [][]Part = this.graph.ast.items(.parts);
        let exports_kind: &mut [js_ast::ExportsKind] = this.graph.ast.items_mut(.exports_kind);
        let entry_point_kinds: &mut [EntryPoint::Kind] =
            this.graph.files.items_mut(.entry_point_kind);
        let named_imports: &mut [js_ast::Ast::NamedImports] =
            this.graph.ast.items_mut(.named_imports);
        let flags: &mut [JSMeta::Flags] = this.graph.meta.items_mut(.flags);

        let input_files = this.parse_graph.input_files.items(.source);
        let loaders: &[Loader] = this.parse_graph.input_files.items(.loader);

        let export_star_import_records: &mut [&mut [u32]] =
            this.graph.ast.items_mut(.export_star_import_records);
        let exports_refs: &mut [Ref] = this.graph.ast.items_mut(.exports_ref);
        let module_refs: &mut [Ref] = this.graph.ast.items_mut(.module_ref);
        let ast_flags_list = this.graph.ast.items_mut(.flags);

        let css_asts: &mut [Option<&mut BundlerStyleSheet>] = this.graph.ast.items_mut(.css);
        // TODO(port): the above MultiArrayList .items() accessors will overlap &mut borrows on
        // `this.graph.ast`. Phase B should switch to a single `.slice()` and use the SoA columns.

        let symbols = &mut this.graph.symbols;
        // PORT NOTE: Zig copies symbols back via `defer this.graph.symbols = symbols.*;` —
        // in Rust `symbols` is a &mut into the same storage so no copy-back is needed.

        // Step 1: Figure out what modules must be CommonJS
        for source_index_ in reachable {
            let _trace = perf::trace("Bundler.FigureOutCommonJS");
            let id = source_index_.get();

            // does it have a JS AST?
            if !(id < import_records_list.len()) {
                continue;
            }

            let import_records: &mut [ImportRecord] = import_records_list[id].slice_mut();

            // Is it CSS?
            if css_asts[id].is_some() {
                let css_ast = css_asts[id].as_mut().unwrap();
                // Inline URLs for non-CSS files into the CSS file
                let _ = this.scan_css_imports(
                    id,
                    import_records,
                    css_asts,
                    input_files,
                    loaders,
                    this.log,
                );

                // Validate cross-file "composes: ... from" named imports
                for composes in css_ast.composes.values() {
                    for compose in composes.composes.slice() {
                        if compose.from.is_none()
                            || !matches!(compose.from.as_ref().unwrap(), ComposeFrom::ImportRecordIndex(_))
                        {
                            continue;
                        }
                        let import_record_idx =
                            compose.from.as_ref().unwrap().import_record_index();
                        let record = &import_records[import_record_idx as usize];
                        if !record.source_index.is_valid() {
                            continue;
                        }
                        let Some(other_css_ast) =
                            css_asts[record.source_index.get() as usize].as_ref()
                        else {
                            continue;
                        };
                        for name in compose.names.slice() {
                            if !other_css_ast.local_scope.contains(name.v) {
                                this.log.add_error_fmt(
                                    &input_files[record.source_index.get() as usize],
                                    compose.loc,
                                    format_args!(
                                        "The name \"{}\" never appears in \"{}\" as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                        bstr::BStr::new(name.v),
                                        bstr::BStr::new(
                                            &input_files[record.source_index.get() as usize]
                                                .path
                                                .pretty
                                        ),
                                    ),
                                )?;
                            }
                        }
                    }
                }
                validate_composes_from_properties(
                    this,
                    id,
                    css_ast,
                    import_records_list,
                    css_asts,
                );

                continue;
            }

            for record in import_records.iter() {
                if !record.source_index.is_valid() {
                    continue;
                }

                let other_file = record.source_index.get() as usize;
                let other_flags = ast_flags_list[other_file];
                // other file is empty
                if other_file >= exports_kind.len() {
                    continue;
                }
                let other_kind = exports_kind[other_file];

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
                        if (record.flags.contains_import_star
                            || record.flags.contains_default_alias)
                            && !other_flags.has_lazy_export
                            && !other_flags.force_cjs_to_esm
                            && exports_kind[other_file] == ExportsKind::None
                        {
                            exports_kind[other_file] = ExportsKind::Cjs;
                            flags[other_file].wrap = WrapKind::Cjs;
                        }

                        if record.flags.contains_default_alias && other_flags.force_cjs_to_esm {
                            exports_kind[other_file] = ExportsKind::Cjs;
                            flags[other_file].wrap = WrapKind::Cjs;
                        }
                    }
                    ImportKind::Require =>
                    // Files that are imported with require() must be CommonJS modules
                    {
                        if other_kind == ExportsKind::Esm {
                            flags[other_file].wrap = WrapKind::Esm;
                        } else {
                            // TODO: introduce a NamedRequire for require("./foo").Bar AST nodes to support tree-shaking those.
                            flags[other_file].wrap = WrapKind::Cjs;
                            exports_kind[other_file] = ExportsKind::Cjs;
                        }
                    }
                    ImportKind::Dynamic => {
                        if !this.graph.code_splitting {
                            // If we're not splitting, then import() is just a require() that
                            // returns a promise, so the imported file must be a CommonJS module
                            if exports_kind[other_file] == ExportsKind::Esm {
                                flags[other_file].wrap = WrapKind::Esm;
                            } else {
                                // TODO: introduce a NamedRequire for require("./foo").Bar AST nodes to support tree-shaking those.
                                flags[other_file].wrap = WrapKind::Cjs;
                                exports_kind[other_file] = ExportsKind::Cjs;
                            }
                        }
                    }
                    _ => {}
                }
            }

            let kind = exports_kind[id];

            // If the output format doesn't have an implicit CommonJS wrapper, any file
            // that uses CommonJS features will need to be wrapped, even though the
            // resulting wrapper won't be invoked by other files. An exception is
            // made for entry point files in CommonJS format (or when in pass-through mode).
            if kind == ExportsKind::Cjs
                && (!entry_point_kinds[id].is_entry_point()
                    || output_format == Format::Iife
                    || output_format == Format::Esm)
            {
                flags[id].wrap = WrapKind::Cjs;
            }
        }

        if cfg!(feature = "debug_logs") {
            let mut cjs_count: usize = 0;
            let mut esm_count: usize = 0;
            let mut wrap_cjs_count: usize = 0;
            let mut wrap_esm_count: usize = 0;
            for kind in exports_kind.iter() {
                cjs_count += (*kind == ExportsKind::Cjs) as usize;
                esm_count += (*kind == ExportsKind::Esm) as usize;
            }

            for flag in flags.iter() {
                wrap_cjs_count += (flag.wrap == WrapKind::Cjs) as usize;
                wrap_esm_count += (flag.wrap == WrapKind::Esm) as usize;
            }

            debug!(
                "Step 1: {} CommonJS modules (+ {} wrapped), {} ES modules (+ {} wrapped)",
                cjs_count, wrap_cjs_count, esm_count, wrap_esm_count,
            );
        }

        // Step 2: Propagate dynamic export status for export star statements that
        // are re-exports from a module whose exports are not statically analyzable.
        // In this case the export star must be evaluated at run time instead of at
        // bundle time.

        {
            let _trace = perf::trace("Bundler.WrapDependencies");
            let mut dependency_wrapper = DependencyWrapper {
                linker: this,
                flags,
                import_records: import_records_list,
                exports_kind,
                entry_point_kinds,
                export_star_map: HashMap::<u32, ()>::default(),
                export_star_records: export_star_import_records,
                output_format,
            };
            // PORT NOTE: `defer dependency_wrapper.export_star_map.deinit()` → Drop handles it.

            for source_index_ in reachable {
                let source_index = source_index_.get();
                let id = source_index as usize;

                // does it have a JS AST?
                if !(id < import_records_list.len()) {
                    continue;
                }

                if flags[id].wrap != WrapKind::None {
                    dependency_wrapper.wrap(source_index);
                }

                if export_star_import_records[id].len() > 0 {
                    dependency_wrapper.export_star_map.clear();
                    let _ = dependency_wrapper.has_dynamic_exports_due_to_export_star(source_index);
                }

                // Even if the output file is CommonJS-like, we may still need to wrap
                // CommonJS-style files. Any file that imports a CommonJS-style file will
                // cause that file to need to be wrapped. This is because the import
                // method, whatever it is, will need to invoke the wrapper. Note that
                // this can include entry points (e.g. an entry point that imports a file
                // that imports that entry point).
                for record in import_records_list[id].slice() {
                    if record.source_index.is_valid() {
                        if exports_kind[record.source_index.get() as usize] == ExportsKind::Cjs {
                            dependency_wrapper.wrap(record.source_index.get());
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
            let resolved_exports: &mut [ResolvedExports] =
                this.graph.meta.items_mut(.resolved_exports);
            let resolved_export_stars: &mut [ExportData] =
                this.graph.meta.items_mut(.resolved_export_star);

            for source_index_ in reachable {
                let source_index = source_index_.get();
                let id = source_index as usize;

                // Expression-style loaders defer code generation until linking. Code
                // generation is done here because at this point we know that the
                // "ExportsKind" field has its final value and will not be changed.
                if ast_flags_list[id].has_lazy_export {
                    this.generate_code_for_lazy_export(id)?;
                }

                // Propagate exports for export star statements
                let export_star_ids = &export_star_import_records[id];
                if export_star_ids.len() > 0 {
                    if export_star_ctx.is_none() {
                        export_star_ctx = Some(ExportStarContext {
                            resolved_exports,
                            import_records_list,
                            export_star_records: export_star_import_records,

                            imports_to_bind: this.graph.meta.items_mut(.imports_to_bind),

                            source_index_stack: Vec::with_capacity(32),
                            exports_kind,
                            named_exports: this.graph.ast.items_mut(.named_exports),
                        });
                    }
                    export_star_ctx
                        .as_mut()
                        .unwrap()
                        .add_exports(&mut resolved_exports[id], source_index);
                }

                // Also add a special export so import stars can bind to it. This must be
                // done in this step because it must come after CommonJS module discovery
                // but before matching imports with exports.
                resolved_export_stars[id] = ExportData {
                    data: ImportData::Data {
                        source_index: Index::source(source_index),
                        import_ref: exports_refs[id],
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
            let wrapper_part_indices = this.graph.meta.items_mut(.wrapper_part_index);
            let imports_to_bind = this.graph.meta.items_mut(.imports_to_bind);
            for source_index_ in reachable {
                let source_index = source_index_.get() as usize;

                // not a JS ast or empty
                if source_index >= named_imports.len() {
                    continue;
                }

                let named_imports_ = &mut named_imports[source_index];
                if named_imports_.count() > 0 {
                    this.match_imports_with_exports_for_file(
                        named_imports_,
                        &mut imports_to_bind[source_index],
                        source_index_.get(),
                    );

                    if this.log.errors > 0 {
                        return Err(ScanImportsAndExportsError::ImportResolutionFailed);
                    }
                }
                let export_kind = exports_kind[source_index];
                let mut flag = flags[source_index];
                // If we're exporting as CommonJS and this file was originally CommonJS,
                // then we'll be using the actual CommonJS "exports" and/or "module"
                // symbols. In that case make sure to mark them as such so they don't
                // get minified.
                if (output_format == Format::Cjs)
                    && entry_point_kinds[source_index].is_entry_point()
                    && export_kind == ExportsKind::Cjs
                    && flag.wrap == WrapKind::None
                {
                    let exports_ref = symbols.follow(exports_refs[source_index]);
                    let module_ref = symbols.follow(module_refs[source_index]);
                    symbols.get_mut(exports_ref).unwrap().kind = SymbolKind::Unbound;
                    symbols.get_mut(module_ref).unwrap().kind = SymbolKind::Unbound;
                } else if flag.force_include_exports_for_entry_point
                    || export_kind != ExportsKind::Cjs
                {
                    flag.needs_exports_variable = true;
                    flags[source_index] = flag;
                }

                let wrapped_ref = this.graph.ast.items(.wrapper_ref)[source_index];

                // Create the wrapper part for wrapped files. This is needed by a later step.
                this.create_wrapper_for_file(
                    flag.wrap,
                    // if this one is null, the AST does not need to be wrapped.
                    wrapped_ref,
                    &mut wrapper_part_indices[source_index],
                    source_index_.get(),
                );
            }
        }

        // Step 5: Create namespace exports for every file. This is always necessary
        // for CommonJS files, and is also necessary for other files if they are
        // imported using an import star statement.
        // Note: `do` will wait for all to finish before moving forward
        this.parse_graph.pool.worker_pool.each(
            this,
            LinkerContext::do_step5,
            this.graph.reachable_files.as_slice(),
        )?;

        // Some parts of the AST may now be owned by worker allocators. Transfer ownership back
        // to the graph allocator.
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
        // const needs_export_symbol_from_runtime: []const bool = this.graph.meta.items(.needs_export_symbol_from_runtime);

        let mut runtime_export_symbol_ref: Ref = Ref::NONE;
        let entry_point_kinds: &mut [EntryPoint::Kind] =
            this.graph.files.items_mut(.entry_point_kind);
        let flags: &mut [JSMeta::Flags] = this.graph.meta.items_mut(.flags);
        let mut ast_fields = this.graph.ast.slice();

        let wrapper_refs = ast_fields.items(.wrapper_ref);
        let exports_kind = ast_fields.items(.exports_kind);
        let exports_refs = ast_fields.items(.exports_ref);
        let module_refs = ast_fields.items(.module_ref);
        let named_imports = ast_fields.items(.named_imports);
        let import_records_list = ast_fields.items(.import_records);
        let export_star_import_records = ast_fields.items(.export_star_import_records);
        let ast_flags = ast_fields.items(.flags);
        for source_index_ in reachable {
            let source_index = source_index_.get();
            let id = source_index as usize;

            let is_entry_point = entry_point_kinds[id].is_entry_point();
            let aliases = &this.graph.meta.items(.sorted_and_filtered_export_aliases)[id];
            let flag = flags[id];
            let wrap = flag.wrap;
            let export_kind = exports_kind[id];
            let source: &logger::Source =
                &this.parse_graph.input_files.items(.source)[id];

            let exports_ref = exports_refs[id];

            let module_ref = module_refs[id];

            let string_buffer_len: usize = 'brk: {
                let mut count: usize = 0;
                if is_entry_point && output_format == Format::Esm {
                    for alias in aliases.iter() {
                        count += bun_core::fmt::count(format_args!(
                            "export_{}",
                            bun_fmt::fmt_identifier(alias)
                        ));
                    }
                }

                let ident_fmt_len: usize = if source.identifier_name.len() > 0 {
                    source.identifier_name.len()
                } else {
                    bun_core::fmt::count(format_args!("{}", source.fmt_identifier()))
                };

                if wrap == WrapKind::Esm && wrapper_refs[id].is_valid() {
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

            // TODO(port): bundler is an AST crate; this should allocate from the linker arena.
            let string_buffer = vec![0u8; string_buffer_len].into_boxed_slice();
            let mut builder = bun_str::StringBuilder {
                len: 0,
                cap: string_buffer.len(),
                ptr: string_buffer.as_ptr() as *mut u8,
            };

            let _assert_full = scopeguard::guard((), |_| {
                debug_assert!(builder.len == builder.cap); // ensure we used all of it
            });
            // TODO(port): the scopeguard above borrows `builder`; Phase B may need to inline
            // the assert at scope end instead.

            // Pre-generate symbols for re-exports CommonJS symbols in case they
            // are necessary later. This is done now because the symbols map cannot be
            // mutated later due to parallelism.
            if is_entry_point && output_format == Format::Esm {
                let mut copies = vec![Ref::NONE; aliases.len()].into_boxed_slice();

                debug_assert_eq!(aliases.len(), copies.len());
                for (alias, copy) in aliases.iter().zip(copies.iter_mut()) {
                    let original_name =
                        builder.fmt(format_args!("export_{}", bun_fmt::fmt_identifier(alias)));
                    *copy = this
                        .graph
                        .generate_new_symbol(source_index, SymbolKind::Other, original_name);
                }
                this.graph.meta.items_mut(.cjs_export_copies)[id] = copies;
            }

            // Use "init_*" for ESM wrappers instead of "require_*"
            if wrap == WrapKind::Esm {
                let r#ref = wrapper_refs[id];
                if r#ref.is_valid() {
                    let original_name =
                        builder.fmt(format_args!("init_{}", source.fmt_identifier()));

                    this.graph.symbols.get_mut(r#ref).unwrap().original_name = original_name;
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
                let exports_name =
                    builder.fmt(format_args!("exports_{}", source.fmt_identifier()));
                let module_name =
                    builder.fmt(format_args!("module_{}", source.fmt_identifier()));

                // Note: it's possible for the symbols table to be resized
                // so we cannot call .get() above this scope.
                let exports_symbol: Option<&mut js_ast::Symbol> = if exports_ref.is_valid() {
                    this.graph.symbols.get_mut(exports_ref)
                } else {
                    None
                };
                let module_symbol: Option<&mut js_ast::Symbol> = if module_ref.is_valid() {
                    this.graph.symbols.get_mut(module_ref)
                } else {
                    None
                };
                // PORT NOTE: reshaped for borrowck — two simultaneous &mut into symbols.
                // TODO(port): Phase B may need to split into sequential borrows.

                if let Some(s) = exports_symbol {
                    s.original_name = exports_name;
                }
                if let Some(s) = module_symbol {
                    s.original_name = module_name;
                }
            }

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
                    js_ast::NAMESPACE_EXPORT_PART_INDEX,
                    runtime_export_symbol_ref,
                    1,
                    Index::RUNTIME,
                )?;
            }
            let imports_to_bind_list: &mut [RefImportData] =
                this.graph.meta.items_mut(.imports_to_bind);
            let parts_list: &mut [Part::List] = ast_fields.items_mut(.parts);

            let mut parts: &mut [Part] = parts_list[id].slice_mut();

            let imports_to_bind = &mut imports_to_bind_list[id];
            debug_assert_eq!(imports_to_bind.keys().len(), imports_to_bind.values().len());
            for (ref_untyped, import_untyped) in
                imports_to_bind.keys().iter().zip(imports_to_bind.values())
            {
                let r#ref: Ref = *ref_untyped; // ZLS
                let import: ImportData = import_untyped.clone(); // ZLS

                let import_source_index = import.data.source_index.get();

                if let Some(named_import) = named_imports[id].get(&r#ref) {
                    for part_index in named_import.local_parts_with_uses.slice() {
                        let part: &mut Part = &mut parts[*part_index as usize];
                        let parts_declaring_symbol: &[u32] = this
                            .graph
                            .top_level_symbol_to_parts(import_source_index, import.data.import_ref);

                        let total_len = parts_declaring_symbol.len()
                            + (import.re_exports.len() as usize)
                            + (part.dependencies.len() as usize);
                        if (part.dependencies.cap as usize) < total_len {
                            part.dependencies.ensure_total_capacity(total_len);
                            // PORT NOTE: bun.handleOom dropped — Vec growth aborts on OOM.
                        }

                        // Depend on the file containing the imported symbol
                        for resolved_part_index in parts_declaring_symbol {
                            // PERF(port): was appendAssumeCapacity — profile in Phase B
                            part.dependencies.push(Dependency {
                                source_index: Index::source(import_source_index),
                                part_index: *resolved_part_index,
                            });
                        }

                        // Also depend on any files that re-exported this symbol in between the
                        // file containing the import and the file containing the imported symbol
                        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
                        part.dependencies
                            .extend_from_slice(import.re_exports.slice());
                    }
                }

                let _ = this.graph.symbols.merge(r#ref, import.data.import_ref);
            }

            // If this is an entry point, depend on all exports so they are included
            if is_entry_point {
                let force_include_exports = flag.force_include_exports_for_entry_point;
                let add_wrapper = wrap != WrapKind::None;

                let extra_count =
                    (force_include_exports as usize) + (add_wrapper as usize);

                let mut dependencies: Vec<js_ast::Dependency> =
                    Vec::with_capacity(extra_count);

                let resolved_exports_list: &mut ResolvedExports =
                    &mut this.graph.meta.items_mut(.resolved_exports)[id];
                for alias in aliases.iter() {
                    let exp = resolved_exports_list.get(alias).unwrap();
                    let mut target_source_index = exp.data.source_index;
                    let mut target_ref = exp.data.import_ref;

                    // If this is an import, then target what the import points to
                    if let Some(import_data) =
                        imports_to_bind_list[target_source_index.get() as usize].get(&target_ref)
                    {
                        target_source_index = import_data.data.source_index;
                        target_ref = import_data.data.import_ref;

                        dependencies.extend_from_slice(import_data.re_exports.slice());
                    }

                    // Pull in all declarations of this symbol
                    let top_to_parts =
                        this.top_level_symbols_to_parts(target_source_index.get(), target_ref);
                    dependencies.reserve(top_to_parts.len());
                    for part_index in top_to_parts {
                        // PERF(port): was appendAssumeCapacity — profile in Phase B
                        dependencies.push(Dependency {
                            source_index: target_source_index,
                            part_index: *part_index,
                        });
                    }
                }

                dependencies.reserve(extra_count);

                // Ensure "exports" is included if the current output format needs it
                if force_include_exports {
                    // PERF(port): was appendAssumeCapacity — profile in Phase B
                    dependencies.push(Dependency {
                        source_index: Index::source(source_index),
                        part_index: js_ast::NAMESPACE_EXPORT_PART_INDEX,
                    });
                }

                // Include the wrapper if present
                if add_wrapper {
                    // PERF(port): was appendAssumeCapacity — profile in Phase B
                    dependencies.push(Dependency {
                        source_index: Index::source(source_index),
                        part_index: this.graph.meta.items(.wrapper_part_index)[id].get(),
                    });
                }

                // Represent these constraints with a dummy part
                let entry_point_part_index = this.graph.add_part_to_file(
                    source_index,
                    Part {
                        dependencies: js_ast::Dependency::List::move_from_list(&mut dependencies),
                        can_be_removed_if_unused: false,
                        ..Default::default()
                    },
                );
                // PORT NOTE: `catch |err| bun.handleOom(err)` dropped — aborts on OOM.

                parts = parts_list[id].slice_mut();
                this.graph.meta.items_mut(.entry_point_part_index)[id] =
                    Index::part(entry_point_part_index);

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
            let import_records: &mut [ImportRecord] = import_records_list[id].slice_mut();
            debug!(
                "Binding {} imports for file {} (#{})",
                import_records.len(),
                bstr::BStr::new(&source.path.text),
                id
            );

            for (part_index, part) in parts.iter_mut().enumerate() {
                let mut to_esm_uses: u32 = 0;
                let mut to_common_js_uses: u32 = 0;
                let mut runtime_require_uses: u32 = 0;

                // Imports of wrapped files must depend on the wrapper
                for import_record_index in part.import_record_indices.slice() {
                    let record = &mut import_records[*import_record_index as usize];
                    let kind = record.kind;
                    let other_id = record.source_index.value as usize;

                    // Don't follow external imports (this includes import() expressions)
                    if !record.source_index.is_valid()
                        || this.is_external_dynamic_import(record, source_index)
                    {
                        if output_format == Format::InternalBakeDev {
                            continue;
                        }

                        // This is an external import. Check if it will be a "require()" call.
                        if kind == ImportKind::Require
                            || !output_format.keep_es6_import_export_syntax()
                            || kind == ImportKind::Dynamic
                        {
                            if record.source_index.is_valid()
                                && kind == ImportKind::Dynamic
                                && ast_flags[other_id].force_cjs_to_esm
                            {
                                // If the CommonJS module was converted to ESM
                                // and the developer `import("cjs_module")`, then
                                // they may have code that expects the default export to return the CommonJS module.exports object
                                // That module.exports object does not exist.
                                // We create a default object with getters for each statically-known export
                                // This is kind of similar to what Node.js does
                                // Once we track usages of the dynamic import, we can remove this.
                                if !ast_fields.items(.named_exports)[other_id].contains(b"default")
                                {
                                    flags[other_id].needs_synthetic_default_export = true;
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
                                        || record.flags.contains_import_star
                                        || record.flags.contains_default_alias
                                        || record.flags.contains_es_module_alias)
                                {
                                    // For dynamic imports to cross-chunk CJS modules, we need extra
                                    // unwrapping in js_printer (.then((m)=>__toESM(m.default))).
                                    // For other cases (static imports, truly external), use standard wrapping.
                                    if record.source_index.is_valid()
                                        && this.is_external_dynamic_import(record, source_index)
                                        && exports_kind[record.source_index.get() as usize]
                                            == ExportsKind::Cjs
                                    {
                                        // Cross-chunk dynamic import to CJS - needs special handling in printer
                                        record.flags.wrap_with_to_esm = true;
                                        to_esm_uses += 1;
                                    } else if kind != ImportKind::Dynamic {
                                        // Static imports to external CJS modules need __toESM wrapping
                                        record.flags.wrap_with_to_esm = true;
                                        to_esm_uses += 1;
                                    }
                                    // Dynamic imports to truly external modules: no wrapping (preserve native format)
                                }
                            }
                        }
                        continue;
                    }

                    debug_assert!((other_id as usize) < this.graph.meta.len());
                    let other_flags = flags[other_id];
                    let other_export_kind = exports_kind[other_id];
                    let other_source_index = u32::try_from(other_id).unwrap();

                    if other_flags.wrap != WrapKind::None {
                        // Depend on the automatically-generated require wrapper symbol
                        let wrapper_ref = wrapper_refs[other_id];
                        if wrapper_ref.is_valid() {
                            this.graph.generate_symbol_import_and_use(
                                source_index,
                                u32::try_from(part_index).unwrap(),
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
                            record.flags.wrap_with_to_esm = true;
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
                                u32::try_from(part_index).unwrap(),
                                this.graph.ast.items(.exports_ref)[other_id],
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
                                record.flags.wrap_with_to_commonjs = true;
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
                            u32::try_from(part_index).unwrap(),
                            this.graph.ast.items(.exports_ref)[other_id],
                            1,
                            Index::source(other_source_index),
                        )?;
                    }
                }

                // If there's an ES6 export star statement of a non-ES6 module, then we're
                // going to need the "__reExport" symbol from the runtime
                let mut re_export_uses: u32 = 0;

                for import_record_index in export_star_import_records[id].iter() {
                    let record = &mut import_records[*import_record_index as usize];

                    let mut happens_at_runtime = record.source_index.is_invalid()
                        && (!is_entry_point || !output_format.keep_es6_import_export_syntax());
                    if record.source_index.is_valid() {
                        let other_source_index = record.source_index.get();
                        let other_id = other_source_index as usize;
                        debug_assert!((other_id as usize) < this.graph.meta.len());
                        let other_export_kind = exports_kind[other_id];
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
                                u32::try_from(part_index).unwrap(),
                                this.graph.ast.items(.exports_ref)[other_id],
                                1,
                                Index::source(other_source_index),
                            )?;
                        }
                    }

                    if happens_at_runtime {
                        // Depend on this file's "exports" object for the first argument to "__reExport"
                        this.graph.generate_symbol_import_and_use(
                            source_index,
                            u32::try_from(part_index).unwrap(),
                            this.graph.ast.items(.exports_ref)[id],
                            1,
                            Index::source(source_index),
                        )?;
                        this.graph.ast.items_mut(.flags)[id].uses_exports_ref = true;
                        record.flags.calls_runtime_re_export_fn = true;
                        re_export_uses += 1;
                    }
                }

                if output_format != Format::InternalBakeDev {
                    // If there's an ES6 import of a CommonJS module, then we're going to need the
                    // "__toESM" symbol from the runtime to wrap the result of "require()"
                    this.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(u32::try_from(part_index).unwrap()),
                        b"__toESM",
                        to_esm_uses,
                    )?;

                    // If there's a CommonJS require of an ES6 module, then we're going to need the
                    // "__toCommonJS" symbol from the runtime to wrap the exports object
                    this.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(u32::try_from(part_index).unwrap()),
                        b"__toCommonJS",
                        to_common_js_uses,
                    )?;

                    // If there are unbundled calls to "require()" and we're not generating
                    // code for node, then substitute a "__require" wrapper for "require".
                    this.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(u32::try_from(part_index).unwrap()),
                        b"__require",
                        runtime_require_uses,
                    )?;

                    this.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(u32::try_from(part_index).unwrap()),
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

struct DependencyWrapper<'a> {
    linker: &'a mut LinkerContext,
    flags: &'a mut [JSMeta::Flags],
    exports_kind: &'a mut [js_ast::ExportsKind],
    import_records: &'a mut [ImportRecord::List],
    export_star_map: HashMap<Index::Int, ()>,
    entry_point_kinds: &'a mut [EntryPoint::Kind],
    export_star_records: &'a mut [&'a mut [u32]],
    output_format: options::Format,
}

impl<'a> DependencyWrapper<'a> {
    pub fn has_dynamic_exports_due_to_export_star(&mut self, source_index: Index::Int) -> bool {
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

        let records = self.import_records[source_index as usize].slice();
        for id in self.export_star_records[source_index as usize].iter() {
            let record = &records[*id as usize];

            // This file has dynamic exports if the exported imports are from a file
            // that either has dynamic exports directly or transitively by itself
            // having an export star from a file with dynamic exports.
            let kind = self.entry_point_kinds[source_index as usize];
            if (record.source_index.is_invalid()
                && (!kind.is_entry_point() || !self.output_format.keep_es6_import_export_syntax()))
                || (record.source_index.is_valid()
                    && record.source_index.get() != source_index
                    && self.has_dynamic_exports_due_to_export_star(record.source_index.get()))
            {
                self.exports_kind[source_index as usize] = ExportsKind::EsmWithDynamicFallback;
                return true;
            }
        }

        false
    }

    pub fn wrap(&mut self, source_index: Index::Int) {
        let mut flags = self.flags[source_index as usize];

        if flags.did_wrap_dependencies {
            return;
        }
        flags.did_wrap_dependencies = true;

        // Never wrap the runtime file since it always comes first
        if source_index == Index::RUNTIME.get() {
            return;
        }

        self.flags[source_index as usize] = 'brk: {
            // This module must be wrapped
            if flags.wrap == WrapKind::None {
                flags.wrap = match self.exports_kind[source_index as usize] {
                    ExportsKind::Cjs => WrapKind::Cjs,
                    _ => WrapKind::Esm,
                };
            }
            break 'brk flags;
        };

        let records = self.import_records[source_index as usize].slice();
        // PORT NOTE: reshaped for borrowck — collect indices before recursive &mut self call.
        // TODO(port): Phase B should verify this matches Zig's iteration semantics.
        let to_wrap: Vec<u32> = records
            .iter()
            .filter(|r| r.source_index.is_valid())
            .map(|r| r.source_index.get())
            .collect();
        for idx in to_wrap {
            self.wrap(idx);
        }
    }
}

struct ExportStarContext<'a> {
    import_records_list: &'a [ImportRecord::List],
    source_index_stack: Vec<Index::Int>,
    exports_kind: &'a mut [js_ast::ExportsKind],
    named_exports: &'a mut [js_ast::Ast::NamedExports],
    resolved_exports: &'a mut [ResolvedExports],
    imports_to_bind: &'a mut [RefImportData],
    export_star_records: &'a [&'a [Index::Int]],
    // TODO(port): bundler is an AST crate — verify whether `allocator` here is the linker arena
    // and thread `bump: &'bump Bump` if so (was `allocator: std.mem.Allocator`).
}

impl<'a> ExportStarContext<'a> {
    pub fn add_exports(
        &mut self,
        resolved_exports: &mut ResolvedExports,
        source_index: Index::Int,
    ) {
        // Avoid infinite loops due to cycles in the export star graph
        for i in self.source_index_stack.iter() {
            if *i == source_index {
                return;
            }
        }
        self.source_index_stack.push(source_index);
        let stack_end_pos = self.source_index_stack.len();
        let _restore = scopeguard::guard(&mut self.source_index_stack, move |stack| {
            stack.truncate(stack_end_pos - 1);
        });
        // TODO(port): scopeguard borrows `self.source_index_stack` exclusively; Phase B may
        // need to inline the truncate at fn exit instead.

        let import_records = self.import_records_list[source_index as usize].slice();

        for import_id in self.export_star_records[source_index as usize].iter() {
            let other_source_index = import_records[*import_id as usize].source_index.get();

            let other_id = other_source_index as usize;
            if other_id >= self.named_exports.len() {
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
            if self.exports_kind[other_id] == ExportsKind::Cjs {
                continue;
            }

            let mut iter = self.named_exports[other_id].iter();
            'next_export: while let Some(entry) = iter.next() {
                let alias = *entry.key();
                let name = *entry.value();

                // ES6 export star statements ignore exports named "default"
                if alias == b"default" {
                    continue;
                }

                // This export star is shadowed if any file in the stack has a matching real named export
                for prev in &self.source_index_stack[0..stack_end_pos] {
                    if self.named_exports[*prev as usize].contains(alias) {
                        continue 'next_export;
                    }
                }

                let gop = resolved_exports.get_or_put(alias);
                if !gop.found_existing {
                    // Initialize the re-export
                    *gop.value_ptr = ExportData {
                        data: ImportData::Data {
                            import_ref: name.r#ref,
                            source_index: Index::source(other_source_index),
                            name_loc: name.alias_loc,
                        },
                        ..Default::default()
                    };

                    // Make sure the symbol is marked as imported so that code splitting
                    // imports it correctly if it ends up being shared with another chunk
                    self.imports_to_bind[source_index as usize].put(
                        name.r#ref,
                        ImportData {
                            data: ImportData::Data {
                                import_ref: name.r#ref,
                                source_index: Index::source(other_source_index),
                                ..Default::default()
                            },
                            ..Default::default()
                        },
                    );
                    // PORT NOTE: `catch |err| bun.handleOom(err)` dropped — aborts on OOM.
                } else if gop.value_ptr.data.source_index.get() != other_source_index {
                    // Two different re-exports colliding makes it potentially ambiguous
                    gop.value_ptr
                        .potentially_ambiguous_export_star_refs
                        .push(ImportData {
                            data: ImportData::Data {
                                source_index: Index::source(other_source_index),
                                import_ref: name.r#ref,
                                name_loc: name.alias_loc,
                            },
                            ..Default::default()
                        });
                    // PORT NOTE: `catch |err| bun.handleOom(err)` dropped — aborts on OOM.
                }
            }

            // Search further through this file's export stars
            self.add_exports(resolved_exports, other_source_index);
        }
    }
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
    index: Index::Int,
    root_css_ast: &mut BundlerStyleSheet,
    import_records_list: &mut [ImportRecord::List],
    all_css_asts: &[Option<&mut BundlerStyleSheet>],
) {
    struct PropertyInFile {
        source_index: Index::Int,
        range: logger::Range,
    }

    struct Visitor<'a> {
        visited: ArrayHashMap<Ref, ()>,
        properties: StringArrayHashMap<PropertyInFile>,
        all_import_records: &'a [ImportRecord::List],
        all_css_asts: &'a [Option<&'a mut BundlerStyleSheet>],
        all_symbols: &'a SymbolMap,
        all_sources: &'a [logger::Source],
        // TODO(port): bundler is an AST crate — verify whether `temp_allocator`/`allocator` are
        // arena-backed and thread `bump: &'bump Bump` if so.
        log: &'a mut logger::Log,
    }

    // PORT NOTE: `pub fn deinit` → Drop on `visited` / `properties` handles cleanup; no impl needed.

    impl<'a> Visitor<'a> {
        fn add_property_or_warn(
            &mut self,
            local: Ref,
            property_name: &[u8],
            source_index: Index::Int,
            range: logger::Range,
        ) {
            let entry = self.properties.get_or_put(property_name);

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

            let local_original_name = &self.all_symbols.get(local).unwrap().original_name;

            self.log.add_msg(logger::Msg {
                kind: logger::MsgKind::Err,
                data: logger::range_data(
                    &self.all_sources[source_index as usize],
                    range,
                    Log::alloc_print(format_args!(
                        "<r>The value of <b>{}<r> in the class <b>{}<r> is undefined.",
                        bstr::BStr::new(property_name),
                        bstr::BStr::new(local_original_name),
                    )),
                )
                .clone_line_text(self.log.clone_line_text),
                notes: Box::<[logger::Data]>::from(
                    &[
                        logger::range_data(
                            &self.all_sources[entry.value_ptr.source_index as usize],
                            entry.value_ptr.range,
                            Log::alloc_print(format_args!(
                                "The first definition of {} is in this style rule:",
                                bstr::BStr::new(property_name)
                            )),
                        ),
                        logger::Data {
                            text: {
                                use std::io::Write;
                                let mut v = Vec::new();
                                let _ = write!(
                                    &mut v,
                                    "The specification of \"composes\" does not define an order when class declarations from separate files are composed together. \
                                     The value of the {} property for {} may change unpredictably as the code is edited. \
                                     Make sure that all definitions of {} for {} are in a single file.",
                                    bun_fmt::quote(property_name),
                                    bun_fmt::quote(local_original_name),
                                    bun_fmt::quote(property_name),
                                    bun_fmt::quote(local_original_name),
                                );
                                v.into_boxed_slice()
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
            self.visited.clear();
            self.properties.clear();
        }

        fn visit(&mut self, idx: Index::Int, ast: &BundlerStyleSheet, r#ref: Ref) {
            if self.visited.contains(&r#ref) {
                return;
            }
            self.visited.put(r#ref, ()).expect("unreachable");

            // This local name was in a style rule that
            if let Some(composes) = ast.composes.get_ptr(&r#ref) {
                for compose in composes.composes.slice_const() {
                    // is an import
                    if compose.from.is_some() {
                        if matches!(compose.from.as_ref().unwrap(), ComposeFrom::ImportRecordIndex(_)) {
                            let import_record_idx =
                                compose.from.as_ref().unwrap().import_record_index();
                            let record =
                                self.all_import_records[idx as usize].at(import_record_idx);
                            if record.source_index.is_invalid() {
                                continue;
                            }
                            let Some(other_ast) =
                                self.all_css_asts[record.source_index.get() as usize].as_deref()
                            else {
                                continue;
                            };
                            for name in compose.names.slice() {
                                let Some(other_name) = other_ast.local_scope.get(name.v) else {
                                    continue;
                                };
                                let other_name_ref =
                                    other_name.r#ref.to_real_ref(record.source_index.get());
                                self.visit(record.source_index.get(), other_ast, other_name_ref);
                            }
                        } else {
                            debug_assert!(matches!(
                                compose.from.as_ref().unwrap(),
                                ComposeFrom::Global
                            ));
                            // Otherwise it is composed from the global scope.
                            //
                            // See comment above for why we are skipping checking this for now.
                        }
                    } else {
                        // inside this file
                        for name in compose.names.slice() {
                            let Some(name_entry) = ast.local_scope.get(name.v) else {
                                continue;
                            };
                            self.visit(idx, ast, name_entry.r#ref.to_real_ref(idx));
                        }
                    }
                }
            }

            let Some(property_usage) = ast.local_properties.get_ptr(&r#ref) else {
                return;
            };
            // Warn about cross-file composition with the same CSS properties
            let mut iter = property_usage.bitset.iter();
            while let Some(property_tag) = iter.next() {
                let property_id_tag: PropertyIdTag =
                    // SAFETY: bitset indices are valid PropertyIdTag discriminants by construction
                    unsafe {
                        core::mem::transmute::<u16, PropertyIdTag>(
                            u16::try_from(property_tag).unwrap(),
                        )
                    };
                debug_assert!(property_id_tag != PropertyIdTag::Custom);
                debug_assert!(property_id_tag != PropertyIdTag::Unparsed);
                self.add_property_or_warn(
                    r#ref,
                    <&'static str>::from(property_id_tag).as_bytes(),
                    idx,
                    property_usage.range,
                );
            }

            for property in property_usage.custom_properties.iter() {
                self.add_property_or_warn(r#ref, property, idx, property_usage.range);
            }
        }
    }

    // PERF(port): was stack-fallback allocator (1024 bytes) — profile in Phase B
    let mut visitor = Visitor {
        visited: ArrayHashMap::<Ref, ()>::default(),
        properties: StringArrayHashMap::<PropertyInFile>::default(),
        all_import_records: import_records_list,
        all_css_asts,
        all_symbols: &this.graph.symbols,
        all_sources: this.parse_graph.input_files.items(.source),
        log: this.log,
    };
    for local in root_css_ast.local_scope.values() {
        visitor.clear_retaining_capacity();
        visitor.visit(index, root_css_ast, local.r#ref.to_real_ref(index));
    }
}

// TODO(port): cross-file type aliases — Phase B should resolve these to real paths.
use bun_options_types::ImportKind;
use bun_js_parser::symbol::Kind as SymbolKind;
use bun_js_parser::WrapKind;
use bun_css::ComposeFrom;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/scanImportsAndExports.zig (1261 lines)
//   confidence: medium
//   todos:      9
//   notes:      heavy MultiArrayList .items() overlapping &mut borrows on graph.ast/meta — Phase B must reshape via single .slice(); ExportData/ImportData struct-literal shapes guessed; arena threading deferred
// ──────────────────────────────────────────────────────────────────────────
