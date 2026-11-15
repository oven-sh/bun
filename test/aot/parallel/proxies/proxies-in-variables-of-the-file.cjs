// Functions read and store through proxies that variables of the file hold: traps that answer, throw, are taken away or replaced, and targets that they fix.
// STATISTIC: KnownProxyTrapsCalled >= 6
"use strict";
const log = [];
let calls = 0, at = 0, how = () => {};
const doubled = new Proxy({ a: 1, b: 2 }, { get(t, key) { return t[key] * 2; } });
function doubles(n) { let s = 0; for (let i = 0; i < n; i++) s += doubled.a + doubled.b; return s; }
const storedTarget = { a: 1 };
const stored = new Proxy(storedTarget, { set(t, key, v) { t[key] = v + 1; return true; } });
function stores(n) { let s = 0; for (let i = 0; i < n; i++) { stored.a = i; s += stored.a; } return [s, storedTarget.a]; }
const handler = { k: 3, get(t, key, r) { return (r === proxied ? 1 : 100) + (this === handler ? 10 : 1000) + key.length + t.a; } };
const proxied = new Proxy({ a: 1 }, handler);
function receivers(n) { let s = 0; for (let i = 0; i < n; i++) s += proxied.longer; return s; }
const changing = { get(t, key) { return t[key]; } };
const changed = new Proxy({ a: 1 }, changing);
function replaced(n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i === 3) changing.get = () => 1000;
    if (i === 5) delete changing.get;
    if (i === 7) Object.setPrototypeOf(changing, { get: () => 50000 });
    s += changed.a;
  }
  return s;
}
const fixedTarget = { a: 1, b: 2 };
const fixedProxy = new Proxy(fixedTarget, { get(t, key) { if (calls++ === at) how(t); return calls > at ? 9 : t[key]; } });
function fixed(n) { let s = 0; for (let i = 0; i < n; i++) { try { s += fixedProxy.a; } catch (e) { log.push(e.name + " " + e.message); } } return [s, calls]; }
const refused = { a: 1 };
const refusing = new Proxy(refused, { set(t, key, v) { if (v === 4) return 0; t[key] = v; return "yes"; } });
function refuses(n) { let s = 0; for (let i = 0; i < n; i++) { try { refusing.a = i; } catch (e) { log.push(e.name + " " + e.message); } s += refused.a; } return s; }
const { proxy: revoked, revoke } = Proxy.revocable({ a: 1 }, { get(t, key) { return t[key]; } });
function revokes(n) { let s = 0; for (let i = 0; i < n; i++) { if (i === 5) revoke(); s += revoked.a; } return s; }
let moving = new Proxy({ a: 1 }, { get: () => 1 });
function moves(n) { let s = 0; for (let i = 0; i < n; i++) { if (i === 2) moving = { a: 100 }; s += moving.a; } return s; }
const attempt = work => { try { return String(work()); } catch (e) { return e.name + " " + e.message; } };
const early = attempt(() => lateReads(3));
const late = new Proxy({ a: 5 }, { get(t, key) { return t[key] + 1; } });
function lateReads(n) { let s = 0; for (let i = 0; i < n; i++) s += late.a; return s; }
console.log(early, attempt(() => lateReads(3)));
for (const n of [0, 1, 7, 40]) {
  console.log(attempt(() => doubles(n)), attempt(() => stores(n)), attempt(() => receivers(n)), attempt(() => replaced(n)), attempt(() => refuses(n)), attempt(() => revokes(n)), attempt(() => moves(n)), attempt(() => lateReads(n)));
  for (const change of [t => { t.late = 1; }, t => { t.a = "text"; }, Object.preventExtensions, Object.seal, Object.freeze]) { calls = 0; at = 3; how = change; console.log(attempt(() => fixed(n))); }
  console.log(log.splice(0).join("\n"));
}
