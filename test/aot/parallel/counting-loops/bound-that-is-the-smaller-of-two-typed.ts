// A loop that counts. `Math.min(a, b)`, NaN and -0 among them.
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
function run(a: number, b: number): any {
  let s = 0, i = 0;
  for (; i < Math.min(a, b); i++) s++;
  return [s, i];
}
for (const given of unknown([
  [3, 5],
  [5, 3],
  [3, NaN],
  [NaN, 3],
  [0, -0],
  [2.5, 9],
  [3, Infinity],
  [-1, 3],
  [4, 2 ** 53],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
