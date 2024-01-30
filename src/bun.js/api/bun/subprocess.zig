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
const CloseCallbackHandler = JSC.WebCore.UVStreamSink.CloseCallbackHandler;

const win_rusage = struct {
    utime: struct {
        tv_sec: i64 = 0,
        tv_usec: i64 = 0,
    },
    stime: struct {
        tv_sec: i64 = 0,
        tv_usec: i64 = 0,
    },
    maxrss: u64 = 0,
    ixrss: u0 = 0,
    idrss: u0 = 0,
    isrss: u0 = 0,
    minflt: u0 = 0,
    majflt: u0 = 0,
    nswap: u0 = 0,
    inblock: u64 = 0,
    oublock: u64 = 0,
    msgsnd: u0 = 0,
    msgrcv: u0 = 0,
    nsignals: u0 = 0,
    nvcsw: u0 = 0,
    nivcsw: u0 = 0,
};

const IO_COUNTERS = extern struct {
    ReadOperationCount: u64 = 0,
    WriteOperationCount: u64 = 0,
    OtherOperationCount: u64 = 0,
    ReadTransferCount: u64 = 0,
    WriteTransferCount: u64 = 0,
    OtherTransferCount: u64 = 0,
};

extern "kernel32" fn GetProcessIoCounters(handle: std.os.windows.HANDLE, counters: *IO_COUNTERS) callconv(std.os.windows.WINAPI) c_int;

