// src/js/node/fs.js
var callbackify = function(fsFunction, args) {
  try {
    const result = fsFunction.apply(fs, args.slice(0, args.length - 1));
    const callback = args[args.length - 1];
    if (typeof callback === "function") {
      queueMicrotask(() => callback(null, result));
    }
  } catch (e) {
    const callback = args[args.length - 1];
    if (typeof callback === "function") {
      queueMicrotask(() => callback(e));
    }
  }
};
function createReadStream(path, options) {
  return new ReadStream(path, options);
}
function createWriteStream(path, options) {
  return new WriteStream(path, options);
}
var { direct, isPromise, isCallable } = import.meta.primordials;
var promises = import.meta.require("node:fs/promises");
var { Readable, NativeWritable, _getNativeReadableStreamPrototype, eos: eos_ } = import.meta.require("node:stream");
var NativeReadable = _getNativeReadableStreamPrototype(2, Readable);
var fs = Bun.fs();
var debug = process.env.DEBUG ? console.log : () => {
};
var access = function access2(...args) {
  callbackify(fs.accessSync, args);
};
var appendFile = function appendFile2(...args) {
  callbackify(fs.appendFileSync, args);
};
var close = function close2(...args) {
  callbackify(fs.closeSync, args);
};
var rm = function rm2(...args) {
  callbackify(fs.rmSync, args);
};
var rmdir = function rmdir2(...args) {
  callbackify(fs.rmdirSync, args);
};
var copyFile = function copyFile2(...args) {
  callbackify(fs.copyFileSync, args);
};
var exists = function exists2(...args) {
  callbackify(fs.existsSync, args);
};
var chown = function chown2(...args) {
  callbackify(fs.chownSync, args);
};
var chmod = function chmod2(...args) {
  callbackify(fs.chmodSync, args);
};
var fchmod = function fchmod2(...args) {
  callbackify(fs.fchmodSync, args);
};
var fchown = function fchown2(...args) {
  callbackify(fs.fchownSync, args);
};
var fstat = function fstat2(...args) {
  callbackify(fs.fstatSync, args);
};
var fsync = function fsync2(...args) {
  callbackify(fs.fsyncSync, args);
};
var ftruncate = function ftruncate2(...args) {
  callbackify(fs.ftruncateSync, args);
};
var futimes = function futimes2(...args) {
  callbackify(fs.futimesSync, args);
};
var lchmod = function lchmod2(...args) {
  callbackify(fs.lchmodSync, args);
};
var lchown = function lchown2(...args) {
  callbackify(fs.lchownSync, args);
};
var link = function link2(...args) {
  callbackify(fs.linkSync, args);
};
var lstat = function lstat2(...args) {
  callbackify(fs.lstatSync, args);
};
var mkdir = function mkdir2(...args) {
  callbackify(fs.mkdirSync, args);
};
var mkdtemp = function mkdtemp2(...args) {
  callbackify(fs.mkdtempSync, args);
};
var open = function open2(...args) {
  callbackify(fs.openSync, args);
};
var read = function read2(...args) {
  callbackify(fs.readSync, args);
};
var write = function write2(...args) {
  callbackify(fs.writeSync, args);
};
var readdir = function readdir2(...args) {
  callbackify(fs.readdirSync, args);
};
var readFile = function readFile2(...args) {
  callbackify(fs.readFileSync, args);
};
var writeFile = function writeFile2(...args) {
  callbackify(fs.writeFileSync, args);
};
var readlink = function readlink2(...args) {
  callbackify(fs.readlinkSync, args);
};
var realpath = function realpath2(...args) {
  callbackify(fs.realpathSync, args);
};
var rename = function rename2(...args) {
  callbackify(fs.renameSync, args);
};
var stat = function stat2(...args) {
  callbackify(fs.statSync, args);
};
var symlink = function symlink2(...args) {
  callbackify(fs.symlinkSync, args);
};
var truncate = function truncate2(...args) {
  callbackify(fs.truncateSync, args);
};
var unlink = function unlink2(...args) {
  callbackify(fs.unlinkSync, args);
};
var utimes = function utimes2(...args) {
  callbackify(fs.utimesSync, args);
};
var lutimes = function lutimes2(...args) {
  callbackify(fs.lutimesSync, args);
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
var Dirent = fs.Dirent;
var Stats = fs.Stats;
var promises = import.meta.require("node:fs/promises");
var readStreamPathFastPathSymbol = Symbol.for("Bun.Node.readStreamPathFastPath");
var readStreamSymbol = Symbol.for("Bun.NodeReadStream");
var readStreamPathOrFdSymbol = Symbol.for("Bun.NodeReadStreamPathOrFd");
var writeStreamSymbol = Symbol.for("Bun.NodeWriteStream");
var writeStreamPathFastPathSymbol = Symbol.for("Bun.NodeWriteStreamFastPath");
var writeStreamPathFastPathCallSymbol = Symbol.for("Bun.NodeWriteStreamFastPathCall");
var kIoDone = Symbol.for("kIoDone");
var defaultReadStreamOptions = {
  file: undefined,
  fd: undefined,
  flags: "r",
  encoding: undefined,
  mode: 438,
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
    close
  },
  autoDestroy: true
};
var ReadStreamClass;
var ReadStream = function(InternalReadStream) {
  ReadStreamClass = InternalReadStream;
  Object.defineProperty(ReadStreamClass.prototype, Symbol.toStringTag, {
    value: "ReadStream",
    enumerable: false
  });
  return Object.defineProperty(function ReadStream(path, options) {
    return new InternalReadStream(path, options);
  }, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalReadStream;
    }
  });
}(class ReadStream2 extends NativeReadable {
  constructor(pathOrFd, options = defaultReadStreamOptions) {
    if (typeof options !== "object" || !options) {
      throw new TypeError("Expected options to be an object");
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
      highWaterMark = defaultReadStreamOptions.highWaterMark
    } = options;
    if (pathOrFd?.constructor?.name === "URL") {
      pathOrFd = Bun.fileURLToPath(pathOrFd);
    }
    var tempThis = {};
    if (typeof pathOrFd === "string") {
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
    if (!tempThis.fd) {
      tempThis.fd = fs2.openSync(pathOrFd, flags, mode);
    }
    var fileRef = Bun.file(tempThis.fd);
    var stream = fileRef.stream();
    var native = direct(stream);
    if (!native) {
      debug("no native readable stream");
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
    this[readStreamPathFastPathSymbol] = start === 0 && end === Infinity && autoClose && fs2 === defaultReadStreamOptions.fs && (encoding === "buffer" || encoding === "binary" || encoding == null || encoding === "utf-8" || encoding === "utf8");
    this._readableState.autoClose = autoDestroy = autoClose;
    this._readableState.highWaterMark = highWaterMark;
    if (start !== undefined) {
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
      eos_()(this, cb);
    this.destroy();
  }
  push(chunk) {
    var bytesRead = chunk?.length ?? 0;
    if (bytesRead > 0) {
      this.bytesRead += bytesRead;
      var currPos = this.pos;
      if (currPos !== undefined) {
        if (this.bytesRead < currPos) {
          return true;
        }
        if (currPos === this.start) {
          var n = this.bytesRead - currPos;
          chunk = chunk.slice(-n);
          var [_, ...rest] = arguments;
          this.pos = this.bytesRead;
          if (this.end && this.bytesRead >= this.end) {
            chunk = chunk.slice(0, this.end - this.start);
          }
          return super.push(chunk, ...rest);
        }
        var end = this.end;
        if (end && this.bytesRead >= end) {
          chunk = chunk.slice(0, end - currPos);
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
    n = pos !== undefined ? Math.min(end - pos + 1, n) : Math.min(end - bytesRead + 1, n);
    debug("n @ fs.ReadStream.#internalRead, after clamp", n);
    if (n <= 0) {
      this.push(null);
      return;
    }
    if (this.#fileSize === -1 && bytesRead === 0 && pos === undefined) {
      var stat3 = fstatSync(fd);
      this.#fileSize = stat3.size;
      if (this.#fileSize > 0 && n > this.#fileSize) {
        n = this.#fileSize + 1;
      }
      debug("fileSize", this.#fileSize);
    }
    this[kIoDone] = false;
    var res = super._read(n);
    debug("res -- undefined? why?", res);
    if (isPromise(res)) {
      var then = res?.then;
      if (then && isCallable(then)) {
        then(() => {
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
  start: undefined,
  pos: undefined,
  encoding: undefined,
  flags: "w",
  mode: 438,
  fs: {
    write,
    close,
    open,
    openSync
  }
};
var WriteStreamClass;
var WriteStream = function(InternalWriteStream) {
  WriteStreamClass = InternalWriteStream;
  Object.defineProperty(WriteStreamClass.prototype, Symbol.toStringTag, {
    value: "WritesStream",
    enumerable: false
  });
  return Object.defineProperty(function WriteStream(options) {
    return new InternalWriteStream(options);
  }, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalWriteStream;
    }
  });
}(class WriteStream2 extends NativeWritable {
  constructor(path, options = defaultWriteStreamOptions) {
    if (!options) {
      throw new TypeError("Expected options to be an object");
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
    if (typeof path === "string") {
      if (path.length === 0) {
        throw new TypeError("Expected a non-empty path");
      }
      if (path.startsWith("file:")) {
        path = Bun.fileURLToPath(path);
      }
      tempThis.path = path;
      tempThis.fd = null;
      tempThis[writeStreamPathFastPathSymbol] = autoClose && (start === undefined || start === 0) && fs2.write === defaultWriteStreamOptions.fs.write && fs2.close === defaultWriteStreamOptions.fs.close;
    } else {
      tempThis.fd = fd;
      tempThis[writeStreamPathFastPathSymbol] = false;
    }
    if (!tempThis.fd) {
      tempThis.fd = fs2.openSync(path, flags, mode);
    }
    super(tempThis.fd, {
      ...options,
      decodeStrings: false,
      autoDestroy,
      emitClose,
      fd: tempThis
    });
    Object.assign(this, tempThis);
    if (typeof fs2?.write !== "function") {
      throw new TypeError("Expected fs.write to be a function");
    }
    if (typeof fs2?.close !== "function") {
      throw new TypeError("Expected fs.close to be a function");
    }
    if (typeof fs2?.open !== "function") {
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
    this.#fs = fs2;
    this.flags = flags;
    this.mode = mode;
    if (this.start !== undefined) {
      this.pos = this.start;
    }
    if (encoding !== defaultWriteStreamOptions.encoding) {
      this.setDefaultEncoding(encoding);
      if (encoding !== "buffer" && encoding !== "utf8" && encoding !== "utf-8" && encoding !== "binary") {
        this[writeStreamPathFastPathSymbol] = false;
      }
    }
  }
  get autoClose() {
    return this._writableState.autoDestroy;
  }
  set autoClose(val) {
    this._writableState.autoDestroy = val;
  }
  destroySoon = this.end;
  open() {
  }
  path;
  fd;
  flags;
  mode;
  #fs;
  bytesWritten = 0;
  pos;
  [writeStreamPathFastPathSymbol];
  [writeStreamSymbol] = true;
  start;
  [writeStreamPathFastPathCallSymbol](readStream, pipeOpts) {
    if (!this[writeStreamPathFastPathSymbol]) {
      return false;
    }
    if (this.fd !== null) {
      this[writeStreamPathFastPathSymbol] = false;
      return false;
    }
    this[kIoDone] = false;
    readStream[kIoDone] = false;
    return Bun.write(this[writeStreamPathFastPathSymbol], readStream[readStreamPathOrFdSymbol]).then((bytesWritten) => {
      readStream[kIoDone] = this[kIoDone] = true;
      this.bytesWritten += bytesWritten;
      readStream.bytesRead += bytesWritten;
      this.end();
      readStream.close();
    }, (err) => {
      readStream[kIoDone] = this[kIoDone] = true;
      this.#errorOrDestroy(err);
      readStream.emit("error", err);
    });
  }
  isBunFastPathEnabled() {
    return this[writeStreamPathFastPathSymbol];
  }
  disableBunFastPath() {
    this[writeStreamPathFastPathSymbol] = false;
  }
  #handleWrite(er, bytes) {
    if (er) {
      return this.#errorOrDestroy(er);
    }
    this.bytesWritten += bytes;
  }
  #internalClose(err, cb) {
    this[writeStreamPathFastPathSymbol] = false;
    var fd = this.fd;
    this.#fs.close(fd, (er) => {
      this.fd = null;
      cb(err || er);
    });
  }
  _construct(callback) {
    if (typeof this.fd === "number") {
      callback();
      return;
    }
    callback();
    this.emit("open", this.fd);
    this.emit("ready");
  }
  _destroy(err, cb) {
    if (this.fd === null) {
      return cb(err);
    }
    if (this[kIoDone]) {
      this.once(kIoDone, () => this.#internalClose(err, cb));
      return;
    }
    this.#internalClose(err, cb);
  }
  [kIoDone] = false;
  close(cb) {
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
  }
  write(chunk, encoding = this._writableState.defaultEncoding, cb) {
    this[writeStreamPathFastPathSymbol] = false;
    if (typeof chunk === "string") {
      chunk = Buffer.from(chunk, encoding);
    }
    var native = this.pos === undefined;
    this[kIoDone] = true;
    return super.write(chunk, encoding, native ? (err, bytes) => {
      this[kIoDone] = false;
      this.#handleWrite(err, bytes);
      this.emit(kIoDone);
      if (cb)
        !err ? cb() : cb(err);
    } : () => {
    }, native);
  }
  #internalWriteSlow(chunk, encoding, cb) {
    this.#fs.write(this.fd, chunk, 0, chunk.length, this.pos, (err, bytes) => {
      this[kIoDone] = false;
      this.#handleWrite(err, bytes);
      this.emit(kIoDone);
      !err ? cb() : cb(err);
    });
  }
  end(chunk, encoding, cb) {
    var native = this.pos === undefined;
    return super.end(chunk, encoding, cb, native);
  }
  _write = this.#internalWriteSlow;
  _writev = undefined;
  get pending() {
    return this.fd === null;
  }
  _destroy(err, cb) {
    this.close(err, cb);
  }
  #errorOrDestroy(err) {
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
});
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
var fs_default = {
  [Symbol.for("CommonJS")]: 0,
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
  constants: promises.constants,
  copyFile,
  copyFileSync,
  createReadStream,
  createWriteStream,
  Dirent,
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
  Stats,
  symlink,
  symlinkSync,
  truncate,
  truncateSync,
  unlink,
  unlinkSync,
  utimes,
  utimesSync,
  write,
  writeFile,
  writeFileSync,
  writeSync,
  WriteStream,
  ReadStream,
  [Symbol.for("::bunternal::")]: {
    ReadStreamClass,
    WriteStreamClass
  }
};
export {
  writeSync,
  writeFileSync,
  writeFile,
  write,
  utimesSync,
  utimes,
  unlinkSync,
  unlink,
  truncateSync,
  truncate,
  symlinkSync,
  symlink,
  statSync,
  stat,
  rmdirSync,
  rmdir,
  rmSync,
  rm,
  renameSync,
  rename,
  realpathSync,
  realpath,
  readlinkSync,
  readlink,
  readdirSync,
  readdir,
  readSync,
  readFileSync,
  readFile,
  read,
  promises,
  openSync,
  open,
  mkdtempSync,
  mkdtemp,
  mkdirSync,
  mkdir,
  lutimesSync,
  lutimes,
  lstatSync,
  lstat,
  linkSync,
  link,
  lchownSync,
  lchown,
  lchmodSync,
  lchmod,
  futimesSync,
  futimes,
  ftruncateSync,
  ftruncate,
  fsyncSync,
  fsync,
  fstatSync,
  fstat,
  fchownSync,
  fchown,
  fchmodSync,
  fchmod,
  existsSync,
  exists,
  fs_default as default,
  createWriteStream,
  createReadStream,
  copyFileSync,
  copyFile,
  closeSync,
  close,
  chownSync,
  chown,
  chmodSync,
  chmod,
  appendFileSync,
  appendFile,
  accessSync,
  access,
  WriteStream,
  Stats,
  ReadStream,
  Dirent
};

//# debugId=4A2464769D05B24464756e2164756e21
