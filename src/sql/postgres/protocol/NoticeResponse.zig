const NoticeResponse = @This();

messages: std.ArrayListUnmanaged(FieldMessage) = .{},
pub fn deinit(this: *NoticeResponse) void {
    for (this.messages.items) |*message| {
        message.deinit();
    }
    this.messages.deinit(bun.default_allocator);
}
pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    var remaining_bytes = try reader.length();
    remaining_bytes -|= 4;

    if (remaining_bytes > 0) {
        this.* = .{
            .messages = try FieldMessage.decodeList(Container, reader),
        };
    }
}
pub const decode = DecoderWrap(NoticeResponse, decodeInternal).decode;

pub const toJS = @import("../../../sql_jsc/postgres/protocol/notice_response_jsc.zig").toJS;

const bun = @import("bun");
const std = @import("std");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const FieldMessage = @import("./FieldMessage.zig").FieldMessage;
const NewReader = @import("./NewReader.zig").NewReader;
