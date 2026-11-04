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
function first() { return { own: 1 }; }
function second() { return { own: 1 }; }
for (let turn = 0; turn < 3; turn++) {
  const hidden = first();
  Object.defineProperty(hidden, "k", { value: 1, writable: true, configurable: true });
  const plain = second();
  plain.k = 2;
  const crossed = turn & 1 ? first() : second();
  crossed.k = 3;
  show("hidden", hidden);
  show("plain", plain);
  show("crossed", crossed);
  lines.push(read(hidden) + " " + read(plain) + " " + read(crossed));
}
console.log(lines.join("\n"));
