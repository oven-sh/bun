#include "ProcessBindingUV.h"
#include "JavaScriptCore/ArrayAllocationProfile.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ThrowScope.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSMapInlines.h"

// clang-format off

#if !defined(E2BIG)
#define E2BIG 7
#endif
#if !defined(EACCES)
#define EACCES 13
#endif
#if !defined(EADDRINUSE)
#define EADDRINUSE 48
#endif
#if !defined(EADDRNOTAVAIL)
#define EADDRNOTAVAIL 49
#endif
#if !defined(EAFNOSUPPORT)
#define EAFNOSUPPORT 47
#endif
#if !defined(EAGAIN)
#define EAGAIN 35
#endif
#if !defined(EAI_ADDRFAMILY)
#define EAI_ADDRFAMILY 3000
#endif
#if !defined(EAI_AGAIN)
#define EAI_AGAIN 3001
#endif
#if !defined(EAI_BADFLAGS)
#define EAI_BADFLAGS 3002
#endif
#if !defined(EAI_BADHINTS)
#define EAI_BADHINTS 3013
#endif
#if !defined(EAI_CANCELED)
#define EAI_CANCELED 3003
#endif
#if !defined(EAI_FAIL)
#define EAI_FAIL 3004
#endif
#if !defined(EAI_FAMILY)
#define EAI_FAMILY 3005
#endif
#if !defined(EAI_MEMORY)
#define EAI_MEMORY 3006
#endif
#if !defined(EAI_NODATA)
#define EAI_NODATA 3007
#endif
#if !defined(EAI_NONAME)
#define EAI_NONAME 3008
#endif
#if !defined(EAI_OVERFLOW)
#define EAI_OVERFLOW 3009
#endif
#if !defined(EAI_PROTOCOL)
#define EAI_PROTOCOL 3014
#endif
#if !defined(EAI_SERVICE)
#define EAI_SERVICE 3010
#endif
#if !defined(EAI_SOCKTYPE)
#define EAI_SOCKTYPE 3011
#endif
#if !defined(EALREADY)
#define EALREADY 37
#endif
#if !defined(EBADF)
#define EBADF 9
#endif
#if !defined(EBUSY)
#define EBUSY 16
#endif
#if !defined(ECANCELED)
#define ECANCELED 89
#endif
#if !defined(ECHARSET)
#define ECHARSET 4080
#endif
#if !defined(ECONNABORTED)
#define ECONNABORTED 53
#endif
#if !defined(ECONNREFUSED)
#define ECONNREFUSED 61
#endif
#if !defined(ECONNRESET)
#define ECONNRESET 54
#endif
#if !defined(EDESTADDRREQ)
#define EDESTADDRREQ 39
#endif
#if !defined(EEXIST)
#define EEXIST 17
#endif
#if !defined(EFAULT)
#define EFAULT 14
#endif
#if !defined(EFBIG)
#define EFBIG 27
#endif
#if !defined(EHOSTUNREACH)
#define EHOSTUNREACH 65
#endif
#if !defined(EINTR)
#define EINTR 4
#endif
#if !defined(EINVAL)
#define EINVAL 22
#endif
#if !defined(EIO)
#define EIO 5
#endif
#if !defined(EISCONN)
#define EISCONN 56
#endif
#if !defined(EISDIR)
#define EISDIR 21
#endif
#if !defined(ELOOP)
#define ELOOP 62
#endif
#if !defined(EMFILE)
#define EMFILE 24
#endif
#if !defined(EMSGSIZE)
#define EMSGSIZE 40
#endif
#if !defined(ENAMETOOLONG)
#define ENAMETOOLONG 63
#endif
#if !defined(ENETDOWN)
#define ENETDOWN 50
#endif
#if !defined(ENETUNREACH)
#define ENETUNREACH 51
#endif
#if !defined(ENFILE)
#define ENFILE 23
#endif
#if !defined(ENOBUFS)
#define ENOBUFS 55
#endif
#if !defined(ENODEV)
#define ENODEV 19
#endif
#if !defined(ENOENT)
#define ENOENT 2
#endif
#if !defined(ENOMEM)
#define ENOMEM 12
#endif
#if !defined(ENONET)
#define ENONET 4056
#endif
#if !defined(ENOPROTOOPT)
#define ENOPROTOOPT 42
#endif
#if !defined(ENOSPC)
#define ENOSPC 28
#endif
#if !defined(ENOSYS)
#define ENOSYS 78
#endif
#if !defined(ENOTCONN)
#define ENOTCONN 57
#endif
#if !defined(ENOTDIR)
#define ENOTDIR 20
#endif
#if !defined(ENOTEMPTY)
#define ENOTEMPTY 66
#endif
#if !defined(ENOTSOCK)
#define ENOTSOCK 38
#endif
#if !defined(ENOTSUP)
#define ENOTSUP 45
#endif
#if !defined(EOVERFLOW)
#define EOVERFLOW 84
#endif
#if !defined(EPERM)
#define EPERM 1
#endif
#if !defined(EPIPE)
#define EPIPE 32
#endif
#if !defined(EPROTO)
#define EPROTO 100
#endif
#if !defined(EPROTONOSUPPORT)
#define EPROTONOSUPPORT 43
#endif
#if !defined(EPROTOTYPE)
#define EPROTOTYPE 41
#endif
#if !defined(ERANGE)
#define ERANGE 34
#endif
#if !defined(EROFS)
#define EROFS 30
#endif
#if !defined(ESHUTDOWN)
#define ESHUTDOWN 58
#endif
#if !defined(ESPIPE)
#define ESPIPE 29
#endif
#if !defined(ESRCH)
#define ESRCH 3
#endif
#if !defined(ETIMEDOUT)
#define ETIMEDOUT 60
#endif
#if !defined(ETXTBSY)
#define ETXTBSY 26
#endif
#if !defined(EXDEV)
#define EXDEV 18
#endif
#if !defined(UNKNOWN)
#define UNKNOWN 4094
#endif
// this is intentionally always overridden
#if defined(EOF)
#undef EOF
#endif
#define EOF 4095
#if !defined(ENXIO)
#define ENXIO 6
#endif
#if !defined(EMLINK)
#define EMLINK 31
#endif
#if !defined(EHOSTDOWN)
#define EHOSTDOWN 64
#endif
#if !defined(EREMOTEIO)
#define EREMOTEIO 4030
#endif
#if !defined(ENOTTY)
#define ENOTTY 25
#endif
#if !defined(EFTYPE)
#define EFTYPE 79
#endif
#if !defined(EILSEQ)
#define EILSEQ 92
#endif
#if !defined(ESOCKTNOSUPPORT)
#define ESOCKTNOSUPPORT 44
#endif
#if !defined(ENODATA)
#define ENODATA 96
#endif
#if !defined(EUNATCH)
#define EUNATCH 4023
#endif

