"use strict";
// Objects of one layout made on several ways below nothing or below others, which meet behind the ways: in a variable, in a loop, in a callee, under a condition of the link.
const proto = { m() { return 1; }, kind: "base" }, other = { m() { return 2; }, kind: "other" };
const above = o => (Object.getPrototypeOf(o) === null ? "null" : Object.getPrototypeOf(o) === Object.prototype ? "plain" : Object.getPrototypeOf(o).kind) + ("toString" in o) + Object.keys(o).join();
const asks = { above, keys: o => Object.keys(o).join() }, how = process.argv.length > 50 ? "keys" : "above", asked = o => asks[how](o);
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
const forms = {
  created(n) { let r = ""; for (let j = 0; j < n; j++) { let o; if (j & 1) { o = Object.create(null); o.x = j; } else { o = Object.create(null); o.x = 2; } r += o.x; if (j === 3) r += asked(o); } return r; },
  createdSeen(n) { let r = ""; for (let j = 0; j < n; j++) { let o; if (j & 1) { o = Object.create(null); o.x = j; } else { o = Object.create(null); o.x = 2; } r += o.x + asked(o); } return r; },
  literal(n) { let r = ""; for (let j = 0; j < n; j++) { const o = j & 1 ? { __proto__: null, x: j } : { __proto__: null, x: 2 }; r += o.x; if (j > 3) r += asked(o); } return r; },
  literalIn(n) { let r = ""; for (let j = 0; j < n; j++) { const o = j & 1 ? { __proto__: null, x: j } : { __proto__: null, x: 2 }; r += o.x + String("toString" in o) + String(o.toString); } return r; },
  same(n) { let r = ""; for (let j = 0; j < n; j++) { let o; switch (j % 3) { case 0: o = make(j); break; case 1: o = make(2); break; default: o = make(3); } r += o.x + asked(o); } return r; },
  links(n) { let r = ""; for (let j = 0; j < n; j++) { let o; if (j & 1) o = below(proto, j); else o = below(other, 2); r += o.x + o.m() + asked(o); } return r; },
  linksNull(n) { let r = ""; for (let j = 0; j < n; j++) { let o; if (j & 1) o = below(null, j); else o = below(other, 2); r += o.x + asked(o); } return r; },
  laid(n) { let r = ""; for (let j = 0; j < n; j++) { const up = j & 1 ? null : proto; const o = { __proto__: up, x: j }; r += o.x + asked(o); } return r; },
  laidWays(n) { let r = ""; for (let j = 0; j < n; j++) { let o; if (j % 3 === 0) o = lay(null, j); else if (j % 3 === 1) o = lay(proto, 1); else o = lay(undefined, 2); r += o.x + asked(o); } return r; },
  carried(n) { let o = Object.create(null); o.x = 0; let r = ""; for (let j = 0; j < n; j++) { const next = Object.create(null); next.x = o.x + j; o = next; } return r + o.x + asked(o); },
  carriedWays(n) { let o = { __proto__: null, x: 0 }, r = ""; for (let j = 0; j < n; j++) { if (j & 1) o = { __proto__: null, x: o.x + 1 }; else o = { __proto__: null, x: o.x + 2 }; if (j === 2) r += asked(o); } return r + o.x + asked(o); },
  carriedLinks(n) { let o = below(proto, 0), r = ""; for (let j = 0; j < n; j++) { o = j & 1 ? below(proto, o.x + 1) : below(other, o.x + 2); if (j === 2) r += asked(o); } return r + o.x + asked(o); },
  early(n) { let r = ""; for (let j = 0; j < n; j++) r += asked(choose(j)) + choose(j).x; return r; },
  inTry(n) { let r = ""; for (let j = 0; j < n; j++) { let o; try { o = Object.create(null); o.x = j; if (j & 1) throw 1; } catch { o = Object.create(null); o.x = -j; } r += o.x + asked(o); } return r; },
  listed(n) { const l = []; for (let j = 0; j < n; j++) { let o; if (j & 1) { o = Object.create(null); o.x = j; } else { o = Object.create(null); o.x = 2; } l.push(o); } return l.map(asked).join(); },
  nested(n) { let r = ""; for (let j = 0; j < n; j++) { const o = { in: j & 1 ? { __proto__: null, x: j } : { __proto__: null, x: 2 } }; r += o.in.x + asked(o.in); } return r; },
  sum(n) { let r = 0; for (let j = 0; j < n; j++) { let o; if (j & 1) { o = Object.create(null); o.x = j; } else { o = Object.create(null); o.x = 2; } r += o.x + ("x" in o ? 1 : 0) + ("valueOf" in o ? 100 : 0); } return r; },
};
function make(x) { const o = Object.create(null); o.x = x; return o; }
function below(up, x) { const o = Object.create(up); o.x = x; return o; }
function lay(up, x) { return { __proto__: up, x }; }
function choose(j) { if (j % 2) { const o = Object.create(null); o.x = j; return o; } const o = Object.create(null); o.x = 5; return o; }
for (let turn = 0; turn < 4; turn++) for (const [name, f] of Object.entries(forms)) console.log(name, attempt(() => f(0)), attempt(() => f(turn + 5)), attempt(() => f(8)));
