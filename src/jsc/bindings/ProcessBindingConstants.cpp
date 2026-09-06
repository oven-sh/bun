// Modelled off of https://github.com/nodejs/node/blob/main/src/node_constants.cc
// Note that if you change any of this code, you probably also have to change NodeConstantsModule.h
#include "ProcessBindingConstants.h"
#include <JavaScriptCore/ObjectConstructor.h>

// These headers may not all be needed, but they are the ones node references.
// Most of the constants are defined with #if checks on existing #defines, instead of platform-checks
#include <openssl/ec.h>
#include <openssl/ssl.h>
#include <zlib.h>
#include <brotli/encode.h>
#include <brotli/decode.h>
#include <zstd.h>
#include <fcntl.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <cerrno>
#include <csignal>
#include <limits>

#if !defined(_MSC_VER)
#include <unistd.h>
#endif

#if OS(WINDOWS)

#include <io.h> // _S_IREAD _S_IWRITE
#ifndef S_IRUSR
#define S_IRUSR _S_IREAD
#endif // S_IRUSR
#ifndef S_IWUSR
#define S_IWUSR _S_IWRITE
#endif // S_IWUSR
// The UCRT only defines the underscore-prefixed _S_IFIFO; whether the plain
// spelling is visible here otherwise depends on what happened to be defined
// earlier in the unified source. Node exposes fs.constants.S_IFIFO (4096) on
// Windows, so pin it to the CRT value instead of relying on header luck.
#if !defined(S_IFIFO) && defined(_S_IFIFO)
#define S_IFIFO _S_IFIFO
#endif // S_IFIFO

#include <uv.h>

#else // OS(WINDOWS)
#include <dlfcn.h>
#endif

