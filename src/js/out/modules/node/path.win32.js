// src/js/node/path.win32.js
var bound = function(obj) {
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
    delimiter: obj.delimiter
  };
};
var path = bound(Bun._Path(true));
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
  delimiter
} = path;
var path_win32_default = path;
export {
  toNamespacedPath,
  sep,
  resolve,
  relative,
  parse,
  normalize,
  join,
  isAbsolute,
  format,
  extname,
  dirname,
  delimiter,
  path_win32_default as default,
  basename
};

//# debugId=2F1B5C9FEAA5F45664756e2164756e21
