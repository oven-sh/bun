let held = { name: "first" };
Object.defineProperty(module, "exports", {
  get() {
    globalThis.reads = (globalThis.reads ?? 0) + 1;
    return held;
  },
  set(value) {
    globalThis.sets = (globalThis.sets ?? 0) + 1;
    held = value;
  },
});
module.exports = { name: "second" };
