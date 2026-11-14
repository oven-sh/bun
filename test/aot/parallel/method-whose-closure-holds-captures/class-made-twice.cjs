// class made twice
function make(k) {
  return class Held {
    #n = 0;
    set(value) { this.#n = value + k; return this.#n; }
  };
}
const classes = [make(10), make(20)];
const said = [];
for (let i = 0; i < 6; i++) {
  const held = new classes[i & 1]();
  globalThis.kept = held;
  said.push(held.set(i));
}
console.log(said.join(" | "));
