// Hardcoded module "node:fs"
import type { Stats as StatsType, Dirent as DirentType, PathLike } from "fs";
const EventEmitter = require("node:events");
const promises = require("node:fs/promises");
const types = require("node:util/types");
const { validateFunction, validateInteger } = require("internal/validators");

const kEmptyObject = Object.freeze(Object.create(null));

const isDate = types.isDate;

// Private exports
// `fs` points to the return value of `node_fs_binding.zig`'s `createBinding` function.
const { fs } = promises.$data;

const constants = $processBindingConstants.fs;
var _lazyGlob;
function lazyGlob() {
  return (_lazyGlob ??= require("internal/fs/glob"));
}

function ensureCallback(callback) {
  if (!$isCallable(callback)) {
    throw $ERR_INVALID_ARG_TYPE("cb", "function", callback);
  }

  return callback;
}

// Micro-optimization: avoid creating a new function for every call
// bind() is slightly more optimized in JSC
// This code is equivalent to:
//
// function () { callback(null); }
//
function nullcallback(callback) {
  return FunctionPrototypeBind.$call(callback, undefined, null);
}
const FunctionPrototypeBind = nullcallback.bind;

class FSWatcher extends EventEmitter {
  #watcher;
  #listener;
  constructor(path, options, listener) {
    super();

    if (typeof options === "function") {
      listener = options;
      options = {};
    } else if (typeof options === "string") {
      options = { encoding: options };
    }

    if (typeof listener !== "function") {
      listener = () => {};
    }

    this.#listener = listener;
    try {
      this.#watcher = fs.watch(path, options || {}, this.#onEvent.bind(this));
    } catch (e: any) {
      e.path = path;
      e.filename = path;
      throw e;
    }
  }

  #onEvent(eventType, filenameOrError) {
    if (eventType === "close") {
      // close on next microtask tick to avoid long-running function calls when
      // we're trying to detach the watcher
      queueMicrotask(() => {
        this.emit("close", filenameOrError);
      });
      return;
    } else if (eventType === "error") {
      // TODO: Next.js/watchpack causes this to emits weird EACCES errors on
      // paths that shouldn't be watched. A better solution is to figure out why
      // these paths get watched in the first place. For now we will rewrite the
      // .code, which will cause their code path to ignore the error.
      if (filenameOrError.code === "EACCES") filenameOrError.code = "EPERM";

      this.emit(eventType, filenameOrError);
    } else {
      this.emit("change", eventType, filenameOrError);
      this.#listener(eventType, filenameOrError);
    }
  }

  close() {
    this.#watcher?.close();
    this.#watcher = null;
  }

  ref() {
    this.#watcher?.ref();
  }

  unref() {
    this.#watcher?.unref();
  }

  // https://github.com/nodejs/node/blob/9f51c55a47702dc6a0ca3569853dd7ba022bf7bb/lib/internal/fs/watchers.js#L259-L263
  start() {}
}

/** Implemented in `node_fs_stat_watcher.zig` */
interface StatWatcherHandle {
  ref();
  unref();
  close();
}

function openAsBlob(path, options) {
  return Promise.$resolve(Bun.file(path, options));
}

class StatWatcher extends EventEmitter {
  _handle: StatWatcherHandle | null;

  constructor(path, options) {
    super();
    this._handle = fs.watchFile(path, options, this.#onChange.bind(this));
  }

  #onChange(curr, prev) {
    this.emit("change", curr, prev);
  }

  // https://github.com/nodejs/node/blob/9f51c55a47702dc6a0ca3569853dd7ba022bf7bb/lib/internal/fs/watchers.js#L259-L263
  start() {}

  stop() {
    this._handle?.close();
    this._handle = null;
  }

  ref() {
    this._handle?.ref();
  }

  unref() {
    this._handle?.unref();
  }
}

