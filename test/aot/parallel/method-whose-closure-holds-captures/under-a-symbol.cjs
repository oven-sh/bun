// under a symbol
const name = Symbol("set");
class Held {
  #n = 0;
  [name](value) { this.#n = value; return this.#n; }
}
function other(value) { return "other " + value; }
const said = [];
for (let i = 0; i < 5; i++) {
  const held = new Held();
  globalThis.kept = held;
  if (i === 3) Held.prototype[name] = other;
  said.push(held[name](i));
}
console.log(said.join(" | "));
