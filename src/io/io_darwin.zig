const std = @import("std");
const os = struct {
    pub usingnamespace std.os;
    pub const EINTR = 4;
    pub const EAGAIN = 35;
    pub const EBADF = 9;
    pub const ECONNRESET = 54;
    pub const EFAULT = 14;
    pub const EINVAL = 22;
    pub const EIO = 5;
    pub const EISDIR = 21;
    pub const ENOBUFS = 55;
    pub const ENOMEM = 12;
    pub const ENXIO = 6;
    pub const EOVERFLOW = 84;
    pub const ESPIPE = 29;
};
const mem = std.mem;
const assert = std.debug.assert;

const FIFO = @import("./fifo.zig").FIFO;
const Time = @import("./time.zig").Time;

const IO = @This();

kq: os.fd_t,
time: Time = .{},
io_inflight: usize = 0,
timeouts: FIFO(Completion) = .{},
completed: FIFO(Completion) = .{},
io_pending: FIFO(Completion) = .{},
last_event_fd: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(32),

pub fn init(_: u12, _: u32) !IO {
    const kq = try os.kqueue();
    assert(kq > -1);
    return IO{ .kq = kq };
}

pub fn deinit(self: *IO) void {
    assert(self.kq > -1);
    os.close(self.kq);
    self.kq = -1;
}

/// Pass all queued submissions to the kernel and peek for completions.
pub fn tick(self: *IO) !void {
    return self.flush(false);
}

/// Pass all queued submissions to the kernel and run for `nanoseconds`.
/// The `nanoseconds` argument is a u63 to allow coercion to the i64 used
/// in the __kernel_timespec struct.
pub fn run_for_ns(self: *IO, nanoseconds: u63) !void {
    var timed_out = false;
    var completion: Completion = undefined;
    const on_timeout = struct {
        fn callback(
            timed_out_ptr: *bool,
            _completion: *Completion,
            _result: TimeoutError!void,
        ) void {
            timed_out_ptr.* = true;
        }
    }.callback;

    // Submit a timeout which sets the timed_out value to true to terminate the loop below.
    self.timeout(
        *bool,
        &timed_out,
        on_timeout,
        &completion,
        nanoseconds,
    );

    // Loop until our timeout completion is processed above, which sets timed_out to true.
    // LLVM shouldn't be able to cache timed_out's value here since its address escapes above.
    while (!timed_out) {
        try self.flush(true);
    }
}

fn flush(self: *IO, wait_for_completions: bool) !void {
    var io_pending = self.io_pending.peek();
    var events: [256]os.Kevent = undefined;

    // Check timeouts and fill events with completions in io_pending
    // (they will be submitted through kevent).
    // Timeouts are expired here and possibly pushed to the completed queue.
    const next_timeout = self.flush_timeouts();
    const change_events = self.flush_io(&events, &io_pending);

    // Only call kevent() if we need to submit io events or if we need to wait for completions.
    if (change_events > 0 or self.completed.peek() == null) {
        // Zero timeouts for kevent() implies a non-blocking poll
        var ts = std.mem.zeroes(os.timespec);

        // We need to wait (not poll) on kevent if there's nothing to submit or complete.
        // We should never wait indefinitely (timeout_ptr = null for kevent) given:
        // - tick() is non-blocking (wait_for_completions = false)
        // - run_for_ns() always submits a timeout
        if (change_events == 0 and self.completed.peek() == null) {
            if (wait_for_completions) {
                const timeout_ns = next_timeout orelse @panic("kevent() blocking forever");
                ts.tv_nsec = @intCast(@TypeOf(ts.tv_nsec), timeout_ns % std.time.ns_per_s);
                ts.tv_sec = @intCast(@TypeOf(ts.tv_sec), timeout_ns / std.time.ns_per_s);
            } else if (self.io_inflight == 0) {
                return;
            }
        }

        const new_events = try os.kevent(
            self.kq,
            events[0..change_events],
            events[0..events.len],
            &ts,
        );

        // Mark the io events submitted only after kevent() successfully processed them
        self.io_pending.out = io_pending;
        if (io_pending == null) {
            self.io_pending.in = null;
        }

        self.io_inflight += change_events;
        self.io_inflight -= new_events;

        for (events[0..new_events]) |kevent| {
            const completion = @intToPtr(*Completion, kevent.udata);
            completion.next = null;
            self.completed.push(completion);
        }
    }

    var completed = self.completed;
    self.completed = .{};
    while (completed.pop()) |completion| {
        (completion.callback)(self, completion);
    }
}

