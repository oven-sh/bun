// src/js/node/path.js
var bound = function(obj) {
  var result = createModule({
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
  });
  result.default = result;
  return result;
};
var createModule = (obj) => Object.assign(Object.create(null), obj);
var path = bound(Bun._Path());
var posix = bound(Bun._Path(false));
var win32 = bound(Bun._Path(true));
path.win32 = win32;
path.posix = posix;
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
  __esModule
} = path;
path[Symbol.for("CommonJS")] = 0;
path.__esModule = true;
var path_default = path;
export {
  win32,
  toNamespacedPath,
  sep,
  resolve,
  relative,
  posix,
  parse,
  normalize,
  join,
  isAbsolute,
  format,
  extname,
  dirname,
  delimiter,
  path_default as default,
  basename,
  __esModule
};

//# debugId=81C88F734FCC612F64756e2164756e21
