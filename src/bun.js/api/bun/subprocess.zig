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
const Rusage = bun.posix.spawn.Rusage;
const Process = bun.posix.spawn.Process;
const WaiterThread = bun.posix.spawn.WaiterThread;

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
    };
    process: *Process = undefined,
    closed_streams: u8 = 0,
    deinit_onclose: bool = false,
    stdin: Writable,
    stdout: Readable,
    stderr: Readable,
    stdio_pipes: std.ArrayListUnmanaged(bun.FileDescriptor) = .{},
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

    pub const Flags = packed struct {
        is_sync: bool = false,
        killed: bool = false,
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

        return this.process.hasRef();
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
        this.process.enableKeepingEventLoopAlive();

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
    pub fn unref(this: *Subprocess, comptime _: bool) void {
        this.process.disableKeepingEventLoopAlive();

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
        sync_buffered_output: *BufferedOutput,

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
            buffer: StreamingOutput,
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

        pub fn initWithPipe(stdio: Stdio, pipe: *uv.Pipe, allocator: std.mem.Allocator, max_size: u32) Readable {
            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ignore => Readable{ .ignore = {} },
                .pipe => brk: {
                    break :brk .{
                        .pipe = .{
                            .buffer = StreamingOutput.initWithPipeAndAllocator(allocator, pipe, max_size),
                        },
                    };
                },
                .path => Readable{ .ignore = {} },
                .blob, .fd => @panic("use init() instead"),
                .memfd => Readable{ .memfd = stdio.memfd },
                .array_buffer => Readable{
                    .pipe = .{
                        .buffer = StreamingOutput.initWithPipeAndSlice(pipe, stdio.array_buffer.slice()),
                    },
                },
            };
        }
        pub fn init(stdio: Stdio, fd: ?bun.FileDescriptor, allocator: std.mem.Allocator, max_size: u32, is_sync: bool) Readable {
            if (comptime Environment.allow_assert) {
                if (fd) |fd_| {
                    std.debug.assert(fd_ != bun.invalid_fd);
                }
            }

            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ignore => Readable{ .ignore = {} },
                .pipe => brk: {
                    if (is_sync) {}
                    break :brk .{
                        .pipe = .{
                            .buffer = StreamingOutput.initWithAllocator(allocator, fd.?, max_size),
                        },
                    };
                },
                .path => Readable{ .ignore = {} },
                .blob, .fd => Readable{ .fd = fd.? },
                .memfd => Readable{ .memfd = stdio.memfd },
                .array_buffer => Readable{
                    .pipe = .{
                        .buffer = StreamingOutput.initWithSlice(fd.?, stdio.array_buffer.slice()),
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
                    this.* = .{ .closed = {} };
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
                    this.* = .{ .closed = {} };
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
                .sync_buffered_output => |*sync_buffered_output| {
                    const slice = sync_buffered_output.toOwnedSlice(globalThis);
                    this.* = .{ .closed = {} };
                    return JSC.MarkedArrayBuffer
                        .fromBytes(slice, bun.default_allocator, .Uint8Array)
                        .toNodeBuffer(globalThis);
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
        return this.stderr.toJS(globalThis, this.hasExited());
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
        return this.process.hasKilled();
    }

    pub fn tryKill(this: *Subprocess, sig: i32) JSC.Node.Maybe(void) {
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
            array.push(global, JSValue.jsNumber(item.cast()));
        }
        return array;
    }

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
        reader: bun.io.BufferedOutputReader(BufferedOutput, null) = .{},
        process: *Subprocess = undefined,
        event_loop: *JSC.EventLoop = undefined,
        ref_count: u32 = 1,

        pub usingnamespace bun.NewRefCounted(@This(), deinit);

        pub fn onOutputDone(this: *BufferedOutput) void {
            this.process.onCloseIO(this.kind());
        }

        pub fn toOwnedSlice(this: *BufferedOutput) []u8 {
            // we do not use .toOwnedSlice() because we don't want to reallocate memory.
            const out = this.reader.buffer.items;
            this.reader.buffer.items = &.{};
            this.reader.buffer.capacity = 0;
            return out;
        }

        pub fn onOutputError(this: *BufferedOutput, err: bun.sys.Error) void {
            _ = this; // autofix
            Output.panic("BufferedOutput should never error. If it does, it's a bug in the code.\n{}", .{err});
        }

        fn kind(this: *const BufferedOutput) StdioKind {
            if (this.process.stdout == .sync_buffered_output and this.process.stdout.sync_buffered_output == this) {
                // are we stdout?
                return .stdout;
            } else if (this.process.stderr == .sync_buffered_output and this.process.stderr.sync_buffered_output == this) {
                // are we stderr?
                return .stderr;
            }

            @panic("We should be either stdout or stderr");
        }

        pub fn close(this: *BufferedOutput) void {
            if (!this.reader.is_done)
                this.reader.close();
        }

        pub fn eventLoop(this: *BufferedOutput) *JSC.EventLoop {
            return this.event_loop;
        }

        pub fn loop(this: *BufferedOutput) *uws.Loop {
            return this.event_loop.virtual_machine.uwsLoop();
        }

        fn deinit(this: *BufferedOutput) void {
            std.debug.assert(this.reader.is_done);

            if (comptime Environment.isWindows) {
                std.debug.assert(this.reader.pipe.isClosed());
            }

            this.destroy();
        }
    };

    pub const StreamingOutput = struct {
        reader: bun.io.BufferedOutputReader(BufferedOutput, onChunk) = .{},
        process: *Subprocess = undefined,
        event_loop: *JSC.EventLoop = undefined,
        ref_count: u32 = 1,

        pub fn readAll(this: *StreamingOutput) void {
            _ = this; // autofix
        }

        pub fn toBlob(this: *StreamingOutput, globalThis: *JSC.JSGlobalObject) JSC.WebCore.Blob {
            const blob = JSC.WebCore.Blob.init(this.internal_buffer.slice(), bun.default_allocator, globalThis);
            this.internal_buffer = bun.ByteList.init("");
            return blob;
        }

      

        fn signalStreamError(this: *StreamingOutput) void {
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
        fn flushBufferedDataIntoReadableStream(this: *StreamingOutput) void {
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
            const this = bun.cast(*StreamingOutput, ctx);
            if (this.globalThis) |globalThis| {
                this.readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(readable, globalThis) catch .{};
            }
        }

        fn toReadableStream(this: *StreamingOutput, globalThis: *JSC.JSGlobalObject, exited: bool) JSC.WebCore.ReadableStream {
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

        pub fn close(this: *StreamingOutput) void {
            switch (this.status) {
                .done => {},
                .pending => {
                    bun.markPosixOnly();
                    this.stream.close();
                    this.status = .{ .done = {} };
                },
                .err => {},
            }

            if (this.internal_buffer.cap > 0) {
                this.internal_buffer.listManaged(bun.default_allocator).deinit();
                this.internal_buffer = .{};
            }
        }
    };

    const SinkType = if (Environment.isWindows) *JSC.WebCore.UVStreamSink else *JSC.WebCore.FileSink;
    const BufferedInputType = BufferedInput;
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

        pub fn init(stdio: Stdio, fd: ?bun.FileDescriptor, globalThis: *JSC.JSGlobalObject) !Writable {
            if (comptime Environment.allow_assert) {
                if (fd) |fd_| {
                    std.debug.assert(fd_ != bun.invalid_fd);
                }
            }

            switch (stdio) {
                .pipe => |maybe_readable| {
                    if (Environment.isWindows) @panic("TODO");
                    var sink = try globalThis.bunVM().allocator.create(JSC.WebCore.FileSink);
                    sink.* = .{
                        .fd = fd.?,
                        .buffer = bun.ByteList{},
                        .allocator = globalThis.bunVM().allocator,
                        .auto_close = true,
                    };
                    sink.mode = bun.S.IFIFO;
                    sink.watch(fd.?);
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
                .sync_buffered_output => |buffer| {
                    _ = buffer; // autofix
                    @panic("This should never be called");
                },
                .array_buffer, .blob => {
                    var buffered_input: BufferedInput = .{ .fd = fd.?, .source = undefined };
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
                .memfd => |memfd| {
                    std.debug.assert(memfd != bun.invalid_fd);
                    return Writable{ .memfd = memfd };
                },
                .fd => {
                    std.debug.assert(fd.? != bun.invalid_fd);
                    return Writable{ .fd = fd.? };
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
                .memfd => |fd| {
                    _ = bun.sys.close(fd);
                    this.* = .{ .ignore = {} };
                },
                .buffered_input => {
                    this.buffered_input.deinit();
                },
                .ignore => {},
                .fd, .inherit => {},
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

    pub fn onProcessExit(this: *Subprocess, _: *Process, status: bun.spawn.Status, rusage: *const Rusage) void {
        log("onProcessExit()", .{});
        const this_jsvalue = this.this_jsvalue;
        const globalThis = this.globalThis;
        this_jsvalue.ensureStillAlive();
        this.pid_rusage = rusage.*;
        const is_sync = this.flags.is_sync;
        _ = is_sync; // autofix
        var must_drain_tasks = false;
        defer {
            this.updateHasPendingActivity();

            if (must_drain_tasks)
                globalThis.bunVM().drainMicrotasks();
        }

        if (this.exit_promise.trySwap()) |promise| {
            must_drain_tasks = true;
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
            must_drain_tasks = true;
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

            for (this.stdio_pipes.items) |pipe| {
                _ = bun.sys.close(pipe);
            }
            this.stdio_pipes.clearAndFree(bun.default_allocator);
        }

        this.exit_promise.deinit();
        this.on_exit_callback.deinit();
    }

    pub fn finalize(this: *Subprocess) callconv(.C) void {
        log("finalize", .{});
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
        bun.markPosixOnly();

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
        var argv = std.ArrayList(?[*:0]const u8).init(allocator);
        var cmd_value = JSValue.zero;
        var detached = false;
        var args = args_;
        var ipc_mode = IPCMode.none;
        var ipc_callback: JSValue = .zero;
        var extra_fds = std.ArrayList(bun.spawn.SpawnOptions.Stdio).init(bun.default_allocator);

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

                // This must run before the stdio parsing happens
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
                        extra_fds.append(.{ .buffer = {} }) catch {
                            globalThis.throwOutOfMemory();
                            return .zero;
                        };
                    }
                }

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
                                        extra_fds.append(.{ .buffer = {} }) catch {
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

                if (Environment.isWindows) {
                    if (args.get(globalThis, "windowsHide")) |val| {
                        if (val.isBoolean()) {
                            windows_hide = @intFromBool(val.asBoolean());
                        }
                    }
                }
            }
        }

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
            if (stdio[1] == .pipe and stdio[1].pipe == null) {
                stdio[1] = .{ .sync_buffered_output = BufferedOutput.new(.{}) };
            }

            if (stdio[2] == .pipe and stdio[2].pipe == null) {
                stdio[2] = .{ .sync_buffered_output = BufferedOutput.new(.{}) };
            }
        } else {
            if (stdio[1] == .pipe and stdio[1].pipe == null) {
                stdio[1] = .{ .buffer = {} };
            }

            if (stdio[2] == .pipe and stdio[2].pipe == null) {
                stdio[2] = .{ .buffer = {} };
            }
        }
        defer {
            if (comptime is_sync) {
                if (stdio[1] == .sync_buffered_output) {
                    stdio[1].sync_buffered_output.deref();
                }

                if (stdio[2] == .sync_buffered_output) {
                    stdio[2].sync_buffered_output.deref();
                }
            }
        }

        const spawn_options = bun.spawn.SpawnOptions{
            .cwd = cwd,
            .detached = detached,
            .stdin = stdio[0].asSpawnOption(),
            .stdout = stdio[1].asSpawnOption(),
            .stderr = stdio[2].asSpawnOption(),
            .extra_fds = extra_fds.items,

            .windows = if (Environment.isWindows) bun.spawn.WindowsSpawnOptions.WindowsOptions{
                .hide_window = windows_hide,
                .loop = jsc_vm.eventLoop().uws_loop,
            } else {},
        };

        var spawned = switch (bun.spawn.spawnProcess(
            &spawn_options,
            @ptrCast(argv.items.ptr),
            @ptrCast(env_array.items.ptr),
        ) catch |err| {
            globalThis.throwError(err, ": failed to spawn process");

            return .zero;
        }) {
            .err => |err| {
                globalThis.throwValue(err.toJSC(globalThis));
                return .zero;
            },
            .result => |result| result,
        };

        if (ipc_mode != .none) {
            socket = .{
                // we initialize ext later in the function
                .socket = uws.us_socket_from_fd(
                    jsc_vm.rareData().spawnIPCContext(jsc_vm),
                    @sizeOf(*Subprocess),
                    spawned.extra_pipes.items[0].cast(),
                ) orelse {
                    globalThis.throw("failed to create socket pair", .{});
                    // TODO:
                    return .zero;
                },
            };
        }

        var subprocess = globalThis.allocator().create(Subprocess) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };

        // When run synchronously, subprocess isn't garbage collected
        subprocess.* = Subprocess{
            .globalThis = globalThis,
            .process = spawned.toProcess(
                jsc_vm.eventLoop(),
                is_sync,
            ),
            .pid_rusage = null,
            .stdin = Writable.init(stdio[0], spawned.stdin, globalThis) catch {
                globalThis.throwOutOfMemory();
                return .zero;
            },
            .stdout = Readable.init(stdio[1], spawned.stdout, jsc_vm.allocator, default_max_buffer_size, is_sync),
            .stderr = Readable.init(stdio[2], spawned.stderr, jsc_vm.allocator, default_max_buffer_size, is_sync),
            .stdio_pipes = spawned.extra_pipes.moveToUnmanaged(),
            .on_exit_callback = if (on_exit_callback != .zero) JSC.Strong.create(on_exit_callback, globalThis) else .{},
            .ipc_mode = ipc_mode,
            // will be assigned in the block below
            .ipc = .{ .socket = socket },
            .ipc_callback = if (ipc_callback != .zero) JSC.Strong.create(ipc_callback, globalThis) else undefined,
            .flags = .{
                .is_sync = is_sync,
            },
        };
        subprocess.process.setExitHandler(subprocess);

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

        if (comptime is_sync) {
            switch (subprocess.process.watch(jsc_vm)) {
                .result => {},
                .err => {
                    subprocess.process.wait(true);
                },
            }
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

        subprocess.updateHasPendingActivity();

        const exitCode = subprocess.getExitCode(globalThis);
        const stdout = subprocess.stdout.toBufferedValue(globalThis);
        const stderr = subprocess.stderr.toBufferedValue(globalThis);
        const resource_usage = subprocess.createResourceUsageObject(globalThis);
        subprocess.finalize();

        const sync_value = JSC.JSValue.createEmptyObject(globalThis, 5);
        sync_value.put(globalThis, JSC.ZigString.static("exitCode"), exitCode);
        sync_value.put(globalThis, JSC.ZigString.static("stdout"), stdout);
        sync_value.put(globalThis, JSC.ZigString.static("stderr"), stderr);
        sync_value.put(globalThis, JSC.ZigString.static("success"), JSValue.jsBoolean(exitCode.isInt32() and exitCode.asInt32() == 0));
        sync_value.put(globalThis, JSC.ZigString.static("resourceUsage"), resource_usage);

        return sync_value;
    }

    const os = std.os;

    const Stdio = union(enum) {
        inherit: void,
        ignore: void,
        fd: bun.FileDescriptor,
        path: JSC.Node.PathLike,
        blob: JSC.WebCore.AnyBlob,
        pipe: ?JSC.WebCore.ReadableStream,
        array_buffer: JSC.ArrayBuffer.Strong,
        memfd: bun.FileDescriptor,
        sync_buffered_output: *BufferedOutput,

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

        fn toPosix(
            stdio: @This(),
        ) bun.spawn.SpawnOptions.Stdio {
            return switch (stdio) {
                .array_buffer, .blob, .pipe => .{ .buffer = {} },
                .fd => |fd| .{ .pipe = fd },
                .memfd => |fd| .{ .pipe = fd },
                .path => |pathlike| .{ .path = pathlike.slice() },
                .inherit => .{ .inherit = {} },
                .ignore => .{ .ignore = {} },
            };
        }

        fn toWindows(
            stdio: @This(),
        ) bun.spawn.SpawnOptions.Stdio {
            return switch (stdio) {
                .array_buffer, .blob, .pipe => .{ .buffer = {} },
                .fd => |fd| .{ .pipe = fd },
                .path => |pathlike| .{ .path = pathlike.slice() },
                .inherit => .{ .inherit = {} },
                .ignore => .{ .ignore = {} },
                .sync_buffer => .{ .buffer = &stdio.sync_buffer.reader.pipe },

                .memfd => @panic("This should never happen"),
            };
        }

        pub fn asSpawnOption(
            stdio: @This(),
        ) bun.spawn.SpawnOptions.Stdio {
            if (comptime Environment.isWindows) {
                return stdio.toWindows();
            } else {
                return stdio.toPosix();
            }
        }

        fn setUpChildIoUvSpawn(
            stdio: @This(),
            std_fileno: i32,
            pipe: *uv.Pipe,
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
            } else if (str.eqlComptime("pipe") or str.eqlComptime("overlapped")) {
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

            if (fd.int() >= std.math.maxInt(i32)) {
                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
                globalThis.throwInvalidArguments("file descriptor must be a valid integer, received: {}", .{
                    value.toFmt(globalThis, &formatter),
                });
                return false;
            }

            switch (bun.FDTag.get(fd)) {
                .stdin => {
                    if (i == 1 or i == 2) {
                        globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                        return false;
                    }

                    out_stdio.* = Stdio{ .inherit = {} };
                    return true;
                },

                .stdout, .stderr => |tag| {
                    if (i == 0) {
                        globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                        return false;
                    }

                    if (i == 1 and tag == .stdout) {
                        out_stdio.* = .{ .inherit = {} };
                        return true;
                    } else if (i == 2 and tag == .stderr) {
                        out_stdio.* = .{ .inherit = {} };
                        return true;
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

    pub const IPCHandler = IPC.NewIPCHandler(Subprocess);
};
