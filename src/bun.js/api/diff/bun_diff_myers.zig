//! Myers diff algorithm implementation
//!
//! Based on Eugene Myers' "An O(ND) Difference Algorithm and Its Variations" (1986).
//! Produces minimal edit scripts (shortest sequence of insertions and deletions).
//!
//! Optimizations (borrowed from git):
//! - Common prefix/suffix trimming before Myers (huge win for similar files)
//! - Comptime-configurable heuristics for early termination

const std = @import("std");
const LineIndex = @import("bun_diff_line.zig").LineIndex;

/// Configuration for diff heuristics (comptime)
pub const DiffConfig = struct {
    /// Maximum edit distance before giving up on optimal diff.
    /// When exceeded, falls back to simple delete+insert.
    /// Set to 0 to disable (always find optimal).
    /// Git uses ~sqrt(n+m) * 2 as a heuristic.
    max_edit_distance: usize = 0,

    /// Enable common prefix/suffix trimming optimization
    trim_common_affixes: bool = true,
};

/// Default configuration optimized for typical code diffs
pub const default_config = DiffConfig{
    // Bail out after 4000 edits - covers 99% of real diffs while
    // avoiding pathological O(N*D) blowup on very different files
    .max_edit_distance = 4000,
    .trim_common_affixes = true,
};

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
    return diffWithConfig(old, new, allocator, default_config);
}

/// Compute diff with custom configuration
pub fn diffWithConfig(
    old: LineIndex,
    new: LineIndex,
    allocator: std.mem.Allocator,
    comptime config: DiffConfig,
) ![]Edit {
    const n_full: usize = old.len();
    const m_full: usize = new.len();

    // Edge cases
    if (n_full == 0 and m_full == 0) {
        return try allocator.alloc(Edit, 0);
    }

    if (n_full == 0) {
        const edits = try allocator.alloc(Edit, 1);
        edits[0] = .{ .insert = .{
            .old_start = 0,
            .old_end = 0,
            .new_start = 0,
            .new_end = @intCast(m_full),
        } };
        return edits;
    }

    if (m_full == 0) {
        const edits = try allocator.alloc(Edit, 1);
        edits[0] = .{ .delete = .{
            .old_start = 0,
            .old_end = @intCast(n_full),
            .new_start = 0,
            .new_end = 0,
        } };
        return edits;
    }

    // Trim common prefix and suffix (git's key optimization)
    var prefix_len: usize = 0;
    var suffix_len: usize = 0;

    if (config.trim_common_affixes) {
        // Common prefix
        const min_len = @min(n_full, m_full);
        while (prefix_len < min_len and old.linesEqual(new, prefix_len, prefix_len)) {
            prefix_len += 1;
        }

        // Common suffix (don't overlap with prefix)
        const remaining_old = n_full - prefix_len;
        const remaining_new = m_full - prefix_len;
        const max_suffix = @min(remaining_old, remaining_new);
        while (suffix_len < max_suffix and
            old.linesEqual(new, n_full - 1 - suffix_len, m_full - 1 - suffix_len))
        {
            suffix_len += 1;
        }
    }

    // Calculate trimmed range
    const n_trimmed = n_full - prefix_len - suffix_len;
    const m_trimmed = m_full - prefix_len - suffix_len;

    // Build result with prefix, middle diff, and suffix
    var result = std.array_list.Managed(Edit).init(allocator);
    errdefer result.deinit();

    // Add common prefix as equal
    if (prefix_len > 0) {
        try result.append(.{ .equal = .{
            .old_start = 0,
            .old_end = @intCast(prefix_len),
            .new_start = 0,
            .new_end = @intCast(prefix_len),
        } });
    }

    // Diff the middle (trimmed) portion
    if (n_trimmed > 0 or m_trimmed > 0) {
        const middle_edits = try diffCore(
            old,
            new,
            prefix_len,
            n_trimmed,
            m_trimmed,
            allocator,
            config,
        );
        defer allocator.free(middle_edits);

        for (middle_edits) |edit| {
            try result.append(edit);
        }
    }

    // Add common suffix as equal
    if (suffix_len > 0) {
        try result.append(.{ .equal = .{
            .old_start = @intCast(n_full - suffix_len),
            .old_end = @intCast(n_full),
            .new_start = @intCast(m_full - suffix_len),
            .new_end = @intCast(m_full),
        } });
    }

    return result.toOwnedSlice();
}

