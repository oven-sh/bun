class Item { constructor(size) { this.size = size; } double() { return this.size * 2; } }
function once(value) {
  return { [Symbol.iterator]() { let done = false; return { next() { if (done) return { done: true, value: undefined }; done = true; return { done: false, value }; } }; } };
}
const key = {};
console.log(new WeakMap(once([key, new Item(2)])).get(key).double());
for (const each of new Set(once(new Item(3)))) console.log(each.double());
const map = new Map(once([new Item(4), "value"]));
for (const each of map.keys()) console.log(each.double());
