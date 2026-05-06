//! JSC bridge for `bun.logger`. Keeps `src/logger/` free of JSC types.

pub fn msgFromJS(allocator: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, file: []const u8, err: jsc.JSValue) bun.JSError!Msg {
    var zig_exception_holder: jsc.ZigException.Holder = jsc.ZigException.Holder.init();
    if (err.toError()) |value| {
        value.toZigException(globalObject, zig_exception_holder.zigException());
    } else {
        zig_exception_holder.zigException().message = try err.toBunString(globalObject);
    }

    return Msg{
        .data = .{
            .text = try zig_exception_holder.zigException().message.toOwnedSlice(allocator),
            .location = logger.Location{
                .file = file,
                .line = 0,
                .column = 0,
            },
        },
    };
}

pub fn msgToJS(this: Msg, globalObject: *jsc.JSGlobalObject, allocator: std.mem.Allocator) bun.OOM!jsc.JSValue {
    return switch (this.metadata) {
        .build => bun.api.BuildMessage.create(globalObject, allocator, this),
        .resolve => bun.api.ResolveMessage.create(globalObject, allocator, this, ""),
    };
}

pub fn levelFromJS(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) bun.JSError!?Log.Level {
    if (value == .zero or value.isUndefined()) {
        return null;
    }

    if (!value.isString()) {
        return globalThis.throwInvalidArguments("Expected logLevel to be a string", .{});
    }

    return Log.Level.Map.fromJS(globalThis, value);
}

pub fn logToJS(this: Log, global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, message: []const u8) bun.JSError!jsc.JSValue {
    const msgs: []const Msg = this.msgs.items;
    var errors_stack: [256]jsc.JSValue = undefined;

    const count = @as(u16, @intCast(@min(msgs.len, errors_stack.len)));
    switch (count) {
        0 => return .js_undefined,
        1 => {
            const msg = msgs[0];
            return switch (msg.metadata) {
                .build => bun.api.BuildMessage.create(global, allocator, msg),
                .resolve => bun.api.ResolveMessage.create(global, allocator, msg, ""),
            };
        },
        else => {
            for (msgs[0..count], 0..) |msg, i| {
                errors_stack[i] = switch (msg.metadata) {
                    .build => try bun.api.BuildMessage.create(global, allocator, msg),
                    .resolve => try bun.api.ResolveMessage.create(global, allocator, msg, ""),
                };
            }
            const out = jsc.ZigString.init(message);
            const agg = try global.createAggregateError(errors_stack[0..count], &out);
            return agg;
        },
    }
}

/// unlike toJS, this always produces an AggregateError object
pub fn logToJSAggregateError(this: Log, global: *jsc.JSGlobalObject, message: bun.String) bun.JSError!jsc.JSValue {
    return global.createAggregateErrorWithArray(message, try logToJSArray(this, global, bun.default_allocator));
}

pub fn logToJSArray(this: Log, global: *jsc.JSGlobalObject, allocator: std.mem.Allocator) bun.JSError!jsc.JSValue {
    const msgs: []const Msg = this.msgs.items;

    const arr = try jsc.JSValue.createEmptyArray(global, msgs.len);
    for (msgs, 0..) |msg, i| {
        try arr.putIndex(global, @as(u32, @intCast(i)), try msgToJS(msg, global, allocator));
    }

    return arr;
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;

const logger = bun.logger;
const Log = logger.Log;
const Msg = logger.Msg;
