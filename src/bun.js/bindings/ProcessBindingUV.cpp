#include "ProcessBindingUV.h"
#include "JavaScriptCore/ArrayAllocationProfile.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ThrowScope.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSMapInlines.h"

// clang-format off

#if EDOM > 0
# define UV__ERR(x) (-(x))
#else
# define UV__ERR(x) (x)
#endif

#define UV__EOF     (-4095)
#define UV__UNKNOWN (-4094)

#define UV__EAI_ADDRFAMILY  (-3000)
#define UV__EAI_AGAIN       (-3001)
#define UV__EAI_BADFLAGS    (-3002)
#define UV__EAI_CANCELED    (-3003)
#define UV__EAI_FAIL        (-3004)
#define UV__EAI_FAMILY      (-3005)
#define UV__EAI_MEMORY      (-3006)
#define UV__EAI_NODATA      (-3007)
#define UV__EAI_NONAME      (-3008)
#define UV__EAI_OVERFLOW    (-3009)
#define UV__EAI_SERVICE     (-3010)
#define UV__EAI_SOCKTYPE    (-3011)
#define UV__EAI_BADHINTS    (-3013)
#define UV__EAI_PROTOCOL    (-3014)

/* Only map to the system errno on non-Windows platforms. It's apparently
 * a fairly common practice for Windows programmers to redefine errno codes.
 */
#if defined(E2BIG) && !defined(_WIN32)
# define UV__E2BIG UV__ERR(E2BIG)
#else
# define UV__E2BIG (-4093)
#endif

#if defined(EACCES) && !defined(_WIN32)
# define UV__EACCES UV__ERR(EACCES)
#else
# define UV__EACCES (-4092)
#endif

#if defined(EADDRINUSE) && !defined(_WIN32)
# define UV__EADDRINUSE UV__ERR(EADDRINUSE)
#else
# define UV__EADDRINUSE (-4091)
#endif

#if defined(EADDRNOTAVAIL) && !defined(_WIN32)
# define UV__EADDRNOTAVAIL UV__ERR(EADDRNOTAVAIL)
#else
# define UV__EADDRNOTAVAIL (-4090)
#endif

#if defined(EAFNOSUPPORT) && !defined(_WIN32)
# define UV__EAFNOSUPPORT UV__ERR(EAFNOSUPPORT)
#else
# define UV__EAFNOSUPPORT (-4089)
#endif

#if defined(EAGAIN) && !defined(_WIN32)
# define UV__EAGAIN UV__ERR(EAGAIN)
#else
# define UV__EAGAIN (-4088)
#endif

#if defined(EALREADY) && !defined(_WIN32)
# define UV__EALREADY UV__ERR(EALREADY)
#else
# define UV__EALREADY (-4084)
#endif

#if defined(EBADF) && !defined(_WIN32)
# define UV__EBADF UV__ERR(EBADF)
#else
# define UV__EBADF (-4083)
#endif

#if defined(EBUSY) && !defined(_WIN32)
# define UV__EBUSY UV__ERR(EBUSY)
#else
# define UV__EBUSY (-4082)
#endif

#if defined(ECANCELED) && !defined(_WIN32)
# define UV__ECANCELED UV__ERR(ECANCELED)
#else
# define UV__ECANCELED (-4081)
#endif

#if defined(ECHARSET) && !defined(_WIN32)
# define UV__ECHARSET UV__ERR(ECHARSET)
#else
# define UV__ECHARSET (-4080)
#endif

#if defined(ECONNABORTED) && !defined(_WIN32)
# define UV__ECONNABORTED UV__ERR(ECONNABORTED)
#else
# define UV__ECONNABORTED (-4079)
#endif

#if defined(ECONNREFUSED) && !defined(_WIN32)
# define UV__ECONNREFUSED UV__ERR(ECONNREFUSED)
#else
# define UV__ECONNREFUSED (-4078)
#endif

#if defined(ECONNRESET) && !defined(_WIN32)
# define UV__ECONNRESET UV__ERR(ECONNRESET)
#else
# define UV__ECONNRESET (-4077)
#endif

