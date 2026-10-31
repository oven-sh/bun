// Taken and modified from node.js: https://github.com/nodejs/node/blob/main/lib/internal/fs/cp/cp-sync.js
// Also hosts the option validation and SystemError construction shared with
// internal/fs/cp (async) and the fs.cpSync/fs.cp/fs.promises.cp dispatchers,
// ported from node lib/internal/fs/utils.js and lib/internal/errors.js.
const { validateObject, validateBoolean, validateFunction, validateInteger } = require("internal/validators");
const {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
} = require("node:fs");
const { basename, dirname, isAbsolute, join, parse, resolve, sep } = require("node:path");

const { EEXIST, EISDIR, EINVAL, ENOTDIR } = $processBindingConstants.os.errno;

const ArrayPrototypeEvery = Array.prototype.every;
const ArrayPrototypeFilter = Array.prototype.filter;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSplit: (this: string, separator: string, limit?: number) => string[] = String.prototype.split;

// COPYFILE_EXCL | COPYFILE_FICLONE | COPYFILE_FICLONE_FORCE
const kMaxCopyMode = 7;

const defaultCpOptions = {
  dereference: false,
  errorOnExist: false,
  filter: undefined,
  force: true,
  preserveTimestamps: false,
  recursive: false,
  verbatimSymlinks: false,
  mode: 0,
};

interface SystemErrorContext {
  message: string;
  path?: string;
  dest?: string;
  syscall: string;
  errno: number;
  code: string;
}

interface SystemError extends Error {
  info?: SystemErrorContext;
  errno?: number;
  syscall?: string;
  path?: string;
  dest?: string;
}

function decorateSystemError(err: SystemError, prefix: string, context: SystemErrorContext) {
  const { syscall, code, message: ctxMessage, path, dest, errno } = context;
  let message = `${prefix}: ${syscall} returned ${code} (${ctxMessage})`;
  if (path !== undefined) message += ` ${path}`;
  if (dest !== undefined) message += ` => ${dest}`;
  err.message = message;
  err.name = "SystemError";
  err.info = context;
  err.errno = errno;
  err.syscall = syscall;
  if (path !== undefined) err.path = path;
  if (dest !== undefined) err.dest = dest;
  return err;
}

function fsCpDirToNonDirError(context: SystemErrorContext) {
  return decorateSystemError(
    $ERR_FS_CP_DIR_TO_NON_DIR(context.message),
    "Cannot overwrite non-directory with directory",
    context,
  );
}

function fsCpEExistError(context: SystemErrorContext) {
  return decorateSystemError($ERR_FS_CP_EEXIST(context.message), "Target already exists", context);
}

function fsCpEinvalError(context: SystemErrorContext) {
  return decorateSystemError($ERR_FS_CP_EINVAL(context.message), "Invalid src or dest", context);
}

function fsCpSubdirOfSelfError(src: string, dest: string) {
  return fsCpEinvalError({
    message: `cannot copy ${src} to a subdirectory of self ${dest}`,
    path: dest,
    syscall: "cp",
    errno: EINVAL,
    code: "EINVAL",
  });
}

function fsCpFifoPipeError(context: SystemErrorContext) {
  return decorateSystemError($ERR_FS_CP_FIFO_PIPE(context.message), "Cannot copy a FIFO pipe", context);
}

function fsCpNonDirToDirError(context: SystemErrorContext) {
  return decorateSystemError(
    $ERR_FS_CP_NON_DIR_TO_DIR(context.message),
    "Cannot overwrite directory with non-directory",
    context,
  );
}

function fsCpSocketError(context: SystemErrorContext) {
  return decorateSystemError($ERR_FS_CP_SOCKET(context.message), "Cannot copy a socket file", context);
}

function fsCpSymlinkToSubdirectoryError(context: SystemErrorContext) {
  return decorateSystemError(
    $ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY(context.message),
    "Cannot overwrite symlink in subdirectory of self",
    context,
  );
}

function fsCpUnknownError(context: SystemErrorContext) {
  return decorateSystemError($ERR_FS_CP_UNKNOWN(context.message), "Cannot copy an unknown file type", context);
}

function fsEisdirError(context: SystemErrorContext) {
  return decorateSystemError($ERR_FS_EISDIR(context.message), "Path is a directory", context);
}

function getValidMode(mode: number | null | undefined) {
  if (mode == null) {
    return 0;
  }
  validateInteger(mode, "mode", 0, kMaxCopyMode);
  return mode;
}

const kValidatedCpOptions = Symbol("kValidatedCpOptions");

