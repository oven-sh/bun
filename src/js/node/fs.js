// Hardcoded module "node:fs"
const { WriteStreamPropertyDescriptor, createWriteStream } = require("internal/fs/WriteStream-lazy");
const { ReadStreamPropertyDescriptor, createReadStream } = require("internal/fs/ReadStream-lazy");
const { FSWatcherPropertyDescriptor, watch } = require("internal/fs/FSWatcher-lazy");
const { StatWatcherPropertyDescriptor, watchFile, unwatchFile } = require("internal/fs/StatWatcher");
// TODO: make symbols a separate export somewhere
var { kCustomPromisifiedSymbol } = require("internal/symbols");
const constants = $processBindingConstants.fs;

function ensureCallback(callback) {
  if (!$isCallable(callback)) {
    const err = new TypeError("Callback must be a function");
    err.code = "ERR_INVALID_ARG_TYPE";
    throw err;
  }

  return callback;
}

var fs = Bun.fs();

var access = function access(...args) {
    callbackify(fs.access, args);
  },
  appendFile = function appendFile(...args) {
    callbackify(fs.appendFile, args);
  },
  close = function close(...args) {
    callbackify(fs.close, args);
  },
  rm = function rm(...args) {
    callbackify(fs.rm, args);
  },
  rmdir = function rmdir(...args) {
    callbackify(fs.rmdir, args);
  },
  copyFile = function copyFile(...args) {
    const callback = ensureCallback(args[args.length - 1]);
    fs.copyFile(...args).then(result => callback(null, result), callback);
  },
  exists = function exists(path, callback) {
    if (typeof callback !== "function") {
      const err = new TypeError("Callback must be a function");
      err.code = "ERR_INVALID_ARG_TYPE";
      throw err;
    }
    try {
      fs.exists.$apply(fs, [path]).then(
        existed => callback(existed),
        _ => callback(false),
      );
    } catch (e) {
      callback(false);
    }
  },
  chown = function chown(...args) {
    callbackify(fs.chown, args);
  },
  chmod = function chmod(...args) {
    callbackify(fs.chmod, args);
  },
  fchmod = function fchmod(...args) {
    callbackify(fs.fchmod, args);
  },
  fchown = function fchown(...args) {
    callbackify(fs.fchown, args);
  },
  fstat = function fstat(...args) {
    callbackify(fs.fstat, args);
  },
  fsync = function fsync(...args) {
    callbackify(fs.fsync, args);
  },
  ftruncate = function ftruncate(...args) {
    callbackify(fs.ftruncate, args);
  },
  futimes = function futimes(...args) {
    callbackify(fs.futimes, args);
  },
  lchmod = function lchmod(...args) {
    callbackify(fs.lchmod, args);
  },
  lchown = function lchown(...args) {
    callbackify(fs.lchown, args);
  },
  link = function link(...args) {
    callbackify(fs.link, args);
  },
  mkdir = function mkdir(...args) {
    callbackify(fs.mkdir, args);
  },
  mkdtemp = function mkdtemp(...args) {
    callbackify(fs.mkdtemp, args);
  },
  open = function open(...args) {
    callbackify(fs.open, args);
  },
  read = function read(fd, buffer, offsetOrOptions, length, position, callback) {
    let offset = offsetOrOptions;
    let params = null;
    if (arguments.length <= 4) {
      if (arguments.length === 4) {
        // fs.read(fd, buffer, options, callback)
        callback = length;
        params = offsetOrOptions;
      } else if (arguments.length === 3) {
        const { isArrayBufferView } = require("node:util/types");
        // fs.read(fd, bufferOrParams, callback)
        if (!isArrayBufferView(buffer)) {
          // fs.read(fd, params, callback)
          params = buffer;
          ({ buffer = Buffer.alloc(16384) } = params ?? {});
        }
        callback = offsetOrOptions;
      } else {
        // fs.read(fd, callback)
        callback = buffer;
        buffer = Buffer.alloc(16384);
      }
      ({ offset = 0, length = buffer?.byteLength - offset, position = null } = params ?? {});
    }
    fs.read(fd, buffer, offset, length, position).then(
      bytesRead => {
        callback(null, bytesRead, buffer);
      },
      err => callback(err),
    );
  },
  write = function write(...args) {
    const callback = ensureCallback(args[args.length - 1]);
    const promise = fs.write(...args.slice(0, -1));
    const bufferOrString = args[1];

    promise.then(
      bytesWritten => callback(null, bytesWritten, bufferOrString),
      err => callback(err),
    );
  },
  readdir = function readdir(...args) {
    const callback = ensureCallback(args[args.length - 1]);

    fs.readdir(...args.slice(0, -1)).then(result => callback(null, result), callback);
  },
  readFile = function readFile(...args) {
    const callback = ensureCallback(args[args.length - 1]);
    fs.readFile(...args.slice(0, -1)).then(result => callback(null, result), callback);
  },
  writeFile = function writeFile(...args) {
    callbackify(fs.writeFile, args);
  },
  readlink = function readlink(...args) {
    callbackify(fs.readlink, args);
  },
  realpath = function realpath(...args) {
    const callback = ensureCallback(args[args.length - 1]);
    fs.realpath(...args.slice(0, -1)).then(result => callback(null, result), callback);
  },
  rename = function rename(...args) {
    callbackify(fs.rename, args);
  },
  lstat = function lstat(...args) {
    const callback = ensureCallback(args[args.length - 1]);
    fs.lstat(...args.slice(0, -1)).then(result => callback(null, result), callback);
  },
  stat = function stat(...args) {
    const callback = ensureCallback(args[args.length - 1]);
    fs.stat(...args.slice(0, -1)).then(result => callback(null, result), callback);
  },
  symlink = function symlink(...args) {
    callbackify(fs.symlink, args);
  },
  truncate = function truncate(...args) {
    callbackify(fs.truncate, args);
  },
  unlink = function unlink(...args) {
    callbackify(fs.unlink, args);
  },
  utimes = function utimes(...args) {
    callbackify(fs.utimes, args);
  },
  lutimes = function lutimes(...args) {
    callbackify(fs.lutimes, args);
  },
  accessSync = fs.accessSync.bind(fs),
  appendFileSync = fs.appendFileSync.bind(fs),
  closeSync = fs.closeSync.bind(fs),
  copyFileSync = fs.copyFileSync.bind(fs),
  existsSync = fs.existsSync.bind(fs),
  chownSync = fs.chownSync.bind(fs),
  chmodSync = fs.chmodSync.bind(fs),
  fchmodSync = fs.fchmodSync.bind(fs),
  fchownSync = fs.fchownSync.bind(fs),
  fstatSync = fs.fstatSync.bind(fs),
  fsyncSync = fs.fsyncSync.bind(fs),
  ftruncateSync = fs.ftruncateSync.bind(fs),
  futimesSync = fs.futimesSync.bind(fs),
  lchmodSync = fs.lchmodSync.bind(fs),
  lchownSync = fs.lchownSync.bind(fs),
  linkSync = fs.linkSync.bind(fs),
  lstatSync = fs.lstatSync.bind(fs),
  mkdirSync = fs.mkdirSync.bind(fs),
  mkdtempSync = fs.mkdtempSync.bind(fs),
  openSync = fs.openSync.bind(fs),
  readSync = fs.readSync.bind(fs),
  writeSync = fs.writeSync.bind(fs),
  readdirSync = fs.readdirSync.bind(fs),
  readFileSync = fs.readFileSync.bind(fs),
  writeFileSync = fs.writeFileSync.bind(fs),
  readlinkSync = fs.readlinkSync.bind(fs),
  realpathSync = fs.realpathSync.bind(fs),
  renameSync = fs.renameSync.bind(fs),
  statSync = fs.statSync.bind(fs),
  symlinkSync = fs.symlinkSync.bind(fs),
  truncateSync = fs.truncateSync.bind(fs),
  unlinkSync = fs.unlinkSync.bind(fs),
  utimesSync = fs.utimesSync.bind(fs),
  lutimesSync = fs.lutimesSync.bind(fs),
  rmSync = fs.rmSync.bind(fs),
  rmdirSync = fs.rmdirSync.bind(fs),
  writev = (fd, buffers, position, callback) => {
    if (typeof position === "function") {
      callback = position;
      position = null;
    }

    queueMicrotask(() => {
      try {
        var written = fs.writevSync(fd, buffers, position);
      } catch (e) {
        callback(e);
      }

      callback(null, written, buffers);
    });
  },
  writevSync = fs.writevSync.bind(fs),
  readv = (fd, buffers, position, callback) => {
    if (typeof position === "function") {
      callback = position;
      position = null;
    }

    queueMicrotask(() => {
      try {
        var written = fs.readvSync(fd, buffers, position);
      } catch (e) {
        callback(e);
      }

      callback(null, written, buffers);
    });
  },
  readvSync = fs.readvSync.bind(fs),
  Dirent = fs.Dirent,
  Stats = fs.Stats;

