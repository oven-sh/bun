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

struct ConstantEntry {
    ASCIILiteral name;
    double value;
};

static NEVER_INLINE void putConstants(VM& vm, JSObject* object, std::span<const ConstantEntry> entries)
{
    for (const auto& entry : entries)
        object->putDirect(vm, Identifier::fromString(vm, entry.name), jsNumber(entry.value));
}

static JSValue processBindingConstantsGetOs(VM& vm, JSObject* bindingObject)
{
    static constexpr ConstantEntry errnoConstants[] = {
#ifdef E2BIG
        { "E2BIG"_s, E2BIG },
#endif
#ifdef EACCES
        { "EACCES"_s, EACCES },
#endif
#ifdef EADDRINUSE
        { "EADDRINUSE"_s, EADDRINUSE },
#endif
#ifdef EADDRNOTAVAIL
        { "EADDRNOTAVAIL"_s, EADDRNOTAVAIL },
#endif
#ifdef EAFNOSUPPORT
        { "EAFNOSUPPORT"_s, EAFNOSUPPORT },
#endif
#ifdef EAGAIN
        { "EAGAIN"_s, EAGAIN },
#endif
#ifdef EALREADY
        { "EALREADY"_s, EALREADY },
#endif
#ifdef EBADF
        { "EBADF"_s, EBADF },
#endif
#ifdef EBADMSG
        { "EBADMSG"_s, EBADMSG },
#endif
#ifdef EBUSY
        { "EBUSY"_s, EBUSY },
#endif
#ifdef ECANCELED
        { "ECANCELED"_s, ECANCELED },
#endif
#ifdef ECHILD
        { "ECHILD"_s, ECHILD },
#endif
#ifdef ECONNABORTED
        { "ECONNABORTED"_s, ECONNABORTED },
#endif
#ifdef ECONNREFUSED
        { "ECONNREFUSED"_s, ECONNREFUSED },
#endif
#ifdef ECONNRESET
        { "ECONNRESET"_s, ECONNRESET },
#endif
#ifdef EDEADLK
        { "EDEADLK"_s, EDEADLK },
#endif
#ifdef EDESTADDRREQ
        { "EDESTADDRREQ"_s, EDESTADDRREQ },
#endif
#ifdef EDOM
        { "EDOM"_s, EDOM },
#endif
#ifdef EDQUOT
        { "EDQUOT"_s, EDQUOT },
#endif
#ifdef EEXIST
        { "EEXIST"_s, EEXIST },
#endif
#ifdef EFAULT
        { "EFAULT"_s, EFAULT },
#endif
#ifdef EFBIG
        { "EFBIG"_s, EFBIG },
#endif
#ifdef EHOSTUNREACH
        { "EHOSTUNREACH"_s, EHOSTUNREACH },
#endif
#ifdef EIDRM
        { "EIDRM"_s, EIDRM },
#endif
#ifdef EILSEQ
        { "EILSEQ"_s, EILSEQ },
#endif
#ifdef EINPROGRESS
        { "EINPROGRESS"_s, EINPROGRESS },
#endif
#ifdef EINTR
        { "EINTR"_s, EINTR },
#endif
#ifdef EINVAL
        { "EINVAL"_s, EINVAL },
#endif
#ifdef EIO
        { "EIO"_s, EIO },
#endif
#ifdef EISCONN
        { "EISCONN"_s, EISCONN },
#endif
#ifdef EISDIR
        { "EISDIR"_s, EISDIR },
#endif
#ifdef ELOOP
        { "ELOOP"_s, ELOOP },
#endif
#ifdef EMFILE
        { "EMFILE"_s, EMFILE },
#endif
#ifdef EMLINK
        { "EMLINK"_s, EMLINK },
#endif
#ifdef EMSGSIZE
        { "EMSGSIZE"_s, EMSGSIZE },
#endif
#ifdef EMULTIHOP
        { "EMULTIHOP"_s, EMULTIHOP },
#endif
#ifdef ENAMETOOLONG
        { "ENAMETOOLONG"_s, ENAMETOOLONG },
#endif
#ifdef ENETDOWN
        { "ENETDOWN"_s, ENETDOWN },
#endif
#ifdef ENETRESET
        { "ENETRESET"_s, ENETRESET },
#endif
#ifdef ENETUNREACH
        { "ENETUNREACH"_s, ENETUNREACH },
#endif
#ifdef ENFILE
        { "ENFILE"_s, ENFILE },
#endif
#ifdef ENOBUFS
        { "ENOBUFS"_s, ENOBUFS },
#endif
#ifdef ENODATA
        { "ENODATA"_s, ENODATA },
#endif
#ifdef ENODEV
        { "ENODEV"_s, ENODEV },
#endif
#ifdef ENOENT
        { "ENOENT"_s, ENOENT },
#endif
#ifdef ENOEXEC
        { "ENOEXEC"_s, ENOEXEC },
#endif
#ifdef ENOLCK
        { "ENOLCK"_s, ENOLCK },
#endif
#ifdef ENOLINK
        { "ENOLINK"_s, ENOLINK },
#endif
#ifdef ENOMEM
        { "ENOMEM"_s, ENOMEM },
#endif
#ifdef ENOMSG
        { "ENOMSG"_s, ENOMSG },
#endif
#ifdef ENOPROTOOPT
        { "ENOPROTOOPT"_s, ENOPROTOOPT },
#endif
#ifdef ENOSPC
        { "ENOSPC"_s, ENOSPC },
#endif
#ifdef ENOSR
        { "ENOSR"_s, ENOSR },
#endif
#ifdef ENOSTR
        { "ENOSTR"_s, ENOSTR },
#endif
#ifdef ENOSYS
        { "ENOSYS"_s, ENOSYS },
#endif
#ifdef ENOTCONN
        { "ENOTCONN"_s, ENOTCONN },
#endif
#ifdef ENOTDIR
        { "ENOTDIR"_s, ENOTDIR },
#endif
#ifdef ENOTEMPTY
        { "ENOTEMPTY"_s, ENOTEMPTY },
#endif
#ifdef ENOTSOCK
        { "ENOTSOCK"_s, ENOTSOCK },
#endif
#ifdef ENOTSUP
        { "ENOTSUP"_s, ENOTSUP },
#endif
#ifdef ENOTTY
        { "ENOTTY"_s, ENOTTY },
#endif
#ifdef ENXIO
        { "ENXIO"_s, ENXIO },
#endif
#ifdef EOPNOTSUPP
        { "EOPNOTSUPP"_s, EOPNOTSUPP },
#endif
#ifdef EOVERFLOW
        { "EOVERFLOW"_s, EOVERFLOW },
#endif
#ifdef EPERM
        { "EPERM"_s, EPERM },
#endif
#ifdef EPIPE
        { "EPIPE"_s, EPIPE },
#endif
#ifdef EPROTO
        { "EPROTO"_s, EPROTO },
#endif
#ifdef EPROTONOSUPPORT
        { "EPROTONOSUPPORT"_s, EPROTONOSUPPORT },
#endif
#ifdef EPROTOTYPE
        { "EPROTOTYPE"_s, EPROTOTYPE },
#endif
#ifdef ERANGE
        { "ERANGE"_s, ERANGE },
#endif
#ifdef EROFS
        { "EROFS"_s, EROFS },
#endif
#ifdef ESPIPE
        { "ESPIPE"_s, ESPIPE },
#endif
#ifdef ESRCH
        { "ESRCH"_s, ESRCH },
#endif
#ifdef ESTALE
        { "ESTALE"_s, ESTALE },
#endif
#ifdef ETIME
        { "ETIME"_s, ETIME },
#endif
#ifdef ETIMEDOUT
        { "ETIMEDOUT"_s, ETIMEDOUT },
#endif
#ifdef ETXTBSY
        { "ETXTBSY"_s, ETXTBSY },
#endif
#ifdef EWOULDBLOCK
        { "EWOULDBLOCK"_s, EWOULDBLOCK },
#endif
#ifdef EXDEV
        { "EXDEV"_s, EXDEV },
#endif
#ifdef WSAEINTR
        { "WSAEINTR"_s, WSAEINTR },
#endif
#ifdef WSAEBADF
        { "WSAEBADF"_s, WSAEBADF },
#endif
#ifdef WSAEACCES
        { "WSAEACCES"_s, WSAEACCES },
#endif
#ifdef WSAEFAULT
        { "WSAEFAULT"_s, WSAEFAULT },
#endif
#ifdef WSAEINVAL
        { "WSAEINVAL"_s, WSAEINVAL },
#endif
#ifdef WSAEMFILE
        { "WSAEMFILE"_s, WSAEMFILE },
#endif
#ifdef WSAEWOULDBLOCK
        { "WSAEWOULDBLOCK"_s, WSAEWOULDBLOCK },
#endif
#ifdef WSAEINPROGRESS
        { "WSAEINPROGRESS"_s, WSAEINPROGRESS },
#endif
#ifdef WSAEALREADY
        { "WSAEALREADY"_s, WSAEALREADY },
#endif
#ifdef WSAENOTSOCK
        { "WSAENOTSOCK"_s, WSAENOTSOCK },
#endif
#ifdef WSAEDESTADDRREQ
        { "WSAEDESTADDRREQ"_s, WSAEDESTADDRREQ },
#endif
#ifdef WSAEMSGSIZE
        { "WSAEMSGSIZE"_s, WSAEMSGSIZE },
#endif
#ifdef WSAEPROTOTYPE
        { "WSAEPROTOTYPE"_s, WSAEPROTOTYPE },
#endif
#ifdef WSAENOPROTOOPT
        { "WSAENOPROTOOPT"_s, WSAENOPROTOOPT },
#endif
#ifdef WSAEPROTONOSUPPORT
        { "WSAEPROTONOSUPPORT"_s, WSAEPROTONOSUPPORT },
#endif
#ifdef WSAESOCKTNOSUPPORT
        { "WSAESOCKTNOSUPPORT"_s, WSAESOCKTNOSUPPORT },
#endif
#ifdef WSAEOPNOTSUPP
        { "WSAEOPNOTSUPP"_s, WSAEOPNOTSUPP },
#endif
#ifdef WSAEPFNOSUPPORT
        { "WSAEPFNOSUPPORT"_s, WSAEPFNOSUPPORT },
#endif
#ifdef WSAEAFNOSUPPORT
        { "WSAEAFNOSUPPORT"_s, WSAEAFNOSUPPORT },
#endif
#ifdef WSAEADDRINUSE
        { "WSAEADDRINUSE"_s, WSAEADDRINUSE },
#endif
#ifdef WSAEADDRNOTAVAIL
        { "WSAEADDRNOTAVAIL"_s, WSAEADDRNOTAVAIL },
#endif
#ifdef WSAENETDOWN
        { "WSAENETDOWN"_s, WSAENETDOWN },
#endif
#ifdef WSAENETUNREACH
        { "WSAENETUNREACH"_s, WSAENETUNREACH },
#endif
#ifdef WSAENETRESET
        { "WSAENETRESET"_s, WSAENETRESET },
#endif
#ifdef WSAECONNABORTED
        { "WSAECONNABORTED"_s, WSAECONNABORTED },
#endif
#ifdef WSAECONNRESET
        { "WSAECONNRESET"_s, WSAECONNRESET },
#endif
#ifdef WSAENOBUFS
        { "WSAENOBUFS"_s, WSAENOBUFS },
#endif
#ifdef WSAEISCONN
        { "WSAEISCONN"_s, WSAEISCONN },
#endif
#ifdef WSAENOTCONN
        { "WSAENOTCONN"_s, WSAENOTCONN },
#endif
#ifdef WSAESHUTDOWN
        { "WSAESHUTDOWN"_s, WSAESHUTDOWN },
#endif
#ifdef WSAETOOMANYREFS
        { "WSAETOOMANYREFS"_s, WSAETOOMANYREFS },
#endif
#ifdef WSAETIMEDOUT
        { "WSAETIMEDOUT"_s, WSAETIMEDOUT },
#endif
#ifdef WSAECONNREFUSED
        { "WSAECONNREFUSED"_s, WSAECONNREFUSED },
#endif
#ifdef WSAELOOP
        { "WSAELOOP"_s, WSAELOOP },
#endif
#ifdef WSAENAMETOOLONG
        { "WSAENAMETOOLONG"_s, WSAENAMETOOLONG },
#endif
#ifdef WSAEHOSTDOWN
        { "WSAEHOSTDOWN"_s, WSAEHOSTDOWN },
#endif
#ifdef WSAEHOSTUNREACH
        { "WSAEHOSTUNREACH"_s, WSAEHOSTUNREACH },
#endif
#ifdef WSAENOTEMPTY
        { "WSAENOTEMPTY"_s, WSAENOTEMPTY },
#endif
#ifdef WSAEPROCLIM
        { "WSAEPROCLIM"_s, WSAEPROCLIM },
#endif
#ifdef WSAEUSERS
        { "WSAEUSERS"_s, WSAEUSERS },
#endif
#ifdef WSAEDQUOT
        { "WSAEDQUOT"_s, WSAEDQUOT },
#endif
#ifdef WSAESTALE
        { "WSAESTALE"_s, WSAESTALE },
#endif
#ifdef WSAEREMOTE
        { "WSAEREMOTE"_s, WSAEREMOTE },
#endif
#ifdef WSASYSNOTREADY
        { "WSASYSNOTREADY"_s, WSASYSNOTREADY },
#endif
#ifdef WSAVERNOTSUPPORTED
        { "WSAVERNOTSUPPORTED"_s, WSAVERNOTSUPPORTED },
#endif
#ifdef WSANOTINITIALISED
        { "WSANOTINITIALISED"_s, WSANOTINITIALISED },
#endif
#ifdef WSAEDISCON
        { "WSAEDISCON"_s, WSAEDISCON },
#endif
#ifdef WSAENOMORE
        { "WSAENOMORE"_s, WSAENOMORE },
#endif
#ifdef WSAECANCELLED
        { "WSAECANCELLED"_s, WSAECANCELLED },
#endif
#ifdef WSAEINVALIDPROCTABLE
        { "WSAEINVALIDPROCTABLE"_s, WSAEINVALIDPROCTABLE },
#endif
#ifdef WSAEINVALIDPROVIDER
        { "WSAEINVALIDPROVIDER"_s, WSAEINVALIDPROVIDER },
#endif
#ifdef WSAEPROVIDERFAILEDINIT
        { "WSAEPROVIDERFAILEDINIT"_s, WSAEPROVIDERFAILEDINIT },
#endif
#ifdef WSASYSCALLFAILURE
        { "WSASYSCALLFAILURE"_s, WSASYSCALLFAILURE },
#endif
#ifdef WSASERVICE_NOT_FOUND
        { "WSASERVICE_NOT_FOUND"_s, WSASERVICE_NOT_FOUND },
#endif
#ifdef WSATYPE_NOT_FOUND
        { "WSATYPE_NOT_FOUND"_s, WSATYPE_NOT_FOUND },
#endif
#ifdef WSA_E_NO_MORE
        { "WSA_E_NO_MORE"_s, WSA_E_NO_MORE },
#endif
#ifdef WSA_E_CANCELLED
        { "WSA_E_CANCELLED"_s, WSA_E_CANCELLED },
#endif
#ifdef WSAEREFUSED
        { "WSAEREFUSED"_s, WSAEREFUSED },
#endif
    };
    static constexpr ConstantEntry signalConstants[] = {
#ifdef SIGHUP
        { "SIGHUP"_s, SIGHUP },
#endif
#ifdef SIGINT
        { "SIGINT"_s, SIGINT },
#endif
#ifdef SIGQUIT
        { "SIGQUIT"_s, SIGQUIT },
#endif
#ifdef SIGILL
        { "SIGILL"_s, SIGILL },
#endif
#ifdef SIGTRAP
        { "SIGTRAP"_s, SIGTRAP },
#endif
#ifdef SIGABRT
        { "SIGABRT"_s, SIGABRT },
#endif
#ifdef SIGIOT
        { "SIGIOT"_s, SIGIOT },
#endif
#ifdef SIGBUS
        { "SIGBUS"_s, SIGBUS },
#endif
#ifdef SIGFPE
        { "SIGFPE"_s, SIGFPE },
#endif
#ifdef SIGKILL
        { "SIGKILL"_s, SIGKILL },
#endif
#ifdef SIGUSR1
        { "SIGUSR1"_s, SIGUSR1 },
#endif
#ifdef SIGSEGV
        { "SIGSEGV"_s, SIGSEGV },
#endif
#ifdef SIGUSR2
        { "SIGUSR2"_s, SIGUSR2 },
#endif
#ifdef SIGPIPE
        { "SIGPIPE"_s, SIGPIPE },
#endif
#ifdef SIGALRM
        { "SIGALRM"_s, SIGALRM },
#endif
#ifdef SIGTERM
        { "SIGTERM"_s, SIGTERM },
#endif
#ifdef SIGCHLD
        { "SIGCHLD"_s, SIGCHLD },
#endif
#ifdef SIGSTKFLT
        { "SIGSTKFLT"_s, SIGSTKFLT },
#endif
#ifdef SIGCONT
        { "SIGCONT"_s, SIGCONT },
#endif
#ifdef SIGSTOP
        { "SIGSTOP"_s, SIGSTOP },
#endif
#ifdef SIGTSTP
        { "SIGTSTP"_s, SIGTSTP },
#endif
#ifdef SIGBREAK
        { "SIGBREAK"_s, SIGBREAK },
#endif
#ifdef SIGTTIN
        { "SIGTTIN"_s, SIGTTIN },
#endif
#ifdef SIGTTOU
        { "SIGTTOU"_s, SIGTTOU },
#endif
#ifdef SIGURG
        { "SIGURG"_s, SIGURG },
#endif
#ifdef SIGXCPU
        { "SIGXCPU"_s, SIGXCPU },
#endif
#ifdef SIGXFSZ
        { "SIGXFSZ"_s, SIGXFSZ },
#endif
#ifdef SIGVTALRM
        { "SIGVTALRM"_s, SIGVTALRM },
#endif
#ifdef SIGPROF
        { "SIGPROF"_s, SIGPROF },
#endif
#ifdef SIGWINCH
        { "SIGWINCH"_s, SIGWINCH },
#endif
#ifdef SIGIO
        { "SIGIO"_s, SIGIO },
#endif
#ifdef SIGPOLL
        { "SIGPOLL"_s, SIGPOLL },
#endif
#ifdef SIGLOST
        { "SIGLOST"_s, SIGLOST },
#endif
#ifdef SIGPWR
        { "SIGPWR"_s, SIGPWR },
#endif
#ifdef SIGINFO
        { "SIGINFO"_s, SIGINFO },
#endif
#ifdef SIGSYS
        { "SIGSYS"_s, SIGSYS },
#endif
#ifdef SIGUNUSED
        { "SIGUNUSED"_s, SIGUNUSED },
#endif
    };
    static constexpr ConstantEntry priorityConstants[] = {
        { "PRIORITY_LOW"_s, 19 },
        { "PRIORITY_BELOW_NORMAL"_s, 10 },
        { "PRIORITY_NORMAL"_s, 0 },
        { "PRIORITY_ABOVE_NORMAL"_s, -7 },
        { "PRIORITY_HIGH"_s, -14 },
        { "PRIORITY_HIGHEST"_s, -20 },
    };
    auto globalObject = bindingObject->globalObject();
    auto osObj = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    auto dlopenObj = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    auto errnoObj = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    auto signalsObj = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    auto priorityObj = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    osObj->putDirect(vm, Identifier::fromString(vm, "UV_UDP_REUSEADDR"_s), jsNumber(4));
    osObj->putDirect(vm, Identifier::fromString(vm, "dlopen"_s), dlopenObj);
    osObj->putDirect(vm, Identifier::fromString(vm, "errno"_s), errnoObj);
    osObj->putDirect(vm, Identifier::fromString(vm, "signals"_s), signalsObj);
    osObj->putDirect(vm, Identifier::fromString(vm, "priority"_s), priorityObj);
    putConstants(vm, errnoObj, errnoConstants);
    putConstants(vm, signalsObj, signalConstants);
    putConstants(vm, priorityObj, priorityConstants);
#ifdef RTLD_LAZY
    dlopenObj->putDirect(vm, Identifier::fromString(vm, "RTLD_LAZY"_s), jsNumber(RTLD_LAZY));
#endif
#ifdef RTLD_NOW
    dlopenObj->putDirect(vm, Identifier::fromString(vm, "RTLD_NOW"_s), jsNumber(RTLD_NOW));
#endif
#ifdef RTLD_GLOBAL
    dlopenObj->putDirect(vm, Identifier::fromString(vm, "RTLD_GLOBAL"_s), jsNumber(RTLD_GLOBAL));
#endif
#ifdef RTLD_LOCAL
    dlopenObj->putDirect(vm, Identifier::fromString(vm, "RTLD_LOCAL"_s), jsNumber(RTLD_LOCAL));
#endif
#ifdef RTLD_DEEPBIND
    dlopenObj->putDirect(vm, Identifier::fromString(vm, "RTLD_DEEPBIND"_s), jsNumber(RTLD_DEEPBIND));
#endif
    return osObj;
}

