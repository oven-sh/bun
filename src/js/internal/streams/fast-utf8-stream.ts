// Ported from Node.js lib/internal/streams/fast-utf8-stream.js, which is itself
// derived from the SonicBoom module (MIT, Copyright (c) 2017 Matteo Collina).
const {
  validateBoolean,
  validateFunction,
  validateObject,
  validateOneOf,
  validateString,
  validateUint32,
} = require("internal/validators");

const EventEmitter = require("node:events");
const path = require("node:path");

// Resolved lazily: node:fs itself exposes Utf8Stream, so requiring it at module
// scope would re-enter this module while node:fs is still being constructed.
let _fs;
function lazyFs() {
  return (_fs ??= require("node:fs"));
}

const BUSY_WRITE_TIMEOUT = 100;
const kEmptyBuffer = Buffer.allocUnsafe(0);

// 16 KB. Don't write more than docker buffer size.
const kMaxWrite = 16 * 1024;
const kContentModeBuffer = "buffer";
const kContentModeUtf8 = "utf8";
const kNullPrototype = { __proto__: null };

// A synchronous sleep, used only on the EAGAIN/EBUSY retry paths.
function sleep(ms) {
  Bun.sleepSync(ms);
}

class Utf8Stream extends EventEmitter {
  #len = 0;
  #fd = -1;
  #bufs: any[] = [];
  #lens: number[] = [];
  #writing = false;
  #ending = false;
  #reopening = false;
  #asyncDrainScheduled = false;
  #flushPending = false;
  #hwm = 16387; // 16 KB
  #file = null;
  #destroyed = false;
  #minLength = 0;
  #maxLength = 0;
  #maxWrite = kMaxWrite;
  #opening = false;
  #periodicFlush = 0;
  #periodicFlushTimer = undefined;
  #sync = false;
  #fsync = false;
  #append = true;
  #mode;
  #retryEAGAIN = () => true;
  #mkdir = false;
  #writingBuf: any = "";
  #write;
  #flush;
  #flushSync;
  #actualWrite;
  #fsWriteSync;
  #fsWrite;
  #fs;

