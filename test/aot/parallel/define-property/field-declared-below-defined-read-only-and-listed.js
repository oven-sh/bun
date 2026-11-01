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
class Hidden { own = 1; constructor() { Object.defineProperty(this, "k", { value: 1, enumerable: true }); } }
class Below extends Hidden { k = 2; }
class Beside extends Hidden { other = 3; }
for (let turn = 0; turn < 3; turn++) {
  show("hidden", new Hidden());
  show("beside", new Beside());
  attempt("below", () => { const made = new Below(); show("below made", made); return made.k; });
}
console.log(lines.join("\n"));
