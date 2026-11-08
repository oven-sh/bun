const { test } = require("bun:test");
const Module = require("node:module");
const original = Module._resolveFilename;
function install(m) { m._resolveFilename = function (request, ...rest) { return original.call(this, request === "./dep" ? "./other" : request, ...rest); }; }
install(Module);
const dep = require("./dep");
test("the constant require asks the hook", () => { console.log("SAID", dep); });
