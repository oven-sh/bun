// A strict store from outside a context, and a store of a symbol inside it, reach the contextified object only for a name that it declares. A compiled object declares what stands above import.meta, as a plain one does.
import vm from "node:vm";
class K { own = 1; }
function F() { this.own = 1; }
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
const shapes = {
  literal: () => ({ own: 1, __proto__: import.meta }),
  ofClass: () => Object.setPrototypeOf(new K(), import.meta),
  ofFunction: () => Object.setPrototypeOf(new F(), import.meta),
  relinkedLiteral: () => Object.setPrototypeOf({ own: 2 }, import.meta),
  throughPlain: () => ({ own: 1, __proto__: Object.create(import.meta) }),
  plainBelowCompiled: () => Object.create({ own: 1, __proto__: import.meta }),
  twoCompiled: () => ({ own: 1, __proto__: { other: 2, __proto__: import.meta } }),
  // An array answers for its own properties itself, in plain code too: behind it import.meta is asked, and says null.
  belowArray: () => ({ own: 1, __proto__: Object.setPrototypeOf([1], import.meta) }),
  // A Proxy declares every name.
  belowProxy: () => ({ own: 1, __proto__: new Proxy(Object.create(import.meta), {}) }),
  meta: () => Object.create(import.meta),
  plainLiteral: () => ({ own: 1 }),
  plainOfClass: () => new K(),
};
for (const [which, make] of Object.entries(shapes)) {
  const row = [];
  for (const name of ["main", "url", "require", "constructor", "toString", "nothing"]) {
    const held = make();
    const handle = vm.runInContext("this", vm.createContext(held));
    const outside = attempt(() => { handle[name] = 5; return Object.hasOwn(held, name); });
    const held2 = make();
    const context2 = vm.createContext(held2);
    const symbol = attempt(() => { vm.runInContext(name + " = Symbol.iterator", context2); return Object.hasOwn(held2, name); });
    row.push(name + ":" + outside + "," + symbol);
  }
  console.log(which, row.join(" "));
}
