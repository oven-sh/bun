// continue and break with a label lead out of the inner loop, past its step on two ways.
// STATISTIC: StepsOfListsOnWaysApartUnderHandlers >= 2
function run(rows: number[][]): string {
  let s = 0, t = 0;
  outer: for (const r of rows) { for (const v of r) { if (v % 7 === 6) continue outer; if (v === 58) break outer; s += v; } t++; }
  return s + " " + t;
}
const rows: number[][] = []; for (let i = 0; i < 10; i++) { const r: number[] = []; for (let j = 0; j < 5; j++) r.push(i * 10 + j * 2); rows.push(r); }
for (let k = 0; k < 40; k++) run(rows);
console.log(run(rows));
