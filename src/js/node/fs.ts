// Hardcoded module "node:fs"
import type {
  Stats as StatsType,
  BigIntStats as BigIntStatsType,
  StatsFs as StatsFsType,
  BigIntStatsFs as BigIntStatsFsType,
  Dirent as DirentType,
  PathLike,
  WatchOptions,
  BufferEncodingOption,
  EncodingOption,
  OpenMode,
  Mode,
  ObjectEncodingOptions,
  WriteFileOptions,
  ReadVResult,
  WriteVResult,
  StatFsOptions,
  StatOptions,
  RmDirOptions,
  RmOptions,
  MakeDirectoryOptions,
  ReadPosition,
  CopySyncOptions,
  CopyOptions,
  OpenDirOptions,
  FSWatcher as FSWatcherType,
  StatWatcher as StatWatcherType,
  WatchListener,
  NoParamCallback,
} from "fs";

import { URL } from "node:url";
import type { Abortable } from "node:events";
import type { Stream } from "node:stream";
import type { FileHandle } from "node:fs/promises";
import type { BlobOptions } from "buffer";

type StatCallback = (err: NodeJS.ErrnoException | null, stats: StatsType | BigIntStatsType | null) => void;
type StatSyncFn = (path: PathLike, options?: StatOptions) => StatsType | BigIntStatsType | undefined;
type StatFsCallback = (err: NodeJS.ErrnoException | null, stats: StatsFsType | BigIntStatsFsType | null) => void;
type StatFsSyncFn = (path: PathLike, options?: StatFsOptions) => StatsFsType | BigIntStatsFsType | undefined;
type ReadAsyncOptions<TBuffer extends NodeJS.ArrayBufferView = NodeJS.ArrayBufferView> =
  import("fs").ReadAsyncOptions<TBuffer>;
type ReadSyncOptions = import("fs").ReadSyncOptions;
type WriteSyncOptions = WriteFileOptions;
type ReadCallback<TBuffer extends NodeJS.ArrayBufferView = NodeJS.ArrayBufferView> = (
  err: NodeJS.ErrnoException | null,
  bytesRead: number,
  buffer: TBuffer,
) => void;
type WriteCallback<TBuffer extends NodeJS.ArrayBufferView | string = NodeJS.ArrayBufferView | string> = (
  err: NodeJS.ErrnoException | null,
  bytesWritten: number,
  buffer: TBuffer,
) => void;
type ReaddirOptions =
  | (ObjectEncodingOptions & {
      withFileTypes?: boolean | undefined;
      recursive?: boolean | undefined;
    })
  | BufferEncoding
  | null;
type ReaddirCallback = (err: NodeJS.ErrnoException | null, files: string[] | Buffer[] | DirentType[]) => void;
type ReadFileOptions = import("fs").WriteFileOptions;
type ReadFileCallback = (err: NodeJS.ErrnoException | null, data: Buffer | string) => void;
type ReadlinkOptions = ObjectEncodingOptions | BufferEncoding | null;
type ReadlinkCallback = (err: NodeJS.ErrnoException | null, linkString: string | Buffer) => void;
type RealpathOptions = ObjectEncodingOptions | BufferEncoding | null;
type RealpathCallback = (err: NodeJS.ErrnoException | null, resolvedPath: string | Buffer | null) => void;
type RealpathSyncOptions = ObjectEncodingOptions | BufferEncoding | null;
type WriteVCallback = (
  err: NodeJS.ErrnoException | null,
  bytesWritten: number,
  buffers: readonly NodeJS.ArrayBufferView[],
) => void;
type ReadVCallback = (
  err: NodeJS.ErrnoException | null,
  bytesRead: number,
  buffers: readonly NodeJS.ArrayBufferView[],
) => void;
type ReadStreamOptions =
  | BufferEncoding
  | {
      flags?: string | undefined;
      encoding?: BufferEncoding | undefined;
      fd?: number | FileHandle | undefined;
      mode?: number | undefined;
      autoClose?: boolean | undefined;
      emitClose?: boolean | undefined;
      start?: number | undefined;
      end?: number | undefined;
      highWaterMark?: number | undefined;
      fs?: object | null | undefined;
      signal?: AbortSignal | undefined;
    };
type WriteStreamOptions =
  | BufferEncoding
  | {
      flags?: string | undefined;
      encoding?: BufferEncoding | undefined;
      fd?: number | FileHandle | undefined;
      mode?: number | undefined;
      autoClose?: boolean | undefined;
      emitClose?: boolean | undefined;
      start?: number | undefined;
      highWaterMark?: number | undefined;
      fs?: object | null | undefined;
      signal?: AbortSignal | undefined;
      flush?: boolean | undefined;
    };
type Dir = import("fs").Dir;
type ErrnoException = NodeJS.ErrnoException;

interface GlobOptions {
  cwd?: string | URL | undefined;
  root?: string | URL | undefined;
  dot?: boolean | undefined;
  nomount?: boolean | undefined;
  mark?: boolean | undefined;
  nosort?: boolean | undefined;
  stat?: boolean | undefined;
  silent?: boolean | undefined;
  strict?: boolean | undefined;
  cache?: { [path: string]: boolean | "DIR" | "FILE" | ReadonlyArray<string> } | undefined;
  statCache?: { [path: string]: false | { isDirectory(): boolean } | undefined } | undefined;
  symlinks?: { [path: string]: boolean | undefined } | undefined;
  realpathCache?: { [path: string]: string } | undefined;
  nounique?: boolean | undefined;
  nonull?: boolean | undefined;
  debug?: boolean | undefined;
  nobrace?: boolean | undefined;
  noglobstar?: boolean | undefined;
  noext?: boolean | undefined;
  nocase?: boolean | undefined;
  matchBase?: any;
  nodir?: boolean | undefined;
  ignore?: string | ReadonlyArray<string> | undefined;
  follow?: boolean | undefined;
  realpath?: boolean | undefined;
  absolute?: boolean | undefined;
  fs?: object | undefined;
  signal?: AbortSignal | undefined;
  withFileTypes?: boolean | undefined;
  onlyFiles?: boolean | undefined;
  onlyDirectories?: boolean | undefined;
}

const EventEmitter = require("node:events");
const promises = require("node:fs/promises") as unknown as typeof import("node:fs/promises");
const types = require("node:util/types");
const { validateFunction, validateInteger } = require("internal/validators");
const { Buffer } = require("node:buffer");

const kEmptyObject = Object.freeze(Object.create(null));
const kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");

const isDate = types.isDate;

const { fs } = (promises as any).$data as { fs: BunFS };

const constants = $processBindingConstants.fs;
var _lazyGlob: any;
function lazyGlob() {
  return (_lazyGlob ??= require("internal/fs/glob"));
}

function ensureCallback(callback: any): any {
  if (!$isCallable(callback)) {
    throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
  }
  return callback;
}

function nullcallback(callback: (err: NodeJS.ErrnoException | null) => void) {
  return FunctionPrototypeBind.$call(callback, undefined, null);
}
const FunctionPrototypeBind = nullcallback.bind;

class FSWatcher extends EventEmitter implements FSWatcherType {
  #watcher: BunFSWatcher | null;
  #listener: WatchListener<string | Buffer>;
  constructor(
    path: PathLike,
    options?: WatchOptions | BufferEncoding | WatchListener<string | Buffer> | null,
    listener?: WatchListener<string | Buffer>,
  ) {
    super();

    if (typeof options === "function") {
      listener = options;
      options = {};
    } else if (typeof options === "string") {
      options = { encoding: options };
    }

    if (typeof listener !== "function") {
      listener = () => {};
    }

    this.#listener = listener;
    let watchPath: string;
    if (path instanceof URL) {
      watchPath = Bun.fileURLToPath(path);
    } else {
      watchPath = String(path);
    }

    try {
      this.#watcher = fs.watch(watchPath, options || {}, this.#onEvent.bind(this));
    } catch (e: any) {
      e.path = path;
      e.filename = path;
      throw e;
    }
  }

  #onEvent(eventType: BunWatchEventType, filenameOrError: string | Buffer | Error | undefined) {
    if (eventType === "close") {
      queueMicrotask(() => {
        this.emit("close", filenameOrError);
      });
      return;
    } else if (eventType === "error") {
      if ((filenameOrError as Error)?.code === "EACCES") (filenameOrError as Error).code = "EPERM";
      this.emit(eventType, filenameOrError);
    } else {
      this.emit("change", eventType, filenameOrError);
      this.#listener(eventType, filenameOrError as string | Buffer | undefined);
    }
  }

  close(): void {
    this.#watcher?.close();
    this.#watcher = null;
  }

  ref(): this {
    this.#watcher?.ref();
    return this;
  }

  unref(): this {
    this.#watcher?.unref();
    return this;
  }

  start() {}
}

