// Under: --aot-testing=CheckBoundsAtRunTime: every access to an element is checked against its array
const turns = Number(process.argv[2] ?? 3);
const weights: number[] = []; for (let x = 0; x < 64; x++) weights.push((x * 3) & 255);
const row: number[] = []; for (let x = 0; x < 64; x++) row.push(x & 3);
function run(weights: number[], row: number[], columns: number): string {
  let total = 0; let last: any = 1;
  for (let x = 0; x < columns; x++) { last = weights[x]!; row[x] = last === undefined ? -2 : last; }
  return total + " " + String(last);
}
for (let round = 0; round < turns; round++) {
  if (round === 1) { delete (weights as any)[3]; delete (weights as any)[0]; }
  let line = "";
  for (const columns of [64, 40, 70]) line = run(weights, row, columns);
  if (round < 3) console.log(round, line, row.slice(0, 8).map(v => Object.is(v, -0) ? "-0" : String(v)).join());
}
