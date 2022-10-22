var fs = Bun.fs();

export var access = function access(...args) {
  callbackify(fs.accessSync, args);
};
export var appendFile = function appendFile(...args) {
  callbackify(fs.appendFileSync, args);
};
export var close = function close(...args) {
  callbackify(fs.closeSync, args);
};
export var rm = function rm(...args) {
  callbackify(fs.rmSync, args);
};
export var copyFile = function copyFile(...args) {
  callbackify(fs.copyFileSync, args);
};
export var exists = function exists(...args) {
  callbackify(fs.existsSync, args);
};
export var chown = function chown(...args) {
  callbackify(fs.chownSync, args);
};
export var chmod = function chmod(...args) {
  callbackify(fs.chmodSync, args);
};
export var fchmod = function fchmod(...args) {
  callbackify(fs.fchmodSync, args);
};
export var fchown = function fchown(...args) {
  callbackify(fs.fchownSync, args);
};
export var fstat = function fstat(...args) {
  callbackify(fs.fstatSync, args);
};
export var fsync = function fsync(...args) {
  callbackify(fs.fsyncSync, args);
};
export var ftruncate = function ftruncate(...args) {
  callbackify(fs.ftruncateSync, args);
};
export var futimes = function futimes(...args) {
  callbackify(fs.futimesSync, args);
};
export var lchmod = function lchmod(...args) {
  callbackify(fs.lchmodSync, args);
};
export var lchown = function lchown(...args) {
  callbackify(fs.lchownSync, args);
};
export var link = function link(...args) {
  callbackify(fs.linkSync, args);
};
export var lstat = function lstat(...args) {
  callbackify(fs.lstatSync, args);
};
export var mkdir = function mkdir(...args) {
  callbackify(fs.mkdirSync, args);
};
export var mkdtemp = function mkdtemp(...args) {
  callbackify(fs.mkdtempSync, args);
};
export var open = function open(...args) {
  callbackify(fs.openSync, args);
};
export var read = function read(...args) {
  callbackify(fs.readSync, args);
};
export var write = function write(...args) {
  callbackify(fs.writeSync, args);
};
export var readdir = function readdir(...args) {
  callbackify(fs.readdirSync, args);
};
export var readFile = function readFile(...args) {
  callbackify(fs.readFileSync, args);
};
export var writeFile = function writeFile(...args) {
  callbackify(fs.writeFileSync, args);
};
export var readlink = function readlink(...args) {
  callbackify(fs.readlinkSync, args);
};
export var realpath = function realpath(...args) {
  callbackify(fs.realpathSync, args);
};
export var rename = function rename(...args) {
  callbackify(fs.renameSync, args);
};
export var stat = function stat(...args) {
  callbackify(fs.statSync, args);
};
export var symlink = function symlink(...args) {
  callbackify(fs.symlinkSync, args);
};
export var truncate = function truncate(...args) {
  callbackify(fs.truncateSync, args);
};
export var unlink = function unlink(...args) {
  callbackify(fs.unlinkSync, args);
};
export var utimes = function utimes(...args) {
  callbackify(fs.utimesSync, args);
};
export var lutimes = function lutimes(...args) {
  callbackify(fs.lutimesSync, args);
};

function callbackify(fsFunction, args) {
  try {
    const result = fsFunction.apply(fs, args.slice(0, args.length - 1));
    queueMicrotask(() => args[args.length - 1](null, result));
  } catch (e) {
    queueMicrotask(() => args[args.length - 1](e));
  }
}

// note: this is not quite the same as how node does it
// in some cases, node swaps around arguments or makes small tweaks to the return type
// this is just better than nothing.
function promisify(fsFunction) {
  // TODO: remove variadic arguments
  // we can use new Function() here instead
  // based on fsFucntion.length
  var obj = {
    [fsFunction.name]: function (resolve, reject, args) {
      var result;
      try {
        result = fsFunction.apply(fs, args);
        args = undefined;
      } catch (err) {
        args = undefined;
        reject(err);
        return;
      }

      resolve(result);
    },
  };

  var func = obj[fsFunction.name];

  // TODO: consider @createPromiseCapabiilty intrinsic
  return (...args) => {
    return new Promise((resolve, reject) => {
      func(resolve, reject, args);
    });
  };
}

