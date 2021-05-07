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

pub fn lastIndexOf(self: string, str: u8) ?usize {
    return std.mem.lastIndexOf(u8, self, str);
}

pub fn indexOf(self: string, str: u8) ?usize {
    return std.mem.indexOf(u8, self, str);
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
    for (self) |c, i| {
        if (other[i] != c) return false;
    }
    return true;
}
// I have not actually verified that this makes it faster
// It's probably like 0.0001ms faster
pub fn eqlComptime(self: string, comptime alt: string) bool {
    comptime var matcher_size: usize = 0;

    switch (comptime alt.len) {
        0 => {
            @compileError("Invalid size passed to eqlComptime");
        },
        1...4 => {
            matcher_size = 4;
        },
        5...8 => {
            matcher_size = 8;
        },
        8...12 => {
            comptime const FirstMatcher = ExactSizeMatcher(8);
            comptime const SecondMatcher = ExactSizeMatcher(4);
            comptime const first = FirstMatcher.case(alt[0..8]);
            comptime const second = SecondMatcher.case(alt[8..alt.len]);
            return (self.len == alt.len) and first == FirstMatcher.hashUnsafe(self[0..8]) and second == SecondMatcher.match(self[8..self.len]);
        },
        else => {
            @compileError(alt ++ " is too long.");
        },
    }
    comptime const Matcher = ExactSizeMatcher(matcher_size);
    comptime const alt_hash = Matcher.case(alt);
    return Matcher.match(self) == alt_hash;
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
    var utf8Iterator = std.unicode.Utf8Iterator{ .bytes = in, .i = 0 };

    var c: u21 = 0;
    var i: usize = 0;
    while (utf8Iterator.nextCodepoint()) |code_point| {
        switch (code_point) {
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
    var utf8Iterator = std.unicode.Utf8Iterator{ .bytes = in, .i = 0 };
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

test "join" {
    var string_list = &[_]string{ "abc", "def", "123", "hello" };
    const list = try join(string_list, "-", std.heap.page_allocator);
    std.testing.expectEqualStrings("abc-def-123-hello", list);
}

test "sortAsc" {
    var string_list = [_]string{ "abc", "def", "123", "hello" };
    var sorted_string_list = [_]string{ "123", "abc", "def", "hello" };
    var sorted_join = try join(&sorted_string_list, "-", std.heap.page_allocator);
    sortAsc(&string_list);
    var string_join = try join(&string_list, "-", std.heap.page_allocator);

    std.testing.expectEqualStrings(sorted_join, string_join);
}

test "sortDesc" {
    var string_list = [_]string{ "abc", "def", "123", "hello" };
    var sorted_string_list = [_]string{ "hello", "def", "abc", "123" };
    var sorted_join = try join(&sorted_string_list, "-", std.heap.page_allocator);
    sortDesc(&string_list);
    var string_join = try join(&string_list, "-", std.heap.page_allocator);

    std.testing.expectEqualStrings(sorted_join, string_join);
}

pub fn ExactSizeMatcher(comptime max_bytes: usize) type {
    const T = std.meta.Int(
        .unsigned,
        max_bytes * 8,
    );

    return struct {
        pub fn match(str: anytype) T {
            return hash(str) orelse std.math.maxInt(T);
        }

        pub fn case(comptime str: []const u8) T {
            return hash(str) orelse std.math.maxInt(T);
        }

        fn hash(str: anytype) ?T {
            if (str.len > max_bytes) return null;
            var tmp = [_]u8{0} ** max_bytes;
            std.mem.copy(u8, &tmp, str[0..str.len]);
            return std.mem.readIntNative(T, &tmp);
        }

        fn hashUnsafe(str: anytype) T {
            var tmp = [_]u8{0} ** max_bytes;
            std.mem.copy(u8, &tmp, str[0..str.len]);
            return std.mem.readIntNative(T, &tmp);
        }
    };
}

const eight = ExactSizeMatcher(8);

test "ExactSizeMatcher 5 letter" {
    const word = "yield";
    expect(eight.match(word) == eight.case("yield"));
    expect(eight.match(word) != eight.case("yields"));
}

test "ExactSizeMatcher 4 letter" {
    const Four = ExactSizeMatcher(4);
    const word = "from";
    expect(Four.match(word) == Four.case("from"));
    expect(Four.match(word) != Four.case("fro"));
}
