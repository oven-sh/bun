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

const log = [];

function note(name, value) {
  log.push(name);
  return value;
}

function key(name) {
  return {
    toString() {
      log.push("key to text");
      return name;
    },
  };
}

function amount(result) {
  return {
    valueOf() {
      log.push("amount to number");
      return result;
    },
  };
}

const forms = {
  "base[key] = value": base => (note("base", base)[note("key", key("n"))] = note("value", 1)),
  "base[key] += value": base => (note("base", base)[note("key", key("n"))] += note("value", amount(1))),
  "base[key] -= value": base => (note("base", base)[note("key", key("n"))] -= note("value", amount(1))),
  "base[key]++": base => note("base", base)[note("key", key("n"))]++,
  "--base[key]": base => --note("base", base)[note("key", key("n"))],
  "base[key] ||= value": base => (note("base", base)[note("key", key("n"))] ||= note("value", 1)),
  "base[key] ??= value": base => (note("base", base)[note("key", key("n"))] ??= note("value", 1)),
  "base.n = value": base => (note("base", base).n = note("value", 1)),
  "base.n += value": base => (note("base", base).n += note("value", amount(1))),
  "base.n *= value": base => (note("base", base).n *= note("value", amount(2))),
  "base.n++": base => note("base", base).n++,
  "base.n &&= value": base => (note("base", base).n &&= note("value", 1)),
  "base[0] = value": base => (note("base", base)[note("index", 0)] = note("value", 1)),
  "base[0] += value": base => (note("base", base)[note("index", 0)] += note("value", amount(1))),
  "base[0]++": base => note("base", base)[note("index", 0)]++,
  "base.n * value": base => note("base", base).n * note("value", amount(2)),
  "value * base.n": base => note("value", amount(2)) * note("base", base).n,
  "base[key] * value": base => note("base", base)[note("key", key("n"))] * note("value", amount(2)),
  "-base.n": base => -note("base", base).n,
  "base.n < value": base => note("base", base).n < note("value", amount(2)),
  "delete base[key]": base => delete note("base", base)[note("key", key("n"))],
  "key in base": base => note("key", key("n")) in note("base", base),
  "[base[key]] = list": base => ([note("base", base)[note("key", key("n"))]] = note("list", [1])),
  "({ n: base[key] } = object)": base => ({ n: note("base", base)[note("key", key("n"))] } = note("object", { n: 1 })),
};

const bases = {
  "an object": () => ({ n: amount(5), 0: amount(6) }),
  "an object with numbers": () => ({ n: 5, 0: 6 }),
  "an empty object": () => ({}),
  "null": () => null,
  "undefined": () => undefined,
  "a number": () => 7,
  "a text": () => "text",
  "a frozen object": () => Object.freeze({ n: 5, 0: 6 }),
  "an array": () => [6],
  "a symbol": () => Symbol("s"),
};

for (const form of Object.keys(forms)) for (let i = 0; i < 300; i++) forms[form]({ n: i, 0: i });
for (const form of Object.keys(forms)) {
  for (const base of Object.keys(bases)) {
    log.length = 0;
    const result = outcome(() => forms[form](bases[base]()));
    console.log(form + " with " + base + " -> " + result + " | " + log.join(", "));
  }
}
