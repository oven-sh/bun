const std = @import("std");
const expect = std.testing.expect;

const JavascriptString = @import("ast/base.zig").JavascriptString;

usingnamespace @import("string_types.zig");

pub inline fn containsChar(self: string, char: u8) bool {
    return indexOfChar(self, char) != null;
}

pub inline fn contains(self: string, str: string) bool {
    return std.mem.indexOf(u8, self, str) != null;
}

pub inline fn containsAny(in: anytype, target: string) bool {
    for (in) |str| if (contains(str, target)) return true;
    return false;
}

pub inline fn indexAny(in: anytype, target: string) ?usize {
    for (in) |str, i| if (indexOf(str, target) != null) return i;
    return null;
}

pub inline fn indexAnyComptime(target: string, comptime chars: string) ?usize {
    for (target) |parent, i| {
        inline for (chars) |char| {
            if (char == parent) return i;
        }
    }
    return null;
}

pub inline fn indexOfChar(self: string, char: u8) ?usize {
    return std.mem.indexOfScalar(@TypeOf(char), self, char);
}

pub fn indexOfCharNeg(self: string, char: u8) i32 {
    var i: u32 = 0;
    while (i < self.len) : (i += 1) {
        if (self[i] == char) return @intCast(i32, i);
    }
    return -1;
}

pub fn indexOfSigned(self: string, str: string) i32 {
    const i = std.mem.indexOf(u8, self, str) orelse return -1;
    return @intCast(i32, i);
}

pub inline fn lastIndexOfChar(self: string, char: u8) ?usize {
    return std.mem.lastIndexOfScalar(u8, self, char);
}

pub inline fn lastIndexOf(self: string, str: string) ?usize {
    return std.mem.lastIndexOf(u8, self, str);
}

pub inline fn indexOf(self: string, str: string) ?usize {
    return std.mem.indexOf(u8, self, str);
}

pub fn cat(allocator: *std.mem.Allocator, first: string, second: string) !string {
    var out = try allocator.alloc(u8, first.len + second.len);
    std.mem.copy(u8, out, first);
    std.mem.copy(u8, out[first.len..], second);
    return out;
}

// 30 character string or a slice
pub const StringOrTinyString = struct {
    pub const Max = 30;
    const Buffer = [Max]u8;

    remainder_buf: Buffer = undefined,
    remainder_len: u7 = 0,
    is_tiny_string: u1 = 0,
    pub inline fn slice(this: *const StringOrTinyString) []const u8 {
        // This is a switch expression instead of a statement to make sure it uses the faster assembly
        return switch (this.is_tiny_string) {
            1 => this.remainder_buf[0..this.remainder_len],
            0 => @intToPtr([*]const u8, std.mem.readIntNative(usize, this.remainder_buf[0..@sizeOf(usize)]))[0..std.mem.readIntNative(usize, this.remainder_buf[@sizeOf(usize) .. @sizeOf(usize) * 2])],
        };
    }

    pub fn deinit(this: *StringOrTinyString, allocator: *std.mem.Allocator) void {
        if (this.is_tiny_string == 1) return;

        // var slice_ = this.slice();
        // allocator.free(slice_);
    }

    pub fn init(stringy: string) StringOrTinyString {
        switch (stringy.len) {
            0 => {
                return StringOrTinyString{ .is_tiny_string = 1, .remainder_len = 0 };
            },
            1...(@sizeOf(Buffer)) => {
                @setRuntimeSafety(false);
                var tiny = StringOrTinyString{
                    .is_tiny_string = 1,
                    .remainder_len = @truncate(u7, stringy.len),
                };
                std.mem.copy(u8, &tiny.remainder_buf, stringy);
                return tiny;
            },
            else => {
                var tiny = StringOrTinyString{
                    .is_tiny_string = 0,
                    .remainder_len = 0,
                };
                std.mem.writeIntNative(usize, tiny.remainder_buf[0..@sizeOf(usize)], @ptrToInt(stringy.ptr));
                std.mem.writeIntNative(usize, tiny.remainder_buf[@sizeOf(usize) .. @sizeOf(usize) * 2], stringy.len);
                return tiny;
            },
        }
    }

    pub fn initLowerCase(stringy: string) StringOrTinyString {
        switch (stringy.len) {
            0 => {
                return StringOrTinyString{ .is_tiny_string = 1, .remainder_len = 0 };
            },
            1...(@sizeOf(Buffer)) => {
                @setRuntimeSafety(false);
                var tiny = StringOrTinyString{
                    .is_tiny_string = 1,
                    .remainder_len = @truncate(u7, stringy.len),
                };
                _ = copyLowercase(stringy, &tiny.remainder_buf);
                return tiny;
            },
            else => {
                var tiny = StringOrTinyString{
                    .is_tiny_string = 0,
                    .remainder_len = 0,
                };
                std.mem.writeIntNative(usize, tiny.remainder_buf[0..@sizeOf(usize)], @ptrToInt(stringy.ptr));
                std.mem.writeIntNative(usize, tiny.remainder_buf[@sizeOf(usize) .. @sizeOf(usize) * 2], stringy.len);
                return tiny;
            },
        }
    }
};

