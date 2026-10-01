// Port of the functions of internal/tspath/path.go and internal/stringutil/compare.go that the baseline writer calls.
import { decodeRune } from "./go_compat";

const urlSchemeSeparator = "://";

export interface ComparePathsOptions {
  useCaseSensitiveFileNames: boolean;
  currentDirectory: string;
}

function isAnyDirectorySeparator(char: string): boolean {
  return char === "/" || char === "\\";
}

export function hasTrailingDirectorySeparator(path: string): boolean {
  return path.length > 0 && isAnyDirectorySeparator(path[path.length - 1]);
}

export function isVolumeCharacter(char: number): boolean {
  return (char >= 0x61 && char <= 0x7a) || (char >= 0x41 && char <= 0x5a);
}

function getFileUrlVolumeSeparatorEnd(url: string, start: number): number {
  if (url.length <= start) return -1;
  const ch0 = url[start];
  if (ch0 === ":") return start + 1;
  if (ch0 === "%" && url.length > start + 2 && url[start + 1] === "3") {
    const ch2 = url[start + 2];
    if (ch2 === "a" || ch2 === "A") return start + 3;
  }
  return -1;
}

export function getEncodedRootLength(path: string): number {
  const ln = path.length;
  if (ln === 0) return 0;
  const ch0 = path[0];
  if (ch0 === "/" || ch0 === "\\") {
    if (ln === 1 || path[1] !== ch0) return 1;
    const offset = 2;
    const p1 = path.indexOf(ch0, offset);
    if (p1 < 0) return ln;
    return p1 + 1;
  }
  if (isVolumeCharacter(path.charCodeAt(0)) && ln > 1 && path[1] === ":") {
    if (ln === 2) return 2;
    const ch2 = path[2];
    if (ch2 === "/" || ch2 === "\\") return 3;
  }
  if (ch0 === "^" && ln > 1 && path[1] === "/") return 2;
  const schemeEnd = path.indexOf(urlSchemeSeparator);
  if (schemeEnd !== -1) {
    const authorityStart = schemeEnd + urlSchemeSeparator.length;
    const authorityEnd = path.indexOf("/", authorityStart);
    if (authorityEnd !== -1) {
      const scheme = path.slice(0, schemeEnd);
      const authority = path.slice(authorityStart, authorityEnd);
      if (
        scheme === "file" &&
        (authority === "" || authority === "localhost") &&
        path.length > authorityEnd + 2 &&
        isVolumeCharacter(path.charCodeAt(authorityEnd + 1))
      ) {
        const volumeSeparatorEnd = getFileUrlVolumeSeparatorEnd(path, authorityEnd + 2);
        if (volumeSeparatorEnd !== -1) {
          if (volumeSeparatorEnd === path.length) return ~volumeSeparatorEnd;
          if (path[volumeSeparatorEnd] === "/") return ~(volumeSeparatorEnd + 1);
        }
      }
      return ~(authorityEnd + 1);
    }
    return ~ln;
  }
  return 0;
}

export function getRootLength(path: string): number {
  const rootLength = getEncodedRootLength(path);
  return rootLength < 0 ? ~rootLength : rootLength;
}

export function isRootedDiskPath(path: string): boolean {
  return getEncodedRootLength(path) > 0;
}

export function pathIsAbsolute(path: string): boolean {
  return getEncodedRootLength(path) !== 0;
}

export function normalizeSlashes(path: string): string {
  return path.replaceAll("\\", "/");
}

export function combinePaths(firstPath: string, ...paths: string[]): string {
  let result = normalizeSlashes(firstPath);
  for (let trailingPath of paths) {
    if (trailingPath === "") continue;
    trailingPath = normalizeSlashes(trailingPath);
    if (result === "" || getRootLength(trailingPath) !== 0) {
      result = trailingPath;
    } else {
      if (!hasTrailingDirectorySeparator(result)) result += "/";
      result += trailingPath;
    }
  }
  return result;
}

function pathComponents(path: string, rootLength: number): string[] {
  const root = path.slice(0, rootLength);
  const rest = path.slice(rootLength).split("/");
  if (rest.length > 0 && rest[rest.length - 1] === "") rest.pop();
  return [root, ...rest];
}

export function getPathComponents(path: string, currentDirectory: string): string[] {
  path = combinePaths(currentDirectory, path);
  return pathComponents(path, getRootLength(path));
}

export function reducePathComponents(components: string[]): string[] {
  if (components.length === 0) return [];
  const reduced = [components[0]];
  for (let i = 1; i < components.length; i++) {
    const component = components[i];
    if (component === "") continue;
    if (component === ".") continue;
    if (component === "..") {
      if (reduced.length > 1) {
        if (reduced[reduced.length - 1] !== "..") {
          reduced.pop();
          continue;
        }
      } else if (reduced[0] !== "") {
        continue;
      }
    }
    reduced.push(component);
  }
  return reduced;
}

export function ensureTrailingDirectorySeparator(path: string): string {
  return hasTrailingDirectorySeparator(path) ? path : path + "/";
}

export function removeTrailingDirectorySeparator(path: string): string {
  return hasTrailingDirectorySeparator(path) ? path.slice(0, -1) : path;
}

export function getPathFromPathComponents(components: string[]): string {
  if (components.length === 0) return "";
  let root = components[0];
  if (root !== "") root = ensureTrailingDirectorySeparator(root);
  return root + components.slice(1).join("/");
}

