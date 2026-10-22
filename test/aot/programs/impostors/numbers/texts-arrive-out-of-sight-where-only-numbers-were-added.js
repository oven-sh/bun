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

class Tally {
  constructor(start) {
    this.count = start;
  }
  add(amount) {
    this.count = this.count + amount;
    return this.count;
  }
  doubled() {
    return this.count + this.count;
  }
  next() {
    return this.count + 1;
  }
  isBelow(limit) {
    return this.count < limit;
  }
}

function plus(a, b) {
  return a + b;
}

function twice(x) {
  return x + x;
}

function smaller(a, b) {
  return a < b ? a : b;
}

function sumOf(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total = plus(total, list[i]);
  return total;
}

function describe(value) {
  return [value, typeof value, value + 1, value * 2];
}

function describeTally(tally) {
  return [describe(tally.doubled()), describe(tally.next()), tally.isBelow(10), tally.isBelow("10"), describe(tally.add(1)), describe(tally.count)];
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const tally = new Tally(i);
  total += tally.add(1) + tally.doubled() + tally.next() + (tally.isBelow(10) ? 1 : 0) + plus(i, 1) + twice(i) + smaller(i, 5) + sumOf([i, 1, 2]);
}
console.log("the honest total", total);

const name = ["co", "unt"].join("");
const construct = new Function("constructor", "a", "return new constructor(a);");
const call = new Function("callee", "a", "b", "return callee(a, b);");
const method = new Function("receiver", "name", "a", "return receiver[name](a);");

for (const value of JSON.parse('["5", "", "abc", "9", " 7 ", "1e3", 0.5, null, true, [5], {}]')) {
  const label = show(value);
  attempt(label + " stored under a computed name", () => {
    const tally = new Tally(1);
    tally[name] = value;
    return describeTally(tally);
  });
  attempt(label + " given by Reflect.construct", () => describeTally(Reflect.construct(Tally, [value])));
  attempt(label + " given by run-time text", () => describeTally(construct(Tally, value)));
  attempt(label + " added by run-time text", () => {
    const tally = new Tally(1);
    return [describe(method(tally, "add", value)), describeTally(tally)];
  });
  attempt(label + " mapped by the functions", () => [[value].map(twice), [value].map(plus), [value, value].reduce(plus), [value, value].reduce(smaller)]);
  attempt(label + " handed over by run-time text", () => [describe(call(plus, value, 1)), describe(call(plus, 1, value)), describe(call(twice, value)), describe(call(smaller, value, 6))]);
  attempt(label + " in a list from a parser", () => describe(sumOf(JSON.parse(JSON.stringify([1, value, 2])))));
}

let again = 0;
for (let i = 0; i < 2000; i++) {
  const tally = new Tally(i);
  again += tally.add(1) + tally.doubled() + tally.next() + (tally.isBelow(10) ? 1 : 0) + plus(i, 1) + twice(i) + smaller(i, 5) + sumOf([i, 1, 2]);
}
console.log("the honest total again", again);
