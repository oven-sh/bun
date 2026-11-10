// STATISTIC: ExactIntegersBehindNumbers >= 1
function found(k: number[], n: number, sought: number): number { let times = 0; for (let i = 0; i < n; i++) if (((k[i & 7]! * 3) | 0) === sought) times++; return times; }
const k: number[] = new Array(8); for (let i = 0; i < 8; i++) if (i !== 5) k[i] = (i * 3) & 255;
console.log([0, 9, 18, 63].map(sought => [1, 7, 8, 9, 40].map(n => found(k, n, sought)).join()).join(" "));
