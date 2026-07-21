// Hardcoded module "node:fs/promises"
const types = require("node:util/types");
const EventEmitter = require("node:events");
const fs = require("internal/fs/binding") as $ZigGeneratedClasses.NodeJSFS;
const { Glob } = require("internal/fs/glob");
const {
  validateInteger,
  validateBoolean,
  validateObject,
  validateAbortSignal,
  validateEncoding,
} = require("internal/validators");

const constants = $processBindingConstants.fs;

var PromisePrototypeFinally = $Promise.prototype.finally; //TODO
var SymbolAsyncDispose = Symbol.asyncDispose;
var ObjectFreeze = Object.freeze;

const kFd = Symbol("kFd");
const kRefs = Symbol("kRefs");
const kClosePromise = Symbol("kClosePromise");
const kCloseResolve = Symbol("kCloseResolve");
const kCloseReject = Symbol("kCloseReject");
const kRef = Symbol("kRef");
const kUnref = Symbol("kUnref");
const kTransfer = Symbol("kTransfer");
const kTransferList = Symbol("kTransferList");
const kDeserialize = Symbol("kDeserialize");
const kEmptyObject = ObjectFreeze(Object.create(null));
const kFlag = Symbol("kFlag");
const kLocked = Symbol("kLocked");
const kCloseSync = Symbol("kCloseSync");

var SymbolDispose = Symbol.dispose;

// Default chunk size for FileHandle.pull/pullSync/writer (matches Node.js).
const kIterDefaultChunkSize = 131072;

let nodeFsForIter; // lazy value for require("node:fs") (sync read/write/close for pull/writer).

let Interface; // lazy value for require("node:readline").Interface.

