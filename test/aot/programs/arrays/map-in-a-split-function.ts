// `Array.prototype.map` in a function that returns early for an empty array.
const out: string[] = [];
function toNumbers(R: string[]) { if (!R.length) return []; return R.map(v => +v); }
for (let i = 0; i < 2; i++) toNumbers(["3"]);
out.push(toNumbers(["5", "0", "1", "-2", "1.5", "x", "4e-323", "-0"]).map(v => Object.is(v, -0) ? "-0" : String(v)).join());
function toInts(R: string[]) { if (!R.length) return []; return R.map(v => v.length); }
for (let i = 0; i < 2; i++) toInts(["abc"]);
out.push(toInts(["a", "bb", ""]).join());
function toStrings(R: number[]) { if (!R.length) return []; return R.map(v => "s" + v); }
for (let i = 0; i < 2; i++) toStrings([3]);
out.push(toStrings([1, 2.5]).join());
function halves(R: number[]) { if (!R.length) return []; return R.map(v => v / 2); }
for (let i = 0; i < 2; i++) halves([3]);
out.push(halves([1, 2, 3]).join());
function keptDoubles(R: number[]) { if (!R.length) return []; return R.filter(v => v > 1.25); }
for (let i = 0; i < 2; i++) keptDoubles([1.5, 0.5]);
out.push(keptDoubles([0.5, 1.5, 2.5]).join());
function copied(R: string[]) { if (!R.length) return []; return Array.from(R, v => +v); }
for (let i = 0; i < 2; i++) copied(["3"]);
out.push(copied(["7", "8.25"]).join());
function counted(n: number) { if (!n) return []; return Array.from({ length: n }, (v, i) => i + 0.5); }
for (let i = 0; i < 2; i++) counted(2);
out.push(counted(3).join());
function mixed(R: string[]) { if (!R.length) return []; return R.map(v => v.length > 1 ? v : +v); }
for (let i = 0; i < 2; i++) mixed(["1", "ab"]);
out.push(mixed(["1", "ab", "2"]).join());
function grown(R: string[]) { if (!R.length) return []; return R.map(v => +v); }
for (let i = 0; i < 2; i++) grown(["3"]);
{ const r = grown(["1", "2"]); r.push(3.5); r[5] = 1; out.push(r.join() + " " + r.length); }
console.log(out.join("\n"));
