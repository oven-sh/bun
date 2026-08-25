//! Step 5 of `scan_imports_and_exports`: create namespace exports for every
//! file, one worker task per file. Each task owns its file's row of the
//! columns it writes ([`Step5Row`]) and shares the rest read-only
//! ([`Step5Shared`]).

use crate::mal_prelude::*;

use bun_alloc::Arena as Bump;
use bun_ast::Loc;
use bun_collections::{HashMap, VecExt};
use bun_core::strings;

use crate::bundled_ast::Flags as AstFlags;
use bun_ast::symbol::Use as SymbolUse;
use bun_ast::{
    Binding, DeclaredSymbol, DeclaredSymbolList, Dependency, E, Expr, G, Part, PartSymbolUseMap,
    Ref, S, Stmt,
};

use crate::options::Format;
use crate::perf;
use crate::{Index, LinkerContext, LinkerGraph, RefImportData, ResolvedExports, js_meta};

/// One file's row of every column step 5 writes.
pub(crate) struct Step5Row<'r, 'a> {
    id: u32,
    resolved_exports: &'r mut ResolvedExports,
    sorted_and_filtered_export_aliases: &'r mut js_meta::SortedAndFilteredExportAliases,
    meta_flags: &'r mut js_meta::Flags,
    ast_flags: &'r mut AstFlags,
    parts: &'r mut bun_ast::PartList<'a>,
    named_imports: &'r mut crate::bundled_ast::NamedImports,
}

// SAFETY: a row is handed to exactly one pool task, which is the only code
// touching those columns' `id` entries until `do_step5` has joined; the
// `!Send` inside (`Part::scopes`' raw scope pointers) is arena data no task
// frees.
unsafe impl Send for Step5Row<'_, '_> {}

/// What step 5's tasks read: whole columns other than the ones in
/// [`Step5Row`], plus the symbol table and options.
#[derive(Clone, Copy)]
pub(crate) struct Step5Shared<'r, 'a> {
    pool: &'r crate::ThreadPool<'a>,
    options: &'r crate::linker_context_mod::LinkerOptions,
    symbols: &'r bun_ast::symbol::Map,
    ts_enums: &'r bun_ast::ast_result::TsEnumsMap,
    unbound_module_ref: Ref,
    imports_to_bind: &'r [RefImportData],
    probably_typescript_type: &'r [js_meta::ProbablyTypescriptType],
    tlsp_overlay: &'r [bun_ast::ast_result::TopLevelSymbolToParts],
    tlsp_ast: &'r [bun_ast::ast_result::TopLevelSymbolToParts],
    exports_ref: &'r [Ref],
    named_exports: &'r [crate::bundled_ast::NamedExports],
}

// SAFETY: shared by step 5's tasks while the bundle thread is blocked joining
// them; everything but `pool` (built for cross-thread use) is read-only for
// the step — the columns a task writes are handed to it separately as its
// `Step5Row`.
unsafe impl Sync for Step5Shared<'_, '_> {}
// SAFETY: as above.
unsafe impl Send for Step5Shared<'_, '_> {}

impl Step5Shared<'_, '_> {
    #[inline]
    fn top_level_symbols_to_parts(&self, id: u32, ref_: Ref) -> &[u32] {
        crate::linker_graph::top_level_symbol_to_parts(self.tlsp_overlay, self.tlsp_ast, id, ref_)
    }
    #[inline]
    fn top_level_symbols_to_parts_for_runtime(&self, ref_: Ref) -> &[u32] {
        self.top_level_symbols_to_parts(Index::RUNTIME.get(), ref_)
    }
    #[inline]
    fn runtime_function(&self, name: &[u8]) -> Ref {
        crate::linker_graph::runtime_function(self.named_exports, name)
    }
}

