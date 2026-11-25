// Reads, stores, presence and Reflect.* through proxies of many handlers over many targets, again and again, while traps come and go.
const log = []; let turns = 0;
function attempt(f) { try { const v = f(); return typeof v === "object" && v !== null ? "object" : typeof v === "function" ? "function" : Object.is(v, -0) ? "-0" : String(v); } catch (e) { return e.name + ": " + e.message; } }
function describe(o) { return Object.getOwnPropertyNames(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + (d.get || d.set ? ":accessor" : "=" + (typeof d.value === "object" || typeof d.value === "function" ? "o" : String(d.value))) + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(); }
class Base { get(t, k, r) { return k === "flag" ? "flag" : Reflect.get(t, k, r); } }
class Mutable extends Base { set(t, k, v, r) { const old = t[k]; const done = Reflect.set(t, k, v, r); if (old !== v) turns++; return done; } has(t, k) { return Reflect.has(t, k); } }
const handlers = {
  literal: () => ({ get(t, k, r) { return Reflect.get(t, k, r); }, set(t, k, v, r) { return Reflect.set(t, k, v, r); }, has(t, k) { return k in t; } }),
  direct: () => ({ get(t, k) { return t[k]; }, set(t, k, v) { t[k] = v; return true; } }),
  instance: () => new Mutable(),
  inherited: () => Object.create({ set(t, k, v, r) { log.push("inherited"); return Reflect.set(t, k, v, r); } }),
  defines: () => ({ set(t, k, v, r) { return Reflect.set(t, k, v, r); }, defineProperty(t, k, d) { log.push("define " + k + Object.keys(d)); return Reflect.defineProperty(t, k, d); } }),
  describes: () => ({ set(t, k, v, r) { return Reflect.set(t, k, v, r); }, getOwnPropertyDescriptor(t, k) { log.push("describe " + k); return Reflect.getOwnPropertyDescriptor(t, k); } }),
  undefinedTraps: () => ({ set(t, k, v, r) { return Reflect.set(t, k, v, r); }, defineProperty: undefined, getOwnPropertyDescriptor: null }),
  getters: () => ({ set(t, k, v, r) { return Reflect.set(t, k, v, r); }, get defineProperty() { log.push("asked for defineProperty"); return undefined; }, get getOwnPropertyDescriptor() { log.push("asked for getOwnPropertyDescriptor"); return undefined; } }),
  otherReceiver: () => ({ set(t, k, v, r) { return Reflect.set(t, k, v, { r }); } }),
  noReceiver: () => ({ set(t, k, v) { return Reflect.set(t, k, v); } }),
  refuses: () => ({ set(t, k, v, r) { Reflect.set(t, k, v, r); return false; }, get: undefined }),
  wrong: () => ({ set: 5, get: {}, has: "x" }),
};
const targets = {
  object: () => ({ a: 1, get g() { return typeof this; }, set s(v) { log.push("setter " + (this === undefined)); } }),
  list: () => [1, 2, 3],
  fields: () => new (class { a = 1.5; b = "x"; })(),
  frozen: () => Object.freeze({ a: 1 }),
  sealed: () => Object.seal({ a: 1 }),
  closed: () => Object.preventExtensions({ a: 1 }),
  locked: () => Object.defineProperty({ b: 2 }, "a", { value: 1, writable: false, configurable: true }),
  heir: () => Object.create({ set d(v) { log.push("above " + v + (typeof this)); }, a: 4 }),
  readOnlyAbove: () => Object.create(Object.freeze({ a: 1 })),
  parsed: () => JSON.parse('{"a":1,"b":[2]}'),
  bare: () => Object.assign(Object.create(null), { a: 1 }),
  bytes: () => new Uint8Array(3),
  proxy: () => new Proxy({ a: 1 }, {}),
};
const names = ["a", "b", "d", "fresh", "0", "length"];
for (const target in targets) for (const handler in handlers) {
  log.length = 0;
  const t = targets[target](), h = handlers[handler](), p = new Proxy(t, h), heir = Object.create(p), out = [];
  for (let i = 0; i < 24; i++) {
    const k = names[i % names.length];
    if (i === 12) h.defineProperty = (t, k, d) => { log.push("late " + String(k)); return Reflect.defineProperty(t, k, d); };
    if (i === 16) attempt(() => { delete h.defineProperty; });
    if (i === 18) attempt(() => Object.defineProperty(t, "a", { value: 42, writable: false, configurable: true }));
    if (i === 20) attempt(() => Object.freeze(t));
    out.push(attempt(() => { p.a = i; return p.a; }), attempt(() => { p[k] = "v" + i; return p[k]; }), attempt(() => "a" in p), attempt(() => k in p), attempt(() => p.missing));
    out.push(attempt(() => Reflect.set(t, "a", i + 0.5, p)), attempt(() => Reflect.set(t, k, i, p)), attempt(() => Reflect.set(t, k, -i)), attempt(() => Reflect.set(p, k, i, heir)), attempt(() => Reflect.set({ a: 1 }, "a", i, p)), attempt(() => Reflect.set(t, k, i, 3)));
    out.push(attempt(() => Reflect.get(t, k, p)), attempt(() => Reflect.get(p, "g", p)), attempt(() => { heir.a = i; return heir.a; }));
  }
  console.log(target, handler, out.join(" "), "|", log.join(), "|", attempt(() => describe(t)), attempt(() => describe(heir)));
}
console.log(turns);
// The prototype of a handler's class gets a trap while its proxies are stored to.
const own = { a: 1 }, mutable = new Mutable(), watched = new Proxy(own, mutable);
for (let i = 0; i < 9; i++) {
  if (i === 5) Base.prototype.defineProperty = (t, k, d) => { log.push("class " + k); return Reflect.defineProperty(t, k, d); };
  if (i === 7) delete Base.prototype.defineProperty;
  log.length = 0; watched.a = i; console.log(own.a, log.join());
}
const { proxy, revoke } = Proxy.revocable({ a: 1 }, new Mutable());
for (let i = 0; i < 4; i++) { if (i === 2) revoke(); console.log(attempt(() => { proxy.a = i; return proxy.a; }), attempt(() => "a" in proxy), attempt(() => Reflect.set({ a: 1 }, "a", 2, proxy))); }
console.log(attempt(() => Reflect.set(1, "a", 2)), attempt(() => Reflect.set({}, { toString() { throw new RangeError("key"); } }, 2)), attempt(() => Reflect.set()));
