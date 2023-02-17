const bun = @import("bun");
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
const assert = std.debug.assert;
const mem = std.mem;
const Allocator = mem.Allocator;
const ComptimeStringMap = @import("../comptime_string_map.zig").ComptimeStringMap;

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
        if (Environment.allow_assert) assert(str.len > 0);
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
};

pub const MimeType = enum {
    Unsupported,
    TextCSS,
    TextJavaScript,
    ApplicationJSON,

    pub const Map = ComptimeStringMap(MimeType, .{
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
};
