// `==` converts an object only against a primitive other than undefined and null.
let conversions = 0;
const counting = { valueOf() { conversions++; return 1; } };
const other = { valueOf() { conversions++; return 1; } };
function compare(left, right) {
  const before = conversions;
  const equal = left == right;
  return (equal ? "t" : "f") + (conversions - before);
}
function isNullish(value) {
  const nothing = null;
  const before = conversions;
  const equal = value == nothing;
  return (equal ? "t" : "f") + (conversions - before);
}
const values = [counting, other, null, undefined, 1, "1", true, 1n, Symbol.iterator, 0, ""];
for (let round = 0; round < 300; round++) {
  const line = values.map(left => values.map(right => compare(left, right)).join("")).join(" ") + " " + values.map(isNullish).join("");
  if (round === 0 || round === 299) console.log(line, conversions);
}
