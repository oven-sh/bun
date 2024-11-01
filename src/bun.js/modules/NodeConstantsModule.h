#include "_NativeModule.h"
// Modelled off of
// https://github.com/nodejs/node/blob/main/src/node_constants.cc Note that if
// you change any of this code, you probably also have to change
// ProcessBindingConstants.cpp

// require('constants') is implemented in node as a spread of:
//  - constants.os.dlopen
//  - constants.os.errno
//  - constants.os.priority
//  - constants.os.signals
//  - constants.fs
//  - constants.crypto
// Instead of loading $processBindingConstants, we just inline it

// These headers may not all be needed, but they are the ones node references.
// Most of the constants are defined with #if checks on existing #defines,
// instead of platform-checks
#include <cerrno>
#include <csignal>
#include <fcntl.h>
#include <limits>
#include <openssl/ec.h>
#include <openssl/ssl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <zlib.h>

#ifndef OPENSSL_NO_ENGINE
#include <openssl/engine.h>
#endif

#if !defined(_MSC_VER)
#include <unistd.h>
#endif

#if defined(_WIN32)
#include <io.h> // _S_IREAD _S_IWRITE
#ifndef S_IRUSR
#define S_IRUSR _S_IREAD
#endif // S_IRUSR
#ifndef S_IWUSR
#define S_IWUSR _S_IWRITE
#endif // S_IWUSR
#else
#include <dlfcn.h>
#endif

