const StaticRouteVisitor = @This();

c: *LinkerContext,
cache: std.AutoArrayHashMapUnmanaged(Index.Int, bool) = .{},

pub fn deinit(this: *StaticRouteVisitor) void {
    this.cache.deinit(bun.default_allocator);
}

/// This the quickest, simplest, dumbest way I can think of doing this. Investigate performance.
pub fn isFullyStatic(this: *StaticRouteVisitor, entry_point_source_index: u32) bool {
    const all_import_records: []const ImportRecord.List = this.c.parse_graph.ast.items(.import_records);
    const referenced_source_indices: []const u32 = this.c.parse_graph.server_component_boundaries.list.items(.reference_source_index);
    const use_directives: []const UseDirective = this.c.parse_graph.server_component_boundaries.list.items(.use_directive);

    return this.isFullyStaticImpl(
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
fn isFullyStaticImpl(
    this: *StaticRouteVisitor,
    all_import_records: []const ImportRecord.List,
    referenced_source_indices: []const u32,
    use_directives: []const UseDirective,
    source_index: Index,
) bool {
    if (this.cache.get(source_index.get())) |result| {
        return result;
    }

    const import_records = all_import_records[source_index.get()];

    const result = result: {
        for (import_records.sliceConst()) |*import_record| {
            if (!import_record.source_index.isValid()) continue;

            // check if this import is a client boundary
            for (referenced_source_indices, use_directives) |referenced_source_index, use_directive| {
                if (use_directive != .client) continue;
                // it's a client boundary
                if (referenced_source_index == import_record.source_index.get()) break :result false;
            }

            // otherwise check its children
            if (!this.isFullyStaticImpl(
                all_import_records,
                referenced_source_indices,
                use_directives,
                import_record.source_index,
            )) break :result false;
        }
        break :result true;
    };

    this.cache.put(bun.default_allocator, source_index.get(), result) catch unreachable;

    return result;
}

const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const LinkerContext = bun.bundle_v2.LinkerContext;
const Index = bun.bundle_v2.Index;

const js_ast = bun.js_ast.UseDirective;
const ImportRecord = bun.bundle_v2.ImportRecord;
const UseDirective = bun.bundle_v2.UseDirective;
