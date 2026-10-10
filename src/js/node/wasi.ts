// Hardcoded module "node:wasi"
// HUGE thanks to:
// - @williamstein and https://github.com/sagemathinc/cowasm/tree/main/core/wasi-js
// - @syrusakbary for wasmer-js https://github.com/wasmerio/wasmer-js
// - Gus Caplan for node-wasi https://github.com/devsnek/node-wasi
//
// Eventually we will implement this in native code, but this is just a quick hack to get WASI working.

const nodeFsConstants: typeof $processBindingConstants.fs & { O_RSYNC?: number } = $processBindingConstants.fs;

interface WASIBindings {
  hrtime: () => bigint;
  exit: (code: number) => void;
  kill: (signal: string) => void;
  randomFillSync: <T extends ArrayBufferView>(array: T) => T;
  isTTY: (fd: number) => boolean;
  fs: typeof import("node:fs");
  path: typeof import("node:path");
}

interface WASIConfig {
  args?: string[];
  env?: Record<string, string>;
  preopens?: Record<string, string>;
  bindings?: WASIBindings;
  sleep?: (ms: number) => void;
  getStdin?: () => Buffer | undefined;
  sendStdout?: (data: Uint8Array) => void;
  sendStderr?: (data: Uint8Array) => void;
}

/** What the `wasiImport` functions catch: a `WASIError`, or a `node:fs` error (possibly chained through `prev`). */
interface WASICaughtError {
  code?: unknown;
  prev?: WASICaughtError | null;
}

interface WASIFileDescriptor {
  real: number;
  filetype?: number;
  rights: { base: bigint; inheriting: bigint };
  path: string;
  fakePath?: string;
  offset?: bigint;
}

class WASIError extends Error {
  declare errno: number;

  constructor(errno: number) {
    super();
    this.errno = errno;
    Object.setPrototypeOf(this, WASIError.prototype);
  }
}

const WASI_ESUCCESS = 0;
const WASI_E2BIG = 1;
const WASI_EACCES = 2;
const WASI_EADDRINUSE = 3;
const WASI_EADDRNOTAVAIL = 4;
const WASI_EAFNOSUPPORT = 5;
const WASI_EAGAIN = 6;
const WASI_EALREADY = 7;
const WASI_EBADF = 8;
const WASI_EBADMSG = 9;
const WASI_EBUSY = 10;
const WASI_ECANCELED = 11;
const WASI_ECHILD = 12;
const WASI_ECONNABORTED = 13;
const WASI_ECONNREFUSED = 14;
const WASI_ECONNRESET = 15;
const WASI_EDEADLK = 16;
const WASI_EDESTADDRREQ = 17;
const WASI_EDOM = 18;
const WASI_EDQUOT = 19;
const WASI_EEXIST = 20;
const WASI_EFAULT = 21;
const WASI_EFBIG = 22;
const WASI_EHOSTUNREACH = 23;
const WASI_EIDRM = 24;
const WASI_EILSEQ = 25;
const WASI_EINPROGRESS = 26;
const WASI_EINTR = 27;
const WASI_EINVAL = 28;
const WASI_EIO = 29;
const WASI_EISCONN = 30;
const WASI_EISDIR = 31;
const WASI_ELOOP = 32;
const WASI_EMFILE = 33;
const WASI_EMLINK = 34;
const WASI_EMSGSIZE = 35;
const WASI_EMULTIHOP = 36;
const WASI_ENAMETOOLONG = 37;
const WASI_ENETDOWN = 38;
const WASI_ENETRESET = 39;
const WASI_ENETUNREACH = 40;
const WASI_ENFILE = 41;
const WASI_ENOBUFS = 42;
const WASI_ENODEV = 43;
const WASI_ENOENT = 44;
const WASI_ENOEXEC = 45;
const WASI_ENOLCK = 46;
const WASI_ENOLINK = 47;
const WASI_ENOMEM = 48;
const WASI_ENOMSG = 49;
const WASI_ENOPROTOOPT = 50;
const WASI_ENOSPC = 51;
const WASI_ENOSYS = 52;
const WASI_ENOTCONN = 53;
const WASI_ENOTDIR = 54;
const WASI_ENOTEMPTY = 55;
const WASI_ENOTRECOVERABLE = 56;
const WASI_ENOTSOCK = 57;
const WASI_ENOTTY = 59;
const WASI_ENXIO = 60;
const WASI_EOVERFLOW = 61;
const WASI_EOWNERDEAD = 62;
const WASI_EPERM = 63;
const WASI_EPIPE = 64;
const WASI_EPROTO = 65;
const WASI_EPROTONOSUPPORT = 66;
const WASI_EPROTOTYPE = 67;
const WASI_ERANGE = 68;
const WASI_EROFS = 69;
const WASI_ESPIPE = 70;
const WASI_ESRCH = 71;
const WASI_ESTALE = 72;
const WASI_ETIMEDOUT = 73;
const WASI_ETXTBSY = 74;
const WASI_EXDEV = 75;
const WASI_ENOTCAPABLE = 76;
const WASI_SIGABRT = 0;
const WASI_SIGALRM = 1;
const WASI_SIGBUS = 2;
const WASI_SIGCHLD = 3;
const WASI_SIGCONT = 4;
const WASI_SIGFPE = 5;
const WASI_SIGHUP = 6;
const WASI_SIGILL = 7;
const WASI_SIGINT = 8;
const WASI_SIGKILL = 9;
const WASI_SIGPIPE = 10;
const WASI_SIGQUIT = 11;
const WASI_SIGSEGV = 12;
const WASI_SIGSTOP = 13;
const WASI_SIGTERM = 14;
const WASI_SIGTRAP = 15;
const WASI_SIGTSTP = 16;
const WASI_SIGTTIN = 17;
const WASI_SIGTTOU = 18;
const WASI_SIGURG = 19;
const WASI_SIGUSR1 = 20;
const WASI_SIGUSR2 = 21;
const WASI_SIGVTALRM = 22;
const WASI_SIGXCPU = 23;
const WASI_SIGXFSZ = 24;
const WASI_FILETYPE_UNKNOWN = 0;
const WASI_FILETYPE_BLOCK_DEVICE = 1;
const WASI_FILETYPE_CHARACTER_DEVICE = 2;
const WASI_FILETYPE_DIRECTORY = 3;
const WASI_FILETYPE_REGULAR_FILE = 4;
const WASI_FILETYPE_SOCKET_STREAM = 6;
const WASI_FILETYPE_SYMBOLIC_LINK = 7;
const WASI_FDFLAG_APPEND = 1;
const WASI_FDFLAG_DSYNC = 2;
const WASI_FDFLAG_NONBLOCK = 4;
const WASI_FDFLAG_RSYNC = 8;
const WASI_FDFLAG_SYNC = 16;
const WASI_RIGHT_FD_DATASYNC = BigInt(1);
const WASI_RIGHT_FD_READ = BigInt(2);
const WASI_RIGHT_FD_SEEK = BigInt(4);
const WASI_RIGHT_FD_FDSTAT_SET_FLAGS = BigInt(8);
const WASI_RIGHT_FD_SYNC = BigInt(16);
const WASI_RIGHT_FD_TELL = BigInt(32);
const WASI_RIGHT_FD_WRITE = BigInt(64);
const WASI_RIGHT_FD_ADVISE = BigInt(128);
const WASI_RIGHT_FD_ALLOCATE = BigInt(256);
const WASI_RIGHT_PATH_CREATE_DIRECTORY = BigInt(512);
const WASI_RIGHT_PATH_CREATE_FILE = BigInt(1024);
const WASI_RIGHT_PATH_LINK_SOURCE = BigInt(2048);
const WASI_RIGHT_PATH_LINK_TARGET = BigInt(4096);
const WASI_RIGHT_PATH_OPEN = BigInt(8192);
const WASI_RIGHT_FD_READDIR = BigInt(16384);
const WASI_RIGHT_PATH_READLINK = BigInt(32768);
const WASI_RIGHT_PATH_RENAME_SOURCE = BigInt(65536);
const WASI_RIGHT_PATH_RENAME_TARGET = BigInt(131072);
const WASI_RIGHT_PATH_FILESTAT_GET = BigInt(262144);
const WASI_RIGHT_PATH_FILESTAT_SET_SIZE = BigInt(524288);
const WASI_RIGHT_PATH_FILESTAT_SET_TIMES = BigInt(1048576);
const WASI_RIGHT_FD_FILESTAT_GET = BigInt(2097152);
const WASI_RIGHT_FD_FILESTAT_SET_SIZE = BigInt(4194304);
const WASI_RIGHT_FD_FILESTAT_SET_TIMES = BigInt(8388608);
const WASI_RIGHT_PATH_SYMLINK = BigInt(16777216);
const WASI_RIGHT_PATH_REMOVE_DIRECTORY = BigInt(33554432);
const WASI_RIGHT_PATH_UNLINK_FILE = BigInt(67108864);
const WASI_RIGHT_POLL_FD_READWRITE = BigInt(134217728);
const WASI_RIGHT_SOCK_SHUTDOWN = BigInt(268435456);
const RIGHTS_ALL =
  WASI_RIGHT_FD_DATASYNC |
  WASI_RIGHT_FD_READ |
  WASI_RIGHT_FD_SEEK |
  WASI_RIGHT_FD_FDSTAT_SET_FLAGS |
  WASI_RIGHT_FD_SYNC |
  WASI_RIGHT_FD_TELL |
  WASI_RIGHT_FD_WRITE |
  WASI_RIGHT_FD_ADVISE |
  WASI_RIGHT_FD_ALLOCATE |
  WASI_RIGHT_PATH_CREATE_DIRECTORY |
  WASI_RIGHT_PATH_CREATE_FILE |
  WASI_RIGHT_PATH_LINK_SOURCE |
  WASI_RIGHT_PATH_LINK_TARGET |
  WASI_RIGHT_PATH_OPEN |
  WASI_RIGHT_FD_READDIR |
  WASI_RIGHT_PATH_READLINK |
  WASI_RIGHT_PATH_RENAME_SOURCE |
  WASI_RIGHT_PATH_RENAME_TARGET |
  WASI_RIGHT_PATH_FILESTAT_GET |
  WASI_RIGHT_PATH_FILESTAT_SET_SIZE |
  WASI_RIGHT_PATH_FILESTAT_SET_TIMES |
  WASI_RIGHT_FD_FILESTAT_GET |
  WASI_RIGHT_FD_FILESTAT_SET_TIMES |
  WASI_RIGHT_FD_FILESTAT_SET_SIZE |
  WASI_RIGHT_PATH_SYMLINK |
  WASI_RIGHT_PATH_UNLINK_FILE |
  WASI_RIGHT_PATH_REMOVE_DIRECTORY |
  WASI_RIGHT_POLL_FD_READWRITE |
  WASI_RIGHT_SOCK_SHUTDOWN;