var access = function access(path, mode, callback) {
    if ($isCallable(mode)) {
      callback = mode;
      mode = undefined;
    }

    ensureCallback(callback);
    fs.access(path, mode).then(callback, callback);
  },
  appendFile = function appendFile(path, data, options, callback) {
    if (!$isCallable(callback)) {
      callback = options;
      options = undefined;
    }

    ensureCallback(callback);

    fs.appendFile(path, data, options).then(nullcallback(callback), callback);
  },
  close = function close(fd, callback) {
    if ($isCallable(callback)) {
      fs.close(fd).then(() => callback(null), callback);
    } else if (callback === undefined) {
      fs.close(fd).then(() => {});
    } else {
      callback = ensureCallback(callback);
    }
  },
  rm = function rm(path, options, callback) {
    if ($isCallable(options)) {
      callback = options;
      options = undefined;
    }

    ensureCallback(callback);
    fs.rm(path, options).then(nullcallback(callback), callback);
  },
  rmdir = function rmdir(path, options, callback) {
    if ($isCallable(options)) {
      callback = options;
      options = undefined;
    }

    fs.rmdir(path, options).then(nullcallback(callback), callback);
  },
  copyFile = function copyFile(src, dest, mode, callback) {
    if ($isCallable(mode)) {
      callback = mode;
      mode = 0;
    }

    ensureCallback(callback);

    fs.copyFile(src, dest, mode).then(nullcallback(callback), callback);
  },
  exists = function exists(path, callback) {
    ensureCallback(callback);

    try {
      fs.exists.$apply(fs, [path]).then(
        existed => callback(existed),
        _ => callback(false),
      );
    } catch (e) {
      callback(false);
    }
  },
  chown = function chown(path, uid, gid, callback) {
    ensureCallback(callback);

    fs.chown(path, uid, gid).then(nullcallback(callback), callback);
  },
  chmod = function chmod(path, mode, callback) {
    ensureCallback(callback);

    fs.chmod(path, mode).then(nullcallback(callback), callback);
  },
  fchmod = function fchmod(fd, mode, callback) {
    ensureCallback(callback);

    fs.fchmod(fd, mode).then(nullcallback(callback), callback);
  },
  fchown = function fchown(fd, uid, gid, callback) {
    ensureCallback(callback);

    fs.fchown(fd, uid, gid).then(nullcallback(callback), callback);
  },
  fstat = function fstat(fd, options, callback) {
    if ($isCallable(options)) {
      callback = options;
      options = undefined;
    }

    fs.fstat(fd, options).then(function (stats) {
      callback(null, stats);
    }, callback);
  },
  fsync = function fsync(fd, callback) {
    ensureCallback(callback);

    fs.fsync(fd).then(nullcallback(callback), callback);
  },
  ftruncate = function ftruncate(fd, len = 0, callback) {
    if ($isCallable(len)) {
      callback = len;
      len = 0;
    }

    ensureCallback(callback);

    fs.ftruncate(fd, len).then(nullcallback(callback), callback);
  },
  futimes = function futimes(fd, atime, mtime, callback) {
    ensureCallback(callback);

    fs.futimes(fd, atime, mtime).then(nullcallback(callback), callback);
  },
  lchmod =
    constants.O_SYMLINK !== undefined
      ? function lchmod(path, mode, callback) {
          ensureCallback(callback);

          fs.lchmod(path, mode).then(nullcallback(callback), callback);
        }
      : undefined, // lchmod is only available on macOS
  lchown = function lchown(path, uid, gid, callback) {
    ensureCallback(callback);

    fs.lchown(path, uid, gid).then(nullcallback(callback), callback);
  },
  link = function link(existingPath, newPath, callback) {
    ensureCallback(callback);

    fs.link(existingPath, newPath).then(nullcallback(callback), callback);
  },
  mkdir = function mkdir(path, options, callback) {
    if ($isCallable(options)) {
      callback = options;
      options = undefined;
    }

    ensureCallback(callback);

    fs.mkdir(path, options).then(nullcallback(callback), callback);
  },
  mkdtemp = function mkdtemp(prefix, options, callback) {
    if ($isCallable(options)) {
      callback = options;
      options = undefined;
    }

    ensureCallback(callback);

    fs.mkdtemp(prefix, options).then(function (folder) {
      callback(null, folder);
    }, callback);
  },
  open = function open(path, flags, mode, callback) {
    if (arguments.length < 3) {
      callback = flags;
    } else if ($isCallable(mode)) {
      callback = mode;
      mode = undefined;
    }

    ensureCallback(callback);

    fs.open(path, flags, mode).then(function (fd) {
      callback(null, fd);
    }, callback);
  },
  fdatasync = function fdatasync(fd, callback) {
    ensureCallback(callback);

    fs.fdatasync(fd).then(nullcallback(callback), callback);
  },
  read = function read(fd, buffer, offsetOrOptions, length, position, callback) {
    // fd = getValidatedFd(fd); DEFERRED TO NATIVE
    let offset = offsetOrOptions;
    let params: any = null;
    if (arguments.length <= 4) {
      if (arguments.length === 4) {
        // This is fs.read(fd, buffer, options, callback)
        // validateObject(params, 'options', kValidateObjectAllowNullable);
        if (typeof params !== "object" || $isArray(params)) {
          throw $ERR_INVALID_ARG_TYPE("options", "object", params);
        }
        callback = length;
        params = offsetOrOptions;
      } else if (arguments.length === 3) {
        // This is fs.read(fd, bufferOrParams, callback)
        if (!types.isArrayBufferView(buffer)) {
          // fs.read(fd, bufferOrParams, callback)
          params = buffer;
          ({ buffer = Buffer.alloc(16384) } = params ?? {});
        }
        callback = offsetOrOptions;
      } else {
        // This is fs.read(fd, callback)
        callback = buffer;
        buffer = Buffer.alloc(16384);
      }

      if (params !== undefined) {
        // validateObject(params, 'options', kValidateObjectAllowNullable);
        if (typeof params !== "object" || $isArray(params)) {
          throw $ERR_INVALID_ARG_TYPE("options", "object", params);
        }
      }
      ({ offset = 0, length = buffer?.byteLength - offset, position = null } = params ?? {});
    }
    if (!callback) {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }
    fs.read(fd, buffer, offset, length, position).then(
      bytesRead => void callback(null, bytesRead, buffer),
      err => callback(err),
    );
  },
  write = function write(fd, buffer, offsetOrOptions, length, position, callback) {
    function wrapper(bytesWritten) {
      callback(null, bytesWritten, buffer);
    }

    if ($isTypedArrayView(buffer)) {
      callback ||= position || length || offsetOrOptions;
      ensureCallback(callback);

      if (typeof offsetOrOptions === "object") {
        ({
          offset: offsetOrOptions = 0,
          length = buffer.byteLength - offsetOrOptions,
          position = null,
        } = offsetOrOptions ?? {});
      }

      fs.write(fd, buffer, offsetOrOptions, length, position).then(wrapper, callback);
      return;
    }

    if (!$isCallable(position)) {
      if ($isCallable(offsetOrOptions)) {
        position = offsetOrOptions;
        offsetOrOptions = undefined;
      } else {
        position = length;
      }
      length = "utf8";
    }

    callback = position;
    ensureCallback(callback);

    fs.write(fd, buffer, offsetOrOptions, length).then(wrapper, callback);
  },
  readdir = function readdir(path, options, callback) {
    if ($isCallable(options)) {
      callback = options;
      options = undefined;
    }

    ensureCallback(callback);

    fs.readdir(path, options).then(function (files) {
      callback(null, files);
    }, callback);
  },
  readFile = function readFile(path, options, callback) {
    callback ||= options;
    ensureCallback(callback);

    fs.readFile(path, options).then(function (data) {
      callback(null, data);
    }, callback);
  },
  writeFile = function writeFile(path, data, options, callback) {
    callback ||= options;
    ensureCallback(callback);

    fs.writeFile(path, data, options).then(nullcallback(callback), callback);
  },
  readlink = function readlink(path, options, callback?) {
    if ($isCallable(options)) {
      callback = options;
      options = undefined;
    }

    ensureCallback(callback);

    fs.readlink(path, options).then(function (linkString) {
      callback(null, linkString);
    }, callback);
  },
  rename = function rename(oldPath, newPath, callback) {
    ensureCallback(callback);

    fs.rename(oldPath, newPath).then(nullcallback(callback), callback);
  },
  lstat = function lstat(path, options, callback?) {
    if ($isCallable(options)) {
      callback = options;
      options = undefined;
    }

    ensureCallback(callback);

    fs.lstat(path, options).then(function (stats) {
      callback(null, stats);
    }, callback);
  },
  stat = function stat(path, options, callback?) {
    if ($isCallable(options)) {
      callback = options;
      options = undefined;
    }

    ensureCallback(callback);

    fs.stat(path, options).then(function (stats) {
      callback(null, stats);
    }, callback);
  },
  statfs = function statfs(path, options, callback) {
    if ($isCallable(options)) {
      callback = options;
      options = undefined;
    }

    ensureCallback(callback);

    fs.statfs(path, options).then(function (stats) {
      callback(null, stats);
    }, callback);
  },
  symlink = function symlink(target, path, type, callback) {
    if (callback === undefined) {
      callback = type;
      ensureCallback(callback);
      type = undefined;
    }

    fs.symlink(target, path, type).then(callback, callback);
  },
  truncate = function truncate(path, len, callback) {
    if (typeof path === "number") {
      // Apparently, node supports this
      ftruncate(path, len, callback);
      return;
    }

    if ($isCallable(len)) {
      callback = len;
      len = 0;
    } else if (len === undefined) {
      len = 0;
    }

    ensureCallback(callback);
    fs.truncate(path, len).then(nullcallback(callback), callback);
  },
  unlink = function unlink(path, callback) {
    ensureCallback(callback);

    fs.unlink(path).then(nullcallback(callback), callback);
  },
  utimes = function utimes(path, atime, mtime, callback) {
    ensureCallback(callback);

    fs.utimes(path, atime, mtime).then(nullcallback(callback), callback);
  },
  lutimes = function lutimes(path, atime, mtime, callback) {
    ensureCallback(callback);

    fs.lutimes(path, atime, mtime).then(nullcallback(callback), callback);
  },
  accessSync = fs.accessSync.bind(fs),
  appendFileSync = fs.appendFileSync.bind(fs),
  closeSync = fs.closeSync.bind(fs),
  copyFileSync = fs.copyFileSync.bind(fs),
  // This behavior - never throwing -- matches Node.js behavior.
  // https://github.com/nodejs/node/blob/c82f3c9e80f0eeec4ae5b7aedd1183127abda4ad/lib/fs.js#L275C1-L295C1
  existsSync = function existsSync() {
    try {
      return fs.existsSync.$apply(fs, arguments);
    } catch (e) {
      return false;
    }
  },
  chownSync = fs.chownSync.bind(fs),
  chmodSync = fs.chmodSync.bind(fs),
  fchmodSync = fs.fchmodSync.bind(fs),
  fchownSync = fs.fchownSync.bind(fs),
  fstatSync = fs.fstatSync.bind(fs),
  fsyncSync = fs.fsyncSync.bind(fs),
  ftruncateSync = fs.ftruncateSync.bind(fs),
  futimesSync = fs.futimesSync.bind(fs),
  lchmodSync = constants.O_SYMLINK !== undefined ? fs.lchmodSync.bind(fs) : undefined, // lchmod is only available on macOS
  lchownSync = fs.lchownSync.bind(fs),
  linkSync = fs.linkSync.bind(fs),
  lstatSync = fs.lstatSync.bind(fs),
  mkdirSync = fs.mkdirSync.bind(fs),
  mkdtempSync = fs.mkdtempSync.bind(fs),
  openSync = fs.openSync.bind(fs),
  readSync = function readSync(fd, buffer, offsetOrOptions, length, position) {
    let offset = offsetOrOptions;
    if (arguments.length <= 3 || typeof offsetOrOptions === "object") {
      if (offsetOrOptions !== undefined) {
        // validateObject(offsetOrOptions, 'options', kValidateObjectAllowNullable);
        if (typeof offsetOrOptions !== "object" || $isArray(offsetOrOptions)) {
          throw $ERR_INVALID_ARG_TYPE("options", "object", offsetOrOptions);
        }
      }

      ({ offset = 0, length = buffer.byteLength - offset, position = null } = offsetOrOptions ?? {});
    }

    return fs.readSync(fd, buffer, offset, length, position);
  },
  writeSync = fs.writeSync.bind(fs),
  readdirSync = fs.readdirSync.bind(fs),
  readFileSync = fs.readFileSync.bind(fs),
  fdatasyncSync = fs.fdatasyncSync.bind(fs),
  writeFileSync = fs.writeFileSync.bind(fs),
  readlinkSync = fs.readlinkSync.bind(fs),
  renameSync = fs.renameSync.bind(fs),
  statSync = fs.statSync.bind(fs),
  statfsSync = fs.statfsSync.bind(fs),
  symlinkSync = fs.symlinkSync.bind(fs),
  truncateSync = fs.truncateSync.bind(fs),
  unlinkSync = fs.unlinkSync.bind(fs),
  utimesSync = fs.utimesSync.bind(fs),
  lutimesSync = fs.lutimesSync.bind(fs),
  rmSync = fs.rmSync.bind(fs),
  rmdirSync = fs.rmdirSync.bind(fs),
  writev = function writev(fd, buffers, position, callback) {
    if (typeof position === "function") {
      callback = position;
      position = null;
    }

    callback = ensureCallback(callback);

    fs.writev(fd, buffers, position).$then(bytesWritten => callback(null, bytesWritten, buffers), callback);
  },
  writevSync = fs.writevSync.bind(fs),
  readv = function readv(fd, buffers, position, callback) {
    if (typeof position === "function") {
      callback = position;
      position = null;
    }

    callback = ensureCallback(callback);

    fs.readv(fd, buffers, position).$then(bytesRead => callback(null, bytesRead, buffers), callback);
  },
  readvSync = fs.readvSync.bind(fs),
  Dirent = fs.Dirent,
  Stats = fs.Stats,
  watch = function watch(path, options, listener) {
    return new FSWatcher(path, options, listener);
  },
  opendir = function opendir(path, options, callback) {
    // TODO: validatePath
    // validateString(path, "path");
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    validateFunction(callback, "callback");
    const result = new Dir(1, path, options);
    callback(null, result);
  };