/// Core Myers diff on a subrange of lines
fn diffCore(
    old: LineIndex,
    new: LineIndex,
    offset: usize,
    n_len: usize,
    m_len: usize,
    allocator: std.mem.Allocator,
    comptime config: DiffConfig,
) ![]Edit {
    const n: isize = @intCast(n_len);
    const m: isize = @intCast(m_len);
    const off: u32 = @intCast(offset);

    // Handle edge cases for trimmed range
    if (n == 0 and m == 0) {
        return try allocator.alloc(Edit, 0);
    }

    if (n == 0) {
        const edits = try allocator.alloc(Edit, 1);
        edits[0] = .{ .insert = .{
            .old_start = off,
            .old_end = off,
            .new_start = off,
            .new_end = off + @as(u32, @intCast(m)),
        } };
        return edits;
    }

    if (m == 0) {
        const edits = try allocator.alloc(Edit, 1);
        edits[0] = .{ .delete = .{
            .old_start = off,
            .old_end = off + @as(u32, @intCast(n)),
            .new_start = off,
            .new_end = off,
        } };
        return edits;
    }

    const max: isize = n + m;
    const max_usize: usize = @intCast(max);

    // Early termination limit (comptime evaluated)
    const edit_limit: usize = if (config.max_edit_distance > 0)
        @min(config.max_edit_distance, max_usize)
    else
        max_usize;

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
    var exceeded_limit = false;
    outer: for (0..edit_limit + 1) |d_usize| {
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
            // Note: x,y are relative to trimmed range, but linesEqual needs absolute indices
            while (x < n and y < m and old.linesEqual(new, @intCast(offset + @as(usize, @intCast(x))), @intCast(offset + @as(usize, @intCast(y))))) {
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

        // Check if we've hit the edit limit without finding a solution
        if (d_usize == edit_limit and config.max_edit_distance > 0) {
            exceeded_limit = true;
        }
    }

    // If we exceeded the limit, fall back to simple delete+insert
    if (exceeded_limit) {
        const edits = try allocator.alloc(Edit, 2);
        edits[0] = .{ .delete = .{
            .old_start = off,
            .old_end = off + @as(u32, @intCast(n)),
            .new_start = off,
            .new_end = off,
        } };
        edits[1] = .{ .insert = .{
            .old_start = off + @as(u32, @intCast(n)),
            .old_end = off + @as(u32, @intCast(n)),
            .new_start = off,
            .new_end = off + @as(u32, @intCast(m)),
        } };
        return edits;
    }

    // Backtrack to build edit script
    const raw_edits = try backtrack(trace.items, n, m, max, found_d, off, allocator);
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
    offset: u32, // Add offset to convert relative indices to absolute
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
        // Note: x,y are relative to trimmed range, add offset for absolute indices
        while (x > prev_x and y > prev_y) {
            x -= 1;
            y -= 1;
            try edits.append(.{ .equal = .{
                .old_start = offset + @as(u32, @intCast(x)),
                .old_end = offset + @as(u32, @intCast(x + 1)),
                .new_start = offset + @as(u32, @intCast(y)),
                .new_end = offset + @as(u32, @intCast(y + 1)),
            } });
        }

        if (d_iter > 0) {
            if (x == prev_x) {
                // Insert
                y -= 1;
                try edits.append(.{ .insert = .{
                    .old_start = offset + @as(u32, @intCast(x)),
                    .old_end = offset + @as(u32, @intCast(x)),
                    .new_start = offset + @as(u32, @intCast(y)),
                    .new_end = offset + @as(u32, @intCast(y + 1)),
                } });
            } else {
                // Delete
                x -= 1;
                try edits.append(.{ .delete = .{
                    .old_start = offset + @as(u32, @intCast(x)),
                    .old_end = offset + @as(u32, @intCast(x + 1)),
                    .new_start = offset + @as(u32, @intCast(y)),
                    .new_end = offset + @as(u32, @intCast(y)),
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
