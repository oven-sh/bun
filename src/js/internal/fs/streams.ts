// fs.ReadStream and fs.WriteStream are lazily loaded to avoid importing 'node:stream' until required
import type { FileSink } from "bun";
const { Readable, Writable, finished } = require("node:stream");
const fs: typeof import("node:fs") = require("node:fs");
const { open, read, write, fsync, writev } = fs;
const { FileHandle, kRef, kUnref, kFd } = (fs.promises as any).$data as {
  FileHandle: { new (): FileHandle };
  readonly kRef: unique symbol;
  readonly kUnref: unique symbol;
  readonly kFd: unique symbol;
  fs: typeof fs;
};
type FileHandle = import("node:fs/promises").FileHandle & {
  on(event: any, listener: any): FileHandle;
};
type FSStream = import("node:fs").ReadStream &
  import("node:fs").WriteStream & {
    fd: number | null;
    path: string;
    flags: string;
    mode: number;
    start: number;
    end: number;
    pos: number | undefined;
    bytesRead: number;
    flush: boolean;
    open: () => void;
    autoClose: boolean;
    /**
     * true = path must be opened
     * sink = FileSink
     */
    [kWriteStreamFastPath]?: undefined | true | FileSink;
  };
type FD = number;

const { validateInteger, validateInt32, validateFunction } = require("internal/validators");

// Bun supports a fast path for `createReadStream("path.txt")` with `.pipe(res)`,
// where the entire stream implementation can be bypassed, effectively making it
// `new Response(Bun.file("path.txt"))`.
// This makes an idomatic Node.js pattern much faster.
const kReadStreamFastPath = Symbol("kReadStreamFastPath");
const kWriteStreamFastPathClosed = Symbol("kWriteStreamFastPathClosed");
const kWriteFastSimpleBuffering = Symbol("writeFastSimpleBuffering");
// Bun supports a fast path for `createWriteStream("path.txt")` where instead of
// using `node:fs`, `Bun.file(...).writer()` is used instead.
const kWriteStreamFastPath = Symbol("kWriteStreamFastPath");
const kFs = Symbol("kFs");

const {
  read: fileHandlePrototypeRead,
  write: fileHandlePrototypeWrite,
  fsync: fileHandlePrototypeFsync,
  writev: fileHandlePrototypeWritev,
} = FileHandle.prototype;

const fileHandleStreamFs = (fh: FileHandle) => ({
  // try to use the basic fs.read/write/fsync if available, since they are less
  // abstractions. however, node.js allows patching the file handle, so this has
  // to be checked for.
  read:
    fh.read === fileHandlePrototypeRead
      ? read
      : function (fd, buf, offset, length, pos, cb) {
          return fh.read(buf, offset, length, pos).then(
            ({ bytesRead, buffer }) => cb(null, bytesRead, buffer),
            err => cb(err, 0, buf),
          );
        },
  write:
    fh.write === fileHandlePrototypeWrite
      ? write
      : function (fd, buffer, offset, length, position, cb) {
          return fh.write(buffer, offset, length, position).then(
            ({ bytesWritten, buffer }) => cb(null, bytesWritten, buffer),
            err => cb(err, 0, buffer),
          );
        },
  writev: fh.writev === fileHandlePrototypeWritev ? writev : undefined,
  fsync:
    fh.sync === fileHandlePrototypeFsync
      ? fsync
      : function (fd, cb) {
          return fh.sync().then(() => cb(), cb);
        },
  close: streamFileHandleClose.bind(fh),
});

function streamFileHandleClose(this: FileHandle, fd: FD, cb: (err?: any) => void) {
  $assert(this[kFd] == fd, "fd mismatch");
  this[kUnref]();
  this.close().then(() => cb(), cb);
}

function getValidatedPath(p: any) {
  if (p instanceof URL) return Bun.fileURLToPath(p as URL);
  if (typeof p !== "string") throw $ERR_INVALID_ARG_TYPE("path", "string or URL", p);
  return require("node:path").resolve(p);
}

