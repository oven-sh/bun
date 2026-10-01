// Port of the functions of internal/tspath/path.go that the test case parser needs.

const urlSchemeSeparator = "://";

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

  // POSIX or UNC
  if (ch0 === "/" || ch0 === "\\") {
    if (ln === 1 || path[1] !== ch0) return 1;
    const offset = 2;
    const p1 = path.indexOf(ch0, offset);
    if (p1 < 0) return ln;
    return p1 + 1;
  }

  // DOS
  if (isVolumeCharacter(path.charCodeAt(0)) && ln > 1 && path[1] === ":") {
    if (ln === 2) return 2;
    const ch2 = path[2];
    if (ch2 === "/" || ch2 === "\\") return 3;
  }

  // Untitled paths
  if (ch0 === "^" && ln > 1 && path[1] === "/") return 2;

  // URL
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

  // relative
  return 0;
}

export function getRootLength(path: string): number {
  const rootLength = getEncodedRootLength(path);
  return rootLength < 0 ? ~rootLength : rootLength;
}

export function normalizeSlashes(path: string): string {
  return path.replaceAll("\\", "/");
}

export function removeTrailingDirectorySeparator(path: string): string {
  return hasTrailingDirectorySeparator(path) ? path.slice(0, path.length - 1) : path;
}

export function getBaseFileName(path: string): string {
  path = normalizeSlashes(path);
  // if the path provided is itself the root, then it has no file name.
  const rootLength = getRootLength(path);
  if (rootLength === path.length) return "";
  path = removeTrailingDirectorySeparator(path);
  return path.slice(Math.max(getRootLength(path), path.lastIndexOf("/") + 1));
}

// ---- added for the enumerator: the path functions that the skip rule and the config reader reach ----

export function isRootedDiskPath(path: string): boolean {
  return getEncodedRootLength(path) > 0;
}

export function ensureTrailingDirectorySeparator(path: string): string {
  return hasTrailingDirectorySeparator(path) ? path : path + "/";
}

export function removeTrailingDirectorySeparators(path: string): string {
  while (hasTrailingDirectorySeparator(path)) path = removeTrailingDirectorySeparator(path);
  return path;
}

// Port of CombinePaths (path.go:91).
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

// Port of GetDirectoryPath (path.go:251).
export function getDirectoryPath(path: string): string {
  path = normalizeSlashes(path);
  const rootLength = getRootLength(path);
  if (rootLength === path.length) return path;
  path = removeTrailingDirectorySeparator(path);
  return path.slice(0, Math.max(rootLength, path.lastIndexOf("/")));
}

// Port of hasRelativePathSegment (path.go:532).
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

// Port of simpleNormalizePath (path.go:515); undefined stands for ok == false.
function simpleNormalizePath(path: string): string | undefined {
  if (!hasRelativePathSegment(path)) return path;
  const simplified = path.replaceAll("/./", "/");
  const trimmed = simplified.startsWith("./") ? simplified.slice(2) : simplified;
  if (trimmed !== path && !hasRelativePathSegment(trimmed) && !(trimmed !== simplified && trimmed.startsWith("/"))) {
    return trimmed;
  }
  return undefined;
}

// Port of GetNormalizedAbsolutePath (path.go:394).
export function getNormalizedAbsolutePath(fileName: string, currentDirectory: string): string {
  let rootLength = getRootLength(fileName);
  if (rootLength === 0 && currentDirectory !== "") {
    fileName = combinePaths(currentDirectory, fileName);
  } else {
    fileName = normalizeSlashes(fileName);
  }
  rootLength = getRootLength(fileName);

  const simpleNormalized = simpleNormalizePath(fileName);
  if (simpleNormalized !== undefined) {
    const length = simpleNormalized.length;
    if (length > rootLength) return removeTrailingDirectorySeparator(simpleNormalized);
    if (length === rootLength && rootLength !== 0) return ensureTrailingDirectorySeparator(simpleNormalized);
    return simpleNormalized;
  }

  const length = fileName.length;
  const root = fileName.slice(0, rootLength);
  let changed = false;
  let normalized = "";
  let segmentStart = 0;
  let index = rootLength;
  let normalizedUpTo = index;
  let seenNonDotDotSegment = rootLength !== 0;
  while (index < length) {
    segmentStart = index;
    let ch = fileName[index];
    while (ch === "/") {
      index++;
      if (index < length) ch = fileName[index];
      else break;
    }
    if (index > segmentStart) {
      if (!changed) {
        normalized = fileName.slice(0, Math.max(rootLength, segmentStart - 1));
        changed = true;
      }
      if (index === length) break;
      segmentStart = index;
    }
    let segmentEnd = fileName.indexOf("/", index + 1);
    if (segmentEnd === -1) segmentEnd = length;
    const segmentLength = segmentEnd - segmentStart;
    if (segmentLength === 1 && fileName[index] === ".") {
      if (!changed) {
        normalized = fileName.slice(0, normalizedUpTo);
        changed = true;
      }
    } else if (segmentLength === 2 && fileName[index] === "." && fileName[index + 1] === ".") {
      if (!seenNonDotDotSegment) {
        if (changed) {
          normalized += normalized.length === rootLength ? ".." : "/..";
        } else {
          normalizedUpTo = index + 2;
        }
      } else if (!changed) {
        if (normalizedUpTo - 1 >= 0) {
          normalized = fileName.slice(0, Math.max(rootLength, fileName.slice(0, normalizedUpTo - 1).lastIndexOf("/")));
        } else {
          normalized = fileName.slice(0, normalizedUpTo);
        }
        changed = true;
        seenNonDotDotSegment =
          (normalized.length !== rootLength || rootLength !== 0) && normalized !== ".." && !normalized.endsWith("/..");
      } else {
        const lastSlash = normalized.lastIndexOf("/");
        if (lastSlash !== -1) normalized = normalized.slice(0, Math.max(rootLength, lastSlash));
        else normalized = root;
        seenNonDotDotSegment =
          (normalized.length !== rootLength || rootLength !== 0) && normalized !== ".." && !normalized.endsWith("/..");
      }
    } else if (changed) {
      if (normalized.length !== rootLength) normalized += "/";
      seenNonDotDotSegment = true;
      normalized += fileName.slice(segmentStart, segmentEnd);
    } else {
      seenNonDotDotSegment = true;
      normalizedUpTo = segmentEnd;
    }
    index = segmentEnd + 1;
  }
  if (changed) return normalized;
  if (length > rootLength) return removeTrailingDirectorySeparators(fileName);
  if (length === rootLength) return ensureTrailingDirectorySeparator(fileName);
  return fileName;
}

// Port of NormalizePath (path.go:600).
export function normalizePath(path: string): string {
  path = normalizeSlashes(path);
  const simple = simpleNormalizePath(path);
  if (simple !== undefined) return simple;
  let normalized = getNormalizedAbsolutePath(path, "");
  if (normalized !== "" && hasTrailingDirectorySeparator(path)) normalized = ensureTrailingDirectorySeparator(normalized);
  return normalized;
}

// Port of ToPath (path.go:723) for a case sensitive file system, the only kind the harness makes.
export function toPath(fileName: string, basePath: string): string {
  return isRootedDiskPath(fileName) ? normalizePath(fileName) : getNormalizedAbsolutePath(fileName, basePath);
}

// Port of GetAnyExtensionFromPath(path, nil, false) (path.go:902).
export function getAnyExtensionFromPath(path: string): string {
  const baseFileName = getBaseFileName(path);
  const extensionIndex = baseFileName.lastIndexOf(".");
  return extensionIndex >= 0 ? baseFileName.slice(extensionIndex) : "";
}
