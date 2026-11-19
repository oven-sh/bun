// A list, a view and a text come out of fields that may hold null, and each is read in a loop of its own.
// STATISTIC: InnerPointersAcrossSafepoints <= 12
class Item {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}
class Holder {
  items: Item[] | null = null;
  bytes: Uint8Array | null = null;
  text: string | null = null;
}
function sumOfItems(holder: Holder, count: number): number {
  const items = holder.items!;
  let total = 0;
  for (let index = 0; index < count; index++) total += items[index].value;
  return total;
}
function sumOfBytes(holder: Holder, count: number): number {
  const bytes = holder.bytes!;
  let total = 0;
  for (let index = 0; index < count; index++) total += bytes[index];
  return total;
}
function sumOfText(holder: Holder, count: number): number {
  const text = holder.text!;
  let total = 0;
  for (let index = 0; index < count; index++) total += text.charCodeAt(index);
  return total;
}
function make(count: number): Holder {
  const holder = new Holder();
  const items: Item[] = [];
  for (let index = 0; index < count; index++) items.push(new Item(index));
  holder.items = items;
  holder.bytes = new Uint8Array(count).fill(3);
  holder.text = "ab".repeat(count >> 1) + String(count);
  return holder;
}
let all = 0;
for (let round = 0; round < 200; round++) {
  const holder = make(400 + round);
  all += sumOfItems(holder, 400) + sumOfBytes(holder, 400) + sumOfText(holder, 400);
}
console.log(all);
try {
  sumOfItems(new Holder(), 1);
} catch (error) {
  console.log(error instanceof TypeError);
}
