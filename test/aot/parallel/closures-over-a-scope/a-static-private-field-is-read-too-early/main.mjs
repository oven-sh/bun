const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const number = () => (process.argv.length > 100 ? 1 : 2);
function make() {
  const read = () => Held.peek();
  class Held {
    static early = tell(unknown(read));
    static #kept = { n: number() };
    static peek() {
      return Held.#kept.n;
    }
    static has(object) {
      return #kept in object;
    }
  }
  return [Held.early, read(), Held.has(Held)];
}
console.log(make().join());
