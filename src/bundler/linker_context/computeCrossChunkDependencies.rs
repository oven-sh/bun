use crate::bun_renamer as renamer;
use crate::mal_prelude::*;
use bun_alloc::ArenaVecExt as _;
use bun_ast::ImportRecord;
use bun_ast::{Part, Symbol};
use bun_collections::{ArrayHashMap, VecExt};
use bun_js_parser as js_ast;

use crate::LinkerContext;
use crate::js_meta;
use crate::linker_context_mod::{ChunkMeta, ChunkMetaMap, debug};
use crate::{
    Chunk, CrossChunkImport, CrossChunkImportItem, CrossChunkImportItemList, Index, IndexInt,
    JSMeta, Ref, RefImportData, ResolvedExports, StableRef, WrapKind, chunk,
};

pub fn compute_cross_chunk_dependencies(
    c: &mut LinkerContext,
    chunks: &mut [Chunk],
) -> Result<(), bun_alloc::AllocError> {
    if !c.graph.code_splitting {
        // No need to compute cross-chunk dependencies if there can't be any
        return Ok(());
    }

    // these must be global arena
    let mut chunk_metas: Vec<ChunkMeta> = (0..chunks.len())
        .map(|_| ChunkMeta {
            imports: ChunkMetaMap::default(),
            exports: ChunkMetaMap::default(),
            dynamic_imports: ArrayHashMap::<IndexInt, ()>::default(),
        })
        .collect();
    // defer { meta.*.deinit(); free(chunk_metas) } — handled by Drop

    {
        // PORT NOTE: Zig heap-allocated this via c.arena().create() and destroyed it at
        // scope end; in Rust we construct on the stack and let it drop.
        //
        // `ctx` / `symbols` / `chunks` are stored as raw pointers so the struct does not
        // hold a borrow on `c` or `chunks` across the sequential `walk` loop below.
        //
        // Derive `ctx_ptr` from the `&mut` (not `from_ref`) so the raw carries `c`'s own
        // Unique provenance: under Stacked Borrows the subsequent `split_mut` reborrows
        // are children of that tag, so `&*ctx_ptr` in `walk()` (which reads
        // `c.graph.files.{ptrs,len}` via `is_external_dynamic_import`) stays valid.
        // `from_ref(c)` would push a SharedRO tag that the `&mut c.graph.X` reborrows
        // pop, leaving the raw dangling under SB.
        //
        // Lifetime-erase the `LinkerContext<'_>` so the struct's `'a` (which
        // ties only the local SoA-column borrows) is not forced to equal the
        // LinkerContext's invariant `'_`. `NonNull::from(&mut *c)` preserves
        // `c`'s Unique provenance (see PORT NOTE above).
        let ctx_ref = bun_ptr::BackRef::from(
            core::ptr::NonNull::from(&mut *c).cast::<LinkerContext<'static>>(),
        );
        // `BackRef` from raw place addr (not `BackRef::new(&…)`) so no
        // intermediate `&` borrow is pushed before the `split_mut()` calls
        // below — matches the `ctx_ref` construction pattern just above.
        let symbols_ref = bun_ptr::BackRef::from(core::ptr::NonNull::from(&mut c.graph.symbols));

        let ast = c.graph.ast.split_mut();
        let meta = c.graph.meta.split_mut();
        let files = c.graph.files.split_mut();

        let mut cross_chunk_dependencies = CrossChunkDependencies {
            chunks: bun_ptr::BackRef::new(&*chunks),
            chunk_meta: &mut chunk_metas,
            parts: ast.parts,
            import_records: ast.import_records,
            flags: meta.flags,
            entry_point_chunk_indices: files.entry_point_chunk_index,
            imports_to_bind: meta.imports_to_bind,
            wrapper_refs: ast.wrapper_ref,
            exports_refs: ast.exports_ref,
            sorted_and_filtered_export_aliases: meta.sorted_and_filtered_export_aliases,
            resolved_exports: meta.resolved_exports,
            ctx: ctx_ref,
            symbols: symbols_ref,
        };

        for (idx, chunk) in chunks.iter_mut().enumerate() {
            cross_chunk_dependencies.walk(chunk, idx);
        }
    }

    compute_cross_chunk_dependencies_with_chunk_metas(c, chunks, &mut chunk_metas)
}

