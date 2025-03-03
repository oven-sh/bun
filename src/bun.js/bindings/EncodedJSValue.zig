const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSCell = @import("./JSCell.zig").JSCell;

pub const EncodedJSValue = extern union {
    asInt64: i64,
    ptr: ?*JSCell,
    asBits: [8]u8,
    asPtr: ?*anyopaque,
    asDouble: f64,
};
