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

function parseDigits(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) n = n * 10 + (text.charCodeAt(i) - 48);
  return n;
}

function parseDigitsAsInt32(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) n = (n * 10 + (text.charCodeAt(i) - 48)) | 0;
  return n;
}

function parseDigitsWithShifts(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) n = (n << 3) + (n << 1) + (text.charCodeAt(i) & 15);
  return n;
}

function parseHex(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    n = n * 16 + (code < 58 ? code - 48 : (code | 32) - 87);
  }
  return n;
}

function parseHexWithShifts(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    n = (n << 4) | (code < 58 ? code - 48 : (code | 32) - 87);
  }
  return n;
}

function parseSigned(text) {
  let sign = 1;
  let i = 0;
  if (text[0] === "-") {
    sign = -1;
    i = 1;
  }
  let n = 0;
  for (; i < text.length; i++) n = n * 10 + (text.charCodeAt(i) - 48);
  return sign * n;
}

function codeBeyondTheEnd(text, at) {
  const code = text.charCodeAt(at);
  return [code, code - 48, code | 0, (code - 48) | 0, code === code];
}

function sumOfCodes(text) {
  let total = 0;
  for (let i = 0; i <= text.length; i++) total += text.charCodeAt(i);
  return total;
}

const uses = [parseDigits, parseDigitsAsInt32, parseDigitsWithShifts, parseSigned];
for (let i = 0; i < 2000; i++) {
  for (const use of uses) use(String(i));
  parseHex(i.toString(16));
  parseHexWithShifts(i.toString(16));
  codeBeyondTheEnd("abc", i % 3);
}

for (const use of uses) for (const text of ["", "0", "7", "123", "2147483647", "2147483648", "4294967295", "4294967296", "9999999999", "9007199254740993", "123456789012345678901234567890", "12a", "1.5", " 1"]) attempt(use.name + "(" + show(text) + ")", () => use(text));
for (const text of ["-0", "-1", "-2147483648", "-2147483649", "-"]) attempt("parseSigned(" + show(text) + ")", () => parseSigned(text));
for (const text of ["", "f", "ff", "7fffffff", "80000000", "ffffffff", "100000000", "FFFFFFFFFF", "1fffffffffffff", "20000000000001"]) {
  attempt("parseHex(" + show(text) + ")", () => parseHex(text));
  attempt("parseHexWithShifts(" + show(text) + ")", () => parseHexWithShifts(text));
}
for (const at of [0, 2, 3, -1, 1.5, NaN, "1", undefined, 4294967296]) attempt("codeBeyondTheEnd('abc', " + show(at) + ")", () => codeBeyondTheEnd("abc", at));
attempt("sumOfCodes", () => sumOfCodes("abc"));
