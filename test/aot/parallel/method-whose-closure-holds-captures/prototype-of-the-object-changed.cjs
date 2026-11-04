// prototype of the object changed
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
  if (i === 2) Object.setPrototypeOf(held, { set: other });
  said.push(held.set(i));
}
console.log(said.join(" | "));
