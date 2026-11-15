// STATISTIC: FunctionsLowered <= 1500
// `globalThis.process?.env` as esbuild compiles it down, in a function.
function read() {
  var _a;
  return (_a = globalThis.process) == null ? void 0 : _a.env;
}
console.log(typeof read());