interface StatWatcherHandle {
  ref(): void;
  unref(): void;
  close(): void;
}

function openAsBlob(path: PathLike, options?: BlobOptions): Promise<Blob> {
  try {
    let filePath: string | number | Uint8Array;
    if (typeof path === "string") {
      filePath = path;
    } else if (path instanceof URL) {
      filePath = Bun.fileURLToPath(path);
    } else if (Buffer.isBuffer(path)) {
      filePath = path.toString();
    } else {
      return Promise.$reject(new TypeError("Invalid path type for openAsBlob"));
    }
    return Promise.$resolve(Bun.file(filePath, options));
  } catch (err) {
    return Promise.$reject(err);
  }
}

class StatWatcher extends EventEmitter implements StatWatcherType {
  _handle: StatWatcherHandle | null;

  constructor(path: PathLike, options?: { persistent?: boolean; interval?: number }) {
    super();
    this._handle = fs.watchFile(path, options, this.#onChange.bind(this)) as unknown as StatWatcherHandle;
  }

  #onChange(curr: StatsType, prev: StatsType) {
    this.emit("change", curr, prev);
  }

  start() {}

  stop(): void {
    this._handle?.close();
    this._handle = null;
  }

  ref(): this {
    this._handle?.ref();
    return this;
  }

  unref(): this {
    this._handle?.unref();
    return this;
  }
}

var access = function access(
  path: PathLike,
  mode: number | ((err: NodeJS.ErrnoException | null) => void) | undefined,
  callback?: (err: NodeJS.ErrnoException | null) => void,
) {
  if ($isCallable(mode)) {
    callback = mode;
    mode = undefined;
  }

  const cb = ensureCallback(callback);
  (fs.access(path, mode) as Promise<void>).then(() => cb(null), cb);
};
(access as any)[kCustomPromisifiedSymbol] = (promises as any).access;

var appendFile = function appendFile(
  path: PathLike | FileHandle,
  data: string | Uint8Array,
  options: WriteFileOptions | BufferEncoding | null | ((err: NodeJS.ErrnoException | null) => void) | undefined,
  callback?: (err: NodeJS.ErrnoException | null) => void,
) {
  if (!$isCallable(callback) && $isCallable(options)) {
    callback = options as (err: NodeJS.ErrnoException | null) => void;
    options = undefined;
  }

  const cb = ensureCallback(callback);

  (fs.appendFile(path, data, options as WriteFileOptions | BufferEncoding | null | undefined) as Promise<void>).then(
    () => cb(null),
    cb,
  );
};
(appendFile as any)[kCustomPromisifiedSymbol] = (promises as any).appendFile;

var close = function close(fd: number, callback?: (err: NodeJS.ErrnoException | null) => void) {
  const cb = ensureCallback(callback);
  (fs.close(fd) as Promise<void>).then(() => cb(null), cb);
};
(close as any)[kCustomPromisifiedSymbol] = (promises as any).close;

var rm = function rm(
  path: PathLike,
  options: RmOptions | ((err: NodeJS.ErrnoException | null) => void) | undefined,
  callback?: (err: NodeJS.ErrnoException | null) => void,
) {
  if ($isCallable(options)) {
    callback = options;
    options = undefined;
  }

  const cb = ensureCallback(callback);
  (fs.rm(path, options) as Promise<void>).then(() => cb(null), cb);
};
(rm as any)[kCustomPromisifiedSymbol] = (promises as any).rm;

var rmdir = function rmdir(
  path: PathLike,
  options: RmDirOptions | ((err: NodeJS.ErrnoException | null) => void) | undefined,
  callback?: (err: NodeJS.ErrnoException | null) => void,
) {
  if ($isCallable(options)) {
    callback = options;
    options = undefined;
  }
  const cb = ensureCallback(callback);
  (fs.rmdir(path, options) as Promise<void>).then(() => cb(null), cb);
};
(rmdir as any)[kCustomPromisifiedSymbol] = (promises as any).rmdir;

var copyFile = function copyFile(
  src: PathLike,
  dest: PathLike,
  mode: number | ((err: NodeJS.ErrnoException | null) => void),
  callback?: (err: NodeJS.ErrnoException | null) => void,
) {
  if ($isCallable(mode)) {
    callback = mode;
    mode = 0;
  }

  const cb = ensureCallback(callback);

  (fs.copyFile(src, dest, mode) as Promise<void>).then(() => cb(null), cb);
};
(copyFile as any)[kCustomPromisifiedSymbol] = (promises as any).copyFile;

var exists = function exists(path: PathLike, callback: (exists: boolean) => void) {
  const cb = ensureCallback(callback);

  (fs.exists(path) as Promise<boolean>).then(
    (existed: boolean) => cb(existed),
    (_: any) => cb(false),
  );
};
exists[kCustomPromisifiedSymbol] = (path: PathLike) => new Promise(resolve => exists(path, resolve));

var chown = function chown(
  path: PathLike,
  uid: number,
  gid: number,
  callback: (err: NodeJS.ErrnoException | null) => void,
) {
  const cb = ensureCallback(callback);

  (fs.chown(path, uid, gid) as unknown as Promise<void>).then(() => cb(null), cb);
};
(chown as any)[kCustomPromisifiedSymbol] = (promises as any).chown as unknown as Promise<void>;

var chmod = function chmod(path: PathLike, mode: Mode, callback: (err: NodeJS.ErrnoException | null) => void) {
  const cb = ensureCallback(callback);

  (fs.chmod(path, mode) as unknown as Promise<void>).then(() => cb(null), cb);
};
(chmod as any)[kCustomPromisifiedSymbol] = (promises as any).chmod;

var fchmod = function fchmod(fd: number, mode: Mode, callback: (err: NodeJS.ErrnoException | null) => void) {
  const cb = ensureCallback(callback) as (err: NodeJS.ErrnoException | null) => void;

  (fs.fchmod(fd, mode) as unknown as Promise<void>).then(() => cb(null), cb);
};
(fchmod as any)[kCustomPromisifiedSymbol] = (promises as any).fchmod;

var fchown = function fchown(
  fd: number,
  uid: number,
  gid: number,
  callback: (err: NodeJS.ErrnoException | null) => void,
) {
  const cb = ensureCallback(callback) as (err: NodeJS.ErrnoException | null) => void;

  (fs.fchown(fd, uid, gid) as unknown as Promise<void>).then(() => cb(null), cb);
};
(fchown as any)[kCustomPromisifiedSymbol] = (promises as any).fchown;

var fstat: typeof import("node:fs").fstat = function fstat(
  fd: number,
  options?: StatOptions | StatCallback,
  callback?: StatCallback,
) {
  if ($isCallable(options)) {
    callback = options as StatCallback;
    options = undefined;
  }
  const cb = ensureCallback(callback!) as StatCallback;
  (fs.fstat(fd, options as StatOptions | undefined) as unknown as Promise<StatsType | BigIntStatsType>).then(
    (stats: StatsType | BigIntStatsType) => cb(null, stats),
    (err: NodeJS.ErrnoException) => cb(err, null),
  );
} as any;
(fstat as any)[kCustomPromisifiedSymbol] = (promises as any).fstat;

var fsync = function fsync(fd: number, callback: (err: NodeJS.ErrnoException | null) => void) {
  const cb = ensureCallback(callback) as (err: NodeJS.ErrnoException | null) => void;

  (fs.fsync(fd) as unknown as Promise<void>).then(() => cb(null), cb);
};
(fsync as any)[kCustomPromisifiedSymbol] = (promises as any).fsync;

var ftruncate = function ftruncate(
  fd: number,
  len: number | ((err: NodeJS.ErrnoException | null) => void) | undefined | null = 0,
  callback?: (err: NodeJS.ErrnoException | null) => void,
) {
  if ($isCallable(len)) {
    callback = len;
    len = 0;
  }

  const cb = ensureCallback(callback!) as (err: NodeJS.ErrnoException | null) => void;

  (fs.ftruncate(fd, len as number | null | undefined) as unknown as Promise<void>).then(() => cb(null), cb);
};
(ftruncate as any)[kCustomPromisifiedSymbol] = (promises as any).ftruncate;

var futimes = function futimes(
  fd: number,
  atime: string | number | Date,
  mtime: string | number | Date,
  callback: (err: NodeJS.ErrnoException | null) => void,
) {
  const cb = ensureCallback(callback!) as (err: NodeJS.ErrnoException | null) => void;

  (fs.futimes(fd, atime, mtime) as unknown as Promise<void>).then(() => cb(null), cb);
};
(futimes as any)[kCustomPromisifiedSymbol] = (promises as any).futimes;

