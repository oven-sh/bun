// fs.ReadStream and fs.WriteStream are lazily loaded to avoid importing 'node:stream' until required
const { Readable, Writable, finished } = require("node:stream");
const fs = require("node:fs");
const { read, write, fsync, writev } = fs;
const fileHandleInternals = fs.promises.$data;
const FileHandle = fileHandleInternals.FileHandle;
const kRef: typeof fileHandleInternals.kRef = fileHandleInternals.kRef;
const kUnref: typeof fileHandleInternals.kUnref = fileHandleInternals.kUnref;
const kFd: typeof fileHandleInternals.kFd = fileHandleInternals.kFd;
type FileHandle = $Node.FileHandle;
type FileSink = $Node.FileSink;
type FD = number;
type ErrorCallback = (error?: Error | null) => void;

/** `node:fs`, the `fs` option of a stream, or the operations of a `FileHandle`. */
interface StreamFs {
  open?(
    path: string | null | undefined,
    flags: string | number,
    mode: number,
    callback: (error: Error | null, fd?: number) => void,
  ): void;
  read?(
    fd: number | null,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | undefined,
    callback: (error: Error | null, bytesRead?: number, buffer?: Buffer) => void,
  ): void;
  write?(
    fd: number | null,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | undefined,
    callback: (error: Error | null, bytesWritten?: number, buffer?: Buffer) => void,
  ): void;
  writev?(
    fd: number | null,
    buffers: Buffer[],
    position: number | undefined,
    callback: (error: Error | null, bytesWritten?: number, buffers?: Buffer[]) => void,
  ): void;
  fsync?(fd: number, callback: ErrorCallback): void;
  close?(fd: number, callback: ErrorCallback): void;
}

interface FileStreamOptions extends $Node.ReadableOptions, $Node.WritableOptions {
  fd?: number | FileHandle | null;
  fs?: StreamFs | null;
  flags?: string | number;
  mode?: number;
  autoClose?: boolean;
  start?: number;
  end?: number;
  flush?: boolean | null;
  $fastPath?: boolean;
}

declare global {
  namespace $Node {
    /** What `fs.ReadStream` and `fs.WriteStream` share. */
    interface FileStreamFields {
      fd: number | null;
      // null / undefined only for the internal fast-path WriteStream, which is given a FileSink and no path.
      path: string | null | undefined;
      flags: string | number;
      mode: number;
      start: number | undefined;
      pos: number | undefined;
      autoClose: boolean;
      readonly pending: boolean;
      flush?: boolean;
      open(): void;
      close(callback?: ErrorCallback): void;
      [kFs]: StreamFs;
      [kIsPerformingIO]: boolean;
      /** true: the path must be opened; a sink: a FileSink. */
      [kWriteStreamFastPath]?: undefined | true | FileSink;
    }

    interface ReadStream extends Readable, FileStreamFields {
      end: number;
      bytesRead: number;
    }

    interface WriteStream extends Writable, FileStreamFields {
      flush: boolean;
      bytesWritten: number;
      destroySoon: Writable["end"];
      [kWriteMonkeyPatchDefense]?: boolean;
    }
  }
}
type FileStream = $Node.ReadStream | $Node.WriteStream;

const { validateInteger, validateInt32, validateFunction } = require("internal/validators");

const kIsPerformingIO = Symbol("kIsPerformingIO");
const kIoDone = Symbol("kIoDone");
// Bun supports a fast path for `createWriteStream("path.txt")` where instead of
// using `node:fs`, `Bun.file(...).writer()` is used instead.
const kWriteStreamFastPath = Symbol("kWriteStreamFastPath");
const kFs = Symbol("kFs");

const {
  read: fileHandlePrototypeRead,
  write: fileHandlePrototypeWrite,
  fsync: fileHandlePrototypeFsync,
  writev: fileHandlePrototypeWritev,
} = FileHandle.prototype as FileHandle & { fsync?: undefined };

