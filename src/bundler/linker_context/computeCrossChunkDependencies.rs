use bun_collections::{ArrayHashMap, BabyList};
use bun_js_parser as js_ast;
use bun_js_parser::{Part, Symbol};
use bun_logger as Logger;
use bun_options_types::ImportRecord;
use bun_renamer as renamer;

use crate::linker_context::{debug, ChunkMeta, LinkerContext};
use crate::{
    Chunk, CrossChunkImport, Index, JSMeta, Ref, RefImportData, ResolvedExports, StableRef,
};

pub fn compute_cross_chunk_dependencies(
    c: &mut LinkerContext,
    chunks: &mut [Chunk],
) -> Result<(), bun_alloc::AllocError> {
    if !c.graph.code_splitting {
        // No need to compute cross-chunk dependencies if there can't be any
        return Ok(());
    }

    // these must be global allocator
    let mut chunk_metas: Vec<ChunkMeta> = (0..chunks.len())
        .map(|_| ChunkMeta {
            imports: ChunkMeta::Map::default(),
            exports: ChunkMeta::Map::default(),
            dynamic_imports: ArrayHashMap::<Index::Int, ()>::default(),
        })
        .collect();
    // defer { meta.*.deinit(); free(chunk_metas) } — handled by Drop

    {
        // PORT NOTE: Zig heap-allocated this via c.allocator().create() and destroyed it at
        // scope end; in Rust we construct on the stack and let it drop.
        let mut cross_chunk_dependencies = CrossChunkDependencies {
            chunks,
            chunk_meta: &mut chunk_metas,
            parts: c.graph.ast.items(.parts),
            import_records: c.graph.ast.items(.import_records),
            flags: c.graph.meta.items(.flags),
            entry_point_chunk_indices: c.graph.files.items(.entry_point_chunk_index),
            imports_to_bind: c.graph.meta.items(.imports_to_bind),
            wrapper_refs: c.graph.ast.items(.wrapper_ref),
            exports_refs: c.graph.ast.items(.exports_ref),
            sorted_and_filtered_export_aliases: c.graph.meta.items(.sorted_and_filtered_export_aliases),
            resolved_exports: c.graph.meta.items(.resolved_exports),
            ctx: c,
            symbols: &mut c.graph.symbols,
        };
        // TODO(port): the field initializers above borrow `c` immutably (via .items()) and
        // mutably (ctx, symbols) at the same time; Phase B will need to restructure (e.g.
        // split-borrow `c.graph` first, or pass raw column pointers as Zig does).

        c.parse_graph
            .pool
            .worker_pool
            .each_ptr(
                &mut cross_chunk_dependencies,
                CrossChunkDependencies::walk,
                chunks,
            )
            .expect("unreachable");
        // TODO(port): `each_ptr` runs `walk` concurrently across worker threads with a shared
        // `&mut CrossChunkDependencies`. In Zig this is permitted; in Rust the shared-mutable
        // access (symbols.assignChunkIndex, chunk_meta[i] writes, import_records[i] writes)
        // needs UnsafeCell / raw pointers or a different parallel API.
    }

    compute_cross_chunk_dependencies_with_chunk_metas(c, chunks, &mut chunk_metas)
}

pub struct CrossChunkDependencies<'a> {
    chunk_meta: &'a mut [ChunkMeta],
    chunks: &'a [Chunk],
    parts: &'a [BabyList<Part>],
    import_records: &'a mut [BabyList<ImportRecord>],
    flags: &'a [JSMeta::Flags],
    entry_point_chunk_indices: &'a [Index::Int],
    imports_to_bind: &'a [RefImportData],
    wrapper_refs: &'a [Ref],
    exports_refs: &'a [Ref],
    // TODO(port): verify column element type from LinkerGraph.meta — Zig: []const []const string
    sorted_and_filtered_export_aliases: &'a [&'a [&'a [u8]]],
    resolved_exports: &'a [ResolvedExports],
    ctx: &'a LinkerContext,
    symbols: &'a mut Symbol::Map,
}

