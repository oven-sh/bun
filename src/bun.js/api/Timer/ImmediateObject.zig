const ImmediateObject = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const js = JSC.Codegen.JSImmediate;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

ref_count: RefCount,
event_loop_timer: EventLoopTimer = .{
    .next = .{},
    .tag = .ImmediateObject,
},
internals: TimerObjectInternals,

pub fn init(
    globalThis: *JSGlobalObject,
    id: i32,
    callback: JSValue,
    arguments: JSValue,
) JSValue {
    // internals are initialized by init()
    const immediate = bun.new(ImmediateObject, .{ .ref_count = .init(), .internals = undefined });
    const js_value = immediate.toJS(globalThis);
    defer js_value.ensureStillAlive();
    immediate.internals.init(
        js_value,
        globalThis,
        id,
        .setImmediate,
        0,
        callback,
        arguments,
    );

    if (globalThis.bunVM().isInspectorEnabled()) {
        Debugger.didScheduleAsyncCall(
            globalThis,
            .DOMTimer,
            ID.asyncID(.{ .id = id, .kind = .setImmediate }),
            true,
        );
    }

    return js_value;
}

fn deinit(this: *ImmediateObject) void {
    this.internals.deinit();
    bun.destroy(this);
}

pub fn constructor(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) !*ImmediateObject {
    _ = callFrame;
    return globalObject.throw("Immediate is not constructible", .{});
}

/// returns true if an exception was thrown
pub fn runImmediateTask(this: *ImmediateObject, vm: *VirtualMachine) bool {
    return this.internals.runImmediateTask(vm);
}

pub fn toPrimitive(this: *ImmediateObject, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    return this.internals.toPrimitive();
}

pub fn doRef(this: *ImmediateObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
    return this.internals.doRef(globalThis, callFrame.this());
}

pub fn doUnref(this: *ImmediateObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
    return this.internals.doUnref(globalThis, callFrame.this());
}

pub fn hasRef(this: *ImmediateObject, _: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    return this.internals.hasRef();
}

pub fn finalize(this: *ImmediateObject) void {
    this.internals.finalize();
}

pub fn getDestroyed(this: *ImmediateObject, globalThis: *JSGlobalObject) JSValue {
    _ = globalThis;
    return .jsBoolean(this.internals.getDestroyed());
}

pub fn dispose(this: *ImmediateObject, globalThis: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    this.internals.cancel(globalThis.bunVM());
    return .js_undefined;
}

const bun = @import("bun");
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const TimerObjectInternals = @import("../Timer.zig").TimerObjectInternals;
const Debugger = @import("../../Debugger.zig");
const ID = @import("../Timer.zig").ID;
const EventLoopTimer = @import("../Timer.zig").EventLoopTimer;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
