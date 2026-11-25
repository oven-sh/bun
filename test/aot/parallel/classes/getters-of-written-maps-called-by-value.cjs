"use strict";
const out = [];
function add(a, b) { return (a + b) | 0; }
// 1: the test's own form, with the getter taken by value
{ const lib = { base: 1 };
  Object.defineProperties(lib, { add: { enumerable: true, get: function () { return add; } } });
  function called(t) { let s = 1; for (let i = 0; i < t; i++) s = lib.add(s, i); return s; }
  out.push(called(5), called(6));
  const d = Object.getOwnPropertyDescriptor(lib, "add"); out.push(typeof d.get, d.get.call(lib)(1, 2), d.get.length, d.get.name);
}
// 2: known descriptor, unknown key, unknown receiver
{ const o = {};
  Object.defineProperties(o, { x: { get() { return this === undefined ? "none" : this.k; }, set(v) { this.k = v * 2; }, configurable: true }, y: { get: () => 7 }, z: { set: function (v) { out.push("set " + v); } } });
  for (const key of ["x", "y", "z"]) { const d = Object.getOwnPropertyDescriptor(o, key); out.push(key, typeof d.get, typeof d.set, d.enumerable, d.configurable); if (d.set) d.set.call({ k: 1 }, 5); if (d.get) out.push(String(d.get.call({ k: key + "!" })), String(d.get.call(undefined ?? { k: 1 }))); }
  o.x = 21; out.push(o.x, o.k);
}
// 3: Reflect, __lookupGetter__, all descriptors, apply, bind, new
{ const o = {};
  Object.defineProperties(o, { a: { get: function a(...rest) { return rest.length + ":" + (this ? this.n : "u"); }, enumerable: true }, b: { get: function () { return arguments.length; }, enumerable: false } });
  const all = Object.getOwnPropertyDescriptors(o); for (const k of Reflect.ownKeys(all)) { const g = all[k].get; out.push(k, g.apply({ n: 3 }, [1, 2, 3]), g.bind({ n: 4 }, 1)(), Reflect.apply(g, { n: 5 }, [])); try { out.push(typeof new g()); } catch (e) { out.push(e.name); } }
  out.push(Object.prototype.__lookupGetter__.call(o, "a").call({ n: 9 }, 1), Reflect.getOwnPropertyDescriptor(o, "b").get(1, 2));
}
// 4: handed on from an heir, a proxy, a copy of descriptors, JSON, assign, spread
{ const p = {};
  Object.defineProperties(p, { v: { get() { return this.w + 1; }, enumerable: true }, w: { value: 10, writable: true, enumerable: true } });
  const h = Object.create(p); h.w = 20; out.push(h.v, new Proxy(h, {}).v, Reflect.get(p, "v", { w: 30 }), JSON.stringify(p), JSON.stringify({ ...p }), Object.assign({}, p).v);
  const c = Object.defineProperties({}, Object.getOwnPropertyDescriptors(p)); c.w = 40; out.push(c.v);
}
// 5: in a class and a loop; the same closure twice
{ const g = function () { return this.q; };
  class K { constructor(q) { this.q = q; Object.defineProperties(this, { r: { get: g }, s: { get: function () { return this.r + q; } } }); } }
  let sum = 0; for (let i = 0; i < 20; i++) { const k = new K(i); sum += k.r + k.s; const d = Object.getOwnPropertyDescriptor(k, i & 1 ? "r" : "s"); sum += d.get.call({ q: 100, r: 1 }); }
  out.push(sum, g.call({ q: 5 }));
}
// 6: a getter that throws, is async, is a generator
{ const o = {};
  Object.defineProperties(o, { t: { get() { throw new RangeError("t"); } }, n: { get: async function () { return 1; } }, y: { get: function* () { yield 4; } } });
  try { o.t; } catch (e) { out.push(e.name); } try { Object.getOwnPropertyDescriptor(o, "t").get(); } catch (e) { out.push(e.name); }
  out.push([...o.y].join(), typeof o.n.then, [...Object.getOwnPropertyDescriptor(o, "y").get.call(o)].join());
}
console.log(out.join("|"));
