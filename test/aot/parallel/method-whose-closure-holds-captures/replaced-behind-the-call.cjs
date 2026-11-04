// replaced behind the call
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
  said.push(held.set(i));
  if (i === 2) Held.prototype.set = other;
}
console.log(said.join(" | "));
