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

#include <uv.h>

#else // OS(WINDOWS)
#include <dlfcn.h>
#endif

namespace Bun {
using namespace JSC;

static JSValue processBindingConstantsGetOs(VM& vm, JSObject* bindingObject)
{
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
#ifdef E2BIG
    errnoObj->putDirect(vm, Identifier::fromString(vm, "E2BIG"_s), jsNumber(E2BIG));
#endif
#ifdef EACCES
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EACCES"_s), jsNumber(EACCES));
#endif
#ifdef EADDRINUSE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EADDRINUSE"_s), jsNumber(EADDRINUSE));
#endif
#ifdef EADDRNOTAVAIL
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EADDRNOTAVAIL"_s), jsNumber(EADDRNOTAVAIL));
#endif
#ifdef EAFNOSUPPORT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EAFNOSUPPORT"_s), jsNumber(EAFNOSUPPORT));
#endif
#ifdef EAGAIN
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EAGAIN"_s), jsNumber(EAGAIN));
#endif
#ifdef EALREADY
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EALREADY"_s), jsNumber(EALREADY));
#endif
#ifdef EBADF
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EBADF"_s), jsNumber(EBADF));
#endif
#ifdef EBADMSG
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EBADMSG"_s), jsNumber(EBADMSG));
#endif
#ifdef EBUSY
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EBUSY"_s), jsNumber(EBUSY));
#endif
#ifdef ECANCELED
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ECANCELED"_s), jsNumber(ECANCELED));
#endif
#ifdef ECHILD
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ECHILD"_s), jsNumber(ECHILD));
#endif
#ifdef ECONNABORTED
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ECONNABORTED"_s), jsNumber(ECONNABORTED));
#endif
#ifdef ECONNREFUSED
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ECONNREFUSED"_s), jsNumber(ECONNREFUSED));
#endif
#ifdef ECONNRESET
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ECONNRESET"_s), jsNumber(ECONNRESET));
#endif
#ifdef EDEADLK
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EDEADLK"_s), jsNumber(EDEADLK));
#endif
#ifdef EDESTADDRREQ
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EDESTADDRREQ"_s), jsNumber(EDESTADDRREQ));
#endif
#ifdef EDOM
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EDOM"_s), jsNumber(EDOM));
#endif
#ifdef EDQUOT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EDQUOT"_s), jsNumber(EDQUOT));
#endif
#ifdef EEXIST
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EEXIST"_s), jsNumber(EEXIST));
#endif
#ifdef EFAULT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EFAULT"_s), jsNumber(EFAULT));
#endif
#ifdef EFBIG
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EFBIG"_s), jsNumber(EFBIG));
#endif
#ifdef EHOSTUNREACH
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EHOSTUNREACH"_s), jsNumber(EHOSTUNREACH));
#endif
#ifdef EIDRM
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EIDRM"_s), jsNumber(EIDRM));
#endif
#ifdef EILSEQ
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EILSEQ"_s), jsNumber(EILSEQ));
#endif
#ifdef EINPROGRESS
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EINPROGRESS"_s), jsNumber(EINPROGRESS));
#endif
#ifdef EINTR
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EINTR"_s), jsNumber(EINTR));
#endif
#ifdef EINVAL
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EINVAL"_s), jsNumber(EINVAL));
#endif
#ifdef EIO
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EIO"_s), jsNumber(EIO));
#endif
#ifdef EISCONN
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EISCONN"_s), jsNumber(EISCONN));
#endif
#ifdef EISDIR
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EISDIR"_s), jsNumber(EISDIR));
#endif
#ifdef ELOOP
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ELOOP"_s), jsNumber(ELOOP));
#endif
#ifdef EMFILE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EMFILE"_s), jsNumber(EMFILE));
#endif
#ifdef EMLINK
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EMLINK"_s), jsNumber(EMLINK));
#endif
#ifdef EMSGSIZE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EMSGSIZE"_s), jsNumber(EMSGSIZE));
#endif
#ifdef EMULTIHOP
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EMULTIHOP"_s), jsNumber(EMULTIHOP));
#endif
#ifdef ENAMETOOLONG
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENAMETOOLONG"_s), jsNumber(ENAMETOOLONG));
#endif
#ifdef ENETDOWN
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENETDOWN"_s), jsNumber(ENETDOWN));
#endif
#ifdef ENETRESET
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENETRESET"_s), jsNumber(ENETRESET));
#endif
#ifdef ENETUNREACH
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENETUNREACH"_s), jsNumber(ENETUNREACH));
#endif
#ifdef ENFILE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENFILE"_s), jsNumber(ENFILE));
#endif
#ifdef ENOBUFS
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOBUFS"_s), jsNumber(ENOBUFS));
#endif
#ifdef ENODATA
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENODATA"_s), jsNumber(ENODATA));
#endif
#ifdef ENODEV
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENODEV"_s), jsNumber(ENODEV));
#endif
#ifdef ENOENT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOENT"_s), jsNumber(ENOENT));
#endif
#ifdef ENOEXEC
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOEXEC"_s), jsNumber(ENOEXEC));
#endif
#ifdef ENOLCK
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOLCK"_s), jsNumber(ENOLCK));
#endif
#ifdef ENOLINK
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOLINK"_s), jsNumber(ENOLINK));
#endif
#ifdef ENOMEM
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOMEM"_s), jsNumber(ENOMEM));
#endif
#ifdef ENOMSG
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOMSG"_s), jsNumber(ENOMSG));
#endif
#ifdef ENOPROTOOPT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOPROTOOPT"_s), jsNumber(ENOPROTOOPT));
#endif
#ifdef ENOSPC
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOSPC"_s), jsNumber(ENOSPC));
#endif
#ifdef ENOSR
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOSR"_s), jsNumber(ENOSR));
#endif
#ifdef ENOSTR
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOSTR"_s), jsNumber(ENOSTR));
#endif
#ifdef ENOSYS
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOSYS"_s), jsNumber(ENOSYS));
#endif
#ifdef ENOTCONN
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOTCONN"_s), jsNumber(ENOTCONN));
#endif
#ifdef ENOTDIR
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOTDIR"_s), jsNumber(ENOTDIR));
#endif
#ifdef ENOTEMPTY
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOTEMPTY"_s), jsNumber(ENOTEMPTY));
#endif
#ifdef ENOTSOCK
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOTSOCK"_s), jsNumber(ENOTSOCK));
#endif
#ifdef ENOTSUP
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOTSUP"_s), jsNumber(ENOTSUP));
#endif
#ifdef ENOTTY
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENOTTY"_s), jsNumber(ENOTTY));
#endif
#ifdef ENXIO
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ENXIO"_s), jsNumber(ENXIO));
#endif
#ifdef EOPNOTSUPP
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EOPNOTSUPP"_s), jsNumber(EOPNOTSUPP));
#endif
#ifdef EOVERFLOW
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EOVERFLOW"_s), jsNumber(EOVERFLOW));
#endif
#ifdef EPERM
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EPERM"_s), jsNumber(EPERM));
#endif
#ifdef EPIPE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EPIPE"_s), jsNumber(EPIPE));
#endif
#ifdef EPROTO
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EPROTO"_s), jsNumber(EPROTO));
#endif
#ifdef EPROTONOSUPPORT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EPROTONOSUPPORT"_s), jsNumber(EPROTONOSUPPORT));
#endif
#ifdef EPROTOTYPE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EPROTOTYPE"_s), jsNumber(EPROTOTYPE));
#endif
#ifdef ERANGE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ERANGE"_s), jsNumber(ERANGE));
#endif
#ifdef EROFS
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EROFS"_s), jsNumber(EROFS));
#endif
#ifdef ESPIPE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ESPIPE"_s), jsNumber(ESPIPE));
#endif
#ifdef ESRCH
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ESRCH"_s), jsNumber(ESRCH));
#endif
#ifdef ESTALE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ESTALE"_s), jsNumber(ESTALE));
#endif
#ifdef ETIME
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ETIME"_s), jsNumber(ETIME));
#endif
#ifdef ETIMEDOUT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ETIMEDOUT"_s), jsNumber(ETIMEDOUT));
#endif
#ifdef ETXTBSY
    errnoObj->putDirect(vm, Identifier::fromString(vm, "ETXTBSY"_s), jsNumber(ETXTBSY));
#endif
#ifdef EWOULDBLOCK
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EWOULDBLOCK"_s), jsNumber(EWOULDBLOCK));
#endif
#ifdef EXDEV
    errnoObj->putDirect(vm, Identifier::fromString(vm, "EXDEV"_s), jsNumber(EXDEV));
#endif
#ifdef WSAEINTR
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEINTR"_s), jsNumber(WSAEINTR));
#endif
#ifdef WSAEBADF
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEBADF"_s), jsNumber(WSAEBADF));
#endif
#ifdef WSAEACCES
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEACCES"_s), jsNumber(WSAEACCES));
#endif
#ifdef WSAEFAULT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEFAULT"_s), jsNumber(WSAEFAULT));
#endif
#ifdef WSAEINVAL
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEINVAL"_s), jsNumber(WSAEINVAL));
#endif
#ifdef WSAEMFILE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEMFILE"_s), jsNumber(WSAEMFILE));
#endif
#ifdef WSAEWOULDBLOCK
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEWOULDBLOCK"_s), jsNumber(WSAEWOULDBLOCK));
#endif
#ifdef WSAEINPROGRESS
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEINPROGRESS"_s), jsNumber(WSAEINPROGRESS));
#endif
#ifdef WSAEALREADY
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEALREADY"_s), jsNumber(WSAEALREADY));
#endif
#ifdef WSAENOTSOCK
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAENOTSOCK"_s), jsNumber(WSAENOTSOCK));
#endif
#ifdef WSAEDESTADDRREQ
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEDESTADDRREQ"_s), jsNumber(WSAEDESTADDRREQ));
#endif
#ifdef WSAEMSGSIZE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEMSGSIZE"_s), jsNumber(WSAEMSGSIZE));
#endif
#ifdef WSAEPROTOTYPE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEPROTOTYPE"_s), jsNumber(WSAEPROTOTYPE));
#endif
#ifdef WSAENOPROTOOPT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAENOPROTOOPT"_s), jsNumber(WSAENOPROTOOPT));
#endif
#ifdef WSAEPROTONOSUPPORT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEPROTONOSUPPORT"_s), jsNumber(WSAEPROTONOSUPPORT));
#endif
#ifdef WSAESOCKTNOSUPPORT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAESOCKTNOSUPPORT"_s), jsNumber(WSAESOCKTNOSUPPORT));
#endif
#ifdef WSAEOPNOTSUPP
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEOPNOTSUPP"_s), jsNumber(WSAEOPNOTSUPP));
#endif
#ifdef WSAEPFNOSUPPORT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEPFNOSUPPORT"_s), jsNumber(WSAEPFNOSUPPORT));
#endif
#ifdef WSAEAFNOSUPPORT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEAFNOSUPPORT"_s), jsNumber(WSAEAFNOSUPPORT));
#endif
#ifdef WSAEADDRINUSE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEADDRINUSE"_s), jsNumber(WSAEADDRINUSE));
#endif
#ifdef WSAEADDRNOTAVAIL
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEADDRNOTAVAIL"_s), jsNumber(WSAEADDRNOTAVAIL));
#endif
#ifdef WSAENETDOWN
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAENETDOWN"_s), jsNumber(WSAENETDOWN));
#endif
#ifdef WSAENETUNREACH
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAENETUNREACH"_s), jsNumber(WSAENETUNREACH));
#endif
#ifdef WSAENETRESET
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAENETRESET"_s), jsNumber(WSAENETRESET));
#endif
#ifdef WSAECONNABORTED
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAECONNABORTED"_s), jsNumber(WSAECONNABORTED));
#endif
#ifdef WSAECONNRESET
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAECONNRESET"_s), jsNumber(WSAECONNRESET));
#endif
#ifdef WSAENOBUFS
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAENOBUFS"_s), jsNumber(WSAENOBUFS));
#endif
#ifdef WSAEISCONN
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEISCONN"_s), jsNumber(WSAEISCONN));
#endif
#ifdef WSAENOTCONN
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAENOTCONN"_s), jsNumber(WSAENOTCONN));
#endif
#ifdef WSAESHUTDOWN
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAESHUTDOWN"_s), jsNumber(WSAESHUTDOWN));
#endif
#ifdef WSAETOOMANYREFS
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAETOOMANYREFS"_s), jsNumber(WSAETOOMANYREFS));
#endif
#ifdef WSAETIMEDOUT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAETIMEDOUT"_s), jsNumber(WSAETIMEDOUT));
#endif
#ifdef WSAECONNREFUSED
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAECONNREFUSED"_s), jsNumber(WSAECONNREFUSED));
#endif
#ifdef WSAELOOP
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAELOOP"_s), jsNumber(WSAELOOP));
#endif
#ifdef WSAENAMETOOLONG
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAENAMETOOLONG"_s), jsNumber(WSAENAMETOOLONG));
#endif
#ifdef WSAEHOSTDOWN
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEHOSTDOWN"_s), jsNumber(WSAEHOSTDOWN));
#endif
#ifdef WSAEHOSTUNREACH
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEHOSTUNREACH"_s), jsNumber(WSAEHOSTUNREACH));
#endif
#ifdef WSAENOTEMPTY
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAENOTEMPTY"_s), jsNumber(WSAENOTEMPTY));
#endif
#ifdef WSAEPROCLIM
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEPROCLIM"_s), jsNumber(WSAEPROCLIM));
#endif
#ifdef WSAEUSERS
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEUSERS"_s), jsNumber(WSAEUSERS));
#endif
#ifdef WSAEDQUOT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEDQUOT"_s), jsNumber(WSAEDQUOT));
#endif
#ifdef WSAESTALE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAESTALE"_s), jsNumber(WSAESTALE));
#endif
#ifdef WSAEREMOTE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEREMOTE"_s), jsNumber(WSAEREMOTE));
#endif
#ifdef WSASYSNOTREADY
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSASYSNOTREADY"_s), jsNumber(WSASYSNOTREADY));
#endif
#ifdef WSAVERNOTSUPPORTED
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAVERNOTSUPPORTED"_s), jsNumber(WSAVERNOTSUPPORTED));
#endif
#ifdef WSANOTINITIALISED
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSANOTINITIALISED"_s), jsNumber(WSANOTINITIALISED));
#endif
#ifdef WSAEDISCON
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEDISCON"_s), jsNumber(WSAEDISCON));
#endif
#ifdef WSAENOMORE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAENOMORE"_s), jsNumber(WSAENOMORE));
#endif
#ifdef WSAECANCELLED
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAECANCELLED"_s), jsNumber(WSAECANCELLED));
#endif
#ifdef WSAEINVALIDPROCTABLE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEINVALIDPROCTABLE"_s), jsNumber(WSAEINVALIDPROCTABLE));
#endif
#ifdef WSAEINVALIDPROVIDER
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEINVALIDPROVIDER"_s), jsNumber(WSAEINVALIDPROVIDER));
#endif
#ifdef WSAEPROVIDERFAILEDINIT
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEPROVIDERFAILEDINIT"_s), jsNumber(WSAEPROVIDERFAILEDINIT));
#endif
#ifdef WSASYSCALLFAILURE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSASYSCALLFAILURE"_s), jsNumber(WSASYSCALLFAILURE));
#endif
#ifdef WSASERVICE_NOT_FOUND
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSASERVICE_NOT_FOUND"_s), jsNumber(WSASERVICE_NOT_FOUND));
#endif
#ifdef WSATYPE_NOT_FOUND
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSATYPE_NOT_FOUND"_s), jsNumber(WSATYPE_NOT_FOUND));
#endif
#ifdef WSA_E_NO_MORE
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSA_E_NO_MORE"_s), jsNumber(WSA_E_NO_MORE));
#endif
#ifdef WSA_E_CANCELLED
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSA_E_CANCELLED"_s), jsNumber(WSA_E_CANCELLED));
#endif
#ifdef WSAEREFUSED
    errnoObj->putDirect(vm, Identifier::fromString(vm, "WSAEREFUSED"_s), jsNumber(WSAEREFUSED));
#endif
#ifdef SIGHUP
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGHUP"_s), jsNumber(SIGHUP));
#endif
#ifdef SIGINT
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGINT"_s), jsNumber(SIGINT));
#endif
#ifdef SIGQUIT
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGQUIT"_s), jsNumber(SIGQUIT));
#endif
#ifdef SIGILL
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGILL"_s), jsNumber(SIGILL));
#endif
#ifdef SIGTRAP
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGTRAP"_s), jsNumber(SIGTRAP));
#endif
#ifdef SIGABRT
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGABRT"_s), jsNumber(SIGABRT));
#endif
#ifdef SIGIOT
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGIOT"_s), jsNumber(SIGIOT));
#endif
#ifdef SIGBUS
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGBUS"_s), jsNumber(SIGBUS));
#endif
#ifdef SIGFPE
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGFPE"_s), jsNumber(SIGFPE));
#endif
#ifdef SIGKILL
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGKILL"_s), jsNumber(SIGKILL));
#endif
#ifdef SIGUSR1
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGUSR1"_s), jsNumber(SIGUSR1));
#endif
#ifdef SIGSEGV
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGSEGV"_s), jsNumber(SIGSEGV));
#endif
#ifdef SIGUSR2
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGUSR2"_s), jsNumber(SIGUSR2));
#endif
#ifdef SIGPIPE
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGPIPE"_s), jsNumber(SIGPIPE));
#endif
#ifdef SIGALRM
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGALRM"_s), jsNumber(SIGALRM));
#endif
#ifdef SIGTERM
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGTERM"_s), jsNumber(SIGTERM));
#endif
#ifdef SIGCHLD
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGCHLD"_s), jsNumber(SIGCHLD));
#endif
#ifdef SIGSTKFLT
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGSTKFLT"_s), jsNumber(SIGSTKFLT));
#endif
#ifdef SIGCONT
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGCONT"_s), jsNumber(SIGCONT));
#endif
#ifdef SIGSTOP
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGSTOP"_s), jsNumber(SIGSTOP));
#endif
#ifdef SIGTSTP
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGTSTP"_s), jsNumber(SIGTSTP));
#endif
#ifdef SIGBREAK
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGBREAK"_s), jsNumber(SIGBREAK));
#endif
#ifdef SIGTTIN
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGTTIN"_s), jsNumber(SIGTTIN));
#endif
#ifdef SIGTTOU
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGTTOU"_s), jsNumber(SIGTTOU));
#endif
#ifdef SIGURG
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGURG"_s), jsNumber(SIGURG));
#endif
#ifdef SIGXCPU
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGXCPU"_s), jsNumber(SIGXCPU));
#endif
#ifdef SIGXFSZ
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGXFSZ"_s), jsNumber(SIGXFSZ));
#endif
#ifdef SIGVTALRM
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGVTALRM"_s), jsNumber(SIGVTALRM));
#endif
#ifdef SIGPROF
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGPROF"_s), jsNumber(SIGPROF));
#endif
#ifdef SIGWINCH
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGWINCH"_s), jsNumber(SIGWINCH));
#endif
#ifdef SIGIO
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGIO"_s), jsNumber(SIGIO));
#endif
#ifdef SIGPOLL
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGPOLL"_s), jsNumber(SIGPOLL));
#endif
#ifdef SIGLOST
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGLOST"_s), jsNumber(SIGLOST));
#endif
#ifdef SIGPWR
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGPWR"_s), jsNumber(SIGPWR));
#endif
#ifdef SIGINFO
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGINFO"_s), jsNumber(SIGINFO));
#endif
#ifdef SIGSYS
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGSYS"_s), jsNumber(SIGSYS));
#endif
#ifdef SIGUNUSED
    signalsObj->putDirect(vm, Identifier::fromString(vm, "SIGUNUSED"_s), jsNumber(SIGUNUSED));
#endif
    priorityObj->putDirect(vm, Identifier::fromString(vm, "PRIORITY_LOW"_s), jsNumber(19));
    priorityObj->putDirect(vm, Identifier::fromString(vm, "PRIORITY_BELOW_NORMAL"_s), jsNumber(10));
    priorityObj->putDirect(vm, Identifier::fromString(vm, "PRIORITY_NORMAL"_s), jsNumber(0));
    priorityObj->putDirect(vm, Identifier::fromString(vm, "PRIORITY_ABOVE_NORMAL"_s), jsNumber(-7));
    priorityObj->putDirect(vm, Identifier::fromString(vm, "PRIORITY_HIGH"_s), jsNumber(-14));
    priorityObj->putDirect(vm, Identifier::fromString(vm, "PRIORITY_HIGHEST"_s), jsNumber(-20));
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
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_BEGIN"_s)), jsNumber(66));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_END"_s)), jsNumber(69));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_COMPLETE"_s)), jsNumber(88));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_INSTANT"_s)), jsNumber(73));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_ASYNC_BEGIN"_s)), jsNumber(83));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_ASYNC_STEP_INTO"_s)), jsNumber(84));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_ASYNC_STEP_PAST"_s)), jsNumber(112));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_ASYNC_END"_s)), jsNumber(70));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_NESTABLE_ASYNC_BEGIN"_s)), jsNumber(98));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_NESTABLE_ASYNC_END"_s)), jsNumber(101));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_NESTABLE_ASYNC_INSTANT"_s)), jsNumber(110));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_FLOW_BEGIN"_s)), jsNumber(115));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_FLOW_STEP"_s)), jsNumber(116));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_FLOW_END"_s)), jsNumber(102));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_METADATA"_s)), jsNumber(77));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_COUNTER"_s)), jsNumber(67));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_SAMPLE"_s)), jsNumber(80));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_CREATE_OBJECT"_s)), jsNumber(78));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_SNAPSHOT_OBJECT"_s)), jsNumber(79));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_DELETE_OBJECT"_s)), jsNumber(68));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_MEMORY_DUMP"_s)), jsNumber(118));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_MARK"_s)), jsNumber(82));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_CLOCK_SYNC"_s)), jsNumber(99));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_ENTER_CONTEXT"_s)), jsNumber(40));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_LEAVE_CONTEXT"_s)), jsNumber(41));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TRACE_EVENT_PHASE_LINK_IDS"_s)), jsNumber(61));
    return object;
}

