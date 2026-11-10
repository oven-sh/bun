// A sum over lists of lists, then the same with a hole in one of them: the sum is NaN, and NaN for whoever asks it.
// STATISTIC: StepsOfListsThatReadHolesAsNaN >= 1
function sum(rows: number[][]): number { let s = 0; for (const r of rows) for (const v of r) s += v; return s; }
const rows: number[][] = []; for (let i = 0; i < 20; i++) { const r: number[] = []; for (let j = 0; j < 20; j++) r.push(j); rows.push(r); }
let t = 0; for (let k = 0; k < 50; k++) t += sum(rows);
console.log(t);
delete rows[7][13];
const n = sum(rows);
console.log(n, n === n, Number.isNaN(n), n | 0, Math.floor(n), [1, 2, 3][n], String(n), n > 0, n < 0);
