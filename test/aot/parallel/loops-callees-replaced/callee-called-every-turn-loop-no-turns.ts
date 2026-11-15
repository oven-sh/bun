// Every turn of a loop calls two constants of the module. Ahead of the declarations the loop is entered with no turns.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Step = (x: number) => number;
function picker(list: number[]): Step {
  return x => list[x & 3]! + list.length;
}
function adder(n: number): Step {
  return x => x + n;
}
function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, look(j) + more(j));
  return sum;
}
console.log(work(process.argv.length - 2));
const look = picker([process.argv.length, 5, 6, 7]);
const more = adder(process.argv.length);
console.log(work(40));
