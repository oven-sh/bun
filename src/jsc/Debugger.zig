path_or_port: ?[]const u8 = null,
from_environment_variable: []const u8 = "",
script_execution_context_id: u32 = 0,
next_debugger_id: u64 = 1,
poll_ref: bun.Async.KeepAlive = .{},
wait_for_connection: Wait = .off,
// wait_for_connection: bool = false,
set_breakpoint_on_first_line: bool = false,
mode: enum {
    /// Bun acts as the server. https://debug.bun.sh/ uses this
    listen,
    /// Bun connects to this path. The VSCode extension uses this.
    connect,
} = .listen,

test_reporter_agent: TestReporterAgent = .{},
lifecycle_reporter_agent: LifecycleAgent = .{},
frontend_dev_server_agent: BunFrontendDevServerAgent = .{},
http_server_agent: HTTPServerAgent = .{},
must_block_until_connected: bool = false,

pub const Wait = enum { off, shortly, forever };

pub const log = Output.scoped(.debugger, .visible);

extern "c" fn Bun__createJSDebugger(*JSGlobalObject) u32;
extern "c" fn Bun__ensureDebugger(u32, bool) void;
extern "c" fn Bun__startJSDebuggerThread(*JSGlobalObject, u32, *bun.String, c_int, bool) void;
var futex_atomic: std.atomic.Value(u32) = .init(0);

pub fn waitForDebuggerIfNecessary(this: *VirtualMachine) void {
    const debugger = &(this.debugger orelse return);
    bun.analytics.Features.debugger += 1;
    if (!debugger.must_block_until_connected) {
        return;
    }
    defer debugger.must_block_until_connected = false;

    Debugger.log("spin", .{});
    while (futex_atomic.load(.monotonic) > 0) {
        bun.Futex.waitForever(&futex_atomic, 1);
    }
    if (comptime Environment.enable_logs)
        Debugger.log("waitForDebugger: {f}", .{Output.ElapsedFormatter{
            .colors = Output.enable_ansi_colors_stderr,
            .duration_ns = @truncate(@as(u128, @intCast(std.time.nanoTimestamp() - bun.cli.start_time))),
        }});

    Bun__ensureDebugger(debugger.script_execution_context_id, debugger.wait_for_connection != .off);

    // Sleep up to 30ms for automatic inspection.
    const wait_for_connection_delay_ms = 30;

    var deadline: bun.timespec = if (debugger.wait_for_connection == .shortly) bun.timespec.now(.force_real_time).addMs(wait_for_connection_delay_ms) else undefined;

    if (comptime Environment.isWindows) {
        // TODO: remove this when tickWithTimeout actually works properly on Windows.
        if (debugger.wait_for_connection == .shortly) {
            uv.uv_update_time(this.uvLoop());
            var timer = bun.handleOom(bun.default_allocator.create(uv.Timer));
            timer.* = std.mem.zeroes(uv.Timer);
            timer.init(this.uvLoop());
            const onDebuggerTimer = struct {
                fn call(handle: *uv.Timer) callconv(.c) void {
                    const vm = VirtualMachine.get();
                    vm.debugger.?.poll_ref.unref(vm);
                    uv.uv_close(@ptrCast(handle), deinitTimer);
                }

                fn deinitTimer(handle: *anyopaque) callconv(.c) void {
                    bun.default_allocator.destroy(@as(*uv.Timer, @ptrCast(@alignCast(handle))));
                }
            }.call;
            timer.start(wait_for_connection_delay_ms, 0, &onDebuggerTimer);
            timer.ref();
        }
    }

    while (debugger.wait_for_connection != .off) {
        this.eventLoop().tick();
        switch (debugger.wait_for_connection) {
            .forever => {
                this.eventLoop().autoTickActive();

                if (comptime Environment.enable_logs)
                    log("waited: {D}", .{@as(i64, @truncate(std.time.nanoTimestamp() - bun.cli.start_time))});
            },
            .shortly => {
                // Handle .incrementRefConcurrently
                if (comptime Environment.isPosix) {
                    const pending_unref = this.pending_unref_counter;
                    if (pending_unref > 0) {
                        this.pending_unref_counter = 0;
                        this.uwsLoop().unrefCount(pending_unref);
                    }
                }

                this.uwsLoop().tickWithTimeout(&deadline);

                if (comptime Environment.enable_logs)
                    log("waited: {D}", .{@as(i64, @truncate(std.time.nanoTimestamp() - bun.cli.start_time))});

                const elapsed = bun.timespec.now(.force_real_time);
                if (elapsed.order(&deadline) != .lt) {
                    debugger.poll_ref.unref(this);
                    log("Timed out waiting for the debugger", .{});
                    break;
                }
            },
            .off => {
                break;
            },
        }
    }
}