function validateCpOptions(options: Partial<CpOptions> | undefined): CpOptions;
function validateCpOptions(options) {
  // Callback fs.cp validates before delegating to fs.promises.cp; the brand
  // lets the second pass skip re-validating the same object.
  if (options?.[kValidatedCpOptions]) return options;
  if (options === undefined) {
    options = { ...defaultCpOptions };
    options[kValidatedCpOptions] = true;
    return options;
  }
  validateObject(options, "options");
  options = { ...defaultCpOptions, ...options };
  validateBoolean(options.dereference, "options.dereference");
  validateBoolean(options.errorOnExist, "options.errorOnExist");
  validateBoolean(options.force, "options.force");
  validateBoolean(options.preserveTimestamps, "options.preserveTimestamps");
  validateBoolean(options.recursive, "options.recursive");
  validateBoolean(options.verbatimSymlinks, "options.verbatimSymlinks");
  options.mode = getValidMode(options.mode);
  if (options.dereference === true && options.verbatimSymlinks === true) {
    throw $ERR_INCOMPATIBLE_OPTION_PAIR(
      'Option "dereference" cannot be used in combination with option "verbatimSymlinks"',
    );
  }
  const { filter } = options;
  if (filter !== undefined) {
    validateFunction(filter, "options.filter");
  }
  options[kValidatedCpOptions] = true;
  return options;
}

function areIdentical(srcStat: AnyStats, destStat: AnyStats) {
  return destStat.ino && destStat.dev && destStat.ino === srcStat.ino && destStat.dev === srcStat.dev;
}

const normalizePathToArray = (path: string) =>
  ArrayPrototypeFilter.$call(StringPrototypeSplit.$call(resolve(path), sep), Boolean);

// Return true if dest is a subdir of src, otherwise false.
// It only checks the path strings.
function isSrcSubdir(src: string, dest: string) {
  const srcArr = normalizePathToArray(src);
  const destArr = normalizePathToArray(dest);
  return ArrayPrototypeEvery.$call(srcArr, (cur, i) => destArr[i] === cur);
}

type Stats = $Node.Stats;
type BigIntStats = $Node.BigIntStats;
type AnyStats = Stats | BigIntStats;

// A dest directory on the current recursion path. `stat` is null for one this copy made, until it is needed.
export interface CpFrame {
  stat: BigIntStats | null;
  path: string;
  up: CpFrame | null;
}

// A root that keeps its path as given (see internal/fs/cp-symlink-dotdot). `real` is its real path, read on first use.
export interface KeptRoot {
  path: string;
  real: string | undefined;
}

// One per recursive directory copy.
export interface CpWalk {
  parent: BigIntStats | undefined; // the directory a new root was made in
  root: CpFrame | null; // that root's frame, while its stat is unread
  rootInSrc: boolean; // src is that directory, so the walk starts inside it
  entered: boolean; // a filter let the walk into its own output, and the walk is still in it
  src: KeptRoot | undefined;
  dest: KeptRoot | undefined;
}

function newCpWalk(src?: KeptRoot, dest?: KeptRoot): CpWalk {
  return { parent: undefined, root: null, rootInSrc: false, entered: false, src, dest };
}

function isOwnOutput(frame: CpFrame | null, srcStat: BigIntStats) {
  for (let f = frame; f !== null; f = f.up) {
    const stat = f.stat;
    if (stat !== null && areIdentical(srcStat, stat)) return true;
  }
  return false;
}

function followedLink(dirent: Pick<$Node.Dirent, "isDirectory">, opts: CpOptions) {
  return opts.dereference && !dirent.isDirectory();
}

function unreadRootIn(walk: CpWalk, srcStat: BigIntStats) {
  const root = walk.root;
  return root !== null && root.stat === null && areIdentical(srcStat, walk.parent!) ? root : null;
}

// Only a filter can end a walk of the copy's own output, so only then is an entry let in, and not from inside it.
function enterOnce(walk: CpWalk, opts: CpOptions) {
  if (!opts.filter || walk.entered) return false;
  walk.entered = true;
  return true;
}

// Loaded for the first root with `..` in it.
let symlinkDotDot: $ModuleValue<typeof import("./cp-symlink-dotdot")> | undefined;

// path.join() and the system can differ only for a root with `..`. Not on Windows: it cancels `name\..` as text too.
function mayKeepPath(path: string) {
  return process.platform !== "win32" && StringPrototypeIndexOf.$call(path, "..") !== -1;
}

