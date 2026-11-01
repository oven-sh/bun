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
function hidden() { const made = { own: 1 }; Object.defineProperty(made, "k", { value: 1, enumerable: true }); return made; }
function computed(name) { return { own: 1, [name]: 2 }; }
for (let turn = 0; turn < 3; turn++) {
  show("hidden", hidden());
  show("computed", computed(joined));
  const made = computed(joined);
  attempt("store", () => (made.k = 5));
  show("stored", made);
  lines.push(read(hidden()) + " " + read(made));
}
console.log(lines.join("\n"));
