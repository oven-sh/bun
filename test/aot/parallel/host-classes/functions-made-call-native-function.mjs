// A function that is made for one call of a native function. The native function looks at it and keeps nothing, so nothing else in the program ever holds it.
function drop(listener) {
  removeEventListener("nothing", listener);
}
function dropThrough(listener) {
  drop(listener);
}

removeEventListener("nothing", () => {});
removeEventListener("nothing", function named() {});
globalThis.removeEventListener("nothing", () => {});
self.removeEventListener("nothing", () => {});
const remove = removeEventListener;
remove("nothing", () => {});
drop(() => {});
drop(() => 1);
dropThrough(() => 2);
console.log("removed before any was added");

addEventListener("added", () => {});
removeEventListener("added", () => {});
let captured = 0;
removeEventListener("added", () => captured++);
for (let i = 0; i < 3; i++) removeEventListener("added", () => i);
console.log("removed behind another one", captured);

performance.removeEventListener("nothing", () => {});
new EventTarget().removeEventListener("nothing", () => {});
new AbortController().signal.removeEventListener("abort", () => {});
new MessageChannel().port1.removeEventListener("message", () => {});
console.log("removed from other targets");

clearTimeout(() => {});
clearInterval(() => {});
clearImmediate(() => {});
console.log(
  Bun.deepEquals(() => {}, () => {}),
  new Map().get("key", () => {}),
  new Map().has(() => {}),
  new Set().has(() => {}),
  new WeakMap().has(() => {}),
  new WeakSet().delete(() => {}),
  Array.isArray(() => {}),
  Buffer.isBuffer(() => {}),
  ArrayBuffer.isView(() => {}),
);

let calls = 0;
const listener = () => calls++;
addEventListener("ping", listener);
dispatchEvent(new Event("ping"));
removeEventListener("ping", listener);
dispatchEvent(new Event("ping"));
console.log("the listener ran", calls);
