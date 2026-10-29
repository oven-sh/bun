// A class gives each of its objects arrow functions as fields, and its constructor stores to fields that have a first value already. The object is handed on
// by several ways. The first value of a field that the constructor stores to is made for nobody.
// COUNT: cells <= 95000
class Context {
  #raw;
  #req;
  env = {};
  finalized = false;
  error;
  #handler;
  #path;
  constructor(raw, options) {
    this.#raw = raw;
    if (options) {
      this.env = options.env;
      this.#handler = options.handler;
      this.#path = options.path;
    }
  }
  get path() {
    return this.#path;
  }
  text = t => this.#path + ":" + t + ":" + this.#raw;
  json = o => JSON.stringify(o) + this.env.name;
  status = s => {
    this.finalized = s;
  };
  handled = () => this.#handler;
}
const unknown = (0, eval)("(c => { c.extra = 1; return c.text('u') + Object.keys(c).join(); })");
const handlers = [c => c.text("a"), c => c.json({ a: 1 }), c => (c.status(true), String(c.finalized)), c => String(c.handled()) + c.path];
function dispatch(raw, env, i) {
  const c = new Context(raw, { env, path: "/p" + (i & 3), handler: null });
  if (i % 5000 === 0) return unknown(c);
  return handlers[i & 3](c);
}
let sum = 0;
let last = "";
for (let i = 0; i < 40000; i++) {
  last = dispatch("r" + (i & 7), { name: "n" + (i & 1) }, i);
  sum += last.length;
}
console.log(sum, last, dispatch("x", { name: "y" }, 0), dispatch("x", { name: "y" }, 1), new Context("z").env, new Context("z").path);
