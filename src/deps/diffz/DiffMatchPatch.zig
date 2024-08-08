// MIT License

// Copyright (c) 2023 diffz authors

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

const DiffMatchPatch = @This();

const std = @import("std");
const bun = @import("root").bun;
const testing = std.testing;
const ArrayListUnmanaged = std.ArrayListUnmanaged;
const DiffList = ArrayListUnmanaged(Diff);

/// DMP with default configuration options
pub const default = DiffMatchPatch{};

pub const Diff = struct {
    pub const Operation = enum {
        insert,
        delete,
        equal,
    };

    operation: Operation,
    text: []const u8,

    pub fn format(value: Diff, _: anytype, _: anytype, writer: anytype) !void {
        try writer.print("({s}, \"{s}\")", .{
            switch (value.operation) {
                .equal => "=",
                .insert => "+",
                .delete => "-",
            },
            value.text,
        });
    }

    pub fn init(operation: Operation, text: []const u8) Diff {
        return .{ .operation = operation, .text = text };
    }
    pub fn eql(a: Diff, b: Diff) bool {
        return a.operation == b.operation and std.mem.eql(u8, a.text, b.text);
    }
};

/// Number of milliseconds to map a diff before giving up (0 for infinity).
diff_timeout: u64 = 1000,
/// Cost of an empty edit operation in terms of edit characters.
diff_edit_cost: u16 = 4,

/// At what point is no match declared (0.0 = perfection, 1.0 = very loose).
match_threshold: f32 = 0.5,
/// How far to search for a match (0 = exact location, 1000+ = broad match).
/// A match this many characters away from the expected location will add
/// 1.0 to the score (0.0 is a perfect match).
match_distance: u32 = 1000,
/// The number of bits in an int.
match_max_bits: u16 = 32,

/// When deleting a large block of text (over ~64 characters), how close
/// do the contents have to be to match the expected contents. (0.0 =
/// perfection, 1.0 = very loose).  Note that Match_Threshold controls
/// how closely the end points of a delete need to match.
patch_delete_threshold: f32 = 0.5,
/// Chunk size for context length.
patch_margin: u16 = 4,

pub const DiffError = error{OutOfMemory};

/// It is recommended that you use an Arena for this operation.
///
/// Find the differences between two texts.
/// @param before Old string to be diffed.
/// @param after New string to be diffed.
/// @param checklines Speedup flag.  If false, then don't run a
///     line-level diff first to identify the changed areas.
///     If true, then run a faster slightly less optimal diff.
/// @return List of Diff objects.
pub fn diff(
    dmp: DiffMatchPatch,
    allocator: std.mem.Allocator,
    before: []const u8,
    after: []const u8,
    /// If false, then don't run a line-level diff first
    /// to identify the changed areas. If true, then run
    /// a faster slightly less optimal diff.
    check_lines: bool,
) DiffError!DiffList {
    const deadline = if (dmp.diff_timeout == 0)
        std.math.maxInt(u64)
    else
        @as(u64, @intCast(std.time.milliTimestamp())) + dmp.diff_timeout;
    return dmp.diffInternal(allocator, before, after, check_lines, deadline);
}

/// Find difference between two texts by line.
/// @param text1 Old string to be diffed.
/// @param text2 New string to be diffed.
/// @param deadline Time when the diff should be complete by.
/// @return List of Diff objects.
pub fn diffLines(
    dmp: DiffMatchPatch,
    allocator: std.mem.Allocator,
    text1_in: []const u8,
    text2_in: []const u8,
) DiffError!DiffList {
    const deadline = if (dmp.diff_timeout == 0)
        std.math.maxInt(u64)
    else
        @as(u64, @intCast(std.time.milliTimestamp())) + dmp.diff_timeout;

    const a = try diffLinesToChars(allocator, text1_in, text2_in);
    const diffs = try dmp.diffInternal(allocator, a.chars_1, a.chars_2, false, deadline);
    try diffCharsToLines(allocator, diffs.items, a.line_array.items);

    return diffs;
}

fn diffInternal(
    dmp: DiffMatchPatch,
    allocator: std.mem.Allocator,
    before: []const u8,
    after: []const u8,
    check_lines: bool,
    deadline: u64,
) DiffError!DiffList {
    // Check for equality (speedup).
    var diffs = DiffList{};
    if (std.mem.eql(u8, before, after)) {
        if (before.len != 0) {
            try diffs.append(allocator, Diff.init(.equal, try allocator.dupe(u8, before)));
        }
        return diffs;
    }

    // Trim off common prefix (speedup).
    var common_length = diffCommonPrefix(before, after);
    const common_prefix = before[0..common_length];
    var trimmed_before = before[common_length..];
    var trimmed_after = after[common_length..];

    // Trim off common suffix (speedup).
    common_length = diffCommonSuffix(trimmed_before, trimmed_after);
    const common_suffix = trimmed_before[trimmed_before.len - common_length ..];
    trimmed_before = trimmed_before[0 .. trimmed_before.len - common_length];
    trimmed_after = trimmed_after[0 .. trimmed_after.len - common_length];

    // Compute the diff on the middle block.
    diffs = try dmp.diffCompute(allocator, trimmed_before, trimmed_after, check_lines, deadline);

    // Restore the prefix and suffix.
    if (common_prefix.len != 0) {
        try diffs.insert(allocator, 0, Diff.init(.equal, try allocator.dupe(u8, common_prefix)));
    }
    if (common_suffix.len != 0) {
        try diffs.append(allocator, Diff.init(.equal, try allocator.dupe(u8, common_suffix)));
    }

    try diffCleanupMerge(allocator, &diffs);
    return diffs;
}

fn diffCommonPrefix(before: []const u8, after: []const u8) usize {
    const n = @min(before.len, after.len);
    var i: usize = 0;

    while (i < n) : (i += 1) {
        if (before[i] != after[i]) {
            return i;
        }
    }

    return n;
}

fn diffCommonSuffix(before: []const u8, after: []const u8) usize {
    const n = @min(before.len, after.len);
    var i: usize = 1;

    while (i <= n) : (i += 1) {
        if (before[before.len - i] != after[after.len - i]) {
            return i - 1;
        }
    }

    return n;
}

/// Find the differences between two texts.  Assumes that the texts do not
/// have any common prefix or suffix.
/// @param before Old string to be diffed.
/// @param after New string to be diffed.
/// @param checklines Speedup flag.  If false, then don't run a
///     line-level diff first to identify the changed areas.
///     If true, then run a faster slightly less optimal diff.
/// @param deadline Time when the diff should be complete by.
/// @return List of Diff objects.
fn diffCompute(
    dmp: DiffMatchPatch,
    allocator: std.mem.Allocator,
    before: []const u8,
    after: []const u8,
    check_lines: bool,
    deadline: u64,
) DiffError!DiffList {
    var diffs = DiffList{};

    if (before.len == 0) {
        // Just add some text (speedup).
        try diffs.append(allocator, Diff.init(.insert, try allocator.dupe(u8, after)));
        return diffs;
    }

    if (after.len == 0) {
        // Just delete some text (speedup).
        try diffs.append(allocator, Diff.init(.delete, try allocator.dupe(u8, before)));
        return diffs;
    }

    const long_text = if (before.len > after.len) before else after;
    const short_text = if (before.len > after.len) after else before;

    if (std.mem.indexOf(u8, long_text, short_text)) |index| {
        // Shorter text is inside the longer text (speedup).
        const op: Diff.Operation = if (before.len > after.len)
            .delete
        else
            .insert;
        try diffs.append(allocator, Diff.init(op, try allocator.dupe(u8, long_text[0..index])));
        try diffs.append(allocator, Diff.init(.equal, try allocator.dupe(u8, short_text)));
        try diffs.append(allocator, Diff.init(op, try allocator.dupe(u8, long_text[index + short_text.len ..])));
        return diffs;
    }

    if (short_text.len == 1) {
        // Single character string.
        // After the previous speedup, the character can't be an equality.
        try diffs.append(allocator, Diff.init(.delete, before));
        try diffs.append(allocator, Diff.init(.insert, after));
        return diffs;
    }

    // Check to see if the problem can be split in two.
    if (try dmp.diffHalfMatch(allocator, before, after)) |half_match| {
        // A half-match was found, sort out the return data.

        // Send both pairs off for separate processing.
        const diffs_a = try dmp.diffInternal(
            allocator,
            half_match.prefix_before,
            half_match.prefix_after,
            check_lines,
            deadline,
        );
        var diffs_b = try dmp.diffInternal(
            allocator,
            half_match.suffix_before,
            half_match.suffix_after,
            check_lines,
            deadline,
        );
        defer diffs_b.deinit(allocator);

        var tmp_diffs = diffs;
        defer tmp_diffs.deinit(allocator);

        // Merge the results.
        diffs = diffs_a;
        try diffs.append(allocator, Diff.init(.equal, half_match.common_middle));
        try diffs.appendSlice(allocator, diffs_b.items);
        return diffs;
    }

    if (check_lines and before.len > 100 and after.len > 100) {
        return dmp.diffLineMode(allocator, before, after, deadline);
    }

    return dmp.diffBisect(allocator, before, after, deadline);
}

const HalfMatchResult = struct {
    prefix_before: []const u8,
    suffix_before: []const u8,
    prefix_after: []const u8,
    suffix_after: []const u8,
    common_middle: []const u8,
};

/// Do the two texts share a Substring which is at least half the length of
/// the longer text?
/// This speedup can produce non-minimal diffs.
/// @param before First string.
/// @param after Second string.
/// @return Five element String array, containing the prefix of text1, the
///     suffix of text1, the prefix of text2, the suffix of text2 and the
///     common middle.  Or null if there was no match.
fn diffHalfMatch(
    dmp: DiffMatchPatch,
    allocator: std.mem.Allocator,
    before: []const u8,
    after: []const u8,
) DiffError!?HalfMatchResult {
    if (dmp.diff_timeout <= 0) {
        // Don't risk returning a non-optimal diff if we have unlimited time.
        return null;
    }
    const long_text = if (before.len > after.len) before else after;
    const short_text = if (before.len > after.len) after else before;

    if (long_text.len < 4 or short_text.len * 2 < long_text.len) {
        return null; // Pointless.
    }

    // First check if the second quarter is the seed for a half-match.
    const half_match_1 = try dmp.diffHalfMatchInternal(allocator, long_text, short_text, (long_text.len + 3) / 4);
    // Check again based on the third quarter.
    const half_match_2 = try dmp.diffHalfMatchInternal(allocator, long_text, short_text, (long_text.len + 1) / 2);

    var half_match: ?HalfMatchResult = null;
    if (half_match_1 == null and half_match_2 == null) {
        return null;
    } else if (half_match_2 == null) {
        half_match = half_match_1.?;
    } else if (half_match_1 == null) {
        half_match = half_match_2.?;
    } else {
        // Both matched. Select the longest.
        half_match = if (half_match_1.?.common_middle.len > half_match_2.?.common_middle.len)
            half_match_1
        else
            half_match_2;
    }

    // A half-match was found, sort out the return data.
    if (before.len > after.len) {
        return half_match;
    } else {
        const half_match_yes = half_match.?;
        return .{
            .prefix_before = half_match_yes.prefix_after,
            .suffix_before = half_match_yes.suffix_after,
            .prefix_after = half_match_yes.prefix_before,
            .suffix_after = half_match_yes.suffix_before,
            .common_middle = half_match_yes.common_middle,
        };
    }
}

