// Every turn of a loop reads a constant of the module and looks through two of its members. Ahead of the declaration the loop is entered with no turns.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, table.inner.part[j % 3]! + table.inner.part.length + table.name.length + (table.isWide ? 1 : 2));
  return sum;
}
console.log(work(process.argv.length - 2));
const table = { inner: { part: [process.argv.length, 5, 6] }, name: "name" + process.argv.length, isWide: process.argv.length > 1 };
console.log(work(40));
