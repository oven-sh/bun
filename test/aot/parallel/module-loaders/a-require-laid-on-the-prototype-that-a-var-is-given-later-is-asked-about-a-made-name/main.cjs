// Module.prototype goes into a `var` that was declared without a value, and require is replaced on it: a require() under a name made at run time asks the stored function.
// Todo: "none" | "./subject.js": a wrong answer today: under `bun build --compile --aot` it prints "none", where `bun <file>` prints "./subject.js". The build finds no store here and has no TS100080. With `let`, or with a first value, it prints "./subject.js"
const Module = require("node:module");
const asked = [];
var prototype;
prototype = Module.prototype;
const original = prototype.require;
prototype.require = function (request) {
  asked.push(request);
  return original.call(this, request);
};
if (process.argv.length > 99) require("./subject.js");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"subject"') + ".js");
console.log(got.value, asked.join() || "none");
