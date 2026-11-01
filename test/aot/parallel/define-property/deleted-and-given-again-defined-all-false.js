const lines = [];
const joined = ["k"].join("");
function show(label, object) {
  const names = [];
  for (const name in object) names.push(name);
  lines.push(label + ": " + JSON.stringify(Object.getOwnPropertyDescriptor(object, "k")) + " | " + Object.keys(object).join() + " | " + Object.getOwnPropertyNames(object).join() + " | " + names.join() + " | " + JSON.stringify(object) + " | " + JSON.stringify({ ...object }) + " | " + JSON.stringify(Object.entries(object)) + " | " + ("k" in object) + " | " + object.k);
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
  Object.defineProperty(made, "k", { value: 1 });
  show("defined", made);
  attempt("deleted", () => delete made.k);
  show("after delete", made);
  attempt("stored", () => (made.k = 4));
  show("after store", made);
  attempt("defined again", () => Object.defineProperty(made, "k", { value: 1 }) === made);
  show("at the end", made);
  lines.push(String(read(made)));
}
console.log(lines.join("\n"));
