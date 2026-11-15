import { nextTurns } from "../host.ts";
let kept: unknown;
const parts: (string | Uint8Array)[] = ["<div>", new Uint8Array(12), "row", new Uint8Array(5)];
function sizeOf(part: string | Uint8Array): number {
  return typeof part === "string" ? part.length * 3 : part.byteLength;
}
const sizers = [sizeOf];
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + sizers[0]!(parts[i & 3]!)) | 0;
  kept = parts;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
