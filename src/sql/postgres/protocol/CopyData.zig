const CopyData = @This();

data: Data = .{ .empty = {} },

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    const length = try reader.length();

    const data = try reader.read(@intCast(length -| 5));
    this.* = .{
        .data = data,
    };
}

pub const decode = DecoderWrap(CopyData, decodeInternal).decode;

pub fn writeInternal(
    this: *const @This(),
    comptime Context: type,
    writer: NewWriter(Context),
) !void {
    const data = this.data.slice();
    const count: u32 = @sizeOf((u32)) + data.len + 1;
    const header = [_]u8{
        'd',
    } ++ toBytes(Int32(count));
    try writer.write(&header);
    try writer.string(data);
}

pub const write = WriteWrap(@This(), writeInternal).write;

const std = @import("std");
const Data = @import("../../shared/Data.zig").Data;
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const Int32 = @import("../types/int_types.zig").Int32;
const NewReader = @import("./NewReader.zig").NewReader;
const NewWriter = @import("./NewWriter.zig").NewWriter;
const WriteWrap = @import("./WriteWrap.zig").WriteWrap;
const toBytes = std.mem.toBytes;