namespace Bun {
using namespace JSC;

// Tables end with a `{ nullptr, 0 }` row: every entry of some tables is
// `#ifdef`-guarded, and an empty array could not be passed as a span.
struct NumericConstant {
    const char* name;
    double value;
};

// One loop instead of a `putDirect` call sequence per constant; these objects
// are each built once, lazily.
static void putNumericConstants(VM& vm, JSObject* object, const NumericConstant* constants)
{
    for (; constants->name; ++constants)
        object->putDirect(vm, Identifier::fromString(vm, ASCIILiteral::fromLiteralUnsafe(constants->name)), jsNumber(constants->value));
}

static JSValue processBindingConstantsGetOs(VM& vm, JSObject* bindingObject)
{
    auto globalObject = bindingObject->globalObject();
    auto osObj = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    auto dlopenObj = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    auto errnoObj = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    auto signalsObj = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    auto priorityObj = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    static constexpr NumericConstant kConstants1[] = {
        { "UV_UDP_REUSEADDR", static_cast<double>(4) },
        { nullptr, 0 },
    };
    putNumericConstants(vm, osObj, kConstants1);
    Bun::putDirectNamed(vm, osObj, "dlopen"_s, dlopenObj);
    Bun::putDirectNamed(vm, osObj, "errno"_s, errnoObj);
    Bun::putDirectNamed(vm, osObj, "signals"_s, signalsObj);
    Bun::putDirectNamed(vm, osObj, "priority"_s, priorityObj);
    static constexpr NumericConstant kConstants2[] = {
#ifdef E2BIG
        { "E2BIG", static_cast<double>(E2BIG) },
#endif
#ifdef EACCES
        { "EACCES", static_cast<double>(EACCES) },
#endif
#ifdef EADDRINUSE
        { "EADDRINUSE", static_cast<double>(EADDRINUSE) },
#endif
#ifdef EADDRNOTAVAIL
        { "EADDRNOTAVAIL", static_cast<double>(EADDRNOTAVAIL) },
#endif
#ifdef EAFNOSUPPORT
        { "EAFNOSUPPORT", static_cast<double>(EAFNOSUPPORT) },
#endif
#ifdef EAGAIN
        { "EAGAIN", static_cast<double>(EAGAIN) },
#endif
#ifdef EALREADY
        { "EALREADY", static_cast<double>(EALREADY) },
#endif
#ifdef EBADF
        { "EBADF", static_cast<double>(EBADF) },
#endif
#ifdef EBADMSG
        { "EBADMSG", static_cast<double>(EBADMSG) },
#endif
#ifdef EBUSY
        { "EBUSY", static_cast<double>(EBUSY) },
#endif
#ifdef ECANCELED
        { "ECANCELED", static_cast<double>(ECANCELED) },
#endif
#ifdef ECHILD
        { "ECHILD", static_cast<double>(ECHILD) },
#endif
#ifdef ECONNABORTED
        { "ECONNABORTED", static_cast<double>(ECONNABORTED) },
#endif
#ifdef ECONNREFUSED
        { "ECONNREFUSED", static_cast<double>(ECONNREFUSED) },
#endif
#ifdef ECONNRESET
        { "ECONNRESET", static_cast<double>(ECONNRESET) },
#endif
#ifdef EDEADLK
        { "EDEADLK", static_cast<double>(EDEADLK) },
#endif
#ifdef EDESTADDRREQ
        { "EDESTADDRREQ", static_cast<double>(EDESTADDRREQ) },
#endif
#ifdef EDOM
        { "EDOM", static_cast<double>(EDOM) },
#endif
#ifdef EDQUOT
        { "EDQUOT", static_cast<double>(EDQUOT) },
#endif
#ifdef EEXIST
        { "EEXIST", static_cast<double>(EEXIST) },
#endif
#ifdef EFAULT
        { "EFAULT", static_cast<double>(EFAULT) },
#endif
#ifdef EFBIG
        { "EFBIG", static_cast<double>(EFBIG) },
#endif
#ifdef EHOSTUNREACH
        { "EHOSTUNREACH", static_cast<double>(EHOSTUNREACH) },
#endif
#ifdef EIDRM
        { "EIDRM", static_cast<double>(EIDRM) },
#endif
#ifdef EILSEQ
        { "EILSEQ", static_cast<double>(EILSEQ) },
#endif
#ifdef EINPROGRESS
        { "EINPROGRESS", static_cast<double>(EINPROGRESS) },
#endif
#ifdef EINTR
        { "EINTR", static_cast<double>(EINTR) },
#endif
#ifdef EINVAL
        { "EINVAL", static_cast<double>(EINVAL) },
#endif
#ifdef EIO
        { "EIO", static_cast<double>(EIO) },
#endif
#ifdef EISCONN
        { "EISCONN", static_cast<double>(EISCONN) },
#endif
#ifdef EISDIR
        { "EISDIR", static_cast<double>(EISDIR) },
#endif
#ifdef ELOOP
        { "ELOOP", static_cast<double>(ELOOP) },
#endif
#ifdef EMFILE
        { "EMFILE", static_cast<double>(EMFILE) },
#endif
#ifdef EMLINK
        { "EMLINK", static_cast<double>(EMLINK) },
#endif
#ifdef EMSGSIZE
        { "EMSGSIZE", static_cast<double>(EMSGSIZE) },
#endif
#ifdef EMULTIHOP
        { "EMULTIHOP", static_cast<double>(EMULTIHOP) },
#endif
#ifdef ENAMETOOLONG
        { "ENAMETOOLONG", static_cast<double>(ENAMETOOLONG) },
#endif
#ifdef ENETDOWN
        { "ENETDOWN", static_cast<double>(ENETDOWN) },
#endif
#ifdef ENETRESET
        { "ENETRESET", static_cast<double>(ENETRESET) },
#endif
#ifdef ENETUNREACH
        { "ENETUNREACH", static_cast<double>(ENETUNREACH) },
#endif
#ifdef ENFILE
        { "ENFILE", static_cast<double>(ENFILE) },
#endif
#ifdef ENOBUFS
        { "ENOBUFS", static_cast<double>(ENOBUFS) },
#endif
#ifdef ENODATA
        { "ENODATA", static_cast<double>(ENODATA) },
#endif
#ifdef ENODEV
        { "ENODEV", static_cast<double>(ENODEV) },
#endif
#ifdef ENOENT
        { "ENOENT", static_cast<double>(ENOENT) },
#endif
#ifdef ENOEXEC
        { "ENOEXEC", static_cast<double>(ENOEXEC) },
#endif
#ifdef ENOLCK
        { "ENOLCK", static_cast<double>(ENOLCK) },
#endif
#ifdef ENOLINK
        { "ENOLINK", static_cast<double>(ENOLINK) },
#endif
#ifdef ENOMEM
        { "ENOMEM", static_cast<double>(ENOMEM) },
#endif
#ifdef ENOMSG
        { "ENOMSG", static_cast<double>(ENOMSG) },
#endif
#ifdef ENOPROTOOPT
        { "ENOPROTOOPT", static_cast<double>(ENOPROTOOPT) },
#endif
#ifdef ENOSPC
        { "ENOSPC", static_cast<double>(ENOSPC) },
#endif
#ifdef ENOSR
        { "ENOSR", static_cast<double>(ENOSR) },
#endif
#ifdef ENOSTR
        { "ENOSTR", static_cast<double>(ENOSTR) },
#endif
#ifdef ENOSYS
        { "ENOSYS", static_cast<double>(ENOSYS) },
#endif
#ifdef ENOTCONN
        { "ENOTCONN", static_cast<double>(ENOTCONN) },
#endif
#ifdef ENOTDIR
        { "ENOTDIR", static_cast<double>(ENOTDIR) },
#endif
#ifdef ENOTEMPTY
        { "ENOTEMPTY", static_cast<double>(ENOTEMPTY) },
#endif
#ifdef ENOTSOCK
        { "ENOTSOCK", static_cast<double>(ENOTSOCK) },
#endif
#ifdef ENOTSUP
        { "ENOTSUP", static_cast<double>(ENOTSUP) },
#endif
#ifdef ENOTTY
        { "ENOTTY", static_cast<double>(ENOTTY) },
#endif
#ifdef ENXIO
        { "ENXIO", static_cast<double>(ENXIO) },
#endif
#ifdef EOPNOTSUPP
        { "EOPNOTSUPP", static_cast<double>(EOPNOTSUPP) },
#endif
#ifdef EOVERFLOW
        { "EOVERFLOW", static_cast<double>(EOVERFLOW) },
#endif
#ifdef EPERM
        { "EPERM", static_cast<double>(EPERM) },
#endif
#ifdef EPIPE
        { "EPIPE", static_cast<double>(EPIPE) },
#endif
#ifdef EPROTO
        { "EPROTO", static_cast<double>(EPROTO) },
#endif
#ifdef EPROTONOSUPPORT
        { "EPROTONOSUPPORT", static_cast<double>(EPROTONOSUPPORT) },
#endif
#ifdef EPROTOTYPE
        { "EPROTOTYPE", static_cast<double>(EPROTOTYPE) },
#endif
#ifdef ERANGE
        { "ERANGE", static_cast<double>(ERANGE) },
#endif
#ifdef EROFS
        { "EROFS", static_cast<double>(EROFS) },
#endif
#ifdef ESPIPE
        { "ESPIPE", static_cast<double>(ESPIPE) },
#endif
#ifdef ESRCH
        { "ESRCH", static_cast<double>(ESRCH) },
#endif
#ifdef ESTALE
        { "ESTALE", static_cast<double>(ESTALE) },
#endif
#ifdef ETIME
        { "ETIME", static_cast<double>(ETIME) },
#endif
#ifdef ETIMEDOUT
        { "ETIMEDOUT", static_cast<double>(ETIMEDOUT) },
#endif
#ifdef ETXTBSY
        { "ETXTBSY", static_cast<double>(ETXTBSY) },
#endif
#ifdef EWOULDBLOCK
        { "EWOULDBLOCK", static_cast<double>(EWOULDBLOCK) },
#endif
#ifdef EXDEV
        { "EXDEV", static_cast<double>(EXDEV) },
#endif
#ifdef WSAEINTR
        { "WSAEINTR", static_cast<double>(WSAEINTR) },
#endif
#ifdef WSAEBADF
        { "WSAEBADF", static_cast<double>(WSAEBADF) },
#endif
#ifdef WSAEACCES
        { "WSAEACCES", static_cast<double>(WSAEACCES) },
#endif
#ifdef WSAEFAULT
        { "WSAEFAULT", static_cast<double>(WSAEFAULT) },
#endif
#ifdef WSAEINVAL
        { "WSAEINVAL", static_cast<double>(WSAEINVAL) },
#endif
#ifdef WSAEMFILE
        { "WSAEMFILE", static_cast<double>(WSAEMFILE) },
#endif
#ifdef WSAEWOULDBLOCK
        { "WSAEWOULDBLOCK", static_cast<double>(WSAEWOULDBLOCK) },
#endif
#ifdef WSAEINPROGRESS
        { "WSAEINPROGRESS", static_cast<double>(WSAEINPROGRESS) },
#endif
#ifdef WSAEALREADY
        { "WSAEALREADY", static_cast<double>(WSAEALREADY) },
#endif
#ifdef WSAENOTSOCK
        { "WSAENOTSOCK", static_cast<double>(WSAENOTSOCK) },
#endif
#ifdef WSAEDESTADDRREQ
        { "WSAEDESTADDRREQ", static_cast<double>(WSAEDESTADDRREQ) },
#endif
#ifdef WSAEMSGSIZE
        { "WSAEMSGSIZE", static_cast<double>(WSAEMSGSIZE) },
#endif
#ifdef WSAEPROTOTYPE
        { "WSAEPROTOTYPE", static_cast<double>(WSAEPROTOTYPE) },
#endif
#ifdef WSAENOPROTOOPT
        { "WSAENOPROTOOPT", static_cast<double>(WSAENOPROTOOPT) },
#endif
#ifdef WSAEPROTONOSUPPORT
        { "WSAEPROTONOSUPPORT", static_cast<double>(WSAEPROTONOSUPPORT) },
#endif
#ifdef WSAESOCKTNOSUPPORT
        { "WSAESOCKTNOSUPPORT", static_cast<double>(WSAESOCKTNOSUPPORT) },
#endif
#ifdef WSAEOPNOTSUPP
        { "WSAEOPNOTSUPP", static_cast<double>(WSAEOPNOTSUPP) },
#endif
#ifdef WSAEPFNOSUPPORT
        { "WSAEPFNOSUPPORT", static_cast<double>(WSAEPFNOSUPPORT) },
#endif
#ifdef WSAEAFNOSUPPORT
        { "WSAEAFNOSUPPORT", static_cast<double>(WSAEAFNOSUPPORT) },
#endif
#ifdef WSAEADDRINUSE
        { "WSAEADDRINUSE", static_cast<double>(WSAEADDRINUSE) },
#endif
#ifdef WSAEADDRNOTAVAIL
        { "WSAEADDRNOTAVAIL", static_cast<double>(WSAEADDRNOTAVAIL) },
#endif
#ifdef WSAENETDOWN
        { "WSAENETDOWN", static_cast<double>(WSAENETDOWN) },
#endif
#ifdef WSAENETUNREACH
        { "WSAENETUNREACH", static_cast<double>(WSAENETUNREACH) },
#endif
#ifdef WSAENETRESET
        { "WSAENETRESET", static_cast<double>(WSAENETRESET) },
#endif
#ifdef WSAECONNABORTED
        { "WSAECONNABORTED", static_cast<double>(WSAECONNABORTED) },
#endif
#ifdef WSAECONNRESET
        { "WSAECONNRESET", static_cast<double>(WSAECONNRESET) },
#endif
#ifdef WSAENOBUFS
        { "WSAENOBUFS", static_cast<double>(WSAENOBUFS) },
#endif
#ifdef WSAEISCONN
        { "WSAEISCONN", static_cast<double>(WSAEISCONN) },
#endif
#ifdef WSAENOTCONN
        { "WSAENOTCONN", static_cast<double>(WSAENOTCONN) },
#endif
#ifdef WSAESHUTDOWN
        { "WSAESHUTDOWN", static_cast<double>(WSAESHUTDOWN) },
#endif
#ifdef WSAETOOMANYREFS
        { "WSAETOOMANYREFS", static_cast<double>(WSAETOOMANYREFS) },
#endif
#ifdef WSAETIMEDOUT
        { "WSAETIMEDOUT", static_cast<double>(WSAETIMEDOUT) },
#endif
#ifdef WSAECONNREFUSED
        { "WSAECONNREFUSED", static_cast<double>(WSAECONNREFUSED) },
#endif
#ifdef WSAELOOP
        { "WSAELOOP", static_cast<double>(WSAELOOP) },
#endif
#ifdef WSAENAMETOOLONG
        { "WSAENAMETOOLONG", static_cast<double>(WSAENAMETOOLONG) },
#endif
#ifdef WSAEHOSTDOWN
        { "WSAEHOSTDOWN", static_cast<double>(WSAEHOSTDOWN) },
#endif
#ifdef WSAEHOSTUNREACH
        { "WSAEHOSTUNREACH", static_cast<double>(WSAEHOSTUNREACH) },
#endif
#ifdef WSAENOTEMPTY
        { "WSAENOTEMPTY", static_cast<double>(WSAENOTEMPTY) },
#endif
#ifdef WSAEPROCLIM
        { "WSAEPROCLIM", static_cast<double>(WSAEPROCLIM) },
#endif
#ifdef WSAEUSERS
        { "WSAEUSERS", static_cast<double>(WSAEUSERS) },
#endif
#ifdef WSAEDQUOT
        { "WSAEDQUOT", static_cast<double>(WSAEDQUOT) },
#endif
#ifdef WSAESTALE
        { "WSAESTALE", static_cast<double>(WSAESTALE) },
#endif
#ifdef WSAEREMOTE
        { "WSAEREMOTE", static_cast<double>(WSAEREMOTE) },
#endif
#ifdef WSASYSNOTREADY
        { "WSASYSNOTREADY", static_cast<double>(WSASYSNOTREADY) },
#endif
#ifdef WSAVERNOTSUPPORTED
        { "WSAVERNOTSUPPORTED", static_cast<double>(WSAVERNOTSUPPORTED) },
#endif
#ifdef WSANOTINITIALISED
        { "WSANOTINITIALISED", static_cast<double>(WSANOTINITIALISED) },
#endif
#ifdef WSAEDISCON
        { "WSAEDISCON", static_cast<double>(WSAEDISCON) },
#endif
#ifdef WSAENOMORE
        { "WSAENOMORE", static_cast<double>(WSAENOMORE) },
#endif
#ifdef WSAECANCELLED
        { "WSAECANCELLED", static_cast<double>(WSAECANCELLED) },
#endif
#ifdef WSAEINVALIDPROCTABLE
        { "WSAEINVALIDPROCTABLE", static_cast<double>(WSAEINVALIDPROCTABLE) },
#endif
#ifdef WSAEINVALIDPROVIDER
        { "WSAEINVALIDPROVIDER", static_cast<double>(WSAEINVALIDPROVIDER) },
#endif
#ifdef WSAEPROVIDERFAILEDINIT
        { "WSAEPROVIDERFAILEDINIT", static_cast<double>(WSAEPROVIDERFAILEDINIT) },
#endif
#ifdef WSASYSCALLFAILURE
        { "WSASYSCALLFAILURE", static_cast<double>(WSASYSCALLFAILURE) },
#endif
#ifdef WSASERVICE_NOT_FOUND
        { "WSASERVICE_NOT_FOUND", static_cast<double>(WSASERVICE_NOT_FOUND) },
#endif
#ifdef WSATYPE_NOT_FOUND
        { "WSATYPE_NOT_FOUND", static_cast<double>(WSATYPE_NOT_FOUND) },
#endif
#ifdef WSA_E_NO_MORE
        { "WSA_E_NO_MORE", static_cast<double>(WSA_E_NO_MORE) },
#endif
#ifdef WSA_E_CANCELLED
        { "WSA_E_CANCELLED", static_cast<double>(WSA_E_CANCELLED) },
#endif
#ifdef WSAEREFUSED
        { "WSAEREFUSED", static_cast<double>(WSAEREFUSED) },
#endif
        { nullptr, 0 },
    };
    putNumericConstants(vm, errnoObj, kConstants2);
    static constexpr NumericConstant kConstants3[] = {
#ifdef SIGHUP
        { "SIGHUP", static_cast<double>(SIGHUP) },
#endif
#ifdef SIGINT
        { "SIGINT", static_cast<double>(SIGINT) },
#endif
#ifdef SIGQUIT
        { "SIGQUIT", static_cast<double>(SIGQUIT) },
#endif
#ifdef SIGILL
        { "SIGILL", static_cast<double>(SIGILL) },
#endif
#ifdef SIGTRAP
        { "SIGTRAP", static_cast<double>(SIGTRAP) },
#endif
#ifdef SIGABRT
        { "SIGABRT", static_cast<double>(SIGABRT) },
#endif
#ifdef SIGIOT
        { "SIGIOT", static_cast<double>(SIGIOT) },
#endif
#ifdef SIGBUS
        { "SIGBUS", static_cast<double>(SIGBUS) },
#endif
#ifdef SIGFPE
        { "SIGFPE", static_cast<double>(SIGFPE) },
#endif
#ifdef SIGKILL
        { "SIGKILL", static_cast<double>(SIGKILL) },
#endif
#ifdef SIGUSR1
        { "SIGUSR1", static_cast<double>(SIGUSR1) },
#endif
#ifdef SIGSEGV
        { "SIGSEGV", static_cast<double>(SIGSEGV) },
#endif
#ifdef SIGUSR2
        { "SIGUSR2", static_cast<double>(SIGUSR2) },
#endif
#ifdef SIGPIPE
        { "SIGPIPE", static_cast<double>(SIGPIPE) },
#endif
#ifdef SIGALRM
        { "SIGALRM", static_cast<double>(SIGALRM) },
#endif
#ifdef SIGTERM
        { "SIGTERM", static_cast<double>(SIGTERM) },
#endif
#ifdef SIGCHLD
        { "SIGCHLD", static_cast<double>(SIGCHLD) },
#endif
#ifdef SIGSTKFLT
        { "SIGSTKFLT", static_cast<double>(SIGSTKFLT) },
#endif
#ifdef SIGCONT
        { "SIGCONT", static_cast<double>(SIGCONT) },
#endif
#ifdef SIGSTOP
        { "SIGSTOP", static_cast<double>(SIGSTOP) },
#endif
#ifdef SIGTSTP
        { "SIGTSTP", static_cast<double>(SIGTSTP) },
#endif
#ifdef SIGBREAK
        { "SIGBREAK", static_cast<double>(SIGBREAK) },
#endif
#ifdef SIGTTIN
        { "SIGTTIN", static_cast<double>(SIGTTIN) },
#endif
#ifdef SIGTTOU
        { "SIGTTOU", static_cast<double>(SIGTTOU) },
#endif
#ifdef SIGURG
        { "SIGURG", static_cast<double>(SIGURG) },
#endif
#ifdef SIGXCPU
        { "SIGXCPU", static_cast<double>(SIGXCPU) },
#endif
#ifdef SIGXFSZ
        { "SIGXFSZ", static_cast<double>(SIGXFSZ) },
#endif
#ifdef SIGVTALRM
        { "SIGVTALRM", static_cast<double>(SIGVTALRM) },
#endif
#ifdef SIGPROF
        { "SIGPROF", static_cast<double>(SIGPROF) },
#endif
#ifdef SIGWINCH
        { "SIGWINCH", static_cast<double>(SIGWINCH) },
#endif
#ifdef SIGIO
        { "SIGIO", static_cast<double>(SIGIO) },
#endif
#ifdef SIGPOLL
        { "SIGPOLL", static_cast<double>(SIGPOLL) },
#endif
#ifdef SIGLOST
        { "SIGLOST", static_cast<double>(SIGLOST) },
#endif
#ifdef SIGPWR
        { "SIGPWR", static_cast<double>(SIGPWR) },
#endif
#ifdef SIGINFO
        { "SIGINFO", static_cast<double>(SIGINFO) },
#endif
#ifdef SIGSYS
        { "SIGSYS", static_cast<double>(SIGSYS) },
#endif
#ifdef SIGUNUSED
        { "SIGUNUSED", static_cast<double>(SIGUNUSED) },
#endif
        { nullptr, 0 },
    };
    putNumericConstants(vm, signalsObj, kConstants3);
    static constexpr NumericConstant kConstants4[] = {
        { "PRIORITY_LOW", static_cast<double>(19) },
        { "PRIORITY_BELOW_NORMAL", static_cast<double>(10) },
        { "PRIORITY_NORMAL", static_cast<double>(0) },
        { "PRIORITY_ABOVE_NORMAL", static_cast<double>(-7) },
        { "PRIORITY_HIGH", static_cast<double>(-14) },
        { "PRIORITY_HIGHEST", static_cast<double>(-20) },
        { nullptr, 0 },
    };
    putNumericConstants(vm, priorityObj, kConstants4);
    static constexpr NumericConstant kConstants5[] = {
#ifdef RTLD_LAZY
        { "RTLD_LAZY", static_cast<double>(RTLD_LAZY) },
#endif
#ifdef RTLD_NOW
        { "RTLD_NOW", static_cast<double>(RTLD_NOW) },
#endif
#ifdef RTLD_GLOBAL
        { "RTLD_GLOBAL", static_cast<double>(RTLD_GLOBAL) },
#endif
#ifdef RTLD_LOCAL
        { "RTLD_LOCAL", static_cast<double>(RTLD_LOCAL) },
#endif
#ifdef RTLD_DEEPBIND
        { "RTLD_DEEPBIND", static_cast<double>(RTLD_DEEPBIND) },
#endif
        { nullptr, 0 },
    };
    putNumericConstants(vm, dlopenObj, kConstants5);
    return osObj;
}

static JSValue processBindingConstantsGetTrace(VM& vm, JSObject* bindingObject)
{
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    static constexpr NumericConstant kConstants6[] = {
        { "TRACE_EVENT_PHASE_BEGIN", static_cast<double>(66) },
        { "TRACE_EVENT_PHASE_END", static_cast<double>(69) },
        { "TRACE_EVENT_PHASE_COMPLETE", static_cast<double>(88) },
        { "TRACE_EVENT_PHASE_INSTANT", static_cast<double>(73) },
        { "TRACE_EVENT_PHASE_ASYNC_BEGIN", static_cast<double>(83) },
        { "TRACE_EVENT_PHASE_ASYNC_STEP_INTO", static_cast<double>(84) },
        { "TRACE_EVENT_PHASE_ASYNC_STEP_PAST", static_cast<double>(112) },
        { "TRACE_EVENT_PHASE_ASYNC_END", static_cast<double>(70) },
        { "TRACE_EVENT_PHASE_NESTABLE_ASYNC_BEGIN", static_cast<double>(98) },
        { "TRACE_EVENT_PHASE_NESTABLE_ASYNC_END", static_cast<double>(101) },
        { "TRACE_EVENT_PHASE_NESTABLE_ASYNC_INSTANT", static_cast<double>(110) },
        { "TRACE_EVENT_PHASE_FLOW_BEGIN", static_cast<double>(115) },
        { "TRACE_EVENT_PHASE_FLOW_STEP", static_cast<double>(116) },
        { "TRACE_EVENT_PHASE_FLOW_END", static_cast<double>(102) },
        { "TRACE_EVENT_PHASE_METADATA", static_cast<double>(77) },
        { "TRACE_EVENT_PHASE_COUNTER", static_cast<double>(67) },
        { "TRACE_EVENT_PHASE_SAMPLE", static_cast<double>(80) },
        { "TRACE_EVENT_PHASE_CREATE_OBJECT", static_cast<double>(78) },
        { "TRACE_EVENT_PHASE_SNAPSHOT_OBJECT", static_cast<double>(79) },
        { "TRACE_EVENT_PHASE_DELETE_OBJECT", static_cast<double>(68) },
        { "TRACE_EVENT_PHASE_MEMORY_DUMP", static_cast<double>(118) },
        { "TRACE_EVENT_PHASE_MARK", static_cast<double>(82) },
        { "TRACE_EVENT_PHASE_CLOCK_SYNC", static_cast<double>(99) },
        { "TRACE_EVENT_PHASE_ENTER_CONTEXT", static_cast<double>(40) },
        { "TRACE_EVENT_PHASE_LEAVE_CONTEXT", static_cast<double>(41) },
        { "TRACE_EVENT_PHASE_LINK_IDS", static_cast<double>(61) },
        { nullptr, 0 },
    };
    putNumericConstants(vm, object, kConstants6);
    return object;
}

static JSValue processBindingConstantsGetFs(VM& vm, JSObject* bindingObject)
{
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    static constexpr NumericConstant kConstants7[] = {
        { "UV_FS_SYMLINK_DIR", static_cast<double>(1) },
        { "UV_FS_SYMLINK_JUNCTION", static_cast<double>(2) },
        { "O_RDONLY", static_cast<double>(O_RDONLY) },
        { "O_WRONLY", static_cast<double>(O_WRONLY) },
        { "O_RDWR", static_cast<double>(O_RDWR) },
        { "UV_DIRENT_UNKNOWN", static_cast<double>(0) },
        { "UV_DIRENT_FILE", static_cast<double>(1) },
        { "UV_DIRENT_DIR", static_cast<double>(2) },
        { "UV_DIRENT_LINK", static_cast<double>(3) },
        { "UV_DIRENT_FIFO", static_cast<double>(4) },
        { "UV_DIRENT_SOCKET", static_cast<double>(5) },
        { "UV_DIRENT_CHAR", static_cast<double>(6) },
        { "UV_DIRENT_BLOCK", static_cast<double>(7) },
        { "S_IFMT", static_cast<double>(S_IFMT) },
        { "S_IFREG", static_cast<double>(S_IFREG) },
        { "S_IFDIR", static_cast<double>(S_IFDIR) },
        { "S_IFCHR", static_cast<double>(S_IFCHR) },
#ifdef S_IFBLK
        { "S_IFBLK", static_cast<double>(S_IFBLK) },
#endif
#ifdef S_IFIFO
        { "S_IFIFO", static_cast<double>(S_IFIFO) },
#endif
#ifdef S_IFLNK
        { "S_IFLNK", static_cast<double>(S_IFLNK) },
#endif
#ifdef S_IFSOCK
        { "S_IFSOCK", static_cast<double>(S_IFSOCK) },
#endif
#ifdef O_CREAT
        { "O_CREAT", static_cast<double>(O_CREAT) },
#endif
#ifdef O_EXCL
        { "O_EXCL", static_cast<double>(O_EXCL) },
#endif
#if OS(WINDOWS)
        { "UV_FS_O_FILEMAP", static_cast<double>(536870912) },
#else
        { "UV_FS_O_FILEMAP", static_cast<double>(0) },
#endif
#ifdef O_NOCTTY
        { "O_NOCTTY", static_cast<double>(O_NOCTTY) },
#endif
#ifdef O_TRUNC
        { "O_TRUNC", static_cast<double>(O_TRUNC) },
#endif
#ifdef O_APPEND
        { "O_APPEND", static_cast<double>(O_APPEND) },
#endif
#ifdef O_DIRECTORY
        { "O_DIRECTORY", static_cast<double>(O_DIRECTORY) },
#endif
#ifdef O_NOATIME
        { "O_NOATIME", static_cast<double>(O_NOATIME) },
#endif
#ifdef O_NOFOLLOW
        { "O_NOFOLLOW", static_cast<double>(O_NOFOLLOW) },
#endif
#ifdef O_SYNC
        { "O_SYNC", static_cast<double>(O_SYNC) },
#endif
#ifdef O_DSYNC
        { "O_DSYNC", static_cast<double>(O_DSYNC) },
#endif
#ifdef O_SYMLINK
        { "O_SYMLINK", static_cast<double>(O_SYMLINK) },
#endif
#ifdef O_DIRECT
        { "O_DIRECT", static_cast<double>(O_DIRECT) },
#endif
#ifdef O_NONBLOCK
        { "O_NONBLOCK", static_cast<double>(O_NONBLOCK) },
#endif
#ifdef S_IRWXU
        { "S_IRWXU", static_cast<double>(S_IRWXU) },
#endif
#ifdef S_IRUSR
        { "S_IRUSR", static_cast<double>(S_IRUSR) },
#endif
#ifdef S_IWUSR
        { "S_IWUSR", static_cast<double>(S_IWUSR) },
#endif
#ifdef S_IXUSR
        { "S_IXUSR", static_cast<double>(S_IXUSR) },
#endif
#ifdef S_IRWXG
        { "S_IRWXG", static_cast<double>(S_IRWXG) },
#endif
#ifdef S_IRGRP
        { "S_IRGRP", static_cast<double>(S_IRGRP) },
#endif
#ifdef S_IWGRP
        { "S_IWGRP", static_cast<double>(S_IWGRP) },
#endif
#ifdef S_IXGRP
        { "S_IXGRP", static_cast<double>(S_IXGRP) },
#endif
#ifdef S_IRWXO
        { "S_IRWXO", static_cast<double>(S_IRWXO) },
#endif
#ifdef S_IROTH
        { "S_IROTH", static_cast<double>(S_IROTH) },
#endif
#ifdef S_IWOTH
        { "S_IWOTH", static_cast<double>(S_IWOTH) },
#endif
#ifdef S_IXOTH
        { "S_IXOTH", static_cast<double>(S_IXOTH) },
#endif
#ifdef F_OK
        { "F_OK", static_cast<double>(F_OK) },
#endif
#ifdef R_OK
        { "R_OK", static_cast<double>(R_OK) },
#endif
#ifdef W_OK
        { "W_OK", static_cast<double>(W_OK) },
#endif
#ifdef X_OK
        { "X_OK", static_cast<double>(X_OK) },
#endif
        { "UV_FS_COPYFILE_EXCL", static_cast<double>(1) },
        { "COPYFILE_EXCL", static_cast<double>(1) },
        { "UV_FS_COPYFILE_FICLONE", static_cast<double>(2) },
        { "COPYFILE_FICLONE", static_cast<double>(2) },
        { "UV_FS_COPYFILE_FICLONE_FORCE", static_cast<double>(4) },
        { "COPYFILE_FICLONE_FORCE", static_cast<double>(4) },
        { "EXTENSIONLESS_FORMAT_JAVASCRIPT", static_cast<double>(0) },
        { "EXTENSIONLESS_FORMAT_WASM", static_cast<double>(1) },
        { nullptr, 0 },
    };
    putNumericConstants(vm, object, kConstants7);

    return object;
}

static JSValue processBindingConstantsGetCrypto(VM& vm, JSObject* bindingObject)
{
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    static constexpr NumericConstant kConstants8[] = {
#ifdef OPENSSL_VERSION_NUMBER
        { "OPENSSL_VERSION_NUMBER", static_cast<double>(OPENSSL_VERSION_NUMBER) },
#endif
#ifdef SSL_OP_ALL
        { "SSL_OP_ALL", static_cast<double>(SSL_OP_ALL) },
#endif
#ifdef SSL_OP_ALLOW_NO_DHE_KEX
        { "SSL_OP_ALLOW_NO_DHE_KEX", static_cast<double>(SSL_OP_ALLOW_NO_DHE_KEX) },
#else
        { "SSL_OP_ALLOW_NO_DHE_KEX", static_cast<double>(0) },
#endif
#ifdef SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION
        { "SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION", static_cast<double>(SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION) },
#endif
#ifdef SSL_OP_CIPHER_SERVER_PREFERENCE
        { "SSL_OP_CIPHER_SERVER_PREFERENCE", static_cast<double>(SSL_OP_CIPHER_SERVER_PREFERENCE) },
#endif
#ifdef SSL_OP_CISCO_ANYCONNECT
        { "SSL_OP_CISCO_ANYCONNECT", static_cast<double>(SSL_OP_CISCO_ANYCONNECT) },
#else
        { "SSL_OP_CISCO_ANYCONNECT", static_cast<double>(0) },
#endif
#ifdef SSL_OP_COOKIE_EXCHANGE
        { "SSL_OP_COOKIE_EXCHANGE", static_cast<double>(SSL_OP_COOKIE_EXCHANGE) },
#else
        { "SSL_OP_COOKIE_EXCHANGE", static_cast<double>(0) },
#endif
#ifdef SSL_OP_CRYPTOPRO_TLSEXT_BUG
        { "SSL_OP_CRYPTOPRO_TLSEXT_BUG", static_cast<double>(SSL_OP_CRYPTOPRO_TLSEXT_BUG) },
#else
        { "SSL_OP_CRYPTOPRO_TLSEXT_BUG", static_cast<double>(0) },
#endif
#ifdef SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS
        { "SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS", static_cast<double>(SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS) },
#endif
#ifdef SSL_OP_LEGACY_SERVER_CONNECT
        { "SSL_OP_LEGACY_SERVER_CONNECT", static_cast<double>(SSL_OP_LEGACY_SERVER_CONNECT) },
#endif
#ifdef SSL_OP_NO_COMPRESSION
        { "SSL_OP_NO_COMPRESSION", static_cast<double>(SSL_OP_NO_COMPRESSION) },
#endif
#ifdef SSL_OP_NO_ENCRYPT_THEN_MAC
        { "SSL_OP_NO_ENCRYPT_THEN_MAC", static_cast<double>(SSL_OP_NO_ENCRYPT_THEN_MAC) },
#else
        { "SSL_OP_NO_ENCRYPT_THEN_MAC", static_cast<double>(0) },
#endif
#ifdef SSL_OP_NO_QUERY_MTU
        { "SSL_OP_NO_QUERY_MTU", static_cast<double>(SSL_OP_NO_QUERY_MTU) },
#endif
#ifdef SSL_OP_NO_RENEGOTIATION
        { "SSL_OP_NO_RENEGOTIATION", static_cast<double>(SSL_OP_NO_RENEGOTIATION) },
#endif
#ifdef SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION
        { "SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION", static_cast<double>(SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION) },
#endif
#ifdef SSL_OP_NO_SSLv2
        { "SSL_OP_NO_SSLv2", static_cast<double>(SSL_OP_NO_SSLv2) },
#endif
#ifdef SSL_OP_NO_SSLv3
        { "SSL_OP_NO_SSLv3", static_cast<double>(SSL_OP_NO_SSLv3) },
#endif
#ifdef SSL_OP_NO_TICKET
        { "SSL_OP_NO_TICKET", static_cast<double>(SSL_OP_NO_TICKET) },
#endif
#ifdef SSL_OP_NO_TLSv1
        { "SSL_OP_NO_TLSv1", static_cast<double>(SSL_OP_NO_TLSv1) },
#endif
#ifdef SSL_OP_NO_TLSv1_1
        { "SSL_OP_NO_TLSv1_1", static_cast<double>(SSL_OP_NO_TLSv1_1) },
#endif
#ifdef SSL_OP_NO_TLSv1_2
        { "SSL_OP_NO_TLSv1_2", static_cast<double>(SSL_OP_NO_TLSv1_2) },
#endif
#ifdef SSL_OP_NO_TLSv1_3
        { "SSL_OP_NO_TLSv1_3", static_cast<double>(SSL_OP_NO_TLSv1_3) },
#endif
#ifdef SSL_OP_PRIORITIZE_CHACHA
        { "SSL_OP_PRIORITIZE_CHACHA", static_cast<double>(SSL_OP_PRIORITIZE_CHACHA) },
#else
        { "SSL_OP_PRIORITIZE_CHACHA", static_cast<double>(0) },
#endif
#ifdef SSL_OP_TLS_ROLLBACK_BUG
        { "SSL_OP_TLS_ROLLBACK_BUG", static_cast<double>(SSL_OP_TLS_ROLLBACK_BUG) },
#endif
        { nullptr, 0 },
    };
    putNumericConstants(vm, object, kConstants8);
    // OBSOLETE OPTIONS retained for compatibility
    static constexpr NumericConstant kConstants9[] = {
        { "SSL_OP_MICROSOFT_SESS_ID_BUG", static_cast<double>(0) },
        { "SSL_OP_NETSCAPE_CHALLENGE_BUG", static_cast<double>(0) },
        { "SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG", static_cast<double>(0) },
        { "SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG", static_cast<double>(0) },
        { "SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER", static_cast<double>(0) },
        { "SSL_OP_MSIE_SSLV2_RSA_PADDING", static_cast<double>(0) },
        { "SSL_OP_SSLEAY_080_CLIENT_DH_BUG", static_cast<double>(0) },
        { "SSL_OP_TLS_D5_BUG", static_cast<double>(0) },
        { "SSL_OP_TLS_BLOCK_PADDING_BUG", static_cast<double>(0) },
        { "SSL_OP_SINGLE_ECDH_USE", static_cast<double>(0) },
        { "SSL_OP_SINGLE_DH_USE", static_cast<double>(0) },
        { "SSL_OP_EPHEMERAL_RSA", static_cast<double>(0) },
        { "SSL_OP_NO_SSLv2", static_cast<double>(0) },
        { "SSL_OP_PKCS1_CHECK_1", static_cast<double>(0) },
        { "SSL_OP_PKCS1_CHECK_2", static_cast<double>(0) },
        { "SSL_OP_NETSCAPE_CA_DN_BUG", static_cast<double>(0) },
        { "SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG", static_cast<double>(0) },
        { nullptr, 0 },
    };
    putNumericConstants(vm, object, kConstants9);
    // BoringSSL does not define engine constants in openssl/engine.h
    static constexpr NumericConstant kConstants10[] = {
        { "ENGINE_METHOD_RSA", static_cast<double>(0x0001) },
        { "ENGINE_METHOD_DSA", static_cast<double>(0x0002) },
        { "ENGINE_METHOD_DH", static_cast<double>(0x0004) },
        { "ENGINE_METHOD_RAND", static_cast<double>(0x0008) },
        { "ENGINE_METHOD_CIPHERS", static_cast<double>(0x0040) },
        { "ENGINE_METHOD_DIGESTS", static_cast<double>(0x0080) },
        { "ENGINE_METHOD_PKEY_METHS", static_cast<double>(0x0200) },
        { "ENGINE_METHOD_PKEY_ASN1_METHS", static_cast<double>(0x0400) },
        { "ENGINE_METHOD_EC", static_cast<double>(0x0800) },
        { "ENGINE_METHOD_ALL", static_cast<double>(0xFFFF) },
        { "ENGINE_METHOD_NONE", static_cast<double>(0x0000) },
#ifdef DH_CHECK_P_NOT_SAFE_PRIME
        { "DH_CHECK_P_NOT_SAFE_PRIME", static_cast<double>(DH_CHECK_P_NOT_SAFE_PRIME) },
#endif
#ifdef DH_CHECK_P_NOT_PRIME
        { "DH_CHECK_P_NOT_PRIME", static_cast<double>(DH_CHECK_P_NOT_PRIME) },
#endif
#ifdef DH_UNABLE_TO_CHECK_GENERATOR
        { "DH_UNABLE_TO_CHECK_GENERATOR", static_cast<double>(DH_UNABLE_TO_CHECK_GENERATOR) },
#endif
#ifdef DH_NOT_SUITABLE_GENERATOR
        { "DH_NOT_SUITABLE_GENERATOR", static_cast<double>(DH_NOT_SUITABLE_GENERATOR) },
#endif
#ifdef RSA_PKCS1_PADDING
        { "RSA_PKCS1_PADDING", static_cast<double>(RSA_PKCS1_PADDING) },
#endif
#ifdef RSA_SSLV23_PADDING
        { "RSA_SSLV23_PADDING", static_cast<double>(RSA_SSLV23_PADDING) },
#endif
#ifdef RSA_NO_PADDING
        { "RSA_NO_PADDING", static_cast<double>(RSA_NO_PADDING) },
#endif
#ifdef RSA_PKCS1_OAEP_PADDING
        { "RSA_PKCS1_OAEP_PADDING", static_cast<double>(RSA_PKCS1_OAEP_PADDING) },
#endif
#ifdef RSA_X931_PADDING
        { "RSA_X931_PADDING", static_cast<double>(RSA_X931_PADDING) },
#else
        { "RSA_X931_PADDING", static_cast<double>(5) },
#endif
#ifdef RSA_PKCS1_PSS_PADDING
        { "RSA_PKCS1_PSS_PADDING", static_cast<double>(RSA_PKCS1_PSS_PADDING) },
#endif
#ifdef RSA_PSS_SALTLEN_DIGEST
        { "RSA_PSS_SALTLEN_DIGEST", static_cast<double>(RSA_PSS_SALTLEN_DIGEST) },
#else
        { "RSA_PSS_SALTLEN_DIGEST", static_cast<double>(-1) },
#endif
#ifdef RSA_PSS_SALTLEN_MAX_SIGN
        { "RSA_PSS_SALTLEN_MAX_SIGN", static_cast<double>(RSA_PSS_SALTLEN_MAX_SIGN) },
#else
        { "RSA_PSS_SALTLEN_MAX_SIGN", static_cast<double>(-2) },
#endif
#ifdef RSA_PSS_SALTLEN_AUTO
        { "RSA_PSS_SALTLEN_AUTO", static_cast<double>(RSA_PSS_SALTLEN_AUTO) },
#else
        { "RSA_PSS_SALTLEN_AUTO", static_cast<double>(-2) },
#endif
        { nullptr, 0 },
    };
    putNumericConstants(vm, object, kConstants10);
    auto cipherList = String("TLS_AES_256_GCM_SHA384:"
                             "TLS_CHACHA20_POLY1305_SHA256:"
                             "TLS_AES_128_GCM_SHA256:"
                             "ECDHE-RSA-AES128-GCM-SHA256:"
                             "ECDHE-ECDSA-AES128-GCM-SHA256:"
                             "ECDHE-RSA-AES256-GCM-SHA384:"
                             "ECDHE-ECDSA-AES256-GCM-SHA384:"
                             "DHE-RSA-AES128-GCM-SHA256:"
                             "ECDHE-RSA-AES128-SHA256:"
                             "DHE-RSA-AES128-SHA256:"
                             "ECDHE-RSA-AES256-SHA384:"
                             "DHE-RSA-AES256-SHA384:"
                             "ECDHE-RSA-AES256-SHA256:"
                             "DHE-RSA-AES256-SHA256:"
                             "HIGH:"
                             "!aNULL:"
                             "!eNULL:"
                             "!EXPORT:"
                             "!DES:"
                             "!RC4:"
                             "!MD5:"
                             "!PSK:"
                             "!SRP:"
                             "!CAMELLIA"_s);
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "defaultCoreCipherList"_s)),
        jsString(vm, cipherList));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "defaultCipherList"_s)),
        jsString(vm, cipherList));
    static constexpr NumericConstant kConstants11[] = {
        { "TLS1_VERSION", static_cast<double>(TLS1_VERSION) },
        { "TLS1_1_VERSION", static_cast<double>(TLS1_1_VERSION) },
        { "TLS1_2_VERSION", static_cast<double>(TLS1_2_VERSION) },
        { "TLS1_3_VERSION", static_cast<double>(TLS1_3_VERSION) },
        { "POINT_CONVERSION_COMPRESSED", static_cast<double>(POINT_CONVERSION_COMPRESSED) },
        { "POINT_CONVERSION_UNCOMPRESSED", static_cast<double>(POINT_CONVERSION_UNCOMPRESSED) },
        { "POINT_CONVERSION_HYBRID", static_cast<double>(POINT_CONVERSION_HYBRID) },
        { nullptr, 0 },
    };
    putNumericConstants(vm, object, kConstants11);
    return object;
}

