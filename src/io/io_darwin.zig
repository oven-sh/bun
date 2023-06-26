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

const SystemErrno = @import("root").bun.C.SystemErrno;
pub const Errno = error{
    EPERM,
    ENOENT,
    ESRCH,
    EINTR,
    EIO,
    ENXIO,
    E2BIG,
    ENOEXEC,
    EBADF,
    ECHILD,
    EDEADLK,
    ENOMEM,
    EACCES,
    EFAULT,
    ENOTBLK,
    EBUSY,
    EEXIST,
    EXDEV,
    ENODEV,
    ENOTDIR,
    EISDIR,
    EINVAL,
    ENFILE,
    EMFILE,
    ENOTTY,
    ETXTBSY,
    EFBIG,
    ENOSPC,
    ESPIPE,
    EROFS,
    EMLINK,
    EPIPE,
    EDOM,
    ERANGE,
    EAGAIN,
    EINPROGRESS,
    EALREADY,
    ENOTSOCK,
    EDESTADDRREQ,
    EMSGSIZE,
    EPROTOTYPE,
    ENOPROTOOPT,
    EPROTONOSUPPORT,
    ESOCKTNOSUPPORT,
    ENOTSUP,
    EPFNOSUPPORT,
    EAFNOSUPPORT,
    EADDRINUSE,
    EADDRNOTAVAIL,
    ENETDOWN,
    ENETUNREACH,
    ENETRESET,
    ECONNABORTED,
    ECONNRESET,
    ENOBUFS,
    EISCONN,
    ENOTCONN,
    ESHUTDOWN,
    ETOOMANYREFS,
    ETIMEDOUT,
    ECONNREFUSED,
    ELOOP,
    ENAMETOOLONG,
    EHOSTDOWN,
    EHOSTUNREACH,
    ENOTEMPTY,
    EPROCLIM,
    EUSERS,
    EDQUOT,
    ESTALE,
    EREMOTE,
    EBADRPC,
    ERPCMISMATCH,
    EPROGUNAVAIL,
    EPROGMISMATCH,
    EPROCUNAVAIL,
    ENOLCK,
    ENOSYS,
    EFTYPE,
    EAUTH,
    ENEEDAUTH,
    EPWROFF,
    EDEVERR,
    EOVERFLOW,
    EBADEXEC,
    EBADARCH,
    ESHLIBVERS,
    EBADMACHO,
    ECANCELED,
    EIDRM,
    ENOMSG,
    EILSEQ,
    ENOATTR,
    EBADMSG,
    EMULTIHOP,
    ENODATA,
    ENOLINK,
    ENOSR,
    ENOSTR,
    EPROTO,
    ETIME,
    EOPNOTSUPP,
    ENOPOLICY,
    ENOTRECOVERABLE,
    EOWNERDEAD,
    EQFULL,
    Unexpected,
};

