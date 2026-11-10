// The lists of one sum come to hold a fraction, a number beyond an int32, minus zero, NaN and Infinity.
// STATISTIC: StepsOfListsThatReadHolesAsNaN >= 1
function sum(rows: number[][]): number { let s = 0; for (const r of rows) for (const v of r) s += v; return s; }
const rows: number[][] = []; for (let i = 0; i < 20; i++) { const r: number[] = []; for (let j = 0; j < 20; j++) r.push(j); rows.push(r); }
let t = 0; for (let k = 0; k < 50; k++) t += sum(rows);
console.log(t);
rows[3][4] = 0.5; console.log(sum(rows));
rows[5][6] = 2 ** 40; console.log(sum(rows));
rows[6][0] = -0; console.log(sum(rows), Object.is(sum([[-0], [-0]]), 0), Object.is(sum([]), 0));
rows[8][1] = NaN; console.log(sum(rows));
rows[8][1] = Infinity; console.log(sum(rows));
