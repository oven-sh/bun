/**
 * Browser polyfill for the `"path"` module.
 *
 * Imported on usage in `bun build --target=browser`
 */
import * as PathModule from "path-browserify";

const bindingPosix = PathModule;
const bindingWin32 = PathModule;

// path-browserify doesn't implement toNamespacedPath
const toNamespacedPathPosix = function (a) {
  return a;
};
// path-browserify doesn't implement parse
const parseFn = function () {
  throw new Error("Not implemented");
};

bindingPosix.parse ??= parseFn;
bindingWin32.parse ??= parseFn;

export const posix = {
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
};
export const win32 = {
  sep: "\\",
  delimiter: ";",
  win32: undefined,
  ...posix,
  posix,
};
posix.win32 = win32.win32 = win32;
posix.posix = posix;

export default posix;
export const {
  resolve,
  normalize,
  isAbsolute,
  join,
  relative,
  toNamespacedPath,
  dirname,
  basename,
  extname,
  format,
  parse,
  sep,
  delimiter,
} = posix;
