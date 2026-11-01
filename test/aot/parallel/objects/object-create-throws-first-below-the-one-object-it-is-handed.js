// Object.create(x) throws for an x that is no object where every object that it is handed is the same one and nothing stands between it and the first store.
function make(first) {
  const outer = Object.create(first);
  outer.x = 1;
  return outer;
}
const above = { y: 0 };
console.log(make(above).y, make(above).x);
for (const refused of [1, 2, "text", undefined, true, 5n, Symbol("s")]) {
  try {
    make(refused);
    console.log("no throw");
  } catch (e) {
    console.log(e.constructor.name, e.message);
  }
}
console.log(Object.getPrototypeOf(make(above)) === above);
