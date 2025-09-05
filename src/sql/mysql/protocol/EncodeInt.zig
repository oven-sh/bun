// Length-encoded integer encoding/decoding
pub fn encodeLengthInt(value: u64) bun.BoundedArray(u8, 9) {
    var array: bun.BoundedArray(u8, 9) = .{};
    if (value < 0xfb) {
        array.len = 1;
        array.buffer[0] = @intCast(value);
    } else if (value < 0xffff) {
        array.len = 3;
        array.buffer[0] = 0xfc;
        array.buffer[1] = @intCast(value & 0xff);
        array.buffer[2] = @intCast((value >> 8) & 0xff);
    } else if (value < 0xffffff) {
        array.len = 4;
        array.buffer[0] = 0xfd;
        array.buffer[1] = @intCast(value & 0xff);
        array.buffer[2] = @intCast((value >> 8) & 0xff);
        array.buffer[3] = @intCast((value >> 16) & 0xff);
    } else {
        array.len = 9;
        array.buffer[0] = 0xfe;
        array.buffer[1] = @intCast(value & 0xff);
        array.buffer[2] = @intCast((value >> 8) & 0xff);
        array.buffer[3] = @intCast((value >> 16) & 0xff);
        array.buffer[4] = @intCast((value >> 24) & 0xff);
        array.buffer[5] = @intCast((value >> 32) & 0xff);
        array.buffer[6] = @intCast((value >> 40) & 0xff);
        array.buffer[7] = @intCast((value >> 48) & 0xff);
        array.buffer[8] = @intCast((value >> 56) & 0xff);
    }
    return array;
}

pub fn decodeLengthInt(bytes: []const u8) ?struct { value: u64, bytes_read: usize } {
    if (bytes.len == 0) return null;

    const first_byte = bytes[0];

    switch (first_byte) {
        0xfc => {
            if (bytes.len < 3) return null;
            return .{
                .value = @as(u64, bytes[1]) | (@as(u64, bytes[2]) << 8),
                .bytes_read = 3,
            };
        },
        0xfd => {
            if (bytes.len < 4) return null;
            return .{
                .value = @as(u64, bytes[1]) |
                    (@as(u64, bytes[2]) << 8) |
                    (@as(u64, bytes[3]) << 16),
                .bytes_read = 4,
            };
        },
        0xfe => {
            if (bytes.len < 9) return null;
            return .{
                .value = @as(u64, bytes[1]) |
                    (@as(u64, bytes[2]) << 8) |
                    (@as(u64, bytes[3]) << 16) |
                    (@as(u64, bytes[4]) << 24) |
                    (@as(u64, bytes[5]) << 32) |
                    (@as(u64, bytes[6]) << 40) |
                    (@as(u64, bytes[7]) << 48) |
                    (@as(u64, bytes[8]) << 56),
                .bytes_read = 9,
            };
        },
        else => return .{ .value = @byteSwap(first_byte), .bytes_read = 1 },
    }
}

const bun = @import("bun");
