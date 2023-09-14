// Hardcoded module "node:path"
function bound(obj) {
  const toNamespacedPath = obj.toNamespacedPath.bind(obj);
  const result = {
    resolve: obj.resolve.bind(obj),
    normalize: obj.normalize.bind(obj),
    isAbsolute: obj.isAbsolute.bind(obj),
    join: obj.join.bind(obj),
    relative: obj.relative.bind(obj),
    toNamespacedPath,
    dirname: obj.dirname.bind(obj),
    basename: obj.basename.bind(obj),
    extname: obj.extname.bind(obj),
    format: obj.format.bind(obj),
    parse: obj.parse.bind(obj),
    sep: obj.sep,
    delimiter: obj.delimiter,
    win32: undefined,
    posix: undefined,
    _makeLong: toNamespacedPath,
  };
  return result;
}

const posix: any = bound(Bun._Path(false));
const win32: any = bound(Bun._Path(true));

posix.win32 = win32.win32 = win32;
posix.posix = win32.posix = posix;

export default process.platform === "win32" ? win32 : posix;
