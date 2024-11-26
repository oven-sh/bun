const default_allocator = bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;

const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const MutableString = bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Which = @import("../../../which.zig");
const Async = bun.Async;
const IPC = @import("../../ipc.zig");
const uws = bun.uws;
const windows = bun.windows;
const uv = windows.libuv;
const LifecycleScriptSubprocess = bun.install.LifecycleScriptSubprocess;
const Body = JSC.WebCore.Body;
const IPClog = Output.scoped(.IPC, false);

const PosixSpawn = bun.posix.spawn;
const Rusage = bun.posix.spawn.Rusage;
const Process = bun.posix.spawn.Process;
const WaiterThread = bun.posix.spawn.WaiterThread;
const Stdio = bun.spawn.Stdio;
const StdioResult = if (Environment.isWindows) bun.spawn.WindowsSpawnResult.StdioResult else ?bun.FileDescriptor;
pub inline fn assertStdioResult(result: StdioResult) void {
    if (comptime Environment.allow_assert) {
        if (Environment.isPosix) {
            if (result) |fd| {
                bun.assert(fd != bun.invalid_fd);
            }
        }
    }
}
pub const ResourceUsage = struct {
    pub usingnamespace JSC.Codegen.JSResourceUsage;
    rusage: Rusage,

    pub fn getCPUTime(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) JSValue {
        var cpu = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
        const rusage = this.rusage;

        const usrTime = JSValue.fromTimevalNoTruncate(globalObject, rusage.utime.tv_usec, rusage.utime.tv_sec);
        const sysTime = JSValue.fromTimevalNoTruncate(globalObject, rusage.stime.tv_usec, rusage.stime.tv_sec);

        cpu.put(globalObject, JSC.ZigString.static("user"), usrTime);
        cpu.put(globalObject, JSC.ZigString.static("system"), sysTime);
        cpu.put(globalObject, JSC.ZigString.static("total"), JSValue.bigIntSum(globalObject, usrTime, sysTime));

        return cpu;
    }

    pub fn getMaxRSS(
        this: *ResourceUsage,
        _: *JSGlobalObject,
    ) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.maxrss);
    }

    pub fn getSharedMemorySize(
        this: *ResourceUsage,
        _: *JSGlobalObject,
    ) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.ixrss);
    }

    pub fn getSwapCount(
        this: *ResourceUsage,
        _: *JSGlobalObject,
    ) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.nswap);
    }

    pub fn getOps(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) JSValue {
        var ops = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
        ops.put(globalObject, JSC.ZigString.static("in"), JSC.JSValue.jsNumber(this.rusage.inblock));
        ops.put(globalObject, JSC.ZigString.static("out"), JSC.JSValue.jsNumber(this.rusage.oublock));
        return ops;
    }

    pub fn getMessages(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) JSValue {
        var msgs = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
        msgs.put(globalObject, JSC.ZigString.static("sent"), JSC.JSValue.jsNumber(this.rusage.msgsnd));
        msgs.put(globalObject, JSC.ZigString.static("received"), JSC.JSValue.jsNumber(this.rusage.msgrcv));
        return msgs;
    }

    pub fn getSignalCount(
        this: *ResourceUsage,
        _: *JSGlobalObject,
    ) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.nsignals);
    }

    pub fn getContextSwitches(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) JSValue {
        var ctx = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
        ctx.put(globalObject, JSC.ZigString.static("voluntary"), JSC.JSValue.jsNumber(this.rusage.nvcsw));
        ctx.put(globalObject, JSC.ZigString.static("involuntary"), JSC.JSValue.jsNumber(this.rusage.nivcsw));
        return ctx;
    }

    pub fn finalize(this: *ResourceUsage) callconv(.C) void {
        bun.default_allocator.destroy(this);
    }
};

pub fn appendEnvpFromJS(globalThis: *JSC.JSGlobalObject, object: JSC.JSValue, envp: *std.ArrayList(?[*:0]const u8), PATH: *[]const u8) !void {
    var object_iter = JSC.JSPropertyIterator(.{ .skip_empty_name = false, .include_value = true }).init(globalThis, object);
    defer object_iter.deinit();
    try envp.ensureTotalCapacityPrecise(object_iter.len +
        // +1 incase there's IPC
        // +1 for null terminator
        2);
    while (object_iter.next()) |key| {
        var value = object_iter.value;
        if (value == .undefined) continue;

        var line = try std.fmt.allocPrintZ(envp.allocator, "{}={}", .{ key, value.getZigString(globalThis) });

        if (key.eqlComptime("PATH")) {
            PATH.* = bun.asByteSlice(line["PATH=".len..]);
        }

        try envp.append(line);
    }
}

