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

const uses = {
  "typeof": n => typeof n,
  "n + 1": n => n + 1,
  "n * 2": n => n * 2,
  "n | 0": n => n | 0,
  "-n": n => -n,
  "n++": n => [n++, n, typeof n],
  "n === 5": n => n === 5,
  "n == 5": n => n == 5,
  "n == n": n => n == n,
  "n < 6": n => n < 6,
  "!n": n => !n,
  "n ? 1 : 2": n => (n ? 1 : 2),
  "n || 9": n => typeof (n || 9),
  "Object.is(n, 5)": n => Object.is(n, 5),
  "list[n]": n => [0, 1, 2, 3, 4, "five"][n],
  "switch": n => {
    switch (n) {
      case 5:
        return "five";
      case 0:
        return "zero";
      default:
        return "none";
    }
  },
  "[5].indexOf(n)": n => [5, 0].indexOf(n),
  "[5].includes(n)": n => [5, 0].includes(n),
  "new Set([5]).has(n)": n => new Set([5, 0]).has(n),
  "JSON": n => JSON.stringify({ n }),
  "String": n => String(n),
  "template": n => `${n}`,
  "toFixed": n => n.toFixed(1),
  "Number.isInteger": n => Number.isInteger(n),
  "isNaN": n => isNaN(n),
  "Math.max": n => Math.max(n, 1),
  "instanceof Number": n => n instanceof Number,
  "a member": n => {
    n.extra = 1;
    return n.extra;
  },
  "Array(n).length": n => Array(n).length,
  "structuredClone": n => typeof structuredClone(n),
};

const values = {
  "new Number(5)": () => new Number(5),
  "new Number(0)": () => new Number(0),
  "new Number(-0)": () => new Number(-0),
  "new Number(NaN)": () => new Number(NaN),
  "Object(5)": () => Object(5),
  "a Number object with its own valueOf": () => Object.assign(new Number(5), { valueOf: () => 7 }),
  "a subclass of Number": () => new (class extends Number { valueOf() { return super.valueOf() + 1; } })(5),
  "an object that inherits from Number.prototype": () => Object.create(Number.prototype),
  "5": () => 5,
};

for (const name of Object.keys(uses)) for (let i = 0; i < 500; i++) outcome(() => uses[name](i % 6));
for (const kind of Object.keys(values)) for (const name of Object.keys(uses)) attempt(name + " of " + kind, () => uses[name](values[kind]()));
