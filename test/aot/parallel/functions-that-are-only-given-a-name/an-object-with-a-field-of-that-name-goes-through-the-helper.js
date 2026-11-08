function giveName(named, text) {
  Object.defineProperty(named, "name", { value: text, enumerable: false, configurable: true });
}
function first() {}
const record = { name: 1, other: 2 };
giveName(first, "one");
giveName(record, "two");
console.log(first.name, record.name, Object.keys(record).join());
