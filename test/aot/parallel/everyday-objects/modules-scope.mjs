// Objects and classes at the top of a module, read and written by functions
let count = 0;
const settings = { step: 1, names: [] };
class Item {
  static last = null;
  constructor(name) {
    this.name = name;
    this.id = count += settings.step;
    Item.last = this;
    settings.names.push(name);
  }
}
export function make(name, step) {
  settings.step = step;
  const items = [new Item(name), new Item(name + name)];
  return items.map(item => item.id).join() + " " + Item.last.name + " " + settings.names.length + " " + count;
}
console.log(make("a", 1));
console.log(make("b", 10));
console.log(make("c", -5));
