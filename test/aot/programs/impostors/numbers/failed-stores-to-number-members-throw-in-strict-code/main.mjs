function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function increment(holder) {
  const result = holder.n++;
  return [result, holder.n];
}

function add(holder, amount) {
  const result = (holder.n += amount);
  return [result, holder.n];
}

function assign(holder, value) {
  const result = (holder.n = value);
  return [result, holder.n];
}

function incrementElement(list) {
  const result = ++list[0];
  return [result, list[0], list.length];
}

function push(list, value) {
  return [list.push(value), list];
}

const holders = {
  "plain": () => ({ n: 1 }),
  "frozen": () => Object.freeze({ n: 1 }),
  "sealed": () => Object.seal({ n: 1 }),
  "not writable": () => Object.defineProperty({}, "n", { value: 1, enumerable: true }),
  "a getter only": () => ({
    get n() {
      return 1;
    },
  }),
  "inherited and not writable": () => Object.create(Object.freeze({ n: 1 })),
  "inherited getter only": () =>
    Object.create({
      get n() {
        return 1;
      },
    }),
  "not extensible and without the member": () => Object.preventExtensions({}),
  "a number": () => 5,
  "a text": () => "text",
  "a proxy that refuses": () => new Proxy({ n: 1 }, { set: () => false }),
};

for (let i = 0; i < 2000; i++) {
  increment({ n: i });
  add({ n: i }, 1);
  assign({ n: i }, 2);
  incrementElement([i]);
}

for (const name of Object.keys(holders)) {
  attempt("increment " + name, () => increment(holders[name]()));
  attempt("add 1 to " + name, () => add(holders[name](), 1));
  attempt("add '1' to " + name, () => add(holders[name](), "1"));
  attempt("assign 2.5 to " + name, () => assign(holders[name](), 2.5));
}
attempt("incrementElement of a frozen array", () => incrementElement(Object.freeze([1])));
attempt("incrementElement of an empty frozen array", () => incrementElement(Object.freeze([])));
attempt("incrementElement of a text", () => incrementElement("5"));
attempt("push to a frozen array", () => push(Object.freeze([1]), 2));
attempt("a length that is not writable", () => {
  const list = Object.defineProperty([1, 2], "length", { writable: false });
  return [outcome(() => (list.length = 0)), outcome(() => (list[5] = 1)), list];
});
attempt("Math.PI is not writable", () => [outcome(() => (Math.PI = 3)), outcome(() => Math.PI++), Math.PI]);
attempt("Number.MAX_SAFE_INTEGER is not writable", () => [outcome(() => Number.MAX_SAFE_INTEGER++), Number.MAX_SAFE_INTEGER]);
attempt("globalThis.NaN is not writable", () => [outcome(() => (globalThis.NaN = 1)), NaN]);
