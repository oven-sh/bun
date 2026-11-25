// Hardcoded module "node:path"
// Reads and calls what a script can replace (`process.cwd`, `process.env`, `normalize`, `resolve`) when https://github.com/nodejs/node/blob/v26.12.1/lib/path.js does.
declare global {
  namespace $Node {
    interface ParsedPath {
      root: string;
      dir: string;
      base: string;
      ext: string;
      name: string;
    }

    /** `path.posix` and `path.win32`. */
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
      matchesGlob(path: unknown, pattern: unknown): boolean;
      sep: "/" | "\\";
      delimiter: ":" | ";";
      win32: Win32Path;
      posix: Path;
      _makeLong<T>(path: T): T;
    }

    /** `path.win32`. A property instead of a method gives the object its own Structure, so that the compiler knows the functions of `path.posix`. */
    interface Win32Path extends Path {
      _makeLong: <T>(path: T) => T;
    }
  }
}

const concatenatePosix = $bindgen("node_path.bind.ts", "concatenatePosix");
const joinPosix = $bindgen("node_path.bind.ts", "joinPosix");
const normalizePosix = $bindgen("node_path.bind.ts", "normalizePosix");
const relativePosix = $bindgen("node_path.bind.ts", "relativePosix");
const relativeOfResolvedPosix = $bindgen("node_path.bind.ts", "relativeOfResolvedPosix");
const resolvePosix = $bindgen("node_path.bind.ts", "resolvePosix");
const resolveFromPosix = $bindgen("node_path.bind.ts", "resolveFromPosix");
const concatenateWin32 = $bindgen("node_path.bind.ts", "concatenateWin32");
const joinWin32 = $bindgen("node_path.bind.ts", "joinWin32");
const normalizeWin32 = $bindgen("node_path.bind.ts", "normalizeWin32");
const relativeWin32 = $bindgen("node_path.bind.ts", "relativeWin32");
const relativeOfResolvedWin32 = $bindgen("node_path.bind.ts", "relativeOfResolvedWin32");
const resolveWin32 = $bindgen("node_path.bind.ts", "resolveWin32");
const resolveFromWin32 = $bindgen("node_path.bind.ts", "resolveFromWin32");
const respell = $bindgen("node_path.bind.ts", "respell");
const matchesGlob = $bindgen("node_path.bind.ts", "matchesGlob");

const isWindows = process.platform === "win32";
const globsIgnoreCase = process.platform === "win32" || process.platform === "darwin";

const CHAR_DOT = 46;
const CHAR_FORWARD_SLASH = 47;
const CHAR_COLON = 58;
const CHAR_QUESTION_MARK = 63;
const CHAR_UPPERCASE_A = 65;
const CHAR_BACKWARD_SLASH = 92;
const fromUppercaseA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz";

/** What a method of `String.prototype` makes of its receiver, for what a function that was replaced has returned. */
function asReceiver(value: any): string {
  if (typeof value === "string") return value;
  if ($isUndefinedOrNull(value)) throw new TypeError("String.prototype.charCodeAt called on null or undefined");
  return `${value}`;
}

function notAString(paths: ArrayLike<unknown>, index: number) {
  return $ERR_INVALID_ARG_TYPE(`paths[${index}]`, "string", paths[index]);
}

function withFirst(first: string, others: ArrayLike<string>): [string, ...string[]] {
  const all = $newArrayWithSize<string>(others.length + 1);
  $putByValDirect(all, 0, first);
  for (let i = 0; i < others.length; i++) $putByValDirect(all, i + 1, others[i]);
  return all as [string, ...string[]];
}

function formatExt(ext: any) {
  return ext ? `${ext[0] === "." ? "" : "."}${ext}` : "";
}

function _format(sep: string, pathObject: any) {
  if (typeof pathObject !== "object" || pathObject === null || $isArray(pathObject)) {
    throw $ERR_INVALID_ARG_TYPE("pathObject", "object", pathObject);
  }
  const dir = pathObject.dir || pathObject.root;
  const base = pathObject.base || `${pathObject.name || ""}${formatExt(pathObject.ext)}`;
  if (!dir) return base;
  return dir === pathObject.root ? `${dir}${base}` : `${dir}${sep}${base}`;
}

