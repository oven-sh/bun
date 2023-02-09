const std = @import("std");

/// This is used to keep track of a subslice of a slice _and where it is in the
/// original slice_. We need this because when bisecting, we are operating on
/// subslices, but we want to emit `Edit`s with ranges in the original slice.
pub const Range = struct {
    txt: []const u8,
    start: usize,
    end: usize,

    const Self = @This();

    pub fn new(txt: []const u8) Self {
        return Range{ .txt = txt, .start = 0, .end = txt.len };
    }

    pub fn splitAt(self: Self, n: usize) [2]Self {
        return .{ self.firstN(n), self.shrinkLeft(n) };
    }

    /// Shorten the subslice by `left` on the left.
    pub fn shrinkLeft(self: Self, left: usize) Self {
        std.debug.assert(left <= self.len());
        return Range{ .txt = self.txt, .start = self.start + left, .end = self.end };
    }

    /// Shorten the subslice by `right` on the right.
    pub fn shrinkRight(self: Self, right: usize) Self {
        std.debug.assert(right <= self.len());
        return Range{ .txt = self.txt, .start = self.start, .end = self.end - right };
    }

    /// Shorten the range from both sides simultaneously.
    pub fn shrink(self: Self, left: usize, right: usize) Self {
        std.debug.assert(left + right <= self.len());
        return self.shrinkLeft(left).shrinkRight(right);
    }

    pub fn extendLeft(self: Self, n: usize) Self {
        std.debug.assert(n <= self.start);
        return Range{ .txt = self.txt, .start = self.start - n, .end = self.end };
    }

    pub fn extendRight(self: Self, n: usize) Self {
        std.debug.assert(n <= self.txt.len - self.end);
        return Range{ .txt = self.txt, .start = self.start, .end = self.end + n };
    }

    pub fn firstN(self: Self, n: usize) Range {
        std.debug.assert(n <= self.len());
        return Range{ .txt = self.txt, .start = self.start, .end = self.start + n };
    }

    pub fn lastN(self: Self, n: usize) Range {
        std.debug.assert(n <= self.len());
        return Range{ .txt = self.txt, .start = self.end - n, .end = self.end };
    }

    pub fn subslice(self: Self) []const u8 {
        return self.txt[self.start..self.end];
    }

    pub fn len(self: Self) usize {
        return self.end - self.start;
    }
};
