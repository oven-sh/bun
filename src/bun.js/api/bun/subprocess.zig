const default_allocator = @import("root").bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;

const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = @import("root").bun.JSC;
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
                std.debug.assert(fd != bun.invalid_fd);
            }
        }
    }
}
pub const ResourceUsage = struct {
    pub usingnamespace JSC.Codegen.JSResourceUsage;
    rusage: Rusage,

    pub fn constructor(
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) ?*Subprocess {
        return null;
    }

    pub fn getCPUTime(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) callconv(.C) JSValue {
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
    ) callconv(.C) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.maxrss);
    }

    pub fn getSharedMemorySize(
        this: *ResourceUsage,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.ixrss);
    }

    pub fn getSwapCount(
        this: *ResourceUsage,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.nswap);
    }

    pub fn getOps(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) callconv(.C) JSValue {
        var ops = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
        ops.put(globalObject, JSC.ZigString.static("in"), JSC.JSValue.jsNumber(this.rusage.inblock));
        ops.put(globalObject, JSC.ZigString.static("out"), JSC.JSValue.jsNumber(this.rusage.oublock));
        return ops;
    }

    pub fn getMessages(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) callconv(.C) JSValue {
        var msgs = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
        msgs.put(globalObject, JSC.ZigString.static("sent"), JSC.JSValue.jsNumber(this.rusage.msgsnd));
        msgs.put(globalObject, JSC.ZigString.static("received"), JSC.JSValue.jsNumber(this.rusage.msgrcv));
        return msgs;
    }

    pub fn getSignalCount(
        this: *ResourceUsage,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.nsignals);
    }

    pub fn getContextSwitches(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) callconv(.C) JSValue {
        var ctx = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
        ctx.put(globalObject, JSC.ZigString.static("voluntary"), JSC.JSValue.jsNumber(this.rusage.nvcsw));
        ctx.put(globalObject, JSC.ZigString.static("involuntary"), JSC.JSValue.jsNumber(this.rusage.nivcsw));
        return ctx;
    }

    pub fn finalize(this: *ResourceUsage) callconv(.C) void {
        bun.default_allocator.destroy(this);
    }
};

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
    process: *Process = undefined,
    stdin: Writable,
    stdout: Readable,
    stderr: Readable,
    stdio_pipes: if (Environment.isWindows) std.ArrayListUnmanaged(StdioResult) else std.ArrayListUnmanaged(bun.FileDescriptor) = .{},
    pid_rusage: ?Rusage = null,

    exit_promise: JSC.Strong = .{},
    on_exit_callback: JSC.Strong = .{},

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

    ipc_mode: IPCMode,
    ipc_callback: JSC.Strong = .{},
    ipc: IPC.IPCData,
    flags: Flags = .{},

    weak_file_sink_stdin_ptr: ?*JSC.WebCore.FileSink = null,

    pub const Flags = packed struct {
        is_sync: bool = false,
        killed: bool = false,
        has_stdin_destructor_called: bool = false,
    };

    pub const SignalCode = bun.SignalCode;

    pub const IPCMode = enum {
        none,
        bun,
        // json,
    };

    pub fn resourceUsage(
        this: *Subprocess,
        globalObject: *JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
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
        if (this.ipc_mode != .none) {
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
        @fence(.SeqCst);
        if (comptime Environment.isDebug) {
            log("updateHasPendingActivity() {any} -> {any}", .{
                this.has_pending_activity.raw,
                this.hasPendingActivityNonThreadsafe(),
            });
        }
        this.has_pending_activity.store(
            this.hasPendingActivityNonThreadsafe(),
            .Monotonic,
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
        @fence(.Acquire);
        return this.has_pending_activity.load(.Acquire);
    }

    pub fn ref(this: *Subprocess) void {
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
    pub fn unref(this: *Subprocess) void {
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

    pub fn constructor(
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) ?*Subprocess {
        return null;
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
                    .ignore => Readable{ .ignore = {} },
                    .path => Readable{ .ignore = {} },
                    .fd => |fd| Readable{ .fd = fd },
                    .dup2 => |dup2| Readable{ .fd = dup2.out.toFd() },
                    .memfd => Readable{ .ignore = {} },
                    .pipe => Readable{ .pipe = PipeReader.create(event_loop, process, result) },
                    .array_buffer, .blob => Output.panic("TODO: implement ArrayBuffer & Blob support in Stdio readable", .{}),
                    .capture => Output.panic("TODO: implement capture support in Stdio readable", .{}),
                };
            }
            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ignore => Readable{ .ignore = {} },
                .path => Readable{ .ignore = {} },
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
    ) callconv(.C) JSValue {
        this.observable_getters.insert(.stderr);
        return this.stderr.toJS(globalThis, this.hasExited());
    }

    pub fn getStdin(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        this.observable_getters.insert(.stdin);
        return this.stdin.toJS(globalThis, this);
    }

    pub fn getStdout(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        this.observable_getters.insert(.stdout);
        return this.stdout.toJS(globalThis, this.hasExited());
    }

    pub fn kill(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        this.this_jsvalue = callframe.this();

        var arguments = callframe.arguments(1);
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
                    globalThis.throwInvalidArguments("Unknown signal", .{});
                    return .zero;
                }

                if (sig64 < 0) {
                    globalThis.throwInvalidArguments("Invalid signal: must be >= 0", .{});
                    return .zero;
                }

                if (sig64 > 31) {
                    globalThis.throwInvalidArguments("Invalid signal: must be < 32", .{});
                    return .zero;
                }

                break :brk @intFromFloat(sig64);
            } else if (arguments.ptr[0].isString()) {
                if (arguments.ptr[0].asString().length() == 0) {
                    break :brk SignalCode.default;
                }
                const signal_code = arguments.ptr[0].toEnum(globalThis, "signal", SignalCode) catch return .zero;
                break :brk @intFromEnum(signal_code);
            } else if (!arguments.ptr[0].isEmptyOrUndefinedOrNull()) {
                globalThis.throwInvalidArguments("Invalid signal: must be a string or an integer", .{});
                return .zero;
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

    pub fn doRef(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.ref();
        return JSC.JSValue.jsUndefined();
    }

    pub fn doUnref(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.unref();
        return JSC.JSValue.jsUndefined();
    }

    pub fn onStdinDestroyed(this: *Subprocess) void {
        this.flags.has_stdin_destructor_called = true;
        this.weak_file_sink_stdin_ptr = null;

        this.updateHasPendingActivity();
    }

    pub fn doSend(this: *Subprocess, global: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        if (this.ipc_mode == .none) {
            global.throw("Subprocess.send() can only be used if an IPC channel is open.", .{});
            return .zero;
        }

        if (callFrame.argumentsCount() == 0) {
            global.throwInvalidArguments("Subprocess.send() requires one argument", .{});
            return .zero;
        }

        const value = callFrame.argument(0);

        const success = this.ipc.serializeAndSend(global, value);
        if (!success) return .zero;

        return JSC.JSValue.jsUndefined();
    }

    pub fn disconnect(this: *Subprocess) void {
        if (this.ipc_mode == .none) return;
        this.ipc.socket.close(0, null);
        this.ipc_mode = .none;
    }

    pub fn pid(this: *const Subprocess) i32 {
        return @intCast(this.process.pid);
    }

    pub fn getPid(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSValue.jsNumber(this.pid());
    }

    pub fn getKilled(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSValue.jsBoolean(this.hasKilled());
    }

    pub fn getStdio(
        this: *Subprocess,
        global: *JSGlobalObject,
    ) callconv(.C) JSValue {
        const array = JSValue.createEmptyArray(global, 0);
        array.push(global, .null);
        array.push(global, .null); // TODO: align this with options
        array.push(global, .null); // TODO: align this with options

        this.observable_getters.insert(.stdio);
        var pipes = this.stdio_pipes.items;
        if (this.ipc_mode != .none) {
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

            pub usingnamespace bun.NewRefCounted(@This(), deinit);
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

        pub usingnamespace bun.NewRefCounted(PipeReader, deinit);

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
                std.debug.assert(this.reader.isDone());
            }

            if (comptime Environment.isWindows) {
                std.debug.assert(this.reader.source == null or this.reader.source.?.isClosed());
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
            const process = @fieldParentPtr(Subprocess, "stdin", this);

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
                    .capture => {
                        return Writable{ .ignore = {} };
                    },
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
                    subprocess.flags.has_stdin_destructor_called = false;

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
                    std.debug.assert(memfd != bun.invalid_fd);
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
                .capture => {
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
                        pipe.onAttachedProcessExit();
                        return pipe.toJS(globalThis);
                    } else {
                        subprocess.flags.has_stdin_destructor_called = false;
                        subprocess.weak_file_sink_stdin_ptr = pipe;
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
            const subprocess = @fieldParentPtr(Subprocess, "stdin", this);
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

    pub fn onProcessExit(this: *Subprocess, _: *Process, status: bun.spawn.Status, rusage: *const Rusage) void {
        log("onProcessExit()", .{});
        const this_jsvalue = this.this_jsvalue;
        const globalThis = this.globalThis;
        this_jsvalue.ensureStillAlive();
        this.pid_rusage = rusage.*;
        const is_sync = this.flags.is_sync;

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
            pipe.onAttachedProcessExit();
        }

        var did_update_has_pending_activity = false;
        defer if (!did_update_has_pending_activity) this.updateHasPendingActivity();

        const loop = globalThis.bunVM().eventLoop();

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
                    JSC.JSValue.jsUndefined();

                const this_value = if (this_jsvalue.isEmptyOrUndefinedOrNull()) JSC.JSValue.jsUndefined() else this_jsvalue;
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
    }

    pub fn finalize(this: *Subprocess) callconv(.C) void {
        log("finalize", .{});
        // Ensure any code which references the "this" value doesn't attempt to
        // access it after it's been freed We cannot call any methods which
        // access GC'd values during the finalizer
        this.this_jsvalue = .zero;

        std.debug.assert(!this.hasPendingActivity() or JSC.VirtualMachine.get().isShuttingDown());
        this.finalizeStreams();

        this.process.detach();
        this.process.deref();
        bun.default_allocator.destroy(this);
    }

    pub fn getExited(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
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
    ) callconv(.C) JSValue {
        if (this.process.status == .exited) {
            return JSC.JSValue.jsNumber(this.process.status.exited.code);
        }
        return JSC.JSValue.jsNull();
    }

    pub fn getSignalCode(
        this: *Subprocess,
        global: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.process.signalCode()) |signal| {
            if (signal.name()) |name|
                return JSC.ZigString.init(name).toValueGC(global)
            else
                return JSC.JSValue.jsNumber(@intFromEnum(signal));
        }

        return JSC.JSValue.jsNull();
    }

    pub fn spawn(globalThis: *JSC.JSGlobalObject, args: JSValue, secondaryArgsValue: ?JSValue) JSValue {
        return spawnMaybeSync(globalThis, args, secondaryArgsValue, false);
    }

    pub fn spawnSync(globalThis: *JSC.JSGlobalObject, args: JSValue, secondaryArgsValue: ?JSValue) JSValue {
        return spawnMaybeSync(globalThis, args, secondaryArgsValue, true);
    }

    pub fn spawnMaybeSync(
        globalThis: *JSC.JSGlobalObject,
        args_: JSValue,
        secondaryArgsValue: ?JSValue,
        comptime is_sync: bool,
    ) JSValue {
        var arena = @import("root").bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var allocator = arena.allocator();

        var override_env = false;
        var env_array = std.ArrayListUnmanaged(?[*:0]const u8){
            .items = &.{},
            .capacity = 0,
        };
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
        var PATH = jsc_vm.bundler.env.get("PATH") orelse "";
        var argv = std.ArrayList(?[*:0]const u8).init(allocator);
        var cmd_value = JSValue.zero;
        var detached = false;
        var args = args_;
        var ipc_mode = IPCMode.none;
        var ipc_callback: JSValue = .zero;
        var extra_fds = std.ArrayList(bun.spawn.SpawnOptions.Stdio).init(bun.default_allocator);
        var argv0: ?[*:0]const u8 = null;

        var windows_hide: bool = false;

        {
            if (args.isEmptyOrUndefinedOrNull()) {
                globalThis.throwInvalidArguments("cmd must be an array", .{});
                return .zero;
            }

            const args_type = args.jsType();
            if (args_type.isArray()) {
                cmd_value = args;
                args = secondaryArgsValue orelse JSValue.zero;
            } else if (!args.isObject()) {
                globalThis.throwInvalidArguments("cmd must be an array", .{});
                return .zero;
            } else if (args.getTruthy(globalThis, "cmd")) |cmd_value_| {
                cmd_value = cmd_value_;
            } else {
                globalThis.throwInvalidArguments("cmd must be an array", .{});
                return .zero;
            }

            if (args.isObject()) {
                if (args.getTruthy(globalThis, "argv0")) |argv0_| {
                    const argv0_str = argv0_.getZigString(globalThis);
                    if (argv0_str.len > 0) {
                        argv0 = argv0_str.toOwnedSliceZ(allocator) catch {
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
                    globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                    return .zero;
                }

                if (cmds_array.len == 0) {
                    globalThis.throwInvalidArguments("cmd must not be empty", .{});
                    return .zero;
                }

                {
                    var first_cmd = cmds_array.next().?;
                    var arg0 = first_cmd.toSlice(globalThis, allocator);
                    defer arg0.deinit();

                    if (argv0 == null) {
                        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                        const resolved = Which.which(&path_buf, PATH, cwd, arg0.slice()) orelse {
                            globalThis.throwInvalidArguments("Executable not found in $PATH: \"{s}\"", .{arg0.slice()});
                            return .zero;
                        };
                        argv0 = allocator.dupeZ(u8, resolved) catch {
                            globalThis.throwOutOfMemory();
                            return .zero;
                        };
                    } else {
                        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                        const resolved = Which.which(&path_buf, PATH, cwd, bun.sliceTo(argv0.?, 0)) orelse {
                            globalThis.throwInvalidArguments("Executable not found in $PATH: \"{s}\"", .{arg0.slice()});
                            return .zero;
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
                    globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                    return .zero;
                }
            }

            if (args != .zero and args.isObject()) {

                // This must run before the stdio parsing happens
                if (args.getTruthy(globalThis, "ipc")) |val| {
                    if (val.isCell() and val.isCallable(globalThis.vm())) {
                        // In the future, we should add a way to use a different IPC serialization format, specifically `json`.
                        // but the only use case this has is doing interop with node.js IPC and other programs.
                        ipc_mode = .bun;
                        ipc_callback = val.withAsyncContextIfNeeded(globalThis);

                        if (Environment.isPosix) {
                            extra_fds.append(.{ .buffer = {} }) catch {
                                globalThis.throwOutOfMemory();
                                return .zero;
                            };
                        }
                    }
                }

                if (args.getTruthy(globalThis, "cwd")) |cwd_| {
                    const cwd_str = cwd_.getZigString(globalThis);
                    if (cwd_str.len > 0) {
                        cwd = cwd_str.toOwnedSliceZ(allocator) catch {
                            globalThis.throwOutOfMemory();
                            return .zero;
                        };
                    }
                }

                if (args.getTruthy(globalThis, "onExit")) |onExit_| {
                    if (!onExit_.isCell() or !onExit_.isCallable(globalThis.vm())) {
                        globalThis.throwInvalidArguments("onExit must be a function or undefined", .{});
                        return .zero;
                    }

                    on_exit_callback = if (comptime is_sync)
                        onExit_
                    else
                        onExit_.withAsyncContextIfNeeded(globalThis);
                }

                if (args.getTruthy(globalThis, "env")) |object| {
                    if (!object.isObject()) {
                        globalThis.throwInvalidArguments("env must be an object", .{});
                        return .zero;
                    }

                    override_env = true;
                    var object_iter = JSC.JSPropertyIterator(.{
                        .skip_empty_name = false,
                        .include_value = true,
                    }).init(globalThis, object.asObjectRef());
                    defer object_iter.deinit();
                    env_array.ensureTotalCapacityPrecise(allocator, object_iter.len +
                        // +1 incase there's IPC
                        // +1 for null terminator
                        2) catch {
                        globalThis.throwOutOfMemory();
                        return .zero;
                    };

                    // If the env object does not include a $PATH, it must disable path lookup for argv[0]
                    PATH = "";

                    while (object_iter.next()) |key| {
                        var value = object_iter.value;
                        if (value == .undefined) continue;

                        var line = std.fmt.allocPrintZ(allocator, "{}={}", .{ key, value.getZigString(globalThis) }) catch {
                            globalThis.throwOutOfMemory();
                            return .zero;
                        };

                        if (key.eqlComptime("PATH")) {
                            PATH = bun.asByteSlice(line["PATH=".len..]);
                        }

                        env_array.append(allocator, line) catch {
                            globalThis.throwOutOfMemory();
                            return .zero;
                        };
                    }
                }

                if (args.get(globalThis, "stdio")) |stdio_val| {
                    if (!stdio_val.isEmptyOrUndefinedOrNull()) {
                        if (stdio_val.jsType().isArray()) {
                            var stdio_iter = stdio_val.arrayIterator(globalThis);
                            var i: u32 = 0;
                            while (stdio_iter.next()) |value| : (i += 1) {
                                if (!stdio[i].extract(globalThis, i, value))
                                    return JSC.JSValue.jsUndefined();
                                if (i == 2)
                                    break;
                            }
                            i += 1;

                            while (stdio_iter.next()) |value| : (i += 1) {
                                var new_item: Stdio = undefined;
                                if (!new_item.extract(globalThis, i, value)) {
                                    return JSC.JSValue.jsUndefined();
                                }

                                const opt = switch (new_item.asSpawnOption(i)) {
                                    .result => |opt| opt,
                                    .err => |e| {
                                        return e.throwJS(globalThis);
                                    },
                                };
                                extra_fds.append(opt) catch {
                                    globalThis.throwOutOfMemory();
                                    return .zero;
                                };
                            }
                        } else {
                            globalThis.throwInvalidArguments("stdio must be an array", .{});
                            return .zero;
                        }
                    }
                } else {
                    if (args.get(globalThis, "stdin")) |value| {
                        if (!stdio[0].extract(globalThis, 0, value))
                            return .zero;
                    }

                    if (args.get(globalThis, "stderr")) |value| {
                        if (!stdio[2].extract(globalThis, 2, value))
                            return .zero;
                    }

                    if (args.get(globalThis, "stdout")) |value| {
                        if (!stdio[1].extract(globalThis, 1, value))
                            return .zero;
                    }
                }

                if (comptime !is_sync) {
                    if (args.get(globalThis, "lazy")) |lazy_val| {
                        if (lazy_val.isBoolean()) {
                            lazy = lazy_val.toBoolean();
                        }
                    }
                }

                if (args.get(globalThis, "detached")) |detached_val| {
                    if (detached_val.isBoolean()) {
                        detached = detached_val.toBoolean();
                    }
                }

                if (Environment.isWindows) {
                    if (args.get(globalThis, "windowsHide")) |val| {
                        if (val.isBoolean()) {
                            windows_hide = val.asBoolean();
                        }
                    }
                }
            }
        }

        if (!override_env and env_array.items.len == 0) {
            env_array.items = jsc_vm.bundler.env.map.createNullDelimitedEnvMap(allocator) catch |err|
                return globalThis.handleError(err, "in Bun.spawn");
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

        var windows_ipc_env_buf: if (Environment.isWindows) ["BUN_INTERNAL_IPC_FD=\\\\.\\pipe\\BUN_IPC_00000000-0000-0000-0000-000000000000\x00".len]u8 else void = undefined;
        if (ipc_mode != .none) {
            if (comptime is_sync) {
                globalThis.throwInvalidArguments("IPC is not supported in Bun.spawnSync", .{});
                return .zero;
            }

            // IPC is currently implemented in a very limited way.
            //
            // Node lets you pass as many fds as you want, they all become be sockets; then, IPC is just a special
            // runtime-owned version of "pipe" (in which pipe is a misleading name since they're bidirectional sockets).
            //
            // Bun currently only supports three fds: stdin, stdout, and stderr, which are all unidirectional
            //
            // And then fd 3 is assigned specifically and only for IPC. This is quite lame, because Node.js allows
            // the ipc fd to be any number and it just works. But most people only care about the default `.fork()`
            // behavior, where this workaround suffices.
            //
            // When Bun.spawn() is given an `.ipc` callback, it enables IPC as follows:
            env_array.ensureUnusedCapacity(allocator, 2) catch |err| return globalThis.handleError(err, "in Bun.spawn");
            if (Environment.isPosix) {
                env_array.appendAssumeCapacity("BUN_INTERNAL_IPC_FD=3");
            } else {
                const uuid = globalThis.bunVM().rareData().nextUUID();
                const pipe_env = std.fmt.bufPrintZ(&windows_ipc_env_buf, "BUN_INTERNAL_IPC_FD=\\\\.\\pipe\\BUN_IPC_{s}", .{uuid}) catch |err| switch (err) {
                    error.NoSpaceLeft => unreachable, // upper bound for this string is known
                };
                env_array.appendAssumeCapacity(pipe_env);
            }
        }

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
                .loop = JSC.EventLoopHandle.init(jsc_vm),
            } else {},
        };

        const process_allocator = globalThis.allocator();
        var subprocess = process_allocator.create(Subprocess) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };

        var spawned = switch (bun.spawn.spawnProcess(
            &spawn_options,
            @ptrCast(argv.items.ptr),
            @ptrCast(env_array.items.ptr),
        ) catch |err| {
            process_allocator.destroy(subprocess);
            spawn_options.deinit();
            globalThis.throwError(err, ": failed to spawn process");

            return .zero;
        }) {
            .err => |err| {
                process_allocator.destroy(subprocess);
                spawn_options.deinit();
                globalThis.throwValue(err.toJSC(globalThis));
                return .zero;
            },
            .result => |result| result,
        };

        var posix_ipc_info: if (Environment.isPosix) IPC.Socket else void = undefined;
        if (Environment.isPosix) {
            if (ipc_mode != .none) {
                posix_ipc_info = .{
                    // we initialize ext later in the function
                    .socket = uws.us_socket_from_fd(
                        jsc_vm.rareData().spawnIPCContext(jsc_vm),
                        @sizeOf(*Subprocess),
                        spawned.extra_pipes.items[0].cast(),
                    ) orelse {
                        process_allocator.destroy(subprocess);
                        spawn_options.deinit();
                        globalThis.throw("failed to create socket pair", .{});
                        return .zero;
                    },
                };
            }
        }

        const loop = jsc_vm.eventLoop();

        // When run synchronously, subprocess isn't garbage collected
        subprocess.* = Subprocess{
            .globalThis = globalThis,
            .process = spawned.toProcess(loop, is_sync),
            .pid_rusage = null,
            .stdin = Writable.init(
                stdio[0],
                loop,
                subprocess,
                spawned.stdin,
            ) catch {
                globalThis.throwOutOfMemory();
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
            .stdio_pipes = spawned.extra_pipes.moveToUnmanaged(),
            .on_exit_callback = if (on_exit_callback != .zero) JSC.Strong.create(on_exit_callback, globalThis) else .{},
            .ipc_mode = ipc_mode,
            // will be assigned in the block below
            .ipc = if (Environment.isWindows) .{} else .{ .socket = posix_ipc_info },
            .ipc_callback = if (ipc_callback != .zero) JSC.Strong.create(ipc_callback, globalThis) else undefined,
            .flags = .{
                .is_sync = is_sync,
            },
        };
        subprocess.process.setExitHandler(subprocess);

        if (ipc_mode != .none) {
            if (Environment.isPosix) {
                const ptr = posix_ipc_info.ext(*Subprocess);
                ptr.?.* = subprocess;
            } else {
                if (subprocess.ipc.configureServer(
                    Subprocess,
                    subprocess,
                    windows_ipc_env_buf["BUN_INTERNAL_IPC_FD=".len..],
                ).asErr()) |err| {
                    process_allocator.destroy(subprocess);
                    globalThis.throwValue(err.toJSC(globalThis));
                    return .zero;
                }
            }
            subprocess.ipc.writeVersionPacket();
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
            switch (subprocess.process.watch(jsc_vm)) {
                .result => {},
                .err => {
                    send_exit_notification = true;
                    lazy = false;
                },
            }
        }

        defer {
            if (send_exit_notification) {
                // process has already exited
                // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                subprocess.process.wait(is_sync);
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
            return out;
        }

        if (comptime is_sync) {
            switch (subprocess.process.watch(jsc_vm)) {
                .result => {},
                .err => {
                    subprocess.process.wait(true);
                },
            }
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
        const resource_usage = subprocess.createResourceUsageObject(globalThis);
        subprocess.finalize();

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

    const os = std.os;

    pub fn handleIPCMessage(
        this: *Subprocess,
        message: IPC.DecodedIPCMessage,
    ) void {
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
        }
    }

    pub fn handleIPCClose(this: *Subprocess) void {
        this.ipc_mode = .none;
        this.updateHasPendingActivity();
    }

    pub const IPCHandler = IPC.NewIPCHandler(Subprocess);
};
