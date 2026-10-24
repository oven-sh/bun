/**
 * @param {unknown} value
 * @returns {string}
 */
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
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
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Animal {
  legs = 4;
}

class Dog extends Animal {
  name = "rex";
  /** @returns {string} */
  bark() {
    return this.name + "!";
  }
}

/**
 * @overload
 * @param {number} value
 * @returns {number}
 */
/**
 * @overload
 * @param {string} value
 * @returns {string}
 */
/**
 * @param {number | string} value
 * @returns {number | string}
 */
function crossed(value) {
  return typeof value === "number" ? String(value) : value.length;
}

/**
 * @overload
 * @param {"dog"} kind
 * @returns {Dog}
 */
/**
 * @overload
 * @param {"animal"} kind
 * @returns {Animal}
 */
/**
 * @param {string} kind
 * @returns {Animal}
 */
function make(kind) {
  return new Animal();
}

/**
 * @overload
 * @param {number} a
 * @returns {number}
 */
/**
 * @overload
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
/**
 * @param {number} a
 * @param {number} [b]
 * @returns {number | undefined}
 */
function maybe(a, b) {
  return b === undefined ? undefined : a + b;
}

/**
 * @overload
 * @param {number[]} list
 * @returns {number}
 */
/**
 * @overload
 * @param {string[]} list
 * @returns {string}
 */
/**
 * @param {(number | string)[]} list
 * @returns {number | string}
 */
function first(list) {
  return list[0];
}

class Reader {
  /**
   * @overload
   * @param {number} key
   * @returns {number}
   */
  /**
   * @overload
   * @param {string} key
   * @returns {string}
   */
  /**
   * @param {number | string} key
   * @returns {number | string}
   */
  read(key) {
    return typeof key === "number" ? "n" + key : key.length;
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
 * @param {string} s
 * @returns {number}
 */
function size(s) {
  return s.length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab") + maybe(i, 1) + first([i]);
console.log("2000 honest rounds: " + warm);

attempt("a number is promised and a text comes", () => [crossed(5), typeof crossed(5), crossed(5) + 1, plusOne(crossed(5)), crossed(5) * 2]);
attempt("a text is promised and a number comes", () => [crossed("ab"), typeof crossed("ab"), crossed("ab") + "!"]);
attempt("a text is promised and a number comes, its size", () => size(crossed("ab")));
attempt("a text is promised and a number comes, a method", () => crossed("ab").toUpperCase());
attempt("a dog is promised and an animal comes, a field", () => [make("dog").legs, make("dog").name, make("dog").name + "?", make("dog") instanceof Dog]);
attempt("a dog is promised and an animal comes, a method", () => make("dog").bark());
attempt("a number is promised and nothing comes", () => [maybe(1), maybe(1) + 1, plusOne(maybe(1)), maybe(1, 2)]);
attempt("the first of an empty list", () => [first([]), plusOne(first(/** @type {number[]} */ ([])))]);
attempt("a method", () => [new Reader().read(1), new Reader().read(1) + 1, new Reader().read("ab"), new Reader().read("ab") + "!"]);
attempt("in fields and lists", () => {
  const holder = { n: crossed(5), s: crossed("ab") };
  /** @type {number[]} */
  const numbers = [1, crossed(5)];
  let total = 0;
  for (const n of numbers) total += n;
  return [holder.n + 1, holder.s + "!", total];
});

export {};
