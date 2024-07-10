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

JSC_DEFINE_HOST_FUNCTION(jsGetErrorMap, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto map = JSC::JSMap::create(vm, globalObject->mapStructure());

#define PUT_PROPERTY(name, value, desc)                                                                           \
    {                                                                                                             \
        auto arr = JSC::constructEmptyArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), 2); \
        arr->putDirectIndex(globalObject, 0, JSC::jsString(vm, String(#name##_s)));                               \
        arr->putDirectIndex(globalObject, 1, JSC::jsString(vm, String(desc##_s)));                                \
        map->set(globalObject, JSC::jsNumber(value), arr);                                                        \
    }

    BUN_UV_ERRNO_MAP(PUT_PROPERTY)
#undef PUT_PROPERTY

    return JSValue::encode(map);
}

JSObject* create(VM& vm, JSGlobalObject* globalObject)
{
    auto bindingObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 0);
    EnsureStillAliveScope ensureStillAlive(bindingObject);
    bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, "errname"_s), JSC::JSFunction::create(vm, globalObject, 1, "errname"_s, jsErrname, ImplementationVisibility::Public));

#define PUT_PROPERTY(name, value, desc) \
    bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, "UV_" #name##_s), JSC::jsNumber(value));

    BUN_UV_ERRNO_MAP(PUT_PROPERTY)
#undef PUT_PROPERTY

    bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, "getErrorMap"_s), JSC::JSFunction::create(vm, globalObject, 0, "getErrorMap"_s, jsGetErrorMap, ImplementationVisibility::Public));

    return bindingObject;
}

} // namespace ProcessBindingUV
} // namespace Bun