namespace Zig {
using namespace WebCore;

DEFINE_NATIVE_MODULE(NodeConstants)
{
    INIT_NATIVE_MODULE(0);

#ifdef RTLD_LAZY
    put(Identifier::fromString(vm, "RTLD_LAZY"_s), jsNumber(RTLD_LAZY));
#endif
#ifdef RTLD_NOW
    put(Identifier::fromString(vm, "RTLD_NOW"_s), jsNumber(RTLD_NOW));
#endif
#ifdef RTLD_GLOBAL
    put(Identifier::fromString(vm, "RTLD_GLOBAL"_s), jsNumber(RTLD_GLOBAL));
#endif
#ifdef RTLD_LOCAL
    put(Identifier::fromString(vm, "RTLD_LOCAL"_s), jsNumber(RTLD_LOCAL));
#endif
#ifdef RTLD_DEEPBIND
    put(Identifier::fromString(vm, "RTLD_DEEPBIND"_s), jsNumber(RTLD_DEEPBIND));
#endif
#ifdef E2BIG
    put(Identifier::fromString(vm, "E2BIG"_s), jsNumber(E2BIG));
#endif
#ifdef EACCES
    put(Identifier::fromString(vm, "EACCES"_s), jsNumber(EACCES));
#endif
#ifdef EADDRINUSE
    put(Identifier::fromString(vm, "EADDRINUSE"_s), jsNumber(EADDRINUSE));
#endif
#ifdef EADDRNOTAVAIL
    put(Identifier::fromString(vm, "EADDRNOTAVAIL"_s), jsNumber(EADDRNOTAVAIL));
#endif
#ifdef EAFNOSUPPORT
    put(Identifier::fromString(vm, "EAFNOSUPPORT"_s), jsNumber(EAFNOSUPPORT));
#endif
#ifdef EAGAIN
    put(Identifier::fromString(vm, "EAGAIN"_s), jsNumber(EAGAIN));
#endif
#ifdef EALREADY
    put(Identifier::fromString(vm, "EALREADY"_s), jsNumber(EALREADY));
#endif
#ifdef EBADF
    put(Identifier::fromString(vm, "EBADF"_s), jsNumber(EBADF));
#endif
#ifdef EBADMSG
    put(Identifier::fromString(vm, "EBADMSG"_s), jsNumber(EBADMSG));
#endif
#ifdef EBUSY
    put(Identifier::fromString(vm, "EBUSY"_s), jsNumber(EBUSY));
#endif
#ifdef ECANCELED
    put(Identifier::fromString(vm, "ECANCELED"_s), jsNumber(ECANCELED));
#endif
#ifdef ECHILD
    put(Identifier::fromString(vm, "ECHILD"_s), jsNumber(ECHILD));
#endif
#ifdef ECONNABORTED
    put(Identifier::fromString(vm, "ECONNABORTED"_s), jsNumber(ECONNABORTED));
#endif
#ifdef ECONNREFUSED
    put(Identifier::fromString(vm, "ECONNREFUSED"_s), jsNumber(ECONNREFUSED));
#endif
#ifdef ECONNRESET
    put(Identifier::fromString(vm, "ECONNRESET"_s), jsNumber(ECONNRESET));
#endif
#ifdef EDEADLK
    put(Identifier::fromString(vm, "EDEADLK"_s), jsNumber(EDEADLK));
#endif
#ifdef EDESTADDRREQ
    put(Identifier::fromString(vm, "EDESTADDRREQ"_s), jsNumber(EDESTADDRREQ));
#endif
#ifdef EDOM
    put(Identifier::fromString(vm, "EDOM"_s), jsNumber(EDOM));
#endif
#ifdef EDQUOT
    put(Identifier::fromString(vm, "EDQUOT"_s), jsNumber(EDQUOT));
#endif
#ifdef EEXIST
    put(Identifier::fromString(vm, "EEXIST"_s), jsNumber(EEXIST));
#endif
#ifdef EFAULT
    put(Identifier::fromString(vm, "EFAULT"_s), jsNumber(EFAULT));
#endif
#ifdef EFBIG
    put(Identifier::fromString(vm, "EFBIG"_s), jsNumber(EFBIG));
#endif
#ifdef EHOSTUNREACH
    put(Identifier::fromString(vm, "EHOSTUNREACH"_s), jsNumber(EHOSTUNREACH));
#endif
#ifdef EIDRM
    put(Identifier::fromString(vm, "EIDRM"_s), jsNumber(EIDRM));
#endif
#ifdef EILSEQ
    put(Identifier::fromString(vm, "EILSEQ"_s), jsNumber(EILSEQ));
#endif
#ifdef EINPROGRESS
    put(Identifier::fromString(vm, "EINPROGRESS"_s), jsNumber(EINPROGRESS));
#endif
#ifdef EINTR
    put(Identifier::fromString(vm, "EINTR"_s), jsNumber(EINTR));
#endif
#ifdef EINVAL
    put(Identifier::fromString(vm, "EINVAL"_s), jsNumber(EINVAL));
#endif
#ifdef EIO
    put(Identifier::fromString(vm, "EIO"_s), jsNumber(EIO));
#endif
#ifdef EISCONN
    put(Identifier::fromString(vm, "EISCONN"_s), jsNumber(EISCONN));
#endif
#ifdef EISDIR
    put(Identifier::fromString(vm, "EISDIR"_s), jsNumber(EISDIR));
#endif
#ifdef ELOOP
    put(Identifier::fromString(vm, "ELOOP"_s), jsNumber(ELOOP));
#endif
#ifdef EMFILE
    put(Identifier::fromString(vm, "EMFILE"_s), jsNumber(EMFILE));
#endif
#ifdef EMLINK
    put(Identifier::fromString(vm, "EMLINK"_s), jsNumber(EMLINK));
#endif
#ifdef EMSGSIZE
    put(Identifier::fromString(vm, "EMSGSIZE"_s), jsNumber(EMSGSIZE));
#endif
#ifdef EMULTIHOP
    put(Identifier::fromString(vm, "EMULTIHOP"_s), jsNumber(EMULTIHOP));
#endif
#ifdef ENAMETOOLONG
    put(Identifier::fromString(vm, "ENAMETOOLONG"_s), jsNumber(ENAMETOOLONG));
#endif
#ifdef ENETDOWN
    put(Identifier::fromString(vm, "ENETDOWN"_s), jsNumber(ENETDOWN));
#endif
#ifdef ENETRESET
    put(Identifier::fromString(vm, "ENETRESET"_s), jsNumber(ENETRESET));
#endif
#ifdef ENETUNREACH
    put(Identifier::fromString(vm, "ENETUNREACH"_s), jsNumber(ENETUNREACH));
#endif
#ifdef ENFILE
    put(Identifier::fromString(vm, "ENFILE"_s), jsNumber(ENFILE));
#endif
#ifdef ENOBUFS
    put(Identifier::fromString(vm, "ENOBUFS"_s), jsNumber(ENOBUFS));
#endif
#ifdef ENODATA
    put(Identifier::fromString(vm, "ENODATA"_s), jsNumber(ENODATA));
#endif
#ifdef ENODEV
    put(Identifier::fromString(vm, "ENODEV"_s), jsNumber(ENODEV));
#endif
#ifdef ENOENT
    put(Identifier::fromString(vm, "ENOENT"_s), jsNumber(ENOENT));
#endif
#ifdef ENOEXEC
    put(Identifier::fromString(vm, "ENOEXEC"_s), jsNumber(ENOEXEC));
#endif
#ifdef ENOLCK
    put(Identifier::fromString(vm, "ENOLCK"_s), jsNumber(ENOLCK));
#endif
#ifdef ENOLINK
    put(Identifier::fromString(vm, "ENOLINK"_s), jsNumber(ENOLINK));
#endif
#ifdef ENOMEM
    put(Identifier::fromString(vm, "ENOMEM"_s), jsNumber(ENOMEM));
#endif
#ifdef ENOMSG
    put(Identifier::fromString(vm, "ENOMSG"_s), jsNumber(ENOMSG));
#endif
#ifdef ENOPROTOOPT
    put(Identifier::fromString(vm, "ENOPROTOOPT"_s), jsNumber(ENOPROTOOPT));
#endif
#ifdef ENOSPC
    put(Identifier::fromString(vm, "ENOSPC"_s), jsNumber(ENOSPC));
#endif
#ifdef ENOSR
    put(Identifier::fromString(vm, "ENOSR"_s), jsNumber(ENOSR));
#endif
#ifdef ENOSTR
    put(Identifier::fromString(vm, "ENOSTR"_s), jsNumber(ENOSTR));
#endif
#ifdef ENOSYS
    put(Identifier::fromString(vm, "ENOSYS"_s), jsNumber(ENOSYS));
#endif
#ifdef ENOTCONN
    put(Identifier::fromString(vm, "ENOTCONN"_s), jsNumber(ENOTCONN));
#endif
#ifdef ENOTDIR
    put(Identifier::fromString(vm, "ENOTDIR"_s), jsNumber(ENOTDIR));
#endif
#ifdef ENOTEMPTY
    put(Identifier::fromString(vm, "ENOTEMPTY"_s), jsNumber(ENOTEMPTY));
#endif
#ifdef ENOTSOCK
    put(Identifier::fromString(vm, "ENOTSOCK"_s), jsNumber(ENOTSOCK));
#endif
#ifdef ENOTSUP
    put(Identifier::fromString(vm, "ENOTSUP"_s), jsNumber(ENOTSUP));
#endif
#ifdef ENOTTY
    put(Identifier::fromString(vm, "ENOTTY"_s), jsNumber(ENOTTY));
#endif
#ifdef ENXIO
    put(Identifier::fromString(vm, "ENXIO"_s), jsNumber(ENXIO));
#endif
#ifdef EOPNOTSUPP
    put(Identifier::fromString(vm, "EOPNOTSUPP"_s), jsNumber(EOPNOTSUPP));
#endif
#ifdef EOVERFLOW
    put(Identifier::fromString(vm, "EOVERFLOW"_s), jsNumber(EOVERFLOW));
#endif
#ifdef EPERM
    put(Identifier::fromString(vm, "EPERM"_s), jsNumber(EPERM));
#endif
#ifdef EPIPE
    put(Identifier::fromString(vm, "EPIPE"_s), jsNumber(EPIPE));
#endif
#ifdef EPROTO
    put(Identifier::fromString(vm, "EPROTO"_s), jsNumber(EPROTO));
#endif
#ifdef EPROTONOSUPPORT
    put(Identifier::fromString(vm, "EPROTONOSUPPORT"_s),
        jsNumber(EPROTONOSUPPORT));
#endif
#ifdef EPROTOTYPE
    put(Identifier::fromString(vm, "EPROTOTYPE"_s), jsNumber(EPROTOTYPE));
#endif
#ifdef ERANGE
    put(Identifier::fromString(vm, "ERANGE"_s), jsNumber(ERANGE));
#endif
#ifdef EROFS
    put(Identifier::fromString(vm, "EROFS"_s), jsNumber(EROFS));
#endif
#ifdef ESPIPE
    put(Identifier::fromString(vm, "ESPIPE"_s), jsNumber(ESPIPE));
#endif
#ifdef ESRCH
    put(Identifier::fromString(vm, "ESRCH"_s), jsNumber(ESRCH));
#endif
#ifdef ESTALE
    put(Identifier::fromString(vm, "ESTALE"_s), jsNumber(ESTALE));
#endif
#ifdef ETIME
    put(Identifier::fromString(vm, "ETIME"_s), jsNumber(ETIME));
#endif
#ifdef ETIMEDOUT
    put(Identifier::fromString(vm, "ETIMEDOUT"_s), jsNumber(ETIMEDOUT));
#endif
#ifdef ETXTBSY
    put(Identifier::fromString(vm, "ETXTBSY"_s), jsNumber(ETXTBSY));
#endif
#ifdef EWOULDBLOCK
    put(Identifier::fromString(vm, "EWOULDBLOCK"_s), jsNumber(EWOULDBLOCK));
#endif
#ifdef EXDEV
    put(Identifier::fromString(vm, "EXDEV"_s), jsNumber(EXDEV));
#endif
#ifdef WSAEINTR
    put(Identifier::fromString(vm, "WSAEINTR"_s), jsNumber(WSAEINTR));
#endif
#ifdef WSAEBADF
    put(Identifier::fromString(vm, "WSAEBADF"_s), jsNumber(WSAEBADF));
#endif
#ifdef WSAEACCES
    put(Identifier::fromString(vm, "WSAEACCES"_s), jsNumber(WSAEACCES));
#endif
#ifdef WSAEFAULT
    put(Identifier::fromString(vm, "WSAEFAULT"_s), jsNumber(WSAEFAULT));
#endif
#ifdef WSAEINVAL
    put(Identifier::fromString(vm, "WSAEINVAL"_s), jsNumber(WSAEINVAL));
#endif
#ifdef WSAEMFILE
    put(Identifier::fromString(vm, "WSAEMFILE"_s), jsNumber(WSAEMFILE));
#endif
#ifdef WSAEWOULDBLOCK
    put(Identifier::fromString(vm, "WSAEWOULDBLOCK"_s), jsNumber(WSAEWOULDBLOCK));
#endif
#ifdef WSAEINPROGRESS
    put(Identifier::fromString(vm, "WSAEINPROGRESS"_s), jsNumber(WSAEINPROGRESS));
#endif
#ifdef WSAEALREADY
    put(Identifier::fromString(vm, "WSAEALREADY"_s), jsNumber(WSAEALREADY));
#endif
#ifdef WSAENOTSOCK
    put(Identifier::fromString(vm, "WSAENOTSOCK"_s), jsNumber(WSAENOTSOCK));
#endif
#ifdef WSAEDESTADDRREQ
    put(Identifier::fromString(vm, "WSAEDESTADDRREQ"_s),
        jsNumber(WSAEDESTADDRREQ));
#endif
#ifdef WSAEMSGSIZE
    put(Identifier::fromString(vm, "WSAEMSGSIZE"_s), jsNumber(WSAEMSGSIZE));
#endif
#ifdef WSAEPROTOTYPE
    put(Identifier::fromString(vm, "WSAEPROTOTYPE"_s), jsNumber(WSAEPROTOTYPE));
#endif
#ifdef WSAENOPROTOOPT
    put(Identifier::fromString(vm, "WSAENOPROTOOPT"_s), jsNumber(WSAENOPROTOOPT));
#endif
#ifdef WSAEPROTONOSUPPORT
    put(Identifier::fromString(vm, "WSAEPROTONOSUPPORT"_s),
        jsNumber(WSAEPROTONOSUPPORT));
#endif
#ifdef WSAESOCKTNOSUPPORT
    put(Identifier::fromString(vm, "WSAESOCKTNOSUPPORT"_s),
        jsNumber(WSAESOCKTNOSUPPORT));
#endif
#ifdef WSAEOPNOTSUPP
    put(Identifier::fromString(vm, "WSAEOPNOTSUPP"_s), jsNumber(WSAEOPNOTSUPP));
#endif
#ifdef WSAEPFNOSUPPORT
    put(Identifier::fromString(vm, "WSAEPFNOSUPPORT"_s),
        jsNumber(WSAEPFNOSUPPORT));
#endif
#ifdef WSAEAFNOSUPPORT
    put(Identifier::fromString(vm, "WSAEAFNOSUPPORT"_s),
        jsNumber(WSAEAFNOSUPPORT));
#endif
#ifdef WSAEADDRINUSE
    put(Identifier::fromString(vm, "WSAEADDRINUSE"_s), jsNumber(WSAEADDRINUSE));
#endif
#ifdef WSAEADDRNOTAVAIL
    put(Identifier::fromString(vm, "WSAEADDRNOTAVAIL"_s),
        jsNumber(WSAEADDRNOTAVAIL));
#endif
#ifdef WSAENETDOWN
    put(Identifier::fromString(vm, "WSAENETDOWN"_s), jsNumber(WSAENETDOWN));
#endif
#ifdef WSAENETUNREACH
    put(Identifier::fromString(vm, "WSAENETUNREACH"_s), jsNumber(WSAENETUNREACH));
#endif
#ifdef WSAENETRESET
    put(Identifier::fromString(vm, "WSAENETRESET"_s), jsNumber(WSAENETRESET));
#endif
#ifdef WSAECONNABORTED
    put(Identifier::fromString(vm, "WSAECONNABORTED"_s),
        jsNumber(WSAECONNABORTED));
#endif
#ifdef WSAECONNRESET
    put(Identifier::fromString(vm, "WSAECONNRESET"_s), jsNumber(WSAECONNRESET));
#endif
#ifdef WSAENOBUFS
    put(Identifier::fromString(vm, "WSAENOBUFS"_s), jsNumber(WSAENOBUFS));
#endif
#ifdef WSAEISCONN
    put(Identifier::fromString(vm, "WSAEISCONN"_s), jsNumber(WSAEISCONN));
#endif
#ifdef WSAENOTCONN
    put(Identifier::fromString(vm, "WSAENOTCONN"_s), jsNumber(WSAENOTCONN));
#endif
#ifdef WSAESHUTDOWN
    put(Identifier::fromString(vm, "WSAESHUTDOWN"_s), jsNumber(WSAESHUTDOWN));
#endif
#ifdef WSAETOOMANYREFS
    put(Identifier::fromString(vm, "WSAETOOMANYREFS"_s),
        jsNumber(WSAETOOMANYREFS));
#endif
#ifdef WSAETIMEDOUT
    put(Identifier::fromString(vm, "WSAETIMEDOUT"_s), jsNumber(WSAETIMEDOUT));
#endif
#ifdef WSAECONNREFUSED
    put(Identifier::fromString(vm, "WSAECONNREFUSED"_s),
        jsNumber(WSAECONNREFUSED));
#endif
#ifdef WSAELOOP
    put(Identifier::fromString(vm, "WSAELOOP"_s), jsNumber(WSAELOOP));
#endif
#ifdef WSAENAMETOOLONG
    put(Identifier::fromString(vm, "WSAENAMETOOLONG"_s),
        jsNumber(WSAENAMETOOLONG));
#endif
#ifdef WSAEHOSTDOWN
    put(Identifier::fromString(vm, "WSAEHOSTDOWN"_s), jsNumber(WSAEHOSTDOWN));
#endif
#ifdef WSAEHOSTUNREACH
    put(Identifier::fromString(vm, "WSAEHOSTUNREACH"_s),
        jsNumber(WSAEHOSTUNREACH));
#endif
#ifdef WSAENOTEMPTY
    put(Identifier::fromString(vm, "WSAENOTEMPTY"_s), jsNumber(WSAENOTEMPTY));
#endif
#ifdef WSAEPROCLIM
    put(Identifier::fromString(vm, "WSAEPROCLIM"_s), jsNumber(WSAEPROCLIM));
#endif
#ifdef WSAEUSERS
    put(Identifier::fromString(vm, "WSAEUSERS"_s), jsNumber(WSAEUSERS));
#endif
#ifdef WSAEDQUOT
    put(Identifier::fromString(vm, "WSAEDQUOT"_s), jsNumber(WSAEDQUOT));
#endif
#ifdef WSAESTALE
    put(Identifier::fromString(vm, "WSAESTALE"_s), jsNumber(WSAESTALE));
#endif
#ifdef WSAEREMOTE
    put(Identifier::fromString(vm, "WSAEREMOTE"_s), jsNumber(WSAEREMOTE));
#endif
#ifdef WSASYSNOTREADY
    put(Identifier::fromString(vm, "WSASYSNOTREADY"_s), jsNumber(WSASYSNOTREADY));
#endif
#ifdef WSAVERNOTSUPPORTED
    put(Identifier::fromString(vm, "WSAVERNOTSUPPORTED"_s),
        jsNumber(WSAVERNOTSUPPORTED));
#endif
#ifdef WSANOTINITIALISED
    put(Identifier::fromString(vm, "WSANOTINITIALISED"_s),
        jsNumber(WSANOTINITIALISED));
#endif
#ifdef WSAEDISCON
    put(Identifier::fromString(vm, "WSAEDISCON"_s), jsNumber(WSAEDISCON));
#endif
#ifdef WSAENOMORE
    put(Identifier::fromString(vm, "WSAENOMORE"_s), jsNumber(WSAENOMORE));
#endif
#ifdef WSAECANCELLED
    put(Identifier::fromString(vm, "WSAECANCELLED"_s), jsNumber(WSAECANCELLED));
#endif
#ifdef WSAEINVALIDPROCTABLE
    put(Identifier::fromString(vm, "WSAEINVALIDPROCTABLE"_s),
        jsNumber(WSAEINVALIDPROCTABLE));
#endif
#ifdef WSAEINVALIDPROVIDER
    put(Identifier::fromString(vm, "WSAEINVALIDPROVIDER"_s),
        jsNumber(WSAEINVALIDPROVIDER));
#endif
#ifdef WSAEPROVIDERFAILEDINIT
    put(Identifier::fromString(vm, "WSAEPROVIDERFAILEDINIT"_s),
        jsNumber(WSAEPROVIDERFAILEDINIT));
#endif
#ifdef WSASYSCALLFAILURE
    put(Identifier::fromString(vm, "WSASYSCALLFAILURE"_s),
        jsNumber(WSASYSCALLFAILURE));
#endif
#ifdef WSASERVICE_NOT_FOUND
    put(Identifier::fromString(vm, "WSASERVICE_NOT_FOUND"_s),
        jsNumber(WSASERVICE_NOT_FOUND));
#endif
#ifdef WSATYPE_NOT_FOUND
    put(Identifier::fromString(vm, "WSATYPE_NOT_FOUND"_s),
        jsNumber(WSATYPE_NOT_FOUND));
#endif
#ifdef WSA_E_NO_MORE
    put(Identifier::fromString(vm, "WSA_E_NO_MORE"_s), jsNumber(WSA_E_NO_MORE));
#endif
#ifdef WSA_E_CANCELLED
    put(Identifier::fromString(vm, "WSA_E_CANCELLED"_s),
        jsNumber(WSA_E_CANCELLED));
#endif
#ifdef WSAEREFUSED
    put(Identifier::fromString(vm, "WSAEREFUSED"_s), jsNumber(WSAEREFUSED));
#endif
    put(Identifier::fromString(vm, "PRIORITY_LOW"_s), jsNumber(19));
    put(Identifier::fromString(vm, "PRIORITY_BELOW_NORMAL"_s), jsNumber(10));
    put(Identifier::fromString(vm, "PRIORITY_NORMAL"_s), jsNumber(0));
    put(Identifier::fromString(vm, "PRIORITY_ABOVE_NORMAL"_s), jsNumber(-7));
    put(Identifier::fromString(vm, "PRIORITY_HIGH"_s), jsNumber(-14));
    put(Identifier::fromString(vm, "PRIORITY_HIGHEST"_s), jsNumber(-20));
#ifdef SIGHUP
    put(Identifier::fromString(vm, "SIGHUP"_s), jsNumber(SIGHUP));
#endif
#ifdef SIGINT
    put(Identifier::fromString(vm, "SIGINT"_s), jsNumber(SIGINT));
#endif
#ifdef SIGQUIT
    put(Identifier::fromString(vm, "SIGQUIT"_s), jsNumber(SIGQUIT));
#endif
#ifdef SIGILL
    put(Identifier::fromString(vm, "SIGILL"_s), jsNumber(SIGILL));
#endif
#ifdef SIGTRAP
    put(Identifier::fromString(vm, "SIGTRAP"_s), jsNumber(SIGTRAP));
#endif
#ifdef SIGABRT
    put(Identifier::fromString(vm, "SIGABRT"_s), jsNumber(SIGABRT));
#endif
#ifdef SIGIOT
    put(Identifier::fromString(vm, "SIGIOT"_s), jsNumber(SIGIOT));
#endif
#ifdef SIGBUS
    put(Identifier::fromString(vm, "SIGBUS"_s), jsNumber(SIGBUS));
#endif
#ifdef SIGFPE
    put(Identifier::fromString(vm, "SIGFPE"_s), jsNumber(SIGFPE));
#endif
#ifdef SIGKILL
    put(Identifier::fromString(vm, "SIGKILL"_s), jsNumber(SIGKILL));
#endif
#ifdef SIGUSR1
    put(Identifier::fromString(vm, "SIGUSR1"_s), jsNumber(SIGUSR1));
#endif
#ifdef SIGSEGV
    put(Identifier::fromString(vm, "SIGSEGV"_s), jsNumber(SIGSEGV));
#endif
#ifdef SIGUSR2
    put(Identifier::fromString(vm, "SIGUSR2"_s), jsNumber(SIGUSR2));
#endif
#ifdef SIGPIPE
    put(Identifier::fromString(vm, "SIGPIPE"_s), jsNumber(SIGPIPE));
#endif
#ifdef SIGALRM
    put(Identifier::fromString(vm, "SIGALRM"_s), jsNumber(SIGALRM));
#endif
#ifdef SIGTERM
    put(Identifier::fromString(vm, "SIGTERM"_s), jsNumber(SIGTERM));
#endif
#ifdef SIGCHLD
    put(Identifier::fromString(vm, "SIGCHLD"_s), jsNumber(SIGCHLD));
#endif
#ifdef SIGSTKFLT
    put(Identifier::fromString(vm, "SIGSTKFLT"_s), jsNumber(SIGSTKFLT));
#endif
#ifdef SIGCONT
    put(Identifier::fromString(vm, "SIGCONT"_s), jsNumber(SIGCONT));
#endif
#ifdef SIGSTOP
    put(Identifier::fromString(vm, "SIGSTOP"_s), jsNumber(SIGSTOP));
#endif
#ifdef SIGTSTP
    put(Identifier::fromString(vm, "SIGTSTP"_s), jsNumber(SIGTSTP));
#endif
#ifdef SIGBREAK
    put(Identifier::fromString(vm, "SIGBREAK"_s), jsNumber(SIGBREAK));
#endif
#ifdef SIGTTIN
    put(Identifier::fromString(vm, "SIGTTIN"_s), jsNumber(SIGTTIN));
#endif
#ifdef SIGTTOU
    put(Identifier::fromString(vm, "SIGTTOU"_s), jsNumber(SIGTTOU));
#endif
#ifdef SIGURG
    put(Identifier::fromString(vm, "SIGURG"_s), jsNumber(SIGURG));
#endif
#ifdef SIGXCPU
    put(Identifier::fromString(vm, "SIGXCPU"_s), jsNumber(SIGXCPU));
#endif
#ifdef SIGXFSZ
    put(Identifier::fromString(vm, "SIGXFSZ"_s), jsNumber(SIGXFSZ));
#endif
#ifdef SIGVTALRM
    put(Identifier::fromString(vm, "SIGVTALRM"_s), jsNumber(SIGVTALRM));
#endif
#ifdef SIGPROF
    put(Identifier::fromString(vm, "SIGPROF"_s), jsNumber(SIGPROF));
#endif
#ifdef SIGWINCH
    put(Identifier::fromString(vm, "SIGWINCH"_s), jsNumber(SIGWINCH));
#endif
#ifdef SIGIO
    put(Identifier::fromString(vm, "SIGIO"_s), jsNumber(SIGIO));
#endif
#ifdef SIGPOLL
    put(Identifier::fromString(vm, "SIGPOLL"_s), jsNumber(SIGPOLL));
#endif
#ifdef SIGLOST
    put(Identifier::fromString(vm, "SIGLOST"_s), jsNumber(SIGLOST));
#endif
#ifdef SIGPWR
    put(Identifier::fromString(vm, "SIGPWR"_s), jsNumber(SIGPWR));
#endif
#ifdef SIGINFO
    put(Identifier::fromString(vm, "SIGINFO"_s), jsNumber(SIGINFO));
#endif
#ifdef SIGSYS
    put(Identifier::fromString(vm, "SIGSYS"_s), jsNumber(SIGSYS));
#endif
#ifdef SIGUNUSED
    put(Identifier::fromString(vm, "SIGUNUSED"_s), jsNumber(SIGUNUSED));
#endif
    put(Identifier::fromString(vm, "UV_FS_SYMLINK_DIR"_s), jsNumber(1));
    put(Identifier::fromString(vm, "UV_FS_SYMLINK_JUNCTION"_s), jsNumber(2));
    put(Identifier::fromString(vm, "O_RDONLY"_s), jsNumber(O_RDONLY));
    put(Identifier::fromString(vm, "O_WRONLY"_s), jsNumber(O_WRONLY));
    put(Identifier::fromString(vm, "O_RDWR"_s), jsNumber(O_RDWR));

    put(Identifier::fromString(vm, "UV_DIRENT_UNKNOWN"_s), jsNumber(0));
    put(Identifier::fromString(vm, "UV_DIRENT_FILE"_s), jsNumber(1));
    put(Identifier::fromString(vm, "UV_DIRENT_DIR"_s), jsNumber(2));
    put(Identifier::fromString(vm, "UV_DIRENT_LINK"_s), jsNumber(3));
    put(Identifier::fromString(vm, "UV_DIRENT_FIFO"_s), jsNumber(4));
    put(Identifier::fromString(vm, "UV_DIRENT_SOCKET"_s), jsNumber(5));
    put(Identifier::fromString(vm, "UV_DIRENT_CHAR"_s), jsNumber(6));
    put(Identifier::fromString(vm, "UV_DIRENT_BLOCK"_s), jsNumber(7));

    put(Identifier::fromString(vm, "S_IFMT"_s), jsNumber(S_IFMT));
    put(Identifier::fromString(vm, "S_IFREG"_s), jsNumber(S_IFREG));
    put(Identifier::fromString(vm, "S_IFDIR"_s), jsNumber(S_IFDIR));
    put(Identifier::fromString(vm, "S_IFCHR"_s), jsNumber(S_IFCHR));
#ifdef S_IFBLK
    put(Identifier::fromString(vm, "S_IFBLK"_s), jsNumber(S_IFBLK));
#endif
#ifdef S_IFIFO
    put(Identifier::fromString(vm, "S_IFIFO"_s), jsNumber(S_IFIFO));
#endif
#ifdef S_IFLNK
    put(Identifier::fromString(vm, "S_IFLNK"_s), jsNumber(S_IFLNK));
#endif
#ifdef S_IFSOCK
    put(Identifier::fromString(vm, "S_IFSOCK"_s), jsNumber(S_IFSOCK));
#endif
#ifdef O_CREAT
    put(Identifier::fromString(vm, "O_CREAT"_s), jsNumber(O_CREAT));
#endif
#ifdef O_EXCL
    put(Identifier::fromString(vm, "O_EXCL"_s), jsNumber(O_EXCL));
#endif
    put(Identifier::fromString(vm, "UV_FS_O_FILEMAP"_s), jsNumber(0));

#ifdef O_NOCTTY
    put(Identifier::fromString(vm, "O_NOCTTY"_s), jsNumber(O_NOCTTY));
#endif
#ifdef O_TRUNC
    put(Identifier::fromString(vm, "O_TRUNC"_s), jsNumber(O_TRUNC));
#endif
#ifdef O_APPEND
    put(Identifier::fromString(vm, "O_APPEND"_s), jsNumber(O_APPEND));
#endif
#ifdef O_DIRECTORY
    put(Identifier::fromString(vm, "O_DIRECTORY"_s), jsNumber(O_DIRECTORY));
#endif
#ifdef O_NOATIME
    put(Identifier::fromString(vm, "O_NOATIME"_s), jsNumber(O_NOATIME));
#endif
#ifdef O_NOFOLLOW
    put(Identifier::fromString(vm, "O_NOFOLLOW"_s), jsNumber(O_NOFOLLOW));
#endif
#ifdef O_SYNC
    put(Identifier::fromString(vm, "O_SYNC"_s), jsNumber(O_SYNC));
#endif
#ifdef O_DSYNC
    put(Identifier::fromString(vm, "O_DSYNC"_s), jsNumber(O_DSYNC));
#endif
#ifdef O_SYMLINK
    put(Identifier::fromString(vm, "O_SYMLINK"_s), jsNumber(O_SYMLINK));
#endif
#ifdef O_DIRECT
    put(Identifier::fromString(vm, "O_DIRECT"_s), jsNumber(O_DIRECT));
#endif
#ifdef O_NONBLOCK
    put(Identifier::fromString(vm, "O_NONBLOCK"_s), jsNumber(O_NONBLOCK));
#endif
#ifdef S_IRWXU
    put(Identifier::fromString(vm, "S_IRWXU"_s), jsNumber(S_IRWXU));
#endif
#ifdef S_IRUSR
    put(Identifier::fromString(vm, "S_IRUSR"_s), jsNumber(S_IRUSR));
#endif
#ifdef S_IWUSR
    put(Identifier::fromString(vm, "S_IWUSR"_s), jsNumber(S_IWUSR));
#endif
#ifdef S_IXUSR
    put(Identifier::fromString(vm, "S_IXUSR"_s), jsNumber(S_IXUSR));
#endif
#ifdef S_IRWXG
    put(Identifier::fromString(vm, "S_IRWXG"_s), jsNumber(S_IRWXG));
#endif
#ifdef S_IRGRP
    put(Identifier::fromString(vm, "S_IRGRP"_s), jsNumber(S_IRGRP));
#endif
#ifdef S_IWGRP
    put(Identifier::fromString(vm, "S_IWGRP"_s), jsNumber(S_IWGRP));
#endif
#ifdef S_IXGRP
    put(Identifier::fromString(vm, "S_IXGRP"_s), jsNumber(S_IXGRP));
#endif
#ifdef S_IRWXO
    put(Identifier::fromString(vm, "S_IRWXO"_s), jsNumber(S_IRWXO));
#endif
#ifdef S_IROTH
    put(Identifier::fromString(vm, "S_IROTH"_s), jsNumber(S_IROTH));
#endif
#ifdef S_IWOTH
    put(Identifier::fromString(vm, "S_IWOTH"_s), jsNumber(S_IWOTH));
#endif
#ifdef S_IXOTH
    put(Identifier::fromString(vm, "S_IXOTH"_s), jsNumber(S_IXOTH));
#endif
#ifdef F_OK
    put(Identifier::fromString(vm, "F_OK"_s), jsNumber(F_OK));
#endif
#ifdef R_OK
    put(Identifier::fromString(vm, "R_OK"_s), jsNumber(R_OK));
#endif
#ifdef W_OK
    put(Identifier::fromString(vm, "W_OK"_s), jsNumber(W_OK));
#endif
#ifdef X_OK
    put(Identifier::fromString(vm, "X_OK"_s), jsNumber(X_OK));
#endif
    put(Identifier::fromString(vm, "UV_FS_COPYFILE_EXCL"_s), jsNumber(1));
    put(Identifier::fromString(vm, "COPYFILE_EXCL"_s), jsNumber(1));
    put(Identifier::fromString(vm, "UV_FS_COPYFILE_FICLONE"_s), jsNumber(2));
    put(Identifier::fromString(vm, "COPYFILE_FICLONE"_s), jsNumber(2));
    put(Identifier::fromString(vm, "UV_FS_COPYFILE_FICLONE_FORCE"_s),
        jsNumber(4));
    put(Identifier::fromString(vm, "COPYFILE_FICLONE_FORCE"_s), jsNumber(4));
#ifdef OPENSSL_VERSION_NUMBER
    put(Identifier::fromString(vm, "OPENSSL_VERSION_NUMBER"_s),
        jsNumber(OPENSSL_VERSION_NUMBER));
#endif
#ifdef SSL_OP_ALL
    put(Identifier::fromString(vm, "SSL_OP_ALL"_s), jsNumber(SSL_OP_ALL));
#endif
#ifdef SSL_OP_ALLOW_NO_DHE_KEX
    put(Identifier::fromString(vm, "SSL_OP_ALLOW_NO_DHE_KEX"_s),
        jsNumber(SSL_OP_ALLOW_NO_DHE_KEX));
#endif
#ifdef SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION
    put(Identifier::fromString(vm, "SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION"_s),
        jsNumber(SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION));
#endif
#ifdef SSL_OP_CIPHER_SERVER_PREFERENCE
    put(Identifier::fromString(vm, "SSL_OP_CIPHER_SERVER_PREFERENCE"_s),
        jsNumber(SSL_OP_CIPHER_SERVER_PREFERENCE));
#endif
#ifdef SSL_OP_CISCO_ANYCONNECT
    put(Identifier::fromString(vm, "SSL_OP_CISCO_ANYCONNECT"_s),
        jsNumber(SSL_OP_CISCO_ANYCONNECT));
#endif
#ifdef SSL_OP_COOKIE_EXCHANGE
    put(Identifier::fromString(vm, "SSL_OP_COOKIE_EXCHANGE"_s),
        jsNumber(SSL_OP_COOKIE_EXCHANGE));
#endif
#ifdef SSL_OP_CRYPTOPRO_TLSEXT_BUG
    put(Identifier::fromString(vm, "SSL_OP_CRYPTOPRO_TLSEXT_BUG"_s),
        jsNumber(SSL_OP_CRYPTOPRO_TLSEXT_BUG));
#endif
#ifdef SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS
    put(Identifier::fromString(vm, "SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS"_s),
        jsNumber(SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS));
#endif
#ifdef SSL_OP_LEGACY_SERVER_CONNECT
    put(Identifier::fromString(vm, "SSL_OP_LEGACY_SERVER_CONNECT"_s),
        jsNumber(SSL_OP_LEGACY_SERVER_CONNECT));
#endif
#ifdef SSL_OP_NO_COMPRESSION
    put(Identifier::fromString(vm, "SSL_OP_NO_COMPRESSION"_s),
        jsNumber(SSL_OP_NO_COMPRESSION));
#endif
#ifdef SSL_OP_NO_ENCRYPT_THEN_MAC
    put(Identifier::fromString(vm, "SSL_OP_NO_ENCRYPT_THEN_MAC"_s),
        jsNumber(SSL_OP_NO_ENCRYPT_THEN_MAC));
#endif
#ifdef SSL_OP_NO_QUERY_MTU
    put(Identifier::fromString(vm, "SSL_OP_NO_QUERY_MTU"_s),
        jsNumber(SSL_OP_NO_QUERY_MTU));
#endif
#ifdef SSL_OP_NO_RENEGOTIATION
    put(Identifier::fromString(vm, "SSL_OP_NO_RENEGOTIATION"_s),
        jsNumber(SSL_OP_NO_RENEGOTIATION));
#endif
#ifdef SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION
    put(Identifier::fromString(vm,
            "SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION"_s),
        jsNumber(SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION));
#endif
#ifdef SSL_OP_NO_SSLv2
    put(Identifier::fromString(vm, "SSL_OP_NO_SSLv2"_s),
        jsNumber(SSL_OP_NO_SSLv2));
#endif
#ifdef SSL_OP_NO_SSLv3
    put(Identifier::fromString(vm, "SSL_OP_NO_SSLv3"_s),
        jsNumber(SSL_OP_NO_SSLv3));
#endif
#ifdef SSL_OP_NO_TICKET
    put(Identifier::fromString(vm, "SSL_OP_NO_TICKET"_s),
        jsNumber(SSL_OP_NO_TICKET));
#endif
#ifdef SSL_OP_NO_TLSv1
    put(Identifier::fromString(vm, "SSL_OP_NO_TLSv1"_s),
        jsNumber(SSL_OP_NO_TLSv1));
#endif
#ifdef SSL_OP_NO_TLSv1_1
    put(Identifier::fromString(vm, "SSL_OP_NO_TLSv1_1"_s),
        jsNumber(SSL_OP_NO_TLSv1_1));
#endif
#ifdef SSL_OP_NO_TLSv1_2
    put(Identifier::fromString(vm, "SSL_OP_NO_TLSv1_2"_s),
        jsNumber(SSL_OP_NO_TLSv1_2));
#endif
#ifdef SSL_OP_NO_TLSv1_3
    put(Identifier::fromString(vm, "SSL_OP_NO_TLSv1_3"_s),
        jsNumber(SSL_OP_NO_TLSv1_3));
#endif
#ifdef SSL_OP_PRIORITIZE_CHACHA
    put(Identifier::fromString(vm, "SSL_OP_PRIORITIZE_CHACHA"_s),
        jsNumber(SSL_OP_PRIORITIZE_CHACHA));
#endif
#ifdef SSL_OP_TLS_ROLLBACK_BUG
    put(Identifier::fromString(vm, "SSL_OP_TLS_ROLLBACK_BUG"_s),
        jsNumber(SSL_OP_TLS_ROLLBACK_BUG));
#endif
#ifndef OPENSSL_NO_ENGINE
#ifdef ENGINE_METHOD_RSA
    put(Identifier::fromString(vm, "ENGINE_METHOD_RSA"_s),
        jsNumber(ENGINE_METHOD_RSA));
#endif
#ifdef ENGINE_METHOD_DSA
    put(Identifier::fromString(vm, "ENGINE_METHOD_DSA"_s),
        jsNumber(ENGINE_METHOD_DSA));
#endif
#ifdef ENGINE_METHOD_DH
    put(Identifier::fromString(vm, "ENGINE_METHOD_DH"_s),
        jsNumber(ENGINE_METHOD_DH));
#endif
#ifdef ENGINE_METHOD_RAND
    put(Identifier::fromString(vm, "ENGINE_METHOD_RAND"_s),
        jsNumber(ENGINE_METHOD_RAND));
#endif
#ifdef ENGINE_METHOD_EC
    put(Identifier::fromString(vm, "ENGINE_METHOD_EC"_s),
        jsNumber(ENGINE_METHOD_EC));
#endif
#ifdef ENGINE_METHOD_CIPHERS
    put(Identifier::fromString(vm, "ENGINE_METHOD_CIPHERS"_s),
        jsNumber(ENGINE_METHOD_CIPHERS));
#endif
#ifdef ENGINE_METHOD_DIGESTS
    put(Identifier::fromString(vm, "ENGINE_METHOD_DIGESTS"_s),
        jsNumber(ENGINE_METHOD_DIGESTS));
#endif
#ifdef ENGINE_METHOD_PKEY_METHS
    put(Identifier::fromString(vm, "ENGINE_METHOD_PKEY_METHS"_s),
        jsNumber(ENGINE_METHOD_PKEY_METHS));
#endif
#ifdef ENGINE_METHOD_PKEY_ASN1_METHS
    put(Identifier::fromString(vm, "ENGINE_METHOD_PKEY_ASN1_METHS"_s),
        jsNumber(ENGINE_METHOD_PKEY_ASN1_METHS));
#endif
#ifdef ENGINE_METHOD_ALL
    put(Identifier::fromString(vm, "ENGINE_METHOD_ALL"_s),
        jsNumber(ENGINE_METHOD_ALL));
#endif
#ifdef ENGINE_METHOD_NONE
    put(Identifier::fromString(vm, "ENGINE_METHOD_NONE"_s),
        jsNumber(ENGINE_METHOD_NONE));
#endif
#endif // !OPENSSL_NO_ENGINE
#ifdef DH_CHECK_P_NOT_SAFE_PRIME
    put(Identifier::fromString(vm, "DH_CHECK_P_NOT_SAFE_PRIME"_s),
        jsNumber(DH_CHECK_P_NOT_SAFE_PRIME));
#endif
#ifdef DH_CHECK_P_NOT_PRIME
    put(Identifier::fromString(vm, "DH_CHECK_P_NOT_PRIME"_s),
        jsNumber(DH_CHECK_P_NOT_PRIME));
#endif
#ifdef DH_UNABLE_TO_CHECK_GENERATOR
    put(Identifier::fromString(vm, "DH_UNABLE_TO_CHECK_GENERATOR"_s),
        jsNumber(DH_UNABLE_TO_CHECK_GENERATOR));
#endif
#ifdef DH_NOT_SUITABLE_GENERATOR
    put(Identifier::fromString(vm, "DH_NOT_SUITABLE_GENERATOR"_s),
        jsNumber(DH_NOT_SUITABLE_GENERATOR));
#endif
#ifdef RSA_PKCS1_PADDING
    put(Identifier::fromString(vm, "RSA_PKCS1_PADDING"_s),
        jsNumber(RSA_PKCS1_PADDING));
#endif
#ifdef RSA_SSLV23_PADDING
    put(Identifier::fromString(vm, "RSA_SSLV23_PADDING"_s),
        jsNumber(RSA_SSLV23_PADDING));
#endif
#ifdef RSA_NO_PADDING
    put(Identifier::fromString(vm, "RSA_NO_PADDING"_s), jsNumber(RSA_NO_PADDING));
#endif
#ifdef RSA_PKCS1_OAEP_PADDING
    put(Identifier::fromString(vm, "RSA_PKCS1_OAEP_PADDING"_s),
        jsNumber(RSA_PKCS1_OAEP_PADDING));
#endif
#ifdef RSA_X931_PADDING
    put(Identifier::fromString(vm, "RSA_X931_PADDING"_s),
        jsNumber(RSA_X931_PADDING));
#endif
#ifdef RSA_PKCS1_PSS_PADDING
    put(Identifier::fromString(vm, "RSA_PKCS1_PSS_PADDING"_s),
        jsNumber(RSA_PKCS1_PSS_PADDING));
#endif
#ifdef RSA_PSS_SALTLEN_DIGEST
    put(Identifier::fromString(vm, "RSA_PSS_SALTLEN_DIGEST"_s),
        jsNumber(RSA_PSS_SALTLEN_DIGEST));
#endif
#ifdef RSA_PSS_SALTLEN_MAX_SIGN
    put(Identifier::fromString(vm, "RSA_PSS_SALTLEN_MAX_SIGN"_s),
        jsNumber(RSA_PSS_SALTLEN_MAX_SIGN));
#endif
#ifdef RSA_PSS_SALTLEN_AUTO
    put(Identifier::fromString(vm, "RSA_PSS_SALTLEN_AUTO"_s),
        jsNumber(RSA_PSS_SALTLEN_AUTO));
#endif
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
    put(Identifier::fromString(vm, "defaultCoreCipherList"_s),
        jsString(vm, cipherList));
    put(Identifier::fromString(vm, "defaultCipherList"_s),
        jsString(vm, cipherList));
#ifdef TLS1_VERSION
    put(Identifier::fromString(vm, "TLS1_VERSION"_s), jsNumber(TLS1_VERSION));
#endif
#ifdef TLS1_1_VERSION
    put(Identifier::fromString(vm, "TLS1_1_VERSION"_s), jsNumber(TLS1_1_VERSION));
#endif
#ifdef TLS1_2_VERSION
    put(Identifier::fromString(vm, "TLS1_2_VERSION"_s), jsNumber(TLS1_2_VERSION));
#endif
#ifdef TLS1_3_VERSION
    put(Identifier::fromString(vm, "TLS1_3_VERSION"_s), jsNumber(TLS1_3_VERSION));
#endif
    put(Identifier::fromString(vm, "POINT_CONVERSION_COMPRESSED"_s),
        jsNumber(POINT_CONVERSION_COMPRESSED));
    put(Identifier::fromString(vm, "POINT_CONVERSION_UNCOMPRESSED"_s),
        jsNumber(POINT_CONVERSION_UNCOMPRESSED));
    put(Identifier::fromString(vm, "POINT_CONVERSION_HYBRID"_s),
        jsNumber(POINT_CONVERSION_HYBRID));

    // RETURN_NATIVE_MODULE();
}

} // namespace Zig
