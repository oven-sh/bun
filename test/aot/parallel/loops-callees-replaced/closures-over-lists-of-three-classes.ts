// The callee has captured an array or one of two typed arrays and reads two of its elements. It is replaced in the middle of a loop that runs often.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Step = (x: number) => number;
function picker(list: number[] | Float64Array | Uint8Array): Step {
  return x => list[x % 3]! + list[(x + 1) % 3]!;
}
function work(first: Step, second: Step, at: number, n: number): number {
  let step = first;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (j === at) step = second;
    sum = mix(sum, step(j));
  }
  return sum;
}
const made = (i: number): Step => picker(i % 3 === 0 ? [i, i + 1, i + 2] : i % 3 === 1 ? new Float64Array([i, i + 0.5, i + 2]) : new Uint8Array([i, i + 1, i + 2]));
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(made(i), made(i + 1 + (i % 2)), i % 250, 200));
console.log(total);
