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

function makeCounter() {
  let count = 0;
  return {
    next: () => count++,
    peek: () => count,
    bucket: () => count & 7,
    doubled: () => count * 2,
    plusOne: () => count + 1,
    set: value => {
      count = value;
    },
    add: value => {
      count += value;
    },
  };
}

const late = [0.5, NaN, 2147483647, 2147483648, -0, Infinity, "3", "", undefined, null, true, 3n, [4], { valueOf: () => 5 }, Symbol("s")];
const counter = makeCounter();
for (let i = 0; i < 2000; i++) {
  counter.next();
  counter.bucket();
  counter.doubled();
  counter.plusOne();
  counter.set(i);
  counter.add(1);
}
console.log("after 2000 honest rounds", counter.peek());

for (const value of late) {
  const label = "set " + show(value);
  counter.set(value);
  attempt(label + " peek", () => counter.peek());
  attempt(label + " bucket", () => counter.bucket());
  attempt(label + " doubled", () => counter.doubled());
  attempt(label + " plusOne", () => counter.plusOne());
  attempt(label + " next", () => [counter.next(), counter.peek()]);
  counter.set(1);
  attempt(label + " then 1", () => [counter.next(), counter.peek(), counter.bucket()]);
}

for (const value of late) {
  const label = "add " + show(value);
  counter.set(1);
  attempt(label, () => {
    counter.add(value);
    return counter.peek();
  });
  attempt(label + " bucket", () => counter.bucket());
  attempt(label + " plusOne", () => counter.plusOne());
  attempt(label + " next", () => [counter.next(), counter.peek()]);
}

const other = makeCounter();
attempt("a fresh counter is not affected", () => [other.next(), other.next(), other.peek()]);
