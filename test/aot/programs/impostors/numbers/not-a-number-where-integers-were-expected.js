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

function notANumber(a, b) {
  return a / b;
}

for (let i = 1; i < 2000; i++) notANumber(i * 2, 2);
const nan = notANumber(0, 0);

attempt("show", () => nan);
attempt("nan === nan", () => nan === nan);
attempt("nan !== nan", () => nan !== nan);
attempt("nan == nan", () => nan == nan);
attempt("Object.is(nan, NaN)", () => Object.is(nan, NaN));
attempt("nan < 1, nan > 1, nan <= nan, nan >= nan", () => [nan < 1, nan > 1, nan <= nan, nan >= nan]);
attempt("!(nan < 1)", () => !(nan < 1));
attempt("nan | 0", () => nan | 0);
attempt("nan >>> 0", () => nan >>> 0);
attempt("~nan", () => ~nan);
attempt("nan << 1", () => nan << 1);
attempt("1 << nan", () => 1 << nan);
attempt("nan + 1", () => nan + 1);
attempt("nan * 0", () => nan * 0);
attempt("nan ** 0", () => nan ** 0);
attempt("nan % 1", () => nan % 1);
attempt("-nan", () => -nan);
attempt("nan ? 1 : 2", () => (nan ? 1 : 2));
attempt("!nan", () => !nan);
attempt("nan || 'falsy'", () => nan || "falsy");
attempt("nan ?? 'nullish'", () => nan ?? "nullish");
attempt("typeof nan", () => typeof nan);
attempt("['a', 'b'][nan]", () => ["a", "b"][nan]);
attempt("'ab'[nan]", () => "ab"[nan]);
attempt("'ab'.charAt(nan)", () => "ab".charAt(nan));
attempt("'ab'.at(nan)", () => "ab".at(nan));
attempt("'ab'.slice(nan)", () => "ab".slice(nan));
attempt("[1, 2].slice(nan)", () => [1, 2].slice(nan));
attempt("[1, 2].at(nan)", () => [1, 2].at(nan));
attempt("a store at nan", () => {
  const list = [1, 2];
  list[nan] = 3;
  return [list, Object.keys(list)];
});
attempt("[nan].indexOf(nan)", () => [nan].indexOf(nan));
attempt("[nan].includes(nan)", () => [nan].includes(nan));
attempt("[nan].lastIndexOf(nan)", () => [nan].lastIndexOf(nan));
attempt("[nan].findIndex", () => [nan].findIndex(x => x !== x));
attempt("a typed indexOf and includes", () => [new Float64Array([nan]).indexOf(nan), new Float64Array([nan]).includes(nan)]);
attempt("a Map key", () => new Map([[nan, "found"]]).get(NaN));
attempt("a Set", () => new Set([nan, NaN, 0 / 0]).size);
attempt("switch", () => {
  switch (nan) {
    case NaN:
      return "case NaN";
    case 0:
      return "case 0";
    default:
      return "default";
  }
});
attempt("Math.max(nan, 1)", () => Math.max(nan, 1));
attempt("Math.min(1, nan)", () => Math.min(1, nan));
attempt("Math.round(nan)", () => Math.round(nan));
attempt("Math.sign(nan)", () => Math.sign(nan));
attempt("Math.imul(nan, 3)", () => Math.imul(nan, 3));
attempt("Math.clz32(nan)", () => Math.clz32(nan));
attempt("isNaN and Number.isNaN", () => [isNaN(nan), Number.isNaN(nan), Number.isInteger(nan), Number.isFinite(nan)]);
attempt("String(nan)", () => String(nan));
attempt("JSON.stringify([nan])", () => JSON.stringify([nan]));
attempt("nan.toFixed(2)", () => nan.toFixed(2));
attempt("Array(nan)", () => Array(nan));
attempt("'a'.repeat(nan)", () => "a".repeat(nan));
attempt("new Date(nan).getTime()", () => new Date(nan).getTime());
attempt("Int32Array", () => new Int32Array([nan])[0]);
attempt("Uint8ClampedArray", () => new Uint8ClampedArray([nan])[0]);
attempt("Float32Array", () => new Float32Array([nan])[0]);
attempt("in an array of integers", () => {
  const list = [1, 2, 3];
  list[1] = nan;
  return [list, list[1] === list[1], list.indexOf(nan), list.includes(nan)];
});
attempt("in a field that held integers", () => {
  const holder = { n: 0 };
  for (let i = 0; i < 100; i++) holder.n = i;
  holder.n = nan;
  return [holder.n, holder.n === holder.n, holder.n | 0];
});
attempt("sorted with a difference", () => [3, nan, 1].sort((a, b) => a - b));
attempt("sorted by default", () => [3, nan, 1].sort());
attempt("a loop bound", () => {
  let count = 0;
  for (let i = 0; i < nan; i++) count++;
  return count;
});
attempt("a loop that runs while not at least", () => {
  let count = 0;
  for (let i = 0; !(i >= nan); i++) {
    count++;
    if (count === 5) break;
  }
  return count;
});
attempt("a counter that starts at nan", () => {
  let n = nan;
  n++;
  return [n, n | 0];
});
attempt("the bits survive a Float64Array", () => {
  const floats = new Float64Array([nan, -nan]);
  return [floats[0], floats[1]];
});
attempt("a NaN with a payload read from bytes", () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 0xf8, 0xff]);
  const value = new Float64Array(bytes.buffer)[0];
  return [value, value === value, typeof value, [value].includes(NaN), value | 0];
});
attempt("a float32 NaN with a payload read from bytes", () => {
  const bytes = new Uint8Array([1, 2, 0xc3, 0xff]);
  const value = new Float32Array(bytes.buffer)[0];
  return [value, typeof value, Object.is(value, NaN)];
});
attempt("a DataView NaN with a payload", () => {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, 0xfff80000);
  view.setUint32(4, 0x12345678);
  const value = view.getFloat64(0);
  return [value, typeof value, { value }.value, [value][0]];
});
