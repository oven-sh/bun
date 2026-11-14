// Values that loops pass to built-ins that convert them to strings: numbers, strings, and everything else.
// STATISTIC: StringSpeculationsWithNumberFallback >= 1
const digits = /^(?:\d+|\*|\*\/\d+)$/, global = /\d/g, sticky = /1/y;
function areFields(values, min, max) {
  for (const value of values) {
    const number = parseInt(value, 10);
    if ((!Number.isNaN(number) && (number < min || number > max)) || !digits.test(value)) return false;
  }
  return true;
}
function count(values, test) { let found = 0; for (const value of values) { if (test.test(value)) found++; } return found; }
function parse(values) { let text = ""; for (const value of values) text += parseInt(value) + " " + parseInt(value, 16) + " " + parseFloat(value) + ";"; return text; }
function encode(values) { let text = ""; for (const value of values) text += encodeURIComponent(value) + escape(value) + "&"; return text; }
function find(values, held) { let text = ""; for (const value of values) text += held.indexOf(value) + "," + held.includes(value) + "," + held.startsWith(value) + " "; return text; }
function match(values, pattern) { let text = ""; for (const value of values) { const found = pattern.exec(value); text += found ? found[0] + "@" + found.index + "/" + pattern.lastIndex : "-"; } return text; }
const numbers = JSON.parse("[0, 1, 5, 12, 59, 60, -1, -0, 1.5, 1e21, 1e-7, 2147483648, 9007199254740993]").concat(NaN, Infinity, -0);
const strings = JSON.parse('["0", "12", "*", "*/5", "", "1e3", "0x1f", "-1", " 7", "a1"]');
const others = [undefined, null, true, false, 10n, [3], [1, 2], { toString() { return "4"; } }, { valueOf() { return 4; } }, new Date(NaN), Symbol.iterator.description];
for (const values of [numbers, strings, others, [...numbers, ...strings], [...strings, ...others, ...numbers], [5, 6, 7], ["5", 6, null]]) {
  console.log(areFields(values, 0, 59), areFields(values.slice(0, 3), 0, 59), count(values, digits), count(values, global), count(values, sticky), global.lastIndex, sticky.lastIndex);
  console.log(parse(values));
  console.log(encode(values));
  console.log(find(values, "x0 12 null true 1.5 4"));
  console.log(match(values, /\d+/), match(values, global), match(values, sticky));
}
for (const value of [Symbol("s"), { toString() { throw new RangeError("told"); } }, { toString() { return {}; }, valueOf() { return {}; } }]) {
  for (const run of [areFields, parse, encode, values => count(values, digits), values => find(values, "abc"), values => match(values, global)]) {
    try { console.log(run([1, "1", value, 2])); } catch (error) { console.log(error.constructor.name, error.message); }
  }
}
let turns = 0;
const changing = { toString() { turns++; digits.exec = () => null; return "8"; } };
console.log(areFields([1, 2, changing, 3, 4], 0, 59), turns, count([1, 2, 3], digits));
delete digits.exec;
console.log(count([1, 2, 3], digits), areFields([1, 2, 3], 0, 2));
