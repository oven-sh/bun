// A loop that counts. Each turn has a counter of its own, and a closure keeps it.
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
  const kept = [];
  for (let i = 0; i < n; i++) {
    kept.push(() => i);
    if (i === 1) i++;
    if (kept.length === 6) break;
  }
  return kept.map(each => each());
}
for (const given of unknown([
  [0],
  [1],
  [3],
  [5],
  [8],
  [2.5],
  [NaN],
  [-1],
  [2 ** 31],
  [Infinity],
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
