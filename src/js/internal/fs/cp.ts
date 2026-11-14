// Taken and modified from node.js: https://github.com/nodejs/node/blob/main/lib/internal/fs/cp/cp.js
import type { CpFrame, CpWalk } from "./cp-sync";

const {
  errno: { EEXIST, EINVAL, EISDIR, ENOTDIR },
  fsCpDirToNonDirError,
  fsCpEExistError,
  fsCpEinvalError,
  fsCpFifoPipeError,
  fsCpNonDirToDirError,
  fsCpSocketError,
  fsCpSymlinkToSubdirectoryError,
  fsCpUnknownError,
  fsEisdirError,
  areIdentical,
  isSrcSubdir,
  fsCpSubdirOfSelfError,
  newCpWalk,
  isOwnOutput,
  followedLink,
  unreadRootIn,
  enterOnce,
  mayKeepPath,
  keptChildPath,
} = require("internal/fs/cp-sync");

const {
  chmod,
  copyFile,
  lstat,
  mkdir,
  opendir,
  readdir,
  readlink,
  realpath,
  stat,
  symlink,
  unlink,
  utimes,
} = require("node:fs/promises");
const { basename, dirname, isAbsolute, join, normalize, parse, resolve } = require("node:path");

const PromisePrototypeThen = $Promise.prototype.$then;
const PromiseReject = Promise.$reject;

// See internal/fs/cp-sync.
let symlinkDotDot: $ModuleValue<typeof import("./cp-symlink-dotdot")> | undefined;

type Stats = $Node.Stats;
type BigIntStats = $Node.BigIntStats;
type DestinationStats = BigIntStats | null | undefined;

interface CpOptions {
  dereference: boolean;
  errorOnExist: boolean;
  filter: ((src: string, dest: string) => boolean | Promise<boolean>) | undefined;
  force: boolean;
  preserveTimestamps: boolean;
  recursive: boolean;
  verbatimSymlinks: boolean;
  mode: number;
}

interface CheckedPaths {
  __proto__: null;
  srcStat: BigIntStats;
  destStat: DestinationStats;
  skipped: false;
  keepSrc?: boolean;
  keepDest?: boolean;
}

interface SkippedPaths {
  __proto__: null;
  srcStat?: undefined;
  destStat?: undefined;
  skipped: true;
}

async function checkPaths(src: string, dest: string, opts: CpOptions & { filter: undefined }): Promise<CheckedPaths>;
async function checkPaths(
  src: string,
  dest: string,
  opts: CpOptions,
  walk?: CpWalk,
  frame?: CpFrame,
  dirent?: Pick<$Node.Dirent, "isDirectory">,
): Promise<CheckedPaths | SkippedPaths>;
async function checkPaths(
  src: string,
  dest: string,
  opts: CpOptions,
  walk?: CpWalk,
  frame?: CpFrame,
  dirent?: Pick<$Node.Dirent, "isDirectory">,
): Promise<CheckedPaths | SkippedPaths> {
  if (opts.filter && !(await opts.filter(src, dest))) {
    return { __proto__: null, skipped: true };
  }
  const { 0: srcStat, 1: destStat } = await getStats(src, dest, opts);
  if (destStat) {
    if (areIdentical(srcStat, destStat)) {
      throw fsCpEinvalError({
        message: "src and dest cannot be the same",
        path: dest,
        syscall: "cp",
        errno: EINVAL,
        code: "EINVAL",
      });
    }
    if (srcStat.isDirectory() && !destStat.isDirectory()) {
      throw fsCpDirToNonDirError({
        message: `cannot overwrite non-directory ${dest} with directory ${src}`,
        path: dest,
        syscall: "cp",
        errno: EISDIR,
        code: "EISDIR",
      });
    }
    if (!srcStat.isDirectory() && destStat.isDirectory()) {
      throw fsCpNonDirToDirError({
        message: `cannot overwrite directory ${dest} with non-directory ${src}`,
        path: dest,
        syscall: "cp",
        errno: ENOTDIR,
        code: "ENOTDIR",
      });
    }
  }

  if (srcStat.isDirectory()) {
    let own = isSrcSubdir(src, dest);
    if (!own && walk !== undefined && frame !== undefined) {
      if (followedLink(dirent!, opts)) {
        for (let f: CpFrame | null = frame; f !== null; f = f.up) f.stat ??= await lstat(f.path, { bigint: true });
      } else {
        const root = unreadRootIn(walk, srcStat);
        if (root !== null) root.stat = await lstat(root.path, { bigint: true });
      }
      own = isOwnOutput(frame, srcStat) && !enterOnce(walk, opts);
    }
    if (own) throw fsCpSubdirOfSelfError(src, dest);
    if (walk === undefined) {
      return {
        __proto__: null,
        srcStat,
        destStat,
        skipped: false,
        // No await for a root without `..`.
        keepSrc:
          mayKeepPath(src) && (await (symlinkDotDot ??= require("internal/fs/cp-symlink-dotdot")).keepsPath(src)),
        keepDest:
          mayKeepPath(dest) && (await (symlinkDotDot ??= require("internal/fs/cp-symlink-dotdot")).keepsPath(dest)),
      };
    }
  } else if (walk === undefined) {
    return { __proto__: null, srcStat, destStat, skipped: false, keepSrc: false, keepDest: false };
  }
  return { __proto__: null, srcStat, destStat, skipped: false };
}

