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

function makeGauge() {
  return { level: 0, name: "gauge" };
}

function raise(gauge) {
  gauge.level = gauge.level + 1;
  return gauge.level;
}

function reset(gauge) {
  gauge.level = 0;
}

function report(gauge) {
  return [gauge.level, gauge.level + 1, gauge.level * 2, gauge.level & 7, gauge.level < 5, typeof gauge.level];
}

const name = ["le", "vel"].join("");
const routes = {
  "a computed name": (gauge, value) => {
    gauge[name] = value;
  },
  "Object.assign": (gauge, value) => {
    Object.assign(gauge, Object.fromEntries([[name, value]]));
  },
  "Reflect.set": (gauge, value) => {
    Reflect.set(gauge, name, value);
  },
  "Object.defineProperty": (gauge, value) => {
    Object.defineProperty(gauge, name, { value });
  },
  "run-time text": (gauge, value) => {
    new Function("gauge", "value", "gauge.level = value;")(gauge, value);
  },
  "a loop over the keys": (gauge, value) => {
    for (const key in gauge) if (key.length === 5) gauge[key] = value;
  },
  "Object.entries and back": (gauge, value) => {
    for (const [key] of Object.entries(gauge)) if (key !== "name") gauge[key] = value;
  },
  "a proxy and a computed name": (gauge, value) => {
    new Proxy(gauge, {})[name] = value;
  },
  "an accessor under a computed name": (gauge, value) => {
    Object.defineProperty(gauge, name, {
      get() {
        return value;
      },
      set() {},
      configurable: true,
      enumerable: true,
    });
  },
};

const warm = makeGauge();
for (let i = 0; i < 2000; i++) {
  raise(warm);
  report(warm);
  if ((i & 7) === 7) reset(warm);
}
console.log("after 2000 honest rounds", show(report(warm)));

for (const route of Object.keys(routes)) {
  for (const value of ["3", 0.5, -0, undefined, null, 3n, NaN, 2147483647, { valueOf: () => 3 }]) {
    const gauge = makeGauge();
    raise(gauge);
    routes[route](gauge, value);
    attempt(route + " stores " + show(value) + ": report", () => report(gauge));
    attempt(route + " stores " + show(value) + ": raise", () => [raise(gauge), gauge.level]);
  }
}

attempt("an honest gauge afterwards", () => {
  const gauge = makeGauge();
  return [raise(gauge), report(gauge)];
});