function copyObject(source) {
  const target = {};
  // Node tests for prototype lookups, so { ...source } will not work.
  for (const key in source) target[key] = source[key];
  return target;
}

function getStreamOptions(options, defaultOptions = {}) {
  if (options == null || typeof options === "function") {
    return defaultOptions;
  }

  if (typeof options === "string") {
    if (options !== "buffer" && !Buffer.isEncoding(options)) {
      throw $ERR_INVALID_ARG_VALUE("encoding", options, "is invalid encoding");
    }
    return { encoding: options };
  } else if (typeof options !== "object") {
    throw $ERR_INVALID_ARG_TYPE("options", ["string", "Object"], options);
  }

  let { encoding, signal = true } = options;
  if (encoding && encoding !== "buffer" && !Buffer.isEncoding(encoding)) {
    throw $ERR_INVALID_ARG_VALUE("encoding", encoding, "is invalid encoding");
  }

  // There is a real AbortSignal validation later but it doesnt catch falsy primatives.
  if (signal !== true && !signal) {
    throw $ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
  }

  return options;
}

function ReadStream(this: FSStream, path, options): void {
  if (!(this instanceof ReadStream)) {
    return new ReadStream(path, options);
  }

  options = copyObject(getStreamOptions(options));

  // Only buffers are supported.
  options.decodeStrings = true;

  let { fd, autoClose, fs: customFs, start = 0, end = Infinity, encoding } = options;
  if (fd == null) {
    this[kFs] = customFs || fs;
    this.fd = null;
    this.path = getValidatedPath(path);
    const { flags, mode } = options;
    this.flags = flags === undefined ? "r" : flags;
    this.mode = mode === undefined ? 0o666 : mode;
    if (customFs) {
      validateFunction(customFs.open, "options.fs.open");
    }
  } else if (typeof options.fd === "number") {
    // When fd is a raw descriptor, we must keep our fingers crossed
    // that the descriptor won't get closed, or worse, replaced with
    // another one
    // https://github.com/nodejs/node/issues/35862
    if (Object.is(fd, -0)) {
      fd = 0;
    } else {
      validateInt32(fd, "fd", 0, 2147483647);
    }
    this.fd = fd;
    this[kFs] = customFs || fs;
  } else if (typeof fd === "object" && fd instanceof FileHandle) {
    if (options.fs) {
      throw $ERR_METHOD_NOT_IMPLEMENTED("fs.FileHandle with custom fs operations");
    }
    this[kFs] = fileHandleStreamFs(fd);
    this.fd = fd[kFd];
    fd[kRef]();
    fd.on("close", this.close.bind(this));
  } else {
    throw $ERR_INVALID_ARG_TYPE("options.fd", "number or FileHandle", fd);
  }

  if (customFs) {
    validateFunction(customFs.read, "options.fs.read");
  }

  $assert(this[kFs], "fs implementation was not assigned");

  if ((options.autoDestroy = autoClose === undefined ? true : autoClose) && customFs) {
    validateFunction(customFs.close, "options.fs.close");
  }

  this.start = start;
  this.end = end;
  this.pos = undefined;
  this.bytesRead = 0;

  if (start !== undefined) {
    validateInteger(start, "start", 0);
    this.pos = start;
  }

  if (end === undefined) {
    end = Infinity;
  } else if (end !== Infinity) {
    validateInteger(end, "end", 0);
    if (start !== undefined && start > end) {
      throw $ERR_OUT_OF_RANGE("start", `<= "end" (here: ${end})`, start);
    }
  }

  this[kReadStreamFastPath] =
    start === 0 &&
    end === Infinity &&
    autoClose &&
    !customFs &&
    // is it an encoding which we don't need to decode?
    (encoding === "buffer" || encoding === "binary" || encoding == null || encoding === "utf-8" || encoding === "utf8");
  Readable.$call(this, options);
  return this as unknown as void;
}
$toClass(ReadStream, "ReadStream", Readable);
const readStreamPrototype = ReadStream.prototype;

