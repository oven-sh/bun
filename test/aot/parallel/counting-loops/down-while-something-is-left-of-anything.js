// A loop that counts. `while (i--)`: zero, -0 and NaN end it.
// The values arrive as they are, of every kind.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const show = value =>
  Object.is(value, -0) ? "-0"
  : typeof value === "string" ? JSON.stringify(value)
  : typeof value === "bigint" ? value + "n"
  : typeof value === "symbol" ? "a symbol"
  : typeof value === "function" ? "a function"
  : Array.isArray(value) ? "[" + value.map(show).join(", ") + "]"
  : value !== null && typeof value === "object" ? "an object"
  : String(value);
function run(from) {
  let turns = 0, i = from;
  while (i--) if (++turns === 7) break;
  return [turns, i];
}
for (const given of unknown([
  [0],
  [-0],
  [1],
  [3],
  [-1],
  [2.5],
  [NaN],
  [Infinity],
  [2 ** 31 + 1],
  [-(2 ** 31)],
  [2 ** 53],
  [-(2 ** 53)],
  ["3"],
  [""],
  ["a"],
  [null],
  [undefined],
  [true],
  [[2]],
  [3n],
  [0n],
  [{ valueOf: () => 2 }],
])) {
  let answer;
  try {
    answer = show(run(given[0]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
