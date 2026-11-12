"use strict";
const tell = o => Object.keys(o).join() + JSON.stringify(o) + ("port" in o) + Object.hasOwn(o, "port") + Object.keys({ ...o }).length;
let seen = "";
function readWhereAbsent(n) { const kept = []; for (let i = 0; i < n; i++) { const o = {}; if (i > 4) { o.host = "t"; } if (i % 3 === 0) { o.port = undefined; } else { seen += typeof o.port; } if (i & 1) { o.port = "t"; } kept.push(o); } return kept.map(tell).join(); }
function readBetween(n) { const kept = []; for (let i = 0; i < n; i++) { const o = { kind: i }; if (i & 1) { o.port = 1; } else { seen += o.port === undefined; } o.port = (o.port ?? 0) + 1; kept.push(o); } return kept.map(tell).join(); }
function twoOrders(n) { const kept = []; for (let i = 0; i < n; i++) { const o = {}; if (i & 1) { o.a = 1; o.b = 2; } else { o.b = 2; o.a = 1; } o.c = o.a + o.b; kept.push(o); } return kept.map(tell).join(); }
function oneName(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: 1 }; if (i & 1) o.b = undefined; r += ("b" in o) + String(o.b); for (const k in o) r += k; } return r; }
class Held { constructor(i) { this.a = i; if (i & 1) this.b = undefined; else seen += this.b; } }
function instances(n) { const kept = []; for (let i = 0; i < n; i++) { const o = new Held(i); if (i > 2) o.b = i; kept.push(o); } return kept.map(tell).join(); }
for (const f of [readWhereAbsent, readBetween, twoOrders, oneName, instances]) console.log(f.name, f(0), f(1), f(9));
console.log(seen);
