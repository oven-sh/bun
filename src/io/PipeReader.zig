const bun = @import("root").bun;
const std = @import("std");

/// Read a blocking pipe without blocking the current thread.
pub fn PosixPipeReader(
    comptime This: type,
    comptime vtable: struct {
        getFd: *const fn (*This) bun.FileDescriptor,
        getBuffer: *const fn (*This) *std.ArrayList(u8),
        onReadChunk: ?*const fn (*This, chunk: []u8) void = null,
        registerPoll: ?*const fn (*This) void = null,
        done: *const fn (*This) void,
        onError: *const fn (*This, bun.sys.Error) void,
    },
) type {
    return struct {
        pub fn read(this: *This) void {
            const buffer = vtable.getBuffer(this);

            const fd = vtable.getFd(this);
            if (comptime bun.Environment.isLinux) {
                if (bun.C.linux.RWFFlagSupport.isMaybeSupported()) {
                    readFromBlockingPipeWithoutBlockingLinux(this, buffer, fd, 0);
                    return;
                }
            }

            switch (bun.isReadable(fd)) {
                .ready, .hup => {
                    readFromBlockingPipeWithoutBlocking(this, buffer, fd, 0);
                },
                .not_ready => {
                    if (comptime vtable.registerPoll) |register| {
                        register(this);
                    }
                },
            }
        }

        pub fn onPoll(parent: *This, size_hint: isize) void {
            const resizable_buffer = vtable.getBuffer(parent);
            const fd = vtable.getFd(parent);

            readFromBlockingPipeWithoutBlocking(parent, resizable_buffer, fd, size_hint);
        }

        const stack_buffer_len = 64 * 1024;

        inline fn drainChunk(parent: *This, resizable_buffer: *std.ArrayList(u8), start_length: usize) void {
            if (parent.vtable.isStreamingEnabled()) {
                if (resizable_buffer.items[start_length..].len > 0) {
                    const chunk = resizable_buffer.items[start_length..];
                    parent.vtable.onReadChunk(chunk);
                }
            }
        }

        // On Linux, we use preadv2 to read without blocking.
        fn readFromBlockingPipeWithoutBlockingLinux(parent: *This, resizable_buffer: *std.ArrayList(u8), fd: bun.FileDescriptor, size_hint: isize) void {
            if (size_hint > stack_buffer_len) {
                resizable_buffer.ensureUnusedCapacity(@intCast(size_hint)) catch bun.outOfMemory();
            }

            const start_length: usize = resizable_buffer.items.len;
            const streaming = parent.vtable.isStreamingEnabled();

            while (true) {
                var buffer: []u8 = resizable_buffer.unusedCapacitySlice();
                var stack_buffer: [stack_buffer_len]u8 = undefined;

                if (buffer.len < stack_buffer_len) {
                    buffer = &stack_buffer;
                }

                switch (bun.sys.readNonblocking(fd, buffer)) {
                    .result => |bytes_read| {
                        buffer = buffer[0..bytes_read];
                        if (bytes_read == 0) {
                            drainChunk(parent, resizable_buffer, start_length);
                            close(parent);
                            return;
                        }

                        if (buffer.ptr != &stack_buffer) {
                            resizable_buffer.items.len += bytes_read;
                        } else if (resizable_buffer.items.len > 0 or !streaming) {
                            resizable_buffer.appendSlice(buffer[0..bytes_read]) catch bun.outOfMemory();
                            buffer = resizable_buffer.items;
                        }

                        if (streaming) {
                            parent.vtable.onReadChunk(buffer);
                        }
                    },
                    .err => |err| {
                        if (err.isRetry()) {
                            drainChunk(parent, resizable_buffer, start_length);

                            if (comptime vtable.registerPoll) |register| {
                                register(parent);
                                return;
                            }
                        }
                        vtable.onError(parent, err);
                        return;
                    },
                }
            }
        }

        fn readFromBlockingPipeWithoutBlocking(parent: *This, resizable_buffer: *std.ArrayList(u8), fd: bun.FileDescriptor, size_hint: isize) void {
            if (comptime bun.Environment.isLinux) {
                if (bun.C.linux.RWFFlagSupport.isMaybeSupported()) {
                    readFromBlockingPipeWithoutBlockingLinux(parent, resizable_buffer, fd, size_hint);
                    return;
                }
            }

            readFromBlockingPipeWithoutBlockingPOSIX(parent, resizable_buffer, fd, size_hint);
        }

        fn readFromBlockingPipeWithoutBlockingPOSIX(parent: *This, resizable_buffer: *std.ArrayList(u8), fd: bun.FileDescriptor, size_hint: isize) void {
            if (size_hint > stack_buffer_len) {
                resizable_buffer.ensureUnusedCapacity(@intCast(size_hint)) catch bun.outOfMemory();
            }

            const start_length: usize = resizable_buffer.items.len;
            const streaming = parent.vtable.isStreamingEnabled();

            while (true) {
                var buffer: []u8 = resizable_buffer.unusedCapacitySlice();
                var stack_buffer: [stack_buffer_len]u8 = undefined;

                if (buffer.len < stack_buffer_len) {
                    buffer = &stack_buffer;
                }

                switch (bun.sys.readNonblocking(fd, buffer)) {
                    .result => |bytes_read| {
                        buffer = buffer[0..bytes_read];

                        if (bytes_read == 0) {
                            drainChunk(parent, resizable_buffer, start_length);
                            close(parent);
                            return;
                        }

                        if (buffer.ptr != &stack_buffer) {
                            resizable_buffer.items.len += bytes_read;
                        } else if (resizable_buffer.items.len > 0 or !streaming) {
                            resizable_buffer.appendSlice(buffer[0..bytes_read]) catch bun.outOfMemory();
                            buffer = resizable_buffer.items;
                        }

                        if (streaming) {
                            parent.vtable.onReadChunk(buffer);
                        }

                        switch (bun.isReadable(fd)) {
                            .ready, .hup => continue,
                            .not_ready => {
                                drainChunk(parent, resizable_buffer, start_length);

                                if (comptime vtable.registerPoll) |register| {
                                    register(parent);
                                }
                                return;
                            },
                        }
                    },
                    .err => |err| {
                        if (err.isRetry()) {
                            drainChunk(parent, resizable_buffer, start_length);

                            if (comptime vtable.registerPoll) |register| {
                                register(parent);
                                return;
                            }
                        }
                        vtable.onError(parent, err);
                        return;
                    },
                }
            }
        }

        pub fn close(this: *This) void {
            vtable.done(this);
        }
    };
}