pub const Subprocess = struct {
    const log = Output.scoped(.Subprocess, false);
    pub usingnamespace JSC.Codegen.JSSubprocess;
    const default_max_buffer_size = 1024 * 1024 * 4;
    pub const StdioKind = enum {
        stdin,
        stdout,
        stderr,

        pub fn toFd(this: @This()) bun.FileDescriptor {
            return switch (this) {
                .stdin => bun.STDIN_FD,
                .stdout => bun.STDOUT_FD,
                .stderr => bun.STDERR_FD,
            };
        }

        pub fn toNum(this: @This()) c_int {
            return switch (this) {
                .stdin => 0,
                .stdout => 1,
                .stderr => 2,
            };
        }
    };
    process: *Process,
    stdin: Writable,
    stdout: Readable,
    stderr: Readable,
    stdio_pipes: if (Environment.isWindows) std.ArrayListUnmanaged(StdioResult) else std.ArrayListUnmanaged(bun.FileDescriptor) = .{},
    pid_rusage: ?Rusage = null,

    exit_promise: JSC.Strong = .{},
    on_exit_callback: JSC.Strong = .{},
    on_disconnect_callback: JSC.Strong = .{},

    globalThis: *JSC.JSGlobalObject,
    observable_getters: std.enums.EnumSet(enum {
        stdin,
        stdout,
        stderr,
        stdio,
    }) = .{},
    closed: std.enums.EnumSet(StdioKind) = .{},
    has_pending_activity: std.atomic.Value(bool) = std.atomic.Value(bool).init(true),
    this_jsvalue: JSC.JSValue = .zero,

    /// `null` indicates all of the IPC data is uninitialized.
    ipc_data: ?IPC.IPCData,
    ipc_callback: JSC.Strong = .{},
    flags: Flags = .{},

    weak_file_sink_stdin_ptr: ?*JSC.WebCore.FileSink = null,
    ref_count: u32 = 1,
    abort_signal: ?*JSC.AbortSignal = null,

    usingnamespace bun.NewRefCounted(@This(), Subprocess.deinit);

    pub const Flags = packed struct {
        is_sync: bool = false,
        killed: bool = false,
        has_stdin_destructor_called: bool = false,
        finalized: bool = false,
        deref_on_stdin_destroyed: bool = false,
    };

    pub const SignalCode = bun.SignalCode;

    pub const Poll = union(enum) {
        poll_ref: ?*Async.FilePoll,
        wait_thread: WaitThreadPoll,
    };

    pub const WaitThreadPoll = struct {
        ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
        poll_ref: Async.KeepAlive = .{},
    };

    pub fn onAbortSignal(subprocess_ctx: ?*anyopaque, _: JSC.JSValue) callconv(.C) void {
        var this: *Subprocess = @ptrCast(@alignCast(subprocess_ctx.?));
        this.clearAbortSignal();
        _ = this.tryKill(SignalCode.default);
    }

    pub fn resourceUsage(
        this: *Subprocess,
        globalObject: *JSGlobalObject,
        _: *JSC.CallFrame,
    ) bun.JSError!JSValue {
        return this.createResourceUsageObject(globalObject);
    }

    pub fn createResourceUsageObject(
        this: *Subprocess,
        globalObject: *JSGlobalObject,
    ) JSValue {
        const pid_rusage = this.pid_rusage orelse brk: {
            if (Environment.isWindows) {
                if (this.process.poller == .uv) {
                    this.pid_rusage = PosixSpawn.uv_getrusage(&this.process.poller.uv);
                    break :brk this.pid_rusage.?;
                }
            }

            return JSValue.jsUndefined();
        };

        const resource_usage = ResourceUsage{
            .rusage = pid_rusage,
        };

        var result = bun.default_allocator.create(ResourceUsage) catch {
            globalObject.throwOutOfMemory();
            return .zero;
        };
        result.* = resource_usage;
        return result.toJS(globalObject);
    }

    pub fn hasExited(this: *const Subprocess) bool {
        return this.process.hasExited();
    }

    pub fn hasPendingActivityNonThreadsafe(this: *const Subprocess) bool {
        if (this.ipc_data != null) {
            return true;
        }

        if (this.hasPendingActivityStdio()) {
            return true;
        }

        if (!this.process.hasExited()) {
            return true;
        }

        return false;
    }

    pub fn updateHasPendingActivity(this: *Subprocess) void {
        @fence(.seq_cst);
        if (comptime Environment.isDebug) {
            log("updateHasPendingActivity() {any} -> {any}", .{
                this.has_pending_activity.raw,
                this.hasPendingActivityNonThreadsafe(),
            });
        }
        this.has_pending_activity.store(
            this.hasPendingActivityNonThreadsafe(),
            .monotonic,
        );
    }

    pub fn hasPendingActivityStdio(this: *const Subprocess) bool {
        if (this.stdin.hasPendingActivity()) {
            return true;
        }

        inline for (.{ StdioKind.stdout, StdioKind.stderr }) |kind| {
            if (@field(this, @tagName(kind)).hasPendingActivity()) {
                return true;
            }
        }

        return false;
    }

    pub fn onCloseIO(this: *Subprocess, kind: StdioKind) void {
        switch (kind) {
            .stdin => {
                switch (this.stdin) {
                    .pipe => |pipe| {
                        pipe.signal.clear();
                        pipe.deref();
                        this.stdin = .{ .ignore = {} };
                    },
                    .buffer => {
                        this.stdin.buffer.source.detach();
                        this.stdin.buffer.deref();
                        this.stdin = .{ .ignore = {} };
                    },
                    else => {},
                }
            },
            inline .stdout, .stderr => |tag| {
                const out: *Readable = &@field(this, @tagName(tag));
                switch (out.*) {
                    .pipe => |pipe| {
                        if (pipe.state == .done) {
                            out.* = .{ .buffer = pipe.state.done };
                            pipe.state = .{ .done = &.{} };
                        } else {
                            out.* = .{ .ignore = {} };
                        }
                        pipe.deref();
                    },
                    else => {},
                }
            },
        }
    }

    pub fn hasPendingActivity(this: *Subprocess) callconv(.C) bool {
        @fence(.acquire);
        return this.has_pending_activity.load(.acquire);
    }

    pub fn jsRef(this: *Subprocess) void {
        this.process.enableKeepingEventLoopAlive();

        if (!this.hasCalledGetter(.stdin)) {
            this.stdin.ref();
        }

        if (!this.hasCalledGetter(.stdout)) {
            this.stdout.ref();
        }

        if (!this.hasCalledGetter(.stderr)) {
            this.stderr.ref();
        }

        this.updateHasPendingActivity();
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub fn jsUnref(this: *Subprocess) void {
        this.process.disableKeepingEventLoopAlive();

        if (!this.hasCalledGetter(.stdin)) {
            this.stdin.unref();
        }

        if (!this.hasCalledGetter(.stdout)) {
            this.stdout.unref();
        }

        if (!this.hasCalledGetter(.stderr)) {
            this.stderr.unref();
        }

        this.updateHasPendingActivity();
    }

    pub fn constructor(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!*Subprocess {
        return globalObject.throw2("Cannot construct Subprocess", .{});
    }

    const Readable = union(enum) {
        fd: bun.FileDescriptor,
        memfd: bun.FileDescriptor,
        pipe: *PipeReader,
        inherit: void,
        ignore: void,
        closed: void,
        buffer: []u8,

        pub fn hasPendingActivity(this: *const Readable) bool {
            return switch (this.*) {
                .pipe => this.pipe.hasPendingActivity(),
                else => false,
            };
        }

        pub fn ref(this: *Readable) void {
            switch (this.*) {
                .pipe => {
                    this.pipe.updateRef(true);
                },
                else => {},
            }
        }

        pub fn unref(this: *Readable) void {
            switch (this.*) {
                .pipe => {
                    this.pipe.updateRef(false);
                },
                else => {},
            }
        }

        pub fn init(stdio: Stdio, event_loop: *JSC.EventLoop, process: *Subprocess, result: StdioResult, allocator: std.mem.Allocator, max_size: u32, is_sync: bool) Readable {
            _ = allocator; // autofix
            _ = max_size; // autofix
            _ = is_sync; // autofix
            assertStdioResult(result);

            if (Environment.isWindows) {
                return switch (stdio) {
                    .inherit => Readable{ .inherit = {} },
                    .ignore, .ipc, .path, .memfd => Readable{ .ignore = {} },
                    .fd => |fd| Readable{ .fd = fd },
                    .dup2 => |dup2| Readable{ .fd = dup2.out.toFd() },
                    .pipe => Readable{ .pipe = PipeReader.create(event_loop, process, result) },
                    .array_buffer, .blob => Output.panic("TODO: implement ArrayBuffer & Blob support in Stdio readable", .{}),
                    .capture => Output.panic("TODO: implement capture support in Stdio readable", .{}),
                };
            }

            if (comptime Environment.isPosix) {
                if (stdio == .pipe) {
                    _ = bun.sys.setNonblocking(result.?);
                }
            }

            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ignore, .ipc, .path => Readable{ .ignore = {} },
                .fd => Readable{ .fd = result.? },
                .memfd => Readable{ .memfd = stdio.memfd },
                .pipe => Readable{ .pipe = PipeReader.create(event_loop, process, result) },
                .array_buffer, .blob => Output.panic("TODO: implement ArrayBuffer & Blob support in Stdio readable", .{}),
                .capture => Output.panic("TODO: implement capture support in Stdio readable", .{}),
                .dup2 => Output.panic("TODO: implement dup2 support in Stdio readable", .{}),
            };
        }

        pub fn onClose(this: *Readable, _: ?bun.sys.Error) void {
            this.* = .closed;
        }

        pub fn onReady(_: *Readable, _: ?JSC.WebCore.Blob.SizeType, _: ?JSC.WebCore.Blob.SizeType) void {}

        pub fn onStart(_: *Readable) void {}

        pub fn close(this: *Readable) void {
            switch (this.*) {
                inline .memfd, .fd => |fd| {
                    this.* = .{ .closed = {} };
                    _ = bun.sys.close(fd);
                },
                .pipe => {
                    this.pipe.close();
                },
                else => {},
            }
        }

        pub fn finalize(this: *Readable) void {
            switch (this.*) {
                inline .memfd, .fd => |fd| {
                    this.* = .{ .closed = {} };
                    _ = bun.sys.close(fd);
                },
                .pipe => |pipe| {
                    defer pipe.detach();
                    this.* = .{ .closed = {} };
                },
                else => {},
            }
        }

        pub fn toJS(this: *Readable, globalThis: *JSC.JSGlobalObject, exited: bool) JSValue {
            _ = exited; // autofix
            switch (this.*) {
                // should only be reachable when the entire output is buffered.
                .memfd => return this.toBufferedValue(globalThis),

                .fd => |fd| {
                    return fd.toJS(globalThis);
                },
                .pipe => |pipe| {
                    defer pipe.detach();
                    this.* = .{ .closed = {} };
                    return pipe.toJS(globalThis);
                },
                .buffer => |buffer| {
                    defer this.* = .{ .closed = {} };

                    if (buffer.len == 0) {
                        return JSC.WebCore.ReadableStream.empty(globalThis);
                    }

                    const blob = JSC.WebCore.Blob.init(buffer, bun.default_allocator, globalThis);
                    return JSC.WebCore.ReadableStream.fromBlob(globalThis, &blob, 0);
                },
                else => {
                    return JSValue.jsUndefined();
                },
            }
        }

        pub fn toBufferedValue(this: *Readable, globalThis: *JSC.JSGlobalObject) JSValue {
            switch (this.*) {
                .fd => |fd| {
                    return fd.toJS(globalThis);
                },
                .memfd => |fd| {
                    if (comptime !Environment.isPosix) {
                        Output.panic("memfd is only supported on Linux", .{});
                    }
                    this.* = .{ .closed = {} };
                    return JSC.ArrayBuffer.toJSBufferFromMemfd(fd, globalThis);
                },
                .pipe => |pipe| {
                    defer pipe.detach();
                    this.* = .{ .closed = {} };
                    return pipe.toBuffer(globalThis);
                },
                .buffer => |buf| {
                    this.* = .{ .closed = {} };

                    return JSC.MarkedArrayBuffer.fromBytes(buf, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
                },
                else => {
                    return JSValue.jsUndefined();
                },
            }
        }
    };

    pub fn getStderr(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) JSValue {
        this.observable_getters.insert(.stderr);
        return this.stderr.toJS(globalThis, this.hasExited());
    }

    pub fn getStdin(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) JSValue {
        this.observable_getters.insert(.stdin);
        return this.stdin.toJS(globalThis, this);
    }

    pub fn getStdout(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) JSValue {
        this.observable_getters.insert(.stdout);
        return this.stdout.toJS(globalThis, this.hasExited());
    }

    pub fn asyncDispose(
        this: *Subprocess,
        global: *JSGlobalObject,
        _: *JSC.CallFrame,
    ) bun.JSError!JSValue {
        if (this.process.hasExited()) {
            // rely on GC to clean everything up in this case
            return .undefined;
        }

        // unref streams so that this disposed process will not prevent
        // the process from exiting causing a hang
        this.stdin.unref();
        this.stdout.unref();
        this.stderr.unref();

        switch (this.tryKill(SignalCode.default)) {
            .result => {},
            .err => |err| {
                // Signal 9 should always be fine, but just in case that somehow fails.
                global.throwValue(err.toJSC(global));
                return .zero;
            },
        }

        return this.getExited(global);
    }

    pub fn kill(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSValue {
        this.this_jsvalue = callframe.this();

        var arguments = callframe.arguments_old(1);
        // If signal is 0, then no actual signal is sent, but error checking
        // is still performed.
        const sig: i32 = brk: {
            if (arguments.ptr[0].getNumber()) |sig64| {
                // Node does this:
                if (std.math.isNan(sig64)) {
                    break :brk SignalCode.default;
                }

                // This matches node behavior, minus some details with the error messages: https://gist.github.com/Jarred-Sumner/23ba38682bf9d84dff2f67eb35c42ab6
                if (std.math.isInf(sig64) or @trunc(sig64) != sig64) {
                    return globalThis.throwInvalidArguments("Unknown signal", .{});
                }

                if (sig64 < 0) {
                    return globalThis.throwInvalidArguments("Invalid signal: must be >= 0", .{});
                }

                if (sig64 > 31) {
                    return globalThis.throwInvalidArguments("Invalid signal: must be < 32", .{});
                }

                break :brk @intFromFloat(sig64);
            } else if (arguments.ptr[0].isString()) {
                if (arguments.ptr[0].asString().length() == 0) {
                    break :brk SignalCode.default;
                }
                const signal_code = try arguments.ptr[0].toEnum(globalThis, "signal", SignalCode);
                break :brk @intFromEnum(signal_code);
            } else if (!arguments.ptr[0].isEmptyOrUndefinedOrNull()) {
                return globalThis.throwInvalidArguments("Invalid signal: must be a string or an integer", .{});
            }

            break :brk SignalCode.default;
        };

        if (globalThis.hasException()) return .zero;

        switch (this.tryKill(sig)) {
            .result => {},
            .err => |err| {
                // EINVAL or ENOSYS means the signal is not supported in the current platform (most likely unsupported on windows)
                globalThis.throwValue(err.toJSC(globalThis));
                return .zero;
            },
        }

        return JSValue.jsUndefined();
    }

    pub fn hasKilled(this: *const Subprocess) bool {
        return this.process.hasKilled();
    }

    pub fn tryKill(this: *Subprocess, sig: i32) JSC.Maybe(void) {
        if (this.hasExited()) {
            return .{ .result = {} };
        }
        return this.process.kill(@intCast(sig));
    }

    fn hasCalledGetter(this: *Subprocess, comptime getter: @Type(.EnumLiteral)) bool {
        return this.observable_getters.contains(getter);
    }

    fn closeProcess(this: *Subprocess) void {
        if (comptime !Environment.isLinux) {
            return;
        }
        this.process.close();
    }

    pub fn doRef(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        this.jsRef();
        return .undefined;
    }

    pub fn doUnref(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        this.jsUnref();
        return .undefined;
    }

    pub fn onStdinDestroyed(this: *Subprocess) void {
        const must_deref = this.flags.deref_on_stdin_destroyed;
        this.flags.deref_on_stdin_destroyed = false;
        defer if (must_deref) this.deref();

        this.flags.has_stdin_destructor_called = true;
        this.weak_file_sink_stdin_ptr = null;

        if (!this.flags.finalized) {
            // otherwise update the pending activity flag
            this.updateHasPendingActivity();
        }
    }

    pub fn doSend(this: *Subprocess, global: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
        IPClog("Subprocess#doSend", .{});
        const ipc_data = &(this.ipc_data orelse {
            if (this.hasExited()) {
                global.throw("Subprocess.send() cannot be used after the process has exited.", .{});
            } else {
                global.throw("Subprocess.send() can only be used if an IPC channel is open.", .{});
            }
            return .zero;
        });

        if (callFrame.argumentsCount() == 0) {
            return global.throwInvalidArguments("Subprocess.send() requires one argument", .{});
        }

        const value = callFrame.argument(0);

        const success = ipc_data.serializeAndSend(global, value);
        if (!success) return .zero;

        return .undefined;
    }
    pub fn disconnectIPC(this: *Subprocess, nextTick: bool) void {
        const ipc_data = this.ipc() orelse return;
        ipc_data.close(nextTick);
    }
    pub fn disconnect(this: *Subprocess, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        _ = globalThis;
        _ = callframe;
        this.disconnectIPC(true);
        return .undefined;
    }

    pub fn getConnected(this: *Subprocess, globalThis: *JSGlobalObject) JSValue {
        _ = globalThis;
        const ipc_data = this.ipc();
        return JSValue.jsBoolean(ipc_data != null and ipc_data.?.disconnected == false);
    }

    pub fn pid(this: *const Subprocess) i32 {
        return @intCast(this.process.pid);
    }

    pub fn getPid(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) JSValue {
        return JSValue.jsNumber(this.pid());
    }

    pub fn getKilled(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) JSValue {
        return JSValue.jsBoolean(this.hasKilled());
    }

    pub fn getStdio(
        this: *Subprocess,
        global: *JSGlobalObject,
    ) JSValue {
        const array = JSValue.createEmptyArray(global, 0);
        array.push(global, .null);
        array.push(global, .null); // TODO: align this with options
        array.push(global, .null); // TODO: align this with options

        this.observable_getters.insert(.stdio);
        var pipes = this.stdio_pipes.items;
        if (this.ipc_data != null) {
            array.push(global, .null);
            pipes = pipes[@min(1, pipes.len)..];
        }

        for (pipes) |item| {
            if (Environment.isWindows) {
                if (item == .buffer) {
                    const fdno: usize = @intFromPtr(item.buffer.fd().cast());
                    array.push(global, JSValue.jsNumber(fdno));
                }
            } else {
                array.push(global, JSValue.jsNumber(item.cast()));
            }
        }
        return array;
    }

    pub const Source = union(enum) {
        blob: JSC.WebCore.AnyBlob,
        array_buffer: JSC.ArrayBuffer.Strong,
        detached: void,

        pub fn slice(this: *const Source) []const u8 {
            return switch (this.*) {
                .blob => this.blob.slice(),
                .array_buffer => this.array_buffer.slice(),
                else => @panic("Invalid source"),
            };
        }

        pub fn detach(this: *@This()) void {
            switch (this.*) {
                .blob => {
                    this.blob.detach();
                },
                .array_buffer => {
                    this.array_buffer.deinit();
                },
                else => {},
            }
            this.* = .detached;
        }
    };

    pub const StaticPipeWriter = NewStaticPipeWriter(Subprocess);

    pub fn NewStaticPipeWriter(comptime ProcessType: type) type {
        return struct {
            writer: IOWriter = .{},
            stdio_result: StdioResult,
            source: Source = .{ .detached = {} },
            process: *ProcessType = undefined,
            event_loop: JSC.EventLoopHandle,
            ref_count: u32 = 1,
            buffer: []const u8 = "",

            pub usingnamespace bun.NewRefCounted(@This(), @This().deinit);
            const This = @This();
            const print = bun.Output.scoped(.StaticPipeWriter, false);

            pub const IOWriter = bun.io.BufferedWriter(
                This,
                onWrite,
                onError,
                onClose,
                getBuffer,
                flush,
            );
            pub const Poll = IOWriter;

            pub fn updateRef(this: *This, add: bool) void {
                this.writer.updateRef(this.event_loop, add);
            }

            pub fn getBuffer(this: *This) []const u8 {
                return this.buffer;
            }

            pub fn close(this: *This) void {
                log("StaticPipeWriter(0x{x}) close()", .{@intFromPtr(this)});
                this.writer.close();
            }

            pub fn flush(this: *This) void {
                if (this.buffer.len > 0)
                    this.writer.write();
            }

            pub fn create(event_loop: anytype, subprocess: *ProcessType, result: StdioResult, source: Source) *This {
                const this = This.new(.{
                    .event_loop = JSC.EventLoopHandle.init(event_loop),
                    .process = subprocess,
                    .stdio_result = result,
                    .source = source,
                });
                if (Environment.isWindows) {
                    this.writer.setPipe(this.stdio_result.buffer);
                }
                this.writer.setParent(this);
                return this;
            }

            pub fn start(this: *This) JSC.Maybe(void) {
                log("StaticPipeWriter(0x{x}) start()", .{@intFromPtr(this)});
                this.ref();
                this.buffer = this.source.slice();
                if (Environment.isWindows) {
                    return this.writer.startWithCurrentPipe();
                }
                switch (this.writer.start(this.stdio_result.?, true)) {
                    .err => |err| {
                        return .{ .err = err };
                    },
                    .result => {
                        if (comptime Environment.isPosix) {
                            const poll = this.writer.handle.poll;
                            poll.flags.insert(.socket);
                        }

                        return .{ .result = {} };
                    },
                }
            }

            pub fn onWrite(this: *This, amount: usize, status: bun.io.WriteStatus) void {
                log("StaticPipeWriter(0x{x}) onWrite(amount={d} {})", .{ @intFromPtr(this), amount, status });
                this.buffer = this.buffer[@min(amount, this.buffer.len)..];
                if (status == .end_of_file or this.buffer.len == 0) {
                    this.writer.close();
                }
            }

            pub fn onError(this: *This, err: bun.sys.Error) void {
                log("StaticPipeWriter(0x{x}) onError(err={any})", .{ @intFromPtr(this), err });
                this.source.detach();
            }

            pub fn onClose(this: *This) void {
                log("StaticPipeWriter(0x{x}) onClose()", .{@intFromPtr(this)});
                this.source.detach();
                this.process.onCloseIO(.stdin);
            }

            pub fn deinit(this: *This) void {
                this.writer.end();
                this.source.detach();
                this.destroy();
            }

            pub fn loop(this: *This) *uws.Loop {
                return this.event_loop.loop();
            }

            pub fn watch(this: *This) void {
                if (this.buffer.len > 0) {
                    this.writer.watch();
                }
            }

            pub fn eventLoop(this: *This) JSC.EventLoopHandle {
                return this.event_loop;
            }
        };
    }

    pub const PipeReader = struct {
        reader: IOReader = undefined,
        process: ?*Subprocess = null,
        event_loop: *JSC.EventLoop = undefined,
        ref_count: u32 = 1,
        state: union(enum) {
            pending: void,
            done: []u8,
            err: bun.sys.Error,
        } = .{ .pending = {} },
        stdio_result: StdioResult,

        pub const IOReader = bun.io.BufferedReader;
        pub const Poll = IOReader;

        pub usingnamespace bun.NewRefCounted(PipeReader, PipeReader.deinit);

        pub fn hasPendingActivity(this: *const PipeReader) bool {
            if (this.state == .pending)
                return true;

            return this.reader.hasPendingActivity();
        }

        pub fn detach(this: *PipeReader) void {
            this.process = null;
            this.deref();
        }

        pub fn create(event_loop: *JSC.EventLoop, process: *Subprocess, result: StdioResult) *PipeReader {
            var this = PipeReader.new(.{
                .process = process,
                .reader = IOReader.init(@This()),
                .event_loop = event_loop,
                .stdio_result = result,
            });
            if (Environment.isWindows) {
                this.reader.source = .{ .pipe = this.stdio_result.buffer };
            }
            this.reader.setParent(this);
            return this;
        }

        pub fn readAll(this: *PipeReader) void {
            if (this.state == .pending)
                this.reader.read();
        }

        pub fn start(this: *PipeReader, process: *Subprocess, event_loop: *JSC.EventLoop) JSC.Maybe(void) {
            this.ref();
            this.process = process;
            this.event_loop = event_loop;
            if (Environment.isWindows) {
                return this.reader.startWithCurrentPipe();
            }

            switch (this.reader.start(this.stdio_result.?, true)) {
                .err => |err| {
                    return .{ .err = err };
                },
                .result => {
                    if (comptime Environment.isPosix) {
                        const poll = this.reader.handle.poll;
                        poll.flags.insert(.socket);
                        this.reader.flags.socket = true;
                    }

                    return .{ .result = {} };
                },
            }
        }

        pub const toJS = toReadableStream;

        pub fn onReaderDone(this: *PipeReader) void {
            const owned = this.toOwnedSlice();
            this.state = .{ .done = owned };
            if (this.process) |process| {
                this.process = null;
                process.onCloseIO(this.kind(process));
                this.deref();
            }
        }

        pub fn kind(reader: *const PipeReader, process: *const Subprocess) StdioKind {
            if (process.stdout == .pipe and process.stdout.pipe == reader) {
                return .stdout;
            }

            if (process.stderr == .pipe and process.stderr.pipe == reader) {
                return .stderr;
            }

            @panic("We should be either stdout or stderr");
        }

        pub fn toOwnedSlice(this: *PipeReader) []u8 {
            if (this.state == .done) {
                return this.state.done;
            }
            // we do not use .toOwnedSlice() because we don't want to reallocate memory.
            const out = this.reader._buffer;
            this.reader._buffer.items = &.{};
            this.reader._buffer.capacity = 0;
            return out.items;
        }

        pub fn updateRef(this: *PipeReader, add: bool) void {
            this.reader.updateRef(add);
        }

        pub fn watch(this: *PipeReader) void {
            if (!this.reader.isDone())
                this.reader.watch();
        }

        pub fn toReadableStream(this: *PipeReader, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            defer this.detach();

            switch (this.state) {
                .pending => {
                    const stream = JSC.WebCore.ReadableStream.fromPipe(globalObject, this, &this.reader);
                    this.state = .{ .done = &.{} };
                    return stream;
                },
                .done => |bytes| {
                    const blob = JSC.WebCore.Blob.init(bytes, bun.default_allocator, globalObject);
                    this.state = .{ .done = &.{} };
                    return JSC.WebCore.ReadableStream.fromBlob(globalObject, &blob, 0);
                },
                .err => |err| {
                    _ = err; // autofix
                    const empty = JSC.WebCore.ReadableStream.empty(globalObject);
                    JSC.WebCore.ReadableStream.cancel(&JSC.WebCore.ReadableStream.fromJS(empty, globalObject).?, globalObject);
                    return empty;
                },
            }
        }

        pub fn toBuffer(this: *PipeReader, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
            switch (this.state) {
                .done => |bytes| {
                    defer this.state = .{ .done = &.{} };
                    return JSC.MarkedArrayBuffer.fromBytes(bytes, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
                },
                else => {
                    return JSC.JSValue.undefined;
                },
            }
        }

        pub fn onReaderError(this: *PipeReader, err: bun.sys.Error) void {
            if (this.state == .done) {
                bun.default_allocator.free(this.state.done);
            }
            this.state = .{ .err = err };
            if (this.process) |process|
                process.onCloseIO(this.kind(process));
        }

        pub fn close(this: *PipeReader) void {
            switch (this.state) {
                .pending => {
                    this.reader.close();
                },
                .done => {},
                .err => {},
            }
        }

        pub fn eventLoop(this: *PipeReader) *JSC.EventLoop {
            return this.event_loop;
        }

        pub fn loop(this: *PipeReader) *uws.Loop {
            return this.event_loop.virtual_machine.uwsLoop();
        }

        fn deinit(this: *PipeReader) void {
            if (comptime Environment.isPosix) {
                bun.assert(this.reader.isDone());
            }

            if (comptime Environment.isWindows) {
                bun.assert(this.reader.source == null or this.reader.source.?.isClosed());
            }

            if (this.state == .done) {
                bun.default_allocator.free(this.state.done);
            }

            this.reader.deinit();
            this.destroy();
        }
    };

    const Writable = union(enum) {
        pipe: *JSC.WebCore.FileSink,
        fd: bun.FileDescriptor,
        buffer: *StaticPipeWriter,
        memfd: bun.FileDescriptor,
        inherit: void,
        ignore: void,

        pub fn hasPendingActivity(this: *const Writable) bool {
            return switch (this.*) {
                .pipe => false,

                // we mark them as .ignore when they are closed, so this must be true
                .buffer => true,
                else => false,
            };
        }

        pub fn ref(this: *Writable) void {
            switch (this.*) {
                .pipe => {
                    this.pipe.updateRef(true);
                },
                .buffer => {
                    this.buffer.updateRef(true);
                },
                else => {},
            }
        }

        pub fn unref(this: *Writable) void {
            switch (this.*) {
                .pipe => {
                    this.pipe.updateRef(false);
                },
                .buffer => {
                    this.buffer.updateRef(false);
                },
                else => {},
            }
        }

        // When the stream has closed we need to be notified to prevent a use-after-free
        // We can test for this use-after-free by enabling hot module reloading on a file and then saving it twice
        pub fn onClose(this: *Writable, _: ?bun.sys.Error) void {
            const process: *Subprocess = @fieldParentPtr("stdin", this);

            if (process.this_jsvalue != .zero) {
                if (Subprocess.stdinGetCached(process.this_jsvalue)) |existing_value| {
                    JSC.WebCore.FileSink.JSSink.setDestroyCallback(existing_value, 0);
                }
            }

            switch (this.*) {
                .buffer => {
                    this.buffer.deref();
                },
                .pipe => {
                    this.pipe.deref();
                },
                else => {},
            }

            process.onStdinDestroyed();

            this.* = .{
                .ignore = {},
            };
        }
        pub fn onReady(_: *Writable, _: ?JSC.WebCore.Blob.SizeType, _: ?JSC.WebCore.Blob.SizeType) void {}
        pub fn onStart(_: *Writable) void {}

        pub fn init(
            stdio: Stdio,
            event_loop: *JSC.EventLoop,
            subprocess: *Subprocess,
            result: StdioResult,
        ) !Writable {
            assertStdioResult(result);

            if (Environment.isWindows) {
                switch (stdio) {
                    .pipe => {
                        if (result == .buffer) {
                            const pipe = JSC.WebCore.FileSink.createWithPipe(event_loop, result.buffer);

                            switch (pipe.writer.startWithCurrentPipe()) {
                                .result => {},
                                .err => |err| {
                                    _ = err; // autofix
                                    pipe.deref();
                                    return error.UnexpectedCreatingStdin;
                                },
                            }
                            pipe.writer.setParent(pipe);
                            subprocess.weak_file_sink_stdin_ptr = pipe;
                            subprocess.ref();
                            subprocess.flags.deref_on_stdin_destroyed = true;
                            subprocess.flags.has_stdin_destructor_called = false;

                            return Writable{
                                .pipe = pipe,
                            };
                        }
                        return Writable{ .inherit = {} };
                    },

                    .blob => |blob| {
                        return Writable{
                            .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .blob = blob }),
                        };
                    },
                    .array_buffer => |array_buffer| {
                        return Writable{
                            .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .array_buffer = array_buffer }),
                        };
                    },
                    .fd => |fd| {
                        return Writable{ .fd = fd };
                    },
                    .dup2 => |dup2| {
                        return Writable{ .fd = dup2.to.toFd() };
                    },
                    .inherit => {
                        return Writable{ .inherit = {} };
                    },
                    .memfd, .path, .ignore => {
                        return Writable{ .ignore = {} };
                    },
                    .ipc, .capture => {
                        return Writable{ .ignore = {} };
                    },
                }
            }

            if (comptime Environment.isPosix) {
                if (stdio == .pipe) {
                    _ = bun.sys.setNonblocking(result.?);
                }
            }

            switch (stdio) {
                .dup2 => @panic("TODO dup2 stdio"),
                .pipe => {
                    const pipe = JSC.WebCore.FileSink.create(event_loop, result.?);

                    switch (pipe.writer.start(pipe.fd, true)) {
                        .result => {},
                        .err => |err| {
                            _ = err; // autofix
                            pipe.deref();
                            return error.UnexpectedCreatingStdin;
                        },
                    }

                    subprocess.weak_file_sink_stdin_ptr = pipe;
                    subprocess.ref();
                    subprocess.flags.has_stdin_destructor_called = false;
                    subprocess.flags.deref_on_stdin_destroyed = true;

                    pipe.writer.handle.poll.flags.insert(.socket);

                    return Writable{
                        .pipe = pipe,
                    };
                },

                .blob => |blob| {
                    return Writable{
                        .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .blob = blob }),
                    };
                },
                .array_buffer => |array_buffer| {
                    return Writable{
                        .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .array_buffer = array_buffer }),
                    };
                },
                .memfd => |memfd| {
                    bun.assert(memfd != bun.invalid_fd);
                    return Writable{ .memfd = memfd };
                },
                .fd => {
                    return Writable{ .fd = result.? };
                },
                .inherit => {
                    return Writable{ .inherit = {} };
                },
                .path, .ignore => {
                    return Writable{ .ignore = {} };
                },
                .ipc, .capture => {
                    return Writable{ .ignore = {} };
                },
            }
        }

        pub fn toJS(this: *Writable, globalThis: *JSC.JSGlobalObject, subprocess: *Subprocess) JSValue {
            return switch (this.*) {
                .fd => |fd| fd.toJS(globalThis),
                .memfd, .ignore => JSValue.jsUndefined(),
                .buffer, .inherit => JSValue.jsUndefined(),
                .pipe => |pipe| {
                    this.* = .{ .ignore = {} };
                    if (subprocess.process.hasExited() and !subprocess.flags.has_stdin_destructor_called) {
                        // onAttachedProcessExit() can call deref on the
                        // subprocess. Since we never called ref(), it would be
                        // unbalanced to do so, leading to a use-after-free.
                        // So, let's not do that.
                        // https://github.com/oven-sh/bun/pull/14092
                        bun.debugAssert(!subprocess.flags.deref_on_stdin_destroyed);
                        const debug_ref_count: if (Environment.isDebug) u32 else u0 = if (Environment.isDebug) subprocess.ref_count else 0;
                        pipe.onAttachedProcessExit();
                        if (comptime Environment.isDebug) {
                            bun.debugAssert(subprocess.ref_count == debug_ref_count);
                        }
                        return pipe.toJS(globalThis);
                    } else {
                        subprocess.flags.has_stdin_destructor_called = false;
                        subprocess.weak_file_sink_stdin_ptr = pipe;
                        subprocess.ref();
                        subprocess.flags.deref_on_stdin_destroyed = true;
                        if (@intFromPtr(pipe.signal.ptr) == @intFromPtr(subprocess)) {
                            pipe.signal.clear();
                        }
                        return pipe.toJSWithDestructor(
                            globalThis,
                            JSC.WebCore.SinkDestructor.Ptr.init(subprocess),
                        );
                    }
                },
            };
        }

        pub fn finalize(this: *Writable) void {
            const subprocess: *Subprocess = @fieldParentPtr("stdin", this);
            if (subprocess.this_jsvalue != .zero) {
                if (JSC.Codegen.JSSubprocess.stdinGetCached(subprocess.this_jsvalue)) |existing_value| {
                    JSC.WebCore.FileSink.JSSink.setDestroyCallback(existing_value, 0);
                }
            }

            return switch (this.*) {
                .pipe => |pipe| {
                    if (pipe.signal.ptr == @as(*anyopaque, @ptrCast(this))) {
                        pipe.signal.clear();
                    }

                    pipe.deref();

                    this.* = .{ .ignore = {} };
                },
                .buffer => {
                    this.buffer.updateRef(false);
                    this.buffer.deref();
                },
                .memfd => |fd| {
                    _ = bun.sys.close(fd);
                    this.* = .{ .ignore = {} };
                },
                .ignore => {},
                .fd, .inherit => {},
            };
        }

        pub fn close(this: *Writable) void {
            switch (this.*) {
                .pipe => |pipe| {
                    _ = pipe.end(null);
                },
                inline .memfd, .fd => |fd| {
                    _ = bun.sys.close(fd);
                    this.* = .{ .ignore = {} };
                },
                .buffer => {
                    this.buffer.close();
                },
                .ignore => {},
                .inherit => {},
            }
        }
    };

    pub fn onProcessExit(this: *Subprocess, process: *Process, status: bun.spawn.Status, rusage: *const Rusage) void {
        log("onProcessExit()", .{});
        const this_jsvalue = this.this_jsvalue;
        const globalThis = this.globalThis;
        const jsc_vm = globalThis.bunVM();
        this_jsvalue.ensureStillAlive();
        this.pid_rusage = rusage.*;
        const is_sync = this.flags.is_sync;
        this.clearAbortSignal();
        defer this.deref();
        defer this.disconnectIPC(true);

        jsc_vm.onSubprocessExit(process);

        var stdin: ?*JSC.WebCore.FileSink = this.weak_file_sink_stdin_ptr;
        var existing_stdin_value = JSC.JSValue.zero;
        if (this_jsvalue != .zero) {
            if (JSC.Codegen.JSSubprocess.stdinGetCached(this_jsvalue)) |existing_value| {
                if (existing_stdin_value.isCell()) {
                    if (stdin == null) {
                        stdin = @as(?*JSC.WebCore.FileSink, @alignCast(@ptrCast(JSC.WebCore.FileSink.JSSink.fromJS(globalThis, existing_value))));
                    }

                    existing_stdin_value = existing_value;
                }
            }
        }

        if (this.stdin == .buffer) {
            this.stdin.buffer.close();
        }

        if (existing_stdin_value != .zero) {
            JSC.WebCore.FileSink.JSSink.setDestroyCallback(existing_stdin_value, 0);
        }

        if (stdin) |pipe| {
            this.weak_file_sink_stdin_ptr = null;
            this.flags.has_stdin_destructor_called = true;
            // It is okay if it does call deref() here, as in that case it was truly ref'd.
            pipe.onAttachedProcessExit();
        }

        var did_update_has_pending_activity = false;
        defer if (!did_update_has_pending_activity) this.updateHasPendingActivity();

        const loop = jsc_vm.eventLoop();

        if (!is_sync) {
            if (this.exit_promise.trySwap()) |promise| {
                loop.enter();
                defer loop.exit();

                if (!did_update_has_pending_activity) {
                    this.updateHasPendingActivity();
                    did_update_has_pending_activity = true;
                }

                switch (status) {
                    .exited => |exited| promise.asAnyPromise().?.resolve(globalThis, JSValue.jsNumber(exited.code)),
                    .err => |err| promise.asAnyPromise().?.reject(globalThis, err.toJSC(globalThis)),
                    .signaled => promise.asAnyPromise().?.resolve(globalThis, JSValue.jsNumber(128 +% @intFromEnum(status.signaled))),
                    else => {
                        // crash in debug mode
                        if (comptime Environment.allow_assert)
                            unreachable;
                    },
                }
            }

            if (this.on_exit_callback.trySwap()) |callback| {
                const waitpid_value: JSValue =
                    if (status == .err)
                    status.err.toJSC(globalThis)
                else
                    .undefined;

                const this_value = if (this_jsvalue.isEmptyOrUndefinedOrNull()) .undefined else this_jsvalue;
                this_value.ensureStillAlive();

                const args = [_]JSValue{
                    this_value,
                    this.getExitCode(globalThis),
                    this.getSignalCode(globalThis),
                    waitpid_value,
                };

                if (!did_update_has_pending_activity) {
                    this.updateHasPendingActivity();
                    did_update_has_pending_activity = true;
                }

                loop.runCallback(
                    callback,
                    globalThis,
                    this_value,
                    &args,
                );
            }
        }
    }

    fn closeIO(this: *Subprocess, comptime io: @Type(.EnumLiteral)) void {
        if (this.closed.contains(io)) return;
        this.closed.insert(io);

        // If you never referenced stdout/stderr, they won't be garbage collected.
        //
        // That means:
        //   1. We need to stop watching them
        //   2. We need to free the memory
        //   3. We need to halt any pending reads (1)

        if (!this.hasCalledGetter(io)) {
            @field(this, @tagName(io)).finalize();
        } else {
            @field(this, @tagName(io)).close();
        }
    }

    fn onPipeClose(this: *uv.Pipe) callconv(.C) void {
        // safely free the pipes
        bun.default_allocator.destroy(this);
    }

    // This must only be run once per Subprocess
    pub fn finalizeStreams(this: *Subprocess) void {
        log("finalizeStreams", .{});
        this.closeProcess();

        this.closeIO(.stdin);
        this.closeIO(.stdout);
        this.closeIO(.stderr);

        close_stdio_pipes: {
            if (!this.observable_getters.contains(.stdio)) {
                break :close_stdio_pipes;
            }

            for (this.stdio_pipes.items) |item| {
                if (Environment.isWindows) {
                    if (item == .buffer) {
                        item.buffer.close(onPipeClose);
                    }
                } else {
                    _ = bun.sys.close(item);
                }
            }
            this.stdio_pipes.clearAndFree(bun.default_allocator);
        }

        this.exit_promise.deinit();
        this.on_exit_callback.deinit();
        this.on_disconnect_callback.deinit();
    }

    pub fn deinit(this: *Subprocess) void {
        log("deinit", .{});
        this.destroy();
    }

    fn clearAbortSignal(this: *Subprocess) void {
        if (this.abort_signal) |signal| {
            this.abort_signal = null;
            signal.pendingActivityUnref();
            signal.cleanNativeBindings(this);
            signal.unref();
        }
    }

    pub fn finalize(this: *Subprocess) callconv(.C) void {
        log("finalize", .{});
        // Ensure any code which references the "this" value doesn't attempt to
        // access it after it's been freed We cannot call any methods which
        // access GC'd values during the finalizer
        this.this_jsvalue = .zero;

        this.clearAbortSignal();

        bun.assert(!this.hasPendingActivity() or JSC.VirtualMachine.get().isShuttingDown());
        this.finalizeStreams();

        this.process.detach();
        this.process.deref();

        this.flags.finalized = true;
        this.deref();
    }

    pub fn getExited(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) JSValue {
        switch (this.process.status) {
            .exited => |exit| {
                return JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(exit.code));
            },
            .signaled => |signal| {
                return JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(signal.toExitCode() orelse 254));
            },
            .err => |err| {
                return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
            },
            else => {
                if (!this.exit_promise.has()) {
                    this.exit_promise.set(globalThis, JSC.JSPromise.create(globalThis).asValue(globalThis));
                }

                return this.exit_promise.get().?;
            },
        }
    }

    pub fn getExitCode(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) JSValue {
        if (this.process.status == .exited) {
            return JSC.JSValue.jsNumber(this.process.status.exited.code);
        }
        return JSC.JSValue.jsNull();
    }

    pub fn getSignalCode(
        this: *Subprocess,
        global: *JSGlobalObject,
    ) JSValue {
        if (this.process.signalCode()) |signal| {
            if (signal.name()) |name|
                return JSC.ZigString.init(name).toJS(global)
            else
                return JSC.JSValue.jsNumber(@intFromEnum(signal));
        }

        return JSC.JSValue.jsNull();
    }

    pub fn spawn(globalThis: *JSC.JSGlobalObject, args: JSValue, secondaryArgsValue: ?JSValue) bun.JSError!JSValue {
        return spawnMaybeSync(globalThis, args, secondaryArgsValue, false);
    }

    pub fn spawnSync(globalThis: *JSC.JSGlobalObject, args: JSValue, secondaryArgsValue: ?JSValue) bun.JSError!JSValue {
        return spawnMaybeSync(globalThis, args, secondaryArgsValue, true);
    }

    pub fn spawnMaybeSync(
        globalThis: *JSC.JSGlobalObject,
        args_: JSValue,
        secondaryArgsValue: ?JSValue,
        comptime is_sync: bool,
    ) bun.JSError!JSValue {
        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var allocator = arena.allocator();

        var override_env = false;
        var env_array = std.ArrayListUnmanaged(?[*:0]const u8){};
        var jsc_vm = globalThis.bunVM();

        var cwd = jsc_vm.bundler.fs.top_level_dir;

        var stdio = [3]Stdio{
            .{ .ignore = {} },
            .{ .pipe = {} },
            .{ .inherit = {} },
        };

        if (comptime is_sync) {
            stdio[1] = .{ .pipe = {} };
            stdio[2] = .{ .pipe = {} };
        }
        var lazy = false;
        var on_exit_callback = JSValue.zero;
        var on_disconnect_callback = JSValue.zero;
        var PATH = jsc_vm.bundler.env.get("PATH") orelse "";
        var argv = std.ArrayList(?[*:0]const u8).init(allocator);
        var cmd_value = JSValue.zero;
        var detached = false;
        var args = args_;
        var maybe_ipc_mode: if (is_sync) void else ?IPC.Mode = if (is_sync) {} else null;
        var ipc_callback: JSValue = .zero;
        var extra_fds = std.ArrayList(bun.spawn.SpawnOptions.Stdio).init(bun.default_allocator);
        var argv0: ?[*:0]const u8 = null;
        var ipc_channel: i32 = -1;

        var windows_hide: bool = false;
        var windows_verbatim_arguments: bool = false;
        var abort_signal: ?*JSC.WebCore.AbortSignal = null;
        defer {
            // Ensure we clean it up on error.
            if (abort_signal) |signal| {
                signal.unref();
            }
        }

        {
            if (args.isEmptyOrUndefinedOrNull()) {
                return globalThis.throwInvalidArguments("cmd must be an array", .{});
            }

            const args_type = args.jsType();
            if (args_type.isArray()) {
                cmd_value = args;
                args = secondaryArgsValue orelse JSValue.zero;
            } else if (!args.isObject()) {
                return globalThis.throwInvalidArguments("cmd must be an array", .{});
            } else if (try args.getTruthy(globalThis, "cmd")) |cmd_value_| {
                cmd_value = cmd_value_;
            } else {
                return globalThis.throwInvalidArguments("cmd must be an array", .{});
            }

            if (args.isObject()) {
                if (try args.getTruthy(globalThis, "argv0")) |argv0_| {
                    const argv0_str = argv0_.getZigString(globalThis);
                    if (argv0_str.len > 0) {
                        argv0 = argv0_str.toOwnedSliceZ(allocator) catch {
                            globalThis.throwOutOfMemory();
                            return .zero;
                        };
                    }
                }

                // need to update `cwd` before searching for executable with `Which.which`
                if (try args.getTruthy(globalThis, "cwd")) |cwd_| {
                    const cwd_str = cwd_.getZigString(globalThis);
                    if (cwd_str.len > 0) {
                        cwd = cwd_str.toOwnedSliceZ(allocator) catch {
                            globalThis.throwOutOfMemory();
                            return .zero;
                        };
                    }
                }
            }

            {
                var cmds_array = cmd_value.arrayIterator(globalThis);
                // + 1 for argv0
                // + 1 for null terminator
                argv = @TypeOf(argv).initCapacity(allocator, cmds_array.len + 2) catch {
                    globalThis.throwOutOfMemory();
                    return .zero;
                };

                if (cmd_value.isEmptyOrUndefinedOrNull()) {
                    return globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                }

                if (cmds_array.len == 0) {
                    return globalThis.throwInvalidArguments("cmd must not be empty", .{});
                }

                {
                    var first_cmd = cmds_array.next().?;
                    var arg0 = try first_cmd.toSliceOrNullWithAllocator(globalThis, allocator);
                    defer arg0.deinit();

                    if (argv0 == null) {
                        var path_buf: bun.PathBuffer = undefined;
                        const resolved = Which.which(&path_buf, PATH, cwd, arg0.slice()) orelse {
                            return globalThis.throwInvalidArguments("Executable not found in $PATH: \"{s}\"", .{arg0.slice()});
                        };
                        argv0 = allocator.dupeZ(u8, resolved) catch {
                            globalThis.throwOutOfMemory();
                            return .zero;
                        };
                    } else {
                        var path_buf: bun.PathBuffer = undefined;
                        const resolved = Which.which(&path_buf, PATH, cwd, bun.sliceTo(argv0.?, 0)) orelse {
                            return globalThis.throwInvalidArguments("Executable not found in $PATH: \"{s}\"", .{arg0.slice()});
                        };
                        argv0 = allocator.dupeZ(u8, resolved) catch {
                            globalThis.throwOutOfMemory();
                            return .zero;
                        };
                    }

                    argv.appendAssumeCapacity(allocator.dupeZ(u8, arg0.slice()) catch {
                        globalThis.throwOutOfMemory();
                        return .zero;
                    });
                }

                while (cmds_array.next()) |value| {
                    const arg = value.getZigString(globalThis);

                    // if the string is empty, ignore it, don't add it to the argv
                    if (arg.len == 0) {
                        continue;
                    }
                    argv.appendAssumeCapacity(arg.toOwnedSliceZ(allocator) catch {
                        globalThis.throwOutOfMemory();
                        return .zero;
                    });
                }

                if (argv.items.len == 0) {
                    return globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                }
            }

            if (args != .zero and args.isObject()) {
                // This must run before the stdio parsing happens
                if (!is_sync) {
                    if (try args.getTruthy(globalThis, "ipc")) |val| {
                        if (val.isCell() and val.isCallable(globalThis.vm())) {
                            maybe_ipc_mode = ipc_mode: {
                                if (try args.getTruthy(globalThis, "serialization")) |mode_val| {
                                    if (mode_val.isString()) {
                                        break :ipc_mode IPC.Mode.fromJS(globalThis, mode_val) orelse {
                                            if (!globalThis.hasException()) {
                                                return globalThis.throwInvalidArguments("serialization must be \"json\" or \"advanced\"", .{});
                                            }
                                            return error.JSError;
                                        };
                                    } else {
                                        if (!globalThis.hasException()) {
                                            globalThis.throwInvalidArgumentType("spawn", "serialization", "string");
                                        }
                                        return .zero;
                                    }
                                }
                                break :ipc_mode .advanced;
                            };

                            ipc_callback = val.withAsyncContextIfNeeded(globalThis);
                        }
                    }
                }

                if (try args.getTruthy(globalThis, "signal")) |signal_val| {
                    if (signal_val.as(JSC.WebCore.AbortSignal)) |signal| {
                        abort_signal = signal.ref();
                    } else {
                        return globalThis.throwInvalidArgumentTypeValue("signal", "AbortSignal", signal_val);
                    }
                }

                if (try args.getTruthy(globalThis, "onDisconnect")) |onDisconnect_| {
                    if (!onDisconnect_.isCell() or !onDisconnect_.isCallable(globalThis.vm())) {
                        return globalThis.throwInvalidArguments("onDisconnect must be a function or undefined", .{});
                    }

                    on_disconnect_callback = if (comptime is_sync)
                        onDisconnect_
                    else
                        onDisconnect_.withAsyncContextIfNeeded(globalThis);
                }

                if (try args.getTruthy(globalThis, "onExit")) |onExit_| {
                    if (!onExit_.isCell() or !onExit_.isCallable(globalThis.vm())) {
                        return globalThis.throwInvalidArguments("onExit must be a function or undefined", .{});
                    }

                    on_exit_callback = if (comptime is_sync)
                        onExit_
                    else
                        onExit_.withAsyncContextIfNeeded(globalThis);
                }

                if (try args.getTruthy(globalThis, "env")) |object| {
                    if (!object.isObject()) {
                        return globalThis.throwInvalidArguments("env must be an object", .{});
                    }

                    override_env = true;
                    // If the env object does not include a $PATH, it must disable path lookup for argv[0]
                    PATH = "";
                    var envp_managed = env_array.toManaged(allocator);
                    appendEnvpFromJS(globalThis, object, &envp_managed, &PATH) catch {
                        globalThis.throwOutOfMemory();
                        return .zero;
                    };
                    env_array = envp_managed.moveToUnmanaged();
                }
                if (try args.get(globalThis, "stdio")) |stdio_val| {
                    if (!stdio_val.isEmptyOrUndefinedOrNull()) {
                        if (stdio_val.jsType().isArray()) {
                            var stdio_iter = stdio_val.arrayIterator(globalThis);
                            var i: u32 = 0;
                            while (stdio_iter.next()) |value| : (i += 1) {
                                try stdio[i].extract(globalThis, i, value);
                                if (i == 2)
                                    break;
                            }
                            i += 1;

                            while (stdio_iter.next()) |value| : (i += 1) {
                                var new_item: Stdio = undefined;
                                try new_item.extract(globalThis, i, value);

                                const opt = switch (new_item.asSpawnOption(i)) {
                                    .result => |opt| opt,
                                    .err => |e| {
                                        return e.throwJS(globalThis);
                                    },
                                };
                                if (opt == .ipc) {
                                    ipc_channel = @intCast(extra_fds.items.len);
                                }
                                extra_fds.append(opt) catch {
                                    globalThis.throwOutOfMemory();
                                    return .zero;
                                };
                            }
                        } else {
                            return globalThis.throwInvalidArguments("stdio must be an array", .{});
                        }
                    }
                } else {
                    if (try args.get(globalThis, "stdin")) |value| {
                        try stdio[0].extract(globalThis, 0, value);
                    }

                    if (try args.get(globalThis, "stderr")) |value| {
                        try stdio[2].extract(globalThis, 2, value);
                    }

                    if (try args.get(globalThis, "stdout")) |value| {
                        try stdio[1].extract(globalThis, 1, value);
                    }
                }

                if (comptime !is_sync) {
                    if (try args.get(globalThis, "lazy")) |lazy_val| {
                        if (lazy_val.isBoolean()) {
                            lazy = lazy_val.toBoolean();
                        }
                    }
                }

                if (try args.get(globalThis, "detached")) |detached_val| {
                    if (detached_val.isBoolean()) {
                        detached = detached_val.toBoolean();
                    }
                }

                if (Environment.isWindows) {
                    if (try args.get(globalThis, "windowsHide")) |val| {
                        if (val.isBoolean()) {
                            windows_hide = val.asBoolean();
                        }
                    }

                    if (try args.get(globalThis, "windowsVerbatimArguments")) |val| {
                        if (val.isBoolean()) {
                            windows_verbatim_arguments = val.asBoolean();
                        }
                    }
                }
            }
        }

        if (!override_env and env_array.items.len == 0) {
            env_array.items = jsc_vm.bundler.env.map.createNullDelimitedEnvMap(allocator) catch |err| return globalThis.throwError(err, "in Bun.spawn") catch return .zero;
            env_array.capacity = env_array.items.len;
        }

        inline for (0..stdio.len) |fd_index| {
            if (stdio[fd_index].canUseMemfd(is_sync)) {
                stdio[fd_index].useMemfd(fd_index);
            }
        }
        var should_close_memfd = Environment.isLinux;

        defer {
            if (should_close_memfd) {
                inline for (0..stdio.len) |fd_index| {
                    if (stdio[fd_index] == .memfd) {
                        _ = bun.sys.close(stdio[fd_index].memfd);
                        stdio[fd_index] = .ignore;
                    }
                }
            }
        }
        //"NODE_CHANNEL_FD=" is 16 bytes long, 15 bytes for the number, and 1 byte for the null terminator should be enough/safe
        var ipc_env_buf: [32]u8 = undefined;
        if (!is_sync) if (maybe_ipc_mode) |ipc_mode| {
            // IPC is currently implemented in a very limited way.
            //
            // Node lets you pass as many fds as you want, they all become be sockets; then, IPC is just a special
            // runtime-owned version of "pipe" (in which pipe is a misleading name since they're bidirectional sockets).
            //
            // Bun currently only supports three fds: stdin, stdout, and stderr, which are all unidirectional
            //
            // And then one fd is assigned specifically and only for IPC. If the user dont specify it, we add one (default: 3).
            //
            // When Bun.spawn() is given an `.ipc` callback, it enables IPC as follows:
            env_array.ensureUnusedCapacity(allocator, 3) catch |err| return globalThis.throwError(err, "in Bun.spawn") catch return .zero;
            const ipc_fd: u32 = brk: {
                if (ipc_channel == -1) {
                    // If the user didn't specify an IPC channel, we need to add one
                    ipc_channel = @intCast(extra_fds.items.len);
                    var ipc_extra_fd_default = Stdio{ .ipc = {} };
                    const fd: u32 = @intCast(ipc_channel + 3);
                    switch (ipc_extra_fd_default.asSpawnOption(fd)) {
                        .result => |opt| {
                            extra_fds.append(opt) catch {
                                globalThis.throwOutOfMemory();
                                return .zero;
                            };
                        },
                        .err => |e| {
                            return e.throwJS(globalThis);
                        },
                    }
                    break :brk fd;
                } else {
                    break :brk @intCast(ipc_channel + 3);
                }
            };

            const pipe_env = std.fmt.bufPrintZ(
                &ipc_env_buf,
                "NODE_CHANNEL_FD={d}",
                .{ipc_fd},
            ) catch {
                globalThis.throwOutOfMemory();
                return .zero;
            };
            env_array.appendAssumeCapacity(pipe_env);

            env_array.appendAssumeCapacity(switch (ipc_mode) {
                inline else => |t| "NODE_CHANNEL_SERIALIZATION_MODE=" ++ @tagName(t),
            });
        };

        env_array.append(allocator, null) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        argv.append(null) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };

        if (comptime is_sync) {
            for (&stdio, 0..) |*io, i| {
                io.toSync(@truncate(i));
            }
        }

        const spawn_options = bun.spawn.SpawnOptions{
            .cwd = cwd,
            .detached = detached,
            .stdin = switch (stdio[0].asSpawnOption(0)) {
                .result => |opt| opt,
                .err => |e| return e.throwJS(globalThis),
            },
            .stdout = switch (stdio[1].asSpawnOption(1)) {
                .result => |opt| opt,
                .err => |e| return e.throwJS(globalThis),
            },
            .stderr = switch (stdio[2].asSpawnOption(2)) {
                .result => |opt| opt,
                .err => |e| return e.throwJS(globalThis),
            },
            .extra_fds = extra_fds.items,
            .argv0 = argv0,

            .windows = if (Environment.isWindows) .{
                .hide_window = windows_hide,
                .verbatim_arguments = windows_verbatim_arguments,
                .loop = JSC.EventLoopHandle.init(jsc_vm),
            } else {},
        };

        var spawned = switch (bun.spawn.spawnProcess(
            &spawn_options,
            @ptrCast(argv.items.ptr),
            @ptrCast(env_array.items.ptr),
        ) catch |err| {
            spawn_options.deinit();
            return globalThis.throwError(err, ": failed to spawn process") catch return .zero;
        }) {
            .err => |err| {
                spawn_options.deinit();
                globalThis.throwValue(err.toJSC(globalThis));
                return .zero;
            },
            .result => |result| result,
        };

        const loop = jsc_vm.eventLoop();

        const process = spawned.toProcess(loop, is_sync);

        var subprocess = Subprocess.new(.{
            .globalThis = globalThis,
            .process = process,
            .pid_rusage = null,
            .stdin = .{ .ignore = {} },
            .stdout = .{ .ignore = {} },
            .stderr = .{ .ignore = {} },
            .stdio_pipes = .{},
            .on_exit_callback = .{},
            .on_disconnect_callback = .{},
            .ipc_data = null,
            .ipc_callback = .{},
            .flags = .{
                .is_sync = is_sync,
            },
        });

        const posix_ipc_fd = if (Environment.isPosix and !is_sync and maybe_ipc_mode != null)
            spawned.extra_pipes.items[@intCast(ipc_channel)]
        else
            bun.invalid_fd;

        // When run synchronously, subprocess isn't garbage collected
        subprocess.* = Subprocess{
            .globalThis = globalThis,
            .process = process,
            .pid_rusage = null,
            .stdin = Writable.init(
                stdio[0],
                loop,
                subprocess,
                spawned.stdin,
            ) catch {
                globalThis.throwOutOfMemory();
                subprocess.deref();
                return .zero;
            },
            .stdout = Readable.init(
                stdio[1],
                loop,
                subprocess,
                spawned.stdout,
                jsc_vm.allocator,
                default_max_buffer_size,
                is_sync,
            ),
            .stderr = Readable.init(
                stdio[2],
                loop,
                subprocess,
                spawned.stderr,
                jsc_vm.allocator,
                default_max_buffer_size,
                is_sync,
            ),
            // 1. JavaScript.
            // 2. Process.
            .ref_count = 2,
            .stdio_pipes = spawned.extra_pipes.moveToUnmanaged(),
            .on_exit_callback = if (on_exit_callback != .zero) JSC.Strong.create(on_exit_callback, globalThis) else .{},
            .on_disconnect_callback = if (on_disconnect_callback != .zero) JSC.Strong.create(on_disconnect_callback, globalThis) else .{},
            .ipc_data = if (!is_sync and comptime Environment.isWindows)
                if (maybe_ipc_mode) |ipc_mode| .{
                    .mode = ipc_mode,
                } else null
            else
                null,
            .ipc_callback = if (ipc_callback != .zero) JSC.Strong.create(ipc_callback, globalThis) else .{},
            .flags = .{
                .is_sync = is_sync,
            },
        };

        subprocess.process.setExitHandler(subprocess);

        var posix_ipc_info: if (Environment.isPosix) IPC.Socket else void = undefined;
        if (Environment.isPosix and !is_sync) {
            if (maybe_ipc_mode) |mode| {
                if (uws.us_socket_from_fd(
                    jsc_vm.rareData().spawnIPCContext(jsc_vm),
                    @sizeOf(*Subprocess),
                    posix_ipc_fd.cast(),
                )) |socket| {
                    posix_ipc_info = IPC.Socket.from(socket);
                    subprocess.ipc_data = .{
                        .socket = posix_ipc_info,
                        .mode = mode,
                    };
                }
            }
        }

        if (subprocess.ipc_data) |*ipc_data| {
            if (Environment.isPosix) {
                if (posix_ipc_info.ext(*Subprocess)) |ctx| {
                    ctx.* = subprocess;
                    subprocess.ref(); // + one ref for the IPC
                }
            } else {
                subprocess.ref(); // + one ref for the IPC

                if (ipc_data.configureServer(
                    Subprocess,
                    subprocess,
                    subprocess.stdio_pipes.items[@intCast(ipc_channel)].buffer,
                ).asErr()) |err| {
                    subprocess.deref();
                    globalThis.throwValue(err.toJSC(globalThis));
                    return .zero;
                }
                subprocess.stdio_pipes.items[@intCast(ipc_channel)] = .unavailable;
            }
            ipc_data.writeVersionPacket();
        }

        if (subprocess.stdin == .pipe) {
            subprocess.stdin.pipe.signal = JSC.WebCore.Signal.init(&subprocess.stdin);
        }

        const out = if (comptime !is_sync)
            subprocess.toJS(globalThis)
        else
            JSValue.zero;
        subprocess.this_jsvalue = out;

        var send_exit_notification = false;

        if (comptime !is_sync) {
            switch (subprocess.process.watch()) {
                .result => {},
                .err => {
                    send_exit_notification = true;
                    lazy = false;
                },
            }
        }

        defer {
            if (send_exit_notification) {
                if (subprocess.process.hasExited()) {
                    // process has already exited, we called wait4(), but we did not call onProcessExit()
                    subprocess.process.onExit(subprocess.process.status, &std.mem.zeroes(Rusage));
                } else {
                    // process has already exited, but we haven't called wait4() yet
                    // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                    subprocess.process.wait(is_sync);
                }
            }
        }

        if (subprocess.stdin == .buffer) {
            subprocess.stdin.buffer.start().assert();
        }

        if (subprocess.stdout == .pipe) {
            subprocess.stdout.pipe.start(subprocess, loop).assert();
            if ((is_sync or !lazy) and subprocess.stdout == .pipe) {
                subprocess.stdout.pipe.readAll();
            }
        }

        if (subprocess.stderr == .pipe) {
            subprocess.stderr.pipe.start(subprocess, loop).assert();

            if ((is_sync or !lazy) and subprocess.stderr == .pipe) {
                subprocess.stderr.pipe.readAll();
            }
        }

        should_close_memfd = false;

        if (comptime !is_sync) {
            // Once everything is set up, we can add the abort listener
            // Adding the abort listener may call the onAbortSignal callback immediately if it was already aborted
            // Therefore, we must do this at the very end.
            if (abort_signal) |signal| {
                signal.pendingActivityRef();
                subprocess.abort_signal = signal.addListener(subprocess, onAbortSignal);
                abort_signal = null;
            }
            if (!subprocess.process.hasExited()) {
                jsc_vm.onSubprocessSpawn(subprocess.process);
            }
            return out;
        }

        if (comptime is_sync) {
            switch (subprocess.process.watchOrReap()) {
                .result => {
                    // Once everything is set up, we can add the abort listener
                    // Adding the abort listener may call the onAbortSignal callback immediately if it was already aborted
                    // Therefore, we must do this at the very end.
                    if (abort_signal) |signal| {
                        signal.pendingActivityRef();
                        subprocess.abort_signal = signal.addListener(subprocess, onAbortSignal);
                        abort_signal = null;
                    }
                },
                .err => {
                    subprocess.process.wait(true);
                },
            }
        }

        if (!subprocess.process.hasExited()) {
            jsc_vm.onSubprocessSpawn(subprocess.process);
        }

        while (subprocess.hasPendingActivityNonThreadsafe()) {
            if (subprocess.stdin == .buffer) {
                subprocess.stdin.buffer.watch();
            }

            if (subprocess.stderr == .pipe) {
                subprocess.stderr.pipe.watch();
            }

            if (subprocess.stdout == .pipe) {
                subprocess.stdout.pipe.watch();
            }

            jsc_vm.tick();
            jsc_vm.eventLoop().autoTick();
        }

        subprocess.updateHasPendingActivity();

        const signalCode = subprocess.getSignalCode(globalThis);
        const exitCode = subprocess.getExitCode(globalThis);
        const stdout = subprocess.stdout.toBufferedValue(globalThis);
        const stderr = subprocess.stderr.toBufferedValue(globalThis);
        const resource_usage: JSValue = if (!globalThis.hasException()) subprocess.createResourceUsageObject(globalThis) else .zero;
        subprocess.finalize();

        if (globalThis.hasException()) {
            // e.g. a termination exception.
            return .zero;
        }

        const sync_value = JSC.JSValue.createEmptyObject(globalThis, 5 + @as(usize, @intFromBool(!signalCode.isEmptyOrUndefinedOrNull())));
        sync_value.put(globalThis, JSC.ZigString.static("exitCode"), exitCode);
        if (!signalCode.isEmptyOrUndefinedOrNull()) {
            sync_value.put(globalThis, JSC.ZigString.static("signalCode"), signalCode);
        }
        sync_value.put(globalThis, JSC.ZigString.static("stdout"), stdout);
        sync_value.put(globalThis, JSC.ZigString.static("stderr"), stderr);
        sync_value.put(globalThis, JSC.ZigString.static("success"), JSValue.jsBoolean(exitCode.isInt32() and exitCode.asInt32() == 0));
        sync_value.put(globalThis, JSC.ZigString.static("resourceUsage"), resource_usage);

        return sync_value;
    }

    const node_cluster_binding = @import("./../../node/node_cluster_binding.zig");

    pub fn handleIPCMessage(
        this: *Subprocess,
        message: IPC.DecodedIPCMessage,
    ) void {
        IPClog("Subprocess#handleIPCMessage", .{});
        switch (message) {
            // In future versions we can read this in order to detect version mismatches,
            // or disable future optimizations if the subprocess is old.
            .version => |v| {
                IPC.log("Child IPC version is {d}", .{v});
            },
            .data => |data| {
                IPC.log("Received IPC message from child", .{});
                if (this.ipc_callback.get()) |cb| {
                    this.globalThis.bunVM().eventLoop().runCallback(
                        cb,
                        this.globalThis,
                        this.this_jsvalue,
                        &[_]JSValue{ data, this.this_jsvalue },
                    );
                }
            },
            .internal => |data| {
                IPC.log("Received IPC internal message from child", .{});
                node_cluster_binding.handleInternalMessagePrimary(this.globalThis, this, data) catch {};
            },
        }
    }

    pub fn handleIPCClose(this: *Subprocess) void {
        IPClog("Subprocess#handleIPCClose", .{});
        this.updateHasPendingActivity();
        defer this.deref();
        var ok = false;
        if (this.ipc()) |ipc_data| {
            ok = true;
            ipc_data.internal_msg_queue.deinit();
        }
        this.ipc_data = null;

        const this_jsvalue = this.this_jsvalue;
        this_jsvalue.ensureStillAlive();
        if (this.on_disconnect_callback.trySwap()) |callback| {
            this.globalThis.bunVM().eventLoop().runCallback(callback, this.globalThis, this_jsvalue, &.{JSValue.jsBoolean(ok)});
        }
    }

    pub fn ipc(this: *Subprocess) ?*IPC.IPCData {
        return &(this.ipc_data orelse return null);
    }

    pub const IPCHandler = IPC.NewIPCHandler(Subprocess);
};
