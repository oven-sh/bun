const bun = @import("root").bun;
const std = @import("std");
const Async = bun.Async;
const JSC = bun.JSC;

pub const WriteResult = union(enum) {
    done: usize,
    wrote: usize,
    pending: usize,
    err: bun.sys.Error,
};

pub fn PosixPipeWriter(
    comptime This: type,
    // Originally this was the comptime vtable struct like the below
    // But that caused a Zig compiler segfault as of 0.12.0-dev.1604+caae40c21
    comptime getFd: fn (*This) bun.FileDescriptor,
    comptime getBuffer: fn (*This) []const u8,
    comptime onWrite: fn (*This, written: usize, done: bool) void,
    comptime registerPoll: ?fn (*This) void,
    comptime onError: fn (*This, bun.sys.Error) void,
    comptime onWritable: fn (*This) void,
) type {
    _ = onWritable; // autofix
    return struct {
        pub fn _tryWrite(this: *This, buf_: []const u8) WriteResult {
            const fd = getFd(this);
            var buf = buf_;

            while (buf.len > 0) {
                switch (writeNonBlocking(fd, buf)) {
                    .err => |err| {
                        if (err.isRetry()) {
                            return .{ .pending = buf_.len - buf.len };
                        }

                        return .{ .err = err };
                    },

                    .result => |wrote| {
                        if (wrote == 0) {
                            return .{ .done = buf_.len - buf.len };
                        }

                        buf = buf[wrote..];
                    },
                }
            }

            return .{ .wrote = buf_.len - buf.len };
        }

        fn writeNonBlocking(fd: bun.FileDescriptor, buf: []const u8) JSC.Maybe(usize) {
            if (comptime bun.Environment.isLinux) {
                return bun.sys.writeNonblocking(fd, buf);
            }

            switch (bun.isWritable(fd)) {
                .ready, .hup => return bun.sys.write(fd, buf),
                .not_ready => return JSC.Maybe(usize){ .err = bun.sys.Error.retry },
            }
        }

        pub fn onPoll(parent: *This, size_hint: isize) void {
            _ = size_hint; // autofix

            switch (drainBufferedData(parent)) {
                .pending => {
                    if (comptime registerPoll) |register| {
                        register(parent);
                    }
                },
                .wrote => |amt| {
                    if (getBuffer(parent).len > 0) {
                        if (comptime registerPoll) |register| {
                            register(parent);
                        }
                    }
                    onWrite(parent, amt, false);
                },
                .err => |err| {
                    onError(parent, err);
                },
                .done => |amt| {
                    onWrite(parent, amt, true);
                },
            }
        }

        pub fn drainBufferedData(parent: *This) WriteResult {
            var buf = getBuffer(parent);
            const original_buf = buf;
            while (buf.len > 0) {
                const attempt = _tryWrite(parent, buf);
                switch (attempt) {
                    .pending => {},
                    .wrote => |amt| {
                        buf = buf[amt..];
                    },
                    .err => |err| {
                        const wrote = original_buf.len - buf.len;
                        if (err.isRetry()) {
                            return .{ .pending = wrote };
                        }

                        if (wrote > 0) {
                            onError(parent, err);
                            return .{ .wrote = wrote };
                        } else {
                            return .{ .err = err };
                        }
                    },
                    .done => |amt| {
                        buf = buf[amt..];
                        const wrote = original_buf.len - buf.len;

                        return .{ .done = wrote };
                    },
                }
            }

            const wrote = original_buf.len - buf.len;
            return .{ .wrote = wrote };
        }
    };
}