/// Does a Substring of shorttext exist within longtext such that the
/// Substring is at least half the length of longtext?
/// @param longtext Longer string.
/// @param shorttext Shorter string.
/// @param i Start index of quarter length Substring within longtext.
/// @return Five element string array, containing the prefix of longtext, the
///     suffix of longtext, the prefix of shorttext, the suffix of shorttext
///     and the common middle.  Or null if there was no match.
fn diffHalfMatchInternal(
    _: DiffMatchPatch,
    allocator: std.mem.Allocator,
    long_text: []const u8,
    short_text: []const u8,
    i: usize,
) DiffError!?HalfMatchResult {
    // Start with a 1/4 length Substring at position i as a seed.
    const seed = long_text[i .. i + long_text.len / 4];
    var j: isize = -1;

    var best_common = std.ArrayListUnmanaged(u8){};
    var best_long_text_a: []const u8 = "";
    var best_long_text_b: []const u8 = "";
    var best_short_text_a: []const u8 = "";
    var best_short_text_b: []const u8 = "";

    while (j < short_text.len and b: {
        j = @as(isize, @intCast(std.mem.indexOf(u8, short_text[@as(usize, @intCast(j + 1))..], seed) orelse break :b false)) + j + 1;
        break :b true;
    }) {
        const prefix_length = diffCommonPrefix(long_text[i..], short_text[@as(usize, @intCast(j))..]);
        const suffix_length = diffCommonSuffix(long_text[0..i], short_text[0..@as(usize, @intCast(j))]);
        if (best_common.items.len < suffix_length + prefix_length) {
            best_common.items.len = 0;
            try best_common.appendSlice(allocator, short_text[@as(usize, @intCast(j - @as(isize, @intCast(suffix_length)))) .. @as(usize, @intCast(j - @as(isize, @intCast(suffix_length)))) + suffix_length]);
            try best_common.appendSlice(allocator, short_text[@as(usize, @intCast(j)) .. @as(usize, @intCast(j)) + prefix_length]);

            best_long_text_a = long_text[0 .. i - suffix_length];
            best_long_text_b = long_text[i + prefix_length ..];
            best_short_text_a = short_text[0..@as(usize, @intCast(j - @as(isize, @intCast(suffix_length))))];
            best_short_text_b = short_text[@as(usize, @intCast(j + @as(isize, @intCast(prefix_length))))..];
        }
    }
    if (best_common.items.len * 2 >= long_text.len) {
        return .{
            .prefix_before = best_long_text_a,
            .suffix_before = best_long_text_b,
            .prefix_after = best_short_text_a,
            .suffix_after = best_short_text_b,
            .common_middle = best_common.items,
        };
    } else {
        return null;
    }
}

/// Find the 'middle snake' of a diff, split the problem in two
/// and return the recursively constructed diff.
/// See Myers 1986 paper: An O(ND) Difference Algorithm and Its Variations.
/// @param before Old string to be diffed.
/// @param after New string to be diffed.
/// @param deadline Time at which to bail if not yet complete.
/// @return List of Diff objects.
fn diffBisect(
    dmp: DiffMatchPatch,
    allocator: std.mem.Allocator,
    before: []const u8,
    after: []const u8,
    deadline: u64,
) DiffError!DiffList {
    const before_length = @as(isize, @intCast(before.len));
    const after_length = @as(isize, @intCast(after.len));
    const max_d = @as(isize, @intCast((before.len + after.len + 1) / 2));
    const v_offset = max_d;
    const v_length = 2 * max_d;

    var v1 = try ArrayListUnmanaged(isize).initCapacity(allocator, @as(usize, @intCast(v_length)));
    v1.items.len = @as(usize, @intCast(v_length));
    var v2 = try ArrayListUnmanaged(isize).initCapacity(allocator, @as(usize, @intCast(v_length)));
    v2.items.len = @as(usize, @intCast(v_length));

    var x: usize = 0;
    while (x < v_length) : (x += 1) {
        v1.items[x] = -1;
        v2.items[x] = -1;
    }
    v1.items[@as(usize, @intCast(v_offset + 1))] = 0;
    v2.items[@as(usize, @intCast(v_offset + 1))] = 0;
    const delta = before_length - after_length;
    // If the total number of characters is odd, then the front path will
    // collide with the reverse path.
    const front = (@mod(delta, 2) != 0);
    // Offsets for start and end of k loop.
    // Prevents mapping of space beyond the grid.
    var k1start: isize = 0;
    var k1end: isize = 0;
    var k2start: isize = 0;
    var k2end: isize = 0;

    var d: isize = 0;
    while (d < max_d) : (d += 1) {
        // Bail out if deadline is reached.
        if (@as(u64, @intCast(std.time.milliTimestamp())) > deadline) {
            break;
        }

        // Walk the front path one step.
        var k1 = -d + k1start;
        while (k1 <= d - k1end) : (k1 += 2) {
            const k1_offset = v_offset + k1;
            var x1: isize = 0;
            if (k1 == -d or (k1 != d and
                v1.items[@as(usize, @intCast(k1_offset - 1))] < v1.items[@as(usize, @intCast(k1_offset + 1))]))
            {
                x1 = v1.items[@as(usize, @intCast(k1_offset + 1))];
            } else {
                x1 = v1.items[@as(usize, @intCast(k1_offset - 1))] + 1;
            }
            var y1 = x1 - k1;
            while (x1 < before_length and
                y1 < after_length and before[@as(usize, @intCast(x1))] == after[@as(usize, @intCast(y1))])
            {
                x1 += 1;
                y1 += 1;
            }
            v1.items[@as(usize, @intCast(k1_offset))] = x1;
            if (x1 > before_length) {
                // Ran off the right of the graph.
                k1end += 2;
            } else if (y1 > after_length) {
                // Ran off the bottom of the graph.
                k1start += 2;
            } else if (front) {
                const k2_offset = v_offset + delta - k1;
                if (k2_offset >= 0 and k2_offset < v_length and v2.items[@as(usize, @intCast(k2_offset))] != -1) {
                    // Mirror x2 onto top-left coordinate system.
                    const x2 = before_length - v2.items[@as(usize, @intCast(k2_offset))];
                    if (x1 >= x2) {
                        // Overlap detected.
                        return dmp.diffBisectSplit(allocator, before, after, x1, y1, deadline);
                    }
                }
            }
        }

        // Walk the reverse path one step.
        var k2: isize = -d + k2start;
        while (k2 <= d - k2end) : (k2 += 2) {
            const k2_offset = v_offset + k2;
            var x2: isize = 0;
            if (k2 == -d or (k2 != d and
                v2.items[@as(usize, @intCast(k2_offset - 1))] < v2.items[@as(usize, @intCast(k2_offset + 1))]))
            {
                x2 = v2.items[@as(usize, @intCast(k2_offset + 1))];
            } else {
                x2 = v2.items[@as(usize, @intCast(k2_offset - 1))] + 1;
            }
            var y2: isize = x2 - k2;
            while (x2 < before_length and y2 < after_length and
                before[@as(usize, @intCast(before_length - x2 - 1))] ==
                after[@as(usize, @intCast(after_length - y2 - 1))])
            {
                x2 += 1;
                y2 += 1;
            }
            v2.items[@as(usize, @intCast(k2_offset))] = x2;
            if (x2 > before_length) {
                // Ran off the left of the graph.
                k2end += 2;
            } else if (y2 > after_length) {
                // Ran off the top of the graph.
                k2start += 2;
            } else if (!front) {
                const k1_offset = v_offset + delta - k2;
                if (k1_offset >= 0 and k1_offset < v_length and v1.items[@as(usize, @intCast(k1_offset))] != -1) {
                    const x1 = v1.items[@as(usize, @intCast(k1_offset))];
                    const y1 = v_offset + x1 - k1_offset;
                    // Mirror x2 onto top-left coordinate system.
                    x2 = before_length - v2.items[@as(usize, @intCast(k2_offset))];
                    if (x1 >= x2) {
                        // Overlap detected.
                        return dmp.diffBisectSplit(allocator, before, after, x1, y1, deadline);
                    }
                }
            }
        }
    }
    // Diff took too long and hit the deadline or
    // number of diffs equals number of characters, no commonality at all.
    var diffs = DiffList{};
    try diffs.append(allocator, Diff.init(.delete, try allocator.dupe(u8, before)));
    try diffs.append(allocator, Diff.init(.insert, try allocator.dupe(u8, after)));
    return diffs;
}

/// Given the location of the 'middle snake', split the diff in two parts
/// and recurse.
/// @param text1 Old string to be diffed.
/// @param text2 New string to be diffed.
/// @param x Index of split point in text1.
/// @param y Index of split point in text2.
/// @param deadline Time at which to bail if not yet complete.
/// @return LinkedList of Diff objects.
fn diffBisectSplit(
    dmp: DiffMatchPatch,
    allocator: std.mem.Allocator,
    text1: []const u8,
    text2: []const u8,
    x: isize,
    y: isize,
    deadline: u64,
) DiffError!DiffList {
    const text1a = text1[0..@as(usize, @intCast(x))];
    const text2a = text2[0..@as(usize, @intCast(y))];
    const text1b = text1[@as(usize, @intCast(x))..];
    const text2b = text2[@as(usize, @intCast(y))..];

    // Compute both diffs serially.
    var diffs = try dmp.diffInternal(allocator, text1a, text2a, false, deadline);
    var diffsb = try dmp.diffInternal(allocator, text1b, text2b, false, deadline);
    defer diffsb.deinit(allocator);

    try diffs.appendSlice(allocator, diffsb.items);
    return diffs;
}

