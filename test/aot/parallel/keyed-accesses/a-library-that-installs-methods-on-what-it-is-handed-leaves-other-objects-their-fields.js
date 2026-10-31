// A library installs its methods as accessors on the prototype of whatever it is handed. It may be
// handed a plain object, so the definitions may reach Object.prototype as far as the build can see.
// An object of another class that is given a field under the same name keeps that field.
function install(inst, methods) {
  const proto = Object.getPrototypeOf(inst);
  for (const key in methods) {
    const method = methods[key];
    Object.defineProperty(proto, key, {
      configurable: true,
      get() {
        return method;
      },
      set(value) {
        Object.defineProperty(this, key, { configurable: true, writable: true, value });
      },
    });
  }
}

class Schema {}
function Internals(def) {
  this.def = def;
}

const handed = process.argv.length > 100 ? {} : new Schema();
install(handed, {
  parse() {
    return "method parse";
  },
  check() {
    return "method check";
  },
});

function fill(internals, parse, check) {
  internals.parse = parse;
  internals.check = check;
  return internals;
}

let total = 0;
for (let i = 0; i < 1000; i++) {
  const internals = fill(new Internals(i), i, i + 1);
  total += internals.parse + internals.check;
}
console.log(total);

const internals = fill(new Internals(0), "field parse", "field check");
console.log(internals.parse, internals.check, Object.keys(internals).join());
console.log(new Schema().parse(), new Schema().check());
console.log(Object.getOwnPropertyDescriptor(Object.prototype, "parse"), {}.check);

const schema = new Schema();
schema.parse = "own parse";
console.log(schema.parse, Object.keys(schema).join(), Object.getOwnPropertyDescriptor(schema, "parse").enumerable);
