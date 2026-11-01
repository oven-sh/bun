// The `maxDepth` option of fs.glob: a port of the DepthLimiter of Node.js lib/internal/fs/glob.js and of its helpers
// (v26.12.1, nodejs/node#64003):
//   https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/glob.js
// internal/fs/glob requires this module for a walk with a finite `maxDepth` only.
//
// Three things are not Node's text:
// - The two identity tables, and the four methods that fill them, are here and not in the Cache of the walker.
// - plainDepth() gives the depth of a path below `cwd` from the path alone, as PlainDepth does on Node's main
//   branch. includesPlain() and canTraversePlain() use it.
// - includesNow() is for the async walk, which must not ask the file system where it adds a match.
const { resolve, relative, dirname, isAbsolute, parse, sep } = require("node:path");

const isWindows = process.platform === "win32";
const isMacOS = process.platform === "darwin";

type Stats = $Node.Stats;

function identity<T>(v: T) {
  return v;
}
function nullOnReject() {
  return null;
}
function statIdentity(stat: Stats) {
  return `${stat.dev}:${stat.ino}`;
}

function isOutsidePath(path: string) {
  return isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`);
}

function isStrictDescendant(path: string) {
  return path !== "" && !isOutsidePath(path);
}

function pathDepth(path: string) {
  if (path === "") {
    return 0;
  }
  if (isAbsolute(path)) {
    return Infinity;
  }
  return path.split(sep).length;
}

function ancestorAtDepth(path: string, relativePath: string) {
  let ancestor = path;
  if (relativePath !== "") {
    const depth = pathDepth(relativePath);
    for (let i = 0; i < depth; i++) {
      ancestor = dirname(ancestor);
    }
  }
  return ancestor;
}

function caseSensitiveRelative(path: string, otherPath: string) {
  const pathRoot = parse(path).root;
  const otherPathRoot = parse(otherPath).root;
  if (pathRoot.toLowerCase() !== otherPathRoot.toLowerCase()) {
    return otherPath;
  }
  const pathTail = path.slice(pathRoot.length);
  const otherPathTail = otherPath.slice(otherPathRoot.length);
  const pathParts = pathTail === "" ? [] : pathTail.split(sep);
  const otherPathParts = otherPathTail === "" ? [] : otherPathTail.split(sep);
  let common = 0;
  while (common < pathParts.length && common < otherPathParts.length && pathParts[common] === otherPathParts[common]) {
    common++;
  }
  const parts: string[] = [];
  for (let i = common; i < pathParts.length; i++) {
    parts.push("..");
  }
  for (let i = common; i < otherPathParts.length; i++) {
    parts.push(otherPathParts[i]);
  }
  return parts.join(sep);
}

interface RelativeCandidate {
  __proto__: null;
  pathFromRoot: string;
  caseVariantRoot?: string;
  differentPath?: string;
}

// The depth of a path that the walker built, when the path stays below `cwd`: the count of its segments, with no
// path or fs call. -1 when the path can leave `cwd` (it is absolute or has a ".." segment). DepthLimiter then
// decides with the rules of Node v26.12.1. This is PlainDepth on Node's main branch:
//   https://github.com/nodejs/node/blob/95f3cf072e83d94ac90616c86a370b250f44a8d7/src/glob/glob_walker.cc#L1063-L1073
// On Windows a name with ":" can be relative to a drive, which path.resolve() reads, so it goes to DepthLimiter too.
// An absolute path with a drive has ":", so the first character finds every other absolute path, as isAbsolute() does.
function plainDepth(path: string) {
  if (path === ".") {
    return 0;
  }
  const first = path.charCodeAt(0);
  if (first === 47 || (isWindows && (first === 92 || path.includes(":")))) {
    return -1;
  }
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= path.length; i++) {
    const code = i === path.length ? 47 : path.charCodeAt(i);
    // "/" ends a segment, and "\\" does too on Windows.
    if (code === 47 || (isWindows && code === 92)) {
      const length = i - start;
      const startsWithDot = path.charCodeAt(start) === 46;
      if (length === 2 && startsWithDot && path.charCodeAt(start + 1) === 46) {
        return -1;
      }
      // An empty segment and "." add no depth.
      if (length > 1 || (length === 1 && !startsWithDot)) {
        depth++;
      }
      start = i + 1;
    }
  }
  return depth;
}

type IdentityCache = Map<string, string | null | Promise<string | null>>;

// Only a finite `maxDepth` makes one, so a walk with no limit has none of its tables.
class DepthLimiter {
  #root: string;
  #maxDepth: number;
  #relativeCache = new Map<string, string | Promise<string>>();
  // Only Windows and macOS read these two, so they are made on first use.
  #identityCache: IdentityCache | undefined;
  #identityRealpathCache: IdentityCache | undefined;

  constructor(root: string, maxDepth: number) {
    this.#root = resolve(root);
    this.#maxDepth = maxDepth;
  }

  #identity(path: string) {
    const cache = (this.#identityCache ??= new Map());
    const cached = cache.get(path);
    if (cached) {
      return cached;
    }
    const promise = require("node:fs/promises").lstat(path).then(statIdentity, nullOnReject);
    cache.set(path, promise);
    return promise;
  }
  #identitySync(path: string) {
    const cache = (this.#identityCache ??= new Map());
    const cached = cache.get(path);
    if (cached && !(cached instanceof Promise)) {
      return cached;
    }
    let val: string | null;
    try {
      val = statIdentity(require("node:fs").lstatSync(path));
    } catch {
      val = null;
    }
    cache.set(path, val);
    return val;
  }
  #identityRealpath(path: string) {
    const cache = (this.#identityRealpathCache ??= new Map());
    const cached = cache.get(path);
    if (cached) {
      return cached;
    }
    const promise = require("node:fs/promises").realpath(path).then(identity, nullOnReject);
    cache.set(path, promise);
    return promise;
  }
  #identityRealpathSync(path: string) {
    const cache = (this.#identityRealpathCache ??= new Map());
    const cached = cache.get(path);
    if (cached && !(cached instanceof Promise)) {
      return cached;
    }
    let val: string | null;
    try {
      val = require("node:fs").realpathSync.native(path);
    } catch {
      val = null;
    }
    cache.set(path, val);
    return val;
  }

  #relativeCandidate(path: string): RelativeCandidate {
    const fullpath = resolve(this.#root, path);
    const pathFromRoot = relative(this.#root, fullpath);
    if (isWindows && !isOutsidePath(pathFromRoot)) {
      return {
        __proto__: null,
        pathFromRoot,
        caseVariantRoot: ancestorAtDepth(fullpath, pathFromRoot),
        differentPath: caseSensitiveRelative(this.#root, fullpath),
      };
    }
    if (isMacOS && !isAbsolute(pathFromRoot) && isOutsidePath(pathFromRoot)) {
      const foldedPathFromRoot = relative(this.#root.toLowerCase(), fullpath.toLowerCase());
      if (!isOutsidePath(foldedPathFromRoot)) {
        return {
          __proto__: null,
          pathFromRoot: foldedPathFromRoot,
          caseVariantRoot: ancestorAtDepth(fullpath, foldedPathFromRoot),
          differentPath: pathFromRoot,
        };
      }
    }
    return { __proto__: null, pathFromRoot };
  }

  #isSamePath(path: string, otherPath: string) {
    if (path === otherPath) {
      return true;
    }
    if (isWindows) {
      const realPath = this.#identityRealpathSync(path);
      return realPath !== null && realPath === this.#identityRealpathSync(otherPath);
    }
    const identity = this.#identitySync(path);
    return identity !== null && identity === this.#identitySync(otherPath);
  }

  async #isSamePathAsync(path: string, otherPath: string) {
    if (path === otherPath) {
      return true;
    }
    if (isWindows) {
      const realPath = await this.#identityRealpath(path);
      return realPath !== null && realPath === (await this.#identityRealpath(otherPath));
    }
    const identity = await this.#identity(path);
    return identity !== null && identity === (await this.#identity(otherPath));
  }

  #relativeFromRoot(path: string) {
    const cached = this.#relativeCache.get(path);
    if (cached !== undefined && !(cached instanceof Promise)) {
      return cached;
    }
    const candidate = this.#relativeCandidate(path);
    const relativePath =
      candidate.caseVariantRoot === undefined || this.#isSamePath(this.#root, candidate.caseVariantRoot)
        ? candidate.pathFromRoot
        : candidate.differentPath!;
    this.#relativeCache.set(path, relativePath);
    return relativePath;
  }

  #relativeFromRootAsync(path: string) {
    const cached = this.#relativeCache.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const candidate = this.#relativeCandidate(path);
    if (candidate.caseVariantRoot === undefined) {
      this.#relativeCache.set(path, candidate.pathFromRoot);
      return candidate.pathFromRoot;
    }
    const promise = this.#isSamePathAsync(this.#root, candidate.caseVariantRoot).then(isSamePath =>
      isSamePath ? candidate.pathFromRoot : candidate.differentPath!,
    );
    this.#relativeCache.set(path, promise);
    return promise;
  }

  #ancestorCandidate(path: string) {
    const fullpath = resolve(this.#root, path);
    const rootFromPath = relative(fullpath, this.#root);
    if (isStrictDescendant(rootFromPath)) {
      return { __proto__: null, fullpath, needsIdentity: isWindows };
    }
    if (isMacOS) {
      const foldedRootFromPath = relative(fullpath.toLowerCase(), this.#root.toLowerCase());
      if (isStrictDescendant(foldedRootFromPath)) {
        return { __proto__: null, fullpath, needsIdentity: true };
      }
    }
    return null;
  }

  #isAncestorOfRoot(path: string) {
    const candidate = this.#ancestorCandidate(path);
    if (candidate === null) {
      return false;
    }
    if (!candidate.needsIdentity) {
      return true;
    }
    const realRoot = this.#identityRealpathSync(this.#root);
    const realFullpath = this.#identityRealpathSync(candidate.fullpath);
    if (realRoot === null || realFullpath === null) {
      return false;
    }
    const realRootFromPath = isWindows
      ? caseSensitiveRelative(realFullpath, realRoot)
      : relative(realFullpath, realRoot);
    return isStrictDescendant(realRootFromPath);
  }

  async #isAncestorOfRootAsync(path: string) {
    const candidate = this.#ancestorCandidate(path);
    if (candidate === null) {
      return false;
    }
    if (!candidate.needsIdentity) {
      return true;
    }
    const realRoot = await this.#identityRealpath(this.#root);
    const realFullpath = await this.#identityRealpath(candidate.fullpath);
    if (realRoot === null || realFullpath === null) {
      return false;
    }
    const realRootFromPath = isWindows
      ? caseSensitiveRelative(realFullpath, realRoot)
      : relative(realFullpath, realRoot);
    return isStrictDescendant(realRootFromPath);
  }

  // The two tests below answer from the path alone, for a path that stays below the root. `undefined` means that
  // the path can leave the root: ask the method of the same name without "Plain". Node's own text always asks it.
  includesPlain(path: string) {
    const depth = plainDepth(path);
    return depth < 0 ? undefined : depth <= this.#maxDepth;
  }

  canTraversePlain(path: string) {
    const depth = plainDepth(path);
    return depth < 0 ? undefined : depth < this.#maxDepth;
  }

  includes(path: string) {
    return pathDepth(this.#relativeFromRoot(path)) <= this.#maxDepth;
  }

  // For the async walk: the answer when the file system is not necessary for it, which is always so on Linux.
  // `undefined` on Windows and macOS when the file system has to say where the path is from the root: ask
  // includesAsync().
  includesNow(path: string) {
    const depth = plainDepth(path);
    if (depth >= 0) {
      return depth <= this.#maxDepth;
    }
    const relativePath = this.#relativeFromRootAsync(path);
    return typeof relativePath === "string" ? pathDepth(relativePath) <= this.#maxDepth : undefined;
  }

  async includesAsync(path: string) {
    return pathDepth(await this.#relativeFromRootAsync(path)) <= this.#maxDepth;
  }

  canTraverse(path: string, isAbsolutePattern: boolean) {
    return (
      (isAbsolutePattern && this.#isAncestorOfRoot(path)) || pathDepth(this.#relativeFromRoot(path)) < this.#maxDepth
    );
  }

  async canTraverseAsync(path: string, isAbsolutePattern: boolean) {
    return (
      (isAbsolutePattern && (await this.#isAncestorOfRootAsync(path))) ||
      pathDepth(await this.#relativeFromRootAsync(path)) < this.#maxDepth
    );
  }
}

export default { DepthLimiter, plainDepth };
