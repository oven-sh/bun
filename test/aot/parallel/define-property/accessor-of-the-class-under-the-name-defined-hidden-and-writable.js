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
class Made {
  constructor() { this.own = 1; }
  get k() { return 40; }
  set k(value) { lines.push("setter " + value); }
}
for (let turn = 0; turn < 3; turn++) {
  const bare = new Made();
  const made = new Made();
  Object.defineProperty(made, "k", { value: 1, writable: true, configurable: true });
  show("bare", bare);
  show("defined", made);
  attempt("store bare", () => (bare.k = 5));
  attempt("store defined", () => (made.k = 6));
  show("bare stored", bare);
  show("defined stored", made);
  lines.push(read(bare) + " " + read(made));
}
console.log(lines.join("\n"));
