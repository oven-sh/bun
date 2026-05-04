use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::HashMap;
use bun_js_parser as js_ast;
use bun_js_parser::{B, Dependency, E, Expr, G, Part, Ref, S, Stmt};
use bun_logger as Logger;
use bun_logger::Loc;
use bun_str::strings;

use crate::{BundleV2, ImportData, Index, LinkerContext, RefImportData, ResolvedExports};

pub use crate::ThreadPool;

impl LinkerContext {
    /// Step 5: Create namespace exports for every file. This is always necessary
    /// for CommonJS files, and is also necessary for other files if they are
    /// imported using an import star statement.
    pub fn do_step5(&mut self, source_index_: Index, _: usize) {
        let source_index = source_index_.get();
        let _trace = bun_core::perf::trace("Bundler.CreateNamespaceExports");

        let id = source_index;
        if id as usize >= self.graph.meta.len() {
            return;
        }

        // SAFETY: self points to BundleV2.linker
        let bundle_v2 = unsafe {
            &mut *((self as *mut LinkerContext as *mut u8)
                .sub(core::mem::offset_of!(BundleV2, linker))
                .cast::<BundleV2>())
        };
        let worker = ThreadPool::Worker::get(bundle_v2);
        // PORT NOTE: `defer worker.unget()` — Worker::get returns an RAII guard that ungets on Drop.

        // we must use this allocator here
        let allocator: &Arena = worker.allocator();

        let resolved_exports: &mut ResolvedExports =
            &mut self.graph.meta.items_mut().resolved_exports[id as usize];

        // Now that all exports have been resolved, sort and filter them to create
        // something we can iterate over later.
        let mut aliases =
            bumpalo::collections::Vec::<&[u8]>::with_capacity_in(resolved_exports.count(), allocator);
        // PERF(port): was initCapacity catch unreachable
        let imports_to_bind = self.graph.meta.items().imports_to_bind;
        let probably_typescript_type = self.graph.meta.items().probably_typescript_type;

        // counting in here saves us an extra pass through the array
        let mut re_exports_count: usize = 0;

        {
            let mut alias_iter = resolved_exports.iterator();
            'next_alias: while let Some(entry) = alias_iter.next() {
                let export_ = *entry.value_ptr;
                let alias = *entry.key_ptr;
                let this_id = export_.data.source_index.get();
                let mut inner_count: usize = 0;
                // Re-exporting multiple symbols with the same name causes an ambiguous
                // export. These names cannot be used and should not end up in generated code.
                if export_.potentially_ambiguous_export_star_refs.len > 0 {
                    let main = imports_to_bind[this_id as usize]
                        .get(export_.data.import_ref)
                        .copied()
                        .unwrap_or(ImportData { data: export_.data, ..Default::default() });
                    for ambig in export_.potentially_ambiguous_export_star_refs.slice() {
                        let _id = ambig.data.source_index.get();
                        let ambig_ref =
                            if let Some(bound) = imports_to_bind[_id as usize].get(ambig.data.import_ref) {
                                bound.data.import_ref
                            } else {
                                ambig.data.import_ref
                            };
                        if !main.data.import_ref.eql(ambig_ref) {
                            continue 'next_alias;
                        }
                        inner_count += ambig.re_exports.len as usize;
                    }
                }

                // Ignore re-exported imports in TypeScript files that failed to be
                // resolved. These are probably just type-only imports so the best thing to
                // do is to silently omit them from the export list.
                if probably_typescript_type[this_id as usize].contains(export_.data.import_ref) {
                    continue;
                }
                re_exports_count += inner_count;

                aliases.push(alias);
                // PERF(port): was appendAssumeCapacity
            }
        }
        // TODO: can this be u32 instead of a string?
        // if yes, we could just move all the hidden exports to the end of the array
        // and only store a count instead of an array
        strings::sort_desc(aliases.as_mut_slice());
        let export_aliases = aliases.into_bump_slice();
        self.graph.meta.items_mut().sorted_and_filtered_export_aliases[id as usize] = export_aliases;

        // Export creation uses "sortedAndFilteredExportAliases" so this must
        // come second after we fill in that array
        self.create_exports_for_file(
            allocator,
            id,
            resolved_exports,
            imports_to_bind,
            export_aliases,
            re_exports_count,
        );

