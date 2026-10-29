// The callee is read from the global object under a key put together at run time, ahead of the loop. Under some keys there is a closure, a built-in function or a number, under others nothing, and the loop calls it behind a test.
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
const shared = globalThis as unknown as Record<string, unknown>;
shared["step" + process.argv.length] = picker([1, 2, 3, 4]);
shared["step" + (process.argv.length + 1)] = adder(7);
shared["step" + (process.argv.length + 2)] = Math.abs;
shared["step" + (process.argv.length + 3)] = 5;
function work(key: string, n: number): number {
  const step = shared[key];
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, typeof step === "function" ? step(j) : -1);
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work("step" + (2 + (i % 6)), 24));
console.log(total);
