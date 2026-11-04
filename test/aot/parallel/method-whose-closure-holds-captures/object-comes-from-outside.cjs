// object comes from outside
class Held {
  #n = 0;
  set(value) {
    this.#n = value;
    return this.#n;
  }
}
function other(value) { return "other " + value; }
globalThis.made = [new Held(), new Held(), { set: other }, new Held()];
const said = [];
for (const held of globalThis.made)
  said.push(held.set(said.length));
console.log(said.join(" | "));
