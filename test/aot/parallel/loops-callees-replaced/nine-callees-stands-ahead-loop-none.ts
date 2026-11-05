// The callee is one of nine functions, or undefined, and does not change in the loop. The loop calls it behind a test.
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
const all: (Step | undefined)[] = [
  picker([1, 2, 3, 4]),
  adder(5),
  x => x * 2,
  x => x - 1,
  x => x ^ 5,
  Math.abs,
  Math.floor,
  x => (x << 2) + 1,
  adder.bind(null, 3)(),
  undefined,
];
function work(step: Step | undefined, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, step ? step(j) : -1);
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(all[i % all.length], 24));
console.log(total);
