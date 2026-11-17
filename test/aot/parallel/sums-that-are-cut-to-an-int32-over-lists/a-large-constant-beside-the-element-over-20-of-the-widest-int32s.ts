function run(xs: number[], from: number): number { let s = from | 0; for (let i = 0; i < xs.length; i++) s = (s * 1103515245 + xs[i]!) | 0; return s; }
const xs: number[] = []; for (let i = 0; i < 20; i++) xs.push(i & 1 ? 2147483647 : -2147483648);
console.log([0, 5, -1, 2147483647, -2147483648, 123456789].map(from => run(xs, from)).join(" "));
