const std = @import("std");
const assert = std.debug.assert;
const os = struct {
    pub usingnamespace std.os;
    pub const ETIME = 62;
    pub const EINTR = 4;
    pub const EAGAIN = 11;
    pub const EBADF = 9;
    pub const ECONNABORTED = 103;
    pub const EFAULT = 14;
    pub const EINVAL = 22;
    pub const EMFILE = 24;
    pub const ENFILE = 23;
    pub const ENOBUFS = 105;
    pub const ENOMEM = 12;
    pub const ENOTSOCK = 88;
    pub const EOPNOTSUPP = 95;
    pub const EPERM = 1;
    pub const EPROTO = 71;
    pub const EDQUOT = 69;
    pub const EIO = 5;
    pub const ENOSPC = 28;
    pub const EACCES = 13;
    pub const EADDRINUSE = 98;
    pub const EADDRNOTAVAIL = 99;
    pub const EAFNOSUPPORT = 97;
    pub const EINPROGRESS = 115;
    pub const EALREADY = 114;
    pub const ECONNREFUSED = 111;
    pub const ECONNRESET = 104;
    pub const EISCONN = 106;
    pub const ENETUNREACH = 101;
    pub const ENOENT = 2;
    pub const EPROTOTYPE = 91;
    pub const ETIMEDOUT = 110;
    pub const EROFS = 30;
    pub const EISDIR = 21;
    pub const ENXIO = 6;
    pub const EOVERFLOW = 84;
    pub const ESPIPE = 29;
    pub const ENOTCONN = 107;
    pub const EDESTADDRREQ = 89;
    pub const EMSGSIZE = 90;
    pub const EPIPE = 32;
    pub const ECANCELED = 125;
    pub const EFBIG = 27;
};
const timespec = std.os.system.timespec;
const linux = os.linux;
const IO_Uring = linux.IO_Uring;
const io_uring_cqe = linux.io_uring_cqe;
const io_uring_sqe = linux.io_uring_sqe;

const FIFO = @import("./fifo.zig").FIFO;
const IO = @This();

ring: IO_Uring,

/// Operations not yet submitted to the kernel and waiting on available space in the
/// submission queue.
unqueued: FIFO(Completion) = .{},

/// Completions that are ready to have their callbacks run.
completed: FIFO(Completion) = .{},

pub fn init(entries_: u12, flags: u32) !IO {
    var ring: IO_Uring = undefined;
    var entries = entries_;
    while (true) {
        ring = IO_Uring.init(entries, flags) catch |err| {
            if (err == error.SystemResources) {
                if (entries <= 8) return error.SystemResources;
                // We divide by 4 instead of 2
                // This way, a child process that uses io_uring can still function
                entries /= 4;
                continue;
            }

            return err;
        };
        break;
    }

    return IO{ .ring = ring };
}

pub fn deinit(self: *IO) void {
    self.ring.deinit();
}

/// Pass all queued submissions to the kernel and peek for completions.
pub fn tick(self: *IO) !void {
    // We assume that all timeouts submitted by `run_for_ns()` will be reaped by `run_for_ns()`
    // and that `tick()` and `run_for_ns()` cannot be run concurrently.
    // Therefore `timeouts` here will never be decremented and `etime` will always be false.
    var timeouts: usize = 0;
    var etime = false;

    try self.flush(0, &timeouts, &etime);
    assert(etime == false);

    // Flush any SQEs that were queued while running completion callbacks in `flush()`:
    // This is an optimization to avoid delaying submissions until the next tick.
    // At the same time, we do not flush any ready CQEs since SQEs may complete synchronously.
    // We guard against an io_uring_enter() syscall if we know we do not have any queued SQEs.
    // We cannot use `self.ring.sq_ready()` here since this counts flushed and unflushed SQEs.
    const queued = self.ring.sq.sqe_tail -% self.ring.sq.sqe_head;
    if (queued > 0) {
        try self.flush_submissions(0, &timeouts, &etime);
        assert(etime == false);
    }
}