var lchmod =
  constants.O_SYMLINK !== undefined
    ? function lchmod(path: PathLike, mode: Mode, callback: (err: NodeJS.ErrnoException | null) => void) {
        const cb = ensureCallback(callback);

        (fs.lchmod(path, mode) as unknown as Promise<void>).then(() => cb(null), cb);
      }
    : undefined;
if (lchmod) (lchmod as any)[kCustomPromisifiedSymbol] = (promises as any).lchmod;

var lchown = function lchown(
  path: PathLike,
  uid: number,
  gid: number,
  callback: (err: NodeJS.ErrnoException | null) => void,
) {
  const cb = ensureCallback(callback);

  (fs.lchown(path, uid, gid) as unknown as Promise<void>).then(() => cb(null), cb);
};
(lchown as any)[kCustomPromisifiedSymbol] = (promises as any).lchown;

var link = function link(
  existingPath: PathLike,
  newPath: PathLike,
  callback: (err: NodeJS.ErrnoException | null) => void,
) {
  const cb = ensureCallback(callback);

  (fs.link(existingPath, newPath) as Promise<void>).then(() => cb(null), cb);
};
(link as any)[kCustomPromisifiedSymbol] = (promises as any).link;

var mkdir = function mkdir(
  path: PathLike,
  options?:
    | Mode
    | (MakeDirectoryOptions & { recursive?: false })
    | null
    | ((err: NodeJS.ErrnoException | null) => void),
  callback?: (err: NodeJS.ErrnoException | null) => void,
) {
  if ($isCallable(options)) {
    callback = options;
    options = undefined;
  }

  const cb = ensureCallback(callback!);

  (fs.mkdir(path, options ?? undefined) as Promise<void>).then(() => cb(null), cb);
};
(mkdir as any)[kCustomPromisifiedSymbol] = (promises as any).mkdir;

var mkdtemp = function mkdtemp(
  prefix: string,
  options?:
    | ObjectEncodingOptions
    | BufferEncoding
    | null
    | ((err: NodeJS.ErrnoException | null, folder: string | Buffer) => void),
  callback?: (err: NodeJS.ErrnoException | null, folder: string | Buffer) => void,
) {
  if ($isCallable(options)) {
    callback = options as (err: NodeJS.ErrnoException | null, folder: string | Buffer) => void;
    options = undefined;
  }

  const cb = ensureCallback(callback!);
  let encoding: BufferEncoding | "buffer" | null | undefined;
  if (options && typeof options !== "string") {
    encoding = options.encoding;
  } else if (typeof options === "string") {
    encoding = options;
  } else {
    encoding = "utf8";
  }

  (fs.mkdtemp(prefix, options ?? null) as Promise<string | Buffer>).then(
    folder => cb(null, folder),
    err => cb(err, (encoding === "buffer" ? Buffer.alloc(0) : "") as string | Buffer),
  );
};
(mkdtemp as any)[kCustomPromisifiedSymbol] = (promises as any).mkdtemp;

var open = function open(
  path: PathLike,
  flags: OpenMode | ((err: NodeJS.ErrnoException | null, fd: number) => void),
  mode?: Mode | null | ((err: NodeJS.ErrnoException | null, fd: number) => void),
  callback?: (err: NodeJS.ErrnoException | null, fd: number) => void,
) {
  if (arguments.length < 3) {
    callback = flags as (err: NodeJS.ErrnoException | null, fd: number) => void;
    flags = undefined as any;
    mode = undefined;
  } else if ($isCallable(mode)) {
    callback = mode;
    mode = undefined;
  }

  const cb = ensureCallback(callback!);

  (fs.open(path, flags as OpenMode, mode === null ? undefined : mode) as Promise<FileHandle>).then(
    (handle: FileHandle) => cb(null, handle.fd),
    err => cb(err, -1),
  );
};
(open as any)[kCustomPromisifiedSymbol] = (promises as any).open;

var fdatasync = function fdatasync(fd: number, callback: (err: NodeJS.ErrnoException | null) => void) {
  const cb = ensureCallback(callback) as (err: NodeJS.ErrnoException | null) => void;

  (fs.fdatasync(fd) as Promise<void>).then(() => cb(null), cb);
};
(fdatasync as any)[kCustomPromisifiedSymbol] = (promises as any).fdatasync as unknown as Promise<void>;

var read: typeof import("node:fs").read = function read<TBuffer extends NodeJS.ArrayBufferView>(
  fd: number,
  buffer: TBuffer | ReadAsyncOptions<TBuffer> | undefined,
  offsetOrOptions:
    | number
    | (ReadAsyncOptions<TBuffer> & { buffer?: TBuffer })
    | ReadCallback<TBuffer>
    | null
    | undefined,
  length?: number | null,
  position?: ReadPosition | null,
  callback?: ReadCallback<TBuffer>,
) {
  let localBuffer: TBuffer | undefined;
  let offset: number = 0;
  let localLength: number = 0;
  let localPosition: ReadPosition | null = null;
  let localCallback: ReadCallback<TBuffer>;
  let options: ReadAsyncOptions<TBuffer> | null = null;

  if (arguments.length <= 4) {
    if (arguments.length === 4) {
      localBuffer = buffer as TBuffer;
      options = offsetOrOptions as ReadAsyncOptions<TBuffer>;
      localCallback = length as any;
    } else if (arguments.length === 3) {
      localCallback = offsetOrOptions as any;
      if (types.isArrayBufferView(buffer)) {
        localBuffer = buffer;
      } else if (buffer !== null && typeof buffer === "object") {
        options = buffer as ReadAsyncOptions<TBuffer>;
        localBuffer = options.buffer ?? undefined;
      }
    } else {
      localCallback = buffer as any;
    }

    if (!localBuffer) {
      throw $ERR_INVALID_ARG_TYPE("buffer", ["Buffer", "TypedArray", "DataView"], localBuffer);
    }

    if (options !== null && (typeof options !== "object" || $isArray(options))) {
      if (arguments.length === 4) {
        throw $ERR_INVALID_ARG_TYPE("options", "object", options);
      }
    }

    if (options !== null && typeof options === "object" && !$isArray(options)) {
      offset = options.offset ?? 0;
      localLength = options.length ?? localBuffer.byteLength - offset;
      localPosition = options.position ?? null;
    } else {
      offset = 0;
      localLength = localBuffer.byteLength;
      localPosition = null;
    }
  } else {
    localBuffer = buffer as TBuffer;
    offset = offsetOrOptions as number;
    localLength = length as number;
    localPosition = position ?? null;
    localCallback = callback!;
  }

  if (!$isCallable(localCallback)) {
    throw $ERR_INVALID_ARG_TYPE("callback", "function", localCallback);
  }

  const readOptions: ReadAsyncOptions<TBuffer> = {
    buffer: localBuffer!,
    offset,
    length: localLength,
    position: localPosition,
  };

  (fs.read(fd, readOptions as any) as unknown as Promise<{ bytesRead: number; buffer: TBuffer }>).then(
    ({ bytesRead, buffer: resultBuffer }) => localCallback(null, bytesRead, resultBuffer as TBuffer),
    err => localCallback(err, 0, localBuffer!),
  );
} as any;
(read as any)[kCustomPromisifiedSymbol] = (promises as any).read;

