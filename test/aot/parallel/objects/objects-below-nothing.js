"use strict";
// Objects of Object.create(null) and of { __proto__: null }: some are needed by nobody, some by one branch, some only where something throws, some after the loop; what stands above each that is seen.
const above = o => (Object.getPrototypeOf(o) === null ? "null" : Object.getPrototypeOf(o) === Object.prototype ? "plain" : "other") + ("toString" in o) + Object.keys(o).join();
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
const asks = { above, keys: o => Object.keys(o).join() }, how = process.argv.length > 50 ? "keys" : "above", asked = o => asks[how](o);
const held = []; let last; const proto = { m() { return 1; }, get g() { return this.x; } };
const forms = {
  dropped(n) { let r = 0; for (let j = 0; j < n; j++) { const o = Object.create(null); o.a = j; o.b = 2; r += o.a + o.b; } return r; },
  dropped2(n) { let r = 0; for (let j = 0; j < n; j++) { const o = { __proto__: null, a: j }; r += o.a; } return r; },
  kept(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null); o.a = j; if (j % 3 === 1) held.push(o); r += o.a; } return r + held.splice(0).map(above); },
  keptLast(n) { for (let j = 0; j < n; j++) { const o = Object.create(null); o.a = j; last = o; } return asked(last) + last.a; },
  after(n) { let o; for (let j = 0; j < n; j++) { o = Object.create(null); o.b = j; } return o ? asked(o) : "-"; },
  shown(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null); o.k = j; r += above(o); } return r; },
  shownLate(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null); r += asked(o); o.k = j; r += asked(o); } return r; },
  inName(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null); o.x = 1; r += ("toString" in o) + String("x" in o) + (o.toString === undefined); } return r; },
  inTry(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null); o.x = j; try { if (j === 2) throw o; r += o.x; } catch (e) { r += above(e); } } return r; },
  inTryKept(n) { let r = ""; for (let j = 0; j < n; j++) { let o; try { o = Object.create(null); o.x = j; if (j & 1) null.q; r += "-"; } catch { r += asked(o); } } return r; },
  branch(n) { let r = ""; for (let j = 0; j < n; j++) { const o = j & 1 ? Object.create(null) : {}; o.x = j; r += asked(o); } return r; },
  given(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(j & 1 ? null : proto); o.x = j; r += above(o) + o.g; } return r; },
  ofProto(n) { let r = 0; for (let j = 0; j < n; j++) { const o = Object.create(proto); o.x = j; r += o.m() + o.x + o.g; } return r; },
  again(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null); Object.setPrototypeOf(o, j & 1 ? proto : null); r += above(o); } return r; },
  inner(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null); o.in = Object.create(null); o.in.v = j; r += o.in.v; if (j === 3) r += asked(o.in); } return r; },
  list(n) { const l = []; for (let j = 0; j < n; j++) { const o = Object.create(null); o.i = j; l.push(o); } return l.map(above).join(); },
  closure(n) { let f; for (let j = 0; j < n; j++) { const o = Object.create(null); o.c = j; if (j === n - 1) f = () => asked(o) + o.c; } return f ? f() : ""; },
  text(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null); o.t = j; r += attempt(() => "" + o); } return r; },
  json(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null); o.t = j; r += JSON.stringify(o) + JSON.stringify({ ...o }); } return r; },
  eq(n) { let r = 0; let p = null; for (let j = 0; j < n; j++) { const o = Object.create(null); if (o === p) r += 100; p = j & 1 ? o : p; if (p && Object.getPrototypeOf(p) === null) r++; } return r; },
  described(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null, { d: { value: j, enumerable: true } }); r += o.d + above(o); } return r; },
  bad(n) { let r = ""; for (let j = 0; j < n; j++) { r += attempt(() => above(Object.create(j & 1 ? undefined : 5))); } return r; },
  count(n) { const c = Object.create(null); for (let j = 0; j < n; j++) { const k = "k" + (j % 3); c[k] = (c[k] || 0) + 1; } return JSON.stringify(c) + above(c); },
  instance(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null); r += (o instanceof Object) + typeof o.constructor; } return r; },
  dead(n) { for (let j = 0; j < n; j++) { Object.create(null); const o = { __proto__: null }; o.q = 1; } return n; },
  carried(n) { let p, r = ""; for (let j = 0; j < n; j++) { if (p) r += asked(p); const o = Object.create(null); o.x = j; p = o; } return r; },
  carriedPlain(n) { let p = { x: 0 }, r = ""; for (let j = 0; j < n; j++) { r += asked(p); p = { __proto__: null, x: j }; } return r; },
  carriedFar(n) { let p = null, q = null, r = ""; for (let j = 0; j < n; j++) { if (q !== null) r += asked(q) + q.x; q = p; p = Object.create(null); p.x = j; } return r; },
  carriedOut(n) { let p = null, r = ""; for (let k = 0; k < 3; k++) { if (p !== null) r += asked(p); for (let j = 0; j < n; j++) { p = Object.create(null); p.j = j; } } return r; },
  carriedIn(n) { let p = null, r = ""; for (let k = 0; k < 3; k++) { for (let j = 0; j < n; j++) if (p !== null && j === 1) r += asked(p); p = Object.create(null); p.k = k; } return r; },
  linked(n) { let p = null; for (let j = 0; j < n; j++) { const o = Object.create(null); o.up = p; o.j = j; p = o; } let r = ""; for (let q = p; q !== null; q = q.up) r += asked(q); return r; },
  thrown(n) { let p = null, r = ""; for (let j = 0; j < n; j++) { try { if (p !== null && j % 3 === 2) throw 1; } catch { r += asked(p); } p = Object.create(null); p.e = j; } return r; },
  passed(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.create(null); o.x = j; r += take(o, j); } return r; },
};
function take(o, j) { return j === 4 ? asked(o) : o.x; }
for (let turn = 0; turn < 4; turn++) for (const [name, f] of Object.entries(forms)) console.log(name, attempt(() => f(0)), attempt(() => f(turn + 5)), attempt(() => f(8)));
let sum = 0; for (let j = 0; j < 100; j++) { const o = Object.create(null); o.a = j; sum += o.a; if (j === 99) console.log(above(o)); } console.log(sum);
