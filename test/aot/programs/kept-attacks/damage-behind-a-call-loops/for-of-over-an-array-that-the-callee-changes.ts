// A for-of loop over an array makes a call in every iteration. The callee appends, removes, and at last replaces the iterator method on the array itself, which the running loop does not see and the next loop does.
let mode = 0;
function visit(list: number[], value: number): number {
  if (value === 2) {
    if (mode === 1) list.push(50);
    else if (mode === 2) list.pop();
    else if (mode === 3) list.length = 0;
    else if (mode === 4) {
      (list as any)[Symbol.iterator] = function* () {
        yield -1;
      };
    }
  }
  return value;
}

function walk(list: number[]): string {
  let text = "";
  for (const value of list) text += visit(list, value) + ",";
  text += " ";
  for (const value of list) text += value + ",";
  return text;
}

for (let round = 0; round < 500; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = walk([1, 2, 3, 4]);
  if (mode || round === 0) console.log(round + ": " + line);
}
