// Modelled off of https://github.com/nodejs/node/blob/main/src/node_constants.cc
// Note that if you change any of this code, you probably also have to change NodeConstantsModule.h
#include "ProcessBindingConstants.h"
#include "JSConstantsObject.h"
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

// Every object below is a JSConstantsObject over one of these tables: the
// constants stay in the table and nothing is stored on the object. Rows are in
// node's order; that is the order the properties enumerate in.

// Row for a constant whose property name is the macro's own name.
#define CONSTANT(constant) constantInteger(#constant##_s, constant)

template<const ClassInfo& classInfo>
static JSValue createConstantsObject(VM& vm, JSObject* owner)
{
    return JSConstantsObject::create(vm, owner->globalObject(), &classInfo);
}

static constexpr HashTableValue errnoTableValues[] = {
#ifdef E2BIG
    CONSTANT(E2BIG),
#endif
#ifdef EACCES
    CONSTANT(EACCES),
#endif
#ifdef EADDRINUSE
    CONSTANT(EADDRINUSE),
#endif
#ifdef EADDRNOTAVAIL
    CONSTANT(EADDRNOTAVAIL),
#endif
#ifdef EAFNOSUPPORT
    CONSTANT(EAFNOSUPPORT),
#endif
#ifdef EAGAIN
    CONSTANT(EAGAIN),
#endif
#ifdef EALREADY
    CONSTANT(EALREADY),
#endif
#ifdef EBADF
    CONSTANT(EBADF),
#endif
#ifdef EBADMSG
    CONSTANT(EBADMSG),
#endif
#ifdef EBUSY
    CONSTANT(EBUSY),
#endif
#ifdef ECANCELED
    CONSTANT(ECANCELED),
#endif
#ifdef ECHILD
    CONSTANT(ECHILD),
#endif
#ifdef ECONNABORTED
    CONSTANT(ECONNABORTED),
#endif
#ifdef ECONNREFUSED
    CONSTANT(ECONNREFUSED),
#endif
#ifdef ECONNRESET
    CONSTANT(ECONNRESET),
#endif
#ifdef EDEADLK
    CONSTANT(EDEADLK),
#endif
#ifdef EDESTADDRREQ
    CONSTANT(EDESTADDRREQ),
#endif
#ifdef EDOM
    CONSTANT(EDOM),
#endif
#ifdef EDQUOT
    CONSTANT(EDQUOT),
#endif
#ifdef EEXIST
    CONSTANT(EEXIST),
#endif
#ifdef EFAULT
    CONSTANT(EFAULT),
#endif
#ifdef EFBIG
    CONSTANT(EFBIG),
#endif
#ifdef EHOSTUNREACH
    CONSTANT(EHOSTUNREACH),
#endif
#ifdef EIDRM
    CONSTANT(EIDRM),
#endif
#ifdef EILSEQ
    CONSTANT(EILSEQ),
#endif
#ifdef EINPROGRESS
    CONSTANT(EINPROGRESS),
#endif
#ifdef EINTR
    CONSTANT(EINTR),
#endif
#ifdef EINVAL
    CONSTANT(EINVAL),
#endif
#ifdef EIO
    CONSTANT(EIO),
#endif
#ifdef EISCONN
    CONSTANT(EISCONN),
#endif
#ifdef EISDIR
    CONSTANT(EISDIR),
#endif
#ifdef ELOOP
    CONSTANT(ELOOP),
#endif
#ifdef EMFILE
    CONSTANT(EMFILE),
#endif
#ifdef EMLINK
    CONSTANT(EMLINK),
#endif
#ifdef EMSGSIZE
    CONSTANT(EMSGSIZE),
#endif
#ifdef EMULTIHOP
    CONSTANT(EMULTIHOP),
#endif
#ifdef ENAMETOOLONG
    CONSTANT(ENAMETOOLONG),
#endif
#ifdef ENETDOWN
    CONSTANT(ENETDOWN),
#endif
#ifdef ENETRESET
    CONSTANT(ENETRESET),
#endif
#ifdef ENETUNREACH
    CONSTANT(ENETUNREACH),
#endif
#ifdef ENFILE
    CONSTANT(ENFILE),
#endif
#ifdef ENOBUFS
    CONSTANT(ENOBUFS),
#endif
#ifdef ENODATA
    CONSTANT(ENODATA),
#endif
#ifdef ENODEV
    CONSTANT(ENODEV),
#endif
#ifdef ENOENT
    CONSTANT(ENOENT),
#endif
#ifdef ENOEXEC
    CONSTANT(ENOEXEC),
#endif
#ifdef ENOLCK
    CONSTANT(ENOLCK),
#endif
#ifdef ENOLINK
    CONSTANT(ENOLINK),
#endif
#ifdef ENOMEM
    CONSTANT(ENOMEM),
#endif
#ifdef ENOMSG
    CONSTANT(ENOMSG),
#endif
#ifdef ENOPROTOOPT
    CONSTANT(ENOPROTOOPT),
#endif
#ifdef ENOSPC
    CONSTANT(ENOSPC),
#endif
#ifdef ENOSR
    CONSTANT(ENOSR),
#endif
#ifdef ENOSTR
    CONSTANT(ENOSTR),
#endif
#ifdef ENOSYS
    CONSTANT(ENOSYS),
#endif
#ifdef ENOTCONN
    CONSTANT(ENOTCONN),
#endif
#ifdef ENOTDIR
    CONSTANT(ENOTDIR),
#endif
#ifdef ENOTEMPTY
    CONSTANT(ENOTEMPTY),
#endif
#ifdef ENOTSOCK
    CONSTANT(ENOTSOCK),
#endif
#ifdef ENOTSUP
    CONSTANT(ENOTSUP),
#endif
#ifdef ENOTTY
    CONSTANT(ENOTTY),
#endif
#ifdef ENXIO
    CONSTANT(ENXIO),
#endif
#ifdef EOPNOTSUPP
    CONSTANT(EOPNOTSUPP),
#endif
#ifdef EOVERFLOW
    CONSTANT(EOVERFLOW),
#endif
#ifdef EPERM
    CONSTANT(EPERM),
#endif
#ifdef EPIPE
    CONSTANT(EPIPE),
#endif
#ifdef EPROTO
    CONSTANT(EPROTO),
#endif
#ifdef EPROTONOSUPPORT
    CONSTANT(EPROTONOSUPPORT),
#endif
#ifdef EPROTOTYPE
    CONSTANT(EPROTOTYPE),
#endif
#ifdef ERANGE
    CONSTANT(ERANGE),
#endif
#ifdef EROFS
    CONSTANT(EROFS),
#endif
#ifdef ESPIPE
    CONSTANT(ESPIPE),
#endif
#ifdef ESRCH
    CONSTANT(ESRCH),
#endif
#ifdef ESTALE
    CONSTANT(ESTALE),
#endif
#ifdef ETIME
    CONSTANT(ETIME),
#endif
#ifdef ETIMEDOUT
    CONSTANT(ETIMEDOUT),
#endif
#ifdef ETXTBSY
    CONSTANT(ETXTBSY),
#endif
#ifdef EWOULDBLOCK
    CONSTANT(EWOULDBLOCK),
#endif
#ifdef EXDEV
    CONSTANT(EXDEV),
#endif
#ifdef WSAEINTR
    CONSTANT(WSAEINTR),
#endif
#ifdef WSAEBADF
    CONSTANT(WSAEBADF),
#endif
#ifdef WSAEACCES
    CONSTANT(WSAEACCES),
#endif
#ifdef WSAEFAULT
    CONSTANT(WSAEFAULT),
#endif
#ifdef WSAEINVAL
    CONSTANT(WSAEINVAL),
#endif
#ifdef WSAEMFILE
    CONSTANT(WSAEMFILE),
#endif
#ifdef WSAEWOULDBLOCK
    CONSTANT(WSAEWOULDBLOCK),
#endif
#ifdef WSAEINPROGRESS
    CONSTANT(WSAEINPROGRESS),
#endif
#ifdef WSAEALREADY
    CONSTANT(WSAEALREADY),
#endif
#ifdef WSAENOTSOCK
    CONSTANT(WSAENOTSOCK),
#endif
#ifdef WSAEDESTADDRREQ
    CONSTANT(WSAEDESTADDRREQ),
#endif
#ifdef WSAEMSGSIZE
    CONSTANT(WSAEMSGSIZE),
#endif
#ifdef WSAEPROTOTYPE
    CONSTANT(WSAEPROTOTYPE),
#endif
#ifdef WSAENOPROTOOPT
    CONSTANT(WSAENOPROTOOPT),
#endif
#ifdef WSAEPROTONOSUPPORT
    CONSTANT(WSAEPROTONOSUPPORT),
#endif
#ifdef WSAESOCKTNOSUPPORT
    CONSTANT(WSAESOCKTNOSUPPORT),
#endif
#ifdef WSAEOPNOTSUPP
    CONSTANT(WSAEOPNOTSUPP),
#endif
#ifdef WSAEPFNOSUPPORT
    CONSTANT(WSAEPFNOSUPPORT),
#endif
#ifdef WSAEAFNOSUPPORT
    CONSTANT(WSAEAFNOSUPPORT),
#endif
#ifdef WSAEADDRINUSE
    CONSTANT(WSAEADDRINUSE),
#endif
#ifdef WSAEADDRNOTAVAIL
    CONSTANT(WSAEADDRNOTAVAIL),
#endif
#ifdef WSAENETDOWN
    CONSTANT(WSAENETDOWN),
#endif
#ifdef WSAENETUNREACH
    CONSTANT(WSAENETUNREACH),
#endif
#ifdef WSAENETRESET
    CONSTANT(WSAENETRESET),
#endif
#ifdef WSAECONNABORTED
    CONSTANT(WSAECONNABORTED),
#endif
#ifdef WSAECONNRESET
    CONSTANT(WSAECONNRESET),
#endif
#ifdef WSAENOBUFS
    CONSTANT(WSAENOBUFS),
#endif
#ifdef WSAEISCONN
    CONSTANT(WSAEISCONN),
#endif
#ifdef WSAENOTCONN
    CONSTANT(WSAENOTCONN),
#endif
#ifdef WSAESHUTDOWN
    CONSTANT(WSAESHUTDOWN),
#endif
#ifdef WSAETOOMANYREFS
    CONSTANT(WSAETOOMANYREFS),
#endif
#ifdef WSAETIMEDOUT
    CONSTANT(WSAETIMEDOUT),
#endif
#ifdef WSAECONNREFUSED
    CONSTANT(WSAECONNREFUSED),
#endif
#ifdef WSAELOOP
    CONSTANT(WSAELOOP),
#endif
#ifdef WSAENAMETOOLONG
    CONSTANT(WSAENAMETOOLONG),
#endif
#ifdef WSAEHOSTDOWN
    CONSTANT(WSAEHOSTDOWN),
#endif
#ifdef WSAEHOSTUNREACH
    CONSTANT(WSAEHOSTUNREACH),
#endif
#ifdef WSAENOTEMPTY
    CONSTANT(WSAENOTEMPTY),
#endif
#ifdef WSAEPROCLIM
    CONSTANT(WSAEPROCLIM),
#endif
#ifdef WSAEUSERS
    CONSTANT(WSAEUSERS),
#endif
#ifdef WSAEDQUOT
    CONSTANT(WSAEDQUOT),
#endif
#ifdef WSAESTALE
    CONSTANT(WSAESTALE),
#endif
#ifdef WSAEREMOTE
    CONSTANT(WSAEREMOTE),
#endif
#ifdef WSASYSNOTREADY
    CONSTANT(WSASYSNOTREADY),
#endif
#ifdef WSAVERNOTSUPPORTED
    CONSTANT(WSAVERNOTSUPPORTED),
#endif
#ifdef WSANOTINITIALISED
    CONSTANT(WSANOTINITIALISED),
#endif
#ifdef WSAEDISCON
    CONSTANT(WSAEDISCON),
#endif
#ifdef WSAENOMORE
    CONSTANT(WSAENOMORE),
#endif
#ifdef WSAECANCELLED
    CONSTANT(WSAECANCELLED),
#endif
#ifdef WSAEINVALIDPROCTABLE
    CONSTANT(WSAEINVALIDPROCTABLE),
#endif
#ifdef WSAEINVALIDPROVIDER
    CONSTANT(WSAEINVALIDPROVIDER),
#endif
#ifdef WSAEPROVIDERFAILEDINIT
    CONSTANT(WSAEPROVIDERFAILEDINIT),
#endif
#ifdef WSASYSCALLFAILURE
    CONSTANT(WSASYSCALLFAILURE),
#endif
#ifdef WSASERVICE_NOT_FOUND
    CONSTANT(WSASERVICE_NOT_FOUND),
#endif
#ifdef WSATYPE_NOT_FOUND
    CONSTANT(WSATYPE_NOT_FOUND),
#endif
#ifdef WSA_E_NO_MORE
    CONSTANT(WSA_E_NO_MORE),
#endif
#ifdef WSA_E_CANCELLED
    CONSTANT(WSA_E_CANCELLED),
#endif
#ifdef WSAEREFUSED
    CONSTANT(WSAEREFUSED),
#endif
};
static constexpr ClassInfo errnoClassInfo = JSConstantsObject::classInfoFor(&StaticHashTable<errnoTableValues>::table);

