function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
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

/** @returns {number} */
function text() {
  return "7";
}

/** @returns {number} */
function nothing() {}

/** @returns {number} */
function nil() {
  return null;
}

/** @returns {number} */
const list = () => [7];

/** @returns {string} */
function count() {
  return 7;
}

/** @returns {{ x: number, y: number }} */
function texts() {
  return { y: "2", x: "1" };
}

/** @returns {{ x: number, y: number }} */
function partial() {
  return { x: 1 };
}

/** @returns {{ x: number, y: number }} */
function pair() {
  return [1, 2];
}

/** @returns {number[]} */
function like() {
  return { length: 2, 0: 1, 1: 2 };
}

/** @returns {number[]} */
function letters() {
  return "12";
}

/** @returns {() => number} */
function maker() {
  return () => "made";
}

/** @returns {() => number} */
function noMaker() {
  return 5;
}

/** @returns {boolean} */
function one() {
  return 1;
}

/** @returns {void} */
function something() {
  return "something";
}

/**
 * @param {number} n
 * @returns {number}
 */
function sometimes(n) {
  return n % 1000 === 999 ? "late" : n;
}

/** @returns {Promise<number>} */
async function later() {
  return "later";
}

/** @returns {Promise<number>} */
function notAPromise() {
  return 7;
}

/** @returns {Generator<number>} */
function* yields() {
  yield "a";
  yield null;
  yield 3;
}

class Source {
  /** @returns {number} */
  get value() {
    return "got";
  }
  /** @returns {number} */
  method() {
    return "called";
  }
  /** @returns {Source} */
  static make() {
    return { value: 1, method: () => 2 };
  }
  /** @returns {this} */
  chain() {
    return "not this";
  }
}

/** @param {number} n */
function plusOne(n) {
  return n + 1;
}

attempt("a text for a number", () => [text(), typeof text(), text() + 1, text() * 2, plusOne(text()), [1, 2, 3, 4, 5, 6, 7, 8][text()]]);
attempt("nothing for a number", () => [nothing(), nothing() + 1, plusOne(nothing()), nothing() === undefined]);
attempt("null for a number", () => [nil(), nil() + 1, plusOne(nil())]);
attempt("a list for a number", () => [list() + 1, list() * 2, typeof list()]);
attempt("a number for a text", () => [count() + 1, count() + "!", count().length]);
attempt("a number for a text, a method", () => count().toUpperCase());
attempt("texts in a point", () => [texts().x + texts().y, Object.keys(texts()).join()]);
attempt("a point without y", () => [partial().x + partial().y, "y" in partial()]);
attempt("a list for a point", () => [pair().x, pair().length, pair()[0]]);
attempt("an array-like for a list", () => [like().length, like()[1], Array.isArray(like())]);
attempt("an array-like for a list, a method", () => like().map(plusOne));
attempt("a text for a list", () => [letters().length, letters()[0] + 1, [...letters()]]);
attempt("a text for a list, a method", () => letters().map(plusOne));
attempt("a maker of texts", () => [maker()(), maker()() + 1]);
attempt("no maker", () => noMaker()());
attempt("one for true", () => [one() === true, one() ? "truthy" : "falsy", one() + 1]);
attempt("something for void", () => [something(), something() + "!", something() === undefined]);
attempt("a result that changes after 999 calls", () => {
  let total = 0;
  for (let i = 0; i < 1002; i++) total += sometimes(i);
  return [typeof total, total.length];
});
attempt("a getter, a method, a static method, this", () => [new Source().value + 1, new Source().method() + 1, Source.make().value + 1, Source.make().method(), Source.make() instanceof Source, new Source().chain()]);
attempt("this, chained", () => new Source().chain().method());
attempt("yielded", () => [...yields()].map(plusOne));

const awaited = await later();
attempt("awaited", () => [awaited, awaited + 1]);
const direct = await notAPromise();
attempt("awaited what is no promise", () => [direct + 1, typeof notAPromise()]);
attempt("then of what is no promise", () => notAPromise().then(plusOne));
