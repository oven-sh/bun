// reads and writes fields of an object, outside loops
const operations = 4;
class Item {
  id: number;
  count: number;
  constructor(id: number) {
    this.id = id;
    this.count = 0;
  }
}
let item: Item = new Item(process.argv.length);
let total = 0;

kernel: {
  item.count = item.id + total;
  total += item.count;
  item.id = item.count - total;
  total += item.id;
}

console.log(total);
