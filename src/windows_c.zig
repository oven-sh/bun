const std = @import("std");
const bun = @import("root").bun;
const builtin = @import("builtin");
const os = std.os;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;

pub fn getTotalMemory() usize {
    return 0;
}
pub fn getSystemMemory() usize {
    return 0;
}

pub fn getFreeMemory() usize {
    return 0;
}

pub fn getSystemUptime() usize {
    return 0;
}

pub fn getSystemLoadavg() [3]i32 {
    return .{ 0, 0, 0 };
}

pub const Mode = i32;

pub const SystemErrno = enum(u8) {
    E2BIG = 7,
    EACCES = 13,
    EADDRINUSE = 100,
    EADDRNOTAVAIL = 101,
    EAFNOSUPPORT = 102,
    EAGAIN = 11,
    EALREADY = 103,
    EBADF = 9,
    EBADMSG = 104,
    EBUSY = 16,
    ECANCELED = 105,
    ECHILD = 10,
    ECONNABORTED = 106,
    ECONNREFUSED = 107,
    ECONNRESET = 108,
    EDEADLOCK = 36,
    EDESTADDRREQ = 109,
    EDOM = 33,
    EEXIST = 17,
    EFAULT = 14,
    EFBIG = 27,
    EHOSTUNREACH = 110,
    EIDRM = 111,
    EILSEQ = 42,
    EINPROGRESS = 112,
    EINTR = 4,
    EINVAL = 22,
    EIO = 5,
    EISCONN = 113,
    EISDIR = 21,
    ELOOP = 114,
    EMFILE = 24,
    EMLINK = 31,
    EMSGSIZE = 115,
    ENAMETOOLONG = 38,
    ENETDOWN = 116,
    ENETRESET = 117,
    ENETUNREACH = 118,
    ENFILE = 23,
    ENOBUFS = 119,
    ENODATA = 120,
    ENODEV = 19,
    ENOENT = 2,
    ENOEXEC = 8,
    ENOLCK = 39,
    ENOLINK = 121,
    ENOMEM = 12,
    ENOMSG = 122,
    ENOPROTOOPT = 123,
    ENOSPC = 28,
    ENOSR = 124,
    ENOSTR = 125,
    ENOSYS = 40,
    ENOTCONN = 126,
    ENOTDIR = 20,
    ENOTEMPTY = 41,
    ENOTRECOVERABLE = 127,
    ENOTSOCK = 128,
    ENOTSUP = 129,
    ENOTTY = 25,
    ENXIO = 6,
    EOPNOTSUPP = 130,
    EOTHER = 131,
    EOVERFLOW = 132,
    EOWNERDEAD = 133,
    EPERM = 1,
    EPIPE = 32,
    EPROTO = 134,
    EPROTONOSUPPORT = 135,
    EPROTOTYPE = 136,
    ERANGE = 34,
    EROFS = 30,
    ESPIPE = 29,
    ESRCH = 3,
    ETIME = 137,
    ETIMEDOUT = 138,
    ETXTBSY = 139,
    EWOULDBLOCK = 140,
    EXDEV = 18,
    STRUNCATE = 80,

    pub const max = @intFromEnum(SystemErrno.EWOULDBLOCK);

    pub fn init(code: anytype) ?SystemErrno {
        if (comptime std.meta.trait.isSignedInt(@TypeOf(code))) {
            if (code < 0)
                return init(-code);
        }

        if (code >= max) return null;
        return @as(SystemErrno, @enumFromInt(code));
    }

    pub const labels: bun.enums.EnumMap(SystemErrno, []const u8) = brk: {
        var labels_ = bun.enums.EnumMap(SystemErrno, []const u8).init(.{
            .E2BIG = "Argument list too long",
            .EACCES = "Permission denied. The file's permission setting doesn't allow the specified access. An attempt was made to access a file (or, in some cases, a directory) in a way that's incompatible with the file's attributes",
            .EADDRINUSE = "Address in use",
            .EADDRNOTAVAIL = "Address not available",
            .EAFNOSUPPORT = "Address family not supported",
            .EALREADY = "Connection already in progress",
            .EBADF = "Bad file number. There are two possible causes: 1) The specified file descriptor isn't a valid value or doesn't refer to an open file. 2) An attempt was made to write to a file or device opened for read-only access",
            .EBADMSG = "Bad message",
            .EBUSY = "Device or resource busy",
            .ECANCELED = "Operation canceled",
            .ECHILD = "No spawned processes",
            .ECONNABORTED = "Connection aborted",
            .ECONNREFUSED = "Connection refused",
            .ECONNRESET = "Connection reset",
            .EDEADLOCK = "Same as EDEADLK for compatibility with older Microsoft C versions",
            .EDESTADDRREQ = "Destination address required",
            .EDOM = "Math argument. The argument to a math function isn't in the domain of the function",
            .EEXIST = "Files exists. An attempt has been made to create a file that already exists. For example, the _O_CREAT and _O_EXCL flags are specified in an _open call, but the named file already exists",
            .EFAULT = "Bad address",
            .EFBIG = "File too large",
            .EHOSTUNREACH = "Host unreachable",
            .EIDRM = "Identifier removed",
            .EILSEQ = "Illegal sequence of bytes (for example, in an MBCS string).",
            .EINPROGRESS = "Operation in progress",
            .EINTR = "Interrupted function",
            .EINVAL = "Invalid argument. An invalid value was given for one of the arguments to a function. For example, the value given for the origin when positioning a file pointer (by a call to fseek) is before the beginning of the file",
            .EIO = "I/O error",
            .EISCONN = "Already connected",
            .EISDIR = "Is a directory",
            .ELOOP = "Too many symbolic link levels",
            .EMFILE = "Too many open files. No more file descriptors are available, so no more files can be opened",
            .EMLINK = "Too many links",
            .EMSGSIZE = "Message size",
            .ENAMETOOLONG = "Filename too long",
            .ENETDOWN = "Network down",
            .ENETRESET = "Network reset",
            .ENETUNREACH = "Network unreachable",
            .ENFILE = "Too many files open in system",
            .ENOBUFS = "No buffer space",
            .ENODATA = "No message available",
            .ENODEV = "No such device",
            .ENOENT = "No such file or directory. The specified file or directory doesn't exist or can't be found. This message can occur whenever a specified file doesn't exist or a component of a path doesn't specify an existing directory",
            .ENOEXEC = "Exec format error. An attempt was made to execute a file that isn't executable or that has an invalid executable-file format",
            .ENOLCK = "No locks available",
            .ENOLINK = "No link",
            .ENOMEM = "Not enough memory is available for the attempted operator. For example, this message can occur when insufficient memory is available to execute a child process, or when the allocation request in a _getcwd call can't be satisfied",
            .ENOMSG = "No message",
            .ENOPROTOOPT = "No protocol option",
            .ENOSPC = "No space left on device. No more space for writing is available on the device (for example, when the disk is full).",
            .ENOSR = "No stream resources",
            .ENOSTR = "Not a stream",
            .ENOSYS = "Function not supported",
            .ENOTCONN = "Not connected",
            .ENOTDIR = "Not a directory",
            .ENOTEMPTY = "Directory not empty",
            .ENOTRECOVERABLE = "State not recoverable",
            .ENOTSOCK = "Not a socket",
            .ENOTSUP = "Not supported",
            .ENOTTY = "Inappropriate I/O control operation",
            .ENXIO = "No such device or address",
            .EOPNOTSUPP = "Operation not supported",
            .EOTHER = "Other",
            .EOVERFLOW = "Value too large",
            .EOWNERDEAD = "Owner dead",
            .EPERM = "Operation not permitted",
            .EPIPE = "Broken pipe",
            .EPROTO = "Protocol error",
            .EPROTONOSUPPORT = "Protocol not supported",
            .EPROTOTYPE = "Wrong protocol type",
            .ERANGE = "Result too large. An argument to a math function is too large, resulting in partial or total loss of significance in the result. This error can also occur in other functions when an argument is larger than expected (for example, when the buffer argument to _getcwd is longer than expected).",
            .EROFS = "Read only file system",
            .ESPIPE = "Invalid seek",
            .ESRCH = "No such process",
            .ETIME = "Stream timeout",
            .ETIMEDOUT = "Timed out",
            .ETXTBSY = "Text file busy",
            .EWOULDBLOCK = "Operation would block",
            .EXDEV = "Cross-device link. An attempt was made to move a file to a different device (using the rename function",
            .STRUNCATE = "A string copy or concatenation resulted in a truncated string. See _TRUNCATE",
        });

        break :brk labels_;
    };
};
