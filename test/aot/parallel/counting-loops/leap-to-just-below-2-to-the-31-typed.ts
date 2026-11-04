// A loop that counts. The counter starts at a written 0 and is put two below 2147483648 by a written number: it stays an integer to the build, and crosses the border in the loop.
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
  let s = 0, i = 0;
  for (; i < n; i++) {
    if (i === 2) i = 2147483648 - 2;
    if (++s === 9) break;
  }
  return [s, i];
}
for (const given of unknown([
  [0],
  [2],
  [3],
  [2.5],
  [2147483648 - 1],
  [2147483648],
  [2147483648 + 1],
  [2147483648 + 3],
  [2147483648 * 2],
  [Infinity],
  [NaN],
  [1e300],
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
