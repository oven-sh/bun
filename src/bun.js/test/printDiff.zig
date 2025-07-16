const colors = struct {
    const red = "\x1b[31m";
    const green = "\x1b[32m";
    const red_bg = "\x1b[41m";
    const green_bg = "\x1b[42m";
    const dim = "\x1b[2m";
    const reset = "\x1b[0m";
};

pub fn printDiff(arena: std.mem.Allocator, writer: anytype, segments: []const Diff, enable_ansi_colors: bool) !void {
    var line_buffer = std.ArrayList(Diff).init(arena);
    defer line_buffer.deinit();

    var before_line_number: usize = 1;
    var after_line_number: usize = 1;

    for (segments) |segment| {
        var text_iterator = std.mem.splitScalar(u8, segment.text, '\n');

        // The first part of a split always belongs to the current line being built.
        // It's safe to call next() because even for an empty string, it returns one empty slice.
        const first_part = text_iterator.next().?;
        if (first_part.len > 0) {
            try line_buffer.append(.{ .operation = segment.operation, .text = first_part });
        }

        // Any subsequent parts mean we've crossed a newline.
        // Each part (except the very last one in the stream) is a complete line.
        while (text_iterator.next()) |part| {
            switch (segment.operation) {
                .delete => before_line_number += 1,
                .insert => after_line_number += 1,
                .equal => {},
            }

            // Process the completed line in the buffer.
            try printLine(writer, line_buffer.items, enable_ansi_colors);
            line_buffer.clearRetainingCapacity();

            // The new part becomes the start of the next line.
            if (part.len > 0) {
                try line_buffer.append(.{ .operation = segment.operation, .text = part });
            }
        }
    }

    // After the loop, print the last line
    try printLine(writer, line_buffer.items, enable_ansi_colors);
}

const ModifiedMode = enum {
    added,
    removed,
    modified,
    equal,
};
fn getMode(line_segments: []const Diff) ModifiedMode {
    var has_inserts = false;
    var has_deletes = false;
    var has_equal = false;
    for (line_segments) |segment| {
        switch (segment.operation) {
            .insert => has_inserts = true,
            .delete => has_deletes = true,
            .equal => has_equal = true,
        }
    }

    if (has_inserts and !has_deletes and !has_equal) return .added;
    if (has_deletes and !has_inserts and !has_equal) return .removed;
    if (has_equal and !has_inserts and !has_deletes) return .equal;
    return .modified;
}

// Helper function to format and print a single logical line.
fn printLine(writer: anytype, line_segments: []const Diff, enable_ansi_colors: bool) !void {
    const mode = getMode(line_segments);
    const insert_line = switch (enable_ansi_colors) {
        true => colors.green ++ "+" ++ colors.reset ++ " ",
        false => "+ ",
    };
    const delete_line = switch (enable_ansi_colors) {
        true => colors.red ++ "-" ++ colors.reset ++ " ",
        false => "- ",
    };
    const red_bg = switch (enable_ansi_colors) {
        true => colors.red_bg,
        false => "",
    };
    const green_bg = switch (enable_ansi_colors) {
        true => colors.green_bg,
        false => "",
    };
    const dim = switch (enable_ansi_colors) {
        true => colors.dim,
        false => "",
    };
    const reset = switch (enable_ansi_colors) {
        true => colors.reset,
        false => "",
    };

    switch (mode) {
        .modified => {
            // Modified line: print delete line, then insert line
            try writer.writeAll(delete_line);
            for (line_segments) |s| switch (s.operation) {
                .delete => try writer.print("{s}{s}{s}", .{ red_bg, s.text, reset }),
                .equal => try writer.print("{s}{s}{s}", .{ dim, s.text, reset }),
                .insert => {}, // Skip inserts on the delete line
            };
            try writer.writeAll("\n");

            try writer.writeAll(insert_line);
            for (line_segments) |s| switch (s.operation) {
                .insert => try writer.print("{s}{s}{s}", .{ green_bg, s.text, reset }),
                .equal => try writer.print("{s}{s}{s}", .{ dim, s.text, reset }),
                .delete => {}, // Skip deletes on the insert line
            };
            try writer.writeAll("\n");
        },
        .added => {
            // Line added
            try writer.writeAll(insert_line);
            try writer.writeAll(green_bg);
            for (line_segments) |s| try writer.writeAll(s.text);
            try writer.writeAll(reset);
            try writer.writeAll("\n");
        },
        .removed => {
            // Line removed
            try writer.writeAll(delete_line);
            try writer.writeAll(red_bg);
            for (line_segments) |s| try writer.writeAll(s.text);
            try writer.writeAll(reset);
            try writer.writeAll("\n");
        },
        .equal => {
            // Equal-only line
            try writer.writeAll("  ");
            try writer.writeAll(dim);
            for (line_segments) |s| try writer.writeAll(s.text);
            try writer.writeAll(reset);
            try writer.writeAll("\n");
        },
    }
}

// @sortImports

const std = @import("std");

const DiffMatchPatch = @import("../../deps/diffz/DiffMatchPatch.zig");
const Diff = DiffMatchPatch.Diff;
