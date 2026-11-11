import { EventEmitter } from "node:events";
import { Readable, Writable, Duplex, Transform, PassThrough } from "node:stream";
const kinds: any[] = [EventEmitter, Readable, Writable, Duplex, Transform, PassThrough];
const table: Record<string, any> = {};
kinds.forEach((kind, at) => { table[(process.argv.length > 99 ? "x" : "k") + at] = kind; });
const turns = Number(process.argv[2] ?? 3) * 2000;
const kept: any[] = [];
let sum = 0;
for (let turn = 0; turn < turns; turn++) {
  const at = turn % kinds.length;
  const made = new table["k" + at]();
  made.mark = turn;
  if (turn % 97 === 0) kept.push(made);
  if (turn % 1500 === 0) Bun.gc(true);
  sum += made instanceof kinds[at] ? 1 : 1000000;
}
let marks = 0;
for (const made of kept) marks += made.mark + (made instanceof EventEmitter ? 1 : 1000000) + made.listenerCount("x");
console.log(sum, kept.length, marks);
