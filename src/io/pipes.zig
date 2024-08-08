const Async = bun.Async;
const bun = @import("root").bun;
const Environment = bun.Environment;

pub const PollOrFd = union(enum) {
    /// When it's a pipe/fifo
    poll: *Async.FilePoll,

    fd: bun.FileDescriptor,
    closed: void,

    pub fn setOwner(this: *const PollOrFd, owner: anytype) void {
        if (this.* == .poll) {
            this.poll.owner.set(owner);
        }
    }

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

    pub fn closeImpl(this: *PollOrFd, ctx: ?*anyopaque, comptime onCloseFn: anytype, close_fd: bool) void {
        const fd = this.getFd();
        var close_async = true;
        if (this.* == .poll) {
            // workaround kqueue bug.
            // 1) non-blocking FIFO
            // 2) open for writing only = fd 2, nonblock
            // 3) open for reading only = fd 3, nonblock
            // 4) write(3, "something") = 9
            // 5) read(2, buf, 9) = 9
            // 6) read(2, buf, 9) = -1 (EAGAIN)
            // 7) ON ANOTHER THREAD: close(3) = 0,
            // 8) kevent(2, EVFILT_READ, EV_ADD | EV_ENABLE | EV_DISPATCH, 0, 0, 0) = 0
            // 9) ??? No more events for fd 2
            if (comptime Environment.isMac) {
                if (this.poll.flags.contains(.poll_writable) and this.poll.flags.contains(.nonblocking)) {
                    close_async = false;
                }
            }
            this.poll.deinitForceUnregister();
            this.* = .{ .closed = {} };
        }

        if (fd != bun.invalid_fd) {
            this.* = .{ .closed = {} };

            //TODO: We should make this call compatible using bun.FileDescriptor
            if (Environment.isWindows) {
                bun.Async.Closer.close(bun.uvfdcast(fd), bun.windows.libuv.Loop.get());
            } else if (close_async and close_fd) {
                bun.Async.Closer.close(fd, {});
            } else {
                if (close_fd) _ = bun.sys.close(fd);
            }
            if (comptime @TypeOf(onCloseFn) != void)
                onCloseFn(@alignCast(@ptrCast(ctx.?)));
        } else {
            this.* = .{ .closed = {} };
        }
    }

    pub fn close(this: *PollOrFd, ctx: ?*anyopaque, comptime onCloseFn: anytype) void {
        this.closeImpl(ctx, onCloseFn, true);
    }
};

pub const FileType = enum {
    file,
    pipe,
    nonblocking_pipe,
    socket,

    pub fn isPollable(this: FileType) bool {
        return this == .pipe or this == .nonblocking_pipe or this == .socket;
    }

    pub fn isBlocking(this: FileType) bool {
        return this == .pipe;
    }
};

pub const ReadState = enum {
    /// The most common scenario
    /// Neither EOF nor EAGAIN
    progress,

    /// Received a 0-byte read
    eof,

    /// Received an EAGAIN
    drained,
};
