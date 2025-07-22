const DMP = diff_match_patch.DMP(u8);
const DMPUsize = diff_match_patch.DMP(usize);

pub const DiffConfig = struct {
    min_bytes_before_chunking: usize = 2 * 1024, // 2kB
    chunk_context_lines: usize = 3,
    enable_ansi_colors: bool,
};

fn removeTrailingNewline(text: []const u8) []const u8 {
    if (!std.mem.endsWith(u8, text, "\n")) return text;
    return text[0 .. text.len - 1];
}

pub fn printDiffMain(arena: std.mem.Allocator, not: bool, received_slice: []const u8, expected_slice: []const u8, writer: anytype, config: DiffConfig) !void {
    if (not) {
        switch (config.enable_ansi_colors) {
            true => try writer.print("Expected: not " ++ colors.green ++ "{s}" ++ colors.reset, .{expected_slice}),
            false => try writer.print("Expected: not {s}", .{expected_slice}),
        }
        return;
    }

    var dmp = DMPUsize.default;
    dmp.config.diff_timeout = 200;
    const linesToChars = try DMP.diffLinesToChars(arena, received_slice, expected_slice);
    const charDiffs = try dmp.diff(arena, linesToChars.chars_1, linesToChars.chars_2, false);
    const diffs = try DMP.diffCharsToLines(arena, &charDiffs, linesToChars.line_array.items);

    var has_changes = false;
    for (diffs.items) |diff| {
        if (diff.operation != .equal) {
            has_changes = true;
            break;
        }
    }

    if (!has_changes) return;

    var diff_segments = std.ArrayList(DiffSegment).init(arena);
    for (diffs.items) |diff| {
        if (diff.operation == .delete) {
            try diff_segments.append(DiffSegment{
                .removed = diff.text,
                .inserted = "",
                .mode = .removed,
            });
        } else if (diff.operation == .insert) {
            if (diff_segments.items.len > 0 and diff_segments.items[diff_segments.items.len - 1].mode == .removed) {
                diff_segments.items[diff_segments.items.len - 1].inserted = diff.text;
                diff_segments.items[diff_segments.items.len - 1].mode = .modified;
            } else {
                try diff_segments.append(DiffSegment{
                    .removed = "",
                    .inserted = diff.text,
                    .mode = .inserted,
                });
            }
        } else if (diff.operation == .equal) {
            try diff_segments.append(DiffSegment{
                .removed = diff.text,
                .inserted = diff.text,
                .mode = .equal,
            });
        }
    }

    // trim all segments except the last one
    if (diff_segments.items.len > 0) for (diff_segments.items[0 .. diff_segments.items.len - 1]) |*diff_segment| {
        diff_segment.removed = removeTrailingNewline(diff_segment.removed);
        diff_segment.inserted = removeTrailingNewline(diff_segment.inserted);
    };

    // Determine if the diff needs to be chunked
    if (expected_slice.len > config.min_bytes_before_chunking or received_slice.len > config.min_bytes_before_chunking) {
        // Split 'equal' segments into lines
        var new_diff_segments = std.ArrayList(DiffSegment).init(arena);

        for (diff_segments.items) |diff_segment| {
            if (diff_segment.mode == .equal) {
                var split = std.mem.splitScalar(u8, diff_segment.removed, '\n');
                while (split.next()) |line| {
                    try new_diff_segments.append(DiffSegment{
                        .removed = line,
                        .inserted = line,
                        .mode = .equal,
                        .skip = true,
                    });
                }
            } else {
                try new_diff_segments.append(diff_segment);
            }
        }

        diff_segments = new_diff_segments;

        // Forward pass: unskip segments after non-equal segments
        for (diff_segments.items, 0..) |segment, i| {
            if (segment.mode != .equal) {
                const end = @min(i +| config.chunk_context_lines +| 1, diff_segments.items.len);
                for (diff_segments.items[i..end]) |*seg| {
                    seg.skip = false;
                }
            }
        }

        {
            // Reverse pass: unskip segments before non-equal segments
            var i = diff_segments.items.len;
            while (i > 0) {
                i -= 1;
                const segment = diff_segments.items[i];
                if (segment.mode != .equal) {
                    const start = i -| config.chunk_context_lines;
                    for (diff_segments.items[start .. i + 1]) |*seg| {
                        seg.skip = false;
                    }
                }
            }
        }
    }

    // fill removed_line_count and inserted_line_count
    for (diff_segments.items, 0..) |*segment, i| {
        for (segment.removed) |char| if (char == '\n') {
            segment.removed_line_count += 1;
        };
        if (i != diff_segments.items.len - 1) segment.removed_line_count += 1;
        for (segment.inserted) |char| if (char == '\n') {
            segment.inserted_line_count += 1;
        };
        if (i != diff_segments.items.len - 1) segment.inserted_line_count += 1;
    }
    try printDiff(arena, writer, diff_segments.items, config.enable_ansi_colors);
}

