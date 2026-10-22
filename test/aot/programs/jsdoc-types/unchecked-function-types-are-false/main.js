function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

/**
 * @callback Step
 * @param {number} n
 * @returns {number}
 */

/** @type {Step} */
const honest = n => n + 1;

/** @type {Step} */
const shout = n => n + "!";

/** @type {Step} */
const silent = () => {};

/** @type {Step} */
const two = (a, b) => a + b;

/** @type {Step} */
const later = async n => n + 1;

/** @type {Step} */
const many = function* (n) {
  yield n;
};

/** @type {Step} */
const Only = class {
  constructor(n) {
    this.n = n;
  }
};

/** @type {Step} */
const bound = function (n) {
  return this.by + n;
}.bind({ by: "bound " });

/** @type {Step} */
const proxied = new Proxy(n => n + 1, { apply: () => "trapped" });

/** @type {Step} */
const lookAlike = { call: () => 1, apply: () => 2, bind: () => () => 3, length: 1, name: "fake" };

/** @type {Step} */
const number = 5;

/** @type {Step} */
const nothing = null;

/** @param {Step} f */
function twice(f) {
  return f(f(1));
}

/** @param {Step} f */
function mapped(f) {
  return [1, 2].map(f);
}

class Machine {
  /** @param {Step} step */
  constructor(step) {
    /** @type {Step} */
    this.step = step;
  }
  run() {
    return this.step(1) + 1;
  }
}

/** @type {Step[]} */
const steps = [honest, shout, silent, two];

/** @type {Map<string, Step>} */
const byName = new Map([
  ["honest", honest],
  ["number", number],
]);

let warm = 0;
for (let i = 0; i < 2000; i++) warm += honest(i) + twice(honest) + new Machine(honest).run() + mapped(honest)[1];
console.log("2000 honest rounds: " + warm);

for (const [name, f] of Object.entries({ honest, shout, silent, two, later, many, Only, bound, proxied, lookAlike, number, nothing })) {
  attempt(name + ", called", () => [f(1), typeof f(1), f(1) + 1]);
  attempt(name + ", a parameter", () => twice(f));
  attempt(name + ", a field", () => new Machine(f).run());
  attempt(name + ", a callback", () => mapped(f));
  attempt(name + ", call and apply", () => [f.call(undefined, 1), f.apply(undefined, [1]), f.bind(undefined, 1)()]);
  attempt(name + ", its members", () => [typeof f, f.length, f.name]);
}

attempt("in sight: each called where it is named", () => [honest(1) + 1, shout(1) + 1, silent(1) + 1, two(1) + 1, bound(1) + 1, proxied(1) + 1]);
attempt("in sight: a class", () => Only(1));
attempt("in sight: a look-alike", () => lookAlike(1));
attempt("in sight: a number", () => number(1));
attempt("in sight: null", () => nothing(1));
attempt("a list of steps", () => steps.map(f => f(1) + 1));
attempt("a map of steps", () => byName.get("honest")(1) + byName.get("honest")(2));
attempt("a map of steps, the number", () => byName.get("number")(1));
attempt("a map of steps, missing", () => byName.get("missing")(1));
