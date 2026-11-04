// captures a variable
let bias = 100;
class Held {
  set(value) { return value + bias; }
}
const said = [];
for (let i = 0; i < 5; i++) {
  const held = new Held();
  globalThis.kept = held;
  bias += i;
  said.push(held.set(i));
}
console.log(said.join(" | "));
