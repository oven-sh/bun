// replaced by code out of sight
class Held {
  #n = 0;
  set(value) {
    this.#n = value;
    return this.#n;
  }
}
function other(value) { return "other " + value; }
globalThis.change = [() => { Held.prototype.set = other; }];
const said = [];
for (let i = 0; i < 5; i++) {
  const held = new Held();
  globalThis.kept = held;
  if (i === 2) globalThis.change[0]();
  said.push(held.set(i));
}
console.log(said.join(" | "));
