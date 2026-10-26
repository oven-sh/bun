// console.log shows arrows, getters, setters and bound functions of built-in modules the same way as `bun run`.
const getterOf = (object, key) => Object.getOwnPropertyDescriptor(object, key).get;
const timers = require("node:timers/promises");
console.log(timers.scheduler);
console.log(timers.scheduler.wait.name);
console.log(getterOf(require("node:async_hooks").AsyncLocalStorage.prototype, "name"));
console.log(getterOf(require("node:fs").Dir.prototype, "path"));
console.log(Object.getOwnPropertyDescriptor(require("node:fs"), "ReadStream"));
console.log(require("node:events").EventEmitter.prototype.emit);
console.log(require("node:path").join);
console.log(require("node:stream").Readable.prototype.map, require("node:stream").Readable.prototype.toArray);
console.log(process.stdout._writableState.onwrite);
console.log({ wait: () => 1, get own() { return 1; } }.wait, getterOf({ get own() { return 1; } }, "own"));
