// Taken and modified from node.js: https://github.com/nodejs/node/blob/main/lib/internal/fs/cp/cp-sync.js

// const { EEXIST, EISDIR, EINVAL, ENOTDIR } = $processBindingConstants.os.errno;

const ArrayPrototypeEvery = Array.prototype.every;
const ArrayPrototypeFilter = Array.prototype.filter;
const StringPrototypeSplit = String.prototype.split;

const { EEXIST, EISDIR, EINVAL, ENOTDIR } = $processBindingConstants.os.errno;

// Mirrors node's SystemError shape for the ERR_FS_CP_* / ERR_FS_EISDIR family
// (message format, code, errno, syscall, path, info).
function cpSystemError(code, prefix, context) {
  context.syscall = "cp";
  let message = `${prefix}: ${context.syscall} returned ${context.code} (${context.message})`;
  if (context.path !== undefined) message += ` ${context.path}`;
  const err = new Error(message);
  err.code = code;
  err.info = context;
  err.errno = context.errno;
  err.syscall = context.syscall;
  err.path = context.path;
  return err;
}

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

// Like getValidatedPath, but without resolving to an absolute path: node
// passes the caller's strings through to filter callbacks and error messages
// verbatim, so resolving here would change what user code observes.
function getValidatedCpPath(p, name) {
  if (p instanceof URL) return Bun.fileURLToPath(p);
  if (p instanceof Uint8Array) {
    // node accepts Uint8Array/Buffer paths and treats them as literal byte
    // paths (no file: URL sniffing).
    return Buffer.from(p.buffer, p.byteOffset, p.byteLength).toString();
  }
  if (typeof p !== "string") throw $ERR_INVALID_ARG_TYPE(name, ["string", "Buffer", "URL"], p);
  if (p.startsWith("file:")) return Bun.fileURLToPath(p);
  return p;
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
    if ($isPromise(shouldCopy)) {
      throw $ERR_INVALID_RETURN_VALUE("boolean", "filter", shouldCopy);
    }
    if (!shouldCopy) return { __proto__: null, skipped: true };
  }
  const { srcStat, destStat } = getStatsSync(src, dest, opts);

  if (destStat) {
    if (areIdentical(srcStat, destStat)) {
      throw cpSystemError("ERR_FS_CP_EINVAL", "Invalid src or dest", {
        message: "src and dest cannot be the same",
        path: dest,
        errno: EINVAL,
        code: "EINVAL",
      });
    }
    if (srcStat.isDirectory() && !destStat.isDirectory()) {
      throw cpSystemError("ERR_FS_CP_DIR_TO_NON_DIR", "Cannot overwrite non-directory with directory", {
        message: `cannot overwrite non-directory ${dest} with directory ${src}`,
        path: dest,
        errno: EISDIR,
        code: "EISDIR",
      });
    }
    if (!srcStat.isDirectory() && destStat.isDirectory()) {
      throw cpSystemError("ERR_FS_CP_NON_DIR_TO_DIR", "Cannot overwrite directory with non-directory", {
        message: `cannot overwrite directory ${dest} with non-directory ${src}`,
        path: dest,
        errno: ENOTDIR,
        code: "ENOTDIR",
      });
    }
  }

  if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
    throw cpSystemError("ERR_FS_CP_EINVAL", "Invalid src or dest", {
      message: `cannot copy ${src} to a subdirectory of self ${dest}`,
      path: dest,
      errno: EINVAL,
      code: "EINVAL",
    });
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
    throw cpSystemError("ERR_FS_CP_EINVAL", "Invalid src or dest", {
      message: `cannot copy ${src} to a subdirectory of self ${dest}`,
      path: dest,
      errno: EINVAL,
      code: "EINVAL",
    });
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
    throw cpSystemError("ERR_FS_EISDIR", "Path is a directory", {
      message: `${src} is a directory (not copied)`,
      path: src,
      errno: EISDIR,
      code: "EISDIR",
    });
  } else if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) {
    return onFile(srcStat, destStat, src, dest, opts);
  } else if (srcStat.isSymbolicLink()) {
    return onLink(destStat, src, dest, opts);
  } else if (srcStat.isSocket()) {
    throw cpSystemError("ERR_FS_CP_SOCKET", "Cannot copy a socket file", {
      message: `cannot copy a socket file: ${dest}`,
      path: dest,
      errno: EINVAL,
      code: "EINVAL",
    });
  } else if (srcStat.isFIFO()) {
    throw cpSystemError("ERR_FS_CP_FIFO_PIPE", "Cannot copy a FIFO pipe", {
      message: `cannot copy a FIFO pipe: ${dest}`,
      path: dest,
      errno: EINVAL,
      code: "EINVAL",
    });
  }
  throw cpSystemError("ERR_FS_CP_UNKNOWN", "Cannot copy an unknown file type", {
    message: `cannot copy an unknown file type: ${dest}`,
    path: dest,
    errno: EINVAL,
    code: "EINVAL",
  });
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
    throw cpSystemError("ERR_FS_CP_EEXIST", "Target already exists", {
      message: `${dest} already exists`,
      path: dest,
      errno: EEXIST,
      code: "EEXIST",
    });
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
  if (opts.errorOnExist && !opts.force) {
    throw cpSystemError("ERR_FS_CP_EEXIST", "Target already exists", {
      message: `${dest} already exists`,
      path: dest,
      errno: EEXIST,
      code: "EEXIST",
    });
  }
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
    throw cpSystemError("ERR_FS_CP_EINVAL", "Invalid src or dest", {
      message: `cannot copy ${resolvedSrc} to a subdirectory of self ${resolvedDest}`,
      path: dest,
      errno: EINVAL,
      code: "EINVAL",
    });
  }
  // Prevent copy if src is a subdir of dest since unlinking
  // dest in this case would result in removing src contents
  // and therefore a broken symlink would be created.
  if (statSync(dest).isDirectory() && isSrcSubdir(resolvedDest, resolvedSrc)) {
    throw cpSystemError("ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY", "Cannot overwrite symlink in subdirectory of self", {
      message: `cannot overwrite ${resolvedDest} with ${resolvedSrc}`,
      path: dest,
      errno: EINVAL,
      code: "EINVAL",
    });
  }
  return copyLink(resolvedSrc, dest);
}

