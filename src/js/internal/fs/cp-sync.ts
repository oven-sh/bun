// Taken and modified from node.js: https://github.com/nodejs/node/blob/main/lib/internal/fs/cp/cp-sync.js

// const { EEXIST, EISDIR, EINVAL, ENOTDIR } = $processBindingConstants.os.errno;

const ArrayPrototypeEvery = Array.prototype.every;
const ArrayPrototypeFilter = Array.prototype.filter;
const StringPrototypeSplit = String.prototype.split;

function areIdentical(srcStat, destStat) {
  return destStat.ino && destStat.dev && destStat.ino === srcStat.ino && destStat.dev === srcStat.dev;
}

const normalizePathToArray = path =>
  ArrayPrototypeFilter.$call(StringPrototypeSplit.$call(resolve(path), sep), Boolean);

function isSrcSubdir(src, dest) {
  const srcArr = normalizePathToArray(src);
  const destArr = normalizePathToArray(dest);
  return ArrayPrototypeEvery.$call(srcArr, (cur, i) => destArr[i] === cur);
}

// const { codes } = require("internal/errors");
// const {
//   ERR_FS_CP_DIR_TO_NON_DIR,
//   ERR_FS_CP_EEXIST,
//   ERR_FS_CP_EINVAL,
//   ERR_FS_CP_FIFO_PIPE,
//   ERR_FS_CP_NON_DIR_TO_DIR,
//   ERR_FS_CP_SOCKET,
//   ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY,
//   ERR_FS_CP_UNKNOWN,
//   ERR_FS_EISDIR,
//   ERR_INVALID_RETURN_VALUE,
// } = codes;
const {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  // opendirSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
} = require("node:fs");
const { dirname, isAbsolute, join, parse, resolve, sep } = require("node:path");
const { isPromise } = require("node:util/types");

function cpSyncFn(src, dest, opts) {
  // Warn about using preserveTimestamps on 32-bit node
  // if (opts.preserveTimestamps && process.arch === "ia32") {
  //   const warning = "Using the preserveTimestamps option in 32-bit " + "node is not recommended";
  //   process.emitWarning(warning, "TimestampPrecisionWarning");
  // }
  const { srcStat, destStat, skipped } = checkPathsSync(src, dest, opts);
  if (skipped) return;
  checkParentPathsSync(src, srcStat, dest);
  return checkParentDir(destStat, src, dest, opts);
}

function checkPathsSync(src, dest, opts) {
  if (opts.filter) {
    const shouldCopy = opts.filter(src, dest);
    if (isPromise(shouldCopy)) {
      // throw new ERR_INVALID_RETURN_VALUE("boolean", "filter", shouldCopy);
      throw new Error("Expected a boolean from the filter function, but got a promise. Use `fs.promises.cp` instead.");
    }
    if (!shouldCopy) return { __proto__: null, skipped: true };
  }
  const { srcStat, destStat } = getStatsSync(src, dest, opts);

  if (destStat) {
    if (areIdentical(srcStat, destStat)) {
      // throw new ERR_FS_CP_EINVAL({
      //   message: "src and dest cannot be the same",
      //   path: dest,
      //   syscall: "cp",
      //   errno: EINVAL,
      //   code: "EINVAL",
      // });
      throw new Error("src and dest cannot be the same");
    }
    if (srcStat.isDirectory() && !destStat.isDirectory()) {
      // throw new ERR_FS_CP_DIR_TO_NON_DIR({
      //   message: `cannot overwrite directory ${src} ` + `with non-directory ${dest}`,
      //   path: dest,
      //   syscall: "cp",
      //   errno: EISDIR,
      //   code: "EISDIR",
      // });
      throw new Error(`cannot overwrite directory ${src} with non-directory ${dest}`);
    }
    if (!srcStat.isDirectory() && destStat.isDirectory()) {
      // throw new ERR_FS_CP_NON_DIR_TO_DIR({
      //   message: `cannot overwrite non-directory ${src} ` + `with directory ${dest}`,
      //   path: dest,
      //   syscall: "cp",
      //   errno: ENOTDIR,
      //   code: "ENOTDIR",
      // });
      throw new Error(`cannot overwrite non-directory ${src} with directory ${dest}`);
    }
  }

  if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
    // throw new ERR_FS_CP_EINVAL({
    //   message: `cannot copy ${src} to a subdirectory of self ${dest}`,
    //   path: dest,
    //   syscall: "cp",
    //   errno: EINVAL,
    //   code: "EINVAL",
    // });
    throw new Error(`cannot copy ${src} to a subdirectory of self ${dest}`);
  }
  return { __proto__: null, srcStat, destStat, skipped: false };
}

