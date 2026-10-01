// Prototype: the functions of internal/tspath that the roots split and the config file matcher reach, beyond the enumerator's set.
import {
  combinePaths,
  ensureTrailingDirectorySeparator,
  getBaseFileName,
  getRootLength,
  isRootedDiskPath,
  removeTrailingDirectorySeparator,
} from "../../../enumerator/prototype/tspath";

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

// extension.go:24-37
export const AllSupportedExtensions: string[][] = [
  [ExtensionTs, ExtensionTsx, ExtensionDts, ExtensionJs, ExtensionJsx],
  [ExtensionCts, ExtensionDcts, ExtensionCjs],
  [ExtensionMts, ExtensionDmts, ExtensionMjs],
];
export const SupportedTSExtensions: string[][] = [
  [ExtensionTs, ExtensionTsx, ExtensionDts],
  [ExtensionCts, ExtensionDcts],
  [ExtensionMts, ExtensionDmts],
];
export const AllSupportedExtensionsWithJson: string[][] = [...AllSupportedExtensions, [ExtensionJson]];
export const SupportedTSExtensionsWithJson: string[][] = [...SupportedTSExtensions, [ExtensionJson]];

// extension.go:43
const extensionsToRemove = [ExtensionDts, ExtensionDmts, ExtensionDcts, ExtensionMjs, ExtensionMts, ExtensionCjs, ExtensionCts, ExtensionTs, ExtensionJs, ExtensionTsx, ExtensionJsx, ExtensionJson];

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

// path.go:941, case sensitive comparer only
function tryGetExtensionFromPath(path: string, extension: string): string {
  if (!extension.startsWith(".")) extension = "." + extension;
  if (path.length >= extension.length && path[path.length - extension.length] === ".") {
    const pathExtension = path.slice(path.length - extension.length);
    if (pathExtension === extension) return pathExtension;
  }
  return "";
}

// path.go:902 with a list of extensions and ignoreCase false
export function getAnyExtensionFromPathOf(path: string, extensions: readonly string[]): string {
  if (extensions.length > 0) {
    const p = removeTrailingDirectorySeparator(path);
    for (const extension of extensions) {
      const result = tryGetExtensionFromPath(p, extension);
      if (result !== "") return result;
    }
    return "";
  }
  const baseFileName = getBaseFileName(path);
  const extensionIndex = baseFileName.lastIndexOf(".");
  if (extensionIndex >= 0) return baseFileName.slice(extensionIndex);
  return "";
}

// extension.go:159 and :174
export function changeExtension(path: string, newExtension: string): string {
  const pathext = getAnyExtensionFromPathOf(path, extensionsToRemove);
  if (pathext !== "") {
    const result = path.slice(0, path.length - pathext.length);
    if (newExtension === "") return result;
    if (newExtension.startsWith(".")) return result + newExtension;
    return result + "." + newExtension;
  }
  return path;
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
  let i = rootLength;
  while (i < combined.length) {
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

// strings.EqualFold for the root component of a path; roots of the corpus are ASCII
function equalFoldAscii(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x >= 0x80 || y >= 0x80) {
      if (x !== y) return false;
      continue;
    }
    if (x >= 0x41 && x <= 0x5a) x += 32;
    if (y >= 0x41 && y <= 0x5a) y += 32;
    if (x !== y) return false;
  }
  return true;
}

// path.go:1054 with UseCaseSensitiveFileNames true
export function containsPath(parent: string, child: string, currentDirectory: string): boolean {
  parent = combinePaths(currentDirectory, parent);
  child = combinePaths(currentDirectory, child);
  if (parent === "" || child === "") return false;
  if (parent === child) return true;
  const parentComponents = reducePathComponents(getPathComponents(parent, ""));
  const childComponents = reducePathComponents(getPathComponents(child, ""));
  if (childComponents.length < parentComponents.length) return false;
  for (let i = 0; i < parentComponents.length; i++) {
    const equal = i === 0 ? equalFoldAscii(parentComponents[i], childComponents[i]) : parentComponents[i] === childComponents[i];
    if (!equal) return false;
  }
  return true;
}

// path.go:765 with UseCaseSensitiveFileNames true
export function getPathComponentsRelativeTo(from: string, to: string, currentDirectory: string): string[] {
  const fromComponents = reducePathComponents(getPathComponents(from, currentDirectory));
  const toComponents = reducePathComponents(getPathComponents(to, currentDirectory));
  let start = 0;
  const maxCommonComponents = Math.min(fromComponents.length, toComponents.length);
  for (; start < maxCommonComponents; start++) {
    const fromComponent = fromComponents[start];
    const toComponent = toComponents[start];
    if (start === 0) {
      if (!equalFoldAscii(fromComponent, toComponent)) break;
    } else if (fromComponent !== toComponent) break;
  }
  if (start === 0) return toComponents;
  const numDotDotSlashes = fromComponents.length - start;
  const result: string[] = [""];
  for (let i = 0; i < numDotDotSlashes; i++) result.push("..");
  for (const component of toComponents.slice(start)) result.push(component);
  return result;
}

// path.go:821 and :829 with isAbsolutePathAnUrl false
export function convertToRelativePath(absoluteOrRelativePath: string, currentDirectory: string): string {
  if (!isRootedDiskPath(absoluteOrRelativePath)) return absoluteOrRelativePath;
  return getPathFromPathComponents(getPathComponentsRelativeTo(currentDirectory, absoluteOrRelativePath, currentDirectory));
}

// strings.Compare: byte order of the UTF-8 forms
export function compareBytes(a: string, b: string): number {
  if (a === b) return 0;
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