const PollOrFd = @import("./pipes.zig").PollOrFd;

const uv = bun.windows.libuv;
pub fn WindowsPipeReader(
    comptime This: type,
    comptime _: anytype,
    comptime getBuffer: fn (*This) *std.ArrayList(u8),
    comptime onReadChunk: fn (*This, chunk: []u8) void,
    comptime registerPoll: ?fn (*This) void,
    comptime done: fn (*This) void,
    comptime onError: fn (*This, bun.sys.Error) void,
) type {
    return struct {
        pub usingnamespace uv.StreamReaderMixin(This, .pipe);

        const vtable = .{
            .getBuffer = getBuffer,
            .registerPoll = registerPoll,
            .done = done,
            .onError = onError,
        };

        fn _pipe(this: *This) *uv.Pipe {
            return &this.pipe;
        }

        pub fn open(this: *This, loop: *uv.Loop, fd: bun.FileDescriptor, ipc: bool) bun.JSC.Maybe(void) {
            switch (_pipe(this).init(loop, ipc)) {
                .err => |err| {
                    return .{ .err = err };
                },
                else => {},
            }

            switch (_pipe(this).open(bun.uvfdcast(fd))) {
                .err => |err| {
                    return .{ .err = err };
                },
                else => {},
            }

            return .{ .result = {} };
        }

        fn onClosePipe(pipe: *uv.Pipe) callconv(.C) void {
            const this = @fieldParentPtr(This, "pipe", pipe);
            done(this);
        }

        pub fn onRead(this: *This, amount: bun.JSC.Maybe(usize), buf: *const uv.uv_buf_t) void {
            if (amount == .err) {
                onError(this, amount.err);
                return;
            }

            if (amount.result == 0) {
                close(this);
                return;
            }

            var buffer = getBuffer(this);

            if (comptime bun.Environment.allow_assert) {
                if (!bun.isSliceInBuffer(buf.slice()[0..amount.result], buffer.allocatedSlice())) {
                    @panic("uv_read_cb: buf is not in buffer! This is a bug in bun. Please report it.");
                }
            }

            buffer.items.len += amount.result;

            onReadChunk(this, buf.slice()[0..amount.result]);
        }

        pub fn pause(this: *@This()) void {
            if (this._pipe().isActive()) {
                this.stopReading().unwrap() catch unreachable;
            }
        }

        pub fn unpause(this: *@This()) void {
            if (!this._pipe().isActive()) {
                this.startReading().unwrap() catch {};
            }
        }

        pub fn close(this: *This) void {
            this.stopReading().unwrap() catch unreachable;
            _pipe(this).close(&onClosePipe);
        }
    };
}

