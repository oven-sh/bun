class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new TextEncoder();
const first = { first: 1.5, second: "two", third: item };
const second = new DataView(new ArrayBuffer(16));
const held = subject.encodeInto(first, second);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
for (const value of Object.values(held)) console.log(show(value));
