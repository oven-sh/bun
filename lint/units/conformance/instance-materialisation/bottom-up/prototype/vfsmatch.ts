// Research prototype: port of internal/vfs/vfsmatch/vfsmatch.go, same names and order.
import type { MemFs } from "./memfs";
import { combinePaths, getDirectoryPath, isRootedDiskPath, normalizePath, removeTrailingDirectorySeparator } from "./tspath";
import {
  type ComparePathsOptions,
  containsPath,
  equalFold,
  fileExtensionIsOneOf,
  getCanonicalFileName,
  getComparer,
  getNormalizedPathComponents,
  hasExtension,
} from "./tspath_more";

export const enum Usage {
  Files,
  Directories,
  Exclude,
}

export const UnlimitedDepth = Number.MAX_SAFE_INTEGER;

export function readDirectory(host: MemFs, currentDir: string, path: string, extensions: string[], excludes: string[], includes: string[], depth: number): string[] {
  return matchFiles(path, extensions, excludes, includes, host.useCaseSensitiveFileNames, currentDir, depth, host);
}

export function isImplicitGlob(lastPathComponent: string): boolean {
  return !/[.*?]/.test(lastPathComponent);
}

function getIncludeBasePath(absolute: string): string {
  const wildcardOffset = absolute.search(/[*?]/);
  if (wildcardOffset < 0) {
    if (!hasExtension(absolute)) return absolute;
    return removeTrailingDirectorySeparator(getDirectoryPath(absolute));
  }
  return absolute.slice(0, Math.max(absolute.slice(0, wildcardOffset).lastIndexOf("/"), 0));
}

function getBasePaths(path: string, includes: string[], useCaseSensitiveFileNames: boolean): string[] {
  const basePaths = [path];
  if (includes.length > 0) {
    const comparePathsOptions: ComparePathsOptions = { currentDirectory: path, useCaseSensitiveFileNames };
    const stringComparer = getComparer(comparePathsOptions);
    const includeBasePaths: string[] = [];
    for (const include of includes) {
      const absolute = isRootedDiskPath(include) ? include : normalizePath(combinePaths(path, include));
      includeBasePaths.push(getIncludeBasePath(absolute));
    }
    // Array.prototype.sort is stable, as slices.SortStableFunc is
    includeBasePaths.sort(stringComparer);
    for (const includeBasePath of includeBasePaths) {
      if (basePaths.every(basepath => !containsPath(basepath, includeBasePath, comparePathsOptions))) {
        basePaths.push(includeBasePath);
      }
    }
  }
  return basePaths;
}

const enum ComponentKind {
  Literal,
  Wildcard,
  DoubleAsterisk,
}
const enum SegmentKind {
  Literal,
  Star,
  Question,
}
interface Segment {
  kind: SegmentKind;
  literal: string;
}
interface Component {
  kind: ComponentKind;
  literal: string;
  segments: Segment[];
  skipPackageFolders: boolean;
}
interface GlobPattern {
  components: Component[];
  isExclude: boolean;
  caseSensitive: boolean;
  excludeMinJs: boolean;
}

function compileGlobPattern(spec: string, basePath: string, usage: Usage, caseSensitive: boolean): GlobPattern | undefined {
  const parts = getNormalizedPathComponents(spec, basePath);
  if (usage !== Usage.Exclude && parts[parts.length - 1] === "**") return undefined;
  parts[0] = removeTrailingDirectorySeparator(parts[0]);
  if (isImplicitGlob(parts[parts.length - 1])) parts.push("**", "*");
  const p: GlobPattern = {
    isExclude: usage === Usage.Exclude,
    caseSensitive,
    excludeMinJs: usage === Usage.Files,
    components: [],
  };
  for (const part of parts) p.components.push(parseComponent(part, usage !== Usage.Exclude));
  return p;
}

