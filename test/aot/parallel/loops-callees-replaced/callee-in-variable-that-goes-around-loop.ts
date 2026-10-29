// Every turn calls what a variable of the module holds, and a turn in eight stores another function, with other captures or with none.
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
let held: Step = picker([1, 2, 3, 4]);
function work(from: number, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum = mix(sum, held(j));
    if ((j & 7) === 7) held = (from + j) % 3 === 0 ? adder(from) : (from + j) % 3 === 1 ? picker([from, j, 7, 8]) : Math.abs;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 300; i++) total = mix(total, work(i, 40));
console.log(total);
