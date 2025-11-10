const ParsedSourceMap = @This();

const RefCount = bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

/// ParsedSourceMap can be acquired by different threads via the thread-safe
/// source map store (SavedSourceMap), so the reference count must be thread-safe.
ref_count: RefCount,

input_line_count: usize = 0,
mappings: Mapping.List = .{},

/// If this is empty, this implies that the source code is a single file
/// transpiled on-demand. If there are items, then it means this is a file
/// loaded without transpilation but with external sources. This array
/// maps `source_index` to the correct filename.
external_source_names: []const []const u8 = &.{},
/// In order to load source contents from a source-map after the fact,
/// a handle to the underlying source provider is stored. Within this pointer,
/// a flag is stored if it is known to be an inline or external source map.
///
/// Source contents are large, we don't preserve them in memory. This has
/// the downside of repeatedly re-decoding sourcemaps if multiple errors
/// are emitted (specifically with Bun.inspect / unhandled; the ones that
/// rely on source contents)
underlying_provider: SourceContentPtr = .none,

is_standalone_module_graph: bool = false,

const SourceProviderKind = enum(u2) { zig, bake, dev_server };
const AnySourceProvider = union(enum) {
    zig: *SourceProviderMap,
    bake: *BakeSourceProvider,
    dev_server: *DevServerSourceProvider,

    pub fn ptr(this: AnySourceProvider) *anyopaque {
        return switch (this) {
            .zig => @ptrCast(this.zig),
            .bake => @ptrCast(this.bake),
            .dev_server => @ptrCast(this.dev_server),
        };
    }

    pub fn getSourceMap(
        this: AnySourceProvider,
        source_filename: []const u8,
        load_hint: SourceMapLoadHint,
        result: ParseUrlResultHint,
    ) ?SourceMap.ParseUrl {
        return switch (this) {
            .zig => this.zig.getSourceMap(source_filename, load_hint, result),
            .bake => this.bake.getSourceMap(source_filename, load_hint, result),
            .dev_server => this.dev_server.getSourceMap(source_filename, load_hint, result),
        };
    }
};

pub const SourceContentPtr = packed struct(u64) {
    load_hint: SourceMapLoadHint,
    kind: SourceProviderKind,
    data: u60,

    pub const none: SourceContentPtr = .{ .load_hint = .none, .kind = .zig, .data = 0 };

    pub fn fromProvider(p: *SourceProviderMap) SourceContentPtr {
        return .{ .load_hint = .none, .data = @intCast(@intFromPtr(p)), .kind = .zig };
    }

    pub fn fromBakeProvider(p: *BakeSourceProvider) SourceContentPtr {
        return .{ .load_hint = .none, .data = @intCast(@intFromPtr(p)), .kind = .bake };
    }

    pub fn fromDevServerProvider(p: *DevServerSourceProvider) SourceContentPtr {
        return .{ .load_hint = .none, .data = @intCast(@intFromPtr(p)), .kind = .dev_server };
    }

    pub fn provider(sc: SourceContentPtr) ?AnySourceProvider {
        switch (sc.kind) {
            .zig => return .{ .zig = @ptrFromInt(sc.data) },
            .bake => return .{ .bake = @ptrFromInt(sc.data) },
            .dev_server => return .{ .dev_server = @ptrFromInt(sc.data) },
        }
    }
};

pub fn isExternal(psm: *ParsedSourceMap) bool {
    return psm.external_source_names.len != 0;
}

fn deinit(this: *ParsedSourceMap) void {
    const allocator = bun.default_allocator;

    this.mappings.deinit(allocator);

    if (this.external_source_names.len > 0) {
        for (this.external_source_names) |name|
            allocator.free(name);
        allocator.free(this.external_source_names);
    }

    bun.destroy(this);
}

pub fn standaloneModuleGraphData(this: *ParsedSourceMap) *bun.StandaloneModuleGraph.SerializedSourceMap.Loaded {
    bun.assert(this.is_standalone_module_graph);
    return @ptrFromInt(this.underlying_provider.data);
}

pub fn memoryCost(this: *const ParsedSourceMap) usize {
    return @sizeOf(ParsedSourceMap) + this.mappings.memoryCost() + this.external_source_names.len * @sizeOf([]const u8);
}

pub fn writeVLQs(map: *const ParsedSourceMap, writer: anytype) !void {
    var last_col: i32 = 0;
    var last_src: i32 = 0;
    var last_ol: i32 = 0;
    var last_oc: i32 = 0;
    var current_line: i32 = 0;
    for (
        map.mappings.generated(),
        map.mappings.original(),
        map.mappings.sourceIndex(),
        0..,
    ) |gen, orig, source_index, i| {
        if (current_line != gen.lines.zeroBased()) {
            assert(gen.lines.zeroBased() > current_line);
            const inc = gen.lines.zeroBased() - current_line;
            try writer.splatByteAll(';', @intCast(inc));
            current_line = gen.lines.zeroBased();
            last_col = 0;
        } else if (i != 0) {
            try writer.writeByte(',');
        }
        try VLQ.encode(gen.columns.zeroBased() - last_col).writeTo(writer);
        last_col = gen.columns.zeroBased();
        try VLQ.encode(source_index - last_src).writeTo(writer);
        last_src = source_index;
        try VLQ.encode(orig.lines.zeroBased() - last_ol).writeTo(writer);
        last_ol = orig.lines.zeroBased();
        try VLQ.encode(orig.columns.zeroBased() - last_oc).writeTo(writer);
        last_oc = orig.columns.zeroBased();
    }
}

pub fn formatVLQs(map: *const ParsedSourceMap) std.fmt.Alt(*const ParsedSourceMap, formatVLQsImpl) {
    return .{ .data = map };
}

fn formatVLQsImpl(map: *const ParsedSourceMap, w: *std.Io.Writer) !void {
    try map.writeVLQs(w);
}

const std = @import("std");

const SourceMap = @import("./sourcemap.zig");
const BakeSourceProvider = SourceMap.BakeSourceProvider;
const DevServerSourceProvider = SourceMap.DevServerSourceProvider;
const Mapping = SourceMap.Mapping;
const ParseUrlResultHint = SourceMap.ParseUrlResultHint;
const SourceMapLoadHint = SourceMap.SourceMapLoadHint;
const SourceProviderMap = SourceMap.SourceProviderMap;
const VLQ = SourceMap.VLQ;

const bun = @import("bun");
const assert = bun.assert;
