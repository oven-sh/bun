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

// prettier-ignore
const enum Char {
  DOT = 46,            // .
  FORWARD_SLASH = 47,  // /
  COLON = 58,          // :
  BACKWARD_SLASH = 92, // \
}

// What plainDepth() gives when the names of a path do not say its depth.
const enum Unplaced {
  // The path has a root or a drive. Its text can still start with the root of the limiter.
  ROOTED = -1,
  // The path has a ".." segment.
  PARENT = -2,
}

// Not in Node's v26.12.1 text: PlainDepth() of Node's native walker (https://github.com/nodejs/node/blob/95f3cf072e83d94ac90616c86a370b250f44a8d7/src/glob/glob_walker.cc#L1063-L1073). The count of the names of `path` from `start`, or an `Unplaced` value when they do not say where the path is.
function plainDepth(path: string, start: number) {
  const length = path.length;
  const first = path.$charCodeAt(start);
  if (first === Char.FORWARD_SLASH || (isWindows && first === Char.BACKWARD_SLASH)) {
    return Unplaced.ROOTED;
  }
  let depth = 0;
  let i = start;
  for (;;) {
    while (i < length) {
      const code = path.$charCodeAt(i);
      if (code === Char.FORWARD_SLASH || (isWindows && code === Char.BACKWARD_SLASH)) {
        break;
      }
      // path.win32 reads a drive in a path with ":", and the names do not say where that is: resolve(root, "x:y") is on drive x, "C:" is the root itself, and relative() gives "C:\\a" for ".\\C:\\a", which pathDepth() takes for an absolute path.
      if (isWindows && code === Char.COLON) {
        return Unplaced.ROOTED;
      }
      i++;
    }
    // The segment from `start` to `i`. An empty one and "." are not names.
    const size = i - start;
    if (size > 2 || (size !== 0 && path.$charCodeAt(start) !== Char.DOT)) {
      depth++;
    } else if (size === 2) {
      if (path.$charCodeAt(start + 1) === Char.DOT) {
        return Unplaced.PARENT;
      }
      depth++;
    }
    if (i >= length) {
      return depth;
    }
    start = ++i;
  }
}

// Not in Node's text. Whether `path` is `dir`, a separator and one name, which is how join() writes an entry of `dir`.
function isNameIn(path: string, dir: string) {
  const at = dir.length;
  if (at === 0 || path.length <= at || !path.$endsWith(dir, at)) {
    return false;
  }
  const code = path.$charCodeAt(at);
  return (code === Char.FORWARD_SLASH || (isWindows && code === Char.BACKWARD_SLASH)) && plainDepth(path, at + 1) === 1;
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

function relativePathOfCandidate(candidate: RelativeCandidate, isSamePath: boolean) {
  return isSamePath ? candidate.pathFromRoot : candidate.differentPath!;
}

type IdentityCache = Map<string, string | null | Promise<string | null>>;

class DepthLimiter {
  #root: string;
  #maxDepth: number;
  // Not in Node's text. #root with a separator at its end: resolve() leaves one at the root of a volume only.
  #rootPrefix: string;
  // Not in Node's text. The directory that canTraverse() last allowed by its depth. A name in it is one level deeper at most, so it is within the limit.
  #open: string | undefined = undefined;
  #relativeCache = new Map<string, string | Promise<string>>();
  // Not in Node's text, which has these two in the Cache of every walk. Only Windows and macOS read them.
  #identityCache: IdentityCache | undefined;
  #identityRealpathCache: IdentityCache | undefined;

  constructor(root: string, maxDepth: number) {
    this.#root = resolve(root);
    this.#rootPrefix = this.#root.$endsWith(sep) ? this.#root : this.#root + sep;
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

  // Not in Node's text, which asks resolve() and relative() about every path. The depth of a path that its text puts at or below the root: the path as it is, or what follows the root as #root spells it. An `Unplaced` value for any other path.
  #plainDepth(path: string) {
    const plain = plainDepth(path, 0);
    if (plain !== Unplaced.ROOTED) {
      return plain;
    }
    const prefix = this.#rootPrefix;
    return path.$endsWith(prefix, prefix.length) ? plainDepth(path, prefix.length) : plain;
  }

  #depth(path: string) {
    const plain = this.#plainDepth(path);
    return plain < 0 ? pathDepth(this.#relativeFromRoot(path)) : plain;
  }

  includes(path: string) {
    const open = this.#open;
    return (open !== undefined && isNameIn(path, open)) || this.#depth(path) <= this.#maxDepth;
  }

  // Not in Node's text. For the async walk, which cannot await where it adds a match: `undefined` when only the file system can say, and the lookup has then started.
  includesNow(path: string) {
    const open = this.#open;
    if (open !== undefined && isNameIn(path, open)) {
      return true;
    }
    const plain = this.#plainDepth(path);
    if (plain >= 0) {
      return plain <= this.#maxDepth;
    }
    const relativePath = this.#relativeFromRootAsync(path);
    return typeof relativePath === "string" ? pathDepth(relativePath) <= this.#maxDepth : undefined;
  }

  async includesAsync(path: string) {
    return pathDepth(await this.#relativeFromRootAsync(path)) <= this.#maxDepth;
  }

  canTraverse(path: string, isAbsolutePattern: boolean) {
    const plain = this.#plainDepth(path);
    if (plain < 0) {
      if (isAbsolutePattern && this.#isAncestorOfRoot(path)) {
        return true;
      }
      if (pathDepth(this.#relativeFromRoot(path)) >= this.#maxDepth) {
        return false;
      }
      // Windows and macOS ask the file system about a path that can be the root in another spelling, in the order of Node's text. A name in this directory can be such a path, so there the directory is not remembered.
      if (isWindows || isMacOS) {
        return true;
      }
    } else if (plain >= this.#maxDepth) {
      return false;
    }
    this.#open = path;
    return true;
  }

  async canTraverseAsync(path: string, isAbsolutePattern: boolean) {
    const plain = this.#plainDepth(path);
    if (plain >= 0) {
      if (plain >= this.#maxDepth) {
        return false;
      }
      this.#open = path;
      return true;
    }
    return (
      (isAbsolutePattern && (await this.#isAncestorOfRootAsync(path))) ||
      pathDepth(await this.#relativeFromRootAsync(path)) < this.#maxDepth
    );
  }
}

export default { DepthLimiter };
