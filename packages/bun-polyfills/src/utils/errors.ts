type PosixErrNo = MapKeysType<ReturnType<typeof getPosixSystemErrorMap>>;
type Win32ErrNo = MapKeysType<ReturnType<typeof getWin32SystemErrorMap>>;

export function getPosixSystemErrorMap() {
    return new Map([
        [ -7, [ 'E2BIG', 'argument list too long' ] ],
        [ -13, [ 'EACCES', 'permission denied' ] ],
        [ -98, [ 'EADDRINUSE', 'address already in use' ] ],
        [ -99, [ 'EADDRNOTAVAIL', 'address not available' ] ],
        [ -97, [ 'EAFNOSUPPORT', 'address family not supported' ] ],
        [ -11, [ 'EAGAIN', 'resource temporarily unavailable' ] ],
        [ -3000, [ 'EAI_ADDRFAMILY', 'address family not supported' ] ],
        [ -3001, [ 'EAI_AGAIN', 'temporary failure' ] ],
        [ -3002, [ 'EAI_BADFLAGS', 'bad ai_flags value' ] ],
        [ -3013, [ 'EAI_BADHINTS', 'invalid value for hints' ] ],
        [ -3003, [ 'EAI_CANCELED', 'request canceled' ] ],
        [ -3004, [ 'EAI_FAIL', 'permanent failure' ] ],
        [ -3005, [ 'EAI_FAMILY', 'ai_family not supported' ] ],
        [ -3006, [ 'EAI_MEMORY', 'out of memory' ] ],
        [ -3007, [ 'EAI_NODATA', 'no address' ] ],
        [ -3008, [ 'EAI_NONAME', 'unknown node or service' ] ],
        [ -3009, [ 'EAI_OVERFLOW', 'argument buffer overflow' ] ],
        [ -3014, [ 'EAI_PROTOCOL', 'resolved protocol is unknown' ] ],
        [ -3010, [ 'EAI_SERVICE', 'service not available for socket type' ] ],
        [ -3011, [ 'EAI_SOCKTYPE', 'socket type not supported' ] ],
        [ -114, [ 'EALREADY', 'connection already in progress' ] ],
        [ -9, [ 'EBADF', 'bad file descriptor' ] ],
        [ -16, [ 'EBUSY', 'resource busy or locked' ] ],
        [ -125, [ 'ECANCELED', 'operation canceled' ] ],
        [ -4080, [ 'ECHARSET', 'invalid Unicode character' ] ],
        [ -103, [ 'ECONNABORTED', 'software caused connection abort' ] ],
        [ -111, [ 'ECONNREFUSED', 'connection refused' ] ],
        [ -104, [ 'ECONNRESET', 'connection reset by peer' ] ],
        [ -89, [ 'EDESTADDRREQ', 'destination address required' ] ],
        [ -17, [ 'EEXIST', 'file already exists' ] ],
        [ -14, [ 'EFAULT', 'bad address in system call argument' ] ],
        [ -27, [ 'EFBIG', 'file too large' ] ],
        [ -113, [ 'EHOSTUNREACH', 'host is unreachable' ] ],
        [ -4, [ 'EINTR', 'interrupted system call' ] ],
        [ -22, [ 'EINVAL', 'invalid argument' ] ],
        [ -5, [ 'EIO', 'i/o error' ] ],
        [ -106, [ 'EISCONN', 'socket is already connected' ] ],
        [ -21, [ 'EISDIR', 'illegal operation on a directory' ] ],
        [ -40, [ 'ELOOP', 'too many symbolic links encountered' ] ],
        [ -24, [ 'EMFILE', 'too many open files' ] ],
        [ -90, [ 'EMSGSIZE', 'message too long' ] ],
        [ -36, [ 'ENAMETOOLONG', 'name too long' ] ],
        [ -100, [ 'ENETDOWN', 'network is down' ] ],
        [ -101, [ 'ENETUNREACH', 'network is unreachable' ] ],
        [ -23, [ 'ENFILE', 'file table overflow' ] ],
        [ -105, [ 'ENOBUFS', 'no buffer space available' ] ],
        [ -19, [ 'ENODEV', 'no such device' ] ],
        [ -2, [ 'ENOENT', 'no such file or directory' ] ],
        [ -12, [ 'ENOMEM', 'not enough memory' ] ],
        [ -64, [ 'ENONET', 'machine is not on the network' ] ],
        [ -92, [ 'ENOPROTOOPT', 'protocol not available' ] ],
        [ -28, [ 'ENOSPC', 'no space left on device' ] ],
        [ -38, [ 'ENOSYS', 'function not implemented' ] ],
        [ -107, [ 'ENOTCONN', 'socket is not connected' ] ],
        [ -20, [ 'ENOTDIR', 'not a directory' ] ],
        [ -39, [ 'ENOTEMPTY', 'directory not empty' ] ],
        [ -88, [ 'ENOTSOCK', 'socket operation on non-socket' ] ],
        [ -95, [ 'ENOTSUP', 'operation not supported on socket' ] ],
        [ -75, [ 'EOVERFLOW', 'value too large for defined data type' ] ],
        [ -1, [ 'EPERM', 'operation not permitted' ] ],
        [ -32, [ 'EPIPE', 'broken pipe' ] ],
        [ -71, [ 'EPROTO', 'protocol error' ] ],
        [ -93, [ 'EPROTONOSUPPORT', 'protocol not supported' ] ],
        [ -91, [ 'EPROTOTYPE', 'protocol wrong type for socket' ] ],
        [ -34, [ 'ERANGE', 'result too large' ] ],
        [ -30, [ 'EROFS', 'read-only file system' ] ],
        [ -108, [ 'ESHUTDOWN', 'cannot send after transport endpoint shutdown' ] ],
        [ -29, [ 'ESPIPE', 'invalid seek' ] ],
        [ -3, [ 'ESRCH', 'no such process' ] ],
        [ -110, [ 'ETIMEDOUT', 'connection timed out' ] ],
        [ -26, [ 'ETXTBSY', 'text file is busy' ] ],
        [ -18, [ 'EXDEV', 'cross-device link not permitted' ] ],
        [ -4094, [ 'UNKNOWN', 'unknown error' ] ],
        [ -4095, [ 'EOF', 'end of file' ] ],
        [ -6, [ 'ENXIO', 'no such device or address' ] ],
        [ -31, [ 'EMLINK', 'too many links' ] ],
        [ -112, [ 'EHOSTDOWN', 'host is down' ] ],
        [ -121, [ 'EREMOTEIO', 'remote I/O error' ] ],
        [ -25, [ 'ENOTTY', 'inappropriate ioctl for device' ] ],
        [ -4028, [ 'EFTYPE', 'inappropriate file type or format' ] ],
        [ -84, [ 'EILSEQ', 'illegal byte sequence' ] ],
        [ -94, [ 'ESOCKTNOSUPPORT', 'socket type not supported' ] ]
    ] as const);
}

