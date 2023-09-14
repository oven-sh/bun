#include "ProcessBindingUV.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSMap.h"

// clang-format off

#define UV_ERRNO_MAP(macro) \
  macro(UV_E2BIG, -7, "argument list too long") \
  macro(UV_EACCES, -13, "permission denied") \
  macro(UV_EADDRINUSE, -48, "address already in use") \
  macro(UV_EADDRNOTAVAIL, -49, "address not available") \
  macro(UV_EAFNOSUPPORT, -47, "address family not supported") \
  macro(UV_EAGAIN, -35, "resource temporarily unavailable") \
  macro(UV_EAI_ADDRFAMILY, -3000, "address family not supported") \
  macro(UV_EAI_AGAIN, -3001, "temporary failure") \
  macro(UV_EAI_BADFLAGS, -3002, "bad ai_flags value") \
  macro(UV_EAI_BADHINTS, -3013, "invalid value for hints") \
  macro(UV_EAI_CANCELED, -3003, "request canceled") \
  macro(UV_EAI_FAIL, -3004, "permanent failure") \
  macro(UV_EAI_FAMILY, -3005, "ai_family not supported") \
  macro(UV_EAI_MEMORY, -3006, "out of memory") \
  macro(UV_EAI_NODATA, -3007, "no address") \
  macro(UV_EAI_NONAME, -3008, "unknown node or service") \
  macro(UV_EAI_OVERFLOW, -3009, "argument buffer overflow") \
  macro(UV_EAI_PROTOCOL, -3014, "resolved protocol is unknown") \
  macro(UV_EAI_SERVICE, -3010, "service not available for socket type") \
  macro(UV_EAI_SOCKTYPE, -3011, "socket type not supported") \
  macro(UV_EALREADY, -37, "connection already in progress") \
  macro(UV_EBADF, -9, "bad file descriptor") \
  macro(UV_EBUSY, -16, "resource busy or locked") \
  macro(UV_ECANCELED, -89, "operation canceled") \
  macro(UV_ECHARSET, -4080, "invalid Unicode character") \
  macro(UV_ECONNABORTED, -53, "software caused connection abort") \
  macro(UV_ECONNREFUSED, -61, "connection refused") \
  macro(UV_ECONNRESET, -54, "connection reset by peer") \
  macro(UV_EDESTADDRREQ, -39, "destination address required") \
  macro(UV_EEXIST, -17, "file already exists") \
  macro(UV_EFAULT, -14, "bad address in system call argument") \
  macro(UV_EFBIG, -27, "file too large") \
  macro(UV_EHOSTUNREACH, -65, "host is unreachable") \
  macro(UV_EINTR, -4, "interrupted system call") \
  macro(UV_EINVAL, -22, "invalid argument") \
  macro(UV_EIO, -5, "i/o error") \
  macro(UV_EISCONN, -56, "socket is already connected") \
  macro(UV_EISDIR, -21, "illegal operation on a directory") \
  macro(UV_ELOOP, -62, "too many symbolic links encountered") \
  macro(UV_EMFILE, -24, "too many open files") \
  macro(UV_EMSGSIZE, -40, "message too long") \
  macro(UV_ENAMETOOLONG, -63, "name too long") \
  macro(UV_ENETDOWN, -50, "network is down") \
  macro(UV_ENETUNREACH, -51, "network is unreachable") \
  macro(UV_ENFILE, -23, "file table overflow") \
  macro(UV_ENOBUFS, -55, "no buffer space available") \
  macro(UV_ENODEV, -19, "no such device") \
  macro(UV_ENOENT, -2, "no such file or directory") \
  macro(UV_ENOMEM, -12, "not enough memory") \
  macro(UV_ENONET, -4056, "machine is not on the network") \
  macro(UV_ENOPROTOOPT, -42, "protocol not available") \
  macro(UV_ENOSPC, -28, "no space left on device") \
  macro(UV_ENOSYS, -78, "function not implemented") \
  macro(UV_ENOTCONN, -57, "socket is not connected") \
  macro(UV_ENOTDIR, -20, "not a directory") \
  macro(UV_ENOTEMPTY, -66, "directory not empty") \
  macro(UV_ENOTSOCK, -38, "socket operation on non-socket") \
  macro(UV_ENOTSUP, -45, "operation not supported on socket") \
  macro(UV_EOVERFLOW, -84, "value too large for defined data type") \
  macro(UV_EPERM, -1, "operation not permitted") \
  macro(UV_EPIPE, -32, "broken pipe") \
  macro(UV_EPROTO, -100, "protocol error") \
  macro(UV_EPROTONOSUPPORT, -43, "protocol not supported") \
  macro(UV_EPROTOTYPE, -41, "protocol wrong type for socket") \
  macro(UV_ERANGE, -34, "result too large") \
  macro(UV_EROFS, -30, "read-only file system") \
  macro(UV_ESHUTDOWN, -58, "cannot send after transport endpoint shutdown") \
  macro(UV_ESPIPE, -29, "invalid seek") \
  macro(UV_ESRCH, -3, "no such process") \
  macro(UV_ETIMEDOUT, -60, "connection timed out") \
  macro(UV_ETXTBSY, -26, "text file is busy") \
  macro(UV_EXDEV, -18, "cross-device link not permitted") \
  macro(UV_UNKNOWN, -4094, "unknown error") \
  macro(UV_EOF, -4095, "end of file") \
  macro(UV_ENXIO, -6, "no such device or address") \
  macro(UV_EMLINK, -31, "too many links") \
  macro(UV_EHOSTDOWN, -64, "host is down") \
  macro(UV_EREMOTEIO, -4030, "remote I/O error") \
  macro(UV_ENOTTY, -25, "inappropriate ioctl for device") \
  macro(UV_EFTYPE, -79, "inappropriate file type or format") \
  macro(UV_EILSEQ, -92, "illegal byte sequence") \
  macro(UV_ESOCKTNOSUPPORT, -44, "socket type not supported") \
  macro(UV_ENODATA, -96, "no data available") \
  macro(UV_EUNATCH, -4023, "protocol driver not attache")

