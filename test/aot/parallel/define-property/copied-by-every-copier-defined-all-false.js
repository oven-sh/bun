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
function make() { const made = new Made(); Object.defineProperty(made, "k", { value: 1 }); return made; }
for (let turn = 0; turn < 3; turn++) {
  show("spread", { ...make() });
  show("assigned", Object.assign({}, make()));
  show("assigned onto one", Object.assign(new Made(), make()));
  const { own, ...rest } = make();
  show("rest", rest);
  show("cloned", structuredClone(make()));
  show("by descriptors", Object.defineProperties({}, Object.getOwnPropertyDescriptors(make())));
  show("from entries", Object.fromEntries(Object.entries(make())));
  attempt("assigned into", () => { const target = make(); Object.assign(target, { k: 3 }); show("target", target); return target.k; });
}
console.log(lines.join("\n"));
