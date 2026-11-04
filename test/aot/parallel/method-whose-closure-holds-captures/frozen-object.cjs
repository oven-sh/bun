// frozen object
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
  Object.freeze(held);
  said.push(held.set(i));
}
console.log(said.join(" | "));
