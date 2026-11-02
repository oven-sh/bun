import { nextTurns } from "../host.ts";
let kept: unknown;
const source = Buffer.alloc(4096, 97);
const target = Buffer.alloc(4096);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + source.copy(target, 0, i & 1023, (i & 1023) + 40)) | 0;
  kept = target;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
