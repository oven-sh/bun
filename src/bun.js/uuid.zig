//https://github.com/dmgk/zig-uuid
const std = @import("std");
const fmt = std.fmt;
const bun = @import("bun");

pub const Error = error{InvalidUUID};
const UUID = @This();

bytes: [16]u8,

pub fn init() UUID {
    var uuid = UUID{ .bytes = undefined };

    bun.csprng(&uuid.bytes);
    // Version 4
    uuid.bytes[6] = (uuid.bytes[6] & 0x0f) | 0x40;
    // Variant 1
    uuid.bytes[8] = (uuid.bytes[8] & 0x3f) | 0x80;

    return uuid;
}

pub fn initWith(bytes: *const [16]u8) UUID {
    var uuid = UUID{ .bytes = bytes.* };

    uuid.bytes[6] = (uuid.bytes[6] & 0x0f) | 0x40;
    uuid.bytes[8] = (uuid.bytes[8] & 0x3f) | 0x80;

    return uuid;
}
pub const stringLength = 36;

// Indices in the UUID string representation for each byte.
const encoded_pos = [16]u8{ 0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34 };

// Hex to nibble mapping.
const hex_to_nibble = [256]u8{
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
};

pub fn format(
    self: UUID,
    comptime layout: []const u8,
    options: fmt.FormatOptions,
    writer: anytype,
) !void {
    _ = options; // currently unused

    if (comptime layout.len != 0 and layout[0] != 's')
        @compileError("Unsupported format specifier for UUID type: '" ++ layout ++ "'.");
    var buf: [36]u8 = undefined;
    self.print(&buf);

    try fmt.format(writer, "{s}", .{buf});
}

fn printBytes(
    bytes: *const [16]u8,
    buf: *[36]u8,
) void {
    const hex = "0123456789abcdef";

    buf[8] = '-';
    buf[13] = '-';
    buf[18] = '-';
    buf[23] = '-';
    inline for (encoded_pos, 0..) |i, j| {
        buf[comptime i + 0] = hex[bytes[j] >> 4];
        buf[comptime i + 1] = hex[bytes[j] & 0x0f];
    }
}
pub fn print(
    self: UUID,
    buf: *[36]u8,
) void {
    printBytes(&self.bytes, buf);
}

pub fn parse(buf: []const u8) Error!UUID {
    var uuid = UUID{ .bytes = undefined };

    if (buf.len != 36 or buf[8] != '-' or buf[13] != '-' or buf[18] != '-' or buf[23] != '-')
        return Error.InvalidUUID;

    inline for (encoded_pos, 0..) |i, j| {
        const hi = hex_to_nibble[buf[i + 0]];
        const lo = hex_to_nibble[buf[i + 1]];
        if (hi == 0xff or lo == 0xff) {
            return Error.InvalidUUID;
        }
        uuid.bytes[j] = hi << 4 | lo;
    }

    return uuid;
}

// Zero UUID
pub const zero: UUID = .{ .bytes = .{0} ** 16 };

// Convenience function to return a new v4 UUID.
pub fn newV4() UUID {
    return UUID.init();
}

/// # --- 48 ---   -- 4 --   - 12 -   -- 2 --   - 62 -
/// # unix_ts_ms | version | rand_a | variant | rand_b
pub const UUID7 = struct {
    bytes: [16]u8,

    var uuid_v7_lock = bun.Mutex{};
    var uuid_v7_last_timestamp: std.atomic.Value(u64) = .{ .raw = 0 };
    var uuid_v7_counter: std.atomic.Value(u32) = .{ .raw = 0 };

    fn getCount(timestamp: u64) u32 {
        uuid_v7_lock.lock();
        defer uuid_v7_lock.unlock();
        if (uuid_v7_last_timestamp.swap(timestamp, .monotonic) != timestamp) {
            uuid_v7_counter.store(0, .monotonic);
        }

        return uuid_v7_counter.fetchAdd(1, .monotonic) % 4096;
    }

    pub fn init(timestamp: u64, random: *[8]u8) UUID7 {
        const count = getCount(timestamp);

        var bytes: [16]u8 = undefined;

        // First 6 bytes: timestamp in big-endian
        bytes[0] = @truncate(timestamp >> 40);
        bytes[1] = @truncate(timestamp >> 32);
        bytes[2] = @truncate(timestamp >> 24);
        bytes[3] = @truncate(timestamp >> 16);
        bytes[4] = @truncate(timestamp >> 8);
        bytes[5] = @truncate(timestamp);

        // Byte 6: Version 7 in high nibble, top 4 bits of counter in low nibble
        bytes[6] = (@as(u8, 7) << 4) | @as(u8, @truncate((count >> 8) & 0x0F));

        // Byte 7: Lower 8 bits of counter
        bytes[7] = @truncate(count);

        // Byte 8: Variant in top 2 bits, 6 bits of random
        bytes[8] = 0x80 | (random[0] & 0x3F);

        // Remaining 7 bytes: random
        @memcpy(bytes[9..16], random[1..8]);

        return UUID7{
            .bytes = bytes,
        };
    }

    fn toBytes(self: UUID7) [16]u8 {
        return self.bytes;
    }

    pub fn print(self: UUID7, buf: *[36]u8) void {
        return printBytes(&self.toBytes(), buf);
    }

    pub fn toUUID(self: UUID7) UUID {
        const bytes: [16]u8 = self.toBytes();

        return .{ .bytes = bytes };
    }

    pub fn format(
        self: UUID7,
        comptime layout: []const u8,
        options: fmt.FormatOptions,
        writer: anytype,
    ) !void {
        return self.toUUID().format(layout, options, writer);
    }
};