pub const errno_map: [108]Errno = brk: {
    var errors: [108]Errno = undefined;
    errors[1] = error.EPERM;
    errors[2] = error.ENOENT;
    errors[3] = error.ESRCH;
    errors[4] = error.EINTR;
    errors[5] = error.EIO;
    errors[6] = error.ENXIO;
    errors[7] = error.E2BIG;
    errors[8] = error.ENOEXEC;
    errors[9] = error.EBADF;
    errors[10] = error.ECHILD;
    errors[11] = error.EDEADLK;
    errors[12] = error.ENOMEM;
    errors[13] = error.EACCES;
    errors[14] = error.EFAULT;
    errors[15] = error.ENOTBLK;
    errors[16] = error.EBUSY;
    errors[17] = error.EEXIST;
    errors[18] = error.EXDEV;
    errors[19] = error.ENODEV;
    errors[20] = error.ENOTDIR;
    errors[21] = error.EISDIR;
    errors[22] = error.EINVAL;
    errors[23] = error.ENFILE;
    errors[24] = error.EMFILE;
    errors[25] = error.ENOTTY;
    errors[26] = error.ETXTBSY;
    errors[27] = error.EFBIG;
    errors[28] = error.ENOSPC;
    errors[29] = error.ESPIPE;
    errors[30] = error.EROFS;
    errors[31] = error.EMLINK;
    errors[32] = error.EPIPE;
    errors[33] = error.EDOM;
    errors[34] = error.ERANGE;
    errors[35] = error.EAGAIN;
    errors[36] = error.EINPROGRESS;
    errors[37] = error.EALREADY;
    errors[38] = error.ENOTSOCK;
    errors[39] = error.EDESTADDRREQ;
    errors[40] = error.EMSGSIZE;
    errors[41] = error.EPROTOTYPE;
    errors[42] = error.ENOPROTOOPT;
    errors[43] = error.EPROTONOSUPPORT;
    errors[44] = error.ESOCKTNOSUPPORT;
    errors[45] = error.ENOTSUP;
    errors[46] = error.EPFNOSUPPORT;
    errors[47] = error.EAFNOSUPPORT;
    errors[48] = error.EADDRINUSE;
    errors[49] = error.EADDRNOTAVAIL;
    errors[50] = error.ENETDOWN;
    errors[51] = error.ENETUNREACH;
    errors[52] = error.ENETRESET;
    errors[53] = error.ECONNABORTED;
    errors[54] = error.ECONNRESET;
    errors[55] = error.ENOBUFS;
    errors[56] = error.EISCONN;
    errors[57] = error.ENOTCONN;
    errors[58] = error.ESHUTDOWN;
    errors[59] = error.ETOOMANYREFS;
    errors[60] = error.ETIMEDOUT;
    errors[61] = error.ECONNREFUSED;
    errors[62] = error.ELOOP;
    errors[63] = error.ENAMETOOLONG;
    errors[64] = error.EHOSTDOWN;
    errors[65] = error.EHOSTUNREACH;
    errors[66] = error.ENOTEMPTY;
    errors[67] = error.EPROCLIM;
    errors[68] = error.EUSERS;
    errors[69] = error.EDQUOT;
    errors[70] = error.ESTALE;
    errors[71] = error.EREMOTE;
    errors[72] = error.EBADRPC;
    errors[73] = error.ERPCMISMATCH;
    errors[74] = error.EPROGUNAVAIL;
    errors[75] = error.EPROGMISMATCH;
    errors[76] = error.EPROCUNAVAIL;
    errors[77] = error.ENOLCK;
    errors[78] = error.ENOSYS;
    errors[79] = error.EFTYPE;
    errors[80] = error.EAUTH;
    errors[81] = error.ENEEDAUTH;
    errors[82] = error.EPWROFF;
    errors[83] = error.EDEVERR;
    errors[84] = error.EOVERFLOW;
    errors[85] = error.EBADEXEC;
    errors[86] = error.EBADARCH;
    errors[87] = error.ESHLIBVERS;
    errors[88] = error.EBADMACHO;
    errors[89] = error.ECANCELED;
    errors[90] = error.EIDRM;
    errors[91] = error.ENOMSG;
    errors[92] = error.EILSEQ;
    errors[93] = error.ENOATTR;
    errors[94] = error.EBADMSG;
    errors[95] = error.EMULTIHOP;
    errors[96] = error.ENODATA;
    errors[97] = error.ENOLINK;
    errors[98] = error.ENOSR;
    errors[99] = error.ENOSTR;
    errors[100] = error.EPROTO;
    errors[101] = error.ETIME;
    errors[102] = error.EOPNOTSUPP;
    errors[103] = error.ENOPOLICY;
    errors[104] = error.ENOTRECOVERABLE;
    errors[105] = error.EOWNERDEAD;
    errors[106] = error.EQFULL;
    break :brk errors;
};

const socket_t = os.socket_t;
const sockaddr = darwin.sockaddr;
const socklen_t = darwin.socklen_t;
const system = darwin;

pub fn asError(err: anytype) Errno {
    const int = if (@typeInfo(@TypeOf(err)) == .Enum)
        @intFromEnum(err)
    else
        err;

    return switch (int) {
        1...errno_map.len => |val| errno_map[@intCast(u8, val)],
        else => error.Unexpected,
    };
}
const fd_t = os.fd_t;

