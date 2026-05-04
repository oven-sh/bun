use bun_jsc::{JSGlobalObject, JSValue};
use bun_str::ZigString;

#[derive(Copy, Clone, Eq, PartialEq)]
enum ConstantType {
    Errno,
    ErrnoWin,
    Sig,
    Dlopen,
    Other,
}

// TODO(port): Zig used `@hasField(std.posix.E, name)` + `@intFromEnum(@field(...))` for
// comptime reflection over the platform errno enum. Rust has no equivalent. Phase B must
// provide `bun_sys::posix::errno::lookup(name) -> Option<i32>` (or per-constant `cfg`-gated
// consts) so that names absent on the target platform are silently skipped, matching Zig.
macro_rules! get_errno_constant {
    ($name:ident) => {
        bun_sys::posix::errno::$name()
    };
}

// TODO(port): Zig used `@hasField(std.posix.E, name)` to gate, then
// `@intFromEnum(@field(std.os.windows.ws2_32.WinsockError, name))`. Phase B must provide
// `bun_sys::windows::ws2_32::winsock_error::lookup(name) -> Option<i32>`.
macro_rules! get_windows_errno_constant {
    ($name:ident) => {
        bun_sys::windows::ws2_32::winsock_error::$name()
    };
}

// TODO(port): Zig used `@hasDecl(std.posix.SIG, name)` + `@field(...)`. Phase B must provide
// `bun_sys::posix::sig::lookup(name) -> Option<i32>` with per-platform cfg gating.
macro_rules! get_signals_constant {
    ($name:ident) => {
        bun_sys::posix::sig::$name()
    };
}

// TODO(port): Zig used `@hasDecl(std.posix.system.RTLD, name)` + `@field(...)`. Phase B must
// provide `bun_sys::posix::rtld::lookup(name) -> Option<i32>` with per-platform cfg gating.
macro_rules! get_dlopen_constant {
    ($name:ident) => {
        bun_sys::posix::rtld::$name()
    };
}

// Zig: fn defineConstant(globalObject, object, comptime ctype, comptime name) void
// Forwards to __define_constant with value = None.
macro_rules! define_constant {
    ($global:expr, $object:expr, Errno, $name:ident) => {
        __define_constant!($global, $object, Errno, $name, None)
    };
    ($global:expr, $object:expr, ErrnoWin, $name:ident) => {
        __define_constant!($global, $object, ErrnoWin, $name, None)
    };
    ($global:expr, $object:expr, Sig, $name:ident) => {
        __define_constant!($global, $object, Sig, $name, None)
    };
    ($global:expr, $object:expr, Dlopen, $name:ident) => {
        __define_constant!($global, $object, Dlopen, $name, None)
    };
}

// Zig: fn __defineConstant(globalObject, object, comptime ctype, comptime name, comptime value: ?i32) void
// The ctype + name are comptime and drive token-pasting ("E" ++ name, "SIG" ++ name, "RTLD_" ++ name),
// so this must be a macro in Rust.
macro_rules! __define_constant {
    ($global:expr, $object:expr, Errno, $name:ident, $value:expr) => {{
        if let Some(constant) = get_errno_constant!($name) {
            $object.put(
                $global,
                ZigString::static_(concat!("E", stringify!($name))),
                JSValue::js_number(constant),
            );
        }
    }};
    ($global:expr, $object:expr, ErrnoWin, $name:ident, $value:expr) => {{
        if let Some(constant) = get_windows_errno_constant!($name) {
            $object.put(
                $global,
                ZigString::static_(stringify!($name)),
                JSValue::js_number(constant),
            );
        }
    }};
    ($global:expr, $object:expr, Sig, $name:ident, $value:expr) => {{
        if let Some(constant) = get_signals_constant!($name) {
            $object.put(
                $global,
                ZigString::static_(concat!("SIG", stringify!($name))),
                JSValue::js_number(constant),
            );
        }
    }};
    ($global:expr, $object:expr, Dlopen, $name:ident, $value:expr) => {{
        if let Some(constant) = get_dlopen_constant!($name) {
            $object.put(
                $global,
                ZigString::static_(concat!("RTLD_", stringify!($name))),
                JSValue::js_number(constant),
            );
        }
    }};
    ($global:expr, $object:expr, Other, $name:literal, $value:expr) => {{
        let value: Option<i32> = $value;
        $object.put(
            $global,
            ZigString::static_($name),
            JSValue::js_number_from_int32(value.unwrap()),
        );
    }};
}

