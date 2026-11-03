import { nextTurns } from "../host.ts";
let kept: unknown;
const plain = Buffer.from('{"customer":{"id":4711,"name":"Ada"},"items":[{"sku":"SKU-1000","quantity":1}]}');
const accented = Buffer.from('{"customer":{"id":4711,"name":"Zoë Müller"},"items":[{"sku":"SKU-1000","quantity":1}]}');
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const text = (i & 3) === 3 ? accented.toString("utf8") : plain.toString("utf8");
    kept = text;
    s = (s + text.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
