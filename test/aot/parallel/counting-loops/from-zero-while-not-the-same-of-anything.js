// A loop that counts. The counter starts at a written 0. `i !== n`.
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
function run(n) {
  let s = 0, i = 0;
  for (; i !== n; i++) if (++s === 45) break;
  return [s, i];
}
for (const given of unknown([
  [0],
  [1],
  [5],
  [-1],
  [-0],
  [0.5],
  [2.5],
  [3.000000001],
  [2.999999999],
  [NaN],
  [-Infinity],
  [-0.5],
  [1e-300],
  [40],
  [Infinity],
  [1e300],
  [2 ** 31 - 1],
  [2 ** 31],
  [2 ** 31 + 5],
  [2 ** 32],
  [2 ** 32 + 5],
  [2 ** 53 - 1],
  [2 ** 53],
  [2 ** 53 + 2],
  [2 ** 62],
  [2 ** 63],
  [2 ** 64],
  [1.7976931348623157e308],
  ["5"],
  ["2.5"],
  ["abc"],
  [""],
  [" 3 "],
  [null],
  [undefined],
  [true],
  [false],
  [[3]],
  [[]],
  [{}],
  [{ valueOf: () => 3 }],
  [3n],
  [Symbol()],
])) {
  let answer;
  try {
    answer = show(run(given[0]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