pub const Diff = struct {
    pub const Operation = enum {
        insert,
        delete,
        equal,
    };

    operation: Operation,
    text: []const u8,
};

const colors = struct {
    const red = "\x1b[31m";
    const green = "\x1b[32m";
    const cyan = "\x1b[36m";
    const red_background = "\x1b[41m";
    const green_background = "\x1b[42m";
    const underline = "\x1b[4m";
    const dim = "\x1b[2m";
    const reset = "\x1b[0m";
};

const styles = struct {
    const removed = Style{
        .prefix = "+ ",
        .prefix_color = colors.red,
        .text_color = colors.red_background,
    };
    const inserted = Style{
        .prefix = "- ",
        .prefix_color = colors.green,
        .text_color = colors.green_background,
    };
    const equal = Style{
        .prefix = "  ",
        .prefix_color = "",
        .text_color = colors.dim,
    };
    const removed_equal = Style{
        .prefix = "+ ",
        .prefix_color = colors.red,
        .text_color = colors.red,
    };
    const inserted_equal = Style{
        .prefix = "- ",
        .prefix_color = colors.green,
        .text_color = colors.green,
    };
};

pub const DiffSegment = struct {
    removed: []const u8,
    inserted: []const u8,
    mode: enum {
        equal,
        removed,
        inserted,
        modified,
    },
    removed_line_count: usize = 0,
    inserted_line_count: usize = 0,
    skip: bool = false,
};

fn printDiffFooter(writer: anytype, enable_colors: bool, received_diff_lines: usize, expected_diff_lines: usize) !void {
    if (enable_colors) try writer.writeAll(styles.inserted.prefix_color);
    try writer.writeAll(styles.inserted.prefix);
    try writer.writeAll("Expected");
    try writer.print("  {s}{d}", .{ styles.inserted.prefix, expected_diff_lines });
    if (enable_colors) try writer.writeAll(colors.reset);
    try writer.writeAll("\n");
    if (enable_colors) try writer.writeAll(styles.removed.prefix_color);
    try writer.writeAll(styles.removed.prefix);
    try writer.writeAll("Received");
    try writer.print("  {s}{d}", .{ styles.removed.prefix, received_diff_lines });
    if (enable_colors) try writer.writeAll(colors.reset);
    try writer.writeAll("\n");
}

const Style = struct {
    prefix: []const u8,
    prefix_color: []const u8,
    text_color: []const u8,
};

fn printLinePrefix(
    writer: anytype,
    enable_colors: bool,
    style: Style,
) !void {
    if (enable_colors) try writer.writeAll(style.prefix_color);
    try writer.writeAll(style.prefix);
    if (enable_colors) try writer.writeAll(colors.reset);
}

fn printSegment(
    text: []const u8,
    writer: anytype,
    enable_colors: bool,
    style: Style,
) !void {
    var lines = std.mem.splitScalar(u8, text, '\n');

    if (enable_colors) try writer.writeAll(style.text_color);
    try writer.writeAll(lines.next().?);
    if (enable_colors) try writer.writeAll(colors.reset);

    while (lines.next()) |line| {
        try writer.writeAll("\n");
        try printLinePrefix(writer, enable_colors, style);
        if (enable_colors) try writer.writeAll(style.text_color);
        try writer.writeAll(line);
        if (enable_colors) try writer.writeAll(colors.reset);
    }
}

