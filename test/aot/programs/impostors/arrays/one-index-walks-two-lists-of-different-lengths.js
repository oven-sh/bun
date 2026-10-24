function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

const uses = {
  dot(a, b) {
    let total = 0;
    for (let i = 0; i < a.length; i++) total += a[i] * b[i];
    return total;
  },
  zip(a, b) {
    const out = [];
    for (let i = 0; i < a.length; i++) out.push([a[i], b[i]]);
    return out;
  },
  equal(a, b) {
    if (a.length !== b.length) return "other length";
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
    return "equal";
  },
  copyInto(a, b) {
    for (let i = 0; i < a.length; i++) b[i] = a[i];
    return b;
  },
  copyBackwards(a, b) {
    for (let i = a.length - 1; i >= 0; i--) b[i] = a[i];
    return b;
  },
  addInto(a, b) {
    for (let i = 0; i < a.length; i++) b[i] += a[i];
    return b;
  },
  shorter(a, b) {
    const out = [];
    for (let i = 0; i < a.length && i < b.length; i++) out.push(a[i] + b[i]);
    return out;
  },
  longer(a, b) {
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(i in a, i in b);
    return out;
  },
  byTheOthersLength(a, b) {
    const out = [];
    for (let i = 0; i < b.length; i++) out.push(a[i]);
    return out;
  },
  mapWithTheOther: (a, b) => a.map((value, index) => value + b[index]),
  everyWithTheOther: (a, b) => a.every((value, index) => value === b[index]),
  interleaved(a, b) {
    const out = [];
    let i = 0;
    for (const value of a) out.push(value, b[i++]);
    return out;
  },
  shifted(a, b) {
    const out = [];
    for (let i = 0; i < a.length; i++) out.push(b[i - 1], b[i + 1]);
    return out;
  },
};

const seconds = {
  "as long": () => [10, 20, 30],
  "shorter": () => [10],
  "longer": () => [10, 20, 30, 40, 50],
  "empty": () => [],
  "doubles, shorter": () => [1.5, 2.5],
  "strings, shorter": () => ["x"],
  "with a hole": () => [10, , 30],
  "only holes": () => new Array(3),
  "an array-like, shorter": () => ({ 0: 10, length: 1 }),
  "an array-like without a length": () => ({ 0: 10, 1: 20, 2: 30 }),
  "a string": () => "xy",
  "a typed array, shorter": () => new Uint8Array([10, 20]),
  "a frozen array, shorter": () => Object.freeze([10]),
  "a sealed array, shorter": () => Object.seal([10]),
  "an array with a fixed length, shorter": () => Object.defineProperty([10], "length", { writable: false }),
  "arguments, shorter": () => (function () { return arguments; })(10),
  "a proxy, shorter": () => new Proxy([10], {}),
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([1, 2, 3], [10, 20, 30]);

for (const name in seconds) for (const use in uses) attempt("the second is " + name + ", " + use, () => uses[use]([1, 2, 3], seconds[name]()));
for (const use in uses) attempt("both are one array, " + use, () => { const list = [1, 2, 3]; return uses[use](list, list); });

module.exports = uses;
