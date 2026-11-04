// the first replaces the second
class Held {
  #n = 0;
  set(value) { this.#n = value; if (value === 2) Held.prototype.get = other; return this.#n; }
  get() { return this.#n * 2; }
}
function other() { return "other"; }
const said = [];
for (let i = 0; i < 5; i++) {
  const held = new Held();
  globalThis.kept = held;
  said.push(held.set(i), held.get());
}
console.log(said.join(" | "));
