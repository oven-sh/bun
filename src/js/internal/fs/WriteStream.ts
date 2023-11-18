const { write, close, open, openSync } = require("node:fs");
const { NativeWritable } = require("node:stream");
var writeStreamPathFastPathCallSymbol = Symbol.for("Bun.NodeWriteStreamFastPathCall");
const writeStreamSymbol = Symbol.for("Bun.NodeWriteStream");
const { kIoDone, writeStreamPathFastSymbol: _writeStreamPathFastPathSymbol } = require("internal/symbols");
const _fs = Symbol("fs");
var WriteStream;
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
  if (fd != null) {
    if (typeof fd !== "number") {
      throw new Error("Expected options.fd to be a number");
    }
    tempThis.fd = fd;
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
  var fd = this.fd;
  this[_fs].close(fd, er => {
    this.fd = null;
    cb(err || er);
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
    return cb(err);
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

WriteStreamPrototype._destroy = function _destroy(err, cb) {
  this.close(err, cb);
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

export default {
  WriteStream: WriteStreamClass,
};
