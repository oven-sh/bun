// A store inside a pattern replaces Module._resolveFilename as an assignment does: a require() under a name made at run time asks the stored function.
const Module = require("node:module");
const asked = [];
const original = Module._resolveFilename;
[Module._resolveFilename] = [
  function (request, ...rest) {
    asked.push(request);
    return original.call(this, request, ...rest);
  },
];
if (process.argv.length > 99) require("./subject.js");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"subject"') + ".js");
console.log(got.value, asked.join());
