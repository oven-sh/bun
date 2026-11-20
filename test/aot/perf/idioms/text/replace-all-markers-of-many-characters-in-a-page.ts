import { nextTurns } from "../host.ts";
let kept: unknown;
const pages: string[] = [0, 1].map(n => Buffer.from(("<tr class=\"row\"><td>" + n + "</td><td><a href=\"/x\">name</a></td></tr>\n").repeat(300) + "<page-body-goes-here></page-body-goes-here>" + "<script src=\"/a.js\"></script>\n".repeat(20), "latin1").toString("latin1"));
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const text = pages[i & 1]!.replaceAll("<page-body-goes-here></page-body-goes-here>", "<main></main>");
    kept = text;
    s = (s + text.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
