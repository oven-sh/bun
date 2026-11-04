// A function without parameters reads `arguments[k]`, and every call hands it numbers: whole ones, fractions, NaN, negative zero, infinities, numbers past 2 ** 31 and 2 ** 53, none at all, more than eight.
const lines = [];
function sum() {
  let total = 0;
  for (let k = 0; k < arguments.length; k++) total += arguments[k];
  return total;
}
function list() {
  const texts = [];
  for (let k = 0; k <= arguments.length; k++) texts.push(Object.is(arguments[k], -0) ? "-0" : String(arguments[k]));
  return arguments.length + ":" + texts.join();
}
function behindOne(first) {
  let total = first;
  for (let k = 1; k < arguments.length; k++) total += arguments[k];
  return total + "/" + arguments.length + "/" + arguments[0];
}
function stores() {
  arguments[1] = 0.5;
  arguments[0] += 1;
  return arguments[0] + arguments[1] + arguments.length;
}
function last() {
  return arguments[arguments.length - 1];
}
for (let round = 0; round < 3; round++) {
  lines.push([sum(), sum(round), sum(round, 1, 2), sum(1.5, 2.25), sum(NaN, 1), sum(1, NaN), sum(-0), sum(2 ** 31, 1), sum(2 ** 53, 2), sum(Infinity, -Infinity), sum(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)].join(" "));
  lines.push([list(), list(-0), list(NaN), list(NaN, NaN, 1), list(0.1, -0, 2 ** 40), list(round, -round)].join(" "));
  lines.push([behindOne(1), behindOne(1, 2), behindOne(0.5, NaN), behindOne(-0, -0)].join(" "));
  lines.push([stores(1, 2), stores(1), stores(NaN, 3, 4), Object.is(last(1, -0), -0), last(), last(NaN)].join(" "));
}
console.log(lines.join("\n"));
