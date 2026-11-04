const lines = [];
const joined = ["k"].join("");
const elsewhere = ["o", "ther"].join("");
function show(label, object) {
  const names = [];
  for (const name in object) names.push(name);
  lines.push(label + ": " + JSON.stringify(Object.getOwnPropertyDescriptor(object, "k")) + " | " + Object.keys(object).join() + " | " + Object.getOwnPropertyNames(object).join() + " | " + names.join() + " | " + JSON.stringify(object) + " | " + JSON.stringify({ ...object }) + " | " + object.k);
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
class Made { constructor() { this.own = 1; } }
for (let turn = 0; turn < 3; turn++) {
  const made = new Made();
  Object.defineProperty(made, "k", { value: 6, enumerable: true });
  lines.push([joined in made, Object.hasOwn(made, joined), made.hasOwnProperty(joined), made.propertyIsEnumerable(joined), made[joined]].join());
  attempt("deleted", () => delete made[joined]);
  lines.push([joined in made, Object.hasOwn(made, joined), made[joined]].join());
  attempt("stored", () => (made[joined] = 8));
  show("at the end", made);
}
console.log(lines.join("\n"));
