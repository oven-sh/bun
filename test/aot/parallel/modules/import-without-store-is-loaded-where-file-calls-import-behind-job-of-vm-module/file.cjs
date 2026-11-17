const vm = require("node:vm");
see("file");
vmParent.evaluate();
sandbox.open();
vm.runInContext("0", vmContext);
see("file behind the checkpoint");
globalThis.inner = import("./inner.mjs");
see("file behind import()");
exports.name = "file";