/** `needed` is the negative number that `resolveWin32` answered. */
function win32Cwd(needed: number): string {
  if (needed === -1) return asReceiver($process.cwd());
  const device = `${fromUppercaseA[-needed - CHAR_UPPERCASE_A]}:`;
  const env = $process.env;
  const cwd =
    env[`=${device}`] ||
    // The `process.env` that Bun has made lacks these variables.
    (process.platform === "win32" &&
      env === Bun.env &&
      $bindgen("node_path.bind.ts", "workingDirectoryOfDrive")(-needed)) ||
    $process.cwd();
  return cwd === undefined ? `${device}\\` : asReceiver(cwd);
}

function resolveCwdWin32(path: string | undefined): string {
  const cwd = $process.cwd();
  if (isWindows && path === undefined) return cwd;
  const text = asReceiver(cwd);
  const code = text.$charCodeAt(0);
  if (path !== undefined && code !== CHAR_FORWARD_SLASH && code !== CHAR_BACKWARD_SLASH) {
    return resolveFromWin32(text, path);
  }
  return isWindows ? cwd : respell(text, true);
}

const win32 = {
  resolve() {
    const count = $argumentCount();
    const a = $argument(0);
    const b = $argument(1);
    let answer: string | number;
    if (count === 2) {
      answer = resolveWin32(a, b);
      if (typeof answer !== "string" && answer < 0) return resolveFromWin32(win32Cwd(answer), a, b);
    } else if (count < 2) {
      if (count === 0 || a === "" || a === ".") return resolveCwdWin32(a);
      answer = resolveWin32(a);
      if (typeof answer !== "string" && answer < 0) return resolveFromWin32(win32Cwd(answer), a);
    } else if (count === 3) {
      answer = resolveWin32(a, b, $argument(2));
      if (typeof answer !== "string" && answer < 0) return resolveFromWin32(win32Cwd(answer), a, b, $argument(2));
    } else {
      answer = resolveWin32.$apply(undefined, arguments as LazyArguments);
      if (typeof answer !== "string" && answer < 0) {
        return resolveFromWin32.$apply(undefined, withFirst(win32Cwd(answer), arguments as LazyArguments));
      }
    }
    if (typeof answer !== "string") throw notAString(arguments as LazyArguments, answer);
    return answer;
  },
  normalize: normalizeWin32,
  isAbsolute: $bindgen("node_path.bind.ts", "isAbsoluteWin32"),
  join() {
    const count = $argumentCount();
    const answer =
      count === 2
        ? joinWin32($argument(0), $argument(1))
        : count === 3
          ? joinWin32($argument(0), $argument(1), $argument(2))
          : joinWin32.$apply(undefined, arguments as LazyArguments);
    if (answer === undefined) return concatenateWin32.$apply(undefined, arguments as LazyArguments);
    const normalize = win32.normalize;
    if (normalize === normalizeWin32) return answer;
    return normalize.$call(win32, concatenateWin32.$apply(undefined, arguments as LazyArguments));
  },
  relative(from: any, to: any) {
    if (from === to && typeof from === "string") return "";
    const answer = relativeWin32(from, to);
    const resolve = win32.resolve;
    if (answer !== undefined && resolve === resolveOfWin32) {
      const again = win32.resolve;
      if (again === resolve) return answer;
      from = resolve(from);
      to = again.$call(win32, to);
    } else {
      from = resolve.$call(win32, from);
      to = win32.resolve(to);
    }
    return from === to ? "" : relativeOfResolvedWin32(asReceiver(from), asReceiver(to));
  },
  toNamespacedPath(path: any) {
    if (typeof path !== "string" || path.length === 0) return path;
    const resolvedPath = win32.resolve(path);
    if (resolvedPath.length <= 2) return path;
    const text = asReceiver(resolvedPath);
    const code = text.$charCodeAt(0);
    if (code === CHAR_BACKWARD_SLASH) {
      if (text.$charCodeAt(1) === CHAR_BACKWARD_SLASH) {
        const next = text.$charCodeAt(2);
        if (next !== CHAR_QUESTION_MARK && next !== CHAR_DOT) return `\\\\?\\UNC\\${text.$substr(2)}`;
      }
    } else if (
      ((code | 32) - 97) >>> 0 < 26 &&
      text.$charCodeAt(1) === CHAR_COLON &&
      text.$charCodeAt(2) === CHAR_BACKWARD_SLASH
    ) {
      return `\\\\?\\${text}`;
    }
    return resolvedPath;
  },
  dirname: $bindgen("node_path.bind.ts", "dirnameWin32"),
  basename: $bindgen("node_path.bind.ts", "basenameWin32"),
  extname: $bindgen("node_path.bind.ts", "extnameWin32"),
  format: _format.bind(null, "\\"),
  parse: $bindgen("node_path.bind.ts", "parseWin32"),
  matchesGlob(path: any, pattern: any) {
    return matchesGlob(path, pattern, true, globsIgnoreCase);
  },
  sep: "\\",
  delimiter: ";",
  win32: undefined! as $Node.Win32Path,
  posix: undefined! as $Node.Path,
  _makeLong: undefined! as $Node.Path["_makeLong"],
} as $Node.Win32Path;

