// A loop that counts. The counter reads and stores elements on both sides of zero and of the end.
// Every operand is a number, of which the build knows nothing else.
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
function run(from, n) {
  const list = [10, 20, 30];
  const seen = [];
  for (let i = from; i < n; i++) {
    seen.push(list[i]);
    if (i > 3) list[i] = i;
  }
  return [seen, list.length];
}
for (const given of unknown([
  [0, 3],
  [-2, 2],
  [0, 5],
  [2, 7],
  [0.5, 3],
  [-0, 2],
  [2 ** 32 - 3, 2 ** 32],
  [2 ** 32 - 2, 2 ** 32 + 1],
  [2 ** 31 - 1, 2 ** 31 + 1],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
