// Hardcoded module "node:path"
const { validateString } = require("internal/validators");

const [bindingPosix, bindingWin32] = $cpp("Path.cpp", "createNodePathBinding");
const toNamespacedPathPosix = bindingPosix.toNamespacedPath.bind(bindingPosix);
const toNamespacedPathWin32 = bindingWin32.toNamespacedPath.bind(bindingWin32);

function isNormalizedPosix(path: string): boolean {
  const length = path.length;
  let lastSlash = -1;
  let dots = 0;
  for (let i = 0; i < length; ++i) {
    const code = path.charCodeAt(i);
    if (code === 47) {
      const segment = i - lastSlash - 1;
      if (segment === 0 ? i !== 0 : dots === segment && segment <= 2) return false;
      lastSlash = i;
      dots = 0;
    } else if (code === 46 && dots !== -1) {
      ++dots;
    } else if (code >= 0xd800) {
      return false;
    } else {
      dots = -1;
    }
  }
  const segment = length - lastSlash - 1;
  return !(segment !== 0 && dots === segment && segment <= 2);
}

function joinPosix(paths: unknown[]): string {
  let joined = "";
  for (let i = 0; i < paths.length; ++i) {
    const path = paths[i];
    if (typeof path !== "string") return bindingPosix.join.$apply(bindingPosix, paths);
    if (path.length > 0) joined = joined.length === 0 ? path : joined + "/" + path;
  }
  if (joined.length === 0) return ".";
  return isNormalizedPosix(joined) ? joined : bindingPosix.normalize(joined);
}

function isResolvedPosix(path: string): boolean {
  const length = path.length;
  return length > 0 && path.charCodeAt(0) === 47 && (length === 1 || path.charCodeAt(length - 1) !== 47) && isNormalizedPosix(path);
}

function resolvePosix(paths: unknown[]): string {
  let resolved = "";
  let isAbsolute = false;
  for (let i = paths.length - 1; i >= 0; --i) {
    const path = paths[i];
    if (typeof path !== "string") return bindingPosix.resolve.$apply(bindingPosix, paths);
    if (isAbsolute || path.length === 0) continue;
    resolved = resolved.length === 0 ? path : path + "/" + resolved;
    isAbsolute = path.charCodeAt(0) === 47;
  }
  return isAbsolute && isResolvedPosix(resolved) ? resolved : bindingPosix.resolve.$apply(bindingPosix, paths);
}

function relativePosix(from: unknown, to: unknown): string {
  if (typeof from !== "string" || typeof to !== "string" || !isResolvedPosix(from) || !isResolvedPosix(to)) return bindingPosix.relative(from, to);
  if (from === to) return "";
  const fromEnd = from.length;
  const fromLength = fromEnd - 1;
  const toLength = to.length - 1;
  const length = fromLength < toLength ? fromLength : toLength;
  let lastCommonSeparator = -1;
  let i = 0;
  for (; i < length; ++i) {
    const code = from.charCodeAt(1 + i);
    if (code !== to.charCodeAt(1 + i)) break;
    if (code === 47) lastCommonSeparator = i;
  }
  if (i === length) {
    if (toLength > length) {
      if (to.charCodeAt(1 + i) === 47) return to.slice(1 + i + 1);
      if (i === 0) return to.slice(1);
    } else if (fromLength > length) {
      if (from.charCodeAt(1 + i) === 47) lastCommonSeparator = i;
      else if (i === 0) lastCommonSeparator = 0;
    }
  }
  let out = "";
  for (i = 1 + lastCommonSeparator + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === 47) out += out.length === 0 ? ".." : "/..";
  }
  return out + to.slice(1 + lastCommonSeparator);
}

function dirnamePosix(path: unknown): string {
  if (typeof path !== "string") return bindingPosix.dirname(path);
  const length = path.length;
  if (length === 0) return ".";
  let end = -1;
  let matchedSlash = true;
  let i = length - 1;
  for (; i >= 1; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  const hasRoot = path.charCodeAt(0) === 47;
  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  for (--i; i >= 0; --i) {
    if (path.charCodeAt(i) >= 0xd800) return bindingPosix.dirname(path);
  }
  return path.slice(0, end);
}

function basenamePosix(path: unknown, suffix: unknown): string {
  if (typeof path !== "string") return bindingPosix.basename(path, suffix);
  let start = 0;
  let end = -1;
  if (suffix === undefined) {
    for (let i = path.length - 1; i >= 0; --i) {
      const code = path.charCodeAt(i);
      if (code === 47) {
        if (end !== -1) {
          start = i + 1;
          break;
        }
      } else if (code >= 0xd800) {
        return bindingPosix.basename(path);
      } else if (end === -1) {
        end = i + 1;
      }
    }
    return end === -1 ? "" : path.slice(start, end);
  }
  if (typeof suffix !== "string" || suffix.length === 0 || suffix.length > path.length) return bindingPosix.basename(path, suffix);
  if (suffix === path) return "";
  let suffixIndex = suffix.length - 1;
  for (let i = suffixIndex; i >= 0; --i) {
    if (suffix.charCodeAt(i) >= 0x80) return bindingPosix.basename(path, suffix);
  }
  let firstNonSlashEnd = -1;
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === 47) {
      if (firstNonSlashEnd !== -1) {
        start = i + 1;
        break;
      }
    } else if (code >= 0x80) {
      return bindingPosix.basename(path, suffix);
    } else {
      if (firstNonSlashEnd === -1) firstNonSlashEnd = i + 1;
      if (suffixIndex >= 0) {
        if (code === suffix.charCodeAt(suffixIndex)) {
          if (--suffixIndex === -1) end = i;
        } else {
          suffixIndex = -1;
          end = firstNonSlashEnd;
        }
      }
    }
  }
  if (start === end) end = firstNonSlashEnd;
  else if (end === -1) end = path.length;
  return path.slice(start, end);
}

