// What the step of a for-of hands out goes into a variable that the catch block reads. The step goes on two ways under that handler, and the handler reads what the last step gave.
// STATISTIC: StepsOfListsOnWaysApartUnderHandlers >= 5
function risky(v: number, stop: number): number { if (v === stop) throw new Error("stop"); return v; }
function run(list: number[], stop: number): string {
  let last = -1, s = 0;
  try { for (last of list) s += risky(last, stop); } catch { return "caught at " + last + " with " + s; }
  return "whole " + last + " " + s;
}
function nest(rows: number[][], stop: number): string {
  let last = -1, row: number[] = [], s = 0;
  try { for (row of rows) for (last of row) s += risky(last, stop); } catch { return "caught at " + last + " of " + row.length + " with " + s; } finally { s = -1; }
  return "whole " + last + " " + row.length + " " + s;
}
const list: number[] = []; for (let j = 0; j < 20; j++) list.push(j * 2);
const rows: number[][] = []; for (let i = 1; i < 6; i++) { const r: number[] = []; for (let j = 0; j < i; j++) r.push(i * 10 + j); rows.push(r); }
for (let k = 0; k < 40; k++) { run(list, -1); nest(rows, -1); }
console.log(run(list, -1), run(list, 0), run(list, 14), run(list, 38), run([], 0));
console.log(nest(rows, -1), nest(rows, 10), nest(rows, 32), nest(rows, 54), nest([], 0), nest([[]], 0));
