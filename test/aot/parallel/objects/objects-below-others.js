"use strict";
// Objects made below others: what stands above answers reads, stops stores, runs setters, is frozen, changes in front of a store and behind it; objects that nobody needs and objects that leave late.
const above = o => Object.keys(o).join() + "|" + (Object.getPrototypeOf(o) === proto ? "proto" : Object.getPrototypeOf(o) === null ? "null" : "other");
const asks = { above, keys: o => Object.keys(o).join() }, how = process.argv.length > 50 ? "keys" : "above", asked = o => asks[how](o);
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
let calls = 0, sunk = 0; const log = [];
const proto = { m() { return 1; }, get g() { return this.x; }, x: 100, kind: "base" };
const setting = { set x(v) { calls++; sunk = v; }, get x() { return sunk; }, y: 1 };
const frozen = Object.freeze({ x: 5, z: 6 }); const readOnly = Object.defineProperty({}, "x", { value: 7, writable: false, configurable: true });
class P { constructor() { this.own = 1; } m() { return this.x || 0; } set s(v) { log.push(v); } get s() { return 3; } } class Q extends P { m() { return super.m() + 1; } }
const proxy = new Proxy({}, { get: (t, k) => k === "p" ? 9 : t[k], set(t, k, v, r) { log.push("set" + String(k)); return Reflect.set(t, k, v, r); }, has: (t, k) => k === "h", getPrototypeOf: () => null });
const makers = { proto: () => Object.create(proto), setting: () => Object.create(setting), frozen: () => Object.create(frozen), readOnly: () => Object.create(readOnly), P: () => Object.create(P.prototype), Q: () => Object.create(Q.prototype), list: () => Object.create([1, 2]), fn: () => Object.create(makers.proto), proxy: () => Object.create(proxy), nul: () => Object.create(null), literal: () => ({ __proto__: proto }), literalSet: () => ({ __proto__: setting, x: 3 }), literalNull: () => ({ __proto__: null, x: 1 }), chain: () => Object.create(Object.create(setting)), error: () => Object.create(Error.prototype), map: () => Object.create(Map.prototype), plain: () => Object.create(Object.prototype) };
const forms = {
  sum(n) { let r = 0; for (let j = 0; j < n; j++) { const o = Object.create(proto); o.x = j; r += o.m() + o.x + o.g; } return r; },
  missing(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(proto); o.q = j; r += o.x + o.kind + o.none + ("kind" in o) + ("none" in o) + o.hasOwnProperty("x"); } return r; },
  setter(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(setting); o.x = j; r += o.x + "," + Object.keys(o).length + ";"; } return r + calls; },
  setterLiteral(n) { let r = ""; for (let j = 0; j < n; j++) { const o = { __proto__: setting, k: j }; o.x = j; o.y = 2; r += o.x + "," + Object.keys(o) + ";"; } return r + calls; },
  stops(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(frozen); try { o.x = j; r += "stored"; } catch (e) { r += e.name[0]; } try { o.w = j; } catch { r += "w"; } r += o.x + Object.keys(o); } return r; },
  stopsRead(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(readOnly); try { o.x = j; } catch (e) { r += e.name[0]; } r += o.x; } return r; },
  instance(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(P.prototype); o.x = j; o.s = j; r += o.m() + o.s + (o instanceof P) + o.own; } return r + log.splice(0); },
  heir(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(Q.prototype); o.x = j; r += o.m() + String(o.constructor === Q); } return r; },
  changed(n) { let r = ""; for (let j = 0; j < n; j++) { const up = { v: j }; const o = Object.create(up); o.a = j; up.v = j + 1; up.w = 2; r += o.v + o.w + Object.keys(o); } return r; },
  changedSetter(n) { let r = ""; for (let j = 0; j < n; j++) { const up = {}; const o = Object.create(up); o.a = j; Object.defineProperty(up, "b", { set(v) { r += "S"; }, configurable: true }); o.b = j; r += Object.keys(o); } return r; },
  changedFrozen(n) { let r = ""; for (let j = 0; j < n; j++) { const up = { b: 1 }; const o = Object.create(up); o.a = j; if (j & 1) Object.freeze(up); try { o.b = j; } catch { r += "T"; } r += Object.keys(o); } return r; },
  moved(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(proto); o.a = j; Object.setPrototypeOf(o, j & 1 ? setting : null); o.x = j; r += Object.keys(o) + o.kind; } return r; },
  movedLiteral(n) { let r = ""; for (let j = 0; j < n; j++) { const o = { __proto__: proto, a: j }; if (j % 3 === 1) o.__proto__ = setting; o.x = 1; r += Object.keys(o) + o.x; } return r; },
  dropped(n) { let r = 0; for (let j = 0; j < n; j++) { const o = Object.create(proto); o.a = j; r += o.a; } return r; },
  kept(n) { const all = []; for (let j = 0; j < n; j++) { const o = Object.create(proto); o.a = j; if (j & 1) all.push(o); } return all.map(asked).join(); },
  late(n) { let p = null, r = ""; for (let j = 0; j < n; j++) { if (p !== null) r += asked(p); p = Object.create(proto); p.l = j; } return r; },
  inTry(n) { let r = ""; for (let j = 0; j < n; j++) { let o; try { o = Object.create(j === 2 ? 5 : proto); o.x = j; if (j === 3) null.q; r += o.x; } catch (e) { r += e.name[0] + (o ? asked(o) : "-"); } } return r; },
  closure(n) { let f = null; for (let j = 0; j < n; j++) { const o = Object.create(proto); o.c = j; if (j === n - 1) f = () => o.c + o.m() + o.kind; } return f ? f() : ""; },
  passed(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(proto); o.p = j; r += take(o, j); } return r; },
  scopes(n) { let r = 0; const root = Object.create(null); root.a = 1; for (let j = 0; j < n; j++) { const s = Object.create(root); s.b = j; const t = Object.create(s); t.c = 2; r += t.a + t.b + t.c + ("b" in t ? 1 : 0); } return r; },
  parent(n) { let s = Object.create(null); s.d = 0; for (let j = 0; j < n; j++) { const t = Object.create(s); t.d = s.d + 1; s = t; } let r = 0; for (let q = s; q !== null; q = Object.getPrototypeOf(q)) r += q.d; return r; },
  branch(n) { let r = ""; for (let j = 0; j < n; j++) { const o = j & 1 ? Object.create(setting) : Object.create(proto); o.x = j; r += o.x + Object.keys(o); } return r; },
  given(n) { let r = ""; for (let j = 0; j < n; j++) { const up = j % 3 === 0 ? proto : j % 3 === 1 ? setting : frozen; const o = Object.create(up); try { o.x = j; } catch { r += "T"; } r += o.x; } return r; },
  proxied(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(proxy); o.a = j; r += o.p + String(o.a) + ("h" in o) + Object.keys(o); } return r + log.splice(0); },
  json(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(proto); o.a = j; r += JSON.stringify(o) + JSON.stringify({ ...o }) + Object.entries(o); for (const k in o) r += k; } return r; },
  text(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create({ toString() { return "t" + this.a; } }); o.a = j; r += o; } return r; },
  call(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(proto); o.m = () => j; r += o.m() + Object.keys(o); } return r; },
  extra(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(proto, { e: { value: j, enumerable: j & 1 } }); o.f = 1; r += o.e + Object.keys(o); } return r; },
};
function take(o, j) { return j === 4 ? asked(o) : o.p + o.m(); }
for (let turn = 0; turn < 4; turn++) { for (const [name, f] of Object.entries(forms)) console.log(name, attempt(() => f(0)), attempt(() => f(turn + 5)), attempt(() => f(8))); for (const [m, make] of Object.entries(makers)) { const o = make(); console.log(m, attempt(() => { o.x = turn; return o.x; }), attempt(() => { o.n = 1; return Object.keys(o); }), attempt(() => o.kind + o.y), log.splice(0).join()); } if (turn === 1) proto.extra = 1; if (turn === 2) Object.defineProperty(proto, "q", { set(v) { log.push("q" + v); }, configurable: true }); }
