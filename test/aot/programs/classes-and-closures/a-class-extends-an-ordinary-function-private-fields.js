// A class extends an ordinary function: the class has a private field.
function base() {}
class Holder extends base {
  #secret = 7;
  shown = 1;
  read() { return this.#secret; }
  static has(value) { return #secret in value; }
}
const made = new Holder();
console.log(made.read(), Holder.has(made), Holder.has({}), JSON.stringify(made));
