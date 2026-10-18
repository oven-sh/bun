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

// What flushSync() finds, as in Node's #beginFlushSync().
// No write is in flight.
const kFlushSyncIdle = 0;
// An EAGAIN/EBUSY retry timer was pending and is now cancelled.
const kFlushSyncRetry = 1;
// Called from a 'write' listener: the write that completed is released.
const kFlushSyncInWriteEvent = 2;
// An asynchronous fs.write() of #writingBuf is in flight. Only the queued
// chunks can be written.
const kFlushSyncInFlight = 3;

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
  #periodicFlushTimer: ReturnType<typeof setInterval> | undefined = undefined;
  #sync = false;
  #fsync = false;
  #append = true;
  #mode;
  #retryEAGAIN: (err: unknown, writeBufferLen: number, remainingBufferLen: number) => boolean = () => true;
  #mkdir = false;
  #writingBuf: any = "";
  // utf8 mode, after a short write that ended inside a character: #writingBuf
  // is the encoded rest of the chunk from the first byte of that character,
  // #skip counts its leading bytes that the fd already took, and #units is what
  // it still holds in #len. #headSkip is the same count for the text in #bufs[0].
  #skip = 0;
  #units = 0;
  #headSkip = 0;
  #contentMode = kContentModeUtf8;
  #emittingWrite = false;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.#contentMode = contentMode;

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
        const chunk = this.#writingBuf;
        return typeof chunk === "string"
          ? this.#fs.writeSync(this.#fd, chunk, "utf8")
          : this.#fs.writeSync(this.#fd, chunk, this.#skip);
      }.bind(this);
      this.#fsWrite = function fsWriteUtf8(this: Utf8Stream) {
        const chunk = this.#writingBuf;
        return typeof chunk === "string"
          ? this.#fs.write(this.#fd, chunk, "utf8", boundRelease)
          : this.#fs.write(this.#fd, chunk, this.#skip, boundRelease);
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

  flush(cb: ((err?: Error | null) => void) | null = function (_err) {}) {
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
    return this.#contentMode;
  }

  get mkdir() {
    return this.#mkdir;
  }

  [Symbol.dispose]() {
    this.destroy();
  }

  #release(err?, n?) {
    if (err) {
      const writingLen = this.#writingLen();
      if (
        (err.code === "EAGAIN" || err.code === "EBUSY") &&
        this.#retryEAGAIN(err, writingLen, this.#len - writingLen)
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
          this.#retryTimer = setTimeout(() => {
            this.#retryTimer = null;
            this.#fsWrite();
          }, BUSY_WRITE_TIMEOUT);
        }
      } else {
        this.#writing = false;

        this.emit("error", err);
      }
      return;
    }

    this.#advance(n);

    // As Node since nodejs/node#66473: 'write' comes after the release, so a
    // listener that calls flushSync() finds no write in flight and flushSync()
    // can write the rest of #writingBuf before the queue.
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
          this.#advance(this.#fsWriteSync());
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

  // What #writingBuf holds in #len: code units in utf8 mode, bytes in buffer mode.
  #writingLen() {
    const chunk = this.#writingBuf;
    return typeof chunk === "string" || this.#contentMode === kContentModeBuffer ? chunk.length : this.#units;
  }

  // Releases the n bytes that fs.write took from #writingBuf.
  #advance(n) {
    const chunk = this.#writingBuf;
    let bytes, end, held;
    if (typeof chunk === "string") {
      if (typeof n !== "number" || Buffer.byteLength(chunk) === n) {
        this.#len = Math.max(this.#len - chunk.length, 0);
        this.#writingBuf = "";
        return;
      }
      if (n === 0) return;
      bytes = Buffer.from(chunk);
      end = n;
      held = chunk.length;
    } else if (this.#contentMode === kContentModeBuffer) {
      this.#len = Math.max(this.#len - n, 0);
      this.#writingBuf = chunk.slice(n);
      return;
    } else {
      if (n === 0) return;
      bytes = chunk;
      end = typeof n === "number" ? this.#skip + n : bytes.length;
      held = this.#units;
    }

    if (end >= bytes.length) {
      this.#len = Math.max(this.#len - held, 0);
      this.#writingBuf = "";
      this.#skip = 0;
      this.#units = 0;
      return;
    }

    const start = characterStart(bytes, end);
    const done = bytes.toString("utf8", 0, start).length;
    this.#len = Math.max(this.#len - done, 0);
    if (start === end && typeof chunk === "string") {
      this.#writingBuf = chunk.slice(done);
      return;
    }

    // Node v26.3.0 and Node main keep the rest as text from the cut character
    // and write it with fs.write(fd, text, "utf8"), so the bytes of that
    // character that the fd already took go out a second time. The rest stays
    // encoded here (pinojs/sonic-boom#238), as a view from the cut character,
    // and the write starts at #skip. test-fastutf8stream-partial-write-utf8.js
    // expects the data of the next write to start with that character.
    this.#writingBuf = bytes.subarray(start);
    this.#skip = end - start;
    this.#units = held - done;
  }

  // #writingBuf is the text that flushSync() left in #bufs[0] with #headSkip
  // bytes of its first character written.
  #encodeHead() {
    const head = this.#writingBuf;
    this.#writingBuf = Buffer.from(head);
    this.#skip = this.#headSkip;
    this.#units = head.length;
    this.#headSkip = 0;
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
      // A new file gets the whole character, as in Node.
      this.#skip = 0;
      this.#headSkip = 0;
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
        // A 'ready' listener may have started a write; that write's completion
        // emits 'drain', so don't announce an empty buffer while it is in flight.
        process.nextTick(() => {
          if (!this.#writing) this.emit("drain");
        });
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
    this.#headSkip = 0;

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
      // in #advance.
      this.#writingBuf = Buffer.from(this.#writingBuf);
      this.#fsWrite();
    }
  }

  #actualWriteUtf8() {
    this.#writing = true;
    if (!this.#writingBuf) {
      this.#writingBuf = this.#bufs.shift() || "";
      if (this.#headSkip !== 0) this.#encodeHead();
    }

    if (this.#sync) {
      try {
        const chunk = this.#writingBuf;
        const written =
          typeof chunk === "string"
            ? this.#fs.writeSync(this.#fd, chunk, "utf8")
            : this.#fs.writeSync(this.#fd, chunk, this.#skip);
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
        const shouldRetry =
          (err as NodeJS.ErrnoException).code === "EAGAIN" || (err as NodeJS.ErrnoException).code === "EBUSY";
        if (shouldRetry && !this.#retryEAGAIN(err, buf.length, this.#len - buf.length)) {
          throw err;
        }

        sleep(BUSY_WRITE_TIMEOUT);
      }
    }
  }

  #beginFlushSync() {
    if (this.#destroyed) {
      throw $ERR_INVALID_STATE("Utf8Stream is destroyed");
    }

    if (this.#fd < 0) {
      throw $ERR_INVALID_STATE("Invalid file descriptor");
    }

    // While reopening, #writing is set but no write is in flight and #fd is
    // still the previous file.
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

  // flushSync() took over the write whose retry timer it cancelled. Continues
  // with what #release() does after that write.
  #endFlushSyncRetry() {
    this.#writing = false;
    process.nextTick(() => {
      if (this.#destroyed || this.#writing) return;
      if (this.#reopening) {
        this.#reopening = false;
        this.reopen();
      } else if (this.#len > this.#minLength) {
        this.#actualWrite();
      } else if (this.#ending) {
        if (this.#len > 0) {
          this.#actualWrite();
        } else {
          this.#actualClose();
        }
      } else {
        this.emit("drain");
      }
    });
  }

  #flushSyncUtf8() {
    const state = this.#beginFlushSync();

    // The chunk of an fs.write() in flight is set aside: only the queue can be
    // written, and that write's callback releases it later.
    const inFlight = state === kFlushSyncInFlight;
    const inFlightBuf = this.#writingBuf;
    const inFlightSkip = this.#skip;
    const inFlightUnits = this.#units;
    if (inFlight) {
      this.#writingBuf = "";
      this.#skip = 0;
      this.#units = 0;
    }

    // The rest of #writingBuf goes first, then the queue. The progress is in
    // #writingBuf after every write, so a throw loses none of it.
    try {
      for (;;) {
        if (!this.#writingBuf) {
          if (this.#bufs.length === 0) break;
          this.#writingBuf = this.#bufs.shift();
          if (this.#headSkip !== 0) this.#encodeHead();
        }
        try {
          this.#advance(this.#fsWriteSync());
        } catch (err) {
          const shouldRetry =
            (err as NodeJS.ErrnoException).code === "EAGAIN" || (err as NodeJS.ErrnoException).code === "EBUSY";
          const writingLen = this.#writingLen();
          if (shouldRetry && !this.#retryEAGAIN(err, writingLen, this.#len - writingLen)) {
            throw err;
          }

          sleep(BUSY_WRITE_TIMEOUT);
        }
      }
    } finally {
      // After a throw the rest goes back to the head of the queue, where a
      // later write() can append to it. It stays in #writingBuf only when the
      // head is itself partly written and owns #headSkip.
      const rest = this.#writingBuf;
      if (rest.length && this.#headSkip === 0) {
        if (typeof rest === "string") {
          this.#bufs.unshift(rest);
        } else {
          this.#bufs.unshift(rest.toString());
          this.#headSkip = this.#skip;
        }
        this.#writingBuf = "";
        this.#skip = 0;
        this.#units = 0;
      }
      if (inFlight) {
        this.#writingBuf = inFlightBuf;
        this.#skip = inFlightSkip;
        this.#units = inFlightUnits;
      } else if (state === kFlushSyncRetry) {
        this.#endFlushSyncRetry();
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

// The offset of the first byte of the character that holds the byte at `end`.
function characterStart(bytes, end) {
  // UTF-8 continuation bytes have the pattern 10xxxxxx (0x80-0xBF).
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
    end--;
  }
  return end;
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
