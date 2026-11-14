// Under: --aot-testing=CheckBoundsAtRunTime: every access to an element is checked against its array
const weights: number[][] = [];
for (let y = 0; y < 6; y++) { const row: number[] = []; for (let x = 0; x < 6; x++) row.push((y * 7 + x * 3) / 4 + 0.125); weights.push(row); }
const factors: number[] = JSON.parse("[2, 0.5, -3]");
function run(weights: number[][], factors: number[], rows: number, columns: number): string {
  let text = "";
  for (let y = 1; y < rows; y++) {
    const row: number[] = new Array(columns).fill(0.5);
    const factor = factors[y % 3]!;
    for (let x = 0; x < columns; x++) row[x] = row[x]! - factor * weights[y]![x]! + weights[y - 1]![x]! * factor;
    text += row.map(v => Object.is(v, -0) ? "-0" : String(v)).join() + ";";
  }
  return text;
}
for (let round = 0; round < 3; round++) {
  if (round === 1) { weights[3]![3] = NaN; weights[1]![1] = -0; }
  for (const columns of [6, 4, 7]) { let line: string; try { line = run(weights, factors, 5, columns); } catch (e: any) { line = e.constructor.name; } console.log(round, columns, line); }
}