        // Each part tracks the other parts it depends on within this file
        let mut local_dependencies: HashMap<u32, u32> = HashMap::default();

        let parts_slice: &mut [Part] = self.graph.ast.items_mut().parts[id as usize].slice_mut();
        let named_imports: &mut js_ast::Ast::NamedImports =
            &mut self.graph.ast.items_mut().named_imports[id as usize];
        // PORT NOTE: reshaped for borrowck — multiple &mut into self.graph; Phase B may need to
        // split borrows or use raw pointers here.

        let our_imports_to_bind = &imports_to_bind[id as usize];
        'outer: for (part_index, part) in parts_slice.iter_mut().enumerate() {
            // Previously owned by `c.allocator()`, which is a `MimallocArena` (from
            // `BundleV2.graph.heap`).
            part.dependencies.transfer_ownership(&worker.heap);

            // Now that all files have been parsed, determine which property
            // accesses off of imported symbols are inlined enum values and
            // which ones aren't
            // PORT NOTE: reshaped for borrowck — Zig iterates keys()/values() while holding
            // a mutable getPtr into part.symbol_uses; collect refs first if needed in Phase B.
            for (ref_, properties) in part
                .import_symbol_property_uses
                .keys()
                .iter()
                .zip(part.import_symbol_property_uses.values().iter())
            {
                let use_ = part.symbol_uses.get_ptr(*ref_).unwrap();

                // Rare path: this import is a TypeScript enum
                if let Some(import_data) = our_imports_to_bind.get(*ref_) {
                    let import_ref = import_data.data.import_ref;
                    if let Some(symbol) = self.graph.symbols.get(import_ref) {
                        if symbol.kind == js_ast::Symbol::Kind::TsEnum {
                            if let Some(enum_data) = self.graph.ts_enums.get(import_ref) {
                                let mut found_non_inlined_enum = false;

                                let mut it = properties.iterator();
                                while let Some(next) = it.next() {
                                    let name = *next.key_ptr;
                                    let prop_use = next.value_ptr;

                                    if enum_data.get(name).is_none() {
                                        found_non_inlined_enum = true;
                                        use_.count_estimate += prop_use.count_estimate;
                                    }
                                }

                                if !found_non_inlined_enum {
                                    if use_.count_estimate == 0 {
                                        let _ = part.symbol_uses.swap_remove(*ref_);
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                }

                // Common path: this import isn't a TypeScript enum
                let mut it = properties.value_iterator();
                while let Some(prop_use) = it.next() {
                    use_.count_estimate += prop_use.count_estimate;
                }
            }

            // TODO: inline function calls here

            // TODO: Inline cross-module constants
            // if (c.graph.const_values.count() > 0) {
            //     // First, find any symbol usage that points to a constant value.
            //     // This will be pretty rare.
            //     const first_constant_i: ?usize = brk: {
            //         for (part.symbol_uses.keys(), 0..) |ref, j| {
            //             if (c.graph.const_values.contains(ref)) {
            //                 break :brk j;
            //             }
            //         }
            //
            //         break :brk null;
            //     };
            //     if (first_constant_i) |j| {
            //         var end_i: usize = 0;
            //         // symbol_uses is an array
            //         var keys = part.symbol_uses.keys()[j..];
            //         var values = part.symbol_uses.values()[j..];
            //         for (keys, values) |ref, val| {
            //             if (c.graph.const_values.contains(ref)) {
            //                 continue;
            //             }
            //
            //             keys[end_i] = ref;
            //             values[end_i] = val;
            //             end_i += 1;
            //         }
            //         part.symbol_uses.entries.len = end_i + j;
            //
            //         if (part.symbol_uses.entries.len == 0 and part.can_be_removed_if_unused) {
            //             part.tag = .dead_due_to_inlining;
            //             part.dependencies.len = 0;
            //             continue :outer;
            //         }
            //
            //         part.symbol_uses.reIndex(allocator) catch unreachable;
            //     }
            // }
            if false {
                break 'outer;
            } // this `if` is here to preserve the unused
              //                          block label from the above commented code.

            // Now that we know this, we can determine cross-part dependencies
            for (j, ref_) in part.symbol_uses.keys().iter().enumerate() {
                if cfg!(debug_assertions) {
                    debug_assert!(part.symbol_uses.values()[j].count_estimate > 0);
                }

                let other_parts = self.top_level_symbols_to_parts(id, *ref_);

                for &other_part_index in other_parts {
                    let local = local_dependencies.get_or_put(other_part_index).expect("unreachable");
                    if !local.found_existing || usize::from(*local.value_ptr) != part_index {
                        *local.value_ptr = u32::try_from(part_index).unwrap();
                        // note: if we crash on append, it is due to threadlocal heaps in mimalloc
                        part.dependencies
                            .append(
                                allocator,
                                Dependency {
                                    source_index: Index::source(source_index),
                                    part_index: other_part_index,
                                },
                            )
                            .expect("unreachable");
                    }
                }

                // Also map from imports to parts that use them
                if let Some(existing) = named_imports.get_ptr(*ref_) {
                    existing
                        .local_parts_with_uses
                        .append(allocator, u32::try_from(part_index).unwrap());
                    // PORT NOTE: bun.handleOom dropped — append aborts on OOM
                }
            }
        }
    }

    pub fn create_exports_for_file(
        &mut self,
        allocator: &Arena,
        id: u32,
        resolved_exports: &mut ResolvedExports,
        imports_to_bind: &[RefImportData],
        export_aliases: &[&[u8]],
        re_exports_count: usize,
    ) {
        ////////////////////////////////////////////////////////////////////////////////
        // WARNING: This method is run in parallel over all files. Do not mutate data
        // for other files within this method or you will create a data race.
        ////////////////////////////////////////////////////////////////////////////////

        Stmt::Disabler::disable();
        let _stmt_guard = scopeguard::guard((), |_| Stmt::Disabler::enable());
        Expr::Disabler::disable();
        let _expr_guard = scopeguard::guard((), |_| Expr::Disabler::enable());
        // TODO(port): Stmt/Expr Disabler — verify RAII shape in Phase B

        // 1 property per export
        let mut properties =
            bumpalo::collections::Vec::<G::Property>::with_capacity_in(export_aliases.len(), allocator);

        let mut ns_export_symbol_uses = Part::SymbolUseMap::default();
        ns_export_symbol_uses.ensure_total_capacity(allocator, export_aliases.len());

        let initial_flags = self.graph.meta.items().flags[id as usize];
        let needs_exports_variable = initial_flags.needs_exports_variable;
        let force_include_exports_for_entry_point = self.options.output_format == crate::options::OutputFormat::Cjs
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

        let mut stmts = js_ast::Stmt::Batcher::init(allocator, stmts_count);
        // PORT NOTE: `defer stmts.done()` handled by Drop on Batcher (Phase B: verify)
        let loc = Logger::Loc::EMPTY;
        // todo: investigate if preallocating this array is faster
        let mut ns_export_dependencies =
            bumpalo::collections::Vec::<js_ast::Dependency>::with_capacity_in(re_exports_count, allocator);
        for &alias in export_aliases {
            let mut exp = *resolved_exports.get_ptr(alias).unwrap();

            // If this is an export of an import, reference the symbol that the import
            // was eventually resolved to. We need to do this because imports have
            // already been resolved by this point, so we can't generate a new import
            // and have that be resolved later.
            if let Some(import_data) =
                imports_to_bind[exp.data.source_index.get() as usize].get(exp.data.import_ref)
            {
                exp.data.import_ref = import_data.data.import_ref;
                exp.data.source_index = import_data.data.source_index;
                ns_export_dependencies.extend_from_slice(import_data.re_exports.slice());
            }

            // Exports of imports need EImportIdentifier in case they need to be re-
            // written to a property access later on
            // note: this is stack allocated
            let value: js_ast::Expr = 'brk: {
                if let Some(symbol) = self.graph.symbols.get_const(exp.data.import_ref) {
                    if symbol.namespace_alias.is_some() {
                        break 'brk js_ast::Expr::init(
                            js_ast::E::ImportIdentifier {
                                ref_: exp.data.import_ref,
                                ..Default::default()
                            },
                            loc,
                        );
                    }
                }

                js_ast::Expr::init(
                    js_ast::E::Identifier {
                        ref_: exp.data.import_ref,
                        ..Default::default()
                    },
                    loc,
                )
            };

            let fn_body = js_ast::G::FnBody {
                stmts: stmts.eat1(js_ast::Stmt::allocate(
                    allocator,
                    js_ast::S::Return { value: Some(value) },
                    loc,
                )),
                loc,
            };
            properties.push(G::Property {
                key: Some(js_ast::Expr::allocate(
                    allocator,
                    js_ast::E::String {
                        // TODO: test emoji work as expected
                        // relevant for WASM exports
                        data: alias,
                        ..Default::default()
                    },
                    loc,
                )),
                value: Some(js_ast::Expr::allocate(
                    allocator,
                    js_ast::E::Arrow {
                        prefer_expr: true,
                        body: fn_body,
                        ..Default::default()
                    },
                    loc,
                )),
                ..Default::default()
            });
            // PERF(port): was appendAssumeCapacity
            ns_export_symbol_uses.put_assume_capacity(
                exp.data.import_ref,
                Part::SymbolUse { count_estimate: 1, ..Default::default() },
            );

            // Make sure the part that declares the export is included
            let parts = self.top_level_symbols_to_parts(exp.data.source_index.get(), exp.data.import_ref);
            ns_export_dependencies.reserve(parts.len());
            // PERF(port): was ensureUnusedCapacity catch unreachable
            debug_assert_eq!(parts.len(), parts.len()); // zip-len note (trivially equal)
            for (part_id, dest) in parts
                .iter()
                .zip(ns_export_dependencies.spare_capacity_mut()[..parts.len()].iter_mut())
            {
                // Use a non-local dependency since this is likely from a different
                // file if it came in through an export star
                dest.write(Dependency {
                    source_index: exp.data.source_index,
                    part_index: *part_id,
                });
            }
            // SAFETY: parts.len() entries were just initialized via spare_capacity_mut above
            unsafe {
                ns_export_dependencies.set_len(ns_export_dependencies.len() + parts.len());
            }
        }

        let mut declared_symbols = js_ast::DeclaredSymbol::List::default();
        let exports_ref = self.graph.ast.items().exports_ref[id as usize];
        let all_export_stmts_len = needs_exports_variable as usize
            + ((!properties.is_empty()) as usize + force_include_exports_for_entry_point as usize);
        let all_export_stmts: &mut [js_ast::Stmt] = &mut stmts.head[0..all_export_stmts_len];
        stmts.head = &mut stmts.head[all_export_stmts_len..];
        // TODO(port): borrowck — slicing stmts.head while holding all_export_stmts; Phase B may
        // need raw-pointer slicing or Batcher API change.
        let mut remaining_stmts: &mut [js_ast::Stmt] = all_export_stmts;
        let _remaining_guard = scopeguard::guard((), |_| {
            // defer bun.assert(remaining_stmts.len == 0); // all must be used
            // PORT NOTE: cannot capture remaining_stmts by ref in guard easily; assert moved below
        });

        // Prefix this part with "var exports = {}" if this isn't a CommonJS entry point
        if needs_exports_variable {
            let decls = allocator.alloc([js_ast::G::Decl {
                binding: js_ast::Binding::alloc(
                    allocator,
                    js_ast::B::Identifier { ref_: exports_ref },
                    loc,
                ),
                value: Some(js_ast::Expr::allocate(
                    allocator,
                    js_ast::E::Object::default(),
                    loc,
                )),
            }]);
            remaining_stmts[0] = js_ast::Stmt::allocate(
                allocator,
                js_ast::S::Local {
                    decls: G::Decl::List::from_owned_slice(decls),
                    ..Default::default()
                },
                loc,
            );
            remaining_stmts = &mut remaining_stmts[1..];
            declared_symbols
                .append(allocator, js_ast::DeclaredSymbol { ref_: exports_ref, is_top_level: true })
                .expect("unreachable");
        }

        // "__export(exports, { foo: () => foo })"
        let mut export_ref = Ref::NONE;
        if !properties.is_empty() {
            export_ref = self.runtime_function(b"__export");
            let args = allocator.alloc([
                js_ast::Expr::init_identifier(exports_ref, loc),
                js_ast::Expr::allocate(
                    allocator,
                    js_ast::E::Object {
                        properties: G::Property::List::move_from_list(&mut properties),
                        ..Default::default()
                    },
                    loc,
                ),
            ]);
            remaining_stmts[0] = js_ast::Stmt::allocate(
                allocator,
                js_ast::S::SExpr {
                    value: js_ast::Expr::allocate(
                        allocator,
                        js_ast::E::Call {
                            target: js_ast::Expr::init_identifier(export_ref, loc),
                            args: js_ast::ExprNodeList::from_owned_slice(args),
                            ..Default::default()
                        },
                        loc,
                    ),
                    ..Default::default()
                },
                loc,
            );
            remaining_stmts = &mut remaining_stmts[1..];
            // Make sure this file depends on the "__export" symbol
            let parts = self.top_level_symbols_to_parts_for_runtime(export_ref);
            ns_export_dependencies.reserve(parts.len());
            // PERF(port): was ensureUnusedCapacity catch unreachable
            for &part_index in parts {
                ns_export_dependencies.push(Dependency {
                    source_index: Index::RUNTIME,
                    part_index,
                });
                // PERF(port): was appendAssumeCapacity
            }

            // Make sure the CommonJS closure, if there is one, includes "exports"
            self.graph.ast.items_mut().flags[id as usize].uses_exports_ref = true;
        }

        // Decorate "module.exports" with the "__esModule" flag to indicate that
        // we used to be an ES module. This is done by wrapping the exports object
        // instead of by mutating the exports object because other modules in the
        // bundle (including the entry point module) may do "import * as" to get
        // access to the exports object and should NOT see the "__esModule" flag.
        if force_include_exports_for_entry_point {
            let to_common_js_ref = self.runtime_function(b"__toCommonJS");

            let call_args = allocator.alloc([Expr::init_identifier(exports_ref, Loc::EMPTY)]);
            remaining_stmts[0] = js_ast::Stmt::assign(
                Expr::allocate(
                    allocator,
                    E::Dot {
                        name: b"exports",
                        name_loc: Loc::EMPTY,
                        target: Expr::init_identifier(self.unbound_module_ref, Loc::EMPTY),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ),
                Expr::allocate(
                    allocator,
                    E::Call {
                        target: Expr::init_identifier(to_common_js_ref, Loc::EMPTY),
                        args: js_ast::ExprNodeList::from_owned_slice(call_args),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ),
            );
            remaining_stmts = &mut remaining_stmts[1..];
        }

        debug_assert!(remaining_stmts.is_empty()); // all must be used

        // No need to generate a part if it'll be empty
        if all_export_stmts_len > 0 {
            // - we must already have preallocated the parts array
            // - if the parts list is completely empty, we shouldn't have gotten here in the first place

            // Initialize the part that was allocated for us earlier. The information
            // here will be used after this during tree shaking.
            self.graph.ast.items_mut().parts[id as usize].slice_mut()
                [js_ast::NAMESPACE_EXPORT_PART_INDEX] = Part {
                stmts: if self.options.output_format != crate::options::OutputFormat::InternalBakeDev {
                    all_export_stmts
                } else {
                    &mut []
                },
                symbol_uses: ns_export_symbol_uses,
                dependencies: js_ast::Dependency::List::move_from_list(&mut ns_export_dependencies),
                declared_symbols,

                // This can be removed if nothing uses it
                can_be_removed_if_unused: true,

                // Make sure this is trimmed if unused even if tree shaking is disabled
                force_tree_shaking: true,

                ..Default::default()
            };

            // Pull in the "__export" symbol if it was used
            if export_ref.is_valid() {
                self.graph.meta.items_mut().flags[id as usize].needs_export_symbol_from_runtime = true;
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/doStep5.zig (509 lines)
//   confidence: medium
//   todos:      2
//   notes:      heavy overlapping &mut into self.graph (MultiArrayList items) + stmts.head reslicing will need borrowck reshaping; arena allocator threaded as &Arena; Expr/Stmt::allocate signature guessed (type param folded into value)
// ──────────────────────────────────────────────────────────────────────────
