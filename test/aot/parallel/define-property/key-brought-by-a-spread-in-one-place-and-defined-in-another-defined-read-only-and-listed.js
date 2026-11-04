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
function spread(other) { return { own: 1, ...other }; }
function bare() { return { own: 1 }; }
for (let turn = 0; turn < 3; turn++) {
  show("spread", spread({ k: 2 }));
  const hidden = bare();
  Object.defineProperty(hidden, "k", { value: 6, enumerable: true });
  show("hidden", hidden);
  const both = spread({ k: 4 });
  attempt("defined", () => Object.defineProperty(both, "k", { value: 6, enumerable: true }) === both);
  show("both", both);
}
console.log(lines.join("\n"));