static constexpr HashTableValue signalsTableValues[] = {
#ifdef SIGHUP
    CONSTANT(SIGHUP),
#endif
#ifdef SIGINT
    CONSTANT(SIGINT),
#endif
#ifdef SIGQUIT
    CONSTANT(SIGQUIT),
#endif
#ifdef SIGILL
    CONSTANT(SIGILL),
#endif
#ifdef SIGTRAP
    CONSTANT(SIGTRAP),
#endif
#ifdef SIGABRT
    CONSTANT(SIGABRT),
#endif
#ifdef SIGIOT
    CONSTANT(SIGIOT),
#endif
#ifdef SIGBUS
    CONSTANT(SIGBUS),
#endif
#ifdef SIGFPE
    CONSTANT(SIGFPE),
#endif
#ifdef SIGKILL
    CONSTANT(SIGKILL),
#endif
#ifdef SIGUSR1
    CONSTANT(SIGUSR1),
#endif
#ifdef SIGSEGV
    CONSTANT(SIGSEGV),
#endif
#ifdef SIGUSR2
    CONSTANT(SIGUSR2),
#endif
#ifdef SIGPIPE
    CONSTANT(SIGPIPE),
#endif
#ifdef SIGALRM
    CONSTANT(SIGALRM),
#endif
#ifdef SIGTERM
    CONSTANT(SIGTERM),
#endif
#ifdef SIGCHLD
    CONSTANT(SIGCHLD),
#endif
#ifdef SIGSTKFLT
    CONSTANT(SIGSTKFLT),
#endif
#ifdef SIGCONT
    CONSTANT(SIGCONT),
#endif
#ifdef SIGSTOP
    CONSTANT(SIGSTOP),
#endif
#ifdef SIGTSTP
    CONSTANT(SIGTSTP),
#endif
#ifdef SIGBREAK
    CONSTANT(SIGBREAK),
#endif
#ifdef SIGTTIN
    CONSTANT(SIGTTIN),
#endif
#ifdef SIGTTOU
    CONSTANT(SIGTTOU),
#endif
#ifdef SIGURG
    CONSTANT(SIGURG),
#endif
#ifdef SIGXCPU
    CONSTANT(SIGXCPU),
#endif
#ifdef SIGXFSZ
    CONSTANT(SIGXFSZ),
#endif
#ifdef SIGVTALRM
    CONSTANT(SIGVTALRM),
#endif
#ifdef SIGPROF
    CONSTANT(SIGPROF),
#endif
#ifdef SIGWINCH
    CONSTANT(SIGWINCH),
#endif
#ifdef SIGIO
    CONSTANT(SIGIO),
#endif
#ifdef SIGPOLL
    CONSTANT(SIGPOLL),
#endif
#ifdef SIGLOST
    CONSTANT(SIGLOST),
#endif
#ifdef SIGPWR
    CONSTANT(SIGPWR),
#endif
#ifdef SIGINFO
    CONSTANT(SIGINFO),
#endif
#ifdef SIGSYS
    CONSTANT(SIGSYS),
#endif
#ifdef SIGUNUSED
    CONSTANT(SIGUNUSED),
#endif
};
static constexpr ClassInfo signalsClassInfo = JSConstantsObject::classInfoFor(&StaticHashTable<signalsTableValues>::table);

