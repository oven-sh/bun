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
for (const close of [Object.preventExtensions, Object.seal, Object.freeze]) {
  const made = close(new Made());
  attempt("defined", () => Object.defineProperty(made, "k", { value: 1, writable: true, configurable: true }) === made);
  show("closed first", made);
  const later = new Made();
  Object.defineProperty(later, "k", { value: 1, writable: true, configurable: true });
  close(later);
  show("closed later", later);
  attempt("stored", () => (later.k = 8));
  attempt("deleted", () => delete later.k);
  show("at the end", later);
}
console.log(lines.join("\n"));
