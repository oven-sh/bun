// Object.assign stores an element under an index into objects whose prototype has a setter or a read-only element under that index, and a property under a name.
let log = "";
const above = {};
Object.defineProperty(above, 0, {
  set(given) {
    log += "the setter ran with " + given;
  },
  configurable: true,
});
const assigned = Object.assign(Object.create(above), { 0: 1 });
console.log("an accessor above:", Object.hasOwn(assigned, 0), log);

const fixed = {};
Object.defineProperty(fixed, 0, { value: "fixed", writable: false });
try {
  console.log(
    "a member above that cannot be written:",
    Object.hasOwn(Object.assign(Object.create(fixed), { 0: 1 }), 0),
  );
} catch (error) {
  console.log("a member above that cannot be written:", error.constructor.name);
}

log = "";
const named = {};
Object.defineProperty(named, "x", {
  set(given) {
    log += "the setter ran with " + given;
  },
});
console.log("under a name:", Object.hasOwn(Object.assign(Object.create(named), { x: 1 }), "x"), log);