static constexpr HashTableValue priorityTableValues[] = {
    constantInteger("PRIORITY_LOW"_s, 19),
    constantInteger("PRIORITY_BELOW_NORMAL"_s, 10),
    constantInteger("PRIORITY_NORMAL"_s, 0),
    constantInteger("PRIORITY_ABOVE_NORMAL"_s, -7),
    constantInteger("PRIORITY_HIGH"_s, -14),
    constantInteger("PRIORITY_HIGHEST"_s, -20),
};
static constexpr ClassInfo priorityClassInfo = JSConstantsObject::classInfoFor(&StaticHashTable<priorityTableValues>::table);

#if OS(WINDOWS)
// No dlfcn.h: node exposes an empty object.
static JSValue createDlopenConstants(VM& vm, JSObject* owner)
{
    return constructEmptyObject(vm, owner->globalObject()->nullPrototypeObjectStructure());
}
#else
static constexpr HashTableValue dlopenTableValues[] = {
#ifdef RTLD_LAZY
    CONSTANT(RTLD_LAZY),
#endif
#ifdef RTLD_NOW
    CONSTANT(RTLD_NOW),
#endif
#ifdef RTLD_GLOBAL
    CONSTANT(RTLD_GLOBAL),
#endif
#ifdef RTLD_LOCAL
    CONSTANT(RTLD_LOCAL),
#endif
#ifdef RTLD_DEEPBIND
    CONSTANT(RTLD_DEEPBIND),
#endif
};
static constexpr ClassInfo dlopenClassInfo = JSConstantsObject::classInfoFor(&StaticHashTable<dlopenTableValues>::table);
static constexpr LazyPropertyCallback createDlopenConstants = createConstantsObject<dlopenClassInfo>;
#endif

