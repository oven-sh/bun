// What the compiler reads in place of src/js/node/path.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 77651cdd4bedc6dd3be1ff68a728a053897e32440423e082d060d64120c82c29.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

// Hardcoded module "node:path"
// `join`, `relative` and `resolve` follow the functions of those names in src/runtime/node/path.rs.
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

const joinUnnormalizedPosix = $bindgen("node_path.bind.ts", "joinUnnormalizedPosix");
const normalizePosix = $bindgen("node_path.bind.ts", "normalizePosix");
const relativeOfResolvedPosix = $bindgen("node_path.bind.ts", "relativeOfResolvedPosix");
const resolveWithCwdPosix = $bindgen("node_path.bind.ts", "resolveWithCwdPosix");
const tryJoinPosix = $bindgen("node_path.bind.ts", "tryJoinPosix");
const tryRelativePosix = $bindgen("node_path.bind.ts", "tryRelativePosix");
const tryResolvePosix = $bindgen("node_path.bind.ts", "tryResolvePosix");
const joinUnnormalizedWin32 = $bindgen("node_path.bind.ts", "joinUnnormalizedWin32");
const normalizeWin32 = $bindgen("node_path.bind.ts", "normalizeWin32");
const relativeOfResolvedWin32 = $bindgen("node_path.bind.ts", "relativeOfResolvedWin32");
const resolveWithCwdWin32 = $bindgen("node_path.bind.ts", "resolveWithCwdWin32");
const tryJoinWin32 = $bindgen("node_path.bind.ts", "tryJoinWin32");
const tryRelativeWin32 = $bindgen("node_path.bind.ts", "tryRelativeWin32");
const tryResolveWin32 = $bindgen("node_path.bind.ts", "tryResolveWin32");
const driveCwd = $bindgen("node_path.bind.ts", "driveCwd");
const removedInitialCwd = $bindgen("node_path.bind.ts", "removedInitialCwd");
const toForeignCwd = $bindgen("node_path.bind.ts", "toForeignCwd");
// On Windows `process.env` is a proxy, which slows down every compiled program whose library code names it.
const getEnvUnlessOfProcess = $newCppFunction("BunProcess.cpp", "jsFunctionGetEnvUnlessOfProcess", 1);

const isWindows = process.platform === "win32";

const CHAR_DOT = 46;
const CHAR_FORWARD_SLASH = 47;
const CHAR_COLON = 58;
const CHAR_QUESTION_MARK = 63;
const CHAR_UPPERCASE_A = 65;
const CHAR_UPPERCASE_Z = 90;
const CHAR_BACKWARD_SLASH = 92;
const CHAR_LOWERCASE_A = 97;
const CHAR_LOWERCASE_Z = 122;

function isWindowsDeviceRoot(code: number) {
  return (
    (code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z) || (code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z)
  );
}

function prepend(first: string, rest: string[]): [string, ...string[]] {
  const all = $newArrayWithSize<string>(rest.length + 1);
  $putByValDirect(all, 0, first);
  for (let i = 0; i < rest.length; i++) $putByValDirect(all, i + 1, rest[i]);
  return all as [string, ...string[]];
}

function coerceToString(value: any): string {
  if (typeof value === "string") return value;
  if ($isUndefinedOrNull(value)) throw new TypeError("String.prototype.charCodeAt called on null or undefined");
  return `${value}`;
}

function processCwd() {
  // The name is in the message if `cwd` is no function.
  const process = $process;
  return removedInitialCwd() ?? process.cwd();
}

function meansCwd(paths: string[]): boolean {
  return paths.length === 0 || (paths.length === 1 && (paths[0] === "" || paths[0] === "."));
}

function formatExt(ext: any) {
  return ext ? `${ext[0] === "." ? "" : "."}${ext}` : "";
}

const ObjectPrototype = $getPrototypeOf({})!;

/** `object[name]`, unless it comes from `Object.prototype`. A proxy answers for itself. */
function memberOf(object: any, name: string) {
  for (let holder = object; holder !== null && holder !== ObjectPrototype; holder = $getPrototypeOf(holder)) {
    if ($isProxyObject(holder) || $Object.$getOwnPropertyDescriptor(holder, name)) return object[name];
  }
}

