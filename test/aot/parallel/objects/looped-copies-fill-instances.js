// for (k in source) target[k] = source[k] in constructors and helpers: the names of the sources become fields of the class.
"use strict";
const log = [];
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + (d.get ? ":accessor" : "=" + (typeof d.value === "object" && d.value ? "{" + Object.keys(d.value) + "}" : typeof d.value === "function" ? "function" : String(d.value))); }).join(",");
function extend(target, source) { for (const k in source) target[k] = source[k]; return target; }
function own(target, source) { for (const k in source) if (Object.prototype.hasOwnProperty.call(source, k)) target[k] = source[k]; return target; }
class Point { constructor(o) { extend(this, o); } }
class Direct { constructor(o) { for (const k in o) this[k] = o[k]; } }
class Owned { z = 1; constructor(o) { own(this, o); } sum() { return this.x + this.y; } }
class Above { set x(v) { this.up = v; } get y() { return "above"; } set y(v) { this.through = v; } }
class Below extends Above { constructor(o) { super(); for (const k in o) this[k] = o[k]; } }
class Getter { constructor(o) { try { for (const k in o) this[k] = o[k]; } catch (e) { this.error = e.constructor.name; } } get x() { return 7; } }
class Frozen { constructor(o) { Object.freeze(this); try { for (const k in o) this[k] = o[k]; } catch (e) { log.push(e.constructor.name); } } }
class List extends Array { constructor(o) { super(); for (const k in o) this[k] = o[k]; } }
class Method { constructor(o) { for (const k in o) this[k] = o[k]; } x() { return 5; } }
function Old(o) { for (var k in o) this[k] = o[k]; }
Old.prototype.sum = function () { return this.x + this.y; };
function Hidden(o) { for (var k in o) this[k] = o[k]; }
Object.defineProperty(Hidden.prototype, "x", { get() { return "got " + this.hidden; }, set(v) { this.hidden = v; }, configurable: true });
const sources = i => [{ x: i, y: 1 }, { x: i + 0.5, y: i }, { y: "s", x: null }, i & 1 ? { x: i } : { z: i }, undefined, { x: undefined, y: 3 }];
const points = [], directs = [];
for (let i = 0; i < 24; i++) {
  points.push(new Point({ x: i, y: 1 })); directs.push(new Direct({ x: i, y: i * 0.5 }));
  const s = sources(i)[i % 6];
  for (const C of [Owned, Below, Getter, Frozen, List, Method, Old, Hidden]) {
    const o = new C(s);
    if (i < 12) log.push(C.name + " " + show(o) + " " + (o.sum ? o.sum() : "") + (typeof o.x === "function" ? o.x() : o.x) + " " + o.y);
  }
}
function sum(list) { let s = 0; for (let i = 0; i < 400; i++) { const o = list[i % list.length]; s = (s + o.x + o.y) | 0; } return s; }
log.push(sum(points), sum(directs), points.map(show).join(";"), directs.slice(0, 5).map(show).join(";"));
points[3].x = "text"; delete points[5].y; points[7].y = 1e300; extend(points[9], { x: 1.5, n: 2n }); extend(points[11], JSON.parse('{"x":7,"__proto__":{"deep":1},"9":0}'));
log.push(sum(points.filter((_, i) => i % 2 === 0)), points.map(show).join(";"));
for (const s of [new Proxy({ x: 1 }, {}), { get x() { delete this.y; return 8; }, y: 2 }, Object.create({ x: 1 }, { y: { value: 2, enumerable: true } }), [4], "ab", { 3: 1, toString: null }, new Point({ x: "copy", q: 1 })]) {
  const p = new Point(s); log.push(show(p), Object.keys(p).join());
}
for (const line of log) console.log(line);
