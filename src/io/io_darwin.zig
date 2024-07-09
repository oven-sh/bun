const std = @import("std");
const os = struct {
    pub usingnamespace std.posix;
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

const socket_t = os.socket_t;
const sockaddr = darwin.sockaddr;
const socklen_t = darwin.socklen_t;
pub const system = darwin;

const fd_t = os.fd_t;

const mem = std.mem;
const assert = bun.assert;
const c = std.c;
const bun = @import("root").bun;
pub const darwin = struct {
    pub usingnamespace c;
    pub extern "c" fn @"recvfrom$NOCANCEL"(sockfd: c.fd_t, noalias buf: *anyopaque, len: usize, flags: u32, noalias src_addr: ?*c.sockaddr, noalias addrlen: ?*c.socklen_t) isize;
    pub extern "c" fn @"sendto$NOCANCEL"(sockfd: c.fd_t, buf: *const anyopaque, len: usize, flags: u32, dest_addr: ?*const c.sockaddr, addrlen: c.socklen_t) isize;
    pub extern "c" fn @"fcntl$NOCANCEL"(fd: c.fd_t, cmd: c_int, ...) c_int;
    // pub extern "c" fn @"sendmsg$NOCANCEL"(sockfd: c.fd_t, msg: *const std.x.os.Socket.Message, flags: c_int) isize;
    // pub extern "c" fn @"recvmsg$NOCANCEL"(sockfd: c.fd_t, msg: *std.x.os.Socket.Message, flags: c_int) isize;
    pub extern "c" fn @"connect$NOCANCEL"(sockfd: c.fd_t, sock_addr: *const c.sockaddr, addrlen: c.socklen_t) c_int;
    pub extern "c" fn @"accept$NOCANCEL"(sockfd: c.fd_t, noalias addr: ?*c.sockaddr, noalias addrlen: ?*c.socklen_t) c_int;
    pub extern "c" fn @"accept4$NOCANCEL"(sockfd: c.fd_t, noalias addr: ?*c.sockaddr, noalias addrlen: ?*c.socklen_t, flags: c_uint) c_int;
    pub extern "c" fn @"open$NOCANCEL"(path: [*:0]const u8, oflag: c_uint, ...) c_int;
    // https://opensource.apple.com/source/xnu/xnu-7195.81.3/libsyscall/wrappers/open-base.c
    pub extern "c" fn @"openat$NOCANCEL"(fd: c.fd_t, path: [*:0]const u8, oflag: c_uint, ...) c_int;
    pub extern "c" fn @"read$NOCANCEL"(fd: c.fd_t, buf: [*]u8, nbyte: usize) isize;
    pub extern "c" fn @"pread$NOCANCEL"(fd: c.fd_t, buf: [*]u8, nbyte: usize, offset: c.off_t) isize;
    pub extern "c" fn @"preadv$NOCANCEL"(fd: c.fd_t, uf: [*]std.posix.iovec, count: i32, offset: c.off_t) isize;
    pub extern "c" fn @"readv$NOCANCEL"(fd: c.fd_t, uf: [*]std.posix.iovec, count: i32) isize;
    pub extern "c" fn @"write$NOCANCEL"(fd: c.fd_t, buf: [*]const u8, nbyte: usize) isize;
    pub extern "c" fn @"writev$NOCANCEL"(fd: c.fd_t, buf: [*]const std.posix.iovec_const, count: i32) isize;
    pub extern "c" fn @"pwritev$NOCANCEL"(fd: c.fd_t, buf: [*]const std.posix.iovec_const, count: i32, offset: c.off_t) isize;
};
const IO = @This();

pub fn init(_: u12, _: u32, waker: Waker) !IO {
    return IO{
        .waker = waker,
    };
}
const Kevent64 = std.posix.system.kevent64_s;
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

    pub fn getFd(this: *const Waker) bun.FileDescriptor {
        return bun.toFD(this.kq);
    }

    pub fn wait(this: Waker) void {
        bun.JSC.markBinding(@src());
        var events = zeroed;

        _ = std.posix.system.kevent64(
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

    pub fn init() !Waker {
        return initWithFileDescriptor(bun.default_allocator, try std.posix.kqueue());
    }

    pub fn initWithFileDescriptor(allocator: std.mem.Allocator, kq: i32) !Waker {
        bun.JSC.markBinding(@src());
        assert(kq > -1);
        const machport_buf = try allocator.alloc(u8, 1024);
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
//         const errno = std.posix.system.kevent64(
//             this.kq,
//             &events,
//             1,
//             &events,
//             events.len,
//             0,
//             null,
//         );

//         if (errno < 0) {
//             return asError(bun.C.getErrno(errno));
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

//         const errno = std.posix.system.kevent64(
//             this.kq,
//             &events,
//             1,
//             &events,
//             events.len,
//             0,
//             null,
//         );
//         if (errno < 0) {
//             return asError(bun.C.getErrno(errno));
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
//         const errno = std.posix.system.kevent64(
//             kq,
//             &events,
//             1,
//             &events,
//             @as(c_int, @intCast(events.len)),
//             0,
//             &timespec,
//         );

//         bun.assert(errno == 0);

//         return UserFilterWaker{
//             .kq = kq,
//             .ident = 123,
//         };
//     }
// };
