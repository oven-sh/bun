//! SIMD utilities for diff operations
//!
//! Provides vectorized operations for fast byte comparison and newline scanning.

const std = @import("std");
const builtin = @import("builtin");

/// Get the optimal vector length for the current CPU
pub fn getVectorLen(comptime T: type) comptime_int {
    return std.simd.suggestVectorLengthForCpu(T, builtin.cpu) orelse 16;
}

/// SIMD-accelerated byte equality check
/// Returns the index of the first differing byte, or the length if equal
pub fn firstDifference(a: []const u8, b: []const u8) usize {
    const min_len = @min(a.len, b.len);
    if (min_len == 0) return 0;

    const vec_len = comptime getVectorLen(u8);
    const Vec = @Vector(vec_len, u8);

    var i: usize = 0;

    // SIMD comparison for full vectors
    while (i + vec_len <= min_len) {
        const va: Vec = a[i..][0..vec_len].*;
        const vb: Vec = b[i..][0..vec_len].*;

        const ne = va != vb;
        const mask = @as(std.meta.Int(.unsigned, vec_len), @bitCast(ne));

        if (mask != 0) {
            // Found mismatch - find exact position
            return i + @ctz(mask);
        }
        i += vec_len;
    }

    // Scalar comparison for remainder
    while (i < min_len) : (i += 1) {
        if (a[i] != b[i]) return i;
    }

    return min_len;
}

/// SIMD-accelerated check if two slices are equal
pub fn slicesEqual(a: []const u8, b: []const u8) bool {
    if (a.len != b.len) return false;
    if (a.len == 0) return true;
    return firstDifference(a, b) == a.len;
}

/// SIMD-accelerated common prefix length
pub fn commonPrefixLen(a: []const u8, b: []const u8) usize {
    return firstDifference(a, b);
}

pub const FindNewlinesError = error{
    ContentTooLarge,
    OutOfMemory,
};

/// SIMD-accelerated newline finder
/// Appends indices of all '\n' characters to the output list
/// Returns error.ContentTooLarge if data exceeds u32 max (~4GB)
pub fn findNewlines(data: []const u8, positions: *std.array_list.Managed(u32)) FindNewlinesError!void {
    // Check data size limit (u32 max ~4GB)
    if (data.len > std.math.maxInt(u32)) {
        return FindNewlinesError.ContentTooLarge;
    }

    const vec_len = comptime getVectorLen(u8);
    const Vec = @Vector(vec_len, u8);
    const newline: Vec = @splat('\n');

    var i: usize = 0;

    // SIMD scan for full vectors
    while (i + vec_len <= data.len) {
        const chunk: Vec = data[i..][0..vec_len].*;
        const matches = chunk == newline;
        var mask = @as(std.meta.Int(.unsigned, vec_len), @bitCast(matches));

        while (mask != 0) {
            const offset = @ctz(mask);
            // Safe cast: we verified data.len <= u32 max above
            try positions.append(@intCast(i + offset));
            mask &= mask - 1; // Clear lowest set bit
        }

        i += vec_len;
    }

    // Scalar scan for remainder
    while (i < data.len) : (i += 1) {
        if (data[i] == '\n') {
            // Safe cast: we verified data.len <= u32 max above
            try positions.append(@intCast(i));
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

test "firstDifference identical" {
    const a = "hello world";
    const b = "hello world";
    try std.testing.expectEqual(a.len, firstDifference(a, b));
}

test "firstDifference early mismatch" {
    const a = "hello";
    const b = "hallo";
    try std.testing.expectEqual(@as(usize, 1), firstDifference(a, b));
}

test "firstDifference late mismatch" {
    const a = "hello world!";
    const b = "hello world?";
    try std.testing.expectEqual(@as(usize, 11), firstDifference(a, b));
}

test "firstDifference long strings" {
    const a = "a" ** 100 ++ "X" ++ "b" ** 100;
    const b = "a" ** 100 ++ "Y" ++ "b" ** 100;
    try std.testing.expectEqual(@as(usize, 100), firstDifference(a, b));
}

test "slicesEqual" {
    try std.testing.expect(slicesEqual("hello", "hello"));
    try std.testing.expect(!slicesEqual("hello", "hallo"));
    try std.testing.expect(!slicesEqual("hello", "hell"));
    try std.testing.expect(slicesEqual("", ""));
}

test "findNewlines" {
    var positions = std.array_list.Managed(u32).init(std.testing.allocator);
    defer positions.deinit();

    try findNewlines("line1\nline2\nline3\n", &positions);

    try std.testing.expectEqual(@as(usize, 3), positions.items.len);
    try std.testing.expectEqual(@as(u32, 5), positions.items[0]);
    try std.testing.expectEqual(@as(u32, 11), positions.items[1]);
    try std.testing.expectEqual(@as(u32, 17), positions.items[2]);
}

test "findNewlines long content" {
    // Test with content longer than SIMD vector size
    const content = "a" ** 50 ++ "\n" ++ "b" ** 50 ++ "\n";
    var positions = std.array_list.Managed(u32).init(std.testing.allocator);
    defer positions.deinit();

    try findNewlines(content, &positions);

    try std.testing.expectEqual(@as(usize, 2), positions.items.len);
    try std.testing.expectEqual(@as(u32, 50), positions.items[0]);
    try std.testing.expectEqual(@as(u32, 101), positions.items[1]);
}
