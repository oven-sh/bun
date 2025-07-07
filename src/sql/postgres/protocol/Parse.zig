const Parse = @This();
name: []const u8 = "",
query: []const u8 = "",
params: []const int4 = &.{},

pub fn deinit(this: *Parse) void {
    _ = this;
}

pub fn writeInternal(
    this: *const @This(),
    comptime Context: type,
    writer: NewWriter(Context),
) !void {
    const parameters = this.params;
    const count: usize = @sizeOf((u32)) + @sizeOf(u16) + (parameters.len * @sizeOf(u32)) + @max(zCount(this.name), 1) + @max(zCount(this.query), 1);
    const header = [_]u8{
        'P',
    } ++ toBytes(Int32(count));
    try writer.write(&header);
    try writer.string(this.name);
    try writer.string(this.query);
    try writer.short(parameters.len);
    for (parameters) |parameter| {
        try writer.int4(parameter);
    }
}

pub const write = WriteWrap(@This(), writeInternal).write;

// @sortImports

const types = @import("../PostgresTypes.zig");
const int4 = types.int4;
const NewWriter = @import("./NewWriter.zig").NewWriter;
const WriteWrap = @import("./WriteWrap.zig").WriteWrap;
const zHelpers = @import("./zHelpers.zig");
const zCount = zHelpers.zCount;
const toBytes = std.mem.toBytes;
const std = @import("std");
const Int32 = types.Int32;
