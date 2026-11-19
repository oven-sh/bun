// One function stores all the fields that a constructor leaves out. Objects that it has not filled, has filled in part or twice, or whose fields change kind read as they should.
"use strict";
const log = [];
const show = o => Object.keys(o).map(k => k + "=" + (typeof o[k] === "object" && o[k] ? "{" + o[k].id + "}" : typeof o[k] === "function" ? "function" : Object.is(o[k], -0) ? "-0" : String(o[k]))).join(",");
function Node(id, weight) { this.id = id; this.weight = weight; }
Node.prototype.cost = function (from) { return from && from.id != this.id ? this.weight * 1.5 : this.weight; };
function clean(node) { node.f = 0; node.g = 0; node.h = 0; node.visited = false; node.closed = false; node.parent = null; }
class Item { constructor(id) { this.id = id; } reset(a, b) { this.a = a; this.b = b; this.next = this; this.flag = a > b; return this; } }
class Below extends Item { constructor(id) { super(id); this.own = id * 2; } }
class Wide { constructor(id) { this.id = id; } }
function widen(w, i) { w.a0 = i; w.a1 = i; w.a2 = i; w.a3 = i; w.a4 = i; w.a5 = i; w.a6 = i; w.a7 = i; w.a8 = i; w.a9 = i; w.b0 = i; w.b1 = i; w.b2 = i; w.b3 = i; w.b4 = i; w.b5 = i; w.b6 = "s" + i; }
class Getter { get total() { return "total " + this.p; } }
function fillGetter(g, i) { g.p = i; g.q = i / 2; g.r = null; try { g.total = i; } catch (e) { log.push(e.constructor.name); } }
function fillPlain(o, i) { o.one = i; o.two = -0; o.three = undefined; }
const nodes = [];
for (let i = 0; i < 30; i++) nodes.push(new Node(i, i % 3));
log.push(show(nodes[4]), nodes[4].f, "f" in nodes[4], nodes[4].parent, Object.hasOwn(nodes[4], "closed"));
for (let i = 0; i < 30; i++) if (i % 7 !== 3) clean(nodes[i]);
log.push(show(nodes[4]), show(nodes[3]));
for (let i = 1; i < 30; i++) { const n = nodes[i]; n.parent = nodes[i >> 1]; n.g = (n.parent.g || 0) + n.cost(n.parent); n.f = n.g + (n.h = n.h || 30 - i); n.visited = i % 2 === 0; }
let sum = 0, visited = 0;
for (let turn = 0; turn < 40; turn++) for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; sum += n.f; if (n.visited) visited++; if (n.closed) sum += 1000; }
log.push(sum, visited, show(nodes[3]), show(nodes[10]), show(nodes[29]));
for (const n of nodes) if (n.id % 5 === 0) clean(n);
nodes[6].f = "text"; nodes[7].g = { id: "object" }; nodes[8].closed = 1; nodes[9].parent = undefined; delete nodes[11].h; nodes[12].h = 1e300; nodes[13].f = -0; nodes[14].visited = null; nodes[15].g = NaN;
log.push(nodes.map(show).join(";"), JSON.stringify(nodes.slice(16, 18).map(n => { const c = Object.assign({}, n); c.parent = c.parent && c.parent.id; return c; })));
sum = 0; let text = "";
for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; if (typeof n.f === "number") sum += n.f; else text += n.f; text += n.closed ? "c" : "-"; }
log.push(sum, text);
clean(nodes[11]); log.push(show(nodes[11]));
Object.freeze(nodes[20]); try { clean(nodes[20]); } catch (e) { log.push(e.constructor.name); }
Object.defineProperty(nodes[21], "g", { get() { return this.id + 0.5; }, configurable: true, enumerable: true }); log.push(show(nodes[21]), nodes[21].g);
try { clean(nodes[21]); } catch (e) { log.push(e.constructor.name, show(nodes[21])); }
const items = [];
for (let i = 0; i < 16; i++) { const x = i % 3 ? new Item(i) : new Below(i); if (i % 4) x.reset(i, 8); items.push(x); }
log.push(items.map(show).join(";"), items.map(x => x.next === x).join());
for (let i = 0; i < 16; i++) items[i].reset("a" + i, i);
log.push(items.map(show).join(";"), items.filter(x => x.flag).length);
const wides = [];
for (let i = 0; i < 8; i++) { const w = new Wide(i); if (i & 1) widen(w, i); wides.push(w); }
log.push(wides.map(show).join(";"));
let all = 0; for (let i = 0; i < 80; i++) { const w = wides[i % 8]; if (w.a9 !== undefined) all += w.a9 + w.b5 + w.b6.length; } log.push(all);
for (let i = 0; i < 4; i++) { const g = new Getter(); if (i) fillGetter(g, i); log.push(show(g), g.total, g.q, g.r); }
for (let i = 0; i < 4; i++) { const o = {}; if (i) fillPlain(o, i); log.push(show(o), "three" in o, o.two); }
for (const line of log) console.log(line);
