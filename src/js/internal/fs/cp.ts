// Taken and modified from node.js: https://github.com/nodejs/node/blob/main/lib/internal/fs/cp/cp.js
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
} = require("internal/fs/cp-sync");

const {
  chmod,
  copyFile,
  lstat,
  mkdir,
  opendir,
  readdir,
  readlink,
  stat,
  symlink,
  unlink,
  utimes,
} = require("node:fs/promises");
const { dirname, isAbsolute, join, parse, resolve } = require("node:path");

const PromisePrototypeThen = $Promise.prototype.$then;
const PromiseReject = Promise.$reject;

async function checkPaths(src, dest, opts) {
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

  if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
    throw fsCpEinvalError({
      message: `cannot copy ${src} to a subdirectory of self ${dest}`,
      path: dest,
      syscall: "cp",
      errno: EINVAL,
      code: "EINVAL",
    });
  }
  return { __proto__: null, srcStat, destStat, skipped: false };
}

function getStats(src, dest, opts) {
  const statFunc = opts.dereference ? file => stat(file, { bigint: true }) : file => lstat(file, { bigint: true });
  return Promise.all([
    statFunc(src),
    PromisePrototypeThen.$call(statFunc(dest), undefined, err => {
      if (err.code === "ENOENT") return null;
      throw err;
    }),
  ]);
}

// Recursively check if dest parent is a subdirectory of src.
// It works for all file types including symlinks since it
// checks the src and dest inodes. It starts from the deepest
// parent and stops once it reaches the src parent or the root path.
async function checkParentPaths(src, srcStat, dest) {
  const srcParent = resolve(dirname(src));
  const destParent = resolve(dirname(dest));
  if (destParent === srcParent || destParent === parse(destParent).root) {
    return;
  }
  let destStat;
  try {
    destStat = await stat(destParent, { bigint: true });
  } catch (err: any) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  if (areIdentical(srcStat, destStat)) {
    throw fsCpEinvalError({
      message: `cannot copy ${src} to a subdirectory of self ${dest}`,
      path: dest,
      syscall: "cp",
      errno: EINVAL,
      code: "EINVAL",
    });
  }
  return checkParentPaths(src, srcStat, destParent);
}

// The native recursive copy (a single clonefile() on macOS) copies symlinks
// verbatim and clones special files, while node rewrites relative symlink
// targets against the source tree and raises ERR_FS_CP_SOCKET /
// ERR_FS_CP_FIFO_PIPE. It is therefore only node-equivalent for trees made of
// regular files and directories; anything else — including entries whose type
// the filesystem does not report — bails to the ported walker. Scan errors
// also bail so the walker surfaces them the way node would.
async function treeContainsOnlyFilesAndDirs(root) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
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
async function tryNativeFastPath(src, dest, opts) {
  const checked = await checkPaths(src, dest, opts);
  const { srcStat, destStat } = checked;
  await checkParentPaths(src, srcStat, dest);
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
      ok: process.platform === "darwin" && !destStat && (await treeContainsOnlyFilesAndDirs(src)),
      checked,
    };
  }
  // The single-file native copy is only node-equivalent for regular-file ->
  // regular-file (or missing dest). Symlinks (node resolves relative link
  // targets) and special files (node-specific error codes) must go through
  // the ported implementation.
  return { ok: srcStat.isFile() && (!destStat || destStat.isFile()), checked };
}

async function cpFn(src, dest, opts, checked?) {
  // `checked` carries the stats from a preceding tryNativeFastPath so the
  // fallback doesn't re-run the same checkPaths/checkParentPaths syscalls.
  const { srcStat, destStat, skipped } = checked ?? (await checkPaths(src, dest, opts));
  if (skipped) return;
  if (checked === undefined) await checkParentPaths(src, srcStat, dest);
  return checkParentDir(destStat, src, dest, opts);
}

async function checkParentDir(destStat, src, dest, opts) {
  const destParent = dirname(dest);
  const dirExists = await pathExists(destParent);
  if (dirExists) return getStatsForCopy(destStat, src, dest, opts);
  await mkdir(destParent, { recursive: true });
  return getStatsForCopy(destStat, src, dest, opts);
}

