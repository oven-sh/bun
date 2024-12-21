// Hardcoded module "node:path"
const { validateString } = require("internal/validators");

const [bindingPosix, bindingWin32] = $cpp("Path.cpp", "createNodePathBinding");
const toNamespacedPathPosix = bindingPosix.toNamespacedPath.bind(bindingPosix);
const toNamespacedPathWin32 = bindingWin32.toNamespacedPath.bind(bindingWin32);
const posix = {
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

let LazyGlob: Glob | undefined;
function loadGlob(): LazyGlob {
  LazyGlob = require("bun").Glob;
}

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
      if (LazyGlob === undefined) loadGlob();
      validateString(pattern, "pattern");
      if (isWindows) pattern = pattern.replaceAll("\\", "/");
      glob = prevGlob = new LazyGlob(pattern);
      prevPattern = pattern;
    }
  } else {
    loadGlob(); // no prevGlob implies LazyGlob isn't loaded
    validateString(pattern, "pattern");
    if (isWindows) pattern = pattern.replaceAll("\\", "/");
    glob = prevGlob = new LazyGlob(pattern);
    prevPattern = pattern;
  }

  return glob.match(path);
}

// posix.matchesGlob = win32.matchesGlob = matchesGlob;
posix.matchesGlob = matchesGlob.bind(null, false);
win32.matchesGlob = matchesGlob.bind(null, true);

export default process.platform === "win32" ? win32 : posix;
