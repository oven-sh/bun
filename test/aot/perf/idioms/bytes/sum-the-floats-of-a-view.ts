import { nextTurns } from "../host.ts";
let kept: unknown;
const given: { chunks: (Float64Array)[] } = JSON.parse('{"chunks":[]}');
for (let i = 0; i < 4; i++) given.chunks.push(new Float64Array(64).fill(i + 1));
function work(bytes: Float64Array): number {
  let s = 0;
  for (let i = 0; i < bytes.length; i++) s = (s + bytes[i]!) | 0;
  return s;
}
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + work(given.chunks[i & 3]!)) | 0;
  kept = given;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
