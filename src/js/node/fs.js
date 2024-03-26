// Hardcoded module "node:fs"
var ReadStream;
var WriteStream;
const EventEmitter = require("node:events");
const promises = require("node:fs/promises");
const Stream = require("node:stream");

var _writeStreamPathFastPathSymbol = Symbol.for("Bun.NodeWriteStreamFastPath");
var _fs = Symbol.for("#fs");

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
    } catch (e) {
      if (!e.message?.startsWith("FileNotFound")) {
        throw e;
      }
      const notFound = new Error(`ENOENT: no such file or directory, watch '${path}'`);
      notFound.code = "ENOENT";
      notFound.errno = -2;
      notFound.path = path;
      notFound.syscall = "watch";
      notFound.filename = path;
      throw notFound;
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
// interface StatWatcherHandle {
//   ref();
//   unref();
//   close();
// }

function openAsBlob(path, options) {
  return Promise.$resolve(Bun.file(path, options));
}

class StatWatcher extends EventEmitter {
  // _handle: StatWatcherHandle;

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
  fdatasync = function fdatasync(...args) {
    callbackify(fs.fdatasync, args);
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
  fdatasyncSync = fs.fdatasyncSync.bind(fs),
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
  writev = function writev(fd, buffers, position, callback) {
    if (typeof position === "function") {
      callback = position;
      position = null;
    }

    if (!$isCallable(callback)) {
      throw new TypeError("callback must be a function");
    }

    fs.writev(fd, buffers, position).$then(bytesWritten => callback(null, bytesWritten, buffers), callback);
  },
  writevSync = fs.writevSync.bind(fs),
  readv = function readv(fd, buffers, position, callback) {
    if (typeof position === "function") {
      callback = position;
      position = null;
    }

    if (!$isCallable(callback)) {
      throw new TypeError("callback must be a function");
    }

    fs.readv(fd, buffers, position).$then(bytesRead => callback(null, bytesRead, buffers), callback);
  },
  readvSync = fs.readvSync.bind(fs),
  Dirent = fs.Dirent,
  Stats = fs.Stats,
  watch = function watch(path, options, listener) {
    return new FSWatcher(path, options, listener);
  },
  opendir = function opendir(...args) {
    callbackify(promises.opendir, args);
  };

// TODO: make symbols a separate export somewhere
var kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");

exists[kCustomPromisifiedSymbol] = path => new Promise(resolve => exists(path, resolve));

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

// TODO: move this entire thing into native code.
// the reason it's not done right now is because there isnt a great way to have multiple
// listeners per StatWatcher with the current implementation in native code. the downside
// of this means we need to do path validation in the js side of things
const statWatchers = new Map();
let _pathModule;
function getValidatedPath(p) {
  if (p instanceof URL) return Bun.fileURLToPath(p);
  if (typeof p !== "string") throw new TypeError("Path must be a string or URL.");
  return (_pathModule ??= require("node:path")).resolve(p);
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
  if (!stat) return;
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
var readStreamPathFastPathSymbol = Symbol.for("Bun.Node.readStreamPathFastPath");
const readStreamSymbol = Symbol.for("Bun.NodeReadStream");
const readStreamPathOrFdSymbol = Symbol.for("Bun.NodeReadStreamPathOrFd");
const writeStreamSymbol = Symbol.for("Bun.NodeWriteStream");
var writeStreamPathFastPathSymbol = Symbol.for("Bun.NodeWriteStreamFastPath");
var writeStreamPathFastPathCallSymbol = Symbol.for("Bun.NodeWriteStreamFastPathCall");
var kIoDone = Symbol.for("kIoDone");

var defaultReadStreamOptions = {
  file: undefined,
  fd: null,
  flags: "r",
  encoding: undefined,
  mode: 0o666,
  autoClose: true,
  emitClose: true,
  start: 0,
  end: Infinity,
  highWaterMark: 64 * 1024,
  fs: {
    read,
    open: (path, flags, mode, cb) => {
      var fd;
      try {
        fd = openSync(path, flags, mode);
      } catch (e) {
        cb(e);
        return;
      }

      cb(null, fd);
    },
    openSync,
    close,
  },
  autoDestroy: true,
};

let { FileHandle, kRef, kUnref, kFd } = promises.$data;
let kHandle = Symbol("kHandle");

var ReadStreamClass;

ReadStream = (function (InternalReadStream) {
  ReadStreamClass = InternalReadStream;
  Object.defineProperty(ReadStreamClass.prototype, Symbol.toStringTag, {
    value: "ReadStream",
    enumerable: false,
  });
  function ReadStream(path, options) {
    return new InternalReadStream(path, options);
  }
  ReadStream.prototype = InternalReadStream.prototype;
  return Object.defineProperty(ReadStream, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalReadStream;
    },
  });
})(
  class ReadStream extends Stream._getNativeReadableStreamPrototype(2, Stream.Readable) {
    constructor(pathOrFd, options = defaultReadStreamOptions) {
      if (typeof options === "string") {
        options = { encoding: options };
      }

      if (!$isObject(options) && !$isCallable(options)) {
        throw new TypeError("Expected options to be an object or a string");
      }

      var {
        flags = defaultReadStreamOptions.flags,
        encoding = defaultReadStreamOptions.encoding,
        mode = defaultReadStreamOptions.mode,
        autoClose = defaultReadStreamOptions.autoClose,
        emitClose = defaultReadStreamOptions.emitClose,
        start = defaultReadStreamOptions.start,
        end = defaultReadStreamOptions.end,
        autoDestroy = defaultReadStreamOptions.autoClose,
        fs: overridden_fs = defaultReadStreamOptions.fs,
        highWaterMark = defaultReadStreamOptions.highWaterMark,
        fd = defaultReadStreamOptions.fd,
      } = options;

      if (pathOrFd?.constructor?.name === "URL") {
        pathOrFd = Bun.fileURLToPath(pathOrFd);
      }

      // This is kinda hacky but we create a temporary object to assign props that we will later pull into the `this` context after we call super
      var tempThis = {};
      let handle = null;
      if (fd != null) {
        if (typeof fd !== "number") {
          if (fd instanceof FileHandle) {
            tempThis.fd = fd[kFd];
            if (tempThis.fd < 0) {
              throw new Error("Expected a valid file descriptor");
            }
            fd[kRef]();
            handle = fd;
          } else {
            throw new TypeError("Expected options.fd to be a number or FileHandle");
          }
        } else {
          tempThis.fd = tempThis[readStreamPathOrFdSymbol] = fd;
        }
        tempThis.autoClose = false;
      } else if (typeof pathOrFd === "string") {
        if (pathOrFd.startsWith("file://")) {
          pathOrFd = Bun.fileURLToPath(pathOrFd);
        }
        if (pathOrFd.length === 0) {
          throw new TypeError("Expected path to be a non-empty string");
        }
        tempThis.path = tempThis.file = tempThis[readStreamPathOrFdSymbol] = pathOrFd;
      } else if (typeof pathOrFd === "number") {
        pathOrFd |= 0;
        if (pathOrFd < 0) {
          throw new TypeError("Expected fd to be a positive integer");
        }
        tempThis.fd = tempThis[readStreamPathOrFdSymbol] = pathOrFd;

        tempThis.autoClose = false;
      } else {
        throw new TypeError("Expected a path or file descriptor");
      }

      // If fd not open for this file, open it
      if (tempThis.fd === undefined) {
        // NOTE: this fs is local to constructor, from options
        tempThis.fd = overridden_fs.openSync(pathOrFd, flags, mode);
      }

      // Get FileRef from fd
      var fileRef = Bun.file(tempThis.fd);

      // Get the stream controller
      // We need the pointer to the underlying stream controller for the NativeReadable
      var stream = fileRef.stream();
      var ptr = stream.$bunNativePtr;
      if (!ptr) {
        throw new Error("Failed to get internal stream controller. This is a bug in Bun");
      }

      super(ptr, {
        ...options,
        encoding,
        autoDestroy,
        autoClose,
        emitClose,
        highWaterMark,
      });

      // Assign the tempThis props to this
      Object.assign(this, tempThis);
      this.#handle = handle;
      this.end = end;
      this._read = this.#internalRead;
      this.start = start;
      this.flags = flags;
      this.mode = mode;
      this.emitClose = emitClose;

      this[readStreamPathFastPathSymbol] =
        start === 0 &&
        end === Infinity &&
        autoClose &&
        fs === defaultReadStreamOptions.fs &&
        // is it an encoding which we don't need to decode?
        (encoding === "buffer" ||
          encoding === "binary" ||
          encoding == null ||
          encoding === "utf-8" ||
          encoding === "utf8");
      this._readableState.autoClose = autoDestroy = autoClose;
      this._readableState.highWaterMark = highWaterMark;

      if (start !== undefined) {
        this.pos = start;
      }

      $assert(overridden_fs);
      this.#fs = overridden_fs;
    }
    #handle;
    #fs;
    file;
    path;
    fd = null;
    flags;
    mode;
    start;
    end;
    pos;
    bytesRead = 0;
    #fileSize = -1;
    _read;

    [readStreamSymbol] = true;
    [readStreamPathOrFdSymbol];
    [readStreamPathFastPathSymbol];

    _construct(callback) {
      if (super._construct) {
        super._construct(callback);
      } else {
        callback();
      }
      this.emit("open", this.fd);
      this.emit("ready");
    }

    _destroy(err, cb) {
      try {
        this[readStreamPathFastPathSymbol] = false;
        var handle = this.#handle;
        if (handle) {
          handle[kUnref]();
          this.fd = null;
          this.#handle = null;
          super._destroy(err, cb);
          return;
        }

        var fd = this.fd;
        if (!fd) {
          super._destroy(err, cb);
        } else {
          $assert(this.#fs);
          this.#fs.close(fd, er => {
            super._destroy(er || err, cb);
          });
          this.fd = null;
        }
      } catch (e) {
        throw e;
      }
    }

    close(cb) {
      if (typeof cb === "function") Stream.eos(this, cb);
      this.destroy();
    }

    push(chunk) {
      // Is it even possible for this to be less than 1?
      var bytesRead = chunk?.length ?? 0;
      if (bytesRead > 0) {
        this.bytesRead += bytesRead;
        var currPos = this.pos;
        // Handle case of going through bytes before pos if bytesRead is less than pos
        // If pos is undefined, we are reading through the whole file
        // Otherwise we started from somewhere in the middle of the file
        if (currPos !== undefined) {
          // At this point we still haven't hit our `start` point
          // We should discard this chunk and exit
          if (this.bytesRead < currPos) {
            return true;
          }
          // At this point, bytes read is greater than our starting position
          // If the current position is still the starting position, that means
          // this is the first chunk where we care about the bytes read
          // and we need to subtract the bytes read from the start position (n) and slice the last n bytes
          if (currPos === this.start) {
            var n = this.bytesRead - currPos;
            chunk = chunk.slice(-n);
            var [_, ...rest] = arguments;
            this.pos = this.bytesRead;
            if (this.end !== undefined && this.bytesRead > this.end) {
              chunk = chunk.slice(0, this.end - this.start + 1);
            }
            return super.push(chunk, ...rest);
          }
          var end = this.end;
          // This is multi-chunk read case where we go passed the end of the what we want to read in the last chunk
          if (end !== undefined && this.bytesRead > end) {
            chunk = chunk.slice(0, end - currPos + 1);
            var [_, ...rest] = arguments;
            this.pos = this.bytesRead;
            return super.push(chunk, ...rest);
          }
          this.pos = this.bytesRead;
        }
      }

      return super.push(...arguments);
    }

    // #

    // n should be the the highwatermark passed from Readable.read when calling internal _read (_read is set to this private fn in this class)
    #internalRead(n) {
      // pos is the current position in the file
      // by default, if a start value is provided, pos starts at this.start
      var { pos, end, bytesRead, fd } = this;

      n =
        pos !== undefined // if there is a pos, then we are reading from that specific position in the file
          ? Math.min(end - pos + 1, n) // takes smaller of length of the rest of the file to read minus the cursor position, or the highwatermark
          : Math.min(end - bytesRead + 1, n); // takes the smaller of the length of the rest of the file from the bytes that we have marked read, or the highwatermark

      $debug("n @ fs.ReadStream.#internalRead, after clamp", n);

      // If n is 0 or less, then we read all the file, push null to stream, ending it
      if (n <= 0) {
        this.push(null);
        return;
      }

      // At this point, n is the lesser of the length of the rest of the file to read or the highwatermark
      // Which means n is the maximum number of bytes to read

      // Basically if we don't know the file size yet, then check it
      // Then if n is bigger than fileSize, set n to be fileSize
      // This is a fast path to avoid allocating more than the file size for a small file (is this respected by native stream though)
      if (this.#fileSize === -1 && bytesRead === 0 && pos === undefined) {
        var stat = fstatSync(fd);
        this.#fileSize = stat.size;
        if (this.#fileSize > 0 && n > this.#fileSize) {
          n = this.#fileSize + 1;
        }
        $debug("fileSize", this.#fileSize);
      }

      // At this point, we know the file size and how much we want to read of the file
      this[kIoDone] = false;
      var res = super._read(n);
      $debug("res -- undefined? why?", res);
      if ($isPromise(res)) {
        var then = res?.then;
        if (then && $isCallable(then)) {
          res.then(
            () => {
              this[kIoDone] = true;
              // Tell ._destroy() that it's safe to close the fd now.
              if (this.destroyed) {
                this.emit(kIoDone);
              }
            },
            er => {
              this[kIoDone] = true;
              this.#errorOrDestroy(er);
            },
          );
        }
      } else {
        this[kIoDone] = true;
        if (this.destroyed) {
          this.emit(kIoDone);
          this.#errorOrDestroy(new Error("ERR_STREAM_PREMATURE_CLOSE"));
        }
      }
    }

    #errorOrDestroy(err, sync = null) {
      var {
        _readableState: r = { destroyed: false, autoDestroy: false },
        _writableState: w = { destroyed: false, autoDestroy: false },
      } = this;

      if (w?.destroyed || r?.destroyed) {
        return this;
      }
      if (r?.autoDestroy || w?.autoDestroy) this.destroy(err);
      else if (err) {
        this.emit("error", err);
      }
    }

    pause() {
      this[readStreamPathFastPathSymbol] = false;
      return super.pause();
    }

    resume() {
      this[readStreamPathFastPathSymbol] = false;
      return super.resume();
    }

    unshift(...args) {
      this[readStreamPathFastPathSymbol] = false;
      return super.unshift(...args);
    }

    pipe(dest, pipeOpts) {
      if (this[readStreamPathFastPathSymbol] && (pipeOpts?.end ?? true) && this._readableState?.pipes?.length === 0) {
        if (writeStreamPathFastPathSymbol in dest && dest[writeStreamPathFastPathSymbol]) {
          if (dest[writeStreamPathFastPathCallSymbol](this, pipeOpts)) {
            return this;
          }
        }
      }

      this[readStreamPathFastPathSymbol] = false;
      return super.pipe(dest, pipeOpts);
    }
  },
);

