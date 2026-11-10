// STATISTIC: DoublesRecomputedAsIntegers >= 10
const kept = new Int32Array(40);
function run(xs: number[], from: number): number { let s = from | 0; for (let i = 0; i < xs.length; i++) { s = (s + xs[i]!) | 0; kept[i] = s; } return s ^ kept[xs.length >> 1]!; }
const xs: number[] = new Array(20); for (let i = 0; i < 20; i++) if (i !== 10) xs[i] = (i * 3 + 1) & 255;
console.log([0, 5, -1, 2147483647, -2147483648, 123456789].map(from => run(xs, from)).join(" "));
