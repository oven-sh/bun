// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// Object.create(x) throws for an x that is no object before the call behind it runs, also where the object never leaves the function.
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
  const made = Object.create(proto);
  made.items = g();
  return made.items;
}
console.log(make(members));
try {
  console.log(make(1));
} catch (e) {
  console.log(e.constructor.name, e.message);
}
