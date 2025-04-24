// Hardcoded module "node:wasi"
// HUGE thanks to:
// - @williamstein and https://github.com/sagemathinc/cowasm/tree/main/core/wasi-js
// - @syrusakbary for wasmer-js https://github.com/wasmerio/wasmer-js
// - Gus Caplan for node-wasi https://github.com/devsnek/node-wasi
//
// Eventually we will implement this in native code, but this is just a quick hack to get WASI working.

// Define local types since this file implements "node:wasi"
interface WASIBindings {
  /** Synchronously fill a buffer with random data */
  randomFillSync(buffer: Uint8Array): void;
  /** Get high-resolution time */
  hrtime(time?: bigint): bigint;
  /** Exit the process */
  exit(code: number): never;
  /** Send a signal to the process */
  kill(signal: string): never;
  /** Check if a file descriptor is a TTY */
  isTTY(fd: number): boolean;
  /** Node.js fs module */
  fs: typeof import("node:fs");
  /** Node.js path module */
  path: typeof import("node:path");
}

interface WASIConfig {
  /** Command line arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Preopened directories */
  preopens?: Record<string, string>;
  /** Bindings for system calls */
  bindings?: WASIBindings;
  /** Function to sleep for a duration (ms) */
  sleep?: (ms: number) => void;
  /** Function to get stdin data */
  getStdin?: () => Buffer | undefined;
  /** Function to send stdout data */
  sendStdout?: (data: Uint8Array) => void;
  /** Function to send stderr data */
  sendStderr?: (data: Uint8Array) => void;
}

type WASIFileDescriptor = {
  real: number;
  filetype?: number;
  rights: {
    base: bigint;
    inheriting: bigint;
  };
  path?: string;
  fakePath?: string;
  offset?: bigint;
};

interface WASIState {
  env: Record<string, string>;
  FD_MAP: Map<number, WASIFileDescriptor>;
  bindings: WASIBindings;
}

import type { PathLike, Stats, StatOptions } from "node:fs";
import type { InspectOptions } from "node-inspect-extracted";

const nodeFsConstants = $processBindingConstants.fs;

var __getOwnPropNames = Object.getOwnPropertyNames;

var __commonJS = (cb, mod: { exports: any } | undefined = undefined) =>
  function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod!.exports;
  };

// node_modules/wasi-js/dist/types.js
var require_types = __commonJS({
  "node_modules/wasi-js/dist/types.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.WASIKillError = exports.WASIExitError = exports.WASIError = void 0;
    var WASIError = class extends Error {
      errno: number;
      constructor(errno) {
        super();
        this.errno = errno;
        Object.setPrototypeOf(this, WASIError.prototype);
      }
    };
    exports.WASIError = WASIError;
    var WASIExitError = class extends Error {
      exitCode: number; // Renamed from 'code' to avoid conflict with Error.code
      constructor(code) {
        super(`WASI Exit error: ${code}`);
        this.exitCode = code;
        Object.setPrototypeOf(this, WASIExitError.prototype);
      }
    };
    exports.WASIExitError = WASIExitError;
    var WASIKillError = class extends Error {
      signal: string;
      constructor(signal) {
        super(`WASI Kill signal: ${signal}`);
        this.signal = signal;
        Object.setPrototypeOf(this, WASIKillError.prototype);
      }
    };
    exports.WASIKillError = WASIKillError;
  },
});