pub struct CrossChunkDependencies<'a> {
    chunk_meta: &'a mut [ChunkMeta],
    // PORT NOTE: `BackRef` — the same `[Chunk]` slice is also iterated mutably by
    // the caller's sequential `walk` loop; `walk` only reads `chunks[other].unique_key`
    // (disjoint from the per-iteration `&mut Chunk`). The slice outlives the struct
    // (caller stack frame).
    chunks: bun_ptr::BackRef<[Chunk]>,
    parts: &'a [Vec<Part>],
    import_records: &'a mut [Vec<ImportRecord>],
    flags: &'a [js_meta::Flags],
    entry_point_chunk_indices: &'a [IndexInt],
    imports_to_bind: &'a [RefImportData],
    wrapper_refs: &'a [Ref],
    exports_refs: &'a [Ref],
    // Zig: []const []const string → SoA column type is Box<[Box<[u8]>]>
    sorted_and_filtered_export_aliases: &'a [Box<[Box<[u8]>]>],
    resolved_exports: &'a [ResolvedExports],
    // PORT NOTE: `BackRef` — Zig stores `*LinkerContext` / `*Symbol.Map` and freely
    // aliases `c.graph` columns alongside; borrowck cannot express that split, so
    // opt out here via `BackRef` (safe `Deref` at each use site in `walk`). Lifetime
    // erased (`'static`) so the outer `CrossChunkDependencies<'_>` borrow is not tied
    // to the LinkerContext's own invariant lifetime parameter.
    ctx: bun_ptr::BackRef<LinkerContext<'static>>,
    // `BackRef` — `walk` mutates per-chunk symbol slots via
    // `Map::assign_chunk_index(&self)`, which is a Relaxed store to
    // `Symbol.chunk_index: AtomicU32`, so a shared `&Map` suffices. Holding
    // `&mut Map` here would conflict with the `&LinkerContext` deref of `ctx`
    // (which also reaches `c.graph.symbols`); `BackRef::Deref` yields the
    // shared `&Map` each `walk` call needs.
    symbols: bun_ptr::BackRef<bun_ast::symbol::Map>,
}

