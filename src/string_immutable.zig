const std = @import("std");
const expect = std.testing.expect;
const Environment = @import("./env.zig");
const string = bun.string;
const stringZ = bun.stringZ;
const CodePoint = bun.CodePoint;
const bun = @import("root").bun;
const log = bun.Output.scoped(.STR, true);
const js_lexer = @import("./js_lexer.zig");
const grapheme = @import("./grapheme.zig");
const JSC = bun.JSC;

pub const Encoding = enum {
    ascii,
    utf8,
    latin1,
    utf16,
};

/// Returned by classification functions that do not discriminate between utf8 and ascii.
pub const EncodingNonAscii = enum {
    utf8,
    utf16,
    latin1,
};

pub inline fn containsChar(self: string, char: u8) bool {
    return indexOfChar(self, char) != null;
}

pub inline fn contains(self: string, str: string) bool {
    return containsT(u8, self, str);
}

pub inline fn containsT(comptime T: type, self: []const T, str: []const T) bool {
    return indexOfT(T, self, str) != null;
}

pub inline fn removeLeadingDotSlash(slice: []const u8) []const u8 {
    if (slice.len >= 2) {
        if ((@as(u16, @bitCast(slice[0..2].*)) == comptime std.mem.readInt(u16, "./", .little)) or
            (Environment.isWindows and @as(u16, @bitCast(slice[0..2].*)) == comptime std.mem.readInt(u16, ".\\", .little)))
        {
            return slice[2..];
        }
    }
    return slice;
}

// TODO: remove this
pub const w = toUTF16Literal;

pub fn toUTF16Literal(comptime str: []const u8) [:0]const u16 {
    return comptime literal(u16, str);
}

pub fn literal(comptime T: type, comptime str: []const u8) *const [literalLength(T, str):0]T {
    if (!@inComptime()) @compileError("strings.literal() must be called in a comptime context");
    return comptime switch (T) {
        u8 => brk: {
            var data: [str.len:0]u8 = undefined;
            @memcpy(&data, str);
            const final = data[0..].*;
            break :brk &final;
        },
        u16 => return std.unicode.utf8ToUtf16LeStringLiteral(str),
        else => @compileError("unsupported type " ++ @typeName(T) ++ " in strings.literal() call."),
    };
}

fn literalLength(comptime T: type, comptime str: string) usize {
    return comptime switch (T) {
        u8 => str.len,
        u16 => std.unicode.calcUtf16LeLen(str) catch unreachable,
        else => 0, // let other errors report first
    };
}

// TODO: remove this
pub const toUTF16LiteralZ = toUTF16Literal;

pub const OptionalUsize = std.meta.Int(.unsigned, @bitSizeOf(usize) - 1);
pub fn indexOfAny(slice: string, comptime str: []const u8) ?OptionalUsize {
    switch (comptime str.len) {
        0 => @compileError("str cannot be empty"),
        1 => return indexOfChar(slice, str[0]),
        else => {},
    }

    var remaining = slice;
    if (remaining.len == 0) return null;

    if (comptime Environment.enableSIMD) {
        while (remaining.len >= ascii_vector_size) {
            const vec: AsciiVector = remaining[0..ascii_vector_size].*;
            var cmp: AsciiVectorU1 = @bitCast(vec == @as(AsciiVector, @splat(@as(u8, str[0]))));
            inline for (str[1..]) |c| {
                cmp |= @bitCast(vec == @as(AsciiVector, @splat(@as(u8, c))));
            }

            if (@reduce(.Max, cmp) > 0) {
                const bitmask = @as(AsciiVectorInt, @bitCast(cmp));
                const first = @ctz(bitmask);

                return @as(OptionalUsize, @intCast(first + slice.len - remaining.len));
            }

            remaining = remaining[ascii_vector_size..];
        }

        if (comptime Environment.allow_assert) assert(remaining.len < ascii_vector_size);
    }

    for (remaining, 0..) |c, i| {
        if (strings.indexOfChar(str, c) != null) {
            return @as(OptionalUsize, @intCast(i + slice.len - remaining.len));
        }
    }

    return null;
}

pub fn indexOfAny16(self: []const u16, comptime str: anytype) ?OptionalUsize {
    return indexOfAnyT(u16, self, str);
}

pub fn indexOfAnyT(comptime T: type, str: []const T, comptime chars: anytype) ?OptionalUsize {
    if (T == u8) return indexOfAny(str, chars);
    for (str, 0..) |c, i| {
        inline for (chars) |a| {
            if (c == a) {
                return @as(OptionalUsize, @intCast(i));
            }
        }
    }

    return null;
}

pub inline fn containsComptime(self: string, comptime str: string) bool {
    if (comptime str.len == 0) @compileError("Don't call this with an empty string plz.");

    const start = std.mem.indexOfScalar(u8, self, str[0]) orelse return false;
    var remain = self[start..];
    const Int = std.meta.Int(.unsigned, str.len * 8);

    while (remain.len >= comptime str.len) {
        if (@as(Int, @bitCast(remain.ptr[0..str.len].*)) == @as(Int, @bitCast(str.ptr[0..str.len].*))) {
            return true;
        }

        const next_start = std.mem.indexOfScalar(u8, remain[1..], str[0]) orelse return false;
        remain = remain[1 + next_start ..];
    }

    return false;
}
pub const includes = contains;

pub fn inMapCaseInsensitive(self: string, comptime ComptimeStringMap: anytype) ?ComptimeStringMap.Value {
    return bun.String.static(self).inMapCaseInsensitive(ComptimeStringMap);
}

pub inline fn containsAny(in: anytype, target: string) bool {
    for (in) |str| if (contains(if (@TypeOf(str) == u8) &[1]u8{str} else bun.span(str), target)) return true;
    return false;
}

/// https://docs.npmjs.com/cli/v8/configuring-npm/package-json
/// - The name must be less than or equal to 214 characters. This includes the scope for scoped packages.
/// - The names of scoped packages can begin with a dot or an underscore. This is not permitted without a scope.
/// - New packages must not have uppercase letters in the name.
/// - The name ends up being part of a URL, an argument on the command line, and
///   a folder name. Therefore, the name can't contain any non-URL-safe
///   characters.
pub inline fn isNPMPackageName(target: string) bool {
    if (target.len == 0) return false;
    if (target.len > 214) return false;

    const scoped = switch (target[0]) {
        // Old packages may have capital letters
        'A'...'Z', 'a'...'z', '0'...'9', '$', '-' => false,
        '@' => true,
        else => return false,
    };

    var slash_index: usize = 0;
    for (target[1..], 0..) |c, i| {
        switch (c) {
            // Old packages may have capital letters
            'A'...'Z', 'a'...'z', '0'...'9', '-', '_', '.' => {},
            '/' => {
                if (!scoped) return false;
                if (slash_index > 0) return false;
                slash_index = i + 1;
            },
            // issue#7045, package "@~3/svelte_mount"
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent#description
            // It escapes all characters except: A–Z a–z 0–9 - _ . ! ~ * ' ( )
            '!', '~', '*', '\'', '(', ')' => {
                if (!scoped or slash_index > 0) return false;
            },
            else => return false,
        }
    }

    return !scoped or slash_index > 0 and slash_index + 1 < target.len;
}

pub inline fn indexAnyComptime(target: string, comptime chars: string) ?usize {
    for (target, 0..) |parent, i| {
        inline for (chars) |char| {
            if (char == parent) return i;
        }
    }
    return null;
}

pub inline fn indexAnyComptimeT(comptime T: type, target: []const T, comptime chars: []const T) ?usize {
    for (target, 0..) |parent, i| {
        inline for (chars) |char| {
            if (char == parent) return i;
        }
    }
    return null;
}

pub inline fn indexEqualAny(in: anytype, target: string) ?usize {
    for (in, 0..) |str, i| if (eqlLong(str, target, true)) return i;
    return null;
}

pub fn repeatingAlloc(allocator: std.mem.Allocator, count: usize, char: u8) ![]u8 {
    const buf = try allocator.alloc(u8, count);
    repeatingBuf(buf, char);
    return buf;
}

pub fn repeatingBuf(self: []u8, char: u8) void {
    @memset(self, char);
}

pub fn indexOfCharNeg(self: string, char: u8) i32 {
    for (self, 0..) |c, i| {
        if (c == char) return @as(i32, @intCast(i));
    }
    return -1;
}

pub fn indexOfSigned(self: string, str: string) i32 {
    const i = std.mem.indexOf(u8, self, str) orelse return -1;
    return @as(i32, @intCast(i));
}

pub inline fn lastIndexOfChar(self: []const u8, char: u8) ?usize {
    if (comptime Environment.isLinux) {
        if (@inComptime()) {
            return lastIndexOfCharT(u8, self, char);
        }
        const start = bun.C.memrchr(self.ptr, char, self.len) orelse return null;
        const i = @intFromPtr(start) - @intFromPtr(self.ptr);
        return @intCast(i);
    }
    return lastIndexOfCharT(u8, self, char);
}

pub inline fn lastIndexOfCharT(comptime T: type, self: []const T, char: T) ?usize {
    return std.mem.lastIndexOfScalar(T, self, char);
}

pub inline fn lastIndexOf(self: string, str: string) ?usize {
    return std.mem.lastIndexOf(u8, self, str);
}

pub inline fn indexOf(self: string, str: string) ?usize {
    if (comptime !bun.Environment.isNative) {
        return std.mem.indexOf(u8, self, str);
    }

    const self_len = self.len;
    const str_len = str.len;

    // > Both old and new libc's have the bug that if needle is empty,
    // > haystack-1 (instead of haystack) is returned. And glibc 2.0 makes it
    // > worse, returning a pointer to the last byte of haystack. This is fixed
    // > in glibc 2.1.
    if (self_len == 0 or str_len == 0 or self_len < str_len)
        return null;

    const self_ptr = self.ptr;
    const str_ptr = str.ptr;

    if (str_len == 1)
        return indexOfCharUsize(self, str_ptr[0]);

    const start = bun.C.memmem(self_ptr, self_len, str_ptr, str_len) orelse return null;

    const i = @intFromPtr(start) - @intFromPtr(self_ptr);
    bun.unsafeAssert(i < self_len);
    return @as(usize, @intCast(i));
}

pub fn indexOfT(comptime T: type, haystack: []const T, needle: []const T) ?usize {
    if (T == u8) return indexOf(haystack, needle);
    return std.mem.indexOf(T, haystack, needle);
}

pub fn split(self: string, delimiter: string) SplitIterator {
    return SplitIterator{
        .buffer = self,
        .index = 0,
        .delimiter = delimiter,
    };
}

pub const SplitIterator = struct {
    buffer: []const u8,
    index: ?usize,
    delimiter: []const u8,

    const Self = @This();

    /// Returns a slice of the first field. This never fails.
    /// Call this only to get the first field and then use `next` to get all subsequent fields.
    pub fn first(self: *Self) []const u8 {
        bun.unsafeAssert(self.index.? == 0);
        return self.next().?;
    }

    /// Returns a slice of the next field, or null if splitting is complete.
    pub fn next(self: *Self) ?[]const u8 {
        const start = self.index orelse return null;
        const end = if (indexOf(self.buffer[start..], self.delimiter)) |delim_start| blk: {
            const del = delim_start + start;
            self.index = del + self.delimiter.len;
            break :blk delim_start + start;
        } else blk: {
            self.index = null;
            break :blk self.buffer.len;
        };

        return self.buffer[start..end];
    }

    /// Returns a slice of the remaining bytes. Does not affect iterator state.
    pub fn rest(self: Self) []const u8 {
        const end = self.buffer.len;
        const start = self.index orelse end;
        return self.buffer[start..end];
    }

    /// Resets the iterator to the initial slice.
    pub fn reset(self: *Self) void {
        self.index = 0;
    }
};

// --
// This is faster when the string is found, by about 2x for a 8 MB file.
// It is slower when the string is NOT found
// fn indexOfPosN(comptime T: type, buf: []const u8, start_index: usize, delimiter: []const u8, comptime n: comptime_int) ?usize {
//     const k = delimiter.len;
//     const V8x32 = @Vector(n, T);
//     const V1x32 = @Vector(n, u1);
//     const Vbx32 = @Vector(n, bool);
//     const first = @splat(n, delimiter[0]);
//     const last = @splat(n, delimiter[k - 1]);

//     var end: usize = start_index + n;
//     var start: usize = end - n;
//     while (end < buf.len) {
//         start = end - n;
//         const last_end = @min(end + k - 1, buf.len);
//         const last_start = last_end - n;

//         // Look for the first character in the delimter
//         const first_chunk: V8x32 = buf[start..end][0..n].*;
//         const last_chunk: V8x32 = buf[last_start..last_end][0..n].*;
//         const mask = @bitCast(V1x32, first == first_chunk) & @bitCast(V1x32, last == last_chunk);

//         if (@reduce(.Or, mask) != 0) {
//             // TODO: Use __builtin_clz???
//             for (@as([n]bool, @bitCast(Vbx32, mask))) |match, i| {
//                 if (match and eqlLong(buf[start + i .. start + i + k], delimiter, false)) {
//                     return start + i;
//                 }
//             }
//         }
//         end = @min(end + n, buf.len);
//     }
//     if (start < buf.len) return std.mem.indexOfPos(T, buf, start_index, delimiter);
//     return null; // Not found
// }

pub fn cat(allocator: std.mem.Allocator, first: string, second: string) !string {
    var out = try allocator.alloc(u8, first.len + second.len);
    bun.copy(u8, out, first);
    bun.copy(u8, out[first.len..], second);
    return out;
}

// 31 character string or a slice
pub const StringOrTinyString = struct {
    pub const Max = 31;
    const Buffer = [Max]u8;

    remainder_buf: Buffer = undefined,
    meta: packed struct {
        remainder_len: u7 = 0,
        is_tiny_string: u1 = 0,
    } = .{},

    comptime {
        bun.unsafeAssert(@sizeOf(@This()) == 32);
    }

    pub inline fn slice(this: *const StringOrTinyString) []const u8 {
        // This is a switch expression instead of a statement to make sure it uses the faster assembly
        return switch (this.meta.is_tiny_string) {
            1 => this.remainder_buf[0..this.meta.remainder_len],
            0 => @as([*]const u8, @ptrFromInt(std.mem.readInt(usize, this.remainder_buf[0..@sizeOf(usize)], .little)))[0..std.mem.readInt(usize, this.remainder_buf[@sizeOf(usize) .. @sizeOf(usize) * 2], .little)],
        };
    }

    pub fn deinit(this: *StringOrTinyString, _: std.mem.Allocator) void {
        if (this.meta.is_tiny_string == 1) return;

        // var slice_ = this.slice();
        // allocator.free(slice_);
    }

    pub fn initAppendIfNeeded(stringy: string, comptime Appender: type, appendy: Appender) !StringOrTinyString {
        if (stringy.len <= StringOrTinyString.Max) {
            return StringOrTinyString.init(stringy);
        }

        return StringOrTinyString.init(try appendy.append(string, stringy));
    }

    pub fn initLowerCaseAppendIfNeeded(stringy: string, comptime Appender: type, appendy: Appender) !StringOrTinyString {
        if (stringy.len <= StringOrTinyString.Max) {
            return StringOrTinyString.initLowerCase(stringy);
        }

        return StringOrTinyString.init(try appendy.appendLowerCase(string, stringy));
    }

    pub fn init(stringy: string) StringOrTinyString {
        switch (stringy.len) {
            0 => {
                return StringOrTinyString{ .meta = .{
                    .is_tiny_string = 1,
                    .remainder_len = 0,
                } };
            },
            1...(@sizeOf(Buffer)) => {
                @setRuntimeSafety(false);
                var tiny = StringOrTinyString{ .meta = .{
                    .is_tiny_string = 1,
                    .remainder_len = @as(u7, @truncate(stringy.len)),
                } };
                @memcpy(tiny.remainder_buf[0..tiny.meta.remainder_len], stringy[0..tiny.meta.remainder_len]);
                return tiny;
            },
            else => {
                var tiny = StringOrTinyString{ .meta = .{
                    .is_tiny_string = 0,
                    .remainder_len = 0,
                } };
                std.mem.writeInt(usize, tiny.remainder_buf[0..@sizeOf(usize)], @intFromPtr(stringy.ptr), .little);
                std.mem.writeInt(usize, tiny.remainder_buf[@sizeOf(usize) .. @sizeOf(usize) * 2], stringy.len, .little);
                return tiny;
            },
        }
    }

    pub fn initLowerCase(stringy: string) StringOrTinyString {
        switch (stringy.len) {
            0 => {
                return StringOrTinyString{ .meta = .{
                    .is_tiny_string = 1,
                    .remainder_len = 0,
                } };
            },
            1...(@sizeOf(Buffer)) => {
                @setRuntimeSafety(false);
                var tiny = StringOrTinyString{ .meta = .{
                    .is_tiny_string = 1,
                    .remainder_len = @as(u7, @truncate(stringy.len)),
                } };
                _ = copyLowercase(stringy, &tiny.remainder_buf);
                return tiny;
            },
            else => {
                var tiny = StringOrTinyString{ .meta = .{
                    .is_tiny_string = 0,
                    .remainder_len = 0,
                } };
                std.mem.writeInt(usize, tiny.remainder_buf[0..@sizeOf(usize)], @intFromPtr(stringy.ptr), .little);
                std.mem.writeInt(usize, tiny.remainder_buf[@sizeOf(usize) .. @sizeOf(usize) * 2], stringy.len, .little);
                return tiny;
            },
        }
    }
};

pub fn copyLowercase(in: string, out: []u8) string {
    var in_slice = in;
    var out_slice = out;

    begin: while (true) {
        for (in_slice, 0..) |c, i| {
            switch (c) {
                'A'...'Z' => {
                    bun.copy(u8, out_slice, in_slice[0..i]);
                    out_slice[i] = std.ascii.toLower(c);
                    const end = i + 1;
                    in_slice = in_slice[end..];
                    out_slice = out_slice[end..];
                    continue :begin;
                },
                else => {},
            }
        }

        bun.copy(u8, out_slice, in_slice);
        break :begin;
    }

    return out[0..in.len];
}

pub fn copyLowercaseIfNeeded(in: string, out: []u8) string {
    var in_slice = in;
    var out_slice = out;
    var any = false;

    begin: while (true) {
        for (in_slice, 0..) |c, i| {
            switch (c) {
                'A'...'Z' => {
                    bun.copy(u8, out_slice, in_slice[0..i]);
                    out_slice[i] = std.ascii.toLower(c);
                    const end = i + 1;
                    in_slice = in_slice[end..];
                    out_slice = out_slice[end..];
                    any = true;
                    continue :begin;
                },
                else => {},
            }
        }

        if (any) bun.copy(u8, out_slice, in_slice);
        break :begin;
    }

    return if (any) out[0..in.len] else in;
}

/// Copy a string into a buffer
/// Return the copied version
pub fn copy(buf: []u8, src: []const u8) []const u8 {
    const len = @min(buf.len, src.len);
    if (len > 0)
        @memcpy(buf[0..len], src[0..len]);
    return buf[0..len];
}

/// startsWith except it checks for non-empty strings
pub fn hasPrefix(self: string, str: string) bool {
    return str.len > 0 and startsWith(self, str);
}

pub fn startsWith(self: string, str: string) bool {
    if (str.len > self.len) {
        return false;
    }

    return eqlLong(self[0..str.len], str, false);
}

pub fn startsWithGeneric(comptime T: type, self: []const T, str: []const T) bool {
    if (str.len > self.len) {
        return false;
    }

    return eqlLong(bun.reinterpretSlice(u8, self[0..str.len]), str, false);
}

pub inline fn endsWith(self: string, str: string) bool {
    return str.len == 0 or @call(bun.callmod_inline, std.mem.endsWith, .{ u8, self, str });
}

pub inline fn endsWithComptime(self: string, comptime str: anytype) bool {
    return self.len >= str.len and eqlComptimeIgnoreLen(self[self.len - str.len .. self.len], comptime str);
}

pub inline fn startsWithChar(self: string, char: u8) bool {
    return self.len > 0 and self[0] == char;
}

pub inline fn endsWithChar(self: string, char: u8) bool {
    return self.len > 0 and self[self.len - 1] == char;
}

pub inline fn endsWithCharOrIsZeroLength(self: string, char: u8) bool {
    return self.len == 0 or self[self.len - 1] == char;
}

pub fn withoutTrailingSlash(this: string) []const u8 {
    var href = this;
    while (href.len > 1 and (switch (href[href.len - 1]) {
        '/', '\\' => true,
        else => false,
    })) {
        href.len -= 1;
    }

    return href;
}

/// Does not strip the C:\
pub fn withoutTrailingSlashWindowsPath(this: string) []const u8 {
    if (this.len < 3 or
        this[1] != ':') return withoutTrailingSlash(this);

    var href = this;
    while (href.len > 3 and (switch (href[href.len - 1]) {
        '/', '\\' => true,
        else => false,
    })) {
        href.len -= 1;
    }

    return href;
}

/// This will remove ONE trailing slash at the end of a string,
/// but on Windows it will not remove the \ in "C:\"
pub fn pathWithoutTrailingSlashOne(str: []const u8) []const u8 {
    return if (str.len > 0 and charIsAnySlash(str[str.len - 1]))
        if (Environment.isWindows and str.len == 3 and str[1] == ':')
            // Preserve "C:\"
            str
        else
            // Remove one slash
            str[0 .. str.len - 1]
    else
        str;
}

pub fn withoutLeadingSlash(this: string) []const u8 {
    return std.mem.trimLeft(u8, this, "/");
}

