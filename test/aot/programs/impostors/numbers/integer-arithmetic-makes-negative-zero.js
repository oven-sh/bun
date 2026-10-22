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

const makers = {
  "0 * -1": (zero, one, five) => zero * -one,
  "-1 * 0": (zero, one, five) => -one * zero,
  "0 * -5 with int32 operands": (zero, one, five) => (zero | 0) * (-five | 0),
  "0 / -5": (zero, one, five) => zero / -five,
  "-5 % 5": (zero, one, five) => -five % five,
  "-5 % -5": (zero, one, five) => -five % -five,
  "5 % 5": (zero, one, five) => five % five,
  "-0 % 5": (zero, one, five) => -zero % five,
  "-(0)": (zero, one, five) => -zero,
  "-(0 | 0)": (zero, one, five) => -(zero | 0),
  "0 - 0": (zero, one, five) => zero - zero,
  "-0 - 0": (zero, one, five) => -zero - zero,
  "-0 + 0": (zero, one, five) => -zero + zero,
  "-0 + -0": (zero, one, five) => -zero + -zero,
  "Math.round(-0.4)": (zero, one, five) => Math.round(-(one * 0.4)),
  "Math.round(-0.5)": (zero, one, five) => Math.round(-(one * 0.5)),
  "Math.ceil(-0.5)": (zero, one, five) => Math.ceil(-(one * 0.5)),
  "Math.trunc(-0.9)": (zero, one, five) => Math.trunc(-(one * 0.9)),
  "Math.floor(-0)": (zero, one, five) => Math.floor(-zero),
  "Math.abs(-0)": (zero, one, five) => Math.abs(-zero),
  "Math.sign(-0)": (zero, one, five) => Math.sign(-zero),
  "Math.sqrt(-0)": (zero, one, five) => Math.sqrt(-zero),
  "Math.min(0, -0)": (zero, one, five) => Math.min(zero, -zero),
  "Math.max(-0, 0)": (zero, one, five) => Math.max(-zero, zero),
  "Math.max(-0, -0)": (zero, one, five) => Math.max(-zero, -zero),
  "(-0) ** 3": (zero, one, five) => (-zero) ** 3,
  "(-0) ** 2": (zero, one, five) => (-zero) ** 2,
  "-1 / Infinity": (zero, one, five) => -one / (one / zero),
  "-0 | 0": (zero, one, five) => -zero | 0,
  "-0 >>> 0": (zero, one, five) => -zero >>> 0,
  "~~-0": (zero, one, five) => ~~-zero,
  "+'-0'": (zero, one, five) => +("-" + zero),
  "Number('-0')": (zero, one, five) => Number("-" + zero),
  "parseInt('-0')": (zero, one, five) => parseInt("-" + zero),
  "parseFloat('-0')": (zero, one, five) => parseFloat("-" + zero),
  "JSON.parse('-0')": (zero, one, five) => JSON.parse("-" + zero),
  "a decrement from 1 times -1": (zero, one, five) => {
    let n = one;
    n--;
    return n * -one;
  },
  "a product in a loop": (zero, one, five) => {
    let product = -one;
    for (let i = five; i >= zero; i--) product *= i;
    return product;
  },
};

const observers = {
  "Object.is(x, -0)": x => Object.is(x, -0),
  "Object.is(x, 0)": x => Object.is(x, 0),
  "1 / x": x => 1 / x,
  "x === 0": x => x === 0,
  "Math.sign(x)": x => Math.sign(x),
  "Math.atan2(x, -1)": x => Math.atan2(x, -1),
  "Math.atan2(0, x)": x => Math.atan2(0, x),
};

for (const name of Object.keys(makers)) for (let i = 1; i < 300; i++) makers[name](i, i + 1, i + 2);
for (const name of Object.keys(makers)) {
  const made = makers[name](0, 1, 5);
  for (const observer of Object.keys(observers)) attempt(name + ": " + observer, () => observers[observer](made));
}
