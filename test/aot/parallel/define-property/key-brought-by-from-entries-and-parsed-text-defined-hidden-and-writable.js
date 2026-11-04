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
  const entries = Object.fromEntries([["own", 1], ["k", 2]]);
  const parsed = JSON.parse('{"own":1,"k":2}');
  for (const [label, made] of [["entries", entries], ["parsed", parsed]]) {
    show(label, made);
    attempt(label + " stored", () => (made.k = 7));
    attempt(label + " defined", () => Object.defineProperty(made, "k", { value: 6, writable: true, configurable: true }) === made);
    show(label + " defined", made);
  }
}
console.log(lines.join("\n"));
