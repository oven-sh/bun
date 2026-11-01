// Flags: --aot-validate
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=1
const util = require("node:util");
function queued(text) {
  const box = { text };
  return new process.nextTick(() => console.log("queued by new", box.text));
}
function Base() {}
function Derived() {}
function inherited() {
  const before = Derived.super_;
  const made = new util.inherits(Derived, Base);
  return [typeof made, before === undefined, Derived.super_ === Base].join();
}
console.log(typeof queued("one"), typeof queued("two"));
console.log(inherited());
