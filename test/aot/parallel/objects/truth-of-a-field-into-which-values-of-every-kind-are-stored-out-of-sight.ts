// a field that is written to hold an object or undefined is stored with every kind of value by code that nobody sees, and asked for its truth
class Item {
  next: Item | undefined;
  label: string;
  constructor(label: string, next: Item | undefined) { this.label = label; this.next = next; }
}
function hasNext(item: Item) { const size = item.label.length; if (item.next) return size + 100; return size; }
function lacksNext(item: Item) { const size = item.label.length; if (!item.next) return size + 100; return size; }
const hidden = JSON.parse('{"set":"set"}');
function deed(item: Item, value: unknown) { (Reflect as any)[hidden.set](item, "next", value); }
const last = new Item("z", undefined);
console.log(String(hasNext(last)), String(lacksNext(last)), String(hasNext(new Item("yy", last))), String(lacksNext(new Item("yy", last))));
let total = 0;
for (let i = 0; i < 300; i++) total += hasNext(new Item("t", i % 3 ? last : undefined)) + lacksNext(new Item("t", i % 2 ? last : undefined));
console.log(String(total));
const stored: unknown[] = [null, 0, -0, NaN, "", "x", 5, 0.5, true, false, 0n, 1n, Symbol.iterator, [], {}, () => 0, last, undefined];
for (let i = 0; i < stored.length; i++) {
  const item = new Item("s", last);
  deed(item, stored[i]);
  console.log(String(i), String(hasNext(item)), String(lacksNext(item)));
}
