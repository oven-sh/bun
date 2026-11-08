class Sum { total: number; constructor(total: number) { this.total = total; } }
class Box {
  size: number; flags: number; cached: Sum | undefined;
  constructor(size: number) { this.size = size; this.flags = size & 1; this.cached = undefined; }
}
let measured = 0;
function measure(box: { size: number }): Sum {
  measured++;
  let total = 0;
  for (let index = 0; index < box.size; index++) total += index * box.size;
  return new Sum(total);
}
function cachedOf(box: Box): Sum {
  if (box.cached) return box.cached;
  const made = measure(box);
  box.cached = made;
  box.flags |= 2;
  return made;
}
function markedOf(box: Box): number {
  if (box.flags & 4) return box.size;
  box.flags |= 4;
  const made = measure(box);
  box.size = made.total + 1;
  return -box.size;
}
function user(box: Box): number { return cachedOf(box).total + 1; }
function marker(box: Box): number { return markedOf(box) * 2; }
function tell(label: string, run: () => unknown) {
  try { console.log(label, String(run()), measured); } catch (error) { console.log(label, (error as Error).constructor.name, measured); }
}

const plain = new Box(4);
tell("miss", () => user(plain));
tell("hit", () => user(plain));
tell("flags", () => plain.flags);
tell("mark", () => marker(plain));
tell("marked", () => marker(plain));

let reads = 0;
class Counted extends Box {
  declare cached: Sum | undefined;
}
const counted = new Counted(3);
Object.defineProperty(counted, "cached", { get() { reads++; return reads > 2 ? new Sum(100 + reads) : undefined; }, set() {}, configurable: true });
tell("getter, empty", () => user(counted));
tell("reads", () => reads);
tell("getter, filled", () => user(counted));
tell("reads", () => reads);

let traps = 0;
const watched = new Proxy(new Box(2), { get(target, key, receiver) { traps++; return Reflect.get(target, key, receiver); } });
tell("proxy", () => user(watched));
tell("traps", () => traps);
tell("proxy again", () => user(watched));
tell("traps", () => traps);

const other = { size: 5, flags: 0, cached: undefined as Sum | undefined, more: 1 };
tell("another shape", () => user(other as unknown as Box));
tell("another shape, hit", () => user(other as unknown as Box));
tell("undefined", () => user(undefined as unknown as Box));
tell("null", () => user(null as unknown as Box));
tell("a number", () => user(7 as unknown as Box));

const emptied = new Box(6);
tell("filled", () => user(emptied));
delete (emptied as { cached?: Sum }).cached;
tell("deleted", () => user(emptied));
const frozen = Object.freeze(new Box(3));
tell("frozen", () => user(frozen));
const falsy = new Box(2);
(falsy as unknown as { cached: unknown }).cached = 0;
tell("zero in the field", () => user(falsy));
(falsy as unknown as { cached: unknown }).cached = "";
tell("an empty text in the field", () => user(falsy));
(falsy as unknown as { cached: unknown }).cached = { total: 41 };
tell("a stranger in the field", () => user(falsy));
const inherited = Object.create(new Box(4)) as Box;
tell("inherited", () => user(inherited));
tell("inherited, own now", () => Object.keys(inherited).join());

function looseOf(box: any): any {
  if (box.cached) return box.cached;
  const made = measure(box);
  box.cached = made;
  box.flags |= 2;
  return made;
}
function looseUser(box: any): number { return looseOf(box).total + 1; }
let looseReads = 0;
const loose = { size: 3, flags: 0, get cached() { looseReads++; return looseReads > 2 ? new Sum(200 + looseReads) : undefined; }, set cached(_value: unknown) {} };
tell("nothing is known of the object: getter, empty", () => looseUser(loose));
tell("reads", () => looseReads);
tell("getter, empty again", () => looseUser(loose));
tell("reads", () => looseReads);
tell("getter, filled", () => looseUser(loose));
tell("reads", () => looseReads);
let looseTraps = 0;
const looseWatched = new Proxy({ size: 2, flags: 0, cached: undefined }, { get(target, key, receiver) { looseTraps++; return Reflect.get(target, key, receiver); } });
tell("proxy", () => looseUser(looseWatched));
tell("traps", () => looseTraps);
