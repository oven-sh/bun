const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;

const std = @import("std");
const Allocator = std.mem.Allocator;

// https://github.com/Vexu/zuri/blob/master/src/zuri.zig#L61-L127
pub const PercentEncoding = struct {
    /// possible errors for decode and encode
    pub const EncodeError = error{
        InvalidCharacter,
        OutOfMemory,
    };

    /// returns true if c is a hexadecimal digit
    pub fn isHex(c: u8) bool {
        return switch (c) {
            '0'...'9', 'a'...'f', 'A'...'F' => true,
            else => false,
        };
    }

    /// returns true if str starts with a valid path character or a percent encoded octet
    pub fn isPchar(str: []const u8) bool {
        if (comptime Environment.allow_assert) bun.assert(str.len > 0);
        return switch (str[0]) {
            'a'...'z', 'A'...'Z', '0'...'9', '-', '.', '_', '~', '!', '$', '&', '\'', '(', ')', '*', '+', ',', ';', '=', ':', '@' => true,
            '%' => str.len >= 3 and isHex(str[1]) and isHex(str[2]),
            else => false,
        };
    }

    /// decode path if it is percent encoded, returns EncodeError if URL unsafe characters are present and not percent encoded
    pub fn decode(allocator: Allocator, path: []const u8) EncodeError!?[]u8 {
        return _decode(allocator, path, true);
    }

    /// Replaces percent encoded entities within `path` without throwing an error if other URL unsafe characters are present
    pub fn decodeUnstrict(allocator: Allocator, path: []const u8) EncodeError!?[]u8 {
        return _decode(allocator, path, false);
    }

    fn _decode(allocator: Allocator, path: []const u8, strict: bool) EncodeError!?[]u8 {
        var ret: ?[]u8 = null;
        errdefer if (ret) |some| allocator.free(some);
        var ret_index: usize = 0;
        var i: usize = 0;

        while (i < path.len) : (i += 1) {
            if (path[i] == '%' and path[i..].len >= 3 and isHex(path[i + 1]) and isHex(path[i + 2])) {
                if (ret == null) {
                    ret = try allocator.alloc(u8, path.len);
                    bun.copy(u8, ret.?, path[0..i]);
                    ret_index = i;
                }

                // charToDigit can't fail because the chars are validated earlier
                var new = (std.fmt.charToDigit(path[i + 1], 16) catch unreachable) << 4;
                new |= std.fmt.charToDigit(path[i + 2], 16) catch unreachable;
                ret.?[ret_index] = new;
                ret_index += 1;
                i += 2;
            } else if (path[i] != '/' and !isPchar(path[i..]) and strict) {
                return error.InvalidCharacter;
            } else if (ret != null) {
                ret.?[ret_index] = path[i];
                ret_index += 1;
            }
        }

        if (ret) |some| return some[0..ret_index];
        return null;
    }
};