pub const PollOrFd = union(enum) {
    /// When it's a pipe/fifo
    poll: *Async.FilePoll,

    fd: bun.FileDescriptor,
    closed: void,

    pub fn getFd(this: *const PollOrFd) bun.FileDescriptor {
        return switch (this.*) {
            .closed => bun.invalid_fd,
            .fd => this.fd,
            .poll => this.poll.fd,
        };
    }

    pub fn getPoll(this: *const PollOrFd) ?*Async.FilePoll {
        return switch (this.*) {
            .closed => null,
            .fd => null,
            .poll => this.poll,
        };
    }

    pub fn close(this: *PollOrFd, ctx: ?*anyopaque, comptime onCloseFn: anytype) void {
        const fd = this.getFd();
        if (this.* == .poll) {
            this.poll.deinit();
            this.* = .{ .closed = {} };
        }

        if (fd != bun.invalid_fd) {
            this.handle = .{ .closed = {} };
            onCloseFn(@ptrCast(ctx.?));
        }
    }
};

pub fn PosixBufferedWriter(
    comptime Parent: type,
    comptime onWrite: fn (*Parent, amount: usize, done: bool) void,
    comptime onError: fn (*Parent, bun.sys.Error) void,
    comptime onClose: fn (*Parent) void,
) type {
    return struct {
        buffer: []const u8 = "",
        handle: PollOrFd = .{ .closed = {} },
        parent: *Parent = undefined,
        is_done: bool = false,

        const PosixWriter = @This();

        pub fn getPoll(this: *@This()) ?*Async.FilePoll {
            return this.handle.getPoll();
        }

        pub fn getFd(this: *PosixWriter) bun.FileDescriptor {
            return this.handle.getFd();
        }

        pub fn getBuffer(this: *PosixWriter) []const u8 {
            return this.buffer;
        }

        fn _onError(
            this: *PosixWriter,
            err: bun.sys.Error,
        ) void {
            std.debug.assert(!err.isRetry());

            onError(this.parent, err);

            this.close();
        }

        fn _onWrite(
            this: *PosixWriter,
            written: usize,
            done: bool,
        ) void {
            const was_done = this.is_done == true;
            this.buffer = this.buffer[written..];
            const parent = this.parent;

            onWrite(parent, written, done);

            if (done and !was_done) {
                this.close();
            }
        }

        fn _onWritable(this: *PosixWriter) void {
            if (this.is_done) {
                return;
            }
        }

        fn registerPoll(this: *PosixWriter) void {
            var poll = this.getPoll() orelse return;
            switch (poll.registerWithFd(bun.uws.Loop.get(), .writable, true, poll.fd)) {
                .err => |err| {
                    onError(this, err);
                },
                .result => {},
            }
        }

        pub const tryWrite = @This()._tryWrite;

        pub fn hasRef(this: *PosixWriter) bool {
            if (this.is_done) {
                return false;
            }

            const poll = this.getPoll() orelse return false;
            return poll.canEnableKeepingProcessAlive();
        }

        pub fn enableKeepingProcessAlive(this: *PosixWriter, event_loop: JSC.EventLoopHandle) void {
            if (this.is_done) return;

            const poll = this.getPoll() orelse return;
            poll.enableKeepingProcessAlive(event_loop);
        }

        pub fn disableKeepingProcessAlive(this: *PosixWriter, event_loop: JSC.EventLoopHandle) void {
            const poll = this.getPoll() orelse return;
            poll.disableKeepingProcessAlive(event_loop);
        }

        pub usingnamespace PosixPipeWriter(@This(), getFd, getBuffer, _onWrite, registerPoll, _onError, _onWritable);

        pub fn end(this: *PosixWriter) void {
            if (this.is_done) {
                return;
            }

            this.is_done = true;
            this.close();
        }

        pub fn close(this: *PosixWriter) void {
            this.handle.close(this.parent, onClose);
        }

        pub fn start(this: *PosixWriter, fd: bun.FileDescriptor, bytes: []const u8, pollable: bool) JSC.Maybe(void) {
            this.buffer = bytes;
            if (!pollable) {
                std.debug.assert(this.handle != .poll);
                this.handle = .{ .fd = fd };
                return JSC.Maybe(void){ .result = {} };
            }
            const loop = @as(*Parent, @ptrCast(this.parent)).loop();
            var poll = this.poll orelse brk: {
                this.handle = .{ .poll = Async.FilePoll.init(loop, fd, .writable, PosixWriter, this) };
                break :brk this.poll.?;
            };

            switch (poll.registerWithFd(loop, .writable, true, fd)) {
                .err => |err| {
                    return JSC.Maybe(void){ .err = err };
                },
                .result => {},
            }

            return JSC.Maybe(void){ .result = {} };
        }
    };
}

