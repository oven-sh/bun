import type { Dirent } from "fs";

// Hardcoded module "node:fs/promises"
const constants = $processBindingConstants.fs;
const EventEmitter = require("node:events");

var PromisePrototypeThen = Promise.prototype.then;
var PromiseResolve = Promise.resolve;
var SafePromisePrototypeFinally = Promise.prototype.finally; //TODO
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

var fs = Bun.fs();

// note: this is not quite the same as how node does it
// in some cases, node swaps around arguments or makes small tweaks to the return type
// this is just better than nothing.
const notrace = "::bunternal::";

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
    throw new TypeError("Expected path to be a string or Buffer");
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

let lazy_cp: any = null;
// attempt to use the native code version if possible
// and on MacOS, simple cases of recursive directory trees can be done in a single `clonefile()`
// using filter and other options uses a lazily loaded js fallback ported from node.js
function cp(src, dest, options) {
  if (!options) return fs.cp(src, dest);
  if (typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  if (options.dereference || options.filter || options.preserveTimestamps || options.verbatimSymlinks) {
    if (!lazy_cp) lazy_cp = require("../internal/fs/cp-sync");
    return lazy_cp!(src, dest, options);
  }
  return fs.cp(src, dest, options.recursive, options.errorOnExist, options.force ?? true, options.mode);
}

// TODO: implement this in native code using a Dir Iterator 💀
// This is currently stubbed for Next.js support.
class Dir {
  #entries: Dirent[];
  #path: string;
  constructor(e: Dirent[], path: string) {
    this.#entries = e;
    this.#path = path;
  }
  get path() {
    return this.#path;
  }
  readSync() {
    return this.#entries.shift() ?? null;
  }
  read(c) {
    if (c) process.nextTick(c, null, this.readSync());
    return Promise.resolve(this.readSync());
  }
  closeSync() {}
  close(c) {
    if (c) process.nextTick(c);
    return Promise.resolve();
  }
  *[Symbol.asyncIterator]() {
    var next;
    while ((next = this.readSync())) {
      yield next;
    }
  }
}
async function opendir(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return new Dir(entries, dir);
}

const real_export = {
  access: fs.access.bind(fs),
  appendFile: fs.appendFile.bind(fs),
  close: fs.close.bind(fs),
  copyFile: fs.copyFile.bind(fs),
  cp,
  exists: fs.exists.bind(fs),
  chown: fs.chown.bind(fs),
  chmod: fs.chmod.bind(fs),
  fchmod: fs.fchmod.bind(fs),
  fchown: fs.fchown.bind(fs),
  fstat: fs.fstat.bind(fs),
  fsync: fs.fsync.bind(fs),
  fdatasync: fs.fdatasync.bind(fs),
  ftruncate: fs.ftruncate.bind(fs),
  futimes: fs.futimes.bind(fs),
  lchmod: fs.lchmod.bind(fs),
  lchown: fs.lchown.bind(fs),
  link: fs.link.bind(fs),
  lstat: fs.lstat.bind(fs),
  mkdir: fs.mkdir.bind(fs),
  mkdtemp: fs.mkdtemp.bind(fs),
  open: async (path, flags, mode) => {
    const fd = await fs.open(path, flags, mode);
    return new FileHandle(fd);
  },
  read: fs.read.bind(fs),
  write: fs.write.bind(fs),
  readdir: fs.readdir.bind(fs),
  readFile: fs.readFile.bind(fs),
  writeFile: fs.writeFile.bind(fs),
  readlink: fs.readlink.bind(fs),
  realpath: fs.realpath.bind(fs),
  rename: fs.rename.bind(fs),
  stat: fs.stat.bind(fs),
  symlink: fs.symlink.bind(fs),
  truncate: fs.truncate.bind(fs),
  unlink: fs.unlink.bind(fs),
  utimes: fs.utimes.bind(fs),
  lutimes: fs.lutimes.bind(fs),
  rm: fs.rm.bind(fs),
  rmdir: fs.rmdir.bind(fs),
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
};
export default real_export;

// Partially taken from https://github.com/nodejs/node/blob/c25878d370/lib/internal/fs/promises.js#L148
class FileHandle extends EventEmitter {
  constructor(fd) {
    super();
    this[kFd] = fd ? fd : -1;
    this[kRefs] = 1;
    this[kClosePromise] = null;
  }

  getAsyncId() {
    throw new Error("BUN TODO FileHandle.getAsyncId");
  }

  get fd() {
    return this[kFd];
  }

  appendFile(data, options) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.writeFile, fd);

    try {
      this[kRef]();
      return real_export.writeFile(fd, data, options);
    } finally {
      this[kUnref]();
    }
  }

  chmod(mode) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.fchmod, fd);

    try {
      this[kRef]();
      return real_export.fchmod(fd, mode);
    } finally {
      this[kUnref]();
    }
  }

  chown(uid, gid) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.fchown, fd);

    try {
      this[kRef]();
      return real_export.fchown(fd, uid, gid);
    } finally {
      this[kUnref]();
    }
  }

  datasync() {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.fdatasync, fd);

    try {
      this[kRef]();
      return real_export.fdatasync(fd);
    } finally {
      this[kUnref]();
    }
  }

  sync() {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.fsync, fd);

    try {
      this[kRef]();
      return real_export.fsync(fd);
    } finally {
      this[kUnref]();
    }
  }

  read(buffer, offset, length, position) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.read, fd);

    try {
      this[kRef]();
      const bytesRead = real_export.read(fd, buffer, offset, length, position);
      return { bytesRead, buffer };
    } finally {
      this[kUnref]();
    }
  }

  readv(buffers, position) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.readv, fd);

    try {
      this[kRef]();
      const bytesRead = real_export.readv(fd, buffers, position);
      return { bytesRead, buffers };
    } finally {
      this[kUnref]();
    }
  }

  readFile(options) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.readFile, fd);

    try {
      this[kRef]();
      return real_export.readFile(fd, options);
    } finally {
      this[kUnref]();
    }
  }

  readLines(options = undefined) {
    throw new Error("BUN TODO FileHandle.readLines");
  }

  stat(options) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.fstat, fd);

    try {
      this[kRef]();
      return real_export.fstat(fd, options);
    } finally {
      this[kUnref]();
    }
  }

  truncate(len = 0) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.ftruncate, fd);

    try {
      this[kRef]();
      return real_export.ftruncate(fd, len);
    } finally {
      this[kUnref]();
    }
  }

  utimes(atime, mtime) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.futimes, fd);

    try {
      this[kRef]();
      return real_export.futimes(fd, atime, mtime);
    } finally {
      this[kUnref]();
    }
  }

  write(buffer, offset, length, position) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.write, fd);

    try {
      this[kRef]();
      return real_export.write(fd, buffer, offset, length, position);
    } finally {
      this[kUnref]();
    }
  }

  writev(buffers, position) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.writev, fd);

    try {
      this[kRef]();
      return real_export.writev(fd, buffers, position);
    } finally {
      this[kUnref]();
    }
  }

  writeFile(data, options) {
    const fd = this[kFd];
    throwEBADFIfNecessary(real_export.writeFile, fd);

    try {
      this[kRef]();
      return real_export.writeFile(fd, data, options);
    } finally {
      this[kUnref]();
    }
  }

  close() {
    if (this[kFd] === -1) {
      return PromiseResolve();
    }

    if (this[kClosePromise]) {
      return this[kClosePromise];
    }

    this[kRefs]--;
    if (this[kRefs] === 0) {
      this[kClosePromise] = SafePromisePrototypeFinally.$call(real_export.close(this[kFd]), () => {
        this[kClosePromise] = undefined;
      });
    } else {
      this[kClosePromise] = SafePromisePrototypeFinally.$call(
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

  readableWebStream(options = kEmptyObject) {
    throw new Error("BUN TODO FileHandle.readableWebStream");
  }

  createReadStream(options = undefined) {
    throw new Error("BUN TODO FileHandle.createReadStream");
  }

  createWriteStream(options = undefined) {
    throw new Error("BUN TODO FileHandle.createWriteStream");
  }

  [kTransfer]() {
    throw new Error("BUN TODO FileHandle.kTransfer");
  }

  [kTransferList]() {
    throw new Error("BUN TODO FileHandle.kTransferList");
  }

  [kDeserialize]({ handle }) {
    throw new Error("BUN TODO FileHandle.kDeserialize");
  }

  [kRef]() {
    this[kRefs]++;
  }

  [kUnref]() {
    this[kRefs]--;
    if (this[kRefs] === 0) {
      PromisePrototypeThen(this.close(), this[kCloseResolve], this[kCloseReject]);
    }
  }
}

function throwEBADFIfNecessary(fn, fd) {
  if (fd === -1) {
    // eslint-disable-next-line no-restricted-syntax
    const err = new Error("file closed");
    err.code = "EBADF";
    err.name = "SystemError";
    err.syscall = fn.name;
    throw err;
  }
}
