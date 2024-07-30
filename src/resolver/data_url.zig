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

    pub fn decodeData(url: DataURL, allocator: std.mem.Allocator) ![]u8 {
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

        return allocator.dupe(u8, percent_decoded);
    }
};
