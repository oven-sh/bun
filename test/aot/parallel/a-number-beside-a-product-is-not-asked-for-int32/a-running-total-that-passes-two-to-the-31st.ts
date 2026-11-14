// the row's own shape: the total grows past 2^31 and past 2^53 while the factors stay int32
type Item = { price: number; count: number };
const items: Item[] = [];
for (let i = 0; i < 64; i++) items.push({ price: i * 1000003, count: (i & 3) + 1000 });
(globalThis as any).items = items;
export let total = 0;
const marks: string[] = [];
for (let round = 0; round < 20000; round++) {
  for (let i = 0; i < items.length; i++) total += items[i].price * items[i].count;
  if ((round & 4095) === 0) marks.push(String(total));
}
console.log(total, marks.join(" "));
