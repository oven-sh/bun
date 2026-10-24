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

/** @enum {number} */
const Level = { Low: 1, High: JSON.parse('"2"'), None: JSON.parse("null"), List: JSON.parse("[3]") };

/** @enum {string} */
const Color = { Red: "red", Green: JSON.parse("7") };

/** @enum {number} */
const Bare = { A: 1, B: 2 };

/** @enum {number} */
const Open = { First: 1 };

/**
 * @param {Level} level
 * @returns {number}
 */
function next(level) {
  return level + 1;
}

/**
 * @param {Level} level
 * @returns {string}
 */
function levelName(level) {
  switch (level) {
    case Level.Low:
      return "low";
    case Level.High:
      return "high";
    default:
      return "other " + typeof level;
  }
}

/**
 * @param {Color} color
 * @returns {number}
 */
function size(color) {
  return color.length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += next(Level.Low) + levelName(Level.Low).length + size(Color.Red) + Bare.A + Open.First;
console.log("2000 honest rounds: " + warm);

attempt("members", () => [Level.Low, Level.High, Level.None, Level.List, Color.Red, Color.Green]);
attempt("arithmetic", () => [next(Level.Low), next(Level.High), next(Level.None), next(Level.List), Level.High * 2]);
attempt("names", () => [levelName(Level.Low), levelName(Level.High), levelName(Level.None), levelName(Level.List), levelName(2), levelName(99)]);
attempt("sizes", () => [size(Color.Red), size(Color.Green)]);
attempt("any number is a level", () => [next(1.5), next(-0), next(NaN), levelName(NaN)]);
attempt("the object of the enum is an ordinary object", () => {
  /** @type {Record<string, number>} */
  const view = Open;
  view.First = 5;
  view.Second = 6;
  return [Open.First, Open.First + 1, Object.keys(Open).join(), JSON.stringify(Open)];
});
attempt("a member is deleted", () => {
  Reflect.deleteProperty(Open, "First");
  return [Open.First, Open.First + 1, "First" in Open];
});
attempt("a member becomes a getter", () => {
  let reads = 0;
  Object.defineProperty(Bare, "A", { get: () => ++reads + 100 });
  return [Bare.A, Bare.A, Bare.B];
});

export {};
