const Mapping = @This();

const debug = bun.Output.scoped(.SourceMap, .visible);

generated: LineColumnOffset,
original: LineColumnOffset,
source_index: i32,
name_index: i32 = -1,

/// Optimization: if we don't care about the "names" column, then don't store the names.
pub const MappingWithoutName = struct {
    generated: LineColumnOffset,
    original: LineColumnOffset,
    source_index: i32,

    pub fn toNamed(this: *const MappingWithoutName) Mapping {
        return .{
            .generated = this.generated,
            .original = this.original,
            .source_index = this.source_index,
            .name_index = -1,
        };
    }
};

pub const List = struct {
    impl: Value = .{ .without_names = .{} },
    names: []const bun.Semver.String = &[_]bun.Semver.String{},
    names_buffer: bun.ByteList = .{},

    pub const Value = union(enum) {
        without_names: bun.MultiArrayList(MappingWithoutName),
        with_names: bun.MultiArrayList(Mapping),

        pub fn memoryCost(this: *const Value) usize {
            return switch (this.*) {
                .without_names => |*list| list.memoryCost(),
                .with_names => |*list| list.memoryCost(),
            };
        }

        pub fn ensureTotalCapacity(this: *Value, allocator: std.mem.Allocator, count: usize) !void {
            switch (this.*) {
                inline else => |*list| try list.ensureTotalCapacity(allocator, count),
            }
        }
    };

    fn ensureWithNames(this: *List, allocator: std.mem.Allocator) !void {
        if (this.impl == .with_names) return;

        var without_names = this.impl.without_names;
        var with_names = bun.MultiArrayList(Mapping){};
        try with_names.ensureTotalCapacity(allocator, without_names.len);
        defer without_names.deinit(allocator);

        with_names.len = without_names.len;
        var old_slices = without_names.slice();
        var new_slices = with_names.slice();

        @memcpy(new_slices.items(.generated), old_slices.items(.generated));
        @memcpy(new_slices.items(.original), old_slices.items(.original));
        @memcpy(new_slices.items(.source_index), old_slices.items(.source_index));
        @memset(new_slices.items(.name_index), -1);

        this.impl = .{ .with_names = with_names };
    }

    fn findIndexFromGenerated(line_column_offsets: []const LineColumnOffset, line: bun.Ordinal, column: bun.Ordinal) ?usize {
        var count = line_column_offsets.len;
        var index: usize = 0;
        while (count > 0) {
            const step = count / 2;
            const i: usize = index + step;
            const mapping = line_column_offsets[i];
            if (mapping.lines.zeroBased() < line.zeroBased() or (mapping.lines.zeroBased() == line.zeroBased() and mapping.columns.zeroBased() <= column.zeroBased())) {
                index = i + 1;
                count -|= step + 1;
            } else {
                count = step;
            }
        }

        if (index > 0) {
            if (line_column_offsets[index - 1].lines.zeroBased() == line.zeroBased()) {
                return index - 1;
            }
        }

        return null;
    }

    pub fn findIndex(this: *const List, line: bun.Ordinal, column: bun.Ordinal) ?usize {
        switch (this.impl) {
            inline else => |*list| {
                if (findIndexFromGenerated(list.items(.generated), line, column)) |i| {
                    return i;
                }
            },
        }

        return null;
    }

    const SortContext = struct {
        generated: []const LineColumnOffset,
        pub fn lessThan(ctx: SortContext, a_index: usize, b_index: usize) bool {
            const a = ctx.generated[a_index];
            const b = ctx.generated[b_index];

            if (a.lines.zeroBased() != b.lines.zeroBased()) {
                return a.lines.zeroBased() < b.lines.zeroBased();
            }
            if (a.columns.zeroBased() != b.columns.zeroBased()) {
                return a.columns.zeroBased() < b.columns.zeroBased();
            }
            return a_index < b_index;
        }
    };

    pub fn sort(this: *List) void {
        switch (this.impl) {
            .without_names => |*list| list.sort(SortContext{ .generated = list.items(.generated) }),
            .with_names => |*list| list.sort(SortContext{ .generated = list.items(.generated) }),
        }
    }

    pub fn append(this: *List, allocator: std.mem.Allocator, mapping: *const Mapping) !void {
        switch (this.impl) {
            .without_names => |*list| {
                try list.append(allocator, .{
                    .generated = mapping.generated,
                    .original = mapping.original,
                    .source_index = mapping.source_index,
                });
            },
            .with_names => |*list| {
                try list.append(allocator, mapping.*);
            },
        }
    }

    pub fn find(this: *const List, line: bun.Ordinal, column: bun.Ordinal) ?Mapping {
        switch (this.impl) {
            inline else => |*list, tag| {
                if (findIndexFromGenerated(list.items(.generated), line, column)) |i| {
                    if (tag == .without_names) {
                        return list.get(i).toNamed();
                    } else {
                        return list.get(i);
                    }
                }
            },
        }

        return null;
    }
    pub fn generated(self: *const List) []const LineColumnOffset {
        return switch (self.impl) {
            inline else => |*list| list.items(.generated),
        };
    }

    pub fn original(self: *const List) []const LineColumnOffset {
        return switch (self.impl) {
            inline else => |*list| list.items(.original),
        };
    }

    pub fn sourceIndex(self: *const List) []const i32 {
        return switch (self.impl) {
            inline else => |*list| list.items(.source_index),
        };
    }

    pub fn nameIndex(self: *const List) []const i32 {
        return switch (self.impl) {
            inline else => |*list| list.items(.name_index),
        };
    }

    pub fn deinit(self: *List, allocator: std.mem.Allocator) void {
        switch (self.impl) {
            inline else => |*list| list.deinit(allocator),
        }

        self.names_buffer.deinit(allocator);
        allocator.free(self.names);
    }

    pub fn getName(this: *List, index: i32) ?[]const u8 {
        if (index < 0) return null;
        const i: usize = @intCast(index);

        if (i >= this.names.len) return null;

        if (this.impl == .with_names) {
            const str: *const bun.Semver.String = &this.names[i];
            return str.slice(this.names_buffer.slice());
        }

        return null;
    }

    pub fn memoryCost(this: *const List) usize {
        return this.impl.memoryCost() + this.names_buffer.memoryCost() +
            (this.names.len * @sizeOf(bun.Semver.String));
    }

    pub fn ensureTotalCapacity(this: *List, allocator: std.mem.Allocator, count: usize) !void {
        try this.impl.ensureTotalCapacity(allocator, count);
    }
};

