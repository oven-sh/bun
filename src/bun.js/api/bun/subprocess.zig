const Bun = @This();
const default_allocator = @import("root").bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;
const NetworkThread = @import("root").bun.HTTP.NetworkThread;
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

pub const Subprocess = struct {
    const log = Output.scoped(.Subprocess, false);
    pub usingnamespace JSC.Codegen.JSSubprocess;
    const default_max_buffer_size = 1024 * 1024 * 4;

    pid: std.os.pid_t,
    // on macOS, this is nothing
    // on linux, it's a pidfd
    pidfd: std.os.fd_t = std.math.maxInt(std.os.fd_t),

    stdin: Writable,
    stdout: Readable,
    stderr: Readable,
    killed: bool = false,
    poll_ref: ?*JSC.FilePoll = null,

    exit_promise: JSC.Strong = .{},
    on_exit_callback: JSC.Strong = .{},

    exit_code: ?u8 = null,
    signal_code: ?SignalCode = null,
    waitpid_err: ?JSC.Node.Syscall.Error = null,

    has_waitpid_task: bool = false,
    notification_task: JSC.AnyTask = undefined,
    waitpid_task: JSC.AnyTask = undefined,

    wait_task: JSC.ConcurrentTask = .{},

    finalized: bool = false,

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
    has_pending_activity: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(true),
    is_sync: bool = false,
    this_jsvalue: JSC.JSValue = .zero,

    pub const SignalCode = bun.SignalCode;

    pub fn hasExited(this: *const Subprocess) bool {
        return this.exit_code != null or this.waitpid_err != null or this.signal_code != null;
    }

    pub fn updateHasPendingActivityFlag(this: *Subprocess) void {
        @fence(.SeqCst);
        this.has_pending_activity.store(this.waitpid_err == null and this.exit_code == null, .SeqCst);
    }

    pub fn hasPendingActivity(this: *Subprocess) callconv(.C) bool {
        @fence(.Acquire);
        return this.has_pending_activity.load(.Acquire);
    }

    pub fn updateHasPendingActivity(this: *Subprocess) void {
        @fence(.Release);
        this.has_pending_activity.store(this.waitpid_err == null and this.exit_code == null, .Release);
    }

    pub fn ref(this: *Subprocess) void {
        var vm = this.globalThis.bunVM();
        if (this.poll_ref) |poll| poll.enableKeepingProcessAlive(vm);
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

    pub fn unref(this: *Subprocess) void {
        var vm = this.globalThis.bunVM();
        if (this.poll_ref) |poll| poll.disableKeepingProcessAlive(vm);
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
                            .buffer = BufferedOutput.initWithAllocator(allocator, fd, max_size),
                        },
                    };
                },
                .path => Readable{ .ignore = {} },
                .blob, .fd => Readable{ .fd = @intCast(bun.FileDescriptor, fd) },
                .array_buffer => Readable{
                    .pipe = .{
                        .buffer = BufferedOutput.initWithSlice(fd, stdio.array_buffer.slice()),
                    },
                },
            };
        }

        pub fn onClose(this: *Readable, _: ?JSC.Node.Syscall.Error) void {
            this.* = .closed;
        }

        pub fn onReady(_: *Readable, _: ?JSC.WebCore.Blob.SizeType, _: ?JSC.WebCore.Blob.SizeType) void {}

        pub fn onStart(_: *Readable) void {}

        pub fn close(this: *Readable) void {
            switch (this.*) {
                .fd => |fd| {
                    _ = JSC.Node.Syscall.close(fd);
                },
                .pipe => {
                    this.pipe.done();
                },
                else => {},
            }
        }

        pub fn finalize(this: *Readable) void {
            switch (this.*) {
                .fd => |fd| {
                    _ = JSC.Node.Syscall.close(fd);
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
                .pipe => {
                    this.pipe.buffer.fifo.close_on_empty_read = true;
                    this.pipe.buffer.readAll();

                    var bytes = this.pipe.buffer.internal_buffer.slice();
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
        return this.killed or this.hasExited();
    }

    pub fn tryKill(this: *Subprocess, sig: i32) JSC.Node.Maybe(void) {
        if (this.hasKilled()) {
            return .{ .result = {} };
        }

        if (comptime Environment.isLinux) {
            // should this be handled differently?
            // this effectively shouldn't happen
            if (this.pidfd == std.math.maxInt(std.os.fd_t)) {
                return .{ .result = {} };
            }

            // first appeared in Linux 5.1
            const rc = std.os.linux.pidfd_send_signal(this.pidfd, @intCast(u8, sig), null, 0);

            if (rc != 0) {
                const errno = std.os.linux.getErrno(rc);
                // if the process was already killed don't throw
                if (errno != .SRCH)
                    return .{ .err = JSC.Node.Syscall.Error.fromCode(errno, .kill) };
            }
        } else {
            const err = std.c.kill(this.pid, sig);
            if (err != 0) {
                const errno = std.c.getErrno(err);

                // if the process was already killed don't throw
                if (errno != .SRCH)
                    return .{ .err = JSC.Node.Syscall.Error.fromCode(errno, .kill) };
            }
        }

        this.killed = true;
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

        this.pidfd = std.math.maxInt(std.os.fd_t);

        if (pidfd != std.math.maxInt(std.os.fd_t)) {
            _ = std.os.close(pidfd);
        }
    }

    pub fn doRef(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.ref();
        return JSC.JSValue.jsUndefined();
    }

    pub fn doUnref(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.unref();
        return JSC.JSValue.jsUndefined();
    }

    pub fn getPid(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSValue.jsNumber(this.pid);
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
        poll_ref: ?*JSC.FilePoll = null,
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
                        if (this.poll_ref) |poll_ref| {
                            poll_ref.flags.insert(.writable);
                            poll_ref.flags.insert(.fifo);
                            std.debug.assert(poll_ref.flags.contains(.poll_writable));
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
                switch (JSC.Node.Syscall.write(this.fd, to_write)) {
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
                _ = JSC.Node.Syscall.close(this.fd);
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
            err: JSC.Node.Syscall.Error,
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
                    this.status = .{ .err = err };
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
                    this.internal_buffer.len += @truncate(u32, slice.len);
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
                    var stack_buf: []u8 = stack_buffer[0..];
                    var buf_to_use = stack_buf;
                    var available = this.internal_buffer.available();
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
                                this.internal_buffer.len += @truncate(u32, slice.len);
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
                    var buf_to_use = this.internal_buffer.available();

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
                            this.internal_buffer.len += @truncate(u32, slice.len);

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
        pub fn onClose(this: *Writable, _: ?JSC.Node.Syscall.Error) void {
            this.* = .{
                .ignore = {},
            };
        }
        pub fn onReady(_: *Writable, _: ?JSC.WebCore.Blob.SizeType, _: ?JSC.WebCore.Blob.SizeType) void {}
        pub fn onStart(_: *Writable) void {}

        pub fn init(stdio: Stdio, fd: i32, globalThis: *JSC.JSGlobalObject) !Writable {
            switch (stdio) {
                .pipe => {
                    var sink = try globalThis.bunVM().allocator.create(JSC.WebCore.FileSink);
                    sink.* = .{
                        .fd = fd,
                        .buffer = bun.ByteList{},
                        .allocator = globalThis.bunVM().allocator,
                        .auto_close = true,
                    };
                    sink.mode = std.os.S.IFIFO;
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
                .fd => {
                    return Writable{ .fd = @intCast(bun.FileDescriptor, fd) };
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
                .ignore => JSValue.jsUndefined(),
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
                .fd => |fd| {
                    _ = JSC.Node.Syscall.close(fd);
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
                .fd => |fd| {
                    _ = JSC.Node.Syscall.close(fd);
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
        if (this.exit_code) |code| {
            return JSC.JSPromise.resolvedPromiseValue(globalThis, JSC.JSValue.jsNumber(code));
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
                return JSC.JSValue.jsNumber(@enumToInt(signal));
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

        var env: [*:null]?[*:0]const u8 = undefined;

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
        var args = args_;
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
                    globalThis.throw("out of memory", .{});
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
                    var resolved = Which.which(&path_buf, PATH, cwd, arg0.slice()) orelse {
                        globalThis.throwInvalidArguments("Executable not found in $PATH: \"{s}\"", .{arg0.slice()});
                        return .zero;
                    };
                    argv.appendAssumeCapacity(allocator.dupeZ(u8, bun.span(resolved)) catch {
                        globalThis.throw("out of memory", .{});
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
                        globalThis.throw("out of memory", .{});
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
                            cwd = cwd_str.toOwnedSliceZ(allocator) catch {
                                globalThis.throw("out of memory", .{});
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
                        on_exit_callback = onExit_;
                    }
                }

                if (args.get(globalThis, "env")) |object| {
                    if (!object.isEmptyOrUndefinedOrNull()) {
                        if (!object.isObject()) {
                            globalThis.throwInvalidArguments("env must be an object", .{});
                            return .zero;
                        }

                        var object_iter = JSC.JSPropertyIterator(.{
                            .skip_empty_name = false,
                            .include_value = true,
                        }).init(globalThis, object.asObjectRef());
                        defer object_iter.deinit();
                        env_array.ensureTotalCapacityPrecise(allocator, object_iter.len) catch {
                            globalThis.throw("out of memory", .{});
                            return .zero;
                        };

                        while (object_iter.next()) |key| {
                            var value = object_iter.value;
                            var line = std.fmt.allocPrintZ(allocator, "{}={}", .{ key, value.getZigString(globalThis) }) catch {
                                globalThis.throw("out of memory", .{});
                                return .zero;
                            };

                            if (key.eqlComptime("PATH")) {
                                PATH = bun.asByteSlice(line["PATH=".len..]);
                            }

                            env_array.append(allocator, line) catch {
                                globalThis.throw("out of memory", .{});
                                return .zero;
                            };
                        }
                    }
                }

                if (args.get(globalThis, "stdio")) |stdio_val| {
                    if (!stdio_val.isEmptyOrUndefinedOrNull()) {
                        if (stdio_val.jsType().isArray()) {
                            var stdio_iter = stdio_val.arrayIterator(globalThis);
                            stdio_iter.len = @min(stdio_iter.len, 3);
                            var i: usize = 0;
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
                        if (!extractStdio(globalThis, std.os.STDIN_FILENO, value, &stdio))
                            return .zero;
                    }

                    if (args.get(globalThis, "stderr")) |value| {
                        if (!extractStdio(globalThis, std.os.STDERR_FILENO, value, &stdio))
                            return .zero;
                    }

                    if (args.get(globalThis, "stdout")) |value| {
                        if (!extractStdio(globalThis, std.os.STDOUT_FILENO, value, &stdio))
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
            }
        }

        var attr = PosixSpawn.Attr.init() catch {
            globalThis.throw("out of memory", .{});
            return .zero;
        };

        defer attr.deinit();
        var actions = PosixSpawn.Actions.init() catch |err| return globalThis.handleError(err, "in posix_spawn");
        if (comptime Environment.isMac) {
            attr.set(
                bun.C.POSIX_SPAWN_CLOEXEC_DEFAULT | bun.C.POSIX_SPAWN_SETSIGDEF | bun.C.POSIX_SPAWN_SETSIGMASK,
            ) catch |err| return globalThis.handleError(err, "in posix_spawn");
        } else if (comptime Environment.isLinux) {
            attr.set(
                bun.C.linux.POSIX_SPAWN.SETSIGDEF | bun.C.linux.POSIX_SPAWN.SETSIGMASK,
            ) catch |err| return globalThis.handleError(err, "in posix_spawn");
        }
        defer actions.deinit();

        if (env_array.items.len == 0) {
            env_array.items = jsc_vm.bundler.env.map.createNullDelimitedEnvMap(allocator) catch |err| return globalThis.handleError(err, "in posix_spawn");
            env_array.capacity = env_array.items.len;
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
            std.os.STDIN_FILENO,
        ) catch |err| return globalThis.handleError(err, "in configuring child stdin");

        stdio[1].setUpChildIoPosixSpawn(
            &actions,
            stdout_pipe,
            std.os.STDOUT_FILENO,
        ) catch |err| return globalThis.handleError(err, "in configuring child stdout");

        stdio[2].setUpChildIoPosixSpawn(
            &actions,
            stderr_pipe,
            std.os.STDERR_FILENO,
        ) catch |err| return globalThis.handleError(err, "in configuring child stderr");

        actions.chdir(cwd) catch |err| return globalThis.handleError(err, "in chdir()");

        argv.append(allocator, null) catch {
            globalThis.throw("out of memory", .{});
            return .zero;
        };

        if (env_array.items.len > 0) {
            env_array.append(allocator, null) catch {
                globalThis.throw("out of memory", .{});
                return .zero;
            };
            env = @ptrCast(@TypeOf(env), env_array.items.ptr);
        }

        const pid = brk: {
            defer {
                if (stdio[0].isPiped()) {
                    _ = JSC.Node.Syscall.close(stdin_pipe[0]);
                }

                if (stdio[1].isPiped()) {
                    _ = JSC.Node.Syscall.close(stdout_pipe[1]);
                }

                if (stdio[2].isPiped()) {
                    _ = JSC.Node.Syscall.close(stderr_pipe[1]);
                }
            }

            break :brk switch (PosixSpawn.spawnZ(argv.items[0].?, actions, attr, @ptrCast([*:null]?[*:0]const u8, argv.items[0..].ptr), env)) {
                .err => |err| return err.toJSC(globalThis),
                .result => |pid_| pid_,
            };
        };

        const pidfd: std.os.fd_t = brk: {
            if (Environment.isMac) {
                break :brk @intCast(std.os.fd_t, pid);
            }

            const kernel = @import("../../../analytics.zig").GenerateHeader.GeneratePlatform.kernelVersion();

            // pidfd_nonblock only supported in 5.10+
            const flags: u32 = if (!is_sync and kernel.orderWithoutTag(.{ .major = 5, .minor = 10, .patch = 0 }).compare(.gte))
                std.os.O.NONBLOCK
            else
                0;

            const fd = std.os.linux.pidfd_open(
                pid,
                flags,
            );

            switch (std.os.linux.getErrno(fd)) {
                .SUCCESS => break :brk @intCast(std.os.fd_t, fd),
                else => |err| {
                    globalThis.throwValue(JSC.Node.Syscall.Error.fromCode(err, .open).toJSC(globalThis));
                    var status: u32 = 0;
                    // ensure we don't leak the child process on error
                    _ = std.os.linux.waitpid(pid, &status, 0);
                    return .zero;
                },
            }
        };

        var subprocess = globalThis.allocator().create(Subprocess) catch {
            globalThis.throw("out of memory", .{});
            return .zero;
        };

        // When run synchronously, subprocess isn't garbage collected
        subprocess.* = Subprocess{
            .globalThis = globalThis,
            .pid = pid,
            .pidfd = pidfd,
            .stdin = Writable.init(stdio[std.os.STDIN_FILENO], stdin_pipe[1], globalThis) catch {
                globalThis.throw("out of memory", .{});
                return .zero;
            },
            // stdout and stderr only uses allocator and default_max_buffer_size if they are pipes and not a array buffer
            .stdout = Readable.init(stdio[std.os.STDOUT_FILENO], stdout_pipe[0], jsc_vm.allocator, default_max_buffer_size),
            .stderr = Readable.init(stdio[std.os.STDERR_FILENO], stderr_pipe[0], jsc_vm.allocator, default_max_buffer_size),
            .on_exit_callback = if (on_exit_callback != .zero) JSC.Strong.create(on_exit_callback, globalThis) else .{},
            .is_sync = is_sync,
        };

        if (subprocess.stdin == .pipe) {
            subprocess.stdin.pipe.signal = JSC.WebCore.Signal.init(&subprocess.stdin);
        }

        const out = if (comptime !is_sync)
            subprocess.toJS(globalThis)
        else
            JSValue.zero;
        subprocess.this_jsvalue = out;

        if (comptime !is_sync) {
            var poll = JSC.FilePoll.init(jsc_vm, pidfd, .{}, Subprocess, subprocess);
            subprocess.poll_ref = poll;
            switch (subprocess.poll_ref.?.register(
                jsc_vm.uws_event_loop.?,
                .process,
                true,
            )) {
                .result => {},
                .err => |err| {
                    if (err.getErrno() != .SRCH) {
                        @panic("This shouldn't happen");
                    }

                    // process has already exited
                    // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                    subprocess.onExitNotification();
                },
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
            if (comptime is_sync) {
                subprocess.stdout.pipe.buffer.readAll();
            } else if (!lazy) {
                subprocess.stdout.pipe.buffer.readAll();
            }
        }

        if (subprocess.stderr == .pipe and subprocess.stderr.pipe == .buffer) {
            if (comptime is_sync) {
                subprocess.stderr.pipe.buffer.readAll();
            } else if (!lazy) {
                subprocess.stderr.pipe.buffer.readAll();
            }
        }

        if (comptime !is_sync) {
            return out;
        }

        if (subprocess.stdin == .buffered_input) {
            while (subprocess.stdin.buffered_input.remain.len > 0) {
                subprocess.stdin.buffered_input.writeIfPossible(true);
            }
        }
        subprocess.closeIO(.stdin);

        {
            var poll = JSC.FilePoll.init(jsc_vm, pidfd, .{}, Subprocess, subprocess);
            subprocess.poll_ref = poll;
            switch (subprocess.poll_ref.?.register(
                jsc_vm.uws_event_loop.?,
                .process,
                true,
            )) {
                .result => {},
                .err => |err| {
                    if (err.getErrno() != .SRCH) {
                        @panic("This shouldn't happen");
                    }

                    // process has already exited
                    // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                    subprocess.onExitNotification();
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

        const exitCode = subprocess.exit_code orelse 1;
        const stdout = subprocess.stdout.toBufferedValue(globalThis);
        const stderr = subprocess.stderr.toBufferedValue(globalThis);
        subprocess.finalizeSync();

        const sync_value = JSC.JSValue.createEmptyObject(globalThis, 4);
        sync_value.put(globalThis, JSC.ZigString.static("exitCode"), JSValue.jsNumber(@intCast(i32, exitCode)));
        sync_value.put(globalThis, JSC.ZigString.static("stdout"), stdout);
        sync_value.put(globalThis, JSC.ZigString.static("stderr"), stderr);
        sync_value.put(globalThis, JSC.ZigString.static("success"), JSValue.jsBoolean(exitCode == 0));
        return sync_value;
    }

    pub fn onExitNotification(
        this: *Subprocess,
    ) void {
        this.wait(this.is_sync);
    }

    pub fn wait(this: *Subprocess, sync: bool) void {
        return this.waitWithJSValue(sync, this.this_jsvalue);
    }

    pub fn watch(this: *Subprocess) void {
        if (this.poll_ref) |poll| {
            _ = poll.register(
                this.globalThis.bunVM().uws_event_loop.?,
                .process,
                true,
            );
        } else {
            @panic("Internal Bun error: poll_ref in Subprocess is null unexpectedly. Please file a bug report.");
        }
    }

    pub fn waitWithJSValue(
        this: *Subprocess,
        sync: bool,
        this_jsvalue: JSC.JSValue,
    ) void {
        if (this.has_waitpid_task) {
            return;
        }
        defer if (sync) this.updateHasPendingActivityFlag();
        this.has_waitpid_task = true;
        const pid = this.pid;

        switch (PosixSpawn.waitpid(pid, if (sync) 0 else std.os.W.NOHANG)) {
            .err => |err| {
                this.waitpid_err = err;
            },
            .result => |result| {
                if (std.os.W.IFEXITED(result.status)) {
                    this.exit_code = @truncate(u8, std.os.W.EXITSTATUS(result.status));
                }

                if (std.os.W.IFSIGNALED(result.status)) {
                    this.signal_code = @intToEnum(SignalCode, @truncate(u8, std.os.W.TERMSIG(result.status)));
                } else if (std.os.W.IFSTOPPED(result.status)) {
                    this.signal_code = @intToEnum(SignalCode, @truncate(u8, std.os.W.STOPSIG(result.status)));
                }

                if (!this.hasExited()) {
                    this.watch();
                }
            },
        }
        this.has_waitpid_task = false;

        if (!sync and this.hasExited()) {
            var vm = this.globalThis.bunVM();

            // prevent duplicate notifications
            if (this.poll_ref) |poll| {
                this.poll_ref = null;
                poll.deinitWithVM(vm);
            }

            this.onExit(this.globalThis, this_jsvalue);
        }
    }

    fn onExit(
        this: *Subprocess,
        globalThis: *JSC.JSGlobalObject,
        this_jsvalue: JSC.JSValue,
    ) void {
        defer this.updateHasPendingActivity();
        this_jsvalue.ensureStillAlive();
        this.has_waitpid_task = false;

        if (this.hasExited()) {
            if (this.exit_promise.trySwap()) |promise| {
                if (this.exit_code) |code| {
                    promise.asAnyPromise().?.resolve(globalThis, JSValue.jsNumber(code));
                } else if (this.signal_code != null) {
                    promise.asAnyPromise().?.resolve(globalThis, this.getSignalCode(globalThis));
                } else if (this.waitpid_err) |err| {
                    this.waitpid_err = null;
                    promise.asAnyPromise().?.reject(globalThis, err.toJSC(globalThis));
                } else {
                    // crash in debug mode
                    if (comptime Environment.allow_assert)
                        unreachable;
                }
            }
        }

        if (this.on_exit_callback.trySwap()) |callback| {
            const waitpid_value: JSValue =
                if (this.waitpid_err) |err|
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

        if (this.hasExited())
            this.unref();
    }

    const os = std.os;
    fn destroyPipe(pipe: [2]os.fd_t) void {
        os.close(pipe[0]);
        if (pipe[0] != pipe[1]) os.close(pipe[1]);
    }

    const PosixSpawn = @import("./spawn.zig").PosixSpawn;

    const Stdio = union(enum) {
        inherit: void,
        ignore: void,
        fd: bun.FileDescriptor,
        path: JSC.Node.PathLike,
        blob: JSC.WebCore.AnyBlob,
        pipe: ?JSC.WebCore.ReadableStream,
        array_buffer: JSC.ArrayBuffer.Strong,

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
                .path => |pathlike| {
                    const flag = if (std_fileno == std.os.STDIN_FILENO) @as(u32, os.O.RDONLY) else @as(u32, std.os.O.WRONLY);
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
                    const flag = if (std_fileno == std.os.STDIN_FILENO) @as(u32, os.O.RDONLY) else @as(u32, std.os.O.WRONLY);
                    try actions.openZ(std_fileno, "/dev/null", flag, 0o664);
                },
            }
        }
    };

    fn extractStdioBlob(
        globalThis: *JSC.JSGlobalObject,
        blob: JSC.WebCore.AnyBlob,
        i: usize,
        stdio_array: []Stdio,
    ) bool {
        if (blob.needsToReadFile()) {
            if (blob.store()) |store| {
                if (store.data.file.pathlike == .fd) {
                    if (store.data.file.pathlike.fd == @intCast(bun.FileDescriptor, i)) {
                        stdio_array[i] = Stdio{ .inherit = {} };
                    } else {
                        switch (@intCast(std.os.fd_t, i)) {
                            std.os.STDIN_FILENO => {
                                if (i == std.os.STDERR_FILENO or i == std.os.STDOUT_FILENO) {
                                    globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                                    return false;
                                }
                            },

                            std.os.STDOUT_FILENO, std.os.STDERR_FILENO => {
                                if (i == std.os.STDIN_FILENO) {
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
        i: usize,
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

            const fd = @intCast(bun.FileDescriptor, fd_);

            switch (@intCast(std.os.fd_t, i)) {
                std.os.STDIN_FILENO => {
                    if (i == std.os.STDERR_FILENO or i == std.os.STDOUT_FILENO) {
                        globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                        return false;
                    }
                },

                std.os.STDOUT_FILENO, std.os.STDERR_FILENO => {
                    if (i == std.os.STDIN_FILENO) {
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
            if (i == std.os.STDIN_FILENO) {
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
};
