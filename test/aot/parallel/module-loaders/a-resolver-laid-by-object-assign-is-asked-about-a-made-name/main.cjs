const Module = require("node:module");
const path = require("node:path");
const asked = [];
const original = Module._resolveFilename;
Object.assign(Module, { _resolveFilename(request, ...rest) { asked.push(request); return original.call(this, request, ...rest); } });
if (process.argv.length > 99) require("./subject.js");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js");
console.log(got.value, asked.join());
