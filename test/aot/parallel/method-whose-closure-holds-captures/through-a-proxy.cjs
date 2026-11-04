// through a proxy
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
  const proxy = new Proxy(held, {});
  try { said.push(proxy.set(i)); } catch (error) { said.push(error.constructor.name); }
  said.push(held.set(i));
}
console.log(said.join(" | "));
