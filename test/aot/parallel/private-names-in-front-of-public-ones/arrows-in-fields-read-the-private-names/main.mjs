const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
class Context {
  #raw;
  #status = 200;
  env = { region: 7 };
  status = code => {
    this.#status = code;
  };
  text = body => body.length + this.#status + this.#raw;
  constructor(raw) {
    this.#raw = raw;
  }
}
const Made = unknown(Context);
let total = 0;
for (let i = 0; i < 300; i++) {
  const made = new Made(i);
  if (i & 1) made.status(201);
  total += made.text("hello") + made.env.region;
}
console.log(total, Object.keys(new Made(0)).join());
