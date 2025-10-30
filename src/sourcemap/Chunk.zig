const Chunk = @This();

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

pub fn initEmpty() Chunk {
    return .{
        .buffer = MutableString.initEmpty(bun.default_allocator),
        .mappings_count = 0,
        .end_state = .{},
        .final_generated_column = 0,
        .should_ignore = true,
    };
}

pub fn deinit(this: *Chunk) void {
    this.buffer.deinit();
}

pub fn printSourceMapContents(
    chunk: Chunk,
    source: *const Logger.Source,
    mutable: *MutableString,
    include_sources_contents: bool,
    comptime ascii_only: bool,
) !void {
    try printSourceMapContentsAtOffset(
        chunk,
        source,
        mutable,
        include_sources_contents,
        0,
        ascii_only,
    );
}

pub fn printSourceMapContentsAtOffset(
    chunk: Chunk,
    source: *const Logger.Source,
    mutable: *MutableString,
    include_sources_contents: bool,
    offset: usize,
    comptime ascii_only: bool,
) !void {
    // attempt to pre-allocate

    var filename_buf: bun.PathBuffer = undefined;
    var filename = source.path.text;
    if (strings.hasPrefix(source.path.text, FileSystem.instance.top_level_dir)) {
        filename = filename[FileSystem.instance.top_level_dir.len - 1 ..];
    } else if (filename.len > 0 and filename[0] != '/') {
        filename_buf[0] = '/';
        @memcpy(filename_buf[1..][0..filename.len], filename);
        filename = filename_buf[0 .. filename.len + 1];
    }

    mutable.growIfNeeded(
        filename.len + 2 + (source.contents.len * @as(usize, @intFromBool(include_sources_contents))) + (chunk.buffer.list.items.len - offset) + 32 + 39 + 29 + 22 + 20,
    ) catch unreachable;
    try mutable.append("{\n  \"version\":3,\n  \"sources\": [");

    try JSPrinter.quoteForJSON(filename, mutable, ascii_only);

    if (include_sources_contents) {
        try mutable.append("],\n  \"sourcesContent\": [");
        try JSPrinter.quoteForJSON(source.contents, mutable, ascii_only);
    }

    try mutable.append("],\n  \"mappings\": ");
    try JSPrinter.quoteForJSON(chunk.buffer.list.items[offset..], mutable, ascii_only);
    try mutable.append(", \"names\": []\n}");
}

// TODO: remove the indirection by having generic functions for SourceMapFormat and NewBuilder. Source maps are always VLQ
pub fn SourceMapFormat(comptime Type: type) type {
    return struct {
        ctx: Type,
        const Format = @This();

        pub fn init(allocator: std.mem.Allocator, prepend_count: bool) Format {
            return .{ .ctx = Type.init(allocator, prepend_count) };
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

        pub inline fn takeBuffer(this: *Format) MutableString {
            return this.ctx.takeBuffer();
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
    approximate_input_line_count: usize = 0,

    pub fn init(allocator: std.mem.Allocator, prepend_count: bool) VLQSourceMap {
        var map = VLQSourceMap{
            .data = MutableString.initEmpty(allocator),
        };

        // For bun.js, we store the number of mappings and how many bytes the final list is at the beginning of the array
        if (prepend_count) {
            map.offset = 24;
            map.data.append(&([_]u8{0} ** 24)) catch unreachable;
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

        appendMappingToBuffer(&this.data, last_byte, prev_state, current_state);
        this.count += 1;
    }

    pub fn shouldIgnore(this: VLQSourceMap) bool {
        return this.count == 0;
    }

    pub fn getBuffer(this: VLQSourceMap) MutableString {
        return this.data;
    }

    pub fn takeBuffer(this: *VLQSourceMap) MutableString {
        defer this.data = .initEmpty(this.data.allocator);
        return this.data;
    }

    pub fn getCount(this: VLQSourceMap) usize {
        return this.count;
    }
};

pub fn NewBuilder(comptime SourceMapFormatType: type) type {
    return struct {
        const ThisBuilder = @This();
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

        approximate_input_line_count: usize = 0,

        /// When generating sourcemappings for bun, we store a count of how many mappings there were
        prepend_count: bool = false,

        pub const SourceMapper = SourceMapFormat(SourceMapFormatType);

        pub noinline fn generateChunk(b: *ThisBuilder, output: []const u8) Chunk {
            b.updateGeneratedLineAndColumn(output);
            var buffer = b.source_map.getBuffer();
            if (b.prepend_count) {
                buffer.list.items[0..8].* = @as([8]u8, @bitCast(buffer.list.items.len));
                buffer.list.items[8..16].* = @as([8]u8, @bitCast(b.source_map.getCount()));
                buffer.list.items[16..24].* = @as([8]u8, @bitCast(b.approximate_input_line_count));
            }
            return Chunk{
                .buffer = b.source_map.takeBuffer(),
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

        pub fn appendMapping(b: *ThisBuilder, current_state: SourceMapState) void {
            b.appendMappingWithoutRemapping(current_state);
        }

        pub fn appendMappingWithoutRemapping(b: *ThisBuilder, current_state: SourceMapState) void {
            b.source_map.append(current_state, b.prev_state) catch unreachable;
            b.prev_state = current_state;
            b.has_prev_state = true;
        }

        pub fn addSourceMapping(b: *ThisBuilder, loc: Logger.Loc, output: []const u8) void {
            if (
            // don't insert mappings for same location twice
            b.prev_loc.eql(loc) or
                // exclude generated code from source
                loc.start == Logger.Loc.Empty.start)
                return;

            b.prev_loc = loc;
            const list = b.line_offset_tables;

            // We have no sourcemappings.
            // This happens for example when importing an asset which does not support sourcemaps
            // like a png or a jpg
            //
            // import foo from "./foo.png";
            //
            if (list.len == 0) {
                return;
            }

            const original_line = LineOffsetTable.findLine(b.line_offset_table_byte_offset_list, loc);
            const line = list.get(@as(usize, @intCast(@max(original_line, 0))));

            // Use the line to compute the column
            var original_column = loc.start - @as(i32, @intCast(line.byte_offset_to_start_of_line));
            if (line.columns_for_non_ascii.len > 0 and original_column >= @as(i32, @intCast(line.byte_offset_to_first_non_ascii))) {
                original_column = line.columns_for_non_ascii.slice()[@as(u32, @intCast(original_column)) - line.byte_offset_to_first_non_ascii];
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

const std = @import("std");

const SourceMap = @import("./sourcemap.zig");
const LineOffsetTable = SourceMap.LineOffsetTable;
const SourceMapState = SourceMap.SourceMapState;
const appendMappingToBuffer = SourceMap.appendMappingToBuffer;

const bun = @import("bun");
const JSPrinter = bun.js_printer;
const Logger = bun.logger;
const MutableString = bun.MutableString;
const strings = bun.strings;
const FileSystem = bun.fs.FileSystem;
