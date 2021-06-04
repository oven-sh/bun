const std = @import("std");
const expect = std.testing.expect;

usingnamespace @import("string_types.zig");

pub const MutableString = struct {
    allocator: *std.mem.Allocator,
    list: std.ArrayListUnmanaged(u8),

    pub const Writer = std.io.Writer(*@This(), anyerror, MutableString.writeAll);
    pub fn writer(self: *MutableString) Writer {
        return Writer{
            .context = self,
        };
    }

    pub fn deinit(str: *MutableString) void {
        str.list.deinit(str.allocator);
    }

    pub fn growIfNeeded(self: *MutableString, amount: usize) !void {
        try self.list.ensureUnusedCapacity(self.allocator, amount);
    }

    pub fn writeAll(self: *MutableString, bytes: string) !usize {
        try self.list.appendSlice(self.allocator, bytes);
        return self.list.items.len;
    }

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

        var has_needed_gap = false;
        var needs_gap = false;
        var start_i: usize = 0;

        // Common case: no gap necessary. No allocation necessary.
        needs_gap = std.ascii.isAlNum(str[0]);
        if (!needs_gap) {
            // Are there any non-alphanumeric chars at all?
            for (str[1..str.len]) |c, i| {
                switch (c) {
                    'a'...'z', 'A'...'Z', '0'...'9' => {},
                    else => {
                        needs_gap = true;
                        start_i = i;
                        break;
                    },
                }
            }
        }

        if (needs_gap) {
            var mutable = try MutableString.initCopy(allocator, str[0..start_i]);

            for (str[start_i..str.len]) |c, i| {
                if (std.ascii.isLower(c) or std.ascii.isUpper(c) or (mutable.len() > 0 and std.ascii.isAlNum(c))) {
                    if (needs_gap) {
                        try mutable.appendChar('_');
                        needs_gap = false;
                        has_needed_gap = true;
                    }
                    try mutable.appendChar(c);
                } else if (!needs_gap) {
                    needs_gap = true;
                }
            }

            return mutable.list.toOwnedSlice(allocator);
        }

        return str;
    }

    pub fn len(self: *const MutableString) usize {
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

    pub inline fn growBy(self: *MutableString, amount: usize) !void {
        try self.list.ensureUnusedCapacity(self.allocator, amount);
    }

    pub inline fn reset(
        self: *MutableString,
    ) void {
        self.list.shrinkRetainingCapacity(0);
    }

    pub inline fn appendChar(self: *MutableString, char: u8) !void {
        try self.list.append(self.allocator, char);
    }
    pub inline fn appendCharAssumeCapacity(self: *MutableString, char: u8) void {
        self.list.appendAssumeCapacity(char);
    }
    pub inline fn append(self: *MutableString, char: []const u8) !void {
        try self.list.appendSlice(self.allocator, char);
    }
    pub inline fn appendAssumeCapacity(self: *MutableString, char: []const u8) void {
        self.list.appendSliceAssumeCapacity(
            char,
        );
    }
    pub inline fn lenI(self: *MutableString) i32 {
        return @intCast(i32, self.list.items.len);
    }

    pub fn toOwnedSlice(self: *MutableString) string {
        return self.list.toOwnedSlice(self.allocator);
    }

    pub fn toOwnedSliceLeaky(self: *MutableString) string {
        return self.list.items;
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
