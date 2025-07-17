//! Variable-length quantity encoding, limited to i32 as per source map spec.
//! https://en.wikipedia.org/wiki/Variable-length_quantity
//! https://sourcemaps.info/spec.html
const VLQ = @This();

/// Encoding min and max ints are "//////D" and "+/////D", respectively.
/// These are 7 bytes long. This makes the `VLQ` struct 8 bytes.
bytes: [vlq_max_in_bytes]u8,
/// This is a u8 and not a u4 because non^2 integers are really slow in Zig.
len: u8 = 0,

pub inline fn slice(self: *const VLQ) []const u8 {
    return self.bytes[0..self.len];
}

pub fn writeTo(self: VLQ, writer: anytype) !void {
    try writer.writeAll(self.bytes[0..self.len]);
}

pub const zero = vlq_lookup_table[0];

const vlq_lookup_table: [256]VLQ = brk: {
    var entries: [256]VLQ = undefined;
    var i: usize = 0;
    var j: i32 = 0;
    while (i < 256) : (i += 1) {
        entries[i] = encodeSlowPath(j);
        j += 1;
    }
    break :brk entries;
};

const vlq_max_in_bytes = 7;

pub fn encode(value: i32) VLQ {
    return if (value >= 0 and value <= 255)
        vlq_lookup_table[@as(usize, @intCast(value))]
    else
        encodeSlowPath(value);
}

// A single base 64 digit can contain 6 bits of data. For the base 64 variable
// length quantities we use in the source map spec, the first bit is the sign,
// the next four bits are the actual value, and the 6th bit is the continuation
// bit. The continuation bit tells us whether there are more digits in this
// value following this digit.
//
//   Continuation
//   |    Sign
//   |    |
//   V    V
//   101011
//
fn encodeSlowPath(value: i32) VLQ {
    var len: u8 = 0;
    var bytes: [vlq_max_in_bytes]u8 = undefined;

    var vlq: u32 = if (value >= 0)
        @as(u32, @bitCast(value << 1))
    else
        @as(u32, @bitCast((-value << 1) | 1));

    // source mappings are limited to i32
    inline for (0..vlq_max_in_bytes) |_| {
        var digit = vlq & 31;
        vlq >>= 5;

        // If there are still more digits in this value, we must make sure the
        // continuation bit is marked
        if (vlq != 0) {
            digit |= 32;
        }

        bytes[len] = base64[digit];
        len += 1;

        if (vlq == 0) {
            return .{ .bytes = bytes, .len = len };
        }
    }

    return .{ .bytes = bytes, .len = 0 };
}

pub const VLQResult = struct {
    value: i32 = 0,
    start: usize = 0,
};

const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// base64 stores values up to 7 bits
const base64_lut: [std.math.maxInt(u7)]u8 = brk: {
    @setEvalBranchQuota(9999);
    var bytes = [_]u8{std.math.maxInt(u7)} ** std.math.maxInt(u7);

    for (base64, 0..) |c, i| {
        bytes[c] = i;
    }

    break :brk bytes;
};

pub fn decode(encoded: []const u8, start: usize) VLQResult {
    var shift: u8 = 0;
    var vlq: u32 = 0;

    // hint to the compiler what the maximum value is
    const encoded_ = encoded[start..][0..@min(encoded.len - start, comptime (vlq_max_in_bytes + 1))];

    // inlining helps for the 1 or 2 byte case, hurts a little for larger
    inline for (0..vlq_max_in_bytes + 1) |i| {
        const index = @as(u32, base64_lut[@as(u7, @truncate(encoded_[i]))]);

        // decode a byte
        vlq |= (index & 31) << @as(u5, @truncate(shift));
        shift += 5;

        // Stop if there's no continuation bit
        if ((index & 32) == 0) {
            return VLQResult{
                .start = start + comptime (i + 1),
                .value = if ((vlq & 1) == 0)
                    @as(i32, @intCast(vlq >> 1))
                else
                    -@as(i32, @intCast((vlq >> 1))),
            };
        }
    }

    return VLQResult{ .start = start + encoded_.len, .value = 0 };
}

pub fn decodeAssumeValid(encoded: []const u8, start: usize) VLQResult {
    var shift: u8 = 0;
    var vlq: u32 = 0;

    // hint to the compiler what the maximum value is
    const encoded_ = encoded[start..][0..@min(encoded.len - start, comptime (vlq_max_in_bytes + 1))];

    // inlining helps for the 1 or 2 byte case, hurts a little for larger
    inline for (0..vlq_max_in_bytes + 1) |i| {
        bun.assert(encoded_[i] < std.math.maxInt(u7)); // invalid base64 character
        const index = @as(u32, base64_lut[@as(u7, @truncate(encoded_[i]))]);
        bun.assert(index != std.math.maxInt(u7)); // invalid base64 character

        // decode a byte
        vlq |= (index & 31) << @as(u5, @truncate(shift));
        shift += 5;

        // Stop if there's no continuation bit
        if ((index & 32) == 0) {
            return VLQResult{
                .start = start + comptime (i + 1),
                .value = if ((vlq & 1) == 0)
                    @as(i32, @intCast(vlq >> 1))
                else
                    -@as(i32, @intCast((vlq >> 1))),
            };
        }
    }

    return .{ .start = start + encoded_.len, .value = 0 };
}

const std = @import("std");
const bun = @import("bun");