pub const PipeReader = if (bun.Environment.isWindows) WindowsPipeReader else PosixPipeReader;
const Async = bun.Async;

// This is a runtime type instead of comptime due to bugs in Zig.
// https://github.com/ziglang/zig/issues/18664
const BufferedReaderVTable = struct {
    parent: *anyopaque = undefined,
    fns: *const Fn = undefined,

    pub fn init(comptime Type: type) BufferedReaderVTable {
        return .{
            .fns = Fn.init(Type),
        };
    }

    pub const Fn = struct {
        onReadChunk: ?*const fn (*anyopaque, chunk: []const u8) void = null,
        onReaderDone: *const fn (*anyopaque) void,
        onReaderError: *const fn (*anyopaque, bun.sys.Error) void,
        loop: *const fn (*anyopaque) *Async.Loop,
        eventLoop: *const fn (*anyopaque) JSC.EventLoopHandle,

        pub fn init(comptime Type: type) *const BufferedReaderVTable.Fn {
            const loop_fn = &struct {
                pub fn loop_fn(this: *anyopaque) *Async.Loop {
                    return Type.loop(@alignCast(@ptrCast(this)));
                }
            }.loop_fn;

            const eventLoop_fn = &struct {
                pub fn eventLoop_fn(this: *anyopaque) JSC.EventLoopHandle {
                    return JSC.EventLoopHandle.init(Type.eventLoop(@alignCast(@ptrCast(this))));
                }
            }.eventLoop_fn;
            return comptime &BufferedReaderVTable.Fn{
                .onReadChunk = if (@hasDecl(Type, "onReadChunk")) @ptrCast(&Type.onReadChunk) else null,
                .onReaderDone = @ptrCast(&Type.onReaderDone),
                .onReaderError = @ptrCast(&Type.onReaderError),
                .eventLoop = eventLoop_fn,
                .loop = loop_fn,
            };
        }
    };

    pub fn eventLoop(this: @This()) JSC.EventLoopHandle {
        return this.fns.eventLoop(this.parent);
    }

    pub fn loop(this: @This()) *Async.Loop {
        return this.fns.loop(this.parent);
    }

    pub fn isStreamingEnabled(this: @This()) bool {
        return this.fns.onReadChunk != null;
    }

    pub fn onReadChunk(this: @This(), chunk: []const u8) void {
        this.fns.onReadChunk.?(this.parent, chunk);
    }

    pub fn onReaderDone(this: @This()) void {
        this.fns.onReaderDone(this.parent);
    }

    pub fn onReaderError(this: @This(), err: bun.sys.Error) void {
        this.fns.onReaderError(this.parent, err);
    }
};

