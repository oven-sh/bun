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
class Made { constructor() { this.own = 1; } put(name, value) { this[name] = value; return this; } }
for (let turn = 0; turn < 3; turn++) {
  const hidden = new Made();
  Object.defineProperty(hidden, "k", { value: 6, enumerable: true });
  show("hidden", hidden);
  attempt("put on hidden", () => hidden.put(joined, 3).k);
  show("hidden after", hidden);
  const plain = new Made().put(joined, 2);
  show("plain", plain);
  attempt("defined", () => Object.defineProperty(plain, "k", { value: 6, enumerable: true }) === plain);
  show("defined", plain);
  lines.push(read(hidden) + " " + read(plain));
}
console.log(lines.join("\n"));
