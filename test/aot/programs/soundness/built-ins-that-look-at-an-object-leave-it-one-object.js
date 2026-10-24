// A built-in looks at an object of a class; afterwards compiled code and built-ins must still see one and the same object: stores by either are read by both.
const util = require("node:util");
const looks = {
  hasOwnProperty: o => o.hasOwnProperty("x"), hasOwnPropertyMissing: o => o.hasOwnProperty("nope"), hasOwn: o => Object.hasOwn(o, "y"), propertyIsEnumerable: o => o.propertyIsEnumerable("x"),
  keys: o => Object.keys(o).join(), names: o => Object.getOwnPropertyNames(o).join(), symbols: o => Object.getOwnPropertySymbols(o).length, ownKeys: o => Reflect.ownKeys(o).join(),
  values: o => Object.values(o).join(), entries: o => Object.entries(o).join(), descriptor: o => Object.getOwnPropertyDescriptor(o, "x").value, descriptors: o => Object.keys(Object.getOwnPropertyDescriptors(o)).join(),
  inOperator: o => "x" in o, computedIn: o => JSON.parse('"y"') in o, forIn: o => { let s = ""; for (const k in o) s += k; return s; }, stringify: o => JSON.stringify(o), inspect: o => util.inspect(o), clone: o => structuredClone(o).x,
  spread: o => ({ ...o }).y, assignSource: o => Object.assign({}, o).y, isFrozen: o => Object.isFrozen(o), isSealed: o => Object.isSealed(o), isExtensible: o => Object.isExtensible(o), getPrototypeOf: o => Object.getPrototypeOf(o) === P.prototype,
  isPrototypeOf: o => P.prototype.isPrototypeOf(o), toStringTag: o => Object.prototype.toString.call(o), valueOf: o => o.valueOf() === o, toLocaleString: o => o.toLocaleString(), reflectGet: o => Reflect.get(o, "x"), reflectHas: o => Reflect.has(o, "y"),
  computedRead: o => o[JSON.parse('"x"')], lookupGetter: o => o.__lookupGetter__("x"), deepEquals: o => Bun.deepEquals(o, { x: 1 }), isDeepStrictEqual: o => util.isDeepStrictEqual(o, o), log: o => { console.log(o); return 0; }, weakMap: o => new WeakMap([[o, 1]]).get(o),
};
class P { constructor() { this.x = 1; this.y = 2; } sum() { return this.x + this.y; } set(a, b) { this.x = a; this.y = b; } }
for (const [name, look] of Object.entries(looks)) {
  const o = new P();
  const seen = look(o);
  o.set(10, 20);
  const afterCompiledStore = [o.sum(), Reflect.get(o, "x"), Object.values(o).join(), JSON.stringify(o)].join(" ");
  Reflect.set(o, "x", 100); Object.assign(o, { y: 200 });
  const afterNativeStore = [o.sum(), o.x, o.y, Object.keys(o).join()].join(" ");
  look(o); o.z = 3; o.set(1, 1);
  console.log(name, "|", String(seen), "|", afterCompiledStore, "|", afterNativeStore, "|", o.sum(), JSON.stringify(o));
}
