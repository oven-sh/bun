const { test } = require("bun:test");
const Module = require("node:module");
const original = Module.prototype.require;
function install(m) { m.prototype.require = function (request) { return original.call(this, request === "./dep" ? "./other" : request); }; }
install(Module);
const dep = require("./dep");
test("the constant require asks the hook", () => { console.log("SAID", dep); });