function getStats(src: string, dest: string, opts: CpOptions) {
  const statFunc = opts.dereference
    ? (file: string) => stat(file, { bigint: true })
    : (file: string) => lstat(file, { bigint: true });
  return Promise.all([
    statFunc(src),
    PromisePrototypeThen.$call(statFunc(dest), undefined, err => {
      if (err.code === "ENOENT") return null;
      throw err;
    }) as Promise<BigIntStats | null>,
  ]);
}

// Recursively check if dest parent is a subdirectory of src.
// It works for all file types including symlinks since it
// checks the src and dest inodes. It starts from the deepest
// parent and stops once it reaches the src parent or the root path.
async function checkParentPaths(src: string, srcStat: BigIntStats, dest: string, keepDest?: boolean) {
  const srcParent = resolve(dirname(src));
  const destParent = resolve(dirname(dest));
  if (destParent === srcParent || destParent === parse(destParent).root) {
    return;
  }
  let destStat: BigIntStats;
  try {
    destStat = await stat(destParent, { bigint: true });
  } catch (err: any) {
    // See checkParentPathsSync().
    if (err.code === "ENOENT" || (keepDest && err.code === "ENOTDIR")) return;
    throw err;
  }
  if (areIdentical(srcStat, destStat)) throw fsCpSubdirOfSelfError(src, dest);
  return checkParentPaths(src, srcStat, destParent, keepDest);
}

async function resolveExistingRealpath(p: string) {
  let missing = "";
  for (;;) {
    try {
      return join(await realpath(p), missing);
    } catch (err: any) {
      const parent = dirname(p);
      if (err?.code !== "ENOENT" || parent === p) return undefined;
      missing = join(basename(p), missing);
      p = parent;
    }
  }
}

// The native walker has no own-output check, so only a dest that provably resolves outside src may reach it.
async function nativeDirCopyIsSafe(src: string, dest: string) {
  let realSrc: string;
  try {
    realSrc = await realpath(src);
  } catch {
    return false;
  }
  // The system resolves `new/..` only once the copy made `new`. The text is right: no kept root comes here.
  const realDestParent = await resolveExistingRealpath(normalize(dirname(dest)));
  if (realDestParent === undefined) return false;
  if (isSrcSubdir(realSrc, join(realDestParent, basename(dest)))) throw fsCpSubdirOfSelfError(src, dest);
  return true;
}

// The native recursive copy (a single clonefile() on macOS) copies symlinks
// verbatim and clones special files, while node rewrites relative symlink
// targets against the source tree and raises ERR_FS_CP_SOCKET /
// ERR_FS_CP_FIFO_PIPE. It is therefore only node-equivalent for trees made of
// regular files and directories; anything else — including entries whose type
// the filesystem does not report — bails to the ported walker. Scan errors
// also bail so the walker surfaces them the way node would.
async function treeContainsOnlyFilesAndDirs(root: string) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: $Node.Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.isDirectory()) {
        stack.push(join(dir, entry.name));
      } else if (!entry.isFile()) {
        return false;
      }
    }
  }
  return true;
}

