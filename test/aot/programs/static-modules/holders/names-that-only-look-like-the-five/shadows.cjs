function callsParameter(require) {
  return require("./x.cjs");
}
function storesToParameter(exports) {
  exports.n = "on the parameter";
  return exports;
}
function storesToLocalModule() {
  const module = { exports: {} };
  module.exports.n = "on the local";
  module.exports = "replaced";
  return module.exports;
}
exports.results = [callsParameter(name => name.length), storesToParameter({}).n, storesToLocalModule(), exports.n].join();
{
  const exports = { n: "block" };
  exports.m = 1;
}
exports.fromTheBlock = exports.m;
