var nodeFsConstants = constants, __getOwnPropNames = Object.getOwnPropertyNames, __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
}, require_types = __commonJS({
  "node_modules/wasi-js/dist/types.js"(exports) {
    Object.defineProperty(exports, "__esModule", { value: !0 }), exports.WASIKillError = exports.WASIExitError = exports.WASIError = void 0;
    var WASIError = class extends Error {
      constructor(errno) {
        super();
        this.errno = errno, Object.setPrototypeOf(this, WASIError.prototype);
      }
    };
    exports.WASIError = WASIError;
    var WASIExitError = class extends Error {
      constructor(code) {
        super(`WASI Exit error: ${code}`);
        this.code = code, Object.setPrototypeOf(this, WASIExitError.prototype);
      }
    };
    exports.WASIExitError = WASIExitError;
    var WASIKillError = class extends Error {
      constructor(signal) {
        super(`WASI Kill signal: ${signal}`);
        this.signal = signal, Object.setPrototypeOf(this, WASIKillError.prototype);
      }
    };
    exports.WASIKillError = WASIKillError;
  }
}), require_constants = __commonJS({
  "node_modules/wasi-js/dist/constants.js"(exports) {
    Object.defineProperty(exports, "__esModule", { value: !0 }), exports.WASI_ENOMSG = exports.WASI_ENOMEM = exports.WASI_ENOLINK = exports.WASI_ENOLCK = exports.WASI_ENOEXEC = exports.WASI_ENOENT = exports.WASI_ENODEV = exports.WASI_ENOBUFS = exports.WASI_ENFILE = exports.WASI_ENETUNREACH = exports.WASI_ENETRESET = exports.WASI_ENETDOWN = exports.WASI_ENAMETOOLONG = exports.WASI_EMULTIHOP = exports.WASI_EMSGSIZE = exports.WASI_EMLINK = exports.WASI_EMFILE = exports.WASI_ELOOP = exports.WASI_EISDIR = exports.WASI_EISCONN = exports.WASI_EIO = exports.WASI_EINVAL = exports.WASI_EINTR = exports.WASI_EINPROGRESS = exports.WASI_EILSEQ = exports.WASI_EIDRM = exports.WASI_EHOSTUNREACH = exports.WASI_EFBIG = exports.WASI_EFAULT = exports.WASI_EEXIST = exports.WASI_EDQUOT = exports.WASI_EDOM = exports.WASI_EDESTADDRREQ = exports.WASI_EDEADLK = exports.WASI_ECONNRESET = exports.WASI_ECONNREFUSED = exports.WASI_ECONNABORTED = exports.WASI_ECHILD = exports.WASI_ECANCELED = exports.WASI_EBUSY = exports.WASI_EBADMSG = exports.WASI_EBADF = exports.WASI_EALREADY = exports.WASI_EAGAIN = exports.WASI_EAFNOSUPPORT = exports.WASI_EADDRNOTAVAIL = exports.WASI_EADDRINUSE = exports.WASI_EACCES = exports.WASI_E2BIG = exports.WASI_ESUCCESS = void 0, exports.WASI_SIGVTALRM = exports.WASI_SIGUSR2 = exports.WASI_SIGUSR1 = exports.WASI_SIGURG = exports.WASI_SIGTTOU = exports.WASI_SIGTTIN = exports.WASI_SIGTSTP = exports.WASI_SIGTRAP = exports.WASI_SIGTERM = exports.WASI_SIGSTOP = exports.WASI_SIGSEGV = exports.WASI_SIGQUIT = exports.WASI_SIGPIPE = exports.WASI_SIGKILL = exports.WASI_SIGINT = exports.WASI_SIGILL = exports.WASI_SIGHUP = exports.WASI_SIGFPE = exports.WASI_SIGCONT = exports.WASI_SIGCHLD = exports.WASI_SIGBUS = exports.WASI_SIGALRM = exports.WASI_SIGABRT = exports.WASI_ENOTCAPABLE = exports.WASI_EXDEV = exports.WASI_ETXTBSY = exports.WASI_ETIMEDOUT = exports.WASI_ESTALE = exports.WASI_ESRCH = exports.WASI_ESPIPE = exports.WASI_EROFS = exports.WASI_ERANGE = exports.WASI_EPROTOTYPE = exports.WASI_EPROTONOSUPPORT = exports.WASI_EPROTO = exports.WASI_EPIPE = exports.WASI_EPERM = exports.WASI_EOWNERDEAD = exports.WASI_EOVERFLOW = exports.WASI_ENXIO = exports.WASI_ENOTTY = exports.WASI_ENOTSUP = exports.WASI_ENOTSOCK = exports.WASI_ENOTRECOVERABLE = exports.WASI_ENOTEMPTY = exports.WASI_ENOTDIR = exports.WASI_ENOTCONN = exports.WASI_ENOSYS = exports.WASI_ENOSPC = exports.WASI_ENOPROTOOPT = void 0, exports.RIGHTS_REGULAR_FILE_BASE = exports.RIGHTS_CHARACTER_DEVICE_INHERITING = exports.RIGHTS_CHARACTER_DEVICE_BASE = exports.RIGHTS_BLOCK_DEVICE_INHERITING = exports.RIGHTS_BLOCK_DEVICE_BASE = exports.RIGHTS_ALL = exports.WASI_RIGHT_SOCK_SHUTDOWN = exports.WASI_RIGHT_POLL_FD_READWRITE = exports.WASI_RIGHT_PATH_UNLINK_FILE = exports.WASI_RIGHT_PATH_REMOVE_DIRECTORY = exports.WASI_RIGHT_PATH_SYMLINK = exports.WASI_RIGHT_FD_FILESTAT_SET_TIMES = exports.WASI_RIGHT_FD_FILESTAT_SET_SIZE = exports.WASI_RIGHT_FD_FILESTAT_GET = exports.WASI_RIGHT_PATH_FILESTAT_SET_TIMES = exports.WASI_RIGHT_PATH_FILESTAT_SET_SIZE = exports.WASI_RIGHT_PATH_FILESTAT_GET = exports.WASI_RIGHT_PATH_RENAME_TARGET = exports.WASI_RIGHT_PATH_RENAME_SOURCE = exports.WASI_RIGHT_PATH_READLINK = exports.WASI_RIGHT_FD_READDIR = exports.WASI_RIGHT_PATH_OPEN = exports.WASI_RIGHT_PATH_LINK_TARGET = exports.WASI_RIGHT_PATH_LINK_SOURCE = exports.WASI_RIGHT_PATH_CREATE_FILE = exports.WASI_RIGHT_PATH_CREATE_DIRECTORY = exports.WASI_RIGHT_FD_ALLOCATE = exports.WASI_RIGHT_FD_ADVISE = exports.WASI_RIGHT_FD_WRITE = exports.WASI_RIGHT_FD_TELL = exports.WASI_RIGHT_FD_SYNC = exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS = exports.WASI_RIGHT_FD_SEEK = exports.WASI_RIGHT_FD_READ = exports.WASI_RIGHT_FD_DATASYNC = exports.WASI_FDFLAG_SYNC = exports.WASI_FDFLAG_RSYNC = exports.WASI_FDFLAG_NONBLOCK = exports.WASI_FDFLAG_DSYNC = exports.WASI_FDFLAG_APPEND = exports.WASI_FILETYPE_SYMBOLIC_LINK = exports.WASI_FILETYPE_SOCKET_STREAM = exports.WASI_FILETYPE_SOCKET_DGRAM = exports.WASI_FILETYPE_REGULAR_FILE = exports.WASI_FILETYPE_DIRECTORY = exports.WASI_FILETYPE_CHARACTER_DEVICE = exports.WASI_FILETYPE_BLOCK_DEVICE = exports.WASI_FILETYPE_UNKNOWN = exports.WASI_SIGXFSZ = exports.WASI_SIGXCPU = void 0, exports.SIGNAL_MAP = exports.ERROR_MAP = exports.WASI_WHENCE_END = exports.WASI_WHENCE_CUR = exports.WASI_WHENCE_SET = exports.WASI_STDERR_FILENO = exports.WASI_STDOUT_FILENO = exports.WASI_STDIN_FILENO = exports.WASI_DIRCOOKIE_START = exports.WASI_PREOPENTYPE_DIR = exports.WASI_O_TRUNC = exports.WASI_O_EXCL = exports.WASI_O_DIRECTORY = exports.WASI_O_CREAT = exports.WASI_FILESTAT_SET_MTIM_NOW = exports.WASI_FILESTAT_SET_MTIM = exports.WASI_FILESTAT_SET_ATIM_NOW = exports.WASI_FILESTAT_SET_ATIM = exports.WASI_EVENTTYPE_FD_WRITE = exports.WASI_EVENTTYPE_FD_READ = exports.WASI_EVENTTYPE_CLOCK = exports.WASI_CLOCK_THREAD_CPUTIME_ID = exports.WASI_CLOCK_PROCESS_CPUTIME_ID = exports.WASI_CLOCK_MONOTONIC = exports.WASI_CLOCK_REALTIME = exports.RIGHTS_TTY_INHERITING = exports.RIGHTS_TTY_BASE = exports.RIGHTS_SOCKET_INHERITING = exports.RIGHTS_SOCKET_BASE = exports.RIGHTS_DIRECTORY_INHERITING = exports.RIGHTS_DIRECTORY_BASE = exports.RIGHTS_REGULAR_FILE_INHERITING = void 0, exports.WASI_ESUCCESS = 0, exports.WASI_E2BIG = 1, exports.WASI_EACCES = 2, exports.WASI_EADDRINUSE = 3, exports.WASI_EADDRNOTAVAIL = 4, exports.WASI_EAFNOSUPPORT = 5, exports.WASI_EAGAIN = 6, exports.WASI_EALREADY = 7, exports.WASI_EBADF = 8, exports.WASI_EBADMSG = 9, exports.WASI_EBUSY = 10, exports.WASI_ECANCELED = 11, exports.WASI_ECHILD = 12, exports.WASI_ECONNABORTED = 13, exports.WASI_ECONNREFUSED = 14, exports.WASI_ECONNRESET = 15, exports.WASI_EDEADLK = 16, exports.WASI_EDESTADDRREQ = 17, exports.WASI_EDOM = 18, exports.WASI_EDQUOT = 19, exports.WASI_EEXIST = 20, exports.WASI_EFAULT = 21, exports.WASI_EFBIG = 22, exports.WASI_EHOSTUNREACH = 23, exports.WASI_EIDRM = 24, exports.WASI_EILSEQ = 25, exports.WASI_EINPROGRESS = 26, exports.WASI_EINTR = 27, exports.WASI_EINVAL = 28, exports.WASI_EIO = 29, exports.WASI_EISCONN = 30, exports.WASI_EISDIR = 31, exports.WASI_ELOOP = 32, exports.WASI_EMFILE = 33, exports.WASI_EMLINK = 34, exports.WASI_EMSGSIZE = 35, exports.WASI_EMULTIHOP = 36, exports.WASI_ENAMETOOLONG = 37, exports.WASI_ENETDOWN = 38, exports.WASI_ENETRESET = 39, exports.WASI_ENETUNREACH = 40, exports.WASI_ENFILE = 41, exports.WASI_ENOBUFS = 42, exports.WASI_ENODEV = 43, exports.WASI_ENOENT = 44, exports.WASI_ENOEXEC = 45, exports.WASI_ENOLCK = 46, exports.WASI_ENOLINK = 47, exports.WASI_ENOMEM = 48, exports.WASI_ENOMSG = 49, exports.WASI_ENOPROTOOPT = 50, exports.WASI_ENOSPC = 51, exports.WASI_ENOSYS = 52, exports.WASI_ENOTCONN = 53, exports.WASI_ENOTDIR = 54, exports.WASI_ENOTEMPTY = 55, exports.WASI_ENOTRECOVERABLE = 56, exports.WASI_ENOTSOCK = 57, exports.WASI_ENOTSUP = 58, exports.WASI_ENOTTY = 59, exports.WASI_ENXIO = 60, exports.WASI_EOVERFLOW = 61, exports.WASI_EOWNERDEAD = 62, exports.WASI_EPERM = 63, exports.WASI_EPIPE = 64, exports.WASI_EPROTO = 65, exports.WASI_EPROTONOSUPPORT = 66, exports.WASI_EPROTOTYPE = 67, exports.WASI_ERANGE = 68, exports.WASI_EROFS = 69, exports.WASI_ESPIPE = 70, exports.WASI_ESRCH = 71, exports.WASI_ESTALE = 72, exports.WASI_ETIMEDOUT = 73, exports.WASI_ETXTBSY = 74, exports.WASI_EXDEV = 75, exports.WASI_ENOTCAPABLE = 76, exports.WASI_SIGABRT = 0, exports.WASI_SIGALRM = 1, exports.WASI_SIGBUS = 2, exports.WASI_SIGCHLD = 3, exports.WASI_SIGCONT = 4, exports.WASI_SIGFPE = 5, exports.WASI_SIGHUP = 6, exports.WASI_SIGILL = 7, exports.WASI_SIGINT = 8, exports.WASI_SIGKILL = 9, exports.WASI_SIGPIPE = 10, exports.WASI_SIGQUIT = 11, exports.WASI_SIGSEGV = 12, exports.WASI_SIGSTOP = 13, exports.WASI_SIGTERM = 14, exports.WASI_SIGTRAP = 15, exports.WASI_SIGTSTP = 16, exports.WASI_SIGTTIN = 17, exports.WASI_SIGTTOU = 18, exports.WASI_SIGURG = 19, exports.WASI_SIGUSR1 = 20, exports.WASI_SIGUSR2 = 21, exports.WASI_SIGVTALRM = 22, exports.WASI_SIGXCPU = 23, exports.WASI_SIGXFSZ = 24, exports.WASI_FILETYPE_UNKNOWN = 0, exports.WASI_FILETYPE_BLOCK_DEVICE = 1, exports.WASI_FILETYPE_CHARACTER_DEVICE = 2, exports.WASI_FILETYPE_DIRECTORY = 3, exports.WASI_FILETYPE_REGULAR_FILE = 4, exports.WASI_FILETYPE_SOCKET_DGRAM = 5, exports.WASI_FILETYPE_SOCKET_STREAM = 6, exports.WASI_FILETYPE_SYMBOLIC_LINK = 7, exports.WASI_FDFLAG_APPEND = 1, exports.WASI_FDFLAG_DSYNC = 2, exports.WASI_FDFLAG_NONBLOCK = 4, exports.WASI_FDFLAG_RSYNC = 8, exports.WASI_FDFLAG_SYNC = 16, exports.WASI_RIGHT_FD_DATASYNC = BigInt(1), exports.WASI_RIGHT_FD_READ = BigInt(2), exports.WASI_RIGHT_FD_SEEK = BigInt(4), exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS = BigInt(8), exports.WASI_RIGHT_FD_SYNC = BigInt(16), exports.WASI_RIGHT_FD_TELL = BigInt(32), exports.WASI_RIGHT_FD_WRITE = BigInt(64), exports.WASI_RIGHT_FD_ADVISE = BigInt(128), exports.WASI_RIGHT_FD_ALLOCATE = BigInt(256), exports.WASI_RIGHT_PATH_CREATE_DIRECTORY = BigInt(512), exports.WASI_RIGHT_PATH_CREATE_FILE = BigInt(1024), exports.WASI_RIGHT_PATH_LINK_SOURCE = BigInt(2048), exports.WASI_RIGHT_PATH_LINK_TARGET = BigInt(4096), exports.WASI_RIGHT_PATH_OPEN = BigInt(8192), exports.WASI_RIGHT_FD_READDIR = BigInt(16384), exports.WASI_RIGHT_PATH_READLINK = BigInt(32768), exports.WASI_RIGHT_PATH_RENAME_SOURCE = BigInt(65536), exports.WASI_RIGHT_PATH_RENAME_TARGET = BigInt(131072), exports.WASI_RIGHT_PATH_FILESTAT_GET = BigInt(262144), exports.WASI_RIGHT_PATH_FILESTAT_SET_SIZE = BigInt(524288), exports.WASI_RIGHT_PATH_FILESTAT_SET_TIMES = BigInt(1048576), exports.WASI_RIGHT_FD_FILESTAT_GET = BigInt(2097152), exports.WASI_RIGHT_FD_FILESTAT_SET_SIZE = BigInt(4194304), exports.WASI_RIGHT_FD_FILESTAT_SET_TIMES = BigInt(8388608), exports.WASI_RIGHT_PATH_SYMLINK = BigInt(16777216), exports.WASI_RIGHT_PATH_REMOVE_DIRECTORY = BigInt(33554432), exports.WASI_RIGHT_PATH_UNLINK_FILE = BigInt(67108864), exports.WASI_RIGHT_POLL_FD_READWRITE = BigInt(134217728), exports.WASI_RIGHT_SOCK_SHUTDOWN = BigInt(268435456), exports.RIGHTS_ALL = exports.WASI_RIGHT_FD_DATASYNC | exports.WASI_RIGHT_FD_READ | exports.WASI_RIGHT_FD_SEEK | exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS | exports.WASI_RIGHT_FD_SYNC | exports.WASI_RIGHT_FD_TELL | exports.WASI_RIGHT_FD_WRITE | exports.WASI_RIGHT_FD_ADVISE | exports.WASI_RIGHT_FD_ALLOCATE | exports.WASI_RIGHT_PATH_CREATE_DIRECTORY | exports.WASI_RIGHT_PATH_CREATE_FILE | exports.WASI_RIGHT_PATH_LINK_SOURCE | exports.WASI_RIGHT_PATH_LINK_TARGET | exports.WASI_RIGHT_PATH_OPEN | exports.WASI_RIGHT_FD_READDIR | exports.WASI_RIGHT_PATH_READLINK | exports.WASI_RIGHT_PATH_RENAME_SOURCE | exports.WASI_RIGHT_PATH_RENAME_TARGET | exports.WASI_RIGHT_PATH_FILESTAT_GET | exports.WASI_RIGHT_PATH_FILESTAT_SET_SIZE | exports.WASI_RIGHT_PATH_FILESTAT_SET_TIMES | exports.WASI_RIGHT_FD_FILESTAT_GET | exports.WASI_RIGHT_FD_FILESTAT_SET_TIMES | exports.WASI_RIGHT_FD_FILESTAT_SET_SIZE | exports.WASI_RIGHT_PATH_SYMLINK | exports.WASI_RIGHT_PATH_UNLINK_FILE | exports.WASI_RIGHT_PATH_REMOVE_DIRECTORY | exports.WASI_RIGHT_POLL_FD_READWRITE | exports.WASI_RIGHT_SOCK_SHUTDOWN, exports.RIGHTS_BLOCK_DEVICE_BASE = exports.RIGHTS_ALL, exports.RIGHTS_BLOCK_DEVICE_INHERITING = exports.RIGHTS_ALL, exports.RIGHTS_CHARACTER_DEVICE_BASE = exports.RIGHTS_ALL, exports.RIGHTS_CHARACTER_DEVICE_INHERITING = exports.RIGHTS_ALL, exports.RIGHTS_REGULAR_FILE_BASE = exports.WASI_RIGHT_FD_DATASYNC | exports.WASI_RIGHT_FD_READ | exports.WASI_RIGHT_FD_SEEK | exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS | exports.WASI_RIGHT_FD_SYNC | exports.WASI_RIGHT_FD_TELL | exports.WASI_RIGHT_FD_WRITE | exports.WASI_RIGHT_FD_ADVISE | exports.WASI_RIGHT_FD_ALLOCATE | exports.WASI_RIGHT_FD_FILESTAT_GET | exports.WASI_RIGHT_FD_FILESTAT_SET_SIZE | exports.WASI_RIGHT_FD_FILESTAT_SET_TIMES | exports.WASI_RIGHT_POLL_FD_READWRITE, exports.RIGHTS_REGULAR_FILE_INHERITING = BigInt(0), exports.RIGHTS_DIRECTORY_BASE = exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS | exports.WASI_RIGHT_FD_SYNC | exports.WASI_RIGHT_FD_ADVISE | exports.WASI_RIGHT_PATH_CREATE_DIRECTORY | exports.WASI_RIGHT_PATH_CREATE_FILE | exports.WASI_RIGHT_PATH_LINK_SOURCE | exports.WASI_RIGHT_PATH_LINK_TARGET | exports.WASI_RIGHT_PATH_OPEN | exports.WASI_RIGHT_FD_READDIR | exports.WASI_RIGHT_PATH_READLINK | exports.WASI_RIGHT_PATH_RENAME_SOURCE | exports.WASI_RIGHT_PATH_RENAME_TARGET | exports.WASI_RIGHT_PATH_FILESTAT_GET | exports.WASI_RIGHT_PATH_FILESTAT_SET_SIZE | exports.WASI_RIGHT_PATH_FILESTAT_SET_TIMES | exports.WASI_RIGHT_FD_FILESTAT_GET | exports.WASI_RIGHT_FD_FILESTAT_SET_TIMES | exports.WASI_RIGHT_PATH_SYMLINK | exports.WASI_RIGHT_PATH_UNLINK_FILE | exports.WASI_RIGHT_PATH_REMOVE_DIRECTORY | exports.WASI_RIGHT_POLL_FD_READWRITE, exports.RIGHTS_DIRECTORY_INHERITING = exports.RIGHTS_DIRECTORY_BASE | exports.RIGHTS_REGULAR_FILE_BASE, exports.RIGHTS_SOCKET_BASE = exports.WASI_RIGHT_FD_READ | exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS | exports.WASI_RIGHT_FD_WRITE | exports.WASI_RIGHT_FD_FILESTAT_GET | exports.WASI_RIGHT_POLL_FD_READWRITE | exports.WASI_RIGHT_SOCK_SHUTDOWN, exports.RIGHTS_SOCKET_INHERITING = exports.RIGHTS_ALL, exports.RIGHTS_TTY_BASE = exports.WASI_RIGHT_FD_READ | exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS | exports.WASI_RIGHT_FD_WRITE | exports.WASI_RIGHT_FD_FILESTAT_GET | exports.WASI_RIGHT_POLL_FD_READWRITE, exports.RIGHTS_TTY_INHERITING = BigInt(0), exports.WASI_CLOCK_REALTIME = 0, exports.WASI_CLOCK_MONOTONIC = 1, exports.WASI_CLOCK_PROCESS_CPUTIME_ID = 2, exports.WASI_CLOCK_THREAD_CPUTIME_ID = 3, exports.WASI_EVENTTYPE_CLOCK = 0, exports.WASI_EVENTTYPE_FD_READ = 1, exports.WASI_EVENTTYPE_FD_WRITE = 2, exports.WASI_FILESTAT_SET_ATIM = 1 << 0, exports.WASI_FILESTAT_SET_ATIM_NOW = 1 << 1, exports.WASI_FILESTAT_SET_MTIM = 1 << 2, exports.WASI_FILESTAT_SET_MTIM_NOW = 1 << 3, exports.WASI_O_CREAT = 1 << 0, exports.WASI_O_DIRECTORY = 1 << 1, exports.WASI_O_EXCL = 1 << 2, exports.WASI_O_TRUNC = 1 << 3, exports.WASI_PREOPENTYPE_DIR = 0, exports.WASI_DIRCOOKIE_START = 0, exports.WASI_STDIN_FILENO = 0, exports.WASI_STDOUT_FILENO = 1, exports.WASI_STDERR_FILENO = 2, exports.WASI_WHENCE_SET = 0, exports.WASI_WHENCE_CUR = 1, exports.WASI_WHENCE_END = 2, exports.ERROR_MAP = {
      E2BIG: exports.WASI_E2BIG,
      EACCES: exports.WASI_EACCES,
      EADDRINUSE: exports.WASI_EADDRINUSE,
      EADDRNOTAVAIL: exports.WASI_EADDRNOTAVAIL,
      EAFNOSUPPORT: exports.WASI_EAFNOSUPPORT,
      EALREADY: exports.WASI_EALREADY,
      EAGAIN: exports.WASI_EAGAIN,
      EBADF: exports.WASI_EBADF,
      EBADMSG: exports.WASI_EBADMSG,
      EBUSY: exports.WASI_EBUSY,
      ECANCELED: exports.WASI_ECANCELED,
      ECHILD: exports.WASI_ECHILD,
      ECONNABORTED: exports.WASI_ECONNABORTED,
      ECONNREFUSED: exports.WASI_ECONNREFUSED,
      ECONNRESET: exports.WASI_ECONNRESET,
      EDEADLOCK: exports.WASI_EDEADLK,
      EDESTADDRREQ: exports.WASI_EDESTADDRREQ,
      EDOM: exports.WASI_EDOM,
      EDQUOT: exports.WASI_EDQUOT,
      EEXIST: exports.WASI_EEXIST,
      EFAULT: exports.WASI_EFAULT,
      EFBIG: exports.WASI_EFBIG,
      EHOSTDOWN: exports.WASI_EHOSTUNREACH,
      EHOSTUNREACH: exports.WASI_EHOSTUNREACH,
      EIDRM: exports.WASI_EIDRM,
      EILSEQ: exports.WASI_EILSEQ,
      EINPROGRESS: exports.WASI_EINPROGRESS,
      EINTR: exports.WASI_EINTR,
      EINVAL: exports.WASI_EINVAL,
      EIO: exports.WASI_EIO,
      EISCONN: exports.WASI_EISCONN,
      EISDIR: exports.WASI_EISDIR,
      ELOOP: exports.WASI_ELOOP,
      EMFILE: exports.WASI_EMFILE,
      EMLINK: exports.WASI_EMLINK,
      EMSGSIZE: exports.WASI_EMSGSIZE,
      EMULTIHOP: exports.WASI_EMULTIHOP,
      ENAMETOOLONG: exports.WASI_ENAMETOOLONG,
      ENETDOWN: exports.WASI_ENETDOWN,
      ENETRESET: exports.WASI_ENETRESET,
      ENETUNREACH: exports.WASI_ENETUNREACH,
      ENFILE: exports.WASI_ENFILE,
      ENOBUFS: exports.WASI_ENOBUFS,
      ENODEV: exports.WASI_ENODEV,
      ENOENT: exports.WASI_ENOENT,
      ENOEXEC: exports.WASI_ENOEXEC,
      ENOLCK: exports.WASI_ENOLCK,
      ENOLINK: exports.WASI_ENOLINK,
      ENOMEM: exports.WASI_ENOMEM,
      ENOMSG: exports.WASI_ENOMSG,
      ENOPROTOOPT: exports.WASI_ENOPROTOOPT,
      ENOSPC: exports.WASI_ENOSPC,
      ENOSYS: exports.WASI_ENOSYS,
      ENOTCONN: exports.WASI_ENOTCONN,
      ENOTDIR: exports.WASI_ENOTDIR,
      ENOTEMPTY: exports.WASI_ENOTEMPTY,
      ENOTRECOVERABLE: exports.WASI_ENOTRECOVERABLE,
      ENOTSOCK: exports.WASI_ENOTSOCK,
      ENOTTY: exports.WASI_ENOTTY,
      ENXIO: exports.WASI_ENXIO,
      EOVERFLOW: exports.WASI_EOVERFLOW,
      EOWNERDEAD: exports.WASI_EOWNERDEAD,
      EPERM: exports.WASI_EPERM,
      EPIPE: exports.WASI_EPIPE,
      EPROTO: exports.WASI_EPROTO,
      EPROTONOSUPPORT: exports.WASI_EPROTONOSUPPORT,
      EPROTOTYPE: exports.WASI_EPROTOTYPE,
      ERANGE: exports.WASI_ERANGE,
      EROFS: exports.WASI_EROFS,
      ESPIPE: exports.WASI_ESPIPE,
      ESRCH: exports.WASI_ESRCH,
      ESTALE: exports.WASI_ESTALE,
      ETIMEDOUT: exports.WASI_ETIMEDOUT,
      ETXTBSY: exports.WASI_ETXTBSY,
      EXDEV: exports.WASI_EXDEV
    }, exports.SIGNAL_MAP = {
      [exports.WASI_SIGHUP]: "SIGHUP",
      [exports.WASI_SIGINT]: "SIGINT",
      [exports.WASI_SIGQUIT]: "SIGQUIT",
      [exports.WASI_SIGILL]: "SIGILL",
      [exports.WASI_SIGTRAP]: "SIGTRAP",
      [exports.WASI_SIGABRT]: "SIGABRT",
      [exports.WASI_SIGBUS]: "SIGBUS",
      [exports.WASI_SIGFPE]: "SIGFPE",
      [exports.WASI_SIGKILL]: "SIGKILL",
      [exports.WASI_SIGUSR1]: "SIGUSR1",
      [exports.WASI_SIGSEGV]: "SIGSEGV",
      [exports.WASI_SIGUSR2]: "SIGUSR2",
      [exports.WASI_SIGPIPE]: "SIGPIPE",
      [exports.WASI_SIGALRM]: "SIGALRM",
      [exports.WASI_SIGTERM]: "SIGTERM",
      [exports.WASI_SIGCHLD]: "SIGCHLD",
      [exports.WASI_SIGCONT]: "SIGCONT",
      [exports.WASI_SIGSTOP]: "SIGSTOP",
      [exports.WASI_SIGTSTP]: "SIGTSTP",
      [exports.WASI_SIGTTIN]: "SIGTTIN",
      [exports.WASI_SIGTTOU]: "SIGTTOU",
      [exports.WASI_SIGURG]: "SIGURG",
      [exports.WASI_SIGXCPU]: "SIGXCPU",
      [exports.WASI_SIGXFSZ]: "SIGXFSZ",
      [exports.WASI_SIGVTALRM]: "SIGVTALRM"
    };
  }
}), require_wasi = __commonJS({
  "node_modules/wasi-js/dist/wasi.js"(exports) {
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { default: mod };
    };
    let fs;
    Object.defineProperty(exports, "__esModule", { value: !0 }), exports.SOCKET_DEFAULT_RIGHTS = void 0;
    var log = () => {
    }, logOpen = () => {
    }, SC_OPEN_MAX = 32768, types_1 = require_types(), constants_1 = require_constants(), STDIN_DEFAULT_RIGHTS = constants_1.WASI_RIGHT_FD_DATASYNC | constants_1.WASI_RIGHT_FD_READ | constants_1.WASI_RIGHT_FD_SYNC | constants_1.WASI_RIGHT_FD_ADVISE | constants_1.WASI_RIGHT_FD_FILESTAT_GET | constants_1.WASI_RIGHT_POLL_FD_READWRITE, STDOUT_DEFAULT_RIGHTS = constants_1.WASI_RIGHT_FD_DATASYNC | constants_1.WASI_RIGHT_FD_WRITE | constants_1.WASI_RIGHT_FD_SYNC | constants_1.WASI_RIGHT_FD_ADVISE | constants_1.WASI_RIGHT_FD_FILESTAT_GET | constants_1.WASI_RIGHT_POLL_FD_READWRITE, STDERR_DEFAULT_RIGHTS = STDOUT_DEFAULT_RIGHTS;
    exports.SOCKET_DEFAULT_RIGHTS = constants_1.WASI_RIGHT_FD_DATASYNC | constants_1.WASI_RIGHT_FD_READ | constants_1.WASI_RIGHT_FD_WRITE | constants_1.WASI_RIGHT_FD_ADVISE | constants_1.WASI_RIGHT_FD_FILESTAT_GET | constants_1.WASI_RIGHT_POLL_FD_READWRITE | constants_1.WASI_RIGHT_FD_FDSTAT_SET_FLAGS;
    var msToNs = (ms) => {
      const msInt = Math.trunc(ms), decimal = BigInt(Math.round((ms - msInt) * 1e6));
      return BigInt(msInt) * BigInt(1e6) + decimal;
    }, nsToMs = (ns) => {
      if (typeof ns === "number")
        ns = Math.trunc(ns);
      const nsInt = BigInt(ns);
      return Number(nsInt / BigInt(1e6));
    }, wrap = (f) => (...args) => {
      try {
        return f(...args);
      } catch (err) {
        let e = err;
        while (e.prev != null)
          e = e.prev;
        if (e?.code && typeof e?.code === "string")
          return constants_1.ERROR_MAP[e.code] || constants_1.WASI_EINVAL;
        if (e instanceof types_1.WASIError)
          return e.errno;
        throw e;
      }
    }, stat = (wasi, fd) => {
      const entry = wasi.FD_MAP.get(fd);
      if (!entry)
        throw new types_1.WASIError(constants_1.WASI_EBADF);
      if (entry.filetype === void 0) {
        const stats = wasi.fstatSync(entry.real), { filetype, rightsBase, rightsInheriting } = translateFileAttributes(wasi, fd, stats);
        if (entry.filetype = filetype, !entry.rights)
          entry.rights = {
            base: rightsBase,
            inheriting: rightsInheriting
          };
      }
      return entry;
    }, translateFileAttributes = (wasi, fd, stats) => {
      switch (!0) {
        case stats.isBlockDevice():
          return {
            filetype: constants_1.WASI_FILETYPE_BLOCK_DEVICE,
            rightsBase: constants_1.RIGHTS_BLOCK_DEVICE_BASE,
            rightsInheriting: constants_1.RIGHTS_BLOCK_DEVICE_INHERITING
          };
        case stats.isCharacterDevice(): {
          const filetype = constants_1.WASI_FILETYPE_CHARACTER_DEVICE;
          if (fd !== void 0 && wasi.bindings.isTTY(fd))
            return {
              filetype,
              rightsBase: constants_1.RIGHTS_TTY_BASE,
              rightsInheriting: constants_1.RIGHTS_TTY_INHERITING
            };
          return {
            filetype,
            rightsBase: constants_1.RIGHTS_CHARACTER_DEVICE_BASE,
            rightsInheriting: constants_1.RIGHTS_CHARACTER_DEVICE_INHERITING
          };
        }
        case stats.isDirectory():
          return {
            filetype: constants_1.WASI_FILETYPE_DIRECTORY,
            rightsBase: constants_1.RIGHTS_DIRECTORY_BASE,
            rightsInheriting: constants_1.RIGHTS_DIRECTORY_INHERITING
          };
        case stats.isFIFO():
          return {
            filetype: constants_1.WASI_FILETYPE_SOCKET_STREAM,
            rightsBase: constants_1.RIGHTS_SOCKET_BASE,
            rightsInheriting: constants_1.RIGHTS_SOCKET_INHERITING
          };
        case stats.isFile():
          return {
            filetype: constants_1.WASI_FILETYPE_REGULAR_FILE,
            rightsBase: constants_1.RIGHTS_REGULAR_FILE_BASE,
            rightsInheriting: constants_1.RIGHTS_REGULAR_FILE_INHERITING
          };
        case stats.isSocket():
          return {
            filetype: constants_1.WASI_FILETYPE_SOCKET_STREAM,
            rightsBase: constants_1.RIGHTS_SOCKET_BASE,
            rightsInheriting: constants_1.RIGHTS_SOCKET_INHERITING
          };
        case stats.isSymbolicLink():
          return {
            filetype: constants_1.WASI_FILETYPE_SYMBOLIC_LINK,
            rightsBase: BigInt(0),
            rightsInheriting: BigInt(0)
          };
        default:
          return {
            filetype: constants_1.WASI_FILETYPE_UNKNOWN,
            rightsBase: BigInt(0),
            rightsInheriting: BigInt(0)
          };
      }
    }, warnedAboutSleep = !1, defaultConfig;
    function getDefaults() {
      if (defaultConfig)
        return defaultConfig;
      const defaultBindings = {
        hrtime: () => process.hrtime.bigint(),
        exit: (code) => {
          process.exit(code);
        },
        kill: (signal) => {
          process.kill(process.pid, signal);
        },
        randomFillSync: (array) => crypto.getRandomValues(array),
        isTTY: (fd) => import.meta.require("node:tty").isatty(fd),
        fs: Bun.fs(),
        path: import.meta.require("node:path")
      };
      return defaultConfig = {
        args: [],
        env: {},
        preopens: {},
        bindings: defaultBindings,
        sleep: (ms) => {
          Bun.sleepSync(ms);
        }
      };
    }
    var WASI = class WASI2 {
      constructor(wasiConfig = {}) {
        const defaultConfig2 = getDefaults();
        this.lastStdin = 0, this.sleep = wasiConfig.sleep || defaultConfig2.sleep, this.getStdin = wasiConfig.getStdin, this.sendStdout = wasiConfig.sendStdout, this.sendStderr = wasiConfig.sendStderr;
        let preopens = wasiConfig.preopens ?? defaultConfig2.preopens;
        this.env = wasiConfig.env ?? defaultConfig2.env;
        const args = wasiConfig.args ?? defaultConfig2.args;
        this.memory = void 0, this.view = void 0, this.bindings = wasiConfig.bindings || defaultConfig2.bindings;
        const bindings2 = this.bindings;
        fs = bindings2.fs, this.FD_MAP = new Map([
          [
            constants_1.WASI_STDIN_FILENO,
            {
              real: 0,
              filetype: constants_1.WASI_FILETYPE_CHARACTER_DEVICE,
              rights: {
                base: STDIN_DEFAULT_RIGHTS,
                inheriting: BigInt(0)
              },
              path: "/dev/stdin"
            }
          ],
          [
            constants_1.WASI_STDOUT_FILENO,
            {
              real: 1,
              filetype: constants_1.WASI_FILETYPE_CHARACTER_DEVICE,
              rights: {
                base: STDOUT_DEFAULT_RIGHTS,
                inheriting: BigInt(0)
              },
              path: "/dev/stdout"
            }
          ],
          [
            constants_1.WASI_STDERR_FILENO,
            {
              real: 2,
              filetype: constants_1.WASI_FILETYPE_CHARACTER_DEVICE,
              rights: {
                base: STDERR_DEFAULT_RIGHTS,
                inheriting: BigInt(0)
              },
              path: "/dev/stderr"
            }
          ]
        ]);
        const path = bindings2.path;
        for (let [k, v] of Object.entries(preopens)) {
          const real = fs.openSync(v, nodeFsConstants.O_RDONLY), newfd = this.getUnusedFileDescriptor();
          this.FD_MAP.set(newfd, {
            real,
            filetype: constants_1.WASI_FILETYPE_DIRECTORY,
            rights: {
              base: constants_1.RIGHTS_DIRECTORY_BASE,
              inheriting: constants_1.RIGHTS_DIRECTORY_INHERITING
            },
            fakePath: k,
            path: v
          });
        }
        const getiovs = (iovs, iovsLen) => {
          this.refreshMemory();
          const { view, memory } = this, { buffer } = memory, { byteLength } = buffer;
          if (iovsLen === 1) {
            const ptr = iovs, buf = view.getUint32(ptr, !0);
            let bufLen = view.getUint32(ptr + 4, !0);
            if (bufLen > byteLength - buf)
              console.log({
                buf,
                bufLen,
                total_memory: byteLength
              }), log("getiovs: warning -- truncating buffer to fit in memory"), bufLen = Math.min(bufLen, Math.max(0, byteLength - buf));
            try {
              return [new Uint8Array(buffer, buf, bufLen)];
            } catch (err) {
              throw console.warn("WASI.getiovs -- invalid buffer", err), new types_1.WASIError(constants_1.WASI_EINVAL);
            }
          }
          const buffers = [];
          buffers.length = iovsLen;
          for (let i = 0, ptr = iovs;i < iovsLen; i++, ptr += 8) {
            const buf = view.getUint32(ptr, !0);
            let bufLen = view.getUint32(ptr + 4, !0);
            if (bufLen > byteLength - buf)
              console.log({
                buf,
                bufLen,
                total_memory: byteLength
              }), log("getiovs: warning -- truncating buffer to fit in memory"), bufLen = Math.min(bufLen, Math.max(0, byteLength - buf));
            try {
              buffers[i] = new Uint8Array(buffer, buf, bufLen);
            } catch (err) {
              throw console.warn("WASI.getiovs -- invalid buffer", err), new types_1.WASIError(constants_1.WASI_EINVAL);
            }
          }
          return buffers;
        }, CHECK_FD = (fd, rights) => {
          const stats = stat(this, fd);
          if (rights !== BigInt(0) && (stats.rights.base & rights) === BigInt(0))
            throw new types_1.WASIError(constants_1.WASI_EPERM);
          return stats;
        }, CPUTIME_START = Bun.nanoseconds(), timeOrigin = Math.trunc(performance.timeOrigin * 1e6), now = (clockId) => {
          switch (clockId) {
            case constants_1.WASI_CLOCK_MONOTONIC:
              return Bun.nanoseconds();
            case constants_1.WASI_CLOCK_REALTIME:
              return Bun.nanoseconds() + timeOrigin;
            case constants_1.WASI_CLOCK_PROCESS_CPUTIME_ID:
            case constants_1.WASI_CLOCK_THREAD_CPUTIME_ID:
              return Bun.nanoseconds() - CPUTIME_START;
            default:
              return null;
          }
        };
        if (this.wasiImport = {
          args_get: (argv, argvBuf) => {
            this.refreshMemory();
            let coffset = argv, offset = argvBuf;
            return args.forEach((a) => {
              this.view.setUint32(coffset, offset, !0), coffset += 4, offset += Buffer.from(this.memory.buffer).write(`${a}\0`, offset);
            }), constants_1.WASI_ESUCCESS;
          },
          args_sizes_get: (argc, argvBufSize) => {
            this.refreshMemory(), this.view.setUint32(argc, args.length, !0);
            const size = args.reduce((acc, a) => acc + Buffer.byteLength(a) + 1, 0);
            return this.view.setUint32(argvBufSize, size, !0), constants_1.WASI_ESUCCESS;
          },
          environ_get: (environ, environBuf) => {
            this.refreshMemory();
            let coffset = environ, offset = environBuf;
            return Object.entries(this.env).forEach(([key, value]) => {
              this.view.setUint32(coffset, offset, !0), coffset += 4, offset += Buffer.from(this.memory.buffer).write(`${key}=${value}\0`, offset);
            }), constants_1.WASI_ESUCCESS;
          },
          environ_sizes_get: (environCount, environBufSize) => {
            this.refreshMemory();
            const envProcessed = Object.entries(this.env).map(([key, value]) => `${key}=${value}\0`), size = envProcessed.reduce((acc, e) => acc + Buffer.byteLength(e), 0);
            return this.view.setUint32(environCount, envProcessed.length, !0), this.view.setUint32(environBufSize, size, !0), constants_1.WASI_ESUCCESS;
          },
          clock_res_get: (clockId, resolution) => {
            let res;
            switch (clockId) {
              case constants_1.WASI_CLOCK_MONOTONIC:
              case constants_1.WASI_CLOCK_PROCESS_CPUTIME_ID:
              case constants_1.WASI_CLOCK_THREAD_CPUTIME_ID: {
                res = BigInt(1);
                break;
              }
              case constants_1.WASI_CLOCK_REALTIME: {
                res = BigInt(1000);
                break;
              }
            }
            if (!res)
              throw Error("invalid clockId");
            return this.view.setBigUint64(resolution, res), constants_1.WASI_ESUCCESS;
          },
          clock_time_get: (clockId, _precision, time) => {
            this.refreshMemory();
            const n = now(clockId);
            if (n === null)
              return constants_1.WASI_EINVAL;
            return this.view.setBigUint64(time, BigInt(n), !0), constants_1.WASI_ESUCCESS;
          },
          fd_advise: wrap((fd, _offset, _len, _advice) => {
            return CHECK_FD(fd, constants_1.WASI_RIGHT_FD_ADVISE), constants_1.WASI_ENOSYS;
          }),
          fd_allocate: wrap((fd, _offset, _len) => {
            return CHECK_FD(fd, constants_1.WASI_RIGHT_FD_ALLOCATE), constants_1.WASI_ENOSYS;
          }),
          fd_close: wrap((fd) => {
            const stats = CHECK_FD(fd, BigInt(0));
            return fs.closeSync(stats.real), this.FD_MAP.delete(fd), constants_1.WASI_ESUCCESS;
          }),
          fd_datasync: wrap((fd) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_DATASYNC);
            return fs.fdatasyncSync(stats.real), constants_1.WASI_ESUCCESS;
          }),
          fd_fdstat_get: wrap((fd, bufPtr) => {
            const stats = CHECK_FD(fd, BigInt(0));
            if (this.refreshMemory(), stats.filetype == null)
              throw Error("stats.filetype must be set");
            return this.view.setUint8(bufPtr, stats.filetype), this.view.setUint16(bufPtr + 2, 0, !0), this.view.setUint16(bufPtr + 4, 0, !0), this.view.setBigUint64(bufPtr + 8, BigInt(stats.rights.base), !0), this.view.setBigUint64(bufPtr + 8 + 8, BigInt(stats.rights.inheriting), !0), constants_1.WASI_ESUCCESS;
          }),
          fd_fdstat_set_flags: wrap((fd, flags) => {
            if (CHECK_FD(fd, constants_1.WASI_RIGHT_FD_FDSTAT_SET_FLAGS), this.wasiImport.sock_fcntlSetFlags(fd, flags) == 0)
              return constants_1.WASI_ESUCCESS;
            return constants_1.WASI_ENOSYS;
          }),
          fd_fdstat_set_rights: wrap((fd, fsRightsBase, fsRightsInheriting) => {
            const stats = CHECK_FD(fd, BigInt(0));
            if ((stats.rights.base | fsRightsBase) > stats.rights.base)
              return constants_1.WASI_EPERM;
            if ((stats.rights.inheriting | fsRightsInheriting) > stats.rights.inheriting)
              return constants_1.WASI_EPERM;
            return stats.rights.base = fsRightsBase, stats.rights.inheriting = fsRightsInheriting, constants_1.WASI_ESUCCESS;
          }),
          fd_filestat_get: wrap((fd, bufPtr) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_FILESTAT_GET), rstats = this.fstatSync(stats.real);
            if (this.refreshMemory(), this.view.setBigUint64(bufPtr, BigInt(rstats.dev), !0), bufPtr += 8, this.view.setBigUint64(bufPtr, BigInt(rstats.ino), !0), bufPtr += 8, stats.filetype == null)
              throw Error("stats.filetype must be set");
            return this.view.setUint8(bufPtr, stats.filetype), bufPtr += 8, this.view.setBigUint64(bufPtr, BigInt(rstats.nlink), !0), bufPtr += 8, this.view.setBigUint64(bufPtr, BigInt(rstats.size), !0), bufPtr += 8, this.view.setBigUint64(bufPtr, msToNs(rstats.atimeMs), !0), bufPtr += 8, this.view.setBigUint64(bufPtr, msToNs(rstats.mtimeMs), !0), bufPtr += 8, this.view.setBigUint64(bufPtr, msToNs(rstats.ctimeMs), !0), constants_1.WASI_ESUCCESS;
          }),
          fd_filestat_set_size: wrap((fd, stSize) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_FILESTAT_SET_SIZE);
            return fs.ftruncateSync(stats.real, Number(stSize)), constants_1.WASI_ESUCCESS;
          }),
          fd_filestat_set_times: wrap((fd, stAtim, stMtim, fstflags) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_FILESTAT_SET_TIMES), rstats = this.fstatSync(stats.real);
            let { atime: atim, mtime: mtim } = rstats;
            const n = nsToMs(now(constants_1.WASI_CLOCK_REALTIME)), atimflags = constants_1.WASI_FILESTAT_SET_ATIM | constants_1.WASI_FILESTAT_SET_ATIM_NOW;
            if ((fstflags & atimflags) === atimflags)
              return constants_1.WASI_EINVAL;
            const mtimflags = constants_1.WASI_FILESTAT_SET_MTIM | constants_1.WASI_FILESTAT_SET_MTIM_NOW;
            if ((fstflags & mtimflags) === mtimflags)
              return constants_1.WASI_EINVAL;
            if ((fstflags & constants_1.WASI_FILESTAT_SET_ATIM) === constants_1.WASI_FILESTAT_SET_ATIM)
              atim = nsToMs(stAtim);
            else if ((fstflags & constants_1.WASI_FILESTAT_SET_ATIM_NOW) === constants_1.WASI_FILESTAT_SET_ATIM_NOW)
              atim = n;
            if ((fstflags & constants_1.WASI_FILESTAT_SET_MTIM) === constants_1.WASI_FILESTAT_SET_MTIM)
              mtim = nsToMs(stMtim);
            else if ((fstflags & constants_1.WASI_FILESTAT_SET_MTIM_NOW) === constants_1.WASI_FILESTAT_SET_MTIM_NOW)
              mtim = n;
            return fs.futimesSync(stats.real, new Date(atim), new Date(mtim)), constants_1.WASI_ESUCCESS;
          }),
          fd_prestat_get: wrap((fd, bufPtr) => {
            const stats = CHECK_FD(fd, BigInt(0));
            return this.refreshMemory(), this.view.setUint8(bufPtr, constants_1.WASI_PREOPENTYPE_DIR), this.view.setUint32(bufPtr + 4, Buffer.byteLength(stats.fakePath ?? stats.path ?? ""), !0), constants_1.WASI_ESUCCESS;
          }),
          fd_prestat_dir_name: wrap((fd, pathPtr, pathLen) => {
            const stats = CHECK_FD(fd, BigInt(0));
            return this.refreshMemory(), Buffer.from(this.memory.buffer).write(stats.fakePath ?? stats.path ?? "", pathPtr, pathLen, "utf8"), constants_1.WASI_ESUCCESS;
          }),
          fd_pwrite: wrap((fd, iovs, iovsLen, offset, nwritten) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_WRITE | constants_1.WASI_RIGHT_FD_SEEK);
            let written = 0;
            return getiovs(iovs, iovsLen).forEach((iov) => {
              let w = 0;
              while (w < iov.byteLength)
                w += fs.writeSync(stats.real, iov, w, iov.byteLength - w, Number(offset) + written + w);
              written += w;
            }), this.view.setUint32(nwritten, written, !0), constants_1.WASI_ESUCCESS;
          }),
          fd_write: wrap((fd, iovs, iovsLen, nwritten) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_WRITE), IS_STDOUT = fd == constants_1.WASI_STDOUT_FILENO, IS_STDERR = fd == constants_1.WASI_STDERR_FILENO;
            let written = 0;
            return getiovs(iovs, iovsLen).forEach((iov) => {
              if (iov.byteLength == 0)
                return;
              if (IS_STDOUT && this.sendStdout != null)
                this.sendStdout(iov), written += iov.byteLength;
              else if (IS_STDERR && this.sendStderr != null)
                this.sendStderr(iov), written += iov.byteLength;
              else {
                let w = 0;
                while (w < iov.byteLength) {
                  const i = fs.writeSync(stats.real, iov, w, iov.byteLength - w, stats.offset ? Number(stats.offset) : null);
                  if (stats.offset)
                    stats.offset += BigInt(i);
                  w += i;
                }
                written += w;
              }
            }), this.view.setUint32(nwritten, written, !0), constants_1.WASI_ESUCCESS;
          }),
          fd_pread: wrap((fd, iovs, iovsLen, offset, nread) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_READ | constants_1.WASI_RIGHT_FD_SEEK);
            let read = 0;
            outer:
              for (let iov of getiovs(iovs, iovsLen)) {
                let r = 0;
                while (r < iov.byteLength) {
                  const length = iov.byteLength - r, rr = fs.readSync(stats.real, iov, r, iov.byteLength - r, Number(offset) + read + r);
                  if (r += rr, read += rr, rr === 0 || rr < length)
                    break outer;
                }
                read += r;
              }
            return this.view.setUint32(nread, read, !0), constants_1.WASI_ESUCCESS;
          }),
          fd_read: wrap((fd, iovs, iovsLen, nread) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_READ), IS_STDIN = fd == constants_1.WASI_STDIN_FILENO;
            let read = 0;
            outer:
              for (let iov of getiovs(iovs, iovsLen)) {
                let r = 0;
                while (r < iov.byteLength) {
                  let length = iov.byteLength - r, position = IS_STDIN || stats.offset === void 0 ? null : Number(stats.offset), rr = 0;
                  if (IS_STDIN)
                    if (this.getStdin != null) {
                      if (this.stdinBuffer == null)
                        this.stdinBuffer = this.getStdin();
                      if (this.stdinBuffer != null) {
                        if (rr = this.stdinBuffer.copy(iov), rr == this.stdinBuffer.length)
                          this.stdinBuffer = void 0;
                        else
                          this.stdinBuffer = this.stdinBuffer.slice(rr);
                        if (rr > 0)
                          this.lastStdin = (new Date()).valueOf();
                      }
                    } else {
                      if (this.sleep == null && !warnedAboutSleep)
                        warnedAboutSleep = !0, console.log("(cpu waiting for stdin: please define a way to sleep!) ");
                      try {
                        rr = fs.readSync(stats.real, iov, r, length, position);
                      } catch (_err) {
                      }
                      if (rr == 0)
                        this.shortPause();
                      else
                        this.lastStdin = (new Date()).valueOf();
                    }
                  else
                    rr = fs.readSync(stats.real, iov, r, length, position);
                  if (stats.filetype == constants_1.WASI_FILETYPE_REGULAR_FILE)
                    stats.offset = (stats.offset ? stats.offset : BigInt(0)) + BigInt(rr);
                  if (r += rr, read += rr, rr === 0 || rr < length)
                    break outer;
                }
              }
            return this.view.setUint32(nread, read, !0), constants_1.WASI_ESUCCESS;
          }),
          fd_readdir: wrap((fd, bufPtr, bufLen, cookie, bufusedPtr) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_READDIR);
            this.refreshMemory();
            const entries = fs.readdirSync(stats.path, { withFileTypes: !0 }), startPtr = bufPtr;
            for (let i = Number(cookie);i < entries.length; i += 1) {
              const entry = entries[i];
              let nameLength = Buffer.byteLength(entry.name);
              if (bufPtr - startPtr > bufLen)
                break;
              if (this.view.setBigUint64(bufPtr, BigInt(i + 1), !0), bufPtr += 8, bufPtr - startPtr > bufLen)
                break;
              const rstats = fs.lstatSync(path.resolve(stats.path, entry.name));
              if (this.view.setBigUint64(bufPtr, BigInt(rstats.ino), !0), bufPtr += 8, bufPtr - startPtr > bufLen)
                break;
              if (this.view.setUint32(bufPtr, nameLength, !0), bufPtr += 4, bufPtr - startPtr > bufLen)
                break;
              let filetype;
              switch (!0) {
                case rstats.isBlockDevice():
                  filetype = constants_1.WASI_FILETYPE_BLOCK_DEVICE;
                  break;
                case rstats.isCharacterDevice():
                  filetype = constants_1.WASI_FILETYPE_CHARACTER_DEVICE;
                  break;
                case rstats.isDirectory():
                  filetype = constants_1.WASI_FILETYPE_DIRECTORY;
                  break;
                case rstats.isFIFO():
                  filetype = constants_1.WASI_FILETYPE_SOCKET_STREAM;
                  break;
                case rstats.isFile():
                  filetype = constants_1.WASI_FILETYPE_REGULAR_FILE;
                  break;
                case rstats.isSocket():
                  filetype = constants_1.WASI_FILETYPE_SOCKET_STREAM;
                  break;
                case rstats.isSymbolicLink():
                  filetype = constants_1.WASI_FILETYPE_SYMBOLIC_LINK;
                  break;
                default:
                  filetype = constants_1.WASI_FILETYPE_UNKNOWN;
                  break;
              }
              if (this.view.setUint8(bufPtr, filetype), bufPtr += 1, bufPtr += 3, bufPtr + nameLength >= startPtr + bufLen)
                break;
              Buffer.from(this.memory.buffer).write(entry.name, bufPtr), bufPtr += nameLength;
            }
            const bufused = bufPtr - startPtr;
            return this.view.setUint32(bufusedPtr, Math.min(bufused, bufLen), !0), constants_1.WASI_ESUCCESS;
          }),
          fd_renumber: wrap((from, to) => {
            return CHECK_FD(from, BigInt(0)), CHECK_FD(to, BigInt(0)), fs.closeSync(this.FD_MAP.get(from).real), this.FD_MAP.set(from, this.FD_MAP.get(to)), this.FD_MAP.delete(to), constants_1.WASI_ESUCCESS;
          }),
          fd_seek: wrap((fd, offset, whence, newOffsetPtr) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_SEEK);
            switch (this.refreshMemory(), whence) {
              case constants_1.WASI_WHENCE_CUR:
                stats.offset = (stats.offset ? stats.offset : BigInt(0)) + BigInt(offset);
                break;
              case constants_1.WASI_WHENCE_END:
                const { size } = this.fstatSync(stats.real);
                stats.offset = BigInt(size) + BigInt(offset);
                break;
              case constants_1.WASI_WHENCE_SET:
                stats.offset = BigInt(offset);
                break;
            }
            if (stats.offset == null)
              throw Error("stats.offset must be defined");
            return this.view.setBigUint64(newOffsetPtr, stats.offset, !0), constants_1.WASI_ESUCCESS;
          }),
          fd_tell: wrap((fd, offsetPtr) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_TELL);
            if (this.refreshMemory(), !stats.offset)
              stats.offset = BigInt(0);
            return this.view.setBigUint64(offsetPtr, stats.offset, !0), constants_1.WASI_ESUCCESS;
          }),
          fd_sync: wrap((fd) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_SYNC);
            return fs.fsyncSync(stats.real), constants_1.WASI_ESUCCESS;
          }),
          path_create_directory: wrap((fd, pathPtr, pathLen) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_CREATE_DIRECTORY);
            if (!stats.path)
              return constants_1.WASI_EINVAL;
            this.refreshMemory();
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
            return fs.mkdirSync(path.resolve(stats.path, p)), constants_1.WASI_ESUCCESS;
          }),
          path_filestat_get: wrap((fd, flags, pathPtr, pathLen, bufPtr) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_FILESTAT_GET);
            if (!stats.path)
              return constants_1.WASI_EINVAL;
            this.refreshMemory();
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
            let rstats;
            if (flags)
              rstats = fs.statSync(path.resolve(stats.path, p));
            else
              rstats = fs.lstatSync(path.resolve(stats.path, p));
            return this.view.setBigUint64(bufPtr, BigInt(rstats.dev), !0), bufPtr += 8, this.view.setBigUint64(bufPtr, BigInt(rstats.ino), !0), bufPtr += 8, this.view.setUint8(bufPtr, translateFileAttributes(this, void 0, rstats).filetype), bufPtr += 8, this.view.setBigUint64(bufPtr, BigInt(rstats.nlink), !0), bufPtr += 8, this.view.setBigUint64(bufPtr, BigInt(rstats.size), !0), bufPtr += 8, this.view.setBigUint64(bufPtr, BigInt(rstats.atime.getTime() * 1e6), !0), bufPtr += 8, this.view.setBigUint64(bufPtr, BigInt(rstats.mtime.getTime() * 1e6), !0), bufPtr += 8, this.view.setBigUint64(bufPtr, BigInt(rstats.ctime.getTime() * 1e6), !0), constants_1.WASI_ESUCCESS;
          }),
          path_filestat_set_times: wrap((fd, _dirflags, pathPtr, pathLen, stAtim, stMtim, fstflags) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_FILESTAT_SET_TIMES);
            if (!stats.path)
              return constants_1.WASI_EINVAL;
            this.refreshMemory();
            const rstats = this.fstatSync(stats.real);
            let { atime: atim, mtime: mtim } = rstats;
            const n = nsToMs(now(constants_1.WASI_CLOCK_REALTIME)), atimflags = constants_1.WASI_FILESTAT_SET_ATIM | constants_1.WASI_FILESTAT_SET_ATIM_NOW;
            if ((fstflags & atimflags) === atimflags)
              return constants_1.WASI_EINVAL;
            const mtimflags = constants_1.WASI_FILESTAT_SET_MTIM | constants_1.WASI_FILESTAT_SET_MTIM_NOW;
            if ((fstflags & mtimflags) === mtimflags)
              return constants_1.WASI_EINVAL;
            if ((fstflags & constants_1.WASI_FILESTAT_SET_ATIM) === constants_1.WASI_FILESTAT_SET_ATIM)
              atim = nsToMs(stAtim);
            else if ((fstflags & constants_1.WASI_FILESTAT_SET_ATIM_NOW) === constants_1.WASI_FILESTAT_SET_ATIM_NOW)
              atim = n;
            if ((fstflags & constants_1.WASI_FILESTAT_SET_MTIM) === constants_1.WASI_FILESTAT_SET_MTIM)
              mtim = nsToMs(stMtim);
            else if ((fstflags & constants_1.WASI_FILESTAT_SET_MTIM_NOW) === constants_1.WASI_FILESTAT_SET_MTIM_NOW)
              mtim = n;
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
            return fs.utimesSync(path.resolve(stats.path, p), new Date(atim), new Date(mtim)), constants_1.WASI_ESUCCESS;
          }),
          path_link: wrap((oldFd, _oldFlags, oldPath, oldPathLen, newFd, newPath, newPathLen) => {
            const ostats = CHECK_FD(oldFd, constants_1.WASI_RIGHT_PATH_LINK_SOURCE), nstats = CHECK_FD(newFd, constants_1.WASI_RIGHT_PATH_LINK_TARGET);
            if (!ostats.path || !nstats.path)
              return constants_1.WASI_EINVAL;
            this.refreshMemory();
            const op = Buffer.from(this.memory.buffer, oldPath, oldPathLen).toString(), np = Buffer.from(this.memory.buffer, newPath, newPathLen).toString();
            return fs.linkSync(path.resolve(ostats.path, op), path.resolve(nstats.path, np)), constants_1.WASI_ESUCCESS;
          }),
          path_open: wrap((dirfd, _dirflags, pathPtr, pathLen, oflags, fsRightsBase, fsRightsInheriting, fsFlags, fdPtr) => {
            try {
              const stats = CHECK_FD(dirfd, constants_1.WASI_RIGHT_PATH_OPEN);
              fsRightsBase = BigInt(fsRightsBase), fsRightsInheriting = BigInt(fsRightsInheriting);
              const read = (fsRightsBase & (constants_1.WASI_RIGHT_FD_READ | constants_1.WASI_RIGHT_FD_READDIR)) !== BigInt(0), write = (fsRightsBase & (constants_1.WASI_RIGHT_FD_DATASYNC | constants_1.WASI_RIGHT_FD_WRITE | constants_1.WASI_RIGHT_FD_ALLOCATE | constants_1.WASI_RIGHT_FD_FILESTAT_SET_SIZE)) !== BigInt(0);
              let noflags;
              if (write && read)
                noflags = nodeFsConstants.O_RDWR;
              else if (read)
                noflags = nodeFsConstants.O_RDONLY;
              else if (write)
                noflags = nodeFsConstants.O_WRONLY;
              let neededBase = fsRightsBase | constants_1.WASI_RIGHT_PATH_OPEN, neededInheriting = fsRightsBase | fsRightsInheriting;
              if ((oflags & constants_1.WASI_O_CREAT) !== 0)
                noflags |= nodeFsConstants.O_CREAT, neededBase |= constants_1.WASI_RIGHT_PATH_CREATE_FILE;
              if ((oflags & constants_1.WASI_O_DIRECTORY) !== 0)
                noflags |= nodeFsConstants.O_DIRECTORY;
              if ((oflags & constants_1.WASI_O_EXCL) !== 0)
                noflags |= nodeFsConstants.O_EXCL;
              if ((oflags & constants_1.WASI_O_TRUNC) !== 0)
                noflags |= nodeFsConstants.O_TRUNC, neededBase |= constants_1.WASI_RIGHT_PATH_FILESTAT_SET_SIZE;
              if ((fsFlags & constants_1.WASI_FDFLAG_APPEND) !== 0)
                noflags |= nodeFsConstants.O_APPEND;
              if ((fsFlags & constants_1.WASI_FDFLAG_DSYNC) !== 0) {
                if (nodeFsConstants.O_DSYNC)
                  noflags |= nodeFsConstants.O_DSYNC;
                else
                  noflags |= nodeFsConstants.O_SYNC;
                neededInheriting |= constants_1.WASI_RIGHT_FD_DATASYNC;
              }
              if ((fsFlags & constants_1.WASI_FDFLAG_NONBLOCK) !== 0)
                noflags |= nodeFsConstants.O_NONBLOCK;
              if ((fsFlags & constants_1.WASI_FDFLAG_RSYNC) !== 0) {
                if (nodeFsConstants.O_RSYNC)
                  noflags |= nodeFsConstants.O_RSYNC;
                else
                  noflags |= nodeFsConstants.O_SYNC;
                neededInheriting |= constants_1.WASI_RIGHT_FD_SYNC;
              }
              if ((fsFlags & constants_1.WASI_FDFLAG_SYNC) !== 0)
                noflags |= nodeFsConstants.O_SYNC, neededInheriting |= constants_1.WASI_RIGHT_FD_SYNC;
              if (write && (noflags & (nodeFsConstants.O_APPEND | nodeFsConstants.O_TRUNC)) === 0)
                neededInheriting |= constants_1.WASI_RIGHT_FD_SEEK;
              this.refreshMemory();
              const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
              if (p == "dev/tty")
                return this.view.setUint32(fdPtr, constants_1.WASI_STDIN_FILENO, !0), constants_1.WASI_ESUCCESS;
              if (logOpen("path_open", p), p.startsWith("proc/"))
                throw new types_1.WASIError(constants_1.WASI_EBADF);
              const fullUnresolved = path.resolve(p);
              let full;
              try {
                full = fs.realpathSync(fullUnresolved);
              } catch (e) {
                if (e?.code === "ENOENT")
                  full = fullUnresolved;
                else
                  throw e;
              }
              let isDirectory;
              if (write)
                try {
                  isDirectory = fs.statSync(full).isDirectory();
                } catch (_err) {
                }
              let realfd;
              if (!write && isDirectory)
                realfd = fs.openSync(full, nodeFsConstants.O_RDONLY);
              else
                realfd = fs.openSync(full, noflags);
              const newfd = this.getUnusedFileDescriptor();
              this.FD_MAP.set(newfd, {
                real: realfd,
                filetype: void 0,
                rights: {
                  base: neededBase,
                  inheriting: neededInheriting
                },
                path: full
              }), stat(this, newfd), this.view.setUint32(fdPtr, newfd, !0);
            } catch (e) {
              console.error(e);
            }
            return constants_1.WASI_ESUCCESS;
          }),
          path_readlink: wrap((fd, pathPtr, pathLen, buf, bufLen, bufused) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_READLINK);
            if (!stats.path)
              return constants_1.WASI_EINVAL;
            this.refreshMemory();
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString(), full = path.resolve(stats.path, p), r = fs.readlinkSync(full), used = Buffer.from(this.memory.buffer).write(r, buf, bufLen);
            return this.view.setUint32(bufused, used, !0), constants_1.WASI_ESUCCESS;
          }),
          path_remove_directory: wrap((fd, pathPtr, pathLen) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_REMOVE_DIRECTORY);
            if (!stats.path)
              return constants_1.WASI_EINVAL;
            this.refreshMemory();
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
            return fs.rmdirSync(path.resolve(stats.path, p)), constants_1.WASI_ESUCCESS;
          }),
          path_rename: wrap((oldFd, oldPath, oldPathLen, newFd, newPath, newPathLen) => {
            const ostats = CHECK_FD(oldFd, constants_1.WASI_RIGHT_PATH_RENAME_SOURCE), nstats = CHECK_FD(newFd, constants_1.WASI_RIGHT_PATH_RENAME_TARGET);
            if (!ostats.path || !nstats.path)
              return constants_1.WASI_EINVAL;
            this.refreshMemory();
            const op = Buffer.from(this.memory.buffer, oldPath, oldPathLen).toString(), np = Buffer.from(this.memory.buffer, newPath, newPathLen).toString();
            return fs.renameSync(path.resolve(ostats.path, op), path.resolve(nstats.path, np)), constants_1.WASI_ESUCCESS;
          }),
          path_symlink: wrap((oldPath, oldPathLen, fd, newPath, newPathLen) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_SYMLINK);
            if (!stats.path)
              return constants_1.WASI_EINVAL;
            this.refreshMemory();
            const op = Buffer.from(this.memory.buffer, oldPath, oldPathLen).toString(), np = Buffer.from(this.memory.buffer, newPath, newPathLen).toString();
            return fs.symlinkSync(op, path.resolve(stats.path, np)), constants_1.WASI_ESUCCESS;
          }),
          path_unlink_file: wrap((fd, pathPtr, pathLen) => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_UNLINK_FILE);
            if (!stats.path)
              return constants_1.WASI_EINVAL;
            this.refreshMemory();
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
            return fs.unlinkSync(path.resolve(stats.path, p)), constants_1.WASI_ESUCCESS;
          }),
          poll_oneoff: (sin, sout, nsubscriptions, neventsPtr) => {
            let nevents = 0, name = "", waitTimeNs = BigInt(0), fd = -1, fd_type = "read", fd_timeout_ms = 0;
            const startNs = BigInt(bindings2.hrtime());
            this.refreshMemory();
            let last_sin = sin;
            for (let i = 0;i < nsubscriptions; i += 1) {
              const userdata = this.view.getBigUint64(sin, !0);
              sin += 8;
              const type = this.view.getUint8(sin);
              if (sin += 1, sin += 7, log.enabled) {
                if (type == constants_1.WASI_EVENTTYPE_CLOCK)
                  name = "poll_oneoff (type=WASI_EVENTTYPE_CLOCK): ";
                else if (type == constants_1.WASI_EVENTTYPE_FD_READ)
                  name = "poll_oneoff (type=WASI_EVENTTYPE_FD_READ): ";
                else
                  name = "poll_oneoff (type=WASI_EVENTTYPE_FD_WRITE): ";
                log(name);
              }
              switch (type) {
                case constants_1.WASI_EVENTTYPE_CLOCK: {
                  const clockid = this.view.getUint32(sin, !0);
                  sin += 4, sin += 4;
                  const timeout = this.view.getBigUint64(sin, !0);
                  sin += 8, sin += 8;
                  const subclockflags = this.view.getUint16(sin, !0);
                  sin += 2, sin += 6;
                  const absolute = subclockflags === 1;
                  if (log.enabled)
                    log(name, { clockid, timeout, absolute });
                  if (!absolute)
                    fd_timeout_ms = timeout / BigInt(1e6);
                  let e = constants_1.WASI_ESUCCESS;
                  const t = now(clockid);
                  if (t == null)
                    e = constants_1.WASI_EINVAL;
                  else {
                    const tNS = BigInt(t), waitNs = (absolute ? timeout : tNS + timeout) - tNS;
                    if (waitNs > waitTimeNs)
                      waitTimeNs = waitNs;
                  }
                  this.view.setBigUint64(sout, userdata, !0), sout += 8, this.view.setUint16(sout, e, !0), sout += 2, this.view.setUint8(sout, constants_1.WASI_EVENTTYPE_CLOCK), sout += 1, sout += 5, nevents += 1;
                  break;
                }
                case constants_1.WASI_EVENTTYPE_FD_READ:
                case constants_1.WASI_EVENTTYPE_FD_WRITE: {
                  if (fd = this.view.getUint32(sin, !0), fd_type = type == constants_1.WASI_EVENTTYPE_FD_READ ? "read" : "write", sin += 4, log(name, "fd =", fd), sin += 28, this.view.setBigUint64(sout, userdata, !0), sout += 8, this.view.setUint16(sout, constants_1.WASI_ENOSYS, !0), sout += 2, this.view.setUint8(sout, type), sout += 1, sout += 5, nevents += 1, fd == constants_1.WASI_STDIN_FILENO && constants_1.WASI_EVENTTYPE_FD_READ == type)
                    this.shortPause();
                  break;
                }
                default:
                  return constants_1.WASI_EINVAL;
              }
              if (sin - last_sin != 48)
                console.warn("*** BUG in wasi-js in poll_oneoff ", {
                  i,
                  sin,
                  last_sin,
                  diff: sin - last_sin
                });
              last_sin = sin;
            }
            if (this.view.setUint32(neventsPtr, nevents, !0), nevents == 2 && fd >= 0) {
              const r = this.wasiImport.sock_pollSocket(fd, fd_type, fd_timeout_ms);
              if (r != constants_1.WASI_ENOSYS)
                return r;
            }
            if (waitTimeNs > 0) {
              if (waitTimeNs -= Bun.nanoseconds() - timeOrigin, waitTimeNs >= 1e6) {
                if (this.sleep == null && !warnedAboutSleep)
                  warnedAboutSleep = !0, console.log("(100% cpu burning waiting for stdin: please define a way to sleep!) ");
                if (this.sleep != null) {
                  const ms = nsToMs(waitTimeNs);
                  this.sleep(ms);
                } else {
                  const end = BigInt(bindings2.hrtime()) + waitTimeNs;
                  while (BigInt(bindings2.hrtime()) < end)
                    ;
                }
              }
            }
            return constants_1.WASI_ESUCCESS;
          },
          proc_exit: (rval) => {
            return bindings2.exit(rval), constants_1.WASI_ESUCCESS;
          },
          proc_raise: (sig) => {
            if (!(sig in constants_1.SIGNAL_MAP))
              return constants_1.WASI_EINVAL;
            return bindings2.kill(constants_1.SIGNAL_MAP[sig]), constants_1.WASI_ESUCCESS;
          },
          random_get: (bufPtr, bufLen) => {
            return this.refreshMemory(), crypto.getRandomValues(this.memory.buffer, bufPtr, bufLen), bufLen;
          },
          sched_yield() {
            return constants_1.WASI_ESUCCESS;
          },
          sock_recv() {
            return constants_1.WASI_ENOSYS;
          },
          sock_send() {
            return constants_1.WASI_ENOSYS;
          },
          sock_shutdown() {
            return constants_1.WASI_ENOSYS;
          },
          sock_fcntlSetFlags(_fd, _flags) {
            return constants_1.WASI_ENOSYS;
          },
          sock_pollSocket(_fd, _eventtype, _timeout_ms) {
            return constants_1.WASI_ENOSYS;
          }
        }, log.enabled)
          Object.keys(this.wasiImport).forEach((key) => {
            const prevImport = this.wasiImport[key];
            this.wasiImport[key] = function(...args2) {
              log(key, args2);
              try {
                let result = prevImport(...args2);
                return log("result", result), result;
              } catch (e) {
                throw log("error: ", e), e;
              }
            };
          });
      }
      getState() {
        return { env: this.env, FD_MAP: this.FD_MAP, bindings };
      }
      setState(state) {
        this.env = state.env, this.FD_MAP = state.FD_MAP, bindings = state.bindings;
      }
      fstatSync(real_fd) {
        if (real_fd <= 2)
          try {
            return fs.fstatSync(real_fd);
          } catch (_) {
            const now = new Date;
            return {
              dev: 0,
              mode: 8592,
              nlink: 1,
              uid: 0,
              gid: 0,
              rdev: 0,
              blksize: 65536,
              ino: 0,
              size: 0,
              blocks: 0,
              atimeMs: now.valueOf(),
              mtimeMs: now.valueOf(),
              ctimeMs: now.valueOf(),
              birthtimeMs: 0,
              atime: new Date,
              mtime: new Date,
              ctime: new Date,
              birthtime: new Date(0)
            };
          }
        return fs.fstatSync(real_fd);
      }
      shortPause() {
        if (this.sleep == null)
          return;
        if ((new Date()).valueOf() - this.lastStdin > 2000)
          this.sleep(50);
      }
      getUnusedFileDescriptor(start = 3) {
        let fd = start;
        while (this.FD_MAP.has(fd))
          fd += 1;
        if (fd > SC_OPEN_MAX)
          throw Error("no available file descriptors");
        return fd;
      }
      refreshMemory() {
        if (!this.view || this.view.buffer.byteLength === 0)
          this.view = new DataView(this.memory.buffer);
      }
      setMemory(memory) {
        this.memory = memory;
      }
      start(instance, memory) {
        const exports2 = instance.exports;
        if (exports2 === null || typeof exports2 !== "object")
          throw new Error(`instance.exports must be an Object. Received ${exports2}.`);
        if (memory == null) {
          if (memory = exports2.memory, !(memory instanceof WebAssembly.Memory))
            throw new Error(`instance.exports.memory must be a WebAssembly.Memory. Recceived ${memory}.`);
        }
        if (this.setMemory(memory), exports2._start)
          exports2._start();
      }
      getImports(module2) {
        let namespace = null;
        const imports = WebAssembly.Module.imports(module2);
        for (let imp of imports) {
          if (imp.kind !== "function")
            continue;
          if (!imp.module.startsWith("wasi_"))
            continue;
          namespace = imp.module;
          break;
        }
        switch (namespace) {
          case "wasi_unstable":
            return {
              wasi_unstable: this.wasiImport
            };
          case "wasi_snapshot_preview1":
            return {
              wasi_snapshot_preview1: this.wasiImport
            };
          default:
            throw new Error("No WASI namespace found. Only wasi_unstable and wasi_snapshot_preview1 are supported.\n\nList of imports:\n\n" + imports.map(({ name, kind, module }) => `${module}:${name} (${kind})`).join("\n") + "\n");
        }
      }
      initWasiFdInfo() {
        if (this.env["WASI_FD_INFO"] != null) {
          const fdInfo = JSON.parse(this.env["WASI_FD_INFO"]);
          for (let wasi_fd in fdInfo) {
            console.log(wasi_fd);
            const fd = parseInt(wasi_fd);
            if (this.FD_MAP.has(fd))
              continue;
            const real = fdInfo[wasi_fd];
            try {
              this.fstatSync(real);
            } catch (_err) {
              console.log("discarding ", { wasi_fd, real });
              continue;
            }
            const file = {
              real,
              filetype: constants_1.WASI_FILETYPE_SOCKET_STREAM,
              rights: {
                base: STDIN_DEFAULT_RIGHTS,
                inheriting: BigInt(0)
              }
            };
            this.FD_MAP.set(fd, file);
          }
          console.log("after initWasiFdInfo: ", this.FD_MAP), console.log("fdInfo = ", fdInfo);
        } else
          console.log("no WASI_FD_INFO");
      }
    };
    exports.default = WASI;
  }
}), WASIExport = require_wasi(), WASI = WASIExport.default;
WASIExport[Symbol.for("CommonJS")] = 0;
var wasi_default = WASIExport;
export {
  wasi_default as default,
  WASIExport as WASI
};
