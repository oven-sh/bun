// @ts-nocheck
//
// Port of Node.js lib/internal/fs/glob.js (v26.3.0):
//   https://github.com/nodejs/node/blob/50c35fea9e64d50ab3bb5f359e8523de89d6c798/lib/internal/fs/glob.js
// backed by the vendored minimatch in internal/fs/minimatch, which createMatcher() loads on demand.
//
// This is not backed by Bun.Glob: the vendored test-fs-glob.mjs (448 cases)
// exercises minimatch-specific semantics — withFileTypes Dirents, the
// exclude-array matching rules, symlink-walking and dotfile rules — that
// Bun.Glob.scan does not implement (328/448 fail with the Bun.Glob-backed
// version on main). Replace this with Bun.Glob once those gaps are closed
// natively.
const { validateObject, validateString, validateBoolean, validateArray } = require("internal/validators");
const { join, resolve, basename, dirname, isAbsolute } = require("node:path");
const { kEmptyObject } = require("internal/shared");

const isWindows = process.platform === "win32";
const isMacOS = process.platform === "darwin";

// node:fs and node:fs/promises cannot be required at module scope:
// node:fs/promises requires this module at its top level.
let _fs;
function lazyFs() {
  return (_fs ??= require("node:fs"));
}
let _fsPromises;
function lazyFsPromises() {
  return (_fsPromises ??= require("node:fs/promises"));
}

function compareDirentName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
function identity(v) {
  return v;
}
function nullOnReject() {
  return null;
}
function emptyArrayOnReject() {
  return [];
}
function excludeNothing(_path) {
  return false;
}
function makeMatchersExclude(matchers) {
  return function isExcludedByMatchers(value) {
    for (const matcher of matchers) {
      if (matcher.match(value)) return true;
    }
    return false;
  };
}
function statForFileTypes(cache, root, path) {
  return cache.statSync(isAbsolute(path) ? path : join(root, path));
}

const kStats = Symbol("stats");
let _DirentFromStats: any;
function lazyDirentFromStats() {
  if (_DirentFromStats === undefined) {
    const { Dirent } = lazyFs();
    class DirentFromStats extends Dirent {
      constructor(name, stats, path) {
        super(name, null, path);
        this[kStats] = stats;
      }
    }
    for (const key of [
      "isBlockDevice",
      "isCharacterDevice",
      "isDirectory",
      "isFIFO",
      "isFile",
      "isSocket",
      "isSymbolicLink",
    ]) {
      DirentFromStats.prototype[key] = function () {
        return this[kStats][key]();
      };
    }
    _DirentFromStats = DirentFromStats;
  }
  return _DirentFromStats;
}

function toPathIfFileURL(url) {
  if (url == null || typeof url === "string") {
    return url;
  }
  if (
    url instanceof URL ||
    (typeof url === "object" && typeof url.href === "string" && typeof url.protocol === "string")
  ) {
    return Bun.fileURLToPath(url);
  }
  return url;
}

async function getDirent(path) {
  let stat;
  try {
    stat = await lazyFsPromises().lstat(path);
  } catch {
    return null;
  }
  const DirentFromStats = lazyDirentFromStats();
  return new DirentFromStats(basename(path), stat, dirname(path));
}

function sortDirents(dirents) {
  return dirents.sort(compareDirentName);
}

function getDirentSync(path) {
  let stat;
  try {
    stat = lazyFs().lstatSync(path);
  } catch {
    return null;
  }
  const DirentFromStats = lazyDirentFromStats();
  return new DirentFromStats(basename(path), stat, dirname(path));
}

function validateStringArrayOrFunction(value, name) {
  if ($isArray(value)) {
    for (let i = 0; i < value.length; ++i) {
      if (typeof value[i] !== "string") {
        throw $ERR_INVALID_ARG_TYPE(`${name}[${i}]`, "string", value[i]);
      }
    }
    return;
  }
  if (typeof value !== "function") {
    throw $ERR_INVALID_ARG_TYPE(name, ["string[]", "function"], value);
  }
}

function validateStringArray(value, name) {
  validateArray(value, name);
  for (let i = 0; i < value.length; ++i) {
    validateString(value[i], `${name}[${i}]`);
  }
}

let _minimatch;
function lazyMinimatch() {
  return (_minimatch ??= require("internal/fs/minimatch"));
}
function isMinimatchLoaded() {
  return _minimatch !== undefined;
}

const nocase = isWindows || isMacOS;

