// subclass overrides it
class Held {
  #n = 0;
  set(value) {
    this.#n = value;
    return this.#n;
  }
}
class Below extends Held { set(value) { return "below " + super.set(value); } }
const said = [];
for (let i = 0; i < 5; i++) {
  const held = new Held();
  globalThis.kept = held;
  const one = i & 1 ? new Below() : held;
  globalThis.kept = one;
  said.push(one.set(i));
}
console.log(said.join(" | "));
