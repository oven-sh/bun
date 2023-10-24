(function (){"use strict";// build2/tmp/internal/fs/cp-sync.ts
var areIdentical = function(srcStat, destStat) {
  return destStat.ino && destStat.dev && destStat.ino === srcStat.ino && destStat.dev === srcStat.dev;
};
var isSrcSubdir = function(src, dest) {
  const srcArr = normalizePathToArray(src);
  const destArr = normalizePathToArray(dest);
  return ArrayPrototypeEvery.@call(srcArr, (cur, i) => destArr[i] === cur);
};
var cpSyncFn = function(src, dest, opts) {
  const { srcStat, destStat, skipped } = checkPathsSync(src, dest, opts);
  if (skipped)
    return;
  checkParentPathsSync(src, srcStat, dest);
  return checkParentDir(destStat, src, dest, opts);
};
var checkPathsSync = function(src, dest, opts) {
  if (opts.filter) {
    const shouldCopy = opts.filter(src, dest);
    if (isPromise(shouldCopy)) {
      throw new Error("Expected a boolean from the filter function, but got a promise. Use `fs.promises.cp` instead.");
    }
    if (!shouldCopy)
      return { __proto__: null, skipped: true };
  }
  const { srcStat, destStat } = getStatsSync(src, dest, opts);
  if (destStat) {
    if (areIdentical(srcStat, destStat)) {
      throw new Error("src and dest cannot be the same");
    }
    if (srcStat.isDirectory() && !destStat.isDirectory()) {
      throw new Error(`cannot overwrite directory ${src} with non-directory ${dest}`);
    }
    if (!srcStat.isDirectory() && destStat.isDirectory()) {
      throw new Error(`cannot overwrite non-directory ${src} with directory ${dest}`);
    }
  }
  if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
    throw new Error(`cannot copy ${src} to a subdirectory of self ${dest}`);
  }
  return { __proto__: null, srcStat, destStat, skipped: false };
};
var getStatsSync = function(src, dest, opts) {
  let destStat;
  const statFunc = opts.dereference ? (file) => statSync(file, { bigint: true }) : (file) => lstatSync(file, { bigint: true });
  const srcStat = statFunc(src);
  try {
    destStat = statFunc(dest);
  } catch (err) {
    if (err.code === "ENOENT")
      return { srcStat, destStat: null };
    throw err;
  }
  return { srcStat, destStat };
};
var checkParentPathsSync = function(src, srcStat, dest) {
  const srcParent = resolve(dirname(src));
  const destParent = resolve(dirname(dest));
  if (destParent === srcParent || destParent === parse(destParent).root)
    return;
  let destStat;
  try {
    destStat = statSync(destParent, { bigint: true });
  } catch (err) {
    if (err.code === "ENOENT")
      return;
    throw err;
  }
  if (areIdentical(srcStat, destStat)) {
    throw new Error(`cannot copy ${src} to a subdirectory of self ${dest}`);
  }
  return checkParentPathsSync(src, srcStat, destParent);
};
var checkParentDir = function(destStat, src, dest, opts) {
  const destParent = dirname(dest);
  if (!existsSync(destParent))
    mkdirSync(destParent, { recursive: true });
  return getStats(destStat, src, dest, opts);
};
var getStats = function(destStat, src, dest, opts) {
  const statSyncFn = opts.dereference ? statSync : lstatSync;
  const srcStat = statSyncFn(src);
  if (srcStat.isDirectory() && opts.recursive) {
    return onDir(srcStat, destStat, src, dest, opts);
  } else if (srcStat.isDirectory()) {
    throw new Error(`${src} is a directory (not copied)`);
  } else if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) {
    return onFile(srcStat, destStat, src, dest, opts);
  } else if (srcStat.isSymbolicLink()) {
    return onLink(destStat, src, dest, opts);
  } else if (srcStat.isSocket()) {
    throw new Error(`cannot copy a socket file: ${dest}`);
  } else if (srcStat.isFIFO()) {
    throw new Error(`cannot copy a FIFO pipe: ${dest}`);
  }
  throw new Error(`cannot copy an unknown file type: ${dest}`);
};
var onFile = function(srcStat, destStat, src, dest, opts) {
  if (!destStat)
    return copyFile(srcStat, src, dest, opts);
  return mayCopyFile(srcStat, src, dest, opts);
};
var mayCopyFile = function(srcStat, src, dest, opts) {
  if (opts.force) {
    unlinkSync(dest);
    return copyFile(srcStat, src, dest, opts);
  } else if (opts.errorOnExist) {
    throw new Error(`${dest} already exists`);
  }
};
var copyFile = function(srcStat, src, dest, opts) {
  copyFileSync(src, dest, opts.mode);
  if (opts.preserveTimestamps)
    handleTimestamps(srcStat.mode, src, dest);
  return setDestMode(dest, srcStat.mode);
};
var handleTimestamps = function(srcMode, src, dest) {
  if (fileIsNotWritable(srcMode))
    makeFileWritable(dest, srcMode);
  return setDestTimestamps(src, dest);
};
var fileIsNotWritable = function(srcMode) {
  return (srcMode & 128) === 0;
};
var makeFileWritable = function(dest, srcMode) {
  return setDestMode(dest, srcMode | 128);
};
var setDestMode = function(dest, srcMode) {
  return chmodSync(dest, srcMode);
};
var setDestTimestamps = function(src, dest) {
  const updatedSrcStat = statSync(src);
  return utimesSync(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
};
var onDir = function(srcStat, destStat, src, dest, opts) {
  if (!destStat)
    return mkDirAndCopy(srcStat.mode, src, dest, opts);
  return copyDir(src, dest, opts);
};
var mkDirAndCopy = function(srcMode, src, dest, opts) {
  mkdirSync(dest);
  copyDir(src, dest, opts);
  return setDestMode(dest, srcMode);
};
var copyDir = function(src, dest, opts) {
  for (const dirent of readdirSync(src, { withFileTypes: true })) {
    const { name } = dirent;
    const srcItem = join(src, name);
    const destItem = join(dest, name);
    const { destStat, skipped } = checkPathsSync(srcItem, destItem, opts);
    if (!skipped)
      getStats(destStat, srcItem, destItem, opts);
  }
};
var onLink = function(destStat, src, dest, opts) {
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
  } catch (err) {
    if (err.code === "EINVAL" || err.code === "UNKNOWN") {
      return symlinkSync(resolvedSrc, dest);
    }
    throw err;
  }
  if (!isAbsolute(resolvedDest)) {
    resolvedDest = resolve(dirname(dest), resolvedDest);
  }
  if (isSrcSubdir(resolvedSrc, resolvedDest)) {
    throw new Error(`cannot copy ${resolvedSrc} to a subdirectory of self ${resolvedDest}`);
  }
  if (statSync(dest).isDirectory() && isSrcSubdir(resolvedDest, resolvedSrc)) {
    throw new Error(`cannot overwrite ${resolvedDest} with ${resolvedSrc}`);
  }
  return copyLink(resolvedSrc, dest);
};
var copyLink = function(resolvedSrc, dest) {
  unlinkSync(dest);
  return symlinkSync(resolvedSrc, dest);
};
var ArrayPrototypeEvery = @Array.prototype.every;
var ArrayPrototypeFilter = @Array.prototype.filter;
var StringPrototypeSplit = @String.prototype.split;
var normalizePathToArray = (path) => ArrayPrototypeFilter.@call(StringPrototypeSplit.@call(resolve(path), sep), Boolean);
var {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync
} = @getInternalField(@internalModuleRegistry, 21) || @createInternalModuleById(21);
var { dirname, isAbsolute, join, parse, resolve, sep } = @getInternalField(@internalModuleRegistry, 30) || @createInternalModuleById(30);
var { isPromise } = @requireNativeModule("util/types");
return cpSyncFn})