#define BUN_UV_ERRNO_MAP(macro) \
  macro(E2BIG, "argument list too long") \
  macro(EACCES, "permission denied") \
  macro(EADDRINUSE, "address already in use") \
  macro(EADDRNOTAVAIL, "address not available") \
  macro(EAFNOSUPPORT, "address family not supported") \
  macro(EAGAIN, "resource temporarily unavailable") \
  macro(EAI_ADDRFAMILY, "address family not supported") \
  macro(EAI_AGAIN, "temporary failure") \
  macro(EAI_BADFLAGS, "bad ai_flags value") \
  macro(EAI_BADHINTS, "invalid value for hints") \
  macro(EAI_CANCELED, "request canceled") \
  macro(EAI_FAIL, "permanent failure") \
  macro(EAI_FAMILY, "ai_family not supported") \
  macro(EAI_MEMORY, "out of memory") \
  macro(EAI_NODATA, "no address") \
  macro(EAI_NONAME, "unknown node or service") \
  macro(EAI_OVERFLOW, "argument buffer overflow") \
  macro(EAI_PROTOCOL, "resolved protocol is unknown") \
  macro(EAI_SERVICE, "service not available for socket type") \
  macro(EAI_SOCKTYPE, "socket type not supported") \
  macro(EALREADY, "connection already in progress") \
  macro(EBADF, "bad file descriptor") \
  macro(EBUSY, "resource busy or locked") \
  macro(ECANCELED, "operation canceled") \
  macro(ECHARSET, "invalid Unicode character") \
  macro(ECONNABORTED, "software caused connection abort") \
  macro(ECONNREFUSED, "connection refused") \
  macro(ECONNRESET, "connection reset by peer") \
  macro(EDESTADDRREQ, "destination address required") \
  macro(EEXIST, "file already exists") \
  macro(EFAULT, "bad address in system call argument") \
  macro(EFBIG, "file too large") \
  macro(EHOSTUNREACH, "host is unreachable") \
  macro(EINTR, "interrupted system call") \
  macro(EINVAL, "invalid argument") \
  macro(EIO, "i/o error") \
  macro(EISCONN, "socket is already connected") \
  macro(EISDIR, "illegal operation on a directory") \
  macro(ELOOP, "too many symbolic links encountered") \
  macro(EMFILE, "too many open files") \
  macro(EMSGSIZE, "message too long") \
  macro(ENAMETOOLONG, "name too long") \
  macro(ENETDOWN, "network is down") \
  macro(ENETUNREACH, "network is unreachable") \
  macro(ENFILE, "file table overflow") \
  macro(ENOBUFS, "no buffer space available") \
  macro(ENODEV, "no such device") \
  macro(ENOENT, "no such file or directory") \
  macro(ENOMEM, "not enough memory") \
  macro(ENONET, "machine is not on the network") \
  macro(ENOPROTOOPT, "protocol not available") \
  macro(ENOSPC, "no space left on device") \
  macro(ENOSYS, "function not implemented") \
  macro(ENOTCONN, "socket is not connected") \
  macro(ENOTDIR, "not a directory") \
  macro(ENOTEMPTY, "directory not empty") \
  macro(ENOTSOCK, "socket operation on non-socket") \
  macro(ENOTSUP, "operation not supported on socket") \
  macro(EOVERFLOW, "value too large for defined data type") \
  macro(EPERM, "operation not permitted") \
  macro(EPIPE, "broken pipe") \
  macro(EPROTO, "protocol error") \
  macro(EPROTONOSUPPORT, "protocol not supported") \
  macro(EPROTOTYPE, "protocol wrong type for socket") \
  macro(ERANGE, "result too large") \
  macro(EROFS, "read-only file system") \
  macro(ESHUTDOWN, "cannot send after transport endpoint shutdown") \
  macro(ESPIPE, "invalid seek") \
  macro(ESRCH, "no such process") \
  macro(ETIMEDOUT, "connection timed out") \
  macro(ETXTBSY, "text file is busy") \
  macro(EXDEV, "cross-device link not permitted") \
  macro(UNKNOWN, "unknown error") \
  macro(EOF, "end of file") \
  macro(ENXIO, "no such device or address") \
  macro(EMLINK, "too many links") \
  macro(EHOSTDOWN, "host is down") \
  macro(EREMOTEIO, "remote I/O error") \
  macro(ENOTTY, "inappropriate ioctl for device") \
  macro(EFTYPE, "inappropriate file type or format") \
  macro(EILSEQ, "illegal byte sequence") \
  macro(ESOCKTNOSUPPORT, "socket type not supported") \
  macro(ENODATA, "no data available") \
  macro(EUNATCH, "protocol driver not attached")