var write: typeof import("node:fs").write = function write<TBuffer extends NodeJS.ArrayBufferView | string>(
  fd: number,
  bufferOrString: TBuffer,
  offsetOrOptions?: number | BufferEncoding | WriteSyncOptions | null | WriteCallback<TBuffer>,
  lengthOrEncoding?: number | BufferEncoding | null,
  position?: number | null | WriteCallback<TBuffer>,
  callback?: WriteCallback<TBuffer>,
) {
  let localCallback: WriteCallback<TBuffer>;
  let localOffset: number | undefined;
  let localLength: number | undefined;
  let localPosition: number | null | undefined;
  let localEncoding: BufferEncoding | undefined;

  function wrapper(result: { bytesWritten: number; buffer: TBuffer }) {
    if (localCallback) {
      localCallback(null, result.bytesWritten, result.buffer);
    }
  }

  function errWrapper(err: NodeJS.ErrnoException | null) {
    if (localCallback) {
      localCallback(err, 0, bufferOrString);
    }
  }

  if ($isTypedArrayView(bufferOrString)) {
    if ($isCallable(offsetOrOptions)) {
      localCallback = ensureCallback(offsetOrOptions) as WriteCallback<TBuffer>;
      localOffset = 0;
      localLength = bufferOrString.byteLength;
      localPosition = null;
    } else if ($isCallable(lengthOrEncoding)) {
      localCallback = ensureCallback(lengthOrEncoding) as WriteCallback<TBuffer>;
      localOffset = offsetOrOptions as number;
      localLength = bufferOrString.byteLength - (localOffset ?? 0);
      localPosition = null;
    } else if ($isCallable(position)) {
      localCallback = ensureCallback(position) as WriteCallback<TBuffer>;
      localOffset = offsetOrOptions as number;
      localLength = lengthOrEncoding as number;
      localPosition = null;
    } else {
      localCallback = ensureCallback(callback!) as WriteCallback<TBuffer>;
      localOffset = offsetOrOptions as number;
      localLength = lengthOrEncoding as number;
      localPosition = position as number | null | undefined;
    }
    (fs.write(fd, bufferOrString, {
      offset: localOffset,
      length: localLength,
      position: localPosition,
    } as any) as unknown as Promise<{ bytesWritten: number; buffer: TBuffer }>).then(wrapper, errWrapper);
  } else if (typeof bufferOrString === "string") {
    if ($isCallable(offsetOrOptions)) {
      localCallback = ensureCallback(offsetOrOptions) as WriteCallback<TBuffer>;
      localPosition = null;
      localEncoding = "utf8";
    } else if ($isCallable(lengthOrEncoding)) {
      localCallback = ensureCallback(lengthOrEncoding) as WriteCallback<TBuffer>;
      localPosition = offsetOrOptions as number | null | undefined;
      localEncoding = "utf8";
    } else if ($isCallable(position)) {
      localCallback = ensureCallback(position) as WriteCallback<TBuffer>;
      localPosition = offsetOrOptions as number | null | undefined;
      localEncoding = lengthOrEncoding as BufferEncoding | undefined;
    } else {
      if (!$isCallable(callback)) {
        throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
      }
      localCallback = ensureCallback(callback!) as WriteCallback<TBuffer>;
      localPosition = offsetOrOptions as number | null | undefined;
      localEncoding = lengthOrEncoding as BufferEncoding | undefined;
    }
    (fs.write(
      fd,
      bufferOrString as string,
      { position: localPosition, encoding: localEncoding } as any,
    ) as unknown as Promise<{ bytesWritten: number; buffer: TBuffer }>).then(wrapper, errWrapper);
  } else {
    throw $ERR_INVALID_ARG_TYPE("bufferOrString", ["Buffer", "TypedArray", "DataView", "string"], bufferOrString);
  }
} as any;
(write as any)[kCustomPromisifiedSymbol] = (promises as any).write;

var readdir: typeof import("node:fs").readdir = function readdir(
  path: PathLike,
  options?: ReaddirOptions | BufferEncoding | null | ReaddirCallback,
  callback?: ReaddirCallback,
) {
  if ($isCallable(options)) {
    callback = options as ReaddirCallback;
    options = undefined;
  }

  const cb = ensureCallback(callback!) as ReaddirCallback;

  (fs.readdir(path, options as any) as Promise<string[] | Buffer[] | DirentType[]>).then(
    files => cb(null, files),
    err => cb(err, []),
  );
} as any;
(readdir as any)[kCustomPromisifiedSymbol] = (promises as any).readdir as unknown as Promise<
  string[] | Buffer[] | DirentType[]
>;

var readFile: typeof import("node:fs").readFile = function readFile(
  path: PathLike | FileHandle,
  options?: ReadFileOptions | BufferEncoding | null | ReadFileCallback,
  callback?: ReadFileCallback,
) {
  if ($isCallable(options)) {
    callback = options as ReadFileCallback;
    options = undefined;
  }
  const cb = ensureCallback(callback!) as ReadFileCallback;
  let encoding: BufferEncoding | "buffer" | null | undefined;
  if (options && typeof options !== "string") {
    encoding = options.encoding;
  } else if (typeof options === "string") {
    encoding = options;
  }

  (fs.readFile(path, options ?? undefined) as Promise<Buffer | string>).then(
    data => cb(null, data),
    err => cb(err, (encoding === "buffer" || !encoding ? Buffer.alloc(0) : "") as any),
  );
} as any;
(readFile as any)[kCustomPromisifiedSymbol] = (promises as any).readFile;

var writeFile: typeof import("node:fs").writeFile = function writeFile(
  path: PathLike | FileHandle,
  data:
    | string
    | NodeJS.ArrayBufferView
    | Iterable<string | NodeJS.ArrayBufferView>
    | AsyncIterable<string | NodeJS.ArrayBufferView>
    | Stream,
  options?: WriteFileOptions | BufferEncoding | null | NoParamCallback | undefined,
  callback?: NoParamCallback,
) {
  if ($isCallable(options)) {
    callback = options as NoParamCallback;
    options = undefined;
  }
  const cb = ensureCallback(callback!) as NoParamCallback;

  (fs.writeFile(path, data, options ?? undefined) as Promise<void>).then(() => cb(null), cb);
} as any;
(writeFile as any)[kCustomPromisifiedSymbol] = (promises as any).writeFile;

var readlink: typeof import("node:fs").readlink = function readlink(
  path: PathLike,
  options?: ReadlinkOptions | BufferEncoding | null | ReadlinkCallback,
  callback?: ReadlinkCallback,
) {
  if ($isCallable(options)) {
    callback = options as ReadlinkCallback;
    options = undefined;
  }

  const cb = ensureCallback(callback!) as ReadlinkCallback;
  let encoding: BufferEncoding | "buffer" | null | undefined;
  if (options && typeof options !== "string") {
    encoding = options.encoding;
  } else if (typeof options === "string") {
    encoding = options;
  }

  (fs.readlink(path, options ?? undefined) as Promise<string | Buffer>).then(
    linkString => cb(null, linkString),
    err => cb(err, (encoding === "buffer" ? Buffer.alloc(0) : "") as any),
  );
} as any;
(readlink as any)[kCustomPromisifiedSymbol] = (promises as any).readlink;

var rename = function rename(
  oldPath: PathLike,
  newPath: PathLike,
  callback: (err: NodeJS.ErrnoException | null) => void,
) {
  const cb = ensureCallback(callback);

  (fs.rename(oldPath, newPath) as Promise<void>).then(() => cb(null), cb);
};
(rename as any)[kCustomPromisifiedSymbol] = (promises as any).rename;

var lstat: typeof import("node:fs").lstat = function lstat(
  path: PathLike,
  options?: StatOptions | StatCallback,
  callback?: StatCallback,
) {
  if ($isCallable(options)) {
    callback = options as StatCallback;
    options = undefined;
  }

  const cb = ensureCallback(callback!) as StatCallback;

  (fs.lstat(path, options as StatOptions | undefined) as Promise<StatsType | BigIntStatsType>).then(
    stats => cb(null, stats as StatsType | BigIntStatsType),
    err => cb(err, null),
  );
} as any;
(lstat as any)[kCustomPromisifiedSymbol] = (promises as any).lstat;

var stat: typeof import("node:fs").stat = function stat(
  path: PathLike,
  options?: StatOptions | StatCallback,
  callback?: StatCallback,
) {
  if ($isCallable(options)) {
    callback = options as StatCallback;
    options = undefined;
  }

  const cb = ensureCallback(callback!) as StatCallback;

  (fs.stat(path, options as StatOptions | undefined) as Promise<StatsType | BigIntStatsType>).then(
    stats => cb(null, stats as StatsType | BigIntStatsType),
    err => cb(err, null),
  );
} as any;
(stat as any)[kCustomPromisifiedSymbol] = (promises as any).stat;

var statfs: typeof import("node:fs").statfs = function statfs(
  path: PathLike,
  options?: StatFsOptions | StatFsCallback,
  callback?: StatFsCallback,
) {
  if ($isCallable(options)) {
    callback = options as StatFsCallback;
    options = undefined;
  }

  const cb = ensureCallback(callback!) as StatFsCallback;

  (fs.statfs(path, options as StatFsOptions | undefined) as Promise<StatsFsType | BigIntStatsFsType>).then(
    stats => cb(null, stats as StatsFsType | BigIntStatsFsType),
    err => cb(err, null),
  );
} as any;
(statfs as any)[kCustomPromisifiedSymbol] = (promises as any).statfs;

var symlink = function symlink(
  target: PathLike,
  path: PathLike,
  type: "dir" | "file" | "junction" | null | ((err: NodeJS.ErrnoException | null) => void),
  callback?: (err: NodeJS.ErrnoException | null) => void,
) {
  if (callback === undefined && $isCallable(type)) {
    callback = type;
    type = null;
  }
  const cb = ensureCallback(callback!);

  (fs.symlink(target, path, type as "dir" | "file" | "junction" | null | undefined) as Promise<void>).then(
    () => cb(null),
    cb,
  );
};
(symlink as any)[kCustomPromisifiedSymbol] = (promises as any).symlink;