function _format(sep: string, pathObject: any) {
  // validateObject(), without loading internal/validators.
  if (pathObject === null || $isArray(pathObject) || typeof pathObject !== "object") {
    throw $ERR_INVALID_ARG_TYPE("pathObject", "object", pathObject);
  }
  if (
    CAN_REPLACE_BUILT_INS &&
    ("dir" in ObjectPrototype ||
      "root" in ObjectPrototype ||
      "base" in ObjectPrototype ||
      "name" in ObjectPrototype ||
      "ext" in ObjectPrototype)
  ) {
    pathObject = {
      dir: memberOf(pathObject, "dir"),
      root: memberOf(pathObject, "root"),
      base: memberOf(pathObject, "base"),
      name: memberOf(pathObject, "name"),
      ext: memberOf(pathObject, "ext"),
    };
  }
  const dir = pathObject.dir || pathObject.root;
  const base = pathObject.base || `${pathObject.name || ""}${formatExt(pathObject.ext)}`;
  if (!dir) return `${base}`;
  return dir === pathObject.root ? `${dir}${base}` : `${dir}${sep}${base}`;
}

function resolveWin32WithProcessCwd(paths: string[]): string {
  const cwd = processCwd();
  if (isWindows && paths.length === 0) return cwd;
  const cwdString = coerceToString(cwd);
  const code = cwdString.$charCodeAt(0);
  const startsWithSep = code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
  if (!(paths.length === 0 || (startsWithSep && meansCwd(paths)))) {
    return resolveWithCwdWin32.$apply(undefined, prepend(cwdString, paths));
  }
  return isWindows ? cwd : toForeignCwd(cwdString);
}

// A script can replace String.fromCharCode.
const ASCII_FROM_UPPERCASE_A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz";

function resolveWin32WithDriveCwd(paths: string[], letter: number): string {
  const device = `${ASCII_FROM_UPPERCASE_A[letter - CHAR_UPPERCASE_A]}:`;
  const fromEnv = getEnvUnlessOfProcess(`=${device}`);
  const cwd = (fromEnv === undefined ? driveCwd(letter) : fromEnv) ?? processCwd();
  return resolveWithCwdWin32.$apply(undefined, prepend(cwd === undefined ? `${device}\\` : coerceToString(cwd), paths));
}

/** `this` is the number that `tryResolveWin32` returned. */
function finishResolveWin32(this: number, ...paths: any[]): string {
  if (this >= 0) throw $ERR_INVALID_ARG_TYPE(`paths[${this}]`, "string", paths[this]);
  const letter = ~this;
  return letter === 0 ? resolveWin32WithProcessCwd(paths) : resolveWin32WithDriveCwd(paths, letter);
}