// unicode.ToLower restricted to what strings.EqualFold and CompareStringsCaseInsensitive need for path text.
function toLowerRune(r: number): number {
  if (r < 0x80) return r >= 0x41 && r <= 0x5a ? r + 0x20 : r;
  const s = String.fromCodePoint(r).toLowerCase();
  const cp = s.codePointAt(0)!;
  return s.length === (cp >= 0x10000 ? 2 : 1) ? cp : r;
}

export function compareStringsCaseInsensitive(a: string, b: string): number {
  if (a === b) return 0;
  let i = 0;
  let j = 0;
  for (;;) {
    const [ca, sa] = decodeRune(a, i);
    const [cb, sb] = decodeRune(b, j);
    if (sa === 0) return sb === 0 ? 0 : -1;
    if (sb === 0) return 1;
    const lca = toLowerRune(ca);
    const lcb = toLowerRune(cb);
    if (lca !== lcb) return lca < lcb ? -1 : 1;
    i += sa;
    j += sb;
  }
}

export function compareStringsCaseSensitive(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function getComparer(options: ComparePathsOptions): (a: string, b: string) => number {
  return options.useCaseSensitiveFileNames ? compareStringsCaseSensitive : compareStringsCaseInsensitive;
}

function hasRelativePathSegment(p: string): boolean {
  const n = p.length;
  if (n === 0) return false;
  if (p === "." || p === "..") return true;
  if (p[0] === ".") {
    if (n >= 2 && p[1] === "/") return true;
    if (n >= 3 && p[1] === "." && p[2] === "/") return true;
  }
  if (p[n - 1] === ".") {
    if (n >= 2 && p[n - 2] === "/") return true;
    if (n >= 3 && p[n - 2] === "." && p[n - 3] === "/") return true;
  }
  let prevSlash = false;
  let segLen = 0;
  let dotCount = 0;
  for (let i = 0; i < n; i++) {
    const c = p[i];
    if (c === "/") {
      if (prevSlash) return true;
      if ((segLen === 1 && dotCount === 1) || (segLen === 2 && dotCount === 2)) return true;
      prevSlash = true;
      segLen = 0;
      dotCount = 0;
      continue;
    }
    if (c === ".") {
      if (dotCount >= 0) dotCount++;
    } else {
      dotCount = -1;
    }
    segLen++;
    prevSlash = false;
  }
  return (segLen === 1 && dotCount === 1) || (segLen === 2 && dotCount === 2);
}

export function comparePaths(a: string, b: string, options: ComparePathsOptions): number {
  a = combinePaths(options.currentDirectory, a);
  b = combinePaths(options.currentDirectory, b);
  if (a === b) return 0;
  if (a === "") return -1;
  if (b === "") return 1;
  const aRoot = a.slice(0, getRootLength(a));
  const bRoot = b.slice(0, getRootLength(b));
  const result = compareStringsCaseInsensitive(aRoot, bRoot);
  if (result !== 0) return result;
  const aRest = a.slice(aRoot.length);
  const bRest = b.slice(bRoot.length);
  if (!hasRelativePathSegment(aRest) && !hasRelativePathSegment(bRest)) {
    return getComparer(options)(aRest, bRest);
  }
  const aComponents = reducePathComponents(getPathComponents(a, ""));
  const bComponents = reducePathComponents(getPathComponents(b, ""));
  const sharedLength = Math.min(aComponents.length, bComponents.length);
  for (let i = 1; i < sharedLength; i++) {
    const r = getComparer(options)(aComponents[i], bComponents[i]);
    if (r !== 0) return r;
  }
  return aComponents.length < bComponents.length ? -1 : aComponents.length > bComponents.length ? 1 : 0;
}

function getPathComponentsRelativeTo(from: string, to: string, options: ComparePathsOptions): string[] {
  const fromComponents = reducePathComponents(getPathComponents(from, options.currentDirectory));
  const toComponents = reducePathComponents(getPathComponents(to, options.currentDirectory));
  let start = 0;
  const maxCommonComponents = Math.min(fromComponents.length, toComponents.length);
  for (; start < maxCommonComponents; start++) {
    const fromComponent = fromComponents[start];
    const toComponent = toComponents[start];
    if (start === 0) {
      if (compareStringsCaseInsensitive(fromComponent, toComponent) !== 0) break;
    } else if (getComparer(options)(fromComponent, toComponent) !== 0) {
      break;
    }
  }
  if (start === 0) return toComponents;
  const result = [""];
  for (let i = start; i < fromComponents.length; i++) result.push("..");
  for (let i = start; i < toComponents.length; i++) result.push(toComponents[i]);
  return result;
}

export function convertToRelativePath(absoluteOrRelativePath: string, options: ComparePathsOptions): string {
  if (!isRootedDiskPath(absoluteOrRelativePath)) return absoluteOrRelativePath;
  return getPathFromPathComponents(
    getPathComponentsRelativeTo(options.currentDirectory, absoluteOrRelativePath, options),
  );
}

export function getBaseFileName(path: string): string {
  path = normalizeSlashes(path);
  const rootLength = getRootLength(path);
  if (rootLength === path.length) return "";
  path = removeTrailingDirectorySeparator(path);
  return path.slice(Math.max(getRootLength(path), path.lastIndexOf("/") + 1));
}