// The path of an entry of `dir`, below a root that keeps its path: path.join() would cancel the `..` of the root.
function keptChildPath(dir: string, name: string) {
  return dir[dir.length - 1] === "/" ? dir + name : dir + "/" + name;
}

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
  destStat: BigIntStats | null | undefined;
  skipped: false;
  // For the two roots. Not there for the entries below them.
  keepSrc?: boolean;
  keepDest?: boolean;
}

interface SkippedPaths {
  __proto__: null;
  srcStat?: undefined;
  destStat?: undefined;
  skipped: true;
}

function checkPathsSync(src: string, dest: string, opts: CpOptions & { filter: undefined }): CheckedPaths;
function checkPathsSync(
  src: string,
  dest: string,
  opts: CpOptions,
  walk?: CpWalk,
  frame?: CpFrame,
  dirent?: Pick<$Node.Dirent, "isDirectory">,
): CheckedPaths | SkippedPaths;
function checkPathsSync(
  src: string,
  dest: string,
  opts: CpOptions,
  walk?: CpWalk,
  frame?: CpFrame,
  dirent?: Pick<$Node.Dirent, "isDirectory">,
): CheckedPaths | SkippedPaths {
  if (opts.filter) {
    const shouldCopy = opts.filter(src, dest);
    if ($isPromise(shouldCopy)) {
      throw $ERR_INVALID_RETURN_VALUE("boolean", "filter", shouldCopy);
    }
    if (!shouldCopy) return { __proto__: null, skipped: true };
  }
  const { srcStat, destStat } = getStatsSync(src, dest, opts);

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
        for (let f: CpFrame | null = frame; f !== null; f = f.up) f.stat ??= lstatSync(f.path, { bigint: true });
      } else {
        const root = unreadRootIn(walk, srcStat);
        if (root !== null) root.stat = lstatSync(root.path, { bigint: true });
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
        keepSrc: mayKeepPath(src) && (symlinkDotDot ??= require("internal/fs/cp-symlink-dotdot")).keepsPathSync(src),
        keepDest: mayKeepPath(dest) && (symlinkDotDot ??= require("internal/fs/cp-symlink-dotdot")).keepsPathSync(dest),
      };
    }
  } else if (walk === undefined) {
    return { __proto__: null, srcStat, destStat, skipped: false, keepSrc: false, keepDest: false };
  }
  return { __proto__: null, srcStat, destStat, skipped: false };
}

function getStatsSync(src: string, dest: string, opts: CpOptions) {
  let destStat: BigIntStats;
  const statFunc = opts.dereference
    ? (file: string) => statSync(file, { bigint: true })
    : (file: string) => lstatSync(file, { bigint: true });
  const srcStat = statFunc(src);
  try {
    destStat = statFunc(dest);
  } catch (err: any) {
    if (err.code === "ENOENT") return { srcStat, destStat: null };
    throw err;
  }
  return { srcStat, destStat };
}

function checkParentPathsSync(src: string, srcStat: BigIntStats, dest: string, keepDest?: boolean) {
  const srcParent = resolve(dirname(src));
  const destParent = resolve(dirname(dest));
  if (destParent === srcParent || destParent === parse(destParent).root) return;
  let destStat: BigIntStats;
  try {
    destStat = statSync(destParent, { bigint: true });
  } catch (err: any) {
    // A destination that keeps its path is not below its text. A file in that text is not in its way.
    if (err.code === "ENOENT" || (keepDest && err.code === "ENOTDIR")) return;
    throw err;
  }
  if (areIdentical(srcStat, destStat)) throw fsCpSubdirOfSelfError(src, dest);
  return checkParentPathsSync(src, srcStat, destParent, keepDest);
}

function resolveExistingRealpathSync(p: string) {
  let missing = "";
  for (;;) {
    try {
      return join(realpathSync(p), missing);
    } catch (err: any) {
      const parent = dirname(p);
      if (err?.code !== "ENOENT" || parent === p) return undefined;
      missing = join(basename(p), missing);
      p = parent;
    }
  }
}