/// Do a quick line-level diff on both strings, then rediff the parts for
/// greater accuracy.
/// This speedup can produce non-minimal diffs.
/// @param text1 Old string to be diffed.
/// @param text2 New string to be diffed.
/// @param deadline Time when the diff should be complete by.
/// @return List of Diff objects.
fn diffLineMode(
    dmp: DiffMatchPatch,
    allocator: std.mem.Allocator,
    text1_in: []const u8,
    text2_in: []const u8,
    deadline: u64,
) DiffError!DiffList {
    // Scan the text on a line-by-line basis first.
    const a = try diffLinesToChars(allocator, text1_in, text2_in);
    const text1 = a.chars_1;
    const text2 = a.chars_2;
    const line_array = a.line_array;

    var diffs: DiffList = try dmp.diffInternal(allocator, text1, text2, false, deadline);

    // Convert the diff back to original text.
    try diffCharsToLines(allocator, diffs.items, line_array.items);
    // Eliminate freak matches (e.g. blank lines)
    try diffCleanupSemantic(allocator, &diffs);

    // Rediff any replacement blocks, this time character-by-character.
    // Add a dummy entry at the end.
    try diffs.append(allocator, Diff.init(.equal, ""));

    var pointer: usize = 0;
    var count_delete: usize = 0;
    var count_insert: usize = 0;
    var text_delete = ArrayListUnmanaged(u8){};
    var text_insert = ArrayListUnmanaged(u8){};
    defer {
        text_delete.deinit(allocator);
        text_insert.deinit(allocator);
    }

    while (pointer < diffs.items.len) {
        switch (diffs.items[pointer].operation) {
            .insert => {
                count_insert += 1;
                // text_insert += diffs.items[pointer].text;
                try text_insert.appendSlice(allocator, diffs.items[pointer].text);
            },
            .delete => {
                count_delete += 1;
                // text_delete += diffs.items[pointer].text;
                try text_delete.appendSlice(allocator, diffs.items[pointer].text);
            },
            .equal => {
                // Upon reaching an equality, check for prior redundancies.
                if (count_delete >= 1 and count_insert >= 1) {
                    // Delete the offending records and add the merged ones.
                    // diffs.RemoveRange(pointer - count_delete - count_insert, count_delete + count_insert);
                    try diffs.replaceRange(
                        allocator,
                        pointer - count_delete - count_insert,
                        count_delete + count_insert,
                        &.{},
                    );
                    pointer = pointer - count_delete - count_insert;
                    const sub_diff = try dmp.diffInternal(allocator, text_delete.items, text_insert.items, false, deadline);
                    // diffs.InsertRange(pointer, sub_diff);
                    try diffs.insertSlice(allocator, pointer, sub_diff.items);
                    pointer = pointer + sub_diff.items.len;
                }
                count_insert = 0;
                count_delete = 0;
                text_delete.items.len = 0;
                text_insert.items.len = 0;
            },
        }
        pointer += 1;
    }
    // diffs.RemoveAt(diffs.Count - 1); // Remove the dummy entry at the end.
    diffs.items.len -= 1;

    return diffs;
}

const LinesToCharsResult = struct {
    chars_1: []const u8,
    chars_2: []const u8,
    line_array: ArrayListUnmanaged([]const u8),
};

/// Split two texts into a list of strings.  Reduce the texts to a string of
/// hashes where each Unicode character represents one line.
/// @param text1 First string.
/// @param text2 Second string.
/// @return Three element Object array, containing the encoded text1, the
///     encoded text2 and the List of unique strings.  The zeroth element
///     of the List of unique strings is intentionally blank.
fn diffLinesToChars(
    allocator: std.mem.Allocator,
    text1: []const u8,
    text2: []const u8,
) DiffError!LinesToCharsResult {
    var line_array = ArrayListUnmanaged([]const u8){};
    var line_hash = bun.StringHashMapUnmanaged(usize){};
    // e.g. line_array[4] == "Hello\n"
    // e.g. line_hash.get("Hello\n") == 4

    // "\x00" is a valid character, but various debuggers don't like it.
    // So we'll insert a junk entry to avoid generating a null character.
    try line_array.append(allocator, "");

    // Allocate 2/3rds of the space for text1, the rest for text2.
    const chars1 = try diffLinesToCharsMunge(allocator, text1, &line_array, &line_hash, 170);
    const chars2 = try diffLinesToCharsMunge(allocator, text2, &line_array, &line_hash, 255);
    return .{ .chars_1 = chars1, .chars_2 = chars2, .line_array = line_array };
}

/// Split a text into a list of strings.  Reduce the texts to a string of
/// hashes where each Unicode character represents one line.
/// @param text String to encode.
/// @param lineArray List of unique strings.
/// @param lineHash Map of strings to indices.
/// @param maxLines Maximum length of lineArray.
/// @return Encoded string.
fn diffLinesToCharsMunge(
    allocator: std.mem.Allocator,
    text: []const u8,
    line_array: *ArrayListUnmanaged([]const u8),
    line_hash: *bun.StringHashMapUnmanaged(usize),
    max_lines: usize,
) DiffError![]const u8 {
    var line_start: isize = 0;
    var line_end: isize = -1;
    var line: []const u8 = "";
    var chars = ArrayListUnmanaged(u8){};
    // Walk the text, pulling out a Substring for each line.
    // text.split('\n') would would temporarily double our memory footprint.
    // Modifying text would create many large strings to garbage collect.
    while (line_end < @as(isize, @intCast(text.len)) - 1) {
        line_end = b: {
            break :b @as(isize, @intCast(std.mem.indexOf(u8, text[@as(usize, @intCast(line_start))..], "\n") orelse
                break :b @as(isize, @intCast(text.len - 1)))) + line_start;
        };
        line = text[@as(usize, @intCast(line_start)) .. @as(usize, @intCast(line_start)) + @as(usize, @intCast(line_end + 1 - line_start))];

        if (line_hash.get(line)) |value| {
            try chars.append(allocator, @as(u8, @intCast(value)));
        } else {
            if (line_array.items.len == max_lines) {
                // Bail out at 255 because char 256 == char 0.
                line = text[@as(usize, @intCast(line_start))..];
                line_end = @as(isize, @intCast(text.len));
            }
            try line_array.append(allocator, line);
            try line_hash.put(allocator, line, line_array.items.len - 1);
            try chars.append(allocator, @as(u8, @intCast(line_array.items.len - 1)));
        }
        line_start = line_end + 1;
    }
    return try chars.toOwnedSlice(allocator);
}

/// Rehydrate the text in a diff from a string of line hashes to real lines
/// of text.
/// @param diffs List of Diff objects.
/// @param lineArray List of unique strings.
fn diffCharsToLines(
    allocator: std.mem.Allocator,
    diffs: []Diff,
    line_array: []const []const u8,
) DiffError!void {
    var text = ArrayListUnmanaged(u8){};
    defer text.deinit(allocator);

    for (diffs) |*d| {
        text.items.len = 0;
        var j: usize = 0;
        while (j < d.text.len) : (j += 1) {
            try text.appendSlice(allocator, line_array[d.text[j]]);
        }
        d.text = try allocator.dupe(u8, text.items);
    }
}