// node-correct validation before handing off to the native fast path
// (which performs the copy but does not implement node's cp error codes).
async function tryNativeFastPath(src: string, dest: string, opts: CpOptions & { filter: undefined }) {
  const checked = await checkPaths(src, dest, opts);
  const { srcStat, destStat, keepSrc, keepDest } = checked;
  await checkParentPaths(src, srcStat, dest, keepDest);
  if (srcStat.isDirectory() && !opts.recursive) {
    throw fsEisdirError({
      message: `${src} is a directory (not copied)`,
      path: src,
      syscall: "cp",
      errno: EISDIR,
      code: "EISDIR",
    });
  }
  if (srcStat.isDirectory()) {
    // On macOS the native path clones the whole tree with a single
    // clonefile(). Only take it when the result is indistinguishable from
    // node's walker: dest must not exist (no merge semantics) and the tree
    // must contain only regular files and directories.
    return {
      ok:
        process.platform === "darwin" &&
        !destStat &&
        !keepSrc &&
        !keepDest &&
        (await treeContainsOnlyFilesAndDirs(src)) &&
        (await nativeDirCopyIsSafe(src, dest)),
      checked,
    };
  }
  // The single-file native copy is only node-equivalent for regular-file ->
  // regular-file (or missing dest). Symlinks (node resolves relative link
  // targets) and special files (node-specific error codes) must go through
  // the ported implementation.
  return { ok: srcStat.isFile() && (!destStat || destStat.isFile()), checked };
}

async function cpFn(src: string, dest: string, opts: CpOptions, checked?: CheckedPaths) {
  // `checked` carries the stats from a preceding tryNativeFastPath so the
  // fallback doesn't re-run the same checkPaths/checkParentPaths syscalls.
  const roots = checked ?? (await checkPaths(src, dest, opts));
  if (roots.skipped) return;
  const { srcStat, destStat, keepSrc, keepDest } = roots;
  if (checked === undefined) await checkParentPaths(src, srcStat, dest, keepDest);
  const walk =
    opts.recursive && srcStat.isDirectory()
      ? newCpWalk(
          keepSrc ? { path: src, real: undefined } : undefined,
          keepDest ? { path: dest, real: undefined } : undefined,
        )
      : undefined;
  return checkParentDir(destStat, src, dest, opts, walk, srcStat);
}

async function checkParentDir(
  destStat: DestinationStats,
  src: string,
  dest: string,
  opts: CpOptions,
  walk?: CpWalk,
  srcStat?: BigIntStats,
) {
  const destParent = dirname(dest);
  if (walk === undefined) {
    const dirExists = await pathExists(destParent);
    if (dirExists) return getStatsForCopy(destStat, src, dest, opts);
    await mkdir(destParent, { recursive: true });
    return getStatsForCopy(destStat, src, dest, opts);
  }
  // See checkParentDir() in internal/fs/cp-sync.
  const last = basename(dest);
  if (destStat && (last === ".." || last === ".")) return getStatsForCopy(destStat, src, dest, opts, walk, null);
  let parent = (await PromisePrototypeThen.$call(stat(destParent, { bigint: true }), undefined, parentStatRejected)) as
    BigIntStats | undefined;
  if (parent === undefined) {
    await mkdir(destParent, { recursive: true });
    parent = await stat(destParent, { bigint: true });
  }
  if (areIdentical(srcStat!, parent)) {
    // With no filter the walk is certain to reach the root, unless the copy stops first on the existing dest.
    if (!opts.filter && !(destStat && opts.errorOnExist && !opts.force)) throw fsCpSubdirOfSelfError(src, dest);
    walk.rootInSrc = true;
  }
  if (!destStat) walk.parent = parent;
  return getStatsForCopy(destStat, src, dest, opts, walk, null);
}

function parentStatRejected(err: NodeJS.ErrnoException) {
  if (err.code === "ENOENT") return undefined;
  throw err;
}

function pathExistsFulfilled() {
  return true;
}
function pathExistsRejected(err: Error) {
  return err.code === "ENOENT" ? false : PromiseReject(err);
}
function pathExists(dest: string) {
  return PromisePrototypeThen.$call(stat(dest), pathExistsFulfilled, pathExistsRejected);
}

