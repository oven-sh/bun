// replaced by code out of sight among the arguments
class Held {
  #n = 0;
  set(value) {
    this.#n = value;
    return this.#n;
  }
}
function other(value) { return "other " + value; }
globalThis.change = [i => { Held.prototype.set = other; return i; }];
const said = [];
for (let i = 0; i < 5; i++) {
  const held = new Held();
  globalThis.kept = held;
  said.push(held.set(i === 2 ? globalThis.change[0](i) : i));
}
console.log(said.join(" | "));
