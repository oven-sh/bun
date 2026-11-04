// A loop that counts. `s += i * i` and `s += i * by`: a product leaves 32 bits, then 53.
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
function run(from: number, n: number, by: number): any {
  let s = 0, t = 0;
  for (let i = from; i < n; i++) {
    s += i * i;
    t += i * by;
  }
  return [s, t];
}
for (const given of unknown([
  [0, 5, 1],
  [46339, 46343, 46341],
  [2 ** 31 - 2, 2 ** 31 + 2, 2],
  [94906265, 94906268, 94906267],
  [-3, 3, -0],
  [-3, 3, 0],
  [0, 3, -1],
  [0, 3, NaN],
  [1, 3, Infinity],
  [0, 3, Infinity],
  [0, 3, 0.5],
  [1, 4, 2 ** 53],
])) {
  let answer;
  try {
    answer = show(run(+given[0], +given[1], +given[2]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
