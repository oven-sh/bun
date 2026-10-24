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

class Sample {
  value = 0.5;
  optional = undefined;
  set(value) {
    this.value = value;
    this.optional = value;
  }
}

function fromWords(high, low) {
  const words = new Uint32Array([low, high]);
  return new Float64Array(words.buffer)[0];
}

function fromView(high, low) {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, high);
  view.setUint32(4, low);
  return view.getFloat64(0);
}

function fromBigInt(bits) {
  return new Float64Array(new BigUint64Array([bits]).buffer)[0];
}

function fromFloat32(bits) {
  return new Float32Array(new Uint32Array([bits]).buffer)[0];
}

function describe(value) {
  return [value, typeof value, value === undefined || value === null ? "missing" : "present", value === value, value + 1];
}

function makeHolder() {
  let kept = 0.5;
  let maybe;
  return {
    set(value) {
      kept = value;
      maybe = value;
    },
    read: () => [describe(kept), describe(maybe)],
  };
}

const sample = new Sample();
const literal = { value: 0.5, maybe: null };
const holder = makeHolder();
const list = [0.5, 1.5, 2.5];
for (let i = 0; i < 2000; i++) {
  sample.set(i + 0.5);
  if (i & 1) sample.optional = undefined;
  literal.value = i + 0.25;
  literal.maybe = i & 1 ? i + 0.25 : null;
  holder.set(i + 0.5);
  list[i % 3] = i + 0.5;
  fromWords(0x3ff00000, i);
  fromView(0x3ff00000, i);
}

const highs = [0x7ff80000, 0xfff80000, 0x7ffa0000, 0x7ffb0000, 0x7ffc0000, 0x7ffd0000, 0x7ffe0000, 0x7fff0000, 0xfffa0000, 0xfffc0000, 0xfffe0000, 0xffff0000, 0x7ff00001, 0xfff00001, 0x7ff00000, 0xfff00000, 0x00020000, 0x00060000];
for (const high of highs) {
  for (const low of [0, 10]) {
    const label = high.toString(16) + ":" + low;
    for (const [source, value] of [["words", fromWords(high, low)], ["a view", fromView(high, low)]]) {
      sample.set(value);
      literal.value = value;
      literal.maybe = value;
      holder.set(value);
      list[1] = value;
      attempt(label + " from " + source, () => describe(value));
      attempt(label + " from " + source + " in a class", () => [describe(sample.value), describe(sample.optional), "optional" in sample]);
      attempt(label + " from " + source + " in a literal", () => [describe(literal.value), describe(literal.maybe), Object.keys(literal)]);
      attempt(label + " from " + source + " in captured variables", () => holder.read());
      attempt(label + " from " + source + " in an array", () => [describe(list[1]), 1 in list, list.includes(NaN)]);
    }
  }
}
for (const bits of [0x7ffa000000000000n, 0x7ffb000000000000n, 0x7ffc000000000000n, 0xfffe000000000000n, 0xffffffffffffffffn, 0x7ff8000000000001n]) attempt("from a bigint " + bits.toString(16), () => describe(fromBigInt(bits)));
for (const bits of [0x7fc00000, 0xffc00000, 0x7fd00000, 0x7fe00000, 0x7fffffff, 0xffffffff, 0x7f800001]) attempt("from a float32 " + bits.toString(16), () => describe(fromFloat32(bits)));