function getStatsSync(src, dest, opts) {
  let destStat;
  const statFunc = opts.dereference
    ? file => statSync(file, { bigint: true })
    : file => lstatSync(file, { bigint: true });
  const srcStat = statFunc(src);
  try {
    destStat = statFunc(dest);
  } catch (err: any) {
    if (err.code === "ENOENT") return { srcStat, destStat: null };
    throw err;
  }
  return { srcStat, destStat };
}

function checkParentPathsSync(src, srcStat, dest) {
  const srcParent = resolve(dirname(src));
  const destParent = resolve(dirname(dest));
  if (destParent === srcParent || destParent === parse(destParent).root) return;
  let destStat;
  try {
    destStat = statSync(destParent, { bigint: true });
  } catch (err: any) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  if (areIdentical(srcStat, destStat)) {
    // throw new ERR_FS_CP_EINVAL({
    //   message: `cannot copy ${src} to a subdirectory of self ${dest}`,
    //   path: dest,
    //   syscall: "cp",
    //   errno: EINVAL,
    //   code: "EINVAL",
    // });
    throw new Error(`cannot copy ${src} to a subdirectory of self ${dest}`);
  }
  return checkParentPathsSync(src, srcStat, destParent);
}

function checkParentDir(destStat, src, dest, opts) {
  const destParent = dirname(dest);
  if (!existsSync(destParent)) mkdirSync(destParent, { recursive: true });
  return getStats(destStat, src, dest, opts);
}

function getStats(destStat, src, dest, opts) {
  const statSyncFn = opts.dereference ? statSync : lstatSync;
  const srcStat = statSyncFn(src);

  if (srcStat.isDirectory() && opts.recursive) {
    return onDir(srcStat, destStat, src, dest, opts);
  } else if (srcStat.isDirectory()) {
    // throw new ERR_FS_EISDIR({
    //   message: `${src} is a directory (not copied)`,
    //   path: src,
    //   syscall: "cp",
    //   errno: EINVAL,
    //   code: "EISDIR",
    // });
    throw new Error(`${src} is a directory (not copied)`);
  } else if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) {
    return onFile(srcStat, destStat, src, dest, opts);
  } else if (srcStat.isSymbolicLink()) {
    return onLink(destStat, src, dest, opts);
  } else if (srcStat.isSocket()) {
    // throw new ERR_FS_CP_SOCKET({
    //   message: `cannot copy a socket file: ${dest}`,
    //   path: dest,
    //   syscall: "cp",
    //   errno: EINVAL,
    //   code: "EINVAL",
    // });
    throw new Error(`cannot copy a socket file: ${dest}`);
  } else if (srcStat.isFIFO()) {
    // throw new ERR_FS_CP_FIFO_PIPE({
    //   message: `cannot copy a FIFO pipe: ${dest}`,
    //   path: dest,
    //   syscall: "cp",
    //   errno: EINVAL,
    //   code: "EINVAL",
    // });
    throw new Error(`cannot copy a FIFO pipe: ${dest}`);
  }
  // throw new ERR_FS_CP_UNKNOWN({
  //   message: `cannot copy an unknown file type: ${dest}`,
  //   path: dest,
  //   syscall: "cp",
  //   errno: EINVAL,
  //   code: "EINVAL",
  // });
  throw new Error(`cannot copy an unknown file type: ${dest}`);
}

function onFile(srcStat, destStat, src, dest, opts) {
  if (!destStat) return copyFile(srcStat, src, dest, opts);
  return mayCopyFile(srcStat, src, dest, opts);
}

function mayCopyFile(srcStat, src, dest, opts) {
  if (opts.force) {
    unlinkSync(dest);
    return copyFile(srcStat, src, dest, opts);
  } else if (opts.errorOnExist) {
    // throw new ERR_FS_CP_EEXIST({
    //   message: `${dest} already exists`,
    //   path: dest,
    //   syscall: "cp",
    //   errno: EEXIST,
    //   code: "EEXIST",
    // });
    throw new Error(`${dest} already exists`);
  }
}