function createMatcher(pattern, options = kEmptyObject) {
  const opts = {
    __proto__: null,
    nocase,
    windowsPathsNoEscape: true,
    nonegate: true,
    nocomment: true,
    optimizationLevel: 2,
    platform: process.platform,
    nocaseMagicOnly: true,
    ...options,
  };
  return new (lazyMinimatch().Minimatch)(pattern, opts);
}

// "**" compiles to a symbol (minimatch's GLOBSTAR, or kGlobstar). No other compiled segment is one.
const kGlobstar = Symbol("globstar **");
function isGlobstar(part) {
  return typeof part === "symbol";
}

// The tests that minimatch installs on "*", "*<suffix>", "*.*" and ".*" in place of a RegExp.
function starTest(name) {
  return name.length !== 0 && !name.startsWith(".");
}
function starSuffixTest(suffix, name) {
  return !name.startsWith(".") && name.endsWith(suffix);
}
function starSuffixTestNocase(lowerCaseSuffix, name) {
  return !name.startsWith(".") && name.toLowerCase().endsWith(lowerCaseSuffix);
}
function starDotStarTest(name) {
  return !name.startsWith(".") && name.includes(".");
}
function dotStarTest(name) {
  return name !== "." && name !== ".." && name.startsWith(".");
}
const kStarPart = { __proto__: null, test: starTest };
const kStarDotStarPart = { __proto__: null, test: starDotStarTest };
const kDotStarPart = { __proto__: null, test: dotStarTest };

function isAllStars(segment, from) {
  for (let i = from; i < segment.length; i++) {
    if (segment.charCodeAt(i) !== 42 /* * */) return false;
  }
  return from < segment.length;
}

// Returns undefined when minimatch has to compile the segment.
function compilePlainSegment(segment) {
  const star = segment.indexOf("*");
  if (star === -1) {
    return segment;
  }
  if (star === 0) {
    let suffixStart = 1;
    while (segment.charCodeAt(suffixStart) === 42 /* * */) suffixStart++;
    if (suffixStart === segment.length) {
      return kStarPart;
    }
    const suffix = segment.slice(suffixStart);
    if (!suffix.includes("*")) {
      // minimatch's starDotExtRE also refuses these in the suffix.
      if (suffix.includes("+") || suffix.includes("@") || suffix.includes("!")) {
        return undefined;
      }
      return {
        __proto__: null,
        test: nocase ? starSuffixTestNocase.bind(null, suffix.toLowerCase()) : starSuffixTest.bind(null, suffix),
      };
    }
    return suffix.charCodeAt(0) === 46 /* . */ && isAllStars(suffix, 1) ? kStarDotStarPart : undefined;
  }
  return star === 1 && segment.charCodeAt(0) === 46 /* . */ && isAllStars(segment, 1) ? kDotStarPart : undefined;
}

// Returns the set and globParts that createMatcher(pattern) has, or undefined when minimatch has to compile it.
function compilePlainPattern(pattern) {
  const length = pattern.length;
  // minimatch ignores an empty pattern and throws on one this long.
  if (length === 0 || length > 65536) {
    return undefined;
  }
  for (let i = 0; i < length; i++) {
    switch (pattern.charCodeAt(i)) {
      case 92: // \ is a path separator (windowsPathsNoEscape)
      case 123: // { brace expansion
      case 91: // [ character class
      case 40: // ( extglob
      case 63: // ?
        return undefined;
      case 58: // : a drive letter
        if (isWindows) return undefined;
    }
  }
  const globParts = pattern.split("/");
  const set = [];
  for (let i = 0; i < globParts.length; i++) {
    const segment = globParts[i];
    // minimatch drops or resolves "", "." and ".." segments, and merges a run of "**".
    if (segment === "" || segment === "." || segment === "..") {
      return undefined;
    }
    if (segment === "**") {
      if (i !== 0 && globParts[i - 1] === "**") {
        return undefined;
      }
      set.push(kGlobstar);
      continue;
    }
    const part = compilePlainSegment(segment);
    if (part === undefined) {
      return undefined;
    }
    set.push(part);
  }
  return { __proto__: null, set: [set], globParts: [globParts] };
}

function cloneSet(values) {
  const cloned = new Set();
  for (const value of values) {
    cloned.add(value);
  }
  return cloned;
}

class Cache {
  #cache = new Map();
  #statsCache = new Map();
  #followStatsCache = new Map();
  #readdirCache = new Map();
  #realpathCache = new Map();

