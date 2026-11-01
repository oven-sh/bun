// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// Two calls of Object.create in one function are both handed what is no object, and what the second makes is stored into what the first makes: the error is that of the first call, at its line and column.
function make(first, second) {
  const outer = Object.create(first);
  const inner = Object.create(second);
  outer.inner = inner;
  return outer;
}
const where = e => /:(\d+:\d+)\)?$/.exec(e.stack.split("\n").find(line => line.includes("make")))?.[1];
const above = { x: 1 },
  below = { y: 2 };
console.log(Object.getPrototypeOf(make(above, below).inner) === below);
try {
  make(1, 2);
  console.log("no throw");
} catch (e) {
  console.log(e.constructor.name, e.message, where(e));
}
try {
  make(above, 2);
  console.log("no throw");
} catch (e) {
  console.log(e.constructor.name, e.message, where(e));
}