read[kCustomPromisifiedSymbol] = async function (fd, bufferOrOptions, ...rest) {
  const { isArrayBufferView } = require("node:util/types");
  let buffer;

  if (isArrayBufferView(bufferOrOptions)) {
    buffer = bufferOrOptions;
  } else {
    buffer = bufferOrOptions?.buffer;
  }

  if (buffer == undefined) {
    buffer = Buffer.alloc(16384);
  }

  const bytesRead = await fs.read(fd, buffer, ...rest);

  return { bytesRead, buffer };
};

write[kCustomPromisifiedSymbol] = async function (fd, stringOrBuffer, ...rest) {
  const bytesWritten = await fs.write(fd, stringOrBuffer, ...rest);
  return { bytesWritten, buffer: stringOrBuffer };
};

writev[kCustomPromisifiedSymbol] = async function (fd, buffers, ...rest) {
  const bytesWritten = await fs.writev(fd, buffers, ...rest);
  return { bytesWritten, buffers };
};

readv[kCustomPromisifiedSymbol] = async function (fd, buffers, ...rest) {
  const bytesRead = await fs.readv(fd, buffers, ...rest);
  return { bytesRead, buffers };
};

function callbackify(fsFunction, args) {
  const callback = args[args.length - 1];
  try {
    var result = fsFunction.$apply(fs, args.slice(0, args.length - 1));
    result.then(
      (...args) => callback(null, ...args),
      err => callback(err),
    );
  } catch (e) {
    if (typeof callback === "function") {
      callback(e);
    } else {
      throw e;
    }
  }
}

