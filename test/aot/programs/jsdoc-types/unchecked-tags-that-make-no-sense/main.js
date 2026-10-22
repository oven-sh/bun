function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
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

/** @type {Missing} */
const unknownName = 1;

/** @type {import("./nowhere.js").Gone} */
const unknownModule = "text";

/** @type {number */
const unclosed = "unclosed";

/** @type {} */
const noType = "no type";

/** @type */
const bare = "bare";

/** @type {number} @type {string} */
const two = true;

/** @type {number<string>} */
const notGeneric = "generic";

/** @type {Array} */
const rawArray = "raw";

/** @type {Promise} */
const rawPromise = 5;

/** @type {Object} */
const rawObject = 6;

/** @type {Function} */
const rawFunction = { not: "callable" };

/** @type {Number} */
const boxedName = "Number";

/** @type {String} */
const boxedText = 7;

/** @type {typeof missingValue} */
const typeOfNothing = 8;

/**
 * @param {number} wrongName
 * @param {string} alsoWrong
 */
function otherNames(a, b) {
  return [a + 1, b + 1];
}

/**
 * @param {string} b
 * @param {number} a
 */
function otherOrder(a, b) {
  return [a + 1, b + 1];
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} c
 */
function tooMany(a) {
  return [a + 1, arguments.length];
}

/** @param {number} a */
function tooFew(a, b, c) {
  return [a + 1, b, c];
}

/**
 * @param {number} a
 * @param {string} a
 */
function twiceTheSame(a) {
  return a + 1;
}

/**
 * @returns {number}
 * @returns {string}
 */
function twoResults() {
  return true;
}

/**
 * @template T
 * @param {U} v
 * @returns {T}
 */
function wrongTemplate(v) {
  return v;
}

/** @type {number} */
function taggedAsANumber() {
  return "called";
}

/** @type {(a: string) => string} */
function taggedAsAnotherFunction(a, b) {
  return a + b;
}

/** @typedef {number} Size */
/** @typedef {string} Size */

/** @type {Size} */
const size = [1];

/** @typedef {Loop} Loop */

/** @type {Loop} */
const loop = "loop";

/** @extends {Missing} */
class Heir {
  value = 1;
}

/** @implements {Missing} */
class Doer {
  value = 2;
}

/** @this {Missing} */
function usesThis() {
  return typeof this;
}

/** @enum {Missing} */
const Kinds = { A: 1, B: "b" };

/** @satisfies {Missing} */
const satisfied = { a: 1 };

const cast = /** @type {Missing} */ ("cast");

attempt("names that do not exist", () => [unknownName + 1, unknownModule + "!", typeOfNothing + 1, cast + "!"]);
attempt("comments that cannot be read", () => [unclosed + "!", noType + "!", bare + "!", two, notGeneric + "!"]);
attempt("names without their operands", () => [rawArray + "!", rawPromise + 1, rawObject + 1, typeof rawFunction, boxedName + "!", boxedText + 1]);
attempt("what is tagged Function is called", () => rawFunction());
attempt("parameters under other names", () => [otherNames(1, 2), otherNames("1", "2"), otherOrder(1, "b"), otherOrder("a", 2)]);
attempt("too many and too few", () => [tooMany(1), tooMany(1, 2, 3), tooFew(1), tooFew(1, 2, 3), twiceTheSame(1), twiceTheSame("1")]);
attempt("results", () => [twoResults(), wrongTemplate(1) + 1, wrongTemplate("1") + 1]);
attempt("functions with a type tag", () => [taggedAsANumber(), typeof taggedAsANumber, taggedAsAnotherFunction(1, 2), taggedAsAnotherFunction("1", 2)]);
attempt("typedefs", () => [size + 1, loop + "!"]);
attempt("classes", () => [new Heir().value + 1, new Doer().value + 1, Object.getPrototypeOf(Heir) === Function.prototype]);
attempt("the rest", () => [usesThis.call(5), usesThis(), Kinds.A + 1, Kinds.B + 1, satisfied.a + 1]);