function createReadStream(path, options) {
  return new ReadStream(path, options);
}

var defaultWriteStreamOptions = {
  fd: null,
  start: undefined,
  pos: undefined,
  encoding: undefined,
  flags: "w",
  mode: 0o666,
  fs: {
    write,
    close,
    open,
    openSync,
  },
};

var WriteStreamClass = (WriteStream = function WriteStream(path, options = defaultWriteStreamOptions) {
  if (!(this instanceof WriteStream)) {
    return new WriteStream(path, options);
  }

  if (!options) {
    throw new TypeError("Expected options to be an object");
  }

  var {
    fs = defaultWriteStreamOptions.fs,
    start = defaultWriteStreamOptions.start,
    flags = defaultWriteStreamOptions.flags,
    mode = defaultWriteStreamOptions.mode,
    autoClose = true,
    emitClose = false,
    autoDestroy = autoClose,
    encoding = defaultWriteStreamOptions.encoding,
    fd = defaultWriteStreamOptions.fd,
    pos = defaultWriteStreamOptions.pos,
  } = options;

  var tempThis = {};
  var handle = null;
  if (fd != null) {
    if (typeof fd !== "number") {
      if (fd instanceof FileHandle) {
        tempThis.fd = fd[kFd];
        if (tempThis.fd < 0) {
          throw new Error("Expected a valid file descriptor");
        }
        fd[kRef]();
        handle = fd;
      } else {
        throw new TypeError("Expected options.fd to be a number or FileHandle");
      }
    } else {
      tempThis.fd = fd;
    }
    tempThis[_writeStreamPathFastPathSymbol] = false;
  } else if (typeof path === "string") {
    if (path.length === 0) {
      throw new TypeError("Expected a non-empty path");
    }

    if (path.startsWith("file:")) {
      path = Bun.fileURLToPath(path);
    }

    tempThis.path = path;
    tempThis.fd = null;
    tempThis[_writeStreamPathFastPathSymbol] =
      autoClose &&
      (start === undefined || start === 0) &&
      fs.write === defaultWriteStreamOptions.fs.write &&
      fs.close === defaultWriteStreamOptions.fs.close;
  }

  if (tempThis.fd == null) {
    tempThis.fd = fs.openSync(path, flags, mode);
  }

  NativeWritable.$call(this, tempThis.fd, {
    ...options,
    decodeStrings: false,
    autoDestroy,
    emitClose,
    fd: tempThis,
  });
  Object.assign(this, tempThis);

  if (typeof fs?.write !== "function") {
    throw new TypeError("Expected fs.write to be a function");
  }

  if (typeof fs?.close !== "function") {
    throw new TypeError("Expected fs.close to be a function");
  }

  if (typeof fs?.open !== "function") {
    throw new TypeError("Expected fs.open to be a function");
  }

  if (typeof path === "object" && path) {
    if (path instanceof URL) {
      path = Bun.fileURLToPath(path);
    }
  }

  if (typeof path !== "string" && typeof fd !== "number") {
    throw new TypeError("Expected a path or file descriptor");
  }

  this.start = start;
  this[_fs] = fs;
  this[kHandle] = handle;
  this.flags = flags;
  this.mode = mode;
  this.bytesWritten = 0;
  this[writeStreamSymbol] = true;
  this[kIoDone] = false;
  // _write = undefined;
  // _writev = undefined;

  if (this.start !== undefined) {
    this.pos = this.start;
  }

  if (encoding !== defaultWriteStreamOptions.encoding) {
    this.setDefaultEncoding(encoding);
    if (encoding !== "buffer" && encoding !== "utf8" && encoding !== "utf-8" && encoding !== "binary") {
      this[_writeStreamPathFastPathSymbol] = false;
    }
  }

  return this;
});

