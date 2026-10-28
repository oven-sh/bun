import { nextTurns } from "../host.ts";
let kept: unknown;
const encoder = new TextEncoder();
const pages: string[] = JSON.parse(JSON.stringify(["a", "b"].map(letter => ("<li class=\"row\">" + letter + "</li>").repeat(100))));
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const chunk = encoder.encode(pages[i & 1]!);
    kept = chunk;
    s = (s + chunk.byteLength) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