function watch(
  filename: string | Buffer | URL,
  options: {
    encoding?: BufferEncoding;
    persistent?: boolean;
    recursive?: boolean;
    signal?: AbortSignal;
  } = {},
) {
  type Event = {
    eventType: string;
    filename: string | Buffer | undefined;
  };

  if (filename instanceof URL) {
    throw new TypeError("Watch URLs are not supported yet");
  } else if (Buffer.isBuffer(filename)) {
    filename = filename.toString();
  } else if (typeof filename !== "string") {
    throw $ERR_INVALID_ARG_TYPE("filename", ["string", "Buffer", "URL"], filename);
  }
  let nextEventResolve: Function | null = null;
  if (typeof options === "string") {
    options = { encoding: options };
  }
  const queue = $createFIFO();
  const ignoreMatcher = require("internal/fs/watch").createIgnoreMatcher(options?.ignore);
  const signal = options?.signal;
  validateAbortSignal(signal, "options.signal");
  function makeAbortError() {
    return $makeAbortError(undefined, { cause: signal!.reason });
  }

  // node never creates the native handle when the signal is already
  // aborted (its async generator throws on first next() before opening
  // it); creating one here would leak it, since the "abort" event never
  // fires for a pre-aborted signal.
  if (signal?.aborted) {
    return {
      [Symbol.asyncIterator]() {
        let closed = false;
        return {
          async next() {
            if (closed) return { value: undefined, done: true };
            closed = true;
            throw makeAbortError();
          },
          return() {
            closed = true;
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  const watcher = fs.watch(filename, options || {}, (eventType: string, filename: string | Buffer | undefined) => {
    if (eventType !== "close" && eventType !== "error" && filename != null && ignoreMatcher?.(filename)) {
      return;
    }
    queue.push({ __proto__: null, eventType, filename });
    if (nextEventResolve) {
      const resolve = nextEventResolve;
      nextEventResolve = null;
      resolve();
    }
  });

  function onAbort() {
    watcher.close();
    if (nextEventResolve) {
      const resolve = nextEventResolve;
      nextEventResolve = null;
      resolve();
    }
  }
  signal?.addEventListener("abort", onAbort, { once: true });
  // {once: true} only auto-removes when the event fires; detach explicitly on
  // the other exit paths so a long-lived signal doesn't retain this closure.
  function removeAbortListener() {
    signal?.removeEventListener("abort", onAbort);
  }

  return {
    [Symbol.asyncIterator]() {
      let closed = false;
      return {
        async next() {
          while (!closed) {
            if (signal?.aborted) {
              closed = true;
              throw makeAbortError();
            }
            let event: Event;
            while ((event = queue.shift() as Event)) {
              if (event.eventType === "close") {
                closed = true;
                removeAbortListener();
                return { value: undefined, done: true };
              }
              if (event.eventType === "error") {
                closed = true;
                removeAbortListener();
                throw event.filename;
              }
              return { value: event, done: false };
            }
            const { promise, resolve } = Promise.withResolvers();
            nextEventResolve = resolve;
            await promise;
          }
          return { value: undefined, done: true };
        },

        return() {
          if (!closed) {
            watcher.close();
            closed = true;
            removeAbortListener();
            if (nextEventResolve) {
              const resolve = nextEventResolve;
              nextEventResolve = null;
              resolve();
            }
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

// attempt to use the native code version if possible
// and on MacOS, simple cases of recursive directory trees can be done in a single `clonefile()`
// using filter and other options uses a lazily loaded js fallback ported from node.js
async function cp(src, dest, options) {
  const { validateCpOptions } = require("internal/fs/cp-sync");
  const { getValidatedFsPath } = require("internal/validators");
  options = validateCpOptions(options);
  src = getValidatedFsPath(src, "src");
  dest = getValidatedFsPath(dest, "dest");
  const { filter, dereference, preserveTimestamps, verbatimSymlinks, mode, errorOnExist, force, recursive } = options;
  if (!filter && !dereference && !preserveTimestamps && !verbatimSymlinks && !mode && !errorOnExist && force) {
    const { ok, checked } = await require("internal/fs/cp").tryNativeFastPath(src, dest, options);
    if (ok) {
      return fs.cp(src, dest, recursive, errorOnExist, force, mode);
    }
    return require("internal/fs/cp").cpFn(src, dest, options, checked);
  }
  return require("internal/fs/cp").cpFn(src, dest, options);
}

function settleFromNodeCallback(resolve, reject, err, value) {
  if (err) reject(err);
  else resolve(value);
}

async function opendir(dir: string, options) {
  // Delegate to the callback form so the eager path check (ENOTDIR/ENOENT at
  // open time, like node) runs on an async stat instead of blocking.
  const { promise, resolve, reject } = Promise.withResolvers();
  require("node:fs").opendir(dir, options, settleFromNodeCallback.bind(null, resolve, reject));
  return promise;
}

// Node.js closes a FileHandle's fd in its native finalizer and raises
// ERR_INVALID_STATE (DEP0137 end-of-life) when collected without close().
// Mirror that with a FinalizationRegistry so dropped handles don't leak fds.
let fileHandleRegistry: FinalizationRegistry<{ fd: number; path: string | undefined }> | undefined;
function onFileHandleCollected(held: { fd: number; path: string | undefined }) {
  try {
    fs.closeSync(held.fd);
  } catch {}
  const suffix = held.path !== undefined ? ` (${held.path})` : "";
  const err: NodeJS.ErrnoException = new Error(
    "A FileHandle object was closed during garbage collection. This used to be allowed " +
      "with a deprecation warning but is now considered an error. Please close FileHandle " +
      `objects explicitly. File descriptor: ${held.fd}${suffix}`,
  );
  err.code = "ERR_INVALID_STATE";
  process.nextTick(() => {
    throw err;
  });
}

const private_symbols = {
  kRef,
  kUnref,
  kFd,
  kTransfer,
  kTransferList,
  kDeserialize,
  FileHandle: null as any,
};

const _readFile = fs.readFile.bind(fs);
const _writeFile = fs.writeFile.bind(fs);
const _appendFile = fs.appendFile.bind(fs);

// Argument validation must run at the first .next(), not at call time: Node's
// fs/promises glob is an async generator whose body constructs Glob lazily.
async function* glob(pattern, options) {
  yield* new Glob(pattern, options).glob();
}

const exports = {
  access: asyncWrap(fs.access, "access"),
  appendFile: async function (fileHandleOrFdOrPath, ...args) {
    fileHandleOrFdOrPath = fileHandleOrFdOrPath?.[kFd] ?? fileHandleOrFdOrPath;
    return _appendFile(fileHandleOrFdOrPath, ...args);
  },
  close: asyncWrap(fs.close, "close"),
  copyFile: asyncWrap(fs.copyFile, "copyFile"),
  cp,
  exists: async function exists() {
    try {
      return await fs.exists.$apply(fs, arguments);
    } catch {
      return false;
    }
  },
  chown: asyncWrap(fs.chown, "chown"),
  chmod: asyncWrap(fs.chmod, "chmod"),
  fchmod: asyncWrap(fs.fchmod, "fchmod"),
  fchown: asyncWrap(fs.fchown, "fchown"),
  fstat: asyncWrap(fs.fstat, "fstat"),
  fsync: asyncWrap(fs.fsync, "fsync"),
  fdatasync: asyncWrap(fs.fdatasync, "fdatasync"),
  ftruncate: asyncWrap(fs.ftruncate, "ftruncate"),
  futimes: asyncWrap(fs.futimes, "futimes"),
  glob,
  lchmod: asyncWrap(fs.lchmod, "lchmod"),
  lchown: asyncWrap(fs.lchown, "lchown"),
  link: asyncWrap(fs.link, "link"),
  lstat: asyncWrap(fs.lstat, "lstat"),
  mkdir: asyncWrap(fs.mkdir, "mkdir"),
  mkdtemp: asyncWrap(fs.mkdtemp, "mkdtemp"),
  mkdtempDisposable: async function mkdtempDisposable(prefix, options) {
    const path = await fs.mkdtemp(prefix, options);
    // Stash the full path in case of process.chdir()
    const fullPath = require("node:path").resolve(path);
    async function remove() {
      // force makes repeated removal a no-op; real failures (EACCES) still throw
      await fs.rm(fullPath, { recursive: true, force: true });
    }
    return { path, remove, [Symbol.asyncDispose]: remove };
  },
  statfs: asyncWrap(fs.statfs, "statfs"),
  open: async (path, flags = "r", mode = 0o666) => {
    // Snapshot the path as a string before the fd is opened so a throwing
    // Buffer/URL toString cannot leak the fd, and the registry never retains
    // the caller's object.
    const pathForDiag = typeof path === "string" ? path : path == null ? undefined : String(path);
    return new private_symbols.FileHandle(await fs.open(path, flags, mode), flags, pathForDiag);
  },
  read: asyncWrap(fs.read, "read"),
  write: asyncWrap(fs.write, "write"),
  readdir: asyncWrap(fs.readdir, "readdir"),
  readFile: async function (fileHandleOrFdOrPath, ...args) {
    fileHandleOrFdOrPath = fileHandleOrFdOrPath?.[kFd] ?? fileHandleOrFdOrPath;
    return _readFile(fileHandleOrFdOrPath, ...args);
  },
  writeFile: async function (fileHandleOrFdOrPath, ...args: any[]) {
    fileHandleOrFdOrPath = fileHandleOrFdOrPath?.[kFd] ?? fileHandleOrFdOrPath;
    if (
      !$isTypedArrayView(args[0]) &&
      typeof args[0] !== "string" &&
      ($isCallable(args[0]?.[Symbol.iterator]) || $isCallable(args[0]?.[Symbol.asyncIterator]))
    ) {
      $debug("fs.promises.writeFile async iterator slow path!");
      // Node accepts an arbitrary async iterator here
      // @ts-expect-error
      return writeFileAsyncIterator(fileHandleOrFdOrPath, ...args);
    }
    return _writeFile(fileHandleOrFdOrPath, ...args);
  },
  readlink: asyncWrap(fs.readlink, "readlink"),
  realpath: asyncWrap(fs.realpath, "realpath"),
  rename: asyncWrap(fs.rename, "rename"),
  stat: asyncWrap(fs.stat, "stat"),
  symlink: asyncWrap(fs.symlink, "symlink"),
  truncate: asyncWrap(fs.truncate, "truncate"),
  unlink: asyncWrap(fs.unlink, "unlink"),
  utimes: asyncWrap(fs.utimes, "utimes"),
  lutimes: asyncWrap(fs.lutimes, "lutimes"),
  rm: async function rm(path, options) {
    if (!options?.recursive) {
      // node validates in JS and reports ERR_FS_EISDIR for directories
      // (same check as rmSync)
      let stats;
      try {
        stats = await fs.lstat(path);
      } catch {
        // let the native call produce the error (respects force/ENOENT)
      }
      if (stats?.isDirectory()) {
        throw require("internal/fs/cp-sync").fsEisdirError({
          code: "EISDIR",
          message: "is a directory",
          path,
          syscall: "rm",
          errno: $processBindingConstants.os.errno.EISDIR,
        });
      }
    }
    return fs.rm(path, options);
  },
  rmdir: async function rmdir(path, options) {
    // node throws for any defined `recursive`, not just truthy ones
    if (options?.recursive !== undefined) {
      throw $ERR_INVALID_ARG_VALUE("options.recursive", options.recursive, "is no longer supported");
    }
    return fs.rmdir(path, options);
  },
  writev: async (fd, buffers, position) => {
    var bytesWritten = await fs.writev(fd, buffers, position);
    return {
      bytesWritten,
      buffers,
    };
  },
  readv: async (fd, buffers, position) => {
    var bytesRead = await fs.readv(fd, buffers, position);

    return {
      bytesRead,
      buffers,
    };
  },
  constants,
  watch,
  opendir,

  // "$data" is reuse of private symbol
  // this is used to export the private symbols to internal/fs/streams and node:http2 without making them public.
  $data: private_symbols,
};
export default exports;

// TODO: remove this in favor of just returning js functions that don't check `this`
function asyncWrap(fn: any, name: string) {
  const wrapped = async function (...args) {
    return fn.$apply(fs, args);
  };
  Object.defineProperty(wrapped, "name", { value: name });
  Object.defineProperty(wrapped, "length", { value: fn.length });
  return wrapped;
}

{
  const {
    writeFile,
    readFile,
    fchmod,
    fchown,
    fdatasync,
    fsync,
    read,
    readv,
    fstat,
    ftruncate,
    futimes,
    write,
    writev,
    close,
  } = exports;
  let isArrayBufferView;

  // Partially taken from https://github.com/nodejs/node/blob/c25878d370/lib/internal/fs/promises.js#L148
  // These functions await the result so that errors propagate correctly with
  // async stack traces and so that the ref counting is correct.
  class FileHandle extends EventEmitter {
    constructor(fd, flag, path?: string) {
      super();
      this[kFd] = fd ? fd : -1;
      this[kRefs] = 1;
      this[kClosePromise] = null;
      this[kFlag] = flag;
      if (this[kFd] !== -1) {
        (fileHandleRegistry ??= new FinalizationRegistry(onFileHandleCollected)).register(this, { fd, path }, this);
      }
    }

    getAsyncId() {
      throw new Error("BUN TODO FileHandle.getAsyncId");
    }

    get fd() {
      return this[kFd];
    }

    [kCloseResolve];
    [kFd];
    [kFlag];
    [kClosePromise];
    [kRefs];
    // needs to exist for https://github.com/nodejs/node/blob/8641d941893/test/parallel/test-worker-message-port-transfer-fake-js-transferable.js to pass
    [Symbol("messaging_transfer_symbol")]() {}

    async appendFile(data, options) {
      const fd = this[kFd];
      throwEBADFIfNecessary("writeFile", fd);
      let encoding = "utf8";
      let flush = false;
      if (options == null || typeof options === "function") {
      } else if (typeof options === "string") {
        encoding = options;
      } else {
        encoding = options?.encoding ?? encoding;
        flush = options?.flush ?? flush;
      }

      try {
        this[kRef]();
        return await writeFile(fd, data, { encoding, flush, flag: this[kFlag] });
      } finally {
        this[kUnref]();
      }
    }

    async chmod(mode) {
      const fd = this[kFd];
      throwEBADFIfNecessary("fchmod", fd);

      try {
        this[kRef]();
        return await fchmod(fd, mode);
      } finally {
        this[kUnref]();
      }
    }

    async chown(uid, gid) {
      const fd = this[kFd];
      throwEBADFIfNecessary("fchown", fd);

      try {
        this[kRef]();
        return await fchown(fd, uid, gid);
      } finally {
        this[kUnref]();
      }
    }

    async datasync() {
      const fd = this[kFd];
      throwEBADFIfNecessary("fdatasync", fd);

      try {
        this[kRef]();
        return await fdatasync(fd);
      } finally {
        this[kUnref]();
      }
    }

    async sync() {
      const fd = this[kFd];
      throwEBADFIfNecessary("fsync", fd);

      try {
        this[kRef]();
        return await fsync(fd);
      } finally {
        this[kUnref]();
      }
    }

    async read(bufferOrParams, offset, length, position) {
      const fd = this[kFd];
      throwEBADFIfNecessary("read", fd);

      let buffer = bufferOrParams;
      if (!types.isArrayBufferView(buffer)) {
        // This is fh.read(params)
        if (bufferOrParams !== undefined) {
          // validateObject(bufferOrParams, 'options', kValidateObjectAllowNullable);
          if (typeof bufferOrParams !== "object" || $isArray(bufferOrParams)) {
            throw $ERR_INVALID_ARG_TYPE("options", "object", bufferOrParams);
          }
        }
        ({
          buffer = Buffer.alloc(16384),
          offset = 0,
          length = buffer.byteLength - offset,
          position = null,
        } = bufferOrParams ?? kEmptyObject);
      }

      if (offset !== null && typeof offset === "object") {
        // This is fh.read(buffer, options)
        ({ offset = 0, length = buffer?.byteLength - offset, position = null } = offset);
      }

      if (offset == null) {
        offset = 0;
      } else {
        validateInteger(offset, "offset", 0);
      }

      length ??= buffer?.byteLength - offset;

      try {
        this[kRef]();
        const bytesRead = await read(fd, buffer, offset, length, position);
        return { buffer, bytesRead };
      } finally {
        this[kUnref]();
      }
    }

    async readv(buffers, position) {
      const fd = this[kFd];
      throwEBADFIfNecessary("readv", fd);

      try {
        this[kRef]();
        return await readv(fd, buffers, position);
      } finally {
        this[kUnref]();
      }
    }

    async readFile(options) {
      const fd = this[kFd];
      throwEBADFIfNecessary("readFile", fd);

      try {
        this[kRef]();
        return await readFile(fd, options);
      } finally {
        this[kUnref]();
      }
    }

    readLines(options = undefined) {
      if (Interface === undefined) Interface = require("node:readline").Interface;
      return new Interface({
        input: this.createReadStream(options),
        crlfDelay: Infinity,
      });
    }

    async stat(options) {
      const fd = this[kFd];
      throwEBADFIfNecessary("fstat", fd);

      try {
        this[kRef]();
        return await fstat(fd, options);
      } finally {
        this[kUnref]();
      }
    }

    async truncate(len = 0) {
      const fd = this[kFd];
      throwEBADFIfNecessary("ftruncate", fd);

      try {
        this[kRef]();
        return await ftruncate(fd, len);
      } finally {
        this[kUnref]();
      }
    }

    async utimes(atime, mtime) {
      const fd = this[kFd];
      throwEBADFIfNecessary("futimes", fd);

      try {
        this[kRef]();
        return await futimes(fd, atime, mtime);
      } finally {
        this[kUnref]();
      }
    }

    async write(buffer, offset, length, position) {
      const fd = this[kFd];
      throwEBADFIfNecessary("write", fd);

      if (buffer?.byteLength === 0) return { __proto__: null, bytesWritten: 0, buffer };

      isArrayBufferView ??= require("node:util/types").isArrayBufferView;
      if (isArrayBufferView(buffer)) {
        if (typeof offset === "object") {
          ({ offset = 0, length = buffer.byteLength - offset, position = null } = offset ?? kEmptyObject);
        }

        if (offset == null) {
          offset = 0;
        }
        if (typeof length !== "number") length = buffer.byteLength - offset;
        if (typeof position !== "number") position = null;
      } else {
        // filehandle.write(string[, position[, encoding]]): `length` is the
        // encoding. Node rejects a non-string before it validates the encoding.
        if (typeof buffer !== "string") {
          throw $ERR_INVALID_ARG_TYPE("buffer", ["string", "Buffer", "TypedArray", "DataView"], buffer);
        }
        validateEncoding(buffer, length);
      }
      try {
        this[kRef]();
        return {
          buffer,
          bytesWritten: await write(fd, buffer, offset, length, position),
        };
      } finally {
        this[kUnref]();
      }
    }

    async writev(buffers, position) {
      const fd = this[kFd];
      throwEBADFIfNecessary("writev", fd);

      try {
        this[kRef]();
        return await writev(fd, buffers, position);
      } finally {
        this[kUnref]();
      }
    }

    async writeFile(data: string, options: any = "utf8") {
      const fd = this[kFd];
      throwEBADFIfNecessary("writeFile", fd);
      let encoding: string = "utf8";
      let signal: AbortSignal | undefined = undefined;

      if (options == null || typeof options === "function") {
      } else if (typeof options === "string") {
        encoding = options;
      } else {
        encoding = options?.encoding ?? encoding;
        signal = options?.signal ?? undefined;
      }

      try {
        this[kRef]();
        return await writeFile(fd, data, {
          encoding,
          flag: this[kFlag],
          signal,
        });
      } finally {
        this[kUnref]();
      }
    }

    async close() {
      const fd = this[kFd];
      if (fd === -1) {
        return Promise.$resolve();
      }

      if (this[kClosePromise]) {
        return this[kClosePromise];
      }

      fileHandleRegistry?.unregister(this);

      if (--this[kRefs] === 0) {
        this[kFd] = -1;
        this[kClosePromise] = PromisePrototypeFinally.$call(close(fd), () => {
          this[kClosePromise] = undefined;
        });
      } else {
        this[kClosePromise] = PromisePrototypeFinally.$call(
          new Promise((resolve, reject) => {
            this[kCloseResolve] = resolve;
            this[kCloseReject] = reject;
          }),
          () => {
            this[kClosePromise] = undefined;
            this[kCloseReject] = undefined;
            this[kCloseResolve] = undefined;
          },
        );
      }

      this.emit("close");
      return this[kClosePromise];
    }

    async [SymbolAsyncDispose]() {
      return this.close();
    }

    readableWebStream(_options = kEmptyObject) {
      const fd = this[kFd];
      throwEBADFIfNecessary("readableWebStream", fd);

      return Bun.file(fd).stream();
    }

    createReadStream(options = kEmptyObject) {
      const fd = this[kFd];
      throwEBADFIfNecessary("createReadStream", fd);
      return new (require("internal/fs/streams").ReadStream)(undefined, {
        highWaterMark: 64 * 1024,
        ...options,
        fd: this,
      });
    }

    createWriteStream(options = kEmptyObject) {
      const fd = this[kFd];
      throwEBADFIfNecessary("createWriteStream", fd);
      return new (require("internal/fs/streams").WriteStream)(undefined, {
        highWaterMark: 64 * 1024,
        ...options,
        fd: this,
      });
    }

    // Port of Node.js FileHandle.prototype.pull (lib/internal/fs/promises.js).
    // Returns the file contents as an AsyncIterable<Uint8Array[]> using the
    // iterable streams pull model. Optional transforms and options (including
    // AbortSignal) may be provided as trailing arguments.
    pull(...args) {
      if (this[kFd] === -1) throw $ERR_INVALID_STATE("The FileHandle is closed");
      if (this[kClosePromise]) throw $ERR_INVALID_STATE("The FileHandle is closing");
      if (this[kLocked]) throw $ERR_INVALID_STATE("The FileHandle is locked");

      const { parsePullArgs } = require("internal/streams/iter/utils");
      const { transforms, options = kEmptyObject } = parsePullArgs(args);

      const { autoClose = false, chunkSize: readSize = kIterDefaultChunkSize, signal } = options;
      let { start: pos = -1, limit: remaining = -1 } = options;

      const handle = this;
      const fd = this[kFd];

      validateBoolean(autoClose, "options.autoClose");

      if (pos !== -1) {
        validateInteger(pos, "options.start", 0);
      }
      if (remaining !== -1) {
        validateInteger(remaining, "options.limit", 1);
      }
      if (readSize !== undefined) {
        validateInteger(readSize, "options.chunkSize", 1);
      }
      if (signal !== undefined) {
        validateAbortSignal(signal, "options.signal");
      }

      if (signal?.aborted) {
        // Don't lock the handle: with transforms, the pull pipeline's
        // pre-abort branch returns a rejecting iterator without ever
        // consuming the source, so the unlock in its finally would never
        // run. Reject on first next() like the source itself would.
        return {
          __proto__: null,
          [Symbol.asyncIterator]() {
            let done = false;
            return {
              __proto__: null,
              async next() {
                if (done) return { value: undefined, done: true };
                done = true;
                if (autoClose) await handle.close();
                throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
              },
              async return() {
                if (!done) {
                  done = true;
                  if (autoClose) await handle.close();
                }
                return { value: undefined, done: true };
              },
            };
          },
        };
      }

      this[kLocked] = true;

      const source = {
        __proto__: null,
        async *[Symbol.asyncIterator]() {
          // The fd was captured when pull() was called; the handle may have
          // been closed in between (an unstarted source doesn't hold a ref).
          if (handle[kFd] === -1) throw $ERR_INVALID_STATE("The FileHandle is closed");
          handle[kRef]();
          try {
            while (remaining !== 0) {
              if (signal?.aborted) {
                throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
              }
              const toRead = remaining > 0 ? Math.min(readSize, remaining) : readSize;
              const buf = Buffer.allocUnsafe(toRead);
              const bytesRead = (await read(fd, buf, 0, toRead, pos >= 0 ? pos : null)) || 0;
              if (bytesRead === 0) break;
              if (pos >= 0) pos += bytesRead;
              if (remaining > 0) remaining -= bytesRead;
              yield [bytesRead < toRead ? buf.subarray(0, bytesRead) : buf];
            }
          } finally {
            handle[kLocked] = false;
            handle[kUnref]();
            if (autoClose) {
              await handle.close();
            }
          }
        },
      };

      // If transforms provided, wrap with pull pipeline
      if (transforms.length > 0) {
        const pullArgs = [...transforms];
        if (options) {
          pullArgs.push(options);
        }
        return require("internal/streams/iter/pull").pull(source, ...pullArgs);
      }
      return source;
    }

    // Port of Node.js FileHandle.prototype.pullSync. Returns the file
    // contents as an Iterable<Uint8Array[]> using synchronous reads.
    pullSync(...args) {
      if (this[kFd] === -1) throw $ERR_INVALID_STATE("The FileHandle is closed");
      if (this[kClosePromise]) throw $ERR_INVALID_STATE("The FileHandle is closing");
      if (this[kLocked]) throw $ERR_INVALID_STATE("The FileHandle is locked");

      const { parsePullArgs } = require("internal/streams/iter/utils");
      const { transforms, options = kEmptyObject } = parsePullArgs(args);

      const { autoClose = false, chunkSize: readSize = kIterDefaultChunkSize } = options;
      let { start: pos = -1, limit: remaining = -1 } = options;

      const handle = this;
      const fd = this[kFd];

      validateBoolean(autoClose, "options.autoClose");

      if (pos !== -1) {
        validateInteger(pos, "options.start", 0);
      }
      if (remaining !== -1) {
        validateInteger(remaining, "options.limit", 1);
      }
      if (readSize !== undefined) {
        validateInteger(readSize, "options.chunkSize", 1);
      }

      this[kLocked] = true;

      const fsSync = (nodeFsForIter ??= require("node:fs"));

      const source = {
        __proto__: null,
        [Symbol.iterator]() {
          // The fd was captured when pullSync() was called; the handle may
          // have been closed in between (an unstarted source doesn't hold a
          // ref).
          if (handle[kFd] === -1) throw $ERR_INVALID_STATE("The FileHandle is closed");
          // Acquire the ref per iteration (like pull()'s async generator), so
          // an iterable that is never consumed doesn't pin the handle open;
          // cleanup is idempotent so a stray next() after return() can't
          // double-unref.
          handle[kRef]();
          let done = false;
          let cleanedUp = false;
          function cleanup() {
            if (cleanedUp) return;
            cleanedUp = true;
            handle[kLocked] = false;
            handle[kUnref]();
            if (autoClose) {
              handle[kCloseSync]();
            }
          }
          return {
            __proto__: null,
            next() {
              if (done || remaining === 0) {
                if (!done) {
                  done = true;
                  cleanup();
                }
                return { value: undefined, done: true };
              }
              const toRead = remaining > 0 ? Math.min(readSize, remaining) : readSize;
              const buf = Buffer.allocUnsafe(toRead);
              let bytesRead;
              try {
                bytesRead = fsSync.readSync(fd, buf, 0, toRead, pos >= 0 ? pos : null) || 0;
              } catch (err) {
                done = true;
                cleanup();
                throw err;
              }
              if (bytesRead === 0) {
                done = true;
                cleanup();
                return { value: undefined, done: true };
              }
              if (pos >= 0) pos += bytesRead;
              if (remaining > 0) remaining -= bytesRead;
              const chunk = bytesRead < toRead ? buf.subarray(0, bytesRead) : buf;
              return { value: [chunk], done: false };
            },
            return() {
              if (!done) {
                done = true;
                cleanup();
              }
              return { value: undefined, done: true };
            },
          };
        },
      };

      if (transforms.length > 0) {
        return require("internal/streams/iter/pull").pullSync(source, ...transforms);
      }
      return source;
    }

    // Port of Node.js FileHandle.prototype.writer. Returns an iterable-streams
    // Writer backed by this file handle. Supports writev() for batch writes,
    // handles zero-byte writes with retry (up to 5 attempts).
    writer(options = kEmptyObject) {
      if (this[kFd] === -1) throw $ERR_INVALID_STATE("The FileHandle is closed");
      if (this[kClosePromise]) throw $ERR_INVALID_STATE("The FileHandle is closing");
      if (this[kLocked]) throw $ERR_INVALID_STATE("The FileHandle is locked");

      const { toUint8Array, convertChunks } = require("internal/streams/iter/utils");

      validateObject(options, "options");
      const { autoClose = false, chunkSize: syncWriteThreshold = kIterDefaultChunkSize } = options;
      let { start: pos = -1, limit: bytesRemaining = -1 } = options;

      const handle = this;
      const fd = this[kFd];
      let totalBytesWritten = 0;
      let closed = false;
      let closing = false;
      let pendingEndPromise = null;
      let error = null;
      // Count of in-flight async writes (write() doesn't serialize callers,
      // so several can be on the threadpool at once).
      let asyncPending = 0;
      // Set when end()/fail() must tear down while an async write is still on
      // the threadpool: writeAll/writevAll run it from their finally so the
      // fd is never closed under an in-flight write.
      let deferredTeardown: (() => void) | null = null;
      function runDeferredTeardown() {
        if (deferredTeardown !== null) {
          const teardown = deferredTeardown;
          deferredTeardown = null;
          teardown();
        }
      }

      validateBoolean(autoClose, "options.autoClose");

      if (pos !== -1) {
        validateInteger(pos, "options.start", 0);
      }
      if (bytesRemaining !== -1) {
        validateInteger(bytesRemaining, "options.limit", 1);
      }
      if (syncWriteThreshold !== undefined) {
        validateInteger(syncWriteThreshold, "options.chunkSize", 1);
      }

      this[kLocked] = true;
      // Acquire the ref on first actual write (like pull/pullSync defer it to
      // iteration) so an unused writer can't pin the handle and hang close().
      let refAcquired = false;
      function acquireRef() {
        if (!refAcquired) {
          refAcquired = true;
          handle[kRef]();
        }
      }
      function releaseRef() {
        if (refAcquired) {
          refAcquired = false;
          handle[kUnref]();
        }
      }

      const fsSync = (nodeFsForIter ??= require("node:fs"));

      // Write a single buffer with retry on zero-byte writes (up to 5 retries).
      async function writeAll(buf, offset, length, position, signal) {
        asyncPending++;
        try {
          let retries = 0;
          while (length > 0) {
            const bytesWritten = (await write(fd, buf, offset, length, position >= 0 ? position : null)) || 0;

            signal?.throwIfAborted();

            if (bytesWritten === 0) {
              if (++retries > 5) {
                throw $ERR_OPERATION_FAILED("Operation failed: write failed after retries");
              }
            } else {
              retries = 0;
            }

            totalBytesWritten += bytesWritten;
            offset += bytesWritten;
            length -= bytesWritten;
            if (position >= 0) position += bytesWritten;
          }
        } catch (err) {
          // A failed/aborted write may have hit the disk partially and the
          // cursor/limit were advanced optimistically; the writer's state is
          // no longer trustworthy, so poison it like fail() does.
          if (!closed && !error) error = err;
          throw err;
        } finally {
          if (--asyncPending === 0) {
            runDeferredTeardown();
          }
        }
      }

      // Writev with retry. On partial write, concatenates remaining
      // buffers and falls back to writeAll.
      async function writevAll(buffers, position, signal) {
        asyncPending++;
        try {
          let totalSize = 0;
          for (let i = 0; i < buffers.length; i++) {
            totalSize += buffers[i].byteLength;
          }

          let retries = 0;
          while (totalSize > 0) {
            const { bytesWritten } = await writev(fd, buffers, position >= 0 ? position : null);

            signal?.throwIfAborted();

            if (bytesWritten === 0) {
              // Retry the writev as-is on a zero-byte write (up to 5 times)
              // instead of degrading to the concat fallback below.
              if (++retries > 5) {
                throw $ERR_OPERATION_FAILED("Operation failed: writev failed after retries");
              }
              continue;
            }
            retries = 0;

            totalBytesWritten += bytesWritten;
            totalSize -= bytesWritten;
            if (position >= 0) position += bytesWritten;

            if (totalSize > 0) {
              // Partial write - concatenate remaining and use writeAll.
              const remaining = Buffer.concat(buffers);
              const wrote = bytesWritten;
              await writeAll(remaining, wrote, remaining.length - wrote, position, signal);
              return;
            }
          }
        } catch (err) {
          // See writeAll: the optimistic cursor/limit accounting is invalid
          // after a failure, so subsequent writes must reject.
          if (!closed && !error) error = err;
          throw err;
        } finally {
          if (--asyncPending === 0) {
            runDeferredTeardown();
          }
        }
      }

      // Synchronous write with retry. Throws on I/O error.
      function writeSyncAll(buf, offset, length, position) {
        let retries = 0;
        while (length > 0) {
          const bytesWritten = fsSync.writeSync(fd, buf, offset, length, position >= 0 ? position : null) || 0;
          if (bytesWritten === 0) {
            if (++retries > 5) {
              throw $ERR_OPERATION_FAILED("Operation failed: write failed after retries");
            }
          } else {
            retries = 0;
          }
          totalBytesWritten += bytesWritten;
          offset += bytesWritten;
          length -= bytesWritten;
          if (position >= 0) position += bytesWritten;
        }
      }

      function returnTotalBytesWritten() {
        return totalBytesWritten;
      }

      async function cleanup() {
        if (closed) return;
        closed = true;
        handle[kLocked] = false;
        if (asyncPending) {
          const { promise, resolve, reject } = Promise.withResolvers();
          deferredTeardown = function deferredCleanupTeardown() {
            releaseRef();
            if (autoClose) {
              handle.close().$then(resolve, reject);
            } else {
              resolve(undefined);
            }
          };
          return promise;
        }
        releaseRef();
        if (autoClose) {
          await handle.close();
        }
      }

      return {
        __proto__: null,
        write(chunk, options = kEmptyObject) {
          if (error) {
            return Promise.$reject(error);
          }
          if (closed) {
            return Promise.$reject($ERR_INVALID_STATE_TypeError("The writer is closed"));
          }
          if (handle[kFd] === -1) {
            // The handle was closed before this writer took its ref.
            return Promise.$reject($ERR_INVALID_STATE("The FileHandle is closed"));
          }
          validateObject(options, "options");
          const { signal } = options;
          if (signal !== undefined) {
            validateAbortSignal(signal, "options.signal");
            if (signal.aborted) {
              return Promise.$reject(signal.reason);
            }
          }
          chunk = toUint8Array(chunk);
          let chunkByteLength;
          if (bytesRemaining >= 0 && (chunkByteLength = chunk.byteLength) > bytesRemaining) {
            return Promise.$reject($ERR_OUT_OF_RANGE("write", `<= ${bytesRemaining} bytes`, chunkByteLength));
          }
          if (bytesRemaining > 0) bytesRemaining -= chunkByteLength;
          chunkByteLength ??= chunk.byteLength;
          const position = pos;
          if (pos >= 0) pos += chunkByteLength;
          acquireRef();
          return writeAll(chunk, 0, chunkByteLength, position, signal);
        },

        writev(chunks, options = kEmptyObject) {
          if (error) {
            return Promise.$reject(error);
          }
          if (closed) {
            return Promise.$reject($ERR_INVALID_STATE_TypeError("The writer is closed"));
          }
          if (handle[kFd] === -1) {
            return Promise.$reject($ERR_INVALID_STATE("The FileHandle is closed"));
          }
          validateObject(options, "options");
          const { signal } = options;
          if (signal !== undefined) {
            validateAbortSignal(signal, "options.signal");
            if (signal?.aborted) {
              return Promise.$reject(signal.reason);
            }
          }
          chunks = convertChunks(chunks);
          let totalSize = 0;
          for (let i = 0; i < chunks.length; i++) {
            totalSize += chunks[i].byteLength;
          }
          if (bytesRemaining >= 0 && totalSize > bytesRemaining) {
            return Promise.$reject($ERR_OUT_OF_RANGE("writev", `<= ${bytesRemaining} bytes`, totalSize));
          }
          if (bytesRemaining > 0) bytesRemaining -= totalSize;
          const position = pos;
          if (pos >= 0) pos += totalSize;
          acquireRef();
          return writevAll(chunks, position, signal);
        },

        writeSync(chunk) {
          if (error || closed || asyncPending) return false;
          if (handle[kFd] === -1) throw $ERR_INVALID_STATE("The FileHandle is closed");
          chunk = toUint8Array(chunk);
          const length = chunk.byteLength;
          if (length > syncWriteThreshold) return false;
          if (length === 0) return true;
          if (bytesRemaining >= 0 && length > bytesRemaining) return false;
          const position = pos;
          // First attempt - if this fails, return false so pipeTo can
          // fall back to async write().
          let bytesWritten;
          acquireRef();
          try {
            bytesWritten = fsSync.writeSync(fd, chunk, 0, length, position >= 0 ? position : null) || 0;
          } catch {
            return false;
          }
          totalBytesWritten += bytesWritten;
          if (position >= 0) {
            pos = position + bytesWritten;
          }
          if (bytesWritten === length) {
            if (bytesRemaining > 0) bytesRemaining -= length;
            return true;
          }
          // Partial write - bytes are on disk. Must complete or throw.
          writeSyncAll(chunk, bytesWritten, length - bytesWritten, position >= 0 ? position + bytesWritten : -1);
          // writeSyncAll only advances its local position; move the cursor
          // past the whole chunk so the next write doesn't overwrite its tail.
          if (position >= 0) {
            pos = position + length;
          }
          if (bytesRemaining > 0) bytesRemaining -= length;
          return true;
        },

        writevSync(chunks) {
          if (error || closed || asyncPending) return false;
          if (handle[kFd] === -1) throw $ERR_INVALID_STATE("The FileHandle is closed");
          chunks = convertChunks(chunks);
          let totalSize = 0;
          for (let i = 0; i < chunks.length; i++) {
            totalSize += chunks[i].byteLength;
          }
          if (totalSize > syncWriteThreshold) return false;
          if (totalSize === 0) return true;
          if (bytesRemaining >= 0 && totalSize > bytesRemaining) return false;
          const position = pos;
          let bytesWritten;
          acquireRef();
          try {
            bytesWritten = fsSync.writevSync(fd, chunks, position >= 0 ? position : null) || 0;
          } catch {
            return false;
          }
          totalBytesWritten += bytesWritten;
          if (position >= 0) {
            pos = position + bytesWritten;
          }
          if (bytesWritten === totalSize) {
            if (bytesRemaining > 0) bytesRemaining -= totalSize;
            return true;
          }
          // Partial writev - bytes are on disk. Must complete or throw.
          const rest = Buffer.concat(chunks);
          writeSyncAll(
            rest,
            bytesWritten,
            rest.byteLength - bytesWritten,
            position >= 0 ? position + bytesWritten : -1,
          );
          // writeSyncAll only advances its local position; move the cursor
          // past all chunks so the next write doesn't overwrite their tail.
          if (position >= 0) {
            pos = position + totalSize;
          }
          if (bytesRemaining > 0) bytesRemaining -= totalSize;
          return true;
        },

        end(options = kEmptyObject) {
          if (error) {
            return Promise.$reject(error);
          }
          if (closed) {
            return Promise.$resolve(totalBytesWritten);
          }
          if (closing) {
            return pendingEndPromise;
          }
          validateObject(options, "options");
          const { signal } = options;
          if (signal !== undefined) {
            validateAbortSignal(signal, "options.signal");
            if (signal.aborted) {
              return Promise.$reject(signal.reason);
            }
          }
          closing = true;
          pendingEndPromise = cleanup().$then(returnTotalBytesWritten);
          return pendingEndPromise;
        },

        endSync() {
          if (error) return -1;
          if (closed) return totalBytesWritten;
          if (asyncPending) return -1;
          closed = true;
          handle[kLocked] = false;
          releaseRef();
          if (autoClose) {
            handle[kCloseSync]();
          }
          return totalBytesWritten;
        },

        fail(reason) {
          if (closed || error) return;
          error = reason ?? $ERR_INVALID_STATE("Failed");
          closed = true;
          handle[kLocked] = false;
          function teardown() {
            releaseRef();
            if (autoClose) {
              handle[kCloseSync]();
            }
          }
          if (asyncPending) {
            // an async write is still using the fd - tear down after it lands
            deferredTeardown = teardown;
            return;
          }
          teardown();
        },

        [SymbolAsyncDispose]() {
          if (closing) {
            return pendingEndPromise ?? Promise.$resolve();
          }
          if (!closed && !error) {
            this.fail();
          }
          return Promise.$resolve();
        },

        [SymbolDispose]() {
          this.fail();
        },
      };
    }

    // Synchronously close the FileHandle (used by pullSync/writer autoClose).
    [kCloseSync]() {
      if (this[kFd] === -1) return;
      if (this[kClosePromise]) {
        throw $ERR_INVALID_STATE("The FileHandle is closing");
      }
      const fd = this[kFd];
      this[kFd] = -1;
      fileHandleRegistry?.unregister(this);
      (nodeFsForIter ??= require("node:fs")).closeSync(fd);
      this.emit("close");
    }

    [kTransfer]() {
      if (this[kClosePromise] || this[kRefs] > 1) {
        throw new DOMException("Cannot transfer FileHandle while in use", "DataCloneError");
      }

      const fd = this[kFd];
      const flag = this[kFlag];
      this[kFd] = -1;
      fileHandleRegistry?.unregister(this);
      return {
        data: { fd, flag },
        deserializeInfo: "internal/fs/promises:FileHandle",
      };
    }

    [kTransferList]() {
      return [];
    }

    [kDeserialize]({ fd, flag }) {
      this[kFd] = fd;
      this[kFlag] = flag;
      if (fd !== -1) {
        (fileHandleRegistry ??= new FinalizationRegistry(onFileHandleCollected)).register(
          this,
          { fd, path: undefined },
          this,
        );
      }
    }

    [kRef]() {
      this[kRefs]++;
    }

    [kUnref]() {
      if (--this[kRefs] === 0) {
        // Close the captured fd directly: this.close() would see kFd === -1
        // and short-circuit without ever closing the descriptor, leaking it
        // on the deferred-close path (close() called while an op was still
        // in flight).
        const fd = this[kFd];
        this[kFd] = -1;
        (fd !== -1 ? close(fd) : Promise.$resolve()).$then(this[kCloseResolve], this[kCloseReject]);
      }
    }
  }
  private_symbols.FileHandle = FileHandle;
}

function throwEBADFIfNecessary(fn: string, fd) {
  if (fd === -1) {
    // eslint-disable-next-line no-restricted-syntax
    const err: any = new Error("file closed");
    err.code = "EBADF";
    err.syscall = fn;
    throw err;
  }
}

async function writeFileAsyncIteratorInner(fd, iterable, encoding, signal: AbortSignal | null) {
  const writer = Bun.file(fd).writer();

  const mustRencode = !(encoding === "utf8" || encoding === "utf-8" || encoding === "binary" || encoding === "buffer");
  let totalBytesWritten = 0;

  try {
    for await (let chunk of iterable) {
      if (signal?.aborted) {
        throw $makeAbortError(undefined, { cause: signal.reason });
      }

      if (mustRencode && typeof chunk === "string") {
        $debug("Re-encoding chunk to", encoding);
        chunk = Buffer.from(chunk, encoding);
      } else if ($isUndefinedOrNull(chunk)) {
        throw $ERR_INVALID_ARG_TYPE("chunk", ["string", "ArrayBufferView", "ArrayBuffer"], chunk);
      }

      const prom = writer.write(chunk);
      if (prom && $isPromise(prom)) {
        totalBytesWritten += await prom;
      } else {
        totalBytesWritten += prom;
      }
    }
  } finally {
    await writer.end();
  }

  return totalBytesWritten;
}

// The only flag spellings whose `open` truncates. `r+` & co. overwrite in place,
// so resizing the file down to the bytes we wrote would destroy the rest of it.
function flagTruncates(flag): boolean {
  return flag === "w" || flag === "w+" || flag === "wx" || flag === "wx+" || flag === "xw" || flag === "xw+";
}

async function writeFileAsyncIterator(fdOrPath, iterable, optionsOrEncoding, flag, mode) {
  let encoding;
  let signal: AbortSignal | null = null;
  if (typeof optionsOrEncoding === "object") {
    encoding = optionsOrEncoding?.encoding ?? (encoding || "utf8");
    flag = optionsOrEncoding?.flag ?? (flag || "w");
    mode = optionsOrEncoding?.mode ?? (mode || 0o666);
    signal = optionsOrEncoding?.signal ?? null;
    if (signal?.aborted) {
      throw $makeAbortError(undefined, { cause: signal.reason });
    }
  } else if (typeof optionsOrEncoding === "string" || optionsOrEncoding == null) {
    encoding = optionsOrEncoding || "utf8";
    flag ??= "w";
    mode ??= 0o666;
  }

  if (!Buffer.isEncoding(encoding)) {
    // ERR_INVALID_OPT_VALUE_ENCODING was removed in Node v15.
    throw new TypeError(`Unknown encoding: ${encoding}`);
  }

  let mustClose = typeof fdOrPath === "string";
  if (mustClose) {
    // Rely on fs.open for further argument validaiton.
    fdOrPath = await fs.open(fdOrPath, flag, mode);
  }

  if (signal?.aborted) {
    if (mustClose) await fs.close(fdOrPath);
    throw $makeAbortError(undefined, { cause: signal.reason });
  }

  let totalBytesWritten = 0;

  let error: Error | undefined;

  try {
    totalBytesWritten = await writeFileAsyncIteratorInner(fdOrPath, iterable, encoding, signal);
  } catch (err) {
    error = err as Error;
  }

  // Handle cleanup outside of try-catch
  if (mustClose) {
    if (flagTruncates(flag)) {
      try {
        await fs.ftruncate(fdOrPath, totalBytesWritten);
      } catch {}
    }

    await fs.close(fdOrPath);
  }

  // Abort signal shadows other errors
  if (signal?.aborted) {
    error = $makeAbortError(undefined, { cause: signal.reason });
  }

  if (error) {
    throw error;
  }
}
