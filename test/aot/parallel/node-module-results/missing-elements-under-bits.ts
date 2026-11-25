import { basename } from "node:path";

const words = basename("1 2.5 -7 4294967297 x 1e21").split(" ");
const numbers = words.map(Number);
const holes = words.map(Number);
delete holes[2];
holes.length += 2;

function cut(given: number[], rounds: number): string {
  const list = given.slice();
  let sum = 0;
  let text = "";
  for (let i = 0; i < rounds; i++) {
    sum += (list[i] & 255) + (list.at(-1)! | 0);
    text += `${list.pop()! >>> 1},${list.shift()! ^ 3},`;
    list.push(given[i] << 1, given[given.length - i] & 7);
  }
  return `${sum} ${text} ${list}`;
}

function ends(given: number[], from: number): { low: number; high: number } {
  let low = given[from];
  let high = given[from];
  for (let i = from + 1; i < from + 4; i++) {
    if (given[i] < low) low = given[i];
    if (given[i] > high) high = given[i];
  }
  return { low, high };
}

for (const given of [numbers, holes, []]) {
  console.log(cut(given, 9));
  for (let k = 0; k < 9; k++) {
    const { low, high } = ends(given, k);
    console.log(low, high, high - low, low === undefined);
  }
}