/// Pass all queued submissions to the kernel and run for `nanoseconds`.
/// The `nanoseconds` argument is a u63 to allow coercion to the i64 used
/// in the timespec struct.
pub fn run_for_ns(self: *IO, nanoseconds: u63) !void {
    // We must use the same clock source used by io_uring (CLOCK_MONOTONIC) since we specify the
    // timeout below as an absolute value. Otherwise, we may deadlock if the clock sources are
    // dramatically different. Any kernel that supports io_uring will support CLOCK_MONOTONIC.
    var current_ts: timespec = undefined;
    os.clock_gettime(os.CLOCK_MONOTONIC, &current_ts) catch unreachable;
    // The absolute CLOCK_MONOTONIC time after which we may return from this function:
    const timeout_ts: timespec = .{
        .tv_sec = current_ts.tv_sec,
        .tv_nsec = current_ts.tv_nsec + nanoseconds,
    };
    var timeouts: usize = 0;
    var etime = false;
    while (!etime) {
        const timeout_sqe = self.ring.get_sqe() catch blk: {
            // The submission queue is full, so flush submissions to make space:
            try self.flush_submissions(0, &timeouts, &etime);
            break :blk self.ring.get_sqe() catch unreachable;
        };
        // Submit an absolute timeout that will be canceled if any other SQE completes first:
        linux.io_uring_prep_timeout(timeout_sqe, &timeout_ts, 1, os.IORING_TIMEOUT_ABS);
        timeout_sqe.user_data = 0;
        timeouts += 1;
        // The amount of time this call will block is bounded by the timeout we just submitted:
        try self.flush(1, &timeouts, &etime);
    }
    // Reap any remaining timeouts, which reference the timespec in the current stack frame.
    // The busy loop here is required to avoid a potential deadlock, as the kernel determines
    // when the timeouts are pushed to the completion queue, not us.
    while (timeouts > 0) _ = try self.flush_completions(0, &timeouts, &etime);
}

fn flush(self: *IO, wait_nr: u32, timeouts: *usize, etime: *bool) !void {
    // Flush any queued SQEs and reuse the same syscall to wait for completions if required:
    try self.flush_submissions(wait_nr, timeouts, etime);
    // We can now just peek for any CQEs without waiting and without another syscall:
    try self.flush_completions(0, timeouts, etime);
    // Run completions only after all completions have been flushed:
    // Loop on a copy of the linked list, having reset the list first, so that any synchronous
    // append on running a completion is executed only the next time round the event loop,
    // without creating an infinite loop.
    {
        var copy = self.completed;
        self.completed = .{};
        while (copy.pop()) |completion| completion.complete();
    }
    // Again, loop on a copy of the list to avoid an infinite loop:
    {
        var copy = self.unqueued;
        self.unqueued = .{};
        while (copy.pop()) |completion| self.enqueue(completion);
    }
}

fn flush_completions(self: *IO, wait_nr: u32, timeouts: *usize, etime: *bool) !void {
    var cqes: [256]io_uring_cqe = undefined;
    var wait_remaining = wait_nr;
    while (true) {
        // Guard against waiting indefinitely (if there are too few requests inflight),
        // especially if this is not the first time round the loop:
        const completed = self.ring.copy_cqes(&cqes, wait_remaining) catch |err| switch (err) {
            error.SignalInterrupt => continue,
            else => return err,
        };
        if (completed > wait_remaining) wait_remaining = 0 else wait_remaining -= completed;
        for (cqes[0..completed]) |cqe| {
            if (cqe.user_data == 0) {
                timeouts.* -= 1;
                // We are only done if the timeout submitted was completed due to time, not if
                // it was completed due to the completion of an event, in which case `cqe.res`
                // would be 0. It is possible for multiple timeout operations to complete at the
                // same time if the nanoseconds value passed to `run_for_ns()` is very short.
                if (-cqe.res == os.ETIME) etime.* = true;
                continue;
            }
            const completion = @intToPtr(*Completion, @intCast(usize, cqe.user_data));
            completion.result = cqe.res;
            // We do not run the completion here (instead appending to a linked list) to avoid:
            // * recursion through `flush_submissions()` and `flush_completions()`,
            // * unbounded stack usage, and
            // * confusing stack traces.
            self.completed.push(completion);
        }
        if (completed < cqes.len) break;
    }
}

