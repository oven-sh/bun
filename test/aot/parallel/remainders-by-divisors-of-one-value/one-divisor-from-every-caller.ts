function ring(h: number, m: number, n: number): number { for (let i = 0; i < n; i++) h = (h * 3 + 1) % m; return h; }
function zero(h: number, m: number): number { let s = 0; for (let i = 0; i < 3; i++) s += (h + i) % m; return s; }
function one(h: number, m: number): string { let t = ""; for (let i = -1; i < 2; i++) { const r = (h * i) % m; t += Object.is(r, -0) ? "-0," : r + ","; } return t; }
function two(h: number, m: number): number { return h === 0 ? 0 : (h % m) + two(h - 1, m === 7 ? 5 : 7); }
console.log(ring(4, 65521, 1), ring(60000, 65521, 1), ring(0.5, 65521, 1), ring(-1, 65521, 1), ring(2 ** 40, 65521, 1), zero(1, 0), one(4, -1), two(9, 7));