impl<'a> CrossChunkDependencies<'a> {
    pub fn walk(&mut self, chunk: &mut Chunk, chunk_index: usize) {
        let deps = self;
        let chunk_meta = &mut deps.chunk_meta[chunk_index];
        // PORT NOTE: reshaped for borrowck — Zig held `&chunk_meta` and `&chunk_meta.imports`
        // simultaneously; here we go through `chunk_meta.imports` / `chunk_meta.dynamic_imports`.
        let entry_point_chunk_indices = deps.entry_point_chunk_indices;

        // Go over each file in this chunk
        for &source_index in chunk.files_with_parts_in_chunk.keys() {
            // TODO: make this switch
            if chunk.content == .css {
                continue;
            }
            if chunk.content != .javascript {
                continue;
            }
            // TODO(port): `chunk.content` is a tagged union; replace the two checks above with
            // `match chunk.content { Content::Javascript(..) => {}, _ => continue }` once the
            // Chunk::Content enum is ported.

            // Go over each part in this file that's marked for inclusion in this chunk
            let parts = deps.parts[source_index].slice();
            let import_records = deps.import_records[source_index].slice_mut();
            let imports_to_bind = &deps.imports_to_bind[source_index];
            let wrap = deps.flags[source_index].wrap;
            let wrapper_ref = deps.wrapper_refs[source_index];
            let _chunks = deps.chunks;

            for part in parts.iter() {
                if !part.is_live {
                    continue;
                }

                // Rewrite external dynamic imports to point to the chunk for that entry point
                for &import_record_id in part.import_record_indices.slice() {
                    let import_record = &mut import_records[import_record_id as usize];
                    if import_record.source_index.is_valid()
                        && deps
                            .ctx
                            .is_external_dynamic_import(import_record, source_index)
                    {
                        let other_chunk_index =
                            entry_point_chunk_indices[import_record.source_index.get() as usize];
                        import_record.path.text =
                            _chunks[other_chunk_index as usize].unique_key.clone();
                        // TODO(port): Zig assigns the slice by pointer (no copy); decide
                        // ownership of `path.text` vs `unique_key` in Phase B.
                        import_record.source_index = Index::invalid();

                        // Track this cross-chunk dynamic import so we make sure to
                        // include its hash when we're calculating the hashes of all
                        // dependencies of this chunk.
                        if other_chunk_index as usize != chunk_index {
                            chunk_meta.dynamic_imports.put(other_chunk_index, ());
                        }
                    }
                }

                // Remember what chunk each top-level symbol is declared in. Symbols
                // with multiple declarations such as repeated "var" statements with
                // the same name should already be marked as all being in a single
                // chunk. In that case this will overwrite the same value below which
                // is fine.
                deps.symbols
                    .assign_chunk_index(&part.declared_symbols, chunk_index as u32);

                let used_refs = part.symbol_uses.keys();

                // Record each symbol used in this part. This will later be matched up
                // with our map of which chunk a given symbol is declared in to
                // determine if the symbol needs to be imported from another chunk.
                for &ref_ in used_refs {
                    let ref_to_use = 'brk: {
                        let mut ref_to_use = ref_;
                        let mut symbol = deps.symbols.get_const(ref_to_use).unwrap();

                        // Ignore unbound symbols
                        if symbol.kind == Symbol::Kind::Unbound {
                            continue;
                        }

                        // Ignore symbols that are going to be replaced by undefined
                        if symbol.import_item_status == Symbol::ImportItemStatus::Missing {
                            continue;
                        }

                        // If this is imported from another file, follow the import
                        // reference and reference the symbol in that file instead
                        if let Some(import_data) = imports_to_bind.get(ref_to_use) {
                            ref_to_use = import_data.data.import_ref;
                            symbol = deps.symbols.get_const(ref_to_use).unwrap();
                        } else if wrap == JSMeta::Wrap::Cjs && ref_to_use.eql(wrapper_ref) {
                            // The only internal symbol that wrapped CommonJS files export
                            // is the wrapper itself.
                            continue;
                        }

                        // If this is an ES6 import from a CommonJS file, it will become a
                        // property access off the namespace symbol instead of a bare
                        // identifier. In that case we want to pull in the namespace symbol
                        // instead. The namespace symbol stores the result of "require()".
                        if let Some(namespace_alias) = &symbol.namespace_alias {
                            ref_to_use = namespace_alias.namespace_ref;
                        }
                        break 'brk ref_to_use;
                    };

                    if cfg!(debug_assertions) {
                        debug!(
                            "Cross-chunk import: {} {:?}",
                            bstr::BStr::new(&deps.symbols.get(ref_to_use).unwrap().original_name),
                            ref_to_use,
                        );
                    }

                    // We must record this relationship even for symbols that are not
                    // imports. Due to code splitting, the definition of a symbol may
                    // be moved to a separate chunk than the use of a symbol even if
                    // the definition and use of that symbol are originally from the
                    // same source file.
                    chunk_meta.imports.put(ref_to_use, ());
                }
            }
        }