function parseComponent(s: string, isInclude: boolean): Component {
  if (s === "**") return { kind: ComponentKind.DoubleAsterisk, literal: "", segments: [], skipPackageFolders: false };
  if (!/[*?]/.test(s)) return { kind: ComponentKind.Literal, literal: s, segments: [], skipPackageFolders: false };
  return { kind: ComponentKind.Wildcard, literal: "", segments: parseSegments(s), skipPackageFolders: isInclude };
}

function parseSegments(s: string): Segment[] {
  const result: Segment[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "*" || c === "?") {
      if (i > start) result.push({ kind: SegmentKind.Literal, literal: s.slice(start, i) });
      result.push({ kind: c === "*" ? SegmentKind.Star : SegmentKind.Question, literal: "" });
      start = i + 1;
    }
  }
  if (start < s.length) result.push({ kind: SegmentKind.Literal, literal: s.slice(start) });
  return result;
}

function stringsEqual(p: GlobPattern, a: string, b: string): boolean {
  return p.caseSensitive ? a === b : equalFold(a, b);
}

// The path is prefix + suffix; the Go code walks the two parts without joining them, the result is the same.
function matchPathParts(p: GlobPattern, path: string, pathOffset: number, compIdx: number, prefixOnly: boolean): boolean {
  for (;;) {
    const next = nextPathPart(path, pathOffset);
    if (next === undefined) {
      if (prefixOnly) return true;
      return patternSatisfied(p, compIdx);
    }
    const [pathPart, nextOffset] = next;
    if (compIdx >= p.components.length) return p.isExclude && !prefixOnly;
    const comp = p.components[compIdx];
    switch (comp.kind) {
      case ComponentKind.DoubleAsterisk:
        if (matchPathParts(p, path, pathOffset, compIdx + 1, prefixOnly)) return true;
        if (!p.isExclude && (isHiddenPath(pathPart) || isPackageFolder(pathPart))) return false;
        pathOffset = nextOffset;
        continue;
      case ComponentKind.Literal:
        if (!stringsEqual(p, comp.literal, pathPart)) return false;
        break;
      case ComponentKind.Wildcard:
        if (comp.skipPackageFolders && isPackageFolder(pathPart)) return false;
        if (!matchWildcard(p, comp.segments, pathPart)) return false;
        break;
    }
    pathOffset = nextOffset;
    compIdx++;
  }
}

function patternSatisfied(p: GlobPattern, compIdx: number): boolean {
  for (const c of p.components.slice(compIdx)) if (c.kind !== ComponentKind.DoubleAsterisk) return false;
  return true;
}

// nextPathPartSingle (vfsmatch.go:295)
function nextPathPart(s: string, offset: number): [string, number] | undefined {
  if (offset >= s.length) return undefined;
  if (offset === 0 && s.length > 0 && s[0] === "/") return ["", 1];
  while (offset < s.length && s[offset] === "/") offset++;
  if (offset >= s.length) return undefined;
  const idx = s.indexOf("/", offset);
  if (idx >= 0) return [s.slice(offset, idx), idx];
  return [s.slice(offset), s.length];
}

function matchWildcard(p: GlobPattern, segs: Segment[], s: string): boolean {
  if (!p.isExclude && segs.length > 0 && isHiddenPath(s) && (segs[0].kind === SegmentKind.Star || segs[0].kind === SegmentKind.Question)) {
    return false;
  }
  if (segs.length === 2 && segs[0].kind === SegmentKind.Star && segs[1].kind === SegmentKind.Literal) {
    const suffix = segs[1].literal;
    if (s.length < suffix.length || !stringsEqual(p, suffix, s.slice(s.length - suffix.length))) return false;
    return shouldIncludeMinJs(p, s, segs);
  }
  return matchSegments(p, segs, s) && shouldIncludeMinJs(p, s, segs);
}

// One step is one rune in Go; a code point here. A lone surrogate cannot occur in a decoded unit name.
function runeSize(s: string, i: number): number {
  const c = s.codePointAt(i)!;
  return c > 0xffff ? 2 : 1;
}

