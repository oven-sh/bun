const { test } = require("bun:test");
const Module = require("node:module");
const original = Module._resolveFilename;
function install(m) { m._resolveFilename = function (request, ...rest) { return original.call(this, request === "./dep.cjs" ? "./other.cjs" : request, ...rest); }; }
install(Module);
const { imported } = require("./imports.mjs");
const { said } = require("./dep.cjs");
test("the require is sent elsewhere, the import is not asked", () => { console.log("SAID", said, require("./dep.cjs").said, imported()); });
