// STATISTIC: StoresResolvedToLiteralKeys >= 1
function add(a, b) { return a + b; }
function scale(a, s) { return a * s; }
function other(a) { return "other" + a; }
class Holder { constructor() { this.zero = 0; } set add(v) { this.seen = v; } get add() { return scale; } }
const N = new Holder();
for (const [k, v] of [["add", add], ["scale", scale]]) N[k] = v;
console.log(N.seen === add, N.add === scale);
let sum = 0;
for (let i = 0; i < 50; i++) sum += N.add(i, 1) + N.scale(i, 2);
console.log(sum, N.zero, Object.keys(N).join());
