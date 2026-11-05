import { nextTurns } from "../host.ts";
const samples = new Float64Array(16);
for (let k = 0; k < 16; k++) samples[k] = k + 0.5;
function sum(start: number): number {
  let t = start;
  for (let k = 0; k < samples.length; k++) t += samples[k]!;
  return t;
}
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += sum(i & 1);
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