const mem = std.mem;
const assert = std.debug.assert;
const c = std.c;
const bun = @import("root").bun;
pub const darwin = struct {
    pub usingnamespace os.darwin;
    pub extern "c" fn @"recvfrom$NOCANCEL"(sockfd: c.fd_t, noalias buf: *anyopaque, len: usize, flags: u32, noalias src_addr: ?*c.sockaddr, noalias addrlen: ?*c.socklen_t) isize;
    pub extern "c" fn @"sendto$NOCANCEL"(sockfd: c.fd_t, buf: *const anyopaque, len: usize, flags: u32, dest_addr: ?*const c.sockaddr, addrlen: c.socklen_t) isize;
    pub extern "c" fn @"fcntl$NOCANCEL"(fd: c.fd_t, cmd: c_int, ...) c_int;
    // pub extern "c" fn @"sendmsg$NOCANCEL"(sockfd: c.fd_t, msg: *const std.x.os.Socket.Message, flags: c_int) isize;
    // pub extern "c" fn @"recvmsg$NOCANCEL"(sockfd: c.fd_t, msg: *std.x.os.Socket.Message, flags: c_int) isize;
    pub extern "c" fn @"connect$NOCANCEL"(sockfd: c.fd_t, sock_addr: *const c.sockaddr, addrlen: c.socklen_t) c_int;
    pub extern "c" fn @"accept$NOCANCEL"(sockfd: c.fd_t, noalias addr: ?*c.sockaddr, noalias addrlen: ?*c.socklen_t) c_int;
    pub extern "c" fn @"accept4$NOCANCEL"(sockfd: c.fd_t, noalias addr: ?*c.sockaddr, noalias addrlen: ?*c.socklen_t, flags: c_uint) c_int;
    pub extern "c" fn @"open$NOCANCEL"(path: [*:0]const u8, oflag: c_uint, ...) c_int;
    pub extern "c" fn @"openat$NOCANCEL"(fd: c.fd_t, path: [*:0]const u8, oflag: c_uint, ...) c_int;
    pub extern "c" fn @"read$NOCANCEL"(fd: c.fd_t, buf: [*]u8, nbyte: usize) isize;
    pub extern "c" fn @"pread$NOCANCEL"(fd: c.fd_t, buf: [*]u8, nbyte: usize, offset: c.off_t) isize;
    pub extern "c" fn @"preadv$NOCANCEL"(fd: c.fd_t, uf: [*]std.os.iovec, count: i32, offset: c.off_t) isize;
    pub extern "c" fn @"readv$NOCANCEL"(fd: c.fd_t, uf: [*]std.os.iovec, count: i32) isize;
    pub extern "c" fn @"write$NOCANCEL"(fd: c.fd_t, buf: [*]const u8, nbyte: usize) isize;
    pub extern "c" fn @"writev$NOCANCEL"(fd: c.fd_t, buf: [*]std.os.iovec_const, count: i32) isize;
    pub extern "c" fn @"pwritev$NOCANCEL"(fd: c.fd_t, buf: [*]std.os.iovec_const, count: i32, offset: c.off_t) isize;
};
pub const OpenError = error{
    /// In WASI, this error may occur when the file descriptor does
    /// not hold the required rights to open a new resource relative to it.
    AccessDenied,
    SymLinkLoop,
    ProcessFdQuotaExceeded,
    SystemFdQuotaExceeded,
    NoDevice,
    FileNotFound,

    /// The path exceeded `MAX_PATH_BYTES` bytes.
    NameTooLong,

    /// Insufficient kernel memory was available, or
    /// the named file is a FIFO and per-user hard limit on
    /// memory allocation for pipes has been reached.
    SystemResources,

    /// The file is too large to be opened. This error is unreachable
    /// for 64-bit targets, as well as when opening directories.
    FileTooBig,

    /// The path refers to directory but the `O.DIRECTORY` flag was not provided.
    IsDir,

    /// A new path cannot be created because the device has no room for the new file.
    /// This error is only reachable when the `O.CREAT` flag is provided.
    NoSpaceLeft,

    /// A component used as a directory in the path was not, in fact, a directory, or
    /// `O.DIRECTORY` was specified and the path was not a directory.
    NotDir,

    /// The path already exists and the `O.CREAT` and `O.EXCL` flags were provided.
    PathAlreadyExists,
    DeviceBusy,

    /// The underlying filesystem does not support file locks
    FileLocksNotSupported,

    BadPathName,
    InvalidUtf8,

    /// One of these three things:
    /// * pathname  refers to an executable image which is currently being
    ///   executed and write access was requested.
    /// * pathname refers to a file that is currently in  use  as  a  swap
    ///   file, and the O_TRUNC flag was specified.
    /// * pathname  refers  to  a file that is currently being read by the
    ///   kernel (e.g., for module/firmware loading), and write access was
    ///   requested.
    FileBusy,

    WouldBlock,
} || Errno;

