// STATISTIC: ExactIntegersBehindNumbers >= 1
function run(xs: number[], from: number): number { let s = from | 0; for (let i = 0; i < 37; i++) s = (s + xs[i & 7]!) | 0; return s; }
const xs: number[] = []; for (let i = 0; i < 4; i++) xs.push((i * 3 + 1) & 255);
console.log([0, 5, -1, 2147483647, -2147483648, 123456789].map(from => run(xs, from)).join(" "));
