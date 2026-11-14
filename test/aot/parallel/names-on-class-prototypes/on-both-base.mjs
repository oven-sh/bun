const attempt = f => { try { return f(); } catch (e) { return e.name; } };
const items0 = process.argv.length;
function lay(o, k, v) { o[k] = v; }
class B { constructor(x) { this.x = x; } base() { return this.x; } }
class C extends B { own() { return this.x + 1; } }
class D extends C { own() { return super.own() + 1; } }
B.prototype.n = 8; C.prototype.n = "c";
const items = [new C(1), new C(2), new D(3), new C(4)];
function read(o) { const n = o.n; return typeof n === "function" ? "f" + String(n.call(o, 2)) : typeof n === "object" && n ? JSON.stringify(n) : String(n); }
function call(o) { return typeof o.n === "function" ? o.n(3) : -1; }
function rest(o) { return o.own() + ":" + o.base() + ":" + o.x + ":" + ("n" in o) + Object.hasOwn(o, "n"); }
function turn() { let s = ""; for (let i = 0; i < 24; i++) { const o = items[i & 3]; s += attempt(() => read(o)) + attempt(() => call(o)) + attempt(() => rest(o)); } return s; }
function sums() { let t = 0; for (let i = 0; i < 60; i++) { const o = items[i & 3]; const n = attempt(() => o.n); t += typeof n === "number" ? n : 1; t += attempt(() => o.x) | 0; } return t; }
const hash = t => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return h; };
console.log(hash(turn()), sums(), turn().slice(0, 40));
attempt(() => { B.prototype.n = "fromBase"; });
console.log(hash(turn()), sums(), turn().slice(0, 40));
for (let i = 0; i < 4; i++) attempt(() => { "use strict"; items[i].n = i; });
console.log(hash(turn()), sums(), items.map(o => Object.keys(o).join("+")).join(), attempt(() => Object.keys(C.prototype).join()), String(items[0]));
