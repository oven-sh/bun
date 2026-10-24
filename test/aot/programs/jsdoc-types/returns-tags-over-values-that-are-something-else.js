/** @typedef {{ x: number, y: number }} Point */

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
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

let text = "1";

/** @returns {number} */
function aNumber() {
  return JSON.parse(text);
}

/** @returns {string} */
function aText() {
  return JSON.parse(text);
}

/** @returns {Point} */
function aPoint() {
  return JSON.parse(text);
}

/** @returns {number[]} */
function aList() {
  return JSON.parse(text);
}

/** @returns {boolean} */
const aTruth = () => JSON.parse(text);

/** @returns {Promise<number>} */
async function later() {
  return JSON.parse(text);
}

/** @returns {Generator<number, void, undefined>} */
function* yielded() {
  yield JSON.parse(text);
}

class Source {
  /** @returns {number} */
  get value() {
    return JSON.parse(text);
  }
  /** @returns {number} */
  method() {
    return JSON.parse(text);
  }
  /** @returns {Point} */
  static point() {
    return JSON.parse(text);
  }
}

/**
 * @param {number} n
 * @returns {number}
 */
function plusOne(n) {
  return n + 1;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += aNumber() + plusOne(aNumber()) + new Source().value + new Source().method();
console.log("2000 honest rounds: " + warm);

for (text of ["1", "1.5", "-0", '"1"', '"ab"', "true", "null", "[1,2]", '["a"]', '{"x":1,"y":2}', '{"y":"2","x":"1"}', "{}"]) {
  attempt("a number is " + text, () => [aNumber(), typeof aNumber(), aNumber() + 1, plusOne(aNumber())]);
  attempt("a text is " + text, () => [aText() + "!", aText().length]);
  attempt("a point is " + text, () => [aPoint().x, aPoint().x + aPoint().y, Source.point().y]);
  attempt("a list is " + text, () => {
    let total = 0;
    for (const n of aList()) total += n;
    return [total, aList().length];
  });
  attempt("a truth is " + text, () => [aTruth() === true, aTruth() ? "truthy" : "falsy"]);
  attempt("a getter and a method are " + text, () => [new Source().value + 1, new Source().method() + 1]);
  attempt("yielded is " + text, () => [...yielded()].map(plusOne));
  const awaited = await later();
  attempt("awaited is " + text, () => [awaited + 1, typeof awaited]);
}

export {};
