// A loop that counts. The counter starts at a written 2147483645.
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
  let s = 0, i = 2147483645;
  for (; i > n; i--) if (++s === 9) break;
  return [s, i];
}
for (const given of unknown([
  [2147483645 - 0],
  [2147483645 - 1],
  [2147483645 - 2],
  [2147483645 - 3],
  [2147483645 - 4],
  [2147483645 - 6],
  [2147483645 - 0.5],
  [2147483645 - 2.5],
  [2147483645 + 1],
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
