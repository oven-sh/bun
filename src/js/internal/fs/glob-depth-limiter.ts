// The DepthLimiter of Node.js v26.12.1 lib/internal/fs/glob.js (`maxDepth`, nodejs/node#64003), which internal/fs/glob loads for a finite `maxDepth` only.
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

// Not in Node's v26.12.1 text. What DepthFromRoot() and IsAncestorOfRoot() of Node's native walker (src/glob/glob_walker.cc, nodejs/node#65392) answer: the depth, `~k` for a directory `k` levels above the root, or UNPLACED when the characters do not settle it.
const depthFromRoot: (path: string, root: string, foldsCase: boolean) => number = isWindows
  ? $bindgen("node_path.bind.ts", "depthFromRootWin32")
  : $bindgen("node_path.bind.ts", "depthFromRootPosix");
const UNPLACED = -0x80000000;

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

function relativePathOfCandidate(candidate: RelativeCandidate, isSamePath: boolean) {
  return isSamePath ? candidate.pathFromRoot : candidate.differentPath!;
}

type IdentityCache = Map<string, string | null | Promise<string | null>>;

class DepthLimiter {
  #root: string;
  #maxDepth: number;
  #relativeCache = new Map<string, string | Promise<string>>();
  // Not in Node's text, which has these two in the Cache of every walk. Only Windows and macOS read them.
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
    const promise = this.#isSamePathAsync(this.#root, candidate.caseVariantRoot).then(
      relativePathOfCandidate.bind(null, candidate),
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

  includes(path: string) {
    const depth = depthFromRoot(path, this.#root, isMacOS);
    if (depth === UNPLACED) {
      return pathDepth(this.#relativeFromRoot(path)) <= this.#maxDepth;
    }
    return (depth < 0 ? ~depth : depth) <= this.#maxDepth;
  }

  // Not in Node's text. For the async walk, which cannot await where it adds a match: `undefined` when only the file system can say, and the lookup has then started.
  includesNow(path: string) {
    const depth = depthFromRoot(path, this.#root, isMacOS);
    if (depth === UNPLACED) {
      const relativePath = this.#relativeFromRootAsync(path);
      return typeof relativePath === "string" ? pathDepth(relativePath) <= this.#maxDepth : undefined;
    }
    return (depth < 0 ? ~depth : depth) <= this.#maxDepth;
  }

  async includesAsync(path: string) {
    return pathDepth(await this.#relativeFromRootAsync(path)) <= this.#maxDepth;
  }

  canTraverse(path: string, isAbsolutePattern: boolean) {
    const depth = depthFromRoot(path, this.#root, isMacOS);
    if (depth === UNPLACED) {
      return (
        (isAbsolutePattern && this.#isAncestorOfRoot(path)) || pathDepth(this.#relativeFromRoot(path)) < this.#maxDepth
      );
    }
    return depth >= 0 ? depth < this.#maxDepth : isAbsolutePattern || ~depth < this.#maxDepth;
  }

  async canTraverseAsync(path: string, isAbsolutePattern: boolean) {
    const depth = depthFromRoot(path, this.#root, isMacOS);
    if (depth === UNPLACED) {
      return (
        (isAbsolutePattern && (await this.#isAncestorOfRootAsync(path))) ||
        pathDepth(await this.#relativeFromRootAsync(path)) < this.#maxDepth
      );
    }
    return depth >= 0 ? depth < this.#maxDepth : isAbsolutePattern || ~depth < this.#maxDepth;
  }
}

export default { DepthLimiter };
