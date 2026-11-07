function make() {
  class Item { static seen = 0; touch() { return ++Item.seen; } }
  return Item;
}
const byName = make();
const [byList] = [0].map(make);
new byName().touch(); new byName().touch();
console.log(byName === byList, new byName().touch(), new byList().touch());
