const NotificationResponse = @This();

pid: int4 = 0,
channel: bun.ByteList = .{},
payload: bun.ByteList = .{},

pub fn deinit(this: *@This()) void {
    this.channel.clearAndFree(bun.default_allocator);
    this.payload.clearAndFree(bun.default_allocator);
}

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    const length = try reader.length();
    bun.assert(length >= 4);

    this.* = .{
        .pid = try reader.int4(),
        .channel = (try reader.readZ()).toOwned(),
        .payload = (try reader.readZ()).toOwned(),
    };
}

pub const decode = DecoderWrap(NotificationResponse, decodeInternal).decode;

const bun = @import("bun");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const NewReader = @import("./NewReader.zig").NewReader;

const types = @import("../PostgresTypes.zig");
const int4 = types.int4;
