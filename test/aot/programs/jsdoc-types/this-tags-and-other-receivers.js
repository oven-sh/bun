/** @typedef {{ x: number, y: number }} Point */

/** @type {string[]} */
const log = [];

/**
 * @param {unknown} value
 * @returns {string}
 */
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

/**
 * @param {string} label
 * @param {() => unknown} run
 */
function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(log.length > 0 ? line + " | " + log.join(" ") : line);
}

/**
 * @this {Point}
 * @param {number} n
 * @returns {number}
 */
function shifted(n) {
  return this.x + this.y + n;
}

/**
 * @this {Point}
 * @returns {string}
 */
function kind() {
  return typeof this;
}

/**
 * @this {Point}
 * @param {number} x
 */
function moveTo(x) {
  this.x = x;
  return this;
}

class Scale {
  factor = 3;
  /**
   * @param {number} n
   * @returns {number}
   */
  apply(n) {
    return n * this.factor;
  }
}

/** @type {[string, unknown][]} */
const receivers = [
  ["honest", { x: 1, y: 2 }],
  ["swapped", { y: 2, x: 1 }],
  ["texts", { x: "1", y: "2" }],
  ["partial", { y: 2 }],
  [
    "getters",
    {
      get x() {
        log.push("x");
        return 1;
      },
      get y() {
        log.push("y");
        return 2;
      },
    },
  ],
  ["frozen", Object.freeze({ x: 1, y: 2 })],
  ["a list", [1, 2]],
  ["a scale", new Scale()],
  ["a text", "xy"],
  ["a number", 5],
  ["null", null],
  ["undefined", undefined],
];

/** @type {Function} */
const looseShifted = shifted;
/** @type {Function} */
const looseKind = kind;
/** @type {Function} */
const looseMoveTo = moveTo;
/** @type {Function} */
const looseApply = Scale.prototype.apply;

let warm = 0;
for (let i = 0; i < 2000; i++) warm += shifted.call({ x: i, y: 1 }, 1) + new Scale().apply(i) + looseMoveTo.call({ x: 0, y: 0 }, i).x;
console.log("2000 honest rounds: " + warm);

for (const [name, receiver] of receivers) {
  attempt("call, " + name, () => looseShifted.call(receiver, 1));
  attempt("apply, " + name, () => looseShifted.apply(receiver, [1]));
  attempt("bind, " + name, () => looseShifted.bind(receiver)(1));
  attempt("Reflect.apply, " + name, () => Reflect.apply(looseShifted, receiver, [1]));
  attempt("the operand for this of map, " + name, () => [1, 2].map(shifted, receiver));
  attempt("typeof this, " + name, () => looseKind.call(receiver));
  attempt("a store to this, " + name, () => {
    const result = looseMoveTo.call(receiver, 9);
    return [result === receiver, typeof result, Reflect.get(Object(result), "x")];
  });
  attempt("a method of a class, " + name, () => looseApply.call(receiver, 2));
}

attempt("a plain call through a value of type Function", () => looseShifted(1));
attempt("as a member of another object", () => {
  const holder = { x: "held", y: 1, shifted: looseShifted };
  return holder.shifted(1);
});
attempt("a method taken off its object", () => {
  const apply = new Scale().apply;
  return apply(2);
});

export {};
