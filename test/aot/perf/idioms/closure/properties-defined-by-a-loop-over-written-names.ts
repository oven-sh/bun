import { nextTurns } from "../host.ts";
// Object.defineProperty under a name out of a written list: an accessor a name, each a closure over the name.
class Record {
  values: any = { id: 1, size: 2, kind: 3, rank: 4 };
  [name: string]: any;
}
for (const name of ["id", "size", "kind", "rank"]) {
  Object.defineProperty(Record.prototype, name, {
    get(this: Record) {
      return this.values[name];
    },
    set(this: Record, value: number) {
      this.values[name] = value;
    },
    enumerable: true,
    configurable: true,
  });
}
const record = new Record();
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    record.size = i & 7;
    s += record.id + record.size + record.rank;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