const { defineCustomPromisifyArgs } = require("internal/promisify");
var kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");
exists[kCustomPromisifiedSymbol] = path => new Promise(resolve => exists(path, resolve));
defineCustomPromisifyArgs(read, ["bytesRead", "buffer"]);
defineCustomPromisifyArgs(readv, ["bytesRead", "buffers"]);
defineCustomPromisifyArgs(write, ["bytesWritten", "buffer"]);
defineCustomPromisifyArgs(writev, ["bytesWritten", "buffers"]);

// TODO: move this entire thing into native code.
// the reason it's not done right now is because there isnt a great way to have multiple
// listeners per StatWatcher with the current implementation in native code. the downside
// of this means we need to do path validation in the js side of things
const statWatchers = new Map();
function getValidatedPath(p: any) {
  if (p instanceof URL) return Bun.fileURLToPath(p as URL);
  if (typeof p !== "string") throw $ERR_INVALID_ARG_TYPE("path", "string or URL", p);
  return require("node:path").resolve(p);
}
function watchFile(filename, options, listener) {
  filename = getValidatedPath(filename);

  if (typeof options === "function") {
    listener = options;
    options = {};
  }

  if (typeof listener !== "function") {
    throw new TypeError("listener must be a function");
  }

  var stat = statWatchers.get(filename);
  if (!stat) {
    stat = new StatWatcher(filename, options);
    statWatchers.set(filename, stat);
  }
  stat.addListener("change", listener);
  return stat;
}
function unwatchFile(filename, listener) {
  filename = getValidatedPath(filename);

  var stat = statWatchers.get(filename);
  if (!stat) return throwIfNullBytesInFileName(filename);
  if (listener) {
    stat.removeListener("change", listener);
    if (stat.listenerCount("change") !== 0) {
      return;
    }
  } else {
    stat.removeAllListeners("change");
  }
  stat.stop();
  statWatchers.delete(filename);
}

