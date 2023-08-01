#include "_NativeModule.h"

namespace Zig {
using namespace WebCore;

DEFINE_NATIVE_MODULE(NodeConstants) {
  INIT_NATIVE_MODULE(63);
#if __APPLE__
  put(JSC::Identifier::fromString(vm, "RTLD_LAZY"_s), JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "RTLD_NOW"_s), JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "RTLD_GLOBAL"_s), JSC::jsNumber(256));
  put(JSC::Identifier::fromString(vm, "RTLD_LOCAL"_s), JSC::jsNumber(0));
  put(JSC::Identifier::fromString(vm, "RTLD_DEEPBIND"_s), JSC::jsNumber(8));
  put(JSC::Identifier::fromString(vm, "E2BIG"_s), JSC::jsNumber(7));
  put(JSC::Identifier::fromString(vm, "EACCES"_s), JSC::jsNumber(13));
  put(JSC::Identifier::fromString(vm, "EADDRINUSE"_s), JSC::jsNumber(98));
  put(JSC::Identifier::fromString(vm, "EADDRNOTAVAIL"_s), JSC::jsNumber(99));
  put(JSC::Identifier::fromString(vm, "EAFNOSUPPORT"_s), JSC::jsNumber(97));
  put(JSC::Identifier::fromString(vm, "EAGAIN"_s), JSC::jsNumber(11));
  put(JSC::Identifier::fromString(vm, "EALREADY"_s), JSC::jsNumber(114));
  put(JSC::Identifier::fromString(vm, "EBADF"_s), JSC::jsNumber(9));
  put(JSC::Identifier::fromString(vm, "EBADMSG"_s), JSC::jsNumber(74));
  put(JSC::Identifier::fromString(vm, "EBUSY"_s), JSC::jsNumber(16));
  put(JSC::Identifier::fromString(vm, "ECANCELED"_s), JSC::jsNumber(125));
  put(JSC::Identifier::fromString(vm, "ECHILD"_s), JSC::jsNumber(10));
  put(JSC::Identifier::fromString(vm, "ECONNABORTED"_s), JSC::jsNumber(103));
  put(JSC::Identifier::fromString(vm, "ECONNREFUSED"_s), JSC::jsNumber(111));
  put(JSC::Identifier::fromString(vm, "ECONNRESET"_s), JSC::jsNumber(104));
  put(JSC::Identifier::fromString(vm, "EDEADLK"_s), JSC::jsNumber(35));
  put(JSC::Identifier::fromString(vm, "EDESTADDRREQ"_s), JSC::jsNumber(89));
  put(JSC::Identifier::fromString(vm, "EDOM"_s), JSC::jsNumber(33));
  put(JSC::Identifier::fromString(vm, "EDQUOT"_s), JSC::jsNumber(122));
  put(JSC::Identifier::fromString(vm, "EEXIST"_s), JSC::jsNumber(17));
  put(JSC::Identifier::fromString(vm, "EFAULT"_s), JSC::jsNumber(14));
  put(JSC::Identifier::fromString(vm, "EFBIG"_s), JSC::jsNumber(27));
  put(JSC::Identifier::fromString(vm, "EHOSTUNREACH"_s), JSC::jsNumber(113));
  put(JSC::Identifier::fromString(vm, "EIDRM"_s), JSC::jsNumber(43));
  put(JSC::Identifier::fromString(vm, "EILSEQ"_s), JSC::jsNumber(84));
  put(JSC::Identifier::fromString(vm, "EINPROGRESS"_s), JSC::jsNumber(115));
  put(JSC::Identifier::fromString(vm, "EINTR"_s), JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "EINVAL"_s), JSC::jsNumber(22));
  put(JSC::Identifier::fromString(vm, "EIO"_s), JSC::jsNumber(5));
  put(JSC::Identifier::fromString(vm, "EISCONN"_s), JSC::jsNumber(106));
  put(JSC::Identifier::fromString(vm, "EISDIR"_s), JSC::jsNumber(21));
  put(JSC::Identifier::fromString(vm, "ELOOP"_s), JSC::jsNumber(40));
  put(JSC::Identifier::fromString(vm, "EMFILE"_s), JSC::jsNumber(24));
  put(JSC::Identifier::fromString(vm, "EMLINK"_s), JSC::jsNumber(31));
  put(JSC::Identifier::fromString(vm, "EMSGSIZE"_s), JSC::jsNumber(90));
  put(JSC::Identifier::fromString(vm, "EMULTIHOP"_s), JSC::jsNumber(72));
  put(JSC::Identifier::fromString(vm, "ENAMETOOLONG"_s), JSC::jsNumber(36));
  put(JSC::Identifier::fromString(vm, "ENETDOWN"_s), JSC::jsNumber(100));
  put(JSC::Identifier::fromString(vm, "ENETRESET"_s), JSC::jsNumber(102));
  put(JSC::Identifier::fromString(vm, "ENETUNREACH"_s), JSC::jsNumber(101));
  put(JSC::Identifier::fromString(vm, "ENFILE"_s), JSC::jsNumber(23));
  put(JSC::Identifier::fromString(vm, "ENOBUFS"_s), JSC::jsNumber(105));
  put(JSC::Identifier::fromString(vm, "ENODATA"_s), JSC::jsNumber(61));
  put(JSC::Identifier::fromString(vm, "ENODEV"_s), JSC::jsNumber(19));
  put(JSC::Identifier::fromString(vm, "ENOENT"_s), JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "ENOEXEC"_s), JSC::jsNumber(8));
  put(JSC::Identifier::fromString(vm, "ENOLCK"_s), JSC::jsNumber(37));
  put(JSC::Identifier::fromString(vm, "ENOLINK"_s), JSC::jsNumber(67));
  put(JSC::Identifier::fromString(vm, "ENOMEM"_s), JSC::jsNumber(12));
  put(JSC::Identifier::fromString(vm, "ENOMSG"_s), JSC::jsNumber(42));
  put(JSC::Identifier::fromString(vm, "ENOPROTOOPT"_s), JSC::jsNumber(92));
  put(JSC::Identifier::fromString(vm, "ENOSPC"_s), JSC::jsNumber(28));
  put(JSC::Identifier::fromString(vm, "ENOSR"_s), JSC::jsNumber(63));
  put(JSC::Identifier::fromString(vm, "ENOSTR"_s), JSC::jsNumber(60));
  put(JSC::Identifier::fromString(vm, "ENOSYS"_s), JSC::jsNumber(38));
  put(JSC::Identifier::fromString(vm, "ENOTCONN"_s), JSC::jsNumber(107));
  put(JSC::Identifier::fromString(vm, "ENOTDIR"_s), JSC::jsNumber(20));
  put(JSC::Identifier::fromString(vm, "ENOTEMPTY"_s), JSC::jsNumber(39));
  put(JSC::Identifier::fromString(vm, "ENOTSOCK"_s), JSC::jsNumber(88));
  put(JSC::Identifier::fromString(vm, "ENOTSUP"_s), JSC::jsNumber(95));
  put(JSC::Identifier::fromString(vm, "ENOTTY"_s), JSC::jsNumber(25));
  put(JSC::Identifier::fromString(vm, "ENXIO"_s), JSC::jsNumber(6));
  put(JSC::Identifier::fromString(vm, "EOPNOTSUPP"_s), JSC::jsNumber(95));
  put(JSC::Identifier::fromString(vm, "EOVERFLOW"_s), JSC::jsNumber(75));
  put(JSC::Identifier::fromString(vm, "EPERM"_s), JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "EPIPE"_s), JSC::jsNumber(32));
  put(JSC::Identifier::fromString(vm, "EPROTO"_s), JSC::jsNumber(71));
  put(JSC::Identifier::fromString(vm, "EPROTONOSUPPORT"_s), JSC::jsNumber(93));
  put(JSC::Identifier::fromString(vm, "EPROTOTYPE"_s), JSC::jsNumber(91));
  put(JSC::Identifier::fromString(vm, "ERANGE"_s), JSC::jsNumber(34));
  put(JSC::Identifier::fromString(vm, "EROFS"_s), JSC::jsNumber(30));
  put(JSC::Identifier::fromString(vm, "ESPIPE"_s), JSC::jsNumber(29));
  put(JSC::Identifier::fromString(vm, "ESRCH"_s), JSC::jsNumber(3));
  put(JSC::Identifier::fromString(vm, "ESTALE"_s), JSC::jsNumber(116));
  put(JSC::Identifier::fromString(vm, "ETIME"_s), JSC::jsNumber(62));
  put(JSC::Identifier::fromString(vm, "ETIMEDOUT"_s), JSC::jsNumber(110));
  put(JSC::Identifier::fromString(vm, "ETXTBSY"_s), JSC::jsNumber(26));
  put(JSC::Identifier::fromString(vm, "EWOULDBLOCK"_s), JSC::jsNumber(11));
  put(JSC::Identifier::fromString(vm, "EXDEV"_s), JSC::jsNumber(18));
  put(JSC::Identifier::fromString(vm, "PRIORITY_LOW"_s), JSC::jsNumber(19));
  put(JSC::Identifier::fromString(vm, "PRIORITY_BELOW_NORMAL"_s),
      JSC::jsNumber(10));
  put(JSC::Identifier::fromString(vm, "PRIORITY_NORMAL"_s), JSC::jsNumber(0));
  put(JSC::Identifier::fromString(vm, "PRIORITY_ABOVE_NORMAL"_s),
      JSC::jsNumber(-7));
  put(JSC::Identifier::fromString(vm, "PRIORITY_HIGH"_s), JSC::jsNumber(-14));
  put(JSC::Identifier::fromString(vm, "PRIORITY_HIGHEST"_s),
      JSC::jsNumber(-20));
  put(JSC::Identifier::fromString(vm, "SIGHUP"_s), JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "SIGINT"_s), JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "SIGQUIT"_s), JSC::jsNumber(3));
  put(JSC::Identifier::fromString(vm, "SIGILL"_s), JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "SIGTRAP"_s), JSC::jsNumber(5));
  put(JSC::Identifier::fromString(vm, "SIGABRT"_s), JSC::jsNumber(6));
  put(JSC::Identifier::fromString(vm, "SIGIOT"_s), JSC::jsNumber(6));
  put(JSC::Identifier::fromString(vm, "SIGBUS"_s), JSC::jsNumber(7));
  put(JSC::Identifier::fromString(vm, "SIGFPE"_s), JSC::jsNumber(8));
  put(JSC::Identifier::fromString(vm, "SIGKILL"_s), JSC::jsNumber(9));
  put(JSC::Identifier::fromString(vm, "SIGUSR1"_s), JSC::jsNumber(10));
  put(JSC::Identifier::fromString(vm, "SIGSEGV"_s), JSC::jsNumber(11));
  put(JSC::Identifier::fromString(vm, "SIGUSR2"_s), JSC::jsNumber(12));
  put(JSC::Identifier::fromString(vm, "SIGPIPE"_s), JSC::jsNumber(13));
  put(JSC::Identifier::fromString(vm, "SIGALRM"_s), JSC::jsNumber(14));
  put(JSC::Identifier::fromString(vm, "SIGTERM"_s), JSC::jsNumber(15));
  put(JSC::Identifier::fromString(vm, "SIGCHLD"_s), JSC::jsNumber(17));
  put(JSC::Identifier::fromString(vm, "SIGSTKFLT"_s), JSC::jsNumber(16));
  put(JSC::Identifier::fromString(vm, "SIGCONT"_s), JSC::jsNumber(18));
  put(JSC::Identifier::fromString(vm, "SIGSTOP"_s), JSC::jsNumber(19));
  put(JSC::Identifier::fromString(vm, "SIGTSTP"_s), JSC::jsNumber(20));
  put(JSC::Identifier::fromString(vm, "SIGTTIN"_s), JSC::jsNumber(21));
  put(JSC::Identifier::fromString(vm, "SIGTTOU"_s), JSC::jsNumber(22));
  put(JSC::Identifier::fromString(vm, "SIGURG"_s), JSC::jsNumber(23));
  put(JSC::Identifier::fromString(vm, "SIGXCPU"_s), JSC::jsNumber(24));
  put(JSC::Identifier::fromString(vm, "SIGXFSZ"_s), JSC::jsNumber(25));
  put(JSC::Identifier::fromString(vm, "SIGVTALRM"_s), JSC::jsNumber(26));
  put(JSC::Identifier::fromString(vm, "SIGPROF"_s), JSC::jsNumber(27));
  put(JSC::Identifier::fromString(vm, "SIGWINCH"_s), JSC::jsNumber(28));
  put(JSC::Identifier::fromString(vm, "SIGIO"_s), JSC::jsNumber(29));
  put(JSC::Identifier::fromString(vm, "SIGPOLL"_s), JSC::jsNumber(29));
  put(JSC::Identifier::fromString(vm, "SIGPWR"_s), JSC::jsNumber(30));
  put(JSC::Identifier::fromString(vm, "SIGSYS"_s), JSC::jsNumber(31));
  put(JSC::Identifier::fromString(vm, "UV_FS_SYMLINK_DIR"_s), JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_FS_SYMLINK_JUNCTION"_s),
      JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "O_RDONLY"_s), JSC::jsNumber(0));
  put(JSC::Identifier::fromString(vm, "O_WRONLY"_s), JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "O_RDWR"_s), JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_UNKNOWN"_s), JSC::jsNumber(0));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_FILE"_s), JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_DIR"_s), JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_LINK"_s), JSC::jsNumber(3));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_FIFO"_s), JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_SOCKET"_s), JSC::jsNumber(5));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_CHAR"_s), JSC::jsNumber(6));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_BLOCK"_s), JSC::jsNumber(7));
  put(JSC::Identifier::fromString(vm, "S_IFMT"_s), JSC::jsNumber(61440));
  put(JSC::Identifier::fromString(vm, "S_IFREG"_s), JSC::jsNumber(32768));
  put(JSC::Identifier::fromString(vm, "S_IFDIR"_s), JSC::jsNumber(16384));
  put(JSC::Identifier::fromString(vm, "S_IFCHR"_s), JSC::jsNumber(8192));
  put(JSC::Identifier::fromString(vm, "S_IFBLK"_s), JSC::jsNumber(24576));
  put(JSC::Identifier::fromString(vm, "S_IFIFO"_s), JSC::jsNumber(4096));
  put(JSC::Identifier::fromString(vm, "S_IFLNK"_s), JSC::jsNumber(40960));
  put(JSC::Identifier::fromString(vm, "S_IFSOCK"_s), JSC::jsNumber(49152));
  put(JSC::Identifier::fromString(vm, "O_CREAT"_s), JSC::jsNumber(64));
  put(JSC::Identifier::fromString(vm, "O_EXCL"_s), JSC::jsNumber(128));
  put(JSC::Identifier::fromString(vm, "UV_FS_O_FILEMAP"_s), JSC::jsNumber(0));
  put(JSC::Identifier::fromString(vm, "O_NOCTTY"_s), JSC::jsNumber(256));
  put(JSC::Identifier::fromString(vm, "O_TRUNC"_s), JSC::jsNumber(512));
  put(JSC::Identifier::fromString(vm, "O_APPEND"_s), JSC::jsNumber(1024));
  put(JSC::Identifier::fromString(vm, "O_DIRECTORY"_s), JSC::jsNumber(65536));
  put(JSC::Identifier::fromString(vm, "O_NOATIME"_s), JSC::jsNumber(262144));
  put(JSC::Identifier::fromString(vm, "O_NOFOLLOW"_s), JSC::jsNumber(131072));
  put(JSC::Identifier::fromString(vm, "O_SYNC"_s), JSC::jsNumber(1052672));
  put(JSC::Identifier::fromString(vm, "O_DSYNC"_s), JSC::jsNumber(4096));
  put(JSC::Identifier::fromString(vm, "O_DIRECT"_s), JSC::jsNumber(16384));
  put(JSC::Identifier::fromString(vm, "O_NONBLOCK"_s), JSC::jsNumber(2048));
  put(JSC::Identifier::fromString(vm, "S_IRWXU"_s), JSC::jsNumber(448));
  put(JSC::Identifier::fromString(vm, "S_IRUSR"_s), JSC::jsNumber(256));
  put(JSC::Identifier::fromString(vm, "S_IWUSR"_s), JSC::jsNumber(128));
  put(JSC::Identifier::fromString(vm, "S_IXUSR"_s), JSC::jsNumber(64));
  put(JSC::Identifier::fromString(vm, "S_IRWXG"_s), JSC::jsNumber(56));
  put(JSC::Identifier::fromString(vm, "S_IRGRP"_s), JSC::jsNumber(32));
  put(JSC::Identifier::fromString(vm, "S_IWGRP"_s), JSC::jsNumber(16));
  put(JSC::Identifier::fromString(vm, "S_IXGRP"_s), JSC::jsNumber(8));
  put(JSC::Identifier::fromString(vm, "S_IRWXO"_s), JSC::jsNumber(7));
  put(JSC::Identifier::fromString(vm, "S_IROTH"_s), JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "S_IWOTH"_s), JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "S_IXOTH"_s), JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "F_OK"_s), JSC::jsNumber(0));
  put(JSC::Identifier::fromString(vm, "R_OK"_s), JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "W_OK"_s), JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "X_OK"_s), JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_FS_COPYFILE_EXCL"_s),
      JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "COPYFILE_EXCL"_s), JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_FS_COPYFILE_FICLONE"_s),
      JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "COPYFILE_FICLONE"_s), JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "UV_FS_COPYFILE_FICLONE_FORCE"_s),
      JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "COPYFILE_FICLONE_FORCE"_s),
      JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "OPENSSL_VERSION_NUMBER"_s),
      JSC::jsNumber(805306496));
  put(JSC::Identifier::fromString(vm, "SSL_OP_ALL"_s),
      JSC::jsNumber(2147485776));
  put(JSC::Identifier::fromString(vm, "SSL_OP_ALLOW_NO_DHE_KEX"_s),
      JSC::jsNumber(1024));
  put(JSC::Identifier::fromString(vm,
                                  "SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION"_s),
      JSC::jsNumber(262144));
  put(JSC::Identifier::fromString(vm, "SSL_OP_CIPHER_SERVER_PREFERENCE"_s),
      JSC::jsNumber(4194304));
  put(JSC::Identifier::fromString(vm, "SSL_OP_CISCO_ANYCONNECT"_s),
      JSC::jsNumber(32768));
  put(JSC::Identifier::fromString(vm, "SSL_OP_COOKIE_EXCHANGE"_s),
      JSC::jsNumber(8192));
  put(JSC::Identifier::fromString(vm, "SSL_OP_CRYPTOPRO_TLSEXT_BUG"_s),
      JSC::jsNumber(2147483648));
  put(JSC::Identifier::fromString(vm, "SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS"_s),
      JSC::jsNumber(2048));
  put(JSC::Identifier::fromString(vm, "SSL_OP_LEGACY_SERVER_CONNECT"_s),
      JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_COMPRESSION"_s),
      JSC::jsNumber(131072));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_ENCRYPT_THEN_MAC"_s),
      JSC::jsNumber(524288));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_QUERY_MTU"_s),
      JSC::jsNumber(4096));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_RENEGOTIATION"_s),
      JSC::jsNumber(1073741824));
  put(JSC::Identifier::fromString(
          vm, "SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION"_s),
      JSC::jsNumber(65536));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_SSLv2"_s), JSC::jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_SSLv3"_s),
      JSC::jsNumber(33554432));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TICKET"_s),
      JSC::jsNumber(16384));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1"_s),
      JSC::jsNumber(67108864));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1_1"_s),
      JSC::jsNumber(268435456));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1_2"_s),
      JSC::jsNumber(134217728));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1_3"_s),
      JSC::jsNumber(536870912));
  put(JSC::Identifier::fromString(vm, "SSL_OP_PRIORITIZE_CHACHA"_s),
      JSC::jsNumber(2097152));
  put(JSC::Identifier::fromString(vm, "SSL_OP_TLS_ROLLBACK_BUG"_s),
      JSC::jsNumber(8388608));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_RSA"_s), JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_DSA"_s), JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_DH"_s), JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_RAND"_s),
      JSC::jsNumber(8));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_EC"_s),
      JSC::jsNumber(2048));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_CIPHERS"_s),
      JSC::jsNumber(64));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_DIGESTS"_s),
      JSC::jsNumber(128));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_PKEY_METHS"_s),
      JSC::jsNumber(512));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_PKEY_ASN1_METHS"_s),
      JSC::jsNumber(1024));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_ALL"_s),
      JSC::jsNumber(65535));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_NONE"_s),
      JSC::jsNumber(0));
  put(JSC::Identifier::fromString(vm, "DH_CHECK_P_NOT_SAFE_PRIME"_s),
      JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "DH_CHECK_P_NOT_PRIME"_s),
      JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "DH_UNABLE_TO_CHECK_GENERATOR"_s),
      JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "DH_NOT_SUITABLE_GENERATOR"_s),
      JSC::jsNumber(8));
  put(JSC::Identifier::fromString(vm, "RSA_PKCS1_PADDING"_s), JSC::jsNumber(1));
  put(JSC::Identifier::fromString(vm, "RSA_NO_PADDING"_s), JSC::jsNumber(3));
  put(JSC::Identifier::fromString(vm, "RSA_PKCS1_OAEP_PADDING"_s),
      JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "RSA_X931_PADDING"_s), JSC::jsNumber(5));
  put(JSC::Identifier::fromString(vm, "RSA_PKCS1_PSS_PADDING"_s),
      JSC::jsNumber(6));
  put(JSC::Identifier::fromString(vm, "RSA_PSS_SALTLEN_DIGEST"_s),
      JSC::jsNumber(-1));
  put(JSC::Identifier::fromString(vm, "RSA_PSS_SALTLEN_MAX_SIGN"_s),
      JSC::jsNumber(-2));
  put(JSC::Identifier::fromString(vm, "RSA_PSS_SALTLEN_AUTO"_s),
      JSC::jsNumber(-2));
  put(JSC::Identifier::fromString(vm, "defaultCoreCipherList"_s),
      JSC::jsString(
          vm, WTF::String::fromUTF8(
                  "DHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-"
                  "RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256")));
  put(JSC::Identifier::fromString(vm, "TLS1_VERSION"_s), JSC::jsNumber(769));
  put(JSC::Identifier::fromString(vm, "TLS1_1_VERSION"_s), JSC::jsNumber(770));
  put(JSC::Identifier::fromString(vm, "TLS1_2_VERSION"_s), JSC::jsNumber(771));
  put(JSC::Identifier::fromString(vm, "TLS1_3_VERSION"_s), JSC::jsNumber(772));
  put(JSC::Identifier::fromString(vm, "POINT_CONVERSION_COMPRESSED"_s),
      JSC::jsNumber(2));
  put(JSC::Identifier::fromString(vm, "POINT_CONVERSION_UNCOMPRESSED"_s),
      JSC::jsNumber(4));
  put(JSC::Identifier::fromString(vm, "POINT_CONVERSION_HYBRID"_s),
      JSC::jsNumber(6));
