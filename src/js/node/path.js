// Hardcoded module "node:path"

// Utils to extract later
const createModule = obj => Object.assign(Object.create(null), obj);

function bound(obj) {
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
    delimiter: obj.delimiter,
  });
  result.default = result;
  return result;
}
var path = bound(Bun._Path());

export var posix = bound(Bun._Path(false));
export var win32 = bound(Bun._Path(true));

path.win32 = win32;
path.posix = posix;

export var {
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
  __esModule,
} = path;

path[Symbol.for("CommonJS")] = 0;
path.__esModule = true;
export default path;