pub const Syscall = struct {
    pub fn close(fd: std.os.fd_t) CloseError!void {
        return switch (darwin.getErrno(darwin.@"close$NOCANCEL"(fd))) {
            .SUCCESS => {},
            .BADF => error.FileDescriptorInvalid,
            .IO => error.InputOutput,
            else => |err| asError(err),
        };
    }

    pub fn open(path: [*:0]const u8, oflag: c_uint) OpenError!fd_t {
        const fd = darwin.@"open$NOCANCEL"(path, oflag);
        return switch (darwin.getErrno(fd)) {
            .SUCCESS => fd,
            .ACCES => error.AccessDenied,
            .FBIG => error.FileTooBig,
            .OVERFLOW => error.FileTooBig,
            .ISDIR => error.IsDir,
            .LOOP => error.SymLinkLoop,
            .MFILE => error.ProcessFdQuotaExceeded,
            .NAMETOOLONG => error.NameTooLong,
            .NFILE => error.SystemFdQuotaExceeded,
            .NODEV => error.NoDevice,
            .NOENT => error.FileNotFound,
            .NOMEM => error.SystemResources,
            .NOSPC => error.NoSpaceLeft,
            .NOTDIR => error.NotDir,
            .PERM => error.AccessDenied,
            .EXIST => error.PathAlreadyExists,
            .BUSY => error.DeviceBusy,
            else => |err| asError(err),
        };
    }

    pub const SocketError = error{
        /// Permission to create a socket of the specified type and/or
        /// pro‐tocol is denied.
        PermissionDenied,

        /// The implementation does not support the specified address family.
        AddressFamilyNotSupported,

        /// Unknown protocol, or protocol family not available.
        ProtocolFamilyNotAvailable,

        /// The per-process limit on the number of open file descriptors has been reached.
        ProcessFdQuotaExceeded,

        /// The system-wide limit on the total number of open files has been reached.
        SystemFdQuotaExceeded,

        /// Insufficient memory is available. The socket cannot be created until sufficient
        /// resources are freed.
        SystemResources,

        /// The protocol type or the specified protocol is not supported within this domain.
        ProtocolNotSupported,

        /// The socket type is not supported by the protocol.
        SocketTypeNotSupported,
    } || Errno;
    const SOCK = os.SOCK;
    const FD_CLOEXEC = os.FD_CLOEXEC;
    pub fn fcntl(fd: fd_t, cmd: i32, arg: usize) Errno!usize {
        const rc = darwin.@"fcntl$NOCANCEL"(fd, cmd, arg);
        return switch (darwin.getErrno(rc)) {
            .SUCCESS => @intCast(usize, rc),
            else => |err| asError(err),
        };
    }

    const F = std.os.F;
    const O = std.os.O;
    pub fn setSockFlags(sock: socket_t, flags: u32) !void {
        if ((flags & SOCK.CLOEXEC) != 0) {
            var fd_flags = try fcntl(sock, F.GETFD, 0);
            fd_flags |= FD_CLOEXEC;
            _ = try fcntl(sock, F.SETFD, fd_flags);
        }

        if ((flags & SOCK.NONBLOCK) != 0) {
            var fl_flags = try fcntl(sock, F.GETFL, 0);
            fl_flags |= O.NONBLOCK;
            _ = try fcntl(sock, F.SETFL, fl_flags);
        }
    }

    pub const SetSockOptError = error{
        /// The socket is already connected, and a specified option cannot be set while the socket is connected.
        AlreadyConnected,

        /// The option is not supported by the protocol.
        InvalidProtocolOption,

        /// The send and receive timeout values are too big to fit into the timeout fields in the socket structure.
        TimeoutTooBig,

        /// Insufficient resources are available in the system to complete the call.
        SystemResources,

        // Setting the socket option requires more elevated permissions.
        PermissionDenied,

        NetworkSubsystemFailed,
        FileDescriptorNotASocket,
        SocketNotBound,
    } || Errno;

    pub fn setsockopt(fd: socket_t, level: u32, optname: u32, opt: []const u8) SetSockOptError!void {
        switch (darwin.getErrno(darwin.setsockopt(fd, level, optname, opt.ptr, @intCast(socklen_t, opt.len)))) {
            .SUCCESS => {},
            .DOM => return error.TimeoutTooBig,
            .ISCONN => return error.AlreadyConnected,
            .NOPROTOOPT => return error.InvalidProtocolOption,
            .NOMEM => return error.SystemResources,
            .NOBUFS => return error.SystemResources,
            .PERM => return error.PermissionDenied,
            else => |err| return asError(err),
        }
    }

    pub fn socket(domain: u32, socket_type: u32, protocol: u32) SocketError!socket_t {
        const filtered_sock_type = socket_type & ~@as(u32, os.SOCK.NONBLOCK | os.SOCK.CLOEXEC);
        const rc = darwin.socket(domain, filtered_sock_type, protocol);
        switch (darwin.getErrno(rc)) {
            .SUCCESS => {
                const fd = @intCast(fd_t, rc);
                try setSockFlags(fd, socket_type);
                return fd;
            },
            .ACCES => return error.PermissionDenied,
            .AFNOSUPPORT => return error.AddressFamilyNotSupported,
            .INVAL => return error.ProtocolFamilyNotAvailable,
            .MFILE => return error.ProcessFdQuotaExceeded,
            .NFILE => return error.SystemFdQuotaExceeded,
            .NOBUFS => return error.SystemResources,
            .NOMEM => return error.SystemResources,
            .PROTONOSUPPORT => return error.ProtocolNotSupported,
            .PROTOTYPE => return error.SocketTypeNotSupported,
            else => |err| return asError(err),
        }
    }
};

const FIFO = @import("./fifo.zig").FIFO;
const Time = @import("./time.zig").Time;

const IO = @This();

time: Time = .{},
io_inflight: usize = 0,
timeouts: FIFO(Completion) = .{},
completed: FIFO(Completion) = .{},
io_pending: FIFO(Completion) = .{},
last_event_fd: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(32),
pending_count: usize = 0,
waker: Waker = undefined,

pub fn hasNoWork(this: *IO) bool {
    return this.pending_count == 0 and this.io_inflight == 0 and this.io_pending.peek() == null and this.completed.peek() == null and this.timeouts.peek() == null;
}

pub fn init(_: u12, _: u32, waker: Waker) !IO {
    return IO{
        .waker = waker,
    };
}

pub const Waker = struct {
    kq: os.fd_t,
    machport: *anyopaque = undefined,
    machport_buf: []u8 = &.{},
    has_pending_wake: bool = false,

    const zeroed = std.mem.zeroes([16]Kevent64);

    pub fn wake(this: *Waker) !void {
        bun.JSC.markBinding(@src());

        if (io_darwin_schedule_wakeup(this.machport)) {
            this.has_pending_wake = false;
            return;
        }
        this.has_pending_wake = true;
    }

    pub fn wait(this: Waker) !usize {
        bun.JSC.markBinding(@src());
        var events = zeroed;

        const count = std.os.system.kevent64(
            this.kq,
            &events,
            0,
            &events,
            events.len,
            0,
            null,
        );

        if (count < 0) {
            return asError(std.c.getErrno(count));
        }

        return @intCast(usize, count);
    }

    extern fn io_darwin_create_machport(
        *anyopaque,
        os.fd_t,
        *anyopaque,
        usize,
    ) ?*anyopaque;

    extern fn io_darwin_schedule_wakeup(
        *anyopaque,
    ) bool;

    pub fn init(allocator: std.mem.Allocator) !Waker {
        return initWithFileDescriptor(allocator, try std.os.kqueue());
    }

    pub fn initWithFileDescriptor(allocator: std.mem.Allocator, kq: i32) !Waker {
        bun.JSC.markBinding(@src());
        assert(kq > -1);
        var machport_buf = try allocator.alloc(u8, 1024);
        const machport = io_darwin_create_machport(
            machport_buf.ptr,
            kq,
            machport_buf.ptr,
            1024,
        ) orelse return error.MachportCreationFailed;

        return Waker{
            .kq = kq,
            .machport = machport,
            .machport_buf = machport_buf,
        };
    }
};

