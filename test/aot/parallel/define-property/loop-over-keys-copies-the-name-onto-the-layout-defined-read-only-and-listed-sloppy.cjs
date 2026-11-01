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
function make() { return { own: 1 }; }
function copy(target, source) { for (const name in source) target[name] = source[name]; return target; }
for (let turn = 0; turn < 3; turn++) {
  const hidden = make();
  Object.defineProperty(hidden, "k", { value: 6, enumerable: true });
  show("hidden", hidden);
  show("copied", copy(make(), { k: 2, more: 3 }));
  attempt("copied onto hidden", () => copy(hidden, { k: 5 }).k);
  show("hidden after", hidden);
  show("copy of hidden", copy(make(), hidden));
}
console.log(lines.join("\n"));
