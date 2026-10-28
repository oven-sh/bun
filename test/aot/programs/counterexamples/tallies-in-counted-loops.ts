// Values that go up or down by a constant in some turns of a loop that an integer counter bounds.
function commas(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === ",") count++;
  return count;
}

function balance(list: number[]): number {
  let level = 5;
  for (let i = 0; i < list.length; i++) {
    if (list[i] > 0) level += 2;
    else if (list[i] < 0) level -= 3;
  }
  return level;
}

function leavesInTheTurnThatAdds(list: number[], limit: number): number {
  let seen = 0;
  for (let i = 0; i < list.length; i++) {
    seen++;
    if (list[i] === limit) break;
  }
  return seen;
}

function startsAtAFraction(list: number[], start: number): number {
  let sum = start;
  for (let i = 0; i < list.length; i++) if (list[i] !== 0) sum++;
  return sum;
}

function writesAtTheTally(list: number[]): number[] {
  const kept: number[] = [];
  let next = 0;
  for (let i = 0; i < list.length; i++) if (list[i] % 2 === 0) kept[next++] = list[i];
  return kept;
}

function countsDown(list: number[]): number {
  let left = 0;
  for (let i = list.length - 1; i >= 0; i -= 2) left--;
  return left;
}

function inTwoLoops(rows: number[][]): number {
  let cells = 0;
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x]) cells++;
  return cells;
}

const list = [3, -1, 0, 4, 8, -2, 7, 0, 6];
for (let round = 0; round < 3; round++) {
  console.log(commas("a,b,,c" + ",".repeat(round)), commas(""), balance(list), balance([]));
  console.log(leavesInTheTurnThatAdds(list, 8), leavesInTheTurnThatAdds(list, 99), leavesInTheTurnThatAdds([], 1));
  console.log(startsAtAFraction(list, 0.5), startsAtAFraction(list, -0), Object.is(startsAtAFraction([], -0), -0), startsAtAFraction(list, 2 ** 53));
  console.log(writesAtTheTally(list).join(), countsDown(list), Object.is(countsDown([]), 0), inTwoLoops([list, [], [1, 0, 1]]));
}
