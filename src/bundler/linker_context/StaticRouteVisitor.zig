//! The `isFullyStatic(source_index)` function returns whether or not
//! `source_index` imports a file with `"use client"`.
//!
//! TODO: Could we move this into the ReachableFileVisitor inside `bundle_v2.zig`?

const StaticRouteVisitor = @This();

c: *LinkerContext,
cache: std.AutoArrayHashMapUnmanaged(Index.Int, bool) = .{},
visited: bun.bit_set.AutoBitSet,

pub fn deinit(this: *StaticRouteVisitor) void {
    this.cache.deinit(bun.default_allocator);
    this.visited.deinit(bun.default_allocator);
}

/// This the quickest, simplest, dumbest way I can think of doing this.
/// Investigate performance. It can have false negatives (it doesn't properly
/// handle cycles), but that's okay as it's just used an optimization
pub fn hasTransitiveUseClient(this: *StaticRouteVisitor, entry_point_source_index: u32) bool {
    if (bun.Environment.isDebug and bun.env_var.BUN_SSG_DISABLE_STATIC_ROUTE_VISITOR.get()) {
        return false;
    }

    const all_import_records: []const ImportRecord.List = this.c.parse_graph.ast.items(.import_records);
    const referenced_source_indices: []const u32 = this.c.parse_graph.server_component_boundaries.list.items(.reference_source_index);
    const use_directives: []const UseDirective = this.c.parse_graph.server_component_boundaries.list.items(.use_directive);

    return this.hasTransitiveUseClientImpl(
        all_import_records,
        referenced_source_indices,
        use_directives,
        Index.init(entry_point_source_index),
    );
}

/// 1. Get AST for `source_index`
/// 2. Recursively traverse its imports in import records
/// 3. If any of the imports match any item in
///    `referenced_source_indices` which has `use_directive ==
///    .client`, then we know `source_index` is NOT fully
///    static.
fn hasTransitiveUseClientImpl(
    this: *StaticRouteVisitor,
    all_import_records: []const ImportRecord.List,
    referenced_source_indices: []const u32,
    use_directives: []const UseDirective,
    source_index: Index,
) bool {
    if (this.cache.get(source_index.get())) |result| {
        return result;
    }
    if (this.visited.isSet(source_index.get())) {
        return false;
    }
    this.visited.set(source_index.get());

    const import_records = all_import_records[source_index.get()];

    const result = result: {
        for (import_records.sliceConst()) |*import_record| {
            if (!import_record.source_index.isValid()) continue;

            // check if this import is a client boundary
            for (referenced_source_indices, use_directives) |referenced_source_index, use_directive| {
                if (use_directive != .client) continue;
                // it's a client boundary
                if (referenced_source_index == import_record.source_index.get()) break :result true;
            }

            // otherwise check its children
            if (this.hasTransitiveUseClientImpl(
                all_import_records,
                referenced_source_indices,
                use_directives,
                import_record.source_index,
            )) break :result true;
        }
        break :result false;
    };

    this.cache.put(bun.default_allocator, source_index.get(), result) catch unreachable;

    return result;
}

const bun = @import("bun");
const std = @import("std");

const ImportRecord = bun.bundle_v2.ImportRecord;
const Index = bun.bundle_v2.Index;
const LinkerContext = bun.bundle_v2.LinkerContext;
const UseDirective = bun.bundle_v2.UseDirective;
