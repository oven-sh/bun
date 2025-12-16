/// value = not called yet. null = done already called, no-op.
ref: ?*bun_test.BunTest.RefData,
called: bool = false,

pub const js = jsc.Codegen.JSDoneCallback;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;

pub fn finalize(
    this: *DoneCallback,
) callconv(.c) void {
    groupLog.begin(@src());
    defer groupLog.end();

    if (this.ref) |ref| ref.deref();
    VirtualMachine.get().allocator.destroy(this);
}

pub fn createUnbound(globalThis: *JSGlobalObject) JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    var done_callback = bun.handleOom(globalThis.bunVM().allocator.create(DoneCallback));
    done_callback.* = .{ .ref = null };

    const value = done_callback.toJS(globalThis);
    value.ensureStillAlive();
    return value;
}

pub fn bind(value: JSValue, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    const callFn = jsc.JSFunction.create(globalThis, "done", BunTest.bunTestDoneCallback, 1, .{});
    return try callFn.bind(globalThis, value, &bun.String.static("done"), 1, &.{});
}

const bun = @import("bun");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;

const bun_test = jsc.Jest.bun_test;
const BunTest = bun_test.BunTest;
const DoneCallback = bun_test.DoneCallback;
const groupLog = bun_test.debug.group;
