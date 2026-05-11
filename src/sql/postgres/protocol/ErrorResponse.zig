const ErrorResponse = @This();

messages: std.ArrayListUnmanaged(FieldMessage) = .{},

pub fn format(formatter: ErrorResponse, writer: *std.Io.Writer) !void {
    for (formatter.messages.items) |message| {
        try writer.print("{f}\n", .{message});
    }
}

pub fn deinit(this: *ErrorResponse) void {
    for (this.messages.items) |*message| {
        message.deinit();
    }
    this.messages.deinit(bun.default_allocator);
}

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    var remaining_bytes = try reader.length();
    if (remaining_bytes < 4) return error.InvalidMessageLength;
    remaining_bytes -|= 4;

    if (remaining_bytes > 0) {
        this.* = .{
            .messages = try FieldMessage.decodeList(Container, reader),
        };
    }
}

pub const decode = DecoderWrap(ErrorResponse, decodeInternal).decode;

pub const toJS = @import("../../../sql_jsc/postgres/protocol/error_response_jsc.zig").toJS;

const bun = @import("bun");
const std = @import("std");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const FieldMessage = @import("./FieldMessage.zig").FieldMessage;
const NewReader = @import("./NewReader.zig").NewReader;
