const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const uv = bun.windows.libuv;

pub fn internalErrorName(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
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

    if (err_int == -bun.C.UV_E2BIG) return bun.String.static("E2BIG").toJS(globalThis);
    if (err_int == -bun.C.UV_EACCES) return bun.String.static("EACCES").toJS(globalThis);
    if (err_int == -bun.C.UV_EADDRINUSE) return bun.String.static("EADDRINUSE").toJS(globalThis);
    if (err_int == -bun.C.UV_EADDRNOTAVAIL) return bun.String.static("EADDRNOTAVAIL").toJS(globalThis);
    if (err_int == -bun.C.UV_EAFNOSUPPORT) return bun.String.static("EAFNOSUPPORT").toJS(globalThis);
    if (err_int == -bun.C.UV_EAGAIN) return bun.String.static("EAGAIN").toJS(globalThis);
    if (err_int == -bun.C.UV_EALREADY) return bun.String.static("EALREADY").toJS(globalThis);
    if (err_int == -bun.C.UV_EBADF) return bun.String.static("EBADF").toJS(globalThis);
    if (err_int == -bun.C.UV_EBUSY) return bun.String.static("EBUSY").toJS(globalThis);
    if (err_int == -bun.C.UV_ECANCELED) return bun.String.static("ECANCELED").toJS(globalThis);
    if (err_int == -bun.C.UV_ECHARSET) return bun.String.static("ECHARSET").toJS(globalThis);
    if (err_int == -bun.C.UV_ECONNABORTED) return bun.String.static("ECONNABORTED").toJS(globalThis);
    if (err_int == -bun.C.UV_ECONNREFUSED) return bun.String.static("ECONNREFUSED").toJS(globalThis);
    if (err_int == -bun.C.UV_ECONNRESET) return bun.String.static("ECONNRESET").toJS(globalThis);
    if (err_int == -bun.C.UV_EDESTADDRREQ) return bun.String.static("EDESTADDRREQ").toJS(globalThis);
    if (err_int == -bun.C.UV_EEXIST) return bun.String.static("EEXIST").toJS(globalThis);
    if (err_int == -bun.C.UV_EFAULT) return bun.String.static("EFAULT").toJS(globalThis);
    if (err_int == -bun.C.UV_EHOSTUNREACH) return bun.String.static("EHOSTUNREACH").toJS(globalThis);
    if (err_int == -bun.C.UV_EINTR) return bun.String.static("EINTR").toJS(globalThis);
    if (err_int == -bun.C.UV_EINVAL) return bun.String.static("EINVAL").toJS(globalThis);
    if (err_int == -bun.C.UV_EIO) return bun.String.static("EIO").toJS(globalThis);
    if (err_int == -bun.C.UV_EISCONN) return bun.String.static("EISCONN").toJS(globalThis);
    if (err_int == -bun.C.UV_EISDIR) return bun.String.static("EISDIR").toJS(globalThis);
    if (err_int == -bun.C.UV_ELOOP) return bun.String.static("ELOOP").toJS(globalThis);
    if (err_int == -bun.C.UV_EMFILE) return bun.String.static("EMFILE").toJS(globalThis);
    if (err_int == -bun.C.UV_EMSGSIZE) return bun.String.static("EMSGSIZE").toJS(globalThis);
    if (err_int == -bun.C.UV_ENAMETOOLONG) return bun.String.static("ENAMETOOLONG").toJS(globalThis);
    if (err_int == -bun.C.UV_ENETDOWN) return bun.String.static("ENETDOWN").toJS(globalThis);
    if (err_int == -bun.C.UV_ENETUNREACH) return bun.String.static("ENETUNREACH").toJS(globalThis);
    if (err_int == -bun.C.UV_ENFILE) return bun.String.static("ENFILE").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOBUFS) return bun.String.static("ENOBUFS").toJS(globalThis);
    if (err_int == -bun.C.UV_ENODEV) return bun.String.static("ENODEV").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOENT) return bun.String.static("ENOENT").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOMEM) return bun.String.static("ENOMEM").toJS(globalThis);
    if (err_int == -bun.C.UV_ENONET) return bun.String.static("ENONET").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOSPC) return bun.String.static("ENOSPC").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOSYS) return bun.String.static("ENOSYS").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOTCONN) return bun.String.static("ENOTCONN").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOTDIR) return bun.String.static("ENOTDIR").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOTEMPTY) return bun.String.static("ENOTEMPTY").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOTSOCK) return bun.String.static("ENOTSOCK").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOTSUP) return bun.String.static("ENOTSUP").toJS(globalThis);
    if (err_int == -bun.C.UV_EPERM) return bun.String.static("EPERM").toJS(globalThis);
    if (err_int == -bun.C.UV_EPIPE) return bun.String.static("EPIPE").toJS(globalThis);
    if (err_int == -bun.C.UV_EPROTO) return bun.String.static("EPROTO").toJS(globalThis);
    if (err_int == -bun.C.UV_EPROTONOSUPPORT) return bun.String.static("EPROTONOSUPPORT").toJS(globalThis);
    if (err_int == -bun.C.UV_EPROTOTYPE) return bun.String.static("EPROTOTYPE").toJS(globalThis);
    if (err_int == -bun.C.UV_EROFS) return bun.String.static("EROFS").toJS(globalThis);
    if (err_int == -bun.C.UV_ESHUTDOWN) return bun.String.static("ESHUTDOWN").toJS(globalThis);
    if (err_int == -bun.C.UV_ESPIPE) return bun.String.static("ESPIPE").toJS(globalThis);
    if (err_int == -bun.C.UV_ESRCH) return bun.String.static("ESRCH").toJS(globalThis);
    if (err_int == -bun.C.UV_ETIMEDOUT) return bun.String.static("ETIMEDOUT").toJS(globalThis);
    if (err_int == -bun.C.UV_ETXTBSY) return bun.String.static("ETXTBSY").toJS(globalThis);
    if (err_int == -bun.C.UV_EXDEV) return bun.String.static("EXDEV").toJS(globalThis);
    if (err_int == -bun.C.UV_EFBIG) return bun.String.static("EFBIG").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOPROTOOPT) return bun.String.static("ENOPROTOOPT").toJS(globalThis);
    if (err_int == -bun.C.UV_ERANGE) return bun.String.static("ERANGE").toJS(globalThis);
    if (err_int == -bun.C.UV_ENXIO) return bun.String.static("ENXIO").toJS(globalThis);
    if (err_int == -bun.C.UV_EMLINK) return bun.String.static("EMLINK").toJS(globalThis);
    if (err_int == -bun.C.UV_EHOSTDOWN) return bun.String.static("EHOSTDOWN").toJS(globalThis);
    if (err_int == -bun.C.UV_EREMOTEIO) return bun.String.static("EREMOTEIO").toJS(globalThis);
    if (err_int == -bun.C.UV_ENOTTY) return bun.String.static("ENOTTY").toJS(globalThis);
    if (err_int == -bun.C.UV_EFTYPE) return bun.String.static("EFTYPE").toJS(globalThis);
    if (err_int == -bun.C.UV_EILSEQ) return bun.String.static("EILSEQ").toJS(globalThis);
    if (err_int == -bun.C.UV_EOVERFLOW) return bun.String.static("EOVERFLOW").toJS(globalThis);
    if (err_int == -bun.C.UV_ESOCKTNOSUPPORT) return bun.String.static("ESOCKTNOSUPPORT").toJS(globalThis);
    if (err_int == -bun.C.UV_ENODATA) return bun.String.static("ENODATA").toJS(globalThis);
    if (err_int == -bun.C.UV_EUNATCH) return bun.String.static("EUNATCH").toJS(globalThis);

    var fmtstring = bun.String.createFormat("Unknown system error {d}", .{err_int}) catch bun.outOfMemory();
    return fmtstring.transferToJS(globalThis);
}