var truncate = function truncate(
  path: PathLike | number,
  len?: number | null | ((err: NodeJS.ErrnoException | null) => void),
  callback?: (err: NodeJS.ErrnoException | null) => void,
) {
  if (typeof path === "number") {
    if ($isCallable(len)) {
      callback = len;
      len = 0;
    }
    const cb = ensureCallback(callback!);
    return ftruncate(path, len as number | null | undefined, cb);
  }

  if ($isCallable(len)) {
    callback = len;
    len = 0;
  } else if (len === undefined) {
    len = 0;
  }

  const cb = ensureCallback(callback!);
  (fs.truncate(path, len === null ? undefined : len) as Promise<void>).then(() => cb(null), cb);
};
(truncate as any)[kCustomPromisifiedSymbol] = (promises as any).truncate;

var unlink = function unlink(path: PathLike, callback: (err: NodeJS.ErrnoException | null) => void) {
  const cb = ensureCallback(callback);

  (fs.unlink(path) as Promise<void>).then(() => cb(null), cb);
};
(unlink as any)[kCustomPromisifiedSymbol] = (promises as any).unlink;

var utimes = function utimes(
  path: PathLike,
  atime: string | number | Date,
  mtime: string | number | Date,
  callback: (err: NodeJS.ErrnoException | null) => void,
) {
  const cb = ensureCallback(callback);

  (fs.utimes(path, atime, mtime) as Promise<void>).then(() => cb(null), cb);
};
(utimes as any)[kCustomPromisifiedSymbol] = (promises as any).utimes;

var lutimes = function lutimes(
  path: PathLike,
  atime: string | number | Date,
  mtime: string | number | Date,
  callback: (err: NodeJS.ErrnoException | null) => void,
) {
  const cb = ensureCallback(callback);
  if (path === undefined || path === null) {
    const err = $ERR_INVALID_ARG_TYPE("path", ["string", "Buffer", "URL"], path);
    process.nextTick(() => cb(err));
    return;
  }
  (fs.lutimes(path, atime, mtime) as Promise<void>).then(() => cb(null), cb);
};
(lutimes as any)[kCustomPromisifiedSymbol] = (promises as any).lutimes;

var accessSync = fs.accessSync.bind(fs);
var appendFileSync = fs.appendFileSync.bind(fs);
var closeSync = fs.closeSync.bind(fs);
var copyFileSync = fs.copyFileSync.bind(fs);
var existsSync = function existsSync(path: PathLike): boolean {
  try {
    return fs.existsSync(path);
  } catch {
    return false;
  }
};
var chownSync = fs.chownSync.bind(fs);
var chmodSync = fs.chmodSync.bind(fs);
var fchmodSync = fs.fchmodSync.bind(fs);
var fchownSync = fs.fchownSync.bind(fs);
var fstatSync = fs.fstatSync.bind(fs) as unknown as StatSyncFn;
var fsyncSync = fs.fsyncSync.bind(fs);
var ftruncateSync = fs.ftruncateSync.bind(fs);
var futimesSync = fs.futimesSync.bind(fs);
var lchmodSync = constants.O_SYMLINK !== undefined ? (fs.lchmodSync.bind(fs) as any) : undefined;
var lchownSync = fs.lchownSync.bind(fs);
var linkSync = fs.linkSync.bind(fs);
var lstatSync = fs.lstatSync.bind(fs) as unknown as StatSyncFn;
var mkdirSync = fs.mkdirSync.bind(fs);
var mkdtempSync = fs.mkdtempSync.bind(fs);
var openSync = fs.openSync.bind(fs);
var readSync: typeof import("node:fs").readSync = function readSync<TBuffer extends NodeJS.ArrayBufferView>(
  fd: number,
  buffer: TBuffer,
  offsetOrOptions?: number | ReadSyncOptions,
  length?: number,
  position?: ReadPosition | null,
): number {
  let offset: number;
  let localLength: number;
  let localPosition: ReadPosition | null;

  if (arguments.length <= 3 || typeof offsetOrOptions === "object") {
    const options = offsetOrOptions as ReadSyncOptions | undefined | null;
    if (options !== undefined && options !== null) {
      if (typeof options !== "object" || $isArray(options)) {
        throw $ERR_INVALID_ARG_TYPE("options", "object", options);
      }
    }

    offset = options?.offset ?? 0;
    localLength = options?.length ?? buffer.byteLength - offset;
    localPosition = options?.position ?? null;
  } else {
    offset = offsetOrOptions as number;
    localLength = length as number;
    localPosition = position ?? null;
  }

  return fs.readSync(fd, buffer, offset, localLength, localPosition);
};
var writeSync = fs.writeSync.bind(fs);
var readdirSync = fs.readdirSync.bind(fs);
var readFileSync = fs.readFileSync.bind(fs);
var fdatasyncSync = fs.fdatasyncSync.bind(fs);
var writeFileSync = fs.writeFileSync.bind(fs);
var readlinkSync = fs.readlinkSync.bind(fs);
var renameSync = fs.renameSync.bind(fs);
var statSync = fs.statSync.bind(fs) as unknown as StatSyncFn;
var statfsSync = fs.statfsSync.bind(fs) as unknown as StatFsSyncFn;
var symlinkSync = fs.symlinkSync.bind(fs);
var truncateSync = fs.truncateSync.bind(fs);
var unlinkSync = fs.unlinkSync.bind(fs);
var utimesSync = fs.utimesSync.bind(fs);
var lutimesSync = fs.lutimesSync.bind(fs);
var rmSync = fs.rmSync.bind(fs);
var rmdirSync = fs.rmdirSync.bind(fs);
var writev: typeof import("node:fs").writev = function writev(
  fd: number,
  buffers: readonly NodeJS.ArrayBufferView[],
  position: number | null | WriteVCallback,
  callback?: WriteVCallback,
) {
  if (typeof position === "function") {
    callback = position;
    position = null;
  }

  const cb: WriteVCallback = ensureCallback(callback!);

  (fs.writev(fd, buffers, position as number | null | undefined) as unknown as Promise<WriteVResult>).then(
    ({ bytesWritten, buffers: resultBuffers }) =>
      cb(null, bytesWritten, resultBuffers as readonly NodeJS.ArrayBufferView[]),
    err => cb(err, 0, buffers),
  );
} as any;
(writev as any)[kCustomPromisifiedSymbol] = (promises as any).writev;

var writevSync = fs.writevSync.bind(fs);
var readv: typeof import("node:fs").readv = function readv(
  fd: number,
  buffers: readonly NodeJS.ArrayBufferView[],
  position: number | null | ReadVCallback,
  callback?: ReadVCallback,
) {
  if (typeof position === "function") {
    callback = position;
    position = null;
  }

  const cb: ReadVCallback = ensureCallback(callback!);

  (fs.readv(fd, buffers, position as number | null | undefined) as unknown as Promise<ReadVResult>).then(
    ({ bytesRead, buffers: resultBuffers }) => cb(null, bytesRead, resultBuffers as readonly NodeJS.ArrayBufferView[]),
    err => cb(err, 0, buffers),
  );
} as any;
(readv as any)[kCustomPromisifiedSymbol] = (promises as any).readv;

var readvSync = fs.readvSync.bind(fs);
var Dirent = fs.Dirent;
var Stats = fs.Stats;
var StatsFs = fs.StatsFs;
var watch = function watch(
  path: PathLike,
  options?: WatchOptions | BufferEncoding | WatchListener<string | Buffer> | null,
  listener?: WatchListener<string | Buffer>,
): FSWatcher {
  return new FSWatcher(path, options, listener);
};
var opendir = function opendir(
  path: PathLike,
  options: OpenDirOptions | ((err: NodeJS.ErrnoException | null, dir: Dir) => void) | undefined,
  callback?: (err: NodeJS.ErrnoException | null, dir: Dir) => void,
) {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  const cb = ensureCallback(callback!);
  const result = new LocalDir(1, path, options);
  process.nextTick(() => cb(null, result));
};
(opendir as any)[kCustomPromisifiedSymbol] = (promises as any).opendir;

const { defineCustomPromisifyArgs } = require("internal/promisify");

const statWatchers = new Map<string, StatWatcher>();
function getValidatedPath(p: any): string {
  if (p instanceof URL) return Bun.fileURLToPath(p);
  if (Buffer.isBuffer(p)) p = p.toString();
  if (typeof p !== "string") throw $ERR_INVALID_ARG_TYPE("path", ["string", "Buffer", "URL"], p);
  return require("node:path").resolve(p as string);
}
function watchFile(
  filename: PathLike,
  options: { persistent?: boolean; interval?: number } | ((curr: StatsType, prev: StatsType) => void),
  listener?: (curr: StatsType, prev: StatsType) => void,
): StatWatcher {
  const Sfilename = getValidatedPath(filename);

  if (typeof options === "function") {
    listener = options;
    options = {};
  }

  if (typeof listener !== "function") {
    throw new TypeError("listener must be a function");
  }

  var stat = statWatchers.get(Sfilename);
  if (!stat) {
    stat = new StatWatcher(Sfilename, options);
    statWatchers.set(Sfilename, stat);
  }
  if (listener) {
    stat.addListener("change", listener);
  }
  return stat;
}
function unwatchFile(filename: PathLike, listener?: (curr: StatsType, prev: StatsType) => void): void {
  const Sfilename = getValidatedPath(filename);

  var stat = statWatchers.get(Sfilename);
  if (!stat) {
    throwIfNullBytesInFileName(Sfilename);
    return;
  }
  if (listener) {
    stat.removeListener("change", listener as (...args: any[]) => void);
    if (stat.listenerCount("change") !== 0) {
      return;
    }
  } else {
    stat.removeAllListeners("change");
  }
  stat.stop();
  statWatchers.delete(Sfilename);
}

