// A loop that counts. A text is read one code unit at a time: narrow, wide, a rope, a piece of another.
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
function run(list) {
  let s = 0, t = 0;
  for (let i = 0; i < list.length; i++) {
    if (list.charCodeAt(i) === 32) s++;
    t += list.charCodeAt(i);
  }
  return [s, t];
}
for (const given of unknown([
  [""],
  ["a"],
  ["a b c d"],
  ["seven c"],
  ["eight ch"],
  ["nine char"],
  ["a text of some length, with blanks in it"],
  ["\u0416 \u0416 wide"],
  ["x".repeat(17) + " "],
  [("ab " + unknown("cd ")).repeat(5)],
  ["a b".slice(1)],
  ["\ud83d\ude00 \ud83d"],
])) {
  let answer;
  try {
    answer = show(run(given[0]));
  } catch (error) {
    answer = "throws " + error.name;
  }
  console.log(given.map(show).join(", ") + " => " + answer);
}
