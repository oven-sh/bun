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
for (let turn = 0; turn < 3; turn++) {
  const made = Object.assign({ own: 1 }, { k: 2 });
  show("made", made);
  attempt("stored", () => (made.k = 7));
  attempt("defined", () => Object.defineProperty(made, "k", { value: 6 }) === made);
  show("defined", made);
  const first = { own: 1 };
  Object.defineProperty(first, "k", { value: 6 });
  attempt("assigned", () => Object.assign(first, { k: 3 }).k);
  show("first", first);
}
console.log(lines.join("\n"));