/// Reorder and merge like edit sections.  Merge equalities.
/// Any edit section can move as long as it doesn't cross an equality.
/// @param diffs List of Diff objects.
fn diffCleanupMerge(allocator: std.mem.Allocator, diffs: *DiffList) DiffError!void {
    // Add a dummy entry at the end.
    try diffs.append(allocator, Diff.init(.equal, ""));
    var pointer: usize = 0;
    var count_delete: usize = 0;
    var count_insert: usize = 0;

    var text_delete = ArrayListUnmanaged(u8){};
    defer text_delete.deinit(allocator);

    var text_insert = ArrayListUnmanaged(u8){};
    defer text_insert.deinit(allocator);

    var common_length: usize = undefined;
    while (pointer < diffs.items.len) {
        switch (diffs.items[pointer].operation) {
            .insert => {
                count_insert += 1;
                try text_insert.appendSlice(allocator, diffs.items[pointer].text);
                pointer += 1;
            },
            .delete => {
                count_delete += 1;
                try text_delete.appendSlice(allocator, diffs.items[pointer].text);
                pointer += 1;
            },
            .equal => {
                // Upon reaching an equality, check for prior redundancies.
                if (count_delete + count_insert > 1) {
                    if (count_delete != 0 and count_insert != 0) {
                        // Factor out any common prefixies.
                        common_length = diffCommonPrefix(text_insert.items, text_delete.items);
                        if (common_length != 0) {
                            if ((pointer - count_delete - count_insert) > 0 and
                                diffs.items[pointer - count_delete - count_insert - 1].operation == .equal)
                            {
                                // diffs.items[pointer - count_delete - count_insert - 1].text
                                //     += text_insert.Substring(0, common_length);

                                const ii = pointer - count_delete - count_insert - 1;
                                var nt = try allocator.alloc(u8, diffs.items[ii].text.len + common_length);

                                // try diffs.items[pointer - count_delete - count_insert - 1].text.append(allocator, text_insert.items[0..common_length]);
                                bun.copy(u8, nt, diffs.items[ii].text);
                                bun.copy(u8, nt[diffs.items[ii].text.len..], text_insert.items[0..common_length]);

                                // allocator.free(diffs.items[ii].text);
                                diffs.items[ii].text = nt;
                            } else {
                                // diffs.Insert(0, Diff.init(.equal,
                                //    text_insert.Substring(0, common_length)));
                                const text = std.ArrayListUnmanaged(u8){
                                    .items = try allocator.dupe(u8, text_insert.items[0..common_length]),
                                };
                                try diffs.insert(allocator, 0, Diff.init(.equal, try allocator.dupe(u8, text.items)));
                                pointer += 1;
                            }
                            try text_insert.replaceRange(allocator, 0, common_length, &.{});
                            try text_delete.replaceRange(allocator, 0, common_length, &.{});
                        }
                        // Factor out any common suffixies.
                        // @ZigPort this seems very wrong
                        common_length = diffCommonSuffix(text_insert.items, text_delete.items);
                        if (common_length != 0) {
                            diffs.items[pointer].text = try std.mem.concat(allocator, u8, &.{
                                text_insert.items[text_insert.items.len - common_length ..],
                                diffs.items[pointer].text,
                            });
                            text_insert.items.len -= common_length;
                            text_delete.items.len -= common_length;
                        }
                    }
                    // Delete the offending records and add the merged ones.
                    pointer -= count_delete + count_insert;
                    try diffs.replaceRange(allocator, pointer, count_delete + count_insert, &.{});

                    if (text_delete.items.len != 0) {
                        try diffs.replaceRange(allocator, pointer, 0, &.{
                            Diff.init(.delete, try allocator.dupe(u8, text_delete.items)),
                        });
                        pointer += 1;
                    }
                    if (text_insert.items.len != 0) {
                        try diffs.replaceRange(allocator, pointer, 0, &.{
                            Diff.init(.insert, try allocator.dupe(u8, text_insert.items)),
                        });
                        pointer += 1;
                    }
                    pointer += 1;
                } else if (pointer != 0 and diffs.items[pointer - 1].operation == .equal) {
                    // Merge this equality with the previous one.
                    // TODO: Fix using realloc or smth

                    var nt = try allocator.alloc(u8, diffs.items[pointer - 1].text.len + diffs.items[pointer].text.len);

                    // try diffs.items[pointer - count_delete - count_insert - 1].text.append(allocator, text_insert.items[0..common_length]);
                    bun.copy(u8, nt, diffs.items[pointer - 1].text);
                    bun.copy(u8, nt[diffs.items[pointer - 1].text.len..], diffs.items[pointer].text);

                    // allocator.free(diffs.items[pointer - 1].text);
                    diffs.items[pointer - 1].text = nt;
                    // allocator.free(diffs.items[pointer].text);

                    // try diffs.items[pointer - 1].text.append(allocator, diffs.items[pointer].text.items);
                    _ = diffs.orderedRemove(pointer);
                } else {
                    pointer += 1;
                }
                count_insert = 0;
                count_delete = 0;
                text_delete.items.len = 0;
                text_insert.items.len = 0;
            },
        }
    }
    if (diffs.items[diffs.items.len - 1].text.len == 0) {
        diffs.items.len -= 1;
    }

    // Second pass: look for single edits surrounded on both sides by
    // equalities which can be shifted sideways to eliminate an equality.
    // e.g: A<ins>BA</ins>C -> <ins>AB</ins>AC
    var changes = false;
    pointer = 1;
    // Intentionally ignore the first and last element (don't need checking).
    while (pointer < (diffs.items.len - 1)) {
        if (diffs.items[pointer - 1].operation == .equal and
            diffs.items[pointer + 1].operation == .equal)
        {
            // This is a single edit surrounded by equalities.
            if (std.mem.endsWith(u8, diffs.items[pointer].text, diffs.items[pointer - 1].text)) {
                // Shift the edit over the previous equality.
                // diffs.items[pointer].text = diffs.items[pointer - 1].text +
                //     diffs.items[pointer].text[0 .. diffs.items[pointer].text.len -
                //     diffs.items[pointer - 1].text.len];
                // diffs.items[pointer + 1].text = diffs.items[pointer - 1].text + diffs.items[pointer + 1].text;

                const pt = try std.mem.concat(allocator, u8, &.{
                    diffs.items[pointer - 1].text,
                    diffs.items[pointer].text[0 .. diffs.items[pointer].text.len -
                        diffs.items[pointer - 1].text.len],
                });
                const p1t = try std.mem.concat(allocator, u8, &.{
                    diffs.items[pointer - 1].text,
                    diffs.items[pointer + 1].text,
                });

                // allocator.free(diffs.items[pointer].text);
                // allocator.free(diffs.items[pointer + 1].text);

                diffs.items[pointer].text = pt;
                diffs.items[pointer + 1].text = p1t;

                try diffs.replaceRange(allocator, pointer - 1, 1, &.{});
                changes = true;
            } else if (std.mem.startsWith(u8, diffs.items[pointer].text, diffs.items[pointer + 1].text)) {
                // Shift the edit over the next equality.
                // diffs.items[pointer - 1].text += diffs.items[pointer + 1].text;
                // diffs.items[pointer].text =
                //     diffs.items[pointer].text[diffs.items[pointer + 1].text.len..] + diffs.items[pointer + 1].text;

                const pm1t = try std.mem.concat(allocator, u8, &.{
                    diffs.items[pointer - 1].text,
                    diffs.items[pointer + 1].text,
                });
                const pt = try std.mem.concat(allocator, u8, &.{
                    diffs.items[pointer].text[diffs.items[pointer + 1].text.len..],
                    diffs.items[pointer + 1].text,
                });

                // allocator.free(diffs.items[pointer - 1].text);
                // allocator.free(diffs.items[pointer].text);

                diffs.items[pointer - 1].text = pm1t;
                diffs.items[pointer].text = pt;

                try diffs.replaceRange(allocator, pointer + 1, 1, &.{});
                changes = true;
            }
        }
        pointer += 1;
    }
    // If shifts were made, the diff needs reordering and another shift sweep.
    if (changes) {
        try diffCleanupMerge(allocator, diffs);
    }
}

/// Reduce the number of edits by eliminating semantically trivial
/// equalities.
/// @param diffs List of Diff objects.
fn diffCleanupSemantic(allocator: std.mem.Allocator, diffs: *DiffList) DiffError!void {
    var changes = false;
    // Stack of indices where equalities are found.
    var equalities = ArrayListUnmanaged(isize){};
    // Always equal to equalities[equalitiesLength-1][1]
    var last_equality: ?[]const u8 = null;
    var pointer: isize = 0; // Index of current position.
    // Number of characters that changed prior to the equality.
    var length_insertions1: usize = 0;
    var length_deletions1: usize = 0;
    // Number of characters that changed after the equality.
    var length_insertions2: usize = 0;
    var length_deletions2: usize = 0;
    while (pointer < diffs.items.len) {
        if (diffs.items[@as(usize, @intCast(pointer))].operation == .equal) { // Equality found.
            try equalities.append(allocator, pointer);
            length_insertions1 = length_insertions2;
            length_deletions1 = length_deletions2;
            length_insertions2 = 0;
            length_deletions2 = 0;
            last_equality = diffs.items[@as(usize, @intCast(pointer))].text;
        } else { // an insertion or deletion
            if (diffs.items[@as(usize, @intCast(pointer))].operation == .insert) {
                length_insertions2 += diffs.items[@as(usize, @intCast(pointer))].text.len;
            } else {
                length_deletions2 += diffs.items[@as(usize, @intCast(pointer))].text.len;
            }
            // Eliminate an equality that is smaller or equal to the edits on both
            // sides of it.
            if (last_equality != null and
                (last_equality.?.len <= @max(length_insertions1, length_deletions1)) and
                (last_equality.?.len <= @max(length_insertions2, length_deletions2)))
            {
                // Duplicate record.
                try diffs.insert(
                    allocator,
                    @as(usize, @intCast(equalities.items[equalities.items.len - 1])),
                    Diff.init(.delete, try allocator.dupe(u8, last_equality.?)),
                );
                // Change second copy to insert.
                diffs.items[@as(usize, @intCast(equalities.items[equalities.items.len - 1] + 1))].operation = .insert;
                // Throw away the equality we just deleted.
                _ = equalities.pop();
                if (equalities.items.len > 0) {
                    _ = equalities.pop();
                }
                pointer = if (equalities.items.len > 0) equalities.items[equalities.items.len - 1] else -1;
                length_insertions1 = 0; // Reset the counters.
                length_deletions1 = 0;
                length_insertions2 = 0;
                length_deletions2 = 0;
                last_equality = null;
                changes = true;
            }
        }
        pointer += 1;
    }

    // Normalize the diff.
    if (changes) {
        try diffCleanupMerge(allocator, diffs);
    }
    try diffCleanupSemanticLossless(allocator, diffs);

    // Find any overlaps between deletions and insertions.
    // e.g: <del>abcxxx</del><ins>xxxdef</ins>
    //   -> <del>abc</del>xxx<ins>def</ins>
    // e.g: <del>xxxabc</del><ins>defxxx</ins>
    //   -> <ins>def</ins>xxx<del>abc</del>
    // Only extract an overlap if it is as big as the edit ahead or behind it.
    pointer = 1;
    while (pointer < diffs.items.len) {
        if (diffs.items[@as(usize, @intCast(pointer - 1))].operation == .delete and
            diffs.items[@as(usize, @intCast(pointer))].operation == .insert)
        {
            const deletion = diffs.items[@as(usize, @intCast(pointer - 1))].text;
            const insertion = diffs.items[@as(usize, @intCast(pointer))].text;
            const overlap_length1: usize = diffCommonOverlap(deletion, insertion);
            const overlap_length2: usize = diffCommonOverlap(insertion, deletion);
            if (overlap_length1 >= overlap_length2) {
                if (@as(f32, @floatFromInt(overlap_length1)) >= @as(f32, @floatFromInt(deletion.len)) / 2.0 or
                    @as(f32, @floatFromInt(overlap_length1)) >= @as(f32, @floatFromInt(insertion.len)) / 2.0)
                {
                    // Overlap found.
                    // Insert an equality and trim the surrounding edits.
                    try diffs.insert(
                        allocator,
                        @as(usize, @intCast(pointer)),
                        Diff.init(.equal, try allocator.dupe(u8, insertion[0..overlap_length1])),
                    );
                    diffs.items[@as(usize, @intCast(pointer - 1))].text =
                        try allocator.dupe(u8, deletion[0 .. deletion.len - overlap_length1]);
                    diffs.items[@as(usize, @intCast(pointer + 1))].text =
                        try allocator.dupe(u8, insertion[overlap_length1..]);
                    pointer += 1;
                }
            } else {
                if (@as(f32, @floatFromInt(overlap_length2)) >= @as(f32, @floatFromInt(deletion.len)) / 2.0 or
                    @as(f32, @floatFromInt(overlap_length2)) >= @as(f32, @floatFromInt(insertion.len)) / 2.0)
                {
                    // Reverse overlap found.
                    // Insert an equality and swap and trim the surrounding edits.
                    try diffs.insert(
                        allocator,
                        @as(usize, @intCast(pointer)),
                        Diff.init(.equal, try allocator.dupe(u8, deletion[0..overlap_length2])),
                    );
                    diffs.items[@as(usize, @intCast(pointer - 1))].operation = .insert;
                    diffs.items[@as(usize, @intCast(pointer - 1))].text =
                        try allocator.dupe(u8, insertion[0 .. insertion.len - overlap_length2]);
                    diffs.items[@as(usize, @intCast(pointer + 1))].operation = .delete;
                    diffs.items[@as(usize, @intCast(pointer + 1))].text =
                        try allocator.dupe(u8, deletion[overlap_length2..]);
                    pointer += 1;
                }
            }
            pointer += 1;
        }
        pointer += 1;
    }
}

