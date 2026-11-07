// Alone: what an executable leaves out goes by all that it holds
const Module = require("node:module");
const original = Module.prototype.require;
let receiver;
Object.defineProperty(Module.prototype, "require", { get() { receiver = this; return original; }, configurable: true, enumerable: true });
console.log(typeof require(process.env.NO_SUCH_VARIABLE ?? "node:path").sep, receiver === module);