#elif _WIN32
  `put(JSC::Identifier::fromString(vm, "E2BIG"_s), jsNumber(7));
  put(JSC::Identifier::fromString(vm, "EACCES"_s), jsNumber(13));
  put(JSC::Identifier::fromString(vm, "EADDRINUSE"_s), jsNumber(100));
  put(JSC::Identifier::fromString(vm, "EADDRNOTAVAIL"_s), jsNumber(101));
  put(JSC::Identifier::fromString(vm, "EAFNOSUPPORT"_s), jsNumber(102));
  put(JSC::Identifier::fromString(vm, "EAGAIN"_s), jsNumber(11));
  put(JSC::Identifier::fromString(vm, "EALREADY"_s), jsNumber(103));
  put(JSC::Identifier::fromString(vm, "EBADF"_s), jsNumber(9));
  put(JSC::Identifier::fromString(vm, "EBADMSG"_s), jsNumber(104));
  put(JSC::Identifier::fromString(vm, "EBUSY"_s), jsNumber(16));
  put(JSC::Identifier::fromString(vm, "ECANCELED"_s), jsNumber(105));
  put(JSC::Identifier::fromString(vm, "ECHILD"_s), jsNumber(10));
  put(JSC::Identifier::fromString(vm, "ECONNABORTED"_s), jsNumber(106));
  put(JSC::Identifier::fromString(vm, "ECONNREFUSED"_s), jsNumber(107));
  put(JSC::Identifier::fromString(vm, "ECONNRESET"_s), jsNumber(108));
  put(JSC::Identifier::fromString(vm, "EDEADLK"_s), jsNumber(36));
  put(JSC::Identifier::fromString(vm, "EDESTADDRREQ"_s), jsNumber(109));
  put(JSC::Identifier::fromString(vm, "EDOM"_s), jsNumber(33));
  put(JSC::Identifier::fromString(vm, "EEXIST"_s), jsNumber(17));
  put(JSC::Identifier::fromString(vm, "EFAULT"_s), jsNumber(14));
  put(JSC::Identifier::fromString(vm, "EFBIG"_s), jsNumber(27));
  put(JSC::Identifier::fromString(vm, "EHOSTUNREACH"_s), jsNumber(110));
  put(JSC::Identifier::fromString(vm, "EIDRM"_s), jsNumber(111));
  put(JSC::Identifier::fromString(vm, "EILSEQ"_s), jsNumber(42));
  put(JSC::Identifier::fromString(vm, "EINPROGRESS"_s), jsNumber(112));
  put(JSC::Identifier::fromString(vm, "EINTR"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "EINVAL"_s), jsNumber(22));
  put(JSC::Identifier::fromString(vm, "EIO"_s), jsNumber(5));
  put(JSC::Identifier::fromString(vm, "EISCONN"_s), jsNumber(113));
  put(JSC::Identifier::fromString(vm, "EISDIR"_s), jsNumber(21));
  put(JSC::Identifier::fromString(vm, "ELOOP"_s), jsNumber(114));
  put(JSC::Identifier::fromString(vm, "EMFILE"_s), jsNumber(24));
  put(JSC::Identifier::fromString(vm, "EMLINK"_s), jsNumber(31));
  put(JSC::Identifier::fromString(vm, "EMSGSIZE"_s), jsNumber(115));
  put(JSC::Identifier::fromString(vm, "ENAMETOOLONG"_s), jsNumber(38));
  put(JSC::Identifier::fromString(vm, "ENETDOWN"_s), jsNumber(116));
  put(JSC::Identifier::fromString(vm, "ENETRESET"_s), jsNumber(117));
  put(JSC::Identifier::fromString(vm, "ENETUNREACH"_s), jsNumber(118));
  put(JSC::Identifier::fromString(vm, "ENFILE"_s), jsNumber(23));
  put(JSC::Identifier::fromString(vm, "ENOBUFS"_s), jsNumber(119));
  put(JSC::Identifier::fromString(vm, "ENODATA"_s), jsNumber(120));
  put(JSC::Identifier::fromString(vm, "ENODEV"_s), jsNumber(19));
  put(JSC::Identifier::fromString(vm, "ENOENT"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "ENOEXEC"_s), jsNumber(8));
  put(JSC::Identifier::fromString(vm, "ENOLCK"_s), jsNumber(39));
  put(JSC::Identifier::fromString(vm, "ENOLINK"_s), jsNumber(121));
  put(JSC::Identifier::fromString(vm, "ENOMEM"_s), jsNumber(12));
  put(JSC::Identifier::fromString(vm, "ENOMSG"_s), jsNumber(122));
  put(JSC::Identifier::fromString(vm, "ENOPROTOOPT"_s), jsNumber(123));
  put(JSC::Identifier::fromString(vm, "ENOSPC"_s), jsNumber(28));
  put(JSC::Identifier::fromString(vm, "ENOSR"_s), jsNumber(124));
  put(JSC::Identifier::fromString(vm, "ENOSTR"_s), jsNumber(125));
  put(JSC::Identifier::fromString(vm, "ENOSYS"_s), jsNumber(40));
  put(JSC::Identifier::fromString(vm, "ENOTCONN"_s), jsNumber(126));
  put(JSC::Identifier::fromString(vm, "ENOTDIR"_s), jsNumber(20));
  put(JSC::Identifier::fromString(vm, "ENOTEMPTY"_s), jsNumber(41));
  put(JSC::Identifier::fromString(vm, "ENOTSOCK"_s), jsNumber(128));
  put(JSC::Identifier::fromString(vm, "ENOTSUP"_s), jsNumber(129));
  put(JSC::Identifier::fromString(vm, "ENOTTY"_s), jsNumber(25));
  put(JSC::Identifier::fromString(vm, "ENXIO"_s), jsNumber(6));
  put(JSC::Identifier::fromString(vm, "EOPNOTSUPP"_s), jsNumber(130));
  put(JSC::Identifier::fromString(vm, "EOVERFLOW"_s), jsNumber(132));
  put(JSC::Identifier::fromString(vm, "EPERM"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "EPIPE"_s), jsNumber(32));
  put(JSC::Identifier::fromString(vm, "EPROTO"_s), jsNumber(134));
  put(JSC::Identifier::fromString(vm, "EPROTONOSUPPORT"_s), jsNumber(135));
  put(JSC::Identifier::fromString(vm, "EPROTOTYPE"_s), jsNumber(136));
  put(JSC::Identifier::fromString(vm, "ERANGE"_s), jsNumber(34));
  put(JSC::Identifier::fromString(vm, "EROFS"_s), jsNumber(30));
  put(JSC::Identifier::fromString(vm, "ESPIPE"_s), jsNumber(29));
  put(JSC::Identifier::fromString(vm, "ESRCH"_s), jsNumber(3));
  put(JSC::Identifier::fromString(vm, "ETIME"_s), jsNumber(137));
  put(JSC::Identifier::fromString(vm, "ETIMEDOUT"_s), jsNumber(138));
  put(JSC::Identifier::fromString(vm, "ETXTBSY"_s), jsNumber(139));
  put(JSC::Identifier::fromString(vm, "EWOULDBLOCK"_s), jsNumber(140));
  put(JSC::Identifier::fromString(vm, "EXDEV"_s), jsNumber(18));
  put(JSC::Identifier::fromString(vm, "WSAEINTR"_s), jsNumber(10004));
  put(JSC::Identifier::fromString(vm, "WSAEBADF"_s), jsNumber(10009));
  put(JSC::Identifier::fromString(vm, "WSAEACCES"_s), jsNumber(10013));
  put(JSC::Identifier::fromString(vm, "WSAEFAULT"_s), jsNumber(10014));
  put(JSC::Identifier::fromString(vm, "WSAEINVAL"_s), jsNumber(10022));
  put(JSC::Identifier::fromString(vm, "WSAEMFILE"_s), jsNumber(10024));
  put(JSC::Identifier::fromString(vm, "WSAEWOULDBLOCK"_s), jsNumber(10035));
  put(JSC::Identifier::fromString(vm, "WSAEINPROGRESS"_s), jsNumber(10036));
  put(JSC::Identifier::fromString(vm, "WSAEALREADY"_s), jsNumber(10037));
  put(JSC::Identifier::fromString(vm, "WSAENOTSOCK"_s), jsNumber(10038));
  put(JSC::Identifier::fromString(vm, "WSAEDESTADDRREQ"_s), jsNumber(10039));
  put(JSC::Identifier::fromString(vm, "WSAEMSGSIZE"_s), jsNumber(10040));
  put(JSC::Identifier::fromString(vm, "WSAEPROTOTYPE"_s), jsNumber(10041));
  put(JSC::Identifier::fromString(vm, "WSAENOPROTOOPT"_s), jsNumber(10042));
  put(JSC::Identifier::fromString(vm, "WSAEPROTONOSUPPORT"_s), jsNumber(10043));
  put(JSC::Identifier::fromString(vm, "WSAESOCKTNOSUPPORT"_s), jsNumber(10044));
  put(JSC::Identifier::fromString(vm, "WSAEOPNOTSUPP"_s), jsNumber(10045));
  put(JSC::Identifier::fromString(vm, "WSAEPFNOSUPPORT"_s), jsNumber(10046));
  put(JSC::Identifier::fromString(vm, "WSAEAFNOSUPPORT"_s), jsNumber(10047));
  put(JSC::Identifier::fromString(vm, "WSAEADDRINUSE"_s), jsNumber(10048));
  put(JSC::Identifier::fromString(vm, "WSAEADDRNOTAVAIL"_s), jsNumber(10049));
  put(JSC::Identifier::fromString(vm, "WSAENETDOWN"_s), jsNumber(10050));
  put(JSC::Identifier::fromString(vm, "WSAENETUNREACH"_s), jsNumber(10051));
  put(JSC::Identifier::fromString(vm, "WSAENETRESET"_s), jsNumber(10052));
  put(JSC::Identifier::fromString(vm, "WSAECONNABORTED"_s), jsNumber(10053));
  put(JSC::Identifier::fromString(vm, "WSAECONNRESET"_s), jsNumber(10054));
  put(JSC::Identifier::fromString(vm, "WSAENOBUFS"_s), jsNumber(10055));
  put(JSC::Identifier::fromString(vm, "WSAEISCONN"_s), jsNumber(10056));
  put(JSC::Identifier::fromString(vm, "WSAENOTCONN"_s), jsNumber(10057));
  put(JSC::Identifier::fromString(vm, "WSAESHUTDOWN"_s), jsNumber(10058));
  put(JSC::Identifier::fromString(vm, "WSAETOOMANYREFS"_s), jsNumber(10059));
  put(JSC::Identifier::fromString(vm, "WSAETIMEDOUT"_s), jsNumber(10060));
  put(JSC::Identifier::fromString(vm, "WSAECONNREFUSED"_s), jsNumber(10061));
  put(JSC::Identifier::fromString(vm, "WSAELOOP"_s), jsNumber(10062));
  put(JSC::Identifier::fromString(vm, "WSAENAMETOOLONG"_s), jsNumber(10063));
  put(JSC::Identifier::fromString(vm, "WSAEHOSTDOWN"_s), jsNumber(10064));
  put(JSC::Identifier::fromString(vm, "WSAEHOSTUNREACH"_s), jsNumber(10065));
  put(JSC::Identifier::fromString(vm, "WSAENOTEMPTY"_s), jsNumber(10066));
  put(JSC::Identifier::fromString(vm, "WSAEPROCLIM"_s), jsNumber(10067));
  put(JSC::Identifier::fromString(vm, "WSAEUSERS"_s), jsNumber(10068));
  put(JSC::Identifier::fromString(vm, "WSAEDQUOT"_s), jsNumber(10069));
  put(JSC::Identifier::fromString(vm, "WSAESTALE"_s), jsNumber(10070));
  put(JSC::Identifier::fromString(vm, "WSAEREMOTE"_s), jsNumber(10071));
  put(JSC::Identifier::fromString(vm, "WSASYSNOTREADY"_s), jsNumber(10091));
  put(JSC::Identifier::fromString(vm, "WSAVERNOTSUPPORTED"_s), jsNumber(10092));
  put(JSC::Identifier::fromString(vm, "WSANOTINITIALISED"_s), jsNumber(10093));
  put(JSC::Identifier::fromString(vm, "WSAEDISCON"_s), jsNumber(10101));
  put(JSC::Identifier::fromString(vm, "WSAENOMORE"_s), jsNumber(10102));
  put(JSC::Identifier::fromString(vm, "WSAECANCELLED"_s), jsNumber(10103));
  put(JSC::Identifier::fromString(vm, "WSAEINVALIDPROCTABLE"_s),
      jsNumber(10104));
  put(JSC::Identifier::fromString(vm, "WSAEINVALIDPROVIDER"_s),
      jsNumber(10105));
  put(JSC::Identifier::fromString(vm, "WSAEPROVIDERFAILEDINIT"_s),
      jsNumber(10106));
  put(JSC::Identifier::fromString(vm, "WSASYSCALLFAILURE"_s), jsNumber(10107));
  put(JSC::Identifier::fromString(vm, "WSASERVICE_NOT_FOUND"_s),
      jsNumber(10108));
  put(JSC::Identifier::fromString(vm, "WSATYPE_NOT_FOUND"_s), jsNumber(10109));
  put(JSC::Identifier::fromString(vm, "WSA_E_NO_MORE"_s), jsNumber(10110));
  put(JSC::Identifier::fromString(vm, "WSA_E_CANCELLED"_s), jsNumber(10111));
  put(JSC::Identifier::fromString(vm, "WSAEREFUSED"_s), jsNumber(10112));
  put(JSC::Identifier::fromString(vm, "PRIORITY_LOW"_s), jsNumber(19));
  put(JSC::Identifier::fromString(vm, "PRIORITY_BELOW_NORMAL"_s), jsNumber(10));
  put(JSC::Identifier::fromString(vm, "PRIORITY_NORMAL"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "PRIORITY_ABOVE_NORMAL"_s), jsNumber(-7));
  put(JSC::Identifier::fromString(vm, "PRIORITY_HIGH"_s), jsNumber(-14));
  put(JSC::Identifier::fromString(vm, "PRIORITY_HIGHEST"_s), jsNumber(-20));
  put(JSC::Identifier::fromString(vm, "SIGHUP"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "SIGINT"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "SIGILL"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "SIGABRT"_s), jsNumber(22));
  put(JSC::Identifier::fromString(vm, "SIGFPE"_s), jsNumber(8));
  put(JSC::Identifier::fromString(vm, "SIGKILL"_s), jsNumber(9));
  put(JSC::Identifier::fromString(vm, "SIGSEGV"_s), jsNumber(11));
  put(JSC::Identifier::fromString(vm, "SIGTERM"_s), jsNumber(15));
  put(JSC::Identifier::fromString(vm, "SIGBREAK"_s), jsNumber(21));
  put(JSC::Identifier::fromString(vm, "SIGWINCH"_s), jsNumber(28));
  put(JSC::Identifier::fromString(vm, "UV_FS_SYMLINK_DIR"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_FS_SYMLINK_JUNCTION"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "O_RDONLY"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "O_WRONLY"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "O_RDWR"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_UNKNOWN"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_FILE"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_DIR"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_LINK"_s), jsNumber(3));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_FIFO"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_SOCKET"_s), jsNumber(5));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_CHAR"_s), jsNumber(6));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_BLOCK"_s), jsNumber(7));
  put(JSC::Identifier::fromString(vm, "S_IFMT"_s), jsNumber(61440));
  put(JSC::Identifier::fromString(vm, "S_IFREG"_s), jsNumber(32768));
  put(JSC::Identifier::fromString(vm, "S_IFDIR"_s), jsNumber(16384));
  put(JSC::Identifier::fromString(vm, "S_IFCHR"_s), jsNumber(8192));
  put(JSC::Identifier::fromString(vm, "S_IFLNK"_s), jsNumber(40960));
  put(JSC::Identifier::fromString(vm, "O_CREAT"_s), jsNumber(256));
  put(JSC::Identifier::fromString(vm, "O_EXCL"_s), jsNumber(1024));
  put(JSC::Identifier::fromString(vm, "UV_FS_O_FILEMAP"_s),
      jsNumber(536870912));
  put(JSC::Identifier::fromString(vm, "O_TRUNC"_s), jsNumber(512));
  put(JSC::Identifier::fromString(vm, "O_APPEND"_s), jsNumber(8));
  put(JSC::Identifier::fromString(vm, "S_IRUSR"_s), jsNumber(256));
  put(JSC::Identifier::fromString(vm, "S_IWUSR"_s), jsNumber(128));
  put(JSC::Identifier::fromString(vm, "F_OK"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "R_OK"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "W_OK"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "X_OK"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_FS_COPYFILE_EXCL"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "COPYFILE_EXCL"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_FS_COPYFILE_FICLONE"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "COPYFILE_FICLONE"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "UV_FS_COPYFILE_FICLONE_FORCE"_s),
      jsNumber(4));
  put(JSC::Identifier::fromString(vm, "COPYFILE_FICLONE_FORCE"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "OPENSSL_VERSION_NUMBER"_s),
      jsNumber(805306496));
  put(JSC::Identifier::fromString(vm, "SSL_OP_ALL"_s), jsNumber(2147485776));
  put(JSC::Identifier::fromString(vm, "SSL_OP_ALLOW_NO_DHE_KEX"_s),
      jsNumber(1024));
  put(JSC::Identifier::fromString(vm,
                                  "SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION"_s),
      jsNumber(262144));
  put(JSC::Identifier::fromString(vm, "SSL_OP_CIPHER_SERVER_PREFERENCE"_s),
      jsNumber(4194304));
  put(JSC::Identifier::fromString(vm, "SSL_OP_CISCO_ANYCONNECT"_s),
      jsNumber(32768));
  put(JSC::Identifier::fromString(vm, "SSL_OP_COOKIE_EXCHANGE"_s),
      jsNumber(8192));
  put(JSC::Identifier::fromString(vm, "SSL_OP_CRYPTOPRO_TLSEXT_BUG"_s),
      jsNumber(2147483648));
  put(JSC::Identifier::fromString(vm, "SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS"_s),
      jsNumber(2048));
  put(JSC::Identifier::fromString(vm, "SSL_OP_EPHEMERAL_RSA"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_LEGACY_SERVER_CONNECT"_s),
      jsNumber(4));
  put(JSC::Identifier::fromString(vm, "SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_MICROSOFT_SESS_ID_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_MSIE_SSLV2_RSA_PADDING"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NETSCAPE_CA_DN_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NETSCAPE_CHALLENGE_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm,
                                  "SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm,
                                  "SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_COMPRESSION"_s),
      jsNumber(131072));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_ENCRYPT_THEN_MAC"_s),
      jsNumber(524288));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_QUERY_MTU"_s), jsNumber(4096));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_RENEGOTIATION"_s),
      jsNumber(1073741824));
  put(JSC::Identifier::fromString(
          vm, "SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION"_s),
      jsNumber(65536));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_SSLv2"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_SSLv3"_s), jsNumber(33554432));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TICKET"_s), jsNumber(16384));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1"_s), jsNumber(67108864));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1_1"_s),
      jsNumber(268435456));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1_2"_s),
      jsNumber(134217728));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1_3"_s),
      jsNumber(536870912));
  put(JSC::Identifier::fromString(vm, "SSL_OP_PKCS1_CHECK_1"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_PKCS1_CHECK_2"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_PRIORITIZE_CHACHA"_s),
      jsNumber(2097152));
  put(JSC::Identifier::fromString(vm, "SSL_OP_SINGLE_DH_USE"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_SINGLE_ECDH_USE"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_SSLEAY_080_CLIENT_DH_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_TLS_BLOCK_PADDING_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_TLS_D5_BUG"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_TLS_ROLLBACK_BUG"_s),
      jsNumber(8388608));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_RSA"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_DSA"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_DH"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_RAND"_s), jsNumber(8));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_EC"_s), jsNumber(2048));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_CIPHERS"_s), jsNumber(64));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_DIGESTS"_s),
      jsNumber(128));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_PKEY_METHS"_s),
      jsNumber(512));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_PKEY_ASN1_METHS"_s),
      jsNumber(1024));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_ALL"_s), jsNumber(65535));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_NONE"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "DH_CHECK_P_NOT_SAFE_PRIME"_s),
      jsNumber(2));
  put(JSC::Identifier::fromString(vm, "DH_CHECK_P_NOT_PRIME"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "DH_UNABLE_TO_CHECK_GENERATOR"_s),
      jsNumber(4));
  put(JSC::Identifier::fromString(vm, "DH_NOT_SUITABLE_GENERATOR"_s),
      jsNumber(8));
  put(JSC::Identifier::fromString(vm, "ALPN_ENABLED"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "RSA_PKCS1_PADDING"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "RSA_NO_PADDING"_s), jsNumber(3));
  put(JSC::Identifier::fromString(vm, "RSA_PKCS1_OAEP_PADDING"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "RSA_X931_PADDING"_s), jsNumber(5));
  put(JSC::Identifier::fromString(vm, "RSA_PKCS1_PSS_PADDING"_s), jsNumber(6));
  put(JSC::Identifier::fromString(vm, "RSA_PSS_SALTLEN_DIGEST"_s),
      jsNumber(-1));
  put(JSC::Identifier::fromString(vm, "RSA_PSS_SALTLEN_MAX_SIGN"_s),
      jsNumber(-2));
  put(JSC::Identifier::fromString(vm, "RSA_PSS_SALTLEN_AUTO"_s), jsNumber(-2));
  put(JSC::Identifier::fromString(vm, "defaultCoreCipherList"_s),
      jsString(
          vm,
          WTF::String::fromUTF8(
              "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_"
              "GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-"
              "SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-"
              "SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-"
              "RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:"
              "ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!"
              "eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA")));
  put(JSC::Identifier::fromString(vm, "TLS1_VERSION"_s), jsNumber(769));
  put(JSC::Identifier::fromString(vm, "TLS1_1_VERSION"_s), jsNumber(770));
  put(JSC::Identifier::fromString(vm, "TLS1_2_VERSION"_s), jsNumber(771));
  put(JSC::Identifier::fromString(vm, "TLS1_3_VERSION"_s), jsNumber(772));
  put(JSC::Identifier::fromString(vm, "POINT_CONVERSION_COMPRESSED"_s),
      jsNumber(2));
  put(JSC::Identifier::fromString(vm, "POINT_CONVERSION_UNCOMPRESSED"_s),
      jsNumber(4));
  put(JSC::Identifier::fromString(vm, "POINT_CONVERSION_HYBRID"_s),
      jsNumber(6));
  put(JSC::Identifier::fromString(vm, "defaultCipherList"_s),
      jsString(
          vm,
          WTF::String::fromUTF8(
              "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_"
              "GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-"
              "SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-"
              "SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-"
              "RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:"
              "ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!"
              "eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA")));
#else
  put(JSC::Identifier::fromString(vm, "RTLD_LAZY"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "RTLD_NOW"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "RTLD_GLOBAL"_s), jsNumber(256));
  put(JSC::Identifier::fromString(vm, "RTLD_LOCAL"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "RTLD_DEEPBIND"_s), jsNumber(8));
  put(JSC::Identifier::fromString(vm, "E2BIG"_s), jsNumber(7));
  put(JSC::Identifier::fromString(vm, "EACCES"_s), jsNumber(13));
  put(JSC::Identifier::fromString(vm, "EADDRINUSE"_s), jsNumber(98));
  put(JSC::Identifier::fromString(vm, "EADDRNOTAVAIL"_s), jsNumber(99));
  put(JSC::Identifier::fromString(vm, "EAFNOSUPPORT"_s), jsNumber(97));
  put(JSC::Identifier::fromString(vm, "EAGAIN"_s), jsNumber(11));
  put(JSC::Identifier::fromString(vm, "EALREADY"_s), jsNumber(114));
  put(JSC::Identifier::fromString(vm, "EBADF"_s), jsNumber(9));
  put(JSC::Identifier::fromString(vm, "EBADMSG"_s), jsNumber(74));
  put(JSC::Identifier::fromString(vm, "EBUSY"_s), jsNumber(16));
  put(JSC::Identifier::fromString(vm, "ECANCELED"_s), jsNumber(125));
  put(JSC::Identifier::fromString(vm, "ECHILD"_s), jsNumber(10));
  put(JSC::Identifier::fromString(vm, "ECONNABORTED"_s), jsNumber(103));
  put(JSC::Identifier::fromString(vm, "ECONNREFUSED"_s), jsNumber(111));
  put(JSC::Identifier::fromString(vm, "ECONNRESET"_s), jsNumber(104));
  put(JSC::Identifier::fromString(vm, "EDEADLK"_s), jsNumber(35));
  put(JSC::Identifier::fromString(vm, "EDESTADDRREQ"_s), jsNumber(89));
  put(JSC::Identifier::fromString(vm, "EDOM"_s), jsNumber(33));
  put(JSC::Identifier::fromString(vm, "EDQUOT"_s), jsNumber(122));
  put(JSC::Identifier::fromString(vm, "EEXIST"_s), jsNumber(17));
  put(JSC::Identifier::fromString(vm, "EFAULT"_s), jsNumber(14));
  put(JSC::Identifier::fromString(vm, "EFBIG"_s), jsNumber(27));
  put(JSC::Identifier::fromString(vm, "EHOSTUNREACH"_s), jsNumber(113));
  put(JSC::Identifier::fromString(vm, "EIDRM"_s), jsNumber(43));
  put(JSC::Identifier::fromString(vm, "EILSEQ"_s), jsNumber(84));
  put(JSC::Identifier::fromString(vm, "EINPROGRESS"_s), jsNumber(115));
  put(JSC::Identifier::fromString(vm, "EINTR"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "EINVAL"_s), jsNumber(22));
  put(JSC::Identifier::fromString(vm, "EIO"_s), jsNumber(5));
  put(JSC::Identifier::fromString(vm, "EISCONN"_s), jsNumber(106));
  put(JSC::Identifier::fromString(vm, "EISDIR"_s), jsNumber(21));
  put(JSC::Identifier::fromString(vm, "ELOOP"_s), jsNumber(40));
  put(JSC::Identifier::fromString(vm, "EMFILE"_s), jsNumber(24));
  put(JSC::Identifier::fromString(vm, "EMLINK"_s), jsNumber(31));
  put(JSC::Identifier::fromString(vm, "EMSGSIZE"_s), jsNumber(90));
  put(JSC::Identifier::fromString(vm, "EMULTIHOP"_s), jsNumber(72));
  put(JSC::Identifier::fromString(vm, "ENAMETOOLONG"_s), jsNumber(36));
  put(JSC::Identifier::fromString(vm, "ENETDOWN"_s), jsNumber(100));
  put(JSC::Identifier::fromString(vm, "ENETRESET"_s), jsNumber(102));
  put(JSC::Identifier::fromString(vm, "ENETUNREACH"_s), jsNumber(101));
  put(JSC::Identifier::fromString(vm, "ENFILE"_s), jsNumber(23));
  put(JSC::Identifier::fromString(vm, "ENOBUFS"_s), jsNumber(105));
  put(JSC::Identifier::fromString(vm, "ENODATA"_s), jsNumber(61));
  put(JSC::Identifier::fromString(vm, "ENODEV"_s), jsNumber(19));
  put(JSC::Identifier::fromString(vm, "ENOENT"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "ENOEXEC"_s), jsNumber(8));
  put(JSC::Identifier::fromString(vm, "ENOLCK"_s), jsNumber(37));
  put(JSC::Identifier::fromString(vm, "ENOLINK"_s), jsNumber(67));
  put(JSC::Identifier::fromString(vm, "ENOMEM"_s), jsNumber(12));
  put(JSC::Identifier::fromString(vm, "ENOMSG"_s), jsNumber(42));
  put(JSC::Identifier::fromString(vm, "ENOPROTOOPT"_s), jsNumber(92));
  put(JSC::Identifier::fromString(vm, "ENOSPC"_s), jsNumber(28));
  put(JSC::Identifier::fromString(vm, "ENOSR"_s), jsNumber(63));
  put(JSC::Identifier::fromString(vm, "ENOSTR"_s), jsNumber(60));
  put(JSC::Identifier::fromString(vm, "ENOSYS"_s), jsNumber(38));
  put(JSC::Identifier::fromString(vm, "ENOTCONN"_s), jsNumber(107));
  put(JSC::Identifier::fromString(vm, "ENOTDIR"_s), jsNumber(20));
  put(JSC::Identifier::fromString(vm, "ENOTEMPTY"_s), jsNumber(39));
  put(JSC::Identifier::fromString(vm, "ENOTSOCK"_s), jsNumber(88));
  put(JSC::Identifier::fromString(vm, "ENOTSUP"_s), jsNumber(95));
  put(JSC::Identifier::fromString(vm, "ENOTTY"_s), jsNumber(25));
  put(JSC::Identifier::fromString(vm, "ENXIO"_s), jsNumber(6));
  put(JSC::Identifier::fromString(vm, "EOPNOTSUPP"_s), jsNumber(95));
  put(JSC::Identifier::fromString(vm, "EOVERFLOW"_s), jsNumber(75));
  put(JSC::Identifier::fromString(vm, "EPERM"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "EPIPE"_s), jsNumber(32));
  put(JSC::Identifier::fromString(vm, "EPROTO"_s), jsNumber(71));
  put(JSC::Identifier::fromString(vm, "EPROTONOSUPPORT"_s), jsNumber(93));
  put(JSC::Identifier::fromString(vm, "EPROTOTYPE"_s), jsNumber(91));
  put(JSC::Identifier::fromString(vm, "ERANGE"_s), jsNumber(34));
  put(JSC::Identifier::fromString(vm, "EROFS"_s), jsNumber(30));
  put(JSC::Identifier::fromString(vm, "ESPIPE"_s), jsNumber(29));
  put(JSC::Identifier::fromString(vm, "ESRCH"_s), jsNumber(3));
  put(JSC::Identifier::fromString(vm, "ESTALE"_s), jsNumber(116));
  put(JSC::Identifier::fromString(vm, "ETIME"_s), jsNumber(62));
  put(JSC::Identifier::fromString(vm, "ETIMEDOUT"_s), jsNumber(110));
  put(JSC::Identifier::fromString(vm, "ETXTBSY"_s), jsNumber(26));
  put(JSC::Identifier::fromString(vm, "EWOULDBLOCK"_s), jsNumber(11));
  put(JSC::Identifier::fromString(vm, "EXDEV"_s), jsNumber(18));
  put(JSC::Identifier::fromString(vm, "PRIORITY_LOW"_s), jsNumber(19));
  put(JSC::Identifier::fromString(vm, "PRIORITY_BELOW_NORMAL"_s), jsNumber(10));
  put(JSC::Identifier::fromString(vm, "PRIORITY_NORMAL"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "PRIORITY_ABOVE_NORMAL"_s), jsNumber(-7));
  put(JSC::Identifier::fromString(vm, "PRIORITY_HIGH"_s), jsNumber(-14));
  put(JSC::Identifier::fromString(vm, "PRIORITY_HIGHEST"_s), jsNumber(-20));
  put(JSC::Identifier::fromString(vm, "SIGHUP"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "SIGINT"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "SIGQUIT"_s), jsNumber(3));
  put(JSC::Identifier::fromString(vm, "SIGILL"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "SIGTRAP"_s), jsNumber(5));
  put(JSC::Identifier::fromString(vm, "SIGABRT"_s), jsNumber(6));
  put(JSC::Identifier::fromString(vm, "SIGIOT"_s), jsNumber(6));
  put(JSC::Identifier::fromString(vm, "SIGBUS"_s), jsNumber(7));
  put(JSC::Identifier::fromString(vm, "SIGFPE"_s), jsNumber(8));
  put(JSC::Identifier::fromString(vm, "SIGKILL"_s), jsNumber(9));
  put(JSC::Identifier::fromString(vm, "SIGUSR1"_s), jsNumber(10));
  put(JSC::Identifier::fromString(vm, "SIGSEGV"_s), jsNumber(11));
  put(JSC::Identifier::fromString(vm, "SIGUSR2"_s), jsNumber(12));
  put(JSC::Identifier::fromString(vm, "SIGPIPE"_s), jsNumber(13));
  put(JSC::Identifier::fromString(vm, "SIGALRM"_s), jsNumber(14));
  put(JSC::Identifier::fromString(vm, "SIGTERM"_s), jsNumber(15));
  put(JSC::Identifier::fromString(vm, "SIGCHLD"_s), jsNumber(17));
  put(JSC::Identifier::fromString(vm, "SIGSTKFLT"_s), jsNumber(16));
  put(JSC::Identifier::fromString(vm, "SIGCONT"_s), jsNumber(18));
  put(JSC::Identifier::fromString(vm, "SIGSTOP"_s), jsNumber(19));
  put(JSC::Identifier::fromString(vm, "SIGTSTP"_s), jsNumber(20));
  put(JSC::Identifier::fromString(vm, "SIGTTIN"_s), jsNumber(21));
  put(JSC::Identifier::fromString(vm, "SIGTTOU"_s), jsNumber(22));
  put(JSC::Identifier::fromString(vm, "SIGURG"_s), jsNumber(23));
  put(JSC::Identifier::fromString(vm, "SIGXCPU"_s), jsNumber(24));
  put(JSC::Identifier::fromString(vm, "SIGXFSZ"_s), jsNumber(25));
  put(JSC::Identifier::fromString(vm, "SIGVTALRM"_s), jsNumber(26));
  put(JSC::Identifier::fromString(vm, "SIGPROF"_s), jsNumber(27));
  put(JSC::Identifier::fromString(vm, "SIGWINCH"_s), jsNumber(28));
  put(JSC::Identifier::fromString(vm, "SIGIO"_s), jsNumber(29));
  put(JSC::Identifier::fromString(vm, "SIGPOLL"_s), jsNumber(29));
  put(JSC::Identifier::fromString(vm, "SIGPWR"_s), jsNumber(30));
  put(JSC::Identifier::fromString(vm, "SIGSYS"_s), jsNumber(31));
  put(JSC::Identifier::fromString(vm, "UV_FS_SYMLINK_DIR"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_FS_SYMLINK_JUNCTION"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "O_RDONLY"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "O_WRONLY"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "O_RDWR"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_UNKNOWN"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_FILE"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_DIR"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_LINK"_s), jsNumber(3));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_FIFO"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_SOCKET"_s), jsNumber(5));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_CHAR"_s), jsNumber(6));
  put(JSC::Identifier::fromString(vm, "UV_DIRENT_BLOCK"_s), jsNumber(7));
  put(JSC::Identifier::fromString(vm, "S_IFMT"_s), jsNumber(61440));
  put(JSC::Identifier::fromString(vm, "S_IFREG"_s), jsNumber(32768));
  put(JSC::Identifier::fromString(vm, "S_IFDIR"_s), jsNumber(16384));
  put(JSC::Identifier::fromString(vm, "S_IFCHR"_s), jsNumber(8192));
  put(JSC::Identifier::fromString(vm, "S_IFBLK"_s), jsNumber(24576));
  put(JSC::Identifier::fromString(vm, "S_IFIFO"_s), jsNumber(4096));
  put(JSC::Identifier::fromString(vm, "S_IFLNK"_s), jsNumber(40960));
  put(JSC::Identifier::fromString(vm, "S_IFSOCK"_s), jsNumber(49152));
  put(JSC::Identifier::fromString(vm, "O_CREAT"_s), jsNumber(64));
  put(JSC::Identifier::fromString(vm, "O_EXCL"_s), jsNumber(128));
  put(JSC::Identifier::fromString(vm, "UV_FS_O_FILEMAP"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "O_NOCTTY"_s), jsNumber(256));
  put(JSC::Identifier::fromString(vm, "O_TRUNC"_s), jsNumber(512));
  put(JSC::Identifier::fromString(vm, "O_APPEND"_s), jsNumber(1024));
  put(JSC::Identifier::fromString(vm, "O_DIRECTORY"_s), jsNumber(65536));
  put(JSC::Identifier::fromString(vm, "O_NOATIME"_s), jsNumber(262144));
  put(JSC::Identifier::fromString(vm, "O_NOFOLLOW"_s), jsNumber(131072));
  put(JSC::Identifier::fromString(vm, "O_SYNC"_s), jsNumber(1052672));
  put(JSC::Identifier::fromString(vm, "O_DSYNC"_s), jsNumber(4096));
  put(JSC::Identifier::fromString(vm, "O_DIRECT"_s), jsNumber(16384));
  put(JSC::Identifier::fromString(vm, "O_NONBLOCK"_s), jsNumber(2048));
  put(JSC::Identifier::fromString(vm, "S_IRWXU"_s), jsNumber(448));
  put(JSC::Identifier::fromString(vm, "S_IRUSR"_s), jsNumber(256));
  put(JSC::Identifier::fromString(vm, "S_IWUSR"_s), jsNumber(128));
  put(JSC::Identifier::fromString(vm, "S_IXUSR"_s), jsNumber(64));
  put(JSC::Identifier::fromString(vm, "S_IRWXG"_s), jsNumber(56));
  put(JSC::Identifier::fromString(vm, "S_IRGRP"_s), jsNumber(32));
  put(JSC::Identifier::fromString(vm, "S_IWGRP"_s), jsNumber(16));
  put(JSC::Identifier::fromString(vm, "S_IXGRP"_s), jsNumber(8));
  put(JSC::Identifier::fromString(vm, "S_IRWXO"_s), jsNumber(7));
  put(JSC::Identifier::fromString(vm, "S_IROTH"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "S_IWOTH"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "S_IXOTH"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "F_OK"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "R_OK"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "W_OK"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "X_OK"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_FS_COPYFILE_EXCL"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "COPYFILE_EXCL"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "UV_FS_COPYFILE_FICLONE"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "COPYFILE_FICLONE"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "UV_FS_COPYFILE_FICLONE_FORCE"_s),
      jsNumber(4));
  put(JSC::Identifier::fromString(vm, "COPYFILE_FICLONE_FORCE"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "OPENSSL_VERSION_NUMBER"_s),
      jsNumber(805306480));
  put(JSC::Identifier::fromString(vm, "SSL_OP_ALL"_s), jsNumber(2147485776));
  put(JSC::Identifier::fromString(vm, "SSL_OP_ALLOW_NO_DHE_KEX"_s),
      jsNumber(1024));
  put(JSC::Identifier::fromString(vm,
                                  "SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION"_s),
      jsNumber(262144));
  put(JSC::Identifier::fromString(vm, "SSL_OP_CIPHER_SERVER_PREFERENCE"_s),
      jsNumber(4194304));
  put(JSC::Identifier::fromString(vm, "SSL_OP_CISCO_ANYCONNECT"_s),
      jsNumber(32768));
  put(JSC::Identifier::fromString(vm, "SSL_OP_COOKIE_EXCHANGE"_s),
      jsNumber(8192));
  put(JSC::Identifier::fromString(vm, "SSL_OP_CRYPTOPRO_TLSEXT_BUG"_s),
      jsNumber(2147483648));
  put(JSC::Identifier::fromString(vm, "SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS"_s),
      jsNumber(2048));
  put(JSC::Identifier::fromString(vm, "SSL_OP_EPHEMERAL_RSA"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_LEGACY_SERVER_CONNECT"_s),
      jsNumber(4));
  put(JSC::Identifier::fromString(vm, "SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_MICROSOFT_SESS_ID_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_MSIE_SSLV2_RSA_PADDING"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NETSCAPE_CA_DN_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NETSCAPE_CHALLENGE_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm,
                                  "SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm,
                                  "SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_COMPRESSION"_s),
      jsNumber(131072));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_ENCRYPT_THEN_MAC"_s),
      jsNumber(524288));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_QUERY_MTU"_s), jsNumber(4096));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_RENEGOTIATION"_s),
      jsNumber(1073741824));
  put(JSC::Identifier::fromString(
          vm, "SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION"_s),
      jsNumber(65536));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_SSLv2"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_SSLv3"_s), jsNumber(33554432));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TICKET"_s), jsNumber(16384));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1"_s), jsNumber(67108864));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1_1"_s),
      jsNumber(268435456));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1_2"_s),
      jsNumber(134217728));
  put(JSC::Identifier::fromString(vm, "SSL_OP_NO_TLSv1_3"_s),
      jsNumber(536870912));
  put(JSC::Identifier::fromString(vm, "SSL_OP_PKCS1_CHECK_1"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_PKCS1_CHECK_2"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_PRIORITIZE_CHACHA"_s),
      jsNumber(2097152));
  put(JSC::Identifier::fromString(vm, "SSL_OP_SINGLE_DH_USE"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_SINGLE_ECDH_USE"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_SSLEAY_080_CLIENT_DH_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_TLS_BLOCK_PADDING_BUG"_s),
      jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_TLS_D5_BUG"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "SSL_OP_TLS_ROLLBACK_BUG"_s),
      jsNumber(8388608));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_RSA"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_DSA"_s), jsNumber(2));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_DH"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_RAND"_s), jsNumber(8));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_EC"_s), jsNumber(2048));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_CIPHERS"_s), jsNumber(64));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_DIGESTS"_s),
      jsNumber(128));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_PKEY_METHS"_s),
      jsNumber(512));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_PKEY_ASN1_METHS"_s),
      jsNumber(1024));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_ALL"_s), jsNumber(65535));
  put(JSC::Identifier::fromString(vm, "ENGINE_METHOD_NONE"_s), jsNumber(0));
  put(JSC::Identifier::fromString(vm, "DH_CHECK_P_NOT_SAFE_PRIME"_s),
      jsNumber(2));
  put(JSC::Identifier::fromString(vm, "DH_CHECK_P_NOT_PRIME"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "DH_UNABLE_TO_CHECK_GENERATOR"_s),
      jsNumber(4));
  put(JSC::Identifier::fromString(vm, "DH_NOT_SUITABLE_GENERATOR"_s),
      jsNumber(8));
  put(JSC::Identifier::fromString(vm, "ALPN_ENABLED"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "RSA_PKCS1_PADDING"_s), jsNumber(1));
  put(JSC::Identifier::fromString(vm, "RSA_NO_PADDING"_s), jsNumber(3));
  put(JSC::Identifier::fromString(vm, "RSA_PKCS1_OAEP_PADDING"_s), jsNumber(4));
  put(JSC::Identifier::fromString(vm, "RSA_X931_PADDING"_s), jsNumber(5));
  put(JSC::Identifier::fromString(vm, "RSA_PKCS1_PSS_PADDING"_s), jsNumber(6));
  put(JSC::Identifier::fromString(vm, "RSA_PSS_SALTLEN_DIGEST"_s),
      jsNumber(-1));
  put(JSC::Identifier::fromString(vm, "RSA_PSS_SALTLEN_MAX_SIGN"_s),
      jsNumber(-2));
  put(JSC::Identifier::fromString(vm, "RSA_PSS_SALTLEN_AUTO"_s), jsNumber(-2));
  put(JSC::Identifier::fromString(vm, "defaultCoreCipherList"_s),
      JSC::jsString(
          vm,
          WTF::String::fromUTF8(
              "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_"
              "GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-"
              "SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-"
              "SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-"
              "RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:"
              "ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!"
              "eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA")));
  put(JSC::Identifier::fromString(vm, "TLS1_VERSION"_s), jsNumber(769));
  put(JSC::Identifier::fromString(vm, "TLS1_1_VERSION"_s), jsNumber(770));
  put(JSC::Identifier::fromString(vm, "TLS1_2_VERSION"_s), jsNumber(771));
  put(JSC::Identifier::fromString(vm, "TLS1_3_VERSION"_s), jsNumber(772));
  put(JSC::Identifier::fromString(vm, "POINT_CONVERSION_COMPRESSED"_s),
      jsNumber(2));
  put(JSC::Identifier::fromString(vm, "POINT_CONVERSION_UNCOMPRESSED"_s),
      jsNumber(4));
  put(JSC::Identifier::fromString(vm, "POINT_CONVERSION_HYBRID"_s),
      jsNumber(6));
  put(JSC::Identifier::fromString(vm, "defaultCipherList"_s),
      JSC::jsString(
          vm,
          WTF::String::fromUTF8(
              "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_"
              "GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-"
              "SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-"
              "SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-"
              "RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:"
              "ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!"
              "eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA")));
#endif
  RETURN_NATIVE_MODULE();
}

} // namespace Zig
