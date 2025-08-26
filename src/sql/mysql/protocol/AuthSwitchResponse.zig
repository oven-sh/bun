// Auth switch response packet
const AuthSwitchResponse = @This();
auth_response: Data = .{ .empty = {} },

pub fn deinit(this: *AuthSwitchResponse) void {
    this.auth_response.deinit();
}

pub fn writeInternal(this: *const AuthSwitchResponse, comptime Context: type, writer: NewWriter(Context)) !void {
    try writer.write(this.auth_response.slice());
}

pub const write = writeWrap(AuthSwitchResponse, writeInternal).write;

const Data = @import("../../shared/Data.zig").Data;

const NewWriter = @import("./NewWriter.zig").NewWriter;
const writeWrap = @import("./NewWriter.zig").writeWrap;
