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
            @panic("TODO vm.is_in_preload or runner == null");
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
    _previous_scope: ?*DescribeScope,

    pub fn init(gpa: std.mem.Allocator) Scheduling {
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
        return jsc.JSPromise.resolvedPromiseValue(globalThis, .js_undefined); // TODO: return a promise that resolves when the describe queue is drained
    }

    fn bunTest(this: *Scheduling) *BunTest {
        return @fieldParentPtr("scheduling", this);
    }

    pub fn executeOrEnqueueDescribeCallback(this: *Scheduling, globalThis: *jsc.JSGlobalObject, name: jsc.JSValue, callback: jsc.JSValue) !jsc.JSValue {
        bun.assert(!this.locked);
        if (this.should_enqueue_describes) {
            try this.describe_callback_queue.append(.{
                .active_scope = this.active_scope,
                .name = .create(name, globalThis),
                .callback = .create(callback.withAsyncContextIfNeeded(globalThis), globalThis),
            });
            return this.drainedPromise(globalThis);
        } else {
            return this.callDescribeCallback(globalThis, name, callback, this.active_scope);
        }
    }

    pub fn callDescribeCallback(this: *Scheduling, globalThis: *jsc.JSGlobalObject, name: jsc.JSValue, callback: jsc.JSValue, active_scope: *DescribeScope) bun.JSError!jsc.JSValue {
        const buntest = this.bunTest();

        const previous_scope = active_scope;
        const new_scope = bun.create(buntest.gpa, DescribeScope, .init(buntest.gpa, previous_scope));
        new_scope.name = .create(name, globalThis);
        try previous_scope.entries.append(.{ .describe = new_scope });

        this.active_scope = new_scope;
        const result = try callback.call(globalThis, .js_undefined, &.{});

        if (result.asPromise()) |_| {
            this.should_enqueue_describes = true;
            bun.assert(this._previous_scope == null);
            this._previous_scope = previous_scope;
            result.then(globalThis, buntest.ref(), describeCallbackThen, describeCallbackThen);
            return this.drainedPromise(globalThis);
        } else {
            try this.describeCallbackCompleted(globalThis, previous_scope);
            return .js_undefined;
        }
    }
    pub fn describeCallbackThen(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        var buntest: *BunTest = callframe.this().asPromisePtr(BunTest);
        defer buntest.unref();

        const this = &buntest.scheduling;

        try this.describeCallbackCompleted(globalThis, this._previous_scope.?);
        return .js_undefined;
    }
    pub fn describeCallbackCompleted(this: *Scheduling, globalThis: *jsc.JSGlobalObject, previous_scope: *DescribeScope) bun.JSError!void {
        this.active_scope = previous_scope;

        if (this.describe_callback_queue.items.len > 0) {
            bun.assert(this.should_enqueue_describes);
            var first = this.describe_callback_queue.orderedRemove(0);
            defer first.deinit();
            _ = try this.callDescribeCallback(globalThis, first.name.get(), first.callback.get(), previous_scope);
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

const bun = @import("bun");
const jsc = bun.jsc;
const std = @import("std");