function matchSegments(p: GlobPattern, segs: Segment[], s: string): boolean {
  let segIdx = 0;
  let sIdx = 0;
  let starSegIdx = -1;
  let starSIdx = 0;
  while (sIdx < s.length) {
    if (segIdx < segs.length) {
      const seg = segs[segIdx];
      if (seg.kind === SegmentKind.Literal) {
        const end = sIdx + seg.literal.length;
        if (end <= s.length && stringsEqual(p, seg.literal, s.slice(sIdx, end))) {
          sIdx = end;
          segIdx++;
          continue;
        }
      } else if (seg.kind === SegmentKind.Question) {
        if (s[sIdx] !== "/") {
          sIdx += runeSize(s, sIdx);
          segIdx++;
          continue;
        }
      } else {
        starSegIdx = segIdx;
        starSIdx = sIdx;
        segIdx++;
        continue;
      }
    }
    if (starSegIdx >= 0 && starSIdx < s.length && s[starSIdx] !== "/") {
      starSIdx += runeSize(s, starSIdx);
      sIdx = starSIdx;
      segIdx = starSegIdx + 1;
      continue;
    }
    return false;
  }
  while (segIdx < segs.length && segs[segIdx].kind === SegmentKind.Star) segIdx++;
  return segIdx >= segs.length;
}

function shouldIncludeMinJs(p: GlobPattern, filename: string, segs: Segment[]): boolean {
  if (!p.excludeMinJs) return true;
  if (!hasMinJsSuffix(p, filename)) return true;
  if (patternMentionsMinSuffix(p, segs)) return true;
  return false;
}

function hasMinJsSuffix(p: GlobPattern, filename: string): boolean {
  if (p.caseSensitive) return filename.endsWith(".min.js");
  const minJs = ".min.js";
  if (filename.length < minJs.length) return false;
  return equalFold(filename.slice(filename.length - minJs.length), minJs);
}

function patternMentionsMinSuffix(p: GlobPattern, segs: Segment[]): boolean {
  for (const seg of segs) {
    if (seg.kind !== SegmentKind.Literal) continue;
    let lit = seg.literal;
    if (!p.caseSensitive) lit = lit.toLowerCase();
    if (lit.includes(".min.js") || lit.includes(".min.")) return true;
  }
  return false;
}

function isHiddenPath(name: string): boolean {
  return name.length > 0 && name[0] === ".";
}

// The three names are ASCII, so a name of the same byte length folds to one of them only when it is ASCII itself.
function isPackageFolder(name: string): boolean {
  switch (name.length) {
    case "node_modules".length:
      return equalFold(name, "node_modules");
    case "jspm_packages".length:
      return equalFold(name, "jspm_packages");
    case "bower_components".length:
      return equalFold(name, "bower_components");
  }
  return false;
}

function ensureTrailingSlash(s: string): string {
  return s.length > 0 && s[s.length - 1] !== "/" ? s + "/" : s;
}

interface GlobMatcher {
  includes: GlobPattern[];
  excludes: GlobPattern[];
  hadIncludes: boolean;
}

function newGlobMatcher(includeSpecs: string[], excludeSpecs: string[], basePath: string, caseSensitive: boolean, usage: Usage): GlobMatcher {
  const m: GlobMatcher = { hadIncludes: includeSpecs.length > 0, includes: [], excludes: [] };
  for (const spec of includeSpecs) {
    const p = compileGlobPattern(spec, basePath, usage, caseSensitive);
    if (p !== undefined) m.includes.push(p);
  }
  for (const spec of excludeSpecs) {
    const p = compileGlobPattern(spec, basePath, Usage.Exclude, caseSensitive);
    if (p !== undefined) m.excludes.push(p);
  }
  return m;
}

function matchesFileParts(m: GlobMatcher, prefix: string, suffix: string): number {
  const path = prefix + suffix;
  for (const e of m.excludes) if (matchPathParts(e, path, 0, 0, false)) return -1;
  if (m.includes.length === 0) return m.hadIncludes ? -1 : 0;
  for (let i = 0; i < m.includes.length; i++) if (matchPathParts(m.includes[i], path, 0, 0, false)) return i;
  return -1;
}