/// Step 5: Create namespace exports for every file. This is always necessary
/// for CommonJS files, and is also necessary for other files if they are
/// imported using an import star statement. Blocks until every file is done.
pub(crate) fn do_step5<'a>(
    this: &mut LinkerContext<'a>,
    pool: &crate::ThreadPool<'a>,
    reachable: &[Index],
) {
    let LinkerContext {
        graph,
        options,
        unbound_module_ref,
        ..
    } = this;
    let LinkerGraph {
        ast,
        meta,
        symbols,
        ts_enums,
        ..
    } = graph;
    let ast = ast.split_mut();
    let meta = meta.split_mut();
    let shared = Step5Shared {
        pool,
        options,
        symbols,
        ts_enums,
        unbound_module_ref: *unbound_module_ref,
        imports_to_bind: &*meta.imports_to_bind,
        probably_typescript_type: &*meta.probably_typescript_type,
        tlsp_overlay: &*meta.top_level_symbol_to_parts_overlay,
        tlsp_ast: &*ast.top_level_symbols_to_parts,
        exports_ref: &*ast.exports_ref,
        named_exports: &*ast.named_exports,
    };
    let meta_len = meta.flags.len();
    let mut is_reachable = bun_collections::DynamicBitSet::init_empty(meta_len).expect("OOM");
    for index in reachable {
        if (index.get() as usize) < meta_len {
            is_reachable.set(index.get() as usize);
        }
    }
    let mut rows: Vec<Step5Row<'_, 'a>> = meta
        .resolved_exports
        .iter_mut()
        .zip(meta.sorted_and_filtered_export_aliases.iter_mut())
        .zip(meta.flags.iter_mut())
        .zip(ast.flags.iter_mut())
        .zip(ast.parts.iter_mut())
        .zip(ast.named_imports.iter_mut())
        .enumerate()
        .filter(|(id, _)| is_reachable.is_set(*id))
        .map(
            |(
                id,
                (((((resolved_exports, aliases), meta_flags), ast_flags), parts), named_imports),
            )| {
                Step5Row {
                    id: id as u32,
                    resolved_exports,
                    sorted_and_filtered_export_aliases: aliases,
                    meta_flags,
                    ast_flags,
                    parts,
                    named_imports,
                }
            },
        )
        .collect();
    pool.worker_pool()
        .each_mut(shared, |c, row, _| step5_for_file(c, row), &mut rows);
}

