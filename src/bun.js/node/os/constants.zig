const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Environment = bun.Environment;
const JSC = bun.JSC;

const ConstantType = enum { ERRNO, ERRNO_WIN, SIG, DLOPEN, OTHER };

fn getErrnoConstant(comptime name: []const u8) ?comptime_int {
    return if (@hasField(std.posix.E, name))
        return @intFromEnum(@field(std.posix.E, name))
    else
        return null;
}

fn getWindowsErrnoConstant(comptime name: []const u8) ?comptime_int {
    return if (@hasField(std.posix.E, name))
        return @intFromEnum(@field(std.os.windows.ws2_32.WinsockError, name))
    else
        return null;
}

fn getSignalsConstant(comptime name: []const u8) ?comptime_int {
    return if (@hasDecl(std.posix.SIG, name))
        return @field(std.posix.SIG, name)
    else
        return null;
}

fn getDlopenConstant(comptime name: []const u8) ?comptime_int {
    return if (@hasDecl(std.posix.system.RTLD, name))
        return @field(std.posix.system.RTLD, name)
    else
        return null;
}

fn defineConstant(globalObject: *JSC.JSGlobalObject, object: JSC.JSValue, comptime ctype: ConstantType, comptime name: string) void {
    return __defineConstant(globalObject, object, ctype, name, null);
}

fn __defineConstant(globalObject: *JSC.JSGlobalObject, object: JSC.JSValue, comptime ctype: ConstantType, comptime name: string, comptime value: ?i32) void {
    switch (ctype) {
        .ERRNO => {
            if (comptime getErrnoConstant(name)) |constant| {
                object.put(globalObject, JSC.ZigString.static("E" ++ name), JSC.JSValue.jsNumber(constant));
            }
        },
        .ERRNO_WIN => {
            if (comptime getWindowsErrnoConstant(name)) |constant| {
                object.put(globalObject, JSC.ZigString.static(name), JSC.JSValue.jsNumber(constant));
            }
        },
        .SIG => {
            if (comptime getSignalsConstant(name)) |constant| {
                object.put(globalObject, JSC.ZigString.static("SIG" ++ name), JSC.JSValue.jsNumber(constant));
            }
        },
        .DLOPEN => {
            if (comptime getDlopenConstant(name)) |constant| {
                object.put(globalObject, JSC.ZigString.static("RTLD_" ++ name), JSC.JSValue.jsNumber(constant));
            }
        },
        .OTHER => {
            object.put(globalObject, JSC.ZigString.static(name), JSC.JSValue.jsNumberFromInt32(value.?));
        },
    }
}

pub fn create(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSC.JSValue.createEmptyObject(globalObject, 0);

    object.put(globalObject, JSC.ZigString.static("errno"), createErrno(globalObject));
    object.put(globalObject, JSC.ZigString.static("signals"), createSignals(globalObject));
    object.put(globalObject, JSC.ZigString.static("priority"), createPriority(globalObject));
    object.put(globalObject, JSC.ZigString.static("dlopen"), createDlopen(globalObject));
    __defineConstant(globalObject, object, .OTHER, "UV_UDP_REUSEADDR", 4);

    return object;
}