fn flush_submissions(self: *IO, wait_nr: u32, timeouts: *usize, etime: *bool) !void {
    while (true) {
        _ = self.ring.submit_and_wait(wait_nr) catch |err| switch (err) {
            error.SignalInterrupt => continue,
            // Wait for some completions and then try again:
            // See https://github.com/axboe/liburing/issues/281 re: error.SystemResources.
            // Be careful also that copy_cqes() will flush before entering to wait (it does):
            // https://github.com/axboe/liburing/commit/35c199c48dfd54ad46b96e386882e7ac341314c5
            error.CompletionQueueOvercommitted, error.SystemResources => {
                try self.flush_completions(1, timeouts, etime);
                continue;
            },
            else => return err,
        };
        break;
    }
}

fn enqueue(self: *IO, completion: *Completion) void {
    const sqe = self.ring.get_sqe() catch |err| switch (err) {
        error.SubmissionQueueFull => {
            self.unqueued.push(completion);
            return;
        },
    };
    completion.prep(sqe);
}

/// This struct holds the data needed for a single io_uring operation
pub const Completion = struct {
    io: *IO,
    result: i32 = undefined,
    next: ?*Completion = null,
    operation: Operation,
    // This is one of the usecases for anyopaque outside of C code and as such anyopaque will
    // be replaced with anyopaque eventually: https://github.com/ziglang/zig/issues/323
    context: ?*anyopaque,
    callback: fn (context: ?*anyopaque, completion: *Completion, result: *const anyopaque) void,

    fn prep(completion: *Completion, sqe: *io_uring_sqe) void {
        switch (completion.operation) {
            .accept => |*op| {
                linux.io_uring_prep_accept(
                    sqe,
                    op.socket,
                    &op.address,
                    &op.address_size,
                    os.SOCK.CLOEXEC,
                );
            },
            .close => |op| {
                linux.io_uring_prep_close(sqe, op.fd);
            },
            .connect => |*op| {
                linux.io_uring_prep_connect(
                    sqe,
                    op.socket,
                    &op.address.any,
                    op.address.getOsSockLen(),
                );
            },
            .fsync => |op| {
                linux.io_uring_prep_fsync(sqe, op.fd, 0);
            },
            .read => |op| {
                linux.io_uring_prep_read(
                    sqe,
                    op.fd,
                    op.buffer[0..buffer_limit(op.buffer.len)],
                    op.offset,
                );
            },
            .recv => |op| {
                linux.io_uring_prep_recv(sqe, op.socket, op.buffer, os.MSG.NOSIGNAL);
            },
            .send => |op| {
                linux.io_uring_prep_send(sqe, op.socket, op.buffer, os.MSG.NOSIGNAL);
            },
            .timeout => |*op| {
                linux.io_uring_prep_timeout(sqe, &op.timespec, 0, 0);
            },
            .write => |op| {
                linux.io_uring_prep_write(
                    sqe,
                    op.fd,
                    op.buffer[0..buffer_limit(op.buffer.len)],
                    op.offset,
                );
            },
        }
        sqe.user_data = @ptrToInt(completion);
    }

    fn complete(completion: *Completion) void {
        switch (completion.operation) {
            .accept => {
                const result = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EAGAIN => error.WouldBlock,
                    os.EBADF => error.FileDescriptorInvalid,
                    os.ECONNABORTED => error.ConnectionAborted,
                    os.EFAULT => unreachable,
                    os.EINVAL => error.SocketNotListening,
                    os.EMFILE => error.ProcessFdQuotaExceeded,
                    os.ENFILE => error.SystemFdQuotaExceeded,
                    os.ENOBUFS => error.SystemResources,
                    os.ENOMEM => error.SystemResources,
                    os.ENOTSOCK => error.FileDescriptorNotASocket,
                    os.EOPNOTSUPP => error.OperationNotSupported,
                    os.EPERM => error.PermissionDenied,
                    os.EPROTO => error.ProtocolFailure,
                    else => error.Unexpected,
                } else @intCast(os.socket_t, completion.result);
                completion.callback(completion.context, completion, &result);
            },
            .close => {
                const result = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {}, // A success, see https://github.com/ziglang/zig/issues/2425
                    os.EBADF => error.FileDescriptorInvalid,
                    os.EDQUOT => error.DiskQuota,
                    os.EIO => error.InputOutput,
                    os.ENOSPC => error.NoSpaceLeft,
                    else => error.Unexpected,
                } else assert(completion.result == 0);
                completion.callback(completion.context, completion, &result);
            },
            .connect => {
                const result = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EACCES => error.AccessDenied,
                    os.EADDRINUSE => error.AddressInUse,
                    os.EADDRNOTAVAIL => error.AddressNotAvailable,
                    os.EAFNOSUPPORT => error.AddressFamilyNotSupported,
                    os.EAGAIN, os.EINPROGRESS => error.WouldBlock,
                    os.EALREADY => error.OpenAlreadyInProgress,
                    os.EBADF => error.FileDescriptorInvalid,
                    os.ECONNREFUSED => error.ConnectionRefused,
                    os.ECONNRESET => error.ConnectionResetByPeer,
                    os.EFAULT => unreachable,
                    os.EISCONN => error.AlreadyConnected,
                    os.ENETUNREACH => error.NetworkUnreachable,
                    os.ENOENT => error.FileNotFound,
                    os.ENOTSOCK => error.FileDescriptorNotASocket,
                    os.EPERM => error.PermissionDenied,
                    os.EPROTOTYPE => error.ProtocolNotSupported,
                    os.ETIMEDOUT => error.ConnectionTimedOut,
                    else => error.Unexpected,
                } else assert(completion.result == 0);
                completion.callback(completion.context, completion, &result);
            },
            .fsync => {
                const result = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EBADF => error.FileDescriptorInvalid,
                    os.EDQUOT => error.DiskQuota,
                    os.EINVAL => error.ArgumentsInvalid,
                    os.EIO => error.InputOutput,
                    os.ENOSPC => error.NoSpaceLeft,
                    os.EROFS => error.ReadOnlyFileSystem,
                    else => error.Unexpected,
                } else assert(completion.result == 0);
                completion.callback(completion.context, completion, &result);
            },
            .read => {
                const result = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EAGAIN => error.WouldBlock,
                    os.EBADF => error.NotOpenForReading,
                    os.ECONNRESET => error.ConnectionResetByPeer,
                    os.EFAULT => unreachable,
                    os.EINVAL => error.Alignment,
                    os.EIO => error.InputOutput,
                    os.EISDIR => error.IsDir,
                    os.ENOBUFS => error.SystemResources,
                    os.ENOMEM => error.SystemResources,
                    os.ENXIO => error.Unseekable,
                    os.EOVERFLOW => error.Unseekable,
                    os.ESPIPE => error.Unseekable,
                    else => error.Unexpected,
                } else @intCast(usize, completion.result);
                completion.callback(completion.context, completion, &result);
            },
            .recv => {
                const result = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EAGAIN => error.WouldBlock,
                    os.EBADF => error.FileDescriptorInvalid,
                    os.ECONNREFUSED => error.ConnectionRefused,
                    os.EFAULT => unreachable,
                    os.EINVAL => unreachable,
                    os.ENOMEM => error.SystemResources,
                    os.ENOTCONN => error.SocketNotConnected,
                    os.ENOTSOCK => error.FileDescriptorNotASocket,
                    os.ECONNRESET => error.ConnectionResetByPeer,
                    else => error.Unexpected,
                } else @intCast(usize, completion.result);
                completion.callback(completion.context, completion, &result);
            },
            .send => {
                const result = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EACCES => error.AccessDenied,
                    os.EAGAIN => error.WouldBlock,
                    os.EALREADY => error.FastOpenAlreadyInProgress,
                    os.EAFNOSUPPORT => error.AddressFamilyNotSupported,
                    os.EBADF => error.FileDescriptorInvalid,
                    os.ECONNRESET => error.ConnectionResetByPeer,
                    os.EDESTADDRREQ => unreachable,
                    os.EFAULT => unreachable,
                    os.EINVAL => unreachable,
                    os.EISCONN => unreachable,
                    os.EMSGSIZE => error.MessageTooBig,
                    os.ENOBUFS => error.SystemResources,
                    os.ENOMEM => error.SystemResources,
                    os.ENOTCONN => error.SocketNotConnected,
                    os.ENOTSOCK => error.FileDescriptorNotASocket,
                    os.EOPNOTSUPP => error.OperationNotSupported,
                    os.EPIPE => error.BrokenPipe,
                    else => error.Unexpected,
                } else @intCast(usize, completion.result);
                completion.callback(completion.context, completion, &result);
            },
            .timeout => {
                const result = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.ECANCELED => error.Canceled,
                    os.ETIME => {}, // A success.
                    else => error.Unexpected,
                } else unreachable;
                completion.callback(completion.context, completion, &result);
            },
            .write => {
                const result = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EAGAIN => error.WouldBlock,
                    os.EBADF => error.NotOpenForWriting,
                    os.EDESTADDRREQ => error.NotConnected,
                    os.EDQUOT => error.DiskQuota,
                    os.EFAULT => unreachable,
                    os.EFBIG => error.FileTooBig,
                    os.EINVAL => error.Alignment,
                    os.EIO => error.InputOutput,
                    os.ENOSPC => error.NoSpaceLeft,
                    os.ENXIO => error.Unseekable,
                    os.EOVERFLOW => error.Unseekable,
                    os.EPERM => error.AccessDenied,
                    os.EPIPE => error.BrokenPipe,
                    os.ESPIPE => error.Unseekable,
                    else => error.Unexpected,
                } else @intCast(usize, completion.result);
                completion.callback(completion.context, completion, &result);
            },
        }
    }
};

