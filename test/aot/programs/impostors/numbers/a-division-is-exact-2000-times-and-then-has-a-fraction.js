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

function half(n) {
  return n / 2;
}

function halfOfInt32(n) {
  return (n | 0) / 2;
}

function third(n) {
  return n / 3;
}

function middle(low, high) {
  return (low + high) / 2;
}

function elementInTheMiddle(list) {
  return list[list.length / 2];
}

function perItem(total, count) {
  return total / count;
}

function halvedInPlace(n) {
  let value = n;
  value /= 2;
  return [value, value + 1, value | 0];
}

const holder = { half: 0 };
function halfInAField(n) {
  holder.half = n / 2;
  return holder.half + holder.half;
}

const halves = [0, 0, 0, 0];
function halfInAnElement(n) {
  halves[n & 3] = n / 2;
  return halves[n & 3] * 2;
}

let checksum = 0;
for (let i = 0; i < 2000; i++) {
  checksum += half(i * 2) + halfOfInt32(i * 2) + third(i * 3) + middle(i, i + 2) + perItem(i * 4, 4) + halvedInPlace(i * 2)[0] + halfInAField(i * 2) + halfInAnElement(i * 2);
  checksum += elementInTheMiddle([i, i, i, i]);
}
console.log("checksum of the exact divisions", checksum);

attempt("half(7)", () => half(7));
attempt("half(-1)", () => half(-1));
attempt("half(0)", () => half(0));
attempt("half(-0)", () => half(-0));
attempt("half(8)", () => half(8));
attempt("halfOfInt32(7)", () => halfOfInt32(7));
attempt("halfOfInt32(-2147483647)", () => halfOfInt32(-2147483647));
attempt("third(10)", () => third(10));
attempt("third(1)", () => third(1));
attempt("third(9)", () => third(9));
attempt("middle(1, 2)", () => middle(1, 2));
attempt("middle(2147483647, 2147483647)", () => middle(2147483647, 2147483647));
attempt("middle(2147483647, 2147483646)", () => middle(2147483647, 2147483646));
attempt("elementInTheMiddle of three", () => elementInTheMiddle(["a", "b", "c"]));
attempt("elementInTheMiddle of two", () => elementInTheMiddle(["a", "b"]));
attempt("elementInTheMiddle of none", () => elementInTheMiddle([]));
attempt("perItem(10, 4)", () => perItem(10, 4));
attempt("perItem(10, 0)", () => perItem(10, 0));
attempt("perItem(0, 0)", () => perItem(0, 0));
attempt("perItem(-10, 0)", () => perItem(-10, 0));
attempt("perItem(0, -4)", () => perItem(0, -4));
attempt("perItem(12, 4)", () => perItem(12, 4));
attempt("halvedInPlace(5)", () => halvedInPlace(5));
attempt("halvedInPlace(-5)", () => halvedInPlace(-5));
attempt("halfInAField(5)", () => [halfInAField(5), holder.half]);
attempt("halfInAField(6)", () => [halfInAField(6), holder.half]);
attempt("halfInAnElement(5)", () => [halfInAnElement(5), halves]);
attempt("halfInAnElement(6)", () => [halfInAnElement(6), halves]);
