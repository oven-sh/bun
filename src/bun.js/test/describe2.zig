pub const js_fns = struct {
    // error: expected type
    // 'fn (*bun.js.bindings.JSGlobalObject.JSGlobalObject, *bun.js.bindings.CallFrame.CallFrame) error{JSError,OutOfMemory}!bun.js.bindings.JSValue.JSValue', found
    // 'fn (*bun.js.test.describe2.BunTest, *bun.js.bindings.JSGlobalObject.JSGlobalObject, *bun.js.bindings.CallFrame.CallFrame) error{JSError,OutOfMemory}!bun.js.bindings.JSValue.JSValue
    pub fn describe(
        globalObject: *jsc.JSGlobalObject,
        callframe: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        const vm = globalObject.bunVM();
        if (vm.is_in_preload or bun.jsc.Jest.Jest.runner == null) {
            @panic("TODO return Bun__Jest__testPreloadObject(globalObject)");
        }
        const bunTest = &bun.jsc.Jest.Jest.runner.?.describe2;

        const name, const callback = callframe.argumentsAsArray(2);

        switch (bunTest.phase) {
            .scheduling => {
                return try bunTest.scheduling.executeOrEnqueueDescribeCallback(globalObject, name, callback);
            },
            .execution => {
                return globalObject.throw("Cannot call describe() inside a test", .{});
            },
        }
    }
};

/// this will be a JSValue (returned by `Bun.jest(...)`). there will be one per file. they will be gc objects and cleaned up when no longer used.
pub const BunTest = struct {
    allocation_scope: *bun.AllocationScope,
    gpa: std.mem.Allocator,

    phase: enum {
        scheduling,
        execution,
    },
    scheduling: Scheduling,
    execution: TestExecution,

    pub fn init(outer_gpa: std.mem.Allocator) BunTest {
        var allocation_scope = bun.create(outer_gpa, bun.AllocationScope, bun.AllocationScope.init(outer_gpa));
        const gpa = allocation_scope.allocator();
        return .{
            .allocation_scope = allocation_scope,
            .gpa = gpa,
            .phase = .scheduling,
            .scheduling = .init(gpa),
            .execution = .init(gpa),
        };
    }
    pub fn deinit(this: *BunTest) void {
        const backing = this.allocation_scope.parent;
        this.allocation_scope.deinit();
        backing.destroy(this.allocation_scope);
    }

    fn ref(this: *BunTest) *anyopaque {
        // TODO jsvalue(this).protect()
        return this;
    }
    fn unref(this: *BunTest) void {
        // TODO jsvalue(this).unprotect()
        _ = this;
    }
};

