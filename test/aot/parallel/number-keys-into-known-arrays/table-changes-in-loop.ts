// Under: --aot-testing=CheckBoundsAtRunTime: every read of an element is checked against its array
// The table grows, shrinks and is written while a loop reads it under computed keys.
const table: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
function walk(steps: number[], change: number): string {
  let total = 0;
  let missing = 0;
  for (let i = 0; i < steps.length; i++) {
    const key = Math.abs(steps[i]!);
    const value = table[key];
    if (value === undefined) missing++;
    else total += value;
    if (i === change) table.length = 3;
    if (i === change + 2) table.push(40, 50);
    if (i === change + 3) table[key] = 1.5;
  }
  return total + " " + missing + " " + table.length;
}
let lines = "";
for (const steps of [[0, 1, 2, 3, 4, 5, 6, 7], [-7, -6, -5, -4, -3, -2, -1, 0], [0.5, 7, 2, 9, 1, 1, 1, 3], [3, 3, 3, 3, 3, 3, NaN, 3]])
  for (let change = -1; change < 8; change++) {
    table.length = 0;
    for (let i = 1; i <= 8; i++) table.push(i);
    lines += walk(steps, change) + "\n";
  }
console.log(lines);
