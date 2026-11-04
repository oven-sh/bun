// A loop that counts. `while (i--)`: zero, -0 and NaN end it.
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
function run(from: number): any {
  let turns = 0, i = from;
  while (i--) if (++turns === 7) break;
  return [turns, i];
}
for (const given of unknown([
  [0],
  [-0],
  [1],
  [3],
  [-1],
  [2.5],
  [NaN],
  [Infinity],
  [2 ** 31 + 1],
  [-(2 ** 31)],
  [2 ** 53],
  [-(2 ** 53)],
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