function throwIfNullBytesInFileName(filename: string) {
  if (filename.indexOf("\u0000") !== -1) {
    throw $ERR_INVALID_ARG_VALUE("path", "string without null bytes", filename);
  }
}

function createReadStream(path, options) {
  return new exports.ReadStream(path, options);
}

function createWriteStream(path, options) {
  return new exports.WriteStream(path, options);
}

const splitRootWindowsRe = /^(?:[a-zA-Z]:|[\\/]{2}[^\\/]+[\\/][^\\/]+)?[\\/]*/;
function splitRootWindows(str) {
  return splitRootWindowsRe.exec(str)![0];
}
function nextPartWindows(p, i) {
  for (; i < p.length; ++i) {
    const ch = p.$charCodeAt(i);

    // Check for a separator character
    if (ch === "\\".charCodeAt(0) || ch === "/".charCodeAt(0)) return i;
  }
  return -1;
}

function encodeRealpathResult(result, encoding) {
  if (!encoding || encoding === "utf8") return result;
  const asBuffer = Buffer.from(result);
  if (encoding === "buffer") {
    return asBuffer;
  }
  return asBuffer.toString(encoding);
}

let assertEncodingForWindows: any = undefined;
const realpathSync =
  process.platform !== "win32"
    ? fs.realpathSync.bind(fs)
    : function realpathSync(p, options) {
        let encoding;
        if (options) {
          if (typeof options === "string") encoding = options;
          else encoding = options?.encoding;
          encoding && (assertEncodingForWindows ?? $newZigFunction("types.zig", "jsAssertEncodingValid", 1))(encoding);
        }
        // This function is ported 1:1 from node.js, to emulate how it is unable to
        // resolve subst drives to their underlying location. The native call is
        // able to see through that.
        if (p instanceof URL) {
          if (p.pathname.indexOf("%00") != -1) {
            throw $ERR_INVALID_ARG_VALUE("path", "string without null bytes", p.pathname);
          }
          p = Bun.fileURLToPath(p as URL);
        } else {
          if (typeof p !== "string") {
            p += "";
          }
          p = getValidatedPath(p);
        }
        throwIfNullBytesInFileName(p);
        const knownHard = new Set();

        // Current character position in p
        let pos;
        // The partial path so far, including a trailing slash if any
        let current;
        // The partial path without a trailing slash (except when pointing at a root)
        let base;
        // The partial path scanned in the previous round, with slash
        let previous;

        // Skip over roots
        current = base = splitRootWindows(p);
        pos = current.length;

        // On windows, check that the root exists. On unix there is no need.
        let lastStat: StatsType = lstatSync(base, { throwIfNoEntry: true });
        if (lastStat === undefined) return;
        knownHard.$add(base);

        const pathModule = require("node:path");

        // Walk down the path, swapping out linked path parts for their real
        // values
        // NB: p.length changes.
        while (pos < p.length) {
          // find the next part
          const result = nextPartWindows(p, pos);
          previous = current;
          if (result === -1) {
            const last = p.slice(pos);
            current += last;
            base = previous + last;
            pos = p.length;
          } else {
            current += p.slice(pos, result + 1);
            base = previous + p.slice(pos, result);
            pos = result + 1;
          }

          // Continue if not a symlink, break if a pipe/socket
          if (knownHard.$has(base)) {
            if (lastStat.isFIFO() || lastStat.isSocket()) {
              break;
            }
            continue;
          }

          let resolvedLink;
          lastStat = fs.lstatSync(base, { throwIfNoEntry: true });
          if (lastStat === undefined) return;

          if (!lastStat.isSymbolicLink()) {
            knownHard.$add(base);
            continue;
          }

          lastStat = fs.statSync(base, { throwIfNoEntry: true });
          const linkTarget = fs.readlinkSync(base);
          resolvedLink = pathModule.resolve(previous, linkTarget);

          // Resolve the link, then start over
          p = pathModule.resolve(resolvedLink, p.slice(pos));

          // Skip over roots
          current = base = splitRootWindows(p);
          pos = current.length;

          // On windows, check that the root exists. On unix there is no need.
          if (!knownHard.$has(base)) {
            lastStat = fs.lstatSync(base, { throwIfNoEntry: true });
            if (lastStat === undefined) return;
            knownHard.$add(base);
          }
        }

        return encodeRealpathResult(p, encoding);
      };