function copyFile(srcStat, src, dest, opts) {
  copyFileSync(src, dest, opts.mode);
  if (opts.preserveTimestamps) handleTimestamps(srcStat.mode, src, dest);
  return setDestMode(dest, srcStat.mode);
}

function handleTimestamps(srcMode, src, dest) {
  // Make sure the file is writable before setting the timestamp
  // otherwise open fails with EPERM when invoked with 'r+'
  // (through utimes call)
  if (fileIsNotWritable(srcMode)) makeFileWritable(dest, srcMode);
  return setDestTimestamps(src, dest);
}

function fileIsNotWritable(srcMode) {
  return (srcMode & 0o200) === 0;
}

function makeFileWritable(dest, srcMode) {
  return setDestMode(dest, srcMode | 0o200);
}

function setDestMode(dest, srcMode) {
  return chmodSync(dest, srcMode);
}

function setDestTimestamps(src, dest) {
  // The initial srcStat.atime cannot be trusted
  // because it is modified by the read(2) system call
  // (See https://nodejs.org/api/fs.html#fs_stat_time_values)
  const updatedSrcStat = statSync(src);
  return utimesSync(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
}

function onDir(srcStat, destStat, src, dest, opts) {
  if (!destStat) return mkDirAndCopy(srcStat.mode, src, dest, opts);
  return copyDir(src, dest, opts);
}

function mkDirAndCopy(srcMode, src, dest, opts) {
  mkdirSync(dest);
  copyDir(src, dest, opts);
  return setDestMode(dest, srcMode);
}

function copyDir(src, dest, opts) {
  // const dir = opendirSync(src);
  // try {
  //   let dirent;
  //   while ((dirent = dir.readSync()) !== null) {
  // const { name } = dirent;
  // const srcItem = join(src, name);
  // const destItem = join(dest, name);
  // const { destStat, skipped } = checkPathsSync(srcItem, destItem, opts);
  // if (!skipped) getStats(destStat, srcItem, destItem, opts);
  //   }
  // } finally {
  //   dir.closeSync();
  // }
  for (const dirent of readdirSync(src, { withFileTypes: true })) {
    const { name } = dirent;
    const srcItem = join(src, name);
    const destItem = join(dest, name);
    const { destStat, skipped } = checkPathsSync(srcItem, destItem, opts);
    if (!skipped) getStats(destStat, srcItem, destItem, opts);
  }
}

function onLink(destStat, src, dest, opts) {
  let resolvedSrc = readlinkSync(src);
  if (!opts.verbatimSymlinks && !isAbsolute(resolvedSrc)) {
    resolvedSrc = resolve(dirname(src), resolvedSrc);
  }
  if (!destStat) {
    return symlinkSync(resolvedSrc, dest);
  }
  let resolvedDest;
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
    resolvedDest = resolve(dirname(dest), resolvedDest);
  }
  if (isSrcSubdir(resolvedSrc, resolvedDest)) {
    // throw new ERR_FS_CP_EINVAL({
    //   message: `cannot copy ${resolvedSrc} to a subdirectory of self ` + `${resolvedDest}`,
    //   path: dest,
    //   syscall: "cp",
    //   errno: EINVAL,
    //   code: "EINVAL",
    // });
    throw new Error(`cannot copy ${resolvedSrc} to a subdirectory of self ${resolvedDest}`);
  }
  // Prevent copy if src is a subdir of dest since unlinking
  // dest in this case would result in removing src contents
  // and therefore a broken symlink would be created.
  if (statSync(dest).isDirectory() && isSrcSubdir(resolvedDest, resolvedSrc)) {
    // throw new ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY({
    //   message: `cannot overwrite ${resolvedDest} with ${resolvedSrc}`,
    //   path: dest,
    //   syscall: "cp",
    //   errno: EINVAL,
    //   code: "EINVAL",
    // });
    throw new Error(`cannot overwrite ${resolvedDest} with ${resolvedSrc}`);
  }
  return copyLink(resolvedSrc, dest);
}

function copyLink(resolvedSrc, dest) {
  unlinkSync(dest);
  return symlinkSync(resolvedSrc, dest);
}

export default cpSyncFn;
