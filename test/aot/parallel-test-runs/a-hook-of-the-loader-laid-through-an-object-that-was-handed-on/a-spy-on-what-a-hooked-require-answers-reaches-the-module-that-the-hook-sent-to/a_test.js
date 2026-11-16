const { test, spyOn } = require("bun:test");
const Module = require("node:module");
const original = Module._resolveFilename;
function install(m) { m._resolveFilename = function (request, ...rest) { return original.call(this, request === "./a" ? "./other.mjs" : request, ...rest); }; }
install(Module);
const { calls } = require("./third.mjs");
test("a spy on what the hooked require answers is seen by an import of the module that the hook sent to", () => {
  const spy = spyOn(require("./a"), "f").mockImplementation(() => "spied");
  console.log("SAID", calls());
  spy.mockRestore();
  console.log("SAID", calls());
});
