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
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
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

const things = {
  three: 3,
  digits: "3",
  yes: true,
  nothing: null,
  missing: undefined,
  big: 3n,
  valued: {
    valueOf() {
      log.push("valueOf");
      return 3;
    },
  },
  point: { x: 1, y: 2 },
  swapped: { y: 2, x: 1 },
  texts: { x: "1", y: "2" },
  partial: { x: 1 },
  getters: {
    get x() {
      log.push("x");
      return 1;
    },
    get y() {
      log.push("y");
      return "2";
    },
  },
  numbers: [1, 2],
  mixed: [1, "2", null],
  like: { 0: 1, 1: 2, length: 2 },
  step: Object.assign(/** @param {number} n */ n => n + 1, { toString: () => "step" }),
  shout: Object.assign(/** @param {number} n */ n => n + "!", { toString: () => "shout" }),
  text: "ab",
};
const names = Object.keys(things);

/** @param {string} name */
function get(name) {
  return Reflect.get(things, name);
}

/** @type {[string, string, (name: string) => unknown][]} */
const uses = [
  [
    "number",
    "three",
    name => {
      /** @type {number} */
      const n = get(name);
      return [typeof n, n + 1, n * 2, [10, 20, 30, 40][n]];
    },
  ],
  [
    "string",
    "text",
    name => {
      /** @type {string} */
      const s = get(name);
      return [typeof s, s + "!", s.length, s[0]];
    },
  ],
  [
    "boolean",
    "yes",
    name => {
      /** @type {boolean} */
      const b = get(name);
      return [typeof b, b === true, !b, b ? "truthy" : "falsy"];
    },
  ],
  [
    "Point",
    "point",
    name => {
      /** @type {Point} */
      const p = get(name);
      return [p.x, p.y, p.x + p.y, Object.keys(p).join()];
    },
  ],
  [
    "number[]",
    "numbers",
    name => {
      /** @type {number[]} */
      const list = get(name);
      let total = 0;
      for (let i = 0; i < list.length; i++) total += list[i];
      return [total, list.length, Array.isArray(list)];
    },
  ],
  [
    "number[], iterated",
    "numbers",
    name => {
      /** @type {number[]} */
      const list = get(name);
      let total = 0;
      for (const n of list) total += n;
      return [total, list.map(n => n * 2)];
    },
  ],
  [
    "(n: number) => number",
    "step",
    name => {
      /** @type {(n: number) => number} */
      const f = get(name);
      return [f(1), f(1) + 1];
    },
  ],
  [
    "number | undefined",
    "three",
    name => {
      /** @type {number | undefined} */
      const n = get(name);
      return n === undefined ? "nothing" : [n + 1, typeof n];
    },
  ],
  [
    "let, stored twice",
    "three",
    name => {
      /** @type {number} */
      let n = 1;
      n = get(name);
      const first = n + 1;
      n = 2;
      return [first, n + 1];
    },
  ],
];

for (const [type, honest, run] of uses) {
  let rounds = 0;
  for (let i = 0; i < 2000; i++) {
    run(honest);
    rounds++;
  }
  console.log(type + ": " + rounds + " honest rounds");
  for (const name of names) attempt(type + " is " + name, () => run(name));
}

export {};