#if defined(EDESTADDRREQ) && !defined(_WIN32)
# define UV__EDESTADDRREQ UV__ERR(EDESTADDRREQ)
#else
# define UV__EDESTADDRREQ (-4076)
#endif

#if defined(EEXIST) && !defined(_WIN32)
# define UV__EEXIST UV__ERR(EEXIST)
#else
# define UV__EEXIST (-4075)
#endif

#if defined(EFAULT) && !defined(_WIN32)
# define UV__EFAULT UV__ERR(EFAULT)
#else
# define UV__EFAULT (-4074)
#endif

#if defined(EHOSTUNREACH) && !defined(_WIN32)
# define UV__EHOSTUNREACH UV__ERR(EHOSTUNREACH)
#else
# define UV__EHOSTUNREACH (-4073)
#endif

#if defined(EINTR) && !defined(_WIN32)
# define UV__EINTR UV__ERR(EINTR)
#else
# define UV__EINTR (-4072)
#endif

#if defined(EINVAL) && !defined(_WIN32)
# define UV__EINVAL UV__ERR(EINVAL)
#else
# define UV__EINVAL (-4071)
#endif

#if defined(EIO) && !defined(_WIN32)
# define UV__EIO UV__ERR(EIO)
#else
# define UV__EIO (-4070)
#endif

#if defined(EISCONN) && !defined(_WIN32)
# define UV__EISCONN UV__ERR(EISCONN)
#else
# define UV__EISCONN (-4069)
#endif

#if defined(EISDIR) && !defined(_WIN32)
# define UV__EISDIR UV__ERR(EISDIR)
#else
# define UV__EISDIR (-4068)
#endif

#if defined(ELOOP) && !defined(_WIN32)
# define UV__ELOOP UV__ERR(ELOOP)
#else
# define UV__ELOOP (-4067)
#endif

#if defined(EMFILE) && !defined(_WIN32)
# define UV__EMFILE UV__ERR(EMFILE)
#else
# define UV__EMFILE (-4066)
#endif

#if defined(EMSGSIZE) && !defined(_WIN32)
# define UV__EMSGSIZE UV__ERR(EMSGSIZE)
#else
# define UV__EMSGSIZE (-4065)
#endif

#if defined(ENAMETOOLONG) && !defined(_WIN32)
# define UV__ENAMETOOLONG UV__ERR(ENAMETOOLONG)
#else
# define UV__ENAMETOOLONG (-4064)
#endif

#if defined(ENETDOWN) && !defined(_WIN32)
# define UV__ENETDOWN UV__ERR(ENETDOWN)
#else
# define UV__ENETDOWN (-4063)
#endif

#if defined(ENETUNREACH) && !defined(_WIN32)
# define UV__ENETUNREACH UV__ERR(ENETUNREACH)
#else
# define UV__ENETUNREACH (-4062)
#endif

#if defined(ENFILE) && !defined(_WIN32)
# define UV__ENFILE UV__ERR(ENFILE)
#else
# define UV__ENFILE (-4061)
#endif

#if defined(ENOBUFS) && !defined(_WIN32)
# define UV__ENOBUFS UV__ERR(ENOBUFS)
#else
# define UV__ENOBUFS (-4060)
#endif

#if defined(ENODEV) && !defined(_WIN32)
# define UV__ENODEV UV__ERR(ENODEV)
#else
# define UV__ENODEV (-4059)
#endif

#if defined(ENOENT) && !defined(_WIN32)
# define UV__ENOENT UV__ERR(ENOENT)
#else
# define UV__ENOENT (-4058)
#endif

#if defined(ENOMEM) && !defined(_WIN32)
# define UV__ENOMEM UV__ERR(ENOMEM)
#else
# define UV__ENOMEM (-4057)
#endif

#if defined(ENONET) && !defined(_WIN32)
# define UV__ENONET UV__ERR(ENONET)
#else
# define UV__ENONET (-4056)
#endif

#if defined(ENOSPC) && !defined(_WIN32)
# define UV__ENOSPC UV__ERR(ENOSPC)
#else
# define UV__ENOSPC (-4055)
#endif

