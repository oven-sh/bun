// Reference: bun build --compile
// Module.prototype._compile loads text that only parses as an ES module in the executable of `bun build --compile` too.
const Module = require("node:module");
const path = require("node:path");

const filename = path.join(__dirname, "no-such-file.js");
const m = new Module(filename);
m._compile(["export const a", "= 1;", "export default typeof require;"].join(" "), filename);
console.log(JSON.stringify({ ...m.exports }));
