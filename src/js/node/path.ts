// Hardcoded module "node:path"
const { validateString } = require("internal/validators");

// src/runtime/node/path.rs implements everything except the functions defined
// below, which are small enough that a native call would cost more than the
// work they do (or, for format(), that the JIT's inline caches beat native
// property lookups on the user's object).
const [nativePosix, nativeWin32] = $rust("path.rs", "createNodePathBinding");

const CHAR_FORWARD_SLASH = 47;
const CHAR_BACKWARD_SLASH = 92;
const CHAR_COLON = 58;
const CHAR_UPPERCASE_A = 65;
const CHAR_UPPERCASE_Z = 90;
const CHAR_LOWERCASE_A = 97;
const CHAR_LOWERCASE_Z = 122;

function isPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
}

function isWindowsDeviceRoot(code) {
  return (
    (code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z) || (code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z)
  );
}

function formatExt(ext) {
  return ext ? `${ext[0] === "." ? "" : "."}${ext}` : "";
}

function _format(sep, pathObject) {
  if (pathObject === null || $isArray(pathObject) || typeof pathObject !== "object") {
    throw $ERR_INVALID_ARG_TYPE("pathObject", "object", pathObject);
  }
  const dir = pathObject.dir || pathObject.root;
  const base = pathObject.base || `${pathObject.name || ""}${formatExt(pathObject.ext)}`;
  if (!dir) {
    return base;
  }
  return dir === pathObject.root ? `${dir}${base}` : `${dir}${sep}${base}`;
}

// posix only; the win32 one is native.
function toNamespacedPath(path) {
  // Non-op on posix systems
  return path;
}

type Glob = import("bun").Glob;

// The functions each platform defines in JS. They are created inside one
// factory so both copies keep their Node.js names ("isAbsolute", not
// "isAbsolute2") after bundling.
function platformFunctions(isWindows: boolean) {
  // The most-recently used glob is memoized in case `matchesGlob` is called in
  // a loop with the same pattern. Each platform keeps its own, since the same
  // pattern compiles differently for win32 (`\` is a separator there).
  let prevGlob: Glob | undefined;
  let prevPattern: string | undefined;

  return {
    isAbsolute: isWindows
      ? function isAbsolute(path) {
          validateString(path, "path");
          const len = path.length;
          if (len === 0) return false;

          const code = path.charCodeAt(0);
          return (
            isPathSeparator(code) ||
            // Possible device root
            (len > 2 &&
              isWindowsDeviceRoot(code) &&
              path.charCodeAt(1) === CHAR_COLON &&
              isPathSeparator(path.charCodeAt(2)))
          );
        }
      : function isAbsolute(path) {
          validateString(path, "path");
          return path.length > 0 && path.charCodeAt(0) === CHAR_FORWARD_SLASH;
        },

    matchesGlob: function matchesGlob(path, pattern) {
      validateString(path, "path");
      if (isWindows) path = path.replaceAll("\\", "/");

      let glob: Glob;
      if (prevGlob !== undefined && prevPattern === pattern) {
        glob = prevGlob;
      } else {
        validateString(pattern, "pattern");
        glob = prevGlob = new Bun.Glob(isWindows ? pattern.replaceAll("\\", "/") : pattern);
        prevPattern = pattern;
      }

      return glob.match(path);
    },
  };
}

const posixJs = platformFunctions(false);
const win32Js = platformFunctions(true);

// Same shape and key order as the objects in Node's lib/path.js.
const posix = {
  resolve: nativePosix.resolve,
  normalize: nativePosix.normalize,
  isAbsolute: posixJs.isAbsolute,
  join: nativePosix.join,
  relative: nativePosix.relative,
  toNamespacedPath,
  dirname: nativePosix.dirname,
  basename: nativePosix.basename,
  extname: nativePosix.extname,
  format: _format.bind(null, "/"),
  parse: nativePosix.parse,
  matchesGlob: posixJs.matchesGlob,
  sep: "/",
  delimiter: ":",
  win32: null as any,
  posix: null as any,
};

const win32 = {
  resolve: nativeWin32.resolve,
  normalize: nativeWin32.normalize,
  isAbsolute: win32Js.isAbsolute,
  join: nativeWin32.join,
  relative: nativeWin32.relative,
  toNamespacedPath: nativeWin32.toNamespacedPath,
  dirname: nativeWin32.dirname,
  basename: nativeWin32.basename,
  extname: nativeWin32.extname,
  format: _format.bind(null, "\\"),
  parse: nativeWin32.parse,
  matchesGlob: win32Js.matchesGlob,
  sep: "\\",
  delimiter: ";",
  win32: null as any,
  posix: null as any,
};

posix.win32 = win32.win32 = win32;
posix.posix = win32.posix = posix;

// Legacy internal API, docs-only deprecated: DEP0080
(win32 as any)._makeLong = win32.toNamespacedPath;
(posix as any)._makeLong = posix.toNamespacedPath;

export default (process.platform === "win32" ? win32 : posix) as any as typeof import("node:path");