  stat(path) {
    const cached = this.#statsCache.get(path);
    if (cached) {
      return cached;
    }
    const promise = getDirent(path);
    this.#statsCache.set(path, promise);
    return promise;
  }
  statSync(path) {
    const cached = this.#statsCache.get(path);
    // Do not return a promise from a sync function.
    if (cached && !(cached instanceof Promise)) {
      return cached;
    }
    const val = getDirentSync(path);
    this.#statsCache.set(path, val);
    return val;
  }
  followStat(path) {
    const cached = this.#followStatsCache.get(path);
    if (cached) {
      return cached;
    }
    const promise = lazyFsPromises().stat(path).then(identity, nullOnReject);
    this.#followStatsCache.set(path, promise);
    return promise;
  }
  followStatSync(path) {
    const cached = this.#followStatsCache.get(path);
    if (cached && !(cached instanceof Promise)) {
      return cached;
    }
    let val;
    try {
      val = lazyFs().statSync(path);
    } catch {
      val = null;
    }
    this.#followStatsCache.set(path, val);
    return val;
  }
  realpath(path) {
    const cached = this.#realpathCache.get(path);
    if (cached) {
      return cached;
    }
    const promise = lazyFsPromises().realpath(path).then(identity, nullOnReject);
    this.#realpathCache.set(path, promise);
    return promise;
  }
  realpathSync(path) {
    const cached = this.#realpathCache.get(path);
    if (cached && !(cached instanceof Promise)) {
      return cached;
    }
    let val;
    try {
      val = lazyFs().realpathSync(path);
    } catch {
      val = null;
    }
    this.#realpathCache.set(path, val);
    return val;
  }
  addToStatCache(path, val) {
    this.#statsCache.set(path, val);
  }
  async readdir(path) {
    const cached = this.#readdirCache.get(path);
    if (cached) {
      return cached;
    }
    const promise = lazyFsPromises().readdir(path, { __proto__: null, withFileTypes: true }).then(
      // The traversal bookkeeping (the seen-cache and the "**/.." queueing)
      // is sensitive to the order directory entries are visited in; some
      // orders make it drop results (reproducible in node itself by feeding
      // it the same order). Sort entries so traversal is deterministic and
      // matches the orders the upstream algorithm is known to handle.
      sortDirents,
      emptyArrayOnReject,
    );
    this.#readdirCache.set(path, promise);
    return promise;
  }
  readdirSync(path) {
    const cached = this.#readdirCache.get(path);
    if (cached) {
      return cached;
    }
    let val;
    try {
      // Sorted for deterministic traversal; see the comment in readdir().
      val = sortDirents(lazyFs().readdirSync(path, { __proto__: null, withFileTypes: true }));
    } catch {
      val = [];
    }
    this.#readdirCache.set(path, val);
    return val;
  }
  add(path, pattern) {
    let cache = this.#cache.get(path);
    if (!cache) {
      cache = new Set();
      this.#cache.set(path, cache);
    }
    const originalSize = cache.size;
    for (const index of pattern.indexes) {
      cache.add(pattern.cacheKey(index));
    }
    return cache.size !== originalSize + pattern.indexes.size;
  }
  seen(path, pattern, index) {
    return this.#cache.get(path)?.has(pattern.cacheKey(index));
  }
}

class Pattern {
  #pattern;
  #globStrings;
  indexes;
  symlinks;
  realpaths;
  last;

  constructor(pattern, globStrings, indexes, symlinks, realpaths = new Set()) {
    this.#pattern = pattern;
    this.#globStrings = globStrings;
    this.indexes = indexes;
    this.symlinks = symlinks;
    this.realpaths = realpaths;
    this.last = pattern.length - 1;
  }

  isLast(isDirectory) {
    return (
      this.indexes.has(this.last) ||
      (this.at(-1) === "" && isDirectory && this.indexes.has(this.last - 1) && isGlobstar(this.at(-2)))
    );
  }
  isFirst() {
    return this.indexes.has(0);
  }
  get hasSeenSymlinks() {
    for (const i of this.indexes) {
      if (!this.symlinks.has(i)) return true;
    }
    return false;
  }
  at(index) {
    return this.#pattern.at(index);
  }
  child(indexes, symlinks = new Set(), realpaths = this.realpaths) {
    return new Pattern(this.#pattern, this.#globStrings, indexes, symlinks, realpaths);
  }
  test(index, path) {
    if (index > this.#pattern.length) {
      return false;
    }
    const pattern = this.#pattern[index];
    if (isGlobstar(pattern)) {
      return true;
    }
    if (typeof pattern === "string") {
      return pattern === path;
    }
    if (typeof pattern?.test === "function") {
      return pattern.test(path);
    }
    return false;
  }

  cacheKey(index) {
    let key = "";
    for (let i = index; i < this.#globStrings.length; i++) {
      key += this.#globStrings[i];
      if (i !== this.#globStrings.length - 1) {
        key += "/";
      }
    }
    return key;
  }
}

class ResultSet extends Set {
  #root = ".";
  #isExcluded = excludeNothing;