pub const Lookup = struct {
    mapping: Mapping,
    source_map: ?*ParsedSourceMap = null,
    /// Owned by default_allocator always
    /// use `getSourceCode` to access this as a Slice
    prefetched_source_code: ?[]const u8,

    name: ?[]const u8 = null,

    /// This creates a bun.String if the source remap *changes* the source url,
    /// which is only possible if the executed file differs from the source file:
    ///
    /// - `bun build --sourcemap`, it is another file on disk
    /// - `bun build --compile --sourcemap`, it is an embedded file.
    pub fn displaySourceURLIfNeeded(lookup: Lookup, base_filename: []const u8) ?bun.String {
        const source_map = lookup.source_map orelse return null;
        // See doc comment on `external_source_names`
        if (source_map.external_source_names.len == 0)
            return null;
        if (lookup.mapping.source_index >= source_map.external_source_names.len)
            return null;

        const name = source_map.external_source_names[@intCast(lookup.mapping.source_index)];

        if (source_map.is_standalone_module_graph) {
            return bun.String.cloneUTF8(name);
        }

        if (std.fs.path.isAbsolute(base_filename)) {
            const dir = bun.path.dirname(base_filename, .auto);
            return bun.String.cloneUTF8(bun.path.joinAbs(dir, .auto, name));
        }

        return bun.String.init(name);
    }

    /// Only valid if `lookup.source_map.isExternal()`
    /// This has the possibility of invoking a call to the filesystem.
    ///
    /// This data is freed after printed on the assumption that printing
    /// errors to the console are rare (this isnt used for error.stack)
    pub fn getSourceCode(lookup: Lookup, base_filename: []const u8) ?bun.jsc.ZigString.Slice {
        const bytes = bytes: {
            if (lookup.prefetched_source_code) |code| {
                break :bytes code;
            }

            const source_map = lookup.source_map orelse return null;
            assert(source_map.isExternal());

            const provider = source_map.underlying_provider.provider() orelse
                return null;

            const index = lookup.mapping.source_index;

            // Standalone module graph source maps are stored (in memory) compressed.
            // They are decompressed on demand.
            if (source_map.is_standalone_module_graph) {
                const serialized = source_map.standaloneModuleGraphData();
                if (index >= source_map.external_source_names.len)
                    return null;

                const code = serialized.sourceFileContents(@intCast(index));

                return bun.jsc.ZigString.Slice.fromUTF8NeverFree(code orelse return null);
            }

            if (provider.getSourceMap(
                base_filename,
                source_map.underlying_provider.load_hint,
                .{ .source_only = @intCast(index) },
            )) |parsed|
                if (parsed.source_contents) |contents|
                    break :bytes contents;

            if (index >= source_map.external_source_names.len)
                return null;

            const name = source_map.external_source_names[@intCast(index)];

            var buf: bun.PathBuffer = undefined;
            const normalized = bun.path.joinAbsStringBufZ(
                bun.path.dirname(base_filename, .auto),
                &buf,
                &.{name},
                .loose,
            );
            switch (bun.sys.File.readFrom(
                std.fs.cwd(),
                normalized,
                bun.default_allocator,
            )) {
                .result => |r| break :bytes r,
                .err => return null,
            }
        };

        return bun.jsc.ZigString.Slice.init(bun.default_allocator, bytes);
    }
};