export var accessSync = fs.accessSync.bind(fs);
export var appendFileSync = fs.appendFileSync.bind(fs);
export var closeSync = fs.closeSync.bind(fs);
export var copyFileSync = fs.copyFileSync.bind(fs);
export var existsSync = fs.existsSync.bind(fs);
export var chownSync = fs.chownSync.bind(fs);
export var chmodSync = fs.chmodSync.bind(fs);
export var fchmodSync = fs.fchmodSync.bind(fs);
export var fchownSync = fs.fchownSync.bind(fs);
export var fstatSync = fs.fstatSync.bind(fs);
export var fsyncSync = fs.fsyncSync.bind(fs);
export var ftruncateSync = fs.ftruncateSync.bind(fs);
export var futimesSync = fs.futimesSync.bind(fs);
export var lchmodSync = fs.lchmodSync.bind(fs);
export var lchownSync = fs.lchownSync.bind(fs);
export var linkSync = fs.linkSync.bind(fs);
export var lstatSync = fs.lstatSync.bind(fs);
export var mkdirSync = fs.mkdirSync.bind(fs);
export var mkdtempSync = fs.mkdtempSync.bind(fs);
export var openSync = fs.openSync.bind(fs);
export var readSync = fs.readSync.bind(fs);
export var writeSync = fs.writeSync.bind(fs);
export var readdirSync = fs.readdirSync.bind(fs);
export var readFileSync = fs.readFileSync.bind(fs);
export var writeFileSync = fs.writeFileSync.bind(fs);
export var readlinkSync = fs.readlinkSync.bind(fs);
export var realpathSync = fs.realpathSync.bind(fs);
export var renameSync = fs.renameSync.bind(fs);
export var statSync = fs.statSync.bind(fs);
export var symlinkSync = fs.symlinkSync.bind(fs);
export var truncateSync = fs.truncateSync.bind(fs);
export var unlinkSync = fs.unlinkSync.bind(fs);
export var utimesSync = fs.utimesSync.bind(fs);
export var lutimesSync = fs.lutimesSync.bind(fs);
export var rmSync = fs.rmSync.bind(fs);

// Results from Object.keys() in Node 18
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
var _lazyReadStream;
var readStreamPathFastPathSymbol = Symbol.for(
  "Bun.Node.readStreamPathFastPath"
);
const readStreamSymbol = Symbol.for("Bun.NodeReadStream");
const readStreamPathOrFdSymbol = Symbol.for("Bun.NodeReadStreamPathOrFd");
var writeStreamPathFastPathSymbol = Symbol.for("Bun.NodeWriteStreamFastPath");
var writeStreamPathFastPathCallSymbol = Symbol.for(
  "Bun.NodeWriteStreamFastPathCall"
);
var kIoDone = Symbol.for("kIoDone");

