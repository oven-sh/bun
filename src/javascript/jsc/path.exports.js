function bound(obj) {
  return {
    basename: obj.basename.bind(obj),
    dirname: obj.dirname.bind(obj),
    extname: obj.extname.bind(obj),
    format: obj.format.bind(obj),
    isAbsolute: obj.isAbsolute.bind(obj),
    join: obj.join.bind(obj),
    normalize: obj.normalize.bind(obj),
    parse: obj.parse.bind(obj),
    relative: obj.relative.bind(obj),
    resolve: obj.resolve.bind(obj),
    toNamespacedPath: obj.toNamespacedPath.bind(obj),
    sep: obj.sep,
    delimiter: obj.delimiter,
  };
}
var path = bound(Bun._Path());
path.win32 = win32;
path.posix = posix;
export var posix = bound(Bun._Path(false));
export var win32 = bound(Bun._Path(true));

var {
  basename,
  dirname,
  extname,
  format,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  toNamespacedPath,
  sep,
  delimiter,
} = path;

export {
  basename,
  dirname,
  extname,
  format,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  toNamespacedPath,
  sep,
  delimiter,
};

export default path;
