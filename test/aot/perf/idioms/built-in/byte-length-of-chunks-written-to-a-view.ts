import { nextTurns } from "../host.ts";
const encoder = new TextEncoder();
interface Sized {
  byteLength: number;
}
const queue: Sized[] = [];
for (const text of ["<li>", "</li>", '<a href="', "a longer piece of text"]) queue.push(encoder.encode(text));
queue.push(Buffer.from("</a>"), new Uint8Array(0), new ArrayBuffer(4), { byteLength: 2 });
const writer = { view: new Uint8Array(2048), written: 0, flushed: 0 };
function write(chunk: Sized): void {
  if (chunk.byteLength === 0) return;
  if (chunk.byteLength > writer.view.length - writer.written) {
    writer.flushed += writer.written;
    writer.written = 0;
  }
  writer.written += chunk.byteLength;
}
function bench(n: number): number {
  for (let i = 0; i < n; i++) write(queue[i & 7]);
  return writer.flushed & 1023;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
