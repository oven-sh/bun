// The constructor of a built-in collection calls the adder of the object it is making.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); }
const seen = [];
class M extends Map { tagM = { qa: 1 }; set(k, v) { seen.push(attempt(() => this.tagM.qa)); return super.set(k, v); } }
class S extends Set { tagS = { qa: 2 }; add(v) { seen.push(attempt(() => this.tagS.qa)); return super.add(v); } }
class WM extends WeakMap { tagW = { qa: 3 }; set(k, v) { seen.push(attempt(() => this.tagW.qa)); return super.set(k, v); } }
class WS extends WeakSet { tagV = { qa: 4 }; add(v) { seen.push(attempt(() => this.tagV.qa)); return super.add(v); } }
const m = new M([[1, 2]]); m.set(3, 4);
const s = new S([1]); s.add(2);
const wm = new WM([[{}, 2]]); wm.set({}, 4);
const ws = new WS([{}]); ws.add({});
console.log(seen.join("|"), m.size, s.size);
