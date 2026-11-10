class N { l = null; r = null; constructor(k, w) { this.k = k; this.w = w; } }
class M extends N { m = 1; }
function build(a, b) { if (a >= b) return null; const m = (a + b) >> 1, x = m & 1 ? new N(m, m * 0.5 + 0.25) : new M(m, m * 0.5); x.l = build(a, m); x.r = build(m + 1, b); return x; }
function walk(x) { return x === null ? 0 : x.w + x.k + (x instanceof M ? x.m : 0) + walk(x.l) + walk(x.r); }
console.log(walk(build(0, 63)));
