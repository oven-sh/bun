/// Thanks to Tigerbeetle - https://github.com/tigerbeetle/tigerbeetle/blob/532c8b70b9142c17e07737ab6d3da68d7500cbca/src/io/windows.zig#L1
/// Apache2 license - https://github.com/tigerbeetle/tigerbeetle/blob/532c8b70b9142c17e07737ab6d3da68d7500cbca/LICENSE
const std = @import("std");
const os = std.os;
const assert = std.debug.assert;
const log = std.log.scoped(.io);
const bun = @import("root").bun;
const FIFO = @import("./fifo.zig").FIFO;
const windows = bun.windows;

const Time = struct {
    const Self = @This();

    /// Hardware and/or software bugs can mean that the monotonic clock may regress.
    /// One example (of many): https://bugzilla.redhat.com/show_bug.cgi?id=448449
    /// We crash the process for safety if this ever happens, to protect against infinite loops.
    /// It's better to crash and come back with a valid monotonic clock than get stuck forever.
    monotonic_guard: u64 = 0,

    /// A timestamp to measure elapsed time, meaningful only on the same system, not across reboots.
    /// Always use a monotonic timestamp if the goal is to measure elapsed time.
    /// This clock is not affected by discontinuous jumps in the system time, for example if the
    /// system administrator manually changes the clock.
    pub fn monotonic(self: *Self) u64 {
        const m = blk: {
            // Uses QueryPerformanceCounter() on windows due to it being the highest precision timer
            // available while also accounting for time spent suspended by default:
            // https://docs.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-queryunbiasedinterrupttime#remarks

            // QPF need not be globally cached either as it ends up being a load from read-only
            // memory mapped to all processed by the kernel called KUSER_SHARED_DATA (See "QpcFrequency")
            // https://docs.microsoft.com/en-us/windows-hardware/drivers/ddi/ntddk/ns-ntddk-kuser_shared_data
            // https://www.geoffchappell.com/studies/windows/km/ntoskrnl/inc/api/ntexapi_x/kuser_shared_data/index.htm
            const qpc = os.windows.QueryPerformanceCounter();
            const qpf = os.windows.QueryPerformanceFrequency();

            // 10Mhz (1 qpc tick every 100ns) is a common QPF on modern systems.
            // We can optimize towards this by converting to ns via a single multiply.
            // https://github.com/microsoft/STL/blob/785143a0c73f030238ef618890fd4d6ae2b3a3a0/stl/inc/chrono#L694-L701
            const common_qpf = 10_000_000;
            if (qpf == common_qpf) break :blk qpc * (std.time.ns_per_s / common_qpf);

            // Convert qpc to nanos using fixed point to avoid expensive extra divs and overflow.
            const scale = (std.time.ns_per_s << 32) / qpf;
            break :blk @as(u64, @truncate((@as(u96, qpc) * scale) >> 32));
        };

        // "Oops!...I Did It Again"
        if (m < self.monotonic_guard) @panic("a hardware/kernel bug regressed the monotonic clock");
        self.monotonic_guard = m;
        return m;
    }

    /// A timestamp to measure real (i.e. wall clock) time, meaningful across systems, and reboots.
    /// This clock is affected by discontinuous jumps in the system time.
    pub fn realtime(_: *Self) i64 {
        const kernel32 = struct {
            extern "kernel32" fn GetSystemTimePreciseAsFileTime(
                lpFileTime: *os.windows.FILETIME,
            ) callconv(os.windows.WINAPI) void;
        };

        var ft: os.windows.FILETIME = undefined;
        kernel32.GetSystemTimePreciseAsFileTime(&ft);
        const ft64 = (@as(u64, ft.dwHighDateTime) << 32) | ft.dwLowDateTime;

        // FileTime is in units of 100 nanoseconds
        // and uses the NTFS/Windows epoch of 1601-01-01 instead of Unix Epoch 1970-01-01.
        const epoch_adjust = std.time.epoch.windows * (std.time.ns_per_s / 100);
        return (@as(i64, @bitCast(ft64)) + epoch_adjust) * 100;
    }

    pub fn tick(_: *Self) void {}
};
pub const system = os.windows;

pub const CloseError = error{
    FileDescriptorInvalid,
    DiskQuota,
    InputOutput,
    NoSpaceLeft,
} || os.UnexpectedError;
pub const WriteError = os.PWriteError;
pub const ConnectError = os.ConnectError || error{FileDescriptorNotASocket};

pub const Errno = bun.C.SystemErrno.Error;

pub fn asError(err: anytype) Errno {
    if (bun.C.SystemErrno.init(err)) |e| {
        return e.toError();
    } else {
        return error.Unexpected;
    }
}

pub const Waker = struct {
    iocp: os.windows.HANDLE,

    pub const completion_key = std.math.maxInt(isize) - 24;

    const kernel32 = os.windows.kernel32;
    pub fn init(_: std.mem.Allocator) !Waker {
        _ = try os.windows.WSAStartup(2, 2);
        errdefer os.windows.WSACleanup() catch unreachable;

        const iocp = try os.windows.CreateIoCompletionPort(os.windows.INVALID_HANDLE_VALUE, null, completion_key, 0);
        return Waker{
            .iocp = iocp,
        };
    }

    pub fn initWithFileDescriptor(_: std.mem.Allocator, fd: bun.FileDescriptor) Waker {
        return Waker{
            .iocp = bun.fdcast(fd),
        };
    }

    pub fn wait(this: Waker) !u64 {
        var overlapped = [_]os.windows.OVERLAPPED_ENTRY{std.mem.zeroes(os.windows.OVERLAPPED_ENTRY)} ** 1;
        var removed: u32 = 0;
        _ = kernel32.GetQueuedCompletionStatusEx(this.iocp, &overlapped, 1, &removed, 0, 1);
        return 0;
    }

    pub fn wake(this: Waker) !void {
        var overlapped: os.windows.OVERLAPPED = std.mem.zeroes(os.windows.OVERLAPPED);
        _ = kernel32.PostQueuedCompletionStatus(this.iocp, 1, completion_key, &overlapped);
    }
};

