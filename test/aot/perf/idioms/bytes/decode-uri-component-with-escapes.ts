import { nextTurns } from "../host.ts";
let kept: unknown;
const texts: string[] = JSON.parse('["a%20b","caf%C3%A9","x%2Fy","1%2B1"]');
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const text = decodeURIComponent(texts[i & 3]!);
    kept = text;
    s = (s + text.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