fn createErrno(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSC.JSValue.createEmptyObject(globalObject, 0);

    defineConstant(globalObject, object, .ERRNO, "2BIG");
    defineConstant(globalObject, object, .ERRNO, "ACCES");
    defineConstant(globalObject, object, .ERRNO, "ADDRINUSE");
    defineConstant(globalObject, object, .ERRNO, "ADDRNOTAVAIL");
    defineConstant(globalObject, object, .ERRNO, "AFNOSUPPORT");
    defineConstant(globalObject, object, .ERRNO, "AGAIN");
    defineConstant(globalObject, object, .ERRNO, "ALREADY");
    defineConstant(globalObject, object, .ERRNO, "BADF");
    defineConstant(globalObject, object, .ERRNO, "BADMSG");
    defineConstant(globalObject, object, .ERRNO, "BUSY");
    defineConstant(globalObject, object, .ERRNO, "CANCELED");
    defineConstant(globalObject, object, .ERRNO, "CHILD");
    defineConstant(globalObject, object, .ERRNO, "CONNABORTED");
    defineConstant(globalObject, object, .ERRNO, "CONNREFUSED");
    defineConstant(globalObject, object, .ERRNO, "CONNRESET");
    defineConstant(globalObject, object, .ERRNO, "DEADLK");
    defineConstant(globalObject, object, .ERRNO, "DESTADDRREQ");
    defineConstant(globalObject, object, .ERRNO, "DOM");
    defineConstant(globalObject, object, .ERRNO, "DQUOT");
    defineConstant(globalObject, object, .ERRNO, "EXIST");
    defineConstant(globalObject, object, .ERRNO, "FAULT");
    defineConstant(globalObject, object, .ERRNO, "FBIG");
    defineConstant(globalObject, object, .ERRNO, "HOSTUNREACH");
    defineConstant(globalObject, object, .ERRNO, "IDRM");
    defineConstant(globalObject, object, .ERRNO, "ILSEQ");
    defineConstant(globalObject, object, .ERRNO, "INPROGRESS");
    defineConstant(globalObject, object, .ERRNO, "INTR");
    defineConstant(globalObject, object, .ERRNO, "INVAL");
    defineConstant(globalObject, object, .ERRNO, "IO");
    defineConstant(globalObject, object, .ERRNO, "ISCONN");
    defineConstant(globalObject, object, .ERRNO, "ISDIR");
    defineConstant(globalObject, object, .ERRNO, "LOOP");
    defineConstant(globalObject, object, .ERRNO, "MFILE");
    defineConstant(globalObject, object, .ERRNO, "MLINK");
    defineConstant(globalObject, object, .ERRNO, "MSGSIZE");
    defineConstant(globalObject, object, .ERRNO, "MULTIHOP");
    defineConstant(globalObject, object, .ERRNO, "NAMETOOLONG");
    defineConstant(globalObject, object, .ERRNO, "NETDOWN");
    defineConstant(globalObject, object, .ERRNO, "NETRESET");
    defineConstant(globalObject, object, .ERRNO, "NETUNREACH");
    defineConstant(globalObject, object, .ERRNO, "NFILE");
    defineConstant(globalObject, object, .ERRNO, "NOBUFS");
    defineConstant(globalObject, object, .ERRNO, "NODATA");
    defineConstant(globalObject, object, .ERRNO, "NODEV");
    defineConstant(globalObject, object, .ERRNO, "NOENT");
    defineConstant(globalObject, object, .ERRNO, "NOEXEC");
    defineConstant(globalObject, object, .ERRNO, "NOLCK");
    defineConstant(globalObject, object, .ERRNO, "NOLINK");
    defineConstant(globalObject, object, .ERRNO, "NOMEM");
    defineConstant(globalObject, object, .ERRNO, "NOMSG");
    defineConstant(globalObject, object, .ERRNO, "NOPROTOOPT");
    defineConstant(globalObject, object, .ERRNO, "NOSPC");
    defineConstant(globalObject, object, .ERRNO, "NOSR");
    defineConstant(globalObject, object, .ERRNO, "NOSTR");
    defineConstant(globalObject, object, .ERRNO, "NOSYS");
    defineConstant(globalObject, object, .ERRNO, "NOTCONN");
    defineConstant(globalObject, object, .ERRNO, "NOTDIR");
    defineConstant(globalObject, object, .ERRNO, "NOTEMPTY");
    defineConstant(globalObject, object, .ERRNO, "NOTSOCK");
    defineConstant(globalObject, object, .ERRNO, "NOTSUP");
    defineConstant(globalObject, object, .ERRNO, "NOTTY");
    defineConstant(globalObject, object, .ERRNO, "NXIO");
    defineConstant(globalObject, object, .ERRNO, "OPNOTSUPP");
    defineConstant(globalObject, object, .ERRNO, "OVERFLOW");
    defineConstant(globalObject, object, .ERRNO, "PERM");
    defineConstant(globalObject, object, .ERRNO, "PIPE");
    defineConstant(globalObject, object, .ERRNO, "PROTO");
    defineConstant(globalObject, object, .ERRNO, "PROTONOSUPPORT");
    defineConstant(globalObject, object, .ERRNO, "PROTOTYPE");
    defineConstant(globalObject, object, .ERRNO, "RANGE");
    defineConstant(globalObject, object, .ERRNO, "ROFS");
    defineConstant(globalObject, object, .ERRNO, "SPIPE");
    defineConstant(globalObject, object, .ERRNO, "SRCH");
    defineConstant(globalObject, object, .ERRNO, "STALE");
    defineConstant(globalObject, object, .ERRNO, "TIME");
    defineConstant(globalObject, object, .ERRNO, "TIMEDOUT");
    defineConstant(globalObject, object, .ERRNO, "TXTBSY");
    defineConstant(globalObject, object, .ERRNO, "WOULDBLOCK");
    defineConstant(globalObject, object, .ERRNO, "XDEV");

    if (comptime Environment.isWindows) {
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEINTR");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEBADF");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEACCES");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEFAULT");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEINVAL");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEMFILE");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEWOULDBLOCK");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEINPROGRESS");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEALREADY");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAENOTSOCK");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEDESTADDRREQ");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEMSGSIZE");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEPROTOTYPE");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAENOPROTOOPT");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEPROTONOSUPPORT");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAESOCKTNOSUPPORT");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEOPNOTSUPP");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEPFNOSUPPORT");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEAFNOSUPPORT");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEADDRINUSE");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEADDRNOTAVAIL");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAENETDOWN");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAENETUNREACH");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAENETRESET");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAECONNABORTED");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAECONNRESET");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAENOBUFS");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEISCONN");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAENOTCONN");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAESHUTDOWN");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAETOOMANYREFS");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAETIMEDOUT");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAECONNREFUSED");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAELOOP");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAENAMETOOLONG");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEHOSTDOWN");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEHOSTUNREACH");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAENOTEMPTY");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEPROCLIM");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEUSERS");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEDQUOT");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAESTALE");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEREMOTE");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSASYSNOTREADY");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAVERNOTSUPPORTED");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSANOTINITIALISED");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEDISCON");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAENOMORE");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAECANCELLED");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEINVALIDPROCTABLE");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEINVALIDPROVIDER");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEPROVIDERFAILEDINIT");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSASYSCALLFAILURE");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSASERVICE_NOT_FOUND");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSATYPE_NOT_FOUND");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSA_E_NO_MORE");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSA_E_CANCELLED");
        defineConstant(globalObject, object, .ERRNO_WIN, "WSAEREFUSED");
    }

    return object;
}