static JSValue processBindingConstantsGetFs(VM& vm, JSObject* bindingObject)
{
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_FS_SYMLINK_DIR"_s)), jsNumber(1));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_FS_SYMLINK_JUNCTION"_s)), jsNumber(2));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_RDONLY"_s)), jsNumber(O_RDONLY));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_WRONLY"_s)), jsNumber(O_WRONLY));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_RDWR"_s)), jsNumber(O_RDWR));

    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_DIRENT_UNKNOWN"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_DIRENT_FILE"_s)), jsNumber(1));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_DIRENT_DIR"_s)), jsNumber(2));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_DIRENT_LINK"_s)), jsNumber(3));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_DIRENT_FIFO"_s)), jsNumber(4));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_DIRENT_SOCKET"_s)), jsNumber(5));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_DIRENT_CHAR"_s)), jsNumber(6));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_DIRENT_BLOCK"_s)), jsNumber(7));

    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IFMT"_s)), jsNumber(S_IFMT));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IFREG"_s)), jsNumber(S_IFREG));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IFDIR"_s)), jsNumber(S_IFDIR));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IFCHR"_s)), jsNumber(S_IFCHR));
#ifdef S_IFBLK
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IFBLK"_s)), jsNumber(S_IFBLK));
#endif
#ifdef S_IFIFO
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IFIFO"_s)), jsNumber(S_IFIFO));
#endif
#ifdef S_IFLNK
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IFLNK"_s)), jsNumber(S_IFLNK));
#endif
#ifdef S_IFSOCK
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IFSOCK"_s)), jsNumber(S_IFSOCK));
#endif
#ifdef O_CREAT
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_CREAT"_s)), jsNumber(O_CREAT));
#endif
#ifdef O_EXCL
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_EXCL"_s)), jsNumber(O_EXCL));
#endif
#if OS(WINDOWS)
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_FS_O_FILEMAP"_s)), jsNumber(536870912));
#else
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_FS_O_FILEMAP"_s)), jsNumber(0));
#endif
#ifdef O_NOCTTY
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_NOCTTY"_s)), jsNumber(O_NOCTTY));
#endif
#ifdef O_TRUNC
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_TRUNC"_s)), jsNumber(O_TRUNC));
#endif
#ifdef O_APPEND
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_APPEND"_s)), jsNumber(O_APPEND));
#endif
#ifdef O_DIRECTORY
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_DIRECTORY"_s)), jsNumber(O_DIRECTORY));
#endif
#ifdef O_NOATIME
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_NOATIME"_s)), jsNumber(O_NOATIME));
#endif
#ifdef O_NOFOLLOW
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_NOFOLLOW"_s)), jsNumber(O_NOFOLLOW));
#endif
#ifdef O_SYNC
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_SYNC"_s)), jsNumber(O_SYNC));
#endif
#ifdef O_DSYNC
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_DSYNC"_s)), jsNumber(O_DSYNC));
#endif
#ifdef O_SYMLINK
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_SYMLINK"_s)), jsNumber(O_SYMLINK));
#endif
#ifdef O_DIRECT
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_DIRECT"_s)), jsNumber(O_DIRECT));
#endif
#ifdef O_NONBLOCK
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "O_NONBLOCK"_s)), jsNumber(O_NONBLOCK));
#endif
#ifdef S_IRWXU
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IRWXU"_s)), jsNumber(S_IRWXU));
#endif
#ifdef S_IRUSR
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IRUSR"_s)), jsNumber(S_IRUSR));
#endif
#ifdef S_IWUSR
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IWUSR"_s)), jsNumber(S_IWUSR));
#endif
#ifdef S_IXUSR
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IXUSR"_s)), jsNumber(S_IXUSR));
#endif
#ifdef S_IRWXG
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IRWXG"_s)), jsNumber(S_IRWXG));
#endif
#ifdef S_IRGRP
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IRGRP"_s)), jsNumber(S_IRGRP));
#endif
#ifdef S_IWGRP
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IWGRP"_s)), jsNumber(S_IWGRP));
#endif
#ifdef S_IXGRP
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IXGRP"_s)), jsNumber(S_IXGRP));
#endif
#ifdef S_IRWXO
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IRWXO"_s)), jsNumber(S_IRWXO));
#endif
#ifdef S_IROTH
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IROTH"_s)), jsNumber(S_IROTH));
#endif
#ifdef S_IWOTH
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IWOTH"_s)), jsNumber(S_IWOTH));
#endif
#ifdef S_IXOTH
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "S_IXOTH"_s)), jsNumber(S_IXOTH));
#endif
#ifdef F_OK
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "F_OK"_s)), jsNumber(F_OK));
#endif
#ifdef R_OK
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "R_OK"_s)), jsNumber(R_OK));
#endif
#ifdef W_OK
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "W_OK"_s)), jsNumber(W_OK));
#endif
#ifdef X_OK
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "X_OK"_s)), jsNumber(X_OK));
#endif
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_FS_COPYFILE_EXCL"_s)), jsNumber(1));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "COPYFILE_EXCL"_s)), jsNumber(1));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_FS_COPYFILE_FICLONE"_s)), jsNumber(2));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "COPYFILE_FICLONE"_s)), jsNumber(2));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UV_FS_COPYFILE_FICLONE_FORCE"_s)), jsNumber(4));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "COPYFILE_FICLONE_FORCE"_s)), jsNumber(4));

    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "EXTENSIONLESS_FORMAT_JAVASCRIPT"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "EXTENSIONLESS_FORMAT_WASM"_s)), jsNumber(1));

    return object;
}

