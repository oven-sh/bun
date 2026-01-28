//! for the collection phase of test execution where we discover all the test() calls

locked: bool = false, // set to true after collection phase ends
describe_callback_queue: std.array_list.Managed(QueuedDescribe),
current_scope_callback_queue: std.array_list.Managed(QueuedDescribe),

root_scope: *DescribeScope,
active_scope: *DescribeScope,

filter_buffer: std.array_list.Managed(u8),

const QueuedDescribe = struct {
    callback: jsc.Strong.Deprecated,
    active_scope: *DescribeScope,
    new_scope: *DescribeScope,
    fn deinit(this: *QueuedDescribe) void {
        this.callback.deinit();
    }
};

pub fn init(gpa: std.mem.Allocator, bun_test_root: *bun_test.BunTestRoot) Collection {
    group.begin(@src());
    defer group.end();

    const root_scope = DescribeScope.create(gpa, .{
        .parent = bun_test_root.hook_scope,
        .name = null,
        .concurrent = false,
        .mode = .normal,
        .only = if (jsc.Jest.Jest.runner) |runner| if (runner.only) .contains else .no else .no,
        .has_callback = false,
        .test_id_for_debugger = 0,
        .line_no = 0,
    });

    return .{
        .describe_callback_queue = .init(gpa),
        .current_scope_callback_queue = .init(gpa),
        .root_scope = root_scope,
        .active_scope = root_scope,
        .filter_buffer = .init(gpa),
    };
}
pub fn deinit(this: *Collection) void {
    this.root_scope.destroy(this.bunTest().gpa);
    for (this.describe_callback_queue.items) |*item| {
        item.deinit();
    }
    this.describe_callback_queue.deinit();
    for (this.current_scope_callback_queue.items) |*item| {
        item.deinit();
    }
    this.current_scope_callback_queue.deinit();
    this.filter_buffer.deinit();
}

fn bunTest(this: *Collection) *BunTest {
    return @fieldParentPtr("collection", this);
}

pub fn enqueueDescribeCallback(this: *Collection, new_scope: *DescribeScope, callback: ?jsc.JSValue) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    bun.assert(!this.locked);
    const buntest = this.bunTest();

    if (callback) |cb| {
        group.log("enqueueDescribeCallback / {s} / in scope: {s}", .{ new_scope.base.name orelse "(unnamed)", this.active_scope.base.name orelse "(unnamed)" });

        try this.current_scope_callback_queue.append(.{
            .active_scope = this.active_scope,
            .callback = .init(buntest.gpa, cb),
            .new_scope = new_scope,
        });
    }
}

pub fn runOneCompleted(this: *Collection, globalThis: *jsc.JSGlobalObject, _: ?jsc.JSValue, data: bun_test.BunTest.RefDataValue) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    const prev_scope: *DescribeScope = switch (data) {
        .collection => |c| c.active_scope,
        else => blk: {
            bun.assert(false); // this probably can't happen
            break :blk this.active_scope;
        },
    };

    group.log("collection:runOneCompleted reset scope back from {s}", .{this.active_scope.base.name orelse "undefined"});
    this.active_scope = prev_scope;
    group.log("collection:runOneCompleted reset scope back to {s}", .{this.active_scope.base.name orelse "undefined"});
}

pub fn step(buntest_strong: bun_test.BunTestPtr, globalThis: *jsc.JSGlobalObject, data: bun_test.BunTest.RefDataValue) bun.JSError!bun_test.StepResult {
    group.begin(@src());
    defer group.end();
    const buntest = buntest_strong.get();
    const this = &buntest.collection;

    if (data != .start) try this.runOneCompleted(globalThis, null, data);

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    // append queued callbacks, in reverse order because items will be pop()ed from the end
    var i: usize = this.current_scope_callback_queue.items.len;
    while (i > 0) {
        i -= 1;
        const item = &this.current_scope_callback_queue.items[i];
        if (item.new_scope.failed) { // if there was an error in the describe callback, don't run any describe callbacks in this scope
            item.deinit();
        } else {
            bun.handleOom(this.describe_callback_queue.append(item.*));
        }
    }
    this.current_scope_callback_queue.clearRetainingCapacity();

    while (this.describe_callback_queue.items.len > 0) {
        group.log("runOne -> call next", .{});
        var first = this.describe_callback_queue.pop().?;
        defer first.deinit();

        if (first.active_scope.failed) continue; // do not execute callbacks that came from a failed describe scope

        const callback = first.callback;
        const active_scope = first.active_scope;
        const new_scope = first.new_scope;

        const previous_scope = active_scope;

        group.log("collection:runOne set scope from {s}", .{this.active_scope.base.name orelse "undefined"});
        this.active_scope = new_scope;
        group.log("collection:runOne set scope to {s}", .{this.active_scope.base.name orelse "undefined"});

        if (BunTest.runTestCallback(buntest_strong, globalThis, callback.get(), false, .{
            .collection = .{ .active_scope = previous_scope },
        }, &.epoch)) |cfg_data| {
            // the result is available immediately; queue
            buntest.addResult(cfg_data);
        }

        return .{ .waiting = .{} };
    }
    return .complete;
}

pub fn handleUncaughtException(this: *Collection, _: bun_test.BunTest.RefDataValue) bun_test.HandleUncaughtExceptionResult {
    group.begin(@src());
    defer group.end();

    this.active_scope.failed = true;

    return .show_unhandled_error_in_describe; // unhandled because it needs to exit with code 1
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;

const bun_test = jsc.Jest.bun_test;
const BunTest = bun_test.BunTest;
const Collection = bun_test.Collection;
const DescribeScope = bun_test.DescribeScope;
const group = bun_test.debug.group;
