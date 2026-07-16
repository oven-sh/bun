#include "ProcessBindingUV.h"
#include "JavaScriptCore/ArrayAllocationProfile.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ThrowScope.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSMapInlines.h"

// libuv's UV__E* constants. On non-Windows these resolve to the negated host
// errno (e.g. UV__ENOBUFS == -ENOBUFS == -105 on Linux); on Windows and for
// codes the host lacks (EFTYPE on Linux, ...) they resolve to libuv's fixed
// synthetic values (UV__ENOBUFS == -4060). Node.js exposes these exact values
// on process.binding("uv") and keys util.getSystemErrorName() off them, so
// using the platform E* macros directly (which picks up MSVC's errno.h on
// Windows) breaks the round-trip.
#include <uv/errno.h>

// clang-format off
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
  macro(EUNATCH, "protocol driver not attached") \
  macro(ENOEXEC, "exec format error")

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
    if (err == UV__##name) return JSValue::encode(JSC::jsString(vm, String(#name##_s)));

    BUN_UV_ERRNO_MAP(CASE)
#undef CASE

    return JSValue::encode(jsString(vm, makeString("Unknown system error "_s, err)));
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
