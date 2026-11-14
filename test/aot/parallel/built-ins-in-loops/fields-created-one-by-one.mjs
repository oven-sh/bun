// Fields are created one behind another on objects of several layouts, behind computed keys, deletions, freezes, setters above and in other orders.
const q = ["a", "b", "c", "x", "y"];
function add(o) { o.x = 1; o.y = 2; o.z = 3; return o; }
function addOther(o, k) { if (k & 1) o.z = k; o.x = k; if (k & 2) o.y = "s" + k; o.w = 1.5; return o; }
const kinds = [() => ({ a: 1 }), () => ({ b: 2, c: 3 }), () => ({}), () => ({ x: 0 }), () => ({ z: 9, a: 1 }), () => Object.create({ inherited: 1 }), () => [1, 2], () => function named() {}, () => ({ y: 1, [q[3]]: 2 })];
function literal(k) { return { [q[k % 5]]: k, c: 1, d: 2, [q[(k + 1) % 5]]: "t", e: 3 }; }
class Options { constructor(n) { this.first = n; if (n & 1) this.second = n; this.third = n; if (n & 2) this.fourth = n; this.fifth = 1; } }
class Heir extends Options { constructor(n) { super(n); this.sixth = n; if (n & 4) delete this.third; this.seventh = 7; } }
const show = o => Object.keys(o).map(k => k + "=" + String(o[k])).join() + (typeof o === "function" ? "" : JSON.stringify(o));
function all(turns) { let s = ""; for (let k = 0; k < turns; k++) { s += show(add(kinds[k % 9]())) + ";" + show(addOther(kinds[k * 5 % 9](), k)) + ";" + show(literal(k)) + ";" + show(k % 3 ? new Options(k) : new Heir(k)) + "\n"; if (k > 40) s = s.slice(s.length >> 1); } return s; }
console.log(all(36)); console.log(all(400).length);
function setters(turns) { const proto = { set y(v) { this.hidden = v * 2; } }; let s = ""; for (let k = 0; k < turns; k++) { const o = Object.create(proto); o.k = k; add(o); s = show(o) + s.length; } return s; }
console.log(setters(50));
function refused(o) { try { add(o); return show(o); } catch (error) { return error.name + show(o); } }
console.log([Object.freeze({ a: 1 }), Object.seal({ x: 0 }), Object.preventExtensions({ b: 1 }), { a: 1 }].map(refused).join(" "));
const kept = []; for (let k = 0; k < 200; k++) { const o = kinds[k % 5](); if (k % 7 === 0) delete o.a; add(o); if (k % 11 === 0) { delete o.y; o.y = k; } kept.push(show(o)); } console.log(new Set(kept).size, kept.slice(0, 24).join(" "));
