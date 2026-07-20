// Hardcoded module "node:fs"
import type { Dirent as DirentType, PathLike, Stats as StatsType } from "fs";
const promises = require("node:fs/promises");
const types = require("node:util/types");
const {
  validateFunction,
  validateInteger,
  validateEncoding,
  getValidatedPath,
  throwIfNullBytesInFileName,
} = require("internal/validators");

const kEmptyObject = Object.freeze(Object.create(null));

const isDate = types.isDate;

// The native `node:fs` binding, shared via `internal/fs/binding`.
const fs = require("internal/fs/binding");

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

function openAsBlob(path, options) {
  return Promise.$resolve(Bun.file(path, options));
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
    // route through promises.rm for the JS-side ERR_FS_EISDIR validation
    promises.rm(path, options).then(nullcallback(callback), callback);
  },
  rmdir = function rmdir(path, options, callback) {
    if ($isCallable(options)) {
      callback = options;
      options = undefined;
    }
    callback = ensureCallback(callback);

    // node throws for any defined `recursive`, not just truthy ones
    if (options?.recursive !== undefined) {
      throw $ERR_INVALID_ARG_VALUE("options.recursive", options.recursive, "is no longer supported");
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
    } catch {
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
    const argc = arguments.length;
    if (argc <= 4) {
      if (argc === 4) {
        // This is fs.read(fd, buffer, options, callback)
        // validateObject(params, 'options', kValidateObjectAllowNullable);
        if (typeof params !== "object" || $isArray(params)) {
          throw $ERR_INVALID_ARG_TYPE("options", "object", params);
        }
        callback = length;
        params = offsetOrOptions;
      } else if (argc === 3) {
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

    // $isTypedArrayView excludes DataView, so a DataView would fall through
    // to the string signature. Use Node's predicate, like writeSync below.
    if (types.isArrayBufferView(buffer)) {
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

    if (typeof buffer !== "string") {
      throw $ERR_INVALID_ARG_TYPE("buffer", ["string", "Buffer", "TypedArray", "DataView"], buffer);
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

    // Node validates the encoding (synchronously) before the callback.
    validateEncoding(buffer, length);
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

    const signal = options?.signal;
    if (signal?.aborted) {
      process.nextTick(callback, $makeAbortError(undefined, { cause: signal.reason }));
      return;
    }

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
  existsSync = function existsSync(_path: string) {
    try {
      return fs.existsSync.$apply(fs, arguments);
    } catch {
      return false;
    }
  },
  chownSync = fs.chownSync.bind(fs) as unknown as typeof import("node:fs").chownSync,
  chmodSync = fs.chmodSync.bind(fs) as unknown as typeof import("node:fs").chmodSync,
  fchmodSync = fs.fchmodSync.bind(fs) as unknown as typeof import("node:fs").fchmodSync,
  fchownSync = fs.fchownSync.bind(fs) as unknown as typeof import("node:fs").fchownSync,
  fstatSync = fs.fstatSync.bind(fs) as unknown as typeof import("node:fs").fstatSync,
  fsyncSync = fs.fsyncSync.bind(fs) as unknown as typeof import("node:fs").fsyncSync,
  ftruncateSync = fs.ftruncateSync.bind(fs) as unknown as typeof import("node:fs").ftruncateSync,
  futimesSync = fs.futimesSync.bind(fs) as unknown as typeof import("node:fs").futimesSync,
  lchmodSync = constants.O_SYMLINK !== undefined ? fs.lchmodSync.bind(fs) : undefined, // lchmod is only available on macOS
  lchownSync = fs.lchownSync.bind(fs) as unknown as typeof import("node:fs").lchownSync,
  linkSync = fs.linkSync.bind(fs) as unknown as typeof import("node:fs").linkSync,
  lstatSync = fs.lstatSync.bind(fs) as unknown as typeof import("node:fs").lstatSync,
  mkdirSync = fs.mkdirSync.bind(fs) as unknown as typeof import("node:fs").mkdirSync,
  mkdtempSync = fs.mkdtempSync.bind(fs) as unknown as typeof import("node:fs").mkdtempSync,
  mkdtempDisposableSync = function mkdtempDisposableSync(prefix, options) {
    const path = mkdtempSync(prefix, options);
    // Stash the full path in case of process.chdir()
    const fullPath = require("node:path").resolve(path);
    function remove() {
      // force makes repeated removal a no-op; real failures (EACCES) still throw
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
    return { path, remove, [Symbol.dispose]: remove };
  },
  openSync = fs.openSync.bind(fs) as unknown as typeof import("node:fs").openSync,
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
  writeSync = function writeSync(fd, buffer, offsetOrOptions, length, position) {
    try {
      if (types.isArrayBufferView(buffer)) {
        let offset = offsetOrOptions;
        if (typeof offset === "object" && offset !== null) {
          ({ offset = 0, length = buffer.byteLength - offset, position = null } = offsetOrOptions);
          return fs.writeSync(fd, buffer, offset, length, position);
        }
        return arguments.length <= 2 ? fs.writeSync(fd, buffer) : fs.writeSync(fd, buffer, offset, length, position);
      }
      if (typeof buffer !== "string") {
        throw $ERR_INVALID_ARG_TYPE("buffer", ["string", "Buffer", "TypedArray", "DataView"], buffer);
      }
      // writeSync(fd, string[, position[, encoding]]): `length` is the encoding.
      validateEncoding(buffer, length);
      return fs.writeSync(fd, buffer, offsetOrOptions, length);
    } catch (err) {
      // Node's fs binding reports sync write failures by assigning the error
      // context onto a plain object with ordinary assignment semantics, so
      // accessors installed on Object.prototype observe (and can replace) the
      // error instead of crashing the process. Replicate that contract.
      const ctx = {};
      ctx.errno = err?.errno;
      ctx.syscall = err?.syscall;
      ctx.code = err?.code;
      throw err;
    }
  },
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
  rmSync = function rmSync(path, options) {
    if (!options?.recursive) {
      // node validates in JS and reports ERR_FS_EISDIR for directories
      let stats;
      try {
        stats = fs.lstatSync(path);
      } catch {
        // let the native call produce the error (respects force/ENOENT)
      }
      if (stats?.isDirectory()) {
        throw require("internal/fs/cp-sync").fsEisdirError({
          code: "EISDIR",
          message: "is a directory",
          path,
          syscall: "rm",
          errno: $processBindingConstants.os.errno.EISDIR,
        });
      }
    }
    return fs.rmSync(path, options);
  },
  rmdirSync = function rmdirSync(path, options) {
    // node throws for any defined `recursive`, not just truthy ones
    if (options?.recursive !== undefined) {
      throw $ERR_INVALID_ARG_VALUE("options.recursive", options.recursive, "is no longer supported");
    }
    return fs.rmdirSync(path, options);
  },
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
    return require("internal/fs/watch").watch(path, options, listener);
  },
  opendir = function opendir(path, options, callback) {
    // TODO: validatePath
    // validateString(path, "path");
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    validateFunction(callback, "callback");
    // Argument validation errors throw synchronously (node does the same);
    // the eager path check runs on an async stat so the JS thread isn't
    // blocked and the callback never fires synchronously.
    const result = new Dir(1, path, options, kAlreadyValidated);
    // Invoke the callback from process.nextTick so an exception thrown by it
    // surfaces as an uncaught exception instead of rejecting this internal
    // promise chain (same convention as glob() below).
    fs.stat(path).then(
      onOpendirStatFulfilled.bind(null, callback, path, result),
      onOpendirStatRejected.bind(null, callback, path),
    );
  };

const { defineCustomPromisifyArgs } = require("internal/promisify");
var kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");
const existsCb = exists;
exists[kCustomPromisifiedSymbol] = {
  exists(path) {
    return new Promise(resolve => existsCb(path, resolve));
  },
}.exists;
defineCustomPromisifyArgs(read, ["bytesRead", "buffer"]);
defineCustomPromisifyArgs(readv, ["bytesRead", "buffers"]);
defineCustomPromisifyArgs(write, ["bytesWritten", "buffer"]);
defineCustomPromisifyArgs(writev, ["bytesWritten", "buffers"]);

// The implementation (StatWatcher and friends) is lazily loaded from "internal/fs/watchfile"
// the first time fs.watchFile or fs.unwatchFile is called.
function watchFile(filename, options, listener) {
  return require("internal/fs/watchfile").watchFile(filename, options, listener);
}
function unwatchFile(filename, listener) {
  return require("internal/fs/watchfile").unwatchFile(filename, listener);
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
let insideAppContainer: boolean | undefined;
// Defer a denied component to native only inside an AppContainer (denied
// ancestors are the sandbox norm and can hide links); outside one, Node
// parity: the walk's error propagates. Lazy: probe on first denial only.
function shouldDeferDeniedComponent(err: any) {
  if (!(insideAppContainer ??= fs.isInsideAppContainer())) return false;
  const code = err?.code;
  return code === "EPERM" || code === "EACCES";
}
// A denied component (e.g. drive roots when sandboxed) can hide a link, so
// never assume it is a plain directory: resolve through the native path
// (true chain); if that also fails, its more definitive error propagates.
function resolveDeniedComponentSync(p: string, encoding: any) {
  return encodeRealpathResult(fs.realpathNativeSync(p, undefined), encoding);
}
function resolveDeniedComponent(p: string, encoding: any, callback: any) {
  fs.realpathNative(p, undefined).then(resolved => callback(null, encodeRealpathResult(resolved, encoding)), callback);
}
const realpathSync: typeof import("node:fs").realpathSync =
  process.platform !== "win32"
    ? (fs.realpathSync.bind(fs) as any)
    : function realpathSync(p, options) {
        let encoding;
        if (options) {
          if (typeof options === "string") encoding = options;
          else encoding = options?.encoding;
          if (encoding) {
            (assertEncodingForWindows ?? $newRustFunction("runtime/node/types.rs", "jsAssertEncodingValid", 1))(
              encoding,
            );
          }
        }
        // Ported from node.js to emulate not resolving subst drives (the
        // native call sees through them) - except permission-denied
        // components, which defer to native (resolveDeniedComponentSync).
        if (p instanceof URL) {
          const pathname = p.pathname;
          if (pathname.indexOf("%00") != -1) {
            throw $ERR_INVALID_ARG_VALUE("path", "string without null bytes", pathname);
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
        let lastStat: StatsType;
        try {
          lastStat = lstatSync(base, { throwIfNoEntry: true });
        } catch (err) {
          if (!shouldDeferDeniedComponent(err)) throw err;
          return resolveDeniedComponentSync(p, encoding);
        }
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
          try {
            lastStat = fs.lstatSync(base, { throwIfNoEntry: true });
          } catch (err) {
            if (!shouldDeferDeniedComponent(err)) throw err;
            return resolveDeniedComponentSync(p, encoding);
          }
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
            try {
              lastStat = fs.lstatSync(base, { throwIfNoEntry: true });
            } catch (err) {
              if (!shouldDeferDeniedComponent(err)) throw err;
              return resolveDeniedComponentSync(p, encoding);
            }
            if (lastStat === undefined) return;
            knownHard.$add(base);
          }
        }

        return encodeRealpathResult(p, encoding);
      };
const realpath: typeof import("node:fs").realpath =
  process.platform !== "win32"
    ? (function realpath(p, options, callback) {
        if ($isCallable(options)) {
          callback = options;
          options = undefined;
        }
        ensureCallback(callback);

        fs.realpath(p, options, false).then(function (resolvedPath) {
          callback(null, resolvedPath);
        }, callback);
      } as typeof import("node:fs").realpath)
    : (function realpath(p, options, callback) {
        if ($isCallable(options)) {
          callback = options;
          options = undefined;
        }
        ensureCallback(callback);
        let encoding;
        if (options) {
          if (typeof options === "string") encoding = options;
          else encoding = options?.encoding;
          if (encoding) {
            (assertEncodingForWindows ?? $newRustFunction("runtime/node/types.rs", "jsAssertEncodingValid", 1))(
              encoding,
            );
          }
        }
        if (p instanceof URL) {
          const pathname = p.pathname;
          if (pathname.indexOf("%00") != -1) {
            throw $ERR_INVALID_ARG_VALUE("path", "string without null bytes", pathname);
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
            if (err) {
              if (!shouldDeferDeniedComponent(err)) return callback(err);
              return resolveDeniedComponent(p, encoding, callback);
            }
            lastStat = s;
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
          if (err) {
            if (!shouldDeferDeniedComponent(err)) return callback(err);
            return resolveDeniedComponent(p, encoding, callback);
          }

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
              if (err) {
                if (!shouldDeferDeniedComponent(err)) return callback(err);
                return resolveDeniedComponent(p, encoding, callback);
              }
              knownHard.add(base);
              LOOP();
            });
          } else {
            process.nextTick(LOOP);
          }
        }
      } as typeof import("node:fs").realpath);
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
  const { cpSyncFn, validateCpOptions, tryNativeFastPathSync } = require("internal/fs/cp-sync");
  const { getValidatedFsPath } = require("internal/validators");
  options = validateCpOptions(options);
  src = getValidatedFsPath(src, "src");
  dest = getValidatedFsPath(dest, "dest");
  const { filter, dereference, preserveTimestamps, verbatimSymlinks, mode, errorOnExist, force, recursive } = options;
  if (!filter && !dereference && !preserveTimestamps && !verbatimSymlinks && !mode && !errorOnExist && force) {
    const { ok, checked } = tryNativeFastPathSync(src, dest, options);
    if (ok) {
      return fs.cpSync(src, dest, recursive, errorOnExist, force, mode);
    }
    return cpSyncFn(src, dest, options, checked);
  }
  return cpSyncFn(src, dest, options);
}

function cp(src, dest, options, callback) {
  if ($isCallable(options)) {
    callback = options;
    options = undefined;
  }

  ensureCallback(callback);

  // node's callback form throws synchronously on invalid options/paths
  const { validateCpOptions } = require("internal/fs/cp-sync");
  const { getValidatedFsPath } = require("internal/validators");
  options = validateCpOptions(options);
  src = getValidatedFsPath(src, "src");
  dest = getValidatedFsPath(dest, "dest");

  promises.cp(src, dest, options).then(callOnceWithNull.bind(null, callback), callback);
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

function onOpendirStatFulfilled(callback, path, result, stats) {
  if (!stats.isDirectory()) {
    process.nextTick(callback, opendirNotDirError(path));
    return;
  }
  process.nextTick(callback, null, result);
}
function onOpendirStatRejected(callback, path, err) {
  process.nextTick(callback, typeof err?.errno === "number" ? opendirStatError(err, path) : err);
}
function callOnceWithNull(callback) {
  callback(null);
}
function callOnceWithNullThen(callback, value) {
  callback(null, value);
}

function opendirSync(path, options) {
  // TODO: validatePath
  // validateString(path, "path");
  return new Dir(1, path, options);
}

// Reshape a stat error as node's eager opendir error. Stat errors arrive as
// "ECODE: <description>, stat '<path>'"; pull out just the description before
// re-prefixing (avoids "EACCES: EACCES: ...").
function opendirStatError(err, path) {
  err.syscall = "opendir";
  const description = err.message.replace(/^[A-Z]+: /, "").replace(/, l?stat '.*'$/, "");
  err.message = `${err.code}: ${description}, opendir '${path}'`;
  return err;
}

function opendirNotDirError(path) {
  const err = new Error(`ENOTDIR: not a directory, opendir '${path}'`);
  err.code = "ENOTDIR";
  // libuv's UV_ENOTDIR: -ENOTDIR on POSIX, -4052 on Windows
  err.errno = process.platform === "win32" ? -4052 : -20;
  err.syscall = "opendir";
  err.path = path;
  return err;
}

// Passed as the Dir constructor's 4th argument by the async opendir paths,
// which run the eager path check with an async stat instead.
const kAlreadyValidated = Symbol("kAlreadyValidated");

class Dir {
  /**
   * `-1` when closed. stdio handles (0, 1, 2) don't actually get closed by
   * {@link close} or {@link closeSync}.
   */
  #handle: number;
  #path: PathLike;
  #options;
  #entries: DirentType[] | null = null;
  #entriesIdx = 0;

  constructor(handle, path: PathLike, options, validated?) {
    if ($isUndefinedOrNull(handle)) throw $ERR_MISSING_ARGS("handle");
    validateInteger(handle, "handle", 0);
    if (options != null && typeof options !== "object" && typeof options !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options", "object", options);
    }
    // node's getOptions: a string is encoding shorthand
    if (typeof options === "string") options = { encoding: options };
    const encoding = options?.encoding;
    if (encoding != null && encoding !== "buffer" && !Buffer.isEncoding(encoding)) {
      throw $ERR_INVALID_ARG_VALUE("encoding", encoding, "is invalid encoding");
    }
    if (options?.bufferSize !== undefined) {
      validateInteger(options.bufferSize, "options.bufferSize", 1);
    }
    if (handle === 1 && validated !== kAlreadyValidated) {
      // node's opendir opens the directory eagerly and reports ENOTDIR/ENOENT
      let stats;
      try {
        stats = fs.statSync(path);
      } catch (err: any) {
        if (typeof err?.errno !== "number") throw err; // argument validation errors throw as-is
        throw opendirStatError(err, path);
      }
      if (!stats.isDirectory()) {
        throw opendirNotDirError(path);
      }
    }
    this.#handle = $toLength(handle);
    this.#path = path;
    this.#options = options;
  }

  // Number of in-flight async operations; sync ops are forbidden while > 0,
  // and async ops queue behind #pendingOp like node's operation queue.
  #pendingCount = 0;
  #pendingOp: Promise<any> | null = null;

  #dirConcurrentError() {
    return $ERR_DIR_CONCURRENT_OPERATION(
      "Cannot do synchronous work on directory handle with concurrent asynchronous operations",
    );
  }

  #enqueue(run) {
    const prev = this.#pendingOp;
    let p;
    if (prev) {
      p = prev.then(run, run);
    } else {
      try {
        const r = run();
        p = $isPromise(r) ? r : Promise.$resolve(r);
      } catch (e) {
        p = Promise.$reject(e);
      }
    }
    this.#pendingCount++;
    this.#pendingOp = p;
    const done = this.#opDone.bind(this);
    p.then(done, done);
    return p;
  }

  readSync() {
    if (this.#handle < 0) throw $ERR_DIR_CLOSED();
    if (this.#pendingCount > 0) throw this.#dirConcurrentError();

    let entries = (this.#entries ??= fs.readdirSync(this.#path, {
      withFileTypes: true,
      encoding: this.#options?.encoding,
      recursive: this.#options?.recursive,
    }));
    return this.#entriesIdx < entries.length ? entries[this.#entriesIdx++] : null;
  }

  read(cb?: (err: Error | null, entry: DirentType) => void): any {
    if (!$isUndefinedOrNull(cb)) {
      validateFunction(cb, "callback");
      // node's callback overload returns undefined (like close(cb) above)
      this.read().then(callOnceWithNullThen.bind(null, cb), cb);
      return;
    }

    return this.#enqueue(this.#readOp.bind(this));
  }

  #opDone() {
    if (--this.#pendingCount === 0) this.#pendingOp = null;
  }

  #readOp() {
    if (this.#handle < 0) throw $ERR_DIR_CLOSED();
    const entries = this.#entries;
    if (entries) return this.#entriesIdx < entries.length ? entries[this.#entriesIdx++] : null;
    return fs
      .readdir(this.#path, {
        withFileTypes: true,
        encoding: this.#options?.encoding,
        recursive: this.#options?.recursive,
      })
      .then(this.#onReaddir.bind(this));
  }

  #onReaddir(entries) {
    this.#entries = entries;
    this.#entriesIdx = 0;
    return this.#entriesIdx < entries.length ? entries[this.#entriesIdx++] : null;
  }

  #closeOp() {
    const handle = this.#handle;
    if (handle < 0) throw $ERR_DIR_CLOSED();
    if (handle > 2) fs.closeSync(handle);
    this.#handle = -1;
  }

  close(cb?: (err?: Error) => void) {
    if (!$isUndefinedOrNull(cb)) {
      validateFunction(cb, "callback");
      this.close().then(callOnceWithNull.bind(null, cb), cb);
      return;
    }
    return this.#enqueue(this.#closeOp.bind(this));
  }

  closeSync() {
    const handle = this.#handle;
    if (handle < 0) throw $ERR_DIR_CLOSED();
    if (this.#pendingCount > 0) throw this.#dirConcurrentError();
    if (handle > 2) fs.closeSync(handle);
    this.#handle = -1;
  }

  // Like node, disposing an already-closed Dir is a no-op rather than
  // ERR_DIR_CLOSED so `using`/`await using` compose with an explicit close().
  [Symbol.dispose]() {
    if (this.#handle < 0) return;
    this.closeSync();
  }

  async [Symbol.asyncDispose]() {
    if (this.#handle < 0) return;
    await this.close();
  }

  get path() {
    if (!(#path in this)) throw $ERR_INVALID_THIS("Dir");
    return this.#path;
  }

  async *[Symbol.asyncIterator]() {
    try {
      let entry;
      while ((entry = await this.read()) !== null) {
        yield entry;
      }
    } finally {
      // node closes the directory when iteration ends or exits early. Use the
      // queued async close() so a concurrent in-flight operation doesn't make
      // teardown throw ERR_DIR_CONCURRENT_OPERATION.
      if (this.#handle >= 0) await this.close();
    }
  }
}

function glob(pattern: string | string[], options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  validateFunction(callback, "callback");

  // Invoke the callback from process.nextTick so that an exception thrown by
  // the callback surfaces as an uncaught exception instead of rejecting the
  // internal promise chain (and is never routed back into `callback` as an
  // error), matching Node.js.
  Array.fromAsync(lazyGlob().glob(pattern, options ?? kEmptyObject)).then(
    nextTickWithNullThen.bind(null, callback),
    nextTickWith.bind(null, callback),
  );
}
function nextTickWithNullThen(callback, result) {
  process.nextTick(callback, null, result);
}
function nextTickWith(callback, err) {
  process.nextTick(callback, err);
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
  mkdtempDisposableSync,
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
    return (exports.FileReadStream = require("internal/fs/streams").ReadStream);
  },
  set FileReadStream(value) {
    Object.defineProperty(exports, "FileReadStream", {
      value,
      writable: true,
      configurable: true,
    });
  },
  get FileWriteStream() {
    return (exports.FileWriteStream = require("internal/fs/streams").WriteStream);
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
  Object.$defineProperty(fn, "name", {
    value,
    enumerable: false,
    configurable: true,
  });
}
setName(Dirent, "Dirent");
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