  setup(root, isExcludedFn) {
    this.#root = root;
    this.#isExcluded = isExcludedFn;
  }

  add(value): any {
    if (this.#isExcluded(resolve(this.#root, value))) {
      return false;
    }
    super.add(value);
    return true;
  }
}

class Glob {
  #root;
  #exclude;
  #cache = new Cache();
  #results = new ResultSet();
  #queue: Array<{ path: string; patterns: Pattern[] }> = [];
  #subpatterns = new Map();
  #patterns;
  #withFileTypes;
  #followSymlinks = false;
  #isExcluded = excludeNothing;
  matchers;
  constructor(pattern, options = kEmptyObject) {
    validateObject(options, "options");
    const { exclude, cwd, followSymlinks, withFileTypes } = options;
    this.#root = toPathIfFileURL(cwd) ?? process.cwd();
    if (followSymlinks != null) {
      validateBoolean(followSymlinks, "options.followSymlinks");
      this.#followSymlinks = followSymlinks;
    }
    this.#withFileTypes = !!withFileTypes;
    if (exclude != null) {
      validateStringArrayOrFunction(exclude, "options.exclude");
      if ($isArray(exclude)) {
        // Convert the path part of exclude patterns to absolute paths for
        // consistent comparison before instantiating matchers.
        const matchers = [];
        for (const pat of exclude) {
          matchers.push(createMatcher(resolve(this.#root, pat)));
        }
        this.#isExcluded = makeMatchersExclude(matchers);
        this.#results.setup(this.#root, this.#isExcluded);
      } else {
        this.#exclude = exclude;
      }
    }
    let patterns;
    if (typeof pattern === "object") {
      validateStringArray(pattern, "patterns");
      patterns = pattern;
    } else {
      validateString(pattern, "patterns");
      patterns = [pattern];
    }
    this.matchers = [];
    this.#patterns = [];
    for (const pat of patterns) {
      const matcher = compilePlainPattern(pat) ?? createMatcher(pat);
      this.matchers.push(matcher);
      for (let i = 0; i < matcher.set.length; i++) {
        this.#patterns.push(new Pattern(matcher.set[i], matcher.globParts[i], new Set().add(0), new Set()));
      }
    }
  }

  globSync() {
    this.#queue.push({ __proto__: null, path: ".", patterns: this.#patterns });
    while (this.#queue.length > 0) {
      const item = this.#queue.pop()!;
      for (let i = 0; i < item.patterns.length; i++) {
        this.#addSubpatterns(item.path, item.patterns[i]);
      }
      for (const [path, patterns] of this.#subpatterns) {
        this.#queue.push({ __proto__: null, path, patterns });
      }
      this.#subpatterns.clear();
    }
    return Array.from(
      this.#results,
      this.#withFileTypes ? statForFileTypes.bind(null, this.#cache, this.#root) : undefined,
    );
  }
  #isDirectorySync(path, stat, pattern) {
    if (stat?.isDirectory()) {
      return true;
    }
    if (!stat?.isSymbolicLink()) {
      return false;
    }
    if (this.#followSymlinks) {
      return !!this.#cache.followStatSync(path)?.isDirectory();
    }
    return pattern.hasSeenSymlinks;
  }
  async #isDirectory(path, stat, pattern) {
    if (stat?.isDirectory()) {
      return true;
    }
    if (!stat?.isSymbolicLink()) {
      return false;
    }
    if (this.#followSymlinks) {
      return !!(await this.#cache.followStat(path))?.isDirectory();
    }
    return pattern.hasSeenSymlinks;
  }
  #nextRealpathsSync(path, isDirectory, pattern) {
    if (!this.#followSymlinks || !isDirectory) {
      return pattern.realpaths;
    }
    const real = this.#cache.realpathSync(path);
    if (real === null) {
      return pattern.realpaths;
    }
    const realpaths = cloneSet(pattern.realpaths);
    realpaths.add(real);
    return realpaths;
  }
  async #nextRealpaths(path, isDirectory, pattern) {
    if (!this.#followSymlinks || !isDirectory) {
      return pattern.realpaths;
    }
    const real = await this.#cache.realpath(path);
    if (real === null) {
      return pattern.realpaths;
    }
    const realpaths = cloneSet(pattern.realpaths);
    realpaths.add(real);
    return realpaths;
  }
  async #isCyclic(path, isDirectory, pattern) {
    if (!this.#followSymlinks || !isDirectory) {
      return false;
    }
    const real = await this.#cache.realpath(path);
    return real !== null && pattern.realpaths.has(real);
  }
  #isCyclicSync(path, isDirectory, pattern) {
    if (!this.#followSymlinks || !isDirectory) {
      return false;
    }
    const real = this.#cache.realpathSync(path);
    return real !== null && pattern.realpaths.has(real);
  }
  #addSubpattern(path, pattern) {
    if (this.#isExcluded(path)) {
      return;
    }
    const fullpath = resolve(this.#root, path);

    // If path is a directory, add trailing slash and test patterns again.
    if (this.#isExcluded(`${fullpath}/`) && this.#cache.statSync(fullpath).isDirectory()) {
      return;
    }

    if (this.#exclude) {
      if (this.#withFileTypes) {
        // Key by absolute path: the stat cache is populated with entry
        // fullpaths, and a relative lstat would resolve against
        // process.cwd() instead of options.cwd (upstream passes `path`
        // here, which silently skips the exclude callback when cwd
        // differs).
        const stat = this.#cache.statSync(fullpath);
        if (stat !== null) {
          if (this.#exclude(stat)) {
            return;
          }
        }
      } else if (this.#exclude(path)) {
        return;
      }
    }
    if (!this.#subpatterns.has(path)) {
      this.#subpatterns.set(path, [pattern]);
    } else {
      this.#subpatterns.get(path).push(pattern);
    }
  }
  #addSubpatterns(path, pattern) {
    const seen = this.#cache.add(path, pattern);
    if (seen) {
      return;
    }
    const fullpath = resolve(this.#root, path);
    const stat = this.#cache.statSync(fullpath);
    const last = pattern.last;
    const isDirectory = this.#isDirectorySync(fullpath, stat, pattern);
    const isLast = pattern.isLast(isDirectory);
    const isFirst = pattern.isFirst();

    if (this.#isExcluded(fullpath)) {
      return;
    }
    if (isFirst && isWindows && typeof pattern.at(0) === "string" && pattern.at(0).endsWith(":")) {
      // Absolute path, go to root
      this.#addSubpattern(`${pattern.at(0)}\\`, pattern.child(new Set().add(1)));
      return;
    }
    if (isFirst && pattern.at(0) === "") {
      // Absolute path, go to root
      this.#addSubpattern("/", pattern.child(new Set().add(1)));
      return;
    }
    if (isFirst && pattern.at(0) === "..") {
      // Start with .., go to parent
      this.#addSubpattern("../", pattern.child(new Set().add(1)));
      return;
    }
    if (isFirst && pattern.at(0) === ".") {
      // Start with ., proceed
      this.#addSubpattern(".", pattern.child(new Set().add(1)));
      return;
    }

    if (isLast && typeof pattern.at(-1) === "string") {
      // Add result if it exists
      const p = pattern.at(-1);
      const stat = this.#cache.statSync(join(fullpath, p));
      if (stat && (p || isDirectory)) {
        this.#results.add(join(path, p));
      }
      if (pattern.indexes.size === 1 && pattern.indexes.has(last)) {
        return;
      }
    } else if (
      isLast &&
      isGlobstar(pattern.at(-1)) &&
      (path !== "." || pattern.at(0) === "." || (last === 0 && stat))
    ) {
      // If pattern ends with **, add to results
      // if path is ".", add it only if pattern starts with "." or pattern is exactly "**"
      this.#results.add(path);
    }

    if (!isDirectory || this.#isCyclicSync(fullpath, isDirectory, pattern)) {
      return;
    }

    const nextRealpaths = this.#nextRealpathsSync(fullpath, isDirectory, pattern);

    let children;
    const firstPattern = pattern.indexes.size === 1 && pattern.at(pattern.indexes.values().next().value);
    if (typeof firstPattern === "string") {
      const stat = this.#cache.statSync(join(fullpath, firstPattern));
      if (stat) {
        setDirentName(stat, firstPattern);
        children = [stat];
      } else {
        return;
      }
    } else {
      children = this.#cache.readdirSync(fullpath);
    }

    for (let i = 0; i < children.length; i++) {
      const entry = children[i];
      const entryPath = join(path, entry.name);
      const entryFullpath = join(fullpath, entry.name);
      this.#cache.addToStatCache(entryFullpath, entry);
      const entryIsDirectory =
        entry.isDirectory() ||
        (this.#followSymlinks && entry.isSymbolicLink() && !!this.#cache.followStatSync(entryFullpath)?.isDirectory());

      const subPatterns = new Set();
      const nSymlinks = new Set();
      for (const index of pattern.indexes) {
        // For each child, check potential patterns
        if (this.#cache.seen(entryPath, pattern, index) || this.#cache.seen(entryPath, pattern, index + 1)) {
          return;
        }
        const current = pattern.at(index);
        const nextIndex = index + 1;
        const next = pattern.at(nextIndex);
        const fromSymlink = !this.#followSymlinks && pattern.symlinks.has(index);

        if (isGlobstar(current)) {
          const isDot = entry.name[0] === ".";
          const nextMatches = pattern.test(nextIndex, entry.name);

          let nextNonGlobIndex = nextIndex;
          while (isGlobstar(pattern.at(nextNonGlobIndex))) {
            nextNonGlobIndex++;
          }

          const matchesDot = isDot && pattern.test(nextNonGlobIndex, entry.name);

          if ((isDot && !matchesDot) || (this.#exclude && this.#exclude(this.#withFileTypes ? entry : entry.name))) {
            continue;
          }
          if (!fromSymlink && entryIsDirectory) {
            // If directory, add ** to its potential patterns
            subPatterns.add(index);
          } else if (!fromSymlink && index === last) {
            // If ** is last, add to results
            this.#results.add(entryPath);
          }

          // Any pattern after ** is also a potential pattern
          // so we can already test it here
          if (nextMatches && nextIndex === last && !isLast) {
            // If next pattern is the last one, add to results
            this.#results.add(entryPath);
          } else if (nextMatches && entryIsDirectory) {
            // Pattern matched, meaning two patterns forward
            // are also potential patterns
            // e.g **/b/c when entry is a/b - add c to potential patterns
            subPatterns.add(index + 2);
          }
          if ((nextMatches || pattern.at(0) === ".") && (entryIsDirectory || entry.isSymbolicLink()) && !fromSymlink) {
            // If pattern after ** matches, or pattern starts with "."
            // and entry is a directory or symlink, add to potential patterns
            subPatterns.add(nextIndex);
          }

          if (!this.#followSymlinks && entry.isSymbolicLink()) {
            nSymlinks.add(index);
          }

          if (next === ".." && entryIsDirectory) {
            // In case pattern is "**/..",
            // both parent and current directory should be added to the queue
            // if this is the last pattern, add to results instead
            const parent = join(path, "..");
            if (nextIndex < last) {
              if (!this.#subpatterns.has(path) && !this.#cache.seen(path, pattern, nextIndex + 1)) {
                this.#subpatterns.set(path, [pattern.child(new Set().add(nextIndex + 1))]);
              }
              if (!this.#subpatterns.has(parent) && !this.#cache.seen(parent, pattern, nextIndex + 1)) {
                this.#subpatterns.set(parent, [pattern.child(new Set().add(nextIndex + 1))]);
              }
            } else {
              if (!this.#cache.seen(path, pattern, nextIndex)) {
                this.#cache.add(path, pattern.child(new Set().add(nextIndex)));
                this.#results.add(path);
              }
              if (!this.#cache.seen(path, pattern, nextIndex) || !this.#cache.seen(parent, pattern, nextIndex)) {
                this.#cache.add(parent, pattern.child(new Set().add(nextIndex)));
                this.#results.add(parent);
              }
            }
          }
        }
        if (typeof current === "string") {
          if (pattern.test(index, entry.name) && index !== last) {
            // If current pattern matches entry name
            // the next pattern is a potential pattern
            subPatterns.add(nextIndex);
          } else if (current === "." && pattern.test(nextIndex, entry.name)) {
            // If current pattern is ".", proceed to test next pattern
            if (nextIndex === last) {
              this.#results.add(entryPath);
            } else {
              subPatterns.add(nextIndex + 1);
            }
          }
        }
        if (typeof current === "object" && pattern.test(index, entry.name)) {
          // If current pattern is a regex that matches entry name (e.g *.js)
          // add next pattern to potential patterns, or to results if it's the last pattern
          if (index === last) {
            this.#results.add(entryPath);
          } else if (entryIsDirectory) {
            subPatterns.add(nextIndex);
          }
        }
      }
      if (subPatterns.size > 0) {
        // If there are potential patterns, add to queue
        this.#addSubpattern(entryPath, pattern.child(subPatterns, nSymlinks, nextRealpaths));
      }
    }
  }

  async *glob() {
    this.#queue.push({ __proto__: null, path: ".", patterns: this.#patterns });
    while (this.#queue.length > 0) {
      const item = this.#queue.pop()!;
      for (let i = 0; i < item.patterns.length; i++) {
        yield* this.#iterateSubpatterns(item.path, item.patterns[i]);
      }
      for (const [path, patterns] of this.#subpatterns) {
        this.#queue.push({ __proto__: null, path, patterns });
      }
      this.#subpatterns.clear();
    }
  }
  async *#iterateSubpatterns(path, pattern) {
    const seen = this.#cache.add(path, pattern);
    if (seen) {
      return;
    }
    const fullpath = resolve(this.#root, path);
    const stat = await this.#cache.stat(fullpath);
    const last = pattern.last;
    const isDirectory = await this.#isDirectory(fullpath, stat, pattern);
    const isLast = pattern.isLast(isDirectory);
    const isFirst = pattern.isFirst();

    if (this.#isExcluded(fullpath)) {
      return;
    }
    if (isFirst && isWindows && typeof pattern.at(0) === "string" && pattern.at(0).endsWith(":")) {
      // Absolute path, go to root
      this.#addSubpattern(`${pattern.at(0)}\\`, pattern.child(new Set().add(1)));
      return;
    }
    if (isFirst && pattern.at(0) === "") {
      // Absolute path, go to root
      this.#addSubpattern("/", pattern.child(new Set().add(1)));
      return;
    }
    if (isFirst && pattern.at(0) === "..") {
      // Start with .., go to parent
      this.#addSubpattern("../", pattern.child(new Set().add(1)));
      return;
    }
    if (isFirst && pattern.at(0) === ".") {
      // Start with ., proceed
      this.#addSubpattern(".", pattern.child(new Set().add(1)));
      return;
    }

    if (isLast && typeof pattern.at(-1) === "string") {
      // Add result if it exists
      const p = pattern.at(-1);
      const stat = await this.#cache.stat(join(fullpath, p));
      if (stat && (p || isDirectory)) {
        const result = join(path, p);
        if (!this.#results.has(result)) {
          if (this.#results.add(result)) {
            yield this.#withFileTypes ? stat : result;
          }
        }
      }
      if (pattern.indexes.size === 1 && pattern.indexes.has(last)) {
        return;
      }
    } else if (
      isLast &&
      isGlobstar(pattern.at(-1)) &&
      (path !== "." || pattern.at(0) === "." || (last === 0 && stat))
    ) {
      // If pattern ends with **, add to results
      // if path is ".", add it only if pattern starts with "." or pattern is exactly "**"
      if (!this.#results.has(path)) {
        if (this.#results.add(path)) {
          yield this.#withFileTypes ? stat : path;
        }
      }
    }

    if (!isDirectory || (await this.#isCyclic(fullpath, isDirectory, pattern))) {
      return;
    }

    const nextRealpaths = await this.#nextRealpaths(fullpath, isDirectory, pattern);

    let children;
    const firstPattern = pattern.indexes.size === 1 && pattern.at(pattern.indexes.values().next().value);
    if (typeof firstPattern === "string") {
      const stat = await this.#cache.stat(join(fullpath, firstPattern));
      if (stat) {
        setDirentName(stat, firstPattern);
        children = [stat];
      } else {
        return;
      }
    } else {
      children = await this.#cache.readdir(fullpath);
    }

    for (let i = 0; i < children.length; i++) {
      const entry = children[i];
      const entryPath = join(path, entry.name);
      const entryFullpath = join(fullpath, entry.name);
      this.#cache.addToStatCache(entryFullpath, entry);
      const entryIsDirectory =
        entry.isDirectory() ||
        (this.#followSymlinks &&
          entry.isSymbolicLink() &&
          !!(await this.#cache.followStat(entryFullpath))?.isDirectory());

      const subPatterns = new Set();
      const nSymlinks = new Set();
      for (const index of pattern.indexes) {
        // For each child, check potential patterns
        if (this.#cache.seen(entryPath, pattern, index) || this.#cache.seen(entryPath, pattern, index + 1)) {
          return;
        }
        const current = pattern.at(index);
        const nextIndex = index + 1;
        const next = pattern.at(nextIndex);
        const fromSymlink = !this.#followSymlinks && pattern.symlinks.has(index);

        if (isGlobstar(current)) {
          const isDot = entry.name[0] === ".";
          const nextMatches = pattern.test(nextIndex, entry.name);

          let nextNonGlobIndex = nextIndex;
          while (isGlobstar(pattern.at(nextNonGlobIndex))) {
            nextNonGlobIndex++;
          }

          const matchesDot = isDot && pattern.test(nextNonGlobIndex, entry.name);

          if ((isDot && !matchesDot) || (this.#exclude && this.#exclude(this.#withFileTypes ? entry : entry.name))) {
            continue;
          }
          if (!fromSymlink && entryIsDirectory) {
            // If directory, add ** to its potential patterns
            subPatterns.add(index);
          } else if (!fromSymlink && index === last) {
            // If ** is last, add to results
            if (!this.#results.has(entryPath) && this.#results.add(entryPath)) {
              yield this.#withFileTypes ? entry : entryPath;
            }
          }

          // Any pattern after ** is also a potential pattern
          // so we can already test it here
          if (nextMatches && nextIndex === last && !isLast) {
            // If next pattern is the last one, add to results
            if (!this.#results.has(entryPath) && this.#results.add(entryPath)) {
              yield this.#withFileTypes ? entry : entryPath;
            }
          } else if (nextMatches && entryIsDirectory) {
            // Pattern matched, meaning two patterns forward
            // are also potential patterns
            // e.g **/b/c when entry is a/b - add c to potential patterns
            subPatterns.add(index + 2);
          }
          if ((nextMatches || pattern.at(0) === ".") && (entryIsDirectory || entry.isSymbolicLink()) && !fromSymlink) {
            // If pattern after ** matches, or pattern starts with "."
            // and entry is a directory or symlink, add to potential patterns
            subPatterns.add(nextIndex);
          }

          if (!this.#followSymlinks && entry.isSymbolicLink()) {
            nSymlinks.add(index);
          }

          if (next === ".." && entryIsDirectory) {
            // In case pattern is "**/..",
            // both parent and current directory should be added to the queue
            // if this is the last pattern, add to results instead
            const parent = join(path, "..");
            if (nextIndex < last) {
              if (!this.#subpatterns.has(path) && !this.#cache.seen(path, pattern, nextIndex + 1)) {
                this.#subpatterns.set(path, [pattern.child(new Set().add(nextIndex + 1))]);
              }
              if (!this.#subpatterns.has(parent) && !this.#cache.seen(parent, pattern, nextIndex + 1)) {
                this.#subpatterns.set(parent, [pattern.child(new Set().add(nextIndex + 1))]);
              }
            } else {
              if (!this.#cache.seen(path, pattern, nextIndex)) {
                this.#cache.add(path, pattern.child(new Set().add(nextIndex)));
                if (!this.#results.has(path)) {
                  if (this.#results.add(path)) {
                    yield this.#withFileTypes ? this.#cache.statSync(fullpath) : path;
                  }
                }
              }
              if (!this.#cache.seen(path, pattern, nextIndex) || !this.#cache.seen(parent, pattern, nextIndex)) {
                this.#cache.add(parent, pattern.child(new Set().add(nextIndex)));
                if (!this.#results.has(parent)) {
                  if (this.#results.add(parent)) {
                    yield this.#withFileTypes ? this.#cache.statSync(join(this.#root, parent)) : parent;
                  }
                }
              }
            }
          }
        }
        if (typeof current === "string") {
          if (pattern.test(index, entry.name) && index !== last) {
            // If current pattern matches entry name
            // the next pattern is a potential pattern
            subPatterns.add(nextIndex);
          } else if (current === "." && pattern.test(nextIndex, entry.name)) {
            // If current pattern is ".", proceed to test next pattern
            if (nextIndex === last) {
              if (!this.#results.has(entryPath)) {
                if (this.#results.add(entryPath)) {
                  yield this.#withFileTypes ? entry : entryPath;
                }
              }
            } else {
              subPatterns.add(nextIndex + 1);
            }
          }
        }
        if (typeof current === "object" && pattern.test(index, entry.name)) {
          // If current pattern is a regex that matches entry name (e.g *.js)
          // add next pattern to potential patterns, or to results if it's the last pattern
          if (index === last) {
            if (!this.#results.has(entryPath)) {
              if (this.#results.add(entryPath)) {
                yield this.#withFileTypes ? entry : entryPath;
              }
            }
          } else if (entryIsDirectory) {
            subPatterns.add(nextIndex);
          }
        }
      }
      if (subPatterns.size > 0) {
        // If there are potential patterns, add to queue
        this.#addSubpattern(entryPath, pattern.child(subPatterns, nSymlinks, nextRealpaths));
      }
    }
  }
}

// `name` may not be writable on native Dirent instances.
function setDirentName(dirent, name) {
  try {
    dirent.name = name;
  } catch {
    Object.defineProperty(dirent, "name", {
      value: name,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}

function glob(pattern, options) {
  return new Glob(pattern, options).glob();
}

function globSync(pattern, options) {
  return new Glob(pattern, options).globSync();
}

export default {
  glob,
  globSync,
  Glob,
  // For bun:internal-for-testing.
  compilePlainPattern,
  createMatcher,
  isMinimatchLoaded,
};
