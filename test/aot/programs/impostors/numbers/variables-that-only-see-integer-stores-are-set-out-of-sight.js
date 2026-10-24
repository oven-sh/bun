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
    report: () => [count, count + 1, count & 7, count * 2, typeof count],
    set: value => {
      count = value;
    },
    add: value => {
      count += value;
    },
  };
}

let ticks = 0;

function setTicks(value) {
  ticks = value;
}

function tick() {
  return ++ticks;
}

function reportTicks() {
  return [ticks, ticks + 1, ticks & 7, ticks * 2, typeof ticks];
}

class Registry {
  static count = 0;
  static register() {
    return ++Registry.count;
  }
  static report() {
    return [Registry.count, Registry.count + 1, Registry.count & 7, typeof Registry.count];
  }
}

const counter = makeCounter();
for (let i = 0; i < 2000; i++) {
  counter.next();
  counter.set(i);
  counter.add(1);
  counter.report();
  setTicks(i);
  tick();
  reportTicks();
  Registry.register();
  Registry.report();
}
console.log("after 2000 honest rounds", show(counter.report()), show(reportTicks()), show(Registry.report()));

const late = JSON.parse('[0.5, 2147483647, 2147483648, -2147483647, -0, "3", "", null, true, [4], {}]').concat([NaN, undefined, 3n]);
const staticName = ["co", "unt"].join("");
for (const value of late) {
  const label = show(value);
  [value].forEach(counter.set);
  attempt("forEach sets the captured counter to " + label, () => counter.report());
  attempt("  next", () => [counter.next(), counter.report()]);
  counter.set(1);
  attempt("Reflect.apply adds " + label + " to the captured counter", () => {
    Reflect.apply(counter.add, null, [value]);
    return counter.report();
  });
  counter.set(1);
  [value].forEach(setTicks);
  attempt("forEach sets the module variable to " + label, reportTicks);
  attempt("  tick", () => [tick(), reportTicks()]);
  setTicks(1);
  Registry[staticName] = value;
  attempt("a computed name sets the static to " + label, () => Registry.report());
  attempt("  register", () => [Registry.register(), Registry.report()]);
  Registry.count = 1;
}
attempt("honest rounds afterwards", () => [counter.next(), counter.report(), tick(), reportTicks(), Registry.register(), Registry.report()]);
