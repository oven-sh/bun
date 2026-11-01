import { nextTurns } from "../host.ts";
const encoder = new TextEncoder();
const queue: Uint8Array[] = [];
for (const text of ["<li>", "</li>", '<a href="', "a longer piece of text"]) queue.push(encoder.encode(text));
queue.push(Buffer.from("</a>"), new Uint8Array(0), Buffer.from("four"), new Uint8Array(2));
const writer = { view: new Uint8Array(2048), written: 0, flushed: 0 };
function write(chunk: Uint8Array): void {
  if (chunk.byteLength > writer.view.length - writer.written) {
    writer.flushed += writer.written;
    writer.written = 0;
  }
  writer.view.set(chunk, writer.written);
  writer.written += chunk.byteLength;
}
function bench(n: number): number {
  for (let i = 0; i < n; i++) write(queue[i & 7]);
  return writer.flushed & 1023;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