const realpath: any =
  process.platform !== "win32"
    ? function realpath(p, options, callback) {
        if ($isCallable(options)) {
          callback = options;
          options = undefined;
        }
        ensureCallback(callback);

        fs.realpath(p, options, false).then(function (resolvedPath) {
          callback(null, resolvedPath);
        }, callback);
      }
    : function realpath(p, options, callback) {
        if ($isCallable(options)) {
          callback = options;
          options = undefined;
        }
        ensureCallback(callback);
        let encoding;
        if (options) {
          if (typeof options === "string") encoding = options;
          else encoding = options?.encoding;
          encoding && (assertEncodingForWindows ?? $newZigFunction("types.zig", "jsAssertEncodingValid", 1))(encoding);
        }
        if (p instanceof URL) {
          if (p.pathname.indexOf("%00") != -1) {
            throw $ERR_INVALID_ARG_VALUE("path", "string without null bytes", p.pathname);
          }
          p = Bun.fileURLToPath(p as URL);
        } else {
          if (typeof p !== "string") {
            p += "";
          }
          p = getValidatedPath(p);
        }
        throwIfNullBytesInFileName(p);

        const knownHard = new Set();
        const pathModule = require("node:path");

        // Current character position in p
        let pos;
        // The partial path so far, including a trailing slash if any
        let current;
        // The partial path without a trailing slash (except when pointing at a root)
        let base;
        // The partial path scanned in the previous round, with slash
        let previous;

        current = base = splitRootWindows(p);
        pos = current.length;

        let lastStat!: StatsType;

        // On windows, check that the root exists. On unix there is no need.
        if (!knownHard.has(base)) {
          lstat(base, (err, s) => {
            lastStat = s;
            if (err) return callback(err);
            knownHard.add(base);
            LOOP();
          });
        } else {
          process.nextTick(LOOP);
        }

        // Walk down the path, swapping out linked path parts for their real
        // values
        function LOOP() {
          while (true) {
            // Stop if scanned past end of path
            if (pos >= p.length) {
              return callback(null, encodeRealpathResult(p, encoding));
            }

            // find the next part
            const result = nextPartWindows(p, pos);
            previous = current;
            if (result === -1) {
              const last = p.slice(pos);
              current += last;
              base = previous + last;
              pos = p.length;
            } else {
              current += p.slice(pos, result + 1);
              base = previous + p.slice(pos, result);
              pos = result + 1;
            }

            // Continue if not a symlink, break if a pipe/socket
            if (knownHard.has(base)) {
              if (lastStat.isFIFO() || lastStat.isSocket()) {
                return callback(null, encodeRealpathResult(p, encoding));
              }
              continue;
            }

            return lstat(base, { bigint: true }, gotStat);
          }
        }

        function gotStat(err, stats) {
          if (err) return callback(err);

          // If not a symlink, skip to the next path part
          if (!stats.isSymbolicLink()) {
            knownHard.add(base);
            return process.nextTick(LOOP);
          }

          // Stat & read the link if not read before.
          // Call `gotTarget()` as soon as the link target is known.
          // `dev`/`ino` always return 0 on windows, so skip the check.
          stat(base, (err, s) => {
            if (err) return callback(err);
            lastStat = s;

            readlink(base, (err, target) => {
              gotTarget(err, target);
            });
          });
        }

        function gotTarget(err, target) {
          if (err) return callback(err);
          gotResolvedLink(pathModule.resolve(previous, target));
        }

        function gotResolvedLink(resolvedLink) {
          // Resolve the link, then start over
          p = pathModule.resolve(resolvedLink, p.slice(pos));
          current = base = splitRootWindows(p);
          pos = current.length;

          // On windows, check that the root exists. On unix there is no need.
          if (!knownHard.has(base)) {
            lstat(base, err => {
              if (err) return callback(err);
              knownHard.add(base);
              LOOP();
            });
          } else {
            process.nextTick(LOOP);
          }
        }
      };