fn flush_io(self: *IO, events: []os.Kevent, io_pending_top: *?*Completion) usize {
    for (events) |*kevent, flushed| {
        const completion = io_pending_top.* orelse return flushed;
        io_pending_top.* = completion.next;

        const event_info = switch (completion.operation) {
            .accept => |op| [3]c_int{
                op.socket,
                os.EVFILT_READ,
                os.EV_ADD | os.EV_ENABLE | os.EV_ONESHOT,
            },
            .connect => |op| [3]c_int{
                op.socket,
                os.EVFILT_WRITE,
                os.EV_ADD | os.EV_ENABLE | os.EV_ONESHOT,
            },
            .read => |op| [3]c_int{
                op.fd,
                os.EVFILT_READ,
                os.EV_ADD | os.EV_ENABLE | os.EV_ONESHOT,
            },
            .write => |op| [3]c_int{
                op.fd,
                os.EVFILT_WRITE,
                os.EV_ADD | os.EV_ENABLE | os.EV_ONESHOT,
            },
            .recv => |op| [3]c_int{
                op.socket,
                os.EVFILT_READ,
                os.EV_ADD | os.EV_ENABLE | os.EV_ONESHOT,
            },
            .send => |op| [3]c_int{
                op.socket,
                os.EVFILT_WRITE,
                os.EV_ADD | os.EV_ENABLE | os.EV_ONESHOT,
            },
            .event => |op| [3]c_int{
                op.fd,
                os.EVFILT_USER,
                os.EV_ADD | os.EV_ENABLE | os.EV_ONESHOT,
            },
            else => @panic("invalid completion operation queued for io"),
        };

        kevent.* = .{
            .ident = @intCast(u32, event_info[0]),
            .filter = @intCast(i16, event_info[1]),
            .flags = @intCast(u16, event_info[2]),
            .fflags = 0,
            .data = 0,
            .udata = @ptrToInt(completion),
        };
    }

    return events.len;
}

fn flush_timeouts(self: *IO) ?u64 {
    var min_timeout: ?u64 = null;
    var timeouts: ?*Completion = self.timeouts.peek();
    while (timeouts) |completion| {
        timeouts = completion.next;

        // NOTE: We could cache `now` above the loop but monotonic() should be cheap to call.
        const now = self.time.monotonic();
        const expires = completion.operation.timeout.expires;

        // NOTE: remove() could be O(1) here with a doubly-linked-list
        // since we know the previous Completion.
        if (now >= expires) {
            self.timeouts.remove(completion);
            self.completed.push(completion);
            continue;
        }

        const timeout_ns = expires - now;
        if (min_timeout) |min_ns| {
            min_timeout = std.math.min(min_ns, timeout_ns);
        } else {
            min_timeout = timeout_ns;
        }
    }
    return min_timeout;
}

/// This struct holds the data needed for a single IO operation
pub const Completion = struct {
    next: ?*Completion,
    context: ?*c_void,
    callback: fn (*IO, *Completion) void,
    operation: Operation,
};

const Operation = union(enum) {
    accept: struct {
        socket: os.socket_t,
    },
    close: struct {
        fd: os.fd_t,
    },
    connect: struct {
        socket: os.socket_t,
        address: std.net.Address,
        initiated: bool,
    },
    fsync: struct {
        fd: os.fd_t,
    },
    read: struct {
        fd: os.fd_t,
        buf: [*]u8,
        len: u32,
        offset: u64,
    },
    recv: struct {
        socket: os.socket_t,
        buf: [*]u8,
        len: u32,
    },
    send: struct {
        socket: os.socket_t,
        buf: [*]const u8,
        len: u32,
        flags: u32 = 0,
    },
    timeout: struct {
        expires: u64,
    },
    write: struct {
        fd: os.fd_t,
        buf: [*]const u8,
        len: u32,
        offset: u64,
    },
    event: struct {
        fd: os.fd_t,
    },
};

