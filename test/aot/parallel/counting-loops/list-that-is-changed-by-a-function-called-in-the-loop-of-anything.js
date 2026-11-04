// A loop that counts. Nothing in the loop names the change.
// The values arrive as they are, of every kind.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const show = value =>
  Object.is(value, -0) ? "-0"
  : typeof value === "string" ? JSON.stringify(value)
  : typeof value === "bigint" ? value + "n"
  : typeof value === "symbol" ? "a symbol"
  : typeof value === "function" ? "a function"
  : Array.isArray(value) ? "[" + value.map(show).join(", ") + "]"
  : value !== null && typeof value === "object" ? "an object"
  : String(value);
function cut(list) {
  list.length = 2;
}
function run(list) {
  let s = 0;
  for (let i = 0; i < list.length; i++) {
    if (i === 1) unknown(cut)(list);
    s++;
  }
  return [s, list.length];
}
for (const given of unknown([
  [[]],
  [[1]],
  [[1, 2, 3]],
  [[1, 2, 3, 4, 5, 6]],
  [[1.5, 2]],
  [["a", "b", "c"]],
])) {
  let answer;
  try {
    answer = show(run(given[0]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
