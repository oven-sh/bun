// STATISTIC: DoublesRecomputedAsIntegers >= 9
function run(xs: number[], from: number): number { let s = from | 0; for (const x of xs) s = (s + x) | 0; return s; }
const xs: number[] = new Array(7); for (let i = 0; i < 7; i++) if (i !== 3) xs[i] = (i * 3 + 1) & 255;
console.log([0, 5, -1, 2147483647, -2147483648, 123456789].map(from => run(xs, from)).join(" "));
