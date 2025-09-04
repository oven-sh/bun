const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;

globalThis: *jsc.JSGlobalObject,
keep_alive: bun.Async.KeepAlive,

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*@This() {
    _ = callframe;
    return bun.new(@This(), .{
        .globalThis = globalThis,
        .keep_alive = .{},
    });
}

pub fn finalize(this: *@This()) void {
    this.keep_alive.unref(this.globalThis.bunVM());
    bun.destroy(this);
}

pub fn jsRef(this: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    _ = callframe;
    this.keep_alive.ref(globalThis.bunVM());
    return .js_undefined;
}

pub fn jsUnref(this: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    _ = callframe;
    this.keep_alive.unref(globalThis.bunVM());
    return .js_undefined;
}
