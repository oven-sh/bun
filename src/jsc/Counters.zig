const Counters = @This();

spawnSync_blocking: i32 = 0,
spawn_memfd: i32 = 0,

pub fn mark(this: *Counters, comptime tag: Field) void {
    @field(this, @tagName(tag)) +|= 1;
}

pub fn toJS(this: *const Counters, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    return (try jsc.JSObject.create(this.*, globalObject)).toJS();
}

pub fn createCountersObject(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return globalObject.bunVM().counters.toJS(globalObject);
}

const Field = std.meta.FieldEnum(Counters);

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
