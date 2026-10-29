// `Object.defineProperty(this, "x", { enumerable: true, configurable: true, writable: true, value: 1 })`, as TypeScript writes a class field for older targets: a descriptor that says constants alone defines what any other does.
class Fields {
  constructor() {
    Object.defineProperty(this, "a", { enumerable: true, configurable: true, writable: true, value: 1 });
    Object.defineProperty(this, "b", { enumerable: true, configurable: true, writable: true, value: void 0 });
    Object.defineProperty(this, "c", { enumerable: false, configurable: true, writable: true, value: "c" });
    Object.defineProperty(this, "d", { enumerable: true, configurable: false, writable: false, value: null });
    Object.defineProperty(this, "e", { value: 5 });
    Object.defineProperty(this, "f", {});
    Object.defineProperty(this, 0, { enumerable: true, value: "zero" });
  }
}
class Heir extends Fields {
  constructor() {
    super();
    Object.defineProperty(this, "a", { enumerable: true, configurable: true, writable: true, value: 2 });
    Object.defineProperty(this, "g", { enumerable: true, configurable: true, writable: true, value: true });
  }
}
function describe(object) {
  return Reflect.ownKeys(object).map(key => {
    const d = Object.getOwnPropertyDescriptor(object, key);
    return `${String(key)}:${"value" in d ? JSON.stringify(d.value) ?? "undefined" : "accessor"}${d.enumerable ? "e" : "-"}${d.configurable ? "c" : "-"}${d.writable ? "w" : "-"}`;
  }).join(" ");
}
function attempt(work) {
  try { return String(work()); } catch (error) { return error.constructor.name; }
}
let sum = 0;
for (let i = 0; i < 300; i++) { const made = i & 1 ? new Heir() : new Fields(); made.a += i; sum += made.a + made.e + Object.keys(made).length; }
console.log(sum, describe(new Fields()), "|", describe(new Heir()), JSON.stringify(new Heir()));

const made = new Fields();
console.log(attempt(() => { "use strict"; made.d = 1; }), attempt(() => { "use strict"; made.e = 1; }), attempt(() => delete made.c), attempt(() => { "use strict"; return delete made.d; }), describe(made));
console.log(attempt(() => Object.defineProperty(made, "d", { value: 1 })), attempt(() => Object.defineProperty(made, "d", { value: null }) === made), attempt(() => Object.defineProperty(made, "e", { enumerable: true })),
  attempt(() => Reflect.defineProperty(made, "e", { enumerable: true })), attempt(() => Reflect.defineProperty(made, "h", { value: 8, writable: true })), describe(made));

const withSetter = { set s(v) { this.seen = v; }, get s() { return 1; } };
Object.defineProperty(withSetter, "s", { value: 3 });
const belowSetter = Object.create({ set t(v) { throw new Error("the setter ran"); } });
Object.defineProperty(belowSetter, "t", { enumerable: true, configurable: true, writable: true, value: 4 });
console.log(describe(withSetter), describe(belowSetter), belowSetter.t);

console.log(attempt(() => Object.defineProperty(Object.freeze({}), "x", { value: 1 })), attempt(() => Object.defineProperty(Object.preventExtensions({ x: 0 }), "x", { value: 1 }).x), attempt(() => Reflect.defineProperty(Object.freeze({}), "x", { value: 1 })),
  attempt(() => Object.defineProperty(1, "x", { value: 1 })), attempt(() => Object.defineProperty(undefined, "x", { value: 1 })), attempt(() => Reflect.defineProperty(null, "x", { value: 1 })));

const list = [1, 2, 3];
Object.defineProperty(list, "length", { value: 1 });
Object.defineProperty(list, 4, { enumerable: true, configurable: true, writable: true, value: 9 });
console.log(JSON.stringify(list), list.length, attempt(() => Object.defineProperty(list, "length", { value: -1 })), attempt(() => Object.defineProperty(Object.freeze([1]), 0, { value: 2 })));

const logged = [];
const watched = new Proxy({}, { defineProperty(target, key, descriptor) { logged.push(key + ":" + Object.keys(descriptor).sort().join()); return Reflect.defineProperty(target, key, descriptor); } });
Object.defineProperty(watched, "p", { enumerable: true, value: 1 });
Object.defineProperty(watched, "q", {});
console.log(logged.join(" "), describe(watched));

function order() {
  const steps = [];
  Object.defineProperty((steps.push("object"), {}), (steps.push("key"), { toString() { steps.push("key to text"); return "k"; } }), { value: 1 });
  return steps.join();
}
console.log(order(), attempt(() => Object.defineProperty({}, "x", { value: 1, get: undefined })), attempt(() => Object.defineProperty({}, "x", { get: 1 })), attempt(() => describe(Object.defineProperty({}, "x", { get: undefined, enumerable: true }))));
const marked = {};
Object.defineProperty(marked, "__esModule", { value: true });
Object.defineProperty(marked, Symbol.toStringTag, { value: "Module" });
console.log(describe(marked), String(marked), marked.__esModule);
