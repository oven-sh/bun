//! Line indexing for diff operations
//!
//! Provides zero-copy line indexing with hash computation for fast comparison.
//! Uses SIMD-accelerated operations where beneficial.

const std = @import("std");
// Note: This module does not need bun imports
const simd = @import("bun_diff_simd.zig");

/// A line is a view into the original buffer
pub const Line = struct {
    /// Offset from buffer start
    start: u32,
    /// Length of line (excluding newline)
    len: u32,
    /// Precomputed hash for fast comparison
    hash: u64,
};

/// Line index for a file - zero-copy view with precomputed hashes
pub const LineIndex = struct {
    /// Original content (not owned)
    content: []const u8,
    /// Array of line descriptors
    lines: []Line,
    /// Allocator used for lines array
    allocator: std.mem.Allocator,

    pub const Error = error{
        ContentTooLarge,
        OutOfMemory,
    };

    pub fn init(content: []const u8, allocator: std.mem.Allocator) Error!LineIndex {
        // Check content size limit (u32 max ~4GB)
        if (content.len > std.math.maxInt(u32)) {
            return Error.ContentTooLarge;
        }

        var lines = std.array_list.Managed(Line).init(allocator);
        errdefer lines.deinit();

        // Use SIMD-accelerated newline finding for large content
        if (content.len > 64) {
            var positions = std.array_list.Managed(u32).init(allocator);
            defer positions.deinit();

            try simd.findNewlines(content, &positions);

            var start: u32 = 0;
            for (positions.items) |newline_pos| {
                const line_len = newline_pos - start;
                const line_content = content[start..][0..line_len];
                try lines.append(.{
                    .start = start,
                    .len = line_len,
                    .hash = std.hash.Wyhash.hash(0, line_content),
                });
                start = newline_pos + 1;
            }

            // Handle last line without trailing newline
            if (start < content.len) {
                const last_len: u32 = @intCast(content.len - start);
                const line_content = content[start..][0..last_len];
                try lines.append(.{
                    .start = start,
                    .len = last_len,
                    .hash = std.hash.Wyhash.hash(0, line_content),
                });
            }
        } else {
            // Scalar path for small content
            var start: u32 = 0;
            var i: u32 = 0;

            while (i < content.len) : (i += 1) {
                if (content[i] == '\n') {
                    const line_len: u32 = i - start;
                    const line_content = content[start..][0..line_len];
                    try lines.append(.{
                        .start = start,
                        .len = line_len,
                        .hash = std.hash.Wyhash.hash(0, line_content),
                    });
                    start = i + 1;
                }
            }

            // Handle last line without trailing newline
            if (start < content.len) {
                const last_len: u32 = @intCast(content.len - start);
                const line_content = content[start..][0..last_len];
                try lines.append(.{
                    .start = start,
                    .len = last_len,
                    .hash = std.hash.Wyhash.hash(0, line_content),
                });
            }
        }

        return .{
            .content = content,
            .lines = try lines.toOwnedSlice(),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *LineIndex) void {
        self.allocator.free(self.lines);
    }

    /// Get the content of a line by index.
    /// Asserts that idx is within bounds.
    pub fn getLine(self: LineIndex, idx: usize) []const u8 {
        std.debug.assert(idx < self.lines.len);
        const l = self.lines[idx];
        std.debug.assert(l.start + l.len <= self.content.len);
        return self.content[l.start..][0..l.len];
    }

    /// Check if two lines are equal (hash first, then SIMD comparison).
    /// Asserts that both indices are within bounds.
    pub fn linesEqual(
        self: LineIndex,
        other: LineIndex,
        self_idx: usize,
        other_idx: usize,
    ) bool {
        std.debug.assert(self_idx < self.lines.len);
        std.debug.assert(other_idx < other.lines.len);

        const a = self.lines[self_idx];
        const b = other.lines[other_idx];

        // Fast path: hash mismatch
        if (a.hash != b.hash) return false;

        // Fast path: length mismatch
        if (a.len != b.len) return false;

        // SIMD comparison for actual content
        return simd.slicesEqual(self.getLine(self_idx), other.getLine(other_idx));
    }

    /// Number of lines
    pub fn len(self: LineIndex) usize {
        return self.lines.len;
    }
};

// =============================================================================
// Tests
// =============================================================================

test "LineIndex empty string" {
    const content = "";
    var idx = try LineIndex.init(content, std.testing.allocator);
    defer idx.deinit();
    try std.testing.expectEqual(@as(usize, 0), idx.len());
}

test "LineIndex single line no newline" {
    const content = "hello";
    var idx = try LineIndex.init(content, std.testing.allocator);
    defer idx.deinit();
    try std.testing.expectEqual(@as(usize, 1), idx.len());
    try std.testing.expectEqualStrings("hello", idx.getLine(0));
}

test "LineIndex multiple lines" {
    const content = "line1\nline2\nline3\n";
    var idx = try LineIndex.init(content, std.testing.allocator);
    defer idx.deinit();
    try std.testing.expectEqual(@as(usize, 3), idx.len());
    try std.testing.expectEqualStrings("line1", idx.getLine(0));
    try std.testing.expectEqualStrings("line2", idx.getLine(1));
    try std.testing.expectEqualStrings("line3", idx.getLine(2));
}

test "LineIndex equality" {
    const a_content = "same\ndifferent1\n";
    const b_content = "same\ndifferent2\n";

    var a = try LineIndex.init(a_content, std.testing.allocator);
    defer a.deinit();
    var b = try LineIndex.init(b_content, std.testing.allocator);
    defer b.deinit();

    try std.testing.expect(a.linesEqual(b, 0, 0)); // "same" == "same"
    try std.testing.expect(!a.linesEqual(b, 1, 1)); // "different1" != "different2"
}

test "LineIndex long content uses SIMD path" {
    // Content longer than 64 bytes to trigger SIMD path
    const content = "a" ** 30 ++ "\n" ++ "b" ** 30 ++ "\n" ++ "c" ** 30 ++ "\n";
    var idx = try LineIndex.init(content, std.testing.allocator);
    defer idx.deinit();

    try std.testing.expectEqual(@as(usize, 3), idx.len());
    try std.testing.expectEqual(@as(usize, 30), idx.getLine(0).len);
    try std.testing.expectEqual(@as(usize, 30), idx.getLine(1).len);
    try std.testing.expectEqual(@as(usize, 30), idx.getLine(2).len);
}
