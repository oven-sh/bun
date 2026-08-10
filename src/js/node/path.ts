// Hardcoded module "node:path"
const { validateString } = require("internal/validators");

// Path.cpp implements everything except the functions below, which are small
// enough that a native call would cost more than the work they do.
const [posix, win32] = $cpp("Path.cpp", "createNodePathBinding");

const ArrayIsArray = Array.isArray;

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

// Wrapped so both keep the name "isAbsolute" after bundling.
const [posixIsAbsolute, win32IsAbsolute] = (() => {
  const posix = function isAbsolute(path) {
    validateString(path, "path");
    return path.length > 0 && path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  };
  return [
    posix,
    function isAbsolute(path) {
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
    },
  ];
})();

const posixToNamespacedPath = function toNamespacedPath(path) {
  // Non-op on posix systems
  return path;
};

function formatExt(ext) {
  return ext ? `${ext[0] === "." ? "" : "."}${ext}` : "";
}

// Kept in JS: property loads and string concatenation on a user object are
// exactly what the JIT's inline caches are for.
function _format(sep, pathObject) {
  if (pathObject === null || ArrayIsArray(pathObject) || typeof pathObject !== "object") {
    throw $ERR_INVALID_ARG_TYPE("pathObject", "object", pathObject);
  }
  const dir = pathObject.dir || pathObject.root;
  const base = pathObject.base || `${pathObject.name || ""}${formatExt(pathObject.ext)}`;
  if (!dir) {
    return base;
  }
  return dir === pathObject.root ? `${dir}${base}` : `${dir}${sep}${base}`;
}

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

posix.isAbsolute = posixIsAbsolute;
posix.toNamespacedPath = posixToNamespacedPath;
posix.format = _format.bind(null, "/");
posix.matchesGlob = matchesGlob.bind(null, false);
posix.sep = "/";
posix.delimiter = ":";

win32.isAbsolute = win32IsAbsolute;
win32.format = _format.bind(null, "\\");
win32.matchesGlob = matchesGlob.bind(null, true);
win32.sep = "\\";
win32.delimiter = ";";

posix.win32 = win32.win32 = win32;
posix.posix = win32.posix = posix;

// Legacy internal API, docs-only deprecated: DEP0080
win32._makeLong = win32.toNamespacedPath;
posix._makeLong = posix.toNamespacedPath;

export default (process.platform === "win32" ? win32 : posix) as any as typeof import("node:path");
