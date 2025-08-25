//! for the collection phase of test execution where we discover all the test() calls

locked: bool = false, // set to true after collection phase ends
describe_callback_queue: std.ArrayList(QueuedDescribe), // TODO: don't use orderedRemove(0) on this, instead keep an index or use a fifo?

root_scope: *DescribeScope,
active_scope: *DescribeScope, // TODO: consider using async context rather than storing active_scope

const QueuedDescribe = struct {
    callback: Strong,
    args_owned: []Strong,
    active_scope: *DescribeScope,
    new_scope: *DescribeScope,
    fn deinit(this: *QueuedDescribe, gpa: std.mem.Allocator) void {
        this.callback.deinit();
        for (this.args_owned) |*arg| arg.deinit();
        gpa.free(this.args_owned);
    }
};

pub fn init(gpa: std.mem.Allocator) Collection {
    group.begin(@src());
    defer group.end();

    const root_scope = DescribeScope.create(gpa, .{
        .parent = null,
        .name = null,
        .concurrent = false,
        .mode = .normal,
        .only = .no,
        .filter = .no,
    });

    return .{
        .describe_callback_queue = std.ArrayList(QueuedDescribe).init(gpa),
        .root_scope = root_scope,
        .active_scope = root_scope,
    };
}
pub fn deinit(this: *Collection) void {
    this.root_scope.destroy(this.bunTest());
    for (this.describe_callback_queue.items) |*item| {
        item.deinit(this.bunTest().gpa);
    }
    this.describe_callback_queue.deinit();
}

fn bunTest(this: *Collection) *BunTestFile {
    return @fieldParentPtr("collection", this);
}

pub fn enqueueDescribeCallback(this: *Collection, callback: ?jsc.JSValue, args: []const Strong, name_not_owned: ?[]const u8, cfg: describe2.BaseScopeCfg) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    bun.assert(!this.locked);
    const buntest = this.bunTest();

    const new_scope = try this.active_scope.appendDescribe(buntest, name_not_owned, cfg);
    if (callback) |cb| {
        group.log("enqueueDescribeCallback / {s} / in scope: {s}", .{ name_not_owned orelse "undefined", this.active_scope.base.name orelse "undefined" });

        const args_dupe = buntest.gpa.dupe(Strong, args) catch bun.outOfMemory();
        errdefer buntest.gpa.free(args_dupe);
        for (args_dupe) |*arg| arg.* = arg.dupe(buntest.gpa);
        errdefer for (args_dupe) |*arg| arg.deinit();

        try this.describe_callback_queue.append(.{
            .active_scope = this.active_scope,
            .callback = .init(this.bunTest().gpa, cb),
            .args_owned = args_dupe,
            .new_scope = new_scope,
        });
    }
}

pub fn enqueueTestCallback(this: *Collection, name_not_owned: ?[]const u8, callback: jsc.JSValue, args: []const Strong, cfg: describe2.ExecutionEntryCfg, base: describe2.BaseScopeCfg) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    bun.assert(!this.locked);
    group.log("enqueueTestCallback / {s} / in scope: {s}", .{ name_not_owned orelse "undefined", this.active_scope.base.name orelse "undefined" });

    _ = try this.active_scope.appendTest(this.bunTest(), name_not_owned, callback, args, cfg, base);
}
pub fn enqueueHookCallback(this: *Collection, comptime tag: @Type(.enum_literal), callback: jsc.JSValue, args: []const Strong, cfg: describe2.ExecutionEntryCfg, base: describe2.BaseScopeCfg) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    bun.assert(!this.locked);
    group.log("enqueueHookCallback / in scope: {s}", .{this.active_scope.base.name orelse "undefined"});

    _ = try this.active_scope.appendHook(this.bunTest(), tag, callback, args, cfg, base);
}

pub fn runOne(this: *Collection, globalThis: *jsc.JSGlobalObject, callback_queue: *describe2.CallbackQueue) bun.JSError!describe2.RunOneResult {
    group.begin(@src());
    defer group.end();

    const buntest = this.bunTest();

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    if (this.describe_callback_queue.items.len == 0) return .done;

    group.log("runOne -> call next", .{});
    var first = this.describe_callback_queue.orderedRemove(0);
    defer first.deinit(buntest.gpa);

    const callback = first.callback.get();
    const active_scope = first.active_scope;
    const new_scope = first.new_scope;

    const previous_scope = active_scope;

    group.log("collection:runOne set scope from {s}", .{this.active_scope.base.name orelse "undefined"});
    this.active_scope = new_scope;
    group.log("collection:runOne set scope to {s}", .{this.active_scope.base.name orelse "undefined"});

    const args_dupe = buntest.gpa.dupe(Strong, first.args_owned) catch bun.outOfMemory();
    errdefer buntest.gpa.free(args_dupe);
    for (args_dupe) |*arg| arg.* = arg.dupe(buntest.gpa);
    errdefer for (args_dupe) |*arg| arg.deinit();

    try callback_queue.append(.{ .callback = .init(buntest.gpa, callback), .args_owned = args_dupe, .done_parameter = false, .data = @intFromPtr(previous_scope) });
    return .execute;
}
pub fn runOneCompleted(this: *Collection, globalThis: *jsc.JSGlobalObject, _: ?jsc.JSValue, data: u64) bun.JSError!void {
    group.begin(@src());
    defer group.end();

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    const prev_scope: *DescribeScope = @ptrFromInt(data);
    group.log("collection:runOneCompleted reset scope back from {s}", .{this.active_scope.base.name orelse "undefined"});
    this.active_scope = prev_scope;
    group.log("collection:runOneCompleted reset scope back to {s}", .{this.active_scope.base.name orelse "undefined"});
}

const std = @import("std");

const describe2 = @import("./describe2.zig");
const BunTestFile = describe2.BunTestFile;
const Collection = describe2.Collection;
const DescribeScope = describe2.DescribeScope;
const group = describe2.group;

const bun = @import("bun");
const jsc = bun.jsc;
const Strong = jsc.Strong.Safe;
