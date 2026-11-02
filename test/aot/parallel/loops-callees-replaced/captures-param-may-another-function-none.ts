// The callee is a parameter, so it stands ahead of the loop. It is a closure over a list, a closure over a number, a function that captures nothing, or undefined, and the loop calls it behind a test.
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
function doubled(x: number): number {
  return x * 2;
}
function work(step: Step | undefined, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, step === undefined ? j : step(j));
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i % 5 === 0 ? undefined : i % 5 === 1 ? adder(i) : i % 5 === 2 ? doubled : picker([i, 1, 2, 3]), 24));
console.log(total);
