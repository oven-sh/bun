const IPC = @import("../bun.js/ipc.zig");
const Allocator = std.mem.Allocator;
const uws = bun.uws;
const std = @import("std");
const default_allocator = @import("root").bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;
const Async = bun.Async;
const JSC = @import("root").bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Which = @import("../which.zig");
const Output = @import("root").bun.Output;
const PosixSpawn = @import("../bun.js/api/bun/spawn.zig").PosixSpawn;
const os = std.os;
fn destroyPipe(pipe: [2]os.fd_t) void {
    os.close(pipe[0]);
    if (pipe[0] != pipe[1]) os.close(pipe[1]);
}

const log = Output.scoped(.Subprocess, false);

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
    ref_count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    poll_ref: Async.KeepAlive = .{},
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
    /// Sometimes the `internal_buffer` may be filled with memory from JSC,
    /// for example an array buffer. In that case we shouldn't dealloc
    /// memory and let the GC do it.
    from_jsc: bool = false,
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

    pub fn initWithArrayBuffer(fd: bun.FileDescriptor, slice: []u8) BufferedOutput {
        var out = BufferedOutput.initWithSlice(fd, slice);
        out.from_jsc = true;
        return out;
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
        log("BufferedOutput close", .{});
        switch (this.status) {
            .done => {},
            .pending => {
                this.fifo.close();
                this.status = .{ .done = {} };
            },
            .err => {},
        }

        if (this.internal_buffer.cap > 0 and !this.from_jsc) {
            this.internal_buffer.listManaged(bun.default_allocator).deinit();
            this.internal_buffer = .{};
        }
    }
};

