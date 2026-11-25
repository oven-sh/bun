function power(b: number, e: number, m: number): number { let r = 1; b = b % m; while (e > 0) { if (e & 1) r = r * b % m; b = b * b % m; e = e >> 1; } return r; }
const s = (x: number) => Object.is(x, -0) ? "-0" : String(x);
console.log([power(3, 13, 65521), power(3, 0, 65521), power(65520, 2, 65521), power(2, 16, 65521), power(2, 31, 65521), power(3, 2, 1), power(3, 3, 0), power(-3, 3, 7), power(-7, 1, 7), power(0.5, 2, 7), power(5, -1, 7)].map(s).join(" "));
