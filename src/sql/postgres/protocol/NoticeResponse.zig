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

pub fn toJS(this: NoticeResponse, globalObject: *jsc.JSGlobalObject) bun.JSError!JSValue {
    var b = bun.StringBuilder{};
    defer b.deinit(bun.default_allocator);

    for (this.messages.items) |msg| {
        b.cap += switch (msg) {
            inline else => |m| m.utf8ByteLength(),
        } + 1;
    }
    b.allocate(bun.default_allocator) catch {};

    for (this.messages.items) |msg| {
        var str = switch (msg) {
            inline else => |m| m.toUTF8(bun.default_allocator),
        };
        defer str.deinit();
        _ = b.append(str.slice());
        _ = b.append("\n");
    }

    return bun.String.createUTF8ForJS(globalObject, b.allocatedSlice()[0..b.len]);
}

const bun = @import("bun");
const std = @import("std");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const FieldMessage = @import("./FieldMessage.zig").FieldMessage;
const NewReader = @import("./NewReader.zig").NewReader;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
