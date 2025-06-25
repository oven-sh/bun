pub fn computeCrossChunkDependencies(c: *LinkerContext, chunks: []Chunk) !void {
    if (!c.graph.code_splitting) {
        // No need to compute cross-chunk dependencies if there can't be any
        return;
    }

    const chunk_metas = try c.allocator.alloc(ChunkMeta, chunks.len);
    for (chunk_metas) |*meta| {
        // these must be global allocator
        meta.* = .{
            .imports = ChunkMeta.Map.init(bun.default_allocator),
            .exports = ChunkMeta.Map.init(bun.default_allocator),
            .dynamic_imports = std.AutoArrayHashMap(Index.Int, void).init(bun.default_allocator),
        };
    }
    defer {
        for (chunk_metas) |*meta| {
            meta.imports.deinit();
            meta.exports.deinit();
            meta.dynamic_imports.deinit();
        }
        c.allocator.free(chunk_metas);
    }

    {
        const cross_chunk_dependencies = c.allocator.create(CrossChunkDependencies) catch unreachable;
        defer c.allocator.destroy(cross_chunk_dependencies);

        cross_chunk_dependencies.* = .{
            .chunks = chunks,
            .chunk_meta = chunk_metas,
            .parts = c.graph.ast.items(.parts),
            .import_records = c.graph.ast.items(.import_records),
            .flags = c.graph.meta.items(.flags),
            .entry_point_chunk_indices = c.graph.files.items(.entry_point_chunk_index),
            .imports_to_bind = c.graph.meta.items(.imports_to_bind),
            .wrapper_refs = c.graph.ast.items(.wrapper_ref),
            .sorted_and_filtered_export_aliases = c.graph.meta.items(.sorted_and_filtered_export_aliases),
            .resolved_exports = c.graph.meta.items(.resolved_exports),
            .ctx = c,
            .symbols = &c.graph.symbols,
        };

        c.parse_graph.pool.worker_pool.doPtr(
            c.allocator,
            &c.wait_group,
            cross_chunk_dependencies,
            CrossChunkDependencies.walk,
            chunks,
        ) catch unreachable;
    }

    try computeCrossChunkDependenciesWithChunkMetas(c, chunks, chunk_metas);
}

