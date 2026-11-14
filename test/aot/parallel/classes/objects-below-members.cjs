// What a member holds is above other objects: `this.shelf = Object.create(proto); Object.create(this.shelf)`.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name + ": " + e.message; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
const proto = { get x() { return this._x; }, set x(v) { this._x = v; }, sum() { return this._x + (this.n | 0); } };
class App { constructor() { this.shelf = Object.create(proto); } make(i) { const o = Object.create(this.shelf); o.x = i; o.n = i * 2; return o; } }
const literal = { get z() { return this._z; }, set z(v) { this._z = v; } };
function Other() { return { held: Object.create(literal), make(i) { const o = Object.create(this.held); o.z = i; return o; } }; }
const plain = { tell() { return "plain " + this.v; } };
class Kept { kept = Object.create(plain); make(v) { const o = Object.create(this.kept); o.v = v; return o; } direct(v) { const o = Object.create(plain); o.v = v; return o; } }
tell("app", () => { const a = new App(); let t = 0; for (let k = 0; k < 2000; k++) { const o = a.make(k & 15); t = (t + o.x + o.sum()) | 0; } const o = a.make(3); return [t, Object.keys(o), Object.getPrototypeOf(o) === a.shelf, Object.getPrototypeOf(a.shelf) === proto]; });
tell("shelf changed", () => { const a = new App(); const o = a.make(1); a.shelf.sum = function () { return "shelf"; }; Object.defineProperty(a.shelf, "x", { get() { return "own"; }, set(v) { this.seen = v; } }); const p = a.make(2); return [o.sum(), o.x, p.x, p.seen, new App().make(5).x]; });
tell("other", () => { const h = Other(); let t = 0; for (let k = 0; k < 500; k++) t += h.make(k).z; return [t, Object.keys(h.make(1))]; });
tell("kept", () => { const k = new Kept(); let s = ""; for (let i = 0; i < 100; i++) s = k.make(i).tell() + k.direct(i).tell(); k.kept.tell = function () { return "kept " + this.v; }; return [s, k.make(1).tell(), k.direct(1).tell()]; });
tell("proto changed", () => { const a = new App(); const o = a.make(1); proto.sum = function () { return "proto"; }; return [o.sum(), a.make(2).sum()]; });
console.log(out.join("\n"));