pub fn withoutLeadingPathSeparator(this: string) []const u8 {
    return std.mem.trimLeft(u8, this, &.{std.fs.path.sep});
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

pub fn quotedAlloc(allocator: std.mem.Allocator, self: string) !string {
    var count: usize = 0;
    for (self) |char| {
        count += @intFromBool(char == '"');
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
        if (eqlComptimeCheckLenWithType(u8, self, item, true)) return true;
    }

    return false;
}

/// Count the occurrences of a character in an ASCII byte array
/// uses SIMD
pub fn countChar(self: string, char: u8) usize {
    var total: usize = 0;
    var remaining = self;

    const splatted: AsciiVector = @splat(char);

    while (remaining.len >= 16) {
        const vec: AsciiVector = remaining[0..ascii_vector_size].*;
        const cmp = @popCount(@as(@Vector(ascii_vector_size, u1), @bitCast(vec == splatted)));
        total += @as(usize, @reduce(.Add, cmp));
        remaining = remaining[ascii_vector_size..];
    }

    while (remaining.len > 0) {
        total += @as(usize, @intFromBool(remaining[0] == char));
        remaining = remaining[1..];
    }

    return total;
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

    for (self, 0..) |c, i| {
        if (other[i] != c) return false;
    }
    return true;
}

pub fn eqlComptimeT(comptime T: type, self: []const T, comptime alt: anytype) bool {
    if (T == u16) {
        return eqlComptimeUTF16(self, alt);
    }

    return eqlComptime(self, alt);
}

pub fn eqlComptime(self: string, comptime alt: anytype) bool {
    return eqlComptimeCheckLenWithType(u8, self, alt, true);
}

pub fn eqlComptimeUTF16(self: []const u16, comptime alt: []const u8) bool {
    return eqlComptimeCheckLenWithType(u16, self, comptime toUTF16Literal(alt), true);
}

pub fn eqlComptimeIgnoreLen(self: string, comptime alt: anytype) bool {
    return eqlComptimeCheckLenWithType(u8, self, alt, false);
}

pub fn hasPrefixComptime(self: string, comptime alt: anytype) bool {
    return self.len >= alt.len and eqlComptimeCheckLenWithType(u8, self[0..alt.len], alt, false);
}

pub fn hasPrefixComptimeUTF16(self: []const u16, comptime alt: []const u8) bool {
    return self.len >= alt.len and eqlComptimeCheckLenWithType(u16, self[0..alt.len], comptime toUTF16Literal(alt), false);
}

pub fn hasPrefixComptimeType(comptime T: type, self: []const T, comptime alt: anytype) bool {
    const rhs = comptime switch (T) {
        u8 => alt,
        u16 => switch (bun.meta.Item(@TypeOf(alt))) {
            u16 => alt,
            else => w(alt),
        },
        else => @compileError("Unsupported type given to hasPrefixComptimeType"),
    };
    return self.len >= alt.len and eqlComptimeCheckLenWithType(T, self[0..rhs.len], rhs, false);
}

pub fn hasSuffixComptime(self: string, comptime alt: anytype) bool {
    return self.len >= alt.len and eqlComptimeCheckLenWithType(u8, self[self.len - alt.len ..], alt, false);
}

inline fn eqlComptimeCheckLenU8(a: []const u8, comptime b: []const u8, comptime check_len: bool) bool {
    @setEvalBranchQuota(9999);
    if (comptime check_len) {
        if (a.len != b.len) return false;
    }

    comptime var b_ptr: usize = 0;

    inline while (b.len - b_ptr >= @sizeOf(usize)) {
        if (@as(usize, @bitCast(a[b_ptr..][0..@sizeOf(usize)].*)) != comptime @as(usize, @bitCast(b[b_ptr..][0..@sizeOf(usize)].*)))
            return false;
        comptime b_ptr += @sizeOf(usize);
        if (comptime b_ptr == b.len) return true;
    }

    if (comptime @sizeOf(usize) == 8) {
        if (comptime (b.len & 4) != 0) {
            if (@as(u32, @bitCast(a[b_ptr..][0..@sizeOf(u32)].*)) != comptime @as(u32, @bitCast(b[b_ptr..][0..@sizeOf(u32)].*)))
                return false;
            comptime b_ptr += @sizeOf(u32);
            if (comptime b_ptr == b.len) return true;
        }
    }

    if (comptime (b.len & 2) != 0) {
        if (@as(u16, @bitCast(a[b_ptr..][0..@sizeOf(u16)].*)) != comptime @as(u16, @bitCast(b[b_ptr..][0..@sizeOf(u16)].*)))
            return false;

        comptime b_ptr += @sizeOf(u16);

        if (comptime b_ptr == b.len) return true;
    }

    if ((comptime (b.len & 1) != 0) and a[b_ptr] != comptime b[b_ptr]) return false;

    return true;
}

inline fn eqlComptimeCheckLenWithKnownType(comptime Type: type, a: []const Type, comptime b: []const Type, comptime check_len: bool) bool {
    if (comptime Type != u8) {
        return eqlComptimeCheckLenU8(std.mem.sliceAsBytes(a), comptime std.mem.sliceAsBytes(b), comptime check_len);
    }
    return eqlComptimeCheckLenU8(a, comptime b, comptime check_len);
}

/// Check if two strings are equal with one of the strings being a comptime-known value
///
///   strings.eqlComptime(input, "hello world");
///   strings.eqlComptime(input, "hai");
pub inline fn eqlComptimeCheckLenWithType(comptime Type: type, a: []const Type, comptime b: anytype, comptime check_len: bool) bool {
    return eqlComptimeCheckLenWithKnownType(comptime Type, a, if (@typeInfo(@TypeOf(b)) != .Pointer) &b else b, comptime check_len);
}

pub inline fn eqlCaseInsensitiveASCIIIgnoreLength(
    a: string,
    b: string,
) bool {
    return eqlCaseInsensitiveASCII(a, b, false);
}

pub inline fn eqlCaseInsensitiveASCIIICheckLength(
    a: string,
    b: string,
) bool {
    return eqlCaseInsensitiveASCII(a, b, true);
}

pub fn eqlCaseInsensitiveASCII(a: string, b: string, comptime check_len: bool) bool {
    if (comptime check_len) {
        if (a.len != b.len) return false;
        if (a.len == 0) return true;
    }

    bun.unsafeAssert(b.len > 0);
    bun.unsafeAssert(a.len > 0);

    return bun.C.strncasecmp(a.ptr, b.ptr, a.len) == 0;
}

pub fn eqlLong(a_str: string, b_str: string, comptime check_len: bool) bool {
    const len = b_str.len;

    if (comptime check_len) {
        if (len == 0) {
            return a_str.len == 0;
        }

        if (a_str.len != len) {
            return false;
        }
    } else {
        if (comptime Environment.allow_assert) assert(b_str.len == a_str.len);
    }

    const end = b_str.ptr + len;
    var a = a_str.ptr;
    var b = b_str.ptr;

    if (a == b)
        return true;

    {
        var dword_length = len >> 3;
        while (dword_length > 0) : (dword_length -= 1) {
            if (@as(usize, @bitCast(a[0..@sizeOf(usize)].*)) != @as(usize, @bitCast(b[0..@sizeOf(usize)].*)))
                return false;
            b += @sizeOf(usize);
            if (b == end) return true;
            a += @sizeOf(usize);
        }
    }

    if (comptime @sizeOf(usize) == 8) {
        if ((len & 4) != 0) {
            if (@as(u32, @bitCast(a[0..@sizeOf(u32)].*)) != @as(u32, @bitCast(b[0..@sizeOf(u32)].*)))
                return false;

            b += @sizeOf(u32);
            if (b == end) return true;
            a += @sizeOf(u32);
        }
    }

    if ((len & 2) != 0) {
        if (@as(u16, @bitCast(a[0..@sizeOf(u16)].*)) != @as(u16, @bitCast(b[0..@sizeOf(u16)].*)))
            return false;

        b += @sizeOf(u16);

        if (b == end) return true;

        a += @sizeOf(u16);
    }

    if (((len & 1) != 0) and a[0] != b[0]) return false;

    return true;
}

pub inline fn append(allocator: std.mem.Allocator, self: string, other: string) ![]u8 {
    var buf = try allocator.alloc(u8, self.len + other.len);
    if (self.len > 0)
        @memcpy(buf[0..self.len], self);
    if (other.len > 0)
        @memcpy(buf[self.len..][0..other.len], other);
    return buf;
}

pub inline fn concatAllocT(comptime T: type, allocator: std.mem.Allocator, strs: anytype) ![]T {
    const buf = try allocator.alloc(T, len: {
        var len: usize = 0;
        inline for (strs) |s| {
            len += s.len;
        }
        break :len len;
    });

    return concatBufT(T, buf, strs) catch |e| switch (e) {
        error.NoSpaceLeft => unreachable, // exact size calculated
    };
}

pub inline fn concatBufT(comptime T: type, out: []T, strs: anytype) ![]T {
    var remain = out;
    var n: usize = 0;
    inline for (strs) |s| {
        if (s.len > remain.len) {
            return error.NoSpaceLeft;
        }
        @memcpy(remain.ptr, s);
        remain = remain[s.len..];
        n += s.len;
    }

    return out[0..n];
}

pub fn index(self: string, str: string) i32 {
    if (strings.indexOf(self, str)) |i| {
        return @as(i32, @intCast(i));
    } else {
        return -1;
    }
}

pub fn eqlUtf16(comptime self: string, other: []const u16) bool {
    if (self.len != other.len) return false;

    if (self.len == 0) return true;

    return bun.C.memcmp(bun.cast([*]const u8, self.ptr), bun.cast([*]const u8, other.ptr), self.len * @sizeOf(u16)) == 0;
}

pub fn toUTF8Alloc(allocator: std.mem.Allocator, js: []const u16) ![]u8 {
    return try toUTF8AllocWithType(allocator, []const u16, js);
}

pub fn toUTF8AllocZ(allocator: std.mem.Allocator, js: []const u16) ![:0]u8 {
    var list = std.ArrayList(u8).init(allocator);
    try toUTF8AppendToList(&list, js);
    try list.append(0);
    return list.items[0 .. list.items.len - 1 :0];
}

pub inline fn appendUTF8MachineWordToUTF16MachineWord(output: *[@sizeOf(usize) / 2]u16, input: *const [@sizeOf(usize) / 2]u8) void {
    output[0 .. @sizeOf(usize) / 2].* = @as(
        [4]u16,
        @bitCast(@as(
            @Vector(4, u16),
            @as(@Vector(4, u8), @bitCast(input[0 .. @sizeOf(usize) / 2].*)),
        )),
    );
}

pub inline fn copyU8IntoU16(output_: []u16, input_: []const u8) void {
    const output = output_;
    const input = input_;
    if (comptime Environment.allow_assert) assert(input.len <= output.len);

    // https://zig.godbolt.org/z/9rTn1orcY

    var input_ptr = input.ptr;
    var output_ptr = output.ptr;

    const last_input_ptr = input_ptr + @min(input.len, output.len);

    while (last_input_ptr != input_ptr) {
        output_ptr[0] = input_ptr[0];
        output_ptr += 1;
        input_ptr += 1;
    }
}

pub fn copyU8IntoU16WithAlignment(comptime alignment: u21, output_: []align(alignment) u16, input_: []const u8) void {
    var output = output_;
    var input = input_;
    const word = @sizeOf(usize) / 2;
    if (comptime Environment.allow_assert) assert(input.len <= output.len);

    // un-aligned data access is slow
    // so we attempt to align the data
    while (!std.mem.isAligned(@intFromPtr(output.ptr), @alignOf(u16)) and input.len >= word) {
        output[0] = input[0];
        output = output[1..];
        input = input[1..];
    }

    if (std.mem.isAligned(@intFromPtr(output.ptr), @alignOf(u16)) and input.len > 0) {
        copyU8IntoU16(@as([*]u16, @alignCast(output.ptr))[0..output.len], input);
        return;
    }

    for (input, 0..) |c, i| {
        output[i] = c;
    }
}

// pub inline fn copy(output_: []u8, input_: []const u8) void {
//     var output = output_;
//     var input = input_;
//     if (comptime Environment.allow_assert) assert(input.len <= output.len);

//     if (input.len > @sizeOf(usize) * 4) {
//         comptime var i: usize = 0;
//         inline while (i < 4) : (i += 1) {
//             appendUTF8MachineWord(output[i * @sizeOf(usize) ..][0..@sizeOf(usize)], input[i * @sizeOf(usize) ..][0..@sizeOf(usize)]);
//         }
//         output = output[4 * @sizeOf(usize) ..];
//         input = input[4 * @sizeOf(usize) ..];
//     }

//     while (input.len >= @sizeOf(usize)) {
//         appendUTF8MachineWord(output[0..@sizeOf(usize)], input[0..@sizeOf(usize)]);
//         output = output[@sizeOf(usize)..];
//         input = input[@sizeOf(usize)..];
//     }

//     for (input) |c, i| {
//         output[i] = c;
//     }
// }

pub inline fn copyU16IntoU8(output_: []u8, comptime InputType: type, input_: InputType) void {
    if (comptime Environment.allow_assert) assert(input_.len <= output_.len);
    var output = output_;
    var input = input_;
    if (comptime Environment.allow_assert) assert(input.len <= output.len);

    // https://zig.godbolt.org/z/9rTn1orcY

    const group = @as(usize, 16);
    // end at the last group of 16 bytes
    var input_ptr = input.ptr;
    var output_ptr = output.ptr;

    if (comptime Environment.enableSIMD) {
        const end_len = (@min(input.len, output.len) & ~(group - 1));
        const last_vector_ptr = input.ptr + end_len;
        while (last_vector_ptr != input_ptr) {
            const input_vec1: @Vector(group, u16) = input_ptr[0..group].*;
            inline for (0..group) |i| {
                output_ptr[i] = @as(u8, @truncate(input_vec1[i]));
            }

            output_ptr += group;
            input_ptr += group;
        }

        input.len -= end_len;
        output.len -= end_len;
    }

    const last_input_ptr = input_ptr + @min(input.len, output.len);

    while (last_input_ptr != input_ptr) {
        output_ptr[0] = @as(u8, @truncate(input_ptr[0]));
        output_ptr += 1;
        input_ptr += 1;
    }
}

const strings = @This();

pub fn copyLatin1IntoASCII(dest: []u8, src: []const u8) void {
    var remain = src;
    var to = dest;

    const non_ascii_offset = strings.firstNonASCII(remain) orelse @as(u32, @truncate(remain.len));
    if (non_ascii_offset > 0) {
        @memcpy(to[0..non_ascii_offset], remain[0..non_ascii_offset]);
        remain = remain[non_ascii_offset..];
        to = to[non_ascii_offset..];

        // ascii fast path
        if (remain.len == 0) {
            return;
        }
    }

    if (to.len >= 16 and bun.Environment.enableSIMD) {
        const vector_size = 16;
        // https://zig.godbolt.org/z/qezsY8T3W
        const remain_in_u64 = remain[0 .. remain.len - (remain.len % vector_size)];
        const to_in_u64 = to[0 .. to.len - (to.len % vector_size)];
        var remain_as_u64 = std.mem.bytesAsSlice(u64, remain_in_u64);
        var to_as_u64 = std.mem.bytesAsSlice(u64, to_in_u64);
        const end_vector_len = @min(remain_as_u64.len, to_as_u64.len);
        remain_as_u64 = remain_as_u64[0..end_vector_len];
        to_as_u64 = to_as_u64[0..end_vector_len];
        const end_ptr = remain_as_u64.ptr + remain_as_u64.len;
        // using the pointer instead of the length is super important for the codegen
        while (end_ptr != remain_as_u64.ptr) {
            const buf = remain_as_u64[0];
            // this gets auto-vectorized
            const mask = @as(u64, 0x7f7f7f7f7f7f7f7f);
            to_as_u64[0] = buf & mask;

            remain_as_u64 = remain_as_u64[1..];
            to_as_u64 = to_as_u64[1..];
        }
        remain = remain[remain_in_u64.len..];
        to = to[to_in_u64.len..];
    }

    for (to) |*to_byte| {
        to_byte.* = @as(u8, @as(u7, @truncate(remain[0])));
        remain = remain[1..];
    }
}

/// It is common on Windows to find files that are not encoded in UTF8. Most of these include
/// a 'byte-order mark' codepoint at the start of the file. The layout of this codepoint can
/// determine the encoding.
///
/// https://en.wikipedia.org/wiki/Byte_order_mark
pub const BOM = enum {
    utf8,
    utf16_le,
    utf16_be,
    utf32_le,
    utf32_be,

    pub const utf8_bytes = [_]u8{ 0xef, 0xbb, 0xbf };
    pub const utf16_le_bytes = [_]u8{ 0xff, 0xfe };
    pub const utf16_be_bytes = [_]u8{ 0xfe, 0xff };
    pub const utf32_le_bytes = [_]u8{ 0xff, 0xfe, 0x00, 0x00 };
    pub const utf32_be_bytes = [_]u8{ 0x00, 0x00, 0xfe, 0xff };

    pub fn detect(bytes: []const u8) ?BOM {
        if (bytes.len < 3) return null;
        if (eqlComptimeIgnoreLen(bytes, utf8_bytes)) return .utf8;
        if (eqlComptimeIgnoreLen(bytes, utf16_le_bytes)) {
            // if (bytes.len > 4 and eqlComptimeIgnoreLen(bytes[2..], utf32_le_bytes[2..]))
            //   return .utf32_le;
            return .utf16_le;
        }
        // if (eqlComptimeIgnoreLen(bytes, utf16_be_bytes)) return .utf16_be;
        // if (bytes.len > 4 and eqlComptimeIgnoreLen(bytes, utf32_le_bytes)) return .utf32_le;
        return null;
    }

    pub fn detectAndSplit(bytes: []const u8) struct { ?BOM, []const u8 } {
        const bom = detect(bytes);
        if (bom == null) return .{ null, bytes };
        return .{ bom, bytes[bom.?.length()..] };
    }

    pub fn getHeader(bom: BOM) []const u8 {
        return switch (bom) {
            inline else => |t| comptime &@field(BOM, @tagName(t) ++ "_bytes"),
        };
    }

    pub fn length(bom: BOM) usize {
        return switch (bom) {
            inline else => |t| comptime (&@field(BOM, @tagName(t) ++ "_bytes")).len,
        };
    }

    /// If an allocation is needed, free the input and the caller will
    /// replace it with the new return
    pub fn removeAndConvertToUTF8AndFree(bom: BOM, allocator: std.mem.Allocator, bytes: []u8) ![]u8 {
        switch (bom) {
            .utf8 => {
                bun.C.memmove(bytes.ptr, bytes.ptr + utf8_bytes.len, bytes.len - utf8_bytes.len);
                return bytes[0 .. bytes.len - utf8_bytes.len];
            },
            .utf16_le => {
                const trimmed_bytes = bytes[utf16_le_bytes.len..];
                const trimmed_bytes_u16: []const u16 = @alignCast(std.mem.bytesAsSlice(u16, trimmed_bytes));
                const out = try toUTF8Alloc(allocator, trimmed_bytes_u16);
                allocator.free(bytes);
                return out;
            },
            else => {
                // TODO: this needs to re-encode, for now we just remove the BOM
                const bom_bytes = bom.getHeader();
                bun.C.memmove(bytes.ptr, bytes.ptr + bom_bytes.len, bytes.len - bom_bytes.len);
                return bytes[0 .. bytes.len - bom_bytes.len];
            },
        }
    }

    /// This is required for fs.zig's `use_shared_buffer` flag. we cannot free that pointer.
    /// The returned slice will always point to the base of the input.
    ///
    /// Requires an arraylist in case it must be grown.
    pub fn removeAndConvertToUTF8WithoutDealloc(bom: BOM, allocator: std.mem.Allocator, list: *std.ArrayListUnmanaged(u8)) ![]u8 {
        const bytes = list.items;
        switch (bom) {
            .utf8 => {
                bun.C.memmove(bytes.ptr, bytes.ptr + utf8_bytes.len, bytes.len - utf8_bytes.len);
                return bytes[0 .. bytes.len - utf8_bytes.len];
            },
            .utf16_le => {
                const trimmed_bytes = bytes[utf16_le_bytes.len..];
                const trimmed_bytes_u16: []const u16 = @alignCast(std.mem.bytesAsSlice(u16, trimmed_bytes));
                const out = try toUTF8Alloc(allocator, trimmed_bytes_u16);
                if (list.capacity < out.len) {
                    try list.ensureTotalCapacity(allocator, out.len);
                }
                list.items.len = out.len;
                @memcpy(list.items, out);
                return out;
            },
            else => {
                // TODO: this needs to re-encode, for now we just remove the BOM
                const bom_bytes = bom.getHeader();
                bun.C.memmove(bytes.ptr, bytes.ptr + bom_bytes.len, bytes.len - bom_bytes.len);
                return bytes[0 .. bytes.len - bom_bytes.len];
            },
        }
    }
};

/// @deprecated. If you are using this, you likely will need to remove other BOMs and handle encoding.
/// Use the BOM struct's `detect` and conversion functions instead.
pub fn withoutUTF8BOM(bytes: []const u8) []const u8 {
    if (strings.hasPrefixComptime(bytes, BOM.utf8_bytes)) {
        return bytes[BOM.utf8_bytes.len..];
    } else {
        return bytes;
    }
}

/// Convert a UTF-8 string to a UTF-16 string IF there are any non-ascii characters
/// If there are no non-ascii characters, this returns null
/// This is intended to be used for strings that go to JavaScript
pub fn toUTF16Alloc(allocator: std.mem.Allocator, bytes: []const u8, comptime fail_if_invalid: bool, comptime sentinel: bool) !if (sentinel) ?[:0]u16 else ?[]u16 {
    if (strings.firstNonASCII(bytes)) |i| {
        const output_: ?std.ArrayList(u16) = if (comptime bun.FeatureFlags.use_simdutf) simd: {
            const trimmed = bun.simdutf.trim.utf8(bytes);

            if (trimmed.len == 0)
                break :simd null;

            const out_length = bun.simdutf.length.utf16.from.utf8(trimmed);

            if (out_length == 0)
                break :simd null;

            var out = try allocator.alloc(u16, out_length + if (sentinel) 1 else 0);
            log("toUTF16 {d} UTF8 -> {d} UTF16", .{ bytes.len, out_length });

            const res = bun.simdutf.convert.utf8.to.utf16.with_errors.le(trimmed, out);
            if (res.status == .success) {
                if (comptime sentinel) {
                    out[out_length] = 0;
                    return out[0 .. out_length + 1 :0];
                }
                return out;
            }

            if (comptime fail_if_invalid) {
                allocator.free(out);
                return error.InvalidByteSequence;
            }

            break :simd .{
                .items = out[0..i],
                .capacity = out.len,
                .allocator = allocator,
            };
        } else null;
        var output = output_ orelse fallback: {
            var list = try std.ArrayList(u16).initCapacity(allocator, i + 2);
            list.items.len = i;
            strings.copyU8IntoU16(list.items, bytes[0..i]);
            break :fallback list;
        };
        errdefer output.deinit();

        var remaining = bytes[i..];

        {
            const sequence: [4]u8 = switch (remaining.len) {
                0 => unreachable,
                1 => [_]u8{ remaining[0], 0, 0, 0 },
                2 => [_]u8{ remaining[0], remaining[1], 0, 0 },
                3 => [_]u8{ remaining[0], remaining[1], remaining[2], 0 },
                else => remaining[0..4].*,
            };

            const replacement = strings.convertUTF8BytesIntoUTF16(&sequence);
            if (comptime fail_if_invalid) {
                if (replacement.fail) {
                    if (comptime Environment.allow_assert) assert(replacement.code_point == unicode_replacement);
                    return error.InvalidByteSequence;
                }
            }
            remaining = remaining[@max(replacement.len, 1)..];

            //#define U16_LENGTH(c) ((uint32_t)(c)<=0xffff ? 1 : 2)
            switch (replacement.code_point) {
                0...0xffff => |c| {
                    try output.append(@as(u16, @intCast(c)));
                },
                else => |c| {
                    try output.appendSlice(&[_]u16{ strings.u16Lead(c), strings.u16Trail(c) });
                },
            }
        }

        while (strings.firstNonASCII(remaining)) |j| {
            const end = output.items.len;
            try output.ensureUnusedCapacity(j);
            output.items.len += j;
            strings.copyU8IntoU16(output.items[end..][0..j], remaining[0..j]);
            remaining = remaining[j..];

            const sequence: [4]u8 = switch (remaining.len) {
                0 => unreachable,
                1 => [_]u8{ remaining[0], 0, 0, 0 },
                2 => [_]u8{ remaining[0], remaining[1], 0, 0 },
                3 => [_]u8{ remaining[0], remaining[1], remaining[2], 0 },
                else => remaining[0..4].*,
            };

            const replacement = strings.convertUTF8BytesIntoUTF16(&sequence);
            if (comptime fail_if_invalid) {
                if (replacement.fail) {
                    if (comptime Environment.allow_assert) assert(replacement.code_point == unicode_replacement);
                    return error.InvalidByteSequence;
                }
            }
            remaining = remaining[@max(replacement.len, 1)..];

            //#define U16_LENGTH(c) ((uint32_t)(c)<=0xffff ? 1 : 2)
            switch (replacement.code_point) {
                0...0xffff => |c| {
                    try output.append(@as(u16, @intCast(c)));
                },
                else => |c| {
                    try output.appendSlice(&[_]u16{ strings.u16Lead(c), strings.u16Trail(c) });
                },
            }
        }

        if (remaining.len > 0) {
            try output.ensureTotalCapacityPrecise(output.items.len + remaining.len);

            output.items.len += remaining.len;
            strings.copyU8IntoU16(output.items[output.items.len - remaining.len ..], remaining);
        }

        if (comptime sentinel) {
            output.items[output.items.len] = 0;
            return output.items[0 .. output.items.len + 1 :0];
        }

        return output.items;
    }

    return null;
}

// this one does the thing it's named after
pub fn toUTF16AllocForReal(allocator: std.mem.Allocator, bytes: []const u8, comptime fail_if_invalid: bool, comptime sentinel: bool) !if (sentinel) [:0]u16 else []u16 {
    return (try toUTF16Alloc(allocator, bytes, fail_if_invalid, sentinel)) orelse {
        const output = try allocator.alloc(u16, bytes.len + if (sentinel) 1 else 0);
        bun.strings.copyU8IntoU16(output, bytes);

        if (comptime sentinel) {
            output[bytes.len] = 0;
            return output[0..bytes.len :0];
        }

        return output;
    };
}

pub fn toUTF16AllocNoTrim(allocator: std.mem.Allocator, bytes: []const u8, comptime fail_if_invalid: bool, comptime _: bool) !?[]u16 {
    if (strings.firstNonASCII(bytes)) |i| {
        const output_: ?std.ArrayList(u16) = if (comptime bun.FeatureFlags.use_simdutf) simd: {
            const out_length = bun.simdutf.length.utf16.from.utf8(bytes);

            if (out_length == 0)
                break :simd null;

            var out = try allocator.alloc(u16, out_length);
            log("toUTF16 {d} UTF8 -> {d} UTF16", .{ bytes.len, out_length });

            const res = bun.simdutf.convert.utf8.to.utf16.with_errors.le(bytes, out);
            if (res.status == .success) {
                return out;
            }

            if (comptime fail_if_invalid) {
                allocator.free(out);
                return error.InvalidByteSequence;
            }

            break :simd .{
                .items = out[0..i],
                .capacity = out.len,
                .allocator = allocator,
            };
        } else null;
        var output = output_ orelse fallback: {
            var list = try std.ArrayList(u16).initCapacity(allocator, i + 2);
            list.items.len = i;
            strings.copyU8IntoU16(list.items, bytes[0..i]);
            break :fallback list;
        };
        errdefer output.deinit();

        var remaining = bytes[i..];

        {
            const sequence: [4]u8 = switch (remaining.len) {
                0 => unreachable,
                1 => [_]u8{ remaining[0], 0, 0, 0 },
                2 => [_]u8{ remaining[0], remaining[1], 0, 0 },
                3 => [_]u8{ remaining[0], remaining[1], remaining[2], 0 },
                else => remaining[0..4].*,
            };

            const replacement = strings.convertUTF8BytesIntoUTF16(&sequence);
            if (comptime fail_if_invalid) {
                if (replacement.fail) {
                    if (comptime Environment.allow_assert) assert(replacement.code_point == unicode_replacement);
                    return error.InvalidByteSequence;
                }
            }
            remaining = remaining[@max(replacement.len, 1)..];

            //#define U16_LENGTH(c) ((uint32_t)(c)<=0xffff ? 1 : 2)
            switch (replacement.code_point) {
                0...0xffff => |c| {
                    try output.append(@as(u16, @intCast(c)));
                },
                else => |c| {
                    try output.appendSlice(&[_]u16{ strings.u16Lead(c), strings.u16Trail(c) });
                },
            }
        }

        while (strings.firstNonASCII(remaining)) |j| {
            const end = output.items.len;
            try output.ensureUnusedCapacity(j);
            output.items.len += j;
            strings.copyU8IntoU16(output.items[end..][0..j], remaining[0..j]);
            remaining = remaining[j..];

            const sequence: [4]u8 = switch (remaining.len) {
                0 => unreachable,
                1 => [_]u8{ remaining[0], 0, 0, 0 },
                2 => [_]u8{ remaining[0], remaining[1], 0, 0 },
                3 => [_]u8{ remaining[0], remaining[1], remaining[2], 0 },
                else => remaining[0..4].*,
            };

            const replacement = strings.convertUTF8BytesIntoUTF16(&sequence);
            if (comptime fail_if_invalid) {
                if (replacement.fail) {
                    if (comptime Environment.allow_assert) assert(replacement.code_point == unicode_replacement);
                    return error.InvalidByteSequence;
                }
            }
            remaining = remaining[@max(replacement.len, 1)..];

            //#define U16_LENGTH(c) ((uint32_t)(c)<=0xffff ? 1 : 2)
            switch (replacement.code_point) {
                0...0xffff => |c| {
                    try output.append(@as(u16, @intCast(c)));
                },
                else => |c| {
                    try output.appendSlice(&[_]u16{ strings.u16Lead(c), strings.u16Trail(c) });
                },
            }
        }

        if (remaining.len > 0) {
            try output.ensureTotalCapacityPrecise(output.items.len + remaining.len);

            output.items.len += remaining.len;
            strings.copyU8IntoU16(output.items[output.items.len - remaining.len ..], remaining);
        }

        return output.items;
    }

    return null;
}

pub fn utf16CodepointWithFFFD(comptime Type: type, input: Type) UTF16Replacement {
    const c0 = @as(u21, input[0]);

    if (c0 & ~@as(u21, 0x03ff) == 0xd800) {
        // surrogate pair
        if (input.len == 1)
            return .{
                .len = 1,
            };
        //error.DanglingSurrogateHalf;
        const c1 = @as(u21, input[1]);
        if (c1 & ~@as(u21, 0x03ff) != 0xdc00)
            if (input.len == 1) {
                return .{
                    .len = 1,
                };
            } else {
                return .{
                    .fail = true,
                    .len = 1,
                    .code_point = unicode_replacement,
                };
            };
        // return error.ExpectedSecondSurrogateHalf;

        return .{ .len = 2, .code_point = 0x10000 + (((c0 & 0x03ff) << 10) | (c1 & 0x03ff)) };
    } else if (c0 & ~@as(u21, 0x03ff) == 0xdc00) {
        // return error.UnexpectedSecondSurrogateHalf;
        return .{ .fail = true, .len = 1, .code_point = unicode_replacement };
    } else {
        return .{ .code_point = c0, .len = 1 };
    }
}

pub fn utf16Codepoint(comptime Type: type, input: Type) UTF16Replacement {
    const c0 = @as(u21, input[0]);

    if (c0 & ~@as(u21, 0x03ff) == 0xd800) {
        // surrogate pair
        if (input.len == 1)
            return .{
                .len = 1,
            };
        //error.DanglingSurrogateHalf;
        const c1 = @as(u21, input[1]);
        if (c1 & ~@as(u21, 0x03ff) != 0xdc00)
            if (input.len == 1)
                return .{
                    .len = 1,
                };
        // return error.ExpectedSecondSurrogateHalf;

        return .{ .len = 2, .code_point = 0x10000 + (((c0 & 0x03ff) << 10) | (c1 & 0x03ff)) };
    } else if (c0 & ~@as(u21, 0x03ff) == 0xdc00) {
        // return error.UnexpectedSecondSurrogateHalf;
        return .{ .len = 1 };
    } else {
        return .{ .code_point = c0, .len = 1 };
    }
}

/// Checks if a path is missing a windows drive letter. Not a perfect check,
/// but it is good enough for most cases. For windows APIs, this is used for
/// an assertion, and PosixToWinNormalizer can help make an absolute path
/// contain a drive letter.
pub fn isWindowsAbsolutePathMissingDriveLetter(comptime T: type, chars: []const T) bool {
    bun.unsafeAssert(bun.path.Platform.windows.isAbsoluteT(T, chars));
    bun.unsafeAssert(chars.len > 0);

    // 'C:\hello' -> false
    if (!(chars[0] == '/' or chars[0] == '\\')) {
        bun.unsafeAssert(chars.len > 2);
        bun.unsafeAssert(chars[1] == ':');
        return false;
    }

    // '\\hello' -> false (probably a UNC path)
    if (chars.len > 1 and
        (chars[1] == '/' or chars[1] == '\\')) return false;

    if (chars.len > 4) {
        // '\??\hello' -> false (has the NT object prefix)
        if (chars[1] == '?' and
            chars[2] == '?' and
            (chars[3] == '/' or chars[3] == '\\'))
            return false;
        // '\\?\hello' -> false (has the other NT object prefix)
        // '\\.\hello' -> false (has the NT device prefix)
        if ((chars[1] == '/' or chars[1] == '\\') and
            (chars[2] == '?' or chars[2] == '.') and
            (chars[3] == '/' or chars[3] == '\\'))
            return false;
    }

    // oh no, '/hello/world'
    // where is the drive letter!
    return true;
}

pub fn fromWPath(buf: []u8, utf16: []const u16) [:0]const u8 {
    bun.unsafeAssert(buf.len > 0);
    const encode_into_result = copyUTF16IntoUTF8(buf[0 .. buf.len - 1], []const u16, utf16, false);
    bun.unsafeAssert(encode_into_result.written < buf.len);
    buf[encode_into_result.written] = 0;
    return buf[0..encode_into_result.written :0];
}

pub fn toNTPath(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    if (!std.fs.path.isAbsoluteWindows(utf8)) {
        return toWPathNormalized(wbuf, utf8);
    }

    wbuf[0..4].* = bun.windows.nt_object_prefix;
    return wbuf[0 .. toWPathNormalized(wbuf[4..], utf8).len + 4 :0];
}

pub fn addNTPathPrefix(wbuf: []u16, utf16: []const u16) [:0]const u16 {
    wbuf[0..bun.windows.nt_object_prefix.len].* = bun.windows.nt_object_prefix;
    @memcpy(wbuf[bun.windows.nt_object_prefix.len..][0..utf16.len], utf16);
    wbuf[utf16.len + bun.windows.nt_object_prefix.len] = 0;
    return wbuf[0 .. utf16.len + bun.windows.nt_object_prefix.len :0];
}

pub fn addNTPathPrefixIfNeeded(wbuf: []u16, utf16: []const u16) [:0]const u16 {
    if (hasPrefixComptimeType(u16, utf16, bun.windows.nt_object_prefix)) {
        @memcpy(wbuf[0..utf16.len], utf16);
        wbuf[utf16.len] = 0;
        return wbuf[0..utf16.len :0];
    }
    return addNTPathPrefix(wbuf, utf16);
}

// These are the same because they don't have rules like needing a trailing slash
pub const toNTDir = toNTPath;

pub fn toExtendedPathNormalized(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    bun.unsafeAssert(wbuf.len > 4);
    wbuf[0..4].* = bun.windows.nt_maxpath_prefix;
    return wbuf[0 .. toWPathNormalized(wbuf[4..], utf8).len + 4 :0];
}

pub fn toWPathNormalizeAutoExtend(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    if (std.fs.path.isAbsoluteWindows(utf8)) {
        return toExtendedPathNormalized(wbuf, utf8);
    }

    return toWPathNormalized(wbuf, utf8);
}

pub fn toWPathNormalized(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    var renormalized: bun.PathBuffer = undefined;

    var path_to_use = normalizeSlashesOnly(&renormalized, utf8, '\\');

    // is there a trailing slash? Let's remove it before converting to UTF-16
    if (path_to_use.len > 3 and bun.path.isSepAny(path_to_use[path_to_use.len - 1])) {
        path_to_use = path_to_use[0 .. path_to_use.len - 1];
    }

    return toWPath(wbuf, path_to_use);
}

pub fn normalizeSlashesOnly(buf: []u8, utf8: []const u8, comptime desired_slash: u8) []const u8 {
    comptime bun.unsafeAssert(desired_slash == '/' or desired_slash == '\\');
    const undesired_slash = if (desired_slash == '/') '\\' else '/';

    if (bun.strings.containsChar(utf8, undesired_slash)) {
        @memcpy(buf[0..utf8.len], utf8);
        for (buf[0..utf8.len]) |*c| {
            if (c.* == undesired_slash) {
                c.* = desired_slash;
            }
        }
        return buf[0..utf8.len];
    }

    return utf8;
}

pub fn toWDirNormalized(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    var renormalized: bun.PathBuffer = undefined;
    var path_to_use = utf8;

    if (bun.strings.containsChar(utf8, '/')) {
        @memcpy(renormalized[0..utf8.len], utf8);
        for (renormalized[0..utf8.len]) |*c| {
            if (c.* == '/') {
                c.* = '\\';
            }
        }
        path_to_use = renormalized[0..utf8.len];
    }

    return toWDirPath(wbuf, path_to_use);
}

pub fn toWPath(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    return toWPathMaybeDir(wbuf, utf8, false);
}

pub fn toWDirPath(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    return toWPathMaybeDir(wbuf, utf8, true);
}

pub fn assertIsValidWindowsPath(comptime T: type, path: []const T) void {
    if (Environment.allow_assert and Environment.isWindows) {
        if (bun.path.Platform.windows.isAbsoluteT(T, path) and
            isWindowsAbsolutePathMissingDriveLetter(T, path) and
            // is it a null device path? that's not an error. it's just a weird file path.
            !eqlComptimeT(T, path, "\\\\.\\NUL") and !eqlComptimeT(T, path, "\\\\.\\nul") and !eqlComptimeT(T, path, "\\nul") and !eqlComptimeT(T, path, "\\NUL"))
        {
            std.debug.panic("Internal Error: Do not pass posix paths to Windows APIs, was given '{s}'" ++ if (Environment.isDebug) " (missing a root like 'C:\\', see PosixToWinNormalizer for why this is an assertion)" else ". Please open an issue on GitHub with a reproduction.", .{
                if (T == u8) path else bun.fmt.utf16(path),
            });
        }
        if (hasPrefixComptimeType(T, path, ":/") and Environment.isDebug) {
            std.debug.panic("Path passed to windows API '{s}' is almost certainly invalid. Where did the drive letter go?", .{
                if (T == u8) path else bun.fmt.utf16(path),
            });
        }
    }
}

pub fn toWPathMaybeDir(wbuf: []u16, utf8: []const u8, comptime add_trailing_lash: bool) [:0]const u16 {
    bun.unsafeAssert(wbuf.len > 0);

    var result = bun.simdutf.convert.utf8.to.utf16.with_errors.le(
        utf8,
        wbuf[0..wbuf.len -| (1 + @as(usize, @intFromBool(add_trailing_lash)))],
    );

    if (add_trailing_lash and result.count > 0 and wbuf[result.count - 1] != '\\') {
        wbuf[result.count] = '\\';
        result.count += 1;
    }

    wbuf[result.count] = 0;

    return wbuf[0..result.count :0];
}

pub fn convertUTF16ToUTF8(list_: std.ArrayList(u8), comptime Type: type, utf16: Type) !std.ArrayList(u8) {
    var list = list_;
    const result = bun.simdutf.convert.utf16.to.utf8.with_errors.le(
        utf16,
        list.items.ptr[0..list.capacity],
    );
    if (result.status == .surrogate) {
        // Slow path: there was invalid UTF-16, so we need to convert it without simdutf.
        return toUTF8ListWithTypeBun(&list, Type, utf16);
    }

    list.items.len = result.count;
    return list;
}

pub fn convertUTF16ToUTF8Append(list: *std.ArrayList(u8), utf16: []const u16) !void {
    const result = bun.simdutf.convert.utf16.to.utf8.with_errors.le(
        utf16,
        list.items.ptr[list.items.len..list.capacity],
    );

    if (result.status == .surrogate) {
        // Slow path: there was invalid UTF-16, so we need to convert it without simdutf.
        _ = try toUTF8ListWithTypeBun(list, []const u16, utf16);
        return;
    }

    list.items.len += result.count;
}

pub fn toUTF8AllocWithType(allocator: std.mem.Allocator, comptime Type: type, utf16: Type) ![]u8 {
    if (bun.FeatureFlags.use_simdutf and comptime Type == []const u16) {
        const length = bun.simdutf.length.utf8.from.utf16.le(utf16);
        // add 16 bytes of padding for SIMDUTF
        var list = try std.ArrayList(u8).initCapacity(allocator, length + 16);
        list = try convertUTF16ToUTF8(list, Type, utf16);
        return list.items;
    }

    var list = try std.ArrayList(u8).initCapacity(allocator, utf16.len);
    list = try toUTF8ListWithType(list, Type, utf16);
    return list.items;
}

pub fn toUTF8ListWithType(list_: std.ArrayList(u8), comptime Type: type, utf16: Type) !std.ArrayList(u8) {
    if (bun.FeatureFlags.use_simdutf and comptime Type == []const u16) {
        var list = list_;
        const length = bun.simdutf.length.utf8.from.utf16.le(utf16);
        try list.ensureTotalCapacityPrecise(length + 16);
        const buf = try convertUTF16ToUTF8(list, Type, utf16);

        // Commenting out because `convertUTF16ToUTF8` may convert to WTF-8
        // which uses 3 bytes for invalid surrogates, causing the length to not
        // match from simdutf.
        // if (Environment.allow_assert) {
        //     bun.unsafeAssert(buf.items.len == length);
        // }

        return buf;
    }

    @compileError("not implemented");
}

pub fn toUTF8AppendToList(list: *std.ArrayList(u8), utf16: []const u16) !void {
    if (!bun.FeatureFlags.use_simdutf) {
        @compileError("not implemented");
    }
    const length = bun.simdutf.length.utf8.from.utf16.le(utf16);
    try list.ensureUnusedCapacity(length + 16);
    try convertUTF16ToUTF8Append(list, utf16);
}

pub fn toUTF8FromLatin1(allocator: std.mem.Allocator, latin1: []const u8) !?std.ArrayList(u8) {
    if (bun.JSC.is_bindgen)
        unreachable;

    if (isAllASCII(latin1))
        return null;

    const list = try std.ArrayList(u8).initCapacity(allocator, latin1.len);
    return try allocateLatin1IntoUTF8WithList(list, 0, []const u8, latin1);
}

pub fn toUTF8FromLatin1Z(allocator: std.mem.Allocator, latin1: []const u8) !?std.ArrayList(u8) {
    if (bun.JSC.is_bindgen)
        unreachable;

    if (isAllASCII(latin1))
        return null;

    const list = try std.ArrayList(u8).initCapacity(allocator, latin1.len + 1);
    var list1 = try allocateLatin1IntoUTF8WithList(list, 0, []const u8, latin1);
    try list1.append(0);
    return list1;
}

pub fn toUTF8ListWithTypeBun(list: *std.ArrayList(u8), comptime Type: type, utf16: Type) !std.ArrayList(u8) {
    var utf16_remaining = utf16;

    while (firstNonASCII16(Type, utf16_remaining)) |i| {
        const to_copy = utf16_remaining[0..i];
        utf16_remaining = utf16_remaining[i..];

        const replacement = utf16CodepointWithFFFD(Type, utf16_remaining);
        utf16_remaining = utf16_remaining[replacement.len..];

        const count: usize = replacement.utf8Width();
        if (comptime Environment.isNative) {
            try list.ensureTotalCapacityPrecise(i + count + list.items.len + @as(usize, @intFromFloat((@as(f64, @floatFromInt(@as(u52, @truncate(utf16_remaining.len)))) * 1.2))));
        } else {
            try list.ensureTotalCapacityPrecise(i + count + list.items.len + utf16_remaining.len + 4);
        }
        list.items.len += i;

        copyU16IntoU8(
            list.items[list.items.len - i ..],
            Type,
            to_copy,
        );

        list.items.len += count;

        _ = encodeWTF8RuneT(
            list.items.ptr[list.items.len - count .. list.items.len - count + 4][0..4],
            u32,
            @as(u32, replacement.code_point),
        );
    }

    if (utf16_remaining.len > 0) {
        try list.ensureTotalCapacityPrecise(utf16_remaining.len + list.items.len);
        const old_len = list.items.len;
        list.items.len += utf16_remaining.len;
        copyU16IntoU8(list.items[old_len..], Type, utf16_remaining);
    }

    log("UTF16 {d} -> {d} UTF8", .{ utf16.len, list.items.len });

    return list.*;
}

pub const EncodeIntoResult = struct {
    read: u32 = 0,
    written: u32 = 0,
};
pub fn allocateLatin1IntoUTF8(allocator: std.mem.Allocator, comptime Type: type, latin1_: Type) ![]u8 {
    if (comptime bun.FeatureFlags.latin1_is_now_ascii) {
        var out = try allocator.alloc(u8, latin1_.len);
        @memcpy(out[0..latin1_.len], latin1_);
        return out;
    }

    const list = try std.ArrayList(u8).initCapacity(allocator, latin1_.len);
    var foo = try allocateLatin1IntoUTF8WithList(list, 0, Type, latin1_);
    return try foo.toOwnedSlice();
}

pub fn allocateLatin1IntoUTF8WithList(list_: std.ArrayList(u8), offset_into_list: usize, comptime Type: type, latin1_: Type) !std.ArrayList(u8) {
    var latin1 = latin1_;
    var i: usize = offset_into_list;
    var list = list_;
    try list.ensureUnusedCapacity(latin1.len);

    while (latin1.len > 0) {
        if (comptime Environment.allow_assert) assert(i < list.capacity);
        var buf = list.items.ptr[i..list.capacity];

        inner: {
            var count = latin1.len / ascii_vector_size;
            while (count > 0) : (count -= 1) {
                const vec: AsciiVector = latin1[0..ascii_vector_size].*;

                if (@reduce(.Max, vec) > 127) {
                    const Int = u64;
                    const size = @sizeOf(Int);

                    // zig or LLVM doesn't do @ctz nicely with SIMD
                    if (comptime ascii_vector_size >= 8) {
                        {
                            const bytes = @as(Int, @bitCast(latin1[0..size].*));
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            const mask = bytes & 0x8080808080808080;

                            if (mask > 0) {
                                const first_set_byte = @ctz(mask) / 8;
                                if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                                buf[0..size].* = @as([size]u8, @bitCast(bytes));
                                buf = buf[first_set_byte..];
                                latin1 = latin1[first_set_byte..];
                                break :inner;
                            }

                            buf[0..size].* = @as([size]u8, @bitCast(bytes));
                            latin1 = latin1[size..];
                            buf = buf[size..];
                        }

                        if (comptime ascii_vector_size >= 16) {
                            const bytes = @as(Int, @bitCast(latin1[0..size].*));
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            const mask = bytes & 0x8080808080808080;

                            if (mask > 0) {
                                const first_set_byte = @ctz(mask) / 8;
                                if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                                buf[0..size].* = @as([size]u8, @bitCast(bytes));
                                buf = buf[first_set_byte..];
                                latin1 = latin1[first_set_byte..];
                                break :inner;
                            }
                        }
                    }
                    unreachable;
                }

                buf[0..ascii_vector_size].* = @as([ascii_vector_size]u8, @bitCast(vec))[0..ascii_vector_size].*;
                latin1 = latin1[ascii_vector_size..];
                buf = buf[ascii_vector_size..];
            }

            while (latin1.len >= 8) {
                const Int = u64;
                const size = @sizeOf(Int);

                const bytes = @as(Int, @bitCast(latin1[0..size].*));
                // https://dotat.at/@/2022-06-27-tolower-swar.html
                const mask = bytes & 0x8080808080808080;

                if (mask > 0) {
                    const first_set_byte = @ctz(mask) / 8;
                    if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                    buf[0..size].* = @as([size]u8, @bitCast(bytes));
                    latin1 = latin1[first_set_byte..];
                    buf = buf[first_set_byte..];
                    break :inner;
                }

                buf[0..size].* = @as([size]u8, @bitCast(bytes));
                latin1 = latin1[size..];
                buf = buf[size..];
            }

            {
                if (comptime Environment.allow_assert) assert(latin1.len < 8);
                const end = latin1.ptr + latin1.len;
                while (latin1.ptr != end and latin1[0] < 128) {
                    buf[0] = latin1[0];
                    buf = buf[1..];
                    latin1 = latin1[1..];
                }
            }
        }

        while (latin1.len > 0 and latin1[0] > 127) {
            i = @intFromPtr(buf.ptr) - @intFromPtr(list.items.ptr);
            list.items.len = i;
            try list.ensureUnusedCapacity(2 + latin1.len);
            buf = list.items.ptr[i..list.capacity];
            buf[0..2].* = latin1ToCodepointBytesAssumeNotASCII(latin1[0]);
            latin1 = latin1[1..];
            buf = buf[2..];
        }

        i = @intFromPtr(buf.ptr) - @intFromPtr(list.items.ptr);
        list.items.len = i;
    }

    log("Latin1 {d} -> UTF8 {d}", .{ latin1_.len, i });

    return list;
}

pub const UTF16Replacement = struct {
    code_point: u32 = unicode_replacement,
    len: u3 = 0,

    /// Explicit fail boolean to distinguish between a Unicode Replacement Codepoint
    /// that was already in there
    /// and a genuine error.
    fail: bool = false,

    pub inline fn utf8Width(replacement: UTF16Replacement) usize {
        return switch (replacement.code_point) {
            0...0x7F => 1,
            (0x7F + 1)...0x7FF => 2,
            (0x7FF + 1)...0xFFFF => 3,
            else => 4,
        };
    }
};

// This variation matches WebKit behavior.
pub fn convertUTF8BytesIntoUTF16(sequence: *const [4]u8) UTF16Replacement {
    if (comptime Environment.allow_assert) assert(sequence[0] > 127);
    const len = wtf8ByteSequenceLengthWithInvalid(sequence[0]);
    switch (len) {
        2 => {
            if (comptime Environment.allow_assert) {
                bun.assert(sequence[0] >= 0xC0);
                bun.assert(sequence[0] <= 0xDF);
            }
            if (sequence[1] < 0x80 or sequence[1] > 0xBF) {
                return .{ .len = 1, .fail = true };
            }
            return .{ .len = len, .code_point = ((@as(u32, sequence[0]) << 6) + @as(u32, sequence[1])) - 0x00003080 };
        },
        3 => {
            if (comptime Environment.allow_assert) {
                bun.assert(sequence[0] >= 0xE0);
                bun.assert(sequence[0] <= 0xEF);
            }
            switch (sequence[0]) {
                0xE0 => {
                    if (sequence[1] < 0xA0 or sequence[1] > 0xBF) {
                        return .{ .len = 1, .fail = true };
                    }
                },
                0xED => {
                    if (sequence[1] < 0x80 or sequence[1] > 0x9F) {
                        return .{ .len = 1, .fail = true };
                    }
                },
                else => {
                    if (sequence[1] < 0x80 or sequence[1] > 0xBF) {
                        return .{ .len = 1, .fail = true };
                    }
                },
            }
            if (sequence[2] < 0x80 or sequence[2] > 0xBF) {
                return .{ .len = 2, .fail = true };
            }
            return .{
                .len = len,
                .code_point = ((@as(u32, sequence[0]) << 12) + (@as(u32, sequence[1]) << 6) + @as(u32, sequence[2])) - 0x000E2080,
            };
        },
        4 => {
            switch (sequence[0]) {
                0xF0 => {
                    if (sequence[1] < 0x90 or sequence[1] > 0xBF) {
                        return .{ .len = 1, .fail = true };
                    }
                },
                0xF4 => {
                    if (sequence[1] < 0x80 or sequence[1] > 0x8F) {
                        return .{ .len = 1, .fail = true };
                    }
                },

                // invalid code point
                // this used to be an assertion
                0...(0xF0 - 1), 0xF4 + 1...std.math.maxInt(@TypeOf(sequence[0])) => {
                    return UTF16Replacement{ .len = 1, .fail = true };
                },

                else => {
                    if (sequence[1] < 0x80 or sequence[1] > 0xBF) {
                        return .{ .len = 1, .fail = true };
                    }
                },
            }

            if (sequence[2] < 0x80 or sequence[2] > 0xBF) {
                return .{ .len = 2, .fail = true };
            }
            if (sequence[3] < 0x80 or sequence[3] > 0xBF) {
                return .{ .len = 3, .fail = true };
            }
            return .{
                .len = 4,
                .code_point = ((@as(u32, sequence[0]) << 18) +
                    (@as(u32, sequence[1]) << 12) +
                    (@as(u32, sequence[2]) << 6) + @as(u32, sequence[3])) - 0x03C82080,
            };
        },
        // invalid unicode sequence
        // 1 or 0 are both invalid here
        else => return UTF16Replacement{ .len = 1, .fail = true },
    }
}

pub fn copyLatin1IntoUTF8(buf_: []u8, comptime Type: type, latin1_: Type) EncodeIntoResult {
    return copyLatin1IntoUTF8StopOnNonASCII(buf_, Type, latin1_, false);
}

pub fn copyLatin1IntoUTF8StopOnNonASCII(buf_: []u8, comptime Type: type, latin1_: Type, comptime stop: bool) EncodeIntoResult {
    if (comptime bun.FeatureFlags.latin1_is_now_ascii) {
        const to_copy = @as(u32, @truncate(@min(buf_.len, latin1_.len)));
        @memcpy(buf_[0..to_copy], latin1_[0..to_copy]);

        return .{ .written = to_copy, .read = to_copy };
    }

    var buf = buf_;
    var latin1 = latin1_;

    log("latin1 encode {d} -> {d}", .{ buf.len, latin1.len });

    while (buf.len > 0 and latin1.len > 0) {
        inner: {
            var remaining_runs = @min(buf.len, latin1.len) / ascii_vector_size;
            while (remaining_runs > 0) : (remaining_runs -= 1) {
                const vec: AsciiVector = latin1[0..ascii_vector_size].*;

                if (@reduce(.Max, vec) > 127) {
                    if (comptime stop) return .{ .written = std.math.maxInt(u32), .read = std.math.maxInt(u32) };

                    // zig or LLVM doesn't do @ctz nicely with SIMD
                    if (comptime ascii_vector_size >= 8) {
                        const Int = u64;
                        const size = @sizeOf(Int);

                        {
                            const bytes = @as(Int, @bitCast(latin1[0..size].*));
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            const mask = bytes & 0x8080808080808080;

                            buf[0..size].* = @as([size]u8, @bitCast(bytes));

                            if (mask > 0) {
                                const first_set_byte = @ctz(mask) / 8;
                                if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                                buf = buf[first_set_byte..];
                                latin1 = latin1[first_set_byte..];
                                break :inner;
                            }

                            latin1 = latin1[size..];
                            buf = buf[size..];
                        }

                        if (comptime ascii_vector_size >= 16) {
                            const bytes = @as(Int, @bitCast(latin1[0..size].*));
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            const mask = bytes & 0x8080808080808080;

                            buf[0..size].* = @as([size]u8, @bitCast(bytes));

                            if (comptime Environment.allow_assert) assert(mask > 0);
                            const first_set_byte = @ctz(mask) / 8;
                            if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                            buf = buf[first_set_byte..];
                            latin1 = latin1[first_set_byte..];
                            break :inner;
                        }
                    }
                    unreachable;
                }

                buf[0..ascii_vector_size].* = @as([ascii_vector_size]u8, @bitCast(vec))[0..ascii_vector_size].*;
                latin1 = latin1[ascii_vector_size..];
                buf = buf[ascii_vector_size..];
            }

            {
                const Int = u64;
                const size = @sizeOf(Int);
                while (@min(buf.len, latin1.len) >= size) {
                    const bytes = @as(Int, @bitCast(latin1[0..size].*));
                    buf[0..size].* = @as([size]u8, @bitCast(bytes));

                    // https://dotat.at/@/2022-06-27-tolower-swar.html

                    const mask = bytes & 0x8080808080808080;

                    if (mask > 0) {
                        const first_set_byte = @ctz(mask) / 8;
                        if (comptime stop) return .{ .written = std.math.maxInt(u32), .read = std.math.maxInt(u32) };
                        if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                        buf = buf[first_set_byte..];
                        latin1 = latin1[first_set_byte..];

                        break :inner;
                    }

                    latin1 = latin1[size..];
                    buf = buf[size..];
                }
            }

            {
                const end = latin1.ptr + @min(buf.len, latin1.len);
                if (comptime Environment.allow_assert) assert(@intFromPtr(latin1.ptr + 8) > @intFromPtr(end));
                const start_ptr = @intFromPtr(buf.ptr);
                const start_ptr_latin1 = @intFromPtr(latin1.ptr);

                while (latin1.ptr != end and latin1.ptr[0] <= 127) {
                    buf.ptr[0] = latin1.ptr[0];
                    buf.ptr += 1;
                    latin1.ptr += 1;
                }

                buf.len -= @intFromPtr(buf.ptr) - start_ptr;
                latin1.len -= @intFromPtr(latin1.ptr) - start_ptr_latin1;
            }
        }

        if (latin1.len > 0) {
            if (buf.len >= 2) {
                if (comptime stop) return .{ .written = std.math.maxInt(u32), .read = std.math.maxInt(u32) };

                buf[0..2].* = latin1ToCodepointBytesAssumeNotASCII(latin1[0]);
                latin1 = latin1[1..];
                buf = buf[2..];
            } else {
                break;
            }
        }
    }

    return .{
        .written = @as(u32, @truncate(buf_.len - buf.len)),
        .read = @as(u32, @truncate(latin1_.len - latin1.len)),
    };
}

pub fn replaceLatin1WithUTF8(buf_: []u8) void {
    var latin1 = buf_;
    while (strings.firstNonASCII(latin1)) |i| {
        latin1[i..][0..2].* = latin1ToCodepointBytesAssumeNotASCII(latin1[i]);

        latin1 = latin1[i + 2 ..];
    }
}

pub fn elementLengthLatin1IntoUTF8(comptime Type: type, latin1_: Type) usize {
    // https://zig.godbolt.org/z/zzYexPPs9

    var latin1 = latin1_;
    const input_len = latin1.len;
    var total_non_ascii_count: usize = 0;

    // This is about 30% faster on large input compared to auto-vectorization
    if (comptime Environment.enableSIMD) {
        const end = latin1.ptr + (latin1.len - (latin1.len % ascii_vector_size));
        while (latin1.ptr != end) {
            const vec: AsciiVector = latin1[0..ascii_vector_size].*;

            // Shifting a unsigned 8 bit integer to the right by 7 bits always produces a value of 0 or 1.
            const cmp = vec >> @as(AsciiVector, @splat(
                @as(u8, 7),
            ));

            // Anding that value rather than converting it into a @Vector(16, u1) produces better code from LLVM.
            const mask: AsciiVector = cmp & @as(AsciiVector, @splat(
                @as(u8, 1),
            ));

            total_non_ascii_count += @as(usize, @reduce(.Add, mask));
            latin1 = latin1[ascii_vector_size..];
        }

        // an important hint to the compiler to not auto-vectorize the loop below
        if (latin1.len >= ascii_vector_size) unreachable;
    }

    for (latin1) |c| {
        total_non_ascii_count += @as(usize, @intFromBool(c > 127));
    }

    // each non-ascii latin1 character becomes 2 UTF8 characters
    return input_len + total_non_ascii_count;
}

pub fn copyLatin1IntoUTF16(comptime Buffer: type, buf_: Buffer, comptime Type: type, latin1_: Type) EncodeIntoResult {
    var buf = buf_;
    var latin1 = latin1_;
    while (buf.len > 0 and latin1.len > 0) {
        const to_write = strings.firstNonASCII(latin1) orelse @as(u32, @truncate(@min(latin1.len, buf.len)));
        if (comptime std.meta.alignment(Buffer) != @alignOf(u16)) {
            strings.copyU8IntoU16WithAlignment(std.meta.alignment(Buffer), buf, latin1[0..to_write]);
        } else {
            strings.copyU8IntoU16(buf, latin1[0..to_write]);
        }

        latin1 = latin1[to_write..];
        buf = buf[to_write..];
        if (latin1.len > 0 and buf.len >= 1) {
            buf[0] = latin1ToCodepointBytesAssumeNotASCII16(latin1[0]);
            latin1 = latin1[1..];
            buf = buf[1..];
        }
    }

    return .{
        .read = @as(u32, @truncate(buf_.len - buf.len)),
        .written = @as(u32, @truncate(latin1_.len - latin1.len)),
    };
}

pub fn elementLengthLatin1IntoUTF16(comptime Type: type, latin1_: Type) usize {
    // latin1 is always at most 1 UTF-16 code unit long
    if (comptime std.meta.Child([]const u16) == Type) {
        return latin1_.len;
    }

    var count: usize = 0;
    var latin1 = latin1_;
    while (latin1.len > 0) {
        const function = comptime if (std.meta.Child(Type) == u8) strings.firstNonASCIIWithType else strings.firstNonASCII16;
        const to_write = function(Type, latin1) orelse @as(u32, @truncate(latin1.len));
        count += to_write;
        latin1 = latin1[to_write..];
        if (latin1.len > 0) {
            count += comptime if (std.meta.Child(Type) == u8) 2 else 1;
            latin1 = latin1[1..];
        }
    }

    return count;
}

pub fn escapeHTMLForLatin1Input(allocator: std.mem.Allocator, latin1: []const u8) !Escaped(u8) {
    const Scalar = struct {
        pub const lengths: [std.math.maxInt(u8) + 1]u4 = brk: {
            var values: [std.math.maxInt(u8) + 1]u4 = undefined;
            for (values, 0..) |_, i| {
                switch (i) {
                    '"' => {
                        values[i] = "&quot;".len;
                    },
                    '&' => {
                        values[i] = "&amp;".len;
                    },
                    '\'' => {
                        values[i] = "&#x27;".len;
                    },
                    '<' => {
                        values[i] = "&lt;".len;
                    },
                    '>' => {
                        values[i] = "&gt;".len;
                    },
                    else => {
                        values[i] = 1;
                    },
                }
            }

            break :brk values;
        };

        inline fn appendString(buf: [*]u8, comptime str: []const u8) usize {
            buf[0..str.len].* = str[0..str.len].*;
            return str.len;
        }

        pub inline fn append(buf: [*]u8, char: u8) usize {
            if (lengths[char] == 1) {
                buf[0] = char;
                return 1;
            }

            return switch (char) {
                '"' => appendString(buf, "&quot;"),
                '&' => appendString(buf, "&amp;"),
                '\'' => appendString(buf, "&#x27;"),
                '<' => appendString(buf, "&lt;"),
                '>' => appendString(buf, "&gt;"),
                else => unreachable,
            };
        }

        pub inline fn push(comptime len: anytype, chars_: *const [len]u8, allo: std.mem.Allocator) Escaped(u8) {
            const chars = chars_.*;
            var total: usize = 0;

            comptime var remain_to_comp = len;
            comptime var comp_i = 0;

            inline while (remain_to_comp > 0) : (remain_to_comp -= 1) {
                total += lengths[chars[comp_i]];
                comp_i += 1;
            }

            if (total == len) {
                return .{ .original = {} };
            }

            const output = allo.alloc(u8, total) catch unreachable;
            var head = output.ptr;
            inline for (comptime bun.range(0, len)) |i| {
                head += @This().append(head, chars[i]);
            }

            return Escaped(u8){ .allocated = output };
        }
    };
    @setEvalBranchQuota(5000);
    switch (latin1.len) {
        0 => return Escaped(u8){ .static = "" },
        1 => return switch (latin1[0]) {
            '"' => Escaped(u8){ .static = "&quot;" },
            '&' => Escaped(u8){ .static = "&amp;" },
            '\'' => Escaped(u8){ .static = "&#x27;" },
            '<' => Escaped(u8){ .static = "&lt;" },
            '>' => Escaped(u8){ .static = "&gt;" },
            else => Escaped(u8){ .original = {} },
        },
        2 => {
            const first: []const u8 = switch (latin1[0]) {
                '"' => "&quot;",
                '&' => "&amp;",
                '\'' => "&#x27;",
                '<' => "&lt;",
                '>' => "&gt;",
                else => latin1[0..1],
            };
            const second: []const u8 = switch (latin1[1]) {
                '"' => "&quot;",
                '&' => "&amp;",
                '\'' => "&#x27;",
                '<' => "&lt;",
                '>' => "&gt;",
                else => latin1[1..2],
            };
            if (first.len == 1 and second.len == 1) {
                return Escaped(u8){ .original = {} };
            }

            return Escaped(u8){ .allocated = strings.append(allocator, first, second) catch unreachable };
        },

        // The simd implementation is slower for inputs less than 32 bytes.
        3 => return Scalar.push(3, latin1[0..3], allocator),
        4 => return Scalar.push(4, latin1[0..4], allocator),
        5 => return Scalar.push(5, latin1[0..5], allocator),
        6 => return Scalar.push(6, latin1[0..6], allocator),
        7 => return Scalar.push(7, latin1[0..7], allocator),
        8 => return Scalar.push(8, latin1[0..8], allocator),
        9 => return Scalar.push(9, latin1[0..9], allocator),
        10 => return Scalar.push(10, latin1[0..10], allocator),
        11 => return Scalar.push(11, latin1[0..11], allocator),
        12 => return Scalar.push(12, latin1[0..12], allocator),
        13 => return Scalar.push(13, latin1[0..13], allocator),
        14 => return Scalar.push(14, latin1[0..14], allocator),
        15 => return Scalar.push(15, latin1[0..15], allocator),
        16 => return Scalar.push(16, latin1[0..16], allocator),
        17 => return Scalar.push(17, latin1[0..17], allocator),
        18 => return Scalar.push(18, latin1[0..18], allocator),
        19 => return Scalar.push(19, latin1[0..19], allocator),
        20 => return Scalar.push(20, latin1[0..20], allocator),
        21 => return Scalar.push(21, latin1[0..21], allocator),
        22 => return Scalar.push(22, latin1[0..22], allocator),
        23 => return Scalar.push(23, latin1[0..23], allocator),
        24 => return Scalar.push(24, latin1[0..24], allocator),
        25 => return Scalar.push(25, latin1[0..25], allocator),
        26 => return Scalar.push(26, latin1[0..26], allocator),
        27 => return Scalar.push(27, latin1[0..27], allocator),
        28 => return Scalar.push(28, latin1[0..28], allocator),
        29 => return Scalar.push(29, latin1[0..29], allocator),
        30 => return Scalar.push(30, latin1[0..30], allocator),
        31 => return Scalar.push(31, latin1[0..31], allocator),
        32 => return Scalar.push(32, latin1[0..32], allocator),

        else => {
            var remaining = latin1;

            const vec_chars = "\"&'<>";
            const vecs: [vec_chars.len]AsciiVector = comptime brk: {
                var _vecs: [vec_chars.len]AsciiVector = undefined;
                for (vec_chars, 0..) |c, i| {
                    _vecs[i] = @splat(c);
                }
                break :brk _vecs;
            };

            var any_needs_escape = false;
            var buf: std.ArrayList(u8) = std.ArrayList(u8){
                .items = &.{},
                .capacity = 0,
                .allocator = allocator,
            };

            if (comptime Environment.enableSIMD) {
                // pass #1: scan for any characters that need escaping
                // assume most strings won't need any escaping, so don't actually allocate the buffer
                scan_and_allocate_lazily: while (remaining.len >= ascii_vector_size) {
                    if (comptime Environment.allow_assert) assert(!any_needs_escape);
                    const vec: AsciiVector = remaining[0..ascii_vector_size].*;
                    if (@reduce(.Max, @as(AsciiVectorU1, @bitCast((vec == vecs[0]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[1]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[2]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[3]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[4])))) == 1)
                    {
                        if (comptime Environment.allow_assert) assert(buf.capacity == 0);

                        buf = try std.ArrayList(u8).initCapacity(allocator, latin1.len + 6);
                        const copy_len = @intFromPtr(remaining.ptr) - @intFromPtr(latin1.ptr);
                        buf.appendSliceAssumeCapacity(latin1[0..copy_len]);
                        any_needs_escape = true;
                        inline for (0..ascii_vector_size) |i| {
                            switch (vec[i]) {
                                '"' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&quot;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&quot;".len][0.."&quot;".len].* = "&quot;".*;
                                    buf.items.len += "&quot;".len;
                                },
                                '&' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&amp;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&amp;".len][0.."&amp;".len].* = "&amp;".*;
                                    buf.items.len += "&amp;".len;
                                },
                                '\'' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&#x27;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&#x27;".len][0.."&#x27;".len].* = "&#x27;".*;
                                    buf.items.len += "&#x27;".len;
                                },
                                '<' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&lt;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&lt;".len][0.."&lt;".len].* = "&lt;".*;
                                    buf.items.len += "&lt;".len;
                                },
                                '>' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&gt;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&gt;".len][0.."&gt;".len].* = "&gt;".*;
                                    buf.items.len += "&gt;".len;
                                },
                                else => |c| {
                                    buf.appendAssumeCapacity(c);
                                },
                            }
                        }

                        remaining = remaining[ascii_vector_size..];
                        break :scan_and_allocate_lazily;
                    }

                    remaining = remaining[ascii_vector_size..];
                }
            }

            if (any_needs_escape) {
                // pass #2: we found something that needed an escape
                // so we'll go ahead and copy the buffer into a new buffer
                while (remaining.len >= ascii_vector_size) {
                    const vec: AsciiVector = remaining[0..ascii_vector_size].*;
                    if (@reduce(.Max, @as(AsciiVectorU1, @bitCast((vec == vecs[0]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[1]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[2]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[3]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[4])))) == 1)
                    {
                        buf.ensureUnusedCapacity(ascii_vector_size + 6) catch unreachable;
                        inline for (0..ascii_vector_size) |i| {
                            switch (vec[i]) {
                                '"' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&quot;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&quot;".len][0.."&quot;".len].* = "&quot;".*;
                                    buf.items.len += "&quot;".len;
                                },
                                '&' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&amp;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&amp;".len][0.."&amp;".len].* = "&amp;".*;
                                    buf.items.len += "&amp;".len;
                                },
                                '\'' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&#x27;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&#x27;".len][0.."&#x27;".len].* = "&#x27;".*;
                                    buf.items.len += "&#x27;".len;
                                },
                                '<' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&lt;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&lt;".len][0.."&lt;".len].* = "&lt;".*;
                                    buf.items.len += "&lt;".len;
                                },
                                '>' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&gt;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&gt;".len][0.."&gt;".len].* = "&gt;".*;
                                    buf.items.len += "&gt;".len;
                                },
                                else => |c| {
                                    buf.appendAssumeCapacity(c);
                                },
                            }
                        }

                        remaining = remaining[ascii_vector_size..];
                        continue;
                    }

                    try buf.ensureUnusedCapacity(ascii_vector_size);
                    buf.items.ptr[buf.items.len .. buf.items.len + ascii_vector_size][0..ascii_vector_size].* = remaining[0..ascii_vector_size].*;
                    buf.items.len += ascii_vector_size;
                    remaining = remaining[ascii_vector_size..];
                }
            }

            var ptr = remaining.ptr;
            const end = remaining.ptr + remaining.len;

            if (!any_needs_escape) {
                scan_and_allocate_lazily: while (ptr != end) : (ptr += 1) {
                    switch (ptr[0]) {
                        '"', '&', '\'', '<', '>' => |c| {
                            if (comptime Environment.allow_assert) assert(buf.capacity == 0);

                            buf = try std.ArrayList(u8).initCapacity(allocator, latin1.len + @as(usize, Scalar.lengths[c]));
                            const copy_len = @intFromPtr(ptr) - @intFromPtr(latin1.ptr);
                            if (comptime Environment.allow_assert) assert(copy_len <= buf.capacity);
                            buf.items.len = copy_len;
                            @memcpy(buf.items[0..copy_len], latin1[0..copy_len]);
                            any_needs_escape = true;
                            break :scan_and_allocate_lazily;
                        },
                        else => {},
                    }
                }
            }

            while (ptr != end) : (ptr += 1) {
                switch (ptr[0]) {
                    '"' => {
                        buf.appendSlice("&quot;") catch unreachable;
                    },
                    '&' => {
                        buf.appendSlice("&amp;") catch unreachable;
                    },
                    '\'' => {
                        buf.appendSlice("&#x27;") catch unreachable; // modified from escape-html; used to be '&#39'
                    },
                    '<' => {
                        buf.appendSlice("&lt;") catch unreachable;
                    },
                    '>' => {
                        buf.appendSlice("&gt;") catch unreachable;
                    },
                    else => |c| {
                        buf.append(c) catch unreachable;
                    },
                }
            }

            if (!any_needs_escape) {
                if (comptime Environment.allow_assert) assert(buf.capacity == 0);
                return Escaped(u8){ .original = {} };
            }

            return Escaped(u8){ .allocated = try buf.toOwnedSlice() };
        },
    }
}