Object.defineProperty(readStreamPrototype, "autoClose", {
  get() {
    return this._readableState.autoDestroy;
  },
  set(val) {
    this._readableState.autoDestroy = val;
  },
});

const streamNoop = function open() {
  // noop
};
function streamConstruct(this: FSStream, callback: (e?: any) => void) {
  const { fd } = this;
  if (typeof fd === "number") {
    callback();
    return;
  }
  const fastPath = this[kWriteStreamFastPath];
  if (this.open !== streamNoop) {
    // if (fastPath) {
    //   // disable fast path in this case
    //   $assert(this[kWriteStreamFastPath] === true, "fastPath is not true");
    //   this[kWriteStreamFastPath] = undefined;
    // }

    // Backwards compat for monkey patching open().
    const orgEmit: any = this.emit;
    this.emit = function (...args) {
      if (args[0] === "open") {
        this.emit = orgEmit;
        callback();
        orgEmit.$apply(this, args);
      } else if (args[0] === "error") {
        this.emit = orgEmit;
        callback(args[1]);
      } else {
        orgEmit.$apply(this, args);
      }
    } as any;
    this.open();
  } else {
    if (fastPath) {
      // // there is a chance that this fd is not actually correct but it will be a number
      // if (fastPath !== true) {
      //   // @ts-expect-error undocumented. to make this public please make it a
      //   // getter. couldn't figure that out sorry
      //   this.fd = fastPath._getFd();
      // } else {
      //   if (fs.open !== open || fs.write !== write || fs.fsync !== fsync || fs.close !== close) {
      //     this[kWriteStreamFastPath] = undefined;
      //     break fast;
      //   }
      //   // @ts-expect-error
      //   this.fd = (this[kWriteStreamFastPath] = Bun.file(this.path).writer())._getFd();
      // }
      callback();
      this.emit("open", this.fd);
      this.emit("ready");
      return;
    }

    this[kFs].open(this.path, this.flags, this.mode, (err, fd) => {
      if (err) {
        callback(err);
      } else {
        this.fd = fd;
        callback();
        this.emit("open", this.fd);
        this.emit("ready");
      }
    });
  }
}

readStreamPrototype.open = streamNoop;

readStreamPrototype._construct = streamConstruct;

