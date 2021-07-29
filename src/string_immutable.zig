const std = @import("std");
const expect = std.testing.expect;

const JavascriptString = @import("ast/base.zig").JavascriptString;

usingnamespace @import("string_types.zig");

pub fn containsChar(self: string, char: u8) bool {
    return indexOfChar(self, char) != null;
}

pub fn contains(self: string, str: string) bool {
    return std.mem.indexOf(u8, self, str) != null;
}

pub fn indexOfChar(self: string, char: u8) ?usize {
    return std.mem.indexOfScalar(@TypeOf(char), self, char);
}

pub fn lastIndexOfChar(self: string, char: u8) ?usize {
    return std.mem.lastIndexOfScalar(u8, self, char);
}

pub fn lastIndexOf(self: string, str: string) ?usize {
    return std.mem.lastIndexOf(u8, self, str);
}

pub fn indexOf(self: string, str: string) ?usize {
    return std.mem.indexOf(u8, self, str);
}

pub fn cat(allocator: *std.mem.Allocator, first: string, second: string) !string {
    var out = try allocator.alloc(u8, first.len + second.len);
    std.mem.copy(u8, out, first);
    std.mem.copy(u8, out[first.len..], second);
    return out;
}

pub fn startsWith(self: string, str: string) bool {
    if (str.len > self.len) {
        return false;
    }

    var i: usize = 0;
    while (i < str.len) {
        if (str[i] != self[i]) {
            return false;
        }
        i += 1;
    }

    return true;
}

pub fn endsWith(self: string, str: string) bool {
    if (str.len > self.len) {
        return false;
    }

    var i: usize = str.len - 1;
    while (i > 0) : (i -= 1) {
        if (str[i] != self[i]) {
            return false;
        }
    }

    return true;
}

pub fn endsWithAny(self: string, str: string) bool {
    const end = self[self.len - 1];
    for (str) |char| {
        if (char == end) {
            return true;
        }
    }

    return false;
}

pub fn lastNonwhitespace(self: string, str: string) bool {}

pub fn quotedAlloc(allocator: *std.mem.Allocator, self: string) !string {
    var count: usize = 0;
    for (self) |char| {
        count += @boolToInt(char == '"');
    }

    if (count == 0) {
        return allocator.dupe(u8, self);
    }

    var i: usize = 0;
    var out = try allocator.alloc(u8, self.len + count);
    for (self) |char| {
        if (char == '"') {
            out[i] = '\\';
            i += 1;
        }
        out[i] = char;
        i += 1;
    }

    return out;
}

pub fn endsWithAnyComptime(self: string, comptime str: string) bool {
    if (str.len < 10) {
        const last = self[self.len - 1];
        inline while (str) |char| {
            if (char == last) {
                return true;
            }
        }

        return false;
    } else {
        return endsWithAny(self, str);
    }
}

pub fn eql(self: string, other: anytype) bool {
    if (self.len != other.len) return false;
    if (comptime @TypeOf(other) == *string) {
        return eql(self, other.*);
    }

    for (self) |c, i| {
        if (other[i] != c) return false;
    }
    return true;
}

pub fn eqlInsensitive(self: string, other: anytype) bool {
    return std.ascii.eqlIgnoreCase(self, other);
}

