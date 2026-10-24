function probe(label, run) { let text; try { const v = run(); text = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); } catch (e) { text = "threw " + e.constructor.name; } console.log(label + " " + text); }
function read(o) { return [o.a, o.a + 1, typeof o.a, "a" in o, Object.keys(o).join()].join(" "); }
const other = { a: undefined, z: 1 };
const withGetter = { get a() { return "got"; } };
const key = "a".slice();
const makers = {
  plain: () => ({ a: 1.5, b: 2 }),
  setterBehind: () => ({ a: 1.5, set a(v) {} }),
  getterBehind: () => ({ a: 1.5, get a() { return undefined; } }),
  again: () => ({ a: 1.5, a: undefined }),
  computedAgain: () => ({ a: 1.5, ["a"]: undefined }),
  computedUnknown: () => ({ a: 1.5, [key]: undefined }),
  spreadBehind: () => ({ a: 1.5, ...other }),
  spreadOfGetter: () => ({ a: 1.5, ...withGetter }),
  spreadNull: () => ({ a: 1.5, ...null }),
  protoBehind: () => ({ a: 1.5, __proto__: null }),
  deletedInValue: () => { const o = { a: 1.5, b: 0 }; delete o.a; return o; },
  assignBehind: () => Object.assign({ a: 1.5 }, other),
  definedBehind: () => Object.defineProperty({ a: 1.5 }, "a", { get: undefined }),
  definedByKey: () => Object.defineProperty({ a: 1.5 }, key, { set(v) {} }),
  definedMany: () => Object.defineProperties({ a: 1.5 }, { a: { get() { return "many"; } } }),
  reflectDeleted: () => { const o = { a: 1.5 }; Reflect.deleteProperty(o, key); return o; },
  proxyDeleted: () => { const o = { a: 1.5 }; delete new Proxy(o, {}).a; return o; },
  methodThatDeletes: () => { const o = { a: 1.5, drop() { delete this.a; } }; o.drop(); return o; },
  storedRightBehind: () => { const o = {}; o.a = 1.5; o.b = 2; delete o[key]; return o; },
};
for (let turn = 0; turn < 200; turn++) read(makers.plain());
for (const name of Object.keys(makers)) probe(name, () => read(makers[name]()));
