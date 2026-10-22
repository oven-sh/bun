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

const tricks = {
  "swap the bytes": x => ((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >> 8) & 0xff00) | ((x >> 24) & 0xff),
  "reverse the sign twice": x => -(-x | 0) | 0,
  "times two by a shift against a product": x => [x << 1, x * 2, (x * 2) | 0],
  "half by a shift against a quotient": x => [x >> 1, x / 2, (x / 2) | 0, Math.floor(x / 2)],
  "plus one in three ways": x => [x + 1, (x + 1) | 0, -~x],
  "minus one in three ways": x => [x - 1, (x - 1) | 0, ~-x],
  "high and low halves": x => [x >>> 16, x & 0xffff, (x >>> 16) * 65536 + (x & 0xffff)],
  "is even": x => (x & 1) === 0,
  "same sign as one": x => (x ^ 1) >= 0,
  "to a byte and back": x => [(x << 24) >> 24, x & 0xff],
  "mask with a large literal": x => [x & 0xffffffff, x & 0x80000000, x | 0x80000000, x ^ 0xffffffff],
  "compare after an unsigned shift": x => [x >>> 0 > 2147483647, (x >>> 0) === x, x >>> 0 >= 0],
};

const values = [0, 1, -1, 2, 5, 255, 256, 65535, 65536, 1073741824, 2147483647, -2147483648, -2147483647, 2147483648, 4294967295, 4294967296, -0, 1.5, -1.5, NaN];
for (const name of Object.keys(tricks)) for (let i = 1; i < 1000; i++) tricks[name](i);
for (const name of Object.keys(tricks)) for (const value of values) attempt(name + " of " + show(value), () => tricks[name](value));
