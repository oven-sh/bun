// The same in a callback of map.
try {
let LAST = null, total = 0; const KEEP = [], W = new Map(), BOX = { v: null }, NUMBERS = [0, 1, 2, 3, 4, 5, 6];
function touch(x) { total += typeof x === 'number' ? x : 1; return globalThis.asText ? String(x) : 1; }
function touchObject(o) { total += o.x; if (globalThis.asText) return { ...o }; return o; }
function finish(o, s) { o.x += 1; return o.x + s; }
function tell(o) { return typeof o === 'object' ? o.x + ',' + Object.keys(o).join('') : String(o); }
class V { #x = 0; constructor(x, y) { this.#x = x; this.y = y; this.z = 0.5; this.hit = false; this.at = null; this.name = 'none'; this.n = 0; } get x() { return this.#x; } set x(v) { this.#x = v; } add(o) { return new V(this.x + o.x, this.y + o.y); } scale(f) { return new V(this.x * f, this.y * f); } clamp() { this.x = this.x > 50 ? 50 : this.x; return this; } pick(o) { return this.x < o.x ? this : o; } same(o) { return this.x === o.x ? this : new V(o.x, this.y); } tell() { return this.x + ':' + this.y; } }
function add(a, o) { return a.add(o); }
function scale(a, f) { return a.scale(f); }
function clamp(a) { return a.clamp(); }
function pick(a, o) { return a.pick(o); }
function same(a, o) { return a.same(o); }
const A = new V(1.5, 2.5), B = new V(0.25, -0.5);
function say(r) { console.log(typeof r === 'object' && r !== null ? Object.entries(r).map(([a, b]) => a + '=' + (typeof b === 'object' && b ? b.x : b)).join() : r, total); }
function run(list) { return list.map(k => { const n = k + 3;
    let s = 0, first = null; let p = new V(1, 2); KEEP.push(p);
    let i = 0; do {
      p = scale(p, p.y);
      if (i === 5) break;
    } while (++i < n);
    return p;
}); }
for (const r of run([0, 1, 2, 5])) say(r);
console.log(A.x, B.x, KEEP.length, KEEP.map(o => o && o.x).join(), LAST && LAST.x, BOX.v && BOX.v.x, W.size, total);
} catch (problem) { console.log('threw', problem && problem.message, problem && problem.x); }
