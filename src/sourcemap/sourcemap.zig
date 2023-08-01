pub const VLQ_BASE_SHIFT: u32 = 5;
pub const VLQ_BASE: u32 = 1 << VLQ_BASE_SHIFT;
pub const VLQ_BASE_MASK: u32 = VLQ_BASE - 1;
pub const VLQ_CONTINUATION_BIT: u32 = VLQ_BASE;
pub const VLQ_CONTINUATION_MASK: u32 = 1 << VLQ_CONTINUATION_BIT;
const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const JSAst = bun.JSAst;
const BabyList = JSAst.BabyList;
const Logger = @import("root").bun.logger;
const strings = bun.strings;
const MutableString = bun.MutableString;
const Joiner = @import("../string_joiner.zig");
const JSPrinter = bun.js_printer;
const URL = bun.URL;
const FileSystem = bun.fs.FileSystem;

const SourceMap = @This();

/// Coordinates in source maps are stored using relative offsets for size
/// reasons. When joining together chunks of a source map that were emitted
/// in parallel for different parts of a file, we need to fix up the first
/// segment of each chunk to be relative to the end of the previous chunk.
pub const SourceMapState = struct {
    /// This isn't stored in the source map. It's only used by the bundler to join
    /// source map chunks together correctly.
    generated_line: i32 = 0,

    /// These are stored in the source map in VLQ format.
    generated_column: i32 = 0,
    source_index: i32 = 0,
    original_line: i32 = 0,
    original_column: i32 = 0,
};

sources: [][]const u8 = &[_][]u8{},
sources_content: []string,
mapping: Mapping.List = .{},
allocator: std.mem.Allocator,

pub fn parse(
    allocator: std.mem.Allocator,
    json_source: *const Logger.Source,
    log: *Logger.Log,
) !SourceMap {
    var json = try bun.JSON.ParseJSONUTF8(json_source, log, allocator);
    var mappings = bun.sourcemap.Mapping.List{};

    if (json.get("version")) |version| {
        if (version.data != .e_number or version.data.e_number.value != 3.0) {
            return error.@"Unsupported sourcemap version";
        }
    }

    if (json.get("mappings")) |mappings_str| {
        if (mappings_str.data != .e_string) {
            return error.@"Invalid sourcemap mappings";
        }

        var parsed = bun.sourcemap.Mapping.parse(allocator, try mappings_str.data.e_string.toUTF8(allocator), null, std.math.maxInt(i32));
        if (parsed == .fail) {
            try log.addMsg(bun.logger.Msg{
                .data = parsed.fail.toData("sourcemap.json"),
                .kind = .err,
            });
            return error.@"Failed to parse sourcemap mappings";
        }

        mappings = parsed.success;
    }

    var sources = std.ArrayList(bun.string).init(allocator);
    var sources_content = std.ArrayList(string).init(allocator);

    if (json.get("sourcesContent")) |mappings_str| {
        if (mappings_str.data != .e_array) {
            return error.@"Invalid sourcemap sources";
        }

        try sources_content.ensureTotalCapacityPrecise(mappings_str.data.e_array.items.len);
        for (mappings_str.data.e_array.items.slice()) |source| {
            if (source.data != .e_string) {
                return error.@"Invalid sourcemap source";
            }

            try source.data.e_string.toUTF8(allocator);
            sources_content.appendAssumeCapacity(source.data.e_string.slice());
        }
    }

    if (json.get("sources")) |mappings_str| {
        if (mappings_str.data != .e_array) {
            return error.@"Invalid sourcemap sources";
        }

        try sources.ensureTotalCapacityPrecise(mappings_str.data.e_array.items.len);
        for (mappings_str.data.e_array.items.slice()) |source| {
            if (source.data != .e_string) {
                return error.@"Invalid sourcemap source";
            }

            try source.data.e_string.toUTF8(allocator);
            sources.appendAssumeCapacity(source.data.e_string.slice());
        }
    }

    return SourceMap{
        .mapping = mappings,
        .allocator = allocator,
        .sources_content = sources_content.items,
        .sources = sources.items,
    };
}