function throwIfNullBytesInFileName(filename: string) {
  if (filename.indexOf("\u0000") !== -1) {
    throw $ERR_INVALID_ARG_VALUE("path", filename, "string without null bytes");
  }
}

function createReadStream(path: PathLike, options?: ReadStreamOptions | BufferEncoding): import("fs").ReadStream {
  return new exports.ReadStream(path, options);
}

function createWriteStream(path: PathLike, options?: WriteStreamOptions | BufferEncoding): import("fs").WriteStream {
  return new exports.WriteStream(path, options);
}

const splitRootWindowsRe = /^(?:[a-zA-Z]:|[\\/]{2}[^\\/]+[\\/][^\\/]+)?[\\/]*/;
function splitRootWindows(str: string): string {
  const match = (splitRootWindowsRe as any).exec(str);
  return match ? match[0] : "";
}
function nextPartWindows(p: string, i: number): number {
  for (; i < p.length; ++i) {
    const ch = p.$charCodeAt(i);
    if (ch === 92 || ch === 47) return i;
  }
  return -1;
}

function encodeRealpathResult(result: string | Buffer, encoding?: BufferEncoding | "buffer" | null): string | Buffer {
  if (!encoding || encoding === "utf8") return result;
  const asBuffer = Buffer.isBuffer(result) ? result : Buffer.from(result);
  if (encoding === "buffer") {
    return asBuffer;
  }
  return asBuffer.toString(encoding);
}

let assertEncodingForWindows: ((enc: string) => void) | undefined = undefined;

const realpathSync: typeof import("node:fs").realpathSync & { native?: typeof import("node:fs").realpathSync.native } =
  process.platform !== "win32"
    ? (fs.realpathSync.bind(fs) as typeof import("node:fs").realpathSync)
    : Object.assign(
        function realpathSync(p: PathLike, options?: RealpathSyncOptions | BufferEncoding | null): string | Buffer {
          let encoding: BufferEncoding | "buffer" | null | undefined;
          if (options) {
            if (typeof options === "string")
              encoding = options as BufferEncoding;
            else encoding = (options as ObjectEncodingOptions)?.encoding;
            if (encoding) {
              (assertEncodingForWindows ??= $newZigFunction("types.zig", "jsAssertEncodingValid", 1))?.(encoding);
            }
          }
          let pathStr: string;
          if (p instanceof URL) {
            if (p.pathname.indexOf("%00") != -1) {
              throw $ERR_INVALID_ARG_VALUE("path", p.pathname, "string without null bytes");
            }
            pathStr = Bun.fileURLToPath(p);
          } else if (Buffer.isBuffer(p)) {
            pathStr = p.toString();
          } else if (typeof p === "string") {
            pathStr = getValidatedPath(p);
          } else {
            throw $ERR_INVALID_ARG_TYPE("path", ["string", "Buffer", "URL"], p);
          }
          throwIfNullBytesInFileName(pathStr);
          const knownHard = new Set<string>();
          let pos;
          let current;
          let base;
          let previous;
          const rootMatch = (splitRootWindowsRe as any).exec(pathStr);
          current = base = rootMatch ? rootMatch[0] : "";
          pos = current.length;
          let lastStat: StatsType | undefined = lstatSync(String(base), undefined) as StatsType | undefined;
          if (lastStat === undefined) throw $ERR_INVALID_ARG_VALUE("path", pathStr, "Root does not exist");
          knownHard.add(base);

          const pathModule = require("node:path");

          while (pos < pathStr.length) {
            const result = nextPartWindows(pathStr, pos);
            previous = current;
            if (result === -1) {
              const last = pathStr.slice(pos);
              current += last;
              base = previous + last;
              pos = pathStr.length;
            } else {
              current += pathStr.slice(pos, result + 1);
              base = previous + pathStr.slice(pos, result);
              pos = result + 1;
            }

            if (knownHard.has(base)) {
              if (base !== splitRootWindows(pathStr)) {
                lastStat = lstatSync(String(base), undefined) as StatsType | undefined;
                if (lastStat === undefined)
                  throw $ERR_INVALID_ARG_VALUE("path", pathStr, `Path segment ${base} does not exist`);
              }
              if (lastStat!.isFIFO() || lastStat!.isSocket()) {
                break;
              }
              continue;
            }

            let resolvedLink;
            lastStat = fs.lstatSync(String(base), undefined) as StatsType | undefined;
            if (lastStat === undefined)
              throw $ERR_INVALID_ARG_VALUE("path", pathStr, `Path segment ${base} does not exist`);

            if (!lastStat.isSymbolicLink()) {
              knownHard.add(base);
              continue;
            }

            lastStat = fs.statSync(String(base), undefined) as StatsType | undefined;
            if (lastStat === undefined)
              throw $ERR_INVALID_ARG_VALUE("path", pathStr, `Symlink target for ${base} does not exist`);

            const linkTarget = fs.readlinkSync(String(base)) as string;
            resolvedLink = pathModule.resolve(previous, linkTarget);

            pathStr = pathModule.resolve(resolvedLink, pathStr.slice(pos));

            const newRootMatch = (splitRootWindowsRe as any).exec(pathStr);
            current = base = newRootMatch ? newRootMatch[0] : "";
            pos = current.length;

            if (!knownHard.has(base)) {
              lastStat = fs.lstatSync(String(base), undefined) as StatsType | undefined;
              if (lastStat === undefined)
                throw $ERR_INVALID_ARG_VALUE("path", pathStr, "Root does not exist after resolving symlink");
              knownHard.add(base);
            }
          }

          return encodeRealpathResult(pathStr, encoding ?? null);
        },
        { native: fs.realpathSync.bind(fs) }
      );