const PosixBufferedReader = struct {
    handle: PollOrFd = .{ .closed = {} },
    _buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
    is_done: bool = false,
    vtable: BufferedReaderVTable,

    pub fn init(comptime Type: type) PosixBufferedReader {
        return .{
            .vtable = BufferedReaderVTable.init(Type),
        };
    }

    pub fn updateRef(this: *const PosixBufferedReader, value: bool) void {
        const poll = this.handle.getPoll() orelse return;
        poll.setKeepingProcessAlive(this.vtable.eventLoop(), value);
    }

    pub fn from(to: *@This(), other: *PosixBufferedReader, parent_: *anyopaque) void {
        to.* = .{
            .handle = other.handle,
            ._buffer = other.buffer().*,
            .is_done = other.is_done,
            .vtable = .{
                .fns = to.vtable.fns,
                .parent = parent_,
            },
        };
        other.buffer().* = std.ArrayList(u8).init(bun.default_allocator);
        other.is_done = true;
        other.handle = .{ .closed = {} };
    }

    pub fn setParent(this: *PosixBufferedReader, parent_: *anyopaque) void {
        this.vtable.parent = parent_;
        this.handle.setOwner(this);
    }

    pub usingnamespace PosixPipeReader(@This(), .{
        .getFd = @ptrCast(&getFd),
        .getBuffer = @ptrCast(&buffer),
        .onReadChunk = @ptrCast(&_onReadChunk),
        .registerPoll = @ptrCast(&registerPoll),
        .done = @ptrCast(&done),
        .onError = @ptrCast(&onError),
    });

    fn _onReadChunk(this: *PosixBufferedReader, chunk: []u8) void {
        this.vtable.onReadChunk(chunk);
    }

    pub fn getFd(this: *PosixBufferedReader) bun.FileDescriptor {
        return this.handle.getFd();
    }

    // No-op on posix.
    pub fn pause(this: *PosixBufferedReader) void {
        _ = this; // autofix

    }

    pub fn buffer(this: *PosixBufferedReader) *std.ArrayList(u8) {
        return &@as(*PosixBufferedReader, @alignCast(@ptrCast(this)))._buffer;
    }

    pub fn disableKeepingProcessAlive(this: *@This(), event_loop_ctx: anytype) void {
        const poll = this.handle.getPoll() orelse return;
        poll.ref(event_loop_ctx);
    }

    pub fn enableKeepingProcessAlive(this: *@This(), event_loop_ctx: anytype) void {
        const poll = this.handle.getPoll() orelse return;
        poll.unref(event_loop_ctx);
    }

    fn finish(this: *PosixBufferedReader) void {
        this.handle.close(null, {});
        std.debug.assert(!this.is_done);
        this.is_done = true;
    }

    pub fn done(this: *PosixBufferedReader) void {
        if (this.handle != .closed) {
            this.handle.close(this, done);
            return;
        }
        this.finish();
        this.vtable.onReaderDone();
    }

    pub fn deinit(this: *PosixBufferedReader) void {
        this.buffer().deinit();
        this.handle.close(null, {});
    }

    pub fn onError(this: *PosixBufferedReader, err: bun.sys.Error) void {
        this.finish();
        this.vtable.onReaderError(err);
    }

    pub fn registerPoll(this: *PosixBufferedReader) void {
        const poll = this.handle.getPoll() orelse return;
        poll.owner.set(this);
        switch (poll.register(this.loop(), .readable, true)) {
            .err => |err| {
                this.onError(err);
            },
            .result => {},
        }
    }

    pub fn start(this: *PosixBufferedReader, fd: bun.FileDescriptor, is_pollable: bool) bun.JSC.Maybe(void) {
        if (!is_pollable) {
            this.buffer().clearRetainingCapacity();
            this.is_done = false;
            this.handle.close(null, {});
            this.handle = .{ .fd = fd };
            return .{ .result = {} };
        }

        const poll = Async.FilePoll.init(this.eventLoop(), fd, .{}, @This(), this);
        const maybe = poll.register(this.loop(), .readable, true);
        if (maybe != .result) {
            poll.deinit();
            return maybe;
        }

        this.handle = .{ .poll = poll };
        this.read();

        return .{
            .result = {},
        };
    }

    // Exists for consistentcy with Windows.
    pub fn hasPendingRead(_: *const PosixBufferedReader) bool {
        return false;
    }

    pub fn loop(this: *const PosixBufferedReader) *Async.Loop {
        return this.vtable.loop();
    }

    pub fn eventLoop(this: *const PosixBufferedReader) JSC.EventLoopHandle {
        return this.vtable.eventLoop();
    }
};

const JSC = bun.JSC;

const WindowsOutputReaderVTable = struct {
    onReaderDone: *const fn (*anyopaque) void,
    onReaderError: *const fn (*anyopaque, bun.sys.Error) void,
    onReadChunk: ?*const fn (
        *anyopaque,
        chunk: []const u8,
    ) void = null,
};

