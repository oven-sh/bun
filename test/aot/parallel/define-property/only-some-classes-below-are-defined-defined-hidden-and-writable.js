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
class Base { own = 1; }
class Hidden extends Base { }
class Plain extends Base { }
class Never extends Base { }
function hide(made) { Object.defineProperty(made, "k", { value: 1, writable: true, configurable: true }); return made; }
function store(made) { made.k = 2; return made; }
for (let turn = 0; turn < 3; turn++) {
  show("hidden", hide(new Hidden()));
  show("plain", store(new Plain()));
  show("never", new Never());
  show("base", new Base());
  const late = new Never();
  late[joined] = 7;
  show("late", late);
  lines.push(read(hide(new Hidden())) + " " + read(store(new Plain())) + " " + read(new Never()));
}
console.log(lines.join("\n"));
