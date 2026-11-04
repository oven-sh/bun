// A loop that counts. The tally starts at a written 0: `s -= 1073741824`.
// Every operand is declared a number.
const unknown = (value: any): any => new CustomEvent("unknown", { detail: value }).detail;
const show = (value: any): string =>
  Object.is(value, -0) ? "-0"
  : typeof value === "string" ? JSON.stringify(value)
  : typeof value === "bigint" ? value + "n"
  : typeof value === "symbol" ? "a symbol"
  : typeof value === "function" ? "a function"
  : Array.isArray(value) ? "[" + value.map(show).join(", ") + "]"
  : value !== null && typeof value === "object" ? "an object"
  : String(value);
function run(n: number): any {
  const text = unknown("four");
  let s = 0;
  for (let i = 0; i < n; i++) s -= 1073741824;
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
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
