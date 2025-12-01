array: *std.array_list.Managed(u8),

pub fn offset(this: @This()) usize {
    return this.array.items.len;
}

pub fn write(this: @This(), bytes: []const u8) AnyPostgresError!void {
    try this.array.appendSlice(bytes);
}

pub fn pwrite(this: @This(), bytes: []const u8, i: usize) AnyPostgresError!void {
    @memcpy(this.array.items[i..][0..bytes.len], bytes);
}

pub const Writer = NewWriter(@This());

const std = @import("std");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const NewWriter = @import("./NewWriter.zig").NewWriter;
