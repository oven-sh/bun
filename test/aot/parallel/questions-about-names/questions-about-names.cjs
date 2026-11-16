// Functions ask whether objects have names and use other names where they have them, methods read names of their own class off a parameter; they get heirs, other classes, records, proxies and primitives.
const LOG = [];
function show(v) { return Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "function" : v === null || typeof v !== "object" ? typeof v + String(v) : Array.isArray(v) ? "[" + v.map(show) + "]" : v.constructor ? "o:" + v.constructor.name : "o"; }
class Point { constructor(g = -3, y = 1, r = 0.125, z = 7) { this.g = g; this.y = y; this.r = r; this.z = z; } 
dot(v) { return this.g * v.g + this.y * v.y + this.r * v.r + this.z * v.z; } copy(v) { this.g = v.g; this.y = v.y; this.r = v.r; this.z = v.z; return this; }
add(v) { this.g += v.g; this.y += v.y; this.r += v.r; this.z += v.z; return this; } equals(v) { return v.g === this.g && v.y === this.y && v.r === this.r && v.z === this.z; }
take(v) { this.g = v.g; this.y = v.y; this.r = v.r; this.z = v.z !== undefined ? v.z : 1; return this; } near(v) { return Math.abs(this.g - v.g) < 2 && v.length2() >= 0; } length2() { return this.dot(this); } get norm() { return this.g; } }
class Point4 { constructor() { this.g = -0; this.y = 7; this.r = 0.125; this.z = 1; this.extra = 1; } dot(v) { return "p4" + v.g; } length2() { return 4; } }
class Swapped { constructor() { this.z = 2.5; this.r = 1; this.y = 1e9; this.g = 1; } length2() { return 5; } }
class Getters { constructor() { this.h = 1; } get g() { LOG.push("g"); return 1e9; } get y() { LOG.push("y"); return 1; } get r() { LOG.push("r"); return 7; } get z() { LOG.push("z"); return 2.5; } length2() { return 6; } }
class Heir extends Point { constructor() { super(); this.tag = false; } } class Over extends Point { get y2() { return 1; } length2() { return 7; } }
class Base { constructor(o) { this.visible = null; this.layers = undefined; this.order = true; if (o) this.order = o; } update() { return "u" + this.order; } }
class H0 extends Base { constructor(o) { super(o); this.isH0 = 1; this.onlyH0 = 2 ** 31;  } computeH0() { this.sphere = 1; return "cH0"; } update() { return 'over' + this.onlyH0; } }
class H1 extends H0 { constructor(o) { super(o); this.isH1 = true; this.onlyH1 = 1.5;  } computeH1() { this.sphere = 1; return "cH1"; }  }
function f0(o, p) { const r = []; r.push(!! o.order, o.order === false); r.push(o.late || o.visible); if (o.isH0 != null) { r.push(o.update()); r.push(o.layers); r.push(o.layers); } return r; }
function f1(o, p) { const r = []; r.push(o.sphere && o.onlyH1); r.push(o.isH0); return r; }
function f2(o, p) { const r = []; r.push(o.update()); if (o.sphere === true) { r.push(o.order); var t2 = o.sphere; if (t2) r.push(t2); r.push(o.visible); if (o.late === true) { o.order = 1.5; } else if (o.isH1) { r.push(o.update()); } } else if (o.isH0) { r.push(o.order); } r.push(o.layers); return r; }
function f3(o, p) { const r = []; r.push(o.nothing); r.push(o.sphere || o.late); if (o.isH0 !== undefined) { if (o.isH0 === null) r.push(o.computeH1()); r.push(o.isH0); } else { if (o.order) { r.push(o.visible); } else { r.push(o.layers); } } if (o.late != null) { r.push(o.visible); r.push(o.late && o.onlyH1); } if (o.late) { o.nothing = 0; } return r; }
let R = 872487677; function rnd(n) { R = (Math.imul(R, 1103515245) + 12345) & 0x7fffffff; return (R >> 8) % n; }
const HEIRS = [H0, H1], FS = [f0, f1, f2, f3], NAMES = ['visible', 'layers', 'order', 'isH0', 'onlyH0', 'isH1', 'onlyH1', 'late', 'nothing'], F = ['g', 'y', 'r', 'z'], MS = ['dot', 'copy', 'add', 'equals', 'take', 'near'];
globalThis.KEEP = [HEIRS, Base, Point, Point4, Swapped, Getters, Heir, Over, FS, show];
function change(o, names) { if (rnd(25)) return; if (!o || typeof o !== "object") return; const n = names[rnd(names.length)]; try { switch (rnd(6)) { case 0: delete o[n]; break; case 1: o["new" + rnd(5)] = 1; break; case 2: Object.defineProperty(o, n, { get() { LOG.push("get " + n); return rnd(9); }, configurable: true }); break; case 3: Object.freeze(o); break; case 4: o.late = rnd(3); break; case 5: if (!rnd(6)) (rnd(2) ? Base : Point).prototype.late = rnd(4); break; } } catch (e) { LOG.push(e.name); } }
function object(i) { if (rnd(12)) return new HEIRS[rnd(HEIRS.length)](rnd(3)); switch (rnd(9)) { case 0: return null; case 1: return undefined; case 2: return 5; case 3: return "text"; case 4: return new Base(1); case 5: return { visible: 1, update() { return "r"; }, sphere: null, computeH0() { return 1; } }; case 6: return new Proxy(new HEIRS[0](2), { get(t, k) { LOG.push(String(k)); return t[k]; } }); case 7: return new Point(); default: return Object.create(new HEIRS[0](1)); } }
function point() { const q = rnd(16); if (q > 6) return new Point(); switch (q) { case 0: return new Point4(); case 1: return new Swapped(); case 2: return new Getters(); case 3: return new Heir(); case 4: return new Over(); case 5: return rnd(2) ? { [F[0]]: 2, length2() { return 1; } } : null; default: return rnd(2) ? 3 : undefined; } }
const lines = []; let hash = 0;
function add(l) { lines.push(l); for (let j = 0; j < l.length; j++) hash = (Math.imul(hash, 31) + l.charCodeAt(j)) | 0; if (lines.length > 40) lines.shift(); }
for (let i = 0; i < 120; i++) {
  for (const f of FS) { LOG.length = 0; const o = object(i), p = rnd(3) ? object(i) : o; change(o, NAMES); let r; try { r = f(o, p).map(show).join(); } catch (e) { r = e.constructor.name; } add(i + " " + f.name + " " + r + " " + LOG.join()); }
  for (const m of MS) { LOG.length = 0; const a = new Point(), v = rnd(5) ? point() : a; change(v, F); let r; try { r = show(a[m](v)) + F.map(k => show(a[k])); } catch (e) { r = e.constructor.name; } add(i + " " + m + " " + r + " " + LOG.join()); }
}
console.log("hash", hash); console.log(lines.join("\n"));