        // Include the exports if this is an entry point chunk
        if chunk.content == .javascript {
            // TODO(port): tagged-union check; see note above.
            if chunk.entry_point.is_entry_point {
                let flags = deps.flags[chunk.entry_point.source_index as usize];
                if flags.wrap != JSMeta::Wrap::Cjs {
                    let resolved_exports =
                        &deps.resolved_exports[chunk.entry_point.source_index as usize];
                    let sorted_and_filtered_export_aliases = deps
                        .sorted_and_filtered_export_aliases
                        [chunk.entry_point.source_index as usize];
                    for alias in sorted_and_filtered_export_aliases {
                        let export_ = resolved_exports.get(alias).unwrap();
                        let mut target_ref = export_.data.import_ref;

                        // If this is an import, then target what the import points to
                        if let Some(import_data) = deps.imports_to_bind
                            [export_.data.source_index.get() as usize]
                            .get(target_ref)
                        {
                            target_ref = import_data.data.import_ref;
                        }

                        // If this is an ES6 import from a CommonJS file, it will become a
                        // property access off the namespace symbol instead of a bare
                        // identifier. In that case we want to pull in the namespace symbol
                        // instead. The namespace symbol stores the result of "require()".
                        if let Some(namespace_alias) =
                            &deps.symbols.get_const(target_ref).unwrap().namespace_alias
                        {
                            target_ref = namespace_alias.namespace_ref;
                        }

                        if cfg!(debug_assertions) {
                            debug!(
                                "Cross-chunk export: {}",
                                bstr::BStr::new(
                                    &deps.symbols.get(target_ref).unwrap().original_name
                                ),
                            );
                        }

                        chunk_meta.imports.put(target_ref, ());
                    }
                }

                // Ensure "exports" is included if the current output format needs it
                // https://github.com/evanw/esbuild/blob/v0.27.2/internal/linker/linker.go#L1049-L1051
                if flags.force_include_exports_for_entry_point {
                    chunk_meta
                        .imports
                        .put(deps.exports_refs[chunk.entry_point.source_index as usize], ());
                }

                // Include the wrapper if present
                // https://github.com/evanw/esbuild/blob/v0.27.2/internal/linker/linker.go#L1053-L1056
                if flags.wrap != JSMeta::Wrap::None {
                    chunk_meta
                        .imports
                        .put(deps.wrapper_refs[chunk.entry_point.source_index as usize], ());
                }
            }
        }
    }
}

