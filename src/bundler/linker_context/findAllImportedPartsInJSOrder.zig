pub fn findAllImportedPartsInJSOrder(this: *LinkerContext, temp_allocator: std.mem.Allocator, chunks: []Chunk) !void {
    const trace = bun.perf.trace("Bundler.findAllImportedPartsInJSOrder");
    defer trace.end();

    var part_ranges_shared = std.array_list.Managed(PartRange).init(temp_allocator);
    var parts_prefix_shared = std.array_list.Managed(PartRange).init(temp_allocator);
    defer part_ranges_shared.deinit();
    defer parts_prefix_shared.deinit();
    for (chunks, 0..) |*chunk, index| {
        switch (chunk.content) {
            .javascript => {
                try this.findImportedPartsInJSOrder(
                    chunk,
                    &part_ranges_shared,
                    &parts_prefix_shared,
                    @intCast(index),
                );
            },
            .css => {}, // handled in `findImportedCSSFilesInJSOrder`
            .html => {},
        }
    }
}

pub fn findImportedPartsInJSOrder(
    this: *LinkerContext,
    chunk: *Chunk,
    part_ranges_shared: *std.array_list.Managed(PartRange),
    parts_prefix_shared: *std.array_list.Managed(PartRange),
    chunk_index: u32,
) !void {
    var chunk_order_array = try std.array_list.Managed(Chunk.Order).initCapacity(this.allocator(), chunk.files_with_parts_in_chunk.count());
    defer chunk_order_array.deinit();
    const distances = this.graph.files.items(.distance_from_entry_point);
    for (chunk.files_with_parts_in_chunk.keys()) |source_index| {
        chunk_order_array.appendAssumeCapacity(
            .{
                .source_index = source_index,
                .distance = distances[source_index],
                .tie_breaker = this.graph.stable_source_indices[source_index],
            },
        );
    }

    Chunk.Order.sort(chunk_order_array.items);

    const FindImportedPartsVisitor = struct {
        entry_bits: *const AutoBitSet,
        flags: []const JSMeta.Flags,
        parts: []BabyList(Part),
        import_records: []BabyList(ImportRecord),
        files: std.array_list.Managed(Index.Int),
        part_ranges: std.array_list.Managed(PartRange),
        visited: std.AutoHashMap(Index.Int, void),
        parts_prefix: std.array_list.Managed(PartRange),
        c: *LinkerContext,
        entry_point: Chunk.EntryPoint,
        chunk_index: u32,

        fn appendOrExtendRange(
            ranges: *std.array_list.Managed(PartRange),
            source_index: Index.Int,
            part_index: Index.Int,
        ) void {
            if (ranges.items.len > 0) {
                var last_range = &ranges.items[ranges.items.len - 1];
                if (last_range.source_index.get() == source_index and last_range.part_index_end == part_index) {
                    last_range.part_index_end += 1;
                    return;
                }
            }

            ranges.append(.{
                .source_index = Index.init(source_index),
                .part_index_begin = part_index,
                .part_index_end = part_index + 1,
            }) catch unreachable;
        }

        // Traverse the graph using this stable order and linearize the files with
        // dependencies before dependents
        pub fn visit(
            v: *@This(),
            source_index: Index.Int,
            comptime with_code_splitting: bool,
            comptime with_scb: bool,
        ) void {
            if (source_index == Index.invalid.value) return;
            const visited_entry = v.visited.getOrPut(source_index) catch unreachable;
            if (visited_entry.found_existing) return;

            var is_file_in_chunk = if (with_code_splitting and v.c.graph.ast.items(.css)[source_index] == null)
                // when code splitting, include the file in the chunk if ALL of the entry points overlap
                v.entry_bits.eql(&v.c.graph.files.items(.entry_bits)[source_index])
            else
                // when NOT code splitting, include the file in the chunk if ANY of the entry points overlap
                v.entry_bits.hasIntersection(&v.c.graph.files.items(.entry_bits)[source_index]);

            // Wrapped files can't be split because they are all inside the wrapper
            const can_be_split = v.flags[source_index].wrap == .none;

            const parts = v.parts[source_index].slice();
            if (can_be_split and is_file_in_chunk and parts[js_ast.namespace_export_part_index].is_live) {
                appendOrExtendRange(&v.part_ranges, source_index, js_ast.namespace_export_part_index);
            }

            const records = v.import_records[source_index].slice();

            for (parts, 0..) |part, part_index_| {
                const part_index = @as(u32, @truncate(part_index_));
                const is_part_in_this_chunk = is_file_in_chunk and part.is_live;
                for (part.import_record_indices.slice()) |record_id| {
                    const record: *const ImportRecord = &records[record_id];
                    if (record.source_index.isValid() and (record.kind == .stmt or is_part_in_this_chunk)) {
                        if (v.c.isExternalDynamicImport(record, source_index)) {
                            // Don't follow import() dependencies
                            continue;
                        }

                        v.visit(record.source_index.get(), with_code_splitting, with_scb);
                    }
                }

                // Then include this part after the files it imports
                if (is_part_in_this_chunk) {
                    is_file_in_chunk = true;

                    if (can_be_split and
                        part_index != js_ast.namespace_export_part_index and
                        v.c.shouldIncludePart(source_index, part))
                    {
                        const js_parts = if (source_index == Index.runtime.value)
                            &v.parts_prefix
                        else
                            &v.part_ranges;

                        appendOrExtendRange(js_parts, source_index, part_index);
                    }
                }
            }

            if (is_file_in_chunk) {
                if (with_scb and v.c.graph.is_scb_bitset.isSet(source_index)) {
                    v.c.graph.files.items(.entry_point_chunk_index)[source_index] = v.chunk_index;
                }

                bun.handleOom(v.files.append(source_index));

                // CommonJS files are all-or-nothing so all parts must be contiguous
                if (!can_be_split) {
                    v.parts_prefix.append(
                        .{
                            .source_index = Index.init(source_index),
                            .part_index_begin = 0,
                            .part_index_end = @as(u32, @truncate(parts.len)),
                        },
                    ) catch |err| bun.handleOom(err);
                }
            }
        }
    };

    part_ranges_shared.clearRetainingCapacity();
    parts_prefix_shared.clearRetainingCapacity();

    var visitor = FindImportedPartsVisitor{
        .files = std.array_list.Managed(Index.Int).init(this.allocator()),
        .part_ranges = part_ranges_shared.*,
        .parts_prefix = parts_prefix_shared.*,
        .visited = std.AutoHashMap(Index.Int, void).init(this.allocator()),
        .flags = this.graph.meta.items(.flags),
        .parts = this.graph.ast.items(.parts),
        .import_records = this.graph.ast.items(.import_records),
        .entry_bits = chunk.entryBits(),
        .c = this,
        .entry_point = chunk.entry_point,
        .chunk_index = chunk_index,
    };
    defer {
        part_ranges_shared.* = visitor.part_ranges;
        parts_prefix_shared.* = visitor.parts_prefix;
        visitor.visited.deinit();
    }

    switch (this.graph.code_splitting) {
        inline else => |with_code_splitting| switch (this.graph.is_scb_bitset.bit_length > 0) {
            inline else => |with_scb| {
                visitor.visit(Index.runtime.value, with_code_splitting, with_scb);

                for (chunk_order_array.items) |order| {
                    visitor.visit(order.source_index, with_code_splitting, with_scb);
                }
            },
        },
    }

    const parts_in_chunk_order = try this.allocator().alloc(PartRange, visitor.part_ranges.items.len + visitor.parts_prefix.items.len);
    bun.concat(PartRange, parts_in_chunk_order, &.{
        visitor.parts_prefix.items,
        visitor.part_ranges.items,
    });
    chunk.content.javascript.files_in_chunk_order = visitor.files.items;
    chunk.content.javascript.parts_in_chunk_in_order = parts_in_chunk_order;
}

pub const BitSet = bun.bit_set.DynamicBitSetUnmanaged;

const std = @import("std");

const bun = @import("bun");
const BabyList = bun.BabyList;
const ImportRecord = bun.ImportRecord;
const AutoBitSet = bun.bit_set.AutoBitSet;

const Chunk = bun.bundle_v2.Chunk;
const Index = bun.bundle_v2.Index;
const JSMeta = bun.bundle_v2.JSMeta;
const LinkerContext = bun.bundle_v2.LinkerContext;
const Part = bun.bundle_v2.Part;
const PartRange = bun.bundle_v2.PartRange;
const js_ast = bun.bundle_v2.js_ast;
