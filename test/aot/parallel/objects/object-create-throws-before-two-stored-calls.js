// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// Object.create(x) throws for an x that is no object before either of the two calls whose results are stored first.
const members = {
  get size() {
    return this.items + this.more;
  },
};
function g(n) {
  console.log("g ran", n);
  return n;
}
function make(proto) {
  const made = Object.create(proto);
  made.items = g(1);
  made.more = g(2);
  return made;
}
console.log(make(members).size);
try {
  make(1);
  console.log("no throw");
} catch (e) {
  console.log(e.constructor.name, e.message);
}
