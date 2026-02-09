pub const ScanImportsAndExportsError = bun.OOM || error{ImportResolutionFailed};

pub fn scanImportsAndExports(this: *LinkerContext) ScanImportsAndExportsError!void {
    const outer_trace = bun.perf.trace("Bundler.scanImportsAndExports");
    defer outer_trace.end();
    const reachable = this.graph.reachable_files;
    const output_format = this.options.output_format;
    {
        var import_records_list: []ImportRecord.List = this.graph.ast.items(.import_records);

        // var parts_list: [][]Part = this.graph.ast.items(.parts);
        var exports_kind: []js_ast.ExportsKind = this.graph.ast.items(.exports_kind);
        var entry_point_kinds: []EntryPoint.Kind = this.graph.files.items(.entry_point_kind);
        var named_imports: []js_ast.Ast.NamedImports = this.graph.ast.items(.named_imports);
        var flags: []JSMeta.Flags = this.graph.meta.items(.flags);

        const input_files = this.parse_graph.input_files.items(.source);
        const loaders: []const Loader = this.parse_graph.input_files.items(.loader);

        const export_star_import_records: [][]u32 = this.graph.ast.items(.export_star_import_records);
        const exports_refs: []Ref = this.graph.ast.items(.exports_ref);
        const module_refs: []Ref = this.graph.ast.items(.module_ref);
        const ast_flags_list = this.graph.ast.items(.flags);

        const css_asts: []?*bun.css.BundlerStyleSheet = this.graph.ast.items(.css);

        var symbols = &this.graph.symbols;
        defer this.graph.symbols = symbols.*;

        // Step 1: Figure out what modules must be CommonJS
        for (reachable) |source_index_| {
            const trace = bun.perf.trace("Bundler.FigureOutCommonJS");
            defer trace.end();
            const id = source_index_.get();

            // does it have a JS AST?
            if (!(id < import_records_list.len)) continue;

            const import_records: []ImportRecord = import_records_list[id].slice();

            // Is it CSS?
            if (css_asts[id] != null) {
                const css_ast = css_asts[id].?;
                // Inline URLs for non-CSS files into the CSS file
                _ = this.scanCSSImports(
                    id,
                    import_records,
                    css_asts,
                    input_files,
                    loaders,
                    this.log,
                );

                // Validate cross-file "composes: ... from" named imports
                for (css_ast.composes.values()) |*composes| {
                    for (composes.composes.slice()) |*compose| {
                        if (compose.from == null or compose.from.? != .import_record_index) continue;
                        const import_record_idx = compose.from.?.import_record_index;
                        const record = &import_records[import_record_idx];
                        if (!record.source_index.isValid()) continue;
                        const other_css_ast = css_asts[record.source_index.get()] orelse continue;
                        for (compose.names.slice()) |name| {
                            if (!other_css_ast.local_scope.contains(name.v)) {
                                try this.log.addErrorFmt(
                                    &input_files[record.source_index.get()],
                                    compose.loc,
                                    this.allocator(),
                                    "The name \"{s}\" never appears in \"{s}\" as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                    .{
                                        name.v,
                                        input_files[record.source_index.get()].path.pretty,
                                    },
                                );
                            }
                        }
                    }
                }
                validateComposesFromProperties(this, id, css_ast, import_records_list, css_asts);

                continue;
            }

            for (import_records) |record| {
                if (!record.source_index.isValid()) {
                    continue;
                }

                const other_file = record.source_index.get();
                const other_flags = ast_flags_list[other_file];
                // other file is empty
                if (other_file >= exports_kind.len) continue;
                const other_kind = exports_kind[other_file];

                switch (record.kind) {
                    .stmt => {
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
                        if ((record.flags.contains_import_star or record.flags.contains_default_alias) and
                            !other_flags.has_lazy_export and !other_flags.force_cjs_to_esm and
                            exports_kind[other_file] == .none)
                        {
                            exports_kind[other_file] = .cjs;
                            flags[other_file].wrap = .cjs;
                        }

                        if (record.flags.contains_default_alias and
                            other_flags.force_cjs_to_esm)
                        {
                            exports_kind[other_file] = .cjs;
                            flags[other_file].wrap = .cjs;
                        }
                    },
                    .require =>
                    // Files that are imported with require() must be CommonJS modules
                    {
                        if (other_kind == .esm) {
                            flags[other_file].wrap = .esm;
                        } else {
                            // TODO: introduce a NamedRequire for require("./foo").Bar AST nodes to support tree-shaking those.
                            flags[other_file].wrap = .cjs;
                            exports_kind[other_file] = .cjs;
                        }
                    },
                    .dynamic => {
                        if (!this.graph.code_splitting) {
                            // If we're not splitting, then import() is just a require() that
                            // returns a promise, so the imported file must be a CommonJS module
                            if (exports_kind[other_file] == .esm) {
                                flags[other_file].wrap = .esm;
                            } else {
                                // TODO: introduce a NamedRequire for require("./foo").Bar AST nodes to support tree-shaking those.
                                flags[other_file].wrap = .cjs;
                                exports_kind[other_file] = .cjs;
                            }
                        }
                    },
                    else => {},
                }
            }

            const kind = exports_kind[id];

            // If the output format doesn't have an implicit CommonJS wrapper, any file
            // that uses CommonJS features will need to be wrapped, even though the
            // resulting wrapper won't be invoked by other files. An exception is
            // made for entry point files in CommonJS format (or when in pass-through mode).
            if (kind == .cjs and (!entry_point_kinds[id].isEntryPoint() or output_format == .iife or output_format == .esm)) {
                flags[id].wrap = .cjs;
            }
        }

        if (comptime Environment.enable_logs) {
            var cjs_count: usize = 0;
            var esm_count: usize = 0;
            var wrap_cjs_count: usize = 0;
            var wrap_esm_count: usize = 0;
            for (exports_kind) |kind| {
                cjs_count += @intFromBool(kind == .cjs);
                esm_count += @intFromBool(kind == .esm);
            }

            for (flags) |flag| {
                wrap_cjs_count += @intFromBool(flag.wrap == .cjs);
                wrap_esm_count += @intFromBool(flag.wrap == .esm);
            }

            debug("Step 1: {d} CommonJS modules (+ {d} wrapped), {d} ES modules (+ {d} wrapped)", .{
                cjs_count,
                wrap_cjs_count,
                esm_count,
                wrap_esm_count,
            });
        }

        // Step 2: Propagate dynamic export status for export star statements that
        // are re-exports from a module whose exports are not statically analyzable.
        // In this case the export star must be evaluated at run time instead of at
        // bundle time.

        {
            const trace = bun.perf.trace("Bundler.WrapDependencies");
            defer trace.end();
            var dependency_wrapper = DependencyWrapper{
                .linker = this,
                .flags = flags,
                .import_records = import_records_list,
                .exports_kind = exports_kind,
                .entry_point_kinds = entry_point_kinds,
                .export_star_map = std.AutoHashMap(u32, void).init(this.allocator()),
                .export_star_records = export_star_import_records,
                .output_format = output_format,
            };
            defer dependency_wrapper.export_star_map.deinit();

            for (reachable) |source_index_| {
                const source_index = source_index_.get();
                const id = source_index;

                // does it have a JS AST?
                if (!(id < import_records_list.len)) continue;

                if (flags[id].wrap != .none) {
                    dependency_wrapper.wrap(id);
                }

                if (export_star_import_records[id].len > 0) {
                    dependency_wrapper.export_star_map.clearRetainingCapacity();
                    _ = dependency_wrapper.hasDynamicExportsDueToExportStar(id);
                }

                // Even if the output file is CommonJS-like, we may still need to wrap
                // CommonJS-style files. Any file that imports a CommonJS-style file will
                // cause that file to need to be wrapped. This is because the import
                // method, whatever it is, will need to invoke the wrapper. Note that
                // this can include entry points (e.g. an entry point that imports a file
                // that imports that entry point).
                for (import_records_list[id].slice()) |record| {
                    if (record.source_index.isValid()) {
                        if (exports_kind[record.source_index.get()] == .cjs) {
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
            var export_star_ctx: ?ExportStarContext = null;
            const trace = bun.perf.trace("Bundler.ResolveExportStarStatements");
            defer trace.end();
            defer {
                if (export_star_ctx) |*export_ctx| {
                    export_ctx.source_index_stack.deinit();
                }
            }
            var resolved_exports: []ResolvedExports = this.graph.meta.items(.resolved_exports);
            var resolved_export_stars: []ExportData = this.graph.meta.items(.resolved_export_star);

            for (reachable) |source_index_| {
                const source_index = source_index_.get();
                const id = source_index;

                // Expression-style loaders defer code generation until linking. Code
                // generation is done here because at this point we know that the
                // "ExportsKind" field has its final value and will not be changed.
                if (ast_flags_list[id].has_lazy_export) {
                    try this.generateCodeForLazyExport(id);
                }

                // Propagate exports for export star statements
                const export_star_ids = export_star_import_records[id];
                if (export_star_ids.len > 0) {
                    if (export_star_ctx == null) {
                        export_star_ctx = ExportStarContext{
                            .allocator = this.allocator(),
                            .resolved_exports = resolved_exports,
                            .import_records_list = import_records_list,
                            .export_star_records = export_star_import_records,

                            .imports_to_bind = this.graph.meta.items(.imports_to_bind),

                            .source_index_stack = try std.array_list.Managed(u32).initCapacity(this.allocator(), 32),
                            .exports_kind = exports_kind,
                            .named_exports = this.graph.ast.items(.named_exports),
                        };
                    }
                    export_star_ctx.?.addExports(&resolved_exports[id], source_index);
                }

                // Also add a special export so import stars can bind to it. This must be
                // done in this step because it must come after CommonJS module discovery
                // but before matching imports with exports.
                resolved_export_stars[id] = ExportData{
                    .data = .{
                        .source_index = Index.source(source_index),
                        .import_ref = exports_refs[id],
                    },
                };
            }
        }

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        // Step 4: Match imports with exports. This must be done after we process all
        // export stars because imports can bind to export star re-exports.
        {
            this.cycle_detector.clearRetainingCapacity();
            const trace = bun.perf.trace("Bundler.MatchImportsWithExports");
            defer trace.end();
            const wrapper_part_indices = this.graph.meta.items(.wrapper_part_index);
            const imports_to_bind = this.graph.meta.items(.imports_to_bind);
            for (reachable) |source_index_| {
                const source_index = source_index_.get();

                // not a JS ast or empty
                if (source_index >= named_imports.len) {
                    continue;
                }

                const named_imports_ = &named_imports[source_index];
                if (named_imports_.count() > 0) {
                    this.matchImportsWithExportsForFile(
                        named_imports_,
                        &imports_to_bind[source_index],
                        source_index,
                    );

                    if (this.log.errors > 0) {
                        return error.ImportResolutionFailed;
                    }
                }
                const export_kind = exports_kind[source_index];
                var flag = flags[source_index];
                // If we're exporting as CommonJS and this file was originally CommonJS,
                // then we'll be using the actual CommonJS "exports" and/or "module"
                // symbols. In that case make sure to mark them as such so they don't
                // get minified.
                if ((output_format == .cjs) and
                    entry_point_kinds[source_index].isEntryPoint() and
                    export_kind == .cjs and flag.wrap == .none)
                {
                    const exports_ref = symbols.follow(exports_refs[source_index]);
                    const module_ref = symbols.follow(module_refs[source_index]);
                    symbols.get(exports_ref).?.kind = .unbound;
                    symbols.get(module_ref).?.kind = .unbound;
                } else if (flag.force_include_exports_for_entry_point or export_kind != .cjs) {
                    flag.needs_exports_variable = true;
                    flags[source_index] = flag;
                }

                const wrapped_ref = this.graph.ast.items(.wrapper_ref)[source_index];

                // Create the wrapper part for wrapped files. This is needed by a later step.
                this.createWrapperForFile(
                    flag.wrap,
                    // if this one is null, the AST does not need to be wrapped.
                    wrapped_ref,
                    &wrapper_part_indices[source_index],
                    source_index,
                );
            }
        }

        // Step 5: Create namespace exports for every file. This is always necessary
        // for CommonJS files, and is also necessary for other files if they are
        // imported using an import star statement.
        // Note: `do` will wait for all to finish before moving forward
        try this.parse_graph.pool.worker_pool.each(
            this.allocator(),
            this,
            LinkerContext.doStep5,
            this.graph.reachable_files,
        );

        // Some parts of the AST may now be owned by worker allocators. Transfer ownership back
        // to the graph allocator.
        this.graph.takeAstOwnership();
    }

    if (comptime FeatureFlags.help_catch_memory_issues) {
        this.checkForMemoryCorruption();
    }

    // Step 6: Bind imports to exports. This adds non-local dependencies on the
    // parts that declare the export to all parts that use the import. Also
    // generate wrapper parts for wrapped files.
    {
        const trace = bun.perf.trace("Bundler.BindImportsToExports");
        defer trace.end();
        // const needs_export_symbol_from_runtime: []const bool = this.graph.meta.items(.needs_export_symbol_from_runtime);

        var runtime_export_symbol_ref: Ref = Ref.None;
        var entry_point_kinds: []EntryPoint.Kind = this.graph.files.items(.entry_point_kind);
        var flags: []JSMeta.Flags = this.graph.meta.items(.flags);
        var ast_fields = this.graph.ast.slice();

        const wrapper_refs = ast_fields.items(.wrapper_ref);
        const exports_kind = ast_fields.items(.exports_kind);
        const exports_refs = ast_fields.items(.exports_ref);
        const module_refs = ast_fields.items(.module_ref);
        const named_imports = ast_fields.items(.named_imports);
        const import_records_list = ast_fields.items(.import_records);
        const export_star_import_records = ast_fields.items(.export_star_import_records);
        const ast_flags = ast_fields.items(.flags);
        for (reachable) |source_index_| {
            const source_index = source_index_.get();
            const id = source_index;

            const is_entry_point = entry_point_kinds[source_index].isEntryPoint();
            const aliases = this.graph.meta.items(.sorted_and_filtered_export_aliases)[id];
            const flag = flags[id];
            const wrap = flag.wrap;
            const export_kind = exports_kind[id];
            const source: *const Logger.Source = &this.parse_graph.input_files.items(.source)[source_index];

            const exports_ref = exports_refs[id];

            const module_ref = module_refs[id];

            const string_buffer_len: usize = brk: {
                var count: usize = 0;
                if (is_entry_point and output_format == .esm) {
                    for (aliases) |alias| {
                        count += std.fmt.count("export_{f}", .{bun.fmt.fmtIdentifier(alias)});
                    }
                }

                const ident_fmt_len: usize = if (source.identifier_name.len > 0)
                    source.identifier_name.len
                else
                    std.fmt.count("{f}", .{source.fmtIdentifier()});

                if (wrap == .esm and wrapper_refs[id].isValid()) {
                    count += "init_".len + ident_fmt_len;
                }

                if (wrap != .cjs and export_kind != .cjs and output_format != .internal_bake_dev) {
                    count += "exports_".len + ident_fmt_len;
                    count += "module_".len + ident_fmt_len;
                }

                break :brk count;
            };

            const string_buffer = try this.allocator().alloc(u8, string_buffer_len);
            var builder = bun.StringBuilder{
                .len = 0,
                .cap = string_buffer.len,
                .ptr = string_buffer.ptr,
            };

            defer bun.assert(builder.len == builder.cap); // ensure we used all of it

            // Pre-generate symbols for re-exports CommonJS symbols in case they
            // are necessary later. This is done now because the symbols map cannot be
            // mutated later due to parallelism.
            if (is_entry_point and output_format == .esm) {
                const copies = try this.allocator().alloc(Ref, aliases.len);

                for (aliases, copies) |alias, *copy| {
                    const original_name = builder.fmt("export_{f}", .{bun.fmt.fmtIdentifier(alias)});
                    copy.* = this.graph.generateNewSymbol(source_index, .other, original_name);
                }
                this.graph.meta.items(.cjs_export_copies)[id] = copies;
            }

            // Use "init_*" for ESM wrappers instead of "require_*"
            if (wrap == .esm) {
                const ref = wrapper_refs[id];
                if (ref.isValid()) {
                    const original_name = builder.fmt(
                        "init_{f}",
                        .{source.fmtIdentifier()},
                    );

                    this.graph.symbols.get(ref).?.original_name = original_name;
                }
            }

            // If this isn't CommonJS, then rename the unused "exports" and "module"
            // variables to avoid them causing the identically-named variables in
            // actual CommonJS files from being renamed. This is purely about
            // aesthetics and is not about correctness. This is done here because by
            // this point, we know the CommonJS status will not change further.
            if (wrap != .cjs and export_kind != .cjs and output_format != .internal_bake_dev) {
                const exports_name = builder.fmt("exports_{f}", .{source.fmtIdentifier()});
                const module_name = builder.fmt("module_{f}", .{source.fmtIdentifier()});

                // Note: it's possible for the symbols table to be resized
                // so we cannot call .get() above this scope.
                var exports_symbol: ?*js_ast.Symbol = if (exports_ref.isValid())
                    this.graph.symbols.get(exports_ref)
                else
                    null;
                var module_symbol: ?*js_ast.Symbol = if (module_ref.isValid())
                    this.graph.symbols.get(module_ref)
                else
                    null;

                if (exports_symbol != null)
                    exports_symbol.?.original_name = exports_name;
                if (module_symbol != null)
                    module_symbol.?.original_name = module_name;
            }

            // Include the "__export" symbol from the runtime if it was used in the
            // previous step. The previous step can't do this because it's running in
            // parallel and can't safely mutate the "importsToBind" map of another file.
            if (flag.needs_export_symbol_from_runtime) {
                if (!runtime_export_symbol_ref.isValid()) {
                    runtime_export_symbol_ref = this.runtimeFunction("__export");
                }

                bun.assert(runtime_export_symbol_ref.isValid());

                try this.graph.generateSymbolImportAndUse(
                    id,
                    js_ast.namespace_export_part_index,
                    runtime_export_symbol_ref,
                    1,
                    Index.runtime,
                );
            }
            var imports_to_bind_list: []RefImportData = this.graph.meta.items(.imports_to_bind);
            var parts_list: []Part.List = ast_fields.items(.parts);

            var parts: []Part = parts_list[id].slice();

            const imports_to_bind = &imports_to_bind_list[id];
            for (imports_to_bind.keys(), imports_to_bind.values()) |ref_untyped, import_untyped| {
                const ref: Ref = ref_untyped; // ZLS
                const import: ImportData = import_untyped; // ZLS

                const import_source_index = import.data.source_index.get();

                if (named_imports[id].get(ref)) |named_import| {
                    for (named_import.local_parts_with_uses.slice()) |part_index| {
                        var part: *Part = &parts[part_index];
                        const parts_declaring_symbol: []const u32 = this.graph.topLevelSymbolToParts(import_source_index, import.data.import_ref);

                        const total_len = parts_declaring_symbol.len + @as(usize, import.re_exports.len) + @as(usize, part.dependencies.len);
                        if (part.dependencies.cap < total_len) {
                            bun.handleOom(part.dependencies.ensureTotalCapacity(this.allocator(), total_len));
                        }

                        // Depend on the file containing the imported symbol
                        for (parts_declaring_symbol) |resolved_part_index| {
                            part.dependencies.appendAssumeCapacity(.{
                                .source_index = Index.source(import_source_index),
                                .part_index = resolved_part_index,
                            });
                        }

                        // Also depend on any files that re-exported this symbol in between the
                        // file containing the import and the file containing the imported symbol
                        part.dependencies.appendSliceAssumeCapacity(import.re_exports.slice());
                    }
                }

                _ = this.graph.symbols.merge(ref, import.data.import_ref);
            }

            // If this is an entry point, depend on all exports so they are included
            if (is_entry_point) {
                const force_include_exports = flag.force_include_exports_for_entry_point;
                const add_wrapper = wrap != .none;

                const extra_count = @as(usize, @intFromBool(force_include_exports)) +
                    @as(usize, @intFromBool(add_wrapper));

                var dependencies = bun.handleOom(std.array_list.Managed(js_ast.Dependency).initCapacity(this.allocator(), extra_count));

                var resolved_exports_list: *ResolvedExports = &this.graph.meta.items(.resolved_exports)[id];
                for (aliases) |alias| {
                    const exp = resolved_exports_list.get(alias).?;
                    var target_source_index = exp.data.source_index;
                    var target_ref = exp.data.import_ref;

                    // If this is an import, then target what the import points to
                    if (imports_to_bind_list[target_source_index.get()].get(target_ref)) |import_data| {
                        target_source_index = import_data.data.source_index;
                        target_ref = import_data.data.import_ref;

                        bun.handleOom(dependencies.appendSlice(import_data.re_exports.slice()));
                    }

                    // Pull in all declarations of this symbol
                    const top_to_parts = this.topLevelSymbolsToParts(target_source_index.get(), target_ref);
                    bun.handleOom(dependencies.ensureUnusedCapacity(top_to_parts.len));
                    for (top_to_parts) |part_index| {
                        dependencies.appendAssumeCapacity(.{
                            .source_index = target_source_index,
                            .part_index = part_index,
                        });
                    }
                }

                bun.handleOom(dependencies.ensureUnusedCapacity(extra_count));

                // Ensure "exports" is included if the current output format needs it
                if (force_include_exports) {
                    dependencies.appendAssumeCapacity(
                        .{ .source_index = Index.source(source_index), .part_index = js_ast.namespace_export_part_index },
                    );
                }

                // Include the wrapper if present
                if (add_wrapper) {
                    dependencies.appendAssumeCapacity(
                        .{
                            .source_index = Index.source(source_index),
                            .part_index = this.graph.meta.items(.wrapper_part_index)[id].get(),
                        },
                    );
                }

                // Represent these constraints with a dummy part
                const entry_point_part_index = this.graph.addPartToFile(
                    id,
                    .{
                        .dependencies = js_ast.Dependency.List.moveFromList(&dependencies),
                        .can_be_removed_if_unused = false,
                    },
                ) catch |err| bun.handleOom(err);

                parts = parts_list[id].slice();
                this.graph.meta.items(.entry_point_part_index)[id] = Index.part(entry_point_part_index);

                // Pull in the "__toCommonJS" symbol if we need it due to being an entry point
                if (force_include_exports and output_format != .internal_bake_dev) {
                    try this.graph.generateRuntimeSymbolImportAndUse(
                        source_index,
                        Index.part(entry_point_part_index),
                        "__toCommonJS",
                        1,
                    );
                }
            }

            // Encode import-specific constraints in the dependency graph
            const import_records: []ImportRecord = import_records_list[id].slice();
            debug("Binding {d} imports for file {s} (#{d})", .{ import_records.len, source.path.text, id });

            for (parts, 0..) |*part, part_index| {
                var to_esm_uses: u32 = 0;
                var to_common_js_uses: u32 = 0;
                var runtime_require_uses: u32 = 0;

                // Imports of wrapped files must depend on the wrapper
                for (part.import_record_indices.slice()) |import_record_index| {
                    var record = &import_records[import_record_index];
                    const kind = record.kind;
                    const other_id = record.source_index.value;

                    // Don't follow external imports (this includes import() expressions)
                    if (!record.source_index.isValid() or this.isExternalDynamicImport(record, source_index)) {
                        if (output_format == .internal_bake_dev) continue;

                        // This is an external import. Check if it will be a "require()" call.
                        if (kind == .require or !output_format.keepES6ImportExportSyntax() or kind == .dynamic) {
                            if (record.source_index.isValid() and kind == .dynamic and ast_flags[other_id].force_cjs_to_esm) {
                                // If the CommonJS module was converted to ESM
                                // and the developer `import("cjs_module")`, then
                                // they may have code that expects the default export to return the CommonJS module.exports object
                                // That module.exports object does not exist.
                                // We create a default object with getters for each statically-known export
                                // This is kind of similar to what Node.js does
                                // Once we track usages of the dynamic import, we can remove this.
                                if (!ast_fields.items(.named_exports)[other_id].contains("default"))
                                    flags[other_id].needs_synthetic_default_export = true;

                                continue;
                            } else {
                                // We should use "__require" instead of "require" if we're not
                                // generating a CommonJS output file, since it won't exist otherwise.
                                if (shouldCallRuntimeRequire(output_format)) {
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
                                if (kind != .require and
                                    (kind != .stmt or
                                        record.flags.contains_import_star or
                                        record.flags.contains_default_alias or
                                        record.flags.contains_es_module_alias))
                                {
                                    // For dynamic imports to cross-chunk CJS modules, we need extra
                                    // unwrapping in js_printer (.then((m)=>__toESM(m.default))).
                                    // For other cases (static imports, truly external), use standard wrapping.
                                    if (record.source_index.isValid() and
                                        this.isExternalDynamicImport(record, source_index) and
                                        exports_kind[record.source_index.get()] == .cjs)
                                    {
                                        // Cross-chunk dynamic import to CJS - needs special handling in printer
                                        record.flags.wrap_with_to_esm = true;
                                        to_esm_uses += 1;
                                    } else if (kind != .dynamic) {
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

                    bun.assert(@as(usize, @intCast(other_id)) < this.graph.meta.len);
                    const other_flags = flags[other_id];
                    const other_export_kind = exports_kind[other_id];
                    const other_source_index = other_id;

                    if (other_flags.wrap != .none) {
                        // Depend on the automatically-generated require wrapper symbol
                        const wrapper_ref = wrapper_refs[other_id];
                        if (wrapper_ref.isValid()) {
                            try this.graph.generateSymbolImportAndUse(
                                source_index,
                                @as(u32, @intCast(part_index)),
                                wrapper_ref,
                                1,
                                Index.source(other_source_index),
                            );
                        }

                        // This is an ES6 import of a CommonJS module, so it needs the
                        // "__toESM" wrapper as long as it's not a bare "require()"
                        if (kind != .require and other_export_kind == .cjs and output_format != .internal_bake_dev) {
                            record.flags.wrap_with_to_esm = true;
                            to_esm_uses += 1;
                        }

                        // If this is an ESM wrapper, also depend on the exports object
                        // since the final code will contain an inline reference to it.
                        // This must be done for "require()" and "import()" expressions
                        // but does not need to be done for "import" statements since
                        // those just cause us to reference the exports directly.
                        if (other_flags.wrap == .esm and kind != .stmt) {
                            try this.graph.generateSymbolImportAndUse(
                                source_index,
                                @as(u32, @intCast(part_index)),
                                this.graph.ast.items(.exports_ref)[other_id],
                                1,
                                Index.source(other_source_index),
                            );

                            // If this is a "require()" call, then we should add the
                            // "__esModule" marker to behave as if the module was converted
                            // from ESM to CommonJS. This is done via a wrapper instead of
                            // by modifying the exports object itself because the same ES
                            // module may be simultaneously imported and required, and the
                            // importing code should not see "__esModule" while the requiring
                            // code should see "__esModule". This is an extremely complex
                            // and subtle set of transpiler interop issues. See for example
                            // https://github.com/evanw/esbuild/issues/1591.
                            if (kind == .require) {
                                record.flags.wrap_with_to_commonjs = true;
                                to_common_js_uses += 1;
                            }
                        }
                    } else if (kind == .stmt and export_kind == .esm_with_dynamic_fallback) {
                        // This is an import of a module that has a dynamic export fallback
                        // object. In that case we need to depend on that object in case
                        // something ends up needing to use it later. This could potentially
                        // be omitted in some cases with more advanced analysis if this
                        // dynamic export fallback object doesn't end up being needed.
                        try this.graph.generateSymbolImportAndUse(
                            source_index,
                            @as(u32, @intCast(part_index)),
                            this.graph.ast.items(.exports_ref)[other_id],
                            1,
                            Index.source(other_source_index),
                        );
                    }
                }

                // If there's an ES6 export star statement of a non-ES6 module, then we're
                // going to need the "__reExport" symbol from the runtime
                var re_export_uses: u32 = 0;

                for (export_star_import_records[id]) |import_record_index| {
                    var record = &import_records[import_record_index];

                    var happens_at_runtime = record.source_index.isInvalid() and (!is_entry_point or !output_format.keepES6ImportExportSyntax());
                    if (record.source_index.isValid()) {
                        const other_source_index = record.source_index.get();
                        const other_id = other_source_index;
                        bun.assert(@as(usize, @intCast(other_id)) < this.graph.meta.len);
                        const other_export_kind = exports_kind[other_id];
                        if (other_source_index != source_index and other_export_kind.isDynamic()) {
                            happens_at_runtime = true;
                        }

                        if (other_export_kind.isESMWithDynamicFallback()) {
                            // This looks like "__reExport(exports_a, exports_b)". Make sure to
                            // pull in the "exports_b" symbol into this export star. This matters
                            // in code splitting situations where the "export_b" symbol might live
                            // in a different chunk than this export star.
                            try this.graph.generateSymbolImportAndUse(
                                source_index,
                                @as(u32, @intCast(part_index)),
                                this.graph.ast.items(.exports_ref)[other_id],
                                1,
                                Index.source(other_source_index),
                            );
                        }
                    }

                    if (happens_at_runtime) {
                        // Depend on this file's "exports" object for the first argument to "__reExport"
                        try this.graph.generateSymbolImportAndUse(
                            source_index,
                            @as(u32, @intCast(part_index)),
                            this.graph.ast.items(.exports_ref)[id],
                            1,
                            Index.source(source_index),
                        );
                        this.graph.ast.items(.flags)[id].uses_exports_ref = true;
                        record.flags.calls_runtime_re_export_fn = true;
                        re_export_uses += 1;
                    }
                }

                if (output_format != .internal_bake_dev) {
                    // If there's an ES6 import of a CommonJS module, then we're going to need the
                    // "__toESM" symbol from the runtime to wrap the result of "require()"
                    try this.graph.generateRuntimeSymbolImportAndUse(
                        source_index,
                        Index.part(part_index),
                        "__toESM",
                        to_esm_uses,
                    );

                    // If there's a CommonJS require of an ES6 module, then we're going to need the
                    // "__toCommonJS" symbol from the runtime to wrap the exports object
                    try this.graph.generateRuntimeSymbolImportAndUse(
                        source_index,
                        Index.part(part_index),
                        "__toCommonJS",
                        to_common_js_uses,
                    );

                    // If there are unbundled calls to "require()" and we're not generating
                    // code for node, then substitute a "__require" wrapper for "require".
                    try this.graph.generateRuntimeSymbolImportAndUse(
                        source_index,
                        Index.part(part_index),
                        "__require",
                        runtime_require_uses,
                    );

                    try this.graph.generateRuntimeSymbolImportAndUse(
                        source_index,
                        Index.part(part_index),
                        "__reExport",
                        re_export_uses,
                    );
                }
            }
        }
    }
}

inline fn shouldCallRuntimeRequire(format: options.Format) bool {
    return format != .cjs;
}

const DependencyWrapper = struct {
    linker: *LinkerContext,
    flags: []JSMeta.Flags,
    exports_kind: []js_ast.ExportsKind,
    import_records: []ImportRecord.List,
    export_star_map: std.AutoHashMap(Index.Int, void),
    entry_point_kinds: []EntryPoint.Kind,
    export_star_records: [][]u32,
    output_format: options.Format,

    pub fn hasDynamicExportsDueToExportStar(this: *DependencyWrapper, source_index: Index.Int) bool {
        // Terminate the traversal now if this file already has dynamic exports
        const export_kind = this.exports_kind[source_index];
        switch (export_kind) {
            .cjs, .esm_with_dynamic_fallback => return true,
            else => {},
        }

        // Avoid infinite loops due to cycles in the export star graph
        const has_visited = this.export_star_map.getOrPut(source_index) catch unreachable;
        if (has_visited.found_existing) {
            return false;
        }

        const records = this.import_records[source_index].slice();
        for (this.export_star_records[source_index]) |id| {
            const record = records[id];

            // This file has dynamic exports if the exported imports are from a file
            // that either has dynamic exports directly or transitively by itself
            // having an export star from a file with dynamic exports.
            const kind = this.entry_point_kinds[source_index];
            if ((record.source_index.isInvalid() and (!kind.isEntryPoint() or !this.output_format.keepES6ImportExportSyntax())) or
                (record.source_index.isValid() and record.source_index.get() != source_index and this.hasDynamicExportsDueToExportStar(record.source_index.get())))
            {
                this.exports_kind[source_index] = .esm_with_dynamic_fallback;
                return true;
            }
        }

        return false;
    }

    pub fn wrap(this: *DependencyWrapper, source_index: Index.Int) void {
        var flags = this.flags[source_index];

        if (flags.did_wrap_dependencies) return;
        flags.did_wrap_dependencies = true;

        // Never wrap the runtime file since it always comes first
        if (source_index == Index.runtime.get()) {
            return;
        }

        this.flags[source_index] = brk: {

            // This module must be wrapped
            if (flags.wrap == .none) {
                flags.wrap = switch (this.exports_kind[source_index]) {
                    .cjs => .cjs,
                    else => .esm,
                };
            }
            break :brk flags;
        };

        const records = this.import_records[source_index].slice();
        for (records) |record| {
            if (!record.source_index.isValid()) {
                continue;
            }
            this.wrap(record.source_index.get());
        }
    }
};

const ExportStarContext = struct {
    import_records_list: []const ImportRecord.List,
    source_index_stack: std.array_list.Managed(Index.Int),
    exports_kind: []js_ast.ExportsKind,
    named_exports: []js_ast.Ast.NamedExports,
    resolved_exports: []ResolvedExports,
    imports_to_bind: []RefImportData,
    export_star_records: []const []const Index.Int,
    allocator: std.mem.Allocator,

    pub fn addExports(
        this: *ExportStarContext,
        resolved_exports: *ResolvedExports,
        source_index: Index.Int,
    ) void {
        // Avoid infinite loops due to cycles in the export star graph
        for (this.source_index_stack.items) |i| {
            if (i == source_index)
                return;
        }
        bun.handleOom(this.source_index_stack.append(source_index));
        const stack_end_pos = this.source_index_stack.items.len;
        defer this.source_index_stack.shrinkRetainingCapacity(stack_end_pos - 1);

        const import_records = this.import_records_list[source_index].slice();

        for (this.export_star_records[source_index]) |import_id| {
            const other_source_index = import_records[import_id].source_index.get();

            const other_id = other_source_index;
            if (other_id >= this.named_exports.len)
                // this AST was empty or it wasn't a JS AST
                continue;

            // Export stars from a CommonJS module don't work because they can't be
            // statically discovered. Just silently ignore them in this case.
            //
            // We could attempt to check whether the imported file still has ES6
            // exports even though it still uses CommonJS features. However, when
            // doing this we'd also have to rewrite any imports of these export star
            // re-exports as property accesses off of a generated require() call.
            if (this.exports_kind[other_id] == .cjs)
                continue;

            var iter = this.named_exports[other_id].iterator();
            next_export: while (iter.next()) |entry| {
                const alias = entry.key_ptr.*;
                const name = entry.value_ptr.*;

                // ES6 export star statements ignore exports named "default"
                if (strings.eqlComptime(alias, "default"))
                    continue;

                // This export star is shadowed if any file in the stack has a matching real named export
                for (this.source_index_stack.items[0..stack_end_pos]) |prev| {
                    if (this.named_exports[prev].contains(alias)) {
                        continue :next_export;
                    }
                }

                const gop = bun.handleOom(resolved_exports.getOrPut(this.allocator, alias));
                if (!gop.found_existing) {
                    // Initialize the re-export
                    gop.value_ptr.* = .{
                        .data = .{
                            .import_ref = name.ref,
                            .source_index = Index.source(other_source_index),
                            .name_loc = name.alias_loc,
                        },
                    };

                    // Make sure the symbol is marked as imported so that code splitting
                    // imports it correctly if it ends up being shared with another chunk
                    this.imports_to_bind[source_index].put(this.allocator, name.ref, .{
                        .data = .{
                            .import_ref = name.ref,
                            .source_index = Index.source(other_source_index),
                        },
                    }) catch |err| bun.handleOom(err);
                } else if (gop.value_ptr.data.source_index.get() != other_source_index) {
                    // Two different re-exports colliding makes it potentially ambiguous
                    gop.value_ptr.potentially_ambiguous_export_star_refs.append(this.allocator, .{
                        .data = .{
                            .source_index = Index.source(other_source_index),
                            .import_ref = name.ref,
                            .name_loc = name.alias_loc,
                        },
                    }) catch |err| bun.handleOom(err);
                }
            }

            // Search further through this file's export stars
            this.addExports(resolved_exports, other_source_index);
        }
    }
};

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
fn validateComposesFromProperties(
    this: *LinkerContext,
    index: Index.Int,
    root_css_ast: *bun.css.BundlerStyleSheet,
    import_records_list: []ImportRecord.List,
    all_css_asts: []const ?*bun.css.BundlerStyleSheet,
) void {
    const PropertyInFile = struct {
        source_index: Index.Int,
        range: bun.logger.Range,
    };
    const Visitor = struct {
        visited: std.AutoArrayHashMap(Ref, void),
        properties: bun.StringArrayHashMap(PropertyInFile),
        all_import_records: []const ImportRecord.List,
        all_css_asts: []const ?*bun.css.BundlerStyleSheet,
        all_symbols: *const Symbol.Map,
        all_sources: []const Logger.Source,
        temp_allocator: std.mem.Allocator,
        allocator: std.mem.Allocator,
        log: *Logger.Log,

        pub fn deinit(v: *@This()) void {
            v.visited.deinit();
            v.properties.deinit();
        }

        fn addPropertyOrWarn(v: *@This(), local: Ref, property_name: []const u8, source_index: Index.Int, range: bun.logger.Range) void {
            const entry = bun.handleOom(v.properties.getOrPut(property_name));

            if (!entry.found_existing) {
                entry.value_ptr.* = .{
                    .source_index = source_index,
                    .range = range,
                };
                return;
            }

            if (entry.value_ptr.source_index == source_index or entry.value_ptr.source_index == Index.invalid.get()) {
                return;
            }

            const local_original_name = v.all_symbols.get(local).?.original_name;

            v.log.addMsg(.{
                .kind = .err,
                .data = Logger.rangeData(
                    &v.all_sources[source_index],
                    range,
                    Logger.Log.allocPrint(
                        v.allocator,
                        "<r>The value of <b>{s}<r> in the class <b>{s}<r> is undefined.",
                        .{ property_name, local_original_name },
                    ) catch |err| bun.handleOom(err),
                ).cloneLineText(v.log.clone_line_text, v.log.msgs.allocator) catch |err| bun.handleOom(err),
                .notes = v.allocator.dupe(
                    Logger.Data,
                    &.{
                        bun.logger.rangeData(
                            &v.all_sources[entry.value_ptr.source_index],
                            entry.value_ptr.range,
                            bun.handleOom(Logger.Log.allocPrint(v.allocator, "The first definition of {s} is in this style rule:", .{property_name})),
                        ),
                        .{ .text = std.fmt.allocPrint(
                            v.allocator,
                            "The specification of \"composes\" does not define an order when class declarations from separate files are composed together. " ++
                                "The value of the {f} property for {f} may change unpredictably as the code is edited. " ++
                                "Make sure that all definitions of {f} for {f} are in a single file.",
                            .{ bun.fmt.quote(property_name), bun.fmt.quote(local_original_name), bun.fmt.quote(property_name), bun.fmt.quote(local_original_name) },
                        ) catch |err| bun.handleOom(err) },
                    },
                ) catch |err| bun.handleOom(err),
            }) catch |err| bun.handleOom(err);

            // Don't warn more than once
            entry.value_ptr.source_index = Index.invalid.get();
        }

        fn clearRetainingCapacity(v: *@This()) void {
            v.visited.clearRetainingCapacity();
            v.properties.clearRetainingCapacity();
        }

        fn visit(v: *@This(), idx: Index.Int, ast: *bun.css.BundlerStyleSheet, ref: Ref) void {
            if (v.visited.contains(ref)) return;
            v.visited.put(ref, {}) catch unreachable;

            // This local name was in a style rule that
            if (ast.composes.getPtr(ref)) |composes| {
                for (composes.composes.sliceConst()) |*compose| {
                    // is an import
                    if (compose.from != null) {
                        if (compose.from.? == .import_record_index) {
                            const import_record_idx = compose.from.?.import_record_index;
                            const record = v.all_import_records[idx].at(import_record_idx);
                            if (record.source_index.isInvalid()) continue;
                            const other_ast = v.all_css_asts[record.source_index.get()] orelse continue;
                            for (compose.names.slice()) |name| {
                                const other_name = other_ast.local_scope.get(name.v) orelse continue;
                                const other_name_ref = other_name.ref.toRealRef(record.source_index.get());
                                v.visit(record.source_index.get(), other_ast, other_name_ref);
                            }
                        } else {
                            bun.assert(compose.from.? == .global);
                            // Otherwise it is composed from the global scope.
                            //
                            // See comment above for why we are skipping checking this for now.
                        }
                    } else {
                        // inside this file
                        for (compose.names.slice()) |name| {
                            const name_entry = ast.local_scope.get(name.v) orelse continue;
                            v.visit(idx, ast, name_entry.ref.toRealRef(idx));
                        }
                    }
                }
            }

            const property_usage = ast.local_properties.getPtr(ref) orelse return;
            // Warn about cross-file composition with the same CSS properties
            var iter = property_usage.bitset.iterator(.{});
            while (iter.next()) |property_tag| {
                const property_id_tag: bun.css.PropertyIdTag = @enumFromInt(@as(u16, @intCast(property_tag)));
                bun.assert(property_id_tag != .custom);
                bun.assert(property_id_tag != .unparsed);
                v.addPropertyOrWarn(ref, @tagName(property_id_tag), idx, property_usage.range);
            }

            for (property_usage.custom_properties) |property| {
                v.addPropertyOrWarn(ref, property, idx, property_usage.range);
            }
        }
    };
    var sfb = std.heap.stackFallback(1024, this.graph.allocator);
    const temp_allocator = sfb.get();
    var visitor = Visitor{
        .visited = std.AutoArrayHashMap(Ref, void).init(temp_allocator),
        .properties = bun.StringArrayHashMap(PropertyInFile).init(temp_allocator),
        .all_import_records = import_records_list,
        .all_css_asts = all_css_asts,
        .all_symbols = &this.graph.symbols,
        .all_sources = this.parse_graph.input_files.items(.source),
        .temp_allocator = temp_allocator,
        .allocator = this.graph.allocator,
        .log = this.log,
    };
    defer visitor.deinit();
    for (root_css_ast.local_scope.values()) |local| {
        visitor.clearRetainingCapacity();
        visitor.visit(index, root_css_ast, local.ref.toRealRef(index));
    }
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const ImportRecord = bun.ImportRecord;
const Loader = bun.Loader;
const Logger = bun.logger;
const options = bun.options;
const strings = bun.strings;

const EntryPoint = bun.bundle_v2.EntryPoint;
const ExportData = bun.bundle_v2.ExportData;
const ImportData = bun.bundle_v2.ImportData;
const Index = bun.bundle_v2.Index;
const JSMeta = bun.bundle_v2.JSMeta;
const Part = bun.bundle_v2.Part;
const RefImportData = bun.bundle_v2.RefImportData;
const ResolvedExports = bun.bundle_v2.ResolvedExports;
const Symbol = bun.bundle_v2.Symbol;

const LinkerContext = bun.bundle_v2.LinkerContext;
const debug = LinkerContext.debug;

const js_ast = bun.bundle_v2.js_ast;
const Dependency = js_ast.Dependency;
const Ref = bun.bundle_v2.js_ast.Ref;
