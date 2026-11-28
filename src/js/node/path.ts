// Hardcoded module "node:path"
// https://github.com/nodejs/node/blob/v26.12.1/lib/path.js
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
      win32: Path;
      posix: Path;
      _makeLong<T>(path: T): T;
    }
  }
}

const CHAR_DOT = 46;
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
    "dir" in ObjectPrototype ||
    "root" in ObjectPrototype ||
    "base" in ObjectPrototype ||
    "name" in ObjectPrototype ||
    "ext" in ObjectPrototype
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

const win32 = {
  resolve: $bindgen("node_path.bind.ts", "resolveWin32"),
  normalize: $bindgen("node_path.bind.ts", "normalizeWin32"),
  isAbsolute: $bindgen("node_path.bind.ts", "isAbsoluteWin32"),
  join: $bindgen("node_path.bind.ts", "joinWin32"),
  relative: $bindgen("node_path.bind.ts", "relativeWin32"),
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
  win32: undefined! as $Node.Path,
  posix: undefined! as $Node.Path,
  _makeLong: undefined! as $Node.Path["_makeLong"],
} as $Node.Path;

const posix = {
  resolve: $bindgen("node_path.bind.ts", "resolvePosix"),
  normalize: $bindgen("node_path.bind.ts", "normalizePosix"),
  isAbsolute: $bindgen("node_path.bind.ts", "isAbsolutePosix"),
  join: $bindgen("node_path.bind.ts", "joinPosix"),
  relative: $bindgen("node_path.bind.ts", "relativePosix"),
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

win32.win32 = win32;
posix.posix = win32.posix = posix;
win32._makeLong = win32.toNamespacedPath;
posix._makeLong = posix.toNamespacedPath;

$bindgen("node_path.bind.ts", "registerModule")(posix, win32);

export default process.platform === "win32" ? win32 : posix;