fn submit(
    self: *IO,
    context: anytype,
    comptime callback: anytype,
    completion: *Completion,
    comptime operation_tag: std.meta.Tag(Operation),
    operation_data: anytype,
    comptime OperationImpl: type,
) void {
    const Context = @TypeOf(context);
    const onCompleteFn = struct {
        fn onComplete(io: *IO, _completion: *Completion) void {
            // Perform the actual operaton
            const op_data = &@field(_completion.operation, @tagName(operation_tag));
            const result = OperationImpl.doOperation(op_data);

            // Requeue onto io_pending if error.WouldBlock
            switch (operation_tag) {
                .accept, .connect, .read, .write, .send, .recv => {
                    _ = result catch |err| switch (err) {
                        error.WouldBlock => {
                            _completion.next = null;
                            io.io_pending.push(_completion);
                            return;
                        },
                        else => {},
                    };
                },
                else => {},
            }

            // Complete the Completion
            return callback(
                @intToPtr(Context, @ptrToInt(_completion.context)),
                _completion,
                result,
            );
        }
    }.onComplete;

    completion.* = .{
        .next = null,
        .context = context,
        .callback = onCompleteFn,
        .operation = @unionInit(Operation, @tagName(operation_tag), operation_data),
    };

    switch (operation_tag) {
        .timeout => self.timeouts.push(completion),
        else => self.completed.push(completion),
    }
}

pub const AcceptError = os.AcceptError || os.SetSockOptError;

// -- NOT DONE YET
pub fn eventfd(self: *IO) os.fd_t {
    return @intCast(os.fd_t, self.last_event_fd.fetchAdd(1, .Monotonic));
}

pub fn triggerEvent(event_fd: os.fd_t, completion: *Completion) !void {
    var kevents = [1]os.Kevent{
        .{
            .ident = @intCast(usize, event_fd),
            .filter = os.EVFILT_USER,
            .flags = os.EV_ADD | os.EV_ENABLE | os.EV_ONESHOT,
            .fflags = 0,
            .data = 0,
            .udata = @ptrToInt(completion),
        },
    };

    var change_events = [1]os.Kevent{
        .{
            .ident = @intCast(usize, event_fd),
            .filter = os.EVFILT_USER,
            .flags = os.EV_ADD | os.EV_ENABLE | os.EV_ONESHOT,
            .fflags = 0,
            .data = 0,
            .udata = @ptrToInt(completion),
        },
    };

    const ret = try os.kevent(global.kq, &kevents, &change_events, null);
    if (ret != 1) {
        @panic("failed to trigger event");
    }
}

// -- NOT DONE YET
pub fn event(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: fn (
        context: Context,
        completion: *Completion,
        result: void,
    ) void,
    completion: *Completion,
    fd: os.fd_t,
) void {
    self.submit(
        context,
        callback,
        completion,
        .event,
        .{
            .fd = fd,
        },
        struct {
            fn doOperation(op: anytype) void {}
        },
    );
}

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
    self.submit(
        context,
        callback,
        completion,
        .accept,
        .{
            .socket = socket,
        },
        struct {
            fn doOperation(op: anytype) AcceptError!os.socket_t {
                const fd = try os.accept(
                    op.socket,
                    null,
                    null,
                    os.SOCK_NONBLOCK | os.SOCK_CLOEXEC,
                );
                errdefer os.close(fd);

                // darwin doesn't support os.MSG_NOSIGNAL,
                // but instead a socket option to avoid SIGPIPE.
                os.setsockopt(fd, os.SOL_SOCKET, os.SO_NOSIGPIPE, &mem.toBytes(@as(c_int, 1))) catch |err| return switch (err) {
                    error.TimeoutTooBig => unreachable,
                    error.PermissionDenied => error.NetworkSubsystemFailed,
                    error.AlreadyConnected => error.NetworkSubsystemFailed,
                    error.InvalidProtocolOption => error.ProtocolFailure,
                    else => |e| e,
                };

                return fd;
            }
        },
    );
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
    self.submit(
        context,
        callback,
        completion,
        .close,
        .{
            .fd = fd,
        },
        struct {
            fn doOperation(op: anytype) CloseError!void {
                return switch (os.system.close(op.fd)) {
                    0 => {},
                    os.EBADF => error.FileDescriptorInvalid,
                    os.EINTR => {}, // A success, see https://github.com/ziglang/zig/issues/2425
                    os.EIO => error.InputOutput,
                    else => |errno| os.unexpectedErrno(os.errno(errno)),
                };
            }
        },
    );
}