pub const UserFilterWaker = struct {
    kq: os.fd_t,
    ident: u64 = undefined,

    pub fn wake(this: UserFilterWaker) !void {
        bun.JSC.markBinding(@src());
        var events = zeroed;
        events[0].ident = this.ident;
        events[0].filter = c.EVFILT_USER;
        events[0].data = 0;
        events[0].fflags = c.NOTE_TRIGGER;
        events[0].udata = 0;
        const errno = std.os.system.kevent64(
            this.kq,
            &events,
            1,
            &events,
            events.len,
            0,
            null,
        );

        if (errno < 0) {
            return asError(std.c.getErrno(errno));
        }
    }

    const zeroed = std.mem.zeroes([16]Kevent64);

    pub fn wait(this: UserFilterWaker) !u64 {
        var events = zeroed;
        events[0].ident = 123;
        events[0].filter = c.EVFILT_USER;
        events[0].flags = c.EV_ADD | c.EV_ENABLE;
        events[0].data = 0;
        events[0].udata = 0;

        const errno = std.os.system.kevent64(
            this.kq,
            &events,
            1,
            &events,
            events.len,
            0,
            null,
        );
        if (errno < 0) {
            return asError(std.c.getErrno(errno));
        }

        return @intCast(u64, errno);
    }

    pub fn init(_: std.mem.Allocator) !UserFilterWaker {
        const kq = try os.kqueue();
        assert(kq > -1);

        var events = [1]Kevent64{std.mem.zeroes(Kevent64)};
        events[0].ident = 123;
        events[0].filter = c.EVFILT_USER;
        events[0].flags = c.EV_ADD | c.EV_ENABLE;
        events[0].data = 0;
        events[0].udata = 0;
        var timespec = default_timespec;
        const errno = std.os.system.kevent64(
            kq,
            &events,
            1,
            &events,
            @intCast(c_int, events.len),
            0,
            &timespec,
        );

        std.debug.assert(errno == 0);

        return UserFilterWaker{
            .kq = kq,
            .ident = 123,
        };
    }
};

pub fn deinit(self: *IO) void {
    assert(self.waker.kq > -1);
    os.close(self.waker.kq);
    self.waker.kq = -1;
}

/// Pass all queued submissions to the kernel and peek for completions.
pub fn tick(self: *IO) !void {
    return self.flush(.no_wait);
}

const Kevent64 = std.os.system.kevent64_s;

/// Pass all queued submissions to the kernel and run for `nanoseconds`.
/// The `nanoseconds` argument is a u63 to allow coercion to the i64 used
/// in the __kernel_timespec struct.
pub fn run_for_ns(self: *IO, nanoseconds: u63) !void {
    var timed_out = false;
    var completion: Completion = undefined;
    const on_timeout = struct {
        fn callback(
            timed_out_ptr: *bool,
            _: *Completion,
            _: TimeoutError!void,
        ) void {
            timed_out_ptr.* = true;
        }
    }.callback;

    // Submit a timeout which sets the timed_out value to true to terminate the loop below.
    self.timeoutInternal(
        *bool,
        &timed_out,
        on_timeout,
        &completion,
        nanoseconds,
    );

    // Loop until our timeout completion is processed above, which sets timed_out to true.
    // LLVM shouldn't be able to cache timed_out's value here since its address escapes above.
    while (!timed_out) {
        try self.flush(.wait_for_completion);
    }
}

const default_timespec = std.mem.zeroInit(os.timespec, .{});

pub fn wait(self: *IO, context: anytype, comptime function: anytype) void {
    self.flush(.block) catch unreachable;
    function(context);
}

