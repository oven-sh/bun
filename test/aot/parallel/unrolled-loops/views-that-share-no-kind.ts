// Loops over two views of which every kind is known and none is common to both: comparators, sums and searches, also as a callback of sort.
type Small = Uint8Array | Int8Array;
type Wide = Float64Array | Float32Array;
function compare(a: Small, b: Wide): number { for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i]! - b[i]!; } return a.length - b.length; }
function order(a: Small, b: Wide): number { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { if (a[i]! < b[i]!) return -1; if (a[i]! > b[i]!) return 1; } return 0; }
function sixteen(a: Small, b: Wide): number { for (let i = 0; i < 16; i++) { if (a[i]! < b[i]!) return -1; else if (a[i]! > b[i]!) return 1; } return 0; }
function common(a: Small, b: Wide): number { let i = 0; for (; i < a.length && i < b.length; i++) if (a[i] !== b[i]) break; return i; }
function product(a: Small, b: Wide): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; }
function copied(a: Small, b: Wide): string { for (let i = 0; i < a.length; i++) b[i] = a[i]! + 0.5; return b.join(); }
function last(a: Small, b: Wide): number { let k = a.length - 1; while (k >= 0 && a[k] === b[k]) k--; return k; }
function joined(n: number, wide: boolean, deep: boolean): number {
  const a = wide ? new Int16Array(n) : new Int8Array(n), b = deep ? new Float64Array(n) : new Float32Array(n);
  for (let i = 0; i < a.length; i++) a[i] = i - 7;
  for (let i = 0; i < b.length; i++) b[i] = i * 3;
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}
const small: Small[] = [new Uint8Array(0), new Uint8Array([1, 2, 3]), new Int8Array([1, 2, -3]), new Uint8Array(20).fill(9), new Int8Array(17)];
const wide: Wide[] = [new Float64Array(0), new Float64Array([1, 2, 3]), new Float32Array([1, 2, 2.5]), new Float64Array(20).fill(9), new Float32Array(17)];
const out: (number | string)[] = [];
for (let round = 0; round < 3; round++) for (const a of small) for (const b of wide) out.push(compare(a, b), order(a, b), sixteen(a, b), common(a, b), product(a, b), last(a, b), copied(a, b.slice() as Wide));
console.log(out.join(" "));
console.log([...small].sort((x, y) => order(x, Float64Array.from(y)) || x.length - y.length).map(x => x.join("")).join("|"));
console.log(joined(300, true, false), joined(300, false, true), joined(4, true, true), joined(0, false, false));