static constexpr HashTableValue osTableValues[] = {
    constantInteger("UV_UDP_REUSEADDR"_s, 4),
    propertyCallback("dlopen"_s, createDlopenConstants),
    propertyCallback("errno"_s, createConstantsObject<errnoClassInfo>),
    propertyCallback("signals"_s, createConstantsObject<signalsClassInfo>),
    propertyCallback("priority"_s, createConstantsObject<priorityClassInfo>),
};
static constexpr ClassInfo osClassInfo = JSConstantsObject::classInfoFor(&StaticHashTable<osTableValues>::table);

static constexpr HashTableValue traceTableValues[] = {
    constantInteger("TRACE_EVENT_PHASE_BEGIN"_s, 66),
    constantInteger("TRACE_EVENT_PHASE_END"_s, 69),
    constantInteger("TRACE_EVENT_PHASE_COMPLETE"_s, 88),
    constantInteger("TRACE_EVENT_PHASE_INSTANT"_s, 73),
    constantInteger("TRACE_EVENT_PHASE_ASYNC_BEGIN"_s, 83),
    constantInteger("TRACE_EVENT_PHASE_ASYNC_STEP_INTO"_s, 84),
    constantInteger("TRACE_EVENT_PHASE_ASYNC_STEP_PAST"_s, 112),
    constantInteger("TRACE_EVENT_PHASE_ASYNC_END"_s, 70),
    constantInteger("TRACE_EVENT_PHASE_NESTABLE_ASYNC_BEGIN"_s, 98),
    constantInteger("TRACE_EVENT_PHASE_NESTABLE_ASYNC_END"_s, 101),
    constantInteger("TRACE_EVENT_PHASE_NESTABLE_ASYNC_INSTANT"_s, 110),
    constantInteger("TRACE_EVENT_PHASE_FLOW_BEGIN"_s, 115),
    constantInteger("TRACE_EVENT_PHASE_FLOW_STEP"_s, 116),
    constantInteger("TRACE_EVENT_PHASE_FLOW_END"_s, 102),
    constantInteger("TRACE_EVENT_PHASE_METADATA"_s, 77),
    constantInteger("TRACE_EVENT_PHASE_COUNTER"_s, 67),
    constantInteger("TRACE_EVENT_PHASE_SAMPLE"_s, 80),
    constantInteger("TRACE_EVENT_PHASE_CREATE_OBJECT"_s, 78),
    constantInteger("TRACE_EVENT_PHASE_SNAPSHOT_OBJECT"_s, 79),
    constantInteger("TRACE_EVENT_PHASE_DELETE_OBJECT"_s, 68),
    constantInteger("TRACE_EVENT_PHASE_MEMORY_DUMP"_s, 118),
    constantInteger("TRACE_EVENT_PHASE_MARK"_s, 82),
    constantInteger("TRACE_EVENT_PHASE_CLOCK_SYNC"_s, 99),
    constantInteger("TRACE_EVENT_PHASE_ENTER_CONTEXT"_s, 40),
    constantInteger("TRACE_EVENT_PHASE_LEAVE_CONTEXT"_s, 41),
    constantInteger("TRACE_EVENT_PHASE_LINK_IDS"_s, 61),
};
static constexpr ClassInfo traceClassInfo = JSConstantsObject::classInfoFor(&StaticHashTable<traceTableValues>::table);

