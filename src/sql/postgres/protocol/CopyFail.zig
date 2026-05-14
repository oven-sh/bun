const CopyFail = @This();

message: Data = .{ .empty = {} },

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    _ = try reader.int4();

    const message = try reader.readZ();
    this.* = .{
        .message = message,
    };
}

pub const decode = DecoderWrap(CopyFail, decodeInternal).decode;

pub fn writeInternal(
    this: *@This(),
    comptime Context: type,
    writer: NewWriter(Context),
) !void {
    const message = this.message.slice();
    const count: u32 = @sizeOf((u32)) + message.len + 1;
    const header = [_]u8{
        'f',
    } ++ toBytes(Int32(count));
    try writer.write(&header);
    try writer.string(message);
}

pub const write = WriteWrap(@This(), writeInternal).write;

const std = @import("std");
const Data = @import("../../shared/Data.rust").Data;
const DecoderWrap = @import("./DecoderWrap.rust").DecoderWrap;
const NewReader = @import("./NewReader.rust").NewReader;
const NewWriter = @import("./NewWriter.rust").NewWriter;
const WriteWrap = @import("./WriteWrap.rust").WriteWrap;
const toBytes = std.mem.toBytes;

const int_types = @import("../types/int_types.rust");
const Int32 = int_types.Int32;
