// Ported from Node.js v26.12.1 lib/internal/streams/fast-utf8-stream.js, which is
// itself derived from the SonicBoom module (MIT, Copyright (c) 2017 Matteo Collina).
const {
  validateBoolean,
  validateFunction,
  validateObject,
  validateOneOf,
  validateString,
  validateUint32,
} = require("internal/validators");
const { kEmptyObject } = require("internal/shared");

const EventEmitter = require("node:events");
const path = require("node:path");
const { clearInterval, clearTimeout, setInterval, setTimeout } = require("node:timers");
const { isArrayBufferView } = require("node:util/types");

// Resolved lazily: node:fs itself exposes Utf8Stream, so requiring it at module
// scope would re-enter this module while node:fs is still being constructed.
let _fs: $BunModules["node:fs"] | undefined;
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
const kFlush = Symbol("kFlush");

// States returned by #beginFlushSync().
// No write is in flight.
const kFlushSyncIdle = 0;
// An EAGAIN/EBUSY retry timer was pending and has been cancelled. Nothing is
// in flight, so the remainder of #writingBuf can be written synchronously.
const kFlushSyncRetry = 1;
// Called from a 'write' listener. The completed write has been released and
// nothing is in flight, so the remainder of #writingBuf can be written
// synchronously.
const kFlushSyncInWriteEvent = 2;
// An asynchronous fs.write() of #writingBuf is in flight. Only the queued
// buffers can be written; ordering relative to the in-flight chunk is not
// guaranteed.
const kFlushSyncInFlight = 3;

// fsync() error codes meaning the file descriptor cannot be synchronized
// (e.g. it is a pipe, socket, or TTY) or has already been closed. These are
// not treated as flush failures.
function isIgnorableFsyncError(err) {
  switch (err?.code) {
    case "EBADF":
    case "EINVAL":
    case "ENOTSUP":
    case "EOPNOTSUPP":
    case "EROFS":
      return true;
    default:
      return false;
  }
}

// A synchronous sleep, used only on the EAGAIN/EBUSY retry paths.
function sleep(ms) {
  Bun.sleepSync(ms);
}

type FlushCallback = (err?: Error | null) => void;

/** The functions of node:fs that the stream calls. `options.fs` may replace any of them. */
interface StreamFs {
  write(fd: number, data: Buffer | Uint8Array, callback: (err: Error | null, written: number) => void): void;
  write(fd: number, data: string, encoding: string, callback: (err: Error | null, written: number) => void): void;
  writeSync(fd: number, data: string | Buffer | Uint8Array, encoding?: string): number;
  fsync(fd: number, callback: FlushCallback): void;
  fsyncSync(fd: number): void;
  close(fd: number, callback: FlushCallback): void;
  open(
    path: string,
    flags: string,
    mode: string | number | undefined,
    callback: (err: Error | null, fd?: number) => void,
  ): void;
  openSync(path: string, flags: string, mode: string | number | undefined): number;
  mkdir(path: string, options: { recursive: boolean }, callback: FlushCallback): void;
  mkdirSync(path: string, options: { recursive: boolean }): unknown;
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
  #flushPending = 0;
  #flushInProgress = 0;
  #emittingFlush = false;
  #emittingWrite = false;
  #retryTimer: NodeJS.Timeout | null = null;
  #hwm = 16387; // 16 KB
  #file = null;
  #destroyed = false;
  #minLength = 0;
  #maxLength = 0;
  #maxWrite = kMaxWrite;
  #opening = false;
  #periodicFlush = 0;
  #periodicFlushTimer: NodeJS.Timeout | undefined = undefined;
  #sync = false;
  #fsync = false;
  #append = true;
  #mode;
  #retryEAGAIN: (err: unknown, writeBufferLen: number, remainingBufferLen: number) => boolean = () => true;
  #mkdir = false;
  #maxWriteRetries = 0;
  #writeRetries = 0;
  #writingBuf: any = "";
  #write: (data: string | NodeJS.ArrayBufferView) => boolean;
  #flush: (cb: FlushCallback) => void;
  #flushSync: () => void;
  #actualWrite: () => void;
  #fsWriteSync: () => number;
  #fsWrite: () => void;
  #fs: StreamFs;

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
      maxWriteRetries,
      fsync,
      contentMode = kContentModeUtf8,
      mode,
      // Provides for a custom fs implementation. Mostly useful for testing.
      fs: overrideFs = kEmptyObject,
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
    this.#maxWriteRetries = maxWriteRetries || 0;

