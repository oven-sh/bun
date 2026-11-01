// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// Object.create(x) throws for an x that is no object inside a try of the same function before the call behind it runs: the catch sees the TypeError alone.
const members = {
  get size() {
    return this.items;
  },
};
function g() {
  console.log("g ran");
  return 7;
}
function make(proto) {
  try {
    const made = Object.create(proto);
    made.items = g();
    return made;
  } catch (e) {
    console.log("caught inside", e.constructor.name, e.message);
    return null;
  }
}
console.log(make(members).size);
console.log(make(1));