pub var has_created_debugger: bool = false;
pub fn create(this: *VirtualMachine, globalObject: *JSGlobalObject) !void {
    log("create", .{});
    jsc.markBinding(@src());
    if (!has_created_debugger) {
        has_created_debugger = true;
        std.mem.doNotOptimizeAway(&TestReporterAgent.Bun__TestReporterAgentDisable);
        std.mem.doNotOptimizeAway(&LifecycleAgent.Bun__LifecycleAgentDisable);
        std.mem.doNotOptimizeAway(&TestReporterAgent.Bun__TestReporterAgentEnable);
        std.mem.doNotOptimizeAway(&LifecycleAgent.Bun__LifecycleAgentEnable);
        var debugger = &this.debugger.?;
        debugger.script_execution_context_id = Bun__createJSDebugger(globalObject);
        if (!this.has_started_debugger) {
            this.has_started_debugger = true;
            var thread = try std.Thread.spawn(.{}, startJSDebuggerThread, .{this});
            thread.detach();
        }
        this.eventLoop().ensureWaker();

        if (debugger.wait_for_connection != .off) {
            debugger.poll_ref.ref(this);
            debugger.must_block_until_connected = true;
        }
    }
}

pub fn startJSDebuggerThread(other_vm: *VirtualMachine) void {
    var arena = bun.MimallocArena.init();
    Output.Source.configureNamedThread("Debugger");
    log("startJSDebuggerThread", .{});
    jsc.markBinding(@src());

    // Create a thread-local env_loader to avoid allocator threading violations
    const thread_allocator = arena.allocator();
    const env_map = thread_allocator.create(DotEnv.Map) catch @panic("Failed to create debugger env map");
    env_map.* = DotEnv.Map.init(thread_allocator);
    const env_loader = thread_allocator.create(DotEnv.Loader) catch @panic("Failed to create debugger env loader");
    env_loader.* = DotEnv.Loader.init(env_map, thread_allocator);

    var vm = VirtualMachine.init(.{
        .allocator = thread_allocator,
        .args = std.mem.zeroes(bun.schema.api.TransformOptions),
        .store_fd = false,
        .env_loader = env_loader,
    }) catch @panic("Failed to create Debugger VM");
    vm.allocator = arena.allocator();
    vm.arena = &arena;

    vm.transpiler.configureDefines() catch @panic("Failed to configure defines");
    vm.is_main_thread = false;
    vm.eventLoop().ensureWaker();

    const callback = jsc.OpaqueWrap(VirtualMachine, start);
    vm.global.vm().holdAPILock(other_vm, callback);
}

pub export fn Debugger__didConnect() void {
    var this = VirtualMachine.get();
    if (this.debugger.?.wait_for_connection != .off) {
        this.debugger.?.wait_for_connection = .off;
        this.debugger.?.poll_ref.unref(this);
        this.eventLoop().wakeup();
    }
}

fn start(other_vm: *VirtualMachine) void {
    jsc.markBinding(@src());

    var this = VirtualMachine.get();
    const debugger = other_vm.debugger.?;
    const loop = this.eventLoop();

    if (debugger.from_environment_variable.len > 0) {
        var url = bun.String.cloneUTF8(debugger.from_environment_variable);

        loop.enter();
        defer loop.exit();
        Bun__startJSDebuggerThread(this.global, debugger.script_execution_context_id, &url, 1, debugger.mode == .connect);
    }

    if (debugger.path_or_port) |path_or_port| {
        var url = bun.String.cloneUTF8(path_or_port);

        loop.enter();
        defer loop.exit();
        Bun__startJSDebuggerThread(this.global, debugger.script_execution_context_id, &url, 0, debugger.mode == .connect);
    }

    this.global.handleRejectedPromises();

    if (this.log.msgs.items.len > 0) {
        this.log.print(Output.errorWriter()) catch {};
        Output.prettyErrorln("\n", .{});
        Output.flush();
    }

    log("wake", .{});
    futex_atomic.store(0, .monotonic);
    bun.Futex.wake(&futex_atomic, 1);

    other_vm.eventLoop().wakeup();

    this.eventLoop().tick();

    other_vm.eventLoop().wakeup();

    while (true) {
        while (this.isEventLoopAlive()) {
            this.tick();
            this.eventLoop().autoTickActive();
        }

        this.eventLoop().tickPossiblyForever();
    }
}

