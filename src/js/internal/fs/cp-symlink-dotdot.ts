// What internal/fs/cp-sync and internal/fs/cp do for a root with `..` in it. They load this for no other root.
//
// path.join("app/cur/..", "x") is "app/x". The system gives "releases/x" when app/cur is a link to releases/v2.
// A root like that keeps its path as given: the walkers make the path of an entry from that path and the name,
// where node's JS walk joins (with a `filter`) and its C++ walk does not:
// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/cp/cp-sync.js#L150-L174
import type { KeptRoot } from "./cp-sync";

const { lstatSync, realpathSync, statSync } = require("node:fs");
const { lstat, realpath, stat } = require("node:fs/promises");
const { basename, dirname, join, normalize } = require("node:path");

const realpathNativeSync = realpathSync.native;

const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSlice = String.prototype.slice;

// The names of `path` that a later `..` cancels: where each one ends in `path`, in the order of the `..`.
function cancelledNames(path: string) {
  const names: number[] = [];
  const cancelled: number[] = [];
  for (let start = 0; start < path.length;) {
    let end = StringPrototypeIndexOf.$call(path, "/", start);
    if (end === -1) end = path.length;
    const length = end - start;
    if (length === 2 && path[start] === "." && path[start + 1] === ".") {
      if (names.length) cancelled.push(names.pop()!);
    } else if (length > 1 || (length === 1 && path[start] !== ".")) {
      names.push(end);
    }
    start = end + 1;
  }
  return cancelled;
}

// True when the system and path.join() give `path` two directories. That takes a `..` that cancels a symbolic link.
function keepsPathSync(path: string) {
  const cancelled = cancelledNames(path);
  for (let i = 0; i < cancelled.length; i++) {
    let isLink: boolean;
    try {
      // No name that a `..` cancelled before this one is a link, so the text up to here is right.
      isLink = lstatSync(normalize(StringPrototypeSlice.$call(path, 0, cancelled[i]))).isSymbolicLink();
    } catch {
      // A name that the copy makes. Any other failure is for the calls of the copy to report.
      continue;
    }
    if (!isLink) continue;
    try {
      // The names at the end that do not exist yet are the same for the system and for the text.
      while (statSync(path, { throwIfNoEntry: false }) === undefined) {
        const parent = dirname(path);
        // After `new/..` the system resolves the rest only once the copy made `new`.
        if (parent === path || basename(path) === "..") return true;
        path = parent;
      }
      return realpathNativeSync(path) !== realpathNativeSync(normalize(path));
    } catch {
      // Nothing shows that the text is right.
      return true;
    }
  }
  return false;
}

async function keepsPath(path: string) {
  const cancelled = cancelledNames(path);
  for (let i = 0; i < cancelled.length; i++) {
    let isLink: boolean;
    try {
      isLink = (await lstat(normalize(StringPrototypeSlice.$call(path, 0, cancelled[i])))).isSymbolicLink();
    } catch {
      continue;
    }
    if (!isLink) continue;
    try {
      while (!(await exists(path))) {
        const parent = dirname(path);
        if (parent === path || basename(path) === "..") return true;
        path = parent;
      }
      return (await realpath(path)) !== (await realpath(normalize(path)));
    } catch {
      return true;
    }
  }
  return false;
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (err: any) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

// The directory that a relative target of `link` starts from, below a root that keeps its path: path.resolve() would
// cancel the `<symlink>/..` of the root as text. The walk follows no link below a root, so the rest is text.
function linkDirSync(link: string, kept: KeptRoot) {
  try {
    kept.real ??= realpathNativeSync(kept.path);
  } catch {
    // What node's JS walk takes for every link.
    return dirname(link);
  }
  return dirname(join(kept.real, StringPrototypeSlice.$call(link, kept.path.length)));
}

async function linkDir(link: string, kept: KeptRoot) {
  try {
    kept.real ??= await realpath(kept.path);
  } catch {
    return dirname(link);
  }
  return dirname(join(kept.real, StringPrototypeSlice.$call(link, kept.path.length)));
}

export default { keepsPathSync, keepsPath, linkDirSync, linkDir };
