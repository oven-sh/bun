// method read and kept
class Held {
  #n = 0;
  set(value) {
    this.#n = value;
    return this.#n;
  }
}
function other(value) { return "other " + value; }
const said = [];
for (let i = 0; i < 5; i++) {
  const held = new Held();
  globalThis.kept = held;
  const method = held.set;
  if (i === 2) Held.prototype.set = other;
  said.push(method.call(held, i), held.set(i));
}
console.log(said.join(" | "));
