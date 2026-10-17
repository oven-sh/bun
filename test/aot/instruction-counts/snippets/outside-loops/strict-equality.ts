// compares two values that hold objects, outside loops
const operations = 4;
class Item {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
}
let one: Item = new Item(1);
let two: Item = new Item(process.argv.length);
let total = 0;

kernel: {
  if (one === two) total += 1;
  if (one === one) total += 2;
  if (two !== one) total += 3;
  if (two !== two) total += 4;
}

console.log(total);