/// Look for single edits surrounded on both sides by equalities
/// which can be shifted sideways to align the edit to a word boundary.
/// e.g: The c<ins>at c</ins>ame. -> The <ins>cat </ins>came.
pub fn diffCleanupSemanticLossless(
    allocator: std.mem.Allocator,
    diffs: *DiffList,
) DiffError!void {
    var pointer: usize = 1;
    // Intentionally ignore the first and last element (don't need checking).
    while (pointer < @as(isize, @intCast(diffs.items.len)) - 1) {
        if (diffs.items[pointer - 1].operation == .equal and
            diffs.items[pointer + 1].operation == .equal)
        {
            // This is a single edit surrounded by equalities.
            var equality_1 = std.ArrayListUnmanaged(u8){};
            defer equality_1.deinit(allocator);
            try equality_1.appendSlice(allocator, diffs.items[pointer - 1].text);

            var edit = std.ArrayListUnmanaged(u8){};
            defer edit.deinit(allocator);
            try edit.appendSlice(allocator, diffs.items[pointer].text);

            var equality_2 = std.ArrayListUnmanaged(u8){};
            defer equality_2.deinit(allocator);
            try equality_2.appendSlice(allocator, diffs.items[pointer + 1].text);

            // First, shift the edit as far left as possible.
            const common_offset = diffCommonSuffix(equality_1.items, edit.items);
            if (common_offset > 0) {
                // TODO: Use buffer
                const common_string = try allocator.dupe(u8, edit.items[edit.items.len - common_offset ..]);
                defer allocator.free(common_string);

                equality_1.items.len = equality_1.items.len - common_offset;

                // edit.items.len = edit.items.len - common_offset;
                const not_common = try allocator.dupe(u8, edit.items[0 .. edit.items.len - common_offset]);
                defer allocator.free(not_common);

                edit.items.len = 0;
                try edit.appendSlice(allocator, common_string);
                try edit.appendSlice(allocator, not_common);

                try equality_2.insertSlice(allocator, 0, common_string);
            }

            // Second, step character by character right,
            // looking for the best fit.
            var best_equality_1 = ArrayListUnmanaged(u8){};
            defer best_equality_1.deinit(allocator);
            try best_equality_1.appendSlice(allocator, equality_1.items);

            var best_edit = ArrayListUnmanaged(u8){};
            defer best_edit.deinit(allocator);
            try best_edit.appendSlice(allocator, edit.items);

            var best_equality_2 = ArrayListUnmanaged(u8){};
            defer best_equality_2.deinit(allocator);
            try best_equality_2.appendSlice(allocator, equality_2.items);

            var best_score = diffCleanupSemanticScore(equality_1.items, edit.items) +
                diffCleanupSemanticScore(edit.items, equality_2.items);

            while (edit.items.len != 0 and equality_2.items.len != 0 and edit.items[0] == equality_2.items[0]) {
                try equality_1.append(allocator, edit.items[0]);

                _ = edit.orderedRemove(0);
                try edit.append(allocator, equality_2.items[0]);

                _ = equality_2.orderedRemove(0);

                const score = diffCleanupSemanticScore(equality_1.items, edit.items) +
                    diffCleanupSemanticScore(edit.items, equality_2.items);
                // The >= encourages trailing rather than leading whitespace on
                // edits.
                if (score >= best_score) {
                    best_score = score;

                    best_equality_1.items.len = 0;
                    try best_equality_1.appendSlice(allocator, equality_1.items);

                    best_edit.items.len = 0;
                    try best_edit.appendSlice(allocator, edit.items);

                    best_equality_2.items.len = 0;
                    try best_equality_2.appendSlice(allocator, equality_2.items);
                }
            }

            if (!std.mem.eql(u8, diffs.items[pointer - 1].text, best_equality_1.items)) {
                // We have an improvement, save it back to the diff.
                if (best_equality_1.items.len != 0) {
                    diffs.items[pointer - 1].text = try allocator.dupe(u8, best_equality_1.items);
                } else {
                    _ = diffs.orderedRemove(pointer - 1);
                    pointer -= 1;
                }
                diffs.items[pointer].text = try allocator.dupe(u8, best_edit.items);
                if (best_equality_2.items.len != 0) {
                    diffs.items[pointer + 1].text = try allocator.dupe(u8, best_equality_2.items);
                } else {
                    _ = diffs.orderedRemove(pointer + 1);
                    pointer -= 1;
                }
            }
        }
        pointer += 1;
    }
}

/// Given two strings, compute a score representing whether the internal
/// boundary falls on logical boundaries.
/// Scores range from 6 (best) to 0 (worst).
/// @param one First string.
/// @param two Second string.
/// @return The score.
fn diffCleanupSemanticScore(one: []const u8, two: []const u8) usize {
    if (one.len == 0 or two.len == 0) {
        // Edges are the best.
        return 6;
    }

    // Each port of this function behaves slightly differently due to
    // subtle differences in each language's definition of things like
    // 'whitespace'.  Since this function's purpose is largely cosmetic,
    // the choice has been made to use each language's native features
    // rather than force total conformity.
    const char1 = one[one.len - 1];
    const char2 = two[0];
    const nonAlphaNumeric1 = !std.ascii.isAlphanumeric(char1);
    const nonAlphaNumeric2 = !std.ascii.isAlphanumeric(char2);
    const whitespace1 = nonAlphaNumeric1 and std.ascii.isWhitespace(char1);
    const whitespace2 = nonAlphaNumeric2 and std.ascii.isWhitespace(char2);
    const lineBreak1 = whitespace1 and std.ascii.isControl(char1);
    const lineBreak2 = whitespace2 and std.ascii.isControl(char2);
    const blankLine1 = lineBreak1 and
        // BLANKLINEEND.IsMatch(one);
        (std.mem.endsWith(u8, one, "\n\n") or std.mem.endsWith(u8, one, "\n\r\n"));
    const blankLine2 = lineBreak2 and
        // BLANKLINESTART.IsMatch(two);
        (std.mem.startsWith(u8, two, "\n\n") or
        std.mem.startsWith(u8, two, "\r\n\n") or
        std.mem.startsWith(u8, two, "\n\r\n") or
        std.mem.startsWith(u8, two, "\r\n\r\n"));

    if (blankLine1 or blankLine2) {
        // Five points for blank lines.
        return 5;
    } else if (lineBreak1 or lineBreak2) {
        // Four points for line breaks.
        return 4;
    } else if (nonAlphaNumeric1 and !whitespace1 and whitespace2) {
        // Three points for end of sentences.
        return 3;
    } else if (whitespace1 or whitespace2) {
        // Two points for whitespace.
        return 2;
    } else if (nonAlphaNumeric1 or nonAlphaNumeric2) {
        // One point for non-alphanumeric.
        return 1;
    }
    return 0;
}

// Define some regex patterns for matching boundaries.
// private Regex BLANKLINEEND = new Regex("\\n\\r?\\n\\Z");
// \n\n
// \n\r\n
// private Regex BLANKLINESTART = new Regex("\\A\\r?\\n\\r?\\n");
// \n\n
// \r\n\n
// \n\r\n
// \r\n\r\n

/// Reduce the number of edits by eliminating operationally trivial
/// equalities.
pub fn diffCleanupEfficiency(
    dmp: DiffMatchPatch,
    allocator: std.mem.Allocator,
    diffs: *DiffList,
) DiffError!void {
    var changes = false;
    // Stack of indices where equalities are found.
    var equalities = DiffList{};
    // Always equal to equalities[equalitiesLength-1][1]
    var last_equality = "";
    var pointer: isize = 0; // Index of current position.
    // Is there an insertion operation before the last equality.
    var pre_ins = false;
    // Is there a deletion operation before the last equality.
    var pre_del = false;
    // Is there an insertion operation after the last equality.
    var post_ins = false;
    // Is there a deletion operation after the last equality.
    var post_del = false;
    while (pointer < diffs.Count) {
        if (diffs.items[pointer].operation == .equal) { // Equality found.
            if (diffs.items[pointer].text.len < dmp.diff_edit_cost and (post_ins or post_del)) {
                // Candidate found.
                equalities.Push(pointer);
                pre_ins = post_ins;
                pre_del = post_del;
                last_equality = diffs.items[pointer].text;
            } else {
                // Not a candidate, and can never become one.
                equalities.items.len = 0;
                last_equality = "";
            }
            post_ins = false;
            post_del = false;
        } else { // An insertion or deletion.
            if (diffs.items[pointer].operation == .delete) {
                post_del = true;
            } else {
                post_ins = true;
            }
            // Five types to be split:
            // <ins>A</ins><del>B</del>XY<ins>C</ins><del>D</del>
            // <ins>A</ins>X<ins>C</ins><del>D</del>
            // <ins>A</ins><del>B</del>X<ins>C</ins>
            // <ins>A</del>X<ins>C</ins><del>D</del>
            // <ins>A</ins><del>B</del>X<del>C</del>
            if ((last_equality.Length != 0) and
                ((pre_ins and pre_del and post_ins and post_del) or
                ((last_equality.Length < dmp.diff_edit_cost / 2) and
                ((if (pre_ins) 1 else 0) + (if (pre_del) 1 else 0) + (if (post_ins) 1 else 0) + (if (post_del) 1 else 0)) == 3)))
            {
                // Duplicate record.
                try diffs.insert(
                    allocator,
                    equalities.items[equalities.items.len - 1],
                    Diff.init(.delete, try allocator.dupe(u8, last_equality)),
                );
                // Change second copy to insert.
                diffs.items[equalities.items[equalities.items.len - 1] + 1].operation = .insert;
                _ = equalities.pop(); // Throw away the equality we just deleted.
                last_equality = "";
                if (pre_ins and pre_del) {
                    // No changes made which could affect previous entry, keep going.
                    post_ins = true;
                    post_del = true;
                    equalities.items.len = 0;
                } else {
                    if (equalities.items.len > 0) {
                        _ = equalities.pop();
                    }

                    pointer = if (equalities.items.len > 0) equalities.items[equalities.items.len - 1] else -1;
                    post_ins = false;
                    post_del = false;
                }
                changes = true;
            }
        }
        pointer += 1;
    }

    if (changes) {
        try diffCleanupMerge(allocator, diffs);
    }
}

/// Determine if the suffix of one string is the prefix of another.
/// @param text1 First string.
/// @param text2 Second string.
/// @return The number of characters common to the end of the first
///     string and the start of the second string.
fn diffCommonOverlap(text1_in: []const u8, text2_in: []const u8) usize {
    var text1 = text1_in;
    var text2 = text2_in;

    // Cache the text lengths to prevent multiple calls.
    const text1_length = text1.len;
    const text2_length = text2.len;
    // Eliminate the null case.
    if (text1_length == 0 or text2_length == 0) {
        return 0;
    }
    // Truncate the longer string.
    if (text1_length > text2_length) {
        text1 = text1[text1_length - text2_length ..];
    } else if (text1_length < text2_length) {
        text2 = text2[0..text1_length];
    }
    const text_length = @min(text1_length, text2_length);
    // Quick check for the worst case.
    if (std.mem.eql(u8, text1, text2)) {
        return text_length;
    }

    // Start by looking for a single character match
    // and increase length until no match is found.
    // Performance analysis: https://neil.fraser.name/news/2010/11/04/
    var best: usize = 0;
    var length: usize = 1;
    while (true) {
        const pattern = text1[text_length - length ..];
        const found = std.mem.indexOf(u8, text2, pattern) orelse
            return best;

        length += found;

        if (found == 0 or std.mem.eql(u8, text1[text_length - length ..], text2[0..length])) {
            best = length;
            length += 1;
        }
    }
}

