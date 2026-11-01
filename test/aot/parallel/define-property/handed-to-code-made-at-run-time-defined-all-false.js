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
const outside = new Function("made", "name", "made[name] = 21; return made;");
const definer = new Function("made", "name", "return Object.defineProperty(made, name, { value: 22, enumerable: true, writable: true, configurable: true });");
for (let turn = 0; turn < 3; turn++) {
  const hidden = new Made();
  Object.defineProperty(hidden, "k", { value: 1 });
  show("hidden", hidden);
  attempt("outside on hidden", () => outside(hidden, "k").k);
  show("hidden after", hidden);
  show("outside", outside(new Made(), "k"));
  show("definer", definer(new Made(), "k"));
  lines.push(read(hidden) + " " + read(outside(new Made(), "k")));
}
console.log(lines.join("\n"));