async function getStatsForCopy(
  destStat: DestinationStats,
  src: string,
  dest: string,
  opts: CpOptions,
  walk?: CpWalk,
  frame?: CpFrame | null,
) {
  const statFn = opts.dereference ? stat : lstat;
  const srcStat = await statFn(src);
  if (srcStat.isDirectory() && opts.recursive) {
    return onDir(srcStat, destStat, src, dest, opts, walk ?? newCpWalk(), frame ?? null);
  } else if (srcStat.isDirectory()) {
    throw fsEisdirError({
      message: `${src} is a directory (not copied)`,
      path: src,
      syscall: "cp",
      errno: EISDIR,
      code: "EISDIR",
    });
  } else if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) {
    return onFile(srcStat, destStat, src, dest, opts);
  } else if (srcStat.isSymbolicLink()) {
    return onLink(destStat, src, dest, opts, walk);
  } else if (srcStat.isSocket()) {
    throw fsCpSocketError({
      message: `cannot copy a socket file: ${dest}`,
      path: dest,
      syscall: "cp",
      errno: EINVAL,
      code: "EINVAL",
    });
  } else if (srcStat.isFIFO()) {
    throw fsCpFifoPipeError({
      message: `cannot copy a FIFO pipe: ${dest}`,
      path: dest,
      syscall: "cp",
      errno: EINVAL,
      code: "EINVAL",
    });
  }
  throw fsCpUnknownError({
    message: `cannot copy an unknown file type: ${dest}`,
    path: dest,
    syscall: "cp",
    errno: EINVAL,
    code: "EINVAL",
  });
}

function onFile(srcStat: Stats, destStat: DestinationStats, src: string, dest: string, opts: CpOptions) {
  if (!destStat) return _copyFile(srcStat, src, dest, opts);
  return mayCopyFile(srcStat, src, dest, opts);
}

async function mayCopyFile(srcStat: Stats, src: string, dest: string, opts: CpOptions) {
  if (opts.force) {
    await unlink(dest);
    return _copyFile(srcStat, src, dest, opts);
  } else if (opts.errorOnExist) {
    throw fsCpEExistError({
      message: `${dest} already exists`,
      path: dest,
      syscall: "cp",
      errno: EEXIST,
      code: "EEXIST",
    });
  }
}

async function _copyFile(srcStat: Stats, src: string, dest: string, opts: CpOptions) {
  await copyFile(src, dest, opts.mode);
  if (opts.preserveTimestamps) {
    return handleTimestampsAndMode(srcStat.mode, src, dest);
  }
  return setDestMode(dest, srcStat.mode);
}

async function handleTimestampsAndMode(srcMode: number, src: string, dest: string) {
  // Make sure the file is writable before setting the timestamp
  // otherwise open fails with EPERM when invoked with 'r+'
  // (through utimes call)
  if (fileIsNotWritable(srcMode)) {
    await makeFileWritable(dest, srcMode);
    return setDestTimestampsAndMode(srcMode, src, dest);
  }
  return setDestTimestampsAndMode(srcMode, src, dest);
}

function fileIsNotWritable(srcMode: number) {
  return (srcMode & 0o200) === 0;
}

function makeFileWritable(dest: string, srcMode: number) {
  return setDestMode(dest, srcMode | 0o200);
}

async function setDestTimestampsAndMode(srcMode: number, src: string, dest: string) {
  await setDestTimestamps(src, dest);
  return setDestMode(dest, srcMode);
}

function setDestMode(dest: string, srcMode: number) {
  return chmod(dest, srcMode);
}

