// Hardcoded module "node:fs/promises"
const fs = $zig("node_fs_binding.zig", "createBinding") as $ZigGeneratedClasses.NodeJSFS;
const { glob } = require("internal/fs/glob");
const constants = $processBindingConstants.fs;
const { FileHandle, kRef, kUnref, kFd } = require("internal/fs/FileHandle");


function watch(
  filename: string | Buffer | URL,
  options: { encoding?: BufferEncoding; persistent?: boolean; recursive?: boolean; signal?: AbortSignal } = {},
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

  const watcher = fs.watch(filename, options || {}, (eventType: string, filename: string | Buffer | undefined) => {
    queue.push({ eventType, filename });
    if (nextEventResolve) {
      const resolve = nextEventResolve;
      nextEventResolve = null;
      resolve();
    }
  });

  return {
    [Symbol.asyncIterator]() {
      let closed = false;
      return {
        async next() {
          while (!closed) {
            let event: Event;
            while ((event = queue.shift() as Event)) {
              if (event.eventType === "close") {
                closed = true;
                return { value: undefined, done: true };
              }
              if (event.eventType === "error") {
                closed = true;
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

async function opendir(dir: string, options) {
  return new (require("node:fs").Dir)(1, dir, options);
}

const private_symbols = {
  kRef,
  kUnref,
  kFd,
  FileHandle,
  fs,
};

const _readFile = fs.readFile.bind(fs);
const _writeFile = fs.writeFile.bind(fs);
const _appendFile = fs.appendFile.bind(fs);

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
  statfs: asyncWrap(fs.statfs, "statfs"),
  open: async (path, flags = "r", mode = 0o666) => {
    return new private_symbols.FileHandle(await fs.open(path, flags, mode), flags);
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
require("internal/fs/FileHandle").setFSExports(exports);
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
function throwEBADFIfNecessary(fn: string, fd) {
  if (fd === -1) {
    const err: any = new Error("Bad file descriptor");
    err.code = "EBADF";
    err.name = "SystemError";
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
        throw signal.reason;
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

async function writeFileAsyncIterator(fdOrPath, iterable, optionsOrEncoding, flag, mode) {
  let encoding;
  let signal: AbortSignal | null = null;
  if (typeof optionsOrEncoding === "object") {
    encoding = optionsOrEncoding?.encoding ?? (encoding || "utf8");
    flag = optionsOrEncoding?.flag ?? (flag || "w");
    mode = optionsOrEncoding?.mode ?? (mode || 0o666);
    signal = optionsOrEncoding?.signal ?? null;
    if (signal?.aborted) {
      throw signal.reason;
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
    throw signal.reason;
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
    if (typeof flag === "string" && !flag.includes("a")) {
      try {
        await fs.ftruncate(fdOrPath, totalBytesWritten);
      } catch {}
    }

    await fs.close(fdOrPath);
  }

  // Abort signal shadows other errors
  if (signal?.aborted) {
    error = signal.reason;
  }

  if (error) {
    throw error;
  }
}
