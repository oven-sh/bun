// Added cyan for the hunk headers.
const colors = struct {
    const red = "\x1b[31m";
    const green = "\x1b[32m";
    const cyan = "\x1b[36m";
    const red_bg = "\x1b[41m";
    const green_bg = "\x1b[42m";
    const dim = "\x1b[2m";
    const reset = "\x1b[0m";
};

/// The number of "equal" lines to show before and after a change.
const CONTEXT_LINES = 5;

pub fn printDiff(
    arena: std.mem.Allocator,
    writer: anytype,
    segments: []const Diff,
    enable_ansi_colors: bool,
) !void {
    // A logical line in the diff, containing all its segments and its type.
    const Line = struct {
        mode: ModifiedMode,
        segments: []const Diff,
    };

    // --- Pass 1: Group segments into logical lines ---
    // We create a list of `Line` structs. Each line's segments are slices
    // pointing into a single, flat `segment_store` buffer. This is memory-efficient.
    var lines = std.ArrayList(Line).init(arena);

    var line_buffer = std.ArrayList(Diff).init(arena);

    for (segments) |segment| {
        var text_iterator = std.mem.splitScalar(u8, segment.text, '\n');

        const first_part = text_iterator.next().?;
        if (first_part.len > 0) {
            try line_buffer.append(.{ .operation = segment.operation, .text = first_part });
        }

        while (text_iterator.next()) |part| {
            // A newline was crossed, so the line_buffer contains a complete line.
            const line_segs_slice = try arena.alloc(Diff, line_buffer.items.len);
            @memcpy(line_segs_slice, line_buffer.items);

            try lines.append(.{
                .mode = getMode(line_segs_slice),
                .segments = line_segs_slice,
            });
            line_buffer.clearRetainingCapacity();

            if (part.len > 0) {
                try line_buffer.append(.{ .operation = segment.operation, .text = part });
            }
        }
    }

    // Process the final line in the buffer.
    if (line_buffer.items.len > 0) {
        const line_segs_slice = try arena.alloc(Diff, line_buffer.items.len);
        @memcpy(line_segs_slice, line_buffer.items);

        try lines.append(.{
            .mode = getMode(line_segs_slice),
            .segments = line_segs_slice,
        });
    }

    if (lines.items.len == 0) return;

    // --- Pass 2: Mark which lines to print (changes + context) ---
    var print_flags = try arena.alloc(bool, lines.items.len);
    for (print_flags) |*flag| flag.* = false;

    for (lines.items, 0..) |line, i| {
        if (line.mode != .equal) {
            // Mark the changed line itself.
            print_flags[i] = true;
            // Mark CONTEXT_LINES before.
            var j: usize = 1;
            while (j <= CONTEXT_LINES and i >= j) : (j += 1) {
                print_flags[i - j] = true;
            }
            // Mark CONTEXT_LINES after.
            j = 1;
            while (j <= CONTEXT_LINES and i + j < lines.items.len) : (j += 1) {
                print_flags[i + j] = true;
            }
        }
    }

    var line_a: usize = 1;
    var line_b: usize = 1;
    var i: usize = 0;

    while (i < lines.items.len) {
        // 1. Skip non-printed lines and update line counters
        if (!print_flags[i]) {
            const mode = lines.items[i].mode;
            if (mode != .added) line_a += 1;
            if (mode != .removed) line_b += 1;
            i += 1;
            continue;
        }

        // 2. We are at the start of a hunk. Calculate its stats.
        const hunk_start_a = line_a;
        const hunk_start_b = line_b;
        var hunk_count_a: usize = 0;
        var hunk_count_b: usize = 0;
        const hunk_start_index = i;
        var hunk_end_index = i;

        var j = i;
        while (j < lines.items.len and print_flags[j]) : (j += 1) {
            hunk_end_index = j;
            const mode = lines.items[j].mode;
            if (mode != .added) hunk_count_a += 1;
            if (mode != .removed) hunk_count_b += 1;
        }

        // 3. Print the hunk header
        const header_color = if (enable_ansi_colors) colors.cyan else "";
        const reset_color = if (enable_ansi_colors) colors.reset else "";
        try writer.print("{s}@@", .{header_color});
        if (hunk_count_a == 1) {
            try writer.print(" -{d}", .{hunk_start_a});
        } else {
            try writer.print(" -{d},{d}", .{ hunk_start_a, hunk_count_a });
        }
        if (hunk_count_b == 1) {
            try writer.print(" +{d}", .{hunk_start_b});
        } else {
            try writer.print(" +{d},{d}", .{ hunk_start_b, hunk_count_b });
        }
        try writer.print(" @@{s}\n", .{reset_color});

        // 4. Print the lines within the hunk and update main line counters
        j = hunk_start_index;
        while (j <= hunk_end_index) : (j += 1) {
            const line = lines.items[j];
            try printLine(writer, line.segments, enable_ansi_colors);
            const mode = line.mode;
            if (mode != .added) line_a += 1;
            if (mode != .removed) line_b += 1;
        }

        // 5. Move main index past the hunk we just printed
        i = hunk_end_index + 1;
    }
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
    if (line_segments.len == 0) {
        // This can happen for empty lines at the end of the file.
        // We print a single newline to represent it correctly.
        try writer.writeAll("\n");
        return;
    }

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
            if (enable_ansi_colors) try writer.writeAll(green_bg);
            for (line_segments) |s| try writer.writeAll(s.text);
            if (enable_ansi_colors) try writer.writeAll(reset);
            try writer.writeAll("\n");
        },
        .removed => {
            // Line removed
            try writer.writeAll(delete_line);
            if (enable_ansi_colors) try writer.writeAll(red_bg);
            for (line_segments) |s| try writer.writeAll(s.text);
            if (enable_ansi_colors) try writer.writeAll(reset);
            try writer.writeAll("\n");
        },
        .equal => {
            // Equal-only line
            try writer.writeAll("  ");
            if (enable_ansi_colors) try writer.writeAll(dim);
            for (line_segments) |s| try writer.writeAll(s.text);
            if (enable_ansi_colors) try writer.writeAll(reset);
            try writer.writeAll("\n");
        },
    }
}

// @sortImports

const std = @import("std");

const DiffMatchPatch = @import("../../deps/diffz/DiffMatchPatch.zig");
const Diff = DiffMatchPatch.Diff;
