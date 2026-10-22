// A loop sums an array of small integers and makes a call in every iteration. In one iteration the callee stores a fraction, a string, or a hole into an element that the loop has not reached yet.
let strikeAt = -1;
let mode = 0;
function visit(list: number[], index: number): number {
  if (index === strikeAt) {
    if (mode === 1) list[index + 2] = 0.25;
    else if (mode === 2) (list as any)[index + 2] = "s";
    else if (mode === 3) delete list[index + 2];
    else if (mode === 4) list[5000] = 1;
  }
  return 1;
}

function walk(list: number[]): string {
  let sum: any = 0;
  const end = Math.min(list.length, 8);
  for (let index = 0; index < end; index++) {
    sum += list[index];
    sum += visit(list, index);
  }
  return sum + " " + list.length;
}

for (let round = 0; round < 500; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  strikeAt = mode ? 3 : -1;
  const line = walk([round, 1, 2, 3, 4, 5, 6, 7]);
  if (mode || round === 0) console.log(round + ": " + line);
}
