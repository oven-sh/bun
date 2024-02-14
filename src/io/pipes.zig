const Async = @import("root").bun.Async;
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

    pub fn close(this: *PollOrFd, ctx: ?*anyopaque, comptime onCloseFn: anytype) void {
        const fd = this.getFd();
        if (this.* == .poll) {
            this.poll.deinitForceUnregister();
            this.* = .{ .closed = {} };
        }

        if (fd != bun.invalid_fd) {
            this.* = .{ .closed = {} };

            //TODO: We should make this call compatible using bun.FileDescriptor
            if (Environment.isWindows) {
                bun.Async.Closer.close(bun.uvfdcast(fd), bun.windows.libuv.Loop.get());
            } else {
                bun.Async.Closer.close(fd, {});
            }
            if (comptime @TypeOf(onCloseFn) != void)
                onCloseFn(@alignCast(@ptrCast(ctx.?)));
        } else {
            this.* = .{ .closed = {} };
        }
    }
};

pub const FileType = enum {
    file,
    pipe,
    nonblocking_pipe,

    pub fn isPollable(this: FileType) bool {
        return this == .pipe or this == .nonblocking_pipe;
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