static JSValue processBindingConstantsGetTrace(VM& vm, JSObject* bindingObject)
{
    static constexpr ConstantEntry traceConstants[] = {
        { "TRACE_EVENT_PHASE_BEGIN"_s, 66 },
        { "TRACE_EVENT_PHASE_END"_s, 69 },
        { "TRACE_EVENT_PHASE_COMPLETE"_s, 88 },
        { "TRACE_EVENT_PHASE_INSTANT"_s, 73 },
        { "TRACE_EVENT_PHASE_ASYNC_BEGIN"_s, 83 },
        { "TRACE_EVENT_PHASE_ASYNC_STEP_INTO"_s, 84 },
        { "TRACE_EVENT_PHASE_ASYNC_STEP_PAST"_s, 112 },
        { "TRACE_EVENT_PHASE_ASYNC_END"_s, 70 },
        { "TRACE_EVENT_PHASE_NESTABLE_ASYNC_BEGIN"_s, 98 },
        { "TRACE_EVENT_PHASE_NESTABLE_ASYNC_END"_s, 101 },
        { "TRACE_EVENT_PHASE_NESTABLE_ASYNC_INSTANT"_s, 110 },
        { "TRACE_EVENT_PHASE_FLOW_BEGIN"_s, 115 },
        { "TRACE_EVENT_PHASE_FLOW_STEP"_s, 116 },
        { "TRACE_EVENT_PHASE_FLOW_END"_s, 102 },
        { "TRACE_EVENT_PHASE_METADATA"_s, 77 },
        { "TRACE_EVENT_PHASE_COUNTER"_s, 67 },
        { "TRACE_EVENT_PHASE_SAMPLE"_s, 80 },
        { "TRACE_EVENT_PHASE_CREATE_OBJECT"_s, 78 },
        { "TRACE_EVENT_PHASE_SNAPSHOT_OBJECT"_s, 79 },
        { "TRACE_EVENT_PHASE_DELETE_OBJECT"_s, 68 },
        { "TRACE_EVENT_PHASE_MEMORY_DUMP"_s, 118 },
        { "TRACE_EVENT_PHASE_MARK"_s, 82 },
        { "TRACE_EVENT_PHASE_CLOCK_SYNC"_s, 99 },
        { "TRACE_EVENT_PHASE_ENTER_CONTEXT"_s, 40 },
        { "TRACE_EVENT_PHASE_LEAVE_CONTEXT"_s, 41 },
        { "TRACE_EVENT_PHASE_LINK_IDS"_s, 61 },
    };
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    putConstants(vm, object, traceConstants);
    return object;
}

