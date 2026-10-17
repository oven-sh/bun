// @ts-check
// Hardcoded module "node:path"
const [bindingPosix, bindingWin32] = $cpp("Path.cpp", "createNodePathBinding");
const toNamespacedPathPosix = bindingPosix.toNamespacedPath.bind(bindingPosix);
const toNamespacedPathWin32 = bindingWin32.toNamespacedPath.bind(bindingWin32);

function hasOnlyTidySegments(path: string): boolean {
  const length = path.length;
  for (let i = 0; i < length; ++i) {
    if (path.charCodeAt(i) === 47) {
      if (i + 1 === length) return true;
      const next = path.charCodeAt(i + 1);
      if (next === 47) return false;
      if (next === 46) {
        if (i + 2 === length) return false;
        const second = path.charCodeAt(i + 2);
        if (second === 47) return false;
        if (second === 46 && (i + 3 === length || path.charCodeAt(i + 3) === 47)) return false;
      }
    }
  }
  return true;
}

function isTidy(path: string): boolean {
  if (path.charCodeAt(0) === 46) {
    const length = path.length;
    if (length === 1) return false;
    const second = path.charCodeAt(1);
    if (second === 47) return false;
    if (second === 46 && (length === 2 || path.charCodeAt(2) === 47)) return false;
  }
  return hasOnlyTidySegments(path);
}

let lastTidyDirectory = "";

function isTidyDirectory(path: string): boolean {
  if (path === lastTidyDirectory) return true;
  if (!isTidy(path)) return false;
  lastTidyDirectory = path;
  return true;
}

function isResolved(path: string): boolean {
  const length = path.length;
  return length > 0 && path.charCodeAt(0) === 47 && (length === 1 || path.charCodeAt(length - 1) !== 47) && hasOnlyTidySegments(path);
}

function isResolvedDirectory(path: string): boolean {
  const length = path.length;
  return length > 0 && path.charCodeAt(0) === 47 && (length === 1 || path.charCodeAt(length - 1) !== 47) && isTidyDirectory(path);
}

function normalizeUntidy(path: string, keepsTrailingSeparator: boolean): string {
  const length = path.length;
  const isAbsolute = path.charCodeAt(0) === 47;
  const first = isAbsolute ? 1 : 0;
  const hasTrailingSeparator = keepsTrailingSeparator && path.charCodeAt(length - 1) === 47;
  let out = "";
  let above = 0;
  let runStart = 0;
  let runEnd = -1;
  let end = length;
  while (end > first) {
    let start = end;
    while (start > first && path.charCodeAt(start - 1) !== 47) --start;
    const size = end - start;
    let isKept = false;
    if (size === 0 || (size === 1 && path.charCodeAt(start) === 46)) {
    } else if (size === 2 && path.charCodeAt(start) === 46 && path.charCodeAt(start + 1) === 46) {
      ++above;
    } else if (above > 0) {
      --above;
    } else {
      isKept = true;
    }
    if (isKept) {
      if (runEnd === -1) runEnd = end;
      runStart = start;
    } else if (runEnd !== -1) {
      out = out.length === 0 ? path.slice(runStart, hasTrailingSeparator ? runEnd + 1 : runEnd) : path.slice(runStart, runEnd + 1) + out;
      runEnd = -1;
    }
    end = start - 1;
  }
  if (isAbsolute) {
    if (runEnd !== -1) return out.length === 0 ? path.slice(runStart - 1, hasTrailingSeparator ? runEnd + 1 : runEnd) : path.slice(runStart - 1, runEnd + 1) + out;
    return "/" + out;
  }
  if (runEnd !== -1) out = out.length === 0 ? path.slice(runStart, hasTrailingSeparator ? runEnd + 1 : runEnd) : path.slice(runStart, runEnd + 1) + out;
  if (above > 0) {
    if (out.length === 0 && hasTrailingSeparator) out = "/";
    else if (out.length !== 0) out = "/" + out;
    out = ".." + out;
    while (--above > 0) out = "../" + out;
    return out;
  }
  if (out.length === 0) return hasTrailingSeparator ? "./" : ".";
  return out;
}

function normalizePosix(path: string): string {
  if (path.length === 0) return ".";
  return isTidy(path) ? path : normalizeUntidy(path, true);
}