fn compute_cross_chunk_dependencies_with_chunk_metas(
    c: &mut LinkerContext,
    chunks: &mut [Chunk],
    chunk_metas: &mut [ChunkMeta],
) -> Result<(), bun_alloc::AllocError> {
    // TODO(port): narrow error set

    // Mark imported symbols as exported in the chunk from which they are declared
    // PORT NOTE: reshaped for borrowck — Zig zips (chunks, chunk_metas, 0..) and also indexes
    // chunk_metas[other_chunk_index] / chunks[other_chunk_index] inside the loop body. We
    // iterate by index and re-borrow per access.
    debug_assert_eq!(chunks.len(), chunk_metas.len());
    for chunk_index in 0..chunks.len() {
        if chunks[chunk_index].content != .javascript {
            // TODO(port): tagged-union check on Chunk::Content
            continue;
        }

        // Find all uses in this chunk of symbols from other chunks
        // PORT NOTE: reshaped for borrowck — collect keys first to avoid holding a borrow on
        // chunk_metas[chunk_index] while mutating chunk_metas[other_chunk_index].
        let import_refs: Vec<Ref> = chunk_metas[chunk_index].imports.keys().to_vec();
        // PERF(port): was direct iteration over .keys() without copy — profile in Phase B
        for import_ref in import_refs {
            let symbol = c.graph.symbols.get_const(import_ref).unwrap();

            // Ignore uses that aren't top-level symbols
            if let Some(other_chunk_index) = symbol.chunk_index() {
                if other_chunk_index as usize != chunk_index {
                    if cfg!(debug_assertions) {
                        debug!(
                            "Import name: {} (in {})",
                            bstr::BStr::new(&symbol.original_name),
                            bstr::BStr::new(
                                &c.parse_graph
                                    .input_files
                                    .get(import_ref.source_index())
                                    .source
                                    .path
                                    .text
                            ),
                        );
                    }

                    {
                        let js = &mut chunks[chunk_index].content.javascript;
                        let entry = js
                            .imports_from_other_chunks
                            .get_or_put_value(other_chunk_index, CrossChunkImport::Item::List::default())?;
                        entry.value_ptr.push(CrossChunkImport::Item {
                            ref_: import_ref,
                            ..Default::default()
                        })?;
                        // TODO(port): `entry.value_ptr.append(allocator, ...)` — BabyList append
                    }
                    let _ = chunk_metas[other_chunk_index as usize]
                        .exports
                        .get_or_put(import_ref);
                } else {
                    debug!(
                        "{} imports from itself (chunk {})",
                        bstr::BStr::new(&symbol.original_name),
                        chunk_index,
                    );
                }
            }
        }

        // If this is an entry point, make sure we import all chunks belonging to
        // this entry point, even if there are no imports. We need to make sure
        // these chunks are evaluated for their side effects too.
        if chunks[chunk_index].entry_point.is_entry_point {
            let entry_point_id = chunks[chunk_index].entry_point.entry_point_id;
            for other_chunk_index in 0..chunks.len() {
                if other_chunk_index == chunk_index
                    || chunks[other_chunk_index].content != .javascript
                {
                    // TODO(port): tagged-union check on Chunk::Content
                    continue;
                }

                if chunks[other_chunk_index].entry_bits.is_set(entry_point_id) {
                    let js = &mut chunks[chunk_index].content.javascript;
                    let _ = js.imports_from_other_chunks.get_or_put_value(
                        other_chunk_index as u32,
                        CrossChunkImport::Item::List::default(),
                    );
                }
            }
        }

        // Make sure we also track dynamic cross-chunk imports. These need to be
        // tracked so we count them as dependencies of this chunk for the purpose
        // of hash calculation.
        if chunk_metas[chunk_index].dynamic_imports.count() > 0 {
            let dynamic_chunk_indices = chunk_metas[chunk_index].dynamic_imports.keys_mut();
            dynamic_chunk_indices.sort_unstable();

            let chunk = &mut chunks[chunk_index];
            let new_imports = chunk
                .cross_chunk_imports
                .writable_slice(dynamic_chunk_indices.len());
            debug_assert_eq!(dynamic_chunk_indices.len(), new_imports.len());
            for (&dynamic_chunk_index, item) in
                dynamic_chunk_indices.iter().zip(new_imports.iter_mut())
            {
                *item = Chunk::CrossChunkImportItem {
                    import_kind: bun_options_types::ImportKind::Dynamic,
                    chunk_index: dynamic_chunk_index,
                };
                // TODO(port): verify type name `Chunk::CrossChunkImportItem` matches the
                // element type of `chunk.cross_chunk_imports`.
            }
        }
    }

    // Generate cross-chunk exports. These must be computed before cross-chunk
    // imports because of export alias renaming, which must consider all export
    // aliases simultaneously to avoid collisions.
    {
        debug_assert!(chunk_metas.len() == chunks.len());
        let mut r = renamer::ExportRenamer::new();
        // defer r.deinit() — handled by Drop
        debug!("Generating cross-chunk exports");

        let mut stable_ref_list: Vec<StableRef> = Vec::new();
        // PERF(port): was arena-backed std.ArrayList — profile in Phase B
        // defer stable_ref_list.deinit() — handled by Drop

        debug_assert_eq!(chunks.len(), chunk_metas.len());
        for (chunk, chunk_meta) in chunks.iter_mut().zip(chunk_metas.iter_mut()) {
            if chunk.content != .javascript {
                // TODO(port): tagged-union check on Chunk::Content
                continue;
            }

            let repr = &mut chunk.content.javascript;

            match c.options.output_format {
                OutputFormat::Esm => {
                    c.sorted_cross_chunk_export_items(&chunk_meta.exports, &mut stable_ref_list);
                    let mut clause_items =
                        BabyList::<js_ast::ClauseItem>::with_capacity(stable_ref_list.len());
                    // SAFETY: capacity reserved above; elements written immediately below.
                    unsafe { clause_items.set_len(stable_ref_list.len() as u32) };
                    // TODO(port): Zig sets `.len` then writes via slice; consider
                    // `extend`/`push` instead to avoid uninit reads.
                    repr.exports_to_other_chunks
                        .reserve(stable_ref_list.len());
                    // PERF(port): was ensureUnusedCapacity — profile in Phase B
                    r.clear_retaining_capacity();

                    debug_assert_eq!(stable_ref_list.len(), clause_items.slice().len());
                    for (stable_ref, clause_item) in stable_ref_list
                        .iter()
                        .zip(clause_items.slice_mut().iter_mut())
                    {
                        let ref_ = stable_ref.ref_;
                        let alias = if c.options.minify_identifiers {
                            r.next_minified_name()?
                        } else {
                            r.next_renamed_name(
                                &c.graph.symbols.get(ref_).unwrap().original_name,
                            )
                        };

                        *clause_item = js_ast::ClauseItem {
                            name: js_ast::LocRef {
                                ref_,
                                loc: Logger::Loc::EMPTY,
                            },
                            alias,
                            alias_loc: Logger::Loc::EMPTY,
                            original_name: b"",
                            // TODO(port): verify ClauseItem field set / defaults
                        };

                        repr.exports_to_other_chunks.put(ref_, alias);
                        // PERF(port): was putAssumeCapacity — profile in Phase B
                    }

                    if clause_items.len() > 0 {
                        let mut stmts = BabyList::<js_ast::Stmt>::with_capacity(1);
                        let export_clause = c.allocator().alloc(js_ast::S::ExportClause {
                            items: clause_items.into_slice(),
                            // TODO(port): Zig passes `clause_items.slice()` (borrowed); decide
                            // ownership of `S.ExportClause.items` in Phase B.
                            is_single_line: true,
                        });
                        // PORT NOTE: c.allocator() → &'bump Bump; Bump::alloc returns &'bump mut T
                        stmts.push(js_ast::Stmt {
                            data: js_ast::Stmt::Data::SExportClause(export_clause),
                            loc: Logger::Loc::EMPTY,
                        });
                        // PERF(port): was appendAssumeCapacity — profile in Phase B
                        repr.cross_chunk_suffix_stmts = stmts;
                    }
                }
                _ => {}
            }
        }
    }

    // Generate cross-chunk imports. These must be computed after cross-chunk
    // exports because the export aliases must already be finalized so they can
    // be embedded in the generated import statements.
    {
        debug!("Generating cross-chunk imports");
        let mut list = CrossChunkImport::List::default();
        // defer list.deinit() — handled by Drop
        for chunk in chunks.iter_mut() {
            if chunk.content != .javascript {
                // TODO(port): tagged-union check on Chunk::Content
                continue;
            }
            let repr = &mut chunk.content.javascript;
            let mut cross_chunk_prefix_stmts = BabyList::<js_ast::Stmt>::default();

            CrossChunkImport::sorted_cross_chunk_imports(
                &mut list,
                chunks,
                &mut repr.imports_from_other_chunks,
            )
            .expect("unreachable");
            // TODO(port): borrowck — `chunks` is borrowed mutably by the outer loop and
            // immutably here; Phase B may need to pass a read-only view or index.
            let cross_chunk_imports_input: &[CrossChunkImport] = list.as_slice();
            let mut cross_chunk_imports = core::mem::take(&mut chunk.cross_chunk_imports);
            // PORT NOTE: reshaped for borrowck — Zig copies the BabyList by value, mutates,
            // then writes back; we `take` to express the same move-out/move-in.
            for cross_chunk_import in cross_chunk_imports_input {
                match c.options.output_format {
                    OutputFormat::Esm => {
                        let import_record_index =
                            u32::try_from(cross_chunk_imports.len()).unwrap();

                        let mut clauses = bumpalo::collections::Vec::<js_ast::ClauseItem>::with_capacity_in(
                            cross_chunk_import.sorted_import_items.len() as usize,
                            c.allocator(),
                        );
                        // TODO(port): arena-backed Vec — c.allocator() returns &'bump Bump; thread
                        // 'bump lifetime through this fn in Phase B.
                        for item in cross_chunk_import.sorted_import_items.slice() {
                            clauses.push(js_ast::ClauseItem {
                                name: js_ast::LocRef {
                                    ref_: item.ref_,
                                    loc: Logger::Loc::EMPTY,
                                },
                                alias: item.export_alias,
                                alias_loc: Logger::Loc::EMPTY,
                                ..Default::default()
                            });
                            // PERF(port): was appendAssumeCapacity — profile in Phase B
                        }

                        cross_chunk_imports.push(Chunk::CrossChunkImportItem {
                            import_kind: bun_options_types::ImportKind::Stmt,
                            chunk_index: cross_chunk_import.chunk_index,
                        });
                        // TODO(port): BabyList::push allocator — Zig passes c.allocator()
                        let import = c.allocator().alloc(js_ast::S::Import {
                            items: clauses.into_bump_slice(),
                            // TODO(port): Zig passes `clauses.items` (slice); decide ownership
                            import_record_index,
                            namespace_ref: Ref::NONE,
                            ..Default::default()
                        });
                        // PORT NOTE: c.allocator() → &'bump Bump; Bump::alloc returns &'bump mut T
                        cross_chunk_prefix_stmts.push(js_ast::Stmt {
                            data: js_ast::Stmt::Data::SImport(import),
                            loc: Logger::Loc::EMPTY,
                        });
                        // TODO(port): BabyList::push allocator — Zig passes c.allocator()
                    }
                    _ => {}
                }
            }

            repr.cross_chunk_prefix_stmts = cross_chunk_prefix_stmts;
            chunk.cross_chunk_imports = cross_chunk_imports;
        }
    }

    Ok(())
}

pub use crate::{DeferredBatchTask, ParseTask, ThreadPool};

// TODO(port): `OutputFormat` enum location — Zig accesses via `c.options.output_format`.
use crate::options::OutputFormat;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/computeCrossChunkDependencies.zig (459 lines)
//   confidence: medium
//   todos:      23
//   notes:      heavy borrowck reshaping (index-based loops), Chunk::Content tagged-union checks left as placeholders, parallel `walk` aliasing needs UnsafeCell, AST node allocs via c.allocator() (&'bump Bump) — thread 'bump in Phase B
// ──────────────────────────────────────────────────────────────────────────