fn uv_getrusage(process: *uv.uv_process_t) win_rusage {
    var usage_info: Rusage = .{ .utime = .{}, .stime = .{} };
    const process_pid: *anyopaque = process.process_handle;
    const WinTime = std.os.windows.FILETIME;
    var starttime: WinTime = undefined;
    var exittime: WinTime = undefined;
    var kerneltime: WinTime = undefined;
    var usertime: WinTime = undefined;
    // We at least get process times
    if (std.os.windows.kernel32.GetProcessTimes(process_pid, &starttime, &exittime, &kerneltime, &usertime) == 1) {
        var temp: u64 = (@as(u64, kerneltime.dwHighDateTime) << 32) | kerneltime.dwLowDateTime;
        if (temp > 0) {
            usage_info.stime.tv_sec = @intCast(temp / 10000000);
            usage_info.stime.tv_usec = @intCast(temp % 1000000);
        }
        temp = (@as(u64, usertime.dwHighDateTime) << 32) | usertime.dwLowDateTime;
        if (temp > 0) {
            usage_info.utime.tv_sec = @intCast(temp / 10000000);
            usage_info.utime.tv_usec = @intCast(temp % 1000000);
        }
    }
    var counters: IO_COUNTERS = .{};
    _ = GetProcessIoCounters(process_pid, &counters);
    usage_info.inblock = counters.ReadOperationCount;
    usage_info.oublock = counters.WriteOperationCount;

    const memory = std.os.windows.GetProcessMemoryInfo(process_pid) catch return usage_info;
    usage_info.maxrss = memory.PeakWorkingSetSize / 1024;

    return usage_info;
}
const Rusage = if (Environment.isWindows) win_rusage else std.os.rusage;

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

    pid: if (Environment.isWindows) uv.uv_process_t else std.os.pid_t,
    // on macOS, this is nothing
    // on linux, it's a pidfd
    pidfd: if (Environment.isLinux) std.os.fd_t else u0 = std.math.maxInt(if (Environment.isLinux) std.os.fd_t else u0),
    pipes: if (Environment.isWindows) [3]uv.uv_pipe_t else u0 = if (Environment.isWindows) std.mem.zeroes([3]uv.uv_pipe_t) else 0,
    closed_streams: u8 = 0,
    deinit_onclose: bool = false,
    stdin: Writable,
    stdout: Readable,
    stderr: Readable,
    poll: Poll = Poll{ .poll_ref = null },
    stdio_pipes: std.ArrayListUnmanaged(Stdio.PipeExtra) = .{},

    exit_promise: JSC.Strong = .{},
    on_exit_callback: JSC.Strong = .{},

    exit_code: ?u8 = null,
    signal_code: ?SignalCode = null,
    waitpid_err: ?bun.sys.Error = null,

    globalThis: *JSC.JSGlobalObject,
    observable_getters: std.enums.EnumSet(enum {
        stdin,
        stdout,
        stderr,
    }) = .{},
    closed: std.enums.EnumSet(enum {
        stdin,
        stdout,
        stderr,
    }) = .{},
    has_pending_activity: std.atomic.Value(bool) = std.atomic.Value(bool).init(true),
    this_jsvalue: JSC.JSValue = .zero,

    ipc_mode: IPCMode,
    ipc_callback: JSC.Strong = .{},
    ipc: IPC.IPCData,
    flags: Flags = .{},
    pid_rusage: if (Environment.isWindows) ?win_rusage else ?Rusage = null,

    pub const Flags = packed struct(u3) {
        is_sync: bool = false,
        killed: bool = false,
        waiting_for_onexit: bool = false,
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
        if (Environment.isWindows) {
            if (this.pid_rusage == null) {
                this.pid_rusage = uv_getrusage(&this.pid);
                if (this.pid_rusage == null) {
                    return JSValue.jsUndefined();
                }
            }
        } else {
            if (this.pid_rusage == null) {
                return JSValue.jsUndefined();
            }
        }
        const pid_rusage = this.pid_rusage.?;
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
        return this.exit_code != null or this.waitpid_err != null or this.signal_code != null;
    }

    pub fn hasPendingActivityNonThreadsafe(this: *const Subprocess) bool {
        if (this.flags.waiting_for_onexit) {
            return true;
        }

        if (this.ipc_mode != .none) {
            return true;
        }

        if (this.poll == .poll_ref) {
            if (this.poll.poll_ref) |poll| {
                if (poll.isActive() or poll.isRegistered()) {
                    return true;
                }
            }
        }
        if (this.poll == .wait_thread and this.poll.wait_thread.ref_count.load(.Monotonic) > 0) {
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

    pub fn hasPendingActivity(this: *Subprocess) callconv(.C) bool {
        @fence(.Acquire);
        return this.has_pending_activity.load(.Acquire);
    }

    pub fn ref(this: *Subprocess) void {
        const vm = this.globalThis.bunVM();

        switch (this.poll) {
            .poll_ref => if (this.poll.poll_ref) |poll| {
                poll.ref(vm);
            },
            .wait_thread => |*wait_thread| {
                wait_thread.poll_ref.ref(vm);
            },
        }

        if (!this.hasCalledGetter(.stdin)) {
            this.stdin.ref();
        }

        if (!this.hasCalledGetter(.stdout)) {
            this.stdout.ref();
        }

        if (!this.hasCalledGetter(.stderr)) {
            this.stdout.ref();
        }
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub fn unref(this: *Subprocess, comptime deactivate_poll_ref: bool) void {
        const vm = this.globalThis.bunVM();

        switch (this.poll) {
            .poll_ref => if (this.poll.poll_ref) |poll| {
                if (deactivate_poll_ref) {
                    poll.onEnded(vm);
                } else {
                    poll.unref(vm);
                }
            },
            .wait_thread => |*wait_thread| {
                wait_thread.poll_ref.unref(vm);
            },
        }
        if (!this.hasCalledGetter(.stdin)) {
            this.stdin.unref();
        }

        if (!this.hasCalledGetter(.stdout)) {
            this.stdout.unref();
        }

        if (!this.hasCalledGetter(.stderr)) {
            this.stdout.unref();
        }
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

        pipe: Pipe,
        inherit: void,
        ignore: void,
        closed: void,

        pub fn ref(this: *Readable) void {
            switch (this.*) {
                .pipe => {
                    if (this.pipe == .buffer) {
                        if (Environment.isWindows) {
                            uv.uv_ref(@ptrCast(&this.pipe.buffer.stream));
                            return;
                        }
                        if (this.pipe.buffer.stream.poll_ref) |poll| {
                            poll.enableKeepingProcessAlive(JSC.VirtualMachine.get());
                        }
                    }
                },
                else => {},
            }
        }

        pub fn unref(this: *Readable) void {
            switch (this.*) {
                .pipe => {
                    if (this.pipe == .buffer) {
                        if (Environment.isWindows) {
                            uv.uv_unref(@ptrCast(&this.pipe.buffer.stream));
                            return;
                        }
                        if (this.pipe.buffer.stream.poll_ref) |poll| {
                            poll.disableKeepingProcessAlive(JSC.VirtualMachine.get());
                        }
                    }
                },
                else => {},
            }
        }

        pub const Pipe = union(enum) {
            stream: JSC.WebCore.ReadableStream,
            buffer: BufferedOutput,
            detached: void,

            pub fn finish(this: *@This()) void {
                if (this.* == .stream and this.stream.ptr == .File) {
                    this.stream.ptr.File.finish();
                }
            }

            pub fn done(this: *@This()) void {
                if (this.* == .detached)
                    return;

                if (this.* == .stream) {
                    if (this.stream.ptr == .File) this.stream.ptr.File.setSignal(JSC.WebCore.Signal{});
                    this.stream.done();
                    return;
                }

                this.buffer.close();
            }

            pub fn toJS(this: *@This(), readable: *Readable, globalThis: *JSC.JSGlobalObject, exited: bool) JSValue {
                if (comptime Environment.allow_assert)
                    std.debug.assert(this.* != .detached); // this should be cached by the getter

                if (this.* != .stream) {
                    const stream = this.buffer.toReadableStream(globalThis, exited);
                    // we do not detach on windows
                    if (Environment.isWindows) {
                        return stream.toJS();
                    }
                    this.* = .{ .stream = stream };
                }

                if (this.stream.ptr == .File) {
                    this.stream.ptr.File.setSignal(JSC.WebCore.Signal.init(readable));
                }

                const result = this.stream.toJS();
                this.* = .detached;
                return result;
            }
        };

        pub fn initWithPipe(stdio: Stdio, pipe: *uv.uv_pipe_t, allocator: std.mem.Allocator, max_size: u32) Readable {
            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ignore => Readable{ .ignore = {} },
                .pipe => brk: {
                    break :brk .{
                        .pipe = .{
                            .buffer = BufferedOutput.initWithPipeAndAllocator(allocator, pipe, max_size),
                        },
                    };
                },
                .path => Readable{ .ignore = {} },
                .blob, .fd => @panic("use init() instead"),
                .memfd => Readable{ .memfd = stdio.memfd },
                .array_buffer => Readable{
                    .pipe = .{
                        .buffer = BufferedOutput.initWithPipeAndSlice(pipe, stdio.array_buffer.slice()),
                    },
                },
            };
        }
        pub fn init(stdio: Stdio, fd: bun.FileDescriptor, allocator: std.mem.Allocator, max_size: u32) Readable {
            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ignore => Readable{ .ignore = {} },
                .pipe => brk: {
                    break :brk .{
                        .pipe = .{
                            .buffer = BufferedOutput.initWithAllocator(allocator, fd, max_size),
                        },
                    };
                },
                .path => Readable{ .ignore = {} },
                .blob, .fd => Readable{ .fd = fd },
                .memfd => Readable{ .memfd = stdio.memfd },
                .array_buffer => Readable{
                    .pipe = .{
                        .buffer = BufferedOutput.initWithSlice(fd, stdio.array_buffer.slice()),
                    },
                },
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
                    _ = bun.sys.close(fd);
                },
                .pipe => {
                    this.pipe.done();
                },
                else => {},
            }
        }

        pub fn setCloseCallbackIfPossible(this: *Readable, callback: CloseCallbackHandler) bool {
            switch (this.*) {
                .pipe => {
                    if (Environment.isWindows) {
                        if (uv.uv_is_closed(@ptrCast(this.pipe.buffer.stream))) {
                            return false;
                        }
                        this.pipe.buffer.closeCallback = callback;
                        return true;
                    }
                    return false;
                },
                else => return false,
            }
        }

        pub fn finalize(this: *Readable) void {
            switch (this.*) {
                inline .memfd, .fd => |fd| {
                    _ = bun.sys.close(fd);
                },
                .pipe => |*pipe| {
                    if (pipe.* == .detached) {
                        return;
                    }

                    if (pipe.* == .stream and pipe.stream.ptr == .File) {
                        this.close();
                        return;
                    }

                    pipe.buffer.close();
                },
                else => {},
            }
        }

        pub fn toJS(this: *Readable, globalThis: *JSC.JSGlobalObject, exited: bool) JSValue {
            switch (this.*) {
                // should only be reachable when the entire output is buffered.
                .memfd => return this.toBufferedValue(globalThis),

                .fd => |fd| {
                    return JSValue.jsNumber(fd);
                },
                .pipe => {
                    return this.pipe.toJS(this, globalThis, exited);
                },
                else => {
                    return JSValue.jsUndefined();
                },
            }
        }

        pub fn toBufferedValue(this: *Readable, globalThis: *JSC.JSGlobalObject) JSValue {
            switch (this.*) {
                .fd => |fd| {
                    return JSValue.jsNumber(fd);
                },
                .memfd => |fd| {
                    if (comptime !Environment.isPosix) {
                        Output.panic("memfd is only supported on Linux", .{});
                    }
                    this.* = .{ .closed = {} };
                    return JSC.ArrayBuffer.toJSBufferFromMemfd(fd, globalThis);
                },
                .pipe => {
                    if (!Environment.isWindows) {
                        this.pipe.buffer.stream.close_on_empty_read = true;
                        this.pipe.buffer.readAll();
                    }

                    const bytes = this.pipe.buffer.internal_buffer.slice();
                    this.pipe.buffer.internal_buffer = .{};

                    if (bytes.len > 0) {
                        // Return a Buffer so that they can do .toString() on it
                        return JSC.JSValue.createBuffer(globalThis, bytes, bun.default_allocator);
                    }

                    return JSC.JSValue.createBuffer(globalThis, &.{}, bun.default_allocator);
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
        return this.stderr.toJS(globalThis, this.exit_code != null);
    }

    pub fn getStdin(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        this.observable_getters.insert(.stdin);
        return this.stdin.toJS(globalThis);
    }

    pub fn getStdout(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        this.observable_getters.insert(.stdout);
        return this.stdout.toJS(globalThis, this.exit_code != null);
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
        var sig: i32 = 1;

        if (arguments.len > 0) {
            sig = arguments.ptr[0].coerce(i32, globalThis);
        }

        if (!(sig >= 0 and sig <= std.math.maxInt(u8))) {
            globalThis.throwInvalidArguments("Invalid signal: must be >= 0 and <= 255", .{});
            return .zero;
        }

        switch (this.tryKill(sig)) {
            .result => {},
            .err => |err| {
                globalThis.throwValue(err.toJSC(globalThis));
                return .zero;
            },
        }

        return JSValue.jsUndefined();
    }

    pub fn hasKilled(this: *const Subprocess) bool {
        return this.exit_code != null or this.signal_code != null;
    }

    pub fn tryKill(this: *Subprocess, sig: i32) JSC.Node.Maybe(void) {
        if (this.hasExited()) {
            return .{ .result = {} };
        }

        send_signal: {
            if (comptime Environment.isLinux) {
                // if these are the same, it means the pidfd is invalid.
                if (!WaiterThread.shouldUseWaiterThread()) {
                    // should this be handled differently?
                    // this effectively shouldn't happen
                    if (this.pidfd == bun.invalid_fd.int()) {
                        return .{ .result = {} };
                    }

                    // first appeared in Linux 5.1
                    const rc = std.os.linux.pidfd_send_signal(this.pidfd, @as(u8, @intCast(sig)), null, 0);

                    if (rc != 0) {
                        const errno = std.os.linux.getErrno(rc);

                        // if the process was already killed don't throw
                        if (errno != .SRCH and errno != .NOSYS)
                            return .{ .err = bun.sys.Error.fromCode(errno, .kill) };
                    } else {
                        break :send_signal;
                    }
                }
            }
            if (comptime Environment.isWindows) {
                if (std.os.windows.kernel32.TerminateProcess(this.pid.process_handle, @intCast(sig)) == 0) {
                    const err = bun.windows.getLastErrno();
                    if (comptime Environment.allow_assert) {
                        std.debug.assert(err != .UNKNOWN);
                    }

                    // if the process was already killed don't throw
                    //
                    // "After a process has terminated, call to TerminateProcess with open
                    // handles to the process fails with ERROR_ACCESS_DENIED (5) error code."
                    // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess
                    if (err != .PERM)
                        return .{ .err = bun.sys.Error.fromCode(err, .kill) };
                }

                return .{ .result = {} };
            }

            const err = std.c.kill(this.pid, sig);
            if (err != 0) {
                const errno = bun.C.getErrno(err);

                // if the process was already killed don't throw
                if (errno != .SRCH)
                    return .{ .err = bun.sys.Error.fromCode(errno, .kill) };
            }
        }

        return .{ .result = {} };
    }

    fn hasCalledGetter(this: *Subprocess, comptime getter: @Type(.EnumLiteral)) bool {
        return this.observable_getters.contains(getter);
    }

    fn closeProcess(this: *Subprocess) void {
        if (comptime !Environment.isLinux) {
            return;
        }

        const pidfd = this.pidfd;

        this.pidfd = bun.invalid_fd.int();

        if (pidfd != bun.invalid_fd.int()) {
            _ = bun.sys.close(bun.toFD(pidfd));
        }
    }

    pub fn doRef(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.ref();
        return JSC.JSValue.jsUndefined();
    }

    pub fn doUnref(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.unref(false);
        return JSC.JSValue.jsUndefined();
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

    pub fn getPid(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSValue.jsNumber(if (Environment.isWindows) this.pid.pid else this.pid);
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
        array.push(global, .null); // TODO: align this with options
        array.push(global, .null); // TODO: align this with options
        array.push(global, .null); // TODO: align this with options

        for (this.stdio_pipes.items) |item| {
            const uno: u32 = @intCast(item.fileno);
            for (0..array.getLength(global) - uno) |_| array.push(global, .null);
            array.push(global, JSValue.jsNumber(item.fd));
        }
        return array;
    }

    pub const BufferedPipeInput = struct {
        remain: []const u8 = "",
        input_buffer: uv.uv_buf_t = std.mem.zeroes(uv.uv_buf_t),
        write_req: uv.uv_write_t = std.mem.zeroes(uv.uv_write_t),
        pipe: ?*uv.uv_pipe_t,
        poll_ref: ?*Async.FilePoll = null,
        written: usize = 0,
        deinit_onclose: bool = false,
        closeCallback: CloseCallbackHandler = CloseCallbackHandler.Empty,

        source: union(enum) {
            blob: JSC.WebCore.AnyBlob,
            array_buffer: JSC.ArrayBuffer.Strong,
        },

        pub fn writeIfPossible(this: *BufferedPipeInput, comptime is_sync: bool) void {
            this.writeAllowBlocking(is_sync);
        }

        pub fn uvWriteCallback(req: *uv.uv_write_t, status: uv.ReturnCode) callconv(.C) void {
            const this = bun.cast(*BufferedPipeInput, req.data);
            if (this.pipe == null) return;
            if (status.errEnum()) |_| {
                log("uv_write({d}) fail: {d}", .{ this.remain.len, status.int() });
                this.deinit();
                return;
            }

            this.written += this.remain.len;
            this.remain = "";
            // we are done!
            this.close();
        }

        pub fn writeAllowBlocking(this: *BufferedPipeInput, allow_blocking: bool) void {
            const pipe = this.pipe orelse return;

            var to_write = this.remain;

            this.input_buffer = uv.uv_buf_t.init(to_write);
            if (allow_blocking) {
                while (true) {
                    if (to_write.len == 0) {
                        // we are done!
                        this.close();
                        return;
                    }
                    const status = uv.uv_try_write(@ptrCast(pipe), @ptrCast(&this.input_buffer), 1);
                    if (status.errEnum()) |err| {
                        if (err == bun.C.E.AGAIN) {
                            //EAGAIN
                            this.write_req.data = this;
                            const write_err = uv.uv_write(&this.write_req, @ptrCast(pipe), @ptrCast(&this.input_buffer), 1, BufferedPipeInput.uvWriteCallback).int();
                            if (write_err < 0) {
                                log("uv_write({d}) fail: {d}", .{ this.remain.len, write_err });
                                this.deinit();
                            }
                            return;
                        }
                        // fail
                        log("uv_try_write({d}) fail: {d}", .{ to_write.len, status.int() });
                        this.deinit();
                        return;
                    }
                    const bytes_written: usize = @intCast(status.int());
                    this.written += bytes_written;
                    this.remain = this.remain[@min(bytes_written, this.remain.len)..];
                    to_write = to_write[bytes_written..];
                }
            } else {
                this.write_req.data = this;
                const err = uv.uv_write(&this.write_req, @ptrCast(pipe), @ptrCast(&this.input_buffer), 1, BufferedPipeInput.uvWriteCallback).int();
                if (err < 0) {
                    log("uv_write({d}) fail: {d}", .{ this.remain.len, err });
                    this.deinit();
                }
            }
        }

        pub fn write(this: *BufferedPipeInput) void {
            this.writeAllowBlocking(false);
        }

        fn destroy(this: *BufferedPipeInput) void {
            defer this.closeCallback.run();

            this.pipe = null;
            switch (this.source) {
                .blob => |*blob| {
                    blob.detach();
                },
                .array_buffer => |*array_buffer| {
                    array_buffer.deinit();
                },
            }
        }

        fn uvClosedCallback(handler: *anyopaque) callconv(.C) void {
            const event = bun.cast(*uv.uv_pipe_t, handler);
            var this = bun.cast(*BufferedPipeInput, event.data);
            if (this.deinit_onclose) {
                this.destroy();
            }
        }

        fn close(this: *BufferedPipeInput) void {
            if (this.poll_ref) |poll| {
                this.poll_ref = null;
                poll.deinit();
            }

            if (this.pipe) |pipe| {
                pipe.data = this;
                _ = uv.uv_close(@ptrCast(pipe), BufferedPipeInput.uvClosedCallback);
            }
        }

        pub fn deinit(this: *BufferedPipeInput) void {
            this.deinit_onclose = true;
            this.close();

            if (this.pipe == null or uv.uv_is_closed(@ptrCast(this.pipe.?))) {
                this.destroy();
            }
        }
    };

    pub const BufferedInput = struct {
        remain: []const u8 = "",
        fd: bun.FileDescriptor = bun.invalid_fd,
        poll_ref: ?*Async.FilePoll = null,
        written: usize = 0,

        source: union(enum) {
            blob: JSC.WebCore.AnyBlob,
            array_buffer: JSC.ArrayBuffer.Strong,
        },

        pub const event_loop_kind = JSC.EventLoopKind.js;

        pub usingnamespace JSC.WebCore.NewReadyWatcher(BufferedInput, .writable, onReady);

        pub fn onReady(this: *BufferedInput, _: i64) void {
            if (this.fd == bun.invalid_fd) {
                return;
            }

            this.write();
        }

        pub fn writeIfPossible(this: *BufferedInput, comptime is_sync: bool) void {
            if (comptime !is_sync) {

                // we ask, "Is it possible to write right now?"
                // we do this rather than epoll or kqueue()
                // because we don't want to block the thread waiting for the write
                switch (bun.isWritable(this.fd)) {
                    .ready => {
                        if (this.poll_ref) |poll| {
                            poll.flags.insert(.writable);
                            poll.flags.insert(.fifo);
                            std.debug.assert(poll.flags.contains(.poll_writable));
                        }
                    },
                    .hup => {
                        this.deinit();
                        return;
                    },
                    .not_ready => {
                        if (!this.isWatching()) this.watch(this.fd);
                        return;
                    },
                }
            }

            this.writeAllowBlocking(is_sync);
        }

        pub fn write(this: *BufferedInput) void {
            this.writeAllowBlocking(false);
        }

        pub fn writeAllowBlocking(this: *BufferedInput, allow_blocking: bool) void {
            var to_write = this.remain;

            if (to_write.len == 0) {
                // we are done!
                this.closeFDIfOpen();
                return;
            }

            if (comptime bun.Environment.allow_assert) {
                // bun.assertNonBlocking(this.fd);
            }

            while (to_write.len > 0) {
                switch (bun.sys.write(this.fd, to_write)) {
                    .err => |e| {
                        if (e.isRetry()) {
                            log("write({d}) retry", .{
                                to_write.len,
                            });

                            this.watch(this.fd);
                            this.poll_ref.?.flags.insert(.fifo);
                            return;
                        }

                        if (e.getErrno() == .PIPE) {
                            this.deinit();
                            return;
                        }

                        // fail
                        log("write({d}) fail: {d}", .{ to_write.len, e.errno });
                        this.deinit();
                        return;
                    },

                    .result => |bytes_written| {
                        this.written += bytes_written;

                        log(
                            "write({d}) {d}",
                            .{
                                to_write.len,
                                bytes_written,
                            },
                        );

                        this.remain = this.remain[@min(bytes_written, this.remain.len)..];
                        to_write = to_write[bytes_written..];

                        // we are done or it accepts no more input
                        if (this.remain.len == 0 or (allow_blocking and bytes_written == 0)) {
                            this.deinit();
                            return;
                        }
                    },
                }
            }
        }

        fn closeFDIfOpen(this: *BufferedInput) void {
            if (this.poll_ref) |poll| {
                this.poll_ref = null;
                poll.deinit();
            }

            if (this.fd != bun.invalid_fd) {
                _ = bun.sys.close(this.fd);
                this.fd = bun.invalid_fd;
            }
        }

        pub fn deinit(this: *BufferedInput) void {
            this.closeFDIfOpen();

            switch (this.source) {
                .blob => |*blob| {
                    blob.detach();
                },
                .array_buffer => |*array_buffer| {
                    array_buffer.deinit();
                },
            }
        }
    };

    pub const BufferedOutput = struct {
        internal_buffer: bun.ByteList = .{},
        stream: FIFOType = undefined,
        auto_sizer: ?JSC.WebCore.AutoSizer = null,
        /// stream strong ref if any is available
        readable_stream_ref: if (Environment.isWindows) JSC.WebCore.ReadableStream.Strong else u0 = if (Environment.isWindows) .{} else 0,
        globalThis: if (Environment.isWindows) ?*JSC.JSGlobalObject else u0 = if (Environment.isWindows) null else 0,
        status: Status = .{
            .pending = {},
        },
        closeCallback: CloseCallbackHandler = CloseCallbackHandler.Empty,

        const FIFOType = if (Environment.isWindows) *uv.uv_pipe_t else JSC.WebCore.FIFO;
        pub const Status = union(enum) {
            pending: void,
            done: void,
            err: bun.sys.Error,
        };

        pub fn init(fd: bun.FileDescriptor) BufferedOutput {
            if (Environment.isWindows) {
                @compileError("Cannot use BufferedOutput with fd on Windows please use .initWithPipe");
            }
            return BufferedOutput{
                .internal_buffer = .{},
                .stream = JSC.WebCore.FIFO{
                    .fd = fd,
                },
            };
        }

        pub fn initWithPipe(pipe: *uv.uv_pipe_t) BufferedOutput {
            if (!Environment.isWindows) {
                @compileError("uv.uv_pipe_t can only be used on Windows");
            }
            return BufferedOutput{ .internal_buffer = .{}, .stream = pipe };
        }

        pub fn initWithSlice(fd: bun.FileDescriptor, slice: []u8) BufferedOutput {
            if (Environment.isWindows) {
                @compileError("Cannot use BufferedOutput with fd on Windows please use .initWithPipeAndSlice");
            }
            return BufferedOutput{
                // fixed capacity
                .internal_buffer = bun.ByteList.initWithBuffer(slice),
                .auto_sizer = null,
                .stream = JSC.WebCore.FIFO{
                    .fd = fd,
                },
            };
        }

        pub fn initWithPipeAndSlice(pipe: *uv.uv_pipe_t, slice: []u8) BufferedOutput {
            if (!Environment.isWindows) {
                @compileError("uv.uv_pipe_t can only be used on Window");
            }
            return BufferedOutput{
                // fixed capacity
                .internal_buffer = bun.ByteList.initWithBuffer(slice),
                .auto_sizer = null,
                .stream = pipe,
            };
        }

        pub fn initWithAllocator(allocator: std.mem.Allocator, fd: bun.FileDescriptor, max_size: u32) BufferedOutput {
            if (Environment.isWindows) {
                @compileError("Cannot use BufferedOutput with fd on Windows please use .initWithPipeAndAllocator");
            }
            var this = init(fd);
            this.auto_sizer = .{
                .max = max_size,
                .allocator = allocator,
                .buffer = &this.internal_buffer,
            };
            return this;
        }

        pub fn initWithPipeAndAllocator(allocator: std.mem.Allocator, pipe: *uv.uv_pipe_t, max_size: u32) BufferedOutput {
            if (!Environment.isWindows) {
                @compileError("uv.uv_pipe_t can only be used on Window");
            }
            var this = initWithPipe(pipe);
            this.auto_sizer = .{
                .max = max_size,
                .allocator = allocator,
                .buffer = &this.internal_buffer,
            };
            return this;
        }

        pub fn onRead(this: *BufferedOutput, result: JSC.WebCore.StreamResult) void {
            if (Environment.isWindows) {
                @compileError("uv.uv_pipe_t can only be used on Window");
            }
            switch (result) {
                .pending => {
                    this.watch();
                    return;
                },
                .err => |err| {
                    if (err == .Error) {
                        this.status = .{ .err = err.Error };
                    } else {
                        this.status = .{ .err = bun.sys.Error.fromCode(.CANCELED, .read) };
                    }
                    this.stream.close();

                    return;
                },
                .done => {
                    this.status = .{ .done = {} };
                    this.stream.close();
                    return;
                },
                else => {
                    const slice = result.slice();
                    this.internal_buffer.len += @as(u32, @truncate(slice.len));
                    if (slice.len > 0)
                        std.debug.assert(this.internal_buffer.contains(slice));

                    if (result.isDone() or (slice.len == 0 and this.stream.poll_ref != null and this.stream.poll_ref.?.isHUP())) {
                        this.status = .{ .done = {} };
                        this.stream.close();
                    }
                },
            }
        }

        fn uvStreamReadCallback(handle: *uv.uv_handle_t, nread: isize, buffer: *const uv.uv_buf_t) callconv(.C) void {
            const this: *BufferedOutput = @ptrCast(@alignCast(handle.data));
            if (nread <= 0) {
                switch (nread) {
                    0 => {
                        // EAGAIN or EWOULDBLOCK
                        return;
                    },
                    uv.UV_EOF => {
                        this.status = .{ .done = {} };
                        _ = uv.uv_read_stop(@ptrCast(handle));
                        this.flushBufferedDataIntoReadableStream();
                    },
                    else => {
                        const rt = uv.ReturnCodeI64{
                            .value = @intCast(nread),
                        };
                        const err = rt.errEnum() orelse bun.C.E.CANCELED;
                        this.status = .{ .err = bun.sys.Error.fromCode(err, .read) };
                        _ = uv.uv_read_stop(@ptrCast(handle));
                        this.signalStreamError();
                    },
                }

                // when nread < 0 buffer maybe not point to a valid address
                return;
            }

            this.internal_buffer.len += @as(u32, @truncate(buffer.len));
            this.flushBufferedDataIntoReadableStream();
        }

        fn uvStreamAllocCallback(handle: *uv.uv_handle_t, suggested_size: usize, buffer: *uv.uv_buf_t) callconv(.C) void {
            const this: *BufferedOutput = @ptrCast(@alignCast(handle.data));
            var size: usize = 0;
            var available = this.internal_buffer.available();
            if (this.auto_sizer) |auto_sizer| {
                size = auto_sizer.max - this.internal_buffer.len;
                if (size > suggested_size) {
                    size = suggested_size;
                }

                if (available.len < size and this.internal_buffer.len < auto_sizer.max) {
                    this.internal_buffer.ensureUnusedCapacity(auto_sizer.allocator, size) catch bun.outOfMemory();
                    available = this.internal_buffer.available();
                }
            } else {
                size = available.len;
                if (size > suggested_size) {
                    size = suggested_size;
                }
            }
            buffer.* = .{ .base = @ptrCast(available.ptr), .len = @intCast(size) };
            if (size == 0) {
                _ = uv.uv_read_stop(@ptrCast(@alignCast(handle)));
                this.status = .{ .done = {} };
            }
        }

        pub fn readAll(this: *BufferedOutput) void {
            if (Environment.isWindows) {
                if (this.status == .pending) {
                    this.stream.data = this;
                    _ = uv.uv_read_start(@ptrCast(this.stream), BufferedOutput.uvStreamAllocCallback, BufferedOutput.uvStreamReadCallback);
                }
                return;
            }
            if (this.auto_sizer) |auto_sizer| {
                while (@as(usize, this.internal_buffer.len) < auto_sizer.max and this.status == .pending) {
                    var stack_buffer: [8192]u8 = undefined;
                    const stack_buf: []u8 = stack_buffer[0..];
                    var buf_to_use = stack_buf;
                    const available = this.internal_buffer.available();
                    if (available.len >= stack_buf.len) {
                        buf_to_use = available;
                    }

                    const result = this.stream.read(buf_to_use, this.stream.to_read);

                    switch (result) {
                        .pending => {
                            this.watch();
                            return;
                        },
                        .err => |err| {
                            this.status = .{ .err = err };
                            this.stream.close();

                            return;
                        },
                        .done => {
                            this.status = .{ .done = {} };
                            this.stream.close();
                            return;
                        },
                        .read => |slice| {
                            if (slice.ptr == stack_buf.ptr) {
                                this.internal_buffer.append(auto_sizer.allocator, slice) catch @panic("out of memory");
                            } else {
                                this.internal_buffer.len += @as(u32, @truncate(slice.len));
                            }

                            if (slice.len < buf_to_use.len) {
                                this.watch();
                                return;
                            }
                        },
                    }
                }
            } else {
                while (this.internal_buffer.len < this.internal_buffer.cap and this.status == .pending) {
                    const buf_to_use = this.internal_buffer.available();

                    const result = this.stream.read(buf_to_use, this.stream.to_read);

                    switch (result) {
                        .pending => {
                            this.watch();
                            return;
                        },
                        .err => |err| {
                            this.status = .{ .err = err };
                            this.stream.close();

                            return;
                        },
                        .done => {
                            this.status = .{ .done = {} };
                            this.stream.close();
                            return;
                        },
                        .read => |slice| {
                            this.internal_buffer.len += @as(u32, @truncate(slice.len));

                            if (slice.len < buf_to_use.len) {
                                this.watch();
                                return;
                            }
                        },
                    }
                }
            }
        }

        fn watch(this: *BufferedOutput) void {
            if (Environment.isWindows) {
                this.readAll();
            } else {
                std.debug.assert(this.stream.fd != bun.invalid_fd);
                this.stream.pending.set(BufferedOutput, this, onRead);
                if (!this.stream.isWatching()) this.stream.watch(this.stream.fd);
            }
            return;
        }

        pub fn toBlob(this: *BufferedOutput, globalThis: *JSC.JSGlobalObject) JSC.WebCore.Blob {
            const blob = JSC.WebCore.Blob.init(this.internal_buffer.slice(), bun.default_allocator, globalThis);
            this.internal_buffer = bun.ByteList.init("");
            return blob;
        }

        pub fn onStartStreamingRequestBodyCallback(ctx: *anyopaque) JSC.WebCore.DrainResult {
            const this = bun.cast(*BufferedOutput, ctx);
            this.readAll();
            const internal_buffer = this.internal_buffer;
            this.internal_buffer = bun.ByteList.init("");

            return .{
                .owned = .{
                    .list = internal_buffer.listManaged(bun.default_allocator),
                    .size_hint = internal_buffer.len,
                },
            };
        }

        fn signalStreamError(this: *BufferedOutput) void {
            if (this.status == .err) {
                // if we are streaming update with error
                if (this.readable_stream_ref.get()) |readable| {
                    if (readable.ptr == .Bytes) {
                        readable.ptr.Bytes.onData(
                            .{
                                .err = .{ .Error = this.status.err },
                            },
                            bun.default_allocator,
                        );
                    }
                }
                // after error we dont need the ref anymore
                this.readable_stream_ref.deinit();
            }
        }
        fn flushBufferedDataIntoReadableStream(this: *BufferedOutput) void {
            if (this.readable_stream_ref.get()) |readable| {
                if (readable.ptr != .Bytes) return;

                const internal_buffer = this.internal_buffer;
                const isDone = this.status != .pending;

                if (internal_buffer.len > 0 or isDone) {
                    readable.ptr.Bytes.size_hint += internal_buffer.len;
                    if (isDone) {
                        readable.ptr.Bytes.onData(
                            .{
                                .temporary_and_done = internal_buffer,
                            },
                            bun.default_allocator,
                        );
                        // no need to keep the ref anymore
                        this.readable_stream_ref.deinit();
                    } else {
                        readable.ptr.Bytes.onData(
                            .{
                                .temporary = internal_buffer,
                            },
                            bun.default_allocator,
                        );
                    }
                    this.internal_buffer.len = 0;
                }
            }
        }

        fn onReadableStreamAvailable(ctx: *anyopaque, readable: JSC.WebCore.ReadableStream) void {
            const this = bun.cast(*BufferedOutput, ctx);
            if (this.globalThis) |globalThis| {
                this.readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(readable, globalThis) catch .{};
            }
        }

        fn toReadableStream(this: *BufferedOutput, globalThis: *JSC.JSGlobalObject, exited: bool) JSC.WebCore.ReadableStream {
            if (Environment.isWindows) {
                if (this.readable_stream_ref.get()) |readable| {
                    return readable;
                }
            }

            if (exited) {
                // exited + received EOF => no more read()
                const isClosed = if (Environment.isWindows) this.status != .pending else this.stream.isClosed();
                if (isClosed) {
                    // also no data at all
                    if (this.internal_buffer.len == 0) {
                        if (this.internal_buffer.cap > 0) {
                            if (this.auto_sizer) |auto_sizer| {
                                this.internal_buffer.deinitWithAllocator(auto_sizer.allocator);
                            }
                        }
                        // so we return an empty stream
                        return JSC.WebCore.ReadableStream.fromJS(
                            JSC.WebCore.ReadableStream.empty(globalThis),
                            globalThis,
                        ).?;
                    }

                    return JSC.WebCore.ReadableStream.fromJS(
                        JSC.WebCore.ReadableStream.fromBlob(
                            globalThis,
                            &this.toBlob(globalThis),
                            0,
                        ),
                        globalThis,
                    ).?;
                }
            }

            if (Environment.isWindows) {
                this.globalThis = globalThis;
                var body = Body.Value{
                    .Locked = .{
                        .size_hint = 0,
                        .task = this,
                        .global = globalThis,
                        .onStartStreaming = BufferedOutput.onStartStreamingRequestBodyCallback,
                        .onReadableStreamAvailable = BufferedOutput.onReadableStreamAvailable,
                    },
                };
                return JSC.WebCore.ReadableStream.fromJS(body.toReadableStream(globalThis), globalThis).?;
            }

            {
                const internal_buffer = this.internal_buffer;
                this.internal_buffer = bun.ByteList.init("");

                // There could still be data waiting to be read in the pipe
                // so we need to create a new stream that will read from the
                // pipe and then return the blob.
                const result = JSC.WebCore.ReadableStream.fromJS(
                    JSC.WebCore.ReadableStream.fromFIFO(
                        globalThis,
                        &this.stream,
                        internal_buffer,
                    ),
                    globalThis,
                ).?;
                this.stream.fd = bun.invalid_fd;
                this.stream.poll_ref = null;
                return result;
            }
        }

        fn uvClosedCallback(handler: *anyopaque) callconv(.C) void {
            const event = bun.cast(*uv.uv_pipe_t, handler);
            var this = bun.cast(*BufferedOutput, event.data);
            this.readable_stream_ref.deinit();
            this.closeCallback.run();
        }

        pub fn close(this: *BufferedOutput) void {
            var needCallbackCall = true;
            switch (this.status) {
                .done => {},
                .pending => {
                    if (Environment.isWindows) {
                        needCallbackCall = false;
                        _ = uv.uv_read_stop(@ptrCast(&this.stream));
                        if (uv.uv_is_closed(@ptrCast(&this.stream))) {
                            this.readable_stream_ref.deinit();
                            this.closeCallback.run();
                        } else {
                            _ = uv.uv_close(@ptrCast(&this.stream), BufferedOutput.uvClosedCallback);
                        }
                    } else {
                        this.stream.close();
                        this.closeCallback.run();
                    }
                    this.status = .{ .done = {} };
                },
                .err => {},
            }

            if (this.internal_buffer.cap > 0) {
                this.internal_buffer.listManaged(bun.default_allocator).deinit();
                this.internal_buffer = .{};
            }

            if (Environment.isWindows and needCallbackCall) {
                this.closeCallback.run();
            }
        }
    };

    const SinkType = if (Environment.isWindows) *JSC.WebCore.UVStreamSink else *JSC.WebCore.FileSink;
    const BufferedInputType = if (Environment.isWindows) BufferedPipeInput else BufferedInput;
    const Writable = union(enum) {
        pipe: SinkType,
        pipe_to_readable_stream: struct {
            pipe: SinkType,
            readable_stream: JSC.WebCore.ReadableStream,
        },
        fd: bun.FileDescriptor,
        buffered_input: BufferedInputType,
        memfd: bun.FileDescriptor,
        inherit: void,
        ignore: void,

        pub fn ref(this: *Writable) void {
            switch (this.*) {
                .pipe => {
                    if (Environment.isWindows) {
                        _ = uv.uv_ref(@ptrCast(this.pipe.stream));
                    } else if (this.pipe.poll_ref) |poll| {
                        poll.enableKeepingProcessAlive(JSC.VirtualMachine.get());
                    }
                },
                else => {},
            }
        }

        pub fn unref(this: *Writable) void {
            switch (this.*) {
                .pipe => {
                    if (Environment.isWindows) {
                        _ = uv.uv_unref(@ptrCast(this.pipe.stream));
                    } else if (this.pipe.poll_ref) |poll| {
                        poll.disableKeepingProcessAlive(JSC.VirtualMachine.get());
                    }
                },
                else => {},
            }
        }

        // When the stream has closed we need to be notified to prevent a use-after-free
        // We can test for this use-after-free by enabling hot module reloading on a file and then saving it twice
        pub fn onClose(this: *Writable, _: ?bun.sys.Error) void {
            this.* = .{
                .ignore = {},
            };
        }
        pub fn onReady(_: *Writable, _: ?JSC.WebCore.Blob.SizeType, _: ?JSC.WebCore.Blob.SizeType) void {}
        pub fn onStart(_: *Writable) void {}

        pub fn initWithPipe(stdio: Stdio, pipe: *uv.uv_pipe_t, globalThis: *JSC.JSGlobalObject) !Writable {
            switch (stdio) {
                .pipe => |maybe_readable| {
                    const sink = try globalThis.bunVM().allocator.create(JSC.WebCore.UVStreamSink);
                    sink.* = .{
                        .buffer = bun.ByteList{},
                        .stream = @ptrCast(pipe),
                        .allocator = globalThis.bunVM().allocator,
                        .done = false,
                        .signal = .{},
                        .next = null,
                    };

                    if (maybe_readable) |readable| {
                        return Writable{
                            .pipe_to_readable_stream = .{
                                .pipe = sink,
                                .readable_stream = readable,
                            },
                        };
                    }

                    return Writable{ .pipe = sink };
                },
                .array_buffer, .blob => {
                    var buffered_input: BufferedPipeInput = .{ .pipe = pipe, .source = undefined };
                    switch (stdio) {
                        .array_buffer => |array_buffer| {
                            buffered_input.source = .{ .array_buffer = array_buffer };
                        },
                        .blob => |blob| {
                            buffered_input.source = .{ .blob = blob };
                        },
                        else => unreachable,
                    }
                    return Writable{ .buffered_input = buffered_input };
                },
                .memfd => {
                    return Writable{ .memfd = stdio.memfd };
                },
                .fd => |fd| {
                    return Writable{ .fd = fd };
                },
                .inherit => {
                    return Writable{ .inherit = {} };
                },
                .path, .ignore => {
                    return Writable{ .ignore = {} };
                },
            }
        }
        pub fn init(stdio: Stdio, fd: bun.FileDescriptor, globalThis: *JSC.JSGlobalObject) !Writable {
            switch (stdio) {
                .pipe => |maybe_readable| {
                    if (Environment.isWindows) @panic("TODO");
                    var sink = try globalThis.bunVM().allocator.create(JSC.WebCore.FileSink);
                    sink.* = .{
                        .fd = fd,
                        .buffer = bun.ByteList{},
                        .allocator = globalThis.bunVM().allocator,
                        .auto_close = true,
                    };
                    sink.mode = bun.S.IFIFO;
                    sink.watch(fd);
                    if (maybe_readable) |readable| {
                        return Writable{
                            .pipe_to_readable_stream = .{
                                .pipe = sink,
                                .readable_stream = readable,
                            },
                        };
                    }

                    return Writable{ .pipe = sink };
                },
                .array_buffer, .blob => {
                    var buffered_input: BufferedInput = .{ .fd = fd, .source = undefined };
                    switch (stdio) {
                        .array_buffer => |array_buffer| {
                            buffered_input.source = .{ .array_buffer = array_buffer };
                        },
                        .blob => |blob| {
                            buffered_input.source = .{ .blob = blob };
                        },
                        else => unreachable,
                    }
                    return Writable{ .buffered_input = buffered_input };
                },
                .memfd => {
                    return Writable{ .memfd = stdio.memfd };
                },
                .fd => {
                    return Writable{ .fd = fd };
                },
                .inherit => {
                    return Writable{ .inherit = {} };
                },
                .path, .ignore => {
                    return Writable{ .ignore = {} };
                },
            }
        }

        pub fn toJS(this: Writable, globalThis: *JSC.JSGlobalObject) JSValue {
            return switch (this) {
                .pipe => |pipe| pipe.toJS(globalThis),
                .fd => |fd| JSValue.jsNumber(fd),
                .memfd, .ignore => JSValue.jsUndefined(),
                .inherit => JSValue.jsUndefined(),
                .buffered_input => JSValue.jsUndefined(),
                .pipe_to_readable_stream => this.pipe_to_readable_stream.readable_stream.value,
            };
        }

        pub fn finalize(this: *Writable) void {
            return switch (this.*) {
                .pipe => |pipe| {
                    pipe.close();
                },
                .pipe_to_readable_stream => |*pipe_to_readable_stream| {
                    _ = pipe_to_readable_stream.pipe.end(null);
                },
                inline .memfd, .fd => |fd| {
                    _ = bun.sys.close(fd);
                    this.* = .{ .ignore = {} };
                },
                .buffered_input => {
                    this.buffered_input.deinit();
                },
                .ignore => {},
                .inherit => {},
            };
        }

        pub fn setCloseCallbackIfPossible(this: *Writable, callback: CloseCallbackHandler) bool {
            switch (this.*) {
                .pipe => |pipe| {
                    if (Environment.isWindows) {
                        if (pipe.isClosed()) {
                            return false;
                        }
                        pipe.closeCallback = callback;
                        return true;
                    }
                    return false;
                },
                .pipe_to_readable_stream => |*pipe_to_readable_stream| {
                    if (Environment.isWindows) {
                        if (pipe_to_readable_stream.pipe.isClosed()) {
                            return false;
                        }
                        pipe_to_readable_stream.pipe.closeCallback = callback;
                        return true;
                    }
                    return false;
                },
                .buffered_input => {
                    if (Environment.isWindows) {
                        this.buffered_input.closeCallback = callback;
                        return true;
                    }
                    return false;
                },
                else => return false,
            }
        }

        pub fn close(this: *Writable) void {
            switch (this.*) {
                .pipe => {},
                .pipe_to_readable_stream => |*pipe_to_readable_stream| {
                    _ = pipe_to_readable_stream.pipe.end(null);
                },
                inline .memfd, .fd => |fd| {
                    _ = bun.sys.close(fd);
                    this.* = .{ .ignore = {} };
                },
                .buffered_input => {
                    this.buffered_input.deinit();
                },
                .ignore => {},
                .inherit => {},
            }
        }
    };

    fn closeIOCallback(this: *Subprocess) void {
        log("closeIOCallback", .{});
        this.closed_streams += 1;
        if (this.closed_streams == @TypeOf(this.closed).len) {
            this.exit_promise.deinit();
            this.on_exit_callback.deinit();
            this.stdio_pipes.deinit(bun.default_allocator);

            if (this.deinit_onclose) {
                log("destroy", .{});
                bun.default_allocator.destroy(this);
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

        const closeCallback = CloseCallbackHandler.init(this, @ptrCast(&Subprocess.closeIOCallback));
        const isAsync = @field(this, @tagName(io)).setCloseCallbackIfPossible(closeCallback);

        if (!this.hasCalledGetter(io)) {
            @field(this, @tagName(io)).finalize();
        } else {
            @field(this, @tagName(io)).close();
        }

        if (!isAsync) {
            // close is sync
            closeCallback.run();
        }
    }

    // This must only be run once per Subprocess
    pub fn finalizeStreams(this: *Subprocess) void {
        log("finalizeStreams", .{});
        this.closeProcess();

        this.closeIO(.stdin);
        this.closeIO(.stdout);
        this.closeIO(.stderr);
    }

    pub fn finalize(this: *Subprocess) callconv(.C) void {
        log("finalize", .{});
        std.debug.assert(!this.hasPendingActivity());
        if (this.closed_streams == @TypeOf(this.closed).len) {
            log("destroy", .{});
            bun.default_allocator.destroy(this);
        } else {
            this.deinit_onclose = true;
            this.finalizeStreams();
        }
    }

    pub fn getExited(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.hasExited()) {
            const waitpid_error = this.waitpid_err;
            if (this.exit_code) |code| {
                return JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(code));
            } else if (waitpid_error) |err| {
                return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
            } else if (this.signal_code != null) {
                return JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(128 +% @intFromEnum(this.signal_code.?)));
            } else {
                @panic("Subprocess.getExited() has exited but has no exit code or signal code. This is a bug.");
            }
        }

        if (!this.exit_promise.has()) {
            this.exit_promise.set(globalThis, JSC.JSPromise.create(globalThis).asValue(globalThis));
        }

        return this.exit_promise.get().?;
    }

    pub fn getExitCode(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.exit_code) |code| {
            return JSC.JSValue.jsNumber(code);
        }
        return JSC.JSValue.jsNull();
    }

    pub fn getSignalCode(
        this: *Subprocess,
        global: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.signal_code) |signal| {
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
            .{ .pipe = null },
            .{ .inherit = {} },
        };

        if (comptime is_sync) {
            stdio[1] = .{ .pipe = null };
            stdio[2] = .{ .pipe = null };
        }
        var lazy = false;
        var on_exit_callback = JSValue.zero;
        var PATH = jsc_vm.bundler.env.get("PATH") orelse "";
        var argv: std.ArrayListUnmanaged(?[*:0]const u8) = undefined;
        var cmd_value = JSValue.zero;
        var detached = false;
        var args = args_;
        var ipc_mode = IPCMode.none;
        var ipc_callback: JSValue = .zero;
        var stdio_pipes: std.ArrayListUnmanaged(Stdio.PipeExtra) = .{};
        var pipes_to_close: std.ArrayListUnmanaged(bun.FileDescriptor) = .{};
        defer {
            for (pipes_to_close.items) |pipe_fd| {
                _ = bun.sys.close(pipe_fd);
            }
            pipes_to_close.clearAndFree(bun.default_allocator);
        }

        var windows_hide: if (Environment.isWindows) u1 else u0 = 0;

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
            } else if (args.get(globalThis, "cmd")) |cmd_value_| {
                cmd_value = cmd_value_;
            } else {
                globalThis.throwInvalidArguments("cmd must be an array", .{});
                return .zero;
            }

            {
                var cmds_array = cmd_value.arrayIterator(globalThis);
                argv = @TypeOf(argv).initCapacity(allocator, cmds_array.len) catch {
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
                    var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    const resolved = Which.which(&path_buf, PATH, cwd, arg0.slice()) orelse {
                        globalThis.throwInvalidArguments("Executable not found in $PATH: \"{s}\"", .{arg0.slice()});
                        return .zero;
                    };
                    argv.appendAssumeCapacity(allocator.dupeZ(u8, bun.span(resolved)) catch {
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
                if (args.get(globalThis, "cwd")) |cwd_| {
                    // ignore definitely invalid cwd
                    if (!cwd_.isEmptyOrUndefinedOrNull()) {
                        const cwd_str = cwd_.getZigString(globalThis);
                        if (cwd_str.len > 0) {
                            // TODO: leak?
                            cwd = cwd_str.toOwnedSliceZ(allocator) catch {
                                globalThis.throwOutOfMemory();
                                return .zero;
                            };
                        }
                    }
                }

                if (args.get(globalThis, "onExit")) |onExit_| {
                    if (!onExit_.isEmptyOrUndefinedOrNull()) {
                        if (!onExit_.isCell() or !onExit_.isCallable(globalThis.vm())) {
                            globalThis.throwInvalidArguments("onExit must be a function or undefined", .{});
                            return .zero;
                        }

                        on_exit_callback = if (comptime is_sync)
                            onExit_
                        else
                            onExit_.withAsyncContextIfNeeded(globalThis);
                    }
                }

                if (args.get(globalThis, "env")) |object| {
                    if (!object.isEmptyOrUndefinedOrNull()) {
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
                        env_array.ensureTotalCapacityPrecise(allocator, object_iter.len) catch {
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
                }

                if (args.get(globalThis, "stdio")) |stdio_val| {
                    if (!stdio_val.isEmptyOrUndefinedOrNull()) {
                        if (stdio_val.jsType().isArray()) {
                            var stdio_iter = stdio_val.arrayIterator(globalThis);
                            var i: u32 = 0;
                            while (stdio_iter.next()) |value| : (i += 1) {
                                if (!extractStdio(globalThis, i, value, &stdio[i]))
                                    return JSC.JSValue.jsUndefined();
                                if (i == 2)
                                    break;
                            }
                            i += 1;

                            while (stdio_iter.next()) |value| : (i += 1) {
                                var new_item: Stdio = undefined;
                                if (!extractStdio(globalThis, i, value, &new_item))
                                    return JSC.JSValue.jsUndefined();
                                switch (new_item) {
                                    .pipe => {
                                        stdio_pipes.append(bun.default_allocator, .{
                                            .fd = 0,
                                            .fileno = @intCast(i),
                                        }) catch {
                                            globalThis.throwOutOfMemory();
                                            return .zero;
                                        };
                                    },
                                    else => {},
                                }
                            }
                        } else {
                            globalThis.throwInvalidArguments("stdio must be an array", .{});
                            return .zero;
                        }
                    }
                } else {
                    if (args.get(globalThis, "stdin")) |value| {
                        if (!extractStdio(globalThis, 0, value, &stdio[0]))
                            return .zero;
                    }

                    if (args.get(globalThis, "stderr")) |value| {
                        if (!extractStdio(globalThis, 2, value, &stdio[2]))
                            return .zero;
                    }

                    if (args.get(globalThis, "stdout")) |value| {
                        if (!extractStdio(globalThis, 1, value, &stdio[1]))
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

                if (args.get(globalThis, "ipc")) |val| {
                    if (Environment.isWindows) {
                        globalThis.throwTODO("TODO: IPC is not yet supported on Windows");
                        return .zero;
                    }

                    if (val.isCell() and val.isCallable(globalThis.vm())) {
                        // In the future, we should add a way to use a different IPC serialization format, specifically `json`.
                        // but the only use case this has is doing interop with node.js IPC and other programs.
                        ipc_mode = .bun;
                        ipc_callback = val.withAsyncContextIfNeeded(globalThis);
                    }
                }

                if (Environment.isWindows) {
                    if (args.get(globalThis, "windowsHide")) |val| {
                        if (val.isBoolean()) {
                            windows_hide = @intFromBool(val.asBoolean());
                        }
                    }
                }
            }
        }

        // WINDOWS:
        if (Environment.isWindows) {
            argv.append(allocator, null) catch {
                globalThis.throwOutOfMemory();
                return .zero;
            };

            if (!override_env and env_array.items.len == 0) {
                env_array.items = jsc_vm.bundler.env.map.createNullDelimitedEnvMap(allocator) catch |err| return globalThis.handleError(err, "in posix_spawn");
                env_array.capacity = env_array.items.len;
            }

            env_array.append(allocator, null) catch {
                globalThis.throwOutOfMemory();
                return .zero;
            };
            const env: [*:null]?[*:0]const u8 = @ptrCast(env_array.items.ptr);

            const alloc = globalThis.allocator();
            var subprocess = alloc.create(Subprocess) catch {
                globalThis.throwOutOfMemory();
                return .zero;
            };

            var uv_stdio = [3]uv.uv_stdio_container_s{
                stdio[0].setUpChildIoUvSpawn(0, &subprocess.pipes[0], true, bun.invalid_fd) catch |err| {
                    alloc.destroy(subprocess);
                    return globalThis.handleError(err, "in setting up uv_process stdin");
                },
                stdio[1].setUpChildIoUvSpawn(1, &subprocess.pipes[1], false, bun.invalid_fd) catch |err| {
                    alloc.destroy(subprocess);
                    return globalThis.handleError(err, "in setting up uv_process stdout");
                },
                stdio[2].setUpChildIoUvSpawn(2, &subprocess.pipes[2], false, bun.invalid_fd) catch |err| {
                    alloc.destroy(subprocess);
                    return globalThis.handleError(err, "in setting up uv_process stderr");
                },
            };

            var cwd_resolver = bun.path.PosixToWinNormalizer{};

            const options = uv.uv_process_options_t{
                .exit_cb = uvExitCallback,
                .args = @ptrCast(argv.items[0 .. argv.items.len - 1 :null]),
                .cwd = cwd_resolver.resolveCWDZ(cwd) catch |err| {
                    alloc.destroy(subprocess);
                    return globalThis.handleError(err, "in uv_spawn");
                },
                .env = env,
                .file = argv.items[0].?,
                .gid = 0,
                .uid = 0,
                .stdio = &uv_stdio,
                .stdio_count = uv_stdio.len,
                .flags = if (windows_hide == 1) uv.UV_PROCESS_WINDOWS_HIDE else 0,
            };

            if (uv.uv_spawn(jsc_vm.uvLoop(), &subprocess.pid, &options).errEnum()) |errno| {
                alloc.destroy(subprocess);
                globalThis.throwValue(bun.sys.Error.fromCode(errno, .uv_spawn).toJSC(globalThis));
                return .zero;
            }

            // When run synchronously, subprocess isn't garbage collected
            subprocess.* = Subprocess{
                .pipes = subprocess.pipes,
                .globalThis = globalThis,
                .pid = subprocess.pid,
                .pidfd = 0,
                .stdin = Writable.initWithPipe(stdio[0], &subprocess.pipes[0], globalThis) catch {
                    globalThis.throwOutOfMemory();
                    return .zero;
                },
                // stdout and stderr only uses allocator and default_max_buffer_size if they are pipes and not a array buffer
                .stdout = Readable.initWithPipe(stdio[1], &subprocess.pipes[1], jsc_vm.allocator, default_max_buffer_size),
                .stderr = Readable.initWithPipe(stdio[2], &subprocess.pipes[2], jsc_vm.allocator, default_max_buffer_size),
                .on_exit_callback = if (on_exit_callback != .zero) JSC.Strong.create(on_exit_callback, globalThis) else .{},

                .ipc_mode = ipc_mode,
                .ipc = undefined,
                .ipc_callback = undefined,

                .flags = .{
                    .is_sync = is_sync,
                },
            };
            subprocess.pid.data = subprocess;
            std.debug.assert(ipc_mode == .none); //TODO:

            const out = if (comptime !is_sync) subprocess.toJS(globalThis) else .zero;
            subprocess.this_jsvalue = out;

            if (subprocess.stdin == .buffered_input) {
                subprocess.stdin.buffered_input.remain = switch (subprocess.stdin.buffered_input.source) {
                    .blob => subprocess.stdin.buffered_input.source.blob.slice(),
                    .array_buffer => |array_buffer| array_buffer.slice(),
                };
                subprocess.stdin.buffered_input.writeIfPossible(is_sync);
            }

            if (subprocess.stdout == .pipe and subprocess.stdout.pipe == .buffer) {
                if (is_sync or !lazy) {
                    subprocess.stdout.pipe.buffer.readAll();
                }
            }

            if (subprocess.stderr == .pipe and subprocess.stderr.pipe == .buffer) {
                if (is_sync or !lazy) {
                    subprocess.stderr.pipe.buffer.readAll();
                }
            }

            if (comptime !is_sync) {
                return out;
            }

            // sync

            while (!subprocess.hasExited()) {
                uv.Loop.get().tickWithTimeout(0);

                if (subprocess.stderr == .pipe and subprocess.stderr.pipe == .buffer) {
                    subprocess.stderr.pipe.buffer.readAll();
                }

                if (subprocess.stdout == .pipe and subprocess.stdout.pipe == .buffer) {
                    subprocess.stdout.pipe.buffer.readAll();
                }

                jsc_vm.tick();
                jsc_vm.eventLoop().autoTick();
            }

            const exitCode = subprocess.exit_code orelse 1;
            const stdout = subprocess.stdout.toBufferedValue(globalThis);
            const stderr = subprocess.stderr.toBufferedValue(globalThis);
            const resource_usage = subprocess.createResourceUsageObject(globalThis);
            subprocess.finalizeStreams();

            const sync_value = JSC.JSValue.createEmptyObject(globalThis, 5);
            sync_value.put(globalThis, JSC.ZigString.static("exitCode"), JSValue.jsNumber(@as(i32, @intCast(exitCode))));
            sync_value.put(globalThis, JSC.ZigString.static("stdout"), stdout);
            sync_value.put(globalThis, JSC.ZigString.static("stderr"), stderr);
            sync_value.put(globalThis, JSC.ZigString.static("success"), JSValue.jsBoolean(exitCode == 0));
            sync_value.put(globalThis, JSC.ZigString.static("resourceUsage"), resource_usage);
            return sync_value;
        }
        // POSIX:

        var attr = PosixSpawn.Attr.init() catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };

        var flags: i32 = bun.C.POSIX_SPAWN_SETSIGDEF | bun.C.POSIX_SPAWN_SETSIGMASK;

        if (comptime Environment.isMac) {
            flags |= bun.C.POSIX_SPAWN_CLOEXEC_DEFAULT;
        }

        if (detached) {
            flags |= bun.C.POSIX_SPAWN_SETSID;
        }

        defer attr.deinit();
        var actions = PosixSpawn.Actions.init() catch |err| return globalThis.handleError(err, "in posix_spawn");
        if (comptime Environment.isMac) {
            attr.set(@intCast(flags)) catch |err| return globalThis.handleError(err, "in posix_spawn");
        } else if (comptime Environment.isLinux) {
            attr.set(@intCast(flags)) catch |err| return globalThis.handleError(err, "in posix_spawn");
        }

        attr.resetSignals() catch {
            globalThis.throw("Failed to reset signals in posix_spawn", .{});
            return .zero;
        };

        defer actions.deinit();

        if (!override_env and env_array.items.len == 0) {
            env_array.items = jsc_vm.bundler.env.map.createNullDelimitedEnvMap(allocator) catch |err| return globalThis.handleError(err, "in posix_spawn");
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

        // TODO: move pipe2 to bun.sys so it can return [2]bun.FileDesriptor
        const stdin_pipe = if (stdio[0].isPiped()) bun.sys.pipe().unwrap() catch |err| {
            globalThis.throw("failed to create stdin pipe: {s}", .{@errorName(err)});
            return .zero;
        } else undefined;

        const stdout_pipe = if (stdio[1].isPiped()) bun.sys.pipe().unwrap() catch |err| {
            globalThis.throw("failed to create stdout pipe: {s}", .{@errorName(err)});
            return .zero;
        } else undefined;

        const stderr_pipe = if (stdio[2].isPiped()) bun.sys.pipe().unwrap() catch |err| {
            globalThis.throw("failed to create stderr pipe: {s}", .{@errorName(err)});
            return .zero;
        } else undefined;

        stdio[0].setUpChildIoPosixSpawn(
            &actions,
            stdin_pipe,
            bun.STDIN_FD,
        ) catch |err| return globalThis.handleError(err, "in configuring child stdin");

        stdio[1].setUpChildIoPosixSpawn(
            &actions,
            stdout_pipe,
            bun.STDOUT_FD,
        ) catch |err| return globalThis.handleError(err, "in configuring child stdout");

        stdio[2].setUpChildIoPosixSpawn(
            &actions,
            stderr_pipe,
            bun.STDERR_FD,
        ) catch |err| return globalThis.handleError(err, "in configuring child stderr");

        for (stdio_pipes.items) |*item| {
            const maybe = blk: {
                // TODO: move this to bun.sys so it can return [2]bun.FileDesriptor
                var fds: [2]c_int = undefined;
                const socket_type = os.SOCK.STREAM;
                const rc = std.os.system.socketpair(os.AF.UNIX, socket_type, 0, &fds);
                switch (std.os.system.getErrno(rc)) {
                    .SUCCESS => {},
                    .AFNOSUPPORT => break :blk error.AddressFamilyNotSupported,
                    .FAULT => break :blk error.Fault,
                    .MFILE => break :blk error.ProcessFdQuotaExceeded,
                    .NFILE => break :blk error.SystemFdQuotaExceeded,
                    .OPNOTSUPP => break :blk error.OperationNotSupported,
                    .PROTONOSUPPORT => break :blk error.ProtocolNotSupported,
                    else => |err| break :blk std.os.unexpectedErrno(err),
                }
                pipes_to_close.append(bun.default_allocator, bun.toFD(fds[1])) catch |err| break :blk err;
                actions.dup2(bun.toFD(fds[1]), bun.toFD(item.fileno)) catch |err| break :blk err;
                actions.close(bun.toFD(fds[1])) catch |err| break :blk err;
                item.fd = fds[0];
                // enable non-block
                const before = std.c.fcntl(fds[0], os.F.GETFL);
                _ = std.c.fcntl(fds[0], os.F.SETFL, before | os.O.NONBLOCK);
                // enable SOCK_CLOXEC
                _ = std.c.fcntl(fds[0], os.FD_CLOEXEC);
            };
            _ = maybe catch |err| return globalThis.handleError(err, "in configuring child stderr");
        }

        actions.chdir(cwd) catch |err| return globalThis.handleError(err, "in chdir()");

        argv.append(allocator, null) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };

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
        var socket: IPC.Socket = undefined;
        if (ipc_mode != .none) {
            if (comptime is_sync) {
                globalThis.throwInvalidArguments("IPC is not supported in Bun.spawnSync", .{});
                return .zero;
            }

            env_array.ensureUnusedCapacity(allocator, 2) catch |err| return globalThis.handleError(err, "in posix_spawn");
            env_array.appendAssumeCapacity("BUN_INTERNAL_IPC_FD=3");

            var fds: [2]uws.LIBUS_SOCKET_DESCRIPTOR = undefined;
            socket = uws.newSocketFromPair(
                jsc_vm.rareData().spawnIPCContext(jsc_vm),
                @sizeOf(*Subprocess),
                &fds,
            ) orelse {
                globalThis.throw("failed to create socket pair: E{s}", .{
                    @tagName(bun.sys.getErrno(-1)),
                });
                return .zero;
            };
            socket.setTimeout(0);
            pipes_to_close.append(bun.default_allocator, bun.toFD(fds[1])) catch |err| return globalThis.handleError(err, "in posix_spawn");
            actions.dup2(bun.toFD(fds[1]), bun.toFD(3)) catch |err| return globalThis.handleError(err, "in posix_spawn");
            actions.close(bun.toFD(fds[1])) catch |err| return globalThis.handleError(err, "in posix_spawn");
            // enable non-block
            const before = std.c.fcntl(fds[0], os.F.GETFL);
            _ = std.c.fcntl(fds[0], os.F.SETFL, before | os.O.NONBLOCK);
            // enable SOCK_CLOXEC
            _ = std.c.fcntl(fds[0], os.FD_CLOEXEC);
        }

        env_array.append(allocator, null) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        const env: [*:null]?[*:0]const u8 = @ptrCast(env_array.items.ptr);

        const pid = brk: {
            defer {
                if (stdio[0].isPiped()) {
                    _ = bun.sys.close(bun.toFD(stdin_pipe[0]));
                }
                if (stdio[1].isPiped()) {
                    _ = bun.sys.close(bun.toFD(stdout_pipe[1]));
                }
                if (stdio[2].isPiped()) {
                    _ = bun.sys.close(bun.toFD(stderr_pipe[1]));
                }

                // we always close these, but we want to close these earlier
                for (pipes_to_close.items) |pipe_fd| {
                    _ = bun.sys.close(pipe_fd);
                }
                pipes_to_close.clearAndFree(bun.default_allocator);
            }

            break :brk switch (PosixSpawn.spawnZ(argv.items[0].?, actions, attr, @as([*:null]?[*:0]const u8, @ptrCast(argv.items[0..].ptr)), env)) {
                .err => |err| {
                    globalThis.throwValue(err.toJSC(globalThis));
                    return .zero;
                },
                .result => |pid_| pid_,
            };
        };

        var rusage_result: Rusage = std.mem.zeroes(Rusage);
        var has_rusage = false;
        const pidfd: std.os.fd_t = brk: {
            if (!Environment.isLinux or WaiterThread.shouldUseWaiterThread()) {
                break :brk pid;
            }

            var pidfd_flags = pidfdFlagsForLinux();

            var rc = std.os.linux.pidfd_open(
                @intCast(pid),
                pidfd_flags,
            );
            while (true) {
                switch (std.os.linux.getErrno(rc)) {
                    .SUCCESS => break :brk @as(std.os.fd_t, @intCast(rc)),
                    .INTR => {
                        rc = std.os.linux.pidfd_open(
                            @intCast(pid),
                            pidfd_flags,
                        );
                        continue;
                    },
                    else => |err| {
                        if (err == .INVAL) {
                            if (pidfd_flags != 0) {
                                rc = std.os.linux.pidfd_open(
                                    @intCast(pid),
                                    0,
                                );
                                pidfd_flags = 0;
                                continue;
                            }
                        }

                        const error_instance = brk2: {
                            if (err == .NOSYS) {
                                WaiterThread.setShouldUseWaiterThread();
                                break :brk pid;
                            }

                            break :brk2 bun.sys.Error.fromCode(err, .open).toJSC(globalThis);
                        };
                        globalThis.throwValue(error_instance);
                        var status: u32 = 0;
                        // ensure we don't leak the child process on error
                        _ = std.os.linux.wait4(pid, &status, 0, &rusage_result);
                        has_rusage = true;
                        return .zero;
                    },
                }
            }
        };

        var subprocess = globalThis.allocator().create(Subprocess) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        // When run synchronously, subprocess isn't garbage collected
        subprocess.* = Subprocess{
            .globalThis = globalThis,
            .pid = pid,
            .pid_rusage = if (has_rusage) rusage_result else null,
            .pidfd = if (WaiterThread.shouldUseWaiterThread()) @truncate(bun.invalid_fd.int()) else @truncate(pidfd),
            .stdin = Writable.init(stdio[0], bun.toFD(stdin_pipe[1]), globalThis) catch {
                globalThis.throwOutOfMemory();
                return .zero;
            },
            // stdout and stderr only uses allocator and default_max_buffer_size if they are pipes and not a array buffer
            .stdout = Readable.init(stdio[1], bun.toFD(stdout_pipe[0]), jsc_vm.allocator, default_max_buffer_size),
            .stderr = Readable.init(stdio[2], bun.toFD(stderr_pipe[0]), jsc_vm.allocator, default_max_buffer_size),
            .stdio_pipes = stdio_pipes,
            .on_exit_callback = if (on_exit_callback != .zero) JSC.Strong.create(on_exit_callback, globalThis) else .{},
            .ipc_mode = ipc_mode,
            // will be assigned in the block below
            .ipc = .{ .socket = socket },
            .ipc_callback = if (ipc_callback != .zero) JSC.Strong.create(ipc_callback, globalThis) else undefined,
            .flags = .{
                .is_sync = is_sync,
            },
        };
        if (ipc_mode != .none) {
            const ptr = socket.ext(*Subprocess);
            ptr.?.* = subprocess;
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
        const watchfd = if (comptime Environment.isLinux) pidfd else pid;

        if (comptime !is_sync) {
            if (!WaiterThread.shouldUseWaiterThread()) {
                const poll = Async.FilePoll.init(jsc_vm, bun.toFD(watchfd), .{}, Subprocess, subprocess);
                subprocess.poll = .{ .poll_ref = poll };
                switch (subprocess.poll.poll_ref.?.register(
                    jsc_vm.event_loop_handle.?,
                    .process,
                    true,
                )) {
                    .result => {
                        subprocess.poll.poll_ref.?.enableKeepingProcessAlive(jsc_vm);
                    },
                    .err => |err| {
                        if (err.getErrno() != .SRCH) {
                            @panic("This shouldn't happen");
                        }

                        send_exit_notification = true;
                        lazy = false;
                    },
                }
            } else {
                WaiterThread.append(subprocess);
            }
        }

        defer {
            if (send_exit_notification) {
                // process has already exited
                // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                subprocess.wait(subprocess.flags.is_sync);
            }
        }

        if (subprocess.stdin == .buffered_input) {
            subprocess.stdin.buffered_input.remain = switch (subprocess.stdin.buffered_input.source) {
                .blob => subprocess.stdin.buffered_input.source.blob.slice(),
                .array_buffer => |array_buffer| array_buffer.slice(),
            };
            subprocess.stdin.buffered_input.writeIfPossible(is_sync);
        }

        if (subprocess.stdout == .pipe and subprocess.stdout.pipe == .buffer) {
            if (is_sync or !lazy) {
                subprocess.stdout.pipe.buffer.readAll();
            }
        }

        if (subprocess.stderr == .pipe and subprocess.stderr.pipe == .buffer) {
            if (is_sync or !lazy) {
                subprocess.stderr.pipe.buffer.readAll();
            }
        }

        should_close_memfd = false;

        if (comptime !is_sync) {
            return out;
        }

        if (subprocess.stdin == .buffered_input) {
            while (subprocess.stdin.buffered_input.remain.len > 0) {
                subprocess.stdin.buffered_input.writeIfPossible(true);
            }
        }

        subprocess.closeIO(.stdin);

        if (!WaiterThread.shouldUseWaiterThread()) {
            const poll = Async.FilePoll.init(jsc_vm, bun.toFD(watchfd), .{}, Subprocess, subprocess);
            subprocess.poll = .{ .poll_ref = poll };
            switch (subprocess.poll.poll_ref.?.register(
                jsc_vm.event_loop_handle.?,
                .process,
                true,
            )) {
                .result => {
                    subprocess.poll.poll_ref.?.enableKeepingProcessAlive(jsc_vm);
                },
                .err => |err| {
                    if (err.getErrno() != .SRCH) {
                        @panic("This shouldn't happen");
                    }

                    // process has already exited
                    // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                    subprocess.onExitNotification();
                },
            }
        } else {
            WaiterThread.append(subprocess);
        }

        while (!subprocess.hasExited()) {
            if (subprocess.stderr == .pipe and subprocess.stderr.pipe == .buffer) {
                subprocess.stderr.pipe.buffer.readAll();
            }

            if (subprocess.stdout == .pipe and subprocess.stdout.pipe == .buffer) {
                subprocess.stdout.pipe.buffer.readAll();
            }

            jsc_vm.tick();
            jsc_vm.eventLoop().autoTick();
        }

        const exitCode = subprocess.exit_code orelse 1;
        const stdout = subprocess.stdout.toBufferedValue(globalThis);
        const stderr = subprocess.stderr.toBufferedValue(globalThis);
        const resource_usage = subprocess.createResourceUsageObject(globalThis);
        subprocess.finalizeStreams();

        const sync_value = JSC.JSValue.createEmptyObject(globalThis, 5);
        sync_value.put(globalThis, JSC.ZigString.static("exitCode"), JSValue.jsNumber(@as(i32, @intCast(exitCode))));
        sync_value.put(globalThis, JSC.ZigString.static("stdout"), stdout);
        sync_value.put(globalThis, JSC.ZigString.static("stderr"), stderr);
        sync_value.put(globalThis, JSC.ZigString.static("success"), JSValue.jsBoolean(exitCode == 0));
        sync_value.put(globalThis, JSC.ZigString.static("resourceUsage"), resource_usage);

        return sync_value;
    }

    pub fn onExitNotificationTask(this: *Subprocess) void {
        var vm = this.globalThis.bunVM();
        const is_sync = this.flags.is_sync;

        defer {
            if (!is_sync)
                vm.drainMicrotasks();
        }
        this.wait(false);
    }

    pub fn onExitNotification(
        this: *Subprocess,
    ) void {
        std.debug.assert(this.flags.is_sync);

        this.wait(this.flags.is_sync);
    }

    pub fn wait(this: *Subprocess, sync: bool) void {
        if (Environment.isWindows) {
            @panic("TODO: Windows");
        }
        return this.waitWithJSValue(sync, this.this_jsvalue);
    }

    pub fn watch(this: *Subprocess) JSC.Maybe(void) {
        if (WaiterThread.shouldUseWaiterThread()) {
            WaiterThread.append(this);
            return JSC.Maybe(void){ .result = {} };
        }

        if (this.poll.poll_ref) |poll| {
            const registration = poll.register(
                this.globalThis.bunVM().event_loop_handle.?,
                .process,
                true,
            );

            return registration;
        } else {
            @panic("Internal Bun error: poll_ref in Subprocess is null unexpectedly. Please file a bug report.");
        }
    }

    pub fn waitWithJSValue(
        this: *Subprocess,
        sync: bool,
        this_jsvalue: JSC.JSValue,
    ) void {
        var rusage_result: Rusage = std.mem.zeroes(Rusage);
        this.onWaitPid(sync, this_jsvalue, PosixSpawn.wait4(this.pid, if (sync) 0 else std.os.W.NOHANG, &rusage_result), rusage_result);
    }

    pub fn onWaitPid(this: *Subprocess, sync: bool, this_jsvalue: JSC.JSValue, waitpid_result_: JSC.Maybe(PosixSpawn.WaitPidResult), pid_rusage: Rusage) void {
        if (Environment.isWindows) {
            @panic("TODO: Windows");
        }
        defer if (sync) this.updateHasPendingActivity();

        const pid = this.pid;

        var waitpid_result = waitpid_result_;
        var rusage_result = pid_rusage;

        while (true) {
            switch (waitpid_result) {
                .err => |err| {
                    this.waitpid_err = err;
                },
                .result => |result| {
                    if (result.pid == pid) {
                        this.pid_rusage = rusage_result;
                        if (std.os.W.IFEXITED(result.status)) {
                            this.exit_code = @as(u8, @truncate(std.os.W.EXITSTATUS(result.status)));
                        }

                        // True if the process terminated due to receipt of a signal.
                        if (std.os.W.IFSIGNALED(result.status)) {
                            this.signal_code = @as(SignalCode, @enumFromInt(@as(u8, @truncate(std.os.W.TERMSIG(result.status)))));
                        } else if (
                        // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/waitpid.2.html
                        // True if the process has not terminated, but has stopped and can
                        // be restarted.  This macro can be true only if the wait call spec-ified specified
                        // ified the WUNTRACED option or if the child process is being
                        // traced (see ptrace(2)).
                        std.os.W.IFSTOPPED(result.status)) {
                            this.signal_code = @as(SignalCode, @enumFromInt(@as(u8, @truncate(std.os.W.STOPSIG(result.status)))));
                        }
                    }

                    if (!this.hasExited()) {
                        switch (this.watch()) {
                            .result => {},
                            .err => |err| {
                                if (comptime Environment.isMac) {
                                    if (err.getErrno() == .SRCH) {
                                        waitpid_result = PosixSpawn.wait4(pid, if (sync) 0 else std.os.W.NOHANG, &rusage_result);
                                        continue;
                                    }
                                }
                            },
                        }
                    }
                },
            }
            break;
        }

        if (!sync and this.hasExited()) {
            const vm = this.globalThis.bunVM();

            // prevent duplicate notifications
            switch (this.poll) {
                .poll_ref => |poll_| {
                    if (poll_) |poll| {
                        this.poll.poll_ref = null;
                        poll.deinitWithVM(vm);
                    }
                },
                .wait_thread => {
                    this.poll.wait_thread.poll_ref.deactivate(vm.event_loop_handle.?);
                },
            }

            this.onExit(this.globalThis, this_jsvalue);
        }
    }

    fn uvExitCallback(process: *uv.uv_process_t, exit_status: i64, term_signal: c_int) callconv(.C) void {
        const subprocess: *Subprocess = @alignCast(@ptrCast(process.data.?));
        subprocess.globalThis.assertOnJSThread();
        subprocess.exit_code = @as(u8, @truncate(@as(u64, @intCast(exit_status))));
        subprocess.signal_code = if (term_signal > 0 and term_signal < @intFromEnum(SignalCode.SIGSYS)) @enumFromInt(term_signal) else null;
        subprocess.pid_rusage = uv_getrusage(process);
        subprocess.onExit(subprocess.globalThis, subprocess.this_jsvalue);
    }

    fn runOnExit(this: *Subprocess, globalThis: *JSC.JSGlobalObject, this_jsvalue: JSC.JSValue) void {
        const waitpid_error = this.waitpid_err;
        this.waitpid_err = null;

        if (this.exit_promise.trySwap()) |promise| {
            if (this.exit_code) |code| {
                promise.asAnyPromise().?.resolve(globalThis, JSValue.jsNumber(code));
            } else if (waitpid_error) |err| {
                promise.asAnyPromise().?.reject(globalThis, err.toJSC(globalThis));
            } else if (this.signal_code != null) {
                promise.asAnyPromise().?.resolve(globalThis, JSValue.jsNumber(128 +% @intFromEnum(this.signal_code.?)));
            } else {
                // crash in debug mode
                if (comptime Environment.allow_assert)
                    unreachable;
            }
        }

        if (this.on_exit_callback.trySwap()) |callback| {
            const waitpid_value: JSValue =
                if (waitpid_error) |err|
                err.toJSC(globalThis)
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

            const result = callback.callWithThis(
                globalThis,
                this_value,
                &args,
            );

            if (result.isAnyError()) {
                globalThis.bunVM().onUnhandledError(globalThis, result);
            }
        }
    }

    fn onExit(
        this: *Subprocess,
        globalThis: *JSC.JSGlobalObject,
        this_jsvalue: JSC.JSValue,
    ) void {
        log("onExit({d}) = {d}, \"{s}\"", .{
            if (Environment.isWindows) this.pid.pid else this.pid,
            if (this.exit_code) |e| @as(i32, @intCast(e)) else -1,
            if (this.signal_code) |code| @tagName(code) else "",
        });
        defer this.updateHasPendingActivity();
        this_jsvalue.ensureStillAlive();

        if (this.hasExited()) {
            {
                this.flags.waiting_for_onexit = true;

                const Holder = struct {
                    process: *Subprocess,
                    task: JSC.AnyTask,

                    pub fn unref(self: *@This()) void {
                        // this calls disableKeepingProcessAlive on pool_ref and stdin, stdout, stderr
                        self.process.flags.waiting_for_onexit = false;
                        self.process.unref(true);
                        self.process.updateHasPendingActivity();
                        bun.default_allocator.destroy(self);
                    }
                };

                var holder = bun.default_allocator.create(Holder) catch bun.outOfMemory();

                holder.* = .{
                    .process = this,
                    .task = JSC.AnyTask.New(Holder, Holder.unref).init(holder),
                };

                this.globalThis.bunVM().enqueueTask(JSC.Task.init(&holder.task));
            }

            this.runOnExit(globalThis, this_jsvalue);
        }
    }

    const os = std.os;
    fn destroyPipe(pipe: [2]os.fd_t) void {
        os.close(pipe[0]);
        if (pipe[0] != pipe[1]) os.close(pipe[1]);
    }

    const Stdio = union(enum) {
        inherit: void,
        ignore: void,
        fd: bun.FileDescriptor,
        path: JSC.Node.PathLike,
        blob: JSC.WebCore.AnyBlob,
        pipe: ?JSC.WebCore.ReadableStream,
        array_buffer: JSC.ArrayBuffer.Strong,
        memfd: bun.FileDescriptor,

        const PipeExtra = struct {
            fd: i32,
            fileno: i32,
        };

        pub fn canUseMemfd(this: *const @This(), is_sync: bool) bool {
            if (comptime !Environment.isLinux) {
                return false;
            }

            return switch (this.*) {
                .blob => !this.blob.needsToReadFile(),
                .memfd, .array_buffer => true,
                .pipe => |pipe| pipe == null and is_sync,
                else => false,
            };
        }

        pub fn byteSlice(this: *const @This()) []const u8 {
            return switch (this.*) {
                .blob => this.blob.slice(),
                .array_buffer => |array_buffer| array_buffer.slice(),
                else => "",
            };
        }

        pub fn useMemfd(this: *@This(), index: u32) void {
            const label = switch (index) {
                0 => "spawn_stdio_stdin",
                1 => "spawn_stdio_stdout",
                2 => "spawn_stdio_stderr",
                else => "spawn_stdio_memory_file",
            };

            // We use the linux syscall api because the glibc requirement is 2.27, which is a little close for comfort.
            const rc = std.os.linux.memfd_create(label, 0);

            log("memfd_create({s}) = {d}", .{ label, rc });

            switch (std.os.linux.getErrno(rc)) {
                .SUCCESS => {},
                else => |errno| {
                    log("Failed to create memfd: {s}", .{@tagName(errno)});
                    return;
                },
            }

            const fd = bun.toFD(rc);

            var remain = this.byteSlice();

            if (remain.len > 0)
                // Hint at the size of the file
                _ = bun.sys.ftruncate(fd, @intCast(remain.len));

            // Dump all the bytes in there
            var written: isize = 0;
            while (remain.len > 0) {
                switch (bun.sys.pwrite(fd, remain, written)) {
                    .err => |err| {
                        if (err.getErrno() == .AGAIN) {
                            continue;
                        }

                        Output.debugWarn("Failed to write to memfd: {s}", .{@tagName(err.getErrno())});
                        _ = bun.sys.close(fd);
                        return;
                    },
                    .result => |result| {
                        if (result == 0) {
                            Output.debugWarn("Failed to write to memfd: EOF", .{});
                            _ = bun.sys.close(fd);
                            return;
                        }
                        written += @intCast(result);
                        remain = remain[result..];
                    },
                }
            }

            switch (this.*) {
                .array_buffer => this.array_buffer.deinit(),
                .blob => this.blob.detach(),
                else => {},
            }

            this.* = .{ .memfd = fd };
        }

        pub fn isPiped(self: Stdio) bool {
            return switch (self) {
                .array_buffer, .blob, .pipe => true,
                else => false,
            };
        }

        fn setUpChildIoPosixSpawn(
            stdio: @This(),
            actions: *PosixSpawn.Actions,
            pipe_fd: [2]bun.FileDescriptor,
            std_fileno: bun.FileDescriptor,
        ) !void {
            switch (stdio) {
                .array_buffer, .blob, .pipe => {
                    std.debug.assert(!(stdio == .blob and stdio.blob.needsToReadFile()));
                    const idx: usize = if (std_fileno == bun.STDIN_FD) 0 else 1;

                    try actions.dup2(bun.toFD(pipe_fd[idx]), std_fileno);
                    try actions.close(bun.toFD(pipe_fd[1 - idx]));
                },
                .fd => |fd| {
                    try actions.dup2(fd, std_fileno);
                },
                .memfd => |fd| {
                    try actions.dup2(fd, std_fileno);
                },
                .path => |pathlike| {
                    const flag = if (std_fileno == bun.STDIN_FD) @as(u32, os.O.RDONLY) else @as(u32, std.os.O.WRONLY);
                    try actions.open(std_fileno, pathlike.slice(), flag | std.os.O.CREAT, 0o664);
                },
                .inherit => {
                    if (comptime Environment.isMac) {
                        try actions.inherit(std_fileno);
                    } else {
                        try actions.dup2(std_fileno, std_fileno);
                    }
                },
                .ignore => {
                    const flag = if (std_fileno == bun.STDIN_FD) @as(u32, os.O.RDONLY) else @as(u32, std.os.O.WRONLY);
                    try actions.openZ(std_fileno, "/dev/null", flag, 0o664);
                },
            }
        }

        fn setUpChildIoUvSpawn(
            stdio: @This(),
            std_fileno: i32,
            pipe: *uv.uv_pipe_t,
            isReadable: bool,
            fd: bun.FileDescriptor,
        ) !uv.uv_stdio_container_s {
            return switch (stdio) {
                .array_buffer, .blob, .pipe => {
                    if (uv.uv_pipe_init(uv.Loop.get(), pipe, 0) != 0) {
                        return error.FailedToCreatePipe;
                    }
                    if (fd != bun.invalid_fd) {
                        // we receive a FD so we open this into our pipe
                        if (uv.uv_pipe_open(pipe, bun.uvfdcast(fd)).errEnum()) |_| {
                            return error.FailedToCreatePipe;
                        }
                        return uv.uv_stdio_container_s{
                            .flags = @intCast(uv.UV_INHERIT_STREAM),
                            .data = .{ .stream = @ptrCast(pipe) },
                        };
                    }
                    // we dont have any fd so we create a new pipe
                    return uv.uv_stdio_container_s{
                        .flags = @intCast(uv.UV_CREATE_PIPE | if (isReadable) uv.UV_READABLE_PIPE else uv.UV_WRITABLE_PIPE),
                        .data = .{ .stream = @ptrCast(pipe) },
                    };
                },
                .fd => |_fd| uv.uv_stdio_container_s{
                    .flags = uv.UV_INHERIT_FD,
                    .data = .{ .fd = bun.uvfdcast(_fd) },
                },
                .path => |pathlike| {
                    _ = pathlike;
                    @panic("TODO");
                },
                .inherit => uv.uv_stdio_container_s{
                    .flags = uv.UV_INHERIT_FD,
                    .data = .{ .fd = std_fileno },
                },
                .ignore => uv.uv_stdio_container_s{
                    .flags = uv.UV_IGNORE,
                    .data = undefined,
                },
                .memfd => unreachable,
            };
        }
    };

    fn extractStdioBlob(
        globalThis: *JSC.JSGlobalObject,
        blob: JSC.WebCore.AnyBlob,
        i: u32,
        out_stdio: *Stdio,
    ) bool {
        const fd = bun.stdio(i);

        if (blob.needsToReadFile()) {
            if (blob.store()) |store| {
                if (store.data.file.pathlike == .fd) {
                    if (store.data.file.pathlike.fd == fd) {
                        out_stdio.* = Stdio{ .inherit = {} };
                    } else {
                        switch (bun.FDTag.get(i)) {
                            .stdin => {
                                if (i == 1 or i == 2) {
                                    globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                                    return false;
                                }
                            },
                            .stdout, .stderr => {
                                if (i == 0) {
                                    globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                                    return false;
                                }
                            },
                            else => {},
                        }

                        out_stdio.* = Stdio{ .fd = store.data.file.pathlike.fd };
                    }

                    return true;
                }

                out_stdio.* = .{ .path = store.data.file.pathlike.path };
                return true;
            }
        }

        out_stdio.* = .{ .blob = blob };
        return true;
    }

    fn extractStdio(
        globalThis: *JSC.JSGlobalObject,
        i: u32,
        value: JSValue,
        out_stdio: *Stdio,
    ) bool {
        if (value.isEmptyOrUndefinedOrNull()) {
            return true;
        }

        if (value.isString()) {
            const str = value.getZigString(globalThis);
            if (str.eqlComptime("inherit")) {
                out_stdio.* = Stdio{ .inherit = {} };
            } else if (str.eqlComptime("ignore")) {
                out_stdio.* = Stdio{ .ignore = {} };
            } else if (str.eqlComptime("pipe")) {
                out_stdio.* = Stdio{ .pipe = null };
            } else if (str.eqlComptime("ipc")) {
                out_stdio.* = Stdio{ .pipe = null }; // TODO:
            } else {
                globalThis.throwInvalidArguments("stdio must be an array of 'inherit', 'pipe', 'ignore', Bun.file(pathOrFd), number, or null", .{});
                return false;
            }

            return true;
        } else if (value.isNumber()) {
            const fd = value.asFileDescriptor();
            if (fd.int() < 0) {
                globalThis.throwInvalidArguments("file descriptor must be a positive integer", .{});
                return false;
            }

            switch (bun.FDTag.get(fd)) {
                .stdin => {
                    if (i == 1 or i == 2) {
                        globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                        return false;
                    }
                },

                .stdout, .stderr => {
                    if (i == 0) {
                        globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                        return false;
                    }
                },
                else => {},
            }

            out_stdio.* = Stdio{ .fd = fd };

            return true;
        } else if (value.as(JSC.WebCore.Blob)) |blob| {
            return extractStdioBlob(globalThis, .{ .Blob = blob.dupe() }, i, out_stdio);
        } else if (value.as(JSC.WebCore.Request)) |req| {
            req.getBodyValue().toBlobIfPossible();
            return extractStdioBlob(globalThis, req.getBodyValue().useAsAnyBlob(), i, out_stdio);
        } else if (value.as(JSC.WebCore.Response)) |req| {
            req.getBodyValue().toBlobIfPossible();
            return extractStdioBlob(globalThis, req.getBodyValue().useAsAnyBlob(), i, out_stdio);
        } else if (JSC.WebCore.ReadableStream.fromJS(value, globalThis)) |req_const| {
            var req = req_const;
            if (i == 0) {
                if (req.toAnyBlob(globalThis)) |blob| {
                    return extractStdioBlob(globalThis, blob, i, out_stdio);
                }

                switch (req.ptr) {
                    .File, .Blob => {
                        globalThis.throwTODO("Support fd/blob backed ReadableStream in spawn stdin. See https://github.com/oven-sh/bun/issues/8049");
                        return false;
                    },
                    .Direct, .JavaScript, .Bytes => {
                        if (req.isLocked(globalThis)) {
                            globalThis.throwInvalidArguments("ReadableStream cannot be locked", .{});
                            return false;
                        }

                        out_stdio.* = .{ .pipe = req };
                        return true;
                    },
                    .Invalid => {
                        globalThis.throwInvalidArguments("ReadableStream is in invalid state.", .{});
                        return false;
                    },
                }
            }
        } else if (value.asArrayBuffer(globalThis)) |array_buffer| {
            if (array_buffer.slice().len == 0) {
                globalThis.throwInvalidArguments("ArrayBuffer cannot be empty", .{});
                return false;
            }

            out_stdio.* = .{
                .array_buffer = JSC.ArrayBuffer.Strong{
                    .array_buffer = array_buffer,
                    .held = JSC.Strong.create(array_buffer.value, globalThis),
                },
            };

            return true;
        }

        globalThis.throwInvalidArguments("stdio must be an array of 'inherit', 'ignore', or null", .{});
        return false;
    }

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
                    const result = cb.callWithThis(
                        this.globalThis,
                        this.this_jsvalue,
                        &[_]JSValue{ data, this.this_jsvalue },
                    );
                    data.ensureStillAlive();
                    if (result.isAnyError()) {
                        this.globalThis.bunVM().onUnhandledError(this.globalThis, result);
                    }
                }
            },
        }
    }

    pub fn handleIPCClose(this: *Subprocess, _: IPC.Socket) void {
        // uSocket is already freed so calling .close() on the socket can segfault
        this.ipc_mode = .none;
        this.updateHasPendingActivity();
    }

    pub fn pidfdFlagsForLinux() u32 {
        const kernel = @import("../../../analytics.zig").GenerateHeader.GeneratePlatform.kernelVersion();

        // pidfd_nonblock only supported in 5.10+
        return if (kernel.orderWithoutTag(.{ .major = 5, .minor = 10, .patch = 0 }).compare(.gte))
            std.os.O.NONBLOCK
        else
            0;
    }

    pub const IPCHandler = IPC.NewIPCHandler(Subprocess);
    const ShellSubprocess = bun.shell.Subprocess;
    const ShellSubprocessMini = bun.shell.SubprocessMini;

    // Machines which do not support pidfd_open (GVisor, Linux Kernel < 5.6)
    // use a thread to wait for the child process to exit.
    // We use a single thread to call waitpid() in a loop.
    pub const WaiterThread = struct {
        concurrent_queue: Queue = .{},
        lifecycle_script_concurrent_queue: LifecycleScriptTaskQueue = .{},
        queue: std.ArrayList(*Subprocess) = std.ArrayList(*Subprocess).init(bun.default_allocator),
        shell: struct {
            jsc: ShellSubprocessQueue = .{},
            mini: ShellSubprocessMiniQueue = .{},
        } = .{},
        lifecycle_script_queue: std.ArrayList(*LifecycleScriptSubprocess) = std.ArrayList(*LifecycleScriptSubprocess).init(bun.default_allocator),
        started: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
        signalfd: if (Environment.isLinux) bun.FileDescriptor else u0 = undefined,
        eventfd: if (Environment.isLinux) bun.FileDescriptor else u0 = undefined,

        pub const ShellSubprocessQueue = NewShellQueue(ShellSubprocess);
        pub const ShellSubprocessMiniQueue = NewShellQueue(ShellSubprocessMini);

        fn NewShellQueue(comptime T: type) type {
            return struct {
                queue: ConcurrentQueue = .{},
                active: std.ArrayList(*T) = std.ArrayList(*T).init(bun.default_allocator),

                pub const ShellTask = struct {
                    shell: *T,
                    next: ?*ShellTask = null,

                    pub usingnamespace bun.New(@This());
                };
                pub const ConcurrentQueue = bun.UnboundedQueue(ShellTask, .next);

                pub const ResultTask = struct {
                    result: JSC.Maybe(PosixSpawn.WaitPidResult),
                    subprocess: *T,

                    pub usingnamespace bun.New(@This());

                    pub const runFromJSThread = runFromMainThread;

                    pub fn runFromMainThread(self: *@This()) void {
                        const result = self.result;
                        var subprocess = self.subprocess;
                        _ = subprocess.poll.wait_thread.ref_count.fetchSub(1, .Monotonic);
                        self.destroy();
                        subprocess.onWaitPid(false, result);
                    }

                    pub fn runFromMainThreadMini(self: *@This(), _: *void) void {
                        self.runFromMainThread();
                    }
                };

                pub fn append(self: *@This(), shell: *T) void {
                    self.queue.push(
                        ShellTask.new(.{
                            .shell = shell,
                        }),
                    );
                }

                pub fn loop(this: *@This()) void {
                    {
                        var batch = this.queue.popBatch();
                        var iter = batch.iterator();
                        this.active.ensureUnusedCapacity(batch.count) catch unreachable;
                        while (iter.next()) |task| {
                            this.active.appendAssumeCapacity(task.shell);
                            task.destroy();
                        }
                    }

                    var queue: []*T = this.active.items;
                    var i: usize = 0;
                    while (queue.len > 0 and i < queue.len) {
                        var process = queue[i];

                        // this case shouldn't really happen
                        if (process.pid == bun.invalid_fd.int()) {
                            _ = this.active.orderedRemove(i);
                            _ = process.poll.wait_thread.ref_count.fetchSub(1, .Monotonic);
                            queue = this.active.items;
                            continue;
                        }

                        const result = PosixSpawn.wait4(process.pid, std.os.W.NOHANG, null);
                        if (result == .err or (result == .result and result.result.pid == process.pid)) {
                            _ = this.active.orderedRemove(i);
                            queue = this.active.items;

                            T.GlobalHandle.init(process.globalThis).enqueueTaskConcurrentWaitPid(ResultTask.new(.{
                                .result = result,
                                .subprocess = process,
                            }));
                        }

                        i += 1;
                    }
                }
            };
        }

        pub fn setShouldUseWaiterThread() void {
            @atomicStore(bool, &should_use_waiter_thread, true, .Monotonic);
        }

        pub fn shouldUseWaiterThread() bool {
            return @atomicLoad(bool, &should_use_waiter_thread, .Monotonic);
        }

        pub const WaitTask = struct {
            subprocess: *Subprocess,
            next: ?*WaitTask = null,
        };

        pub fn appendShell(comptime Type: type, process: *Type) void {
            const GlobalHandle = Type.GlobalHandle;

            if (process.poll == .wait_thread) {
                process.poll.wait_thread.poll_ref.activate(GlobalHandle.init(process.globalThis).platformEventLoop());
                _ = process.poll.wait_thread.ref_count.fetchAdd(1, .Monotonic);
            } else {
                process.poll = .{
                    .wait_thread = .{
                        .poll_ref = .{},
                        .ref_count = std.atomic.Value(u32).init(1),
                    },
                };
                process.poll.wait_thread.poll_ref.activate(GlobalHandle.init(process.globalThis).platformEventLoop());
            }

            switch (comptime Type) {
                ShellSubprocess => instance.shell.jsc.append(process),
                ShellSubprocessMini => instance.shell.mini.append(process),
                else => @compileError("Unknown ShellSubprocess type"),
            }
            // if (comptime is_js) {
            //     process.updateHasPendingActivity();
            // }

            init() catch @panic("Failed to start WaiterThread");

            if (comptime Environment.isLinux) {
                const one = @as([8]u8, @bitCast(@as(usize, 1)));
                _ = std.os.write(instance.eventfd.cast(), &one) catch @panic("Failed to write to eventfd");
            }
        }

        pub const LifecycleScriptWaitTask = struct {
            lifecycle_script_subprocess: *bun.install.LifecycleScriptSubprocess,
            next: ?*LifecycleScriptWaitTask = null,
        };

        var should_use_waiter_thread = false;

        const stack_size = 512 * 1024;
        pub const Queue = bun.UnboundedQueue(WaitTask, .next);
        pub const LifecycleScriptTaskQueue = bun.UnboundedQueue(LifecycleScriptWaitTask, .next);
        pub var instance: WaiterThread = .{};
        pub fn init() !void {
            std.debug.assert(should_use_waiter_thread);

            if (instance.started.fetchMax(1, .Monotonic) > 0) {
                return;
            }

            var thread = try std.Thread.spawn(.{ .stack_size = stack_size }, loop, .{});
            thread.detach();

            if (comptime Environment.isLinux) {
                const linux = std.os.linux;
                var mask = std.os.empty_sigset;
                linux.sigaddset(&mask, std.os.SIG.CHLD);
                instance.signalfd = bun.toFD(try std.os.signalfd(-1, &mask, linux.SFD.CLOEXEC | linux.SFD.NONBLOCK));
                instance.eventfd = bun.toFD(try std.os.eventfd(0, linux.EFD.NONBLOCK | linux.EFD.CLOEXEC | 0));
            }
        }

        pub const WaitPidResultTask = struct {
            result: JSC.Maybe(PosixSpawn.WaitPidResult),
            rusage: Rusage,
            subprocess: *Subprocess,

            pub fn runFromJSThread(self: *@This()) void {
                const result = self.result;
                var subprocess = self.subprocess;
                _ = subprocess.poll.wait_thread.ref_count.fetchSub(1, .Monotonic);
                bun.default_allocator.destroy(self);
                subprocess.onWaitPid(false, subprocess.this_jsvalue, result, self.rusage);
            }
        };

        pub fn append(process: *Subprocess) void {
            if (process.poll == .wait_thread) {
                process.poll.wait_thread.poll_ref.activate(process.globalThis.bunVM().event_loop_handle.?);
                _ = process.poll.wait_thread.ref_count.fetchAdd(1, .Monotonic);
            } else {
                process.poll = .{
                    .wait_thread = .{
                        .poll_ref = .{},
                        .ref_count = std.atomic.Value(u32).init(1),
                    },
                };
                process.poll.wait_thread.poll_ref.activate(process.globalThis.bunVM().event_loop_handle.?);
            }

            const task = bun.default_allocator.create(WaitTask) catch unreachable;
            task.* = WaitTask{
                .subprocess = process,
            };
            instance.concurrent_queue.push(task);
            process.updateHasPendingActivity();

            init() catch @panic("Failed to start WaiterThread");

            if (comptime Environment.isLinux) {
                const one = @as([8]u8, @bitCast(@as(usize, 1)));
                _ = std.os.write(instance.eventfd.cast(), &one) catch @panic("Failed to write to eventfd");
            }
        }

        pub fn appendLifecycleScriptSubprocess(lifecycle_script: *LifecycleScriptSubprocess) void {
            const task = bun.default_allocator.create(LifecycleScriptWaitTask) catch unreachable;
            task.* = LifecycleScriptWaitTask{
                .lifecycle_script_subprocess = lifecycle_script,
            };
            instance.lifecycle_script_concurrent_queue.push(task);

            init() catch @panic("Failed to start WaiterThread");

            if (comptime Environment.isLinux) {
                const one = @as([8]u8, @bitCast(@as(usize, 1)));
                _ = std.os.write(instance.eventfd.cast(), &one) catch @panic("Failed to write to eventfd");
            }
        }

        fn loopSubprocess(this: *WaiterThread) void {
            {
                var batch = this.concurrent_queue.popBatch();
                var iter = batch.iterator();
                this.queue.ensureUnusedCapacity(batch.count) catch unreachable;
                while (iter.next()) |task| {
                    this.queue.appendAssumeCapacity(task.subprocess);
                    bun.default_allocator.destroy(task);
                }
            }

            var queue: []*Subprocess = this.queue.items;
            var i: usize = 0;
            while (queue.len > 0 and i < queue.len) {
                var process = queue[i];

                // this case shouldn't really happen
                if (process.pid == bun.invalid_fd.int()) {
                    _ = this.queue.orderedRemove(i);
                    _ = process.poll.wait_thread.ref_count.fetchSub(1, .Monotonic);
                    queue = this.queue.items;
                    continue;
                }

                var rusage_result: Rusage = std.mem.zeroes(Rusage);

                const result = PosixSpawn.wait4(process.pid, std.os.W.NOHANG, &rusage_result);
                if (result == .err or (result == .result and result.result.pid == process.pid)) {
                    _ = this.queue.orderedRemove(i);
                    process.pid_rusage = rusage_result;
                    queue = this.queue.items;

                    const task = bun.default_allocator.create(WaitPidResultTask) catch unreachable;
                    task.* = WaitPidResultTask{
                        .result = result,
                        .subprocess = process,
                        .rusage = rusage_result,
                    };

                    process.globalThis.bunVMConcurrently().enqueueTaskConcurrent(
                        JSC.ConcurrentTask.create(
                            JSC.Task.init(task),
                        ),
                    );
                }

                i += 1;
            }
        }

        fn loopLifecycleScriptsSubprocess(this: *WaiterThread) void {
            {
                var batch = this.lifecycle_script_concurrent_queue.popBatch();
                var iter = batch.iterator();
                this.lifecycle_script_queue.ensureUnusedCapacity(batch.count) catch unreachable;
                while (iter.next()) |task| {
                    this.lifecycle_script_queue.appendAssumeCapacity(task.lifecycle_script_subprocess);
                    bun.default_allocator.destroy(task);
                }
            }

            var queue: []*LifecycleScriptSubprocess = this.lifecycle_script_queue.items;
            var i: usize = 0;
            while (queue.len > 0 and i < queue.len) {
                var lifecycle_script_subprocess = queue[i];

                if (lifecycle_script_subprocess.pid == bun.invalid_fd.int()) {
                    _ = this.lifecycle_script_queue.orderedRemove(i);
                    queue = this.lifecycle_script_queue.items;
                }

                // const result = PosixSpawn.waitpid(lifecycle_script_subprocess.pid, std.os.W.NOHANG);
                switch (PosixSpawn.waitpid(lifecycle_script_subprocess.pid, std.os.W.NOHANG)) {
                    .err => |err| {
                        std.debug.print("waitpid error: {s}\n", .{@tagName(err.getErrno())});
                        Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> script from \"<b>{s}<r>\" due to error <b>{d} {s}<r>", .{
                            lifecycle_script_subprocess.scriptName(),
                            lifecycle_script_subprocess.package_name,
                            err.errno,
                            @tagName(err.getErrno()),
                        });
                        Output.flush();
                        _ = lifecycle_script_subprocess.manager.pending_lifecycle_script_tasks.fetchSub(1, .Monotonic);
                        _ = LifecycleScriptSubprocess.alive_count.fetchSub(1, .Monotonic);
                    },
                    .result => |result| {
                        if (result.pid == lifecycle_script_subprocess.pid) {
                            _ = this.lifecycle_script_queue.orderedRemove(i);
                            queue = this.lifecycle_script_queue.items;

                            lifecycle_script_subprocess.onResult(.{
                                .pid = result.pid,
                                .status = result.status,
                            });
                        }
                    },
                }

                i += 1;
            }
        }

        pub fn loop() void {
            Output.Source.configureNamedThread("Waitpid");

            var this = &instance;

            while (true) {
                this.loopSubprocess();
                this.loopLifecycleScriptsSubprocess();
                this.shell.jsc.loop();
                this.shell.mini.loop();

                if (comptime Environment.isLinux) {
                    var polls = [_]std.os.pollfd{
                        .{
                            .fd = this.signalfd.cast(),
                            .events = std.os.POLL.IN | std.os.POLL.ERR,
                            .revents = 0,
                        },
                        .{
                            .fd = this.eventfd.cast(),
                            .events = std.os.POLL.IN | std.os.POLL.ERR,
                            .revents = 0,
                        },
                    };

                    _ = std.os.poll(&polls, std.math.maxInt(i32)) catch 0;

                    // Make sure we consume any pending signals
                    var buf: [1024]u8 = undefined;
                    _ = std.os.read(this.signalfd.cast(), &buf) catch 0;
                } else {
                    var mask = std.os.empty_sigset;
                    var signal: c_int = std.os.SIG.CHLD;
                    const rc = std.c.sigwait(&mask, &signal);
                    _ = rc;
                }
            }
        }
    };
};