pub const Writable = union(enum) {
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
                        buffered_input.source = .{ .array_buffer = array_buffer.buf };
                    },
                    .blob => |blob| {
                        buffered_input.source = .{ .blob = blob };
                    },
                    else => unreachable,
                }
                return Writable{ .buffered_input = buffered_input };
            },
            .fd => {
                return Writable{ .fd = @as(bun.FileDescriptor, @intCast(fd)) };
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
            .fd => |fd| {
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

pub const Readable = union(enum) {
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
            .blob, .fd => Readable{ .fd = @as(bun.FileDescriptor, @intCast(fd)) },
            .array_buffer => Readable{
                .pipe = .{
                    .buffer = if (stdio.array_buffer.from_jsc) BufferedOutput.initWithArrayBuffer(fd, stdio.array_buffer.buf.slice()) else BufferedOutput.initWithSlice(fd, stdio.array_buffer.buf.slice()),
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
        log("READABLE close", .{});
        switch (this.*) {
            .fd => |fd| {
                _ = bun.sys.close(fd);
            },
            .pipe => {
                this.pipe.done();
            },
            else => {},
        }
    }

    pub fn finalize(this: *Readable) void {
        log("Readable::finalize", .{});
        switch (this.*) {
            .fd => |fd| {
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

    pub fn toSlice(this: *Readable) ?[]const u8 {
        switch (this.*) {
            .fd => return null,
            .pipe => {
                this.pipe.buffer.fifo.close_on_empty_read = true;
                this.pipe.buffer.readAll();

                var bytes = this.pipe.buffer.internal_buffer.slice();
                // this.pipe.buffer.internal_buffer = .{};

                if (bytes.len > 0) {
                    return bytes;
                }

                return "";
            },
            else => {
                return null;
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

pub const Stdio = union(enum) {
    inherit: void,
    ignore: void,
    fd: bun.FileDescriptor,
    path: JSC.Node.PathLike,
    blob: JSC.WebCore.AnyBlob,
    pipe: ?JSC.WebCore.ReadableStream,
    array_buffer: struct { buf: JSC.ArrayBuffer.Strong, from_jsc: bool = false },

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
};

pub fn extractStdioBlob(
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

pub fn extractStdio(
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
            .array_buffer = .{ .buf = JSC.ArrayBuffer.Strong{
                .array_buffer = array_buffer,
                .held = JSC.Strong.create(array_buffer.value, globalThis),
            } },
        };

        return true;
    }

    globalThis.throwInvalidArguments("stdio must be an array of 'inherit', 'ignore', or null", .{});
    return false;
}

pub const WatchFd = if (Environment.isLinux) std.os.fd_t else i32;

pub fn spawnMaybeSyncImpl(
    comptime config: struct {
        SpawnArgs: type,
        Subprocess: type,
        WaiterThread: type,
        is_sync: bool,
        is_js: bool,
    },
    globalThis: *JSC.JSGlobalObject,
    allocator: Allocator,
    out_watchfd: *?WatchFd,
    out_err: *?JSValue,
    spawn_args: *config.SpawnArgs,
) ?*config.Subprocess {
    const Subprocess = config.Subprocess;
    const WaiterThread = config.WaiterThread;
    const is_sync = config.is_sync;
    const is_js = config.is_js;

    var env: [*:null]?[*:0]const u8 = undefined;
    var jsc_vm = globalThis.bunVM();
    out_err.* = null;

    var attr = PosixSpawn.Attr.init() catch {
        globalThis.throw("out of memory", .{});
        return null;
    };

    var flags: i32 = bun.C.POSIX_SPAWN_SETSIGDEF | bun.C.POSIX_SPAWN_SETSIGMASK;

    if (comptime Environment.isMac) {
        flags |= bun.C.POSIX_SPAWN_CLOEXEC_DEFAULT;
    }

    if (spawn_args.detached) {
        flags |= bun.C.POSIX_SPAWN_SETSID;
    }

    defer attr.deinit();
    var actions = PosixSpawn.Actions.init() catch |err| {
        out_err.* = globalThis.handleError(err, "in posix_spawn");
        return null;
    };
    if (comptime Environment.isMac) {
        attr.set(@intCast(flags)) catch |err| {
            out_err.* = globalThis.handleError(err, "in posix_spawn");
            return null;
        };
    } else if (comptime Environment.isLinux) {
        attr.set(@intCast(flags)) catch |err| {
            out_err.* = globalThis.handleError(err, "in posix_spawn");
            return null;
        };
    }

    attr.resetSignals() catch {
        globalThis.throw("Failed to reset signals in posix_spawn", .{});
        return null;
    };

    defer actions.deinit();

    if (!spawn_args.override_env and spawn_args.env_array.items.len == 0) {
        spawn_args.env_array.items = jsc_vm.bundler.env.map.createNullDelimitedEnvMap(allocator) catch |err| {
            out_err.* = globalThis.handleError(err, "in posix_spawn");
            return null;
        };
        spawn_args.env_array.capacity = spawn_args.env_array.items.len;
    }

    const stdin_pipe = if (spawn_args.stdio[0].isPiped()) os.pipe2(0) catch |err| {
        globalThis.throw("failed to create stdin pipe: {s}", .{@errorName(err)});
        return null;
    } else undefined;

    const stdout_pipe = if (spawn_args.stdio[1].isPiped()) os.pipe2(0) catch |err| {
        globalThis.throw("failed to create stdout pipe: {s}", .{@errorName(err)});
        return null;
    } else undefined;

    const stderr_pipe = if (spawn_args.stdio[2].isPiped()) os.pipe2(0) catch |err| {
        globalThis.throw("failed to create stderr pipe: {s}", .{@errorName(err)});
        return null;
    } else undefined;

    spawn_args.stdio[0].setUpChildIoPosixSpawn(
        &actions,
        stdin_pipe,
        bun.STDIN_FD,
    ) catch |err| {
        out_err.* = globalThis.handleError(err, "in configuring child stdin");
        return null;
    };

    spawn_args.stdio[1].setUpChildIoPosixSpawn(
        &actions,
        stdout_pipe,
        bun.STDOUT_FD,
    ) catch |err| {
        out_err.* = globalThis.handleError(err, "in configuring child stdout");
        return null;
    };

    spawn_args.stdio[2].setUpChildIoPosixSpawn(
        &actions,
        stderr_pipe,
        bun.STDERR_FD,
    ) catch |err| {
        out_err.* = globalThis.handleError(err, "in configuring child stderr");
        return null;
    };

    actions.chdir(spawn_args.cwd) catch |err| {
        out_err.* = globalThis.handleError(err, "in chdir()");
        return null;
    };

    spawn_args.argv.append(allocator, null) catch {
        globalThis.throw("out of memory", .{});
        return null;
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
    // When Bun.spawn() is given a `.onMessage` callback, it enables IPC as follows:
    var socket: if (is_js) IPC.Socket else u0 = undefined;
    if (comptime is_js) {
        if (spawn_args.ipc_mode != .none) {
            if (comptime is_sync) {
                globalThis.throwInvalidArguments("IPC is not supported in Bun.spawnSync", .{});
                return null;
            }

            spawn_args.env_array.ensureUnusedCapacity(allocator, 2) catch |err| {
                out_err.* = globalThis.handleError(err, "in posix_spawn");
                return null;
            };
            spawn_args.env_array.appendAssumeCapacity("BUN_INTERNAL_IPC_FD=3");

            var fds: [2]uws.LIBUS_SOCKET_DESCRIPTOR = undefined;
            socket = uws.newSocketFromPair(
                jsc_vm.rareData().spawnIPCContext(jsc_vm),
                @sizeOf(*Subprocess),
                &fds,
            ) orelse {
                globalThis.throw("failed to create socket pair: E{s}", .{
                    @tagName(bun.sys.getErrno(-1)),
                });
                return null;
            };
            actions.dup2(fds[1], 3) catch |err| {
                out_err.* = globalThis.handleError(err, "in posix_spawn");
                return null;
            };
        }
    }

    spawn_args.env_array.append(allocator, null) catch {
        globalThis.throw("out of memory", .{});
        return null;
    };
    env = @as(@TypeOf(env), @ptrCast(spawn_args.env_array.items.ptr));

    const pid = brk: {
        defer {
            if (spawn_args.stdio[0].isPiped()) {
                _ = bun.sys.close(stdin_pipe[0]);
            }

            if (spawn_args.stdio[1].isPiped()) {
                _ = bun.sys.close(stdout_pipe[1]);
            }

            if (spawn_args.stdio[2].isPiped()) {
                _ = bun.sys.close(stderr_pipe[1]);
            }
        }

        break :brk switch (PosixSpawn.spawnZ(spawn_args.argv.items[0].?, actions, attr, @as([*:null]?[*:0]const u8, @ptrCast(spawn_args.argv.items[0..].ptr)), env)) {
            .err => |err| {
                var str = err.toJSC(globalThis).getZigString(globalThis);
                std.debug.print("THE ERROR!: {s}\n", .{str});
                globalThis.throwValue(err.toJSC(globalThis));
                return null;
            },
            .result => |pid_| pid_,
        };
    };

    const pidfd: std.os.fd_t = brk: {
        if (!Environment.isLinux or WaiterThread.shouldUseWaiterThread()) {
            break :brk pid;
        }

        const kernel = @import("../analytics.zig").GenerateHeader.GeneratePlatform.kernelVersion();

        // pidfd_nonblock only supported in 5.10+
        var pidfd_flags: u32 = if (!is_sync and kernel.orderWithoutTag(.{ .major = 5, .minor = 10, .patch = 0 }).compare(.gte))
            std.os.O.NONBLOCK
        else
            0;

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
                    return null;
                },
            }
        }
    };

    var subprocess = globalThis.allocator().create(Subprocess) catch {
        globalThis.throw("out of memory", .{});
        return null;
    };
    // When run synchronously, subprocess isn't garbage collected
    if (comptime is_js) {
        subprocess.* = Subprocess{
            .globalThis = globalThis,
            .pid = pid,
            .pidfd = if (WaiterThread.shouldUseWaiterThread()) @truncate(bun.invalid_fd) else @truncate(pidfd),
            .stdin = Writable.init(spawn_args.stdio[bun.STDIN_FD], stdin_pipe[1], globalThis) catch {
                globalThis.throw("out of memory", .{});
                return null;
            },
            // stdout and stderr only uses allocator and default_max_buffer_size if they are pipes and not a array buffer
            .stdout = Readable.init(spawn_args.stdio[bun.STDOUT_FD], stdout_pipe[0], jsc_vm.allocator, Subprocess.default_max_buffer_size),
            .stderr = Readable.init(spawn_args.stdio[bun.STDERR_FD], stderr_pipe[0], jsc_vm.allocator, Subprocess.default_max_buffer_size),
            .flags = .{
                .is_sync = is_sync,
            },
            .on_exit_callback = if (spawn_args.on_exit_callback != .zero) JSC.Strong.create(spawn_args.on_exit_callback, globalThis) else .{},
            .ipc_mode = spawn_args.ipc_mode,
            // will be assigned in the block below
            .ipc = .{ .socket = socket },
            .ipc_callback = if (spawn_args.ipc_callback != .zero) JSC.Strong.create(spawn_args.ipc_callback, globalThis) else undefined,
        };

        if (spawn_args.ipc_mode != .none) {
            var ptr = socket.ext(*Subprocess);
            ptr.?.* = subprocess;
            subprocess.ipc.writeVersionPacket();
        }
    } else {
        subprocess.* = Subprocess{
            .globalThis = globalThis,
            .pid = pid,
            .pidfd = if (WaiterThread.shouldUseWaiterThread()) @truncate(bun.invalid_fd) else @truncate(pidfd),
            .stdin = Writable.init(spawn_args.stdio[bun.STDIN_FD], stdin_pipe[1], globalThis) catch {
                globalThis.throw("out of memory", .{});
                return null;
            },
            // stdout and stderr only uses allocator and default_max_buffer_size if they are pipes and not a array buffer
            .stdout = Readable.init(spawn_args.stdio[bun.STDOUT_FD], stdout_pipe[0], jsc_vm.allocator, Subprocess.default_max_buffer_size),
            .stderr = Readable.init(spawn_args.stdio[bun.STDERR_FD], stderr_pipe[0], jsc_vm.allocator, Subprocess.default_max_buffer_size),
            .flags = .{
                .is_sync = is_sync,
            },
            .cmd_parent = spawn_args.cmd_parent,
        };
    }

    if (subprocess.stdin == .pipe) {
        subprocess.stdin.pipe.signal = JSC.WebCore.Signal.init(&subprocess.stdin);
    }

    if (comptime is_js) {
        const out = if (comptime !is_sync)
            subprocess.toJS(globalThis)
        else
            JSValue.zero;
        subprocess.this_jsvalue = out;
    }

    var send_exit_notification = false;
    const watchfd = if (comptime Environment.isLinux) brk: {
        break :brk pidfd;
    } else brk: {
        break :brk pid;
    };
    out_watchfd.* = watchfd;

    if (comptime !is_sync) {
        if (!WaiterThread.shouldUseWaiterThread()) {
            var poll = Async.FilePoll.init(jsc_vm, watchfd, .{}, Subprocess, subprocess);
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
                    spawn_args.lazy = false;
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
        if (comptime is_sync) {
            subprocess.stdout.pipe.buffer.readAll();
        } else if (!spawn_args.lazy) {
            subprocess.stdout.pipe.buffer.readAll();
        }
    }

    if (subprocess.stderr == .pipe and subprocess.stderr.pipe == .buffer) {
        if (comptime is_sync) {
            subprocess.stderr.pipe.buffer.readAll();
        } else if (!spawn_args.lazy) {
            subprocess.stderr.pipe.buffer.readAll();
        }
    }

    return subprocess;
}

// Machines which do not support pidfd_open (GVisor, Linux Kernel < 5.6)
// use a thread to wait for the child process to exit.
// We use a single thread to call waitpid() in a loop.
pub fn NewWaiterThread(comptime Subprocess: type, comptime is_js: bool) type {
    return struct {
        const WaiterThread = @This();
        concurrent_queue: Queue = .{},
        queue: std.ArrayList(*Subprocess) = std.ArrayList(*Subprocess).init(bun.default_allocator),
        started: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
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

        var should_use_waiter_thread = false;

        pub const Queue = bun.UnboundedQueue(WaitTask, .next);
        pub var instance: WaiterThread = .{};
        pub fn init() !void {
            std.debug.assert(should_use_waiter_thread);

            if (instance.started.fetchMax(1, .Monotonic) > 0) {
                return;
            }

            var thread = try std.Thread.spawn(.{ .stack_size = 512 * 1024 }, loop, .{});
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
                var result = self.result;
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
                        .ref_count = std.atomic.Atomic(u32).init(1),
                    },
                };
                process.poll.wait_thread.poll_ref.activate(process.globalThis.bunVM().event_loop_handle.?);
            }

            var task = bun.default_allocator.create(WaitTask) catch unreachable;
            task.* = WaitTask{
                .subprocess = process,
            };
            instance.concurrent_queue.push(task);
            if (comptime is_js) {
                process.updateHasPendingActivity();
            }

            init() catch @panic("Failed to start WaiterThread");

            if (comptime Environment.isLinux) {
                const one = @as([8]u8, @bitCast(@as(usize, 1)));
                _ = std.os.write(instance.eventfd, &one) catch @panic("Failed to write to eventfd");
            }
        }

        pub fn loop() void {
            Output.Source.configureNamedThread("Waitpid");

            var this = &instance;

            while (true) {
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

                        var task = bun.default_allocator.create(WaitPidResultTask) catch unreachable;
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
                    var rc = std.c.sigwait(&mask, &signal);
                    _ = rc;
                }
            }
        }
    };
}
