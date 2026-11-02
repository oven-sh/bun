// Values of every kind are added to the empty text, from either side, appended to a text in a loop and written into a template. An object is asked as the language says, and what it throws arrives.
const asked = [];
const kept = [];
function churn() {
  for (let index = 0; index < 40; index++) kept[index & 7] = { index, text: "t" + index, list: [index, index + 0.5] };
}
const values = [
  "text",
  "",
  "a".repeat(3) + "b".repeat(2),
  "é" + "世",
  7,
  -7,
  0,
  -0,
  2147483648,
  7.5,
  1e21,
  NaN,
  -Infinity,
  12n,
  true,
  false,
  null,
  undefined,
  [1, [2, 3]],
  [],
  {},
  function named() {},
  new String("boxed"),
  new Number(3),
  new Date(0).getTime(),
  /x+/g,
  { toString() { asked.push("toString"); churn(); return "by toString"; } },
  { valueOf() { asked.push("valueOf"); churn(); return 41; }, toString() { asked.push("toString"); return "never for a sum"; } },
  { [Symbol.toPrimitive](hint) { asked.push(hint); churn(); return "hint " + hint; } },
  { valueOf() { return {}; }, toString() { asked.push("second"); return 5; } },
  { valueOf() { throw new RangeError("from valueOf"); }, toString() { throw new EvalError("from toString"); } },
  { valueOf() { return {}; }, toString() { return {}; } },
  Symbol("sign"),
  Object(Symbol("boxed sign")),
  Object.create(null),
];
function fromTheLeft(value) {
  return "" + value;
}
function fromTheRight(value) {
  return value + "";
}
function written(value) {
  return `${value}`;
}
function between(first, second) {
  return `<${first}|${second}>`;
}
function appended(value, times) {
  let out = "";
  for (let turn = 0; turn < times; turn++) out += value;
  return out;
}
function withMuchAlive(value, a, b, c, d, e, f, g, h) {
  const sum = a * 1.5 + b * 2.5;
  const product = c * d + 0.25;
  const list = [e, f];
  const text = "" + value;
  const other = `${value}`;
  return text + other + (sum + product) + list.join() + (g + h) + a + b + c + d + e + f;
}
function attempt(run, ...operands) {
  try {
    return typeof run(...operands) + " " + run(...operands);
  } catch (error) {
    return "threw " + error.constructor.name + ": " + error.message;
  }
}
const lines = [];
for (let round = 0; round < 30; round++) {
  const line = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    line.push(
      attempt(fromTheLeft, value),
      attempt(fromTheRight, value),
      attempt(written, value),
      attempt(between, value, values[(index + round) % values.length]),
      attempt(appended, value, 3),
      attempt(withMuchAlive, value, 1, 2, 3, 4, 5, 6, 7, 8),
    );
  }
  if (round === 0 || round === 29) lines.push(line.join("\n"), asked.join());
  asked.length = 0;
}
console.log(lines.join("\n"));
console.log(lines[0] === lines[2], lines[1] === lines[3]);
