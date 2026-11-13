// A has trap may deny no property that is not configurable, whether it can be written or not, however often it is asked.
"use strict";
const attempt = f => { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } };
const fixes = [{ value: 5 }, { value: 5, writable: true }, { value: 5, writable: true, enumerable: true }, { get() { return 5; } }, { set(v) {} }, { value: 5, configurable: true }, { value: 5, writable: true, configurable: true }];
const targets = [() => ({ a: 1 }), () => ({}), () => ({ a: 1, fixed: 2 }), () => { const o = { a: 1 }; o["la" + "te"] = 2; return o; }, () => Object.create(null), () => [1], () => function () {}, () => new (class { a = 1; })(), () => new Map()];
const denies = { has: () => false }, denies0 = { has(t, key) { return 0; } }, answers = { has: (t, key) => key in t, set: () => true, get: () => 5 }, others = { get: () => 6, set: () => true, has: () => "yes" };
for (const handler of [denies, denies0, answers, others]) for (const target of targets) for (const fix of fixes) {
  const t = Object.defineProperty(target(), "fixed", fix), p = new Proxy(t, handler), all = [];
  for (let k = 0; k < 6; k++) all.push(attempt(() => "fixed" in p), attempt(() => "absent" in p), attempt(() => p.fixed), attempt(() => { p.fixed = 5; return "stored"; }), attempt(() => { p.fixed = 7; return "stored"; }));
  Object.preventExtensions(t);
  for (let k = 0; k < 3; k++) all.push(attempt(() => "a" in p), attempt(() => "fixed" in p), attempt(() => "absent" in p));
  console.log(all.join(" ; "));
}