// The native walker has no own-output check, so only a dest that provably resolves outside src may reach it.
function nativeDirCopyIsSafeSync(src: string, dest: string) {
  let realSrc: string;
  try {
    // realpathSync() cancels `..` as text. No root that keeps its path comes here.
    realSrc = realpathSync(src);
  } catch {
    return false;
  }
  const realDestParent = resolveExistingRealpathSync(dirname(dest));
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
function treeContainsOnlyFilesAndDirsSync(root: string) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: $Node.Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
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
function tryNativeFastPathSync(src: string, dest: string, opts: CpOptions & { filter: undefined }) {
  const checked = checkPathsSync(src, dest, opts);
  const { srcStat, destStat, keepSrc, keepDest } = checked;
  checkParentPathsSync(src, srcStat, dest, keepDest);
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
        treeContainsOnlyFilesAndDirsSync(src) &&
        nativeDirCopyIsSafeSync(src, dest),
      checked,
    };
  }
  // The single-file native copy is only node-equivalent for regular-file ->
  // regular-file (or missing dest). Symlinks (node resolves relative link
  // targets) and special files (node-specific error codes) must go through
  // the ported implementation.
  return { ok: srcStat.isFile() && (!destStat || destStat.isFile()), checked };
}

function cpSyncFn(src: string, dest: string, opts: CpOptions, checked?: CheckedPaths) {
  // `checked` carries the stats from a preceding tryNativeFastPathSync so the
  // fallback doesn't re-run the same checkPaths/checkParentPaths syscalls.
  const roots = checked ?? checkPathsSync(src, dest, opts);
  if (roots.skipped) return;
  const { srcStat, destStat, keepSrc, keepDest } = roots;
  if (checked === undefined) checkParentPathsSync(src, srcStat, dest, keepDest);
  const walk =
    opts.recursive && srcStat.isDirectory()
      ? newCpWalk(
          keepSrc ? { path: src, real: undefined } : undefined,
          keepDest ? { path: dest, real: undefined } : undefined,
        )
      : undefined;
  return checkParentDir(destStat, src, dest, opts, walk, srcStat);
}

function checkParentDir(
  destStat: BigIntStats | null | undefined,
  src: string,
  dest: string,
  opts: CpOptions,
  walk?: CpWalk,
  srcStat?: BigIntStats,
) {
  const destParent = dirname(dest);
  if (walk === undefined) {
    if (!existsSync(destParent)) mkdirSync(destParent, { recursive: true });
    return getStats(destStat, src, dest, opts);
  }
  // dirname("sub/..") is "sub", not the directory that holds it. The frame of a root that exists has its stat already.
  const last = basename(dest);
  if (destStat && (last === ".." || last === ".")) return getStats(destStat, src, dest, opts, walk, null);
  let parent = statSync(destParent, { bigint: true, throwIfNoEntry: false }) as BigIntStats | undefined;
  if (parent === undefined) {
    // `new/../link` resolves, to what can be src, only once `new` exists.
    mkdirSync(destParent, { recursive: true });
    parent = statSync(destParent, { bigint: true });
  }
  if (areIdentical(srcStat!, parent)) {
    // With no filter the walk is certain to reach the root, unless the copy stops first on the existing dest.
    if (!opts.filter && !(destStat && opts.errorOnExist && !opts.force)) throw fsCpSubdirOfSelfError(src, dest);
    walk.rootInSrc = true;
  }
  if (!destStat) walk.parent = parent;
  return getStats(destStat, src, dest, opts, walk, null);
}