readStreamPrototype._read = function (n) {
  n = this.pos !== undefined ? $min(this.end - this.pos + 1, n) : $min(this.end - this.bytesRead + 1, n);

  if (n <= 0) {
    this.push(null);
    return;
  }

  const buf = Buffer.allocUnsafeSlow(n);

  this[kFs].read(this.fd, buf, 0, n, this.pos, (er, bytesRead, buf) => {
    if (er) {
      require("internal/streams/destroy").errorOrDestroy(this, er);
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
};

readStreamPrototype._destroy = function (this: FSStream, err, cb) {
  // Usually for async IO it is safe to close a file descriptor
  // even when there are pending operations. However, due to platform
  // differences file IO is implemented using synchronous operations
  // running in a thread pool. Therefore, file descriptors are not safe
  // to close while used in a pending read or write operation. Wait for
  // any pending IO (kIsPerformingIO) to complete (kIoDone).
  if (this[kReadStreamFastPath]) {
    this.once(kReadStreamFastPath, er => close(this, err || er, cb));
  } else {
    close(this, err, cb);
  }
};

readStreamPrototype.close = function (cb) {
  if (typeof cb === "function") finished(this, cb);
  this.destroy();
};

Object.defineProperty(readStreamPrototype, "pending", {
  get() {
    return this.fd == null;
  },
  configurable: true,
});

function close(stream, err, cb) {
  const fastPath: FileSink | true = stream[kWriteStreamFastPath];
  if (fastPath && fastPath !== true) {
    stream.fd = null;
    const maybePromise = fastPath.end(err);
    thenIfPromise(maybePromise, () => {
      cb(err);
    });
    return;
  }

  if (!stream.fd) {
    cb(err);
  } else if (stream.flush) {
    stream[kFs].fsync(stream.fd, flushErr => {
      closeAfterSync(stream, err || flushErr, cb);
    });
  } else {
    closeAfterSync(stream, err, cb);
  }
}

function closeAfterSync(stream, err, cb) {
  stream[kFs].close(stream.fd, er => {
    cb(er || err);
  });
  stream.fd = null;
}

ReadStream.prototype.pipe = function (this: FSStream, dest, pipeOpts) {
  // Fast path for streaming files:
  // if (this[kReadStreamFastPath]) {
  // }
  return Readable.prototype.pipe.$call(this, dest, pipeOpts);
};

function WriteStream(this: FSStream, path: string | null, options?: any): void {
  if (!(this instanceof WriteStream)) {
    return new WriteStream(path, options);
  }

  let fastPath = options?.$fastPath;

  options = copyObject(getStreamOptions(options));

  // Only buffers are supported.
  options.decodeStrings = true;

  let { fd, autoClose, fs: customFs, start, flush } = options;
  if (fd == null) {
    this[kFs] = customFs || fs;
    this.fd = null;
    this.path = getValidatedPath(path);
    const { flags, mode } = options;
    this.flags = flags === undefined ? "w" : flags;
    this.mode = mode === undefined ? 0o666 : mode;
    if (customFs) {
      validateFunction(customFs.open, "options.fs.open");
    }
  } else if (typeof options.fd === "number") {
    // When fd is a raw descriptor, we must keep our fingers crossed
    // that the descriptor won't get closed, or worse, replaced with
    // another one
    // https://github.com/nodejs/node/issues/35862
    if (Object.is(fd, -0)) {
      fd = 0;
    } else {
      validateInt32(fd, "fd", 0, 2147483647);
    }
    this.fd = fd;
    this[kFs] = customFs || fs;
  } else if (typeof fd === "object" && fd instanceof FileHandle) {
    if (options.fs) {
      throw $ERR_METHOD_NOT_IMPLEMENTED("fs.FileHandle with custom fs operations");
    }
    this[kFs] = customFs = fileHandleStreamFs(fd);
    fd[kRef]();
    fd.on("close", this.close.bind(this));
    this.fd = fd = fd[kFd];
  } else {
    throw $ERR_INVALID_ARG_TYPE("options.fd", "number or FileHandle", fd);
  }

  const autoDestroy = (autoClose = options.autoDestroy = autoClose === undefined ? true : autoClose);

  if (customFs) {
    const { write, writev, close, fsync } = customFs;
    if (write) validateFunction(write, "options.fs.write");
    if (writev) validateFunction(writev, "options.fs.writev");
    if (autoDestroy) validateFunction(close, "options.fs.close");
    if (flush) validateFunction(fsync, "options.fs.fsync");
    if (!write && !writev) {
      throw $ERR_INVALID_ARG_TYPE("options.fs.write", "function", write);
    }
  } else {
    this._writev = undefined;
    $assert(this[kFs].write, "assuming user does not delete fs.write!");
  }

  if (flush == null) {
    this.flush = false;
  } else {
    if (typeof flush !== "boolean") throw $ERR_INVALID_ARG_TYPE("options.flush", "boolean", flush);
    this.flush = flush;
  }

  this.start = start;
  this.pos = undefined;
  this.bytesWritten = 0;

  if (start !== undefined) {
    validateInteger(start, "start", 0);
    this.pos = start;
  }

  // Enable fast path
  if (fastPath) {
    this[kWriteStreamFastPath] = fd ? Bun.file(fd).writer() : true;
    this._write = underscoreWriteFast;
    this._writev = undefined;
    this.write = writeFast as any;
  }

  Writable.$call(this, options);

  if (options.encoding) {
    this.setDefaultEncoding(options.encoding);
  }
  return this as unknown as void;
}
$toClass(WriteStream, "WriteStream", Writable);
const writeStreamPrototype = WriteStream.prototype;

writeStreamPrototype.open = streamNoop;
writeStreamPrototype._construct = streamConstruct;

function writeAll(data, size, pos, cb, retries = 0) {
  this[kFs].write(this.fd, data, 0, size, pos, (er, bytesWritten, buffer) => {
    // No data currently available and operation should be retried later.
    if (er?.code === "EAGAIN") {
      er = null;
      bytesWritten = 0;
    }

    if (this.destroyed || er) {
      return cb(er || $ERR_STREAM_DESTROYED("write"));
    }

    this.bytesWritten += bytesWritten;

    retries = bytesWritten ? 0 : retries + 1;
    size -= bytesWritten;
    pos += bytesWritten;

    // Try writing non-zero number of bytes up to 5 times.
    if (retries > 5) {
      // cb($ERR_SYSTEM_ERROR('write failed'));
      cb(new Error("write failed"));
    } else if (size) {
      writeAll.$call(this, buffer.slice(bytesWritten), size, pos, cb, retries);
    } else {
      cb();
    }
  });
}

function writevAll(chunks, size, pos, cb, retries = 0) {
  this[kFs].writev(this.fd, chunks, this.pos, (er, bytesWritten, buffers) => {
    // No data currently available and operation should be retried later.
    if (er?.code === "EAGAIN") {
      er = null;
      bytesWritten = 0;
    }

    if (this.destroyed || er) {
      return cb(er || $ERR_STREAM_DESTROYED("writev"));
    }

    this.bytesWritten += bytesWritten;

    retries = bytesWritten ? 0 : retries + 1;
    size -= bytesWritten;
    pos += bytesWritten;

    // Try writing non-zero number of bytes up to 5 times.
    if (retries > 5) {
      // cb($ERR_SYSTEM_ERROR('writev failed'));
      cb(new Error("writev failed"));
    } else if (size) {
      writevAll.$call(this, [Buffer.concat(buffers).slice(bytesWritten)], size, pos, cb, retries);
    } else {
      cb();
    }
  });
}

function _write(data, encoding, cb) {
  const fileSink = this[kWriteStreamFastPath];

  if (fileSink && fileSink !== true) {
    const maybePromise = fileSink.write(data);
    if ($isPromise(maybePromise)) {
      maybePromise
        .then(() => {
          this.emit("drain"); // Emit drain event
          cb(null);
        })
        .catch(cb);
      return false; // Indicate backpressure
    } else {
      cb(null);
      return true; // No backpressure
    }
  } else {
    writeAll.$call(this, data, data.length, this.pos, er => {
      if (this.destroyed) {
        cb(er);
        return;
      }
      cb(er);
    });

    if (this.pos !== undefined) this.pos += data.length;
    // Don't return anything for legacy path - matches Node.js behavior
  }
}
writeStreamPrototype._write = _write;

function underscoreWriteFast(this: FSStream, data: any, encoding: any, cb: any) {
  let fileSink = this[kWriteStreamFastPath];
  if (!fileSink) {
    // When the fast path is disabled, the write function gets reset.
    this._write = _write;
    return this._write(data, encoding, cb);
  }
  try {
    if (fileSink === true) {
      fileSink = this[kWriteStreamFastPath] = Bun.file(this.path).writer();
      // @ts-expect-error
      this.fd = fileSink._getFd();
    }

    const maybePromise = fileSink.write(data);
    if ($isPromise(maybePromise)) {
      maybePromise.then(() => {
        cb(null);
        this.emit("drain");
      }, cb);
      return false;
    } else {
      if (cb) process.nextTick(cb, null);
      return true;
    }
  } catch (e) {
    if (cb) process.nextTick(cb, e);
    return false;
  }
}

// This function implementation is not correct.
const writablePrototypeWrite = Writable.prototype.write;
const kWriteMonkeyPatchDefense = Symbol("!");
function writeFast(this: FSStream, data: any, encoding: any, cb: any) {
  if (this[kWriteMonkeyPatchDefense]) return writablePrototypeWrite.$call(this, data, encoding, cb);

  if (typeof encoding === "function") {
    cb = encoding;
    encoding = undefined;
  }
  if (typeof cb !== "function") {
    cb = streamNoop;
  }

  const fileSink = this[kWriteStreamFastPath];
  if (fileSink && fileSink !== true) {
    const maybePromise = fileSink.write(data);
    if ($isPromise(maybePromise)) {
      maybePromise
        .then(() => {
          this.emit("drain"); // Emit drain event
          cb(null);
        })
        .catch(cb);
      return false; // Indicate backpressure
    } else {
      cb(null);
      return true; // No backpressure
    }
  } else {
    const result: any = this._write(data, encoding, cb);
    if (this.write === writeFast) {
      this.write = writablePrototypeWrite;
    } else {
      this[kWriteMonkeyPatchDefense] = true;
    }
    return result;
  }
}

writeStreamPrototype._writev = function (data, cb) {
  const len = data.length;
  const chunks = new Array(len);
  let size = 0;

  for (let i = 0; i < len; i++) {
    const chunk = data[i].chunk;
    chunks[i] = chunk;
    size += chunk.length;
  }

  const fileSink = this[kWriteStreamFastPath];
  if (fileSink && fileSink !== true) {
    const maybePromise = fileSink.write(Buffer.concat(chunks));
    if ($isPromise(maybePromise)) {
      maybePromise
        .then(() => {
          this.emit("drain");
          cb(null);
        })
        .catch(cb);
      return false;
    } else {
      cb(null);
      return true;
    }
  } else {
    writevAll.$call(this, chunks, size, this.pos, er => {
      if (this.destroyed) {
        cb(er);
        return;
      }
      cb(er);
    });

    if (this.pos !== undefined) this.pos += size;
    // Don't return anything for legacy path - matches Node.js behavior
  }
};

writeStreamPrototype._destroy = function (err, cb) {
  const sink = this[kWriteStreamFastPath];
  if (sink && sink !== true) {
    const end = sink.end(err);
    if ($isPromise(end)) {
      end.then(() => cb(err), cb);
      return;
    }
  }
  close(this, err, cb);
};

writeStreamPrototype.close = function (this: FSStream, cb) {
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

// There is no shutdown() for files.
writeStreamPrototype.destroySoon = writeStreamPrototype.end;

Object.defineProperty(writeStreamPrototype, "autoClose", {
  get() {
    return this._writableState.autoDestroy;
  },
  set(val) {
    this._writableState.autoDestroy = val;
  },
});

Object.defineProperty(writeStreamPrototype, "pending", {
  get() {
    return this.fd === null;
  },
  configurable: true,
});

function thenIfPromise<T>(maybePromise: Promise<T> | T, cb: any) {
  $assert(typeof cb === "function", "cb is not a function");
  if ($isPromise(maybePromise)) {
    maybePromise.then(() => cb(null), cb);
  } else {
    process.nextTick(cb, null);
  }
}

function writableFromFileSink(fileSink: any) {
  $assert(typeof fileSink === "object", "fileSink is not an object");
  $assert(typeof fileSink.write === "function", "fileSink.write is not a function");
  $assert(typeof fileSink.end === "function", "fileSink.end is not a function");
  const w = new WriteStream("", { $fastPath: true });
  $assert(w[kWriteStreamFastPath] === true, "fast path not enabled");
  w[kWriteStreamFastPath] = fileSink;
  w.path = undefined;
  return w;
}

export default {
  ReadStream,
  WriteStream,
  kWriteStreamFastPath,
  writableFromFileSink,
};