fn Escaped(comptime T: type) type {
    return union(enum) {
        static: []const u8,
        original: void,
        allocated: []T,
    };
}

pub fn escapeHTMLForUTF16Input(allocator: std.mem.Allocator, utf16: []const u16) !Escaped(u16) {
    const Scalar = struct {
        pub const lengths: [std.math.maxInt(u8) + 1]u4 = brk: {
            var values: [std.math.maxInt(u8) + 1]u4 = undefined;
            for (values, 0..) |_, i| {
                values[i] = switch (i) {
                    '"' => "&quot;".len,
                    '&' => "&amp;".len,
                    '\'' => "&#x27;".len,
                    '<' => "&lt;".len,
                    '>' => "&gt;".len,
                    else => 1,
                };
            }

            break :brk values;
        };
    };
    switch (utf16.len) {
        0 => return Escaped(u16){ .static = &[_]u8{} },
        1 => {
            switch (utf16[0]) {
                '"' => return Escaped(u16){ .static = "&quot;" },
                '&' => return Escaped(u16){ .static = "&amp;" },
                '\'' => return Escaped(u16){ .static = "&#x27;" },
                '<' => return Escaped(u16){ .static = "&lt;" },
                '>' => return Escaped(u16){ .static = "&gt;" },
                else => return Escaped(u16){ .original = {} },
            }
        },
        2 => {
            const first_16 = switch (utf16[0]) {
                '"' => toUTF16Literal("&quot;"),
                '&' => toUTF16Literal("&amp;"),
                '\'' => toUTF16Literal("&#x27;"),
                '<' => toUTF16Literal("&lt;"),
                '>' => toUTF16Literal("&gt;"),
                else => @as([]const u16, utf16[0..1]),
            };

            const second_16 = switch (utf16[1]) {
                '"' => toUTF16Literal("&quot;"),
                '&' => toUTF16Literal("&amp;"),
                '\'' => toUTF16Literal("&#x27;"),
                '<' => toUTF16Literal("&lt;"),
                '>' => toUTF16Literal("&gt;"),
                else => @as([]const u16, utf16[1..2]),
            };

            if (first_16.ptr == utf16.ptr and second_16.ptr == utf16.ptr + 1) {
                return Escaped(u16){ .original = {} };
            }

            var buf = allocator.alloc(u16, first_16.len + second_16.len) catch unreachable;
            bun.copy(u16, buf, first_16);
            bun.copy(u16, buf[first_16.len..], second_16);
            return Escaped(u16){ .allocated = buf };
        },

        else => {
            var remaining = utf16;

            var any_needs_escape = false;
            var buf: std.ArrayList(u16) = undefined;

            if (comptime Environment.enableSIMD) {
                const vec_chars = "\"&'<>";
                const vecs: [vec_chars.len]AsciiU16Vector = brk: {
                    var _vecs: [vec_chars.len]AsciiU16Vector = undefined;
                    for (vec_chars, 0..) |c, i| {
                        _vecs[i] = @splat(@as(u16, c));
                    }
                    break :brk _vecs;
                };
                // pass #1: scan for any characters that need escaping
                // assume most strings won't need any escaping, so don't actually allocate the buffer
                scan_and_allocate_lazily: while (remaining.len >= ascii_u16_vector_size) {
                    if (comptime Environment.allow_assert) assert(!any_needs_escape);
                    const vec: AsciiU16Vector = remaining[0..ascii_u16_vector_size].*;
                    if (@reduce(.Max, @as(AsciiVectorU16U1, @bitCast(vec > @as(AsciiU16Vector, @splat(@as(u16, 127))))) |
                        @as(AsciiVectorU16U1, @bitCast((vec == vecs[0]))) |
                        @as(AsciiVectorU16U1, @bitCast((vec == vecs[1]))) |
                        @as(AsciiVectorU16U1, @bitCast((vec == vecs[2]))) |
                        @as(AsciiVectorU16U1, @bitCast((vec == vecs[3]))) |
                        @as(AsciiVectorU16U1, @bitCast((vec == vecs[4])))) == 1)
                    {
                        var i: u16 = 0;
                        lazy: {
                            while (i < ascii_u16_vector_size) {
                                switch (remaining[i]) {
                                    '"', '&', '\'', '<', '>' => {
                                        any_needs_escape = true;
                                        break :lazy;
                                    },
                                    128...std.math.maxInt(u16) => {
                                        const cp = utf16Codepoint([]const u16, remaining[i..]);
                                        i += @as(u16, cp.len);
                                    },
                                    else => {
                                        i += 1;
                                    },
                                }
                            }
                        }

                        if (!any_needs_escape) {
                            remaining = remaining[i..];
                            continue :scan_and_allocate_lazily;
                        }

                        if (comptime Environment.allow_assert) assert(@intFromPtr(remaining.ptr + i) >= @intFromPtr(utf16.ptr));
                        const to_copy = std.mem.sliceAsBytes(utf16)[0 .. @intFromPtr(remaining.ptr + i) - @intFromPtr(utf16.ptr)];
                        const to_copy_16 = std.mem.bytesAsSlice(u16, to_copy);
                        buf = try std.ArrayList(u16).initCapacity(allocator, utf16.len + 6);
                        try buf.appendSlice(to_copy_16);

                        while (i < ascii_u16_vector_size) {
                            switch (remaining[i]) {
                                '"', '&', '\'', '<', '>' => |c| {
                                    const result = switch (c) {
                                        '"' => toUTF16Literal("&quot;"),
                                        '&' => toUTF16Literal("&amp;"),
                                        '\'' => toUTF16Literal("&#x27;"),
                                        '<' => toUTF16Literal("&lt;"),
                                        '>' => toUTF16Literal("&gt;"),
                                        else => unreachable,
                                    };

                                    buf.appendSlice(result) catch unreachable;
                                    i += 1;
                                },
                                128...std.math.maxInt(u16) => {
                                    const cp = utf16Codepoint([]const u16, remaining[i..]);

                                    buf.appendSlice(remaining[i..][0..@as(usize, cp.len)]) catch unreachable;
                                    i += @as(u16, cp.len);
                                },
                                else => |c| {
                                    i += 1;
                                    buf.append(c) catch unreachable;
                                },
                            }
                        }

                        // edgecase: code point width could exceed asdcii_u16_vector_size
                        remaining = remaining[i..];
                        break :scan_and_allocate_lazily;
                    }

                    remaining = remaining[ascii_u16_vector_size..];
                }

                if (any_needs_escape) {
                    // pass #2: we found something that needed an escape
                    // but there's still some more text to
                    // so we'll go ahead and copy the buffer into a new buffer
                    while (remaining.len >= ascii_u16_vector_size) {
                        const vec: AsciiU16Vector = remaining[0..ascii_u16_vector_size].*;
                        if (@reduce(.Max, @as(AsciiVectorU16U1, @bitCast(vec > @as(AsciiU16Vector, @splat(@as(u16, 127))))) |
                            @as(AsciiVectorU16U1, @bitCast((vec == vecs[0]))) |
                            @as(AsciiVectorU16U1, @bitCast((vec == vecs[1]))) |
                            @as(AsciiVectorU16U1, @bitCast((vec == vecs[2]))) |
                            @as(AsciiVectorU16U1, @bitCast((vec == vecs[3]))) |
                            @as(AsciiVectorU16U1, @bitCast((vec == vecs[4])))) == 1)
                        {
                            buf.ensureUnusedCapacity(ascii_u16_vector_size) catch unreachable;
                            var i: u16 = 0;
                            while (i < ascii_u16_vector_size) {
                                switch (remaining[i]) {
                                    '"' => {
                                        buf.appendSlice(toUTF16Literal("&quot;")) catch unreachable;
                                        i += 1;
                                    },
                                    '&' => {
                                        buf.appendSlice(toUTF16Literal("&amp;")) catch unreachable;
                                        i += 1;
                                    },
                                    '\'' => {
                                        buf.appendSlice(toUTF16Literal("&#x27;")) catch unreachable; // modified from escape-html; used to be '&#39'
                                        i += 1;
                                    },
                                    '<' => {
                                        buf.appendSlice(toUTF16Literal("&lt;")) catch unreachable;
                                        i += 1;
                                    },
                                    '>' => {
                                        buf.appendSlice(toUTF16Literal("&gt;")) catch unreachable;
                                        i += 1;
                                    },
                                    128...std.math.maxInt(u16) => {
                                        const cp = utf16Codepoint([]const u16, remaining[i..]);

                                        buf.appendSlice(remaining[i..][0..@as(usize, cp.len)]) catch unreachable;
                                        i += @as(u16, cp.len);
                                    },
                                    else => |c| {
                                        buf.append(c) catch unreachable;
                                        i += 1;
                                    },
                                }
                            }

                            remaining = remaining[i..];
                            continue;
                        }

                        try buf.ensureUnusedCapacity(ascii_u16_vector_size);
                        buf.items.ptr[buf.items.len .. buf.items.len + ascii_u16_vector_size][0..ascii_u16_vector_size].* = remaining[0..ascii_u16_vector_size].*;
                        buf.items.len += ascii_u16_vector_size;
                        remaining = remaining[ascii_u16_vector_size..];
                    }
                }
            }

            var ptr = remaining.ptr;
            const end = remaining.ptr + remaining.len;

            if (!any_needs_escape) {
                scan_and_allocate_lazily: while (ptr != end) {
                    switch (ptr[0]) {
                        '"', '&', '\'', '<', '>' => |c| {
                            buf = try std.ArrayList(u16).initCapacity(allocator, utf16.len + @as(usize, Scalar.lengths[c]));
                            if (comptime Environment.allow_assert) assert(@intFromPtr(ptr) >= @intFromPtr(utf16.ptr));

                            const to_copy = std.mem.sliceAsBytes(utf16)[0 .. @intFromPtr(ptr) - @intFromPtr(utf16.ptr)];
                            const to_copy_16 = std.mem.bytesAsSlice(u16, to_copy);
                            try buf.appendSlice(to_copy_16);
                            any_needs_escape = true;
                            break :scan_and_allocate_lazily;
                        },
                        128...std.math.maxInt(u16) => {
                            const cp = utf16Codepoint([]const u16, ptr[0..if (ptr + 1 == end) 1 else 2]);

                            ptr += @as(u16, cp.len);
                        },
                        else => {
                            ptr += 1;
                        },
                    }
                }
            }

            while (ptr != end) {
                switch (ptr[0]) {
                    '"' => {
                        buf.appendSlice(toUTF16Literal("&quot;")) catch unreachable;
                        ptr += 1;
                    },
                    '&' => {
                        buf.appendSlice(toUTF16Literal("&amp;")) catch unreachable;
                        ptr += 1;
                    },
                    '\'' => {
                        buf.appendSlice(toUTF16Literal("&#x27;")) catch unreachable; // modified from escape-html; used to be '&#39'
                        ptr += 1;
                    },
                    '<' => {
                        buf.appendSlice(toUTF16Literal("&lt;")) catch unreachable;
                        ptr += 1;
                    },
                    '>' => {
                        buf.appendSlice(toUTF16Literal("&gt;")) catch unreachable;
                        ptr += 1;
                    },
                    128...std.math.maxInt(u16) => {
                        const cp = utf16Codepoint([]const u16, ptr[0..if (ptr + 1 == end) 1 else 2]);

                        buf.appendSlice(ptr[0..@as(usize, cp.len)]) catch unreachable;
                        ptr += @as(u16, cp.len);
                    },

                    else => |c| {
                        buf.append(c) catch unreachable;
                        ptr += 1;
                    },
                }
            }

            if (!any_needs_escape) {
                return Escaped(u16){ .original = {} };
            }

            return Escaped(u16){ .allocated = try buf.toOwnedSlice() };
        },
    }
}