fn createSignals(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSC.JSValue.createEmptyObject(globalObject, 0);

    defineConstant(globalObject, object, .SIG, "HUP");
    defineConstant(globalObject, object, .SIG, "INT");
    defineConstant(globalObject, object, .SIG, "QUIT");
    defineConstant(globalObject, object, .SIG, "ILL");
    defineConstant(globalObject, object, .SIG, "TRAP");
    defineConstant(globalObject, object, .SIG, "ABRT");
    defineConstant(globalObject, object, .SIG, "IOT");
    defineConstant(globalObject, object, .SIG, "BUS");
    defineConstant(globalObject, object, .SIG, "FPE");
    defineConstant(globalObject, object, .SIG, "KILL");
    defineConstant(globalObject, object, .SIG, "USR1");
    defineConstant(globalObject, object, .SIG, "SEGV");
    defineConstant(globalObject, object, .SIG, "USR2");
    defineConstant(globalObject, object, .SIG, "PIPE");
    defineConstant(globalObject, object, .SIG, "ALRM");
    defineConstant(globalObject, object, .SIG, "TERM");
    defineConstant(globalObject, object, .SIG, "CHLD");
    defineConstant(globalObject, object, .SIG, "STKFLT");
    defineConstant(globalObject, object, .SIG, "CONT");
    defineConstant(globalObject, object, .SIG, "STOP");
    defineConstant(globalObject, object, .SIG, "TSTP");
    defineConstant(globalObject, object, .SIG, "BREAK");
    defineConstant(globalObject, object, .SIG, "TTIN");
    defineConstant(globalObject, object, .SIG, "TTOU");
    defineConstant(globalObject, object, .SIG, "URG");
    defineConstant(globalObject, object, .SIG, "XCPU");
    defineConstant(globalObject, object, .SIG, "XFSZ");
    defineConstant(globalObject, object, .SIG, "VTALRM");
    defineConstant(globalObject, object, .SIG, "PROF");
    defineConstant(globalObject, object, .SIG, "WINCH");
    defineConstant(globalObject, object, .SIG, "IO");
    defineConstant(globalObject, object, .SIG, "POLL");
    defineConstant(globalObject, object, .SIG, "LOST");
    defineConstant(globalObject, object, .SIG, "PWR");
    defineConstant(globalObject, object, .SIG, "INFO");
    defineConstant(globalObject, object, .SIG, "SYS");
    defineConstant(globalObject, object, .SIG, "UNUSED");

    return object;
}

fn createPriority(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSC.JSValue.createEmptyObject(globalObject, 6);

    __defineConstant(globalObject, object, .OTHER, "PRIORITY_LOW", 19);
    __defineConstant(globalObject, object, .OTHER, "PRIORITY_BELOW_NORMAL", 10);
    __defineConstant(globalObject, object, .OTHER, "PRIORITY_NORMAL", 0);
    __defineConstant(globalObject, object, .OTHER, "PRIORITY_ABOVE_NORMAL", -7);
    __defineConstant(globalObject, object, .OTHER, "PRIORITY_HIGH", -14);
    __defineConstant(globalObject, object, .OTHER, "PRIORITY_HIGHEST", -20);

    return object;
}

fn createDlopen(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSC.JSValue.createEmptyObject(globalObject, 5);

    defineConstant(globalObject, object, .DLOPEN, "LAZY");
    defineConstant(globalObject, object, .DLOPEN, "NOW");
    defineConstant(globalObject, object, .DLOPEN, "GLOBAL");
    defineConstant(globalObject, object, .DLOPEN, "LOCAL");
    defineConstant(globalObject, object, .DLOPEN, "DEEPBIND");

    return object;
}
