var callbackify = function(fsFunction, args) {
  try {
    const result = fsFunction.apply(fs, args.slice(0, args.length - 1)), callback = args[args.length - 1];
    if (typeof callback === "function")
      queueMicrotask(() => callback(null, result));
  } catch (e) {
    const callback = args[args.length - 1];
    if (typeof callback === "function")
      queueMicrotask(() => callback(e));
  }
};
function createReadStream(path, options) {
  return new ReadStream(path, options);
}
function createWriteStream(path, options) {
  return new WriteStream(path, options);
}
var { direct, isPromise, isCallable } = import.meta.primordials, promises = import.meta.require("node:fs/promises"), { Readable, NativeWritable, _getNativeReadableStreamPrototype, eos: eos_ } = import.meta.require("node:stream"), NativeReadable = _getNativeReadableStreamPrototype(2, Readable), fs = Bun.fs(), debug = process.env.DEBUG ? console.log : () => {
}, access = function access2(...args) {
  callbackify(fs.accessSync, args);
}, appendFile = function appendFile2(...args) {
  callbackify(fs.appendFileSync, args);
}, close = function close2(...args) {
  callbackify(fs.closeSync, args);
}, rm = function rm2(...args) {
  callbackify(fs.rmSync, args);
}, rmdir = function rmdir2(...args) {
  callbackify(fs.rmdirSync, args);
}, copyFile = function copyFile2(...args) {
  callbackify(fs.copyFileSync, args);
}, exists = function exists2(...args) {
  callbackify(fs.existsSync, args);
}, chown = function chown2(...args) {
  callbackify(fs.chownSync, args);
}, chmod = function chmod2(...args) {
  callbackify(fs.chmodSync, args);
}, fchmod = function fchmod2(...args) {
  callbackify(fs.fchmodSync, args);
}, fchown = function fchown2(...args) {
  callbackify(fs.fchownSync, args);
}, fstat = function fstat2(...args) {
  callbackify(fs.fstatSync, args);
}, fsync = function fsync2(...args) {
  callbackify(fs.fsyncSync, args);
}, ftruncate = function ftruncate2(...args) {
  callbackify(fs.ftruncateSync, args);
}, futimes = function futimes2(...args) {
  callbackify(fs.futimesSync, args);
}, lchmod = function lchmod2(...args) {
  callbackify(fs.lchmodSync, args);
}, lchown = function lchown2(...args) {
  callbackify(fs.lchownSync, args);
}, link = function link2(...args) {
  callbackify(fs.linkSync, args);
}, lstat = function lstat2(...args) {
  callbackify(fs.lstatSync, args);
}, mkdir = function mkdir2(...args) {
  callbackify(fs.mkdirSync, args);
}, mkdtemp = function mkdtemp2(...args) {
  callbackify(fs.mkdtempSync, args);
}, open = function open2(...args) {
  callbackify(fs.openSync, args);
}, read = function read2(...args) {
  callbackify(fs.readSync, args);
}, write = function write2(...args) {
  callbackify(fs.writeSync, args);
}, readdir = function readdir2(...args) {
  callbackify(fs.readdirSync, args);
}, readFile = function readFile2(...args) {
  callbackify(fs.readFileSync, args);
}, writeFile = function writeFile2(...args) {
  callbackify(fs.writeFileSync, args);
}, readlink = function readlink2(...args) {
  callbackify(fs.readlinkSync, args);
}, realpath = function realpath2(...args) {
  callbackify(fs.realpathSync, args);
}, rename = function rename2(...args) {
  callbackify(fs.renameSync, args);
}, stat = function stat2(...args) {
  callbackify(fs.statSync, args);
}, symlink = function symlink2(...args) {
  callbackify(fs.symlinkSync, args);
}, truncate = function truncate2(...args) {
  callbackify(fs.truncateSync, args);
}, unlink = function unlink2(...args) {
  callbackify(fs.unlinkSync, args);
}, utimes = function utimes2(...args) {
  callbackify(fs.utimesSync, args);
}, lutimes = function lutimes2(...args) {
  callbackify(fs.lutimesSync, args);
}, accessSync = fs.accessSync.bind(fs), appendFileSync = fs.appendFileSync.bind(fs), closeSync = fs.closeSync.bind(fs), copyFileSync = fs.copyFileSync.bind(fs), existsSync = fs.existsSync.bind(fs), chownSync = fs.chownSync.bind(fs), chmodSync = fs.chmodSync.bind(fs), fchmodSync = fs.fchmodSync.bind(fs), fchownSync = fs.fchownSync.bind(fs), fstatSync = fs.fstatSync.bind(fs), fsyncSync = fs.fsyncSync.bind(fs), ftruncateSync = fs.ftruncateSync.bind(fs), futimesSync = fs.futimesSync.bind(fs), lchmodSync = fs.lchmodSync.bind(fs), lchownSync = fs.lchownSync.bind(fs), linkSync = fs.linkSync.bind(fs), lstatSync = fs.lstatSync.bind(fs), mkdirSync = fs.mkdirSync.bind(fs), mkdtempSync = fs.mkdtempSync.bind(fs), openSync = fs.openSync.bind(fs), readSync = fs.readSync.bind(fs), writeSync = fs.writeSync.bind(fs), readdirSync = fs.readdirSync.bind(fs), readFileSync = fs.readFileSync.bind(fs), writeFileSync = fs.writeFileSync.bind(fs), readlinkSync = fs.readlinkSync.bind(fs), realpathSync = fs.realpathSync.bind(fs), renameSync = fs.renameSync.bind(fs), statSync = fs.statSync.bind(fs), symlinkSync = fs.symlinkSync.bind(fs), truncateSync = fs.truncateSync.bind(fs), unlinkSync = fs.unlinkSync.bind(fs), utimesSync = fs.utimesSync.bind(fs), lutimesSync = fs.lutimesSync.bind(fs), rmSync = fs.rmSync.bind(fs), rmdirSync = fs.rmdirSync.bind(fs), Dirent = fs.Dirent, Stats = fs.Stats, promises = import.meta.require("node:fs/promises"), readStreamPathFastPathSymbol = Symbol.for("Bun.Node.readStreamPathFastPath"), readStreamSymbol = Symbol.for("Bun.NodeReadStream"), readStreamPathOrFdSymbol = Symbol.for("Bun.NodeReadStreamPathOrFd"), writeStreamSymbol = Symbol.for("Bun.NodeWriteStream"), writeStreamPathFastPathSymbol = Symbol.for("Bun.NodeWriteStreamFastPath"), writeStreamPathFastPathCallSymbol = Symbol.for("Bun.NodeWriteStreamFastPathCall"), kIoDone = Symbol.for("kIoDone"), defaultReadStreamOptions = {
  file: void 0,
  fd: void 0,
  flags: "r",
  encoding: void 0,
  mode: 438,
  autoClose: !0,
  emitClose: !0,
  start: 0,
  end: Infinity,
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
  autoDestroy: !0
}, ReadStreamClass, ReadStream = function(InternalReadStream) {
  return ReadStreamClass = InternalReadStream, Object.defineProperty(ReadStreamClass.prototype, Symbol.toStringTag, {
    value: "ReadStream",
    enumerable: !1
  }), Object.defineProperty(function ReadStream(path, options) {
    return new InternalReadStream(path, options);
  }, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalReadStream;
    }
  });
}(class ReadStream2 extends NativeReadable {
  constructor(pathOrFd, options = defaultReadStreamOptions) {
    if (typeof options !== "object" || !options)
      throw new TypeError("Expected options to be an object");
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
    if (pathOrFd?.constructor?.name === "URL")
      pathOrFd = Bun.fileURLToPath(pathOrFd);
    var tempThis = {};
    if (typeof pathOrFd === "string") {
      if (pathOrFd.startsWith("file://"))
        pathOrFd = Bun.fileURLToPath(pathOrFd);
      if (pathOrFd.length === 0)
        throw new TypeError("Expected path to be a non-empty string");
      tempThis.path = tempThis.file = tempThis[readStreamPathOrFdSymbol] = pathOrFd;
    } else if (typeof pathOrFd === "number") {
      if (pathOrFd |= 0, pathOrFd < 0)
        throw new TypeError("Expected fd to be a positive integer");
      tempThis.fd = tempThis[readStreamPathOrFdSymbol] = pathOrFd, tempThis.autoClose = !1;
    } else
      throw new TypeError("Expected a path or file descriptor");
    if (!tempThis.fd)
      tempThis.fd = fs2.openSync(pathOrFd, flags, mode);
    var fileRef = Bun.file(tempThis.fd), stream = fileRef.stream(), native = direct(stream);
    if (!native)
      throw debug("no native readable stream"), new Error("no native readable stream");
    var { stream: ptr } = native;
    super(ptr, {
      ...options,
      encoding,
      autoDestroy,
      autoClose,
      emitClose,
      highWaterMark
    });
    if (Object.assign(this, tempThis), this.#fileRef = fileRef, this.end = end, this._read = this.#internalRead, this.start = start, this.flags = flags, this.mode = mode, this.emitClose = emitClose, this[readStreamPathFastPathSymbol] = start === 0 && end === Infinity && autoClose && fs2 === defaultReadStreamOptions.fs && (encoding === "buffer" || encoding === "binary" || encoding == null || encoding === "utf-8" || encoding === "utf8"), this._readableState.autoClose = autoDestroy = autoClose, this._readableState.highWaterMark = highWaterMark, start !== void 0)
      this.pos = start;
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
  [readStreamSymbol] = !0;
  [readStreamPathOrFdSymbol];
  [readStreamPathFastPathSymbol];
  _construct(callback) {
    if (super._construct)
      super._construct(callback);
    else
      callback();
    this.emit("open", this.fd), this.emit("ready");
  }
  _destroy(err, cb) {
    super._destroy(err, cb);
    try {
      var fd = this.fd;
      if (this[readStreamPathFastPathSymbol] = !1, !fd)
        cb(err);
      else
        this.#fs.close(fd, (er) => {
          cb(er || err);
        }), this.fd = null;
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
      if (currPos !== void 0) {
        if (this.bytesRead < currPos)
          return !0;
        if (currPos === this.start) {
          var n = this.bytesRead - currPos;
          chunk = chunk.slice(-n);
          var [_, ...rest] = arguments;
          if (this.pos = this.bytesRead, this.end && this.bytesRead >= this.end)
            chunk = chunk.slice(0, this.end - this.start);
          return super.push(chunk, ...rest);
        }
        var end = this.end;
        if (end && this.bytesRead >= end) {
          chunk = chunk.slice(0, end - currPos);
          var [_, ...rest] = arguments;
          return this.pos = this.bytesRead, super.push(chunk, ...rest);
        }
        this.pos = this.bytesRead;
      }
    }
    return super.push(...arguments);
  }
  #internalRead(n) {
    var { pos, end, bytesRead, fd, encoding } = this;
    if (n = pos !== void 0 ? Math.min(end - pos + 1, n) : Math.min(end - bytesRead + 1, n), debug("n @ fs.ReadStream.#internalRead, after clamp", n), n <= 0) {
      this.push(null);
      return;
    }
    if (this.#fileSize === -1 && bytesRead === 0 && pos === void 0) {
      var stat3 = fstatSync(fd);
      if (this.#fileSize = stat3.size, this.#fileSize > 0 && n > this.#fileSize)
        n = this.#fileSize + 1;
      debug("fileSize", this.#fileSize);
    }
    this[kIoDone] = !1;
    var res = super._read(n);
    if (debug("res -- undefined? why?", res), isPromise(res)) {
      var then = res?.then;
      if (then && isCallable(then))
        then(() => {
          if (this[kIoDone] = !0, this.destroyed)
            this.emit(kIoDone);
        }, (er) => {
          this[kIoDone] = !0, this.#errorOrDestroy(er);
        });
    } else if (this[kIoDone] = !0, this.destroyed)
      this.emit(kIoDone), this.#errorOrDestroy(new Error("ERR_STREAM_PREMATURE_CLOSE"));
  }
  #errorOrDestroy(err, sync = null) {
    var {
      _readableState: r = { destroyed: !1, autoDestroy: !1 },
      _writableState: w = { destroyed: !1, autoDestroy: !1 }
    } = this;
    if (w?.destroyed || r?.destroyed)
      return this;
    if (r?.autoDestroy || w?.autoDestroy)
      this.destroy(err);
    else if (err)
      this.emit("error", err);
  }
  pause() {
    return this[readStreamPathFastPathSymbol] = !1, super.pause();
  }
  resume() {
    return this[readStreamPathFastPathSymbol] = !1, super.resume();
  }
  unshift(...args) {
    return this[readStreamPathFastPathSymbol] = !1, super.unshift(...args);
  }
  pipe(dest, pipeOpts) {
    if (this[readStreamPathFastPathSymbol] && (pipeOpts?.end ?? !0) && this._readableState?.pipes?.length === 0) {
      if ((writeStreamPathFastPathSymbol in dest) && dest[writeStreamPathFastPathSymbol]) {
        if (dest[writeStreamPathFastPathCallSymbol](this, pipeOpts))
          return this;
      }
    }
    return this[readStreamPathFastPathSymbol] = !1, super.pipe(dest, pipeOpts);
  }
}), defaultWriteStreamOptions = {
  fd: null,
  start: void 0,
  pos: void 0,
  encoding: void 0,
  flags: "w",
  mode: 438,
  fs: {
    write,
    close,
    open,
    openSync
  }
}, WriteStreamClass, WriteStream = function(InternalWriteStream) {
  return WriteStreamClass = InternalWriteStream, Object.defineProperty(WriteStreamClass.prototype, Symbol.toStringTag, {
    value: "WritesStream",
    enumerable: !1
  }), Object.defineProperty(function WriteStream(options) {
    return new InternalWriteStream(options);
  }, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalWriteStream;
    }
  });
}(class WriteStream2 extends NativeWritable {
  constructor(path, options = defaultWriteStreamOptions) {
    if (!options)
      throw new TypeError("Expected options to be an object");
    var {
      fs: fs2 = defaultWriteStreamOptions.fs,
      start = defaultWriteStreamOptions.start,
      flags = defaultWriteStreamOptions.flags,
      mode = defaultWriteStreamOptions.mode,
      autoClose = !0,
      emitClose = !1,
      autoDestroy = autoClose,
      encoding = defaultWriteStreamOptions.encoding,
      fd = defaultWriteStreamOptions.fd,
      pos = defaultWriteStreamOptions.pos
    } = options, tempThis = {};
    if (typeof path === "string") {
      if (path.length === 0)
        throw new TypeError("Expected a non-empty path");
      if (path.startsWith("file:"))
        path = Bun.fileURLToPath(path);
      tempThis.path = path, tempThis.fd = null, tempThis[writeStreamPathFastPathSymbol] = autoClose && (start === void 0 || start === 0) && fs2.write === defaultWriteStreamOptions.fs.write && fs2.close === defaultWriteStreamOptions.fs.close;
    } else
      tempThis.fd = fd, tempThis[writeStreamPathFastPathSymbol] = !1;
    if (!tempThis.fd)
      tempThis.fd = fs2.openSync(path, flags, mode);
    super(tempThis.fd, {
      ...options,
      decodeStrings: !1,
      autoDestroy,
      emitClose,
      fd: tempThis
    });
    if (Object.assign(this, tempThis), typeof fs2?.write !== "function")
      throw new TypeError("Expected fs.write to be a function");
    if (typeof fs2?.close !== "function")
      throw new TypeError("Expected fs.close to be a function");
    if (typeof fs2?.open !== "function")
      throw new TypeError("Expected fs.open to be a function");
    if (typeof path === "object" && path) {
      if (path instanceof URL)
        path = Bun.fileURLToPath(path);
    }
    if (typeof path !== "string" && typeof fd !== "number")
      throw new TypeError("Expected a path or file descriptor");
    if (this.start = start, this.#fs = fs2, this.flags = flags, this.mode = mode, this.start !== void 0)
      this.pos = this.start;
    if (encoding !== defaultWriteStreamOptions.encoding) {
      if (this.setDefaultEncoding(encoding), encoding !== "buffer" && encoding !== "utf8" && encoding !== "utf-8" && encoding !== "binary")
        this[writeStreamPathFastPathSymbol] = !1;
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
  [writeStreamSymbol] = !0;
  start;
  [writeStreamPathFastPathCallSymbol](readStream, pipeOpts) {
    if (!this[writeStreamPathFastPathSymbol])
      return !1;
    if (this.fd !== null)
      return this[writeStreamPathFastPathSymbol] = !1, !1;
    return this[kIoDone] = !1, readStream[kIoDone] = !1, Bun.write(this[writeStreamPathFastPathSymbol], readStream[readStreamPathOrFdSymbol]).then((bytesWritten) => {
      readStream[kIoDone] = this[kIoDone] = !0, this.bytesWritten += bytesWritten, readStream.bytesRead += bytesWritten, this.end(), readStream.close();
    }, (err) => {
      readStream[kIoDone] = this[kIoDone] = !0, this.#errorOrDestroy(err), readStream.emit("error", err);
    });
  }
  isBunFastPathEnabled() {
    return this[writeStreamPathFastPathSymbol];
  }
  disableBunFastPath() {
    this[writeStreamPathFastPathSymbol] = !1;
  }
  #handleWrite(er, bytes) {
    if (er)
      return this.#errorOrDestroy(er);
    this.bytesWritten += bytes;
  }
  #internalClose(err, cb) {
    this[writeStreamPathFastPathSymbol] = !1;
    var fd = this.fd;
    this.#fs.close(fd, (er) => {
      this.fd = null, cb(err || er);
    });
  }
  _construct(callback) {
    if (typeof this.fd === "number") {
      callback();
      return;
    }
    callback(), this.emit("open", this.fd), this.emit("ready");
  }
  _destroy(err, cb) {
    if (this.fd === null)
      return cb(err);
    if (this[kIoDone]) {
      this.once(kIoDone, () => this.#internalClose(err, cb));
      return;
    }
    this.#internalClose(err, cb);
  }
  [kIoDone] = !1;
  close(cb) {
    if (cb) {
      if (this.closed) {
        process.nextTick(cb);
        return;
      }
      this.on("close", cb);
    }
    if (!this.autoClose)
      this.on("finish", this.destroy);
    this.end();
  }
  write(chunk, encoding = this._writableState.defaultEncoding, cb) {
    if (this[writeStreamPathFastPathSymbol] = !1, typeof chunk === "string")
      chunk = Buffer.from(chunk, encoding);
    var native = this.pos === void 0;
    return this[kIoDone] = !0, super.write(chunk, encoding, native ? (err, bytes) => {
      if (this[kIoDone] = !1, this.#handleWrite(err, bytes), this.emit(kIoDone), cb)
        !err ? cb() : cb(err);
    } : () => {
    }, native);
  }
  #internalWriteSlow(chunk, encoding, cb) {
    this.#fs.write(this.fd, chunk, 0, chunk.length, this.pos, (err, bytes) => {
      this[kIoDone] = !1, this.#handleWrite(err, bytes), this.emit(kIoDone), !err ? cb() : cb(err);
    });
  }
  end(chunk, encoding, cb) {
    var native = this.pos === void 0;
    return super.end(chunk, encoding, cb, native);
  }
  _write = this.#internalWriteSlow;
  _writev = void 0;
  get pending() {
    return this.fd === null;
  }
  _destroy(err, cb) {
    this.close(err, cb);
  }
  #errorOrDestroy(err) {
    var {
      _readableState: r = { destroyed: !1, autoDestroy: !1 },
      _writableState: w = { destroyed: !1, autoDestroy: !1 }
    } = this;
    if (w?.destroyed || r?.destroyed)
      return this;
    if (r?.autoDestroy || w?.autoDestroy)
      this.destroy(err);
    else if (err)
      this.emit("error", err);
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
