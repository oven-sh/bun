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

test "eqlComptimeCheckLen" {
    try std.testing.expectEqual(eqlComptime("bun-darwin-aarch64.zip", "bun-darwin-aarch64.zip"), true);
    const sizes = [_]u8{ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 22, 24 };
    inline for (sizes) |size| {
        var buf: [size]u8 = undefined;
        std.mem.set(u8, &buf, 'a');
        var buf_copy: [size]u8 = undefined;
        std.mem.set(u8, &buf_copy, 'a');

        var bad: [size]u8 = undefined;
        std.mem.set(u8, &bad, 'b');
        try std.testing.expectEqual(std.mem.eql(u8, &buf, &buf_copy), eqlComptime(&buf, comptime brk: {
            var buf_copy_: [size]u8 = undefined;
            std.mem.set(u8, &buf_copy_, 'a');
            break :brk buf_copy_;
        }));

        try std.testing.expectEqual(std.mem.eql(u8, &buf, &bad), eqlComptime(&bad, comptime brk: {
            var buf_copy_: [size]u8 = undefined;
            std.mem.set(u8, &buf_copy_, 'a');
            break :brk buf_copy_;
        }));
    }
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

pub inline fn endsWithComptime(self: string, comptime str: anytype) bool {
    return self.len >= str.len and eqlComptimeIgnoreLen(self[self.len - str.len .. self.len], comptime str);
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

inline fn eqlComptimeCheckLen(a: string, comptime b: anytype, comptime check_len: bool) bool {
    if (comptime check_len) {
        if (comptime b.len == 0) {
            return a.len == 0;
        }

        switch (a.len) {
            b.len => {},
            else => return false,
        }
    }

    const len = comptime b.len;
    comptime var dword_length = b.len >> 3;
    comptime var b_ptr: usize = 0;

    inline while (dword_length > 0) : (dword_length -= 1) {
        const slice = comptime if (@typeInfo(@TypeOf(b)) != .Pointer) b else std.mem.span(b);
        if (@bitCast(usize, a[b_ptr..][0..@sizeOf(usize)].*) != comptime @bitCast(usize, (slice[b_ptr..])[0..@sizeOf(usize)].*))
            return false;
        comptime b_ptr += @sizeOf(usize);
        if (comptime b_ptr == b.len) return true;
    }

    if (comptime @sizeOf(usize) == 8) {
        if (comptime (len & 4) != 0) {
            const slice = comptime if (@typeInfo(@TypeOf(b)) != .Pointer) b else std.mem.span(b);
            if (@bitCast(u32, a[b_ptr..][0..@sizeOf(u32)].*) != comptime @bitCast(u32, (slice[b_ptr..])[0..@sizeOf(u32)].*))
                return false;

            comptime b_ptr += @sizeOf(u32);

            if (comptime b_ptr == b.len) return true;
        }
    }

    if (comptime (len & 2) != 0) {
        const slice = comptime if (@typeInfo(@TypeOf(b)) != .Pointer) b else std.mem.span(b);
        if (@bitCast(u16, a[b_ptr..][0..@sizeOf(u16)].*) != comptime @bitCast(u16, slice[b_ptr .. b_ptr + @sizeOf(u16)].*))
            return false;

        comptime b_ptr += @sizeOf(u16);

        if (comptime b_ptr == b.len) return true;
    }

    if ((comptime (len & 1) != 0) and a[b_ptr] != comptime b[b_ptr]) return false;

    return true;
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
        try list.appendSlice(temp[0..width]);
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
pub fn encodeWTF8Rune(p: *[4]u8, r: i32) u3 {
    return @call(
        .{
            .modifier = .always_inline,
        },
        encodeWTF8RuneT,
        .{
            p,
            u32,
            @intCast(u32, r),
        },
    );
}

pub fn encodeWTF8RuneT(p: *[4]u8, comptime R: type, r: R) u3 {
    switch (r) {
        0...0x7F => {
            p[0] = @intCast(u8, r);
            return 1;
        },
        (0x7F + 1)...0x7FF => {
            p[0] = @truncate(u8, 0xC0 | ((r >> 6)));
            p[1] = @truncate(u8, 0x80 | (r & 0x3F));
            return 2;
        },
        (0x7FF + 1)...0xFFFF => {
            p[0] = @truncate(u8, 0xE0 | ((r >> 12)));
            p[1] = @truncate(u8, 0x80 | ((r >> 6) & 0x3F));
            p[2] = @truncate(u8, 0x80 | (r & 0x3F));
            return 3;
        },
        else => {
            p[0] = @truncate(u8, 0xF0 | ((r >> 18)));
            p[1] = @truncate(u8, 0x80 | ((r >> 12) & 0x3F));
            p[2] = @truncate(u8, 0x80 | ((r >> 6) & 0x3F));
            p[3] = @truncate(u8, 0x80 | (r & 0x3F));
            return 4;
        },
    }
}

pub inline fn wtf8ByteSequenceLength(first_byte: u8) u3 {
    return switch (first_byte) {
        0 => 0,
        1...0x80 - 1 => 1,
        else => if ((first_byte & 0xE0) == 0xC0)
            @as(u3, 2)
        else if ((first_byte & 0xF0) == 0xE0)
            @as(u3, 3)
        else if ((first_byte & 0xF8) == 0xF0)
            @as(u3, 4)
        else
            @as(u3, 1),
    };
}

/// Convert potentially ill-formed UTF-8 or UTF-16 bytes to a Unicode Codepoint.
/// Invalid codepoints are replaced with `zero` parameter
/// This is a clone of esbuild's decodeWTF8Rune
/// which was a clone of golang's "utf8.DecodeRune" that was modified to decode using WTF-8 instead.
/// Asserts a multi-byte codepoint
pub inline fn decodeWTF8RuneTMultibyte(p: *const [4]u8, len: u3, comptime T: type, comptime zero: T) T {
    std.debug.assert(len > 1);

    const s1 = p[1];
    if ((s1 & 0xC0) != 0x80) return zero;

    if (len == 2) {
        const cp = @as(T, p[0] & 0x1F) << 6 | @as(T, s1 & 0x3F);
        if (cp < 0x80) return zero;
        return cp;
    }

    const s2 = p[2];

    if ((s2 & 0xC0) != 0x80) return zero;

    if (len == 3) {
        const cp = (@as(T, p[0] & 0x0F) << 12) | (@as(T, s1 & 0x3F) << 6) | (@as(T, s2 & 0x3F));
        if (cp < 0x800) return zero;
        return cp;
    }

    const s3 = p[3];
    {
        const cp = (@as(T, p[0] & 0x07) << 18) | (@as(T, s1 & 0x3F) << 12) | (@as(T, s2 & 0x3F) << 6) | (@as(T, s3 & 0x3F));
        if (cp < 0x10000 or cp > 0x10FFFF) return zero;
        return cp;
    }

    unreachable;
}

/// Convert potentially ill-formed UTF-8 or UTF-16 bytes to a Unicode Codepoint.
/// - Invalid codepoints are replaced with `zero` parameter
/// - Null bytes return 0
pub fn decodeWTF8RuneT(p: *const [4]u8, len: u3, comptime T: type, comptime zero: T) T {
    if (len == 0) return zero;
    if (len == 1) return p[0];

    return decodeWTF8RuneTMultibyte(p, len, T, zero);
}

pub fn codepointSize(comptime R: type, r: R) u3 {
    return switch (r) {
        0b0000_0000...0b0111_1111 => 1,
        0b1100_0000...0b1101_1111 => 2,
        0b1110_0000...0b1110_1111 => 3,
        0b1111_0000...0b1111_0111 => 4,
        else => 0,
    };
}

// /// Encode Type into UTF-8 bytes.
// /// - Invalid unicode data becomes U+FFFD REPLACEMENT CHARACTER.
// /// -
// pub fn encodeUTF8RuneT(out: *[4]u8, comptime R: type, c: R) u3 {
//     switch (c) {
//         0b0000_0000...0b0111_1111 => {
//             out[0] = @intCast(u8, c);
//             return 1;
//         },
//         0b1100_0000...0b1101_1111 => {
//             out[0] = @truncate(u8, 0b11000000 | (c >> 6));
//             out[1] = @truncate(u8, 0b10000000 | c & 0b111111);
//             return 2;
//         },

//         0b1110_0000...0b1110_1111 => {
//             if (0xd800 <= c and c <= 0xdfff) {
//                 // Replacement character
//                 out[0..3].* = [_]u8{ 0xEF, 0xBF, 0xBD };

//                 return 3;
//             }

//             out[0] = @truncate(u8, 0b11100000 | (c >> 12));
//             out[1] = @truncate(u8, 0b10000000 | (c >> 6) & 0b111111);
//             out[2] = @truncate(u8, 0b10000000 | c & 0b111111);
//             return 3;
//         },
//         0b1111_0000...0b1111_0111 => {
//             out[0] = @truncate(u8, 0b11110000 | (c >> 18));
//             out[1] = @truncate(u8, 0b10000000 | (c >> 12) & 0b111111);
//             out[2] = @truncate(u8, 0b10000000 | (c >> 6) & 0b111111);
//             out[3] = @truncate(u8, 0b10000000 | c & 0b111111);
//             return 4;
//         },
//         else => {
//             // Replacement character
//             out[0..3].* = [_]u8{ 0xEF, 0xBF, 0xBD };

//             return 3;
//         },
//     }
// }

pub fn containsNonBmpCodePoint(text: string) bool {
    var iter = CodepointIterator.init(text);
    var curs = CodepointIterator.Cursor{};

    while (iter.next(&curs)) {
        if (curs.c > 0xFFFF) {
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

            const cp_len = wtf8ByteSequenceLength(it.bytes[pos]);
            const error_char = comptime std.math.minInt(CodePointType);

            const codepoint = @as(
                CodePointType,
                switch (cp_len) {
                    0 => return false,
                    1 => it.bytes[pos],
                    else => decodeWTF8RuneTMultibyte(it.bytes[pos..].ptr[0..4], cp_len, CodePointType, error_char),
                },
            );

            cursor.* = Cursor{
                .i = pos,
                .c = if (error_char != codepoint)
                    codepoint
                else
                    unicode_replacement,
                .width = if (codepoint != error_char) cp_len else 1,
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

pub const unicode_replacement = 0xFFFD;
pub const unicode_replacement_str = brk: {
    var out: [std.unicode.utf8CodepointSequenceLength(unicode_replacement) catch unreachable]u8 = undefined;
    _ = std.unicode.utf8Encode(unicode_replacement, &out) catch unreachable;
    break :brk out;
};
