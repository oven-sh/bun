const bun = @import("root").bun;
const std = @import("std");

/// Read a blocking pipe without blocking the current thread.
pub fn PosixPipeReader(
    comptime This: type,
    // Originally this was the comptime vtable struct like the below
    // But that caused a Zig compiler segfault as of 0.12.0-dev.1604+caae40c21
    comptime getFd: fn (*This) bun.FileDescriptor,
    comptime getBuffer: fn (*This) *std.ArrayList(u8),
    comptime onReadChunk: ?fn (*This, chunk: []u8) void,
    comptime registerPoll: ?fn (*This) void,
    comptime done: fn (*This) void,
    comptime onError: fn (*This, bun.sys.Error) void,
) type {
    return struct {
        const vtable = .{
            .getFd = getFd,
            .getBuffer = getBuffer,
            .onReadChunk = onReadChunk,
            .registerPoll = registerPoll,
            .done = done,
            .onError = onError,
        };

        pub fn read(this: *This) void {
            const buffer = @call(.always_inline, vtable.getBuffer, .{this});
            const fd = @call(.always_inline, vtable.getFd, .{this});
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
            const fd = @call(.always_inline, vtable.getFd, .{parent});

            readFromBlockingPipeWithoutBlocking(parent, resizable_buffer, fd, size_hint);
        }

        const stack_buffer_len = 64 * 1024;

        inline fn drainChunk(parent: *This, resizable_buffer: *std.ArrayList(u8), start_length: usize) void {
            if (comptime vtable.onReadChunk) |onRead| {
                if (resizable_buffer.items[start_length..].len > 0) {
                    const chunk = resizable_buffer.items[start_length..];
                    onRead(parent, chunk);
                }
            }
        }

        // On Linux, we use preadv2 to read without blocking.
        fn readFromBlockingPipeWithoutBlockingLinux(parent: *This, resizable_buffer: *std.ArrayList(u8), fd: bun.FileDescriptor, size_hint: isize) void {
            if (size_hint > stack_buffer_len) {
                resizable_buffer.ensureUnusedCapacity(@intCast(size_hint)) catch bun.outOfMemory();
            }

            const start_length: usize = resizable_buffer.items.len;

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
                        } else if (resizable_buffer.items.len > 0) {
                            resizable_buffer.appendSlice(buffer[0..bytes_read]) catch bun.outOfMemory();
                            buffer = resizable_buffer.items;
                        }

                        if (comptime vtable.onReadChunk) |onRead| {
                            onRead(parent, buffer);
                        } else if (buffer.ptr != &stack_buffer) {
                            resizable_buffer.items.len += bytes_read;
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
                        } else if (resizable_buffer.items.len > 0) {
                            resizable_buffer.appendSlice(buffer[0..bytes_read]) catch bun.outOfMemory();
                            buffer = resizable_buffer.items;
                        }

                        if (comptime vtable.onReadChunk) |onRead| {
                            onRead(parent, buffer);
                        } else if (buffer.ptr != &stack_buffer) {
                            resizable_buffer.items.len += bytes_read;
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
            const fd = getFd(this);
            if (fd != bun.invalid_fd) {
                _ = bun.sys.close();
                this.poll.deinit();
            }
            vtable.done(this);
        }
    };
}

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
pub fn PosixBufferedOutputReader(comptime Parent: type, comptime onReadChunk: ?*const fn (*Parent, chunk: []const u8) void) type {
    return struct {
        poll: *Async.FilePoll = undefined,
        _buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
        is_done: bool = false,
        parent: *Parent = undefined,

        const PosixOutputReader = @This();

        pub fn fromOutputReader(to: *@This(), from: anytype, parent: *Parent) void {
            to.* = .{
                .poll = from.poll,
                .buffer = from.buffer,
                .is_done = from.is_done,
                .parent = parent,
            };
            to.poll.owner = Async.FilePoll.Owner.init(to);
            from.buffer = .{
                .items = &.{},
                .capacity = 0,
                .allocator = from.buffer.allocator,
            };
            from.is_done = true;
            from.poll = undefined;
        }

        pub fn setParent(this: *@This(), parent: *Parent) void {
            this.parent = parent;
            if (!this.is_done) {
                this.poll.owner = Async.FilePoll.Owner.init(this);
            }
        }

        pub usingnamespace PosixPipeReader(
            @This(),
            getFd,
            buffer,
            if (onReadChunk != null) _onReadChunk else null,
            registerPoll,
            done,
            onError,
        );

        fn _onReadChunk(this: *PosixOutputReader, chunk: []u8) void {
            onReadChunk.?(this.parent, chunk);
        }

        pub fn getFd(this: *PosixOutputReader) bun.FileDescriptor {
            return this.poll.fd;
        }

        // No-op on posix.
        pub fn pause(this: *PosixOutputReader) void {
            _ = this; // autofix

        }

        pub fn buffer(this: *PosixOutputReader) *std.ArrayList(u8) {
            return &this._buffer;
        }

        pub fn disableKeepingProcessAlive(this: *@This(), event_loop_ctx: anytype) void {
            this.poll.ref(event_loop_ctx);
        }

        pub fn enableKeepingProcessAlive(this: *@This(), event_loop_ctx: anytype) void {
            this.poll.unref(event_loop_ctx);
        }

        fn finish(this: *PosixOutputReader) void {
            this.poll.flags.insert(.ignore_updates);
            this.parent.eventLoop().putFilePoll(this.poll);
            std.debug.assert(!this.is_done);
            this.is_done = true;
        }

        pub fn done(this: *PosixOutputReader) void {
            this.finish();
            this.parent.onOutputDone();
        }

        pub fn deinit(this: *PosixOutputReader) void {
            this.buffer.deinit();
            this.poll.deinit();
        }

        pub fn onError(this: *PosixOutputReader, err: bun.sys.Error) void {
            this.finish();
            this.parent.onOutputError(err);
        }

        pub fn registerPoll(this: *PosixOutputReader) void {
            switch (this.poll.register(this.parent.loop(), .readable, true)) {
                .err => |err| {
                    this.onError(err);
                },
                .result => {},
            }
        }

        pub fn start(this: *PosixOutputReader) bun.JSC.Maybe(void) {
            const maybe = this.poll.register(this.parent.loop(), .readable, true);
            if (maybe != .result) {
                return maybe;
            }

            this.read();

            return .{
                .result = {},
            };
        }

        // Exists for consistentcy with Windows.
        pub fn hasPendingRead(_: *const PosixOutputReader) bool {
            return false;
        }
    };
}

