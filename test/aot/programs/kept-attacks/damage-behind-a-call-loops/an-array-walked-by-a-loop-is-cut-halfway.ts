// A loop walks an array by index and makes a call in every iteration. In one iteration the callee cuts the array, in another round it lets it grow, so neither the length nor the bounds that the loop has tested hold any longer.
let strikeAt = -1;
let grows = false;
function visit(list: number[], index: number): number {
  if (index === strikeAt) {
    if (grows) list.push(100, 200);
    else list.length = index + 2;
  }
  return 1;
}

function walk(list: number[]): string {
  let sum = 0;
  let steps = 0;
  for (let index = 0; index < list.length; index++) {
    sum += list[index];
    steps += visit(list, index);
    sum += list[list.length - 1];
  }
  return sum + " " + steps + " " + list.length;
}

for (let round = 0; round < 400; round++) {
  strikeAt = round % 100 === 99 ? 3 : -1;
  grows = round > 200;
  const line = walk([round, 1, 2, 3, 4, 5, 6, 7]);
  if (strikeAt >= 0 || round === 0) console.log(round + ": " + line);
}
