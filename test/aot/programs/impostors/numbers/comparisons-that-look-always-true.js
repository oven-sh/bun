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

const claims = {
  "x === x": x => x === x,
  "x == x": x => x == x,
  "x <= x": x => x <= x,
  "x >= x": x => x >= x,
  "!(x < x)": x => !(x < x),
  "!(x != x)": x => !(x != x),
  "x - x === 0": x => x - x === 0,
  "x * 0 === 0": x => x * 0 === 0,
  "x + 1 > x": x => x + 1 > x,
  "x - 1 < x": x => x - 1 < x,
  "x + 1 !== x": x => x + 1 !== x,
  "x * x >= 0": x => x * x >= 0,
  "x / x === 1": x => x / x === 1,
  "x * 2 / 2 === x": x => (x * 2) / 2 === x,
  "x + 0 === x": x => x + 0 === x,
  "x * 1 === x": x => x * 1 === x,
  "-(-x) === x": x => -(-x) === x,
  "+x === x": x => +x === x,
  "(x | 0) === x": x => (x | 0) === x,
  "(x >>> 0) >= 0": x => x >>> 0 >= 0,
  "(x & 7) <= 7": x => (x & 7) <= 7,
  "(x & 7) >= 0": x => (x & 7) >= 0,
  "x % 3 < 3": x => x % 3 < 3,
  "x % 3 > -3": x => x % 3 > -3,
  "Math.abs(x) >= 0": x => Math.abs(x) >= 0,
  "Math.floor(x) <= x": x => Math.floor(x) <= x,
  "Math.ceil(x) >= x": x => Math.ceil(x) >= x,
  "Math.max(x, 0) >= 0": x => Math.max(x, 0) >= 0,
  "Math.min(x, 0) <= 0": x => Math.min(x, 0) <= 0,
  "Math.sign(x) <= 1": x => Math.sign(x) <= 1,
  "Math.sqrt(x * x) >= 0": x => Math.sqrt(x * x) >= 0,
  "x < 0 || x >= 0": x => x < 0 || x >= 0,
  "x < 5 === !(x >= 5)": x => x < 5 === !(x >= 5),
  "x > 5 === 5 < x": x => x > 5 === 5 < x,
  "(x < 5 ? 1 : 2) === (x >= 5 ? 2 : 1)": x => (x < 5 ? 1 : 2) === (x >= 5 ? 2 : 1),
  "typeof (x + 1) === 'number'": x => typeof (x + 1) === "number",
  "typeof (x - 1) === 'number'": x => typeof (x - 1) === "number",
  "typeof -x === 'number'": x => typeof -x === "number",
  "typeof x++ === 'number'": x => typeof x++ === "number",
  "typeof (x | 0) === 'number'": x => typeof (x | 0) === "number",
  "Object.is(x * 1, x)": x => Object.is(x * 1, x),
  "Object.is(x + 0, x)": x => Object.is(x + 0, x),
  "Object.is(x - 0, x)": x => Object.is(x - 0, x),
  "Object.is(0 - x, -x)": x => Object.is(0 - x, -x),
  "Object.is(x * -1, -x)": x => Object.is(x * -1, -x),
  "Object.is(x / 1, x)": x => Object.is(x / 1, x),
  "Object.is(x ** 1, x)": x => Object.is(x ** 1, x),
  "Object.is(x * 2, x + x)": x => Object.is(x * 2, x + x),
  "Object.is(x - x, 0)": x => Object.is(x - x, 0),
  "Object.is(x * 0, 0)": x => Object.is(x * 0, 0),
};

let ticks = 0;
const values = {
  "5": () => 5,
  "0": () => 0,
  "-0": () => -0,
  "-5": () => -5,
  "0.5": () => 0.5,
  "NaN": () => NaN,
  "Infinity": () => Infinity,
  "-Infinity": () => -Infinity,
  "2147483647": () => 2147483647,
  "-2147483648": () => -2147483648,
  "4294967296": () => 4294967296,
  "9007199254740992": () => 9007199254740992,
  "1.7976931348623157e308": () => 1.7976931348623157e308,
  "5e-324": () => 5e-324,
  "'5'": () => "5",
  "'abc'": () => "abc",
  "''": () => "",
  "null": () => null,
  "undefined": () => undefined,
  "true": () => true,
  "5n": () => 5n,
  "[5]": () => [5],
  "{}": () => ({}),
  "an object that counts": () => ({ valueOf: () => ++ticks }),
};

for (const claim of Object.keys(claims)) for (let i = 1; i < 500; i++) claims[claim](i);
for (const claim of Object.keys(claims)) {
  const failing = [];
  for (const name of Object.keys(values)) {
    const result = outcome(() => claims[claim](values[name]()));
    if (result !== "true") failing.push(name + ": " + result);
  }
  console.log(claim, "fails for", failing.join(" | ") || "nothing");
}