function posixCwd() {
  return isWindows ? respell(asReceiver($process.cwd()), false) : $process.cwd();
}

function resolveCwdPosix(): string {
  const cwd = posixCwd();
  return asReceiver(cwd).$charCodeAt(0) === CHAR_FORWARD_SLASH ? cwd : resolveFromPosix(asReceiver(posixCwd()));
}

function isRelativePosix(path: unknown) {
  return typeof path === "string" && (path.length === 0 || path.$charCodeAt(0) !== CHAR_FORWARD_SLASH);
}

const posix = {
  resolve() {
    const count = $argumentCount();
    const a = $argument(0);
    const b = $argument(1);
    let answer: string | number;
    if (count === 2) {
      if (isRelativePosix(b) && isRelativePosix(a)) return resolveFromPosix(asReceiver(posixCwd()), a, b);
      answer = resolvePosix(a, b);
    } else if (count < 2) {
      if (count === 0 || a === "" || a === ".") return resolveCwdPosix();
      if (isRelativePosix(a)) return resolveFromPosix(asReceiver(posixCwd()), a);
      answer = resolvePosix(a);
    } else if (count === 3) {
      const c = $argument(2);
      if (isRelativePosix(c) && isRelativePosix(b) && isRelativePosix(a)) {
        return resolveFromPosix(asReceiver(posixCwd()), a, b, c);
      }
      answer = resolvePosix(a, b, c);
    } else {
      answer = resolvePosix.$apply(undefined, arguments as LazyArguments);
      if (answer === -1) {
        return resolveFromPosix.$apply(undefined, withFirst(asReceiver(posixCwd()), arguments as LazyArguments));
      }
    }
    if (typeof answer !== "string") throw notAString(arguments as LazyArguments, answer);
    return answer;
  },
  normalize: normalizePosix,
  isAbsolute: $bindgen("node_path.bind.ts", "isAbsolutePosix"),
  join() {
    const count = $argumentCount();
    if (count === 1) {
      const path = $argument(0);
      if (typeof path === "string" && path.length !== 0) return posix.normalize(path);
    }
    const answer =
      count === 2
        ? joinPosix($argument(0), $argument(1))
        : count === 3
          ? joinPosix($argument(0), $argument(1), $argument(2))
          : joinPosix.$apply(undefined, arguments as LazyArguments);
    if (answer === undefined) return ".";
    const normalize = posix.normalize;
    if (normalize === normalizePosix) return answer;
    return normalize.$call(posix, concatenatePosix.$apply(undefined, arguments as LazyArguments));
  },
  relative(from: any, to: any) {
    if (from === to && typeof from === "string") return "";
    const answer = relativePosix(from, to);
    const resolve = posix.resolve;
    if (answer !== undefined && resolve === resolveOfPosix) {
      const again = posix.resolve;
      if (again === resolve) return answer;
      from = resolve(from);
      to = again.$call(posix, to);
    } else {
      from = resolve.$call(posix, from);
      to = posix.resolve(to);
    }
    return from === to ? "" : relativeOfResolvedPosix(asReceiver(from), asReceiver(to));
  },
  toNamespacedPath(path: any) {
    return path;
  },
  dirname: $bindgen("node_path.bind.ts", "dirnamePosix"),
  basename: $bindgen("node_path.bind.ts", "basenamePosix"),
  extname: $bindgen("node_path.bind.ts", "extnamePosix"),
  format: _format.bind(null, "/"),
  parse: $bindgen("node_path.bind.ts", "parsePosix"),
  matchesGlob(path: any, pattern: any) {
    return matchesGlob(path, pattern, false, globsIgnoreCase);
  },
  sep: "/",
  delimiter: ":",
  win32,
  posix: undefined! as $Node.Path,
  _makeLong: undefined! as $Node.Path["_makeLong"],
} as $Node.Path;

const resolveOfWin32 = win32.resolve;
const resolveOfPosix = posix.resolve;

win32.win32 = win32;
posix.posix = win32.posix = posix;
win32._makeLong = win32.toNamespacedPath;
posix._makeLong = posix.toNamespacedPath;

export default process.platform === "win32" ? win32 : posix;
