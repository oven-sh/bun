#include "ProcessBindingUV.h"
#include "JavaScriptCore/ArrayAllocationProfile.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ThrowScope.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSMapInlines.h"

// clang-format off

#define BUN_UV_ERRNO_MAP(macro) \
  macro(E2BIG, -7, "argument list too long") \
  macro(EACCES, -13, "permission denied") \
  macro(EADDRINUSE, -48, "address already in use") \
  macro(EADDRNOTAVAIL, -49, "address not available") \
  macro(EAFNOSUPPORT, -47, "address family not supported") \
  macro(EAGAIN, -35, "resource temporarily unavailable") \
  macro(EAI_ADDRFAMILY, -3000, "address family not supported") \
  macro(EAI_AGAIN, -3001, "temporary failure") \
  macro(EAI_BADFLAGS, -3002, "bad ai_flags value") \
  macro(EAI_BADHINTS, -3013, "invalid value for hints") \
  macro(EAI_CANCELED, -3003, "request canceled") \
  macro(EAI_FAIL, -3004, "permanent failure") \
  macro(EAI_FAMILY, -3005, "ai_family not supported") \
  macro(EAI_MEMORY, -3006, "out of memory") \
  macro(EAI_NODATA, -3007, "no address") \
  macro(EAI_NONAME, -3008, "unknown node or service") \
  macro(EAI_OVERFLOW, -3009, "argument buffer overflow") \
  macro(EAI_PROTOCOL, -3014, "resolved protocol is unknown") \
  macro(EAI_SERVICE, -3010, "service not available for socket type") \
  macro(EAI_SOCKTYPE, -3011, "socket type not supported") \
  macro(EALREADY, -37, "connection already in progress") \
  macro(EBADF, -9, "bad file descriptor") \
  macro(EBUSY, -16, "resource busy or locked") \
  macro(ECANCELED, -89, "operation canceled") \
  macro(ECHARSET, -4080, "invalid Unicode character") \
  macro(ECONNABORTED, -53, "software caused connection abort") \
  macro(ECONNREFUSED, -61, "connection refused") \
  macro(ECONNRESET, -54, "connection reset by peer") \
  macro(EDESTADDRREQ, -39, "destination address required") \
  macro(EEXIST, -17, "file already exists") \
  macro(EFAULT, -14, "bad address in system call argument") \
  macro(EFBIG, -27, "file too large") \
  macro(EHOSTUNREACH, -65, "host is unreachable") \
  macro(EINTR, -4, "interrupted system call") \
  macro(EINVAL, -22, "invalid argument") \
  macro(EIO, -5, "i/o error") \
  macro(EISCONN, -56, "socket is already connected") \
  macro(EISDIR, -21, "illegal operation on a directory") \
  macro(ELOOP, -62, "too many symbolic links encountered") \
  macro(EMFILE, -24, "too many open files") \
  macro(EMSGSIZE, -40, "message too long") \
  macro(ENAMETOOLONG, -63, "name too long") \
  macro(ENETDOWN, -50, "network is down") \
  macro(ENETUNREACH, -51, "network is unreachable") \
  macro(ENFILE, -23, "file table overflow") \
  macro(ENOBUFS, -55, "no buffer space available") \
  macro(ENODEV, -19, "no such device") \
  macro(ENOENT, -2, "no such file or directory") \
  macro(ENOMEM, -12, "not enough memory") \
  macro(ENONET, -4056, "machine is not on the network") \
  macro(ENOPROTOOPT, -42, "protocol not available") \
  macro(ENOSPC, -28, "no space left on device") \
  macro(ENOSYS, -78, "function not implemented") \
  macro(ENOTCONN, -57, "socket is not connected") \
  macro(ENOTDIR, -20, "not a directory") \
  macro(ENOTEMPTY, -66, "directory not empty") \
  macro(ENOTSOCK, -38, "socket operation on non-socket") \
  macro(ENOTSUP, -45, "operation not supported on socket") \
  macro(EOVERFLOW, -84, "value too large for defined data type") \
  macro(EPERM, -1, "operation not permitted") \
  macro(EPIPE, -32, "broken pipe") \
  macro(EPROTO, -100, "protocol error") \
  macro(EPROTONOSUPPORT, -43, "protocol not supported") \
  macro(EPROTOTYPE, -41, "protocol wrong type for socket") \
  macro(ERANGE, -34, "result too large") \
  macro(EROFS, -30, "read-only file system") \
  macro(ESHUTDOWN, -58, "cannot send after transport endpoint shutdown") \
  macro(ESPIPE, -29, "invalid seek") \
  macro(ESRCH, -3, "no such process") \
  macro(ETIMEDOUT, -60, "connection timed out") \
  macro(ETXTBSY, -26, "text file is busy") \
  macro(EXDEV, -18, "cross-device link not permitted") \
  macro(UNKNOWN, -4094, "unknown error") \
  macro(EOF, -4095, "end of file") \
  macro(ENXIO, -6, "no such device or address") \
  macro(EMLINK, -31, "too many links") \
  macro(EHOSTDOWN, -64, "host is down") \
  macro(EREMOTEIO, -4030, "remote I/O error") \
  macro(ENOTTY, -25, "inappropriate ioctl for device") \
  macro(EFTYPE, -79, "inappropriate file type or format") \
  macro(EILSEQ, -92, "illegal byte sequence") \
  macro(ESOCKTNOSUPPORT, -44, "socket type not supported") \
  macro(ENODATA, -96, "no data available") \
  macro(EUNATCH, -4023, "protocol driver not attache")