const RIGHTS_BLOCK_DEVICE_BASE = RIGHTS_ALL;
const RIGHTS_BLOCK_DEVICE_INHERITING = RIGHTS_ALL;
const RIGHTS_CHARACTER_DEVICE_BASE = RIGHTS_ALL;
const RIGHTS_CHARACTER_DEVICE_INHERITING = RIGHTS_ALL;
const RIGHTS_REGULAR_FILE_BASE =
  WASI_RIGHT_FD_DATASYNC |
  WASI_RIGHT_FD_READ |
  WASI_RIGHT_FD_SEEK |
  WASI_RIGHT_FD_FDSTAT_SET_FLAGS |
  WASI_RIGHT_FD_SYNC |
  WASI_RIGHT_FD_TELL |
  WASI_RIGHT_FD_WRITE |
  WASI_RIGHT_FD_ADVISE |
  WASI_RIGHT_FD_ALLOCATE |
  WASI_RIGHT_FD_FILESTAT_GET |
  WASI_RIGHT_FD_FILESTAT_SET_SIZE |
  WASI_RIGHT_FD_FILESTAT_SET_TIMES |
  WASI_RIGHT_POLL_FD_READWRITE;
const RIGHTS_REGULAR_FILE_INHERITING = BigInt(0);
const RIGHTS_DIRECTORY_BASE =
  WASI_RIGHT_FD_FDSTAT_SET_FLAGS |
  WASI_RIGHT_FD_SYNC |
  WASI_RIGHT_FD_ADVISE |
  WASI_RIGHT_PATH_CREATE_DIRECTORY |
  WASI_RIGHT_PATH_CREATE_FILE |
  WASI_RIGHT_PATH_LINK_SOURCE |
  WASI_RIGHT_PATH_LINK_TARGET |
  WASI_RIGHT_PATH_OPEN |
  WASI_RIGHT_FD_READDIR |
  WASI_RIGHT_PATH_READLINK |
  WASI_RIGHT_PATH_RENAME_SOURCE |
  WASI_RIGHT_PATH_RENAME_TARGET |
  WASI_RIGHT_PATH_FILESTAT_GET |
  WASI_RIGHT_PATH_FILESTAT_SET_SIZE |
  WASI_RIGHT_PATH_FILESTAT_SET_TIMES |
  WASI_RIGHT_FD_FILESTAT_GET |
  WASI_RIGHT_FD_FILESTAT_SET_TIMES |
  WASI_RIGHT_PATH_SYMLINK |
  WASI_RIGHT_PATH_UNLINK_FILE |
  WASI_RIGHT_PATH_REMOVE_DIRECTORY |
  WASI_RIGHT_POLL_FD_READWRITE;
const RIGHTS_DIRECTORY_INHERITING = RIGHTS_DIRECTORY_BASE | RIGHTS_REGULAR_FILE_BASE;
const RIGHTS_SOCKET_BASE =
  WASI_RIGHT_FD_READ |
  WASI_RIGHT_FD_FDSTAT_SET_FLAGS |
  WASI_RIGHT_FD_WRITE |
  WASI_RIGHT_FD_FILESTAT_GET |
  WASI_RIGHT_POLL_FD_READWRITE |
  WASI_RIGHT_SOCK_SHUTDOWN;
const RIGHTS_SOCKET_INHERITING = RIGHTS_ALL;
const RIGHTS_TTY_BASE =
  WASI_RIGHT_FD_READ |
  WASI_RIGHT_FD_FDSTAT_SET_FLAGS |
  WASI_RIGHT_FD_WRITE |
  WASI_RIGHT_FD_FILESTAT_GET |
  WASI_RIGHT_POLL_FD_READWRITE;