const win32 = {
  resolve() {
    const count = $argumentCount();
    const result =
      count === 1
        ? tryResolveWin32($argument(0))
        : count === 2
          ? tryResolveWin32($argument(0), $argument(1))
          : count === 3
            ? tryResolveWin32($argument(0), $argument(1), $argument(2))
            : tryResolveWin32.$apply(undefined, arguments as any);
    return typeof result === "string" ? result : finishResolveWin32.$apply(result, arguments as any);
  },
  normalize: normalizeWin32,
  isAbsolute: $bindgen("node_path.bind.ts", "isAbsoluteWin32"),
  // No tail call of `normalize`: a replacement that calls `join` has to overflow the stack.
  join() {
    const count = $argumentCount();
    let result =
      count === 2
        ? tryJoinWin32($argument(0), $argument(1))
        : count === 3
          ? tryJoinWin32($argument(0), $argument(1), $argument(2))
          : tryJoinWin32.$apply(undefined, arguments as any);
    if (result === undefined) return ".";
    const normalize = win32.normalize;
    if (normalize !== normalizeWin32) {
      result = normalize.$call(win32, joinUnnormalizedWin32.$apply(undefined, arguments as any));
    }
    return result;
  },
  relative(from: any, to: any) {
    const result = tryRelativeWin32(from, to);
    if (!result && from === to) return "";
    const resolve = win32.resolve;
    if (result !== undefined && resolve === originalResolveWin32) {
      const secondResolve = win32.resolve;
      if (secondResolve === resolve) return result;
      from = resolve(from);
      to = secondResolve.$call(win32, to);
    } else {
      from = resolve.$call(win32, from);
      to = win32.resolve(to);
    }
    return from === to ? "" : relativeOfResolvedWin32(coerceToString(from), coerceToString(to));
  },
  toNamespacedPath(path: any) {
    if (typeof path !== "string" || path.length === 0) return path;
    const resolvedPath = win32.resolve(path);
    if (resolvedPath.length <= 2) return path;
    const text = `${resolvedPath}`;
    const code = text.$charCodeAt(0);
    if (code === CHAR_BACKWARD_SLASH) {
      if (text.$charCodeAt(1) === CHAR_BACKWARD_SLASH) {
        const next = text.$charCodeAt(2);
        if (next !== CHAR_QUESTION_MARK && next !== CHAR_DOT) return `\\\\?\\UNC\\${text.$substr(2)}`;
      }
    } else if (
      isWindowsDeviceRoot(code) &&
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
  matchesGlob: $bindgen("node_path.bind.ts", "matchesGlobWin32"),
  sep: "\\",
  delimiter: ";",
  win32: undefined! as $Node.Win32Path,
  posix: undefined! as $Node.Path,
  _makeLong: undefined! as $Node.Path["_makeLong"],
} as $Node.Win32Path;

function posixCwd() {
  return isWindows ? toForeignCwd(coerceToString(processCwd())) : processCwd();
}

/** `this` is the number that `tryResolvePosix` returned. */
function finishResolvePosix(this: number, ...paths: any[]): string {
  if (this >= 0) throw $ERR_INVALID_ARG_TYPE(`paths[${this}]`, "string", paths[this]);
  if (meansCwd(paths)) {
    const cwd = posixCwd();
    if (coerceToString(cwd).$charCodeAt(0) === CHAR_FORWARD_SLASH) return cwd;
  }
  return resolveWithCwdPosix.$apply(undefined, prepend(coerceToString(posixCwd()), paths));
}

const posix = {
  resolve() {
    const count = $argumentCount();
    const result =
      count === 1
        ? tryResolvePosix($argument(0))
        : count === 2
          ? tryResolvePosix($argument(0), $argument(1))
          : count === 3
            ? tryResolvePosix($argument(0), $argument(1), $argument(2))
            : tryResolvePosix.$apply(undefined, arguments as any);
    return typeof result === "string" ? result : finishResolvePosix.$apply(result, arguments as any);
  },
  normalize: normalizePosix,
  isAbsolute: $bindgen("node_path.bind.ts", "isAbsolutePosix"),
  // No tail call of `normalize`: a replacement that calls `join` has to overflow the stack.
  join() {
    const count = $argumentCount();
    if (count === 1) {
      let path = $argument(0);
      if (typeof path === "string" && path.length !== 0) {
        path = posix.normalize(path);
        return path;
      }
    }
    let result =
      count === 2
        ? tryJoinPosix($argument(0), $argument(1))
        : count === 3
          ? tryJoinPosix($argument(0), $argument(1), $argument(2))
          : tryJoinPosix.$apply(undefined, arguments as any);
    if (result === undefined) return ".";
    const normalize = posix.normalize;
    if (normalize !== normalizePosix) {
      result = normalize.$call(posix, joinUnnormalizedPosix.$apply(undefined, arguments as any));
    }
    return result;
  },
  relative(from: any, to: any) {
    const result = tryRelativePosix(from, to);
    if (!result && from === to) return "";
    const resolve = posix.resolve;
    if (result !== undefined && resolve === originalResolvePosix) {
      const secondResolve = posix.resolve;
      if (secondResolve === resolve) return result;
      from = resolve(from);
      to = secondResolve.$call(posix, to);
    } else {
      from = resolve.$call(posix, from);
      to = posix.resolve(to);
    }
    return from === to ? "" : relativeOfResolvedPosix(coerceToString(from), coerceToString(to));
  },
  toNamespacedPath(path: any) {
    return path;
  },
  dirname: $bindgen("node_path.bind.ts", "dirnamePosix"),
  basename: $bindgen("node_path.bind.ts", "basenamePosix"),
  extname: $bindgen("node_path.bind.ts", "extnamePosix"),
  format: _format.bind(null, "/"),
  parse: $bindgen("node_path.bind.ts", "parsePosix"),
  matchesGlob: $bindgen("node_path.bind.ts", "matchesGlobPosix"),
  sep: "/",
  delimiter: ":",
  win32,
  posix: undefined! as $Node.Path,
  _makeLong: undefined! as $Node.Path["_makeLong"],
} as $Node.Path;

const originalResolveWin32 = win32.resolve;
const originalResolvePosix = posix.resolve;

win32.win32 = win32;
posix.posix = win32.posix = posix;
win32._makeLong = win32.toNamespacedPath;
posix._makeLong = posix.toNamespacedPath;

export default process.platform === "win32" ? win32 : posix;
