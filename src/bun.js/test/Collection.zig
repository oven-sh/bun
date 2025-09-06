//! for the collection phase of test execution where we discover all the test() calls

locked: bool = false, // set to true after collection phase ends
describe_callback_queue: std.ArrayList(QueuedDescribe), // TODO: don't use orderedRemove(0) on this, instead keep an index or use a fifo?
current_scope_callback_queue: std.ArrayList(QueuedDescribe),

root_scope: *DescribeScope,
active_scope: *DescribeScope,

filter_buffer: std.ArrayList(u8),

const QueuedDescribe = struct {
    callback: describe2.CallbackWithArgs,
    active_scope: *DescribeScope,
    new_scope: *DescribeScope,
    fn deinit(this: *QueuedDescribe, gpa: std.mem.Allocator) void {
        this.callback.deinit(gpa);
    }
};

pub fn init(gpa: std.mem.Allocator, bun_test_root: *describe2.BunTestRoot) Collection {
    group.begin(@src());
    defer group.end();

    const root_scope = DescribeScope.create(gpa, .{
        .parent = bun_test_root.hook_scope,
        .name = null,
        .concurrent = false,
        .mode = .normal,
        .only = .no,
        .has_callback = false,
        .test_id_for_debugger = 0,
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
        item.deinit(this.bunTest().gpa);
    }
    this.describe_callback_queue.deinit();
    for (this.current_scope_callback_queue.items) |*item| {
        item.deinit(this.bunTest().gpa);
    }
    this.current_scope_callback_queue.deinit();
    this.filter_buffer.deinit();
}

fn bunTest(this: *Collection) *BunTest {
    return @fieldParentPtr("collection", this);
}

pub fn enqueueDescribeCallback(this: *Collection, new_scope: *DescribeScope, callback: ?describe2.CallbackWithArgs) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    bun.assert(!this.locked);
    const buntest = this.bunTest();

    if (callback) |cb| {
        group.log("enqueueDescribeCallback / {s} / in scope: {s}", .{ new_scope.base.name orelse "(unnamed)", this.active_scope.base.name orelse "(unnamed)" });

        try this.current_scope_callback_queue.append(.{
            .active_scope = this.active_scope,
            .callback = cb.dupe(buntest.gpa),
            .new_scope = new_scope,
        });
    }
}

pub fn runOneCompleted(this: *Collection, globalThis: *jsc.JSGlobalObject, _: ?jsc.JSValue, data: describe2.BunTest.RefDataValue) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    const prev_scope: *DescribeScope = switch (data) {
        .collection => this.active_scope,
        else => {
            bun.assert(false); // this probably can't happen
            return;
        },
    };

    group.log("collection:runOneCompleted reset scope back from {s}", .{this.active_scope.base.name orelse "undefined"});
    this.active_scope = prev_scope;
    group.log("collection:runOneCompleted reset scope back to {s}", .{this.active_scope.base.name orelse "undefined"});
}

pub fn step(this: *Collection, globalThis: *jsc.JSGlobalObject, data: describe2.BunTest.RefDataValue) bun.JSError!describe2.StepResult {
    group.begin(@src());
    defer group.end();

    if (data != .start) try this.runOneCompleted(globalThis, null, data);

    const buntest = this.bunTest();

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    // append queued callbacks, in reverse order because items will be pop()ed from the end
    var i: usize = this.current_scope_callback_queue.items.len;
    while (i > 0) {
        i -= 1;
        const item = &this.current_scope_callback_queue.items[i];
        if (item.new_scope.failed) { // if there was an error in the describe callback, don't run any describe callbacks in this scope
            item.deinit(buntest.gpa);
        } else {
            bun.handleOom(this.describe_callback_queue.append(item.*));
        }
    }
    this.current_scope_callback_queue.clearRetainingCapacity();

    while (this.describe_callback_queue.items.len > 0) {
        group.log("runOne -> call next", .{});
        var first = this.describe_callback_queue.pop().?;
        defer first.deinit(buntest.gpa);

        if (first.active_scope.failed) continue; // do not execute callbacks that came from a failed describe scope

        const callback = first.callback;
        const active_scope = first.active_scope;
        const new_scope = first.new_scope;

        const previous_scope = active_scope;

        group.log("collection:runOne set scope from {s}", .{this.active_scope.base.name orelse "undefined"});
        this.active_scope = new_scope;
        group.log("collection:runOne set scope to {s}", .{this.active_scope.base.name orelse "undefined"});

        try buntest.runTestCallback(globalThis, .{ .callback = callback.dupe(buntest.gpa), .done_parameter = false, .data = .{
            .collection = .{
                .active_scope = previous_scope,
            },
        } });

        return .{ .waiting = .{} };
    }
    return .complete;
}

pub fn handleUncaughtException(this: *Collection, _: describe2.BunTest.RefDataValue) describe2.HandleUncaughtExceptionResult {
    group.begin(@src());
    defer group.end();

    this.active_scope.failed = true;

    return .show_unhandled_error_in_describe; // unhandled because it needs to exit with code 1
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;

const describe2 = jsc.Jest.describe2;
const BunTest = describe2.BunTest;
const Collection = describe2.Collection;
const DescribeScope = describe2.DescribeScope;
const group = describe2.debug.group;