function getStats(
  destStat: BigIntStats | null | undefined,
  src: string,
  dest: string,
  opts: CpOptions,
  walk?: CpWalk,
  frame?: CpFrame | null,
) {
  const statSyncFn = opts.dereference ? statSync : lstatSync;
  const srcStat = statSyncFn(src);

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

function onFile(srcStat: Stats, destStat: BigIntStats | null | undefined, src: string, dest: string, opts: CpOptions) {
  if (!destStat) return copyFile(srcStat, src, dest, opts);
  return mayCopyFile(srcStat, src, dest, opts);
}

function mayCopyFile(srcStat: Stats, src: string, dest: string, opts: CpOptions) {
  if (opts.force) {
    unlinkSync(dest);
    return copyFile(srcStat, src, dest, opts);
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

function copyFile(srcStat: Stats, src: string, dest: string, opts: CpOptions) {
  copyFileSync(src, dest, opts.mode);
  if (opts.preserveTimestamps) handleTimestamps(srcStat.mode, src, dest);
  return setDestMode(dest, srcStat.mode);
}

function handleTimestamps(srcMode: number, src: string, dest: string) {
  // Make sure the file is writable before setting the timestamp
  // otherwise open fails with EPERM when invoked with 'r+'
  // (through utimes call)
  if (fileIsNotWritable(srcMode)) makeFileWritable(dest, srcMode);
  return setDestTimestamps(src, dest);
}

function fileIsNotWritable(srcMode: number) {
  return (srcMode & 0o200) === 0;
}

function makeFileWritable(dest: string, srcMode: number) {
  return setDestMode(dest, srcMode | 0o200);
}

function setDestMode(dest: string, srcMode: number) {
  return chmodSync(dest, srcMode);
}

function setDestTimestamps(src: string, dest: string) {
  // The initial srcStat.atime cannot be trusted
  // because it is modified by the read(2) system call
  // (See https://nodejs.org/api/fs.html#fs_stat_time_values)
  const updatedSrcStat = statSync(src);
  return utimesSync(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
}

function onDir(
  srcStat: Stats,
  destStat: BigIntStats | null | undefined,
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

function mkDirAndCopy(
  srcMode: number,
  src: string,
  dest: string,
  opts: CpOptions,
  walk: CpWalk,
  frame: CpFrame | null,
) {
  mkdirSync(dest);
  if (frame === null) {
    frame = { stat: walk.rootInSrc ? lstatSync(dest, { bigint: true }) : null, path: dest, up: null };
    if (walk.parent !== undefined) walk.root = frame;
  } else if (walk.entered) {
    frame = { stat: lstatSync(dest, { bigint: true }), path: dest, up: frame };
  } else if (opts.dereference) {
    frame = { stat: null, path: dest, up: frame };
  }
  copyDir(src, dest, opts, walk, frame);
  return setDestMode(dest, srcMode);
}

function copyDir(src: string, dest: string, opts: CpOptions, walk: CpWalk, frame: CpFrame) {
  const keepSrc = walk.src !== undefined;
  const keepDest = walk.dest !== undefined;
  const mayEnter = opts.filter !== undefined && !walk.entered;
  for (const dirent of readdirSync(src, { withFileTypes: true })) {
    const { name } = dirent;
    const srcItem = keepSrc ? keptChildPath(src, name) : join(src, name);
    const destItem = keepDest ? keptChildPath(dest, name) : join(dest, name);
    const { destStat, skipped } = checkPathsSync(srcItem, destItem, opts, walk, frame, dirent);
    if (!skipped) getStats(destStat, srcItem, destItem, opts, walk, frame);
    // The walk is out of its output again once the entry that led into it is copied.
    if (mayEnter) walk.entered = false;
  }
}

function onLink(
  destStat: BigIntStats | null | undefined,
  src: string,
  dest: string,
  opts: CpOptions,
  walk: CpWalk | undefined,
) {
  let resolvedSrc = readlinkSync(src);
  if (!opts.verbatimSymlinks && !isAbsolute(resolvedSrc)) {
    const kept = walk?.src;
    resolvedSrc = resolve(kept === undefined ? dirname(src) : symlinkDotDot!.linkDirSync(src, kept), resolvedSrc);
  }
  if (!destStat) {
    return symlinkSync(resolvedSrc, dest);
  }
  let resolvedDest: string;
  try {
    resolvedDest = readlinkSync(dest);
  } catch (err: any) {
    // Dest exists and is a regular file or directory,
    // Windows may throw UNKNOWN error. If dest already exists,
    // fs throws error anyway, so no need to guard against it here.
    if (err.code === "EINVAL" || err.code === "UNKNOWN") {
      return symlinkSync(resolvedSrc, dest);
    }
    throw err;
  }
  if (!isAbsolute(resolvedDest)) {
    const kept = walk?.dest;
    resolvedDest = resolve(kept === undefined ? dirname(dest) : symlinkDotDot!.linkDirSync(dest, kept), resolvedDest);
  }
  let srcIsDir = false;
  try {
    srcIsDir = statSync(src).isDirectory();
  } catch {}
  if (srcIsDir && isSrcSubdir(resolvedSrc, resolvedDest)) {
    throw fsCpEinvalError({
      message: `cannot copy ${resolvedSrc} to a subdirectory of self ${resolvedDest}`,
      path: dest,
      syscall: "cp",
      errno: EINVAL,
      code: "EINVAL",
    });
  }
  // Prevent copy if src is a subdir of dest since unlinking
  // dest in this case would result in removing src contents
  // and therefore a broken symlink would be created.
  if (statSync(dest).isDirectory() && isSrcSubdir(resolvedDest, resolvedSrc)) {
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

function copyLink(resolvedSrc: string, dest: string) {
  unlinkSync(dest);
  return symlinkSync(resolvedSrc, dest);
}

export default {
  cpSyncFn,
  validateCpOptions,
  tryNativeFastPathSync,
  errno: { EEXIST, EISDIR, EINVAL, ENOTDIR },
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
};
