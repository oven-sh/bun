// the field whose truth is asked is deleted, found above the object, and made an accessor, each by code that nobody sees: an empty slot says nothing of the property
class Item {
  next: Item | undefined;
  label: string;
  constructor(label: string, next: Item | undefined) { this.label = label; this.next = next; }
}
function hasNext(item: Item) { const size = item.label.length; if (item.next) return size + 100; return size; }
const hidden = JSON.parse('{"define":"defineProperty","remove":"deleteProperty","above":"setPrototypeOf"}');
const last = new Item("z", undefined);
let total = 0;
for (let i = 0; i < 300; i++) total += hasNext(new Item("t", i % 3 ? last : undefined));
console.log(String(total));
const removed = new Item("removed", last);
(Reflect as any)[hidden.remove](removed, "next");
console.log(String(hasNext(removed)), Object.keys(removed).join());
const below = new Item("below", last);
(Reflect as any)[hidden.remove](below, "next");
(Reflect as any)[hidden.above](below, { next: 1 });
console.log(String(hasNext(below)), Object.keys(below).join());
let reads = 0;
const watched = new Item("watched", undefined);
(Reflect as any)[hidden.define](watched, "next", { get() { reads++; return reads & 1; }, configurable: true, enumerable: true });
console.log(String(hasNext(watched)), String(hasNext(watched)), String(hasNext(watched)), String(reads));
removed.next = last;
console.log(String(hasNext(removed)), Object.keys(removed).join());
