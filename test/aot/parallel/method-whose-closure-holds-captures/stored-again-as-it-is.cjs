// stored again as it is
class Held {
  #n = 0;
  set(value) {
    this.#n = value;
    return this.#n;
  }
}
const said = [];
for (let i = 0; i < 5; i++) {
  const held = new Held();
  globalThis.kept = held;
  if (i === 2) Held.prototype.set = Held.prototype.set;
  said.push(held.set(i));
}
console.log(said.join(" | "));