pub fn wait(this: *IO, context: anytype, comptime function: anytype) void {
    this.flush(.blocking) catch unreachable;
    function(context);
}

/// This struct holds the data needed for a single IO operation
pub const Completion = struct {
    next: ?*Completion,
    context: ?*anyopaque,
    callback: *const fn (Context) void,
    operation: Operation,

    const Context = struct {
        io: *IO,
        completion: *Completion,
    };

    const Overlapped = struct {
        raw: os.windows.OVERLAPPED,
        completion: *Completion,
    };

    const Transfer = struct {
        socket: os.socket_t,
        buf: os.windows.ws2_32.WSABUF,
        overlapped: Overlapped,
        pending: bool,
    };

    const Operation = union(enum) {
        accept: struct {
            overlapped: Overlapped,
            listen_socket: os.socket_t,
            client_socket: os.socket_t,
            addr_buffer: [(@sizeOf(std.net.Address) + 16) * 2]u8 align(4),
        },
        open: struct {
            path: [:0]const u8,
            flags: bun.JSC.Node.Mode,
        },
        connect: struct {
            socket: os.socket_t,
            address: std.net.Address,
            overlapped: Overlapped,
            pending: bool,
        },
        send: Transfer,
        recv: Transfer,
        read: struct {
            fd: bun.FileDescriptor,
            buf: [*]u8,
            len: u32,
            offset: ?u64,
        },
        write: struct {
            fd: bun.FileDescriptor,
            buf: [*]const u8,
            len: u32,
            offset: ?u64,
        },
        close: struct {
            fd: bun.FileDescriptor,
        },
        timeout: struct {
            deadline: u64,
        },
    };
};

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
    return @min(limit, buffer_len);
}

iocp: os.windows.HANDLE,
timer: Time = .{},
io_pending: usize = 0,
timeouts: FIFO(Completion) = .{},
completed: FIFO(Completion) = .{},

pub const IO = @This();

pub fn init(_: u12, _: u32, waker: Waker) !IO {
    return IO{ .iocp = waker.iocp };
}

pub fn deinit(self: *IO) void {
    assert(self.iocp != os.windows.INVALID_HANDLE_VALUE);
    os.windows.CloseHandle(self.iocp);
    self.iocp = os.windows.INVALID_HANDLE_VALUE;

    os.windows.WSACleanup() catch unreachable;
}

pub fn tick(self: *IO) !void {
    return self.flush(.non_blocking);
}

pub fn run_for_ns(self: *IO, nanoseconds: u63) !void {
    const Callback = struct {
        fn on_timeout(timed_out: *bool, completion: *Completion, result: TimeoutError!void) void {
            _ = result catch unreachable;
            _ = completion;
            timed_out.* = true;
        }
    };

    var timed_out = false;
    var completion: Completion = undefined;
    self.timeout(*bool, &timed_out, Callback.on_timeout, &completion, nanoseconds);

    while (!timed_out) {
        try self.flush(.blocking);
    }
}

const FlushMode = enum {
    blocking,
    non_blocking,
};

fn flush(self: *IO, comptime mode: FlushMode) anyerror!void {
    if (self.completed.peek() == null) {
        // Compute how long to poll by flushing timeout completions.
        // NOTE: this may push to completed queue
        var timeout_ms: ?os.windows.DWORD = null;
        if (self.flush_timeouts()) |expires_ns| {
            // 0ns expires should have been completed not returned
            assert(expires_ns != 0);
            // Round up sub-millisecond expire times to the next millisecond
            const expires_ms = (expires_ns + (std.time.ns_per_ms / 2)) / std.time.ns_per_ms;
            // Saturating cast to DWORD milliseconds
            const expires = std.math.cast(os.windows.DWORD, expires_ms) orelse std.math.maxInt(os.windows.DWORD);
            // max DWORD is reserved for INFINITE so cap the cast at max - 1
            timeout_ms = if (expires == os.windows.INFINITE) expires - 1 else expires;
        }

        // Poll for IO iff theres IO pending and flush_timeouts() found no ready completions
        if (self.io_pending > 0 and self.completed.peek() == null) {
            // In blocking mode, we're always waiting at least until the timeout by run_for_ns.
            // In non-blocking mode, we shouldn't wait at all.
            const io_timeout = switch (mode) {
                .blocking => timeout_ms orelse 0,
                .non_blocking => 0,
            };

            var events: [64]os.windows.OVERLAPPED_ENTRY = undefined;
            const num_events = try os.windows.GetQueuedCompletionStatusEx(
                self.iocp,
                &events,
                io_timeout,
                false, // non-alertable wait
            );

            assert(self.io_pending >= num_events);
            self.io_pending -= num_events;

            for (events[0..num_events]) |event| {
                const raw_overlapped = event.lpOverlapped;
                const overlapped = @fieldParentPtr(Completion.Overlapped, "raw", raw_overlapped);
                const completion = overlapped.completion;
                completion.next = null;
                self.completed.push(completion);
            }
        }
    }

    // Dequeue and invoke all the completions currently ready.
    // Must read all `completions` before invoking the callbacks
    // as the callbacks could potentially submit more completions.
    var completed = self.completed;
    self.completed = .{};
    while (completed.pop()) |completion| {
        (completion.callback)(Completion.Context{
            .io = self,
            .completion = completion,
        });
    }
}

