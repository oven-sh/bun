interface Item {
  name: string;
  count: number;
  price: number;
}
function worth(items: Item[]): number {
  let sum = 0;
  for (const item of items) sum += item.count * item.price;
  return sum;
}
function run() {
  const first: Item = { name: "nail", count: 100, price: 0.5 };
  const items = [first, { name: "saw", count: 2, price: 12 }];
  console.log(worth(items), first.name, JSON.stringify(items[1]));
}
run();
