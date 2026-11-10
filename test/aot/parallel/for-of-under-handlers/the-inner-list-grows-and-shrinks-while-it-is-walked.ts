// The list that the inner loop walks grows or shrinks in its own turns, and so does the outer one: each step asks the length anew.
// STATISTIC: StepsOfListsOnWaysApartUnderHandlers >= 4
function grow(rows: number[][]): number { let s = 0; for (const r of rows) for (const v of r) { if (r.length < 12) r.push(v + 1); s += v; } return s; }
function shrink(rows: number[][]): number { let s = 0; for (const r of rows) for (const v of r) { if (v === 3) r.length = 5; s += v; } return s; }
function outerGrows(rows: number[][]): number { let s = 0; for (const r of rows) { if (rows.length < 9) rows.push([s]); for (const v of r) s += v; } return s; }
const make = () => { const rows: number[][] = []; for (let i = 0; i < 6; i++) { const r: number[] = []; for (let j = 0; j < 8; j++) r.push(j); rows.push(r); } return rows; };
for (let k = 0; k < 30; k++) { grow(make()); shrink(make()); outerGrows(make()); }
console.log(grow(make()), shrink(make()), outerGrows(make()));
