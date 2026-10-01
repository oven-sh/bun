// Research prototype: the functions of internal/tspath that roots, config file matching and materialisation add.
import {
  combinePaths,
  ensureTrailingDirectorySeparator,
  getBaseFileName,
  getNormalizedAbsolutePath,
  getRootLength,
  isRootedDiskPath,
  normalizePath,
  removeTrailingDirectorySeparator,
} from "./tspath";

// extension.go:8
export const ExtensionTs = ".ts";
export const ExtensionTsx = ".tsx";
export const ExtensionDts = ".d.ts";
export const ExtensionJs = ".js";
export const ExtensionJsx = ".jsx";
export const ExtensionJson = ".json";
export const ExtensionTsBuildInfo = ".tsbuildinfo";
export const ExtensionMjs = ".mjs";
export const ExtensionMts = ".mts";
export const ExtensionDmts = ".d.mts";
export const ExtensionCjs = ".cjs";
export const ExtensionCts = ".cts";
export const ExtensionDcts = ".d.cts";

// extension.go:24
export const AllSupportedExtensions: readonly (readonly string[])[] = [
  [ExtensionTs, ExtensionTsx, ExtensionDts, ExtensionJs, ExtensionJsx],
  [ExtensionCts, ExtensionDcts, ExtensionCjs],
  [ExtensionMts, ExtensionDmts, ExtensionMjs],
];
export const SupportedTSExtensions: readonly (readonly string[])[] = [
  [ExtensionTs, ExtensionTsx, ExtensionDts],
  [ExtensionCts, ExtensionDcts],
  [ExtensionMts, ExtensionDmts],
];
export const AllSupportedExtensionsWithJson = [...AllSupportedExtensions, [ExtensionJson]];
export const SupportedTSExtensionsWithJson = [...SupportedTSExtensions, [ExtensionJson]];

// extension.go:43
const extensionsToRemove = [
  ExtensionDts, ExtensionDmts, ExtensionDcts, ExtensionMjs, ExtensionMts, ExtensionCjs, ExtensionCts,
  ExtensionTs, ExtensionJs, ExtensionTsx, ExtensionJsx, ExtensionJson,
];

// path.go:1095
export function fileExtensionIs(path: string, extension: string): boolean {
  return path.length > extension.length && path.endsWith(extension);
}

// extension.go:79
export function fileExtensionIsOneOf(path: string, extensions: readonly string[]): boolean {
  for (const ext of extensions) if (fileExtensionIs(path, ext)) return true;
  return false;
}

// path.go:1139
export function hasExtension(fileName: string): boolean {
  return getBaseFileName(fileName).includes(".");
}

// Go's strings.EqualFold restricted to what the runner reaches: exact for ASCII, simple one to one folding otherwise.
export function equalFold(a: string, b: string): boolean {
  if (a === b) return true;
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done || y.done) return x.done === y.done;
    if (x.value === y.value) continue;
    if (foldRune(x.value) !== foldRune(y.value)) return false;
  }
}
function foldRune(ch: string): string {
  const c = ch.charCodeAt(0);
  if (ch.length === 1 && c < 0x80) return c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 32) : ch;
  const u = ch.toUpperCase();
  const l = (u.length === ch.length ? u : ch).toLowerCase();
  return l.length === ch.length ? l : ch;
}

// stringutil/compare.go:34; unicode.ToLower per rune
export function compareStringsCaseInsensitive(a: string, b: string): number {
  if (a === b) return 0;
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const lca = lowerRune(x.value);
    const lcb = lowerRune(y.value);
    if (lca !== lcb) return lca < lcb ? -1 : 1;
  }
}
// unicode.ToLower; U+0130 is the one code point whose lower case in JavaScript is two code points
function lowerRune(ch: string): number {
  if (ch === "\u0130") return 0x69;
  return ch.toLowerCase().codePointAt(0)!;
}

