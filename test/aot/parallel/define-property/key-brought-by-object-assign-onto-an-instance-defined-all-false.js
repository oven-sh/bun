const lines = [];
function show(label, object) {
  const names = [];
  for (const name in object) names.push(name);
  lines.push(label + ": " + JSON.stringify(Object.getOwnPropertyDescriptor(object, "k")) + " | " + Object.keys(object).join() + " | " + Object.getOwnPropertyNames(object).join() + " | " + names.join() + " | " + JSON.stringify(object) + " | " + object.k);
}
function attempt(label, action) {
  try {
    lines.push(label + ": " + JSON.stringify(action()));
  } catch (error) {
    lines.push(label + ": " + error.constructor.name);
  }
}
class Made { constructor() { this.own = 1; } }
for (let turn = 0; turn < 3; turn++) {
  const made = Object.assign(new Made(), { k: 2 });
  show("made", made);
  attempt("stored", () => (made.k = 7));
  attempt("defined", () => Object.defineProperty(made, "k", { value: 6 }) === made);
  show("defined", made);
  const hidden = new Made();
  Object.defineProperty(hidden, "k", { value: 6 });
  show("hidden", hidden);
}
console.log(lines.join("\n"));
