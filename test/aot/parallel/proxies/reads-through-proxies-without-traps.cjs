// Loops read through proxies made beside them whose handlers hold no get trap, until one comes, or a name above the handler, or the target leaves its fields.
// STATISTIC: KnownProxyTrapsCalled >= 2
"use strict";
function reads(n, at, change) {
  const target = { a: 1, b: 2.5, get c() { return this === p ? 7 : 8; } };
  const handler = { set(t, key, v) { t[key] = v + 1; return true; } };
  const p = new Proxy(target, handler);
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i === at) change(target, handler);
    p.a = i;
    s += p.a + p.b + p.c;
  }
  return s;
}
function empty(n, at, change) {
  const target = { a: 1, b: 2 };
  const handler = {};
  const p = new Proxy(target, handler);
  let s = "";
  for (let i = 0; i < n; i++) {
    if (i === at) change(target, handler);
    s += p.a + "," + p.b + " ";
  }
  return s;
}
function inherits(n) {
  const p = new Proxy({ a: 1 }, Object.create({ get: () => 9 }));
  let s = 0;
  for (let i = 0; i < n; i++) s += p.a;
  return s;
}
const changes = [
  () => {},
  (t, h) => { h.get = (t, key) => key.length; },
  (t, h) => { h["g" + "et"] = () => 5; },
  (t, h) => Object.setPrototypeOf(h, { get: () => 6 }),
  (t, h) => Object.defineProperty(h, "get", { get() { return () => 11; } }),
  (t, h) => { h.get = null; },
  (t, h) => { h.get = 3; },
  t => { delete t.b; },
  t => { t.b = "text"; },
  t => Object.defineProperty(t, "b", { get() { return 12; } }),
  t => Object.setPrototypeOf(t, { b: 40 }),
  t => Object.freeze(t),
  (t, h) => Object.freeze(h),
];
const attempt = work => { try { return String(work()); } catch (e) { return e.name + " " + e.message; } };
for (const n of [0, 1, 9, 30])
  for (const at of [0, 4, 99])
    for (const change of changes) console.log(attempt(() => reads(n, at, change)), attempt(() => empty(n, at, change)), attempt(() => inherits(n)));
