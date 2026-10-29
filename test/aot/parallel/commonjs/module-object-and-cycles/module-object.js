countRun("module-object");
exports.atEntry = {
  thisIsExports: this === exports,
  arrowThisIsExports: (() => this)() === exports,
  moduleExportsIsExports: module.exports === exports,
  exportsIsEmpty: Object.keys(exports).length === 0,
  argumentCount: arguments.length,
  idIsFilename: module.id === __filename,
  moduleFilenameIsFilename: module.filename === __filename,
  filename: baseName(__filename),
  filenameIsInDirname: __filename.startsWith(__dirname) && __filename.length === __dirname.length + 1 + baseName(__filename).length,
  isMain: require.main === module,
  mainMarker: require.main.exports.marker,
  resolveType: typeof require.resolve,
  resolvesItself: require.resolve("./module-object.js") === __filename,
};
exports.dirname = __dirname;
exports.self = module;
