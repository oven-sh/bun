// A loop calls a constant of the module only in a block behind a flag. The loop runs once ahead of the declaration, with the flag down.
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
  for (let j = 0; j < n; j++) {
    sum += j;
    if (isOpen) sum = mix(sum, look(j) + more(j));
  }
  return sum;
}
let isOpen = false;
console.log(work(40));
const look = picker([process.argv.length, 5, 6, 7]);
const more = adder(process.argv.length);
isOpen = true;
console.log(work(40));
