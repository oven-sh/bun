import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "FSWatcher",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    hasPendingActivity: true,
    klass: {},
    JSType: "0b11101110",
    proto: {
      ref: {
        fn: "doRef",
        length: 0,
      },
      unref: {
        fn: "doUnref",
        length: 0,
      },
      hasRef: {
        fn: "hasRef",
        length: 0,
      },
      close: {
        fn: "doClose",
        length: 0,
      },
    },
    values: ["listener"],
  }),
  define({
    name: "StatWatcher",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    hasPendingActivity: true,
    klass: {},
    JSType: "0b11101110",
    proto: {
      ref: {
        fn: "doRef",
        length: 0,
      },
      unref: {
        fn: "doUnref",
        length: 0,
      },
      close: {
        fn: "doClose",
        length: 0,
      },
    },
    values: ["listener"],
  }),
  define({
    name: "Timeout",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      ref: {
        fn: "doRef",
        length: 0,
      },
      refresh: {
        fn: "doRefresh",
        length: 0,
      },
      unref: {
        fn: "doUnref",
        length: 0,
      },
      hasRef: {
        fn: "hasRef",
        length: 0,
      },
      ["@@toPrimitive"]: {
        fn: "toPrimitive",
        length: 1,
      },
    },
    values: ["arguments", "callback"],
  }),
  define({
    name: "Stats",
    construct: true,
    finalize: true,
    klass: {},
    JSType: "0b11101110",

    // TODO: generate-classes needs to handle Object.create properly when
    // functions are used. The functions need a fallback implementation to use
    // getters.
    supportsObjectCreate: true,

    proto: {
      isBlockDevice: {
        fn: "isBlockDevice_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isCharacterDevice: {
        fn: "isCharacterDevice_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isDirectory: {
        fn: "isDirectory_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isFIFO: {
        fn: "isFIFO_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isFile: {
        fn: "isFile_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isSocket: {
        fn: "isSocket_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isSymbolicLink: {
        fn: "isSymbolicLink_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      dev: {
        getter: "dev",
      },
      ino: {
        getter: "ino",
      },
      mode: {
        getter: "mode",
      },
      nlink: {
        getter: "nlink",
      },
      uid: {
        getter: "uid",
      },
      gid: {
        getter: "gid",
      },
      rdev: {
        getter: "rdev",
      },
      size: {
        getter: "size",
      },
      blksize: {
        getter: "blksize",
      },
      blocks: {
        getter: "blocks",
      },
      atime: {
        getter: "atime",
        cache: true,
      },
      mtime: {
        getter: "mtime",
        cache: true,
      },
      ctime: {
        getter: "ctime",
        cache: true,
      },
      birthtime: {
        getter: "birthtime",
      },
      atimeMs: {
        getter: "atimeMs",
      },
      mtimeMs: {
        getter: "mtimeMs",
      },
      ctimeMs: {
        getter: "ctimeMs",
      },
      birthtimeMs: {
        getter: "birthtimeMs",
      },
    },
  }),
  define({
    name: "BigIntStats",
    construct: true,
    finalize: true,
    klass: {},
    JSType: "0b11101110",

    // TODO: generate-classes needs to handle Object.create properly when
    // functions are used. The functions need a fallback implementation to use
    // getters.
    supportsObjectCreate: true,

    proto: {
      isBlockDevice: {
        fn: "isBlockDevice_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isCharacterDevice: {
        fn: "isCharacterDevice_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isDirectory: {
        fn: "isDirectory_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isFIFO: {
        fn: "isFIFO_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isFile: {
        fn: "isFile_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isSocket: {
        fn: "isSocket_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      isSymbolicLink: {
        fn: "isSymbolicLink_",
        length: 0,
        enumerable: false,
        DOMJIT: {
          returns: "bool",
          args: [],
          pure: true,
        },
      },
      dev: {
        getter: "dev",
      },
      ino: {
        getter: "ino",
      },
      mode: {
        getter: "mode",
      },
      nlink: {
        getter: "nlink",
      },
      uid: {
        getter: "uid",
      },
      gid: {
        getter: "gid",
      },
      rdev: {
        getter: "rdev",
      },
      size: {
        getter: "size",
      },
      blksize: {
        getter: "blksize",
      },
      blocks: {
        getter: "blocks",
      },
      atime: {
        getter: "atime",
        cache: true,
      },
      mtime: {
        getter: "mtime",
        cache: true,
      },
      ctime: {
        getter: "ctime",
        cache: true,
      },
      birthtime: {
        getter: "birthtime",
        cache: true,
      },
      atimeMs: {
        getter: "atimeMs",
      },
      mtimeMs: {
        getter: "mtimeMs",
      },
      ctimeMs: {
        getter: "ctimeMs",
      },
      birthtimeMs: {
        getter: "birthtimeMs",
      },
      atimeNs: {
        getter: "atimeNs",
      },
      mtimeNs: {
        getter: "mtimeNs",
      },
      ctimeNs: {
        getter: "ctimeNs",
      },
      birthtimeNs: {
        getter: "birthtimeNs",
      },
    },
  }),
  define({
    name: "Dirent",
    construct: true,
    finalize: true,

    klass: {},

    // TODO: generate-classes needs to handle Object.create properly when
    // functions are used. The functions need a fallback implementation to use
    // getters.
    supportsObjectCreate: true,

    proto: {
      isBlockDevice: {
        fn: "isBlockDevice",
        length: 0,
      },
      isCharacterDevice: {
        fn: "isCharacterDevice",
        length: 0,
      },
      isDirectory: {
        fn: "isDirectory",
        length: 0,
      },
      isFIFO: {
        fn: "isFIFO",
        length: 0,
      },
      isFile: {
        fn: "isFile",
        length: 0,
      },
      isSocket: {
        fn: "isSocket",
        length: 0,
      },
      isSymbolicLink: {
        fn: "isSymbolicLink",
        length: 0,
      },
      name: {
        getter: "getName",
        cache: true,
      },
    },
  }),
  define({
    name: "NodeJSFS",
    construct: true,
    noConstructor: true,
    finalize: true,

    klass: {},
    proto: {
      appendFile: { fn: "appendFile", length: 4 },
      appendFileSync: { fn: "appendFileSync", length: 3 },
      access: { fn: "access", length: 3 },
      accessSync: { fn: "accessSync", length: 2 },
      chown: { fn: "chown", length: 4 },
      chownSync: { fn: "chownSync", length: 3 },
      chmod: { fn: "chmod", length: 3 },
      chmodSync: { fn: "chmodSync", length: 2 },
      close: { fn: "close", length: 1 },
      closeSync: { fn: "closeSync", length: 1 },
      copyFile: { fn: "copyFile", length: 4 },
      copyFileSync: { fn: "copyFileSync", length: 3 },

      // TODO:
      cp: { fn: "cp", length: 2 },
      cpSync: { fn: "cpSync", length: 2 },

      exists: { fn: "exists", length: 2 },
      existsSync: { fn: "existsSync", length: 1 },
      fchown: { fn: "fchown", length: 4 },
      fchownSync: { fn: "fchownSync", length: 3 },
      fchmod: { fn: "fchmod", length: 3 },
      fchmodSync: { fn: "fchmodSync", length: 2 },
      fdatasync: { fn: "fdatasync", length: 2 },
      fdatasyncSync: { fn: "fdatasyncSync", length: 1 },
      fstat: { fn: "fstat", length: 1 },
      fstatSync: { fn: "fstatSync", length: 1 },
      fsync: { fn: "fsync", length: 2 },
      fsyncSync: { fn: "fsyncSync", length: 1 },
      ftruncate: { fn: "ftruncate", length: 1 },
      ftruncateSync: { fn: "ftruncateSync", length: 1 },
      futimes: { fn: "futimes", length: 4 },
      futimesSync: { fn: "futimesSync", length: 3 },
      lchown: { fn: "lchown", length: 4 },
      lchownSync: { fn: "lchownSync", length: 3 },
      lchmod: { fn: "lchmod", length: 3 },
      lchmodSync: { fn: "lchmodSync", length: 2 },
      link: { fn: "link", length: 3 },
      linkSync: { fn: "linkSync", length: 2 },
      lstat: { fn: "lstat", length: 1 },
      lstatSync: { fn: "lstatSync", length: 1 },
      lutimes: { fn: "lutimes", length: 4 },
      lutimesSync: { fn: "lutimesSync", length: 3 },
      mkdir: { fn: "mkdir", length: 3 },
      mkdirSync: { fn: "mkdirSync", length: 2 },
      mkdtemp: { fn: "mkdtemp", length: 3 },
      mkdtempSync: { fn: "mkdtempSync", length: 2 },
      open: { fn: "open", length: 4 },
      openSync: { fn: "openSync", length: 3 },
      opendir: { fn: "opendir", length: 3 },
      opendirSync: { fn: "opendirSync", length: 2 },
      readdir: { fn: "readdir", length: 3 },
      readdirSync: { fn: "readdirSync", length: 2 },
      read: { fn: "read", length: 6 },
      readSync: { fn: "readSync", length: 5 },
      readv: { fn: "readv", length: 4 },
      readvSync: { fn: "readvSync", length: 3 },
      readFile: { fn: "readFile", length: 3 },
      readFileSync: { fn: "readFileSync", length: 2 },
      readlink: { fn: "readlink", length: 3 },
      readlinkSync: { fn: "readlinkSync", length: 2 },
      realpath: { fn: "realpath", length: 3 },
      realpathSync: { fn: "realpathSync", length: 2 },
      rename: { fn: "rename", length: 3 },
      renameSync: { fn: "renameSync", length: 2 },
      rm: { fn: "rm", length: 3 },
      rmSync: { fn: "rmSync", length: 2 },
      rmdir: { fn: "rmdir", length: 3 },
      rmdirSync: { fn: "rmdirSync", length: 2 },
      stat: { fn: "stat", length: 1 },
      statSync: { fn: "statSync", length: 1 },
      symlink: { fn: "symlink", length: 4 },
      symlinkSync: { fn: "symlinkSync", length: 3 },
      truncate: { fn: "truncate", length: 3 },
      truncateSync: { fn: "truncateSync", length: 2 },
      unwatchFile: { fn: "unwatchFile", length: 2 },
      unlink: { fn: "unlink", length: 2 },
      unlinkSync: { fn: "unlinkSync", length: 1 },
      utimes: { fn: "utimes", length: 4 },
      utimesSync: { fn: "utimesSync", length: 3 },
      watch: { fn: "watch", length: 3 },
      watchFile: { fn: "watchFile", length: 3 },
      writeFile: { fn: "writeFile", length: 4 },
      writeFileSync: { fn: "writeFileSync", length: 3 },
      write: { fn: "write", length: 6 },
      writeSync: { fn: "writeSync", length: 5 },
      writev: { fn: "writev", length: 4 },
      writevSync: { fn: "writevSync", length: 3 },
      // TODO:
      // Dir: { fn: 'Dir', length: 3 },
      Dirent: { getter: "getDirent" },
      Stats: { getter: "getStats" },
      // ReadStream: { fn: 'ReadStream', length: 2 },
      // WriteStream: { fn: 'WriteStream', length: 2 },
      // FileReadStream: { fn: 'FileReadStream', length: 2 },
      // FileWriteStream: { fn: 'FileWriteStream', length: 2 },
      // _toUnixTimestamp: { fn: '_toUnixTimestamp', length: 1 }
      // createReadStream: { fn: "createReadStream", length: 2 },
      // createWriteStream: { fn: "createWriteStream", length: 2 },
    },
  }),
];