function extnamePosix(path: unknown): string {
  if (typeof path !== "string") return bindingPosix.extname(path);
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let preDotState = 0;
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === 47) {
      if (end !== -1) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (code >= 0xd800) return bindingPosix.extname(path);
    if (end === -1) end = i + 1;
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) return "";
  return path.slice(startDot, end);
}

function parsePosix(path: unknown): { root: string; dir: string; base: string; ext: string; name: string } {
  if (typeof path !== "string") return bindingPosix.parse(path);
  const length = path.length;
  for (let i = 0; i < length; ++i) {
    if (path.charCodeAt(i) >= 0xd800) return bindingPosix.parse(path);
  }
  let root = "";
  let dir = "";
  let base = "";
  let ext = "";
  let name = "";
  if (length !== 0) {
    const isAbsolute = path.charCodeAt(0) === 47;
    const first = isAbsolute ? 1 : 0;
    if (isAbsolute) root = "/";
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let preDotState = 0;
    for (let i = length - 1; i >= first; --i) {
      const code = path.charCodeAt(i);
      if (code === 47) {
        if (end !== -1) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) end = i + 1;
      if (code === 46) {
        if (startDot === -1) startDot = i;
        else if (preDotState !== 1) preDotState = 1;
      } else if (startDot !== -1) {
        preDotState = -1;
      }
    }
    if (end !== -1) {
      const start = startPart === 0 && isAbsolute ? 1 : startPart;
      base = path.slice(start, end);
      if (startDot === -1 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
        name = base;
      } else {
        name = path.slice(start, startDot);
        ext = path.slice(startDot, end);
      }
    }
    if (startPart > 0) dir = path.slice(0, startPart - 1);
    else if (isAbsolute) dir = "/";
  }
  return { root, dir, base, ext, name };
}

const posix = {
  resolve(...paths: unknown[]): string {
    return resolvePosix(paths);
  },
  normalize(path: unknown): string {
    return typeof path === "string" && path.length > 0 && isNormalizedPosix(path) ? path : bindingPosix.normalize(path);
  },
  isAbsolute(path: unknown): boolean {
    return typeof path === "string" ? path.length > 0 && path.charCodeAt(0) === 47 : bindingPosix.isAbsolute(path);
  },
  join(...paths: unknown[]): string {
    return joinPosix(paths);
  },
  relative(from: unknown, to: unknown): string {
    return relativePosix(from, to);
  },
  toNamespacedPath: toNamespacedPathPosix,
  dirname(path: unknown): string {
    return dirnamePosix(path);
  },
  basename(path: unknown, suffix?: unknown): string {
    return basenamePosix(path, suffix);
  },
  extname(path: unknown): string {
    return extnamePosix(path);
  },
  format: bindingPosix.format.bind(bindingPosix),
  parse(path: unknown) {
    return parsePosix(path);
  },
  sep: "/",
  delimiter: ":",
  win32: undefined as typeof win32,
  posix: undefined as typeof posix,
  _makeLong: toNamespacedPathPosix,
};
const win32 = {
  resolve: bindingWin32.resolve.bind(bindingWin32),
  normalize: bindingWin32.normalize.bind(bindingWin32),
  isAbsolute: bindingWin32.isAbsolute.bind(bindingWin32),
  join: bindingWin32.join.bind(bindingWin32),
  relative: bindingWin32.relative.bind(bindingWin32),
  toNamespacedPath: toNamespacedPathWin32,
  dirname: bindingWin32.dirname.bind(bindingWin32),
  basename: bindingWin32.basename.bind(bindingWin32),
  extname: bindingWin32.extname.bind(bindingWin32),
  format: bindingWin32.format.bind(bindingWin32),
  parse: bindingWin32.parse.bind(bindingWin32),
  sep: "\\",
  delimiter: ";",
  win32: undefined as typeof win32,
  posix,
  _makeLong: toNamespacedPathWin32,
};
posix.win32 = win32.win32 = win32;
posix.posix = posix;

type Glob = import("bun").Glob;

// the most-recently used glob is memoized in case `matchesGlob` is called in a
// loop with the same pattern
let prevGlob: Glob | undefined;
let prevPattern: string | undefined;
function matchesGlob(isWindows, path, pattern) {
  let glob: Glob;

  validateString(path, "path");
  if (isWindows) path = path.replaceAll("\\", "/");

  if (prevGlob) {
    $assert(prevPattern !== undefined);
    if (prevPattern === pattern) {
      glob = prevGlob;
    } else {
      validateString(pattern, "pattern");
      if (isWindows) pattern = pattern.replaceAll("\\", "/");
      glob = prevGlob = new Bun.Glob(pattern);
      prevPattern = pattern;
    }
  } else {
    validateString(pattern, "pattern");
    if (isWindows) pattern = pattern.replaceAll("\\", "/");
    glob = prevGlob = new Bun.Glob(pattern);
    prevPattern = pattern;
  }

  return glob.match(path);
}

posix.matchesGlob = matchesGlob.bind(null, false);
win32.matchesGlob = matchesGlob.bind(null, true);

export default (process.platform === "win32" ? win32 : posix) as any as typeof import("node:path");