fn flush_timeouts(self: *IO) ?u64 {
    var min_expires: ?u64 = null;
    var current_time: ?u64 = null;
    var timeouts: ?*Completion = self.timeouts.peek();

    // iterate through the timeouts, returning min_expires at the end
    while (timeouts) |completion| {
        timeouts = completion.next;

        // lazily get the current time
        const now = current_time orelse self.timer.monotonic();
        current_time = now;

        // move the completion to completed if it expired
        if (now >= completion.operation.timeout.deadline) {
            self.timeouts.remove(completion);
            self.completed.push(completion);
            continue;
        }

        // if it's still waiting, update min_timeout
        const expires = completion.operation.timeout.deadline - now;
        if (min_expires) |current_min_expires| {
            min_expires = @min(expires, current_min_expires);
        } else {
            min_expires = expires;
        }
    }

    return min_expires;
}

fn submit(
    self: *IO,
    context: anytype,
    comptime callback: anytype,
    completion: *Completion,
    comptime op_tag: std.meta.Tag(Completion.Operation),
    op_data: anytype,
    comptime OperationImpl: type,
) void {
    const Context = @TypeOf(context);
    const Callback = struct {
        fn onComplete(ctx: Completion.Context) void {
            // Perform the operation and get the result
            const data = &@field(ctx.completion.operation, @tagName(op_tag));
            const result = OperationImpl.do_operation(ctx, data);

            // For OVERLAPPED IO, error.WouldBlock assumes that it will be completed by IOCP.
            switch (op_tag) {
                .accept, .read, .recv, .connect, .write, .send => {
                    _ = result catch |err| switch (err) {
                        error.WouldBlock => {
                            ctx.io.io_pending += 1;
                            return;
                        },
                        else => {},
                    };
                },
                else => {},
            }

            // The completion is finally ready to invoke the callback
            callback(
                @as(Context, @ptrFromInt(@intFromPtr(ctx.completion.context))),
                ctx.completion,
                result,
            );
        }
    };

    // Setup the completion with the callback wrapper above
    completion.* = .{
        .next = null,
        .context = @as(?*anyopaque, @ptrCast(context)),
        .callback = Callback.onComplete,
        .operation = @unionInit(Completion.Operation, @tagName(op_tag), op_data),
    };

    // Submit the completion onto the right queue
    switch (op_tag) {
        .timeout => self.timeouts.push(completion),
        else => self.completed.push(completion),
    }
}

pub const OpenError = bun.C.SystemErrno.Error;

