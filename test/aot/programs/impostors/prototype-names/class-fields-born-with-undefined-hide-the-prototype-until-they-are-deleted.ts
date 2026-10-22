// `note?: string;` without `declare` defines an own property that holds undefined. It reads like an absent one, but it hides whatever the prototype has, `in` says true, and a store calls no setter.
// Only `delete` empties the slot, and then the prototype shows through. The two states must be kept apart, for instances made before and after the names arrive on the prototype.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const log: string[] = [];
class Item {
  id: number;
  note?: string;
  count?: number;
  child?: Item;
  constructor(id: number) {
    this.id = id;
    handOver(this);
  }
}
class Special extends Item {
  extra?: number;
}
function noteOf(item: Item) {
  return item.note;
}
function setNote(item: Item, value: string | undefined) {
  item.note = value;
}
function countOf(item: Item) {
  return item.count ?? -1;
}
function addOne(item: Item) {
  item.count = (item.count ?? 0) + 1;
}
function dropNote(item: Item) {
  return delete item.note;
}
function state(item: Item) {
  return `${noteOf(item)} ${item.count} ${"note" in item} ${Object.hasOwn(item, "note")} ${Object.hasOwn(item, "count")} [${Object.keys(item)}] ${JSON.stringify(item)}`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const item = i & 1 ? new Item(i) : new Special(i);
  sum += (noteOf(item)?.length ?? 1) + countOf(item);
  if (i & 2) setNote(item, "ab");
  if (i & 4) addOne(item);
  if (i % 7 === 0) dropNote(item);
  sum += (noteOf(item)?.length ?? 1) + countOf(item) + Object.keys(item).length;
}
console.log("warm", sum);

const born = new Item(1);
const emptied = new Item(2);
dropNote(emptied);
delete emptied.count;
const special = new Special(3);
const specialEmptied = new Special(4);
dropNote(specialEmptied);
const all = () => [born, emptied, special, specialEmptied].map(state).join("\n  ");
console.log("before:\n  " + all());
const holder: any = Object.getPrototypeOf(born);
Object.defineProperty(holder, ["no", "te"].join(""), {
  get(this: Item) {
    return "inherited by " + this.id;
  },
  set(this: Item, value: string) {
    log.push(`note = ${value} on ${this.id}`);
  },
  configurable: true,
});
holder[["co", "unt"].join("")] = 100;
console.log("the names are on the prototype:\n  " + all() + "\n  " + state(new Item(5)) + "\n  " + state(new Special(6)));
for (const item of [born, emptied, special, specialEmptied]) {
  setNote(item, "stored");
  addOne(item);
}
console.log("stored:\n  " + all() + "\n  " + log.join(", "));
log.length = 0;
for (const item of [born, emptied, special, specialEmptied]) setNote(item, undefined);
console.log("undefined stored:\n  " + all() + "\n  " + log.join(", "));
log.length = 0;
for (const item of [born, emptied, special, specialEmptied]) {
  dropNote(item);
  delete item.count;
}
console.log("all deleted:\n  " + all());
delete holder.note;
delete holder.count;
console.log("gone again:\n  " + all() + "\n  " + state(new Item(7)));
