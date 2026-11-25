// Object.assign(this, o) in constructors: the names of the sources become fields of the class, whatever stands above it and whatever the sources hold.
"use strict";
const log = [];
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + (d.get ? ":accessor" : "=" + (typeof d.value === "object" && d.value ? "{" + Object.keys(d.value) + "}" : typeof d.value === "function" ? "function" : String(d.value))); }).join(",");
class Point { constructor(o) { Object.assign(this, o); } }
class Mixed { constructor(o) { Object.assign(this, o); } }
class Named { z = 1; constructor(o) { Object.assign(this, { x: "first", w: 2 }, o); } sum() { return this.x + this.y; } }
class Above { set x(v) { this.up = v; } get y() { return "above"; } set y(v) { this.through = v; } }
class Below extends Above { constructor(o) { super(); Object.assign(this, o); } }
class Method { constructor(o) { Object.assign(this, o); } x() { return 5; } }
class Getter { constructor(o) { try { Object.assign(this, o); } catch (e) { this.error = e.constructor.name; } } get x() { return 7; } }
class Frozen { constructor(o) { Object.freeze(this); try { Object.assign(this, o); } catch (e) { log.push(e.constructor.name); } } }
class List extends Array { constructor(o) { super(); Object.assign(this, o); } }
function Old(o) { Object.assign(this, o); }
Old.prototype.sum = function () { return this.x + this.y; };
function Hidden(o) { Object.assign(this, o); }
Object.defineProperty(Hidden.prototype, "x", { get() { return "got " + this.hidden; }, set(v) { this.hidden = v; }, configurable: true });
class Late { constructor(o) { Object.assign(this, o); if (o && o.y === 3) Object.setPrototypeOf(this, { set q(v) { this.sq = v; } }); Object.assign(this, { q: 4 }); } }
const sources = i => [{ x: i, y: 1 }, { x: i + 0.5, y: i }, { y: "s", x: null }, i & 1 ? { x: i } : { z: i }, undefined, { x: undefined, y: 3 }];
const all = [];
for (let i = 0; i < 24; i++) {
  all.push(new Point({ x: i, y: 1 }));
  const s = sources(i)[i % 6];
  for (const C of [Mixed, Named, Below, Method, Getter, Frozen, List, Old, Hidden, Late]) {
    const o = new C(s);
    if (i < 12) log.push(C.name + " " + show(o) + " " + (o.sum ? o.sum() : "") + (typeof o.x === "function" ? o.x() : o.x) + " " + o.y);
  }
}
function sum(list) { let s = 0; for (let i = 0; i < 400; i++) { const o = list[i % list.length]; s = (s + o.x + o.y) | 0; } return s; }
log.push(sum(all), all.map(show).join(";"));
all[3].x = "text"; delete all[5].y; all[7].y = 1e300; Object.assign(all[9], { x: 1.5, n: 2n }); Object.assign(all[11], JSON.parse('{"x":7,"__proto__":{"deep":1},"9":0}'));
log.push(sum(all.filter((_, i) => i % 2 === 0)), all.map(show).join(";"));
let threw = 0;
for (const s of [new Proxy({ x: 1 }, { get() { threw++; return threw; } }), { get x() { delete this.y; return 8; }, y: 2 }, Object.create({ x: 1 }, { y: { value: 2, enumerable: true } }), [4], "ab", { [Symbol.toStringTag]: "T", 3: 1, toString: null }, new Point({ x: "copy", q: 1 })]) {
  const p = new Point(s); log.push(show(p), Object.keys(p).join());
}
for (const line of log) console.log(line);
