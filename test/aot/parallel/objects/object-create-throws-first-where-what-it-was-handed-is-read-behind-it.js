// Object.create(x) throws for an x that is no object before the code behind it reads a member of x, and null below the object throws at that read.
const registry = [];
function derive(parent) {
  const child = Object.create(parent);
  registry.push(child);
  child.depth = parent.depth + 1;
  return child;
}
const root = { depth: 0 };
console.log(derive(derive(root)).depth, registry.length);
for (const refused of [1, "text", undefined, true, 5n, Symbol("s")]) {
  try {
    derive(refused);
    console.log("no throw");
  } catch (e) {
    console.log(e.constructor.name, e.message, registry.length);
  }
}
try {
  derive(null);
  console.log("no throw");
} catch (e) {
  console.log(e.constructor.name, registry.length, Object.getPrototypeOf(registry[2]));
}
