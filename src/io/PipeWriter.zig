const bun = @import("root").bun;
const std = @import("std");
const Async = bun.Async;
const JSC = bun.JSC;

pub const WriteResult = union(enum) {
    done: usize,
    wrote: usize,
    pending: void,
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
    return struct {
        pub fn _tryWrite(this: *This, buf_: []const u8) WriteResult {
            const fd = getFd(this);
            var buf = buf_;

            while (buf.len > 0) {
                switch (writeNonBlocking(fd, buf)) {
                    .err => |err| {
                        if (err.isRetry()) {
                            break;
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

            drain(parent);
        }

        fn drain(parent: *This) bool {
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
                        std.debug.assert(!err.isRetry());
                        const wrote = original_buf.len - buf.len;
                        if (wrote > 0) {
                            onWrite(parent, wrote, false);
                        }
                        onError(parent, err);
                    },
                    .done => |amt| {
                        buf = buf[amt..];
                        const wrote = original_buf.len - buf.len;

                        onWrite(parent, wrote, true);

                        return false;
                    },
                }
            }

            const wrote = original_buf.len - buf.len;
            if (wrote < original_buf.len) {
                if (comptime registerPoll) |register| {
                    register(parent);
                }
            }

            if (wrote == 0) {
                onWritable(parent);
            } else {
                onWrite(parent, wrote, false);
            }
        }
    };
}

pub fn PosixBufferedOutputWriter(
    comptime Parent: type,
    comptime onWrite: fn (*Parent, amount: usize, done: bool) void,
    comptime onError: fn (*Parent, bun.sys.Error) void,
    comptime onClose: fn (*Parent) void,
) type {
    return struct {
        buffer: []const u8 = "",
        poll: ?*Async.FilePoll = null,
        parent: *Parent = undefined,
        is_done: bool = false,

        const PosixOutputWriter = @This();

        pub fn getFd(this: *PosixOutputWriter) bun.FileDescriptor {
            return this.poll.fd;
        }

        pub fn getBuffer(this: *PosixOutputWriter) []const u8 {
            return this.buffer;
        }

        fn _onError(
            this: *PosixOutputWriter,
            err: bun.sys.Error,
        ) void {
            std.debug.assert(!err.isRetry());
            clearPoll(this);

            onError(this.parent, err);
        }

        fn _onWrite(
            this: *PosixOutputWriter,
            written: usize,
            done: bool,
        ) void {
            const was_done = this.is_done == true;
            this.buffer = this.buffer[written..];
            const parent = this.parent;

            onWrite(parent, written, done);

            if (done and !was_done) {
                this.clearPoll();
            }
        }

        fn _onWritable(this: *PosixOutputWriter) void {
            if (this.is_done) {
                return;
            }
        }

        fn registerPoll(this: *PosixOutputWriter) void {
            var poll = this.poll orelse return;
            switch (poll.registerWithFd(bun.uws.Loop.get(), .writable, true, poll.fd)) {
                .err => |err| {
                    onError(this, err);
                },
                .result => {},
            }
        }

        pub const tryWrite = @This()._tryWrite;

        pub fn hasRef(this: *PosixOutputWriter) bool {
            return !this.is_done and this.poll.canEnableKeepingProcessAlive();
        }

        pub fn enableKeepingProcessAlive(this: *PosixOutputWriter, event_loop: JSC.EventLoopHandle) void {
            if (this.is_done) return;

            const poll = this.poll orelse return;
            poll.enableKeepingProcessAlive(event_loop);
        }

        pub fn disableKeepingProcessAlive(this: *PosixOutputWriter, event_loop: JSC.EventLoopHandle) void {
            const poll = this.poll orelse return;
            poll.disableKeepingProcessAlive(event_loop);
        }

        pub usingnamespace PosixPipeWriter(@This(), getFd, getBuffer, _onWrite, registerPoll, _onError, _onWritable);

        pub fn end(this: *PosixOutputWriter) void {
            if (this.is_done) {
                return;
            }

            this.is_done = true;
            clearPoll(this);
        }

        fn clearPoll(this: *PosixOutputWriter) void {
            if (this.poll) |poll| {
                const fd = poll.fd;
                this.poll = null;
                if (fd != bun.invalid_fd) {
                    _ = bun.sys.close(fd);
                    onClose(@ptrCast(this.parent));
                }
                poll.deinit();
            }
        }

        pub fn start(this: *PosixOutputWriter, fd: bun.FileDescriptor) JSC.Maybe(void) {
            const loop = @as(*Parent, @ptrCast(this.parent)).loop();
            var poll = this.poll orelse brk: {
                this.poll = Async.FilePoll.init(loop, fd, .writable, PosixOutputWriter, this);
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

pub fn PosixStreamingOutputWriter(
    comptime Parent: type,
    comptime onWrite: fn (*Parent, amount: usize, done: bool) void,
    comptime onError: fn (*Parent, bun.sys.Error) void,
    comptime onReady: ?fn (*Parent) void,
    comptime onClose: fn (*Parent) void,
) type {
    return struct {
        buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
        poll: ?*Async.FilePoll = null,
        parent: *anyopaque = undefined,
        is_done: bool = false,
        head: usize = 0,

        const PosixOutputWriter = @This();

        pub fn getFd(this: *PosixOutputWriter) bun.FileDescriptor {
            return this.poll.?.fd;
        }

        pub fn getBuffer(this: *PosixOutputWriter) []const u8 {
            return this.buffer.items[this.head..];
        }

        fn _onError(
            this: *PosixOutputWriter,
            err: bun.sys.Error,
        ) void {
            std.debug.assert(!err.isRetry());
            this.is_done = true;
            onError(@ptrCast(this.parent), err);
        }

        fn _onWrite(
            this: *PosixOutputWriter,
            written: usize,
            done: bool,
        ) void {
            this.buffer = this.buffer[written..];
            this.head += written;

            if (this.buffer.items.len == this.head) {
                this.buffer.clearRetainingCapacity();
                this.head = 0;
            }

            onWrite(@ptrCast(this.parent), written, done);
        }

        fn _onWritable(this: *PosixOutputWriter) void {
            if (this.is_done) {
                return;
            }

            this.head = 0;
            if (onReady) |cb| {
                cb(@ptrCast(this.parent));
            }
        }

        fn registerPoll(this: *PosixOutputWriter) void {
            switch (this.poll.?.registerWithFd(@as(*Parent, @ptrCast(this.parent)).loop(), .writable, true, this.poll.fd)) {
                .err => |err| {
                    onError(this, err);
                },
                .result => {},
            }
        }

        pub fn tryWrite(this: *PosixOutputWriter, buf: []const u8) WriteResult {
            if (this.is_done) {
                return .{ .done = 0 };
            }

            if (this.buffer.items.len > 0) {
                this.buffer.appendSlice(buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };

                return .{ .pending = {} };
            }

            return @This()._tryWrite(this, buf);
        }

        pub fn write(this: *PosixOutputWriter, buf: []const u8) WriteResult {
            const rc = tryWrite(this, buf);
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

        pub fn deinit(this: *PosixOutputWriter) void {
            this.buffer.clearAndFree();
            this.clearPoll();
        }

        pub fn hasRef(this: *PosixOutputWriter) bool {
            return !this.is_done and this.poll.?.canEnableKeepingProcessAlive();
        }

        pub fn enableKeepingProcessAlive(this: *PosixOutputWriter, event_loop: JSC.EventLoopHandle) void {
            if (this.is_done) return;

            this.poll.?.enableKeepingProcessAlive(event_loop);
        }

        pub fn disableKeepingProcessAlive(this: *PosixOutputWriter, event_loop: JSC.EventLoopHandle) void {
            this.poll.?.disableKeepingProcessAlive(event_loop);
        }

        pub fn end(this: *PosixOutputWriter) void {
            if (this.is_done) {
                return;
            }

            this.is_done = true;
            clearPoll(this);
        }

        fn clearPoll(this: *PosixOutputWriter) void {
            if (this.poll) |poll| {
                const fd = poll.fd;
                poll.deinit();
                this.poll = null;

                if (fd != bun.invalid_fd) {
                    onClose(@ptrCast(this.parent));
                }
            }
        }

        pub fn start(this: *PosixOutputWriter, fd: bun.FileDescriptor) JSC.Maybe(void) {
            const loop = @as(*Parent, @ptrCast(this.parent)).loop();
            var poll = this.poll orelse brk: {
                this.poll = Async.FilePoll.init(loop, fd, .writable, PosixOutputWriter, this);
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

pub const BufferedOutputWriter = if (bun.Environment.isPosix) PosixBufferedOutputWriter else opaque {};
pub const StreamingOutputWriter = if (bun.Environment.isPosix) PosixStreamingOutputWriter else opaque {};
