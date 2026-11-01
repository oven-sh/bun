// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// The TypeError of Object.create(x) for an x that is no object names the built-in in the first frame of its stack, above the function that called it, where a call that leaves a trace stands behind the creation.
const members = {
  get size() {
    return this.items;
  },
};
let calls = 0;
function g() {
  calls++;
  return 7;
}
function make(proto) {
  const made = Object.create(proto);
  made.items = g();
  return made;
}
console.log(make(members).size, calls);
try {
  make(1);
  console.log("no throw");
} catch (e) {
  console.log(
    calls,
    e.stack
      .split("\n")
      .slice(0, 3)
      .map(line => line.trim().split(" (")[0])
      .join(" | "),
  );
}
