#include "_NativeModule.h"

namespace Zig {
using namespace WebCore;

DEFINE_NATIVE_MODULE(NodeConstants) {
  INIT_NATIVE_MODULE(5);

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

  RETURN_NATIVE_MODULE();
}

} // namespace Zig