static JSValue processBindingConstantsGetFs(VM& vm, JSObject* bindingObject)
{
    static constexpr ConstantEntry fsConstants[] = {
        { "UV_FS_SYMLINK_DIR"_s, 1 },
        { "UV_FS_SYMLINK_JUNCTION"_s, 2 },
        { "O_RDONLY"_s, O_RDONLY },
        { "O_WRONLY"_s, O_WRONLY },
        { "O_RDWR"_s, O_RDWR },

        { "UV_DIRENT_UNKNOWN"_s, 0 },
        { "UV_DIRENT_FILE"_s, 1 },
        { "UV_DIRENT_DIR"_s, 2 },
        { "UV_DIRENT_LINK"_s, 3 },
        { "UV_DIRENT_FIFO"_s, 4 },
        { "UV_DIRENT_SOCKET"_s, 5 },
        { "UV_DIRENT_CHAR"_s, 6 },
        { "UV_DIRENT_BLOCK"_s, 7 },

        { "S_IFMT"_s, S_IFMT },
        { "S_IFREG"_s, S_IFREG },
        { "S_IFDIR"_s, S_IFDIR },
        { "S_IFCHR"_s, S_IFCHR },
#ifdef S_IFBLK
        { "S_IFBLK"_s, S_IFBLK },
#endif
#ifdef S_IFIFO
        { "S_IFIFO"_s, S_IFIFO },
#endif
#ifdef S_IFLNK
        { "S_IFLNK"_s, S_IFLNK },
#endif
#ifdef S_IFSOCK
        { "S_IFSOCK"_s, S_IFSOCK },
#endif
#ifdef O_CREAT
        { "O_CREAT"_s, O_CREAT },
#endif
#ifdef O_EXCL
        { "O_EXCL"_s, O_EXCL },
#endif
#if OS(WINDOWS)
        { "UV_FS_O_FILEMAP"_s, 536870912 },
#else
        { "UV_FS_O_FILEMAP"_s, 0 },
#endif
#ifdef O_NOCTTY
        { "O_NOCTTY"_s, O_NOCTTY },
#endif
#ifdef O_TRUNC
        { "O_TRUNC"_s, O_TRUNC },
#endif
#ifdef O_APPEND
        { "O_APPEND"_s, O_APPEND },
#endif
#ifdef O_DIRECTORY
        { "O_DIRECTORY"_s, O_DIRECTORY },
#endif
#ifdef O_NOATIME
        { "O_NOATIME"_s, O_NOATIME },
#endif
#ifdef O_NOFOLLOW
        { "O_NOFOLLOW"_s, O_NOFOLLOW },
#endif
#ifdef O_SYNC
        { "O_SYNC"_s, O_SYNC },
#endif
#ifdef O_DSYNC
        { "O_DSYNC"_s, O_DSYNC },
#endif
#ifdef O_SYMLINK
        { "O_SYMLINK"_s, O_SYMLINK },
#endif
#ifdef O_DIRECT
        { "O_DIRECT"_s, O_DIRECT },
#endif
#ifdef O_NONBLOCK
        { "O_NONBLOCK"_s, O_NONBLOCK },
#endif
#ifdef S_IRWXU
        { "S_IRWXU"_s, S_IRWXU },
#endif
#ifdef S_IRUSR
        { "S_IRUSR"_s, S_IRUSR },
#endif
#ifdef S_IWUSR
        { "S_IWUSR"_s, S_IWUSR },
#endif
#ifdef S_IXUSR
        { "S_IXUSR"_s, S_IXUSR },
#endif
#ifdef S_IRWXG
        { "S_IRWXG"_s, S_IRWXG },
#endif
#ifdef S_IRGRP
        { "S_IRGRP"_s, S_IRGRP },
#endif
#ifdef S_IWGRP
        { "S_IWGRP"_s, S_IWGRP },
#endif
#ifdef S_IXGRP
        { "S_IXGRP"_s, S_IXGRP },
#endif
#ifdef S_IRWXO
        { "S_IRWXO"_s, S_IRWXO },
#endif
#ifdef S_IROTH
        { "S_IROTH"_s, S_IROTH },
#endif
#ifdef S_IWOTH
        { "S_IWOTH"_s, S_IWOTH },
#endif
#ifdef S_IXOTH
        { "S_IXOTH"_s, S_IXOTH },
#endif
#ifdef F_OK
        { "F_OK"_s, F_OK },
#endif
#ifdef R_OK
        { "R_OK"_s, R_OK },
#endif
#ifdef W_OK
        { "W_OK"_s, W_OK },
#endif
#ifdef X_OK
        { "X_OK"_s, X_OK },
#endif
        { "UV_FS_COPYFILE_EXCL"_s, 1 },
        { "COPYFILE_EXCL"_s, 1 },
        { "UV_FS_COPYFILE_FICLONE"_s, 2 },
        { "COPYFILE_FICLONE"_s, 2 },
        { "UV_FS_COPYFILE_FICLONE_FORCE"_s, 4 },
        { "COPYFILE_FICLONE_FORCE"_s, 4 },

        { "EXTENSIONLESS_FORMAT_JAVASCRIPT"_s, 0 },
        { "EXTENSIONLESS_FORMAT_WASM"_s, 1 },

    };
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    putConstants(vm, object, fsConstants);
    return object;
}

