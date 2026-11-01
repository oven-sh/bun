// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// Object.create(x) throws its TypeError for an x that is no object, and not the RangeError of the call that computes the first stored value.
const members = {
  get size() {
    return this.items;
  },
};
let calls = 0;
function g() {
  if (++calls > 1) throw new RangeError("from g");
  return 7;
}
function make(proto) {
  const made = Object.create(proto);
  made.items = g();
  return made;
}
console.log(make(members).size);
try {
  make(1);
  console.log("no throw");
} catch (e) {
  console.log(e.constructor.name, e.message, calls);
}
