/// wrap-ansi compatible text wrapping with ANSI escape code preservation.
///
/// This module provides text wrapping functionality that:
/// - Respects Unicode display widths (full-width chars, emoji, etc.)
/// - Preserves ANSI escape codes across line breaks
/// - Supports SGR (colors, styles) and OSC 8 (hyperlinks)
/// - Compatible with NPM's wrap-ansi library
const std = @import("std");
const bun = @import("bun");
const visible = @import("visible.zig");
const strings = bun.strings;

pub const WrapOptions = struct {
    hard: bool = false,
    word_wrap: bool = true,
    trim: bool = true,
    ambiguous_is_narrow: bool = true,
};

const END_CODE: u32 = 39;

/// Wrap text to fit within the specified column width
pub fn wrapAnsi(allocator: std.mem.Allocator, input: []const u8, columns: usize, options: WrapOptions) ![]u8 {
    if (columns == 0) {
        return allocator.dupe(u8, input);
    }

    // Normalize \r\n to \n
    var normalized: std.ArrayListUnmanaged(u8) = .{};
    defer normalized.deinit(allocator);

    var i: usize = 0;
    while (i < input.len) {
        if (i + 1 < input.len and input[i] == '\r' and input[i + 1] == '\n') {
            try normalized.append(allocator, '\n');
            i += 2;
        } else {
            try normalized.append(allocator, input[i]);
            i += 1;
        }
    }

    var result: std.ArrayListUnmanaged(u8) = .{};
    errdefer result.deinit(allocator);

    // Split by newlines and process each line
    var lines = std.mem.splitScalar(u8, normalized.items, '\n');
    var first_line = true;

    while (lines.next()) |line| {
        if (!first_line) {
            try result.append(allocator, '\n');
        }
        first_line = false;

        try execLine(allocator, line, columns, options, &result);
    }

    return result.toOwnedSlice(allocator);
}

/// Calculate word lengths for a string split by spaces
fn wordLengths(allocator: std.mem.Allocator, input: []const u8, ambiguous_is_narrow: bool) !std.ArrayListUnmanaged(usize) {
    var lengths: std.ArrayListUnmanaged(usize) = .{};
    errdefer lengths.deinit(allocator);

    var iter = std.mem.splitScalar(u8, input, ' ');
    while (iter.next()) |word| {
        try lengths.append(allocator, stringWidth(word, ambiguous_is_narrow));
    }

    return lengths;
}

/// Process a single line (equivalent to NPM's exec function)
fn execLine(allocator: std.mem.Allocator, line: []const u8, columns: usize, options: WrapOptions, result: *std.ArrayListUnmanaged(u8)) !void {
    // Handle empty or whitespace-only strings with trim
    if (options.trim) {
        const trimmed = std.mem.trim(u8, line, " \t");
        if (trimmed.len == 0) {
            return;
        }
    }

    // Calculate word lengths
    var lengths = try wordLengths(allocator, line, options.ambiguous_is_narrow);
    defer lengths.deinit(allocator);

    // Build rows (equivalent to NPM's rows array)
    var rows: std.ArrayListUnmanaged(std.ArrayListUnmanaged(u8)) = .{};
    defer {
        for (rows.items) |*row| {
            row.deinit(allocator);
        }
        rows.deinit(allocator);
    }

    // Start with empty first row
    try rows.append(allocator, .{});

    // Split by spaces and process each word
    var iter = std.mem.splitScalar(u8, line, ' ');
    var index: usize = 0;

    while (iter.next()) |word| {
        if (options.trim) {
            // Trim the current row's leading whitespace
            trimRowStart(&rows.items[rows.items.len - 1]);
        }

        var row_length = rowWidth(&rows.items[rows.items.len - 1], options.ambiguous_is_narrow);

        if (index != 0) {
            if (row_length >= columns and (!options.word_wrap or !options.trim)) {
                // If we start with a new word but the current row length equals the length of the columns, add a new row
                try rows.append(allocator, .{});
                row_length = 0;
            }

            if (row_length > 0 or !options.trim) {
                try rows.items[rows.items.len - 1].append(allocator, ' ');
                row_length += 1;
            }
        }

        // In 'hard' wrap mode, the length of a line is never allowed to extend past 'columns'
        if (options.hard and lengths.items[index] > columns) {
            const remaining_columns = columns -| row_length;
            const breaks_starting_this_line = 1 + ((lengths.items[index] -| remaining_columns -| 1) / columns);
            const breaks_starting_next_line = (lengths.items[index] -| 1) / columns;
            if (breaks_starting_next_line < breaks_starting_this_line) {
                try rows.append(allocator, .{});
            }

            try wrapWord(allocator, &rows, word, columns, options);
            index += 1;
            continue;
        }

        if (row_length + lengths.items[index] > columns and row_length > 0 and lengths.items[index] > 0) {
            if (!options.word_wrap and row_length < columns) {
                try wrapWord(allocator, &rows, word, columns, options);
                index += 1;
                continue;
            }

            try rows.append(allocator, .{});
        }

        row_length = rowWidth(&rows.items[rows.items.len - 1], options.ambiguous_is_narrow);
        if (row_length + lengths.items[index] > columns and !options.word_wrap) {
            try wrapWord(allocator, &rows, word, columns, options);
            index += 1;
            continue;
        }

        try rows.items[rows.items.len - 1].appendSlice(allocator, word);
        index += 1;
    }

    // Trim trailing whitespace from rows if needed
    if (options.trim) {
        for (rows.items) |*row| {
            stringVisibleTrimSpacesRight(allocator, row);
        }
    }

    // Join rows with newlines and process ANSI style preservation
    try joinRowsWithAnsiPreservation(allocator, &rows, result);
}

