// A loop reads a constant of the module only in a block behind a flag. The loop runs once ahead of the declaration, with the flag down.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum += j;
    if (isOpen) sum = mix(sum, table.part[j % 3]! + table.part.length + table.name.length);
  }
  return sum;
}
let isOpen = false;
console.log(work(40));
const table = { part: [process.argv.length, 5, 6], name: "name" + process.argv.length };
isOpen = true;
console.log(work(40));
