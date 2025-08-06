const js_fns = struct {
    pub fn describe(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const name, const callback = callframe.argumentsAsArray(2);
        const jest: *BunTest = void;

        switch (jest.stage) {
            .scheduling => {
                return try jest.scheduling.executeOrEnqueueDescribeCallback(globalThis, name, callback);
            },
            .execution => {
                return globalThis.throw("Cannot call describe() inside a test", .{});
            },
        }
    }
};

const BunTest = struct {
    gpa: *std.mem.Allocator,
    arena: std.heap.ArenaAllocator,

    phase: enum {
        scheduling,
        execution,
    },
    scheduling: Scheduling,
    execution: TestExecution,
};

const NameAndCallback = struct {
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

    root_scope: *DescribeScope,
    // unfortunately we need to use async context to store the active scope
    // that's because `describe(async () => { describe(async () => {}) }); describe(async () => {})` needs to work.
    active_scope: *DescribeScope,

    pub fn deinit(this: *Scheduling) void {
        this.root_scope.deinitTree();
        this.schedule.deinit();
    }

    fn drainedPromise(_: *Scheduling, globalThis: *jsc.JSGlobalObject) !jsc.JSValue {
        return globalThis.Promise.resolve(.undefined); // TODO: return a promise that resolves when the describe queue is drained
    }

    pub fn executeOrEnqueueDescribeCallback(this: *Scheduling, globalThis: *jsc.JSGlobalObject, name: jsc.JSValue, callback: jsc.JSValue) !jsc.JSValue {
        bun.assert(!this.locked);
        if (this.should_enqueue_describes) {
            try this.describe_callback_queue.append(.{
                .name = .create(name, globalThis),
                .callback = .create(callback, globalThis),
            });
            return this.drainedPromise(globalThis);
        } else {
            return this.callDescribeCallback(globalThis, name, callback);
        }
    }

    // no here's a problem
    // describe(async () => {
    //    describe(async () => {
    //    })
    // })
    // describe(async () => {
    // })

    pub fn callDescribeCallback(this: *Scheduling, globalThis: *jsc.JSGlobalObject, name: jsc.JSValue, callback: jsc.JSValue) !jsc.JSValue {
        const name_str = name.asString() orelse return globalThis.throw("describe() must be called with a string", .{});
        defer name.ensureStillAlive();
        const callback_fn = callback.get();

        const current_scope = this.active_scope;
        const new_scope = bun.create(this.arena.allocator(), DescribeScope, .init(this.gpa, current_scope));
        try current_scope.entries.append(.{ .describe = new_scope });

        this.active_scope = new_scope;
        const result = try callback.call(globalThis, .{});

        if (result.asPromise()) |promise| {
            this.should_enqueue_describes = true;
            // TODO: promise.then(describeCallbackThen)
            return this.drainedPromise(globalThis);
        } else {
            try this.describeCallbackCompleted(globalThis);
            return .undefined;
        }
    }
    pub fn describeCallbackThen(this: *Scheduling, globalThis: *jsc.JSGlobalObject, callback: jsc.JSValue) !jsc.JSValue {
        try this.describeCallbackCompleted(globalThis);
        return callback;
    }
    pub fn describeCallbackCompleted(this: *Scheduling, globalThis: *jsc.JSGlobalObject) !void {
        try this.current_schedule.append(.{
            .exit_describe = .{},
        });

        if (this.describe_callback_queue.length > 0) {
            bun.assert(this.should_enqueue_describes);
            const first = this.describe_callback_queue.orderedRemove(0);
            defer first.deinit();
            try this.callDescribeCallback(globalThis, first.name.get(), first.callback.get());
        }
    }
};

const DescribeScope = struct {
    parent: ?*DescribeScope,
    entries: std.ArrayList(TestScheduleEntry2),

    fn init(gpa: *std.mem.Allocator, parent: ?*DescribeScope) DescribeScope {
        return .{
            .entries = std.ArrayList(TestScheduleEntry2).init(gpa),
            .parent = parent,
        };
    }
    fn deinit(this: *DescribeScope) void {
        for (this.entries.items) |entry| {
            entry.deinit();
        }
        this.entries.deinit();
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
    fn deinit(this: *TestScheduleEntry2) void {
        switch (this.*) {
            .describe => |*describe| {
                describe.deinit();
            },
            .callback => |*callback| {
                callback.deinit();
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