const RIGHTS_TTY_INHERITING = BigInt(0);
const WASI_CLOCK_REALTIME = 0;
const WASI_CLOCK_MONOTONIC = 1;
const WASI_CLOCK_PROCESS_CPUTIME_ID = 2;
const WASI_CLOCK_THREAD_CPUTIME_ID = 3;
const WASI_EVENTTYPE_CLOCK = 0;
const WASI_EVENTTYPE_FD_READ = 1;
const WASI_EVENTTYPE_FD_WRITE = 2;
const WASI_FILESTAT_SET_ATIM = 1 << 0;
const WASI_FILESTAT_SET_ATIM_NOW = 1 << 1;
const WASI_FILESTAT_SET_MTIM = 1 << 2;
const WASI_FILESTAT_SET_MTIM_NOW = 1 << 3;
const WASI_O_CREAT = 1 << 0;
const WASI_O_DIRECTORY = 1 << 1;
const WASI_O_EXCL = 1 << 2;
const WASI_O_TRUNC = 1 << 3;
const WASI_PREOPENTYPE_DIR = 0;
const WASI_STDIN_FILENO = 0;
const WASI_STDOUT_FILENO = 1;
const WASI_STDERR_FILENO = 2;
const WASI_WHENCE_SET = 0;
const WASI_WHENCE_CUR = 1;
const WASI_WHENCE_END = 2;
const ERROR_MAP = {
  E2BIG: WASI_E2BIG,
  EACCES: WASI_EACCES,
  EADDRINUSE: WASI_EADDRINUSE,
  EADDRNOTAVAIL: WASI_EADDRNOTAVAIL,
  EAFNOSUPPORT: WASI_EAFNOSUPPORT,
  EALREADY: WASI_EALREADY,
  EAGAIN: WASI_EAGAIN,
  EBADF: WASI_EBADF,
  EBADMSG: WASI_EBADMSG,
  EBUSY: WASI_EBUSY,
  ECANCELED: WASI_ECANCELED,
  ECHILD: WASI_ECHILD,
  ECONNABORTED: WASI_ECONNABORTED,
  ECONNREFUSED: WASI_ECONNREFUSED,
  ECONNRESET: WASI_ECONNRESET,
  EDEADLOCK: WASI_EDEADLK,
  EDESTADDRREQ: WASI_EDESTADDRREQ,
  EDOM: WASI_EDOM,
  EDQUOT: WASI_EDQUOT,
  EEXIST: WASI_EEXIST,
  EFAULT: WASI_EFAULT,
  EFBIG: WASI_EFBIG,
  EHOSTDOWN: WASI_EHOSTUNREACH,
  EHOSTUNREACH: WASI_EHOSTUNREACH,
  EIDRM: WASI_EIDRM,
  EILSEQ: WASI_EILSEQ,
  EINPROGRESS: WASI_EINPROGRESS,
  EINTR: WASI_EINTR,
  EINVAL: WASI_EINVAL,
  EIO: WASI_EIO,
  EISCONN: WASI_EISCONN,
  EISDIR: WASI_EISDIR,
  ELOOP: WASI_ELOOP,
  EMFILE: WASI_EMFILE,
  EMLINK: WASI_EMLINK,
  EMSGSIZE: WASI_EMSGSIZE,
  EMULTIHOP: WASI_EMULTIHOP,
  ENAMETOOLONG: WASI_ENAMETOOLONG,
  ENETDOWN: WASI_ENETDOWN,
  ENETRESET: WASI_ENETRESET,
  ENETUNREACH: WASI_ENETUNREACH,
  ENFILE: WASI_ENFILE,
  ENOBUFS: WASI_ENOBUFS,
  ENODEV: WASI_ENODEV,
  ENOENT: WASI_ENOENT,
  ENOEXEC: WASI_ENOEXEC,
  ENOLCK: WASI_ENOLCK,
  ENOLINK: WASI_ENOLINK,
  ENOMEM: WASI_ENOMEM,
  ENOMSG: WASI_ENOMSG,
  ENOPROTOOPT: WASI_ENOPROTOOPT,
  ENOSPC: WASI_ENOSPC,
  ENOSYS: WASI_ENOSYS,
  ENOTCONN: WASI_ENOTCONN,
  ENOTDIR: WASI_ENOTDIR,
  ENOTEMPTY: WASI_ENOTEMPTY,
  ENOTRECOVERABLE: WASI_ENOTRECOVERABLE,
  ENOTSOCK: WASI_ENOTSOCK,
  ENOTTY: WASI_ENOTTY,
  ENXIO: WASI_ENXIO,
  EOVERFLOW: WASI_EOVERFLOW,
  EOWNERDEAD: WASI_EOWNERDEAD,
  EPERM: WASI_EPERM,
  EPIPE: WASI_EPIPE,
  EPROTO: WASI_EPROTO,
  EPROTONOSUPPORT: WASI_EPROTONOSUPPORT,
  EPROTOTYPE: WASI_EPROTOTYPE,
  ERANGE: WASI_ERANGE,
  EROFS: WASI_EROFS,
  ESPIPE: WASI_ESPIPE,
  ESRCH: WASI_ESRCH,
  ESTALE: WASI_ESTALE,
  ETIMEDOUT: WASI_ETIMEDOUT,
  ETXTBSY: WASI_ETXTBSY,
  EXDEV: WASI_EXDEV,
};
const SIGNAL_MAP = {
  [WASI_SIGHUP]: "SIGHUP",
  [WASI_SIGINT]: "SIGINT",
  [WASI_SIGQUIT]: "SIGQUIT",
  [WASI_SIGILL]: "SIGILL",
  [WASI_SIGTRAP]: "SIGTRAP",
  [WASI_SIGABRT]: "SIGABRT",
  [WASI_SIGBUS]: "SIGBUS",
  [WASI_SIGFPE]: "SIGFPE",
  [WASI_SIGKILL]: "SIGKILL",
  [WASI_SIGUSR1]: "SIGUSR1",
  [WASI_SIGSEGV]: "SIGSEGV",
  [WASI_SIGUSR2]: "SIGUSR2",
  [WASI_SIGPIPE]: "SIGPIPE",
  [WASI_SIGALRM]: "SIGALRM",
  [WASI_SIGTERM]: "SIGTERM",
  [WASI_SIGCHLD]: "SIGCHLD",
  [WASI_SIGCONT]: "SIGCONT",
  [WASI_SIGSTOP]: "SIGSTOP",
  [WASI_SIGTSTP]: "SIGTSTP",
  [WASI_SIGTTIN]: "SIGTTIN",
  [WASI_SIGTTOU]: "SIGTTOU",
  [WASI_SIGURG]: "SIGURG",
  [WASI_SIGXCPU]: "SIGXCPU",
  [WASI_SIGXFSZ]: "SIGXFSZ",
  [WASI_SIGVTALRM]: "SIGVTALRM",
};

let fs;
var SC_OPEN_MAX = 32768;

var STDIN_DEFAULT_RIGHTS =
  WASI_RIGHT_FD_DATASYNC |
  WASI_RIGHT_FD_READ |
  WASI_RIGHT_FD_SYNC |
  WASI_RIGHT_FD_ADVISE |
  WASI_RIGHT_FD_FILESTAT_GET |
  WASI_RIGHT_POLL_FD_READWRITE;
var STDOUT_DEFAULT_RIGHTS =
  WASI_RIGHT_FD_DATASYNC |
  WASI_RIGHT_FD_WRITE |
  WASI_RIGHT_FD_SYNC |
  WASI_RIGHT_FD_ADVISE |
  WASI_RIGHT_FD_FILESTAT_GET |
  WASI_RIGHT_POLL_FD_READWRITE;
var STDERR_DEFAULT_RIGHTS = STDOUT_DEFAULT_RIGHTS;
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
      let e = err as WASICaughtError;
      while (e.prev != null) {
        e = e.prev;
      }
      if (e?.code && typeof e?.code === "string") {
        return ERROR_MAP[e.code] || WASI_EINVAL;
      }
      if (e instanceof WASIError) {
        return e.errno;
      }
      throw e;
    }
  };
