usingnamespace @import("../global.zig");

const std = @import("std");
const assert = std.debug.assert;
const mem = std.mem;

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
        assert(str.len > 0);
        return switch (str[0]) {
            'a'...'z', 'A'...'Z', '0'...'9', '-', '.', '_', '~', '!', '$', '&', '\'', '(', ')', '*', '+', ',', ';', '=', ':', '@' => true,
            '%' => str.len > 3 and isHex(str[1]) and isHex(str[2]),
            else => false,
        };
    }

    /// decode path if it is percent encoded
    pub fn decode(allocator: Allocator, path: []const u8) EncodeError!?[]u8 {
        var ret: ?[]u8 = null;
        errdefer if (ret) |some| allocator.free(some);
        var ret_index: usize = 0;
        var i: usize = 0;

        while (i < path.len) : (i += 1) {
            if (path[i] == '%') {
                if (!isPchar(path[i..])) {
                    return error.InvalidCharacter;
                }
                if (ret == null) {
                    ret = try allocator.alloc(u8, path.len);
                    mem.copy(u8, ret.?, path[0..i]);
                    ret_index = i;
                }

                // charToDigit can't fail because the chars are validated earlier
                var new = (std.fmt.charToDigit(path[i + 1], 16) catch unreachable) << 4;
                new |= std.fmt.charToDigit(path[i + 2], 16) catch unreachable;
                ret.?[ret_index] = new;
                ret_index += 1;
                i += 2;
            } else if (path[i] != '/' and !isPchar(path[i..])) {
                return error.InvalidCharacter;
            } else if (ret != null) {
                ret.?[ret_index] = path[i];
                ret_index += 1;
            }
        }

        if (ret) |some| return allocator.shrink(some, ret_index);
        return null;
    }

    /// percent encode if path contains characters not allowed in paths
    pub fn encode(allocator: Allocator, path: []const u8) EncodeError!?[]u8 {
        var ret: ?[]u8 = null;
        var ret_index: usize = 0;
        for (path) |c, i| {
            if (c != '/' and !isPchar(path[i..])) {
                if (ret == null) {
                    ret = try allocator.alloc(u8, path.len * 3);
                    mem.copy(u8, ret.?, path[0..i]);
                    ret_index = i;
                }
                const hex_digits = "0123456789ABCDEF";
                ret.?[ret_index] = '%';
                ret.?[ret_index + 1] = hex_digits[(c & 0xF0) >> 4];
                ret.?[ret_index + 2] = hex_digits[c & 0x0F];
                ret_index += 3;
            } else if (ret != null) {
                ret.?[ret_index] = c;
                ret_index += 1;
            }
        }

        if (ret) |some| return allocator.shrink(some, ret_index);
        return null;
    }
};

pub const MimeType = enum {
    Unsupported,
    TextCSS,
    TextJavaScript,
    ApplicationJSON,

    pub const Map = std.ComptimeStringMap(MimeType, .{
        .{ "text/css", MimeType.TextCSS },
        .{ "text/javascript", MimeType.TextJavaScript },
        .{ "application/json", MimeType.ApplicationJSON },
    });

    pub fn decode(str: string) MimeType {
        // Remove things like ";charset=utf-8"
        var mime_type = str;
        if (strings.indexOfChar(mime_type, ';')) |semicolon| {
            mime_type = mime_type[0..semicolon];
        }

        return Map.get(mime_type) orelse MimeType.Unsupported;
    }
};

pub const DataURL = struct {
    mime_type: string,
    data: string,
    is_base64: bool = false,

    pub fn parse(url: string) ?DataURL {
        if (!strings.startsWith(url, "data:")) {
            return null;
        }

        const comma = strings.indexOfChar(url, ',') orelse return null;

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

    pub fn decode_mime_type(d: DataURL) MimeType {
        return MimeType.decode(d.mime_type);
    }

    pub fn decode_data(d: *DataURL, allocator: std.mem.Allocator, url: string) !string {
        // Try to read base64 data
        if (d.is_base64) {
            const size = try std.base64.standard.Decoder.calcSizeForSlice(d.data);
            var buf = try allocator.alloc(u8, size);
            try std.base64.standard.Decoder.decode(buf, d.data);
            return buf;
        }

        // Try to read percent-escaped data
        return try PercentEncoding.decode(allocator, url);
    }
};
