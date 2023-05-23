// src/js/node/path.posix.js
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
var path = bound(Bun._Path(false));
path[Symbol.for("CommonJS")] = 0;
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
var path_posix_default = path;
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
  path_posix_default as default,
  basename
};

//# debugId=83048B41DC9CEC8F64756e2164756e21
