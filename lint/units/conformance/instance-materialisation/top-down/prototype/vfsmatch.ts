// Prototype port of internal/vfs/vfsmatch/vfsmatch.go for a case sensitive file system.
import { combinePaths, getDirectoryPath, isRootedDiskPath, normalizePath, removeTrailingDirectorySeparator } from "../../../enumerator/prototype/tspath";
import { compareBytes, containsPath, fileExtensionIsOneOf, getNormalizedPathComponents, hasExtension } from "./tspath_more";
import type { MapFS } from "./vfs_model";

export type Usage = "files" | "directories" | "exclude";

// vfsmatch.go:38
export function isImplicitGlob(lastPathComponent: string): boolean {
  return !/[.*?]/.test(lastPathComponent);
}

// vfsmatch.go:44
function getIncludeBasePath(absolute: string): string {
  const wildcardOffset = absolute.search(/[*?]/);
  if (wildcardOffset < 0) {
    if (!hasExtension(absolute)) return absolute;
    return removeTrailingDirectorySeparator(getDirectoryPath(absolute));
  }
  return absolute.slice(0, Math.max(absolute.slice(0, wildcardOffset).lastIndexOf("/"), 0));
}

// vfsmatch.go:58
function getBasePaths(path: string, includes: string[]): string[] {
  const basePaths = [path];
  if (includes.length > 0) {
    const includeBasePaths: string[] = [];
    for (const include of includes) {
      const absolute = isRootedDiskPath(include) ? include : normalizePath(combinePaths(path, include));
      includeBasePaths.push(getIncludeBasePath(absolute));
    }
    // slices.SortStableFunc; Array.prototype.sort is stable
    includeBasePaths.sort(compareBytes);
    for (const includeBasePath of includeBasePaths) {
      if (basePaths.every(basepath => !containsPath(basepath, includeBasePath, path))) basePaths.push(includeBasePath);
    }
  }
  return basePaths;
}

type Segment = { kind: "literal"; literal: string } | { kind: "star" } | { kind: "question" };
type Component =
  | { kind: "literal"; literal: string }
  | { kind: "wildcard"; segments: Segment[]; skipPackageFolders: boolean }
  | { kind: "doubleAsterisk" };

interface GlobPattern {
  components: Component[];
  isExclude: boolean;
  excludeMinJs: boolean;
}

// vfsmatch.go:141
function compileGlobPattern(spec: string, basePath: string, usage: Usage): GlobPattern | undefined {
  const parts = getNormalizedPathComponents(spec, basePath);
  if (usage !== "exclude" && parts[parts.length - 1] === "**") return undefined;
  parts[0] = removeTrailingDirectorySeparator(parts[0]);
  if (isImplicitGlob(parts[parts.length - 1])) parts.push("**", "*");
  const p: GlobPattern = { isExclude: usage === "exclude", excludeMinJs: usage === "files", components: [] };
  for (const part of parts) p.components.push(parseComponent(part, usage !== "exclude"));
  return p;
}

// vfsmatch.go:172
function parseComponent(s: string, isInclude: boolean): Component {
  if (s === "**") return { kind: "doubleAsterisk" };
  if (!/[*?]/.test(s)) return { kind: "literal", literal: s };
  return { kind: "wildcard", segments: parseSegments(s), skipPackageFolders: isInclude };
}

// vfsmatch.go:187
function parseSegments(s: string): Segment[] {
  const result: Segment[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "*" || s[i] === "?") {
      if (i > start) result.push({ kind: "literal", literal: s.slice(start, i) });
      result.push(s[i] === "*" ? { kind: "star" } : { kind: "question" });
      start = i + 1;
    }
  }
  if (start < s.length) result.push({ kind: "literal", literal: s.slice(start) });
  return result;
}

// vfsmatch.go:295 on the joined string; the reference scans prefix and suffix without joining them
function nextPathPart(s: string, offset: number): { part: string; nextOffset: number; ok: boolean } {
  if (offset >= s.length) return { part: "", nextOffset: offset, ok: false };
  if (offset === 0 && s.length > 0 && s[0] === "/") return { part: "", nextOffset: 1, ok: true };
  while (offset < s.length && s[offset] === "/") offset++;
  if (offset >= s.length) return { part: "", nextOffset: offset, ok: false };
  const idx = s.indexOf("/", offset);
  if (idx >= 0) return { part: s.slice(offset, idx), nextOffset: idx, ok: true };
  return { part: s.slice(offset), nextOffset: s.length, ok: true };
}