static JSValue processBindingConstantsGetCrypto(VM& vm, JSObject* bindingObject)
{
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
#ifdef OPENSSL_VERSION_NUMBER
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "OPENSSL_VERSION_NUMBER"_s)), jsNumber(OPENSSL_VERSION_NUMBER));
#endif
#ifdef SSL_OP_ALL
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_ALL"_s)), jsNumber(SSL_OP_ALL));
#endif
#ifdef SSL_OP_ALLOW_NO_DHE_KEX
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_ALLOW_NO_DHE_KEX"_s)), jsNumber(SSL_OP_ALLOW_NO_DHE_KEX));
#else
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_ALLOW_NO_DHE_KEX"_s)), jsNumber(0));
#endif
#ifdef SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION"_s)), jsNumber(SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION));
#endif
#ifdef SSL_OP_CIPHER_SERVER_PREFERENCE
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_CIPHER_SERVER_PREFERENCE"_s)), jsNumber(SSL_OP_CIPHER_SERVER_PREFERENCE));
#endif
#ifdef SSL_OP_CISCO_ANYCONNECT
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_CISCO_ANYCONNECT"_s)), jsNumber(SSL_OP_CISCO_ANYCONNECT));
#else
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_CISCO_ANYCONNECT"_s)), jsNumber(0));
#endif
#ifdef SSL_OP_COOKIE_EXCHANGE
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_COOKIE_EXCHANGE"_s)), jsNumber(SSL_OP_COOKIE_EXCHANGE));
#else
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_COOKIE_EXCHANGE"_s)), jsNumber(0));
#endif
#ifdef SSL_OP_CRYPTOPRO_TLSEXT_BUG
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_CRYPTOPRO_TLSEXT_BUG"_s)), jsNumber(SSL_OP_CRYPTOPRO_TLSEXT_BUG));
#else
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_CRYPTOPRO_TLSEXT_BUG"_s)), jsNumber(0));
#endif
#ifdef SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS"_s)), jsNumber(SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS));
#endif
#ifdef SSL_OP_LEGACY_SERVER_CONNECT
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_LEGACY_SERVER_CONNECT"_s)), jsNumber(SSL_OP_LEGACY_SERVER_CONNECT));
#endif
#ifdef SSL_OP_NO_COMPRESSION
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_COMPRESSION"_s)), jsNumber(SSL_OP_NO_COMPRESSION));
#endif
#ifdef SSL_OP_NO_ENCRYPT_THEN_MAC
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_ENCRYPT_THEN_MAC"_s)), jsNumber(SSL_OP_NO_ENCRYPT_THEN_MAC));
#else
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_ENCRYPT_THEN_MAC"_s)), jsNumber(0));
#endif
#ifdef SSL_OP_NO_QUERY_MTU
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_QUERY_MTU"_s)), jsNumber(SSL_OP_NO_QUERY_MTU));
#endif
#ifdef SSL_OP_NO_RENEGOTIATION
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_RENEGOTIATION"_s)), jsNumber(SSL_OP_NO_RENEGOTIATION));
#endif
#ifdef SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION"_s)), jsNumber(SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION));
#endif
#ifdef SSL_OP_NO_SSLv2
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_SSLv2"_s)), jsNumber(SSL_OP_NO_SSLv2));
#endif
#ifdef SSL_OP_NO_SSLv3
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_SSLv3"_s)), jsNumber(SSL_OP_NO_SSLv3));
#endif
#ifdef SSL_OP_NO_TICKET
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_TICKET"_s)), jsNumber(SSL_OP_NO_TICKET));
#endif
#ifdef SSL_OP_NO_TLSv1
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_TLSv1"_s)), jsNumber(SSL_OP_NO_TLSv1));
#endif
#ifdef SSL_OP_NO_TLSv1_1
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_TLSv1_1"_s)), jsNumber(SSL_OP_NO_TLSv1_1));
#endif
#ifdef SSL_OP_NO_TLSv1_2
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_TLSv1_2"_s)), jsNumber(SSL_OP_NO_TLSv1_2));
#endif
#ifdef SSL_OP_NO_TLSv1_3
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_TLSv1_3"_s)), jsNumber(SSL_OP_NO_TLSv1_3));
#endif
#ifdef SSL_OP_PRIORITIZE_CHACHA
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_PRIORITIZE_CHACHA"_s)), jsNumber(SSL_OP_PRIORITIZE_CHACHA));
#else
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_PRIORITIZE_CHACHA"_s)), jsNumber(0));
#endif
#ifdef SSL_OP_TLS_ROLLBACK_BUG
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_TLS_ROLLBACK_BUG"_s)), jsNumber(SSL_OP_TLS_ROLLBACK_BUG));
#endif
    // OBSOLETE OPTIONS retained for compatibility
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_MICROSOFT_SESS_ID_BUG"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NETSCAPE_CHALLENGE_BUG"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_MSIE_SSLV2_RSA_PADDING"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_SSLEAY_080_CLIENT_DH_BUG"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_TLS_D5_BUG"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_TLS_BLOCK_PADDING_BUG"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_SINGLE_ECDH_USE"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_SINGLE_DH_USE"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_EPHEMERAL_RSA"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NO_SSLv2"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_PKCS1_CHECK_1"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_PKCS1_CHECK_2"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NETSCAPE_CA_DN_BUG"_s)), jsNumber(0));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG"_s)), jsNumber(0));
    // BoringSSL does not define engine constants in openssl/engine.h
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ENGINE_METHOD_RSA"_s)), jsNumber(0x0001));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ENGINE_METHOD_DSA"_s)), jsNumber(0x0002));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ENGINE_METHOD_DH"_s)), jsNumber(0x0004));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ENGINE_METHOD_RAND"_s)), jsNumber(0x0008));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ENGINE_METHOD_CIPHERS"_s)), jsNumber(0x0040));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ENGINE_METHOD_DIGESTS"_s)), jsNumber(0x0080));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ENGINE_METHOD_PKEY_METHS"_s)), jsNumber(0x0200));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ENGINE_METHOD_PKEY_ASN1_METHS"_s)), jsNumber(0x0400));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ENGINE_METHOD_EC"_s)), jsNumber(0x0800));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ENGINE_METHOD_ALL"_s)), jsNumber(0xFFFF));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ENGINE_METHOD_NONE"_s)), jsNumber(0x0000));
#ifdef DH_CHECK_P_NOT_SAFE_PRIME
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "DH_CHECK_P_NOT_SAFE_PRIME"_s)), jsNumber(DH_CHECK_P_NOT_SAFE_PRIME));
#endif
#ifdef DH_CHECK_P_NOT_PRIME
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "DH_CHECK_P_NOT_PRIME"_s)), jsNumber(DH_CHECK_P_NOT_PRIME));
#endif
#ifdef DH_UNABLE_TO_CHECK_GENERATOR
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "DH_UNABLE_TO_CHECK_GENERATOR"_s)), jsNumber(DH_UNABLE_TO_CHECK_GENERATOR));
#endif
#ifdef DH_NOT_SUITABLE_GENERATOR
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "DH_NOT_SUITABLE_GENERATOR"_s)), jsNumber(DH_NOT_SUITABLE_GENERATOR));
#endif
#ifdef RSA_PKCS1_PADDING
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_PKCS1_PADDING"_s)), jsNumber(RSA_PKCS1_PADDING));
#endif
#ifdef RSA_SSLV23_PADDING
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_SSLV23_PADDING"_s)), jsNumber(RSA_SSLV23_PADDING));
#endif
#ifdef RSA_NO_PADDING
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_NO_PADDING"_s)), jsNumber(RSA_NO_PADDING));
#endif
#ifdef RSA_PKCS1_OAEP_PADDING
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_PKCS1_OAEP_PADDING"_s)), jsNumber(RSA_PKCS1_OAEP_PADDING));
#endif
#ifdef RSA_X931_PADDING
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_X931_PADDING"_s)), jsNumber(RSA_X931_PADDING));
#else
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_X931_PADDING"_s)), jsNumber(5));
#endif
#ifdef RSA_PKCS1_PSS_PADDING
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_PKCS1_PSS_PADDING"_s)), jsNumber(RSA_PKCS1_PSS_PADDING));
#endif
#ifdef RSA_PSS_SALTLEN_DIGEST
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_PSS_SALTLEN_DIGEST"_s)), jsNumber(RSA_PSS_SALTLEN_DIGEST));
#else
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_PSS_SALTLEN_DIGEST"_s)), jsNumber(-1));
#endif
#ifdef RSA_PSS_SALTLEN_MAX_SIGN
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_PSS_SALTLEN_MAX_SIGN"_s)), jsNumber(RSA_PSS_SALTLEN_MAX_SIGN));
#else
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_PSS_SALTLEN_MAX_SIGN"_s)), jsNumber(-2));
#endif
#ifdef RSA_PSS_SALTLEN_AUTO
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_PSS_SALTLEN_AUTO"_s)), jsNumber(RSA_PSS_SALTLEN_AUTO));
#else
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "RSA_PSS_SALTLEN_AUTO"_s)), jsNumber(-2));
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
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "defaultCoreCipherList"_s)),
        jsString(vm, cipherList));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "defaultCipherList"_s)),
        jsString(vm, cipherList));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TLS1_VERSION"_s)), jsNumber(TLS1_VERSION));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TLS1_1_VERSION"_s)), jsNumber(TLS1_1_VERSION));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TLS1_2_VERSION"_s)), jsNumber(TLS1_2_VERSION));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "TLS1_3_VERSION"_s)), jsNumber(TLS1_3_VERSION));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "POINT_CONVERSION_COMPRESSED"_s)), jsNumber(POINT_CONVERSION_COMPRESSED));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "POINT_CONVERSION_UNCOMPRESSED"_s)), jsNumber(POINT_CONVERSION_UNCOMPRESSED));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "POINT_CONVERSION_HYBRID"_s)), jsNumber(POINT_CONVERSION_HYBRID));
    return object;
}