pub const DataURL = struct {
    url: bun.String = bun.String.empty,
    mime_type: string,
    data: string,
    is_base64: bool = false,

    pub fn parse(url: string) !?DataURL {
        if (!strings.startsWith(url, "data:")) {
            return null;
        }

        return try parseWithoutCheck(url);
    }

    pub fn parseWithoutCheck(url: string) !DataURL {
        const comma = strings.indexOfChar(url, ',') orelse return error.InvalidDataURL;

        var parsed = DataURL{
            .mime_type = url["data:".len..comma],
            .data = url[comma + 1 .. url.len],
        };

        if (strings.endsWith(parsed.mime_type, ";base64")) {
            parsed.mime_type = parsed.mime_type[0..(parsed.mime_type.len - ";base64".len)];
            parsed.is_base64 = true;
        }

        return parsed;
    }

    pub fn decodeMimeType(d: DataURL) bun.http.MimeType {
        return bun.http.MimeType.init(d.mime_type, null, null);
    }

    /// Decodes the data from the data URL. Always returns an owned slice.
    pub fn decodeData(url: DataURL, allocator: Allocator) ![]u8 {
        const percent_decoded = PercentEncoding.decodeUnstrict(allocator, url.data) catch url.data orelse url.data;
        if (url.is_base64) {
            const len = bun.base64.decodeLen(percent_decoded);
            const buf = try allocator.alloc(u8, len);
            const result = bun.base64.decode(buf, percent_decoded);
            if (!result.isSuccessful() or result.count != len) {
                return error.Base64DecodeError;
            }
            return buf;
        }

        return try allocator.dupe(u8, percent_decoded);
    }

    /// Returns the shorter of either a base64-encoded or percent-escaped data URL
    pub fn encodeStringAsShortestDataURL(allocator: Allocator, mime_type: []const u8, text: []const u8) []u8 {
        // Calculate base64 version
        const base64_encode_len = bun.base64.encodeLen(text);
        const total_base64_encode_len = "data:".len + mime_type.len + ";base64,".len + base64_encode_len;

        use_base64: {
            var counter = CountingBuf{};
            const success = encodeStringAsPercentEscapedDataURL(&counter, mime_type, text) catch unreachable;
            if (!success) {
                break :use_base64;
            }

            if (counter.len > total_base64_encode_len) {
                break :use_base64;
            }

            var buf = std.ArrayList(u8).init(allocator);
            errdefer buf.deinit();
            const success2 = encodeStringAsPercentEscapedDataURL(&buf, mime_type, text) catch unreachable;
            if (!success2) {
                break :use_base64;
            }
            return buf.items;
        }

        const base64buf = allocator.alloc(u8, total_base64_encode_len) catch bun.outOfMemory();
        return std.fmt.bufPrint(base64buf, "data:{s};base64,{s}", .{ mime_type, text }) catch unreachable;
    }

    const CountingBuf = struct {
        len: usize = 0,

        pub fn appendSlice(self: *CountingBuf, slice: []const u8) Allocator.Error!void {
            self.len += slice.len;
        }

        pub fn append(self: *CountingBuf, _: u8) Allocator.Error!void {
            self.len += 1;
        }

        pub fn toOwnedSlice(_: *CountingBuf) Allocator.Error![]u8 {
            return "";
        }
    };

    pub fn encodeStringAsPercentEscapedDataURL(buf: anytype, mime_type: []const u8, text: []const u8) !bool {
        const hex = "0123456789ABCDEF";

        try buf.appendSlice("data:");
        try buf.appendSlice(mime_type);
        try buf.append(',');

        // Scan for trailing characters that need to be escaped
        var trailing_start = text.len;
        while (trailing_start > 0) {
            const c = text[trailing_start - 1];
            if (c > 0x20 or c == '\t' or c == '\n' or c == '\r') {
                break;
            }
            trailing_start -= 1;
        }

        if (!bun.simdutf.validate.utf8(text)) {
            return false;
        }

        var i: usize = 0;
        var run_start: usize = 0;

        // TODO: vectorize this
        while (i < text.len) {
            const first_byte = text[i];

            // Check if we need to escape this character
            const needs_escape = first_byte == '\t' or
                first_byte == '\n' or
                first_byte == '\r' or
                first_byte == '#' or
                i >= trailing_start or
                (first_byte == '%' and i + 2 < text.len and
                    PercentEncoding.isHex(text[i + 1]) and
                    PercentEncoding.isHex(text[i + 2]));

            if (needs_escape) {
                if (run_start < i) {
                    try buf.appendSlice(text[run_start..i]);
                }
                try buf.append('%');
                try buf.append(hex[first_byte >> 4]);
                try buf.append(hex[first_byte & 15]);
                run_start = i + 1;
            }

            i += bun.strings.utf8ByteSequenceLength(first_byte);
        }

        if (run_start < text.len) {
            try buf.appendSlice(text[run_start..]);
        }

        return true;
    }
};
