import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
class Below extends Readable { tag = "below"; _read() {} }
function Other(this: any) {}
Other.prototype = { tag: "other" };
const table: Record<string, any> = {};
table[process.argv.length > 99 ? "x" : "made"] = Readable;
const first = Number(process.argv[2] ?? 3);
const log: string[] = [];
for (let turn = first; turn < first + 4; turn++) {
  const below = new Below();
  const odd = Reflect.construct(table.made, [{ read() {} }], Other);
  const plain = new table.made({ read() {} });
  log.push([below.tag, below instanceof Readable, below instanceof EventEmitter, Object.getPrototypeOf(below) === Below.prototype, odd.tag, odd instanceof Readable, Object.getPrototypeOf(odd) === Other.prototype, typeof odd._readableState, plain instanceof Readable, plain.readable].join(" "));
}
console.log(log.join("\n"));
