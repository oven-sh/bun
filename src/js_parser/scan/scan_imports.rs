#![allow(
    unused_imports,
    unused_variables,
    dead_code,
    unused_mut,
    clippy::needless_range_loop
)]
#![warn(unused_must_use)]
use crate::lower::lower_esm_exports_hmr::ConvertESMExportsForHmr;
use crate::p::P;
use crate::parser::{ImportItemForNamespaceMap, Ref};
use bun_ast::{self as js_ast, Binding, Expr, G, LocRef, S, Stmt, Symbol};
use bun_ast::{ImportRecord, import_record};
use bun_collections::VecExt;
use bun_core::strings;
use bun_crash_handler::handle_oom::handle_oom;

// PORT NOTE: Zig file-level struct → Rust struct. `stmts` is a sub-slice of the
// input `stmts` argument (in-place compacted), so it borrows from the caller.
#[derive(Default)]
pub struct ImportScanner<'a> {
    pub stmts: &'a mut [Stmt],
    pub kept_import_equals: bool,
    pub removed_import_equals: bool,
}

// `StoreStr` literal helper — keeps `Some(raw_str(b"…"))` ergonomic at the
// `NamedImport.alias` construction sites below.
#[inline(always)]
fn raw_str(s: &'static [u8]) -> js_ast::StoreStr {
    js_ast::StoreStr::new(s)
}

