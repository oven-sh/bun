// One road by which a program comes to the prototype object of a built-in class, beside a value nobody can follow, and handed to native code first.
// The program then replaces a member under a computed name: its own store arrives, and compiled code calls the replacement.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const pick = (first, second) => (process.argv.length > 99 ? first : second);
const names = ["deref"];
const reference = new WeakRef({});
const uses = [() => reference.deref()];
const roads = {
  "Reflect.getPrototypeOf": () => Reflect.getPrototypeOf(pick(unknown({}), new WeakRef({}))),
};
let index = 0;
for (const [road, find] of Object.entries(roads)) {
  const object = find();
  Reflect.get(object, "mark", object);
  const name = names[index];
  let verdict = "stored";
  try {
    object[name] = function replaced() { return name + "!"; };
  } catch (error) {
    verdict = "refused (" + error.constructor.name + ")";
  }
  console.log(road + ":", name, verdict, uses[index]());
  index++;
}
