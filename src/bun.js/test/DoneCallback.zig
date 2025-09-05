/// value = not called yet. null = done already called, no-op.
ref: ?*describe2.BunTestFile.RefData,
called: bool = false,

const DoneCallbackTask = struct {
    ref: *describe2.BunTestFile.RefData,
    globalThis: *JSGlobalObject,

    pub fn call(this: *DoneCallbackTask) void {
        defer bun.destroy(this);
        defer this.ref.deref();
        const has_one_ref = this.ref.ref_count.hasOneRef();
        this.ref.buntest.bunTestDoneCallback(this.globalThis, this.ref.phase, has_one_ref) catch |e| {
            this.ref.buntest.onUncaughtException(this.globalThis, this.globalThis.takeError(e), false, this.ref.phase);
        };
    }
};

pub fn callAsFunction(globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    const this = DoneCallback.fromJS(callFrame.callee()) orelse return globalThis.throw("Expected callee to be DoneCallback", .{});

    const value = callFrame.argumentsAsArray(1)[0];

    if (!value.isEmptyOrUndefinedOrNull()) {
        globalThis.reportUncaughtExceptionFromError(globalThis.throwValue(value));
    }

    if (this.called) {
        // in Bun 1.2.20, this is a no-op
        // in Jest, this is "Expected done to be called once, but it was called multiple times."
        // Vitest does not support done callbacks
    }
    this.called = true;
    const ref = this.ref orelse return .js_undefined;
    defer this.ref = null;
    defer ref.deref();

    // dupe the ref and enqueue a task to call the done callback.
    // this makes it so if you do something else after calling done(), the next test doesn't start running until the next tick.
    const ref_clone = ref.dupe();
    errdefer ref_clone.deref();
    const done_callback_test = bun.new(DoneCallbackTask, .{ .ref = ref_clone, .globalThis = globalThis });
    errdefer bun.destroy(done_callback_test);
    const task = jsc.ManagedTask.New(DoneCallbackTask, DoneCallbackTask.call).init(done_callback_test);
    jsc.VirtualMachine.get().enqueueTask(task);

    return .js_undefined;
}

pub const js = jsc.Codegen.JSDoneCallback;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub fn finalize(
    this: *DoneCallback,
) callconv(.C) void {
    groupLog.begin(@src());
    defer groupLog.end();

    if (this.ref) |ref| ref.deref();
    VirtualMachine.get().allocator.destroy(this);
}

pub fn create(globalThis: *JSGlobalObject) JSValue {
    groupLog.begin(@src());
    defer groupLog.end();

    var done_callback = globalThis.bunVM().allocator.create(DoneCallback) catch bun.outOfMemory();
    done_callback.* = .{ .ref = null };

    const value = done_callback.toJS(globalThis);
    value.ensureStillAlive();
    return value;
}

const bun = @import("bun");

const jsc = bun.jsc;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const Strong = jsc.Strong.Safe;

const describe2 = jsc.Jest.describe2;
const BunTestFile = describe2.BunTestFile;
const DoneCallback = describe2.DoneCallback;
const groupLog = describe2.debug.group;