pub const AsyncTaskTracker = struct {
    id: u64,

    pub fn init(vm: *VirtualMachine) AsyncTaskTracker {
        return .{ .id = vm.nextAsyncTaskID() };
    }

    pub fn didSchedule(this: AsyncTaskTracker, globalObject: *JSGlobalObject) void {
        if (this.id == 0) return;

        didScheduleAsyncCall(globalObject, AsyncCallType.EventListener, this.id, true);
    }

    pub fn didCancel(this: AsyncTaskTracker, globalObject: *JSGlobalObject) void {
        if (this.id == 0) return;

        didCancelAsyncCall(globalObject, AsyncCallType.EventListener, this.id);
    }

    pub fn willDispatch(this: AsyncTaskTracker, globalObject: *JSGlobalObject) void {
        if (this.id == 0) {
            return;
        }

        willDispatchAsyncCall(globalObject, AsyncCallType.EventListener, this.id);
    }

    pub fn didDispatch(this: AsyncTaskTracker, globalObject: *JSGlobalObject) void {
        if (this.id == 0) {
            return;
        }

        didDispatchAsyncCall(globalObject, AsyncCallType.EventListener, this.id);
    }
};

pub const AsyncCallType = enum(u8) {
    DOMTimer = 1,
    EventListener = 2,
    PostMessage = 3,
    RequestAnimationFrame = 4,
    Microtask = 5,
};
extern fn Debugger__didScheduleAsyncCall(*JSGlobalObject, AsyncCallType, u64, bool) void;
extern fn Debugger__didCancelAsyncCall(*JSGlobalObject, AsyncCallType, u64) void;
extern fn Debugger__didDispatchAsyncCall(*JSGlobalObject, AsyncCallType, u64) void;
extern fn Debugger__willDispatchAsyncCall(*JSGlobalObject, AsyncCallType, u64) void;

pub fn didScheduleAsyncCall(globalObject: *JSGlobalObject, call: AsyncCallType, id: u64, single_shot: bool) void {
    jsc.markBinding(@src());
    Debugger__didScheduleAsyncCall(globalObject, call, id, single_shot);
}
pub fn didCancelAsyncCall(globalObject: *JSGlobalObject, call: AsyncCallType, id: u64) void {
    jsc.markBinding(@src());
    Debugger__didCancelAsyncCall(globalObject, call, id);
}
pub fn didDispatchAsyncCall(globalObject: *JSGlobalObject, call: AsyncCallType, id: u64) void {
    jsc.markBinding(@src());
    Debugger__didDispatchAsyncCall(globalObject, call, id);
}
pub fn willDispatchAsyncCall(globalObject: *JSGlobalObject, call: AsyncCallType, id: u64) void {
    jsc.markBinding(@src());
    Debugger__willDispatchAsyncCall(globalObject, call, id);
}