pub fn create(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 0);

    object.put(global, ZigString::static_("errno"), create_errno(global));
    object.put(global, ZigString::static_("signals"), create_signals(global));
    object.put(global, ZigString::static_("priority"), create_priority(global));
    object.put(global, ZigString::static_("dlopen"), create_dlopen(global));
    __define_constant!(global, object, Other, "UV_UDP_REUSEADDR", Some(4));

    object
}

// TODO(port): the ERRNO name "2BIG" is not a valid Rust identifier; the bun_sys::posix::errno
// table must expose it under a valid name (e.g. `_2BIG` or `TOOBIG`) and the macro arm or a
// special-case below must map it back to the JS key "E2BIG".
fn create_errno(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 0);

    // Special-case: "2BIG" cannot be an ident token. See TODO above.
    if let Some(constant) = bun_sys::posix::errno::_2BIG() {
        object.put(global, ZigString::static_("E2BIG"), JSValue::js_number(constant));
    }
    define_constant!(global, object, Errno, ACCES);
    define_constant!(global, object, Errno, ADDRINUSE);
    define_constant!(global, object, Errno, ADDRNOTAVAIL);
    define_constant!(global, object, Errno, AFNOSUPPORT);
    define_constant!(global, object, Errno, AGAIN);
    define_constant!(global, object, Errno, ALREADY);
    define_constant!(global, object, Errno, BADF);
    define_constant!(global, object, Errno, BADMSG);
    define_constant!(global, object, Errno, BUSY);
    define_constant!(global, object, Errno, CANCELED);
    define_constant!(global, object, Errno, CHILD);
    define_constant!(global, object, Errno, CONNABORTED);
    define_constant!(global, object, Errno, CONNREFUSED);
    define_constant!(global, object, Errno, CONNRESET);
    define_constant!(global, object, Errno, DEADLK);
    define_constant!(global, object, Errno, DESTADDRREQ);
    define_constant!(global, object, Errno, DOM);
    define_constant!(global, object, Errno, DQUOT);
    define_constant!(global, object, Errno, EXIST);
    define_constant!(global, object, Errno, FAULT);
    define_constant!(global, object, Errno, FBIG);
    define_constant!(global, object, Errno, HOSTUNREACH);
    define_constant!(global, object, Errno, IDRM);
    define_constant!(global, object, Errno, ILSEQ);
    define_constant!(global, object, Errno, INPROGRESS);
    define_constant!(global, object, Errno, INTR);
    define_constant!(global, object, Errno, INVAL);
    define_constant!(global, object, Errno, IO);
    define_constant!(global, object, Errno, ISCONN);
    define_constant!(global, object, Errno, ISDIR);
    define_constant!(global, object, Errno, LOOP);
    define_constant!(global, object, Errno, MFILE);
    define_constant!(global, object, Errno, MLINK);
    define_constant!(global, object, Errno, MSGSIZE);
    define_constant!(global, object, Errno, MULTIHOP);
    define_constant!(global, object, Errno, NAMETOOLONG);
    define_constant!(global, object, Errno, NETDOWN);
    define_constant!(global, object, Errno, NETRESET);
    define_constant!(global, object, Errno, NETUNREACH);
    define_constant!(global, object, Errno, NFILE);
    define_constant!(global, object, Errno, NOBUFS);
    define_constant!(global, object, Errno, NODATA);
    define_constant!(global, object, Errno, NODEV);
    define_constant!(global, object, Errno, NOENT);
    define_constant!(global, object, Errno, NOEXEC);
    define_constant!(global, object, Errno, NOLCK);
    define_constant!(global, object, Errno, NOLINK);
    define_constant!(global, object, Errno, NOMEM);
    define_constant!(global, object, Errno, NOMSG);
    define_constant!(global, object, Errno, NOPROTOOPT);
    define_constant!(global, object, Errno, NOSPC);
    define_constant!(global, object, Errno, NOSR);
    define_constant!(global, object, Errno, NOSTR);
    define_constant!(global, object, Errno, NOSYS);
    define_constant!(global, object, Errno, NOTCONN);
    define_constant!(global, object, Errno, NOTDIR);
    define_constant!(global, object, Errno, NOTEMPTY);
    define_constant!(global, object, Errno, NOTSOCK);
    define_constant!(global, object, Errno, NOTSUP);
    define_constant!(global, object, Errno, NOTTY);
    define_constant!(global, object, Errno, NXIO);
    define_constant!(global, object, Errno, OPNOTSUPP);
    define_constant!(global, object, Errno, OVERFLOW);
    define_constant!(global, object, Errno, PERM);
    define_constant!(global, object, Errno, PIPE);
    define_constant!(global, object, Errno, PROTO);
    define_constant!(global, object, Errno, PROTONOSUPPORT);
    define_constant!(global, object, Errno, PROTOTYPE);
    define_constant!(global, object, Errno, RANGE);
    define_constant!(global, object, Errno, ROFS);
    define_constant!(global, object, Errno, SPIPE);
    define_constant!(global, object, Errno, SRCH);
    define_constant!(global, object, Errno, STALE);
    define_constant!(global, object, Errno, TIME);
    define_constant!(global, object, Errno, TIMEDOUT);
    define_constant!(global, object, Errno, TXTBSY);
    define_constant!(global, object, Errno, WOULDBLOCK);
    define_constant!(global, object, Errno, XDEV);

    #[cfg(windows)]
    {
        define_constant!(global, object, ErrnoWin, WSAEINTR);
        define_constant!(global, object, ErrnoWin, WSAEBADF);
        define_constant!(global, object, ErrnoWin, WSAEACCES);
        define_constant!(global, object, ErrnoWin, WSAEFAULT);
        define_constant!(global, object, ErrnoWin, WSAEINVAL);
        define_constant!(global, object, ErrnoWin, WSAEMFILE);
        define_constant!(global, object, ErrnoWin, WSAEWOULDBLOCK);
        define_constant!(global, object, ErrnoWin, WSAEINPROGRESS);
        define_constant!(global, object, ErrnoWin, WSAEALREADY);
        define_constant!(global, object, ErrnoWin, WSAENOTSOCK);
        define_constant!(global, object, ErrnoWin, WSAEDESTADDRREQ);
        define_constant!(global, object, ErrnoWin, WSAEMSGSIZE);
        define_constant!(global, object, ErrnoWin, WSAEPROTOTYPE);
        define_constant!(global, object, ErrnoWin, WSAENOPROTOOPT);
        define_constant!(global, object, ErrnoWin, WSAEPROTONOSUPPORT);
        define_constant!(global, object, ErrnoWin, WSAESOCKTNOSUPPORT);
        define_constant!(global, object, ErrnoWin, WSAEOPNOTSUPP);
        define_constant!(global, object, ErrnoWin, WSAEPFNOSUPPORT);
        define_constant!(global, object, ErrnoWin, WSAEAFNOSUPPORT);
        define_constant!(global, object, ErrnoWin, WSAEADDRINUSE);
        define_constant!(global, object, ErrnoWin, WSAEADDRNOTAVAIL);
        define_constant!(global, object, ErrnoWin, WSAENETDOWN);
        define_constant!(global, object, ErrnoWin, WSAENETUNREACH);
        define_constant!(global, object, ErrnoWin, WSAENETRESET);
        define_constant!(global, object, ErrnoWin, WSAECONNABORTED);
        define_constant!(global, object, ErrnoWin, WSAECONNRESET);
        define_constant!(global, object, ErrnoWin, WSAENOBUFS);
        define_constant!(global, object, ErrnoWin, WSAEISCONN);
        define_constant!(global, object, ErrnoWin, WSAENOTCONN);
        define_constant!(global, object, ErrnoWin, WSAESHUTDOWN);
        define_constant!(global, object, ErrnoWin, WSAETOOMANYREFS);
        define_constant!(global, object, ErrnoWin, WSAETIMEDOUT);
        define_constant!(global, object, ErrnoWin, WSAECONNREFUSED);
        define_constant!(global, object, ErrnoWin, WSAELOOP);
        define_constant!(global, object, ErrnoWin, WSAENAMETOOLONG);
        define_constant!(global, object, ErrnoWin, WSAEHOSTDOWN);
        define_constant!(global, object, ErrnoWin, WSAEHOSTUNREACH);
        define_constant!(global, object, ErrnoWin, WSAENOTEMPTY);
        define_constant!(global, object, ErrnoWin, WSAEPROCLIM);
        define_constant!(global, object, ErrnoWin, WSAEUSERS);
        define_constant!(global, object, ErrnoWin, WSAEDQUOT);
        define_constant!(global, object, ErrnoWin, WSAESTALE);
        define_constant!(global, object, ErrnoWin, WSAEREMOTE);
        define_constant!(global, object, ErrnoWin, WSASYSNOTREADY);
        define_constant!(global, object, ErrnoWin, WSAVERNOTSUPPORTED);
        define_constant!(global, object, ErrnoWin, WSANOTINITIALISED);
        define_constant!(global, object, ErrnoWin, WSAEDISCON);
        define_constant!(global, object, ErrnoWin, WSAENOMORE);
        define_constant!(global, object, ErrnoWin, WSAECANCELLED);
        define_constant!(global, object, ErrnoWin, WSAEINVALIDPROCTABLE);
        define_constant!(global, object, ErrnoWin, WSAEINVALIDPROVIDER);
        define_constant!(global, object, ErrnoWin, WSAEPROVIDERFAILEDINIT);
        define_constant!(global, object, ErrnoWin, WSASYSCALLFAILURE);
        define_constant!(global, object, ErrnoWin, WSASERVICE_NOT_FOUND);
        define_constant!(global, object, ErrnoWin, WSATYPE_NOT_FOUND);
        define_constant!(global, object, ErrnoWin, WSA_E_NO_MORE);
        define_constant!(global, object, ErrnoWin, WSA_E_CANCELLED);
        define_constant!(global, object, ErrnoWin, WSAEREFUSED);
    }

    object
}