pub fn eqlComptime(self: string, comptime alt: anytype) bool {
    switch (comptime alt.len) {
        0 => {
            @compileError("Invalid size passed to eqlComptime");
        },
        2 => {
            const check = std.mem.readIntNative(u16, alt[0..alt.len]);
            return self.len == alt.len and std.mem.readIntNative(u16, self[0..2]) == check;
        },
        1, 3 => {
            if (alt.len != self.len) {
                return false;
            }

            inline for (alt) |c, i| {
                if (self[i] != c) return false;
            }
            return true;
        },
        4 => {
            const check = std.mem.readIntNative(u32, alt[0..alt.len]);
            return self.len == alt.len and std.mem.readIntNative(u32, self[0..4]) == check;
        },
        6 => {
            const first = std.mem.readIntNative(u32, alt[0..4]);
            const second = std.mem.readIntNative(u16, alt[4..6]);

            return self.len == alt.len and first == std.mem.readIntNative(u32, self[0..4]) and
                second == std.mem.readIntNative(u16, self[4..6]);
        },
        5, 7 => {
            const check = std.mem.readIntNative(u32, alt[0..4]);
            if (self.len != alt.len or std.mem.readIntNative(u32, self[0..4]) != check) {
                return false;
            }
            const remainder = self[4..];
            inline for (alt[4..]) |c, i| {
                if (remainder[i] != c) return false;
            }
            return true;
        },
        8 => {
            const check = std.mem.readIntNative(u64, alt[0..alt.len]);
            return self.len == alt.len and std.mem.readIntNative(u64, self[0..8]) == check;
        },
        9...11 => {
            const first = std.mem.readIntNative(u64, alt[0..8]);

            if (self.len != alt.len or first != std.mem.readIntNative(u64, self[0..8])) {
                return false;
            }

            inline for (alt[8..]) |c, i| {
                if (self[i + 8] != c) return false;
            }
            return true;
        },
        12 => {
            const first = std.mem.readIntNative(u64, alt[0..8]);
            const second = std.mem.readIntNative(u32, alt[8..12]);
            return (self.len == alt.len) and first == std.mem.readIntNative(u64, self[0..8]) and second == std.mem.readIntNative(u32, self[8..12]);
        },
        13...15 => {
            const first = std.mem.readIntNative(u64, alt[0..8]);
            const second = std.mem.readIntNative(u32, alt[8..12]);

            if (self.len != alt.len or first != std.mem.readIntNative(u64, self[0..8]) or second != std.mem.readIntNative(u32, self[8..12])) {
                return false;
            }

            inline for (alt[13..]) |c, i| {
                if (self[i + 13] != c) return false;
            }

            return true;
        },
        16 => {
            const first = std.mem.readIntNative(u64, alt[0..8]);
            const second = std.mem.readIntNative(u64, alt[8..15]);
            return (self.len == alt.len) and first == std.mem.readIntNative(u64, self[0..8]) and second == std.mem.readIntNative(u64, self[8..16]);
        },
        else => {
            @compileError(alt ++ " is too long.");
        },
    }
}

pub fn append(allocator: *std.mem.Allocator, self: string, other: string) !string {
    return std.fmt.allocPrint(allocator, "{s}{s}", .{ self, other });
}

pub fn index(self: string, str: string) i32 {
    if (std.mem.indexOf(u8, self, str)) |i| {
        return @intCast(i32, i);
    } else {
        return -1;
    }
}

pub fn eqlUtf16(comptime self: string, other: JavascriptString) bool {
    return std.mem.eql(u16, std.unicode.utf8ToUtf16LeStringLiteral(self), other);
}

pub fn toUTF8Alloc(allocator: *std.mem.Allocator, js: JavascriptString) !string {
    var temp: [4]u8 = undefined;
    var list = std.ArrayList(u8).initCapacity(allocator, js.len) catch unreachable;
    var i: usize = 0;
    while (i < js.len) : (i += 1) {
        var r1 = @intCast(i32, js[i]);
        if (r1 >= 0xD800 and r1 <= 0xDBFF and i + 1 < js.len) {
            const r2 = @intCast(i32, js[i] + 1);
            if (r2 >= 0xDC00 and r2 <= 0xDFFF) {
                r1 = (r1 - 0xD800) << 10 | (r2 - 0xDC00) + 0x10000;
                i += 1;
            }
        }
        const width = encodeWTF8Rune(&temp, r1);
        list.appendSlice(temp[0..width]) catch unreachable;
    }
    return list.items;
}

// Check utf16 string equals utf8 string without allocating extra memory
pub fn utf16EqlString(text: []u16, str: string) bool {
    if (text.len > str.len) {
        // Strings can't be equal if UTF-16 encoding is longer than UTF-8 encoding
        return false;
    }

    var temp = [4]u8{ 0, 0, 0, 0 };
    const n = text.len;
    var j: usize = 0;
    var i: usize = 0;
    // TODO: is it safe to just make this u32 or u21?
    var r1: i32 = undefined;
    var k: u4 = 0;
    while (i < n) : (i += 1) {
        r1 = text[i];
        if (r1 >= 0xD800 and r1 <= 0xDBFF and i + 1 < n) {
            const r2: i32 = text[i + 1];
            if (r2 >= 0xDC00 and r2 <= 0xDFFF) {
                r1 = (r1 - 0xD800) << 10 | (r2 - 0xDC00) + 0x10000;
                i += 1;
            }
        }

        const width = encodeWTF8Rune(&temp, r1);
        if (j + width > str.len) {
            return false;
        }
        k = 0;
        while (k < width) : (k += 1) {
            if (temp[k] != str[j]) {
                return false;
            }
            j += 1;
        }
    }

    return j == str.len;
}