impl<'a> CrossChunkDependencies<'a> {
    // Called once per chunk from the sequential loop above. Writes:
    // `self.chunk_meta[chunk_index]` (per-chunk disjoint),
    // `self.import_records[source_index][rec].{path,source_index}` (per-chunk
    // disjoint via `chunk.files_with_parts_in_chunk`),
    // `symbols.assign_chunk_index(ref)` (Relaxed atomic store to
    // `Symbol.chunk_index: AtomicU32`; per-symbol-ref disjoint by chunk
    // membership — debug-asserted in `assign_chunk_index`).
    // Reads `ctx`/`chunks`/SoA columns shared. Never forms `&mut
    // LinkerContext` (`ctx` is a `BackRef`, deref'd to `&`).
    pub fn walk(&mut self, chunk: &mut Chunk, chunk_index: usize) {
        let deps = self;
        // `ctx` / `chunks` are `BackRef`s into `LinkerContext` / the caller's chunk
        // slice, valid for the link pass (see PORT NOTE on the struct fields).
        // `chunks` aliases the slice the caller iterates mutably but is only read here.
        let ctx: &LinkerContext<'_> = deps.ctx.get();
        // `BackRef` into `LinkerContext.graph.symbols`, valid for the link
        // pass. Shared `&Map` — per-slot writes go through
        // `Symbol.chunk_index: AtomicU32`; no `&mut Map` is materialized.
        let symbols: &bun_ast::symbol::Map = deps.symbols.get();
        let _chunks: &[Chunk] = deps.chunks.get();
        let chunk_meta = &mut deps.chunk_meta[chunk_index];
        // PORT NOTE: reshaped for borrowck — Zig held `&chunk_meta` and `&chunk_meta.imports`
        // simultaneously; here we go through `chunk_meta.imports` / `chunk_meta.dynamic_imports`.
        let entry_point_chunk_indices = deps.entry_point_chunk_indices;

        // Go over each file in this chunk
        for &source_index in chunk.files_with_parts_in_chunk.keys() {
            // TODO: make this switch
            if matches!(chunk.content, chunk::Content::Css(_)) {
                continue;
            }
            if !matches!(chunk.content, chunk::Content::Javascript(_)) {
                continue;
            }

            // Go over each part in this file that's marked for inclusion in this chunk
            let parts = deps.parts[source_index as usize].slice();
            let import_records = deps.import_records[source_index as usize].slice_mut();
            let imports_to_bind = &deps.imports_to_bind[source_index as usize];
            let wrap = deps.flags[source_index as usize].wrap;
            let wrapper_ref = deps.wrapper_refs[source_index as usize];

            for part in parts.iter() {
                if !part.is_live {
                    continue;
                }

                // Rewrite external dynamic imports to point to the chunk for that entry point
                for &import_record_id in part.import_record_indices.slice() {
                    let import_record = &mut import_records[import_record_id as usize];
                    if import_record.source_index.is_valid()
                        && ctx.is_external_dynamic_import(import_record, source_index)
                    {
                        let other_chunk_index =
                            entry_point_chunk_indices[import_record.source_index.get() as usize];
                        import_record.path.text = _chunks[other_chunk_index as usize].unique_key;
                        // TODO(port): Zig assigns the slice by pointer (no copy); decide
                        // ownership of `path.text` vs `unique_key` in Phase B.
                        import_record.source_index = Index::INVALID;

                        // Track this cross-chunk dynamic import so we make sure to
                        // include its hash when we're calculating the hashes of all
                        // dependencies of this chunk.
                        if other_chunk_index as usize != chunk_index {
                            let _ = chunk_meta.dynamic_imports.put(other_chunk_index, ()); // OOM-only Result (Zig: catch unreachable)
                        }
                    }
                }

                // Remember what chunk each top-level symbol is declared in. Symbols
                // with multiple declarations such as repeated "var" statements with
                // the same name should already be marked as all being in a single
                // chunk. In that case this will overwrite the same value below which
                // is fine.
                symbols.assign_chunk_index(&part.declared_symbols, chunk_index as u32);

                let used_refs = part.symbol_uses.keys();

                // Record each symbol used in this part. This will later be matched up
                // with our map of which chunk a given symbol is declared in to
                // determine if the symbol needs to be imported from another chunk.
                'refs: for &ref_ in used_refs {
                    let ref_to_use = {
                        let mut ref_to_use = ref_;
                        let mut symbol = symbols.get_const(ref_to_use).unwrap();

                        // Ignore unbound symbols
                        if symbol.kind == bun_ast::symbol::Kind::Unbound {
                            continue 'refs;
                        }

                        // Ignore symbols that are going to be replaced by undefined
                        if symbol.import_item_status == bun_ast::ImportItemStatus::Missing {
                            continue 'refs;
                        }

                        // If this is imported from another file, follow the import
                        // reference and reference the symbol in that file instead
                        if let Some(import_data) = imports_to_bind.get(&ref_to_use) {
                            ref_to_use = import_data.data.import_ref;
                            symbol = symbols.get_const(ref_to_use).unwrap();
                        } else if wrap == WrapKind::Cjs && ref_to_use.eql(wrapper_ref) {
                            // The only internal symbol that wrapped CommonJS files export
                            // is the wrapper itself.
                            continue 'refs;
                        }

                        // If this is an ES6 import from a CommonJS file, it will become a
                        // property access off the namespace symbol instead of a bare
                        // identifier. In that case we want to pull in the namespace symbol
                        // instead. The namespace symbol stores the result of "require()".
                        if let Some(namespace_alias) = &symbol.namespace_alias {
                            ref_to_use = namespace_alias.namespace_ref;
                        }
                        ref_to_use
                    };

                    if cfg!(debug_assertions) {
                        // SAFETY: `original_name` is an arena slice valid for the link pass.
                        let name = symbols.get_const(ref_to_use).unwrap().original_name.slice();
                        debug!(
                            "Cross-chunk import: {} {:?}",
                            bstr::BStr::new(name),
                            ref_to_use,
                        );
                    }

                    // We must record this relationship even for symbols that are not
                    // imports. Due to code splitting, the definition of a symbol may
                    // be moved to a separate chunk than the use of a symbol even if
                    // the definition and use of that symbol are originally from the
                    // same source file.
                    let _ = chunk_meta.imports.put(ref_to_use, ()); // OOM-only Result (Zig: catch unreachable)
                }
            }
        }

