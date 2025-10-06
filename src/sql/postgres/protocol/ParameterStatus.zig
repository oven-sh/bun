const ParameterStatus = @This();

name: Data = .{ .empty = {} },
value: Data = .{ .empty = {} },

pub fn deinit(this: *@This()) void {
    this.name.deinit();
    this.value.deinit();
}

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    const length = try reader.length();
    bun.assert(length >= 4);

    this.* = .{
        .name = try reader.readZ(),
        .value = try reader.readZ(),
    };
}

pub const decode = DecoderWrap(ParameterStatus, decodeInternal).decode;

const bun = @import("bun");
const Data = @import("../../shared/Data.zig").Data;
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const NewReader = @import("./NewReader.zig").NewReader;