/// Trim trailing spaces ignoring invisible sequences
fn stringVisibleTrimSpacesRight(allocator: std.mem.Allocator, row: *std.ArrayListUnmanaged(u8)) void {
    // Split by spaces and find last word with visible content
    var words_iter = std.mem.splitScalar(u8, row.items, ' ');
    var last: usize = 0;
    var count: usize = 0;

    while (words_iter.next()) |word| {
        if (stringWidth(word, true) > 0) {
            last = count + 1;
        }
        count += 1;
    }

    if (last == count) {
        return;
    }

    // Rebuild with only words up to last, keeping trailing ANSI codes
    var new_row: std.ArrayListUnmanaged(u8) = .{};
    var words_iter2 = std.mem.splitScalar(u8, row.items, ' ');
    var idx: usize = 0;
    var trailing_ansi: std.ArrayListUnmanaged(u8) = .{};

    while (words_iter2.next()) |word| {
        if (idx < last) {
            if (idx > 0) {
                new_row.append(allocator, ' ') catch {};
            }
            new_row.appendSlice(allocator, word) catch {};
        } else {
            // Append ANSI sequences from trailing words
            for (word) |c| {
                if (c == '\x1b' or trailing_ansi.items.len > 0) {
                    trailing_ansi.append(allocator, c) catch {};
                }
            }
        }
        idx += 1;
    }

    // Append trailing ANSI codes
    new_row.appendSlice(allocator, trailing_ansi.items) catch {};
    trailing_ansi.deinit(allocator);

    // Replace row content
    row.deinit(allocator);
    row.* = new_row;
}

/// Wrap a word across multiple rows (character by character)
fn wrapWord(allocator: std.mem.Allocator, rows: *std.ArrayListUnmanaged(std.ArrayListUnmanaged(u8)), word: []const u8, columns: usize, options: WrapOptions) !void {
    var is_inside_escape = false;
    var is_inside_link_escape = false;

    var vis = rowWidth(&rows.items[rows.items.len - 1], options.ambiguous_is_narrow);

    var i: usize = 0;
    while (i < word.len) {
        var char_len: usize = 1;

        if (word[i] == '\x1b') {
            is_inside_escape = true;
            // Check if it's a hyperlink escape
            if (i + 4 < word.len and std.mem.startsWith(u8, word[i + 1 ..], "]8;;")) {
                is_inside_link_escape = true;
            }
        }

        const char_width = if (!is_inside_escape) blk: {
            const result = getCharWidth(word[i..], !options.ambiguous_is_narrow);
            char_len = result.bytes;
            break :blk result.width;
        } else 0;

        if (!is_inside_escape and vis + char_width <= columns) {
            try rows.items[rows.items.len - 1].appendSlice(allocator, word[i .. i + char_len]);
        } else if (!is_inside_escape) {
            try rows.append(allocator, .{});
            try rows.items[rows.items.len - 1].appendSlice(allocator, word[i .. i + char_len]);
            vis = 0;
        } else {
            // Inside escape, just append
            try rows.items[rows.items.len - 1].append(allocator, word[i]);
        }

        if (is_inside_escape) {
            if (is_inside_link_escape) {
                if (word[i] == 0x07) { // BEL
                    is_inside_escape = false;
                    is_inside_link_escape = false;
                }
            } else if (word[i] == 'm') {
                is_inside_escape = false;
            }
            i += 1;
            continue;
        }

        vis += char_width;

        if (vis == columns and i + char_len < word.len) {
            try rows.append(allocator, .{});
            vis = 0;
        }

        i += char_len;
    }

    // Handle edge case: last row is only ANSI escape codes
    if (vis == 0 and rows.items[rows.items.len - 1].items.len > 0 and rows.items.len > 1) {
        if (rows.pop()) |popped| {
            var last_row = popped;
            try rows.items[rows.items.len - 1].appendSlice(allocator, last_row.items);
            last_row.deinit(allocator);
        }
    }
}