fn flush(self: *IO, comptime _: @Type(.EnumLiteral)) !void {
    var io_pending = self.io_pending.peek();
    var events: [2048]Kevent64 = undefined;

    // Check timeouts and fill events with completions in io_pending
    // (they will be submitted through kevent).
    // Timeouts are expired here and possibly pushed to the completed queue.
    const next_timeout = self.flush_timeouts();

    // Flush any timeouts
    {
        var completed = self.completed;
        self.completed = .{};
        if (completed.pop()) |first| {
            (first.callback)(self, first);

            while (completed.pop()) |completion|
                (completion.callback)(self, completion);

            return;
        }
    }

    const change_events = self.flush_io(&events, &io_pending);

    // Zero timeouts for kevent() implies a non-blocking poll
    var ts = default_timespec;

    // We need to wait (not poll) on kevent if there's nothing to submit or complete.
    if (next_timeout) |timeout_ns| {
        ts.tv_nsec = @intCast(@TypeOf(ts.tv_nsec), timeout_ns % std.time.ns_per_s);
        ts.tv_sec = @intCast(@TypeOf(ts.tv_sec), timeout_ns / std.time.ns_per_s);
    }

    const new_events_ = std.os.system.kevent64(
        self.waker.kq,
        &events,
        @intCast(c_int, change_events),
        &events,
        @intCast(c_int, events.len),
        0,
        if (next_timeout != null) &ts else null,
    );

    if (new_events_ < 0) {
        return std.debug.panic("kevent() failed {s}", .{@tagName(std.c.getErrno(new_events_))});
    }
    const new_events = @intCast(usize, new_events_);

    // Mark the io events submitted only after kevent() successfully processed them
    self.io_pending.out = io_pending;
    if (io_pending == null) {
        self.io_pending.in = null;
    }

    var new_io_inflight_events = new_events;
    self.io_inflight += change_events;

    for (events[0..new_events]) |kevent| {
        if (kevent.filter == c.EVFILT_MACHPORT) {
            new_io_inflight_events -= 1;
            continue;
        }

        const completion = @ptrFromInt(*Completion, kevent.udata);
        completion.next = null;
        self.completed.push(completion);
    }

    // subtract machport events from io_inflight
    self.io_inflight -= new_io_inflight_events;

    var completed = self.completed;
    self.completed = .{};
    while (completed.pop()) |completion| {
        (completion.callback)(self, completion);
    }
}

fn flush_io(_: *IO, events: []Kevent64, io_pending_top: *?*Completion) usize {
    for (events, 0..) |*kevent, flushed| {
        const completion = io_pending_top.* orelse return flushed;
        io_pending_top.* = completion.next;
        const event_info = switch (completion.operation) {
            .accept => |op| [3]c_int{
                op.socket,
                c.EVFILT_READ,
                c.EV_ADD | c.EV_ENABLE | c.EV_ONESHOT,
            },
            .connect => |op| [3]c_int{
                op.socket,
                c.EVFILT_WRITE,
                c.EV_ADD | c.EV_ENABLE | c.EV_ONESHOT,
            },
            .read => |op| [3]c_int{
                op.fd,
                c.EVFILT_READ,
                c.EV_ADD | c.EV_ENABLE | c.EV_ONESHOT,
            },
            .write => |op| [3]c_int{
                op.fd,
                c.EVFILT_WRITE,
                c.EV_ADD | c.EV_ENABLE | c.EV_ONESHOT,
            },
            .recv => |op| [3]c_int{
                op.socket,
                c.EVFILT_READ,
                c.EV_ADD | c.EV_ENABLE | c.EV_ONESHOT,
            },
            .send => |op| [3]c_int{
                op.socket,
                c.EVFILT_WRITE,
                c.EV_ADD | c.EV_ENABLE | c.EV_ONESHOT,
            },
            .event => |op| [3]c_int{
                op.fd,
                c.EVFILT_USER,
                c.EV_ADD | c.EV_ENABLE | c.EV_ONESHOT,
            },
            else => @panic("invalid completion operation queued for io"),
        };

        kevent.* = .{
            .ext = [2]u64{ 0, 0 },
            .ident = @intCast(u32, event_info[0]),
            .filter = @intCast(i16, event_info[1]),
            .flags = @intCast(u16, event_info[2]),
            .fflags = 0,
            .data = 0,
            .udata = @intFromPtr(completion),
        };
    }

    return events.len;
}

fn flush_timeouts(self: *IO) ?u64 {
    var min_timeout: ?u64 = null;
    var timeouts: ?*Completion = self.timeouts.peek();

    // NOTE: We could cache `now` above the loop but monotonic() should be cheap to call.
    const now: u64 = if (timeouts != null) self.time.monotonic() else 0;

    while (timeouts) |completion| {
        timeouts = completion.next;

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
            min_timeout = @min(min_ns, timeout_ns);
        } else {
            min_timeout = timeout_ns;
        }
    }
    return min_timeout;
}

/// This struct holds the data needed for a single IO operation
pub const Completion = struct {
    next: ?*Completion,
    context: ?*anyopaque,
    callback: *const fn (*IO, *Completion) void,
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
        positional: bool = true,
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
    nextTick: struct {},

    pub fn slice(this: Operation) []const u8 {
        return switch (this) {
            .write => |op| op.buf[0..op.len],
            .send => |op| op.buf[0..op.len],
            .recv => |op| op.buf[0..op.len],
            .read => |op| op.buf[0..op.len],
            else => &[_]u8{},
        };
    }
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
    submitWithIncrementPending(self, context, callback, completion, operation_tag, operation_data, OperationImpl, true);
}

