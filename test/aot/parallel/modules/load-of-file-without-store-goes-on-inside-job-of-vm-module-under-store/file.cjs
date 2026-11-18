const vm = require("node:vm");
see("file");
sandbox.calls = () => {
  globalThis.inner = import("./inner.mjs");
};
store.run("V", () => vmParent.evaluate());
see("file behind evaluate()");
sandbox.open();
vm.runInContext("0", vmContext);
see("file behind the checkpoint");
exports.name = "file";
