stmts: []Stmt = &.{},
kept_import_equals: bool = false,
removed_import_equals: bool = false,

pub fn scan(
    comptime P: type,
    p: *P,
    stmts: []Stmt,
    will_transform_to_common_js: bool,
    comptime hot_module_reloading_transformations: bool,
    hot_module_reloading_context: if (hot_module_reloading_transformations) *ConvertESMExportsForHmr else void,
) !ImportScanner {
    var scanner = ImportScanner{};
    var stmts_end: usize = 0;
    const allocator = p.allocator;
    const is_typescript_enabled: bool = comptime P.parser_features.typescript;

    for (stmts) |_stmt| {
        var stmt = _stmt; // copy
        switch (stmt.data) {
            .s_import => |import_ptr| {
                var st = import_ptr.*;
                defer import_ptr.* = st;

                const record: *ImportRecord = &p.import_records.items[st.import_record_index];

                if (record.path.isMacro()) {
                    record.flags.is_unused = true;
                    record.path.is_disabled = true;
                    continue;
                }

                // The official TypeScript compiler always removes unused imported
                // symbols. However, we deliberately deviate from the official
                // TypeScript compiler's behavior doing this in a specific scenario:
                // we are not bundling, symbol renaming is off, and the tsconfig.json
                // "importsNotUsedAsValues" setting is present and is not set to
                // "remove".
                //
                // This exists to support the use case of compiling partial modules for
                // compile-to-JavaScript languages such as Svelte. These languages try
                // to reference imports in ways that are impossible for esbuild to know
                // about when esbuild is only given a partial module to compile. Here
                // is an example of some Svelte code that might use esbuild to convert
                // TypeScript to JavaScript:
                //
                //   <script lang="ts">
                //     import Counter from './Counter.svelte';
                //     export let name: string = 'world';
                //   </script>
                //   <main>
                //     <h1>Hello {name}!</h1>
                //     <Counter />
                //   </main>
                //
                // Tools that use esbuild to compile TypeScript code inside a Svelte
                // file like this only give esbuild the contents of the <script> tag.
                // These tools work around this missing import problem when using the
                // official TypeScript compiler by hacking the TypeScript AST to
                // remove the "unused import" flags. This isn't possible in esbuild
                // because esbuild deliberately does not expose an AST manipulation
                // API for performance reasons.
                //
                // We deviate from the TypeScript compiler's behavior in this specific
                // case because doing so is useful for these compile-to-JavaScript
                // languages and is benign in other cases. The rationale is as follows:
                //
                //   * If "importsNotUsedAsValues" is absent or set to "remove", then
                //     we don't know if these imports are values or types. It's not
                //     safe to keep them because if they are types, the missing imports
                //     will cause run-time failures because there will be no matching
                //     exports. It's only safe keep imports if "importsNotUsedAsValues"
                //     is set to "preserve" or "error" because then we can assume that
                //     none of the imports are types (since the TypeScript compiler
                //     would generate an error in that case).
                //
                //   * If we're bundling, then we know we aren't being used to compile
                //     a partial module. The parser is seeing the entire code for the
                //     module so it's safe to remove unused imports. And also we don't
                //     want the linker to generate errors about missing imports if the
                //     imported file is also in the bundle.
                //
                //   * If identifier minification is enabled, then using esbuild as a
                //     partial-module transform library wouldn't work anyway because
                //     the names wouldn't match. And that means we're minifying so the
                //     user is expecting the output to be as small as possible. So we
                //     should omit unused imports.
                //
                var did_remove_star_loc = false;
                const keep_unused_imports = !p.options.features.trim_unused_imports;
                // TypeScript always trims unused imports. This is important for
                // correctness since some imports might be fake (only in the type
                // system and used for type-only imports).
                if (!keep_unused_imports) {
                    var found_imports = false;
                    var is_unused_in_typescript = true;

                    if (st.default_name) |default_name| {
                        found_imports = true;
                        const symbol = p.symbols.items[default_name.ref.?.innerIndex()];

                        // TypeScript has a separate definition of unused
                        if (is_typescript_enabled and p.ts_use_counts.items[default_name.ref.?.innerIndex()] != 0) {
                            is_unused_in_typescript = false;
                        }

                        // Remove the symbol if it's never used outside a dead code region
                        if (symbol.use_count_estimate == 0) {
                            st.default_name = null;
                        }
                    }

                    // Remove the star import if it's unused
                    if (st.star_name_loc) |_| {
                        found_imports = true;
                        const symbol = p.symbols.items[st.namespace_ref.innerIndex()];

                        // TypeScript has a separate definition of unused
                        if (is_typescript_enabled and p.ts_use_counts.items[st.namespace_ref.innerIndex()] != 0) {
                            is_unused_in_typescript = false;
                        }

                        // Remove the symbol if it's never used outside a dead code region
                        if (symbol.use_count_estimate == 0) {
                            // Make sure we don't remove this if it was used for a property
                            // access while bundling
                            var has_any = false;

                            if (p.import_items_for_namespace.get(st.namespace_ref)) |entry| {
                                if (entry.count() > 0) {
                                    has_any = true;
                                }
                            }

                            if (!has_any) {
                                st.star_name_loc = null;
                                did_remove_star_loc = true;
                            }
                        }
                    }

                    // Remove items if they are unused
                    if (st.items.len > 0) {
                        found_imports = true;
                        var items_end: usize = 0;
                        for (st.items) |item| {
                            const ref = item.name.ref.?;
                            const symbol: Symbol = p.symbols.items[ref.innerIndex()];

                            // TypeScript has a separate definition of unused
                            if (is_typescript_enabled and p.ts_use_counts.items[ref.innerIndex()] != 0) {
                                is_unused_in_typescript = false;
                            }

                            // Remove the symbol if it's never used outside a dead code region
                            if (symbol.use_count_estimate != 0) {
                                st.items[items_end] = item;
                                items_end += 1;
                            }
                        }

                        st.items = st.items[0..items_end];
                    }

                    // -- Original Comment --
                    // Omit this statement if we're parsing TypeScript and all imports are
                    // unused. Note that this is distinct from the case where there were
                    // no imports at all (e.g. "import 'foo'"). In that case we want to keep
                    // the statement because the user is clearly trying to import the module
                    // for side effects.
                    //
                    // This culling is important for correctness when parsing TypeScript
                    // because a) the TypeScript compiler does this and we want to match it
                    // and b) this may be a fake module that only exists in the type system
                    // and doesn't actually exist in reality.
                    //
                    // We do not want to do this culling in JavaScript though because the
                    // module may have side effects even if all imports are unused.
                    // -- Original Comment --

                    // jarred: I think, in this project, we want this behavior, even in JavaScript.
                    // I think this would be a big performance improvement.
                    // The less you import, the less code you transpile.
                    // Side-effect imports are nearly always done through identifier-less imports
                    // e.g. `import 'fancy-stylesheet-thing/style.css';`
                    // This is a breaking change though. We can make it an option with some guardrail
                    // so maybe if it errors, it shows a suggestion "retry without trimming unused imports"
                    if ((is_typescript_enabled and found_imports and is_unused_in_typescript and !p.options.preserve_unused_imports_ts) or
                        (!is_typescript_enabled and p.options.features.trim_unused_imports and found_imports and st.star_name_loc == null and st.items.len == 0 and st.default_name == null))
                    {
                        // internal imports are presumed to be always used
                        // require statements cannot be stripped
                        if (!record.flags.is_internal and !record.flags.was_originally_require) {
                            record.flags.is_unused = true;
                            continue;
                        }
                    }
                }

                const namespace_ref = st.namespace_ref;
                const convert_star_to_clause = !p.options.bundle and (p.symbols.items[namespace_ref.innerIndex()].use_count_estimate == 0);

                if (convert_star_to_clause and !keep_unused_imports) {
                    st.star_name_loc = null;
                }

                record.flags.contains_default_alias = record.flags.contains_default_alias or st.default_name != null;

                const existing_items: ImportItemForNamespaceMap = p.import_items_for_namespace.get(namespace_ref) orelse
                    ImportItemForNamespaceMap.init(allocator);

                if (p.options.bundle) {
                    if (st.star_name_loc != null and existing_items.count() > 0) {
                        const sorted = try allocator.alloc(string, existing_items.count());
                        defer allocator.free(sorted);
                        for (sorted, existing_items.keys()) |*result, alias| {
                            result.* = alias;
                        }
                        strings.sortDesc(sorted);
                        bun.handleOom(p.named_imports.ensureUnusedCapacity(p.allocator, sorted.len));

                        // Create named imports for these property accesses. This will
                        // cause missing imports to generate useful warnings.
                        //
                        // It will also improve bundling efficiency for internal imports
                        // by still converting property accesses off the namespace into
                        // bare identifiers even if the namespace is still needed.
                        for (sorted) |alias| {
                            const item = existing_items.get(alias).?;
                            p.named_imports.put(
                                p.allocator,
                                item.ref.?,
                                js_ast.NamedImport{
                                    .alias = alias,
                                    .alias_loc = item.loc,
                                    .namespace_ref = namespace_ref,
                                    .import_record_index = st.import_record_index,
                                },
                            ) catch |err| bun.handleOom(err);

                            const name: LocRef = item;
                            const name_ref = name.ref.?;

                            // Make sure the printer prints this as a property access
                            var symbol: *Symbol = &p.symbols.items[name_ref.innerIndex()];

                            symbol.namespace_alias = G.NamespaceAlias{
                                .namespace_ref = namespace_ref,
                                .alias = alias,
                                .import_record_index = st.import_record_index,
                                .was_originally_property_access = st.star_name_loc != null and existing_items.contains(symbol.original_name),
                            };

                            // Also record these automatically-generated top-level namespace alias symbols
                            p.declared_symbols.append(p.allocator, .{
                                .ref = name_ref,
                                .is_top_level = true,
                            }) catch unreachable;
                        }
                    }

                    p.named_imports.ensureUnusedCapacity(
                        p.allocator,
                        st.items.len + @as(usize, @intFromBool(st.default_name != null)) + @as(usize, @intFromBool(st.star_name_loc != null)),
                    ) catch |err| bun.handleOom(err);

                    if (st.star_name_loc) |loc| {
                        record.flags.contains_import_star = true;
                        p.named_imports.putAssumeCapacity(
                            namespace_ref,
                            js_ast.NamedImport{
                                .alias_is_star = true,
                                .alias = "",
                                .alias_loc = loc,
                                .namespace_ref = Ref.None,
                                .import_record_index = st.import_record_index,
                            },
                        );
                    }

                    if (st.default_name) |default| {
                        record.flags.contains_default_alias = true;
                        p.named_imports.putAssumeCapacity(
                            default.ref.?,
                            .{
                                .alias = "default",
                                .alias_loc = default.loc,
                                .namespace_ref = namespace_ref,
                                .import_record_index = st.import_record_index,
                            },
                        );
                    }

                    for (st.items) |item| {
                        const name: LocRef = item.name;
                        const name_ref = name.ref.?;

                        p.named_imports.putAssumeCapacity(
                            name_ref,
                            js_ast.NamedImport{
                                .alias = item.alias,
                                .alias_loc = name.loc,
                                .namespace_ref = namespace_ref,
                                .import_record_index = st.import_record_index,
                            },
                        );
                    }
                } else {
                    // ESM requires live bindings
                    // CommonJS does not require live bindings
                    // We load ESM in browsers & in Bun.js
                    // We have to simulate live bindings for cases where the code is bundled
                    // We do not know at this stage whether or not the import statement is bundled
                    // This keeps track of the `namespace_alias` incase, at printing time, we determine that we should print it with the namespace
                    for (st.items) |item| {
                        record.flags.contains_default_alias = record.flags.contains_default_alias or strings.eqlComptime(item.alias, "default");

                        const name: LocRef = item.name;
                        const name_ref = name.ref.?;

                        try p.named_imports.put(p.allocator, name_ref, js_ast.NamedImport{
                            .alias = item.alias,
                            .alias_loc = name.loc,
                            .namespace_ref = namespace_ref,
                            .import_record_index = st.import_record_index,
                        });

                        // Make sure the printer prints this as a property access
                        var symbol: *Symbol = &p.symbols.items[name_ref.innerIndex()];
                        if (record.flags.contains_import_star or st.star_name_loc != null)
                            symbol.namespace_alias = G.NamespaceAlias{
                                .namespace_ref = namespace_ref,
                                .alias = item.alias,
                                .import_record_index = st.import_record_index,
                                .was_originally_property_access = st.star_name_loc != null and existing_items.contains(symbol.original_name),
                            };
                    }

                    if (record.flags.was_originally_require) {
                        var symbol = &p.symbols.items[namespace_ref.innerIndex()];
                        symbol.namespace_alias = G.NamespaceAlias{
                            .namespace_ref = namespace_ref,
                            .alias = "",
                            .import_record_index = st.import_record_index,
                            .was_originally_property_access = false,
                        };
                    }
                }

                try p.import_records_for_current_part.append(allocator, st.import_record_index);

                record.flags.contains_import_star = record.flags.contains_import_star or st.star_name_loc != null;
                record.flags.contains_default_alias = record.flags.contains_default_alias or st.default_name != null;

                for (st.items) |*item| {
                    record.flags.contains_default_alias = record.flags.contains_default_alias or strings.eqlComptime(item.alias, "default");
                    record.flags.contains_es_module_alias = record.flags.contains_es_module_alias or strings.eqlComptime(item.alias, "__esModule");
                }
            },

            .s_function => |st| {
                if (st.func.flags.contains(.is_export)) {
                    if (st.func.name) |name| {
                        const original_name = p.symbols.items[name.ref.?.innerIndex()].original_name;
                        try p.recordExport(name.loc, original_name, name.ref.?);
                    } else {
                        try p.log.addRangeError(p.source, logger.Range{ .loc = st.func.open_parens_loc, .len = 2 }, "Exported functions must have a name");
                    }
                }
            },
            .s_class => |st| {
                if (st.is_export) {
                    if (st.class.class_name) |name| {
                        try p.recordExport(name.loc, p.symbols.items[name.ref.?.innerIndex()].original_name, name.ref.?);
                    } else {
                        try p.log.addRangeError(p.source, logger.Range{ .loc = st.class.body_loc, .len = 0 }, "Exported classes must have a name");
                    }
                }
            },
            .s_local => |st| {
                if (st.is_export) {
                    for (st.decls.slice()) |decl| {
                        p.recordExportedBinding(decl.binding);
                    }
                }

                // Remove unused import-equals statements, since those likely
                // correspond to types instead of values
                if (st.was_ts_import_equals and !st.is_export and st.decls.len > 0) {
                    var decl = st.decls.ptr[0];

                    // Skip to the underlying reference
                    var value = decl.value;
                    if (decl.value != null) {
                        while (true) {
                            if (@as(Expr.Tag, value.?.data) == .e_dot) {
                                value = value.?.data.e_dot.target;
                            } else {
                                break;
                            }
                        }
                    }

                    // Is this an identifier reference and not a require() call?
                    if (value) |val| {
                        if (@as(Expr.Tag, val.data) == .e_identifier) {
                            // Is this import statement unused?
                            if (@as(Binding.Tag, decl.binding.data) == .b_identifier and p.symbols.items[decl.binding.data.b_identifier.ref.innerIndex()].use_count_estimate == 0) {
                                p.ignoreUsage(val.data.e_identifier.ref);

                                scanner.removed_import_equals = true;
                                continue;
                            } else {
                                scanner.kept_import_equals = true;
                            }
                        }
                    }
                }
            },
            .s_export_default => |st| {
                // This is defer'd so that we still record export default for identifiers
                defer {
                    if (st.default_name.ref) |ref| {
                        p.recordExport(st.default_name.loc, "default", ref) catch {};
                    }
                }

                // Rewrite this export to be:
                // exports.default =
                // But only if it's anonymous
                if (!hot_module_reloading_transformations and will_transform_to_common_js and P != bun.bundle_v2.AstBuilder) {
                    const expr = st.value.toExpr();
                    var export_default_args = try p.allocator.alloc(Expr, 2);
                    export_default_args[0] = p.@"module.exports"(expr.loc);
                    export_default_args[1] = expr;
                    stmt = p.s(S.SExpr{ .value = p.callRuntime(expr.loc, "__exportDefault", export_default_args) }, expr.loc);
                }
            },
            .s_export_clause => |st| {
                for (st.items) |item| {
                    try p.recordExport(item.alias_loc, item.alias, item.name.ref.?);
                }
            },
            .s_export_star => |st| {
                try p.import_records_for_current_part.append(allocator, st.import_record_index);

                if (st.alias) |alias| {
                    // "export * as ns from 'path'"
                    try p.named_imports.put(p.allocator, st.namespace_ref, js_ast.NamedImport{
                        .alias = null,
                        .alias_is_star = true,
                        .alias_loc = alias.loc,
                        .namespace_ref = Ref.None,
                        .import_record_index = st.import_record_index,
                        .is_exported = true,
                    });
                    try p.recordExport(alias.loc, alias.original_name, st.namespace_ref);
                    var record = &p.import_records.items[st.import_record_index];
                    record.flags.contains_import_star = true;
                } else {
                    // "export * from 'path'"
                    try p.export_star_import_records.append(allocator, st.import_record_index);
                }
            },
            .s_export_from => |st| {
                try p.import_records_for_current_part.append(allocator, st.import_record_index);
                p.named_imports.ensureUnusedCapacity(p.allocator, st.items.len) catch unreachable;
                for (st.items) |item| {
                    const ref = item.name.ref orelse p.panic("Expected export from item to have a name", .{});
                    // Note that the imported alias is not item.Alias, which is the
                    // exported alias. This is somewhat confusing because each
                    // SExportFrom statement is basically SImport + SExportClause in one.
                    try p.named_imports.put(p.allocator, ref, js_ast.NamedImport{
                        .alias_is_star = false,
                        .alias = item.original_name,
                        .alias_loc = item.name.loc,
                        .namespace_ref = st.namespace_ref,
                        .import_record_index = st.import_record_index,
                        .is_exported = true,
                    });
                    try p.recordExport(item.name.loc, item.alias, ref);

                    var record = &p.import_records.items[st.import_record_index];
                    if (strings.eqlComptime(item.original_name, "default")) {
                        record.flags.contains_default_alias = true;
                    } else if (strings.eqlComptime(item.original_name, "__esModule")) {
                        record.flags.contains_es_module_alias = true;
                    }
                }
            },
            else => {},
        }

        if (hot_module_reloading_transformations) {
            try hot_module_reloading_context.convertStmt(p, stmt);
        } else {
            stmts[stmts_end] = stmt;
            stmts_end += 1;
        }
    }

    if (!hot_module_reloading_transformations)
        scanner.stmts = stmts[0..stmts_end];

    return scanner;
}

const string = []const u8;

const bun = @import("bun");
const ImportRecord = bun.ImportRecord;
const logger = bun.logger;
const strings = bun.strings;

const js_ast = bun.ast;
const Binding = js_ast.Binding;
const Expr = js_ast.Expr;
const G = js_ast.G;
const LocRef = js_ast.LocRef;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
const Symbol = js_ast.Symbol;

const js_parser = bun.js_parser;
const ConvertESMExportsForHmr = js_parser.ConvertESMExportsForHmr;
const ImportItemForNamespaceMap = js_parser.ImportItemForNamespaceMap;
const ImportScanner = js_parser.ImportScanner;
const Ref = js_parser.Ref;
const TypeScript = js_parser.TypeScript;
const options = js_parser.options;
