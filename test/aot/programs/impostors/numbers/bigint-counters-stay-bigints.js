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

function countUp(start, rounds) {
  let n = start;
  for (let i = 0; i < rounds; i++) n++;
  return n;
}

function countDown(start, rounds) {
  let n = start;
  for (let i = 0; i < rounds; i++) --n;
  return n;
}

function fieldCounter(start, rounds) {
  const holder = { n: start };
  for (let i = 0; i < rounds; i++) holder.n++;
  return holder.n;
}

function elementCounter(start, rounds) {
  const list = [start];
  for (let i = 0; i < rounds; i++) list[0]++;
  return list;
}

function loopOver(from, to) {
  const seen = [];
  for (let i = from; i < to; i++) seen.push(i);
  return seen;
}

function sumOf(list, start) {
  let total = start;
  for (const value of list) total += value;
  return total;
}

function switchesInTheMiddle(rounds, at, replacement) {
  let n = 0;
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    if (i === at) n = replacement;
    n++;
    seen.push(n);
  }
  return seen;
}

function factorial(n, one) {
  let result = one;
  for (let i = one; i <= n; i++) result *= i;
  return result;
}

for (let i = 0; i < 1000; i++) {
  countUp(i, 3);
  countDown(i, 3);
  fieldCounter(i, 3);
  elementCounter(i, 3);
  loopOver(i, i + 2);
  sumOf([1, 2, 3], 0);
  switchesInTheMiddle(3, 9, 0);
  factorial(5, 1);
}

for (const start of [0n, -2n, 2147483646n, 9007199254740991n, 18446744073709551615n, -9223372036854775808n]) {
  attempt("countUp(" + show(start) + ", 3)", () => countUp(start, 3));
  attempt("countDown(" + show(start) + ", 3)", () => countDown(start, 3));
  attempt("fieldCounter(" + show(start) + ", 3)", () => fieldCounter(start, 3));
  attempt("elementCounter(" + show(start) + ", 3)", () => elementCounter(start, 3));
}
attempt("loopOver(0n, 3n)", () => loopOver(0n, 3n));
attempt("loopOver(0n, 3)", () => loopOver(0n, 3));
attempt("loopOver(0, 3n)", () => loopOver(0, 3n));
attempt("loopOver(0n, 2.5)", () => loopOver(0n, 2.5));
attempt("loopOver(0n, '3')", () => loopOver(0n, "3"));
attempt("sumOf bigints from 0n", () => sumOf([1n, 2n, 3n], 0n));
attempt("sumOf bigints from 0", () => sumOf([1n, 2n, 3n], 0));
attempt("sumOf numbers from 0n", () => sumOf([1, 2, 3], 0n));
attempt("sumOf a mix", () => sumOf([1n, 2, 3n], 0n));
attempt("sumOf bigints from a text", () => sumOf([1n, 2n], ""));
attempt("switchesInTheMiddle to a bigint", () => switchesInTheMiddle(5, 2, 10n));
attempt("switchesInTheMiddle to a bigint at the start", () => switchesInTheMiddle(3, 0, 10n));
attempt("switchesInTheMiddle to a boxed bigint", () => switchesInTheMiddle(4, 2, Object(10n)));
attempt("factorial(25n, 1n)", () => factorial(25n, 1n));
attempt("factorial(25, 1)", () => factorial(25, 1));
attempt("factorial(5n, 1)", () => factorial(5n, 1));
attempt("factorial(5, 1n)", () => factorial(5, 1n));
attempt("honest numbers afterwards", () => [countUp(1, 3), countDown(1, 3), fieldCounter(1, 3), elementCounter(1, 3), loopOver(1, 3), sumOf([1, 2], 0)]);
