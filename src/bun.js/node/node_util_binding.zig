pub fn internalErrorName(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    if (arguments.len < 1) {
        return globalThis.throwNotEnoughArguments("internalErrorName", 1, arguments.len);
    }

    const err_value = arguments[0];
    const err_int = err_value.toInt32();

    if (err_int == -4095) return bun.String.static("EOF").toJS(globalThis);
    if (err_int == -4094) return bun.String.static("UNKNOWN").toJS(globalThis);
    if (err_int == -3000) return bun.String.static("EAI_ADDRFAMILY").toJS(globalThis);
    if (err_int == -3001) return bun.String.static("EAI_AGAIN").toJS(globalThis);
    if (err_int == -3002) return bun.String.static("EAI_BADFLAGS").toJS(globalThis);
    if (err_int == -3003) return bun.String.static("EAI_CANCELED").toJS(globalThis);
    if (err_int == -3004) return bun.String.static("EAI_FAIL").toJS(globalThis);
    if (err_int == -3005) return bun.String.static("EAI_FAMILY").toJS(globalThis);
    if (err_int == -3006) return bun.String.static("EAI_MEMORY").toJS(globalThis);
    if (err_int == -3007) return bun.String.static("EAI_NODATA").toJS(globalThis);
    if (err_int == -3008) return bun.String.static("EAI_NONAME").toJS(globalThis);
    if (err_int == -3009) return bun.String.static("EAI_OVERFLOW").toJS(globalThis);
    if (err_int == -3010) return bun.String.static("EAI_SERVICE").toJS(globalThis);
    if (err_int == -3011) return bun.String.static("EAI_SOCKTYPE").toJS(globalThis);
    if (err_int == -3013) return bun.String.static("EAI_BADHINTS").toJS(globalThis);
    if (err_int == -3014) return bun.String.static("EAI_PROTOCOL").toJS(globalThis);

    if (err_int == -bun.sys.UV_E.@"2BIG") return bun.String.static("E2BIG").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.ACCES) return bun.String.static("EACCES").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.ADDRINUSE) return bun.String.static("EADDRINUSE").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.ADDRNOTAVAIL) return bun.String.static("EADDRNOTAVAIL").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.AFNOSUPPORT) return bun.String.static("EAFNOSUPPORT").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.AGAIN) return bun.String.static("EAGAIN").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.ALREADY) return bun.String.static("EALREADY").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.BADF) return bun.String.static("EBADF").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.BUSY) return bun.String.static("EBUSY").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.CANCELED) return bun.String.static("ECANCELED").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.CHARSET) return bun.String.static("ECHARSET").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.CONNABORTED) return bun.String.static("ECONNABORTED").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.CONNREFUSED) return bun.String.static("ECONNREFUSED").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.CONNRESET) return bun.String.static("ECONNRESET").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.DESTADDRREQ) return bun.String.static("EDESTADDRREQ").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.EXIST) return bun.String.static("EEXIST").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.FAULT) return bun.String.static("EFAULT").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.HOSTUNREACH) return bun.String.static("EHOSTUNREACH").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.INTR) return bun.String.static("EINTR").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.INVAL) return bun.String.static("EINVAL").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.IO) return bun.String.static("EIO").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.ISCONN) return bun.String.static("EISCONN").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.ISDIR) return bun.String.static("EISDIR").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.LOOP) return bun.String.static("ELOOP").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.MFILE) return bun.String.static("EMFILE").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.MSGSIZE) return bun.String.static("EMSGSIZE").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NAMETOOLONG) return bun.String.static("ENAMETOOLONG").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NETDOWN) return bun.String.static("ENETDOWN").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NETUNREACH) return bun.String.static("ENETUNREACH").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NFILE) return bun.String.static("ENFILE").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOBUFS) return bun.String.static("ENOBUFS").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NODEV) return bun.String.static("ENODEV").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOENT) return bun.String.static("ENOENT").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOMEM) return bun.String.static("ENOMEM").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NONET) return bun.String.static("ENONET").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOSPC) return bun.String.static("ENOSPC").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOSYS) return bun.String.static("ENOSYS").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOTCONN) return bun.String.static("ENOTCONN").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOTDIR) return bun.String.static("ENOTDIR").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOTEMPTY) return bun.String.static("ENOTEMPTY").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOTSOCK) return bun.String.static("ENOTSOCK").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOTSUP) return bun.String.static("ENOTSUP").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.PERM) return bun.String.static("EPERM").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.PIPE) return bun.String.static("EPIPE").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.PROTO) return bun.String.static("EPROTO").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.PROTONOSUPPORT) return bun.String.static("EPROTONOSUPPORT").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.PROTOTYPE) return bun.String.static("EPROTOTYPE").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.ROFS) return bun.String.static("EROFS").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.SHUTDOWN) return bun.String.static("ESHUTDOWN").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.SPIPE) return bun.String.static("ESPIPE").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.SRCH) return bun.String.static("ESRCH").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.TIMEDOUT) return bun.String.static("ETIMEDOUT").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.TXTBSY) return bun.String.static("ETXTBSY").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.XDEV) return bun.String.static("EXDEV").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.FBIG) return bun.String.static("EFBIG").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOPROTOOPT) return bun.String.static("ENOPROTOOPT").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.RANGE) return bun.String.static("ERANGE").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NXIO) return bun.String.static("ENXIO").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.MLINK) return bun.String.static("EMLINK").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.HOSTDOWN) return bun.String.static("EHOSTDOWN").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.REMOTEIO) return bun.String.static("EREMOTEIO").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOTTY) return bun.String.static("ENOTTY").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.FTYPE) return bun.String.static("EFTYPE").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.ILSEQ) return bun.String.static("EILSEQ").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.OVERFLOW) return bun.String.static("EOVERFLOW").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.SOCKTNOSUPPORT) return bun.String.static("ESOCKTNOSUPPORT").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NODATA) return bun.String.static("ENODATA").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.UNATCH) return bun.String.static("EUNATCH").toJS(globalThis);
    if (err_int == -bun.sys.UV_E.NOEXEC) return bun.String.static("ENOEXEC").toJS(globalThis);

    var fmtstring = bun.handleOom(bun.String.createFormat("Unknown system error {d}", .{err_int}));
    return fmtstring.transferToJS(globalThis);
}

