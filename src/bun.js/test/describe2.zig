const js_fns = struct {
    pub fn describe(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const name, const callback = callframe.argumentsAsArray(2);
        const jest: *TestExecution = void;

        const name_and_callback = NameAndCallback{
            .name = name,
            .callback = callback,
        };
        switch (jest.stage) {
            .scheduling => |*sched| {
                if (sched.should_enqueue_describes) {
                    sched.describe_callback_queue.append(name_and_callback) catch bun.outOfMemory();
                } else {
                    // call the callback immediately
                    return try sched.callDescribeCallback(globalThis, name_and_callback);
                }
            },
            .execution => {
                return globalThis.throw("Cannot call describe() inside a test", .{});
            },
        }
    }
};

const TestExecution = struct {
    stage: enum {
        scheduling,
        execution,
    },
    scheduling: Scheduling,
    execution: TestExecution,
};

const NameAndCallback = struct { name: jsc.Strong, callback: jsc.Strong };
const Scheduling = struct {
    arena: std.heap.ArenaAllocator,

    /// if 'describe()' returns a promise, set this to true
    should_enqueue_describes: bool = false,
    /// only append to this list if should_enqueue_describes is true. begin draining after the promise resolves.
    describe_callback_queue: std.ArrayList(NameAndCallback),

    root_schedule: std.ArrayList(TestScheduleEntry),
    current_schedule: *std.ArrayList(TestScheduleEntry),

    pub fn deinit(this: *Scheduling) void {
        for (this.describe_callback_queue.items) |item| {
            item.name.deinit();
            item.callback.deinit();
        }
        this.describe_callback_queue.deinit();
        this.schedule.deinit();
    }

    pub fn callDescribeCallback(this: *Scheduling, globalThis: *jsc.JSGlobalObject, name_and_callback: NameAndCallback) !jsc.JSValue {
        const name = name_and_callback.name.get().asString() orelse return globalThis.throw("describe() must be called with a string", .{});
        const callback = name_and_callback.callback.get();

        try this.current_schedule.append(.{
            .describe = .{
                .entries = std.ArrayList(TestScheduleEntry).init(this.arena.allocator()),
            },
        });

        const result = try callback.call(globalThis, .{});

        if (result.asPromise()) |promise| {
            this.should_enqueue_describes = true;
            @panic("describe2: TODO promise.then(executeNextItemInCallbackQueue)");
        }
        return result;
    }
};

const TestScheduleEntry = union(enum) {
    describe: struct {
        entries: std.ArrayList(TestScheduleEntry),
    },
    beforeAll: struct {
        callback: jsc.Strong,
    },
    beforeEach: struct {
        callback: jsc.Strong,
    },
    afterAll: struct {
        callback: jsc.Strong,
    },
    afterEach: struct {
        callback: jsc.Strong,
    },
    testFn: struct {
        callback: jsc.Strong,
    },
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
