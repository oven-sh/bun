// Nests whose inner loops move elements of a list and whose outer loops store one behind them: counters lowered by one and by a gap, started at i and i - 1, stores at j, j + 1, j + 2 and i; lists of int32s, doubles, holes, texts, frozen, with another prototype, under two names; 0 to 30 elements.
// STATISTIC: LoweredCountersReadAfterLoops >= 3
// STATISTIC: RelationsFailedByHoles >= 1
function show(l) { let t = "["; for (let i = 0; i < Math.min(l.length, 40); i++) t += (i ? "," : "") + (Object.hasOwn(l, i) ? Object.is(l[i], -0) ? "-0" : typeof l[i] === "string" ? "'" + l[i] : String(l[i]) : "_"); return t + "]" + Object.keys(l).length; }
function below(l) { for (let i = 1; i < l.length; i++) { const x = l[i]; let j = i - 1; while (j >= 0 && l[j] > x) { l[j + 1] = l[j]; j--; } l[j + 1] = x; } return l; }
function beside(l) { for (let i = 1; i < l.length; i++) { const x = l[i]; let j = i; for (; j > 0 && l[j - 1] > x; j--) l[j] = l[j - 1]; l[j] = x; } return l; }
function least(l) { for (let i = 1; i < l.length; i++) { const x = l[i]; let j = i - 1; while (j >= 0 && x < l[j]) { l[j + 1] = l[j]; j -= 1; } l[j + 1] = x; } return l; }
function past(l) { let g = 0; for (let i = 1; i < l.length && i < 12; i++) { const x = l[i]; let j = i; while (j >= 0 && l[j] > 3) { l[j + 1] = l[j]; j--; if (g++ > 200) return l; } l[j + 2] = x; } return l; }
function other(l, m) { for (let i = 1; i < l.length; i++) { const x = m[i]; let j = i - 1; while (j >= 0 && l[j] > x) { m[j + 1] = l[j]; j--; } l[j + 1] = x; } return l; }
function shorter(l) { for (let i = 1; i < l.length; i++) { if (i === 3) l.length = 4; const x = l[i]; let j = i - 1; while (j >= 0 && l[j] > x) { l[j + 1] = l[j]; j--; } l[j + 1] = x; } return l; }
function gap(l) { for (let g = l.length >> 1; g > 0; g >>= 1) for (let i = g; i < l.length; i++) { const x = l[i]; let j = i; while (j >= g && l[j - g] > x) { l[j] = l[j - g]; j -= g; } l[j] = x; } return l; }
const special = Object.create(Array.prototype, { 1: { value: 6, writable: true }, 4: { get() { return 8; }, set(v) { } } });
const makes = [() => [], () => [3], () => [2, 1], () => [5, 3, 9, 1, 7, 2, 8, 4], () => [5, , 9, 1, , 2], () => [5.5, 3, 9.25, -0, 0], () => ["b", "a", 3, "c"], () => [5, undefined, 1, NaN, 2], () => Array.from({ length: 30 }, (_, i) => (i * 17) % 31), () => Object.freeze([3, 2, 1]), () => Object.setPrototypeOf([9, , 7, 6, , 4], special), () => [2147483647, -2147483648, 0], () => Int32Array.from([4, 3, 9, 1])];
for (let turn = 0; turn < 3; turn++) for (const make of makes) for (const f of [below, beside, least, past, other, shorter, gap]) {
  const l = make(), m = turn === 1 ? l : make();
  try { console.log(f.name, show(f(l, m)), show(m)); } catch (e) { console.log(f.name, e.name, show(l), show(m)); }
}