pub const Mapping = struct {
    generated: LineColumnOffset,
    original: LineColumnOffset,
    source_index: i32,

    pub const List = std.MultiArrayList(Mapping);

    pub inline fn generatedLine(mapping: Mapping) i32 {
        return mapping.generated.lines;
    }

    pub inline fn generatedColumn(mapping: Mapping) i32 {
        return mapping.generated.columns;
    }

    pub inline fn sourceIndex(mapping: Mapping) i32 {
        return mapping.source_index;
    }

    pub inline fn originalLine(mapping: Mapping) i32 {
        return mapping.original.lines;
    }

    pub inline fn originalColumn(mapping: Mapping) i32 {
        return mapping.original.columns;
    }

    pub fn find(mappings: Mapping.List, line: i32, column: i32) ?Mapping {
        if (findIndex(mappings, line, column)) |i| {
            return mappings.get(i);
        }

        return null;
    }

    pub fn findIndex(mappings: Mapping.List, line: i32, column: i32) ?usize {
        const generated = mappings.items(.generated);

        var count = generated.len;
        var index: usize = 0;
        while (count > 0) {
            var step = count / 2;
            var i: usize = index + step;
            const mapping = generated[i];
            if (mapping.lines < line or (mapping.lines == line and mapping.columns <= column)) {
                index = i + 1;
                count -|= step + 1;
            } else {
                count = step;
            }
        }

        if (index > 0) {
            if (generated[index - 1].lines == line) {
                return index - 1;
            }
        }

        return null;
    }

    pub fn parse(
        allocator: std.mem.Allocator,
        bytes: []const u8,
        estimated_mapping_count: ?usize,
        sources_count: i32,
    ) ParseResult {
        var mapping = Mapping.List{};
        if (estimated_mapping_count) |count| {
            mapping.ensureTotalCapacity(allocator, count) catch unreachable;
        }

        var generated = LineColumnOffset{ .lines = 0, .columns = 0 };
        var original = LineColumnOffset{ .lines = 0, .columns = 0 };
        var source_index: i32 = 0;
        var needs_sort = false;
        var remain = bytes;
        while (remain.len > 0) {
            if (remain[0] == ';') {
                generated.columns = 0;

                while (strings.hasPrefixComptime(
                    remain,
                    comptime [_]u8{';'} ** (@sizeOf(usize) / 2),
                )) {
                    generated.lines += (@sizeOf(usize) / 2);
                    remain = remain[@sizeOf(usize) / 2 ..];
                }

                while (remain.len > 0 and remain[0] == ';') {
                    generated.lines += 1;
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
                        .value = generated.columns,
                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                    },
                };
            }

            needs_sort = needs_sort or generated_column_delta.value < 0;

            generated.columns += generated_column_delta.value;
            if (generated.columns < 0) {
                return .{
                    .fail = .{
                        .msg = "Invalid generated column value",
                        .err = error.InvalidGeneratedColumnValue,
                        .value = generated.columns,
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

            if (source_index < 0 or source_index > sources_count) {
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

            // // "AAAA" is extremely common
            // if (strings.hasPrefixComptime(remain, "AAAA;")) {

            // }

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

            original.lines += original_line_delta.value;
            if (original.lines < 0) {
                return .{
                    .fail = .{
                        .msg = "Invalid original line value",
                        .err = error.InvalidOriginalLineValue,
                        .value = original.lines,
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
                        .value = original.columns,
                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                    },
                };
            }

            original.columns += original_column_delta.value;
            if (original.columns < 0) {
                return .{
                    .fail = .{
                        .msg = "Invalid original column value",
                        .err = error.InvalidOriginalColumnValue,
                        .value = original.columns,
                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                    },
                };
            }
            remain = remain[original_column_delta.start..];

            if (remain.len > 0) {
                switch (remain[0]) {
                    ',' => {
                        remain = remain[1..];
                    },
                    ';' => {},
                    else => |c| {
                        return .{
                            .fail = .{
                                .msg = "Invalid character after mapping",
                                .err = error.InvalidSourceMap,
                                .value = @as(i32, @intCast(c)),
                                .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                            },
                        };
                    },
                }
            }
            mapping.append(allocator, .{
                .generated = generated,
                .original = original,
                .source_index = source_index,
            }) catch unreachable;
        }

        return ParseResult{ .success = mapping };
    }

    pub const ParseResult = union(enum) {
        fail: struct {
            loc: Logger.Loc,
            err: anyerror,
            value: i32 = 0,
            msg: []const u8 = "",

            pub fn toData(this: @This(), path: []const u8) Logger.Data {
                return Logger.Data{
                    .location = Logger.Location{
                        .file = path,
                        .offset = this.loc.toUsize(),
                    },
                    .text = this.msg,
                };
            }
        },
        success: Mapping.List,
    };
};

pub const LineColumnOffset = struct {
    lines: i32 = 0,
    columns: i32 = 0,

    pub const Optional = union(enum) {
        null: void,
        value: LineColumnOffset,

        pub fn advance(this: *Optional, input: []const u8) void {
            switch (this.*) {
                .null => {},
                .value => this.value.advance(input),
            }
        }

        pub fn reset(this: *Optional) void {
            switch (this.*) {
                .null => {},
                .value => this.value = .{},
            }
        }
    };

    pub fn add(this: *LineColumnOffset, b: LineColumnOffset) void {
        if (b.lines == 0) {
            this.columns += b.columns;
        } else {
            this.lines += b.lines;
            this.columns = b.columns;
        }
    }

    pub fn advance(this: *LineColumnOffset, input: []const u8) void {
        var columns = this.columns;
        defer this.columns = columns;
        var offset: u32 = 0;
        while (strings.indexOfNewlineOrNonASCII(input, offset)) |i| {
            std.debug.assert(i >= offset);
            std.debug.assert(i < input.len);

            var iter = strings.CodepointIterator.initOffset(input, i);
            var cursor = strings.CodepointIterator.Cursor{ .i = @as(u32, @truncate(iter.i)) };
            _ = iter.next(&cursor);
            offset = i + cursor.width;

            switch (cursor.c) {
                '\r', '\n', 0x2028, 0x2029 => {
                    // Handle Windows-specific "\r\n" newlines
                    if (cursor.c == '\r' and input.len > i + 1 and input[i + 1] == '\n') {
                        columns += 1;
                        continue;
                    }

                    this.lines += 1;
                    columns = 0;
                },
                else => |c| {
                    // Mozilla's "source-map" library counts columns using UTF-16 code units
                    columns += switch (c) {
                        0...0xFFFF => 1,
                        else => 2,
                    };
                },
            }
        }
    }

    pub fn comesBefore(a: LineColumnOffset, b: LineColumnOffset) bool {
        return a.lines < b.lines or (a.lines == b.lines and a.columns < b.columns);
    }

    pub fn cmp(_: void, a: LineColumnOffset, b: LineColumnOffset) std.math.Order {
        if (a.lines != b.lines) {
            return std.math.order(a.lines, b.lines);
        }

        return std.math.order(a.columns, b.columns);
    }
};

pub const SourceContent = struct {
    value: []const u16 = &[_]u16{},
    quoted: []const u8 = &[_]u8{},
};

pub fn find(
    this: *const SourceMap,
    line: i32,
    column: i32,
) ?Mapping {
    return Mapping.find(this.mapping, line, column);
}

pub const SourceMapShifts = struct {
    before: LineColumnOffset,
    after: LineColumnOffset,
};

pub const SourceMapPieces = struct {
    prefix: std.ArrayList(u8),
    mappings: std.ArrayList(u8),
    suffix: std.ArrayList(u8),

    pub fn init(allocator: std.mem.Allocator) SourceMapPieces {
        return .{
            .prefix = std.ArrayList(u8).init(allocator),
            .mappings = std.ArrayList(u8).init(allocator),
            .suffix = std.ArrayList(u8).init(allocator),
        };
    }

    pub fn hasContent(this: *SourceMapPieces) bool {
        return (this.prefix.items.len + this.mappings.items.len + this.suffix.items.len) > 0;
    }

    pub fn finalize(this: *SourceMapPieces, allocator: std.mem.Allocator, _shifts: []SourceMapShifts) ![]const u8 {
        var shifts = _shifts;
        var start_of_run: usize = 0;
        var current: usize = 0;
        var generated = LineColumnOffset{};
        var prev_shift_column_delta: i32 = 0;
        var j = Joiner{};

        j.push(this.prefix.items);
        const mappings = this.mappings.items;

        while (current < mappings.len) {
            if (mappings[current] == ';') {
                generated.lines += 1;
                generated.columns = 0;
                prev_shift_column_delta = 0;
                current += 1;
                continue;
            }

            var potential_end_of_run = current;

            var decode_result = decodeVLQ(mappings, current);
            generated.columns += decode_result.value;
            current = decode_result.start;

            var potential_start_of_run = current;

            current = decodeVLQ(mappings, current).start;
            current = decodeVLQ(mappings, current).start;
            current = decodeVLQ(mappings, current).start;

            if (current < mappings.len) {
                var c = mappings[current];
                if (c != ',' and c != ';') {
                    current = decodeVLQ(mappings, current).start;
                }
            }

            if (current < mappings.len and mappings[current] == ',') {
                current += 1;
            }

            var did_cross_boundary = false;
            if (shifts.len > 1 and shifts[1].before.comesBefore(generated)) {
                shifts = shifts[1..];
                did_cross_boundary = true;
            }

            if (!did_cross_boundary) {
                continue;
            }

            var shift = shifts[0];
            if (shift.after.lines != generated.lines) {
                continue;
            }

            j.push(mappings[start_of_run..potential_end_of_run]);

            std.debug.assert(shift.before.lines == shift.after.lines);

            var shift_column_delta = shift.after.columns - shift.before.columns;
            const encode = encodeVLQ(decode_result.value + shift_column_delta - prev_shift_column_delta);
            j.push(encode.bytes[0..encode.len]);
            prev_shift_column_delta = shift_column_delta;

            start_of_run = potential_start_of_run;
        }

        j.push(mappings[start_of_run..]);
        j.push(this.suffix.items);

        return try j.done(allocator);
    }
};

// -- comment from esbuild --
// Source map chunks are computed in parallel for speed. Each chunk is relative
// to the zero state instead of being relative to the end state of the previous
// chunk, since it's impossible to know the end state of the previous chunk in
// a parallel computation.
//
// After all chunks are computed, they are joined together in a second pass.
// This rewrites the first mapping in each chunk to be relative to the end
// state of the previous chunk.
pub fn appendSourceMapChunk(j: *Joiner, allocator: std.mem.Allocator, prev_end_state_: SourceMapState, start_state_: SourceMapState, source_map_: bun.string) !void {
    var prev_end_state = prev_end_state_;
    var start_state = start_state_;
    // Handle line breaks in between this mapping and the previous one
    if (start_state.generated_line > 0) {
        j.append(try strings.repeatingAlloc(allocator, @as(usize, @intCast(start_state.generated_line)), ';'), 0, allocator);
        prev_end_state.generated_column = 0;
    }

    var source_map = source_map_;
    if (strings.indexOfNotChar(source_map, ';')) |semicolons| {
        j.push(source_map[0..semicolons]);
        source_map = source_map[semicolons..];
        prev_end_state.generated_column = 0;
        start_state.generated_column = 0;
    }

    // Strip off the first mapping from the buffer. The first mapping should be
    // for the start of the original file (the printer always generates one for
    // the start of the file).
    var i: usize = 0;
    const generated_column_ = decodeVLQ(source_map, 0);
    i = generated_column_.start;
    const source_index_ = decodeVLQ(source_map, i);
    i = source_index_.start;
    const original_line_ = decodeVLQ(source_map, i);
    i = original_line_.start;
    const original_column_ = decodeVLQ(source_map, i);
    i = original_column_.start;

    source_map = source_map[i..];

    // Rewrite the first mapping to be relative to the end state of the previous
    // chunk. We now know what the end state is because we're in the second pass
    // where all chunks have already been generated.
    start_state.source_index += source_index_.value;
    start_state.generated_column += generated_column_.value;
    start_state.original_line += original_line_.value;
    start_state.original_column += original_column_.value;

    j.append(
        appendMappingToBuffer(MutableString.initEmpty(allocator), j.lastByte(), prev_end_state, start_state).list.items,
        0,
        allocator,
    );

    // Then append everything after that without modification.
    j.push(source_map);
}

const vlq_lookup_table: [256]VLQ = brk: {
    var entries: [256]VLQ = undefined;
    var i: usize = 0;
    var j: i32 = 0;
    while (i < 256) : (i += 1) {
        entries[i] = encodeVLQ(j);
        j += 1;
    }
    break :brk entries;
};

const vlq_max_in_bytes = 8;
pub const VLQ = struct {
    // We only need to worry about i32
    // That means the maximum VLQ-encoded value is 8 bytes
    // because there are only 4 bits of number inside each VLQ value
    // and it expects i32
    // therefore, it can never be more than 32 bits long
    // I believe the actual number is 7 bytes long, however we can add an extra byte to be more cautious
    bytes: [vlq_max_in_bytes]u8,
    len: u4 = 0,
};

pub fn encodeVLQWithLookupTable(
    value: i32,
) VLQ {
    return if (value >= 0 and value <= 255)
        vlq_lookup_table[@as(usize, @intCast(value))]
    else
        encodeVLQ(value);
}

test "encodeVLQ" {
    const fixtures = .{
        .{ 2_147_483_647, "+/////D" },
        .{ -2_147_483_647, "//////D" },
        .{ 0, "A" },
        .{ 1, "C" },
        .{ -1, "D" },
        .{ 123, "2H" },
        .{ 123456789, "qxmvrH" },
    };
    inline for (fixtures) |fixture| {
        const result = encodeVLQ(fixture[0]);
        try std.testing.expectEqualStrings(fixture[1], result.bytes[0..result.len]);
    }
}

test "decodeVLQ" {
    const fixtures = .{
        .{ 2_147_483_647, "+/////D" },
        .{ -2_147_483_647, "//////D" },
        .{ 0, "A" },
        .{ 1, "C" },
        .{ -1, "D" },
        .{ 123, "2H" },
        .{ 123456789, "qxmvrH" },
    };
    inline for (fixtures) |fixture| {
        const result = decodeVLQ(fixture[1], 0);
        try std.testing.expectEqual(
            result.value,
            fixture[0],
        );
    }
}

// A single base 64 digit can contain 6 bits of data. For the base 64 variable
// length quantities we use in the source map spec, the first bit is the sign,
// the next four bits are the actual value, and the 6th bit is the continuation
// bit. The continuation bit tells us whether there are more digits in this
// value following this digit.
//
//   Continuation
//   |    Sign
//   |    |
//   V    V
//   101011
//
pub fn encodeVLQ(
    value: i32,
) VLQ {
    var len: u4 = 0;
    var bytes: [vlq_max_in_bytes]u8 = undefined;

    var vlq: u32 = if (value >= 0)
        @as(u32, @bitCast(value << 1))
    else
        @as(u32, @bitCast((-value << 1) | 1));

    // source mappings are limited to i32
    comptime var i: usize = 0;
    inline while (i < vlq_max_in_bytes) : (i += 1) {
        var digit = vlq & 31;
        vlq >>= 5;

        // If there are still more digits in this value, we must make sure the
        // continuation bit is marked
        if (vlq != 0) {
            digit |= 32;
        }

        bytes[len] = base64[digit];
        len += 1;

        if (vlq == 0) {
            return .{ .bytes = bytes, .len = len };
        }
    }

    return .{ .bytes = bytes, .len = 0 };
}

pub const VLQResult = struct {
    value: i32 = 0,
    start: usize = 0,
};

const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// base64 stores values up to 7 bits
const base64_lut: [std.math.maxInt(u7)]u7 = brk: {
    @setEvalBranchQuota(9999);
    var bytes = [_]u7{std.math.maxInt(u7)} ** std.math.maxInt(u7);

    for (base64, 0..) |c, i| {
        bytes[c] = i;
    }

    break :brk bytes;
};

pub fn decodeVLQ(encoded: []const u8, start: usize) VLQResult {
    var shift: u8 = 0;
    var vlq: u32 = 0;

    // hint to the compiler what the maximum value is
    const encoded_ = encoded[start..][0..@min(encoded.len - start, comptime (vlq_max_in_bytes + 1))];

    // inlining helps for the 1 or 2 byte case, hurts a little for larger
    comptime var i: usize = 0;
    inline while (i < vlq_max_in_bytes + 1) : (i += 1) {
        const index = @as(u32, base64_lut[@as(u7, @truncate(encoded_[i]))]);

        // decode a byte
        vlq |= (index & 31) << @as(u5, @truncate(shift));
        shift += 5;

        // Stop if there's no continuation bit
        if ((index & 32) == 0) {
            return VLQResult{
                .start = start + comptime (i + 1),
                .value = if ((vlq & 1) == 0)
                    @as(i32, @intCast(vlq >> 1))
                else
                    -@as(i32, @intCast((vlq >> 1))),
            };
        }
    }

    return VLQResult{ .start = start + encoded_.len, .value = 0 };
}

pub const LineOffsetTable = struct {
    /// The source map specification is very loose and does not specify what
    /// column numbers actually mean. The popular "source-map" library from Mozilla
    /// appears to interpret them as counts of UTF-16 code units, so we generate
    /// those too for compatibility.
    ///
    /// We keep mapping tables around to accelerate conversion from byte offsets
    /// to UTF-16 code unit counts. However, this mapping takes up a lot of memory
    /// and takes up a lot of memory. Since most JavaScript is ASCII and the
    /// mapping for ASCII is 1:1, we avoid creating a table for ASCII-only lines
    /// as an optimization.
    ///
    columns_for_non_ascii: BabyList(i32) = .{},
    byte_offset_to_first_non_ascii: u32 = 0,
    byte_offset_to_start_of_line: u32 = 0,

    pub const List = std.MultiArrayList(LineOffsetTable);

    pub fn findLine(byte_offsets_to_start_of_line: []const u32, loc: Logger.Loc) i32 {
        std.debug.assert(loc.start > -1); // checked by caller
        var original_line: usize = 0;
        const loc_start = @as(usize, @intCast(loc.start));

        {
            var count = @as(usize, @truncate(byte_offsets_to_start_of_line.len));
            var i: usize = 0;
            while (count > 0) {
                const step = count / 2;
                i = original_line + step;
                if (byte_offsets_to_start_of_line[i] <= loc_start) {
                    original_line = i + 1;
                    count = count - step - 1;
                } else {
                    count = step;
                }
            }
        }

        return @as(i32, @intCast(original_line)) - 1;
    }

    pub fn generate(allocator: std.mem.Allocator, contents: []const u8, approximate_line_count: i32) List {
        var list = List{};
        // Preallocate the top-level table using the approximate line count from the lexer
        list.ensureUnusedCapacity(allocator, @as(usize, @intCast(@max(approximate_line_count, 1)))) catch unreachable;
        var column: i32 = 0;
        var byte_offset_to_first_non_ascii: u32 = 0;
        var column_byte_offset: u32 = 0;
        var line_byte_offset: u32 = 0;

        // the idea here is:
        // we want to avoid re-allocating this array _most_ of the time
        // when lines _do_ have unicode characters, they probably still won't be longer than 255 much
        var stack_fallback = std.heap.stackFallback(@sizeOf(i32) * 256, allocator);
        var columns_for_non_ascii = std.ArrayList(i32).initCapacity(stack_fallback.get(), 120) catch unreachable;
        const reset_end_index = stack_fallback.fixed_buffer_allocator.end_index;
        const initial_columns_for_non_ascii = columns_for_non_ascii;

        var remaining = contents;
        while (remaining.len > 0) {
            const len_ = strings.wtf8ByteSequenceLengthWithInvalid(remaining[0]);
            const c = strings.decodeWTF8RuneT(remaining.ptr[0..4], len_, i32, 0);
            const cp_len = @as(usize, len_);

            if (column == 0) {
                line_byte_offset = @as(
                    u32,
                    @truncate(@intFromPtr(remaining.ptr) - @intFromPtr(contents.ptr)),
                );
            }

            if (c > 0x7F and columns_for_non_ascii.items.len == 0) {
                std.debug.assert(@intFromPtr(
                    remaining.ptr,
                ) >= @intFromPtr(
                    contents.ptr,
                ));
                // we have a non-ASCII character, so we need to keep track of the
                // mapping from byte offsets to UTF-16 code unit counts
                columns_for_non_ascii.appendAssumeCapacity(column);
                column_byte_offset = @as(
                    u32,
                    @intCast((@intFromPtr(
                        remaining.ptr,
                    ) - @intFromPtr(
                        contents.ptr,
                    )) - line_byte_offset),
                );
                byte_offset_to_first_non_ascii = line_byte_offset;
            }

            // Update the per-byte column offsets
            if (columns_for_non_ascii.items.len > 0) {
                const line_bytes_so_far = @as(u32, @intCast(@as(
                    u32,
                    @truncate(@intFromPtr(remaining.ptr) - @intFromPtr(contents.ptr)),
                ))) - line_byte_offset;
                columns_for_non_ascii.ensureUnusedCapacity((line_bytes_so_far - column_byte_offset) + 1) catch unreachable;
                while (column_byte_offset <= line_bytes_so_far) : (column_byte_offset += 1) {
                    columns_for_non_ascii.appendAssumeCapacity(column);
                }
            } else {
                switch (c) {
                    (@max('\r', '\n') + 1)...127 => {
                        // skip ahead to the next newline or non-ascii character
                        if (strings.indexOfNewlineOrNonASCIICheckStart(remaining, @as(u32, len_), false)) |j| {
                            column += @as(i32, @intCast(j));
                            remaining = remaining[j..];
                        } else {
                            // if there are no more lines, we are done!
                            column += @as(i32, @intCast(remaining.len));
                            remaining = remaining[remaining.len..];
                        }

                        continue;
                    },
                    else => {},
                }
            }

            switch (c) {
                '\r', '\n', 0x2028, 0x2029 => {
                    // windows newline
                    if (c == '\r' and remaining.len > 1 and remaining[1] == '\n') {
                        column += 1;
                        remaining = remaining[1..];
                        continue;
                    }

                    // We don't call .toOwnedSlice() because it is expensive to
                    // reallocate the array AND when inside an Arena, it's
                    // hideously expensive
                    var owned = columns_for_non_ascii.items;
                    if (stack_fallback.fixed_buffer_allocator.ownsSlice(std.mem.sliceAsBytes(owned))) {
                        owned = allocator.dupe(i32, owned) catch unreachable;
                    }

                    list.append(allocator, .{
                        .byte_offset_to_start_of_line = line_byte_offset,
                        .byte_offset_to_first_non_ascii = byte_offset_to_first_non_ascii,
                        .columns_for_non_ascii = BabyList(i32).init(owned),
                    }) catch unreachable;

                    column = 0;
                    byte_offset_to_first_non_ascii = 0;
                    column_byte_offset = 0;
                    line_byte_offset = 0;

                    // reset the list to use the stack-allocated memory
                    stack_fallback.fixed_buffer_allocator.reset();
                    stack_fallback.fixed_buffer_allocator.end_index = reset_end_index;
                    columns_for_non_ascii = initial_columns_for_non_ascii;
                },
                else => {
                    // Mozilla's "source-map" library counts columns using UTF-16 code units
                    column += @as(i32, @intFromBool(c > 0xFFFF)) + 1;
                },
            }

            remaining = remaining[cp_len..];
        }

        // Mark the start of the next line
        if (column == 0) {
            line_byte_offset = @as(u32, @intCast(contents.len));
        }

        if (columns_for_non_ascii.items.len > 0) {
            const line_bytes_so_far = @as(u32, @intCast(contents.len)) - line_byte_offset;
            columns_for_non_ascii.ensureUnusedCapacity((line_bytes_so_far - column_byte_offset) + 1) catch unreachable;
            while (column_byte_offset <= line_bytes_so_far) : (column_byte_offset += 1) {
                columns_for_non_ascii.appendAssumeCapacity(column);
            }
        }
        {
            var owned = columns_for_non_ascii.toOwnedSlice() catch unreachable;
            if (stack_fallback.fixed_buffer_allocator.ownsSlice(std.mem.sliceAsBytes(owned))) {
                owned = allocator.dupe(i32, owned) catch unreachable;
            }
            list.append(allocator, .{
                .byte_offset_to_start_of_line = line_byte_offset,
                .byte_offset_to_first_non_ascii = byte_offset_to_first_non_ascii,
                .columns_for_non_ascii = BabyList(i32).init(owned),
            }) catch unreachable;
        }

        if (list.capacity > list.len) {
            list.shrinkAndFree(allocator, list.len);
        }
        return list;
    }
};

pub fn appendSourceMappingURLRemote(
    origin: URL,
    source: Logger.Source,
    asset_prefix_path: []const u8,
    comptime Writer: type,
    writer: Writer,
) !void {
    try writer.writeAll("\n//# sourceMappingURL=");
    try writer.writeAll(strings.withoutTrailingSlash(origin.href));
    if (asset_prefix_path.len > 0)
        try writer.writeAll(asset_prefix_path);
    if (source.path.pretty.len > 0 and source.path.pretty[0] != '/') {
        try writer.writeAll("/");
    }
    try writer.writeAll(source.path.pretty);
    try writer.writeAll(".map");
}

pub fn appendMappingToBuffer(buffer_: MutableString, last_byte: u8, prev_state: SourceMapState, current_state: SourceMapState) MutableString {
    var buffer = buffer_;
    const needs_comma = last_byte != 0 and last_byte != ';' and last_byte != '"';

    const vlq = [_]VLQ{
        // Record the generated column (the line is recorded using ';' elsewhere)
        encodeVLQWithLookupTable(current_state.generated_column -| prev_state.generated_column),
        // Record the generated source
        encodeVLQWithLookupTable(current_state.source_index -| prev_state.source_index),
        // Record the original line
        encodeVLQWithLookupTable(current_state.original_line -| prev_state.original_line),
        // Record the original column
        encodeVLQWithLookupTable(current_state.original_column -| prev_state.original_column),
    };

    // Count exactly how many bytes we need to write
    const total_len = @as(u32, vlq[0].len) +
        @as(u32, vlq[1].len) +
        @as(u32, vlq[2].len) +
        @as(u32, vlq[3].len);
    buffer.growIfNeeded(total_len + @as(u32, @intFromBool(needs_comma))) catch unreachable;

    // Put commas in between mappings
    if (needs_comma) {
        buffer.appendCharAssumeCapacity(',');
    }

    comptime var i: usize = 0;
    inline while (i < vlq.len) : (i += 1) {
        buffer.appendAssumeCapacity(vlq[i].bytes[0..vlq[i].len]);
    }

    return buffer;
}

pub const Chunk = struct {
    buffer: MutableString,

    mappings_count: usize = 0,

    /// This end state will be used to rewrite the start of the following source
    /// map chunk so that the delta-encoded VLQ numbers are preserved.
    end_state: SourceMapState = .{},

    /// There probably isn't a source mapping at the end of the file (nor should
    /// there be) but if we're appending another source map chunk after this one,
    /// we'll need to know how many characters were in the last line we generated.
    final_generated_column: i32 = 0,

    /// ignore empty chunks
    should_ignore: bool = true,

    pub fn printSourceMapContents(
        chunk: Chunk,
        source: Logger.Source,
        mutable: MutableString,
        include_sources_contents: bool,
        comptime ascii_only: bool,
    ) !MutableString {
        var output = mutable;

        // attempt to pre-allocate

        var filename_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var filename = source.path.text;
        if (strings.hasPrefix(source.path.text, FileSystem.instance.top_level_dir)) {
            filename = filename[FileSystem.instance.top_level_dir.len - 1 ..];
        } else if (filename.len > 0 and filename[0] != '/') {
            filename_buf[0] = '/';
            @memcpy(filename_buf[1..][0..filename.len], filename);
            filename = filename_buf[0 .. filename.len + 1];
        }

        output.growIfNeeded(
            filename.len + 2 + (source.contents.len * @as(usize, @intFromBool(include_sources_contents))) + chunk.buffer.list.items.len + 32 + 39 + 29 + 22 + 20,
        ) catch unreachable;
        try output.append("{\n  \"version\":3,\n  \"sources\": [");

        output = try JSPrinter.quoteForJSON(filename, output, ascii_only);

        if (include_sources_contents) {
            try output.append("],\n  \"sourcesContent\": [");
            output = try JSPrinter.quoteForJSON(source.contents, output, ascii_only);
        }

        try output.append("],\n  \"mappings\": ");
        output = try JSPrinter.quoteForJSON(chunk.buffer.list.items, output, ascii_only);
        try output.append(", \"names\": []\n}");

        return output;
    }

    pub fn SourceMapFormat(comptime Type: type) type {
        return struct {
            ctx: Type,
            const Format = @This();

            pub fn init(allocator: std.mem.Allocator, prepend_count: bool) Format {
                return Format{ .ctx = Type.init(allocator, prepend_count) };
            }

            pub inline fn appendLineSeparator(this: *Format) anyerror!void {
                try this.ctx.appendLineSeparator();
            }

            pub inline fn append(this: *Format, current_state: SourceMapState, prev_state: SourceMapState) anyerror!void {
                try this.ctx.append(current_state, prev_state);
            }

            pub inline fn shouldIgnore(this: Format) bool {
                return this.ctx.shouldIgnore();
            }

            pub inline fn getBuffer(this: Format) MutableString {
                return this.ctx.getBuffer();
            }

            pub inline fn getCount(this: Format) usize {
                return this.ctx.getCount();
            }
        };
    }

    pub const VLQSourceMap = struct {
        data: MutableString,
        count: usize = 0,
        offset: usize = 0,

        pub const Format = SourceMapFormat(VLQSourceMap);

        pub fn init(allocator: std.mem.Allocator, prepend_count: bool) VLQSourceMap {
            var map = VLQSourceMap{
                .data = MutableString.initEmpty(allocator),
            };

            // For bun.js, we store the number of mappings and how many bytes the final list is at the beginning of the array
            if (prepend_count) {
                map.offset = 16;
                map.data.append(&[16]u8{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }) catch unreachable;
            }

            return map;
        }

        pub fn appendLineSeparator(this: *VLQSourceMap) anyerror!void {
            try this.data.appendChar(';');
        }

        pub fn append(this: *VLQSourceMap, current_state: SourceMapState, prev_state: SourceMapState) anyerror!void {
            const last_byte: u8 = if (this.data.list.items.len > this.offset)
                this.data.list.items[this.data.list.items.len - 1]
            else
                0;

            this.data = appendMappingToBuffer(this.data, last_byte, prev_state, current_state);
            this.count += 1;
        }

        pub fn shouldIgnore(this: VLQSourceMap) bool {
            return this.count == 0;
        }

        pub fn getBuffer(this: VLQSourceMap) MutableString {
            return this.data;
        }

        pub fn getCount(this: VLQSourceMap) usize {
            return this.count;
        }
    };

    pub fn NewBuilder(comptime SourceMapFormatType: type) type {
        return struct {
            const ThisBuilder = @This();
            input_source_map: ?*SourceMap = null,
            source_map: SourceMapper,
            line_offset_tables: LineOffsetTable.List = .{},
            prev_state: SourceMapState = SourceMapState{},
            last_generated_update: u32 = 0,
            generated_column: i32 = 0,
            prev_loc: Logger.Loc = Logger.Loc.Empty,
            has_prev_state: bool = false,

            line_offset_table_byte_offset_list: []const u32 = &.{},

            // This is a workaround for a bug in the popular "source-map" library:
            // https://github.com/mozilla/source-map/issues/261. The library will
            // sometimes return null when querying a source map unless every line
            // starts with a mapping at column zero.
            //
            // The workaround is to replicate the previous mapping if a line ends
            // up not starting with a mapping. This is done lazily because we want
            // to avoid replicating the previous mapping if we don't need to.
            line_starts_with_mapping: bool = false,
            cover_lines_without_mappings: bool = false,

            /// When generating sourcemappings for bun, we store a count of how many mappings there were
            prepend_count: bool = false,

            pub const SourceMapper = SourceMapFormat(SourceMapFormatType);

            pub noinline fn generateChunk(b: *ThisBuilder, output: []const u8) Chunk {
                b.updateGeneratedLineAndColumn(output);
                if (b.prepend_count) {
                    b.source_map.getBuffer().list.items[0..8].* = @as([8]u8, @bitCast(b.source_map.getBuffer().list.items.len));
                    b.source_map.getBuffer().list.items[8..16].* = @as([8]u8, @bitCast(b.source_map.getCount()));
                }
                return Chunk{
                    .buffer = b.source_map.getBuffer(),
                    .mappings_count = b.source_map.getCount(),
                    .end_state = b.prev_state,
                    .final_generated_column = b.generated_column,
                    .should_ignore = b.source_map.shouldIgnore(),
                };
            }

            // Scan over the printed text since the last source mapping and update the
            // generated line and column numbers
            pub fn updateGeneratedLineAndColumn(b: *ThisBuilder, output: []const u8) void {
                const slice = output[b.last_generated_update..];
                var needs_mapping = b.cover_lines_without_mappings and !b.line_starts_with_mapping and b.has_prev_state;

                var i: usize = 0;
                const n = @as(usize, @intCast(slice.len));
                var c: i32 = 0;
                while (i < n) {
                    const len = strings.wtf8ByteSequenceLengthWithInvalid(slice[i]);
                    c = strings.decodeWTF8RuneT(slice[i..].ptr[0..4], len, i32, strings.unicode_replacement);
                    i += @as(usize, len);

                    switch (c) {
                        14...127 => {
                            if (strings.indexOfNewlineOrNonASCII(slice, @as(u32, @intCast(i)))) |j| {
                                b.generated_column += @as(i32, @intCast((@as(usize, j) - i) + 1));
                                i = j;
                                continue;
                            } else {
                                b.generated_column += @as(i32, @intCast(slice[i..].len)) + 1;
                                i = n;
                                break;
                            }
                        },
                        '\r', '\n', 0x2028, 0x2029 => {
                            // windows newline
                            if (c == '\r') {
                                const newline_check = b.last_generated_update + i + 1;
                                if (newline_check < output.len and output[newline_check] == '\n') {
                                    continue;
                                }
                            }

                            // If we're about to move to the next line and the previous line didn't have
                            // any mappings, add a mapping at the start of the previous line.
                            if (needs_mapping) {
                                b.appendMappingWithoutRemapping(.{
                                    .generated_line = b.prev_state.generated_line,
                                    .generated_column = 0,
                                    .source_index = b.prev_state.source_index,
                                    .original_line = b.prev_state.original_line,
                                    .original_column = b.prev_state.original_column,
                                });
                            }

                            b.prev_state.generated_line += 1;
                            b.prev_state.generated_column = 0;
                            b.generated_column = 0;
                            b.source_map.appendLineSeparator() catch unreachable;

                            // This new line doesn't have a mapping yet
                            b.line_starts_with_mapping = false;

                            needs_mapping = b.cover_lines_without_mappings and !b.line_starts_with_mapping and b.has_prev_state;
                        },

                        else => {
                            // Mozilla's "source-map" library counts columns using UTF-16 code units
                            b.generated_column += @as(i32, @intFromBool(c > 0xFFFF)) + 1;
                        },
                    }
                }

                b.last_generated_update = @as(u32, @truncate(output.len));
            }

            pub fn appendMapping(b: *ThisBuilder, current_state_: SourceMapState) void {
                var current_state = current_state_;
                // If the input file had a source map, map all the way back to the original
                if (b.input_source_map) |input| {
                    if (input.find(current_state.original_line, current_state.original_column)) |mapping| {
                        current_state.source_index = mapping.sourceIndex();
                        current_state.original_line = mapping.originalLine();
                        current_state.original_column = mapping.originalColumn();
                    }
                }

                b.appendMappingWithoutRemapping(current_state);
            }

            pub fn appendMappingWithoutRemapping(b: *ThisBuilder, current_state: SourceMapState) void {
                b.source_map.append(current_state, b.prev_state) catch unreachable;
                b.prev_state = current_state;
                b.has_prev_state = true;
            }

            pub fn addSourceMapping(b: *ThisBuilder, loc: Logger.Loc, output: []const u8) void {
                if (
                // exclude generated code from source
                b.prev_loc.eql(loc) or
                    // don't insert mappings for same location twice
                    loc.start == Logger.Loc.Empty.start)
                    return;

                b.prev_loc = loc;
                const list = b.line_offset_tables;
                const original_line = LineOffsetTable.findLine(b.line_offset_table_byte_offset_list, loc);
                const line = list.get(@as(usize, @intCast(@max(original_line, 0))));

                // Use the line to compute the column
                var original_column = loc.start - @as(i32, @intCast(line.byte_offset_to_start_of_line));
                if (line.columns_for_non_ascii.len > 0 and original_column >= @as(i32, @intCast(line.byte_offset_to_first_non_ascii))) {
                    original_column = line.columns_for_non_ascii.ptr[@as(u32, @intCast(original_column)) - line.byte_offset_to_first_non_ascii];
                }

                b.updateGeneratedLineAndColumn(output);

                // If this line doesn't start with a mapping and we're about to add a mapping
                // that's not at the start, insert a mapping first so the line starts with one.
                if (b.cover_lines_without_mappings and !b.line_starts_with_mapping and b.generated_column > 0 and b.has_prev_state) {
                    b.appendMappingWithoutRemapping(.{
                        .generated_line = b.prev_state.generated_line,
                        .generated_column = 0,
                        .source_index = b.prev_state.source_index,
                        .original_line = b.prev_state.original_line,
                        .original_column = b.prev_state.original_column,
                    });
                }

                b.appendMapping(.{
                    .generated_line = b.prev_state.generated_line,
                    .generated_column = @max(b.generated_column, 0),
                    .source_index = b.prev_state.source_index,
                    .original_line = @max(original_line, 0),
                    .original_column = @max(original_column, 0),
                });

                // This line now has a mapping on it, so don't insert another one
                b.line_starts_with_mapping = true;
            }
        };
    }

    pub const Builder = NewBuilder(VLQSourceMap);
};

/// https://sentry.engineering/blog/the-case-for-debug-ids
/// https://github.com/mitsuhiko/source-map-rfc/blob/proposals/debug-id/proposals/debug-id.md
/// https://github.com/source-map/source-map-rfc/pull/20
/// https://github.com/getsentry/rfcs/blob/main/text/0081-sourcemap-debugid.md#the-debugid-format
pub const DebugIDFormatter = struct {
    id: u64 = 0,

    pub fn format(self: DebugIDFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        // The RFC asks for a UUID, which is 128 bits (32 hex chars). Our hashes are only 64 bits.
        // We fill the end of the id with "bun!bun!" hex encoded
        var buf: [32]u8 = undefined;
        const formatter = bun.fmt.hexIntUpper(self.id);
        _ = std.fmt.bufPrint(&buf, "{}64756e2164756e21", .{formatter}) catch unreachable;
        try writer.writeAll(&buf);
    }
};