const CrossChunkDependencies = struct {
    chunk_meta: []ChunkMeta,
    chunks: []Chunk,
    parts: []BabyList(Part),
    import_records: []BabyList(bun.ImportRecord),
    flags: []const JSMeta.Flags,
    entry_point_chunk_indices: []Index.Int,
    imports_to_bind: []RefImportData,
    wrapper_refs: []const Ref,
    sorted_and_filtered_export_aliases: []const []const string,
    resolved_exports: []const ResolvedExports,
    ctx: *LinkerContext,
    symbols: *Symbol.Map,

    pub fn walk(deps: *@This(), chunk: *Chunk, chunk_index: usize) void {
        var chunk_meta = &deps.chunk_meta[chunk_index];
        var imports = &deps.chunk_meta[chunk_index].imports;

        const entry_point_chunk_indices = deps.entry_point_chunk_indices;

        // Go over each file in this chunk
        for (chunk.files_with_parts_in_chunk.keys()) |source_index| {
            // TODO: make this switch
            if (chunk.content == .css) {
                continue;
            }
            if (chunk.content != .javascript) continue;

            // Go over each part in this file that's marked for inclusion in this chunk
            const parts = deps.parts[source_index].slice();
            var import_records = deps.import_records[source_index].slice();
            const imports_to_bind = deps.imports_to_bind[source_index];
            const wrap = deps.flags[source_index].wrap;
            const wrapper_ref = deps.wrapper_refs[source_index];
            const _chunks = deps.chunks;

            for (parts) |part| {
                if (!part.is_live)
                    continue;

                // Rewrite external dynamic imports to point to the chunk for that entry point
                for (part.import_record_indices.slice()) |import_record_id| {
                    var import_record = &import_records[import_record_id];
                    if (import_record.source_index.isValid() and deps.ctx.isExternalDynamicImport(import_record, source_index)) {
                        const other_chunk_index = entry_point_chunk_indices[import_record.source_index.get()];
                        import_record.path.text = _chunks[other_chunk_index].unique_key;
                        import_record.source_index = Index.invalid;

                        // Track this cross-chunk dynamic import so we make sure to
                        // include its hash when we're calculating the hashes of all
                        // dependencies of this chunk.
                        if (other_chunk_index != chunk_index)
                            chunk_meta.dynamic_imports.put(other_chunk_index, {}) catch unreachable;
                    }
                }

                // Remember what chunk each top-level symbol is declared in. Symbols
                // with multiple declarations such as repeated "var" statements with
                // the same name should already be marked as all being in a single
                // chunk. In that case this will overwrite the same value below which
                // is fine.
                deps.symbols.assignChunkIndex(part.declared_symbols, @as(u32, @truncate(chunk_index)));

                const used_refs = part.symbol_uses.keys();

                // Record each symbol used in this part. This will later be matched up
                // with our map of which chunk a given symbol is declared in to
                // determine if the symbol needs to be imported from another chunk.
                for (used_refs) |ref| {
                    const ref_to_use = brk: {
                        var ref_to_use = ref;
                        var symbol = deps.symbols.getConst(ref_to_use).?;

                        // Ignore unbound symbols
                        if (symbol.kind == .unbound)
                            continue;

                        // Ignore symbols that are going to be replaced by undefined
                        if (symbol.import_item_status == .missing)
                            continue;

                        // If this is imported from another file, follow the import
                        // reference and reference the symbol in that file instead
                        if (imports_to_bind.get(ref_to_use)) |import_data| {
                            ref_to_use = import_data.data.import_ref;
                            symbol = deps.symbols.getConst(ref_to_use).?;
                        } else if (wrap == .cjs and ref_to_use.eql(wrapper_ref)) {
                            // The only internal symbol that wrapped CommonJS files export
                            // is the wrapper itself.
                            continue;
                        }

                        // If this is an ES6 import from a CommonJS file, it will become a
                        // property access off the namespace symbol instead of a bare
                        // identifier. In that case we want to pull in the namespace symbol
                        // instead. The namespace symbol stores the result of "require()".
                        if (symbol.namespace_alias) |*namespace_alias| {
                            ref_to_use = namespace_alias.namespace_ref;
                        }
                        break :brk ref_to_use;
                    };

                    if (comptime Environment.allow_assert)
                        debug("Cross-chunk import: {s} {}", .{ deps.symbols.get(ref_to_use).?.original_name, ref_to_use });

                    // We must record this relationship even for symbols that are not
                    // imports. Due to code splitting, the definition of a symbol may
                    // be moved to a separate chunk than the use of a symbol even if
                    // the definition and use of that symbol are originally from the
                    // same source file.
                    imports.put(ref_to_use, {}) catch unreachable;
                }
            }
        }

        // Include the exports if this is an entry point chunk
        if (chunk.content == .javascript) {
            if (chunk.entry_point.is_entry_point) {
                const flags = deps.flags[chunk.entry_point.source_index];
                if (flags.wrap != .cjs) {
                    const resolved_exports = deps.resolved_exports[chunk.entry_point.source_index];
                    const sorted_and_filtered_export_aliases = deps.sorted_and_filtered_export_aliases[chunk.entry_point.source_index];
                    for (sorted_and_filtered_export_aliases) |alias| {
                        const export_ = resolved_exports.get(alias).?;
                        var target_ref = export_.data.import_ref;

                        // If this is an import, then target what the import points to
                        if (deps.imports_to_bind[export_.data.source_index.get()].get(target_ref)) |import_data| {
                            target_ref = import_data.data.import_ref;
                        }

                        // If this is an ES6 import from a CommonJS file, it will become a
                        // property access off the namespace symbol instead of a bare
                        // identifier. In that case we want to pull in the namespace symbol
                        // instead. The namespace symbol stores the result of "require()".
                        if (deps.symbols.getConst(target_ref).?.namespace_alias) |namespace_alias| {
                            target_ref = namespace_alias.namespace_ref;
                        }
                        if (comptime Environment.allow_assert)
                            debug("Cross-chunk export: {s}", .{deps.symbols.get(target_ref).?.original_name});

                        imports.put(target_ref, {}) catch unreachable;
                    }
                }

                // Ensure "exports" is included if the current output format needs it
                if (flags.force_include_exports_for_entry_point) {
                    imports.put(deps.wrapper_refs[chunk.entry_point.source_index], {}) catch unreachable;
                }

                // Include the wrapper if present
                if (flags.wrap != .none) {
                    imports.put(deps.wrapper_refs[chunk.entry_point.source_index], {}) catch unreachable;
                }
            }
        }
    }
};

