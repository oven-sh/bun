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
