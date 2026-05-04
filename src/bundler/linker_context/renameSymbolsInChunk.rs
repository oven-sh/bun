use bun_js_parser as js_ast;
use bun_js_parser::Part;
use bun_options_types::ImportRecord;

use crate::Chunk;
use crate::JSMeta;
use crate::LinkerContext;
use crate::Ref;
use crate::StableRef;

// TODO(port): verify crate path for `bun.renamer` (fallback rule → bun_renamer)
use bun_renamer as renamer;
use bun_renamer::MinifyRenamer;
use bun_renamer::StableSymbolCount;

/// TODO: investigate if we need to parallelize this function
/// esbuild does parallelize it.
// TODO(port): narrow error set
// TODO(port): bundler is an AST crate (PORTING.md §Allocators) — verify whether caller passes
// an arena vs default_allocator for the dropped `allocator: std.mem.Allocator` param; if arena,
// thread `bump: &'bump Bump` and switch working Vecs to bumpalo::collections::Vec<'bump, T>.
pub fn rename_symbols_in_chunk(
    c: &mut LinkerContext,
    chunk: &mut Chunk,
    files_in_order: &[u32],
) -> Result<renamer::Renamer, bun_core::Error> {
    let _trace = bun_core::perf::trace("Bundler.renameSymbolsInChunk");
    // TODO(port): MultiArrayList field-slice accessor shape (`.items(.field)` in Zig)
    let all_module_scopes = c.graph.ast.items().module_scope;
    let all_flags: &[JSMeta::Flags] = c.graph.meta.items().flags;
    let all_parts: &[Part::List] = c.graph.ast.items().parts;
    let all_wrapper_refs: &[Ref] = c.graph.ast.items().wrapper_ref;
    let all_import_records: &[ImportRecord::List] = c.graph.ast.items().import_records;

    let mut reserved_names = renamer::compute_initial_reserved_names(c.options.output_format)?;
    for &source_index in files_in_order {
        renamer::compute_reserved_names_for_scope(
            &all_module_scopes[source_index as usize],
            &c.graph.symbols,
            &mut reserved_names,
        );
    }

    let mut sorted_imports_from_other_chunks: Vec<StableRef> = {
        let mut count: u32 = 0;
        let imports_from_other_chunks = chunk.content.javascript.imports_from_other_chunks.values();
        for item in imports_from_other_chunks {
            count += item.len;
        }

        // PERF(port): Zig pre-set len and filled via slice writes; using push() here
        let mut list: Vec<StableRef> = Vec::with_capacity(count as usize);
        let stable_source_indices = &c.graph.stable_source_indices;
        for item in imports_from_other_chunks {
            for ref_ in item.slice() {
                list.push(StableRef {
                    stable_source_index: stable_source_indices[ref_.ref_.source_index() as usize],
                    ref_: ref_.ref_,
                });
            }
        }

        // TODO(port): StableRef must impl Ord matching StableRef.isLessThan
        list.sort_unstable();
        list
    };

    if c.options.minify_identifiers {
        let first_top_level_slots: js_ast::SlotCounts = {
            let mut slots = js_ast::SlotCounts::default();
            let nested_scope_slot_counts = c.graph.ast.items().nested_scope_slot_counts;
            for &i in files_in_order {
                slots.union_max(nested_scope_slot_counts[i as usize]);
            }
            slots
        };

        let mut minify_renamer =
            MinifyRenamer::init(c.graph.symbols, first_top_level_slots, reserved_names)?;

        let mut top_level_symbols: Vec<StableSymbolCount> = Vec::new();
        let mut top_level_symbols_all: Vec<StableSymbolCount> = Vec::new();

        let stable_source_indices = &c.graph.stable_source_indices;
        let mut freq = js_ast::CharFreq {
            freqs: [0i32; 64],
        };
        let ast_flags_list = c.graph.ast.items().flags;

        let mut capacity = sorted_imports_from_other_chunks.len();
        {
            let char_freqs = c.graph.ast.items().char_freq;

            for &source_index in files_in_order {
                if ast_flags_list[source_index as usize].has_char_freq {
                    freq.include(char_freqs[source_index as usize]);
                }
            }
        }

        let exports_ref_list = c.graph.ast.items().exports_ref;
        let module_ref_list = c.graph.ast.items().module_ref;
        let parts_list = c.graph.ast.items().parts;

        for &source_index in files_in_order {
            let ast_flags = ast_flags_list[source_index as usize];
            let uses_exports_ref = ast_flags.uses_exports_ref;
            let uses_module_ref = ast_flags.uses_module_ref;
            let exports_ref = exports_ref_list[source_index as usize];
            let module_ref = module_ref_list[source_index as usize];
            let parts = &parts_list[source_index as usize];

            top_level_symbols.clear();

            if uses_exports_ref {
                minify_renamer.accumulate_symbol_use_count(
                    &mut top_level_symbols,
                    exports_ref,
                    1,
                    stable_source_indices,
                )?;
            }
            if uses_module_ref {
                minify_renamer.accumulate_symbol_use_count(
                    &mut top_level_symbols,
                    module_ref,
                    1,
                    stable_source_indices,
                )?;
            }

            for part in parts.slice() {
                if !part.is_live {
                    continue;
                }

                minify_renamer.accumulate_symbol_use_counts(
                    &mut top_level_symbols,
                    &part.symbol_uses,
                    stable_source_indices,
                )?;

                for declared_ref in part.declared_symbols.refs() {
                    minify_renamer.accumulate_symbol_use_count(
                        &mut top_level_symbols,
                        *declared_ref,
                        1,
                        stable_source_indices,
                    )?;
                }
            }

            // TODO(port): StableSymbolCount must impl Ord matching StableSymbolCount.lessThan
            top_level_symbols.sort_unstable();
            capacity += top_level_symbols.len();
            top_level_symbols_all.extend_from_slice(&top_level_symbols);
        }

        top_level_symbols.clear();
        for stable_ref in &sorted_imports_from_other_chunks {
            minify_renamer.accumulate_symbol_use_count(
                &mut top_level_symbols,
                stable_ref.ref_,
                1,
                stable_source_indices,
            )?;
        }
        top_level_symbols_all.extend_from_slice(&top_level_symbols);
        minify_renamer.allocate_top_level_symbol_slots(top_level_symbols_all)?;

        let mut minifier = freq.compile();
        minify_renamer.assign_names_by_frequency(&mut minifier)?;

        return Ok(minify_renamer.to_renamer());
    }

    let mut r = renamer::NumberRenamer::init(c.graph.symbols, reserved_names)?;
    for stable_ref in &sorted_imports_from_other_chunks {
        r.add_top_level_symbol(stable_ref.ref_);
    }

    // PORT NOTE: Zig used `r.temp_allocator` for this list; allocator param dropped
    let mut sorted: Vec<u32> = Vec::new();

    for &source_index in files_in_order {
        let wrap = all_flags[source_index as usize].wrap;
        let parts: &[Part] = all_parts[source_index as usize].slice();

        match wrap {
            // Modules wrapped in a CommonJS closure look like this:
            //
            //   // foo.js
            //   var require_foo = __commonJS((exports, module) => {
            //     exports.foo = 123;
            //   });
            //
            // The symbol "require_foo" is stored in "file.ast.WrapperRef". We want
            // to be able to minify everything inside the closure without worrying
            // about collisions with other CommonJS modules. Set up the scopes such
            // that it appears as if the file was structured this way all along. It's
            // not completely accurate (e.g. we don't set the parent of the module
            // scope to this new top-level scope) but it's good enough for the
            // renaming code.
            Wrap::Cjs => {
                r.add_top_level_symbol(all_wrapper_refs[source_index as usize]);

                // External import statements will be hoisted outside of the CommonJS
                // wrapper if the output format supports import statements. We need to
                // add those symbols to the top-level scope to avoid causing name
                // collisions. This code special-cases only those symbols.
                if c.options.output_format.keep_es6_import_export_syntax() {
                    let import_records = all_import_records[source_index as usize].slice();
                    for part in parts {
                        for stmt in &part.stmts {
                            // TODO(port): verify exact Stmt data variant names in bun_js_parser
                            match &stmt.data {
                                js_ast::Stmt::Data::SImport(import) => {
                                    if !import_records[import.import_record_index as usize]
                                        .source_index
                                        .is_valid()
                                    {
                                        r.add_top_level_symbol(import.namespace_ref);
                                        if let Some(default_name) = &import.default_name {
                                            if let Some(ref_) = default_name.ref_ {
                                                r.add_top_level_symbol(ref_);
                                            }
                                        }

                                        for item in &import.items {
                                            if let Some(ref_) = item.name.ref_ {
                                                r.add_top_level_symbol(ref_);
                                            }
                                        }
                                    }
                                }
                                js_ast::Stmt::Data::SExportStar(export_) => {
                                    if !import_records[export_.import_record_index as usize]
                                        .source_index
                                        .is_valid()
                                    {
                                        r.add_top_level_symbol(export_.namespace_ref);
                                    }
                                }
                                js_ast::Stmt::Data::SExportFrom(export_) => {
                                    if !import_records[export_.import_record_index as usize]
                                        .source_index
                                        .is_valid()
                                    {
                                        r.add_top_level_symbol(export_.namespace_ref);

                                        for item in &export_.items {
                                            if let Some(ref_) = item.name.ref_ {
                                                r.add_top_level_symbol(ref_);
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                // TODO(port): borrowck — passes &r.root while r is &mut receiver
                r.assign_names_recursive_with_number_scope(
                    &r.root,
                    &all_module_scopes[source_index as usize],
                    source_index,
                    &mut sorted,
                );
                continue;
            }

            // Modules wrapped in an ESM closure look like this:
            //
            //   // foo.js
            //   var foo, foo_exports = {};
            //   __export(foo_exports, {
            //     foo: () => foo
            //   });
            //   let init_foo = __esm(() => {
            //     foo = 123;
            //   });
            //
            // The symbol "init_foo" is stored in "file.ast.WrapperRef". We need to
            // minify everything inside the closure without introducing a new scope
            // since all top-level variables will be hoisted outside of the closure.
            Wrap::Esm => {
                r.add_top_level_symbol(all_wrapper_refs[source_index as usize]);
            }

            _ => {}
        }

        for part in parts {
            if !part.is_live {
                continue;
            }

            r.add_top_level_declared_symbols(&part.declared_symbols);
            for scope in &part.scopes {
                // TODO(port): borrowck — passes &r.root while r is &mut receiver
                r.assign_names_recursive_with_number_scope(&r.root, scope, source_index, &mut sorted);
            }
            // TODO(port): was `@TypeOf(r.number_scope_pool.hive.used).initEmpty()` — reset HiveArray used-bitset
            r.number_scope_pool.hive.used.clear();
        }
    }

    // PORT NOTE: reshaped for borrowck — drop `sorted_imports_from_other_chunks` before move-out of r
    drop(sorted_imports_from_other_chunks);

    Ok(r.to_renamer())
}

pub use crate::DeferredBatchTask;
pub use crate::ThreadPool;
pub use crate::ParseTask;

// TODO(port): `Wrap` enum lives on JSMeta.Flags; verify path
use crate::JSMeta::Wrap;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/renameSymbolsInChunk.zig (276 lines)
//   confidence: medium
//   todos:      9
//   notes:      MultiArrayList .items(.field) accessor shape unresolved; bundler is an AST crate — allocator param dropped pending Phase B arena-vs-default verification; borrowck reshaping needed for &r.root with &mut r; StableRef/StableSymbolCount need Ord impls
// ──────────────────────────────────────────────────────────────────────────
