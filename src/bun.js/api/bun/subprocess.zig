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

const PosixSpawn = bun.posix.spawn;

pub const Subprocess = struct {
    const log = Output.scoped(.Subprocess, false);
    pub usingnamespace JSC.Codegen.JSSubprocess;
    const default_max_buffer_size = 1024 * 1024 * 4;

    pid: if (Environment.isWindows) uv.uv_process_t else std.os.pid_t,
    // on macOS, this is nothing
    // on linux, it's a pidfd
    pidfd: if (Environment.isLinux) bun.FileDescriptor else u0 = std.math.maxInt(if (Environment.isLinux) bun.FileDescriptor else u0),

    stdin: Writable,
    stdout: Readable,
    stderr: Readable,
    poll: Poll = Poll{ .poll_ref = null },

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
                        if (this.pipe.buffer.fifo.poll_ref) |poll| {
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
                        if (this.pipe.buffer.fifo.poll_ref) |poll| {
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

            pub fn finish(this: *@This()) void {
                if (this.* == .stream and this.stream.ptr == .File) {
                    this.stream.ptr.File.finish();
                }
            }

            pub fn done(this: *@This()) void {
                if (this.* == .stream) {
                    if (this.stream.ptr == .File) this.stream.ptr.File.setSignal(JSC.WebCore.Signal{});
                    this.stream.done();
                    return;
                }

                this.buffer.close();
            }

            pub fn toJS(this: *@This(), readable: *Readable, globalThis: *JSC.JSGlobalObject, exited: bool) JSValue {
                if (this.* != .stream) {
                    const stream = this.buffer.toReadableStream(globalThis, exited);
                    this.* = .{ .stream = stream };
                }

                if (this.stream.ptr == .File) {
                    this.stream.ptr.File.setSignal(JSC.WebCore.Signal.init(readable));
                }

                return this.stream.toJS();
            }
        };

        pub fn init(stdio: Stdio, fd: i32, allocator: std.mem.Allocator, max_size: u32) Readable {
            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ignore => Readable{ .ignore = {} },
                .pipe => brk: {
                    break :brk .{
                        .pipe = .{
                            .buffer = BufferedOutput.initWithAllocator(allocator, bun.toFD(fd), max_size),
                        },
                    };
                },
                .path => Readable{ .ignore = {} },
                .blob, .fd => Readable{ .fd = bun.toFD(fd) },
                .memfd => Readable{ .memfd = stdio.memfd },
                .array_buffer => Readable{
                    .pipe = .{
                        .buffer = BufferedOutput.initWithSlice(bun.toFD(fd), stdio.array_buffer.slice()),
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

        pub fn finalize(this: *Readable) void {
            switch (this.*) {
                inline .memfd, .fd => |fd| {
                    _ = bun.sys.close(fd);
                },
                .pipe => {
                    if (this.pipe == .stream and this.pipe.stream.ptr == .File) {
                        this.close();
                        return;
                    }

                    this.pipe.buffer.close();
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
                    this.pipe.buffer.fifo.close_on_empty_read = true;
                    this.pipe.buffer.readAll();

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

        if (!(sig > -1 and sig < std.math.maxInt(u8))) {
            globalThis.throwInvalidArguments("Invalid signal: must be > -1 and < 255", .{});
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
                    if (this.pidfd == bun.invalid_fd) {
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
                if (uv.uv_process_kill(&this.pid, sig).errEnum()) |err| {
                    if (err != .SRCH)
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

        this.pidfd = bun.invalid_fd;

        if (pidfd != bun.invalid_fd) {
            _ = std.os.close(pidfd);
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

    pub const BufferedInput = struct {
        remain: []const u8 = "",
        fd: bun.FileDescriptor = bun.invalid_fd,
        poll_ref: ?*Async.FilePoll = null,
        written: usize = 0,

        source: union(enum) {
            blob: JSC.WebCore.AnyBlob,
            array_buffer: JSC.ArrayBuffer.Strong,
        },

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
        fifo: JSC.WebCore.FIFO = undefined,
        auto_sizer: ?JSC.WebCore.AutoSizer = null,
        status: Status = .{
            .pending = {},
        },

        pub const Status = union(enum) {
            pending: void,
            done: void,
            err: bun.sys.Error,
        };

        pub fn init(fd: bun.FileDescriptor) BufferedOutput {
            return BufferedOutput{
                .internal_buffer = .{},
                .fifo = JSC.WebCore.FIFO{
                    .fd = fd,
                },
            };
        }

        pub fn initWithSlice(fd: bun.FileDescriptor, slice: []u8) BufferedOutput {
            return BufferedOutput{
                // fixed capacity
                .internal_buffer = bun.ByteList.initWithBuffer(slice),
                .auto_sizer = null,
                .fifo = JSC.WebCore.FIFO{
                    .fd = fd,
                },
            };
        }

        pub fn initWithAllocator(allocator: std.mem.Allocator, fd: bun.FileDescriptor, max_size: u32) BufferedOutput {
            var this = init(fd);
            this.auto_sizer = .{
                .max = max_size,
                .allocator = allocator,
                .buffer = &this.internal_buffer,
            };
            return this;
        }

        pub fn onRead(this: *BufferedOutput, result: JSC.WebCore.StreamResult) void {
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
                    this.fifo.close();

                    return;
                },
                .done => {
                    this.status = .{ .done = {} };
                    this.fifo.close();
                    return;
                },
                else => {
                    const slice = result.slice();
                    this.internal_buffer.len += @as(u32, @truncate(slice.len));
                    if (slice.len > 0)
                        std.debug.assert(this.internal_buffer.contains(slice));

                    if (result.isDone() or (slice.len == 0 and this.fifo.poll_ref != null and this.fifo.poll_ref.?.isHUP())) {
                        this.status = .{ .done = {} };
                        this.fifo.close();
                    }
                },
            }
        }

        pub fn readAll(this: *BufferedOutput) void {
            if (this.auto_sizer) |auto_sizer| {
                while (@as(usize, this.internal_buffer.len) < auto_sizer.max and this.status == .pending) {
                    var stack_buffer: [8096]u8 = undefined;
                    const stack_buf: []u8 = stack_buffer[0..];
                    var buf_to_use = stack_buf;
                    const available = this.internal_buffer.available();
                    if (available.len >= stack_buf.len) {
                        buf_to_use = available;
                    }

                    const result = this.fifo.read(buf_to_use, this.fifo.to_read);

                    switch (result) {
                        .pending => {
                            this.watch();
                            return;
                        },
                        .err => |err| {
                            this.status = .{ .err = err };
                            this.fifo.close();

                            return;
                        },
                        .done => {
                            this.status = .{ .done = {} };
                            this.fifo.close();
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

                    const result = this.fifo.read(buf_to_use, this.fifo.to_read);

                    switch (result) {
                        .pending => {
                            this.watch();
                            return;
                        },
                        .err => |err| {
                            this.status = .{ .err = err };
                            this.fifo.close();

                            return;
                        },
                        .done => {
                            this.status = .{ .done = {} };
                            this.fifo.close();
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
            std.debug.assert(this.fifo.fd != bun.invalid_fd);

            this.fifo.pending.set(BufferedOutput, this, onRead);
            if (!this.fifo.isWatching()) this.fifo.watch(this.fifo.fd);
            return;
        }

        pub fn toBlob(this: *BufferedOutput, globalThis: *JSC.JSGlobalObject) JSC.WebCore.Blob {
            const blob = JSC.WebCore.Blob.init(this.internal_buffer.slice(), bun.default_allocator, globalThis);
            this.internal_buffer = bun.ByteList.init("");
            return blob;
        }

        pub fn toReadableStream(this: *BufferedOutput, globalThis: *JSC.JSGlobalObject, exited: bool) JSC.WebCore.ReadableStream {
            if (exited) {
                // exited + received EOF => no more read()
                if (this.fifo.isClosed()) {
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

            {
                const internal_buffer = this.internal_buffer;
                this.internal_buffer = bun.ByteList.init("");

                // There could still be data waiting to be read in the pipe
                // so we need to create a new stream that will read from the
                // pipe and then return the blob.
                const result = JSC.WebCore.ReadableStream.fromJS(
                    JSC.WebCore.ReadableStream.fromFIFO(
                        globalThis,
                        &this.fifo,
                        internal_buffer,
                    ),
                    globalThis,
                ).?;
                this.fifo.fd = bun.invalid_fd;
                this.fifo.poll_ref = null;
                return result;
            }
        }

        pub fn close(this: *BufferedOutput) void {
            switch (this.status) {
                .done => {},
                .pending => {
                    this.fifo.close();
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

    const Writable = union(enum) {
        pipe: *JSC.WebCore.FileSink,
        pipe_to_readable_stream: struct {
            pipe: *JSC.WebCore.FileSink,
            readable_stream: JSC.WebCore.ReadableStream,
        },
        fd: bun.FileDescriptor,
        buffered_input: BufferedInput,
        memfd: bun.FileDescriptor,
        inherit: void,
        ignore: void,

        pub fn ref(this: *Writable) void {
            switch (this.*) {
                .pipe => {
                    if (this.pipe.poll_ref) |poll| {
                        poll.enableKeepingProcessAlive(JSC.VirtualMachine.get());
                    }
                },
                else => {},
            }
        }

        pub fn unref(this: *Writable) void {
            switch (this.*) {
                .pipe => {
                    if (this.pipe.poll_ref) |poll| {
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

        pub fn init(stdio: Stdio, fd: i32, globalThis: *JSC.JSGlobalObject) !Writable {
            switch (stdio) {
                .pipe => {
                    if (Environment.isWindows) @panic("TODO");
                    var sink = try globalThis.bunVM().allocator.create(JSC.WebCore.FileSink);
                    sink.* = .{
                        .fd = bun.toFD(fd),
                        .buffer = bun.ByteList{},
                        .allocator = globalThis.bunVM().allocator,
                        .auto_close = true,
                    };
                    sink.mode = bun.S.IFIFO;
                    sink.watch(fd);
                    if (stdio == .pipe) {
                        if (stdio.pipe) |readable| {
                            return Writable{
                                .pipe_to_readable_stream = .{
                                    .pipe = sink,
                                    .readable_stream = readable,
                                },
                            };
                        }
                    }

                    return Writable{ .pipe = sink };
                },
                .array_buffer, .blob => {
                    var buffered_input: BufferedInput = .{ .fd = bun.toFD(fd), .source = undefined };
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
                    return Writable{ .fd = bun.toFD(fd) };
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

        pub fn close(this: *Writable) void {
            return switch (this.*) {
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
            };
        }
    };

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
    pub fn finalizeSync(this: *Subprocess) void {
        this.closeProcess();

        this.closeIO(.stdin);
        this.closeIO(.stdout);
        this.closeIO(.stderr);

        this.exit_promise.deinit();
        this.on_exit_callback.deinit();
    }

    pub fn finalize(this: *Subprocess) callconv(.C) void {
        std.debug.assert(!this.hasPendingActivity());
        this.finalizeSync();
        log("Finalize", .{});
        bun.default_allocator.destroy(this);
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
                            stdio_iter.len = @min(stdio_iter.len, 4);
                            var i: u32 = 0;
                            while (stdio_iter.next()) |value| : (i += 1) {
                                if (!extractStdio(globalThis, i, value, &stdio))
                                    return JSC.JSValue.jsUndefined();
                            }
                        } else {
                            globalThis.throwInvalidArguments("stdio must be an array", .{});
                            return .zero;
                        }
                    }
                } else {
                    if (args.get(globalThis, "stdin")) |value| {
                        if (!extractStdio(globalThis, bun.posix.STDIN_FD, value, &stdio))
                            return .zero;
                    }

                    if (args.get(globalThis, "stderr")) |value| {
                        if (!extractStdio(globalThis, bun.posix.STDERR_FD, value, &stdio))
                            return .zero;
                    }

                    if (args.get(globalThis, "stdout")) |value| {
                        if (!extractStdio(globalThis, bun.posix.STDOUT_FD, value, &stdio))
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

            const stdin_pipe = if (stdio[0].isPiped()) stdio[0].makeUVPipe(globalThis) orelse return .zero else undefined;
            const stdout_pipe = if (stdio[1].isPiped()) stdio[1].makeUVPipe(globalThis) orelse return .zero else undefined;
            const stderr_pipe = if (stdio[2].isPiped()) stdio[2].makeUVPipe(globalThis) orelse return .zero else undefined;

            var uv_stdio = [3]uv.uv_stdio_container_s{
                stdio[0].setUpChildIoUvSpawn(bun.posix.STDIN_FD, stdin_pipe[0]) catch |err| return globalThis.handleError(err, "in setting up uv_process stdin"),
                stdio[1].setUpChildIoUvSpawn(bun.posix.STDOUT_FD, stdout_pipe[1]) catch |err| return globalThis.handleError(err, "in setting up uv_process stdout"),
                stdio[2].setUpChildIoUvSpawn(bun.posix.STDERR_FD, stderr_pipe[1]) catch |err| return globalThis.handleError(err, "in setting up uv_process stderr"),
            };

            var cwd_resolver = bun.path.PosixToWinNormalizer{};

            const options = uv.uv_process_options_t{
                .exit_cb = uvExitCallback,
                .args = @ptrCast(argv.items[0 .. argv.items.len - 1 :null]),
                .cwd = cwd_resolver.resolveCWDZ(cwd) catch |err| return globalThis.handleError(err, "in uv_spawn"),
                .env = env,
                .file = argv.items[0].?,
                .gid = 0,
                .uid = 0,
                .stdio = &uv_stdio,
                .stdio_count = uv_stdio.len,
                .flags = if (windows_hide == 1) uv.UV_PROCESS_WINDOWS_HIDE else 0,
            };
            const alloc = globalThis.allocator();
            var subprocess = allocator.create(Subprocess) catch {
                globalThis.throwOutOfMemory();
                return .zero;
            };

            if (uv.uv_spawn(jsc_vm.uvLoop(), &subprocess.pid, &options).errEnum()) |errno| {
                alloc.destroy(subprocess);
                globalThis.throwValue(bun.sys.Error.fromCode(errno, .uv_spawn).toJSC(globalThis));
                return .zero;
            }

            // When run synchronously, subprocess isn't garbage collected
            subprocess.* = Subprocess{
                .globalThis = globalThis,
                .pid = subprocess.pid,
                .pidfd = 0,
                .stdin = Writable.init(stdio[0], stdin_pipe[1], globalThis) catch {
                    globalThis.throwOutOfMemory();
                    return .zero;
                },
                // stdout and stderr only uses allocator and default_max_buffer_size if they are pipes and not a array buffer
                .stdout = Readable.init(stdio[1], stdout_pipe[0], jsc_vm.allocator, default_max_buffer_size),
                .stderr = Readable.init(stdio[2], stderr_pipe[0], jsc_vm.allocator, default_max_buffer_size),
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
            subprocess.finalizeSync();

            const sync_value = JSC.JSValue.createEmptyObject(globalThis, 4);
            sync_value.put(globalThis, JSC.ZigString.static("exitCode"), JSValue.jsNumber(@as(i32, @intCast(exitCode))));
            sync_value.put(globalThis, JSC.ZigString.static("stdout"), stdout);
            sync_value.put(globalThis, JSC.ZigString.static("stderr"), stderr);
            sync_value.put(globalThis, JSC.ZigString.static("success"), JSValue.jsBoolean(exitCode == 0));
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

        const stdin_pipe = if (stdio[0].isPiped()) os.pipe2(0) catch |err| {
            globalThis.throw("failed to create stdin pipe: {s}", .{@errorName(err)});
            return .zero;
        } else undefined;

        const stdout_pipe = if (stdio[1].isPiped()) os.pipe2(0) catch |err| {
            globalThis.throw("failed to create stdout pipe: {s}", .{@errorName(err)});
            return .zero;
        } else undefined;

        const stderr_pipe = if (stdio[2].isPiped()) os.pipe2(0) catch |err| {
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
            actions.dup2(fds[1], 3) catch |err| return globalThis.handleError(err, "in posix_spawn");
        }

        env_array.append(allocator, null) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        const env: [*:null]?[*:0]const u8 = @ptrCast(env_array.items.ptr);

        const pid = brk: {
            defer {
                if (stdio[0].isPiped()) {
                    _ = bun.sys.close(stdin_pipe[0]);
                }

                if (stdio[1].isPiped()) {
                    _ = bun.sys.close(stdout_pipe[1]);
                }

                if (stdio[2].isPiped()) {
                    _ = bun.sys.close(stderr_pipe[1]);
                }
            }

            break :brk switch (PosixSpawn.spawnZ(argv.items[0].?, actions, attr, @as([*:null]?[*:0]const u8, @ptrCast(argv.items[0..].ptr)), env)) {
                .err => |err| {
                    globalThis.throwValue(err.toJSC(globalThis));
                    return .zero;
                },
                .result => |pid_| pid_,
            };
        };

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
                        _ = std.os.linux.waitpid(pid, &status, 0);
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
            .pidfd = if (WaiterThread.shouldUseWaiterThread()) @truncate(bun.invalid_fd) else @truncate(pidfd),
            .stdin = Writable.init(stdio[bun.STDIN_FD], stdin_pipe[1], globalThis) catch {
                globalThis.throwOutOfMemory();
                return .zero;
            },
            // stdout and stderr only uses allocator and default_max_buffer_size if they are pipes and not a array buffer
            .stdout = Readable.init(stdio[bun.STDOUT_FD], stdout_pipe[0], jsc_vm.allocator, default_max_buffer_size),
            .stderr = Readable.init(stdio[bun.STDERR_FD], stderr_pipe[0], jsc_vm.allocator, default_max_buffer_size),
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
                const poll = Async.FilePoll.init(jsc_vm, watchfd, .{}, Subprocess, subprocess);
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
            const poll = Async.FilePoll.init(jsc_vm, watchfd, .{}, Subprocess, subprocess);
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
        subprocess.finalizeSync();

        const sync_value = JSC.JSValue.createEmptyObject(globalThis, 4);
        sync_value.put(globalThis, JSC.ZigString.static("exitCode"), JSValue.jsNumber(@as(i32, @intCast(exitCode))));
        sync_value.put(globalThis, JSC.ZigString.static("stdout"), stdout);
        sync_value.put(globalThis, JSC.ZigString.static("stderr"), stderr);
        sync_value.put(globalThis, JSC.ZigString.static("success"), JSValue.jsBoolean(exitCode == 0));

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
        this.onWaitPid(sync, this_jsvalue, PosixSpawn.waitpid(this.pid, if (sync) 0 else std.os.W.NOHANG));
    }

    pub fn onWaitPid(this: *Subprocess, sync: bool, this_jsvalue: JSC.JSValue, waitpid_result_: JSC.Maybe(PosixSpawn.WaitPidResult)) void {
        if (Environment.isWindows) {
            @panic("windows doesnt support subprocess yet. haha");
        }
        defer if (sync) this.updateHasPendingActivity();

        const pid = this.pid;

        var waitpid_result = waitpid_result_;

        while (true) {
            switch (waitpid_result) {
                .err => |err| {
                    this.waitpid_err = err;
                },
                .result => |result| {
                    if (result.pid == pid) {
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
                                        waitpid_result = PosixSpawn.waitpid(pid, if (sync) 0 else std.os.W.NOHANG);
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
        subprocess.exit_code = @intCast(exit_status);
        subprocess.signal_code = if (term_signal > 0 and term_signal < @intFromEnum(SignalCode.SIGSYS)) @enumFromInt(term_signal) else null;
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

                var holder = bun.default_allocator.create(Holder) catch @panic("OOM");

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
            pipe_fd: [2]i32,
            std_fileno: i32,
        ) !void {
            switch (stdio) {
                .array_buffer, .blob, .pipe => {
                    std.debug.assert(!(stdio == .blob and stdio.blob.needsToReadFile()));
                    const idx: usize = if (std_fileno == 0) 0 else 1;

                    try actions.dup2(pipe_fd[idx], std_fileno);
                    try actions.close(pipe_fd[1 - idx]);
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
            pipe_fd: i32,
        ) !uv.uv_stdio_container_s {
            return switch (stdio) {
                .array_buffer, .blob, .pipe => uv.uv_stdio_container_s{
                    .flags = uv.UV_INHERIT_FD,
                    .data = .{ .fd = pipe_fd },
                },
                .fd => |fd| uv.uv_stdio_container_s{
                    .flags = uv.UV_INHERIT_FD,
                    .data = .{ .fd = bun.uvfdcast(fd) },
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

        pub fn makeUVPipe(stdio: @This(), global: *JSGlobalObject) ?[2]uv.uv_file {
            std.debug.assert(stdio.isPiped());
            var pipe: [2]uv.uv_file = undefined;
            if (uv.uv_pipe(&pipe, 0, 0).errEnum()) |errno| {
                global.throwValue(bun.sys.Error.fromCode(errno, .uv_pipe).toJSC(global));
                return null;
            }
            return pipe;
        }
    };

    fn extractStdioBlob(
        globalThis: *JSC.JSGlobalObject,
        blob: JSC.WebCore.AnyBlob,
        i: u32,
        stdio_array: []Stdio,
    ) bool {
        const fd = bun.stdio(i);

        if (blob.needsToReadFile()) {
            if (blob.store()) |store| {
                if (store.data.file.pathlike == .fd) {
                    if (store.data.file.pathlike.fd == fd) {
                        stdio_array[i] = Stdio{ .inherit = {} };
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

                        stdio_array[i] = Stdio{ .fd = store.data.file.pathlike.fd };
                    }

                    return true;
                }

                stdio_array[i] = .{ .path = store.data.file.pathlike.path };
                return true;
            }
        }

        stdio_array[i] = .{ .blob = blob };
        return true;
    }

    fn extractStdio(
        globalThis: *JSC.JSGlobalObject,
        i: u32,
        value: JSValue,
        stdio_array: []Stdio,
    ) bool {
        if (value.isEmptyOrUndefinedOrNull()) {
            return true;
        }

        if (value.isString()) {
            const str = value.getZigString(globalThis);
            if (str.eqlComptime("inherit")) {
                stdio_array[i] = Stdio{ .inherit = {} };
            } else if (str.eqlComptime("ignore")) {
                stdio_array[i] = Stdio{ .ignore = {} };
            } else if (str.eqlComptime("pipe")) {
                stdio_array[i] = Stdio{ .pipe = null };
            } else {
                globalThis.throwInvalidArguments("stdio must be an array of 'inherit', 'pipe', 'ignore', Bun.file(pathOrFd), number, or null", .{});
                return false;
            }

            return true;
        } else if (value.isNumber()) {
            const fd_ = value.toInt64();
            if (fd_ < 0) {
                globalThis.throwInvalidArguments("file descriptor must be a positive integer", .{});
                return false;
            }

            const fd = @as(bun.FileDescriptor, @intCast(fd_));

            switch (bun.FDTag.get(fd)) {
                .stdin => {
                    if (i == bun.STDERR_FD or i == bun.STDOUT_FD) {
                        globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                        return false;
                    }
                },

                .stdout, .stderr => {
                    if (i == bun.STDIN_FD) {
                        globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                        return false;
                    }
                },
                else => {},
            }

            stdio_array[i] = Stdio{ .fd = fd };

            return true;
        } else if (value.as(JSC.WebCore.Blob)) |blob| {
            return extractStdioBlob(globalThis, .{ .Blob = blob.dupe() }, i, stdio_array);
        } else if (value.as(JSC.WebCore.Request)) |req| {
            req.getBodyValue().toBlobIfPossible();
            return extractStdioBlob(globalThis, req.getBodyValue().useAsAnyBlob(), i, stdio_array);
        } else if (value.as(JSC.WebCore.Response)) |req| {
            req.getBodyValue().toBlobIfPossible();
            return extractStdioBlob(globalThis, req.getBodyValue().useAsAnyBlob(), i, stdio_array);
        } else if (JSC.WebCore.ReadableStream.fromJS(value, globalThis)) |req_const| {
            var req = req_const;
            if (i == bun.STDIN_FD) {
                if (req.toAnyBlob(globalThis)) |blob| {
                    return extractStdioBlob(globalThis, blob, i, stdio_array);
                }

                switch (req.ptr) {
                    .File, .Blob => unreachable,
                    .Direct, .JavaScript, .Bytes => {
                        if (req.isLocked(globalThis)) {
                            globalThis.throwInvalidArguments("ReadableStream cannot be locked", .{});
                            return false;
                        }

                        stdio_array[i] = .{ .pipe = req };
                        return true;
                    },
                    else => {},
                }

                globalThis.throwInvalidArguments("Unsupported ReadableStream type", .{});
                return false;
            }
        } else if (value.asArrayBuffer(globalThis)) |array_buffer| {
            if (array_buffer.slice().len == 0) {
                globalThis.throwInvalidArguments("ArrayBuffer cannot be empty", .{});
                return false;
            }

            stdio_array[i] = .{
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

    // Machines which do not support pidfd_open (GVisor, Linux Kernel < 5.6)
    // use a thread to wait for the child process to exit.
    // We use a single thread to call waitpid() in a loop.
    pub const WaiterThread = struct {
        concurrent_queue: Queue = .{},
        lifecycle_script_concurrent_queue: LifecycleScriptTaskQueue = .{},
        queue: std.ArrayList(*Subprocess) = std.ArrayList(*Subprocess).init(bun.default_allocator),
        lifecycle_script_queue: std.ArrayList(*LifecycleScriptSubprocess) = std.ArrayList(*LifecycleScriptSubprocess).init(bun.default_allocator),
        started: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
        signalfd: if (Environment.isLinux) bun.FileDescriptor else u0 = undefined,
        eventfd: if (Environment.isLinux) bun.FileDescriptor else u0 = undefined,

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
                instance.signalfd = try std.os.signalfd(-1, &mask, linux.SFD.CLOEXEC | linux.SFD.NONBLOCK);
                instance.eventfd = try std.os.eventfd(0, linux.EFD.NONBLOCK | linux.EFD.CLOEXEC | 0);
            }
        }

        pub const WaitPidResultTask = struct {
            result: JSC.Maybe(PosixSpawn.WaitPidResult),
            subprocess: *Subprocess,

            pub fn runFromJSThread(self: *@This()) void {
                const result = self.result;
                var subprocess = self.subprocess;
                _ = subprocess.poll.wait_thread.ref_count.fetchSub(1, .Monotonic);
                bun.default_allocator.destroy(self);
                subprocess.onWaitPid(false, subprocess.this_jsvalue, result);
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
                _ = std.os.write(instance.eventfd, &one) catch @panic("Failed to write to eventfd");
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
                _ = std.os.write(instance.eventfd, &one) catch @panic("Failed to write to eventfd");
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
                if (process.pid == bun.invalid_fd) {
                    _ = this.queue.orderedRemove(i);
                    _ = process.poll.wait_thread.ref_count.fetchSub(1, .Monotonic);
                    queue = this.queue.items;
                    continue;
                }

                const result = PosixSpawn.waitpid(process.pid, std.os.W.NOHANG);
                if (result == .err or (result == .result and result.result.pid == process.pid)) {
                    _ = this.queue.orderedRemove(i);
                    queue = this.queue.items;

                    const task = bun.default_allocator.create(WaitPidResultTask) catch unreachable;
                    task.* = WaitPidResultTask{
                        .result = result,
                        .subprocess = process,
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

                if (lifecycle_script_subprocess.pid == bun.invalid_fd) {
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

                if (comptime Environment.isLinux) {
                    var polls = [_]std.os.pollfd{
                        .{
                            .fd = @intCast(this.signalfd),
                            .events = std.os.POLL.IN | std.os.POLL.ERR,
                            .revents = 0,
                        },
                        .{
                            .fd = @intCast(this.eventfd),
                            .events = std.os.POLL.IN | std.os.POLL.ERR,
                            .revents = 0,
                        },
                    };

                    _ = std.os.poll(&polls, std.math.maxInt(i32)) catch 0;

                    // Make sure we consume any pending signals
                    var buf: [1024]u8 = undefined;
                    _ = std.os.read(this.signalfd, &buf) catch 0;
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