pub const TestReporterAgent = struct {
    handle: ?*Handle = null,
    const debug = Output.scoped(.TestReporterAgent, .visible);

    /// this enum is kept in sync with c++ InspectorTestReporterAgent.cpp `enum class BunTestStatus`
    pub const TestStatus = enum(u8) {
        pass,
        fail,
        timeout,
        skip,
        todo,
        skipped_because_label,
    };

    pub const TestType = enum(u8) {
        @"test" = 0,
        describe = 1,
    };

    pub const Handle = opaque {
        extern "c" fn Bun__TestReporterAgentReportTestFound(agent: *Handle, callFrame: *jsc.CallFrame, testId: c_int, name: *bun.String, item_type: TestType, parentId: c_int) void;
        extern "c" fn Bun__TestReporterAgentReportTestFoundWithLocation(agent: *Handle, testId: c_int, name: *bun.String, item_type: TestType, parentId: c_int, sourceURL: *bun.String, line: c_int) void;
        extern "c" fn Bun__TestReporterAgentReportTestStart(agent: *Handle, testId: c_int) void;
        extern "c" fn Bun__TestReporterAgentReportTestEnd(agent: *Handle, testId: c_int, bunTestStatus: TestStatus, elapsed: f64) void;

        pub fn reportTestFound(this: *Handle, callFrame: *jsc.CallFrame, testId: i32, name: *bun.String, item_type: TestType, parentId: i32) void {
            Bun__TestReporterAgentReportTestFound(this, callFrame, testId, name, item_type, parentId);
        }

        pub fn reportTestFoundWithLocation(this: *Handle, testId: i32, name: *bun.String, item_type: TestType, parentId: i32, sourceURL: *bun.String, line: i32) void {
            Bun__TestReporterAgentReportTestFoundWithLocation(this, testId, name, item_type, parentId, sourceURL, line);
        }

        pub fn reportTestStart(this: *Handle, testId: c_int) void {
            Bun__TestReporterAgentReportTestStart(this, testId);
        }

        pub fn reportTestEnd(this: *Handle, testId: c_int, bunTestStatus: TestStatus, elapsed: f64) void {
            Bun__TestReporterAgentReportTestEnd(this, testId, bunTestStatus, elapsed);
        }
    };
    pub export fn Bun__TestReporterAgentEnable(agent: *Handle) void {
        if (VirtualMachine.get().debugger) |*debugger| {
            debug("enable", .{});
            debugger.test_reporter_agent.handle = agent;

            // Retroactively report any tests that were already discovered before the debugger connected
            retroactivelyReportDiscoveredTests(agent);
        }
    }

    /// When TestReporter.enable is called after test collection has started/finished,
    /// we need to retroactively assign test IDs and report discovered tests.
    fn retroactivelyReportDiscoveredTests(agent: *Handle) void {
        const Jest = jsc.Jest.Jest;
        const runner = Jest.runner orelse return;
        const active_file = runner.bun_test_root.active_file.get() orelse return;

        // Only report if we're in collection or execution phase (tests have been discovered)
        switch (active_file.phase) {
            .collection, .execution => {},
            .done => return,
        }

        // Get the file path for source location info
        const file_path = runner.files.get(active_file.file_id).source.path.text;
        var source_url = bun.String.init(file_path);

        // Track the maximum ID we assign
        var max_id: i32 = 0;

        // Recursively report all discovered tests starting from root scope
        const root_scope = active_file.collection.root_scope;
        retroactivelyReportScope(agent, root_scope, -1, &max_id, &source_url);

        debug("retroactively reported {} tests", .{max_id});
    }

    fn retroactivelyReportScope(agent: *Handle, scope: *bun_test.DescribeScope, parent_id: i32, max_id: *i32, source_url: *bun.String) void {
        for (scope.entries.items) |*entry| {
            switch (entry.*) {
                .describe => |describe| {
                    // Only report and assign ID if not already assigned
                    if (describe.base.test_id_for_debugger == 0) {
                        max_id.* += 1;
                        const test_id = max_id.*;
                        // Assign the ID so start/end events will fire during execution
                        describe.base.test_id_for_debugger = test_id;
                        var name = bun.String.init(describe.base.name orelse "(unnamed)");
                        agent.reportTestFoundWithLocation(
                            test_id,
                            &name,
                            .describe,
                            parent_id,
                            source_url,
                            @intCast(describe.base.line_no),
                        );
                        // Recursively report children with this describe as parent
                        retroactivelyReportScope(agent, describe, test_id, max_id, source_url);
                    } else {
                        // Already has ID, just recurse with existing ID as parent
                        retroactivelyReportScope(agent, describe, describe.base.test_id_for_debugger, max_id, source_url);
                    }
                },
                .test_callback => |test_entry| {
                    // Only report and assign ID if not already assigned
                    if (test_entry.base.test_id_for_debugger == 0) {
                        max_id.* += 1;
                        const test_id = max_id.*;
                        // Assign the ID so start/end events will fire during execution
                        test_entry.base.test_id_for_debugger = test_id;
                        var name = bun.String.init(test_entry.base.name orelse "(unnamed)");
                        agent.reportTestFoundWithLocation(
                            test_id,
                            &name,
                            .@"test",
                            parent_id,
                            source_url,
                            @intCast(test_entry.base.line_no),
                        );
                    }
                },
            }
        }
    }

    const bun_test = jsc.Jest.bun_test;
    pub export fn Bun__TestReporterAgentDisable(_: *Handle) void {
        if (VirtualMachine.get().debugger) |*debugger| {
            debug("disable", .{});
            debugger.test_reporter_agent.handle = null;
        }
    }

    /// Caller must ensure that it is enabled first.
    ///
    /// Since we may have to call .deinit on the name string.
    pub fn reportTestFound(this: TestReporterAgent, callFrame: *jsc.CallFrame, test_id: i32, name: *bun.String, item_type: TestType, parentId: i32) void {
        debug("reportTestFound", .{});

        this.handle.?.reportTestFound(callFrame, test_id, name, item_type, parentId);
    }

    /// Caller must ensure that it is enabled first.
    pub fn reportTestStart(this: TestReporterAgent, test_id: i32) void {
        debug("reportTestStart", .{});
        this.handle.?.reportTestStart(test_id);
    }

    /// Caller must ensure that it is enabled first.
    pub fn reportTestEnd(this: TestReporterAgent, test_id: i32, bunTestStatus: TestStatus, elapsed: f64) void {
        debug("reportTestEnd", .{});
        this.handle.?.reportTestEnd(test_id, bunTestStatus, elapsed);
    }

    pub fn isEnabled(this: TestReporterAgent) bool {
        return this.handle != null;
    }
};

