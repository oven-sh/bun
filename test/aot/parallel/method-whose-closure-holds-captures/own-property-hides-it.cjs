// own property hides it
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
  if (i & 1) held.set = other;
  said.push(held.set(i));
}
console.log(said.join(" | "));
