const vm = require("node:vm");
see("file");
sandbox.calls = () => {
  globalThis.inner = import("./inner.mjs");
};
vmParent.evaluate();
sandbox.open();
vm.runInContext("0", vmContext);
see("file behind the checkpoint");
exports.name = "file";