/// Trim leading whitespace from a row (skipping ANSI sequences)
fn trimRowStart(row: *std.ArrayListUnmanaged(u8)) void {
    // Find leading whitespace to remove, but preserve ANSI sequences
    var i: usize = 0;
    var spaces_to_remove: usize = 0;
    var is_inside_escape = false;

    while (i < row.items.len) {
        if (row.items[i] == '\x1b') {
            is_inside_escape = true;
            i += 1;
            continue;
        }

        if (is_inside_escape) {
            if (row.items[i] == 'm' or row.items[i] == 0x07) {
                is_inside_escape = false;
            }
            i += 1;
            continue;
        }

        if (row.items[i] == ' ' or row.items[i] == '\t') {
            spaces_to_remove += 1;
            i += 1;
        } else {
            break;
        }
    }

    // Nothing to remove
    if (spaces_to_remove == 0) return;

    // Remove only the spaces, keeping ANSI codes
    var read: usize = 0;
    var write: usize = 0;
    var in_escape = false;
    var removed: usize = 0;

    while (read < row.items.len) {
        if (row.items[read] == '\x1b') {
            in_escape = true;
            row.items[write] = row.items[read];
            read += 1;
            write += 1;
            continue;
        }

        if (in_escape) {
            if (row.items[read] == 'm' or row.items[read] == 0x07) {
                in_escape = false;
            }
            row.items[write] = row.items[read];
            read += 1;
            write += 1;
            continue;
        }

        if ((row.items[read] == ' ' or row.items[read] == '\t') and removed < spaces_to_remove) {
            removed += 1;
            read += 1;
            continue;
        }

        row.items[write] = row.items[read];
        read += 1;
        write += 1;
    }

    row.items.len = write;
}

/// Get the visible width of a row
fn rowWidth(row: *const std.ArrayListUnmanaged(u8), ambiguous_is_narrow: bool) usize {
    return stringWidth(row.items, ambiguous_is_narrow);
}

/// Calculate visible string width (ignoring ANSI sequences)
fn stringWidth(input: []const u8, ambiguous_is_narrow: bool) usize {
    var width: usize = 0;
    var i: usize = 0;
    var is_inside_escape = false;
    var is_inside_link_escape = false;

    while (i < input.len) {
        if (input[i] == '\x1b') {
            is_inside_escape = true;
            if (i + 4 < input.len and std.mem.startsWith(u8, input[i + 1 ..], "]8;;")) {
                is_inside_link_escape = true;
            }
            i += 1;
            continue;
        }

        if (is_inside_escape) {
            if (is_inside_link_escape) {
                if (input[i] == 0x07) {
                    is_inside_escape = false;
                    is_inside_link_escape = false;
                }
            } else if (input[i] == 'm') {
                is_inside_escape = false;
            }
            i += 1;
            continue;
        }

        const result = getCharWidth(input[i..], !ambiguous_is_narrow);
        width += result.width;
        i += result.bytes;
    }

    return width;
}

/// Join rows with newlines, preserving ANSI styles across line breaks
fn joinRowsWithAnsiPreservation(allocator: std.mem.Allocator, rows: *std.ArrayListUnmanaged(std.ArrayListUnmanaged(u8)), result: *std.ArrayListUnmanaged(u8)) !void {
    // First, join all rows with newlines
    var pre: std.ArrayListUnmanaged(u8) = .{};
    defer pre.deinit(allocator);

    for (rows.items, 0..) |*row, idx| {
        if (idx > 0) {
            try pre.append(allocator, '\n');
        }
        try pre.appendSlice(allocator, row.items);
    }

    // Now process for ANSI style preservation
    var escape_code: ?u32 = null;
    var escape_url: ?[]const u8 = null;
    var i: usize = 0;

    while (i < pre.items.len) {
        const c = pre.items[i];
        try result.append(allocator, c);

        if (c == '\x1b') {
            // Parse ANSI sequence
            const remaining = pre.items[i..];
            if (remaining.len > 1 and remaining[1] == '[') {
                // CSI sequence - try to extract code
                if (parseSgrCode(remaining)) |code| {
                    if (code == END_CODE or code == 0) {
                        escape_code = null;
                    } else {
                        escape_code = code;
                    }
                }
            } else if (remaining.len > 4 and std.mem.startsWith(u8, remaining[1..], "]8;;")) {
                // OSC 8 hyperlink
                const url = parseOsc8Url(remaining);
                if (url.len == 0) {
                    escape_url = null;
                } else {
                    escape_url = url;
                }
            }
        }

        // Check if next character is newline
        if (i + 1 < pre.items.len and pre.items[i + 1] == '\n') {
            // Close styles before newline
            if (escape_url != null) {
                try result.appendSlice(allocator, "\x1b]8;;\x07");
            }
            if (escape_code) |code| {
                if (getCloseCode(code)) |close_code| {
                    try result.appendSlice(allocator, "\x1b[");
                    try std.fmt.format(result.writer(allocator), "{d}", .{close_code});
                    try result.append(allocator, 'm');
                }
            }
        } else if (c == '\n') {
            // Restore styles after newline
            if (escape_code) |code| {
                try result.appendSlice(allocator, "\x1b[");
                try std.fmt.format(result.writer(allocator), "{d}", .{code});
                try result.append(allocator, 'm');
            }
            if (escape_url) |url| {
                try result.appendSlice(allocator, "\x1b]8;;");
                try result.appendSlice(allocator, url);
                try result.append(allocator, 0x07);
            }
        }

        i += 1;
    }
}