static constexpr HashTableValue fsTableValues[] = {
    constantInteger("UV_FS_SYMLINK_DIR"_s, 1),
    constantInteger("UV_FS_SYMLINK_JUNCTION"_s, 2),
    CONSTANT(O_RDONLY),
    CONSTANT(O_WRONLY),
    CONSTANT(O_RDWR),

    constantInteger("UV_DIRENT_UNKNOWN"_s, 0),
    constantInteger("UV_DIRENT_FILE"_s, 1),
    constantInteger("UV_DIRENT_DIR"_s, 2),
    constantInteger("UV_DIRENT_LINK"_s, 3),
    constantInteger("UV_DIRENT_FIFO"_s, 4),
    constantInteger("UV_DIRENT_SOCKET"_s, 5),
    constantInteger("UV_DIRENT_CHAR"_s, 6),
    constantInteger("UV_DIRENT_BLOCK"_s, 7),

    CONSTANT(S_IFMT),
    CONSTANT(S_IFREG),
    CONSTANT(S_IFDIR),
    CONSTANT(S_IFCHR),
#ifdef S_IFBLK
    CONSTANT(S_IFBLK),
#endif
#ifdef S_IFIFO
    CONSTANT(S_IFIFO),
#endif
#ifdef S_IFLNK
    CONSTANT(S_IFLNK),
#endif
#ifdef S_IFSOCK
    CONSTANT(S_IFSOCK),
#endif
#ifdef O_CREAT
    CONSTANT(O_CREAT),
#endif
#ifdef O_EXCL
    CONSTANT(O_EXCL),
#endif
#if OS(WINDOWS)
    constantInteger("UV_FS_O_FILEMAP"_s, 536870912),
#else
    constantInteger("UV_FS_O_FILEMAP"_s, 0),
#endif
#ifdef O_NOCTTY
    CONSTANT(O_NOCTTY),
#endif
#ifdef O_TRUNC
    CONSTANT(O_TRUNC),
#endif
#ifdef O_APPEND
    CONSTANT(O_APPEND),
#endif
#ifdef O_DIRECTORY
    CONSTANT(O_DIRECTORY),
#endif
#ifdef O_NOATIME
    CONSTANT(O_NOATIME),
#endif
#ifdef O_NOFOLLOW
    CONSTANT(O_NOFOLLOW),
#endif
#ifdef O_SYNC
    CONSTANT(O_SYNC),
#endif
#ifdef O_DSYNC
    CONSTANT(O_DSYNC),
#endif
#ifdef O_SYMLINK
    CONSTANT(O_SYMLINK),
#endif
#ifdef O_DIRECT
    CONSTANT(O_DIRECT),
#endif
#ifdef O_NONBLOCK
    CONSTANT(O_NONBLOCK),
#endif
#ifdef S_IRWXU
    CONSTANT(S_IRWXU),
#endif
#ifdef S_IRUSR
    CONSTANT(S_IRUSR),
#endif
#ifdef S_IWUSR
    CONSTANT(S_IWUSR),
#endif
#ifdef S_IXUSR
    CONSTANT(S_IXUSR),
#endif
#ifdef S_IRWXG
    CONSTANT(S_IRWXG),
#endif
#ifdef S_IRGRP
    CONSTANT(S_IRGRP),
#endif
#ifdef S_IWGRP
    CONSTANT(S_IWGRP),
#endif
#ifdef S_IXGRP
    CONSTANT(S_IXGRP),
#endif
#ifdef S_IRWXO
    CONSTANT(S_IRWXO),
#endif
#ifdef S_IROTH
    CONSTANT(S_IROTH),
#endif
#ifdef S_IWOTH
    CONSTANT(S_IWOTH),
#endif
#ifdef S_IXOTH
    CONSTANT(S_IXOTH),
#endif
#ifdef F_OK
    CONSTANT(F_OK),
#endif
#ifdef R_OK
    CONSTANT(R_OK),
#endif
#ifdef W_OK
    CONSTANT(W_OK),
#endif
#ifdef X_OK
    CONSTANT(X_OK),
#endif
    constantInteger("UV_FS_COPYFILE_EXCL"_s, 1),
    constantInteger("COPYFILE_EXCL"_s, 1),
    constantInteger("UV_FS_COPYFILE_FICLONE"_s, 2),
    constantInteger("COPYFILE_FICLONE"_s, 2),
    constantInteger("UV_FS_COPYFILE_FICLONE_FORCE"_s, 4),
    constantInteger("COPYFILE_FICLONE_FORCE"_s, 4),

    constantInteger("EXTENSIONLESS_FORMAT_JAVASCRIPT"_s, 0),
    constantInteger("EXTENSIONLESS_FORMAT_WASM"_s, 1),
};
static constexpr ClassInfo fsClassInfo = JSConstantsObject::classInfoFor(&StaticHashTable<fsTableValues>::table);

static constexpr ASCIILiteral defaultCipherList = "TLS_AES_256_GCM_SHA384:"
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
                                                  "!CAMELLIA"_s;

static JSValue createDefaultCipherList(VM& vm, JSObject*)
{
    return jsString(vm, String(defaultCipherList));
}