/// This union encodes the set of operations supported as well as their arguments.
const Operation = union(enum) {
    accept: struct {
        socket: os.socket_t,
        address: os.sockaddr = undefined,
        address_size: os.socklen_t = @sizeOf(os.sockaddr),
    },
    close: struct {
        fd: os.fd_t,
    },
    connect: struct {
        socket: os.socket_t,
        address: std.net.Address,
    },
    fsync: struct {
        fd: os.fd_t,
    },
    read: struct {
        fd: os.fd_t,
        buffer: []u8,
        offset: u64,
    },
    recv: struct {
        socket: os.socket_t,
        buffer: []u8,
    },
    send: struct {
        socket: os.socket_t,
        buffer: []const u8,
    },
    timeout: struct {
        timespec: os.timespec,
    },
    write: struct {
        fd: os.fd_t,
        buffer: []const u8,
        offset: u64,
    },
};

pub const AcceptError = error{
    WouldBlock,
    FileDescriptorInvalid,
    ConnectionAborted,
    SocketNotListening,
    ProcessFdQuotaExceeded,
    SystemFdQuotaExceeded,
    SystemResources,
    FileDescriptorNotASocket,
    OperationNotSupported,
    PermissionDenied,
    ProtocolFailure,
} || os.UnexpectedError;

