// A class gives each of its objects arrow functions as fields, and its constructor stores to fields that have a first value already. The object is handed on
// by several ways. The first value of a field that the constructor stores to is made for nobody.
// COUNT: cells <= 40100
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
  text = t => this.#path.length + t.length + this.#raw.length;
  json = o => o.a + this.env.name.length;
  status = s => {
    this.finalized = s;
  };
  handled = () => this.#handler;
}
const unknown = (0, eval)("(c => { c.extra = 1; return c.text('u') + Object.keys(c).length; })");
// The loop below makes a Context and its options in each iteration, and no other object and no string.
const one = { a: 1 };
const handlers = [c => c.text("a"), c => c.json(one), c => (c.status(true), c.finalized ? 1 : 0), c => (c.handled() === null ? 1 : 0) + c.path.length];
const raws = ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"];
const envs = [{ name: "n0" }, { name: "n1" }];
const paths = ["/p0", "/p1", "/p2", "/p3"];
function dispatch(raw, env, i) {
  const c = new Context(raw, { env, path: paths[i & 3], handler: null });
  if (i % 5000 === 0) return unknown(c);
  return handlers[i & 3](c);
}
let sum = 0;
let last = 0;
for (let i = 0; i < 40000; i++) {
  last = dispatch(raws[i & 7], envs[i & 1], i);
  sum += last;
}
console.log(sum, last, dispatch("x", { name: "y" }, 0), dispatch("x", { name: "y" }, 1), new Context("z").env, new Context("z").path);
