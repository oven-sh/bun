(function (){"use strict";
let $debug_log_enabled = ((env) => (
  // The rationale for checking all these variables is just so you don't have to exactly remember which one you set.
  (env.BUN_DEBUG_ALL && env.BUN_DEBUG_ALL !== '0')
  || (env.BUN_DEBUG_JS && env.BUN_DEBUG_JS !== '0')
  || (env.BUN_DEBUG_NODE_FS)
  || (env.DEBUG_NODE_FS)
))(Bun.env);
let $debug_pid_prefix = Bun.env.SHOW_PID === '1';
let $debug_log = $debug_log_enabled ? (...args) => {
  // warn goes to stderr without colorizing
  console.warn(($debug_pid_prefix ? `[${process.pid}] ` : '') + (Bun.enableANSIColors ? '\x1b[90m[fs]\x1b[0m' : '[fs]'), ...args);
} : () => {};
// build2/tmp/node/fs.ts
var getValidatedPath = function(p) {
  if (p instanceof URL)
    return Bun.fileURLToPath(p);
  if (typeof p !== "string")
    @throwTypeError("Path must be a string or URL.");
  return (_pathModule ??= @getInternalField(@internalModuleRegistry, 30) || @createInternalModuleById(30)).resolve(p);
};
var watchFile = function(filename, options, listener) {
  filename = getValidatedPath(filename);
  if (typeof options === "function") {
    listener = options;
    options = {};
  }
  if (typeof listener !== "function") {
    @throwTypeError("listener must be a function");
  }
  var stat = statWatchers.get(filename);
  if (!stat) {
    stat = new StatWatcher(filename, options);
    statWatchers.set(filename, stat);
  }
  stat.addListener("change", listener);
  return stat;
};
var unwatchFile = function(filename, listener) {
  filename = getValidatedPath(filename);
  var stat = statWatchers.get(filename);
  if (!stat)
    return;
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
};
var callbackify = function(fsFunction, args) {
  const callback = args[args.length - 1];
  try {
    var result = fsFunction.@apply(fs, args.slice(0, args.length - 1));
    result.then((...args2) => callback(null, ...args2), (err) => callback(err));
  } catch (e) {
    if (typeof callback === "function") {
      callback(e);
    } else {
      throw e;
    }
  }
};
var createReadStream = function(path, options) {
  return new ReadStream(path, options);
};
var WriteStream_handleWrite = function(er, bytes) {
  if (er) {
    return WriteStream_errorOrDestroy.@call(this, er);
  }
  this.bytesWritten += bytes;
};
var WriteStream_internalClose = function(err, cb) {
  this[_writeStreamPathFastPathSymbol] = false;
  var fd = this.fd;
  this[_fs].close(fd, (er) => {
    this.fd = null;
    cb(err || er);
  });
};
var WriteStream_errorOrDestroy = function(err) {
  var {
    _readableState: r = { destroyed: false, autoDestroy: false },
    _writableState: w = { destroyed: false, autoDestroy: false }
  } = this;
  if (w?.destroyed || r?.destroyed) {
    return this;
  }
  if (r?.autoDestroy || w?.autoDestroy)
    this.destroy(err);
  else if (err) {
    this.emit("error", err);
  }
};
var createWriteStream = function(path, options) {
  return new WriteStream(path, options);
};
var cpSync = function(src, dest, options) {
  if (!options)
    return fs.cpSync(src, dest);
  if (typeof options !== "object") {
    @throwTypeError("options must be an object");
  }
  if (options.dereference || options.filter || options.preserveTimestamps || options.verbatimSymlinks) {
    if (!lazy_cpSync)
      lazy_cpSync = @getInternalField(@internalModuleRegistry, 3) || @createInternalModuleById(3);
    return lazy_cpSync(src, dest, options);
  }
  return fs.cpSync(src, dest, options.recursive, options.errorOnExist, options.force ?? true, options.mode);
};
var cp = function(src, dest, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = @undefined;
  }
  promises.cp(src, dest, options).then(() => callback(), callback);
};
var _toUnixTimestamp = function(time, name = "time") {
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
    return DatePrototypeGetTime(time) / 1000;
  }
  @throwTypeError(`Expected ${name} to be a number or Date`);
};
var $;
var ReadStream;
var WriteStream;
var EventEmitter = @getInternalField(@internalModuleRegistry, 20) || @createInternalModuleById(20);
var promises = @getInternalField(@internalModuleRegistry, 22) || @createInternalModuleById(22);
var Stream = @getInternalField(@internalModuleRegistry, 39) || @createInternalModuleById(39);
var { isArrayBufferView } = @requireNativeModule("util/types");
var _writeStreamPathFastPathSymbol = Symbol.for("Bun.NodeWriteStreamFastPath");
var _fs = Symbol.for("#fs");
var constants = @processBindingConstants.fs;
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
      listener = () => {
      };
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
    if (eventType === "error" || eventType === "close") {
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
  start() {
  }
}