const realpath: typeof import("node:fs").realpath & { native?: typeof import("node:fs").realpath.native } =
  process.platform !== "win32"
    ? (function realpath(
        p: PathLike,
        optionsOrCallback?: RealpathOptions | BufferEncoding | null | RealpathCallback,
        callback?: RealpathCallback,
      ): void {
        let options: RealpathOptions | BufferEncoding | null | undefined;
        if ($isCallable(optionsOrCallback)) {
          callback = optionsOrCallback as RealpathCallback;
          options = undefined;
        } else {
          options = optionsOrCallback as RealpathOptions | BufferEncoding | null | undefined;
        }
        const cb = ensureCallback(callback!) as RealpathCallback;
        let encoding: BufferEncoding | "buffer" | null | undefined;
        if (options && typeof options !== "string") {
          encoding = options.encoding;
        } else if (typeof options === "string") {
          encoding = options;
        }

        (fs.realpath(p, options) as Promise<string | Buffer>).then(
          resolvedPath => cb(null, resolvedPath),
          err => cb(err, null),
        );
      } as any)
    : Object.assign(
        function realpath(
          p: PathLike,
          optionsOrCallback?: RealpathOptions | BufferEncoding | null | RealpathCallback,
          callback?: RealpathCallback,
        ): void {
          let options: RealpathOptions | BufferEncoding | null | undefined;
          if ($isCallable(optionsOrCallback)) {
            callback = optionsOrCallback as RealpathCallback;
            options = undefined;
          } else {
            options = optionsOrCallback as RealpathOptions | BufferEncoding | null | undefined;
          }
          const cb = ensureCallback(callback!) as RealpathCallback;

          let encoding: BufferEncoding | "buffer" | null | undefined;
          if (options) {
            if (typeof options === "string")
              encoding = options as BufferEncoding;
            else encoding = typeof options === "object" && options !== null ? options.encoding : undefined;
            if (encoding) {
              (assertEncodingForWindows ??= $newZigFunction("types.zig", "jsAssertEncodingValid", 1))?.(encoding);
            }
          }

          let pathStr: string;
          try {
            if (p instanceof URL) {
              if (p.pathname.indexOf("%00") != -1) {
                throw $ERR_INVALID_ARG_VALUE("path", p.pathname, "string without null bytes");
              }
              pathStr = Bun.fileURLToPath(p);
            } else if (Buffer.isBuffer(p)) {
              pathStr = p.toString();
            } else if (typeof p === "string") {
              pathStr = getValidatedPath(p);
            } else {
              throw $ERR_INVALID_ARG_TYPE("path", ["string", "Buffer", "URL"], p);
            }
            throwIfNullBytesInFileName(pathStr);
          } catch (err) {
            return process.nextTick(() => cb(err as NodeJS.ErrnoException, null));
          }

          const knownHard = new Set<string>();
          const pathModule = require("node:path");

          let pos: number;
          let current: string;
          let base: string;
          let previous: string;

          const rootMatch = (splitRootWindowsRe as any).exec(pathStr);
          current = base = rootMatch ? rootMatch[0] : "";
          pos = current.length;

          let lastStat!: StatsType;

          if (!knownHard.has(base)) {
            lstat(String(base), { bigint: false }, (err, s) => {
              if (err) return cb(err, null);
              lastStat = s!;
              knownHard.add(base);
              LOOP();
            });
          } else {
            lstat(String(base), { bigint: false }, (err, s) => {
              if (err) return cb(err, null);
              lastStat = s!;
              process.nextTick(LOOP);
            });
          }

          function LOOP() {
            while (true) {
              if (pos >= pathStr.length) {
                return cb(null, encodeRealpathResult(pathStr, encoding ?? null) as string | Buffer | null);
              }

              const result = nextPartWindows(pathStr, pos);
              previous = current;
              if (result === -1) {
                const last = pathStr.slice(pos);
                current += last;
                base = previous + last;
                pos = pathStr.length;
              } else {
                current += pathStr.slice(pos, result + 1);
                base = previous + pathStr.slice(pos, result);
                pos = result + 1;
              }

              if (knownHard.has(base)) {
                if (base !== splitRootWindows(pathStr)) {
                  return lstat(String(base), { bigint: false }, (err, s) => {
                    if (err) return cb(err, null);
                    lastStat = s!;
                    if (lastStat.isFIFO() || lastStat.isSocket()) {
                      return cb(null, encodeRealpathResult(pathStr, encoding ?? null) as string | Buffer | null);
                    }
                    process.nextTick(LOOP);
                  });
                } else {
                  if (lastStat.isFIFO() || lastStat.isSocket()) {
                    return cb(null, encodeRealpathResult(pathStr, encoding ?? null) as string | Buffer | null);
                  }
                  continue;
                }
              }

              return lstat(String(base), { bigint: false }, gotStat);
            }
          }

          function gotStat(err, stats) {
            if (err) return cb(err, null);

            if (!stats!.isSymbolicLink()) {
              knownHard.add(base);
              lastStat = stats!;
              return process.nextTick(LOOP);
            }

            stat(String(base), { bigint: false }, (err, s) => {
              if (err) return cb(err, null);
              lastStat = s!;

              readlink(String(base), (err, target) => {
                if (err) return cb(err, null);
                gotTarget(target as string);
              });
            });
          }

          function gotTarget(target: string) {
            gotResolvedLink(pathModule.resolve(previous, target));
          }

          function gotResolvedLink(resolvedLink: string) {
            pathStr = pathModule.resolve(resolvedLink, pathStr.slice(pos));
            const newRootMatch = (splitRootWindowsRe as any).exec(pathStr);
            current = base = newRootMatch ? newRootMatch[0] : "";
            pos = current.length;

            if (!knownHard.has(base)) {
              lstat(String(base), { bigint: false }, (err, s) => {
                if (err) return cb(err, null);
                lastStat = s!;
                knownHard.add(base);
                LOOP();
              });
            } else {
              lstat(String(base), { bigint: false }, (err, s) => {
                if (err) return cb(err, null);
                lastStat = s!;
                process.nextTick(LOOP);
              });
            }
          }
        },
        { native: function realpathNative(
            p: PathLike,
            optionsOrCallback?: RealpathOptions | BufferEncoding | null | RealpathCallback,
            callback?: RealpathCallback,
          ): void {
            let options: RealpathOptions | BufferEncoding | null | undefined;
            if ($isCallable(optionsOrCallback)) {
              callback = optionsOrCallback as RealpathCallback;
              options = undefined;
            } else {
              options = optionsOrCallback as RealpathOptions | BufferEncoding | null | undefined;
            }
            const cb = ensureCallback(callback!) as RealpathCallback;
            let encoding: BufferEncoding | "buffer" | null | undefined;
            if (options && typeof options !== "string") {
              encoding = options.encoding;
            } else if (typeof options === "string") {
              encoding = options;
            }

            (fs.realpath as any)(p, options, true).then(
              resolvedPath => cb(null, resolvedPath),
              err => cb(err, null),
            );
          }
        }
      );

(realpath as any)[kCustomPromisifiedSymbol] = (promises as any).realpath;

