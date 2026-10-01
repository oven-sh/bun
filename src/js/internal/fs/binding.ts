// The native `node:fs` binding (`createBinding`), created once here
// and shared by `node:fs`, `node:fs/promises`, and the lazily loaded `internal/fs/*` modules.
type NodeFS = typeof import("node:fs");
type NodeFSPromises = typeof import("node:fs/promises");

type SyncMethod =
  | "accessSync"
  | "appendFileSync"
  | "chmodSync"
  | "chownSync"
  | "closeSync"
  | "copyFileSync"
  | "existsSync"
  | "fchmodSync"
  | "fchownSync"
  | "fdatasyncSync"
  | "fstatSync"
  | "fsyncSync"
  | "ftruncateSync"
  | "futimesSync"
  | "lchmodSync"
  | "lchownSync"
  | "linkSync"
  | "lstatSync"
  | "lutimesSync"
  | "mkdirSync"
  | "mkdtempSync"
  | "openSync"
  | "readdirSync"
  | "readFileSync"
  | "readlinkSync"
  | "readSync"
  | "readvSync"
  | "realpathSync"
  | "renameSync"
  | "rmSync"
  | "statfsSync"
  | "statSync"
  | "symlinkSync"
  | "truncateSync"
  | "unlinkSync"
  | "utimesSync"
  | "writeFileSync"
  | "writeSync"
  | "writevSync";

type PathPromiseMethod =
  | "access"
  | "appendFile"
  | "chmod"
  | "chown"
  | "copyFile"
  | "lchmod"
  | "lchown"
  | "link"
  | "lstat"
  | "lutimes"
  | "mkdir"
  | "mkdtemp"
  | "readdir"
  | "readFile"
  | "readlink"
  | "realpath"
  | "rename"
  | "rm"
  | "stat"
  | "statfs"
  | "symlink"
  | "truncate"
  | "unlink"
  | "utimes"
  | "writeFile";

type FdPromiseMethod =
  | "close"
  | "exists"
  | "fchmod"
  | "fchown"
  | "fdatasync"
  | "fstat"
  | "fsync"
  | "ftruncate"
  | "futimes"
  | "open";

type Promisified = { [K in FdPromiseMethod]: NodeFS[K]["__promisify__"] };

type WatchListener = (eventType: string, filename: string | Buffer | undefined) => void;
type WatchFileListener = (curr: import("node:fs").Stats, prev: import("node:fs").Stats) => void;

interface FsBinding
  extends Pick<NodeFS, SyncMethod | "Dirent" | "Stats">,
    Pick<NodeFSPromises, PathPromiseMethod>,
    Promisified {
  cp(src: string, dest: string, recursive: boolean, errorOnExist: boolean, force: boolean, mode: number): Promise<void>;
  cpSync(src: string, dest: string, recursive: boolean, errorOnExist: boolean, force: boolean, mode: number): void;
  read(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offset?: number,
    length?: number,
    position?: number | bigint | null,
  ): Promise<number>;
  readv(fd: number, buffers: readonly NodeJS.ArrayBufferView[], position?: number | null): Promise<number>;
  realpathNative: NodeFSPromises["realpath"];
  realpathNativeSync: NodeFS["realpathSync"]["native"];
  rmdir(path: import("node:fs").PathLike, options?: import("node:fs").RmOptions): Promise<void>;
  rmdirSync(path: import("node:fs").PathLike, options?: import("node:fs").RmOptions): void;
  watch(path: string, options: import("node:fs").WatchOptions, listener: WatchListener): $ZigGeneratedClasses.FSWatcher;
  watchFile(
    path: string,
    options: import("node:fs").WatchFileOptions | undefined,
    listener: WatchFileListener,
  ): $ZigGeneratedClasses.StatWatcher;
  write(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offset?: number,
    length?: number,
    position?: number | null,
  ): Promise<number>;
  write(fd: number, string: string, position?: number | null, encoding?: BufferEncoding): Promise<number>;
  writev(fd: number, buffers: readonly NodeJS.ArrayBufferView[], position?: number | null): Promise<number>;
}

// `xCb(callback, ...args)`: the promise arm's arguments after the callback. `fs.cp` is a JS chain, so no `cpCb`.
type FsCallbackArm<T> = {
  [K in Exclude<keyof T & string, "cp"> as T[K] extends (...args: any[]) => Promise<any> ? `${K}Cb` : never]: (
    callback: (err: any, value?: any) => void,
    ...args: any[]
  ) => void;
};

export default $rust("node_fs_binding.rs", "createBinding") as FsBinding & FsCallbackArm<FsBinding>;