const NativeWritable = Stream.NativeWritable;
const WriteStreamPrototype = (WriteStream.prototype = Object.create(NativeWritable.prototype));

Object.defineProperties(WriteStreamPrototype, {
  autoClose: {
    get() {
      return this._writableState.autoDestroy;
    },
    set(val) {
      this._writableState.autoDestroy = val;
    },
  },
  pending: {
    get() {
      return this.fd === null;
    },
  },
});

// TODO: what is this for?
WriteStreamPrototype.destroySoon = WriteStreamPrototype.end;

// noop, node has deprecated this
WriteStreamPrototype.open = function open() {};

WriteStreamPrototype[writeStreamPathFastPathCallSymbol] = function WriteStreamPathFastPathCallSymbol(
  readStream,
  pipeOpts,
) {
  if (!this[_writeStreamPathFastPathSymbol]) {
    return false;
  }

  if (this.fd !== null) {
    this[_writeStreamPathFastPathSymbol] = false;
    return false;
  }

  this[kIoDone] = false;
  readStream[kIoDone] = false;
  return Bun.write(this[_writeStreamPathFastPathSymbol], readStream[readStreamPathOrFdSymbol]).then(
    bytesWritten => {
      readStream[kIoDone] = this[kIoDone] = true;
      this.bytesWritten += bytesWritten;
      readStream.bytesRead += bytesWritten;
      this.end();
      readStream.close();
    },
    err => {
      readStream[kIoDone] = this[kIoDone] = true;
      WriteStream_errorOrDestroy.$call(this, err);
      readStream.emit("error", err);
    },
  );
};

