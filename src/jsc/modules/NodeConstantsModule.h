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
// The UCRT only defines the underscore-prefixed _S_IFIFO; whether the plain
// spelling is visible here otherwise depends on what happened to be defined
// earlier in the unified source. Node exposes constants.S_IFIFO (4096) on
// Windows, so pin it to the CRT value instead of relying on header luck.
// Keep in sync with ProcessBindingConstants.cpp.
#if !defined(S_IFIFO) && defined(_S_IFIFO)
#define S_IFIFO _S_IFIFO
#endif // S_IFIFO
#else
#include <dlfcn.h>
#endif

namespace Zig {
using namespace WebCore;

namespace {
// Tables end with a `{ nullptr, 0 }` row (some are all-`#ifdef` and may be empty).
struct NumericConstant {
    const char* name;
    double value;
};
}

DEFINE_NATIVE_MODULE(NodeConstants)
{
    INIT_NATIVE_MODULE(NodeConstants, 0);

    static constexpr NumericConstant kConstants1[] = {
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
        { "PRIORITY_LOW", static_cast<double>(19) },
        { "PRIORITY_BELOW_NORMAL", static_cast<double>(10) },
        { "PRIORITY_NORMAL", static_cast<double>(0) },
        { "PRIORITY_ABOVE_NORMAL", static_cast<double>(-7) },
        { "PRIORITY_HIGH", static_cast<double>(-14) },
        { "PRIORITY_HIGHEST", static_cast<double>(-20) },
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
    for (const NumericConstant* constant = kConstants1; constant->name; ++constant)
        put(Identifier::fromString(vm, ASCIILiteral::fromLiteralUnsafe(constant->name)), jsNumber(constant->value));
    // BoringSSL does not define engine constants in openssl/engine.h.
    // Values mirror ProcessBindingConstants.cpp (and node).
    static constexpr NumericConstant kConstants3[] = {
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
#endif
#ifdef RSA_PSS_SALTLEN_MAX_SIGN
        { "RSA_PSS_SALTLEN_MAX_SIGN", static_cast<double>(RSA_PSS_SALTLEN_MAX_SIGN) },
#else
        { "RSA_PSS_SALTLEN_MAX_SIGN", static_cast<double>(-2) },
#endif
#ifdef RSA_PSS_SALTLEN_AUTO
        { "RSA_PSS_SALTLEN_AUTO", static_cast<double>(RSA_PSS_SALTLEN_AUTO) },
#endif
        { nullptr, 0 },
    };
    for (const NumericConstant* constant = kConstants3; constant->name; ++constant)
        put(Identifier::fromString(vm, ASCIILiteral::fromLiteralUnsafe(constant->name)), jsNumber(constant->value));
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
    static constexpr NumericConstant kConstants4[] = {
#ifdef TLS1_VERSION
        { "TLS1_VERSION", static_cast<double>(TLS1_VERSION) },
#endif
#ifdef TLS1_1_VERSION
        { "TLS1_1_VERSION", static_cast<double>(TLS1_1_VERSION) },
#endif
#ifdef TLS1_2_VERSION
        { "TLS1_2_VERSION", static_cast<double>(TLS1_2_VERSION) },
#endif
#ifdef TLS1_3_VERSION
        { "TLS1_3_VERSION", static_cast<double>(TLS1_3_VERSION) },
#endif
        { "POINT_CONVERSION_COMPRESSED", static_cast<double>(POINT_CONVERSION_COMPRESSED) },
        { "POINT_CONVERSION_UNCOMPRESSED", static_cast<double>(POINT_CONVERSION_UNCOMPRESSED) },
        { "POINT_CONVERSION_HYBRID", static_cast<double>(POINT_CONVERSION_HYBRID) },
        { nullptr, 0 },
    };
    for (const NumericConstant* constant = kConstants4; constant->name; ++constant)
        put(Identifier::fromString(vm, ASCIILiteral::fromLiteralUnsafe(constant->name)), jsNumber(constant->value));

    // OBSOLETE OPTIONS retained for compatibility (always 0, as in node).
    static constexpr NumericConstant kConstants5[] = {
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
        { "SSL_OP_PKCS1_CHECK_1", static_cast<double>(0) },
        { "SSL_OP_PKCS1_CHECK_2", static_cast<double>(0) },
        { "SSL_OP_NETSCAPE_CA_DN_BUG", static_cast<double>(0) },
        { "SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG", static_cast<double>(0) },
        { nullptr, 0 },
    };
    for (const NumericConstant* constant = kConstants5; constant->name; ++constant)
        put(Identifier::fromString(vm, ASCIILiteral::fromLiteralUnsafe(constant->name)), jsNumber(constant->value));

    // fs formats the binding exposes; keep in sync with ProcessBindingConstants.cpp.
    static constexpr NumericConstant kConstants6[] = {
        { "EXTENSIONLESS_FORMAT_JAVASCRIPT", static_cast<double>(0) },
        { "EXTENSIONLESS_FORMAT_WASM", static_cast<double>(1) },
        { nullptr, 0 },
    };
    for (const NumericConstant* constant = kConstants6; constant->name; ++constant)
        put(Identifier::fromString(vm, ASCIILiteral::fromLiteralUnsafe(constant->name)), jsNumber(constant->value));

    // node freezes require('constants') (lib/constants.js ObjectFreeze).
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::objectConstructorFreeze(globalObject, defaultObject);
    RETURN_IF_EXCEPTION(scope, void());

    // RETURN_NATIVE_MODULE();
}

} // namespace Zig
