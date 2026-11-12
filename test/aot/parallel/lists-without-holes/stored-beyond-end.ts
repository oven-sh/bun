// An object stored three places beyond the end: the loop finds nothing in between.
interface Item {
  value: number;
}
const items: Item[] = [];
for (let i = 0; i < 6; i++) items.push({ value: i });
items[9] = { value: 40 };
let sum = 0;
for (let turn = 0; turn < 3; turn++) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    sum += item === undefined ? 1000 : item.value;
  }
}
console.log(sum, items.length);