realpath.native = function realpath(p, options, callback) {
  if ($isCallable(options)) {
    callback = options;
    options = undefined;
  }

  ensureCallback(callback);

  fs.realpathNative(p, options).then(function (resolvedPath) {
    callback(null, resolvedPath);
  }, callback);
};
realpathSync.native = fs.realpathNativeSync.bind(fs);

// attempt to use the native code version if possible
// and on MacOS, simple cases of recursive directory trees can be done in a single `clonefile()`
// using filter and other options uses a lazily loaded js fallback ported from node.js
function cpSync(src, dest, options) {
  if (!options) return fs.cpSync(src, dest);
  if (typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  if (options.dereference || options.filter || options.preserveTimestamps || options.verbatimSymlinks) {
    return require("../internal/fs/cp-sync")(src, dest, options);
  }
  return fs.cpSync(src, dest, options.recursive, options.errorOnExist, options.force ?? true, options.mode);
}

function cp(src, dest, options, callback) {
  if ($isCallable(options)) {
    callback = options;
    options = undefined;
  }

  ensureCallback(callback);

  promises.cp(src, dest, options).then(() => callback(), callback);
}

function _toUnixTimestamp(time: any, name = "time") {
  // @ts-ignore
  if (typeof time === "string" && +time == time) {
    return +time;
  }
  // @ts-ignore
  if ($isFinite(time)) {
    if (time < 0) {
      return Date.now() / 1000;
    }
    return time;
  }
  if (isDate(time)) {
    // Convert to 123.456 UNIX timestamp
    return time.getTime() / 1000;
  }
  throw $ERR_INVALID_ARG_TYPE(name, "number or Date", time);
}

function opendirSync(path, options) {
  // TODO: validatePath
  // validateString(path, "path");
  return new Dir(1, path, options);
}

class Dir {
  /**
   * `-1` when closed. stdio handles (0, 1, 2) don't actually get closed by
   * {@link close} or {@link closeSync}.
   */
  #handle: number;
  #path: PathLike;
  #options;
  #entries: DirentType[] | null = null;

  constructor(handle, path: PathLike, options) {
    if ($isUndefinedOrNull(handle)) throw $ERR_MISSING_ARGS("handle");
    validateInteger(handle, "handle", 0);
    this.#handle = $toLength(handle);
    this.#path = path;
    this.#options = options;
  }

  readSync() {
    if (this.#handle < 0) throw $ERR_DIR_CLOSED();

    let entries = (this.#entries ??= fs.readdirSync(this.#path, {
      withFileTypes: true,
      encoding: this.#options?.encoding,
      recursive: this.#options?.recursive,
    }));
    return entries.shift() ?? null;
  }

  read(cb?: (err: Error | null, entry: DirentType) => void): any {
    if (this.#handle < 0) throw $ERR_DIR_CLOSED();

    if (!$isUndefinedOrNull(cb)) {
      validateFunction(cb, "callback");
      return this.read().then(entry => cb(null, entry));
    }

    if (this.#entries) return Promise.resolve(this.#entries.shift() ?? null);

    return fs
      .readdir(this.#path, {
        withFileTypes: true,
        encoding: this.#options?.encoding,
        recursive: this.#options?.recursive,
      })
      .then(entries => {
        this.#entries = entries;
        return entries.shift() ?? null;
      });
  }

  close(cb?: () => void) {
    const handle = this.#handle;
    if (handle < 0) throw $ERR_DIR_CLOSED();
    if (!$isUndefinedOrNull(cb)) {
      validateFunction(cb, "callback");
      process.nextTick(cb);
    }
    if (handle > 2) fs.closeSync(handle);
    this.#handle = -1;
  }

  closeSync() {
    const handle = this.#handle;
    if (handle < 0) throw $ERR_DIR_CLOSED();
    if (handle > 2) fs.closeSync(handle);
    this.#handle = -1;
  }

  get path() {
    return this.#path;
  }

  async *[Symbol.asyncIterator]() {
    let entries = (this.#entries ??= await fs.readdir(this.#path, {
      withFileTypes: true,
      encoding: this.#options?.encoding,
      recursive: this.#options?.recursive,
    }));
    yield* entries;
  }
}

