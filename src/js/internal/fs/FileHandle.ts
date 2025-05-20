// Moved from src/js/node/fs.promises.ts
const types = require("node:util/types");
const EventEmitter = require("node:events");
const { validateInteger } = require("internal/validators");

const PromisePrototypeFinally = Promise.prototype.finally;
const SymbolAsyncDispose = Symbol.asyncDispose;
const ObjectFreeze = Object.freeze;

const { kFd } = require("internal/shared");
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

let writeFile: typeof import("fs/promises").writeFile,
  readFile: typeof import("fs/promises").readFile,
  fchmod: typeof import("fs").fchmod.__promisify__,
  fchown: typeof import("fs").fchown.__promisify__,
  fdatasync: typeof import("fs").fdatasync.__promisify__,
  fsync: typeof import("fs").fsync.__promisify__,
  read: typeof import("fs").read.__promisify__,
  readv: typeof import("fs").readv.__promisify__,
  fstat: typeof import("fs").fstat.__promisify__,
  ftruncate: typeof import("fs").ftruncate.__promisify__,
  futimes: typeof import("fs").futimes.__promisify__,
  write: typeof import("fs").write.__promisify__,
  writev: typeof import("fs").writev.__promisify__,
  close: typeof import("fs").close.__promisify__;

// Avoid circular dependency
function setFSExports(exports: any) {
  ({
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
  } = exports);
}

class FileHandle extends EventEmitter {
  constructor(fd, flag) {
    super();
    this[kFd] = fd ? fd : -1;
    this[kRefs] = 1;
    this[kClosePromise] = null;
    this[kFlag] = flag;
  }

  getAsyncId() {
    throw new Error("BUN TODO FileHandle.getAsyncId");
  }

  get fd() {
    return this[kFd];
  }

  [kCloseResolve];
  [kFlag];
  [kClosePromise];
  [kRefs];
  [Symbol("messaging_transfer_symbol")]() {}

  async appendFile(data, options) {
    const fd = this[kFd];
    throwEBADFIfNecessary("writeFile", fd);
    let encoding: BufferEncoding | null = "utf8";
    let flush = false;
    if (options == null || typeof options === "function") {
    } else if (typeof options === "string") {
      encoding = options as BufferEncoding;
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
    throwEBADFIfNecessary("fsync", fd);

    let buffer = bufferOrParams;
    if (!types.isArrayBufferView(buffer)) {
      if (bufferOrParams !== undefined) {
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

    let isArrayBufferView;
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
    let encoding: BufferEncoding | null = "utf8";
    let signal: AbortSignal | undefined = undefined;

    if (options == null || typeof options === "function") {
    } else if (typeof options === "string") {
      encoding = options as BufferEncoding;
    } else {
      encoding = options?.encoding ?? encoding;
      signal = options?.signal ?? undefined;
    }

    try {
      this[kRef]();
      return await writeFile(fd, data, { encoding, flag: this[kFlag], signal });
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
    return new (require("internal/fs/streams").ReadStream)(undefined, {
      highWaterMark: 64 * 1024,
      ...options,
      fd: this,
    });
  }

  createWriteStream(options = kEmptyObject) {
    const fd = this[kFd];
    throwEBADFIfNecessary("createWriteStream", fd);
    return new (require("internal/fs/streams").WriteStream)(undefined as any, {
      highWaterMark: 64 * 1024,
      ...options,
      fd: this,
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
      this[kFd] = -1;
      this.close().$then(this[kCloseResolve], this[kCloseReject]);
    }
  }
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

export default {
  FileHandle,
  kFd,
  kRef,
  kUnref,
  setFSExports,
};