var stat = (wasi: WASI, fd: number) => {
  const entry = wasi.FD_MAP.get(fd);
  if (!entry) {
    throw new WASIError(WASI_EBADF);
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
var translateFileAttributes = (wasi, fd, stats) => {
  switch (true) {
    case stats.isBlockDevice():
      return {
        filetype: WASI_FILETYPE_BLOCK_DEVICE,
        rightsBase: RIGHTS_BLOCK_DEVICE_BASE,
        rightsInheriting: RIGHTS_BLOCK_DEVICE_INHERITING,
      };
    case stats.isCharacterDevice(): {
      const filetype = WASI_FILETYPE_CHARACTER_DEVICE;
      if (fd !== void 0 && wasi.bindings.isTTY(fd)) {
        return {
          filetype,
          rightsBase: RIGHTS_TTY_BASE,
          rightsInheriting: RIGHTS_TTY_INHERITING,
        };
      }
      return {
        filetype,
        rightsBase: RIGHTS_CHARACTER_DEVICE_BASE,
        rightsInheriting: RIGHTS_CHARACTER_DEVICE_INHERITING,
      };
    }
    case stats.isDirectory():
      return {
        filetype: WASI_FILETYPE_DIRECTORY,
        rightsBase: RIGHTS_DIRECTORY_BASE,
        rightsInheriting: RIGHTS_DIRECTORY_INHERITING,
      };
    case stats.isFIFO():
      return {
        filetype: WASI_FILETYPE_SOCKET_STREAM,
        rightsBase: RIGHTS_SOCKET_BASE,
        rightsInheriting: RIGHTS_SOCKET_INHERITING,
      };
    case stats.isFile():
      return {
        filetype: WASI_FILETYPE_REGULAR_FILE,
        rightsBase: RIGHTS_REGULAR_FILE_BASE,
        rightsInheriting: RIGHTS_REGULAR_FILE_INHERITING,
      };
    case stats.isSocket():
      return {
        filetype: WASI_FILETYPE_SOCKET_STREAM,
        rightsBase: RIGHTS_SOCKET_BASE,
        rightsInheriting: RIGHTS_SOCKET_INHERITING,
      };
    case stats.isSymbolicLink():
      return {
        filetype: WASI_FILETYPE_SYMBOLIC_LINK,
        rightsBase: BigInt(0),
        rightsInheriting: BigInt(0),
      };
    default:
      return {
        filetype: WASI_FILETYPE_UNKNOWN,
        rightsBase: BigInt(0),
        rightsInheriting: BigInt(0),
      };
  }
};
var warnedAboutSleep = false;

var defaultConfig;
function getDefaults() {
  if (defaultConfig) return defaultConfig;

  const defaultBindings = {
    hrtime: () => process.hrtime.bigint(),
    exit: code => {
      process.exit(code);
    },
    kill: signal => {
      process.kill(process.pid, signal);
    },
    randomFillSync: array => crypto.getRandomValues(array),
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
  });
}

class WASI {
  declare lastStdin: number;
  declare sleep: ((ms: number) => void) | undefined;
  declare getStdin: ((this: WASI) => Buffer | undefined) | undefined;
  declare sendStdout: ((data: Uint8Array) => void) | undefined;
  declare sendStderr: ((data: Uint8Array) => void) | undefined;
  declare env: Record<string, string>;
  declare memory: WebAssembly.Memory;
  declare view: DataView;
  declare bindings: WASIBindings;
  declare FD_MAP: Map<number, WASIFileDescriptor>;
  declare wasiImport: Record<string, (...args: any[]) => any>;
  declare stdinBuffer: Buffer | undefined;

  constructor(wasiConfig: WASIConfig = {}) {
    const defaultConfig = getDefaults();
    this.lastStdin = 0;
    this.sleep = wasiConfig.sleep || defaultConfig.sleep;
    this.getStdin = wasiConfig.getStdin;
    this.sendStdout = wasiConfig.sendStdout;
    this.sendStderr = wasiConfig.sendStderr;
    let preopens: Record<string, string> = wasiConfig.preopens ?? defaultConfig.preopens;
    this.env = wasiConfig.env ?? defaultConfig.env;

    const args = wasiConfig.args ?? defaultConfig.args;
    this.memory = void 0 as unknown as WebAssembly.Memory;
    this.view = void 0 as unknown as DataView;
    this.bindings = wasiConfig.bindings || defaultConfig.bindings;
    const bindings = this.bindings;
    fs = bindings.fs;
    this.FD_MAP = /* @__PURE__ */ new Map([
      [
        WASI_STDIN_FILENO,
        {
          real: 0,
          filetype: WASI_FILETYPE_CHARACTER_DEVICE,
          rights: {
            base: STDIN_DEFAULT_RIGHTS,
            inheriting: BigInt(0),
          },
          path: "/dev/stdin",
        },
      ],
      [
        WASI_STDOUT_FILENO,
        {
          real: 1,
          filetype: WASI_FILETYPE_CHARACTER_DEVICE,
          rights: {
            base: STDOUT_DEFAULT_RIGHTS,
            inheriting: BigInt(0),
          },
          path: "/dev/stdout",
        },
      ],
      [
        WASI_STDERR_FILENO,
        {
          real: 2,
          filetype: WASI_FILETYPE_CHARACTER_DEVICE,
          rights: {
            base: STDERR_DEFAULT_RIGHTS,
            inheriting: BigInt(0),
          },
          path: "/dev/stderr",
        },
      ],
    ]);
    const path = bindings.path;
    for (const [k, v] of Object.entries(preopens)) {
      const real = fs.openSync(v, nodeFsConstants.O_RDONLY);
      const newfd = this.getUnusedFileDescriptor();
      this.FD_MAP.set(newfd, {
        real,
        filetype: WASI_FILETYPE_DIRECTORY,
        rights: {
          base: RIGHTS_DIRECTORY_BASE,
          inheriting: RIGHTS_DIRECTORY_INHERITING,
        },
        fakePath: k,
        path: v,
      });
    }
    const getiovs = (iovs, iovsLen) => {
      this.refreshMemory();

      const { view, memory } = this;
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
          bufLen = Math.min(bufLen, Math.max(0, byteLength - buf));
        }
        try {
          return [new Uint8Array(buffer, buf, bufLen)];
        } catch (err) {
          console.warn("WASI.getiovs -- invalid buffer", err);
          throw new WASIError(WASI_EINVAL);
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
          bufLen = Math.min(bufLen, Math.max(0, byteLength - buf));
        }
        try {
          buffers[i] = new Uint8Array(buffer, buf, bufLen);
        } catch (err) {
          console.warn("WASI.getiovs -- invalid buffer", err);
          throw new WASIError(WASI_EINVAL);
        }
      }
      return buffers;
    };
    const CHECK_FD = (fd: number, rights: bigint) => {
      const stats = stat(this, fd);
      if (rights !== BigInt(0) && (stats.rights.base & rights) === BigInt(0)) {
        throw new WASIError(WASI_EPERM);
      }
      return stats;
    };
    // Resolve a guest-supplied path against the directory backing `stats` and
    // verify the result cannot escape that directory, either lexically
    // ("..", absolute paths) or through a symlink that already exists on the
    // host filesystem.
    const RESOLVE_PATH = (stats, guestPath) => {
      if (!stats.path) {
        throw new WASIError(WASI_EINVAL);
      }
      // WASI paths are always interpreted relative to the directory fd.
      // Re-root absolute guest paths under the preopen instead of letting
      // them name an arbitrary host path.
      let rel = String(guestPath);
      while (rel.length !== 0 && (rel.charCodeAt(0) === 47 /* "/" */ || rel.charCodeAt(0) === 92) /* "\\" */) {
        rel = rel.slice(1);
      }
      const base = path.resolve(stats.path);
      const resolved = path.resolve(base, rel);
      const isContained = (parent, child) =>
        child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
      if (!isContained(base, resolved)) {
        throw new WASIError(WASI_ENOTCAPABLE);
      }
      // A symlink that already exists inside the sandbox can still point
      // outside of it. Resolve the closest existing ancestor with realpath
      // and re-check containment.
      let realBase = base;
      try {
        realBase = fs.realpathSync(base);
      } catch {}
      let probe = resolved;
      let suffix = "";
      for (;;) {
        let real;
        try {
          real = fs.realpathSync(probe);
        } catch {
          // Walk up on any resolution failure (ENOENT/ENOTDIR for
          // not-yet-created components, but also ELOOP etc.) so `real` is
          // always a *resolved* ancestor plus an unresolved suffix —
          // comparing an unresolved path against the resolved preopen
          // base would spuriously fail whenever the preopen itself
          // traverses a symlink (e.g. macOS /tmp -> /private/tmp).
          const parent = path.dirname(probe);
          if (parent !== probe) {
            suffix = path.sep + path.basename(probe) + suffix;
            probe = parent;
            continue;
          }
          real = probe;
        }
        if (!isContained(realBase, real + suffix)) {
          throw new WASIError(WASI_ENOTCAPABLE);
        }
        return resolved;
      }
    };
    const CPUTIME_START = Bun.nanoseconds();
    const timeOrigin = Math.trunc(performance.timeOrigin * 1e6);
    const now = clockId => {
      switch (clockId) {
        case WASI_CLOCK_MONOTONIC:
          return Bun.nanoseconds();
        case WASI_CLOCK_REALTIME:
          return Bun.nanoseconds() + timeOrigin;
        case WASI_CLOCK_PROCESS_CPUTIME_ID:
        case WASI_CLOCK_THREAD_CPUTIME_ID:
          return Bun.nanoseconds() - CPUTIME_START;
        default:
          return null;
      }
    };
    this.wasiImport = {
      args_get: (argv, argvBuf) => {
        this.refreshMemory();
        let coffset = argv;
        let offset = argvBuf;
        args.forEach(a => {
          this.view.setUint32(coffset, offset, true);
          coffset += 4;
          offset += Buffer.from(this.memory.buffer).write(`${a}\0`, offset);
        });
        return WASI_ESUCCESS;
      },
      args_sizes_get: (argc, argvBufSize) => {
        this.refreshMemory();
        this.view.setUint32(argc, args.length, true);
        const size = args.reduce((acc, a) => acc + Buffer.byteLength(a) + 1, 0);
        this.view.setUint32(argvBufSize, size, true);
        return WASI_ESUCCESS;
      },
      environ_get: (environ, environBuf) => {
        this.refreshMemory();
        let coffset = environ;
        let offset = environBuf;
        Object.entries(this.env).forEach(([key, value]) => {
          this.view.setUint32(coffset, offset, true);
          coffset += 4;
          offset += Buffer.from(this.memory.buffer).write(`${key}=${value}\0`, offset);
        });
        return WASI_ESUCCESS;
      },
      environ_sizes_get: (environCount, environBufSize) => {
        this.refreshMemory();
        const envProcessed = Object.entries(this.env).map(([key, value]) => `${key}=${value}\0`);
        const size = envProcessed.reduce((acc, e) => acc + Buffer.byteLength(e), 0);
        this.view.setUint32(environCount, envProcessed.length, true);
        this.view.setUint32(environBufSize, size, true);
        return WASI_ESUCCESS;
      },
      clock_res_get: (clockId, resolution) => {
        let res;
        switch (clockId) {
          case WASI_CLOCK_MONOTONIC:
          case WASI_CLOCK_PROCESS_CPUTIME_ID:
          case WASI_CLOCK_THREAD_CPUTIME_ID: {
            res = BigInt(1);
            break;
          }
          case WASI_CLOCK_REALTIME: {
            res = BigInt(1e3);
            break;
          }
        }
        if (!res) {
          throw Error("invalid clockId");
        }
        this.view.setBigUint64(resolution, res);
        return WASI_ESUCCESS;
      },
      clock_time_get: (clockId, _precision, time) => {
        this.refreshMemory();
        const n = now(clockId);
        if (n === null) {
          return WASI_EINVAL;
        }
        this.view.setBigUint64(time, BigInt(n), true);
        return WASI_ESUCCESS;
      },
      fd_advise: wrap((fd, _offset, _len, _advice) => {
        CHECK_FD(fd, WASI_RIGHT_FD_ADVISE);
        return WASI_ENOSYS;
      }),
      fd_allocate: wrap((fd, _offset, _len) => {
        CHECK_FD(fd, WASI_RIGHT_FD_ALLOCATE);
        return WASI_ENOSYS;
      }),
      fd_close: wrap(fd => {
        const stats = CHECK_FD(fd, BigInt(0));
        fs.closeSync(stats.real);
        this.FD_MAP.delete(fd);
        return WASI_ESUCCESS;
      }),
      fd_datasync: wrap(fd => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_DATASYNC);
        fs.fdatasyncSync(stats.real);
        return WASI_ESUCCESS;
      }),
      fd_fdstat_get: wrap((fd, bufPtr) => {
        const stats = CHECK_FD(fd, BigInt(0));
        this.refreshMemory();
        if (stats.filetype == null) {
          throw Error("stats.filetype must be set");
        }
        this.view.setUint8(bufPtr, stats.filetype);
        this.view.setUint16(bufPtr + 2, 0, true);
        this.view.setUint16(bufPtr + 4, 0, true);
        this.view.setBigUint64(bufPtr + 8, BigInt(stats.rights.base), true);
        this.view.setBigUint64(bufPtr + 8 + 8, BigInt(stats.rights.inheriting), true);
        return WASI_ESUCCESS;
      }),
      fd_fdstat_set_flags: wrap((fd, flags) => {
        CHECK_FD(fd, WASI_RIGHT_FD_FDSTAT_SET_FLAGS);
        if (this.wasiImport.sock_fcntlSetFlags(fd, flags) == 0) {
          return WASI_ESUCCESS;
        }
        return WASI_ENOSYS;
      }),
      fd_fdstat_set_rights: wrap((fd, fsRightsBase, fsRightsInheriting) => {
        const stats = CHECK_FD(fd, BigInt(0));
        fsRightsBase = BigInt.asUintN(64, fsRightsBase);
        fsRightsInheriting = BigInt.asUintN(64, fsRightsInheriting);
        const nrb = stats.rights.base | fsRightsBase;
        if (nrb > stats.rights.base) {
          return WASI_EPERM;
        }
        const nri = stats.rights.inheriting | fsRightsInheriting;
        if (nri > stats.rights.inheriting) {
          return WASI_EPERM;
        }
        stats.rights.base = fsRightsBase;
        stats.rights.inheriting = fsRightsInheriting;
        return WASI_ESUCCESS;
      }),
      fd_filestat_get: wrap((fd, bufPtr) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_FILESTAT_GET);
        const rstats = this.fstatSync(stats.real);
        this.refreshMemory();
        this.view.setBigUint64(bufPtr, BigInt(rstats.dev), true);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, BigInt(rstats.ino), true);
        bufPtr += 8;
        if (stats.filetype == null) {
          throw Error("stats.filetype must be set");
        }
        this.view.setUint8(bufPtr, stats.filetype);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, BigInt(rstats.nlink), true);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, BigInt(rstats.size), true);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, msToNs(rstats.atimeMs), true);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, msToNs(rstats.mtimeMs), true);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, msToNs(rstats.ctimeMs), true);
        return WASI_ESUCCESS;
      }),
      fd_filestat_set_size: wrap((fd, stSize) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_FILESTAT_SET_SIZE);
        fs.ftruncateSync(stats.real, Number(stSize));
        return WASI_ESUCCESS;
      }),
      fd_filestat_set_times: wrap((fd, stAtim, stMtim, fstflags) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_FILESTAT_SET_TIMES);
        const rstats = this.fstatSync(stats.real);
        let atim = rstats.atime;
        let mtim = rstats.mtime;
        const n = nsToMs(now(WASI_CLOCK_REALTIME));
        const atimflags = WASI_FILESTAT_SET_ATIM | WASI_FILESTAT_SET_ATIM_NOW;
        if ((fstflags & atimflags) === atimflags) {
          return WASI_EINVAL;
        }
        const mtimflags = WASI_FILESTAT_SET_MTIM | WASI_FILESTAT_SET_MTIM_NOW;
        if ((fstflags & mtimflags) === mtimflags) {
          return WASI_EINVAL;
        }
        if ((fstflags & WASI_FILESTAT_SET_ATIM) === WASI_FILESTAT_SET_ATIM) {
          atim = nsToMs(stAtim);
        } else if ((fstflags & WASI_FILESTAT_SET_ATIM_NOW) === WASI_FILESTAT_SET_ATIM_NOW) {
          atim = n;
        }
        if ((fstflags & WASI_FILESTAT_SET_MTIM) === WASI_FILESTAT_SET_MTIM) {
          mtim = nsToMs(stMtim);
        } else if ((fstflags & WASI_FILESTAT_SET_MTIM_NOW) === WASI_FILESTAT_SET_MTIM_NOW) {
          mtim = n;
        }
        fs.futimesSync(stats.real, new Date(atim), new Date(mtim));
        return WASI_ESUCCESS;
      }),
      fd_prestat_get: wrap((fd, bufPtr) => {
        const stats = CHECK_FD(fd, BigInt(0));
        this.refreshMemory();
        this.view.setUint8(bufPtr, WASI_PREOPENTYPE_DIR);
        this.view.setUint32(bufPtr + 4, Buffer.byteLength(stats.fakePath ?? stats.path ?? ""), true);
        return WASI_ESUCCESS;
      }),
      fd_prestat_dir_name: wrap((fd, pathPtr, pathLen) => {
        const stats = CHECK_FD(fd, BigInt(0));
        this.refreshMemory();
        Buffer.from(this.memory.buffer).write(stats.fakePath ?? stats.path ?? "", pathPtr, pathLen, "utf8");
        return WASI_ESUCCESS;
      }),
      fd_pwrite: wrap((fd, iovs, iovsLen, offset, nwritten) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_WRITE | WASI_RIGHT_FD_SEEK);
        let written = 0;
        getiovs(iovs, iovsLen).forEach(iov => {
          let w = 0;
          while (w < iov.byteLength) {
            w += fs.writeSync(stats.real, iov, w, iov.byteLength - w, Number(offset) + written + w);
          }
          written += w;
        });
        this.view.setUint32(nwritten, written, true);
        return WASI_ESUCCESS;
      }),
      fd_write: wrap((fd, iovs, iovsLen, nwritten) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_WRITE);
        const IS_STDOUT = fd == WASI_STDOUT_FILENO;
        const IS_STDERR = fd == WASI_STDERR_FILENO;
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
              if (stats.offset) stats.offset += BigInt(i);
              w += i;
            }
            written += w;
          }
        });
        this.view.setUint32(nwritten, written, true);
        return WASI_ESUCCESS;
      }),
      fd_pread: wrap((fd, iovs, iovsLen, offset, nread) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_READ | WASI_RIGHT_FD_SEEK);
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
        }
        this.view.setUint32(nread, read, true);
        return WASI_ESUCCESS;
      }),
      fd_read: wrap((fd, iovs, iovsLen, nread) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_READ);
        const IS_STDIN = fd == WASI_STDIN_FILENO;
        let read = 0;
        outer: for (const iov of getiovs(iovs, iovsLen)) {
          let r = 0;
          while (r < iov.byteLength) {
            let length = iov.byteLength - r;
            let position = IS_STDIN || stats.offset === void 0 ? null : Number(stats.offset);
            let rr = 0;
            if (IS_STDIN) {
              const getStdin = this.getStdin;
              if (getStdin != null) {
                if (this.stdinBuffer == null) {
                  this.stdinBuffer = getStdin.$call(this);
                }
                if (this.stdinBuffer != null) {
                  rr = this.stdinBuffer.copy(iov);
                  if (rr == this.stdinBuffer.length) {
                    this.stdinBuffer = void 0;
                  } else {
                    this.stdinBuffer = this.stdinBuffer.slice(rr);
                  }
                  if (rr > 0) {
                    this.lastStdin = new Date().valueOf();
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
                  this.lastStdin = new Date().valueOf();
                }
              }
            } else {
              rr = fs.readSync(stats.real, iov, r, length, position);
            }
            if (stats.filetype == WASI_FILETYPE_REGULAR_FILE) {
              stats.offset = (stats.offset ? stats.offset : BigInt(0)) + BigInt(rr);
            }
            r += rr;
            read += rr;
            if (rr === 0 || rr < length) {
              break outer;
            }
          }
        }
        this.view.setUint32(nread, read, true);
        return WASI_ESUCCESS;
      }),
      fd_readdir: wrap((fd, bufPtr, bufLen, cookie, bufusedPtr) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_READDIR);
        this.refreshMemory();
        const entries = fs.readdirSync(stats.path, { withFileTypes: true });
        const startPtr = bufPtr;
        for (let i = Number(cookie); i < entries.length; i += 1) {
          const entry = entries[i];
          let nameLength = Buffer.byteLength(entry.name);
          if (bufPtr - startPtr > bufLen) {
            break;
          }
          this.view.setBigUint64(bufPtr, BigInt(i + 1), true);
          bufPtr += 8;
          if (bufPtr - startPtr > bufLen) {
            break;
          }
          const rstats = fs.lstatSync(path.resolve(stats.path, entry.name));
          this.view.setBigUint64(bufPtr, BigInt(rstats.ino), true);
          bufPtr += 8;
          if (bufPtr - startPtr > bufLen) {
            break;
          }
          this.view.setUint32(bufPtr, nameLength, true);
          bufPtr += 4;
          if (bufPtr - startPtr > bufLen) {
            break;
          }
          let filetype;
          switch (true) {
            case rstats.isBlockDevice():
              filetype = WASI_FILETYPE_BLOCK_DEVICE;
              break;
            case rstats.isCharacterDevice():
              filetype = WASI_FILETYPE_CHARACTER_DEVICE;
              break;
            case rstats.isDirectory():
              filetype = WASI_FILETYPE_DIRECTORY;
              break;
            case rstats.isFIFO():
              filetype = WASI_FILETYPE_SOCKET_STREAM;
              break;
            case rstats.isFile():
              filetype = WASI_FILETYPE_REGULAR_FILE;
              break;
            case rstats.isSocket():
              filetype = WASI_FILETYPE_SOCKET_STREAM;
              break;
            case rstats.isSymbolicLink():
              filetype = WASI_FILETYPE_SYMBOLIC_LINK;
              break;
            default:
              filetype = WASI_FILETYPE_UNKNOWN;
              break;
          }
          this.view.setUint8(bufPtr, filetype);
          bufPtr += 1;
          bufPtr += 3;
          if (bufPtr + nameLength >= startPtr + bufLen) {
            break;
          }
          let memory_buffer = Buffer.from(this.memory.buffer);
          memory_buffer.write(entry.name, bufPtr);
          bufPtr += nameLength;
        }
        const bufused = bufPtr - startPtr;
        this.view.setUint32(bufusedPtr, Math.min(bufused, bufLen), true);
        return WASI_ESUCCESS;
      }),
      fd_renumber: wrap((from, to) => {
        const fromEntry = CHECK_FD(from, BigInt(0));
        const toEntry = CHECK_FD(to, BigInt(0));
        fs.closeSync(fromEntry.real);
        this.FD_MAP.set(from, toEntry);
        this.FD_MAP.delete(to);
        return WASI_ESUCCESS;
      }),
      fd_seek: wrap((fd, offset, whence, newOffsetPtr) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_SEEK);
        this.refreshMemory();
        switch (whence) {
          case WASI_WHENCE_CUR:
            stats.offset = (stats.offset ? stats.offset : BigInt(0)) + BigInt(offset);
            break;
          case WASI_WHENCE_END:
            const { size } = this.fstatSync(stats.real);
            stats.offset = BigInt(size) + BigInt(offset);
            break;
          case WASI_WHENCE_SET:
            stats.offset = BigInt(offset);
            break;
        }
        if (stats.offset == null) {
          throw Error("stats.offset must be defined");
        }
        this.view.setBigUint64(newOffsetPtr, stats.offset, true);
        return WASI_ESUCCESS;
      }),
      fd_tell: wrap((fd, offsetPtr) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_TELL);
        this.refreshMemory();
        if (!stats.offset) {
          stats.offset = BigInt(0);
        }
        this.view.setBigUint64(offsetPtr, stats.offset, true);
        return WASI_ESUCCESS;
      }),
      fd_sync: wrap(fd => {
        const stats = CHECK_FD(fd, WASI_RIGHT_FD_SYNC);
        fs.fsyncSync(stats.real);
        return WASI_ESUCCESS;
      }),
      path_create_directory: wrap((fd, pathPtr, pathLen) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_PATH_CREATE_DIRECTORY);
        if (!stats.path) {
          return WASI_EINVAL;
        }
        this.refreshMemory();
        const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
        fs.mkdirSync(RESOLVE_PATH(stats, p));
        return WASI_ESUCCESS;
      }),
      path_filestat_get: wrap((fd, flags, pathPtr, pathLen, bufPtr) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_PATH_FILESTAT_GET);
        if (!stats.path) {
          return WASI_EINVAL;
        }
        this.refreshMemory();
        const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
        const resolved = RESOLVE_PATH(stats, p);
        let rstats;
        if (flags) {
          rstats = fs.statSync(resolved);
        } else {
          rstats = fs.lstatSync(resolved);
        }
        this.view.setBigUint64(bufPtr, BigInt(rstats.dev), true);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, BigInt(rstats.ino), true);
        bufPtr += 8;
        this.view.setUint8(bufPtr, translateFileAttributes(this, void 0, rstats).filetype);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, BigInt(rstats.nlink), true);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, BigInt(rstats.size), true);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, BigInt(rstats.atime.getTime() * 1e6), true);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, BigInt(rstats.mtime.getTime() * 1e6), true);
        bufPtr += 8;
        this.view.setBigUint64(bufPtr, BigInt(rstats.ctime.getTime() * 1e6), true);
        return WASI_ESUCCESS;
      }),
      path_filestat_set_times: wrap((fd, _dirflags, pathPtr, pathLen, stAtim, stMtim, fstflags) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_PATH_FILESTAT_SET_TIMES);
        if (!stats.path) {
          return WASI_EINVAL;
        }
        this.refreshMemory();
        const rstats = this.fstatSync(stats.real);
        let atim = rstats.atime;
        let mtim = rstats.mtime;
        const n = nsToMs(now(WASI_CLOCK_REALTIME));
        const atimflags = WASI_FILESTAT_SET_ATIM | WASI_FILESTAT_SET_ATIM_NOW;
        if ((fstflags & atimflags) === atimflags) {
          return WASI_EINVAL;
        }
        const mtimflags = WASI_FILESTAT_SET_MTIM | WASI_FILESTAT_SET_MTIM_NOW;
        if ((fstflags & mtimflags) === mtimflags) {
          return WASI_EINVAL;
        }
        if ((fstflags & WASI_FILESTAT_SET_ATIM) === WASI_FILESTAT_SET_ATIM) {
          atim = nsToMs(stAtim);
        } else if ((fstflags & WASI_FILESTAT_SET_ATIM_NOW) === WASI_FILESTAT_SET_ATIM_NOW) {
          atim = n;
        }
        if ((fstflags & WASI_FILESTAT_SET_MTIM) === WASI_FILESTAT_SET_MTIM) {
          mtim = nsToMs(stMtim);
        } else if ((fstflags & WASI_FILESTAT_SET_MTIM_NOW) === WASI_FILESTAT_SET_MTIM_NOW) {
          mtim = n;
        }
        const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
        fs.utimesSync(RESOLVE_PATH(stats, p), new Date(atim), new Date(mtim));
        return WASI_ESUCCESS;
      }),
      path_link: wrap((oldFd, _oldFlags, oldPath, oldPathLen, newFd, newPath, newPathLen) => {
        const ostats = CHECK_FD(oldFd, WASI_RIGHT_PATH_LINK_SOURCE);
        const nstats = CHECK_FD(newFd, WASI_RIGHT_PATH_LINK_TARGET);
        if (!ostats.path || !nstats.path) {
          return WASI_EINVAL;
        }
        this.refreshMemory();
        const op = Buffer.from(this.memory.buffer, oldPath, oldPathLen).toString();
        const np = Buffer.from(this.memory.buffer, newPath, newPathLen).toString();
        fs.linkSync(RESOLVE_PATH(ostats, op), RESOLVE_PATH(nstats, np));
        return WASI_ESUCCESS;
      }),
      path_open: wrap(
        (
          dirfd,
          _dirflags,
          pathPtr,
          pathLen,
          oflags,
          fsRightsBase: bigint | number,
          fsRightsInheriting: bigint | number,
          fsFlags,
          fdPtr,
        ) => {
          try {
            const stats = CHECK_FD(dirfd, WASI_RIGHT_PATH_OPEN);
            fsRightsBase = BigInt.asUintN(64, BigInt(fsRightsBase));
            fsRightsInheriting = BigInt.asUintN(64, BigInt(fsRightsInheriting));
            const read = (fsRightsBase & (WASI_RIGHT_FD_READ | WASI_RIGHT_FD_READDIR)) !== BigInt(0);
            const write =
              (fsRightsBase &
                (WASI_RIGHT_FD_DATASYNC |
                  WASI_RIGHT_FD_WRITE |
                  WASI_RIGHT_FD_ALLOCATE |
                  WASI_RIGHT_FD_FILESTAT_SET_SIZE)) !==
              BigInt(0);
            let noflags;
            if (write && read) {
              noflags = nodeFsConstants.O_RDWR;
            } else if (read) {
              noflags = nodeFsConstants.O_RDONLY;
            } else if (write) {
              noflags = nodeFsConstants.O_WRONLY;
            }
            let neededBase = fsRightsBase | WASI_RIGHT_PATH_OPEN;
            let neededInheriting = fsRightsBase | fsRightsInheriting;
            if ((oflags & WASI_O_CREAT) !== 0) {
              noflags |= nodeFsConstants.O_CREAT;
              neededBase |= WASI_RIGHT_PATH_CREATE_FILE;
            }
            if ((oflags & WASI_O_DIRECTORY) !== 0) {
              noflags |= nodeFsConstants.O_DIRECTORY;
            }
            if ((oflags & WASI_O_EXCL) !== 0) {
              noflags |= nodeFsConstants.O_EXCL;
            }
            if ((oflags & WASI_O_TRUNC) !== 0) {
              noflags |= nodeFsConstants.O_TRUNC;
              neededBase |= WASI_RIGHT_PATH_FILESTAT_SET_SIZE;
            }
            if ((fsFlags & WASI_FDFLAG_APPEND) !== 0) {
              noflags |= nodeFsConstants.O_APPEND;
            }
            if ((fsFlags & WASI_FDFLAG_DSYNC) !== 0) {
              const O_DSYNC = nodeFsConstants.O_DSYNC;
              noflags |= O_DSYNC ? O_DSYNC : nodeFsConstants.O_SYNC;
              neededInheriting |= WASI_RIGHT_FD_DATASYNC;
            }
            if ((fsFlags & WASI_FDFLAG_NONBLOCK) !== 0) {
              noflags |= nodeFsConstants.O_NONBLOCK;
            }
            if ((fsFlags & WASI_FDFLAG_RSYNC) !== 0) {
              const O_RSYNC = nodeFsConstants.O_RSYNC;
              noflags |= O_RSYNC ? O_RSYNC : nodeFsConstants.O_SYNC;
              neededInheriting |= WASI_RIGHT_FD_SYNC;
            }
            if ((fsFlags & WASI_FDFLAG_SYNC) !== 0) {
              noflags |= nodeFsConstants.O_SYNC;
              neededInheriting |= WASI_RIGHT_FD_SYNC;
            }
            if (write && (noflags & (nodeFsConstants.O_APPEND | nodeFsConstants.O_TRUNC)) === 0) {
              neededInheriting |= WASI_RIGHT_FD_SEEK;
            }
            this.refreshMemory();
            const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
            if (p == "dev/tty") {
              this.view.setUint32(fdPtr, WASI_STDIN_FILENO, true);
              return WASI_ESUCCESS;
            }
            if (p.startsWith("proc/")) {
              throw new WASIError(WASI_EBADF);
            }
            const fullUnresolved = RESOLVE_PATH(stats, p);
            let full;
            try {
              full = fs.realpathSync(fullUnresolved);
            } catch (e) {
              if ((e as WASICaughtError | null | undefined)?.code === "ENOENT") {
                // The final component may legitimately not exist yet (e.g.
                // O_CREAT), but the rest of the path must not be redirected
                // by symlinks: resolve the parent directory and re-attach
                // the final component. A dangling symlink as the final
                // component would still redirect the create, so reject it.
                const parentDir = path.dirname(fullUnresolved);
                const lastComponent = path.basename(fullUnresolved);
                let realParent = parentDir;
                try {
                  realParent = fs.realpathSync(parentDir);
                } catch (e2) {
                  if ((e2 as WASICaughtError | null | undefined)?.code !== "ENOENT") throw e2;
                }
                full = path.join(realParent, lastComponent);
                let finalIsLink = false;
                try {
                  finalIsLink = fs.lstatSync(full).isSymbolicLink();
                } catch {}
                if (finalIsLink) {
                  throw new WASIError(WASI_ENOTCAPABLE);
                }
              } else {
                throw e;
              }
            }
            // RESOLVE_PATH is a lexical check on the guest-supplied path;
            // realpathSync above follows symlinks on disk, so a symlink
            // inside the directory can still point the resolved path
            // outside of it. Re-check containment before the path is
            // opened or recorded as a new directory base in FD_MAP. The
            // resolved path must stay under the directory's lexical
            // location or its own resolved location (the latter matters
            // when the preopened directory is itself reached via a
            // symlink).
            {
              const contained = base => {
                if (full === base) return true;
                const rel = path.relative(base, full);
                return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
              };
              const lexicalBase = path.resolve(stats.path);
              let realBase = lexicalBase;
              try {
                realBase = fs.realpathSync(lexicalBase);
              } catch {}
              if (!contained(lexicalBase) && !contained(realBase)) {
                throw new WASIError(WASI_ENOTCAPABLE);
              }
            }
            let isDirectory;
            if (write) {
              try {
                isDirectory = fs.statSync(full).isDirectory();
              } catch {}
            }
            let realfd;
            if (!write && isDirectory) {
              realfd = fs.openSync(full, nodeFsConstants.O_RDONLY);
            } else {
              realfd = fs.openSync(full, noflags);
            }
            const newfd = this.getUnusedFileDescriptor();
            this.FD_MAP.set(newfd, {
              real: realfd,
              filetype: void 0,
              rights: {
                base: neededBase,
                inheriting: neededInheriting,
              },
              path: full,
            });
            stat(this, newfd);
            this.view.setUint32(fdPtr, newfd, true);
          } catch (e) {
            if (e instanceof WASIError) {
              return e.errno;
            }
            throw e;
          }
          return WASI_ESUCCESS;
        },
      ),
      path_readlink: wrap((fd, pathPtr, pathLen, buf, bufLen, bufused) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_PATH_READLINK);
        if (!stats.path) {
          return WASI_EINVAL;
        }
        this.refreshMemory();
        const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
        const full = RESOLVE_PATH(stats, p);
        const r = fs.readlinkSync(full);
        const used = Buffer.from(this.memory.buffer).write(r, buf, bufLen);
        this.view.setUint32(bufused, used, true);
        return WASI_ESUCCESS;
      }),
      path_remove_directory: wrap((fd, pathPtr, pathLen) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_PATH_REMOVE_DIRECTORY);
        if (!stats.path) {
          return WASI_EINVAL;
        }
        this.refreshMemory();
        const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
        fs.rmdirSync(RESOLVE_PATH(stats, p));
        return WASI_ESUCCESS;
      }),
      path_rename: wrap((oldFd, oldPath, oldPathLen, newFd, newPath, newPathLen) => {
        const ostats = CHECK_FD(oldFd, WASI_RIGHT_PATH_RENAME_SOURCE);
        const nstats = CHECK_FD(newFd, WASI_RIGHT_PATH_RENAME_TARGET);
        if (!ostats.path || !nstats.path) {
          return WASI_EINVAL;
        }
        this.refreshMemory();
        const op = Buffer.from(this.memory.buffer, oldPath, oldPathLen).toString();
        const np = Buffer.from(this.memory.buffer, newPath, newPathLen).toString();
        fs.renameSync(RESOLVE_PATH(ostats, op), RESOLVE_PATH(nstats, np));
        return WASI_ESUCCESS;
      }),
      path_symlink: wrap((oldPath, oldPathLen, fd, newPath, newPathLen) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_PATH_SYMLINK);
        if (!stats.path) {
          return WASI_EINVAL;
        }
        this.refreshMemory();
        const op = Buffer.from(this.memory.buffer, oldPath, oldPathLen).toString();
        const np = Buffer.from(this.memory.buffer, newPath, newPathLen).toString();
        fs.symlinkSync(op, RESOLVE_PATH(stats, np));
        return WASI_ESUCCESS;
      }),
      path_unlink_file: wrap((fd, pathPtr, pathLen) => {
        const stats = CHECK_FD(fd, WASI_RIGHT_PATH_UNLINK_FILE);
        if (!stats.path) {
          return WASI_EINVAL;
        }
        this.refreshMemory();
        const p = Buffer.from(this.memory.buffer, pathPtr, pathLen).toString();
        fs.unlinkSync(RESOLVE_PATH(stats, p));
        return WASI_ESUCCESS;
      }),
      poll_oneoff: (sin, sout, nsubscriptions, neventsPtr) => {
        const startNs = BigInt(bindings.hrtime());
        let nevents = 0;
        let waitTimeNs = BigInt(0);
        let fd = -1;
        let fd_type = "read";
        let fd_timeout_ms: number | bigint = 0;
        this.refreshMemory();
        let last_sin = sin;
        for (let i = 0; i < nsubscriptions; i += 1) {
          const userdata = this.view.getBigUint64(sin, true);
          sin += 8;
          const type = this.view.getUint8(sin);
          sin += 1;
          sin += 7;
          switch (type) {
            case WASI_EVENTTYPE_CLOCK: {
              const clockid = this.view.getUint32(sin, true);
              sin += 4;
              sin += 4;
              const timeout = this.view.getBigUint64(sin, true);
              sin += 8;
              sin += 8;
              const subclockflags = this.view.getUint16(sin, true);
              sin += 2;
              sin += 6;
              const absolute = subclockflags === 1;
              if (!absolute) {
                fd_timeout_ms = timeout / BigInt(1e6);
              }
              let e = WASI_ESUCCESS;
              const t = now(clockid);
              if (t == null) {
                e = WASI_EINVAL;
              } else {
                const tNS = BigInt(t);
                const end = absolute ? timeout : tNS + timeout;
                const waitNs = end - tNS;
                if (waitNs > waitTimeNs) {
                  waitTimeNs = waitNs;
                }
              }
              this.view.setBigUint64(sout, userdata, true);
              sout += 8;
              this.view.setUint16(sout, e, true);
              sout += 2;
              this.view.setUint8(sout, WASI_EVENTTYPE_CLOCK);
              sout += 1;
              sout += 5;
              nevents += 1;
              break;
            }
            case WASI_EVENTTYPE_FD_READ:
            case WASI_EVENTTYPE_FD_WRITE: {
              fd = this.view.getUint32(sin, true);
              fd_type = type == WASI_EVENTTYPE_FD_READ ? "read" : "write";
              sin += 4;
              sin += 28;
              this.view.setBigUint64(sout, userdata, true);
              sout += 8;
              this.view.setUint16(sout, WASI_ENOSYS, true);
              sout += 2;
              this.view.setUint8(sout, type);
              sout += 1;
              sout += 5;
              nevents += 1;
              if (fd == WASI_STDIN_FILENO && WASI_EVENTTYPE_FD_READ == type) {
                this.shortPause();
              }
              break;
            }
            default:
              return WASI_EINVAL;
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
          if (r != WASI_ENOSYS) {
            return r;
          }
        }
        if (waitTimeNs > 0) {
          waitTimeNs -= BigInt(bindings.hrtime()) - startNs;
          if (waitTimeNs >= 1e6) {
            const sleep = this.sleep;
            if (sleep == null && !warnedAboutSleep) {
              warnedAboutSleep = true;
              console.log("(100% cpu burning waiting for stdin: please define a way to sleep!) ");
            }
            if (sleep != null) {
              const ms = nsToMs(waitTimeNs);
              sleep.$call(this, ms);
            } else {
              const end = BigInt(bindings.hrtime()) + waitTimeNs;
              while (BigInt(bindings.hrtime()) < end) {}
            }
          }
        }
        return WASI_ESUCCESS;
      },
      proc_exit: rval => {
        bindings.exit(rval);
        return WASI_ESUCCESS;
      },
      proc_raise: sig => {
        if (!(sig in SIGNAL_MAP)) {
          return WASI_EINVAL;
        }
        bindings.kill(SIGNAL_MAP[sig]);
        return WASI_ESUCCESS;
      },
      random_get: (bufPtr, bufLen) => {
        this.refreshMemory();
        // getRandomValues takes one integer-typed view and ignores any further
        // arguments, so a bare `buffer, bufPtr, bufLen` randomized all of linear
        // memory rather than the requested window.
        crypto.getRandomValues(new Uint8Array(this.memory.buffer, bufPtr, bufLen));
        return WASI_ESUCCESS;
      },
      sched_yield() {
        return WASI_ESUCCESS;
      },
      sock_recv() {
        return WASI_ENOSYS;
      },
      sock_send() {
        return WASI_ENOSYS;
      },
      sock_shutdown() {
        return WASI_ENOSYS;
      },
      sock_fcntlSetFlags(_fd, _flags) {
        return WASI_ENOSYS;
      },
      sock_pollSocket(_fd, _eventtype, _timeout_ms) {
        return WASI_ENOSYS;
      },
    };
  }
  fstatSync(real_fd) {
    if (real_fd <= 2) {
      try {
        return fs.fstatSync(real_fd);
      } catch {
        const now = new Date();
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
          atime: new Date(),
          mtime: new Date(),
          ctime: new Date(),
          birthtime: new Date(0),
        };
      }
    }
    return fs.fstatSync(real_fd);
  }
  shortPause() {
    if (this.sleep == null) return;
    const now = new Date().valueOf();
    if (now - this.lastStdin > 2e3) {
      this.sleep(50);
    }
  }
  getUnusedFileDescriptor(start = 3) {
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
    if (!this.view || this.view.buffer.byteLength === 0) {
      this.view = new DataView(this.memory.buffer);
    }
  }
  setMemory(memory) {
    this.memory = memory;
  }
  start(instance, memory) {
    const exports2 = instance.exports;
    if (exports2 === null || typeof exports2 !== "object") {
      throw new Error(`instance.exports must be an Object. Received ${exports2}.`);
    }
    if (memory == null) {
      memory = exports2.memory;
      if (!(memory instanceof WebAssembly.Memory)) {
        throw new Error(`instance.exports.memory must be a WebAssembly.Memory. Recceived ${memory}.`);
      }
    }
    this.setMemory(memory);
    if (exports2._start) {
      exports2._start();
    }
  }
  getImports(module2) {
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
}

export default { WASI };
