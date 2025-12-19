//! Myers diff algorithm implementation
//!
//! Based on Eugene Myers' "An O(ND) Difference Algorithm and Its Variations" (1986).
//! Produces minimal edit scripts (shortest sequence of insertions and deletions).

const std = @import("std");
const LineIndex = @import("bun_diff_line.zig").LineIndex;

/// Range of lines affected by an edit
pub const Range = struct {
    old_start: u32,
    old_end: u32,
    new_start: u32,
    new_end: u32,
};

/// A single edit operation
pub const Edit = union(enum) {
    /// Lines are equal in both versions
    equal: Range,
    /// Lines were deleted from old version
    delete: Range,
    /// Lines were inserted in new version
    insert: Range,
};

/// Compute shortest edit script using Myers algorithm
pub fn diff(
    old: LineIndex,
    new: LineIndex,
    allocator: std.mem.Allocator,
) ![]Edit {
    const n: isize = @intCast(old.len());
    const m: isize = @intCast(new.len());

    // Edge cases
    if (n == 0 and m == 0) {
        return try allocator.alloc(Edit, 0);
    }

    if (n == 0) {
        const edits = try allocator.alloc(Edit, 1);
        edits[0] = .{ .insert = .{
            .old_start = 0,
            .old_end = 0,
            .new_start = 0,
            .new_end = @intCast(m),
        } };
        return edits;
    }

    if (m == 0) {
        const edits = try allocator.alloc(Edit, 1);
        edits[0] = .{ .delete = .{
            .old_start = 0,
            .old_end = @intCast(n),
            .new_start = 0,
            .new_end = 0,
        } };
        return edits;
    }

    const max: isize = n + m;
    const max_usize: usize = @intCast(max);

    // V array: stores furthest reaching x for each diagonal k
    // Index as v[offset + k] where offset = max
    const v_size = 2 * max_usize + 1;
    var v = try allocator.alloc(isize, v_size);
    defer allocator.free(v);
    @memset(v, 0);

    // Trace for backtracking - store V state at each step
    var trace = std.array_list.Managed([]isize).init(allocator);
    defer {
        for (trace.items) |t| allocator.free(t);
        trace.deinit();
    }

    // Find shortest edit script
    var found_d: usize = 0;
    outer: for (0..max_usize + 1) |d_usize| {
        const d: isize = @intCast(d_usize);

        // Save V for backtracking
        const v_copy = try allocator.dupe(isize, v);
        try trace.append(v_copy);

        // k ranges from -d to d in steps of 2
        var k: isize = -d;
        while (k <= d) : (k += 2) {
            // Determine x from previous step
            var x: isize = undefined;

            // Decide whether to move down (insert) or right (delete)
            // At the edges we have no choice, in the middle compare furthest x
            const go_down = if (k == -d) true else if (k == d) false else blk: {
                const k_minus_1_idx: usize = @intCast(max + k - 1);
                const k_plus_1_idx: usize = @intCast(max + k + 1);
                break :blk v[k_minus_1_idx] < v[k_plus_1_idx];
            };

            if (go_down) {
                // Move down (insert)
                const k_plus_1_idx: usize = @intCast(max + k + 1);
                x = v[k_plus_1_idx];
            } else {
                // Move right (delete)
                const k_minus_1_idx: usize = @intCast(max + k - 1);
                x = v[k_minus_1_idx] + 1;
            }

            var y = x - k;

            // Follow diagonal (matching lines)
            while (x < n and y < m and old.linesEqual(new, @intCast(x), @intCast(y))) {
                x += 1;
                y += 1;
            }

            const k_idx: usize = @intCast(max + k);
            v[k_idx] = x;

            // Check if we reached the end
            if (x >= n and y >= m) {
                found_d = d_usize;
                break :outer;
            }
        }
    }

    // Backtrack to build edit script
    const raw_edits = try backtrack(trace.items, n, m, max, found_d, allocator);
    defer allocator.free(raw_edits);

    // Coalesce adjacent edits of the same type
    return coalesce(raw_edits, allocator);
}