pub fn etimedoutErrorCode(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return jsc.JSValue.jsNumberFromInt32(-bun.sys.UV_E.TIMEDOUT);
}

pub fn enobufsErrorCode(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return jsc.JSValue.jsNumberFromInt32(-bun.sys.UV_E.NOBUFS);
}

// Structure to define all system errors for getSystemErrorMap
const SystemError = struct {
    code: i32,
    name: [:0]const u8,
    message: [:0]const u8,
};

// Define all system errors with their codes, names, and messages
// These match Node.js's error definitions
const system_errors = [_]SystemError{
    // Special errors
    .{ .code = -4095, .name = "EOF", .message = "end of file" },
    .{ .code = -4094, .name = "UNKNOWN", .message = "unknown error" },

    // EAI errors (getaddrinfo errors)
    .{ .code = -3000, .name = "EAI_ADDRFAMILY", .message = "address family not supported" },
    .{ .code = -3001, .name = "EAI_AGAIN", .message = "temporary failure" },
    .{ .code = -3002, .name = "EAI_BADFLAGS", .message = "bad ai_flags value" },
    .{ .code = -3003, .name = "EAI_CANCELED", .message = "request canceled" },
    .{ .code = -3004, .name = "EAI_FAIL", .message = "permanent failure" },
    .{ .code = -3005, .name = "EAI_FAMILY", .message = "ai_family not supported" },
    .{ .code = -3006, .name = "EAI_MEMORY", .message = "out of memory" },
    .{ .code = -3007, .name = "EAI_NODATA", .message = "no address" },
    .{ .code = -3008, .name = "EAI_NONAME", .message = "unknown node or service" },
    .{ .code = -3009, .name = "EAI_OVERFLOW", .message = "argument buffer overflow" },
    .{ .code = -3010, .name = "EAI_SERVICE", .message = "service not available for socket type" },
    .{ .code = -3011, .name = "EAI_SOCKTYPE", .message = "socket type not supported" },
    .{ .code = -3013, .name = "EAI_BADHINTS", .message = "invalid hints" },
    .{ .code = -3014, .name = "EAI_PROTOCOL", .message = "resolved protocol is unknown" },

    // Standard errno errors
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.@"2BIG")), .name = "E2BIG", .message = "argument list too long" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.ACCES)), .name = "EACCES", .message = "permission denied" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.ADDRINUSE)), .name = "EADDRINUSE", .message = "address already in use" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.ADDRNOTAVAIL)), .name = "EADDRNOTAVAIL", .message = "address not available" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.AFNOSUPPORT)), .name = "EAFNOSUPPORT", .message = "address family not supported" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.AGAIN)), .name = "EAGAIN", .message = "resource temporarily unavailable" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.ALREADY)), .name = "EALREADY", .message = "connection already in progress" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.BADF)), .name = "EBADF", .message = "bad file descriptor" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.BUSY)), .name = "EBUSY", .message = "resource busy or locked" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.CANCELED)), .name = "ECANCELED", .message = "operation canceled" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.CHARSET)), .name = "ECHARSET", .message = "invalid Unicode character" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.CONNABORTED)), .name = "ECONNABORTED", .message = "software caused connection abort" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.CONNREFUSED)), .name = "ECONNREFUSED", .message = "connection refused" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.CONNRESET)), .name = "ECONNRESET", .message = "connection reset by peer" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.DESTADDRREQ)), .name = "EDESTADDRREQ", .message = "destination address required" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.EXIST)), .name = "EEXIST", .message = "file already exists" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.FAULT)), .name = "EFAULT", .message = "bad address in system call argument" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.FBIG)), .name = "EFBIG", .message = "file too large" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.HOSTUNREACH)), .name = "EHOSTUNREACH", .message = "host is unreachable" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.INTR)), .name = "EINTR", .message = "interrupted system call" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.INVAL)), .name = "EINVAL", .message = "invalid argument" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.IO)), .name = "EIO", .message = "i/o error" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.ISCONN)), .name = "EISCONN", .message = "socket is already connected" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.ISDIR)), .name = "EISDIR", .message = "illegal operation on a directory" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.LOOP)), .name = "ELOOP", .message = "too many symbolic links encountered" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.MFILE)), .name = "EMFILE", .message = "too many open files" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.MSGSIZE)), .name = "EMSGSIZE", .message = "message too long" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NAMETOOLONG)), .name = "ENAMETOOLONG", .message = "name too long" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NETDOWN)), .name = "ENETDOWN", .message = "network is down" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NETUNREACH)), .name = "ENETUNREACH", .message = "network is unreachable" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NFILE)), .name = "ENFILE", .message = "file table overflow" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOBUFS)), .name = "ENOBUFS", .message = "no buffer space available" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NODEV)), .name = "ENODEV", .message = "no such device" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOENT)), .name = "ENOENT", .message = "no such file or directory" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOMEM)), .name = "ENOMEM", .message = "not enough memory" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NONET)), .name = "ENONET", .message = "machine is not on the network" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOPROTOOPT)), .name = "ENOPROTOOPT", .message = "protocol not available" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOSPC)), .name = "ENOSPC", .message = "no space left on device" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOSYS)), .name = "ENOSYS", .message = "function not implemented" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOTCONN)), .name = "ENOTCONN", .message = "socket is not connected" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOTDIR)), .name = "ENOTDIR", .message = "not a directory" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOTEMPTY)), .name = "ENOTEMPTY", .message = "directory not empty" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOTSOCK)), .name = "ENOTSOCK", .message = "socket operation on non-socket" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOTSUP)), .name = "ENOTSUP", .message = "operation not supported on socket" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.PERM)), .name = "EPERM", .message = "operation not permitted" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.PIPE)), .name = "EPIPE", .message = "broken pipe" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.PROTO)), .name = "EPROTO", .message = "protocol error" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.PROTONOSUPPORT)), .name = "EPROTONOSUPPORT", .message = "protocol not supported" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.PROTOTYPE)), .name = "EPROTOTYPE", .message = "protocol wrong type for socket" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.RANGE)), .name = "ERANGE", .message = "result too large" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.ROFS)), .name = "EROFS", .message = "read-only file system" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.SHUTDOWN)), .name = "ESHUTDOWN", .message = "cannot send after transport endpoint shutdown" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.SPIPE)), .name = "ESPIPE", .message = "invalid seek" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.SRCH)), .name = "ESRCH", .message = "no such process" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.TIMEDOUT)), .name = "ETIMEDOUT", .message = "connection timed out" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.TXTBSY)), .name = "ETXTBSY", .message = "text file is busy" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.XDEV)), .name = "EXDEV", .message = "cross-device link not permitted" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NXIO)), .name = "ENXIO", .message = "no such device or address" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.MLINK)), .name = "EMLINK", .message = "too many links" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.HOSTDOWN)), .name = "EHOSTDOWN", .message = "host is down" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.REMOTEIO)), .name = "EREMOTEIO", .message = "remote I/O error" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOTTY)), .name = "ENOTTY", .message = "inappropriate ioctl for device" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.FTYPE)), .name = "EFTYPE", .message = "inappropriate file type or format" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.ILSEQ)), .name = "EILSEQ", .message = "illegal byte sequence" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.OVERFLOW)), .name = "EOVERFLOW", .message = "value too large for defined data type" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.SOCKTNOSUPPORT)), .name = "ESOCKTNOSUPPORT", .message = "socket type not supported" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NODATA)), .name = "ENODATA", .message = "no data available" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.UNATCH)), .name = "EUNATCH", .message = "protocol driver not attached" },
    .{ .code = -@as(i32, @intCast(bun.sys.UV_E.NOEXEC)), .name = "ENOEXEC", .message = "exec format error" },
};

