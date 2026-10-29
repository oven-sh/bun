// A file is loaded by a computed name before its static require.
const name = "./a" + (Date.now() > 0 ? ".cjs" : "");
console.log("by name", require(name).x, globalThis.ran);
console.log("static", require("./a.cjs").x, require("./b.cjs").y, globalThis.ran);