  constructor(options = kNullPrototype) {
    validateObject(options, "options");
    let { fd } = options as any;
    const {
      dest,
      minLength,
      maxLength,
      maxWrite,
      periodicFlush,
      sync,
      append = true,
      mkdir,
      retryEAGAIN,
      fsync,
      contentMode = kContentModeUtf8,
      mode,
      // Provides for a custom fs implementation. Mostly useful for testing.
      fs: overrideFs = {},
    } = options as any;

    super();

    fd ??= dest;

    validateObject(overrideFs, "options.fs");
    this.#fs = { ...lazyFs(), ...overrideFs };
    validateFunction(this.#fs.write, "options.fs.write");
    validateFunction(this.#fs.writeSync, "options.fs.writeSync");
    validateFunction(this.#fs.fsync, "options.fs.fsync");
    validateFunction(this.#fs.fsyncSync, "options.fs.fsyncSync");
    validateFunction(this.#fs.close, "options.fs.close");
    validateFunction(this.#fs.open, "options.fs.open");
    validateFunction(this.#fs.mkdir, "options.fs.mkdir");
    validateFunction(this.#fs.mkdirSync, "options.fs.mkdirSync");

    this.#hwm = Math.max(minLength || 0, this.#hwm);
    this.#minLength = minLength || 0;
    this.#maxLength = maxLength || 0;
    this.#maxWrite = maxWrite || kMaxWrite;
    this.#periodicFlush = periodicFlush || 0;
    this.#sync = sync || false;
    this.#fsync = fsync || false;
    this.#append = append || false;
    this.#mode = mode;
    this.#retryEAGAIN = retryEAGAIN || (() => true);
    this.#mkdir = mkdir || false;

    validateUint32(this.#hwm, "options.hwm");
    validateUint32(this.#minLength, "options.minLength");
    validateUint32(this.#maxLength, "options.maxLength");
    validateUint32(this.#maxWrite, "options.maxWrite");
    validateUint32(this.#periodicFlush, "options.periodicFlush");
    validateBoolean(this.#sync, "options.sync");
    validateBoolean(this.#fsync, "options.fsync");
    validateBoolean(this.#append, "options.append");
    validateBoolean(this.#mkdir, "options.mkdir");
    validateFunction(this.#retryEAGAIN, "options.retryEAGAIN");
    validateOneOf(contentMode, "options.contentMode", [kContentModeBuffer, kContentModeUtf8]);

    // Bound methods instead of node's rest/spread arrows: the arrows allocate an
    // arguments array on every write()/flush(), and the per-write inner release
    // callback allocated a fresh closure per fs.write. Bind once here.
    const boundRelease = this.#release.bind(this) as (err: any, n: any) => void;
    if (contentMode === kContentModeBuffer) {
      this.#writingBuf = kEmptyBuffer;
      this.#write = this.#writeBuffer.bind(this);
      this.#flush = this.#flushBuffer.bind(this);
      this.#flushSync = this.#flushBufferSync.bind(this);
      this.#actualWrite = this.#actualWriteBuffer.bind(this);
      this.#fsWriteSync = function fsWriteSyncBuffer(this: Utf8Stream) {
        return this.#fs.writeSync(this.#fd, this.#writingBuf);
      }.bind(this);
      this.#fsWrite = function fsWriteBuffer(this: Utf8Stream) {
        return this.#fs.write(this.#fd, this.#writingBuf, boundRelease);
      }.bind(this);
    } else {
      this.#writingBuf = "";
      this.#write = this.#writeUtf8.bind(this);
      this.#flush = this.#flushUtf8.bind(this);
      this.#flushSync = this.#flushSyncUtf8.bind(this);
      this.#actualWrite = this.#actualWriteUtf8.bind(this);
      this.#fsWriteSync = function fsWriteSyncUtf8(this: Utf8Stream) {
        return this.#fs.writeSync(this.#fd, this.#writingBuf, "utf8");
      }.bind(this);
      this.#fsWrite = function fsWriteUtf8(this: Utf8Stream) {
        return this.#fs.write(this.#fd, this.#writingBuf, "utf8", boundRelease);
      }.bind(this);
    }

    if (typeof fd === "number") {
      this.#fd = fd;
      process.nextTick(() => this.emit("ready"));
    } else if (typeof fd === "string") {
      this.#openFile(fd);
    } else {
      throw $ERR_INVALID_ARG_TYPE("fd", ["number", "string"], fd);
    }
    if (this.#minLength >= this.#maxWrite) {
      throw $ERR_INVALID_ARG_VALUE_RangeError(
        "minLength",
        this.#minLength,
        `should be smaller than maxWrite (${this.#maxWrite})`,
      );
    }

    this.on("newListener", name => {
      if (name === "drain") {
        this.#asyncDrainScheduled = false;
      }
    });

    if (this.#periodicFlush !== 0) {
      this.#periodicFlushTimer = setInterval(() => this.flush(null), this.#periodicFlush);
      this.#periodicFlushTimer.unref();
    }
  }

  write(data) {
    return this.#write(data);
  }

  flush(cb = function (_err) {}) {
    this.#flush(cb);
  }

  flushSync() {
    return this.#flushSync();
  }

  reopen(file?) {
    if (this.#destroyed) {
      throw $ERR_INVALID_STATE("Utf8Stream is destroyed");
    }

    if (this.#opening) {
      this.once("ready", () => this.reopen(file));
      return;
    }

    if (this.#ending) {
      return;
    }

    if (!this.#file) {
      throw $ERR_OPERATION_FAILED("Unable to reopen a file descriptor, you must pass a file to SonicBoom");
    }

    if (file) {
      this.#file = file;
    }
    this.#reopening = true;

    if (this.#writing) {
      return;
    }

    const fd = this.#fd;
    this.once("ready", () => {
      if (fd !== this.#fd) {
        this.#fs.close(fd, err => {
          if (err) {
            return this.emit("error", err);
          }
        });
      }
    });

    this.#openFile(this.#file);
  }

  end() {
    if (this.#destroyed) {
      throw $ERR_INVALID_STATE("Utf8Stream is destroyed");
    }

    if (this.#opening) {
      this.once("ready", () => {
        this.end();
      });
      return;
    }

    if (this.#ending) {
      return;
    }

    this.#ending = true;

    if (this.#writing) {
      return;
    }

    if (this.#len > 0 && this.#fd >= 0) {
      this.#actualWrite();
    } else {
      this.#actualClose();
    }
  }

  destroy() {
    if (this.#destroyed) {
      return;
    }
    this.#actualClose();
  }

  get mode() {
    return this.#mode;
  }

  get file() {
    return this.#file;
  }

  get fd() {
    return this.#fd;
  }

  get minLength() {
    return this.#minLength;
  }

  get maxLength() {
    return this.#maxLength;
  }

  get writing() {
    return this.#writing;
  }

  get sync() {
    return this.#sync;
  }

  get fsync() {
    return this.#fsync;
  }

  get append() {
    return this.#append;
  }

  get periodicFlush() {
    return this.#periodicFlush;
  }

  get contentMode() {
    return this.#writingBuf instanceof Buffer ? kContentModeBuffer : kContentModeUtf8;
  }

  get mkdir() {
    return this.#mkdir;
  }

  [Symbol.dispose]() {
    this.destroy();
  }

  #release(err?, n?) {
    if (err) {
      if (
        (err.code === "EAGAIN" || err.code === "EBUSY") &&
        this.#retryEAGAIN(err, this.#writingBuf.length, this.#len - this.#writingBuf.length)
      ) {
        if (this.#sync) {
          // This error code should not happen in sync mode, because it is
          // not using the underlying operating system asynchronous functions.
          // However it happens, and so we handle it.
          try {
            sleep(BUSY_WRITE_TIMEOUT);
            this.#release(undefined, 0);
          } catch (err) {
            this.#release(err);
          }
        } else {
          // Let's give the destination some time to process the chunk.
          setTimeout(() => this.#fsWrite(), BUSY_WRITE_TIMEOUT);
        }
      } else {
        this.#writing = false;

        this.emit("error", err);
      }
      return;
    }

    this.emit("write", n);
    const releasedBufObj = releaseWritingBuf(this.#writingBuf, this.#len, n);
    this.#len = releasedBufObj.len;
    this.#writingBuf = releasedBufObj.writingBuf;

    if (this.#writingBuf.length) {
      if (!this.#sync) {
        this.#fsWrite();
        return;
      }

      try {
        do {
          const n = this.#fsWriteSync();
          const releasedBufObj = releaseWritingBuf(this.#writingBuf, this.#len, n);
          this.#len = releasedBufObj.len;
          this.#writingBuf = releasedBufObj.writingBuf;
        } while (this.#writingBuf.length);
      } catch (err) {
        this.#release(err);
        return;
      }
    }

    if (this.#fsync) {
      this.#fs.fsyncSync(this.#fd);
    }

    const len = this.#len;
    if (this.#reopening) {
      this.#writing = false;
      this.#reopening = false;
      this.reopen();
    } else if (len > this.#minLength) {
      this.#actualWrite();
    } else if (this.#ending) {
      if (len > 0) {
        this.#actualWrite();
      } else {
        this.#writing = false;
        this.#actualClose();
      }
    } else {
      this.#writing = false;
      if (this.#sync) {
        if (!this.#asyncDrainScheduled) {
          this.#asyncDrainScheduled = true;
          process.nextTick(() => this.#emitDrain());
        }
      } else {
        this.emit("drain");
      }
    }
  }

  #openFile(file) {
    this.#opening = true;
    this.#writing = true;
    this.#asyncDrainScheduled = false;

    // NOTE: 'error' and 'ready' events emitted below only relevant when sync === false
    // for sync mode, there is no way to add a listener that will receive these
    const fileOpened = (err, fd?) => {
      if (err) {
        this.#reopening = false;
        this.#writing = false;
        this.#opening = false;

        if (this.#sync) {
          process.nextTick(() => {
            if (this.listenerCount("error") > 0) {
              this.emit("error", err);
            }
          });
        } else {
          this.emit("error", err);
        }
        return;
      }

      const reopening = this.#reopening;

      this.#fd = fd;
      this.#file = file;
      this.#reopening = false;
      this.#opening = false;
      this.#writing = false;

      if (this.#sync) {
        process.nextTick(() => this.emit("ready"));
      } else {
        this.emit("ready");
      }

      if (this.#destroyed) {
        return;
      }

      // start
      if ((!this.#writing && this.#len > this.#minLength) || this.#flushPending) {
        this.#actualWrite();
      } else if (reopening) {
        process.nextTick(() => this.emit("drain"));
      }
    };

    const flags = this.#append ? "a" : "w";
    const mode = this.#mode;

    if (this.#sync) {
      try {
        if (this.#mkdir) this.#fs.mkdirSync(path.dirname(file), { recursive: true });
        const fd = this.#fs.openSync(file, flags, mode);
        fileOpened(null, fd);
      } catch (err) {
        fileOpened(err);
        throw err;
      }
    } else if (this.#mkdir) {
      this.#fs.mkdir(path.dirname(file), { recursive: true }, err => {
        if (err) return fileOpened(err);
        this.#fs.open(file, flags, mode, fileOpened);
      });
    } else {
      this.#fs.open(file, flags, mode, fileOpened);
    }
  }

  #emitDrain() {
    const hasListeners = this.listenerCount("drain") > 0;
    if (!hasListeners) return;
    this.#asyncDrainScheduled = false;
    this.emit("drain");
  }

  #actualClose() {
    if (this.#fd === -1) {
      this.once("ready", () => this.#actualClose());
      return;
    }

    if (this.#periodicFlushTimer !== undefined) {
      clearInterval(this.#periodicFlushTimer);
    }

    this.#destroyed = true;
    this.#bufs = [];
    this.#lens = [];

    const done = err => {
      if (err) {
        this.emit("error", err);
        return;
      }

      if (this.#ending && !this.#writing) {
        this.emit("finish");
      }
      this.emit("close");
    };

    const closeWrapped = () => {
      // We skip errors in fsync
      if (this.#fd !== 1 && this.#fd !== 2) {
        this.#fs.close(this.#fd, done);
      } else {
        done(null);
      }
    };

    try {
      this.#fs.fsync(this.#fd, closeWrapped);
    } catch {
      // Intentionally empty.
    }
  }

  #actualWriteBuffer() {
    this.#writing = true;
    this.#writingBuf = this.#writingBuf.length ? this.#writingBuf : mergeBuf(this.#bufs.shift(), this.#lens.shift());

    if (this.#sync) {
      try {
        const written = this.#fs.writeSync(this.#fd, this.#writingBuf);
        this.#release(null, written);
      } catch (err) {
        this.#release(err);
      }
    } else {
      // fs.write will need to copy string to buffer anyway so
      // we do it here to avoid the overhead of calculating the buffer size
      // in releaseWritingBuf.
      this.#writingBuf = Buffer.from(this.#writingBuf);
      this.#fsWrite();
    }
  }

  #actualWriteUtf8() {
    this.#writing = true;
    this.#writingBuf ||= this.#bufs.shift() || "";

    if (this.#sync) {
      try {
        const written = this.#fs.writeSync(this.#fd, this.#writingBuf, "utf8");
        this.#release(null, written);
      } catch (err) {
        this.#release(err);
      }
    } else {
      this.#fsWrite();
    }
  }

  #flushBufferSync() {
    if (this.#destroyed) {
      throw $ERR_INVALID_STATE("Utf8Stream is destroyed");
    }

    if (this.#fd < 0) {
      throw $ERR_INVALID_STATE("Invalid file descriptor");
    }

    if (!this.#writing && this.#writingBuf.length > 0) {
      this.#bufs.unshift([this.#writingBuf]);
      this.#writingBuf = kEmptyBuffer;
    }

    let buf = kEmptyBuffer;
    while (this.#bufs.length || buf.length) {
      if (buf.length <= 0) {
        buf = mergeBuf(this.#bufs[0], this.#lens[0]);
      }
      try {
        const n = this.#fs.writeSync(this.#fd, buf);
        buf = buf.subarray(n);
        this.#len = Math.max(this.#len - n, 0);
        if (buf.length <= 0) {
          this.#bufs.shift();
          this.#lens.shift();
        }
      } catch (err) {
        const shouldRetry = err.code === "EAGAIN" || err.code === "EBUSY";
        if (shouldRetry && !this.#retryEAGAIN(err, buf.length, this.#len - buf.length)) {
          throw err;
        }

        sleep(BUSY_WRITE_TIMEOUT);
      }
    }
  }

  #flushSyncUtf8() {
    if (this.#destroyed) {
      throw $ERR_INVALID_STATE("Utf8Stream is destroyed");
    }

    if (this.#fd < 0) {
      throw $ERR_INVALID_STATE("Invalid file descriptor");
    }

    if (!this.#writing && this.#writingBuf.length > 0) {
      this.#bufs.unshift(this.#writingBuf);
      this.#writingBuf = "";
    }

    let buf = "";
    while (this.#bufs.length || buf) {
      if (buf.length <= 0) {
        buf = this.#bufs[0];
      }
      try {
        const n = this.#fs.writeSync(this.#fd, buf, "utf8");
        const releasedBufObj = releaseWritingBuf(buf, this.#len, n);
        buf = releasedBufObj.writingBuf;
        this.#len = releasedBufObj.len;
        if (buf.length <= 0) {
          this.#bufs.shift();
        }
      } catch (err) {
        const shouldRetry = err.code === "EAGAIN" || err.code === "EBUSY";
        if (shouldRetry && !this.#retryEAGAIN(err, buf.length, this.#len - buf.length)) {
          throw err;
        }

        sleep(BUSY_WRITE_TIMEOUT);
      }
    }

    try {
      this.#fs.fsyncSync(this.#fd);
    } catch {
      // Skip the error. The fd might not support fsync.
    }
  }

  #callFlushCallbackOnDrain(cb) {
    this.#flushPending = true;
    const onDrain = () => {
      // Only if fsync is false to avoid double fsync
      if (!this.#fsync && !this.#destroyed) {
        try {
          this.#fs.fsync(this.#fd, err => {
            this.#flushPending = false;
            // If the fd is closed, we ignore the error.
            if (err?.code === "EBADF") {
              cb();
              return;
            }
            cb(err);
          });
        } catch (err) {
          this.#flushPending = false;
          cb(err);
        }
      } else {
        this.#flushPending = false;
        cb();
      }
      this.off("error", onError);
    };
    const onError = err => {
      this.#flushPending = false;
      cb(err);
      this.off("drain", onDrain);
    };

    this.once("drain", onDrain);
    this.once("error", onError);
  }

  #flushBuffer(cb) {
    validateFunction(cb, "cb");

    if (this.#destroyed) {
      const error = $ERR_INVALID_STATE("Utf8Stream is destroyed");
      if (cb) {
        cb(error);
        return;
      }

      throw error;
    }

    if (this.#minLength <= 0) {
      cb?.();
      return;
    }

    if (cb) {
      this.#callFlushCallbackOnDrain(cb);
    }

    if (this.#writing) {
      return;
    }

    if (this.#bufs.length === 0) {
      this.#bufs.push([]);
      this.#lens.push(0);
    }

    this.#actualWrite();
  }

  #flushUtf8(cb) {
    validateFunction(cb, "cb");

    if (this.#destroyed) {
      const error = $ERR_INVALID_STATE("Utf8Stream is destroyed");
      if (cb) {
        cb(error);
        return;
      }

      throw error;
    }

    if (this.#minLength <= 0) {
      cb?.();
      return;
    }

    if (cb) {
      this.#callFlushCallbackOnDrain(cb);
    }

    if (this.#writing) {
      return;
    }

    if (this.#bufs.length === 0) {
      this.#bufs.push("");
    }

    this.#actualWrite();
  }

  #writeBuffer(data) {
    if (this.#destroyed) {
      throw $ERR_INVALID_STATE("Utf8Stream is destroyed");
    }

    if (!Buffer.isBuffer(data)) {
      throw $ERR_INVALID_ARG_TYPE("data", "Buffer", data);
    }

    const dataLength = data.length;
    const len = this.#len + dataLength;
    const bufs = this.#bufs;
    const lens = this.#lens;

    if (this.#maxLength && len > this.#maxLength) {
      this.emit("drop", data);
      return this.#len < this.#hwm;
    }

    if (bufs.length === 0 || lens[lens.length - 1] + dataLength > this.#maxWrite) {
      bufs.push([]);
      lens.push(dataLength);
    } else {
      bufs[bufs.length - 1].push(data);
      lens[lens.length - 1] += dataLength;
    }

    this.#len = len;

    if (!this.#writing && this.#len >= this.#minLength) {
      this.#actualWrite();
    }

    return this.#len < this.#hwm;
  }

  #writeUtf8(data) {
    if (this.#destroyed) {
      throw $ERR_INVALID_STATE("Utf8Stream is destroyed");
    }
    validateString(data, "data");

    const dataLength = data.length;
    const len = this.#len + dataLength;
    const bufs = this.#bufs;

    if (this.#maxLength && len > this.#maxLength) {
      this.emit("drop", data);
      return this.#len < this.#hwm;
    }

    if (bufs.length === 0 || bufs[bufs.length - 1].length + dataLength > this.#maxWrite) {
      bufs.push("" + data);
    } else {
      bufs[bufs.length - 1] += data;
    }

    this.#len = len;

    if (!this.#writing && this.#len >= this.#minLength) {
      this.#actualWrite();
    }

    return this.#len < this.#hwm;
  }
}

/**
 * Release the writingBuf after fs.write n bytes data
 */
function releaseWritingBuf(writingBuf, len, n) {
  if (typeof writingBuf === "string") {
    const byteLength = Buffer.byteLength(writingBuf);
    if (byteLength !== n) {
      // Since fs.write returns the number of bytes written, we need to find
      // how many complete characters fit within those n bytes. If a partial
      // write splits a multi-byte UTF-8 character, we must back up to the
      // start of that character to avoid data corruption.
      const buf = Buffer.from(writingBuf);
      // UTF-8 continuation bytes have the pattern 10xxxxxx (0x80-0xBF).
      while (n > 0 && (buf[n] & 0xc0) === 0x80) {
        n--;
      }
      n = buf.subarray(0, n).toString().length;
    }
  }
  len = Math.max(len - n, 0);
  writingBuf = writingBuf.slice(n);
  return { writingBuf, len };
}

function mergeBuf(bufs, len) {
  if (bufs.length === 0) {
    return kEmptyBuffer;
  }

  if (bufs.length === 1) {
    return bufs[0];
  }

  return Buffer.concat(bufs, len);
}

export default Utf8Stream;
