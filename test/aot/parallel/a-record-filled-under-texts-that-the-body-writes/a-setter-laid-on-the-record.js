// STATISTIC: StoresResolvedToLiteralKeys >= 1
function add(a, b) { return a + b; }
function scale(a, s) { return a * s; }
function other(a) { return "other" + a; }
const N = { zero: 0 };
Object.defineProperty(N, "add", { set(v) { this.seen = v; }, get() { return scale; }, enumerable: true });
for (const k of ["add", "scale"]) N[k] = k === "add" ? add : scale;
console.log(N.seen === add, N.add === scale);
let sum = 0;
for (let i = 0; i < 50; i++) sum += N.add(i, 1) + N.scale(i, 2);
console.log(sum, N.zero, Object.keys(N).join());
