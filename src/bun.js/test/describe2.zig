const js_fns = struct {
    pub fn describe(bunTest: *BunTest, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const name, const callback = callframe.argumentsAsArray(2);

        switch (bunTest.phase) {
            .scheduling => {
                return try bunTest.scheduling.executeOrEnqueueDescribeCallback(globalThis, name, callback);
            },
            .execution => {
                return globalThis.throw("Cannot call describe() inside a test", .{});
            },
        }
    }
};

/// this will be a JSValue (returned by `Bun.jest(...)`)
const BunTest = struct {
    gpa: *std.mem.Allocator,

    phase: enum {
        scheduling,
        execution,
    },
    scheduling: Scheduling,
    execution: TestExecution,

    fn ref(this: *BunTest) *const anyopaque {
        // TODO jsvalue(this).protect()
    }
    fn unref(this: *BunTest) void {
        // TODO jsvalue(this).unprotect()
    }
};

const NameAndCallback = struct {
    active_scope: *DescribeScope,
    name: jsc.Strong,
    callback: jsc.Strong,
    fn deinit(this: *NameAndCallback) void {
        this.name.deinit();
        this.callback.deinit();
    }
};
const Scheduling = struct {
    /// if 'describe()' returns a promise, set this to true
    should_enqueue_describes: bool = false,
    locked: bool = false, // set to true after scheduling phase ends
    describe_callback_queue: std.ArrayList(NameAndCallback),

    root_scope: *DescribeScope,
    active_scope: *DescribeScope,
    _previous_scope: ?*DescribeScope,

    pub fn deinit(this: *Scheduling) void {
        this.root_scope.deinitTree();
        this.schedule.deinit();
    }

    fn drainedPromise(_: *Scheduling, globalThis: *jsc.JSGlobalObject) !jsc.JSValue {
        return globalThis.Promise.resolve(.undefined); // TODO: return a promise that resolves when the describe queue is drained
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
            return this.callDescribeCallback(globalThis, name, callback);
        }
    }

    pub fn callDescribeCallback(this: *Scheduling, globalThis: *jsc.JSGlobalObject, name: jsc.JSValue, callback: jsc.JSValue, active_scope: *DescribeScope) !jsc.JSValue {
        const buntest = this.bunTest();

        const previous_scope = active_scope;
        const new_scope = bun.create(buntest.gpa, DescribeScope, .init(buntest.gpa, previous_scope));
        new_scope.name = .create(name, globalThis);
        try previous_scope.entries.append(.{ .describe = new_scope });

        this.active_scope = new_scope;
        const result = try callback.call(globalThis, .{});

        if (result.asPromise()) |_| {
            this.should_enqueue_describes = true;
            bun.assert(this._previous_scope == null);
            this._previous_scope = previous_scope;
            result.then(globalThis, buntest.ref(), describeCallbackThen, describeCallbackThen);
            return this.drainedPromise(globalThis);
        } else {
            try this.describeCallbackCompleted(globalThis, previous_scope);
            return .undefined;
        }
    }
    pub fn describeCallbackThen(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        var buntest: *BunTest = callframe.this().asPromisePtr(@This());
        defer buntest.deref();

        const this = &buntest.scheduling;

        try this.describeCallbackCompleted(globalThis, this._previous_scope.?);
        return .undefined;
    }
    pub fn describeCallbackCompleted(this: *Scheduling, globalThis: *jsc.JSGlobalObject, previous_scope: *DescribeScope) !void {
        this.active_scope = previous_scope;

        if (this.describe_callback_queue.length > 0) {
            bun.assert(this.should_enqueue_describes);
            const first = this.describe_callback_queue.orderedRemove(0);
            defer first.deinit();
            try this.callDescribeCallback(globalThis, first.name.get(), first.callback.get(), previous_scope);
        }
    }
};

const DescribeScope = struct {
    parent: ?*DescribeScope,
    entries: std.ArrayList(TestScheduleEntry2),
    name: jsc.Strong,

    fn init(gpa: *std.mem.Allocator, parent: ?*DescribeScope) DescribeScope {
        return .{
            .entries = std.ArrayList(TestScheduleEntry2).init(gpa),
            .parent = parent,
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
        callback: jsc.Strong,
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

const TestExecution = struct {};

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
