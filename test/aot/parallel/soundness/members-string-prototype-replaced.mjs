// String.prototype reaches four parameters through ten calls, long after a value that the compiler cannot follow; members that can be replaced are written there under keys out of a list and then called on a string. ../../flow-schedules-beside-a-hidden-value.test.ts builds it under four schedules.
// Alone: what it prints depends on what else the executable holds: another program that writes to String.prototype unlocks the same members
const hide = value => new CustomEvent("x", { detail: value }).detail;
const ways = {
  store(object, key, value) {
    hide(object);
    object[key] = value;
  },
  define(object, key, value) {
    hide(object);
    Object.defineProperty(object, key, { value, writable: true, configurable: true });
  },
  set(object, key, value) {
    hide(object);
    return Reflect.set(object, key, value);
  },
  remove(object, key) {
    hide(object);
    delete object[key];
  },
};
for (const way in ways) ways[way](hide({ a: 1 }), hide("a"), 1);
const l0 = { get: () => String.prototype };
const l1 = { get: () => l0.get() };
const l2 = { get: () => l1.get() };
const l3 = { get: () => l2.get() };
const l4 = { get: () => l3.get() };
const l5 = { get: () => l4.get() };
const l6 = { get: () => l5.get() };
const l7 = { get: () => l6.get() };
const l8 = { get: () => l7.get() };
const l9 = { get: () => l8.get() };
for (const [way, key] of [
  ["store", "at"],
  ["define", "trim"],
  ["set", "bold"],
  ["remove", "link"],
  ["store", "trimStart"],
  ["define", "trimEnd"],
]) {
  try {
    console.log(
      way,
      key,
      String(
        ways[way](l9.get(), key, function () {
          return way + " " + key;
        }),
      ),
      typeof "x"[key] === "function" ? "x"[key](0) : typeof "x"[key],
    );
  } catch (error) {
    console.log(way, key, error.name, String(error.message).includes("read-only in a compiled executable"));
  }
}