pub fn accept(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: fn (
        context: Context,
        completion: *Completion,
        result: AcceptError!os.socket_t,
    ) void,
    completion: *Completion,
    socket: os.socket_t,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @intToPtr(Context, @ptrToInt(ctx)),
                    comp,
                    @intToPtr(*const AcceptError!os.socket_t, @ptrToInt(res)).*,
                );
            }
        }.wrapper,
        .operation = .{
            .accept = .{
                .socket = socket,
                .address = undefined,
                .address_size = @sizeOf(os.sockaddr),
            },
        },
    };
    self.enqueue(completion);
}

pub const CloseError = error{
    FileDescriptorInvalid,
    DiskQuota,
    InputOutput,
    NoSpaceLeft,
} || os.UnexpectedError;

pub fn close(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: fn (
        context: Context,
        completion: *Completion,
        result: CloseError!void,
    ) void,
    completion: *Completion,
    fd: os.fd_t,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @intToPtr(Context, @ptrToInt(ctx)),
                    comp,
                    @intToPtr(*const CloseError!void, @ptrToInt(res)).*,
                );
            }
        }.wrapper,
        .operation = .{
            .close = .{ .fd = fd },
        },
    };
    self.enqueue(completion);
}

pub const ConnectError = error{
    AccessDenied,
    AddressInUse,
    AddressNotAvailable,
    AddressFamilyNotSupported,
    WouldBlock,
    OpenAlreadyInProgress,
    FileDescriptorInvalid,
    ConnectionRefused,
    AlreadyConnected,
    NetworkUnreachable,
    FileNotFound,
    FileDescriptorNotASocket,
    PermissionDenied,
    ProtocolNotSupported,
    ConnectionTimedOut,
} || os.UnexpectedError;

