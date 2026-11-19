// STATISTIC: StoresResolvedToLiteralKeys >= 12
// `o[wide ? "x" : "y"]` names one of the two and nothing else.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
class Cell { constructor(a, b) { this.a = a; this.b = b; this.next = null; } sum() { return this.a + this.b; } step(k) { this.a = (this.a + k) & 1023; if (this.next) this.b = this.next.b; return this; } }
function Pair(a, b) { this.a = a; this.b = b; this.name = "p"; }
Pair.prototype.sum = function () { return this.a + this.b; };
class Box { constructor(v) { this.width = v; this.height = v + 1; this.depth = v + 2; this.label = "box"; } get area() { return this.width * this.height; } set area(v) { this.width = v; this.height = 1; } volume() { return this.width * this.height * this.depth; } }
class Up { constructor(v) { this.v = v; } kind() { return "up"; } }
class Other { constructor() { this.v = 9; } kind() { return "other"; } }

function choose(o, first, value) { o[first ? "a" : "b"] = value; return o; }
tell("hot", () => { const list = []; let total = 0; for (let i = 0; i < 8; i++) { const c = new Cell(i, i + 1); c.next = i ? list[i - 1] : null; list.push(c); } for (let k = 0; k < 2000; k++) { const c = list[k & 7]; total = (total + c.step(k).sum()) | 0; if ((k & 31) === 0) c[k & 32 ? "a" : "b"] = k & 255; } return total; });
tell("pairs", () => { const pairs = []; for (let i = 0; i < 4; i++) pairs.push(choose(new Pair(i, i * 2), i & 1, i + 7)); return pairs.map((p) => [p.sum(), Object.keys(p).join()]); });
function three(o, n, value) { const key = n === 0 ? "width" : n === 1 ? "height" : "depth"; o[key] = value; return o; }
tell("three", () => [0, 1, 2, 3].map((n) => three(new Box(2), n, 10).volume()));
function bySwitch(o, n, value) { let key; switch (n) { case 0: key = "width"; break; case 1: key = "height"; break; case 2: key = "label"; break; default: key = "depth"; } o[key] = value; return o; }
tell("switch", () => [0, 1, 2, 3].map((n) => JSON.stringify(bySwitch(new Box(3), n, 4))));
tell("compound", () => { const o = new Box(1); for (let i = 0; i < 6; i++) { o[i % 2 ? "width" : "height"] += i; o[i % 3 ? "depth" : "width"]++; } return [o, o.volume()]; });
tell("setter", () => { const o = new Box(1); for (let i = 0; i < 3; i++) o[i % 2 ? "area" : "width"] = i + 5; return [o, o.area]; });
tell("new name", () => { const o = new Pair(1, 2); for (let i = 0; i < 2; i++) o[i ? "late" : "a"] = i + 3; return [Object.keys(o), o.late, o.sum()]; });
tell("method", () => { const o = new Pair(1, 2); for (let i = 0; i < 2; i++) o[i ? "sum" : "a"] = () => "own"; return [String(o.sum()), Object.keys(o)]; });
tell("link", () => { const o = new Up(1); const p = new Up(2); o[process.argv.length > 99 ? "v" : "__proto__"] = new Other(); p[process.argv.length > 99 ? "__proto__" : "v"] = 7; return [o.kind(), o.v, p.kind(), p.v, Object.getPrototypeOf(o) === Up.prototype]; });
tell("digits", () => { const o = { a: 1 }; for (let i = 0; i < 2; i++) o[i ? "0" : "a"] = i; return Object.entries(o); });
tell("carried", () => { const o = new Pair(1, 2); let key = "a"; for (let i = 0; i < 4; i++) { o[key] = i; key = i & 1 ? "b" : "name"; } return Object.entries(o); });
tell("or", () => { const o = new Pair(1, 2); const given = [null, "late", ""]; for (const name of given) o[name || "a"] = name; return Object.entries(o); });
tell("read", () => { const o = new Pair(1, 2); let text = ""; for (let i = 0; i < 4; i++) text += o[i & 1 ? "a" : i ? "b" : "name"]; return text; });
tell("read absent", () => { const o = new Cell(1, 2); return [0, 1].map((i) => String(o[i ? "a" : "missing"])); });
tell("values", () => { const o = new Pair(1, 2); for (const v of ["x", null, 1.5, o]) choose(o, v === null, v); return [o.a, o.b === o, o.name]; });
tell("frozen", () => { const o = Object.freeze(new Pair(1, 2)); choose(o, true, 5); return o; });
tell("try", () => { const o = new Pair(1, 2); let key = "a"; try { if (process.argv.length > 99) throw 0; key = process.argv.length > 98 ? "a" : "b"; null.x; } catch (e) { o[key] = 8; } return o; });
tell("in and delete", () => { const o = new Pair(1, 2); const r = []; for (let i = 0; i < 2; i++) { r.push((i ? "a" : "zzz") in o); r.push(delete o[i ? "name" : "zzz"]); } return [r, o]; });
for (const line of out) console.log(line);
