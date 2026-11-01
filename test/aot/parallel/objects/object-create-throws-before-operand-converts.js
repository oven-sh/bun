// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// Object.create(x) throws for an x that is no object before the operand of the first stored product is converted to a number.
const members = {
  get size() {
    return this.items;
  },
};
const operand = {
  valueOf() {
    console.log("valueOf ran");
    return 3;
  },
};
function make(proto, value) {
  const made = Object.create(proto);
  made.items = value * 2;
  return made;
}
console.log(make(members, operand).size);
try {
  make(1, operand);
  console.log("no throw");
} catch (e) {
  console.log(e.constructor.name, e.message);
}
