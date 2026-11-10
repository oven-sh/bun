import { createHook } from "node:async_hooks";
const lines = [];
let laid;
function told() {
  lines.push("told " + arguments.length + " " + Array.prototype.join.call(arguments, ","));
}
function other() {
  lines.push("other " + arguments.length + " " + Array.prototype.join.call(arguments, ","));
}
process.on("uncaughtException", error => lines.push("uncaught " + error.name));
const hook = createHook({
  init(id, type, trigger, resource) {
    if (type !== "TickObject" || resource.callback !== told) return;
    if (laid.args !== "kept") resource.args = laid.args;
    if (laid.callback) resource.callback = laid.callback;
  },
});
function ask(args, callback, ...given) {
  laid = { args, callback };
  hook.enable();
  process.nextTick(told, ...given);
  hook.disable();
}
ask("kept", undefined);
ask("kept", undefined, "a");
ask("kept", undefined, "a", "b", "c", "d");
ask("kept", undefined, "a", "b", "c", "d", "e");
ask(["list"], undefined, "a");
ask({ length: 1, 0: "one" }, undefined, "a");
ask({ length: 2, 0: "one", 1: "two" }, undefined, "a");
ask({ length: 3, 0: "one", 1: "two", 2: "three" }, undefined, "a");
ask({ length: 4, 0: "one", 1: "two", 2: "three", 3: "four" }, undefined, "a");
ask({ length: 5, 0: "one" }, undefined, "a");
ask({ length: 0 }, undefined, "a");
ask({ length: "2", 0: "one", 1: "two" }, undefined, "a");
ask({}, undefined, "a");
ask(undefined, undefined, "a");
ask(null, undefined, "a");
ask("kept", other, "a", "b");
ask({ length: 2, 0: "one", 1: "two" }, other, "a");
process.nextTick(told, 1, 2, 3, 4);
process.nextTick(told, 1, 2, 3, 4, 5);
setTimeout(() => {
  console.log(lines.join("\n"));
  process.exit(0);
}, 20);
