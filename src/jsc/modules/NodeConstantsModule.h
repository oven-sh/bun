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

DEFINE_NATIVE_MODULE(NodeConstants)
{
    INIT_NATIVE_MODULE(NodeConstants, 0);

    struct Entry {
        ASCIILiteral name;
        double value;
    };
    static constexpr Entry constants[] = {
#ifdef RTLD_LAZY
        { "RTLD_LAZY"_s, RTLD_LAZY },
#endif
#ifdef RTLD_NOW
        { "RTLD_NOW"_s, RTLD_NOW },
#endif
#ifdef RTLD_GLOBAL
        { "RTLD_GLOBAL"_s, RTLD_GLOBAL },
#endif
#ifdef RTLD_LOCAL
        { "RTLD_LOCAL"_s, RTLD_LOCAL },
#endif
#ifdef RTLD_DEEPBIND
        { "RTLD_DEEPBIND"_s, RTLD_DEEPBIND },
#endif
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
        { "PRIORITY_LOW"_s, 19 },
        { "PRIORITY_BELOW_NORMAL"_s, 10 },
        { "PRIORITY_NORMAL"_s, 0 },
        { "PRIORITY_ABOVE_NORMAL"_s, -7 },
        { "PRIORITY_HIGH"_s, -14 },
        { "PRIORITY_HIGHEST"_s, -20 },
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
        // BoringSSL does not define engine constants in openssl/engine.h.
        // Values mirror ProcessBindingConstants.cpp (and node).
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
#endif
#ifdef RSA_PSS_SALTLEN_MAX_SIGN
        { "RSA_PSS_SALTLEN_MAX_SIGN"_s, RSA_PSS_SALTLEN_MAX_SIGN },
#else
        { "RSA_PSS_SALTLEN_MAX_SIGN"_s, -2 },
#endif
#ifdef RSA_PSS_SALTLEN_AUTO
        { "RSA_PSS_SALTLEN_AUTO"_s, RSA_PSS_SALTLEN_AUTO },
#endif
    };
    for (const auto& entry : constants)
        put(Identifier::fromString(vm, entry.name), jsNumber(entry.value));

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

    static constexpr Entry tlsConstants[] = {
#ifdef TLS1_VERSION
        { "TLS1_VERSION"_s, TLS1_VERSION },
#endif
#ifdef TLS1_1_VERSION
        { "TLS1_1_VERSION"_s, TLS1_1_VERSION },
#endif
#ifdef TLS1_2_VERSION
        { "TLS1_2_VERSION"_s, TLS1_2_VERSION },
#endif
#ifdef TLS1_3_VERSION
        { "TLS1_3_VERSION"_s, TLS1_3_VERSION },
#endif
        { "POINT_CONVERSION_COMPRESSED"_s, POINT_CONVERSION_COMPRESSED },
        { "POINT_CONVERSION_UNCOMPRESSED"_s, POINT_CONVERSION_UNCOMPRESSED },
        { "POINT_CONVERSION_HYBRID"_s, POINT_CONVERSION_HYBRID },

        // OBSOLETE OPTIONS retained for compatibility (always 0, as in node).
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
        { "SSL_OP_PKCS1_CHECK_1"_s, 0 },
        { "SSL_OP_PKCS1_CHECK_2"_s, 0 },
        { "SSL_OP_NETSCAPE_CA_DN_BUG"_s, 0 },
        { "SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG"_s, 0 },

        // fs formats the binding exposes; keep in sync with ProcessBindingConstants.cpp.
        { "EXTENSIONLESS_FORMAT_JAVASCRIPT"_s, 0 },
        { "EXTENSIONLESS_FORMAT_WASM"_s, 1 },
    };
    for (const auto& entry : tlsConstants)
        put(Identifier::fromString(vm, entry.name), jsNumber(entry.value));

    // node freezes require('constants') (lib/constants.js ObjectFreeze).
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::objectConstructorFreeze(globalObject, defaultObject);
    RETURN_IF_EXCEPTION(scope, void());

    // RETURN_NATIVE_MODULE();
}

} // namespace Zig