pub fn connect(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: fn (
        context: Context,
        completion: *Completion,
        result: ConnectError!void,
    ) void,
    completion: *Completion,
    socket: os.socket_t,
    address: std.net.Address,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @intToPtr(Context, @ptrToInt(ctx)),
                    comp,
                    @intToPtr(*const ConnectError!void, @ptrToInt(res)).*,
                );
            }
        }.wrapper,
        .operation = .{
            .connect = .{
                .socket = socket,
                .address = address,
            },
        },
    };
    self.enqueue(completion);
}

pub const FsyncError = error{
    FileDescriptorInvalid,
    DiskQuota,
    ArgumentsInvalid,
    InputOutput,
    NoSpaceLeft,
    ReadOnlyFileSystem,
} || os.UnexpectedError;

pub fn fsync(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: fn (
        context: Context,
        completion: *Completion,
        result: FsyncError!void,
    ) void,
    completion: *Completion,
    fd: os.fd_t,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @intToPtr(Context, @ptrToInt(ctx)),
                    comp,
                    @intToPtr(*const FsyncError!void, @ptrToInt(res)).*,
                );
            }
        }.wrapper,
        .operation = .{
            .fsync = .{
                .fd = fd,
            },
        },
    };
    self.enqueue(completion);
}

pub const ReadError = error{
    WouldBlock,
    NotOpenForReading,
    ConnectionResetByPeer,
    Alignment,
    InputOutput,
    IsDir,
    SystemResources,
    Unseekable,
} || os.UnexpectedError;

pub fn read(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: fn (
        context: Context,
        completion: *Completion,
        result: ReadError!usize,
    ) void,
    completion: *Completion,
    fd: os.fd_t,
    buffer: []u8,
    offset: u64,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @intToPtr(Context, @ptrToInt(ctx)),
                    comp,
                    @intToPtr(*const ReadError!usize, @ptrToInt(res)).*,
                );
            }
        }.wrapper,
        .operation = .{
            .read = .{
                .fd = fd,
                .buffer = buffer,
                .offset = offset,
            },
        },
    };
    self.enqueue(completion);
}

pub const RecvError = error{
    WouldBlock,
    FileDescriptorInvalid,
    ConnectionRefused,
    SystemResources,
    SocketNotConnected,
    FileDescriptorNotASocket,
} || os.UnexpectedError;

