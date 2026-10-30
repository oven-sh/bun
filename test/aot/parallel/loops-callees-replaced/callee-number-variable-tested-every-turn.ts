// A variable of the module holds a function or a number. Every turn reads it and asks which, and the loop first runs ahead of the store, behind a flag.
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
    if (!isOpen) {
      sum += j;
      continue;
    }
    const now = either;
    sum = mix(sum, typeof now === "function" ? now(j) : now);
    if ((j & 7) === 7) either = j & 8 ? j : j & 16 ? adder(j) : picker([j, 1, 2, 3]);
  }
  return sum;
}
let isOpen = false;
console.log(work(40));
let either: Step | number = picker([process.argv.length, 2, 3, 4]);
isOpen = true;
console.log(work(40), work(40));
