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

/**
 * @param {number} n
 * @returns {number}
 */
function plusOne(n) {
  return n + 1;
}

/**
 * @param {Point} p
 * @returns {number}
 */
function sum(p) {
  return p.x + p.y;
}

/**
 * @param {string} s
 * @returns {number}
 */
function size(s) {
  return s.length;
}

/**
 * @param {number[]} list
 * @returns {number}
 */
function total(list) {
  let result = 0;
  for (let i = 0; i < list.length; i++) result += list[i];
  return result;
}

/**
 * @param {(n: number) => number} f
 * @returns {number}
 */
function twice(f) {
  return f(f(1));
}

class Meter {
  /** @param {number} start */
  constructor(start) {
    this.value = start;
  }
  /**
   * @param {number} by
   * @returns {number}
   */
  add(by) {
    this.value += by;
    return this.value;
  }
}

console.log("honest: " + [plusOne(1), plusOne(2.5), sum({ x: 1, y: 2 }), sum({ y: 4, x: 3 }), size("ab"), total([1, 2]), twice(plusOne), new Meter(1).add(2)].join(" "));
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + sum({ x: i, y: 1 }) + size("ab") + total([i]) + twice(plusOne) + new Meter(i).add(1);
console.log("2000 honest rounds: " + warm);

attempt("a plain call with parsed text", () => [plusOne(JSON.parse('"1"')), sum(JSON.parse('{"x":"1","y":2}')), size(JSON.parse("[1,2,3]")), total(JSON.parse('"12"')), new Meter(JSON.parse('"1"')).add(JSON.parse('"2"'))]);
attempt("a plain call with null", () => [plusOne(JSON.parse("null")), total(JSON.parse("[null]"))]);
attempt("null for a point", () => sum(JSON.parse("null")));
attempt("null for a text", () => size(JSON.parse("null")));
attempt("null for a function", () => twice(JSON.parse("null")));

/** @type {Function} */
const loosePlusOne = plusOne;
/** @type {Function} */
const looseSum = sum;
attempt("through a value of type Function", () => [loosePlusOne("1"), loosePlusOne(), looseSum({ x: "1", y: 2 }), looseSum([1, 2])]);
attempt("call, apply and bind of a value of type Function", () => [loosePlusOne.call(null, "1"), loosePlusOne.apply(null, ["1"]), loosePlusOne.bind(null, "1")()]);
attempt("Reflect.apply", () => [Reflect.apply(loosePlusOne, undefined, ["1"]), Reflect.apply(looseSum, undefined, ["xy"])]);
attempt("a callback of a parsed list", () => [JSON.parse('["1",null,[2]]').map(plusOne), JSON.parse('[{"x":"1","y":2},[1,2],5]').map(sum)]);
attempt("a callback of replace", () => "a1b".replace(/(\d)/, (whole, /** @type {number} */ digit) => String(plusOne(digit))));
attempt("a reviver", () => JSON.stringify(JSON.parse('{"a":"1","b":2}', (key, value) => (key === "" ? value : plusOne(value)))));
attempt("text that is evaluated", () => Function("plusOne", "sum", "return [plusOne('1'), plusOne(), sum({ x: '1', y: 2 }), sum('xy')]")(plusOne, sum));
attempt("a method read by a computed name", () => {
  const meter = new Meter(1);
  return Reflect.get(meter, "ad" + "d").call(meter, "2");
});
attempt("a method on another receiver", () => Reflect.apply(Meter.prototype.add, { value: "1" }, [2]));
attempt("more operands than declared", () => Reflect.apply(loosePlusOne, undefined, [1, 2, 3]));

console.log("honest again: " + [plusOne(1), sum({ x: 1, y: 2 }), size("ab"), total([1, 2]), twice(plusOne), new Meter(1).add(2)].join(" "));

export {};