/// Worker-thread body of [`do_step5`] for one file.
fn step5_for_file(c: &Step5Shared<'_, '_>, row: &mut Step5Row<'_, '_>) {
    let source_index = row.id;
    let _trace = perf::trace("Bundler.CreateNamespaceExports");
    let id = source_index;

    let worker = c.pool.get_worker();
    // we must use this arena here
    let arena: &Bump = worker.arena();

    let imports_to_bind = c.imports_to_bind;
    let probably_typescript_type = c.probably_typescript_type;
    let resolved_exports: &mut ResolvedExports = row.resolved_exports;
    // counting in here saves us an extra pass through the array
    let mut re_exports_count: usize = 0;

    {
        // Now that all exports have been resolved, sort and filter them to create
        // something we can iterate over later.
        let mut aliases =
            bun_alloc::ArenaVec::<&[u8]>::with_capacity_in(resolved_exports.count(), arena);

        {
            let mut alias_iter = resolved_exports.iterator();
            'next_alias: while let Some(entry) = alias_iter.next() {
                let export_ = entry.value_ptr;
                let alias: &[u8] = entry.key_ptr;
                let this_id = export_.data.source_index.get();
                let mut inner_count: usize = 0;
                // Re-exporting multiple symbols with the same name causes an ambiguous
                // export. These names cannot be used and should not end up in generated code.
                if export_.potentially_ambiguous_export_star_refs.len() > 0 {
                    let main_data =
                        match imports_to_bind[this_id as usize].get(&export_.data.import_ref) {
                            Some(b) => b.data,
                            None => export_.data,
                        };
                    for ambig in export_.potentially_ambiguous_export_star_refs.slice() {
                        let _id = ambig.data.source_index.get();
                        let ambig_ref = if let Some(bound) =
                            imports_to_bind[_id as usize].get(&ambig.data.import_ref)
                        {
                            bound.data.import_ref
                        } else {
                            ambig.data.import_ref
                        };
                        if main_data.import_ref != ambig_ref {
                            continue 'next_alias;
                        }
                        inner_count += ambig.re_exports.len() as usize;
                    }
                }

                // Ignore re-exported imports in TypeScript files that failed to be
                // resolved. These are probably just type-only imports so the best thing to
                // do is to silently omit them from the export list.
                if probably_typescript_type[this_id as usize].contains(&export_.data.import_ref) {
                    continue;
                }
                re_exports_count += inner_count;

                aliases.push(alias);
            }
        }
        // TODO: can this be u32 instead of a string?
        // if yes, we could just move all the hidden exports to the end of the array
        // and only store a count instead of an array
        strings::sort_asc(aliases.as_mut_slice());
        *row.sorted_and_filtered_export_aliases = bun_alloc::AstAlloc::vec_from_iter(
            aliases
                .iter()
                .map(|s| bun_alloc::AstAlloc::vec_from_slice(s).into_boxed_slice()),
        );
        drop(aliases);
    }
    let export_aliases = &**row.sorted_and_filtered_export_aliases;

    // Export creation uses "sortedAndFilteredExportAliases" so this must
    // come second after we fill in that array
    create_exports_for_file(
        c,
        arena,
        id,
        resolved_exports,
        imports_to_bind,
        export_aliases,
        re_exports_count,
        row.meta_flags,
        row.ast_flags,
        row.parts,
    );

    {
        // Each part tracks the other parts it depends on within this file
        let mut local_dependencies: HashMap<u32, u32> = HashMap::default();

        let named_imports: &mut crate::bundled_ast::NamedImports = row.named_imports;
        // Hoisted so the per-symbol-use inner loop skips the lookup entirely
        // for files with no imports (≈ all leaf modules).
        let named_imports_is_empty = named_imports.is_empty();

        // PERF: hoist this file's two `top_level_symbols_to_parts`
        // sub-maps rather than going through
        // `c.topLevelSymbolsToParts(id, ref)` per symbol-use — perf showed
        // `find_hash` falling through to the linear scan branch here (≈87% of
        // step5 self-time on three.js), so hoist the per-file lookups out of
        // the J×K inner loop.
        let tlsp_overlay: &bun_ast::ast_result::TopLevelSymbolToParts =
            &c.tlsp_overlay[id as usize];
        let tlsp_ast: &bun_ast::ast_result::TopLevelSymbolToParts = &c.tlsp_ast[id as usize];

        let our_imports_to_bind: &RefImportData = &imports_to_bind[id as usize];
        for (part_index, part) in row.parts.as_mut_slice().iter_mut().enumerate() {
            // Now that all files have been parsed, determine which property
            // accesses off of imported symbols are inlined enum values and
            // which ones aren't
            // We cannot iterate keys()/values() while
            // holding a mutable pointer into part.symbol_uses; collect refs first.
            // PERF: the property-use map is empty for the overwhelming
            // majority of parts (it only fills for `import * as ns`/enum
            // property accesses); skip the `to_vec()` alloc-round-trip in
            // that case.
            let prop_use_refs: Vec<Ref> = match part.import_symbol_property_uses.as_ref() {
                None => Vec::new(),
                Some(m) => m.keys().to_vec(),
            };
            for ref_ in &prop_use_refs {
                // `import_symbol_property_uses` and `symbol_uses` are separate
                // fields of the part.
                let Part {
                    import_symbol_property_uses,
                    symbol_uses,
                    ..
                } = &mut *part;
                let properties = import_symbol_property_uses
                    .as_ref()
                    .unwrap()
                    .get(ref_)
                    .unwrap();
                let use_: &mut SymbolUse = symbol_uses.get_ptr_mut(ref_).unwrap();

                // Rare path: this import is a TypeScript enum
                if let Some(import_data) = our_imports_to_bind.get(ref_) {
                    let import_ref = import_data.data.import_ref;
                    if let Some(symbol) = c.symbols.get_const(import_ref) {
                        if symbol.kind == bun_ast::symbol::Kind::TsEnum {
                            if let Some(enum_data) = c.ts_enums.get(&import_ref) {
                                let mut found_non_inlined_enum = false;

                                for (name, prop_use) in properties.iter() {
                                    if enum_data.get(name).is_none() {
                                        found_non_inlined_enum = true;
                                        use_.count_estimate += prop_use.count_estimate;
                                    }
                                }

                                if !found_non_inlined_enum {
                                    if use_.count_estimate == 0 {
                                        let _ = symbol_uses.swap_remove(ref_);
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                }

                // Common path: this import isn't a TypeScript enum
                for prop_use in properties.values() {
                    use_.count_estimate += prop_use.count_estimate;
                }
            }

            // TODO: inline function calls here

            // TODO: Inline cross-module constants

            // Now that we know this, we can determine cross-part dependencies
            // PERF: iterate the keys slice directly (the index-based
            // form re-loaded `keys.len()` and bounds-checked each access).
            let part_index_u32 = part_index as u32;
            let dependencies = &mut part.dependencies;
            for &ref_ in part.symbol_uses.keys() {
                debug_assert!({
                    let j = part
                        .symbol_uses
                        .keys()
                        .iter()
                        .position(|k| *k == ref_)
                        .unwrap();
                    part.symbol_uses.values()[j].count_estimate > 0
                });

                // Inlined `c.top_level_symbols_to_parts(id, ref_)` against the
                // hoisted per-file maps so the column pointer math (and the
                // `&LinkerContext` deref) is out of the inner loop.
                let other_parts: &[u32] = if let Some(overlay) = tlsp_overlay.get(&ref_) {
                    overlay.as_slice()
                } else if let Some(list) = tlsp_ast.get(&ref_) {
                    list.as_slice()
                } else {
                    &[]
                };

                for &other_part_index in other_parts {
                    let local = local_dependencies
                        .get_or_put(other_part_index)
                        .expect("unreachable");
                    if !local.found_existing || *local.value_ptr != part_index_u32 {
                        *local.value_ptr = part_index_u32;
                        // note: if we crash on append, it is due to threadlocal heaps in mimalloc
                        dependencies.push(Dependency {
                            source_index: bun_ast::Index::source(source_index as usize),
                            part_index: other_part_index,
                        });
                    }
                }

                // Also map from imports to parts that use them
                if !named_imports_is_empty {
                    if let Some(existing) = named_imports.get_ptr_mut(&ref_) {
                        existing.local_parts_with_uses.push(part_index_u32);
                    }
                }
            }
        }
    }
}

/// WARNING: This is run in parallel over all files. Everything written is a
/// parameter (this file's row); `c` is read-only.
#[allow(clippy::too_many_arguments)]
fn create_exports_for_file(
    c: &Step5Shared<'_, '_>,
    arena: &Bump,
    id: u32,
    resolved_exports: &mut ResolvedExports,
    imports_to_bind: &[RefImportData],
    export_aliases: &[Box<[u8], bun_alloc::AstAlloc>],
    re_exports_count: usize,
    meta_flags: &mut js_meta::Flags,
    ast_flags: &mut AstFlags,
    ast_parts: &mut bun_ast::PartList,
) {
    {
        // `Stmt.Disabler`/`Expr.Disabler` are debug-only guards
        // around the global thread-local block store. `Disabler::scope()`
        // calls `disable()` and re-`enable()`s on drop. In debug builds the
        // disabler only fires when `Store::append` falls through to that
        // global slab — i.e. when no `ASTMemoryAllocator` scope is installed.
        // Bundler workers always install one (`Worker::get` pushes
        // `ast_memory_store`), so appends in this step — including
        // `Stmt::assign` below — route to the worker allocator and bypass the
        // check entirely. The guard
        // exists to catch accidental global-slab use if this code ever runs
        // without that allocator installed.
        let _stmt_guard = bun_ast::stmt::Disabler::scope();
        let _expr_guard = bun_ast::expr::Disabler::scope();

        // 1 property per export
        let mut properties =
            bun_alloc::ArenaVec::<G::Property>::with_capacity_in(export_aliases.len(), arena);

        let mut ns_export_symbol_uses = PartSymbolUseMap::default();
        ns_export_symbol_uses
            .ensure_total_capacity(export_aliases.len())
            .expect("OOM");

        let initial_flags = *meta_flags;
        let needs_exports_variable = initial_flags.needs_exports_variable;
        let force_include_exports_for_entry_point = c.options.output_format == Format::Cjs
            && initial_flags.force_include_exports_for_entry_point;

        let stmts_count =
            // 1 statement for every export
            export_aliases.len() +
            // + 1 if there are non-zero exports
            (!export_aliases.is_empty()) as usize +
            // + 1 if we need to inject the exports variable
            needs_exports_variable as usize +
            // + 1 if we need to do module.exports = __toCommonJS(exports)
            force_include_exports_for_entry_point as usize;

        // One arena slab of `stmts_count` statements, handed out front to
        // back: one per export getter body, then the tail window for the part.
        let stmts_slab: &mut [Stmt] = arena.alloc_slice_fill_with(stmts_count, |_| Stmt::empty());
        let mut stmts_head: usize = 0;
        macro_rules! stmts_eat1 {
            ($value:expr) => {{
                let written: &mut Stmt = &mut stmts_slab[stmts_head];
                *written = $value;
                stmts_head += 1;
                bun_ast::StoreSlice::new_mut(core::slice::from_mut(written))
            }};
        }
        let loc = Loc::EMPTY;
        // todo: investigate if preallocating this array is faster
        let mut ns_export_dependencies = bun_ast::DependencyList::init_capacity(re_exports_count);
        for alias in export_aliases {
            let alias: &[u8] = alias;
            let exp = resolved_exports.get_mut(alias).unwrap();
            let mut exp_data = exp.data;

            // If this is an export of an import, reference the symbol that the import
            // was eventually resolved to. We need to do this because imports have
            // already been resolved by this point, so we can't generate a new import
            // and have that be resolved later.
            if let Some(import_data) =
                imports_to_bind[exp_data.source_index.get() as usize].get(&exp_data.import_ref)
            {
                exp_data.import_ref = import_data.data.import_ref;
                exp_data.source_index = import_data.data.source_index;
                ns_export_dependencies.append_slice(import_data.re_exports.slice());
            }

            // Exports of imports need EImportIdentifier in case they need to be re-
            // written to a property access later on
            // note: this is stack allocated
            let value: Expr = 'brk: {
                if let Some(symbol) = c.symbols.get_const(exp_data.import_ref) {
                    if symbol.namespace_alias.is_some() {
                        break 'brk Expr::init(
                            E::ImportIdentifier {
                                ref_: exp_data.import_ref,
                                ..Default::default()
                            },
                            loc,
                        );
                    }
                }

                Expr::init(
                    E::Identifier {
                        ref_: exp_data.import_ref,
                        ..Default::default()
                    },
                    loc,
                )
            };

            let fn_body = G::FnBody {
                stmts: stmts_eat1!(Stmt::allocate(arena, S::Return { value: Some(value) }, loc,)),
                loc,
            };
            properties.push(G::Property {
                key: Some(Expr::allocate(
                    arena,
                    // TODO: test emoji work as expected (relevant for WASM exports)
                    E::String::init(alias),
                    loc,
                )),
                value: Some(Expr::allocate(
                    arena,
                    E::Arrow {
                        prefer_expr: true,
                        body: fn_body,
                        ..Default::default()
                    },
                    loc,
                )),
                ..Default::default()
            });
            ns_export_symbol_uses
                .put_assume_capacity(exp_data.import_ref, SymbolUse { count_estimate: 1 });

            // Make sure the part that declares the export is included
            let parts =
                c.top_level_symbols_to_parts(exp_data.source_index.get(), exp_data.import_ref);
            ns_export_dependencies.ensure_unused_capacity(parts.len());
            for &part_id in parts {
                // Use a non-local dependency since this is likely from a different
                // file if it came in through an export star
                ns_export_dependencies.append_assume_capacity(Dependency {
                    source_index: bun_ast::Index::source(exp_data.source_index.get() as usize),
                    part_index: part_id,
                });
            }
        }

        let mut declared_symbols = DeclaredSymbolList::default();
        let exports_ref = c.exports_ref[id as usize];
        let all_export_stmts_len = needs_exports_variable as usize
            + (!properties.is_empty()) as usize
            + force_include_exports_for_entry_point as usize;
        // The trailing `all_export_stmts_len` slots of `stmts_slab`
        // (after the per-export `eat1`s above) are filled below in the order
        // {var exports={}, __export(...), module.exports=__toCommonJS(...)}.
        let all_export_stmts_base = stmts_head;
        macro_rules! emit_export_stmt {
            ($value:expr) => {{
                stmts_slab[stmts_head] = $value;
                stmts_head += 1;
            }};
        }

        // Prefix this part with "var exports = {}" if this isn't a CommonJS entry point
        if needs_exports_variable {
            emit_export_stmt!(Stmt::allocate(
                arena,
                S::Local {
                    decls: G::DeclList::from_slice(&[G::Decl {
                        binding: Binding::alloc(
                            arena,
                            bun_ast::b::Identifier { r#ref: exports_ref },
                            loc,
                        ),
                        value: Some(Expr::allocate(arena, E::Object::default(), loc)),
                    }]),
                    ..Default::default()
                },
                loc,
            ));
            declared_symbols
                .append(DeclaredSymbol {
                    ref_: exports_ref,
                    is_top_level: true,
                })
                .expect("unreachable");
        }

        // "__export(exports, { foo: () => foo })"
        let mut export_ref = Ref::NONE;
        if !properties.is_empty() {
            export_ref = c.runtime_function(b"__export");
            // `bumpalo::Vec` → `Vec` via the global heap;
            // `G::PropertyList` is `Vec<Property>` and currently has no
            // arena-backed `move_from_list`, so re-own.
            let mut owned_props: Vec<G::Property> = Vec::with_capacity(properties.len());
            owned_props.extend(properties.drain(..));
            emit_export_stmt!(Stmt::allocate(
                arena,
                S::SExpr {
                    value: Expr::allocate(
                        arena,
                        E::Call {
                            target: Expr::init_identifier(export_ref, loc),
                            args: bun_ast::ExprNodeList::from_slice(&[
                                Expr::init_identifier(exports_ref, loc),
                                Expr::allocate(
                                    arena,
                                    E::Object {
                                        properties: G::PropertyList::move_from_list(owned_props),
                                        ..Default::default()
                                    },
                                    loc,
                                ),
                            ]),
                            ..Default::default()
                        },
                        loc,
                    ),
                    ..Default::default()
                },
                loc,
            ));
            // Make sure this file depends on the "__export" symbol
            let parts = c.top_level_symbols_to_parts_for_runtime(export_ref);
            ns_export_dependencies.ensure_unused_capacity(parts.len());
            for &part_index in parts {
                ns_export_dependencies.append_assume_capacity(Dependency {
                    source_index: bun_ast::Index::RUNTIME,
                    part_index,
                });
            }

            // Make sure the CommonJS closure, if there is one, includes "exports"
            ast_flags.insert(AstFlags::USES_EXPORTS_REF);
        }

        // Decorate "module.exports" with the "__esModule" flag to indicate that
        // we used to be an ES module. This is done by wrapping the exports object
        // instead of by mutating the exports object because other modules in the
        // bundle (including the entry point module) may do "import * as" to get
        // access to the exports object and should NOT see the "__esModule" flag.
        if force_include_exports_for_entry_point {
            let to_common_js_ref = c.runtime_function(b"__toCommonJS");
            emit_export_stmt!(Stmt::assign(
                Expr::allocate(
                    arena,
                    E::Dot {
                        name: b"exports".into(),
                        name_loc: Loc::EMPTY,
                        target: Expr::init_identifier(c.unbound_module_ref, Loc::EMPTY),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ),
                Expr::allocate(
                    arena,
                    E::Call {
                        target: Expr::init_identifier(to_common_js_ref, Loc::EMPTY),
                        args: bun_ast::ExprNodeList::from_slice(&[Expr::init_identifier(
                            exports_ref,
                            Loc::EMPTY,
                        )]),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ),
            ));
        }

        debug_assert_eq!(stmts_head - all_export_stmts_base, all_export_stmts_len); // all must be used

        // No need to generate a part if it'll be empty
        if all_export_stmts_len > 0 {
            // - we must already have preallocated the parts array
            // - if the parts list is completely empty, we shouldn't have gotten here in the first place

            // Initialize the part that was allocated for us earlier. The information
            // here will be used after this during tree shaking.
            ast_parts.as_mut_slice()[bun_ast::NAMESPACE_EXPORT_PART_INDEX as usize] = Part {
                stmts: if c.options.output_format != Format::InternalBakeDev {
                    let init = &mut stmts_slab[all_export_stmts_base..stmts_head];
                    debug_assert_eq!(init.len(), all_export_stmts_len);
                    bun_ast::StoreSlice::new_mut(init)
                } else {
                    bun_ast::StoreSlice::EMPTY
                },
                symbol_uses: ns_export_symbol_uses,
                dependencies: ns_export_dependencies,
                declared_symbols,

                // This can be removed if nothing uses it
                can_be_removed_if_unused: true,

                // Make sure this is trimmed if unused even if tree shaking is disabled
                force_tree_shaking: true,

                ..Default::default()
            };

            // Pull in the "__export" symbol if it was used
            if export_ref.is_valid() {
                meta_flags.needs_export_symbol_from_runtime = true;
            }
        }
    }
}