pub inline fn generatedLine(mapping: *const Mapping) i32 {
    return mapping.generated.lines.zeroBased();
}

pub inline fn generatedColumn(mapping: *const Mapping) i32 {
    return mapping.generated.columns.zeroBased();
}

pub inline fn sourceIndex(mapping: *const Mapping) i32 {
    return mapping.source_index;
}

pub inline fn originalLine(mapping: *const Mapping) i32 {
    return mapping.original.lines.zeroBased();
}

pub inline fn originalColumn(mapping: *const Mapping) i32 {
    return mapping.original.columns.zeroBased();
}

pub inline fn nameIndex(mapping: *const Mapping) i32 {
    return mapping.name_index;
}

pub fn parse(
    allocator: std.mem.Allocator,
    bytes: []const u8,
    estimated_mapping_count: ?usize,
    sources_count: i32,
    input_line_count: usize,
    options: struct {
        allow_names: bool = false,
        sort: bool = false,
    },
) ParseResult {
    debug("parse mappings ({d} bytes)", .{bytes.len});

    var mapping = Mapping.List{};
    errdefer mapping.deinit(allocator);

    if (estimated_mapping_count) |count| {
        mapping.ensureTotalCapacity(allocator, count) catch {
            return .{
                .fail = .{
                    .msg = "Out of memory",
                    .err = error.OutOfMemory,
                    .loc = .{},
                },
            };
        };
    }

    var generated = LineColumnOffset{ .lines = bun.Ordinal.start, .columns = bun.Ordinal.start };
    var original = LineColumnOffset{ .lines = bun.Ordinal.start, .columns = bun.Ordinal.start };
    var name_index: i32 = 0;
    var source_index: i32 = 0;
    var needs_sort = false;
    var remain = bytes;
    var has_names = false;
    while (remain.len > 0) {
        if (remain[0] == ';') {
            generated.columns = bun.Ordinal.start;

            while (strings.hasPrefixComptime(
                remain,
                comptime [_]u8{';'} ** (@sizeOf(usize) / 2),
            )) {
                generated.lines = generated.lines.addScalar(@sizeOf(usize) / 2);
                remain = remain[@sizeOf(usize) / 2 ..];
            }

            while (remain.len > 0 and remain[0] == ';') {
                generated.lines = generated.lines.addScalar(1);
                remain = remain[1..];
            }

            if (remain.len == 0) {
                break;
            }
        }

        // Read the generated column
        const generated_column_delta = decodeVLQ(remain, 0);

        if (generated_column_delta.start == 0) {
            return .{
                .fail = .{
                    .msg = "Missing generated column value",
                    .err = error.MissingGeneratedColumnValue,
                    .value = generated.columns.zeroBased(),
                    .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                },
            };
        }

        needs_sort = needs_sort or generated_column_delta.value < 0;

        generated.columns = generated.columns.addScalar(generated_column_delta.value);
        if (generated.columns.zeroBased() < 0) {
            return .{
                .fail = .{
                    .msg = "Invalid generated column value",
                    .err = error.InvalidGeneratedColumnValue,
                    .value = generated.columns.zeroBased(),
                    .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                },
            };
        }

        remain = remain[generated_column_delta.start..];

        // According to the specification, it's valid for a mapping to have 1,
        // 4, or 5 variable-length fields. Having one field means there's no
        // original location information, which is pretty useless. Just ignore
        // those entries.
        if (remain.len == 0)
            break;

        switch (remain[0]) {
            ',' => {
                remain = remain[1..];
                continue;
            },
            ';' => {
                continue;
            },
            else => {},
        }

        // Read the original source
        const source_index_delta = decodeVLQ(remain, 0);
        if (source_index_delta.start == 0) {
            return .{
                .fail = .{
                    .msg = "Invalid source index delta",
                    .err = error.InvalidSourceIndexDelta,
                    .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                },
            };
        }
        source_index += source_index_delta.value;

        if (source_index < 0 or source_index >= sources_count) {
            return .{
                .fail = .{
                    .msg = "Invalid source index value",
                    .err = error.InvalidSourceIndexValue,
                    .value = source_index,
                    .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                },
            };
        }
        remain = remain[source_index_delta.start..];

        // Read the original line
        const original_line_delta = decodeVLQ(remain, 0);
        if (original_line_delta.start == 0) {
            return .{
                .fail = .{
                    .msg = "Missing original line",
                    .err = error.MissingOriginalLine,
                    .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                },
            };
        }

        original.lines = original.lines.addScalar(original_line_delta.value);
        if (original.lines.zeroBased() < 0) {
            return .{
                .fail = .{
                    .msg = "Invalid original line value",
                    .err = error.InvalidOriginalLineValue,
                    .value = original.lines.zeroBased(),
                    .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                },
            };
        }
        remain = remain[original_line_delta.start..];

        // Read the original column
        const original_column_delta = decodeVLQ(remain, 0);
        if (original_column_delta.start == 0) {
            return .{
                .fail = .{
                    .msg = "Missing original column value",
                    .err = error.MissingOriginalColumnValue,
                    .value = original.columns.zeroBased(),
                    .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                },
            };
        }

        original.columns = original.columns.addScalar(original_column_delta.value);
        if (original.columns.zeroBased() < 0) {
            return .{
                .fail = .{
                    .msg = "Invalid original column value",
                    .err = error.InvalidOriginalColumnValue,
                    .value = original.columns.zeroBased(),
                    .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                },
            };
        }
        remain = remain[original_column_delta.start..];

        if (remain.len > 0) {
            switch (remain[0]) {
                ',' => {
                    // 4 column, but there's more on this line.
                    remain = remain[1..];
                },
                // 4 column, and there's no more on this line.
                ';' => {},

                // 5th column: the name
                else => |c| {
                    // Read the name index
                    const name_index_delta = decodeVLQ(remain, 0);
                    if (name_index_delta.start == 0) {
                        return .{
                            .fail = .{
                                .msg = "Invalid name index delta",
                                .err = error.InvalidNameIndexDelta,
                                .value = @intCast(c),
                                .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                            },
                        };
                    }
                    remain = remain[name_index_delta.start..];

                    if (options.allow_names) {
                        name_index += name_index_delta.value;
                        if (!has_names) {
                            mapping.ensureWithNames(allocator) catch {
                                return .{
                                    .fail = .{
                                        .msg = "Out of memory",
                                        .err = error.OutOfMemory,
                                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                                    },
                                };
                            };
                        }
                        has_names = true;
                    }

                    if (remain.len > 0) {
                        switch (remain[0]) {
                            // There's more on this line.
                            ',' => {
                                remain = remain[1..];
                            },
                            // That's the end of the line.
                            ';' => {},
                            else => {},
                        }
                    }
                },
            }
        }
        mapping.append(allocator, &.{
            .generated = generated,
            .original = original,
            .source_index = source_index,
            .name_index = name_index,
        }) catch |err| bun.handleOom(err);
    }

    if (needs_sort and options.sort) {
        mapping.sort();
    }

    return .{ .success = .{
        .ref_count = .init(),
        .mappings = mapping,
        .input_line_count = input_line_count,
    } };
}

const std = @import("std");

const SourceMap = @import("./sourcemap.zig");
const LineColumnOffset = SourceMap.LineColumnOffset;
const ParseResult = SourceMap.ParseResult;
const ParsedSourceMap = SourceMap.ParsedSourceMap;
const decodeVLQ = SourceMap.VLQ.decode;

const bun = @import("bun");
const assert = bun.assert;
const strings = bun.strings;