// This is a clone of golang's "utf8.EncodeRune" that has been modified to encode using
// WTF-8 instead. See https://simonsapin.github.io/wtf-8/ for more info.
pub fn encodeWTF8Rune(p: []u8, r: i32) u3 {
    // Negative values are erroneous. Making it unsigned addresses the problem.
    const i = @intCast(u32, r);
    switch (i) {
        0...0x7F => {
            p[0] = @intCast(u8, r);
            return 1;
        },
        (0x7F + 1)...0x7FF => {
            p[0] = 0xC0 | @intCast(u8, r >> 6);
            p[1] = 0x80 | @intCast(u8, r) & 0x3F;
            return 2;
        },
        (0x7FF + 1)...0xFFFF => {
            p[0] = 0xE0 | @intCast(u8, r >> 12);
            p[1] = 0x80 | @intCast(u8, r >> 6) & 0x3F;
            p[2] = 0x80 | @intCast(u8, r) & 0x3F;
            return 3;
        },
        else => {
            p[0] = 0xF0 | @intCast(u8, r >> 18);
            p[1] = 0x80 | @intCast(u8, r >> 12) & 0x3F;
            p[2] = 0x80 | @intCast(u8, r >> 6) & 0x3F;
            p[3] = 0x80 | @intCast(u8, r) & 0x3F;
            return 4;
        },
    }
}

pub fn toUTF16Buf(in: string, out: []u16) usize {
    var utf8Iterator = CodepointIterator{ .bytes = in, .i = 0 };

    var c: u21 = 0;
    var i: usize = 0;
    while (true) {
        const code_point = utf8Iterator.nextCodepoint();

        switch (code_point) {
            -1 => {
                return i;
            },
            0...0xFFFF => {
                out[i] = @intCast(u16, code_point);
                i += 1;
            },
            else => {
                c = code_point - 0x10000;
                out[i] = @intCast(u16, 0xD800 + ((c >> 10) & 0x3FF));
                i += 1;
                out[i] = @intCast(u16, 0xDC00 + (c & 0x3FF));
                i += 1;
            },
        }
    }

    return i;
}

pub fn toUTF16Alloc(in: string, allocator: *std.mem.Allocator) !JavascriptString {
    var utf8Iterator = CodepointIterator{ .bytes = in, .i = 0 };
    var out = try std.ArrayList(u16).initCapacity(allocator, in.len);

    var c: u21 = 0;
    var i: usize = 0;
    while (utf8Iterator.nextCodepoint()) |code_point| {
        switch (code_point) {
            0...0xFFFF => {
                try out.append(@intCast(u16, code_point));
            },
            else => {
                c = code_point - 0x10000;
                try out.append(@intCast(u16, 0xD800 + ((c >> 10) & 0x3FF)));
                try out.append(@intCast(u16, 0xDC00 + (c & 0x3FF)));
            },
        }
    }

    return out.toOwnedSlice();
}

pub fn containsNonBmpCodePoint(text: string) bool {
    var iter = std.unicode.Utf8Iterator{ .bytes = text, .i = 0 };

    while (iter.nextCodepoint()) |codepoint| {
        if (codepoint > 0xFFFF) {
            return true;
        }
    }

    return false;
}

// this is std.mem.trim except it doesn't forcibly change the slice to be const
pub fn trim(slice: anytype, values_to_strip: []const u8) @TypeOf(slice) {
    var begin: usize = 0;
    var end: usize = slice.len;
    while (begin < end and std.mem.indexOfScalar(u8, values_to_strip, slice[begin]) != null) : (begin += 1) {}
    while (end > begin and std.mem.indexOfScalar(u8, values_to_strip, slice[end - 1]) != null) : (end -= 1) {}
    return slice[begin..end];
}

pub fn containsNonBmpCodePointUTF16(_text: JavascriptString) bool {
    const n = _text.len;
    if (n > 0) {
        var i: usize = 0;
        var c: u16 = 0;
        var c2: u16 = 0;
        var text = _text[0 .. n - 1];
        while (i < n - 1) : (i += 1) {
            c = text[i];
            if (c >= 0xD800 and c <= 0xDBFF) {
                c2 = text[i + 1];
                if (c2 >= 0xDC00 and c2 <= 0xDFFF) {
                    return true;
                }
            }
        }
    }

    return false;
}