class StatWatcher extends EventEmitter {
  constructor(path, options) {
    super();
    this._handle = fs.watchFile(path, options, this.#onChange.bind(this));
  }
  #onChange(curr, prev) {
    this.emit("change", curr, prev);
  }
  start() {
  }
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
var access = function access2(...args) {
  callbackify(fs.access, args);
};
var appendFile = function appendFile2(...args) {
  callbackify(fs.appendFile, args);
};
var close = function close2(...args) {
  callbackify(fs.close, args);
};
var rm = function rm2(...args) {
  callbackify(fs.rm, args);
};
var rmdir = function rmdir2(...args) {
  callbackify(fs.rmdir, args);
};
var copyFile = function copyFile2(...args) {
  const callback = args[args.length - 1];
  if (typeof callback !== "function") {
    const err = @makeTypeError("Callback must be a function");
    err.code = "ERR_INVALID_ARG_TYPE";
    throw err;
  }
  fs.copyFile(...args).then((result) => callback(null, result), callback);
};
var exists = function exists2(path, callback) {
  if (typeof callback !== "function") {
    const err = @makeTypeError("Callback must be a function");
    err.code = "ERR_INVALID_ARG_TYPE";
    throw err;
  }
  try {
    fs.exists.@apply(fs, [path]).then((existed) => callback(existed), (_) => callback(false));
  } catch (e) {
    callback(false);
  }
};
var chown = function chown2(...args) {
  callbackify(fs.chown, args);
};
var chmod = function chmod2(...args) {
  callbackify(fs.chmod, args);
};
var fchmod = function fchmod2(...args) {
  callbackify(fs.fchmod, args);
};
var fchown = function fchown2(...args) {
  callbackify(fs.fchown, args);
};
var fstat = function fstat2(...args) {
  callbackify(fs.fstat, args);
};
var fsync = function fsync2(...args) {
  callbackify(fs.fsync, args);
};
var ftruncate = function ftruncate2(...args) {
  callbackify(fs.ftruncate, args);
};
var futimes = function futimes2(...args) {
  callbackify(fs.futimes, args);
};
var lchmod = function lchmod2(...args) {
  callbackify(fs.lchmod, args);
};
var lchown = function lchown2(...args) {
  callbackify(fs.lchown, args);
};
var link = function link2(...args) {
  callbackify(fs.link, args);
};
var mkdir = function mkdir2(...args) {
  callbackify(fs.mkdir, args);
};
var mkdtemp = function mkdtemp2(...args) {
  callbackify(fs.mkdtemp, args);
};
var open = function open2(...args) {
  callbackify(fs.open, args);
};
var read = function read2(fd, buffer, offsetOrOptions, length, position, callback) {
  let offset = offsetOrOptions;
  let params = null;
  if (arguments.length <= 4) {
    if (arguments.length === 4) {
      callback = length;
      params = offsetOrOptions;
    } else if (arguments.length === 3) {
      if (!isArrayBufferView(buffer)) {
        params = buffer;
        ({ buffer = @Buffer.alloc(16384) } = params ?? {});
      }
      callback = offsetOrOptions;
    } else {
      callback = buffer;
      buffer = @Buffer.alloc(16384);
    }
    ({ offset = 0, length = buffer?.byteLength - offset, position = null } = params ?? {});
  }
  queueMicrotask(() => {
    try {
      var bytesRead = fs.readSync(fd, buffer, offset, length, position);
    } catch (e) {
      callback(e);
    }
    callback(null, bytesRead, buffer);
  });
};
var write = function write2(...args) {
  callbackify(fs.write, args);
};
var readdir = function readdir2(...args) {
  const callback = args[args.length - 1];
  if (typeof callback !== "function") {
    @throwTypeError("Callback must be a function");
  }
  fs.readdir(...args).then((result) => callback(null, result), callback);
};
var readFile = function readFile2(...args) {
  const callback = args[args.length - 1];
  if (typeof callback !== "function") {
    @throwTypeError("Callback must be a function");
  }
  fs.readFile(...args).then((result) => callback(null, result), callback);
};
var writeFile = function writeFile2(...args) {
  callbackify(fs.writeFile, args);
};
var readlink = function readlink2(...args) {
  callbackify(fs.readlink, args);
};
var realpath = function realpath2(...args) {
  const callback = args[args.length - 1];
  if (typeof callback !== "function") {
    @throwTypeError("Callback must be a function");
  }
  fs.realpath(...args).then((result) => callback(null, result), callback);
};
var rename = function rename2(...args) {
  callbackify(fs.rename, args);
};
var lstat = function lstat2(...args) {
  const callback = args[args.length - 1];
  if (typeof callback !== "function") {
    @throwTypeError("Callback must be a function");
  }
  fs.lstat(...args).then((result) => callback(null, result), callback);
};
var stat = function stat2(...args) {
  const callback = args[args.length - 1];
  if (typeof callback !== "function") {
    @throwTypeError("Callback must be a function");
  }
  fs.stat(...args).then((result) => callback(null, result), callback);
};
var symlink = function symlink2(...args) {
  callbackify(fs.symlink, args);
};
var truncate = function truncate2(...args) {
  callbackify(fs.truncate, args);
};
var unlink = function unlink2(...args) {
  callbackify(fs.unlink, args);
};
var utimes = function utimes2(...args) {
  callbackify(fs.utimes, args);
};
var lutimes = function lutimes2(...args) {
  callbackify(fs.lutimes, args);
};
var accessSync = fs.accessSync.bind(fs);
var appendFileSync = fs.appendFileSync.bind(fs);
var closeSync = fs.closeSync.bind(fs);
var copyFileSync = fs.copyFileSync.bind(fs);
var existsSync = fs.existsSync.bind(fs);
var chownSync = fs.chownSync.bind(fs);
var chmodSync = fs.chmodSync.bind(fs);
var fchmodSync = fs.fchmodSync.bind(fs);
var fchownSync = fs.fchownSync.bind(fs);
var fstatSync = fs.fstatSync.bind(fs);
var fsyncSync = fs.fsyncSync.bind(fs);
var ftruncateSync = fs.ftruncateSync.bind(fs);
var futimesSync = fs.futimesSync.bind(fs);
var lchmodSync = fs.lchmodSync.bind(fs);
var lchownSync = fs.lchownSync.bind(fs);
var linkSync = fs.linkSync.bind(fs);
var lstatSync = fs.lstatSync.bind(fs);
var mkdirSync = fs.mkdirSync.bind(fs);
var mkdtempSync = fs.mkdtempSync.bind(fs);
var openSync = fs.openSync.bind(fs);
var readSync = fs.readSync.bind(fs);
var writeSync = fs.writeSync.bind(fs);
var readdirSync = fs.readdirSync.bind(fs);
var readFileSync = fs.readFileSync.bind(fs);
var writeFileSync = fs.writeFileSync.bind(fs);
var readlinkSync = fs.readlinkSync.bind(fs);
var realpathSync = fs.realpathSync.bind(fs);
var renameSync = fs.renameSync.bind(fs);
var statSync = fs.statSync.bind(fs);
var symlinkSync = fs.symlinkSync.bind(fs);
var truncateSync = fs.truncateSync.bind(fs);
var unlinkSync = fs.unlinkSync.bind(fs);
var utimesSync = fs.utimesSync.bind(fs);
var lutimesSync = fs.lutimesSync.bind(fs);
var rmSync = fs.rmSync.bind(fs);
var rmdirSync = fs.rmdirSync.bind(fs);
var writev = (fd, buffers, position, callback) => {
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
};
var writevSync = fs.writevSync.bind(fs);
var readv = (fd, buffers, position, callback) => {
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
};
var readvSync = fs.readvSync.bind(fs);
var Dirent = fs.Dirent;
var Stats = fs.Stats;
var watch = function watch2(path, options, listener) {
  return new FSWatcher(path, options, listener);
};
var statWatchers = new Map;
var _pathModule;
var readStreamPathFastPathSymbol = Symbol.for("Bun.Node.readStreamPathFastPath");
var readStreamSymbol = Symbol.for("Bun.NodeReadStream");
var readStreamPathOrFdSymbol = Symbol.for("Bun.NodeReadStreamPathOrFd");
var writeStreamSymbol = Symbol.for("Bun.NodeWriteStream");
var writeStreamPathFastPathSymbol = Symbol.for("Bun.NodeWriteStreamFastPath");
var writeStreamPathFastPathCallSymbol = Symbol.for("Bun.NodeWriteStreamFastPathCall");
var kIoDone = Symbol.for("kIoDone");
var defaultReadStreamOptions = {
  file: @undefined,
  fd: null,
  flags: "r",
  encoding: @undefined,
  mode: 438,
  autoClose: true,
  emitClose: true,
  start: 0,
  end: @Infinity,
  highWaterMark: 65536,
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
    close
  },
  autoDestroy: true
};
var ReadStreamClass;
ReadStream = function(InternalReadStream) {
  ReadStreamClass = InternalReadStream;
  Object.defineProperty(ReadStreamClass.prototype, Symbol.toStringTag, {
    value: "ReadStream",
    enumerable: false
  });
  function ReadStream3(path, options) {
    return new InternalReadStream(path, options);
  }
  ReadStream3.prototype = InternalReadStream.prototype;
  return Object.defineProperty(ReadStream3, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalReadStream;
    }
  });
}(class ReadStream2 extends Stream._getNativeReadableStreamPrototype(2, Stream.Readable) {
  constructor(pathOrFd, options = defaultReadStreamOptions) {
    if (typeof options !== "object" || !options) {
      @throwTypeError("Expected options to be an object");
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
      fs: fs2 = defaultReadStreamOptions.fs,
      highWaterMark = defaultReadStreamOptions.highWaterMark,
      fd = defaultReadStreamOptions.fd
    } = options;
    if (pathOrFd?.constructor?.name === "URL") {
      pathOrFd = Bun.fileURLToPath(pathOrFd);
    }
    var tempThis = {};
    if (fd != null) {
      if (typeof fd !== "number") {
        @throwTypeError("Expected options.fd to be a number");
      }
      tempThis.fd = tempThis[readStreamPathOrFdSymbol] = fd;
      tempThis.autoClose = false;
    } else if (typeof pathOrFd === "string") {
      if (pathOrFd.startsWith("file://")) {
        pathOrFd = Bun.fileURLToPath(pathOrFd);
      }
      if (pathOrFd.length === 0) {
        @throwTypeError("Expected path to be a non-empty string");
      }
      tempThis.path = tempThis.file = tempThis[readStreamPathOrFdSymbol] = pathOrFd;
    } else if (typeof pathOrFd === "number") {
      pathOrFd |= 0;
      if (pathOrFd < 0) {
        @throwTypeError("Expected fd to be a positive integer");
      }
      tempThis.fd = tempThis[readStreamPathOrFdSymbol] = pathOrFd;
      tempThis.autoClose = false;
    } else {
      @throwTypeError("Expected a path or file descriptor");
    }
    if (tempThis.fd === @undefined) {
      tempThis.fd = fs2.openSync(pathOrFd, flags, mode);
    }
    var fileRef = Bun.file(tempThis.fd);
    var stream = fileRef.stream();
    var native = @direct(stream);
    if (!native) {
      $debug_log("no native readable stream");
      throw new Error("no native readable stream");
    }
    var { stream: ptr } = native;
    super(ptr, {
      ...options,
      encoding,
      autoDestroy,
      autoClose,
      emitClose,
      highWaterMark
    });
    Object.assign(this, tempThis);
    this.#fileRef = fileRef;
    this.end = end;
    this._read = this.#internalRead;
    this.start = start;
    this.flags = flags;
    this.mode = mode;
    this.emitClose = emitClose;
    this[readStreamPathFastPathSymbol] = start === 0 && end === @Infinity && autoClose && fs2 === defaultReadStreamOptions.fs && (encoding === "buffer" || encoding === "binary" || encoding == null || encoding === "utf-8" || encoding === "utf8");
    this._readableState.autoClose = autoDestroy = autoClose;
    this._readableState.highWaterMark = highWaterMark;
    if (start !== @undefined) {
      this.pos = start;
    }
  }
  #fileRef;
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
    super._destroy(err, cb);
    try {
      var fd = this.fd;
      this[readStreamPathFastPathSymbol] = false;
      if (!fd) {
        cb(err);
      } else {
        this.#fs.close(fd, (er) => {
          cb(er || err);
        });
        this.fd = null;
      }
    } catch (e) {
      throw e;
    }
  }
  close(cb) {
    if (typeof cb === "function")
      Stream.eos(this, cb);
    this.destroy();
  }
  push(chunk) {
    var bytesRead = chunk?.length ?? 0;
    if (bytesRead > 0) {
      this.bytesRead += bytesRead;
      var currPos = this.pos;
      if (currPos !== @undefined) {
        if (this.bytesRead < currPos) {
          return true;
        }
        if (currPos === this.start) {
          var n = this.bytesRead - currPos;
          chunk = chunk.slice(-n);
          var [_, ...rest] = arguments;
          this.pos = this.bytesRead;
          if (this.end !== @undefined && this.bytesRead > this.end) {
            chunk = chunk.slice(0, this.end - this.start + 1);
          }
          return super.push(chunk, ...rest);
        }
        var end = this.end;
        if (end !== @undefined && this.bytesRead > end) {
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
  #internalRead(n) {
    var { pos, end, bytesRead, fd, encoding } = this;
    n = pos !== @undefined ? Math.min(end - pos + 1, n) : Math.min(end - bytesRead + 1, n);
    $debug_log("n @ fs.ReadStream.#internalRead, after clamp", n);
    if (n <= 0) {
      this.push(null);
      return;
    }
    if (this.#fileSize === -1 && bytesRead === 0 && pos === @undefined) {
      var stat3 = fstatSync(fd);
      this.#fileSize = stat3.size;
      if (this.#fileSize > 0 && n > this.#fileSize) {
        n = this.#fileSize + 1;
      }
      $debug_log("fileSize", this.#fileSize);
    }
    this[kIoDone] = false;
    var res = super._read(n);
    $debug_log("res -- undefined? why?", res);
    if (@isPromise(res)) {
      var then = res?.then;
      if (then && @isCallable(then)) {
        res.then(() => {
          this[kIoDone] = true;
          if (this.destroyed) {
            this.emit(kIoDone);
          }
        }, (er) => {
          this[kIoDone] = true;
          this.#errorOrDestroy(er);
        });
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
      _writableState: w = { destroyed: false, autoDestroy: false }
    } = this;
    if (w?.destroyed || r?.destroyed) {
      return this;
    }
    if (r?.autoDestroy || w?.autoDestroy)
      this.destroy(err);
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
      if ((writeStreamPathFastPathSymbol in dest) && dest[writeStreamPathFastPathSymbol]) {
        if (dest[writeStreamPathFastPathCallSymbol](this, pipeOpts)) {
          return this;
        }
      }
    }
    this[readStreamPathFastPathSymbol] = false;
    return super.pipe(dest, pipeOpts);
  }
});
var defaultWriteStreamOptions = {
  fd: null,
  start: @undefined,
  pos: @undefined,
  encoding: @undefined,
  flags: "w",
  mode: 438,
  fs: {
    write,
    close,
    open,
    openSync
  }
};
var WriteStreamClass = WriteStream = function WriteStream2(path, options = defaultWriteStreamOptions) {
  if (!(this instanceof WriteStream2)) {
    return new WriteStream2(path, options);
  }
  if (!options) {
    @throwTypeError("Expected options to be an object");
  }
  var {
    fs: fs2 = defaultWriteStreamOptions.fs,
    start = defaultWriteStreamOptions.start,
    flags = defaultWriteStreamOptions.flags,
    mode = defaultWriteStreamOptions.mode,
    autoClose = true,
    emitClose = false,
    autoDestroy = autoClose,
    encoding = defaultWriteStreamOptions.encoding,
    fd = defaultWriteStreamOptions.fd,
    pos = defaultWriteStreamOptions.pos
  } = options;
  var tempThis = {};
  if (fd != null) {
    if (typeof fd !== "number") {
      throw new Error("Expected options.fd to be a number");
    }
    tempThis.fd = fd;
    tempThis[_writeStreamPathFastPathSymbol] = false;
  } else if (typeof path === "string") {
    if (path.length === 0) {
      @throwTypeError("Expected a non-empty path");
    }
    if (path.startsWith("file:")) {
      path = Bun.fileURLToPath(path);
    }
    tempThis.path = path;
    tempThis.fd = null;
    tempThis[_writeStreamPathFastPathSymbol] = autoClose && (start === @undefined || start === 0) && fs2.write === defaultWriteStreamOptions.fs.write && fs2.close === defaultWriteStreamOptions.fs.close;
  }
  if (tempThis.fd == null) {
    tempThis.fd = fs2.openSync(path, flags, mode);
  }
  NativeWritable.@call(this, tempThis.fd, {
    ...options,
    decodeStrings: false,
    autoDestroy,
    emitClose,
    fd: tempThis
  });
  Object.assign(this, tempThis);
  if (typeof fs2?.write !== "function") {
    @throwTypeError("Expected fs.write to be a function");
  }
  if (typeof fs2?.close !== "function") {
    @throwTypeError("Expected fs.close to be a function");
  }
  if (typeof fs2?.open !== "function") {
    @throwTypeError("Expected fs.open to be a function");
  }
  if (typeof path === "object" && path) {
    if (path instanceof URL) {
      path = Bun.fileURLToPath(path);
    }
  }
  if (typeof path !== "string" && typeof fd !== "number") {
    @throwTypeError("Expected a path or file descriptor");
  }
  this.start = start;
  this[_fs] = fs2;
  this.flags = flags;
  this.mode = mode;
  this.bytesWritten = 0;
  this[writeStreamSymbol] = true;
  this[kIoDone] = false;
  if (this.start !== @undefined) {
    this.pos = this.start;
  }
  if (encoding !== defaultWriteStreamOptions.encoding) {
    this.setDefaultEncoding(encoding);
    if (encoding !== "buffer" && encoding !== "utf8" && encoding !== "utf-8" && encoding !== "binary") {
      this[_writeStreamPathFastPathSymbol] = false;
    }
  }
  return this;
};
var NativeWritable = Stream.NativeWritable;
var WriteStreamPrototype = WriteStream.prototype = Object.create(NativeWritable.prototype);
Object.defineProperties(WriteStreamPrototype, {
  autoClose: {
    get() {
      return this._writableState.autoDestroy;
    },
    set(val) {
      this._writableState.autoDestroy = val;
    }
  },
  pending: {
    get() {
      return this.fd === null;
    }
  }
});
WriteStreamPrototype.destroySoon = WriteStreamPrototype.end;
WriteStreamPrototype.open = function open3() {
};
WriteStreamPrototype[writeStreamPathFastPathCallSymbol] = function WriteStreamPathFastPathCallSymbol(readStream, pipeOpts) {
  if (!this[_writeStreamPathFastPathSymbol]) {
    return false;
  }
  if (this.fd !== null) {
    this[_writeStreamPathFastPathSymbol] = false;
    return false;
  }
  this[kIoDone] = false;
  readStream[kIoDone] = false;
  return Bun.write(this[_writeStreamPathFastPathSymbol], readStream[readStreamPathOrFdSymbol]).then((bytesWritten) => {
    readStream[kIoDone] = this[kIoDone] = true;
    this.bytesWritten += bytesWritten;
    readStream.bytesRead += bytesWritten;
    this.end();
    readStream.close();
  }, (err) => {
    readStream[kIoDone] = this[kIoDone] = true;
    WriteStream_errorOrDestroy.@call(this, err);
    readStream.emit("error", err);
  });
};
WriteStreamPrototype.isBunFastPathEnabled = function isBunFastPathEnabled() {
  return this[_writeStreamPathFastPathSymbol];
};
WriteStreamPrototype.disableBunFastPath = function disableBunFastPath() {
  this[_writeStreamPathFastPathSymbol] = false;
};
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
    return cb(err);
  }
  if (this[kIoDone]) {
    this.once(kIoDone, () => WriteStream_internalClose.@call(this, err, cb));
    return;
  }
  WriteStream_internalClose.@call(this, err, cb);
};
WriteStreamPrototype.close = function close3(cb) {
  if (cb) {
    if (this.closed) {
      process.nextTick(cb);
      return;
    }
    this.on("close", cb);
  }
  if (!this.autoClose) {
    this.on("finish", this.destroy);
  }
  this.end();
};
WriteStreamPrototype.write = function write3(chunk, encoding, cb) {
  encoding ??= this._writableState?.defaultEncoding;
  this[_writeStreamPathFastPathSymbol] = false;
  if (typeof chunk === "string") {
    chunk = @Buffer.from(chunk, encoding);
  }
  var native = this.pos === @undefined;
  const callback = native ? (err, bytes) => {
    this[kIoDone] = false;
    WriteStream_handleWrite.@call(this, err, bytes);
    this.emit(kIoDone);
    if (cb)
      !err ? cb() : cb(err);
  } : () => {
  };
  this[kIoDone] = true;
  if (this._write) {
    return this._write(chunk, encoding, callback);
  } else {
    return NativeWritable.prototype.write.@call(this, chunk, encoding, callback, native);
  }
};
WriteStreamPrototype._write = @undefined;
WriteStreamPrototype._writev = @undefined;
WriteStreamPrototype.end = function end(chunk, encoding, cb) {
  var native = this.pos === @undefined;
  return NativeWritable.prototype.end.@call(this, chunk, encoding, cb, native);
};
WriteStreamPrototype._destroy = function _destroy2(err, cb) {
  this.close(err, cb);
};
Object.defineProperties(fs, {
  createReadStream: {
    value: createReadStream
  },
  createWriteStream: {
    value: createWriteStream
  },
  ReadStream: {
    value: ReadStream
  },
  WriteStream: {
    value: WriteStream
  }
});
realpath.native = realpath;
realpathSync.native = realpathSync;
var lazy_cpSync = null;
$ = {
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
  [Symbol.for("::bunternal::")]: {
    ReadStreamClass,
    WriteStreamClass
  }
};
return $})
