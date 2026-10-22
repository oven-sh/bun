function Item(name) {
  this.name = name;
  this.next = null;
}
function walk(item) {
  let names = "";
  for (let at = item, steps = 0; at !== null && at !== undefined && steps < 5; at = at.next, steps++) names += at.name;
  return names;
}
const a = new Item("a"), b = new Item("b"), c = new Item("c");
a.next = b;
b.next = c;
console.log(walk(a));
let reads = 0;
Object.defineProperty(b, "next", { get() { reads++; return a; }, set(value) { reads += 10; }, enumerable: true, configurable: true });
console.log(walk(a), reads);
b.next = null;
console.log(walk(a), reads, Object.keys(b).join());
Object.defineProperty(c, "next", { value: a, writable: false });
try {
  c.next = null;
} catch (error) {
  console.log(error.constructor.name);
}
console.log(walk(c), Object.getOwnPropertyDescriptor(c, "next").writable);
