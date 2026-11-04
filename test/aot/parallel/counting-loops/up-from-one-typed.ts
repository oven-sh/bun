// A loop that counts. The counter starts at a written 1.
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
  let s = 0, i = 1;
  for (; i < n; i++) if (++s === 9) break;
  return [s, i];
}
for (const given of unknown([
  [1 + 0],
  [1 + 1],
  [1 + 2],
  [1 + 3],
  [1 + 4],
  [1 + 6],
  [1 + 0.5],
  [1 + 2.5],
  [1 - 1],
  [NaN],
  [Infinity],
  [-Infinity],
  [0],
  [-0],
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