pub const LifecycleAgent = struct {
    handle: ?*Handle = null,
    const debug = Output.scoped(.LifecycleAgent, .visible);

    pub const Handle = opaque {
        extern "c" fn Bun__LifecycleAgentReportReload(agent: *Handle) void;
        extern "c" fn Bun__LifecycleAgentReportError(agent: *Handle, exception: *ZigException) void;
        extern "c" fn Bun__LifecycleAgentPreventExit(agent: *Handle) void;
        extern "c" fn Bun__LifecycleAgentStopPreventingExit(agent: *Handle) void;

        pub fn preventExit(this: *Handle) void {
            Bun__LifecycleAgentPreventExit(this);
        }

        pub fn stopPreventingExit(this: *Handle) void {
            Bun__LifecycleAgentStopPreventingExit(this);
        }

        pub fn reportReload(this: *Handle) void {
            debug("reportReload", .{});
            Bun__LifecycleAgentReportReload(this);
        }

        pub fn reportError(this: *Handle, exception: *ZigException) void {
            debug("reportError", .{});
            Bun__LifecycleAgentReportError(this, exception);
        }
    };

    pub export fn Bun__LifecycleAgentEnable(agent: *Handle) void {
        if (VirtualMachine.get().debugger) |*debugger| {
            debug("enable", .{});
            debugger.lifecycle_reporter_agent.handle = agent;
        }
    }

    pub export fn Bun__LifecycleAgentDisable(agent: *Handle) void {
        _ = agent; // autofix
        if (VirtualMachine.get().debugger) |*debugger| {
            debug("disable", .{});
            debugger.lifecycle_reporter_agent.handle = null;
        }
    }

    pub fn reportReload(this: *LifecycleAgent) void {
        if (this.handle) |handle| {
            handle.reportReload();
        }
    }

    pub fn reportError(this: *LifecycleAgent, exception: *ZigException) void {
        if (this.handle) |handle| {
            handle.reportError(exception);
        }
    }

    pub fn isEnabled(this: *const LifecycleAgent) bool {
        return this.handle != null;
    }
};

pub const DebuggerId = bun.GenericIndex(i32, Debugger);
pub const BunFrontendDevServerAgent = @import("./api/server/InspectorBunFrontendDevServerAgent.zig").BunFrontendDevServerAgent;
pub const HTTPServerAgent = @import("./bindings/HTTPServerAgent.zig");

const DotEnv = @import("../env_loader.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const uv = bun.windows.libuv;

const jsc = bun.jsc;
const Debugger = jsc.Debugger;
const JSGlobalObject = jsc.JSGlobalObject;
const VirtualMachine = jsc.VirtualMachine;
const ZigException = jsc.ZigException;
