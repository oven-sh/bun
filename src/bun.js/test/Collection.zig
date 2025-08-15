//! for the collection phase of test execution where we discover all the test() calls

locked: bool = false, // set to true after collection phase ends
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
    this.root_scope.destroy(this.bunTest());
    for (this.describe_callback_queue.items) |*item| {
        item.deinit();
    }
    this.describe_callback_queue.deinit();
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

pub fn enqueueTestCallback(this: *Collection, globalThis: *jsc.JSGlobalObject, name: jsc.JSValue, callback: jsc.JSValue) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    bun.assert(!this.locked);
    group.log("enqueueTestCallback", .{});

    _ = name;

    const test_callback = bun.create(this.bunTest().gpa, describe2.ExecutionEntry, .{
        .parent = this.active_scope,
        .tag = .test_callback,
        .callback = .init(this.bunTest().gpa, callback.withAsyncContextIfNeeded(globalThis)),
    });
    try this.active_scope.entries.append(.{ .test_callback = test_callback });
}
pub fn enqueueHookCallback(this: *Collection, globalThis: *jsc.JSGlobalObject, comptime tag: @Type(.enum_literal), callback: jsc.JSValue) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    bun.assert(!this.locked);
    group.log("enqueueTestCallback", .{});

    const hook_callback = bun.create(this.bunTest().gpa, describe2.ExecutionEntry, .{
        .parent = this.active_scope,
        .tag = tag,
        .callback = .init(this.bunTest().gpa, callback.withAsyncContextIfNeeded(globalThis)),
    });
    try @field(this.active_scope, @tagName(tag)).append(hook_callback);
}

pub fn runOne(this: *Collection, globalThis: *jsc.JSGlobalObject) bun.JSError!describe2.RunOneResult {
    group.begin(@src());
    defer group.end();

    if (this.describe_callback_queue.items.len == 0) return .done;

    group.log("runOne -> call next", .{});
    var first = this.describe_callback_queue.orderedRemove(0);
    defer first.deinit();

    const name = first.name.get();
    const callback = first.callback.get();
    const active_scope = first.active_scope;

    const buntest = this.bunTest();

    const previous_scope = active_scope;
    const new_scope = bun.create(buntest.gpa, DescribeScope, .init(buntest.gpa, previous_scope));
    new_scope.name = .init(buntest.gpa, name);
    try previous_scope.entries.append(.{ .describe = new_scope });

    this.active_scope = new_scope;
    group.log("callDescribeCallback -> call", .{});

    bun.assert(this._previous_scope == null);
    this._previous_scope = previous_scope;
    return buntest.callTestCallback(globalThis, callback, .{ .done_parameter = false });
}
pub fn runOneCompleted(this: *Collection, _: *jsc.JSGlobalObject, result_is_error: bool, result_value: jsc.JSValue) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    if (result_is_error) {
        _ = result_value;
        group.log("TODO: print error", .{});
    }

    bun.assert(this._previous_scope != null);
    const prev_scope = this._previous_scope.?;
    this._previous_scope = null;
    this.active_scope = prev_scope;
}

const std = @import("std");

const describe2 = @import("./describe2.zig");
const BunTest = describe2.BunTest;
const Collection = describe2.Collection;
const DescribeScope = describe2.DescribeScope;
const group = describe2.group;

const bun = @import("bun");
const jsc = bun.jsc;