pub const ConnectError = os.ConnectError;

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
    self.submit(
        context,
        callback,
        completion,
        .connect,
        .{
            .socket = socket,
            .address = address,
            .initiated = false,
        },
        struct {
            fn doOperation(op: anytype) ConnectError!void {
                // Don't call connect after being rescheduled by io_pending as it gives EISCONN.
                // Instead, check the socket error to see if has been connected successfully.
                const result = switch (op.initiated) {
                    true => os.getsockoptError(op.socket),
                    else => os.connect(op.socket, &op.address.any, op.address.getOsSockLen()),
                };

                op.initiated = true;
                return result;
            }
        },
    );
}

pub const FsyncError = os.SyncError;

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
    self.submit(
        context,
        callback,
        completion,
        .fsync,
        .{
            .fd = fd,
        },
        struct {
            fn doOperation(op: anytype) FsyncError!void {
                _ = os.fcntl(op.fd, os.F_FULLFSYNC, 1) catch return os.fsync(op.fd);
            }
        },
    );
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
    self.submit(
        context,
        callback,
        completion,
        .read,
        .{
            .fd = fd,
            .buf = buffer.ptr,
            .len = @intCast(u32, buffer_limit(buffer.len)),
            .offset = offset,
        },
        struct {
            fn doOperation(op: anytype) ReadError!usize {
                while (true) {
                    const rc = os.system.pread(
                        op.fd,
                        op.buf,
                        op.len,
                        @bitCast(isize, op.offset),
                    );
                    return switch (@enumToInt(os.errno(rc))) {
                        0 => @intCast(usize, rc),
                        os.EINTR => continue,
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
                    };
                }
            }
        },
    );
}

pub const RecvError = os.RecvFromError;

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
    self.submit(
        context,
        callback,
        completion,
        .recv,
        .{
            .socket = socket,
            .buf = buffer.ptr,
            .len = @intCast(u32, buffer_limit(buffer.len)),
        },
        struct {
            fn doOperation(op: anytype) RecvError!usize {
                return os.recv(op.socket, op.buf[0..op.len], 0);
            }
        },
    );
}

pub const SendError = os.SendToError;

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
    self.submit(
        context,
        callback,
        completion,
        .send,
        .{
            .socket = socket,
            .buf = buffer.ptr,
            .len = @intCast(u32, buffer_limit(buffer.len)),
            .flags = 0,
        },
        struct {
            fn doOperation(op: anytype) SendError!usize {
                return os.sendto(op.socket, op.buf[0..op.len], op.flags, null, 0);
            }
        },
    );
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
    self.submit(
        context,
        callback,
        completion,
        .timeout,
        .{
            .expires = self.time.monotonic() + nanoseconds,
        },
        struct {
            fn doOperation(_: anytype) TimeoutError!void {
                return; // timeouts don't have errors for now
            }
        },
    );
}

pub const WriteError = os.PWriteError;

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
    self.submit(
        context,
        callback,
        completion,
        .write,
        .{
            .fd = fd,
            .buf = buffer.ptr,
            .len = @intCast(u32, buffer_limit(buffer.len)),
            .offset = offset,
        },
        struct {
            fn doOperation(op: anytype) WriteError!usize {
                return os.pwrite(op.fd, op.buf[0..op.len], op.offset);
            }
        },
    );
}

pub fn openSocket(family: u32, sock_type: u32, protocol: u32) !os.socket_t {
    const fd = try os.socket(family, sock_type | os.SOCK_NONBLOCK, protocol);
    errdefer os.close(fd);

    // darwin doesn't support os.MSG_NOSIGNAL, but instead a socket option to avoid SIGPIPE.
    try os.setsockopt(fd, os.SOL_SOCKET, os.SO_NOSIGPIPE, &mem.toBytes(@as(c_int, 1)));
    return fd;
}

fn buffer_limit(buffer_len: usize) usize {

    // Linux limits how much may be written in a `pwrite()/pread()` call, which is `0x7ffff000` on
    // both 64-bit and 32-bit systems, due to using a signed C int as the return value, as well as
    // stuffing the errno codes into the last `4096` values.
    // Darwin limits writes to `0x7fffffff` bytes, more than that returns `EINVAL`.
    // The corresponding POSIX limit is `std.math.maxInt(isize)`.
    const limit = switch (std.Target.current.os.tag) {
        .linux => 0x7ffff000,
        .macos, .ios, .watchos, .tvos => std.math.maxInt(i32),
        else => std.math.maxInt(isize),
    };
    return std.math.min(limit, buffer_len);
}

pub var global: IO = undefined;
pub var global_loaded: bool = false;