// pub fn main() void {
//     var arena = bun.ArenaAllocator.init(std.heap.page_allocator);
//     defer arena.deinit();

//     var bruh = default.diff(arena.allocator(), "Hello World.", "Goodbye World.", true);
//     std.log.err("{any}", .{bruh});
// }

// test {
//     var arena = bun.ArenaAllocator.init(testing.allocator);
//     defer arena.deinit();

//     var bruh = try default.diff(arena.allocator(), "Hello World.", "Goodbye World.", true);
//     try diffCleanupSemantic(arena.allocator(), &bruh);
//     for (bruh.items) |b| {
//         std.log.err("{any}", .{b});
//     }

//     // for (bruh.items) |b| {
//     //     std.log.err("{s} {s}", .{ switch (b.operation) {
//     //         .equal => "",
//     //         .insert => "+",
//     //         .delete => "-",
//     //     }, b.text });
//     // }
// }

// TODO: Allocate all text in diffs to
// not cause segfault while freeing; not a problem
// at the moment because we don't free anything :P

test diffCommonPrefix {
    // Detect any common suffix.
    try testing.expectEqual(@as(usize, 0), diffCommonPrefix("abc", "xyz")); // Null case
    try testing.expectEqual(@as(usize, 4), diffCommonPrefix("1234abcdef", "1234xyz")); // Non-null case
    try testing.expectEqual(@as(usize, 4), diffCommonPrefix("1234", "1234xyz")); // Whole case
}

test diffCommonSuffix {
    // Detect any common suffix.
    try testing.expectEqual(@as(usize, 0), diffCommonSuffix("abc", "xyz")); // Null case
    try testing.expectEqual(@as(usize, 4), diffCommonSuffix("abcdef1234", "xyz1234")); // Non-null case
    try testing.expectEqual(@as(usize, 4), diffCommonSuffix("1234", "xyz1234")); // Whole case
}

test diffCommonOverlap {
    // Detect any suffix/prefix overlap.
    try testing.expectEqual(@as(usize, 0), diffCommonOverlap("", "abcd")); // Null case
    try testing.expectEqual(@as(usize, 3), diffCommonOverlap("abc", "abcd")); // Whole case
    try testing.expectEqual(@as(usize, 0), diffCommonOverlap("123456", "abcd")); // No overlap
    try testing.expectEqual(@as(usize, 3), diffCommonOverlap("123456xxx", "xxxabcd")); // Overlap

    // Some overly clever languages (C#) may treat ligatures as equal to their
    // component letters.  E.g. U+FB01 == 'fi'
    try testing.expectEqual(@as(usize, 0), diffCommonOverlap("fi", "\u{fb01}")); // Unicode
}

test diffHalfMatch {
    var arena = bun.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();

    var one_timeout = DiffMatchPatch{};
    one_timeout.diff_timeout = 1;

    try testing.expectEqual(
        @as(?HalfMatchResult, null),
        try one_timeout.diffHalfMatch(arena.allocator(), "1234567890", "abcdef"),
    ); // No match #1
    try testing.expectEqual(
        @as(?HalfMatchResult, null),
        try one_timeout.diffHalfMatch(arena.allocator(), "12345", "23"),
    ); // No match #2

    // Single matches
    try testing.expectEqualDeep(@as(?HalfMatchResult, HalfMatchResult{
        .prefix_before = "12",
        .suffix_before = "90",
        .prefix_after = "a",
        .suffix_after = "z",
        .common_middle = "345678",
    }), try one_timeout.diffHalfMatch(arena.allocator(), "1234567890", "a345678z")); // Single Match #1

    try testing.expectEqualDeep(@as(?HalfMatchResult, HalfMatchResult{
        .prefix_before = "a",
        .suffix_before = "z",
        .prefix_after = "12",
        .suffix_after = "90",
        .common_middle = "345678",
    }), try one_timeout.diffHalfMatch(arena.allocator(), "a345678z", "1234567890")); // Single Match #2

    try testing.expectEqualDeep(@as(?HalfMatchResult, HalfMatchResult{
        .prefix_before = "abc",
        .suffix_before = "z",
        .prefix_after = "1234",
        .suffix_after = "0",
        .common_middle = "56789",
    }), try one_timeout.diffHalfMatch(arena.allocator(), "abc56789z", "1234567890")); // Single Match #3

    try testing.expectEqualDeep(@as(?HalfMatchResult, HalfMatchResult{
        .prefix_before = "a",
        .suffix_before = "xyz",
        .prefix_after = "1",
        .suffix_after = "7890",
        .common_middle = "23456",
    }), try one_timeout.diffHalfMatch(arena.allocator(), "a23456xyz", "1234567890")); // Single Match #4

    // Multiple matches
    try testing.expectEqualDeep(
        @as(?HalfMatchResult, HalfMatchResult{
            .prefix_before = "12123",
            .suffix_before = "123121",
            .prefix_after = "a",
            .suffix_after = "z",
            .common_middle = "1234123451234",
        }),
        try one_timeout.diffHalfMatch(arena.allocator(), "121231234123451234123121", "a1234123451234z"),
    ); // Multiple Matches #1

    try testing.expectEqualDeep(
        @as(?HalfMatchResult, HalfMatchResult{
            .prefix_before = "",
            .suffix_before = "-=-=-=-=-=",
            .prefix_after = "x",
            .suffix_after = "",
            .common_middle = "x-=-=-=-=-=-=-=",
        }),
        try one_timeout.diffHalfMatch(arena.allocator(), "x-=-=-=-=-=-=-=-=-=-=-=-=", "xx-=-=-=-=-=-=-="),
    ); // Multiple Matches #2

    try testing.expectEqualDeep(@as(?HalfMatchResult, HalfMatchResult{
        .prefix_before = "-=-=-=-=-=",
        .suffix_before = "",
        .prefix_after = "",
        .suffix_after = "y",
        .common_middle = "-=-=-=-=-=-=-=y",
    }), try one_timeout.diffHalfMatch(arena.allocator(), "-=-=-=-=-=-=-=-=-=-=-=-=y", "-=-=-=-=-=-=-=yy")); // Multiple Matches #3

    // Other cases
    // Optimal diff would be -q+x=H-i+e=lloHe+Hu=llo-Hew+y not -qHillo+x=HelloHe-w+Hulloy
    try testing.expectEqualDeep(@as(?HalfMatchResult, HalfMatchResult{
        .prefix_before = "qHillo",
        .suffix_before = "w",
        .prefix_after = "x",
        .suffix_after = "Hulloy",
        .common_middle = "HelloHe",
    }), try one_timeout.diffHalfMatch(arena.allocator(), "qHilloHelloHew", "xHelloHeHulloy")); // Non-optimal halfmatch

    one_timeout.diff_timeout = 0;
    try testing.expectEqualDeep(@as(?HalfMatchResult, null), try one_timeout.diffHalfMatch(arena.allocator(), "qHilloHelloHew", "xHelloHeHulloy")); // Non-optimal halfmatch
}

test diffLinesToChars {
    var arena = bun.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();

    // Convert lines down to characters.
    var tmp_array_list = std.ArrayList([]const u8).init(arena.allocator());
    try tmp_array_list.append("");
    try tmp_array_list.append("alpha\n");
    try tmp_array_list.append("beta\n");

    var result = try diffLinesToChars(arena.allocator(), "alpha\nbeta\nalpha\n", "beta\nalpha\nbeta\n");
    try testing.expectEqualStrings("\u{0001}\u{0002}\u{0001}", result.chars_1); // Shared lines #1
    try testing.expectEqualStrings("\u{0002}\u{0001}\u{0002}", result.chars_2); // Shared lines #2
    try testing.expectEqualDeep(tmp_array_list.items, result.line_array.items); // Shared lines #3

    tmp_array_list.items.len = 0;
    try tmp_array_list.append("");
    try tmp_array_list.append("alpha\r\n");
    try tmp_array_list.append("beta\r\n");
    try tmp_array_list.append("\r\n");

    result = try diffLinesToChars(arena.allocator(), "", "alpha\r\nbeta\r\n\r\n\r\n");
    try testing.expectEqualStrings("", result.chars_1); // Empty string and blank lines #1
    try testing.expectEqualStrings("\u{0001}\u{0002}\u{0003}\u{0003}", result.chars_2); // Empty string and blank lines #2
    try testing.expectEqualDeep(tmp_array_list.items, result.line_array.items); // Empty string and blank lines #3

    tmp_array_list.items.len = 0;
    try tmp_array_list.append("");
    try tmp_array_list.append("a");
    try tmp_array_list.append("b");

    result = try diffLinesToChars(arena.allocator(), "a", "b");
    try testing.expectEqualStrings("\u{0001}", result.chars_1); // No linebreaks #1.
    try testing.expectEqualStrings("\u{0002}", result.chars_2); // No linebreaks #2.
    try testing.expectEqualDeep(tmp_array_list.items, result.line_array.items); // No linebreaks #3.

    // TODO: More than 256 to reveal any 8-bit limitations but this requires
    // some unicode logic that I don't want to deal with

    // TODO: Fix this

    // const n: u8 = 255;
    // tmp_array_list.items.len = 0;

    // var line_list = std.ArrayList(u8).init(arena.allocator());
    // var char_list = std.ArrayList(u8).init(arena.allocator());

    // var i: u8 = 0;
    // while (i < n) : (i += 1) {
    //     try tmp_array_list.append(&.{ i, '\n' });
    //     try line_list.appendSlice(&.{ i, '\n' });
    //     try char_list.append(i);
    // }
    // try testing.expectEqual(@as(usize, n), tmp_array_list.items.len); // Test initialization fail #1
    // try testing.expectEqual(@as(usize, n), char_list.items.len); // Test initialization fail #2
    // try tmp_array_list.insert(0, "");
    // result = try diffLinesToChars(arena.allocator(), line_list.items, "");
    // try testing.expectEqualStrings(char_list.items, result.chars_1);
    // try testing.expectEqualStrings("", result.chars_2);
    // try testing.expectEqualDeep(tmp_array_list.items, result.line_array.items);
}