// Results from Object.keys() in Node 1,
// fd
// path
// flags
// mode
// start
// end
// pos
// bytesRead
// _readableState
// _events
// _eventsCount
// _maxListener

Object.defineProperties(fs, {
  createReadStream: {
    value: createReadStream,
  },
  createWriteStream: {
    value: createWriteStream,
  },
  ReadStream: ReadStreamPropertyDescriptor,
  WriteStream: WriteStreamPropertyDescriptor,
  FSWatcher: FSWatcherPropertyDescriptor,
  watch: {
    value: watch,
  },
  StatWatcher: StatWatcherPropertyDescriptor,
  watchFile: {
    value: watchFile,
  },
  unwatchFile: {
    value: unwatchFile,
  },
});

// lol
// @ts-ignore
realpath.native = realpath;
realpathSync.native = realpathSync;

let lazy_cpSync = null;
// attempt to use the native code version if possible
// and on MacOS, simple cases of recursive directory trees can be done in a single `clonefile()`
// using filter and other options uses a lazily loaded js fallback ported from node.js
function cpSync(src, dest, options) {
  if (!options) return fs.cpSync(src, dest);
  if (typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  if (options.dereference || options.filter || options.preserveTimestamps || options.verbatimSymlinks) {
    if (!lazy_cpSync) lazy_cpSync = require("../internal/fs/cp-sync");
    return lazy_cpSync(src, dest, options);
  }
  return fs.cpSync(src, dest, options.recursive, options.errorOnExist, options.force ?? true, options.mode);
}

function cp(src, dest, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  require("node:fs/promises")
    .cp(src, dest, options)
    .then(() => callback(), callback);
}

function _toUnixTimestamp(time, name = "time") {
  if (typeof time === "string" && +time == time) {
    return +time;
  }
  if (NumberIsFinite(time)) {
    if (time < 0) {
      return DateNow() / 1000;
    }
    return time;
  }
  if (isDate(time)) {
    // Convert to 123.456 UNIX timestamp
    return DatePrototypeGetTime(time) / 1000;
  }
  throw new TypeError(`Expected ${name} to be a number or Date`);
}

const defaultObject = {
  Dirent,
  Stats,
  _toUnixTimestamp,
  access,
  accessSync,
  appendFile,
  appendFileSync,
  chmod,
  chmodSync,
  chown,
  chownSync,
  close,
  closeSync,
  constants,
  copyFile,
  copyFileSync,
  cp,
  cpSync,
  createReadStream,
  createWriteStream,
  exists,
  existsSync,
  fchmod,
  fchmodSync,
  fchown,
  fchownSync,
  fstat,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncate,
  ftruncateSync,
  futimes,
  futimesSync,
  lchmod,
  lchmodSync,
  lchown,
  lchownSync,
  link,
  linkSync,
  lstat,
  lstatSync,
  lutimes,
  lutimesSync,
  mkdir,
  mkdirSync,
  mkdtemp,
  mkdtempSync,
  open,
  openSync,
  get promises() {
    return require("node:fs/promises");
  },
  set promises(v) {},
  read,
  readFile,
  readFileSync,
  readSync,
  readdir,
  readdirSync,
  readlink,
  readlinkSync,
  readv,
  readvSync,
  realpath,
  realpathSync,
  rename,
  renameSync,
  rm,
  rmSync,
  rmdir,
  rmdirSync,
  stat,
  statSync,
  symlink,
  symlinkSync,
  truncate,
  truncateSync,
  unlink,
  unlinkSync,
  unwatchFile,
  utimes,
  utimesSync,
  watch,
  watchFile,
  write,
  writeFile,
  writeFileSync,
  writeSync,
  writev,
  writevSync,
};

Object.defineProperties(defaultObject, {
  WriteStream: WriteStreamPropertyDescriptor,
  ReadStream: ReadStreamPropertyDescriptor,
  StatWatcher: StatWatcherPropertyDescriptor,
  FSWatcher: FSWatcherPropertyDescriptor,
});

export default defaultObject;
