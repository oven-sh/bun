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
  return result.default = result, result;
}, createModule = (obj) => Object.assign(Object.create(null), obj), path = bound(Bun._Path()), posix = bound(Bun._Path(!1)), win32 = bound(Bun._Path(!0));
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
path.__esModule = !0;
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
  createModule,
  basename,
  __esModule
};

//# debugId=036C77302B4E5C6F64756e2164756e21
