// Symbols as keys, hidden from JSON and from for in, found by Reflect
const id = Symbol("id");
class Entry {
  constructor(n) {
    this[id] = n;
    this.name = "e" + n;
  }
  get [Symbol.toStringTag]() {
    return "Entry" + this[id];
  }
  [Symbol.for("twice")]() {
    return this[id] * 2;
  }
}
function show(n) {
  const entry = new Entry(n);
  const copy = { ...entry };
  entry[id]++;
  return [String(entry), JSON.stringify(entry), copy[id], entry[Symbol.for("twice")](), Object.keys(entry).length, Reflect.ownKeys(entry).length, id.description].join();
}
console.log(show(1));
console.log(show(50));
console.log(show(0));
