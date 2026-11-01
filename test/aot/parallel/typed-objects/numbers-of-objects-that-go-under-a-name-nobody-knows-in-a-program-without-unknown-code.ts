// The objects go under a name that is found at run time, and nothing in the program is code that nobody knows: no callback of unknown origin, no getter, no read by a key, nothing that may call toJSON.
// Their numbers are asked for by name through receivers of which nothing is known, in a loop and in code that runs once, and asked whether they are there. Whatever can be in a number comes back as it was stored.
type Asked = { first: number; second: number; third?: number };
const values = [
  0,
  -0,
  1,
  -1,
  2147483647,
  2147483648,
  -2147483649,
  9007199254740992,
  1.5,
  NaN,
  Infinity,
  -Infinity,
  5e-324,
  1.7976931348623157e308,
];
(globalThis as any)[process.argv.length > 99 ? process.argv[9] : "asked"] = values.map(
  (value, index): Asked =>
    index % 2 ? { first: value, second: index + 0.25, third: -value } : { first: value, second: index + 0.25 },
);
let text = "";
let there = 0;
let sum = 0;
let count = 0;
let zeroth: any, first: any, fifth: any, ninth: any, last: any;
for (const item of (globalThis as any).asked) {
  if ("second" in item) there++;
  if ("third" in item) there += 100;
  if ("fourth" in item) there += 10000;
  const value = item.first;
  text +=
    (Object.is(value, -0) ? "-0" : String(value)) +
    " " +
    typeof value +
    " " +
    (value === value) +
    " " +
    (value + 1) +
    " " +
    (value | 0) +
    "\n";
  if (value === value && value < 100 && value > -100) sum += value;
  if (count === 0) zeroth = item;
  if (count === 1) first = item;
  if (count === 5) fifth = item;
  if (count === 9) ninth = item;
  last = item;
  count++;
}
console.log(text + there + " " + sum);
console.log(
  String(zeroth.second) +
    " " +
    String(zeroth.third) +
    " " +
    String(first.second) +
    " " +
    Object.is(first.third, 0) +
    " " +
    String(fifth.third) +
    " " +
    String(ninth.third) +
    " " +
    String(last.second) +
    " " +
    String(last.third),
);
zeroth.second = -0;
first.second = 1e300;
fifth.second = 7;
ninth.second = "text";
console.log(
  Object.is(zeroth.second, -0) +
    " " +
    String(first.second) +
    " " +
    String(fifth.second + 1) +
    " " +
    String(ninth.second) +
    " " +
    typeof ninth.second +
    " " +
    String(last.second),
);