pub fn getSystemErrorMap(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    // Create a new Map()
    const map_value = jsc.JSMap.create(globalThis);
    const map = jsc.JSMap.fromJS(map_value).?;

    // For each error, add an entry to the map
    for (system_errors) |err| {
        // Create the [name, message] array for the value
        var value_array = try jsc.JSValue.createEmptyArray(globalThis, 2);
        const name_js = bun.String.static(err.name).toJS(globalThis);
        const message_js = bun.String.static(err.message).toJS(globalThis);
        try value_array.putIndex(globalThis, 0, name_js);
        try value_array.putIndex(globalThis, 1, message_js);

        // Add to the map: map.set(code, [name, message])
        const key = jsc.JSValue.jsNumberFromInt32(err.code);
        map.set(globalThis, key, value_array);
    }

    return map_value;
}

/// `extractedSplitNewLines` for ASCII/Latin1 strings. Panics if passed a non-string.
/// Returns `undefined` if param is utf8 or utf16 and not fully ascii.
///
/// ```js
/// // util.js
/// const extractedNewLineRe = new RegExp("(?<=\\n)");
/// extractedSplitNewLines = value => RegExpPrototypeSymbolSplit(extractedNewLineRe, value);
/// ```
pub fn extractedSplitNewLinesFastPathStringsOnly(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    bun.assert(callframe.argumentsCount() == 1);
    const value = callframe.argument(0);
    bun.assert(value.isString());

    const str = try value.toBunString(globalThis);
    defer str.deref();

    return switch (str.encoding()) {
        inline .utf16, .latin1 => |encoding| split(encoding, globalThis, bun.default_allocator, &str),
        .utf8 => if (bun.strings.isAllASCII(str.byteSlice()))
            return split(.utf8, globalThis, bun.default_allocator, &str)
        else
            return .js_undefined,
    };
}

