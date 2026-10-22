class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = [["first", 1.5], ["second", item]];
const held = process.hrtime(first);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value;
}
for (let index = 0; index < held.length; index++) console.log(show(held[index]));
