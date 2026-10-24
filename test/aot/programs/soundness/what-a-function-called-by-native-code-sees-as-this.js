// What `this` is, and how many arguments arrive, in a function that native code calls.
"use strict";
const lines = [];
function note(label) {
  return function () {
    const kind = this === undefined ? "undefined" : this === null ? "null" : typeof this;
    lines.push(
      `${label}: this ${kind}${kind === "object" ? " " + Object.prototype.toString.call(this) : ""}, ${arguments.length} arguments`,
    );
  };
}
setTimeout(note("setTimeout"), 0);
setTimeout(note("setTimeout with two more"), 0, 1, 2);
const interval = setInterval(function () {
  clearInterval(interval);
  note("setInterval").apply(this, arguments);
}, 0);
setImmediate(note("setImmediate"));
queueMicrotask(note("queueMicrotask"));
process.nextTick(note("process.nextTick"));
process.nextTick(note("process.nextTick with one more"), 1);
Promise.resolve(1).then(note("then"));
Promise.reject(1).catch(note("catch"));
Promise.resolve(1).finally(note("finally"));
[1].forEach(note("forEach"));
[1].forEach(note("forEach with an object"), {});
new Map([[1, 2]]).forEach(note("Map forEach"));
[2, 1].sort(note("sort"));
"a".replace(/a/, note("replace"));
JSON.parse("[1]", note("reviver"));
JSON.stringify({ a: 1 }, note("replacer"));
Array.from([1], note("Array.from"));
Reflect.apply(note("Reflect.apply"), 5, []);
const target = new EventTarget();
target.addEventListener("ping", note("addEventListener"));
target.dispatchEvent(new Event("ping"));
const controller = new AbortController();
controller.signal.addEventListener("abort", note("abort listener"));
controller.signal.onabort = note("onabort");
controller.abort();
process.on("exit", note("process exit"));
process.on("beforeExit", function () {
  if (lines.done) return;
  lines.done = true;
  note("process beforeExit").apply(this, arguments);
});
new FinalizationRegistry(note("registry"));
structuredClone({
  get a() {
    note("getter in structuredClone").call(this);
    return 1;
  },
});
process.on("exit", () => console.log(lines.join("\n")));