function matchesDirectoryParts(m: GlobMatcher, prefix: string, suffix: string): boolean {
  const path = prefix + suffix;
  for (const e of m.excludes) if (matchPathParts(e, path, 0, 0, false)) return false;
  if (m.includes.length === 0) return !m.hadIncludes;
  for (const i of m.includes) if (matchPathParts(i, path, 0, 0, true)) return true;
  return false;
}

interface GlobVisitor {
  host: MemFs;
  fileMatcher: GlobMatcher;
  directoryMatcher: GlobMatcher;
  extensions: string[];
  useCaseSensitiveFileNames: boolean;
  visited: Set<string>;
  results: string[][];
}

function visit(v: GlobVisitor, path: string, absolutePath: string, depth: number, resolvedRealPath: string, level: number): void {
  if (level > 512) return;
  const realPath = resolvedRealPath !== "" ? resolvedRealPath : v.host.realpath(absolutePath);
  const canonicalPath = getCanonicalFileName(realPath, v.useCaseSensitiveFileNames);
  if (v.visited.has(canonicalPath)) return;
  v.visited.add(canonicalPath);

  const entries = v.host.getAccessibleEntries(absolutePath);
  const pathPrefix = ensureTrailingSlash(path);
  const absPrefix = ensureTrailingSlash(absolutePath);

  for (const file of entries.files) {
    if (v.extensions.length > 0 && !fileExtensionIsOneOf(file, v.extensions)) continue;
    const idx = matchesFileParts(v.fileMatcher, absPrefix, file);
    if (idx >= 0) v.results[idx].push(pathPrefix + file);
  }

  if (depth !== UnlimitedDepth) {
    depth--;
    if (depth === 0) return;
  }

  for (const dir of entries.directories) {
    if (!matchesDirectoryParts(v.directoryMatcher, absPrefix, dir)) continue;
    const absDir = absPrefix + dir;
    let childRealPath = "";
    if (!entries.symlinks.has(dir)) childRealPath = combinePaths(realPath, dir);
    visit(v, pathPrefix + dir, absDir, depth, childRealPath, level + 1);
  }
}

export function matchFiles(path: string, extensions: string[], excludes: string[], includes: string[], useCaseSensitiveFileNames: boolean, currentDirectory: string, depth: number, host: MemFs): string[] {
  path = normalizePath(path);
  currentDirectory = normalizePath(currentDirectory);
  const absolutePath = combinePaths(currentDirectory, path);

  const fileMatcher = newGlobMatcher(includes, excludes, absolutePath, useCaseSensitiveFileNames, Usage.Files);
  const directoryMatcher = newGlobMatcher(includes, excludes, absolutePath, useCaseSensitiveFileNames, Usage.Directories);

  const results: string[][] = [];
  for (let i = 0; i < Math.max(fileMatcher.includes.length, 1); i++) results.push([]);
  const v: GlobVisitor = { host, fileMatcher, directoryMatcher, extensions, useCaseSensitiveFileNames, visited: new Set(), results };

  for (const basePath of getBasePaths(path, includes, useCaseSensitiveFileNames)) {
    visit(v, basePath, combinePaths(currentDirectory, basePath), depth, "", 0);
  }
  return results.flat();
}

export interface SpecMatcher {
  patterns: GlobPattern[];
}

export function newSpecMatcher(specs: string[], basePath: string, usage: Usage, useCaseSensitiveFileNames: boolean): SpecMatcher | undefined {
  if (specs.length === 0) return undefined;
  const patterns: GlobPattern[] = [];
  for (const spec of specs) {
    const p = compileGlobPattern(spec, basePath, usage, useCaseSensitiveFileNames);
    if (p !== undefined) patterns.push(p);
  }
  if (patterns.length === 0) return undefined;
  return { patterns };
}

export function matchIndex(m: SpecMatcher, path: string): number {
  for (let i = 0; i < m.patterns.length; i++) if (matchPathParts(m.patterns[i], path, 0, 0, false)) return i;
  return -1;
}
