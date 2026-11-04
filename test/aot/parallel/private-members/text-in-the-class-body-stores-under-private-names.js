// Text that runs in the body of a class names its private names: what it stores there nobody has seen.
class Counter {
  #n = 1;
  #label = "one";
  static #made = 0;
  run(text) { return eval(text); }
  static runStatic(text) { return eval(text); }
  n() { return this.#n; }
  twice() { return this.#n * 2; }
  label() { return this.#label; }
  has(o) { return #n in o; }
  static made() { return Counter.#made; }
}
const c = new Counter();
const word = process.argv.length > 99 ? "x" : "";
console.log(c.n(), c.twice(), c.label());
console.log(c.run("this.#n" + word));
console.log(c.run("this.#n = 'text'" + word), c.n(), c.twice());
console.log(c.run("this.#n = 2.5" + word), c.n(), c.twice());
console.log(c.run("this.#n = { valueOf() { return 21; } }" + word) !== undefined, typeof c.n(), c.twice());
console.log(c.run("this.#label = 7" + word), c.label());
console.log(c.run("#n in this" + word), c.run("#n in {}" + word), c.has(c), c.has({}));
console.log(Counter.runStatic("Counter.#made = 'many'" + word), Counter.made());
try { c.run("({}).#n" + word); } catch (e) { console.log(e instanceof TypeError); }
for (let i = 0; i < 3; i++) { const d = new Counter(); console.log(d.n(), d.twice(), d.run("this.#n += 1.5" + word), d.twice()); }
