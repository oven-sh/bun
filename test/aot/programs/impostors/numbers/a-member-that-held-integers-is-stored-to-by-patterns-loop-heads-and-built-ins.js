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

const routes = {
  "an assignment pattern": (gauge, value) => {
    ({ level: gauge.level } = { level: value });
  },
  "a list pattern": (gauge, value) => {
    [gauge.level] = [value];
  },
  "the head of a for-of": (gauge, value) => {
    for (gauge.level of [value]);
  },
  "the head of a for-in": (gauge, value) => {
    for (gauge.level in { [String(value)]: 1 });
  },
  "a proxy around it": (gauge, value) => {
    new Proxy(gauge, {}).level = value;
  },
  "Object.assign from a literal": (gauge, value) => {
    Object.assign(gauge, { level: value });
  },
  "Object.defineProperty": (gauge, value) => {
    Object.defineProperty(gauge, "level", { value });
  },
  "Reflect.set": (gauge, value) => {
    Reflect.set(gauge, "level", value);
  },
  "a logical assignment": (gauge, value) => {
    gauge.level &&= value;
  },
  "a default in a pattern": (gauge, value) => {
    ({ level: gauge.level = value } = {});
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

attempt("made by JSON", () => report(JSON.parse('{"level":"3","name":"gauge"}')));
attempt("made by a spread", () => report({ ...makeGauge(), level: "3" }));
attempt("made by Object.create", () => report(Object.create(makeGauge(), { level: { value: 2.5 } })));
attempt("made by Object.fromEntries", () => report(Object.fromEntries([["level", "3"], ["name", "gauge"]])));
attempt("made by structuredClone", () => report(structuredClone({ level: 3n, name: "gauge" })));
attempt("an honest gauge afterwards", () => {
  const gauge = makeGauge();
  return [raise(gauge), report(gauge)];
});