// vfsmatch.go:236
function matchPath(p: GlobPattern, path: string, pathOffset: number, compIdx: number, prefixOnly: boolean): boolean {
  for (;;) {
    const { part: pathPart, nextOffset, ok } = nextPathPart(path, pathOffset);
    if (!ok) {
      if (prefixOnly) return true;
      return patternSatisfied(p, compIdx);
    }
    if (compIdx >= p.components.length) return p.isExclude && !prefixOnly;
    const comp = p.components[compIdx];
    switch (comp.kind) {
      case "doubleAsterisk":
        if (matchPath(p, path, pathOffset, compIdx + 1, prefixOnly)) return true;
        if (!p.isExclude && (isHiddenPath(pathPart) || isPackageFolder(pathPart))) return false;
        pathOffset = nextOffset;
        continue;
      case "literal":
        if (comp.literal !== pathPart) return false;
        break;
      case "wildcard":
        if (comp.skipPackageFolders && isPackageFolder(pathPart)) return false;
        if (!matchWildcard(p, comp.segments, pathPart)) return false;
        break;
    }
    pathOffset = nextOffset;
    compIdx++;
  }
}

// vfsmatch.go:283
function patternSatisfied(p: GlobPattern, compIdx: number): boolean {
  for (const c of p.components.slice(compIdx)) if (c.kind !== "doubleAsterisk") return false;
  return true;
}

// vfsmatch.go:361
function matchWildcard(p: GlobPattern, segs: Segment[], s: string): boolean {
  if (!p.isExclude && segs.length > 0 && isHiddenPath(s) && (segs[0].kind === "star" || segs[0].kind === "question")) return false;
  if (segs.length === 2 && segs[0].kind === "star" && segs[1].kind === "literal") {
    const suffix = segs[1].literal;
    const sb = Buffer.from(s, "utf8");
    const xb = Buffer.from(suffix, "utf8");
    if (sb.length < xb.length || !sb.subarray(sb.length - xb.length).equals(xb)) return false;
    return shouldIncludeMinJs(p, s, segs);
  }
  return matchSegments(segs, s) && shouldIncludeMinJs(p, s, segs);
}

// vfsmatch.go:382; the reference walks bytes and steps by one UTF-8 sequence, here code points of a well formed string
function matchSegments(segs: Segment[], str: string): boolean {
  const s = Array.from(str);
  const join = (from: number, count: number) => s.slice(from, from + count).join("");
  let segIdx = 0;
  let sIdx = 0;
  let starSegIdx = -1;
  let starSIdx = 0;
  while (sIdx < s.length) {
    if (segIdx < segs.length) {
      const seg = segs[segIdx];
      if (seg.kind === "literal") {
        const lit = Array.from(seg.literal);
        const end = sIdx + lit.length;
        if (end <= s.length && join(sIdx, lit.length) === seg.literal) {
          sIdx = end;
          segIdx++;
          continue;
        }
      } else if (seg.kind === "question") {
        if (s[sIdx] !== "/") {
          sIdx++;
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
      starSIdx++;
      sIdx = starSIdx;
      segIdx = starSegIdx + 1;
      continue;
    }
    return false;
  }
  while (segIdx < segs.length && segs[segIdx].kind === "star") segIdx++;
  return segIdx >= segs.length;
}

// vfsmatch.go:433, case sensitive
function shouldIncludeMinJs(p: GlobPattern, filename: string, segs: Segment[]): boolean {
  if (!p.excludeMinJs) return true;
  if (!filename.endsWith(".min.js")) return true;
  for (const seg of segs) {
    if (seg.kind !== "literal") continue;
    if (seg.literal.includes(".min.js") || seg.literal.includes(".min.")) return true;
  }
  return false;
}

function isHiddenPath(name: string): boolean {
  return name.length > 0 && name[0] === ".";
}

// vfsmatch.go:493; the length is counted in bytes there, so a name with a letter outside ASCII never has one of the three lengths and folds alike
function isPackageFolder(name: string): boolean {
  if (!/^[\x00-\x7f]*$/.test(name)) return false;
  const lower = name.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));
  return lower === "node_modules" || lower === "jspm_packages" || lower === "bower_components";
}