// Go's strings.Compare is a byte comparison; code units differ from bytes above the BMP only.
export function compareStringsCaseSensitive(a: string, b: string): number {
  if (a === b) return 0;
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export interface ComparePathsOptions {
  useCaseSensitiveFileNames: boolean;
  currentDirectory: string;
}

// path.go:993
export function getComparer(o: ComparePathsOptions): (a: string, b: string) => number {
  return o.useCaseSensitiveFileNames ? compareStringsCaseSensitive : compareStringsCaseInsensitive;
}
// path.go:997
function getEqualityComparer(o: ComparePathsOptions): (a: string, b: string) => boolean {
  return o.useCaseSensitiveFileNames ? (a, b) => a === b : equalFold;
}

// path.go:139
function pathComponents(path: string, rootLength: number): string[] {
  const root = path.slice(0, rootLength);
  const rest = path.slice(rootLength).split("/");
  if (rest.length > 0 && rest[rest.length - 1] === "") rest.pop();
  return [root, ...rest];
}

// path.go:134
export function getPathComponents(path: string, currentDirectory: string): string[] {
  path = combinePaths(currentDirectory, path);
  return pathComponents(path, getRootLength(path));
}

// path.go:287
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

// path.go:270
export function getPathFromPathComponents(components: string[]): string {
  if (components.length === 0) return "";
  let root = components[0];
  if (root !== "") root = ensureTrailingDirectorySeparator(root);
  return root + components.slice(1).join("/");
}

// path.go:341 and :346
export function getNormalizedPathComponents(path: string, currentDirectory: string): string[] {
  const combined = combinePaths(currentDirectory, path);
  const rootLength = getRootLength(combined);
  const components = [combined.slice(0, rootLength)];
  for (let i = rootLength; i < combined.length; ) {
    while (i < combined.length && combined[i] === "/") i++;
    if (i >= combined.length) break;
    const start = i;
    while (i < combined.length && combined[i] !== "/") i++;
    const component = combined.slice(start, i);
    if (component === "" || component === ".") continue;
    if (component === "..") {
      if (components.length > 1) {
        if (components[components.length - 1] !== "..") {
          components.pop();
          continue;
        }
      } else if (components[0] !== "") {
        continue;
      }
    }
    components.push(component);
  }
  return components;
}

// path.go:1054
export function containsPath(parent: string, child: string, options: ComparePathsOptions): boolean {
  parent = combinePaths(options.currentDirectory, parent);
  child = combinePaths(options.currentDirectory, child);
  if (parent === "" || child === "") return false;
  if (parent === child) return true;
  const parentComponents = reducePathComponents(getPathComponents(parent, ""));
  const childComponents = reducePathComponents(getPathComponents(child, ""));
  if (childComponents.length < parentComponents.length) return false;
  const componentComparer = getEqualityComparer(options);
  for (let i = 0; i < parentComponents.length; i++) {
    const comparer = i === 0 ? equalFold : componentComparer;
    if (!comparer(parentComponents[i], childComponents[i])) return false;
  }
  return true;
}

// path.go:674; U+0130 stays, every other rune takes unicode.ToLower
export function toFileNameLowerCase(fileName: string): string {
  let out = "";
  for (const ch of fileName) {
    if (ch === "\u0130") {
      out += ch;
      continue;
    }
    const l = ch.toLowerCase();
    out += [...l].length === 1 ? l : ch;
  }
  return out;
}

// path.go:612
export function getCanonicalFileName(fileName: string, useCaseSensitiveFileNames: boolean): string {
  return useCaseSensitiveFileNames ? fileName : toFileNameLowerCase(fileName);
}

// path.go:723
export function toPathEx(fileName: string, basePath: string, useCaseSensitiveFileNames: boolean): string {
  const nonCanonicalizedPath = isRootedDiskPath(fileName) ? normalizePath(fileName) : getNormalizedAbsolutePath(fileName, basePath);
  return getCanonicalFileName(nonCanonicalizedPath, useCaseSensitiveFileNames);
}

// path.go:765
export function getPathComponentsRelativeTo(from: string, to: string, options: ComparePathsOptions): string[] {
  const fromComponents = reducePathComponents(getPathComponents(from, options.currentDirectory));
  const toComponents = reducePathComponents(getPathComponents(to, options.currentDirectory));
  let start = 0;
  const maxCommonComponents = Math.min(fromComponents.length, toComponents.length);
  const stringEqualer = getEqualityComparer(options);
  for (; start < maxCommonComponents; start++) {
    const fromComponent = fromComponents[start];
    const toComponent = toComponents[start];
    if (start === 0) {
      if (!equalFold(fromComponent, toComponent)) break;
    } else if (!stringEqualer(fromComponent, toComponent)) break;
  }
  if (start === 0) return toComponents;
  const result = [""];
  for (let i = start; i < fromComponents.length; i++) result.push("..");
  for (const component of toComponents.slice(start)) result.push(component);
  return result;
}

// path.go:821 with :829 for isAbsolutePathAnUrl == false
export function convertToRelativePath(absoluteOrRelativePath: string, options: ComparePathsOptions): string {
  if (!isRootedDiskPath(absoluteOrRelativePath)) return absoluteOrRelativePath;
  return getPathFromPathComponents(getPathComponentsRelativeTo(options.currentDirectory, absoluteOrRelativePath, options));
}

// path.go:941
function tryGetExtensionFromPath(path: string, extension: string, eq: (a: string, b: string) => boolean): string {
  if (!extension.startsWith(".")) extension = "." + extension;
  if (path.length >= extension.length && path[path.length - extension.length] === ".") {
    const pathExtension = path.slice(path.length - extension.length);
    if (eq(pathExtension, extension)) return pathExtension;
  }
  return "";
}

// path.go:902
export function getAnyExtensionFromPathEx(path: string, extensions: readonly string[] | undefined, ignoreCase: boolean): string {
  if (extensions !== undefined && extensions.length > 0) {
    const p = removeTrailingDirectorySeparator(path);
    const eq = ignoreCase ? equalFold : (a: string, b: string) => a === b;
    for (const extension of extensions) {
      const result = tryGetExtensionFromPath(p, extension, eq);
      if (result !== "") return result;
    }
    return "";
  }
  const baseFileName = getBaseFileName(path);
  const extensionIndex = baseFileName.lastIndexOf(".");
  return extensionIndex >= 0 ? baseFileName.slice(extensionIndex) : "";
}

// extension.go:159
export function changeAnyExtension(path: string, ext: string, extensions: readonly string[], ignoreCase: boolean): string {
  const pathext = getAnyExtensionFromPathEx(path, extensions, ignoreCase);
  if (pathext !== "") {
    const result = path.slice(0, path.length - pathext.length);
    if (ext === "") return result;
    if (ext.startsWith(".")) return result + ext;
    return result + "." + ext;
  }
  return path;
}

// extension.go:174
export function changeExtension(path: string, newExtension: string): string {
  return changeAnyExtension(path, newExtension, extensionsToRemove, false);
}