fn printModifiedSegment(
    segment: DiffSegment,
    arena: std.mem.Allocator,
    writer: anytype,
    enable_colors: bool,
) !void {
    var char_diff = try DMP.default.diff(arena, segment.removed, segment.inserted, true);
    try DMP.diffCleanupSemantic(arena, &char_diff);

    try printLinePrefix(writer, enable_colors, styles.inserted);
    for (char_diff.items) |item| {
        switch (item.operation) {
            .delete => {},
            .insert => try printSegment(item.text, writer, enable_colors, styles.inserted),
            .equal => try printSegment(item.text, writer, enable_colors, styles.inserted_equal),
        }
    }
    try writer.writeAll("\n");

    try printLinePrefix(writer, enable_colors, styles.removed);
    for (char_diff.items) |item| {
        switch (item.operation) {
            .delete => try printSegment(item.text, writer, enable_colors, styles.removed),
            .insert => {},
            .equal => try printSegment(item.text, writer, enable_colors, styles.removed_equal),
        }
    }
    try writer.writeAll("\n");
}

pub fn printHunkHeader(writer: anytype, enable_colors: bool, original_line_number: usize, original_line_count: usize, changed_line_number: usize, changed_line_count: usize) !void {
    if (enable_colors) {
        try writer.print("{s}@@ -{},{} +{},{} @@{s}\n", .{ colors.cyan, original_line_number, original_line_count, changed_line_number, changed_line_count, colors.reset });
    } else {
        try writer.print("@@ -{},{} +{},{} @@\n", .{ original_line_number, original_line_count, changed_line_number, changed_line_count });
    }
}

pub fn printDiff(
    arena: std.mem.Allocator,
    writer: anytype,
    diff_segments: []const DiffSegment,
    enable_ansi_colors: bool,
) !void {
    try writer.writeAll("\n");

    var original_line_number: usize = 1;
    var changed_line_number: usize = 1;
    var original_diff_lines: usize = 0;
    var changed_diff_lines: usize = 0;

    const has_skipped_segments = for (diff_segments) |seg| {
        if (seg.skip) break true;
    } else false;

    var was_skipped = false;
    for (diff_segments, 0..) |segment, i| {
        defer {
            original_line_number += segment.removed_line_count;
            changed_line_number += segment.inserted_line_count;
        }

        if ((was_skipped and !segment.skip) or (has_skipped_segments and i == 0 and !segment.skip)) {
            // have to calculate the length of the non-skipped segment
            var original_line_count: usize = 0;
            var changed_line_count: usize = 0;
            for (diff_segments[i..]) |seg| {
                if (seg.skip) break;
                original_line_count += seg.removed_line_count;
                changed_line_count += seg.inserted_line_count;
            }
            try printHunkHeader(writer, enable_ansi_colors, original_line_number, original_line_count, changed_line_number, changed_line_count);
            was_skipped = false;
        }

        switch (segment.mode) {
            .equal => {
                if (segment.skip) {
                    was_skipped = true;
                    continue;
                }
                try printLinePrefix(writer, enable_ansi_colors, styles.equal);
                try printSegment(segment.removed, writer, enable_ansi_colors, styles.equal);
                try writer.writeAll("\n");
            },
            .removed => {
                try printLinePrefix(writer, enable_ansi_colors, styles.removed);
                try printSegment(segment.removed, writer, enable_ansi_colors, styles.removed);
                try writer.writeAll("\n");
                original_diff_lines += segment.removed_line_count;
            },
            .inserted => {
                try printLinePrefix(writer, enable_ansi_colors, styles.inserted);
                try printSegment(segment.inserted, writer, enable_ansi_colors, styles.inserted);
                try writer.writeAll("\n");
                changed_diff_lines += segment.inserted_line_count;
            },
            .modified => {
                try printModifiedSegment(segment, arena, writer, enable_ansi_colors);
                original_diff_lines += segment.removed_line_count;
                changed_diff_lines += segment.inserted_line_count;
            },
        }
    }

    try writer.writeAll("\n");

    try printDiffFooter(writer, enable_ansi_colors, original_diff_lines, changed_diff_lines);
}

const diff_match_patch = @import("./diff_match_patch.zig");
const std = @import("std");
