// require() of a data file answers its namespace object once a loaded ES module imports the file. So it is where require() loaded that module, in a statement that takes nothing of it.
require("./imports-json.mjs");
console.log(Object.keys(require("./data.json")).join());
require("./below.cjs");
console.log(Object.keys(require("./never-imported.json")).join());
