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

class Meter {
  constructor() {
    this.reading = 0;
    this.label = "meter";
  }
  advance() {
    this.reading++;
    return this.reading;
  }
  doubled() {
    return this.reading * 2;
  }
  bucket() {
    return this.reading & 7;
  }
  next() {
    return this.reading + 1;
  }
  isLow() {
    return this.reading < 10;
  }
}

const late = [0.5, NaN, 2147483647, 2147483648, -2147483649, -0, Infinity, "3", "", "abc", undefined, null, true, 3n, [4], { valueOf: () => 5 }, new Date(6), Symbol("s")];
const makers = { class: () => new Meter() };

for (const kind of Object.keys(makers)) {
  const warm = makers[kind]();
  for (let i = 0; i < 2000; i++) {
    warm.advance();
    warm.doubled();
    warm.bucket();
    warm.next();
    warm.isLow();
  }
  console.log(kind, "after 2000 honest rounds", warm.reading);
  for (const value of late) {
    const label = kind + " with " + show(value);
    warm.reading = value;
    attempt(label + " read", () => warm.reading);
    attempt(label + " doubled", () => warm.doubled());
    attempt(label + " bucket", () => warm.bucket());
    attempt(label + " next", () => warm.next());
    attempt(label + " isLow", () => warm.isLow());
    attempt(label + " advance", () => [warm.advance(), warm.reading]);
    warm.reading = 1;
    attempt(label + " and an integer again", () => [warm.advance(), warm.doubled(), warm.bucket()]);
  }
}
