class Item {
  price: number;
  stock: number;
  constructor(price: number) {
    this.price = price;
    this.stock = 1;
  }
}
class Service {
  hours: number;
  constructor(hours: number) {
    this.hours = hours;
  }
}
class Gift {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}
type Line = Item | Service | Gift | number;
function priceOf(line: Line): number {
  let price = 0;
  for (let turn = 0; turn < 2; turn++) {
    price += (line as Item).price | 0;
    if (typeof line !== "number") price += ((line as Item).price | 0) * 100;
  }
  return price;
}
const lines: Line[] = [new Item(1), new Service(2), new Gift(3), new Item(5), 4];
let total = 0;
for (let i = 0; i < lines.length; i++) total += priceOf(lines[i]!);
console.log(total);