function getLazyReadStream() {
  if (_lazyReadStream) {
    return _lazyReadStream;
  }

  var { Readable, eos: eos_ } = import.meta.require("node:stream");
  var defaultReadStreamOptions = {
    file: undefined,
    fd: undefined,
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
      close,
    },
    autoDestroy: true,
  };

  var internalReadFn;
  var ReadStream = class ReadStream extends Readable {
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
        fs = defaultReadStreamOptions.fs,
        highWaterMark = defaultReadStreamOptions.highWaterMark,
      } = options;

      super({
        ...options,
        encoding,
        autoDestroy,
        autoClose,
        emitClose,
      });

      this.end = end;
      this._read = this.#internalRead;
      this.start = start;
      this.flags = flags;
      this.mode = mode;
      this.emitClose = emitClose;
      this.#fs = fs;
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

      if (pathOrFd?.constructor?.name === "URL") {
        pathOrFd = Bun.fileURLToPath(pathOrFd);
      }

      if (typeof pathOrFd === "string") {
        if (pathOrFd.startsWith("file://")) {
          pathOrFd = Bun.fileURLToPath(pathOrFd);
        }
        if (pathOrFd.length === 0) {
          throw new TypeError("Expected path to be a non-empty string");
        }
        this.path = this.file = this[readStreamPathOrFdSymbol] = pathOrFd;
      } else if (typeof pathOrFd === "number") {
        pathOrFd |= 0;
        if (pathOrFd < 0) {
          throw new TypeError("Expected fd to be a positive integer");
        }
        this.fd = this[readStreamPathOrFdSymbol] = pathOrFd;

        this.autoClose = false;
      } else {
        throw new TypeError("Expected a path or file descriptor");
      }
    }
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
      if (typeof this.fd === "number") {
        callback();
        return;
      }
      // this[readStreamPathFastPathSymbol] = false;
      var { path, flags, mode } = this;

      this.#fs.open(path, flags, mode, (er, fd) => {
        if (er) {
          callback(er);
          return;
        }

        this.fd = fd;
        callback();
        this.emit("open", this.fd);
        this.emit("ready");
      });
    }

    _destroy(err, cb) {
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
      if (typeof cb === "function") eos_()(this, cb);
      this.destroy();
    }

    #internalRead(n) {
      var { pos, end, bytesRead, fd, encoding } = this;

      n =
        pos !== undefined
          ? Math.min(end - pos + 1, n)
          : Math.min(end - bytesRead + 1, n);

      if (n <= 0) {
        this.push(null);
        return;
      }

      if (
        this.#fileSize === -1 &&
        this.#fs.read === defaultReadStreamOptions.fs.read &&
        bytesRead === 0 &&
        pos === undefined
      ) {
        const stat = fstatSync(this.fd);
        this.#fileSize = stat.size;
        if (this.#fileSize > 0 && n > this.#fileSize) {
          // add 1 byte so that we can detect EOF
          n = this.#fileSize + 1;
        }
      }

      const buf = Buffer.allocUnsafeSlow(n);

      this[kIoDone] = false;
      this.#fs.read(fd, buf, 0, n, pos, (er, bytesRead) => {
        this[kIoDone] = true;

        // Tell ._destroy() that it's safe to close the fd now.
        if (this.destroyed) {
          this.emit(kIoDone, er);
          return;
        }

        if (er) {
          this.#errorOrDestroy(er);
          return;
        }

        if (bytesRead > 0) {
          this.#handleRead(buf, bytesRead);
        } else {
          this.push(null);
        }
      });
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

    #handleRead(buf, bytesRead) {
      this.bytesRead += bytesRead;
      if (this.pos !== undefined) {
        this.pos += bytesRead;
      }

      if (bytesRead !== buf.length) {
        if (buf.length - bytesRead < 256) {
          // We allow up to 256 bytes of wasted space
          this.push(buf.slice(0, bytesRead));
        } else {
          // Slow path. Shrink to fit.
          // Copy instead of slice so that we don't retain
          // large backing buffer for small reads.
          const dst = Buffer.allocUnsafeSlow(bytesRead);
          buf.copy(dst, 0, 0, bytesRead);
          this.push(dst);
        }
      } else {
        this.push(buf);
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
      if (
        this[readStreamPathFastPathSymbol] &&
        (pipeOpts?.end ?? true) &&
        this._readableState?.pipes?.length === 0
      ) {
        if (
          writeStreamPathFastPathSymbol in dest &&
          dest[writeStreamPathFastPathSymbol]
        ) {
          if (dest[writeStreamPathFastPathCallSymbol](this, pipeOpts)) {
            return this;
          }
        }
      }

      this[readStreamPathFastPathSymbol] = false;
      return super.pipe(dest, pipeOpts);
    }
  };
  return (_lazyReadStream = ReadStream);
}

var internalCreateReadStream = function createReadStream(path, options) {
  const ReadStream = getLazyReadStream();
  return new ReadStream(path, options);
};
export var createReadStream = internalCreateReadStream;

var _lazyWriteStream;