pub fn latin1ToCodepointAssumeNotASCII(char: u8, comptime CodePointType: type) CodePointType {
    return @as(
        CodePointType,
        @intCast(latin1ToCodepointBytesAssumeNotASCII16(char)),
    );
}

const latin1_to_utf16_conversion_table = [256]u16{
    0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, // 00-07
    0x0008, 0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x000E, 0x000F, // 08-0F
    0x0010, 0x0011, 0x0012, 0x0013, 0x0014, 0x0015, 0x0016, 0x0017, // 10-17
    0x0018, 0x0019, 0x001A, 0x001B, 0x001C, 0x001D, 0x001E, 0x001F, // 18-1F
    0x0020, 0x0021, 0x0022, 0x0023, 0x0024, 0x0025, 0x0026, 0x0027, // 20-27
    0x0028, 0x0029, 0x002A, 0x002B, 0x002C, 0x002D, 0x002E, 0x002F, // 28-2F
    0x0030, 0x0031, 0x0032, 0x0033, 0x0034, 0x0035, 0x0036, 0x0037, // 30-37
    0x0038, 0x0039, 0x003A, 0x003B, 0x003C, 0x003D, 0x003E, 0x003F, // 38-3F
    0x0040, 0x0041, 0x0042, 0x0043, 0x0044, 0x0045, 0x0046, 0x0047, // 40-47
    0x0048, 0x0049, 0x004A, 0x004B, 0x004C, 0x004D, 0x004E, 0x004F, // 48-4F
    0x0050, 0x0051, 0x0052, 0x0053, 0x0054, 0x0055, 0x0056, 0x0057, // 50-57
    0x0058, 0x0059, 0x005A, 0x005B, 0x005C, 0x005D, 0x005E, 0x005F, // 58-5F
    0x0060, 0x0061, 0x0062, 0x0063, 0x0064, 0x0065, 0x0066, 0x0067, // 60-67
    0x0068, 0x0069, 0x006A, 0x006B, 0x006C, 0x006D, 0x006E, 0x006F, // 68-6F
    0x0070, 0x0071, 0x0072, 0x0073, 0x0074, 0x0075, 0x0076, 0x0077, // 70-77
    0x0078, 0x0079, 0x007A, 0x007B, 0x007C, 0x007D, 0x007E, 0x007F, // 78-7F
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, // 80-87
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F, // 88-8F
    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, // 90-97
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178, // 98-9F
    0x00A0, 0x00A1, 0x00A2, 0x00A3, 0x00A4, 0x00A5, 0x00A6, 0x00A7, // A0-A7
    0x00A8, 0x00A9, 0x00AA, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x00AF, // A8-AF
    0x00B0, 0x00B1, 0x00B2, 0x00B3, 0x00B4, 0x00B5, 0x00B6, 0x00B7, // B0-B7
    0x00B8, 0x00B9, 0x00BA, 0x00BB, 0x00BC, 0x00BD, 0x00BE, 0x00BF, // B8-BF
    0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C4, 0x00C5, 0x00C6, 0x00C7, // C0-C7
    0x00C8, 0x00C9, 0x00CA, 0x00CB, 0x00CC, 0x00CD, 0x00CE, 0x00CF, // C8-CF
    0x00D0, 0x00D1, 0x00D2, 0x00D3, 0x00D4, 0x00D5, 0x00D6, 0x00D7, // D0-D7
    0x00D8, 0x00D9, 0x00DA, 0x00DB, 0x00DC, 0x00DD, 0x00DE, 0x00DF, // D8-DF
    0x00E0, 0x00E1, 0x00E2, 0x00E3, 0x00E4, 0x00E5, 0x00E6, 0x00E7, // E0-E7
    0x00E8, 0x00E9, 0x00EA, 0x00EB, 0x00EC, 0x00ED, 0x00EE, 0x00EF, // E8-EF
    0x00F0, 0x00F1, 0x00F2, 0x00F3, 0x00F4, 0x00F5, 0x00F6, 0x00F7, // F0-F7
    0x00F8, 0x00F9, 0x00FA, 0x00FB, 0x00FC, 0x00FD, 0x00FE, 0x00FF, // F8-FF
};

