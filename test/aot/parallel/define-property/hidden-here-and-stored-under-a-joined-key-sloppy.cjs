// What a function that only hands `this` on constructs gets the key `k` hidden in one place and stored under a joined key in another.
const lines = [];
const joined = ["k"].join("");
function show(label, object) {
  const names = [];
  for (const name in object) names.push(name);
  lines.push(label + ": " + JSON.stringify(Object.getOwnPropertyDescriptor(object, "k")) + " | " + Object.keys(object).join() + " | " + Object.getOwnPropertyNames(object).join() + " | " + names.join() + " | " + JSON.stringify(object) + " | " + JSON.stringify({ ...object }) + " | " + JSON.stringify(Object.entries(object)) + " | " + ("k" in object));
}
function attempt(label, action) {
  try {
    lines.push(label + ": " + JSON.stringify(action()));
  } catch (error) {
    lines.push(label + ": " + error.constructor.name);
  }
}
function read(object) {
  let sum = 0;
  for (let turn = 0; turn < 60; turn++) sum += object.k ?? -1;
  return sum;
}
function AllFalse(fill) {
  fill(this);
}
{
  const hidden = new AllFalse((made) => { made.first = 0; Object.defineProperty(made, "k", { value: 1 }); made.last = 9; });
  const other = new AllFalse((made) => { made[["k"].join("")] = 2; });
  const both = new AllFalse((made) => { Object.defineProperty(made, "k", { value: 1 }); attempt("AllFalse both", () => { made[["k"].join("")] = 2; return true; }); });
  for (const [label, object] of [["AllFalse hidden", hidden], ["AllFalse other", other], ["AllFalse both", both]]) {
    show(label, object);
    lines.push(label + " read: " + read(object));
    attempt(label + " stored", () => (object[joined] = 11));
    show(label + " stored", object);
    attempt(label + " deleted", () => delete object[joined]);
    attempt(label + " defined again", () => Object.defineProperty(object, joined, { value: 12, enumerable: true }) === object);
    show(label + " at the end", object);
    lines.push(label + " read: " + read(object));
  }
}
function Quiet(fill) {
  fill(this);
}
{
  const hidden = new Quiet((made) => { made.first = 0; Object.defineProperty(made, "k", { value: 1, writable: true, configurable: true }); made.last = 9; });
  const other = new Quiet((made) => { made[["k"].join("")] = 2; });
  const both = new Quiet((made) => { Object.defineProperty(made, "k", { value: 1, writable: true, configurable: true }); attempt("Quiet both", () => { made[["k"].join("")] = 2; return true; }); });
  for (const [label, object] of [["Quiet hidden", hidden], ["Quiet other", other], ["Quiet both", both]]) {
    show(label, object);
    lines.push(label + " read: " + read(object));
    attempt(label + " stored", () => (object[joined] = 11));
    show(label + " stored", object);
    attempt(label + " deleted", () => delete object[joined]);
    attempt(label + " defined again", () => Object.defineProperty(object, joined, { value: 12, enumerable: true }) === object);
    show(label + " at the end", object);
    lines.push(label + " read: " + read(object));
  }
}
function Fixed(fill) {
  fill(this);
}
{
  const hidden = new Fixed((made) => { made.first = 0; Object.defineProperty(made, "k", { value: 1, enumerable: true, configurable: true }); made.last = 9; });
  const other = new Fixed((made) => { made[["k"].join("")] = 2; });
  const both = new Fixed((made) => { Object.defineProperty(made, "k", { value: 1, enumerable: true, configurable: true }); attempt("Fixed both", () => { made[["k"].join("")] = 2; return true; }); });
  for (const [label, object] of [["Fixed hidden", hidden], ["Fixed other", other], ["Fixed both", both]]) {
    show(label, object);
    lines.push(label + " read: " + read(object));
    attempt(label + " stored", () => (object[joined] = 11));
    show(label + " stored", object);
    attempt(label + " deleted", () => delete object[joined]);
    attempt(label + " defined again", () => Object.defineProperty(object, joined, { value: 12, enumerable: true }) === object);
    show(label + " at the end", object);
    lines.push(label + " read: " + read(object));
  }
}
console.log(lines.join("\n"));
