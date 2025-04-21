const std = @import("std");
const bun = @import("bun");
const builtin = @import("builtin");
const win32 = std.os.windows;
const posix = std.posix;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;

pub fn getSystemLoadavg() [3]f32 {
    // loadavg is not supported on windows even in node
    return .{ 0, 0, 0 };
}

pub const Mode = u16;
const Win32Error = bun.windows.Win32Error;

pub const UV_E2BIG = -uv.UV_E2BIG;
pub const UV_EACCES = -uv.UV_EACCES;
pub const UV_EADDRINUSE = -uv.UV_EADDRINUSE;
pub const UV_EADDRNOTAVAIL = -uv.UV_EADDRNOTAVAIL;
pub const UV_EAFNOSUPPORT = -uv.UV_EAFNOSUPPORT;
pub const UV_EAGAIN = -uv.UV_EAGAIN;
pub const UV_EALREADY = -uv.UV_EALREADY;
pub const UV_EBADF = -uv.UV_EBADF;
pub const UV_EBUSY = -uv.UV_EBUSY;
pub const UV_ECANCELED = -uv.UV_ECANCELED;
pub const UV_ECHARSET = -uv.UV_ECHARSET;
pub const UV_ECONNABORTED = -uv.UV_ECONNABORTED;
pub const UV_ECONNREFUSED = -uv.UV_ECONNREFUSED;
pub const UV_ECONNRESET = -uv.UV_ECONNRESET;
pub const UV_EDESTADDRREQ = -uv.UV_EDESTADDRREQ;
pub const UV_EEXIST = -uv.UV_EEXIST;
pub const UV_EFAULT = -uv.UV_EFAULT;
pub const UV_EHOSTUNREACH = -uv.UV_EHOSTUNREACH;
pub const UV_EINTR = -uv.UV_EINTR;
pub const UV_EINVAL = -uv.UV_EINVAL;
pub const UV_EIO = -uv.UV_EIO;
pub const UV_EISCONN = -uv.UV_EISCONN;
pub const UV_EISDIR = -uv.UV_EISDIR;
pub const UV_ELOOP = -uv.UV_ELOOP;
pub const UV_EMFILE = -uv.UV_EMFILE;
pub const UV_EMSGSIZE = -uv.UV_EMSGSIZE;
pub const UV_ENAMETOOLONG = -uv.UV_ENAMETOOLONG;
pub const UV_ENETDOWN = -uv.UV_ENETDOWN;
pub const UV_ENETUNREACH = -uv.UV_ENETUNREACH;
pub const UV_ENFILE = -uv.UV_ENFILE;
pub const UV_ENOBUFS = -uv.UV_ENOBUFS;
pub const UV_ENODEV = -uv.UV_ENODEV;
pub const UV_ENOENT = -uv.UV_ENOENT;
pub const UV_ENOMEM = -uv.UV_ENOMEM;
pub const UV_ENONET = -uv.UV_ENONET;
pub const UV_ENOSPC = -uv.UV_ENOSPC;
pub const UV_ENOSYS = -uv.UV_ENOSYS;
pub const UV_ENOTCONN = -uv.UV_ENOTCONN;
pub const UV_ENOTDIR = -uv.UV_ENOTDIR;
pub const UV_ENOTEMPTY = -uv.UV_ENOTEMPTY;
pub const UV_ENOTSOCK = -uv.UV_ENOTSOCK;
pub const UV_ENOTSUP = -uv.UV_ENOTSUP;
pub const UV_EPERM = -uv.UV_EPERM;
pub const UV_EPIPE = -uv.UV_EPIPE;
pub const UV_EPROTO = -uv.UV_EPROTO;
pub const UV_EPROTONOSUPPORT = -uv.UV_EPROTONOSUPPORT;
pub const UV_EPROTOTYPE = -uv.UV_EPROTOTYPE;
pub const UV_EROFS = -uv.UV_EROFS;
pub const UV_ESHUTDOWN = -uv.UV_ESHUTDOWN;
pub const UV_ESPIPE = -uv.UV_ESPIPE;
pub const UV_ESRCH = -uv.UV_ESRCH;
pub const UV_ETIMEDOUT = -uv.UV_ETIMEDOUT;
pub const UV_ETXTBSY = -uv.UV_ETXTBSY;
pub const UV_EXDEV = -uv.UV_EXDEV;
pub const UV_EFBIG = -uv.UV_EFBIG;
pub const UV_ENOPROTOOPT = -uv.UV_ENOPROTOOPT;
pub const UV_ERANGE = -uv.UV_ERANGE;
pub const UV_ENXIO = -uv.UV_ENXIO;
pub const UV_EMLINK = -uv.UV_EMLINK;
pub const UV_EHOSTDOWN = -uv.UV_EHOSTDOWN;
pub const UV_EREMOTEIO = -uv.UV_EREMOTEIO;
pub const UV_ENOTTY = -uv.UV_ENOTTY;
pub const UV_EFTYPE = -uv.UV_EFTYPE;
pub const UV_EILSEQ = -uv.UV_EILSEQ;
pub const UV_EOVERFLOW = -uv.UV_EOVERFLOW;
pub const UV_ESOCKTNOSUPPORT = -uv.UV_ESOCKTNOSUPPORT;
pub const UV_ENODATA = -uv.UV_ENODATA;
pub const UV_EUNATCH = -uv.UV_EUNATCH;

pub const off_t = i64;
pub fn preallocate_file(_: posix.fd_t, _: off_t, _: off_t) !void {}

const uv = @import("./deps/libuv.zig");

const Maybe = bun.JSC.Maybe;

const w = std.os.windows;

extern "c" fn _umask(Mode) Mode;
pub const umask = _umask;

const FILE_DISPOSITION_DO_NOT_DELETE: w.ULONG = 0x00000000;
const FILE_DISPOSITION_DELETE: w.ULONG = 0x00000001;
const FILE_DISPOSITION_POSIX_SEMANTICS: w.ULONG = 0x00000002;
const FILE_DISPOSITION_FORCE_IMAGE_SECTION_CHECK: w.ULONG = 0x00000004;
const FILE_DISPOSITION_ON_CLOSE: w.ULONG = 0x00000008;
const FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE: w.ULONG = 0x00000010;
