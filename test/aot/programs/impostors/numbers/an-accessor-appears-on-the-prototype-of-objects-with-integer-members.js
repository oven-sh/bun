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

const log = [];

function Gauge(level) {
  this.level = level;
  this.step = 1;
}
Gauge.prototype.raise = function () {
  this.level = this.level + this.step;
  return this.level;
};
Gauge.prototype.report = function () {
  return [this.level, this.level + 1, this.level & 7, typeof this.level, Object.keys(this)];
};

class Meter {
  constructor(level) {
    this.level = level;
    this.step = 1;
  }
  raise() {
    this.level = this.level + this.step;
    return this.level;
  }
  report() {
    return [this.level, this.level + 1, this.level & 7, typeof this.level, Object.keys(this)];
  }
}

class Dial {
  level = 0;
  step = 1;
  raise() {
    this.level = this.level + this.step;
    return this.level;
  }
  report() {
    return [this.level, this.level + 1, this.level & 7, typeof this.level, Object.keys(this)];
  }
}

const kinds = [
  ["constructor function", Gauge, () => new Gauge(0)],
  ["class with assignments", Meter, () => new Meter(0)],
  ["class with fields", Dial, () => new Dial()],
];

function exercise(label, make) {
  log.length = 0;
  const result = outcome(() => {
    const made = make();
    return [made.raise(), made.raise(), made.report()];
  });
  console.log(label + " -> " + result + " | " + log.join(", "));
}

const name = ["le", "vel"].join("");
for (const [kind, constructor, make] of kinds) {
  const old = make();
  for (let i = 0; i < 2000; i++) {
    const made = make();
    made.raise();
    made.report();
    old.raise();
  }
  exercise(kind + " before", make);

  let kept = 100;
  Object.defineProperty(constructor.prototype, name, {
    get() {
      log.push("get");
      return kept;
    },
    set(value) {
      log.push("set " + show(value));
      kept = value;
    },
    configurable: true,
  });
  exercise(kind + " with an accessor on the prototype", make);
  attempt(kind + ": an object made earlier keeps its own member", () => [old.raise(), old.report()]);

  Object.defineProperty(constructor.prototype, name, {
    get() {
      log.push("get");
      return "text";
    },
    set: undefined,
    configurable: true,
  });
  exercise(kind + " with a getter only", make);

  Object.defineProperty(constructor.prototype, name, { value: 0.5, writable: false, configurable: true });
  exercise(kind + " with a member that is not writable", make);

  Object.defineProperty(constructor.prototype, name, { value: "inherited", writable: true, configurable: true });
  exercise(kind + " with a writable member", make);
  attempt(kind + ": the inherited member shows after a deletion", () => {
    const made = make();
    delete made[name];
    return [made.report(), made.raise(), made.report()];
  });

  delete constructor.prototype[name];
  exercise(kind + " after the prototype is clean again", make);
}
