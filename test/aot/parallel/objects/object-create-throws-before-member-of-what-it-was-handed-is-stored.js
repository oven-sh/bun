// Object.create(x) throws for an x that is no object before the first stored value is read from a member of x.
const log = [];
function derive(parent) {
  const child = Object.create(parent);
  log.push("created");
  child.depth = parent.depth + 1;
  child.name = parent.name + "/child";
  return child;
}
const child = derive({ depth: 0, name: "root" });
console.log(child.depth, child.name, log.length);
for (const refused of [1, "text", undefined, true, 5n, Symbol("s")]) {
  try {
    derive(refused);
    console.log("no throw");
  } catch (e) {
    console.log(e.constructor.name, e.message, log.length);
  }
}
try {
  derive(null);
  console.log("no throw");
} catch (e) {
  console.log(e.constructor.name, log.length);
}
