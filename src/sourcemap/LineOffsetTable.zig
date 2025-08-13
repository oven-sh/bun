const LineOffsetTable = @This();

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

pub const List = bun.MultiArrayList(LineOffsetTable);

/// Compact variant that keeps VLQ-encoded mappings and line index
/// for reduced memory usage vs unpacked MultiArrayList
pub const Compact = struct {
    const RefCount = bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    /// Thread-safe reference counting for shared access
    ref_count: RefCount,
    /// VLQ-encoded sourcemap mappings string
    vlq_mappings: []const u8,
    /// Index of positions where ';' (line separators) occur in vlq_mappings
    line_offsets: []const u32,
    /// Names array for sourcemap symbols
    names: []const bun.Semver.String,
    names_buffer: bun.ByteList,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, vlq_mappings: []const u8) !*Compact {
        // Find all line separator positions
        var line_positions = std.ArrayList(u32).init(allocator);
        defer line_positions.deinit();

        // Start with implicit position 0 for first line
        try line_positions.append(0);

        for (vlq_mappings, 0..) |char, i| {
            if (char == ';') {
                try line_positions.append(@intCast(i + 1));
            }
        }

        const owned_mappings = try allocator.dupe(u8, vlq_mappings);
        const owned_offsets = try allocator.dupe(u32, line_positions.items);

        return bun.new(Compact, .{
            .ref_count = .init(),
            .vlq_mappings = owned_mappings,
            .line_offsets = owned_offsets,
            .names = &[_]bun.Semver.String{},
            .names_buffer = .{},
            .allocator = allocator,
        });
    }

    fn deinit(self: *Compact) void {
        self.allocator.free(self.vlq_mappings);
        self.allocator.free(self.line_offsets);
        self.names_buffer.deinitWithAllocator(self.allocator);
        self.allocator.free(self.names);
        bun.destroy(self);
    }

    /// Find mapping for a given line/column by decoding VLQ with proper global accumulation
    pub fn findMapping(self: *const Compact, target_line: i32, target_column: i32) ?SourceMapping {
        if (target_line < 0 or target_line >= self.line_offsets.len - 1) {
            return null;
        }

        // VLQ sourcemap spec requires global accumulation for source_index, original_line, original_column
        // Only generated_column resets per line. We need to process all lines up to target_line
        // to get correct accumulated state.

        var global_source_index: i32 = 0;
        var global_original_line: i32 = 0;
        var global_original_column: i32 = 0;
        var best_mapping: ?SourceMapping = null;

        // Process all lines from 0 to target_line to maintain correct VLQ accumulation
        var current_line: i32 = 0;
        while (current_line <= target_line and current_line < self.line_offsets.len - 1) {
            const line_start = self.line_offsets[@intCast(current_line)];
            const line_end = if (current_line + 1 < self.line_offsets.len)
                self.line_offsets[@intCast(current_line + 1)] - 1 // -1 to exclude the ';'
            else
                @as(u32, @intCast(self.vlq_mappings.len));

            if (line_start >= line_end) {
                current_line += 1;
                continue;
            }

            const line_mappings = self.vlq_mappings[line_start..line_end];

            // generated_column resets to 0 per line (per spec)
            var generated_column: i32 = 0;
            var pos: usize = 0;

            while (pos < line_mappings.len) {
                // Skip commas
                if (line_mappings[pos] == ',') {
                    pos += 1;
                    continue;
                }

                // Decode generated column delta (resets per line)
                const gen_col_result = VLQ.decode(line_mappings, pos);
                if (gen_col_result.start == pos) break; // Invalid VLQ
                generated_column += gen_col_result.value;
                pos = gen_col_result.start;

                // Only process target line for column matching
                if (current_line == target_line) {
                    // If we've passed the target column, return the last good mapping
                    if (generated_column > target_column and best_mapping != null) {
                        return best_mapping;
                    }
                }

                if (pos >= line_mappings.len) break;
                if (line_mappings[pos] == ',') {
                    // Only generated column - no source info, skip
                    pos += 1;
                    continue;
                }

                // Decode source index delta (accumulates globally)
                const src_idx_result = VLQ.decode(line_mappings, pos);
                if (src_idx_result.start == pos) break;
                global_source_index += src_idx_result.value;
                pos = src_idx_result.start;

                if (pos >= line_mappings.len) break;

                // Decode original line delta (accumulates globally)
                const orig_line_result = VLQ.decode(line_mappings, pos);
                if (orig_line_result.start == pos) break;
                global_original_line += orig_line_result.value;
                pos = orig_line_result.start;

                if (pos >= line_mappings.len) break;

                // Decode original column delta (accumulates globally)
                const orig_col_result = VLQ.decode(line_mappings, pos);
                if (orig_col_result.start == pos) break;
                global_original_column += orig_col_result.value;
                pos = orig_col_result.start;

                // Skip name index if present
                if (pos < line_mappings.len and line_mappings[pos] != ',' and line_mappings[pos] != ';') {
                    const name_result = VLQ.decode(line_mappings, pos);
                    if (name_result.start > pos) {
                        pos = name_result.start;
                    }
                }

                // Update best mapping if this is target line and column is <= target
                if (current_line == target_line and generated_column <= target_column) {
                    // All values should be non-negative with correct VLQ accumulation
                    if (target_line >= 0 and generated_column >= 0 and
                        global_original_line >= 0 and global_original_column >= 0)
                    {
                        best_mapping = SourceMapping{
                            .generated_line = target_line,
                            .generated_column = generated_column,
                            .source_index = global_source_index,
                            .original_line = global_original_line,
                            .original_column = global_original_column,
                        };
                    }
                }
            }

            current_line += 1;
        }

        return best_mapping;
    }

    /// Get name by index, similar to Mapping.List.getName
    pub fn getName(self: *const Compact, index: i32) ?[]const u8 {
        if (index < 0) return null;
        const i: usize = @intCast(index);

        if (i >= self.names.len) return null;

        const str: *const bun.Semver.String = &self.names[i];
        return str.slice(self.names_buffer.slice());
    }

    /// Compatible API with regular LineOffsetTable for findLine
    pub fn findLine(self: *const Compact, loc: Logger.Loc) i32 {
        // For compact version, we need to search through mappings to find the line
        // This is a simplified version - in practice you'd want to maintain
        // generated line->original line mapping

        // For now, return a basic implementation that assumes 1:1 line mapping
        // This can be optimized by maintaining a separate line mapping cache
        return @max(0, @min(@as(i32, @intCast(self.line_offsets.len)) - 2, loc.start));
    }

    /// Compatible API with regular LineOffsetTable for findIndex
    pub fn findIndex(self: *const Compact, loc: Logger.Loc) ?usize {
        const line = self.findLine(loc);
        if (line >= 0 and line < self.line_offsets.len - 1) {
            return @intCast(line);
        }
        return null;
    }

    const SourceMapping = struct {
        generated_line: i32,
        generated_column: i32,
        source_index: i32,
        original_line: i32,
        original_column: i32,
    };
};

