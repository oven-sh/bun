(function (){"use strict";// build3/tmp/internal/fs/cp.ts
async function cpFn(src, dest, opts) {
  const stats = await checkPaths(src, dest, opts);
  const { srcStat, destStat, skipped } = stats;
  if (skipped)
    return;
  await checkParentPaths(src, srcStat, dest);
  return checkParentDir(destStat, src, dest, opts);
}
async function checkPaths(src, dest, opts) {
  if (opts.filter && !await opts.filter(src, dest)) {
    return { __proto__: null, skipped: true };
  }
  const { 0: srcStat, 1: destStat } = await getStats(src, dest, opts);
  if (destStat) {
    if (areIdentical(srcStat, destStat)) {
      throw new Error("Source and destination must not be the same.");
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
}
var areIdentical = function(srcStat, destStat) {
  return destStat.ino && destStat.dev && destStat.ino === srcStat.ino && destStat.dev === srcStat.dev;
};
var getStats = function(src, dest, opts) {
  const statFunc = opts.dereference ? (file) => stat(file, { bigint: true }) : (file) => lstat(file, { bigint: true });
  return SafePromiseAll([
    statFunc(src),
    PromisePrototypeThen.@call(statFunc(dest), @undefined, (err) => {
      if (err.code === "ENOENT")
        return null;
      throw err;
    })
  ]);
};
async function checkParentDir(destStat, src, dest, opts) {
  const destParent = dirname(dest);
  const dirExists = await pathExists(destParent);
  if (dirExists)
    return getStatsForCopy(destStat, src, dest, opts);
  await mkdir(destParent, { recursive: true });
  return getStatsForCopy(destStat, src, dest, opts);
}
var pathExists = function(dest) {
  return PromisePrototypeThen(stat(dest), () => true, (err) => err.code === "ENOENT" ? false : PromiseReject(err));
};
async function checkParentPaths(src, srcStat, dest) {
  const srcParent = resolve(dirname(src));
  const destParent = resolve(dirname(dest));
  if (destParent === srcParent || destParent === parse(destParent).root) {
    return;
  }
  let destStat;
  try {
    destStat = await stat(destParent, { bigint: true });
  } catch (err) {
    if (err.code === "ENOENT")
      return;
    throw err;
  }
  if (areIdentical(srcStat, destStat)) {
    throw new Error(`cannot copy ${src} to a subdirectory of self ${dest}`);
  }
  return checkParentPaths(src, srcStat, destParent);
}
var isSrcSubdir = function(src, dest) {
  const srcArr = normalizePathToArray(src);
  const destArr = normalizePathToArray(dest);
  return ArrayPrototypeEvery.@call(srcArr, (cur, i) => destArr[i] === cur);
};
async function getStatsForCopy(destStat, src, dest, opts) {
  const statFn = opts.dereference ? stat : lstat;
  const srcStat = await statFn(src);
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
}
var onFile = function(srcStat, destStat, src, dest, opts) {
  if (!destStat)
    return _copyFile(srcStat, src, dest, opts);
  return mayCopyFile(srcStat, src, dest, opts);
};
async function mayCopyFile(srcStat, src, dest, opts) {
  if (opts.force) {
    await unlink(dest);
    return _copyFile(srcStat, src, dest, opts);
  } else if (opts.errorOnExist) {
    throw new Error(`${dest} already exists`);
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
  if (fileIsNotWritable(srcMode)) {
    await makeFileWritable(dest, srcMode);
    return setDestTimestampsAndMode(srcMode, src, dest);
  }
  return setDestTimestampsAndMode(srcMode, src, dest);
}
var fileIsNotWritable = function(srcMode) {
  return (srcMode & 128) === 0;
};
var makeFileWritable = function(dest, srcMode) {
  return setDestMode(dest, srcMode | 128);
};
async function setDestTimestampsAndMode(srcMode, src, dest) {
  await setDestTimestamps(src, dest);
  return setDestMode(dest, srcMode);
}
var setDestMode = function(dest, srcMode) {
  return chmod(dest, srcMode);
};
async function setDestTimestamps(src, dest) {
  const updatedSrcStat = await stat(src);
  return utimes(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
}
var onDir = function(srcStat, destStat, src, dest, opts) {
  if (!destStat)
    return mkDirAndCopy(srcStat.mode, src, dest, opts);
  return copyDir(src, dest, opts);
};
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
    if (!skipped)
      await getStatsForCopy(destStat, srcItem, destItem, opts);
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
  } catch (err) {
    if (err.code === "EINVAL" || err.code === "UNKNOWN") {
      return symlink(resolvedSrc, dest);
    }
    throw err;
  }
  if (!isAbsolute(resolvedDest)) {
    resolvedDest = resolve(dirname(dest), resolvedDest);
  }
  if (isSrcSubdir(resolvedSrc, resolvedDest)) {
    throw new Error(`cannot copy ${resolvedSrc} to a subdirectory of self ${resolvedDest}`);
  }
  const srcStat = await stat(src);
  if (srcStat.isDirectory() && isSrcSubdir(resolvedDest, resolvedSrc)) {
    throw new Error(`cannot overwrite ${resolvedDest} with ${resolvedSrc}`);
  }
  return copyLink(resolvedSrc, dest);
}
async function copyLink(resolvedSrc, dest) {
  await unlink(dest);
  return symlink(resolvedSrc, dest);
}
var { chmod, copyFile, lstat, mkdir, opendir, readlink, stat, symlink, unlink, utimes } = @getInternalField(@internalModuleRegistry, 22) || @createInternalModuleById(22);
var { dirname, isAbsolute, join, parse, resolve, sep } = @getInternalField(@internalModuleRegistry, 30) || @createInternalModuleById(30);
var SafePromiseAll = @Promise.all;
var PromisePrototypeThen = @Promise.prototype.then;
var PromiseReject = @Promise.reject;
var ArrayPrototypeFilter = @Array.prototype.filter;
var StringPrototypeSplit = @String.prototype.split;
var ArrayPrototypeEvery = @Array.prototype.every;
var normalizePathToArray = (path) => ArrayPrototypeFilter.@call(StringPrototypeSplit(resolve(path), sep), Boolean);
return cpFn})