static constexpr HashTableValue cryptoTableValues[] = {
#ifdef OPENSSL_VERSION_NUMBER
    CONSTANT(OPENSSL_VERSION_NUMBER),
#endif
#ifdef SSL_OP_ALL
    CONSTANT(SSL_OP_ALL),
#endif
#ifdef SSL_OP_ALLOW_NO_DHE_KEX
    CONSTANT(SSL_OP_ALLOW_NO_DHE_KEX),
#else
    constantInteger("SSL_OP_ALLOW_NO_DHE_KEX"_s, 0),
#endif
#ifdef SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION
    CONSTANT(SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION),
#endif
#ifdef SSL_OP_CIPHER_SERVER_PREFERENCE
    CONSTANT(SSL_OP_CIPHER_SERVER_PREFERENCE),
#endif
#ifdef SSL_OP_CISCO_ANYCONNECT
    CONSTANT(SSL_OP_CISCO_ANYCONNECT),
#else
    constantInteger("SSL_OP_CISCO_ANYCONNECT"_s, 0),
#endif
#ifdef SSL_OP_COOKIE_EXCHANGE
    CONSTANT(SSL_OP_COOKIE_EXCHANGE),
#else
    constantInteger("SSL_OP_COOKIE_EXCHANGE"_s, 0),
#endif
#ifdef SSL_OP_CRYPTOPRO_TLSEXT_BUG
    CONSTANT(SSL_OP_CRYPTOPRO_TLSEXT_BUG),
#else
    constantInteger("SSL_OP_CRYPTOPRO_TLSEXT_BUG"_s, 0),
#endif
#ifdef SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS
    CONSTANT(SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS),
#endif
#ifdef SSL_OP_LEGACY_SERVER_CONNECT
    CONSTANT(SSL_OP_LEGACY_SERVER_CONNECT),
#endif
#ifdef SSL_OP_NO_COMPRESSION
    CONSTANT(SSL_OP_NO_COMPRESSION),
#endif
#ifdef SSL_OP_NO_ENCRYPT_THEN_MAC
    CONSTANT(SSL_OP_NO_ENCRYPT_THEN_MAC),
#else
    constantInteger("SSL_OP_NO_ENCRYPT_THEN_MAC"_s, 0),
#endif
#ifdef SSL_OP_NO_QUERY_MTU
    CONSTANT(SSL_OP_NO_QUERY_MTU),
#endif
#ifdef SSL_OP_NO_RENEGOTIATION
    CONSTANT(SSL_OP_NO_RENEGOTIATION),
#endif
#ifdef SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION
    CONSTANT(SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION),
#endif
#ifdef SSL_OP_NO_SSLv2
    CONSTANT(SSL_OP_NO_SSLv2),
#endif
#ifdef SSL_OP_NO_SSLv3
    CONSTANT(SSL_OP_NO_SSLv3),
#endif
#ifdef SSL_OP_NO_TICKET
    CONSTANT(SSL_OP_NO_TICKET),
#endif
#ifdef SSL_OP_NO_TLSv1
    CONSTANT(SSL_OP_NO_TLSv1),
#endif
#ifdef SSL_OP_NO_TLSv1_1
    CONSTANT(SSL_OP_NO_TLSv1_1),
#endif
#ifdef SSL_OP_NO_TLSv1_2
    CONSTANT(SSL_OP_NO_TLSv1_2),
#endif
#ifdef SSL_OP_NO_TLSv1_3
    CONSTANT(SSL_OP_NO_TLSv1_3),
#endif
#ifdef SSL_OP_PRIORITIZE_CHACHA
    CONSTANT(SSL_OP_PRIORITIZE_CHACHA),
#else
    constantInteger("SSL_OP_PRIORITIZE_CHACHA"_s, 0),
#endif
#ifdef SSL_OP_TLS_ROLLBACK_BUG
    CONSTANT(SSL_OP_TLS_ROLLBACK_BUG),
#endif
    // OBSOLETE OPTIONS retained for compatibility
    constantInteger("SSL_OP_MICROSOFT_SESS_ID_BUG"_s, 0),
    constantInteger("SSL_OP_NETSCAPE_CHALLENGE_BUG"_s, 0),
    constantInteger("SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG"_s, 0),
    constantInteger("SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG"_s, 0),
    constantInteger("SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER"_s, 0),
    constantInteger("SSL_OP_MSIE_SSLV2_RSA_PADDING"_s, 0),
    constantInteger("SSL_OP_SSLEAY_080_CLIENT_DH_BUG"_s, 0),
    constantInteger("SSL_OP_TLS_D5_BUG"_s, 0),
    constantInteger("SSL_OP_TLS_BLOCK_PADDING_BUG"_s, 0),
    constantInteger("SSL_OP_SINGLE_ECDH_USE"_s, 0),
    constantInteger("SSL_OP_SINGLE_DH_USE"_s, 0),
    constantInteger("SSL_OP_EPHEMERAL_RSA"_s, 0),
#ifndef SSL_OP_NO_SSLv2
    constantInteger("SSL_OP_NO_SSLv2"_s, 0),
#endif
    constantInteger("SSL_OP_PKCS1_CHECK_1"_s, 0),
    constantInteger("SSL_OP_PKCS1_CHECK_2"_s, 0),
    constantInteger("SSL_OP_NETSCAPE_CA_DN_BUG"_s, 0),
    constantInteger("SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG"_s, 0),
    // BoringSSL does not define engine constants in openssl/engine.h
    constantInteger("ENGINE_METHOD_RSA"_s, 0x0001),
    constantInteger("ENGINE_METHOD_DSA"_s, 0x0002),
    constantInteger("ENGINE_METHOD_DH"_s, 0x0004),
    constantInteger("ENGINE_METHOD_RAND"_s, 0x0008),
    constantInteger("ENGINE_METHOD_CIPHERS"_s, 0x0040),
    constantInteger("ENGINE_METHOD_DIGESTS"_s, 0x0080),
    constantInteger("ENGINE_METHOD_PKEY_METHS"_s, 0x0200),
    constantInteger("ENGINE_METHOD_PKEY_ASN1_METHS"_s, 0x0400),
    constantInteger("ENGINE_METHOD_EC"_s, 0x0800),
    constantInteger("ENGINE_METHOD_ALL"_s, 0xFFFF),
    constantInteger("ENGINE_METHOD_NONE"_s, 0x0000),
#ifdef DH_CHECK_P_NOT_SAFE_PRIME
    CONSTANT(DH_CHECK_P_NOT_SAFE_PRIME),
#endif
#ifdef DH_CHECK_P_NOT_PRIME
    CONSTANT(DH_CHECK_P_NOT_PRIME),
#endif
#ifdef DH_UNABLE_TO_CHECK_GENERATOR
    CONSTANT(DH_UNABLE_TO_CHECK_GENERATOR),
#endif
#ifdef DH_NOT_SUITABLE_GENERATOR
    CONSTANT(DH_NOT_SUITABLE_GENERATOR),
#endif
#ifdef RSA_PKCS1_PADDING
    CONSTANT(RSA_PKCS1_PADDING),
#endif
#ifdef RSA_SSLV23_PADDING
    CONSTANT(RSA_SSLV23_PADDING),
#endif
#ifdef RSA_NO_PADDING
    CONSTANT(RSA_NO_PADDING),
#endif
#ifdef RSA_PKCS1_OAEP_PADDING
    CONSTANT(RSA_PKCS1_OAEP_PADDING),
#endif
#ifdef RSA_X931_PADDING
    CONSTANT(RSA_X931_PADDING),
#else
    constantInteger("RSA_X931_PADDING"_s, 5),
#endif
#ifdef RSA_PKCS1_PSS_PADDING
    CONSTANT(RSA_PKCS1_PSS_PADDING),
#endif
#ifdef RSA_PSS_SALTLEN_DIGEST
    CONSTANT(RSA_PSS_SALTLEN_DIGEST),
#else
    constantInteger("RSA_PSS_SALTLEN_DIGEST"_s, -1),
#endif
#ifdef RSA_PSS_SALTLEN_MAX_SIGN
    CONSTANT(RSA_PSS_SALTLEN_MAX_SIGN),
#else
    constantInteger("RSA_PSS_SALTLEN_MAX_SIGN"_s, -2),
#endif
#ifdef RSA_PSS_SALTLEN_AUTO
    CONSTANT(RSA_PSS_SALTLEN_AUTO),
#else
    constantInteger("RSA_PSS_SALTLEN_AUTO"_s, -2),
#endif
    propertyCallback("defaultCoreCipherList"_s, createDefaultCipherList),
    propertyCallback("defaultCipherList"_s, createDefaultCipherList),
    CONSTANT(TLS1_VERSION),
    CONSTANT(TLS1_1_VERSION),
    CONSTANT(TLS1_2_VERSION),
    CONSTANT(TLS1_3_VERSION),
    CONSTANT(POINT_CONVERSION_COMPRESSED),
    CONSTANT(POINT_CONVERSION_UNCOMPRESSED),
    CONSTANT(POINT_CONVERSION_HYBRID),
};
static constexpr ClassInfo cryptoClassInfo = JSConstantsObject::classInfoFor(&StaticHashTable<cryptoTableValues>::table);