function joinTwo(first: string, second: string): string {
  if (first.length === 0) return normalizePosix(second);
  if (second.length === 0) return normalizePosix(first);
  if (isTidyDirectory(first) && isTidy(second)) {
    const endsWithSeparator = first.charCodeAt(first.length - 1) === 47;
    if (second.charCodeAt(0) !== 47) return endsWithSeparator ? first + second : first + "/" + second;
    if (!endsWithSeparator) return first + second;
  }
  return normalizeUntidy(first + "/" + second, true);
}

function joinMany(paths: unknown[]): string {
  let joined = "";
  let isJoinedTidy = true;
  let endsWithSeparator = false;
  for (let i = 0; i < paths.length; ++i) {
    const path = paths[i];
    if (typeof path !== "string") return bindingPosix.join.$apply(bindingPosix, paths);
    if (path.length === 0) continue;
    if (isJoinedTidy) {
      isJoinedTidy = !endsWithSeparator && (joined.length === 0 ? isTidyDirectory(path) : isTidy(path) && path.charCodeAt(0) !== 47);
      endsWithSeparator = path.charCodeAt(path.length - 1) === 47;
    }
    joined = joined.length === 0 ? path : joined + "/" + path;
  }
  if (joined.length === 0) return ".";
  return isJoinedTidy ? joined : normalizeUntidy(joined, true);
}

function resolveTwo(first: string, second: string): string {
  if (second.length === 0) return resolveOne(first);
  if (second.charCodeAt(0) === 47) return resolveOne(second);
  if (first.length === 0) return resolveFromWorkingDirectory(second);
  if (first.charCodeAt(0) !== 47) return resolveFromWorkingDirectory(first + "/" + second);
  if (isResolvedDirectory(first) && isTidy(second) && second.charCodeAt(second.length - 1) !== 47) return first.length === 1 ? first + second : first + "/" + second;
  return normalizeUntidy(first + "/" + second, false);
}

function resolveOne(path: string): string {
  if (path.length === 0 || path.charCodeAt(0) !== 47) return resolveFromWorkingDirectory(path);
  return isResolved(path) ? path : normalizeUntidy(path, false);
}

function resolveFromWorkingDirectory(path: string): string {
  const directory: string = bindingPosix.resolve();
  return path.length === 0 ? directory : resolveTwo(directory, path);
}

function resolveMany(paths: unknown[]): string {
  let resolved = "";
  let isAbsolute = false;
  for (let i = paths.length - 1; i >= 0; --i) {
    const path = paths[i];
    if (typeof path !== "string") return bindingPosix.resolve.$apply(bindingPosix, paths);
    if (isAbsolute || path.length === 0) continue;
    resolved = resolved.length === 0 ? path : path + "/" + resolved;
    isAbsolute = path.charCodeAt(0) === 47;
  }
  return resolveOne(resolved);
}

const climbs = ["", "..", "../..", "../../..", "../../../..", "../../../../..", "../../../../../..", "../../../../../../..", "../../../../../../../.."];

function climb(from: string, to: string, end: number, lastCommonSeparator: number): string {
  const fromLength = from.length;
  const toLength = to.length;
  if (end === fromLength) {
    if (toLength > end) {
      if (to.charCodeAt(end) === 47) return to.slice(end + 1);
      if (end === 1) return to.slice(1);
    }
  } else if (end === toLength) {
    if (from.charCodeAt(end) === 47) lastCommonSeparator = end;
    else if (end === 1) lastCommonSeparator = 1;
  }
  let count = 0;
  for (let i = lastCommonSeparator + 1; i <= fromLength; ++i) {
    if (i === fromLength || from.charCodeAt(i) === 47) ++count;
  }
  let out = climbs[count < 8 ? count : 8];
  for (; count > 8; --count) out += "/..";
  return out + to.slice(lastCommonSeparator);
}

function relativeResolved(from: string, to: string): string {
  if (from === to) return "";
  const length = from.length < to.length ? from.length : to.length;
  let lastCommonSeparator = 0;
  let i = 1;
  for (; i < length; ++i) {
    const code = from.charCodeAt(i);
    if (code !== to.charCodeAt(i)) break;
    if (code === 47) lastCommonSeparator = i;
  }
  return climb(from, to, i, lastCommonSeparator);
}