pub fn latin1ToCodepointBytesAssumeNotASCII(char: u32) [2]u8 {
    var bytes = [4]u8{ 0, 0, 0, 0 };
    _ = encodeWTF8Rune(&bytes, @as(i32, @intCast(char)));
    return bytes[0..2].*;
}

pub fn latin1ToCodepointBytesAssumeNotASCII16(char: u32) u16 {
    return latin1_to_utf16_conversion_table[@as(u8, @truncate(char))];
}

pub fn copyUTF16IntoUTF8(buf: []u8, comptime Type: type, utf16: Type, comptime allow_partial_write: bool) EncodeIntoResult {
    if (comptime Type == []const u16) {
        if (bun.FeatureFlags.use_simdutf) {
            if (utf16.len == 0)
                return .{ .read = 0, .written = 0 };
            const trimmed = bun.simdutf.trim.utf16(utf16);
            if (trimmed.len == 0)
                return .{ .read = 0, .written = 0 };

            const out_len = if (buf.len <= (trimmed.len * 3 + 2))
                bun.simdutf.length.utf8.from.utf16.le(trimmed)
            else
                buf.len;

            return copyUTF16IntoUTF8WithBuffer(buf, Type, utf16, trimmed, out_len, allow_partial_write);
        }
    }

    return copyUTF16IntoUTF8WithBuffer(buf, Type, utf16, utf16, utf16.len, allow_partial_write);
}

pub fn copyUTF16IntoUTF8WithBuffer(buf: []u8, comptime Type: type, utf16: Type, trimmed: Type, out_len: usize, comptime allow_partial_write: bool) EncodeIntoResult {
    var remaining = buf;
    var utf16_remaining = utf16;
    var ended_on_non_ascii = false;

    brk: {
        if (comptime Type == []const u16) {
            if (bun.FeatureFlags.use_simdutf) {
                log("UTF16 {d} -> UTF8 {d}", .{ utf16.len, out_len });
                if (remaining.len >= out_len) {
                    const result = bun.simdutf.convert.utf16.to.utf8.with_errors.le(trimmed, remaining);
                    if (result.status == .surrogate) break :brk;

                    return EncodeIntoResult{
                        .read = @as(u32, @truncate(trimmed.len)),
                        .written = @as(u32, @truncate(result.count)),
                    };
                }
            }
        }
    }

    while (firstNonASCII16(Type, utf16_remaining)) |i| {
        const end = @min(i, remaining.len);
        if (end > 0) copyU16IntoU8(remaining, Type, utf16_remaining[0..end]);
        remaining = remaining[end..];
        utf16_remaining = utf16_remaining[end..];

        if (@min(utf16_remaining.len, remaining.len) == 0)
            break;

        const replacement = utf16CodepointWithFFFD(Type, utf16_remaining);

        const width: usize = replacement.utf8Width();
        if (width > remaining.len) {
            ended_on_non_ascii = width > 1;
            if (comptime allow_partial_write) switch (width) {
                2 => {
                    if (remaining.len > 0) {
                        //only first will be written
                        remaining[0] = @as(u8, @truncate(0xC0 | (replacement.code_point >> 6)));
                        remaining = remaining[remaining.len..];
                    }
                },
                3 => {
                    //only first to second written
                    switch (remaining.len) {
                        1 => {
                            remaining[0] = @as(u8, @truncate(0xE0 | (replacement.code_point >> 12)));
                            remaining = remaining[remaining.len..];
                        },
                        2 => {
                            remaining[0] = @as(u8, @truncate(0xE0 | (replacement.code_point >> 12)));
                            remaining[1] = @as(u8, @truncate(0x80 | (replacement.code_point >> 6) & 0x3F));
                            remaining = remaining[remaining.len..];
                        },
                        else => {},
                    }
                },
                4 => {
                    //only 1 to 3 written
                    switch (remaining.len) {
                        1 => {
                            remaining[0] = @as(u8, @truncate(0xF0 | (replacement.code_point >> 18)));
                            remaining = remaining[remaining.len..];
                        },
                        2 => {
                            remaining[0] = @as(u8, @truncate(0xF0 | (replacement.code_point >> 18)));
                            remaining[1] = @as(u8, @truncate(0x80 | (replacement.code_point >> 12) & 0x3F));
                            remaining = remaining[remaining.len..];
                        },
                        3 => {
                            remaining[0] = @as(u8, @truncate(0xF0 | (replacement.code_point >> 18)));
                            remaining[1] = @as(u8, @truncate(0x80 | (replacement.code_point >> 12) & 0x3F));
                            remaining[2] = @as(u8, @truncate(0x80 | (replacement.code_point >> 6) & 0x3F));
                            remaining = remaining[remaining.len..];
                        },
                        else => {},
                    }
                },

                else => {},
            };
            break;
        }

        utf16_remaining = utf16_remaining[replacement.len..];
        _ = encodeWTF8RuneT(remaining.ptr[0..4], u32, @as(u32, replacement.code_point));
        remaining = remaining[width..];
    }

    if (remaining.len > 0 and !ended_on_non_ascii and utf16_remaining.len > 0) {
        const len = @min(remaining.len, utf16_remaining.len);
        copyU16IntoU8(remaining[0..len], Type, utf16_remaining[0..len]);
        utf16_remaining = utf16_remaining[len..];
        remaining = remaining[len..];
    }

    return .{
        .read = @as(u32, @truncate(utf16.len - utf16_remaining.len)),
        .written = @as(u32, @truncate(buf.len - remaining.len)),
    };
}

pub fn elementLengthUTF16IntoUTF8(comptime Type: type, utf16: Type) usize {
    if (bun.FeatureFlags.use_simdutf) {
        return bun.simdutf.length.utf8.from.utf16.le(utf16);
    }

    var utf16_remaining = utf16;
    var count: usize = 0;

    while (firstNonASCII16(Type, utf16_remaining)) |i| {
        count += i;

        utf16_remaining = utf16_remaining[i..];

        const replacement = utf16Codepoint(Type, utf16_remaining);

        count += replacement.utf8Width();
        utf16_remaining = utf16_remaining[replacement.len..];
    }

    return count + utf16_remaining.len;
}

pub fn elementLengthUTF8IntoUTF16(comptime Type: type, utf8: Type) usize {
    var utf8_remaining = utf8;
    var count: usize = 0;

    if (bun.FeatureFlags.use_simdutf) {
        return bun.simdutf.length.utf16.from.utf8(utf8);
    }

    while (firstNonASCII(utf8_remaining)) |i| {
        count += i;

        utf8_remaining = utf8_remaining[i..];

        const replacement = utf16Codepoint(Type, utf8_remaining);

        count += replacement.len;
        utf8_remaining = utf8_remaining[@min(replacement.utf8Width(), utf8_remaining.len)..];
    }

    return count + utf8_remaining.len;
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
        for (0..width) |k| {
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
        .always_inline,
        encodeWTF8RuneT,
        .{
            p,
            u32,
            @as(u32, @intCast(r)),
        },
    );
}

pub fn encodeWTF8RuneT(p: *[4]u8, comptime R: type, r: R) u3 {
    switch (r) {
        0...0x7F => {
            p[0] = @as(u8, @intCast(r));
            return 1;
        },
        (0x7F + 1)...0x7FF => {
            p[0] = @as(u8, @truncate(0xC0 | ((r >> 6))));
            p[1] = @as(u8, @truncate(0x80 | (r & 0x3F)));
            return 2;
        },
        (0x7FF + 1)...0xFFFF => {
            p[0] = @as(u8, @truncate(0xE0 | ((r >> 12))));
            p[1] = @as(u8, @truncate(0x80 | ((r >> 6) & 0x3F)));
            p[2] = @as(u8, @truncate(0x80 | (r & 0x3F)));
            return 3;
        },
        else => {
            p[0] = @as(u8, @truncate(0xF0 | ((r >> 18))));
            p[1] = @as(u8, @truncate(0x80 | ((r >> 12) & 0x3F)));
            p[2] = @as(u8, @truncate(0x80 | ((r >> 6) & 0x3F)));
            p[3] = @as(u8, @truncate(0x80 | (r & 0x3F)));
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

/// 0 == invalid
pub inline fn wtf8ByteSequenceLengthWithInvalid(first_byte: u8) u3 {
    return switch (first_byte) {
        0...0x80 - 1 => 1,
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
    if (comptime Environment.allow_assert) assert(len > 1);

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

pub const ascii_vector_size = if (Environment.isWasm) 8 else 16;
pub const ascii_u16_vector_size = if (Environment.isWasm) 4 else 8;
pub const AsciiVectorInt = std.meta.Int(.unsigned, ascii_vector_size);
pub const AsciiVectorIntU16 = std.meta.Int(.unsigned, ascii_u16_vector_size);
pub const max_16_ascii: @Vector(ascii_vector_size, u8) = @splat(@as(u8, 127));
pub const min_16_ascii: @Vector(ascii_vector_size, u8) = @splat(@as(u8, 0x20));
pub const max_u16_ascii: @Vector(ascii_u16_vector_size, u16) = @splat(@as(u16, 127));
pub const min_u16_ascii: @Vector(ascii_u16_vector_size, u16) = @splat(@as(u16, 0x20));
pub const AsciiVector = @Vector(ascii_vector_size, u8);
pub const AsciiVectorSmall = @Vector(8, u8);
pub const AsciiVectorU1 = @Vector(ascii_vector_size, u1);
pub const AsciiVectorU1Small = @Vector(8, u1);
pub const AsciiVectorU16U1 = @Vector(ascii_u16_vector_size, u1);
pub const AsciiU16Vector = @Vector(ascii_u16_vector_size, u16);
pub const max_4_ascii: @Vector(4, u8) = @splat(@as(u8, 127));

const UTF8_ACCEPT: u8 = 0;
const UTF8_REJECT: u8 = 12;

const utf8d: [364]u8 = .{
    // The first part of the table maps bytes to character classes that
    // to reduce the size of the transition table and create bitmasks.
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,
    7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,
    8,  8,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,
    10, 3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  4,  3,  3,  11, 6,  6,  6,  5,  8,  8,  8,  8,  8,  8,  8,  8,  8,  8,  8,

    // The second part is a transition table that maps a combination
    // of a state of the automaton and a character class to a state.
    0,  12, 24, 36, 60, 96, 84, 12, 12, 12, 48, 72, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 0,  12, 12, 12, 12, 12, 0,
    12, 0,  12, 12, 12, 24, 12, 12, 12, 12, 12, 24, 12, 24, 12, 12, 12, 12, 12, 12, 12, 12, 12, 24, 12, 12, 12, 12, 12, 24, 12, 12,
    12, 12, 12, 12, 12, 24, 12, 12, 12, 12, 12, 12, 12, 12, 12, 36, 12, 36, 12, 12, 12, 36, 12, 12, 12, 12, 12, 36, 12, 36, 12, 12,
    12, 36, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
};

pub fn decodeCheck(state: u8, byte: u8) u8 {
    const char_type: u32 = utf8d[byte];
    // we dont care about the codep
    // codep = if (*state != UTF8_ACCEPT) (byte & 0x3f) | (*codep << 6) else (0xff >> char_type) & (byte);

    const value = @as(u32, 256) + state + char_type;
    if (value >= utf8d.len) return UTF8_REJECT;
    return utf8d[value];
}

// Copyright (c) 2008-2009 Bjoern Hoehrmann <bjoern@hoehrmann.de>
// See http://bjoern.hoehrmann.de/utf-8/decoder/dfa/ for details.
pub fn isValidUTF8WithoutSIMD(slice: []const u8) bool {
    var state: u8 = 0;

    for (slice) |byte| {
        state = decodeCheck(state, byte);
    }
    return state == UTF8_ACCEPT;
}

pub fn isValidUTF8(slice: []const u8) bool {
    if (bun.FeatureFlags.use_simdutf)
        return bun.simdutf.validate.utf8(slice);

    return isValidUTF8WithoutSIMD(slice);
}

pub fn isAllASCII(slice: []const u8) bool {
    if (@inComptime()) {
        for (slice) |char| {
            if (char > 127) {
                return false;
            }
        }
        return true;
    }

    if (bun.FeatureFlags.use_simdutf)
        return bun.simdutf.validate.ascii(slice);

    var remaining = slice;

    // The NEON SIMD unit is 128-bit wide and includes 16 128-bit registers that can be used as 32 64-bit registers
    if (comptime Environment.enableSIMD) {
        const remaining_end_ptr = remaining.ptr + remaining.len - (remaining.len % ascii_vector_size);
        while (remaining.ptr != remaining_end_ptr) : (remaining.ptr += ascii_vector_size) {
            const vec: AsciiVector = remaining[0..ascii_vector_size].*;

            if (@reduce(.Max, vec) > 127) {
                return false;
            }
        }
    }

    const Int = u64;
    const size = @sizeOf(Int);
    const remaining_last8 = slice.ptr + slice.len - (slice.len % size);
    while (remaining.ptr != remaining_last8) : (remaining.ptr += size) {
        const bytes = @as(Int, @bitCast(remaining[0..size].*));
        // https://dotat.at/@/2022-06-27-tolower-swar.html
        const mask = bytes & 0x8080808080808080;

        if (mask > 0) {
            return false;
        }
    }

    const final = slice.ptr + slice.len;
    while (remaining.ptr != final) : (remaining.ptr += 1) {
        if (remaining[0] > 127) {
            return false;
        }
    }

    return true;
}

//#define U16_LEAD(supplementary) (UChar)(((supplementary)>>10)+0xd7c0)
pub inline fn u16Lead(supplementary: anytype) u16 {
    return @as(u16, @intCast((supplementary >> 10) + 0xd7c0));
}

//#define U16_TRAIL(supplementary) (UChar)(((supplementary)&0x3ff)|0xdc00)
pub inline fn u16Trail(supplementary: anytype) u16 {
    return @as(u16, @intCast((supplementary & 0x3ff) | 0xdc00));
}

pub fn firstNonASCII(slice: []const u8) ?u32 {
    return firstNonASCIIWithType([]const u8, slice);
}

pub fn firstNonASCIIWithType(comptime Type: type, slice: Type) ?u32 {
    var remaining = slice;

    if (comptime bun.FeatureFlags.use_simdutf) {
        const result = bun.simdutf.validate.with_errors.ascii(slice);
        if (result.status == .success) {
            return null;
        }

        return @as(u32, @truncate(result.count));
    }

    if (comptime Environment.enableSIMD) {
        if (remaining.len >= ascii_vector_size) {
            const remaining_start = remaining.ptr;
            const remaining_end = remaining.ptr + remaining.len - (remaining.len % ascii_vector_size);

            while (remaining.ptr != remaining_end) {
                const vec: AsciiVector = remaining[0..ascii_vector_size].*;

                if (@reduce(.Max, vec) > 127) {
                    const Int = u64;
                    const size = @sizeOf(Int);
                    remaining.len -= @intFromPtr(remaining.ptr) - @intFromPtr(remaining_start);

                    {
                        const bytes = @as(Int, @bitCast(remaining[0..size].*));
                        // https://dotat.at/@/2022-06-27-tolower-swar.html
                        const mask = bytes & 0x8080808080808080;

                        if (mask > 0) {
                            const first_set_byte = @ctz(mask) / 8;
                            if (comptime Environment.isDebug) {
                                bun.assert(remaining[first_set_byte] > 127);
                                for (0..first_set_byte) |j| {
                                    bun.assert(remaining[j] <= 127);
                                }
                            }

                            return @as(u32, first_set_byte) + @as(u32, @intCast(slice.len - remaining.len));
                        }
                        remaining = remaining[size..];
                    }
                    {
                        const bytes = @as(Int, @bitCast(remaining[0..size].*));
                        const mask = bytes & 0x8080808080808080;

                        if (mask > 0) {
                            const first_set_byte = @ctz(mask) / 8;
                            if (comptime Environment.isDebug) {
                                bun.assert(remaining[first_set_byte] > 127);
                                for (0..first_set_byte) |j| {
                                    bun.assert(remaining[j] <= 127);
                                }
                            }

                            return @as(u32, first_set_byte) + @as(u32, @intCast(slice.len - remaining.len));
                        }
                    }
                    unreachable;
                }

                // the more intuitive way, using slices, produces worse codegen
                // specifically: it subtracts the length at the end of the loop
                // we don't need to do that
                // we only need to subtract the length once at the very end
                remaining.ptr += ascii_vector_size;
            }
            remaining.len -= @intFromPtr(remaining.ptr) - @intFromPtr(remaining_start);
        }
    }

    {
        const Int = u64;
        const size = @sizeOf(Int);
        const remaining_start = remaining.ptr;
        const remaining_end = remaining.ptr + remaining.len - (remaining.len % size);

        if (comptime Environment.enableSIMD) {
            // these assertions exist more so for LLVM
            bun.unsafeAssert(remaining.len < ascii_vector_size);
            bun.unsafeAssert(@intFromPtr(remaining.ptr + ascii_vector_size) > @intFromPtr(remaining_end));
        }

        if (remaining.len >= size) {
            while (remaining.ptr != remaining_end) {
                const bytes = @as(Int, @bitCast(remaining[0..size].*));
                // https://dotat.at/@/2022-06-27-tolower-swar.html
                const mask = bytes & 0x8080808080808080;

                if (mask > 0) {
                    remaining.len -= @intFromPtr(remaining.ptr) - @intFromPtr(remaining_start);
                    const first_set_byte = @ctz(mask) / 8;
                    if (comptime Environment.isDebug) {
                        bun.unsafeAssert(remaining[first_set_byte] > 127);
                        for (0..first_set_byte) |j| {
                            bun.unsafeAssert(remaining[j] <= 127);
                        }
                    }

                    return @as(u32, first_set_byte) + @as(u32, @intCast(slice.len - remaining.len));
                }

                remaining.ptr += size;
            }
            remaining.len -= @intFromPtr(remaining.ptr) - @intFromPtr(remaining_start);
        }
    }

    if (comptime Environment.allow_assert) assert(remaining.len < 8);

    for (remaining) |*char| {
        if (char.* > 127) {
            // try to prevent it from reading the length of the slice
            return @as(u32, @truncate(@intFromPtr(char) - @intFromPtr(slice.ptr)));
        }
    }

    return null;
}

pub fn indexOfNewlineOrNonASCIIOrANSI(slice_: []const u8, offset: u32) ?u32 {
    const slice = slice_[offset..];
    var remaining = slice;

    if (remaining.len == 0)
        return null;

    if (comptime Environment.enableSIMD) {
        while (remaining.len >= ascii_vector_size) {
            const vec: AsciiVector = remaining[0..ascii_vector_size].*;
            const cmp = @as(AsciiVectorU1, @bitCast((vec > max_16_ascii))) | @as(AsciiVectorU1, @bitCast((vec < min_16_ascii))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat(@as(u8, '\r'))))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat(@as(u8, '\n'))))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat(@as(u8, '\x1b')))));

            if (@reduce(.Max, cmp) > 0) {
                const bitmask = @as(AsciiVectorInt, @bitCast(cmp));
                const first = @ctz(bitmask);

                return @as(u32, first) + @as(u32, @intCast(slice.len - remaining.len)) + offset;
            }

            remaining = remaining[ascii_vector_size..];
        }

        if (comptime Environment.allow_assert) assert(remaining.len < ascii_vector_size);
    }

    for (remaining) |*char_| {
        const char = char_.*;
        if (char > 127 or char < 0x20 or char == '\n' or char == '\r' or char == '\x1b') {
            return @as(u32, @truncate((@intFromPtr(char_) - @intFromPtr(slice.ptr)))) + offset;
        }
    }

    return null;
}

pub fn indexOfNewlineOrNonASCII(slice_: []const u8, offset: u32) ?u32 {
    return indexOfNewlineOrNonASCIICheckStart(slice_, offset, true);
}

pub fn indexOfNewlineOrNonASCIICheckStart(slice_: []const u8, offset: u32, comptime check_start: bool) ?u32 {
    const slice = slice_[offset..];
    var remaining = slice;

    if (remaining.len == 0)
        return null;

    if (comptime check_start) {
        // this shows up in profiling
        if (remaining[0] > 127 or remaining[0] < 0x20 or remaining[0] == '\r' or remaining[0] == '\n') {
            return offset;
        }
    }

    if (comptime Environment.enableSIMD) {
        while (remaining.len >= ascii_vector_size) {
            const vec: AsciiVector = remaining[0..ascii_vector_size].*;
            const cmp = @as(AsciiVectorU1, @bitCast((vec > max_16_ascii))) | @as(AsciiVectorU1, @bitCast((vec < min_16_ascii))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat(@as(u8, '\r'))))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat(@as(u8, '\n')))));

            if (@reduce(.Max, cmp) > 0) {
                const bitmask = @as(AsciiVectorInt, @bitCast(cmp));
                const first = @ctz(bitmask);

                return @as(u32, first) + @as(u32, @intCast(slice.len - remaining.len)) + offset;
            }

            remaining = remaining[ascii_vector_size..];
        }

        if (comptime Environment.allow_assert) assert(remaining.len < ascii_vector_size);
    }

    for (remaining) |*char_| {
        const char = char_.*;
        if (char > 127 or char < 0x20 or char == '\n' or char == '\r') {
            return @as(u32, @truncate((@intFromPtr(char_) - @intFromPtr(slice.ptr)))) + offset;
        }
    }

    return null;
}

pub fn containsNewlineOrNonASCIIOrQuote(slice_: []const u8) bool {
    const slice = slice_;
    var remaining = slice;

    if (remaining.len == 0)
        return false;

    if (comptime Environment.enableSIMD) {
        while (remaining.len >= ascii_vector_size) {
            const vec: AsciiVector = remaining[0..ascii_vector_size].*;
            const cmp = @as(AsciiVectorU1, @bitCast((vec > max_16_ascii))) | @as(AsciiVectorU1, @bitCast((vec < min_16_ascii))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat(@as(u8, '\r'))))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat(@as(u8, '\n'))))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat(@as(u8, '"')))));

            if (@reduce(.Max, cmp) > 0) {
                return true;
            }

            remaining = remaining[ascii_vector_size..];
        }

        if (comptime Environment.allow_assert) assert(remaining.len < ascii_vector_size);
    }

    for (remaining) |*char_| {
        const char = char_.*;
        if (char > 127 or char < 0x20 or char == '\n' or char == '\r' or char == '"') {
            return true;
        }
    }

    return false;
}

pub fn indexOfNeedsEscape(slice: []const u8) ?u32 {
    var remaining = slice;
    if (remaining.len == 0)
        return null;

    if (remaining[0] >= 127 or remaining[0] < 0x20 or remaining[0] == '\\' or remaining[0] == '"') {
        return 0;
    }

    if (comptime Environment.enableSIMD) {
        while (remaining.len >= ascii_vector_size) {
            const vec: AsciiVector = remaining[0..ascii_vector_size].*;
            const cmp = @as(AsciiVectorU1, @bitCast((vec > max_16_ascii))) | @as(AsciiVectorU1, @bitCast((vec < min_16_ascii))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat(@as(u8, '\\'))))) |
                @as(AsciiVectorU1, @bitCast(vec == @as(AsciiVector, @splat(@as(u8, '"')))));

            if (@reduce(.Max, cmp) > 0) {
                const bitmask = @as(AsciiVectorInt, @bitCast(cmp));
                const first = @ctz(bitmask);

                return @as(u32, first) + @as(u32, @truncate(@intFromPtr(remaining.ptr) - @intFromPtr(slice.ptr)));
            }

            remaining = remaining[ascii_vector_size..];
        }
    }

    for (remaining) |*char_| {
        const char = char_.*;
        if (char > 127 or char < 0x20 or char == '\\' or char == '"') {
            return @as(u32, @truncate(@intFromPtr(char_) - @intFromPtr(slice.ptr)));
        }
    }

    return null;
}

pub fn indexOfCharZ(sliceZ: [:0]const u8, char: u8) ?u63 {
    const ptr = bun.C.strchr(sliceZ.ptr, char) orelse return null;
    const pos = @intFromPtr(ptr) - @intFromPtr(sliceZ.ptr);

    if (comptime Environment.isDebug)
        bun.assert(@intFromPtr(sliceZ.ptr) <= @intFromPtr(ptr) and
            @intFromPtr(ptr) < @intFromPtr(sliceZ.ptr + sliceZ.len) and
            pos <= sliceZ.len);

    return @as(u63, @truncate(pos));
}

pub fn indexOfChar(slice: []const u8, char: u8) ?u32 {
    return @as(u32, @truncate(indexOfCharUsize(slice, char) orelse return null));
}

pub fn indexOfCharUsize(slice: []const u8, char: u8) ?usize {
    if (slice.len == 0)
        return null;

    if (comptime !Environment.isNative) {
        return std.mem.indexOfScalar(u8, slice, char);
    }

    const ptr = bun.C.memchr(slice.ptr, char, slice.len) orelse return null;
    const i = @intFromPtr(ptr) - @intFromPtr(slice.ptr);
    bun.assert(i < slice.len);
    bun.assert(slice[i] == char);

    return i;
}

pub fn indexOfChar16Usize(slice: []const u16, char: u16) ?usize {
    return std.mem.indexOfScalar(u16, slice, char);
}

