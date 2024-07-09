const std = @import("std");
const assert = bun.assert;
const Platform = bun.analytics.GenerateHeader.GeneratePlatform;
const os = struct {
    pub usingnamespace std.posix;
    pub const EPERM = 1;
    pub const ENOENT = 2;
    pub const ESRCH = 3;
    pub const EINTR = 4;
    pub const EIO = 5;
    pub const ENXIO = 6;
    pub const E2BIG = 7;
    pub const ENOEXEC = 8;
    pub const EBADF = 9;
    pub const ECHILD = 10;
    pub const EAGAIN = 11;
    pub const ENOMEM = 12;
    pub const EACCES = 13;
    pub const EFAULT = 14;
    pub const ENOTBLK = 15;
    pub const EBUSY = 16;
    pub const EEXIST = 17;
    pub const EXDEV = 18;
    pub const ENODEV = 19;
    pub const ENOTDIR = 20;
    pub const EISDIR = 21;
    pub const EINVAL = 22;
    pub const ENFILE = 23;
    pub const EMFILE = 24;
    pub const ENOTTY = 25;
    pub const ETXTBSY = 26;
    pub const EFBIG = 27;
    pub const ENOSPC = 28;
    pub const ESPIPE = 29;
    pub const EROFS = 30;
    pub const EMLINK = 31;
    pub const EPIPE = 32;
    pub const EDOM = 33;
    pub const ERANGE = 34;
    pub const EDEADLK = 35;
    pub const ENAMETOOLONG = 36;
    pub const ENOLCK = 37;
    pub const ENOSYS = 38;
    pub const ENOTEMPTY = 39;
    pub const ELOOP = 40;
    pub const EWOULDBLOCK = 41;
    pub const ENOMSG = 42;
    pub const EIDRM = 43;
    pub const ECHRNG = 44;
    pub const EL2NSYNC = 45;
    pub const EL3HLT = 46;
    pub const EL3RST = 47;
    pub const ELNRNG = 48;
    pub const EUNATCH = 49;
    pub const ENOCSI = 50;
    pub const EL2HLT = 51;
    pub const EBADE = 52;
    pub const EBADR = 53;
    pub const EXFULL = 54;
    pub const ENOANO = 55;
    pub const EBADRQC = 56;
    pub const EBADSLT = 57;
    pub const EDEADLOCK = 58;
    pub const EBFONT = 59;
    pub const ENOSTR = 60;
    pub const ENODATA = 61;
    pub const ETIME = 62;
    pub const ENOSR = 63;
    pub const ENONET = 64;
    pub const ENOPKG = 65;
    pub const EREMOTE = 66;
    pub const ENOLINK = 67;
    pub const EADV = 68;
    pub const ESRMNT = 69;
    pub const ECOMM = 70;
    pub const EPROTO = 71;
    pub const EMULTIHOP = 72;
    pub const EDOTDOT = 73;
    pub const EBADMSG = 74;
    pub const EOVERFLOW = 75;
    pub const ENOTUNIQ = 76;
    pub const EBADFD = 77;
    pub const EREMCHG = 78;
    pub const ELIBACC = 79;
    pub const ELIBBAD = 80;
    pub const ELIBSCN = 81;
    pub const ELIBMAX = 82;
    pub const ELIBEXEC = 83;
    pub const EILSEQ = 84;
    pub const ERESTART = 85;
    pub const ESTRPIPE = 86;
    pub const EUSERS = 87;
    pub const ENOTSOCK = 88;
    pub const EDESTADDRREQ = 89;
    pub const EMSGSIZE = 90;
    pub const EPROTOTYPE = 91;
    pub const ENOPROTOOPT = 92;
    pub const EPROTONOSUPPORT = 93;
    pub const ESOCKTNOSUPPORT = 94;
    /// For Linux, EOPNOTSUPP is the real value
    /// but it's ~the same and is incompatible across operating systems
    /// https://lists.gnu.org/archive/html/bug-glibc/2002-08/msg00017.html
    pub const ENOTSUP = 95;
    pub const EOPNOTSUPP = ENOTSUP;
    pub const EPFNOSUPPORT = 96;
    pub const EAFNOSUPPORT = 97;
    pub const EADDRINUSE = 98;
    pub const EADDRNOTAVAIL = 99;
    pub const ENETDOWN = 100;
    pub const ENETUNREACH = 101;
    pub const ENETRESET = 102;
    pub const ECONNABORTED = 103;
    pub const ECONNRESET = 104;
    pub const ENOBUFS = 105;
    pub const EISCONN = 106;
    pub const ENOTCONN = 107;
    pub const ESHUTDOWN = 108;
    pub const ETOOMANYREFS = 109;
    pub const ETIMEDOUT = 110;
    pub const ECONNREFUSED = 111;
    pub const EHOSTDOWN = 112;
    pub const EHOSTUNREACH = 113;
    pub const EALREADY = 114;
    pub const EINPROGRESS = 115;
    pub const ESTALE = 116;
    pub const EUCLEAN = 117;
    pub const ENOTNAM = 118;
    pub const ENAVAIL = 119;
    pub const EISNAM = 120;
    pub const EREMOTEIO = 121;
    pub const EDQUOT = 122;
    pub const ENOMEDIUM = 123;
    pub const EMEDIUMTYPE = 124;
    pub const ECANCELED = 125;
    pub const ENOKEY = 126;
    pub const EKEYEXPIRED = 127;
    pub const EKEYREVOKED = 128;
    pub const EKEYREJECTED = 129;
    pub const EOWNERDEAD = 130;
    pub const ENOTRECOVERABLE = 131;
    pub const ERFKILL = 132;
    pub const EHWPOISON = 133;
};

const bun = @import("root").bun;
pub const Waker = struct {
    fd: bun.FileDescriptor,

    pub fn init() !Waker {
        return initWithFileDescriptor(bun.toFD(try std.posix.eventfd(0, 0)));
    }

    pub fn getFd(this: *const Waker) bun.FileDescriptor {
        return this.fd;
    }

    pub fn initWithFileDescriptor(fd: bun.FileDescriptor) Waker {
        return Waker{ .fd = fd };
    }

    pub fn wait(this: Waker) void {
        var bytes: usize = 0;
        _ = std.posix.read(this.fd.cast(), @as(*[8]u8, @ptrCast(&bytes))) catch 0;
    }

    pub fn wake(this: *const Waker) void {
        var bytes: usize = 1;
        _ = std.posix.write(
            this.fd.cast(),
            @as(*[8]u8, @ptrCast(&bytes)),
        ) catch 0;
    }
};
