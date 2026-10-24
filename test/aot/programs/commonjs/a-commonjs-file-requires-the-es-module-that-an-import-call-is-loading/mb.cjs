globalThis.exportsOfMb = exports;
exports.first = 1;
try {
  console.log("mb: required", Object.keys(require("./ma.mjs")).join());
} catch (error) {
  console.log("mb:", error.name);
}
exports.second = 2;
