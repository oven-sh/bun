// A loop that counts. The counter starts at a written 0.
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
  let i = 0;
  for (; i < n; i++);
  return i;
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
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
