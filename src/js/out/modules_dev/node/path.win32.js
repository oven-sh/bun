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
}, path = bound(Bun._Path(!0)), {
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
} = path, path_win32_default = path;
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

//# debugId=DBE944F8FDF34D1C64756e2164756e21
