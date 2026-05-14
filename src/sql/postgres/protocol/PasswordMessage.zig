const PasswordMessage = @This();

password: Data = .{ .empty = {} },

pub fn deinit(this: *PasswordMessage) void {
    this.password.deinit();
}

pub fn writeInternal(
    this: *const @This(),
    comptime Context: type,
    writer: NewWriter(Context),
) !void {
    const password = this.password.slice();
    const count: usize = @sizeOf((u32)) + password.len + 1;
    const header = [_]u8{
        'p',
    } ++ toBytes(Int32(count));
    try writer.write(&header);
    try writer.string(password);
}

pub const write = WriteWrap(@This(), writeInternal).write;

const std = @import("std");
const Data = @import("../../shared/Data.rust").Data;
const Int32 = @import("../types/int_types.rust").Int32;
const NewWriter = @import("./NewWriter.rust").NewWriter;
const WriteWrap = @import("./WriteWrap.rust").WriteWrap;
const toBytes = std.mem.toBytes;
