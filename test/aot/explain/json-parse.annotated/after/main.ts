interface Item {
  sku: string;
  price: number;
}

function total(items: Item[]): number {
  let sum = 0;
  for (const item of items) sum += item.price;
  return sum;
}

const saved: Item[] = JSON.parse<Item[]>('[{"sku":"A-1","price":2.5}]');
console.log(total(saved));
