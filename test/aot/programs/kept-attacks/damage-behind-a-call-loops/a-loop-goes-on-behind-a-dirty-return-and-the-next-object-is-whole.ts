// A loop takes one object after the other out of an array, reads it, makes a call and reads it again. The callee damages some of them. The objects that follow a damaged one are whole and must read as such.
class Item {
  price: number;
  count: number;
  constructor(price: number, count: number) {
    this.price = price;
    this.count = count;
  }
}

function check(item: Item, index: number): number {
  if (index % 7 === 3) delete (item as any).count;
  else if (index % 7 === 5) (item as any).price = "free";
  return index;
}

function total(items: Item[]): string {
  let text = "";
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const before = item.price * item.count;
    check(item, index);
    text += before + ">" + item.price * item.count + " ";
  }
  return text;
}

let line = "";
for (let round = 0; round < 100; round++) {
  const items: Item[] = [];
  for (let index = 0; index < 16; index++) items.push(new Item(index + 1, 2));
  line = total(items);
}
console.log(line);