// Z_MAX_CHUNK is Infinity, the one value in these tables that is not an integer.
static JSValue zlibMaxChunk(VM&, JSObject*)
{
    return jsNumber(std::numeric_limits<double>::infinity());
}

static constexpr HashTableValue zlibTableValues[] = {
    CONSTANT(Z_NO_FLUSH),
    CONSTANT(Z_PARTIAL_FLUSH),
    CONSTANT(Z_SYNC_FLUSH),
    CONSTANT(Z_FULL_FLUSH),
    CONSTANT(Z_FINISH),
    CONSTANT(Z_BLOCK),

    CONSTANT(Z_OK),
    CONSTANT(Z_STREAM_END),
    CONSTANT(Z_NEED_DICT),
    CONSTANT(Z_ERRNO),
    CONSTANT(Z_STREAM_ERROR),
    CONSTANT(Z_DATA_ERROR),
    CONSTANT(Z_MEM_ERROR),
    CONSTANT(Z_BUF_ERROR),
    CONSTANT(Z_VERSION_ERROR),

    CONSTANT(Z_NO_COMPRESSION),
    CONSTANT(Z_BEST_SPEED),
    CONSTANT(Z_BEST_COMPRESSION),
    CONSTANT(Z_DEFAULT_COMPRESSION),
    CONSTANT(Z_FILTERED),
    CONSTANT(Z_HUFFMAN_ONLY),
    CONSTANT(Z_RLE),
    CONSTANT(Z_FIXED),
    CONSTANT(Z_DEFAULT_STRATEGY),
    CONSTANT(ZLIB_VERNUM),

    constantInteger("DEFLATE"_s, 1),
    constantInteger("INFLATE"_s, 2),
    constantInteger("GZIP"_s, 3),
    constantInteger("GUNZIP"_s, 4),
    constantInteger("DEFLATERAW"_s, 5),
    constantInteger("INFLATERAW"_s, 6),
    constantInteger("UNZIP"_s, 7),
    constantInteger("BROTLI_DECODE"_s, 8),
    constantInteger("BROTLI_ENCODE"_s, 9),
    constantInteger("ZSTD_COMPRESS"_s, 10),
    constantInteger("ZSTD_DECOMPRESS"_s, 11),

    constantInteger("Z_MIN_WINDOWBITS"_s, 8),
    constantInteger("Z_MAX_WINDOWBITS"_s, 15),
    constantInteger("Z_DEFAULT_WINDOWBITS"_s, 15),
    constantInteger("Z_MIN_CHUNK"_s, 64),
    propertyCallback("Z_MAX_CHUNK"_s, zlibMaxChunk),
    constantInteger("Z_DEFAULT_CHUNK"_s, 16 * 1024),
    constantInteger("Z_MIN_MEMLEVEL"_s, 1),
    constantInteger("Z_MAX_MEMLEVEL"_s, 9),
    constantInteger("Z_DEFAULT_MEMLEVEL"_s, 8),
    constantInteger("Z_MIN_LEVEL"_s, -1),
    constantInteger("Z_MAX_LEVEL"_s, 9),
    constantInteger("Z_DEFAULT_LEVEL"_s, Z_DEFAULT_COMPRESSION),

    CONSTANT(BROTLI_OPERATION_PROCESS),
    CONSTANT(BROTLI_OPERATION_FLUSH),
    CONSTANT(BROTLI_OPERATION_FINISH),
    CONSTANT(BROTLI_OPERATION_EMIT_METADATA),
    CONSTANT(BROTLI_PARAM_MODE),
    CONSTANT(BROTLI_MODE_GENERIC),
    CONSTANT(BROTLI_MODE_TEXT),
    CONSTANT(BROTLI_MODE_FONT),
    CONSTANT(BROTLI_DEFAULT_MODE),
    CONSTANT(BROTLI_PARAM_QUALITY),
    CONSTANT(BROTLI_MIN_QUALITY),
    CONSTANT(BROTLI_MAX_QUALITY),
    CONSTANT(BROTLI_DEFAULT_QUALITY),
    CONSTANT(BROTLI_PARAM_LGWIN),
    CONSTANT(BROTLI_MIN_WINDOW_BITS),
    CONSTANT(BROTLI_MAX_WINDOW_BITS),
    CONSTANT(BROTLI_LARGE_MAX_WINDOW_BITS),
    CONSTANT(BROTLI_DEFAULT_WINDOW),
    CONSTANT(BROTLI_PARAM_LGBLOCK),
    CONSTANT(BROTLI_MIN_INPUT_BLOCK_BITS),
    CONSTANT(BROTLI_MAX_INPUT_BLOCK_BITS),
    CONSTANT(BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING),
    CONSTANT(BROTLI_PARAM_SIZE_HINT),
    CONSTANT(BROTLI_PARAM_LARGE_WINDOW),
    CONSTANT(BROTLI_PARAM_NPOSTFIX),
    CONSTANT(BROTLI_PARAM_NDIRECT),
    CONSTANT(BROTLI_DECODER_RESULT_ERROR),
    CONSTANT(BROTLI_DECODER_RESULT_SUCCESS),
    CONSTANT(BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT),
    CONSTANT(BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT),
    CONSTANT(BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION),
    CONSTANT(BROTLI_DECODER_PARAM_LARGE_WINDOW),
    CONSTANT(BROTLI_DECODER_NO_ERROR),
    CONSTANT(BROTLI_DECODER_SUCCESS),
    CONSTANT(BROTLI_DECODER_NEEDS_MORE_INPUT),
    CONSTANT(BROTLI_DECODER_NEEDS_MORE_OUTPUT),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_RESERVED),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_CL_SPACE),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_TRANSFORM),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_DICTIONARY),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_PADDING_1),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_PADDING_2),
    CONSTANT(BROTLI_DECODER_ERROR_FORMAT_DISTANCE),
    CONSTANT(BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET),
    CONSTANT(BROTLI_DECODER_ERROR_INVALID_ARGUMENTS),
    CONSTANT(BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES),
    CONSTANT(BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS),
    CONSTANT(BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP),
    CONSTANT(BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1),
    CONSTANT(BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2),
    CONSTANT(BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES),
    CONSTANT(BROTLI_DECODER_ERROR_UNREACHABLE),

    CONSTANT(ZSTD_e_continue),
    CONSTANT(ZSTD_e_flush),
    CONSTANT(ZSTD_e_end),
    CONSTANT(ZSTD_fast),
    CONSTANT(ZSTD_dfast),
    CONSTANT(ZSTD_greedy),
    CONSTANT(ZSTD_lazy),
    CONSTANT(ZSTD_lazy2),
    CONSTANT(ZSTD_btlazy2),
    CONSTANT(ZSTD_btopt),
    CONSTANT(ZSTD_btultra),
    CONSTANT(ZSTD_btultra2),
    CONSTANT(ZSTD_c_compressionLevel),
    CONSTANT(ZSTD_c_windowLog),
    CONSTANT(ZSTD_c_hashLog),
    CONSTANT(ZSTD_c_chainLog),
    CONSTANT(ZSTD_c_searchLog),
    CONSTANT(ZSTD_c_minMatch),
    CONSTANT(ZSTD_c_targetLength),
    CONSTANT(ZSTD_c_strategy),
    CONSTANT(ZSTD_c_enableLongDistanceMatching),
    CONSTANT(ZSTD_c_ldmHashLog),
    CONSTANT(ZSTD_c_ldmMinMatch),
    CONSTANT(ZSTD_c_ldmBucketSizeLog),
    CONSTANT(ZSTD_c_ldmHashRateLog),
    CONSTANT(ZSTD_c_contentSizeFlag),
    CONSTANT(ZSTD_c_checksumFlag),
    CONSTANT(ZSTD_c_dictIDFlag),
    CONSTANT(ZSTD_c_nbWorkers),
    CONSTANT(ZSTD_c_jobSize),
    CONSTANT(ZSTD_c_overlapLog),
    CONSTANT(ZSTD_d_windowLogMax),
    CONSTANT(ZSTD_CLEVEL_DEFAULT),

    CONSTANT(ZSTD_error_no_error),
    CONSTANT(ZSTD_error_GENERIC),
    CONSTANT(ZSTD_error_prefix_unknown),
    CONSTANT(ZSTD_error_version_unsupported),
    CONSTANT(ZSTD_error_frameParameter_unsupported),
    CONSTANT(ZSTD_error_frameParameter_windowTooLarge),
    CONSTANT(ZSTD_error_corruption_detected),
    CONSTANT(ZSTD_error_checksum_wrong),
    CONSTANT(ZSTD_error_literals_headerWrong),
    CONSTANT(ZSTD_error_dictionary_corrupted),
    CONSTANT(ZSTD_error_dictionary_wrong),
    CONSTANT(ZSTD_error_dictionaryCreation_failed),
    CONSTANT(ZSTD_error_parameter_unsupported),
    CONSTANT(ZSTD_error_parameter_combination_unsupported),
    CONSTANT(ZSTD_error_parameter_outOfBound),
    CONSTANT(ZSTD_error_tableLog_tooLarge),
    CONSTANT(ZSTD_error_maxSymbolValue_tooLarge),
    CONSTANT(ZSTD_error_maxSymbolValue_tooSmall),
    CONSTANT(ZSTD_error_stabilityCondition_notRespected),
    CONSTANT(ZSTD_error_stage_wrong),
    CONSTANT(ZSTD_error_init_missing),
    CONSTANT(ZSTD_error_memory_allocation),
    CONSTANT(ZSTD_error_workSpace_tooSmall),
    CONSTANT(ZSTD_error_dstSize_tooSmall),
    CONSTANT(ZSTD_error_srcSize_wrong),
    CONSTANT(ZSTD_error_dstBuffer_null),
    CONSTANT(ZSTD_error_noForwardProgress_destFull),
    CONSTANT(ZSTD_error_noForwardProgress_inputEmpty),
};
static constexpr ClassInfo zlibClassInfo = JSConstantsObject::classInfoFor(&StaticHashTable<zlibTableValues>::table);

#undef CONSTANT

static constexpr LazyPropertyCallback processBindingConstantsGetOs = createConstantsObject<osClassInfo>;
static constexpr LazyPropertyCallback processBindingConstantsGetFs = createConstantsObject<fsClassInfo>;
static constexpr LazyPropertyCallback processBindingConstantsGetCrypto = createConstantsObject<cryptoClassInfo>;
static constexpr LazyPropertyCallback processBindingConstantsGetZlib = createConstantsObject<zlibClassInfo>;
static constexpr LazyPropertyCallback processBindingConstantsGetTrace = createConstantsObject<traceClassInfo>;

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