pub fn copyLowercase(in: string, out: []u8) string {
    @setRuntimeSafety(false);
    var in_slice: string = in;
    var out_slice: []u8 = out[0..in.len];

    begin: while (out_slice.len > 0) {
        @setRuntimeSafety(false);
        for (in_slice) |c, i| {
            @setRuntimeSafety(false);
            switch (c) {
                'A'...'Z' => {
                    @setRuntimeSafety(false);
                    @memcpy(out_slice.ptr, in_slice.ptr, i);
                    out_slice[i] = std.ascii.toLower(c);
                    const end = i + 1;
                    if (end >= out_slice.len) break :begin;
                    in_slice = in_slice[end..];
                    out_slice = out_slice[end..];
                    continue :begin;
                },
                else => {},
            }
        }

        @memcpy(out_slice.ptr, in_slice.ptr, in_slice.len);
        break :begin;
    }

    return out[0..in.len];
}

test "copyLowercase" {
    {
        var in = "Hello, World!";
        var out = std.mem.zeroes([in.len]u8);
        var out_ = copyLowercase(in, &out);
        try std.testing.expectEqualStrings(out_, "hello, world!");
    }

    {
        var in = "_ListCache";
        var out = std.mem.zeroes([in.len]u8);
        var out_ = copyLowercase(in, &out);
        try std.testing.expectEqualStrings(out_, "_listcache");
    }
}

test "StringOrTinyString" {
    const correct: string = "helloooooooo";
    const big = "wawaweewaverylargeihaveachairwawaweewaverylargeihaveachairwawaweewaverylargeihaveachairwawaweewaverylargeihaveachair";
    var str = StringOrTinyString.init(correct);
    try std.testing.expectEqualStrings(correct, str.slice());

    str = StringOrTinyString.init(big);
    try std.testing.expectEqualStrings(big, str.slice());
    try std.testing.expect(@sizeOf(StringOrTinyString) == 32);
}

test "StringOrTinyString Lowercase" {
    const correct: string = "HELLO!!!!!";
    var str = StringOrTinyString.initLowerCase(correct);
    try std.testing.expectEqualStrings("hello!!!!!", str.slice());
}