pub fn indexOfNotChar(slice: []const u8, char: u8) ?u32 {
    var remaining = slice;
    if (remaining.len == 0)
        return null;

    if (remaining[0] != char)
        return 0;

    if (comptime Environment.enableSIMD) {
        while (remaining.len >= ascii_vector_size) {
            const vec: AsciiVector = remaining[0..ascii_vector_size].*;
            const cmp = @as(AsciiVector, @splat(char)) != vec;
            if (@reduce(.Max, @as(AsciiVectorU1, @bitCast(cmp))) > 0) {
                const bitmask = @as(AsciiVectorInt, @bitCast(cmp));
                const first = @ctz(bitmask);
                return @as(u32, first) + @as(u32, @intCast(slice.len - remaining.len));
            }

            remaining = remaining[ascii_vector_size..];
        }
    }

    for (remaining) |*current| {
        if (current.* != char) {
            return @as(u32, @truncate(@intFromPtr(current) - @intFromPtr(slice.ptr)));
        }
    }

    return null;
}

const invalid_char: u8 = 0xff;
const hex_table: [255]u8 = brk: {
    var values: [255]u8 = [_]u8{invalid_char} ** 255;
    values['0'] = 0;
    values['1'] = 1;
    values['2'] = 2;
    values['3'] = 3;
    values['4'] = 4;
    values['5'] = 5;
    values['6'] = 6;
    values['7'] = 7;
    values['8'] = 8;
    values['9'] = 9;
    values['A'] = 10;
    values['B'] = 11;
    values['C'] = 12;
    values['D'] = 13;
    values['E'] = 14;
    values['F'] = 15;
    values['a'] = 10;
    values['b'] = 11;
    values['c'] = 12;
    values['d'] = 13;
    values['e'] = 14;
    values['f'] = 15;

    break :brk values;
};

pub fn decodeHexToBytes(destination: []u8, comptime Char: type, source: []const Char) !usize {
    return _decodeHexToBytes(destination, Char, source, false);
}

pub fn decodeHexToBytesTruncate(destination: []u8, comptime Char: type, source: []const Char) usize {
    return _decodeHexToBytes(destination, Char, source, true) catch 0;
}

inline fn _decodeHexToBytes(destination: []u8, comptime Char: type, source: []const Char, comptime truncate: bool) !usize {
    var remain = destination;
    var input = source;

    while (remain.len > 0 and input.len > 1) {
        const int = input[0..2].*;
        if (comptime @sizeOf(Char) > 1) {
            if (int[0] > std.math.maxInt(u8) or int[1] > std.math.maxInt(u8)) {
                if (comptime truncate) break;
                return error.InvalidByteSequence;
            }
        }
        const a = hex_table[@as(u8, @truncate(int[0]))];
        const b = hex_table[@as(u8, @truncate(int[1]))];
        if (a == invalid_char or b == invalid_char) {
            if (comptime truncate) break;
            return error.InvalidByteSequence;
        }
        remain[0] = a << 4 | b;
        remain = remain[1..];
        input = input[2..];
    }

    if (comptime !truncate) {
        if (remain.len > 0 and input.len > 0) return error.InvalidByteSequence;
    }

    return destination.len - remain.len;
}

fn byte2hex(char: u8) u8 {
    return switch (char) {
        0...9 => char + '0',
        10...15 => char - 10 + 'a',
        else => unreachable,
    };
}

pub fn encodeBytesToHex(destination: []u8, source: []const u8) usize {
    if (comptime Environment.allow_assert) {
        bun.unsafeAssert(destination.len > 0);
        bun.unsafeAssert(source.len > 0);
    }
    const to_write = if (destination.len < source.len * 2)
        destination.len - destination.len % 2
    else
        source.len * 2;

    const to_read = to_write / 2;

    var remaining = source[0..to_read];
    var remaining_dest = destination;
    if (comptime Environment.enableSIMD) {
        const remaining_end = remaining.ptr + remaining.len - (remaining.len % 16);
        while (remaining.ptr != remaining_end) {
            const input_chunk: @Vector(16, u8) = remaining[0..16].*;
            const input_chunk_4: @Vector(16, u8) = input_chunk >> @as(@Vector(16, u8), @splat(@as(u8, 4)));
            const input_chunk_15: @Vector(16, u8) = input_chunk & @as(@Vector(16, u8), @splat(@as(u8, 15)));

            // This looks extremely redundant but it was the easiest way to make the compiler do the right thing
            // the more convienient "0123456789abcdef" string produces worse codegen
            // https://zig.godbolt.org/z/bfdracEeq
            const lower_16 = [16]u8{
                byte2hex(input_chunk_4[0]),
                byte2hex(input_chunk_4[1]),
                byte2hex(input_chunk_4[2]),
                byte2hex(input_chunk_4[3]),
                byte2hex(input_chunk_4[4]),
                byte2hex(input_chunk_4[5]),
                byte2hex(input_chunk_4[6]),
                byte2hex(input_chunk_4[7]),
                byte2hex(input_chunk_4[8]),
                byte2hex(input_chunk_4[9]),
                byte2hex(input_chunk_4[10]),
                byte2hex(input_chunk_4[11]),
                byte2hex(input_chunk_4[12]),
                byte2hex(input_chunk_4[13]),
                byte2hex(input_chunk_4[14]),
                byte2hex(input_chunk_4[15]),
            };
            const upper_16 = [16]u8{
                byte2hex(input_chunk_15[0]),
                byte2hex(input_chunk_15[1]),
                byte2hex(input_chunk_15[2]),
                byte2hex(input_chunk_15[3]),
                byte2hex(input_chunk_15[4]),
                byte2hex(input_chunk_15[5]),
                byte2hex(input_chunk_15[6]),
                byte2hex(input_chunk_15[7]),
                byte2hex(input_chunk_15[8]),
                byte2hex(input_chunk_15[9]),
                byte2hex(input_chunk_15[10]),
                byte2hex(input_chunk_15[11]),
                byte2hex(input_chunk_15[12]),
                byte2hex(input_chunk_15[13]),
                byte2hex(input_chunk_15[14]),
                byte2hex(input_chunk_15[15]),
            };

            const output_chunk = std.simd.interlace(.{
                lower_16,
                upper_16,
            });

            remaining_dest[0..32].* = @bitCast(output_chunk);
            remaining_dest = remaining_dest[32..];
            remaining = remaining[16..];
        }
    }

    for (remaining) |c| {
        const charset = "0123456789abcdef";

        const buf: [2]u8 = .{ charset[c >> 4], charset[c & 15] };
        remaining_dest[0..2].* = buf;
        remaining_dest = remaining_dest[2..];
    }

    return to_read * 2;
}

/// Leave a single leading char
/// ```zig
/// trimSubsequentLeadingChars("foo\n\n\n\n", '\n') -> "foo\n"
/// ```
pub fn trimSubsequentLeadingChars(slice: []const u8, char: u8) []const u8 {
    if (slice.len == 0) return slice;
    var end = slice.len - 1;
    var endend = slice.len;
    while (end > 0 and slice[end] == char) : (end -= 1) {
        endend = end + 1;
    }
    return slice[0..endend];
}

pub fn trimLeadingChar(slice: []const u8, char: u8) []const u8 {
    if (indexOfNotChar(slice, char)) |i| {
        return slice[i..];
    }
    return "";
}

/// Get the line number and the byte offsets of `line_range_count` above the desired line number
/// The final element is the end index of the desired line
const LineRange = struct {
    start: u32,
    end: u32,
};
pub fn indexOfLineRanges(text: []const u8, target_line: u32, comptime line_range_count: usize) std.BoundedArray(LineRange, line_range_count) {
    const remaining = text;
    if (remaining.len == 0) return .{};

    var ranges = std.BoundedArray(LineRange, line_range_count){};

    var current_line: u32 = 0;
    const first_newline_or_nonascii_i = strings.indexOfNewlineOrNonASCIICheckStart(text, 0, true) orelse {
        if (target_line == 0) {
            ranges.appendAssumeCapacity(.{
                .start = 0,
                .end = @truncate(text.len),
            });
        }

        return ranges;
    };

    var iter = CodepointIterator.initOffset(text, 0);
    var cursor = CodepointIterator.Cursor{
        .i = first_newline_or_nonascii_i,
    };
    const first_newline_range: LineRange = brk: {
        while (iter.next(&cursor)) {
            const codepoint = cursor.c;
            switch (codepoint) {
                '\n' => {
                    current_line += 1;
                    break :brk .{
                        .start = 0,
                        .end = cursor.i,
                    };
                },
                '\r' => {
                    if (iter.next(&cursor)) {
                        const codepoint2 = cursor.c;
                        if (codepoint2 == '\n') {
                            current_line += 1;
                            break :brk .{
                                .start = 0,
                                .end = cursor.i,
                            };
                        }
                    }
                },
                else => {},
            }
        }

        ranges.appendAssumeCapacity(.{
            .start = 0,
            .end = @truncate(text.len),
        });
        return ranges;
    };

    ranges.appendAssumeCapacity(first_newline_range);

    if (target_line == 0) {
        return ranges;
    }

    var prev_end = first_newline_range.end;
    while (strings.indexOfNewlineOrNonASCIICheckStart(text, cursor.i + @as(u32, cursor.width), true)) |current_i| {
        cursor.i = current_i;
        cursor.width = 0;
        const current_line_range: LineRange = brk: {
            if (iter.next(&cursor)) {
                const codepoint = cursor.c;
                switch (codepoint) {
                    '\n' => {
                        const start = prev_end;
                        prev_end = cursor.i;
                        break :brk .{
                            .start = start,
                            .end = cursor.i + 1,
                        };
                    },
                    '\r' => {
                        const current_end = cursor.i;
                        if (iter.next(&cursor)) {
                            const codepoint2 = cursor.c;
                            if (codepoint2 == '\n') {
                                defer prev_end = cursor.i;
                                break :brk .{
                                    .start = prev_end,
                                    .end = current_end,
                                };
                            }
                        }
                    },
                    else => continue,
                }
            }
        };

        if (ranges.len == line_range_count and current_line <= target_line) {
            var new_ranges = std.BoundedArray(LineRange, line_range_count){};
            new_ranges.appendSliceAssumeCapacity(ranges.slice()[1..]);
            ranges = new_ranges;
        }
        ranges.appendAssumeCapacity(current_line_range);

        if (current_line >= target_line) {
            return ranges;
        }

        current_line += 1;
    }

    if (ranges.len == line_range_count and current_line <= target_line) {
        var new_ranges = std.BoundedArray(LineRange, line_range_count){};
        new_ranges.appendSliceAssumeCapacity(ranges.slice()[1..]);
        ranges = new_ranges;
    }

    return ranges;
}

/// Get N lines from the start of the text
pub fn getLinesInText(text: []const u8, line: u32, comptime line_range_count: usize) ?std.BoundedArray([]const u8, line_range_count) {
    const ranges = indexOfLineRanges(text, line, line_range_count);
    if (ranges.len == 0) return null;
    var results = std.BoundedArray([]const u8, line_range_count){};
    results.len = ranges.len;

    for (results.slice()[0..ranges.len], ranges.slice()) |*chunk, range| {
        chunk.* = text[range.start..range.end];
    }

    std.mem.reverse([]const u8, results.slice());

    return results;
}

pub fn firstNonASCII16(comptime Slice: type, slice: Slice) ?u32 {
    var remaining = slice;
    const remaining_start = remaining.ptr;

    if (Environment.enableSIMD and Environment.isNative) {
        const end_ptr = remaining.ptr + remaining.len - (remaining.len % ascii_u16_vector_size);
        if (remaining.len >= ascii_u16_vector_size) {
            while (remaining.ptr != end_ptr) {
                const vec: AsciiU16Vector = remaining[0..ascii_u16_vector_size].*;
                const max_value = @reduce(.Max, vec);

                if (max_value > 127) {
                    const cmp = vec > max_u16_ascii;
                    const bitmask: u8 = @as(u8, @bitCast(cmp));
                    const index_of_first_nonascii_in_vector = @ctz(bitmask);

                    const offset_of_vector_in_input = (@intFromPtr(remaining.ptr) - @intFromPtr(remaining_start)) / 2;
                    const out: u32 = @intCast(offset_of_vector_in_input + index_of_first_nonascii_in_vector);

                    if (comptime Environment.isDebug) {
                        for (0..index_of_first_nonascii_in_vector) |i| {
                            if (vec[i] > 127) {
                                bun.Output.panic("firstNonASCII16: found non-ASCII character in ASCII vector before the first non-ASCII character", .{});
                            }
                        }

                        if (slice[out] <= 127) {
                            bun.Output.panic("firstNonASCII16: Expected non-ascii character", .{});
                        }
                    }

                    return out;
                }

                remaining.ptr += ascii_u16_vector_size;
            }
            remaining.len -= (@intFromPtr(remaining.ptr) - @intFromPtr(remaining_start)) / 2;
        }

        bun.unsafeAssert(remaining.len < ascii_u16_vector_size);
    }

    var i: usize = (@intFromPtr(remaining.ptr) - @intFromPtr(remaining_start)) / 2;

    for (remaining) |char| {
        if (char > 127) {
            return @truncate(i);
        }
        i += 1;
    }

    return null;
}