#if defined(ENOSYS) && !defined(_WIN32)
# define UV__ENOSYS UV__ERR(ENOSYS)
#else
# define UV__ENOSYS (-4054)
#endif

#if defined(ENOTCONN) && !defined(_WIN32)
# define UV__ENOTCONN UV__ERR(ENOTCONN)
#else
# define UV__ENOTCONN (-4053)
#endif

#if defined(ENOTDIR) && !defined(_WIN32)
# define UV__ENOTDIR UV__ERR(ENOTDIR)
#else
# define UV__ENOTDIR (-4052)
#endif

#if defined(ENOTEMPTY) && !defined(_WIN32)
# define UV__ENOTEMPTY UV__ERR(ENOTEMPTY)
#else
# define UV__ENOTEMPTY (-4051)
#endif

#if defined(ENOTSOCK) && !defined(_WIN32)
# define UV__ENOTSOCK UV__ERR(ENOTSOCK)
#else
# define UV__ENOTSOCK (-4050)
#endif

#if defined(ENOTSUP) && !defined(_WIN32)
# define UV__ENOTSUP UV__ERR(ENOTSUP)
#else
# define UV__ENOTSUP (-4049)
#endif

#if defined(EPERM) && !defined(_WIN32)
# define UV__EPERM UV__ERR(EPERM)
#else
# define UV__EPERM (-4048)
#endif

#if defined(EPIPE) && !defined(_WIN32)
# define UV__EPIPE UV__ERR(EPIPE)
#else
# define UV__EPIPE (-4047)
#endif

#if defined(EPROTO) && !defined(_WIN32)
# define UV__EPROTO UV__ERR(EPROTO)
#else
# define UV__EPROTO (-4046)
#endif

#if defined(EPROTONOSUPPORT) && !defined(_WIN32)
# define UV__EPROTONOSUPPORT UV__ERR(EPROTONOSUPPORT)
#else
# define UV__EPROTONOSUPPORT (-4045)
#endif

#if defined(EPROTOTYPE) && !defined(_WIN32)
# define UV__EPROTOTYPE UV__ERR(EPROTOTYPE)
#else
# define UV__EPROTOTYPE (-4044)
#endif

#if defined(EROFS) && !defined(_WIN32)
# define UV__EROFS UV__ERR(EROFS)
#else
# define UV__EROFS (-4043)
#endif

#if defined(ESHUTDOWN) && !defined(_WIN32)
# define UV__ESHUTDOWN UV__ERR(ESHUTDOWN)
#else
# define UV__ESHUTDOWN (-4042)
#endif

#if defined(ESPIPE) && !defined(_WIN32)
# define UV__ESPIPE UV__ERR(ESPIPE)
#else
# define UV__ESPIPE (-4041)
#endif

#if defined(ESRCH) && !defined(_WIN32)
# define UV__ESRCH UV__ERR(ESRCH)
#else
# define UV__ESRCH (-4040)
#endif

#if defined(ETIMEDOUT) && !defined(_WIN32)
# define UV__ETIMEDOUT UV__ERR(ETIMEDOUT)
#else
# define UV__ETIMEDOUT (-4039)
#endif

#if defined(ETXTBSY) && !defined(_WIN32)
# define UV__ETXTBSY UV__ERR(ETXTBSY)
#else
# define UV__ETXTBSY (-4038)
#endif

#if defined(EXDEV) && !defined(_WIN32)
# define UV__EXDEV UV__ERR(EXDEV)
#else
# define UV__EXDEV (-4037)
#endif

#if defined(EFBIG) && !defined(_WIN32)
# define UV__EFBIG UV__ERR(EFBIG)
#else
# define UV__EFBIG (-4036)
#endif

#if defined(ENOPROTOOPT) && !defined(_WIN32)
# define UV__ENOPROTOOPT UV__ERR(ENOPROTOOPT)
#else
# define UV__ENOPROTOOPT (-4035)
#endif

#if defined(ERANGE) && !defined(_WIN32)
# define UV__ERANGE UV__ERR(ERANGE)
#else
# define UV__ERANGE (-4034)
#endif