WriteStreamPrototype.isBunFastPathEnabled = function isBunFastPathEnabled() {
  return this[_writeStreamPathFastPathSymbol];
};

WriteStreamPrototype.disableBunFastPath = function disableBunFastPath() {
  this[_writeStreamPathFastPathSymbol] = false;
};

function WriteStream_handleWrite(er, bytes) {
  if (er) {
    return WriteStream_errorOrDestroy.$call(this, er);
  }

  this.bytesWritten += bytes;
}

function WriteStream_internalClose(err, cb) {
  this[_writeStreamPathFastPathSymbol] = false;
  var handle = this[kHandle];
  if (handle) {
    handle[kUnref]();
    this.fd = null;
    this[kHandle] = null;
    NativeWritable.prototype._destroy.$apply(this, err, cb);
    return;
  }
  var fd = this.fd;
  this[_fs].close(fd, er => {
    this.fd = null;
    NativeWritable.prototype._destroy.$apply(this, er || err, cb);
  });
}

WriteStreamPrototype._construct = function _construct(callback) {
  if (typeof this.fd === "number") {
    callback();
    return;
  }

  callback();
  this.emit("open", this.fd);
  this.emit("ready");
};

WriteStreamPrototype._destroy = function _destroy(err, cb) {
  if (this.fd === null) {
    return NativeWritable.prototype._destroy.$apply(this, err, cb);
  }

  if (this[kIoDone]) {
    this.once(kIoDone, () => WriteStream_internalClose.$call(this, err, cb));
    return;
  }

  WriteStream_internalClose.$call(this, err, cb);
};

