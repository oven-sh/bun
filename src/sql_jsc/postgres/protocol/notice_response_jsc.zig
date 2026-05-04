pub fn toJS(this: NoticeResponse, globalObject: *jsc.JSGlobalObject) JSValue {
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

    return jsc.ZigString.init(b.allocatedSlice()[0..b.len]).toJS(globalObject);
}

const NoticeResponse = @import("../../../sql/postgres/protocol/NoticeResponse.zig");
const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
