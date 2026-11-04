// A loop that counts. The tally starts at a written 0.5: `s += text.length`.
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
  const text = unknown("four");
  let s = 0.5;
  for (let i = 0; i < n; i++) s += text.length;
  return s;
}
for (const given of unknown([
  [0],
  [1],
  [2],
  [3],
  [4],
  [6],
  [2.5],
  [NaN],
  [70],
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
