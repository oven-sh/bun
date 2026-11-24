class A { constructor(x) { if (x === 1) throw new RangeError("one"); if (x === 2) return { x: "other" }; this.x = x; } }
class B extends A { constructor(x) { super(x); this.y = 1; } }
const all = JSON.parse("[0,1]").map((n) => [A, B][n]);
const out = [];
for (let i = 0; i < 8; i++) { try { const o = Reflect.construct(all[i & 1], [i >> 1]); out.push(o.x + ":" + o.y + ":" + (o instanceof A)); } catch (e) { out.push(e.message); } }
console.log(out.join());