fn split(
    comptime encoding: bun.strings.EncodingNonAscii,
    globalThis: *jsc.JSGlobalObject,
    allocator: Allocator,
    str: *const bun.String,
) bun.JSError!jsc.JSValue {
    var fallback = std.heap.stackFallback(1024, allocator);
    const alloc = fallback.get();
    const Char = switch (encoding) {
        .utf8, .latin1 => u8,
        .utf16 => u16,
    };

    var lines: std.ArrayListUnmanaged(bun.String) = .{};
    defer {
        for (lines.items) |out| {
            out.deref();
        }
        lines.deinit(alloc);
    }

    const buffer: []const Char = if (encoding == .utf16)
        str.utf16()
    else
        str.byteSlice();
    var it: SplitNewlineIterator(Char) = .{ .buffer = buffer, .index = 0 };
    while (it.next()) |line| {
        const encoded_line = switch (encoding) {
            inline .utf8 => bun.String.borrowUTF8(line),
            inline .latin1 => bun.String.cloneLatin1(line),
            inline .utf16 => bun.String.borrowUTF16(line),
        };
        errdefer encoded_line.deref();
        try lines.append(alloc, encoded_line);
    }

    return bun.String.toJSArray(globalThis, lines.items);
}

pub fn SplitNewlineIterator(comptime T: type) type {
    return struct {
        buffer: []const T,
        index: ?usize,

        const Self = @This();

        /// Returns a slice of the next field, or null if splitting is complete.
        pub fn next(self: *Self) ?[]const T {
            const start = self.index orelse return null;

            if (std.mem.indexOfScalarPos(T, self.buffer, start, '\n')) |delim_start| {
                const end = delim_start + 1;
                const slice = self.buffer[start..end];
                self.index = end;
                return slice;
            } else {
                self.index = null;
                return self.buffer[start..];
            }
        }
    };
}

pub fn normalizeEncoding(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const input = callframe.argument(0);
    const str = try bun.String.fromJS(input, globalThis);
    bun.assert(str.tag != .Dead);
    defer str.deref();
    if (str.length() == 0) return jsc.Node.Encoding.utf8.toJS(globalThis);
    if (str.inMapCaseInsensitive(jsc.Node.Encoding.map)) |enc| return enc.toJS(globalThis);
    return .js_undefined;
}

pub fn parseEnv(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const content = callframe.argument(0);
    try validators.validateString(globalThis, content, "content", .{});

    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const str = content.asString().toSlice(globalThis, allocator);

    var map = envloader.Map.init(allocator);
    var p = envloader.Loader.init(&map, allocator);
    try p.loadFromString(str.slice(), true, false);

    var obj = jsc.JSValue.createEmptyObject(globalThis, map.map.count());
    for (map.map.keys(), map.map.values()) |k, v| {
        obj.put(globalThis, jsc.ZigString.initUTF8(k), try bun.String.createUTF8ForJS(globalThis, v.value));
    }
    return obj;
}

const string = []const u8;

const bun = @import("bun");
const envloader = @import("../../env_loader.zig");
const std = @import("std");
const validators = @import("./util/validators.zig");
const Allocator = std.mem.Allocator;

const jsc = bun.jsc;
const ZigString = jsc.ZigString;
