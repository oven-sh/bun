// What is declared of a parameter is a layout, and strings and lists of every kind are handed in: each of them reads its length without a call of the run time.
// COUNT: operation:operationAOTGetByIdAndCache = 0
interface Counted {
  length: number;
}
const queue: Counted[] = ["four", [1, 2, 3], new Float64Array(2), new Int8Array(5), new Uint16Array(7), new Int32Array(1), "ab", [4]];
const total = { sum: 0 };
function add(list: Counted): void {
  if (list.length === 0) return;
  total.sum = (total.sum + list.length) & 0xffff;
}
function bench(n: number): number {
  for (let i = 0; i < n; i++) add(queue[i & 7]);
  return total.sum;
}
const plan: number[] = new Array(100).fill(5000);
plan.push(16);
let check = 0;
while (plan.length) check += bench(plan.shift() ?? 0) & 1023;
console.log(check);