/// `extractedSplitNewLines` for ASCII/Latin1 strings. Panics if passed a non-string.
/// Returns `undefined` if param is utf8 or utf16 and not fully ascii.
///
/// ```js
/// // util.js
/// const extractedNewLineRe = new RegExp("(?<=\\n)");
/// extractedSplitNewLines = value => RegExpPrototypeSymbolSplit(extractedNewLineRe, value);
/// ```
pub fn extractedSplitNewLinesFastPathStringsOnly(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    bun.assert(callframe.argumentsCount() == 1);
    const value = callframe.argument(0);
    bun.assert(value.isString());

    const str = try value.toBunString2(globalThis);
    defer str.deref();

    return switch (str.encoding()) {
        inline .utf16, .latin1 => |encoding| split(encoding, globalThis, bun.default_allocator, &str),
        .utf8 => if (bun.strings.isAllASCII(str.byteSlice()))
            return split(.utf8, globalThis, bun.default_allocator, &str)
        else
            return JSC.JSValue.jsUndefined(),
    };
}

fn split(
    comptime encoding: bun.strings.EncodingNonAscii,
    globalThis: *JSC.JSGlobalObject,
    allocator: Allocator,
    str: *const bun.String,
) bun.JSError!JSC.JSValue {
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
            inline .utf8 => bun.String.fromUTF8(line),
            inline .latin1 => bun.String.createLatin1(line),
            inline .utf16 => bun.String.fromUTF16(line),
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