function copyLink(resolvedSrc, dest) {
  unlinkSync(dest);
  return symlinkSync(resolvedSrc, dest);
}

export default cpSyncFn;

// --- shared cp option validation (also used by fs.cp / fs.promises.cp) -----
// Ported from node's lib/internal/fs/utils.js (validateCpOptions / getValidMode).
const { validateBoolean, validateFunction, validateObject } = require("internal/validators");
const { COPYFILE_EXCL, COPYFILE_FICLONE, COPYFILE_FICLONE_FORCE } = require("node:fs").constants;
const kMaximumCopyMode = COPYFILE_EXCL | COPYFILE_FICLONE | COPYFILE_FICLONE_FORCE;

const defaultCpOptions = {
  dereference: false,
  errorOnExist: false,
  filter: undefined,
  force: true,
  preserveTimestamps: false,
  recursive: false,
  verbatimSymlinks: false,
};

function getValidMode(mode) {
  if (mode == null) {
    return 0;
  }
  if (Number.isInteger(mode) && mode >= 0 && mode <= kMaximumCopyMode) {
    return mode;
  }
  if (typeof mode !== "number") {
    throw $ERR_INVALID_ARG_TYPE("mode", "integer", mode);
  }
  throw $ERR_OUT_OF_RANGE("mode", `an integer >= 0 && <= ${kMaximumCopyMode}`, mode);
}

function validateCpOptions(options) {
  if (options === undefined) return { ...defaultCpOptions };
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
  if (options.filter !== undefined) {
    validateFunction(options.filter, "options.filter");
  }
  return options;
}

cpSyncFn.validateCpOptions = validateCpOptions;
cpSyncFn.isSrcSubdir = isSrcSubdir;
cpSyncFn.getValidatedCpPath = getValidatedCpPath;