const fileHandleStreamFs = (fh: FileHandle) => ({
  // try to use the basic fs.read/write/fsync if available, since they are less
  // abstractions. however, node.js allows patching the file handle, so this has
  // to be checked for.
  read:
    fh.read === fileHandlePrototypeRead
      ? read
      : function (
          fd: number | null,
          buf: Buffer,
          offset: number,
          length: number,
          pos: number | undefined,
          cb: (error: Error | null, bytesRead?: number, buffer?: Buffer) => void,
        ) {
          return fh.read(buf, offset, length, pos).then(
            ({ bytesRead, buffer }) => cb(null, bytesRead, buffer),
            err => cb(err, 0, buf),
          );
        },
  write:
    fh.write === fileHandlePrototypeWrite
      ? write
      : function (
          fd: number | null,
          buffer: Buffer,
          offset: number,
          length: number,
          position: number | undefined,
          cb: (error: Error | null, bytesWritten?: number, buffer?: Buffer) => void,
        ) {
          return fh.write(buffer, offset, length, position).then(
            ({ bytesWritten, buffer }) => cb(null, bytesWritten, buffer),
            err => cb(err, 0, buffer),
          );
        },
  writev: fh.writev === fileHandlePrototypeWritev ? writev : undefined,
  fsync:
    fh.sync === fileHandlePrototypeFsync
      ? fsync
      : function (fd: number, cb: ErrorCallback) {
          return fh.sync().then(() => cb(), cb);
        },
  close: streamFileHandleClose.bind(fh),
});

function streamFileHandleClose(this: FileHandle, fd: FD, cb: ErrorCallback) {
  $assert(this[kFd] == fd, "fd mismatch");
  this[kUnref]();
  this.close().then(() => cb(), cb);
}

function getValidatedPath(p: string | URL | null | undefined): string {
  if (p instanceof URL) return Bun.fileURLToPath(p);
  if (typeof p !== "string") throw $ERR_INVALID_ARG_TYPE("path", "string or URL", p);
  return require("node:path").resolve(p);
}

function copyObject<T extends object>(source: T): T {
  const target = {} as T;
  // Node tests for prototype lookups, so { ...source } will not work.
  for (const key in source) target[key] = source[key];
  return target;
}