// clang-format on
namespace Bun {
namespace ProcessBindingUV {

JSC_DEFINE_HOST_FUNCTION(jsErrname, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto arg0 = callFrame->argument(0);

    // Node.js crashes here:
    // However, we should ensure this function never throws
    // That's why we do not call toPrimitive here or throw on invalid input.
    if (UNLIKELY(!arg0.isInt32AsAnyInt())) {
        return JSValue::encode(jsString(vm, String("Unknown system error"_s)));
    }

    auto err = arg0.toInt32(globalObject);
    switch (err) {
#define CASE(name, value, desc) \
    case value:                 \
        return JSValue::encode(JSC::jsString(vm, String(#name##_s)));

        BUN_UV_ERRNO_MAP(CASE)
#undef CASE
    default: {
        break;
    }
    }

    return JSValue::encode(jsString(vm, makeString("Unknown system error: "_s, err)));
}

typedef struct {
    int code;
    ASCIILiteral name;
} ErrnoItem;

// clang-format off
 static const ErrnoItem errnomap_static[] {
     { -4095, "EOF"_s, },
     { -4094, "UNKNOWN"_s, },
     { -3000, "EAI_ADDRFAMILY"_s, },
     { -3001, "EAI_AGAIN"_s, },
     { -3002, "EAI_BADFLAGS"_s, },
     { -3003, "EAI_CANCELED"_s, },
     { -3004, "EAI_FAIL"_s, },
     { -3005, "EAI_FAMILY"_s, },
     { -3006, "EAI_MEMORY"_s, },
     { -3007, "EAI_NODATA"_s, },
     { -3008, "EAI_NONAME"_s, },
     { -3009, "EAI_OVERFLOW"_s, },
     { -3010, "EAI_SERVICE"_s, },
     { -3011, "EAI_SOCKTYPE"_s, },
     { -3013, "EAI_BADHINTS"_s, },
     { -3014, "EAI_PROTOCOL"_s, },
 };
 static const ErrnoItem errnomap_fallback[] {
     { -4093, "E2BIG"_s },
     { -4092, "EACCES"_s },
     { -4091, "EADDRINUSE"_s },
     { -4090, "EADDRNOTAVAIL"_s },
     { -4089, "EAFNOSUPPORT"_s },
     { -4088, "EAGAIN"_s },
     { -4084, "EALREADY"_s },
     { -4083, "EBADF"_s },
     { -4082, "EBUSY"_s },
     { -4081, "ECANCELED"_s },
     { -4080, "ECHARSET"_s },
     { -4079, "ECONNABORTED"_s },
     { -4078, "ECONNREFUSED"_s },
     { -4077, "ECONNRESET"_s },
     { -4076, "EDESTADDRREQ"_s },
     { -4075, "EEXIST"_s },
     { -4074, "EFAULT"_s },
     { -4073, "EHOSTUNREACH"_s },
     { -4072, "EINTR"_s },
     { -4071, "EINVAL"_s },
     { -4070, "EIO"_s },
     { -4069, "EISCONN"_s },
     { -4068, "EISDIR"_s },
     { -4067, "ELOOP"_s },
     { -4066, "EMFILE"_s },
     { -4065, "EMSGSIZE"_s },
     { -4064, "ENAMETOOLONG"_s },
     { -4063, "ENETDOWN"_s },
     { -4062, "ENETUNREACH"_s },
     { -4061, "ENFILE"_s },
     { -4060, "ENOBUFS"_s },
     { -4059, "ENODEV"_s },
     { -4058, "ENOENT"_s },
     { -4057, "ENOMEM"_s },
     { -4056, "ENONET"_s },
     { -4055, "ENOSPC"_s },
     { -4054, "ENOSYS"_s },
     { -4053, "ENOTCONN"_s },
     { -4052, "ENOTDIR"_s },
     { -4051, "ENOTEMPTY"_s },
     { -4050, "ENOTSOCK"_s },
     { -4049, "ENOTSUP"_s },
     { -4048, "EPERM"_s },
     { -4047, "EPIPE"_s },
     { -4046, "EPROTO"_s },
     { -4045, "EPROTONOSUPPORT"_s },
     { -4044, "EPROTOTYPE"_s },
     { -4043, "EROFS"_s },
     { -4042, "ESHUTDOWN"_s },
     { -4041, "ESPIPE"_s },
     { -4040, "ESRCH"_s },
     { -4039, "ETIMEDOUT"_s },
     { -4038, "ETXTBSY"_s },
     { -4037, "EXDEV"_s },
     { -4036, "EFBIG"_s },
     { -4035, "ENOPROTOOPT"_s },
     { -4034, "ERANGE"_s },
     { -4033, "ENXIO"_s },
     { -4032, "EMLINK"_s },
     { -4031, "EHOSTDOWN"_s },
     { -4030, "EREMOTEIO"_s },
     { -4029, "ENOTTY"_s },
     { -4028, "EFTYPE"_s },
     { -4027, "EILSEQ"_s },
     { -4026, "EOVERFLOW"_s },
     { -4025, "ESOCKTNOSUPPORT"_s },
     { -4024, "ENODATA"_s },
     { -4023, "EUNATCH"_s },
 };
// clang-format on

// Sourced from https://github.com/libuv/libuv/blob/v1.x/include/uv/errno.h. Accurate as of v1.48.0.
extern "C" JSC::EncodedJSValue Bun__util__jsErrname(JSGlobalObject* globalObject, int err)
{
    auto& vm = globalObject->vm();

    for (auto item : errnomap_static) {
        if (err == item.code) {
            return JSValue::encode(jsString(vm, String(item.name)));
        }
    }

#if OS(WINDOWS)
    for (auto item : errnomap_fallback) {
        if (err == item.code) {
            return JSValue::encode(jsString(vm, String(item.name)));
        }
    }
    return JSValue::encode(jsString(vm, makeString("Unknown system error: "_s, err)));
#endif

    // TODO: is there a way to do this only once/at comptime?
    std::map<ASCIILiteral, int> themap = {};
    for (auto item : errnomap_fallback) {
        themap[item.name] = item.code;
    }

#ifdef E2BIG
    themap["E2BIG"_s] = -E2BIG;
#endif
#ifdef EACCES
    themap["EACCES"_s] = -EACCES;
#endif
#ifdef EADDRINUSE
    themap["EADDRINUSE"_s] = -EADDRINUSE;
#endif
#ifdef EADDRNOTAVAIL
    themap["EADDRNOTAVAIL"_s] = -EADDRNOTAVAIL;
#endif
#ifdef EAFNOSUPPORT
    themap["EAFNOSUPPORT"_s] = -EAFNOSUPPORT;
#endif
#ifdef EAGAIN
    themap["EAGAIN"_s] = -EAGAIN;
#endif
#ifdef EALREADY
    themap["EALREADY"_s] = -EALREADY;
#endif
#ifdef EBADF
    themap["EBADF"_s] = -EBADF;
#endif
#ifdef EBUSY
    themap["EBUSY"_s] = -EBUSY;
#endif
#ifdef ECANCELED
    themap["ECANCELED"_s] = -ECANCELED;
#endif
#ifdef ECHARSET
    themap["ECHARSET"_s] = -ECHARSET;
#endif
#ifdef ECONNABORTED
    themap["ECONNABORTED"_s] = -ECONNABORTED;
#endif
#ifdef ECONNREFUSED
    themap["ECONNREFUSED"_s] = -ECONNREFUSED;
#endif
#ifdef ECONNRESET
    themap["ECONNRESET"_s] = -ECONNRESET;
#endif
#ifdef EDESTADDRREQ
    themap["EDESTADDRREQ"_s] = -EDESTADDRREQ;
#endif
#ifdef EEXIST
    themap["EEXIST"_s] = -EEXIST;
#endif
#ifdef EFAULT
    themap["EFAULT"_s] = -EFAULT;
#endif
#ifdef EHOSTUNREACH
    themap["EHOSTUNREACH"_s] = -EHOSTUNREACH;
#endif
#ifdef EINTR
    themap["EINTR"_s] = -EINTR;
#endif
#ifdef EINVAL
    themap["EINVAL"_s] = -EINVAL;
#endif
#ifdef EIO
    themap["EIO"_s] = -EIO;
#endif
#ifdef EISCONN
    themap["EISCONN"_s] = -EISCONN;
#endif
#ifdef EISDIR
    themap["EISDIR"_s] = -EISDIR;
#endif
#ifdef ELOOP
    themap["ELOOP"_s] = -ELOOP;
#endif
#ifdef EMFILE
    themap["EMFILE"_s] = -EMFILE;
#endif
#ifdef EMSGSIZE
    themap["EMSGSIZE"_s] = -EMSGSIZE;
#endif
#ifdef ENAMETOOLONG
    themap["ENAMETOOLONG"_s] = -ENAMETOOLONG;
#endif
#ifdef ENETDOWN
    themap["ENETDOWN"_s] = -ENETDOWN;
#endif
#ifdef ENETUNREACH
    themap["ENETUNREACH"_s] = -ENETUNREACH;
#endif
#ifdef ENFILE
    themap["ENFILE"_s] = -ENFILE;
#endif
#ifdef ENOBUFS
    themap["ENOBUFS"_s] = -ENOBUFS;
#endif
#ifdef ENODEV
    themap["ENODEV"_s] = -ENODEV;
#endif
#ifdef ENOENT
    themap["ENOENT"_s] = -ENOENT;
#endif
#ifdef ENOMEM
    themap["ENOMEM"_s] = -ENOMEM;
#endif
#ifdef ENONET
    themap["ENONET"_s] = -ENONET;
#endif
#ifdef ENOSPC
    themap["ENOSPC"_s] = -ENOSPC;
#endif
#ifdef ENOSYS
    themap["ENOSYS"_s] = -ENOSYS;
#endif
#ifdef ENOTCONN
    themap["ENOTCONN"_s] = -ENOTCONN;
#endif
#ifdef ENOTDIR
    themap["ENOTDIR"_s] = -ENOTDIR;
#endif
#ifdef ENOTEMPTY
    themap["ENOTEMPTY"_s] = -ENOTEMPTY;
#endif
#ifdef ENOTSOCK
    themap["ENOTSOCK"_s] = -ENOTSOCK;
#endif
#ifdef ENOTSUP
    themap["ENOTSUP"_s] = -ENOTSUP;
#endif
#ifdef EPERM
    themap["EPERM"_s] = -EPERM;
#endif
#ifdef EPIPE
    themap["EPIPE"_s] = -EPIPE;
#endif
#ifdef EPROTO
    themap["EPROTO"_s] = -EPROTO;
#endif
#ifdef EPROTONOSUPPORT
    themap["EPROTONOSUPPORT"_s] = -EPROTONOSUPPORT;
#endif
#ifdef EPROTOTYPE
    themap["EPROTOTYPE"_s] = -EPROTOTYPE;
#endif
#ifdef EROFS
    themap["EROFS"_s] = -EROFS;
#endif
#ifdef ESHUTDOWN
    themap["ESHUTDOWN"_s] = -ESHUTDOWN;
#endif
#ifdef ESPIPE
    themap["ESPIPE"_s] = -ESPIPE;
#endif
#ifdef ESRCH
    themap["ESRCH"_s] = -ESRCH;
#endif
#ifdef ETIMEDOUT
    themap["ETIMEDOUT"_s] = -ETIMEDOUT;
#endif
#ifdef ETXTBSY
    themap["ETXTBSY"_s] = -ETXTBSY;
#endif
#ifdef EXDEV
    themap["EXDEV"_s] = -EXDEV;
#endif
#ifdef EFBIG
    themap["EFBIG"_s] = -EFBIG;
#endif
#ifdef ENOPROTOOPT
    themap["ENOPROTOOPT"_s] = -ENOPROTOOPT;
#endif
#ifdef ERANGE
    themap["ERANGE"_s] = -ERANGE;
#endif
#ifdef ENXIO
    themap["ENXIO"_s] = -ENXIO;
#endif
#ifdef EMLINK
    themap["EMLINK"_s] = -EMLINK;
#endif
#ifdef EHOSTDOWN
    themap["EHOSTDOWN"_s] = -EHOSTDOWN;
#endif
#ifdef EREMOTEIO
    themap["EREMOTEIO"_s] = -EREMOTEIO;
#endif
#ifdef ENOTTY
    themap["ENOTTY"_s] = -ENOTTY;
#endif
#ifdef EFTYPE
    themap["EFTYPE"_s] = -EFTYPE;
#endif
#ifdef EILSEQ
    themap["EILSEQ"_s] = -EILSEQ;
#endif
#ifdef EOVERFLOW
    themap["EOVERFLOW"_s] = -EOVERFLOW;
#endif
#ifdef ESOCKTNOSUPPORT
    themap["ESOCKTNOSUPPORT"_s] = -ESOCKTNOSUPPORT;
#endif
#ifdef ENODATA
    themap["ENODATA"_s] = -ENODATA;
#endif
#ifdef EUNATCH
    themap["EUNATCH"_s] = -EUNATCH;
#endif

    for (std::map<ASCIILiteral, int>::iterator i = themap.begin(); i != themap.end(); ++i) {
        if (err != i->second)
            continue;
        return JSValue::encode(jsString(vm, String(i->first)));
    }

    return JSValue::encode(jsString(vm, makeString("Unknown system error: "_s, err)));
}

JSC_DEFINE_HOST_FUNCTION(jsGetErrorMap, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto map = JSC::JSMap::create(vm, globalObject->mapStructure());

    // Inlining each of these via macros costs like 300 KB.
    const auto putProperty = [](JSC::VM& vm, JSC::JSMap* map, JSC::JSGlobalObject* globalObject, ASCIILiteral name, int value, ASCIILiteral desc) -> void {
        auto arr = JSC::constructEmptyArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), 2);
        arr->putDirectIndex(globalObject, 0, JSC::jsString(vm, String(name)));
        arr->putDirectIndex(globalObject, 1, JSC::jsString(vm, String(desc)));
        map->set(globalObject, JSC::jsNumber(value), arr);
    };

#define PUT_PROPERTY(name, value, desc) putProperty(vm, map, globalObject, #name##_s, value, desc##_s);
    BUN_UV_ERRNO_MAP(PUT_PROPERTY)
#undef PUT_PROPERTY

    return JSValue::encode(map);
}

JSObject* create(VM& vm, JSGlobalObject* globalObject)
{
    auto bindingObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 0);
    EnsureStillAliveScope ensureStillAlive(bindingObject);
    bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, "errname"_s), JSC::JSFunction::create(vm, globalObject, 1, "errname"_s, jsErrname, ImplementationVisibility::Public));

    // Inlining each of these via macros costs like 300 KB.
    // Before: 96305608
    // After:  95973832
    const auto putNamedProperty = [](JSC::VM& vm, JSObject* bindingObject, const ASCIILiteral name, int value) -> void {
        bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, makeString("UV_"_s, name)), JSC::jsNumber(value));
    };

#define PUT_PROPERTY(name, value, desc) \
    putNamedProperty(vm, bindingObject, #name##_s, value);
    BUN_UV_ERRNO_MAP(PUT_PROPERTY)
#undef PUT_PROPERTY

    bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, "getErrorMap"_s), JSC::JSFunction::create(vm, globalObject, 0, "getErrorMap"_s, jsGetErrorMap, ImplementationVisibility::Public));

    return bindingObject;
}

} // namespace ProcessBindingUV
} // namespace Bun