static JSValue processBindingConstantsGetCrypto(VM& vm, JSObject* bindingObject)
{
    static constexpr ConstantEntry cryptoConstants[] = {
#ifdef OPENSSL_VERSION_NUMBER
        { "OPENSSL_VERSION_NUMBER"_s, OPENSSL_VERSION_NUMBER },
#endif
#ifdef SSL_OP_ALL
        { "SSL_OP_ALL"_s, SSL_OP_ALL },
#endif
#ifdef SSL_OP_ALLOW_NO_DHE_KEX
        { "SSL_OP_ALLOW_NO_DHE_KEX"_s, SSL_OP_ALLOW_NO_DHE_KEX },
#else
        { "SSL_OP_ALLOW_NO_DHE_KEX"_s, 0 },
#endif
#ifdef SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION
        { "SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION"_s, SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION },
#endif
#ifdef SSL_OP_CIPHER_SERVER_PREFERENCE
        { "SSL_OP_CIPHER_SERVER_PREFERENCE"_s, SSL_OP_CIPHER_SERVER_PREFERENCE },
#endif
#ifdef SSL_OP_CISCO_ANYCONNECT
        { "SSL_OP_CISCO_ANYCONNECT"_s, SSL_OP_CISCO_ANYCONNECT },
#else
        { "SSL_OP_CISCO_ANYCONNECT"_s, 0 },
#endif
#ifdef SSL_OP_COOKIE_EXCHANGE
        { "SSL_OP_COOKIE_EXCHANGE"_s, SSL_OP_COOKIE_EXCHANGE },
#else
        { "SSL_OP_COOKIE_EXCHANGE"_s, 0 },
#endif
#ifdef SSL_OP_CRYPTOPRO_TLSEXT_BUG
        { "SSL_OP_CRYPTOPRO_TLSEXT_BUG"_s, SSL_OP_CRYPTOPRO_TLSEXT_BUG },
#else
        { "SSL_OP_CRYPTOPRO_TLSEXT_BUG"_s, 0 },
#endif
#ifdef SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS
        { "SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS"_s, SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS },
#endif
#ifdef SSL_OP_LEGACY_SERVER_CONNECT
        { "SSL_OP_LEGACY_SERVER_CONNECT"_s, SSL_OP_LEGACY_SERVER_CONNECT },
#endif
#ifdef SSL_OP_NO_COMPRESSION
        { "SSL_OP_NO_COMPRESSION"_s, SSL_OP_NO_COMPRESSION },
#endif
#ifdef SSL_OP_NO_ENCRYPT_THEN_MAC
        { "SSL_OP_NO_ENCRYPT_THEN_MAC"_s, SSL_OP_NO_ENCRYPT_THEN_MAC },
#else
        { "SSL_OP_NO_ENCRYPT_THEN_MAC"_s, 0 },
#endif
#ifdef SSL_OP_NO_QUERY_MTU
        { "SSL_OP_NO_QUERY_MTU"_s, SSL_OP_NO_QUERY_MTU },
#endif
#ifdef SSL_OP_NO_RENEGOTIATION
        { "SSL_OP_NO_RENEGOTIATION"_s, SSL_OP_NO_RENEGOTIATION },
#endif
#ifdef SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION
        { "SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION"_s, SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION },
#endif
#ifdef SSL_OP_NO_SSLv2
        { "SSL_OP_NO_SSLv2"_s, SSL_OP_NO_SSLv2 },
#endif
#ifdef SSL_OP_NO_SSLv3
        { "SSL_OP_NO_SSLv3"_s, SSL_OP_NO_SSLv3 },
#endif
#ifdef SSL_OP_NO_TICKET
        { "SSL_OP_NO_TICKET"_s, SSL_OP_NO_TICKET },
#endif
#ifdef SSL_OP_NO_TLSv1
        { "SSL_OP_NO_TLSv1"_s, SSL_OP_NO_TLSv1 },
#endif
#ifdef SSL_OP_NO_TLSv1_1
        { "SSL_OP_NO_TLSv1_1"_s, SSL_OP_NO_TLSv1_1 },
#endif
#ifdef SSL_OP_NO_TLSv1_2
        { "SSL_OP_NO_TLSv1_2"_s, SSL_OP_NO_TLSv1_2 },
#endif
#ifdef SSL_OP_NO_TLSv1_3
        { "SSL_OP_NO_TLSv1_3"_s, SSL_OP_NO_TLSv1_3 },
#endif
#ifdef SSL_OP_PRIORITIZE_CHACHA
        { "SSL_OP_PRIORITIZE_CHACHA"_s, SSL_OP_PRIORITIZE_CHACHA },
#else
        { "SSL_OP_PRIORITIZE_CHACHA"_s, 0 },
#endif
#ifdef SSL_OP_TLS_ROLLBACK_BUG
        { "SSL_OP_TLS_ROLLBACK_BUG"_s, SSL_OP_TLS_ROLLBACK_BUG },
#endif
        // OBSOLETE OPTIONS retained for compatibility
        { "SSL_OP_MICROSOFT_SESS_ID_BUG"_s, 0 },
        { "SSL_OP_NETSCAPE_CHALLENGE_BUG"_s, 0 },
        { "SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG"_s, 0 },
        { "SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG"_s, 0 },
        { "SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER"_s, 0 },
        { "SSL_OP_MSIE_SSLV2_RSA_PADDING"_s, 0 },
        { "SSL_OP_SSLEAY_080_CLIENT_DH_BUG"_s, 0 },
        { "SSL_OP_TLS_D5_BUG"_s, 0 },
        { "SSL_OP_TLS_BLOCK_PADDING_BUG"_s, 0 },
        { "SSL_OP_SINGLE_ECDH_USE"_s, 0 },
        { "SSL_OP_SINGLE_DH_USE"_s, 0 },
        { "SSL_OP_EPHEMERAL_RSA"_s, 0 },
        { "SSL_OP_NO_SSLv2"_s, 0 },
        { "SSL_OP_PKCS1_CHECK_1"_s, 0 },
        { "SSL_OP_PKCS1_CHECK_2"_s, 0 },
        { "SSL_OP_NETSCAPE_CA_DN_BUG"_s, 0 },
        { "SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG"_s, 0 },
        // BoringSSL does not define engine constants in openssl/engine.h
        { "ENGINE_METHOD_RSA"_s, 0x0001 },
        { "ENGINE_METHOD_DSA"_s, 0x0002 },
        { "ENGINE_METHOD_DH"_s, 0x0004 },
        { "ENGINE_METHOD_RAND"_s, 0x0008 },
        { "ENGINE_METHOD_CIPHERS"_s, 0x0040 },
        { "ENGINE_METHOD_DIGESTS"_s, 0x0080 },
        { "ENGINE_METHOD_PKEY_METHS"_s, 0x0200 },
        { "ENGINE_METHOD_PKEY_ASN1_METHS"_s, 0x0400 },
        { "ENGINE_METHOD_EC"_s, 0x0800 },
        { "ENGINE_METHOD_ALL"_s, 0xFFFF },
        { "ENGINE_METHOD_NONE"_s, 0x0000 },
#ifdef DH_CHECK_P_NOT_SAFE_PRIME
        { "DH_CHECK_P_NOT_SAFE_PRIME"_s, DH_CHECK_P_NOT_SAFE_PRIME },
#endif
#ifdef DH_CHECK_P_NOT_PRIME
        { "DH_CHECK_P_NOT_PRIME"_s, DH_CHECK_P_NOT_PRIME },
#endif
#ifdef DH_UNABLE_TO_CHECK_GENERATOR
        { "DH_UNABLE_TO_CHECK_GENERATOR"_s, DH_UNABLE_TO_CHECK_GENERATOR },
#endif
#ifdef DH_NOT_SUITABLE_GENERATOR
        { "DH_NOT_SUITABLE_GENERATOR"_s, DH_NOT_SUITABLE_GENERATOR },
#endif
#ifdef RSA_PKCS1_PADDING
        { "RSA_PKCS1_PADDING"_s, RSA_PKCS1_PADDING },
#endif
#ifdef RSA_SSLV23_PADDING
        { "RSA_SSLV23_PADDING"_s, RSA_SSLV23_PADDING },
#endif
#ifdef RSA_NO_PADDING
        { "RSA_NO_PADDING"_s, RSA_NO_PADDING },
#endif
#ifdef RSA_PKCS1_OAEP_PADDING
        { "RSA_PKCS1_OAEP_PADDING"_s, RSA_PKCS1_OAEP_PADDING },
#endif
#ifdef RSA_X931_PADDING
        { "RSA_X931_PADDING"_s, RSA_X931_PADDING },
#else
        { "RSA_X931_PADDING"_s, 5 },
#endif
#ifdef RSA_PKCS1_PSS_PADDING
        { "RSA_PKCS1_PSS_PADDING"_s, RSA_PKCS1_PSS_PADDING },
#endif
#ifdef RSA_PSS_SALTLEN_DIGEST
        { "RSA_PSS_SALTLEN_DIGEST"_s, RSA_PSS_SALTLEN_DIGEST },
#else
        { "RSA_PSS_SALTLEN_DIGEST"_s, -1 },
#endif
#ifdef RSA_PSS_SALTLEN_MAX_SIGN
        { "RSA_PSS_SALTLEN_MAX_SIGN"_s, RSA_PSS_SALTLEN_MAX_SIGN },
#else
        { "RSA_PSS_SALTLEN_MAX_SIGN"_s, -2 },
#endif
#ifdef RSA_PSS_SALTLEN_AUTO
        { "RSA_PSS_SALTLEN_AUTO"_s, RSA_PSS_SALTLEN_AUTO },
#else
        { "RSA_PSS_SALTLEN_AUTO"_s, -2 },
#endif
    };
    static constexpr ConstantEntry tlsConstants[] = {
        { "TLS1_VERSION"_s, TLS1_VERSION },
        { "TLS1_1_VERSION"_s, TLS1_1_VERSION },
        { "TLS1_2_VERSION"_s, TLS1_2_VERSION },
        { "TLS1_3_VERSION"_s, TLS1_3_VERSION },
        { "POINT_CONVERSION_COMPRESSED"_s, POINT_CONVERSION_COMPRESSED },
        { "POINT_CONVERSION_UNCOMPRESSED"_s, POINT_CONVERSION_UNCOMPRESSED },
        { "POINT_CONVERSION_HYBRID"_s, POINT_CONVERSION_HYBRID },
    };
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    putConstants(vm, object, cryptoConstants);
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
    putConstants(vm, object, tlsConstants);
    return object;
}