fn create_signals(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 0);

    define_constant!(global, object, Sig, HUP);
    define_constant!(global, object, Sig, INT);
    define_constant!(global, object, Sig, QUIT);
    define_constant!(global, object, Sig, ILL);
    define_constant!(global, object, Sig, TRAP);
    define_constant!(global, object, Sig, ABRT);
    define_constant!(global, object, Sig, IOT);
    define_constant!(global, object, Sig, BUS);
    define_constant!(global, object, Sig, FPE);
    define_constant!(global, object, Sig, KILL);
    define_constant!(global, object, Sig, USR1);
    define_constant!(global, object, Sig, SEGV);
    define_constant!(global, object, Sig, USR2);
    define_constant!(global, object, Sig, PIPE);
    define_constant!(global, object, Sig, ALRM);
    define_constant!(global, object, Sig, TERM);
    define_constant!(global, object, Sig, CHLD);
    define_constant!(global, object, Sig, STKFLT);
    define_constant!(global, object, Sig, CONT);
    define_constant!(global, object, Sig, STOP);
    define_constant!(global, object, Sig, TSTP);
    define_constant!(global, object, Sig, BREAK);
    define_constant!(global, object, Sig, TTIN);
    define_constant!(global, object, Sig, TTOU);
    define_constant!(global, object, Sig, URG);
    define_constant!(global, object, Sig, XCPU);
    define_constant!(global, object, Sig, XFSZ);
    define_constant!(global, object, Sig, VTALRM);
    define_constant!(global, object, Sig, PROF);
    define_constant!(global, object, Sig, WINCH);
    define_constant!(global, object, Sig, IO);
    define_constant!(global, object, Sig, POLL);
    define_constant!(global, object, Sig, LOST);
    define_constant!(global, object, Sig, PWR);
    define_constant!(global, object, Sig, INFO);
    define_constant!(global, object, Sig, SYS);
    define_constant!(global, object, Sig, UNUSED);

    object
}