export function getWin32SystemErrorMap() {
    return new Map([
        [ -4093, [ 'E2BIG', 'argument list too long' ] ],
        [ -4092, [ 'EACCES', 'permission denied' ] ],
        [ -4091, [ 'EADDRINUSE', 'address already in use' ] ],
        [ -4090, [ 'EADDRNOTAVAIL', 'address not available' ] ],
        [ -4089, [ 'EAFNOSUPPORT', 'address family not supported' ] ],
        [ -4088, [ 'EAGAIN', 'resource temporarily unavailable' ] ],
        [ -3000, [ 'EAI_ADDRFAMILY', 'address family not supported' ] ],
        [ -3001, [ 'EAI_AGAIN', 'temporary failure' ] ],
        [ -3002, [ 'EAI_BADFLAGS', 'bad ai_flags value' ] ],
        [ -3013, [ 'EAI_BADHINTS', 'invalid value for hints' ] ],
        [ -3003, [ 'EAI_CANCELED', 'request canceled' ] ],
        [ -3004, [ 'EAI_FAIL', 'permanent failure' ] ],
        [ -3005, [ 'EAI_FAMILY', 'ai_family not supported' ] ],
        [ -3006, [ 'EAI_MEMORY', 'out of memory' ] ],
        [ -3007, [ 'EAI_NODATA', 'no address' ] ],
        [ -3008, [ 'EAI_NONAME', 'unknown node or service' ] ],
        [ -3009, [ 'EAI_OVERFLOW', 'argument buffer overflow' ] ],
        [ -3014, [ 'EAI_PROTOCOL', 'resolved protocol is unknown' ] ],
        [ -3010, [ 'EAI_SERVICE', 'service not available for socket type' ] ],
        [ -3011, [ 'EAI_SOCKTYPE', 'socket type not supported' ] ],
        [ -4084, [ 'EALREADY', 'connection already in progress' ] ],
        [ -4083, [ 'EBADF', 'bad file descriptor' ] ],
        [ -4082, [ 'EBUSY', 'resource busy or locked' ] ],
        [ -4081, [ 'ECANCELED', 'operation canceled' ] ],
        [ -4080, [ 'ECHARSET', 'invalid Unicode character' ] ],
        [ -4079, [ 'ECONNABORTED', 'software caused connection abort' ] ],
        [ -4078, [ 'ECONNREFUSED', 'connection refused' ] ],
        [ -4077, [ 'ECONNRESET', 'connection reset by peer' ] ],
        [ -4076, [ 'EDESTADDRREQ', 'destination address required' ] ],
        [ -4075, [ 'EEXIST', 'file already exists' ] ],
        [ -4074, [ 'EFAULT', 'bad address in system call argument' ] ],
        [ -4036, [ 'EFBIG', 'file too large' ] ],
        [ -4073, [ 'EHOSTUNREACH', 'host is unreachable' ] ],
        [ -4072, [ 'EINTR', 'interrupted system call' ] ],
        [ -4071, [ 'EINVAL', 'invalid argument' ] ],
        [ -4070, [ 'EIO', 'i/o error' ] ],
        [ -4069, [ 'EISCONN', 'socket is already connected' ] ],
        [ -4068, [ 'EISDIR', 'illegal operation on a directory' ] ],
        [ -4067, [ 'ELOOP', 'too many symbolic links encountered' ] ],
        [ -4066, [ 'EMFILE', 'too many open files' ] ],
        [ -4065, [ 'EMSGSIZE', 'message too long' ] ],
        [ -4064, [ 'ENAMETOOLONG', 'name too long' ] ],
        [ -4063, [ 'ENETDOWN', 'network is down' ] ],
        [ -4062, [ 'ENETUNREACH', 'network is unreachable' ] ],
        [ -4061, [ 'ENFILE', 'file table overflow' ] ],
        [ -4060, [ 'ENOBUFS', 'no buffer space available' ] ],
        [ -4059, [ 'ENODEV', 'no such device' ] ],
        [ -4058, [ 'ENOENT', 'no such file or directory' ] ],
        [ -4057, [ 'ENOMEM', 'not enough memory' ] ],
        [ -4056, [ 'ENONET', 'machine is not on the network' ] ],
        [ -4035, [ 'ENOPROTOOPT', 'protocol not available' ] ],
        [ -4055, [ 'ENOSPC', 'no space left on device' ] ],
        [ -4054, [ 'ENOSYS', 'function not implemented' ] ],
        [ -4053, [ 'ENOTCONN', 'socket is not connected' ] ],
        [ -4052, [ 'ENOTDIR', 'not a directory' ] ],
        [ -4051, [ 'ENOTEMPTY', 'directory not empty' ] ],
        [ -4050, [ 'ENOTSOCK', 'socket operation on non-socket' ] ],
        [ -4049, [ 'ENOTSUP', 'operation not supported on socket' ] ],
        [ -4026, [ 'EOVERFLOW', 'value too large for defined data type' ] ],
        [ -4048, [ 'EPERM', 'operation not permitted' ] ],
        [ -4047, [ 'EPIPE', 'broken pipe' ] ],
        [ -4046, [ 'EPROTO', 'protocol error' ] ],
        [ -4045, [ 'EPROTONOSUPPORT', 'protocol not supported' ] ],
        [ -4044, [ 'EPROTOTYPE', 'protocol wrong type for socket' ] ],
        [ -4034, [ 'ERANGE', 'result too large' ] ],
        [ -4043, [ 'EROFS', 'read-only file system' ] ],
        [ -4042, [ 'ESHUTDOWN', 'cannot send after transport endpoint shutdown' ] ],
        [ -4041, [ 'ESPIPE', 'invalid seek' ] ],
        [ -4040, [ 'ESRCH', 'no such process' ] ],
        [ -4039, [ 'ETIMEDOUT', 'connection timed out' ] ],
        [ -4038, [ 'ETXTBSY', 'text file is busy' ] ],
        [ -4037, [ 'EXDEV', 'cross-device link not permitted' ] ],
        [ -4094, [ 'UNKNOWN', 'unknown error' ] ],
        [ -4095, [ 'EOF', 'end of file' ] ],
        [ -4033, [ 'ENXIO', 'no such device or address' ] ],
        [ -4032, [ 'EMLINK', 'too many links' ] ],
        [ -4031, [ 'EHOSTDOWN', 'host is down' ] ],
        [ -4030, [ 'EREMOTEIO', 'remote I/O error' ] ],
        [ -4029, [ 'ENOTTY', 'inappropriate ioctl for device' ] ],
        [ -4028, [ 'EFTYPE', 'inappropriate file type or format' ] ],
        [ -4027, [ 'EILSEQ', 'illegal byte sequence' ] ],
        [ -4025, [ 'ESOCKTNOSUPPORT', 'socket type not supported' ] ]
    ] as const);
}

