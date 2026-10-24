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

function add(a, b) {
  return a + b;
}

function scale(value, factor) {
  return value * factor;
}

function bucket(value) {
  return value & 15;
}

function next(value) {
  return value + 1;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function average(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total / list.length;
}

function power(base, exponent) {
  if (exponent === 0) return 1;
  return base * power(base, exponent - 1);
}

function digits(value) {
  let count = 0;
  try {
    do {
      count++;
      value = (value / 10) | 0;
    } while (value > 0);
  } finally {
    count += 0;
  }
  return count;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += add(i, 1) + scale(i, 2) + bucket(i) + next(i) + clamp(i, 0, 10) + average([i, i]) + power(2, i & 7) + digits(i);
console.log("the honest total", total);

attempt("add(1, 2)", () => add(1, 2));
attempt("add(3, 4)", () => add(3, 4));
attempt("scale(3, 4)", () => scale(3, 4));
attempt("bucket(300)", () => bucket(300));
attempt("next(41)", () => next(41));
attempt("clamp(5, 0, 3)", () => clamp(5, 0, 3));
attempt("average([1, 2, 3])", () => average([1, 2, 3]));
attempt("power(3, 4)", () => power(3, 4));
attempt("digits(12345)", () => digits(12345));

attempt("add('1', 2)", () => add("1", 2));
attempt("add(1, '2')", () => add(1, "2"));
attempt("add(1)", () => add(1));
attempt("add()", () => add());
attempt("add(1, null)", () => add(1, null));
attempt("add(1, 2n)", () => add(1, 2n));
attempt("add(1n, 2n)", () => add(1n, 2n));
attempt("add(0.1, 0.2)", () => add(0.1, 0.2));
attempt("add(2147483647, 1)", () => add(2147483647, 1));
attempt("add(-0, -0)", () => add(-0, -0));
attempt("add([1], [2])", () => add([1], [2]));
attempt("add({}, 1)", () => add({}, 1));
attempt("add(an object with valueOf, 1)", () => add({ valueOf: () => 41 }, 1));
attempt("add(a date, 1) is a text", () => typeof add(new Date(0), 1));
attempt("add(a symbol, 1)", () => add(Symbol("s"), 1));
attempt("scale('3', '4')", () => scale("3", "4"));
attempt("scale('abc', 2)", () => scale("abc", 2));
attempt("scale(3)", () => scale(3));
attempt("scale(0, -1)", () => scale(0, -1));
attempt("scale(65536, 65536)", () => scale(65536, 65536));
attempt("scale(3n, 4n)", () => scale(3n, 4n));
attempt("scale(3n, 4)", () => scale(3n, 4));
attempt("scale([3], [4])", () => scale([3], [4]));
attempt("scale(null, 4)", () => scale(null, 4));
attempt("bucket('300')", () => bucket("300"));
attempt("bucket(300.9)", () => bucket(300.9));
attempt("bucket(4294967297)", () => bucket(4294967297));
attempt("bucket(undefined)", () => bucket(undefined));
attempt("bucket(300n)", () => bucket(300n));
attempt("bucket(-1)", () => bucket(-1));
attempt("next('41')", () => next("41"));
attempt("next(undefined)", () => next(undefined));
attempt("next(2147483647)", () => next(2147483647));
attempt("next(41n)", () => next(41n));
attempt("next(true)", () => next(true));
attempt("clamp('5', 0, 3)", () => clamp("5", 0, 3));
attempt("clamp('2', 0, 3)", () => clamp("2", 0, 3));
attempt("clamp('10', '9', '95')", () => clamp("10", "9", "95"));
attempt("clamp(NaN, 0, 3)", () => clamp(NaN, 0, 3));
attempt("clamp(-0, 0, 3)", () => clamp(-0, 0, 3));
attempt("clamp(2n, 0, 3)", () => clamp(2n, 0, 3));
attempt("clamp(undefined, 0, 3)", () => clamp(undefined, 0, 3));
attempt("average(['1', '2'])", () => average(["1", "2"]));
attempt("average([])", () => average([]));
attempt("average('12')", () => average("12"));
attempt("average([1, , 3])", () => average([1, , 3]));
attempt("average({ length: 2, 0: 1, 1: 2 })", () => average({ length: 2, 0: 1, 1: 2 }));
attempt("power('3', 2)", () => power("3", 2));
attempt("power(3, '2')", () => power(3, "2"));
attempt("power(3n, 2)", () => power(3n, 2));
attempt("power(2, 31)", () => power(2, 31));
attempt("power(2, 64)", () => power(2, 64));
attempt("digits('12345')", () => digits("12345"));
attempt("digits(12345.678)", () => digits(12345.678));
attempt("digits(4294967296)", () => digits(4294967296));
attempt("digits(null)", () => digits(null));
attempt("digits(12n)", () => digits(12n));

attempt("add(1, 2) again", () => add(1, 2));
attempt("scale(3, 4) again", () => scale(3, 4));
attempt("bucket(300) again", () => bucket(300));
attempt("next(41) again", () => next(41));
attempt("clamp(5, 0, 3) again", () => clamp(5, 0, 3));
attempt("digits(12345) again", () => digits(12345));
