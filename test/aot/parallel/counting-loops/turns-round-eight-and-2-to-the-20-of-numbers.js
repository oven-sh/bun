// A loop that counts. The tally, the sum of the counter and the counter behind the loop.
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
function run(n) {
  let s = 0, t = 0, i = 0;
  for (; i < n; i++) {
    s++;
    t += i;
  }
  return [s, t, i];
}
for (const given of unknown([
  [6],
  [7],
  [8],
  [9],
  [15],
  [16],
  [17],
  [23.5],
  [64],
  [65],
  [1048575],
  [1048576],
  [1048577],
  [1048583],
  [1048584],
  [1048585],
  [2097151],
  [2097152],
  [2097153],
  [2097160.5],
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
