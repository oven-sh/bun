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
                if (bun.C.linux.RWFFlagSupport.isMaybeSupported()) {
                    return bun.sys.writeNonblocking(fd, buf);
                }
            }

            switch (bun.isWritable(fd)) {
                .ready, .hup => return bun.sys.write(fd, buf),
                .not_ready => return JSC.Maybe(usize){ .err = bun.sys.Error.retry },
            }
        }

        pub fn onPoll(parent: *This, size_hint: isize, received_hup: bool) void {
            switch (drainBufferedData(parent, if (size_hint > 0) @intCast(size_hint) else std.math.maxInt(usize), received_hup)) {
                .pending => |wrote| {
                    if (comptime registerPoll) |register| {
                        register(parent);
                    }
                    if (wrote > 0)
                        onWrite(parent, wrote, false);
                },
                .wrote => |amt| {
                    onWrite(parent, amt, false);
                    if (getBuffer(parent).len > 0) {
                        if (comptime registerPoll) |register| {
                            register(parent);
                        }
                    }
                },
                .err => |err| {
                    onError(parent, err);
                },
                .done => |amt| {
                    onWrite(parent, amt, true);
                },
            }
        }

        pub fn drainBufferedData(parent: *This, max_write_size: usize, received_hup: bool) WriteResult {
            _ = received_hup; // autofix
            var buf = getBuffer(parent);
            buf = if (max_write_size < buf.len and max_write_size > 0) buf[0..max_write_size] else buf;
            const original_buf = buf;

            while (buf.len > 0) {
                const attempt = _tryWrite(parent, buf);
                switch (attempt) {
                    .pending => |pending| {
                        return .{ .pending = pending + (original_buf.len - buf.len) };
                    },
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

const PollOrFd = @import("./pipes.zig").PollOrFd;

pub fn PosixBufferedWriter(
    comptime Parent: type,
    comptime onWrite: *const fn (*Parent, amount: usize, done: bool) void,
    comptime onError: *const fn (*Parent, bun.sys.Error) void,
    comptime onClose: ?*const fn (*Parent) void,
    comptime getBuffer: *const fn (*Parent) []const u8,
    comptime onWritable: ?*const fn (*Parent) void,
) type {
    return struct {
        handle: PollOrFd = .{ .closed = {} },
        parent: *Parent = undefined,
        is_done: bool = false,
        pollable: bool = false,
        closed_without_reporting: bool = false,

        const PosixWriter = @This();

        pub fn getPoll(this: *const @This()) ?*Async.FilePoll {
            return this.handle.getPoll();
        }

        pub fn getFd(this: *const PosixWriter) bun.FileDescriptor {
            return this.handle.getFd();
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
            const parent = this.parent;

            if (done and !was_done) {
                this.closeWithoutReporting();
            }

            onWrite(parent, written, done);
            if (done and !was_done) {
                this.close();
            }
        }

        fn _onWritable(this: *PosixWriter) void {
            if (this.is_done) {
                return;
            }

            if (onWritable) |cb| {
                cb(this.parent);
            }
        }

        fn registerPoll(this: *PosixWriter) void {
            var poll = this.getPoll() orelse return;
            switch (poll.registerWithFd(bun.uws.Loop.get(), .writable, .dispatch, poll.fd)) {
                .err => |err| {
                    onError(this.parent, err);
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

        pub fn enableKeepingProcessAlive(this: *PosixWriter, event_loop: anytype) void {
            this.updateRef(event_loop, true);
        }

        pub fn disableKeepingProcessAlive(this: *PosixWriter, event_loop: anytype) void {
            this.updateRef(event_loop, false);
        }

        fn getBufferInternal(this: *PosixWriter) []const u8 {
            return getBuffer(this.parent);
        }

        pub usingnamespace PosixPipeWriter(@This(), getFd, getBufferInternal, _onWrite, registerPoll, _onError, _onWritable);

        pub fn end(this: *PosixWriter) void {
            if (this.is_done) {
                return;
            }

            this.is_done = true;
            this.close();
        }

        fn closeWithoutReporting(this: *PosixWriter) void {
            if (this.getFd() != bun.invalid_fd) {
                std.debug.assert(!this.closed_without_reporting);
                this.closed_without_reporting = true;
                this.handle.close(null, {});
            }
        }

        pub fn close(this: *PosixWriter) void {
            if (onClose) |closer| {
                if (this.closed_without_reporting) {
                    this.closed_without_reporting = false;
                    closer(this.parent);
                } else {
                    this.handle.close(this.parent, closer);
                }
            }
        }

        pub fn updateRef(this: *const PosixWriter, event_loop: anytype, value: bool) void {
            const poll = this.getPoll() orelse return;
            poll.setKeepingProcessAlive(event_loop, value);
        }

        pub fn setParent(this: *PosixWriter, parent: *Parent) void {
            this.parent = parent;
            this.handle.setOwner(this);
        }

        pub fn write(this: *PosixWriter) void {
            this.onPoll(0, false);
        }

        pub fn watch(this: *PosixWriter) void {
            if (this.pollable) {
                if (this.handle == .fd) {
                    this.handle = .{ .poll = Async.FilePoll.init(@as(*Parent, @ptrCast(this.parent)).eventLoop(), this.getFd(), .{}, PosixWriter, this) };
                }

                this.registerPoll();
            }
        }

        pub fn start(this: *PosixWriter, fd: bun.FileDescriptor, pollable: bool) JSC.Maybe(void) {
            this.pollable = pollable;
            if (!pollable) {
                std.debug.assert(this.handle != .poll);
                this.handle = .{ .fd = fd };
                return JSC.Maybe(void){ .result = {} };
            }
            var poll = this.getPoll() orelse brk: {
                this.handle = .{ .poll = Async.FilePoll.init(@as(*Parent, @ptrCast(this.parent)).eventLoop(), fd, .{}, PosixWriter, this) };
                break :brk this.handle.poll;
            };
            const loop = @as(*Parent, @ptrCast(this.parent)).eventLoop().loop();

            switch (poll.registerWithFd(loop, .writable, .dispatch, fd)) {
                .err => |err| {
                    return JSC.Maybe(void){ .err = err };
                },
                .result => {
                    this.enableKeepingProcessAlive(@as(*Parent, @ptrCast(this.parent)).eventLoop());
                },
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
        parent: *Parent = undefined,
        head: usize = 0,
        is_done: bool = false,
        closed_without_reporting: bool = false,

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

            this.closeWithoutReporting();
            this.is_done = true;

            onError(@alignCast(@ptrCast(this.parent)), err);
            this.close();
        }

        fn _onWrite(
            this: *PosixWriter,
            written: usize,
            done: bool,
        ) void {
            this.head += written;

            if (done) {
                this.closeWithoutReporting();
            }

            if (this.buffer.items.len == this.head) {
                if (this.buffer.capacity > 32 * 1024 and !done) {
                    this.buffer.shrinkAndFree(std.mem.page_size);
                }
                this.buffer.clearRetainingCapacity();
                this.head = 0;
            }

            onWrite(@ptrCast(this.parent), written, done);
        }

        pub fn setParent(this: *PosixWriter, parent: *Parent) void {
            this.parent = parent;
            this.handle.setOwner(this);
        }

        fn _onWritable(this: *PosixWriter) void {
            if (this.is_done or this.closed_without_reporting) {
                return;
            }

            this.head = 0;
            if (onReady) |cb| {
                cb(@ptrCast(this.parent));
            }
        }

        fn closeWithoutReporting(this: *PosixWriter) void {
            if (this.getFd() != bun.invalid_fd) {
                std.debug.assert(!this.closed_without_reporting);
                this.closed_without_reporting = true;
                this.handle.close(null, {});
            }
        }

        fn registerPoll(this: *PosixWriter) void {
            const poll = this.getPoll() orelse return;
            switch (poll.registerWithFd(@as(*Parent, @ptrCast(this.parent)).loop(), .writable, .dispatch, poll.fd)) {
                .err => |err| {
                    onError(this.parent, err);
                    this.close();
                },
                .result => {},
            }
        }

        pub fn tryWrite(this: *PosixWriter, buf: []const u8) WriteResult {
            if (this.is_done or this.closed_without_reporting) {
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
            if (this.is_done or this.closed_without_reporting) {
                return .{ .done = 0 };
            }

            const had_buffered_data = this.buffer.items.len > 0;
            {
                var byte_list = bun.ByteList.fromList(this.buffer);
                defer this.buffer = byte_list.listManaged(bun.default_allocator);

                _ = byte_list.writeUTF16(bun.default_allocator, buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };
            }

            if (had_buffered_data) {
                return .{ .pending = 0 };
            }

            return this._tryWriteNewlyBufferedData();
        }

        pub fn writeLatin1(this: *PosixWriter, buf: []const u8) WriteResult {
            if (this.is_done or this.closed_without_reporting) {
                return .{ .done = 0 };
            }

            if (bun.strings.isAllASCII(buf)) {
                return this.write(buf);
            }

            const had_buffered_data = this.buffer.items.len > 0;
            {
                var byte_list = bun.ByteList.fromList(this.buffer);
                defer this.buffer = byte_list.listManaged(bun.default_allocator);

                _ = byte_list.writeLatin1(bun.default_allocator, buf) catch {
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
                else => |r| return r,
            }
        }

        pub fn write(this: *PosixWriter, buf: []const u8) WriteResult {
            if (this.is_done or this.closed_without_reporting) {
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
                else => {},
            }

            return rc;
        }

        pub usingnamespace PosixPipeWriter(@This(), getFd, getBuffer, _onWrite, registerPoll, _onError, _onWritable);

        pub fn flush(this: *PosixWriter) WriteResult {
            if (this.closed_without_reporting or this.is_done) {
                return .{ .done = 0 };
            }
            return this.drainBufferedData(std.math.maxInt(usize), false);
        }

        pub fn deinit(this: *PosixWriter) void {
            this.buffer.clearAndFree();
            this.close();
        }

        pub fn hasRef(this: *PosixWriter) bool {
            const poll = this.getPoll() orelse return false;
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

        pub fn updateRef(this: *PosixWriter, event_loop: JSC.EventLoopHandle, value: bool) void {
            if (value) {
                this.enableKeepingProcessAlive(event_loop);
            } else {
                this.disableKeepingProcessAlive(event_loop);
            }
        }

        pub fn end(this: *PosixWriter) void {
            if (this.is_done) {
                return;
            }

            this.is_done = true;
            this.close();
        }

        pub fn close(this: *PosixWriter) void {
            if (this.closed_without_reporting) {
                this.closed_without_reporting = false;
                std.debug.assert(this.getFd() == bun.invalid_fd);
                onClose(@ptrCast(this.parent));
                return;
            }

            this.handle.close(@ptrCast(this.parent), onClose);
        }

        pub fn start(this: *PosixWriter, fd: bun.FileDescriptor, is_pollable: bool) JSC.Maybe(void) {
            if (!is_pollable) {
                this.close();
                this.handle = .{ .fd = fd };
                return JSC.Maybe(void){ .result = {} };
            }

            const loop = @as(*Parent, @ptrCast(this.parent)).eventLoop();
            var poll = this.getPoll() orelse brk: {
                this.handle = .{ .poll = Async.FilePoll.init(loop, fd, .{}, PosixWriter, this) };
                break :brk this.handle.poll;
            };

            poll.enableKeepingProcessAlive(loop);

            switch (poll.registerWithFd(loop.loop(), .writable, .dispatch, fd)) {
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
