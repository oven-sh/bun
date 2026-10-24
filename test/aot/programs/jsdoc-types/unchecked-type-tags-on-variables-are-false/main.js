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

const table = [10, 20, 30, 40];

/** @type {number} */
const text = "3";
attempt("a number that is a text", () => [typeof text, text + 1, text * 2, text | 0, text < 4, text === 3, table[text], `${text}`]);
attempt("a number that is a text, a method", () => text.toFixed(1));

/** @type {number} */
const nothing = null;
attempt("a number that is null", () => [typeof nothing, nothing + 1, nothing === null, nothing ?? "fallback", table[nothing]]);

/** @type {number} */
const absent = undefined;
attempt("a number that is undefined", () => [typeof absent, absent + 1, absent === undefined, table[absent]]);

/** @type {number} */
const truth = true;
attempt("a number that is true", () => [typeof truth, truth + 1, truth === 1, truth == 1, table[truth]]);

/** @type {number} */
const big = 3n;
attempt("a number that is a bigint", () => [typeof big, big * 2n, big == 3]);
attempt("a number that is a bigint, mixed", () => big + 1);

/** @type {number} */
const object = { valueOf: () => 3 };
attempt("a number that is an object", () => [typeof object, object + 1, object * 2, table[object], object === 3]);

/** @type {number} */
const list = [3];
attempt("a number that is a list", () => [typeof list, list + 1, list * 2, table[list], list.length]);

/** @type {string} */
const count = 12;
attempt("a text that is a number", () => [typeof count, count + 1, count + "!", count.length, count[0], count === "12"]);
attempt("a text that is a number, a method", () => count.toUpperCase());

/** @type {string} */
const letters = ["a", "b"];
attempt("a text that is a list", () => [typeof letters, letters + "!", letters.length, letters[0], letters.slice(1), letters.indexOf("b"), letters.includes("a"), letters.concat("c"), letters.at(-1)]);
attempt("a text that is a list, a method only texts have", () => letters.toUpperCase());

/** @type {boolean} */
const zero = 0;
attempt("a truth that is zero", () => [typeof zero, zero === false, zero == false, !zero, zero ? "truthy" : "falsy", zero + 1]);

/** @type {boolean} */
const word = "false";
attempt("a truth that is a text", () => [typeof word, word === false, !word, word ? "truthy" : "falsy", word && 1, word || 2]);

/** @type {bigint} */
const small = 3;
attempt("a bigint that is a number", () => [typeof small, small + 1, small === 3]);
attempt("a bigint that is a number, mixed", () => small + 1n);

/** @type {symbol} */
const label = "label";
attempt("a symbol that is a text", () => [typeof label, label + "!", { [label]: 1 }, label.description]);

/** @type {number} */
let changing = 1;
attempt("a variable that changes its kind", () => {
  const seen = [changing + 1];
  changing = "two";
  seen.push(changing + 1);
  changing = null;
  seen.push(changing + 1);
  changing = { valueOf: () => 4 };
  seen.push(changing + 1);
  changing = 5;
  seen.push(changing + 1);
  return seen;
});

/** @type {number} */
var hoisted = early();
function early() {
  return typeof hoisted + " before";
}
attempt("a variable read before its value", () => [hoisted, hoisted + 1]);

function inALoop() {
  /** @type {number} */
  let total = 0;
  for (let i = 0; i < 2000; i++) total += i;
  total += "!";
  for (let i = 0; i < 3; i++) total += i;
  return total;
}
attempt("a total that becomes a text after 2000 rounds", inALoop);

function captured() {
  /** @type {number} */
  let n = 1;
  const read = () => n + 1;
  const first = read();
  n = "text";
  return [first, read()];
}
attempt("a captured variable", captured);
