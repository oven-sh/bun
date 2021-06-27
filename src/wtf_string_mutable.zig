const std = @import("std");
const expect = std.testing.expect;

usingnamespace @import("string_types.zig");
const strings = @import("string_immutable.zig");
const js_lexer = @import("js_lexer.zig");
const ListType = std.ArrayListUnmanaged(u16);
pub const WTFStringMutable = struct {
    allocator: *std.mem.Allocator,
    list: ListType,

    pub const Writer = std.io.Writer(*@This(), anyerror, WTFStringMutable.writeAll);
    pub fn writer(self: *WTFStringMutable) Writer {
        return Writer{
            .context = self,
        };
    }

    pub fn deinit(str: *WTFStringMutable) void {
        str.list.deinit(str.allocator);
    }

    pub fn growIfNeeded(self: *WTFStringMutable, amount: usize) !void {
        try self.list.ensureUnusedCapacity(self.allocator, amount);
    }

    pub fn write(self: *WTFStringMutable, bytes: anytype) !usize {
        try self.list.appendSlice(self.allocator, bytes);
        return bytes.len;
    }

    pub fn writeAll(self: *WTFStringMutable, bytes: string) !usize {
        try self.list.appendSlice(self.allocator, bytes);
        return self.list.items.len;
    }

    pub fn init(allocator: *std.mem.Allocator, capacity: usize) !WTFStringMutable {
        return WTFStringMutable{ .allocator = allocator, .list = try ListType.initCapacity(allocator, capacity) };
    }

    pub fn initCopy(allocator: *std.mem.Allocator, str: anytype) !WTFStringMutable {
        var mutable = try WTFStringMutable.init(allocator, std.mem.len(str));
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
        needs_gap = !js_lexer.isIdentifierStart(@intCast(js_lexer.CodePoint, str[0]));
        if (!needs_gap) {
            // Are there any non-alphanumeric chars at all?
            for (str[1..str.len]) |c, i| {
                if (!js_lexer.isIdentifierContinue(@intCast(js_lexer.CodePoint, c))) {
                    needs_gap = true;
                    start_i = 1 + i;
                    break;
                }
            }
        }

        if (needs_gap) {
            var mutable = try WTFStringMutable.initCopy(allocator, str[0..start_i]);
            needs_gap = false;

            var i: usize = 0;

            var slice = str[start_i..];

            while (i < slice.len) : (i += 1) {
                const c = @intCast(js_lexer.CodePoint, slice[i]);
                if (js_lexer.isIdentifierContinue(c)) {
                    if (needs_gap) {
                        try mutable.appendChar('_');
                        needs_gap = false;
                        has_needed_gap = true;
                    }

                    try mutable.appendChar(slice[i]);
                } else if (!needs_gap) {
                    needs_gap = true;
                    // skip the code point, replace it with a single _
                    i += std.math.max(strings.utf8ByteSequenceLength(slice[i]), 1) - 1;
                }
            }

            // If it ends with an emoji
            if (needs_gap) {
                try mutable.appendChar('_');
                needs_gap = false;
                has_needed_gap = true;
            }

            return mutable.list.toOwnedSlice(allocator);
        }

        return str;
    }

    pub fn len(self: *const WTFStringMutable) usize {
        return self.list.items.len;
    }

    pub fn copy(self: *WTFStringMutable, str: anytype) !void {
        try self.list.ensureCapacity(self.allocator, std.mem.len(str[0..]));

        if (self.list.items.len == 0) {
            try self.list.insertSlice(self.allocator, 0, str);
        } else {
            try self.list.replaceRange(self.allocator, 0, std.mem.len(str[0..]), str[0..]);
        }
    }

    pub inline fn growBy(self: *WTFStringMutable, amount: usize) !void {
        try self.list.ensureUnusedCapacity(self.allocator, amount);
    }

    pub inline fn reset(
        self: *WTFStringMutable,
    ) void {
        self.list.shrinkRetainingCapacity(0);
    }

    pub inline fn appendChar(self: *WTFStringMutable, char: u8) !void {
        try self.list.append(self.allocator, char);
    }
    pub inline fn appendCharAssumeCapacity(self: *WTFStringMutable, char: u8) void {
        self.list.appendAssumeCapacity(char);
    }
    pub inline fn append(self: *WTFStringMutable, str: []const u8) !void {
        try self.growIfNeeded(str.len);

        var iter = strings.CodepointIterator{ .bytes = str, .i = 0 };
        while (true) {
            switch (iter.nextCodepoint()) {
                -1 => {
                    return;
                },
                0...0xFFFF => {
                    try self.list.append(self.allocator, @intCast(u16, iter.c));
                },
                else => {
                    const c = iter.c - 0x10000;
                    try self.list.append(self.allocator, @intCast(u16, 0xD800 + ((c >> 10) & 0x3FF)));
                    try self.list.append(self.allocator, @intCast(u16, 0xDC00 + (c & 0x3FF)));
                },
            }
        }
    }

    pub inline fn appendComptimeConvert(self: *WTFStringMutable, comptime _str: []const u8) !void {
        const str = std.unicode.utf8ToUtf16LeStringLiteral(_str);
        try self.list.appendSlice(str);
    }

    pub inline fn appendAssumeCapacity(self: *WTFStringMutable, str: []const u8) void {
        var iter = strings.CodepointIterator{ .bytes = str, .i = 0 };
        while (true) {
            switch (iter.nextCodepoint()) {
                -1 => {
                    return;
                },
                0...0xFFFF => {
                    self.list.appendAssumeCapacity(@intCast(u16, iter.c));
                },
                else => {
                    const c = iter.c - 0x10000;
                    self.list.appendAssumeCapacity(@intCast(u16, 0xD800 + ((c >> 10) & 0x3FF)));
                    self.list.appendAssumeCapacity(@intCast(u16, 0xDC00 + (c & 0x3FF)));
                },
            }
        }
    }
    pub inline fn lenI(self: *WTFStringMutable) i32 {
        return @intCast(i32, self.list.items.len);
    }

    pub fn toOwnedSlice(self: *WTFStringMutable) []u16 {
        return self.list.toOwnedSlice(self.allocator);
    }

    pub fn toOwnedSliceLeaky(self: *WTFStringMutable) []u16 {
        return self.list.items;
    }

    pub fn toOwnedSliceLength(self: *WTFStringMutable, length: usize)  {
        self.list.shrinkAndFree(self.allocator, length);
        return self.list.toOwnedSlice(self.allocator);
    }

    // pub fn deleteAt(self: *WTFStringMutable, i: usize)  {
    //     self.list.swapRemove(i);
    // }

    pub fn containsChar(self: *WTFStringMutable, char: u8) bool {
        return self.indexOfChar(char) != null;
    }

    pub fn indexOfChar(self: *WTFStringMutable, char: u8) ?usize {
        return std.mem.indexOfScalar(@TypeOf(char), self.list.items, char);
    }

    pub fn lastIndexOfChar(self: *WTFStringMutable, char: u8) ?usize {
        return std.mem.lastIndexOfScalar(@TypeOf(char), self.list.items, char);
    }

    pub fn lastIndexOf(self: *WTFStringMutable, str: u8) ?usize {
        return std.mem.lastIndexOf(u8, self.list.items, str);
    }

    pub fn indexOf(self: *WTFStringMutable, str: u8) ?usize {
        return std.mem.indexOf(u8, self.list.items, str);
    }

    pub fn eql(self: *WTFStringMutable, other: anytype) bool {
        return std.mem.eql(u8, self.list.items, other);
    }
};

test "WTFStringMutable" {
    const alloc = std.heap.page_allocator;

    var str = try WTFStringMutable.initCopy(alloc, "hello");
    expect(str.eql("hello"));
}

test "WTFStringMutable.ensureValidIdentifier" {
    const alloc = std.heap.page_allocator;

    try std.testing.expectEqualStrings("jquery", try WTFStringMutable.ensureValidIdentifier("jquery", alloc));
    try std.testing.expectEqualStrings("jquery_foo", try WTFStringMutable.ensureValidIdentifier("jquery😋foo", alloc));
}