fn computeCrossChunkDependenciesWithChunkMetas(c: *LinkerContext, chunks: []Chunk, chunk_metas: []ChunkMeta) !void {

    // Mark imported symbols as exported in the chunk from which they are declared
    for (chunks, chunk_metas, 0..) |*chunk, *chunk_meta, chunk_index| {
        if (chunk.content != .javascript) {
            continue;
        }
        var js = &chunk.content.javascript;

        // Find all uses in this chunk of symbols from other chunks
        for (chunk_meta.imports.keys()) |import_ref| {
            const symbol = c.graph.symbols.getConst(import_ref).?;

            // Ignore uses that aren't top-level symbols
            if (symbol.chunkIndex()) |other_chunk_index| {
                if (@as(usize, other_chunk_index) != chunk_index) {
                    if (comptime Environment.allow_assert)
                        debug("Import name: {s} (in {s})", .{
                            symbol.original_name,
                            c.parse_graph.input_files.get(import_ref.sourceIndex()).source.path.text,
                        });

                    {
                        var entry = try js
                            .imports_from_other_chunks
                            .getOrPutValue(c.allocator, other_chunk_index, .{});
                        try entry.value_ptr.push(c.allocator, .{
                            .ref = import_ref,
                        });
                    }
                    _ = chunk_metas[other_chunk_index].exports.getOrPut(import_ref) catch unreachable;
                } else {
                    debug("{s} imports from itself (chunk {d})", .{ symbol.original_name, chunk_index });
                }
            }
        }

        // If this is an entry point, make sure we import all chunks belonging to
        // this entry point, even if there are no imports. We need to make sure
        // these chunks are evaluated for their side effects too.
        if (chunk.entry_point.is_entry_point) {
            for (chunks, 0..) |*other_chunk, other_chunk_index| {
                if (other_chunk_index == chunk_index or other_chunk.content != .javascript) continue;

                if (other_chunk.entry_bits.isSet(chunk.entry_point.entry_point_id)) {
                    _ = js.imports_from_other_chunks.getOrPutValue(
                        c.allocator,
                        @as(u32, @truncate(other_chunk_index)),
                        CrossChunkImport.Item.List{},
                    ) catch unreachable;
                }
            }
        }

        // Make sure we also track dynamic cross-chunk imports. These need to be
        // tracked so we count them as dependencies of this chunk for the purpose
        // of hash calculation.
        if (chunk_meta.dynamic_imports.count() > 0) {
            const dynamic_chunk_indices = chunk_meta.dynamic_imports.keys();
            std.sort.pdq(Index.Int, dynamic_chunk_indices, {}, std.sort.asc(Index.Int));

            var imports = chunk.cross_chunk_imports.listManaged(c.allocator);
            defer chunk.cross_chunk_imports.update(imports);
            imports.ensureUnusedCapacity(dynamic_chunk_indices.len) catch unreachable;
            const prev_len = imports.items.len;
            imports.items.len += dynamic_chunk_indices.len;
            for (dynamic_chunk_indices, imports.items[prev_len..]) |dynamic_chunk_index, *item| {
                item.* = .{
                    .import_kind = .dynamic,
                    .chunk_index = dynamic_chunk_index,
                };
            }
        }
    }

    // Generate cross-chunk exports. These must be computed before cross-chunk
    // imports because of export alias renaming, which must consider all export
    // aliases simultaneously to avoid collisions.
    {
        bun.assert(chunk_metas.len == chunks.len);
        var r = renamer.ExportRenamer.init(c.allocator);
        defer r.deinit();
        debug("Generating cross-chunk exports", .{});

        var stable_ref_list = std.ArrayList(StableRef).init(c.allocator);
        defer stable_ref_list.deinit();

        for (chunks, chunk_metas) |*chunk, *chunk_meta| {
            if (chunk.content != .javascript) continue;

            var repr = &chunk.content.javascript;

            switch (c.options.output_format) {
                .esm => {
                    c.sortedCrossChunkExportItems(
                        chunk_meta.exports,
                        &stable_ref_list,
                    );
                    var clause_items = BabyList(js_ast.ClauseItem).initCapacity(c.allocator, stable_ref_list.items.len) catch unreachable;
                    clause_items.len = @as(u32, @truncate(stable_ref_list.items.len));
                    repr.exports_to_other_chunks.ensureUnusedCapacity(c.allocator, stable_ref_list.items.len) catch unreachable;
                    r.clearRetainingCapacity();

                    for (stable_ref_list.items, clause_items.slice()) |stable_ref, *clause_item| {
                        const ref = stable_ref.ref;
                        const alias = if (c.options.minify_identifiers) try r.nextMinifiedName(c.allocator) else r.nextRenamedName(c.graph.symbols.get(ref).?.original_name);

                        clause_item.* = .{
                            .name = .{
                                .ref = ref,
                                .loc = Logger.Loc.Empty,
                            },
                            .alias = alias,
                            .alias_loc = Logger.Loc.Empty,
                            .original_name = "",
                        };

                        repr.exports_to_other_chunks.putAssumeCapacity(
                            ref,
                            alias,
                        );
                    }

                    if (clause_items.len > 0) {
                        var stmts = BabyList(js_ast.Stmt).initCapacity(c.allocator, 1) catch unreachable;
                        const export_clause = c.allocator.create(js_ast.S.ExportClause) catch unreachable;
                        export_clause.* = .{
                            .items = clause_items.slice(),
                            .is_single_line = true,
                        };
                        stmts.appendAssumeCapacity(.{
                            .data = .{
                                .s_export_clause = export_clause,
                            },
                            .loc = Logger.Loc.Empty,
                        });
                        repr.cross_chunk_suffix_stmts = stmts;
                    }
                },
                else => {},
            }
        }
    }

    // Generate cross-chunk imports. These must be computed after cross-chunk
    // exports because the export aliases must already be finalized so they can
    // be embedded in the generated import statements.
    {
        debug("Generating cross-chunk imports", .{});
        var list = CrossChunkImport.List.init(c.allocator);
        defer list.deinit();
        for (chunks) |*chunk| {
            if (chunk.content != .javascript) continue;
            var repr = &chunk.content.javascript;
            var cross_chunk_prefix_stmts = BabyList(js_ast.Stmt){};

            CrossChunkImport.sortedCrossChunkImports(&list, chunks, &repr.imports_from_other_chunks) catch unreachable;
            const cross_chunk_imports_input: []CrossChunkImport = list.items;
            var cross_chunk_imports = chunk.cross_chunk_imports;
            for (cross_chunk_imports_input) |cross_chunk_import| {
                switch (c.options.output_format) {
                    .esm => {
                        const import_record_index = @as(u32, @intCast(cross_chunk_imports.len));

                        var clauses = std.ArrayList(js_ast.ClauseItem).initCapacity(c.allocator, cross_chunk_import.sorted_import_items.len) catch unreachable;
                        for (cross_chunk_import.sorted_import_items.slice()) |item| {
                            clauses.appendAssumeCapacity(.{
                                .name = .{
                                    .ref = item.ref,
                                    .loc = Logger.Loc.Empty,
                                },
                                .alias = item.export_alias,
                                .alias_loc = Logger.Loc.Empty,
                            });
                        }

                        cross_chunk_imports.push(c.allocator, .{
                            .import_kind = .stmt,
                            .chunk_index = cross_chunk_import.chunk_index,
                        }) catch unreachable;
                        const import = c.allocator.create(js_ast.S.Import) catch unreachable;
                        import.* = .{
                            .items = clauses.items,
                            .import_record_index = import_record_index,
                            .namespace_ref = Ref.None,
                        };
                        cross_chunk_prefix_stmts.push(
                            c.allocator,
                            .{
                                .data = .{
                                    .s_import = import,
                                },
                                .loc = Logger.Loc.Empty,
                            },
                        ) catch unreachable;
                    },
                    else => {},
                }
            }

            repr.cross_chunk_prefix_stmts = cross_chunk_prefix_stmts;
            chunk.cross_chunk_imports = cross_chunk_imports;
        }
    }
}

const bun = @import("bun");
const Ref = bun.bundle_v2.Ref;
const BabyList = bun.BabyList;
const Logger = bun.logger;
const Index = bun.bundle_v2.Index;
const Loc = Logger.Loc;
const LinkerContext = bun.bundle_v2.LinkerContext;

const debug = LinkerContext.debug;

const string = bun.string;
const Environment = bun.Environment;
const default_allocator = bun.default_allocator;

const std = @import("std");
const Part = js_ast.Part;
const js_ast = bun.js_ast;
const ImportRecord = bun.ImportRecord;

const Symbol = js_ast.Symbol;
const Stmt = js_ast.Stmt;
const S = js_ast.S;
const renamer = bun.renamer;
const bundler = bun.bundle_v2;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;
const Chunk = bundler.Chunk;
const JSMeta = bundler.JSMeta;
const ResolvedExports = bundler.ResolvedExports;
const RefImportData = bundler.RefImportData;
const CrossChunkImport = bundler.CrossChunkImport;
const StableRef = bundler.StableRef;
const ChunkMeta = LinkerContext.ChunkMeta;
