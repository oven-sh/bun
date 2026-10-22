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
  "sign by a shift": x => x >> 31,
  "sign bit": x => x >>> 31,
  "absolute by a mask": x => (x ^ (x >> 31)) - (x >> 31),
  "absolute by a mask, truncated": x => ((x ^ (x >> 31)) - (x >> 31)) | 0,
  "is a power of two": x => (x & (x - 1)) === 0,
  "lowest set bit": x => x & -x,
  "clear the lowest set bit": x => x & (x - 1),
  "round up to a power of two": x => {
    x--;
    x |= x >> 1;
    x |= x >> 2;
    x |= x >> 4;
    x |= x >> 8;
    x |= x >> 16;
    x++;
    return x;
  },
  "count of set bits": x => {
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
  },
  "count of set bits by a loop": x => {
    let count = 0;
    while (x) {
      x &= x - 1;
      count++;
    }
    return count;
  },
  "rotate left by 8": x => (x << 8) | (x >>> 24),
  "rotate left by 8, unsigned": x => ((x << 8) | (x >>> 24)) >>> 0,
};

function swapByXor(a, b) {
  a ^= b;
  b ^= a;
  a ^= b;
  return [a, b];
}

function averageWithoutOverflow(a, b) {
  return (a & b) + ((a ^ b) >> 1);
}

function minimumWithoutABranch(a, b) {
  return b ^ ((a ^ b) & -(a < b));
}

const values = [0, 1, -1, 2, 5, 255, 256, 65535, 65536, 1073741824, 2147483647, -2147483648, -2147483647, 2147483648, 4294967295, 4294967296, -0, 1.5, -1.5, NaN];
for (const name of Object.keys(tricks)) for (let i = 1; i < 1000; i++) tricks[name](i);
for (const name of Object.keys(tricks)) for (const value of values) attempt(name + " of " + show(value), () => tricks[name](value));
for (const [a, b] of [[1, 2], [2147483647, -2147483648], [2147483647, 2147483647], [-2147483648, -2147483648], [-1, 1], [4294967295, 1], [1.5, 2.5]]) {
  attempt("swapByXor(" + a + ", " + b + ")", () => swapByXor(a, b));
  attempt("averageWithoutOverflow(" + a + ", " + b + ")", () => averageWithoutOverflow(a, b));
  attempt("minimumWithoutABranch(" + a + ", " + b + ")", () => minimumWithoutABranch(a, b));
}