function getLazyWriteStream() {
  if (_lazyWriteStream) return _lazyWriteStream;

  const { Writable, eos } = import.meta.require("node:stream");

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
    },
  };

  var WriteStream = class WriteStream extends Writable {
    constructor(path, options = defaultWriteStreamOptions) {
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
      super({ ...options, decodeStrings: false, autoDestroy, emitClose });

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

      if (typeof path === "string") {
        if (path.length === 0) {
          throw new TypeError("Expected a non-empty path");
        }

        if (path.startsWith("file:")) {
          path = Bun.fileURLToPath(path);
        }

        this.path = path;
        this.fd = null;
        this[writeStreamPathFastPathSymbol] =
          autoClose &&
          (start === undefined || start === 0) &&
          fs.write === defaultWriteStreamOptions.fs.write &&
          fs.close === defaultWriteStreamOptions.fs.close;
      } else {
        this.fd = fd;
        this[writeStreamPathFastPathSymbol] = false;
      }
      this.start = start;
      this.#fs = fs;
      this.flags = flags;
      this.mode = mode;

      if (this.start !== undefined) {
        this.pos = this.start;
      }

      if (encoding !== defaultWriteStreamOptions.encoding) {
        this.setDefaultEncoding(encoding);
        if (
          encoding !== "buffer" &&
          encoding !== "utf8" &&
          encoding !== "utf-8" &&
          encoding !== "binary"
        ) {
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

    // noop, node has deprecated this
    open() {}

    path;
    fd;
    flags;
    mode;
    #fs;
    bytesWritten = 0;
    pos;
    [writeStreamPathFastPathSymbol];
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
      return Bun.write(
        this[writeStreamPathFastPathSymbol],
        readStream[readStreamPathOrFdSymbol]
      ).then(
        (bytesWritten) => {
          readStream[kIoDone] = this[kIoDone] = true;
          this.bytesWritten += bytesWritten;
          readStream.bytesRead += bytesWritten;
          this.end();
          readStream.close();
        },
        (err) => {
          readStream[kIoDone] = this[kIoDone] = true;
          this.#errorOrDestroy(err);
          readStream.emit("error", err);
        }
      );
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

      // If we are not autoClosing, we should call
      // destroy on 'finish'.
      if (!this.autoClose) {
        this.on("finish", this.destroy);
      }

      // We use end() instead of destroy() because of
      // https://github.com/nodejs/node/issues/2006
      this.end();
    }
    #internalWrite(chunk, encoding, cb) {
      this[writeStreamPathFastPathSymbol] = false;
      if (typeof chunk === "string") {
        chunk = Buffer.from(chunk, encoding);
      }

      if (this.pos !== undefined) {
        this[kIoDone] = true;
        this.#fs.write(
          this.fd,
          chunk,
          0,
          chunk.length,
          this.pos,
          (err, bytes) => {
            ths[kIoDone] = false;
            this.#handleWrite(err, bytes);
            this.emit(kIoDone);

            !err ? cb() : cb(err);
          }
        );
      } else {
        this[kIoDone] = true;
        this.#fs.write(this.fd, chunk, 0, chunk.length, null, (err, bytes) => {
          ths[kIoDone] = false;
          this.#handleWrite(err, bytes);
          this.emit(kIoDone);
          !err ? cb() : cb(err);
        });
      }
    }
    _write = this.#internalWrite;
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
  };
  return (_lazyWriteStream = WriteStream);
}

var internalCreateWriteStream = function createWriteStream(path, options) {
  const WriteStream = getLazyWriteStream();
  return new WriteStream(path, options);
};

export var createWriteStream = internalCreateWriteStream;
Object.defineProperties(fs, {
  createReadStream: {
    value: internalCreateReadStream,
  },
  createWriteStream: {
    value: createWriteStream,
  },
});

export var promises = {
  access: promisify(fs.accessSync),
  appendFile: promisify(fs.appendFileSync),
  chmod: promisify(fs.chmodSync),
  chown: promisify(fs.chownSync),
  close: promisify(fs.closeSync),
  copyFile: promisify(fs.copyFileSync),
  exists: promisify(fs.existsSync),
  fchmod: promisify(fs.fchmodSync),
  fchown: promisify(fs.fchownSync),
  fstat: promisify(fs.fstatSync),
  fsync: promisify(fs.fsyncSync),
  ftruncate: promisify(fs.ftruncateSync),
  futimes: promisify(fs.futimesSync),
  lchmod: promisify(fs.lchmodSync),
  lchown: promisify(fs.lchownSync),
  link: promisify(fs.linkSync),
  lstat: promisify(fs.lstatSync),
  lutimes: promisify(fs.lutimesSync),
  mkdir: promisify(fs.mkdirSync),
  mkdtemp: promisify(fs.mkdtempSync),
  open: promisify(fs.openSync),
  read: promisify(fs.readSync),
  readdir: promisify(fs.readdirSync),
  readlink: promisify(fs.readlinkSync),
  realpath: promisify(fs.realpathSync),
  rename: promisify(fs.renameSync),
  rm: promisify(fs.rmSync),
  stat: promisify(fs.statSync),
  symlink: promisify(fs.symlinkSync),
  truncate: promisify(fs.truncateSync),
  unlink: promisify(fs.unlinkSync),
  utimes: promisify(fs.utimesSync),
  write: promisify(fs.writeSync),
  writeFile: promisify(fs.writeFileSync),
};

promises.readFile = promises.readfile = promisify(fs.readFileSync);

// lol
realpath.native = realpath;
realpathSync.native = realpathSync;

export default {
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
  constants,
  copyFile,
  copyFileSync,
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
  realpath,
  realpathSync,
  rename,
  renameSync,
  rm,
  rmSync,
  stat,
  statSync,
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
};