// clang-format on
namespace Bun {
namespace ProcessBindingUV {

JSC_DEFINE_HOST_FUNCTION(jsErrname, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto arg0 = callFrame->argument(0);

    // Node.js crashes here:
    // However, we should ensure this function never throws
    // That's why we do not call toPrimitive here or throw on invalid input.
    if (!arg0.isInt32AsAnyInt()) [[unlikely]] {
        return JSValue::encode(jsString(vm, String("Unknown system error"_s)));
    }

    auto err = arg0.toInt32(globalObject);
#define CASE(name, desc) \
    if (err == -name) return JSValue::encode(JSC::jsString(vm, String(#name##_s)));

    BUN_UV_ERRNO_MAP(CASE)
#undef CASE

    return JSValue::encode(jsString(vm, makeString("Unknown system error: "_s, err)));
}

JSC_DEFINE_HOST_FUNCTION(jsGetErrorMap, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto map = JSC::JSMap::create(vm, globalObject->mapStructure());

    // Inlining each of these via macros costs like 300 KB.
    const auto putProperty = [](JSC::VM& vm, JSC::JSMap* map, JSC::JSGlobalObject* globalObject, ASCIILiteral name, int value, ASCIILiteral desc) -> void {
        auto arr = JSC::constructEmptyArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), 2);
        // RETURN_IF_EXCEPTION
        arr->putDirectIndex(globalObject, 0, JSC::jsString(vm, String(name)));
        arr->putDirectIndex(globalObject, 1, JSC::jsString(vm, String(desc)));
        map->set(globalObject, JSC::jsNumber(value), arr);
    };

#define PUT_PROPERTY(name, desc) putProperty(vm, map, globalObject, #name##_s, -name, desc##_s);
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
        bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, name), JSC::jsNumber(value));
    };

#define PUT_PROPERTY(name, desc) \
    putNamedProperty(vm, bindingObject, "UV_" #name##_s, -name);
    BUN_UV_ERRNO_MAP(PUT_PROPERTY)
#undef PUT_PROPERTY

    bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, "getErrorMap"_s), JSC::JSFunction::create(vm, globalObject, 0, "getErrorMap"_s, jsGetErrorMap, ImplementationVisibility::Public));

    return bindingObject;
}

} // namespace ProcessBindingUV
} // namespace Bun
