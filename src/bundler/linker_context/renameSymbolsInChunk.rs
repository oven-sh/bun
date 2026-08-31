use crate::mal_prelude::*;
use bun_collections::{VecExt, index_sort};
use core::cmp::Ordering;

use crate::bundled_ast::Flags as AstFlags;
use bun_ast::StmtData;
use bun_ast::symbol;
use bun_ast::{Part, Ref, SlotCounts};

use crate::bun_renamer as renamer;
use crate::bun_renamer::{ChunkRenamer, MinifyRenamer, NumberRenamer, StableSymbolCount};
use crate::chunk::Content;
use crate::js_meta;
use crate::{Chunk, LinkerContext, StableRef, WrapKind};

/// TODO: investigate if we need to parallelize this function
/// esbuild does parallelize it.
/// Runs on a pool thread, one task per chunk (`generate_js_renamer`): reads
/// the linker graph and builds the chunk's renamer.
pub(crate) fn rename_symbols_in_chunk(
    c: &LinkerContext<'_>,
    chunk: &Chunk,
    files_in_order: &[u32],
) -> Result<ChunkRenamer, crate::Error> {
    let _trace = bun_core::perf::trace("Bundler.renameSymbolsInChunk");

    let symbols: &symbol::Map = &c.graph.symbols;
    let ast = c.graph.ast.slice();
    let all_module_scopes = ast.items_module_scope();
    let all_flags: &[js_meta::Flags] = c.graph.meta.items_flags();
    let all_parts = ast.items_parts();
    let all_wrapper_refs = ast.items_wrapper_ref();
    let all_import_records = ast.items_import_records();
    let ast_flags_col = ast.items_flags();
    let char_freq_col = ast.items_char_freq();
    let exports_ref_col = ast.items_exports_ref();
    let module_ref_col = ast.items_module_ref();
    let nested_slot_counts_col = ast.items_nested_scope_slot_counts();

    let cjs_export_copies_col = c.graph.meta.items_cjs_export_copies();

    // An entry point chunk ends with `generate_entry_point_tail_js`, which
    // declares a copy binding (`var export_foo = import_cjs.foo`) for each
    // re-export that resolves to a CommonJS property. The tail is printed with
    // this chunk's renamer, so those bindings are numbered like the chunk's
    // other top-level symbols. Otherwise the copy prints under its original
    // name and can redeclare another binding with that name: a user binding,
    // an unbound global, or another copy whose alias formats to the same
    // identifier (`"x-y"` and `"x.y"` both give `export_x_y`).
    let entry_point_cjs_export_copies: &[Ref] = if chunk.entry_point.is_entry_point() {
        &cjs_export_copies_col[chunk.entry_point.source_index() as usize]
    } else {
        &[]
    };

    // `symbol::Map` is not `Clone`/`Copy`. Build a non-owning shallow view so
    // the renamer's `Map` does not free graph storage on drop.
    let make_symbols_view = |symbols: &symbol::Map| -> symbol::Map {
        symbol::Map {
            // SAFETY: `inner` aliases the live `c.graph.symbols` storage,
            // which outlives the returned `ChunkRenamer`; the renamer only
            // reads through this view and never grows or drops it (it holds
            // it in `ManuallyDrop`), upholding the "no drop, no grow"
            // contract of `from_borrowed_slice_dangerous`.
            symbols_for_source: core::mem::ManuallyDrop::into_inner(unsafe {
                <Vec<_> as bun_collections::VecExt<_>>::from_borrowed_slice_dangerous(
                    symbols.symbols_for_source.slice(),
                )
            }),
        }
    };

    let mut reserved_names = renamer::compute_initial_reserved_names(c.options.output_format)?;
    for &source_index in files_in_order {
        renamer::compute_reserved_names_for_scope(
            &all_module_scopes[source_index as usize],
            symbols,
            &mut reserved_names,
        );
    }

    let sorted_imports_from_other_chunks: Vec<StableRef> = {
        let imports_from_other_chunks = match &chunk.content {
            Content::Javascript(js) => js.imports_from_other_chunks.values(),
            // Only JS chunks reach `rename_symbols_in_chunk`.
            _ => &[],
        };
        let mut count: u32 = 0;
        for item in imports_from_other_chunks {
            count += item.len() as u32;
        }

        let mut list: Vec<StableRef> = Vec::with_capacity(count as usize);
        let stable_source_indices = c.graph.stable_source_indices.slice();
        for item in imports_from_other_chunks {
            for ref_ in item.slice() {
                list.push(StableRef {
                    stable_source_index: stable_source_indices[ref_.r#ref.source_index() as usize],
                    r#ref: ref_.r#ref,
                });
            }
        }

        index_sort::sort_slice_unstable_by(&mut list, |a, b| {
            if StableRef::is_less_than((), *a, *b) {
                Ordering::Less
            } else if StableRef::is_less_than((), *b, *a) {
                Ordering::Greater
            } else {
                Ordering::Equal
            }
        });
        list
    };

    if c.options.minify_identifiers {
        let first_top_level_slots: SlotCounts = {
            let mut slots = SlotCounts::default();
            for &i in files_in_order {
                slots.union_max(nested_slot_counts_col[i as usize]);
            }
            slots
        };

        let mut minify_renamer = MinifyRenamer::init(
            make_symbols_view(symbols),
            &first_top_level_slots,
            reserved_names,
        )?;

        let mut top_level_symbols: Vec<StableSymbolCount> = Vec::new();
        let mut top_level_symbols_all: Vec<StableSymbolCount> = Vec::new();

        let stable_source_indices = c.graph.stable_source_indices.slice();
        let mut freq = bun_ast::CharFreq { freqs: [0i32; 64] };

        for &source_index in files_in_order {
            if ast_flags_col[source_index as usize].contains(AstFlags::HAS_CHAR_FREQ) {
                freq.include(&char_freq_col[source_index as usize]);
            }
        }

        for &source_index in files_in_order {
            let ast_flags = ast_flags_col[source_index as usize];
            let uses_exports_ref = ast_flags.contains(AstFlags::USES_EXPORTS_REF);
            let uses_module_ref = ast_flags.contains(AstFlags::USES_MODULE_REF);
            let exports_ref = exports_ref_col[source_index as usize];
            let module_ref = module_ref_col[source_index as usize];
            let parts = &all_parts[source_index as usize];

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

            let parts_live = &c.graph.parts_live[source_index as usize];
            for (part_index, part) in parts.as_slice().iter().enumerate() {
                if !parts_live.is_set(part_index) {
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

            top_level_symbols.sort_unstable_by(StableSymbolCount::less_than);
            top_level_symbols_all.extend_from_slice(&top_level_symbols);
        }

        top_level_symbols.clear();
        for stable_ref in &sorted_imports_from_other_chunks {
            // `StableRef` is `repr(packed)`; copy the field to avoid an unaligned ref.
            let ref_ = { stable_ref.r#ref };
            minify_renamer.accumulate_symbol_use_count(
                &mut top_level_symbols,
                ref_,
                1,
                stable_source_indices,
            )?;
        }
        for &copy in entry_point_cjs_export_copies {
            minify_renamer.accumulate_symbol_use_count(
                &mut top_level_symbols,
                copy,
                1,
                stable_source_indices,
            )?;
        }
        top_level_symbols_all.extend_from_slice(&top_level_symbols);
        minify_renamer.allocate_top_level_symbol_slots(&top_level_symbols_all)?;

        minify_renamer.name_minifier = Some(freq.compile());
        // With code splitting, names are assigned (`MinifyRenamer::finish`)
        // after `assign_cross_chunk_names` has seen every chunk's counts and
        // pinned the bindings that cross chunks.
        if !c.graph.code_splitting {
            minify_renamer.finish()?;
        }
        return Ok(ChunkRenamer::Minify(minify_renamer));
    }

    let mut r = NumberRenamer::init(make_symbols_view(symbols), &reserved_names)?;
    // Bindings that cross chunks carry one bundle-wide name
    // (`assign_cross_chunk_names`); everything else is numbered around them.
    if let Content::Javascript(js) = &chunk.content {
        for &ref_ in js.exports_to_other_chunks.keys() {
            if let Some(name) = c.cross_chunk_names.get(&ref_).map(|n| n.slice()) {
                r.pin_top_level_symbol(ref_, name);
            }
        }
    }
    for stable_ref in &sorted_imports_from_other_chunks {
        let ref_ = { stable_ref.r#ref };
        if let Some(name) = c.cross_chunk_names.get(&ref_).map(|n| n.slice()) {
            r.pin_top_level_symbol(ref_, name);
        }
    }
    for stable_ref in &sorted_imports_from_other_chunks {
        // `StableRef` is `repr(packed)`; copy the field to avoid an unaligned ref.
        r.add_top_level_symbol(stable_ref.r#ref);
    }

    let mut sorted: Vec<u32> = Vec::new();

    for &source_index in files_in_order {
        let wrap = all_flags[source_index as usize].wrap;
        let parts: &[Part] = all_parts[source_index as usize].as_slice();

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
            WrapKind::Cjs => {
                r.add_top_level_symbol(all_wrapper_refs[source_index as usize]);

                // External import statements will be hoisted outside of the CommonJS
                // wrapper if the output format supports import statements. We need to
                // add those symbols to the top-level scope to avoid causing name
                // collisions. This code special-cases only those symbols.
                if c.options.output_format.keep_es6_import_export_syntax() {
                    let import_records = all_import_records[source_index as usize].as_slice();
                    for part in parts.iter() {
                        for stmt in part.stmts.slice() {
                            match stmt.data {
                                StmtData::SImport(import) => {
                                    if !import_records[import.import_record_index as usize]
                                        .source_index
                                        .is_valid()
                                    {
                                        r.add_top_level_symbol(import.namespace_ref);
                                        if let Some(default_name) = &import.default_name {
                                            if let Some(ref_) = default_name.ref_.to_nullable() {
                                                r.add_top_level_symbol(ref_);
                                            }
                                        }

                                        for item in import.items.slice() {
                                            if let Some(ref_) = item.name.ref_.to_nullable() {
                                                r.add_top_level_symbol(ref_);
                                            }
                                        }
                                    }
                                }
                                StmtData::SExportStar(export_) => {
                                    if !import_records[export_.import_record_index as usize]
                                        .source_index
                                        .is_valid()
                                    {
                                        r.add_top_level_symbol(export_.namespace_ref);
                                    }
                                }
                                StmtData::SExportFrom(export_) => {
                                    if !import_records[export_.import_record_index as usize]
                                        .source_index
                                        .is_valid()
                                    {
                                        r.add_top_level_symbol(export_.namespace_ref);

                                        for item in export_.items.slice() {
                                            if let Some(ref_) = item.name.ref_.to_nullable() {
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
                // Reshaped for borrowck — `&mut r.root` while `r` is the
                // `&mut self` receiver. Take a raw pointer; `assign_names_*` does
                // not touch `self.root` through `self`.
                let root: *mut renamer::NumberScope = core::ptr::addr_of_mut!(r.root);
                r.assign_names_recursive_with_number_scope(
                    root,
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
            WrapKind::Esm => {
                r.add_top_level_symbol(all_wrapper_refs[source_index as usize]);
            }

            WrapKind::None => {}
        }

        let parts_live = &c.graph.parts_live[source_index as usize];
        for (part_index, part) in parts.iter().enumerate() {
            if !parts_live.is_set(part_index) {
                continue;
            }

            r.add_top_level_declared_symbols(&part.declared_symbols);
            // `Part.scopes: StoreSlice<*mut Scope>` — safe `Deref` to `&[*mut Scope]`.
            for scope in part.scopes.iter() {
                let root: *mut renamer::NumberScope = core::ptr::addr_of_mut!(r.root);
                // SAFETY: each `*mut Scope` is a valid arena-allocated scope.
                r.assign_names_recursive_with_number_scope(
                    root,
                    unsafe { &**scope },
                    source_index,
                    &mut sorted,
                );
            }
            r.number_scope_pool.hive.used = bun_collections::hive_array::HiveBitSet::init_empty();
        }
    }

    // After the files, so a user binding with the same name keeps it and the
    // copy takes the numbered one.
    for &copy in entry_point_cjs_export_copies {
        r.add_top_level_symbol(copy);
    }

    Ok(ChunkRenamer::Number(r))
}
