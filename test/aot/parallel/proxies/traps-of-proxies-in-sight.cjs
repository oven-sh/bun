// Loops read and store through proxies that are made beside them: traps that answer, throw, are taken away or replaced, and targets that they fix.
// STATISTIC: KnownProxyTrapsCalled >= 8
"use strict";
const log = [];
function doubles(n) {
  const p = new Proxy({ a: 1, b: 2 }, { get(t, key) { return t[key] * 2; } });
  let s = 0;
  for (let i = 0; i < n; i++) s += p.a + p.b;
  return s;
}
function stores(n) {
  const target = { a: 1 };
  const p = new Proxy(target, { set(t, key, v) { t[key] = v + 1; return true; } });
  let s = 0;
  for (let i = 0; i < n; i++) { p.a = i; s += p.a; }
  return [s, target.a];
}
function receivers(n) {
  const handler = { k: 3, get(t, key, r) { return (r === p ? 1 : 100) + (this === handler ? 10 : 1000) + key.length + t.a; } };
  const p = new Proxy({ a: 1 }, handler);
  let s = 0;
  for (let i = 0; i < n; i++) s += p.longer;
  return s;
}
function replaced(n, at) {
  const handler = { get(t, key) { return t[key]; } };
  const p = new Proxy({ a: 1 }, handler);
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i === at) handler.get = () => 1000;
    if (i === at + 2) delete handler.get;
    if (i === at + 4) Object.setPrototypeOf(handler, { get: () => 50000 });
    s += p.a;
  }
  return s;
}
function fixed(n, at, how, answer) {
  const target = { a: 1, b: 2 };
  let calls = 0;
  const p = new Proxy(target, { get(t, key) { if (calls++ === at) how(t); return calls > at ? answer : t[key]; } });
  let s = 0;
  for (let i = 0; i < n; i++) {
    try { s += p.a; } catch (e) { log.push(e.name + " " + e.message); }
  }
  return [s, calls];
}
function refuses(n, at) {
  const target = { a: 1 };
  const p = new Proxy(target, { set(t, key, v) { if (v === at) return 0; t[key] = v; return "yes"; } });
  let s = 0;
  for (let i = 0; i < n; i++) {
    try { p.a = i; } catch (e) { log.push(e.name + " " + e.message); }
    s += target.a;
  }
  return s;
}
function storesIntoFixed(n, at) {
  const target = { a: 1 };
  let calls = 0;
  const p = new Proxy(target, { set(t, key, v) { if (calls++ === at) Object.freeze(t); return true; } });
  for (let i = 0; i < n; i++) {
    try { p.a = i; } catch (e) { log.push(e.name + " " + e.message); }
  }
  return calls;
}
function throwing(n, at) {
  let calls = 0;
  const p = new Proxy({ a: 1 }, { get(t) { if (calls++ === at) throw new RangeError("trap"); return t.a; } });
  let s = 0;
  for (let i = 0; i < n; i++) s += p.a;
  return s;
}
function returned(n, at) {
  const p = new Proxy({ a: 1 }, { get(t, key) { t.a++; if (t.a === 5) Object.freeze(t); return 7; } });
  for (let i = 0; i < n; i++) if (i === at) return p.a;
  return 0;
}
function changesKind(n, at) {
  const target = { a: 1 };
  const p = new Proxy(target, { get(t, key) { return t[key]; } });
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i === at) target.a = "text";
    s += p.a;
  }
  return s;
}
function without(n, at) {
  const target = { a: 1, get b() { return this === p ? 5 : 6; } };
  const handler = { has() { return false; } };
  const p = new Proxy(target, handler);
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i === at) handler["g" + "et"] = () => 100;
    s += p.a + p.b;
  }
  return s;
}
const attempt = work => { try { return String(work()); } catch (e) { return e.name + " " + e.message; } };
for (const n of [0, 1, 7, 40]) {
  console.log(attempt(() => doubles(n)), attempt(() => stores(n)), attempt(() => receivers(n)));
  for (const at of [0, 3, 99]) {
    console.log(attempt(() => replaced(n, at)), attempt(() => refuses(n, at)), attempt(() => storesIntoFixed(n, at)), attempt(() => throwing(n, at)), attempt(() => returned(n, at)), attempt(() => changesKind(n, at)), attempt(() => without(n, at)));
    for (const how of [Object.freeze, Object.seal, Object.preventExtensions, t => { t.late = 1; }, t => Object.defineProperty(t, "a", { value: 9, writable: false, configurable: false }), t => Object.defineProperty(t, "a", { get() { return 4; } }), t => { delete t.a; }])
      for (const answer of [1, 9, undefined]) console.log(attempt(() => fixed(n, at, how, answer)));
  }
  console.log(log.splice(0).join("\n"));
}