        // Include the exports if this is an entry point chunk
        if matches!(chunk.content, chunk::Content::Javascript(_)) {
            if chunk.entry_point.is_entry_point() {
                let flags = deps.flags[chunk.entry_point.source_index() as usize];
                if flags.wrap != WrapKind::Cjs {
                    let resolved_exports =
                        &deps.resolved_exports[chunk.entry_point.source_index() as usize];
                    let sorted_and_filtered_export_aliases = &deps
                        .sorted_and_filtered_export_aliases
                        [chunk.entry_point.source_index() as usize];
                    for alias in sorted_and_filtered_export_aliases.iter() {
                        let export_ = resolved_exports.get(alias).unwrap();
                        let mut target_ref = export_.data.import_ref;

                        // If this is an import, then target what the import points to
                        if let Some(import_data) = deps.imports_to_bind
                            [export_.data.source_index.get() as usize]
                            .get(&target_ref)
                        {
                            target_ref = import_data.data.import_ref;
                        }

                        // If this is an ES6 import from a CommonJS file, it will become a
                        // property access off the namespace symbol instead of a bare
                        // identifier. In that case we want to pull in the namespace symbol
                        // instead. The namespace symbol stores the result of "require()".
                        if let Some(namespace_alias) =
                            &symbols.get_const(target_ref).unwrap().namespace_alias
                        {
                            target_ref = namespace_alias.namespace_ref;
                        }

                        if cfg!(debug_assertions) {
                            // SAFETY: arena slice valid for the link pass.
                            let name = symbols.get_const(target_ref).unwrap().original_name.slice();
                            debug!("Cross-chunk export: {}", bstr::BStr::new(name),);
                        }

                        let _ = chunk_meta.imports.put(target_ref, ()); // OOM-only Result (Zig: catch unreachable)
                    }
                }

                // Ensure "exports" is included if the current output format needs it
                // https://github.com/evanw/esbuild/blob/v0.27.2/internal/linker/linker.go#L1049-L1051
                if flags.force_include_exports_for_entry_point {
                    // Zig parity: result intentionally discarded
                    let _ = chunk_meta.imports.put(
                        deps.exports_refs[chunk.entry_point.source_index() as usize],
                        (),
                    );
                }

                // Include the wrapper if present
                // https://github.com/evanw/esbuild/blob/v0.27.2/internal/linker/linker.go#L1053-L1056
                if flags.wrap != WrapKind::None {
                    // Zig parity: result intentionally discarded
                    let _ = chunk_meta.imports.put(
                        deps.wrapper_refs[chunk.entry_point.source_index() as usize],
                        (),
                    );
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
        if !matches!(chunks[chunk_index].content, chunk::Content::Javascript(_)) {
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
                        // SAFETY: arena slices valid for the link pass.
                        let name = symbol.original_name.slice();
                        let path = {
                            &c.parse_graph().input_files.items_source()
                                [import_ref.source_index() as usize]
                                .path
                                .text
                        };
                        debug!(
                            "Import name: {} (in {})",
                            bstr::BStr::new(name),
                            bstr::BStr::new(&**path),
                        );
                    }

                    {
                        let js = chunks[chunk_index].content.javascript_mut();
                        let entry = js.imports_from_other_chunks.get_or_put_value(
                            other_chunk_index,
                            CrossChunkImportItemList::default(),
                        )?;
                        entry.value_ptr.push(CrossChunkImportItem {
                            r#ref: import_ref,
                            ..Default::default()
                        });
                    }
                    let _ = chunk_metas[other_chunk_index as usize]
                        .exports
                        .get_or_put(import_ref);
                } else {
                    // SAFETY: arena slice valid for the link pass.
                    let name = symbol.original_name.slice();
                    debug!(
                        "{} imports from itself (chunk {})",
                        bstr::BStr::new(name),
                        chunk_index,
                    );
                }
            }
        }