    validateUint32(this.#hwm, "options.hwm");
    validateUint32(this.#minLength, "options.minLength");
    validateUint32(this.#maxLength, "options.maxLength");
    validateUint32(this.#maxWrite, "options.maxWrite");
    validateUint32(this.#periodicFlush, "options.periodicFlush");
    validateUint32(this.#maxWriteRetries, "options.maxWriteRetries");
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
      this.#periodicFlushTimer = setInterval(() => {
        if (this.#flushPending === 0 && this.#flushInProgress === 0) {
          this.flush();
        }
      }, this.#periodicFlush);
      this.#periodicFlushTimer!.unref();
    }
  }

  write(data) {
    return this.#write(data);
  }

  flush(cb: FlushCallback = function (_err) {}) {
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
      this.once("ready", () => {
        if (!this.#destroyed) this.reopen(file);
      });
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
        if (!this.#destroyed) this.end();
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
      this.#finishEnding();
    }
  }

  destroy() {
    if (this.#destroyed) {
      return;
    }
    const opening = this.#opening;
    this.#actualClose();
    if (opening && this.#flushPending > 0) {
      this.emit("error", $ERR_INVALID_STATE("Utf8Stream is destroyed"));
    }
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
      const isRetryableErr = err.code === "EAGAIN" || err.code === "EBUSY";
      if (isRetryableErr) {
        this.#writeRetries++;
      }
      const retriesExhausted = this.#maxWriteRetries > 0 && this.#writeRetries > this.#maxWriteRetries;

      if (
        isRetryableErr &&
        !retriesExhausted &&
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
          this.#retryTimer = setTimeout(Utf8Stream.#retryWrite, BUSY_WRITE_TIMEOUT, this);
        }
      } else {
        this.#writing = false;

        this.emit("error", err);
      }
      return;
    }

    // Reset the retry counter only once real forward progress (n > 0) is
    // confirmed. Otherwise a stuck destination would never accumulate past
    // one retry and `maxWriteRetries` could never trigger.
    if (n > 0) {
      this.#writeRetries = 0;
    }

    const releasedBufObj = releaseWritingBuf(this.#writingBuf, this.#len, n);
    this.#len = releasedBufObj.len;
    this.#writingBuf = releasedBufObj.writingBuf;

    // Emit 'write' after the written bytes have been released so that a
    // listener calling flushSync() sees a consistent state with no I/O in
    // flight. flushSync() may consume the remainder of #writingBuf.
    this.#emittingWrite = true;
    try {
      this.emit("write", n);
    } finally {
      this.#emittingWrite = false;
    }

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

    if (this.#destroyed) {
      this.#writing = false;
      if (this.#flushPending > 0) {
        if (this.#len === 0) {
          this.#scheduleDrain();
        } else {
          this.emit("error", $ERR_INVALID_STATE("Utf8Stream is destroyed"));
        }
      }
      return;
    }

    if (this.#fsync) {
      this.#fs.fsyncSync(this.#fd);
    }

    const len = this.#len;
    if (this.#reopening) {
      this.#writing = false;
      this.#reopening = false;
      this.reopen();
    } else if (len > 0 && (len > this.#minLength || this.#flushPending)) {
      this.#actualWrite();
    } else if (this.#ending) {
      if (len > 0) {
        this.#actualWrite();
      } else {
        this.#writing = false;
        this.#finishEnding();
      }
    } else {
      this.#writing = false;
      this.#scheduleDrain();
    }
  }

  // Node schedules these two with an arrow function at the call site. A static
  // method keeps #release() and #scheduleDrain() free of a closure, so a
  // completed write allocates no scope for it.
  static #retryWrite(stream: Utf8Stream) {
    stream.#retryTimer = null;
    stream.#fsWrite();
  }

  static #drainTick(stream: Utf8Stream) {
    stream.#emitDrain();
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
      if (!this.#writing && (this.#len > this.#minLength || this.#flushPending)) {
        this.#actualWrite();
      } else if (reopening && !this.#writing) {
        // Do not emit 'drain' if a 'ready' listener started a write:
        // #release() will emit the real 'drain' when that write completes.
        process.nextTick(Utf8Stream.#drainTick, this);
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

  #scheduleDrain() {
    if (this.#sync) {
      if (!this.#asyncDrainScheduled) {
        this.#asyncDrainScheduled = true;
        process.nextTick(Utf8Stream.#drainTick, this);
      }
    } else {
      this.#emitDrain();
    }
  }

  #emitDrain() {
    this.#asyncDrainScheduled = false;
    if (this.#writing) return;
    // Node emits kFlush here without the test. Only a pending flush() listens
    // for it, so the test saves an emit() per completed write.
    if (this.#flushPending > 0) this.#emitFlush();
    if (this.#writing || this.#destroyed) return;
    const hasListeners = this.listenerCount("drain") > 0;
    if (!hasListeners) return;
    this.emit("drain");
  }

  #finishEnding() {
    if (!this.#ending || this.#writing || this.#destroyed) return;
    if (this.#len > 0) {
      this.#actualWrite();
      return;
    }
    if (this.#flushPending > 0) this.#emitFlush();
    if (this.#flushPending === 0 && this.#flushInProgress === 0 && !this.#writing && this.#len === 0) {
      this.#actualClose();
    }
  }

  #emitFlush() {
    if (this.#emittingFlush) return;
    this.#emittingFlush = true;
    try {
      this.emit(kFlush);
    } finally {
      this.#emittingFlush = false;
    }
  }

  #actualClose() {
    if (this.#destroyed) return;

    if (this.#fd === -1) {
      this.#destroyed = true;
      this.once("ready", () => {
        this.#destroyed = false;
        this.#actualClose();
      });
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

  /**
   * Validates that flushSync() can run and determines how it must interact
   * with any write already in progress.
   * @returns One of the kFlushSync* states.
   */
  #beginFlushSync() {
    if (this.#destroyed) {
      throw $ERR_INVALID_STATE("Utf8Stream is destroyed");
    }

    if (this.#fd < 0) {
      throw $ERR_INVALID_STATE("Invalid file descriptor");
    }

    // While reopening, #writing is set but no write is in flight and #fd still
    // refers to the previous file, which is only closed once the new file is
    // ready. Flush the buffered data to it.
    if (!this.#writing || this.#opening) {
      return kFlushSyncIdle;
    }

    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
      return kFlushSyncRetry;
    }

    if (this.#emittingWrite) {
      return kFlushSyncInWriteEvent;
    }

    return kFlushSyncInFlight;
  }

  /**
   * Called after flushSync() has taken over a write whose retry timer it
   * cancelled. Resumes whatever #release() would have done once that write
   * completed.
   */
  #endFlushSyncRetry() {
    this.#writing = false;
    process.nextTick(() => {
      if (this.#destroyed || this.#writing) return;
      if (this.#reopening) {
        this.#reopening = false;
        this.reopen();
      } else if (this.#ending) {
        this.#finishEnding();
      } else if (this.#len > 0 && (this.#len > this.#minLength || this.#flushPending)) {
        this.#actualWrite();
      } else {
        this.#emitDrain();
      }
    });
  }

  #flushBufferSync() {
    const state = this.#beginFlushSync();

    // Unless an fs.write() of #writingBuf is in flight, its unwritten
    // remainder must be written first to preserve ordering.
    if (state !== kFlushSyncInFlight && this.#writingBuf.length > 0) {
      this.#bufs.unshift([this.#writingBuf]);
      this.#lens.unshift(this.#writingBuf.length);
      this.#writingBuf = kEmptyBuffer;
    }

    try {
      let buf: Buffer = kEmptyBuffer;
      while (this.#bufs.length || buf.length) {
        if (buf.length <= 0) {
          buf = mergeBuf(this.#bufs[0], this.#lens[0]);
        }
        try {
          const n = this.#fs.writeSync(this.#fd, buf);
          this.#writeRetries = 0;
          buf = buf.subarray(n);
          this.#len = Math.max(this.#len - n, 0);
          if (buf.length <= 0) {
            this.#bufs.shift();
            this.#lens.shift();
          }
        } catch (err) {
          const shouldRetry =
            (err as NodeJS.ErrnoException).code === "EAGAIN" || (err as NodeJS.ErrnoException).code === "EBUSY";
          if (shouldRetry) {
            this.#writeRetries++;
          }
          const retriesExhausted = this.#maxWriteRetries > 0 && this.#writeRetries > this.#maxWriteRetries;
          if (!shouldRetry || retriesExhausted || !this.#retryEAGAIN(err, buf.length, this.#len - buf.length)) {
            throw err;
          }

          sleep(BUSY_WRITE_TIMEOUT);
        }
      }
    } finally {
      if (state === kFlushSyncRetry) this.#endFlushSyncRetry();
    }
  }

  #flushSyncUtf8() {
    const state = this.#beginFlushSync();

    try {
      this.#flushSyncUtf8Bufs(state);
    } finally {
      if (state === kFlushSyncRetry) this.#endFlushSyncRetry();
    }

    try {
      this.#fs.fsyncSync(this.#fd);
    } catch {
      // Skip the error. The fd might not support fsync.
    }
  }

  #flushSyncUtf8Bufs(state: number) {
    // Unless an fs.write() of #writingBuf is in flight, its unwritten
    // remainder must be written first to preserve ordering.
    if (state !== kFlushSyncInFlight && this.#writingBuf.length > 0) {
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
        this.#writeRetries = 0;
        const releasedBufObj = releaseWritingBuf(buf, this.#len, n);
        buf = releasedBufObj.writingBuf;
        this.#len = releasedBufObj.len;
        if (buf.length <= 0) {
          this.#bufs.shift();
        }
      } catch (err) {
        const shouldRetry =
          (err as NodeJS.ErrnoException).code === "EAGAIN" || (err as NodeJS.ErrnoException).code === "EBUSY";
        if (shouldRetry) {
          this.#writeRetries++;
        }
        const retriesExhausted = this.#maxWriteRetries > 0 && this.#writeRetries > this.#maxWriteRetries;
        if (!shouldRetry || retriesExhausted || !this.#retryEAGAIN(err, buf.length, this.#len - buf.length)) {
          throw err;
        }

        sleep(BUSY_WRITE_TIMEOUT);
      }
    }
  }

  #callFlushCallbackOnDrain(cb: FlushCallback) {
    this.#flushPending++;
    let waiting = true;
    let completed = false;
    let flushing = false;
    const stopWaiting = () => {
      if (!waiting) return false;
      waiting = false;
      this.off(kFlush, onDrain);
      this.off("error", onError);
      return true;
    };
    const complete = (err?: Error | null, finish = true) => {
      if (completed) return;
      completed = true;
      if (flushing) this.#flushInProgress--;
      try {
        cb(err);
      } finally {
        if (finish) this.#finishEnding();
      }
    };
    const onDrain = () => {
      if (!stopWaiting()) return;
      this.#flushPending--;
      this.#flushInProgress++;
      flushing = true;
      // Only if fsync is false to avoid double fsync
      if (!this.#fsync && !this.#destroyed) {
        try {
          this.#fs.fsync(this.#fd, err => {
            // Ignore errors meaning the fd is closed or cannot be synced
            // (e.g. stdout/stderr attached to a pipe or TTY). A regular
            // file, including a redirected stdout/stderr, is still synced.
            if (isIgnorableFsyncError(err)) {
              complete();
              return;
            }
            complete(err);
          });
        } catch (err) {
          complete(err as Error);
        }
      } else {
        complete();
      }
    };
    const onError = (err: Error) => {
      if (!stopWaiting()) return;
      this.#flushPending--;
      complete(err, false);
    };

    this.once(kFlush, onDrain);
    this.once("error", onError);
  }

  #flushBuffer(cb: FlushCallback) {
    validateFunction(cb, "cb");

    if (this.#destroyed) {
      const error = $ERR_INVALID_STATE("Utf8Stream is destroyed");
      if (cb) {
        cb(error);
        return;
      }

      throw error;
    }

    if (this.#minLength <= 0 && !this.#writing && this.#len === 0) {
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

  #flushUtf8(cb: FlushCallback) {
    validateFunction(cb, "cb");

    if (this.#destroyed) {
      const error = $ERR_INVALID_STATE("Utf8Stream is destroyed");
      if (cb) {
        cb(error);
        return;
      }

      throw error;
    }

    if (this.#minLength <= 0 && !this.#writing && this.#len === 0) {
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

    if (!isArrayBufferView(data)) {
      throw $ERR_INVALID_ARG_TYPE("data", ["Buffer", "TypedArray", "DataView"], data);
    }
    if (!Buffer.isBuffer(data)) {
      // Reinterpret the view as a byte-oriented Buffer without copying, so that
      // `data.length` below (and everywhere else `bufs`/`lens` are consumed)
      // reflects the byte length rather than the element count.
      data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
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
      bufs.push([data]);
      lens.push(dataLength);
    } else {
      (bufs[bufs.length - 1] as Uint8Array[]).push(data);
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
function releaseWritingBuf<T extends string | Buffer>(writingBuf: T, len: number, n: number) {
  if (typeof writingBuf === "string") {
    const byteLength = Buffer.byteLength(writingBuf);
    // `fs.write` returns the number of bytes written, but `len` is tracked in
    // characters and `writingBuf` is sliced by character index below, so `n`
    // must be converted from bytes to characters in both cases.
    if (byteLength === n) {
      // The whole string was written: advance past every character.
      n = writingBuf.length;
    } else {
      // A partial write may split a multi-byte UTF-8 character, so we must back
      // up to the start of that character to avoid data corruption.
      const buf: Buffer = Buffer.from(writingBuf);
      // UTF-8 continuation bytes have the pattern 10xxxxxx (0x80-0xBF).
      while (n > 0 && (buf[n] & 0xc0) === 0x80) {
        n--;
      }
      n = buf.subarray(0, n).toString().length;
    }
  }
  len = Math.max(len - n, 0);
  writingBuf = writingBuf.slice(n) as T;
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