function pathExistsFulfilled() {
  return true;
}
function pathExistsRejected(err) {
  return err.code === "ENOENT" ? false : PromiseReject(err);
}
function pathExists(dest) {
  return PromisePrototypeThen.$call(stat(dest), pathExistsFulfilled, pathExistsRejected);
}

async function getStatsForCopy(destStat, src, dest, opts) {
  const statFn = opts.dereference ? stat : lstat;
  const srcStat = await statFn(src);
  if (srcStat.isDirectory() && opts.recursive) {
    return onDir(srcStat, destStat, src, dest, opts);
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
    return onLink(destStat, src, dest, opts);
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

function onFile(srcStat, destStat, src, dest, opts) {
  if (!destStat) return _copyFile(srcStat, src, dest, opts);
  return mayCopyFile(srcStat, src, dest, opts);
}

async function mayCopyFile(srcStat, src, dest, opts) {
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

async function _copyFile(srcStat, src, dest, opts) {
  await copyFile(src, dest, opts.mode);
  if (opts.preserveTimestamps) {
    return handleTimestampsAndMode(srcStat.mode, src, dest);
  }
  return setDestMode(dest, srcStat.mode);
}

async function handleTimestampsAndMode(srcMode, src, dest) {
  // Make sure the file is writable before setting the timestamp
  // otherwise open fails with EPERM when invoked with 'r+'
  // (through utimes call)
  if (fileIsNotWritable(srcMode)) {
    await makeFileWritable(dest, srcMode);
    return setDestTimestampsAndMode(srcMode, src, dest);
  }
  return setDestTimestampsAndMode(srcMode, src, dest);
}

function fileIsNotWritable(srcMode) {
  return (srcMode & 0o200) === 0;
}

function makeFileWritable(dest, srcMode) {
  return setDestMode(dest, srcMode | 0o200);
}

async function setDestTimestampsAndMode(srcMode, src, dest) {
  await setDestTimestamps(src, dest);
  return setDestMode(dest, srcMode);
}

function setDestMode(dest, srcMode) {
  return chmod(dest, srcMode);
}

async function setDestTimestamps(src, dest) {
  // The initial srcStat.atime cannot be trusted
  // because it is modified by the read(2) system call
  // (See https://nodejs.org/api/fs.html#fs_stat_time_values)
  const updatedSrcStat = await stat(src);
  return utimes(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
}

function onDir(srcStat, destStat, src, dest, opts) {
  if (!destStat) return mkDirAndCopy(srcStat.mode, src, dest, opts);
  if (opts.errorOnExist && !opts.force) {
    throw fsCpEExistError({
      message: `${dest} already exists`,
      path: dest,
      syscall: "cp",
      errno: EEXIST,
      code: "EEXIST",
    });
  }
  return copyDir(src, dest, opts);
}

async function mkDirAndCopy(srcMode, src, dest, opts) {
  await mkdir(dest);
  await copyDir(src, dest, opts);
  return setDestMode(dest, srcMode);
}

async function copyDir(src, dest, opts) {
  const dir = await opendir(src);

  for await (const { name } of dir) {
    const srcItem = join(src, name);
    const destItem = join(dest, name);
    const { destStat, skipped } = await checkPaths(srcItem, destItem, opts);
    if (!skipped) await getStatsForCopy(destStat, srcItem, destItem, opts);
  }
}

async function onLink(destStat, src, dest, opts) {
  let resolvedSrc = await readlink(src);
  if (!opts.verbatimSymlinks && !isAbsolute(resolvedSrc)) {
    resolvedSrc = resolve(dirname(src), resolvedSrc);
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
    resolvedDest = resolve(dirname(dest), resolvedDest);
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

async function copyLink(resolvedSrc, dest) {
  await unlink(dest);
  return symlink(resolvedSrc, dest);
}

export default { cpFn, tryNativeFastPath };
