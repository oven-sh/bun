import { nextTurns } from "../host.ts";
let kept: unknown;
const given: { chunks: Buffer[] } = JSON.parse('{"chunks":[]}');
for (let i = 0; i < 4; i++) given.chunks.push(Buffer.alloc(64, i + 1));
function work(bytes: Buffer): number {
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 127;
  return bytes.length;
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