pub fn join(slices: []const string, delimiter: string, allocator: *std.mem.Allocator) !string {
    return try std.mem.join(allocator, delimiter, slices);
}

pub fn cmpStringsAsc(ctx: void, a: string, b: string) bool {
    return std.mem.order(u8, a, b) == .lt;
}

pub fn cmpStringsDesc(ctx: void, a: string, b: string) bool {
    return std.mem.order(u8, a, b) == .gt;
}

const sort_asc = std.sort.asc(u8);
const sort_desc = std.sort.desc(u8);

pub fn sortAsc(in: []string) void {
    std.sort.sort([]const u8, in, {}, cmpStringsAsc);
}

pub fn sortDesc(in: []string) void {
    std.sort.sort([]const u8, in, {}, cmpStringsDesc);
}

pub fn utf8ByteSequenceLength(first_byte: u8) u3 {
    // The switch is optimized much better than a "smart" approach using @clz
    return switch (first_byte) {
        0b0000_0000...0b0111_1111 => 1,
        0b1100_0000...0b1101_1111 => 2,
        0b1110_0000...0b1110_1111 => 3,
        0b1111_0000...0b1111_0111 => 4,
        else => 0,
    };
}

pub const CodepointIterator = struct {
    bytes: []const u8,
    i: usize,
    width: u3 = 0,
    c: CodePoint = 0,

    inline fn nextCodepointSlice(it: *CodepointIterator) []const u8 {
        @setRuntimeSafety(false);

        const cp_len = utf8ByteSequenceLength(it.bytes[it.i]);
        it.i += cp_len;

        return if (!(it.i > it.bytes.len)) it.bytes[it.i - cp_len .. it.i] else "";
    }

    pub fn nextCodepoint(it: *CodepointIterator) CodePoint {
        const slice = it.nextCodepointSlice();
        it.width = @intCast(u3, slice.len);
        @setRuntimeSafety(false);

        it.c = switch (it.width) {
            0 => -1,
            1 => @intCast(CodePoint, slice[0]),
            2 => @intCast(CodePoint, std.unicode.utf8Decode2(slice) catch unreachable),
            3 => @intCast(CodePoint, std.unicode.utf8Decode3(slice) catch unreachable),
            4 => @intCast(CodePoint, std.unicode.utf8Decode4(slice) catch unreachable),
            else => unreachable,
        };

        return it.c;
    }

    /// Look ahead at the next n codepoints without advancing the iterator.
    /// If fewer than n codepoints are available, then return the remainder of the string.
    pub fn peek(it: *CodepointIterator, n: usize) []const u8 {
        const original_i = it.i;
        defer it.i = original_i;

        var end_ix = original_i;
        var found: usize = 0;
        while (found < n) : (found += 1) {
            const next_codepoint = it.nextCodepointSlice() orelse return it.bytes[original_i..];
            end_ix += next_codepoint.len;
        }

        return it.bytes[original_i..end_ix];
    }
};

test "join" {
    var string_list = &[_]string{ "abc", "def", "123", "hello" };
    const list = try join(string_list, "-", std.heap.page_allocator);
    try std.testing.expectEqualStrings("abc-def-123-hello", list);
}

test "sortAsc" {
    var string_list = [_]string{ "abc", "def", "123", "hello" };
    var sorted_string_list = [_]string{ "123", "abc", "def", "hello" };
    var sorted_join = try join(&sorted_string_list, "-", std.heap.page_allocator);
    sortAsc(&string_list);
    var string_join = try join(&string_list, "-", std.heap.page_allocator);

    try std.testing.expectEqualStrings(sorted_join, string_join);
}

test "sortDesc" {
    var string_list = [_]string{ "abc", "def", "123", "hello" };
    var sorted_string_list = [_]string{ "hello", "def", "abc", "123" };
    var sorted_join = try join(&sorted_string_list, "-", std.heap.page_allocator);
    sortDesc(&string_list);
    var string_join = try join(&string_list, "-", std.heap.page_allocator);

    try std.testing.expectEqualStrings(sorted_join, string_join);
}

pub usingnamespace @import("exact_size_matcher.zig");
