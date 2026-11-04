// A loop that counts. `i <= list.length` reads one past the end.
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
function run(list) {
  let s = 0;
  for (let i = 0; i <= list.length; i++) s += list[i];
  return s;
}
for (const given of unknown([
  [[]],
  [[1]],
  [[1, 2, 3]],
  [[1.5, 2, 3]],
  [[1, , 3]],
  [[1, "a", 3]],
  [[2 ** 31 - 1, 1, 1]],
  [[2 ** 53 - 1, 1, 1]],
  [[-0]],
  [[-0, -0]],
  [[NaN, 1]],
  [[1, undefined]],
  [[1, null]],
  [[1n]],
  [new Array(3)],
  [Array.from({ length: 40 }, (_, i) => i)],
  ["abc"],
  [{ length: 2, 0: 5, 1: 6 }],
  [{ length: "2", 0: 5, 1: 6 }],
  [{ length: 1.5, 0: 5, 1: 6 }],
  [{ length: -1 }],
  [{}],
  [new Uint8Array([250, 5, 1])],
  [new Float64Array([0.5, -0])],
])) {
  let answer;
  try {
    answer = show(run(given[0]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