function relativePosix(from: string, to: string): string {
  if (from === to) return "";
  const fromLength = from.length;
  const toLength = to.length;
  const length = fromLength < toLength ? fromLength : toLength;
  if (length === 0 || from.charCodeAt(0) !== 47 || to.charCodeAt(0) !== 47 || (fromLength > 1 && from.charCodeAt(fromLength - 1) === 47) || (toLength > 1 && to.charCodeAt(toLength - 1) === 47)) {
    return relativeResolved(resolveOne(from), resolveOne(to));
  }
  let lastCommonSeparator = 0;
  let dots = 0;
  let i = 1;
  for (; i < length; ++i) {
    const code = from.charCodeAt(i);
    if (code !== to.charCodeAt(i)) break;
    if (code === 47) {
      if (dots >= 0 && dots <= 2) return relativeResolved(resolveOne(from), resolveOne(to));
      lastCommonSeparator = i;
      dots = 0;
    } else if (code !== 46 || dots < 0) {
      dots = -1;
    } else {
      ++dots;
    }
  }
  let count = 0;
  let dotsOfFrom = dots;
  for (let j = i; j < fromLength; ++j) {
    const code = from.charCodeAt(j);
    if (code === 47) {
      if (dotsOfFrom >= 0 && dotsOfFrom <= 2) return relativeResolved(resolveOne(from), resolveOne(to));
      ++count;
      dotsOfFrom = 0;
    } else if (code !== 46 || dotsOfFrom < 0) {
      dotsOfFrom = -1;
    } else {
      ++dotsOfFrom;
    }
  }
  if (dotsOfFrom >= 1 && dotsOfFrom <= 2) return relativeResolved(resolveOne(from), resolveOne(to));
  for (let j = i; j < toLength; ++j) {
    const code = to.charCodeAt(j);
    if (code === 47) {
      if (dots >= 0 && dots <= 2) return relativeResolved(resolveOne(from), resolveOne(to));
      dots = 0;
    } else if (code !== 46 || dots < 0) {
      dots = -1;
    } else {
      ++dots;
    }
  }
  if (dots >= 1 && dots <= 2) return relativeResolved(resolveOne(from), resolveOne(to));
  if (i === fromLength) {
    if (to.charCodeAt(i) === 47) return to.slice(i + 1);
    if (i === 1) return to.slice(1);
  } else if (i === toLength) {
    if (from.charCodeAt(i) === 47) {
      lastCommonSeparator = i;
      --count;
    } else if (i === 1) {
      lastCommonSeparator = 1;
    }
  }
  ++count;
  let out = climbs[count < 8 ? count : 8];
  for (; count > 8; --count) out += "/..";
  return out + to.slice(lastCommonSeparator);
}

function dirnamePosix(path: string): string {
  const length = path.length;
  if (length === 0) return ".";
  let end = length;
  while (end > 1 && path.charCodeAt(end - 1) === 47) --end;
  let i = end - 1;
  for (; i >= 1; --i) {
    if (path.charCodeAt(i) === 47) break;
  }
  const hasRoot = path.charCodeAt(0) === 47;
  if (i < 1) return hasRoot ? "/" : ".";
  if (hasRoot && i === 1) return "//";
  return path.slice(0, i);
}

function basenamePosix(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47) --end;
  let i = end - 1;
  for (; i >= 0; --i) {
    if (path.charCodeAt(i) === 47) break;
  }
  return path.slice(i + 1, end);
}

function basenameWithoutSuffix(path: string, suffix: string): string {
  if (suffix.length === 0 || suffix.length > path.length) return basenamePosix(path);
  if (suffix === path) return "";
  let start = 0;
  let end = -1;
  let suffixIndex = suffix.length - 1;
  let firstNonSlashEnd = -1;
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === 47) {
      if (firstNonSlashEnd !== -1) {
        start = i + 1;
        break;
      }
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

function extnamePosix(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47) --end;
  let startDot = end;
  for (;;) {
    if (startDot === 0) return "";
    const code = path.charCodeAt(--startDot);
    if (code === 46) break;
    if (code === 47) return "";
  }
  if (startDot === 0) return "";
  const before = path.charCodeAt(startDot - 1);
  if (before === 47) return "";
  if (before === 46 && startDot === end - 1 && (startDot === 1 || path.charCodeAt(startDot - 2) === 47)) return "";
  return path.slice(startDot, end);
}

