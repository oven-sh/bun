// STATISTIC: StoresKeepingPrototypes >= 4
// A number, a string or a boolean that is stored under a computed name puts nothing above an object.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
class Cell { constructor(a, b) { this.a = a; this.b = b; this.next = null; } sum() { return this.a + this.b; } step(k) { this.a = (this.a + k) & 1023; if (this.next) this.b = this.next.b; return this; } }
function Pair(a, b) { this.a = a; this.b = b; }
Pair.prototype.sum = function () { return this.a + this.b; };
class Above { constructor() { this.v = 1; } kind() { return "above"; } }
class Link { constructor(a) { this.a = a; } kind() { return "link"; } }
class Null { constructor(a) { this.a = a; } kind() { return "null"; } }
class Text { constructor(a) { this.a = a; } kind() { return "text" + this.a; } set marked(v) { this.a = "set " + v; } }

function put(o, name, value) { o[name] = value; return o; }
function putNumber(o, name, value) { o[name] = +value; return o; }
function putFlag(o, name, value) { o[name] = value > 2; return o; }
function putText(o, name, value) { o[name] = "t" + value; return o; }
function choose(o, first, value) { o[first ? "a" : "b"] = value | 0; return o; }
const names = ("a b next sum __proto__ constructor kind marked other " + (process.argv[2] || "more")).split(" ");

tell("hot", () => { const list = []; let total = 0; for (let i = 0; i < 8; i++) { const c = new Cell(i, i + 1); c.next = i ? list[i - 1] : null; list.push(c); } for (let k = 0; k < 2000; k++) { const c = list[k & 7]; total = (total + c.step(k).sum()) | 0; if ((k & 31) === 0) choose(c, k & 32, k); } return total; });
tell("pairs", () => { const pairs = []; for (let i = 0; i < 4; i++) pairs.push(choose(new Pair(i, i * 2), i & 1, i + 7)); return pairs.map((p) => [p.sum(), Object.keys(p).join(), Object.getPrototypeOf(p) === Pair.prototype]); });
tell("numbers", () => names.map((name) => { const o = putNumber(new Cell(1, 2), name, 5); let sum; try { sum = o.sum(); } catch (e) { sum = e.constructor.name; } return [name, Object.keys(o).join(), Object.getPrototypeOf(o) === Cell.prototype, sum]; }));
tell("flags", () => names.map((name) => { const o = putFlag(new Pair(1, 2), name, 5); let sum; try { sum = o.sum(); } catch (e) { sum = e.constructor.name; } return [name, Object.keys(o).join(), Object.getPrototypeOf(o) === Pair.prototype, String(sum)]; }));
tell("texts", () => names.map((name) => { const o = putText(new Text(1), name, 5); let kind; try { kind = o.kind(); } catch (e) { kind = e.constructor.name; } return [name, Object.keys(o).join(), Object.getPrototypeOf(o) === Text.prototype, kind]; }));
tell("objects", () => names.map((name) => { const o = put(new Link(1), name, new Above()); let kind; try { kind = o.kind(); } catch (e) { kind = e.constructor.name; } return [name, Object.keys(o).join(), Object.getPrototypeOf(o) === Link.prototype, kind]; }));
function putNull(o, name) { o[name] = null; return o; }
tell("null", () => names.map((name) => { const o = putNull(new Null(1), name); let kind; try { kind = o.kind(); } catch (e) { kind = e.constructor.name; } return [name, Object.keys(o).join(), Object.getPrototypeOf(o) === Null.prototype, kind]; }));
const maybe = (k) => k > 3 ? new Above() : k;
function putMaybe(o, name, k) { o[name] = maybe(k); return o; }
class Maybe { constructor(a) { this.a = a; } kind() { return "maybe"; } }
tell("maybe", () => names.map((name, k) => { const o = putMaybe(new Maybe(1), name, k); let kind; try { kind = o.kind(); } catch (e) { kind = e.constructor.name; } return [name, Object.getPrototypeOf(o) === Maybe.prototype, kind]; }));
for (const line of out) console.log(line);