function glob(pattern: string | string[], options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  validateFunction(callback, "callback");

  Array.fromAsync(lazyGlob().glob(pattern, options ?? kEmptyObject))
    .then(result => callback(null, result))
    .catch(callback);
}

function globSync(pattern: string | string[], options): string[] {
  return Array.from(lazyGlob().globSync(pattern, options ?? kEmptyObject));
}

var exports = {
  appendFile,
  appendFileSync,
  access,
  accessSync,
  chown,
  chownSync,
  chmod,
  chmodSync,
  close,
  closeSync,
  copyFile,
  copyFileSync,
  cp,
  cpSync,
  createReadStream,
  createWriteStream,
  exists,
  existsSync,
  fchown,
  fchownSync,
  fchmod,
  fchmodSync,
  fdatasync,
  fdatasyncSync,
  fstat,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncate,
  ftruncateSync,
  futimes,
  futimesSync,
  glob,
  globSync,
  lchown,
  lchownSync,
  lchmod,
  lchmodSync,
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
  statfs,
  statSync,
  statfsSync,
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
  _toUnixTimestamp,
  openAsBlob,
  // Dir
  Dirent,
  opendir,
  opendirSync,
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  constants,
  Dir,
  Stats,
  get ReadStream() {
    return (exports.ReadStream = require("internal/fs/streams").ReadStream);
  },
  set ReadStream(value) {
    Object.defineProperty(exports, "ReadStream", {
      value,
      writable: true,
      configurable: true,
    });
  },
  get WriteStream() {
    return (exports.WriteStream = require("internal/fs/streams").WriteStream);
  },
  set WriteStream(value) {
    Object.defineProperty(exports, "WriteStream", {
      value,
      writable: true,
      configurable: true,
    });
  },
  get FileReadStream() {
    return (exports.FileReadStream = require("internal/fs/streams").FileReadStream);
  },
  set FileReadStream(value) {
    Object.defineProperty(exports, "FileReadStream", {
      value,
      writable: true,
      configurable: true,
    });
  },
  get FileWriteStream() {
    return (exports.FileWriteStream = require("internal/fs/streams").FileWriteStream);
  },
  set FileWriteStream(value) {
    Object.defineProperty(exports, "FileWriteStream", {
      value,
      writable: true,
      configurable: true,
    });
  },
  promises,
};
export default exports;