/// Parse SGR code from CSI sequence
fn parseSgrCode(input: []const u8) ?u32 {
    if (input.len < 3 or input[0] != '\x1b' or input[1] != '[') return null;

    var i: usize = 2;
    var code: u32 = 0;

    while (i < input.len) {
        const c = input[i];
        if (c >= '0' and c <= '9') {
            code = code * 10 + (c - '0');
            i += 1;
        } else if (c == 'm') {
            return code;
        } else {
            break;
        }
    }

    return null;
}

/// Parse URL from OSC 8 sequence
fn parseOsc8Url(input: []const u8) []const u8 {
    // Format: ESC ] 8 ; ; url BEL
    if (input.len < 6) return "";
    if (!std.mem.startsWith(u8, input, "\x1b]8;;")) return "";

    var i: usize = 5; // Skip ESC ] 8 ; ;
    const url_start = i;

    while (i < input.len and input[i] != 0x07 and input[i] != '\x1b') {
        i += 1;
    }

    return input[url_start..i];
}

/// Get the close code for an SGR code (from ansi-styles)
fn getCloseCode(code: u32) ?u32 {
    return switch (code) {
        1, 2 => 22,
        3 => 23,
        4 => 24,
        5, 6 => 25,
        7 => 27,
        8 => 28,
        9 => 29,
        30...37 => 39,
        40...47 => 49,
        90...97 => 39,
        100...107 => 49,
        else => null,
    };
}

const CharWidthResult = struct {
    width: usize,
    bytes: usize,
};

fn getCharWidth(input: []const u8, ambiguous_as_wide: bool) CharWidthResult {
    if (input.len == 0) return .{ .width = 0, .bytes = 0 };

    const byte = input[0];

    // ASCII fast path
    if (byte < 0x80) {
        if (byte < 0x20 or byte == 0x7f) {
            return .{ .width = 0, .bytes = 1 };
        }
        return .{ .width = 1, .bytes = 1 };
    }

    // UTF-8 multibyte sequence
    const seq_len = strings.wtf8ByteSequenceLengthWithInvalid(byte);
    if (seq_len == 0 or seq_len > input.len) {
        return .{ .width = 1, .bytes = 1 };
    }

    const cp_bytes: [4]u8 = switch (@min(@as(usize, seq_len), input.len)) {
        inline 1, 2, 3, 4 => |cp_len| .{
            byte,
            if (comptime cp_len > 1) input[1] else 0,
            if (comptime cp_len > 2) input[2] else 0,
            if (comptime cp_len > 3) input[3] else 0,
        },
        else => unreachable,
    };

    const cp = strings.decodeWTF8RuneTMultibyte(&cp_bytes, seq_len, u32, strings.unicode_replacement);
    const width = visible.visibleCodepointWidth(cp, ambiguous_as_wide);

    return .{ .width = width, .bytes = seq_len };
}

test "basic wrapping" {
    const allocator = std.testing.allocator;

    const result = try wrapAnsi(allocator, "hello world", 5, .{});
    defer allocator.free(result);

    try std.testing.expectEqualStrings("hello\nworld", result);
}

test "preserve ansi colors" {
    const allocator = std.testing.allocator;

    const result = try wrapAnsi(allocator, "\x1b[31mhello world\x1b[0m", 5, .{});
    defer allocator.free(result);

    // Should have reset before newline and restore after
    try std.testing.expect(std.mem.indexOf(u8, result, "\x1b[") != null);
}

test "hard wrap" {
    const allocator = std.testing.allocator;

    const result = try wrapAnsi(allocator, "abcdefgh", 3, .{ .hard = true });
    defer allocator.free(result);

    try std.testing.expectEqualStrings("abc\ndef\ngh", result);
}
