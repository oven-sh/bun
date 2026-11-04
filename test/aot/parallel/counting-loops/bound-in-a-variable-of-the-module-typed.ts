// A loop that counts. A function that is called in the loop stores into the variable.
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
let limit = 0;
function lowerLimit() {
  limit -= 2;
}
function run(n: number): any {
  limit = n;
  let s = 0;
  for (let i = 0; i < limit; i++) {
    if (i === 1) unknown(lowerLimit)();
    s++;
  }
  return [s, limit];
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
])) {
  let answer;
  try {
    answer = show(run(+given[0]));
  } catch (error: any) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
