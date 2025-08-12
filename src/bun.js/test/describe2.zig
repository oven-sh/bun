pub const js_fns = struct {
    pub fn describe(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalObject.bunVM();
        if (vm.is_in_preload or bun.jsc.Jest.Jest.runner == null) {
            @panic("TODO return Bun__Jest__testPreloadObject(globalObject)");
        }
        if (bun.jsc.Jest.Jest.runner.?.describe2 == null) {
            return globalObject.throw("The describe2 was already forDebuggingDeinitNow-ed", .{});
        }
        const bunTest = &bun.jsc.Jest.Jest.runner.?.describe2.?;

        const name, const callback = callframe.argumentsAsArray(2);

        switch (bunTest.phase) {
            .collection => {
                try bunTest.collection.enqueueDescribeCallback(globalObject, name, callback);
                if (!bunTest.collection.executing) try bunTest.collection.run(globalObject, bunTest.collection.active_scope);
                return .js_undefined; // vitest doesn't return a promise, even for `describe(async () => {})`
            },
            .execution => {
                return globalObject.throw("Cannot call describe() inside a test", .{});
            },
        }
    }

    pub fn forDebuggingExecuteTestsNow(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalObject.bunVM();
        if (vm.is_in_preload or bun.jsc.Jest.Jest.runner == null) {
            @panic("TODO return Bun__Jest__testPreloadObject(globalObject)");
        }
        if (bun.jsc.Jest.Jest.runner.?.describe2 == null) {
            return globalObject.throw("The describe2 was already forDebuggingDeinitNow-ed", .{});
        }
        const bunTest = &bun.jsc.Jest.Jest.runner.?.describe2.?;

        // re-entry safety:
        // bun.refBlockJSExecution();
        // defer bun.derefBlockJSExecution();

        // here:
        // - assert the collection phase is complete, then lock the collection phase
        // - apply filters (`-t`)
        // - apply `.only`
        // - remove orphaned beforeAll/afterAll items, only if any items have been removed so far (e.g. because of `.only` or `-t`)
        // - reorder (`--randomize`)
        // now, allowing js execution again:
        // - start the test execution loop

        // test execution:
        // - one at a time
        // - timeout handling

        _ = bunTest;
        _ = callframe;

        return .js_undefined; // TODO: return a promise that resolves when all tests have executed
    }
    pub fn forDebuggingDeinitNow(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalObject.bunVM();
        if (vm.is_in_preload or bun.jsc.Jest.Jest.runner == null) {
            @panic("TODO return Bun__Jest__testPreloadObject(globalObject)");
        }
        if (bun.jsc.Jest.Jest.runner.?.describe2 == null) {
            return globalObject.throw("The describe2 was already forDebuggingDeinitNow-ed", .{});
        }
        const bunTest = &bun.jsc.Jest.Jest.runner.?.describe2.?;

        _ = callframe;

        bunTest.deinit();
        bun.jsc.Jest.Jest.runner.?.describe2 = null;

        return .js_undefined; // TODO: deinitialize describe2
    }
};

/// this will be a JSValue (returned by `Bun.jest(...)`). there will be one per file. they will be gc objects and cleaned up when no longer used.
pub const BunTest = struct {
    allocation_scope: *bun.AllocationScope,
    gpa: std.mem.Allocator,

    phase: enum {
        collection,
        execution,
    },
    collection: Collection,
    execution: Execution,

    pub fn init(outer_gpa: std.mem.Allocator) BunTest {
        var allocation_scope = bun.create(outer_gpa, bun.AllocationScope, bun.AllocationScope.init(outer_gpa));
        const gpa = allocation_scope.allocator();
        return .{
            .allocation_scope = allocation_scope,
            .gpa = gpa,
            .phase = .collection,
            .collection = .init(gpa),
            .execution = .init(gpa),
        };
    }
    pub fn deinit(this: *BunTest) void {
        this.collection.deinit();
        const backing = this.allocation_scope.parent;
        this.allocation_scope.deinit();
        // TODO: consider making a StrongScope to ensure jsc.Strong values are deinitialized, or requiring a gpa for a strong that is used in asan builds for safety?
        backing.destroy(this.allocation_scope);
    }

    pub fn ref(this: *BunTest) *anyopaque {
        // TODO jsvalue(this).protect()
        return this;
    }
    pub fn unref(this: *BunTest) void {
        // TODO jsvalue(this).unprotect()
        _ = this;
    }
};

pub const Collection = @import("./Collection.zig");

pub const DescribeScope = struct {
    parent: ?*DescribeScope,
    entries: std.ArrayList(TestScheduleEntry2),
    name: jsc.Strong.Optional,

    pub fn init(gpa: std.mem.Allocator, parent: ?*DescribeScope) DescribeScope {
        return .{
            .entries = std.ArrayList(TestScheduleEntry2).init(gpa),
            .parent = parent,
            .name = .empty,
        };
    }
    pub fn deinit(this: *DescribeScope, buntest: *BunTest) void {
        for (this.entries.items) |*entry| {
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
            .describe => |describe| {
                describe.deinit(buntest);
                buntest.gpa.destroy(describe);
            },
            .callback => |*callback| {
                callback.callback.deinit();
            },
        }
    }
};

pub const Execution = @import("./Execution.zig");

// here's how to execute describe blocks:
// - when you call describe:
// - enqueue_describes?
//   - append the callback to a list of describe callbacks to execute
// - else
//   - call the callback
//   - did it return a promise? if it did, mark 'enqueue_describes' as true
//
// when executing:
// - sometimes 'test()' will be called during execution stage rather than collection stage. in this case, we should execute it before the next test is called.
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

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
