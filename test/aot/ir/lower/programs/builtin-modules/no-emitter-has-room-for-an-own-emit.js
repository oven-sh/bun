// Only an emitter that captures rejections has an own `emit`. No store in the library names it on `this` or on a parameter that is handed `this`: a field of that name would stand in every emitter, and every call of `emit` would ask whether it is filled.
// RUN(EMITTER): link
// OPTIONS: builtin-modules
// EMITTER: layout {{*}}kind=Instance name="EventEmitter" {{*}}key="_events"
// EMITTER-NOT: layout {{*}}kind=Instance name="EventEmitter" {{*}}key="emit"

const EventEmitter = require("node:events");
const emitter = new EventEmitter();
let seen = 0;
emitter.on("data", value => {
  seen += value;
});
emitter.emit("data", 2);
console.log(seen);
