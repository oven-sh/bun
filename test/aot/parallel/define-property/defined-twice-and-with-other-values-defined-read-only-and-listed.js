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
function make() { return { own: 1 }; }
for (let turn = 0; turn < 3; turn++) {
  const made = make();
  Object.defineProperty(made, "k", { value: 1, enumerable: true });
  attempt("same again", () => Object.defineProperty(made, "k", { value: 1, enumerable: true }) === made);
  attempt("other value", () => Object.defineProperty(made, "k", { value: 2 }) === made);
  show("after", made);
  attempt("listed", () => Object.defineProperty(made, "k", { enumerable: true }) === made);
  show("listed", made);
  attempt("getter", () => Object.defineProperty(made, "k", { get() { return 9; } }) === made);
  show("getter", made);
  lines.push(String(read(made)));
}
console.log(lines.join("\n"));