WriteStreamPrototype.close = function close(cb) {
  if (cb) {
    if (this.closed) {
      process.nextTick(cb);
      return;
    }
    this.on("close", cb);
  }

  // If we are not autoClosing, we should call
  // destroy on 'finish'.
  if (!this.autoClose) {
    this.on("finish", this.destroy);
  }

  // We use end() instead of destroy() because of
  // https://github.com/nodejs/node/issues/2006
  this.end();
};

WriteStreamPrototype.write = function write(chunk, encoding, cb) {
  encoding ??= this._writableState?.defaultEncoding;
  this[_writeStreamPathFastPathSymbol] = false;
  if (typeof chunk === "string") {
    chunk = Buffer.from(chunk, encoding);
  }

  // TODO: Replace this when something like lseek is available
  var native = this.pos === undefined;
  const callback = native
    ? (err, bytes) => {
        this[kIoDone] = false;
        WriteStream_handleWrite.$call(this, err, bytes);
        this.emit(kIoDone);
        if (cb) !err ? cb() : cb(err);
      }
    : () => {};
  this[kIoDone] = true;
  if (this._write) {
    return this._write(chunk, encoding, callback);
  } else {
    return NativeWritable.prototype.write.$call(this, chunk, encoding, callback, native);
  }
};

// Do not inherit
WriteStreamPrototype._write = undefined;
WriteStreamPrototype._writev = undefined;

