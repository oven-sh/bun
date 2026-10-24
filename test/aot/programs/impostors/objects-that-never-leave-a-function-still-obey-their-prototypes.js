const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

class Pair {
  constructor(left, right) {
    this.left = left;
    this.right = right;
  }
  sum() {
    return this.left + this.right;
  }
}

function OldPair(left, right) {
  this.left = left;
  this.right = right;
}
OldPair.prototype.sum = function () {
  return this.left + this.right;
};

const shared = {};

const uses = [
  ["class: fields", (a, b) => { const pair = new Pair(a, b); return pair.left + pair.right; }],
  ["class: sum()", (a, b) => new Pair(a, b).sum()],
  ["class: a name it lacks", (a, b) => new Pair(a, b).middle],
  ["class: store, then read", (a, b) => { const pair = new Pair(a, b); pair.left = b; return pair.left; }],
  ["class: a new member", (a, b) => { const pair = new Pair(a, b); pair.middle = a; return [pair.middle, Object.keys(pair).length]; }],
  ["class: + pair", (a, b) => String(+new Pair(a, b))],
  ["class: in a template", (a, b) => `${new Pair(a, b)}`],
  ["class: json", (a, b) => JSON.stringify(new Pair(a, b))],
  ["class: in", (a, b) => "middle" in new Pair(a, b)],
  ["class: for-in", (a, b) => { const names = []; for (const name in new Pair(a, b)) names.push(name); return names; }],
  ["class: destructured", (a, b) => { const { left, middle = "default" } = new Pair(a, b); return [left, middle]; }],
  ["function: fields", (a, b) => { const pair = new OldPair(a, b); return pair.left + pair.right; }],
  ["function: sum()", (a, b) => new OldPair(a, b).sum()],
  ["function: a name it lacks", (a, b) => new OldPair(a, b).middle],
  ["function: owns left", (a, b) => Object.hasOwn(new OldPair(a, b), "left")],
  ["function: a new member", (a, b) => { const pair = new OldPair(a, b); pair.middle = a; return [pair.middle, Object.keys(pair).length]; }],
  ["literal: fields", (a, b) => { const pair = { __proto__: shared, left: a, right: b }; return pair.left + pair.right; }],
  ["literal: a name it lacks", (a, b) => ({ __proto__: shared, left: a, right: b }).middle],
  ["literal: a new member", (a, b) => { const pair = { __proto__: shared, left: a, right: b }; pair.middle = a; return [pair.middle, Object.keys(pair).length]; }],
  ["literal: in a template", (a, b) => `${{ __proto__: shared, left: a, right: b }}`],
  ["literal: json", (a, b) => JSON.stringify({ __proto__: shared, left: a, right: b })],
  ["literal: for-in", (a, b) => { const names = []; for (const name in { __proto__: shared, left: a, right: b }) names.push(name); return names; }],
  ["literal: destructured", (a, b) => { const { left, middle = "default" } = { __proto__: shared, left: a, right: b }; return [left, middle]; }],
  ["literal: spread", (a, b) => Object.keys({ ...{ __proto__: shared, left: a, right: b } })],
];

function look(phase) {
  for (const [label, use] of uses) {
    let line = phase + " | " + label + " -> ";
    try {
      line += show(use(1, 2));
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
  }
}

function during(phase, set, unset) {
  set();
  try {
    look(phase);
  } finally {
    unset();
  }
}

for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(i % 5, 1);
look("untouched");

for (const [name, holder] of [["Pair.prototype", Pair.prototype], ["OldPair.prototype", OldPair.prototype], ["the prototype that the literals share", shared]]) {
  during(
    "left is an accessor on " + name,
    () => Object.defineProperty(holder, "left", { get() { log.push("get left"); return "got"; }, set(value) { log.push("set left " + value); }, configurable: true }),
    () => delete holder.left,
  );
  during(
    "middle is an accessor on " + name,
    () => Object.defineProperty(holder, "middle", { get() { log.push("get middle"); return "got"; }, set(value) { log.push("set middle " + value); }, configurable: true }),
    () => delete holder.middle,
  );
  during(
    "middle is a plain member of " + name,
    () => { holder.middle = "inherited"; },
    () => delete holder.middle,
  );
  const methods = ["valueOf", "toString", "toJSON"];
  during(
    methods.join(", ") + " on " + name,
    () => {
      for (const method of methods) Object.defineProperty(holder, method, { value() { log.push(method); return method === "valueOf" ? 42 : method; }, configurable: true, writable: true });
    },
    () => {
      for (const method of methods) delete holder[method];
    },
  );
}