async function setDestTimestamps(src: string, dest: string) {
  // The initial srcStat.atime cannot be trusted
  // because it is modified by the read(2) system call
  // (See https://nodejs.org/api/fs.html#fs_stat_time_values)
  const updatedSrcStat = await stat(src);
  return utimes(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
}

function onDir(
  srcStat: Stats,
  destStat: DestinationStats,
  src: string,
  dest: string,
  opts: CpOptions,
  walk: CpWalk,
  frame: CpFrame | null,
) {
  if (!destStat) return mkDirAndCopy(srcStat.mode, src, dest, opts, walk, frame);
  if (opts.errorOnExist && !opts.force) {
    throw fsCpEExistError({
      message: `${dest} already exists`,
      path: dest,
      syscall: "cp",
      errno: EEXIST,
      code: "EEXIST",
    });
  }
  return copyDir(src, dest, opts, walk, { stat: destStat, path: dest, up: frame });
}

async function mkDirAndCopy(
  srcMode: number,
  src: string,
  dest: string,
  opts: CpOptions,
  walk: CpWalk,
  frame: CpFrame | null,
) {
  await mkdir(dest);
  if (frame === null) {
    frame = { stat: walk.rootInSrc ? await lstat(dest, { bigint: true }) : null, path: dest, up: null };
    if (walk.parent !== undefined) walk.root = frame;
  } else if (walk.entered) {
    frame = { stat: await lstat(dest, { bigint: true }), path: dest, up: frame };
  } else if (opts.dereference) {
    frame = { stat: null, path: dest, up: frame };
  }
  await copyDir(src, dest, opts, walk, frame);
  return setDestMode(dest, srcMode);
}

async function copyDir(src: string, dest: string, opts: CpOptions, walk: CpWalk, frame: CpFrame) {
  const dir = await opendir(src);
  const keepSrc = walk.src !== undefined;
  const keepDest = walk.dest !== undefined;
  const mayEnter = opts.filter !== undefined && !walk.entered;

  for await (const dirent of dir) {
    const { name } = dirent;
    const srcItem = keepSrc ? keptChildPath(src, name) : join(src, name);
    const destItem = keepDest ? keptChildPath(dest, name) : join(dest, name);
    const { destStat, skipped } = await checkPaths(srcItem, destItem, opts, walk, frame, dirent);
    if (!skipped) await getStatsForCopy(destStat, srcItem, destItem, opts, walk, frame);
    // See copyDir() in internal/fs/cp-sync.
    if (mayEnter) walk.entered = false;
  }
}

async function onLink(
  destStat: DestinationStats,
  src: string,
  dest: string,
  opts: CpOptions,
  walk: CpWalk | undefined,
) {
  let resolvedSrc = await readlink(src);
  if (!opts.verbatimSymlinks && !isAbsolute(resolvedSrc)) {
    const kept = walk?.src;
    resolvedSrc = resolve(kept === undefined ? dirname(src) : await symlinkDotDot!.linkDir(src, kept), resolvedSrc);
  }
  if (!destStat) {
    return symlink(resolvedSrc, dest);
  }
  let resolvedDest;
  try {
    resolvedDest = await readlink(dest);
  } catch (err: any) {
    // Dest exists and is a regular file or directory,
    // Windows may throw UNKNOWN error. If dest already exists,
    // fs throws error anyway, so no need to guard against it here.
    if (err.code === "EINVAL" || err.code === "UNKNOWN") {
      return symlink(resolvedSrc, dest);
    }
    throw err;
  }
  if (!isAbsolute(resolvedDest)) {
    const kept = walk?.dest;
    resolvedDest = resolve(kept === undefined ? dirname(dest) : await symlinkDotDot!.linkDir(dest, kept), resolvedDest);
  }
  // stat(src) follows the link; a dangling src symlink throws ENOENT here,
  // same as before (both gated checks below only apply to directories).
  const srcStat = await stat(src);
  const srcIsDir = srcStat.isDirectory();
  if (srcIsDir && isSrcSubdir(resolvedSrc, resolvedDest)) {
    throw fsCpEinvalError({
      message: `cannot copy ${resolvedSrc} to a subdirectory of self ${resolvedDest}`,
      path: dest,
      syscall: "cp",
      errno: EINVAL,
      code: "EINVAL",
    });
  }
  // Do not copy if src is a subdir of dest since unlinking
  // dest in this case would result in removing src contents
  // and therefore a broken symlink would be created.
  if (srcIsDir && isSrcSubdir(resolvedDest, resolvedSrc)) {
    throw fsCpSymlinkToSubdirectoryError({
      message: `cannot overwrite ${resolvedDest} with ${resolvedSrc}`,
      path: dest,
      syscall: "cp",
      errno: EINVAL,
      code: "EINVAL",
    });
  }
  return copyLink(resolvedSrc, dest);
}

async function copyLink(resolvedSrc: string, dest: string) {
  await unlink(dest);
  return symlink(resolvedSrc, dest);
}

export default { cpFn, tryNativeFastPath };
