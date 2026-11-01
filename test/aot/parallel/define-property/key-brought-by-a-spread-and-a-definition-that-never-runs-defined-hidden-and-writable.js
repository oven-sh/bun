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
  const other = { k: 2 };
  const made = { own: 1, ...other };
  if (Object.keys(made).length > 5) Object.defineProperty(made, "k", { value: 6, writable: true, configurable: true });
  show("made", made);
  attempt("stored", () => (made.k = 7));
  show("stored", made);
}
console.log(lines.join("\n"));
