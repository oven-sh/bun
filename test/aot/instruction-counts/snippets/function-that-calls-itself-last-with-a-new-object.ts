// tallies five numbers by a function that calls itself last with a new object
const operations = 100;
interface Tally {
  count: number;
  sum: number;
}
function tallyFrom(soFar: Tally, list: number[], at: number, end: number): Tally {
  if (at === end) return soFar;
  return tallyFrom({ count: soFar.count + 1, sum: soFar.sum + list[at]! * soFar.count }, list, at + 1, end);
}
const list: number[] = [];
for (let i = 0; i < operations + 5; i++) list.push((i * 29) % 83);
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const tally = tallyFrom({ count: 1, sum: 0 }, list, i, i + 5);
    total += tally.sum / tally.count;
  }
}

console.log(total);
