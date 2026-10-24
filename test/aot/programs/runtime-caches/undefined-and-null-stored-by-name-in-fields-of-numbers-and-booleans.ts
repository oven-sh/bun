// A field that its class declares as a number or a boolean gets undefined or null from code that knows nothing of the class, by name and by key, behind the constructor.
// Typed code that reads the field afterwards sees what plain Bun sees, whether every constructor fills the field or it is created later, and so does whoever lists the keys.
class Filled {
  count: number;
  ratio: number;
  ready: boolean;
  constructor(seed: number) {
    this.count = seed | 0;
    this.ratio = seed + 0.5;
    this.ready = (seed & 1) === 1;
  }
}
class Late {
  id: number;
  declare count: number;
  declare ratio: number;
  declare ready: boolean;
  constructor(seed: number) {
    this.id = seed | 0;
  }
}
const data: any = JSON.parse('{"values":[null,1,2.5,true,false,-7,1e10],"names":["count","ratio","ready"]}');
const values: any[] = [undefined, ...data.values];

function storeCount(o: any, v: any) { o.count = v; }
function storeRatio(o: any, v: any) { o.ratio = v; }
function storeReady(o: any, v: any) { o.ready = v; }
function storeByKey(o: any, key: any, v: any) { o[key] = v; }
function define(o: any, v: any) { Object.defineProperty(o, "count", { value: v, writable: true, enumerable: true, configurable: true }); }

function sumOfFilled(o: Filled): string { return `${o.count + 1} ${o.ratio * 2} ${o.ready ? "yes" : "no"} ${o.count === undefined} ${o.ratio === null} ${typeof o.ready}`; }
function sumOfLate(o: Late): string { return `${o.id} ${o.count + 1} ${o.ratio * 2} ${o.ready ? "yes" : "no"} ${o.count === undefined} ${o.ratio === null} ${typeof o.ready}`; }
function describe(o: object): string { return `${Object.keys(o).join()} ${JSON.stringify(o)} ${"count" in o} ${Object.hasOwn(o, "ready")}`; }

const lines: string[] = [];
for (let turn = 0; turn < 40; turn++) {
  for (const first of values) {
    for (const second of [values[turn % values.length], undefined, null, 3]) {
      const filled = new Filled(turn);
      const late = new Late(turn);
      const before = sumOfFilled(filled) + " | " + sumOfLate(late);
      storeCount(filled, first); storeRatio(filled, second); storeReady(filled, first);
      storeCount(late, first); storeRatio(late, second); storeReady(late, first);
      const between = sumOfFilled(filled) + " | " + sumOfLate(late) + " | " + describe(filled) + " | " + describe(late);
      storeCount(filled, second); storeByKey(filled, data.names[turn % 3], first); storeCount(late, second); storeByKey(late, data.names[turn % 3], first);
      if (turn % 5 === 0) { define(filled, first); define(late, second); }
      if (turn % 7 === 0) { delete (late as any).count; storeCount(late, first); delete (filled as any).ratio; storeRatio(filled, second); }
      const after = sumOfFilled(filled) + " | " + sumOfLate(late) + " | " + describe(filled) + " | " + describe(late);
      if (turn < 8 || turn % 5 === 0 || turn % 7 === 0) lines.push(before, between, after);
    }
  }
}
console.log(lines.join("\n"));

// Objects that have had a marker and hold numbers again, beside objects that never had one.
const many: Filled[] = [];
for (let i = 0; i < 3000; i++) {
  const o = new Filled(i);
  if (i % 3 === 0) storeCount(o, i % 2 ? undefined : null);
  if (i % 6 === 0) storeCount(o, i);
  if (i % 5 === 0) storeReady(o, undefined);
  many.push(o);
}
let total = 0, holes = 0, ready = 0;
for (const o of many) {
  const sum = o.count + o.ratio;
  if (sum === sum) total += sum; else holes++;
  if (o.ready) ready++;
}
console.log(total, holes, ready);