const JSC = bun.JSC;

const WindowsOutputReaderVTable = struct {
    onOutputDone: *const fn (*anyopaque) void,
    onOutputError: *const fn (*anyopaque, bun.sys.Error) void,
    onReadChunk: ?*const fn (*anyopaque, chunk: []const u8) void = null,
};

pub const GenericWindowsBufferedOutputReader = struct {
    /// The pointer to this pipe must be stable.
    /// It cannot change because we don't know what libuv will do with it.
    /// To compensate for that,
    pipe: uv.Pipe = std.mem.zeroes(uv.Pipe),
    _buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
    is_done: bool = false,

    has_inflight_read: bool = false,
    parent: ?*anyopaque = null,
    vtable: WindowsOutputReaderVTable = undefined,

    pub usingnamespace bun.NewRefCounted(@This(), deinit);

    const WindowsOutputReader = @This();

    pub fn fromOutputReader(to: *@This(), from: anytype, parent: anytype) void {
        _ = to; // autofix
        _ = from; // autofix
        _ = parent; // autofix

    }

    pub fn setParent(this: *@This(), parent: anytype) void {
        this.parent = parent;
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
        const parent = this.parent orelse return;
        onReadChunkFn(parent, buf);
    }

    fn finish(this: *WindowsOutputReader) void {
        std.debug.assert(!this.is_done);
        this.has_inflight_read = false;
        this.is_done = true;
    }

    pub fn done(this: *WindowsOutputReader) void {
        std.debug.assert(this.pipe.isClosed());

        this.finish();
        if (this.parent) |parent|
            this.vtable.onOutputDone(parent);
    }

    pub fn onError(this: *WindowsOutputReader, err: bun.sys.Error) void {
        this.finish();
        if (this.parent) |parent|
            this.vtable.onOutputError(parent, err);
    }

    pub fn getReadBufferWithStableMemoryAddress(this: *WindowsOutputReader, suggested_size: usize) []u8 {
        this.has_inflight_read = true;
        this._buffer.ensureUnusedCapacity(suggested_size) catch bun.outOfMemory();
        return this._buffer.allocatedSlice()[this._buffer.items.len..];
    }

    pub fn start(this: *WindowsOutputReader) JSC.Maybe(void) {
        this.buffer.clearRetainingCapacity();
        this.is_done = false;
    }

    fn deinit(this: *WindowsOutputReader) void {
        this.buffer.deinit();
        std.debug.assert(this.pipe.isClosed());
    }
};

pub fn WindowsBufferedOutputReader(comptime Parent: type, comptime onReadChunk: ?*const fn (*anyopaque, chunk: []const u8) void) type {
    return struct {
        reader: ?*GenericWindowsBufferedOutputReader = null,

        const vtable = WindowsOutputReaderVTable{
            .onOutputDone = Parent.onOutputDone,
            .onOutputError = Parent.onOutputError,
            .onReadChunk = onReadChunk,
        };

        pub inline fn buffer(this: @This()) *std.ArrayList(u8) {
            const reader = this.newReader();

            return reader.buffer();
        }

        fn newReader(_: *const @This()) *GenericWindowsBufferedOutputReader {
            return GenericWindowsBufferedOutputReader.new(.{
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

        pub fn start(this: *@This()) bun.JSC.Maybe(void) {
            const reader = this.reader orelse brk: {
                this.reader = this.newReader();
                break :brk this.reader.?;
            };

            return reader.start();
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
// a trick to get ZLS to autocomplete it.
fn BufferedOutputReaderType() type {
    if (bun.Environment.isPosix) {
        return PosixBufferedOutputReader;
    } else if (bun.Environment.isWindows) {
        return WindowsBufferedOutputReader;
    }

    @compileError("Unsupported platform");
}
pub const BufferedOutputReader = BufferedOutputReaderType();