function parsePosix(path: string): Record<string, string> {
  const length = path.length;
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

const posix: any = IS_BUN_AOT
  ? ({
      resolve(...paths: unknown[]): string {
        if (paths.length === 2) {
          const first = paths[0];
          const second = paths[1];
          if (typeof first === "string" && typeof second === "string") return resolveTwo(first, second);
        } else if (paths.length === 1) {
          const path = paths[0];
          if (typeof path === "string") return resolveOne(path);
        }
        return resolveMany(paths);
      },
      normalize(path: unknown): string {
        return typeof path === "string" ? normalizePosix(path) : bindingPosix.normalize(path);
      },
      isAbsolute(path: unknown): boolean {
        return typeof path === "string" ? path.length > 0 && path.charCodeAt(0) === 47 : bindingPosix.isAbsolute(path);
      },
      join(...paths: unknown[]): string {
        if (paths.length === 2) {
          const first = paths[0];
          const second = paths[1];
          if (typeof first === "string" && typeof second === "string") return joinTwo(first, second);
        }
        return joinMany(paths);
      },
      relative(from: unknown, to: unknown): string {
        return typeof from === "string" && typeof to === "string" ? relativePosix(from, to) : bindingPosix.relative(from, to);
      },
      toNamespacedPath: toNamespacedPathPosix,
      dirname(path: unknown): string {
        return typeof path === "string" ? dirnamePosix(path) : bindingPosix.dirname(path);
      },
      basename(path: unknown, suffix?: unknown): string {
        if (typeof path === "string") {
          if (suffix === undefined) return basenamePosix(path);
          if (typeof suffix === "string") return basenameWithoutSuffix(path, suffix);
        }
        return bindingPosix.basename(path, suffix);
      },
      extname(path: unknown): string {
        return typeof path === "string" ? extnamePosix(path) : bindingPosix.extname(path);
      },
      format: bindingPosix.format.bind(bindingPosix),
      parse(path: unknown): Record<string, string> {
        return typeof path === "string" ? parsePosix(path) : bindingPosix.parse(path);
      },
      sep: "/",
      delimiter: ":",
      win32: undefined,
      posix: undefined,
      _makeLong: toNamespacedPathPosix,
    } as any)
  : ({
      resolve: bindingPosix.resolve.bind(bindingPosix),
      normalize: bindingPosix.normalize.bind(bindingPosix),
      isAbsolute: bindingPosix.isAbsolute.bind(bindingPosix),
      join: bindingPosix.join.bind(bindingPosix),
      relative: bindingPosix.relative.bind(bindingPosix),
      toNamespacedPath: toNamespacedPathPosix,
      dirname: bindingPosix.dirname.bind(bindingPosix),
      basename: bindingPosix.basename.bind(bindingPosix),
      extname: bindingPosix.extname.bind(bindingPosix),
      format: bindingPosix.format.bind(bindingPosix),
      parse: bindingPosix.parse.bind(bindingPosix),
      sep: "/",
      delimiter: ":",
      win32: undefined,
      posix: undefined,
      _makeLong: toNamespacedPathPosix,
    } as any);
const win32: any = {
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
  win32: undefined,
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
function matchesGlob(isWindows: boolean, path: unknown, pattern: unknown): boolean {
  let glob: Glob;

  if (typeof path !== "string") throw $ERR_INVALID_ARG_TYPE("path", "string", path);
  const subject = isWindows ? path.replaceAll("\\", "/") : path;

  if (prevGlob && prevPattern === pattern) {
    glob = prevGlob;
  } else {
    if (typeof pattern !== "string") throw $ERR_INVALID_ARG_TYPE("pattern", "string", pattern);
    const text = isWindows ? pattern.replaceAll("\\", "/") : pattern;
    glob = prevGlob = new Bun.Glob(text);
    prevPattern = text;
  }

  return glob.match(subject);
}

posix.matchesGlob = matchesGlob.bind(null, false);
win32.matchesGlob = matchesGlob.bind(null, true);

export default process.platform === "win32" ? win32 : posix;
