// Array literals of five values and more far from any loop of the text, and lists of arguments made arrays: what they hold, and that the run time fills them in one go and not value by value.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function five(a, b, c, d, e) { return [a, b, c, d, e]; }
function seven(a) { return [a, "two", 3, 4.5, null, undefined, { a }]; }
function sixteen(x) { return [x, x + 1, x + 2, x + 3, x + 4, x + 5, x + 6, x + 7, x + 8, x + 9, x + 10, x + 11, x + 12, x + 13, x + 14, x + 15]; }
function twenty(x) { return [x, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, "last"]; }
function nested(x) { return [[x, 1, 2, 3, 4], [x, 5, 6, 7, 8, 9], ["a", "b", "c", "d", "e", [x]]]; }
function rest(...all) { return all; }
function restBehindTwo(a, b, ...others) { return others; }
function show(value) { return JSON.stringify(value, (key, item) => item === undefined ? "undefined" : item); }

function once(i) {
  const a = five(i, "b", 2.5, null, undefined);
  const b = seven(i);
  const c = sixteen(i);
  const d = twenty(i);
  const e = nested(i);
  const f = rest(1, 2, 3, 4, 5, 6, i);
  const g = restBehindTwo(1, 2, 3, 4, 5, 6, 7, 8, i);
  return [a, b, c, d, e, f, g];
}
console.log(show(once(1)));

// They are ordinary arrays: they grow, shrink, take holes and other kinds of values.
const grown = five(1, 2, 3, 4, 5);
grown.push(6, 7, 8);
grown[12] = "far";
console.log(grown.length, show(grown), 9 in grown, Object.keys(grown).join());
const shrunk = sixteen(0);
shrunk.length = 3;
console.log(show(shrunk), shrunk.length, shrunk[3]);
const mixed = twenty(0.5);
mixed[1] = { x: 1 };
mixed.unshift("first");
console.log(show(mixed.slice(0, 4)), mixed.length, mixed.indexOf("last"), Array.isArray(mixed), mixed.constructor === Array);
console.log(show([...seven("s")].reverse()), show(sixteen(1).map((x) => x * 2).filter((x) => x % 3 === 0)));

// Many of them, with collections between.
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const filledByValue = () => count("operationAOTNewArrayOfHoles") + count("operationAOTStoreElement");
const before = filledByValue();
let kept = [], sum = 0, turn = 0;
function step() {
  const i = turn++;
  const made = once(i);
  sum += made[0].length + made[1].length + made[2][15] + made[3].length + made[4][2][5][0] + made[5][6] + made[6][6];
  if (i % 500 === 0) { kept.push(made); collect(); }
}
// No loop of the text stands round the literals.
function ten() { step(); step(); step(); step(); step(); step(); step(); step(); step(); step(); }
function hundred() { ten(); ten(); ten(); ten(); ten(); ten(); ten(); ten(); ten(); ten(); }
function thousand() { hundred(); hundred(); hundred(); hundred(); hundred(); hundred(); hundred(); hundred(); hundred(); hundred(); }
thousand(); thousand(); thousand();
const left = filledByValue() - before;
console.log(sum, kept.length, show(kept[3][2]), left <= 8 ? "and no array was filled value by value" : "and " + left + " arrays were filled value by value");

// A list too long for one go is an array all the same.
const long = [];
for (let i = 0; i < 300; i++) long.push(i);
const all = rest(...long);
console.log(all.length, all[0], all[299], all[300], restBehindTwo(...long).length);