static JSValue processBindingConstantsGetZlib(VM& vm, JSObject* bindingObject)
{
    auto globalObject = bindingObject->globalObject();
    auto object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_NO_FLUSH"_s)), jsNumber(Z_NO_FLUSH));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_PARTIAL_FLUSH"_s)), jsNumber(Z_PARTIAL_FLUSH));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_SYNC_FLUSH"_s)), jsNumber(Z_SYNC_FLUSH));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_FULL_FLUSH"_s)), jsNumber(Z_FULL_FLUSH));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_FINISH"_s)), jsNumber(Z_FINISH));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_BLOCK"_s)), jsNumber(Z_BLOCK));

    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_OK"_s)), jsNumber(Z_OK));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_STREAM_END"_s)), jsNumber(Z_STREAM_END));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_NEED_DICT"_s)), jsNumber(Z_NEED_DICT));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_ERRNO"_s)), jsNumber(Z_ERRNO));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_STREAM_ERROR"_s)), jsNumber(Z_STREAM_ERROR));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_DATA_ERROR"_s)), jsNumber(Z_DATA_ERROR));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_MEM_ERROR"_s)), jsNumber(Z_MEM_ERROR));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_BUF_ERROR"_s)), jsNumber(Z_BUF_ERROR));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_VERSION_ERROR"_s)), jsNumber(Z_VERSION_ERROR));

    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_NO_COMPRESSION"_s)), jsNumber(Z_NO_COMPRESSION));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_BEST_SPEED"_s)), jsNumber(Z_BEST_SPEED));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_BEST_COMPRESSION"_s)), jsNumber(Z_BEST_COMPRESSION));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_DEFAULT_COMPRESSION"_s)), jsNumber(Z_DEFAULT_COMPRESSION));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_FILTERED"_s)), jsNumber(Z_FILTERED));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_HUFFMAN_ONLY"_s)), jsNumber(Z_HUFFMAN_ONLY));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_RLE"_s)), jsNumber(Z_RLE));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_FIXED"_s)), jsNumber(Z_FIXED));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_DEFAULT_STRATEGY"_s)), jsNumber(Z_DEFAULT_STRATEGY));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "ZLIB_VERNUM"_s)), jsNumber(ZLIB_VERNUM));

    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "DEFLATE"_s)), jsNumber(1));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "INFLATE"_s)), jsNumber(2));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "GZIP"_s)), jsNumber(3));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "GUNZIP"_s)), jsNumber(4));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "DEFLATERAW"_s)), jsNumber(5));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "INFLATERAW"_s)), jsNumber(6));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "UNZIP"_s)), jsNumber(7));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODE"_s)), jsNumber(8));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_ENCODE"_s)), jsNumber(9));

    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_MIN_WINDOWBITS"_s)), jsNumber(8));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_MAX_WINDOWBITS"_s)), jsNumber(15));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_DEFAULT_WINDOWBITS"_s)), jsNumber(15));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_MIN_CHUNK"_s)), jsNumber(64));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_MAX_CHUNK"_s)), jsNumber(std::numeric_limits<double>::infinity()));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_DEFAULT_CHUNK"_s)), jsNumber(16 * 1024));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_MIN_MEMLEVEL"_s)), jsNumber(1));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_MAX_MEMLEVEL"_s)), jsNumber(9));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_DEFAULT_MEMLEVEL"_s)), jsNumber(8));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_MIN_LEVEL"_s)), jsNumber(-1));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_MAX_LEVEL"_s)), jsNumber(9));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "Z_DEFAULT_LEVEL"_s)), jsNumber(Z_DEFAULT_COMPRESSION));

    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_OPERATION_PROCESS"_s)), jsNumber(BROTLI_OPERATION_PROCESS));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_OPERATION_FLUSH"_s)), jsNumber(BROTLI_OPERATION_FLUSH));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_OPERATION_FINISH"_s)), jsNumber(BROTLI_OPERATION_FINISH));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_OPERATION_EMIT_METADATA"_s)), jsNumber(BROTLI_OPERATION_EMIT_METADATA));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_PARAM_MODE"_s)), jsNumber(BROTLI_PARAM_MODE));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_MODE_GENERIC"_s)), jsNumber(BROTLI_MODE_GENERIC));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_MODE_TEXT"_s)), jsNumber(BROTLI_MODE_TEXT));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_MODE_FONT"_s)), jsNumber(BROTLI_MODE_FONT));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DEFAULT_MODE"_s)), jsNumber(BROTLI_DEFAULT_MODE));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_PARAM_QUALITY"_s)), jsNumber(BROTLI_PARAM_QUALITY));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_MIN_QUALITY"_s)), jsNumber(BROTLI_MIN_QUALITY));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_MAX_QUALITY"_s)), jsNumber(BROTLI_MAX_QUALITY));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DEFAULT_QUALITY"_s)), jsNumber(BROTLI_DEFAULT_QUALITY));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_PARAM_LGWIN"_s)), jsNumber(BROTLI_PARAM_LGWIN));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_MIN_WINDOW_BITS"_s)), jsNumber(BROTLI_MIN_WINDOW_BITS));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_MAX_WINDOW_BITS"_s)), jsNumber(BROTLI_MAX_WINDOW_BITS));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_LARGE_MAX_WINDOW_BITS"_s)), jsNumber(BROTLI_LARGE_MAX_WINDOW_BITS));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DEFAULT_WINDOW"_s)), jsNumber(BROTLI_DEFAULT_WINDOW));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_PARAM_LGBLOCK"_s)), jsNumber(BROTLI_PARAM_LGBLOCK));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_MIN_INPUT_BLOCK_BITS"_s)), jsNumber(BROTLI_MIN_INPUT_BLOCK_BITS));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_MAX_INPUT_BLOCK_BITS"_s)), jsNumber(BROTLI_MAX_INPUT_BLOCK_BITS));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING"_s)), jsNumber(BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_PARAM_SIZE_HINT"_s)), jsNumber(BROTLI_PARAM_SIZE_HINT));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_PARAM_LARGE_WINDOW"_s)), jsNumber(BROTLI_PARAM_LARGE_WINDOW));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_PARAM_NPOSTFIX"_s)), jsNumber(BROTLI_PARAM_NPOSTFIX));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_PARAM_NDIRECT"_s)), jsNumber(BROTLI_PARAM_NDIRECT));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_RESULT_ERROR"_s)), jsNumber(BROTLI_DECODER_RESULT_ERROR));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_RESULT_SUCCESS"_s)), jsNumber(BROTLI_DECODER_RESULT_SUCCESS));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT"_s)), jsNumber(BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT"_s)), jsNumber(BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION"_s)), jsNumber(BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_PARAM_LARGE_WINDOW"_s)), jsNumber(BROTLI_DECODER_PARAM_LARGE_WINDOW));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_NO_ERROR"_s)), jsNumber(BROTLI_DECODER_NO_ERROR));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_SUCCESS"_s)), jsNumber(BROTLI_DECODER_SUCCESS));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_NEEDS_MORE_INPUT"_s)), jsNumber(BROTLI_DECODER_NEEDS_MORE_INPUT));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_NEEDS_MORE_OUTPUT"_s)), jsNumber(BROTLI_DECODER_NEEDS_MORE_OUTPUT));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_RESERVED"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_RESERVED));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_CL_SPACE"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_CL_SPACE));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_TRANSFORM"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_TRANSFORM));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_DICTIONARY"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_DICTIONARY));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_PADDING_1"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_PADDING_1));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_PADDING_2"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_PADDING_2));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_FORMAT_DISTANCE"_s)), jsNumber(BROTLI_DECODER_ERROR_FORMAT_DISTANCE));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET"_s)), jsNumber(BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_INVALID_ARGUMENTS"_s)), jsNumber(BROTLI_DECODER_ERROR_INVALID_ARGUMENTS));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES"_s)), jsNumber(BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS"_s)), jsNumber(BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP"_s)), jsNumber(BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1"_s)), jsNumber(BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2"_s)), jsNumber(BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES"_s)), jsNumber(BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "BROTLI_DECODER_ERROR_UNREACHABLE"_s)), jsNumber(BROTLI_DECODER_ERROR_UNREACHABLE));

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
    ProcessBindingConstants* thisObject = jsCast<ProcessBindingConstants*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(ProcessBindingConstants);

} // namespace Bun
