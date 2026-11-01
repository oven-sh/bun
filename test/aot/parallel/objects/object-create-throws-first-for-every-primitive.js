// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// Object.create(x) throws before the first stored value is computed for every kind of x that is neither an object nor null.
const members = {
  get size() {
    return this.items;
  },
};
let ran = 0;
function g() {
  return ++ran;
}
function make(proto) {
  const made = Object.create(proto);
  made.items = g();
  return made;
}
console.log(make(members).size);
for (const other of [1, "text", undefined, true, 5n, Symbol("s")]) {
  try {
    make(other);
    console.log("no throw");
  } catch (e) {
    console.log(typeof other, e.constructor.name, e.message, ran);
  }
}
console.log(make(null).items, Object.getPrototypeOf(make(null)), ran);