        // If this is an entry point, make sure we import all chunks belonging to
        // this entry point, even if there are no imports. We need to make sure
        // these chunks are evaluated for their side effects too.
        if chunks[chunk_index].entry_point.is_entry_point() {
            let entry_point_id = chunks[chunk_index].entry_point.entry_point_id();
            for other_chunk_index in 0..chunks.len() {
                if other_chunk_index == chunk_index
                    || !matches!(
                        chunks[other_chunk_index].content,
                        chunk::Content::Javascript(_)
                    )
                {
                    continue;
                }

                if chunks[other_chunk_index]
                    .entry_bits
                    .is_set(entry_point_id as usize)
                {
                    let js = chunks[chunk_index].content.javascript_mut();
                    let _ = js.imports_from_other_chunks.get_or_put_value(
                        other_chunk_index as u32,
                        CrossChunkImportItemList::default(),
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
            // `ChunkImport.import_kind` is a `#[repr(u8)]` enum (validity
            // invariant), so `writable_slice` would form `&mut [T]` over
            // invalid bit patterns. Push into reserved capacity instead.
            chunk
                .cross_chunk_imports
                .reserve(dynamic_chunk_indices.len());
            for &dynamic_chunk_index in dynamic_chunk_indices.iter() {
                chunk.cross_chunk_imports.push(chunk::ChunkImport {
                    import_kind: bun_ast::ImportKind::Dynamic,
                    chunk_index: dynamic_chunk_index,
                });
            }
        }
    }

    // Generate cross-chunk exports. These must be computed before cross-chunk
    // imports because of export alias renaming, which must consider all export
    // aliases simultaneously to avoid collisions.
    {
        debug_assert!(chunk_metas.len() == chunks.len());
        let mut r = renamer::ExportRenamer::init();
        // defer r.deinit() — handled by Drop
        debug!("Generating cross-chunk exports");

        let mut stable_ref_list: Vec<StableRef> = Vec::new();
        // PERF(port): was arena-backed std.ArrayList — profile in Phase B
        // defer stable_ref_list.deinit() — handled by Drop

        debug_assert_eq!(chunks.len(), chunk_metas.len());
        for (chunk, chunk_meta) in chunks.iter_mut().zip(chunk_metas.iter_mut()) {
            if !matches!(chunk.content, chunk::Content::Javascript(_)) {
                continue;
            }

            let repr = chunk.content.javascript_mut();

            match c.options.output_format {
                OutputFormat::Esm => {
                    c.sorted_cross_chunk_export_items(&chunk_meta.exports, &mut stable_ref_list);
                    let mut clause_items =
                        Vec::<bun_ast::ClauseItem>::init_capacity(stable_ref_list.len());
                    repr.exports_to_other_chunks.reserve(stable_ref_list.len());
                    // PERF(port): was ensureUnusedCapacity — profile in Phase B
                    r.clear_retaining_capacity();

                    for stable_ref in stable_ref_list.iter() {
                        let ref_ = stable_ref.r#ref;
                        let original_name = c
                            .graph
                            .symbols
                            .get_const(ref_)
                            .unwrap()
                            .original_name
                            .slice();
                        // The alias is stored on the chunk (`exports_to_other_chunks`,
                        // `cross_chunk_suffix_stmts`) and read later in postProcessJSChunk,
                        // so it must live in the linker arena — `r`'s internal arena is
                        // reset per chunk and dropped at the end of this block.
                        let alias: bun_ast::StoreStr = if c.options.minify_identifiers {
                            bun_ast::StoreStr::new(
                                c.arena()
                                    .alloc_slice_copy(&r.next_minified_name().expect("OOM")),
                            )
                        } else {
                            bun_ast::StoreStr::new(
                                c.arena()
                                    .alloc_slice_copy(r.next_renamed_name(original_name)),
                            )
                        };

                        clause_items.push(bun_ast::ClauseItem {
                            name: bun_ast::LocRef {
                                ref_: Some(ref_),
                                loc: bun_ast::Loc::EMPTY,
                            },
                            alias,
                            alias_loc: bun_ast::Loc::EMPTY,
                            original_name: bun_ast::StoreStr::new(b"" as &[u8]),
                        });

                        // `alias` points into the link-pass arena (see PORT NOTE above),
                        // which outlives `exports_to_other_chunks`; `.slice()` re-borrows
                        // under the StoreStr arena contract.
                        let _ = repr.exports_to_other_chunks.put(ref_, alias.slice()); // OOM-only Result (Zig: catch unreachable)
                        // PERF(port): was putAssumeCapacity — profile in Phase B
                    }

                    if clause_items.len() > 0 {
                        let mut stmts = Vec::<bun_ast::Stmt>::init_capacity(1);
                        // PORT NOTE: `S.ExportClause.items` is `*mut [ClauseItem]`; leak the
                        // Vec buffer (arena-lifetime) into a raw fat ptr.
                        let items_ptr = bun_ast::StoreSlice::new_mut(clause_items.slice_mut());
                        core::mem::forget(clause_items);
                        // Zig: `c.allocator().create(S.ExportClause)` + struct literal —
                        // bypasses Stmt.Data.Store (not pushed on this thread here).
                        let export_clause = c.arena().alloc(bun_ast::S::ExportClause {
                            items: items_ptr,
                            is_single_line: true,
                        });
                        stmts.push(bun_ast::Stmt::init(
                            bun_ast::StoreRef::from_bump(export_clause),
                            bun_ast::Loc::EMPTY,
                        ));
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
        let mut list: Vec<CrossChunkImport> = Vec::new();
        // defer list.deinit() — handled by Drop
        // PORT NOTE: reshaped for borrowck — Zig's `for (chunks) |*chunk|` aliases the same
        // slice it passes to `sortedCrossChunkImports`. We move the per-chunk fields we
        // mutate (`imports_from_other_chunks`, `cross_chunk_imports`) out via `take`, drop
        // the `chunk` borrow, hand the whole `chunks` slice to `sorted_cross_chunk_imports`
        // (which only reads `chunks[other].exports_to_other_chunks` — disjoint), then write
        // the fields back at loop end.
        for chunk_index in 0..chunks.len() {
            if !matches!(chunks[chunk_index].content, chunk::Content::Javascript(_)) {
                continue;
            }
            let mut imports_from_other_chunks = core::mem::take(
                &mut chunks[chunk_index]
                    .content
                    .javascript_mut()
                    .imports_from_other_chunks,
            );
            let mut cross_chunk_imports =
                core::mem::take(&mut chunks[chunk_index].cross_chunk_imports);
            // PORT NOTE: reshaped for borrowck — Zig copies the Vec by value, mutates,
            // then writes back; we `take` to express the same move-out/move-in.
            let mut cross_chunk_prefix_stmts = Vec::<bun_ast::Stmt>::default();

            CrossChunkImport::sorted_cross_chunk_imports(
                &mut list,
                chunks,
                &mut imports_from_other_chunks,
            )
            .expect("unreachable");
            let cross_chunk_imports_input: &[CrossChunkImport] = list.as_slice();
            for cross_chunk_import in cross_chunk_imports_input {
                match c.options.output_format {
                    OutputFormat::Esm => {
                        let import_record_index =
                            u32::try_from(cross_chunk_imports.len() as usize).expect("int cast");

                        let mut clauses =
                            bun_alloc::ArenaVec::<bun_ast::ClauseItem>::with_capacity_in(
                                cross_chunk_import.sorted_import_items.len() as usize,
                                c.arena(),
                            );
                        for item in cross_chunk_import.sorted_import_items.slice() {
                            clauses.push(bun_ast::ClauseItem {
                                name: bun_ast::LocRef {
                                    ref_: Some(item.r#ref),
                                    loc: bun_ast::Loc::EMPTY,
                                },
                                alias: bun_ast::StoreStr::new(item.export_alias.as_ref()),
                                alias_loc: bun_ast::Loc::EMPTY,
                                original_name: bun_ast::StoreStr::new(b"" as &[u8]),
                            });
                            // PERF(port): was appendAssumeCapacity — profile in Phase B
                        }

                        cross_chunk_imports.push(chunk::ChunkImport {
                            import_kind: bun_ast::ImportKind::Stmt,
                            chunk_index: cross_chunk_import.chunk_index,
                        });
                        let items_ptr = bun_ast::StoreSlice::new_mut(clauses.into_bump_slice_mut());
                        // Zig: `c.allocator().create(S.Import)` + struct literal —
                        // bypasses Stmt.Data.Store (not pushed on this thread here).
                        let import = c.arena().alloc(bun_ast::S::Import {
                            items: items_ptr,
                            import_record_index,
                            namespace_ref: Ref::NONE,
                            ..Default::default()
                        });
                        cross_chunk_prefix_stmts.push(bun_ast::Stmt::init(
                            bun_ast::StoreRef::from_bump(import),
                            bun_ast::Loc::EMPTY,
                        ));
                    }
                    _ => {}
                }
            }

            let repr = chunks[chunk_index].content.javascript_mut();
            repr.cross_chunk_prefix_stmts = cross_chunk_prefix_stmts;
            repr.imports_from_other_chunks = imports_from_other_chunks;
            chunks[chunk_index].cross_chunk_imports = cross_chunk_imports;
        }
    }

    Ok(())
}

pub use crate::{DeferredBatchTask, ParseTask, ThreadPool};

// `bun.options.Format` is the bundler output-format enum (Esm/Cjs/Iife/...);
// alias to keep callsites parallel with the Zig `c.options.output_format`.
use crate::options::Format as OutputFormat;

// ported from: src/bundler/linker_context/computeCrossChunkDependencies.zig