WriteStreamPrototype.end = function end(chunk, encoding, cb) {
  var native = this.pos === undefined;
  return NativeWritable.prototype.end.$call(this, chunk, encoding, cb, native);
};

function WriteStream_errorOrDestroy(err) {
  var {
    _readableState: r = { destroyed: false, autoDestroy: false },
    _writableState: w = { destroyed: false, autoDestroy: false },
  } = this;

  if (w?.destroyed || r?.destroyed) {
    return this;
  }
  if (r?.autoDestroy || w?.autoDestroy) this.destroy(err);
  else if (err) {
    this.emit("error", err);
  }
}

function createWriteStream(path, options) {
  return new WriteStream(path, options);
}

Object.defineProperties(fs, {
  createReadStream: {
    value: createReadStream,
  },
  createWriteStream: {
    value: createWriteStream,
  },
  ReadStream: {
    value: ReadStream,
  },
  WriteStream: {
    value: WriteStream,
  },
});

// lol
realpath.native = realpath;
realpathSync.native = realpathSync;

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

export default {
  Dirent,
  FSWatcher,
  ReadStream,
  Stats,
  WriteStream,
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
  promises,
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
  fdatasync,
  fdatasyncSync,
  openAsBlob,
  opendir,
  [Symbol.for("::bunternal::")]: {
    ReadStreamClass,
    WriteStreamClass,
  },
  // get WriteStream() {
  //   return getLazyWriteStream();
  // },
  // get ReadStream() {
  //   return getLazyReadStream();
  // },
};
