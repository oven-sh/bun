// require() of a data file answers the parsed value until a loaded ES module imports the file, and then its namespace object. Each file below is named by one import() that may not run, so the answer is decided at run time.
function kind(value) {
  return Object.prototype.toString.call(value) + " " + JSON.stringify(value);
}
console.log(kind(require("./before.json")));
await import("./loads-after.mjs");
console.log(kind(require("./after.json")));
console.log(kind(require("./after.json")));
console.log(kind(require("./named-by-no-loaded-module.json")));
if (process.argv.length > 9) {
  await Promise.all([import("./before.json"), import("./after.json"), import("./named-by-no-loaded-module.json"), import("./never-loaded.mjs")]);
}
