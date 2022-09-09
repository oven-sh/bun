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
  queueMicrotask(function () {
    try {
      args[args.length - 1](
        null,
        fsFunction.apply(fs, args.slice(0, args.length - 1))
      );
    } catch (err) {
      args[args.length - 1](err);
    } finally {
      // ensure we don't leak it
      args = null;
    }
  });
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


var __getOwnPropNames = Object.getOwnPropertyNames;

var __commonJS = (cb, mod) =>
  function __require2() {
    return (
      mod ||
      (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod),
      mod.exports
    );
  };


var reader_stream_utils = __commonJS({
  "utils for ReaderStream"(exports, module) {
    "use strict";

    let Readable = null;
    if (!Readable) {
      Readable = import.meta.require("node:stream").Readable;
    }
    module.exports = {
      Readable,
      finished: import.meta.require("node:stream"),
      validateInteger(value,
        name,
        min = Number.MAX_SAFE_INTEGER,
        max = Number.MAX_SAFE_INTEGER) {
        // Todo
      },

      toPathIfFileURL(path) {
        if (path != null && path.href && path.origin) {
          return path;
        } else {
          return Bun.pathToFileURL(path);
        }
      },
      PromisePrototypeThen(self, thenFn, catchFn) {
        return self.then(thenFn, catchFn);
      },

      FileHandleOperations(handle) {
        return {
          open: (path, flags, mode, cb) => {
            throw new Error('open()');
          },
          close: (fd, cb) => {
            handle[kUnref]();
            PromisePrototypeThen(handle.close(),
              () => cb(), cb);
          },
          read: (fd, buf, offset, length, pos, cb) => {
            PromisePrototypeThen(handle.read(buf, offset, length, pos),
              (r) => cb(null, r.bytesRead, r.buffer),
              (err) => cb(err, 0, buf));
          },
          write: (fd, buf, offset, length, pos, cb) => {
            PromisePrototypeThen(handle.write(buf, offset, length, pos),
              (r) => cb(null, r.bytesWritten, r.buffer),
              (err) => cb(err, 0, buf));
          },
          writev: (fd, buffers, pos, cb) => {
            PromisePrototypeThen(handle.writev(buffers, pos),
              (r) => cb(null, r.bytesWritten, r.buffers),
              (err) => cb(err, 0, buffers));
          }
        };
      },
      close(stream, err, cb) {
        if (!stream.fd) {
          cb(err);
        } else {
          stream["kFs"].close(stream.fd, (er) => {
            cb(er || err);
          });
          stream.fd = null;
        }
      },
      errorOrDestroy(stream, err, sync = null) {
        const r = stream._readableState;
        const w = stream._writableState;
        if ((w && w.destroyed) || (r && r.destroyed)) {
          return this;
        }
        if ((r && r.autoDestroy) || (w && w.autoDestroy))
          stream.destroy(err);
        else if (err) {
          err.stack;
          if (w && !w.errored) {
            w.errored = err;
          }
          if (r && !r.errored) {
            r.errored = err;
          }
          if (sync) {
            process.nextTick(emitErrorNT, stream, err);
          } else {
            this.emitErrorNT(stream, err);
          }
        }
      },

      emitErrorNT(self, err) {
        const r = self._readableState;
        const w = self._writableState;
        if ((w && w.errorEmitted) || (r && r.errorEmitted)) {
          return;
        }
        if (w) {
          w.errorEmitted = true;
        }
        if (r) {
          r.errorEmitted = true;
        }
        self.emit("error", err);
      },

      importFd(stream, options) {
        if (typeof options.fd === 'number') {
          // When fd is a raw descriptor, we must keep our fingers crossed
          // that the descriptor won't get closed, or worse, replaced with
          // another one
          // https://github.com/nodejs/node/issues/35862
          stream[kFs] = options.fs || fs;
          return options.fd;
        } else if (typeof options.fd === 'object' &&
          options.fd instanceof FileHandle) {
          // When fd is a FileHandle we can listen for 'close' events
          if (options.fs) {
            // FileHandle is not supported with custom fs operations
            throw new Error('FileHandle with fs');
          }
          stream[kHandle] = options.fd;
          stream[kFs] = FileHandleOperations(stream[kHandle]);
          stream[kHandle][kRef]();
          // options.fd.on('close', FunctionPrototypeBind(stream.close, stream));
          return options.fd.fd;
        }

        throw new Error("Error to find filesystem api");
      }
    };
  },
});





var utils = reader_stream_utils();

export class ReadStream extends utils.Readable {

  static kIoDone = "end";
  static kIsPerformingIO = Symbol('kIsPerformingIO');
  static kFs = "kFs";


  pending = {
    __proto__: null,
    get() { return this.fd === null; },
    configurable: true
  };

  autoClose = {
    __proto__: null,
    get() {
      return this._readableState.autoDestroy;
    },
    set(val) {
      this._readableState.autoDestroy = val;
    }
  }

