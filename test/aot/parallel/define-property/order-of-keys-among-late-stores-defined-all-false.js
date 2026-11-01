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
function fillOne(made) { made.before = 1; Object.defineProperty(made, "k", { value: 1 }); made.after = 2; return made; }
function fillOther(made) { made.after = 2; Object.defineProperty(made, "k", { value: 1 }); made.before = 1; return made; }
function fillLast(made) { made.after = 2; made.before = 1; Object.defineProperty(made, "k", { value: 1 }); return made; }
for (let turn = 0; turn < 3; turn++) {
  show("one", fillOne(new Made()));
  show("other", fillOther(new Made()));
  show("last", fillLast(new Made()));
  lines.push(Reflect.ownKeys(fillOne(new Made())).join() + " " + Reflect.ownKeys(fillOther(new Made())).join() + " " + Reflect.ownKeys(fillLast(new Made())).join());
}
console.log(lines.join("\n"));
