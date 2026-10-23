// Hardcoded module "node:path"
const { validateString } = require("internal/validators");

const [bindingPosix, bindingWin32] = $cpp("Path.cpp", "createNodePathBinding");
const toNamespacedPathPosix = bindingPosix.toNamespacedPath.bind(bindingPosix);
const toNamespacedPathWin32 = bindingWin32.toNamespacedPath.bind(bindingWin32);

type Glob = import("bun").Glob;

// One memo per flavour: posix passes `\` in a pattern to Bun.Glob as an escape, win32 reads a separator, as Node.js does in both flavours: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/glob.js#L938
let posixGlob: Glob | undefined;
let posixPattern: string | undefined;
let win32Glob: Glob | undefined;
let win32Pattern: string | undefined;

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
  matchesGlob(path, pattern) {
    validateString(path, "path");
    let glob: Glob;
    if (posixGlob !== undefined && posixPattern === pattern) {
      glob = posixGlob;
    } else {
      validateString(pattern, "pattern");
      glob = posixGlob = new Bun.Glob(pattern);
      posixPattern = pattern;
    }
    return glob.match(path);
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
  matchesGlob(path, pattern) {
    validateString(path, "path");
    path = path.replaceAll("\\", "/");
    let glob: Glob;
    if (win32Glob !== undefined && win32Pattern === pattern) {
      glob = win32Glob;
    } else {
      validateString(pattern, "pattern");
      glob = win32Glob = new Bun.Glob(pattern.replaceAll("\\", "/"));
      win32Pattern = pattern;
    }
    return glob.match(path);
  },
  sep: "\\",
  delimiter: ";",
  win32: undefined as typeof win32,
  posix,
  _makeLong: toNamespacedPathWin32,
};
posix.win32 = win32.win32 = win32;
posix.posix = posix;

export default (process.platform === "win32" ? win32 : posix) as any as typeof import("node:path");