function getStreamOptions(
  options: FileStreamOptions | string | null | undefined,
  defaultOptions: FileStreamOptions = {},
): FileStreamOptions {
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

function ReadStream(
  this: $Node.ReadStream,
  path: string | URL | null | undefined,
  options?: FileStreamOptions | string | null,
): void {
  if (!(this instanceof ReadStream)) {
    return new ReadStream(path, options) as any;
  }

  options = copyObject(getStreamOptions(options));

  // Only buffers are supported.
  options.decodeStrings = true;

  let { fd, autoClose, fs: customFs, start, end = Infinity } = options;

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
    this.fd = fd as number;
    this[kFs] = customFs || fs;
  } else if (typeof fd === "object" && fd instanceof FileHandle) {
    if (options.fs) {
      throw $ERR_METHOD_NOT_IMPLEMENTED("FileHandle with fs");
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

  Readable.$call(this, options);
  return this as unknown as void;
}
$toClass(ReadStream, "ReadStream", Readable);
const readStreamPrototype = ReadStream.prototype;

Object.defineProperty(readStreamPrototype, "autoClose", {
  get(this: $Node.ReadStream) {
    return this._readableState.autoDestroy;
  },
  set(this: $Node.ReadStream, val: boolean) {
    this._readableState.autoDestroy = val;
  },
});

const streamNoop = function open() {
  // noop
};
function streamConstruct(this: FileStream, callback: ErrorCallback) {
  const { fd } = this;
  if (typeof fd === "number") {
    callback();
    return;
  }
  const fastPath = this[kWriteStreamFastPath];
  if (this.open !== streamNoop) {
    // Backwards compat for monkey patching open().
    const orgEmit = this.emit;
    this.emit = function (this: FileStream, ...args: [type: $Node.EventName, ...args: unknown[]]) {
      if (args[0] === "open") {
        this.emit = orgEmit;
        callback();
        orgEmit.$apply(this, args);
      } else if (args[0] === "error") {
        this.emit = orgEmit;
        callback(args[1] as Error);
      } else {
        orgEmit.$apply(this, args);
      }
    } as typeof orgEmit;
    this.open();
  } else {
    if (fastPath) {
      callback();
      this.emit("open", this.fd);
      this.emit("ready");
      return;
    }

    this[kFs].open!(this.path, this.flags, this.mode, (err, fd) => {
      if (err) {
        callback(err);
      } else {
        this.fd = fd!;
        callback();
        this.emit("open", this.fd);
        this.emit("ready");
      }
    });
  }
}

readStreamPrototype.open = streamNoop;

readStreamPrototype._construct = streamConstruct;

readStreamPrototype._read = function (this: $Node.ReadStream, n: number) {
  n = this.pos !== undefined ? $min(this.end - this.pos + 1, n) : $min(this.end - this.bytesRead + 1, n);

  if (n <= 0) {
    this.push(null);
    return;
  }

  const buf = Buffer.allocUnsafeSlow(n);

  this[kIsPerformingIO] = true;
  this[kFs].read!(this.fd, buf, 0, n, this.pos, (er, bytesRead, buf) => {
    this[kIsPerformingIO] = false;

    // Tell ._destroy() that it's safe to close the fd now.
    if (this.destroyed) {
      this.emit(kIoDone, er);
      return;
    }

    if (er) {
      require("internal/streams/destroy").errorOrDestroy(this as $Node.Readable, er);
    } else if (bytesRead! > 0) {
      if (this.pos !== undefined) {
        this.pos += bytesRead!;
      }

      this.bytesRead += bytesRead!;

      if (bytesRead !== buf!.length) {
        // Slow path. Shrink to fit.
        // Copy instead of slice so that we don't retain
        // large backing buffer for small reads.
        const dst = Buffer.allocUnsafeSlow(bytesRead!);
        buf!.copy(dst, 0, 0, bytesRead);
        buf = dst;
      }

      this.push(buf);
    } else {
      this.push(null);
    }
  });
};

readStreamPrototype._destroy = function (this: $Node.ReadStream, err: Error | null, cb: ErrorCallback) {
  // Usually for async IO it is safe to close a file descriptor
  // even when there are pending operations. However, due to platform
  // differences file IO is implemented using synchronous operations
  // running in a thread pool. Therefore, file descriptors are not safe
  // to close while used in a pending read or write operation. Wait for
  // any pending IO (kIsPerformingIO) to complete (kIoDone).
  if (this[kIsPerformingIO]) {
    this.once(kIoDone, (er: Error | null) => close(this, err || er, cb));
  } else {
    close(this, err, cb);
  }
};

readStreamPrototype.close = function (this: $Node.ReadStream, cb?: ErrorCallback) {
  if (typeof cb === "function") finished(this as $Node.Readable, cb);
  this.destroy();
};

Object.defineProperty(readStreamPrototype, "pending", {
  get(this: $Node.ReadStream) {
    return this.fd == null;
  },
  configurable: true,
});

function close(stream: FileStream, err: Error | null | undefined, cb: ErrorCallback) {
  const fastPath = stream[kWriteStreamFastPath];
  if (fastPath && fastPath !== true) {
    stream.fd = null;
    const maybePromise = fastPath.end(err!);
    thenIfPromise(maybePromise, () => {
      cb(err);
    });
    return;
  }

  if (!stream.fd) {
    cb(err);
  } else if (stream.flush) {
    stream[kFs].fsync!(stream.fd, flushErr => {
      closeAfterSync(stream, err || flushErr, cb);
    });
  } else {
    closeAfterSync(stream, err, cb);
  }
}

function closeAfterSync(stream: FileStream, err: Error | null | undefined, cb: ErrorCallback) {
  stream[kFs].close!(stream.fd!, er => {
    cb(er || err);
  });
  stream.fd = null;
}

function WriteStream(
  this: $Node.WriteStream,
  path: string | URL | null | undefined,
  options?: FileStreamOptions | string | null,
): void {
  if (!(this instanceof WriteStream)) {
    return new WriteStream(path, options) as any;
  }

  let fastPath = (options as FileStreamOptions | null | undefined)?.$fastPath;

  options = copyObject(getStreamOptions(options));

  // Only buffers are supported.
  options.decodeStrings = true;

  let { fd, autoClose, fs: customFs, start, flush } = options;
  if (fd == null) {
    this[kFs] = customFs || fs;
    this.fd = null;
    // Internal $fastPath callers (writableFromFileSink) discard .path; do not
    // resolve it - path.resolve("") needs process.cwd(), which throws when
    // the cwd has been deleted (Node still spawns children in that state).
    this.path = fastPath ? (path as string | null | undefined) : getValidatedPath(path);
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
    this.fd = fd as number;
    this[kFs] = customFs || fs;
  } else if (typeof fd === "object" && fd instanceof FileHandle) {
    if (options.fs) {
      throw $ERR_METHOD_NOT_IMPLEMENTED("FileHandle with fs");
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
    // It's enough to override either, in which case only one will be used.
    if (!write) this._write = null!;
    if (!writev) this._writev = null!;
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
  this[kIsPerformingIO] = false;

  if (start !== undefined) {
    validateInteger(start, "start", 0);
    this.pos = start;
  }

  // A writer cannot be opened for every fd a caller may hand us -- a read-only
  // descriptor is the common case, and node's tty.WriteStream accepts one. Fall
  // back to the general path there, which surfaces the failure at write time the
  // way node does, rather than throwing from the constructor.
  let fastWriter: FileSink | undefined;
  if (fastPath && fd != null) {
    try {
      fastWriter = Bun.file(fd as number).writer() as FileSink;
    } catch {
      fastPath = false;
    }
  }

  // Enable fast path
  if (fastPath) {
    this[kWriteStreamFastPath] = fd != null ? fastWriter : true;
    this._write = underscoreWriteFast;
    this._writev = undefined;
    this.write = writeFast;
    this._final = finalFast;
    if (fd != null) {
      // Already-open fd (stdio): skip the async _construct round-trip so the
      // stream is born constructed, like node's stdio streams (net.Socket /
      // tty.WriteStream), which never allocate construct TickObjects.
      this._construct = undefined;
    }
  }

  Writable.$call(this, options);

  const encoding = options.encoding;
  if (encoding) {
    this.setDefaultEncoding(encoding);
  }
  return this as unknown as void;
}
$toClass(WriteStream, "WriteStream", Writable);
const writeStreamPrototype = WriteStream.prototype;

writeStreamPrototype.open = streamNoop;
writeStreamPrototype._construct = streamConstruct;

function writeAll(
  this: $Node.WriteStream,
  data: Buffer,
  size: number,
  pos: number | undefined,
  cb: ErrorCallback,
  retries = 0,
) {
  this[kFs].write!(this.fd, data, 0, size, pos, (er, bytesWritten, buffer) => {
    // No data currently available and operation should be retried later.
    if (er?.code === "EAGAIN") {
      er = null;
      bytesWritten = 0;
    }

    if (this.destroyed || er) {
      return cb(er || $ERR_STREAM_DESTROYED("write"));
    }

    this.bytesWritten += bytesWritten!;

    retries = bytesWritten ? 0 : retries + 1;
    size -= bytesWritten!;
    if (pos !== undefined) pos += bytesWritten!;

    // Try writing non-zero number of bytes up to 5 times.
    if (retries > 5) {
      // cb($ERR_SYSTEM_ERROR('write failed'));
      cb(new Error("write failed"));
    } else if (size) {
      writeAll.$call(this, buffer!.slice(bytesWritten), size, pos, cb, retries);
    } else {
      cb();
    }
  });
}

function writevAll(
  this: $Node.WriteStream,
  chunks: Buffer[],
  size: number,
  pos: number | undefined,
  cb: ErrorCallback,
  retries = 0,
) {
  this[kFs].writev!(this.fd, chunks, this.pos, (er, bytesWritten, buffers) => {
    // No data currently available and operation should be retried later.
    if (er?.code === "EAGAIN") {
      er = null;
      bytesWritten = 0;
    }

    if (this.destroyed || er) {
      return cb(er || $ERR_STREAM_DESTROYED("writev"));
    }

    this.bytesWritten += bytesWritten!;

    retries = bytesWritten ? 0 : retries + 1;
    size -= bytesWritten!;
    pos! += bytesWritten!;

    // Try writing non-zero number of bytes up to 5 times.
    if (retries > 5) {
      // cb($ERR_SYSTEM_ERROR('writev failed'));
      cb(new Error("writev failed"));
    } else if (size) {
      writevAll.$call(this, [(Buffer.concat(buffers!) as Buffer).slice(bytesWritten)], size, pos, cb, retries);
    } else {
      cb();
    }
  });
}

// Like Writable's afterWrite: no 'drain' once the stream is ending or destroyed.
function emitDrain(stream: $Node.WriteStream) {
  const state = stream._writableState;
  if (state === undefined || !(state.ending || state.destroyed)) {
    stream.emit("drain");
  }
}

function _write(this: $Node.WriteStream, data: Buffer, encoding: string, cb: ErrorCallback) {
  const fileSink = this[kWriteStreamFastPath];

  if (fileSink && fileSink !== true) {
    const maybePromise = fileSink.write(data);
    if ($isPromise(maybePromise)) {
      maybePromise
        .then(() => {
          emitDrain(this);
          cb(null);
        })
        .catch(cb);
      return false; // Indicate backpressure
    } else {
      cb(null);
      return true; // No backpressure
    }
  } else {
    this[kIsPerformingIO] = true;
    writeAll.$call(this, data, data.length, this.pos, er => {
      this[kIsPerformingIO] = false;
      if (this.destroyed) {
        // Tell ._destroy() that it's safe to close the fd now.
        cb(er);
        return this.emit(kIoDone, er);
      }
      cb(er);
    });

    if (this.pos !== undefined) this.pos += data.length;
    // Don't return anything for legacy path - matches Node.js behavior
  }
}
writeStreamPrototype._write = _write;

function underscoreWriteFast(this: $Node.WriteStream, data: Buffer, encoding: string, cb: ErrorCallback) {
  let fileSink = this[kWriteStreamFastPath];
  if (!fileSink) {
    // When the fast path is disabled, the write function gets reset.
    this._write = _write;
    return this._write(data, encoding, cb);
  }
  try {
    if (fileSink === true) {
      fileSink = this[kWriteStreamFastPath] = Bun.file(this.path!).writer() as FileSink;
      this.fd = fileSink._getFd();
    }

    const maybePromise = fileSink.write(data);
    if ($isPromise(maybePromise)) {
      maybePromise.then(
        () => {
          if (cb) cb(null);
          emitDrain(this);
        },
        err => {
          if (cb) cb(err);
          require("internal/streams/destroy").errorOrDestroy(this, err);
        },
      );
      return false;
    } else {
      if (cb) process.nextTick(cb, null);
      return true;
    }
  } catch (e) {
    if (cb) process.nextTick(cb, e);
    require("internal/streams/destroy").errorOrDestroy(this, e as Error, true);
    return false;
  }
}

function finalFast(this: $Node.WriteStream, cb: ErrorCallback) {
  const fileSink = this[kWriteStreamFastPath];
  if (!fileSink || fileSink === true) {
    cb(null);
    return;
  }
  try {
    const maybePromise = fileSink.flush();
    if ($isPromise(maybePromise)) {
      maybePromise.then(() => cb(null), cb);
      return;
    }
  } catch (err) {
    cb(err as Error);
    return;
  }
  cb(null);
}

// This function implementation is not correct.
const writablePrototypeWrite = Writable.prototype.write;
const kWriteMonkeyPatchDefense = Symbol("!");
function writeFast(
  this: $Node.WriteStream,
  data: any,
  encoding?: string | null | ErrorCallback,
  cb?: ErrorCallback,
): boolean {
  if (this[kWriteMonkeyPatchDefense]) return writablePrototypeWrite.$call(this, data, encoding as string, cb);

  // After end()/destroy() the Writable contract requires write() to fail with
  // ERR_STREAM_WRITE_AFTER_END / ERR_STREAM_DESTROYED and not reach the sink.
  const state = this._writableState;
  if (state !== undefined && (state.ending || state.destroyed)) {
    return writablePrototypeWrite.$call(this, data, encoding as string, cb);
  }

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
      // Two-arg then(): a throw from the fulfillment handler must not be
      // mistaken for a write failure.
      maybePromise.then(
        () => {
          emitDrain(this);
          cb(null);
        },
        err => {
          cb(err);
          // Node.js onwriteError: callback AND destroy are both invoked; the
          // callback is additive, not a replacement for the 'error' event.
          require("internal/streams/destroy").errorOrDestroy(this, err);
        },
      );
      return false; // Indicate backpressure
    } else {
      cb(null);
      return true; // No backpressure
    }
  } else {
    const result: any = this._write(data, encoding!, cb);
    if (this.write === writeFast) {
      this.write = writablePrototypeWrite;
    } else {
      this[kWriteMonkeyPatchDefense] = true;
    }
    return result;
  }
}

writeStreamPrototype._writev = function (this: $Node.WriteStream, data: $Node.ChunkToWrite[], cb: ErrorCallback) {
  const len = data.length;
  const chunks: Buffer[] = new Array(len);
  let size = 0;

  for (let i = 0; i < len; i++) {
    const chunk = data[i].chunk as Buffer;
    chunks[i] = chunk;
    size += chunk.length;
  }

  const fileSink = this[kWriteStreamFastPath];
  if (fileSink && fileSink !== true) {
    const maybePromise = fileSink.write(Buffer.concat(chunks));
    if ($isPromise(maybePromise)) {
      maybePromise
        .then(() => {
          emitDrain(this);
          cb(null);
        })
        .catch(cb);
      return false;
    } else {
      cb(null);
      return true;
    }
  } else {
    this[kIsPerformingIO] = true;
    writevAll.$call(this, chunks, size, this.pos, er => {
      this[kIsPerformingIO] = false;
      if (this.destroyed) {
        // Tell ._destroy() that it's safe to close the fd now.
        cb(er);
        return this.emit(kIoDone, er);
      }
      cb(er);
    });

    if (this.pos !== undefined) this.pos += size;
    // Don't return anything for legacy path - matches Node.js behavior
  }
};

writeStreamPrototype._destroy = function (this: $Node.WriteStream, err: Error | null, cb: ErrorCallback) {
  const sink = this[kWriteStreamFastPath];
  if (sink && sink !== true) {
    const end = sink.end(err!);
    if ($isPromise(end)) {
      end.then(() => cb(err), cb);
      return;
    }
  }
  // Usually for async IO it is safe to close a file descriptor
  // even when there are pending operations. However, due to platform
  // differences file IO is implemented using synchronous operations
  // running in a thread pool. Therefore, file descriptors are not safe
  // to close while used in a pending read or write operation. Wait for
  // any pending IO (kIsPerformingIO) to complete (kIoDone).
  if (this[kIsPerformingIO]) {
    this.once(kIoDone, (er: Error | null) => close(this, err || er, cb));
  } else {
    close(this, err, cb);
  }
};

writeStreamPrototype.close = function (this: $Node.WriteStream, cb?: ErrorCallback) {
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
  get(this: $Node.WriteStream) {
    return this._writableState.autoDestroy;
  },
  set(this: $Node.WriteStream, val: boolean) {
    this._writableState.autoDestroy = val;
  },
});

Object.defineProperty(writeStreamPrototype, "pending", {
  get(this: $Node.WriteStream) {
    return this.fd === null;
  },
  configurable: true,
});

function thenIfPromise<T>(maybePromise: Promise<T> | T, cb: ErrorCallback) {
  $assert(typeof cb === "function", "cb is not a function");
  if ($isPromise(maybePromise)) {
    maybePromise.then(() => cb(null), cb);
  } else {
    process.nextTick(cb, null);
  }
}

function writableFromFileSink(fileSink: FileSink) {
  $assert(typeof fileSink === "object", "fileSink is not an object");
  $assert(typeof fileSink.write === "function", "fileSink.write is not a function");
  $assert(typeof fileSink.end === "function", "fileSink.end is not a function");
  const w: $Node.WriteStream = new WriteStream("", { $fastPath: true });
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
