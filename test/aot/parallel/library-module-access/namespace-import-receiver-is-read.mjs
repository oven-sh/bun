// process.on reads its receiver, which here is the namespace object of node:process.
import * as process2 from "node:process";
import * as events from "node:events";
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return error.name;
  }
}
console.log(
  attempt(() => typeof process2.cwd()),
  attempt(() => process2.on("x", () => {}) === undefined),
  attempt(() => process2.emit("x")),
);
console.log(
  attempt(() => events.listenerCount(new events.EventEmitter(), "x")),
  attempt(() => typeof events.once),
);
