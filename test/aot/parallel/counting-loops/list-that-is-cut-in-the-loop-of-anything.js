// A loop that counts. `list.length = 2` in the loop.
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
  for (let i = 0; i < list.length; i++) {
    if (i === 1) list.length = 2;
    s += typeof list[i] === "number" ? list[i] : 100;
  }
  return [s, list.length];
}
for (const given of unknown([
  [[]],
  [[1]],
  [[1, 2, 3]],
  [[1, 2, 3, 4, 5, 6]],
  [[1.5, 2]],
  [["a", "b", "c"]],
])) {
  let answer;
  try {
    answer = show(run(given[0]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