function cpSync(src: PathLike, dest: PathLike, options?: CopySyncOptions): void {
  if (!options) return fs.cpSync(String(src), String(dest));
  if (typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  if (options.dereference || options.filter || options.preserveTimestamps || options.verbatimSymlinks) {
    return require("internal/fs/cp-sync")(src, dest, options);
  }
  return fs.cpSync(
    String(src),
    String(dest),
    options.recursive,
    options.errorOnExist,
    options.force ?? true,
    options.mode,
  );
}

function cp(
  src: PathLike,
  dest: PathLike,
  options?: CopyOptions | ((err: NodeJS.ErrnoException | null) => void),
  callback?: (err: NodeJS.ErrnoException | null) => void,
): void {
  if ($isCallable(options)) {
    callback = options;
    options = undefined;
  }

  const cb = ensureCallback(callback!);

  (promises.cp(src, dest, options) as Promise<void>).then(() => cb(null), cb);
}
(cp as any)[kCustomPromisifiedSymbol] = (promises as any).cp;

function _toUnixTimestamp(time: any, name = "time"): number {
  if (typeof time === "string" && +time == time) {
    return +time;
  }
  if (Number.isFinite(time)) {
    if (time < 0) {
      return Date.now() / 1000;
    }
    return time;
  }
  if (isDate(time)) {
    return time.getTime() / 1000;
  }
  throw $ERR_INVALID_ARG_TYPE(name, ["number", "Date"], time);
}

function opendirSync(path: PathLike, options?: OpenDirOptions): Dir {
  return new LocalDir(1, path, options);
}

class LocalDir implements Dir {
  #handle: number;
  #path: PathLike;
  #options?: OpenDirOptions;
  #entries: DirentType[] | null = null;
  #closed = false;
  #readingPromise: Promise<DirentType[]> | null = null;

  constructor(handle: number, path: PathLike, options?: OpenDirOptions) {
    if ($isUndefinedOrNull(handle)) throw $ERR_MISSING_ARGS("handle");
    validateInteger(handle, "handle", 0);
    this.#handle = $toLength(handle);
    this.#path = path;
    this.#options = options;
  }

  #loadEntriesSync(): void {
    if (!this.#entries) {
      this.#entries = fs.readdirSync(this.#path, {
        withFileTypes: true,
        encoding: this.#options?.encoding,
        recursive: this.#options?.recursive,
      }) as DirentType[];
    }
  }

  #loadEntries(): Promise<DirentType[]> {
    if (this.#entries) {
      return Promise.resolve(this.#entries);
    }
    if (this.#readingPromise) {
      return this.#readingPromise;
    }
    this.#readingPromise = (
      fs.readdir(this.#path, {
        withFileTypes: true,
        encoding: this.#options?.encoding,
        recursive: this.#options?.recursive,
      } as any) as Promise<DirentType[]>
    ).then(entries => {
      this.#entries = entries;
      this.#readingPromise = null;
      return entries;
    });
    return this.#readingPromise;
  }

  readSync(): DirentType | null {
    if (this.#closed) throw $ERR_DIR_CLOSED();
    this.#loadEntriesSync();
    return this.#entries!.shift() ?? null;
  }

  read(cb?: (err: Error | null, entry: DirentType | null) => void): Promise<DirentType | null> {
    if (this.#closed) {
      const err = $ERR_DIR_CLOSED();
      if (cb) {
        validateFunction(cb, "callback");
        process.nextTick(() => cb(err, null));
        return Promise.resolve(null);
      }
      return Promise.reject(err);
    }

    const promise = this.#loadEntries().then(entries => entries.shift() ?? null);

    if (cb) {
      validateFunction(cb, "callback");
      promise.then(
        entry => process.nextTick(() => cb!(null, entry)),
        err => process.nextTick(() => cb!(err, null)),
      );
    }

    return promise;
  }

  close(cb?: (err: NodeJS.ErrnoException | null) => void): Promise<void> {
    if (this.#closed) {
      const err = $ERR_DIR_CLOSED();
      if (cb) {
        validateFunction(cb, "callback");
        process.nextTick(() => cb(err));
        return Promise.resolve();
      }
      return Promise.reject(err);
    }

    this.#closed = true;
    this.#entries = null;
    this.#readingPromise = null;

    if (cb) {
      validateFunction(cb, "callback");
      process.nextTick(() => cb!(null));
    }
    return Promise.resolve();
  }

  closeSync(): void {
    if (this.#closed) throw $ERR_DIR_CLOSED();
    this.#closed = true;
    this.#entries = null;
    this.#readingPromise = null;
  }

  get path(): string {
    return String(this.#path);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<DirentType, void, undefined> {
    if (this.#closed) throw $ERR_DIR_CLOSED();
    try {
      const entries = await this.#loadEntries();
      while (entries.length > 0) {
        if (this.#closed) throw $ERR_DIR_CLOSED();
        yield entries.shift()!;
      }
    } catch (err) {
      this.#closed = true;
      throw err;
    } finally {
      if (!this.#closed) {
        await this.close();
      }
    }
  }
}

function glob(
  pattern: string | string[],
  options: GlobOptions | ((err: Error | null, matches: string[]) => void),
  callback?: (err: Error | null, matches: string[]) => void,
): void {
  let localOptions: GlobOptions | undefined;
  if (typeof options === "function") {
    callback = options;
    localOptions = undefined;
  } else {
    localOptions = options;
  }
  const cb = ensureCallback(callback!);

  Array.fromAsync(lazyGlob().glob(pattern, localOptions ?? kEmptyObject))
    .then(result => cb(null, result as string[]))
    .catch(err => cb(err, []));
}

function globSync(pattern: string | string[], options?: GlobOptions): string[] {
  return Array.from(lazyGlob().globSync(pattern, options ?? kEmptyObject)) as string[];
}

var exports = {
  appendFile,
  appendFileSync,
  access,
  accessSync,
  chown,
  chownSync,
  chmod,
  chmodSync,
  close,
  closeSync,
  copyFile,
  copyFileSync,
  cp,
  cpSync,
  createReadStream,
  createWriteStream,
  exists,
  existsSync,
  fchown,
  fchownSync,
  fchmod,
  fchmodSync,
  fdatasync,
  fdatasyncSync,
  fstat,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncate,
  ftruncateSync,
  futimes,
  futimesSync,
  glob,
  globSync,
  lchown,
  lchownSync,
  lchmod,
  lchmodSync,
  link,
  linkSync,
  lstat,
  lstatSync,
  lutimes,
  lutimesSync,
  mkdir,
  mkdirSync,
  mkdtemp,
  mkdtempSync,
  open,
  openSync,
  read,
  readFile,
  readFileSync,
  readSync,
  readdir,
  readdirSync,
  readlink,
  readlinkSync,
  readv,
  readvSync,
  realpath: realpath as any,
  realpathSync,
  rename,
  renameSync,
  rm,
  rmSync,
  rmdir,
  rmdirSync,
  stat,
  statfs,
  statSync,
  statfsSync,
  symlink,
  symlinkSync,
  truncate,
  truncateSync,
  unlink,
  unlinkSync,
  unwatchFile,
  utimes,
  utimesSync,
  watch,
  watchFile,
  write,
  writeFile,
  writeFileSync,
  writeSync,
  writev,
  writevSync,
  _toUnixTimestamp,
  openAsBlob,
  Dirent,
  opendir,
  opendirSync,
  F_OK: constants.F_OK,
  R_OK: constants.R_OK,
  W_OK: constants.W_OK,
  X_OK: constants.X_OK,
  constants,
  Stats,
  StatsFs,
  get ReadStream(): typeof import("fs").ReadStream {
    return (exports.ReadStream = require("internal/fs/streams")
      .ReadStream as unknown as typeof import("fs").ReadStream);
  },
  set ReadStream(value: typeof import("fs").ReadStream) {
    $Object.defineProperty(exports, "ReadStream", {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  },
  get WriteStream(): typeof import("fs").WriteStream {
    return (exports.WriteStream = require("internal/fs/streams")
      .WriteStream as unknown as typeof import("fs").WriteStream);
  },
  set WriteStream(value: typeof import("fs").WriteStream) {
    $Object.defineProperty(exports, "WriteStream", {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  },
  get FileReadStream(): typeof import("fs").ReadStream {
    return (exports.FileReadStream = require("internal/fs/streams")
      .ReadStream as unknown as typeof import("fs").ReadStream);
  },
  set FileReadStream(value: typeof import("fs").ReadStream) {
    $Object.defineProperty(exports, "FileReadStream", {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  },
  get FileWriteStream(): typeof import("fs").WriteStream {
    return (exports.FileWriteStream = require("internal/fs/streams")
      .WriteStream as unknown as typeof import("fs").WriteStream);
  },
  set FileWriteStream(value: typeof import("fs").WriteStream) {
    $Object.defineProperty(exports, "FileWriteStream", {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  },
  promises: promises as unknown as typeof import("node:fs/promises"),
};
export default exports as unknown as typeof import("node:fs");

function setName(fn: Function | undefined, value: string) {
  if (fn) {
    $Object.defineProperty(fn, "name", { value, enumerable: false, configurable: true });
  }
}
setName(Dirent, "Dirent");
setName(FSWatcher, "FSWatcher");
setName(Stats, "Stats");
setName(StatsFs, "StatsFs");
setName(_toUnixTimestamp, "_toUnixTimestamp");
setName(access, "access");
setName(accessSync, "accessSync");
setName(appendFile, "appendFile");
setName(appendFileSync, "appendFileSync");
setName(chmod, "chmod");
setName(chmodSync, "chmodSync");
setName(chown, "chown");
setName(chownSync, "chownSync");
setName(close, "close");
setName(closeSync, "closeSync");
setName(copyFile, "copyFile");
setName(copyFileSync, "copyFileSync");
setName(cp, "cp");
setName(cpSync, "cpSync");
setName(createReadStream, "createReadStream");
setName(createWriteStream, "createWriteStream");
setName(exists, "exists");
setName(existsSync, "existsSync");
setName(fchmod, "fchmod");
setName(fchmodSync, "fchmodSync");
setName(fchown, "fchown");
setName(fchownSync, "fchownSync");
setName(fstat, "fstat");
setName(fstatSync, "fstatSync");
setName(fsync, "fsync");
setName(fsyncSync, "fsyncSync");
setName(ftruncate, "ftruncate");
setName(ftruncateSync, "ftruncateSync");
setName(futimes, "futimes");
setName(futimesSync, "futimesSync");
if (lchmod) setName(lchmod, "lchmod");
if (lchmodSync) setName(lchmodSync, "lchmodSync");
setName(lchown, "lchown");
setName(lchownSync, "lchownSync");
setName(link, "link");
setName(linkSync, "linkSync");
setName(lstat, "lstat");
setName(lstatSync, "lstatSync");
setName(lutimes, "lutimes");
setName(lutimesSync, "lutimesSync");
setName(mkdir, "mkdir");
setName(mkdirSync, "mkdirSync");
setName(mkdtemp, "mkdtemp");
setName(mkdtempSync, "mkdtempSync");
setName(open, "open");
setName(openSync, "openSync");
setName(read, "read");
setName(readFile, "readFile");
setName(readFileSync, "readFileSync");
setName(readSync, "readSync");
setName(readdir, "readdir");
setName(readdirSync, "readdirSync");
setName(readlink, "readlink");
setName(readlinkSync, "readlinkSync");
setName(readv, "readv");
setName(readvSync, "readvSync");
setName(realpath, "realpath");
setName(realpathSync, "realpathSync");
setName(rename, "rename");
setName(renameSync, "renameSync");
setName(rm, "rm");
setName(rmSync, "rmSync");
setName(rmdir, "rmdir");
setName(rmdirSync, "rmdirSync");
setName(stat, "stat");
setName(statfs, "statfs");
setName(statSync, "statSync");
setName(statfsSync, "statfsSync");
setName(symlink, "symlink");
setName(symlinkSync, "symlinkSync");
setName(truncate, "truncate");
setName(truncateSync, "truncateSync");
setName(unlink, "unlink");
setName(unlinkSync, "unlinkSync");
setName(unwatchFile, "unwatchFile");
setName(utimes, "utimes");
setName(utimesSync, "utimesSync");
setName(watch, "watch");
setName(watchFile, "watchFile");
setName(write, "write");
setName(writeFile, "writeFile");
setName(writeFileSync, "writeFileSync");
setName(writeSync, "writeSync");
setName(writev, "writev");
setName(writevSync, "writevSync");
setName(fdatasync, "fdatasync");
setName(fdatasyncSync, "fdatasyncSync");
setName(openAsBlob, "openAsBlob");
setName(opendir, "opendir");
setName(LocalDir, "Dir");
setName(glob, "glob");
setName(globSync, "globSync");