/// Fast path for printing template literal strings
pub fn @"nextUTF16NonASCIIOr$`\\"(
    comptime Slice: type,
    slice: Slice,
) ?u32 {
    var remaining = slice;

    if (comptime Environment.enableSIMD and Environment.isNative) {
        while (remaining.len >= ascii_u16_vector_size) {
            const vec: AsciiU16Vector = remaining[0..ascii_u16_vector_size].*;

            const cmp = @as(AsciiVectorU16U1, @bitCast((vec > max_u16_ascii))) |
                @as(AsciiVectorU16U1, @bitCast((vec < min_u16_ascii))) |
                @as(AsciiVectorU16U1, @bitCast((vec == @as(AsciiU16Vector, @splat(@as(u16, '$')))))) |
                @as(AsciiVectorU16U1, @bitCast((vec == @as(AsciiU16Vector, @splat(@as(u16, '`')))))) |
                @as(AsciiVectorU16U1, @bitCast((vec == @as(AsciiU16Vector, @splat(@as(u16, '\\'))))));

            const bitmask = @as(u8, @bitCast(cmp));
            const first = @ctz(bitmask);
            if (first < ascii_u16_vector_size) {
                return @as(u32, @intCast(@as(u32, first) +
                    @as(u32, @intCast(slice.len - remaining.len))));
            }

            remaining = remaining[ascii_u16_vector_size..];
        }
    }

    for (remaining, 0..) |char, i| {
        switch (char) {
            '$', '`', '\\', 0...0x20 - 1, 128...std.math.maxInt(u16) => {
                return @as(u32, @truncate(i + (slice.len - remaining.len)));
            },

            else => {},
        }
    }

    return null;
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

pub fn containsNonBmpCodePointOrIsInvalidIdentifier(text: string) bool {
    var iter = CodepointIterator.init(text);
    var curs = CodepointIterator.Cursor{};

    if (!iter.next(&curs)) return true;

    if (curs.c > 0xFFFF or !js_lexer.isIdentifierStart(curs.c))
        return true;

    while (iter.next(&curs)) {
        if (curs.c > 0xFFFF or !js_lexer.isIdentifierContinue(curs.c)) {
            return true;
        }
    }

    return false;
}

// this is std.mem.trim except it doesn't forcibly change the slice to be const
pub fn trim(slice: anytype, comptime values_to_strip: []const u8) @TypeOf(slice) {
    var begin: usize = 0;
    var end: usize = slice.len;

    while (begin < end and std.mem.indexOfScalar(u8, values_to_strip, slice[begin]) != null) : (begin += 1) {}
    while (end > begin and std.mem.indexOfScalar(u8, values_to_strip, slice[end - 1]) != null) : (end -= 1) {}
    return slice[begin..end];
}

pub const whitespace_chars = [_]u8{ ' ', '\t', '\n', '\r', std.ascii.control_code.vt, std.ascii.control_code.ff };

pub fn lengthOfLeadingWhitespaceASCII(slice: string) usize {
    brk: for (slice) |*c| {
        inline for (whitespace_chars) |wc| if (c.* == wc) continue :brk;
        return @intFromPtr(c) - @intFromPtr(slice.ptr);
    }

    return slice.len;
}

pub fn containsNonBmpCodePointUTF16(_text: []const u16) bool {
    const n = _text.len;
    if (n > 0) {
        var i: usize = 0;
        const text = _text[0 .. n - 1];
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

pub fn join(slices: []const string, delimiter: string, allocator: std.mem.Allocator) !string {
    return try std.mem.join(allocator, delimiter, slices);
}

pub fn order(a: []const u8, b: []const u8) std.math.Order {
    const len = @min(a.len, b.len);

    const cmp = if (comptime Environment.isNative) bun.C.memcmp(a.ptr, b.ptr, len) else return std.mem.order(u8, a, b);
    return switch (std.math.sign(cmp)) {
        0 => std.math.order(a.len, b.len),
        1 => .gt,
        -1 => .lt,
        else => unreachable,
    };
}

pub fn cmpStringsAsc(_: void, a: string, b: string) bool {
    return order(a, b) == .lt;
}

pub fn cmpStringsDesc(_: void, a: string, b: string) bool {
    return order(a, b) == .gt;
}

const sort_asc = std.sort.asc(u8);
const sort_desc = std.sort.desc(u8);

pub fn sortAsc(in: []string) void {
    // TODO: experiment with simd to see if it's faster
    std.sort.pdq([]const u8, in, {}, cmpStringsAsc);
}

pub fn sortDesc(in: []string) void {
    // TODO: experiment with simd to see if it's faster
    std.sort.pdq([]const u8, in, {}, cmpStringsDesc);
}

pub const StringArrayByIndexSorter = struct {
    keys: []const []const u8,
    pub fn lessThan(sorter: *const @This(), a: usize, b: usize) bool {
        return strings.order(sorter.keys[a], sorter.keys[b]) == .lt;
    }

    pub fn init(keys: []const []const u8) @This() {
        return .{
            .keys = keys,
        };
    }
};

pub fn isASCIIHexDigit(c: u8) bool {
    return std.ascii.isHex(c);
}

pub fn toASCIIHexValue(character: u8) u8 {
    if (comptime Environment.isDebug) assert(isASCIIHexDigit(character));
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

pub const PackedCodepointIterator = struct {
    const Iterator = @This();
    const CodePointType = u32;
    const zeroValue = 0;

    bytes: []const u8,
    i: usize,
    next_width: usize = 0,
    width: u3 = 0,
    c: CodePointType = zeroValue,

    pub const ZeroValue = zeroValue;

    pub const Cursor = packed struct {
        i: u32 = 0,
        c: u29 = zeroValue,
        width: u3 = 0,
        pub const CodePointType = u29;
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

        {
            @setRuntimeSafety(false);
            cursor.* = Cursor{
                .i = pos,
                .c = if (error_char != codepoint)
                    @truncate(codepoint)
                else
                    unicode_replacement,
                .width = if (codepoint != error_char) cp_len else 1,
            };
        }

        return true;
    }

    inline fn nextCodepointSlice(it: *Iterator) []const u8 {
        const bytes = it.bytes;
        const prev = it.i;
        const next_ = prev + it.next_width;
        if (bytes.len <= next_) return "";

        const cp_len = utf8ByteSequenceLength(bytes[next_]);
        it.next_width = cp_len;
        it.i = @min(next_, bytes.len);

        const slice = bytes[prev..][0..cp_len];
        it.width = @as(u3, @intCast(slice.len));
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
            1 => @as(CodePointType, @intCast(slice[0])),
            2 => @as(CodePointType, @intCast(std.unicode.utf8Decode2(slice) catch unreachable)),
            3 => @as(CodePointType, @intCast(std.unicode.utf8Decode3(slice) catch unreachable)),
            4 => @as(CodePointType, @intCast(std.unicode.utf8Decode4(slice) catch unreachable)),
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

pub fn NewCodePointIterator(comptime CodePointType: type, comptime zeroValue: comptime_int) type {
    return struct {
        const Iterator = @This();
        bytes: []const u8,
        i: usize,
        next_width: usize = 0,
        width: u3 = 0,
        c: CodePointType = zeroValue,

        pub const ZeroValue = zeroValue;

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
            it.i = @min(next_, bytes.len);

            const slice = bytes[prev..][0..cp_len];
            it.width = @as(u3, @intCast(slice.len));
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
                1 => @as(CodePointType, @intCast(slice[0])),
                2 => @as(CodePointType, @intCast(std.unicode.utf8Decode2(slice) catch unreachable)),
                3 => @as(CodePointType, @intCast(std.unicode.utf8Decode3(slice) catch unreachable)),
                4 => @as(CodePointType, @intCast(std.unicode.utf8Decode4(slice) catch unreachable)),
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
            for (0..n) |_| {
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
        pub fn lessThan(_: LengthSorter, lhs: Type, rhs: Type) bool {
            return @field(lhs, field).len < @field(rhs, field).len;
        }
    };
}

pub fn NewGlobLengthSorter(comptime Type: type, comptime field: string) type {
    return struct {
        const GlobLengthSorter = @This();
        pub fn lessThan(_: GlobLengthSorter, lhs: Type, rhs: Type) bool {
            // Assert: keyA ends with "/" or contains only a single "*".
            // Assert: keyB ends with "/" or contains only a single "*".
            const key_a = @field(lhs, field);
            const key_b = @field(rhs, field);

            // Let baseLengthA be the index of "*" in keyA plus one, if keyA contains "*", or the length of keyA otherwise.
            // Let baseLengthB be the index of "*" in keyB plus one, if keyB contains "*", or the length of keyB otherwise.
            const star_a = indexOfChar(key_a, '*');
            const star_b = indexOfChar(key_b, '*');
            const base_length_a = star_a orelse key_a.len;
            const base_length_b = star_b orelse key_b.len;

            // If baseLengthA is greater than baseLengthB, return -1.
            // If baseLengthB is greater than baseLengthA, return 1.
            if (base_length_a > base_length_b)
                return true;
            if (base_length_b > base_length_a)
                return false;

            // If keyA does not contain "*", return 1.
            // If keyB does not contain "*", return -1.
            if (star_a == null)
                return false;
            if (star_b == null)
                return true;

            // If the length of keyA is greater than the length of keyB, return -1.
            // If the length of keyB is greater than the length of keyA, return 1.
            if (key_a.len > key_b.len)
                return true;
            if (key_b.len > key_a.len)
                return false;

            return false;
        }
    };
}

/// Update all strings in a struct pointing to "from" to point to "to".
pub fn moveAllSlices(comptime Type: type, container: *Type, from: string, to: string) void {
    const fields_we_care_about = comptime brk: {
        var count: usize = 0;
        for (std.meta.fields(Type)) |field| {
            if (std.meta.isSlice(field.type) and std.meta.Child(field.type) == u8) {
                count += 1;
            }
        }

        var fields: [count][]const u8 = undefined;
        count = 0;
        for (std.meta.fields(Type)) |field| {
            if (std.meta.isSlice(field.type) and std.meta.Child(field.type) == u8) {
                fields[count] = field.name;
                count += 1;
            }
        }
        break :brk fields;
    };

    inline for (fields_we_care_about) |name| {
        const slice = @field(container, name);
        if ((@intFromPtr(from.ptr) + from.len) >= @intFromPtr(slice.ptr) + slice.len and
            (@intFromPtr(from.ptr) <= @intFromPtr(slice.ptr)))
        {
            @field(container, name) = moveSlice(slice, from, to);
        }
    }
}

pub fn moveSlice(slice: string, from: string, to: string) string {
    if (comptime Environment.allow_assert) {
        bun.unsafeAssert(from.len <= to.len and from.len >= slice.len);
        // assert we are in bounds
        bun.unsafeAssert(
            (@intFromPtr(from.ptr) + from.len) >=
                @intFromPtr(slice.ptr) + slice.len and
                (@intFromPtr(from.ptr) <= @intFromPtr(slice.ptr)),
        );
        bun.unsafeAssert(eqlLong(from, to[0..from.len], false)); // data should be identical
    }

    const ptr_offset = @intFromPtr(slice.ptr) - @intFromPtr(from.ptr);
    const result = to[ptr_offset..][0..slice.len];

    if (comptime Environment.allow_assert) assert(eqlLong(slice, result, false)); // data should be identical

    return result;
}

pub usingnamespace @import("exact_size_matcher.zig");

pub const unicode_replacement = 0xFFFD;
pub const unicode_replacement_str = brk: {
    var out: [std.unicode.utf8CodepointSequenceLength(unicode_replacement) catch unreachable]u8 = undefined;
    _ = std.unicode.utf8Encode(unicode_replacement, &out) catch unreachable;
    break :brk out;
};

pub fn isIPAddress(input: []const u8) bool {
    var max_ip_address_buffer: [512]u8 = undefined;
    if (input.len > max_ip_address_buffer.len) return false;

    var sockaddr: std.posix.sockaddr = undefined;
    @memset(std.mem.asBytes(&sockaddr), 0);
    @memcpy(max_ip_address_buffer[0..input.len], input);
    max_ip_address_buffer[input.len] = 0;

    const ip_addr_str: [:0]const u8 = max_ip_address_buffer[0..input.len :0];

    return bun.c_ares.ares_inet_pton(std.posix.AF.INET, ip_addr_str.ptr, &sockaddr) > 0 or bun.c_ares.ares_inet_pton(std.posix.AF.INET6, ip_addr_str.ptr, &sockaddr) > 0;
}

pub fn isIPV6Address(input: []const u8) bool {
    var max_ip_address_buffer: [512]u8 = undefined;
    if (input.len > max_ip_address_buffer.len) return false;

    var sockaddr: std.posix.sockaddr = undefined;
    @memset(std.mem.asBytes(&sockaddr), 0);
    @memcpy(max_ip_address_buffer[0..input.len], input);
    max_ip_address_buffer[input.len] = 0;

    const ip_addr_str: [:0]const u8 = max_ip_address_buffer[0..input.len :0];
    return bun.c_ares.ares_inet_pton(std.posix.AF.INET6, ip_addr_str.ptr, &sockaddr) > 0;
}

pub fn cloneNormalizingSeparators(
    allocator: std.mem.Allocator,
    input: []const u8,
) ![]u8 {
    // remove duplicate slashes in the file path
    const base = withoutTrailingSlash(input);
    var tokenized = std.mem.tokenize(u8, base, std.fs.path.sep_str);
    var buf = try allocator.alloc(u8, base.len + 2);
    if (comptime Environment.allow_assert) assert(base.len > 0);
    if (base[0] == std.fs.path.sep) {
        buf[0] = std.fs.path.sep;
    }
    var remain = buf[@as(usize, @intFromBool(base[0] == std.fs.path.sep))..];

    while (tokenized.next()) |token| {
        if (token.len == 0) continue;
        bun.copy(u8, remain, token);
        remain[token.len..][0] = std.fs.path.sep;
        remain = remain[token.len + 1 ..];
    }
    if ((remain.ptr - 1) != buf.ptr and (remain.ptr - 1)[0] != std.fs.path.sep) {
        remain[0] = std.fs.path.sep;
        remain = remain[1..];
    }
    remain[0] = 0;

    return buf[0 .. @intFromPtr(remain.ptr) - @intFromPtr(buf.ptr)];
}

pub fn leftHasAnyInRight(to_check: []const string, against: []const string) bool {
    for (to_check) |check| {
        for (against) |item| {
            if (eqlLong(check, item, true)) return true;
        }
    }
    return false;
}

pub fn hasPrefixWithWordBoundary(input: []const u8, comptime prefix: []const u8) bool {
    if (hasPrefixComptime(input, prefix)) {
        if (input.len == prefix.len) return true;

        const next = input[prefix.len..];
        var bytes: [4]u8 = .{
            next[0],
            if (next.len > 1) next[1] else 0,
            if (next.len > 2) next[2] else 0,
            if (next.len > 3) next[3] else 0,
        };

        if (!bun.js_lexer.isIdentifierContinue(decodeWTF8RuneT(&bytes, wtf8ByteSequenceLength(next[0]), i32, -1))) {
            return true;
        }
    }

    return false;
}

pub fn concatWithLength(
    allocator: std.mem.Allocator,
    args: []const string,
    length: usize,
) ![]u8 {
    const out = try allocator.alloc(u8, length);
    var remain = out;
    for (args) |arg| {
        @memcpy(remain[0..arg.len], arg);
        remain = remain[arg.len..];
    }
    bun.unsafeAssert(remain.len == 0); // all bytes should be used
    return out;
}

pub fn concat(
    allocator: std.mem.Allocator,
    args: []const string,
) ![]u8 {
    var length: usize = 0;
    for (args) |arg| {
        length += arg.len;
    }
    return concatWithLength(allocator, args, length);
}

pub fn concatIfNeeded(
    allocator: std.mem.Allocator,
    dest: *[]const u8,
    args: []const string,
    interned_strings_to_check: []const string,
) !void {
    const total_length: usize = brk: {
        var length: usize = 0;
        for (args) |arg| {
            length += arg.len;
        }
        break :brk length;
    };

    if (total_length == 0) {
        dest.* = "";
        return;
    }

    if (total_length < 1024) {
        var stack = std.heap.stackFallback(1024, allocator);
        const stack_copy = concatWithLength(stack.get(), args, total_length) catch unreachable;
        for (interned_strings_to_check) |interned| {
            if (eqlLong(stack_copy, interned, true)) {
                dest.* = interned;
                return;
            }
        }
    }

    const is_needed = brk: {
        const out = dest.*;
        var remain = out;

        for (args) |arg| {
            if (args.len > remain.len) {
                break :brk true;
            }

            if (eqlLong(remain[0..args.len], arg, true)) {
                remain = remain[args.len..];
            } else {
                break :brk true;
            }
        }

        break :brk false;
    };

    if (!is_needed) return;

    var buf = try allocator.alloc(u8, total_length);
    dest.* = buf;
    var remain = buf[0..];
    for (args) |arg| {
        @memcpy(remain[0..arg.len], arg);

        remain = remain[arg.len..];
    }
    bun.unsafeAssert(remain.len == 0);
}

/// This will simply ignore invalid UTF-8 and just do it
pub fn convertUTF8toUTF16InBuffer(
    buf: []u16,
    input: []const u8,
) []u16 {
    // TODO(@paperdave): implement error handling here.
    // for now this will cause invalid utf-8 to be ignored and become empty.
    // this is lame because of https://github.com/oven-sh/bun/issues/8197
    // it will cause process.env.whatever to be len=0 instead of the data
    // but it's better than failing the run entirely
    //
    // the reason i didn't implement the fallback is purely because our
    // code in this file is too chaotic. it is left as a TODO
    if (input.len == 0) return buf[0..0];
    const result = bun.simdutf.convert.utf8.to.utf16.le(input, buf);
    return buf[0..result];
}

pub fn convertUTF8toUTF16InBufferZ(
    buf: []u16,
    input: []const u8,
) [:0]u16 {
    // TODO: see convertUTF8toUTF16InBuffer
    if (input.len == 0) {
        buf[0] = 0;
        return buf[0..0 :0];
    }
    const result = bun.simdutf.convert.utf8.to.utf16.le(input, buf);
    buf[result] = 0;
    return buf[0..result :0];
}

pub fn convertUTF16toUTF8InBuffer(
    buf: []u8,
    input: []const u16,
) ![]const u8 {
    // See above
    if (input.len == 0) return &[_]u8{};
    const result = bun.simdutf.convert.utf16.to.utf8.le(input, buf);
    // switch (result.status) {
    //     .success => return buf[0..result.count],
    //     // TODO(@paperdave): handle surrogate
    //     .surrogate => @panic("TODO: handle surrogate in convertUTF8toUTF16"),
    //     else => @panic("TODO: handle error in convertUTF16toUTF8InBuffer"),
    // }
    return buf[0..result];
}

pub inline fn charIsAnySlash(char: u8) bool {
    return char == '/' or char == '\\';
}

pub inline fn startsWithWindowsDriveLetter(s: []const u8) bool {
    return startsWithWindowsDriveLetterT(u8, s);
}

pub inline fn startsWithWindowsDriveLetterT(comptime T: type, s: []const T) bool {
    return s.len > 2 and s[1] == ':' and switch (s[0]) {
        'a'...'z', 'A'...'Z' => true,
        else => false,
    };
}

pub fn mustEscapeYAMLString(contents: []const u8) bool {
    if (contents.len == 0) return true;

    return switch (contents[0]) {
        'A'...'Z', 'a'...'z' => strings.hasPrefixComptime(contents, "Yes") or strings.hasPrefixComptime(contents, "No") or strings.hasPrefixComptime(contents, "true") or
            strings.hasPrefixComptime(contents, "false") or
            std.mem.indexOfAnyPos(u8, contents, 1, ": \t\r\n\x0B\x0C\\\",[]") != null,
        else => true,
    };
}

pub fn pathContainsNodeModulesFolder(path: []const u8) bool {
    return strings.contains(path, comptime std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str);
}

pub fn isZeroWidthCodepointType(comptime T: type, cp: T) bool {
    if (cp <= 0x1f) {
        return true;
    }

    if (cp >= 0x7f and cp <= 0x9f) {
        // C1 control characters
        return true;
    }

    if (comptime @sizeOf(T) == 1) {
        return false;
    }

    if (cp >= 0x300 and cp <= 0x36f) {
        // Combining Diacritical Marks
        return true;
    }
    if (cp >= 0x300 and cp <= 0x36f)
        // Combining Diacritical Marks
        return true;

    if (cp >= 0x200b and cp <= 0x200f) {
        // Modifying Invisible Characters
        return true;
    }

    if (cp >= 0x20d0 and cp <= 0x20ff)
        // Combining Diacritical Marks for Symbols
        return true;

    if (cp >= 0xfe00 and cp <= 0xfe0f)
        // Variation Selectors
        return true;
    if (cp >= 0xfe20 and cp <= 0xfe2f)
        // Combining Half Marks
        return true;

    if (cp == 0xfeff)
        // Zero Width No-Break Space (BOM, ZWNBSP)
        return true;

    if (cp >= 0xe0100 and cp <= 0xe01ef)
        // Variation Selectors
        return true;

    return false;
}

/// Official unicode reference: https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt
/// Tag legend:
///  - `W` (wide) -> true
///  - `F` (full-width) -> true
///  - `H` (half-width) -> false
///  - `N` (neutral) -> false
///  - `Na` (narrow) -> false
///  - `A` (ambiguous) -> false?
///
/// To regenerate the switch body list, run:
/// ```js
///    [...(await (await fetch("https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt")).text()).matchAll(/^([\dA-F]{4,})(?:\.\.([\dA-F]{4,}))?\s+;\s+(\w+)\s+#\s+(.*?)\s*$/gm)].flatMap(([,start, end, type, comment]) => (
///        (['W', 'F'].includes(type)) ? [`        ${(end ? `0x${start}...0x${end}` : `0x${start}`)}, // ${''.padStart(17 - start.length - (end ? end.length + 5 : 0))}[${type}] ${comment}`] : []
///    )).join('\n')
/// ```
pub fn isFullWidthCodepointType(comptime T: type, cp: T) bool {
    if (!(cp >= 0x1100)) {
        return false;
    }

    return switch (cp) {
        0x1100...0x115F, //     [W] Lo    [96] HANGUL CHOSEONG KIYEOK..HANGUL CHOSEONG FILLER
        0x231A...0x231B, //     [W] So     [2] WATCH..HOURGLASS
        0x2329, //              [W] Ps         LEFT-POINTING ANGLE BRACKET
        0x232A, //              [W] Pe         RIGHT-POINTING ANGLE BRACKET
        0x23E9...0x23EC, //     [W] So     [4] BLACK RIGHT-POINTING DOUBLE TRIANGLE..BLACK DOWN-POINTING DOUBLE TRIANGLE
        0x23F0, //              [W] So         ALARM CLOCK
        0x23F3, //              [W] So         HOURGLASS WITH FLOWING SAND
        0x25FD...0x25FE, //     [W] Sm     [2] WHITE MEDIUM SMALL SQUARE..BLACK MEDIUM SMALL SQUARE
        0x2614...0x2615, //     [W] So     [2] UMBRELLA WITH RAIN DROPS..HOT BEVERAGE
        0x2648...0x2653, //     [W] So    [12] ARIES..PISCES
        0x267F, //              [W] So         WHEELCHAIR SYMBOL
        0x2693, //              [W] So         ANCHOR
        0x26A1, //              [W] So         HIGH VOLTAGE SIGN
        0x26AA...0x26AB, //     [W] So     [2] MEDIUM WHITE CIRCLE..MEDIUM BLACK CIRCLE
        0x26BD...0x26BE, //     [W] So     [2] SOCCER BALL..BASEBALL
        0x26C4...0x26C5, //     [W] So     [2] SNOWMAN WITHOUT SNOW..SUN BEHIND CLOUD
        0x26CE, //              [W] So         OPHIUCHUS
        0x26D4, //              [W] So         NO ENTRY
        0x26EA, //              [W] So         CHURCH
        0x26F2...0x26F3, //     [W] So     [2] FOUNTAIN..FLAG IN HOLE
        0x26F5, //              [W] So         SAILBOAT
        0x26FA, //              [W] So         TENT
        0x26FD, //              [W] So         FUEL PUMP
        0x2705, //              [W] So         WHITE HEAVY CHECK MARK
        0x270A...0x270B, //     [W] So     [2] RAISED FIST..RAISED HAND
        0x2728, //              [W] So         SPARKLES
        0x274C, //              [W] So         CROSS MARK
        0x274E, //              [W] So         NEGATIVE SQUARED CROSS MARK
        0x2753...0x2755, //     [W] So     [3] BLACK QUESTION MARK ORNAMENT..WHITE EXCLAMATION MARK ORNAMENT
        0x2757, //              [W] So         HEAVY EXCLAMATION MARK SYMBOL
        0x2795...0x2797, //     [W] So     [3] HEAVY PLUS SIGN..HEAVY DIVISION SIGN
        0x27B0, //              [W] So         CURLY LOOP
        0x27BF, //              [W] So         DOUBLE CURLY LOOP
        0x2B1B...0x2B1C, //     [W] So     [2] BLACK LARGE SQUARE..WHITE LARGE SQUARE
        0x2B50, //              [W] So         WHITE MEDIUM STAR
        0x2B55, //              [W] So         HEAVY LARGE CIRCLE
        0x2E80...0x2E99, //     [W] So    [26] CJK RADICAL REPEAT..CJK RADICAL RAP
        0x2E9B...0x2EF3, //     [W] So    [89] CJK RADICAL CHOKE..CJK RADICAL C-SIMPLIFIED TURTLE
        0x2F00...0x2FD5, //     [W] So   [214] KANGXI RADICAL ONE..KANGXI RADICAL FLUTE
        0x2FF0...0x2FFF, //     [W] So    [16] IDEOGRAPHIC DESCRIPTION CHARACTER LEFT TO RIGHT..IDEOGRAPHIC DESCRIPTION CHARACTER ROTATION
        0x3000, //              [F] Zs         IDEOGRAPHIC SPACE
        0x3001...0x3003, //     [W] Po     [3] IDEOGRAPHIC COMMA..DITTO MARK
        0x3004, //              [W] So         JAPANESE INDUSTRIAL STANDARD SYMBOL
        0x3005, //              [W] Lm         IDEOGRAPHIC ITERATION MARK
        0x3006, //              [W] Lo         IDEOGRAPHIC CLOSING MARK
        0x3007, //              [W] Nl         IDEOGRAPHIC NUMBER ZERO
        0x3008, //              [W] Ps         LEFT ANGLE BRACKET
        0x3009, //              [W] Pe         RIGHT ANGLE BRACKET
        0x300A, //              [W] Ps         LEFT DOUBLE ANGLE BRACKET
        0x300B, //              [W] Pe         RIGHT DOUBLE ANGLE BRACKET
        0x300C, //              [W] Ps         LEFT CORNER BRACKET
        0x300D, //              [W] Pe         RIGHT CORNER BRACKET
        0x300E, //              [W] Ps         LEFT WHITE CORNER BRACKET
        0x300F, //              [W] Pe         RIGHT WHITE CORNER BRACKET
        0x3010, //              [W] Ps         LEFT BLACK LENTICULAR BRACKET
        0x3011, //              [W] Pe         RIGHT BLACK LENTICULAR BRACKET
        0x3012...0x3013, //     [W] So     [2] POSTAL MARK..GETA MARK
        0x3014, //              [W] Ps         LEFT TORTOISE SHELL BRACKET
        0x3015, //              [W] Pe         RIGHT TORTOISE SHELL BRACKET
        0x3016, //              [W] Ps         LEFT WHITE LENTICULAR BRACKET
        0x3017, //              [W] Pe         RIGHT WHITE LENTICULAR BRACKET
        0x3018, //              [W] Ps         LEFT WHITE TORTOISE SHELL BRACKET
        0x3019, //              [W] Pe         RIGHT WHITE TORTOISE SHELL BRACKET
        0x301A, //              [W] Ps         LEFT WHITE SQUARE BRACKET
        0x301B, //              [W] Pe         RIGHT WHITE SQUARE BRACKET
        0x301C, //              [W] Pd         WAVE DASH
        0x301D, //              [W] Ps         REVERSED DOUBLE PRIME QUOTATION MARK
        0x301E...0x301F, //     [W] Pe     [2] DOUBLE PRIME QUOTATION MARK..LOW DOUBLE PRIME QUOTATION MARK
        0x3020, //              [W] So         POSTAL MARK FACE
        0x3021...0x3029, //     [W] Nl     [9] HANGZHOU NUMERAL ONE..HANGZHOU NUMERAL NINE
        0x302A...0x302D, //     [W] Mn     [4] IDEOGRAPHIC LEVEL TONE MARK..IDEOGRAPHIC ENTERING TONE MARK
        0x302E...0x302F, //     [W] Mc     [2] HANGUL SINGLE DOT TONE MARK..HANGUL DOUBLE DOT TONE MARK
        0x3030, //              [W] Pd         WAVY DASH
        0x3031...0x3035, //     [W] Lm     [5] VERTICAL KANA REPEAT MARK..VERTICAL KANA REPEAT MARK LOWER HALF
        0x3036...0x3037, //     [W] So     [2] CIRCLED POSTAL MARK..IDEOGRAPHIC TELEGRAPH LINE FEED SEPARATOR SYMBOL
        0x3038...0x303A, //     [W] Nl     [3] HANGZHOU NUMERAL TEN..HANGZHOU NUMERAL THIRTY
        0x303B, //              [W] Lm         VERTICAL IDEOGRAPHIC ITERATION MARK
        0x303C, //              [W] Lo         MASU MARK
        0x303D, //              [W] Po         PART ALTERNATION MARK
        0x303E, //              [W] So         IDEOGRAPHIC VARIATION INDICATOR
        0x3041...0x3096, //     [W] Lo    [86] HIRAGANA LETTER SMALL A..HIRAGANA LETTER SMALL KE
        0x3099...0x309A, //     [W] Mn     [2] COMBINING KATAKANA-HIRAGANA VOICED SOUND MARK..COMBINING KATAKANA-HIRAGANA SEMI-VOICED SOUND MARK
        0x309B...0x309C, //     [W] Sk     [2] KATAKANA-HIRAGANA VOICED SOUND MARK..KATAKANA-HIRAGANA SEMI-VOICED SOUND MARK
        0x309D...0x309E, //     [W] Lm     [2] HIRAGANA ITERATION MARK..HIRAGANA VOICED ITERATION MARK
        0x309F, //              [W] Lo         HIRAGANA DIGRAPH YORI
        0x30A0, //              [W] Pd         KATAKANA-HIRAGANA DOUBLE HYPHEN
        0x30A1...0x30FA, //     [W] Lo    [90] KATAKANA LETTER SMALL A..KATAKANA LETTER VO
        0x30FB, //              [W] Po         KATAKANA MIDDLE DOT
        0x30FC...0x30FE, //     [W] Lm     [3] KATAKANA-HIRAGANA PROLONGED SOUND MARK..KATAKANA VOICED ITERATION MARK
        0x30FF, //              [W] Lo         KATAKANA DIGRAPH KOTO
        0x3105...0x312F, //     [W] Lo    [43] BOPOMOFO LETTER B..BOPOMOFO LETTER NN
        0x3131...0x318E, //     [W] Lo    [94] HANGUL LETTER KIYEOK..HANGUL LETTER ARAEAE
        0x3190...0x3191, //     [W] So     [2] IDEOGRAPHIC ANNOTATION LINKING MARK..IDEOGRAPHIC ANNOTATION REVERSE MARK
        0x3192...0x3195, //     [W] No     [4] IDEOGRAPHIC ANNOTATION ONE MARK..IDEOGRAPHIC ANNOTATION FOUR MARK
        0x3196...0x319F, //     [W] So    [10] IDEOGRAPHIC ANNOTATION TOP MARK..IDEOGRAPHIC ANNOTATION MAN MARK
        0x31A0...0x31BF, //     [W] Lo    [32] BOPOMOFO LETTER BU..BOPOMOFO LETTER AH
        0x31C0...0x31E3, //     [W] So    [36] CJK STROKE T..CJK STROKE Q
        0x31EF, //              [W] So         IDEOGRAPHIC DESCRIPTION CHARACTER SUBTRACTION
        0x31F0...0x31FF, //     [W] Lo    [16] KATAKANA LETTER SMALL KU..KATAKANA LETTER SMALL RO
        0x3200...0x321E, //     [W] So    [31] PARENTHESIZED HANGUL KIYEOK..PARENTHESIZED KOREAN CHARACTER O HU
        0x3220...0x3229, //     [W] No    [10] PARENTHESIZED IDEOGRAPH ONE..PARENTHESIZED IDEOGRAPH TEN
        0x322A...0x3247, //     [W] So    [30] PARENTHESIZED IDEOGRAPH MOON..CIRCLED IDEOGRAPH KOTO
        0x3250, //              [W] So         PARTNERSHIP SIGN
        0x3251...0x325F, //     [W] No    [15] CIRCLED NUMBER TWENTY ONE..CIRCLED NUMBER THIRTY FIVE
        0x3260...0x327F, //     [W] So    [32] CIRCLED HANGUL KIYEOK..KOREAN STANDARD SYMBOL
        0x3280...0x3289, //     [W] No    [10] CIRCLED IDEOGRAPH ONE..CIRCLED IDEOGRAPH TEN
        0x328A...0x32B0, //     [W] So    [39] CIRCLED IDEOGRAPH MOON..CIRCLED IDEOGRAPH NIGHT
        0x32B1...0x32BF, //     [W] No    [15] CIRCLED NUMBER THIRTY SIX..CIRCLED NUMBER FIFTY
        0x32C0...0x32FF, //     [W] So    [64] IDEOGRAPHIC TELEGRAPH SYMBOL FOR JANUARY..SQUARE ERA NAME REIWA
        0x3300...0x33FF, //     [W] So   [256] SQUARE APAATO..SQUARE GAL
        0x3400...0x4DBF, //     [W] Lo  [6592] CJK UNIFIED IDEOGRAPH-3400..CJK UNIFIED IDEOGRAPH-4DBF
        0x4E00...0x9FFF, //     [W] Lo [20992] CJK UNIFIED IDEOGRAPH-4E00..CJK UNIFIED IDEOGRAPH-9FFF
        0xA000...0xA014, //     [W] Lo    [21] YI SYLLABLE IT..YI SYLLABLE E
        0xA015, //              [W] Lm         YI SYLLABLE WU
        0xA016...0xA48C, //     [W] Lo  [1143] YI SYLLABLE BIT..YI SYLLABLE YYR
        0xA490...0xA4C6, //     [W] So    [55] YI RADICAL QOT..YI RADICAL KE
        0xA960...0xA97C, //     [W] Lo    [29] HANGUL CHOSEONG TIKEUT-MIEUM..HANGUL CHOSEONG SSANGYEORINHIEUH
        0xAC00...0xD7A3, //     [W] Lo [11172] HANGUL SYLLABLE GA..HANGUL SYLLABLE HIH
        0xF900...0xFA6D, //     [W] Lo   [366] CJK COMPATIBILITY IDEOGRAPH-F900..CJK COMPATIBILITY IDEOGRAPH-FA6D
        0xFA6E...0xFA6F, //     [W] Cn     [2] <reserved-FA6E>..<reserved-FA6F>
        0xFA70...0xFAD9, //     [W] Lo   [106] CJK COMPATIBILITY IDEOGRAPH-FA70..CJK COMPATIBILITY IDEOGRAPH-FAD9
        0xFADA...0xFAFF, //     [W] Cn    [38] <reserved-FADA>..<reserved-FAFF>
        0xFE10...0xFE16, //     [W] Po     [7] PRESENTATION FORM FOR VERTICAL COMMA..PRESENTATION FORM FOR VERTICAL QUESTION MARK
        0xFE17, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT WHITE LENTICULAR BRACKET
        0xFE18, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT WHITE LENTICULAR BRAKCET
        0xFE19, //              [W] Po         PRESENTATION FORM FOR VERTICAL HORIZONTAL ELLIPSIS
        0xFE30, //              [W] Po         PRESENTATION FORM FOR VERTICAL TWO DOT LEADER
        0xFE31...0xFE32, //     [W] Pd     [2] PRESENTATION FORM FOR VERTICAL EM DASH..PRESENTATION FORM FOR VERTICAL EN DASH
        0xFE33...0xFE34, //     [W] Pc     [2] PRESENTATION FORM FOR VERTICAL LOW LINE..PRESENTATION FORM FOR VERTICAL WAVY LOW LINE
        0xFE35, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT PARENTHESIS
        0xFE36, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT PARENTHESIS
        0xFE37, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT CURLY BRACKET
        0xFE38, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT CURLY BRACKET
        0xFE39, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT TORTOISE SHELL BRACKET
        0xFE3A, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT TORTOISE SHELL BRACKET
        0xFE3B, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT BLACK LENTICULAR BRACKET
        0xFE3C, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT BLACK LENTICULAR BRACKET
        0xFE3D, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT DOUBLE ANGLE BRACKET
        0xFE3E, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT DOUBLE ANGLE BRACKET
        0xFE3F, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT ANGLE BRACKET
        0xFE40, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT ANGLE BRACKET
        0xFE41, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT CORNER BRACKET
        0xFE42, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT CORNER BRACKET
        0xFE43, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT WHITE CORNER BRACKET
        0xFE44, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT WHITE CORNER BRACKET
        0xFE45...0xFE46, //     [W] Po     [2] SESAME DOT..WHITE SESAME DOT
        0xFE47, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT SQUARE BRACKET
        0xFE48, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT SQUARE BRACKET
        0xFE49...0xFE4C, //     [W] Po     [4] DASHED OVERLINE..DOUBLE WAVY OVERLINE
        0xFE4D...0xFE4F, //     [W] Pc     [3] DASHED LOW LINE..WAVY LOW LINE
        0xFE50...0xFE52, //     [W] Po     [3] SMALL COMMA..SMALL FULL STOP
        0xFE54...0xFE57, //     [W] Po     [4] SMALL SEMICOLON..SMALL EXCLAMATION MARK
        0xFE58, //              [W] Pd         SMALL EM DASH
        0xFE59, //              [W] Ps         SMALL LEFT PARENTHESIS
        0xFE5A, //              [W] Pe         SMALL RIGHT PARENTHESIS
        0xFE5B, //              [W] Ps         SMALL LEFT CURLY BRACKET
        0xFE5C, //              [W] Pe         SMALL RIGHT CURLY BRACKET
        0xFE5D, //              [W] Ps         SMALL LEFT TORTOISE SHELL BRACKET
        0xFE5E, //              [W] Pe         SMALL RIGHT TORTOISE SHELL BRACKET
        0xFE5F...0xFE61, //     [W] Po     [3] SMALL NUMBER SIGN..SMALL ASTERISK
        0xFE62, //              [W] Sm         SMALL PLUS SIGN
        0xFE63, //              [W] Pd         SMALL HYPHEN-MINUS
        0xFE64...0xFE66, //     [W] Sm     [3] SMALL LESS-THAN SIGN..SMALL EQUALS SIGN
        0xFE68, //              [W] Po         SMALL REVERSE SOLIDUS
        0xFE69, //              [W] Sc         SMALL DOLLAR SIGN
        0xFE6A...0xFE6B, //     [W] Po     [2] SMALL PERCENT SIGN..SMALL COMMERCIAL AT
        0xFF01...0xFF03, //     [F] Po     [3] FULLWIDTH EXCLAMATION MARK..FULLWIDTH NUMBER SIGN
        0xFF04, //              [F] Sc         FULLWIDTH DOLLAR SIGN
        0xFF05...0xFF07, //     [F] Po     [3] FULLWIDTH PERCENT SIGN..FULLWIDTH APOSTROPHE
        0xFF08, //              [F] Ps         FULLWIDTH LEFT PARENTHESIS
        0xFF09, //              [F] Pe         FULLWIDTH RIGHT PARENTHESIS
        0xFF0A, //              [F] Po         FULLWIDTH ASTERISK
        0xFF0B, //              [F] Sm         FULLWIDTH PLUS SIGN
        0xFF0C, //              [F] Po         FULLWIDTH COMMA
        0xFF0D, //              [F] Pd         FULLWIDTH HYPHEN-MINUS
        0xFF0E...0xFF0F, //     [F] Po     [2] FULLWIDTH FULL STOP..FULLWIDTH SOLIDUS
        0xFF10...0xFF19, //     [F] Nd    [10] FULLWIDTH DIGIT ZERO..FULLWIDTH DIGIT NINE
        0xFF1A...0xFF1B, //     [F] Po     [2] FULLWIDTH COLON..FULLWIDTH SEMICOLON
        0xFF1C...0xFF1E, //     [F] Sm     [3] FULLWIDTH LESS-THAN SIGN..FULLWIDTH GREATER-THAN SIGN
        0xFF1F...0xFF20, //     [F] Po     [2] FULLWIDTH QUESTION MARK..FULLWIDTH COMMERCIAL AT
        0xFF21...0xFF3A, //     [F] Lu    [26] FULLWIDTH LATIN CAPITAL LETTER A..FULLWIDTH LATIN CAPITAL LETTER Z
        0xFF3B, //              [F] Ps         FULLWIDTH LEFT SQUARE BRACKET
        0xFF3C, //              [F] Po         FULLWIDTH REVERSE SOLIDUS
        0xFF3D, //              [F] Pe         FULLWIDTH RIGHT SQUARE BRACKET
        0xFF3E, //              [F] Sk         FULLWIDTH CIRCUMFLEX ACCENT
        0xFF3F, //              [F] Pc         FULLWIDTH LOW LINE
        0xFF40, //              [F] Sk         FULLWIDTH GRAVE ACCENT
        0xFF41...0xFF5A, //     [F] Ll    [26] FULLWIDTH LATIN SMALL LETTER A..FULLWIDTH LATIN SMALL LETTER Z
        0xFF5B, //              [F] Ps         FULLWIDTH LEFT CURLY BRACKET
        0xFF5C, //              [F] Sm         FULLWIDTH VERTICAL LINE
        0xFF5D, //              [F] Pe         FULLWIDTH RIGHT CURLY BRACKET
        0xFF5E, //              [F] Sm         FULLWIDTH TILDE
        0xFF5F, //              [F] Ps         FULLWIDTH LEFT WHITE PARENTHESIS
        0xFF60, //              [F] Pe         FULLWIDTH RIGHT WHITE PARENTHESIS
        0xFFE0...0xFFE1, //     [F] Sc     [2] FULLWIDTH CENT SIGN..FULLWIDTH POUND SIGN
        0xFFE2, //              [F] Sm         FULLWIDTH NOT SIGN
        0xFFE3, //              [F] Sk         FULLWIDTH MACRON
        0xFFE4, //              [F] So         FULLWIDTH BROKEN BAR
        0xFFE5...0xFFE6, //     [F] Sc     [2] FULLWIDTH YEN SIGN..FULLWIDTH WON SIGN
        0x16FE0...0x16FE1, //   [W] Lm     [2] TANGUT ITERATION MARK..NUSHU ITERATION MARK
        0x16FE2, //             [W] Po         OLD CHINESE HOOK MARK
        0x16FE3, //             [W] Lm         OLD CHINESE ITERATION MARK
        0x16FE4, //             [W] Mn         KHITAN SMALL SCRIPT FILLER
        0x16FF0...0x16FF1, //   [W] Mc     [2] VIETNAMESE ALTERNATE READING MARK CA..VIETNAMESE ALTERNATE READING MARK NHAY
        0x17000...0x187F7, //   [W] Lo  [6136] TANGUT IDEOGRAPH-17000..TANGUT IDEOGRAPH-187F7
        0x18800...0x18AFF, //   [W] Lo   [768] TANGUT COMPONENT-001..TANGUT COMPONENT-768
        0x18B00...0x18CD5, //   [W] Lo   [470] KHITAN SMALL SCRIPT CHARACTER-18B00..KHITAN SMALL SCRIPT CHARACTER-18CD5
        0x18D00...0x18D08, //   [W] Lo     [9] TANGUT IDEOGRAPH-18D00..TANGUT IDEOGRAPH-18D08
        0x1AFF0...0x1AFF3, //   [W] Lm     [4] KATAKANA LETTER MINNAN TONE-2..KATAKANA LETTER MINNAN TONE-5
        0x1AFF5...0x1AFFB, //   [W] Lm     [7] KATAKANA LETTER MINNAN TONE-7..KATAKANA LETTER MINNAN NASALIZED TONE-5
        0x1AFFD...0x1AFFE, //   [W] Lm     [2] KATAKANA LETTER MINNAN NASALIZED TONE-7..KATAKANA LETTER MINNAN NASALIZED TONE-8
        0x1B000...0x1B0FF, //   [W] Lo   [256] KATAKANA LETTER ARCHAIC E..HENTAIGANA LETTER RE-2
        0x1B100...0x1B122, //   [W] Lo    [35] HENTAIGANA LETTER RE-3..KATAKANA LETTER ARCHAIC WU
        0x1B132, //             [W] Lo         HIRAGANA LETTER SMALL KO
        0x1B150...0x1B152, //   [W] Lo     [3] HIRAGANA LETTER SMALL WI..HIRAGANA LETTER SMALL WO
        0x1B155, //             [W] Lo         KATAKANA LETTER SMALL KO
        0x1B164...0x1B167, //   [W] Lo     [4] KATAKANA LETTER SMALL WI..KATAKANA LETTER SMALL N
        0x1B170...0x1B2FB, //   [W] Lo   [396] NUSHU CHARACTER-1B170..NUSHU CHARACTER-1B2FB
        0x1F004, //             [W] So         MAHJONG TILE RED DRAGON
        0x1F0CF, //             [W] So         PLAYING CARD BLACK JOKER
        0x1F18E, //             [W] So         NEGATIVE SQUARED AB
        0x1F191...0x1F19A, //   [W] So    [10] SQUARED CL..SQUARED VS
        0x1F200...0x1F202, //   [W] So     [3] SQUARE HIRAGANA HOKA..SQUARED KATAKANA SA
        0x1F210...0x1F23B, //   [W] So    [44] SQUARED CJK UNIFIED IDEOGRAPH-624B..SQUARED CJK UNIFIED IDEOGRAPH-914D
        0x1F240...0x1F248, //   [W] So     [9] TORTOISE SHELL BRACKETED CJK UNIFIED IDEOGRAPH-672C..TORTOISE SHELL BRACKETED CJK UNIFIED IDEOGRAPH-6557
        0x1F250...0x1F251, //   [W] So     [2] CIRCLED IDEOGRAPH ADVANTAGE..CIRCLED IDEOGRAPH ACCEPT
        0x1F260...0x1F265, //   [W] So     [6] ROUNDED SYMBOL FOR FU..ROUNDED SYMBOL FOR CAI
        0x1F300...0x1F320, //   [W] So    [33] CYCLONE..SHOOTING STAR
        0x1F32D...0x1F335, //   [W] So     [9] HOT DOG..CACTUS
        0x1F337...0x1F37C, //   [W] So    [70] TULIP..BABY BOTTLE
        0x1F37E...0x1F393, //   [W] So    [22] BOTTLE WITH POPPING CORK..GRADUATION CAP
        0x1F3A0...0x1F3CA, //   [W] So    [43] CAROUSEL HORSE..SWIMMER
        0x1F3CF...0x1F3D3, //   [W] So     [5] CRICKET BAT AND BALL..TABLE TENNIS PADDLE AND BALL
        0x1F3E0...0x1F3F0, //   [W] So    [17] HOUSE BUILDING..EUROPEAN CASTLE
        0x1F3F4, //             [W] So         WAVING BLACK FLAG
        0x1F3F8...0x1F3FA, //   [W] So     [3] BADMINTON RACQUET AND SHUTTLECOCK..AMPHORA
        0x1F3FB...0x1F3FF, //   [W] Sk     [5] EMOJI MODIFIER FITZPATRICK TYPE-1-2..EMOJI MODIFIER FITZPATRICK TYPE-6
        0x1F400...0x1F43E, //   [W] So    [63] RAT..PAW PRINTS
        0x1F440, //             [W] So         EYES
        0x1F442...0x1F4FC, //   [W] So   [187] EAR..VIDEOCASSETTE
        0x1F4FF...0x1F53D, //   [W] So    [63] PRAYER BEADS..DOWN-POINTING SMALL RED TRIANGLE
        0x1F54B...0x1F54E, //   [W] So     [4] KAABA..MENORAH WITH NINE BRANCHES
        0x1F550...0x1F567, //   [W] So    [24] CLOCK FACE ONE OCLOCK..CLOCK FACE TWELVE-THIRTY
        0x1F57A, //             [W] So         MAN DANCING
        0x1F595...0x1F596, //   [W] So     [2] REVERSED HAND WITH MIDDLE FINGER EXTENDED..RAISED HAND WITH PART BETWEEN MIDDLE AND RING FINGERS
        0x1F5A4, //             [W] So         BLACK HEART
        0x1F5FB...0x1F5FF, //   [W] So     [5] MOUNT FUJI..MOYAI
        0x1F600...0x1F64F, //   [W] So    [80] GRINNING FACE..PERSON WITH FOLDED HANDS
        0x1F680...0x1F6C5, //   [W] So    [70] ROCKET..LEFT LUGGAGE
        0x1F6CC, //             [W] So         SLEEPING ACCOMMODATION
        0x1F6D0...0x1F6D2, //   [W] So     [3] PLACE OF WORSHIP..SHOPPING TROLLEY
        0x1F6D5...0x1F6D7, //   [W] So     [3] HINDU TEMPLE..ELEVATOR
        0x1F6DC...0x1F6DF, //   [W] So     [4] WIRELESS..RING BUOY
        0x1F6EB...0x1F6EC, //   [W] So     [2] AIRPLANE DEPARTURE..AIRPLANE ARRIVING
        0x1F6F4...0x1F6FC, //   [W] So     [9] SCOOTER..ROLLER SKATE
        0x1F7E0...0x1F7EB, //   [W] So    [12] LARGE ORANGE CIRCLE..LARGE BROWN SQUARE
        0x1F7F0, //             [W] So         HEAVY EQUALS SIGN
        0x1F90C...0x1F93A, //   [W] So    [47] PINCHED FINGERS..FENCER
        0x1F93C...0x1F945, //   [W] So    [10] WRESTLERS..GOAL NET
        0x1F947...0x1F9FF, //   [W] So   [185] FIRST PLACE MEDAL..NAZAR AMULET
        0x1FA70...0x1FA7C, //   [W] So    [13] BALLET SHOES..CRUTCH
        0x1FA80...0x1FA88, //   [W] So     [9] YO-YO..FLUTE
        0x1FA90...0x1FABD, //   [W] So    [46] RINGED PLANET..WING
        0x1FABF...0x1FAC5, //   [W] So     [7] GOOSE..PERSON WITH CROWN
        0x1FACE...0x1FADB, //   [W] So    [14] MOOSE..PEA POD
        0x1FAE0...0x1FAE8, //   [W] So     [9] MELTING FACE..SHAKING FACE
        0x1FAF0...0x1FAF8, //   [W] So     [9] HAND WITH INDEX FINGER AND THUMB CROSSED..RIGHTWARDS PUSHING HAND
        0x20000...0x2A6DF, //   [W] Lo [42720] CJK UNIFIED IDEOGRAPH-20000..CJK UNIFIED IDEOGRAPH-2A6DF
        0x2A6E0...0x2A6FF, //   [W] Cn    [32] <reserved-2A6E0>..<reserved-2A6FF>
        0x2A700...0x2B739, //   [W] Lo  [4154] CJK UNIFIED IDEOGRAPH-2A700..CJK UNIFIED IDEOGRAPH-2B739
        0x2B73A...0x2B73F, //   [W] Cn     [6] <reserved-2B73A>..<reserved-2B73F>
        0x2B740...0x2B81D, //   [W] Lo   [222] CJK UNIFIED IDEOGRAPH-2B740..CJK UNIFIED IDEOGRAPH-2B81D
        0x2B81E...0x2B81F, //   [W] Cn     [2] <reserved-2B81E>..<reserved-2B81F>
        0x2B820...0x2CEA1, //   [W] Lo  [5762] CJK UNIFIED IDEOGRAPH-2B820..CJK UNIFIED IDEOGRAPH-2CEA1
        0x2CEA2...0x2CEAF, //   [W] Cn    [14] <reserved-2CEA2>..<reserved-2CEAF>
        0x2CEB0...0x2EBE0, //   [W] Lo  [7473] CJK UNIFIED IDEOGRAPH-2CEB0..CJK UNIFIED IDEOGRAPH-2EBE0
        0x2EBE1...0x2EBEF, //   [W] Cn    [15] <reserved-2EBE1>..<reserved-2EBEF>
        0x2EBF0...0x2EE5D, //   [W] Lo   [622] CJK UNIFIED IDEOGRAPH-2EBF0..CJK UNIFIED IDEOGRAPH-2EE5D
        0x2EE5E...0x2F7FF, //   [W] Cn  [2466] <reserved-2EE5E>..<reserved-2F7FF>
        0x2F800...0x2FA1D, //   [W] Lo   [542] CJK COMPATIBILITY IDEOGRAPH-2F800..CJK COMPATIBILITY IDEOGRAPH-2FA1D
        0x2FA1E...0x2FA1F, //   [W] Cn     [2] <reserved-2FA1E>..<reserved-2FA1F>
        0x2FA20...0x2FFFD, //   [W] Cn  [1502] <reserved-2FA20>..<reserved-2FFFD>
        0x30000...0x3134A, //   [W] Lo  [4939] CJK UNIFIED IDEOGRAPH-30000..CJK UNIFIED IDEOGRAPH-3134A
        0x3134B...0x3134F, //   [W] Cn     [5] <reserved-3134B>..<reserved-3134F>
        0x31350...0x323AF, //   [W] Lo  [4192] CJK UNIFIED IDEOGRAPH-31350..CJK UNIFIED IDEOGRAPH-323AF
        0x323B0...0x3FFFD, //   [W] Cn [56398] <reserved-323B0>..<reserved-3FFFD>
        => true,
        else => false,
    };
}

pub fn isAmgiguousCodepointType(comptime T: type, cp: T) bool {
    return switch (cp) {
        0xA1,
        0xA4,
        0xA7,
        0xA8,
        0xAA,
        0xAD,
        0xAE,
        0xB0...0xB4,
        0xB6...0xBA,
        0xBC...0xBF,
        0xC6,
        0xD0,
        0xD7,
        0xD8,
        0xDE...0xE1,
        0xE6,
        0xE8...0xEA,
        0xEC,
        0xED,
        0xF0,
        0xF2,
        0xF3,
        0xF7...0xFA,
        0xFC,
        0xFE,
        0x101,
        0x111,
        0x113,
        0x11B,
        0x126,
        0x127,
        0x12B,
        0x131...0x133,
        0x138,
        0x13F...0x142,
        0x144,
        0x148...0x14B,
        0x14D,
        0x152,
        0x153,
        0x166,
        0x167,
        0x16B,
        0x1CE,
        0x1D0,
        0x1D2,
        0x1D4,
        0x1D6,
        0x1D8,
        0x1DA,
        0x1DC,
        0x251,
        0x261,
        0x2C4,
        0x2C7,
        0x2C9...0x2CB,
        0x2CD,
        0x2D0,
        0x2D8...0x2DB,
        0x2DD,
        0x2DF,
        0x300...0x36F,
        0x391...0x3A1,
        0x3A3...0x3A9,
        0x3B1...0x3C1,
        0x3C3...0x3C9,
        0x401,
        0x410...0x44F,
        0x451,
        0x2010,
        0x2013...0x2016,
        0x2018,
        0x2019,
        0x201C,
        0x201D,
        0x2020...0x2022,
        0x2024...0x2027,
        0x2030,
        0x2032,
        0x2033,
        0x2035,
        0x203B,
        0x203E,
        0x2074,
        0x207F,
        0x2081...0x2084,
        0x20AC,
        0x2103,
        0x2105,
        0x2109,
        0x2113,
        0x2116,
        0x2121,
        0x2122,
        0x2126,
        0x212B,
        0x2153,
        0x2154,
        0x215B...0x215E,
        0x2160...0x216B,
        0x2170...0x2179,
        0x2189,
        0x2190...0x2199,
        0x21B8,
        0x21B9,
        0x21D2,
        0x21D4,
        0x21E7,
        0x2200,
        0x2202,
        0x2203,
        0x2207,
        0x2208,
        0x220B,
        0x220F,
        0x2211,
        0x2215,
        0x221A,
        0x221D...0x2220,
        0x2223,
        0x2225,
        0x2227...0x222C,
        0x222E,
        0x2234...0x2237,
        0x223C,
        0x223D,
        0x2248,
        0x224C,
        0x2252,
        0x2260,
        0x2261,
        0x2264...0x2267,
        0x226A,
        0x226B,
        0x226E,
        0x226F,
        0x2282,
        0x2283,
        0x2286,
        0x2287,
        0x2295,
        0x2299,
        0x22A5,
        0x22BF,
        0x2312,
        0x2460...0x24E9,
        0x24EB...0x254B,
        0x2550...0x2573,
        0x2580...0x258F,
        0x2592...0x2595,
        0x25A0,
        0x25A1,
        0x25A3...0x25A9,
        0x25B2,
        0x25B3,
        0x25B6,
        0x25B7,
        0x25BC,
        0x25BD,
        0x25C0,
        0x25C1,
        0x25C6...0x25C8,
        0x25CB,
        0x25CE...0x25D1,
        0x25E2...0x25E5,
        0x25EF,
        0x2605,
        0x2606,
        0x2609,
        0x260E,
        0x260F,
        0x261C,
        0x261E,
        0x2640,
        0x2642,
        0x2660,
        0x2661,
        0x2663...0x2665,
        0x2667...0x266A,
        0x266C,
        0x266D,
        0x266F,
        0x269E,
        0x269F,
        0x26BF,
        0x26C6...0x26CD,
        0x26CF...0x26D3,
        0x26D5...0x26E1,
        0x26E3,
        0x26E8,
        0x26E9,
        0x26EB...0x26F1,
        0x26F4,
        0x26F6...0x26F9,
        0x26FB,
        0x26FC,
        0x26FE,
        0x26FF,
        0x273D,
        0x2776...0x277F,
        0x2B56...0x2B59,
        0x3248...0x324F,
        0xE000...0xF8FF,
        0xFE00...0xFE0F,
        0xFFFD,
        0x1F100...0x1F10A,
        0x1F110...0x1F12D,
        0x1F130...0x1F169,
        0x1F170...0x1F18D,
        0x1F18F,
        0x1F190,
        0x1F19B...0x1F1AC,
        0xE0100...0xE01EF,
        0xF0000...0xFFFFD,
        0x100000...0x10FFFD,
        => true,
        else => false,
    };
}

pub fn visibleCodepointWidth(cp: u32, ambiguousAsWide: bool) u3 {
    return visibleCodepointWidthType(u32, cp, ambiguousAsWide);
}

pub fn visibleCodepointWidthMaybeEmoji(cp: u32, maybe_emoji: bool, ambiguousAsWide: bool) u3 {
    // UCHAR_EMOJI=57,
    if (maybe_emoji and icu_hasBinaryProperty(cp, 57)) {
        return 2;
    }
    return visibleCodepointWidth(cp, ambiguousAsWide);
}

pub fn visibleCodepointWidthType(comptime T: type, cp: T, ambiguousAsWide: bool) u3 {
    if (isZeroWidthCodepointType(T, cp)) {
        return 0;
    }

    if (isFullWidthCodepointType(T, cp)) {
        return 2;
    }
    if (ambiguousAsWide and isAmgiguousCodepointType(T, cp)) {
        return 2;
    }

    return 1;
}

pub const visible = struct {
    // Ref: https://cs.stanford.edu/people/miles/iso8859.html
    fn visibleLatin1Width(input_: []const u8) usize {
        var length: usize = 0;
        var input = input_;
        const input_end_ptr = input.ptr + input.len - (input.len % 16);
        var input_ptr = input.ptr;
        while (input_ptr != input_end_ptr) {
            const input_chunk: [16]u8 = input_ptr[0..16].*;
            const sums: @Vector(16, u8) = [16]u8{
                visibleLatin1WidthScalar(input_chunk[0]),
                visibleLatin1WidthScalar(input_chunk[1]),
                visibleLatin1WidthScalar(input_chunk[2]),
                visibleLatin1WidthScalar(input_chunk[3]),
                visibleLatin1WidthScalar(input_chunk[4]),
                visibleLatin1WidthScalar(input_chunk[5]),
                visibleLatin1WidthScalar(input_chunk[6]),
                visibleLatin1WidthScalar(input_chunk[7]),
                visibleLatin1WidthScalar(input_chunk[8]),
                visibleLatin1WidthScalar(input_chunk[9]),
                visibleLatin1WidthScalar(input_chunk[10]),
                visibleLatin1WidthScalar(input_chunk[11]),
                visibleLatin1WidthScalar(input_chunk[12]),
                visibleLatin1WidthScalar(input_chunk[13]),
                visibleLatin1WidthScalar(input_chunk[14]),
                visibleLatin1WidthScalar(input_chunk[15]),
            };
            length += @reduce(.Add, sums);
            input_ptr += 16;
        }
        input.len %= 16;
        input.ptr = input_ptr;

        for (input) |byte| length += visibleLatin1WidthScalar(byte);
        return length;
    }

    fn visibleLatin1WidthScalar(c: u8) u1 {
        return if ((c >= 127 and c <= 159) or c < 32) 0 else 1;
    }

    fn visibleLatin1WidthExcludeANSIColors(input_: anytype) usize {
        var length: usize = 0;
        var input = input_;

        const ElementType = std.meta.Child(@TypeOf(input_));
        const indexFn = if (comptime ElementType == u8) strings.indexOfCharUsize else strings.indexOfChar16Usize;

        while (indexFn(input, '\x1b')) |i| {
            length += visibleLatin1Width(input[0..i]);
            input = input[i..];

            if (input.len < 3) return length;

            if (input[1] == '[') {
                const end = indexFn(input[2..], 'm') orelse return length;
                input = input[end + 3 ..];
            } else {
                input = input[1..];
            }
        }

        length += visibleLatin1Width(input);

        return length;
    }

    fn visibleUTF8WidthFn(input: []const u8, comptime asciiFn: anytype) usize {
        var bytes = input;
        var len: usize = 0;
        while (bun.strings.firstNonASCII(bytes)) |i| {
            len += asciiFn(bytes[0..i]);
            const this_chunk = bytes[i..];
            const byte = this_chunk[0];

            const skip = bun.strings.wtf8ByteSequenceLengthWithInvalid(byte);
            const cp_bytes: [4]u8 = switch (@min(@as(usize, skip), this_chunk.len)) {
                inline 1, 2, 3, 4 => |cp_len| .{
                    byte,
                    if (comptime cp_len > 1) this_chunk[1] else 0,
                    if (comptime cp_len > 2) this_chunk[2] else 0,
                    if (comptime cp_len > 3) this_chunk[3] else 0,
                },
                else => unreachable,
            };

            const cp = decodeWTF8RuneTMultibyte(&cp_bytes, skip, u32, unicode_replacement);
            len += visibleCodepointWidth(cp, false);

            bytes = bytes[@min(i + skip, bytes.len)..];
        }

        len += asciiFn(bytes);

        return len;
    }

    fn visibleUTF16WidthFn(input_: []const u16, exclude_ansi_colors: bool, ambiguousAsWide: bool) usize {
        var input = input_;
        var len: usize = 0;
        var prev: ?u21 = 0;
        var break_state = grapheme.BreakState{};
        var break_start: u21 = 0;
        var saw_1b = false;
        var saw_bracket = false;
        var stretch_len: usize = 0;

        while (true) {
            {
                const idx = firstNonASCII16([]const u16, input) orelse input.len;
                for (0..idx) |j| {
                    const cp = input[j];
                    defer prev = cp;

                    if (saw_bracket) {
                        if (cp == 'm') {
                            saw_1b = false;
                            saw_bracket = false;
                            stretch_len = 0;
                            continue;
                        }
                        stretch_len += visibleCodepointWidth(cp, ambiguousAsWide);
                        continue;
                    }
                    if (saw_1b) {
                        if (cp == '[') {
                            saw_bracket = true;
                            stretch_len = 0;
                            continue;
                        }
                        len += visibleCodepointWidth(cp, ambiguousAsWide);
                        continue;
                    }
                    if (!exclude_ansi_colors or cp != 0x1b) {
                        if (prev) |prev_| {
                            const should_break = grapheme.graphemeBreak(prev_, cp, &break_state);
                            if (should_break) {
                                len += visibleCodepointWidthMaybeEmoji(break_start, cp == 0xFE0F, ambiguousAsWide);
                                break_start = cp;
                            } else {
                                //
                            }
                        } else {
                            len += visibleCodepointWidth(cp, ambiguousAsWide);
                            break_start = cp;
                        }
                        continue;
                    }
                    saw_1b = true;
                    continue;
                }
                len += stretch_len;
                input = input[idx..];
            }
            if (input.len == 0) break;
            const replacement = utf16CodepointWithFFFD([]const u16, input);
            defer input = input[replacement.len..];
            if (replacement.fail) continue;
            const cp: u21 = @intCast(replacement.code_point);
            defer prev = cp;

            if (prev) |prev_| {
                const should_break = grapheme.graphemeBreak(prev_, cp, &break_state);
                if (should_break) {
                    len += visibleCodepointWidthMaybeEmoji(break_start, cp == 0xFE0F, ambiguousAsWide);
                    break_start = cp;
                }
            } else {
                len += visibleCodepointWidth(cp, ambiguousAsWide);
                break_start = cp;
            }
        }
        if (break_start > 0) {
            len += visibleCodepointWidthMaybeEmoji(break_start, (prev orelse 0) == 0xFE0F, ambiguousAsWide);
        }
        return len;
    }

    fn visibleLatin1WidthFn(input: []const u8) usize {
        return visibleLatin1Width(input);
    }

    pub const width = struct {
        pub fn latin1(input: []const u8) usize {
            return visibleLatin1Width(input);
        }

        pub fn utf8(input: []const u8) usize {
            return visibleUTF8WidthFn(input, visibleLatin1Width);
        }

        pub fn utf16(input: []const u16, ambiguousAsWide: bool) usize {
            return visibleUTF16WidthFn(input, false, ambiguousAsWide);
        }

        pub const exclude_ansi_colors = struct {
            pub fn latin1(input: []const u8) usize {
                return visibleLatin1WidthExcludeANSIColors(input);
            }

            pub fn utf8(input: []const u8) usize {
                return visibleUTF8WidthFn(input, visibleLatin1WidthExcludeANSIColors);
            }

            pub fn utf16(input: []const u16, ambiguousAsWide: bool) usize {
                return visibleUTF16WidthFn(input, true, ambiguousAsWide);
            }
        };
    };
};

pub const QuoteEscapeFormat = struct {
    data: []const u8,

    pub fn format(self: QuoteEscapeFormat, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        var i: usize = 0;
        while (std.mem.indexOfAnyPos(u8, self.data, i, "\"\n\\")) |j| : (i = j + 1) {
            try writer.writeAll(self.data[i..j]);
            try writer.writeAll(switch (self.data[j]) {
                '"' => "\\\"",
                '\n' => "\\n",
                '\\' => "\\\\",
                else => unreachable,
            });
        }
        if (i == self.data.len) return;
        try writer.writeAll(self.data[i..]);
    }
};

/// Generic. Works on []const u8, []const u16, etc
pub inline fn indexOfScalar(input: anytype, scalar: std.meta.Child(@TypeOf(input))) ?usize {
    if (comptime std.meta.Child(@TypeOf(input)) == u8) {
        return strings.indexOfCharUsize(input, scalar);
    } else {
        return std.mem.indexOfScalar(std.meta.Child(@TypeOf(input)), input, scalar);
    }
}

/// Generic. Works on []const u8, []const u16, etc
pub fn containsScalar(input: anytype, item: std.meta.Child(@TypeOf(input))) bool {
    return indexOfScalar(input, item) != null;
}

pub fn withoutSuffixComptime(input: []const u8, comptime suffix: []const u8) []const u8 {
    if (hasSuffixComptime(input, suffix)) {
        return input[0 .. input.len - suffix.len];
    }
    return input;
}

pub fn withoutPrefixComptime(input: []const u8, comptime prefix: []const u8) []const u8 {
    if (hasPrefixComptime(input, prefix)) {
        return input[prefix.len..];
    }
    return input;
}

// extern "C" bool icu_hasBinaryProperty(UChar32 cp, unsigned int prop)
extern fn icu_hasBinaryProperty(c: u32, which: c_uint) bool;

const assert = bun.assert;
