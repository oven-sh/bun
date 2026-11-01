// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// Object.create(x) throws for an x that is no object before the counter between it and the first store is incremented.
const members = {
  get size() {
    return this.items;
  },
};
let counter = 0;
function make(proto) {
  const made = Object.create(proto);
  counter++;
  made.items = counter;
  return made;
}
console.log(make(members).size, counter);
try {
  make(1);
  console.log("no throw");
} catch (e) {
  console.log(e.constructor.name, e.message, counter);
}
