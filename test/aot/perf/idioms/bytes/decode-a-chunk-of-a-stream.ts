import { nextTurns } from "../host.ts";
let kept: unknown;
const decoder = new TextDecoder("utf-8", { fatal: true });
const page = new Uint8Array(4096).fill(97);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const text = decoder.decode(page, { stream: true });
    kept = text;
    s = (s + text.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
