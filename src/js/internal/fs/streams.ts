// fs.ReadStream and fs.WriteStream are lazily loaded to avoid importing 'node:stream' until required
const { Readable, Writable } = require("node:stream");
const fs: typeof import("node:fs") = require("node:fs");
const {
  read,
  write,
  fsync,
} = fs;
const {
  FileHandle,
  kRef,
  kUnref,
  kFd,
} = (fs.promises as any).$data as {
  FileHandle: { new(): FileHandle };
  readonly kRef: unique symbol;
  readonly kUnref: unique symbol;
  readonly kFd: unique symbol;
  fs: typeof fs;
};
type FileHandle = import('node:fs/promises').FileHandle & {
  on(event: any, listener: any): FileHandle;
};
type FSStream = import("node:fs").ReadStream & import("node:fs").WriteStream & {
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
};
type FD = number;

const { validateInteger, validateInt32, validateFunction } = require("internal/validators");

// Bun supports a fast path for `createReadStream("path.txt")` in `Bun.serve`,
// where the entire stream implementation can be bypassed, effectively making it
// `new Response(Bun.file("path.txt"))`. This makes an idomatic Node.js pattern
// much faster.
const kReadStreamFastPath = Symbol("kReadStreamFastPath");
const kFs = Symbol("kFs");
// const readStreamSymbol = Symbol.for("Bun.NodeReadStream");
// const readStreamPathOrFdSymbol = Symbol.for("Bun.NodeReadStreamPathOrFd");
// const writeStreamSymbol = Symbol.for("Bun.NodeWriteStream");
// const writeStreamPathFastPathSymbol = Symbol.for("Bun.NodeWriteStreamFastPath");
// const writeStreamPathFastPathCallSymbol = Symbol.for("Bun.NodeWriteStreamFastPathCall");
const kIoDone = Symbol("kIoDone");
const kIsPerformingIO = Symbol("kIsPerformingIO");

const { read: fileHandlePrototypeRead, write: fileHandlePrototypeWrite, fsync: fileHandlePrototypeFsync } = FileHandle.prototype;

const blobToStreamWithOffset = $newZigFunction("blob.zig", "Blob.toStreamWithOffset", 1);

const fileHandleStreamFs = (fh: FileHandle) => ({
  // try to use the basic fs.read/write/fsync if available, since they are less
  // abstractions. however, node.js allows patching the file handle, so this has
  // to be checked for.
  read: fh.read === fileHandlePrototypeRead ? read : function(fd, buf, offset, length, pos, cb) {
    return fh.read(buf,offset,length,pos).then(({ bytesRead, buffer }) => cb(null, bytesRead, buffer), (err) => cb(err, 0, buf));
  },
  write: fh.write === fileHandlePrototypeWrite ? write : function(fd, buffer, offset, length, position, cb) {
    return fh.write(buffer, offset, length, position).then(({ bytesWritten, buffer }) => cb(null, bytesWritten, buffer), (err) => cb(err, 0, buffer));
  },
  fsync: fh.sync === fileHandlePrototypeFsync ? fsync : function(fd, cb) {
    return fh.sync().then(() => cb(), cb);
  },
  close: streamFileHandleClose.bind(fh),
});

function streamFileHandleClose(this: FileHandle, fd: FD, cb: (err?: any) => void) {
  $assert(this[kFd] == fd, 'fd mismatch');
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
  for (const key in source)
    target[key] = source[key];
  return target;
}