function ensureTrailingSlash(s: string): string {
  return s.length > 0 && s[s.length - 1] !== "/" ? s + "/" : s;
}

interface GlobMatcher {
  includes: GlobPattern[];
  excludes: GlobPattern[];
  hadIncludes: boolean;
}

// vfsmatch.go:519
function newGlobMatcher(includeSpecs: string[], excludeSpecs: string[], basePath: string, usage: Usage): GlobMatcher {
  const m: GlobMatcher = { hadIncludes: includeSpecs.length > 0, includes: [], excludes: [] };
  for (const spec of includeSpecs) {
    const p = compileGlobPattern(spec, basePath, usage);
    if (p !== undefined) m.includes.push(p);
  }
  for (const spec of excludeSpecs) {
    const p = compileGlobPattern(spec, basePath, "exclude");
    if (p !== undefined) m.excludes.push(p);
  }
  return m;
}

// vfsmatch.go:541
function matchesFile(m: GlobMatcher, path: string): number {
  for (const e of m.excludes) if (matchPath(e, path, 0, 0, false)) return -1;
  if (m.includes.length === 0) return m.hadIncludes ? -1 : 0;
  for (let i = 0; i < m.includes.length; i++) if (matchPath(m.includes[i], path, 0, 0, false)) return i;
  return -1;
}

// vfsmatch.go:562
function matchesDirectory(m: GlobMatcher, path: string): boolean {
  for (const e of m.excludes) if (matchPath(e, path, 0, 0, false)) return false;
  if (m.includes.length === 0) return !m.hadIncludes;
  for (const i of m.includes) if (matchPath(i, path, 0, 0, true)) return true;
  return false;
}

// vfsmatch.go:648 with unlimited depth
export function readDirectory(host: MapFS, currentDir: string, path: string, extensions: string[], excludes: string[], includes: string[]): string[] {
  path = normalizePath(path);
  const currentDirectory = normalizePath(currentDir);
  const absolutePath = combinePaths(currentDirectory, path);
  const fileMatcher = newGlobMatcher(includes, excludes, absolutePath, "files");
  const directoryMatcher = newGlobMatcher(includes, excludes, absolutePath, "directories");
  const results: string[][] = [];
  for (let i = 0; i < Math.max(fileMatcher.includes.length, 1); i++) results.push([]);
  const visited = new Set<string>();

  // vfsmatch.go:594
  const visit = (path: string, absolutePath: string, resolvedRealPath: string, depth: number) => {
    if (depth > 200) return;
    const realPath = resolvedRealPath !== "" ? resolvedRealPath : host.realpath(absolutePath);
    if (visited.has(realPath)) return;
    visited.add(realPath);
    const entries = host.getAccessibleEntries(absolutePath);
    const pathPrefix = ensureTrailingSlash(path);
    const absPrefix = ensureTrailingSlash(absolutePath);
    for (const file of entries.files) {
      if (extensions.length > 0 && !fileExtensionIsOneOf(file, extensions)) continue;
      const idx = matchesFile(fileMatcher, absPrefix + file);
      if (idx >= 0) results[idx].push(pathPrefix + file);
    }
    for (const dir of entries.directories) {
      if (!matchesDirectory(directoryMatcher, absPrefix + dir)) continue;
      const absDir = absPrefix + dir;
      const childRealPath = entries.symlinks.has(dir) ? "" : combinePaths(realPath, dir);
      visit(pathPrefix + dir, absDir, childRealPath, depth + 1);
    }
  };

  for (const basePath of getBasePaths(path, includes)) visit(basePath, combinePaths(currentDirectory, basePath), "", 0);
  return results.flat();
}

// vfsmatch.go:703 with MatchIndex; undefined stands for the nil matcher
export function newSpecMatcher(specs: string[], basePath: string, usage: Usage): ((path: string) => number) | undefined {
  if (specs.length === 0) return undefined;
  const patterns: GlobPattern[] = [];
  for (const spec of specs) {
    const p = compileGlobPattern(spec, basePath, usage);
    if (p !== undefined) patterns.push(p);
  }
  if (patterns.length === 0) return undefined;
  return (path: string) => patterns.findIndex(p => matchPath(p, path, 0, 0, false));
}