// node_modules/wasi-js/dist/constants.js
var require_constants = __commonJS({
  "node_modules/wasi-js/dist/constants.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.WASI_ENOMSG =
      exports.WASI_ENOMEM =
      exports.WASI_ENOLINK =
      exports.WASI_ENOLCK =
      exports.WASI_ENOEXEC =
      exports.WASI_ENOENT =
      exports.WASI_ENODEV =
      exports.WASI_ENOBUFS =
      exports.WASI_ENFILE =
      exports.WASI_ENETUNREACH =
      exports.WASI_ENETRESET =
      exports.WASI_ENETDOWN =
      exports.WASI_ENAMETOOLONG =
      exports.WASI_EMULTIHOP =
      exports.WASI_EMSGSIZE =
      exports.WASI_EMLINK =
      exports.WASI_EMFILE =
      exports.WASI_ELOOP =
      exports.WASI_EISDIR =
      exports.WASI_EISCONN =
      exports.WASI_EIO =
      exports.WASI_EINVAL =
      exports.WASI_EINTR =
      exports.WASI_EINPROGRESS =
      exports.WASI_EILSEQ =
      exports.WASI_EIDRM =
      exports.WASI_EHOSTUNREACH =
      exports.WASI_EFBIG =
      exports.WASI_EFAULT =
      exports.WASI_EEXIST =
      exports.WASI_EDQUOT =
      exports.WASI_EDOM =
      exports.WASI_EDESTADDRREQ =
      exports.WASI_EDEADLK =
      exports.WASI_ECONNRESET =
      exports.WASI_ECONNREFUSED =
      exports.WASI_ECONNABORTED =
      exports.WASI_ECHILD =
      exports.WASI_ECANCELED =
      exports.WASI_EBUSY =
      exports.WASI_EBADMSG =
      exports.WASI_EBADF =
      exports.WASI_EALREADY =
      exports.WASI_EAGAIN =
      exports.WASI_EAFNOSUPPORT =
      exports.WASI_EADDRNOTAVAIL =
      exports.WASI_EADDRINUSE =
      exports.WASI_EACCES =
      exports.WASI_E2BIG =
      exports.WASI_ESUCCESS =
        void 0;
    exports.WASI_SIGVTALRM =
      exports.WASI_SIGUSR2 =
      exports.WASI_SIGUSR1 =
      exports.WASI_SIGURG =
      exports.WASI_SIGTTOU =
      exports.WASI_SIGTTIN =
      exports.WASI_SIGTSTP =
      exports.WASI_SIGTRAP =
      exports.WASI_SIGTERM =
      exports.WASI_SIGSTOP =
      exports.WASI_SIGSEGV =
      exports.WASI_SIGQUIT =
      exports.WASI_SIGPIPE =
      exports.WASI_SIGKILL =
      exports.WASI_SIGINT =
      exports.WASI_SIGILL =
      exports.WASI_SIGHUP =
      exports.WASI_SIGFPE =
      exports.WASI_SIGCONT =
      exports.WASI_SIGCHLD =
      exports.WASI_SIGBUS =
      exports.WASI_SIGALRM =
      exports.WASI_SIGABRT =
      exports.WASI_ENOTCAPABLE =
      exports.WASI_EXDEV =
      exports.WASI_ETXTBSY =
      exports.WASI_ETIMEDOUT =
      exports.WASI_ESTALE =
      exports.WASI_ESRCH =
      exports.WASI_ESPIPE =
      exports.WASI_EROFS =
      exports.WASI_ERANGE =
      exports.WASI_EPROTOTYPE =
      exports.WASI_EPROTONOSUPPORT =
      exports.WASI_EPROTO =
      exports.WASI_EPIPE =
      exports.WASI_EPERM =
      exports.WASI_EOWNERDEAD =
      exports.WASI_EOVERFLOW =
      exports.WASI_ENXIO =
      exports.WASI_ENOTTY =
      exports.WASI_ENOTSUP =
      exports.WASI_ENOTSOCK =
      exports.WASI_ENOTRECOVERABLE =
      exports.WASI_ENOTEMPTY =
      exports.WASI_ENOTDIR =
      exports.WASI_ENOTCONN =
      exports.WASI_ENOSYS =
      exports.WASI_ENOSPC =
      exports.WASI_ENOPROTOOPT =
        void 0;
    exports.RIGHTS_REGULAR_FILE_BASE =
      exports.RIGHTS_CHARACTER_DEVICE_INHERITING =
      exports.RIGHTS_CHARACTER_DEVICE_BASE =
      exports.RIGHTS_BLOCK_DEVICE_INHERITING =
      exports.RIGHTS_BLOCK_DEVICE_BASE =
      exports.RIGHTS_ALL =
      exports.WASI_RIGHT_SOCK_SHUTDOWN =
      exports.WASI_RIGHT_POLL_FD_READWRITE =
      exports.WASI_RIGHT_PATH_UNLINK_FILE =
      exports.WASI_RIGHT_PATH_REMOVE_DIRECTORY =
      exports.WASI_RIGHT_PATH_SYMLINK =
      exports.WASI_RIGHT_FD_FILESTAT_SET_TIMES =
      exports.WASI_RIGHT_FD_FILESTAT_SET_SIZE =
      exports.WASI_RIGHT_FD_FILESTAT_GET =
      exports.WASI_RIGHT_PATH_FILESTAT_SET_TIMES =
      exports.WASI_RIGHT_PATH_FILESTAT_SET_SIZE =
      exports.WASI_RIGHT_PATH_FILESTAT_GET =
      exports.WASI_RIGHT_PATH_RENAME_TARGET =
      exports.WASI_RIGHT_PATH_RENAME_SOURCE =
      exports.WASI_RIGHT_PATH_READLINK =
      exports.WASI_RIGHT_FD_READDIR =
      exports.WASI_RIGHT_PATH_OPEN =
      exports.WASI_RIGHT_PATH_LINK_TARGET =
      exports.WASI_RIGHT_PATH_LINK_SOURCE =
      exports.WASI_RIGHT_PATH_CREATE_FILE =
      exports.WASI_RIGHT_PATH_CREATE_DIRECTORY =
      exports.WASI_RIGHT_FD_ALLOCATE =
      exports.WASI_RIGHT_FD_ADVISE =
      exports.WASI_RIGHT_FD_WRITE =
      exports.WASI_RIGHT_FD_TELL =
      exports.WASI_RIGHT_FD_SYNC =
      exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS =
      exports.WASI_RIGHT_FD_SEEK =
      exports.WASI_RIGHT_FD_READ =
      exports.WASI_RIGHT_FD_DATASYNC =
      exports.WASI_FDFLAG_SYNC =
      exports.WASI_FDFLAG_RSYNC =
      exports.WASI_FDFLAG_NONBLOCK =
      exports.WASI_FDFLAG_DSYNC =
      exports.WASI_FDFLAG_APPEND =
      exports.WASI_FILETYPE_SYMBOLIC_LINK =
      exports.WASI_FILETYPE_SOCKET_STREAM =
      exports.WASI_FILETYPE_SOCKET_DGRAM =
      exports.WASI_FILETYPE_REGULAR_FILE =
      exports.WASI_FILETYPE_DIRECTORY =
      exports.WASI_FILETYPE_CHARACTER_DEVICE =
      exports.WASI_FILETYPE_BLOCK_DEVICE =
      exports.WASI_FILETYPE_UNKNOWN =
      exports.WASI_SIGXFSZ =
      exports.WASI_SIGXCPU =
        void 0;
    exports.SIGNAL_MAP =
      exports.ERROR_MAP =
      exports.WASI_WHENCE_END =
      exports.WASI_WHENCE_CUR =
      exports.WASI_WHENCE_SET =
      exports.WASI_STDERR_FILENO =
      exports.WASI_STDOUT_FILENO =
      exports.WASI_STDIN_FILENO =
      exports.WASI_DIRCOOKIE_START =
      exports.WASI_PREOPENTYPE_DIR =
      exports.WASI_O_TRUNC =
      exports.WASI_O_EXCL =
      exports.WASI_O_DIRECTORY =
      exports.WASI_O_CREAT =
      exports.WASI_FILESTAT_SET_MTIM_NOW =
      exports.WASI_FILESTAT_SET_MTIM =
      exports.WASI_FILESTAT_SET_ATIM_NOW =
      exports.WASI_FILESTAT_SET_ATIM =
      exports.WASI_EVENTTYPE_FD_WRITE =
      exports.WASI_EVENTTYPE_FD_READ =
      exports.WASI_EVENTTYPE_CLOCK =
      exports.WASI_CLOCK_THREAD_CPUTIME_ID =
      exports.WASI_CLOCK_PROCESS_CPUTIME_ID =
      exports.WASI_CLOCK_MONOTONIC =
      exports.WASI_CLOCK_REALTIME =
      exports.RIGHTS_TTY_INHERITING =
      exports.RIGHTS_TTY_BASE =
      exports.RIGHTS_SOCKET_INHERITING =
      exports.RIGHTS_SOCKET_BASE =
      exports.RIGHTS_DIRECTORY_INHERITING =
      exports.RIGHTS_DIRECTORY_BASE =
      exports.RIGHTS_REGULAR_FILE_INHERITING =
        void 0;
    exports.WASI_ESUCCESS = 0;
    exports.WASI_E2BIG = 1;
    exports.WASI_EACCES = 2;
    exports.WASI_EADDRINUSE = 3;
    exports.WASI_EADDRNOTAVAIL = 4;
    exports.WASI_EAFNOSUPPORT = 5;
    exports.WASI_EAGAIN = 6;
    exports.WASI_EALREADY = 7;
    exports.WASI_EBADF = 8;
    exports.WASI_EBADMSG = 9;
    exports.WASI_EBUSY = 10;
    exports.WASI_ECANCELED = 11;
    exports.WASI_ECHILD = 12;
    exports.WASI_ECONNABORTED = 13;
    exports.WASI_ECONNREFUSED = 14;
    exports.WASI_ECONNRESET = 15;
    exports.WASI_EDEADLK = 16;
    exports.WASI_EDESTADDRREQ = 17;
    exports.WASI_EDOM = 18;
    exports.WASI_EDQUOT = 19;
    exports.WASI_EEXIST = 20;
    exports.WASI_EFAULT = 21;
    exports.WASI_EFBIG = 22;
    exports.WASI_EHOSTUNREACH = 23;
    exports.WASI_EIDRM = 24;
    exports.WASI_EILSEQ = 25;
    exports.WASI_EINPROGRESS = 26;
    exports.WASI_EINTR = 27;
    exports.WASI_EINVAL = 28;
    exports.WASI_EIO = 29;
    exports.WASI_EISCONN = 30;
    exports.WASI_EISDIR = 31;
    exports.WASI_ELOOP = 32;
    exports.WASI_EMFILE = 33;
    exports.WASI_EMLINK = 34;
    exports.WASI_EMSGSIZE = 35;
    exports.WASI_EMULTIHOP = 36;
    exports.WASI_ENAMETOOLONG = 37;
    exports.WASI_ENETDOWN = 38;
    exports.WASI_ENETRESET = 39;
    exports.WASI_ENETUNREACH = 40;
    exports.WASI_ENFILE = 41;
    exports.WASI_ENOBUFS = 42;
    exports.WASI_ENODEV = 43;
    exports.WASI_ENOENT = 44;
    exports.WASI_ENOEXEC = 45;
    exports.WASI_ENOLCK = 46;
    exports.WASI_ENOLINK = 47;
    exports.WASI_ENOMEM = 48;
    exports.WASI_ENOMSG = 49;
    exports.WASI_ENOPROTOOPT = 50;
    exports.WASI_ENOSPC = 51;
    exports.WASI_ENOSYS = 52;
    exports.WASI_ENOTCONN = 53;
    exports.WASI_ENOTDIR = 54;
    exports.WASI_ENOTEMPTY = 55;
    exports.WASI_ENOTRECOVERABLE = 56;
    exports.WASI_ENOTSOCK = 57;
    exports.WASI_ENOTSUP = 58;
    exports.WASI_ENOTTY = 59;
    exports.WASI_ENXIO = 60;
    exports.WASI_EOVERFLOW = 61;
    exports.WASI_EOWNERDEAD = 62;
    exports.WASI_EPERM = 63;
    exports.WASI_EPIPE = 64;
    exports.WASI_EPROTO = 65;
    exports.WASI_EPROTONOSUPPORT = 66;
    exports.WASI_EPROTOTYPE = 67;
    exports.WASI_ERANGE = 68;
    exports.WASI_EROFS = 69;
    exports.WASI_ESPIPE = 70;
    exports.WASI_ESRCH = 71;
    exports.WASI_ESTALE = 72;
    exports.WASI_ETIMEDOUT = 73;
    exports.WASI_ETXTBSY = 74;
    exports.WASI_EXDEV = 75;
    exports.WASI_ENOTCAPABLE = 76;
    exports.WASI_SIGABRT = 0;
    exports.WASI_SIGALRM = 1;
    exports.WASI_SIGBUS = 2;
    exports.WASI_SIGCHLD = 3;
    exports.WASI_SIGCONT = 4;
    exports.WASI_SIGFPE = 5;
    exports.WASI_SIGHUP = 6;
    exports.WASI_SIGILL = 7;
    exports.WASI_SIGINT = 8;
    exports.WASI_SIGKILL = 9;
    exports.WASI_SIGPIPE = 10;
    exports.WASI_SIGQUIT = 11;
    exports.WASI_SIGSEGV = 12;
    exports.WASI_SIGSTOP = 13;
    exports.WASI_SIGTERM = 14;
    exports.WASI_SIGTRAP = 15;
    exports.WASI_SIGTSTP = 16;
    exports.WASI_SIGTTIN = 17;
    exports.WASI_SIGTTOU = 18;
    exports.WASI_SIGURG = 19;
    exports.WASI_SIGUSR1 = 20;
    exports.WASI_SIGUSR2 = 21;
    exports.WASI_SIGVTALRM = 22;
    exports.WASI_SIGXCPU = 23;
    exports.WASI_SIGXFSZ = 24;
    exports.WASI_FILETYPE_UNKNOWN = 0;
    exports.WASI_FILETYPE_BLOCK_DEVICE = 1;
    exports.WASI_FILETYPE_CHARACTER_DEVICE = 2;
    exports.WASI_FILETYPE_DIRECTORY = 3;
    exports.WASI_FILETYPE_REGULAR_FILE = 4;
    exports.WASI_FILETYPE_SOCKET_DGRAM = 5;
    exports.WASI_FILETYPE_SOCKET_STREAM = 6;
    exports.WASI_FILETYPE_SYMBOLIC_LINK = 7;
    exports.WASI_FDFLAG_APPEND = 1;
    exports.WASI_FDFLAG_DSYNC = 2;
    exports.WASI_FDFLAG_NONBLOCK = 4;
    exports.WASI_FDFLAG_RSYNC = 8;
    exports.WASI_FDFLAG_SYNC = 16;
    exports.WASI_RIGHT_FD_DATASYNC = BigInt(1);
    exports.WASI_RIGHT_FD_READ = BigInt(2);
    exports.WASI_RIGHT_FD_SEEK = BigInt(4);
    exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS = BigInt(8);
    exports.WASI_RIGHT_FD_SYNC = BigInt(16);
    exports.WASI_RIGHT_FD_TELL = BigInt(32);
    exports.WASI_RIGHT_FD_WRITE = BigInt(64);
    exports.WASI_RIGHT_FD_ADVISE = BigInt(128);
    exports.WASI_RIGHT_FD_ALLOCATE = BigInt(256);
    exports.WASI_RIGHT_PATH_CREATE_DIRECTORY = BigInt(512);
    exports.WASI_RIGHT_PATH_CREATE_FILE = BigInt(1024);
    exports.WASI_RIGHT_PATH_LINK_SOURCE = BigInt(2048);
    exports.WASI_RIGHT_PATH_LINK_TARGET = BigInt(4096);
    exports.WASI_RIGHT_PATH_OPEN = BigInt(8192);
    exports.WASI_RIGHT_FD_READDIR = BigInt(16384);
    exports.WASI_RIGHT_PATH_READLINK = BigInt(32768);
    exports.WASI_RIGHT_PATH_RENAME_SOURCE = BigInt(65536);
    exports.WASI_RIGHT_PATH_RENAME_TARGET = BigInt(131072);
    exports.WASI_RIGHT_PATH_FILESTAT_GET = BigInt(262144);
    exports.WASI_RIGHT_PATH_FILESTAT_SET_SIZE = BigInt(524288);
    exports.WASI_RIGHT_PATH_FILESTAT_SET_TIMES = BigInt(1048576);
    exports.WASI_RIGHT_FD_FILESTAT_GET = BigInt(2097152);
    exports.WASI_RIGHT_FD_FILESTAT_SET_SIZE = BigInt(4194304);
    exports.WASI_RIGHT_FD_FILESTAT_SET_TIMES = BigInt(8388608);
    exports.WASI_RIGHT_PATH_SYMLINK = BigInt(16777216);
    exports.WASI_RIGHT_PATH_REMOVE_DIRECTORY = BigInt(33554432);
    exports.WASI_RIGHT_PATH_UNLINK_FILE = BigInt(67108864);
    exports.WASI_RIGHT_POLL_FD_READWRITE = BigInt(134217728);
    exports.WASI_RIGHT_SOCK_SHUTDOWN = BigInt(268435456);
    exports.RIGHTS_ALL =
      exports.WASI_RIGHT_FD_DATASYNC |
      exports.WASI_RIGHT_FD_READ |
      exports.WASI_RIGHT_FD_SEEK |
      exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS |
      exports.WASI_RIGHT_FD_SYNC |
      exports.WASI_RIGHT_FD_TELL |
      exports.WASI_RIGHT_FD_WRITE |
      exports.WASI_RIGHT_FD_ADVISE |
      exports.WASI_RIGHT_FD_ALLOCATE |
      exports.WASI_RIGHT_PATH_CREATE_DIRECTORY |
      exports.WASI_RIGHT_PATH_CREATE_FILE |
      exports.WASI_RIGHT_PATH_LINK_SOURCE |
      exports.WASI_RIGHT_PATH_LINK_TARGET |
      exports.WASI_RIGHT_PATH_OPEN |
      exports.WASI_RIGHT_FD_READDIR |
      exports.WASI_RIGHT_PATH_READLINK |
      exports.WASI_RIGHT_PATH_RENAME_SOURCE |
      exports.WASI_RIGHT_PATH_RENAME_TARGET |
      exports.WASI_RIGHT_PATH_FILESTAT_GET |
      exports.WASI_RIGHT_PATH_FILESTAT_SET_SIZE |
      exports.WASI_RIGHT_PATH_FILESTAT_SET_TIMES |
      exports.WASI_RIGHT_FD_FILESTAT_GET |
      exports.WASI_RIGHT_FD_FILESTAT_SET_TIMES |
      exports.WASI_RIGHT_FD_FILESTAT_SET_SIZE |
      exports.WASI_RIGHT_PATH_SYMLINK |
      exports.WASI_RIGHT_PATH_UNLINK_FILE |
      exports.WASI_RIGHT_PATH_REMOVE_DIRECTORY |
      exports.WASI_RIGHT_POLL_FD_READWRITE |
      exports.WASI_RIGHT_SOCK_SHUTDOWN;
    exports.RIGHTS_BLOCK_DEVICE_BASE = exports.RIGHTS_ALL;
    exports.RIGHTS_BLOCK_DEVICE_INHERITING = exports.RIGHTS_ALL;
    exports.RIGHTS_CHARACTER_DEVICE_BASE = exports.RIGHTS_ALL;
    exports.RIGHTS_CHARACTER_DEVICE_INHERITING = exports.RIGHTS_ALL;
    exports.RIGHTS_REGULAR_FILE_BASE =
      exports.WASI_RIGHT_FD_DATASYNC |
      exports.WASI_RIGHT_FD_READ |
      exports.WASI_RIGHT_FD_SEEK |
      exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS |
      exports.WASI_RIGHT_FD_SYNC |
      exports.WASI_RIGHT_FD_TELL |
      exports.WASI_RIGHT_FD_WRITE |
      exports.WASI_RIGHT_FD_ADVISE |
      exports.WASI_RIGHT_FD_ALLOCATE |
      exports.WASI_RIGHT_FD_FILESTAT_GET |
      exports.WASI_RIGHT_FD_FILESTAT_SET_SIZE |
      exports.WASI_RIGHT_FD_FILESTAT_SET_TIMES |
      exports.WASI_RIGHT_POLL_FD_READWRITE;
    exports.RIGHTS_REGULAR_FILE_INHERITING = BigInt(0);
    exports.RIGHTS_DIRECTORY_BASE =
      exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS |
      exports.WASI_RIGHT_FD_SYNC |
      exports.WASI_RIGHT_FD_ADVISE |
      exports.WASI_RIGHT_PATH_CREATE_DIRECTORY |
      exports.WASI_RIGHT_PATH_CREATE_FILE |
      exports.WASI_RIGHT_PATH_LINK_SOURCE |
      exports.WASI_RIGHT_PATH_LINK_TARGET |
      exports.WASI_RIGHT_PATH_OPEN |
      exports.WASI_RIGHT_FD_READDIR |
      exports.WASI_RIGHT_PATH_READLINK |
      exports.WASI_RIGHT_PATH_RENAME_SOURCE |
      exports.WASI_RIGHT_PATH_RENAME_TARGET |
      exports.WASI_RIGHT_PATH_FILESTAT_GET |
      exports.WASI_RIGHT_PATH_FILESTAT_SET_SIZE |
      exports.WASI_RIGHT_PATH_FILESTAT_SET_TIMES |
      exports.WASI_RIGHT_FD_FILESTAT_GET |
      exports.WASI_RIGHT_FD_FILESTAT_SET_TIMES |
      exports.WASI_RIGHT_PATH_SYMLINK |
      exports.WASI_RIGHT_PATH_UNLINK_FILE |
      exports.WASI_RIGHT_PATH_REMOVE_DIRECTORY |
      exports.WASI_RIGHT_POLL_FD_READWRITE;
    exports.RIGHTS_DIRECTORY_INHERITING = exports.RIGHTS_DIRECTORY_BASE | exports.RIGHTS_REGULAR_FILE_BASE;
    exports.RIGHTS_SOCKET_BASE =
      exports.WASI_RIGHT_FD_READ |
      exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS |
      exports.WASI_RIGHT_FD_WRITE |
      exports.WASI_RIGHT_FD_FILESTAT_GET |
      exports.WASI_RIGHT_POLL_FD_READWRITE |
      exports.WASI_RIGHT_SOCK_SHUTDOWN;
    exports.RIGHTS_SOCKET_INHERITING = exports.RIGHTS_ALL;
    exports.RIGHTS_TTY_BASE =
      exports.WASI_RIGHT_FD_READ |
      exports.WASI_RIGHT_FD_FDSTAT_SET_FLAGS |
      exports.WASI_RIGHT_FD_WRITE |
      exports.WASI_RIGHT_FD_FILESTAT_GET |
      exports.WASI_RIGHT_POLL_FD_READWRITE;
    exports.RIGHTS_TTY_INHERITING = BigInt(0);
    exports.WASI_CLOCK_REALTIME = 0;
    exports.WASI_CLOCK_MONOTONIC = 1;
    exports.WASI_CLOCK_PROCESS_CPUTIME_ID = 2;
    exports.WASI_CLOCK_THREAD_CPUTIME_ID = 3;
    exports.WASI_EVENTTYPE_CLOCK = 0;
    exports.WASI_EVENTTYPE_FD_READ = 1;
    exports.WASI_EVENTTYPE_FD_WRITE = 2;
    exports.WASI_FILESTAT_SET_ATIM = 1 << 0;
    exports.WASI_FILESTAT_SET_ATIM_NOW = 1 << 1;
    exports.WASI_FILESTAT_SET_MTIM = 1 << 2;
    exports.WASI_FILESTAT_SET_MTIM_NOW = 1 << 3;
    exports.WASI_O_CREAT = 1 << 0;
    exports.WASI_O_DIRECTORY = 1 << 1;
    exports.WASI_O_EXCL = 1 << 2;
    exports.WASI_O_TRUNC = 1 << 3;
    exports.WASI_PREOPENTYPE_DIR = 0;
    exports.WASI_DIRCOOKIE_START = 0;
    exports.WASI_STDIN_FILENO = 0;
    exports.WASI_STDOUT_FILENO = 1;
    exports.WASI_STDERR_FILENO = 2;
    exports.WASI_WHENCE_SET = 0;
    exports.WASI_WHENCE_CUR = 1;
    exports.WASI_WHENCE_END = 2;
    exports.ERROR_MAP = {
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
      EXDEV: exports.WASI_EXDEV,
    };
    exports.SIGNAL_MAP = {
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
      [exports.WASI_SIGVTALRM]: "SIGVTALRM",
    };
  },
});

