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

function unsigned(value) {
  return value >>> 0;
}

function unsignedPlusOne(value) {
  return (value >>> 0) + 1;
}

function unsignedTimesTwo(value) {
  return (value >>> 0) * 2;
}

function unsignedMinus(value) {
  return -(value >>> 0);
}

function unsignedCompared(value) {
  const n = value >>> 0;
  return [n > 0, n > 2147483647, n === value, n == -1, n < 4294967296];
}

function unsignedAsAnIndex(value) {
  const list = ["a", "b", "c"];
  return [list[value >>> 0], list[(value >>> 0) % 3], list[value >>> 30], list[value >>> 31]];
}

function unsignedStoredAsAnIndex(value) {
  const list = [];
  list[value >>> 0] = "x";
  return [list.length, Object.keys(list)];
}

function unsignedInAVariable(value) {
  let n = 0;
  n = value >>> 0;
  n++;
  return [n, n | 0, n >>> 0];
}

function unsignedAssigned(value) {
  let n = value | 0;
  n >>>= 0;
  return [n, n + n, n / 2, n % 10];
}

function unsignedInAField(value) {
  const holder = { n: 0 };
  holder.n = value >>> 0;
  return [holder.n, holder.n + 1];
}

function unsignedInAnArray(value) {
  const list = [1, 2, 3];
  list[1] = value >>> 0;
  return [list, list[1] + 1];
}

function unsignedInTypedArrays(value) {
  const n = value >>> 0;
  return [new Int32Array([n])[0], new Uint32Array([n])[0], new Uint8Array([n])[0], new Float32Array([n])[0]];
}

function unsignedAsText(value) {
  const n = value >>> 0;
  return [String(n), n.toString(16), `${n}`, JSON.stringify(n)];
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function hashBySums(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) >>> 0;
  return h;
}

const uses = [unsigned, unsignedPlusOne, unsignedTimesTwo, unsignedMinus, unsignedCompared, unsignedAsAnIndex, unsignedStoredAsAnIndex, unsignedInAVariable, unsignedAssigned, unsignedInAField, unsignedInAnArray, unsignedInTypedArrays, unsignedAsText];
for (let i = 0; i < 2000; i++) for (const use of uses) use(i % 3);
for (const use of uses) for (const value of [1, -1, -2, -2147483648, 2147483647, 2147483648, 4294967295, 4294967296, -4294967295, 0, -0, 1.9, -1.9]) attempt(use.name + "(" + show(value) + ")", () => use(value));
for (const text of ["", "a", "hello", "the quick brown fox jumps over the lazy dog"]) {
  attempt("hash(" + show(text) + ")", () => hash(text));
  attempt("hashBySums(" + show(text) + ")", () => hashBySums(text));
}