pub fn PosixStreamingWriter(
    comptime Parent: type,
    comptime onWrite: fn (*Parent, amount: usize, done: bool) void,
    comptime onError: fn (*Parent, bun.sys.Error) void,
    comptime onReady: ?fn (*Parent) void,
    comptime onClose: fn (*Parent) void,
) type {
    return struct {
        buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
        handle: PollOrFd = .{ .closed = {} },
        parent: *anyopaque = undefined,
        head: usize = 0,
        is_done: bool = false,

        // TODO:
        chunk_size: usize = 0,

        pub fn getPoll(this: *@This()) ?*Async.FilePoll {
            return this.handle.getPoll();
        }

        pub fn getFd(this: *PosixWriter) bun.FileDescriptor {
            return this.handle.getFd();
        }

        const PosixWriter = @This();

        pub fn getBuffer(this: *PosixWriter) []const u8 {
            return this.buffer.items[this.head..];
        }

        fn _onError(
            this: *PosixWriter,
            err: bun.sys.Error,
        ) void {
            std.debug.assert(!err.isRetry());
            this.is_done = true;

            onError(@ptrCast(this.parent), err);
            this.close();
        }

        fn _onWrite(
            this: *PosixWriter,
            written: usize,
            done: bool,
        ) void {
            this.head += written;

            if (this.buffer.items.len == this.head) {
                if (this.buffer.capacity > 32 * 1024 and !done) {
                    this.buffer.shrinkAndFree(std.mem.page_size);
                }
                this.buffer.clearRetainingCapacity();
                this.head = 0;
            }

            onWrite(@ptrCast(this.parent), written, done);
        }

        fn _onWritable(this: *PosixWriter) void {
            if (this.is_done) {
                return;
            }

            this.head = 0;
            if (onReady) |cb| {
                cb(@ptrCast(this.parent));
            }
        }

        fn registerPoll(this: *PosixWriter) void {
            const poll = this.getPoll() orelse return;
            switch (poll.registerWithFd(@as(*Parent, @ptrCast(this.parent)).loop(), .writable, true, poll.fd)) {
                .err => |err| {
                    onError(this, err);
                    this.close();
                },
                .result => {},
            }
        }

        pub fn tryWrite(this: *PosixWriter, buf: []const u8) WriteResult {
            if (this.is_done) {
                return .{ .done = 0 };
            }

            if (this.buffer.items.len > 0) {
                this.buffer.appendSlice(buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };

                return .{ .pending = 0 };
            }

            return @This()._tryWrite(this, buf);
        }

        pub fn writeUTF16(this: *PosixWriter, buf: []const u16) WriteResult {
            if (this.is_done) {
                return .{ .done = 0 };
            }

            const had_buffered_data = this.buffer.items.len > 0;
            {
                var byte_list = bun.ByteList.fromList(this.buffer);
                defer this.buffer = byte_list.listManaged(bun.default_allocator);

                byte_list.writeUTF16(bun.default_allocator, buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };
            }

            if (had_buffered_data) {
                return .{ .pending = 0 };
            }

            return this._tryWriteNewlyBufferedData();
        }

        pub fn writeLatin1(this: *PosixWriter, buf: []const u8) WriteResult {
            if (this.is_done) {
                return .{ .done = 0 };
            }

            if (bun.strings.isAllASCII(buf)) {
                return this.write(buf);
            }

            const had_buffered_data = this.buffer.items.len > 0;
            {
                var byte_list = bun.ByteList.fromList(this.buffer);
                defer this.buffer = byte_list.listManaged(bun.default_allocator);

                byte_list.writeLatin1(bun.default_allocator, buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };
            }

            if (had_buffered_data) {
                return .{ .pending = 0 };
            }

            return this._tryWriteNewlyBufferedData();
        }

        fn _tryWriteNewlyBufferedData(this: *PosixWriter) WriteResult {
            std.debug.assert(!this.is_done);

            switch (@This()._tryWrite(this, this.buffer.items)) {
                .wrote => |amt| {
                    if (amt == this.buffer.items.len) {
                        this.buffer.clearRetainingCapacity();
                    } else {
                        this.head = amt;
                    }
                    return .{ .wrote = amt };
                },
                .done => |amt| {
                    this.buffer.clearRetainingCapacity();

                    return .{ .done = amt };
                },
            }
        }

        pub fn write(this: *PosixWriter, buf: []const u8) WriteResult {
            if (this.is_done) {
                return .{ .done = 0 };
            }

            if (this.buffer.items.len + buf.len < this.chunk_size) {
                this.buffer.appendSlice(buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };

                return .{ .pending = 0 };
            }

            const rc = @This()._tryWrite(this, buf);
            if (rc == .pending) {
                registerPoll(this);
                return rc;
            }
            this.head = 0;
            switch (rc) {
                .pending => {
                    this.buffer.appendSlice(buf) catch {
                        return .{ .err = bun.sys.Error.oom };
                    };
                },
                .wrote => |amt| {
                    if (amt < buf.len) {
                        this.buffer.appendSlice(buf[amt..]) catch {
                            return .{ .err = bun.sys.Error.oom };
                        };
                    } else {
                        this.buffer.clearRetainingCapacity();
                    }
                },
                .done => |amt| {
                    return .{ .done = amt };
                },
            }
        }

        pub usingnamespace PosixPipeWriter(@This(), getFd, getBuffer, _onWrite, registerPoll, _onError, _onWritable);

        pub fn flush(this: *PosixWriter) WriteResult {
            return this.drainBufferedData();
        }

        pub fn deinit(this: *PosixWriter) void {
            this.buffer.clearAndFree();
            this.close();
        }

        pub fn hasRef(this: *PosixWriter) bool {
            const poll = this.poll orelse return false;
            return !this.is_done and poll.canEnableKeepingProcessAlive();
        }

        pub fn enableKeepingProcessAlive(this: *PosixWriter, event_loop: JSC.EventLoopHandle) void {
            if (this.is_done) return;
            const poll = this.getPoll() orelse return;

            poll.enableKeepingProcessAlive(event_loop);
        }

        pub fn disableKeepingProcessAlive(this: *PosixWriter, event_loop: JSC.EventLoopHandle) void {
            const poll = this.getPoll() orelse return;
            poll.disableKeepingProcessAlive(event_loop);
        }

        pub fn end(this: *PosixWriter) void {
            if (this.is_done) {
                return;
            }

            this.is_done = true;
            this.close();
        }

        pub fn close(this: *PosixWriter) void {
            this.handle.close(@ptrCast(this.parent), onClose);
        }

        pub fn start(this: *PosixWriter, fd: bun.FileDescriptor, is_pollable: bool) JSC.Maybe(void) {
            if (!is_pollable) {
                this.close();
                this.handle = .{ .fd = fd };
                return JSC.Maybe(void){ .result = {} };
            }

            const loop = @as(*Parent, @ptrCast(this.parent)).loop();
            var poll = this.poll orelse brk: {
                this.handle = .{ .poll = Async.FilePoll.init(loop, fd, .writable, PosixWriter, this) };
                break :brk this.poll.?;
            };

            switch (poll.registerWithFd(loop, .writable, true, fd)) {
                .err => |err| {
                    return JSC.Maybe(void){ .err = err };
                },
                .result => {},
            }

            return JSC.Maybe(void){ .result = {} };
        }
    };
}

pub const BufferedWriter = if (bun.Environment.isPosix) PosixBufferedWriter else opaque {};
pub const StreamingWriter = if (bun.Environment.isPosix) PosixStreamingWriter else opaque {};
