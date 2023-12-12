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
pub const system = darwin;

pub fn asError(err: anytype) Errno {
    const int = if (@typeInfo(@TypeOf(err)) == .Enum)
        @intFromEnum(err)
    else
        err;

    return switch (int) {
        1...errno_map.len => |val| errno_map[@as(u8, @intCast(val))],
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
const IO = @This();

pub fn init(_: u12, _: u32, waker: Waker) !IO {
    return IO{
        .waker = waker,
    };
}
const Kevent64 = std.os.system.kevent64_s;
pub const Waker = struct {
    kq: os.fd_t,
    machport: *anyopaque = undefined,
    machport_buf: []u8 = &.{},
    has_pending_wake: bool = false,

    const zeroed = std.mem.zeroes([16]Kevent64);

    pub fn wake(this: *Waker) void {
        bun.JSC.markBinding(@src());

        if (io_darwin_schedule_wakeup(this.machport)) {
            this.has_pending_wake = false;
            return;
        }
        this.has_pending_wake = true;
    }

    pub fn getFd(this: *const Waker) os.fd_t {
        return this.kq;
    }

    pub fn wait(this: Waker) void {
        bun.JSC.markBinding(@src());
        var events = zeroed;

        _ = std.os.system.kevent64(
            this.kq,
            &events,
            0,
            &events,
            events.len,
            0,
            null,
        );
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

// pub const UserFilterWaker = struct {
//     kq: os.fd_t,
//     ident: u64 = undefined,

//     pub fn wake(this: UserFilterWaker) !void {
//         bun.JSC.markBinding(@src());
//         var events = zeroed;
//         events[0].ident = this.ident;
//         events[0].filter = c.EVFILT_USER;
//         events[0].data = 0;
//         events[0].fflags = c.NOTE_TRIGGER;
//         events[0].udata = 0;
//         const errno = std.os.system.kevent64(
//             this.kq,
//             &events,
//             1,
//             &events,
//             events.len,
//             0,
//             null,
//         );

//         if (errno < 0) {
//             return asError(std.c.getErrno(errno));
//         }
//     }

//     const zeroed = std.mem.zeroes([16]Kevent64);

//     pub fn wait(this: UserFilterWaker) !u64 {
//         var events = zeroed;
//         events[0].ident = 123;
//         events[0].filter = c.EVFILT_USER;
//         events[0].flags = c.EV_ADD | c.EV_ENABLE;
//         events[0].data = 0;
//         events[0].udata = 0;

//         const errno = std.os.system.kevent64(
//             this.kq,
//             &events,
//             1,
//             &events,
//             events.len,
//             0,
//             null,
//         );
//         if (errno < 0) {
//             return asError(std.c.getErrno(errno));
//         }

//         return @as(u64, @intCast(errno));
//     }

//     pub fn init(_: std.mem.Allocator) !UserFilterWaker {
//         const kq = try os.kqueue();
//         assert(kq > -1);

//         var events = [1]Kevent64{std.mem.zeroes(Kevent64)};
//         events[0].ident = 123;
//         events[0].filter = c.EVFILT_USER;
//         events[0].flags = c.EV_ADD | c.EV_ENABLE;
//         events[0].data = 0;
//         events[0].udata = 0;
//         var timespec = default_timespec;
//         const errno = std.os.system.kevent64(
//             kq,
//             &events,
//             1,
//             &events,
//             @as(c_int, @intCast(events.len)),
//             0,
//             &timespec,
//         );

//         std.debug.assert(errno == 0);

//         return UserFilterWaker{
//             .kq = kq,
//             .ident = 123,
//         };
//     }
// };
