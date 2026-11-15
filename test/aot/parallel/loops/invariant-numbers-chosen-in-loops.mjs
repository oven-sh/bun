// Invariant numbers that are int32s or not: fields, bound values, captured values and module variables in sums, differences and products of loops, beside values that are no numbers.
const out = [];
const values = [1, 1.5, 0, -0, -2147483648, 2147483647, 2147483648, -2147483649, 1e300, -1e-300, NaN, Infinity, -Infinity, 9007199254740991, true, null, undefined, "t", "4"];
function bound(a, b) { return this.v + a + b; }
function sumOfBound(f, turns) { let n = 0; for (let k = 0; k < turns; k++) n += f(k & 7); return n; }
for (const v of values) out.push(sumOfBound(bound.bind({ v }, 2), 37), sumOfBound(bound.bind({ v: 2 }, v), 5));
function ofField(o, turns) { let n = 0; for (let k = 0; k < turns; k++) n += o.scale * k - o.offset + o.offset; return n; }
for (const v of values) out.push(ofField({ scale: v, offset: 3 }, 9), ofField({ scale: 2, offset: v }, 9), ofField({ scale: v, offset: v }, 3));
function closure(v) { return k => k + v - 1; }
function ofClosure(f, turns) { let n = 0; for (let k = 0; k < turns; k++) n += f(k); return n; }
for (const v of values) out.push(ofClosure(closure(v), 11));
let shared = 1; const holder = { get v() { return shared; } };
function ofGetter(turns) { let n = 0; for (let k = 0; k < turns; k++) { n += holder.v + k; if (k === 4) shared = shared === 1 ? 0.5 : 1; } return n; }
for (const v of values) { shared = v; out.push(ofGetter(9)); }
function ofStores(o, turns) { let n = 0; for (let k = 0; k < turns; k++) { n += o.v + k; if (k & 1) o.v = k / 4; else o.v = k; } return n; }
out.push(ofStores({ v: 1 }, 12), ofStores({ v: 0.5 }, 12), ofStores({ v: -0 }, 1));
function nested(o, rows) { let n = 0; for (let i = 0; i < rows; i++) for (let j = 0; j < 3; j++) n += (o.a + i) * (o.b + j); return n; }
for (const v of values) out.push(nested({ a: v, b: 2 }, 3), nested({ a: 1, b: v }, 2));
function signs(o, turns) { let n = -0; for (let k = 0; k < turns; k++) n = n + (o.v + o.w); return Object.is(n, -0) ? "-0" : n; }
out.push(signs({ v: -0, w: -0 }, 3), signs({ v: 0, w: -0 }, 3), signs({ v: -0, w: 0 }, 0));
console.log(out.join(" "));