// node_modules/wasi-js/dist/wasi.js
var require_wasi = __commonJS({
  "node_modules/wasi-js/dist/wasi.js"(exports) {
    var __importDefault =
      (exports && exports.__importDefault) ||
      function (mod) {
        return mod && mod.__esModule ? mod : { default: mod };
      };
    let fs: WASIBindings["fs"];
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SOCKET_DEFAULT_RIGHTS = void 0;
    var log: any = () => {};
    log.enabled = false;
    var logOpen = () => {};
    var SC_OPEN_MAX = 32768;
    var types_1 = require_types();

    var constants_1 = require_constants();
    var STDIN_DEFAULT_RIGHTS =
      constants_1.WASI_RIGHT_FD_DATASYNC |
      constants_1.WASI_RIGHT_FD_READ |
      constants_1.WASI_RIGHT_FD_SYNC |
      constants_1.WASI_RIGHT_FD_ADVISE |
      constants_1.WASI_RIGHT_FD_FILESTAT_GET |
      constants_1.WASI_RIGHT_POLL_FD_READWRITE;
    var STDOUT_DEFAULT_RIGHTS =
      constants_1.WASI_RIGHT_FD_DATASYNC |
      constants_1.WASI_RIGHT_FD_WRITE |
      constants_1.WASI_RIGHT_FD_SYNC |
      constants_1.WASI_RIGHT_FD_ADVISE |
      constants_1.WASI_RIGHT_FD_FILESTAT_GET |
      constants_1.WASI_RIGHT_POLL_FD_READWRITE;
    var STDERR_DEFAULT_RIGHTS = STDOUT_DEFAULT_RIGHTS;
    exports.SOCKET_DEFAULT_RIGHTS =
      constants_1.WASI_RIGHT_FD_DATASYNC |
      constants_1.WASI_RIGHT_FD_READ |
      constants_1.WASI_RIGHT_FD_WRITE |
      constants_1.WASI_RIGHT_FD_ADVISE |
      constants_1.WASI_RIGHT_FD_FILESTAT_GET |
      constants_1.WASI_RIGHT_POLL_FD_READWRITE |
      constants_1.WASI_RIGHT_FD_FDSTAT_SET_FLAGS;
    var msToNs = ms => {
      const msInt = Math.trunc(ms);

      const decimal = BigInt(Math.round((ms - msInt) * 1e6));
      const ns = BigInt(msInt) * BigInt(1e6);
      return ns + decimal;
    };
    var nsToMs = ns => {
      if (typeof ns === "number") {
        ns = Math.trunc(ns);
      }
      const nsInt = BigInt(ns);
      return Number(nsInt / BigInt(1e6));
    };
    var wrap =
      f =>
      (...args) => {
        try {
          return f(...args);
        } catch (err) {
          let e = err as any;
          while (e.prev != null) {
            e = e.prev;
          }
          if (e?.code && typeof e?.code === "string") {
            return constants_1.ERROR_MAP[e.code] || constants_1.WASI_EINVAL;
          }
          if (e instanceof types_1.WASIError) {
            return e.errno;
          }
          throw e;
        }
      };
    var stat = (wasi: WASIInstance, fd: number) => {
      const entry = wasi.FD_MAP.get(fd);
      if (!entry) {
        throw new types_1.WASIError(constants_1.WASI_EBADF);
      }
      if (entry.filetype === void 0) {
        const stats = wasi.fstatSync(entry.real);
        const { filetype, rightsBase, rightsInheriting } = translateFileAttributes(wasi, fd, stats);
        entry.filetype = filetype;
        if (!entry.rights) {
          entry.rights = {
            base: rightsBase,
            inheriting: rightsInheriting,
          };
        }
      }
      return entry;
    };
    var translateFileAttributes = (wasi: WASIInstance, fd: number | undefined, stats: Stats) => {
      switch (true) {
        case stats.isBlockDevice():
          return {
            filetype: constants_1.WASI_FILETYPE_BLOCK_DEVICE,
            rightsBase: constants_1.RIGHTS_BLOCK_DEVICE_BASE,
            rightsInheriting: constants_1.RIGHTS_BLOCK_DEVICE_INHERITING,
          };
        case stats.isCharacterDevice(): {
          const filetype = constants_1.WASI_FILETYPE_CHARACTER_DEVICE;
          if (fd !== void 0 && wasi.bindings.isTTY(fd)) {
            return {
              filetype,
              rightsBase: constants_1.RIGHTS_TTY_BASE,
              rightsInheriting: constants_1.RIGHTS_TTY_INHERITING,
            };
          }
          return {
            filetype,
            rightsBase: constants_1.RIGHTS_CHARACTER_DEVICE_BASE,
            rightsInheriting: constants_1.RIGHTS_CHARACTER_DEVICE_INHERITING,
          };
        }
        case stats.isDirectory():
          return {
            filetype: constants_1.WASI_FILETYPE_DIRECTORY,
            rightsBase: constants_1.RIGHTS_DIRECTORY_BASE,
            rightsInheriting: constants_1.RIGHTS_DIRECTORY_INHERITING,
          };
        case stats.isFIFO():
          return {
            filetype: constants_1.WASI_FILETYPE_SOCKET_STREAM,
            rightsBase: constants_1.RIGHTS_SOCKET_BASE,
            rightsInheriting: constants_1.RIGHTS_SOCKET_INHERITING,
          };
        case stats.isFile():
          return {
            filetype: constants_1.WASI_FILETYPE_REGULAR_FILE,
            rightsBase: constants_1.RIGHTS_REGULAR_FILE_BASE,
            rightsInheriting: constants_1.RIGHTS_REGULAR_FILE_INHERITING,
          };
        case stats.isSocket():
          return {
            filetype: constants_1.WASI_FILETYPE_SOCKET_STREAM,
            rightsBase: constants_1.RIGHTS_SOCKET_BASE,
            rightsInheriting: constants_1.RIGHTS_SOCKET_INHERITING,
          };
        case stats.isSymbolicLink():
          return {
            filetype: constants_1.WASI_FILETYPE_SYMBOLIC_LINK,
            rightsBase: BigInt(0),
            rightsInheriting: BigInt(0),
          };
        default:
          return {
            filetype: constants_1.WASI_FILETYPE_UNKNOWN,
            rightsBase: BigInt(0),
            rightsInheriting: BigInt(0),
          };
      }
    };
    var warnedAboutSleep = false;

    var defaultConfig: WASIConfig | undefined;
    function getDefaults(): WASIConfig {
      if (defaultConfig) return defaultConfig;

      const defaultBindings: WASIBindings = {
        hrtime: () => process.hrtime.bigint(),
        exit: code => {
          process.exit(code);
        },
        kill: signal => {
          process.kill(process.pid, signal);
          // Throw an error to satisfy 'never' and indicate termination intent
          throw new types_1.WASIKillError(signal);
        },
        randomFillSync: (array: Uint8Array): void => {
          // Cast to any to bypass incorrect definition in ZigGeneratedClasses.d.ts
          (crypto.getRandomValues as any)(array);
        },
        isTTY: fd => require("node:tty").isatty(fd),
        fs: require("node:fs"),
        path: require("node:path"),
      };

      return (defaultConfig = {
        args: [],
        env: {},
        preopens: {},
        bindings: defaultBindings,
        sleep: ms => {
          Bun.sleepSync(ms);
        },
        getStdin: undefined,
        sendStdout: undefined,
        sendStderr: undefined,
      });
    }

    var WASIClass = class WASIClass {
      args: string[];
      env: Record<string, string>;
      preopens: Record<string, string>;
      bindings: WASIBindings;
      lastStdin: bigint;
      sleep?: (ms: number) => void;
      getStdin?: () => Buffer | undefined;
      sendStdout?: (data: Uint8Array) => void;
      sendStderr?: (data: Uint8Array) => void;
      memory?: WebAssembly.Memory;
      view?: DataView;
      FD_MAP: Map<number, WASIFileDescriptor>;
      wasiImport: Record<string, (...args: any[]) => any>;
      stdinBuffer?: Buffer;

      constructor(wasiConfig: Partial<WASIConfig> = {}) {
        const defaultConfig = getDefaults();
        this.args = wasiConfig.args ?? defaultConfig.args!;
        this.lastStdin = 0n;
        this.sleep = wasiConfig.sleep || defaultConfig.sleep;
        this.getStdin = wasiConfig.getStdin;
        this.sendStdout = wasiConfig.sendStdout;
        this.sendStderr = wasiConfig.sendStderr;
        this.preopens = wasiConfig.preopens ?? defaultConfig.preopens!;
        this.env = wasiConfig.env ?? defaultConfig.env!;

        this.memory = undefined;
        this.view = undefined;
        this.bindings = wasiConfig.bindings || defaultConfig.bindings!;
        const bindings = this.bindings;
        fs = bindings.fs;

        // Initialize FD_MAP and set standard FDs
        this.FD_MAP = new Map<number, WASIFileDescriptor>();
        this.FD_MAP.set(constants_1.WASI_STDIN_FILENO, {
          real: 0,
          filetype: constants_1.WASI_FILETYPE_CHARACTER_DEVICE,
          rights: {
            base: STDIN_DEFAULT_RIGHTS,
            inheriting: 0n,
          },
          path: "/dev/stdin",
        });
        this.FD_MAP.set(constants_1.WASI_STDOUT_FILENO, {
          real: 1,
          filetype: constants_1.WASI_FILETYPE_CHARACTER_DEVICE,
          rights: {
            base: STDOUT_DEFAULT_RIGHTS,
            inheriting: 0n,
          },
          path: "/dev/stdout",
        });
        this.FD_MAP.set(constants_1.WASI_STDERR_FILENO, {
          real: 2,
          filetype: constants_1.WASI_FILETYPE_CHARACTER_DEVICE,
          rights: {
            base: STDERR_DEFAULT_RIGHTS,
            inheriting: 0n,
          },
          path: "/dev/stderr",
        });

        const path = bindings.path;
        for (const [k, v] of Object.entries(this.preopens)) {
          const real = fs.openSync(v, nodeFsConstants.O_RDONLY);
          const newfd = this.getUnusedFileDescriptor();
          this.FD_MAP.set(newfd, {
            real,
            filetype: constants_1.WASI_FILETYPE_DIRECTORY,
            rights: {
              base: constants_1.RIGHTS_DIRECTORY_BASE,
              inheriting: constants_1.RIGHTS_DIRECTORY_INHERITING,
            },
            fakePath: k,
            path: v,
          });
        }
        const getiovs = (iovs: number, iovsLen: number): Uint8Array[] => {
          this.refreshMemory();

          const { view, memory } = this;
          if (!view || !memory) {
            throw new Error("Memory not set");
          }
          const { buffer } = memory;
          const { byteLength } = buffer;

          if (iovsLen === 1) {
            const ptr = iovs;
            const buf = view.getUint32(ptr, true);
            let bufLen = view.getUint32(ptr + 4, true);

            if (bufLen > byteLength - buf) {
              console.log({
                buf,
                bufLen,
                total_memory: byteLength,
              });
              log("getiovs: warning -- truncating buffer to fit in memory");
              bufLen = Math.min(bufLen, Math.max(0, byteLength - buf));
            }
            try {
              return [new Uint8Array(buffer, buf, bufLen)];
            } catch (err) {
              console.warn("WASI.getiovs -- invalid buffer", err);
              throw new types_1.WASIError(constants_1.WASI_EINVAL);
            }
          }

          // Avoid referencing Array because materializing the Array constructor can show up in profiling
          const buffers: Uint8Array[] = [];
          buffers.length = iovsLen;

          for (let i = 0, ptr = iovs; i < iovsLen; i++, ptr += 8) {
            const buf = view.getUint32(ptr, true);
            let bufLen = view.getUint32(ptr + 4, true);

            if (bufLen > byteLength - buf) {
              console.log({
                buf,
                bufLen,
                total_memory: byteLength,
              });
              log("getiovs: warning -- truncating buffer to fit in memory");
              bufLen = Math.min(bufLen, Math.max(0, byteLength - buf));
            }
            try {
              buffers[i] = new Uint8Array(buffer, buf, bufLen);
            } catch (err) {
              console.warn("WASI.getiovs -- invalid buffer", err);
              throw new types_1.WASIError(constants_1.WASI_EINVAL);
            }
          }
          return buffers;
        };
        const CHECK_FD = (fd: number, rights: bigint): WASIFileDescriptor => {
          const stats = stat(this, fd);
          if (rights !== 0n && (stats.rights.base & rights) === 0n) {
            throw new types_1.WASIError(constants_1.WASI_EPERM);
          }
          return stats;
        };
        const CPUTIME_START = Bun.nanoseconds();
        const timeOrigin: bigint = BigInt(Math.trunc(performance.timeOrigin * 1e6));
        const now = (clockId: number): bigint | null => {
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
        this.wasiImport = {
          args_get: (argv: number, argvBuf: number): number => {
            this.refreshMemory();
            if (!this.view || !this.memory) return constants_1.WASI_EINVAL;
            let coffset = argv;
            let offset = argvBuf;
            this.args.forEach(a => {
              this.view!.setUint32(coffset, offset, true);
              coffset += 4;
              offset += Buffer.from(this.memory!.buffer).write(`${a}\0`, offset);
            });
            return constants_1.WASI_ESUCCESS;
          },
          args_sizes_get: (argc: number, argvBufSize: number): number => {
            this.refreshMemory();
            if (!this.view) return constants_1.WASI_EINVAL;
            this.view.setUint32(argc, this.args.length, true);
            const size = this.args.reduce((acc, a) => acc + Buffer.byteLength(a) + 1, 0);
            this.view.setUint32(argvBufSize, size, true);
            return constants_1.WASI_ESUCCESS;
          },
          environ_get: (environ: number, environBuf: number): number => {
            this.refreshMemory();
            if (!this.view || !this.memory) return constants_1.WASI_EINVAL;
            let coffset = environ;
            let offset = environBuf;
            Object.entries(this.env).forEach(([key, value]) => {
              this.view!.setUint32(coffset, offset, true);
              coffset += 4;
              offset += Buffer.from(this.memory!.buffer).write(`${key}=${value}\0`, offset);
            });
            return constants_1.WASI_ESUCCESS;
          },
          environ_sizes_get: (environCount: number, environBufSize: number): number => {
            this.refreshMemory();
            if (!this.view) return constants_1.WASI_EINVAL;
            const envProcessed = Object.entries(this.env).map(([key, value]) => `${key}=${value}\0`);
            const size = envProcessed.reduce((acc, e) => acc + Buffer.byteLength(e), 0);
            this.view.setUint32(environCount, envProcessed.length, true);
            this.view.setUint32(environBufSize, size, true);
            return constants_1.WASI_ESUCCESS;
          },
          clock_res_get: (clockId: number, resolution: number): number => {
            if (!this.view) return constants_1.WASI_EINVAL;
            let res: bigint;
            switch (clockId) {
              case constants_1.WASI_CLOCK_MONOTONIC:
              case constants_1.WASI_CLOCK_PROCESS_CPUTIME_ID:
              case constants_1.WASI_CLOCK_THREAD_CPUTIME_ID: {
                res = BigInt(1);
                break;
              }
              case constants_1.WASI_CLOCK_REALTIME: {
                res = BigInt(1e3);
                break;
              }
              default:
                throw Error("invalid clockId");
            }
            this.view.setBigUint64(resolution, res, true);
            return constants_1.WASI_ESUCCESS;
          },
          clock_time_get: (clockId: number, _precision: bigint, time: number): number => {
            this.refreshMemory();
            if (!this.view) return constants_1.WASI_EINVAL;
            const n = now(clockId);
            if (n === null) {
              return constants_1.WASI_EINVAL;
            }
            this.view.setBigUint64(time, n, true);
            return constants_1.WASI_ESUCCESS;
          },
          fd_advise: wrap((fd: number, _offset: bigint, _len: bigint, _advice: number): number => {
            CHECK_FD(fd, constants_1.WASI_RIGHT_FD_ADVISE);
            return constants_1.WASI_ENOSYS;
          }),
          fd_allocate: wrap((fd: number, _offset: bigint, _len: bigint): number => {
            CHECK_FD(fd, constants_1.WASI_RIGHT_FD_ALLOCATE);
            return constants_1.WASI_ENOSYS;
          }),
          fd_close: wrap((fd: number): number => {
            const stats = CHECK_FD(fd, 0n);
            fs.closeSync(stats.real);
            this.FD_MAP.delete(fd);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_datasync: wrap((fd: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_DATASYNC);
            fs.fdatasyncSync(stats.real);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_fdstat_get: wrap((fd: number, bufPtr: number): number => {
            const stats = CHECK_FD(fd, 0n);
            this.refreshMemory();
            if (!this.view) return constants_1.WASI_EINVAL;
            if (stats.filetype == null) {
              throw Error("stats.filetype must be set");
            }
            this.view.setUint8(bufPtr, stats.filetype);
            this.view.setUint16(bufPtr + 2, 0, true); // fs_flags
            this.view.setUint16(bufPtr + 4, 0, true); // unused padding
            this.view.setBigUint64(bufPtr + 8, stats.rights.base, true);
            this.view.setBigUint64(bufPtr + 16, stats.rights.inheriting, true);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_fdstat_set_flags: wrap((fd: number, flags: number): number => {
            CHECK_FD(fd, constants_1.WASI_RIGHT_FD_FDSTAT_SET_FLAGS);
            if (this.wasiImport.sock_fcntlSetFlags(fd, flags) == 0) {
              return constants_1.WASI_ESUCCESS;
            }
            return constants_1.WASI_ENOSYS;
          }),
          fd_fdstat_set_rights: wrap((fd: number, fsRightsBase: bigint, fsRightsInheriting: bigint): number => {
            const stats = CHECK_FD(fd, 0n);
            const nrb = stats.rights.base | fsRightsBase;
            if (nrb > stats.rights.base) {
              return constants_1.WASI_EPERM;
            }
            const nri = stats.rights.inheriting | fsRightsInheriting;
            if (nri > stats.rights.inheriting) {
              return constants_1.WASI_EPERM;
            }
            stats.rights.base = fsRightsBase;
            stats.rights.inheriting = fsRightsInheriting;
            return constants_1.WASI_ESUCCESS;
          }),
          fd_filestat_get: wrap((fd: number, bufPtr: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_FILESTAT_GET);
            const rstats = this.fstatSync(stats.real);
            this.refreshMemory();
            if (!this.view) return constants_1.WASI_EINVAL;
            this.view.setBigUint64(bufPtr, BigInt(rstats.dev), true);
            bufPtr += 8;
            this.view.setBigUint64(bufPtr, BigInt(rstats.ino), true);
            bufPtr += 8;
            if (stats.filetype == null) {
              throw Error("stats.filetype must be set");
            }
            this.view.setUint8(bufPtr, stats.filetype);
            bufPtr += 8; // filetype (8 bits) + padding (56 bits)
            this.view.setBigUint64(bufPtr, BigInt(rstats.nlink), true);
            bufPtr += 8;
            this.view.setBigUint64(bufPtr, BigInt(rstats.size), true);
            bufPtr += 8;
            this.view.setBigUint64(bufPtr, msToNs(rstats.atimeMs), true);
            bufPtr += 8;
            this.view.setBigUint64(bufPtr, msToNs(rstats.mtimeMs), true);
            bufPtr += 8;
            this.view.setBigUint64(bufPtr, msToNs(rstats.ctimeMs), true);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_filestat_set_size: wrap((fd: number, stSize: bigint): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_FILESTAT_SET_SIZE);
            fs.ftruncateSync(stats.real, Number(stSize));
            return constants_1.WASI_ESUCCESS;
          }),
          fd_filestat_set_times: wrap((fd: number, stAtim: bigint, stMtim: bigint, fstflags: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_FILESTAT_SET_TIMES);
            const rstats = this.fstatSync(stats.real);
            let atim: number | Date = rstats.atime;
            let mtim: number | Date = rstats.mtime;
            const n = nsToMs(now(constants_1.WASI_CLOCK_REALTIME)!);
            const atimflags = constants_1.WASI_FILESTAT_SET_ATIM | constants_1.WASI_FILESTAT_SET_ATIM_NOW;
            if ((fstflags & atimflags) === atimflags) {
              return constants_1.WASI_EINVAL;
            }
            const mtimflags = constants_1.WASI_FILESTAT_SET_MTIM | constants_1.WASI_FILESTAT_SET_MTIM_NOW;
            if ((fstflags & mtimflags) === mtimflags) {
              return constants_1.WASI_EINVAL;
            }
            if ((fstflags & constants_1.WASI_FILESTAT_SET_ATIM) === constants_1.WASI_FILESTAT_SET_ATIM) {
              atim = nsToMs(stAtim);
            } else if ((fstflags & constants_1.WASI_FILESTAT_SET_ATIM_NOW) === constants_1.WASI_FILESTAT_SET_ATIM_NOW) {
              atim = n;
            }
            if ((fstflags & constants_1.WASI_FILESTAT_SET_MTIM) === constants_1.WASI_FILESTAT_SET_MTIM) {
              mtim = nsToMs(stMtim);
            } else if ((fstflags & constants_1.WASI_FILESTAT_SET_MTIM_NOW) === constants_1.WASI_FILESTAT_SET_MTIM_NOW) {
              mtim = n;
            }
            fs.futimesSync(stats.real, new Date(atim), new Date(mtim));
            return constants_1.WASI_ESUCCESS;
          }),
          fd_prestat_get: wrap((fd: number, bufPtr: number): number => {
            const stats = CHECK_FD(fd, 0n);
            this.refreshMemory();
            if (!this.view) return constants_1.WASI_EINVAL;
            this.view.setUint8(bufPtr, constants_1.WASI_PREOPENTYPE_DIR);
            this.view.setUint32(bufPtr + 4, Buffer.byteLength(stats.fakePath ?? stats.path ?? ""), true);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_prestat_dir_name: wrap((fd: number, pathPtr: number, pathLen: number): number => {
            const stats = CHECK_FD(fd, 0n);
            this.refreshMemory();
            if (!this.memory) return constants_1.WASI_EINVAL;
            Buffer.from(this.memory.buffer).write(stats.fakePath ?? stats.path ?? "", pathPtr, pathLen, "utf8");
            return constants_1.WASI_ESUCCESS;
          }),
          fd_pwrite: wrap((fd: number, iovs: number, iovsLen: number, offset: bigint, nwritten: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_WRITE | constants_1.WASI_RIGHT_FD_SEEK);
            if (!this.view) return constants_1.WASI_EINVAL;
            let written = 0;
            getiovs(iovs, iovsLen).forEach(iov => {
              let w = 0;
              while (w < iov.byteLength) {
                w += fs.writeSync(stats.real, iov, w, iov.byteLength - w, Number(offset) + written + w);
              }
              written += w;
            });
            this.view.setUint32(nwritten, written, true);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_write: wrap((fd: number, iovs: number, iovsLen: number, nwritten: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_WRITE);
            if (!this.view) return constants_1.WASI_EINVAL;
            const IS_STDOUT = fd == constants_1.WASI_STDOUT_FILENO;
            const IS_STDERR = fd == constants_1.WASI_STDERR_FILENO;
            let written = 0;
            getiovs(iovs, iovsLen).forEach(iov => {
              if (iov.byteLength == 0) return;
              if (IS_STDOUT && this.sendStdout != null) {
                this.sendStdout(iov);
                written += iov.byteLength;
              } else if (IS_STDERR && this.sendStderr != null) {
                this.sendStderr(iov);
                written += iov.byteLength;
              } else {
                let w = 0;
                while (w < iov.byteLength) {
                  const i = fs.writeSync(
                    stats.real,
                    iov,
                    w,
                    iov.byteLength - w,
                    stats.offset ? Number(stats.offset) : null,
                  );
                  if (stats.offset !== undefined) stats.offset = (stats.offset ?? 0n) + BigInt(i);
                  w += i;
                }
                written += w;
              }
            });
            this.view.setUint32(nwritten, written, true);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_pread: wrap((fd: number, iovs: number, iovsLen: number, offset: bigint, nread: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_READ | constants_1.WASI_RIGHT_FD_SEEK);
            if (!this.view) return constants_1.WASI_EINVAL;
            let read = 0;
            outer: for (const iov of getiovs(iovs, iovsLen)) {
              let r = 0;
              while (r < iov.byteLength) {
                const length = iov.byteLength - r;
                const rr = fs.readSync(stats.real, iov, r, iov.byteLength - r, Number(offset) + read + r);
                r += rr;
                read += rr;
                if (rr === 0 || rr < length) {
                  break outer;
                }
              }
              // This line seems redundant as `read` is already incremented inside the loop.
              // read += r;
            }
            this.view.setUint32(nread, read, true);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_read: wrap((fd: number, iovs: number, iovsLen: number, nread: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_READ);
            if (!this.view) return constants_1.WASI_EINVAL;
            const IS_STDIN = fd == constants_1.WASI_STDIN_FILENO;
            let read = 0;
            outer: for (const iov of getiovs(iovs, iovsLen)) {
              let r = 0;
              while (r < iov.byteLength) {
                let length = iov.byteLength - r;
                let position = IS_STDIN || stats.offset === void 0 ? null : Number(stats.offset);
                let rr = 0;
                if (IS_STDIN) {
                  if (this.getStdin != null) {
                    if (this.stdinBuffer == null) {
                      this.stdinBuffer = this.getStdin();
                    }
                    if (this.stdinBuffer != null) {
                      rr = this.stdinBuffer.copy(iov, r); // Copy into iov starting at offset r
                      if (rr == this.stdinBuffer.length) {
                        this.stdinBuffer = undefined;
                      } else {
                        this.stdinBuffer = this.stdinBuffer.slice(rr);
                      }
                      if (rr > 0) {
                        this.lastStdin = BigInt(Date.now());
                      }
                    }
                  } else {
                    if (this.sleep == null && !warnedAboutSleep) {
                      warnedAboutSleep = true;
                      console.log("(cpu waiting for stdin: please define a way to sleep!) ");
                    }
                    try {
                      rr = fs.readSync(stats.real, iov, r, length, position);
                    } catch {}
                    if (rr == 0) {
                      this.shortPause();
                    } else {
                      this.lastStdin = BigInt(Date.now());
                    }
                  }
                } else {
                  rr = fs.readSync(stats.real, iov, r, length, position);
                }
                if (stats.filetype == constants_1.WASI_FILETYPE_REGULAR_FILE && stats.offset !== undefined) {
                  stats.offset = (stats.offset ?? 0n) + BigInt(rr);
                }
                r += rr;
                read += rr;
                if (rr === 0 || rr < length) {
                  break outer;
                }
              }
            }
            this.view.setUint32(nread, read, true);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_readdir: wrap((fd: number, bufPtr: number, bufLen: number, cookie: bigint, bufusedPtr: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_READDIR);
            this.refreshMemory();
            if (!this.view || !this.memory) return constants_1.WASI_EINVAL;
            if (!stats.path) return constants_1.WASI_EINVAL;
            const entries = fs.readdirSync(stats.path, { withFileTypes: true });
            const startPtr = bufPtr;
            for (let i = Number(cookie); i < entries.length; i += 1) {
              const entry = entries[i];
              let nameLength = Buffer.byteLength(entry.name);
              const direntSize = 24 + nameLength; // Size of wasi_dirent + name length
              if (bufPtr + direntSize > startPtr + bufLen) {
                break; // Not enough space for this entry
              }

              this.view.setBigUint64(bufPtr, BigInt(i + 1), true); // d_next
              bufPtr += 8;

              const rstats = fs.lstatSync(path.resolve(stats.path, entry.name));
              this.view.setBigUint64(bufPtr, BigInt(rstats.ino), true);
              bufPtr += 8;

              this.view.setUint32(bufPtr, nameLength, true); // d_namlen
              bufPtr += 4;

              let filetype;
              switch (true) {
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
              this.view.setUint8(bufPtr, filetype); // d_type
              bufPtr += 1;
              bufPtr += 3; // padding

              let memory_buffer = Buffer.from(this.memory.buffer);
              memory_buffer.write(entry.name, bufPtr);
              bufPtr += nameLength;
            }
            const bufused = bufPtr - startPtr;
            this.view.setUint32(bufusedPtr, bufused, true);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_renumber: wrap((from: number, to: number): number => {
            const fromStats = CHECK_FD(from, 0n);
            CHECK_FD(to, 0n); // Check if 'to' exists, but don't need its stats
            fs.closeSync(fromStats.real);
            const toStats = this.FD_MAP.get(to)!;
            this.FD_MAP.set(from, toStats);
            this.FD_MAP.delete(to);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_seek: wrap((fd: number, offset: bigint, whence: number, newOffsetPtr: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_SEEK);
            this.refreshMemory();
            if (!this.view) return constants_1.WASI_EINVAL;
            switch (whence) {
              case constants_1.WASI_WHENCE_CUR:
                stats.offset = (stats.offset ?? 0n) + offset;
                break;
              case constants_1.WASI_WHENCE_END:
                const rstats = this.fstatSync(stats.real);
                stats.offset = BigInt(rstats.size) + offset;
                break;
              case constants_1.WASI_WHENCE_SET:
                stats.offset = offset;
                break;
              default:
                return constants_1.WASI_EINVAL;
            }
            if (stats.offset == null) {
              throw Error("stats.offset must be defined");
            }
            this.view.setBigUint64(newOffsetPtr, stats.offset ?? 0n, true);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_tell: wrap((fd: number, offsetPtr: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_TELL);
            this.refreshMemory();
            if (!this.view) return constants_1.WASI_EINVAL;
            stats.offset = stats.offset ?? 0n;
            this.view.setBigUint64(offsetPtr, stats.offset ?? 0n, true);
            return constants_1.WASI_ESUCCESS;
          }),
          fd_sync: wrap((fd: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_FD_SYNC);
            fs.fsyncSync(stats.real);
            return constants_1.WASI_ESUCCESS;
          }),
          path_create_directory: wrap((fd: number, pathPtr: number, pathLen: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_CREATE_DIRECTORY);
            if (!stats.path) {
              return constants_1.WASI_EINVAL;
            }
            this.refreshMemory();
            if (!this.memory) return constants_1.WASI_EINVAL;
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
            fs.mkdirSync(path.resolve(stats.path, p));
            return constants_1.WASI_ESUCCESS;
          }),
          path_filestat_get: wrap((fd: number, flags: number, pathPtr: number, pathLen: number, bufPtr: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_FILESTAT_GET);
            if (!stats.path) {
              return constants_1.WASI_EINVAL;
            }
            this.refreshMemory();
            if (!this.view || !this.memory) return constants_1.WASI_EINVAL;
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
            let rstats: Stats;
            if (flags & 1 /* AT_SYMLINK_NOFOLLOW */) {
              rstats = fs.lstatSync(path.resolve(stats.path, p));
            } else {
              rstats = fs.statSync(path.resolve(stats.path, p));
            }
            this.view.setBigUint64(bufPtr, BigInt(rstats.dev), true);
            bufPtr += 8;
            this.view.setBigUint64(bufPtr, BigInt(rstats.ino), true);
            bufPtr += 8;
            this.view.setUint8(bufPtr, translateFileAttributes(this, void 0, rstats).filetype);
            bufPtr += 8; // filetype (8 bits) + padding (56 bits)
            this.view.setBigUint64(bufPtr, BigInt(rstats.nlink), true);
            bufPtr += 8;
            this.view.setBigUint64(bufPtr, BigInt(rstats.size), true);
            bufPtr += 8;
            this.view.setBigUint64(bufPtr, msToNs(rstats.atimeMs), true);
            bufPtr += 8;
            this.view.setBigUint64(bufPtr, msToNs(rstats.mtimeMs), true);
            bufPtr += 8;
            this.view.setBigUint64(bufPtr, msToNs(rstats.ctimeMs), true);
            return constants_1.WASI_ESUCCESS;
          }),
          path_filestat_set_times: wrap(
            (
              fd: number,
              _dirflags: number,
              pathPtr: number,
              pathLen: number,
              stAtim: bigint,
              stMtim: bigint,
              fstflags: number,
            ): number => {
              const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_FILESTAT_SET_TIMES);
              if (!stats.path) {
                return constants_1.WASI_EINVAL;
              }
              this.refreshMemory();
              if (!this.memory) return constants_1.WASI_EINVAL;
              const rstats = this.fstatSync(stats.real);
              let atim: number | Date = rstats.atime;
              let mtim: number | Date = rstats.mtime;
              const n = nsToMs(now(constants_1.WASI_CLOCK_REALTIME)!);
              const atimflags = constants_1.WASI_FILESTAT_SET_ATIM | constants_1.WASI_FILESTAT_SET_ATIM_NOW;
              if ((fstflags & atimflags) === atimflags) {
                return constants_1.WASI_EINVAL;
              }
              const mtimflags = constants_1.WASI_FILESTAT_SET_MTIM | constants_1.WASI_FILESTAT_SET_MTIM_NOW;
              if ((fstflags & mtimflags) === mtimflags) {
                return constants_1.WASI_EINVAL;
              }
              if ((fstflags & constants_1.WASI_FILESTAT_SET_ATIM) === constants_1.WASI_FILESTAT_SET_ATIM) {
                atim = nsToMs(stAtim);
              } else if ((fstflags & constants_1.WASI_FILESTAT_SET_ATIM_NOW) === constants_1.WASI_FILESTAT_SET_ATIM_NOW) {
                atim = n;
              }
              if ((fstflags & constants_1.WASI_FILESTAT_SET_MTIM) === constants_1.WASI_FILESTAT_SET_MTIM) {
                mtim = nsToMs(stMtim);
              } else if ((fstflags & constants_1.WASI_FILESTAT_SET_MTIM_NOW) === constants_1.WASI_FILESTAT_SET_MTIM_NOW) {
                mtim = n;
              }
              const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
              fs.utimesSync(path.resolve(stats.path, p), new Date(atim), new Date(mtim));
              return constants_1.WASI_ESUCCESS;
            },
          ),
          path_link: wrap(
            (
              oldFd: number,
              _oldFlags: number,
              oldPath: number,
              oldPathLen: number,
              newFd: number,
              newPath: number,
              newPathLen: number,
            ): number => {
              const ostats = CHECK_FD(oldFd, constants_1.WASI_RIGHT_PATH_LINK_SOURCE);
              const nstats = CHECK_FD(newFd, constants_1.WASI_RIGHT_PATH_LINK_TARGET);
              if (!ostats.path || !nstats.path) {
                return constants_1.WASI_EINVAL;
              }
              this.refreshMemory();
              if (!this.memory) return constants_1.WASI_EINVAL;
              const op = Buffer.from(this.memory.buffer, oldPath, oldPathLen).toString();
              const np = Buffer.from(this.memory.buffer, newPath, newPathLen).toString();
              fs.linkSync(path.resolve(ostats.path, op), path.resolve(nstats.path, np));
              return constants_1.WASI_ESUCCESS;
            },
          ),
          path_open: wrap(
            (
              dirfd: number,
              _dirflags: number,
              pathPtr: number,
              pathLen: number,
              oflags: number,
              fsRightsBase: bigint,
              fsRightsInheriting: bigint,
              fsFlags: number,
              fdPtr: number,
            ): number => {
              try {
                const dirstats = CHECK_FD(dirfd, constants_1.WASI_RIGHT_PATH_OPEN);
                if (!dirstats.path) return constants_1.WASI_EINVAL;

                fsRightsBase = BigInt(fsRightsBase);
                fsRightsInheriting = BigInt(fsRightsInheriting);
                const read = (fsRightsBase & (constants_1.WASI_RIGHT_FD_READ | constants_1.WASI_RIGHT_FD_READDIR)) !== 0n;
                const write =
                  (fsRightsBase &
                    (constants_1.WASI_RIGHT_FD_DATASYNC |
                      constants_1.WASI_RIGHT_FD_WRITE |
                      constants_1.WASI_RIGHT_FD_ALLOCATE |
                      constants_1.WASI_RIGHT_FD_FILESTAT_SET_SIZE)) !==
                  0n;
                let noflags;
                if (write && read) {
                  noflags = nodeFsConstants.O_RDWR;
                } else if (read) {
                  noflags = nodeFsConstants.O_RDONLY;
                } else if (write) {
                  noflags = nodeFsConstants.O_WRONLY;
                } else {
                  // Need at least read or write rights
                  return constants_1.WASI_EPERM;
                }

                let neededBase = fsRightsBase | constants_1.WASI_RIGHT_PATH_OPEN;
                let neededInheriting = fsRightsBase | fsRightsInheriting;
                if ((BigInt(oflags) & BigInt(constants_1.WASI_O_CREAT)) !== 0n) {
                  noflags |= nodeFsConstants.O_CREAT;
                  neededBase |= constants_1.WASI_RIGHT_PATH_CREATE_FILE;
                }
                if ((BigInt(oflags) & BigInt(constants_1.WASI_O_DIRECTORY)) !== 0n) {
                  noflags |= nodeFsConstants.O_DIRECTORY;
                }
                if ((BigInt(oflags) & BigInt(constants_1.WASI_O_EXCL)) !== 0n) {
                  noflags |= nodeFsConstants.O_EXCL;
                }
                if ((BigInt(oflags) & BigInt(constants_1.WASI_O_TRUNC)) !== 0n) {
                  noflags |= nodeFsConstants.O_TRUNC;
                  neededBase |= constants_1.WASI_RIGHT_PATH_FILESTAT_SET_SIZE;
                }
                if ((BigInt(fsFlags) & BigInt(constants_1.WASI_FDFLAG_APPEND)) !== 0n) {
                  noflags |= nodeFsConstants.O_APPEND;
                }
                if ((BigInt(fsFlags) & BigInt(constants_1.WASI_FDFLAG_DSYNC)) !== 0n) {
                  if (nodeFsConstants.O_DSYNC) {
                    noflags |= nodeFsConstants.O_DSYNC;
                  } else {
                    noflags |= nodeFsConstants.O_SYNC;
                  }
                  neededInheriting |= constants_1.WASI_RIGHT_FD_DATASYNC;
                }
                if ((BigInt(fsFlags) & BigInt(constants_1.WASI_FDFLAG_NONBLOCK)) !== 0n) {
                  noflags |= nodeFsConstants.O_NONBLOCK;
                }
                if ((BigInt(fsFlags) & BigInt(constants_1.WASI_FDFLAG_RSYNC)) !== 0n) {
                  if (nodeFsConstants.O_SYNC) {
                    // Node uses O_SYNC for O_RSYNC fallback
                    noflags |= nodeFsConstants.O_SYNC;
                  }
                  neededInheriting |= constants_1.WASI_RIGHT_FD_SYNC;
                }
                if ((BigInt(fsFlags) & BigInt(constants_1.WASI_FDFLAG_SYNC)) !== 0n) {
                  noflags |= nodeFsConstants.O_SYNC;
                  neededInheriting |= constants_1.WASI_RIGHT_FD_SYNC;
                }
                if (write && (noflags & (nodeFsConstants.O_APPEND | nodeFsConstants.O_TRUNC)) === 0) {
                  neededInheriting |= constants_1.WASI_RIGHT_FD_SEEK;
                }
                this.refreshMemory();
                if (!this.memory || !this.view) return constants_1.WASI_EINVAL;
                const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
                if (p == "dev/tty") {
                  this.view.setUint32(fdPtr, constants_1.WASI_STDIN_FILENO, true);
                  return constants_1.WASI_ESUCCESS;
                }
                logOpen("path_open", p);
                if (p.startsWith("proc/")) {
                  throw new types_1.WASIError(constants_1.WASI_EBADF);
                }
                const fullUnresolved = path.resolve(dirstats.path, p);
                let full: string;
                try {
                  full = fs.realpathSync(fullUnresolved);
                } catch (e: any) {
                  if (e?.code === "ENOENT") {
                    full = fullUnresolved;
                  } else {
                    throw e;
                  }
                }
                let isDirectory = false;
                try {
                  isDirectory = fs.statSync(full).isDirectory();
                } catch {}

                let realfd: number;
                if (!write && isDirectory) {
                  realfd = fs.openSync(full, nodeFsConstants.O_RDONLY);
                } else {
                  realfd = fs.openSync(full, noflags, 0o666); // Add mode 0666 for creation
                }
                const newfd = this.getUnusedFileDescriptor();
                this.FD_MAP.set(newfd, {
                  real: realfd,
                  filetype: undefined, // Will be determined by stat() later
                  rights: {
                    base: neededBase,
                    inheriting: neededInheriting,
                  },
                  path: full,
                });
                stat(this, newfd); // Populate filetype and rights
                this.view.setUint32(fdPtr, newfd, true);
              } catch (e: any) {
                console.error(e);
                if (e instanceof types_1.WASIError) return e.errno;
                if (e?.code && typeof e?.code === "string") {
                  return constants_1.ERROR_MAP[e.code] || constants_1.WASI_EINVAL;
                }
                return constants_1.WASI_EIO;
              }
              return constants_1.WASI_ESUCCESS;
            },
          ),
          path_readlink: wrap((fd: number, pathPtr: number, pathLen: number, buf: number, bufLen: number, bufused: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_READLINK);
            if (!stats.path) {
              return constants_1.WASI_EINVAL;
            }
            this.refreshMemory();
            if (!this.memory || !this.view) return constants_1.WASI_EINVAL;
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
            const full = path.resolve(stats.path, p);
            const r = fs.readlinkSync(full);
            const used = Buffer.from(this.memory.buffer).write(r, buf, bufLen);
            this.view.setUint32(bufused, used, true);
            return constants_1.WASI_ESUCCESS;
          }),
          path_remove_directory: wrap((fd: number, pathPtr: number, pathLen: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_REMOVE_DIRECTORY);
            if (!stats.path) {
              return constants_1.WASI_EINVAL;
            }
            this.refreshMemory();
            if (!this.memory) return constants_1.WASI_EINVAL;
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
            fs.rmdirSync(path.resolve(stats.path, p));
            return constants_1.WASI_ESUCCESS;
          }),
          path_rename: wrap(
            (oldFd: number, oldPath: number, oldPathLen: number, newFd: number, newPath: number, newPathLen: number): number => {
              const ostats = CHECK_FD(oldFd, constants_1.WASI_RIGHT_PATH_RENAME_SOURCE);
              const nstats = CHECK_FD(newFd, constants_1.WASI_RIGHT_PATH_RENAME_TARGET);
              if (!ostats.path || !nstats.path) {
                return constants_1.WASI_EINVAL;
              }
              this.refreshMemory();
              if (!this.memory) return constants_1.WASI_EINVAL;
              const op = Buffer.from(this.memory.buffer, oldPath, oldPathLen).toString();
              const np = Buffer.from(this.memory.buffer, newPath, newPathLen).toString();
              fs.renameSync(path.resolve(ostats.path, op), path.resolve(nstats.path, np));
              return constants_1.WASI_ESUCCESS;
            },
          ),
          path_symlink: wrap((oldPath: number, oldPathLen: number, fd: number, newPath: number, newPathLen: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_SYMLINK);
            if (!stats.path) {
              return constants_1.WASI_EINVAL;
            }
            this.refreshMemory();
            if (!this.memory) return constants_1.WASI_EINVAL;
            const op = Buffer.from(this.memory.buffer, oldPath, oldPathLen).toString();
            const np = Buffer.from(this.memory.buffer, newPath, newPathLen).toString();
            fs.symlinkSync(op, path.resolve(stats.path, np));
            return constants_1.WASI_ESUCCESS;
          }),
          path_unlink_file: wrap((fd: number, pathPtr: number, pathLen: number): number => {
            const stats = CHECK_FD(fd, constants_1.WASI_RIGHT_PATH_UNLINK_FILE);
            if (!stats.path) {
              return constants_1.WASI_EINVAL;
            }
            this.refreshMemory();
            if (!this.memory) return constants_1.WASI_EINVAL;
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
            fs.unlinkSync(path.resolve(stats.path, p));
            return constants_1.WASI_ESUCCESS;
          }),
          poll_oneoff: (sin: number, sout: number, nsubscriptions: number, neventsPtr: number): number => {
            let nevents = 0;
            let name = "";
            let waitTimeNs = 0n;
            let fd = -1;
            let fd_type = "read";
            let fd_timeout_ms = 0;
            this.refreshMemory();
            if (!this.view) return constants_1.WASI_EINVAL;
            let last_sin = sin;
            for (let i = 0; i < nsubscriptions; i += 1) {
              const userdata = this.view.getBigUint64(sin, true);
              sin += 8;
              const type = this.view.getUint8(sin);
              sin += 1;
              sin += 7; // Padding
              if (log.enabled) {
                if (type == constants_1.WASI_EVENTTYPE_CLOCK) {
                  name = "poll_oneoff (type=WASI_EVENTTYPE_CLOCK): ";
                } else if (type == constants_1.WASI_EVENTTYPE_FD_READ) {
                  name = "poll_oneoff (type=WASI_EVENTTYPE_FD_READ): ";
                } else {
                  name = "poll_oneoff (type=WASI_EVENTTYPE_FD_WRITE): ";
                }
                log(name);
              }
              switch (type) {
                case constants_1.WASI_EVENTTYPE_CLOCK: {
                  const clockid = this.view.getUint32(sin, true);
                  sin += 4;
                  sin += 4; // Padding
                  const timeout = this.view.getBigUint64(sin, true);
                  sin += 8;
                  const precision = this.view.getBigUint64(sin, true); // Precision (unused for now)
                  sin += 8;
                  const subclockflags = this.view.getUint16(sin, true);
                  sin += 2;
                  sin += 6; // Padding
                  const absolute = subclockflags === 1;
                  if (log.enabled) {
                    log(name, { clockid, timeout, absolute });
                  }
                  if (!absolute) {
                    fd_timeout_ms = Number(timeout / 1000000n); // Convert ns to ms
                  }
                  let e = constants_1.WASI_ESUCCESS;
                  const t = now(clockid);
                  if (t == null) {
                    e = constants_1.WASI_EINVAL;
                  } else {
                    const tNS = t;
                    const end = absolute ? timeout : tNS + timeout;
                    const waitNs = end - tNS;
                    if (waitNs > waitTimeNs) {
                      waitTimeNs = waitNs;
                    }
                  }
                  this.view.setBigUint64(sout, userdata, true);
                  sout += 8;
                  this.view.setUint16(sout, e, true); // error
                  sout += 2;
                  this.view.setUint8(sout, constants_1.WASI_EVENTTYPE_CLOCK); // type
                  sout += 1;
                  sout += 5; // padding
                  nevents += 1;
                  break;
                }
                case constants_1.WASI_EVENTTYPE_FD_READ:
                case constants_1.WASI_EVENTTYPE_FD_WRITE: {
                  fd = this.view.getUint32(sin, true);
                  fd_type = type == constants_1.WASI_EVENTTYPE_FD_READ ? "read" : "write";
                  sin += 4;
                  log(name, "fd =", fd);
                  sin += 28; // Skip the rest of the subscription union
                  this.view.setBigUint64(sout, userdata, true);
                  sout += 8;
                  this.view.setUint16(sout, constants_1.WASI_ENOSYS, true); // error (default to ENOSYS)
                  sout += 2;
                  this.view.setUint8(sout, type); // type
                  sout += 1;
                  sout += 5; // padding
                  nevents += 1;
                  if (fd == constants_1.WASI_STDIN_FILENO && constants_1.WASI_EVENTTYPE_FD_READ == type) {
                    // TODO: Implement actual polling for stdin
                    this.shortPause(); // Temporary workaround
                  }
                  break;
                }
                default:
                  return constants_1.WASI_EINVAL;
              }
              if (sin - last_sin != 48) {
                console.warn("*** BUG in wasi-js in poll_oneoff ", {
                  i,
                  sin,
                  last_sin,
                  diff: sin - last_sin,
                });
              }
              last_sin = sin;
            }
            this.view.setUint32(neventsPtr, nevents, true);
            if (nevents == 2 && fd >= 0) {
              const r = this.wasiImport.sock_pollSocket(fd, fd_type, fd_timeout_ms);
              if (r != constants_1.WASI_ENOSYS) {
                // If sock_pollSocket handled it, update the event status
                // This part needs refinement based on how sock_pollSocket returns results
                // For now, assume it returns WASI_ESUCCESS if an event occurred
                if (r === constants_1.WASI_ESUCCESS) {
                  // Find the corresponding event output slot and update error code
                  let temp_sout = sout - nevents * 16; // Go back to the start of output events
                  for (let i = 0; i < nevents; i++) {
                    const event_type = this.view.getUint8(temp_sout + 10);
                    const event_fd = this.view.getUint32(temp_sout + 12, true); // Assuming fd is stored here in output
                    if (
                      (event_type === constants_1.WASI_EVENTTYPE_FD_READ ||
                        event_type === constants_1.WASI_EVENTTYPE_FD_WRITE) &&
                      event_fd === fd
                    ) {
                      this.view.setUint16(temp_sout + 8, constants_1.WASI_ESUCCESS, true); // Update error code
                      break;
                    }
                    temp_sout += 16;
                  }
                }
                return r; // Return the result from sock_pollSocket
              }
            }
            if (waitTimeNs > 0n) {
              // Removed incorrect calculation: const currentOffset = Bun.nanoseconds() - timeOrigin;
              // waitTimeNs = waitTimeNs - currentOffset;
              if (waitTimeNs >= 1000000n) {
                if (this.sleep == null && !warnedAboutSleep) {
                  warnedAboutSleep = true;
                  console.log("(100% cpu burning waiting for stdin: please define a way to sleep!) ");
                }
                if (this.sleep != null) {
                  const ms = nsToMs(waitTimeNs);
                  this.sleep(ms);
                } else {
                  const end = bindings.hrtime() + waitTimeNs;
                  while (bindings.hrtime() < end) {}
                }
              }
            }
            return constants_1.WASI_ESUCCESS;
          },
          proc_exit: (rval: number): number => {
            bindings.exit(rval);
            return constants_1.WASI_ESUCCESS; // Should not be reached
          },
          proc_raise: (sig: number): number => {
            if (!(sig in constants_1.SIGNAL_MAP)) {
              return constants_1.WASI_EINVAL;
            }
            bindings.kill(constants_1.SIGNAL_MAP[sig]);
            return constants_1.WASI_ESUCCESS; // Should not be reached if kill is successful
          },
          random_get: (bufPtr: number, bufLen: number): number => {
            this.refreshMemory();
            if (!this.memory) return constants_1.WASI_EINVAL;
            const buffer = new Uint8Array(this.memory.buffer, bufPtr, bufLen);
            bindings.randomFillSync(buffer);
            return constants_1.WASI_ESUCCESS;
          },
          sched_yield(): number {
            // TODO: Maybe Bun.sleep(0)?
            return constants_1.WASI_ESUCCESS;
          },
          sock_recv(): number {
            return constants_1.WASI_ENOSYS;
          },
          sock_send(): number {
            return constants_1.WASI_ENOSYS;
          },
          sock_shutdown(): number {
            return constants_1.WASI_ENOSYS;
          },
          sock_fcntlSetFlags(_fd: number, _flags: number): number {
            return constants_1.WASI_ENOSYS;
          },
          sock_pollSocket(_fd: number, _eventtype: string, _timeout_ms: number): number {
            return constants_1.WASI_ENOSYS;
          },
        };
        if (log.enabled) {
          Object.keys(this.wasiImport).forEach(key => {
            const prevImport = this.wasiImport[key];
            this.wasiImport[key] = function (...args2: any[]) {
              log(key, args2);
              try {
                let result = prevImport(...args2);
                log("result", result);
                return result;
              } catch (e) {
                log("error: ", e);
                throw e;
              }
            };
          });
        }
      }
      getState(): WASIState {
        return { env: this.env, FD_MAP: this.FD_MAP, bindings: this.bindings };
      }
      setState(state: WASIState) {
        this.env = state.env;
        this.FD_MAP = state.FD_MAP;
        this.bindings = state.bindings;
        fs = this.bindings.fs; // Update fs reference
      }
      fstatSync(real_fd: number): Stats {
        if (real_fd <= 2) {
          try {
            // Use type assertion to satisfy TS about the argument count, assuming the underlying call is correct.
            return (fs as typeof import("node:fs")).fstatSync(real_fd);
          } catch {
            const now = new Date();
            // Provide a minimal mock Stats object for stdio if fstat fails
            return {
              dev: 0,
              mode: 8592, // S_IFCHR | 0666
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
              atime: now,
              mtime: now,
              ctime: now,
              birthtime: new Date(0),
              isBlockDevice: () => false,
              isCharacterDevice: () => true,
              isDirectory: () => false,
              isFIFO: () => false,
              isFile: () => false,
              isSocket: () => false,
              isSymbolicLink: () => false,
            } as unknown as Stats; // Cast needed because the mock is incomplete
          }
        }
        return (fs as typeof import("node:fs")).fstatSync(real_fd);
      }
      shortPause() {
        if (this.sleep == null) return;
        const now = Date.now();
        if (BigInt(now) - this.lastStdin > 2000n) {
          this.sleep(50);
        }
      }
      getUnusedFileDescriptor(start = 3): number {
        let fd = start;
        while (this.FD_MAP.has(fd)) {
          fd += 1;
        }
        if (fd > SC_OPEN_MAX) {
          throw Error("no available file descriptors");
        }
        return fd;
      }
      refreshMemory() {
        if (this.memory && (!this.view || this.view.buffer.byteLength === 0)) {
          this.view = new DataView(this.memory.buffer);
        }
      }
      setMemory(memory: WebAssembly.Memory) {
        this.memory = memory;
        this.view = undefined; // Force refresh on next access
      }
      start(instance: WebAssembly.Instance, memory?: WebAssembly.Memory) {
        const exports2 = instance.exports;
        if (exports2 === null || typeof exports2 !== "object") {
          throw new Error(`instance.exports must be an Object. Received ${exports2}.`);
        }
        if (memory == null) {
          memory = exports2.memory as WebAssembly.Memory;
          if (!(memory instanceof WebAssembly.Memory)) {
            throw new Error(`instance.exports.memory must be a WebAssembly.Memory. Recceived ${memory}.`);
          }
        }
        this.setMemory(memory);
        if (exports2._start && typeof exports2._start === "function") {
          exports2._start();
        }
      }
      getImports(module2: WebAssembly.Module): Record<string, Record<string, any>> {
        let namespace: string | null = null;
        const imports = WebAssembly.Module.imports(module2);

        for (let imp of imports) {
          if (imp.kind !== "function") {
            continue;
          }
          if (!imp.module.startsWith("wasi_")) {
            continue;
          }

          namespace = imp.module;
          break;
        }

        switch (namespace) {
          case "wasi_unstable":
            return {
              wasi_unstable: this.wasiImport,
            };
          case "wasi_snapshot_preview1":
            return {
              wasi_snapshot_preview1: this.wasiImport,
            };
          default: {
            throw new Error(
              "No WASI namespace found. Only wasi_unstable and wasi_snapshot_preview1 are supported.\n\nList of imports:\n\n" +
                imports.map(({ name, kind, module }) => `${module}:${name} (${kind})`).join("\n") +
                "\n",
            );
          }
        }
      }
      initWasiFdInfo() {
        if (this.env["WASI_FD_INFO"] != null) {
          const fdInfo = JSON.parse(this.env["WASI_FD_INFO"]);
          for (const wasi_fd in fdInfo) {
            console.log(wasi_fd);
            const fd = parseInt(wasi_fd);
            if (this.FD_MAP.has(fd)) {
              continue;
            }
            const real = fdInfo[wasi_fd];
            try {
              this.fstatSync(real);
            } catch {
              console.log("discarding ", { wasi_fd, real });
              continue;
            }
            const file: WASIFileDescriptor = {
              real,
              filetype: constants_1.WASI_FILETYPE_SOCKET_STREAM, // Assuming socket stream, might need refinement
              rights: {
                base: STDIN_DEFAULT_RIGHTS, // Defaulting to stdin rights, might need refinement
                inheriting: 0n,
              },
            };
            this.FD_MAP.set(fd, file);
          }
          console.log("after initWasiFdInfo: ", this.FD_MAP);
          console.log("fdInfo = ", fdInfo);
        } else {
          console.log("no WASI_FD_INFO");
        }
      }
    };
    // Define the instance type alias here
    type WASIInstance = InstanceType<typeof WASIClass>;
    exports.default = WASIClass;
  },
});
export default { WASI: require_wasi().default };