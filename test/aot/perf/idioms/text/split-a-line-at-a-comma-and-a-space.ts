import { nextTurns } from "../host.ts";
let kept: unknown;
const lines: string[] = [0, 1].map(n => Buffer.from("text/html, application/xhtml+xml, application/xml;q=0.9, image/webp, */*;q=0." + n, "latin1").toString("latin1"));
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const pieces = lines[i & 1]!.split(", ");
    kept = pieces;
    s = (s + pieces.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
