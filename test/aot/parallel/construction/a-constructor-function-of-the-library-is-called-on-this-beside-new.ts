import { Readable, Writable } from "node:stream";
import { inherits } from "node:util";
function Mine(this: any, options?: object) { if (!(this instanceof Mine)) return new (Mine as any)(options); Readable.call(this, options); (this as any).mine = true; }
inherits(Mine, Readable);
(Mine as any).prototype._read = function () {};
function Deeper(this: any) { (Mine as any).call(this); this.deeper = true; }
inherits(Deeper, Mine);
const table: Record<string, any> = {};
const names = process.argv.length > 99 ? ["a", "b", "c"] : ["mine", "deeper", "writable"];
table[names[0]] = Mine; table[names[1]] = Deeper; table[names[2]] = Writable;
const first = Number(process.argv[2] ?? 3);
const log: string[] = [];
for (let turn = first; turn < first + 4; turn++) {
  const mine = new table.mine(), called = table.mine(), deeper = new table.deeper(), writable = new table.writable(), bare = table.writable();
  log.push([mine.mine, mine instanceof Readable, called.mine, called instanceof Mine, deeper.deeper, deeper.mine, deeper instanceof Mine, deeper instanceof Readable, typeof deeper._readableState, writable instanceof Writable, bare instanceof Writable, Object.keys(mine).length === Object.keys(called).length].join(" "));
}
console.log(log.join("\n"));
