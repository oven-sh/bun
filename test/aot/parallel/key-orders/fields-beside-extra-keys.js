// Fields created beside accessors, extra keys and elements: every way to list the keys gives the order of creation.
const lines = [];
function value(v) { return typeof v === "function" ? "F" : v; }
function show(o) {
  let walked = "";
  for (const k in o) walked += k + ",";
  lines.push([Object.keys(o).join(), Reflect.ownKeys(o).map(String).join(), walked, JSON.stringify(o, (k, v) => value(v)), JSON.stringify({ ...o }, (k, v) => value(v)), Object.entries(o).map(e => e[0] + value(e[1])).join(), Object.values(o).map(value).join(), Object.getOwnPropertyNames(o).join()].join(" | "));
}
const makers = [
  i => ({ a: i, get b() { return i; }, c: 1, d: 2 }),
  i => ({ a: i, set b(v) { }, get b() { return 7; }, c: 1, get d() { return 5; }, e: 2 }),
  i => ({ 0: i, 5: 1, a: i, b: 1, c: 2 }),
  i => ({ 100: i, 12345: 1, "-1": 3, a: i, b: 1, c: 2 }),
  i => ({ ["x" + (i & 1)]: i, a: 1, b: 2, c: 3 }),
  i => { const o = {}; o[i & 3] = i; o.a = 1; o["x" + i % 3] = 2; o.b = 3; o[9] = 4; o.c = 5; return o; },
  i => { const o = { a: 1 }; Object.defineProperty(o, "b", { get() { return i; }, enumerable: i % 2 === 0, configurable: true }); o.c = 1; o.d = 2; delete o.b; o.e = 3; o.b = 4; return o; },
  i => Object.defineProperties({ a: 1, b: 2 }, Object.getOwnPropertyDescriptors({ c: i, get d() { return i; }, a: 3, e: 4, set f(v) { }, [Symbol.iterator]: 1 })),
  i => Object.defineProperties({ a: 1, 3: 1 }, Object.getOwnPropertyDescriptors({ c: i, get d() { return i; }, x9: 1, e: 4, 7: 2 })),
  i => Object.defineProperties({}, Object.getOwnPropertyDescriptors(Object.freeze({ c: i, get d() { return i; }, e: 4 }))),
  i => Object.assign({ a: 1, get b() { return 2; } }, { c: i, d: 1 }, i & 1 ? { x1: 1, e: 2 } : { e: 2, f: 3 }),
  i => { const o = { b: 1, a: 2 }; if (i & 1) o.d = 1; if (i & 2) o[0] = 1; if (i & 4) o.zz = 1; o.c = 1; if (i & 1) o.e = 2; o.f = 3; return o; },
  i => { class P { m() { return 1; } get g() { return 2; } } class Q extends P { constructor() { super(); if (i & 1) this[0] = i; this.a = 1; if (i & 2) this.m = () => 5; this["x" + i % 2] = 1; this.b = 2; } } const q = new Q; lines.push(q.m() + "" + q.g); return q; },
  i => { const below = Object.create({ a: 1, get b() { return 2; } }); below[1] = 1; below.c = 1; below.a = 2; return below; },
];
for (let i = 0; i < 12; i++) for (const make of makers) {
  const o = make(i);
  show(o);
  o.z = 1; o.y = 2; show(o);
  if (i % 3 === 0) { delete o.a; o.a = 9; show(o); }
  if (i % 4 === 1) { o["n" + i] = 1; o.w = 2; show(o); }
  if (i % 5 === 2) { Object.preventExtensions(o); try { "use strict"; o.late = 1; } catch { } show(o); }
}
let digest = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(lines.length, digest);
console.log(lines.join("\n"));
