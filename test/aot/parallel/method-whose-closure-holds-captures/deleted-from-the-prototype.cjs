// deleted from the prototype
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
  if (i === 3) delete Held.prototype.set;
  try { said.push(held.set(i)); } catch (error) { said.push(error.constructor.name); }
}
console.log(said.join(" | "));
