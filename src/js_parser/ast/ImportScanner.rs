use bun_js_parser::ast::{self as js_ast, Binding, Expr, G, LocRef, S, Stmt, Symbol};
use bun_js_parser::{ConvertESMExportsForHmr, ImportItemForNamespaceMap, Ref};
use bun_logger as logger;
use bun_options_types::ImportRecord;
use bun_str::strings;

// PORT NOTE: Zig file-level struct → Rust struct. `stmts` is a sub-slice of the
// input `stmts` argument (in-place compacted), so it borrows from the caller.
#[derive(Default)]
pub struct ImportScanner<'a> {
    pub stmts: &'a mut [Stmt],
    pub kept_import_equals: bool,
    pub removed_import_equals: bool,
}

impl<'a> ImportScanner<'a> {
    // TODO(port): narrow error set
    // TODO(port): `P` needs a trait bound exposing the parser fields/methods used
    //   below (allocator, import_records, symbols, ts_use_counts, options,
    //   import_items_for_namespace, named_imports, declared_symbols,
    //   import_records_for_current_part, export_star_import_records, log, source,
    //   recordExport, recordExportedBinding, ignoreUsage, panic, s, callRuntime,
    //   module_exports) plus associated consts PARSER_FEATURES_TYPESCRIPT and
    //   IS_AST_BUILDER (for the `P != bun.bundle_v2.AstBuilder` comptime check).
    pub fn scan<P, const HOT_MODULE_RELOADING_TRANSFORMATIONS: bool>(
        p: &mut P,
        stmts: &'a mut [Stmt],
        will_transform_to_common_js: bool,
        // PORT NOTE: Zig used `if (comptime_bool) *T else void` for this param's
        // type; Rust const generics can't gate a param type, so use Option and
        // debug-assert presence matches the const.
        mut hot_module_reloading_context: Option<&mut ConvertESMExportsForHmr>,
    ) -> Result<ImportScanner<'a>, bun_core::Error> {
        debug_assert_eq!(
            HOT_MODULE_RELOADING_TRANSFORMATIONS,
            hot_module_reloading_context.is_some()
        );

        let mut scanner = ImportScanner::default();
        let mut stmts_end: usize = 0;
        // PORT NOTE: `allocator` (p.allocator) dropped — see §Allocators (AST crate).
        // Arena allocs below go through `p.allocator` (a &Bump) where they persist.
        let is_typescript_enabled: bool = P::PARSER_FEATURES_TYPESCRIPT;

