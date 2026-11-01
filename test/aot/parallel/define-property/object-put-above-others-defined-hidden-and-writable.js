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
function make() { const made = { own: 1 }; Object.defineProperty(made, "k", { value: 1, writable: true, configurable: true }); return made; }
for (let turn = 0; turn < 3; turn++) {
  const above = make();
  const created = Object.create(above);
  const linked = Object.setPrototypeOf({ mine: 1 }, make());
  const written = { __proto__: make(), mine: 2 };
  for (const [label, child] of [["created", created], ["linked", linked], ["written", written]]) {
    lines.push(label + " reads " + child.k + " " + read(child));
    attempt(label + " store", () => (child.k = 5));
    show(label, child);
    attempt(label + " store by joined", () => (child[joined] = 6));
    show(label + " again", child);
  }
}
console.log(lines.join("\n"));