static JSValue processBindingConstantsGetZlib(VM& vm, JSObject* bindingObject)
{
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    static constexpr NumericConstant kConstants12[] = {
        { "Z_NO_FLUSH", static_cast<double>(Z_NO_FLUSH) },
        { "Z_PARTIAL_FLUSH", static_cast<double>(Z_PARTIAL_FLUSH) },
        { "Z_SYNC_FLUSH", static_cast<double>(Z_SYNC_FLUSH) },
        { "Z_FULL_FLUSH", static_cast<double>(Z_FULL_FLUSH) },
        { "Z_FINISH", static_cast<double>(Z_FINISH) },
        { "Z_BLOCK", static_cast<double>(Z_BLOCK) },
        { "Z_OK", static_cast<double>(Z_OK) },
        { "Z_STREAM_END", static_cast<double>(Z_STREAM_END) },
        { "Z_NEED_DICT", static_cast<double>(Z_NEED_DICT) },
        { "Z_ERRNO", static_cast<double>(Z_ERRNO) },
        { "Z_STREAM_ERROR", static_cast<double>(Z_STREAM_ERROR) },
        { "Z_DATA_ERROR", static_cast<double>(Z_DATA_ERROR) },
        { "Z_MEM_ERROR", static_cast<double>(Z_MEM_ERROR) },
        { "Z_BUF_ERROR", static_cast<double>(Z_BUF_ERROR) },
        { "Z_VERSION_ERROR", static_cast<double>(Z_VERSION_ERROR) },
        { "Z_NO_COMPRESSION", static_cast<double>(Z_NO_COMPRESSION) },
        { "Z_BEST_SPEED", static_cast<double>(Z_BEST_SPEED) },
        { "Z_BEST_COMPRESSION", static_cast<double>(Z_BEST_COMPRESSION) },
        { "Z_DEFAULT_COMPRESSION", static_cast<double>(Z_DEFAULT_COMPRESSION) },
        { "Z_FILTERED", static_cast<double>(Z_FILTERED) },
        { "Z_HUFFMAN_ONLY", static_cast<double>(Z_HUFFMAN_ONLY) },
        { "Z_RLE", static_cast<double>(Z_RLE) },
        { "Z_FIXED", static_cast<double>(Z_FIXED) },
        { "Z_DEFAULT_STRATEGY", static_cast<double>(Z_DEFAULT_STRATEGY) },
        { "ZLIB_VERNUM", static_cast<double>(ZLIB_VERNUM) },
        { "DEFLATE", static_cast<double>(1) },
        { "INFLATE", static_cast<double>(2) },
        { "GZIP", static_cast<double>(3) },
        { "GUNZIP", static_cast<double>(4) },
        { "DEFLATERAW", static_cast<double>(5) },
        { "INFLATERAW", static_cast<double>(6) },
        { "UNZIP", static_cast<double>(7) },
        { "BROTLI_DECODE", static_cast<double>(8) },
        { "BROTLI_ENCODE", static_cast<double>(9) },
        { "ZSTD_COMPRESS", static_cast<double>(10) },
        { "ZSTD_DECOMPRESS", static_cast<double>(11) },
        { "Z_MIN_WINDOWBITS", static_cast<double>(8) },
        { "Z_MAX_WINDOWBITS", static_cast<double>(15) },
        { "Z_DEFAULT_WINDOWBITS", static_cast<double>(15) },
        { "Z_MIN_CHUNK", static_cast<double>(64) },
        { "Z_MAX_CHUNK", static_cast<double>(std::numeric_limits<double>::infinity()) },
        { "Z_DEFAULT_CHUNK", static_cast<double>(16 * 1024) },
        { "Z_MIN_MEMLEVEL", static_cast<double>(1) },
        { "Z_MAX_MEMLEVEL", static_cast<double>(9) },
        { "Z_DEFAULT_MEMLEVEL", static_cast<double>(8) },
        { "Z_MIN_LEVEL", static_cast<double>(-1) },
        { "Z_MAX_LEVEL", static_cast<double>(9) },
        { "Z_DEFAULT_LEVEL", static_cast<double>(Z_DEFAULT_COMPRESSION) },
        { "BROTLI_OPERATION_PROCESS", static_cast<double>(BROTLI_OPERATION_PROCESS) },
        { "BROTLI_OPERATION_FLUSH", static_cast<double>(BROTLI_OPERATION_FLUSH) },
        { "BROTLI_OPERATION_FINISH", static_cast<double>(BROTLI_OPERATION_FINISH) },
        { "BROTLI_OPERATION_EMIT_METADATA", static_cast<double>(BROTLI_OPERATION_EMIT_METADATA) },
        { "BROTLI_PARAM_MODE", static_cast<double>(BROTLI_PARAM_MODE) },
        { "BROTLI_MODE_GENERIC", static_cast<double>(BROTLI_MODE_GENERIC) },
        { "BROTLI_MODE_TEXT", static_cast<double>(BROTLI_MODE_TEXT) },
        { "BROTLI_MODE_FONT", static_cast<double>(BROTLI_MODE_FONT) },
        { "BROTLI_DEFAULT_MODE", static_cast<double>(BROTLI_DEFAULT_MODE) },
        { "BROTLI_PARAM_QUALITY", static_cast<double>(BROTLI_PARAM_QUALITY) },
        { "BROTLI_MIN_QUALITY", static_cast<double>(BROTLI_MIN_QUALITY) },
        { "BROTLI_MAX_QUALITY", static_cast<double>(BROTLI_MAX_QUALITY) },
        { "BROTLI_DEFAULT_QUALITY", static_cast<double>(BROTLI_DEFAULT_QUALITY) },
        { "BROTLI_PARAM_LGWIN", static_cast<double>(BROTLI_PARAM_LGWIN) },
        { "BROTLI_MIN_WINDOW_BITS", static_cast<double>(BROTLI_MIN_WINDOW_BITS) },
        { "BROTLI_MAX_WINDOW_BITS", static_cast<double>(BROTLI_MAX_WINDOW_BITS) },
        { "BROTLI_LARGE_MAX_WINDOW_BITS", static_cast<double>(BROTLI_LARGE_MAX_WINDOW_BITS) },
        { "BROTLI_DEFAULT_WINDOW", static_cast<double>(BROTLI_DEFAULT_WINDOW) },
        { "BROTLI_PARAM_LGBLOCK", static_cast<double>(BROTLI_PARAM_LGBLOCK) },
        { "BROTLI_MIN_INPUT_BLOCK_BITS", static_cast<double>(BROTLI_MIN_INPUT_BLOCK_BITS) },
        { "BROTLI_MAX_INPUT_BLOCK_BITS", static_cast<double>(BROTLI_MAX_INPUT_BLOCK_BITS) },
        { "BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING", static_cast<double>(BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING) },
        { "BROTLI_PARAM_SIZE_HINT", static_cast<double>(BROTLI_PARAM_SIZE_HINT) },
        { "BROTLI_PARAM_LARGE_WINDOW", static_cast<double>(BROTLI_PARAM_LARGE_WINDOW) },
        { "BROTLI_PARAM_NPOSTFIX", static_cast<double>(BROTLI_PARAM_NPOSTFIX) },
        { "BROTLI_PARAM_NDIRECT", static_cast<double>(BROTLI_PARAM_NDIRECT) },
        { "BROTLI_DECODER_RESULT_ERROR", static_cast<double>(BROTLI_DECODER_RESULT_ERROR) },
        { "BROTLI_DECODER_RESULT_SUCCESS", static_cast<double>(BROTLI_DECODER_RESULT_SUCCESS) },
        { "BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT", static_cast<double>(BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT) },
        { "BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT", static_cast<double>(BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT) },
        { "BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION", static_cast<double>(BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION) },
        { "BROTLI_DECODER_PARAM_LARGE_WINDOW", static_cast<double>(BROTLI_DECODER_PARAM_LARGE_WINDOW) },
        { "BROTLI_DECODER_NO_ERROR", static_cast<double>(BROTLI_DECODER_NO_ERROR) },
        { "BROTLI_DECODER_SUCCESS", static_cast<double>(BROTLI_DECODER_SUCCESS) },
        { "BROTLI_DECODER_NEEDS_MORE_INPUT", static_cast<double>(BROTLI_DECODER_NEEDS_MORE_INPUT) },
        { "BROTLI_DECODER_NEEDS_MORE_OUTPUT", static_cast<double>(BROTLI_DECODER_NEEDS_MORE_OUTPUT) },
        { "BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE) },
        { "BROTLI_DECODER_ERROR_FORMAT_RESERVED", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_RESERVED) },
        { "BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE) },
        { "BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET) },
        { "BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME) },
        { "BROTLI_DECODER_ERROR_FORMAT_CL_SPACE", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_CL_SPACE) },
        { "BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE) },
        { "BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT) },
        { "BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1) },
        { "BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2) },
        { "BROTLI_DECODER_ERROR_FORMAT_TRANSFORM", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_TRANSFORM) },
        { "BROTLI_DECODER_ERROR_FORMAT_DICTIONARY", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_DICTIONARY) },
        { "BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS) },
        { "BROTLI_DECODER_ERROR_FORMAT_PADDING_1", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_PADDING_1) },
        { "BROTLI_DECODER_ERROR_FORMAT_PADDING_2", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_PADDING_2) },
        { "BROTLI_DECODER_ERROR_FORMAT_DISTANCE", static_cast<double>(BROTLI_DECODER_ERROR_FORMAT_DISTANCE) },
        { "BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET", static_cast<double>(BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET) },
        { "BROTLI_DECODER_ERROR_INVALID_ARGUMENTS", static_cast<double>(BROTLI_DECODER_ERROR_INVALID_ARGUMENTS) },
        { "BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES", static_cast<double>(BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES) },
        { "BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS", static_cast<double>(BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS) },
        { "BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP", static_cast<double>(BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP) },
        { "BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1", static_cast<double>(BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1) },
        { "BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2", static_cast<double>(BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2) },
        { "BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES", static_cast<double>(BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES) },
        { "BROTLI_DECODER_ERROR_UNREACHABLE", static_cast<double>(BROTLI_DECODER_ERROR_UNREACHABLE) },
        { "ZSTD_e_continue", static_cast<double>(ZSTD_e_continue) },
        { "ZSTD_e_flush", static_cast<double>(ZSTD_e_flush) },
        { "ZSTD_e_end", static_cast<double>(ZSTD_e_end) },
        { "ZSTD_fast", static_cast<double>(ZSTD_fast) },
        { "ZSTD_dfast", static_cast<double>(ZSTD_dfast) },
        { "ZSTD_greedy", static_cast<double>(ZSTD_greedy) },
        { "ZSTD_lazy", static_cast<double>(ZSTD_lazy) },
        { "ZSTD_lazy2", static_cast<double>(ZSTD_lazy2) },
        { "ZSTD_btlazy2", static_cast<double>(ZSTD_btlazy2) },
        { "ZSTD_btopt", static_cast<double>(ZSTD_btopt) },
        { "ZSTD_btultra", static_cast<double>(ZSTD_btultra) },
        { "ZSTD_btultra2", static_cast<double>(ZSTD_btultra2) },
        { "ZSTD_c_compressionLevel", static_cast<double>(ZSTD_c_compressionLevel) },
        { "ZSTD_c_windowLog", static_cast<double>(ZSTD_c_windowLog) },
        { "ZSTD_c_hashLog", static_cast<double>(ZSTD_c_hashLog) },
        { "ZSTD_c_chainLog", static_cast<double>(ZSTD_c_chainLog) },
        { "ZSTD_c_searchLog", static_cast<double>(ZSTD_c_searchLog) },
        { "ZSTD_c_minMatch", static_cast<double>(ZSTD_c_minMatch) },
        { "ZSTD_c_targetLength", static_cast<double>(ZSTD_c_targetLength) },
        { "ZSTD_c_strategy", static_cast<double>(ZSTD_c_strategy) },
        { "ZSTD_c_enableLongDistanceMatching", static_cast<double>(ZSTD_c_enableLongDistanceMatching) },
        { "ZSTD_c_ldmHashLog", static_cast<double>(ZSTD_c_ldmHashLog) },
        { "ZSTD_c_ldmMinMatch", static_cast<double>(ZSTD_c_ldmMinMatch) },
        { "ZSTD_c_ldmBucketSizeLog", static_cast<double>(ZSTD_c_ldmBucketSizeLog) },
        { "ZSTD_c_ldmHashRateLog", static_cast<double>(ZSTD_c_ldmHashRateLog) },
        { "ZSTD_c_contentSizeFlag", static_cast<double>(ZSTD_c_contentSizeFlag) },
        { "ZSTD_c_checksumFlag", static_cast<double>(ZSTD_c_checksumFlag) },
        { "ZSTD_c_dictIDFlag", static_cast<double>(ZSTD_c_dictIDFlag) },
        { "ZSTD_c_nbWorkers", static_cast<double>(ZSTD_c_nbWorkers) },
        { "ZSTD_c_jobSize", static_cast<double>(ZSTD_c_jobSize) },
        { "ZSTD_c_overlapLog", static_cast<double>(ZSTD_c_overlapLog) },
        { "ZSTD_d_windowLogMax", static_cast<double>(ZSTD_d_windowLogMax) },
        { "ZSTD_CLEVEL_DEFAULT", static_cast<double>(ZSTD_CLEVEL_DEFAULT) },
        { "ZSTD_error_no_error", static_cast<double>(ZSTD_error_no_error) },
        { "ZSTD_error_GENERIC", static_cast<double>(ZSTD_error_GENERIC) },
        { "ZSTD_error_prefix_unknown", static_cast<double>(ZSTD_error_prefix_unknown) },
        { "ZSTD_error_version_unsupported", static_cast<double>(ZSTD_error_version_unsupported) },
        { "ZSTD_error_frameParameter_unsupported", static_cast<double>(ZSTD_error_frameParameter_unsupported) },
        { "ZSTD_error_frameParameter_windowTooLarge", static_cast<double>(ZSTD_error_frameParameter_windowTooLarge) },
        { "ZSTD_error_corruption_detected", static_cast<double>(ZSTD_error_corruption_detected) },
        { "ZSTD_error_checksum_wrong", static_cast<double>(ZSTD_error_checksum_wrong) },
        { "ZSTD_error_literals_headerWrong", static_cast<double>(ZSTD_error_literals_headerWrong) },
        { "ZSTD_error_dictionary_corrupted", static_cast<double>(ZSTD_error_dictionary_corrupted) },
        { "ZSTD_error_dictionary_wrong", static_cast<double>(ZSTD_error_dictionary_wrong) },
        { "ZSTD_error_dictionaryCreation_failed", static_cast<double>(ZSTD_error_dictionaryCreation_failed) },
        { "ZSTD_error_parameter_unsupported", static_cast<double>(ZSTD_error_parameter_unsupported) },
        { "ZSTD_error_parameter_combination_unsupported", static_cast<double>(ZSTD_error_parameter_combination_unsupported) },
        { "ZSTD_error_parameter_outOfBound", static_cast<double>(ZSTD_error_parameter_outOfBound) },
        { "ZSTD_error_tableLog_tooLarge", static_cast<double>(ZSTD_error_tableLog_tooLarge) },
        { "ZSTD_error_maxSymbolValue_tooLarge", static_cast<double>(ZSTD_error_maxSymbolValue_tooLarge) },
        { "ZSTD_error_maxSymbolValue_tooSmall", static_cast<double>(ZSTD_error_maxSymbolValue_tooSmall) },
        { "ZSTD_error_stabilityCondition_notRespected", static_cast<double>(ZSTD_error_stabilityCondition_notRespected) },
        { "ZSTD_error_stage_wrong", static_cast<double>(ZSTD_error_stage_wrong) },
        { "ZSTD_error_init_missing", static_cast<double>(ZSTD_error_init_missing) },
        { "ZSTD_error_memory_allocation", static_cast<double>(ZSTD_error_memory_allocation) },
        { "ZSTD_error_workSpace_tooSmall", static_cast<double>(ZSTD_error_workSpace_tooSmall) },
        { "ZSTD_error_dstSize_tooSmall", static_cast<double>(ZSTD_error_dstSize_tooSmall) },
        { "ZSTD_error_srcSize_wrong", static_cast<double>(ZSTD_error_srcSize_wrong) },
        { "ZSTD_error_dstBuffer_null", static_cast<double>(ZSTD_error_dstBuffer_null) },
        { "ZSTD_error_noForwardProgress_destFull", static_cast<double>(ZSTD_error_noForwardProgress_destFull) },
        { "ZSTD_error_noForwardProgress_inputEmpty", static_cast<double>(ZSTD_error_noForwardProgress_inputEmpty) },
        { nullptr, 0 },
    };
    putNumericConstants(vm, object, kConstants12);

    return object;
}

/* Source for ProcessBindingConstants.lut.h
@begin processBindingConstantsTable
    os             processBindingConstantsGetOs                PropertyCallback
    fs             processBindingConstantsGetFs                PropertyCallback
    crypto         processBindingConstantsGetCrypto            PropertyCallback
    zlib           processBindingConstantsGetZlib              PropertyCallback
    trace          processBindingConstantsGetTrace             PropertyCallback
@end
*/
#include "ProcessBindingConstants.lut.h"

const ClassInfo ProcessBindingConstants::s_info = { "ProcessBindingConstants"_s, &Base::s_info, &processBindingConstantsTable, nullptr, CREATE_METHOD_TABLE(ProcessBindingConstants) };

ProcessBindingConstants* ProcessBindingConstants::create(VM& vm, Structure* structure)
{
    ProcessBindingConstants* obj = new (NotNull, allocateCell<ProcessBindingConstants>(vm)) ProcessBindingConstants(vm, structure);
    obj->finishCreation(vm);
    return obj;
}

Structure* ProcessBindingConstants::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), ProcessBindingConstants::info());
}

void ProcessBindingConstants::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

template<typename Visitor>
void ProcessBindingConstants::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ProcessBindingConstants* thisObject = uncheckedDowncast<ProcessBindingConstants>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(ProcessBindingConstants);

} // namespace Bun
