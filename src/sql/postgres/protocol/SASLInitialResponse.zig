const SASLInitialResponse = @This();
mechanism: Data = .{ .empty = {} },
data: Data = .{ .empty = {} },

pub fn deinit(this: *SASLInitialResponse) void {
    this.mechanism.deinit();
    this.data.deinit();
}

pub fn writeInternal(
    this: *const @This(),
    comptime Context: type,
    writer: NewWriter(Context),
) !void {
    const mechanism = this.mechanism.slice();
    const data = this.data.slice();
    const count: usize = @sizeOf(u32) + mechanism.len + 1 + data.len + @sizeOf(u32);
    const header = [_]u8{
        'p',
    } ++ toBytes(Int32(count));
    try writer.write(&header);
    try writer.string(mechanism);
    try writer.int4(@truncate(data.len));
    try writer.write(data);
}

pub const write = WriteWrap(@This(), writeInternal).write;

// @sortImports
const std = @import("std");
const NewWriter = @import("./NewWriter.zig").NewWriter;
const Data = @import("../Data.zig").Data;
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const WriteWrap = @import("./WriteWrap.zig").WriteWrap;
const toBytes = std.mem.toBytes;
const Int32 = @import("../types/int_types.zig").Int32;
