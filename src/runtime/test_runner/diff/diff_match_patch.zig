// MIT License
//
// Copyright (c) 2023 diffz authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

const Config = struct {
    /// Number of milliseconds to map a diff before giving up (0 for infinity).
    diff_timeout: u64 = 1000,
    /// Cost of an empty edit operation in terms of edit characters.
    diff_edit_cost: u16 = 4,
    /// Number of bytes in each string needed to trigger a line-based diff
    diff_check_lines_over: u64 = 100,

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
};

pub fn DMP(comptime Unit: type) type {
    return struct {
        const DiffMatchPatch = @This();

        const std = @import("std");
        const testing = std.testing;
        const Allocator = std.mem.Allocator;

        /// DMP with default configuration options
        pub const default: DiffMatchPatch = .{ .config = .{} };

        pub const Diff = struct {
            pub const Operation = enum {
                insert,
                delete,
                equal,
            };

            operation: Operation,
            text: []const Unit,

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

            pub fn eql(a: Diff, b: Diff) bool {
                return a.operation == b.operation and std.mem.eql(Unit, a.text, b.text);
            }

            test eql {
                const equal_a: Diff = .{ .operation = .equal, .text = "a" };
                const insert_a: Diff = .{ .operation = .insert, .text = "a" };
                const equal_b: Diff = .{ .operation = .equal, .text = "b" };
                const delete_b: Diff = .{ .operation = .delete, .text = "b" };

                try testing.expect(equal_a.eql(equal_a));
                try testing.expect(!insert_a.eql(equal_a));
                try testing.expect(!equal_a.eql(equal_b));
                try testing.expect(!equal_a.eql(delete_b));
            }
        };

        config: Config,

        pub const DiffError = error{OutOfMemory};

        /// Find the differences between two texts.  The return value
        /// must be freed with `deinitDiffList(allocator, &diffs)`.
        /// @param before Old string to be diffed.
        /// @param after New string to be diffed.
        /// @param checklines Speedup flag.  If false, then don't run a
        ///     line-level diff first to identify the changed areas.
        ///     If true, then run a faster slightly less optimal diff.
        /// @return List of Diff objects.
        pub fn diff(
            dmp: DiffMatchPatch,
            allocator: std.mem.Allocator,
            before: []const Unit,
            after: []const Unit,
            /// If false, then don't run a line-level diff first
            /// to identify the changed areas. If true, then run
            /// a faster slightly less optimal diff.
            check_lines: bool,
        ) DiffError!DiffList {
            const deadline = if (dmp.config.diff_timeout == 0)
                std.math.maxInt(u64)
            else
                @as(u64, @intCast(std.time.milliTimestamp())) + dmp.config.diff_timeout;
            return dmp.diffInternal(allocator, before, after, check_lines, deadline);
        }

        const DiffList = std.ArrayListUnmanaged(Diff);

        /// Deinit an `std.ArrayListUnmanaged(Diff)` and the allocated slices of
        /// text in each `Diff`.
        pub fn deinitDiffList(allocator: Allocator, diffs: *DiffList) void {
            defer diffs.deinit(allocator);
            for (diffs.items) |d| {
                allocator.free(d.text);
            }
        }

        fn freeRangeDiffList(
            allocator: Allocator,
            diffs: *DiffList,
            start: usize,
            len: usize,
        ) void {
            const range = diffs.items[start..][0..len];
            for (range) |d| {
                allocator.free(d.text);
            }
        }

        fn diffInternal(
            dmp: DiffMatchPatch,
            allocator: std.mem.Allocator,
            before: []const Unit,
            after: []const Unit,
            check_lines: bool,
            deadline: u64,
        ) DiffError!DiffList {
            // Trim off common prefix (speedup).
            const common_prefix_length = std.mem.indexOfDiff(Unit, before, after) orelse {
                // equality
                var diffs: DiffList = .empty;
                errdefer deinitDiffList(allocator, &diffs);
                if (before.len != 0) {
                    try diffs.ensureUnusedCapacity(allocator, 1);
                    diffs.appendAssumeCapacity(.{
                        .operation = .equal,
                        .text = try allocator.dupe(Unit, before),
                    });
                }
                return diffs;
            };

            const common_prefix = before[0..common_prefix_length];
            var trimmed_before = before[common_prefix_length..];
            var trimmed_after = after[common_prefix_length..];

            // Trim off common suffix (speedup).
            const common_suffix_length = diffCommonSuffix(trimmed_before, trimmed_after);
            const common_suffix = trimmed_before[trimmed_before.len - common_suffix_length ..];
            trimmed_before = trimmed_before[0 .. trimmed_before.len - common_suffix_length];
            trimmed_after = trimmed_after[0 .. trimmed_after.len - common_suffix_length];

            // Compute the diff on the middle block.
            var diffs = try dmp.diffCompute(allocator, trimmed_before, trimmed_after, check_lines, deadline);
            errdefer deinitDiffList(allocator, &diffs);

            // Restore the prefix and suffix.

            if (common_prefix.len != 0) {
                try diffs.ensureUnusedCapacity(allocator, 1);
                diffs.insertAssumeCapacity(0, .{
                    .operation = .equal,
                    .text = try allocator.dupe(Unit, common_prefix),
                });
            }
            if (common_suffix.len != 0) {
                try diffs.ensureUnusedCapacity(allocator, 1);
                diffs.appendAssumeCapacity(.{
                    .operation = .equal,
                    .text = try allocator.dupe(Unit, common_suffix),
                });
            }

            try diffCleanupMerge(allocator, &diffs);
            return diffs;
        }

        fn indexOfDiff(comptime T: type, a: []const T, b: []const T) ?usize {
            const shortest = @min(a.len, b.len);
            for (a[0..shortest], b[0..shortest], 0..) |a_char, b_char, index| {
                if (a_char != b_char) return index;
            }
            return if (a.len == b.len) null else shortest;
        }

        fn diffCommonPrefix(before: []const Unit, after: []const Unit) usize {
            return indexOfDiff(Unit, before, after) orelse @min(before.len, after.len);
        }

        fn diffCommonSuffix(before: []const Unit, after: []const Unit) usize {
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
            before: []const Unit,
            after: []const Unit,
            check_lines: bool,
            deadline: u64,
        ) DiffError!DiffList {
            if (before.len == 0) {
                // Just add some text (speedup).
                var diffs: DiffList = .empty;
                errdefer deinitDiffList(allocator, &diffs);
                try diffs.ensureUnusedCapacity(allocator, 1);
                diffs.appendAssumeCapacity(.{
                    .operation = .insert,
                    .text = try allocator.dupe(Unit, after),
                });
                return diffs;
            }

            if (after.len == 0) {
                // Just delete some text (speedup).
                var diffs: DiffList = .empty;
                errdefer deinitDiffList(allocator, &diffs);
                try diffs.ensureUnusedCapacity(allocator, 1);
                diffs.appendAssumeCapacity(.{
                    .operation = .delete,
                    .text = try allocator.dupe(Unit, before),
                });
                return diffs;
            }

            const long_text = if (before.len > after.len) before else after;
            const short_text = if (before.len > after.len) after else before;

            if (std.mem.indexOf(Unit, long_text, short_text)) |index| {
                var diffs: DiffList = .empty;
                errdefer deinitDiffList(allocator, &diffs);
                // Shorter text is inside the longer text (speedup).
                const op: Diff.Operation = if (before.len > after.len)
                    .delete
                else
                    .insert;
                try diffs.ensureUnusedCapacity(allocator, 3);
                diffs.appendAssumeCapacity(.{
                    .operation = op,
                    .text = try allocator.dupe(Unit, long_text[0..index]),
                });
                diffs.appendAssumeCapacity(.{
                    .operation = .equal,
                    .text = try allocator.dupe(Unit, short_text),
                });
                diffs.appendAssumeCapacity(.{
                    .operation = op,
                    .text = try allocator.dupe(Unit, long_text[index + short_text.len ..]),
                });
                return diffs;
            }

            if (short_text.len == 1) {
                // Single character string.
                // After the previous speedup, the character can't be an equality.
                var diffs: DiffList = .empty;
                errdefer deinitDiffList(allocator, &diffs);
                try diffs.ensureUnusedCapacity(allocator, 2);
                diffs.appendAssumeCapacity(.{
                    .operation = .delete,
                    .text = try allocator.dupe(Unit, before),
                });
                diffs.appendAssumeCapacity(.{
                    .operation = .insert,
                    .text = try allocator.dupe(Unit, after),
                });
                return diffs;
            }

            // Check to see if the problem can be split in two.
            if (try dmp.diffHalfMatch(allocator, before, after)) |half_match| {
                // A half-match was found, sort out the return data.
                defer half_match.deinit(allocator);
                // Send both pairs off for separate processing.
                var diffs = try dmp.diffInternal(
                    allocator,
                    half_match.prefix_before,
                    half_match.prefix_after,
                    check_lines,
                    deadline,
                );
                errdefer deinitDiffList(allocator, &diffs);
                var diffs_b = try dmp.diffInternal(
                    allocator,
                    half_match.suffix_before,
                    half_match.suffix_after,
                    check_lines,
                    deadline,
                );
                defer diffs_b.deinit(allocator);
                // we have to deinit regardless, so deinitDiffList would be
                // a double free:
                errdefer {
                    for (diffs_b.items) |d| {
                        allocator.free(d.text);
                    }
                }

                // Merge the results.
                try diffs.ensureUnusedCapacity(allocator, 1);
                diffs.appendAssumeCapacity(.{
                    .operation = .equal,
                    .text = try allocator.dupe(Unit, half_match.common_middle),
                });
                try diffs.appendSlice(allocator, diffs_b.items);
                return diffs;
            }
            if (check_lines and before.len > dmp.config.diff_check_lines_over and after.len > dmp.config.diff_check_lines_over) {
                return dmp.diffLineMode(allocator, before, after, deadline);
            }

            return dmp.diffBisect(allocator, before, after, deadline);
        }

        const HalfMatchResult = struct {
            prefix_before: []const Unit,
            suffix_before: []const Unit,
            prefix_after: []const Unit,
            suffix_after: []const Unit,
            common_middle: []const Unit,

            pub fn deinit(hmr: HalfMatchResult, alloc: Allocator) void {
                alloc.free(hmr.prefix_before);
                alloc.free(hmr.suffix_before);
                alloc.free(hmr.prefix_after);
                alloc.free(hmr.suffix_after);
                alloc.free(hmr.common_middle);
            }
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
            before: []const Unit,
            after: []const Unit,
        ) DiffError!?HalfMatchResult {
            if (dmp.config.diff_timeout <= 0) {
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
            errdefer {
                if (half_match_1) |h_m| h_m.deinit(allocator);
            }
            // Check again based on the third quarter.
            const half_match_2 = try dmp.diffHalfMatchInternal(allocator, long_text, short_text, (long_text.len + 1) / 2);
            errdefer {
                if (half_match_2) |h_m| h_m.deinit(allocator);
            }

            var half_match: ?HalfMatchResult = null;
            if (half_match_1 == null and half_match_2 == null) {
                return null;
            } else if (half_match_2 == null) {
                half_match = half_match_1.?;
            } else if (half_match_1 == null) {
                half_match = half_match_2.?;
            } else {
                // Both matched. Select the longest.
                half_match = half: {
                    if (half_match_1.?.common_middle.len > half_match_2.?.common_middle.len) {
                        half_match_2.?.deinit(allocator);
                        break :half half_match_1;
                    } else {
                        half_match_1.?.deinit(allocator);
                        break :half half_match_2;
                    }
                };
            }

            // A half-match was found, sort out the return data.
            if (before.len > after.len) {
                return half_match.?;
            } else {
                // Transfers ownership of all memory to new, permuted, half_match.
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
            long_text: []const Unit,
            short_text: []const Unit,
            i: usize,
        ) DiffError!?HalfMatchResult {
            // Start with a 1/4 length Substring at position i as a seed.
            const seed = long_text[i .. i + long_text.len / 4];
            var j: isize = -1;

            var best_common: std.ArrayListUnmanaged(Unit) = .empty;
            defer best_common.deinit(allocator);
            var best_long_text_a: []const Unit = &.{};
            var best_long_text_b: []const Unit = &.{};
            var best_short_text_a: []const Unit = &.{};
            var best_short_text_b: []const Unit = &.{};

            while (j < short_text.len and b: {
                j = @as(isize, @intCast(std.mem.indexOf(Unit, short_text[@intCast(j + 1)..], seed) orelse break :b false)) + j + 1;
                break :b true;
            }) {
                const prefix_length = diffCommonPrefix(long_text[i..], short_text[@intCast(j)..]);
                const suffix_length = diffCommonSuffix(long_text[0..i], short_text[0..@intCast(j)]);
                if (best_common.items.len < suffix_length + prefix_length) {
                    best_common.clearRetainingCapacity();
                    const a = short_text[@intCast(j - @as(isize, @intCast(suffix_length))) .. @as(usize, @intCast(j - @as(isize, @intCast(suffix_length)))) + suffix_length];
                    try best_common.appendSlice(allocator, a);
                    const b = short_text[@intCast(j) .. @as(usize, @intCast(j)) + prefix_length];
                    try best_common.appendSlice(allocator, b);

                    best_long_text_a = long_text[0 .. i - suffix_length];
                    best_long_text_b = long_text[i + prefix_length ..];
                    best_short_text_a = short_text[0..@intCast(j - @as(isize, @intCast(suffix_length)))];
                    best_short_text_b = short_text[@intCast(j + @as(isize, @intCast(prefix_length)))..];
                }
            }
            if (best_common.items.len * 2 >= long_text.len) {
                const prefix_before = try allocator.dupe(Unit, best_long_text_a);
                errdefer allocator.free(prefix_before);
                const suffix_before = try allocator.dupe(Unit, best_long_text_b);
                errdefer allocator.free(suffix_before);
                const prefix_after = try allocator.dupe(Unit, best_short_text_a);
                errdefer allocator.free(prefix_after);
                const suffix_after = try allocator.dupe(Unit, best_short_text_b);
                errdefer allocator.free(suffix_after);
                const best_common_text = try best_common.toOwnedSlice(allocator);
                errdefer allocator.free(best_common_text);
                return .{
                    .prefix_before = prefix_before,
                    .suffix_before = suffix_before,
                    .prefix_after = prefix_after,
                    .suffix_after = suffix_after,
                    .common_middle = best_common_text,
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
            before: []const Unit,
            after: []const Unit,
            deadline: u64,
        ) DiffError!DiffList {
            const before_length: isize = @intCast(before.len);
            const after_length: isize = @intCast(after.len);
            const max_d: isize = @intCast((before.len + after.len + 1) / 2);
            const v_offset = max_d;
            const v_length = 2 * max_d;

            var v1: std.ArrayListUnmanaged(isize) = try .initCapacity(allocator, @intCast(v_length));
            defer v1.deinit(allocator);
            v1.items.len = @intCast(v_length);
            var v2: std.ArrayListUnmanaged(isize) = try .initCapacity(allocator, @intCast(v_length));
            defer v2.deinit(allocator);
            v2.items.len = @intCast(v_length);

            var x: usize = 0;
            while (x < v_length) : (x += 1) {
                v1.items[x] = -1;
                v2.items[x] = -1;
            }
            v1.items[@intCast(v_offset + 1)] = 0;
            v2.items[@intCast(v_offset + 1)] = 0;
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
                        v1.items[@intCast(k1_offset - 1)] < v1.items[@intCast(k1_offset + 1)]))
                    {
                        x1 = v1.items[@intCast(k1_offset + 1)];
                    } else {
                        x1 = v1.items[@intCast(k1_offset - 1)] + 1;
                    }
                    var y1 = x1 - k1;
                    while (x1 < before_length and
                        y1 < after_length and before[@intCast(x1)] == after[@intCast(y1)])
                    {
                        x1 += 1;
                        y1 += 1;
                    }
                    v1.items[@intCast(k1_offset)] = x1;
                    if (x1 > before_length) {
                        // Ran off the right of the graph.
                        k1end += 2;
                    } else if (y1 > after_length) {
                        // Ran off the bottom of the graph.
                        k1start += 2;
                    } else if (front) {
                        const k2_offset = v_offset + delta - k1;
                        if (k2_offset >= 0 and k2_offset < v_length and v2.items[@intCast(k2_offset)] != -1) {
                            // Mirror x2 onto top-left coordinate system.
                            const x2 = before_length - v2.items[@intCast(k2_offset)];
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
                        v2.items[@intCast(k2_offset - 1)] < v2.items[@intCast(k2_offset + 1)]))
                    {
                        x2 = v2.items[@intCast(k2_offset + 1)];
                    } else {
                        x2 = v2.items[@intCast(k2_offset - 1)] + 1;
                    }
                    var y2: isize = x2 - k2;
                    while (x2 < before_length and y2 < after_length and
                        before[@intCast(before_length - x2 - 1)] ==
                            after[@intCast(after_length - y2 - 1)])
                    {
                        x2 += 1;
                        y2 += 1;
                    }
                    v2.items[@intCast(k2_offset)] = x2;
                    if (x2 > before_length) {
                        // Ran off the left of the graph.
                        k2end += 2;
                    } else if (y2 > after_length) {
                        // Ran off the top of the graph.
                        k2start += 2;
                    } else if (!front) {
                        const k1_offset = v_offset + delta - k2;
                        if (k1_offset >= 0 and k1_offset < v_length and v1.items[@intCast(k1_offset)] != -1) {
                            const x1 = v1.items[@intCast(k1_offset)];
                            const y1 = v_offset + x1 - k1_offset;
                            // Mirror x2 onto top-left coordinate system.
                            x2 = before_length - v2.items[@intCast(k2_offset)];
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
            var diffs: DiffList = .empty;
            errdefer deinitDiffList(allocator, &diffs);
            try diffs.ensureUnusedCapacity(allocator, 2);
            diffs.appendAssumeCapacity(.{
                .operation = .delete,
                .text = try allocator.dupe(Unit, before),
            });
            diffs.appendAssumeCapacity(.{
                .operation = .insert,
                .text = try allocator.dupe(Unit, after),
            });
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
            text1: []const Unit,
            text2: []const Unit,
            x: isize,
            y: isize,
            deadline: u64,
        ) DiffError!DiffList {
            const text1a = text1[0..@intCast(x)];
            const text2a = text2[0..@intCast(y)];
            const text1b = text1[@intCast(x)..];
            const text2b = text2[@intCast(y)..];

            // Compute both diffs serially.
            var diffs = try dmp.diffInternal(allocator, text1a, text2a, false, deadline);
            errdefer deinitDiffList(allocator, &diffs);
            var diffs_b = try dmp.diffInternal(allocator, text1b, text2b, false, deadline);
            // Free the list, but not the contents:
            defer diffs_b.deinit(allocator);
            errdefer {
                for (diffs_b.items) |d| {
                    allocator.free(d.text);
                }
            }
            try diffs.appendSlice(allocator, diffs_b.items);
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
            text1_in: []const Unit,
            text2_in: []const Unit,
            deadline: u64,
        ) DiffError!DiffList {
            // Scan the text on a line-by-line basis first.
            var a = try diffLinesToChars(allocator, text1_in, text2_in);
            defer a.deinit(allocator);
            const text1 = a.chars_1;
            const text2 = a.chars_2;
            const line_array = a.line_array;
            var diffs: DiffList = undefined;
            var dmpUsize = DMPUsize{ .config = dmp.config };
            {
                var char_diffs: DMPUsize.DiffList = try dmpUsize.diffInternal(allocator, text1, text2, false, deadline);
                defer DMPUsize.deinitDiffList(allocator, &char_diffs);
                // Convert the diff back to original text.
                diffs = try diffCharsToLines(allocator, &char_diffs, line_array.items);
                // Eliminate freak matches (e.g. blank lines)
            }
            errdefer deinitDiffList(allocator, &diffs);
            try diffCleanupSemantic(allocator, &diffs);

            // Rediff any replacement blocks, this time character-by-character.
            // Add a dummy entry at the end.
            try diffs.append(allocator, .{ .operation = .equal, .text = &.{} });

            var pointer: usize = 0;
            var count_delete: usize = 0;
            var count_insert: usize = 0;
            var text_delete: std.ArrayListUnmanaged(Unit) = .empty;
            var text_insert: std.ArrayListUnmanaged(Unit) = .empty;
            defer {
                text_delete.deinit(allocator);
                text_insert.deinit(allocator);
            }

            while (pointer < diffs.items.len) {
                switch (diffs.items[pointer].operation) {
                    .insert => {
                        count_insert += 1;
                        try text_insert.appendSlice(allocator, diffs.items[pointer].text);
                    },
                    .delete => {
                        count_delete += 1;
                        try text_delete.appendSlice(allocator, diffs.items[pointer].text);
                    },
                    .equal => {
                        // Upon reaching an equality, check for prior redundancies.
                        if (count_delete >= 1 and count_insert >= 1) {
                            // Delete the offending records and add the merged ones.
                            freeRangeDiffList(
                                allocator,
                                &diffs,
                                pointer - count_delete - count_insert,
                                count_delete + count_insert,
                            );
                            diffs.replaceRangeAssumeCapacity(
                                pointer - count_delete - count_insert,
                                count_delete + count_insert,
                                &.{},
                            );
                            pointer = pointer - count_delete - count_insert;
                            var sub_diff = try dmp.diffInternal(allocator, text_delete.items, text_insert.items, false, deadline);
                            {
                                errdefer deinitDiffList(allocator, &sub_diff);
                                try diffs.ensureUnusedCapacity(allocator, sub_diff.items.len);
                            }
                            defer sub_diff.deinit(allocator);
                            const new_diff = diffs.addManyAtAssumeCapacity(pointer, sub_diff.items.len);
                            @memcpy(new_diff, sub_diff.items);
                            pointer = pointer + sub_diff.items.len;
                        }
                        count_insert = 0;
                        count_delete = 0;
                        text_delete.clearRetainingCapacity();
                        text_insert.clearRetainingCapacity();
                    },
                }
                pointer += 1;
            }
            diffs.items.len -= 1; // Remove the dummy entry at the end.

            return diffs;
        }

        const LinesToCharsResult = struct {
            chars_1: []const usize,
            chars_2: []const usize,
            line_array: std.ArrayListUnmanaged([]const Unit),

            pub fn deinit(self: *LinesToCharsResult, allocator: Allocator) void {
                allocator.free(self.chars_1);
                allocator.free(self.chars_2);
                self.line_array.deinit(allocator);
            }
        };

        /// Split two texts into a list of strings.  Reduce the texts to a string of
        /// hashes where each Unicode character represents one line.
        /// @param text1 First string.
        /// @param text2 Second string.
        /// @return Three element Object array, containing the encoded text1, the
        ///     encoded text2 and the List of unique strings.  The zeroth element
        ///     of the List of unique strings is intentionally blank.
        pub fn diffLinesToChars(
            allocator: std.mem.Allocator,
            text1: []const Unit,
            text2: []const Unit,
        ) DiffError!LinesToCharsResult {
            var line_array: std.ArrayListUnmanaged([]const Unit) = .empty;
            errdefer line_array.deinit(allocator);
            var line_hash: StringHashMapUnmanaged(usize) = .empty;
            defer line_hash.deinit(allocator);
            // e.g. line_array[4] == "Hello\n"
            // e.g. line_hash.get("Hello\n") == 4

            // "\x00" is a valid character, but various debuggers don't like it.
            // So we'll insert a junk entry to avoid generating a null character.
            try line_array.append(allocator, &.{});

            // Allocate 2/3rds of the space for text1, the rest for text2.
            const chars1 = try diffLinesToCharsMunge(allocator, text1, &line_array, &line_hash);
            errdefer allocator.free(chars1);
            const chars2 = try diffLinesToCharsMunge(allocator, text2, &line_array, &line_hash);
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
            text: []const Unit,
            line_array: *std.ArrayListUnmanaged([]const Unit),
            line_hash: *StringHashMapUnmanaged(usize),
        ) DiffError![]const usize {
            if (Unit != u8) @panic("Unit must be u8");
            var line_start: isize = 0;
            var line_end: isize = -1;
            var chars: std.ArrayListUnmanaged(usize) = .empty;
            defer chars.deinit(allocator);
            // Walk the text, pulling out a Substring for each line.
            // TODO this can be handled with a Reader, avoiding all the manual splitting
            while (line_end < @as(isize, @intCast(text.len)) - 1) {
                line_end = b: {
                    break :b @as(isize, @intCast(std.mem.indexOf(Unit, text[@intCast(line_start)..], "\n") orelse
                        break :b @intCast(text.len - 1))) + line_start;
                };
                var line = text[@intCast(line_start) .. @as(usize, @intCast(line_start)) + @as(usize, @intCast(line_end + 1 - line_start))];

                if (line_hash.get(line)) |value| {
                    try chars.append(allocator, @intCast(value));
                } else {
                    if (line_array.items.len == std.math.maxInt(usize)) {
                        line = text[@intCast(line_start)..];
                        line_end = @intCast(text.len);
                    }
                    try line_array.append(allocator, line);
                    try line_hash.put(allocator, line, line_array.items.len - 1);
                    try chars.append(allocator, @intCast(line_array.items.len - 1));
                }
                line_start = line_end + 1;
            }
            return try chars.toOwnedSlice(allocator);
        }

        const DMPUsize = DMP(usize);

        /// Rehydrate the text in a diff from a string of line hashes to real lines
        /// of text.
        /// @param diffs List of Diff objects.
        /// @param lineArray List of unique strings.
        pub fn diffCharsToLines(
            allocator: std.mem.Allocator,
            char_diffs: *const DMPUsize.DiffList,
            line_array: []const []const Unit,
        ) DiffError!DiffList {
            var diffs: DiffList = .empty;
            errdefer deinitDiffList(allocator, &diffs);
            try diffs.ensureTotalCapacity(allocator, char_diffs.items.len);
            var text: std.ArrayListUnmanaged(Unit) = .empty;
            defer text.deinit(allocator);

            for (char_diffs.items) |*d| {
                var j: usize = 0;
                while (j < d.text.len) : (j += 1) {
                    try text.appendSlice(allocator, line_array[d.text[j]]);
                }
                diffs.appendAssumeCapacity(.{
                    .operation = d.operation,
                    .text = try text.toOwnedSlice(allocator),
                });
            }
            return diffs;
        }

        /// Reorder and merge like edit sections.  Merge equalities.
        /// Any edit section can move as long as it doesn't cross an equality.
        /// @param diffs List of Diff objects.
        fn diffCleanupMerge(allocator: std.mem.Allocator, diffs: *DiffList) DiffError!void {
            // Add a dummy entry at the end.
            try diffs.append(allocator, .{ .operation = .equal, .text = &.{} });
            var pointer: usize = 0;
            var count_delete: usize = 0;
            var count_insert: usize = 0;

            var text_delete: std.ArrayListUnmanaged(Unit) = .empty;
            defer text_delete.deinit(allocator);

            var text_insert: std.ArrayListUnmanaged(Unit) = .empty;
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
                                        const ii = pointer - count_delete - count_insert - 1;
                                        var nt = try allocator.alloc(Unit, diffs.items[ii].text.len + common_length);
                                        const ot = diffs.items[ii].text;
                                        @memcpy(nt[0..ot.len], ot);
                                        @memcpy(nt[ot.len..], text_insert.items[0..common_length]);
                                        diffs.items[ii].text = nt;
                                        allocator.free(ot);
                                    } else {
                                        try diffs.ensureUnusedCapacity(allocator, 1);
                                        const text = try allocator.dupe(Unit, text_insert.items[0..common_length]);
                                        diffs.insertAssumeCapacity(0, .{ .operation = .equal, .text = text });
                                        pointer += 1;
                                    }
                                    text_insert.replaceRangeAssumeCapacity(0, common_length, &.{});
                                    text_delete.replaceRangeAssumeCapacity(0, common_length, &.{});
                                }
                                // Factor out any common suffixies.
                                // @ZigPort this seems very wrong
                                common_length = diffCommonSuffix(text_insert.items, text_delete.items);
                                if (common_length != 0) {
                                    const old_text = diffs.items[pointer].text;
                                    diffs.items[pointer].text = try std.mem.concat(allocator, Unit, &.{
                                        text_insert.items[text_insert.items.len - common_length ..],
                                        old_text,
                                    });
                                    allocator.free(old_text);
                                    text_insert.items.len -= common_length;
                                    text_delete.items.len -= common_length;
                                }
                            }
                            // Delete the offending records and add the merged ones.
                            pointer -= count_delete + count_insert;
                            if (count_delete + count_insert > 0) {
                                freeRangeDiffList(allocator, diffs, pointer, count_delete + count_insert);
                                diffs.replaceRangeAssumeCapacity(pointer, count_delete + count_insert, &.{});
                            }

                            if (text_delete.items.len != 0) {
                                try diffs.ensureUnusedCapacity(allocator, 1);
                                diffs.insertAssumeCapacity(pointer, .{
                                    .operation = .delete,
                                    .text = try allocator.dupe(Unit, text_delete.items),
                                });
                                pointer += 1;
                            }
                            if (text_insert.items.len != 0) {
                                try diffs.ensureUnusedCapacity(allocator, 1);
                                diffs.insertAssumeCapacity(pointer, .{
                                    .operation = .insert,
                                    .text = try allocator.dupe(Unit, text_insert.items),
                                });
                                pointer += 1;
                            }
                            pointer += 1;
                        } else if (pointer != 0 and diffs.items[pointer - 1].operation == .equal) {
                            // Merge this equality with the previous one.
                            // TODO: Fix using realloc or smth
                            // Note: can't use realloc because the text is const
                            var nt = try allocator.alloc(Unit, diffs.items[pointer - 1].text.len + diffs.items[pointer].text.len);
                            const ot = diffs.items[pointer - 1].text;
                            defer (allocator.free(ot));
                            @memcpy(nt[0..ot.len], ot);
                            @memcpy(nt[ot.len..], diffs.items[pointer].text);
                            diffs.items[pointer - 1].text = nt;
                            const dead_diff = diffs.orderedRemove(pointer);
                            allocator.free(dead_diff.text);
                        } else {
                            pointer += 1;
                        }
                        count_insert = 0;
                        count_delete = 0;
                        text_delete.clearRetainingCapacity();
                        text_insert.clearRetainingCapacity();
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
                    if (std.mem.endsWith(Unit, diffs.items[pointer].text, diffs.items[pointer - 1].text)) {
                        const old_pt = diffs.items[pointer].text;
                        const pt = try std.mem.concat(allocator, Unit, &.{
                            diffs.items[pointer - 1].text,
                            diffs.items[pointer].text[0 .. diffs.items[pointer].text.len -
                                diffs.items[pointer - 1].text.len],
                        });
                        allocator.free(old_pt);
                        diffs.items[pointer].text = pt;
                        const old_pt1t = diffs.items[pointer + 1].text;
                        const p1t = try std.mem.concat(allocator, Unit, &.{
                            diffs.items[pointer - 1].text,
                            diffs.items[pointer + 1].text,
                        });
                        allocator.free(old_pt1t);
                        diffs.items[pointer + 1].text = p1t;
                        freeRangeDiffList(allocator, diffs, pointer - 1, 1);
                        diffs.replaceRangeAssumeCapacity(pointer - 1, 1, &.{});
                        changes = true;
                    } else if (std.mem.startsWith(Unit, diffs.items[pointer].text, diffs.items[pointer + 1].text)) {
                        const old_ptm1 = diffs.items[pointer - 1].text;
                        const pm1t = try std.mem.concat(allocator, Unit, &.{
                            diffs.items[pointer - 1].text,
                            diffs.items[pointer + 1].text,
                        });
                        allocator.free(old_ptm1);
                        diffs.items[pointer - 1].text = pm1t;
                        const old_pt = diffs.items[pointer].text;
                        const pt = try std.mem.concat(allocator, Unit, &.{
                            diffs.items[pointer].text[diffs.items[pointer + 1].text.len..],
                            diffs.items[pointer + 1].text,
                        });
                        allocator.free(old_pt);
                        diffs.items[pointer].text = pt;
                        freeRangeDiffList(allocator, diffs, pointer + 1, 1);
                        diffs.replaceRangeAssumeCapacity(pointer + 1, 1, &.{});
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
        pub fn diffCleanupSemantic(allocator: std.mem.Allocator, diffs: *DiffList) DiffError!void {
            var changes = false;
            // Stack of indices where equalities are found.
            var equalities: std.ArrayListUnmanaged(isize) = .empty;
            defer equalities.deinit(allocator);
            // Always equal to equalities[equalitiesLength-1][1]
            var last_equality: ?[]const Unit = null;
            var pointer: isize = 0; // Index of current position.
            // Number of characters that changed prior to the equality.
            var length_insertions1: usize = 0;
            var length_deletions1: usize = 0;
            // Number of characters that changed after the equality.
            var length_insertions2: usize = 0;
            var length_deletions2: usize = 0;
            while (pointer < diffs.items.len) {
                if (diffs.items[@intCast(pointer)].operation == .equal) { // Equality found.
                    try equalities.append(allocator, pointer);
                    length_insertions1 = length_insertions2;
                    length_deletions1 = length_deletions2;
                    length_insertions2 = 0;
                    length_deletions2 = 0;
                    last_equality = diffs.items[@intCast(pointer)].text;
                } else { // an insertion or deletion
                    if (diffs.items[@intCast(pointer)].operation == .insert) {
                        length_insertions2 += diffs.items[@intCast(pointer)].text.len;
                    } else {
                        length_deletions2 += diffs.items[@intCast(pointer)].text.len;
                    }
                    // Eliminate an equality that is smaller or equal to the edits on both
                    // sides of it.
                    if (last_equality != null and
                        (last_equality.?.len <= @max(length_insertions1, length_deletions1)) and
                        (last_equality.?.len <= @max(length_insertions2, length_deletions2)))
                    {
                        // Duplicate record.
                        try diffs.ensureUnusedCapacity(allocator, 1);
                        diffs.insertAssumeCapacity(
                            @intCast(equalities.items[equalities.items.len - 1]),
                            .{
                                .operation = .delete,
                                .text = try allocator.dupe(Unit, last_equality.?),
                            },
                        );
                        // Change second copy to insert.
                        diffs.items[@intCast(equalities.items[equalities.items.len - 1] + 1)].operation = .insert;
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
                if (diffs.items[@intCast(pointer - 1)].operation == .delete and
                    diffs.items[@intCast(pointer)].operation == .insert)
                {
                    const deletion = diffs.items[@intCast(pointer - 1)].text;
                    const insertion = diffs.items[@intCast(pointer)].text;
                    const overlap_length1: usize = diffCommonOverlap(deletion, insertion);
                    const overlap_length2: usize = diffCommonOverlap(insertion, deletion);
                    if (overlap_length1 >= overlap_length2) {
                        if (@as(f32, @floatFromInt(overlap_length1)) >= @as(f32, @floatFromInt(deletion.len)) / 2.0 or
                            @as(f32, @floatFromInt(overlap_length1)) >= @as(f32, @floatFromInt(insertion.len)) / 2.0)
                        {
                            // Overlap found.
                            // Insert an equality and trim the surrounding edits.
                            try diffs.ensureUnusedCapacity(allocator, 1);
                            diffs.insertAssumeCapacity(@intCast(pointer), .{
                                .operation = .equal,
                                .text = try allocator.dupe(Unit, insertion[0..overlap_length1]),
                            });
                            diffs.items[@intCast(pointer - 1)].text =
                                try allocator.dupe(Unit, deletion[0 .. deletion.len - overlap_length1]);
                            allocator.free(deletion);
                            diffs.items[@intCast(pointer + 1)].text =
                                try allocator.dupe(Unit, insertion[overlap_length1..]);
                            allocator.free(insertion);
                            pointer += 1;
                        }
                    } else {
                        if (@as(f32, @floatFromInt(overlap_length2)) >= @as(f32, @floatFromInt(deletion.len)) / 2.0 or
                            @as(f32, @floatFromInt(overlap_length2)) >= @as(f32, @floatFromInt(insertion.len)) / 2.0)
                        {
                            // Reverse overlap found.
                            // Insert an equality and swap and trim the surrounding edits.
                            try diffs.ensureUnusedCapacity(allocator, 1);
                            diffs.insertAssumeCapacity(@intCast(pointer), .{
                                .operation = .equal,
                                .text = try allocator.dupe(Unit, deletion[0..overlap_length2]),
                            });
                            const new_minus = try allocator.dupe(Unit, insertion[0 .. insertion.len - overlap_length2]);
                            errdefer allocator.free(new_minus); // necessary due to swap
                            const new_plus = try allocator.dupe(Unit, deletion[overlap_length2..]);
                            allocator.free(deletion);
                            allocator.free(insertion);
                            diffs.items[@intCast(pointer - 1)].operation = .insert;
                            diffs.items[@intCast(pointer - 1)].text = new_minus;
                            diffs.items[@intCast(pointer + 1)].operation = .delete;
                            diffs.items[@intCast(pointer + 1)].text = new_plus;
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
                    var equality_1: std.ArrayListUnmanaged(Unit) = .empty;
                    defer equality_1.deinit(allocator);
                    try equality_1.appendSlice(allocator, diffs.items[pointer - 1].text);

                    var edit: std.ArrayListUnmanaged(Unit) = .empty;
                    defer edit.deinit(allocator);
                    try edit.appendSlice(allocator, diffs.items[pointer].text);

                    var equality_2: std.ArrayListUnmanaged(Unit) = .empty;
                    defer equality_2.deinit(allocator);
                    try equality_2.appendSlice(allocator, diffs.items[pointer + 1].text);

                    // First, shift the edit as far left as possible.
                    const common_offset = diffCommonSuffix(equality_1.items, edit.items);
                    if (common_offset > 0) {
                        // TODO: Use buffer
                        const common_string = try allocator.dupe(Unit, edit.items[edit.items.len - common_offset ..]);
                        defer allocator.free(common_string);

                        equality_1.items.len = equality_1.items.len - common_offset;

                        // edit.items.len = edit.items.len - common_offset;
                        const not_common = try allocator.dupe(Unit, edit.items[0 .. edit.items.len - common_offset]);
                        defer allocator.free(not_common);

                        edit.clearRetainingCapacity();
                        try edit.appendSlice(allocator, common_string);
                        try edit.appendSlice(allocator, not_common);

                        try equality_2.insertSlice(allocator, 0, common_string);
                    }

                    // Second, step character by character right,
                    // looking for the best fit.
                    var best_equality_1: std.ArrayListUnmanaged(Unit) = .empty;
                    defer best_equality_1.deinit(allocator);
                    try best_equality_1.appendSlice(allocator, equality_1.items);

                    var best_edit: std.ArrayListUnmanaged(Unit) = .empty;
                    defer best_edit.deinit(allocator);
                    try best_edit.appendSlice(allocator, edit.items);

                    var best_equality_2: std.ArrayListUnmanaged(Unit) = .empty;
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

                            best_equality_1.clearRetainingCapacity();
                            try best_equality_1.appendSlice(allocator, equality_1.items);

                            best_edit.clearRetainingCapacity();
                            try best_edit.appendSlice(allocator, edit.items);

                            best_equality_2.clearRetainingCapacity();
                            try best_equality_2.appendSlice(allocator, equality_2.items);
                        }
                    }

                    if (!std.mem.eql(Unit, diffs.items[pointer - 1].text, best_equality_1.items)) {
                        // We have an improvement, save it back to the diff.
                        if (best_equality_1.items.len != 0) {
                            const old_text = diffs.items[pointer - 1].text;
                            diffs.items[pointer - 1].text = try allocator.dupe(Unit, best_equality_1.items);
                            allocator.free(old_text);
                        } else {
                            const old_diff = diffs.orderedRemove(pointer - 1);
                            allocator.free(old_diff.text);
                            pointer -= 1;
                        }
                        const old_text1 = diffs.items[pointer].text;
                        diffs.items[pointer].text = try allocator.dupe(Unit, best_edit.items);
                        defer allocator.free(old_text1);
                        if (best_equality_2.items.len != 0) {
                            const old_text2 = diffs.items[pointer + 1].text;
                            diffs.items[pointer + 1].text = try allocator.dupe(Unit, best_equality_2.items);
                            allocator.free(old_text2);
                        } else {
                            const old_diff = diffs.orderedRemove(pointer + 1);
                            allocator.free(old_diff.text);
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
        fn diffCleanupSemanticScore(one: []const Unit, two: []const Unit) usize {
            if (one.len == 0 or two.len == 0) {
                // Edges are the best.
                return 6;
            }

            if (Unit != u8) return 5;

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
                (std.mem.endsWith(Unit, one, "\n\n") or std.mem.endsWith(Unit, one, "\n\r\n"));
            const blankLine2 = lineBreak2 and
                // BLANKLINESTART.IsMatch(two);
                (std.mem.startsWith(Unit, two, "\n\n") or
                    std.mem.startsWith(Unit, two, "\r\n\n") or
                    std.mem.startsWith(Unit, two, "\n\r\n") or
                    std.mem.startsWith(Unit, two, "\r\n\r\n"));

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

        /// Reduce the number of edits by eliminating operationally trivial
        /// equalities.
        pub fn diffCleanupEfficiency(
            dmp: DiffMatchPatch,
            allocator: std.mem.Allocator,
            diffs: *DiffList,
        ) DiffError!void {
            var changes = false;
            // Stack of indices where equalities are found.
            var equalities: std.ArrayListUnmanaged(usize) = .empty;
            defer equalities.deinit(allocator);
            // Always equal to equalities[equalitiesLength-1][1]
            var last_equality: []const Unit = "";
            var ipointer: isize = 0; // Index of current position.
            // Is there an insertion operation before the last equality.
            var pre_ins = false;
            // Is there a deletion operation before the last equality.
            var pre_del = false;
            // Is there an insertion operation after the last equality.
            var post_ins = false;
            // Is there a deletion operation after the last equality.
            var post_del = false;
            while (ipointer < diffs.items.len) {
                const pointer: usize = @intCast(ipointer);
                if (diffs.items[pointer].operation == .equal) { // Equality found.
                    if (diffs.items[pointer].text.len < dmp.config.diff_edit_cost and (post_ins or post_del)) {
                        // Candidate found.
                        try equalities.append(allocator, pointer);
                        pre_ins = post_ins;
                        pre_del = post_del;
                        last_equality = diffs.items[pointer].text;
                    } else {
                        // Not a candidate, and can never become one.
                        equalities.clearRetainingCapacity();
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
                    if ((last_equality.len != 0) and
                        ((pre_ins and pre_del and post_ins and post_del) or
                            ((last_equality.len < dmp.config.diff_edit_cost / 2) and
                                (@as(Unit, @intFromBool(pre_ins)) + @as(Unit, @intFromBool(pre_del)) + @as(Unit, @intFromBool(post_ins)) + @as(Unit, @intFromBool(post_del)) == 3))))
                    {
                        // Duplicate record.
                        try diffs.ensureUnusedCapacity(allocator, 1);
                        diffs.insertAssumeCapacity(
                            equalities.items[equalities.items.len - 1],
                            .{
                                .operation = .delete,
                                .text = try allocator.dupe(Unit, last_equality),
                            },
                        );
                        // Change second copy to insert.
                        diffs.items[equalities.items[equalities.items.len - 1] + 1].operation = .insert;
                        _ = equalities.pop(); // Throw away the equality we just deleted.
                        last_equality = "";
                        if (pre_ins and pre_del) {
                            // No changes made which could affect previous entry, keep going.
                            post_ins = true;
                            post_del = true;
                            equalities.clearRetainingCapacity();
                        } else {
                            if (equalities.items.len > 0) {
                                _ = equalities.pop();
                            }

                            ipointer = if (equalities.items.len > 0) @intCast(equalities.items[equalities.items.len - 1]) else -1;
                            post_ins = false;
                            post_del = false;
                        }
                        changes = true;
                    }
                }
                ipointer += 1;
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
        fn diffCommonOverlap(text1_in: []const Unit, text2_in: []const Unit) usize {
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
            if (std.mem.eql(Unit, text1, text2)) {
                return text_length;
            }

            // Start by looking for a single character match
            // and increase length until no match is found.
            // Performance analysis: https://neil.fraser.name/news/2010/11/04/
            var best: usize = 0;
            var length: usize = 1;
            while (true) {
                const pattern = text1[text_length - length ..];
                const found = std.mem.indexOf(Unit, text2, pattern) orelse
                    return best;

                length += found;

                if (found == 0 or std.mem.eql(Unit, text1[text_length - length ..], text2[0..length])) {
                    best = length;
                    length += 1;
                }
            }
        }

        // DONE [✅]: Allocate all text in diffs to
        // not cause segfault while freeing

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

        fn testDiffHalfMatch(
            allocator: std.mem.Allocator,
            params: struct {
                dmp: DiffMatchPatch,
                before: []const Unit,
                after: []const Unit,
                expected: ?HalfMatchResult,
            },
        ) !void {
            const maybe_result = try params.dmp.diffHalfMatch(allocator, params.before, params.after);
            defer if (maybe_result) |result| result.deinit(allocator);
            try testing.expectEqualDeep(params.expected, maybe_result);
        }

        test diffHalfMatch {
            const one_timeout: DiffMatchPatch = .{ .config = .{ .diff_timeout = 1 } };

            // No match #1
            try checkAllAllocationFailures(testing.allocator, testDiffHalfMatch, .{.{
                .dmp = one_timeout,
                .before = "1234567890",
                .after = "abcdef",
                .expected = null,
            }});

            // No match #2
            try checkAllAllocationFailures(testing.allocator, testDiffHalfMatch, .{.{
                .dmp = one_timeout,
                .before = "12345",
                .after = "23",
                .expected = null,
            }});

            // Single matches
            try checkAllAllocationFailures(testing.allocator, testDiffHalfMatch, .{.{
                .dmp = one_timeout,
                .before = "1234567890",
                .after = "a345678z",
                .expected = .{
                    .prefix_before = "12",
                    .suffix_before = "90",
                    .prefix_after = "a",
                    .suffix_after = "z",
                    .common_middle = "345678",
                },
            }});

            // Single Match #2
            try checkAllAllocationFailures(testing.allocator, testDiffHalfMatch, .{.{
                .dmp = one_timeout,
                .before = "a345678z",
                .after = "1234567890",
                .expected = .{
                    .prefix_before = "a",
                    .suffix_before = "z",
                    .prefix_after = "12",
                    .suffix_after = "90",
                    .common_middle = "345678",
                },
            }});

            // Single Match #3
            try checkAllAllocationFailures(testing.allocator, testDiffHalfMatch, .{.{
                .dmp = one_timeout,
                .before = "abc56789z",
                .after = "1234567890",
                .expected = .{
                    .prefix_before = "abc",
                    .suffix_before = "z",
                    .prefix_after = "1234",
                    .suffix_after = "0",
                    .common_middle = "56789",
                },
            }});

            // Single Match #4
            try checkAllAllocationFailures(testing.allocator, testDiffHalfMatch, .{.{
                .dmp = one_timeout,
                .before = "a23456xyz",
                .after = "1234567890",
                .expected = .{
                    .prefix_before = "a",
                    .suffix_before = "xyz",
                    .prefix_after = "1",
                    .suffix_after = "7890",
                    .common_middle = "23456",
                },
            }});

            // Multiple matches #1
            try checkAllAllocationFailures(testing.allocator, testDiffHalfMatch, .{.{
                .dmp = one_timeout,
                .before = "121231234123451234123121",
                .after = "a1234123451234z",
                .expected = .{
                    .prefix_before = "12123",
                    .suffix_before = "123121",
                    .prefix_after = "a",
                    .suffix_after = "z",
                    .common_middle = "1234123451234",
                },
            }});

            // Multiple Matches #2
            try checkAllAllocationFailures(testing.allocator, testDiffHalfMatch, .{.{
                .dmp = one_timeout,
                .before = "x-=-=-=-=-=-=-=-=-=-=-=-=",
                .after = "xx-=-=-=-=-=-=-=",
                .expected = .{
                    .prefix_before = "",
                    .suffix_before = "-=-=-=-=-=",
                    .prefix_after = "x",
                    .suffix_after = "",
                    .common_middle = "x-=-=-=-=-=-=-=",
                },
            }});

            // Multiple Matches #3
            try checkAllAllocationFailures(testing.allocator, testDiffHalfMatch, .{.{
                .dmp = one_timeout,
                .before = "-=-=-=-=-=-=-=-=-=-=-=-=y",
                .after = "-=-=-=-=-=-=-=yy",
                .expected = .{
                    .prefix_before = "-=-=-=-=-=",
                    .suffix_before = "",
                    .prefix_after = "",
                    .suffix_after = "y",
                    .common_middle = "-=-=-=-=-=-=-=y",
                },
            }});

            // Other cases

            // Optimal diff would be -q+x=H-i+e=lloHe+Hu=llo-Hew+y not -qHillo+x=HelloHe-w+Hulloy
            // Non-optimal halfmatch
            try checkAllAllocationFailures(testing.allocator, testDiffHalfMatch, .{.{
                .dmp = one_timeout,
                .before = "qHilloHelloHew",
                .after = "xHelloHeHulloy",
                .expected = .{
                    .prefix_before = "qHillo",
                    .suffix_before = "w",
                    .prefix_after = "x",
                    .suffix_after = "Hulloy",
                    .common_middle = "HelloHe",
                },
            }});

            // Non-optimal halfmatch
            try checkAllAllocationFailures(testing.allocator, testDiffHalfMatch, .{.{
                .dmp = .{ .config = .{ .diff_timeout = 0 } },
                .before = "qHilloHelloHew",
                .after = "xHelloHeHulloy",
                .expected = null,
            }});
        }

        test diffLinesToChars {
            const allocator = testing.allocator;
            // Convert lines down to characters.
            var tmp_array_list: std.ArrayListUnmanaged([]const Unit) = .empty;
            defer tmp_array_list.deinit(allocator);
            try tmp_array_list.append(allocator, "");
            try tmp_array_list.append(allocator, "alpha\n");
            try tmp_array_list.append(allocator, "beta\n");

            var result = try diffLinesToChars(allocator, "alpha\nbeta\nalpha\n", "beta\nalpha\nbeta\n");
            try testing.expectEqualStrings("\u{0001}\u{0002}\u{0001}", result.chars_1); // Shared lines #1
            try testing.expectEqualStrings("\u{0002}\u{0001}\u{0002}", result.chars_2); // Shared lines #2
            try testing.expectEqualDeep(tmp_array_list.items, result.line_array.items); // Shared lines #3

            tmp_array_list.clearRetainingCapacity();
            try tmp_array_list.append(allocator, "");
            try tmp_array_list.append(allocator, "alpha\r\n");
            try tmp_array_list.append(allocator, "beta\r\n");
            try tmp_array_list.append(allocator, "\r\n");
            result.deinit(allocator);

            result = try diffLinesToChars(allocator, "", "alpha\r\nbeta\r\n\r\n\r\n");
            try testing.expectEqualStrings("", result.chars_1); // Empty string and blank lines #1
            try testing.expectEqualStrings("\u{0001}\u{0002}\u{0003}\u{0003}", result.chars_2); // Empty string and blank lines #2
            try testing.expectEqualDeep(tmp_array_list.items, result.line_array.items); // Empty string and blank lines #3

            tmp_array_list.clearRetainingCapacity();
            try tmp_array_list.append(allocator, "");
            try tmp_array_list.append(allocator, "a");
            try tmp_array_list.append(allocator, "b");
            result.deinit(allocator);

            result = try diffLinesToChars(allocator, "a", "b");
            try testing.expectEqualStrings("\u{0001}", result.chars_1); // No linebreaks #1.
            try testing.expectEqualStrings("\u{0002}", result.chars_2); // No linebreaks #2.
            try testing.expectEqualDeep(tmp_array_list.items, result.line_array.items); // No linebreaks #3.
            result.deinit(allocator);

            // TODO: More than 256 to reveal any 8-bit limitations but this requires
            // some unicode logic that I don't want to deal with
            //
            // Casting to Unicode is straightforward and should sort correctly, I'm
            // more concerned about the weird behavior when the 'char' is equal to a
            // newline.  Uncomment the EqualSlices below to see what I mean.
            // I think there's some cleanup logic in the actual linediff that should
            // take care of the problem, but I don't like it.

            const n: Unit = 255;
            tmp_array_list.clearRetainingCapacity();

            var line_list: std.ArrayListUnmanaged(Unit) = .empty;
            defer line_list.deinit(allocator);
            var char_list: std.ArrayListUnmanaged(Unit) = .empty;
            defer char_list.deinit(allocator);

            var i: Unit = 1;
            while (i < n) : (i += 1) {
                try tmp_array_list.append(allocator, &.{ i, '\n' });
                try line_list.appendSlice(allocator, &.{ i, '\n' });
                try char_list.append(allocator, i);
            }
            try testing.expectEqual(@as(usize, n - 1), tmp_array_list.items.len); // Test initialization fail #1
            try testing.expectEqual(@as(usize, n - 1), char_list.items.len); // Test initialization fail #2
            try tmp_array_list.insert(allocator, 0, "");
            result = try diffLinesToChars(allocator, line_list.items, "");
            defer result.deinit(allocator);
            // TODO: This isn't equal, should it be?
            // try testing.expectEqualSlices(Unit, char_list.items, result.chars_1);
            try testing.expectEqualStrings("", result.chars_2);
            // TODO this is wrong because of the max_value I think?
            // try testing.expectEqualDeep(tmp_array_list.items, result.line_array.items);
        }

        fn testDiffCharsToLines(
            allocator: std.mem.Allocator,
            params: struct {
                diffs: []const Diff,
                line_array: []const []const Unit,
                expected: []const Diff,
            },
        ) !void {
            var char_diffs: DiffList = try .initCapacity(allocator, params.diffs.len);
            defer deinitDiffList(allocator, &char_diffs);

            for (params.diffs) |item| {
                char_diffs.appendAssumeCapacity(.{ .operation = item.operation, .text = try allocator.dupe(Unit, item.text) });
            }

            var diffs = try diffCharsToLines(allocator, &char_diffs, params.line_array);
            defer deinitDiffList(allocator, &diffs);

            try testing.expectEqualDeep(params.expected, diffs.items);
        }

        test diffCharsToLines {
            // Convert chars up to lines.
            var diff_list: DiffList = .empty;
            defer deinitDiffList(testing.allocator, &diff_list);
            try diff_list.ensureTotalCapacity(testing.allocator, 2);
            diff_list.appendSliceAssumeCapacity(&.{
                .{ .operation = .equal, .text = try testing.allocator.dupe(Unit, "\u{0001}\u{0002}\u{0001}") },
                .{ .operation = .insert, .text = try testing.allocator.dupe(Unit, "\u{0002}\u{0001}\u{0002}") },
            });
            try checkAllAllocationFailures(testing.allocator, testDiffCharsToLines, .{.{
                .diffs = diff_list.items,
                .line_array = &[_][]const Unit{
                    "",
                    "alpha\n",
                    "beta\n",
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "alpha\nbeta\nalpha\n" },
                    .{ .operation = .insert, .text = "beta\nalpha\nbeta\n" },
                },
            }});

            // TODO: Implement exhaustive tests
        }

        fn testDiffCleanupMerge(allocator: std.mem.Allocator, params: struct {
            input: []const Diff,
            expected: []const Diff,
        }) !void {
            var diffs: DiffList = try .initCapacity(allocator, params.input.len);
            defer deinitDiffList(allocator, &diffs);

            for (params.input) |item| {
                diffs.appendAssumeCapacity(.{ .operation = item.operation, .text = try allocator.dupe(Unit, item.text) });
            }

            try diffCleanupMerge(allocator, &diffs);

            try testing.expectEqualDeep(params.expected, diffs.items);
        }

        test diffCleanupMerge {
            // Cleanup a messy diff.

            // No change case
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .delete, .text = "b" },
                    .{ .operation = .insert, .text = "c" },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .delete, .text = "b" },
                    .{ .operation = .insert, .text = "c" },
                },
            }});

            // Merge equalities
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .equal, .text = "b" },
                    .{ .operation = .equal, .text = "c" },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "abc" },
                },
            }});

            // Merge deletions
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "a" },
                    .{ .operation = .delete, .text = "b" },
                    .{ .operation = .delete, .text = "c" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "abc" },
                },
            }});

            // Merge insertions
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .insert, .text = "a" },
                    .{ .operation = .insert, .text = "b" },
                    .{ .operation = .insert, .text = "c" },
                },
                .expected = &.{
                    .{ .operation = .insert, .text = "abc" },
                },
            }});

            // Merge interweave
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "a" },
                    .{ .operation = .insert, .text = "b" },
                    .{ .operation = .delete, .text = "c" },
                    .{ .operation = .insert, .text = "d" },
                    .{ .operation = .equal, .text = "e" },
                    .{ .operation = .equal, .text = "f" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "ac" },
                    .{ .operation = .insert, .text = "bd" },
                    .{ .operation = .equal, .text = "ef" },
                },
            }});

            // Prefix and suffix detection
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "a" },
                    .{ .operation = .insert, .text = "abc" },
                    .{ .operation = .delete, .text = "dc" },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .delete, .text = "d" },
                    .{ .operation = .insert, .text = "b" },
                    .{ .operation = .equal, .text = "c" },
                },
            }});

            // Prefix and suffix detection with equalities
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "x" },
                    .{ .operation = .delete, .text = "a" },
                    .{ .operation = .insert, .text = "abc" },
                    .{ .operation = .delete, .text = "dc" },
                    .{ .operation = .equal, .text = "y" },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "xa" },
                    .{ .operation = .delete, .text = "d" },
                    .{ .operation = .insert, .text = "b" },
                    .{ .operation = .equal, .text = "cy" },
                },
            }});

            // Slide edit left
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .insert, .text = "ba" },
                    .{ .operation = .equal, .text = "c" },
                },
                .expected = &.{
                    .{ .operation = .insert, .text = "ab" },
                    .{ .operation = .equal, .text = "ac" },
                },
            }});

            // Slide edit right
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "c" },
                    .{ .operation = .insert, .text = "ab" },
                    .{ .operation = .equal, .text = "a" },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "ca" },
                    .{ .operation = .insert, .text = "ba" },
                },
            }});

            // Slide edit left recursive
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .delete, .text = "b" },
                    .{ .operation = .equal, .text = "c" },
                    .{ .operation = .delete, .text = "ac" },
                    .{ .operation = .equal, .text = "x" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "abc" },
                    .{ .operation = .equal, .text = "acx" },
                },
            }});

            // Slide edit right recursive
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "x" },
                    .{ .operation = .delete, .text = "ca" },
                    .{ .operation = .equal, .text = "c" },
                    .{ .operation = .delete, .text = "b" },
                    .{ .operation = .equal, .text = "a" },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "xca" },
                    .{ .operation = .delete, .text = "cba" },
                },
            }});

            // Empty merge
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "b" },
                    .{ .operation = .insert, .text = "ab" },
                    .{ .operation = .equal, .text = "c" },
                },
                .expected = &.{
                    .{ .operation = .insert, .text = "a" },
                    .{ .operation = .equal, .text = "bc" },
                },
            }});

            // Empty equality
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupMerge, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "" },
                    .{ .operation = .insert, .text = "a" },
                    .{ .operation = .equal, .text = "b" },
                },
                .expected = &.{
                    .{ .operation = .insert, .text = "a" },
                    .{ .operation = .equal, .text = "b" },
                },
            }});
        }

        fn testDiffCleanupSemanticLossless(
            allocator: std.mem.Allocator,
            params: struct {
                input: []const Diff,
                expected: []const Diff,
            },
        ) !void {
            var diffs: DiffList = try .initCapacity(allocator, params.input.len);
            defer deinitDiffList(allocator, &diffs);

            for (params.input) |item| {
                diffs.appendAssumeCapacity(.{ .operation = item.operation, .text = try allocator.dupe(Unit, item.text) });
            }

            try diffCleanupSemanticLossless(allocator, &diffs);

            try testing.expectEqualDeep(params.expected, diffs.items);
        }

        fn sliceToDiffList(allocator: Allocator, diff_slice: []const Diff) !DiffList {
            var diff_list: DiffList = .empty;
            errdefer deinitDiffList(allocator, &diff_list);
            try diff_list.ensureTotalCapacity(allocator, diff_slice.len);
            for (diff_slice) |d| {
                diff_list.appendAssumeCapacity(.{
                    .operation = d.operation,
                    .text = try allocator.dupe(Unit, d.text),
                });
            }
            return diff_list;
        }

        test diffCleanupSemanticLossless {
            // Null case
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemanticLossless, .{.{
                .input = &[_]Diff{},
                .expected = &[_]Diff{},
            }});

            //defer deinitDiffList(allocator, &diffs);
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemanticLossless, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "AAA\r\n\r\nBBB" },
                    .{ .operation = .insert, .text = "\r\nDDD\r\n\r\nBBB" },
                    .{ .operation = .equal, .text = "\r\nEEE" },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "AAA\r\n\r\n" },
                    .{ .operation = .insert, .text = "BBB\r\nDDD\r\n\r\n" },
                    .{ .operation = .equal, .text = "BBB\r\nEEE" },
                },
            }});

            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemanticLossless, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "AAA\r\nBBB" },
                    .{ .operation = .insert, .text = " DDD\r\nBBB" },
                    .{ .operation = .equal, .text = " EEE" },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "AAA\r\n" },
                    .{ .operation = .insert, .text = "BBB DDD\r\n" },
                    .{ .operation = .equal, .text = "BBB EEE" },
                },
            }});

            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemanticLossless, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "The c" },
                    .{ .operation = .insert, .text = "ow and the c" },
                    .{ .operation = .equal, .text = "at." },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "The " },
                    .{ .operation = .insert, .text = "cow and the " },
                    .{ .operation = .equal, .text = "cat." },
                },
            }});

            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemanticLossless, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "The-c" },
                    .{ .operation = .insert, .text = "ow-and-the-c" },
                    .{ .operation = .equal, .text = "at." },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "The-" },
                    .{ .operation = .insert, .text = "cow-and-the-" },
                    .{ .operation = .equal, .text = "cat." },
                },
            }});

            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemanticLossless, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .delete, .text = "a" },
                    .{ .operation = .equal, .text = "ax" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "a" },
                    .{ .operation = .equal, .text = "aax" },
                },
            }});

            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemanticLossless, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "xa" },
                    .{ .operation = .delete, .text = "a" },
                    .{ .operation = .equal, .text = "a" },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "xaa" },
                    .{ .operation = .delete, .text = "a" },
                },
            }});

            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemanticLossless, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "The xxx. The " },
                    .{ .operation = .insert, .text = "zzz. The " },
                    .{ .operation = .equal, .text = "yyy." },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "The xxx." },
                    .{ .operation = .insert, .text = " The zzz." },
                    .{ .operation = .equal, .text = " The yyy." },
                },
            }});
        }

        fn rebuildtexts(allocator: std.mem.Allocator, diffs: DiffList) ![2][]const Unit {
            var text: [2]std.ArrayListUnmanaged(Unit) = .{ .empty, .empty };
            errdefer {
                text[0].deinit(allocator);
                text[1].deinit(allocator);
            }

            for (diffs.items) |myDiff| {
                if (myDiff.operation != .insert) {
                    try text[0].appendSlice(allocator, myDiff.text);
                }
                if (myDiff.operation != .delete) {
                    try text[1].appendSlice(allocator, myDiff.text);
                }
            }

            const first = try text[0].toOwnedSlice(allocator);
            errdefer allocator.free(first);

            const second = try text[1].toOwnedSlice(allocator);
            errdefer allocator.free(second);

            return .{ first, second };
        }

        fn testRebuildTexts(allocator: Allocator, diffs: DiffList, params: struct {
            before: []const Unit,
            after: []const Unit,
        }) !void {
            const texts = try rebuildtexts(allocator, diffs);
            defer {
                allocator.free(texts[0]);
                allocator.free(texts[1]);
            }
            try testing.expectEqualStrings(params.before, texts[0]);
            try testing.expectEqualStrings(params.after, texts[1]);
        }

        test rebuildtexts {
            {
                var diffs = try sliceToDiffList(testing.allocator, &.{
                    .{ .operation = .insert, .text = "abcabc" },
                    .{ .operation = .equal, .text = "defdef" },
                    .{ .operation = .delete, .text = "ghighi" },
                });
                defer deinitDiffList(testing.allocator, &diffs);
                try checkAllAllocationFailures(testing.allocator, testRebuildTexts, .{
                    diffs,
                    .{
                        .before = "defdefghighi",
                        .after = "abcabcdefdef",
                    },
                });
            }
            {
                var diffs = try sliceToDiffList(testing.allocator, &.{
                    .{ .operation = .insert, .text = "xxx" },
                    .{ .operation = .delete, .text = "yyy" },
                });
                defer deinitDiffList(testing.allocator, &diffs);
                try checkAllAllocationFailures(testing.allocator, testRebuildTexts, .{
                    diffs,
                    .{
                        .before = "yyy",
                        .after = "xxx",
                    },
                });
            }
            {
                var diffs = try sliceToDiffList(testing.allocator, &.{
                    .{ .operation = .equal, .text = "xyz" },
                    .{ .operation = .equal, .text = "pdq" },
                });
                defer deinitDiffList(testing.allocator, &diffs);
                try checkAllAllocationFailures(testing.allocator, testRebuildTexts, .{
                    diffs,
                    .{
                        .before = "xyzpdq",
                        .after = "xyzpdq",
                    },
                });
            }
        }

        fn testDiffBisect(
            allocator: std.mem.Allocator,
            params: struct {
                dmp: DiffMatchPatch,
                before: []const Unit,
                after: []const Unit,
                deadline: u64,
                expected: []const Diff,
            },
        ) !void {
            var diffs = try params.dmp.diffBisect(allocator, params.before, params.after, params.deadline);
            defer deinitDiffList(allocator, &diffs);
            try testing.expectEqualDeep(params.expected, diffs.items);
        }

        test diffBisect {
            const this: DiffMatchPatch = .{ .config = .{ .diff_timeout = 0 } };

            const a = "cat";
            const b = "map";

            // Normal
            try checkAllAllocationFailures(testing.allocator, testDiffBisect, .{.{
                .dmp = this,
                .before = a,
                .after = b,
                .deadline = std.math.maxInt(u64), // Travis TODO not sure if maxInt(u64) is correct for  DateTime.MaxValue
                .expected = &.{
                    .{ .operation = .delete, .text = "c" },
                    .{ .operation = .insert, .text = "m" },
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .delete, .text = "t" },
                    .{ .operation = .insert, .text = "p" },
                },
            }});

            // Timeout
            try checkAllAllocationFailures(testing.allocator, testDiffBisect, .{.{
                .dmp = this,
                .before = a,
                .after = b,
                .deadline = 0, // Travis TODO not sure if 0 is correct for  DateTime.MinValue
                .expected = &.{
                    .{ .operation = .delete, .text = "cat" },
                    .{ .operation = .insert, .text = "map" },
                },
            }});
        }

        fn diffHalfMatchLeak(allocator: Allocator) !void {
            const dmp: DiffMatchPatch = .default;
            const text1 = "The quick brown fox jumps over the lazy dog.";
            const text2 = "That quick brown fox jumped over a lazy dog.";
            var diffs = try dmp.diff(allocator, text2, text1, true);
            deinitDiffList(allocator, &diffs);
        }

        test "diffHalfMatch leak regression test" {
            try checkAllAllocationFailures(testing.allocator, diffHalfMatchLeak, .{});
        }

        fn testDiff(
            allocator: std.mem.Allocator,
            params: struct {
                dmp: DiffMatchPatch,
                before: []const Unit,
                after: []const Unit,
                check_lines: bool,
                expected: []const Diff,
            },
        ) !void {
            var diffs = try params.dmp.diff(allocator, params.before, params.after, params.check_lines);
            defer deinitDiffList(allocator, &diffs);
            try testing.expectEqualDeep(params.expected, diffs.items);
        }

        test diff {
            const this: DiffMatchPatch = .{ .config = .{ .diff_timeout = 0 } };

            //  Null case.
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "",
                .after = "",
                .check_lines = false,
                .expected = &[_]Diff{},
            }});

            //  Equality.
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "abc",
                .after = "abc",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .equal, .text = "abc" },
                },
            }});

            // Simple insertion.
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "abc",
                .after = "ab123c",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .equal, .text = "ab" },
                    .{ .operation = .insert, .text = "123" },
                    .{ .operation = .equal, .text = "c" },
                },
            }});

            // Simple deletion.
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "a123bc",
                .after = "abc",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .delete, .text = "123" },
                    .{ .operation = .equal, .text = "bc" },
                },
            }});

            // Two insertions.
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "abc",
                .after = "a123b456c",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .insert, .text = "123" },
                    .{ .operation = .equal, .text = "b" },
                    .{ .operation = .insert, .text = "456" },
                    .{ .operation = .equal, .text = "c" },
                },
            }});

            // Two deletions.
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "a123b456c",
                .after = "abc",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .delete, .text = "123" },
                    .{ .operation = .equal, .text = "b" },
                    .{ .operation = .delete, .text = "456" },
                    .{ .operation = .equal, .text = "c" },
                },
            }});

            // Simple case #1
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "a",
                .after = "b",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .delete, .text = "a" },
                    .{ .operation = .insert, .text = "b" },
                },
            }});

            // Simple case #2
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "Apples are a fruit.",
                .after = "Bananas are also fruit.",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .delete, .text = "Apple" },
                    .{ .operation = .insert, .text = "Banana" },
                    .{ .operation = .equal, .text = "s are a" },
                    .{ .operation = .insert, .text = "lso" },
                    .{ .operation = .equal, .text = " fruit." },
                },
            }});

            // Simple case #3
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "ax\t",
                .after = "\u{0680}x\x00",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .delete, .text = "a" },
                    .{ .operation = .insert, .text = "\u{0680}" },
                    .{ .operation = .equal, .text = "x" },
                    .{ .operation = .delete, .text = "\t" },
                    .{ .operation = .insert, .text = "\x00" },
                },
            }});

            // Overlap #1
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "1ayb2",
                .after = "abxab",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .delete, .text = "1" },
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .delete, .text = "y" },
                    .{ .operation = .equal, .text = "b" },
                    .{ .operation = .delete, .text = "2" },
                    .{ .operation = .insert, .text = "xab" },
                },
            }});

            // Overlap #2
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "abcy",
                .after = "xaxcxabc",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .insert, .text = "xaxcx" },
                    .{ .operation = .equal, .text = "abc" },
                    .{ .operation = .delete, .text = "y" },
                },
            }});

            // Overlap #3
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "ABCDa=bcd=efghijklmnopqrsEFGHIJKLMNOefg",
                .after = "a-bcd-efghijklmnopqrs",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .delete, .text = "ABCD" },
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .delete, .text = "=" },
                    .{ .operation = .insert, .text = "-" },
                    .{ .operation = .equal, .text = "bcd" },
                    .{ .operation = .delete, .text = "=" },
                    .{ .operation = .insert, .text = "-" },
                    .{ .operation = .equal, .text = "efghijklmnopqrs" },
                    .{ .operation = .delete, .text = "EFGHIJKLMNOefg" },
                },
            }});

            // Large equality
            try checkAllAllocationFailures(testing.allocator, testDiff, .{.{
                .dmp = this,
                .before = "a [[Pennsylvania]] and [[New",
                .after = " and [[Pennsylvania]]",
                .check_lines = false,
                .expected = &.{
                    .{ .operation = .insert, .text = " " },
                    .{ .operation = .equal, .text = "a" },
                    .{ .operation = .insert, .text = "nd" },
                    .{ .operation = .equal, .text = " [[Pennsylvania]]" },
                    .{ .operation = .delete, .text = " and [[New" },
                },
            }});

            const allocator = testing.allocator;
            // TODO these tests should be checked for allocation failure

            // Increase the text lengths by 1024 times to ensure a timeout.
            {
                const a = "`Twas brillig, and the slithy toves\nDid gyre and gimble in the wabe:\nAll mimsy were the borogoves,\nAnd the mome raths outgrabe.\n" ** 1024;
                const b = "I am the very model of a modern major general,\nI've information vegetable, animal, and mineral,\nI know the kings of England, and I quote the fights historical,\nFrom Marathon to Waterloo, in order categorical.\n" ** 1024;

                const with_timout: DiffMatchPatch = .{
                    .config = .{ .diff_timeout = 100 }, // 100ms
                };

                const start_time = std.time.milliTimestamp();
                {
                    var time_diff = try with_timout.diff(allocator, a, b, false);
                    defer deinitDiffList(allocator, &time_diff);
                }
                const end_time = std.time.milliTimestamp();

                // Test that we took at least the timeout period.
                try testing.expect(with_timout.config.diff_timeout <= end_time - start_time); // diff: Timeout min.
                // Test that we didn't take forever (be forgiving).
                // Theoretically this test could fail very occasionally if the
                // OS task swaps or locks up for a second at the wrong moment.
                try testing.expect((with_timout.config.diff_timeout) * 10000 * 2 > end_time - start_time); // diff: Timeout max.
            }

            {
                // Test the linemode speedup.
                // Must be long to pass the 100 char cutoff.
                const a = "1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n";
                const b = "abcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\n";

                var diff_checked = try this.diff(allocator, a, b, true);
                defer deinitDiffList(allocator, &diff_checked);

                var diff_unchecked = try this.diff(allocator, a, b, false);
                defer deinitDiffList(allocator, &diff_unchecked);

                try testing.expectEqualDeep(diff_checked.items, diff_unchecked.items); // diff: Simple line-mode.
            }

            {
                const a = "1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890";
                const b = "abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij";

                var diff_checked = try this.diff(allocator, a, b, true);
                defer deinitDiffList(allocator, &diff_checked);

                var diff_unchecked = try this.diff(allocator, a, b, false);
                defer deinitDiffList(allocator, &diff_unchecked);

                try testing.expectEqualDeep(diff_checked.items, diff_unchecked.items); // diff: Single line-mode.
            }

            {
                // diff: Overlap line-mode.
                const a = "1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n";
                const b = "abcdefghij\n1234567890\n1234567890\n1234567890\nabcdefghij\n1234567890\n1234567890\n1234567890\nabcdefghij\n1234567890\n1234567890\n1234567890\nabcdefghij\n";

                var diffs_linemode = try this.diff(allocator, a, b, true);
                defer deinitDiffList(allocator, &diffs_linemode);

                const texts_linemode = try rebuildtexts(allocator, diffs_linemode);
                defer {
                    allocator.free(texts_linemode[0]);
                    allocator.free(texts_linemode[1]);
                }

                var diffs_textmode = try this.diff(allocator, a, b, false);
                defer deinitDiffList(allocator, &diffs_textmode);

                const texts_textmode = try rebuildtexts(allocator, diffs_textmode);
                defer {
                    allocator.free(texts_textmode[0]);
                    allocator.free(texts_textmode[1]);
                }

                try testing.expectEqualStrings(texts_textmode[0], texts_linemode[0]);
                try testing.expectEqualStrings(texts_textmode[1], texts_linemode[1]);
            }
        }

        fn testDiffLineMode(
            allocator: Allocator,
            dmp: *DiffMatchPatch,
            before: []const Unit,
            after: []const Unit,
        ) !void {
            dmp.config.diff_check_lines_over = 20;
            var diff_checked = try dmp.diff(allocator, before, after, true);
            defer deinitDiffList(allocator, &diff_checked);

            var diff_unchecked = try dmp.diff(allocator, before, after, false);
            defer deinitDiffList(allocator, &diff_unchecked);

            try testing.expectEqualDeep(diff_checked.items, diff_unchecked.items); // diff: Simple line-mode.
            dmp.config.diff_check_lines_over = 100;
        }

        test "diffLineMode" {
            var dmp: DiffMatchPatch = .{ .config = .{ .diff_timeout = 0 } };
            try checkAllAllocationFailures(
                testing.allocator,
                testDiffLineMode,

                .{
                    &dmp,
                    "1234567890\n1234567890\n1234567890\n",
                    "abcdefghij\nabcdefghij\nabcdefghij\n",
                },
            );
        }

        fn testDiffCleanupSemantic(
            allocator: std.mem.Allocator,
            params: struct {
                input: []const Diff,
                expected: []const Diff,
            },
        ) !void {
            var diffs: DiffList = try .initCapacity(allocator, params.input.len);
            defer deinitDiffList(allocator, &diffs);

            for (params.input) |item| {
                diffs.appendAssumeCapacity(.{ .operation = item.operation, .text = try allocator.dupe(Unit, item.text) });
            }

            try diffCleanupSemantic(allocator, &diffs);

            try testing.expectEqualDeep(params.expected, diffs.items);
        }

        test diffCleanupSemantic {
            // Null case.
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemantic, .{.{
                .input = &[_]Diff{},
                .expected = &[_]Diff{},
            }});

            // No elimination #1
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemantic, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "ab" },
                    .{ .operation = .insert, .text = "cd" },
                    .{ .operation = .equal, .text = "12" },
                    .{ .operation = .delete, .text = "e" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "ab" },
                    .{ .operation = .insert, .text = "cd" },
                    .{ .operation = .equal, .text = "12" },
                    .{ .operation = .delete, .text = "e" },
                },
            }});

            // No elimination #2
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemantic, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "abc" },
                    .{ .operation = .insert, .text = "ABC" },
                    .{ .operation = .equal, .text = "1234" },
                    .{ .operation = .delete, .text = "wxyz" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "abc" },
                    .{ .operation = .insert, .text = "ABC" },
                    .{ .operation = .equal, .text = "1234" },
                    .{ .operation = .delete, .text = "wxyz" },
                },
            }});

            // Simple elimination
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemantic, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "a" },
                    .{ .operation = .equal, .text = "b" },
                    .{ .operation = .delete, .text = "c" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "abc" },
                    .{ .operation = .insert, .text = "b" },
                },
            }});

            // Backpass elimination
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemantic, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "ab" },
                    .{ .operation = .equal, .text = "cd" },
                    .{ .operation = .delete, .text = "e" },
                    .{ .operation = .equal, .text = "f" },
                    .{ .operation = .insert, .text = "g" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "abcdef" },
                    .{ .operation = .insert, .text = "cdfg" },
                },
            }});

            // Multiple elimination
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemantic, .{.{
                .input = &.{
                    .{ .operation = .insert, .text = "1" },
                    .{ .operation = .equal, .text = "A" },
                    .{ .operation = .delete, .text = "B" },
                    .{ .operation = .insert, .text = "2" },
                    .{ .operation = .equal, .text = "_" },
                    .{ .operation = .insert, .text = "1" },
                    .{ .operation = .equal, .text = "A" },
                    .{ .operation = .delete, .text = "B" },
                    .{ .operation = .insert, .text = "2" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "AB_AB" },
                    .{ .operation = .insert, .text = "1A2_1A2" },
                },
            }});

            // Word boundaries
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemantic, .{.{
                .input = &.{
                    .{ .operation = .equal, .text = "The c" },
                    .{ .operation = .delete, .text = "ow and the c" },
                    .{ .operation = .equal, .text = "at." },
                },
                .expected = &.{
                    .{ .operation = .equal, .text = "The " },
                    .{ .operation = .delete, .text = "cow and the " },
                    .{ .operation = .equal, .text = "cat." },
                },
            }});

            // No overlap elimination
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemantic, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "abcxx" },
                    .{ .operation = .insert, .text = "xxdef" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "abcxx" },
                    .{ .operation = .insert, .text = "xxdef" },
                },
            }});

            // Overlap elimination
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemantic, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "abcxxx" },
                    .{ .operation = .insert, .text = "xxxdef" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "abc" },
                    .{ .operation = .equal, .text = "xxx" },
                    .{ .operation = .insert, .text = "def" },
                },
            }});

            // Reverse overlap elimination
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemantic, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "xxxabc" },
                    .{ .operation = .insert, .text = "defxxx" },
                },
                .expected = &.{
                    .{ .operation = .insert, .text = "def" },
                    .{ .operation = .equal, .text = "xxx" },
                    .{ .operation = .delete, .text = "abc" },
                },
            }});

            // Two overlap eliminations
            try checkAllAllocationFailures(testing.allocator, testDiffCleanupSemantic, .{.{
                .input = &.{
                    .{ .operation = .delete, .text = "abcd1212" },
                    .{ .operation = .insert, .text = "1212efghi" },
                    .{ .operation = .equal, .text = "----" },
                    .{ .operation = .delete, .text = "A3" },
                    .{ .operation = .insert, .text = "3BC" },
                },
                .expected = &.{
                    .{ .operation = .delete, .text = "abcd" },
                    .{ .operation = .equal, .text = "1212" },
                    .{ .operation = .insert, .text = "efghi" },
                    .{ .operation = .equal, .text = "----" },
                    .{ .operation = .delete, .text = "A" },
                    .{ .operation = .equal, .text = "3" },
                    .{ .operation = .insert, .text = "BC" },
                },
            }});
        }

        fn testDiffCleanupEfficiency(
            allocator: Allocator,
            dmp: DiffMatchPatch,
            params: struct {
                input: []const Diff,
                expected: []const Diff,
            },
        ) !void {
            var diffs: DiffList = try .initCapacity(allocator, params.input.len);
            defer deinitDiffList(allocator, &diffs);
            for (params.input) |item| {
                diffs.appendAssumeCapacity(.{ .operation = item.operation, .text = try allocator.dupe(Unit, item.text) });
            }
            try dmp.diffCleanupEfficiency(allocator, &diffs);

            try testing.expectEqualDeep(params.expected, diffs.items);
        }

        test "diffCleanupEfficiency" {
            const allocator = testing.allocator;
            var dmp: DiffMatchPatch = .default;
            dmp.config.diff_edit_cost = 4;
            { // Null case.
                var diffs: DiffList = .empty;
                try dmp.diffCleanupEfficiency(allocator, &diffs);
                try testing.expectEqualDeep(DiffList.empty, diffs);
            }
            { // No elimination.
                const dslice: []const Diff = &.{
                    .{ .operation = .delete, .text = "ab" },
                    .{ .operation = .insert, .text = "12" },
                    .{ .operation = .equal, .text = "wxyz" },
                    .{ .operation = .delete, .text = "cd" },
                    .{ .operation = .insert, .text = "34" },
                };
                try checkAllAllocationFailures(
                    testing.allocator,
                    testDiffCleanupEfficiency,
                    .{
                        dmp,
                        .{ .input = dslice, .expected = dslice },
                    },
                );
            }
            { // Four-edit elimination.
                const dslice: []const Diff = &.{
                    .{ .operation = .delete, .text = "ab" },
                    .{ .operation = .insert, .text = "12" },
                    .{ .operation = .equal, .text = "xyz" },
                    .{ .operation = .delete, .text = "cd" },
                    .{ .operation = .insert, .text = "34" },
                };
                const d_after: []const Diff = &.{
                    .{ .operation = .delete, .text = "abxyzcd" },
                    .{ .operation = .insert, .text = "12xyz34" },
                };
                try checkAllAllocationFailures(
                    testing.allocator,
                    testDiffCleanupEfficiency,
                    .{
                        dmp,
                        .{ .input = dslice, .expected = d_after },
                    },
                );
            }
            { // Three-edit elimination.
                const dslice: []const Diff = &.{
                    .{ .operation = .insert, .text = "12" },
                    .{ .operation = .equal, .text = "x" },
                    .{ .operation = .delete, .text = "cd" },
                    .{ .operation = .insert, .text = "34" },
                };
                const d_after: []const Diff = &.{
                    .{ .operation = .delete, .text = "xcd" },
                    .{ .operation = .insert, .text = "12x34" },
                };
                try checkAllAllocationFailures(
                    testing.allocator,
                    testDiffCleanupEfficiency,
                    .{
                        dmp,
                        .{ .input = dslice, .expected = d_after },
                    },
                );
            }
            { // Backpass elimination.
                const dslice: []const Diff = &.{
                    .{ .operation = .delete, .text = "ab" },
                    .{ .operation = .insert, .text = "12" },
                    .{ .operation = .equal, .text = "xy" },
                    .{ .operation = .insert, .text = "34" },
                    .{ .operation = .equal, .text = "z" },
                    .{ .operation = .delete, .text = "cd" },
                    .{ .operation = .insert, .text = "56" },
                };
                const d_after: []const Diff = &.{
                    .{ .operation = .delete, .text = "abxyzcd" },
                    .{ .operation = .insert, .text = "12xy34z56" },
                };
                try checkAllAllocationFailures(
                    testing.allocator,
                    testDiffCleanupEfficiency,
                    .{
                        dmp,
                        .{ .input = dslice, .expected = d_after },
                    },
                );
            }
            { // High cost elimination.
                dmp.config.diff_edit_cost = 5;
                const dslice: []const Diff = &.{
                    .{ .operation = .delete, .text = "ab" },
                    .{ .operation = .insert, .text = "12" },
                    .{ .operation = .equal, .text = "wxyz" },
                    .{ .operation = .delete, .text = "cd" },
                    .{ .operation = .insert, .text = "34" },
                };
                const d_after: []const Diff = &.{
                    .{ .operation = .delete, .text = "abwxyzcd" },
                    .{ .operation = .insert, .text = "12wxyz34" },
                };
                try checkAllAllocationFailures(
                    testing.allocator,
                    testDiffCleanupEfficiency,
                    .{
                        dmp,
                        .{ .input = dslice, .expected = d_after },
                    },
                );
                dmp.config.diff_edit_cost = 4;
            }
        }

        /// https://github.com/ziglang/zig/pull/23042/files
        fn checkAllAllocationFailures(
            backing_allocator: std.mem.Allocator,
            comptime test_fn: anytype,
            extra_args: CheckAllAllocationFailuresTuples(@TypeOf(test_fn)).ExtraArgsTuple,
        ) !void {
            return std.testing.checkAllAllocationFailures(backing_allocator, test_fn, extra_args);
        }

        fn CheckAllAllocationFailuresTuples(comptime TestFn: type) struct {
            /// `std.meta.ArgsTuple(TestFn)`
            ArgsTuple: type,
            /// `std.meta.ArgsTuple(TestFn)` without the first argument
            ExtraArgsTuple: type,
        } {
            switch (@typeInfo(@typeInfo(TestFn).@"fn".return_type.?)) {
                .error_union => |info| {
                    if (info.payload != void) {
                        @compileError("Return type must be !void");
                    }
                },
                else => @compileError("Return type must be !void"),
            }

            const ArgsTuple = std.meta.ArgsTuple(TestFn);

            const fn_args_fields = std.meta.fields(ArgsTuple);
            if (fn_args_fields.len == 0 or fn_args_fields[0].type != std.mem.Allocator) {
                @compileError("The provided function must have an " ++ @typeName(std.mem.Allocator) ++ " as its first argument");
            }

            // remove the first tuple field (`std.mem.Allocator`)
            var extra_args_tuple_info = @typeInfo(ArgsTuple);
            var extra_args_fields = extra_args_tuple_info.@"struct".fields[1..].*;
            for (&extra_args_fields, 0..) |*extra_field, i| {
                extra_field.name = fn_args_fields[i].name;
            }
            extra_args_tuple_info.@"struct".fields = &extra_args_fields;
            const ExtraArgsTuple = @Type(extra_args_tuple_info);

            return .{
                .ArgsTuple = ArgsTuple,
                .ExtraArgsTuple = ExtraArgsTuple,
            };
        }
    };
}

const bun = @import("bun");
const StringHashMapUnmanaged = bun.StringHashMapUnmanaged;