const QueuedDescribe = struct {
    active_scope: *DescribeScope,
    name: jsc.Strong,
    callback: jsc.Strong,
    fn deinit(this: *QueuedDescribe) void {
        this.name.deinit();
        this.callback.deinit();
    }
};
const Scheduling = struct {
    /// if 'describe()' returns a promise, set this to true
    should_enqueue_describes: bool = false,
    locked: bool = false, // set to true after scheduling phase ends
    describe_callback_queue: std.ArrayList(QueuedDescribe),

    root_scope: *DescribeScope,
    active_scope: *DescribeScope, // TODO: consider using async context rather than storing active_scope/_previous_scope
    _previous_scope: ?*DescribeScope, // TODO: this only exists for 'result.then()'. we should change it so we pass {BunTest.ref(), active_scope} to the user data parameter of .then().

    pub fn init(gpa: std.mem.Allocator) Scheduling {
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
    pub fn deinit(this: *Scheduling) void {
        this.root_scope.deinitTree();
        this.schedule.deinit();
    }

    fn drainedPromise(_: *Scheduling, globalThis: *jsc.JSGlobalObject) !jsc.JSValue {
        group.begin(@src());
        defer group.end();

        return jsc.JSPromise.resolvedPromiseValue(globalThis, .js_undefined); // TODO: return a promise that resolves when the describe queue is drained
    }

    fn bunTest(this: *Scheduling) *BunTest {
        group.begin(@src());
        defer group.end();

        return @fieldParentPtr("scheduling", this);
    }

    pub fn executeOrEnqueueDescribeCallback(this: *Scheduling, globalThis: *jsc.JSGlobalObject, name: jsc.JSValue, callback: jsc.JSValue) !jsc.JSValue {
        group.begin(@src());
        defer group.end();

        bun.assert(!this.locked);
        if (this.should_enqueue_describes) {
            group.log("executeOrEnqueueDescribeCallback -> enqueue", .{});
            try this.describe_callback_queue.append(.{
                .active_scope = this.active_scope,
                .name = .create(name, globalThis),
                .callback = .create(callback.withAsyncContextIfNeeded(globalThis), globalThis),
            });
            return this.drainedPromise(globalThis);
        } else {
            group.log("executeOrEnqueueDescribeCallback -> call", .{});
            return this.callDescribeCallback(globalThis, name, callback, this.active_scope);
        }
    }

    pub fn callDescribeCallback(this: *Scheduling, globalThis: *jsc.JSGlobalObject, name: jsc.JSValue, callback: jsc.JSValue, active_scope: *DescribeScope) bun.JSError!jsc.JSValue {
        group.begin(@src());
        defer group.end();

        const buntest = this.bunTest();

        const previous_scope = active_scope;
        const new_scope = bun.create(buntest.gpa, DescribeScope, .init(buntest.gpa, previous_scope));
        new_scope.name = .create(name, globalThis);
        try previous_scope.entries.append(.{ .describe = new_scope });

        this.active_scope = new_scope;
        group.log("callDescribeCallback -> call", .{});
        const result = try callback.call(globalThis, .js_undefined, &.{});

        if (result.asPromise()) |_| {
            group.log("callDescribeCallback -> got promise", .{});
            this.should_enqueue_describes = true;
            bun.assert(this._previous_scope == null);
            this._previous_scope = previous_scope;
            result.then(globalThis, buntest.ref(), describeCallbackThen, describeCallbackThen); // TODO: this function is odd. it requires manually exporting the describeCallbackThen as a toJSHostFn and also adding logic in c++
            return this.drainedPromise(globalThis);
        } else {
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

        const this = &buntest.scheduling;

        bun.assert(this._previous_scope != null);
        const prev_scope = this._previous_scope.?;
        this._previous_scope = null;
        try this.describeCallbackCompleted(globalThis, prev_scope);
        return .js_undefined;
    }
    pub fn describeCallbackCompleted(this: *Scheduling, globalThis: *jsc.JSGlobalObject, previous_scope: *DescribeScope) bun.JSError!void {
        group.begin(@src());
        defer group.end();

        this.active_scope = previous_scope;

        if (this.describe_callback_queue.items.len > 0) {
            group.log("describeCallbackCompleted -> ", .{});
            bun.assert(this.should_enqueue_describes);
            var first = this.describe_callback_queue.orderedRemove(0);
            defer first.deinit();
            _ = try this.callDescribeCallback(globalThis, first.name.get(), first.callback.get(), previous_scope);
        } else {
            group.log("describeCallbackCompleted", .{});
            this.should_enqueue_describes = false;
        }
    }
};

const DescribeScope = struct {
    parent: ?*DescribeScope,
    entries: std.ArrayList(TestScheduleEntry2),
    name: jsc.Strong.Optional,

    fn init(gpa: std.mem.Allocator, parent: ?*DescribeScope) DescribeScope {
        return .{
            .entries = std.ArrayList(TestScheduleEntry2).init(gpa),
            .parent = parent,
            .name = .empty,
        };
    }
    fn deinit(this: *DescribeScope, buntest: *BunTest) void {
        for (this.entries.items) |entry| {
            entry.deinit(buntest);
        }
        this.entries.deinit();
        this.name.deinit();
    }
};
const TestScheduleEntry2 = union(enum) {
    describe: *DescribeScope,
    callback: struct {
        mode: enum {
            beforeAll,
            beforeEach,
            afterAll,
            afterEach,
            testFn,
        },
        callback: jsc.Strong.Optional, // TODO: once called, this is swapped with &.empty so gc can collect it
    },
    fn deinit(
        this: *TestScheduleEntry2,
        buntest: *BunTest,
    ) void {
        switch (this.*) {
            .describe => |*describe| {
                describe.deinit(buntest);
                buntest.gpa.destroy(describe);
            },
            .callback => |*callback| {
                callback.callback.deinit();
            },
        }
    }
};

const TestExecution = struct {
    pub fn init(_: std.mem.Allocator) TestExecution {
        return .{};
    }
};

// here's how to execute describe blocks:
// - when you call describe:
// - enqueue_describes?
//   - append the callback to a list of describe callbacks to execute
// - else
//   - call the callback
//   - did it return a promise? if it did, mark 'enqueue_describes' as true
//
// when executing:
// - sometimes 'test()' will be called during execution stage rather than scheduling stage. in this case, we should execute it before the next test is called.
//
// jest doesn't support async in describe. we will support this, so we can pick whatever order we want.

pub const group = struct {
    fn printIndent() void {
        std.io.getStdOut().writer().print("\x1b[90m", .{}) catch {};
        for (0..indent) |_| {
            std.io.getStdOut().writer().print("│ ", .{}) catch {};
        }
        std.io.getStdOut().writer().print("\x1b[m", .{}) catch {};
    }
    var indent: usize = 0;
    var last_was_start = false;
    var wants_quiet: ?bool = null;
    fn getWantsQuiet() bool {
        if (wants_quiet) |v| return v;
        if (bun.getenvZ("WANTS_QUIET")) |val| {
            if (!std.mem.eql(u8, val, "0")) {
                wants_quiet = true;
                return wants_quiet.?;
            }
        }
        wants_quiet = false;
        return wants_quiet.?;
    }
    pub fn begin(pos: std.builtin.SourceLocation) void {
        if (getWantsQuiet()) return;
        printIndent();
        std.io.getStdOut().writer().print("\x1b[32m++ \x1b[36m{s}\x1b[37m:\x1b[93m{d}\x1b[37m:\x1b[33m{d}\x1b[37m: \x1b[35m{s}\x1b[m\n", .{ pos.file, pos.line, pos.column, pos.fn_name }) catch {};
        indent += 1;
        last_was_start = true;
    }
    pub fn end() void {
        if (getWantsQuiet()) return;
        indent -= 1;
        defer last_was_start = false;
        if (last_was_start) return; //std.io.getStdOut().writer().print("\x1b[A", .{}) catch {};
        printIndent();
        std.io.getStdOut().writer().print("\x1b[32m{s}\x1b[m\n", .{if (last_was_start) "+-" else "--"}) catch {};
    }
    pub fn log(comptime fmtt: []const u8, args: anytype) void {
        if (getWantsQuiet()) return;
        printIndent();
        std.io.getStdOut().writer().print(fmtt ++ "\n", args) catch {};
        last_was_start = false;
    }
};

const bun = @import("bun");
const jsc = bun.jsc;
const std = @import("std");