pub fn open(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: OpenError!bun.FileDescriptor,
    ) void,
    completion: *Completion,
    path: [:0]const u8,
    flags: bun.JSC.Node.Mode,
    _: bun.JSC.Node.Mode,
) void {
    self.submit(
        context,
        callback,
        completion,
        .open,
        .{
            .path = path,
            .flags = flags,
        },
        struct {
            fn do_operation(ctx: Completion.Context, op: anytype) OpenError!bun.FileDescriptor {
                _ = ctx;
                const result = bun.sys.openat(bun.invalid_fd, op.path, op.flags, 0);
                try result.throw();
                return result.result;
            }
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
            .overlapped = undefined,
            .listen_socket = socket,
            .client_socket = INVALID_SOCKET,
            .addr_buffer = undefined,
        },
        struct {
            fn do_operation(ctx: Completion.Context, op: anytype) AcceptError!os.socket_t {
                var flags: os.windows.DWORD = undefined;
                var transferred: os.windows.DWORD = undefined;

                const rc = switch (op.client_socket) {
                    // When first called, the client_socket is invalid so we start the op.
                    INVALID_SOCKET => blk: {
                        // Create the socket that will be used for accept.
                        op.client_socket = ctx.io.open_socket(
                            os.AF.INET,
                            os.SOCK.STREAM,
                            os.IPPROTO.TCP,
                        ) catch |err| switch (err) {
                            error.AddressFamilyNotSupported, error.ProtocolNotSupported => unreachable,
                            else => |e| return e,
                        };

                        var sync_bytes_read: os.windows.DWORD = undefined;
                        op.overlapped = .{
                            .raw = std.mem.zeroes(os.windows.OVERLAPPED),
                            .completion = ctx.completion,
                        };

                        // Start the asynchronous accept with the created socket.
                        break :blk os.windows.ws2_32.AcceptEx(
                            op.listen_socket,
                            op.client_socket,
                            &op.addr_buffer,
                            0,
                            @sizeOf(std.net.Address) + 16,
                            @sizeOf(std.net.Address) + 16,
                            &sync_bytes_read,
                            &op.overlapped.raw,
                        );
                    },
                    // Called after accept was started, so get the result
                    else => os.windows.ws2_32.WSAGetOverlappedResult(
                        op.listen_socket,
                        &op.overlapped.raw,
                        &transferred,
                        os.windows.FALSE, // dont wait
                        &flags,
                    ),
                };

                // return the socket if we succeed in accepting.
                if (rc != os.windows.FALSE) {
                    // enables getsockopt, setsockopt, getsockname, getpeername
                    _ = os.windows.ws2_32.setsockopt(
                        op.client_socket,
                        os.windows.ws2_32.SOL.SOCKET,
                        os.windows.ws2_32.SO.UPDATE_ACCEPT_CONTEXT,
                        null,
                        0,
                    );

                    return op.client_socket;
                }

                // destroy the client_socket we created if we get a non WouldBlock error
                errdefer |result| {
                    _ = result catch |err| switch (err) {
                        error.WouldBlock => {},
                        else => {
                            os.closeSocket(op.client_socket);
                            op.client_socket = INVALID_SOCKET;
                        },
                    };
                }

                return switch (os.windows.ws2_32.WSAGetLastError()) {
                    .WSA_IO_PENDING, .WSAEWOULDBLOCK, .WSA_IO_INCOMPLETE => error.WouldBlock,
                    .WSANOTINITIALISED => unreachable, // WSAStartup() was called
                    .WSAENETDOWN => unreachable, // WinSock error
                    .WSAENOTSOCK => error.FileDescriptorNotASocket,
                    .WSAEOPNOTSUPP => error.OperationNotSupported,
                    .WSA_INVALID_HANDLE => unreachable, // we dont use hEvent in OVERLAPPED
                    .WSAEFAULT, .WSA_INVALID_PARAMETER => unreachable, // params should be ok
                    .WSAECONNRESET => error.ConnectionAborted,
                    .WSAEMFILE => unreachable, // we create our own descriptor so its available
                    .WSAENOBUFS => error.SystemResources,
                    .WSAEINTR, .WSAEINPROGRESS => unreachable, // no blocking calls
                    else => |err| os.windows.unexpectedWSAError(err),
                };
            }
        },
    );
}

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
            .overlapped = undefined,
            .pending = false,
        },
        struct {
            fn do_operation(ctx: Completion.Context, op: anytype) ConnectError!void {
                var flags: os.windows.DWORD = undefined;
                var transferred: os.windows.DWORD = undefined;

                const rc = blk: {
                    // Poll for the result if we've already started the connect op.
                    if (op.pending) {
                        break :blk os.windows.ws2_32.WSAGetOverlappedResult(
                            op.socket,
                            &op.overlapped.raw,
                            &transferred,
                            os.windows.FALSE, // dont wait
                            &flags,
                        );
                    }

                    // ConnectEx requires the socket to be initially bound (INADDR_ANY)
                    const inaddr_any = std.mem.zeroes([4]u8);
                    const bind_addr = std.net.Address.initIp4(inaddr_any, 0);
                    os.bind(
                        op.socket,
                        &bind_addr.any,
                        bind_addr.getOsSockLen(),
                    ) catch |err| switch (err) {
                        error.AccessDenied => unreachable,
                        error.SymLinkLoop => unreachable,
                        error.NameTooLong => unreachable,
                        error.NotDir => unreachable,
                        error.ReadOnlyFileSystem => unreachable,
                        error.NetworkSubsystemFailed => unreachable,
                        error.AlreadyBound => unreachable,
                        else => |e| return e,
                    };

                    const LPFN_CONNECTEX = fn (
                        Socket: os.windows.ws2_32.SOCKET,
                        SockAddr: *const os.windows.ws2_32.sockaddr,
                        SockLen: os.socklen_t,
                        SendBuf: ?*const anyopaque,
                        SendBufLen: os.windows.DWORD,
                        BytesSent: *os.windows.DWORD,
                        Overlapped: *os.windows.OVERLAPPED,
                    ) callconv(os.windows.WINAPI) os.windows.BOOL;

                    // Find the ConnectEx function by dynamically looking it up on the socket.
                    const connect_ex = os.windows.loadWinsockExtensionFunction(
                        LPFN_CONNECTEX,
                        op.socket,
                        os.windows.ws2_32.WSAID_CONNECTEX,
                    ) catch |err| switch (err) {
                        error.OperationNotSupported => unreachable,
                        error.ShortRead => unreachable,
                        else => |e| return e,
                    };

                    op.pending = true;
                    op.overlapped = .{
                        .raw = std.mem.zeroes(os.windows.OVERLAPPED),
                        .completion = ctx.completion,
                    };

                    // Start the connect operation.
                    break :blk (connect_ex)(
                        op.socket,
                        &op.address.any,
                        op.address.getOsSockLen(),
                        null,
                        0,
                        &transferred,
                        &op.overlapped.raw,
                    );
                };

                // return if we succeeded in connecting
                if (rc != os.windows.FALSE) {
                    // enables getsockopt, setsockopt, getsockname, getpeername
                    _ = os.windows.ws2_32.setsockopt(
                        op.socket,
                        os.windows.ws2_32.SOL.SOCKET,
                        os.windows.ws2_32.SO.UPDATE_CONNECT_CONTEXT,
                        null,
                        0,
                    );

                    return;
                }

                return switch (os.windows.ws2_32.WSAGetLastError()) {
                    .WSA_IO_PENDING, .WSAEWOULDBLOCK, .WSA_IO_INCOMPLETE, .WSAEALREADY => error.WouldBlock,
                    .WSANOTINITIALISED => unreachable, // WSAStartup() was called
                    .WSAENETDOWN => unreachable, // network subsystem is down
                    .WSAEADDRNOTAVAIL => error.AddressNotAvailable,
                    .WSAEAFNOSUPPORT => error.AddressFamilyNotSupported,
                    .WSAECONNREFUSED => error.ConnectionRefused,
                    .WSAEFAULT => unreachable, // all addresses should be valid
                    .WSAEINVAL => unreachable, // invalid socket type
                    .WSAEHOSTUNREACH, .WSAENETUNREACH => error.NetworkUnreachable,
                    .WSAENOBUFS => error.SystemResources,
                    .WSAENOTSOCK => unreachable, // socket is not bound or is listening
                    .WSAETIMEDOUT => error.ConnectionTimedOut,
                    .WSA_INVALID_HANDLE => unreachable, // we dont use hEvent in OVERLAPPED
                    else => |err| os.windows.unexpectedWSAError(err),
                };
            }
        },
    );
}