static JSValue processBindingConstantsGetZlib(VM& vm, JSObject* bindingObject)
{
    static constexpr ConstantEntry zlibConstants[] = {
        { "Z_NO_FLUSH"_s, Z_NO_FLUSH },
        { "Z_PARTIAL_FLUSH"_s, Z_PARTIAL_FLUSH },
        { "Z_SYNC_FLUSH"_s, Z_SYNC_FLUSH },
        { "Z_FULL_FLUSH"_s, Z_FULL_FLUSH },
        { "Z_FINISH"_s, Z_FINISH },
        { "Z_BLOCK"_s, Z_BLOCK },

        { "Z_OK"_s, Z_OK },
        { "Z_STREAM_END"_s, Z_STREAM_END },
        { "Z_NEED_DICT"_s, Z_NEED_DICT },
        { "Z_ERRNO"_s, Z_ERRNO },
        { "Z_STREAM_ERROR"_s, Z_STREAM_ERROR },
        { "Z_DATA_ERROR"_s, Z_DATA_ERROR },
        { "Z_MEM_ERROR"_s, Z_MEM_ERROR },
        { "Z_BUF_ERROR"_s, Z_BUF_ERROR },
        { "Z_VERSION_ERROR"_s, Z_VERSION_ERROR },

        { "Z_NO_COMPRESSION"_s, Z_NO_COMPRESSION },
        { "Z_BEST_SPEED"_s, Z_BEST_SPEED },
        { "Z_BEST_COMPRESSION"_s, Z_BEST_COMPRESSION },
        { "Z_DEFAULT_COMPRESSION"_s, Z_DEFAULT_COMPRESSION },
        { "Z_FILTERED"_s, Z_FILTERED },
        { "Z_HUFFMAN_ONLY"_s, Z_HUFFMAN_ONLY },
        { "Z_RLE"_s, Z_RLE },
        { "Z_FIXED"_s, Z_FIXED },
        { "Z_DEFAULT_STRATEGY"_s, Z_DEFAULT_STRATEGY },
        { "ZLIB_VERNUM"_s, ZLIB_VERNUM },

        { "DEFLATE"_s, 1 },
        { "INFLATE"_s, 2 },
        { "GZIP"_s, 3 },
        { "GUNZIP"_s, 4 },
        { "DEFLATERAW"_s, 5 },
        { "INFLATERAW"_s, 6 },
        { "UNZIP"_s, 7 },
        { "BROTLI_DECODE"_s, 8 },
        { "BROTLI_ENCODE"_s, 9 },
        { "ZSTD_COMPRESS"_s, 10 },
        { "ZSTD_DECOMPRESS"_s, 11 },

        { "Z_MIN_WINDOWBITS"_s, 8 },
        { "Z_MAX_WINDOWBITS"_s, 15 },
        { "Z_DEFAULT_WINDOWBITS"_s, 15 },
        { "Z_MIN_CHUNK"_s, 64 },
        { "Z_MAX_CHUNK"_s, std::numeric_limits<double>::infinity() },
        { "Z_DEFAULT_CHUNK"_s, 16 * 1024 },
        { "Z_MIN_MEMLEVEL"_s, 1 },
        { "Z_MAX_MEMLEVEL"_s, 9 },
        { "Z_DEFAULT_MEMLEVEL"_s, 8 },
        { "Z_MIN_LEVEL"_s, -1 },
        { "Z_MAX_LEVEL"_s, 9 },
        { "Z_DEFAULT_LEVEL"_s, Z_DEFAULT_COMPRESSION },

        { "BROTLI_OPERATION_PROCESS"_s, BROTLI_OPERATION_PROCESS },
        { "BROTLI_OPERATION_FLUSH"_s, BROTLI_OPERATION_FLUSH },
        { "BROTLI_OPERATION_FINISH"_s, BROTLI_OPERATION_FINISH },
        { "BROTLI_OPERATION_EMIT_METADATA"_s, BROTLI_OPERATION_EMIT_METADATA },
        { "BROTLI_PARAM_MODE"_s, BROTLI_PARAM_MODE },
        { "BROTLI_MODE_GENERIC"_s, BROTLI_MODE_GENERIC },
        { "BROTLI_MODE_TEXT"_s, BROTLI_MODE_TEXT },
        { "BROTLI_MODE_FONT"_s, BROTLI_MODE_FONT },
        { "BROTLI_DEFAULT_MODE"_s, BROTLI_DEFAULT_MODE },
        { "BROTLI_PARAM_QUALITY"_s, BROTLI_PARAM_QUALITY },
        { "BROTLI_MIN_QUALITY"_s, BROTLI_MIN_QUALITY },
        { "BROTLI_MAX_QUALITY"_s, BROTLI_MAX_QUALITY },
        { "BROTLI_DEFAULT_QUALITY"_s, BROTLI_DEFAULT_QUALITY },
        { "BROTLI_PARAM_LGWIN"_s, BROTLI_PARAM_LGWIN },
        { "BROTLI_MIN_WINDOW_BITS"_s, BROTLI_MIN_WINDOW_BITS },
        { "BROTLI_MAX_WINDOW_BITS"_s, BROTLI_MAX_WINDOW_BITS },
        { "BROTLI_LARGE_MAX_WINDOW_BITS"_s, BROTLI_LARGE_MAX_WINDOW_BITS },
        { "BROTLI_DEFAULT_WINDOW"_s, BROTLI_DEFAULT_WINDOW },
        { "BROTLI_PARAM_LGBLOCK"_s, BROTLI_PARAM_LGBLOCK },
        { "BROTLI_MIN_INPUT_BLOCK_BITS"_s, BROTLI_MIN_INPUT_BLOCK_BITS },
        { "BROTLI_MAX_INPUT_BLOCK_BITS"_s, BROTLI_MAX_INPUT_BLOCK_BITS },
        { "BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING"_s, BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING },
        { "BROTLI_PARAM_SIZE_HINT"_s, BROTLI_PARAM_SIZE_HINT },
        { "BROTLI_PARAM_LARGE_WINDOW"_s, BROTLI_PARAM_LARGE_WINDOW },
        { "BROTLI_PARAM_NPOSTFIX"_s, BROTLI_PARAM_NPOSTFIX },
        { "BROTLI_PARAM_NDIRECT"_s, BROTLI_PARAM_NDIRECT },
        { "BROTLI_DECODER_RESULT_ERROR"_s, BROTLI_DECODER_RESULT_ERROR },
        { "BROTLI_DECODER_RESULT_SUCCESS"_s, BROTLI_DECODER_RESULT_SUCCESS },
        { "BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT"_s, BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT },
        { "BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT"_s, BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT },
        { "BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION"_s, BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION },
        { "BROTLI_DECODER_PARAM_LARGE_WINDOW"_s, BROTLI_DECODER_PARAM_LARGE_WINDOW },
        { "BROTLI_DECODER_NO_ERROR"_s, BROTLI_DECODER_NO_ERROR },
        { "BROTLI_DECODER_SUCCESS"_s, BROTLI_DECODER_SUCCESS },
        { "BROTLI_DECODER_NEEDS_MORE_INPUT"_s, BROTLI_DECODER_NEEDS_MORE_INPUT },
        { "BROTLI_DECODER_NEEDS_MORE_OUTPUT"_s, BROTLI_DECODER_NEEDS_MORE_OUTPUT },
        { "BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE"_s, BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE },
        { "BROTLI_DECODER_ERROR_FORMAT_RESERVED"_s, BROTLI_DECODER_ERROR_FORMAT_RESERVED },
        { "BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE"_s, BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE },
        { "BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET"_s, BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET },
        { "BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME"_s, BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME },
        { "BROTLI_DECODER_ERROR_FORMAT_CL_SPACE"_s, BROTLI_DECODER_ERROR_FORMAT_CL_SPACE },
        { "BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE"_s, BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE },
        { "BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT"_s, BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT },
        { "BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1"_s, BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1 },
        { "BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2"_s, BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2 },
        { "BROTLI_DECODER_ERROR_FORMAT_TRANSFORM"_s, BROTLI_DECODER_ERROR_FORMAT_TRANSFORM },
        { "BROTLI_DECODER_ERROR_FORMAT_DICTIONARY"_s, BROTLI_DECODER_ERROR_FORMAT_DICTIONARY },
        { "BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS"_s, BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS },
        { "BROTLI_DECODER_ERROR_FORMAT_PADDING_1"_s, BROTLI_DECODER_ERROR_FORMAT_PADDING_1 },
        { "BROTLI_DECODER_ERROR_FORMAT_PADDING_2"_s, BROTLI_DECODER_ERROR_FORMAT_PADDING_2 },
        { "BROTLI_DECODER_ERROR_FORMAT_DISTANCE"_s, BROTLI_DECODER_ERROR_FORMAT_DISTANCE },
        { "BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET"_s, BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET },
        { "BROTLI_DECODER_ERROR_INVALID_ARGUMENTS"_s, BROTLI_DECODER_ERROR_INVALID_ARGUMENTS },
        { "BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES"_s, BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES },
        { "BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS"_s, BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS },
        { "BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP"_s, BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP },
        { "BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1"_s, BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1 },
        { "BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2"_s, BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2 },
        { "BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES"_s, BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES },
        { "BROTLI_DECODER_ERROR_UNREACHABLE"_s, BROTLI_DECODER_ERROR_UNREACHABLE },

        { "ZSTD_e_continue"_s, ZSTD_e_continue },
        { "ZSTD_e_flush"_s, ZSTD_e_flush },
        { "ZSTD_e_end"_s, ZSTD_e_end },
        { "ZSTD_fast"_s, ZSTD_fast },
        { "ZSTD_dfast"_s, ZSTD_dfast },
        { "ZSTD_greedy"_s, ZSTD_greedy },
        { "ZSTD_lazy"_s, ZSTD_lazy },
        { "ZSTD_lazy2"_s, ZSTD_lazy2 },
        { "ZSTD_btlazy2"_s, ZSTD_btlazy2 },
        { "ZSTD_btopt"_s, ZSTD_btopt },
        { "ZSTD_btultra"_s, ZSTD_btultra },
        { "ZSTD_btultra2"_s, ZSTD_btultra2 },
        { "ZSTD_c_compressionLevel"_s, ZSTD_c_compressionLevel },
        { "ZSTD_c_windowLog"_s, ZSTD_c_windowLog },
        { "ZSTD_c_hashLog"_s, ZSTD_c_hashLog },
        { "ZSTD_c_chainLog"_s, ZSTD_c_chainLog },
        { "ZSTD_c_searchLog"_s, ZSTD_c_searchLog },
        { "ZSTD_c_minMatch"_s, ZSTD_c_minMatch },
        { "ZSTD_c_targetLength"_s, ZSTD_c_targetLength },
        { "ZSTD_c_strategy"_s, ZSTD_c_strategy },
        { "ZSTD_c_enableLongDistanceMatching"_s, ZSTD_c_enableLongDistanceMatching },
        { "ZSTD_c_ldmHashLog"_s, ZSTD_c_ldmHashLog },
        { "ZSTD_c_ldmMinMatch"_s, ZSTD_c_ldmMinMatch },
        { "ZSTD_c_ldmBucketSizeLog"_s, ZSTD_c_ldmBucketSizeLog },
        { "ZSTD_c_ldmHashRateLog"_s, ZSTD_c_ldmHashRateLog },
        { "ZSTD_c_contentSizeFlag"_s, ZSTD_c_contentSizeFlag },
        { "ZSTD_c_checksumFlag"_s, ZSTD_c_checksumFlag },
        { "ZSTD_c_dictIDFlag"_s, ZSTD_c_dictIDFlag },
        { "ZSTD_c_nbWorkers"_s, ZSTD_c_nbWorkers },
        { "ZSTD_c_jobSize"_s, ZSTD_c_jobSize },
        { "ZSTD_c_overlapLog"_s, ZSTD_c_overlapLog },
        { "ZSTD_d_windowLogMax"_s, ZSTD_d_windowLogMax },
        { "ZSTD_CLEVEL_DEFAULT"_s, ZSTD_CLEVEL_DEFAULT },

        { "ZSTD_error_no_error"_s, ZSTD_error_no_error },
        { "ZSTD_error_GENERIC"_s, ZSTD_error_GENERIC },
        { "ZSTD_error_prefix_unknown"_s, ZSTD_error_prefix_unknown },
        { "ZSTD_error_version_unsupported"_s, ZSTD_error_version_unsupported },
        { "ZSTD_error_frameParameter_unsupported"_s, ZSTD_error_frameParameter_unsupported },
        { "ZSTD_error_frameParameter_windowTooLarge"_s, ZSTD_error_frameParameter_windowTooLarge },
        { "ZSTD_error_corruption_detected"_s, ZSTD_error_corruption_detected },
        { "ZSTD_error_checksum_wrong"_s, ZSTD_error_checksum_wrong },
        { "ZSTD_error_literals_headerWrong"_s, ZSTD_error_literals_headerWrong },
        { "ZSTD_error_dictionary_corrupted"_s, ZSTD_error_dictionary_corrupted },
        { "ZSTD_error_dictionary_wrong"_s, ZSTD_error_dictionary_wrong },
        { "ZSTD_error_dictionaryCreation_failed"_s, ZSTD_error_dictionaryCreation_failed },
        { "ZSTD_error_parameter_unsupported"_s, ZSTD_error_parameter_unsupported },
        { "ZSTD_error_parameter_combination_unsupported"_s, ZSTD_error_parameter_combination_unsupported },
        { "ZSTD_error_parameter_outOfBound"_s, ZSTD_error_parameter_outOfBound },
        { "ZSTD_error_tableLog_tooLarge"_s, ZSTD_error_tableLog_tooLarge },
        { "ZSTD_error_maxSymbolValue_tooLarge"_s, ZSTD_error_maxSymbolValue_tooLarge },
        { "ZSTD_error_maxSymbolValue_tooSmall"_s, ZSTD_error_maxSymbolValue_tooSmall },
        { "ZSTD_error_stabilityCondition_notRespected"_s, ZSTD_error_stabilityCondition_notRespected },
        { "ZSTD_error_stage_wrong"_s, ZSTD_error_stage_wrong },
        { "ZSTD_error_init_missing"_s, ZSTD_error_init_missing },
        { "ZSTD_error_memory_allocation"_s, ZSTD_error_memory_allocation },
        { "ZSTD_error_workSpace_tooSmall"_s, ZSTD_error_workSpace_tooSmall },
        { "ZSTD_error_dstSize_tooSmall"_s, ZSTD_error_dstSize_tooSmall },
        { "ZSTD_error_srcSize_wrong"_s, ZSTD_error_srcSize_wrong },
        { "ZSTD_error_dstBuffer_null"_s, ZSTD_error_dstBuffer_null },
        { "ZSTD_error_noForwardProgress_destFull"_s, ZSTD_error_noForwardProgress_destFull },
        { "ZSTD_error_noForwardProgress_inputEmpty"_s, ZSTD_error_noForwardProgress_inputEmpty },

    };
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    putConstants(vm, object, zlibConstants);
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