        for i in 0..stmts.len() {
            // PORT NOTE: Zig iterated by value-copy then wrote back via index at
            // the bottom; we index directly to allow in-place mutation + reassign.
            let mut stmt = stmts[i]; // copy
            match &mut stmt.data {
                js_ast::StmtData::SImport(import_ptr) => {
                    // PORT NOTE: Zig did `var st = import_ptr.*; defer import_ptr.* = st;`
                    // (copy + unconditional write-back). Equivalent to mutating in place.
                    let st = &mut **import_ptr;

                    let import_record_index = st.import_record_index;
                    // PORT NOTE: reshaped for borrowck — re-borrow `record` from
                    // `p.import_records` at each cluster of uses instead of one
                    // long-lived &mut that overlaps other `p.*` borrows.
                    {
                        let record: &mut ImportRecord =
                            &mut p.import_records.items[import_record_index as usize];

                        if record.path.is_macro() {
                            record.flags.is_unused = true;
                            record.path.is_disabled = true;
                            continue;
                        }
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
                    let mut did_remove_star_loc = false;
                    let keep_unused_imports = !p.options.features.trim_unused_imports;
                    // TypeScript always trims unused imports. This is important for
                    // correctness since some imports might be fake (only in the type
                    // system and used for type-only imports).
                    if !keep_unused_imports {
                        let mut found_imports = false;
                        let mut is_unused_in_typescript = true;

                        if let Some(default_name) = st.default_name {
                            found_imports = true;
                            let symbol =
                                p.symbols.items[default_name.ref_.unwrap().inner_index() as usize];

                            // TypeScript has a separate definition of unused
                            if is_typescript_enabled
                                && p.ts_use_counts.items
                                    [default_name.ref_.unwrap().inner_index() as usize]
                                    != 0
                            {
                                is_unused_in_typescript = false;
                            }

                            // Remove the symbol if it's never used outside a dead code region
                            if symbol.use_count_estimate == 0 {
                                st.default_name = None;
                            }
                        }

                        // Remove the star import if it's unused
                        if st.star_name_loc.is_some() {
                            found_imports = true;
                            let symbol =
                                p.symbols.items[st.namespace_ref.inner_index() as usize];

                            // TypeScript has a separate definition of unused
                            if is_typescript_enabled
                                && p.ts_use_counts.items[st.namespace_ref.inner_index() as usize]
                                    != 0
                            {
                                is_unused_in_typescript = false;
                            }

                            // Remove the symbol if it's never used outside a dead code region
                            if symbol.use_count_estimate == 0 {
                                // Make sure we don't remove this if it was used for a property
                                // access while bundling
                                let mut has_any = false;

                                if let Some(entry) =
                                    p.import_items_for_namespace.get(&st.namespace_ref)
                                {
                                    if entry.count() > 0 {
                                        has_any = true;
                                    }
                                }

                                if !has_any {
                                    st.star_name_loc = None;
                                    did_remove_star_loc = true;
                                }
                            }
                        }

                        // Remove items if they are unused
                        if !st.items.is_empty() {
                            found_imports = true;
                            let mut items_end: usize = 0;
                            for idx in 0..st.items.len() {
                                let item = st.items[idx];
                                let ref_ = item.name.ref_.unwrap();
                                let symbol: Symbol =
                                    p.symbols.items[ref_.inner_index() as usize];

                                // TypeScript has a separate definition of unused
                                if is_typescript_enabled
                                    && p.ts_use_counts.items[ref_.inner_index() as usize] != 0
                                {
                                    is_unused_in_typescript = false;
                                }

                                // Remove the symbol if it's never used outside a dead code region
                                if symbol.use_count_estimate != 0 {
                                    st.items[items_end] = item;
                                    items_end += 1;
                                }
                            }

                            st.items = &mut st.items[0..items_end];
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
                        if (is_typescript_enabled
                            && found_imports
                            && is_unused_in_typescript
                            && !p.options.preserve_unused_imports_ts)
                            || (!is_typescript_enabled
                                && p.options.features.trim_unused_imports
                                && found_imports
                                && st.star_name_loc.is_none()
                                && st.items.is_empty()
                                && st.default_name.is_none())
                        {
                            let record: &mut ImportRecord =
                                &mut p.import_records.items[import_record_index as usize];
                            // internal imports are presumed to be always used
                            // require statements cannot be stripped
                            if !record.flags.is_internal && !record.flags.was_originally_require {
                                record.flags.is_unused = true;
                                continue;
                            }
                        }
                    }

                    let _ = did_remove_star_loc;

                    let namespace_ref = st.namespace_ref;
                    let convert_star_to_clause = !p.options.bundle
                        && (p.symbols.items[namespace_ref.inner_index() as usize]
                            .use_count_estimate
                            == 0);

                    if convert_star_to_clause && !keep_unused_imports {
                        st.star_name_loc = None;
                    }

                    {
                        let record: &mut ImportRecord =
                            &mut p.import_records.items[import_record_index as usize];
                        record.flags.contains_default_alias =
                            record.flags.contains_default_alias || st.default_name.is_some();
                    }

                    let existing_items: ImportItemForNamespaceMap = p
                        .import_items_for_namespace
                        .get(&namespace_ref)
                        .cloned()
                        // TODO(port): ImportItemForNamespaceMap::init(allocator) — arena-backed map ctor
                        .unwrap_or_default();

                    if p.options.bundle {
                        if st.star_name_loc.is_some() && existing_items.count() > 0 {
                            // PERF(port): was arena alloc + defer free for scratch sort buffer
                            let mut sorted: Vec<&[u8]> =
                                Vec::with_capacity(existing_items.count());
                            debug_assert_eq!(sorted.capacity(), existing_items.keys().len());
                            for alias in existing_items.keys() {
                                sorted.push(alias);
                            }
                            strings::sort_desc(&mut sorted);
                            p.named_imports.reserve(sorted.len());

                            // Create named imports for these property accesses. This will
                            // cause missing imports to generate useful warnings.
                            //
                            // It will also improve bundling efficiency for internal imports
                            // by still converting property accesses off the namespace into
                            // bare identifiers even if the namespace is still needed.
                            for alias in &sorted {
                                let item = *existing_items.get(alias).unwrap();
                                p.named_imports.insert(
                                    item.ref_.unwrap(),
                                    js_ast::NamedImport {
                                        alias: Some(*alias),
                                        alias_loc: item.loc,
                                        namespace_ref,
                                        import_record_index: st.import_record_index,
                                        ..Default::default()
                                    },
                                );

                                let name: LocRef = item;
                                let name_ref = name.ref_.unwrap();

                                // Make sure the printer prints this as a property access
                                let symbol: &mut Symbol =
                                    &mut p.symbols.items[name_ref.inner_index() as usize];

                                symbol.namespace_alias = Some(G::NamespaceAlias {
                                    namespace_ref,
                                    alias: *alias,
                                    import_record_index: st.import_record_index,
                                    was_originally_property_access: st.star_name_loc.is_some()
                                        && existing_items.contains(symbol.original_name),
                                });

                                // Also record these automatically-generated top-level namespace alias symbols
                                p.declared_symbols
                                    .push(js_ast::DeclaredSymbol {
                                        ref_: name_ref,
                                        is_top_level: true,
                                    })
                                    .expect("unreachable");
                            }
                        }

                        p.named_imports.reserve(
                            st.items.len()
                                + usize::from(st.default_name.is_some())
                                + usize::from(st.star_name_loc.is_some()),
                        );

                        if let Some(loc) = st.star_name_loc {
                            p.import_records.items[import_record_index as usize]
                                .flags
                                .contains_import_star = true;
                            // PERF(port): was assume_capacity
                            p.named_imports.insert(
                                namespace_ref,
                                js_ast::NamedImport {
                                    alias_is_star: true,
                                    alias: Some(b""),
                                    alias_loc: loc,
                                    namespace_ref: Ref::NONE,
                                    import_record_index: st.import_record_index,
                                    ..Default::default()
                                },
                            );
                        }

                        if let Some(default) = st.default_name {
                            p.import_records.items[import_record_index as usize]
                                .flags
                                .contains_default_alias = true;
                            // PERF(port): was assume_capacity
                            p.named_imports.insert(
                                default.ref_.unwrap(),
                                js_ast::NamedImport {
                                    alias: Some(b"default"),
                                    alias_loc: default.loc,
                                    namespace_ref,
                                    import_record_index: st.import_record_index,
                                    ..Default::default()
                                },
                            );
                        }

                        for item in st.items.iter() {
                            let name: LocRef = item.name;
                            let name_ref = name.ref_.unwrap();

                            // PERF(port): was assume_capacity
                            p.named_imports.insert(
                                name_ref,
                                js_ast::NamedImport {
                                    alias: Some(item.alias),
                                    alias_loc: name.loc,
                                    namespace_ref,
                                    import_record_index: st.import_record_index,
                                    ..Default::default()
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
                        for item in st.items.iter() {
                            {
                                let record: &mut ImportRecord =
                                    &mut p.import_records.items[import_record_index as usize];
                                record.flags.contains_default_alias = record
                                    .flags
                                    .contains_default_alias
                                    || item.alias == b"default";
                            }

                            let name: LocRef = item.name;
                            let name_ref = name.ref_.unwrap();

                            p.named_imports.insert(
                                name_ref,
                                js_ast::NamedImport {
                                    alias: Some(item.alias),
                                    alias_loc: name.loc,
                                    namespace_ref,
                                    import_record_index: st.import_record_index,
                                    ..Default::default()
                                },
                            )?;

                            // Make sure the printer prints this as a property access
                            // PORT NOTE: reshaped for borrowck
                            let contains_import_star = p.import_records.items
                                [import_record_index as usize]
                                .flags
                                .contains_import_star;
                            let symbol: &mut Symbol =
                                &mut p.symbols.items[name_ref.inner_index() as usize];
                            if contains_import_star || st.star_name_loc.is_some() {
                                symbol.namespace_alias = Some(G::NamespaceAlias {
                                    namespace_ref,
                                    alias: item.alias,
                                    import_record_index: st.import_record_index,
                                    was_originally_property_access: st.star_name_loc.is_some()
                                        && existing_items.contains(symbol.original_name),
                                });
                            }
                        }

                        if p.import_records.items[import_record_index as usize]
                            .flags
                            .was_originally_require
                        {
                            let symbol =
                                &mut p.symbols.items[namespace_ref.inner_index() as usize];
                            symbol.namespace_alias = Some(G::NamespaceAlias {
                                namespace_ref,
                                alias: b"",
                                import_record_index: st.import_record_index,
                                was_originally_property_access: false,
                            });
                        }
                    }

                    p.import_records_for_current_part
                        .push(st.import_record_index)?;

                    let record: &mut ImportRecord =
                        &mut p.import_records.items[import_record_index as usize];
                    record.flags.contains_import_star =
                        record.flags.contains_import_star || st.star_name_loc.is_some();
                    record.flags.contains_default_alias =
                        record.flags.contains_default_alias || st.default_name.is_some();

                    for item in st.items.iter() {
                        record.flags.contains_default_alias =
                            record.flags.contains_default_alias || item.alias == b"default";
                        record.flags.contains_es_module_alias =
                            record.flags.contains_es_module_alias || item.alias == b"__esModule";
                    }
                }

                js_ast::StmtData::SFunction(st) => {
                    if st.func.flags.contains(js_ast::FnFlags::IS_EXPORT) {
                        if let Some(name) = st.func.name {
                            let original_name = p.symbols.items
                                [name.ref_.unwrap().inner_index() as usize]
                                .original_name;
                            p.record_export(name.loc, original_name, name.ref_.unwrap())?;
                        } else {
                            p.log.add_range_error(
                                p.source,
                                logger::Range {
                                    loc: st.func.open_parens_loc,
                                    len: 2,
                                },
                                "Exported functions must have a name",
                            )?;
                        }
                    }
                }
                js_ast::StmtData::SClass(st) => {
                    if st.is_export {
                        if let Some(name) = st.class.class_name {
                            p.record_export(
                                name.loc,
                                p.symbols.items[name.ref_.unwrap().inner_index() as usize]
                                    .original_name,
                                name.ref_.unwrap(),
                            )?;
                        } else {
                            p.log.add_range_error(
                                p.source,
                                logger::Range {
                                    loc: st.class.body_loc,
                                    len: 0,
                                },
                                "Exported classes must have a name",
                            )?;
                        }
                    }
                }
                js_ast::StmtData::SLocal(st) => {
                    if st.is_export {
                        for decl in st.decls.slice() {
                            p.record_exported_binding(decl.binding);
                        }
                    }

                    // Remove unused import-equals statements, since those likely
                    // correspond to types instead of values
                    if st.was_ts_import_equals && !st.is_export && st.decls.len() > 0 {
                        let decl = st.decls.ptr[0];

                        // Skip to the underlying reference
                        let mut value = decl.value;
                        if decl.value.is_some() {
                            loop {
                                if matches!(value.unwrap().data, js_ast::ExprData::EDot(_)) {
                                    value = Some(value.unwrap().data.e_dot().target);
                                } else {
                                    break;
                                }
                            }
                        }

                        // Is this an identifier reference and not a require() call?
                        if let Some(val) = value {
                            if matches!(val.data, js_ast::ExprData::EIdentifier(_)) {
                                // Is this import statement unused?
                                if matches!(
                                    decl.binding.data,
                                    js_ast::BindingData::BIdentifier(_)
                                ) && p.symbols.items[decl
                                    .binding
                                    .data
                                    .b_identifier()
                                    .ref_
                                    .inner_index()
                                    as usize]
                                    .use_count_estimate
                                    == 0
                                {
                                    p.ignore_usage(val.data.e_identifier().ref_);

                                    scanner.removed_import_equals = true;
                                    continue;
                                } else {
                                    scanner.kept_import_equals = true;
                                }
                            }
                        }
                    }
                }
                js_ast::StmtData::SExportDefault(st) => {
                    // PORT NOTE: Zig used `defer` to record the export after the body;
                    // capture default_name now and run the record after the body below.
                    let deferred_default_name = st.default_name;

                    // Rewrite this export to be:
                    // exports.default =
                    // But only if it's anonymous
                    if !HOT_MODULE_RELOADING_TRANSFORMATIONS
                        && will_transform_to_common_js
                        // TODO(port): comptime `P != bun.bundle_v2.AstBuilder` check
                        && !P::IS_AST_BUILDER
                    {
                        let expr = st.value.to_expr();
                        // Arena allocation that persists in the AST.
                        let export_default_args = p.allocator.alloc_slice_fill_default::<Expr>(2);
                        export_default_args[0] = p.module_exports(expr.loc);
                        export_default_args[1] = expr;
                        stmt = p.s(
                            S::SExpr {
                                value: p.call_runtime(
                                    expr.loc,
                                    "__exportDefault",
                                    export_default_args,
                                ),
                            },
                            expr.loc,
                        );
                    }

                    // This is defer'd so that we still record export default for identifiers
                    if let Some(ref_) = deferred_default_name.ref_ {
                        let _ = p.record_export(deferred_default_name.loc, b"default", ref_);
                    }
                }
                js_ast::StmtData::SExportClause(st) => {
                    for item in st.items.iter() {
                        p.record_export(item.alias_loc, item.alias, item.name.ref_.unwrap())?;
                    }
                }
                js_ast::StmtData::SExportStar(st) => {
                    p.import_records_for_current_part
                        .push(st.import_record_index)?;

                    if let Some(alias) = &st.alias {
                        // "export * as ns from 'path'"
                        p.named_imports.insert(
                            st.namespace_ref,
                            js_ast::NamedImport {
                                alias: None,
                                alias_is_star: true,
                                alias_loc: alias.loc,
                                namespace_ref: Ref::NONE,
                                import_record_index: st.import_record_index,
                                is_exported: true,
                                ..Default::default()
                            },
                        )?;
                        p.record_export(alias.loc, alias.original_name, st.namespace_ref)?;
                        let record =
                            &mut p.import_records.items[st.import_record_index as usize];
                        record.flags.contains_import_star = true;
                    } else {
                        // "export * from 'path'"
                        p.export_star_import_records.push(st.import_record_index)?;
                    }
                }
                js_ast::StmtData::SExportFrom(st) => {
                    p.import_records_for_current_part
                        .push(st.import_record_index)?;
                    p.named_imports
                        .reserve(st.items.len())
                        .expect("unreachable");
                    for item in st.items.iter() {
                        let ref_ = item.name.ref_.unwrap_or_else(|| {
                            p.panic("Expected export from item to have a name", ())
                        });
                        // Note that the imported alias is not item.Alias, which is the
                        // exported alias. This is somewhat confusing because each
                        // SExportFrom statement is basically SImport + SExportClause in one.
                        p.named_imports.insert(
                            ref_,
                            js_ast::NamedImport {
                                alias_is_star: false,
                                alias: Some(item.original_name),
                                alias_loc: item.name.loc,
                                namespace_ref: st.namespace_ref,
                                import_record_index: st.import_record_index,
                                is_exported: true,
                                ..Default::default()
                            },
                        )?;
                        p.record_export(item.name.loc, item.alias, ref_)?;

                        let record =
                            &mut p.import_records.items[st.import_record_index as usize];
                        if item.original_name == b"default" {
                            record.flags.contains_default_alias = true;
                        } else if item.original_name == b"__esModule" {
                            record.flags.contains_es_module_alias = true;
                        }
                    }
                }
                _ => {}
            }

            if HOT_MODULE_RELOADING_TRANSFORMATIONS {
                hot_module_reloading_context
                    .as_mut()
                    .unwrap()
                    .convert_stmt(p, stmt)?;
            } else {
                stmts[stmts_end] = stmt;
                stmts_end += 1;
            }
        }

        if !HOT_MODULE_RELOADING_TRANSFORMATIONS {
            scanner.stmts = &mut stmts[0..stmts_end];
        }

        Ok(scanner)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/ImportScanner.zig (530 lines)
//   confidence: medium
//   todos:      3
//   notes:      generic P needs trait (fields+methods+assoc consts); record/&mut p borrows split for borrowck; HMR ctx Option-wrapped; Stmt copy semantics assumed
// ──────────────────────────────────────────────────────────────────────────
