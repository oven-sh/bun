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
