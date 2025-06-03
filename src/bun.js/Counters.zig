spawnSync_blocking: i32 = 0,
spawn_memfd: i32 = 0,

pub fn mark(this: *Counters, comptime tag: Field) void {
    @field(this, @tagName(tag)) +|= 1;
}

pub fn toJS(this: *const Counters, globalObject: *JSC.JSGlobalObject) bun.JSError!JSC.JSValue {
    return (try JSC.JSObject.create(this.*, globalObject)).toJS();
}

pub fn createCountersObject(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return globalObject.bunVM().counters.toJS(globalObject);
}

const Counters = @This();
const Field = std.meta.FieldEnum(Counters);

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