pub const GenericWindowsBufferedReader = struct {
    /// The pointer to this pipe must be stable.
    /// It cannot change because we don't know what libuv will do with it.
    /// To compensate for that,
    pipe: uv.Pipe = std.mem.zeroes(uv.Pipe),
    _buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
    is_done: bool = false,

    has_inflight_read: bool = false,
    _parent: ?*anyopaque = null,
    vtable: WindowsOutputReaderVTable = undefined,

    pub usingnamespace bun.NewRefCounted(@This(), deinit);

    pub fn parent(this: *const GenericWindowsBufferedReader) *anyopaque {
        return this._parent;
    }

    const WindowsOutputReader = @This();

    pub fn setParent(this: *@This(), parent_: anytype) void {
        this._parent = parent_;
        if (!this.is_done) {
            this.pipe.data = this;
        }
    }

    pub fn enableKeepingProcessAlive(this: *@This(), _: anytype) void {
        this.pipe.ref();
    }

    pub fn disableKeepingProcessAlive(this: *@This(), _: anytype) void {
        this.pipe.unref();
    }

    pub usingnamespace WindowsPipeReader(
        @This(),
        {},
        buffer,
        _onReadChunk,
        null,
        done,
        onError,
    );

    pub fn buffer(this: *WindowsOutputReader) *std.ArrayList(u8) {
        return &this._buffer;
    }

    pub fn hasPendingRead(this: *const WindowsOutputReader) bool {
        return this.has_inflight_read;
    }

    fn _onReadChunk(this: *WindowsOutputReader, buf: []u8) void {
        this.has_inflight_read = false;

        const onReadChunkFn = this.vtable.onReadChunk orelse return;
        onReadChunkFn(this.parent() orelse return, buf);
    }

    fn finish(this: *WindowsOutputReader) void {
        std.debug.assert(!this.is_done);
        this.has_inflight_read = false;
        this.is_done = true;
    }

    pub fn done(this: *WindowsOutputReader) void {
        std.debug.assert(this.pipe.isClosed());

        this.finish();
        if (this.parent()) |p|
            this.vtable.onReaderDone(p);
    }

    pub fn onError(this: *WindowsOutputReader, err: bun.sys.Error) void {
        this.finish();
        if (this.parent()) |p|
            this.vtable.onReaderError(p, err);
    }

    pub fn getReadBufferWithStableMemoryAddress(this: *WindowsOutputReader, suggested_size: usize) []u8 {
        this.has_inflight_read = true;
        this._buffer.ensureUnusedCapacity(suggested_size) catch bun.outOfMemory();
        return this._buffer.allocatedSlice()[this._buffer.items.len..];
    }

    pub fn start(this: *@This(), fd: bun.FileDescriptor, _: bool) bun.JSC.Maybe(void) {
        _ = fd; // autofix
        this.buffer().clearRetainingCapacity();
        this.is_done = false;
        this.unpause();
        return .{ .result = {} };
    }

    fn deinit(this: *WindowsOutputReader) void {
        this.buffer().deinit();
        std.debug.assert(this.pipe.isClosed());
    }
};

pub fn WindowsBufferedReader(comptime Parent: type, comptime onReadChunk: ?*const fn (*anyopaque, chunk: []const u8) void) type {
    return struct {
        reader: ?*GenericWindowsBufferedReader = null,

        const vtable = WindowsOutputReaderVTable{
            .onReaderDone = Parent.onReaderDone,
            .onReaderError = Parent.onReaderError,
            .onReadChunk = onReadChunk,
        };

        pub fn from(to: *@This(), other: anytype, parent: anytype) void {
            var reader = other.reader orelse {
                bun.Output.debugWarn("from: reader is null", .{});
                return;
            };
            reader.vtable = vtable;
            reader.parent = parent;
            to.reader = reader;
            other.reader = null;
        }

        pub inline fn buffer(this: @This()) *std.ArrayList(u8) {
            const reader = this.newReader();

            return reader.buffer();
        }

        fn newReader(_: *const @This()) *GenericWindowsBufferedReader {
            return GenericWindowsBufferedReader.new(.{
                .vtable = vtable,
            });
        }

        pub fn hasPendingRead(this: *const @This()) bool {
            if (this.reader) |reader| {
                return reader.hasPendingRead();
            }

            return false;
        }

        pub fn setParent(this: @This(), parent: *Parent) void {
            var reader = this.reader orelse return;
            reader.setParent(parent);
        }

        pub fn enableKeepingProcessAlive(this: @This(), event_loop_ctx: anytype) void {
            var reader = this.reader orelse return;
            reader.enableKeepingProcessAlive(event_loop_ctx);
        }

        pub fn disableKeepingProcessAlive(this: @This(), event_loop_ctx: anytype) void {
            var reader = this.reader orelse return;
            reader.disableKeepingProcessAlive(event_loop_ctx);
        }

        pub fn deinit(this: *@This()) void {
            var reader = this.reader orelse return;
            this.reader = null;
            reader.deref();
        }

        pub fn start(this: *@This(), fd: bun.FileDescriptor) bun.JSC.Maybe(void) {
            const reader = this.reader orelse brk: {
                this.reader = this.newReader();
                break :brk this.reader.?;
            };

            return reader.start(fd);
        }

        pub fn end(this: *@This()) void {
            var reader = this.reader orelse return;
            this.reader = null;
            if (!reader.pipe.isClosing()) {
                reader.ref();
                reader.close();
            }

            reader.deref();
        }
    };
}

pub const BufferedReader = if (bun.Environment.isPosix)
    PosixBufferedReader
else if (bun.Environment.isWindows)
    WindowsBufferedReader
else
    @compileError("Unsupported platform");