pub fn findLine(byte_offsets_to_start_of_line: []const u32, loc: Logger.Loc) i32 {
    assert(loc.start > -1); // checked by caller
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

pub fn findIndex(byte_offsets_to_start_of_line: []const u32, loc: Logger.Loc) ?usize {
    assert(loc.start > -1); // checked by caller
    var original_line: usize = 0;
    const loc_start = @as(usize, @intCast(loc.start));

    var count = @as(usize, @truncate(byte_offsets_to_start_of_line.len));
    var i: usize = 0;
    while (count > 0) {
        const step = count / 2;
        i = original_line + step;
        const byte_offset = byte_offsets_to_start_of_line[i];
        if (byte_offset == loc_start) {
            return i;
        }
        if (i + 1 < byte_offsets_to_start_of_line.len) {
            const next_byte_offset = byte_offsets_to_start_of_line[i + 1];
            if (byte_offset < loc_start and loc_start < next_byte_offset) {
                return i;
            }
        }

        if (byte_offset < loc_start) {
            original_line = i + 1;
            count = count - step - 1;
        } else {
            count = step;
        }
    }

    return null;
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
            assert(@intFromPtr(
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
            byte_offset_to_first_non_ascii = column_byte_offset;
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

const VLQ = @import("./VLQ.zig");
const std = @import("std");

const bun = @import("bun");
const BabyList = bun.BabyList;
const Logger = bun.logger;
const assert = bun.assert;
const strings = bun.strings;