test diffCharsToLines {
    var arena = bun.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();

    try testing.expect((Diff.init(.equal, "a")).eql(Diff.init(.equal, "a")));
    try testing.expect(!(Diff.init(.insert, "a")).eql(Diff.init(.equal, "a")));
    try testing.expect(!(Diff.init(.equal, "a")).eql(Diff.init(.equal, "b")));
    try testing.expect(!(Diff.init(.equal, "a")).eql(Diff.init(.delete, "b")));

    // Convert chars up to lines.
    var diffs = std.ArrayList(Diff).init(arena.allocator());
    try diffs.appendSlice(&.{
        Diff{ .operation = .equal, .text = try arena.allocator().dupe(u8, "\u{0001}\u{0002}\u{0001}") },
        Diff{ .operation = .insert, .text = try arena.allocator().dupe(u8, "\u{0002}\u{0001}\u{0002}") },
    });
    var tmp_vector = std.ArrayList([]const u8).init(arena.allocator());
    try tmp_vector.append("");
    try tmp_vector.append("alpha\n");
    try tmp_vector.append("beta\n");
    try diffCharsToLines(arena.allocator(), diffs.items, tmp_vector.items);

    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        Diff.init(.equal, "alpha\nbeta\nalpha\n"),
        Diff.init(.insert, "beta\nalpha\nbeta\n"),
    }), diffs.items);

    // TODO: Implement exhaustive tests
}

test diffCleanupMerge {
    var arena = bun.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();

    // Cleanup a messy diff.
    var diffs = DiffList{};
    try testing.expectEqualDeep(@as([]const Diff, &[0]Diff{}), diffs.items); // Null case

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        .{ .operation = .equal, .text = "a" },
        .{ .operation = .delete, .text = "b" },
        .{ .operation = .insert, .text = "c" },
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        .{ .operation = .equal, .text = "a" },
        .{ .operation = .delete, .text = "b" },
        .{ .operation = .insert, .text = "c" },
    }), diffs.items); // No change case

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        .{ .operation = .equal, .text = "a" },
        .{ .operation = .equal, .text = "b" },
        .{ .operation = .equal, .text = "c" },
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        .{ .operation = .equal, .text = "abc" },
    }), diffs.items); // Merge equalities

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        .{ .operation = .delete, .text = "a" },
        .{ .operation = .delete, .text = "b" },
        .{ .operation = .delete, .text = "c" },
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        .{ .operation = .delete, .text = "abc" },
    }), diffs.items); // Merge deletions

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        .{ .operation = .insert, .text = "a" },
        .{ .operation = .insert, .text = "b" },
        .{ .operation = .insert, .text = "c" },
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        .{ .operation = .insert, .text = "abc" },
    }), diffs.items); // Merge insertions

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        .{ .operation = .delete, .text = "a" },
        .{ .operation = .insert, .text = "b" },
        .{ .operation = .delete, .text = "c" },
        .{ .operation = .insert, .text = "d" },
        .{ .operation = .equal, .text = "e" },
        .{ .operation = .equal, .text = "f" },
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        .{ .operation = .delete, .text = "ac" },
        .{ .operation = .insert, .text = "bd" },
        .{ .operation = .equal, .text = "ef" },
    }), diffs.items); // Merge interweave

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        .{ .operation = .delete, .text = "a" },
        .{ .operation = .insert, .text = "abc" },
        .{ .operation = .delete, .text = "dc" },
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        .{ .operation = .equal, .text = "a" },
        .{ .operation = .delete, .text = "d" },
        .{ .operation = .insert, .text = "b" },
        .{ .operation = .equal, .text = "c" },
    }), diffs.items); // Prefix and suffix detection

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        .{ .operation = .equal, .text = "x" },
        .{ .operation = .delete, .text = "a" },
        .{ .operation = .insert, .text = "abc" },
        .{ .operation = .delete, .text = "dc" },
        .{ .operation = .equal, .text = "y" },
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        .{ .operation = .equal, .text = "xa" },
        .{ .operation = .delete, .text = "d" },
        .{ .operation = .insert, .text = "b" },
        .{ .operation = .equal, .text = "cy" },
    }), diffs.items); // Prefix and suffix detection with equalities

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        .{ .operation = .equal, .text = "a" },
        .{ .operation = .insert, .text = "ba" },
        .{ .operation = .equal, .text = "c" },
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        .{ .operation = .insert, .text = "ab" },
        .{ .operation = .equal, .text = "ac" },
    }), diffs.items); // Slide edit left

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        .{ .operation = .equal, .text = "c" },
        .{ .operation = .insert, .text = "ab" },
        .{ .operation = .equal, .text = "a" },
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        .{ .operation = .equal, .text = "ca" },
        .{ .operation = .insert, .text = "ba" },
    }), diffs.items); // Slide edit right

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        Diff.init(.equal, "a"),
        Diff.init(.delete, "b"),
        Diff.init(.equal, "c"),
        Diff.init(.delete, "ac"),
        Diff.init(.equal, "x"),
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        Diff.init(.delete, "abc"),
        Diff.init(.equal, "acx"),
    }), diffs.items); // Slide edit left recursive

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        Diff.init(.equal, "x"),
        Diff.init(.delete, "ca"),
        Diff.init(.equal, "c"),
        Diff.init(.delete, "b"),
        Diff.init(.equal, "a"),
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        Diff.init(.equal, "xca"),
        Diff.init(.delete, "cba"),
    }), diffs.items); // Slide edit right recursive

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        Diff.init(.delete, "b"),
        Diff.init(.insert, "ab"),
        Diff.init(.equal, "c"),
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        Diff.init(.insert, "a"),
        Diff.init(.equal, "bc"),
    }), diffs.items); // Empty merge

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &[_]Diff{
        Diff.init(.equal, ""),
        Diff.init(.insert, "a"),
        Diff.init(.equal, "b"),
    });
    try diffCleanupMerge(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{
        Diff.init(.insert, "a"),
        Diff.init(.equal, "b"),
    }), diffs.items); // Empty equality
}

test diffCleanupSemanticLossless {
    var arena = bun.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();

    var diffs = DiffList{};
    try diffCleanupSemanticLossless(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[0]Diff{}), diffs.items); // Null case

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.equal, "AAA\r\n\r\nBBB"),
        Diff.init(.insert, "\r\nDDD\r\n\r\nBBB"),
        Diff.init(.equal, "\r\nEEE"),
    });
    try diffCleanupSemanticLossless(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &.{
        Diff.init(.equal, "AAA\r\n\r\n"),
        Diff.init(.insert, "BBB\r\nDDD\r\n\r\n"),
        Diff.init(.equal, "BBB\r\nEEE"),
    }), diffs.items);

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.equal, "AAA\r\nBBB"),
        Diff.init(.insert, " DDD\r\nBBB"),
        Diff.init(.equal, " EEE"),
    });
    try diffCleanupSemanticLossless(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &.{
        Diff.init(.equal, "AAA\r\n"),
        Diff.init(.insert, "BBB DDD\r\n"),
        Diff.init(.equal, "BBB EEE"),
    }), diffs.items);

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.equal, "The c"),
        Diff.init(.insert, "ow and the c"),
        Diff.init(.equal, "at."),
    });
    try diffCleanupSemanticLossless(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &.{
        Diff.init(.equal, "The "),
        Diff.init(.insert, "cow and the "),
        Diff.init(.equal, "cat."),
    }), diffs.items);

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.equal, "The-c"),
        Diff.init(.insert, "ow-and-the-c"),
        Diff.init(.equal, "at."),
    });
    try diffCleanupSemanticLossless(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &.{
        Diff.init(.equal, "The-"),
        Diff.init(.insert, "cow-and-the-"),
        Diff.init(.equal, "cat."),
    }), diffs.items);

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.equal, "a"),
        Diff.init(.delete, "a"),
        Diff.init(.equal, "ax"),
    });
    try diffCleanupSemanticLossless(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &.{
        Diff.init(.delete, "a"),
        Diff.init(.equal, "aax"),
    }), diffs.items);

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.equal, "xa"),
        Diff.init(.delete, "a"),
        Diff.init(.equal, "a"),
    });
    try diffCleanupSemanticLossless(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &.{
        Diff.init(.equal, "xaa"),
        Diff.init(.delete, "a"),
    }), diffs.items);

    diffs.items.len = 0;

    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.equal, "The xxx. The "),
        Diff.init(.insert, "zzz. The "),
        Diff.init(.equal, "yyy."),
    });
    try diffCleanupSemanticLossless(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &.{
        Diff.init(.equal, "The xxx."),
        Diff.init(.insert, " The zzz."),
        Diff.init(.equal, " The yyy."),
    }), diffs.items);
}

fn rebuildtexts(allocator: std.mem.Allocator, diffs: DiffList) ![2][]const u8 {
    var text = [2]std.ArrayList(u8){
        std.ArrayList(u8).init(allocator),
        std.ArrayList(u8).init(allocator),
    };

    for (diffs.items) |myDiff| {
        if (myDiff.operation != .insert) {
            try text[0].appendSlice(myDiff.text);
        }
        if (myDiff.operation != .delete) {
            try text[1].appendSlice(myDiff.text);
        }
    }
    return .{
        try text[0].toOwnedSlice(),
        try text[1].toOwnedSlice(),
    };
}

test diffBisect {
    var arena = bun.ArenaAllocator.init(talloc);
    defer arena.deinit();

    // Normal.
    const a = "cat";
    const b = "map";
    // Since the resulting diff hasn't been normalized, it would be ok if
    // the insertion and deletion pairs are swapped.
    // If the order changes, tweak this test as required.
    var diffs = DiffList{};
    defer diffs.deinit(arena.allocator());
    var this = default;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.delete, "c"),
        Diff.init(.insert, "m"),
        Diff.init(.equal, "a"),
        Diff.init(.delete, "t"),
        Diff.init(.insert, "p"),
    });
    // Travis TODO not sure if maxInt(u64) is correct for  DateTime.MaxValue
    try testing.expectEqualDeep(diffs, try this.diffBisect(arena.allocator(), a, b, std.math.maxInt(u64))); // Normal.

    // Timeout.
    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.delete, "cat"),
        Diff.init(.insert, "map"),
    });
    // Travis TODO not sure if 0 is correct for  DateTime.MinValue
    try testing.expectEqualDeep(diffs, try this.diffBisect(arena.allocator(), a, b, 0)); // Timeout.
}

