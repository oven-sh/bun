//! CommandTag.toJSTag / toJSNumber.

pub fn toJSTag(this: CommandTag, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    return switch (this) {
        .INSERT => JSValue.jsNumber(1),
        .DELETE => JSValue.jsNumber(2),
        .UPDATE => JSValue.jsNumber(3),
        .MERGE => JSValue.jsNumber(4),
        .SELECT => JSValue.jsNumber(5),
        .MOVE => JSValue.jsNumber(6),
        .FETCH => JSValue.jsNumber(7),
        .COPY => JSValue.jsNumber(8),
        .other => |tag| bun.String.createUTF8ForJS(globalObject, tag),
    };
}

pub fn toJSNumber(this: CommandTag) JSValue {
    return switch (this) {
        .other => JSValue.jsNumber(0),
        inline else => |val| JSValue.jsNumber(val),
    };
}

const CommandTag = @import("../../sql/postgres/CommandTag.zig").CommandTag;

const bun = @import("bun");
const String = bun.String;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
