// The shape of hono/dist/context.js: a base class with private fields, plain fields and arrow functions over `this` in class fields; one object a request, of which one or two arrows are called.
class Context {
  #raw;
  #status;
  env = {};
  #vars;
  finalized = false;
  error;
  #headers;
  constructor(raw, options) {
    this.#raw = raw;
    if (options) this.env = options.env;
  }
  get raw() {
    return this.#raw;
  }
  render = (...args) => this.#raw + args.length;
  status = code => {
    this.#status = code;
  };
  set = (key, value) => {
    this.#vars ??= new Map();
    this.#vars.set(key, value);
  };
  get = key => (this.#vars ? this.#vars.get(key) : undefined);
  text = (text, code) => this.#raw + ":" + text + ":" + (code ?? this.#status ?? 200);
  json = object => JSON.stringify(object) + this.finalized;
  notFound = () => "404 " + this.#raw;
}
function handle(i, keep) {
  const c = new Context("r" + i, i % 3 ? undefined : { env: { i } });
  if (i % 5 === 0) c.status(201);
  if (keep) keep.push(c.json, c);
  return c.text("x");
}
const rounds = Number(process.argv[2] ?? 1000);
let length = 0;
for (let i = 0; i < rounds; i++) length += handle(i, null).length;
const kept = [];
console.log(length, handle(1, kept), handle(5, kept), handle(6, kept));
console.log(kept[0]({ a: 1 }), kept[2] === kept[3].json, kept[1].json === kept[1].json, kept[1].json !== kept[3].json, kept[5].env.i, Object.keys(kept[1]).join());
console.log(kept[1].notFound(), kept[1].get("k"), (kept[1].set("k", 7), kept[1].get("k")), kept[3].render(1, 2, 3));
