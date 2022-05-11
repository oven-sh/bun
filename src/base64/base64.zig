const std = @import("std");

extern fn bun_base64_encode(dest: [*]u8, src: [*]const u8, len: usize) usize;
extern fn bun_base64_decode(dest: [*]u8, src: [*]const u8, len: usize, out_len: *usize) usize;

pub const DecodeResult = struct {
    written: usize,
    fail: bool = false,
};

pub fn decode(destination: []u8, source: []const u8) DecodeResult {
    var out: usize = 0;
    const ret = bun_base64_decode(destination.ptr, source.ptr, source.len, &out);
    if (ret == std.math.maxInt(usize) - 1) {
        return .{
            .written = out,
            .fail = true,
        };
    }

    // std.debug.assert(out == ret);

    return .{
        .written = out,
        .fail = false,
    };
}

pub fn encode(destination: []u8, source: []const u8) usize {
    return bun_base64_encode(destination.ptr, source.ptr, source.len);
}

/// Given a source string of length len, this returns the amount of
/// memory the destination string should have.
///
/// remember, this is integer math
/// 3 bytes turn into 4 chars
/// ceiling[len / 3] * 4
///
///
pub fn decodeLen(source: anytype) usize {
    return (source.len / 4 * 3 + 2);
}

pub fn encodeLen(source: anytype) usize {
    return (source.len + 2) / 3 * 4;
}

pub const urlsafe = std.base64.Base64DecoderWithIgnore.init(
    std.base64.url_safe_alphabet_chars,
    null,
    "= \t\r\n" ++ [_]u8{ std.ascii.control_code.VT, std.ascii.control_code.FF },
);

pub const urlsafeEncoder = std.base64.url_safe_no_pad.Encoder;
