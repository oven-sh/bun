const std = @import("std");
const builtin = @import("builtin");
const bun = @import("../../global.zig");
const C = bun.C;
const string = bun.string;
const JSC = @import("../../jsc.zig");
const Environment = bun.Environment;
const Global = bun.Global;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const heap_allocator = bun.default_allocator;

pub const Os = struct {
    pub const name = "Bun__Os";
    pub const code = @embedFile("../os.exports.js");

    pub fn create(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        const module = JSC.JSValue.createEmptyObject(globalObject, 20);

        module.put(globalObject, &JSC.ZigString.init("arch"), JSC.NewFunction(globalObject, &JSC.ZigString.init("arch"), 0, arch));
        module.put(globalObject, &JSC.ZigString.init("cpus"), JSC.NewFunction(globalObject, &JSC.ZigString.init("cpus"), 0, cpus));
        module.put(globalObject, &JSC.ZigString.init("endianness"), JSC.NewFunction(globalObject, &JSC.ZigString.init("endianness"), 0, endianness));
        module.put(globalObject, &JSC.ZigString.init("freemem"), JSC.NewFunction(globalObject, &JSC.ZigString.init("freemem"), 0, freemem));
        module.put(globalObject, &JSC.ZigString.init("getPriority"), JSC.NewFunction(globalObject, &JSC.ZigString.init("getPriority"), 1, getPriority));
        module.put(globalObject, &JSC.ZigString.init("homedir"), JSC.NewFunction(globalObject, &JSC.ZigString.init("homedir"), 0, homedir));
        module.put(globalObject, &JSC.ZigString.init("hostname"), JSC.NewFunction(globalObject, &JSC.ZigString.init("hostname"), 0, hostname));
        module.put(globalObject, &JSC.ZigString.init("loadavg"), JSC.NewFunction(globalObject, &JSC.ZigString.init("loadavg"), 0, loadavg));
        module.put(globalObject, &JSC.ZigString.init("platform"), JSC.NewFunction(globalObject, &JSC.ZigString.init("platform"), 0, platform));
        module.put(globalObject, &JSC.ZigString.init("release"), JSC.NewFunction(globalObject, &JSC.ZigString.init("release"), 0, release));
        module.put(globalObject, &JSC.ZigString.init("setPriority"), JSC.NewFunction(globalObject, &JSC.ZigString.init("setPriority"), 2, setPriority));
        module.put(globalObject, &JSC.ZigString.init("tmpdir"), JSC.NewFunction(globalObject, &JSC.ZigString.init("tmpdir"), 0, tmpdir));
        module.put(globalObject, &JSC.ZigString.init("totalmem"), JSC.NewFunction(globalObject, &JSC.ZigString.init("totalmem"), 0, @"totalmem"));
        module.put(globalObject, &JSC.ZigString.init("type"), JSC.NewFunction(globalObject, &JSC.ZigString.init("type"), 0, @"type"));
        module.put(globalObject, &JSC.ZigString.init("uptime"), JSC.NewFunction(globalObject, &JSC.ZigString.init("uptime"), 0, uptime));
        module.put(globalObject, &JSC.ZigString.init("userInfo"), JSC.NewFunction(globalObject, &JSC.ZigString.init("userInfo"), 0, userInfo));
        module.put(globalObject, &JSC.ZigString.init("version"), JSC.NewFunction(globalObject, &JSC.ZigString.init("version"), 0, version));

        module.put(globalObject, &JSC.ZigString.init("devNull"), JSC.ZigString.init(devNull).withEncoding().toValue(globalObject));
        module.put(globalObject, &JSC.ZigString.init("EOL"), JSC.ZigString.init(EOL).withEncoding().toValue(globalObject));

        constants.create(module, globalObject);

        return module;
    }

    pub const EOL = if (Environment.isWindows) "\\r\\n" else "\\n";
    pub const devNull = if (Environment.isWindows) "\\\\.\nul" else "/dev/null";
    pub const constants = struct {
        pub const signals = struct {
            pub const SIGHUP = 1;
            pub const SIGINT = 2;
            pub const SIGQUIT = 3;
            pub const SIGILL = 4;
            pub const SIGTRAP = 5;
            pub const SIGABRT = 6;
            pub const SIGIOT = 6;
            pub const SIGBUS = 7;
            pub const SIGFPE = 8;
            pub const SIGKILL = 9;
            pub const SIGUSR1 = 10;
            pub const SIGSEGV = 11;
            pub const SIGUSR2 = 12;
            pub const SIGPIPE = 13;
            pub const SIGALRM = 14;
            pub const SIGTERM = 15;
            pub const SIGCHLD = 17;
            pub const SIGSTKFLT = 16;
            pub const SIGCONT = 18;
            pub const SIGSTOP = 19;
            pub const SIGTSTP = 20;
            pub const SIGTTIN = 21;
            pub const SIGTTOU = 22;
            pub const SIGURG = 23;
            pub const SIGXCPU = 24;
            pub const SIGXFSZ = 25;
            pub const SIGVTALRM = 26;
            pub const SIGPROF = 27;
            pub const SIGWINCH = 28;
            pub const SIGIO = 29;
            pub const SIGPOLL = 29;
            pub const SIGPWR = 30;
            pub const SIGSYS = 31;
            pub const SIGUNUSED = 31;

            pub fn create(module: JSC.JSValue, globalObject: *JSC.JSGlobalObject) callconv(.C) void {
                const constantsModule = JSC.JSValue.createEmptyObject(globalObject, 34);

                constantsModule.put(globalObject, &JSC.ZigString.init("SIGHUP"), JSC.JSValue.jsNumber(SIGHUP));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGINT"), JSC.JSValue.jsNumber(SIGINT));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGQUIT"), JSC.JSValue.jsNumber(SIGQUIT));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGILL"), JSC.JSValue.jsNumber(SIGILL));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGTRAP"), JSC.JSValue.jsNumber(SIGTRAP));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGABRT"), JSC.JSValue.jsNumber(SIGABRT));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGIOT"), JSC.JSValue.jsNumber(SIGIOT));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGBUS"), JSC.JSValue.jsNumber(SIGBUS));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGFPE"), JSC.JSValue.jsNumber(SIGFPE));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGKILL"), JSC.JSValue.jsNumber(SIGKILL));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGUSR1"), JSC.JSValue.jsNumber(SIGUSR1));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGSEGV"), JSC.JSValue.jsNumber(SIGSEGV));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGUSR2"), JSC.JSValue.jsNumber(SIGUSR2));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGPIPE"), JSC.JSValue.jsNumber(SIGPIPE));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGALRM"), JSC.JSValue.jsNumber(SIGALRM));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGTERM"), JSC.JSValue.jsNumber(SIGTERM));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGCHLD"), JSC.JSValue.jsNumber(SIGCHLD));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGSTKFLT"), JSC.JSValue.jsNumber(SIGSTKFLT));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGCONT"), JSC.JSValue.jsNumber(SIGCONT));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGSTOP"), JSC.JSValue.jsNumber(SIGSTOP));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGTSTP"), JSC.JSValue.jsNumber(SIGTSTP));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGTTIN"), JSC.JSValue.jsNumber(SIGTTIN));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGTTOU"), JSC.JSValue.jsNumber(SIGTTOU));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGURG"), JSC.JSValue.jsNumber(SIGURG));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGXCPU"), JSC.JSValue.jsNumber(SIGXCPU));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGXFSZ"), JSC.JSValue.jsNumber(SIGXFSZ));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGVTALRM"), JSC.JSValue.jsNumber(SIGVTALRM));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGPROF"), JSC.JSValue.jsNumber(SIGPROF));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGWINCH"), JSC.JSValue.jsNumber(SIGWINCH));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGIO"), JSC.JSValue.jsNumber(SIGIO));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGPOLL"), JSC.JSValue.jsNumber(SIGPOLL));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGPWR"), JSC.JSValue.jsNumber(SIGPWR));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGSYS"), JSC.JSValue.jsNumber(SIGSYS));
                constantsModule.put(globalObject, &JSC.ZigString.init("SIGUNUSED"), JSC.JSValue.jsNumber(SIGUNUSED));

                module.put(globalObject, &JSC.ZigString.init("dlopen"), constantsModule);
            }
        };
        pub const errno = struct {
            pub const E2BIG = 7;
            pub const EACCES = 13;
            pub const EADDRINUSE = 98;
            pub const EADDRNOTAVAIL = 99;
            pub const EAFNOSUPPORT = 97;
            pub const EAGAIN = 11;
            pub const EALREADY = 114;
            pub const EBADF = 9;
            pub const EBADMSG = 74;
            pub const EBUSY = 16;
            pub const ECANCELED = 125;
            pub const ECHILD = 10;
            pub const ECONNABORTED = 103;
            pub const ECONNREFUSED = 111;
            pub const ECONNRESET = 104;
            pub const EDEADLK = 35;
            pub const EDESTADDRREQ = 89;
            pub const EDOM = 33;
            pub const EDQUOT = 122;
            pub const EEXIST = 17;
            pub const EFAULT = 14;
            pub const EFBIG = 27;
            pub const EHOSTUNREACH = 113;
            pub const EIDRM = 43;
            pub const EILSEQ = 84;
            pub const EINPROGRESS = 115;
            pub const EINTR = 4;
            pub const EINVAL = 22;
            pub const EIO = 5;
            pub const EISCONN = 106;
            pub const EISDIR = 21;
            pub const ELOOP = 40;
            pub const EMFILE = 24;
            pub const EMLINK = 31;
            pub const EMSGSIZE = 90;
            pub const EMULTIHOP = 72;
            pub const ENAMETOOLONG = 36;
            pub const ENETDOWN = 100;
            pub const ENETRESET = 102;
            pub const ENETUNREACH = 101;
            pub const ENFILE = 23;
            pub const ENOBUFS = 105;
            pub const ENODATA = 61;
            pub const ENODEV = 19;
            pub const ENOENT = 2;
            pub const ENOEXEC = 8;
            pub const ENOLCK = 37;
            pub const ENOLINK = 67;
            pub const ENOMEM = 12;
            pub const ENOMSG = 42;
            pub const ENOPROTOOPT = 92;
            pub const ENOSPC = 28;
            pub const ENOSR = 63;
            pub const ENOSTR = 60;
            pub const ENOSYS = 38;
            pub const ENOTCONN = 107;
            pub const ENOTDIR = 20;
            pub const ENOTEMPTY = 39;
            pub const ENOTSOCK = 88;
            pub const ENOTSUP = 95;
            pub const ENOTTY = 25;
            pub const ENXIO = 6;
            pub const EOPNOTSUPP = 95;
            pub const EOVERFLOW = 75;
            pub const EPERM = 1;
            pub const EPIPE = 32;
            pub const EPROTO = 71;
            pub const EPROTONOSUPPORT = 93;
            pub const EPROTOTYPE = 91;
            pub const ERANGE = 34;
            pub const EROFS = 30;
            pub const ESPIPE = 29;
            pub const ESRCH = 3;
            pub const ESTALE = 116;
            pub const ETIME = 62;
            pub const ETIMEDOUT = 110;
            pub const ETXTBSY = 26;
            pub const EWOULDBLOCK = 11;
            pub const EXDEV = 18;

            pub fn create(module: JSC.JSValue, globalObject: *JSC.JSGlobalObject) callconv(.C) void {
                const constantsModule = JSC.JSValue.createEmptyObject(globalObject, 79);

                constantsModule.put(globalObject, &JSC.ZigString.init("E2BIG"), JSC.JSValue.jsNumber(E2BIG));
                constantsModule.put(globalObject, &JSC.ZigString.init("EACCES"), JSC.JSValue.jsNumber(EACCES));
                constantsModule.put(globalObject, &JSC.ZigString.init("EADDRINUSE"), JSC.JSValue.jsNumber(EADDRINUSE));
                constantsModule.put(globalObject, &JSC.ZigString.init("EADDRNOTAVAIL"), JSC.JSValue.jsNumber(EADDRNOTAVAIL));
                constantsModule.put(globalObject, &JSC.ZigString.init("EAFNOSUPPORT"), JSC.JSValue.jsNumber(EAFNOSUPPORT));
                constantsModule.put(globalObject, &JSC.ZigString.init("EAGAIN"), JSC.JSValue.jsNumber(EAGAIN));
                constantsModule.put(globalObject, &JSC.ZigString.init("EALREADY"), JSC.JSValue.jsNumber(EALREADY));
                constantsModule.put(globalObject, &JSC.ZigString.init("EBADF"), JSC.JSValue.jsNumber(EBADF));
                constantsModule.put(globalObject, &JSC.ZigString.init("EBADMSG"), JSC.JSValue.jsNumber(EBADMSG));
                constantsModule.put(globalObject, &JSC.ZigString.init("EBUSY"), JSC.JSValue.jsNumber(EBUSY));
                constantsModule.put(globalObject, &JSC.ZigString.init("ECANCELED"), JSC.JSValue.jsNumber(ECANCELED));
                constantsModule.put(globalObject, &JSC.ZigString.init("ECHILD"), JSC.JSValue.jsNumber(ECHILD));
                constantsModule.put(globalObject, &JSC.ZigString.init("ECONNABORTED"), JSC.JSValue.jsNumber(ECONNABORTED));
                constantsModule.put(globalObject, &JSC.ZigString.init("ECONNREFUSED"), JSC.JSValue.jsNumber(ECONNREFUSED));
                constantsModule.put(globalObject, &JSC.ZigString.init("ECONNRESET"), JSC.JSValue.jsNumber(ECONNRESET));
                constantsModule.put(globalObject, &JSC.ZigString.init("EDEADLK"), JSC.JSValue.jsNumber(EDEADLK));
                constantsModule.put(globalObject, &JSC.ZigString.init("EDESTADDRREQ"), JSC.JSValue.jsNumber(EDESTADDRREQ));
                constantsModule.put(globalObject, &JSC.ZigString.init("EDOM"), JSC.JSValue.jsNumber(EDOM));
                constantsModule.put(globalObject, &JSC.ZigString.init("EDQUOT"), JSC.JSValue.jsNumber(EDQUOT));
                constantsModule.put(globalObject, &JSC.ZigString.init("EEXIST"), JSC.JSValue.jsNumber(EEXIST));
                constantsModule.put(globalObject, &JSC.ZigString.init("EFAULT"), JSC.JSValue.jsNumber(EFAULT));
                constantsModule.put(globalObject, &JSC.ZigString.init("EFBIG"), JSC.JSValue.jsNumber(EFBIG));
                constantsModule.put(globalObject, &JSC.ZigString.init("EHOSTUNREACH"), JSC.JSValue.jsNumber(EHOSTUNREACH));
                constantsModule.put(globalObject, &JSC.ZigString.init("EIDRM"), JSC.JSValue.jsNumber(EIDRM));
                constantsModule.put(globalObject, &JSC.ZigString.init("EILSEQ"), JSC.JSValue.jsNumber(EILSEQ));
                constantsModule.put(globalObject, &JSC.ZigString.init("EINPROGRESS"), JSC.JSValue.jsNumber(EINPROGRESS));
                constantsModule.put(globalObject, &JSC.ZigString.init("EINTR"), JSC.JSValue.jsNumber(EINTR));
                constantsModule.put(globalObject, &JSC.ZigString.init("EINVAL"), JSC.JSValue.jsNumber(EINVAL));
                constantsModule.put(globalObject, &JSC.ZigString.init("EIO"), JSC.JSValue.jsNumber(EIO));
                constantsModule.put(globalObject, &JSC.ZigString.init("EISCONN"), JSC.JSValue.jsNumber(EISCONN));
                constantsModule.put(globalObject, &JSC.ZigString.init("EISDIR"), JSC.JSValue.jsNumber(EISDIR));
                constantsModule.put(globalObject, &JSC.ZigString.init("ELOOP"), JSC.JSValue.jsNumber(ELOOP));
                constantsModule.put(globalObject, &JSC.ZigString.init("EMFILE"), JSC.JSValue.jsNumber(EMFILE));
                constantsModule.put(globalObject, &JSC.ZigString.init("EMLINK"), JSC.JSValue.jsNumber(EMLINK));
                constantsModule.put(globalObject, &JSC.ZigString.init("EMSGSIZE"), JSC.JSValue.jsNumber(EMSGSIZE));
                constantsModule.put(globalObject, &JSC.ZigString.init("EMULTIHOP"), JSC.JSValue.jsNumber(EMULTIHOP));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENAMETOOLONG"), JSC.JSValue.jsNumber(ENAMETOOLONG));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENETDOWN"), JSC.JSValue.jsNumber(ENETDOWN));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENETRESET"), JSC.JSValue.jsNumber(ENETRESET));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENETUNREACH"), JSC.JSValue.jsNumber(ENETUNREACH));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENFILE"), JSC.JSValue.jsNumber(ENFILE));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOBUFS"), JSC.JSValue.jsNumber(ENOBUFS));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENODATA"), JSC.JSValue.jsNumber(ENODATA));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENODEV"), JSC.JSValue.jsNumber(ENODEV));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOENT"), JSC.JSValue.jsNumber(ENOENT));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOEXEC"), JSC.JSValue.jsNumber(ENOEXEC));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOLCK"), JSC.JSValue.jsNumber(ENOLCK));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOLINK"), JSC.JSValue.jsNumber(ENOLINK));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOMEM"), JSC.JSValue.jsNumber(ENOMEM));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOMSG"), JSC.JSValue.jsNumber(ENOMSG));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOPROTOOPT"), JSC.JSValue.jsNumber(ENOPROTOOPT));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOSPC"), JSC.JSValue.jsNumber(ENOSPC));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOSR"), JSC.JSValue.jsNumber(ENOSR));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOSTR"), JSC.JSValue.jsNumber(ENOSTR));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOSYS"), JSC.JSValue.jsNumber(ENOSYS));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOTCONN"), JSC.JSValue.jsNumber(ENOTCONN));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOTDIR"), JSC.JSValue.jsNumber(ENOTDIR));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOTEMPTY"), JSC.JSValue.jsNumber(ENOTEMPTY));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOTSOCK"), JSC.JSValue.jsNumber(ENOTSOCK));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOTSUP"), JSC.JSValue.jsNumber(ENOTSUP));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENOTTY"), JSC.JSValue.jsNumber(ENOTTY));
                constantsModule.put(globalObject, &JSC.ZigString.init("ENXIO"), JSC.JSValue.jsNumber(ENXIO));
                constantsModule.put(globalObject, &JSC.ZigString.init("EOPNOTSUPP"), JSC.JSValue.jsNumber(EOPNOTSUPP));
                constantsModule.put(globalObject, &JSC.ZigString.init("EOVERFLOW"), JSC.JSValue.jsNumber(EOVERFLOW));
                constantsModule.put(globalObject, &JSC.ZigString.init("EPERM"), JSC.JSValue.jsNumber(EPERM));
                constantsModule.put(globalObject, &JSC.ZigString.init("EPIPE"), JSC.JSValue.jsNumber(EPIPE));
                constantsModule.put(globalObject, &JSC.ZigString.init("EPROTO"), JSC.JSValue.jsNumber(EPROTO));
                constantsModule.put(globalObject, &JSC.ZigString.init("EPROTONOSUPPORT"), JSC.JSValue.jsNumber(EPROTONOSUPPORT));
                constantsModule.put(globalObject, &JSC.ZigString.init("EPROTOTYPE"), JSC.JSValue.jsNumber(EPROTOTYPE));
                constantsModule.put(globalObject, &JSC.ZigString.init("ERANGE"), JSC.JSValue.jsNumber(ERANGE));
                constantsModule.put(globalObject, &JSC.ZigString.init("EROFS"), JSC.JSValue.jsNumber(EROFS));
                constantsModule.put(globalObject, &JSC.ZigString.init("ESPIPE"), JSC.JSValue.jsNumber(ESPIPE));
                constantsModule.put(globalObject, &JSC.ZigString.init("ESRCH"), JSC.JSValue.jsNumber(ESRCH));
                constantsModule.put(globalObject, &JSC.ZigString.init("ESTALE"), JSC.JSValue.jsNumber(ESTALE));
                constantsModule.put(globalObject, &JSC.ZigString.init("ETIME"), JSC.JSValue.jsNumber(ETIME));
                constantsModule.put(globalObject, &JSC.ZigString.init("ETIMEDOUT"), JSC.JSValue.jsNumber(ETIMEDOUT));
                constantsModule.put(globalObject, &JSC.ZigString.init("ETXTBSY"), JSC.JSValue.jsNumber(ETXTBSY));
                constantsModule.put(globalObject, &JSC.ZigString.init("EWOULDBLOCK"), JSC.JSValue.jsNumber(EWOULDBLOCK));
                constantsModule.put(globalObject, &JSC.ZigString.init("EXDEV"), JSC.JSValue.jsNumber(EXDEV));

                module.put(globalObject, &JSC.ZigString.init("dlopen"), constantsModule);
            }
        };
        pub const dlopen = struct {
            pub const RTLD_LAZY = 1;
            pub const RTLD_NOW = 2;
            pub const RTLD_GLOBAL = 256;
            pub const RTLD_LOCAL = 0;
            pub const RTLD_DEEPBIND = 8;

            pub fn create(module: JSC.JSValue, globalObject: *JSC.JSGlobalObject) callconv(.C) void {
                const constantsModule = JSC.JSValue.createEmptyObject(globalObject, 5);

                constantsModule.put(globalObject, &JSC.ZigString.init("RTLD_LAZY"), JSC.JSValue.jsNumber(RTLD_LAZY));
                constantsModule.put(globalObject, &JSC.ZigString.init("RTLD_NOW"), JSC.JSValue.jsNumber(RTLD_NOW));
                constantsModule.put(globalObject, &JSC.ZigString.init("RTLD_GLOBAL"), JSC.JSValue.jsNumber(RTLD_GLOBAL));
                constantsModule.put(globalObject, &JSC.ZigString.init("RTLD_LOCAL"), JSC.JSValue.jsNumber(RTLD_LOCAL));
                constantsModule.put(globalObject, &JSC.ZigString.init("RTLD_DEEPBIND"), JSC.JSValue.jsNumber(RTLD_DEEPBIND));

                module.put(globalObject, &JSC.ZigString.init("dlopen"), constantsModule);
            }
        };
        pub const priority = struct {
            pub const PRIORITY_LOW = 19;
            pub const PRIORITY_BELOW_NORMAL = 10;
            pub const PRIORITY_NORMAL = 0;
            pub const PRIORITY_ABOVE_NORMAL = -7;
            pub const PRIORITY_HIGH = -14;
            pub const PRIORITY_HIGHEST = -20;

            pub fn create(module: JSC.JSValue, globalObject: *JSC.JSGlobalObject) callconv(.C) void {
                const constantsModule = JSC.JSValue.createEmptyObject(globalObject, 7);

                constantsModule.put(globalObject, &JSC.ZigString.init("PRIORITY_LOW"), JSC.JSValue.jsNumber(PRIORITY_LOW));
                constantsModule.put(globalObject, &JSC.ZigString.init("PRIORITY_BELOW_NORMAL"), JSC.JSValue.jsNumber(PRIORITY_BELOW_NORMAL));
                constantsModule.put(globalObject, &JSC.ZigString.init("PRIORITY_NORMAL"), JSC.JSValue.jsNumber(PRIORITY_NORMAL));
                constantsModule.put(globalObject, &JSC.ZigString.init("PRIORITY_ABOVE_NORMAL"), JSC.JSValue.jsNumber(PRIORITY_ABOVE_NORMAL));
                constantsModule.put(globalObject, &JSC.ZigString.init("PRIORITY_HIGH"), JSC.JSValue.jsNumber(PRIORITY_HIGH));
                constantsModule.put(globalObject, &JSC.ZigString.init("PRIORITY_HIGHEST"), JSC.JSValue.jsNumber(PRIORITY_HIGHEST));
                constantsModule.put(globalObject, &JSC.ZigString.init("PRIORITY_LOW"), JSC.JSValue.jsNumber(PRIORITY_LOW));

                module.put(globalObject, &JSC.ZigString.init("priority"), constantsModule);
            }
        };
        pub const UV_UDP_REUSEADDR = 4;

        pub fn create(module: JSC.JSValue, globalObject: *JSC.JSGlobalObject) callconv(.C) void {
            const constantsModule = JSC.JSValue.createEmptyObject(globalObject, 5);

            constantsModule.put(globalObject, &JSC.ZigString.init("UV_UDP_REUSEADDR"), JSC.JSValue.jsNumber(UV_UDP_REUSEADDR));

            priority.create(constantsModule, globalObject);
            dlopen.create(constantsModule, globalObject);

            module.put(globalObject, &JSC.ZigString.init("constants"), constantsModule);
        }
    };

    pub fn arch(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        return JSC.ZigString.init(Global.arch_name).withEncoding().toValue(globalThis);
    }

    pub fn cpus(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isLinux) {
            const cpus_ = C.linux.get_cpu_info_and_time();

            var result = std.ArrayList(JSC.JSValue).init(heap_allocator);
            defer result.deinit();

            for (cpus_) |_, index| {
                var object = JSC.JSValue.createEmptyObject(globalThis, 3);
                var timesObject = JSC.JSValue.createEmptyObject(globalThis, 5);

                timesObject.put(globalThis, &JSC.ZigString.init("user"), JSC.JSValue.jsNumber(cpus_[index].userTime));
                timesObject.put(globalThis, &JSC.ZigString.init("nice"), JSC.JSValue.jsNumber(cpus_[index].niceTime));
                timesObject.put(globalThis, &JSC.ZigString.init("sys"), JSC.JSValue.jsNumber(cpus_[index].systemTime));
                timesObject.put(globalThis, &JSC.ZigString.init("idle"), JSC.JSValue.jsNumber(cpus_[index].idleTime));
                timesObject.put(globalThis, &JSC.ZigString.init("irq"), JSC.JSValue.jsNumber(cpus_[index].irqTime));

                object.put(globalThis, &JSC.ZigString.init("model"), JSC.ZigString.init(std.mem.span(cpus_[index].manufacturer)).withEncoding().toValueGC(globalThis));
                object.put(globalThis, &JSC.ZigString.init("speed"), JSC.JSValue.jsNumber(@floatToInt(i32, cpus_[index].clockSpeed)));
                object.put(globalThis, &JSC.ZigString.init("times"), timesObject);

                _ = result.append(object) catch unreachable;
            }

            return JSC.JSArray.from(globalThis, result.items);
        }

        return JSC.JSArray.from(globalThis, &.{});
    }

    pub fn endianness(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        switch (comptime builtin.target.cpu.arch.endian()) {
            .Big => {
                return JSC.ZigString.init("BE").withEncoding().toValue(globalThis);
            },
            .Little => {
                return JSC.ZigString.init("LE").withEncoding().toValue(globalThis);
            },
        }
    }

    pub fn freemem(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isLinux) {
            return JSC.JSValue.jsNumberFromUint64(C.linux.get_free_memory());
        } else {
            return JSC.JSValue.jsNumber(0);
        }
    }

    pub fn getPriority(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var args_ = callframe.arguments(1);
        var arguments: []const JSC.JSValue = args_.ptr[0..args_.len];

        if (arguments.len > 0 and !arguments[0].isNumber()) {
            const err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE,
                "getPriority() expects a number",
                .{},
                globalThis,
            );
            globalThis.vm().throwError(globalThis, err);
            return JSC.JSValue.jsUndefined();
        }

        var pid = if (arguments.len > 0) arguments[0].asInt32() else 0;

        const priority = C.get_process_priority(pid);
        if (priority == -1) {
            //const info = JSC.JSValue.createEmptyObject(globalThis, 4);
            //info.put(globalThis, &JSC.ZigString.init("errno"), JSC.JSValue.jsNumberFromInt32(-3));
            //info.put(globalThis, &JSC.ZigString.init("code"), JSC.ZigString.init("ESRCH").withEncoding().toValueGC(globalThis));
            //info.put(globalThis, &JSC.ZigString.init("message"), JSC.ZigString.init("no such process").withEncoding().toValueGC(globalThis));
            //info.put(globalThis, &JSC.ZigString.init("syscall"), JSC.ZigString.init("uv_os_getpriority").withEncoding().toValueGC(globalThis));

            const err = JSC.SystemError{
                .message = JSC.ZigString.init("A system error occurred: uv_os_getpriority returned ESRCH (no such process)"),
                .code = JSC.ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR))),
                //.info = info,
                .errno = -3,
                .syscall = JSC.ZigString.init("uv_os_getpriority"),
            };

            globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
            return JSC.JSValue.jsUndefined();
        }

        return JSC.JSValue.jsNumberFromInt32(priority);
    }

    pub fn homedir(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var dir: string = "unknown";
        if (comptime Environment.isWindows)
            dir = std.os.getenv("USERPROFILE") orelse "unknown"
        else
            dir = std.os.getenv("HOME") orelse "unknown";

        return JSC.ZigString.init(dir).withEncoding().toValueGC(globalThis);
    }

    pub fn hostname(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;

        return JSC.ZigString.init(std.os.gethostname(&name_buffer) catch "unknown").withEncoding().toValueGC(globalThis);
    }

    pub fn loadavg(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isLinux) {
            const result = C.linux.get_system_loadavg();
            return JSC.JSArray.from(globalThis, &.{
                JSC.JSValue.jsDoubleNumber(result[0]),
                JSC.JSValue.jsDoubleNumber(result[1]),
                JSC.JSValue.jsDoubleNumber(result[2]),
            });
        } else {
            return JSC.JSArray.from(globalThis, &.{
                JSC.JSValue.jsNumber(0),
                JSC.JSValue.jsNumber(0),
                JSC.JSValue.jsNumber(0),
            });
        }
    }

    pub fn platform(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        return JSC.ZigString.init(Global.os_name).withEncoding().toValueGC(globalThis);
    }

    pub fn release(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;
        const uts = std.os.uname();
        const result = std.mem.sliceTo(std.meta.assumeSentinel(&uts.release, 0), 0);
        std.mem.copy(u8, &name_buffer, result);

        return JSC.ZigString.init(name_buffer[0..result.len]).withEncoding().toValueGC(globalThis);
    }

    pub fn setPriority(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var args_ = callframe.arguments(2);
        var arguments: []const JSC.JSValue = args_.ptr[0..args_.len];

        if (arguments.len == 0) {
            const err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE,
                "The \"priority\" argument must be of type number. Received undefined",
                .{},
                globalThis,
            );
            globalThis.vm().throwError(globalThis, err);
            return JSC.JSValue.jsUndefined();
        }

        var pid = if (arguments.len == 2) arguments[0].asInt32() else 0;
        var priority = if (arguments.len == 2) arguments[1].asInt32() else arguments[0].asInt32();

        if (priority < -20 or priority > 19) {
            const err = JSC.toTypeError(
                JSC.Node.ErrorCode.ERR_OUT_OF_RANGE,
                "The value of \"priority\" is out of range. It must be >= -20 && <= 19",
                .{},
                globalThis,
            );
            globalThis.vm().throwError(globalThis, err);
            return JSC.JSValue.jsUndefined();
        }

        const errcode = C.set_process_priority(pid, priority);
        switch (errcode) {
            .SRCH => {
                const err = JSC.SystemError{
                    .message = JSC.ZigString.init("A system error occurred: uv_os_setpriority returned ESRCH (no such process)"),
                    .code = JSC.ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR))),
                    //.info = info,
                    .errno = -3,
                    .syscall = JSC.ZigString.init("uv_os_setpriority"),
                };

                globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
                return JSC.JSValue.jsUndefined();
            },
            .ACCES => {
                const err = JSC.SystemError{
                    .message = JSC.ZigString.init("A system error occurred: uv_os_setpriority returned EACCESS (permission denied)"),
                    .code = JSC.ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_SYSTEM_ERROR))),
                    //.info = info,
                    .errno = -13,
                    .syscall = JSC.ZigString.init("uv_os_setpriority"),
                };

                globalThis.vm().throwError(globalThis, err.toErrorInstance(globalThis));
                return JSC.JSValue.jsUndefined();
            },
            else => {},
        }

        return JSC.JSValue.jsUndefined();
    }

    pub fn tmpdir(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var dir: string = "unknown";
        if (comptime Environment.isWindows) {
            if (std.os.getenv("TEMP") orelse std.os.getenv("TMP")) |tmpdir_| {
                dir = tmpdir_;
            }

            if (std.os.getenv("SYSTEMROOT") orelse std.os.getenv("WINDIR")) |systemdir_| {
                dir = systemdir_ + "\\temp";
            }

            dir = "unknown";
        } else {
            dir = std.os.getenv("TMPDIR") orelse std.os.getenv("TMP") orelse std.os.getenv("TEMP") orelse "/tmp";
        }

        return JSC.ZigString.init(dir).withEncoding().toValueGC(globalThis);
    }

    pub fn totalmem(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isLinux) {
            return JSC.JSValue.jsNumberFromUint64(C.linux.get_total_memory());
        } else {
            return JSC.JSValue.jsNumber(C.darwin.get_total_memory());
        }
    }

    pub fn @"type"(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isWindows)
            return JSC.ZigString.init("Windows_NT").withEncoding().toValueGC(globalThis)
        else if (comptime Environment.isMac)
            return JSC.ZigString.init("Darwin").withEncoding().toValueGC(globalThis)
        else if (comptime Environment.isLinux)
            return JSC.ZigString.init("Linux").withEncoding().toValueGC(globalThis);

        return JSC.ZigString.init(Global.os_name).withEncoding().toValueGC(globalThis);
    }

    pub fn uptime(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        if (comptime Environment.isLinux) {
            return JSC.JSValue.jsNumberFromUint64(C.linux.get_system_uptime());
        } else {
            return JSC.JSValue.jsNumber(0);
        }
    }

    pub fn userInfo(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const result = JSC.JSValue.createEmptyObject(globalThis, 5);

        result.put(globalThis, &JSC.ZigString.init("homedir"), homedir(globalThis, callframe));

        if (comptime Environment.isWindows) {
            result.put(globalThis, &JSC.ZigString.init("username"), JSC.ZigString.init(std.os.getenv("USERNAME") orelse "unknown").withEncoding().toValueGC(globalThis));
            result.put(globalThis, &JSC.ZigString.init("uid"), JSC.JSValue.jsNumber(-1));
            result.put(globalThis, &JSC.ZigString.init("gid"), JSC.JSValue.jsNumber(-1));
            result.put(globalThis, &JSC.ZigString.init("shell"), JSC.JSValue.jsNull());
        } else {
            const username = std.os.getenv("USER") orelse "unknown";

            result.put(globalThis, &JSC.ZigString.init("username"), JSC.ZigString.init(username).withEncoding().toValueGC(globalThis));
            result.put(globalThis, &JSC.ZigString.init("shell"), JSC.ZigString.init(std.os.getenv("SHELL") orelse "unknown").withEncoding().toValueGC(globalThis));

            if (comptime Environment.isLinux) {
                result.put(globalThis, &JSC.ZigString.init("uid"), JSC.JSValue.jsNumber(std.os.linux.getuid()));
                result.put(globalThis, &JSC.ZigString.init("gid"), JSC.JSValue.jsNumber(std.os.linux.getgid()));
            } else {
                result.put(globalThis, &JSC.ZigString.init("uid"), JSC.JSValue.jsNumber(C.darwin.getuid()));
                result.put(globalThis, &JSC.ZigString.init("gid"), JSC.JSValue.jsNumber(C.darwin.getgid()));
            }
        }

        return result;
    }

    pub fn version(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var name_buffer: [std.os.HOST_NAME_MAX]u8 = undefined;
        const uts = std.os.uname();
        const result = std.mem.sliceTo(std.meta.assumeSentinel(&uts.version, 0), 0);
        std.mem.copy(u8, &name_buffer, result);

        return JSC.ZigString.init(name_buffer[0..result.len]).withEncoding().toValueGC(globalThis);
    }
};

comptime {
    std.testing.refAllDecls(Os);
}
