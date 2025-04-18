path_or_port: ?[]const u8 = null,
from_environment_variable: []const u8 = "",
script_execution_context_id: u32 = 0,
next_debugger_id: u64 = 1,
poll_ref: Async.KeepAlive = .{},
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
must_block_until_connected: bool = false,

pub const Wait = enum { off, shortly, forever };

pub const log = Output.scoped(.debugger, false);

extern "c" fn Bun__createJSDebugger(*JSGlobalObject) u32;
extern "c" fn Bun__ensureDebugger(u32, bool) void;
extern "c" fn Bun__startJSDebuggerThread(*JSGlobalObject, u32, *bun.String, c_int, bool) void;
var futex_atomic: std.atomic.Value(u32) = undefined;

pub fn waitForDebuggerIfNecessary(this: *VirtualMachine) void {
    const debugger = &(this.debugger orelse return);
    if (!debugger.must_block_until_connected) {
        return;
    }
    defer debugger.must_block_until_connected = false;

    Debugger.log("spin", .{});
    while (futex_atomic.load(.monotonic) > 0) {
        bun.Futex.waitForever(&futex_atomic, 1);
    }
    if (comptime Environment.enable_logs)
        Debugger.log("waitForDebugger: {}", .{Output.ElapsedFormatter{
            .colors = Output.enable_ansi_colors_stderr,
            .duration_ns = @truncate(@as(u128, @intCast(std.time.nanoTimestamp() - bun.CLI.start_time))),
        }});

    Bun__ensureDebugger(debugger.script_execution_context_id, debugger.wait_for_connection != .off);

    // Sleep up to 30ms for automatic inspection.
    const wait_for_connection_delay_ms = 30;

    var deadline: bun.timespec = if (debugger.wait_for_connection == .shortly) bun.timespec.now().addMs(wait_for_connection_delay_ms) else undefined;

    if (comptime Environment.isWindows) {
        // TODO: remove this when tickWithTimeout actually works properly on Windows.
        if (debugger.wait_for_connection == .shortly) {
            uv.uv_update_time(this.uvLoop());
            var timer = bun.default_allocator.create(uv.Timer) catch bun.outOfMemory();
            timer.* = std.mem.zeroes(uv.Timer);
            timer.init(this.uvLoop());
            const onDebuggerTimer = struct {
                fn call(handle: *uv.Timer) callconv(.C) void {
                    const vm = JSC.VirtualMachine.get();
                    vm.debugger.?.poll_ref.unref(vm);
                    uv.uv_close(@ptrCast(handle), deinitTimer);
                }

                fn deinitTimer(handle: *anyopaque) callconv(.C) void {
                    bun.default_allocator.destroy(@as(*uv.Timer, @alignCast(@ptrCast(handle))));
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
                    log("waited: {}", .{std.fmt.fmtDuration(@intCast(@as(i64, @truncate(std.time.nanoTimestamp() - bun.CLI.start_time))))});
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
                    log("waited: {}", .{std.fmt.fmtDuration(@intCast(@as(i64, @truncate(std.time.nanoTimestamp() - bun.CLI.start_time))))});

                const elapsed = bun.timespec.now();
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

pub fn create(this: *VirtualMachine, globalObject: *JSGlobalObject) !void {
    log("create", .{});
    JSC.markBinding(@src());
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
            futex_atomic = std.atomic.Value(u32).init(0);
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
    var arena = bun.MimallocArena.init() catch unreachable;
    Output.Source.configureNamedThread("Debugger");
    log("startJSDebuggerThread", .{});
    JSC.markBinding(@src());

    var vm = JSC.VirtualMachine.init(.{
        .allocator = arena.allocator(),
        .args = std.mem.zeroes(Api.TransformOptions),
        .store_fd = false,
    }) catch @panic("Failed to create Debugger VM");
    vm.allocator = arena.allocator();
    vm.arena = &arena;

    vm.transpiler.configureDefines() catch @panic("Failed to configure defines");
    vm.is_main_thread = false;
    vm.eventLoop().ensureWaker();

    const callback = OpaqueWrap(VirtualMachine, start);
    vm.global.vm().holdAPILock(other_vm, callback);
}

pub export fn Debugger__didConnect() void {
    var this = VirtualMachine.get();
    if (this.debugger.?.wait_for_connection != .off) {
        this.debugger.?.wait_for_connection = .off;
        this.debugger.?.poll_ref.unref(this);
    }
}

fn start(other_vm: *VirtualMachine) void {
    JSC.markBinding(@src());

    var this = VirtualMachine.get();
    const debugger = other_vm.debugger.?;
    const loop = this.eventLoop();

    if (debugger.from_environment_variable.len > 0) {
        var url = bun.String.createUTF8(debugger.from_environment_variable);

        loop.enter();
        defer loop.exit();
        Bun__startJSDebuggerThread(this.global, debugger.script_execution_context_id, &url, 1, debugger.mode == .connect);
    }

    if (debugger.path_or_port) |path_or_port| {
        var url = bun.String.createUTF8(path_or_port);

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

    pub fn init(vm: *JSC.VirtualMachine) AsyncTaskTracker {
        return .{ .id = vm.nextAsyncTaskID() };
    }

    pub fn didSchedule(this: AsyncTaskTracker, globalObject: *JSC.JSGlobalObject) void {
        if (this.id == 0) return;

        didScheduleAsyncCall(globalObject, AsyncCallType.EventListener, this.id, true);
    }

    pub fn didCancel(this: AsyncTaskTracker, globalObject: *JSC.JSGlobalObject) void {
        if (this.id == 0) return;

        didCancelAsyncCall(globalObject, AsyncCallType.EventListener, this.id);
    }

    pub fn willDispatch(this: AsyncTaskTracker, globalObject: *JSC.JSGlobalObject) void {
        if (this.id == 0) {
            return;
        }

        willDispatchAsyncCall(globalObject, AsyncCallType.EventListener, this.id);
    }

    pub fn didDispatch(this: AsyncTaskTracker, globalObject: *JSC.JSGlobalObject) void {
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
extern fn Debugger__didScheduleAsyncCall(*JSC.JSGlobalObject, AsyncCallType, u64, bool) void;
extern fn Debugger__didCancelAsyncCall(*JSC.JSGlobalObject, AsyncCallType, u64) void;
extern fn Debugger__didDispatchAsyncCall(*JSC.JSGlobalObject, AsyncCallType, u64) void;
extern fn Debugger__willDispatchAsyncCall(*JSC.JSGlobalObject, AsyncCallType, u64) void;

pub fn didScheduleAsyncCall(globalObject: *JSC.JSGlobalObject, call: AsyncCallType, id: u64, single_shot: bool) void {
    JSC.markBinding(@src());
    Debugger__didScheduleAsyncCall(globalObject, call, id, single_shot);
}
pub fn didCancelAsyncCall(globalObject: *JSC.JSGlobalObject, call: AsyncCallType, id: u64) void {
    JSC.markBinding(@src());
    Debugger__didCancelAsyncCall(globalObject, call, id);
}
pub fn didDispatchAsyncCall(globalObject: *JSC.JSGlobalObject, call: AsyncCallType, id: u64) void {
    JSC.markBinding(@src());
    Debugger__didDispatchAsyncCall(globalObject, call, id);
}
pub fn willDispatchAsyncCall(globalObject: *JSC.JSGlobalObject, call: AsyncCallType, id: u64) void {
    JSC.markBinding(@src());
    Debugger__willDispatchAsyncCall(globalObject, call, id);
}

const bun = @import("bun");
const jsc = bun.jsc;
const Debugger = bun.jsc.Debugger;
