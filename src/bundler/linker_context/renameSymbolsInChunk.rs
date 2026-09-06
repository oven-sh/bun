use crate::mal_prelude::*;
use bun_collections::{VecExt, index_sort};
use core::cmp::Ordering;

use crate::bundled_ast::Flags as AstFlags;
use bun_ast::StmtData;
use bun_ast::symbol;
use bun_ast::{Part, Ref, SlotCounts};

use crate::bun_renamer as renamer;
use crate::bun_renamer::{
    ChunkRenamer, MinifyRenamer, NestedRenamer, NumberRenamer, ScopeUses, StableSymbolCount,
};
use crate::chunk::Content;
use crate::js_meta;
use crate::{BundleV2, Chunk, LinkerContext, StableRef, ThreadPool, WrapKind};

/// TODO: investigate if we need to parallelize this function
/// esbuild does parallelize it.
// CONCURRENCY: called from `LinkerContext::generate_js_renamer` (`each_ptr`
// callback) — runs on worker threads, one task per chunk. Writes go to
// `chunk.renamer` (per-chunk disjoint) plus per-`source_index` rows of
// `graph.ast.{module_scope, parts}` via the `NumberRenamer` path (declared-
// symbol scope assignment). `files_in_order` is the chunk's own file list;
// without code-splitting, files are partitioned across chunks so per-row
// writes are disjoint. With code-splitting a `source_index` may appear in
// multiple chunks; the writes are
// idempotent (`declared_symbols` flag set, scope-member sort) so the race is
// benign but is still a Stacked Borrows hazard. Mitigation: never
// materialize `&mut LinkerContext` (would assert whole-context exclusivity
// across N tasks); take `*mut LinkerContext` raw, deref to `&LinkerContext`
// for reads, and access SoA columns via `split_raw()` root-provenance
// pointers so per-row `&mut T` derefs do not invalidate sibling tasks'
// pointers under SB.
//
/// # Safety
/// `c` must point to a live `LinkerContext` for the duration of the call;
/// caller (the `each_ptr` dispatch) guarantees the link step outlives all
/// renamer tasks.
pub(crate) unsafe fn rename_symbols_in_chunk(
    c: *mut LinkerContext,
    chunk: &mut Chunk,
    files_in_order: &[u32],
) -> Result<ChunkRenamer, crate::Error> {
    let _trace = bun_core::perf::trace("Bundler.renameSymbolsInChunk");

    // Derive the `symbols` pointer from the raw `*mut LinkerContext` *before*
    // shadowing `c` with a shared ref, so it carries the caller's mutable
    // provenance (needed by `slice_mut()` inside `make_symbols_view`). Under
    // SB a `&raw const` through `&LinkerContext` would be SharedRO and the
    // later `*mut` cast would launder it.
    // SAFETY: `c` is live for the call (fn safety doc).
    let symbols: *mut symbol::Map = unsafe { &raw mut (*c).graph.symbols };

    // Shared-ref view for all read-only access (`c.options`,
    // `c.graph.stable_source_indices`, `c.graph.{ast,meta}.split_raw()`).
    // Multiple worker threads may hold `&LinkerContext` simultaneously; the
    // SoA buffers live behind raw pointers inside `MultiArrayList`, so this
    // borrow does not assert immutability over the heap cells written below.
    // SAFETY: see fn safety doc — `c` is live for the call.
    let c: &LinkerContext<'_> = unsafe { &*c };

    // ── raw SoA column pointers (root provenance) ────────────────────────
    // `split_raw()` derives `*mut [T]` directly from the buffer base with no
    // `&mut` intermediate, so per-column derefs here do not pop sibling
    // tasks' borrow tags under Stacked Borrows. Read-only columns are
    // deref'd to `&[T]`; the two written columns (`module_scope`, `parts`)
    // are deref'd to `&mut [T]` — see CONCURRENCY note re: code-splitting
    // overlap.
    let ast = c.graph.ast.split_raw();
    let meta = c.graph.meta.split_raw();

    // SAFETY: `split_raw()` columns are valid for `ast.len()` / `meta.len()`
    // elements; the lists do not reallocate during this function. Read-only
    // columns are deref'd to `&[T]`; the two written columns
    // (`module_scope`, `parts`) are deref'd to `&mut [T]` — see CONCURRENCY
    // note above re: code-splitting overlap. All derefs share the same
    // invariant, so they are grouped under one `unsafe` block.
    let (
        all_module_scopes,
        all_flags,
        all_parts,
        all_wrapper_refs,
        all_import_records,
        ast_flags_col,
        char_freq_col,
        exports_ref_col,
        module_ref_col,
        nested_slot_counts_col,
        cjs_export_copies_col,
    ): (_, &[js_meta::Flags], _, _, _, _, _, _, _, _, _) = unsafe {
        (
            &mut *ast.module_scope,
            &*meta.flags,
            &mut *ast.parts,
            &*ast.wrapper_ref,
            &*ast.import_records,
            &*ast.flags,
            &*ast.char_freq,
            &*ast.exports_ref,
            &*ast.module_ref,
            &*ast.nested_scope_slot_counts,
            &*meta.cjs_export_copies,
        )
    };

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

    // `symbol::Map` is not `Clone`/`Copy`. Build a non-owning shallow view via
    // `from_bump_slice` so the renamer's `Map` does not free graph storage on
    // drop.
    // SAFETY: `c.graph.symbols` outlives the returned `ChunkRenamer` (both are
    // owned by the link step). No growth is performed on the view. Raw `*mut`
    // (not `&mut`) so concurrent renamer tasks do not assert exclusive access
    // over the shared `symbol::Map` — `compute_reserved_names_for_scope` and
    // the renamer constructors only read it. (`symbols` itself is derived
    // above from the raw `*mut LinkerContext` to keep mutable provenance.)
    let make_symbols_view = |symbols: *mut symbol::Map| -> symbol::Map {
        // SAFETY: `symbols` is the live `c.graph.symbols`; we read its inner
        // slice header to build a non-owning shallow `Vec` view.
        let inner = unsafe { (*symbols).symbols_for_source.slice_mut() };
        symbol::Map {
            // SAFETY: `inner` aliases the live `c.graph.symbols` storage,
            // which outlives the returned `ChunkRenamer`; the renamer only
            // reads through this view and never grows or drops it (see the
            // closure-level note above), upholding the "no drop, no grow"
            // contract of `from_borrowed_slice_dangerous`.
            symbols_for_source: core::mem::ManuallyDrop::into_inner(unsafe {
                <Vec<_> as bun_collections::VecExt<_>>::from_borrowed_slice_dangerous(inner)
            }),
        }
    };

    let mut reserved_names = renamer::compute_initial_reserved_names(c.options.output_format)?;
    for &source_index in files_in_order {
        renamer::compute_reserved_names_for_scope(
            &all_module_scopes[source_index as usize],
            // SAFETY: `symbols` points to the live `c.graph.symbols`; read-only here.
            unsafe { &*symbols },
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
            if let Some(name) = c.cross_chunk_names.get(&ref_) {
                r.pin_top_level_symbol(ref_, name);
            }
        }
    }
    for stable_ref in &sorted_imports_from_other_chunks {
        let ref_ = { stable_ref.r#ref };
        if let Some(name) = c.cross_chunk_names.get(&ref_) {
            r.pin_top_level_symbol(ref_, name);
        }
    }
    for stable_ref in &sorted_imports_from_other_chunks {
        // `StableRef` is `repr(packed)`; copy the field to avoid an unaligned ref.
        r.add_top_level_symbol(stable_ref.r#ref);
    }

    // Renamed in a second pass, once every top-level symbol in the chunk is
    // in the root scope. Interleaving the passes let a nested local shadow a
    // later part's top-level symbol (#41054).
    let mut nested_scopes: Vec<(u32, *const bun_ast::Scope)> = Vec::new();

    for &source_index in files_in_order {
        let wrap = all_flags[source_index as usize].wrap;
        // Need `&mut [Part]` for `add_top_level_declared_symbols`.
        let parts: &mut [Part] = all_parts[source_index as usize].as_mut_slice();

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
                r.add_top_level_symbol(all_wrapper_refs[source_index as usize]);
            }

            WrapKind::None => {}
        }

        let parts_live = &c.graph.parts_live[source_index as usize];
        for (part_index, part) in parts.iter_mut().enumerate() {
            if !parts_live.is_set(part_index) {
                continue;
            }

            r.add_top_level_declared_symbols(&mut part.declared_symbols);
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
        r.add_top_level_symbol(copy);
    }

    chunk.nested_scopes_to_rename = nested_scopes;
    Ok(ChunkRenamer::Number(r))
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
    ctx: &crate::linker_context_mod::GenerateChunkCtx,
    task: *mut NestedRenameTask,
    _task_index: usize,
) {
    // SAFETY: `each_ptr` hands us a unique `*mut NestedRenameTask`; nothing
    // below re-enters it.
    let (chunk_index, scope_range) = unsafe { ((*task).chunk_index, (*task).scopes.clone()) };
    let c: &LinkerContext<'_> = &ctx.c;
    let chunk = &ctx.chunks[chunk_index as usize];
    let ChunkRenamer::Number(root) = &chunk.renamer else {
        unreachable!()
    };
    let scopes =
        &chunk.nested_scopes_to_rename[scope_range.start as usize..scope_range.end as usize];
    let source_index = scopes[0].0;
    let ast = c.graph.ast.split_raw();
    // SAFETY: read-only column views; see `rename_symbols_in_chunk`.
    let (parts, scope_uses) = unsafe {
        (
            &(&(*ast.parts))[source_index as usize],
            &(&(*ast.scope_uses))[source_index as usize],
        )
    };
    let uses = ScopeUses::new(
        source_index,
        scope_uses,
        parts.as_slice(),
        &c.graph.parts_live[source_index as usize],
        &c.graph.symbols,
    );
    // SAFETY: `c` is `BundleV2.linker`; `Worker::get` only needs `&BundleV2`.
    let bundle_v2: &BundleV2<'_> = unsafe { &*LinkerContext::bundle_v2_ptr(ctx.c.as_mut_ptr()) };
    let worker = scopeguard::guard(ThreadPool::Worker::get(bundle_v2), |w| w.unget());
    // Made-up names go in this thread's worker arena, which lives until the
    // bundle is done.
    let mut nested = NestedRenamer::new(root, &uses, source_index, &worker.arena);
    let mut sorted: Vec<u32> = Vec::new();
    for &(_, scope) in scopes {
        // SAFETY: live arena-allocated scope (see `rename_symbols_in_chunk`).
        nested.assign_names_recursive(unsafe { &*scope }, &mut sorted);
    }
    let names = nested.into_names();
    drop(worker);
    // SAFETY: as above.
    unsafe { (*task).names = Some(names) };
}