// Preserve the names
function setName(fn, value) {
  Object.$defineProperty(fn, "name", { value, enumerable: false, configurable: true });
}
setName(Dirent, "Dirent");
setName(FSWatcher, "FSWatcher");
setName(Stats, "Stats");
setName(_toUnixTimestamp, "_toUnixTimestamp");
setName(access, "access");
setName(accessSync, "accessSync");
setName(appendFile, "appendFile");
setName(appendFileSync, "appendFileSync");
setName(chmod, "chmod");
setName(chmodSync, "chmodSync");
setName(chown, "chown");
setName(chownSync, "chownSync");
setName(close, "close");
setName(closeSync, "closeSync");
setName(copyFile, "copyFile");
setName(copyFileSync, "copyFileSync");
setName(cp, "cp");
setName(cpSync, "cpSync");
setName(createReadStream, "createReadStream");
setName(createWriteStream, "createWriteStream");
setName(exists, "exists");
setName(existsSync, "existsSync");
setName(fchmod, "fchmod");
setName(fchmodSync, "fchmodSync");
setName(fchown, "fchown");
setName(fchownSync, "fchownSync");
setName(fstat, "fstat");
setName(fstatSync, "fstatSync");
setName(fsync, "fsync");
setName(fsyncSync, "fsyncSync");
setName(ftruncate, "ftruncate");
setName(ftruncateSync, "ftruncateSync");
setName(futimes, "futimes");
setName(futimesSync, "futimesSync");
if (lchmod) setName(lchmod, "lchmod");
if (lchmodSync) setName(lchmodSync, "lchmodSync");
setName(lchown, "lchown");
setName(lchownSync, "lchownSync");
setName(link, "link");
setName(linkSync, "linkSync");
setName(lstat, "lstat");
setName(lstatSync, "lstatSync");
setName(lutimes, "lutimes");
setName(lutimesSync, "lutimesSync");
setName(mkdir, "mkdir");
setName(mkdirSync, "mkdirSync");
setName(mkdtemp, "mkdtemp");
setName(mkdtempSync, "mkdtempSync");
setName(open, "open");
setName(openSync, "openSync");
setName(read, "read");
setName(readFile, "readFile");
setName(readFileSync, "readFileSync");
setName(readSync, "readSync");
setName(readdir, "readdir");
setName(readdirSync, "readdirSync");
setName(readlink, "readlink");
setName(readlinkSync, "readlinkSync");
setName(readv, "readv");
setName(readvSync, "readvSync");
setName(realpath, "realpath");
setName(realpathSync, "realpathSync");
setName(rename, "rename");
setName(renameSync, "renameSync");
setName(rm, "rm");
setName(rmSync, "rmSync");
setName(rmdir, "rmdir");
setName(rmdirSync, "rmdirSync");
setName(stat, "stat");
setName(statfs, "statfs");
setName(statSync, "statSync");
setName(statfsSync, "statfsSync");
setName(symlink, "symlink");
setName(symlinkSync, "symlinkSync");
setName(truncate, "truncate");
setName(truncateSync, "truncateSync");
setName(unlink, "unlink");
setName(unlinkSync, "unlinkSync");
setName(unwatchFile, "unwatchFile");
setName(utimes, "utimes");
setName(utimesSync, "utimesSync");
setName(watch, "watch");
setName(watchFile, "watchFile");
setName(write, "write");
setName(writeFile, "writeFile");
setName(writeFileSync, "writeFileSync");
setName(writeSync, "writeSync");
setName(writev, "writev");
setName(writevSync, "writevSync");
setName(fdatasync, "fdatasync");
setName(fdatasyncSync, "fdatasyncSync");
setName(openAsBlob, "openAsBlob");
setName(opendir, "opendir");
