import { nextTurns } from "../host.ts";
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
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
