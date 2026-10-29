import { nextTurns } from "../host.ts";
let kept: unknown;
const texts: string[] = [0, 1].map(n => ("say " + String.fromCharCode(34) + "hi" + String.fromCharCode(34) + " \u2728 to number " + n));
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const text = JSON.stringify(texts[i & 1]);
    kept = text;
    s = (s + text.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
