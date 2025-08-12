//! for the collection phase of test execution where we discover all the test() calls

locked: bool = false, // set to true after collection phase ends
executing: bool = false,
describe_callback_queue: std.ArrayList(QueuedDescribe),

root_scope: *DescribeScope,
active_scope: *DescribeScope, // TODO: consider using async context rather than storing active_scope/_previous_scope
_previous_scope: ?*DescribeScope, // TODO: this only exists for 'result.then()'. we should change it so we pass {BunTest.ref(), active_scope} to the user data parameter of .then().

const QueuedDescribe = struct {
    active_scope: *DescribeScope,
    name: jsc.Strong,
    callback: jsc.Strong,
    fn deinit(this: *QueuedDescribe) void {
        this.name.deinit();
        this.callback.deinit();
    }
};

pub fn init(gpa: std.mem.Allocator) Collection {
    group.begin(@src());
    defer group.end();

    const root_scope = bun.create(gpa, DescribeScope, .init(gpa, null));

    return .{
        .describe_callback_queue = std.ArrayList(QueuedDescribe).init(gpa),
        .root_scope = root_scope,
        .active_scope = root_scope,
        ._previous_scope = null,
    };
}
pub fn deinit(this: *Collection) void {
    this.root_scope.deinit(this.bunTest());
    this.bunTest().gpa.destroy(this.root_scope);
    for (this.describe_callback_queue.items) |*item| {
        item.deinit();
    }
    this.describe_callback_queue.deinit();
}

fn drainedPromise(_: *Collection, globalThis: *jsc.JSGlobalObject) !jsc.JSValue {
    group.begin(@src());
    defer group.end();

    return jsc.JSPromise.resolvedPromiseValue(globalThis, .js_undefined); // TODO: return a promise that resolves when the describe queue is drained
}

fn bunTest(this: *Collection) *BunTest {
    group.begin(@src());
    defer group.end();

    return @fieldParentPtr("collection", this);
}

pub fn enqueueDescribeCallback(this: *Collection, globalThis: *jsc.JSGlobalObject, name: jsc.JSValue, callback: jsc.JSValue) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    bun.assert(!this.locked);
    group.log("executeOrEnqueueDescribeCallback -> enqueue", .{});
    try this.describe_callback_queue.append(.{
        .active_scope = this.active_scope,
        .name = .create(name, globalThis),
        .callback = .create(callback.withAsyncContextIfNeeded(globalThis), globalThis),
    });
}

pub fn run(this: *Collection, globalThis: *jsc.JSGlobalObject, previous_scope: *DescribeScope) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    while (!this.executing and this.describe_callback_queue.items.len > 0) {
        group.log("describeCallbackCompleted -> call next", .{});
        var first = this.describe_callback_queue.orderedRemove(0);
        defer first.deinit();
        _ = try this.callDescribeCallback(globalThis, first.name.get(), first.callback.get(), previous_scope);
    }
    group.log("describeCallbackCompleted -> done", .{});
}

pub fn callDescribeCallback(this: *Collection, globalThis: *jsc.JSGlobalObject, name: jsc.JSValue, callback: jsc.JSValue, active_scope: *DescribeScope) bun.JSError!jsc.JSValue {
    group.begin(@src());
    defer group.end();

    const buntest = this.bunTest();

    const previous_scope = active_scope;
    const new_scope = bun.create(buntest.gpa, DescribeScope, .init(buntest.gpa, previous_scope));
    new_scope.name = .create(name, globalThis);
    try previous_scope.entries.append(.{ .describe = new_scope });

    this.active_scope = new_scope;
    group.log("callDescribeCallback -> call", .{});
    this.executing = true;
    const result = try callback.call(globalThis, .js_undefined, &.{});

    if (result.asPromise()) |_| {
        group.log("callDescribeCallback -> got promise", .{});
        bun.assert(this._previous_scope == null);
        this._previous_scope = previous_scope;
        result.then(globalThis, buntest.ref(), describeCallbackThen, describeCallbackThen); // TODO: this function is odd. it requires manually exporting the describeCallbackThen as a toJSHostFn and also adding logic in c++
        return this.drainedPromise(globalThis);
    } else {
        this.executing = false;
        group.log("callDescribeCallback -> got value", .{});
        try this.describeCallbackCompleted(globalThis, previous_scope);
        return .js_undefined;
    }
}
export const Bun__TestScope__Describe2__describeCallbackThen = jsc.toJSHostFn(describeCallbackThen);
fn describeCallbackThen(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    group.begin(@src());
    defer group.end();

    var buntest: *BunTest = callframe.arguments_old(2).ptr[1].asPromisePtr(BunTest);
    defer buntest.unref();

    const this = &buntest.collection;
    this.executing = false;

    bun.assert(this._previous_scope != null);
    const prev_scope = this._previous_scope.?;
    this._previous_scope = null;
    try this.describeCallbackCompleted(globalThis, prev_scope);
    try this.run(globalThis, prev_scope);
    return .js_undefined;
}
pub fn describeCallbackCompleted(this: *Collection, _: *jsc.JSGlobalObject, previous_scope: *DescribeScope) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    this.active_scope = previous_scope;
}

const bun = @import("bun");
const jsc = bun.jsc;
const std = @import("std");
const describe2 = @import("describe2.zig");
const DescribeScope = describe2.DescribeScope;
const Collection = describe2.Collection;
const group = describe2.group;
const BunTest = describe2.BunTest;
