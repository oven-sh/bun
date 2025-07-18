const std = @import("std");
const diff_match_patch = @import("diff_match_patch.zig");
const DMP = diff_match_patch.DMP(u8);
const DMPUsize = diff_match_patch.DMP(usize);

// @sortImports

fn removeTrailingNewline(text: []const u8) []const u8 {
    if (!std.mem.endsWith(u8, text, "\n")) return text;
    return text[0 .. text.len - 1];
}

pub fn printDiffMain(arena: std.mem.Allocator, not: bool, received_slice: []const u8, expected_slice: []const u8, writer: anytype, enable_ansi_colors: bool) !void {
    if (not) {
        switch (enable_ansi_colors) {
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

    const CONTEXT_LINES = 3;
    // unskip segments within CONTEXT_LINES of a non-equal segment

    // Forward pass: unskip segments after non-equal segments
    for (new_diff_segments.items, 0..) |segment, i| {
        if (segment.mode != .equal) {
            const end = @min(i + CONTEXT_LINES + 1, new_diff_segments.items.len);
            for (new_diff_segments.items[i..end]) |*seg| {
                seg.skip = false;
            }
        }
    }

    {
        // Reverse pass: unskip segments before non-equal segments
        var i = new_diff_segments.items.len;
        while (i > 0) {
            i -= 1;
            const segment = new_diff_segments.items[i];
            if (segment.mode != .equal) {
                const start = if (i >= CONTEXT_LINES) i - CONTEXT_LINES else 0;
                for (new_diff_segments.items[start .. i + 1]) |*seg| {
                    seg.skip = false;
                }
            }
        }
    }

    // fill removed_line_count and inserted_line_count
    for (new_diff_segments.items, 0..) |*segment, i| {
        for (segment.removed) |char| if (char == '\n') {
            segment.removed_line_count += 1;
        };
        if (i != new_diff_segments.items.len - 1) segment.removed_line_count += 1;
        for (segment.inserted) |char| if (char == '\n') {
            segment.inserted_line_count += 1;
        };
        if (i != new_diff_segments.items.len - 1) segment.inserted_line_count += 1;
    }

    try printDiff(arena, writer, new_diff_segments.items, enable_ansi_colors);
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
    const dim = "\x1b[2m";
    const reset = "\x1b[0m";
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

fn printDiffHeader(writer: anytype, enable_colors: bool) !void {
    if (enable_colors) {
        try writer.print("{s}- Received{s}\n{s}+ Expected{s}\n\n", .{ colors.red, colors.reset, colors.green, colors.reset });
    } else {
        try writer.print("- Received\n+ Expected\n\n", .{});
    }
}

fn printLinePrefix(
    writer: anytype,
    enable_colors: bool,
    prefix: []const u8,
    prefix_color: []const u8,
) !void {
    if (enable_colors) try writer.writeAll(prefix_color);
    try writer.writeAll(prefix);
    if (enable_colors) try writer.writeAll(colors.reset);
}

fn printSegment(
    text: []const u8,
    writer: anytype,
    enable_colors: bool,
    prefix: []const u8,
    prefix_color: []const u8,
    text_color: []const u8,
) !void {
    var lines = std.mem.splitScalar(u8, text, '\n');

    if (enable_colors) try writer.writeAll(text_color);
    try writer.writeAll(lines.next().?);
    if (enable_colors) try writer.writeAll(colors.reset);

    while (lines.next()) |line| {
        try writer.writeAll("\n");
        try printLinePrefix(writer, enable_colors, prefix, prefix_color);
        if (enable_colors) try writer.writeAll(text_color);
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
    const char_diff = try DMP.default.diff(arena, segment.removed, segment.inserted, true);

    try printLinePrefix(writer, enable_colors, "- ", colors.red);
    for (char_diff.items) |item| {
        switch (item.operation) {
            .delete => try printSegment(item.text, writer, enable_colors, "- ", colors.red, colors.red_background),
            .insert => {},
            .equal => try printSegment(item.text, writer, enable_colors, "- ", colors.red, colors.red),
        }
    }
    try writer.writeAll("\n");

    try printLinePrefix(writer, enable_colors, "+ ", colors.green);
    for (char_diff.items) |item| {
        switch (item.operation) {
            .delete => {},
            .insert => try printSegment(item.text, writer, enable_colors, "+ ", colors.green, colors.green_background),
            .equal => try printSegment(item.text, writer, enable_colors, "+ ", colors.green, colors.green),
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
    try printDiffHeader(writer, enable_ansi_colors);

    var original_line_number: usize = 1;
    var changed_line_number: usize = 1;

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
                try printLinePrefix(writer, enable_ansi_colors, "  ", "");
                try printSegment(segment.removed, writer, enable_ansi_colors, "  ", "", colors.dim);
                try writer.writeAll("\n");
            },
            .removed => {
                try printLinePrefix(writer, enable_ansi_colors, "- ", colors.red);
                try printSegment(segment.removed, writer, enable_ansi_colors, "- ", colors.red, colors.red_background);
                try writer.writeAll("\n");
            },
            .inserted => {
                try printLinePrefix(writer, enable_ansi_colors, "+ ", colors.green);
                try printSegment(segment.inserted, writer, enable_ansi_colors, "+ ", colors.green, colors.green_background);
                try writer.writeAll("\n");
            },
            .modified => {
                try printModifiedSegment(segment, arena, writer, enable_ansi_colors);
            },
        }
    }

    try writer.writeAll("\n");
}