pub fn hasPrefix(self: string, str: string) bool {
    return str.len > 0 and startsWith(self, str);
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

pub inline fn endsWith(self: string, str: string) bool {
    return str.len == 0 or @call(.{ .modifier = .always_inline }, std.mem.endsWith, .{ u8, self, str });
}

pub inline fn startsWithChar(self: string, char: u8) bool {
    return self.len > 0 and self[0] == char;
}

pub inline fn endsWithChar(self: string, char: u8) bool {
    return self.len == 0 or self[self.len - 1] == char;
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

pub fn eqlAnyComptime(self: string, comptime list: []const string) bool {
    inline for (list) |item| {
        if (eqlComptimeCheckLen(self, item, true)) return true;
    }

    return false;
}

pub fn endsWithAnyComptime(self: string, comptime str: string) bool {
    if (comptime str.len < 10) {
        const last = self[self.len - 1];
        inline for (str) |char| {
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

pub inline fn eqlInsensitive(self: string, other: anytype) bool {
    return std.ascii.eqlIgnoreCase(self, other);
}

pub fn eqlComptime(self: string, comptime alt: anytype) bool {
    return eqlComptimeCheckLen(self, alt, true);
}

pub fn eqlComptimeIgnoreLen(self: string, comptime alt: anytype) bool {
    return eqlComptimeCheckLen(self, alt, false);
}

inline fn eqlComptimeCheckLen(self: string, comptime alt: anytype, comptime check_len: bool) bool {
    switch (comptime alt.len) {
        0 => {
            @compileError("Invalid size passed to eqlComptime");
        },
        2 => {
            const check = comptime std.mem.readIntNative(u16, alt[0..alt.len]);
            return ((comptime !check_len) or self.len == alt.len) and std.mem.readIntNative(u16, self[0..2]) == check;
        },
        1, 3 => {
            if ((comptime check_len) and alt.len != self.len) {
                return false;
            }

            inline for (alt) |c, i| {
                if (self[i] != c) return false;
            }
            return true;
        },
        4 => {
            const check = comptime std.mem.readIntNative(u32, alt[0..alt.len]);
            return ((comptime !check_len) or self.len == alt.len) and std.mem.readIntNative(u32, self[0..4]) == check;
        },
        6 => {
            const first = std.mem.readIntNative(u32, alt[0..4]);
            const second = std.mem.readIntNative(u16, alt[4..6]);

            return self.len == alt.len and first == std.mem.readIntNative(u32, self[0..4]) and
                second == std.mem.readIntNative(u16, self[4..6]);
        },
        5, 7 => {
            const check = comptime std.mem.readIntNative(u32, alt[0..4]);
            if (((comptime check_len) and
                self.len != alt.len) or
                std.mem.readIntNative(u32, self[0..4]) != check)
            {
                return false;
            }
            const remainder = self[4..];
            inline for (alt[4..]) |c, i| {
                if (remainder[i] != c) return false;
            }
            return true;
        },
        8 => {
            const check = comptime std.mem.readIntNative(u64, alt[0..alt.len]);
            return ((comptime !check_len) or self.len == alt.len) and std.mem.readIntNative(u64, self[0..8]) == check;
        },
        9...11 => {
            const first = std.mem.readIntNative(u64, alt[0..8]);

            if (((comptime check_len) and self.len != alt.len) or first != std.mem.readIntNative(u64, self[0..8])) {
                return false;
            }

            inline for (alt[8..]) |c, i| {
                if (self[i + 8] != c) return false;
            }
            return true;
        },
        12 => {
            const first = comptime std.mem.readIntNative(u64, alt[0..8]);
            const second = comptime std.mem.readIntNative(u32, alt[8..12]);
            return ((comptime !check_len) or self.len == alt.len) and first == std.mem.readIntNative(u64, self[0..8]) and second == std.mem.readIntNative(u32, self[8..12]);
        },
        13...15 => {
            const first = comptime std.mem.readIntNative(u64, alt[0..8]);
            const second = comptime std.mem.readIntNative(u32, alt[8..12]);

            if (((comptime !check_len) or self.len != alt.len) or first != std.mem.readIntNative(u64, self[0..8]) or second != std.mem.readIntNative(u32, self[8..12])) {
                return false;
            }

            inline for (alt[13..]) |c, i| {
                if (self[i + 13] != c) return false;
            }

            return true;
        },
        16 => {
            const first = comptime std.mem.readIntNative(u64, alt[0..8]);
            const second = comptime std.mem.readIntNative(u64, alt[8..16]);
            return ((comptime !check_len) or self.len == alt.len) and first == std.mem.readIntNative(u64, self[0..8]) and second == std.mem.readIntNative(u64, self[8..16]);
        },
        17 => {
            const first = comptime std.mem.readIntNative(u64, alt[0..8]);
            const second = comptime std.mem.readIntNative(u64, alt[8..16]);
            return ((comptime !check_len) or self.len == alt.len) and
                first == std.mem.readIntNative(u64, self[0..8]) and second ==
                std.mem.readIntNative(u64, self[8..16]) and
                alt[16] == self[16];
        },
        18 => {
            const first = comptime std.mem.readIntNative(u64, alt[0..8]);
            const second = comptime std.mem.readIntNative(u64, alt[8..16]);
            const third = comptime std.mem.readIntNative(u16, alt[16..18]);
            return ((comptime !check_len) or self.len == alt.len) and
                first == std.mem.readIntNative(u64, self[0..8]) and second ==
                std.mem.readIntNative(u64, self[8..16]) and
                std.mem.readIntNative(u16, self[16..18]) == third;
        },
        23 => {
            const first = comptime std.mem.readIntNative(u64, alt[0..8]);
            const second = comptime std.mem.readIntNative(u64, alt[8..16]);
            return ((comptime !check_len) or self.len == alt.len) and
                first == std.mem.readIntNative(u64, self[0..8]) and
                second == std.mem.readIntNative(u64, self[8..16]) and
                eqlComptimeIgnoreLen(self[16..23], comptime alt[16..23]);
        },
        22 => {
            const first = comptime std.mem.readIntNative(u64, alt[0..8]);
            const second = comptime std.mem.readIntNative(u64, alt[8..16]);

            return ((comptime !check_len) or self.len == alt.len) and
                first == std.mem.readIntNative(u64, self[0..8]) and
                second == std.mem.readIntNative(u64, self[8..16]) and
                eqlComptimeIgnoreLen(self[16..22], comptime alt[16..22]);
        },
        24 => {
            const first = comptime std.mem.readIntNative(u64, alt[0..8]);
            const second = comptime std.mem.readIntNative(u64, alt[8..16]);
            const third = comptime std.mem.readIntNative(u64, alt[16..24]);
            return ((comptime !check_len) or self.len == alt.len) and
                first == std.mem.readIntNative(u64, self[0..8]) and
                second == std.mem.readIntNative(u64, self[8..16]) and
                third == std.mem.readIntNative(u64, self[16..24]);
        },
        else => {
            @compileError(alt ++ " is too long.");
        },
    }
}

pub inline fn append(allocator: *std.mem.Allocator, self: string, other: string) !string {
    return std.fmt.allocPrint(allocator, "{s}{s}", .{ self, other });
}

pub inline fn joinBuf(out: []u8, parts: anytype, comptime parts_len: usize) []u8 {
    var remain = out;
    var count: usize = 0;
    comptime var i: usize = 0;
    inline while (i < parts_len) : (i += 1) {
        const part = parts[i];
        std.mem.copy(u8, remain, part);
        remain = remain[part.len..];
        count += part.len;
    }

    return out[0..count];
}

pub fn index(self: string, str: string) i32 {
    if (std.mem.indexOf(u8, self, str)) |i| {
        return @intCast(i32, i);
    } else {
        return -1;
    }
}

pub fn eqlUtf16(comptime self: string, other: []const u16) bool {
    return std.mem.eql(u16, std.unicode.utf8ToUtf16LeStringLiteral(self), other);
}

pub fn toUTF8Alloc(allocator: *std.mem.Allocator, js: []const u16) !string {
    var temp: [4]u8 = undefined;
    var list = std.ArrayList(u8).initCapacity(allocator, js.len) catch unreachable;
    var i: usize = 0;
    while (i < js.len) : (i += 1) {
        var r1 = @as(i32, js[i]);
        if (r1 >= 0xD800 and r1 <= 0xDBFF and i + 1 < js.len) {
            const r2 = @as(i32, js[i] + 1);
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
pub fn utf16EqlString(text: []const u16, str: string) bool {
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

pub fn containsNonBmpCodePointUTF16(_text: []const u16) bool {
    const n = _text.len;
    if (n > 0) {
        var i: usize = 0;
        var text = _text[0 .. n - 1];
        while (i < n - 1) : (i += 1) {
            switch (text[i]) {
                // Check for a high surrogate
                0xD800...0xDBFF => {
                    // Check for a low surrogate
                    switch (text[i + 1]) {
                        0xDC00...0xDFFF => {
                            return true;
                        },
                        else => {},
                    }
                },
                else => {},
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

pub fn isASCIIHexDigit(c: u8) bool {
    return std.ascii.isDigit(c) or std.ascii.isXDigit(c);
}

pub fn toASCIIHexValue(character: u8) u8 {
    std.debug.assert(isASCIIHexDigit(character));
    return switch (character) {
        0...('A' - 1) => character - '0',
        else => (character - 'A' + 10) & 0xF,
    };
}

pub inline fn utf8ByteSequenceLength(first_byte: u8) u3 {
    return switch (first_byte) {
        0b0000_0000...0b0111_1111 => 1,
        0b1100_0000...0b1101_1111 => 2,
        0b1110_0000...0b1110_1111 => 3,
        0b1111_0000...0b1111_0111 => 4,
        else => 0,
    };
}

pub inline fn utf8ByteSequenceLength32(first_byte: u8) u32 {
    return switch (first_byte) {
        0b0000_0000...0b0111_1111 => 1,
        0b1100_0000...0b1101_1111 => 2,
        0b1110_0000...0b1110_1111 => 3,
        0b1111_0000...0b1111_0111 => 4,
        else => 0,
    };
}

pub fn NewCodePointIterator(comptime CodePointType: type, comptime zeroValue: comptime_int) type {
    return struct {
        const Iterator = @This();
        bytes: []const u8,
        i: usize,
        next_width: usize = 0,
        width: u3 = 0,
        c: CodePointType = zeroValue,

        pub const Cursor = struct {
            i: u32 = 0,
            c: CodePointType = zeroValue,
            width: u3 = 0,
        };

        pub fn init(str: string) Iterator {
            return Iterator{ .bytes = str, .i = 0, .c = zeroValue };
        }

        pub fn initOffset(str: string, i: usize) Iterator {
            return Iterator{ .bytes = str, .i = i, .c = zeroValue };
        }

        pub inline fn next(it: *const Iterator, cursor: *Cursor) bool {
            const pos: u32 = @as(u32, cursor.width) + cursor.i;
            if (pos >= it.bytes.len) {
                return false;
            }

            const cp_len = utf8ByteSequenceLength(it.bytes[pos]);
            cursor.* = Cursor{
                .i = pos,
                .c = @as(
                    CodePointType,
                    switch (cp_len) {
                        1 => it.bytes[pos],
                        2 => std.unicode.utf8Decode2(it.bytes[pos..][0..2]) catch return false,
                        3 => std.unicode.utf8Decode3(it.bytes[pos..][0..3]) catch return false,
                        4 => std.unicode.utf8Decode4(it.bytes[pos..][0..4]) catch return false,
                        else => return false,
                    },
                ),
                .width = cp_len,
            };
            return true;
        }

        inline fn nextCodepointSlice(it: *Iterator) []const u8 {
            const bytes = it.bytes;
            const prev = it.i;
            const next_ = prev + it.next_width;
            if (bytes.len <= next_) return "";

            const cp_len = utf8ByteSequenceLength(bytes[next_]);
            it.next_width = cp_len;
            it.i = @minimum(next_, bytes.len);

            const slice = bytes[prev..][0..cp_len];
            it.width = @intCast(u3, slice.len);
            return slice;
        }

        pub fn needsUTF8Decoding(slice: string) bool {
            var it = Iterator{ .bytes = slice, .i = 0 };

            while (true) {
                const part = it.nextCodepointSlice();
                @setRuntimeSafety(false);
                switch (part.len) {
                    0 => return false,
                    1 => continue,
                    else => return true,
                }
            }
        }

        pub fn scanUntilQuotedValueOrEOF(iter: *Iterator, comptime quote: CodePointType) usize {
            while (iter.c > -1) {
                if (!switch (iter.nextCodepoint()) {
                    quote => false,
                    '\\' => brk: {
                        if (iter.nextCodepoint() == quote) {
                            continue;
                        }
                        break :brk true;
                    },
                    else => true,
                }) {
                    return iter.i + 1;
                }
            }

            return iter.i;
        }

        pub fn nextCodepoint(it: *Iterator) CodePointType {
            const slice = it.nextCodepointSlice();

            it.c = switch (slice.len) {
                0 => zeroValue,
                1 => @intCast(CodePointType, slice[0]),
                2 => @intCast(CodePointType, std.unicode.utf8Decode2(slice) catch unreachable),
                3 => @intCast(CodePointType, std.unicode.utf8Decode3(slice) catch unreachable),
                4 => @intCast(CodePointType, std.unicode.utf8Decode4(slice) catch unreachable),
                else => unreachable,
            };

            return it.c;
        }

        pub fn nextCodepointNullable(it: *Iterator) ?CodePointType {
            const slice = it.nextCodepointSlice();
            if (slice.len == 0) return null;

            it.c = switch (slice.len) {
                1 => @intCast(CodePointType, slice[0]),
                2 => @intCast(CodePointType, std.unicode.utf8Decode2(slice) catch unreachable),
                3 => @intCast(CodePointType, std.unicode.utf8Decode3(slice) catch unreachable),
                4 => @intCast(CodePointType, std.unicode.utf8Decode4(slice) catch unreachable),
                else => unreachable,
            };

            return it.c;
        }

        pub fn nextCodepointNoReturn(it: *Iterator) void {
            const slice = it.nextCodepointSlice();

            it.c = switch (slice.len) {
                0 => zeroValue,
                1 => @intCast(CodePointType, slice[0]),
                2 => @intCast(CodePointType, std.unicode.utf8Decode2(slice) catch unreachable),
                3 => @intCast(CodePointType, std.unicode.utf8Decode3(slice) catch unreachable),
                4 => @intCast(CodePointType, std.unicode.utf8Decode4(slice) catch unreachable),
                else => unreachable,
            };
        }

        /// Look ahead at the next n codepoints without advancing the iterator.
        /// If fewer than n codepoints are available, then return the remainder of the string.
        pub fn peek(it: *Iterator, n: usize) []const u8 {
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
}

pub const CodepointIterator = NewCodePointIterator(CodePoint, -1);
pub const UnsignedCodepointIterator = NewCodePointIterator(u32, 0);

pub fn NewLengthSorter(comptime Type: type, comptime field: string) type {
    return struct {
        const LengthSorter = @This();
        pub fn lessThan(context: LengthSorter, lhs: Type, rhs: Type) bool {
            return @field(lhs, field).len < @field(rhs, field).len;
        }
    };
}

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
