// A test for typeof "object" says of its variable what it is, until somebody stores to the variable.
class Box { constructor(v) { this.v = v; } get() { return this.v; } }
const values = [{ a: 1, length: 2 }, null, undefined, 5, NaN, "text", "", true, Symbol.iterator, 10n, () => 1, class K {}, [1, 2], new Map([[1, 2]]), /x/, new Box(3), Object.create(null), new Proxy({ a: 2 }, {}), new Proxy(function () {}, {}), new String("s"), new Uint8Array(3)];
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
const questions = {
  plain(x) { if (typeof x !== "object" || x === null) return false; const above = Object.getPrototypeOf(x); return above === null || above === Object.prototype; },
  object(x) { return typeof x === "object" && x !== null; },
  truth(x) { return typeof x === "object" && x ? Object.keys(x).length : typeof x; },
  first(x) { return x && typeof x === "object" ? "a" in x : x === null; },
  either(x) { if (typeof x === "object" || typeof x === "function") return x === null ? "null" : typeof x.call; return 1 + String(x).length; },
  neither(x) { if (typeof x !== "object" && typeof x !== "function") return typeof x; return x === null || Object.isExtensible(x); },
  stored(x) { if (typeof x === "object") { const first = x; x = 5; return (first === null) + typeof x; } x = null; return typeof x; },
  changed(x) { const change = () => { x = "changed"; }; if (typeof x === "object" && x !== null) { change(); return x.length; } change(); return typeof x; },
  looped(x) { let n = 0; while (n < 3 && typeof x === "object" && x !== null) { x = n === 1 ? 7 : x; n++; } return n + typeof x; },
  joined(x) { if (typeof x === "object") x = x ?? []; else x = [x]; return x.length; },
  deep(x) { return typeof x === "object" && x !== null && typeof x.v === "number" && x.get() === 3; },
  chosen(x) { switch (typeof x) { case "object": return x === null ? "null" : Array.isArray(x); case "function": return x.length; default: return typeof x !== "object"; } },
  thrown(x) { try { if (typeof x === "object") { if (x.a === 1) throw x; x = undefined; } } catch (caught) { return typeof x === "object" && caught === x; } return typeof x; },
};
for (const [name, question] of Object.entries(questions)) {
  console.log(name, values.map(value => attempt(() => question(value))).join());
  let sum = 0;
  for (let i = 0; i < 400; i++) sum += attempt(() => question(values[i % 4 ? 0 : i % values.length])).length;
  console.log(sum);
}
function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every(name => equal(a[name], b[name]));
}
const make = () => ({ a: [1, { b: null }], c: "x", d: { e: undefined, f: [] } });
console.log(equal(make(), make()), equal(make(), { ...make(), c: "y" }), equal(null, {}), equal([], {}), equal(5, { a: 5 }));