  constructor(path, options) {
    if (Object.keys(options).length > 0)
      super(options);
    else
      super();

    if (options.highWaterMark === undefined)
      options.highWaterMark = 64 * 1024;

    if (options.autoDestroy === undefined) {
      options.autoDestroy = false;
    }
    if (options.autoDestroy === undefined) {
      options.autoDestroy = false;
    }
    if (options.fd == null) {
      this.fd = null;
      if (options.fs == null || options.fs == undefined)
        this[ReadStream.kFs] = import.meta.require("node:fs");

      else
        this[ReadStream.kFs] = options.fs;


      // Path will be ignored when fd is specified, so it can be falsy
      this.path = utils.toPathIfFileURL(path);
      this.flags = options.flags === undefined ? 'r' : options.flags;
      this.mode = options.mode === undefined ? 0o666 : options.mode;

      // validatePath(this.path);
    } else {
      this.fd = utils.getValidatedFd(utils.importFd(this, options));
    }

    this.start = options.start;
    this.end = options.end;
    this.pos = undefined;
    this.bytesRead = 0;

    //this.closed = false;
    if (this.start !== undefined) {
      utils.validateInteger(this.start, 'start', 0);
      this.pos = this.start;
    }

    if (this.end === undefined) {
      this.end = Infinity;
    } else if (this.end !== Infinity) {
      utils.validateInteger(this.end, 'end', 0);

      if (this.start !== undefined && this.start > this.end) {
        throw new Error(
          'start' +
          `<= "end" (here: ${this.end})` +
          this.start
        );
      }
    }
  }

  _open(callback) {
    this[ReadStream.kFs].open(this.path, this.flags, this.mode, (er, fd) => {

      if (er) {
        callback(er);
      } else {
        this.fd = fd;
        callback();
        this.emit('open', this.fd);
        this.emit('ready');
      }
    });
  }

  _construct(callback) {
    const stream = this;

    if (typeof stream.fd === 'number') {
      callback();
      return;
    }

    this._open(callback);
  }


  _read(n) {
    n = this.pos !== undefined ?
      Math.min(this.end - this.pos + 1,
        n) :
      Math.min(this.end - this.bytesRead + 1, n);

    if (n <= 0) {
      this.push(null);
      return;
    }
    let buf = Buffer.allocUnsafeSlow(n);
    this[ReadStream.kIsPerformingIO] = true;
    this[ReadStream.kFs]
      .read(this.fd, buf, 0, n, this.pos, (er, bytesRead) => {
        this[ReadStream.kIsPerformingIO] = false;

        // Tell ._destroy() that it's safe to close the fd now.
        if (this.destroyed) {
          this.emit("#kDestroy", er);
          return;
        }

        if (er) {
          utils.errorOrDestroy(this, er);
        } else if (bytesRead > 0) {
          if (this.pos !== undefined) {
            this.pos += bytesRead;
          }

          this.bytesRead += bytesRead;

          if (bytesRead !== buf.length) {
            // Slow path. Shrink to fit.
            // Copy instead of slice so that we don't retain
            // large backing buffer for small reads.
            const dst = Buffer.allocUnsafeSlow(bytesRead);
            buf.copy(dst, 0, 0, bytesRead);
            buf = dst;
          }


          this.push(buf);
        } else {
          this.push(null);
        }
      });
  }

  _destroy(err, cb) {
    if (this[ReadStream.kIsPerformingIO]) {
      this.once(ReadStream.kIoDone, (er) => close(this, err || er, cb));
    } else {
      close(this, err, cb);
    }
  }

  close(cb) {
    //TODO:
    if (typeof cb === 'function') utils.finished(this, cb);
    this.destroy();
  };
}

export var createReadStream = function (path, options = {}) {
  return new ReadStream(path, options);
}
export var createWriteStream = fs.createWriteStream.bind(fs);

export var promises = {
  access: promisify(fs.accessSync),
  appendFile: promisify(fs.appendFileSync),
  close: promisify(fs.closeSync),
  copyFile: promisify(fs.copyFileSync),
  exists: promisify(fs.existsSync),
  chown: promisify(fs.chownSync),
  chmod: promisify(fs.chmodSync),
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
  mkdir: promisify(fs.mkdirSync),
  mkdtemp: promisify(fs.mkdtempSync),
  open: promisify(fs.openSync),
  read: promisify(fs.readSync),
  write: promisify(fs.writeSync),
  readdir: promisify(fs.readdirSync),
  writeFile: promisify(fs.writeFileSync),
  readlink: promisify(fs.readlinkSync),
  realpath: promisify(fs.realpathSync),
  rename: promisify(fs.renameSync),
  stat: promisify(fs.statSync),
  symlink: promisify(fs.symlinkSync),
  truncate: promisify(fs.truncateSync),
  unlink: promisify(fs.unlinkSync),
  utimes: promisify(fs.utimesSync),
  lutimes: promisify(fs.lutimesSync),
};

promises.readFile = promises.readfile = promisify(fs.readFileSync);

// lol
realpath.native = realpath;
realpathSync.native = realpathSync;

var object = {
  access,
  appendFile,
  close,
  copyFile,
  exists,
  chown,
  chmod,
  fchmod,
  fchown,
  fstat,
  fsync,
  ftruncate,
  futimes,
  lchmod,
  lchown,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  read,
  write,
  readdir,
  readFile,
  writeFile,
  readlink,
  realpath,
  rename,
  stat,
  symlink,
  truncate,
  unlink,
  utimes,
  lutimes,
  accessSync,
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  chownSync,
  chmodSync,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  futimesSync,
  lchmodSync,
  lchownSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  writeSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  lutimesSync,
  createReadStream,
  createWriteStream,
  constants,
  promises,
};

var CJSInterop = () => object;
CJSInterop[Symbol.for("CommonJS")] = true;
export default CJSInterop;