fn submitWithIncrementPending(
    self: *IO,
    context: anytype,
    comptime callback: anytype,
    completion: *Completion,
    comptime operation_tag: std.meta.Tag(Operation),
    operation_data: anytype,
    comptime OperationImpl: type,
    comptime increment_pending: bool,
) void {
    if (comptime increment_pending)
        self.pending_count += 1;
    const Context = @TypeOf(context);
    const onCompleteFn = struct {
        fn onComplete(
            io: *IO,
            _completion: *Completion,
        ) void {
            // Perform the actual operaton
            const op_data = &@field(_completion.operation, @tagName(operation_tag));

            const result = OperationImpl.doOperation(op_data);

            // Requeue onto io_pending if error.WouldBlock
            switch (comptime operation_tag) {
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

            if (comptime increment_pending)
                io.pending_count -= 1;

            // Complete the Completion
            return callback(
                @ptrFromInt(Context, @intFromPtr(_completion.context)),
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

// -- NOT DONE YET
pub fn event(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
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
            fn doOperation(_: anytype) void {}
        },
    );
}

pub fn nextTick(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: void,
    ) void,
    completion: *Completion,
) void {
    self.submit(
        context,
        callback,
        completion,
        .nextTick,
        .{},
        struct {
            fn doOperation(_: anytype) void {}
        },
    );
}

pub fn accept(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
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
                    os.SOCK.NONBLOCK | os.SOCK.CLOEXEC,
                );
                errdefer {
                    Syscall.close(fd) catch {};
                }

                // darwin doesn't support os.MSG.NOSIGNAL,
                // but instead a socket option to avoid SIGPIPE.
                Syscall.setsockopt(fd, os.SOL_SOCKET, os.SO_NOSIGPIPE, &mem.toBytes(@as(c_int, 1))) catch |err| return switch (err) {
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
} || Errno;

pub fn close(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
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
                return Syscall.close(op.fd);
            }
        },
    );
}

pub const ConnectError = error{
    AddressFamilyNotSupported,
    AddressInUse,
    AddressNotAvailable,
    ConnectionPending,
    ConnectionRefused,
    ConnectionResetByPeer,
    ConnectionTimedOut,
    NetworkUnreachable,
    PermissionDenied,
    SystemResources,
    WouldBlock,
} || Errno;

pub fn connect(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: IO.ConnectError!void,
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
            fn doOperation(op: anytype) IO.ConnectError!void {
                // Don't call connect after being rescheduled by io_pending as it gives EISCONN.
                // Instead, check the socket error to see if has been connected successfully.
                const result = switch (op.initiated) {
                    true => brk: {
                        var err_code: i32 = undefined;
                        var size: u32 = @sizeOf(u32);
                        const rc = system.getsockopt(op.socket, os.SOL.SOCKET, os.SO.ERROR, @ptrCast([*]u8, &err_code), &size);
                        assert(size == 4);
                        break :brk switch (darwin.getErrno(rc)) {
                            .SUCCESS => switch (@enumFromInt(os.E, err_code)) {
                                .SUCCESS => {},
                                .ACCES => error.PermissionDenied,
                                .PERM => error.PermissionDenied,
                                .ADDRINUSE => error.AddressInUse,
                                .ADDRNOTAVAIL => error.AddressNotAvailable,
                                .AFNOSUPPORT => error.AddressFamilyNotSupported,
                                .AGAIN => error.SystemResources,
                                .ALREADY => error.ConnectionPending,
                                .CONNREFUSED => error.ConnectionRefused,
                                // .FAULT => unreachable, // The socket structure address is outside the user's address space.
                                // .ISCONN => unreachable, // The socket is already connected.
                                .NETUNREACH => error.NetworkUnreachable,
                                // .NOTSOCK => unreachable, // The file descriptor sockfd does not refer to a socket.
                                // .PROTOTYPE => unreachable, // The socket type does not support the requested communications protocol.
                                .TIMEDOUT => error.ConnectionTimedOut,
                                .CONNRESET => error.ConnectionResetByPeer,
                                else => |err| asError(err),
                            },
                            else => |err| asError(err),
                        };
                    },
                    else => switch (darwin.getErrno(darwin.@"connect$NOCANCEL"(op.socket, &op.address.any, op.address.getOsSockLen()))) {
                        .SUCCESS => {},
                        .ACCES => error.PermissionDenied,
                        .PERM => error.PermissionDenied,
                        .ADDRINUSE => error.AddressInUse,
                        .ADDRNOTAVAIL => error.AddressNotAvailable,
                        .AFNOSUPPORT => error.AddressFamilyNotSupported,
                        .AGAIN, .INPROGRESS => error.WouldBlock,
                        .ALREADY => error.ConnectionPending,
                        .CONNREFUSED => error.ConnectionRefused,
                        .CONNRESET => error.ConnectionResetByPeer,
                        .NETUNREACH => error.NetworkUnreachable,
                        .TIMEDOUT => error.ConnectionTimedOut,
                        else => |err| asError(err),
                    },
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
    comptime callback: *const fn (
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

/// macOS does not support reading for readiness for open()
/// so we just run this blocking
pub fn open(
    _: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: OpenError!fd_t,
    ) void,
    completion: *Completion,
    file_path: [:0]const u8,
    flags: os.mode_t,
    _: os.mode_t,
) void {
    callback(context, completion, openSync(file_path, flags));
}

pub fn openSync(
    file_path: [:0]const u8,
    flags: os.mode_t,
) OpenError!fd_t {
    return Syscall.open(file_path, @intCast(c_uint, flags));
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
} || Errno;

pub fn read(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: ReadError!usize,
    ) void,
    completion: *Completion,
    fd: os.fd_t,
    buffer: []u8,
    offset: ?u64,
) void {
    const offset_ = offset orelse @as(u64, 0);
    self.submit(
        context,
        callback,
        completion,
        .read,
        .{
            .fd = fd,
            .buf = buffer.ptr,
            .len = @intCast(u32, buffer_limit(buffer.len)),
            .offset = offset_,
            .positional = offset != null,
        },
        struct {
            fn doOperation(op: anytype) ReadError!usize {
                while (true) {
                    const rc = os.system.read(
                        op.fd,
                        op.buf,
                        op.len,
                    );
                    return switch (@intFromEnum(os.errno(rc))) {
                        0 => @intCast(usize, rc),
                        os.EINTR => continue,
                        os.EAGAIN => error.WouldBlock,
                        os.EBADF => error.NotOpenForReading,
                        os.ECONNRESET => error.ConnectionResetByPeer,
                        os.EINVAL => error.Alignment,
                        os.EIO => error.InputOutput,
                        os.EISDIR => error.IsDir,
                        os.ENOBUFS => error.SystemResources,
                        os.ENOMEM => error.SystemResources,
                        os.ENXIO => error.Unseekable,
                        os.EOVERFLOW => error.Unseekable,
                        os.ESPIPE => error.Unseekable,
                        else => |err| asError(err),
                    };
                }
            }
        },
    );
}

pub const RecvError = error{
    SystemResources,
    ConnectionRefused,
    ConnectionResetByPeer,
    WouldBlock,
} || Errno;

pub fn recv(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
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
                const rc = system.@"recvfrom$NOCANCEL"(op.socket, op.buf, op.len, 0, null, null);
                return switch (system.getErrno(rc)) {
                    .SUCCESS => @intCast(usize, rc),
                    .AGAIN => error.WouldBlock,
                    .NOMEM => error.SystemResources,
                    .CONNREFUSED => error.ConnectionRefused,
                    .CONNRESET => error.ConnectionResetByPeer,
                    else => |err| asError(err),
                };
            }
        },
    );
}