const talloc = testing.allocator;
test diff {
    var arena = bun.ArenaAllocator.init(talloc);
    defer arena.deinit();

    // Perform a trivial diff.
    var diffs = DiffList{};
    defer diffs.deinit(arena.allocator());
    var this = DiffMatchPatch{};
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "", "", false)).items); // diff: Null case.

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{Diff.init(.equal, "abc")});
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "abc", "abc", false)).items); // diff: Equality.

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{ Diff.init(.equal, "ab"), Diff.init(.insert, "123"), Diff.init(.equal, "c") });
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "abc", "ab123c", false)).items); // diff: Simple insertion.

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{ Diff.init(.equal, "a"), Diff.init(.delete, "123"), Diff.init(.equal, "bc") });
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "a123bc", "abc", false)).items); // diff: Simple deletion.

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{ Diff.init(.equal, "a"), Diff.init(.insert, "123"), Diff.init(.equal, "b"), Diff.init(.insert, "456"), Diff.init(.equal, "c") });
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "abc", "a123b456c", false)).items); // diff: Two insertions.

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{ Diff.init(.equal, "a"), Diff.init(.delete, "123"), Diff.init(.equal, "b"), Diff.init(.delete, "456"), Diff.init(.equal, "c") });
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "a123b456c", "abc", false)).items); // diff: Two deletions.

    // Perform a real diff.
    // Switch off the timeout.
    this.diff_timeout = 0;
    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{ Diff.init(.delete, "a"), Diff.init(.insert, "b") });
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "a", "b", false)).items); // diff: Simple case #1.

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{ Diff.init(.delete, "Apple"), Diff.init(.insert, "Banana"), Diff.init(.equal, "s are a"), Diff.init(.insert, "lso"), Diff.init(.equal, " fruit.") });
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "Apples are a fruit.", "Bananas are also fruit.", false)).items); // diff: Simple case #2.

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{ Diff.init(.delete, "a"), Diff.init(.insert, "\u{0680}"), Diff.init(.equal, "x"), Diff.init(.delete, "\t"), Diff.init(.insert, "\x00") });
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "ax\t", "\u{0680}x\x00", false)).items); // diff: Simple case #3.

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{ Diff.init(.delete, "1"), Diff.init(.equal, "a"), Diff.init(.delete, "y"), Diff.init(.equal, "b"), Diff.init(.delete, "2"), Diff.init(.insert, "xab") });
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "1ayb2", "abxab", false)).items); // diff: Overlap #1.

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{ Diff.init(.insert, "xaxcx"), Diff.init(.equal, "abc"), Diff.init(.delete, "y") });
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "abcy", "xaxcxabc", false)).items); // diff: Overlap #2.

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{ Diff.init(.delete, "ABCD"), Diff.init(.equal, "a"), Diff.init(.delete, "="), Diff.init(.insert, "-"), Diff.init(.equal, "bcd"), Diff.init(.delete, "="), Diff.init(.insert, "-"), Diff.init(.equal, "efghijklmnopqrs"), Diff.init(.delete, "EFGHIJKLMNOefg") });
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "ABCDa=bcd=efghijklmnopqrsEFGHIJKLMNOefg", "a-bcd-efghijklmnopqrs", false)).items); // diff: Overlap #3.

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{ Diff.init(.insert, " "), Diff.init(.equal, "a"), Diff.init(.insert, "nd"), Diff.init(.equal, " [[Pennsylvania]]"), Diff.init(.delete, " and [[New") });
    try testing.expectEqualDeep(diffs.items, (try this.diff(arena.allocator(), "a [[Pennsylvania]] and [[New", " and [[Pennsylvania]]", false)).items); // diff: Large equality.

    this.diff_timeout = 100; // 100ms
    // Increase the text lengths by 1024 times to ensure a timeout.
    {
        const a = "`Twas brillig, and the slithy toves\nDid gyre and gimble in the wabe:\nAll mimsy were the borogoves,\nAnd the mome raths outgrabe.\n" ** 1024;
        const b = "I am the very model of a modern major general,\nI've information vegetable, animal, and mineral,\nI know the kings of England, and I quote the fights historical,\nFrom Marathon to Waterloo, in order categorical.\n" ** 1024;
        const start_time = std.time.milliTimestamp();
        _ = try this.diff(arena.allocator(), a, b, false); // Travis - TODO not sure what the third arg should be
        const end_time = std.time.milliTimestamp();
        // Test that we took at least the timeout period.
        try testing.expect(this.diff_timeout <= end_time - start_time); // diff: Timeout min.
        // Test that we didn't take forever (be forgiving).
        // Theoretically this test could fail very occasionally if the
        // OS task swaps or locks up for a second at the wrong moment.
        try testing.expect((this.diff_timeout) * 10000 * 2 > end_time - start_time); // diff: Timeout max.
        this.diff_timeout = 0;
    }
    {
        // Test the linemode speedup.
        // Must be long to pass the 100 char cutoff.
        const a = "1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n";
        const b = "abcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\n";
        try testing.expectEqualDeep(try this.diff(arena.allocator(), a, b, true), try this.diff(arena.allocator(), a, b, false)); // diff: Simple line-mode.
    }
    {
        const a = "1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890";
        const b = "abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij";
        try testing.expectEqualDeep(try this.diff(arena.allocator(), a, b, true), try this.diff(arena.allocator(), a, b, false)); // diff: Single line-mode.
    }

    const a = "1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n";
    const b = "abcdefghij\n1234567890\n1234567890\n1234567890\nabcdefghij\n1234567890\n1234567890\n1234567890\nabcdefghij\n1234567890\n1234567890\n1234567890\nabcdefghij\n";
    const texts_linemode = try rebuildtexts(arena.allocator(), try this.diff(arena.allocator(), a, b, true));
    defer {
        arena.allocator().free(texts_linemode[0]);
        arena.allocator().free(texts_linemode[1]);
    }
    const texts_textmode = try rebuildtexts(arena.allocator(), try this.diff(arena.allocator(), a, b, false));
    defer {
        arena.allocator().free(texts_textmode[0]);
        arena.allocator().free(texts_textmode[1]);
    }
    try testing.expectEqualDeep(texts_textmode, texts_linemode); // diff: Overlap line-mode.

    // Test null inputs -- not needed because nulls can't be passed in C#.
}

test diffCleanupSemantic {
    var arena = bun.ArenaAllocator.init(talloc);
    defer arena.deinit();

    // Cleanup semantically trivial equalities.
    // Null case.
    var diffs = DiffList{};
    defer diffs.deinit(arena.allocator());
    // var this = default;
    try diffCleanupSemantic(arena.allocator(), &diffs);
    try testing.expectEqual(@as(usize, 0), diffs.items.len); // Null case

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.delete, "ab"),
        Diff.init(.insert, "cd"),
        Diff.init(.equal, "12"),
        Diff.init(.delete, "e"),
    });
    try diffCleanupSemantic(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{ // No elimination #1
        Diff.init(.delete, "ab"),
        Diff.init(.insert, "cd"),
        Diff.init(.equal, "12"),
        Diff.init(.delete, "e"),
    }), diffs.items);

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.delete, "abc"),
        Diff.init(.insert, "ABC"),
        Diff.init(.equal, "1234"),
        Diff.init(.delete, "wxyz"),
    });
    try diffCleanupSemantic(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{ // No elimination #2
        Diff.init(.delete, "abc"),
        Diff.init(.insert, "ABC"),
        Diff.init(.equal, "1234"),
        Diff.init(.delete, "wxyz"),
    }), diffs.items);

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.delete, "a"),
        Diff.init(.equal, "b"),
        Diff.init(.delete, "c"),
    });
    try diffCleanupSemantic(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{ // Simple elimination
        Diff.init(.delete, "abc"),
        Diff.init(.insert, "b"),
    }), diffs.items);

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.delete, "ab"),
        Diff.init(.equal, "cd"),
        Diff.init(.delete, "e"),
        Diff.init(.equal, "f"),
        Diff.init(.insert, "g"),
    });
    try diffCleanupSemantic(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{ // Backpass elimination
        Diff.init(.delete, "abcdef"),
        Diff.init(.insert, "cdfg"),
    }), diffs.items);

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.insert, "1"),
        Diff.init(.equal, "A"),
        Diff.init(.delete, "B"),
        Diff.init(.insert, "2"),
        Diff.init(.equal, "_"),
        Diff.init(.insert, "1"),
        Diff.init(.equal, "A"),
        Diff.init(.delete, "B"),
        Diff.init(.insert, "2"),
    });
    try diffCleanupSemantic(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{ // Multiple elimination
        Diff.init(.delete, "AB_AB"),
        Diff.init(.insert, "1A2_1A2"),
    }), diffs.items);

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.equal, "The c"),
        Diff.init(.delete, "ow and the c"),
        Diff.init(.equal, "at."),
    });
    try diffCleanupSemantic(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{ // Word boundaries
        Diff.init(.equal, "The "),
        Diff.init(.delete, "cow and the "),
        Diff.init(.equal, "cat."),
    }), diffs.items);

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.delete, "abcxx"),
        Diff.init(.insert, "xxdef"),
    });
    try diffCleanupSemantic(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{ // No overlap elimination
        Diff.init(.delete, "abcxx"),
        Diff.init(.insert, "xxdef"),
    }), diffs.items);

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.delete, "abcxxx"),
        Diff.init(.insert, "xxxdef"),
    });
    try diffCleanupSemantic(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{ // Overlap elimination
        Diff.init(.delete, "abc"),
        Diff.init(.equal, "xxx"),
        Diff.init(.insert, "def"),
    }), diffs.items);

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.delete, "xxxabc"),
        Diff.init(.insert, "defxxx"),
    });
    try diffCleanupSemantic(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{ // Reverse overlap elimination
        Diff.init(.insert, "def"),
        Diff.init(.equal, "xxx"),
        Diff.init(.delete, "abc"),
    }), diffs.items);

    diffs.items.len = 0;
    try diffs.appendSlice(arena.allocator(), &.{
        Diff.init(.delete, "abcd1212"),
        Diff.init(.insert, "1212efghi"),
        Diff.init(.equal, "----"),
        Diff.init(.delete, "A3"),
        Diff.init(.insert, "3BC"),
    });
    try diffCleanupSemantic(arena.allocator(), &diffs);
    try testing.expectEqualDeep(@as([]const Diff, &[_]Diff{ // Two overlap eliminations
        Diff.init(.delete, "abcd"),
        Diff.init(.equal, "1212"),
        Diff.init(.insert, "efghi"),
        Diff.init(.equal, "----"),
        Diff.init(.delete, "A"),
        Diff.init(.equal, "3"),
        Diff.init(.insert, "BC"),
    }), diffs.items);
}