impl<'a> ImportScanner<'a> {
    // TODO(port): narrow error set
    // PORT NOTE: round-E un-gate — `<P>` unbounded generic → concrete `P<'a, TS, SCAN>`.
    // TODO(b2-ast-E): the Zig also accepts `bun.bundle_v2.AstBuilder` as P (comptime
    //   `P != AstBuilder` check). Round-E only handles the parser P; AstBuilder path
    //   needs a `ParserLike` trait or a separate monomorphization.
    pub fn scan<
        'p,
        const TYPESCRIPT: bool,
        const SCAN_ONLY: bool,
        const HOT_MODULE_RELOADING_TRANSFORMATIONS: bool,
    >(
        p: &mut P<'p, TYPESCRIPT, SCAN_ONLY>,
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
        // PORT NOTE: `arena` (p.arena) dropped — see §Allocators (AST crate).
        // Arena allocs below go through `p.arena` (a &Bump) where they persist.
        let is_typescript_enabled: bool = TYPESCRIPT;

        for i in 0..stmts.len() {
            // PORT NOTE: Zig iterated by value-copy then wrote back via index at
            // the bottom; we index directly to allow in-place mutation + reassign.
            let mut stmt = stmts[i]; // copy
            match stmt.data {
                js_ast::StmtData::SImport(mut import_ptr) => {
                    // PORT NOTE: Zig did `var st = import_ptr.*; defer import_ptr.* = st;`
                    // (copy + unconditional write-back). Equivalent to mutating in place.
                    let st: &mut S::Import = &mut *import_ptr;

                    let import_record_index = st.import_record_index;
                    // PORT NOTE: reshaped for borrowck — Zig held `record: *ImportRecord`
                    // for the whole arm; Rust can't keep a long-lived &mut alongside
                    // other `p.*` borrows. We take a raw pointer once and unsafe-deref
                    // at each use site (no operation below grows `p.import_records`, so
                    // the pointer stays valid for this iteration).
                    let record: *mut ImportRecord =
                        &raw mut p.import_records.items_mut()[import_record_index as usize];
                    // SAFETY: `record` points into `p.import_records`' backing storage;
                    // nothing in this match arm reallocates that list.
                    macro_rules! record {
                        () => {
                            unsafe { &mut *record }
                        };
                    }

                    if record!().path.namespace == crate::Macro::NAMESPACE {
                        // PORT NOTE: `Path::isMacro()` inlined (no Rust method yet).
                        record!().flags.insert(import_record::Flags::IS_UNUSED);
                        record!().path.is_disabled = true;
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
                            let symbol = &p.symbols[default_name
                                .ref_
                                .expect("infallible: ref bound")
                                .inner_index()
                                as usize];

                            // TypeScript has a separate definition of unused
                            if is_typescript_enabled
                                && p.ts_use_counts[default_name
                                    .ref_
                                    .expect("infallible: ref bound")
                                    .inner_index()
                                    as usize]
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
                            let symbol = &p.symbols[st.namespace_ref.inner_index() as usize];

                            // TypeScript has a separate definition of unused
                            if is_typescript_enabled
                                && p.ts_use_counts[st.namespace_ref.inner_index() as usize] != 0
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
                        let items: &mut [js_ast::ClauseItem] = st.items.slice_mut();
                        if !items.is_empty() {
                            found_imports = true;
                            let mut items_end: usize = 0;
                            let len = items.len();
                            for idx in 0..len {
                                let ref_ = items[idx].name.ref_.expect("infallible: ref bound");
                                let symbol = &p.symbols[ref_.inner_index() as usize];

                                // TypeScript has a separate definition of unused
                                if is_typescript_enabled
                                    && p.ts_use_counts[ref_.inner_index() as usize] != 0
                                {
                                    is_unused_in_typescript = false;
                                }

                                // Remove the symbol if it's never used outside a dead code region
                                if symbol.use_count_estimate != 0 {
                                    // PORT NOTE: ClauseItem isn't `Copy`; bitwise-move it
                                    // (its fields are all POD; arena-owned, never dropped).
                                    if items_end != idx {
                                        // SAFETY: items_end < idx < len; non-overlapping.
                                        unsafe {
                                            core::ptr::copy_nonoverlapping(
                                                items.as_ptr().add(idx),
                                                items.as_mut_ptr().add(items_end),
                                                1,
                                            );
                                        }
                                    }
                                    items_end += 1;
                                }
                            }

                            st.items.truncate(items_end);
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
                                // SAFETY: arena-owned slice; see above.
                                && st.items.slice().is_empty()
                                && st.default_name.is_none())
                        {
                            // internal imports are presumed to be always used
                            // require statements cannot be stripped
                            if !record!().flags.contains(import_record::Flags::IS_INTERNAL)
                                && !record!()
                                    .flags
                                    .contains(import_record::Flags::WAS_ORIGINALLY_REQUIRE)
                            {
                                record!().flags.insert(import_record::Flags::IS_UNUSED);
                                continue;
                            }
                        }
                    }

                    let _ = did_remove_star_loc;

                    let namespace_ref = st.namespace_ref;
                    let convert_star_to_clause = !p.options.bundle
                        && (p.symbols[namespace_ref.inner_index() as usize].use_count_estimate
                            == 0);

                    if convert_star_to_clause && !keep_unused_imports {
                        st.star_name_loc = None;
                    }

                    if st.default_name.is_some() {
                        record!()
                            .flags
                            .insert(import_record::Flags::CONTAINS_DEFAULT_ALIAS);
                    }

                    // PORT NOTE: borrow (not clone) — disjoint-field borrow vs. the
                    // `p.symbols` / `p.named_imports` / `p.declared_symbols` writes
                    // below. `None` stands in for `ImportItemForNamespaceMap.init()`.
                    let existing_items: Option<&ImportItemForNamespaceMap> =
                        p.import_items_for_namespace.get(&namespace_ref);
                    let existing_count = existing_items.map(|m| m.count()).unwrap_or(0);

                    // SAFETY: arena-owned slice; valid for AST arena lifetime.
                    let st_items: &[js_ast::ClauseItem] = st.items.slice();

                    if p.options.bundle {
                        if st.star_name_loc.is_some() && existing_count > 0 {
                            let existing = existing_items.unwrap();
                            // Map keys are Box<[u8]> that drop with the parser; copy into the
                            // AST arena so the `StoreStr` stored on NamedImport / NamespaceAlias
                            // stays valid through linking and printing.
                            let arena = p.arena;
                            let mut sorted: Vec<&[u8]> = Vec::with_capacity(existing_count);
                            for alias in existing.keys() {
                                sorted.push(arena.alloc_slice_copy(alias));
                            }
                            strings::sort_desc(&mut sorted);
                            handle_oom(p.named_imports.ensure_unused_capacity(sorted.len()));

                            // Create named imports for these property accesses. This will
                            // cause missing imports to generate useful warnings.
                            //
                            // It will also improve bundling efficiency for internal imports
                            // by still converting property accesses off the namespace into
                            // bare identifiers even if the namespace is still needed.
                            for alias in &sorted {
                                let item: LocRef = *existing.get(alias).unwrap();
                                handle_oom(p.named_imports.put(
                                    item.ref_.expect("infallible: ref bound"),
                                    js_ast::NamedImport {
                                        alias: Some(js_ast::StoreStr::new(*alias)),
                                        alias_loc: Some(item.loc),
                                        namespace_ref: Some(namespace_ref),
                                        import_record_index: st.import_record_index,
                                        local_parts_with_uses: Default::default(),
                                        alias_is_star: false,
                                        is_exported: false,
                                    },
                                ));

                                let name: LocRef = item;
                                let name_ref = name.ref_.expect("infallible: ref bound");

                                // Make sure the printer prints this as a property access
                                let symbol: &mut Symbol =
                                    &mut p.symbols[name_ref.inner_index() as usize];
                                // SAFETY: `original_name` is an arena-owned slice valid for 'p.
                                let original_name = symbol.original_name.slice();

                                symbol.namespace_alias = Some(G::NamespaceAlias {
                                    namespace_ref,
                                    alias: js_ast::StoreStr::new(*alias),
                                    import_record_index: st.import_record_index,
                                    was_originally_property_access: st.star_name_loc.is_some()
                                        && existing.contains(original_name),
                                });

                                // Also record these automatically-generated top-level namespace alias symbols
                                p.declared_symbols
                                    .append(js_ast::DeclaredSymbol {
                                        ref_: name_ref,
                                        is_top_level: true,
                                    })
                                    .expect("unreachable");
                            }
                        }

                        handle_oom(p.named_imports.ensure_unused_capacity(
                            st_items.len()
                                + usize::from(st.default_name.is_some())
                                + usize::from(st.star_name_loc.is_some()),
                        ));

                        if let Some(loc) = st.star_name_loc {
                            record!()
                                .flags
                                .insert(import_record::Flags::CONTAINS_IMPORT_STAR);
                            // PERF(port): was assume_capacity
                            p.named_imports.put_assume_capacity(
                                namespace_ref,
                                js_ast::NamedImport {
                                    alias_is_star: true,
                                    alias: Some(raw_str(b"")),
                                    alias_loc: Some(loc),
                                    namespace_ref: Some(Ref::NONE),
                                    import_record_index: st.import_record_index,
                                    local_parts_with_uses: Default::default(),
                                    is_exported: false,
                                },
                            );
                        }

                        if let Some(default) = st.default_name {
                            record!()
                                .flags
                                .insert(import_record::Flags::CONTAINS_DEFAULT_ALIAS);
                            // PERF(port): was assume_capacity
                            p.named_imports.put_assume_capacity(
                                default.ref_.expect("infallible: ref bound"),
                                js_ast::NamedImport {
                                    alias: Some(raw_str(b"default")),
                                    alias_loc: Some(default.loc),
                                    namespace_ref: Some(namespace_ref),
                                    import_record_index: st.import_record_index,
                                    local_parts_with_uses: Default::default(),
                                    alias_is_star: false,
                                    is_exported: false,
                                },
                            );
                        }

                        for item in st_items.iter() {
                            let name: LocRef = item.name;
                            let name_ref = name.ref_.expect("infallible: ref bound");

                            // PERF(port): was assume_capacity
                            p.named_imports.put_assume_capacity(
                                name_ref,
                                js_ast::NamedImport {
                                    alias: Some(item.alias),
                                    alias_loc: Some(name.loc),
                                    namespace_ref: Some(namespace_ref),
                                    import_record_index: st.import_record_index,
                                    local_parts_with_uses: Default::default(),
                                    alias_is_star: false,
                                    is_exported: false,
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
                        for item in st_items.iter() {
                            // SAFETY: `item.alias` is an arena-owned slice valid for 'p.
                            if strings::eql_comptime(item.alias.slice(), b"default") {
                                record!()
                                    .flags
                                    .insert(import_record::Flags::CONTAINS_DEFAULT_ALIAS);
                            }

                            let name: LocRef = item.name;
                            let name_ref = name.ref_.expect("infallible: ref bound");

                            p.named_imports.put(
                                name_ref,
                                js_ast::NamedImport {
                                    alias: Some(item.alias),
                                    alias_loc: Some(name.loc),
                                    namespace_ref: Some(namespace_ref),
                                    import_record_index: st.import_record_index,
                                    local_parts_with_uses: Default::default(),
                                    alias_is_star: false,
                                    is_exported: false,
                                },
                            )?;

                            // Make sure the printer prints this as a property access
                            let symbol: &mut Symbol =
                                &mut p.symbols[name_ref.inner_index() as usize];
                            if record!()
                                .flags
                                .contains(import_record::Flags::CONTAINS_IMPORT_STAR)
                                || st.star_name_loc.is_some()
                            {
                                // SAFETY: arena-owned slice valid for 'p.
                                let original_name = symbol.original_name.slice();
                                symbol.namespace_alias = Some(G::NamespaceAlias {
                                    namespace_ref,
                                    alias: item.alias,
                                    import_record_index: st.import_record_index,
                                    was_originally_property_access: st.star_name_loc.is_some()
                                        && existing_items
                                            .map(|m| m.contains(original_name))
                                            .unwrap_or(false),
                                });
                            }
                        }

                        if record!()
                            .flags
                            .contains(import_record::Flags::WAS_ORIGINALLY_REQUIRE)
                        {
                            let symbol = &mut p.symbols[namespace_ref.inner_index() as usize];
                            symbol.namespace_alias = Some(G::NamespaceAlias {
                                namespace_ref,
                                alias: js_ast::StoreStr::EMPTY,
                                import_record_index: st.import_record_index,
                                was_originally_property_access: false,
                            });
                        }
                    }

                    p.import_records_for_current_part
                        .push(st.import_record_index);

                    if st.star_name_loc.is_some() {
                        record!()
                            .flags
                            .insert(import_record::Flags::CONTAINS_IMPORT_STAR);
                    }
                    if st.default_name.is_some() {
                        record!()
                            .flags
                            .insert(import_record::Flags::CONTAINS_DEFAULT_ALIAS);
                    }

                    for item in st_items.iter() {
                        // SAFETY: arena-owned slice valid for 'p.
                        let alias = item.alias.slice();
                        if strings::eql_comptime(alias, b"default") {
                            record!()
                                .flags
                                .insert(import_record::Flags::CONTAINS_DEFAULT_ALIAS);
                        }
                        if strings::eql_comptime(alias, b"__esModule") {
                            record!()
                                .flags
                                .insert(import_record::Flags::CONTAINS_ES_MODULE_ALIAS);
                        }
                    }
                }

                js_ast::StmtData::SFunction(st) => {
                    if st.func.flags.contains(bun_ast::flags::Function::IsExport) {
                        if let Some(name) = st.func.name {
                            // SAFETY: arena-owned slice valid for 'p.
                            let original_name: &'p [u8] = p.symbols
                                [name.ref_.expect("infallible: ref bound").inner_index() as usize]
                                .original_name
                                .slice();
                            p.record_export(
                                name.loc,
                                original_name,
                                name.ref_.expect("infallible: ref bound"),
                            )?;
                        } else {
                            p.log().add_range_error(
                                Some(p.source),
                                bun_ast::Range {
                                    loc: st.func.open_parens_loc,
                                    len: 2,
                                },
                                b"Exported functions must have a name",
                            );
                        }
                    }
                }
                js_ast::StmtData::SClass(st) => {
                    if st.is_export {
                        if let Some(name) = st.class.class_name {
                            // SAFETY: arena-owned slice valid for 'p.
                            let original_name: &'p [u8] = p.symbols
                                [name.ref_.expect("infallible: ref bound").inner_index() as usize]
                                .original_name
                                .slice();
                            p.record_export(
                                name.loc,
                                original_name,
                                name.ref_.expect("infallible: ref bound"),
                            )?;
                        } else {
                            p.log().add_range_error(
                                Some(p.source),
                                bun_ast::Range {
                                    loc: st.class.body_loc,
                                    len: 0,
                                },
                                b"Exported classes must have a name",
                            );
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
                    if st.was_ts_import_equals && !st.is_export && st.decls.len_u32() > 0 {
                        let decl = &st.decls.slice()[0];

                        // Skip to the underlying reference
                        let mut value: Option<Expr> = decl.value;
                        if decl.value.is_some() {
                            while let js_ast::ExprData::EDot(dot) = value.unwrap().data {
                                value = Some(dot.target);
                            }
                        }

                        // Is this an identifier reference and not a require() call?
                        if let Some(val) = value {
                            if let js_ast::ExprData::EIdentifier(id) = val.data {
                                // Is this import statement unused?
                                if let js_ast::b::B::BIdentifier(b_id) = decl.binding.data {
                                    let b_id_ref = b_id.r#ref;
                                    if p.symbols[b_id_ref.inner_index() as usize].use_count_estimate
                                        == 0
                                    {
                                        p.ignore_usage(id.ref_);

                                        scanner.removed_import_equals = true;
                                        continue;
                                    } else {
                                        scanner.kept_import_equals = true;
                                    }
                                } else {
                                    scanner.kept_import_equals = true;
                                }
                            }
                        }
                    }
                }
                js_ast::StmtData::SExportDefault(mut st) => {
                    // PORT NOTE: Zig used `defer` to record the export after the body;
                    // capture default_name now and run the record after the body below.
                    let deferred_default_name = st.default_name;

                    // Rewrite this export to be:
                    // exports.default =
                    // But only if it's anonymous
                    // PORT NOTE: comptime `P != bun.bundle_v2.AstBuilder` check elided —
                    // this monomorphization is the parser `P` only (see fn-level TODO).
                    // blocked_on: P::module_exports gated (reconciler-6 re-gate in P.rs)
                    if !HOT_MODULE_RELOADING_TRANSFORMATIONS && will_transform_to_common_js {
                        let expr = core::mem::take(&mut st.value).to_expr();
                        // Arena allocation that persists in the AST.
                        let export_default_args = p.arena.alloc_slice_fill_default::<Expr>(2);
                        export_default_args[0] = p.module_exports(expr.loc);
                        export_default_args[1] = expr;
                        let args = js_ast::ExprNodeList::from_arena_slice(export_default_args);
                        let value = p.call_runtime(expr.loc, b"__exportDefault", args);
                        stmt = p.s(
                            S::SExpr {
                                value,
                                does_not_affect_tree_shaking: false,
                            },
                            expr.loc,
                        );
                    }
                    let _ = &mut st;

                    // This is defer'd so that we still record export default for identifiers
                    if let Some(ref_) = deferred_default_name.ref_ {
                        let _ = p.record_export(deferred_default_name.loc, b"default", ref_);
                    }
                }
                js_ast::StmtData::SExportClause(st) => {
                    // SAFETY: arena-owned slice valid for 'p.
                    for item in st.items.slice().iter() {
                        // SAFETY: arena-owned alias slice valid for 'p.
                        let alias: &'p [u8] = item.alias.slice();
                        p.record_export(
                            item.alias_loc,
                            alias,
                            item.name.ref_.expect("infallible: ref bound"),
                        )?;
                    }
                }
                js_ast::StmtData::SExportStar(st) => {
                    p.import_records_for_current_part
                        .push(st.import_record_index);

                    if let Some(alias) = &st.alias {
                        // "export * as ns from 'path'"
                        p.named_imports.put(
                            st.namespace_ref,
                            js_ast::NamedImport {
                                alias: None,
                                alias_is_star: true,
                                alias_loc: Some(alias.loc),
                                namespace_ref: Some(Ref::NONE),
                                import_record_index: st.import_record_index,
                                is_exported: true,
                                local_parts_with_uses: Default::default(),
                            },
                        )?;
                        let original: &'p [u8] = alias.original_name.slice();
                        p.record_export(alias.loc, original, st.namespace_ref)?;
                        p.import_records.items_mut()[st.import_record_index as usize]
                            .flags
                            .insert(import_record::Flags::CONTAINS_IMPORT_STAR);
                    } else {
                        // "export * from 'path'"
                        p.export_star_import_records.push(st.import_record_index);
                    }
                }
                js_ast::StmtData::SExportFrom(st) => {
                    p.import_records_for_current_part
                        .push(st.import_record_index);
                    // SAFETY: arena-owned slice valid for 'p.
                    let items = st.items.slice();
                    p.named_imports
                        .ensure_unused_capacity(items.len())
                        .expect("unreachable");
                    for item in items.iter() {
                        let ref_ = item.name.ref_.unwrap_or_else(|| {
                            p.panic("Expected export from item to have a name", format_args!(""))
                        });
                        // Note that the imported alias is not item.Alias, which is the
                        // exported alias. This is somewhat confusing because each
                        // SExportFrom statement is basically SImport + SExportClause in one.
                        p.named_imports.put(
                            ref_,
                            js_ast::NamedImport {
                                alias_is_star: false,
                                alias: Some(item.original_name),
                                alias_loc: Some(item.name.loc),
                                namespace_ref: Some(st.namespace_ref),
                                import_record_index: st.import_record_index,
                                is_exported: true,
                                local_parts_with_uses: Default::default(),
                            },
                        )?;
                        // SAFETY: arena-owned alias slice valid for 'p.
                        let alias: &'p [u8] = item.alias.slice();
                        p.record_export(item.name.loc, alias, ref_)?;

                        let record =
                            &mut p.import_records.items_mut()[st.import_record_index as usize];
                        // SAFETY: arena-owned slice valid for 'p.
                        let original = item.original_name.slice();
                        if strings::eql_comptime(original, b"default") {
                            record
                                .flags
                                .insert(import_record::Flags::CONTAINS_DEFAULT_ALIAS);
                        } else if strings::eql_comptime(original, b"__esModule") {
                            record
                                .flags
                                .insert(import_record::Flags::CONTAINS_ES_MODULE_ALIAS);
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

// ported from: src/js_parser/ast/ImportScanner.zig