pub fn recv(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: fn (
        context: Context,
        completion: *Completion,
        result: RecvError!usize,
    ) void,
    completion: *Completion,
    socket: os.socket_t,
    buffer: []u8,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @intToPtr(Context, @ptrToInt(ctx)),
                    comp,
                    @intToPtr(*const RecvError!usize, @ptrToInt(res)).*,
                );
            }
        }.wrapper,
        .operation = .{
            .recv = .{
                .socket = socket,
                .buffer = buffer,
            },
        },
    };
    self.enqueue(completion);
}

pub const SendError = error{
    AccessDenied,
    WouldBlock,
    FastOpenAlreadyInProgress,
    AddressFamilyNotSupported,
    FileDescriptorInvalid,
    ConnectionResetByPeer,
    MessageTooBig,
    SystemResources,
    SocketNotConnected,
    FileDescriptorNotASocket,
    OperationNotSupported,
    BrokenPipe,
} || os.UnexpectedError;

pub fn send(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: fn (
        context: Context,
        completion: *Completion,
        result: SendError!usize,
    ) void,
    completion: *Completion,
    socket: os.socket_t,
    buffer: []const u8,
    _: u32,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @intToPtr(Context, @ptrToInt(ctx)),
                    comp,
                    @intToPtr(*const SendError!usize, @ptrToInt(res)).*,
                );
            }
        }.wrapper,
        .operation = .{
            .send = .{
                .socket = socket,
                .buffer = buffer,
            },
        },
    };
    self.enqueue(completion);
}

pub const TimeoutError = error{Canceled} || os.UnexpectedError;

pub fn timeout(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: fn (
        context: Context,
        completion: *Completion,
        result: TimeoutError!void,
    ) void,
    completion: *Completion,
    nanoseconds: u63,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @intToPtr(Context, @ptrToInt(ctx)),
                    comp,
                    @intToPtr(*const TimeoutError!void, @ptrToInt(res)).*,
                );
            }
        }.wrapper,
        .operation = .{
            .timeout = .{
                .timespec = .{ .tv_sec = 0, .tv_nsec = nanoseconds },
            },
        },
    };
    self.enqueue(completion);
}

pub const WriteError = error{
    WouldBlock,
    NotOpenForWriting,
    NotConnected,
    DiskQuota,
    FileTooBig,
    Alignment,
    InputOutput,
    NoSpaceLeft,
    Unseekable,
    AccessDenied,
    BrokenPipe,
} || os.UnexpectedError;

pub fn write(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: fn (
        context: Context,
        completion: *Completion,
        result: WriteError!usize,
    ) void,
    completion: *Completion,
    fd: os.fd_t,
    buffer: []const u8,
    offset: u64,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @intToPtr(Context, @ptrToInt(ctx)),
                    comp,
                    @intToPtr(*const WriteError!usize, @ptrToInt(res)).*,
                );
            }
        }.wrapper,
        .operation = .{
            .write = .{
                .fd = fd,
                .buffer = buffer,
                .offset = offset,
            },
        },
    };
    self.enqueue(completion);
}

pub fn openSocket(family: u32, sock_type: u32, protocol: u32) !os.socket_t {
    return os.socket(family, sock_type, protocol);
}

pub var global: IO = undefined;
pub var global_loaded: bool = false;

fn buffer_limit(buffer_len: usize) usize {

    // Linux limits how much may be written in a `pwrite()/pread()` call, which is `0x7ffff000` on
    // both 64-bit and 32-bit systems, due to using a signed C int as the return value, as well as
    // stuffing the errno codes into the last `4096` values.
    // Darwin limits writes to `0x7fffffff` bytes, more than that returns `EINVAL`.
    // The corresponding POSIX limit is `std.math.maxInt(isize)`.
    const limit = switch (@import("builtin").target.os.tag) {
        .linux => 0x7ffff000,
        .macos, .ios, .watchos, .tvos => std.math.maxInt(i32),
        else => std.math.maxInt(isize),
    };
    return std.math.min(limit, buffer_len);
}