fn backtrack(
    trace: []const []isize,
    n: isize,
    m: isize,
    max: isize,
    found_d: usize,
    allocator: std.mem.Allocator,
) ![]Edit {
    var edits = std.array_list.Managed(Edit).init(allocator);

    var x = n;
    var y = m;

    var d_iter: isize = @intCast(found_d);
    while (d_iter >= 0) : (d_iter -= 1) {
        const d_usize: usize = @intCast(d_iter);
        const v_d = trace[d_usize];
        const k = x - y;

        var prev_k: isize = undefined;

        if (d_iter == 0) {
            // At d=0, we started at (0,0)
            prev_k = 0;
        } else {
            // Decide whether we came from insert (k+1) or delete (k-1)
            const came_from_insert = if (k == -d_iter) true else if (k == d_iter) false else blk: {
                const k_minus_1_idx: usize = @intCast(max + k - 1);
                const k_plus_1_idx: usize = @intCast(max + k + 1);
                break :blk v_d[k_minus_1_idx] < v_d[k_plus_1_idx];
            };

            if (came_from_insert) {
                prev_k = k + 1;
            } else {
                prev_k = k - 1;
            }
        }

        const prev_x = v_d[@intCast(max + prev_k)];
        const prev_y = prev_x - prev_k;

        // Add diagonal moves (equals)
        while (x > prev_x and y > prev_y) {
            x -= 1;
            y -= 1;
            try edits.append(.{ .equal = .{
                .old_start = @intCast(x),
                .old_end = @intCast(x + 1),
                .new_start = @intCast(y),
                .new_end = @intCast(y + 1),
            } });
        }

        if (d_iter > 0) {
            if (x == prev_x) {
                // Insert
                y -= 1;
                try edits.append(.{ .insert = .{
                    .old_start = @intCast(x),
                    .old_end = @intCast(x),
                    .new_start = @intCast(y),
                    .new_end = @intCast(y + 1),
                } });
            } else {
                // Delete
                x -= 1;
                try edits.append(.{ .delete = .{
                    .old_start = @intCast(x),
                    .old_end = @intCast(x + 1),
                    .new_start = @intCast(y),
                    .new_end = @intCast(y),
                } });
            }
        }
    }

    const result = try edits.toOwnedSlice();
    std.mem.reverse(Edit, result);
    return result;
}

/// Coalesce adjacent edits of the same type into single ranges
fn coalesce(edits: []const Edit, allocator: std.mem.Allocator) ![]Edit {
    if (edits.len == 0) return try allocator.alloc(Edit, 0);

    var result = std.array_list.Managed(Edit).init(allocator);

    var current = edits[0];

    for (edits[1..]) |edit| {
        const can_merge = switch (current) {
            .equal => |c| switch (edit) {
                .equal => |e| c.old_end == e.old_start and c.new_end == e.new_start,
                else => false,
            },
            .insert => |c| switch (edit) {
                .insert => |e| c.old_end == e.old_start and c.new_end == e.new_start,
                else => false,
            },
            .delete => |c| switch (edit) {
                .delete => |e| c.old_end == e.old_start and c.new_end == e.new_start,
                else => false,
            },
        };

        if (can_merge) {
            // Extend current range
            switch (current) {
                .equal => |*c| {
                    c.old_end = edit.equal.old_end;
                    c.new_end = edit.equal.new_end;
                },
                .insert => |*c| {
                    c.old_end = edit.insert.old_end;
                    c.new_end = edit.insert.new_end;
                },
                .delete => |*c| {
                    c.old_end = edit.delete.old_end;
                    c.new_end = edit.delete.new_end;
                },
            }
        } else {
            // Save current, start new
            try result.append(current);
            current = edit;
        }
    }

    // Don't forget the last one
    try result.append(current);

    return result.toOwnedSlice();
}

test "diff empty strings" {
    const a = "";
    const b = "";

    var a_lines = try LineIndex.init(a, std.testing.allocator);
    defer a_lines.deinit();
    var b_lines = try LineIndex.init(b, std.testing.allocator);
    defer b_lines.deinit();

    const edits = try diff(a_lines, b_lines, std.testing.allocator);
    defer std.testing.allocator.free(edits);

    try std.testing.expectEqual(@as(usize, 0), edits.len);
}

test "diff identical" {
    const content = "line1\nline2\n";

    var a_lines = try LineIndex.init(content, std.testing.allocator);
    defer a_lines.deinit();
    var b_lines = try LineIndex.init(content, std.testing.allocator);
    defer b_lines.deinit();

    const edits = try diff(a_lines, b_lines, std.testing.allocator);
    defer std.testing.allocator.free(edits);

    // All lines should be equal
    try std.testing.expectEqual(@as(usize, 1), edits.len);
    try std.testing.expectEqual(Edit{ .equal = .{
        .old_start = 0,
        .old_end = 2,
        .new_start = 0,
        .new_end = 2,
    } }, edits[0]);
}

test "diff insertion" {
    const a = "a\nc\n";
    const b = "a\nb\nc\n";

    var a_lines = try LineIndex.init(a, std.testing.allocator);
    defer a_lines.deinit();
    var b_lines = try LineIndex.init(b, std.testing.allocator);
    defer b_lines.deinit();

    const edits = try diff(a_lines, b_lines, std.testing.allocator);
    defer std.testing.allocator.free(edits);

    // Should have: equal(a), insert(b), equal(c)
    try std.testing.expectEqual(@as(usize, 3), edits.len);
}

test "diff deletion" {
    const a = "a\nb\nc\n";
    const b = "a\nc\n";

    var a_lines = try LineIndex.init(a, std.testing.allocator);
    defer a_lines.deinit();
    var b_lines = try LineIndex.init(b, std.testing.allocator);
    defer b_lines.deinit();

    const edits = try diff(a_lines, b_lines, std.testing.allocator);
    defer std.testing.allocator.free(edits);

    // Should have: equal(a), delete(b), equal(c)
    try std.testing.expectEqual(@as(usize, 3), edits.len);
}
