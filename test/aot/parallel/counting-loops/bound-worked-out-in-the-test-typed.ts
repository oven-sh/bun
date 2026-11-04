// A loop that counts. `i < n / 2`, `i < n - 1`, `i * i < n`.
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
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n / 2; i++) a++;
  for (let i = 0; i < n - 1; i++) b++;
  for (let i = 0; i * i < n; i++) c++;
  return [a, b, c];
}
for (const given of unknown([
  [0],
  [1],
  [5],
  [6],
  [2.5],
  [-3],
  [NaN],
  [-0],
  [30.25],
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