// clang-format on
namespace Bun {
namespace ProcessBindingUV {

JSC_DEFINE_HOST_FUNCTION(jsErrname, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto arg0 = callFrame->argument(0);
    auto& vm = globalObject->vm();

    // Node.js will actualy crash here, lol.
    if (!arg0.isInt32())
        return JSValue::encode(jsString(vm, makeString("Unknown system error "_s, arg0.toWTFString(globalObject))));

    auto err = arg0.asInt32();
    switch (err) {
#define CASE(name, value, desc) \
    case value:                 \
        return JSValue::encode(JSC::jsString(vm, String(#name##_s)));
        UV_ERRNO_MAP(CASE)
#undef CASE
    }

    return JSValue::encode(jsString(vm, makeString("Unknown system error "_s, String::number(err))));
}

JSC_DEFINE_HOST_FUNCTION(jsGetErrorMap, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto map = JSC::JSMap::create(vm, globalObject->mapStructure());

#define PUT_PROPERTY(name, value)                                                       \
    map->set(globalObject, JSC::jsNumber(value), JSC::jsString(vm, String(#name##_s))); \
    UV_ERRNO_MAP(PUT_PROPERTY)
#undef PUT_PROPERTY

    return JSValue::encode(map);
}

JSObject* create(VM& vm, JSGlobalObject* globalObject)
{
    auto bindingObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 0);

    bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, "errname"_s), JSC::JSFunction::create(vm, globalObject, 1, "errname"_s, jsErrname, ImplementationVisibility::Public));

#define PUT_PROPERTY(name, value, desc) \
    bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, #name##_s), JSC::jsNumber(value));
    UV_ERRNO_MAP(PUT_PROPERTY)
#undef PUT_PROPERTY

    bindingObject->putDirect(vm, JSC::Identifier::fromString(vm, "getErrorMap"_s), JSC::JSFunction::create(vm, globalObject, 0, "getErrorMap"_s, jsGetErrorMap, ImplementationVisibility::Public));

    return bindingObject;
}

} // namespace ProcessBindingUV
} // namespace Bun