pub const SendError = error{
    AccessDenied,
    AddressFamilyNotSupported,
    BrokenPipe,
    ConnectionResetByPeer,
    FastOpenAlreadyInProgress,
    FileNotFound,
    MessageTooBig,
    NameTooLong,
    NetworkSubsystemFailed,
    NetworkUnreachable,
    NotDir,
    SocketNotConnected,
    SymLinkLoop,
    SystemResources,
    WouldBlock,
} || Errno;

pub fn send(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
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
                const rc = system.@"sendto$NOCANCEL"(op.socket, op.buf, op.len, op.flags, null, 0);
                return switch (system.getErrno(rc)) {
                    .SUCCESS => @intCast(usize, rc),
                    .ACCES => error.AccessDenied,
                    .AGAIN => error.WouldBlock,
                    .ALREADY => error.FastOpenAlreadyInProgress,
                    .CONNRESET => error.ConnectionResetByPeer,
                    .MSGSIZE => error.MessageTooBig,
                    .NOBUFS => error.SystemResources,
                    .NOMEM => error.SystemResources,
                    .PIPE => error.BrokenPipe,
                    .AFNOSUPPORT => error.AddressFamilyNotSupported,
                    .LOOP => error.SymLinkLoop,
                    .NAMETOOLONG => error.NameTooLong,
                    .NOENT => error.FileNotFound,
                    .NOTDIR => error.NotDir,
                    .HOSTUNREACH => error.NetworkUnreachable,
                    .NETUNREACH => error.NetworkUnreachable,
                    .NOTCONN => error.SocketNotConnected,
                    .NETDOWN => error.NetworkSubsystemFailed,
                    else => |err| asError(err),
                };
            }
        },
    );
}

pub const TimeoutError = error{Canceled} || Errno;

pub fn timeout(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
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

fn timeoutInternal(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: TimeoutError!void,
    ) void,
    completion: *Completion,
    nanoseconds: u63,
) void {
    self.submitWithIncrementPending(
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
        false,
    );
}

pub const WriteError = os.PWriteError;

pub fn write(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
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

                // Unlike Linux, macOS doesn't ignore file offsets for unseekable files, so we have to
                // use write() instead of pwrite().
                return std.os.write(op.fd, op.buf[0..op.len]);
            }
        },
    );
}

pub fn openSocket(family: u32, sock_type: u32, protocol: u32) !os.socket_t {
    const fd = try Syscall.socket(family, sock_type | os.SOCK.NONBLOCK, protocol);
    errdefer {
        Syscall.close(fd) catch {};
    }

    // darwin doesn't support os.MSG.NOSIGNAL, but instead a socket option to avoid SIGPIPE.
    try Syscall.setsockopt(fd, os.SOL.SOCKET, os.SO.NOSIGPIPE, &mem.toBytes(@as(c_int, 1)));
    return fd;
}

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

pub var global: IO = undefined;
pub var global_loaded: bool = false;