#if defined(ENXIO) && !defined(_WIN32)
# define UV__ENXIO UV__ERR(ENXIO)
#else
# define UV__ENXIO (-4033)
#endif

#if defined(EMLINK) && !defined(_WIN32)
# define UV__EMLINK UV__ERR(EMLINK)
#else
# define UV__EMLINK (-4032)
#endif

/* EHOSTDOWN is not visible on BSD-like systems when _POSIX_C_SOURCE is
 * defined. Fortunately, its value is always 64 so it's possible albeit
 * icky to hard-code it.
 */
#if defined(EHOSTDOWN) && !defined(_WIN32)
# define UV__EHOSTDOWN UV__ERR(EHOSTDOWN)
#elif defined(__APPLE__) || \
      defined(__DragonFly__) || \
      defined(__FreeBSD__) || \
      defined(__NetBSD__) || \
      defined(__OpenBSD__)
# define UV__EHOSTDOWN (-64)
#else
# define UV__EHOSTDOWN (-4031)
#endif

#if defined(EREMOTEIO) && !defined(_WIN32)
# define UV__EREMOTEIO UV__ERR(EREMOTEIO)
#else
# define UV__EREMOTEIO (-4030)
#endif

#if defined(ENOTTY) && !defined(_WIN32)
# define UV__ENOTTY UV__ERR(ENOTTY)
#else
# define UV__ENOTTY (-4029)
#endif

#if defined(EFTYPE) && !defined(_WIN32)
# define UV__EFTYPE UV__ERR(EFTYPE)
#else
# define UV__EFTYPE (-4028)
#endif

#if defined(EILSEQ) && !defined(_WIN32)
# define UV__EILSEQ UV__ERR(EILSEQ)
#else
# define UV__EILSEQ (-4027)
#endif

#if defined(EOVERFLOW) && !defined(_WIN32)
# define UV__EOVERFLOW UV__ERR(EOVERFLOW)
#else
# define UV__EOVERFLOW (-4026)
#endif

#if defined(ESOCKTNOSUPPORT) && !defined(_WIN32)
# define UV__ESOCKTNOSUPPORT UV__ERR(ESOCKTNOSUPPORT)
#else
# define UV__ESOCKTNOSUPPORT (-4025)
#endif

/* FreeBSD defines ENODATA in /usr/include/c++/v1/errno.h which is only visible
 * if C++ is being used. Define it directly to avoid problems when integrating
 * libuv in a C++ project.
 */
#if defined(ENODATA) && !defined(_WIN32)
# define UV__ENODATA UV__ERR(ENODATA)
#elif defined(__FreeBSD__)
# define UV__ENODATA (-9919)
#else
# define UV__ENODATA (-4024)
#endif

#if defined(EUNATCH) && !defined(_WIN32)
# define UV__EUNATCH UV__ERR(EUNATCH)
#else
# define UV__EUNATCH (-4023)
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
    auto& vm = globalObject->vm();
    auto arg0 = callFrame->argument(0);

    // Node.js crashes here:
    // However, we should ensure this function never throws
    // That's why we do not call toPrimitive here or throw on invalid input.
    if (UNLIKELY(!arg0.isInt32AsAnyInt())) {
        return JSValue::encode(jsString(vm, String("Unknown system error"_s)));
    }

    auto err = arg0.toInt32(globalObject);
#define CASE(name, desc) \
    if (err == UV__##name) return JSValue::encode(JSC::jsString(vm, String(#name##_s)));

    BUN_UV_ERRNO_MAP(CASE)
#undef CASE

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

#define PUT_PROPERTY(name, desc) putProperty(vm, map, globalObject, #name##_s, UV__##name, desc##_s);
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
    putNamedProperty(vm, bindingObject, "UV_" #name##_s, UV__##name);
    BUN_UV_ERRNO_MAP(PUT_PROPERTY)
#undef PUT_PROPERTY

    bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, "getErrorMap"_s), JSC::JSFunction::create(vm, globalObject, 0, "getErrorMap"_s, jsGetErrorMap, ImplementationVisibility::Public));

    return bindingObject;
}

} // namespace ProcessBindingUV
} // namespace Bun
