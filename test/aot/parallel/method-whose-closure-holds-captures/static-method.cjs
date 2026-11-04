// static method
class Held {
  static #n = 0;
  static set(value) { Held.#n += value; return Held.#n; }
}
function other(value) { return "other " + value; }
globalThis.kept = Held;
const said = [];
for (let i = 0; i < 5; i++) {
  if (i === 3) Held.set = other;
  said.push(Held.set(i));
}
console.log(said.join(" | "));
