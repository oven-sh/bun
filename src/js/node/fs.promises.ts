// Hardcoded module "node:fs/promises"
const types = require("node:util/types");
const EventEmitter = require("node:events");
const fs = $zig("node_fs_binding.zig", "createBinding") as BunFS;
const { glob: internalGlob } = require("internal/fs/glob");
const constants = $processBindingConstants.fs;
import type { Dir, NoParamCallback, WatchOptions, OpenDirOptions } from "node:fs";
// Types for ReadStream/WriteStream will be inferred from require calls later

var PromisePrototypeThen = Promise.prototype.then;
var PromisePrototypeFinally = Promise.prototype.finally; //TODO
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
const kEmptyObject = ObjectFreeze({ __proto__: null });
const kFlag = Symbol("kFlag");

const { validateInteger } = require("internal/validators");

type WatchEvent = { eventType: string; filename: string | Buffer | undefined };
type WatchAsyncIterable = {
  [Symbol.asyncIterator](): AsyncIterator<WatchEvent, void, undefined>;
};

function watch(
  filename: string | Buffer | URL,
  options: WatchOptions | BufferEncoding | string = {},
): WatchAsyncIterable {
  if (filename instanceof URL) {
    throw new TypeError("Watch URLs are not supported yet");
  } else if (Buffer.isBuffer(filename)) {
    filename = filename.toString();
  } else if (typeof filename !== "string") {
    throw $ERR_INVALID_ARG_TYPE("filename", ["string", "Buffer", "URL"], filename);
  }
  let nextEventResolve: Function | null = null;
  if (typeof options === "string") {
    options = { encoding: options as BufferEncoding };
  }
  const queue = $createFIFO();

  // Assuming the Zig binding is synchronous like Node's fs.watch and returns BunFSWatcher
  // The BunFS type definition confirms fs.watch returns BunFSWatcher directly.
  const watcher = fs.watch(
    filename,
    options || {},
    (eventType: string, filename: string | Buffer | undefined) => {
      queue.push({ eventType, filename });
      if (nextEventResolve) {
        const resolve = nextEventResolve;
        nextEventResolve = null;
        resolve();
      }
    },
  );

  return {
    [Symbol.asyncIterator]() {
      let closed = false;
      return {
        async next(): Promise<IteratorResult<WatchEvent, void>> {
          while (!closed) {
            let event: WatchEvent;
            while ((event = queue.shift() as WatchEvent)) {
              if (event.eventType === "close") {
                closed = true;
                return { value: undefined, done: true };
              }
              if (event.eventType === "error") {
                closed = true;
                // TODO: Should this be rejected instead? Node docs say error event.
                throw event.filename;
              }
              return { value: event, done: false };
            }
            const { promise, resolve } = Promise.withResolvers<void>();
            nextEventResolve = resolve;
            await promise;
          }
          return { value: undefined, done: true };
        },

        async return(): Promise<IteratorResult<WatchEvent, void>> {
          if (!closed) {
            // TODO: Check AbortSignal integration if added later
            watcher.close();
            closed = true;
            if (nextEventResolve) {
              const resolve = nextEventResolve;
              nextEventResolve = null;
              resolve();
            }
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

// attempt to use the native code version if possible
// and on MacOS, simple cases of recursive directory trees can be done in a single `clonefile()`
// using filter and other options uses a lazily loaded js fallback ported from node.js
function cp(src, dest, options) {
  if (!options) return fs.cp(src, dest);
  if (typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  if (options.dereference || options.filter || options.preserveTimestamps || options.verbatimSymlinks) {
    return require("internal/fs/cp")(src, dest, options);
  }
  return fs.cp(src, dest, options.recursive, options.errorOnExist, options.force ?? true, options.mode);
}

// Use the synchronous version from the binding
const _opendirSync = fs.opendirSync.bind(fs);

async function opendir(path: string, options?: OpenDirOptions): Promise<Dir> {
  // Wrap the synchronous call
  // Assume _opendirSync throws on error, aligning with Node's fs.opendirSync
  const dir = _opendirSync(path, options);
  // The check 'if (!dir)' is removed based on the assumption that errors are thrown.
  // If the binding actually returns undefined/null on error, this needs adjustment.
  return dir; // Return the Dir object directly inside the async function
}

const private_symbols = {
  kRef,
  kUnref,
  kFd,
  FileHandle: null as any,
  fs,
};

const _readFile = fs.readFile.bind(fs);
const _writeFile = fs.writeFile.bind(fs);
const _appendFile = fs.appendFile.bind(fs);

const exports = {
  access: asyncWrap(fs.access, "access"),
  appendFile: async function (fileHandleOrFdOrPath, ...args: [any, any?]) {
    const handle = fileHandleOrFdOrPath as any;
    const fdOrPath = handle?.[kFd] ?? fileHandleOrFdOrPath;
    // TS2556: Explicitly pass arguments instead of spreading
    return _appendFile(fdOrPath, args[0], args[1]);
  },
  close: asyncWrap(fs.close, "close"),
  copyFile: asyncWrap(fs.copyFile, "copyFile"),
  cp,
  exists: async function exists(...args: any[]) {
    try {
      // Use `any` cast to bypass strict $apply type checking for variadic native function
      // Keep using arguments for potential compatibility reasons
      return await (fs.exists as any).$apply(fs, arguments);
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
  // Explicitly type glob to avoid TS4023
  glob: internalGlob as (pattern: string | string[], options?: any) => AsyncGenerator<string, void, unknown>,
  lchmod: asyncWrap(fs.lchmod, "lchmod"),
  lchown: asyncWrap(fs.lchown, "lchown"),
  link: asyncWrap(fs.link, "link"),
  lstat: asyncWrap(fs.lstat, "lstat"),
  mkdir: asyncWrap(fs.mkdir, "mkdir"),
  mkdtemp: asyncWrap(fs.mkdtemp, "mkdtemp"),
  statfs: asyncWrap(fs.statfs, "statfs"),
  open: async (path, flags = "r", mode = 0o666) => {
    // FileHandle constructor expects fd and flag
    const fd = await fs.open(path, flags, mode);
    return new private_symbols.FileHandle(fd, flags);
  },
  read: asyncWrap(fs.read, "read"),
  write: asyncWrap(fs.write, "write"),
  readdir: asyncWrap(fs.readdir, "readdir"),
  readFile: async function (fileHandleOrFdOrPath, ...args: [any?]) {
    const handle = fileHandleOrFdOrPath as any;
    const fdOrPath = handle?.[kFd] ?? fileHandleOrFdOrPath;
    return _readFile(fdOrPath, args[0]);
  },
  writeFile: async function (fileHandleOrFdOrPath, ...args: [any, any?]) {
    const handle = fileHandleOrFdOrPath as any;
    const fdOrPath = handle?.[kFd] ?? fileHandleOrFdOrPath;
    if (
      !$isTypedArrayView(args[0]) &&
      typeof args[0] !== "string" &&
      ($isCallable(args[0]?.[Symbol.iterator]) || $isCallable(args[0]?.[Symbol.asyncIterator]))
    ) {
      $debug("fs.promises.writeFile async iterator slow path!");
      // writeFileAsyncIterator expects specific args and returns Promise<void>
      return writeFileAsyncIterator(fdOrPath, args[0], args[1]);
    }
    // TS2556: Explicitly pass arguments instead of spreading
    return _writeFile(fdOrPath, args[0], args[1]);
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
  rm: asyncWrap(fs.rm, "rm"),
  rmdir: asyncWrap(fs.rmdir, "rmdir"),
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
  // this is used to export the private symbols to 'fs.js' without making it public.
  $data: private_symbols,
};
export default exports;

// TODO: remove this in favor of just returning js functions that don't check `this`
function asyncWrap(fn: any, name: string) {
  const wrapped = async function (...args) {
    // Assuming fn is already bound or doesn't rely on `this` being fs
    // Or rely on the native function handling `this` correctly when called via $apply
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
    [kFd]: number;
    [kRefs]: number;
    [kClosePromise]: Promise<void> | null = null;
    [kFlag]: string;
    [kCloseResolve]: ((value?: any) => void) | undefined = undefined;
    [kCloseReject]: ((reason?: any) => void) | undefined = undefined;

    constructor(fd, flag) {
      super();
      this[kFd] = fd != null ? fd : -1; // Ensure fd is not null/undefined
      this[kRefs] = 1;
      this[kFlag] = flag;
    }

    getAsyncId() {
      throw new Error("BUN TODO FileHandle.getAsyncId");
    }

    get fd() {
      return this[kFd];
    }

    // needs to exist for https://github.com/nodejs/node/blob/8641d94189/test/parallel/test-worker-message-port-transfer-fake-js-transferable.js to pass
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
        // Pass fd directly, writeFile handles FileHandle objects via kFd symbol
        return await writeFile(this, data, { encoding, flush, flag: this[kFlag] });
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
      throwEBADFIfNecessary("read", fd); // Changed from fsync

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
        // Pass fd directly
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
        // Pass fd directly, readFile handles FileHandle objects via kFd symbol
        return await readFile(this, options);
      } finally {
        this[kUnref]();
      }
    }

    readLines(_options = undefined) {
      throw new Error("BUN TODO FileHandle.readLines");
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
      }
      try {
        this[kRef]();
        // Pass fd directly
        const bytesWritten = await write(fd, buffer, offset, length, position);
        return { buffer, bytesWritten };
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

    async writeFile(data: string | Buffer | ArrayBufferView, options: any = "utf8") {
      const fd = this[kFd];
      throwEBADFIfNecessary("writeFile", fd);
      let encoding: string = "utf8";
      let signal: AbortSignal | null = null;

      if (options == null || typeof options === "function") {
      } else if (typeof options === "string") {
        encoding = options;
      } else {
        encoding = options?.encoding ?? encoding;
        signal = options?.signal ?? null;
      }

      try {
        this[kRef]();
        // Pass fd directly, writeFile handles FileHandle objects via kFd symbol
        return await writeFile(this, data, { encoding, flag: this[kFlag], signal });
      } finally {
        this[kUnref]();
      }
    }

    close = () => {
      const fd = this[kFd];
      if (fd === -1) {
        return Promise.resolve();
      }

      if (this[kClosePromise]) {
        return this[kClosePromise];
      }

      this[kRefs]--;
      if (this[kRefs] === 0) {
        this[kFd] = -1;
        this[kClosePromise] = PromisePrototypeFinally.$call(close(fd), () => {
          this[kClosePromise] = null;
        });
        this.emit("close");
      } else if (this[kRefs] < 0) {
        // This should not happen, but guard against it.
        this[kRefs] = 0;
        this[kClosePromise] = Promise.resolve(); // Already closed or closing
      } else {
        // Only create a new promise if one doesn't exist and refs > 0
        if (!this[kClosePromise]) {
          this[kClosePromise] = PromisePrototypeFinally.$call(
            new Promise((resolve, reject) => {
              this[kCloseResolve] = resolve;
              this[kCloseReject] = reject;
            }),
            () => {
              this[kClosePromise] = null;
              this[kCloseReject] = undefined; // Clear resolvers
              this[kCloseResolve] = undefined;
            },
          );
        }
      }

      return this[kClosePromise]!; // It's guaranteed to be non-null here
    };

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
      // Pass null for path when fd is provided
      return new (require("internal/fs/streams").ReadStream)(null, {
        highWaterMark: 64 * 1024,
        ...options,
        fd: this, // Pass the FileHandle itself
      });
    }

    createWriteStream(options = kEmptyObject) {
      const fd = this[kFd];
      throwEBADFIfNecessary("createWriteStream", fd);
      // Pass null for path when fd is provided
      return new (require("internal/fs/streams").WriteStream)(null, {
        highWaterMark: 64 * 1024,
        ...options,
        fd: this, // Pass the FileHandle itself
      });
    }

    [kTransfer]() {
      throw new Error("BUN TODO FileHandle.kTransfer");
    }

    [kTransferList]() {
      throw new Error("BUN TODO FileHandle.kTransferList");
    }

    [kDeserialize](_) {
      throw new Error("BUN TODO FileHandle.kDeserialize");
    }

    [kRef]() {
      this[kRefs]++;
    }

    [kUnref]() {
      if (--this[kRefs] === 0) {
        const resolve = this[kCloseResolve];
        const reject = this[kCloseReject];
        this[kCloseResolve] = undefined;
        this[kCloseReject] = undefined;

        if (this[kFd] !== -1) {
          const fd = this[kFd];
          this[kFd] = -1;
          // Use the stored resolvers if they exist (meaning close was called while refs > 0)
          PromisePrototypeThen.$call(close(fd) as Promise<any>, resolve, reject);
          this.emit("close");
        } else if (resolve) {
          // If fd is already -1 but we had resolvers, resolve the promise.
          resolve();
        }
      }
    }
  }
  private_symbols.FileHandle = FileHandle;
}

function throwEBADFIfNecessary(fn: string, fd) {
  if (fd === -1) {
    const err: any = new Error("Bad file descriptor");
    err.code = "EBADF";
    err.name = "SystemError";
    err.syscall = fn;
    throw err;
  }
}

// This inner function returns Promise<void> to align with the outer function and avoid TS error.
async function writeFileAsyncIteratorInner(
  fd: number,
  iterable: AsyncIterable<string | ArrayBufferView | ArrayBuffer>,
  encoding: BufferEncoding | null,
  signal: AbortSignal | null,
): Promise<void> { // Changed return type to void
  const writer = Bun.file(fd).writer();
  const mustRencode = encoding && !(encoding === "utf8" || encoding === "utf-8");
  let error: Error | undefined;

  try {
    for await (let chunk of iterable) {
      if (signal?.aborted) {
        error = signal.reason ?? $makeAbortError();
        break;
      }

      if (mustRencode && typeof chunk === "string") {
        $debug("Re-encoding chunk to", encoding);
        // Ensure encoding is not null here due to mustRencode check
        chunk = Buffer.from(chunk, encoding!);
      } else if ($isUndefinedOrNull(chunk)) {
        error = $ERR_INVALID_ARG_TYPE("chunk", ["string", "ArrayBufferView", "ArrayBuffer"], chunk);
        break;
      }

      // writer.write returns number | Promise<number>
      const bytesOrPromise = writer.write(chunk as string | ArrayBuffer | SharedArrayBuffer | Bun.ArrayBufferView<ArrayBufferLike>);
      // We still need to await promises to ensure writes complete sequentially
      if (bytesOrPromise && $isPromise(bytesOrPromise)) {
          await bytesOrPromise;
      }
    }
  } catch (err) {
    error = err as Error;
  } finally {
    try {
        await writer.end(); // writer.end() returns Promise<void>
    } catch (endError) {
        error = error ?? (endError as Error);
    }
  }

  if (error) {
    throw error;
  }

  // No explicit return needed for Promise<void>
}


// This outer function maintains Node.js compatibility by returning Promise<void>.
// It calls the inner function but ignores its numeric result.
async function writeFileAsyncIterator(fdOrPath, iterable, optionsOrEncoding, flag?, mode?): Promise<void> {
  let encoding: BufferEncoding | null = null;
  let signal: AbortSignal | null = null;
  if (typeof optionsOrEncoding === "object" && optionsOrEncoding !== null) {
    encoding = optionsOrEncoding?.encoding ?? (encoding || "utf8");
    flag = optionsOrEncoding?.flag ?? (flag || "w");
    mode = optionsOrEncoding?.mode ?? (mode || 0o666);
    signal = optionsOrEncoding?.signal ?? null;
    if (signal?.aborted) {
      throw signal.reason ?? $makeAbortError();
    }
  } else if (typeof optionsOrEncoding === "string" || optionsOrEncoding == null) {
    encoding = (optionsOrEncoding as BufferEncoding | null) || "utf8";
    flag ??= "w";
    mode ??= 0o666;
  }

  if (encoding && !Buffer.isEncoding(encoding)) {
    // ERR_INVALID_OPT_VALUE_ENCODING was removed in Node v15.
    throw $ERR_UNKNOWN_ENCODING(encoding);
  }

  let mustClose = typeof fdOrPath === "string" || Buffer.isBuffer(fdOrPath) || fdOrPath instanceof URL;
  let fd: number;

  if (mustClose) {
    // Rely on fs.open for further argument validation.
    fd = await fs.open(fdOrPath, flag, mode);
  } else if (typeof fdOrPath === "number") {
    fd = fdOrPath;
  } else {
    // Assuming FileHandle if not string/Buffer/URL/number
    fd = (fdOrPath as any)[kFd];
    if (typeof fd !== "number" || fd < 0) {
      throw $ERR_INVALID_ARG_TYPE("fdOrPath", ["string", "Buffer", "URL", "number", "FileHandle"], fdOrPath);
    }
  }

  if (signal?.aborted) {
    if (mustClose) await fs.close(fd); // Use fs.close directly, assuming promise return
    throw signal.reason ?? $makeAbortError();
  }

  let error: Error | undefined;

  try {
    // Await the inner function, which now returns Promise<void>
    await writeFileAsyncIteratorInner(fd, iterable, encoding, signal);
  } catch (err) {
    error = err as Error;
  }

  // Handle cleanup outside of try-catch
  if (mustClose) {
    // Note: ftruncate based on totalBytesWritten is removed as the inner function no longer returns it.
    // If truncation is desired, it would need to be handled differently.
    await fs.close(fd); // Use fs.close directly, assuming promise return
  }

  // Abort signal shadows other errors
  if (signal?.aborted) {
    error = signal.reason ?? $makeAbortError();
  }

  if (error) {
    throw error;
  }
  // Implicitly return void
}