pub const SendError = os.SendError;

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
) void {
    const transfer = Completion.Transfer{
        .socket = socket,
        .buf = os.windows.ws2_32.WSABUF{
            .len = @as(u32, @intCast(buffer_limit(buffer.len))),
            .buf = @as([*]u8, @ptrFromInt(@intFromPtr(buffer.ptr))),
        },
        .overlapped = undefined,
        .pending = false,
    };

    self.submit(
        context,
        callback,
        completion,
        .send,
        transfer,
        struct {
            fn do_operation(ctx: Completion.Context, op: anytype) SendError!usize {
                var flags: os.windows.DWORD = undefined;
                var transferred: os.windows.DWORD = undefined;

                const rc = blk: {
                    // Poll for the result if we've already started the send op.
                    if (op.pending) {
                        break :blk os.windows.ws2_32.WSAGetOverlappedResult(
                            op.socket,
                            &op.overlapped.raw,
                            &transferred,
                            os.windows.FALSE, // dont wait
                            &flags,
                        );
                    }

                    op.pending = true;
                    op.overlapped = .{
                        .raw = std.mem.zeroes(os.windows.OVERLAPPED),
                        .completion = ctx.completion,
                    };

                    // Start the send operation.
                    break :blk switch (os.windows.ws2_32.WSASend(
                        op.socket,
                        @as([*]os.windows.ws2_32.WSABUF, @ptrCast(&op.buf)),
                        1, // one buffer
                        &transferred,
                        0, // no flags
                        &op.overlapped.raw,
                        null,
                    )) {
                        os.windows.ws2_32.SOCKET_ERROR => @as(os.windows.BOOL, os.windows.FALSE),
                        0 => os.windows.TRUE,
                        else => unreachable,
                    };
                };

                // Return bytes transferred on success.
                if (rc != os.windows.FALSE)
                    return transferred;

                return switch (os.windows.ws2_32.WSAGetLastError()) {
                    .WSA_IO_PENDING, .WSAEWOULDBLOCK, .WSA_IO_INCOMPLETE => error.WouldBlock,
                    .WSANOTINITIALISED => unreachable, // WSAStartup() was called
                    .WSA_INVALID_HANDLE => unreachable, // we dont use OVERLAPPED.hEvent
                    .WSA_INVALID_PARAMETER => unreachable, // parameters are fine
                    .WSAECONNABORTED => error.ConnectionResetByPeer,
                    .WSAECONNRESET => error.ConnectionResetByPeer,
                    .WSAEFAULT => unreachable, // invalid buffer
                    .WSAEINTR => unreachable, // this is non blocking
                    .WSAEINPROGRESS => unreachable, // this is non blocking
                    .WSAEINVAL => unreachable, // invalid socket type
                    .WSAEMSGSIZE => error.MessageTooBig,
                    .WSAENETDOWN => error.NetworkSubsystemFailed,
                    .WSAENETRESET => error.ConnectionResetByPeer,
                    .WSAENOBUFS => error.SystemResources,
                    .WSAENOTCONN => error.FileDescriptorNotASocket,
                    .WSAEOPNOTSUPP => unreachable, // we dont use MSG_OOB or MSG_PARTIAL
                    .WSAESHUTDOWN => error.BrokenPipe,
                    .WSA_OPERATION_ABORTED => unreachable, // operation was cancelled
                    else => |err| os.windows.unexpectedWSAError(err),
                };
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
    const transfer = Completion.Transfer{
        .socket = socket,
        .buf = os.windows.ws2_32.WSABUF{
            .len = @as(u32, @intCast(buffer_limit(buffer.len))),
            .buf = buffer.ptr,
        },
        .overlapped = undefined,
        .pending = false,
    };

    self.submit(
        context,
        callback,
        completion,
        .recv,
        transfer,
        struct {
            fn do_operation(ctx: Completion.Context, op: anytype) RecvError!usize {
                var flags: os.windows.DWORD = 0; // used both as input and output
                var transferred: os.windows.DWORD = undefined;

                const rc = blk: {
                    // Poll for the result if we've already started the recv op.
                    if (op.pending) {
                        break :blk os.windows.ws2_32.WSAGetOverlappedResult(
                            op.socket,
                            &op.overlapped.raw,
                            &transferred,
                            os.windows.FALSE, // dont wait
                            &flags,
                        );
                    }

                    op.pending = true;
                    op.overlapped = .{
                        .raw = std.mem.zeroes(os.windows.OVERLAPPED),
                        .completion = ctx.completion,
                    };

                    // Start the recv operation.
                    break :blk switch (os.windows.ws2_32.WSARecv(
                        op.socket,
                        @as([*]os.windows.ws2_32.WSABUF, @ptrCast(&op.buf)),
                        1, // one buffer
                        &transferred,
                        &flags,
                        &op.overlapped.raw,
                        null,
                    )) {
                        os.windows.ws2_32.SOCKET_ERROR => @as(os.windows.BOOL, os.windows.FALSE),
                        0 => os.windows.TRUE,
                        else => unreachable,
                    };
                };

                // Return bytes received on success.
                if (rc != os.windows.FALSE)
                    return transferred;

                return switch (os.windows.ws2_32.WSAGetLastError()) {
                    .WSA_IO_PENDING, .WSAEWOULDBLOCK, .WSA_IO_INCOMPLETE => error.WouldBlock,
                    .WSANOTINITIALISED => unreachable, // WSAStartup() was called
                    .WSA_INVALID_HANDLE => unreachable, // we dont use OVERLAPPED.hEvent
                    .WSA_INVALID_PARAMETER => unreachable, // parameters are fine
                    .WSAECONNABORTED => error.ConnectionRefused,
                    .WSAECONNRESET => error.ConnectionResetByPeer,
                    .WSAEDISCON => unreachable, // we only stream sockets
                    .WSAEFAULT => unreachable, // invalid buffer
                    .WSAEINTR => unreachable, // this is non blocking
                    .WSAEINPROGRESS => unreachable, // this is non blocking
                    .WSAEINVAL => unreachable, // invalid socket type
                    .WSAEMSGSIZE => error.MessageTooBig,
                    .WSAENETDOWN => error.NetworkSubsystemFailed,
                    .WSAENETRESET => error.ConnectionResetByPeer,
                    .WSAENOTCONN => error.SocketNotConnected,
                    .WSAEOPNOTSUPP => unreachable, // we dont use MSG_OOB or MSG_PARTIAL
                    .WSAESHUTDOWN => error.SocketNotConnected,
                    .WSAETIMEDOUT => error.ConnectionRefused,
                    .WSA_OPERATION_ABORTED => unreachable, // operation was cancelled
                    else => |err| os.windows.unexpectedWSAError(err),
                };
            }
        },
    );
}

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
    fd: bun.FileDescriptor,
    buffer: []u8,
    offset: ?u64,
) void {
    self.submit(
        context,
        callback,
        completion,
        .read,
        .{
            .fd = fd,
            .buf = buffer.ptr,
            .len = @as(u32, @intCast(buffer_limit(buffer.len))),
            .offset = offset,
        },
        struct {
            fn do_operation(ctx: Completion.Context, op: anytype) ReadError!usize {
                // Do a synchronous read for now.
                _ = ctx;
                if (op.offset) |o| {
                    return os.pread(bun.fdcast(op.fd), op.buf[0..op.len], o) catch |err| switch (err) {
                        error.OperationAborted => unreachable,
                        error.BrokenPipe => unreachable,
                        error.ConnectionTimedOut => unreachable,
                        error.AccessDenied => error.InputOutput,
                        else => |e| e,
                    };
                } else {
                    return os.read(bun.fdcast(op.fd), op.buf[0..op.len]) catch |err| switch (err) {
                        error.OperationAborted => unreachable,
                        error.BrokenPipe => unreachable,
                        error.ConnectionTimedOut => unreachable,
                        error.AccessDenied => error.InputOutput,
                        else => |e| e,
                    };
                }
            }
        },
    );
}

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
    fd: bun.FileDescriptor,
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
            .len = @as(u32, @intCast(buffer_limit(buffer.len))),
            .offset = offset,
        },
        struct {
            fn do_operation(ctx: Completion.Context, op: anytype) WriteError!usize {
                // Do a synchronous write for now.
                _ = ctx;
                if (op.offset) |off| {
                    return os.pwrite(bun.fdcast(op.fd), op.buf[0..op.len], off);
                } else {
                    return os.write(bun.fdcast(op.fd), op.buf[0..op.len]);
                }
            }
        },
    );
}

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
    fd: bun.FileDescriptor,
) void {
    self.submit(
        context,
        callback,
        completion,
        .close,
        .{ .fd = fd },
        struct {
            fn do_operation(ctx: Completion.Context, op: anytype) CloseError!void {
                _ = ctx;

                // Check if the fd is a SOCKET by seeing if getsockopt() returns ENOTSOCK
                // https://stackoverflow.com/a/50981652
                const socket = @as(os.socket_t, @ptrCast(bun.fdcast(op.fd)));
                getsockoptError(socket) catch |err| switch (err) {
                    error.FileDescriptorNotASocket => return os.windows.CloseHandle(bun.fdcast(op.fd)),
                    else => {},
                };

                os.closeSocket(socket);
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
        .{ .deadline = self.timer.monotonic() + nanoseconds },
        struct {
            fn do_operation(ctx: Completion.Context, op: anytype) TimeoutError!void {
                _ = ctx;
                _ = op;
                return;
            }
        },
    );
}

pub const INVALID_SOCKET = os.windows.ws2_32.INVALID_SOCKET;

/// Creates a socket that can be used for async operations with the IO instance.
pub fn open_socket(self: *IO, family: u32, sock_type: u32, protocol: u32) !os.socket_t {
    // SOCK_NONBLOCK | SOCK_CLOEXEC
    var flags: os.windows.DWORD = 0;
    flags |= os.windows.ws2_32.WSA_FLAG_OVERLAPPED;
    flags |= os.windows.ws2_32.WSA_FLAG_NO_HANDLE_INHERIT;

    const socket = try os.windows.WSASocketW(
        @as(i32, @bitCast(family)),
        @as(i32, @bitCast(sock_type)),
        @as(i32, @bitCast(protocol)),
        null,
        0,
        flags,
    );
    errdefer os.closeSocket(socket);

    const socket_iocp = try os.windows.CreateIoCompletionPort(socket, self.iocp, 0, 0);
    assert(socket_iocp == self.iocp);

    // Ensure that synchronous IO completion doesn't queue an unneeded overlapped
    // and that the event for the socket (WaitForSingleObject) doesn't need to be set.
    var mode: os.windows.BYTE = 0;
    mode |= os.windows.FILE_SKIP_COMPLETION_PORT_ON_SUCCESS;
    mode |= os.windows.FILE_SKIP_SET_EVENT_ON_HANDLE;

    const handle = @as(os.windows.HANDLE, @ptrCast(socket));
    try os.windows.SetFileCompletionNotificationModes(handle, mode);

    return socket;
}

/// Opens a directory with read only access.
pub fn open_dir(dir_path: [:0]const u8) !os.fd_t {
    const dir = try std.fs.cwd().openDirZ(dir_path, .{});
    return dir.fd;
}

/// Opens or creates a journal file:
/// - For reading and writing.
/// - For Direct I/O (required on windows).
/// - Obtains an advisory exclusive lock to the file descriptor.
/// - Allocates the file contiguously on disk if this is supported by the file system.
/// - Ensures that the file data is durable on disk.
///   The caller is responsible for ensuring that the parent directory inode is durable.
/// - Verifies that the file size matches the expected file size before returning.
pub fn open_file(
    self: *IO,
    dir_handle: os.fd_t,
    relative_path: [:0]const u8,
    size: u64,
    must_create: bool,
) !os.fd_t {
    _ = size;
    _ = self;

    assert(relative_path.len > 0);

    const path_w = try os.windows.sliceToPrefixedFileW(relative_path);

    // FILE_CREATE = O_CREAT | O_EXCL
    var creation_disposition: os.windows.DWORD = 0;
    if (must_create) {
        log.info("creating \"{s}\"...", .{relative_path});
        creation_disposition = os.windows.FILE_CREATE;
    } else {
        log.info("opening \"{s}\"...", .{relative_path});
        creation_disposition = os.windows.OPEN_EXISTING;
    }

    // O_EXCL
    var shared_mode: os.windows.DWORD = 0;

    // O_RDWR
    var access_mask: os.windows.DWORD = 0;
    access_mask |= os.windows.GENERIC_READ;
    access_mask |= os.windows.GENERIC_WRITE;

    // O_DIRECT | O_DSYNC
    var attributes: os.windows.DWORD = 0;
    // attributes |= os.windows.FILE_FLAG_NO_BUFFERING;
    // attributes |= os.windows.FILE_FLAG_WRITE_THROUGH;

    // This is critical as we rely on O_DSYNC for fsync() whenever we write to the file:
    // assert((attributes & os.windows.FILE_FLAG_WRITE_THROUGH) > 0);

    // TODO: Add ReadFileEx/WriteFileEx support.
    // Not currently needed for O_DIRECT disk IO.
    attributes |= os.windows.FILE_FLAG_OVERLAPPED;

    const handle = os.windows.kernel32.CreateFileW(
        path_w.span(),
        access_mask,
        shared_mode,
        null, // no security attributes required
        creation_disposition,
        attributes,
        null, // no existing template file
    );

    if (handle == os.windows.INVALID_HANDLE_VALUE) {
        return switch (os.windows.kernel32.GetLastError()) {
            .ACCESS_DENIED => error.AccessDenied,
            else => |err| os.windows.unexpectedError(err),
        };
    }

    errdefer os.windows.CloseHandle(handle);

    // // Obtain an advisory exclusive lock
    // // even when we haven't given shared access to other processes.
    // fs_lock(handle, size) catch |err| switch (err) {
    //     error.WouldBlock => @panic("another process holds the data file lock"),
    //     else => return err,
    // };

    // // Ask the file system to allocate contiguous sectors for the file (if possible):
    // if (must_create) {
    //     log.info("allocating {}...", .{std.fmt.fmtIntSizeBin(size)});
    //     fs_allocate(handle, size) catch {
    //         log.warn("file system failed to preallocate the file memory", .{});
    //         log.info("allocating by writing to the last sector of the file instead...", .{});

    //         const sector_size = config.sector_size;
    //         const sector: [sector_size]u8 align(sector_size) = [_]u8{0} ** sector_size;

    //         // Handle partial writes where the physical sector is less than a logical sector:
    //         const write_offset = size - sector.len;
    //         var written: usize = 0;
    //         while (written < sector.len) {
    //             written += try os.pwrite(handle, sector[written..], write_offset + written);
    //         }
    //     };
    // }

    // // The best fsync strategy is always to fsync before reading because this prevents us from
    // // making decisions on data that was never durably written by a previously crashed process.
    // // We therefore always fsync when we open the path, also to wait for any pending O_DSYNC.
    // // Thanks to Alex Miller from FoundationDB for diving into our source and pointing this out.
    // try os.fsync(handle);

    // We cannot fsync the directory handle on Windows.
    // We have no way to open a directory with write access.
    //
    // try os.fsync(dir_handle);
    _ = dir_handle;

    return handle;
}

fn fs_lock(handle: bun.FileDescriptor, size: u64) !void {
    // TODO: Look into using SetFileIoOverlappedRange() for better unbuffered async IO perf
    // NOTE: Requires SeLockMemoryPrivilege.

    const kernel32 = struct {
        const LOCKFILE_EXCLUSIVE_LOCK = 0x2;
        const LOCKFILE_FAIL_IMMEDIATELY = 0o01;

        extern "kernel32" fn LockFileEx(
            hFile: os.windows.HANDLE,
            dwFlags: os.windows.DWORD,
            dwReserved: os.windows.DWORD,
            nNumberOfBytesToLockLow: os.windows.DWORD,
            nNumberOfBytesToLockHigh: os.windows.DWORD,
            lpOverlapped: ?*os.windows.OVERLAPPED,
        ) callconv(os.windows.WINAPI) os.windows.BOOL;
    };

    // hEvent = null
    // Offset & OffsetHigh = 0
    var lock_overlapped = std.mem.zeroes(os.windows.OVERLAPPED);

    // LOCK_EX | LOCK_NB
    var lock_flags: os.windows.DWORD = 0;
    lock_flags |= kernel32.LOCKFILE_EXCLUSIVE_LOCK;
    lock_flags |= kernel32.LOCKFILE_FAIL_IMMEDIATELY;

    const locked = kernel32.LockFileEx(
        handle,
        lock_flags,
        0, // reserved param is always zero
        @as(u32, @truncate(size)), // low bits of size
        @as(u32, @truncate(size >> 32)), // high bits of size
        &lock_overlapped,
    );

    if (locked == os.windows.FALSE) {
        return switch (os.windows.kernel32.GetLastError()) {
            .IO_PENDING => error.WouldBlock,
            else => |err| os.windows.unexpectedError(err),
        };
    }
}

fn fs_allocate(handle: os.fd_t, size: u64) !void {
    // TODO: Look into using SetFileValidData() instead
    // NOTE: Requires SE_MANAGE_VOLUME_NAME privilege

    // Move the file pointer to the start + size
    const seeked = os.windows.kernel32.SetFilePointerEx(
        handle,
        @as(i64, @intCast(size)),
        null, // no reference to new file pointer
        os.windows.FILE_BEGIN,
    );

    if (seeked == os.windows.FALSE) {
        return switch (os.windows.kernel32.GetLastError()) {
            .INVALID_HANDLE => unreachable,
            .INVALID_PARAMETER => unreachable,
            else => |err| os.windows.unexpectedError(err),
        };
    }

    // Mark the moved file pointer (start + size) as the physical EOF.
    const allocated = os.windows.kernel32.SetEndOfFile(handle);
    if (allocated == os.windows.FALSE) {
        const err = os.windows.kernel32.GetLastError();
        return os.windows.unexpectedError(err);
    }
}

// TODO: use os.getsockoptError when fixed for windows in stdlib
fn getsockoptError(socket: os.socket_t) ConnectError!void {
    var err_code: u32 = undefined;
    var size: i32 = @sizeOf(u32);
    const rc = os.windows.ws2_32.getsockopt(
        socket,
        os.SOL.SOCKET,
        os.SO.ERROR,
        std.mem.asBytes(&err_code),
        &size,
    );

    if (rc != 0) {
        switch (os.windows.ws2_32.WSAGetLastError()) {
            .WSAENETDOWN => return error.NetworkUnreachable,
            .WSANOTINITIALISED => unreachable, // WSAStartup() was never called
            .WSAEFAULT => unreachable, // The address pointed to by optval or optlen is not in a valid part of the process address space.
            .WSAEINVAL => unreachable, // The level parameter is unknown or invalid
            .WSAENOPROTOOPT => unreachable, // The option is unknown at the level indicated.
            .WSAENOTSOCK => return error.FileDescriptorNotASocket,
            else => |err| return os.windows.unexpectedWSAError(err),
        }
    }

    assert(size == 4);
    if (err_code == 0)
        return;

    const ws_err = @as(os.windows.ws2_32.WinsockError, @enumFromInt(@as(u16, @intCast(err_code))));
    return switch (ws_err) {
        .WSAEACCES => error.PermissionDenied,
        .WSAEADDRINUSE => error.AddressInUse,
        .WSAEADDRNOTAVAIL => error.AddressNotAvailable,
        .WSAEAFNOSUPPORT => error.AddressFamilyNotSupported,
        .WSAEALREADY => error.ConnectionPending,
        .WSAEBADF => unreachable,
        .WSAECONNREFUSED => error.ConnectionRefused,
        .WSAEFAULT => unreachable,
        .WSAEISCONN => unreachable, // error.AlreadyConnected,
        .WSAENETUNREACH => error.NetworkUnreachable,
        .WSAENOTSOCK => error.FileDescriptorNotASocket,
        .WSAEPROTOTYPE => unreachable,
        .WSAETIMEDOUT => error.ConnectionTimedOut,
        .WSAECONNRESET => error.ConnectionResetByPeer,
        else => |e| os.windows.unexpectedWSAError(e),
    };
}

pub var global: IO = undefined;
pub var global_loaded: bool = false;
pub const AcceptError = os.AcceptError || os.SetSockOptError;

pub const ReadError = error{
    WouldBlock,
    NotOpenForReading,
    ConnectionResetByPeer,
    Alignment,
    InputOutput,
    IsDir,
    SystemResources,
    Unseekable,
} || os.UnexpectedError || os.PReadError;
