// One place reads a name on objects without a class whose getters all come from one function. Later the accessor is replaced by another getter, by a getter of the same
// function with other captures, by a value, by a setter alone, is deleted, is hidden by an own value, and comes back.
function getterFor(label, step) {
  let calls = 0;
  return function () { calls += step; return label + ":" + calls; };
}
function otherGetter() { return "other:" + typeof this; }
function make(names) {
  const made = Object.create(null);
  for (const name of names) Object.defineProperty(made, name, { get: getterFor(name, 1), configurable: true, enumerable: false });
  return made;
}
function read(object) { return object.first; }
const object = make(["first", "second"]);
const log = [];
const note = what => log.push(what + " " + String(read(object)) + " " + String(read(object)));
for (let i = 0; i < 50; i++) read(object);
note("as made");
Object.defineProperty(object, "first", { get: otherGetter });
note("another function");
Object.defineProperty(object, "first", { get: getterFor("again", 10) });
note("the same function, other captures");
Object.defineProperty(object, "first", { value: 7, writable: true });
note("a value");
object.first = getterFor("a value that is such a closure", 1);
log.push("a closure as the value " + typeof read(object) + " " + read(object)());
Object.defineProperty(object, "first", { set(value) { log.push("set " + value); }, get: undefined });
note("a setter alone");
object.first = 3;
delete object.first;
note("deleted");
Object.defineProperty(object, "first", { get: getterFor("back", 100), configurable: true });
note("back");
const heir = Object.create(object);
log.push("through an heir " + read(heir));
Object.defineProperty(heir, "first", { value: "own", configurable: true });
log.push("hidden " + read(heir));
delete heir.first;
log.push("no longer hidden " + read(heir));
Object.freeze(object);
note("frozen");
console.log(log.join("\n"));
