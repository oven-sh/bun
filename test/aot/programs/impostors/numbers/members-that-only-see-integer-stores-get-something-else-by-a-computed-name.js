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
    this.reading = this.reading + 1;
    return this.reading;
  }
  report() {
    return [this.reading, this.reading + 1, this.reading * 2, this.reading & 7, this.reading < 10, typeof this.reading];
  }
}

function Gauge() {
  this.level = 0;
  this.label = "gauge";
}
Gauge.prototype.advance = function () {
  this.level = this.level + 1;
  return this.level;
};
Gauge.prototype.report = function () {
  return [this.level, this.level + 1, this.level * 2, this.level & 7, this.level < 10, typeof this.level];
};

function makeDial() {
  return {
    angle: 0,
    label: "dial",
    advance() {
      this.angle = this.angle + 1;
      return this.angle;
    },
    report() {
      return [this.angle, this.angle + 1, this.angle * 2, this.angle & 7, this.angle < 10, typeof this.angle];
    },
  };
}

const kinds = [
  ["class", () => new Meter(), ["read", "ing"].join("")],
  ["constructor function", () => new Gauge(), ["le", "vel"].join("")],
  ["object literal", makeDial, ["an", "gle"].join("")],
];
const late = JSON.parse('[0.5, 2147483647, 2147483648, -2147483647, -2147483648, -0, "3", "", null, true, [4], {}]').concat([NaN, undefined, 3n, Infinity]);

for (const [kind, make, name] of kinds) {
  const warm = make();
  for (let i = 0; i < 2000; i++) {
    warm.advance();
    warm.report();
  }
  console.log(kind, "after 2000 honest rounds", show(warm.report()));
  for (const value of late) {
    const label = kind + " with " + show(value);
    warm[name] = value;
    attempt(label + " report", () => warm.report());
    attempt(label + " read by name", () => [warm[name], name in warm, Object.keys(warm)]);
    attempt(label + " advance", () => [warm.advance(), warm.report()]);
    const fresh = make();
    fresh[name] = value;
    attempt(label + " in a fresh object", () => [fresh.report(), JSON.stringify(fresh) === undefined]);
    warm[name] = 1;
    attempt(label + " and an integer again", () => [warm.advance(), warm.report()]);
  }
  delete warm[name];
  attempt(kind + " deleted", () => [warm.report(), name in warm, Object.keys(warm)]);
  attempt(kind + " advanced after the deletion", () => [warm.advance(), Object.keys(warm)]);
}
