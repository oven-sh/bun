use crate::mal_prelude::*;
use bun_collections::{VecExt, index_sort};
use core::cmp::Ordering;

use crate::bundled_ast::Flags as AstFlags;
use bun_ast::StmtData;
use bun_ast::{Part, Ref, SlotCounts};

use crate::bun_renamer as renamer;
use crate::bun_renamer::{
    ChunkRenamer, MinifyRenamer, NestedRenamer, NumberRenamer, ScopeUses, StableSymbolCount,
};
use crate::chunk::Content;
use crate::{Chunk, LinkerContext, StableRef, ThreadPool, WrapKind};

/// TODO: investigate if we need to parallelize this function
/// esbuild does parallelize it.
// CONCURRENCY: called from `LinkerContext::generate_js_renamer` (`each_ptr`
// callback) — runs on worker threads, one task per chunk.
pub(crate) fn rename_symbols_in_chunk<'a>(
    c: &LinkerContext<'_, 'a>,
    chunk: &mut Chunk,
) -> Result<ChunkRenamer<'a>, crate::Error> {
    let _trace = bun_core::perf::trace("Bundler.renameSymbolsInChunk");

    let Content::Javascript(js) = &chunk.content else {
        unreachable!("only JS chunks have a renamer");
    };
    let files_in_order: &[u32] = &js.files_in_chunk_order;
    let symbols = &c.graph.symbols;

    let ast = &c.graph.ast;
    let all_module_scopes = ast.items_module_scope();
    let all_parts = ast.items_parts();
    let all_wrapper_refs = ast.items_wrapper_ref();
    let all_import_records = ast.items_import_records();
    let ast_flags_col = ast.items_flags();
    let char_freq_col = ast.items_char_freq();
    let exports_ref_col = ast.items_exports_ref();
    let module_ref_col = ast.items_module_ref();
    let nested_slot_counts_col = ast.items_nested_scope_slot_counts();
    let all_flags = c.graph.meta.items_flags();
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

    let mut reserved_names = renamer::compute_initial_reserved_names(c.options.output_format)?;
    // Under the dev server each module reserves its own names (`run_nested_rename_task`).
    if c.dev_server.is_none() {
        for &source_index in files_in_order {
            renamer::compute_reserved_names_for_scope(
                &all_module_scopes[source_index as usize],
                symbols,
                &mut reserved_names,
            );
        }
    }

    let sorted_imports_from_other_chunks: Vec<StableRef> = {
        let imports_from_other_chunks = js.imports_from_other_chunks.values();
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

        let mut minify_renamer = MinifyRenamer::init(&first_top_level_slots, reserved_names)?;

        let mut top_level_symbols: Vec<StableSymbolCount> = Vec::new();
        let mut top_level_symbols_all: Vec<StableSymbolCount> = Vec::new();

        let stable_source_indices = c.graph.stable_source_indices.slice();
        let mut freq = bun_ast::CharFreq { freqs: [0i32; 64] };

        for &source_index in files_in_order {
            if let Some(char_freq) = &char_freq_col[source_index as usize] {
                freq.include(char_freq);
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
                    symbols,
                    &mut top_level_symbols,
                    exports_ref,
                    1,
                    stable_source_indices,
                )?;
            }
            if uses_module_ref {
                minify_renamer.accumulate_symbol_use_count(
                    symbols,
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
                    symbols,
                    &mut top_level_symbols,
                    &part.symbol_uses,
                    stable_source_indices,
                )?;

                for declared_ref in part.declared_symbols.refs() {
                    minify_renamer.accumulate_symbol_use_count(
                        symbols,
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
                symbols,
                &mut top_level_symbols,
                ref_,
                1,
                stable_source_indices,
            )?;
        }
        for &copy in entry_point_cjs_export_copies {
            minify_renamer.accumulate_symbol_use_count(
                symbols,
                &mut top_level_symbols,
                copy,
                1,
                stable_source_indices,
            )?;
        }
        top_level_symbols_all.extend_from_slice(&top_level_symbols);
        minify_renamer.allocate_top_level_symbol_slots(symbols, &top_level_symbols_all)?;

        minify_renamer.name_minifier = Some(freq.compile());
        // With code splitting, names are assigned (`MinifyRenamer::finish`)
        // after `assign_cross_chunk_names` has seen every chunk's counts and
        // pinned the bindings that cross chunks.
        if !c.graph.code_splitting {
            minify_renamer.finish()?;
        }
        return Ok(ChunkRenamer::Minify(minify_renamer));
    }

    let mut r = NumberRenamer::init(symbols, &reserved_names, files_in_order, c.renamer_rows)?;
    // Bindings that cross chunks carry one bundle-wide name
    // (`assign_cross_chunk_names`); everything else is numbered around them.
    for &ref_ in js.exports_to_other_chunks.keys() {
        if let Some(name) = c.cross_chunk_names.get(&ref_) {
            r.pin_top_level_symbol(symbols, ref_, name);
        }
    }
    for stable_ref in &sorted_imports_from_other_chunks {
        // `StableRef` is `repr(packed)`; copy the field to avoid an unaligned ref.
        let ref_ = { stable_ref.r#ref };
        if let Some(name) = c.cross_chunk_names.get(&ref_) {
            r.pin_top_level_symbol(symbols, ref_, name);
        }
    }

    // Renamed in a second pass, once every top-level symbol in the chunk is
    // in the root scope. Interleaving the passes let a nested local shadow a
    // later part's top-level symbol (#41054).
    let mut nested_scopes: Vec<(u32, *const bun_ast::Scope)> = Vec::new();

    for &source_index in files_in_order {
        // A dev server module is a closure that nothing outside refers to, like a
        // CommonJS closure. `bun build --format=internal_bake_dev` links across files.
        if c.dev_server.is_some() {
            nested_scopes.push((
                source_index,
                &raw const all_module_scopes[source_index as usize],
            ));
            continue;
        }

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
                r.add_top_level_symbol(symbols, all_wrapper_refs[source_index as usize]);

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
                                        r.add_top_level_symbol(symbols, import.namespace_ref);
                                        if let Some(default_name) = &import.default_name {
                                            if let Some(ref_) = default_name.ref_.to_nullable() {
                                                r.add_top_level_symbol(symbols, ref_);
                                            }
                                        }

                                        for item in import.items.slice() {
                                            if let Some(ref_) = item.name.ref_.to_nullable() {
                                                r.add_top_level_symbol(symbols, ref_);
                                            }
                                        }
                                    }
                                }
                                StmtData::SExportStar(export_) => {
                                    if !import_records[export_.import_record_index as usize]
                                        .source_index
                                        .is_valid()
                                    {
                                        r.add_top_level_symbol(symbols, export_.namespace_ref);
                                    }
                                }
                                StmtData::SExportFrom(export_) => {
                                    if !import_records[export_.import_record_index as usize]
                                        .source_index
                                        .is_valid()
                                    {
                                        r.add_top_level_symbol(symbols, export_.namespace_ref);

                                        for item in export_.items.slice() {
                                            if let Some(ref_) = item.name.ref_.to_nullable() {
                                                r.add_top_level_symbol(symbols, ref_);
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                nested_scopes.push((
                    source_index,
                    &raw const all_module_scopes[source_index as usize],
                ));
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
                r.add_top_level_symbol(symbols, all_wrapper_refs[source_index as usize]);
            }

            WrapKind::None => {}
        }

        let parts_live = &c.graph.parts_live[source_index as usize];
        for (part_index, part) in parts.iter().enumerate() {
            if !parts_live.is_set(part_index) {
                continue;
            }

            r.add_top_level_declared_symbols(symbols, &part.declared_symbols);
            // `part.scopes` lists every scope visited for the part; the walk
            // below recurses, so only the module scope's children go in.
            for &scope in part.scopes.iter() {
                // SAFETY: live arena-allocated scope (see below).
                let parent = unsafe { (*scope).parent };
                if parent.is_some_and(|parent| parent.parent.is_none()) {
                    nested_scopes.push((source_index, scope.cast_const()));
                }
            }
        }
    }

    // After the files, so a user binding with the same name keeps it and the
    // copy takes the numbered one.
    for &copy in entry_point_cjs_export_copies {
        r.add_top_level_symbol(symbols, copy);
    }

    chunk.nested_scopes_to_rename = nested_scopes;
    Ok(ChunkRenamer::Number(r))
}

bun_core::declare_scope!(ChunkRenamer, hidden);

/// Source index -> the file's row in its chunk's renamer. `None`: a file is in several chunks.
pub(crate) fn renamer_rows<'a>(c: &LinkerContext<'_, 'a>, chunks: &[Chunk]) -> Option<&'a [u32]> {
    let file_count = c.graph.symbols.symbols_for_source.len();
    let rows = c.arena().alloc_slice_fill_copy(file_count, u32::MAX);
    let mut next_row: u32 = 0;
    for chunk in chunks {
        let Content::Javascript(js) = &chunk.content else {
            continue;
        };
        for &source_index in js.files_in_chunk_order.iter() {
            let row = &mut rows[source_index as usize];
            if *row != u32::MAX {
                return None;
            }
            *row = next_row;
            next_row += 1;
        }
    }
    Some(rows)
}

/// What each chunk's renamer holds, on `BUN_DEBUG_ChunkRenamer=1`.
pub(crate) fn log_renamer_tables(chunks: &[Chunk]) {
    for chunk in chunks {
        if let (Content::Javascript(js), ChunkRenamer::Number(r)) = (&chunk.content, &chunk.renamer)
        {
            let (rows, name_slots) = r.table_size();
            bun_core::scoped_log!(
                ChunkRenamer,
                "{} files, {} rows, {} name slots",
                js.files_in_chunk_order.len(),
                rows,
                name_slots
            );
        }
    }
}

/// One `NestedRenamer` task: the nested scopes of one file of one chunk.
pub(crate) struct NestedRenameTask {
    pub chunk_index: u32,
    /// Range into `chunk.nested_scopes_to_rename`.
    pub scopes: core::ops::Range<u32>,
    pub names: Option<renamer::NestedNames>,
}

pub(crate) fn nested_rename_tasks(chunks: &[Chunk]) -> Vec<NestedRenameTask> {
    let mut tasks = Vec::new();
    for (chunk_index, chunk) in chunks.iter().enumerate() {
        let scopes = &chunk.nested_scopes_to_rename;
        let mut start = 0;
        for group in scopes.chunk_by(|a, b| a.0 == b.0) {
            let end = start + group.len();
            tasks.push(NestedRenameTask {
                chunk_index: chunk_index as u32,
                scopes: start as u32..end as u32,
                names: None,
            });
            start = end;
        }
    }
    tasks
}

// CONCURRENCY: `each_ptr` callback, one task per (chunk, file). Reads the
// chunk's `NumberRenamer` (complete for top-level symbols; not written until
// every task has finished) and `graph.{ast,symbols,parts_live}`; writes only
// `task.names`.
pub(crate) fn run_nested_rename_task(
    &(c, chunks): &(&LinkerContext, &[Chunk]),
    task: &mut NestedRenameTask,
    _task_index: usize,
) {
    let (chunk_index, scope_range) = (task.chunk_index, task.scopes.clone());
    let chunk = &chunks[chunk_index as usize];
    let ChunkRenamer::Number(root) = &chunk.renamer else {
        unreachable!()
    };
    let scopes =
        &chunk.nested_scopes_to_rename[scope_range.start as usize..scope_range.end as usize];
    let source_index = scopes[0].0;
    let uses = ScopeUses::new(
        source_index,
        &c.graph.ast.items_scope_uses()[source_index as usize],
        c.graph.ast.items_parts()[source_index as usize].as_slice(),
        &c.graph.parts_live[source_index as usize],
        &c.graph.symbols,
    );
    let worker = ThreadPool::Worker::get(c.bundle);
    // Made-up names go in this thread's worker arena, which lives until the
    // bundle is done.
    let mut nested = NestedRenamer::new(
        root,
        &c.cross_chunk_names,
        &uses,
        source_index,
        worker.arena(),
    );
    if c.dev_server.is_some() {
        let module_scope = &c.graph.ast.items_module_scope()[source_index as usize];
        renamer::for_each_reserved_name_in_scope(module_scope, &c.graph.symbols, &mut |name| {
            nested.reserve(name)
        });
    }
    let mut sorted: Vec<u32> = Vec::new();
    for &(_, scope) in scopes {
        // SAFETY: live arena-allocated scope (see `rename_symbols_in_chunk`).
        nested.assign_names_recursive(unsafe { &*scope }, &mut sorted);
    }
    let names = nested.into_names();
    drop(worker);
    task.names = Some(names);
}
