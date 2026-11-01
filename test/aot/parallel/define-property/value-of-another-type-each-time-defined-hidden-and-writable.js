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
const values = [1, "text", null, undefined, 1.5, { inner: 1 }, [1], () => 1, 10n, Symbol.iterator, true];
for (const value of values) {
  const made = new Made();
  Object.defineProperty(made, "k", { ...({ value: 1, writable: true, configurable: true }), value });
  lines.push(typeof made.k + " " + String(Object.keys(made)) + " " + Object.getOwnPropertyNames(made).join());
  const direct = new Made();
  Object.defineProperty(direct, "k", { value: 1, writable: true, configurable: true });
  show("direct", direct);
}
console.log(lines.join("\n"));
