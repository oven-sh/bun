// Hardcoded module "node:path"
const { validateString } = require("internal/validators");

declare global {
  namespace $Node {
    interface ParsedPath {
      root: string;
      dir: string;
      base: string;
      ext: string;
      name: string;
    }

    /** `path.posix` and `path.win32`. The native functions validate their arguments themselves. */
    interface Path {
      resolve(...paths: unknown[]): string;
      normalize(path: unknown): string;
      isAbsolute(path: unknown): boolean;
      join(...paths: unknown[]): string;
      relative(from: unknown, to: unknown): string;
      toNamespacedPath<T>(path: T): T;
      dirname(path: unknown): string;
      basename(path: unknown, suffix?: unknown): string;
      extname(path: unknown): string;
      format(pathObject: unknown): string;
      parse(path: unknown): ParsedPath;
      matchesGlob(path: string, pattern: string): boolean;
      sep: "/" | "\\";
      delimiter: ":" | ";";
      win32: Path;
      posix: Path;
      _makeLong<T>(path: T): T;
    }
  }
}

const toNamespacedPathPosix = $bindgen("node_path.bind.ts", "toNamespacedPathPosix");
const toNamespacedPathWin32 = $bindgen("node_path.bind.ts", "toNamespacedPathWin32");
const posix = {
  resolve: $bindgen("node_path.bind.ts", "resolvePosix"),
  normalize: $bindgen("node_path.bind.ts", "normalizePosix"),
  isAbsolute: $bindgen("node_path.bind.ts", "isAbsolutePosix"),
  join: $bindgen("node_path.bind.ts", "joinPosix"),
  relative: $bindgen("node_path.bind.ts", "relativePosix"),
  toNamespacedPath: toNamespacedPathPosix,
  dirname: $bindgen("node_path.bind.ts", "dirnamePosix"),
  basename: $bindgen("node_path.bind.ts", "basenamePosix"),
  extname: $bindgen("node_path.bind.ts", "extnamePosix"),
  format: $bindgen("node_path.bind.ts", "formatPosix"),
  parse: $bindgen("node_path.bind.ts", "parsePosix"),
  sep: "/",
  delimiter: ":",
  win32: undefined! as $Node.Path,
  posix: undefined! as $Node.Path,
  _makeLong: toNamespacedPathPosix,
} as $Node.Path;
const win32 = {
  resolve: $bindgen("node_path.bind.ts", "resolveWin32"),
  normalize: $bindgen("node_path.bind.ts", "normalizeWin32"),
  isAbsolute: $bindgen("node_path.bind.ts", "isAbsoluteWin32"),
  join: $bindgen("node_path.bind.ts", "joinWin32"),
  relative: $bindgen("node_path.bind.ts", "relativeWin32"),
  toNamespacedPath: toNamespacedPathWin32,
  dirname: $bindgen("node_path.bind.ts", "dirnameWin32"),
  basename: $bindgen("node_path.bind.ts", "basenameWin32"),
  extname: $bindgen("node_path.bind.ts", "extnameWin32"),
  format: $bindgen("node_path.bind.ts", "formatWin32"),
  parse: $bindgen("node_path.bind.ts", "parseWin32"),
  sep: "\\",
  delimiter: ";",
  win32: undefined! as $Node.Path,
  posix,
  _makeLong: toNamespacedPathWin32,
} as $Node.Path;
posix.win32 = win32.win32 = win32;
posix.posix = posix;

type Glob = import("bun").Glob;

// the most-recently used glob is memoized in case `matchesGlob` is called in a
// loop with the same pattern
let prevGlob: Glob | undefined;
let prevPattern: string | undefined;
function matchesGlob(isWindows: boolean, path: string, pattern: string) {
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

export default process.platform === "win32" ? win32 : posix;
