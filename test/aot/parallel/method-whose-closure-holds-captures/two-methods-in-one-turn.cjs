// two methods in one turn
class Held {
  #n = 0;
  set(value) { this.#n = value; return this.#n; }
  get() { return this.#n * 2; }
}
function other() { return "other"; }
const said = [];
for (let i = 0; i < 5; i++) {
  const held = new Held();
  globalThis.kept = held;
  if (i === 2) Held.prototype.get = other;
  said.push(held.set(i), held.get());
}
console.log(said.join(" | "));
