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

pub fn init(gpa: std.mem.Allocator, bun_test_root: *describe2.BunTest) Collection {
    group.begin(@src());
    defer group.end();

    const root_scope = DescribeScope.create(gpa, .{
        .parent = bun_test_root.hook_scope,
        .name = null,
        .concurrent = false,
        .mode = .normal,
        .only = .no,
        .has_callback = false,
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

fn bunTest(this: *Collection) *BunTestFile {
    return @fieldParentPtr("collection", this);
}

pub fn enqueueDescribeCallback(this: *Collection, callback: ?describe2.CallbackWithArgs, name_not_owned: ?[]const u8, cfg: describe2.BaseScopeCfg) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    bun.assert(!this.locked);
    const buntest = this.bunTest();

    const new_scope = try this.active_scope.appendDescribe(buntest.gpa, name_not_owned, cfg);
    if (callback) |cb| {
        group.log("enqueueDescribeCallback / {s} / in scope: {s}", .{ name_not_owned orelse "undefined", this.active_scope.base.name orelse "undefined" });

        try this.current_scope_callback_queue.append(.{
            .active_scope = this.active_scope,
            .callback = cb.dupe(buntest.gpa),
            .new_scope = new_scope,
        });
    }
}

pub fn enqueueTestCallback(this: *Collection, name_not_owned: ?[]const u8, callback: ?describe2.CallbackWithArgs, cfg: describe2.ExecutionEntryCfg, base_in: describe2.BaseScopeCfg) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    var base = base_in;

    // check for filter match
    var matches_filter = true;
    if (this.bunTest().reporter) |reporter| if (reporter.jest.filter_regex) |filter_regex| {
        bun.assert(this.filter_buffer.items.len == 0);
        defer this.filter_buffer.clearRetainingCapacity();

        var parent: ?*DescribeScope = this.active_scope;
        while (parent) |scope| : (parent = scope.base.parent) {
            try this.filter_buffer.appendSlice(scope.base.name orelse "");
            try this.filter_buffer.append(' ');
        }
        try this.filter_buffer.appendSlice(name_not_owned orelse "");

        const str = bun.String.fromBytes(this.filter_buffer.items);
        matches_filter = filter_regex.matches(str);
    };

    if (!matches_filter) {
        base.self_mode = .filtered_out;
    }

    bun.assert(!this.locked);
    group.log("enqueueTestCallback / {s} / in scope: {s}", .{ name_not_owned orelse "undefined", this.active_scope.base.name orelse "undefined" });

    _ = try this.active_scope.appendTest(this.bunTest().gpa, name_not_owned, if (matches_filter) callback else null, cfg, base);
}
pub fn enqueueHookCallback(this: *Collection, comptime tag: @Type(.enum_literal), callback: ?jsc.JSValue, cfg: describe2.ExecutionEntryCfg, base: describe2.BaseScopeCfg) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    bun.assert(!this.locked);
    group.log("enqueueHookCallback / in scope: {s}", .{this.active_scope.base.name orelse "undefined"});

    _ = try this.active_scope.appendHook(this.bunTest().gpa, tag, callback, cfg, base);
}

pub fn runOne(this: *Collection, globalThis: *jsc.JSGlobalObject, callback_queue: *describe2.CallbackQueue) bun.JSError!describe2.RunOneResult {
    group.begin(@src());
    defer group.end();

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

        try callback_queue.append(.{ .callback = callback.dupe(buntest.gpa), .done_parameter = false, .data = .{
            .collection = .{
                .active_scope = previous_scope,
            },
        } });
        return .{ .execute = .{} };
    }
    return .done;
}
pub fn runOneCompleted(this: *Collection, globalThis: *jsc.JSGlobalObject, _: ?jsc.JSValue, data: describe2.BunTestFile.RefDataValue) bun.JSError!void {
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

pub fn handleUncaughtException(this: *Collection, _: describe2.BunTestFile.RefDataValue) describe2.HandleUncaughtExceptionResult {
    group.begin(@src());
    defer group.end();

    this.active_scope.failed = true;

    return .show_unhandled_error_in_describe; // unhandled because it needs to exit with code 1
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;

const describe2 = jsc.Jest.describe2;
const BunTestFile = describe2.BunTestFile;
const Collection = describe2.Collection;
const DescribeScope = describe2.DescribeScope;
const group = describe2.group;