function getStreamOptions(options, defaultOptions = {}) {
  if (options == null || typeof options === 'function') {
    return defaultOptions;
  }

  if (typeof options === 'string') {
    if (options !== 'buffer' && !Buffer.isEncoding(options)) {
      throw $ERR_INVALID_ARG_VALUE("encoding", options, "is invalid encoding");
    }
    return { encoding: options };
  } else if (typeof options !== 'object') {
    throw $ERR_INVALID_ARG_TYPE('options', ['string', 'Object'], options);
  }

  let { encoding, signal = true } = options;
  if (encoding && encoding !== 'buffer' && !Buffer.isEncoding(encoding)) {
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

  let {
    fd, 
    autoClose,
    fs: customFs,
    start = 0,
    end = Infinity,
    encoding,
  } = options;
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
  } else if (typeof fd === 'object' && fd instanceof FileHandle) {
    if (options.fs) {
      throw $ERR_METHOD_NOT_IMPLEMENTED("fs.FileHandle with custom fs operations");
    }
    this[kFs] = fileHandleStreamFs(fd);
    this.fd = fd[kFd];
    fd[kRef]();
    fd.on('close', this.close.bind(this));
  } else {
    throw $ERR_INVALID_ARG_TYPE('options.fd', 'number or FileHandle', fd);
  }

  if (customFs) {
    validateFunction(customFs.read, "options.fs.read");
  }

  $assert(this[kFs], 'fs implementation was not assigned');

  if((options.autoDestroy = autoClose === undefined
    ? true 
    : autoClose) && customFs) {
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
  this[kIsPerformingIO] = false;

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

Object.defineProperty(readStreamPrototype, 'autoClose', {
  get() {
    return this._readableState.autoDestroy;
  },
  set(val) {
    this._readableState.autoDestroy = val;
  },
});

const streamNoop = function open() {
  // noop
}
function streamConstruct(this: FSStream, callback: (e?: any) => void) {
  const { fd } = this;
  if (typeof fd === "number") {
    callback();
    return;
  }
  if (this.open !== streamNoop) {
    // Backwards compat for monkey patching open().
    const orgEmit: any = this.emit;
    this.emit = function(...args) {
      if (args[0] === 'open') {
        this.emit = orgEmit;
        callback();
        orgEmit.$apply(this, args);
      } else if (args[0] === 'error') {
        this.emit = orgEmit;
        callback(args[1]);
      } else {
        orgEmit.$apply(this, args);
      }
    } as any;
    this.open();
  } else {
    this[kFs].open(this.path, this.flags, this.mode, (err, fd) => {
      if (err) {
        callback(err);
      } else {
        this.fd = fd;
        callback();
        this.emit('open', this.fd);
        this.emit('ready');
      }
    });
  }
}

readStreamPrototype.open = streamNoop;

readStreamPrototype._construct = streamConstruct;

readStreamPrototype._read = function(n) {
  n = this.pos !== undefined ?
    $min(this.end - this.pos + 1, n) :
    $min(this.end - this.bytesRead + 1, n);

  if (n <= 0) {
    this.push(null);
    return;
  }

  const buf = Buffer.allocUnsafeSlow(n);

  this[kIsPerformingIO] = true;
  this[kFs]
    .read(this.fd, buf, 0, n, this.pos, (er, bytesRead, buf) => {
      this[kIsPerformingIO] = false;

      // Tell ._destroy() that it's safe to close the fd now.
      if (this.destroyed) {
        this.emit(kIoDone, er);
        return;
      }

      if (er) {
        require('internal/streams/destroy').errorOrDestroy(this, er);
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

readStreamPrototype._destroy = function(err, cb) {
  // Usually for async IO it is safe to close a file descriptor
  // even when there are pending operations. However, due to platform
  // differences file IO is implemented using synchronous operations
  // running in a thread pool. Therefore, file descriptors are not safe
  // to close while used in a pending read or write operation. Wait for
  // any pending IO (kIsPerformingIO) to complete (kIoDone).
  if (this[kIsPerformingIO]) {
    this.once(kIoDone, (er) => close(this, err || er, cb));
  } else {
    close(this, err, cb);
  }
};

readStreamPrototype.close = function(cb) {
  if (typeof cb === 'function') require('node:stream').finished(this, cb);
  this.destroy();
};

Object.defineProperty(readStreamPrototype, 'pending', {
  get() {
    return this.fd == null;
  },
  configurable: true,
});

function close(stream, err, cb) {
  if (!stream.fd) {
    cb(err);
  } else if (stream.flush) {
    stream[kFs].fsync(stream.fd, (flushErr) => {
      closeAfterSync(stream, err || flushErr, cb);
    });
  } else {
    closeAfterSync(stream, err, cb);
  }
}

function closeAfterSync(stream, err, cb) {
  stream[kFs].close(stream.fd, (er) => {
    cb(er || err);
  });
  stream.fd = null;
}

function WriteStream(this: FSStream, path: string | null, options: any): void {
  if (!(this instanceof WriteStream)) {
    return new WriteStream(path, options);
  }

  options = copyObject(getStreamOptions(options));

  // Only buffers are supported.
  options.decodeStrings = true;

  let {
    fd, 
    autoClose,
    fs: customFs,
    start,
    flush,
  } = options;
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
  } else if (typeof fd === 'object' && fd instanceof FileHandle) {
    if (options.fs) {
      throw $ERR_METHOD_NOT_IMPLEMENTED("fs.FileHandle with custom fs operations");
    }
    this[kFs] = fileHandleStreamFs(fd);
    this.fd = fd[kFd];
    fd[kRef]();
    fd.on('close', this.close.bind(this));
  } else {
    throw $ERR_INVALID_ARG_TYPE('options.fd', 'number or FileHandle', fd);
  }

  const autoDestroy =  options.autoDestroy = autoClose === undefined
    ? true 
    : autoClose;

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
    if (er?.code === 'EAGAIN') {
      er = null;
      bytesWritten = 0;
    }

    if (this.destroyed || er) {
      return cb(er || $ERR_STREAM_DESTROYED('write'));
    }

    this.bytesWritten += bytesWritten;

    retries = bytesWritten ? 0 : retries + 1;
    size -= bytesWritten;
    pos += bytesWritten;

    // Try writing non-zero number of bytes up to 5 times.
    if (retries > 5) {
      // cb($ERR_SYSTEM_ERROR('write failed'));
      cb(new Error('write failed'));
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
    if (er?.code === 'EAGAIN') {
      er = null;
      bytesWritten = 0;
    }

    if (this.destroyed || er) {
      return cb(er || $ERR_STREAM_DESTROYED('writev'));
    }

    this.bytesWritten += bytesWritten;

    retries = bytesWritten ? 0 : retries + 1;
    size -= bytesWritten;
    pos += bytesWritten;

    // Try writing non-zero number of bytes up to 5 times.
    if (retries > 5) {
      // cb($ERR_SYSTEM_ERROR('writev failed'));
      cb(new Error('writev failed'));
    } else if (size) {
      writevAll.$call(this, [Buffer.concat(buffers).slice(bytesWritten)], size, pos, cb, retries);
    } else {
      cb();
    }
  });
}

writeStreamPrototype._write = function(data, encoding, cb) {
  this[kIsPerformingIO] = true;
  writeAll.$call(this, data, data.length, this.pos, (er) => {
    this[kIsPerformingIO] = false;
    if (this.destroyed) {
      // Tell ._destroy() that it's safe to close the fd now.
      cb(er);
      return this.emit(kIoDone, er);
    }

    cb(er);
  });

  if (this.pos !== undefined)
    this.pos += data.length;
};

writeStreamPrototype._writev = function(data, cb) {
  const len = data.length;
  const chunks = new Array(len);
  let size = 0;

  for (let i = 0; i < len; i++) {
    const chunk = data[i].chunk;

    chunks[i] = chunk;
    size += chunk.length;
  }

  this[kIsPerformingIO] = true;
  writevAll.$call(this, chunks, size, this.pos, (er) => {
    this[kIsPerformingIO] = false;
    if (this.destroyed) {
      // Tell ._destroy() that it's safe to close the fd now.
      cb(er);
      return this.emit(kIoDone, er);
    }

    cb(er);
  });

  if (this.pos !== undefined)
    this.pos += size;
};

writeStreamPrototype._destroy = function(err, cb) {
  // Usually for async IO it is safe to close a file descriptor
  // even when there are pending operations. However, due to platform
  // differences file IO is implemented using synchronous operations
  // running in a thread pool. Therefore, file descriptors are not safe
  // to close while used in a pending read or write operation. Wait for
  // any pending IO (kIsPerformingIO) to complete (kIoDone).
  if (this[kIsPerformingIO]) {
    this.once(kIoDone, (er) => close(this, err || er, cb));
  } else {
    close(this, err, cb);
  }
};

writeStreamPrototype.close = function(cb) {
  if (cb) {
    if (this.closed) {
      process.nextTick(cb);
      return;
    }
    this.on('close', cb);
  }

  // If we are not autoClosing, we should call
  // destroy on 'finish'.
  if (!this.autoClose) {
    this.on('finish', this.destroy);
  }

  // We use end() instead of destroy() because of
  // https://github.com/nodejs/node/issues/2006
  this.end();
};

// There is no shutdown() for files.
writeStreamPrototype.destroySoon = writeStreamPrototype.end;

Object.defineProperty(writeStreamPrototype, 'autoClose', {
  get() {
    return this._writableState.autoDestroy;
  },
  set(val) {
    this._writableState.autoDestroy = val;
  },
});

Object.$defineProperty(writeStreamPrototype, 'pending', {
  get() { return this.fd === null; },
  configurable: true,
});

export default { ReadStream, WriteStream, kReadStreamFastPath };