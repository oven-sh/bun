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

pub const OutKind = enum { stdout, stderr };

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
    ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
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

    /// This is called after it is read (it's confusing because "on read" could
    /// be interpreted as present or past tense)
    pub fn onRead(this: *BufferedOutput, result: JSC.WebCore.StreamResult) void {
        log("onRead", .{});
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
            log("readAll START status: {s}", .{@tagName(this.status)});
            while (this.internal_buffer.len < this.internal_buffer.cap and this.status == .pending) {
                const buf_to_use = this.internal_buffer.available();

                const result = this.fifo.read(buf_to_use, this.fifo.to_read);

                log("readAll result {s}", .{@tagName(result)});

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
                            log("readAll less than avail space calling watch now", .{});
                            this.watch();
                            return;
                        }
                        log("readAll looping back", .{});
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

    pub fn setUpChildIoPosixSpawn(
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
