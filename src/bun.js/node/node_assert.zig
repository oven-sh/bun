const std = @import("std");
const Allocator = std.mem.Allocator;

const DiffMatchPatch = @import("../../deps/diffz/DiffMatchPatch.zig");
const DiffError = DiffMatchPatch.DiffError;
pub const Diff = DiffMatchPatch.Diff;

const dmp = DiffMatchPatch{
    .diff_timeout = 200, // ms
};

pub fn myersDiff(allocator: Allocator, actual: []const u8, expected: []const u8) DiffError!std.ArrayListUnmanaged(Diff) {
    // TODO: this DMP impl allocates to much and needs improvement.
    return dmp.diff(allocator, expected, actual, false);
}