export function getPosixToWin32SystemErrorMap() {
    const posixEntries = [...getPosixSystemErrorMap().entries()];
    const win32Entries = [...getWin32SystemErrorMap().entries()];
    const map: Map<PosixErrNo, Win32ErrNo> = new Map();
    posixEntries.forEach(([code, val]) => {
        const found = win32Entries.find(([_, v]) => v[0] === val[0]);
        if (!found) console.error(val[0]);
        else map.set(code, found[0]);
    });
    return map;
}

export function getPlatformSystemErrorFromPosix(posixErrNo: PosixErrNo) {
    if (process.platform === 'win32') {
        const win32errno = getPosixToWin32SystemErrorMap().get(posixErrNo)!;
        return getWin32SystemErrorMap().get(win32errno);
    } else {
        return getPosixSystemErrorMap().get(posixErrNo);
    }
}

export class SystemError extends Error {
    constructor(errno: PosixErrNo, syscall?: string, errpath?: string) {
        const [errname, errmsg] = getPlatformSystemErrorFromPosix(errno) ?? ['SystemError', 'Unknown system error'];
        super(errmsg);
        this.name = errname;
        this.code = errname;
        this.errno = errno;
        if (syscall) this.syscall = syscall;
        if (errpath) this.path = errpath;
    }
    errno?: number | undefined;
    code?: string | undefined;
    path?: string | undefined;
    syscall?: string | undefined;
}

export class NotImplementedError extends Error {
    constructor(thing: string, func: AnyCallable = NotImplementedError, overrideMsg: boolean = false) {
        super(overrideMsg ? thing : `A polyfill for ${thing} is not yet implemented by bun-polyfills.`);
        this.name = 'NotImplementedError';
        Error.captureStackTrace(this, func);
    }
}
