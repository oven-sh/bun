const std = @import("std");
const expect = std.testing.expect;

usingnamespace @import("string_types.zig");

pub const MutableString = struct {
    allocator: *std.mem.Allocator,
    list: std.ArrayListUnmanaged(u8),

    pub fn init(allocator: *std.mem.Allocator, capacity: usize) !MutableString {
        return MutableString{ .allocator = allocator, .list = try std.ArrayListUnmanaged(u8).initCapacity(allocator, capacity) };
    }

    pub fn initCopy(allocator: *std.mem.Allocator, str: anytype) !MutableString {
        var mutable = try MutableString.init(allocator, std.mem.len(str));
        try mutable.copy(str);
        return mutable;
    }

    // Convert it to an ASCII identifier. Note: If you change this to a non-ASCII
    // identifier, you're going to potentially cause trouble with non-BMP code
    // points in target environments that don't support bracketed Unicode escapes.

    pub fn ensureValidIdentifier(str: string, allocator: *std.mem.Allocator) !string {
        if (str.len == 0) {
            return "_";
        }

        var mutable = try MutableString.init(allocator, 0);

        var needsGap = false;
        for (str) |c| {
            if (std.ascii.isLower(c) or std.ascii.isUpper(c) or (mutable.len() > 0 and std.ascii.isAlNum(c))) {
                if (needsGap) {
                    try mutable.appendChar('_');
                    needsGap = false;
                }
                try mutable.appendChar(c);
            } else if (!needsGap) {
                needsGap = true;
            }
        }

        if (mutable.len() > 0) {
            return mutable.list.toOwnedSlice(allocator);
        } else {
            return str;
        }
    }

    pub fn len(self: *MutableString) usize {
        return self.list.items.len;
    }

    pub fn copy(self: *MutableString, str: anytype) !void {
        try self.list.ensureCapacity(self.allocator, std.mem.len(str[0..]));

        if (self.list.items.len == 0) {
            try self.list.insertSlice(self.allocator, 0, str);
        } else {
            try self.list.replaceRange(self.allocator, 0, std.mem.len(str[0..]), str[0..]);
        }
    }

    pub fn deinit(self: *MutableString) !void {
        self.list.deinit(self.allocator);
    }

    pub fn appendChar(self: *MutableString, char: u8) !void {
        try self.list.append(self.allocator, char);
    }

    pub fn appendCharAssumeCapacity(self: *MutableString, char: u8) void {
        self.list.appendAssumeCapacity(char);
    }

    pub fn append(self: *MutableString, char: []const u8) !void {
        try self.list.appendSlice(self.allocator, char);
    }

    pub fn appendAssumeCapacity(self: *MutableString, char: []const u8) !void {
        try self.list.appendSliceAssumeCapacity(self.allocator, char);
    }

    pub fn toOwnedSlice(self: *MutableString) string {
        return self.list.toOwnedSlice(self.allocator);
    }

    pub fn toOwnedSliceLength(self: *MutableString, length: usize) string {
        self.list.shrinkAndFree(self.allocator, length);
        return self.list.toOwnedSlice(self.allocator);
    }

    // pub fn deleteAt(self: *MutableString, i: usize)  {
    //     self.list.swapRemove(i);
    // }

    pub fn containsChar(self: *MutableString, char: u8) bool {
        return self.indexOfChar(char) != null;
    }

    pub fn indexOfChar(self: *MutableString, char: u8) ?usize {
        return std.mem.indexOfScalar(@TypeOf(char), self.list.items, char);
    }

    pub fn lastIndexOfChar(self: *MutableString, char: u8) ?usize {
        return std.mem.lastIndexOfScalar(@TypeOf(char), self.list.items, char);
    }

    pub fn lastIndexOf(self: *MutableString, str: u8) ?usize {
        return std.mem.lastIndexOf(u8, self.list.items, str);
    }

    pub fn indexOf(self: *MutableString, str: u8) ?usize {
        return std.mem.indexOf(u8, self.list.items, str);
    }

    pub fn eql(self: *MutableString, other: anytype) bool {
        return std.mem.eql(u8, self.list.items, other);
    }
};

test "MutableString" {
    const alloc = std.heap.page_allocator;

    var str = try MutableString.initCopy(alloc, "hello");
    expect(str.eql("hello"));
}

test "MutableString.ensureValidIdentifier" {
    const alloc = std.heap.page_allocator;

    std.testing.expectEqualStrings("jquery", try MutableString.ensureValidIdentifier("jquery", alloc));
    std.testing.expectEqualStrings("jquery_foo", try MutableString.ensureValidIdentifier("jquery😋foo", alloc));
}