fn create_priority(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 6);

    __define_constant!(global, object, Other, "PRIORITY_LOW", Some(19));
    __define_constant!(global, object, Other, "PRIORITY_BELOW_NORMAL", Some(10));
    __define_constant!(global, object, Other, "PRIORITY_NORMAL", Some(0));
    __define_constant!(global, object, Other, "PRIORITY_ABOVE_NORMAL", Some(-7));
    __define_constant!(global, object, Other, "PRIORITY_HIGH", Some(-14));
    __define_constant!(global, object, Other, "PRIORITY_HIGHEST", Some(-20));

    object
}

fn create_dlopen(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 5);

    define_constant!(global, object, Dlopen, LAZY);
    define_constant!(global, object, Dlopen, NOW);
    define_constant!(global, object, Dlopen, GLOBAL);
    define_constant!(global, object, Dlopen, LOCAL);
    define_constant!(global, object, Dlopen, DEEPBIND);

    object
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/os/constants.zig (297 lines)
//   confidence: medium
//   todos:      5
//   notes:      comptime @hasField/@hasDecl reflection over std.posix.{E,SIG,RTLD} and WinsockError ported as macro_rules! token-pasting; Phase B must supply bun_sys::posix::{errno,sig,rtld} and bun_sys::windows::ws2_32::winsock_error modules exposing per-name `fn NAME() -> Option<i32>` (cfg-gated). "2BIG" special-cased (invalid Rust ident).
// ──────────────────────────────────────────────────────────────────────────
